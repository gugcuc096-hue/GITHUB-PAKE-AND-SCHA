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
const path = require('node:path');
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
    // angemeldeter Kanzlei-Zugang für Testdaten in den Tests (der Server erlaubt nur 20 Anmeldungen je 15 Minuten)
    data.adminMe = await admin.login(TEAM.admin);
    data.admin = admin;
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
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`JavaScript-Fehler: ${e.message}`));
    page.on('console', (m) => /Content Security Policy|Refused to (execute|load|apply)/.test(m.text()) && problems.push(`CSP: ${m.text()}`));
    let inflight = 0;
    // Die Live-Verbindung (/api/events) bleibt offen – sie zählt nicht als laufende Anfrage
    const counted = (r) => r.url().includes('/api/') && !r.url().includes('/api/events');
    page.on('request', (r) => counted(r) && inflight++);
    const done = (r) => counted(r) && inflight--;
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
    // Klick daneben schließt das Fenster – die Eingaben bleiben erhalten; Esc schließt ebenso
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => document.getElementById('ticketModal').classList.contains('opacity-0'));
    await page.locator('[data-act="ticket"]').nth(1).click();
    await page.waitForFunction(() => !document.getElementById('ticketModal').classList.contains('opacity-0'));
    assert.match(await page.inputValue('#tkDesc'), /Gewünschte Leistungen/, 'Eingaben bleiben erhalten');
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
      // Der Inhalt scrollt im Fenster selbst (das X oben bleibt stehen)
      const scroller = '#modalBody';
      const scrollTop = () => page.$eval(scroller, (el) => el.scrollTop);

      // X, Esc, Klick daneben und Abbrechen in einem Unterfenster → zurück in die Akte (an dieselbe Stelle)
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

      // Dokumente ohne Druckersymbol: die Nummer öffnet die Ansicht der Website, das Symbol daneben ebenso
      // (ohne verbundenes Google-Konto gibt es kein Google Doc – sonst öffnet das Symbol direkt das Doc)
      assert.equal(await page.$$eval('#modalBody svg path', (ps) => ps.filter((p) => (p.getAttribute('d') || '').startsWith('M17 17h2')).length), 0, 'kein Druckersymbol in der Akte');
      assert.equal(await page.getAttribute(`#secInvoices a.doc-title[href="/invoice.html?id=${data.invoiceId}"]`, 'target'), '_blank');
      assert.equal(await page.getAttribute(`#secInvoices a.icon-btn[href="/invoice.html?id=${data.invoiceId}"]`, 'aria-label'), 'Ansehen');

      // Weit unten in der Akte: das X bleibt oben rechts sichtbar und klickbar
      await page.$eval(scroller, (el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(300);
      const closeVisible = await page.$eval('.modal-close', (x) => {
        const r = x.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && x.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
      assert.ok(closeVisible, 'X auch unten in der Akte sichtbar');
      await page.$eval(scroller, (el) => (el.scrollTop = 0));
      const [besideX, besideY] = device === PHONE ? [195, 10] : [1340, 450];
      if (device === DESKTOP) {
        // Text markieren und erst neben dem Fenster loslassen – auch das schließt nichts
        const t = await page.$eval('#modalTitle', (h) => {
          const r = h.getBoundingClientRect();
          return { x: r.left + 5, y: r.top + r.height / 2 };
        });
        await page.mouse.move(t.x, t.y);
        await page.mouse.down();
        await page.mouse.move(besideX, t.y, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await backInCase('Akte → markiert bis neben das Fenster');
      }
      // Esc bei offenem „⋯ Mehr“ schließt nur das Menü
      await page.click('#modalBody details.more-menu > summary');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#modalBody details.more-menu', (d) => d.open), false, 'Esc schließt das Menü');
      await backInCase('Esc im Menü');

      // Klick neben die Akte (rechts daneben, am Handy über dem Fenster) schließt sie – dahinter die Aktenliste
      await page.mouse.click(besideX, besideY);
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      assert.equal(await page.evaluate(() => location.hash), '#cases', 'Akte → Klick daneben: Aktenliste');
      // Die Zurück-Taste führt danach zur Seite davor – nicht in das abgebrochene Rechnungsformular
      await page.waitForFunction(() => !history.state && !location.search.includes('case=')); // Eintrag der Akte ist entfernt
      await page.goBack();
      await page.waitForTimeout(500);
      const afterBack = await page.evaluate(() => location.pathname + location.hash);
      assert.ok(afterBack === '/dashboard.html' || afterBack === '/dashboard.html#overview', `Zurück nach abgebrochener Rechnung: Seite davor (${afterBack})`);
      // Die Suche (Strg + K) schließt ebenso per Klick daneben
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#gsInput');
      await page.mouse.click(besideX, besideY);
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
      // Karriereseite: Bewerbung ist auf dem Gerät gemerkt – oben mit Stand, „Meine Bewerbung“ führt direkt hin
      await portal.goto(server.base + '/karriere.html');
      await portal.waitForSelector(`#meine a[href="${app.portal}"] .badge`);
      assert.match(await portal.textContent('#meine'), /In Prüfung/);
      for (const href of await portal.$$eval('[data-my-link]', (as) => as.map((a) => a.getAttribute('href')))) assert.equal(href, app.portal);
      if (device === PHONE) {
        assert.equal(await portal.isVisible('#karMenu a[href="#ablauf"]'), false, 'Menü zu');
        await portal.click('#karMenuBtn');
        await portal.waitForSelector('#karMenu a[href="#ablauf"]', { state: 'visible' });
        await portal.click('#karMenu a[href="#ablauf"]');
        await portal.waitForFunction(() => Math.abs(document.getElementById('ablauf').getBoundingClientRect().top - 88) < 40);
        assert.ok((await overflow(portal)) <= 1, 'Karriereseite: nichts ragt über den Rand');
      } else {
        assert.equal(await portal.$$eval('#positions > article', (a) => new Set(a.map((x) => Math.round(x.getBoundingClientRect().top))).size), 1, 'drei Stellen in einer Reihe');
      }
      // Startseite: „Karriere“ in der Leiste springt zum Karriere-Abschnitt; dort „Meine Bewerbung“ mit Stand
      await portal.goto(server.base + '/');
      if (device === PHONE) {
        await portal.click('#menuToggle');
        await portal.click('#mobileMenu a[href="#karriere"]');
      } else {
        await portal.click('header nav[aria-label="Hauptnavigation"] a[href="#karriere"]');
      }
      await portal.waitForFunction(() => Math.abs(document.getElementById('karriere').getBoundingClientRect().top - 96) < 40);
      assert.equal(await portal.getAttribute('#careerStatus', 'href'), app.portal);
      assert.equal((await portal.textContent('#careerStatus')).trim(), 'Meine Bewerbung');
      await portal.waitForSelector('#careerMine:not(.hidden)');
      assert.match(await portal.textContent('#careerMine'), new RegExp(`${app.number}: In Prüfung`));
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
        // Kennzahlen mit normalen Ziffern (die Schmuckschrift zeichnet sonst „1“ wie „I“ und „0“ wie „o“)
        assert.match(await page.$eval('#content .kpi-value', (el) => getComputedStyle(el).fontVariantNumeric), /lining-nums/);
        // „Mandat einreichen“ steht im Seitenkopf, darunter zwei gleich breite Knöpfe statt einer umbrechenden Reihe
        assert.ok(await page.$('#content .page-actions [data-action="new-case"]'), 'Mandat einreichen im Seitenkopf');
        const widths = await page.$$eval('#content .action-grid > *', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
        assert.equal(widths.length, 2);
        assert.ok(Math.abs(widths[0] - widths[1]) <= 1, `gleich breit (${widths.join(' / ')})`);

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
    it(`Mandantenkartei am ${label}: Liste, Name in der Akte öffnet die Kartei, Notiz, Vermerk in der Akte`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      const adm = data.admin;
      try {
        await login(page, TEAM.admin);
        await page.evaluate(() => (location.hash = '#clients'));
        await page.waitForSelector('#clientList tr.row');
        assert.ok(await page.$('#clientList tr[data-key="n:paul probe"]'), 'Mandant ohne Konto in der Liste');
        await page.fill('#clientSearch', 'probe');
        await page.waitForFunction(() => document.querySelectorAll('#clientList tr.row').length === 1); // Suche filtert (kurz verzögert beim Tippen)
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Liste passt aufs Handy');

        // Der Name in der Akte öffnet die Kartei, X führt zurück in die Akte
        await page.goto(server.base + `/dashboard.html?case=${data.caseId}#cases`);
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        await page.click('#modalBody .client-link');
        await page.waitForSelector('#modalBody form[data-form="client-note"]');
        assert.match(await page.textContent('#modalBody .modal-title'), /Paul Probe/);
        assert.ok(await page.$(`#modalBody [data-action="open-case"][data-id="${data.caseId}"]`), 'Akte in der Kartei');
        // interne Notiz
        await page.fill('#modalBody form[data-form="client-note"] textarea', `Ruft lieber abends an (${label})`);
        await page.click('#modalBody form[data-form="client-note"] button[type=submit]');
        await page.waitForFunction((t) => [...document.querySelectorAll('#modalBody .cn-body')].some((e) => e.textContent === t), `Ruft lieber abends an (${label})`);
        // Vermerk (Board) → erscheint in der Kartei und danach in der Akte
        await page.selectOption('#cfFlag', 'vorkasse');
        await page.fill('#cfReason', `Test ${label}`);
        await page.click('#modalBody form[data-form="client-flag"] button[type=submit]');
        await page.waitForFunction(() => /Nur gegen Vorkasse/.test(document.querySelector('#modalBody .ticket-strip')?.textContent || ''));
        if (device === PHONE) assert.ok((await page.$eval('#modalBody', (b) => b.scrollWidth - b.clientWidth)) <= 1, 'Kartei passt aufs Handy');
        await page.click('.modal-close');
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        assert.match(await page.textContent('#modalBody .ticket-strip'), /Mandantenvermerk: Nur gegen Vorkasse/);
        assert.deepEqual(problems, []);
      } finally {
        await adm.put(`/api/clients/${encodeURIComponent('n:paul probe')}/flag`, { flag: '' }); // andere Tests sehen die Akte ohne Vermerk
        await ctx.close();
      }
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Rechnung aus dem Vertrag, Abschluss mit Ergebnis und „Direkt anfragen“ am ${label}`, async () => {
      const { ctx, page, problems, settle } = await open(device);
      const adm = data.admin;
      const me = data.adminMe;
      // Akte mit Mandatsvertrag (zwei Leistungen) und einer offenen Aufgabe
      const kase = (await adm.post('/api/cases', { title: `Rechnung aus dem Vertrag (${label})`, area: 'strafrecht', clientName: `Vera Vertrag ${label}`, lawyerId: me.id })).json.case;
      const { templates } = (await adm.get('/api/contract-templates')).json;
      const k = await adm.post(`/api/cases/${kase.id}/contracts`, {
        templateId: templates.find((t) => t.key === 'mandatsvertrag').id,
        lawyerId: me.id,
        data: {},
        services: [
          { name: 'Erstberatung', price: 15000, qty: 1 },
          { name: 'Haftprüfung', price: 10000, qty: 2 },
        ],
      });
      assert.equal(k.status, 201, k.text);
      await adm.post('/api/tasks', { title: `Akteneinsicht anfordern (${label})`, caseId: kase.id });
      let site = null;
      try {
        await login(page, TEAM.admin);
        await page.goto(server.base + `/dashboard.html?case=${kase.id}#cases`);
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        // „Rechnung“ in der Akte: Leistungen aus dem Vertrag stehen schon drin
        await page.click(`#modalBody [data-action="new-invoice"][data-case-id="${kase.id}"]`);
        await page.waitForSelector('#invContract .ticket-strip');
        assert.match(await page.textContent('#invContract'), /Aus dem Vertrag übernommen/);
        assert.equal(await page.$$eval('#invItems .item-row', (r) => r.length), 2);
        assert.match(await page.textContent('#invSumFigures'), /Laut Vertrag\s*35\.000/);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Rechnung passt aufs Handy');
        await page.click('[data-action="inv-back"]');
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        // Abschließen über den Status: offene Punkte, Ergebnis ist Pflicht
        await page.selectOption('#modalBody select[data-case-status]', 'geschlossen');
        await page.waitForSelector('#modalBody form[data-form="case-close"]');
        const check = await page.textContent('#modalBody .close-check');
        assert.match(check, /Noch offen/);
        assert.match(check, new RegExp(`Akteneinsicht anfordern \\(${label}\\)`));
        assert.match(check, /Mandatsvertrag – noch nicht unterschrieben/);
        if (device === PHONE) assert.ok((await page.$eval('#modalBody', (b) => b.scrollWidth - b.clientWidth)) <= 1, 'Abschluss passt aufs Handy');
        await page.click('#modalBody form[data-form="case-close"] button[type=submit]');
        assert.ok(await page.$('#modalBody form[data-form="case-close"]'), 'ohne Ergebnis wird nicht abgeschlossen');
        await page.selectOption('#ccOutcome', 'freispruch');
        await page.click('#modalBody form[data-form="case-close"] button[type=submit]');
        await page.waitForSelector('#modalBody select[data-case-outcome]');
        assert.equal(await page.inputValue('#modalBody [data-case-outcome]'), 'freispruch');
        assert.equal(await page.inputValue('#modalBody [data-case-status]'), 'geschlossen');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Aktenkopf mit Ergebnis passt aufs Handy');

        assert.deepEqual(problems, []);

        // Startseite (Besucher ohne Anmeldung): „Direkt anfragen“ auf der Teamkarte
        site = await open(device);
        const guest = site.page;
        await guest.goto(server.base + '/');
        await guest.waitForSelector('#teamGrid [data-wish]');
        const name = await guest.getAttribute('#teamGrid [data-wish]', 'data-name');
        await guest.click('#teamGrid [data-wish]');
        await guest.waitForFunction(() => !document.getElementById('ticketModal').classList.contains('opacity-0'));
        assert.ok(await guest.isVisible('#tkLawyer'));
        assert.equal(await guest.textContent('#tkLawyerName'), name);
        if (device === PHONE) assert.ok((await overflow(guest)) <= 1, 'Mandatsdialog passt aufs Handy');
        await guest.click('[data-act="ticket-lawyer-clear"]');
        assert.equal(await guest.isVisible('#tkLawyer'), false, '„An alle senden“ entfernt den Wunschanwalt');
        if (device === DESKTOP) {
          // Absenden (nur am PC – die Website nimmt je Stunde nur wenige Anfragen an)
          await guest.keyboard.press('Escape');
          await guest.click('#teamGrid [data-wish]');
          await guest.fill('#tkName', 'Wilma Wunsch');
          await guest.fill('#tkDesc', 'Ich möchte genau diesen Anwalt für meine Verteidigung.');
          await guest.click('#ticketForm button[type=submit]');
          await guest.waitForSelector('#ticketSuccess:not(.hidden)');
          assert.ok((await guest.textContent('#ticketSuccess')).includes(`${name} wurde benachrichtigt`), 'Bestätigung nennt den Wunschanwalt');
        }
        assert.deepEqual(site.problems, []);
      } finally {
        await ctx.close();
        if (site) await site.ctx.close();
      }
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Entwürfe, Bilder per Strg+V und Ziehen, Dienststatus am ${label}`, async () => {
      // Eigener Server: der gemeinsame ist nahe am Anmelde-Limit (20 je 15 Minuten)
      const qsrv = await startServer();
      const { ctx, page, problems, settle } = await open(device);
      page.on('dialog', (d) => d.accept()); // „Seite verlassen?“ beim Neuladen mit ungespeicherten Eingaben
      try {
        const adm = client(qsrv.base);
        const me = await adm.login(TEAM.admin);
        const kase = (await adm.post('/api/cases', { title: 'Abgeschlepptes Fahrzeug', area: 'zivilrecht', clientName: 'Dora Dienst', lawyerId: me.id })).json.case;
        assert.equal((await adm.post('/api/duty', { status: 'dienst' })).status, 200);
        await login(page, TEAM.admin, qsrv.base);
        const openKase = async () => {
          await page.goto(qsrv.base + `/dashboard.html?case=${kase.id}#cases`);
          await page.waitForSelector('#modalBody .case-head');
          await settle();
        };
        await openKase();
        // Dienststatus beim zuständigen Anwalt
        assert.match(await page.textContent('#modalBody .duty-tag'), /im Dienst/);

        // Angefangene Nachricht übersteht das Neuladen – nach dem Senden ist sie weg
        const chat = '#modalBody form[data-form="chat-send"] textarea';
        await page.fill(chat, `Bitte morgen anrufen (${label})`);
        await page.waitForTimeout(400);
        await page.reload();
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        assert.equal(await page.inputValue(chat), `Bitte morgen anrufen (${label})`, 'Entwurf wiederhergestellt');

        // Screenshot mit Strg+V → Beweismittel; Hineinziehen zeigt, wohin, und lädt hoch
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMLQkAJfgP8Wm1nyQAAAAASUVORK5CYII=';
        const fire = (type) =>
          page.evaluate(
            ([b64, t]) => {
              const bin = atob(b64);
              const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
              const dt = new DataTransfer();
              dt.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
              const target = document.querySelector('#modalBody .case-head');
              const ev = t === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true });
              target.dispatchEvent(ev);
            },
            [png, type]
          );
        const atts = () => page.$$eval('#modalBody .att', (a) => a.length);
        await fire('paste');
        await page.waitForFunction(() => document.querySelectorAll('#modalBody .att').length === 1);
        await fire('dragenter');
        assert.match(await page.textContent('#dropHint'), /als Beweismittel zur Akte/);
        await fire('drop');
        await page.waitForFunction(() => document.querySelectorAll('#modalBody .att').length === 2);
        assert.equal(await page.$('#dropHint'), null, 'Hinweis verschwindet');
        assert.equal(await atts(), 2);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Akte passt aufs Handy');

        await page.click('#modalBody form[data-form="chat-send"] button[type=submit]');
        await page.waitForFunction((t) => [...document.querySelectorAll('#chatList .bubble, #chatList [class*="bubble"]')].some((b) => b.textContent.includes(t)), `Bitte morgen anrufen (${label})`);
        await page.reload();
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        assert.equal(await page.inputValue(chat), '', 'nach dem Senden kein Entwurf mehr');

        // Rechnung: angefangene Positionen überstehen das Neuladen; „Abbrechen“ verwirft sie
        await page.click(`#modalBody [data-action="new-invoice"][data-case-id="${kase.id}"]`);
        await page.waitForSelector('#invoiceForm');
        await page.click('[data-action="inv-add-item"]');
        await page.fill('#invItems .item-desc', `Abschleppkosten prüfen (${label})`);
        await page.waitForTimeout(500);
        await page.reload();
        await page.waitForSelector('#invItems .item-desc');
        assert.equal(await page.inputValue('#invItems .item-desc'), `Abschleppkosten prüfen (${label})`, 'Rechnungs-Entwurf wiederhergestellt');
        await page.click('[data-action="inv-back"][data-cancel]');
        await page.waitForFunction(() => !document.querySelector('#invoiceForm'));
        await openKase();
        await page.click(`#modalBody [data-action="new-invoice"][data-case-id="${kase.id}"]`);
        await page.waitForSelector('#invoiceForm');
        assert.equal(await page.$$eval('#invItems .item-row', (r) => r.length), 0, 'nach „Abbrechen“ frisch');

        // Startseite: angefangene Mandatsanfrage bleibt erhalten
        await page.goto(qsrv.base + '/');
        await page.locator('[data-act="ticket"]:visible').first().click();
        await page.fill('#tkDesc', `Angefangene Anfrage (${label})`);
        // erst neu laden, wenn der Entwurf gespeichert ist (statt fester Wartezeit – auf langsamen Rechnern dauert es länger)
        await page.waitForFunction((t) => Object.keys(localStorage).some((k) => k.startsWith('ps.draft:') && (localStorage.getItem(k) || '').includes(t)), `Angefangene Anfrage (${label})`);
        await page.reload();
        await page.locator('[data-act="ticket"]:visible').first().click();
        assert.equal(await page.inputValue('#tkDesc'), `Angefangene Anfrage (${label})`);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await qsrv.stop();
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
        // Antwort des Servers festhalten – schlägt der Schritt fehl, steht im Fehler, was zurückkam (samt Server-Log)
        const [sent] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/api/public/cases') && r.request().method() === 'POST'),
          page.click('#ticketForm button[type=submit]'),
        ]);
        const sentBody = await sent.text();
        const why = `Mandatsanfrage: ${sent.status()} ${sentBody}\nCookies: ${JSON.stringify((await ctx.cookies()).map((c) => c.name))}\nServer: ${dsrv.log().slice(-1500)}`;
        assert.equal(sent.status(), 201, why);
        assert.match(sentBody, /"discordSignup":true/, why);
        await page.waitForSelector('#ticketAccount', { timeout: 10000 }).catch(async (err) => {
          // Antwort war richtig, der Knopf fehlt trotzdem: Zustand der Seite festhalten
          const dom = await page.evaluate(() => ({
            url: location.href,
            modal: document.getElementById('ticketModal').className,
            formHidden: document.getElementById('ticketFormWrap').classList.contains('hidden'),
            success: document.getElementById('ticketSuccess').innerHTML.replace(/\s+/g, ' ').slice(0, 600),
            toasts: [...document.querySelectorAll('#toastRoot > *')].map((t) => t.textContent.trim()),
          }));
          throw new Error(`${err.message}\n${why}\nSeite: ${JSON.stringify(dom)}`);
        });
        // Nach dem Absenden schließt ein Klick daneben die Bestätigung nicht (Discord-Beitritt gibt es nur hier)
        await page.mouse.click(5, 5);
        await page.waitForTimeout(300);
        assert.ok(await page.isVisible('#ticketAccount'), 'Bestätigung bleibt offen');
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

    it(`Bedienung am ${label}: Menügruppen, Anliegen-Reiter, Sprungleiste und „Mehr“ in der Akte, Einstellungs-Reiter`, async () => {
      // Eigener Server – die Anmeldungen hier zählen nicht gegen die Sperre des gemeinsamen Servers
      const usrv = await startServer();
      try {
        const adm = client(usrv.base);
        const me = await adm.login(TEAM.admin);
        const mandant = client(usrv.base);
        await mandant.post('/api/auth/register', { displayName: 'Toni Montana', email: 'toni.montana', password: PASSWORD });
        const kase = (await adm.post('/api/cases', { title: 'Körperverletzung Würfelpark', area: 'strafrecht', clientEmail: 'toni.montana', lawyerId: me.id, description: 'Mandant wurde am Würfelpark festgenommen.' })).json.case;
        await adm.post('/api/invoices', { caseId: kase.id, items: [{ description: 'Beratung', quantity: 1, unitPrice: 9000 }] });
        const concern = await mandant.post('/api/concerns', { category: 'beschwerde', subject: 'Rückruf zu meiner Akte', body: 'Bitte melden Sie sich zu meiner Akte, danke.' });
        assert.equal(concern.status, 201, concern.text);

        const { ctx, page, problems, settle } = await open(device);
        await login(page, TEAM.admin, usrv.base);
        await settle();
        const openMenu = async () => {
          if (device === PHONE && !(await page.$('#sidebar.open'))) {
            await page.click('#bottomNav [data-action="open-sidebar"]');
            await page.waitForSelector('#nav a[href="#overview"]', { state: 'visible' });
          }
        };
        const group = (name) => page.$eval(`#nav .nav-toggle[data-group="${name}"]`, (b) => ({ open: b.getAttribute('aria-expanded') === 'true', count: (b.querySelector('.nav-count') || {}).textContent || '' }));
        const usersVisible = () => page.isVisible('#nav a[href="#users"]');

        // Übersicht: leere Bereiche als kurze Zeile, Handy-Leiste mit Aufgaben statt Post
        assert.ok(await page.isVisible('#content .empty-line'), 'leere Bereiche kompakt');
        if (device === PHONE) {
          assert.ok(await page.$('#bottomNav a[href="#tasks"]'), 'Aufgaben unten in der Leiste');
          assert.equal(await page.$('#bottomNav a[href="#mail"]'), null, 'Post steht oben als Briefsymbol');
        }

        // Menü: Verwaltung zugeklappt, Kanzlei und Board-Eingang offen – Auswahl bleibt nach dem Neuladen
        await openMenu();
        assert.deepEqual(await group('Verwaltung'), { open: false, count: '' });
        assert.equal((await group('Kanzlei')).open, true);
        assert.equal((await group('Board-Eingang')).open, true);
        assert.equal(await usersVisible(), false, 'Benutzer stecken in der zugeklappten Verwaltung');
        await page.click('#nav .nav-toggle[data-group="Verwaltung"]');
        assert.equal((await group('Verwaltung')).open, true);
        assert.equal(await usersVisible(), true);
        await page.click('#nav .nav-toggle[data-group="Board-Eingang"]');
        assert.deepEqual(await group('Board-Eingang'), { open: false, count: '1' }, 'zugeklappt: Zähler des neuen Anliegens am Gruppennamen');
        await page.reload();
        await page.waitForSelector('#nav a.nav-item', { state: 'attached' });
        await settle();
        await openMenu();
        assert.equal((await group('Verwaltung')).open, true, 'aufgeklappt gemerkt');
        assert.equal((await group('Board-Eingang')).open, false, 'zugeklappt gemerkt');
        await page.click('#nav .nav-toggle[data-group="Verwaltung"]');
        assert.equal(await usersVisible(), false);
        // Liegt die aktuelle Seite in einer zugeklappten Gruppe, ist sie trotzdem offen
        await page.evaluate(() => (location.hash = '#users'));
        await settle();
        await openMenu();
        assert.equal((await group('Verwaltung')).open, true, 'aktuelle Seite bleibt im Menü sichtbar');
        // … und lässt sich trotzdem zu- und wieder aufklappen, während man auf der Seite ist
        await page.click('#nav .nav-toggle[data-group="Verwaltung"]');
        assert.equal((await group('Verwaltung')).open, false, 'zuklappen auf einer Seite der Gruppe');
        await page.click('#nav .nav-toggle[data-group="Verwaltung"]');
        assert.equal((await group('Verwaltung')).open, true, 'wieder aufklappen');
        await page.click('#nav .nav-toggle[data-group="Verwaltung"]');
        await page.evaluate(() => (location.hash = '#overview'));
        await settle();
        await openMenu();
        assert.equal((await group('Verwaltung')).open, false, 'danach wieder wie gewählt zugeklappt');

        // Anliegen: ein Menüpunkt für das Board, eigene Anliegen als Reiter
        assert.equal(await page.$('#nav a[href="#concerns"]'), null, 'kein zweiter Menüpunkt');
        assert.equal((await page.textContent('#nav a[href="#concerns-board"]')).trim().startsWith('Anliegen'), true);
        await page.evaluate(() => (location.hash = '#concerns-board'));
        await settle();
        assert.ok((await page.textContent('#content')).includes('Rückruf zu meiner Akte'), 'Eingang zeigt das Anliegen');
        await page.click('#content .settings-tabs a[href="#concerns"]');
        await settle();
        assert.equal(await page.evaluate(() => location.hash), '#concerns');
        assert.match(await page.textContent('#content .page-title'), /Meine Anliegen/);
        assert.ok(await page.$('#nav a[href="#concerns-board"].active'), 'Menüpunkt bleibt markiert');
        await page.click('#content .settings-tabs a[href="#concerns-board"]');
        await settle();
        assert.equal(await page.evaluate(() => location.hash), '#concerns-board');

        // Akte: Sprungleiste mit Zahlen, bleibt beim Springen oben stehen
        await page.evaluate((id) => openCase(id), kase.id);
        await page.waitForSelector('#modalBody .case-jump');
        assert.match(await page.textContent('#modalBody .case-jump [data-target="secInvoices"]'), /Rechnungen\s*1/);
        await page.click('#modalBody .case-jump [data-target="secInvoices"]');
        // weich gescrollt – warten, bis der Abschnitt angekommen ist
        await page.waitForFunction(() => {
          const sec = document.getElementById('secInvoices').getBoundingClientRect().top;
          return sec >= document.querySelector('#modalBody .case-jump').getBoundingClientRect().bottom - 2 && sec < window.innerHeight / 2;
        }, null, { timeout: 5000 });
        await page.waitForTimeout(300);
        const pos = await page.evaluate(() => {
          const scroller = document.querySelector('#modalBody');
          const top = scroller.getBoundingClientRect().top;
          const bar = document.querySelector('#modalBody .case-jump').getBoundingClientRect();
          return { scrolled: scroller.scrollTop, barTop: Math.round(bar.top - top), barBottom: bar.bottom, sec: document.getElementById('secInvoices').getBoundingClientRect().top };
        });
        assert.ok(pos.scrolled > 200, `zu den Rechnungen gesprungen (${pos.scrolled})`);
        assert.ok(Math.abs(pos.barTop) <= 2, `Leiste klebt oben (${pos.barTop})`);
        assert.ok(pos.sec >= pos.barBottom - 2 && pos.sec < 844 / 2, `Abschnitt direkt unter der Leiste (${pos.sec} / ${pos.barBottom})`);
        const closeFree = await page.$eval('.modal-close', (x) => {
          const r = x.getBoundingClientRect();
          return r.bottom < 0 || x.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        assert.ok(closeFree, 'die Leiste verdeckt das X zum Schließen nicht');

        // „⋯ Mehr“: seltene Aktionen nur im Menü, Klick daneben schließt es
        assert.equal(await page.$$eval('#modalBody [data-action="delete-case"]', (els) => els.every((e) => e.closest('.more-menu'))), true, 'Löschen steckt im Menü');
        assert.equal(await page.isVisible('#modalBody .more-item[data-action="delete-case"]'), false);
        await page.$eval('#modal', (m) => (m.scrollTop = 0));
        await page.$eval('#modalBody', (m) => (m.scrollTop = 0));
        await page.click('#modalBody details.more-menu > summary');
        assert.equal(await page.isVisible('#modalBody .more-item[data-action="release-case"]'), true);
        await page.click('#modalTitle');
        assert.equal(await page.$eval('#modalBody details.more-menu', (d) => d.open), false, 'Klick daneben schließt das Menü');
        await page.click('#modalBody details.more-menu > summary');
        await page.click('#modalBody .more-item[data-action="release-case"]');
        await page.waitForSelector('#psDialogTitle');
        assert.equal(await page.textContent('#psDialogTitle'), 'Akte abgeben?');
        await page.click('[data-ps-dialog="cancel"]');
        assert.equal((await adm.get(`/api/cases/${kase.id}`)).json.case.lawyerId, me.id, 'abgebrochen – Akte bleibt');
        await page.click('#modalBody details.more-menu > summary');
        await page.click('#modalBody .more-item[data-action="delete-case"]');
        await page.waitForSelector('[data-ps-dialog="ok"]');
        await page.click('[data-ps-dialog="ok"]');
        await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
        assert.equal((await adm.get(`/api/cases/${kase.id}`)).status, 404, 'Akte gelöscht (Papierkorb)');

        // Einstellungen: sechs Reiter, Discord mit Webhook und Login als Module, System mit Datensicherung
        await page.evaluate(() => (location.hash = '#settings'));
        await settle();
        assert.deepEqual(await page.$$eval('#content .settings-tabs .chip', (els) => els.map((e) => e.textContent.trim())), ['Kanzlei & Rechnungen', 'Website & Ränge', 'Discord', 'Integrationen', 'System', 'Vertragsvorlagen']);
        assert.ok(await page.$('#content form[data-form="settings-firm"]'));
        // Website & Ränge: Bearbeiten-Links, Ränge mit Knöpfen, Rang-Dialog
        await page.click('#content .settings-tabs [data-tab="site"]');
        await settle();
        assert.equal(await page.locator('#content a[href="/?bearbeiten"]').count(), 1);
        assert.equal(await page.locator('#content [data-action="rank-edit"][data-id]').count(), 6, 'sechs Ränge');
        assert.ok((await overflow(page)) <= 1, `${label}: Website & Ränge passt in die Breite`);
        await page.locator('#content [data-action="rank-edit"][data-id]').first().click();
        await page.waitForSelector('form[data-form="rank"]');
        assert.equal(await page.inputValue('form[data-form="rank"] input[name="name"]'), 'Founding Partner');
        await page.keyboard.press('Escape');
        await settle();
        await page.click('#content .settings-tabs [data-tab="integrations"]');
        await settle();
        assert.match(await page.textContent('#content'), /FiveNet[\s\S]*Google Docs/);
        await page.click('#content .settings-tabs [data-tab="system"]');
        await settle();
        assert.match(await page.textContent('#content'), /Datensicherung[\s\S]*Notfall/);
        await page.click('#content .settings-tabs [data-tab="bot"]');
        await settle();
        await page.click('#content .bot-nav-item[data-module="webhook"]');
        await settle();
        await page.fill('#content form[data-form="settings-discord"] input[name="pingRole"]', '1546979799820537986');
        await page.click('#content form[data-form="settings-discord"] button[type=submit]');
        await settle();
        assert.equal((await adm.get('/api/admin/settings')).json.settings.discordPingRole, '1546979799820537986', 'Webhook-Einstellungen speichern wie zuvor');
        // Alter Link aus Hinweisen (?tab=bot&modul=login) führt weiter zum richtigen Modul
        await page.goto(`${usrv.base}/dashboard.html?tab=bot&modul=login#settings`);
        await page.waitForSelector('#content .bot-nav-item[data-module="login"].active');
        assert.match(await page.textContent('#content'), /Discord-Login/);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Einstellungen passen aufs Handy');

        // Mitarbeiter ohne Board: „Anliegen ans Board“ unter Kanzlei, kein Board-Eingang
        if (device === DESKTOP) {
          const staff = await open(device);
          await login(staff.page, TEAM.anwalt, usrv.base);
          assert.ok(await staff.page.$('#nav .nav-group a[href="#concerns"]'), 'eigener Punkt „Anliegen ans Board“');
          assert.equal(await staff.page.$('#nav .nav-toggle[data-group="Board-Eingang"]'), null);
          assert.deepEqual(staff.problems, []);
          await staff.ctx.close();
        }
        assert.deepEqual(problems, []);
        await ctx.close();
      } finally {
        await usrv.stop();
      }
    });

    it(`Schließen am ${label}: Akte aus einem Discord-Link führt zur Aktenliste, Druckansichten zurück in die Akte`, async () => {
      // Eigener Server – die Anmeldungen hier zählen nicht gegen die Sperre des gemeinsamen Servers
      const rsrv = await startServer();
      try {
        const adm = client(rsrv.base);
        const me = await adm.login(TEAM.admin);
        const kase = (await adm.post('/api/cases', { title: `Rückweg ${label}`, area: 'zivilrecht', clientName: 'Rita Rückweg', lawyerId: me.id })).json.case;
        const inv = (await adm.post('/api/invoices', { caseId: kase.id, items: [{ description: 'Beratung', quantity: 1, unitPrice: 9000 }] })).json.invoice;
        const { templates } = (await adm.get('/api/contract-templates')).json;
        const defaults = (await adm.get(`/api/cases/${kase.id}/contracts/defaults`)).json;
        const k = (await adm.post(`/api/cases/${kase.id}/contracts`, { templateId: templates.find((t) => t.key === 'mandatsvertrag').id, lawyerId: me.id, data: defaults.data })).json.contract;

        const { ctx, page, problems, settle } = await open(device);
        await login(page, TEAM.admin, rsrv.base);
        const closedTo = async (p, what) => {
          await p.click('.modal-close');
          await p.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
          await p.waitForTimeout(300);
          assert.equal(await p.evaluate(() => location.hash), '#cases', `${what}: X führt zur Aktenliste`);
          assert.match(await p.textContent('#pageTitle'), /Akten/, `${what}: Aktenliste sichtbar`);
        };

        // 1) „Im Dashboard öffnen“ aus dem Discord-Ticket bzw. /akte (Link ohne Seite): dahinter liegt die Aktenliste
        await page.goto(`${rsrv.base}/dashboard.html?case=${kase.id}`);
        await page.waitForSelector('#modalBody .case-jump');
        await settle();
        await closedTo(page, 'Discord-Link');

        // 2) Vertrag, Rechnung und Aktenauszug aus der Akte (neuer Tab): „← Zur Akte“ schließt den Tab – die Akte ist noch offen
        await page.click(`[data-action="open-case"][data-id="${kase.id}"] >> nth=0`);
        await page.waitForSelector('#modalBody .case-jump');
        for (const href of [`/vertrag.html?id=${k.id}`, `/invoice.html?id=${inv.id}`, `/aktenauszug.html?id=${kase.id}`]) {
          const [tab] = await Promise.all([ctx.waitForEvent('page'), page.$eval(`#modalBody a[href="${href}"]`, (a) => a.click())]);
          await tab.waitForFunction(() => document.getElementById('backLink').href.includes('?case='));
          assert.match(await tab.textContent('#backLink'), /Zur Akte/, `${href}: Knopf „Zur Akte“`);
          // Der Tab schließt sich mitten im Klick – Playwright meldet das als Fehler des Klicks, entscheidend ist „close“
          await Promise.all([tab.waitForEvent('close'), tab.click('#backLink').catch(() => {})]);
          assert.ok(await page.isVisible('#modalBody .case-jump'), `${href}: Akte im Dashboard noch offen`);
        }
        await closedTo(page, 'Akte aus der Liste');

        // 3) Druckansicht direkt aufgerufen (z. B. „Lesen & unterschreiben“ aus Discord): „← Zur Akte“ öffnet die Akte, X führt zur Liste
        const direct = await ctx.newPage();
        await direct.goto(`${rsrv.base}/vertrag.html?id=${k.id}`);
        await direct.waitForFunction(() => document.getElementById('backLink').href.includes('?case='));
        await direct.click('#backLink');
        await direct.waitForURL(/dashboard\.html/);
        await direct.waitForSelector('#modalBody .case-jump');
        await direct.waitForTimeout(300);
        await closedTo(direct, 'Vertrag direkt');

        // 4) Direkt vor der Akte liegt im Verlauf die Website (neu geladen, aus Discord, Brave überspringt Einträge):
        //    X bleibt trotzdem im Dashboard – früher führte das „Zurück“ beim Schließen auf die Website
        await direct.goto(`${rsrv.base}/`);
        await direct.evaluate((id) => history.pushState({ psOverlay: 1 }, '', `/dashboard.html?case=${id}#cases`), kase.id);
        await direct.reload();
        await direct.waitForSelector('#modalBody .case-jump');
        await direct.waitForTimeout(300);
        await closedTo(direct, 'Website davor');
        assert.equal(new URL(direct.url()).pathname, '/dashboard.html', 'X verlässt das Dashboard nicht');

        // 5) Normaler Weg: Der Eintrag der Akte verschwindet wieder – „Zurück“ führt danach zur Seite davor
        await direct.evaluate(() => (location.hash = '#overview'));
        await direct.waitForTimeout(400);
        await direct.evaluate(() => (location.hash = '#cases'));
        await direct.waitForSelector(`[data-action="open-case"][data-id="${kase.id}"]`);
        await direct.click(`[data-action="open-case"][data-id="${kase.id}"] >> nth=0`);
        await direct.waitForSelector('#modalBody .case-jump');
        await direct.waitForTimeout(300);
        await closedTo(direct, 'Akte aus der Liste');
        await direct.goBack();
        await direct.waitForFunction(() => location.hash === '#overview');
        assert.deepEqual(problems, []);
        await ctx.close();
      } finally {
        await rsrv.stop();
      }
    });

    it(`Aktenkopf am ${label}: nur Priorität (Mandanten-Angabe als Hinweis), Status als Auswahl, leere Abschnitte als eine Zeile, liegengebliebene Akten`, async () => {
      // Eigener Server – Mandatsanfragen und Anmeldungen zählen nicht gegen die Sperren des gemeinsamen Servers
      const ksrv = await startServer();
      try {
        const adm = client(ksrv.base);
        const me = await adm.login(TEAM.admin);
        const web = await client(ksrv.base).post('/api/public/cases', { name: 'Lena Berg', phone: '555-0101', area: 'zivilrecht', urgency: 'eilig', description: 'Mein Fahrzeug wurde am Pier beschädigt.', website: '' });
        assert.equal(web.status, 201, web.text);
        const webCase = (await adm.get('/api/cases')).json.cases.find((c) => c.caseNumber === web.json.caseNumber);
        assert.equal(webCase.priority, 3, 'Eilig → Hohe Priorität');
        const partner = (await adm.get('/api/directory')).json.lawyers.find((l) => l.displayName.includes('Scha'));
        const quiet = (await adm.post('/api/cases', { title: 'Körperverletzung Würfelpark', area: 'strafrecht', clientName: 'Toni', lawyerId: me.id, coLawyerIds: [partner.id] })).json.case;
        await adm.post('/api/tasks', { title: 'Wiedervorlage Würfelpark', dueDate: new Date().toISOString().slice(0, 10) });
        // Seit 8 Tagen nichts passiert (Standard-Schwelle: 5 Tage)
        const { DatabaseSync } = require('node:sqlite');
        const sql = new DatabaseSync(path.join(ksrv.dir, 'test.db'));
        sql.prepare("UPDATE cases SET updated_at = datetime('now', '-8 days') WHERE id = ?").run(quiet.id);
        sql.close();

        const { ctx, page, problems, settle } = await open(device);
        await login(page, TEAM.admin, ksrv.base);
        // Übersicht: liegengebliebene Akte wie in der Aktenliste („🕓 vor 8 Tagen“ + Streifen, kein Etikett), Aufgaben mit
        // Fälligkeit und Knöpfen in einer Zeile, leere Pinnwand als schmale Zeile, Seite so breit wie die Aktenliste
        await page.goto(`${ksrv.base}/dashboard.html#overview`);
        await page.waitForSelector('#content .attention .list-row.row-idle');
        await settle();
        const ov = await page.evaluate(() => {
          const idle = document.querySelector('#content .attention .list-row.row-idle');
          const side = document.querySelector('#content .attention .task-row .side');
          const [cd, btn] = [side.querySelector('.countdown'), side.querySelector('.icon-btn')].map((e) => e.getBoundingClientRect());
          return {
            idle: idle.querySelector('.act-idle')?.textContent.trim(),
            tag: /liegt seit/.test(idle.textContent),
            stripe: getComputedStyle(idle).boxShadow,
            oneLine: Math.abs(cd.top + cd.bottom - btn.top - btn.bottom) <= 4,
            quiet: [...document.querySelectorAll('#content .quiet-row .quiet-title')].map((e) => e.textContent),
            maxWidth: getComputedStyle(document.querySelector('#content')).maxWidth,
          };
        });
        assert.equal(ov.idle, 'vor 8 Tagen');
        assert.equal(ov.tag, false, 'kein Etikett „liegt seit …“ in der Übersicht');
        assert.match(ov.stripe, /rgb\(245, 158, 11\)/, 'Streifen wie in der Aktenliste');
        assert.ok(ov.oneLine, 'Fälligkeit und Knöpfe der Aufgabe in einer Zeile');
        assert.deepEqual(ov.quiet, ['Pinnwand'], 'leere Pinnwand als schmale Zeile, offene Anfrage (Lena Berg) als Kasten');
        assert.equal(ov.maxWidth, '1760px', 'alle Seiten gleich breit');
        await page.goto(`${ksrv.base}/dashboard.html#cases`);
        await page.waitForSelector('#caseList tr.row');
        await settle();
        // Aktenliste: kein Etikett unter dem Titel – „Aktenzeichen · Rechtsgebiet“ in einer Zeile, liegengeblieben steht in
        // „Letzte Aktivität“ (Bernstein, Uhr) und als Streifen am Zeilenanfang; eigener Filter
        const qRow = `#caseList tr.row[data-id="${quiet.id}"]`;
        assert.doesNotMatch(await page.textContent(`${qRow} .td-main`), /liegt seit/);
        assert.match((await page.textContent(`${qRow} .case-meta`)).trim(), /^PS-\d{4}-\d{4}\s*·\s*Strafrecht$/);
        assert.ok((await page.$$eval('#caseList th', (ths) => ths.map((t) => t.textContent))).includes('Letzte Aktivität'));
        assert.equal((await page.textContent(`${qRow} td[data-label="Letzte Aktivität"] .act-idle`)).trim(), 'vor 8 Tagen');
        // Status genauer als „In Bearbeitung“: der Schritt des Verfahrens bzw. „Offen“; Priorität kurz („Hoch“)
        assert.equal((await page.textContent(`${qRow} td[data-label="Status"]`)).trim(), 'Eingang');
        assert.equal((await page.textContent(`#caseList tr.row[data-id="${webCase.id}"] td[data-label="Status"]`)).trim(), 'Offen');
        assert.equal((await page.textContent(`#caseList tr.row[data-id="${webCase.id}"] td[data-label="Priorität"]`)).trim(), 'Hoch');
        assert.match(await page.getAttribute(`${qRow} .act-idle`, 'title'), /Liegt seit 8 Tagen ohne Aktivität/);
        assert.equal((await page.textContent(`#caseList tr.row[data-id="${webCase.id}"] td[data-label="Letzte Aktivität"]`)).trim(), 'heute');
        assert.equal(await page.$(`#caseList tr.row[data-id="${webCase.id}"] .act-idle`), null);
        const list = await page.evaluate((sel) => {
          const row = document.querySelector(sel);
          const lead = row.querySelector('.who-lead');
          const card = getComputedStyle(row).display === 'block'; // Handy: Zeilen als Karten, Streifen am Kartenrand
          return {
            stripe: getComputedStyle(card ? row : row.cells[0]).boxShadow,
            otherStripe: [...document.querySelectorAll('#caseList tr.row:not(.row-idle)')].map((r) => getComputedStyle(r).boxShadow + getComputedStyle(r.cells[0]).boxShadow).join(''),
            leadLines: lead.getClientRects().length,
            coBelow: lead.parentElement.lastElementChild.getBoundingClientRect().top >= lead.getBoundingClientRect().bottom - 1,
            maxWidth: getComputedStyle(document.querySelector('#content')).maxWidth,
          };
        }, qRow);
        assert.match(list.stripe, /rgb\(245, 158, 11\)/, `Streifen am Zeilenanfang (${list.stripe})`);
        assert.doesNotMatch(list.otherStripe, /rgb\(245, 158, 11\)/, 'kein Streifen bei aktiven Akten');
        // Handy-Karte: Haupt- und Mitanwälte als ein Block rechts – früher zerriss der Name mitten in der Karte
        if (device === PHONE) assert.equal(list.leadLines, 1, 'federführender Anwalt in einer Zeile');
        assert.ok(list.coBelow, 'Mitanwälte unter dem federführenden Anwalt');
        assert.equal(list.maxWidth, '1760px', 'Aktenliste darf breiter werden');
        // Einheitlich: alle Markierungen (Status, Priorität, „liegt seit …“) im selben Stil – flaches Etikett, kein Knopf-Rand
        const tags = await page.$$eval('#caseList .badge', (els) => {
          const body = getComputedStyle(document.body).fontFamily;
          return { n: els.length, styles: [...new Set(els.map((e) => { const cs = getComputedStyle(e); return `${cs.borderTopLeftRadius}|${cs.borderTopWidth}|${cs.fontFamily === body}`; }))] };
        });
        assert.ok(tags.n >= 4, 'Markierungen in der Liste');
        assert.deepEqual(tags.styles, ['6px|0px|true'], 'ein Stil für alle Markierungen');
        assert.doesNotMatch(await page.textContent(`#caseList tr.row[data-id="${webCase.id}"]`), /liegt seit/);
        await page.click('[data-action="case-filter"][data-value="liegt"]');
        await page.waitForFunction(() => document.querySelectorAll('#caseList tr.row').length === 1);
        assert.equal(await page.getAttribute('#caseList tr.row', 'data-id'), String(quiet.id));
        await page.click('[data-action="case-filter"][data-value="aktiv"]');

        // Website-Anfrage „Eilig“: Kanzlei sieht die Priorität, die Angabe des Mandanten nur als Hinweis daneben
        await page.click(`#caseList tr.row[data-id="${webCase.id}"]`);
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        assert.equal(await page.inputValue('#modalBody [data-case-priority]'), '3');
        assert.equal((await page.textContent('#modalBody .prop-urg .prop-k')).trim(), 'Mandant');
        assert.equal((await page.textContent('#modalBody .prop-urg .prop-v')).trim(), 'Eilig');
        // Auswahl im Aktenkopf: Text senkrecht mittig (nicht oben angeklebt, auch mit gestalteter Auswahlliste)
        const sel = await page.$eval('#modalBody [data-case-priority]', (s) => ({ appearance: getComputedStyle(s).appearance, align: getComputedStyle(s).alignItems }));
        if (sel.appearance === 'base-select') assert.equal(sel.align, 'center', 'Status/Priorität senkrecht mittig');
        // Kopf nicht gequetscht: Titel über die volle Breite, die Felder darunter in einer eigenen Zeile
        const [titleBox, propsBox] = await page.$$eval('#modalBody .case-head > *', (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        assert.ok(propsBox.top >= titleBox.bottom - 1, 'Felder unter dem Titel');
        assert.doesNotMatch(await page.textContent('#modalBody .info-grid'), /Dringlichkeit/);
        await page.click('#modalBody details.edit-box summary');
        assert.equal(await page.$('#modalBody form[data-form="case-edit"] [name="urgency"]'), null, 'nur Priorität bearbeiten');
        await page.click('#modalBody details.edit-box summary');
        // Status als Auswahl neben der Priorität (keine Status-Knöpfe mehr)
        assert.equal(await page.inputValue('#modalBody [data-case-status]'), 'offen');
        assert.equal(await page.$('#modalBody [data-action="case-status"]'), null);
        // Auswahl = genauer Stand: Offen, die vier Schritte, Abgeschlossen
        assert.deepEqual(
          await page.$$eval('#modalBody [data-case-status] option', (o) => o.map((x) => x.textContent)),
          ['Offen', 'Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung', 'Abgeschlossen']
        );
        await page.selectOption('#modalBody [data-case-status]', 'step:1');
        await page.waitForFunction(() => document.querySelector('#modalBody [data-case-status]')?.dataset.value === 'step:1');
        assert.match(await page.textContent('#modalBody .timeline'), /Status: Offen → In Bearbeitung · Verfahrensstand: Akteneinsicht|Verfahrensstand: Akteneinsicht · Status: Offen → In Bearbeitung/);
        // Kennzahlen: erste Zeile im Raster der Angaben (Bezeichnung über dem Wert wie alle Angaben)
        assert.equal(await page.$$eval('#modalBody .info-grid .fact', (els) => els.length), 3);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Aktenkopf passt aufs Handy');

        // Akte schließen und sofort auf einen Menüpunkt tippen, während der Sprung zurück im Verlauf noch läuft
        // (hier künstlich verzögert): Früher landete der Sprung danach wieder auf „Akten“ – Adresse und Ansicht
        // passten nicht mehr zusammen, ein Tipp auf „Akten“ tat dann nichts.
        await page.evaluate(() => {
          const real = navigation.traverseTo.bind(navigation);
          window.__traversing = false;
          navigation.traverseTo = (key, opts) => {
            window.__traversing = true;
            const later = new Promise((r) => setTimeout(r, 300)).then(() => real(key, opts));
            return { committed: later.then((t) => t.committed), finished: later.then((t) => t.finished) };
          };
        });
        await page.click('.modal-close');
        await page.waitForFunction(() => window.__traversing);
        await page.evaluate(() => (location.hash = '#applications'));
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => location.hash), '#applications', 'Adresse bleibt beim gewählten Menüpunkt');
        await page.waitForFunction(() => /Bewerbungen/.test(document.querySelector('.page-title')?.textContent || ''));
        await page.evaluate(() => delete navigation.traverseTo);
        await page.evaluate(() => (location.hash = '#cases'));
        await page.waitForSelector('#caseList tr.row');
        await settle();

        // Neue Akte: keine Dringlichkeit, Priorität „Normal“ vorbelegt
        await page.click('[data-action="new-case"]');
        await page.waitForSelector('#modalBody form[data-form="new-case"]');
        assert.equal(await page.$('#modalBody form[data-form="new-case"] [name="urgency"]'), null);
        assert.equal(await page.inputValue('#modalBody form[data-form="new-case"] [name="priority"]'), '2');
        await page.click('.modal-close');
        await page.waitForFunction(() => !document.querySelector('#modal.open'));

        // Leere Akte: kurze Zeilen mit Knopf statt Überschrift + Erklärtext; liegengeblieben im Aktenkopf
        await page.click(`#caseList tr.row[data-id="${quiet.id}"]`);
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        for (const [id, action] of [['secEvents', 'new-event'], ['secContracts', 'contract-new'], ['secBriefs', 'brief-new'], ['secExternal', 'fn-add'], ['secTasks', 'task-new']]) {
          assert.ok(await page.$(`#modalBody #${id}.sec-empty [data-action="${action}"]`), `${id}: eine Zeile mit „${action}“`);
        }
        assert.ok(await page.$('#modalBody #secEvidence.sec-empty input[type=file][data-upload="evidence"]'), 'Bilder hinzufügen direkt in der Zeile');
        // Titel und Knöpfe mittig zwischen den Linien – oben und unten gleich viel Luft, nichts sitzt auf der nächsten Linie
        const gaps = await page.$$eval('#modalBody .sec-empty', (rows) =>
          rows.map((row) => {
            const r = row.getBoundingClientRect();
            const kids = [...row.children].map((k) => k.getBoundingClientRect()).filter((k) => k.height);
            const top = Math.min(...kids.map((k) => k.top)) - r.top - parseFloat(getComputedStyle(row).borderTopWidth);
            return { id: row.id, top: Math.round(top), bottom: Math.round(r.bottom - Math.max(...kids.map((k) => k.bottom))) };
          })
        );
        for (const g of gaps) {
          assert.ok(g.bottom >= 8, `${g.id}: Abstand zur Linie darunter (${g.bottom}px)`);
          assert.ok(Math.abs(g.top - g.bottom) <= 2, `${g.id}: mittig (oben ${g.top}px, unten ${g.bottom}px)`);
        }
        // Liegengeblieben: ruhige Leiste ganz oben mit „Wiedervorlage“ und „Notiz“ – nicht mehr gequetscht zwischen den Kennzahlen
        assert.match(await page.textContent('#modalBody .idle-strip'), /Liegt seit 8 Tagen/);
        assert.ok(await page.$('#modalBody .idle-strip [data-action="task-new"]'), 'Wiedervorlage aus der Leiste');
        assert.doesNotMatch(await page.textContent('#modalBody .info-grid'), /liegengeblieben/);
        await page.click('#modalBody .idle-strip [data-action="note-focus"]');
        await page.waitForFunction(() => document.activeElement && document.activeElement.matches('#secNotes textarea[name="body"]'));
        // Einheitliche Knöpfe: alle kleinen Knöpfe gleich hoch (am Handy dürfen Schnellaktionen zweizeilig sein), Symbol-Knöpfe rund
        const design = await page.evaluate(() => {
          const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
          const close = document.querySelector('#modal .modal-close').getBoundingClientRect();
          // Abstand der Leisten-Knöpfe zum linken und rechten Innenrand der Leiste
          const strip = document.querySelector('#modalBody .idle-strip .ticket-strip');
          const cs = getComputedStyle(strip);
          const sr = strip.getBoundingClientRect();
          const kids = [...strip.querySelectorAll('.ts-actions > *')].map((e) => e.getBoundingClientRect());
          return {
            sm: [...new Set(shown('#modalBody .btn-sm').filter((e) => !e.closest('.case-quick')).map((e) => Math.round(e.getBoundingClientRect().height)))],
            close: [Math.round(close.width), Math.round(close.height), getComputedStyle(document.querySelector('#modal .modal-close')).borderTopLeftRadius],
            strip: [
              Math.round(kids[0].left - (sr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft))),
              Math.round(sr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) - kids[kids.length - 1].right),
            ],
          };
        });
        assert.deepEqual(design.sm, [36], `kleine Knöpfe gleich hoch: ${design.sm}`);
        assert.deepEqual(design.close, [40, 40, '999px'], 'Schließen-Knopf rund');
        // Knöpfe der Leiste: am PC rechts angehängt, am Handy über die ganze Zeile (wie die Schnellaktionen)
        const [gapL, gapR] = design.strip;
        if (device === PHONE) assert.ok(Math.abs(gapL) <= 1 && Math.abs(gapR) <= 1, `Leisten-Knöpfe füllen am Handy die Zeile (${design.strip})`);
        else assert.ok(gapR <= 1 && gapL > 100, `Leisten-Knöpfe am PC rechts (${design.strip})`);
        // Eine Zeile: Titel und Knopf stehen am PC auf gleicher Höhe
        if (device === DESKTOP) {
          const [t, b] = await page.$$eval('#modalBody #secBriefs > *', (els) => [els[0].getBoundingClientRect().top, els[2].getBoundingClientRect().top]);
          assert.ok(Math.abs(t - b) < 20, `Schriftsätze in einer Zeile (${t} / ${b})`);
        }
        // Bearbeitungsstand: fünf Kreise ohne Hinweistext; der fünfte öffnet den Abschluss-Dialog (X ändert nichts, mit
        // Ergebnis wird abgeschlossen), bei abgeschlossener Akte öffnet ein Schritt sie dort wieder
        assert.equal(await page.$$eval('#modalBody .track .track-node', (n) => n.length), 5);
        assert.doesNotMatch(await page.textContent('#modalBody .track'), /anklicken/);
        await page.click('#modalBody [data-action="case-close"]');
        await page.waitForSelector('#modalBody form[data-form="case-close"]');
        await page.click('.modal-close');
        await page.waitForSelector('#modalBody .track');
        await settle();
        assert.equal(await page.inputValue('#modalBody [data-case-status]'), 'step:0', 'Schließen ohne Abschluss ändert nichts');
        await page.click('#modalBody [data-action="case-close"]');
        await page.waitForSelector('#modalBody form[data-form="case-close"]');
        await page.selectOption('#ccOutcome', 'vergleich');
        await page.click('#modalBody form[data-form="case-close"] button[type=submit]');
        await page.waitForFunction(() => document.querySelectorAll('#modalBody .track-node.done').length === 5);
        assert.equal(await page.inputValue('#modalBody [data-case-status]'), 'geschlossen');
        assert.equal(await page.inputValue('#modalBody [data-case-outcome]'), 'vergleich', 'Ergebnis im Aktenkopf');
        assert.match(await page.textContent('#modalBody .timeline'), /Status: In Bearbeitung → Abgeschlossen/);
        await page.click('#modalBody [data-action="case-reopen"][data-step="2"]');
        await page.click('.ps-dialog [data-ps-dialog="ok"]');
        await page.waitForFunction(() => document.querySelector('#modalBody [data-case-status]')?.value === 'step:2');
        assert.equal(await page.$$eval('#modalBody .track-node.done', (n) => n.length), 2, 'wieder offen auf „Strategie“');
        // Knopf in der leeren Zeile funktioniert wie zuvor
        await page.click('#modalBody #secBriefs [data-action="brief-new"]');
        await page.waitForSelector('#modalBody form[data-form="brief-new"]');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'leere Akte passt aufs Handy');
        assert.deepEqual(problems, []);
        await ctx.close();
      } finally {
        await ksrv.stop();
      }
    });

    it(`Startseite am ${label}: Honorarordnung nach Kategorien aufklappbar${device === PHONE ? ', fester Knopf „Mandat anfragen“' : ''}`, async () => {
      const { ctx, page, problems } = await open(device);
      await page.goto(server.base + '/');
      await page.waitForSelector('#priceListContainer .price-head');
      const state = () => page.$$eval('#priceListContainer .price-category', (els) => els.filter((e) => e.style.display !== 'none').map((e) => !e.classList.contains('collapsed')));
      const first = await state();
      assert.ok(first.length >= 3, 'Kategorien vorhanden');
      assert.deepEqual(first, first.map((_, i) => i === 0), 'nur die erste Kategorie ist offen');
      const second = page.locator('#priceListContainer .price-head').nth(1);
      await second.click();
      assert.equal((await state())[1], true, 'Klick öffnet die Kategorie');
      assert.equal(await second.getAttribute('aria-expanded'), 'true');
      await second.press('Enter');
      assert.equal((await state())[1], false, 'Enter klappt wieder zu');
      // Suche: genau die Kategorien mit Treffern gehen auf
      await page.fill('#priceSearch', 'Haft');
      await page.waitForTimeout(300);
      const hits = await page.$$eval('#priceListContainer .price-category', (els) =>
        els.map((e) => [[...e.querySelectorAll('.price-item')].some((i) => i.style.display !== 'none'), !e.classList.contains('collapsed')])
      );
      assert.ok(hits.some(([hit]) => hit), 'Treffer gefunden');
      assert.ok(hits.every(([hit, open]) => hit === open), 'Kategorien mit Treffern offen, ohne Treffer zu');
      await page.fill('#priceSearch', '');
      await page.waitForTimeout(300);
      assert.deepEqual(await state(), first, 'ohne Suche wieder wie am Anfang');
      // Kategorie-Reiter zeigt die Kategorie offen
      await page.locator('.tab-btn[data-cat]:not([data-cat="all"])').nth(2).click();
      await page.waitForTimeout(300);
      assert.deepEqual(await state(), [true]);

      if (device === PHONE) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => !document.getElementById('mobileCta').classList.contains('show'));
        assert.equal(await page.isVisible('#mobileCta'), true);
        assert.equal(await page.$eval('#mobileCta', (b) => getComputedStyle(b).pointerEvents), 'none', 'oben ausgeblendet');
        await page.evaluate(() => window.scrollTo(0, 2500));
        await page.waitForFunction(() => document.getElementById('mobileCta').classList.contains('show'));
        await page.waitForTimeout(400);
        await page.click('#mobileCta');
        await page.waitForFunction(() => !document.getElementById('ticketModal').classList.contains('opacity-0'));
        assert.ok((await overflow(page)) <= 1, 'nichts ragt über den Rand');
      } else {
        assert.equal(await page.isVisible('#mobileCta'), false, 'am PC kein fester Knopf');
      }
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Sofort-Reaktion am ${label}: Haken, Nachricht, Priorität und Stand sofort – bei Fehler zurück mit Hinweis`, async () => {
      const osrv = await startServer(); // eigener Server: der gemeinsame ist nahe am Anmelde-Limit
      const { ctx, page, problems, settle } = await open(device);
      try {
        const adm = client(osrv.base);
        const me = await adm.login(TEAM.admin);
        const kase = (await adm.post('/api/cases', { title: 'Beschlagnahmtes Fahrzeug', area: 'zivilrecht', clientName: 'Sofia Sofort', lawyerId: me.id })).json.case;
        assert.equal((await adm.post('/api/tasks', { title: 'Akteneinsicht beantragen', caseId: kase.id, assignedTo: me.id })).status, 201);
        await login(page, TEAM.admin, osrv.base);
        await page.goto(osrv.base + `/dashboard.html?case=${kase.id}#cases`);
        await page.waitForSelector('#modalBody .case-head');
        await settle();
        // Server antwortet langsam bzw. mit Fehler – die Anzeige wartet nicht darauf
        const slow = (method) => async (route) => {
          if (route.request().method() !== method) return route.continue();
          await new Promise((r) => setTimeout(r, 1500));
          await route.continue().catch(() => {});
        };
        const fail = (method) => (route) =>
          route.request().method() === method ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Datenbank nicht erreichbar.' }) }) : route.continue();
        const hint = (text) => page.waitForFunction((t) => (document.querySelector('#psToastRoot') || {}).textContent?.includes(t), text);
        // Fehlermeldungen stehen 6 Sekunden – vor jedem Fehlerfall die alten entfernen, damit hint() auf die neue wartet
        const clearToasts = () => page.evaluate(() => document.querySelectorAll('#psToastRoot .ps-toast').forEach((t) => t.remove()));

        // Aufgabe abhaken
        await page.route('**/api/tasks/*', slow('PATCH'));
        await page.click('#secTasks .task-check');
        assert.equal(await page.$eval('#secTasks .task-row', (r) => r.classList.contains('is-done')), true, 'Haken sofort da');
        await settle();
        await page.unroute('**/api/tasks/*');
        await page.route('**/api/tasks/*', fail('PATCH'));
        await clearToasts();
        await page.click('#secTasks .task-check');
        await hint('Nicht gespeichert – Datenbank nicht erreichbar.');
        assert.equal(await page.$eval('#secTasks .task-row', (r) => r.classList.contains('is-done')), true, 'Haken springt zurück');
        await page.unroute('**/api/tasks/*');

        // Nachricht: sofort blass sichtbar, danach normal; scheitert sie, steht der Text wieder im Feld
        const chat = '#modalBody form[data-form="chat-send"] textarea';
        const send = '#modalBody form[data-form="chat-send"] button[type=submit]';
        await page.route(`**/api/cases/${kase.id}/notes`, slow('POST'));
        await page.fill(chat, `Termin ist am Freitag (${label})`);
        await page.click(send);
        assert.match(await page.textContent('#chatList .chat-msg.pending'), /Termin ist am Freitag.*wird gesendet/s, 'Nachricht sofort sichtbar');
        assert.equal(await page.inputValue(chat), '', 'Eingabefeld sofort frei');
        await page.waitForFunction(() => !document.querySelector('#chatList .chat-msg.pending'));
        assert.equal(await page.$$eval('#chatList .chat-msg.out', (m) => m.filter((x) => Number(x.dataset.id) > 0).length), 1, 'gespeicherte Nachricht ersetzt die blasse');
        await page.unroute(`**/api/cases/${kase.id}/notes`);
        await page.route(`**/api/cases/${kase.id}/notes`, fail('POST'));
        await page.fill(chat, 'Diese Nachricht scheitert');
        await clearToasts();
        await page.click(send);
        await hint('Nicht gesendet');
        assert.equal(await page.inputValue(chat), 'Diese Nachricht scheitert', 'Text wieder im Eingabefeld');
        assert.equal(await page.$$eval('#chatList .chat-msg.out', (m) => m.length), 1, 'keine gescheiterte Sprechblase übrig');
        await page.unroute(`**/api/cases/${kase.id}/notes`);
        await page.fill(chat, '');

        // Priorität und Bearbeitungsstand
        await page.route(`**/api/cases/${kase.id}`, slow('PATCH'));
        await page.selectOption('#modalBody [data-case-priority]', '4');
        assert.equal(await page.$$eval('#modalBody .prop-prio .prio-bars i.on', (b) => b.length), 4, 'Priorität sofort');
        await settle();
        await page.click('#modalBody button.track-step[data-step="2"]');
        assert.deepEqual(await page.$$eval('#modalBody .track-node', (n) => n.map((x) => (x.classList.contains('current') ? 'c' : x.classList.contains('done') ? 'd' : '-'))), ['d', 'd', 'c', '-', '-'], 'Stand sofort');
        assert.equal(await page.$eval('#modalBody [data-case-status]', (s) => s.value), 'step:2');
        await settle();
        await page.unroute(`**/api/cases/${kase.id}`);
        await page.route(`**/api/cases/${kase.id}`, fail('PATCH'));
        await clearToasts();
        await page.click('#modalBody button.track-step[data-step="3"]');
        await hint('Nicht gespeichert');
        assert.equal(await page.$eval('#modalBody .track-node.current', (n) => n.textContent.trim()), '3', 'Stand springt zurück');
        assert.equal(await page.$eval('#modalBody [data-case-status]', (s) => s.value), 'step:2');
        const saved = (await adm.get(`/api/cases/${kase.id}`)).json.case;
        assert.equal(saved.step, 2);
        assert.equal(saved.priority, 4);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await osrv.stop();
      }
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Anmeldung mit Discord-Code, Kanzlei-Statistik und lange Listen am ${label}`, async () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-2fa-browser-')), 'state.json');
      const zsrv = await startServer({ env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_STUB_STATE: stateFile }, preload: [require.resolve('./discordStub')] });
      const { ctx, page, problems, settle } = await open(device);
      try {
        // Testdaten: 120 laufende Akten (Liste lädt in Fünfziger-Schritten), eine bezahlte Rechnung, ein Abschluss
        const adm = client(zsrv.base);
        const me = await adm.login(TEAM.admin); // noch ohne Discord: nur Passwort
        const ids = [];
        for (let i = 1; i <= 120; i++) ids.push((await adm.post('/api/cases', { title: `Sammelakte ${i}`, area: 'zivilrecht', clientName: `Mandant ${i}`, lawyerId: me.id })).json.case.id);
        const inv = (await adm.post('/api/invoices', { caseId: ids[0], items: [{ description: 'Beratung', quantity: 1, unitPrice: 18000 }] })).json.invoice;
        assert.equal((await adm.patch(`/api/invoices/${inv.id}`, { status: 'bezahlt' })).status, 200);
        assert.equal((await adm.patch(`/api/cases/${ids[0]}`, { status: 'geschlossen', outcome: 'gewonnen' })).status, 200);
        const { DatabaseSync } = require('node:sqlite');
        const sql = new DatabaseSync(path.join(zsrv.dir, 'test.db'));
        sql.prepare('UPDATE users SET discord_id = ?, discord_username = ? WHERE id = ?').run('900000000000000101', 'jaywa', me.id);
        sql.close();

        // Board: nach dem Passwort der Code aus der Discord-DM – sechs Ziffern schicken das Formular von selbst ab
        await page.goto(zsrv.base + '/login.html');
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForSelector('#codeForm:not(.hidden)');
        assert.match(await page.textContent('#codeTo'), /@jaywa/);
        assert.equal(await page.isVisible('#loginForm'), false, 'Passwort-Schritt ausgeblendet');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Code-Schritt passt aufs Handy');
        // „Zurück“: wieder beim Passwort, Knopf bereit
        await page.click('#codeBack');
        assert.equal(await page.isVisible('#loginForm'), true);
        assert.deepEqual(await page.$eval('#submitBtn', (b) => [b.disabled, b.textContent.trim()]), [false, 'Anmelden']);
        await page.fill('#password', PASSWORD);
        await page.click('#submitBtn');
        await page.waitForSelector('#codeForm:not(.hidden)');
        const lastCode = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).dms.pop().content.match(/\*\*(\d{6})\*\*/)[1];
        const code = lastCode();
        await page.fill('#code', code === '000000' ? '111111' : '000000');
        await page.waitForFunction(() => /Noch 4 Versuche/.test(document.querySelector('#codeError').textContent));
        await page.fill('#code', code);
        await page.waitForURL(/dashboard/);
        await page.waitForSelector('#nav a.nav-item');

        // Kanzlei-Statistik: Kennzahlen, zwei Diagramme mit Tooltip, Werte als Tabelle
        await page.goto(zsrv.base + '/dashboard.html#stats');
        await page.waitForSelector('#content .vchart');
        await settle();
        assert.equal(await page.$$eval('#content .vchart', (c) => c.length), 2);
        assert.match(await page.textContent('#content .kpi-grid'), /18\.000 \$/);
        const last = page.locator('#content .vchart-col').nth(11);
        if (device === PHONE) await last.tap();
        else await last.hover();
        await page.waitForSelector('#content .chart-tip:not([hidden])');
        assert.match(await page.textContent('#content .chart-tip:not([hidden])'), /Umsatz\s*18\.000 \$/);
        assert.match(await page.textContent('#content .chart-tip:not([hidden])'), /1 Rechnung bezahlt/);
        await page.click('#content .chart-table > summary');
        assert.equal(await page.$$eval('#content .chart-table[open] tbody tr', (r) => r.length), 12);
        assert.match(await page.textContent('#content .stat-tbl'), /Kanzlei gesamt/);
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Statistik passt aufs Handy');

        // Lange Aktenliste: erst 50, beim Scrollen die nächsten 50, Rest per Knopf
        await page.goto(zsrv.base + '/dashboard.html#cases');
        await page.waitForSelector('#content tr[data-action="open-case"]');
        await settle();
        const rows = () => page.$$eval('#content tr[data-action="open-case"]', (r) => r.length);
        assert.equal(await rows(), 50);
        await page.locator('#content tr.more-rows').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelectorAll('#content tr[data-action="open-case"]').length === 100);
        assert.match(await page.textContent('#content tr.more-rows'), /19 weitere Einträge/);
        await page.click('#content tr.more-rows .more-btn');
        assert.equal(await rows(), 119);
        assert.equal(await page.$$('#content tr.more-rows').then((x) => x.length), 0, 'kein Knopf mehr');
        // Suche filtert weiterhin über alle Akten
        await page.fill('#caseSearch', 'Sammelakte 117');
        await page.waitForFunction(() => document.querySelectorAll('#content tr[data-action="open-case"]').length === 1);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await zsrv.stop();
      }
    });
  }

  for (const [label, device] of [['PC', DESKTOP], ['Handy', PHONE]]) {
    it(`Bewerbung ohne Zugangscode am ${label}: „Discord verbinden“ nach dem Absenden, „Mit Discord öffnen“ auf anderen Geräten`, async () => {
      const bsrv = await startServer({
        env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_CLIENT_ID: '900000000000000003', DISCORD_CLIENT_SECRET: 'test-secret' },
        preload: [require.resolve('./discordStub')],
      });
      const { ctx, page, problems } = await open(device);
      try {
        await page.goto(bsrv.base + '/karriere.html');
        await page.waitForSelector('#applyForm');
        await page.evaluate(() => {
          const f = document.getElementById('applyForm');
          f.elements.name.value = 'Lena Link';
          f.elements.discord.value = 'lena.link';
          f.elements.motivation.value = 'Ich möchte bei Pake & Scha als Associate einsteigen und meine Erfahrung im Strafrecht einbringen.';
          f.elements.accept.checked = true;
          f.requestSubmit();
        });
        await page.waitForSelector('#applySuccess:not(.hidden) #joinApply');
        const box = await page.textContent('#applySuccess');
        assert.match(box, /Jetzt Discord verbinden/);
        assert.doesNotMatch(box, /Zugangscode/, 'kein Zugangscode mehr');
        assert.equal(await page.isVisible('#statusDiscord a[href="/api/discord/application-open"]'), true, '„Mit Discord öffnen“ unten');
        assert.equal(await page.isVisible('#statusForm'), false, 'kein Nummer-/Code-Formular');
        if (device === PHONE) assert.ok((await overflow(page)) <= 1, 'Karriereseite passt aufs Handy');
        // Anderes Gerät (ohne gespeicherte Bewerbung): Bewerberseite bietet „Mit Discord öffnen“
        const other = await ctx.browser().newContext({ ...device });
        const p2 = await other.newPage();
        await p2.goto(bsrv.base + '/bewerbung.html');
        await p2.waitForSelector('#portal a[href="/api/discord/application-open"]');
        assert.equal(await p2.$('#accessForm'), null, 'kein Code-Formular');
        await other.close();
        // Ohne Discord-Anmeldung (gemeinsamer Test-Server): Nummer + Zugangscode als Notlösung
        await page.goto(server.base + '/karriere.html#status');
        await page.waitForSelector('#statusForm.flex');
        assert.equal(await page.isVisible('#statusDiscord'), false);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await bsrv.stop();
      }
    });
  }

  it('Ansichten Rechnung und Aktenauszug ohne Drucken/PDF', async () => {
    const { ctx, page, problems } = await open(DESKTOP);
    await login(page, TEAM.admin);
    await page.goto(`${server.base}/invoice.html?id=${data.invoiceId}`);
    await page.waitForSelector('.paper');
    // Kein Drucken/PDF mehr – die Kanzlei arbeitet mit Google Docs
    assert.equal(await page.locator('#printBtn').count(), 0);
    assert.doesNotMatch(await page.textContent('.toolbar'), /Drucken|PDF/);
    await page.goto(`${server.base}/aktenauszug.html?id=${data.caseId}`);
    await page.waitForSelector('.paper h1');
    assert.ok((await page.textContent('.paper')).includes(data.caseNumber));
    assert.doesNotMatch(await page.textContent('.toolbar'), /Drucken|PDF|Aktualisieren/);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
  for (const [label, device] of [
    ['PC', DESKTOP],
    ['Handy', PHONE],
  ]) {
    it(`Website-Texte im Bearbeitungsmodus am ${label}: anklicken, ändern, gespeichert; ohne Board kein Bearbeitungsmodus`, async () => {
      const wsrv = await startServer();
      const { ctx, page, problems } = await open(device);
      try {
        // Ohne Anmeldung: ?bearbeiten zeigt die normale Seite
        await page.goto(wsrv.base + '/?bearbeiten');
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#stBar').count(), 0);
        await login(page, TEAM.admin, wsrv.base);
        await page.goto(wsrv.base + '/?bearbeiten#raenge');
        await page.waitForSelector('#stBar');
        const h2 = page.locator('#raenge h2[data-t]');
        await h2.click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('Unsere Ränge');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#stBar .st-msg').textContent === 'Gespeichert.');
        assert.ok((await overflow(page)) <= 1, 'Leiste passt in die Breite');
        await page.click('#stBar .st-done');
        await page.waitForURL((u) => !u.search.includes('bearbeiten'));
        assert.equal((await page.textContent('#raenge h2')).trim(), 'Unsere Ränge');
        assert.equal(await page.locator('#raenge h4', { hasText: 'Junior Associate' }).count(), 1, 'Rang-Karten aus der Datenbank');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await wsrv.stop();
      }
    });
  }
  for (const [label, device] of [
    ['PC', DESKTOP],
    ['Handy', PHONE],
  ]) {
    it(`Dokumentart mit eigener Vorschlagsliste am ${label}: tippen filtert, Pfeil + Enter übernimmt, Esc schließt nur die Liste`, async () => {
      const csrv = await startServer();
      const { ctx, page, problems } = await open(device);
      try {
        const adm = client(csrv.base);
        const me = await adm.login(TEAM.admin);
        const kase = (await adm.post('/api/cases', { title: 'Missbrauch der Amtsgewalt', area: 'strafrecht', clientName: 'Toni Test', lawyerId: me.id })).json.case;
        await login(page, TEAM.admin, csrv.base);
        await page.goto(`${csrv.base}/dashboard.html?case=${kase.id}#cases`);
        await page.waitForSelector('#modalBody .case-head');
        await page.evaluate(async () => {
          await load.fivenet();
          openModal(externalForm('fivenet', null, st.caseInfo), { child: true });
        });
        await page.click('#fnDocType');
        assert.ok((await page.locator('#fnDocTypeList li:visible').count()) > 5, 'beim Antippen alle Vorschläge');
        await page.keyboard.type('zeug');
        assert.deepEqual(await page.locator('#fnDocTypeList li:visible').allTextContents(), ['Zeugenaussage']);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        assert.equal(await page.inputValue('#fnDocType'), 'Zeugenaussage');
        assert.equal(await page.locator('#modalBody form[data-form="ext-link"]').count(), 1, 'Enter schickt das Formular nicht ab');
        await page.fill('#fnDocType', 'Eigene Art');
        await page.keyboard.press('Escape');
        assert.ok(await page.locator('#fnDocTypeList').isHidden());
        assert.equal(await page.locator('#modalBody form[data-form="ext-link"]').count(), 1, 'Esc schließt nur die Liste');
        assert.equal(await page.inputValue('#fnDocType'), 'Eigene Art', 'eigener Text bleibt erlaubt');
        assert.ok((await overflow(page)) <= 1);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await csrv.stop();
      }
    });
  }
  it('Live: neue Nachricht und geänderte Akte erscheinen ohne Neuladen – angefangener Text bleibt', async () => {
    const lsrv = await startServer();
    const { ctx, page, problems } = await open(DESKTOP);
    try {
      const anwalt = client(lsrv.base);
      await anwalt.login(TEAM.anwalt);
      const reg = client(lsrv.base);
      assert.equal((await reg.post('/api/auth/register', { displayName: 'Lia Live', email: 'lia.live', password: 'Mandanten-Passwort-1' })).status, 201);
      const kase = (await anwalt.post('/api/cases', { title: 'Live im Portal', area: 'zivilrecht', clientEmail: 'lia.live' })).json.case;
      await page.goto(lsrv.base + '/login.html');
      await page.fill('#email', 'lia.live');
      await page.fill('#password', 'Mandanten-Passwort-1');
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#nav a.nav-item');
      await page.evaluate((id) => openCase(id), kase.id);
      await page.waitForSelector('#modalBody #secChat .chat-input');
      await page.waitForFunction(() => live.ok, null, { timeout: 5000 });
      // Mandant tippt schon eine Antwort, da schreibt die Kanzlei
      await page.fill('#secChat .chat-input', 'Ich schreibe gerade …');
      assert.equal((await anwalt.post(`/api/cases/${kase.id}/notes`, { body: 'Ihr Termin ist bestätigt.' })).status, 201);
      // ohne Live käme sie erst mit dem nächsten Abruf (30 s) – so nach höchstens 3 s
      await page.waitForFunction(() => /Ihr Termin ist bestätigt/.test(document.querySelector('#chatList').textContent), null, { timeout: 3000 });
      assert.equal(await page.inputValue('#secChat .chat-input'), 'Ich schreibe gerade …', 'angefangene Antwort bleibt');
      // Akte ändert sich, während der Mandant tippt: erst nach dem Verlassen des Feldes neu zeichnen – Text bleibt
      assert.equal((await anwalt.patch(`/api/cases/${kase.id}`, { title: 'Live im Portal – geändert' })).status, 200);
      await page.waitForTimeout(800);
      assert.doesNotMatch(await page.textContent('#modalBody'), /Live im Portal – geändert/, 'nicht mitten im Tippen');
      await page.locator('#secChat .chat-input').blur();
      await page.waitForFunction(() => /Live im Portal – geändert/.test(document.querySelector('#modalBody').textContent), null, { timeout: 4000 });
      assert.equal(await page.inputValue('#secChat .chat-input'), 'Ich schreibe gerade …', 'Text bleibt auch nach dem Neuzeichnen');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
      await lsrv.stop();
    }
  });
  it('Fehler direkt am Feld: eigene Prüfung, Prüfung des Browsers und Antwort des Servers – PC und Handy', async () => {
    // eigener Server: der gemeinsame erlaubt nur 20 Anmeldungen je 15 Minuten
    const fsrv = await startServer();
    try {
      // Handy: Registrierung – zu kurzes Passwort steht unter dem Passwort, vergebene Adresse unter der E-Mail
      {
        const { ctx, page, problems, settle } = await open(PHONE);
        await page.goto(fsrv.base + '/register.html');
        await page.fill('#displayName', 'Max Feldtest');
        await page.fill('#email', 'damat.lex');
        await page.fill('#password', 'kurz');
        await page.fill('#password2', 'kurz');
        await page.click('#registerForm button[type=submit]');
        const err = page.locator('#registerForm .ps-field-error');
        await err.waitFor();
        assert.equal(await err.count(), 1);
        assert.match(await err.textContent(), /Mindestens 10 Zeichen \(aktuell 4\)/);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'password', 'Feld wird angesprungen');
        assert.equal(await page.getAttribute('#password', 'aria-invalid'), 'true');
        assert.equal(await page.evaluate(() => document.getElementById('password').nextElementSibling?.className.includes('ps-field-error') || document.getElementById('password').closest('div').nextElementSibling?.className.includes('ps-field-error')), true, 'Hinweis direkt am Passwortfeld');
        assert.equal(await overflow(page), 0);
        await page.fill('#password', 'langesPasswort1');
        assert.equal(await err.count(), 0, 'Tippen entfernt den Hinweis');
        await page.fill('#password2', 'langesPasswort1');
        await page.click('#registerForm button[type=submit]');
        await err.waitFor();
        await settle();
        assert.match(await err.textContent(), /bereits registriert/);
        assert.equal(await page.evaluate(() => document.querySelector('.email-group').nextElementSibling.classList.contains('ps-field-error')), true, 'unter der Gruppe mit @pake-scha.ls');
        assert.equal(await page.textContent('#formError'), '', 'keine doppelte Meldung');
        assert.deepEqual(problems, []);
        await ctx.close();
      }
      // PC: Dashboard-Formular mit Prüfung des Browsers (Pflichtfeld + Mindestlänge) – keine graue Sprechblase
      {
        const { ctx, page, problems, settle } = await open(DESKTOP);
        await login(page, TEAM.anwalt, fsrv.base);
        await page.click('[data-action="new-case"]');
        await page.waitForSelector('form[data-form="new-case"]');
        await page.fill('#ncTitle', 'ab');
        await page.click('form[data-form="new-case"] button[type=submit]');
        const err = page.locator('form[data-form="new-case"] .ps-field-error');
        await err.waitFor();
        assert.equal(await err.textContent(), 'Mindestens 3 Zeichen (aktuell 2).');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ncTitle');
        // „change“ beim Verlassen des Feldes ohne neue Eingabe (z. B. Safari) lässt den Hinweis stehen
        await page.evaluate(() => document.getElementById('ncTitle').dispatchEvent(new Event('change', { bubbles: true })));
        assert.equal(await err.count(), 1, 'Hinweis bleibt ohne neue Eingabe');
        await page.fill('#ncTitle', 'Feldtest Akte');
        assert.equal(await err.count(), 0);
        await settle();
        assert.deepEqual(problems, []);
        await ctx.close();
      }
    } finally {
      await fsrv.stop();
    }
  });

  it('404: eigene Seite im Kanzlei-Design, am Handy ohne Überstand', async () => {
    for (const device of [DESKTOP, PHONE]) {
      const { ctx, page, problems } = await open(device);
      const res = await page.goto(server.base + '/akte/gibt-es-nicht');
      assert.equal(res.status(), 404);
      assert.equal(await page.textContent('h1'), 'Seite nicht gefunden');
      assert.equal(await page.getAttribute('.nf-actions a.btn-gold', 'href'), '/');
      assert.equal(await overflow(page), 0);
      assert.deepEqual(problems, []);
      await ctx.close();
    }
  });

  it('Übergänge: Seitenblöcke gestaffelt, Fenster blendet weich aus, Menügruppe klappt weich auf, bei „Bewegung reduzieren“ nur Überblenden', async () => {
    const tsrv = await startServer();
    const { ctx, page, problems } = await open(DESKTOP);
    try {
      await login(page, TEAM.admin, tsrv.base);
      // Seitenwechsel: die Blöcke der Seite kommen nacheinander (höchstens 0,2 s versetzt)
      await page.evaluate(() => (location.hash = '#calendar'));
      await page.waitForSelector('#content.view-in .page-title');
      // Auf langsamen Rechnern kann die Seite noch nachgezeichnet werden (Ladeplatzhalter → Inhalt): warten, bis alle Blöcke einblenden
      await page.waitForFunction(() => {
        const els = [...document.querySelectorAll('#content.view-in > *')];
        return els.length >= 2 && els.every((e) => getComputedStyle(e).animationName === 'view-in');
      }, null, { timeout: 5000 });
      const anim = await page.$$eval('#content.view-in > *', (els) => els.map((e) => [getComputedStyle(e).animationName, parseFloat(getComputedStyle(e).animationDelay)]));
      assert.ok(anim.length >= 2, 'mehrere Blöcke');
      assert.ok(anim.every(([n]) => n === 'view-in'));
      assert.ok(anim[1][1] > anim[0][1] && Math.max(...anim.map(([, d]) => d)) <= 0.2, `gestaffelt: ${JSON.stringify(anim)}`);
      // Fenster schließen: echtes Fenster sofort zu, eine stumme Kopie ohne ids blendet aus und ist danach weg
      await page.evaluate(() => openModal(eventForm(null)));
      await page.waitForSelector('#modal.open #evStart');
      // Kopie beim Einfügen festhalten (sie ist nach 0,24 s wieder weg – auch auf langsamen Rechnern zuverlässig)
      await page.evaluate(() => {
        window.__ghost = null;
        new MutationObserver((list, obs) => {
          for (const m of list) for (const g of m.addedNodes) if (g.classList && g.classList.contains('modal-ghost')) {
            window.__ghost = { ids: g.querySelectorAll('[id]').length + (g.id ? 1 : 0), inert: g.inert, open: !!document.querySelector('#modal.open'), anim: getComputedStyle(g).animationName };
            obs.disconnect();
          }
        }).observe(document.body, { childList: true });
      });
      await page.click('.modal-close');
      await page.waitForFunction(() => window.__ghost);
      assert.deepEqual(await page.evaluate(() => window.__ghost), { ids: 0, inert: true, open: false, anim: 'fade-out' });
      await page.waitForFunction(() => !document.querySelector('.modal-ghost'), null, { timeout: 2000 });
      // Menügruppe aufklappen: kurz einblenden
      const grp = await page.$('[data-action="nav-group"][aria-expanded="true"]');
      if (grp) {
        await grp.click(); // zu
        await page.click(`[data-action="nav-group"][aria-expanded="false"]`);
        assert.ok(await page.$('.nav-group.nav-reveal'), 'aufgeklappte Gruppe blendet ein');
      }
      // „Bewegung reduzieren“ (z. B. Windows ohne Animationseffekte): weiter weich überblenden, aber ohne Bewegung
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Animationen beim Start festhalten (auf langsamen Rechnern sind sie beim Nachsehen sonst schon vorbei)
      await page.evaluate(() => {
        window.__anims = [];
        document.addEventListener(
          'animationstart',
          (e) => {
            const a = e.target.getAnimations().find((x) => x.animationName === e.animationName);
            const kf = a ? a.effect.getKeyframes() : [];
            window.__anims.push({ name: e.animationName, moves: kf.some((k) => k.transform && k.transform !== 'none'), fades: kf.some((k) => k.opacity !== undefined) });
          },
          true
        );
      });
      const started = async (name) => {
        await page.waitForFunction((n) => window.__anims.some((a) => a.name === n), name);
        return page.evaluate((n) => window.__anims.filter((a) => a.name === n), name);
      };
      await page.evaluate(() => (location.hash = '#tasks'));
      const view = await started('view-in');
      assert.ok(view.every((a) => a.fades && !a.moves), `Seitenwechsel blendet nur über: ${JSON.stringify(view)}`);
      await page.evaluate(() => openModal(eventForm(null)));
      const card = await started('modal-in');
      assert.ok(card.every((a) => a.fades && !a.moves), `Fenster blendet nur ein: ${JSON.stringify(card)}`);
      await page.waitForSelector('#modal.open #evStart');
      await page.evaluate(() => {
        window.__ghostAnim = null;
        new MutationObserver((list, obs) => {
          for (const m of list) for (const g of m.addedNodes) if (g.classList && g.classList.contains('modal-ghost')) {
            const a = g.querySelector('.modal-card').getAnimations()[0];
            window.__ghostAnim = a ? { name: a.animationName, moves: a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none') } : 'keine';
            obs.disconnect();
          }
        }).observe(document.body, { childList: true });
      });
      await page.click('.modal-close');
      await page.waitForFunction(() => window.__ghostAnim);
      assert.deepEqual(await page.evaluate(() => window.__ghostAnim), { name: 'modal-out', moves: false }, 'Schließen blendet nur aus');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
      await tsrv.stop();
    }
  });
  for (const [label, device] of [
    ['PC', DESKTOP],
    ['Handy', PHONE],
  ]) {
    it(`Kalender im Kanzlei-Stil am ${label}: Termin mit Uhrzeit, reines Datum, Esc schließt nur den Kalender`, async () => {
      const ksrv = await startServer();
      const { ctx, page, problems } = await open(device);
      const tap = (sel) => (label === 'Handy' ? page.tap(sel) : page.click(sel));
      try {
        await login(page, TEAM.admin, ksrv.base);
        await page.goto(ksrv.base + '/dashboard.html#calendar');
        await page.waitForSelector('#content .page-title');
        await page.evaluate(() => openModal(eventForm(null)));
        await tap('#evStart');
        await page.waitForSelector('.dp');
        assert.equal(await page.locator('.dp .dp-day').count(), 42, 'sechs Wochen, Montag zuerst');
        assert.equal((await page.textContent('.dp .dp-wd')).trim(), 'Mo');
        await page.click('.dp [data-dp-nav="1"]');
        await page.click('.dp .dp-day:not(.out) >> text="15"');
        await page.selectOption('.dp [data-dp-time="hh"]', '14');
        await page.selectOption('.dp [data-dp-time="mm"]', '30');
        await page.click('.dp [data-dp-act="ok"]');
        assert.match(await page.inputValue('#evStart'), /^\d{4}-\d{2}-15T14:30$/);
        assert.equal(await page.locator('.dp').count(), 0);
        assert.equal(await page.inputValue('#evStart') !== '' && (await page.$eval('#evStart', (i) => i.readOnly)), false, 'nach dem Schließen wieder normal');
        await tap('#evEnd');
        await page.waitForSelector('.dp');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.dp').count(), 0);
        assert.equal(await page.locator('#modalBody form[data-form="event"]').count(), 1, 'Esc schließt nur den Kalender');
        // Reines Datum: Tag antippen = übernommen
        await page.evaluate(() => taskModal(null));
        await tap('#modalBody input[name="dueDate"]');
        await page.waitForSelector('.dp');
        assert.equal(await page.locator('.dp [data-dp-time]').count(), 0, 'keine Uhrzeit bei reinem Datum');
        await page.click('.dp .dp-day:not(.out) >> text="20"');
        assert.match(await page.inputValue('#modalBody input[name="dueDate"]'), /^\d{4}-\d{2}-20$/);
        assert.ok((await overflow(page)) <= 1);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
        await ksrv.stop();
      }
    });
  }
});
