'use strict';
/*
 * Aufgeräumte Bedienung: Menü in vier Bereichen (jede Seite genau ein Weg, Einstellungen und Profil unten), Einstellungen
 * mit Leiste, Gruppen und Suche (am Handy Auswahlliste), Lager-Verwaltung auf der Lager-Seite, Akte in vier Reitern.
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

describe('Aufgeräumte Bedienung (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let kase;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    kase = (await a.post('/api/cases', { title: 'Raub am Juwelier', area: 'strafrecht', clientName: 'Vito Russo' })).json.case;
    await a.post('/api/tasks', { title: 'Akteneinsicht beantragen', caseId: kase.id });
    await a.post('/api/invoices', { caseId: kase.id, items: [{ description: 'Erstberatung', quantity: 1, unitPrice: 15000 }] });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });
  const login = async (page, who = TEAM.admin) => {
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', who);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
  };

  it('Menü: Arbeit, Mandanten & Geld, Kanzlei, Board – jede Seite einmal; Einstellungen und Profil unten', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await login(page);
      const nav = await page.evaluate(() => ({
        heads: [...document.querySelectorAll('#nav .nav-section')].map((h) => h.textContent.trim().toUpperCase()),
        hrefs: [...document.querySelectorAll('#nav a.nav-item')].map((a) => a.getAttribute('href')),
        foot: [...document.querySelectorAll('#nav .nav-foot a')].map((a) => a.getAttribute('href')),
      }));
      assert.deepEqual(nav.heads, ['MANDANTEN & GELD', 'KANZLEI', 'BOARD OF PARTNERS']);
      assert.deepEqual(nav.foot, ['#settings', '#profile']);
      assert.equal(new Set(nav.hrefs).size, nav.hrefs.length, 'kein Ziel doppelt');
      for (const gone of ['#system', '#users', '#personnel', '#fees']) assert.ok(!nav.hrefs.includes(gone), `${gone} nicht als eigener Punkt`);
      // Systemzustand steht in den Einstellungen; der Fuß bleibt dort markiert
      await page.evaluate(() => (location.hash = '#system'));
      await page.waitForFunction(() => st.view === 'system');
      assert.equal(await page.getAttribute('#nav .nav-foot a[href="#settings"]', 'aria-current'), 'page');
    } finally {
      await ctx.close();
    }
  });

  it('Einstellungen: Leiste mit fünf Gruppen, Suche, alte Links, Systemzustand und Lager an einem Ort', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.goto(`${srv.base}/dashboard?tab=texte#settings`); // alter Link → Banner
      await page.waitForSelector('.set-nav');
      assert.deepEqual(await page.$$eval('.set-nav-head', (l) => l.map((x) => x.textContent.trim())), ['Kanzlei', 'Website', 'Geld', 'Kommunikation', 'Rechte & System']);
      assert.equal(await page.getAttribute('.set-nav-item.active', 'data-key'), 'banner');
      assert.ok(await page.$('form[data-form="cfg-banner"]'));
      assert.equal(await page.$('.set-nav [data-key="lager"]'), null, 'Lager nicht mehr in den Einstellungen');
      // Suche filtert, Enter öffnet den ersten Treffer
      await page.fill('#setSearch', 'webhook');
      assert.deepEqual(await page.$$eval('.set-nav-item:not([hidden])', (l) => l.map((x) => x.dataset.key)), ['bot']);
      await page.press('#setSearch', 'Enter');
      await page.waitForFunction(() => st.settingsTab === 'bot' && /tab=bot/.test(location.search));
      // Systemzustand in den Einstellungen
      await page.click('.set-nav-item[data-key="health"]');
      await page.waitForSelector('.set-main [data-action="sys-check"]');
      assert.match(await page.textContent('.set-main'), /Selbsttest/);
      // Verweis auf eine Seite
      await page.click('.set-nav-item[data-key="@fees"]');
      await page.waitForFunction(() => st.view === 'fees');
      // Lager: verwalten auf der eigenen Seite
      await page.evaluate(() => (location.hash = '#lager'));
      await page.waitForSelector('[data-action="storage-manage"]');
      await page.click('[data-action="storage-manage"]');
      await page.waitForSelector('#lagerManage form[data-form="storage-item-new"]');
      await page.fill('#lagerManage form[data-form="storage-item-new"] input[name="name"]', 'Funkgerät');
      await page.click('#lagerManage form[data-form="storage-item-new"] button[type=submit]');
      await page.waitForFunction(() => [...document.querySelectorAll('#lagerManage input[name="name"]')].some((i) => i.value === 'Funkgerät'));
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Handy: Einstellungen per Auswahlliste mit Gruppen; Suche zeigt Treffer zum Antippen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('#setPick');
      assert.equal(await page.isVisible('.set-nav'), false);
      assert.deepEqual(await page.$$eval('#setPick optgroup', (l) => l.map((g) => g.label)), ['Kanzlei', 'Website', 'Geld', 'Kommunikation', 'Rechte & System']);
      await page.selectOption('#setPick', 'style');
      await page.waitForFunction(() => st.settingsTab === 'style');
      await page.fill('#setSearch', 'rabatt');
      assert.equal(await page.isVisible('.set-nav-item[data-key="promos"]'), true, 'Treffer sichtbar');
      await page.click('.set-nav-item[data-key="promos"]');
      await page.waitForFunction(() => st.settingsTab === 'promos');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    } finally {
      await ctx.close();
    }
  });

  it('Akte: vier Reiter – Überblick zuerst, Zahlen je Reiter, Sprünge wechseln den Reiter', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate((id) => openCase(id), kase.id);
      await page.waitForSelector('#modalBody .case-root');
      const tabs = await page.$$eval('#modalBody .case-tabs [data-action="case-tab"]', (l) => l.map((b) => [b.dataset.tab, b.classList.contains('active')]));
      assert.deepEqual(tabs.map((t) => t[0]), ['ueberblick', 'kommunikation', 'fall', 'dokumente']);
      assert.equal(tabs[0][1], true, 'Überblick zuerst');
      assert.equal(await page.isVisible('#secTasks'), true);
      assert.equal(await page.isVisible('#secInvoices'), false, 'Rechnungen stecken unter Dokumente');
      assert.match(await page.textContent('#modalBody [data-action="case-tab"][data-tab="dokumente"]'), /Dokumente\s*1/);
      await page.click('#modalBody [data-action="case-tab"][data-tab="dokumente"]');
      assert.equal(await page.isVisible('#secInvoices'), true);
      assert.equal(await page.isVisible('#secTasks'), false);
      assert.equal(await page.isVisible('#modalBody .case-head'), true, 'Kopf über allen Reitern');
      // Sprung aus der Kachel „Aufgaben“ führt zurück in den Überblick
      await page.click('#modalBody [data-action="case-tab"][data-tab="ueberblick"]');
      await page.evaluate(() => caseReveal('secChat'));
      assert.equal(await page.getAttribute('#modalBody .case-root', 'data-case-tab'), 'kommunikation');
      // Ansicht anpassen zeigt alle Abschnitte zum Sortieren
      await page.click('#modalBody .jump-edit');
      assert.equal(await page.isVisible('.sec-wrap[data-sec="invoices"] .sec-bar'), true);
      assert.equal(await page.isVisible('.sec-wrap[data-sec="tasks"] .sec-bar'), true);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
