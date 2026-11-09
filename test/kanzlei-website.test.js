'use strict';
/*
 * Website in Unterseiten (Kanzlei-Redesign):
 *  - jede Adresse liefert nur ihre Abschnitte, eigenen Titel, kanonische Adresse und markiert den Menüpunkt
 *  - Rechtsgebiete: eigene Seite je Rechtsgebiet mit den Verfahrensschritten aus der Datenbank, ausgeblendete fallen weg
 *  - Aktuelles: Meldungen des Boards (Rechte, angeheftet oben, verborgen) und automatische Meldungen (Beförderung)
 *  - Verfahrensstand: nur mit Aktenzeichen + Pin, ohne Inhalte der Akte; falscher Pin → 404
 *  - keine Programmierschrift mehr (fonts.css, ausgelieferte Stylesheets)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

describe('Kanzlei-Website in Unterseiten', () => {
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
  const html = async (p) => {
    const r = await fetch(server.base + p);
    return { status: r.status, text: await r.text() };
  };

  it('jede Unterseite hat ihre Abschnitte, ihren Titel, ihre Adresse und den markierten Menüpunkt', async () => {
    const pages = {
      '/': { has: ['id="gebiete"', 'id="leadGrid"', 'id="fakten"'], not: ['id="rechner"', 'id="teamGrid"', 'id="faq"', 'id="ablauf"'], title: 'Pake &amp; Scha – Kanzlei in Los Santos' },
      '/kanzlei': { has: ['id="grundsaetze"', 'id="raenge"', 'id="karriere"'], not: ['id="rechner"'], nav: 'kanzlei', title: 'Die Kanzlei – Pake &amp; Scha' },
      '/honorare': { has: ['id="rechner"', 'id="honorar"', 'id="vip"', 'id="priceSearch"'], not: ['id="raenge"'], nav: 'honorare', title: 'Honorare – Pake &amp; Scha' },
      '/anwaelte': { has: ['id="teamGrid"'], not: ['id="rechner"'], nav: 'anwaelte' },
      '/notdienst': { has: ['id="dutyNow"', 'data-urgency="notfall"'], not: ['id="teamGrid"'], nav: 'notdienst' },
      '/aktuelles': { has: ['id="newsList"'], not: ['id="newsTeaser"'], nav: 'aktuelles' },
      '/verfahrensstand': { has: ['id="statusForm"'], not: ['id="newsList"'], nav: 'verfahrensstand' },
      '/kontakt': { has: ['id="faq"', 'id="anliegen"'], not: ['id="rechner"'], nav: 'kontakt' },
      '/impressum': { has: ['id="impressum"', 'Rollenspiel'], not: ['id="faq"'] },
    };
    for (const [p, want] of Object.entries(pages)) {
      const r = await html(p);
      assert.equal(r.status, 200, p);
      for (const x of want.has) assert.ok(r.text.includes(x), `${p}: ${x} fehlt`);
      for (const x of want.not) assert.ok(!r.text.includes(x), `${p}: ${x} gehört nicht hierher`);
      if (want.title) assert.ok(r.text.includes(`<title>${want.title}</title>`), `${p}: Titel`);
      assert.ok(r.text.includes(`<link rel="canonical" href="${server.base}${p}">`), `${p}: kanonische Adresse`);
      if (want.nav) assert.ok(r.text.includes(`data-nav="${want.nav}" aria-current="page"`), `${p}: Menüpunkt markiert`);
      // Mandatsfenster, Anmelden und Anliegen gibt es auf jeder Seite
      for (const id of ['ticketModal', 'loginDialog', 'concernModal', 'mobileMenu']) assert.ok(r.text.includes(`id="${id}"`), `${p}: ${id}`);
    }
    assert.equal((await html('/rechtsgebiete/gibtsnicht')).status, 404);
    const map = (await html('/sitemap.xml')).text;
    for (const p of ['/kanzlei', '/honorare', '/rechtsgebiete/strafrecht', '/verfahrensstand']) assert.ok(map.includes(`${server.base}${p}<`), `Sitemap: ${p}`);
  });

  it('Rechtsgebiete: eigene Seite mit Verfahrensschritten aus der Datenbank; ausgeblendete verschwinden', async () => {
    const r = await html('/rechtsgebiete/strafrecht');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('<title>Strafrecht – Pake &amp; Scha</title>'));
    assert.match(r.text, /<ol class="kz-steps"><li>Eingang<\/li><li>Akteneinsicht<\/li>/);
    assert.ok(r.text.includes('data-area="strafrecht"'), 'Knopf wählt das Rechtsgebiet im Formular');
    assert.ok(r.text.includes('href="/rechtsgebiete/zivilrecht"'), 'weitere Rechtsgebiete');
    assert.ok(r.text.includes('data-nav="rechtsgebiete" aria-current="page"'));
    // Vertragsrecht ausblenden → Seite weg, auch aus der Liste
    const list = (await as.admin.get('/api/areas')).json;
    const area = (list.areas || list).find((a) => a.key === 'vertragsrecht');
    const off = await as.admin.put('/api/areas/vertragsrecht', { ...area, active: false });
    assert.equal(off.status, 200, off.text);
    assert.equal((await html('/rechtsgebiete/vertragsrecht')).status, 404);
    assert.ok(!(await html('/rechtsgebiete')).text.includes('data-area="vertragsrecht"'));
    assert.equal((await as.admin.put('/api/areas/vertragsrecht', { ...area, active: true })).status, 200);
  });

  it('Aktuelles: Meldungen nur vom Board, angeheftet oben, verborgene nicht öffentlich; Beförderung erscheint automatisch', async () => {
    assert.equal((await as.anwalt.post('/api/site/news', { title: 'Hallo Welt' })).status, 403, 'nur mit Website-Recht');
    const a = await as.admin.post('/api/site/news', { title: 'Neue Sprechzeiten', body: 'Ab Montag auch abends.', pinned: false });
    assert.equal(a.status, 201, a.text);
    const b = await as.admin.post('/api/site/news', { title: 'Kanzlei wieder geöffnet', pinned: true });
    const c = await as.admin.post('/api/site/news', { title: 'Nur intern', visible: false });
    assert.equal(c.status, 201);
    // Beförderung → automatische Meldung
    const users = (await as.admin.get('/api/admin/users')).json.users;
    const lex = users.find((u) => u.email === TEAM.anwalt);
    const promo = await as.admin.post('/api/personnel/promote', { userId: lex.id, rank: 'Partner' });
    assert.ok([200, 201].includes(promo.status), promo.text);
    const feed = (await (await fetch(`${server.base}/api/public/news`)).json()).news;
    assert.equal(feed[0].title, 'Kanzlei wieder geöffnet', 'angeheftet oben');
    assert.ok(feed.some((n) => n.title === 'Neue Sprechzeiten' && n.body === 'Ab Montag auch abends.'));
    assert.ok(!feed.some((n) => n.title === 'Nur intern'), 'verborgen bleibt intern');
    assert.ok(feed.some((n) => n.kind === 'befoerderung' && /Partner/.test(n.body)), 'Beförderung erscheint');
    // Automatik abschalten (Einstellungen → Startseite)
    const cfg = (await as.admin.get('/api/config')).json;
    const home = cfg.config.home.published;
    const draft = await as.admin.put('/api/config/home/draft', { ...home, news: { hires: true, promotions: false, positions: true } });
    assert.equal(draft.status, 200, draft.text);
    assert.equal((await as.admin.post('/api/config/home/publish', {})).status, 200);
    const after2 = (await (await fetch(`${server.base}/api/public/news`)).json()).news;
    assert.ok(!after2.some((n) => n.kind === 'befoerderung'), 'Beförderungen abgeschaltet');
    // Ändern und Löschen
    assert.equal((await as.admin.put(`/api/site/news/${b.json.item.id}`, { title: 'Geändert', pinned: false })).status, 200);
    assert.equal((await as.admin.del(`/api/site/news/${a.json.item.id}`)).status, 200);
    const last = (await (await fetch(`${server.base}/api/public/news`)).json()).news;
    assert.ok(last.some((n) => n.title === 'Geändert') && !last.some((n) => n.title === 'Neue Sprechzeiten'));
  });

  it('Verfahrensstand: nur mit Aktenzeichen + Pin, ohne Inhalt der Akte', async () => {
    const r = await client(server.base).post('/api/public/cases', { name: 'Vera Verfahren', area: 'zivilrecht', description: 'Mein Nachbar zahlt seine Schulden nicht zurück.' });
    assert.equal(r.status, 201, r.text);
    const ok = await client(server.base).post('/api/public/case-status', { number: r.json.caseNumber.toLowerCase(), pin: r.json.pin });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.caseNumber, r.json.caseNumber);
    assert.equal(ok.json.area, 'Zivilrecht');
    assert.equal(ok.json.step, 0);
    assert.equal(ok.json.steps.at(-1), 'Abgeschlossen');
    assert.ok(!JSON.stringify(ok.json).includes('Vera') && !JSON.stringify(ok.json).includes('Nachbar'), 'kein Name, kein Sachverhalt');
    const wrong = String((Number(r.json.pin) + 1) % 1000000).padStart(6, '0');
    assert.equal((await client(server.base).post('/api/public/case-status', { number: r.json.caseNumber, pin: wrong })).status, 404);
    assert.equal((await client(server.base).post('/api/public/case-status', { number: r.json.caseNumber, pin: 'abc' })).status, 400);
  });

  it('keine Programmierschrift: weder in fonts.css noch in den Stylesheets der Website', async () => {
    const page = (await html('/')).text;
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    assert.ok(sheets.some((s) => /kanzlei/.test(s)), 'kanzlei.css (im Bündel)');
    for (const s of sheets) {
      const css = await (await fetch(server.base + s)).text();
      assert.doesNotMatch(css, /JetBrains/, s);
    }
    assert.doesNotMatch(page, /font-mono/, 'Startseite ohne font-mono');
  });
});
