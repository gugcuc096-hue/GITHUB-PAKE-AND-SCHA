'use strict';
/*
 * Helle Ansicht („Weiß“): jeder Benutzer schaltet je Gerät zwischen Blau und Weiß um (Knopf in der Kopfzeile der Website
 * und des Dashboards). public/css/hell.css wird aus den Stylesheets erzeugt (scripts/build-hell.js) und nur eingeschaltet,
 * wenn die helle Ansicht gewählt ist; public/js/gfx.js setzt <html data-mode="hell"> vor dem ersten Bild.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, TEAM, PASSWORD } = require('./helpers');

const ROOT = path.join(__dirname, '..');
let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Helle Ansicht', () => {
  it('hell.css ist aktuell (npm run build:hell)', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-hell.js'), '--check'], { stdio: 'pipe' });
  });

  it('Farben werden passend umgerechnet', () => {
    const { mapValue } = require('../scripts/build-hell');
    assert.equal(mapValue('color', '#fff'), '#0f1a36', 'weiße Schrift wird dunkelblau');
    assert.equal(mapValue('background', 'rgba(255, 255, 255, 0.04)'), 'rgba(16, 26, 54, 0.05)', 'weißer Schleier wird blau');
    assert.equal(mapValue('background', '#0a1228'), '#ffffff', 'dunkle Fläche wird weiß');
    assert.equal(mapValue('color', '#0a1228'), null, 'dunkle Schrift (auf Gold) bleibt');
    assert.equal(mapValue('background', 'rgba(10, 18, 40, var(--panel-alpha, 0.74))'), 'rgba(255, 255, 255, var(--panel-alpha, 0.74))', 'Deckkraft als Variable bleibt');
    assert.equal(mapValue('background', 'var(--gold-500)'), null);
  });

  for (const page of ['index', 'dashboard', 'login', 'register', 'karriere', 'bewerbung', '404']) {
    it(`${page}.html bindet hell.css ausgeschaltet ein`, () => {
      const html = fs.readFileSync(path.join(ROOT, 'public', `${page}.html`), 'utf8');
      assert.match(html, /<link rel="stylesheet" href="\/css\/hell\.css" media="not all" data-hell>/);
      assert.ok(html.indexOf('/js/gfx.js') < html.indexOf('data-hell'), 'gfx.js läuft vor dem Stylesheet');
    });
  }

  it('alles in hell.css gilt nur in der hellen Ansicht des Designs „Ruhig“', () => {
    const postcss = require('postcss');
    postcss.parse(fs.readFileSync(path.join(ROOT, 'public', 'css', 'hell.css'), 'utf8')).walkRules((r) => {
      for (const sel of r.selectors) assert.match(sel, /^(html|:root:root)\[data-design="ruhig"\]\[data-mode="hell"\]/, sel);
    });
  });

  describe('im Browser', { skip: !chromium && 'Playwright nicht installiert' }, () => {
    let srv;
    let browser;
    before(async () => {
      srv = await startServer();
      browser = await chromium.launch();
    });
    after(async () => {
      if (browser) await browser.close();
      if (srv) await srv.stop();
    });
    const look = (p) =>
      p.evaluate(() => {
        const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
        const lum = (s) => rgb(s).reduce((a, b) => a + b, 0) / 3;
        return { mode: document.documentElement.dataset.mode || '', media: document.querySelector('link[data-hell]').media, bg: lum(getComputedStyle(document.body).backgroundColor), ink: lum(getComputedStyle(document.querySelector('h1, .page-title, .topbar-title')).color) };
      });

    it('Website: Knopf schaltet um, die Wahl bleibt nach dem Neuladen und gilt auch im Dashboard', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(srv.base + '/');
      let s = await look(p);
      assert.equal(s.mode, '');
      assert.equal(s.media, 'not all');
      assert.ok(s.bg < 60 && s.ink > 200, `Standard ist Blau: ${JSON.stringify(s)}`);
      await p.click('header [data-mode-toggle]');
      await p.waitForFunction(() => document.documentElement.dataset.mode === 'hell');
      s = await look(p);
      assert.equal(s.media, 'all');
      assert.ok(s.bg > 220 && s.ink < 80, `helle Fläche, dunkle Schrift: ${JSON.stringify(s)}`);
      await p.reload();
      s = await look(p);
      assert.equal(s.mode, 'hell', 'bleibt nach dem Neuladen');
      assert.ok(s.bg > 220);
      // Dashboard
      await p.goto(srv.base + '/login');
      await p.fill('#email', TEAM.admin);
      await p.fill('#password', PASSWORD);
      await p.click('button[type=submit]');
      await p.waitForSelector('#nav a.nav-item', { state: 'attached' });
      s = await look(p);
      assert.equal(s.mode, 'hell');
      assert.ok(s.bg > 220 && s.ink < 110, `Dashboard hell: ${JSON.stringify(s)}`);
      const panel = await p.evaluate(() => {
        const el = document.querySelector('.topbar');
        return (getComputedStyle(el).backgroundColor.match(/\d+/g) || []).slice(0, 3).map(Number);
      });
      assert.ok(panel.every((v) => v > 230), `Kopfleiste hell: ${panel}`);
      await p.click('.topbar [data-mode-toggle]');
      await p.waitForFunction(() => !document.documentElement.dataset.mode);
      s = await look(p);
      assert.ok(s.bg < 60, 'zurück zu Blau');
      assert.equal(await p.evaluate(() => localStorage.getItem('ps.mode')), null);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  });
});
