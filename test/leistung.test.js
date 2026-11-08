'use strict';
/*
 * Flüssig ohne Grafikkarte (Browser):
 *  - Glanz über „Recht bekommen.“ ist eine eigene Ebene, die nur verschoben wird (transform), kein Dauer-Glanz in „Ausgewogen“
 *  - Karten: der größere Schatten beim Darüberfahren liegt fertig in ::before und wird nur eingeblendet
 *  - „Schnell“: Seitenwechsel der Website ohne Überblendung
 *  - Live-Aktualisierung: im Hintergrund-Tab wird nichts gezeichnet, beim Zurückkehren einmal
 *  - Tatort-Karte nur im Kanzlei-Bündel, 3D erst bei Bedarf (siehe website.test.js)
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

describe('Leistung ohne Grafikkarte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let server;
  let browser;
  before(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    // Glanz und Hover-Schatten gibt es nur im Design „Klassisch“ (im Design „Ruhig“ ist alles flach)
    const owner = client(server.base);
    await owner.login(TEAM.admin);
    await owner.put('/api/config/style/draft', { design: 'klassisch', preset: 'gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'aus', seasonDash: true });
    await owner.post('/api/config/style/publish', {});
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) await server.stop();
  });
  const ctxWith = async (gfx) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    if (gfx) await ctx.addInitScript((g) => localStorage.setItem('ps.gfx', g), gfx);
    return ctx;
  };

  it('Glanz: eigene Ebene, nur verschoben; „Schön“ wiederholt, „Ausgewogen“ einmal, „Schnell“ gar nicht', async () => {
    for (const [gfx, expect] of [['full', true], ['mid', true], ['lite', false]]) {
      const ctx = await ctxWith(gfx);
      const page = await ctx.newPage();
      await page.goto(server.base + '/');
      await page.waitForSelector('.kz-shine .kz-shine-band', { state: 'attached' });
      // nach dem Einblenden läuft der Glanz einmal (nicht in „Schnell“)
      const seen = await page
        .waitForFunction(() => document.querySelector('.kz-shine-band').getAnimations().length > 0, null, { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      assert.equal(seen, expect, `${gfx}: Glanz läuft`);
      if (seen) {
        const props = await page.evaluate(() => document.querySelector('.kz-shine-band').getAnimations().flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))));
        assert.deepEqual([...new Set(props)], ['transform'], 'nur verschieben – kein Neumalen');
      }
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.kz-shine')).animationName), 'none', 'Schrift selbst ohne Animation');
      assert.equal(await page.evaluate(() => document.querySelector('.kz-shine').textContent.includes('in Los Santos.')), true);
      await ctx.close();
    }
  });

  it('Karten: Hover-Schatten liegt fertig in ::before und wird nur eingeblendet', async () => {
    const ctx = await ctxWith('full');
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    const tile = page.locator('#gebiete .kz-tile > a').first();
    await tile.scrollIntoViewIfNeeded();
    const before = await tile.evaluate((a) => ({ shadow: getComputedStyle(a, '::before').boxShadow, opacity: getComputedStyle(a, '::before').opacity, trans: getComputedStyle(a).transitionProperty }));
    assert.notEqual(before.shadow, 'none');
    assert.equal(before.opacity, '0');
    assert.doesNotMatch(before.trans, /box-shadow|all/, 'der Schatten der Karte selbst gleitet nicht');
    await page.waitForTimeout(900); // Karten sind fertig eingeblendet (sie gleiten beim Erscheinen hoch)
    const box = await tile.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#gebiete .kz-tile > a'), '::before').opacity === '1');
    await ctx.close();
  });

  it('„Ausgewogen“/„Schnell“: Farben wechseln sofort, nur Verschieben und Einblenden gleiten', async () => {
    for (const gfx of ['mid', 'lite']) {
      const ctx = await ctxWith(gfx);
      const page = await ctx.newPage();
      await page.goto(server.base + '/');
      const props = await page.$$eval('.btn-gold, .btn-outline, .kz-tile > a, .kz-link', (els) => [...new Set(els.flatMap((e) => getComputedStyle(e).transitionProperty.split(', ')))]);
      assert.ok(props.every((p) => ['transform', 'opacity'].includes(p)), `${gfx}: ${props.join(', ')}`);
      await ctx.close();
    }
  });

  it('„Schnell“: Seitenwechsel ohne Überblendung (übersprungen), „Schön“ mit', async () => {
    // Der Testbrowser (headless) führt Überblendungen zwischen Seiten nicht aus – geprüft wird, wer sie überspringt
    for (const [gfx, skipped] of [['lite', true], ['full', false]]) {
      const ctx = await ctxWith(gfx);
      await ctx.addInitScript(() => {
        if (!window.ViewTransition) return;
        const orig = ViewTransition.prototype.skipTransition;
        ViewTransition.prototype.skipTransition = function () {
          sessionStorage.setItem('vtSkip', '1');
          return orig.call(this);
        };
      });
      const page = await ctx.newPage();
      await page.goto(server.base + '/kanzlei');
      assert.equal(await page.evaluate(() => typeof window.ViewTransition), 'function');
      await page.click('header nav a[data-nav="anwaelte"]');
      await page.waitForURL(/\/anwaelte$/);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('vtSkip') === '1'), skipped, `${gfx}: übersprungen`);
      await ctx.close();
    }
  });

  it('Live-Aktualisierung: im Hintergrund-Tab nichts zeichnen, beim Zurückkehren einmal', async () => {
    const ctx = await ctxWith(null);
    const page = await ctx.newPage();
    await page.goto(server.base + '/login');
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => typeof liveLater === 'function');
    const n = await page.evaluate(async () => {
      let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      let runs = 0;
      liveLater('test-a', () => runs++, 10);
      liveLater('test-a', () => runs++, 10); // dieselbe Meldung zweimal → einmal
      liveLater('test-b', () => runs++, 10);
      await new Promise((r) => setTimeout(r, 120));
      const whileHidden = runs;
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      delete document.hidden;
      return [whileHidden, runs];
    });
    assert.deepEqual(n, [0, 2]);
    await ctx.close();
  });
});
