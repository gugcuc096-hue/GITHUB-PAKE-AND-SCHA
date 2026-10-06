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
