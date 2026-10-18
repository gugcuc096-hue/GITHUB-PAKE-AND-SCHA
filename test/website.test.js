'use strict';
/*
 * Website selbst pflegen: Ränge (Einstellungen → Ränge), Website-Texte im Bearbeitungsmodus,
 * Vorschaubild für Discord-Links, Einarbeitung neuer Anwälte und automatisches Aufräumen.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM } = require('./helpers');

describe('Website & Ränge selbst pflegen', () => {
  let server;
  const as = {};
  before(async () => {
    server = await startServer();
    as.admin = client(server.base);
    as.anwalt = client(server.base);
    await as.admin.login(TEAM.admin);
    await as.anwalt.login(TEAM.anwalt);
  });
  after(async () => {
    if (server) await server.stop();
  });

  it('Ränge kommen aus der Datenbank – mit den bisherigen Texten der Startseite', async () => {
    const r = await as.anwalt.get('/api/site/ranks');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.json.ranks.map((x) => x.name),
      ['Founding Partner', 'Equity Partner', 'Partner', 'Senior Associate', 'Associate', 'Junior Associate']
    );
    const founding = r.json.ranks[0];
    assert.equal(founding.level, 'board');
    assert.equal(founding.badge, 'Grundsatzebene');
    assert.match(founding.description, /^Gründer, Inhaber und Leitung der Kanzlei/);
    assert.equal(founding.footer, 'Vollmacht: Alle Gerichte · Kanzleileitung');
    assert.equal((await as.anwalt.post('/api/site/ranks', { name: 'Of Counsel', level: 'associate' })).status, 403, 'nur die Board-Rolle');
  });

  it('Neuer Rang: Startseite, Auswahllisten und Board-Rechte; Umbenennen zieht Konten mit; vergeben = nicht löschbar', async () => {
    const created = await as.admin.post('/api/site/ranks', { name: 'Managing Partner', level: 'board', badge: 'Leitung', description: 'Führt das Tagesgeschäft der Kanzlei.', footer: 'Vollmacht: Alle Gerichte' });
    assert.equal(created.status, 201, created.text);
    const rank = created.json.ranks.find((x) => x.name === 'Managing Partner');
    assert.equal(rank.number, 4, 'Board-Ränge stehen vor den Associates');
    const home = await client(server.base).get('/');
    assert.match(home.text, /<h4[^>]*>Managing Partner<\/h4>/);
    assert.match(home.text, /Führt das Tagesgeschäft der Kanzlei\./);
    assert.match(home.text, /Rang 04/);
    // Auswahllisten im Dashboard bekommen die Ränge mit der Anmeldung
    assert.ok((await as.anwalt.get('/api/auth/me')).json.ranks['Board of Partners'].includes('Managing Partner'));
    // Der Anwalt bekommt den neuen Board-Rang → Board-Rechte
    const users = (await as.admin.get('/api/admin/users')).json.users;
    const lex = users.find((u) => u.email === TEAM.anwalt);
    assert.equal((await as.admin.patch(`/api/admin/users/${lex.id}`, { rank: 'Managing Partner' })).status, 200);
    assert.equal((await as.anwalt.get('/api/auth/me')).json.user.board, true);
    // Umbenennen: das Konto behält den Rang unter neuem Namen
    const renamed = await as.admin.patch(`/api/site/ranks/${rank.id}`, { name: 'Senior Partner' });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal((await as.anwalt.get('/api/auth/me')).json.user.rank, 'Senior Partner');
    // Vergeben → nicht löschbar; Verschieben nach oben
    assert.equal((await as.admin.del(`/api/site/ranks/${rank.id}`)).status, 409);
    const moved = await as.admin.post(`/api/site/ranks/${rank.id}/move`, { dir: -1 });
    assert.deepEqual(moved.json.ranks.slice(0, 4).map((x) => x.name), ['Founding Partner', 'Equity Partner', 'Senior Partner', 'Partner']);
    // Zurück auf den alten Rang, dann ist Löschen möglich
    assert.equal((await as.admin.patch(`/api/admin/users/${lex.id}`, { rank: 'Senior Associate' })).status, 200);
    assert.equal((await as.anwalt.get('/api/auth/me')).json.user.board, false);
    assert.equal((await as.admin.del(`/api/site/ranks/${rank.id}`)).status, 200);
    assert.doesNotMatch((await client(server.base).get('/')).text, /Senior Partner/);
  });

  it('Website-Texte: Board ändert einen Text direkt auf der Seite, „Original“ stellt ihn wieder her', async () => {
    const page = (await client(server.base).get('/')).text;
    const key = page.match(/data-t="([0-9a-f]{12})">Hierarchie (?:&|&amp;) Kanzleiränge</)[1];
    assert.equal((await as.anwalt.put('/api/site/texts', { page: 'index', key, text: 'Hallo' })).status, 403, 'nur Board of Partners');
    assert.equal((await as.admin.put('/api/site/texts', { page: 'index', key: 'ffffffffffff', text: 'x' })).status, 404, 'nur echte Texte der Seite');
    const saved = await as.admin.put('/api/site/texts', { page: 'index', key, text: 'Unsere <Ränge>' });
    assert.equal(saved.status, 200, saved.text);
    const after = (await client(server.base).get('/')).text;
    assert.match(after, new RegExp(`data-t="${key}">Unsere &lt;Ränge&gt;<`), 'eingesetzt und maskiert');
    const list = (await as.admin.get('/api/site/texts')).json.texts;
    assert.equal(list[0].original, 'Hierarchie & Kanzleiränge');
    assert.equal((await as.admin.del(`/api/site/texts/index/${key}`)).status, 200);
    assert.match((await client(server.base).get('/')).text, new RegExp(`data-t="${key}">Hierarchie (?:&|&amp;) Kanzleiränge<`));
    // Rang-Karten sind keine Website-Texte (die pflegt Einstellungen → Ränge)
    assert.doesNotMatch(after, /<h4[^>]*data-t=/);
  });

  it('Vorschaubild für Discord-Links: absolute Adresse auf Startseite und Karriere', async () => {
    for (const p of ['/', '/karriere.html']) {
      const html = (await client(server.base).get(p)).text;
      assert.match(html, new RegExp(`<meta property="og:image" content="${server.base.replace(/[.]/g, '\\.')}/img/og-image\\.png">`), p);
    }
    const img = await fetch(`${server.base}/img/og-image.png`);
    assert.equal(img.status, 200);
  });

  it('Link-Vorschau: eigene Texte je Seite, Goldstreifen auf den öffentlichen Seiten, absolutes Bild auch auf Login & Co.', async () => {
    const meta = (html, prop) => (html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1];
    const pages = { '/': null, '/karriere.html': null, '/login': 'Mandantenportal – Pake & Scha', '/register.html': 'Konto erstellen – Pake & Scha', '/bewerbung': 'Ihre Bewerbung bei Pake & Scha' };
    const titles = new Set();
    for (const [p, title] of Object.entries(pages)) {
      const html = (await client(server.base).get(p)).text;
      const t = meta(html, 'og:title');
      assert.ok(t, `${p}: og:title`);
      if (title) assert.equal(t, title, p);
      titles.add(t);
      assert.ok(meta(html, 'og:description'), `${p}: og:description`);
      assert.equal(meta(html, 'og:image'), `${server.base}/img/og-image.png`, p);
    }
    assert.equal(titles.size, Object.keys(pages).length, 'jede Seite hat ihren eigenen Titel');
    for (const p of ['/', '/karriere.html', '/bewerbung']) assert.equal(meta((await client(server.base).get(p)).text, 'theme-color'), '#b8962e', `${p}: Goldstreifen`);
  });

  it('404: eigene Seite für Menschen, schlichte Antwort für Programme', async () => {
    const page = await client(server.base).get('/gibt-es-nicht', { Accept: 'text/html' });
    assert.equal(page.status, 404);
    assert.match(page.text, /Seite nicht gefunden/);
    assert.match(page.text, /<meta name="robots" content="noindex">/);
    assert.match(page.text, /href="\/"/);
    const api = await client(server.base).get('/api/gibt-es-nicht');
    assert.equal(api.status, 404);
    assert.doesNotMatch(api.text, /<html/i);
    const img = await fetch(`${server.base}/img/gibt-es-nicht.png`);
    assert.equal(img.status, 404);
    assert.doesNotMatch(await img.text(), /<html/i, 'fehlende Bilder bekommen keine HTML-Seite');
  });

  it('Ungültige Angaben: der Server nennt je Feld einen kurzen Hinweis', async () => {
    const r = await client(server.base).post('/api/public/cases', { name: 'P', area: 'zivilrecht', description: 'kurz' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Bitte prüfen Sie folgende Angaben/);
    assert.equal(r.json.fields.name, 'Mindestens 2 Zeichen.');
    assert.match(r.json.fields.description, /^Mindestens \d+ Zeichen\.$/);
  });

  it('Einarbeitung: neuer Anwalt bekommt die Checkliste, Mentor und Person haken ab, fremde nicht', async () => {
    const r = await as.admin.post('/api/admin/users', { displayName: 'Nina Neu', email: 'nina.neu', role: 'anwalt', rank: 'Junior Associate' });
    assert.equal(r.status, 201, r.text);
    const nina = client(server.base);
    await nina.login(r.json.credentials.email, r.json.credentials.password);
    const mine = (await nina.get('/api/onboarding')).json.list;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, 'Nina Neu');
    assert.equal(mine[0].total, 7);
    assert.ok(mine[0].mentor, 'Mentor ist, wer das Konto angelegt hat');
    assert.equal((await nina.patch(`/api/onboarding/items/${mine[0].items[0].id}`, { done: true })).status, 200);
    // Ein anderer Anwalt (nicht Mentor, nicht Board) sieht die Einarbeitung nicht
    assert.equal((await as.anwalt.get('/api/onboarding')).json.list.length, 0);
    assert.equal((await as.anwalt.patch(`/api/onboarding/items/${mine[0].items[1].id}`, { done: true })).status, 404);
    const board = (await as.admin.get('/api/onboarding')).json;
    const e = board.list.find((x) => x.name === 'Nina Neu');
    assert.equal(e.done, 1);
    for (const i of e.items.slice(1)) await as.admin.patch(`/api/onboarding/items/${i.id}`, { done: true });
    assert.ok((await as.admin.get('/api/onboarding')).json.list.find((x) => x.name === 'Nina Neu').doneAt, 'alles abgehakt = fertig');
  });
});

describe('Automatisch aufräumen', () => {
  it('löscht abgelehnte Bewerbungen und erledigte Anliegen nach X Tagen – offene bleiben', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-cleanup-'));
    process.env.DB_PATH = path.join(dir, 'c.db');
    const { db } = require('../db');
    const cleanup = require('../cleanup');
    const app = db.prepare("INSERT INTO applications (number, access_code, position_title, name, motivation, status, updated_at) VALUES (?, 'x', 'Associate', 'A', 'M', ?, datetime('now', ?))");
    app.run('BW-1', 'abgelehnt', '-90 days');
    app.run('BW-2', 'abgelehnt', '-5 days');
    app.run('BW-3', 'in_pruefung', '-90 days');
    cleanup.setDays(30);
    assert.deepEqual(cleanup.sweep({ force: true }), { applications: 1, concerns: 0 });
    assert.deepEqual(db.prepare('SELECT number FROM applications ORDER BY number').all().map((r) => r.number), ['BW-2', 'BW-3']);
    cleanup.setDays(0);
    assert.deepEqual(cleanup.sweep({ force: true }), { applications: 0, concerns: 0 }, '0 = aus');
  });
});
