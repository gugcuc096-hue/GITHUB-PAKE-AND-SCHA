'use strict';
/*
 * Kopfzeile der Website wie die Kopfleiste des Dashboards: angemeldet ein runder Knopf mit Profilbild (ins Dashboard), am PC
 * dazu der Umschalter Website/Dashboard, kein Umschalter in der Leiste oben; der Menü-Indikator im Dashboard gleitet nicht mehr.
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
    it(`${name}: angemeldet ${hidden ? 'Umschalter Website/Dashboard und Profilbild wie im Dashboard' : 'Profilbild in der Kopfzeile, kein Umschalter'}; Indikator ohne Gleiten`, async () => {
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
        await page.waitForFunction(() => document.documentElement.classList.contains('ps-team'));
        // wie die Kopfleiste des Dashboards: rund mit Profilbild (führt ins Dashboard), am PC dazu der Umschalter
        assert.equal(await page.isVisible('header [data-hdr-auth]'), true);
        assert.equal(await page.locator('header [data-hdr-auth] .hdr-av').count(), 1, 'Profilbild im Knopf');
        assert.match(await page.getAttribute('header [data-hdr-auth]', 'href'), /\/dashboard$/);
        assert.equal(await page.$('.topstrip .site-switch'), null, 'kein Umschalter in der Leiste oben');
        assert.equal(await page.locator('[data-hdr-dash]').count(), 0, 'kein zweiter Dashboard-Knopf');
        assert.equal(await page.isVisible('header .site-switch'), hidden, 'Umschalter nur am PC');
        if (hidden) {
          assert.equal(await page.isVisible('header .site-switch a[href="/dashboard"]'), true);
          assert.equal(await page.isVisible('header button[data-act="ticket"]'), false, 'Kanzlei: kein „Mandat anfragen“');
        }
      } finally {
        await ctx.close();
      }
    });
  }
});
