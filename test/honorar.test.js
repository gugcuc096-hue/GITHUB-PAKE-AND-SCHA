'use strict';
/*
 * Honorarrechner:
 *  - Rechenkern (public/js/honorar-calc.js): Preismodelle, Spanne, Zuschläge, Rang-Faktor, Bündelrabatt, Aktion,
 *    Prioritätszuschlag, Erfolgshonorar mit Mindesthonorar und Deckel, Pakete
 *  - Honorarordnung: Leistungen mit Preismodell, Pakete, Satz je Rang (Dashboard-API) – öffentlich mit allem für den Rechner
 *  - Angebot speichern (HON-…), abrufen, mit der Mandatsanfrage in die Akte, Rechnung übernimmt die Positionen
 *  - Erfolgshonorar beim Abschluss: erstrittener Betrag → Rechnung mit Rechenweg, nur einmal
 *  - Browser: /honorare?gebiet=zivilrecht vorgefiltert, „Nur bei Erfolg“, Rechenweg, Angebot als Code, Assistent
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');
const H = require('../public/js/honorar-calc');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Honorarrechner: Rechenkern', () => {
  const fees = [
    { id: 1, name: 'Beratung', price: 15000, model: 'fest' },
    { id: 2, name: 'Zivilklage', model: 'erfolg', config: { pct: 20, minFee: 10000, cap: 50000, valueDefault: 150000 } },
    { id: 3, name: 'Verhandlung', price: 8000, model: 'einheit', config: { priceMax: 10000, unit: 'Stunde' } },
    { id: 4, name: 'Vertretung', price: 60000, model: 'fest', surcharges: [{ name: 'Eilzuschlag', pct: 25 }, { name: 'Nacht', amount: 15000 }] },
    { id: 5, name: 'Prozess', model: 'staffel', config: { tiers: [{ upTo: 50000, price: 20000 }, { upTo: 200000, price: 40000 }, { upTo: 0, price: 80000 }] } },
    { id: 6, name: 'Forderung', model: 'grund_erfolg', config: { base: 15000, pct: 10 } },
    { id: 7, name: 'Prozent', model: 'prozent', config: { pct: 5, minFee: 10000 } },
  ];

  it('Erfolgshonorar: 20 % von 150.000 $ = 30.000 $ – Mindesthonorar und Deckel greifen', () => {
    const q = H.quote({ fees, picks: [{ id: 2, value: 150000 }] });
    assert.equal(q.totalLow, 0, 'vorab nichts');
    assert.equal(q.success[0].amount, 30000);
    assert.match(q.positions[0].steps.join(' '), /20 % von 150\.000 \$ = 30\.000 \$/);
    assert.equal(H.settle(q.success, 20000)[0].amount, 10000, 'Mindesthonorar');
    assert.equal(H.settle(q.success, 900000)[0].amount, 50000, 'Deckel');
  });

  it('Spanne, Menge, Zuschläge, Staffel, Grundgebühr + Erfolgsanteil, Prozent mit Mindesthonorar', () => {
    const q = H.quote({ fees, picks: [{ id: 3, qty: 3 }], calc: { bundlePct: 0 } });
    assert.deepEqual([q.totalLow, q.totalHigh], [24000, 30000]);
    const s = H.position(fees[3], { surcharges: ['Eilzuschlag', 'Nacht'] });
    assert.equal(s.low, 60000 + 15000 + 15000);
    assert.equal(H.position(fees[4], { value: 120000 }).low, 40000);
    assert.equal(H.position(fees[4], { value: 5_000_000 }).low, 80000, 'darüber');
    const g = H.position(fees[5], { value: 80000 });
    assert.equal(g.low, 15000);
    assert.equal(g.success.amount, 8000);
    assert.equal(H.position(fees[6], { value: 100000 }).low, 10000, 'Mindesthonorar statt 5.000 $');
  });

  it('Rang-Faktor (nicht auf den Erfolgsanteil), Bündelrabatt, Aktion, Prioritätszuschlag, Paket mit Ersparnis', () => {
    const q = H.quote({ fees, picks: [{ id: 1 }, { id: 4 }, { id: 3, qty: 1 }, { id: 2, value: 100000 }], factor: 1.5, factorLabel: 'Founding Partner', promo: { name: 'Aktion', pct: 10 }, priority: true, calc: { bundleMin: 3, bundlePct: 10, priorityPct: 20 } });
    const sub = (15000 + 60000 + 8000) * 1.5;
    assert.equal(q.subtotalLow, sub);
    assert.equal(q.bundle.low, Math.round(sub * 0.1));
    assert.equal(q.promo.low, Math.round(sub * 0.1));
    const rest = sub - q.bundle.low - q.promo.low;
    assert.equal(q.totalLow, rest + Math.round(rest * 0.2));
    assert.equal(q.success[0].amount, 20000, 'Erfolgsanteil ohne Rang-Faktor');
    assert.ok(q.steps.some((x) => /Founding Partner/.test(x)), 'Rechenweg nennt den Satz');
    const p = H.quote({ fees, packages: [{ id: 9, name: 'Paket', feeIds: [1, 4], price: 60000 }], packageId: 9, picks: [{ id: 1 }] });
    assert.equal(p.positions.length, 1, 'Leistungen im Paket zählen nicht doppelt');
    assert.equal(p.positions[0].saving, 15000);
    assert.equal(p.totalLow, 60000);
  });
});

describe('Honorarrechner: Honorarordnung, Angebote, Akte und Erfolgshonorar', () => {
  let server;
  const admin = { c: null };
  const anwalt = { c: null };
  before(async () => {
    server = await startServer();
    admin.c = client(server.base);
    anwalt.c = client(server.base);
    await admin.c.login(TEAM.admin);
    await anwalt.c.login(TEAM.anwalt);
  });
  after(async () => {
    if (server) await server.stop();
  });

  it('Startausstattung: Leistungen je Rechtsgebiet, Zivilklage mit Erfolgshonorar, Pakete – öffentlich für den Rechner', async () => {
    const r = await client(server.base).get('/api/fees');
    assert.equal(r.status, 200);
    const ziv = r.json.fees.find((f) => f.model === 'erfolg');
    assert.ok(ziv, 'Zivilklage mit Erfolgshonorar');
    assert.deepEqual(ziv.areas, ['zivilrecht']);
    assert.equal(ziv.config.pct, 20);
    assert.ok(r.json.fees.find((f) => f.name === 'Strafrechtliche Vertretung').surcharges.length >= 1, 'Zuschläge');
    assert.ok(r.json.packages.length >= 1, 'Pakete');
    assert.deepEqual(r.json.rankFactors, {});
  });

  it('Board pflegt Preismodell, Zuschläge, Pakete und Satz je Rang', async () => {
    const bad = await admin.c.post('/api/admin/fees', { category: 'gericht', name: 'Kaputt', price: 0, model: 'gibtsnicht' });
    assert.equal(bad.status, 400);
    const noVal = await admin.c.post('/api/admin/fees', { category: 'gericht', name: 'Zuschlag ohne Wert', price: 1000, surcharges: [{ name: 'Eil' }] });
    assert.equal(noVal.status, 400, 'Zuschlag braucht Prozent oder Betrag');
    const f = await admin.c.post('/api/admin/fees', {
      category: 'gericht',
      name: 'Schadensersatzklage Test',
      price: 0,
      model: 'grund_erfolg',
      areas: ['zivilrecht'],
      config: { base: 10000, pct: 15, cap: 100000, valueLabel: 'Schaden' },
      includes: ['Klage', 'Termin'],
      surcharges: [{ name: 'Eilzuschlag', pct: 20 }],
    });
    assert.equal(f.status, 201, f.text);
    assert.equal(f.json.fee.model, 'grund_erfolg');
    assert.deepEqual(f.json.fee.includes, ['Klage', 'Termin']);
    assert.equal((await anwalt.c.post('/api/admin/fees/packages', { name: 'X', feeIds: [1, 2], price: 1 })).status, 403, 'nur mit Recht auf die Honorarordnung');
    const pk = await admin.c.post('/api/admin/fees/packages', { area: 'zivilrecht', name: 'Zivil komplett', feeIds: [1, f.json.fee.id], price: 20000 });
    assert.equal(pk.status, 201, pk.text);
    assert.equal((await admin.c.patch(`/api/admin/fees/packages/${pk.json.package.id}`, { price: 21000 })).json.package.price, 21000);
    const rf = await admin.c.put('/api/admin/fees/rank-factors', { factors: { 'Founding Partner': 1.5, 'Junior Associate': 0.8, Unsinn: 3 } });
    assert.equal(rf.status, 200);
    assert.deepEqual(rf.json.rankFactors, { 'Founding Partner': 1.5, 'Junior Associate': 0.8 }, 'nur bekannte Ränge');
    assert.deepEqual((await client(server.base).get('/api/fees')).json.rankFactors, { 'Founding Partner': 1.5, 'Junior Associate': 0.8 });
  });

  it('Angebot speichern: Server rechnet selbst (Satz des Wunschanwalts), Code abrufbar, Unbekanntes 404', async () => {
    const anon = client(server.base);
    const fees = (await anon.get('/api/fees')).json.fees;
    const beratung = fees.find((f) => f.name === 'Rechtliche Beratung per Ticket');
    const team = (await anon.get('/api/team')).json.team;
    const fp = team.find((m) => m.roleTitle === 'Founding Partner');
    const empty = await anon.post('/api/public/offers', { picks: [] });
    assert.equal(empty.status, 400);
    const r = await anon.post('/api/public/offers', { picks: [{ id: beratung.id }], teamMemberId: fp.id });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.code, /^HON-\d{4,8}$/);
    assert.equal(r.json.quote.totalLow, beratung.price * 1.5, 'Satz Founding Partner × 1,5');
    const g = await anon.get(`/api/public/offers/${r.json.code.toLowerCase()}`);
    assert.equal(g.status, 200);
    assert.equal(g.json.selection.teamMemberId, fp.id);
    assert.equal((await anon.get('/api/public/offers/HON-0000000')).status, 404);
    await admin.c.put('/api/admin/fees/rank-factors', { factors: {} });
  });

  it('Mandatsanfrage mit Angebot → Honorarvereinbarung in der Akte, Rechnung übernimmt die Positionen, Erfolgshonorar beim Abschluss', async () => {
    const anon = client(server.base);
    const fees = (await anon.get('/api/fees')).json.fees;
    const ziv = fees.find((f) => f.model === 'erfolg');
    const beratung = fees.find((f) => f.name === 'Persönliche Rechtsberatung');
    const offer = await anon.post('/api/public/offers', { area: 'zivilrecht', picks: [{ id: ziv.id, value: 150000 }, { id: beratung.id }] });
    assert.equal(offer.status, 201);
    const req = await anon.post('/api/public/cases', { name: 'Zora Zivil', area: 'zivilrecht', description: 'Mein Auto wurde beschädigt, ich will Schadensersatz.', offerCode: offer.json.code });
    assert.equal(req.status, 201, req.text);
    const list = (await admin.c.get('/api/cases?q=' + encodeURIComponent(req.json.caseNumber))).json;
    const kase = (list.cases || list).find((c) => c.caseNumber === req.json.caseNumber);
    assert.ok(kase, 'Akte gefunden');
    const detail = (await admin.c.get(`/api/cases/${kase.id}`)).json;
    assert.equal(detail.feeAgreement.offerCode, offer.json.code);
    assert.equal(detail.feeAgreement.hasSuccess, true);
    const fa = (await admin.c.get(`/api/cases/${kase.id}/honorar`)).json;
    assert.deepEqual(fa.items.map((i) => i.unitPrice), [beratung.price], 'Rechnung: nur die festen Positionen');
    assert.match(fa.rechenweg, /20 % von 150\.000 \$ = 30\.000 \$/);
    const billing = (await admin.c.get(`/api/cases/${kase.id}/contracts/billing`)).json;
    assert.equal(billing.feeAgreement.used, true);
    assert.equal(billing.items[0].unitPrice, beratung.price);
    // Code ein zweites Mal: hängt nicht automatisch an eine weitere Anfrage
    const again = await anon.post('/api/public/cases', { name: 'Zweite Anfrage', area: 'zivilrecht', description: 'Noch einmal dasselbe Angebot verwenden.', offerCode: offer.json.code });
    assert.equal(again.status, 201);
    // Erfolgshonorar abrechnen: 80.000 $ erstritten → 16.000 $ mit Rechenweg
    const s = await admin.c.post(`/api/cases/${kase.id}/honorar/settle`, { value: 80000 });
    assert.equal(s.status, 201, s.text);
    assert.equal(s.json.total, 16000);
    assert.equal(s.json.invoice.total, 16000);
    assert.match(s.json.invoice.notes, /Rechenweg/);
    assert.match(s.json.invoice.notes, /20 % von 80\.000 \$ = 16\.000 \$/);
    assert.equal((await admin.c.post(`/api/cases/${kase.id}/honorar/settle`, { value: 80000 })).status, 409, 'nur einmal');
    assert.equal((await admin.c.del(`/api/cases/${kase.id}/honorar`)).status, 409, 'abgerechnet: Vereinbarung bleibt');
  });

  it('Angebot per Code in einer bestehenden Akte übernehmen und wieder lösen', async () => {
    const anon = client(server.base);
    const fees = (await anon.get('/api/fees')).json.fees;
    const offer = await anon.post('/api/public/offers', { picks: [{ id: fees[0].id }] });
    const c = (await admin.c.post('/api/cases', { title: 'Codetest', area: 'strafrecht', clientName: 'Carl Code' })).json.case;
    assert.equal((await admin.c.post(`/api/cases/${c.id}/honorar`, { code: 'HON-0000001' })).status, 404);
    const a = await admin.c.post(`/api/cases/${c.id}/honorar`, { code: offer.json.code.replace('HON-', 'hon ') });
    assert.equal(a.status, 201, a.text);
    assert.equal(a.json.agreement.offerCode, offer.json.code);
    assert.equal((await admin.c.post(`/api/cases/${c.id}/honorar/settle`, { value: 1000 })).status, 400, 'ohne Erfolgshonorar nichts abzurechnen');
    assert.equal((await admin.c.del(`/api/cases/${c.id}/honorar`)).status, 200);
    assert.equal((await admin.c.get(`/api/cases/${c.id}`)).json.feeAgreement, null);
  });

  it('Browser: vorgefiltert je Rechtsgebiet, Erfolgshonorar mit Rechenweg, Angebot als Code, Assistent', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
      const p = await ctx.newPage();
      const problems = [];
      p.on('pageerror', (e) => problems.push(e.message));
      // Seite des Rechtsgebiets führt vorgefiltert zum Rechner
      await p.goto(`${server.base}/rechtsgebiete/zivilrecht`);
      assert.equal(await p.getAttribute('a:has-text("Honorar berechnen")', 'href'), '/honorare?gebiet=zivilrecht#rechner');
      await p.goto(`${server.base}/honorare?gebiet=zivilrecht`);
      await p.waitForSelector('#hrAreas .hr-area.is-on[data-hr-area="zivilrecht"]');
      assert.equal(await p.locator('#calcOptions .hr-opt[data-fee]').filter({ hasText: 'Vertragsentwurf' }).count(), 0, 'nur Leistungen für Zivilrecht und allgemeine');
      await p.locator('.hr-opt[data-model="erfolg"] .calc-check').check();
      await p.waitForFunction(() => /20 % von 150\.000 \$ = 30\.000 \$/.test(document.getElementById('hrSuccess').textContent));
      assert.match(await p.textContent('#totalNote'), /nur bei Erfolg/);
      // Regler: erwarteter Schaden 200.000 $ → 40.000 $
      await p.locator('.hr-opt[data-model="erfolg"] [data-hr-value]').evaluate((el) => {
        el.value = '200000';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await p.waitForFunction(() => /20 % von 200\.000 \$ = 40\.000 \$/.test(document.getElementById('hrSuccess').textContent));
      assert.match(await p.textContent('#hrSteps'), /Nur bei Erfolg/);
      // Angebot als Code speichern und über den Link wieder öffnen
      await p.click('#hrSave');
      await p.waitForSelector('#hrCode:not([hidden]) .hr-code-v');
      const code = (await p.textContent('#hrCode .hr-code-v')).trim();
      assert.match(code, /^HON-\d+$/);
      await p.goto(`${server.base}/honorare?angebot=${code}`);
      await p.waitForFunction(() => /40\.000 \$/.test(document.getElementById('hrSuccess').textContent));
      // Assistent: Rechtsgebiet → Leistung → Empfehlung mit Preis → übernehmen
      await p.goto(`${server.base}/honorare`);
      await p.click('[data-hr-tab="assistent"]');
      await p.click('[data-hr-w="area"][data-v="strafrecht"]');
      await p.click('[data-hr-w="fee"] >> text=Strafrechtliche Vertretung');
      await p.waitForSelector('.hr-rec');
      assert.match(await p.textContent('.hr-rec'), /Paket/, 'Paket mit Ersparnis wird empfohlen');
      await p.click('[data-hr-w="take"]');
      await p.waitForFunction(() => document.querySelectorAll('#calcOptions .calc-check:checked').length === 1);
      assert.match(await p.textContent('#selectedList'), /Strafrechtliche Vertretung/);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'kein seitlicher Überlauf');
      assert.deepEqual(problems, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
});
