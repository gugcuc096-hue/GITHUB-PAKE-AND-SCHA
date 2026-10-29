'use strict';
/*
 * Offline-Modus (freiwillig, je Gerät): zuletzt gesehene Ansichten bleiben ohne Verbindung lesbar, die Dashboard-Seite öffnet auch
 * ohne Netz (Service Worker), eine interne Notiz und das Abhaken einer Aufgabe werden nachgesendet, Ausschalten löscht alles –
 * am PC und am Handy.
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

describe('Offline-Modus (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: einschalten, Ansichten merken, offline lesen, Notiz und Haken nachsenden, ausschalten löscht`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const kase = (await a.post('/api/cases', { title: `Offline-Akte ${name}`, area: 'zivilrecht', clientName: 'Paul Weber' })).json.case;
      const task = (await a.post('/api/tasks', { title: `Aufgabe offline ${name}`, caseId: kase.id })).json.task;
      const ctx = await browser.newContext({ ...device, locale: 'de-DE', serviceWorkers: 'allow' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id && views.profile && typeof fivenetProfilePanel === 'function', null, { timeout: 15000 }); // Verwaltungsteile laden nach

        // Aus: nichts wird gespeichert
        assert.equal(await page.evaluate(() => PS.offline.enabled()), false);
        assert.equal((await page.evaluate(() => PS.offline.stats())).entries, 0);

        // Einschalten im Profil
        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('#offlinePanel [data-action="offline-toggle"]');
        await page.click('#offlinePanel [data-action="offline-toggle"]');
        await page.waitForFunction(() => PS.offline.enabled() && document.querySelector('#offlinePanel')?.textContent.includes('Im Zwischenspeicher'));

        // Online durch die wichtigsten Ansichten gehen und eine Akte öffnen
        await page.reload();
        await page.waitForFunction(() => st.user && st.user.id && views.tasks, null, { timeout: 15000 });
        for (const v of ['cases', 'tasks', 'calendar', 'overview']) {
          await page.evaluate((x) => navigate(x), v);
          await page.waitForTimeout(500);
        }
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((id) => openCase(id), kase.id);
          if (await page.waitForSelector('#secTasks', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        await page.evaluate(() => closeModal());
        await page.waitForFunction(() => PS.offline.stats().then ? true : true);
        await page.waitForFunction(async () => (await PS.offline.stats()).entries >= 6, null, { timeout: 10000 });
        // Dashboard-Seite liegt für den Offline-Start bereit (Service Worker)
        await page.waitForFunction(async () => {
          const c = await caches.open('ps-offline-shell-v1');
          return !!(await c.match('/dashboard'));
        }, null, { timeout: 15000 });

        // ---- Verbindung weg: Seite neu laden, lesen
        await ctx.setOffline(true);
        await page.reload();
        await page.waitForFunction(() => st.user && st.user.id && views.cases, null, { timeout: 20000 });
        await page.waitForSelector('#offlineBar:not([hidden])', { timeout: 10000 });
        assert.match(await page.textContent('#offlineBar'), /Offline – Stand von/);
        await page.evaluate(() => navigate('cases'));
        await page.waitForFunction((t) => document.querySelector('#content')?.textContent.includes(t), `Offline-Akte ${name}`, { timeout: 10000 });
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((id) => openCase(id), kase.id);
          if (await page.waitForSelector('#secTasks', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        assert.ok((await page.textContent('#secTasks')).includes(`Aufgabe offline ${name}`), 'Akte mit Aufgabe aus dem Zwischenspeicher');

        // Offline: Aufgabe abhaken und interne Notiz schreiben → warten auf die Verbindung
        await page.click(`#secTasks [data-action="task-toggle"][data-id="${task.id}"]`);
        await page.fill('form[data-form="add-note"] textarea[name="body"]', `Notiz im Zug (${name})`);
        await page.click('form[data-form="add-note"] button[type=submit]');
        await page.waitForFunction(() => /2 Änderungen warten/.test(document.querySelector('#offlineBar')?.textContent || ''), null, { timeout: 8000 });
        // etwas, das Verbindung braucht, sagt das klar
        const err = await page.evaluate(() => PS.api.post('/api/cases', { title: 'geht nicht', area: 'zivilrecht', clientName: 'X' }).then(() => 'ok', (e) => e.message));
        assert.notEqual(err, 'ok');
        assert.equal((await a.get(`/api/cases/${kase.id}`)).json.notes.some((n) => n.body.includes('Notiz im Zug')), false, 'noch nicht gesendet');

        // ---- Verbindung zurück: wird gesendet
        await ctx.setOffline(false);
        await page.waitForFunction(() => /gesendet/.test(document.body.textContent) || document.querySelector('#offlineBar')?.hidden, null, { timeout: 15000 });
        await page.waitForFunction(async () => (await PS.offline.stats()).queued === 0, null, { timeout: 15000 });
        let after;
        for (let i = 0; i < 40; i++) {
          after = (await a.get(`/api/cases/${kase.id}`)).json;
          if (after.notes.some((n) => n.body.includes(`Notiz im Zug (${name})`)) && after.tasks.find((t) => t.id === task.id).done) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        assert.ok(after.notes.some((n) => n.body.includes(`Notiz im Zug (${name})`) && n.internal), 'Notiz angekommen');
        assert.equal(after.tasks.find((t) => t.id === task.id).done, true, 'Haken angekommen');

        // Ausschalten löscht alles
        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('#offlinePanel [data-action="offline-toggle"]');
        await page.click('#offlinePanel [data-action="offline-toggle"]');
        await page.waitForFunction(() => !PS.offline.enabled());
        assert.deepEqual(await page.evaluate(() => PS.offline.stats()), { entries: 0, oldest: null, queued: 0 });
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
