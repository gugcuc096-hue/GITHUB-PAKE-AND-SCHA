'use strict';
/*
 * Ruhiger Hintergrund: Solange ein Fenster (z. B. eine Akte) offen ist, zeichnet sich die Seite dahinter nicht bei jeder
 * Änderung im Fenster neu (das sah durch den abgedunkelten Hintergrund wie Neuladen aus). Sie wird vorgemerkt und beim
 * Schließen einmal nachgeholt. Gilt für eigene Änderungen (Anklagepunkt) und für Änderungen von Kollegen (Live-Meldung).
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

describe('Hintergrund hinter offenen Fenstern (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Anklagepunkt ändern und Kollegen-Änderung zeichnen die Liste dahinter nicht neu – erst beim Schließen`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const id = (await a.post('/api/cases', { title: `Ruhe ${name}`, area: 'strafrecht', clientName: 'Max Muster' })).json.case.id;
      await a.post('/api/cases', { title: `Zweite ${name}`, area: 'strafrecht', clientName: 'Paul Probe' });
      const parsed = (await a.post('/api/penal/parse', { text: '§ 33 StGB' })).json.items;
      await a.post(`/api/cases/${id}/charges/bulk`, { items: parsed.map((i) => ({ offenceId: i.offenceId, count: i.count })) });
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id);
        await page.evaluate(() => (location.hash = '#cases'));
        await page.waitForSelector('#caseList tr[data-id]');
        await page.waitForTimeout(800);
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((i) => openCase(i), id);
          if (await page.waitForSelector('#secCharges', { timeout: 8000 }).then(() => true, () => false)) break;
        }
        await page.waitForSelector('[data-action="charge-count"]');
        // Marke an der Zeile hinter dem Fenster: sie überlebt nur, wenn die Seite nicht neu gezeichnet wird
        await page.evaluate(() => (document.querySelector('#caseList tr[data-id]').dataset.marke = 'da'));
        await page.click('[data-action="charge-count"][data-count="2"]');
        await page.waitForFunction(() => /2×/.test(document.querySelector('#secCharges .stepper')?.textContent || ''));
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => document.querySelector('#caseList tr[data-id]').dataset.marke), 'da', 'Liste hinter der Akte nicht neu gezeichnet');
        assert.equal(await page.evaluate(() => st.behindDirty), true, 'Neuzeichnen ist vorgemerkt');
        // Kollege ändert den Titel: Live-Meldung kommt an, die Liste dahinter bleibt trotzdem ruhig
        await a.patch(`/api/cases/${id}`, { title: `Neuer Titel ${name}` });
        await page.waitForFunction((t) => document.querySelector('#modalBody')?.textContent.includes(t), `Neuer Titel ${name}`, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => document.querySelector('#caseList tr[data-id]').dataset.marke), 'da', 'auch nach der Live-Meldung ruhig');
        // Schließen: jetzt zeichnet sich die Liste einmal neu und zeigt den neuen Titel
        await page.evaluate(() => closeModal());
        await page.waitForFunction(() => !document.querySelector('#modal.open'));
        await page.waitForFunction((t) => [...document.querySelectorAll('#caseList tr[data-id]')].some((r) => r.textContent.includes(t)) && !document.querySelector('#caseList tr[data-marke]'), `Neuer Titel ${name}`, { timeout: 6000 });
        assert.equal(await page.evaluate(() => st.behindDirty), false);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
