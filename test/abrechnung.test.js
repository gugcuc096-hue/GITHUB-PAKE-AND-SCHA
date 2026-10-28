'use strict';
/*
 * Gebührenkategorien, Rechnungsarten und Standardgebühren je Rechtsgebiet – API (Anlegen, Rechte, Ausblenden, Löschen nur
 * ohne Nutzung, Zahlungsziel/Vorschuss/Standardtext auf der Rechnung, Website sieht Kategorien) und Rechnungs-Generator
 * im Browser am PC und am Handy.
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

const type = { name: 'Vorschussrechnung', base: 'rechnung', dueDays: 14, advancePct: 30, expenseLabel: 'Auslagenpauschale', expenseAmount: 2000, note: 'Danke für Ihr Vertrauen.', active: true };

describe('Gebührenkategorien und Rechnungsarten (API)', () => {
  let srv;
  let owner;
  let board;
  let anon;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    board = client(srv.base);
    anon = client(srv.base);
    await owner.login(TEAM.admin);
    await board.login(TEAM.partner);
  });
  after(() => srv.stop());

  it('Kategorien: Vorgabe, anlegen nur mit Recht, Leistung in neuer Kategorie, ausgeblendet = weg von der Website', async () => {
    const start = (await owner.get('/api/billing')).json;
    assert.deepEqual(start.categories.map((c) => c.key), ['rechtsberatung', 'strafrecht', 'notfall', 'gericht', 'vertraege']);
    assert.equal((await board.post('/api/billing/categories', { name: 'Verkehrsrecht' })).status, 403);
    assert.equal((await owner.post('/api/billing/categories', { name: 'V' })).status, 400);
    const r = await owner.post('/api/billing/categories', { name: 'Verkehrsrecht' });
    assert.equal(r.status, 201, r.text);
    assert.ok(r.json.categories.some((c) => c.key === 'verkehrsrecht'));
    const fee = await owner.post('/api/admin/fees', { category: 'verkehrsrecht', name: 'Unfallaufnahme', price: 12000 });
    assert.equal(fee.status, 201, fee.text);
    assert.equal((await owner.post('/api/admin/fees', { category: 'gibts-nicht', name: 'Nix', price: 1 })).status, 400);
    const pub = (await anon.get('/api/fees')).json;
    assert.ok(pub.categories.some((c) => c.key === 'verkehrsrecht'));
    assert.ok(pub.fees.some((f) => f.name === 'Unfallaufnahme'));
    // ausblenden: Kategorie und Leistungen verschwinden, die Leistung bleibt in der Verwaltung
    await owner.put('/api/billing/categories/verkehrsrecht', { name: 'Verkehrsrecht', active: false });
    const hidden = (await anon.get('/api/fees')).json;
    assert.equal(hidden.categories.some((c) => c.key === 'verkehrsrecht'), false);
    assert.equal(hidden.fees.some((f) => f.name === 'Unfallaufnahme'), false);
    assert.ok((await owner.get('/api/admin/fees')).json.fees.some((f) => f.name === 'Unfallaufnahme'));
    // Löschen nur leer
    assert.equal((await owner.del('/api/billing/categories/verkehrsrecht')).status, 409);
    const spare = (await owner.post('/api/billing/categories', { name: 'Leer' })).json.categories.find((c) => c.name === 'Leer');
    assert.equal((await owner.del(`/api/billing/categories/${spare.key}`)).status, 200);
  });

  it('Rechnungsarten: Vorgabe, anlegen, Auslagen nur mit Bezeichnung, Grundarten bleiben', async () => {
    const start = (await owner.get('/api/billing')).json;
    assert.deepEqual(start.types.map((t) => t.key), ['rechnung', 'honorarvereinbarung']);
    assert.equal((await board.post('/api/billing/types', type)).status, 403);
    assert.equal((await owner.post('/api/billing/types', { ...type, expenseLabel: '' })).status, 400);
    assert.equal((await owner.post('/api/billing/types', { ...type, advancePct: 120 })).status, 400);
    const r = await owner.post('/api/billing/types', type);
    assert.equal(r.status, 201, r.text);
    assert.ok(r.json.types.some((t) => t.key === 'vorschussrechnung' && t.advancePct === 30));
    assert.equal((await owner.del('/api/billing/types/rechnung')).status, 409);
  });

  it('Rechnung mit Art: Grundart, Zahlungsziel und Standardtext aus der Art, Vorschuss mit Betrag in den Anmerkungen', async () => {
    const r = await owner.post('/api/invoices', { typeKey: 'vorschussrechnung', clientName: 'Rita Rechnung', items: [{ description: 'Beratung', quantity: 1, unitPrice: 10000 }] });
    assert.equal(r.status, 201, r.text);
    const inv = r.json.invoice;
    assert.equal(inv.typeKey, 'vorschussrechnung');
    assert.equal(inv.typeLabel, 'Vorschussrechnung');
    assert.equal(inv.kind, 'rechnung');
    assert.match(inv.number, /^RE-/);
    assert.ok(inv.dueDate, 'Zahlungsziel aus der Art');
    const days = Math.round((Date.parse(`${inv.dueDate}T12:00:00Z`) - Date.now()) / 864e5);
    assert.ok(days >= 13 && days <= 15, `14 Tage, war ${days}`);
    assert.match(inv.notes, /Danke für Ihr Vertrauen\./);
    assert.match(inv.notes, /Vorschuss: 30 % \(3\.000 \$\)/);
    // eigenes Datum und eigener Text gewinnen; unbekannte Art wird abgelehnt
    const own = await owner.post('/api/invoices', { typeKey: 'vorschussrechnung', clientName: 'Rita Rechnung', dueDate: '2030-01-05', notes: 'Eigener Text', items: [{ description: 'Beratung', quantity: 1, unitPrice: 10000 }] });
    assert.equal(own.json.invoice.dueDate, '2030-01-05');
    assert.match(own.json.invoice.notes, /^Eigener Text/);
    assert.equal((await owner.post('/api/invoices', { typeKey: 'gibts-nicht', clientName: 'Rita Rechnung', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status, 400);
    // ohne Art: wie bisher
    const plain = await owner.post('/api/invoices', { clientName: 'Rita Rechnung', items: [{ description: 'x', quantity: 1, unitPrice: 100 }] });
    assert.equal(plain.json.invoice.typeKey, null);
    assert.equal(plain.json.invoice.dueDate, null);
    // Art in Benutzung: nicht löschbar, aber ausblendbar (alte Rechnungen behalten den Namen)
    assert.equal((await owner.del('/api/billing/types/vorschussrechnung')).status, 409);
    await owner.put('/api/billing/types/vorschussrechnung', { ...type, active: false });
    assert.equal((await owner.post('/api/invoices', { typeKey: 'vorschussrechnung', clientName: 'Rita Rechnung', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status, 400);
    assert.equal((await owner.get(`/api/invoices/${inv.id}`)).json.invoice.typeLabel, 'Vorschussrechnung');
    await owner.put('/api/billing/types/vorschussrechnung', { ...type, active: true });
  });

  it('Standardgebühren je Rechtsgebiet: speichern, prüfen, im Rechnungs-Generator ausgeliefert', async () => {
    const fees = (await owner.get('/api/admin/fees')).json.fees;
    const beratung = fees.find((f) => f.category === 'rechtsberatung');
    const area = (await owner.get('/api/areas')).json.areas.find((a) => a.key === 'zivilrecht');
    const body = { name: area.name, short: area.short, color: area.color, icon: area.icon, intakeTitle: area.intakeTitle, active: true, steps: null, checklist: area.checklist, outcomes: area.outcomes, fields: area.fields };
    assert.equal((await owner.put('/api/areas/zivilrecht', { ...body, defaultFees: [99999] })).status, 400);
    assert.equal((await owner.put('/api/areas/zivilrecht', { ...body, defaultFees: [], defaultType: 'gibts-nicht' })).status, 400);
    const r = await owner.put('/api/areas/zivilrecht', { ...body, defaultFees: [beratung.id], defaultType: 'honorarvereinbarung' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.area.defaultFees, [beratung.id]);
    assert.deepEqual((await owner.get('/api/billing')).json.areaDefaults.zivilrecht, { fees: [beratung.id], type: 'honorarvereinbarung' });
    assert.equal(JSON.stringify((await anon.get('/api/public/areas')).json).includes('defaultFees'), false, 'öffentlich keine Gebühren-Voreinstellungen');
  });
});

describe('Rechnungs-Generator mit Rechnungsarten (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let caseId;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.post('/api/billing/types', type);
    const fee = (await a.get('/api/admin/fees')).json.fees.find((f) => f.category === 'rechtsberatung');
    const area = (await a.get('/api/areas')).json.areas.find((x) => x.key === 'zivilrecht');
    await a.put('/api/areas/zivilrecht', { name: area.name, short: area.short, color: area.color, icon: area.icon, intakeTitle: area.intakeTitle, active: true, steps: null, checklist: area.checklist, outcomes: area.outcomes, fields: area.fields, defaultFees: [fee.id], defaultType: 'vorschussrechnung' });
    caseId = (await a.post('/api/cases', { title: 'Streit um Miete', area: 'zivilrecht', clientName: 'Mia Miete' })).json.case.id;
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Akte wählen → Standardgebühr, Auslagenpauschale, Rechnungsart und Zahlungsziel stehen drin`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.evaluate(() => (location.hash = '#invoice-new'));
      await page.waitForSelector('#invType');
      await page.selectOption('select[name="caseId"]', String(caseId));
      await page.waitForFunction(() => document.querySelectorAll('#invItems .item-row').length >= 2);
      const rows = await page.$$eval('#invItems .item-row [data-item="description"]', (els) => els.map((e) => e.value));
      assert.ok(rows.includes('Auslagenpauschale'), `Auslagenpauschale fehlt: ${rows}`);
      assert.equal(await page.inputValue('#invType'), 'vorschussrechnung');
      assert.ok(await page.inputValue('input[name="dueDate"]'), 'Zahlungsziel gesetzt');
      assert.match(await page.inputValue('textarea[name="notes"]'), /Danke für Ihr Vertrauen/);
      await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/rechnungsarten-${name}.png` : undefined, fullPage: false }).catch(() => {});
      // Absenden → Rechnung trägt die Art
      await page.click('form[data-form="invoice"] button[type=submit]');
      await page.waitForFunction(() => /erstellt/.test(document.querySelector('#modal.open .modal-title')?.textContent || ''), null, { timeout: 8000 });
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  it('Website: Reiter und Überschriften kommen aus den Kategorien', async () => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.post('/api/billing/categories', { name: 'Verkehrsrecht' });
    await a.post('/api/admin/fees', { category: 'verkehrsrecht', name: 'Unfallaufnahme', price: 12000 });
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await page.goto(`${srv.base}/`);
    await page.waitForSelector('.tab-btn[data-cat="verkehrsrecht"]', { state: 'attached', timeout: 15000 });
    assert.equal(await page.$eval('.tab-btn[data-cat="verkehrsrecht"]', (e) => e.textContent.trim()), 'Verkehrsrecht');
    assert.ok(await page.$('.price-category[data-category="verkehrsrecht"]'));
    await ctx.close();
  });
});
