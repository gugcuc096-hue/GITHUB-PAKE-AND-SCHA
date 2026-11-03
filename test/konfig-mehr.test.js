'use strict';
/*
 * Mehr Einstellungen ohne Code: Navigation und Dashboard-Start je Personengruppe, Tarifrechner, Dokumente,
 * Discord-Meldungen und Benachrichtigungen je Person.
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

const publish = async (c, key, body) => {
  const r = await c.put(`/api/config/${key}/draft`, body);
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.post(`/api/config/${key}/publish`)).status, 200);
};

describe('Einstellungen: Navigation, Dashboard-Start, Tarifrechner, Dokumente, Discord, Benachrichtigungen', () => {
  let srv;
  let owner;
  let anwalt;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    await owner.login(TEAM.admin);
    anwalt = client(srv.base);
    await anwalt.login(TEAM.anwalt);
  });
  after(async () => {
    if (srv) await srv.stop();
  });

  it('Navigation und Dashboard-Start gelten nur für die eigene Personengruppe', async () => {
    await publish(owner, 'nav', {
      profiles: { team: { order: ['tasks', 'cases'], hidden: ['board'], labels: { cases: 'Mandate' } }, board: { order: [], hidden: [], labels: {} }, mandant: { order: [], hidden: [], labels: {} } },
      links: [{ label: 'Wiki', url: 'https://wiki.example.org', audience: ['team'] }],
    });
    await publish(owner, 'start', { profiles: { team: { order: ['events', 'recent'], hidden: ['kpi-mail', 'pinboard'] }, board: { order: [], hidden: [] }, mandant: { order: [], hidden: ['kpi-invoices'] } } });
    const t = (await anwalt.get('/api/auth/me')).json.siteConfig;
    assert.deepEqual(t.nav.hidden, ['board']);
    assert.equal(t.nav.labels.cases, 'Mandate');
    assert.equal(t.nav.links.length, 1);
    assert.deepEqual(t.start.hidden, ['kpi-mail', 'pinboard']);
    const b = (await owner.get('/api/auth/me')).json.siteConfig;
    assert.deepEqual(b.nav.hidden, [], 'Board hat eigene Einstellung');
    assert.equal(b.nav.links.length, 0, 'Link nur fürs Team');
    assert.equal((await client(srv.base).get('/api/public/site-config')).json.nav, null, 'Besucher bekommen kein Menü');
    assert.equal((await owner.put('/api/config/nav/draft', { profiles: { team: { order: [], hidden: [], labels: {} }, board: { order: [], hidden: [], labels: {} }, mandant: { order: [], hidden: [], labels: {} } }, links: [{ label: 'x', url: 'javascript:alert(1)', audience: ['team'] }] })).status, 400);
    assert.equal((await anwalt.put('/api/config/nav/draft', {})).status, 403, 'nur mit Recht');
  });

  it('Tarifrechner und Dokumente', async () => {
    await publish(owner, 'calculator', { bundleMin: 2, bundlePct: 20, priorityPct: 25, priorityLabel: 'Express', prioritySub: 'Sofort' });
    const pub = (await client(srv.base).get('/api/public/site-config')).json.calculator;
    assert.equal(pub.bundlePct, 20);
    assert.equal(pub.priorityLabel, 'Express');
    assert.equal((await owner.put('/api/config/calculator/draft', { ...pub, bundlePct: 80 })).status, 400);
    await publish(owner, 'documents', { logoPos: 'mitte', tagline: 'Recht mit Stil', footer: 'Maze Bank · Konto 1234', signature: true, signatureStyle: 'schrift', watermark: 'VERTRAULICH', watermarkOn: ['invoice'] });
    const firm = (await anwalt.get('/api/invoices/firm')).json.firm;
    assert.equal(firm.doc.logoPos, 'mitte');
    assert.equal(firm.doc.watermark, 'VERTRAULICH');
  });

  it('Discord-Meldungen: Felder werden gemerkt, Aussehen gilt je Ereignis', async () => {
    const r = await owner.get('/api/config/discord-fields');
    assert.equal(r.status, 200);
    assert.ok(r.json.events['case.created']);
    await publish(owner, 'discordLook', { events: { 'case.created': { color: '#ff0000', title: '⚖️ {titel}', hide: ['Mandant'] } }, footer: 'Kanzlei-Ticker' });
    assert.equal((await owner.put('/api/config/discordLook/draft', { events: { 'case.created': { color: 'rot', title: '', hide: [] } }, footer: '' })).status, 400);
    assert.equal((await anwalt.get('/api/config/discord-fields')).status, 403);
  });

  it('Benachrichtigungen je Person (auch Mandanten)', async () => {
    const m = client(srv.base);
    assert.equal((await m.post('/api/auth/register', { displayName: 'Nora Notiz', email: 'nora.notiz', password: PASSWORD })).status, 201);
    assert.equal((await m.get('/api/notify-prefs')).json.prefs.dm, 'an');
    const r = await m.put('/api/notify-prefs', { dm: 'still', quiet: true, quietFrom: '22:00', quietTo: '07:30' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await m.get('/api/notify-prefs')).json.prefs.quietTo, '07:30');
    assert.equal((await m.put('/api/notify-prefs', { quietFrom: '25:00' })).status, 400);
  });

  it('Browser: Menü, Übersicht, Einstellungen und Profil', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    const login = async (email) => {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', email);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#nav a.nav-item');
      await page.waitForSelector('#content .page-title');
    };
    try {
      // Team: Aufgaben vor Akten, „Mandate“ statt „Akten“, Pinnwand weg, eigener Link; Übersicht ohne Post-Kennzahl
      await login(TEAM.anwalt);
      const nav = await page.$$eval('#nav a.nav-item', (l) => l.map((a) => [a.getAttribute('href'), a.textContent.trim()]));
      const hrefs = nav.map((x) => x[0]);
      assert.ok(hrefs.indexOf('#tasks') < hrefs.indexOf('#cases'), hrefs.join(' '));
      assert.ok(nav.some(([h, t]) => h === '#cases' && /Mandate/.test(t)), JSON.stringify(nav));
      assert.ok(!hrefs.includes('#board'), 'Pinnwand ausgeblendet');
      assert.ok(hrefs.includes('https://wiki.example.org'), 'eigener Link');
      assert.equal(await page.locator('#content .kpi-grid a[href="#mail"]').count(), 0, 'Post-Kennzahl ausgeblendet');
      // Profil: Benachrichtigungen speichern
      await page.evaluate(() => (location.hash = '#profile'));
      await page.waitForSelector('#notifyPanel');
      await page.click('#notifyPanel label.seg-opt:has(input[value="still"])');
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/notify-prefs') && r.request().method() === 'PUT' && r.ok()), page.click('#notifyPanel button[type=submit]')]);
      assert.equal((await anwalt.get('/api/notify-prefs')).json.prefs.dm, 'still');

      // Inhaber: neue Einstellungs-Bereiche öffnen sich ohne Fehler
      await ctx.clearCookies();
      await login(TEAM.admin);
      for (const key of ['nav', 'start', 'calculator', 'documents', 'discordLook']) {
        await page.goto(`${srv.base}/dashboard?tab=${key}#settings`);
        await page.waitForSelector(`form[data-form="cfg-${key}"]`, { timeout: 15000 });
      }
      // Dashboard-Start: Reihenfolge per Pfeil ändern und als Entwurf speichern
      await page.goto(`${srv.base}/dashboard?tab=start#settings`);
      await page.waitForSelector('form[data-form="cfg-start"] .cfg-sort-row');
      const first = await page.getAttribute('form[data-form="cfg-start"] .cfg-sort-row >> nth=0', 'data-key');
      await page.click('form[data-form="cfg-start"] .cfg-sort-row >> nth=1 >> [data-action="cfg-move"][data-dir="-1"]');
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/config/start/draft') && r.ok()), page.click('form[data-form="cfg-start"] button[type=submit]')]);
      const draft = (await owner.get('/api/config')).json.config.start.draft;
      assert.equal(draft.profiles.team.order[1], first, 'zweiter Baustein steht jetzt vorne');
      // Dokumente: Beispielrechnung mit Wasserzeichen und Fußzeile
      const doc = await ctx.newPage();
      await doc.goto(`${srv.base}/rechnung?beispiel=1`);
      await doc.waitForSelector('#doc .doc-watermark');
      assert.match(await doc.textContent('#doc .doc-footline'), /Maze Bank/);
      assert.ok(await doc.$('#doc.doc-logo-mitte'));
      // Tarifrechner: Name des Zuschlags auf der Website (Honorare)
      await doc.goto(`${srv.base}/honorare`);
      await doc.waitForFunction(() => /Express \(\+25 %\)/.test(document.querySelector('#priorityAddon')?.closest('.calc-opt')?.textContent || ''));
      assert.deepEqual(problems, []);
    } finally {
      await browser.close();
    }
  });
});
