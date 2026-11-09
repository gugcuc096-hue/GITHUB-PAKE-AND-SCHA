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
    assert.equal(mapRadius('18px', '.panel'), '8px');
    assert.equal(mapRadius('14px', '.kpi'), '6px');
    assert.equal(mapRadius('10px', '.field'), '5px');
    assert.equal(mapRadius('999px', '.btn-gold'), '5px');
    assert.equal(mapRadius('999px', '.avatar'), null, 'Profilbilder bleiben rund');
    assert.equal(mapRadius('999px', '.status-dot'), null);
    assert.equal(mapRadius('50%', '.btn'), null);
    assert.equal(mapRadius('3px 16px 16px 16px', '.case-cover'), '3px 8px 8px 8px');
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

  it('Browser: Akte „Fall“ als Prüfansicht – Sachverhalt links, Anklagepunkte daneben (Handy: darunter), kein „Worum es geht“', { skip: !chromium && 'Playwright nicht installiert' }, async () => {
    const desc = 'Der Mandant wurde vor der Fleeca Bank festgenommen und bestreitet die Tatbeteiligung.';
    const id = (await owner.post('/api/cases', { title: 'Prüfansicht Fleeca', area: 'strafrecht', clientName: 'Paul Prüf', description: desc })).json.case.id;
    const items = (await owner.post('/api/penal/parse', { text: '§ 33 StGB' })).json.items.map((i) => ({ offenceId: i.offenceId, count: 1 }));
    assert.equal((await owner.post(`/api/cases/${id}/charges/bulk`, { items })).status, 201);
    const browser = await chromium.launch();
    try {
      for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const ctx = await browser.newContext({ viewport: vp });
        const p = await ctx.newPage();
        await p.goto(srv.base + '/login');
        await p.fill('#email', TEAM.admin);
        await p.fill('#password', PASSWORD);
        await p.click('button[type=submit]');
        await p.waitForSelector('#nav a.nav-item', { state: 'attached' });
        await p.evaluate((i) => openCase(i), id);
        await p.waitForSelector('#modalBody .case-root');
        assert.equal(await p.$('#modalBody .case-brief'), null, 'kein „Worum es geht“');
        await p.evaluate(() => caseTabSet('fall'));
        await p.waitForTimeout(300);
        const r = await p.evaluate(() => {
          const box = (s) => {
            const el = document.querySelector(s);
            const b = el && el.getBoundingClientRect();
            return b && b.height ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), bottom: Math.round(b.bottom) } : null;
          };
          return { sv: box('#modalBody #secSachverhalt'), chg: box('#modalBody #secCharges'), list: box('#modalBody #secCharges .chg-list'), sum: box('#modalBody #secCharges .chg-sum'), overview: !!document.querySelector('#modalBody .case-overview #secSachverhalt'), text: document.querySelector('#modalBody #secSachverhalt').textContent };
        });
        assert.ok(r.sv && r.chg, `Sachverhalt und Anklagepunkte im Reiter „Fall“ (${JSON.stringify(r)})`);
        assert.equal(r.overview, false, 'Sachverhalt nicht doppelt im Überblick');
        assert.match(r.text, /Fleeca Bank festgenommen/);
        assert.ok(r.list.y < r.sum.y, 'erst die Anklagepunkte, dann das Strafmaß');
        if (vp.width > 1000) {
          assert.ok(r.chg.x > r.sv.x + r.sv.w - 5, `nebeneinander (${JSON.stringify(r)})`);
          assert.ok(Math.abs(r.chg.y - r.sv.y) < 40, 'auf einer Höhe');
        } else assert.ok(r.chg.y >= r.sv.bottom - 5, `am Handy darunter (${JSON.stringify(r)})`);
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
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
      assert.equal(ruhig.btn, '5px');
      assert.equal(ruhig.btnBg, 'none', 'Knopf ohne Goldverlauf');
      assert.equal(ruhig.panel, '8px');
      assert.equal(ruhig.topbar, 'none', 'kein Glas');
      assert.notEqual(ruhig.avatar, '5px', 'Profilbilder bleiben rund');

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
