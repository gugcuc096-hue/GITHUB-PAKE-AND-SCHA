'use strict';
/*
 * Neue Akte und Aktenansicht im Browser (PC und Handy): Konto-Vorschläge beim Tippen des Namens (statt E-Mail-Feld),
 * Rechtsgebiet direkt aus dem Formular anlegen, Beteiligte ohne Überschneidung, Fenster wachsen aus dem Knopf hervor.
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

describe('Neue Akte: Konto-Vorschläge, Rechtsgebiet anlegen, Beteiligte, Aufklappen', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let admin;
  let kase;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    admin = client(srv.base);
    const me = await admin.login(TEAM.admin);
    const m = client(srv.base);
    assert.equal((await m.post('/api/auth/register', { displayName: 'Tina Termin', email: 'tina.termin', password: 'Mandanten-Passwort-5' })).status, 201);
    kase = (await admin.post('/api/cases', { title: 'Beteiligte-Test', area: 'strafrecht', clientName: 'Paul Probe', lawyerId: me.id })).json.case;
    await admin.post(`/api/cases/${kase.id}/parties`, { role: 'staatsanwalt', name: 'Niklas Palermo' });
    await admin.post(`/api/cases/${kase.id}/parties`, { role: 'gegenpartei', name: 'Eine Gegenpartei mit einem sehr langen Namen, der umbrechen muss, ohne etwas zu überdecken' });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Name tippen → Konto-Vorschlag verknüpft die Akte; neues Rechtsgebiet aus dem Formular; Beteiligte überdecken sich nicht`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);

      // Neue Akte: kein E-Mail-Feld mehr, stattdessen Vorschläge beim Namen
      await page.goto(`${srv.base}/dashboard?new=case`);
      await page.waitForSelector('form[data-form="new-case"] #ncName');
      assert.equal(await page.locator('#ncEmail[type="text"]').count(), 0, 'kein sichtbares E-Mail-Feld');
      await page.fill('#ncName', 'Tin');
      await page.waitForSelector('#ncSuggest:not([hidden]) .client-suggest-item', { timeout: 5000 });
      assert.match(await page.textContent('#ncSuggest'), /Tina Termin/);
      await page.click('#ncSuggest .client-suggest-item');
      await page.waitForSelector('#ncPicked:not([hidden])');
      assert.match(await page.textContent('#ncPicked'), /Tina Termin/);
      assert.equal(await page.inputValue('#ncName'), 'Tina Termin');
      assert.ok((await page.inputValue('#ncEmail')).startsWith('tina.termin'));
      // Name danach ändern: Verknüpfung gelöst
      await page.fill('#ncName', 'Tina T');
      assert.equal(await page.inputValue('#ncEmail'), '');
      await page.fill('#ncName', 'Tin');
      await page.waitForSelector('#ncSuggest:not([hidden]) .client-suggest-item');
      await page.click('#ncSuggest .client-suggest-item');

      // Rechtsgebiet direkt anlegen und gleich wählen
      await page.fill('#ncTitle', `Verkehrsunfall ${name}`);
      await page.click('[data-action="area-quick-new"]');
      await page.waitForSelector('form[data-form="area-save"]');
      await page.fill('#arName', `Verkehrsrecht ${name}`);
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/areas') && r.request().method() === 'POST' && r.ok()), page.click('form[data-form="area-save"] button[type=submit]')]);
      await page.waitForFunction((t) => document.querySelector('select[data-area-select]')?.selectedOptions[0]?.textContent === t, `Verkehrsrecht ${name}`);
      assert.equal(await page.inputValue('#ncTitle'), `Verkehrsunfall ${name}`, 'bereits Getipptes bleibt stehen');
      assert.equal(await page.inputValue('#ncName'), 'Tina Termin');
      await page.fill('textarea[name="description"]', 'Auffahrunfall am Legion Square.');
      await page.click('form[data-form="new-case"] button[type=submit]');
      await page.waitForSelector('#modal.open .case-num-row', { timeout: 15000 });
      const created = (await admin.get('/api/cases')).json.cases.find((c) => c.title === `Verkehrsunfall ${name}`);
      assert.ok(created && created.clientId, 'mit dem Konto verknüpft');
      assert.equal(created.area, `verkehrsrecht-${name.toLowerCase()}`);

      // Beteiligte: Rolle und Name überdecken sich nicht
      await page.goto(`${srv.base}/dashboard?case=${kase.id}`);
      await page.waitForSelector('.party-row');
      const overlaps = await page.evaluate(() =>
        [...document.querySelectorAll('.party-row')].map((row) => {
          const a = row.querySelector('.party-role').getBoundingClientRect();
          const b = row.querySelector('.party-name').getBoundingClientRect();
          return { role: row.querySelector('.party-role').textContent, overlap: a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5 };
        })
      );
      assert.ok(overlaps.length >= 2);
      assert.deepEqual(overlaps.filter((o) => o.overlap), [], 'Beteiligte überdecken sich nicht');
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  it('PC: Fenster wachsen aus dem Knopf hervor, der sie geöffnet hat', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.evaluate(() => (location.hash = '#cases'));
    await page.waitForSelector('[data-action="new-case"]');
    await page.waitForTimeout(1200);
    await page.click('[data-action="new-case"]');
    await page.waitForSelector('#modal.open');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').classList.contains('morphing')), true, 'wächst aus dem Knopf');
    await ctx.close();
  });

  // Nichts darf Nachbarn überdecken oder aus seinem Kasten herauslaufen (Beteiligte, Detailzeilen, Listen) – PC und Handy
  const scan = () => {
    const out = [];
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    for (const p of document.querySelectorAll('#content *, #modalBody *')) {
      if (!/flex|grid/.test(getComputedStyle(p).display)) continue;
      const kids = [...p.children].filter((k) => vis(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3 && kids[i].textContent.trim() && kids[j].textContent.trim()) {
            out.push(`${p.className}: «${kids[i].textContent.trim().slice(0, 25)}» × «${kids[j].textContent.trim().slice(0, 25)}»`);
          }
        }
    }
    for (const el of document.querySelectorAll('#content *, #modalBody *')) {
      const cs = getComputedStyle(el);
      if (el.children.length || cs.overflowX !== 'visible' || !el.textContent.trim() || el.clientWidth < 8 || cs.display === 'inline') continue;
      if (el.scrollWidth > el.clientWidth + 2) out.push(`Überlauf ${el.className}: «${el.textContent.trim().slice(0, 30)}»`);
    }
    return [...new Set(out)];
  };
  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Akte und Listen – nichts überdeckt etwas anderes`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      for (const view of ['cases', 'clients', 'tasks', 'calendar', 'invoices', 'settings']) {
        await page.evaluate((v) => (location.hash = `#${v}`), view);
        await page.waitForTimeout(1200);
        assert.deepEqual(await page.evaluate(scan), [], `Ansicht ${view}`);
      }
      await page.goto(`${srv.base}/dashboard?case=${kase.id}`);
      await page.waitForSelector('#modal.open .party-row');
      await page.waitForTimeout(1200);
      assert.deepEqual(await page.evaluate(scan), [], 'Akte');
      await ctx.close();
    });
  }
});
