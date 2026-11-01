'use strict';
/*
 * Weiche Wechsel (13-weich.js) und Feinschliff: Seiten, Reiter und Bereiche der Einstellungen blenden ineinander über, die
 * Reiterleiste und die Leiste der Einstellungen bleiben dieselben Elemente, ein Klick während des Wechsels geht nicht verloren,
 * Zurück/Vor stellt den Scrollstand wieder her, das Fenster dunkelt weich ein, Gold als Systemfarbe, kein Springen durch die Leiste.
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

describe('Weiche Wechsel und Feinschliff (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const adm = client(srv.base);
    await adm.login(TEAM.admin);
    const me = (await adm.get('/api/auth/session')).json.user;
    for (let i = 0; i < 30; i++) await adm.post('/api/cases', { title: `Weich-Akte ${i}`, area: 'zivilrecht', clientName: `Mandant ${i}`, lawyerId: me.id });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  const open = async (viewport = { width: 1280, height: 720 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForSelector('#nav a.nav-item');
    await page.waitForSelector('#content .page-title');
    return { ctx, page, problems };
  };
  const settled = (page) => page.waitForFunction(() => !document.documentElement.dataset.wch);

  it('Reiter eines Bereichs: die Leiste bleibt dasselbe Element, alt und neu blenden ineinander über, Klicks gehen nicht verloren', async () => {
    const { ctx, page, problems } = await open();
    try {
      await page.evaluate(() => {
        window.__vt = 0;
        const o = document.startViewTransition.bind(document);
        document.startViewTransition = (...a) => (window.__vt++, o(...a));
      });
      for (const h of ['#team', '#users', '#personnel', '#team']) {
        await page.evaluate((x) => (location.hash = x), h);
        await page.waitForTimeout(900); // erste Besuche laden, danach erscheinen die Seiten sofort
      }
      await page.waitForSelector('#content .hub-tabs');
      await page.evaluate(() => {
        window.__bar = document.querySelector('#content .hub-tabs');
        window.__vt = 0;
      });
      await page.click('#content .hub-tabs >> text=Benutzer');
      await page.waitForFunction(() => location.hash === '#users');
      assert.ok((await page.evaluate(() => window.__vt)) >= 1, 'der Wechsel läuft in einer Überblendung');
      // Sofort noch einmal klicken – mitten in der Überblendung (rohe Mausposition, ohne Warten auf den Browser)
      const box = await (await page.$('#content .hub-tabs >> text=Beförderungen')).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => location.hash === '#personnel', null, { timeout: 5000 });
      await settled(page);
      assert.equal(await page.evaluate(() => window.__bar === document.querySelector('#content .hub-tabs')), true, 'dieselbe Leiste');
      assert.match(await page.textContent('#content .page-title'), /Beförderung|Personal/i);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Einstellungen: die Leiste bleibt stehen (Suche, Scrollstand), nur der gewählte Bereich und der Inhalt daneben wechseln', async () => {
    const { ctx, page, problems } = await open({ width: 1280, height: 600 });
    try {
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('.set-nav .set-nav-item');
      await page.waitForTimeout(600);
      await page.fill('#setSearch', 'a');
      await page.evaluate(() => {
        window.__side = document.querySelector('.set-side');
        document.querySelector('.set-nav').scrollTop = 40;
      });
      const before = await page.evaluate(() => ({ key: document.querySelector('.set-nav-item.active')?.dataset.key, main: document.querySelector('.set-main')?.dataset.setSection }));
      const target = await page.$('.set-nav .set-nav-item:not(.active):not([hidden]):not(.set-nav-link)');
      const key = await target.getAttribute('data-key');
      await target.click();
      await page.waitForFunction((k) => document.querySelector('.set-main')?.dataset.setSection === k, key);
      await settled(page);
      const after = await page.evaluate(() => ({
        same: window.__side === document.querySelector('.set-side'),
        search: document.querySelector('#setSearch').value,
        active: document.querySelector('.set-nav-item.active')?.dataset.key,
        actives: document.querySelectorAll('.set-nav-item.active').length,
        current: document.querySelectorAll('.set-nav-item[aria-current="page"]').length,
        scroll: document.querySelector('.set-nav').scrollTop,
      }));
      assert.ok(after.same, 'dieselbe Leiste');
      assert.equal(after.search, 'a', 'Suchtext bleibt');
      assert.equal(after.active, key, 'neuer Bereich ist markiert');
      assert.equal(after.actives, 1);
      assert.equal(after.current, 1);
      assert.notEqual(before.key, after.active);
      assert.ok(after.scroll >= 30, `Scrollstand der Leiste bleibt (${after.scroll})`);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Akte: Reiter wechseln mit Überblendung, die Reiterleiste der Akte bleibt dasselbe Element', async () => {
    const { ctx, page, problems } = await open();
    try {
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('#content [data-action="open-case"]');
      await page.click('#content [data-action="open-case"]');
      await page.waitForSelector('#modalBody .case-root .case-jump');
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        window.__jump = document.querySelector('#modalBody .case-jump');
        window.__vt = 0;
        const o = document.startViewTransition.bind(document);
        document.startViewTransition = (...a) => (window.__vt++, o(...a));
      });
      await page.click('#modalBody .case-jump [data-action="case-tab"][data-tab="fall"]');
      await page.waitForFunction(() => document.querySelector('#modalBody .case-root')?.dataset.caseTab === 'fall');
      await settled(page);
      assert.ok((await page.evaluate(() => window.__vt)) >= 1, 'Reiterwechsel in der Akte läuft in einer Überblendung');
      assert.equal(await page.evaluate(() => window.__jump === document.querySelector('#modalBody .case-jump')), true);
      assert.equal(await page.locator('#modalBody .case-jump .active').count(), 1);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Zurück stellt den Scrollstand der Seite wieder her; das Öffnen und Schließen eines Fensters verschiebt nichts', async () => {
    const { ctx, page, problems } = await open({ width: 1280, height: 600 });
    try {
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('#content [data-action="open-case"]');
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.waitForTimeout(200);
      const y0 = await page.evaluate(() => scrollY);
      assert.ok(y0 > 300, `Liste ist lang genug (${y0})`);
      // Fenster auf und zu: nichts rutscht
      await page.click('#content [data-action="open-case"] >> nth=12');
      await page.waitForSelector('#modal.open');
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => scrollY), y0, 'Scrollstand bei offenem Fenster');
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => scrollY), y0, 'Scrollstand nach dem Schließen');
      assert.equal(await page.evaluate(() => document.documentElement.clientWidth), width, 'die Seite springt nicht seitlich (Platz der Leiste bleibt reserviert)');
      // Seite verlassen und zurück
      await page.click('#nav a[href="#tasks"]');
      await page.waitForFunction(() => location.hash === '#tasks');
      await page.waitForTimeout(800);
      assert.ok((await page.evaluate(() => scrollY)) < 50, 'neue Seite beginnt oben');
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#cases');
      await page.waitForTimeout(1200);
      const y1 = await page.evaluate(() => scrollY);
      assert.ok(Math.abs(y1 - y0) <= 3, `Liste steht wieder bei ${y0} (jetzt ${y1})`);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Fenster: Unschärfe wächst stufenlos, die Seite dahinter tritt zurück; Gold als Systemfarbe, Silbentrennung, Platz der Leiste', async () => {
    const { ctx, page, problems } = await open();
    try {
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('#content [data-action="open-case"]');
      await page.waitForTimeout(700);
      const css = await page.evaluate(() => {
        const cs = (el, p) => getComputedStyle(el)[p];
        const p = document.createElement('p');
        p.lang = 'de';
        document.querySelector('#content').append(p);
        const r = {
          gutter: cs(document.documentElement, 'scrollbarGutter'),
          accent: cs(document.documentElement, 'accentColor'),
          hyphens: cs(p, 'hyphens'),
          wrap: cs(p, 'textWrapStyle'),
          h1: cs(document.querySelector('.page-title'), 'textWrapStyle'),
          caret: cs(document.body.appendChild(Object.assign(document.createElement('input'), { type: 'text' })), 'caretColor'),
        };
        p.remove();
        return r;
      });
      assert.match(css.gutter, /stable/);
      assert.notEqual(css.accent, 'auto');
      assert.equal(css.hyphens, 'auto');
      assert.equal(css.wrap, 'pretty');
      assert.equal(css.h1, 'balance');
      assert.match(css.caret, /rgb\(212, 175, 55\)|rgb\(\d+, \d+, \d+\)/);
      await page.click('#content [data-action="open-case"]');
      await page.waitForSelector('#modal.open');
      const names = await page.evaluate(() => document.querySelector('#modal').getAnimations().map((a) => a.animationName));
      assert.ok(names.includes('modal-blur-in'), `Unschärfe wächst (Animationen: ${names})`);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#content')).scale), '0.992', 'Seite dahinter tritt minimal zurück');
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#content')).scale), 'none', 'danach wieder normal');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
