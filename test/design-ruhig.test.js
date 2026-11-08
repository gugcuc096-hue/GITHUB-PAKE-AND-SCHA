'use strict';
/*
 * Design „Ruhig“ (Standard) und das bisherige Design „Klassisch“ (Einstellungen → Stil & Saison → Design):
 *  - ruhig-formen.css passt zum Stand der Stylesheets (scripts/build-ruhig.js), beide Ebenen auf allen Seiten zuletzt
 *  - der Server setzt <html data-design="ruhig|klassisch"> schon beim Ausliefern; alte gespeicherte Stile ohne Design
 *    bleiben gültig (und werden „Ruhig“)
 *  - Browser: „Ruhig“ = eckig, flach, kein Glas; „Klassisch“ = die alten Rundungen und Glas – unverändert
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

const ROOT = path.join(__dirname, '..');
const STYLE = { preset: 'gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'aus', seasonDash: true };

describe('Design „Ruhig“: Dateien', () => {
  it('ruhig-formen.css ist aktuell (npm run build:ruhig)', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ruhig.js'), '--check'], { stdio: 'pipe' });
  });

  it('Rundungen: groß → klein, Kreise und runde Dinge bleiben', () => {
    const { mapRadius } = require('../scripts/build-ruhig');
    assert.equal(mapRadius('18px', '.panel'), '6px');
    assert.equal(mapRadius('14px', '.kpi'), '5px');
    assert.equal(mapRadius('10px', '.field'), '4px');
    assert.equal(mapRadius('999px', '.btn-gold'), '4px');
    assert.equal(mapRadius('999px', '.avatar'), null, 'Profilbilder bleiben rund');
    assert.equal(mapRadius('999px', '.status-dot'), null);
    assert.equal(mapRadius('50%', '.btn'), null);
    assert.equal(mapRadius('3px 16px 16px 16px', '.case-cover'), '3px 6px 6px 6px');
  });

  for (const page of ['dashboard', 'index', 'karriere', 'login', 'register', 'bewerbung', '404']) {
    it(`${page}.html lädt ruhig-formen.css und ruhig.css als letzte Stylesheets`, () => {
      const html = fs.readFileSync(path.join(ROOT, 'public', `${page}.html`), 'utf8');
      const links = [...html.matchAll(/<link rel="stylesheet" href="\/css\/([\w.-]+)"/g)].map((m) => m[1]).filter((f) => f !== 'calm.css');
      assert.deepEqual(links.slice(-3), ['gfx.css', 'ruhig-formen.css', 'ruhig.css']);
    });
  }

  it('alles in ruhig.css gilt nur unter html[data-design="ruhig"]', () => {
    const postcss = require('postcss');
    const root = postcss.parse(fs.readFileSync(path.join(ROOT, 'public', 'css', 'ruhig.css'), 'utf8'));
    root.walkRules((r) => {
      for (const sel of r.selectors) assert.match(sel, /^(html\[data-design="ruhig"\]|:root:root\[data-design="ruhig"\])/, sel);
    });
  });
});

describe('Design „Ruhig“: Server und Browser', () => {
  let srv;
  let owner;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    await owner.login(TEAM.admin);
  });
  after(async () => srv && srv.stop());

  const page = async (p) => (await fetch(`${srv.base}${p}`)).text();
  const publish = async (style) => {
    assert.equal((await owner.put('/api/config/style/draft', style)).status, 200);
    assert.equal((await owner.post('/api/config/style/publish', {})).status, 200);
  };

  it('Standard ist „Ruhig“; „Klassisch“ lässt sich einschalten und wieder ausschalten', async () => {
    for (const p of ['/', '/dashboard', '/karriere', '/login']) assert.match(await page(p), /<html data-design="ruhig"/, p);
    await publish({ ...STYLE, design: 'klassisch' });
    for (const p of ['/', '/dashboard', '/karriere', '/login']) assert.match(await page(p), /<html data-design="klassisch"/, p);
    assert.equal((await client(srv.base).get('/api/auth/session')).json.siteConfig.style.design, 'klassisch');
    await publish({ ...STYLE, design: 'ruhig' });
    assert.match(await page('/'), /<html data-design="ruhig"/);
    // Gespeicherter Stil von vorher (ohne Design) bleibt gültig – Farbe bleibt, Design wird „Ruhig“
    await publish({ ...STYLE, accent: '#34d399', preset: 'eigen' });
    const html = await page('/');
    assert.match(html, /<html data-design="ruhig"/);
    assert.match(html, /--gold-500: #34d399/);
    await publish({ ...STYLE, design: 'ruhig' });
  });

  it('Browser: „Ruhig“ ist eckig und flach, „Klassisch“ behält Rundungen und Glas', { skip: !chromium && 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch();
    try {
      const look = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(() => localStorage.setItem('ps.gfx', 'full'));
        const p = await ctx.newPage();
        await p.goto(srv.base + '/login');
        await p.fill('#email', TEAM.admin);
        await p.fill('#password', PASSWORD);
        await p.click('button[type=submit]');
        await p.waitForSelector('#nav a.nav-item', { state: 'attached' });
        const r = await p.evaluate(() => {
          const cs = (s) => getComputedStyle(document.querySelector(s));
          return {
            design: document.documentElement.dataset.design,
            btn: cs('.btn-gold').borderTopLeftRadius,
            btnBg: cs('.btn-gold').backgroundImage,
            panel: cs('.panel').borderTopLeftRadius,
            topbar: cs('.topbar').backdropFilter,
            avatar: cs('.avatar').borderTopLeftRadius,
          };
        });
        await ctx.close();
        return r;
      };
      const ruhig = await look();
      assert.equal(ruhig.design, 'ruhig');
      assert.equal(ruhig.btn, '4px');
      assert.equal(ruhig.btnBg, 'none', 'Knopf ohne Goldverlauf');
      assert.equal(ruhig.panel, '6px');
      assert.equal(ruhig.topbar, 'none', 'kein Glas');
      assert.notEqual(ruhig.avatar, '4px', 'Profilbilder bleiben rund');

      await publish({ ...STYLE, design: 'klassisch' });
      const klassisch = await look();
      assert.equal(klassisch.design, 'klassisch');
      assert.ok(parseFloat(klassisch.btn) > 20, `Pillen-Knopf wie bisher (${klassisch.btn})`);
      assert.match(klassisch.btnBg, /gradient/);
      assert.equal(klassisch.panel, '18px');
      assert.notEqual(klassisch.topbar, 'none', 'Glas wie bisher');
    } finally {
      await browser.close();
      await publish({ ...STYLE, design: 'ruhig' });
    }
  });
});
