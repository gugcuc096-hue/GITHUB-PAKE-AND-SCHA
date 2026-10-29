'use strict';
/*
 * Ansicht der Akte anpassen: Abschnitte umsortieren, ausblenden, einklappen – je Person gespeichert, Standardansicht je
 * Rechtsgebiet vom Board. API (Einstellungen, Rechte, Prüfung) und Browser (PC und Handy).
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

describe('Ansicht der Akte (API)', () => {
  let srv;
  let admin;
  let anwalt;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    anwalt = client(srv.base);
    await admin.login(TEAM.admin);
    await anwalt.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  it('eigene Ansicht speichern, lesen, zurücksetzen; falsche Abschnitte werden abgelehnt; Mandanten haben keinen Zugriff', async () => {
    assert.equal((await client(srv.base).get('/api/prefs/case-sections')).status, 401);
    const first = (await anwalt.get('/api/prefs/case-sections')).json;
    assert.equal(first.mine, null);
    assert.equal(first.board, false);
    const view = { order: ['witnesses', 'karte', 'evidence'], hidden: ['work'], collapsed: ['invoices'] };
    assert.equal((await anwalt.put('/api/prefs/case-sections', view)).status, 200);
    const back = (await anwalt.get('/api/prefs/case-sections')).json.mine;
    assert.deepEqual(back, view);
    assert.equal((await anwalt.put('/api/prefs/case-sections', { order: ['quatsch'] })).status, 400);
    assert.equal((await admin.get('/api/prefs/case-sections')).json.mine, null, 'jede Person hat ihre eigene Ansicht');
    assert.equal((await anwalt.del('/api/prefs/case-sections')).status, 200);
    assert.equal((await anwalt.get('/api/prefs/case-sections')).json.mine, null);
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Mia Mandantin', email: 'mia.ansicht', password: 'Mandanten-Passwort-5' });
    await m.login('mia.ansicht', 'Mandanten-Passwort-5');
    assert.equal((await m.get('/api/prefs/case-sections')).status, 403);
  });

  it('Standardansicht je Rechtsgebiet: nur das Board; gilt für alle ohne eigene Ansicht', async () => {
    const view = { order: ['karte', 'witnesses', 'chat'], hidden: ['briefs'], collapsed: [] };
    assert.equal((await anwalt.put('/api/prefs/case-sections/default/strafrecht', view)).status, 403);
    assert.equal((await admin.put('/api/prefs/case-sections/default/gibtsnicht', view)).status, 404);
    assert.equal((await admin.put('/api/prefs/case-sections/default/strafrecht', view)).status, 200);
    const seen = (await anwalt.get('/api/prefs/case-sections')).json;
    assert.deepEqual(seen.defaults.strafrecht, view);
    assert.equal((await admin.get('/api/prefs/case-sections')).json.board, true);
    assert.equal((await anwalt.del('/api/prefs/case-sections/default/strafrecht')).status, 403);
    assert.equal((await admin.del('/api/prefs/case-sections/default/strafrecht')).status, 200);
    assert.equal((await anwalt.get('/api/prefs/case-sections')).json.defaults.strafrecht, undefined);
  });
});

describe('Ansicht der Akte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: umsortieren, ausblenden, einklappen – bleibt nach dem Neuöffnen; Zurücksetzen`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const id = (await a.post('/api/cases', { title: `Ansicht ${name}`, area: 'strafrecht', clientName: 'Max Muster' })).json.case.id;
      await a.post(`/api/cases/${id}/parties`, { role: 'zeuge', name: 'Fritz Falkenhagen' });
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      const order = () => page.$$eval('#caseSections > .sec-wrap', (w) => w.map((x) => x.dataset.sec));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => typeof openCase === 'function' && st.user && st.user.id);
        await page.evaluate((i) => openCase(i), id);
        await page.waitForSelector('#caseSections');
        const base = await order();
        assert.ok(base.indexOf('witnesses') > base.indexOf('events'), 'Grundreihenfolge: Zeugen nach Terminen');
        // Anpassen: Zeugen zweimal nach oben, „Zeiten“ ausblenden, „Verlauf“ einklappen
        await page.click('[data-action="sec-edit"].jump-edit');
        await page.waitForSelector('#caseSections.is-editing .sec-editbar');
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="witnesses"] .sec-body'), false, 'beim Anpassen nur Leisten');
        const w = '#caseSections .sec-wrap[data-sec="witnesses"]';
        await page.click(`${w} [data-action="sec-move"][data-dir="-1"]`);
        await page.click(`${w} [data-action="sec-move"][data-dir="-1"]`);
        await page.click('#caseSections .sec-wrap[data-sec="work"] [data-action="sec-hide"]');
        await page.click('#caseSections .sec-wrap[data-sec="notes"] [data-action="sec-fold"]');
        const moved = await order();
        assert.equal(moved.indexOf('witnesses'), base.indexOf('witnesses') - 2);
        await page.click('.sec-editbar [data-action="sec-edit"]');
        // gespeichert (verzögert) und in der Sprungleiste wiedergegeben
        for (let i = 0; i < 40 && !(await a.get('/api/prefs/case-sections')).json.mine?.hidden?.includes('work'); i++) await page.waitForTimeout(150);
        assert.deepEqual((await a.get('/api/prefs/case-sections')).json.mine?.order.slice(0, base.length), moved, 'gespeichert');
        const jumps = await page.$$eval('.case-jump-list .jump:not([hidden])', (b) => b.map((x) => x.dataset.secJump));
        assert.ok(jumps.indexOf('witnesses') < jumps.indexOf('events') || !jumps.includes('events'), 'Sprungleiste folgt der Reihenfolge');
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="work"]'), false, 'ausgeblendet');
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="notes"] .sec-body'), false, 'eingeklappt');
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="notes"] .sec-folded'), true);
        await page.click('#caseSections .sec-wrap[data-sec="notes"] .sec-folded');
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="notes"] .sec-body'), true, 'ein Klick klappt kurz auf');
        // Neu laden und öffnen: die Ansicht ist dieselbe
        await page.reload();
        await page.waitForFunction(() => typeof openCase === 'function' && st.user && st.user.id);
        await page.evaluate((i) => openCase(i), id);
        await page.waitForSelector('#caseSections');
        assert.deepEqual(await order(), moved);
        assert.equal(await page.isVisible('#caseSections .sec-wrap[data-sec="work"]'), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        // Zurücksetzen: Grundreihenfolge
        await page.click('[data-action="sec-edit"].jump-edit');
        await page.click('.sec-editbar [data-action="sec-reset"]');
        await page.waitForFunction((b) => JSON.stringify([...document.querySelectorAll('#caseSections > .sec-wrap')].map((x) => x.dataset.sec)) === JSON.stringify(b), base, { timeout: 8000 });
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
