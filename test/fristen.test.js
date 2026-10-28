'use strict';
/*
 * Termin- und Fristenarten mit Rechenregel und Fristenrechner – API (Berechnung, Wochenende, Monate, Werktage,
 * Rechte, Löschen nur ohne Nutzung) und Kalender im Browser am PC und am Handy.
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

describe('Termin- und Fristenarten (API)', () => {
  let srv;
  let owner;
  let board;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    board = client(srv.base);
    await owner.login(TEAM.admin);
    await board.login(TEAM.partner);
  });
  after(() => srv.stop());

  const base = { name: 'Berufung', base: 'frist', ruleAmount: 14, ruleUnit: 'tage', ruleFrom: 'Zustellung', defaultMinutes: 0, defaultLocation: '', clientVisible: null, weekendShift: true, active: true };

  it('anlegen nur mit Recht; Regel wird als Text angezeigt', async () => {
    assert.equal((await board.post('/api/event-kinds', base)).status, 403);
    assert.equal((await owner.post('/api/event-kinds', { ...base, name: 'x' })).status, 400);
    assert.equal((await owner.post('/api/event-kinds', { ...base, base: 'gibts-nicht' })).status, 400);
    const r = await owner.post('/api/event-kinds', base);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.kind.key, 'berufung');
    assert.equal(r.json.kind.rule, '14 Tage ab Zustellung');
    assert.equal((await board.get('/api/event-kinds')).json.kinds.length, 1, 'ansehen darf die Kanzlei');
  });

  it('Fristenrechner: Tage, Wochenende → Montag, Monatsende, Werktage, Wochen', async () => {
    const calc = async (key, from) => (await owner.post(`/api/event-kinds/${key}/calc`, { from })).json;
    assert.equal((await calc('berufung', '2026-10-28')).date, '2026-11-11'); // Mittwoch
    const sat = await calc('berufung', '2026-10-24'); // + 14 Tage = Samstag 7.11. → Montag 9.11.
    assert.equal(sat.date, '2026-11-09');
    assert.equal(sat.shifted, true);
    assert.match(sat.text, /Montag, 09\.11\.2026.*Wochenende/);
    const monat = (await owner.post('/api/event-kinds', { ...base, name: 'Begründung', ruleAmount: 1, ruleUnit: 'monate', ruleFrom: 'Verkündung', weekendShift: false })).json.kind;
    assert.equal((await calc(monat.key, '2026-01-31')).date, '2026-02-28', '31. Januar + 1 Monat');
    const werk = (await owner.post('/api/event-kinds', { ...base, name: 'Fünf Werktage', ruleAmount: 5, ruleUnit: 'werktage', ruleFrom: 'Eingang', weekendShift: false })).json.kind;
    assert.equal((await calc(werk.key, '2026-10-29')).date, '2026-11-05', 'Do + 5 Werktage = Do');
    const wochen = (await owner.post('/api/event-kinds', { ...base, name: 'Zwei Wochen', ruleAmount: 2, ruleUnit: 'wochen', weekendShift: false })).json.kind;
    assert.equal((await calc(wochen.key, '2026-10-28')).date, '2026-11-11');
    assert.equal((await owner.post('/api/event-kinds/berufung/calc', { from: 'morgen' })).status, 400);
    const ohne = (await owner.post('/api/event-kinds', { ...base, name: 'Ohne Regel', ruleAmount: 0 })).json.kind;
    assert.equal((await owner.post(`/api/event-kinds/${ohne.key}/calc`, { from: '2026-10-28' })).status, 400);
  });

  it('Kalendereintrag mit Art: Grundart folgt der Art, Name steht im Eintrag; Löschen nur ohne Nutzung', async () => {
    const e = await owner.post('/api/calendar', { type: 'intern', kind: 'berufung', title: 'Berufung Doe', startsAt: new Date(Date.now() + 864e5 * 10).toISOString() });
    assert.equal(e.status, 201, e.text);
    assert.equal(e.json.event.type, 'frist', 'Grundart der Art');
    assert.equal(e.json.event.typeLabel, 'Berufung');
    assert.equal(e.json.event.kind, 'berufung');
    assert.equal((await owner.post('/api/calendar', { kind: 'gibts-nicht', title: 'x y', startsAt: new Date(Date.now() + 864e5).toISOString() })).status, 400);
    assert.equal((await owner.get('/api/calendar')).json.kinds.some((k) => k.key === 'berufung'), true);
    assert.equal((await owner.del('/api/event-kinds/berufung')).status, 409);
    await owner.put('/api/event-kinds/berufung', { ...base, active: false });
    assert.equal((await owner.get('/api/calendar')).json.kinds.some((k) => k.key === 'berufung'), false, 'ausgeblendet: nicht mehr wählbar');
    assert.equal((await owner.get('/api/calendar')).json.events.find((x) => x.id === e.json.event.id).typeLabel, 'Berufung', 'alter Eintrag behält den Namen');
    const spare = (await owner.get('/api/event-kinds')).json.kinds.find((k) => k.key === 'ohne-regel');
    assert.equal((await owner.del(`/api/event-kinds/${spare.key}`)).status, 200);
  });
});

describe('Fristenrechner im Kalender (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.post('/api/event-kinds', { name: 'Berufung', base: 'frist', ruleAmount: 14, ruleUnit: 'tage', ruleFrom: 'Zustellung', defaultMinutes: 0, defaultLocation: '', clientVisible: null, weekendShift: true, active: true });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Art „Berufung“ wählen, Zustelldatum eintragen → Fristende wird übernommen`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.evaluate(() => (location.hash = '#calendar'));
      await page.waitForSelector('[data-action="event-new"], [data-action="new-event"]', { timeout: 15000 });
      await page.click('[data-action="event-new"], [data-action="new-event"]');
      await page.waitForSelector('select[data-event-kind]');
      await page.selectOption('select[data-event-kind]', 'berufung');
      await page.waitForSelector('#evCalc:not([hidden])');
      assert.equal(await page.inputValue('#evTitle'), 'Berufung');
      assert.equal(await page.isChecked('input[name="type"][value="frist"]'), true);
      await page.fill('#evFrom', '2026-10-24');
      await page.waitForFunction(() => /Montag, 09\.11\.2026/.test(document.querySelector('#evCalcOut').textContent));
      assert.equal(await page.inputValue('#evStart'), '2026-11-09T23:59');
      await page.click('form[data-form="event"] button[type=submit]');
      await page.waitForFunction(() => !document.querySelector('#modal.open'), null, { timeout: 8000 });
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});
