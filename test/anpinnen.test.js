'use strict';
/*
 * Anpinnen (Merkliste): Pinnadel statt Stern, goldenes Band, die Zeile gleitet sofort an ihren Platz – ohne die Antwort des
 * Servers abzuwarten und ohne Neuladen –, beim Lösen wieder zurück, bei einem Fehler zurückgerollt. PC und Handy.
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

describe('Anpinnen (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Pinnadel, Band, sofortiges Gleiten an den Platz, Lösen, Rückrollen bei Fehler`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const ids = [];
      for (const t of ['Alpha', 'Bravo', 'Charlie', 'Delta']) ids.push((await a.post('/api/cases', { title: `${t} ${name}`, area: 'strafrecht', clientName: 'Max Muster' })).json.case.id);
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id);
        await page.evaluate(() => (location.hash = '#cases'));
        await page.waitForSelector('#caseList tr[data-id]');
        await page.waitForTimeout(500);
        const order = () => page.$$eval('#caseList tr[data-id]', (r) => r.map((x) => Number(x.dataset.id)));
        const before4 = await order();
        const last = before4[before4.length - 1];
        const btn = `#caseList [data-action="case-star"][data-id="${last}"]`;
        // Antwort des Servers künstlich verzögern: die Zeile muss trotzdem sofort wandern
        let answered = false;
        await page.route('**/api/cases/*/star', async (route) => {
          await new Promise((r) => setTimeout(r, 900));
          answered = true;
          await route.continue();
        });
        assert.equal(await page.getAttribute(btn, 'aria-pressed'), 'false');
        await page.click(btn);
        await page.waitForFunction((id) => Number(document.querySelector('#caseList tr[data-id]').dataset.id) === id, last, { timeout: 600 });
        assert.equal(answered, false, 'die Zeile ist gewandert, bevor der Server geantwortet hat');
        assert.equal(await page.evaluate((id) => document.querySelector(`#caseList tr[data-id="${id}"]`).getAnimations().length > 0, last), true, 'sie gleitet (Animation läuft)');
        assert.equal(await page.evaluate((id) => document.querySelector(`#caseList tr[data-id="${id}"]`).classList.contains('is-pinned'), last), true, 'trägt das Band');
        assert.notEqual(await page.evaluate((id) => getComputedStyle(document.querySelector(`#caseList tr[data-id="${id}"] td`)).boxShadow, last), 'none', 'goldenes Band');
        assert.equal(await page.getAttribute(btn, 'aria-pressed'), 'true');
        await page.waitForTimeout(1000);
        assert.equal((await a.get('/api/cases')).json.cases.find((c) => c.id === last).starred, true, 'gespeichert');
        assert.deepEqual((await order()).slice(1), before4.filter((id) => id !== last), 'die anderen behalten ihre Reihenfolge');
        // Lösen: zurück an den alten Platz
        await page.click(btn);
        await page.waitForFunction((l) => Number(document.querySelector('#caseList tbody tr[data-id]:last-child').dataset.id) === l, last, { timeout: 600 });
        await page.waitForTimeout(1000);
        assert.deepEqual(await order(), before4, 'wieder an der alten Stelle');
        assert.equal((await a.get('/api/cases')).json.cases.find((c) => c.id === last).starred, false);
        // Fehler: Zeile wandert, der Server lehnt ab → sie gleitet zurück, Hinweis erscheint
        await page.unroute('**/api/cases/*/star');
        await page.route('**/api/cases/*/star', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test-Fehler' }) }));
        await page.click(btn);
        await page.waitForFunction((l) => Number(document.querySelector('#caseList tbody tr[data-id]:last-child').dataset.id) === l && document.querySelector('#toasts, .toast, .ps-toast') !== null, last, { timeout: 4000 });
        assert.equal(await page.getAttribute(btn, 'aria-pressed'), 'false', 'zurückgerollt');
        assert.deepEqual(await order(), before4);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
