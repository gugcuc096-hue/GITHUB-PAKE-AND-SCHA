'use strict';
/*
 * Konfiguration ohne Code: Banner, Startseite, Beschriftungen, Mitteilungstexte (Entwurf → Veröffentlichen),
 * Export/Import – API, Mitteilungs-Vorlagen und Dashboard/Website am PC und am Handy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM, PASSWORD, pickTab } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Mitteilungs-Vorlagen', () => {
  let templates;
  before(() => {
    process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-msg-')), 'm.db');
    templates = require('../messageTemplates');
  });

  it('Standardtexte: Sie und Du, Platzhalter werden gefüllt, unbekannte und leere verschwinden', () => {
    const vars = { aktenzeichen: 'PS-2026-0012', mandant: 'Tina' };
    assert.match(templates.render('review', vars), /^Ihre Akte \*\*PS-2026-0012\*\* ist abgeschlossen/);
    assert.equal(templates.fill('Hallo {mandant}, {gibtsnicht}Ende', vars), 'Hallo Tina, Ende');
    assert.equal(templates.fill('A\n\n\n\n{notiz}\n\n\nB', { notiz: '' }), 'A\n\nB');
    const { SPECS } = require('../siteConfig');
    assert.ok(SPECS.messages.schema.safeParse({ tone: 'du', docsAfterDays: 3, texts: {} }).success);
    // Ton „Du“ und eigener Text
    const siteConfig = require('../siteConfig');
    siteConfig.publish('messages', null, { tone: 'du', docsAfterDays: 5, texts: { receipt: 'Hi {mandant}, Akte {aktenzeichen} ist da.' } });
    assert.match(templates.render('review', vars), /^Deine Akte/);
    assert.equal(templates.render('receipt', { mandant: '<@1>', aktenzeichen: 'X-1' }), 'Hi <@1>, Akte X-1 ist da.');
    assert.equal(siteConfig.get('messages').docsAfterDays, 5);
  });
});

describe('Konfiguration: Banner, Startseite, Beschriftungen, Mitteilungen', () => {
  let srv;
  let owner;
  let board;
  let lex;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    board = client(srv.base);
    lex = client(srv.base);
    await owner.login(TEAM.admin);
    await board.login(TEAM.partner);
    const lexUser = await lex.login(TEAM.anwalt);
    await owner.post('/api/access/web-admins', { userId: lexUser.id });
  });
  after(() => srv.stop());

  const pub = async (c = client(srv.base)) => (await c.get('/api/auth/session')).json.siteConfig;

  it('Banner: Entwurf ist unsichtbar, Veröffentlichen zeigt ihn – nach Zielgruppe und Zeitraum', async () => {
    const draft = { enabled: true, text: 'Am Sonntag nur Notdienst.', tone: 'amber', link: '/karriere', linkLabel: 'Mehr', from: '', to: '', audience: ['public', 'mandant'], dismissible: true };
    assert.equal((await board.put('/api/config/banner/draft', draft)).status, 403, 'Board ohne Recht');
    assert.equal((await owner.put('/api/config/banner/draft', { ...draft, link: 'javascript:alert(1)' })).status, 400, 'nur https, /pfad, #anker, mailto');
    assert.equal((await owner.put('/api/config/banner/draft', draft)).status, 200);
    assert.equal((await pub()).banner, null, 'Entwurf sieht niemand');
    assert.equal((await owner.post('/api/config/banner/publish')).status, 200);
    const seen = (await pub()).banner;
    assert.equal(seen.text, 'Am Sonntag nur Notdienst.');
    assert.equal(seen.tone, 'amber');
    assert.equal(await pub(owner).then((c) => c.banner), null, 'Kanzlei ist nicht in der Zielgruppe');
    // abgelaufen
    const yesterday = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    await owner.put('/api/config/banner/draft', { ...draft, to: yesterday });
    await owner.post('/api/config/banner/publish');
    assert.equal((await pub()).banner, null, 'nach „bis“ nicht mehr');
    // Änderungsprotokoll + Zurücksetzen
    const log = (await owner.get('/api/access/log')).json.log.filter((e) => e.area === 'site_config' && e.key === 'banner');
    assert.ok(log.length >= 2 && log[0].revertible);
    assert.equal((await owner.post(`/api/access/log/${log[0].id}/revert`)).status, 200);
    assert.equal((await pub()).banner.text, 'Am Sonntag nur Notdienst.', 'zurückgesetzt auf den Stand davor');
  });

  it('Startseite: Reihenfolge, Ausblenden, FAQ und Links werden geprüft; Vorschau mit Entwurf nur mit Recht', async () => {
    const home = { order: ['faq', 'ablauf', 'honorar'], hidden: ['vip'], faq: [{ q: 'Was kostet es?', a: 'Siehe Honorarordnung.' }], links: [{ label: 'Discord', url: 'https://discord.gg/xyz' }], contactEmail: 'hallo@pake-scha.ls', kpis: { closed: false, success: true, rating: true } };
    assert.equal((await owner.put('/api/config/home/draft', { ...home, order: ['faq', 'gibts-nicht'] })).status, 400);
    assert.equal((await owner.put('/api/config/home/draft', { ...home, links: [{ label: 'x', url: 'ftp://x' }] })).status, 400);
    assert.equal((await owner.put('/api/config/home/draft', { ...home, contactEmail: 'kaputt' })).status, 400);
    assert.equal((await owner.put('/api/config/home/draft', home)).status, 200);
    assert.equal((await pub()).home.hidden.length, 0, 'noch Standard');
    const preview = (await owner.get('/api/public/site-config?draft=1')).json;
    assert.deepEqual(preview.home.hidden, ['vip']);
    assert.equal(preview.draft, true);
    const anon = (await client(srv.base).get('/api/public/site-config?draft=1')).json;
    assert.equal(anon.draft, false, 'ohne Recht nie der Entwurf');
    await owner.post('/api/config/home/publish');
    assert.deepEqual((await pub()).home.hidden, ['vip']);
    assert.equal((await pub()).home.faq[0].q, 'Was kostet es?');
  });

  it('Beschriftungen und Mitteilungen: Rechte je Bereich, Prüfung der Eingaben', async () => {
    assert.equal((await owner.put('/api/config/labels/draft', { terms: { mandant: { sg: 'Klient', pl: 'Klienten' } }, hints: { 'settings-firm.firmSeat': 'Ort der Kanzlei' } })).status, 200);
    assert.equal((await owner.put('/api/config/labels/draft', { terms: { mandant: { sg: 'K', pl: 'Klienten' } }, hints: {} })).status, 400, 'zu kurz');
    assert.equal((await owner.put('/api/config/labels/draft', { terms: { gibts: { sg: 'Klient', pl: 'Klienten' } }, hints: {} })).status, 400, 'unbekannter Begriff');
    await owner.post('/api/config/labels/publish');
    const labels = (await pub()).labels;
    assert.equal(labels.terms.mandant.sg, 'Klient');
    assert.equal(labels.hints['settings-firm.firmSeat'], 'Ort der Kanzlei');
    // Mitteilungen brauchen „Kanzlei-Einstellungen“ – das hat der Web-Admin, das Board nicht
    const msg = { tone: 'du', docsAfterDays: 2, texts: { payment: 'Hallo {mandant}, {rechnung} {nummer} ist offen.' } };
    assert.equal((await board.put('/api/config/messages/draft', msg)).status, 403);
    assert.equal((await lex.put('/api/config/messages/draft', msg)).status, 200);
    assert.equal((await lex.put('/api/config/messages/draft', { ...msg, docsAfterDays: 0 })).status, 400);
    assert.equal((await lex.put('/api/config/messages/draft', { ...msg, texts: { gibts: 'x' } })).status, 400);
    assert.equal((await lex.post('/api/config/messages/publish')).status, 200);
    const all = (await lex.get('/api/config')).json;
    assert.equal(all.config.messages.published.tone, 'du');
    assert.ok(all.messages.messages.payment.placeholders.includes('betrag'));
    assert.equal(Object.keys((await board.get('/api/config')).json.config).length, 0, 'Board sieht keine Bereiche');
    // Verwerfen
    await lex.put('/api/config/messages/draft', { ...msg, docsAfterDays: 9 });
    assert.equal((await lex.del('/api/config/messages/draft')).status, 200);
    assert.equal((await lex.get('/api/config')).json.config.messages.draft, null);
  });

  it('Export und Import: Vorschau der Änderungen, Übernahme, Rechte je Bereich', async () => {
    await owner.patch('/api/admin/settings', { firmContact: 'ausgang@pake-scha.ls' });
    const file = (await owner.get('/api/config/export')).json;
    assert.equal(file.kind, 'pake-scha-einstellungen');
    assert.ok(file.config.banner && file.config.home && file.permissions && file.features);
    assert.ok(!JSON.stringify(file).match(/webhook|token|passwor/i), 'keine Geheimnisse in der Datei');
    // Stand ändern, Datei zurückspielen
    await owner.patch('/api/admin/settings', { firmContact: 'andere@pake-scha.ls' });
    await owner.put('/api/config/home/draft', { ...file.config.home, hidden: ['faq'] });
    await owner.post('/api/config/home/publish');
    const dry = (await owner.post('/api/config/import', { data: file })).json;
    assert.equal(dry.applied, false);
    assert.ok(dry.changes.some((c) => c.kind === 'config' && c.key === 'home'));
    assert.ok(dry.changes.some((c) => c.kind === 'setting' && c.key === 'firm_contact'));
    assert.deepEqual((await pub()).home.hidden, ['faq'], 'Vorschau ändert nichts');
    const done = (await owner.post('/api/config/import', { data: file, apply: true })).json;
    assert.equal(done.applied, true);
    assert.deepEqual((await pub()).home.hidden, file.config.home.hidden);
    assert.equal((await owner.get('/api/admin/settings')).json.settings.firmContact, 'ausgang@pake-scha.ls');
    // ein Web-Admin darf nur, was seine Rechte hergeben – die Rechte-Tabelle bleibt dem Inhaber
    const w = (await lex.post('/api/config/import', { data: file })).json;
    assert.ok(w.skipped.some((s) => /Rechte-Tabelle/.test(s)));
    assert.equal((await owner.post('/api/config/import', { data: { kind: 'etwas-anderes', version: 1 } })).status, 400);
  });
});

describe('Texte & Banner im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  async function enter(device, email = TEAM.admin) {
    const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    return { ctx, page, problems };
  }
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Banner und Startseite bearbeiten, veröffentlichen – sichtbar auf der Website; Begriffe umbenennen; Als Rang ansehen`, async () => {
      const { ctx, page, problems } = await enter(device);
      await page.evaluate(() => (location.href = '/dashboard?tab=texte#settings'));
      await page.waitForSelector('form[data-form="cfg-banner"]', { timeout: 15000 });
      assert.equal(await noOverflow(page), true);
      // Banner: Entwurf speichern, dann veröffentlichen
      await page.check('form[data-form="cfg-banner"] input[name="enabled"]');
      await page.fill('form[data-form="cfg-banner"] input[name="text"]', `Notdienst am Sonntag (${name})`);
      await page.waitForFunction(() => /Notdienst am Sonntag/.test(document.querySelector('#cfgBannerPreview')?.textContent || ''));
      await page.click('form[data-form="cfg-banner"] button[type=submit]');
      await page.waitForFunction(() => /Entwurf – noch nicht/.test(document.querySelector('.cfg-bar .badge')?.textContent || ''), null, { timeout: 8000 });
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/config/banner/publish') && r.ok()), page.click('[data-action="cfg-publish"][data-key="banner"]')]);
      // Startseite: Abschnitt „Karriere“ ausblenden
      await pickTab(page, '[data-action="cfg-tab"][data-tab="home"]');
      await page.waitForSelector('#cfgSections');
      await page.uncheck('.home-sec[data-id="karriere"] input[name="show"]');
      await page.click('[data-action="home-move"][data-dir="1"] >> nth=0'); // erster Abschnitt eine Stelle nach unten
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/config/home/publish') && r.ok()), page.click('[data-action="cfg-publish"][data-key="home"]')]);
      // Beschriftungen: Mandant → Klient
      await pickTab(page, '[data-action="cfg-tab"][data-tab="labels"]');
      await page.waitForSelector('.term-row[data-term="mandant"]');
      await page.fill('.term-row[data-term="mandant"] [data-t="sg"]', 'Klient');
      await page.fill('.term-row[data-term="mandant"] [data-t="pl"]', 'Klienten');
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/config/labels/publish') && r.ok()), page.click('[data-action="cfg-publish"][data-key="labels"]')]);
      // Dashboard: Menü zeigt „Klienten“, das Banner steht oben
      await page.reload();
      await page.waitForSelector('#nav .nav-item');
      if (device.isMobile) await page.click('#bottomNav [data-action="open-sidebar"]').catch(() => {});
      await page.waitForFunction(() => /Klienten/.test(document.querySelector('#nav')?.textContent || '') && !/Mandanten/.test(document.querySelector('#nav')?.textContent || ''), null, { timeout: 8000 });
      assert.ok(await page.locator('.dash-banner').count(), 'Banner im Dashboard');
      // Als Rang ansehen: Mandant → kein Einstellungs-Punkt
      await page.evaluate(() => (location.href = '/dashboard?tab=access#settings'));
      await page.waitForSelector('[data-action="view-as"][data-as="mandant"]', { timeout: 15000 });
      await pickTab(page, '[data-action="view-as"][data-as="mandant"]');
      await page.waitForSelector('#viewAsBand');
      if (device.isMobile && !(await page.$('#sidebar.open'))) await page.click('#bottomNav [data-action="open-sidebar"]').catch(() => {});
      assert.equal(await page.locator('#nav a[href="#settings"]').count(), 0, 'Mandant sieht keine Einstellungen');
      await page.evaluate(() => document.querySelector('#viewAsBand [data-action="view-as"]').click());
      await page.waitForFunction(() => !document.querySelector('#viewAsBand'));
      // Website: Banner oben, Karriere weg, Begriff ersetzt
      const site = await ctx.newPage();
      await site.goto(`${srv.base}/`);
      await site.waitForSelector('#siteBanner', { timeout: 10000 });
      assert.match(await site.textContent('#siteBanner'), /Notdienst am Sonntag/);
      assert.equal(await site.isVisible('#karriere'), false, 'Abschnitt Karriere ausgeblendet');
      assert.equal(await noOverflow(site), true);
      await site.click('#siteBanner .site-banner-x');
      await site.waitForFunction(() => !document.querySelector('#siteBanner'));
      await site.reload();
      await page.waitForTimeout(600);
      assert.equal(await site.locator('#siteBanner').count(), 0, 'weggeklickt bleibt weg (in dieser Sitzung)');
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});

describe('Kleine Darstellungsfehler: Haken und Schließen-Kreuz', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  it('das Schließen-Kreuz sitzt oben rechts im Fenster; erledigte Zeilen tragen keinen schwebenden Haken', async () => {
    const srv = await startServer();
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    try {
      const a = client(srv.base);
      const me = await a.login(TEAM.admin);
      const c = (await a.post('/api/cases', { title: 'Haken-Test', area: 'zivilrecht', clientName: 'Hanna Haken', lawyerId: me.id })).json.case;
      const t = (await a.post('/api/tasks', { title: 'Erledigte Aufgabe', caseId: c.id })).json.task;
      await a.patch(`/api/tasks/${t.id}`, { done: true });
      for (const device of [{ viewport: { width: 1366, height: 900 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
        const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
        const page = await ctx.newPage();
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.goto(`${srv.base}/dashboard?case=${c.id}`);
        await page.waitForSelector('#modal.open .modal-close');
        await page.waitForTimeout(800);
        const geo = await page.evaluate(() => {
          const card = document.querySelector('#modal .modal-card').getBoundingClientRect();
          const x = document.querySelector('#modal .modal-close').getBoundingClientRect();
          return { insideX: x.left >= card.left && x.right <= card.right + 1, right: card.right - x.right, top: x.top - card.top };
        });
        assert.equal(geo.insideX, true, `Kreuz im Fenster: ${JSON.stringify(geo)}`);
        assert.ok(geo.right >= 0 && geo.right < 40, `Kreuz rechts: ${JSON.stringify(geo)}`);
        assert.ok(geo.top >= 0 && geo.top < 40, `Kreuz oben: ${JSON.stringify(geo)}`);
        // Erledigte Zeilen: kein Haken-Pseudoelement (der gehört nur dem Speichern-Knopf)
        const stray = await page.evaluate(() => [...document.querySelectorAll('.is-done')].filter((el) => getComputedStyle(el, '::before').maskImage !== 'none' && getComputedStyle(el, '::before').content === '\"\"').length);
        assert.equal(stray, 0, 'kein schwebender Haken');
        await ctx.close();
      }
    } finally {
      await browser.close();
      await srv.stop();
    }
  });
});
