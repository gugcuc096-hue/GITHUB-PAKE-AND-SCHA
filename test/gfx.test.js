'use strict';
/*
 * Grafikstufe (public/js/gfx.js + public/css/gfx.css):
 *  - Automatisch: ohne Grafikkarte (der Testbrowser zeichnet mit SwiftShader) → „mid“ (Ausgewogen): nirgends ein
 *    Weichzeichner hinter Flächen, Leuchten stehen in einer Hintergrundebene, Flächen deckend, kein Dauer-Glanz
 *  - Wächter: misst den Bildtakt des Monitors; ruckelt es (künstlich langsame Bilder), geht „auto“ eine Stufe herunter
 *    (full → mid → lite) und merkt es sich
 *  - Auch in „full“: kein (unsichtbarer) Weichzeichner auf deckenden Karten, Knöpfen und Fenster-Hintergründen,
 *    Leuchten ohne blur(150px)
 *  - Mein Profil → Animationen → Grafik: Schön / Ausgewogen / Schnell / Automatisch gilt sofort und bleibt auf dem Gerät
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, TEAM, PASSWORD } = require('./helpers');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

describe('Grafikstufe (Browser)', { skip: !chromium && 'Playwright nicht installiert' }, () => {
  let server;
  let browser;
  before(async () => {
    server = await startServer();
    browser = await chromium.launch();
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) await server.stop();
  });

  const blurred = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')}`)
    );

  it('ohne Grafikkarte automatisch „Ausgewogen“: kein Weichzeichner, stehende Leuchten, deckende Flächen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => (window.__gfxAuto = true));
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'mid');
    assert.match(await page.evaluate(() => window.PSGfx.reason), /Software|WebGL/i);
    assert.deepEqual(await blurred(page), [], 'nirgends backdrop-filter');
    const orb = await page.$eval('.glow-orb', (el) => ({ display: getComputedStyle(el).display, anim: getComputedStyle(el).animationName }));
    assert.deepEqual(orb, { display: 'none', anim: 'none' }, 'Leuchtkreise stehen als Verlauf im Hintergrund');
    assert.match(await page.$eval('.ambient-bg', (el) => getComputedStyle(el).backgroundImage), /radial-gradient/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--panel-alpha').trim()), '1', 'Flächen deckend');
    assert.deepEqual(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect.getTiming().iterations === Infinity)).length), 0, 'keine Dauer-Animationen');
    // Ergebnis gemerkt (beim nächsten Seitenaufruf kein WebGL-Test mehr)
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('ps.gfx.auto'))).mode, 'mid');
    await ctx.close();
  });

  it('Wächter: misst den Bildtakt des Monitors und geht bei Ruckeln stufenweise herunter (full → mid → lite)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      window.__gfxAuto = true;
      // gemerktes Ergebnis „mit Grafikkarte“ – dann misst der Wächter
      localStorage.setItem('ps.gfx.auto', JSON.stringify({ mode: 'full', why: 'Grafikkarte', at: Date.now(), ua: navigator.userAgent }));
      // jedes Bild künstlich ~45 ms lang (≈ 22 Bilder pro Sekunde)
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          const end = performance.now() + 45;
          while (performance.now() < end) {
            /* belasten */
          }
          cb(t);
        });
    });
    const page = await ctx.newPage();
    await page.goto(server.base + '/anwaelte');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'full');
    await page.waitForFunction(() => document.documentElement.dataset.gfx === 'mid', null, { timeout: 15000 });
    let learned = JSON.parse(await page.evaluate(() => localStorage.getItem('ps.gfx.auto')));
    assert.equal(learned.mode, 'mid');
    assert.match(learned.why, /Bildrate gemessen \(\d+ von \d+ Bildern\/s\)/);
    assert.ok((await page.evaluate(() => window.PSGfx.hz)) >= 30, 'Bildtakt des Monitors bestimmt');
    // reicht auch „Ausgewogen“ nicht: beim Scrollen weiter messen → „Schnell“
    for (let i = 0; i < 30 && (await page.evaluate(() => document.documentElement.dataset.gfx)) !== 'lite'; i++) {
      await page.mouse.wheel(0, i % 2 ? -300 : 300);
      await page.waitForTimeout(500);
    }
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'lite');
    learned = JSON.parse(await page.evaluate(() => localStorage.getItem('ps.gfx.auto')));
    assert.equal(learned.mode, 'lite');
    await ctx.close();
  });

  it('auch „full“: kein unsichtbarer Weichzeichner auf deckenden Karten, Knöpfen und Fenster-Hintergründen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('ps.gfx', 'full'));
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'full');
    const list = await blurred(page);
    for (const sel of ['glass-card', 'btn-outline']) assert.ok(!list.some((x) => x.includes(sel)), `${sel} ohne Weichzeichner: ${list.join(', ')}`);
    assert.ok(list.some((x) => x.includes('glass-nav')), 'Kopfzeile bleibt Glas');
    assert.equal(await page.$eval('.glow-orb', (el) => getComputedStyle(el).filter), 'none', 'Leuchten ohne blur(150px)');
    assert.equal(await page.$eval('#loginDialog', (el) => getComputedStyle(el).backdropFilter), 'none', 'Fenster-Hintergrund ohne Weichzeichner');
    await ctx.close();
  });

  it('Mein Profil → Grafik: Schnell / Ausgewogen / Schön / Automatisch gilt sofort und bleibt', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(server.base + '/login');
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.goto(server.base + '/dashboard#profile');
    await page.waitForSelector('[data-action="gfx-set"][data-value="lite"]');
    await page.click('[data-action="gfx-set"][data-value="lite"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'lite');
    assert.equal(await page.$eval('.topbar', (el) => getComputedStyle(el).backdropFilter), 'none');
    assert.deepEqual(await blurred(page), []);
    await page.reload();
    await page.waitForSelector('[data-action="gfx-set"][data-value="lite"].active');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'lite', 'bleibt nach dem Neuladen');
    await page.click('[data-action="gfx-set"][data-value="mid"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'mid');
    assert.deepEqual(await blurred(page), [], 'Ausgewogen: kein Weichzeichner');
    await page.waitForSelector('[data-action="gfx-set"][data-value="mid"].active');
    await page.click('[data-action="gfx-set"][data-value="full"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.gfx), 'full');
    assert.notEqual(await page.$eval('.topbar', (el) => getComputedStyle(el).backdropFilter), 'none', 'Schön: Glas in der Kopfzeile');
    await page.click('[data-action="gfx-set"][data-value="auto"]');
    assert.equal(await page.evaluate(() => localStorage.getItem('ps.gfx')), null);
    await ctx.close();
  });
});
