'use strict';
/*
 * Website und Dashboard aus einem Guss, Startseite auf der Seite anpassen:
 *  - gemeinsame Werte (tokens.css) auf Website und Dashboard, Symbole aus dem Dashboard, kein Siegel mehr
 *  - Startseite: Abschnitte (Reihenfolge, ausblenden), Rechtsgebiete, Anwälte, Meldungen, Startbereich – beim Ausliefern
 *  - Bearbeitungsmodus (?bearbeiten): ausgeblendete Abschnitte bleiben markiert sichtbar
 *  - Team-Schnittstelle: Schwerpunkte automatisch aus den Akten, wenn keine eingetragen sind
 *  - Browser: „Startseite anpassen“ veröffentlicht; der goldene Strich gleitet beim Seitenwechsel von der alten Stelle
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

describe('Startseite anpassen und gemeinsames Design', () => {
  let server;
  const admin = { c: null };
  before(async () => {
    server = await startServer();
    admin.c = client(server.base);
    await admin.c.login(TEAM.admin);
  });
  after(async () => {
    if (server) await server.stop();
  });
  const page = async (p) => (await fetch(server.base + p)).text();
  const publish = async (start) => {
    const cfg = (await admin.c.get('/api/config')).json.config.home;
    const base = cfg.draft || cfg.published;
    const r = await admin.c.put('/api/config/home/draft', { ...base, start: { ...cfg.defaults.start, ...start } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await admin.c.post('/api/config/home/publish')).status, 200);
  };
  const order = (html) => [...html.matchAll(/data-start="([a-z]+)"/g)].map((m) => m[1]);

  it('gemeinsame Werte, Symbole aus dem Dashboard, kein Siegel', async () => {
    const home = await page('/');
    const dash = await page('/dashboard');
    for (const h of [home, dash]) assert.match(h, /href="\/css\/tokens\.css[^"]*"/, 'tokens.css eingebunden');
    const tokens = await (await fetch(`${server.base}/css/tokens.css`)).text();
    for (const v of ['--radius', '--sh-2', '--sp-3', '--fs-xl', '--ease-out', '--dur-2']) assert.ok(tokens.includes(v), v);
    assert.doesNotMatch(await (await fetch(`${server.base}/css/app.css`)).text(), /:root\s*\{/, 'app.css ohne eigene Werte');
    assert.doesNotMatch(home, /kz-seal|kzSeal/, 'kein Siegel');
    assert.match(home, /<svg class="kz-ico"/, 'Symbole eingesetzt');
    assert.doesNotMatch(home, /<!--icon:/);
    assert.match(home, /class="kz-shine"[^>]*>Recht bekommen\./);
    assert.match(home, /nav class="kz-nav[^"]*" data-ink/, 'Menü mit goldenem Strich');
    assert.match(home, /@view-transition \{ navigation: auto; \}/, 'weiche Seitenwechsel auf der Website');
    assert.doesNotMatch(await page('/login'), /@view-transition \{ navigation: auto/, 'Anmeldung macht nicht mit');
    // Standard: Ablauf steht nur auf der Kanzlei-Seite, die Startseite hat Eckdaten, Rechtsgebiete, Anwälte, Aktuelles, Abschluss
    assert.deepEqual(order(home), ['fakten', 'gebiete', 'ansprechpartner', 'neuigkeiten', 'band']);
    assert.match(home, /id="factAreas">4</);
  });

  it('Einstellungen der Startseite wirken beim Ausliefern', async () => {
    await publish({ order: ['band', 'gebiete', 'ansprechpartner', 'fakten', 'neuigkeiten', 'ablauf'], hidden: ['neuigkeiten'], areas: ['vertragsrecht', 'strafrecht'], lawyerMode: 'auswahl', lawyers: [3, 1], lawyerCount: 2, newsCount: 5, heroSecond: 'anwaelte', heroNote: false });
    const home = await page('/');
    assert.deepEqual(order(home), ['band', 'gebiete', 'ansprechpartner', 'fakten', 'ablauf']);
    const tiles = [...home.match(/<section id="gebiete"[\s\S]*?<\/section>/)[0].matchAll(/data-area="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(tiles, ['vertragsrecht', 'strafrecht']);
    assert.match(home, /id="leadGrid" class="kz-people" data-mode="auswahl" data-count="2" data-ids="3,1"/);
    assert.doesNotMatch(home, /id="newsTeaser"/, 'Aktuelles ausgeblendet');
    assert.match(home, /<a href="\/anwaelte" class="btn-outline kz-btn is-lg" data-hero-second="anwaelte">Unsere Anwälte<\/a>/);
    assert.doesNotMatch(home, /kz-hero-note/);
    // Die anderen Seiten bleiben unberührt (Ablauf auf der Kanzlei-Seite, alle Rechtsgebiete)
    assert.match(await page('/kanzlei'), /id="ablauf"/);
    assert.equal([...(await page('/rechtsgebiete')).matchAll(/class="kz-tile" data-area=/g)].length, 4);
    // Bearbeitungsmodus: Ausgeblendetes bleibt markiert sichtbar, alle Rechtsgebiete zum Auswählen
    const edit = await page('/?bearbeiten');
    assert.match(edit, /<section data-sc-hidden id="neuigkeiten"/);
    assert.equal([...edit.match(/<section id="gebiete"[\s\S]*?<\/section>/)[0].matchAll(/data-area=/g)].length, 4);
    assert.match(edit, /kz-hero-note" hidden/);
    // Ohne zweiten Knopf
    await publish({ heroSecond: 'keiner' });
    assert.doesNotMatch(await page('/'), /data-hero-second/);
    // Ungültiges wird abgelehnt
    const cfg = (await admin.c.get('/api/config')).json.config.home;
    const bad = await admin.c.put('/api/config/home/draft', { ...cfg.published, start: { ...cfg.published.start, lawyerCount: 40 } });
    assert.equal(bad.status, 400);
    // zurück auf Standard
    await publish({});
    assert.deepEqual(order(await page('/')), ['fakten', 'gebiete', 'ansprechpartner', 'neuigkeiten', 'band']);
  });

  it('Anwalts-Karten: Schwerpunkte automatisch aus den Akten, wenn keine eingetragen sind', async () => {
    const team = (await admin.c.get('/api/admin/team')).json.team;
    const me = (await admin.c.get('/api/auth/session')).json.user;
    const row = (team || []).find((t) => t.userId === me.id);
    assert.ok(row, 'Board-Mitglied im Team');
    for (let i = 0; i < 2; i++) assert.equal((await admin.c.post('/api/cases', { title: `Schwerpunkt ${i}`, area: 'vertragsrecht', clientName: 'Viktor Vertrag', lawyerId: me.id })).status, 201);
    if (row.focus && row.focus.length) return; // eingetragene Schwerpunkte haben Vorrang
    const pub = (await fetch(`${server.base}/api/team`).then((r) => r.json())).team.find((t) => t.id === row.id);
    assert.ok(pub.focus.includes('Vertragsrecht'), JSON.stringify(pub.focus));
    assert.equal(pub.focusAuto, true);
  });

  it('Browser: Startseite auf der Seite anpassen und goldener Strich gleitet beim Seitenwechsel', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const p = await ctx.newPage();
    const problems = [];
    p.on('pageerror', (e) => problems.push(e.message));
    try {
      await p.goto(`${server.base}/login`);
      await p.fill('#email', TEAM.admin);
      await p.fill('#password', PASSWORD);
      await p.click('button[type=submit]');
      await p.waitForURL(/dashboard/);
      await p.goto(`${server.base}/?bearbeiten`);
      await p.click('#scOpen');
      await p.waitForSelector('.sc-drawer.is-open');
      // „Eckdaten“ ausblenden (zeigt sich sofort), Aktuelles: 2 Meldungen
      await p.uncheck('.sc-drawer input[data-g="sections"][data-k="fakten"]');
      assert.equal(await p.getAttribute('#fakten', 'data-sc-hidden'), '');
      await p.click('.sc-drawer [data-count="newsCount"][data-d="-1"]');
      // Anwälte: eigene Auswahl
      await p.check('.sc-drawer input[name="scMode"][value="auswahl"]');
      await p.waitForSelector('.sc-drawer input[data-g="lawyers"]');
      await p.click('.sc-drawer [data-publish]');
      await p.waitForFunction(() => /Veröffentlicht/.test(document.querySelector('.sc-drawer .sc-state')?.textContent || ''));
      const home = (await admin.c.get('/api/config')).json.config.home.published.start;
      assert.ok(home.hidden.includes('fakten'));
      assert.equal(home.newsCount, 2);
      assert.equal(home.lawyerMode, 'auswahl');
      await p.goto(`${server.base}/`);
      assert.equal(await p.locator('#fakten').count(), 0, 'Eckdaten weg');
      // Abschnitt-Leiste: „nach oben“ verschiebt sofort
      await p.goto(`${server.base}/?bearbeiten`);
      await p.waitForSelector('#ansprechpartner > .sc-chip');
      await p.click('#ansprechpartner > .sc-chip [data-sc="up"]');
      assert.deepEqual(await p.$$eval('main [data-start]', (els) => els.map((e) => e.dataset.start).slice(0, 3)), ['fakten', 'ansprechpartner', 'gebiete'], 'Eckdaten bleiben ausgeblendet sichtbar');
      await p.goto(`${server.base}/?bearbeiten`); // nicht veröffentlicht → unverändert (Rückfrage beim Verlassen wird übersprungen)
      await publishDefault();

      // Goldener Strich: auf /anwaelte gemerkt, auf /kontakt startet er dort und gleitet unter „Kontakt“
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
      const q = await ctx2.newPage();
      await q.goto(`${server.base}/anwaelte`);
      await q.waitForFunction(() => sessionStorage.getItem('ps.ink'));
      const from = JSON.parse(await q.evaluate(() => sessionStorage.getItem('ps.ink')));
      await q.click('header nav a[data-nav="kontakt"]');
      await q.waitForURL(/\/kontakt$/);
      await q.waitForFunction(() => {
        const ink = document.querySelector('header nav .nav-ink');
        const a = document.querySelector('header nav a[data-nav="kontakt"]');
        return ink && a && Math.abs(ink.getBoundingClientRect().left - a.getBoundingClientRect().left) < 2;
      });
      const to = JSON.parse(await q.evaluate(() => sessionStorage.getItem('ps.ink')));
      assert.ok(to.x > from.x, 'Stelle von Kontakt liegt rechts von Anwälte');
      await ctx2.close();
      assert.deepEqual(problems, []);
    } finally {
      await browser.close();
    }
    async function publishDefault() {
      const cfg = (await admin.c.get('/api/config')).json.config.home;
      await admin.c.put('/api/config/home/draft', { ...cfg.published, start: cfg.defaults.start });
      await admin.c.post('/api/config/home/publish');
    }
  });
});
