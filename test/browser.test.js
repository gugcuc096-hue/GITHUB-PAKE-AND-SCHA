'use strict';
/*
 * Browser-Tests mit Chromium (Playwright): Startseite, Registrierung, alle Dashboard-Ansichten und die
 * Druckansichten – am PC und am Handy, ohne JavaScript-Fehler und ohne Verstöße gegen die
 * Content-Security-Policy.
 *
 * Playwright ist bewusst keine feste Abhängigkeit (der Server braucht es nicht, Render installiert es nicht).
 * Lokal einmalig:  npm install --no-save playwright && npx playwright install chromium
 * Ohne Playwright werden diese Tests übersprungen. Eigener Browser: PW_CHROMIUM_PATH=/pfad/zu/chrome
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

const DESKTOP = { viewport: { width: 1366, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

describe('Browser', { skip: chromium ? false : 'Playwright nicht installiert (npm install --no-save playwright)' }, () => {
  let server;
  let browser;
  const data = {};

  before(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    // Testdaten: eine Website-Anfrage und eine Rechnung dazu
    const web = await client(server.base).post('/api/public/cases', { name: 'Paul Probe', area: 'zivilrecht', description: 'Testanfrage für die Browser-Tests der Kanzlei.' });
    data.caseNumber = web.json.caseNumber;
    const admin = client(server.base);
    await admin.login(TEAM.admin);
    data.caseId = (await admin.get('/api/cases')).json.cases.find((c) => c.caseNumber === data.caseNumber).id;
    data.invoiceId = (await admin.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Beratung', quantity: 1, unitPrice: 15000 }] })).json.invoice.id;
    // In der Akte hinterlegte FiveNet-Dokumente (Aktenzeichen für Anträge) – das zuletzt verknüpfte steht oben
    const older = await admin.post(`/api/cases/${data.caseId}/external`, { provider: 'fivenet', input: '70001', attest: true, title: 'Anklageschrift der Staatsanwaltschaft Los Santos (Entwurf)' });
    assert.equal(older.status, 201, older.text);
    const link = await admin.post(`/api/cases/${data.caseId}/external`, { provider: 'fivenet', input: '74412', attest: true, title: 'Festnahmebericht LSPD' });
    assert.equal(link.status, 201, link.text);
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) await server.stop();
  });

  async function open(device) {
    const ctx = await browser.newContext({ ...device, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`JavaScript-Fehler: ${e.message}`));
    page.on('console', (m) => /Content Security Policy|Refused to (execute|load|apply)/.test(m.text()) && problems.push(`CSP: ${m.text()}`));
    let inflight = 0;
    page.on('request', (r) => r.url().includes('/api/') && inflight++);
    const done = (r) => r.url().includes('/api/') && inflight--;
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    const settle = async () => {
      await page.waitForTimeout(150);
      for (let i = 0; i < 50 && inflight > 0; i++) await page.waitForTimeout(100);
      await page.waitForTimeout(150);
    };
    return { ctx, page, problems, settle };
  }
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  async function login(page, email) {
    await page.goto(server.base + '/login.html');
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForSelector('#nav a.nav-item');
  }

  it('Startseite am PC: Tarifrechner, Mandatsdialog, FAQ', async () => {
    const { ctx, page, problems } = await open(DESKTOP);
    await page.goto(server.base + '/');
    const before = await page.textContent('#totalAmount');
    await page.locator('#calcOptions .calc-check').nth(0).check();
    await page.locator('#calcOptions .calc-check').nth(1).check();
    assert.notEqual(await page.textContent('#totalAmount'), before, 'Tarifrechner rechnet');
    await page.click('[data-act="ticket"][data-source="calc"]');
    await page.waitForFunction(() => !document.getElementById('ticketModal').classList.contains('opacity-0'));
    assert.match(await page.inputValue('#tkDesc'), /Gewünschte Leistungen/, 'Auswahl aus dem Rechner übernommen');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('ticketModal').classList.contains('opacity-0'));
    await page.locator('[data-act="faq"]').first().click();
    assert.ok(await page.$('.faq-item.open'), 'FAQ klappt auf');
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  it('Startseite am Handy: Menü, nichts ragt über den Rand', async () => {
    const { ctx, page, problems } = await open(PHONE);
    await page.goto(server.base + '/');
    await page.click('#menuToggle');
    await page.waitForFunction(() => document.getElementById('mobileMenu').classList.contains('open'));
    assert.ok((await overflow(page)) <= 1, 'keine seitliche Scrollleiste');
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  it('Registrierung als Mandant führt ins Dashboard', async () => {
    const { ctx, page, problems } = await open(DESKTOP);
    await page.goto(server.base + '/register.html');
    await page.fill('#displayName', 'Rita Registriert');
    await page.fill('#password', 'Mandanten-Passwort-9');
    await page.fill('#password2', 'Mandanten-Passwort-9');
    for (const box of await page.$$('#registerForm input[type=checkbox]')) await box.check();
    await page.click('#submitBtn');
    await page.waitForURL(/dashboard/);
    await page.waitForSelector('#nav a.nav-item');
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Kanzlei am ${label}: alle Dashboard-Ansichten und eine Akte`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      await login(page, TEAM.admin);
      const views = await page.$$eval('#nav a.nav-item', (as) => as.map((a) => a.getAttribute('href')));
      assert.ok(views.length >= 15, `Menü vollständig (${views.length} Punkte)`);
      for (const view of views) {
        await page.evaluate((h) => (location.hash = h), view);
        await settle();
        assert.ok((await page.textContent('#content')).trim().length > 0, `${view} zeigt Inhalt`);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, `${view}: nichts ragt über den Rand`);
      }
      await page.evaluate(() => (location.hash = '#cases'));
      await settle();
      await page.click(`[data-action="open-case"][data-id="${data.caseId}"] >> nth=0`);
      await settle();
      assert.ok((await page.evaluate(() => document.body.innerText)).includes(data.caseNumber), 'Akte geöffnet');
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Antrag am ${label}: FiveNet-Aktenzeichen vorbelegt und in der Druckansicht ein Link`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      await login(page, TEAM.admin);
      await page.evaluate(() => (location.hash = '#cases'));
      await settle();
      await page.click(`[data-action="open-case"][data-id="${data.caseId}"] >> nth=0`);
      await settle();
      await page.click('[data-action="brief-new"]');
      await settle();
      await page.selectOption('#bf_tpl', { label: 'Antrag auf Akteneinsicht' });
      assert.ok(await page.isVisible('#bf_fivenet_az'), 'Feld sichtbar');
      assert.equal(await page.inputValue('#bf_fivenet_az'), 'DOC - 74412', 'aus der Akte vorbelegt');
      await page.fill('#bf_fivenet_az', '');
      await page.click('[data-action="brief-fivenet"]');
      assert.equal(await page.inputValue('#bf_fivenet_az'), 'DOC - 74412', 'per Klick übernommen');
      if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Formular passt aufs Handy');
      // Auswahl-Knöpfe umbrechen, statt das Formular zu verbreitern (Spalten bleiben gleich breit)
      const widths = await page.$eval('#modalBody', (b) => ({ over: b.scrollWidth - b.clientWidth, cols: [...b.querySelectorAll('[data-bf="betreff"], [data-bf="fivenet_az"]')].map((x) => x.getBoundingClientRect().width) }));
      assert.ok(widths.over <= 1, `Dialog ragt nicht über den Rand (${widths.over}px)`);
      assert.ok(Math.abs(widths.cols[0] - widths.cols[1]) <= 1, `Betreff und Aktenzeichen gleich breit (${widths.cols})`);
      await page.selectOption('#bf_tpl', { label: 'Vollmacht' });
      assert.ok(!(await page.isVisible('#bf_fivenet_az')), 'Vollmacht braucht kein FiveNet-Aktenzeichen');
      await page.selectOption('#bf_tpl', { label: 'Antrag auf Akteneinsicht' });
      await page.click('form[data-form="brief-new"] button[type=submit]');
      await settle();
      const href = await page.getAttribute('#secBriefs a[href^="/vertrag.html"] >> nth=0', 'href');
      await page.goto(server.base + href);
      await page.waitForSelector('.sheet');
      const link = await page.$eval('.sheet a.k-link', (a) => ({ href: a.href, text: a.textContent, target: a.target }));
      assert.deepEqual(link, { href: 'https://fivenet.modernv.net/documents/74412', text: 'DOC - 74412', target: '_blank' });
      assert.ok((await page.textContent('.sheet')).includes('Aktenzeichen: DOC - 74412'));
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Discord-Vorlage am ${label}: gepingte Rolle sichtbar, Versand per DM an eine Rolle`, async () => {
      // Eigener Server mit nachgebauter Discord-Schnittstelle (test/discordStub.js) – es geht nichts nach außen
      const { GUILD, ROLES, MEMBERS } = require('./discordStub');
      const dsrv = await startServer({ env: { DISCORD_BOT_TOKEN: 'test-token', BOT_DM_GAP_MS: '0', PUBLIC_URL: 'https://kanzlei.example' }, preload: [require.resolve('./discordStub')] });
      try {
        const adm = client(dsrv.base);
        await adm.login(TEAM.admin);
        assert.equal((await adm.patch('/api/tickets/settings', { guildId: GUILD })).status, 200);
        const { ctx, page, problems, settle } = await open(device);
        await page.goto(dsrv.base + '/login.html');
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.goto(dsrv.base + '/dashboard.html?tab=bot&modul=messages#settings');
        await page.waitForSelector('[data-action="msg-new"]');
        await settle();
        await page.click('[data-action="msg-new"]');
        await page.fill('#msgName', 'Kooperation Burgershot');
        await page.fill('#msgForm textarea[data-k="data.embed.description"]', 'Hallo zusammen!');
        // Rolle über die Auswahl einfügen → Vorschau zeigt den Rollennamen, Hinweis: pingt (noch) nicht
        await page.click('#msgForm textarea[data-k="data.content"]');
        await page.selectOption('#msgRoleInsert', ROLES.mitarbeiter);
        assert.equal(await page.inputValue('#msgForm textarea[data-k="data.content"]'), `<@&${ROLES.mitarbeiter}>`);
        await page.waitForTimeout(250);
        assert.equal(await page.textContent('#msgPreview .dc-content .dc-mention.role'), '@Mitarbeiter');
        assert.match(await page.textContent('#msgPings'), /Pingt niemanden: @Mitarbeiter/);
        await page.check('#msgForm input[data-k="data.allowMentions"]');
        await page.waitForTimeout(250);
        assert.match(await page.textContent('#msgPings'), /Pingt beim Senden: @Mitarbeiter/);
        // Nicht erwähnbare Rolle: Warnung, dass niemand benachrichtigt wird
        await page.selectOption('#msgRoleInsert', ROLES.burgershot);
        await page.waitForTimeout(250);
        assert.match(await page.textContent('#msgPings'), /@Burgershot erscheint, wird aber nicht benachrichtigt/);
        if (device === PHONE) assert.ok((await page.$eval('#modalBody', (b) => b.scrollWidth - b.clientWidth)) <= 1, 'Editor passt aufs Handy');
        await page.click('#msgForm button[type=submit]');
        await settle();

        // Verwenden → Per DM an Rolle: Empfänger anzeigen, senden, Fortschritt
        await page.click('[data-action="msg-tab"][data-tab="use"]');
        await page.click('[data-action="msg-use-tab"][data-tab="dm"]');
        await settle();
        assert.match(await page.textContent('#msgUse'), /in Direktnachrichten pingt das niemanden/);
        await page.selectOption('#dmRole', ROLES.burgershot);
        await page.click('[data-action="dm-preview"]');
        await page.waitForSelector('#dmPreview .dm-row');
        assert.match(await page.textContent('#dmPreview'), /3 Mitglieder mit @Burgershot/);
        // Namensfelder erst mit „Website-Zugang mitschicken“; Name korrigieren, ein Mitglied abwählen
        assert.equal(await page.isVisible(`.dm-newname[data-id="${MEMBERS.jaywa}"]`), false);
        await page.check('#dmLogin');
        assert.equal(await page.inputValue(`.dm-newname[data-id="${MEMBERS.jaywa}"]`), 'John Jaywa');
        await page.fill(`.dm-newname[data-id="${MEMBERS.jaywa}"]`, 'John Doe');
        await page.uncheck(`.dm-pick[value="${MEMBERS.closed}"]`);
        assert.equal(await page.textContent('[data-dm-count]'), 'An 2 ausgewählte Mitglieder senden');
        if (device === PHONE) assert.ok((await page.$eval('#modalBody', (b) => b.scrollWidth - b.clientWidth)) <= 1, 'DM-Reiter passt aufs Handy');
        await page.click('[data-action="dm-send"]');
        await page.click('[data-ps-dialog="ok"]');
        await page.waitForFunction(() => /fertig/.test(document.querySelector('#dmRuns')?.textContent || ''), null, { timeout: 10000 });
        assert.match(await page.textContent('#dmRuns'), /2\/2 · 2 zugestellt · 2 Konto\/Konten angelegt/);
        assert.ok((await adm.get('/api/admin/users')).json.users.some((u) => u.displayName === 'John Doe' && u.email === 'john.doe@pake-scha.ls'));
        assert.deepEqual(problems, []);
        await ctx.close();
      } finally {
        await dsrv.stop();
      }
    });
  }

  it('Druckansichten: Rechnung und Aktenauszug', async () => {
    const { ctx, page, problems } = await open(DESKTOP);
    await login(page, TEAM.admin);
    await page.goto(`${server.base}/invoice.html?id=${data.invoiceId}`);
    await page.waitForSelector('.paper');
    await page.evaluate(() => {
      window.__printed = 0;
      window.print = () => window.__printed++;
    });
    await page.click('#printBtn');
    assert.equal(await page.evaluate(() => window.__printed), 1, 'Druckknopf');
    await page.goto(`${server.base}/aktenauszug.html?id=${data.caseId}`);
    await page.waitForSelector('.paper h1');
    assert.ok((await page.textContent('.paper')).includes(data.caseNumber));
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});
