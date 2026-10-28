'use strict';
/*
 * Rechtsgebiete als Daten: Migration der fünf bisherigen Gebiete (Akten unverändert), neu anlegen, umbenennen,
 * ausblenden statt löschen, Zusatzfragen im Mandatsformular, Schritte/Checkliste/Ergebnisse je Rechtsgebiet,
 * Website-Auswahl – API und Dashboard am PC und am Handy.
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

describe('Rechtsgebiete (API)', () => {
  let srv;
  let owner;
  let board;
  let anon;
  let oldCase;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    board = client(srv.base);
    anon = client(srv.base);
    await owner.login(TEAM.admin);
    await board.login(TEAM.partner);
    oldCase = (await owner.post('/api/cases', { title: 'Alte Akte', area: 'strafrecht', clientName: 'Olga Alt' })).json.case;
  });
  after(() => srv.stop());

  it('die fünf bisherigen Rechtsgebiete sind eingetragen, bestehende Akten bleiben unverändert', async () => {
    const list = (await anon.get('/api/public/areas')).json.areas;
    assert.deepEqual(list.map((a) => a.key), ['strafrecht', 'zivilrecht', 'verfassungsrecht', 'vertragsrecht', 'sonstiges']);
    assert.equal(list[0].intakeTitle, 'Strafrecht / Festnahme');
    const c = (await owner.get(`/api/cases/${oldCase.id}`)).json.case;
    assert.equal(c.area, 'strafrecht');
    assert.deepEqual(c.steps, ['Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung']);
    const me = (await owner.get('/api/auth/me')).json;
    assert.equal(me.areas.names.strafrecht, 'Strafrecht');
  });

  it('nur mit Recht: anlegen, ändern, ausblenden, Reihenfolge, löschen', async () => {
    const body = { name: 'Verkehrsrecht', short: 'VRK', color: 'amber', icon: 'tag', intakeTitle: 'Verkehrsrecht / Unfall', checklist: ['Unfallhergang aufnehmen', 'Versicherung anschreiben'], steps: ['Aufnahme', 'Gutachten', 'Regulierung', 'Klage'], outcomes: ['gewonnen', 'vergleich'], fields: [{ key: 'f_unfallort', label: 'Unfallort', type: 'text', required: true }, { key: 'f_art', label: 'Art', type: 'select', options: ['Auffahrunfall', 'Vorfahrt'], required: false }] };
    assert.equal((await board.post('/api/areas', body)).status, 403, 'Board ohne Recht');
    assert.equal((await owner.post('/api/areas', { ...body, name: 'x' })).status, 400);
    assert.equal((await owner.post('/api/areas', { ...body, fields: [{ ...body.fields[1], options: ['nur eine'] }] })).status, 400, 'Auswahl braucht zwei Möglichkeiten');
    const r = await owner.post('/api/areas', body);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.area.key, 'verkehrsrecht');
    assert.equal((await anon.get('/api/public/areas')).json.areas.at(-1).fields.length, 2);
    // Reihenfolge
    const keys = (await owner.get('/api/areas')).json.areas.map((a) => a.key);
    await owner.put('/api/areas/order', { keys: ['verkehrsrecht', ...keys.filter((k) => k !== 'verkehrsrecht')] });
    assert.equal((await anon.get('/api/public/areas')).json.areas[0].key, 'verkehrsrecht');
    // Umbenennen: Akten behalten ihr Rechtsgebiet, zeigen den neuen Namen
    const c = (await owner.post('/api/cases', { title: 'Auffahrunfall', area: 'verkehrsrecht', clientName: 'Vera Verkehr', answers: { f_unfallort: 'Legion Square', f_art: 'Auffahrunfall' } })).json.case;
    assert.equal(c.area, 'verkehrsrecht');
    assert.deepEqual(c.steps, body.steps);
    assert.equal(c.stepLabel, 'Aufnahme');
    assert.equal(c.intakeAnswers.f_unfallort.value, 'Legion Square');
    await owner.put('/api/areas/verkehrsrecht', { ...body, name: 'Straßenverkehrsrecht' });
    assert.equal((await owner.get('/api/auth/me')).json.areas.names.verkehrsrecht, 'Straßenverkehrsrecht');
    assert.equal((await owner.get(`/api/cases/${c.id}`)).json.case.area, 'verkehrsrecht');
    // Löschen geht nur, wenn nichts daran hängt – sonst ausblenden
    assert.equal((await owner.del('/api/areas/verkehrsrecht')).status, 409);
    await owner.put('/api/areas/verkehrsrecht', { ...body, name: 'Straßenverkehrsrecht', active: false });
    assert.ok(!(await anon.get('/api/public/areas')).json.areas.some((a) => a.key === 'verkehrsrecht'), 'ausgeblendet: nicht mehr wählbar');
    assert.equal((await owner.post('/api/cases', { title: 'Neu', area: 'verkehrsrecht', clientName: 'x y' })).status, 400, 'neue Akten nicht mehr');
    assert.equal((await owner.get(`/api/cases/${c.id}`)).json.case.area, 'verkehrsrecht', 'bestehende Akte behält es');
    const spare = (await owner.post('/api/areas', { ...body, name: 'Leeres Gebiet', fields: [] })).json.area;
    assert.equal((await owner.del(`/api/areas/${spare.key}`)).status, 200, 'unbenutzt: löschbar');
  });

  it('Zusatzfragen: Pflicht für Website und Mandanten, Prüfung der Antworten, Anzeige in der Akte', async () => {
    await owner.put('/api/areas/zivilrecht', { name: 'Zivilrecht', short: 'ZIV', color: 'sky', icon: 'scale', intakeTitle: 'Zivilrecht / Schadensersatz', active: true, steps: null, checklist: [], outcomes: [], fields: [{ key: 'f_schaden', label: 'Schadenshöhe', type: 'number', required: true }, { key: 'f_datum', label: 'Datum des Vorfalls', type: 'date', required: false }] });
    const web = { name: 'Gerd Gast', area: 'zivilrecht', description: 'Mein Auto wurde beschädigt, bitte um Hilfe.' };
    assert.equal((await anon.post('/api/public/cases', web)).status, 400, 'Pflichtfeld fehlt');
    assert.equal((await anon.post('/api/public/cases', { ...web, answers: { f_schaden: 'viel' } })).status, 400, 'keine Zahl');
    assert.equal((await anon.post('/api/public/cases', { ...web, answers: { f_schaden: '1500', f_datum: 'gestern' } })).status, 400, 'kein Datum');
    const ok = await anon.post('/api/public/cases', { ...web, answers: { f_schaden: '1500', f_datum: '2026-10-01', unbekannt: 'x' } });
    assert.equal(ok.status, 201, ok.text);
    const found = (await owner.get('/api/cases')).json.cases.find((x) => x.caseNumber === ok.json.caseNumber);
    const full = (await owner.get(`/api/cases/${found.id}`)).json.case;
    assert.deepEqual(Object.keys(full.intakeAnswers).sort(), ['f_datum', 'f_schaden']);
    assert.equal(full.intakeAnswers.f_schaden.label, 'Schadenshöhe');
    // Die Kanzlei darf Lücken lassen
    assert.equal((await owner.post('/api/cases', { title: 'Ohne Angaben', area: 'zivilrecht', clientName: 'Kai Kanzlei' })).status, 201);
    // Ein später umbenanntes Feld ändert die Beschriftung alter Akten nicht
    await owner.put('/api/areas/zivilrecht', { name: 'Zivilrecht', short: 'ZIV', color: 'sky', icon: 'scale', intakeTitle: 'Zivilrecht / Schadensersatz', active: true, steps: null, checklist: [], outcomes: [], fields: [{ key: 'f_schaden', label: 'Schaden in Dollar', type: 'number', required: true }] });
    assert.equal((await owner.get(`/api/cases/${found.id}`)).json.case.intakeAnswers.f_schaden.label, 'Schadenshöhe');
  });

  it('Checkliste und Kurztitel kommen aus dem Rechtsgebiet', async () => {
    await owner.put('/api/areas/sonstiges', { name: 'Allgemeines', short: 'ALL', color: 'slate', icon: 'folder', intakeTitle: 'Allgemeine Anfrage', active: true, steps: null, checklist: ['Erster Punkt', 'Zweiter Punkt'], outcomes: [], fields: [] });
    const web = await anon.post('/api/public/cases', { name: 'Sina Sonst', area: 'sonstiges', description: 'Eine allgemeine Frage an die Kanzlei.' });
    assert.equal(web.status, 201);
    const found = (await owner.get('/api/cases')).json.cases.find((x) => x.caseNumber === web.json.caseNumber);
    assert.equal(found.title, 'Allgemeine Anfrage – Sina Sonst');
    const r = await owner.post('/api/tasks/checklist', { caseId: found.id });
    assert.equal(r.status, 201, r.text);
    const titles = (await owner.get(`/api/tasks?scope=case&caseId=${found.id}`)).json.tasks.map((t) => t.title);
    assert.ok(titles.includes('Erster Punkt') && titles.includes('Zweiter Punkt'), JSON.stringify(titles));
  });
});

describe('Rechtsgebiete im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Rechtsgebiet anlegen mit Zusatzfrage – erscheint auf der Website und im Mandatsformular; ausblenden`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.evaluate(() => (location.href = '/dashboard?tab=listen#settings'));
      await page.waitForSelector('.area-card', { timeout: 15000 });
      const before = await page.locator('.area-card').count();
      assert.ok(before >= 5);
      assert.equal(await noOverflow(page), true);
      await page.click('[data-action="area-new"]');
      await page.waitForSelector('form[data-form="area-save"]');
      await page.fill('#arName', `Verkehrsrecht ${name}`);
      await page.fill('#arShort', 'VRK');
      await page.fill('#arIntake', `Verkehrsrecht / Unfall (${name})`);
      await page.fill('#arCheck', 'Unfallhergang aufnehmen\nVersicherung anschreiben');
      await page.click('[data-action="area-field-add"]');
      await page.fill('.area-field [data-f="label"]', 'Unfallort');
      await page.check('.area-field [data-f="required"]');
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/areas') && r.request().method() === 'POST' && r.ok()), page.click('form[data-form="area-save"] button[type=submit]')]);
      await page.waitForFunction((n) => document.querySelectorAll('.area-card').length === n, before + 1);
      assert.equal(await noOverflow(page), true);
      // Neue Akte im Dashboard: Rechtsgebiet wählen → Zusatzfrage erscheint
      await page.evaluate(() => (location.href = '/dashboard?new=case'));
      await page.waitForSelector('form[data-form="new-case"] [data-area-select]');
      await page.selectOption('[data-area-select]', { label: `Verkehrsrecht ${name}` });
      await page.waitForSelector('#ncAreaFields [data-answer]');
      assert.match(await page.textContent('#ncAreaFields'), /Unfallort/);
      // Website: Auswahl und Zusatzfrage
      const site = await ctx.newPage();
      await site.goto(`${srv.base}/`);
      await site.waitForFunction((t) => [...document.querySelectorAll('#tkArea option')].some((o) => o.textContent === t), `Verkehrsrecht / Unfall (${name})`);
      await site.evaluate((t) => {
        const sel = document.getElementById('tkArea');
        sel.value = [...sel.options].find((o) => o.textContent === t).value;
        sel.dispatchEvent(new Event('change'));
      }, `Verkehrsrecht / Unfall (${name})`);
      await site.waitForSelector('#tkAreaFields [data-answer]');
      assert.match(await site.textContent('#tkAreaFields'), /Unfallort \*/);
      // Ausblenden: verschwindet aus der Website-Auswahl
      await page.evaluate(() => (location.href = '/dashboard?tab=listen#settings'));
      await page.waitForSelector('.area-card');
      await Promise.all([page.waitForResponse((r) => /\/api\/areas\/[^/]+$/.test(r.url()) && r.request().method() === 'PUT' && r.ok()), page.click(`.area-card:has-text("Verkehrsrecht ${name}") [data-action="area-toggle"]`)]);
      await site.reload();
      await site.waitForFunction(() => document.querySelectorAll('#tkArea option').length >= 5);
      assert.equal(await site.locator('#tkArea option', { hasText: `(${name})` }).count(), 0);
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});
