'use strict';
/*
 * Kopfzeile der Website: angemeldet gibt es nur noch den Umschalter „Website | Dashboard“ oben (kein zweiter Dashboard-Knopf in
 * der Kopfzeile, am Handy bleibt der Knopf); der Menü-Indikator im Dashboard gleitet nicht mehr zwischen den Punkten.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Kopfzeile und Menü-Indikator (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  for (const [name, viewport, hidden] of [
    ['PC', { width: 1366, height: 800 }, true],
    ['Handy', { width: 390, height: 844 }, false],
  ]) {
    it(`${name}: angemeldet ${hidden ? 'nur der Umschalter oben, kein zweiter Dashboard-Knopf' : 'bleibt der Dashboard-Knopf in der Kopfzeile'}; Indikator ohne Gleiten`, async () => {
      const ctx = await browser.newContext({ viewport, locale: 'de-DE' });
      const page = await ctx.newPage();
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForSelector('#nav a.nav-item.active');
        // das Menü zeichnet sich nach dem Start noch einmal neu – auf den fertigen Indikator warten
        const ind = await (await page.waitForFunction(() => {
          const e = document.querySelector('#nav .nav-ind');
          return e && e.isConnected ? getComputedStyle(e).transitionDuration : '';
        })).jsonValue();
        assert.match(ind, /^0s(, 0s)*$/, 'Indikator springt statt zu gleiten');
        await page.goto(`${srv.base}/`);
        await page.waitForFunction(() => document.documentElement.classList.contains('ps-in'), null, { timeout: 15000 });
        const shown = await page.$eval('[data-hdr-auth]', (e) => getComputedStyle(e).display !== 'none');
        assert.equal(shown, !hidden);
        if (hidden) assert.equal(await page.locator('.site-switch').isVisible(), true, 'der Umschalter oben bleibt');
      } finally {
        await ctx.close();
      }
    });
  }
});
