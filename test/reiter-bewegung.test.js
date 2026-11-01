'use strict';
/*
 * Weiche Reiterwechsel: Die Leiste eines Bereichs (Statistik & Protokoll) bleibt beim Wechsel stehen, der Goldstrich
 * gleitet zum neuen Reiter, die Schrift wird stufenlos kräftiger, ohne dass die Breite springt. In der Akte gleitet der
 * Strich ebenso; Chip-Leisten (Aktenfilter) bekommen eine gleitende Auswahl. Bei „Bewegung reduzieren“ springt alles.
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

describe('Weiche Reiterwechsel (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let kase;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    kase = (await a.post('/api/cases', { title: 'Raub am Juwelier', area: 'strafrecht', clientName: 'Vito Russo' })).json.case;
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });
  const login = async (page) => {
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
  };

  it('Bereich: Leiste bleibt stehen, Goldstrich gleitet, Schrift ohne Breitensprung; Akte und Filter gleiten ebenso', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#stats'));
      await page.waitForSelector('#content .hub-tabs a[href="#audit"]');
      await page.evaluate(() => {
        window.__bar = document.querySelector('#content .hub-tabs');
        window.__widths = [...window.__bar.children].map((c) => Math.round(c.getBoundingClientRect().width));
        window.__inks = 0;
        new MutationObserver((l) => l.forEach((r) => r.addedNodes.forEach((n) => n.classList && n.classList.contains('tab-ink') && window.__inks++))).observe(document.body, { childList: true, subtree: true });
      });
      await page.click('#content .hub-tabs a[href="#audit"]');
      await page.waitForFunction(() => st.view === 'audit' && document.querySelector('#content .hub-tabs a[href="#audit"]').classList.contains('active'));
      await page.waitForFunction(() => window.__inks >= 1, null, { timeout: 3000 });
      const r = await page.evaluate(() => ({
        same: window.__bar === document.querySelector('#content .hub-tabs') && window.__bar.isConnected,
        widths: [...document.querySelector('#content .hub-tabs').children].filter((c) => c.matches('a')).map((c) => Math.round(c.getBoundingClientRect().width)),
        barAnim: getComputedStyle(document.querySelector('#content .hub-tabs')).animationName,
      }));
      assert.equal(r.same, true, 'dieselbe Leiste – kein Neuzeichnen');
      assert.deepEqual(r.widths, (await page.evaluate(() => window.__widths)).slice(0, r.widths.length), 'Reiter behalten ihre Breite');
      assert.equal(r.barAnim, 'none', 'Leiste blendet nicht neu ein');
      await page.waitForFunction(() => !document.querySelector('.tab-ink'), null, { timeout: 3000 });
      assert.equal(await page.$eval('#content .hub-tabs .chip.active .tab-label', (l) => getComputedStyle(l).fontWeight), '620');

      // Akte: Strich gleitet zum Reiter „Fall“
      await page.evaluate((id) => openCase(id), kase.id);
      await page.waitForSelector('#modalBody .case-root');
      await page.waitForTimeout(500);
      await page.evaluate(() => (window.__inks = 0));
      await page.click('#modalBody [data-action="case-tab"][data-tab="fall"]');
      await page.waitForFunction(() => window.__inks >= 1, null, { timeout: 3000 });
      await page.evaluate(() => closeModal());

      // Chip-Leiste (Aktenfilter): gleitende Auswahl
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('[data-action="case-filter"].active');
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.__inks = 0));
      await page.click('[data-action="case-filter"]:not(.active) >> nth=0');
      await page.waitForFunction(() => window.__inks >= 1, null, { timeout: 3000 });
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('„Bewegung reduzieren“: kein Gleiten, Reiter wechseln sofort', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#stats'));
      await page.waitForSelector('#content .hub-tabs a[href="#audit"]');
      await page.evaluate(() => {
        window.__inks = 0;
        new MutationObserver((l) => l.forEach((r) => r.addedNodes.forEach((n) => n.classList && n.classList.contains('tab-ink') && window.__inks++))).observe(document.body, { childList: true, subtree: true });
      });
      await page.click('#content .hub-tabs a[href="#audit"]');
      await page.waitForFunction(() => st.view === 'audit');
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => window.__inks), 0);
    } finally {
      await ctx.close();
    }
  });
});
