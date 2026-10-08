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
  async function login(page, email, base = server.base) {
    await page.goto(base + '/login.html');
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
    it(`Fenster am ${label}: Schließen führt zurück in die Akte, aus der man kam`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      await login(page, TEAM.admin);
      await page.evaluate(() => (location.hash = '#cases'));
      await settle();
      await page.click(`[data-action="open-case"][data-id="${data.caseId}"] >> nth=0`);
      await page.waitForSelector('#modalBody #secContracts');
      const backInCase = async (what) => {
        await page.waitForSelector('#modalBody #secContracts', { timeout: 5000 });
        assert.ok(await page.evaluate((n) => document.querySelector('#modal').classList.contains('open') && document.querySelector('#modalBody').textContent.includes(n), data.caseNumber), `${what}: zurück in der Akte`);
      };
      // Am Handy scrollt das Fenster selbst, am PC die Fläche dahinter
      const scroller = device === PHONE ? '#modalBody' : '#modal';
      const scrollTop = () => page.$eval(scroller, (el) => el.scrollTop);

      // X, Esc und Klick daneben in einem Unterfenster → zurück in die Akte (an dieselbe Stelle)
      await page.$eval('#modalBody [data-action="contract-new"]', (el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      const before = await scrollTop();
      assert.ok(before > 50, `Akte gescrollt (${before})`);
      await page.$eval('#modalBody [data-action="contract-new"]', (el) => el.click()); // ohne erneutes Scrollen durch Playwright
      await page.waitForSelector('#modalBody form[data-form="contract-new"]');
      await page.click('.modal-close');
      await backInCase('Mandatsvertrag → X');
      assert.ok(Math.abs((await scrollTop()) - before) <= 5, `wieder an derselben Stelle (${before} → ${await scrollTop()})`);
      await page.click('#modalBody [data-action="brief-new"]');
      await page.waitForSelector('#modalBody form[data-form="brief-new"]');
      await page.keyboard.press('Escape');
      await backInCase('Schriftsatz → Esc');
      await page.click('#modalBody [data-action="task-new"]');
      await page.waitForSelector('#modalBody form[data-form="task"]');
      await page.mouse.click(5, 5);
      await backInCase('Aufgabe → Klick daneben');
      await page.click('#modalBody [data-action="new-event"]');
      await page.waitForSelector('#modalBody form[data-form="event"]');
      await page.click('#modalBody form[data-form="event"] [data-action="close-modal"]');
      await backInCase('Termin → Abbrechen');

      // Speichern im Unterfenster → zurück in die Akte, Neues ist sofort zu sehen
      await page.click('#modalBody [data-action="task-new"]');
      await page.fill('#modalBody form[data-form="task"] input[name="title"]', `Zeugen anrufen ${label}`);
      await page.click('#modalBody form[data-form="task"] button[type=submit]');
      await backInCase('Aufgabe speichern');
      assert.ok((await page.textContent('#modalBody')).includes(`Zeugen anrufen ${label}`), 'neue Aufgabe in der Akte');

      // Rechnung aus der Akte: Abbrechen → zurück in die Akte
      await page.click('#modalBody [data-action="new-invoice"]');
      await page.waitForSelector('#invoiceForm');
      assert.ok((await page.textContent('.page-head')).includes(`Akte ${data.caseNumber}`), 'Rückweg zur Akte angezeigt');
      await page.click('#invoiceForm [data-action="inv-back"]');
      await backInCase('Rechnung → Abbrechen');

      // Erst in der Akte selbst schließt X das Fenster
      await page.click('.modal-close');
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      assert.deepEqual(problems, []);
      await ctx.close();
    });

    it(`Nachrichten am ${label}: Akte (Kanzlei ↔ Mandant), Bewerbung und Bewerberseite`, async () => {
      const adm = client(server.base);
      const me = await adm.login(TEAM.admin);
      // Mandant mit Konto und eigener Akte (zuständig: Board-Mitglied, das sich gleich anmeldet)
      const email = `chat.${label.toLowerCase()}`;
      const mandant = client(server.base);
      assert.equal((await mandant.post('/api/auth/register', { displayName: `Chat ${label}`, email, password: 'Mandanten-Passwort-1' })).status, 201);
      await mandant.login(email, 'Mandanten-Passwort-1');
      const kase = (await adm.post('/api/cases', { title: `Chat-Akte ${label}`, area: 'zivilrecht', clientEmail: email, lawyerId: me.id })).json.case;
      await mandant.post(`/api/cases/${kase.id}/notes`, { body: `Frage vom Mandanten (${label})` });

      const { ctx, page, problems, settle } = await open(device);
      const watch = (p) => p.on('pageerror', (e) => problems.push(`JavaScript-Fehler: ${e.message}`));
      await login(page, TEAM.admin);
      const badge = device === PHONE ? '#bottomNav a[href="#cases"] .dot-badge' : '#nav a[href="#cases"] .nav-count';
      assert.equal(await page.textContent(badge), '1', 'neue Nachricht in der Navigation');
      await page.evaluate(() => (location.hash = '#cases'));
      await settle();
      assert.ok(await page.$(`[data-action="open-case"][data-id="${kase.id}"] .chat-new`), 'neue Nachricht in der Aktenliste');
      await page.click(`[data-action="open-case"][data-id="${kase.id}"] >> nth=0`);
      await page.waitForSelector('#chatList .chat-msg.in');
      await page.waitForFunction((sel) => !document.querySelector(sel), badge); // beim Öffnen gelesen
      await page.fill('#secChat .chat-input', `Antwort der Kanzlei (${label})`);
      if (device === DESKTOP) await page.press('#secChat .chat-input', 'Enter');
      else await page.click('#secChat .chat-send');
      await page.waitForSelector('#chatList .chat-msg.out');
      assert.equal(await page.inputValue('#secChat .chat-input'), '', 'Eingabe nach dem Senden leer');
      assert.ok((await mandant.get(`/api/cases/${kase.id}/chat`)).json.messages.some((m) => m.body === `Antwort der Kanzlei (${label})`), 'Mandant sieht die Antwort');
      // Antwort des Mandanten erscheint im offenen Chat von selbst
      await mandant.post(`/api/cases/${kase.id}/notes`, { body: `Danke! (${label})` });
      await page.waitForFunction((t) => [...document.querySelectorAll('#chatList .chat-text')].some((e) => e.textContent === t), `Danke! (${label})`, { timeout: 12000 });
      if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Akte mit Chat: nichts ragt über den Rand');
      await page.click('.modal-close');

      // Bewerbung: Stand per Kreis, Nachricht ans Board, Bewerberseite
      const app = (
        await client(server.base).post('/api/public/applications', {
          positionId: null,
          name: `Bewerber ${label}`,
          discord: 'bewerber',
          motivation: 'Ich möchte bei Pake & Scha anfangen und bringe Erfahrung aus der Rechtsberatung mit – gern auch abends.',
          accept: true,
        })
      ).json;
      const appId = (await adm.get('/api/admin/applications')).json.applications.find((a) => a.number === app.number).id;
      await page.evaluate(() => (location.hash = '#applications'));
      await settle();
      await page.click(`[data-action="app-open"][data-id="${appId}"]`);
      await page.waitForSelector('#appChatList');
      await page.click('#modalBody .track-step[data-status="in_pruefung"]');
      await page.waitForSelector('#modalBody .track-step[aria-current="step"] >> text=In Prüfung');
      await page.fill('#secAppChat .chat-input', `Hallo vom Board (${label})`);
      await page.click('#secAppChat .chat-send');
      await page.waitForSelector('#appChatList .chat-msg.out');

      const portal = await ctx.newPage();
      watch(portal);
      await portal.goto(server.base + app.portal);
      await portal.waitForSelector('#bwChat .chat-msg.in');
      assert.equal((await portal.textContent('#bwStatus')).trim(), 'In Prüfung');
      assert.ok((await portal.textContent('#bwChat')).includes(`Hallo vom Board (${label})`));
      await portal.fill('#bwForm textarea', `Antwort des Bewerbers (${label})`);
      await portal.click('#bwForm button[type=submit]');
      await portal.waitForSelector('#bwChat .chat-msg.out');
      if (device === PHONE) assert.ok((await overflow(portal)) <= 1, 'Bewerberseite: nichts ragt über den Rand');
      // Board sieht die Antwort im offenen Fenster (Nachladen)
      await page.waitForFunction((t) => [...document.querySelectorAll('#appChatList .chat-text')].some((e) => e.textContent === t), `Antwort des Bewerbers (${label})`, { timeout: 12000 });
      // Karriereseite: Bewerbung ist auf dem Gerät gemerkt
      await portal.goto(server.base + '/karriere.html');
      await portal.waitForSelector(`#myApplications a[href="${app.portal}"]`);
      assert.deepEqual(problems, []);
      await ctx.close();
    });

    it(`Zurück-Taste am ${label}: schließt Fenster, fragt bei ungespeicherten Eingaben, Akte bleibt beim Neuladen offen`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      await login(page, TEAM.admin);
      await page.evaluate(() => (location.hash = '#cases'));
      await settle();
      const modalOpen = () => page.evaluate(() => document.querySelector('#modal').classList.contains('open'));
      const back = async () => {
        await page.evaluate(() => history.back());
        await page.waitForTimeout(500);
      };
      await page.click(`[data-action="open-case"][data-id="${data.caseId}"] >> nth=0`);
      await page.waitForSelector('#modalBody #secContracts');
      await page.waitForFunction((id) => new URLSearchParams(location.search).get('case') === String(id), data.caseId);

      // Unterfenster → Zurück → Akte → Zurück → Liste (die Seite bleibt dieselbe)
      await page.click('#modalBody [data-action="task-new"]');
      await page.waitForSelector('#modalBody form[data-form="task"]');
      await back();
      await page.waitForSelector('#modalBody #secContracts');
      await back();
      assert.equal(await modalOpen(), false, 'Zurück schließt die Akte');
      assert.equal(await page.evaluate(() => location.hash + location.search), '#cases', 'weiter in der Aktenliste');

      // Ungespeicherte Eingaben: Esc und Zurück fragen nach, „Weiter bearbeiten“ behält alles
      await page.click(`[data-action="open-case"][data-id="${data.caseId}"] >> nth=0`);
      await page.waitForSelector('#modalBody #secContracts');
      await page.click('#modalBody [data-action="task-new"]');
      await page.fill('#modalBody form[data-form="task"] input[name="title"]', 'Nicht verlieren');
      await page.keyboard.press('Escape');
      await page.click('.ps-dialog-root.open [data-ps-dialog="cancel"]');
      await back();
      await page.click('.ps-dialog-root.open [data-ps-dialog="cancel"]');
      await page.waitForTimeout(300);
      assert.equal(await page.inputValue('#modalBody form[data-form="task"] input[name="title"]'), 'Nicht verlieren');
      await page.click('.modal-close');
      await page.click('.ps-dialog-root.open [data-ps-dialog="ok"]'); // Verwerfen
      await page.waitForSelector('#modalBody #secContracts');

      // Neu laden: dieselbe Akte ist wieder offen, Zurück führt in die Liste
      await page.reload();
      await page.waitForSelector('#modalBody #secContracts');
      assert.ok((await page.textContent('#modalBody')).includes(data.caseNumber), 'Akte nach dem Neuladen offen');
      await back();
      assert.equal(await modalOpen(), false);
      assert.equal(await page.evaluate(() => st.view), 'cases');
      assert.deepEqual(problems, []);
      await ctx.close();
    });

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

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Mandantenportal am ${label}: „Was ist zu tun?“, Zahlung melden und bestätigen`, async () => {
      // Eigener Server – die Login-Sperre (20 Anmeldungen je 15 Minuten) zählt je Server
      const psrv = await startServer();
      try {
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        const adm = client(psrv.base);
        const me = await adm.login(TEAM.admin);
        // Mandant mit Akte, offener Rechnung, Vertrag zur Unterschrift und neuer Nachricht der Kanzlei
        const email = `todo.${label.toLowerCase()}`;
        const mandant = client(psrv.base);
        assert.equal((await mandant.post('/api/auth/register', { displayName: `Toni ${label}`, email, password: PASSWORD })).status, 201);
        const kase = (await adm.post('/api/cases', { title: `To-do-Akte ${label}`, area: 'zivilrecht', clientEmail: email, lawyerId: me.id })).json.case;
        const inv = (await adm.post('/api/invoices', { caseId: kase.id, items: [{ description: 'Beratung', quantity: 1, unitPrice: 9000 }] })).json.invoice;
        const { templates } = (await adm.get('/api/contract-templates')).json;
        const defaults = (await adm.get(`/api/cases/${kase.id}/contracts/defaults`)).json;
        const k = (await adm.post(`/api/cases/${kase.id}/contracts`, { templateId: templates.find((t) => t.key === 'mandatsvertrag').id, lawyerId: me.id, data: { ...defaults.data, mandant: `Toni ${label}` } })).json.contract;
        await adm.post(`/api/cases/${kase.id}/notes`, { body: `Bitte den Vertrag unterschreiben (${label}).` });

        const { ctx, page, problems, settle } = await open(device);
        await login(page, `${email}@pake-scha.ls`, psrv.base);
        await settle();
        const titles = () => page.$$eval('#content section.todo .todo-title', (els) => els.map((e) => e.textContent));
        assert.deepEqual(await titles(), [`${k.templateName} unterschreiben`, `Rechnung ${inv.number} über 9.000 $ begleichen`, 'Neue Nachricht von Ihrer Kanzlei']);
        assert.equal(await page.getAttribute(`#content section.todo a[href="/vertrag.html?id=${k.id}"]`, 'target'), '_blank', 'Vertrag öffnet sich zum Unterschreiben');
        const top = await page.$eval('#content section.todo', (el) => el.getBoundingClientRect().top);
        const kpis = await page.$eval('#content .kpi-grid', (el) => el.getBoundingClientRect().top);
        assert.ok(top < kpis, 'Karte steht ganz oben (vor den Kennzahlen)');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Übersicht passt aufs Handy');

        // Zahlung melden – mit Hinweis und Screenshot
        await page.click(`#content section.todo [data-action="inv-pay-report"][data-id="${inv.id}"]`);
        await page.waitForSelector('#modalBody form[data-form="inv-pay-report"]');
        assert.match(await page.textContent('#modalBody .pay-info'), /Maze Bank/);
        await page.fill('#payNote', `Überwiesen heute (${label})`);
        await page.setInputFiles('#modalBody input[name="proof"]', { name: 'ueberweisung.png', mimeType: 'image/png', buffer: PNG });
        assert.equal(await page.textContent('#payProofName'), 'ueberweisung.png');
        if (device === PHONE) assert.ok((await page.$eval('#modalBody', (b) => b.scrollWidth - b.clientWidth)) <= 1, 'Fenster passt aufs Handy');
        await page.click('#modalBody form[data-form="inv-pay-report"] button[type=submit]');
        await page.waitForFunction(() => !document.querySelector('#modal.open'));
        await settle();
        assert.deepEqual(await titles(), [`${k.templateName} unterschreiben`, 'Neue Nachricht von Ihrer Kanzlei'], 'gemeldete Rechnung ist erledigt');
        const report = (await adm.get(`/api/invoices/${inv.id}`)).json.invoice.paymentReport;
        assert.equal(report.note, `Überwiesen heute (${label})`);
        assert.equal(report.proof, true, 'Screenshot hochgeladen');

        // Neue Nachricht: öffnet die Akte direkt beim Chat; danach ist auch dieser Punkt erledigt
        await page.click(`#content section.todo [data-action="open-case-chat"][data-id="${kase.id}"]`);
        await page.waitForSelector('#chatList .chat-msg.in');
        const chatTop = await page.$eval('#secChat', (el) => el.getBoundingClientRect().top);
        assert.ok(chatTop < 300, `Nachrichten sind im Blick (${Math.round(chatTop)}px)`);
        await page.click('.modal-close');
        await settle();
        assert.deepEqual(await titles(), [`${k.templateName} unterschreiben`]);
        assert.deepEqual(problems, []);
        await ctx.close();

        // Kanzlei: Badge an „Rechnungen“, Filter „Zahlung gemeldet“, Nachweis ansehen, Eingang bestätigen
        const staff = await open(device);
        await login(staff.page, TEAM.admin, psrv.base);
        if (device === DESKTOP) assert.equal(await staff.page.textContent('#nav a[href="#invoices"] .nav-count'), '1');
        await staff.page.evaluate(() => (location.hash = '#invoices'));
        await staff.settle();
        await staff.page.click('[data-action="inv-filter"][data-value="gemeldet"]');
        await staff.settle();
        const row = staff.page.locator('tbody tr', { has: staff.page.locator(`text=${inv.number}`) });
        assert.match(await row.textContent(), /Zahlung gemeldet/);
        assert.match(await row.textContent(), new RegExp(`Überwiesen heute \\(${label}\\)`));
        assert.equal(await row.locator('a[href$="/payment-proof"]').getAttribute('target'), '_blank');
        if (device === PHONE) assert.ok((await overflow(staff.page)) <= 1, 'Rechnungen passen aufs Handy');
        await row.locator('[data-action="inv-status"][data-status="bezahlt"]').click();
        await staff.page.waitForFunction(() => /Zahlungseingang bestätigt/.test(document.body.textContent));
        await staff.settle();
        assert.equal((await adm.get(`/api/invoices/${inv.id}`)).json.invoice.status, 'bezahlt');
        if (device === DESKTOP) assert.equal(await staff.page.$('#nav a[href="#invoices"] .nav-count'), null, 'Badge weg');
        assert.deepEqual(staff.problems, []);
        await staff.ctx.close();
      } finally {
        await psrv.stop();
      }
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Discord-Konto am ${label}: mit einem Klick registrieren, Name im Spiel, Konto direkt nach der Mandatsanfrage`, async () => {
      // Eigener Server mit Discord-Anmeldung gegen die nachgebaute Schnittstelle; die Discord-Seite selbst überspringt der Browser
      const dsrv = await startServer({
        env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_CLIENT_ID: '900000000000000003', DISCORD_CLIENT_SECRET: 'test-secret' },
        preload: [require.resolve('./discordStub')],
      });
      try {
        const { ctx, page, problems, settle } = await open(device);
        // Discord selbst gibt es im Test nicht: Der Start der Anmeldung (eigene Website) wird abgefangen – statt zu
        // Discord geht es mit dem Code „user-<ID>“ direkt zurück zur Website, wie nach „Autorisieren“ in Discord.
        // (Weiterleitungsziele wie discord.com fängt Playwright nicht zuverlässig ab – daher schon den ersten Aufruf.)
        let discordId = '';
        let toDiscord = 0;
        await ctx.route(/\/api\/discord\/(register|login|case-account)$/, async (route) => {
          const res = await route.fetch({ maxRedirects: 0 });
          const to = res.headers().location || '';
          if (!to.startsWith('https://discord.com/oauth2/authorize')) return route.fulfill({ response: res });
          toDiscord++;
          const state = new URL(to).searchParams.get('state');
          const cookie = res.headers()['set-cookie'];
          await route.fulfill({ status: 302, headers: { location: `${dsrv.base}/api/discord/callback?code=user-${discordId}&state=${state}`, ...(cookie ? { 'set-cookie': cookie } : {}) } });
        });
        await ctx.route(/^https:\/\/discord\.com\//, (route) => route.abort()); // niemals die echte Seite laden
        const suffix = device === PHONE ? '2' : '1';

        // 1) Registrieren mit Discord → Dashboard fragt einmal nach dem Namen im Spiel
        discordId = `90000000000000016${suffix}`;
        await page.goto(dsrv.base + '/register.html');
        await page.waitForSelector('#discordBlock:not(.hidden) a[href="/api/discord/register"]');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Registrierung passt aufs Handy');
        await page.click('#discordBlock a[href="/api/discord/register"]');
        await page.waitForURL(/dashboard\.html/);
        await page.waitForSelector('#modalBody form[data-form="initial-name"]');
        await page.fill('#inName', 'Tony');
        await page.click('#modalBody form[data-form="initial-name"] button[type=submit]');
        await page.waitForFunction(() => /Vor- und Nachnamen/.test(document.body.textContent));
        await page.fill('#inName', 'Tony Montana');
        await page.click('#modalBody form[data-form="initial-name"] button[type=submit]');
        await page.waitForFunction(() => !document.querySelector('#modal.open'));
        await settle();
        assert.match(await page.textContent('.page-title'), /Tony Montana/);
        await page.reload();
        await page.waitForSelector('#nav a.nav-item', { state: 'attached' });
        await settle();
        assert.equal(await page.$('#modalBody form[data-form="initial-name"]'), null, 'nur einmal gefragt');

        // 2) Abmelden, „Mit Discord anmelden“ mit einem neuen Discord → Login-Seite fragt nach, bevor ein Konto entsteht
        await ctx.clearCookies();
        discordId = `90000000000000017${suffix}`;
        await page.goto(dsrv.base + '/login.html');
        await page.waitForSelector('#discordBlock:not(.hidden)');
        await page.click('#discordBlock a[href="/api/discord/login"]');
        await page.waitForURL(/login\.html\?discord=neu/);
        await page.waitForSelector('#discordSignup:not(.hidden)');
        assert.match(await page.textContent('#discordSignupName'), /Neuer Nutzer/);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Login-Seite passt aufs Handy');
        await page.click('#discordSignupBtn');
        await page.waitForURL(/dashboard\.html/);
        await page.waitForSelector('#modalBody form[data-form="initial-name"]');

        // 3) Mandatsanfrage auf der Startseite → „Konto mit Discord anlegen“ → Akte öffnet sich im Portal
        await ctx.clearCookies();
        discordId = `90000000000000018${suffix}`;
        await page.goto(dsrv.base + '/');
        await page.locator('[data-act="ticket"]').nth(1).click();
        await page.waitForFunction(() => !document.getElementById('ticketModal').classList.contains('opacity-0'));
        await page.fill('#tkName', `Lena Berg ${label}`);
        await page.selectOption('#tkArea', 'zivilrecht');
        await page.fill('#tkDesc', 'Mein Fahrzeug wurde am Pier beschädigt.');
        await page.click('#ticketForm button[type=submit]');
        await page.waitForSelector('#ticketAccount');
        const caseNumber = (await page.textContent('#ticketSuccess .font-mono')).trim();
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Erfolgsanzeige passt aufs Handy');
        await page.click('#ticketAccount');
        await page.waitForURL(/dashboard\.html/);
        await page.waitForSelector('#modalBody #chatList', { timeout: 10000 });
        assert.match(await page.textContent('#modalBody'), new RegExp(caseNumber));
        assert.equal(await page.$('#modalBody form[data-form="initial-name"]'), null, 'Name kommt aus der Mandatsanfrage');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Akte passt aufs Handy');
        assert.equal(toDiscord, 3, 'dreimal zur Discord-Anmeldung weitergeleitet');
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
