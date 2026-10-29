'use strict';
/*
 * Zeugenverwaltung: Lager, Stand, Ladung, Aussage, Vorhalte – API (Rechte, Prüfung, Verlauf, Interessenkonflikt) und
 * Akte im Browser am PC und am Handy (hinzufügen, bearbeiten, Vorhalt, Ladung in den Kalender).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Zeugenverwaltung (API)', () => {
  let srv;
  let owner;
  let other;
  let mandant;
  let kase;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    other = client(srv.base);
    mandant = client(srv.base);
    await owner.login(TEAM.admin);
    await other.login(TEAM.anwalt);
    kase = (await owner.post('/api/cases', { title: 'Verkehrsunfall Doe', area: 'zivilrecht', clientName: 'John Doe' })).json.case;
  });
  after(() => srv.stop());

  const base = (id) => `/api/cases/${id}/parties`;
  const witness = { role: 'zeuge', name: 'Maria Miller', contact: 'Discord maria#1', side: 'entlastend', status: 'kontaktiert', summonAt: '2026-11-20T09:30:00.000Z', expected: 'Hat den Unfall von der Tankstelle aus gesehen.' };

  it('anlegen mit Lager, Stand, Ladung und erwarteter Aussage; Prüfung der Werte', async () => {
    const r = await owner.post(base(kase.id), witness);
    assert.equal(r.status, 201, r.text);
    const w = r.json.parties.find((p) => p.name === 'Maria Miller');
    assert.equal(w.role, 'zeuge');
    assert.equal(w.side, 'entlastend');
    assert.equal(w.status, 'kontaktiert');
    assert.equal(w.statusLabel, 'Kontaktiert');
    assert.equal(w.summonAt, '2026-11-20T09:30:00.000Z');
    assert.equal(w.expected, witness.expected);
    assert.deepEqual(w.contradictions, []);
    assert.equal((await owner.post(base(kase.id), { ...witness, status: 'gibts-nicht' })).status, 400);
    assert.equal((await owner.post(base(kase.id), { ...witness, side: 'seltsam' })).status, 400);
    assert.equal((await owner.post(base(kase.id), { ...witness, summonAt: 'morgen' })).status, 400);
    // ohne Angaben wie bisher: offen, kein Lager, keine Ladung
    const plain = (await owner.post(base(kase.id), { role: 'gegenpartei', name: 'Erik Gegner' })).json.parties.find((p) => p.name === 'Erik Gegner');
    assert.deepEqual([plain.status, plain.side, plain.summonAt], ['offen', '', null]);
  });

  it('ändern: Stand und Ladung stehen im Verlauf, Aussage speichern, Ladung entfernen', async () => {
    const id = (await owner.get(`/api/cases/${kase.id}`)).json.parties.find((p) => p.name === 'Maria Miller').id;
    const r = await owner.patch(`${base(kase.id)}/${id}`, { status: 'ausgesagt', statement: 'Der Wagen kam von links und fuhr bei Rot über die Kreuzung.', summonAt: null });
    assert.equal(r.status, 200, r.text);
    const w = r.json.parties.find((p) => p.id === id);
    assert.equal(w.status, 'ausgesagt');
    assert.equal(w.summonAt, null);
    assert.match(w.statement, /bei Rot/);
    const log = (await owner.get(`/api/cases/${kase.id}`)).json.notes.map((n) => n.body);
    assert.ok(log.some((b) => /Zeuge Maria Miller: Ausgesagt/.test(b)), log.join(' | '));
    // Teilaktualisierung lässt den Rest unberührt
    const again = (await owner.patch(`${base(kase.id)}/${id}`, { contact: 'Telefon 555-0101' })).json.parties.find((p) => p.id === id);
    assert.equal(again.status, 'ausgesagt');
    assert.equal(again.side, 'entlastend');
  });

  it('Vorhalte: anlegen, im Verlauf, höchstens 20, löschen; fremde Akte/Person nicht erreichbar', async () => {
    const id = (await owner.get(`/api/cases/${kase.id}`)).json.parties.find((p) => p.name === 'Maria Miller').id;
    assert.equal((await owner.post(`${base(kase.id)}/${id}/contradictions`, { text: 'x' })).status, 400);
    const r = await owner.post(`${base(kase.id)}/${id}/contradictions`, { text: 'Sagt 22 Uhr, die Bodycam zeigt 22:14 Uhr.', ref: 'B3' });
    assert.equal(r.status, 201, r.text);
    const w = r.json.parties.find((p) => p.id === id);
    assert.equal(w.contradictions.length, 1);
    assert.equal(w.contradictions[0].ref, 'B3');
    const log = (await owner.get(`/api/cases/${kase.id}`)).json.notes.map((n) => n.body);
    assert.ok(log.some((b) => /Vorhalt zu Maria Miller \(B3\)/.test(b)));
    for (let i = 0; i < 19; i++) await owner.post(`${base(kase.id)}/${id}/contradictions`, { text: `Vorhalt Nummer ${i}` });
    assert.equal((await owner.post(`${base(kase.id)}/${id}/contradictions`, { text: 'einer zu viel' })).status, 400);
    const cid = w.contradictions[0].id;
    const del = await owner.del(`${base(kase.id)}/${id}/contradictions/${cid}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.parties.find((p) => p.id === id).contradictions.length, 19);
    const second = (await owner.post('/api/cases', { title: 'Andere Akte', area: 'zivilrecht', clientName: 'Zed Zwei' })).json.case;
    assert.equal((await owner.del(`${base(second.id)}/${id}/contradictions/${cid}`)).status, 404, 'Vorhalt gehört zu einer anderen Akte');
  });

  it('nur Kanzlei und zuständige Anwälte; Mandanten sehen keine Zeugen', async () => {
    assert.equal((await other.post(base(kase.id), witness)).status, 403, 'nicht zuständig');
    await mandant.post('/api/auth/register', { displayName: 'Fremde Person', email: 'fremde.person', password: 'Fremdes-Passwort-7' });
    assert.equal((await mandant.post(base(kase.id), witness)).status, 404);
    assert.equal((await mandant.get(`/api/cases/${kase.id}`)).status, 404);
  });

  it('Zeuge, der in einer anderen Akte Mandant ist, löst den Konflikt-Hinweis aus', async () => {
    await owner.post('/api/cases', { title: 'Akte von Frau Miller', area: 'zivilrecht', clientName: 'Maria Miller' });
    const w = (await owner.get(`/api/cases/${kase.id}`)).json.parties.find((p) => p.name === 'Maria Miller');
    assert.ok(w.overlaps.length >= 1, 'Überschneidung erkannt');
  });
});

describe('Zeugenverwaltung in der Akte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let caseId;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    caseId = (await a.post('/api/cases', { title: 'Verkehrskontrolle Doe', area: 'strafrecht', clientName: 'John Doe' })).json.case.id;
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Zeuge anlegen, Vorhalt ergänzen, bearbeiten, Ladung in den Kalender – ohne Überlappungen`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
      // die erste Seitenansicht schließt beim Fertigwerden offene Fenster – dann die Akte noch einmal öffnen
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.evaluate((id) => openCase(id), caseId);
        if (await page.waitForSelector('#secWitnesses', { timeout: 10000 }).then(() => true, () => false)) break;
      }
      await page.waitForSelector('#secWitnesses');
      const nm = `Zeuge ${name}`;
      await page.click('[data-action="wit-add"]');
      await page.fill('#witName', nm);
      await page.fill('#witContact', 'Telefon 555-0100');
      await page.selectOption('#witSide', 'belastend');
      await page.selectOption('#witStatus', 'geladen');
      await page.fill('#witSummon', '2026-12-01T10:00');
      await page.fill('#witExpected', 'Hat die Geschwindigkeit geschätzt.');
      await page.click('form[data-form="wit-save"] button[type=submit]');
      await page.waitForSelector('.wit-card .wit-name strong');
      const card = page.locator('.wit-card', { hasText: nm });
      assert.ok((await card.textContent()).includes('Geladen'));
      assert.ok((await card.textContent()).includes('belastend'));
      assert.ok((await card.textContent()).includes('Hat die Geschwindigkeit geschätzt.'));
      // Vorhalt
      await card.locator('[data-action="wit-contra-toggle"]').click();
      await card.locator('form[data-form="wit-contra"] input[name="text"]').fill('Schätzt 90 km/h, das Messgerät zeigt 61.');
      await card.locator('form[data-form="wit-contra"] input[name="ref"]').fill('B1');
      await card.locator('form[data-form="wit-contra"] button[type=submit]').click();
      await page.waitForSelector('.wit-contra li');
      assert.match(await page.locator('.wit-card', { hasText: nm }).locator('.wit-contra').textContent(), /61.*B1/);
      // bearbeiten: Aussage
      await page.locator('.wit-card', { hasText: nm }).locator('[data-action="wit-edit"]').click();
      await page.selectOption('#witStatus', 'ausgesagt');
      await page.fill('#witStatement', 'Das Fahrzeug fuhr deutlich zu schnell.');
      await page.click('form[data-form="wit-save"] button[type=submit]');
      await page.waitForFunction((n) => [...document.querySelectorAll('.wit-card')].some((c) => c.textContent.includes(n) && c.textContent.includes('Ausgesagt') && c.textContent.includes('deutlich zu schnell')), nm);
      // keine Überlappung / kein Überlauf im Abschnitt
      const bad = await page.$$eval('#secWitnesses .wit-card', (cards) =>
        cards.flatMap((c) => [...c.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.children.length === 0).map((el) => el.className))
      );
      assert.deepEqual(bad, [], 'nichts ragt über den Rand');
      // Ladung in den Kalender: Formular mit Zeugen, Titel und Zeit vorbelegt
      await page.locator('.wit-card', { hasText: nm }).locator('[data-action="wit-summon"]').click();
      await page.waitForSelector('#evTitle');
      assert.equal(await page.inputValue('#evTitle'), `Zeugenladung: ${nm}`);
      assert.equal(await page.inputValue('#evStart'), '2026-12-01T10:00');
      assert.match(await page.inputValue('textarea[name="note"]'), /Telefon 555-0100/);
      await page.click('form[data-form="event"] button[type=submit]');
      await page.waitForFunction(() => !document.querySelector('form[data-form="event"]'), null, { timeout: 8000 });
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});
