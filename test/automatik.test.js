'use strict';
/*
 * Automatik-Regeln („Wenn … dann …“), eigene Aktenfelder (auch „nur Kanzlei“, bearbeitbar, durchsuchbar),
 * Verfahrensschritte 2–8 je Rechtsgebiet, Status-Namen und neue Platzhalter in Textbausteinen.
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

describe('Automatik, eigene Felder, Schritte, Status', () => {
  let srv;
  let owner;
  let anwalt;
  let me;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    me = await owner.login(TEAM.admin);
    anwalt = client(srv.base);
    await anwalt.login(TEAM.anwalt);
  });
  after(async () => {
    if (srv) await srv.stop();
  });

  it('Regeln anlegen: nur mit Recht, ungültige werden abgelehnt', async () => {
    assert.equal((await anwalt.post('/api/automations', { name: 'x', trigger: 'case.created', action: 'note', params: { text: 'hallo' } })).status, 403);
    assert.equal((await owner.post('/api/automations', { name: 'Ohne Tage', trigger: 'case.idle', action: 'note', params: { text: 'x' } })).status, 400);
    assert.equal((await owner.post('/api/automations', { name: 'Schleife', trigger: 'case.status', conditions: { status: 'offen' }, action: 'status', params: { status: 'offen' } })).status, 400);
    assert.equal((await anwalt.get('/api/automations')).status, 200, 'lesen darf die Kanzlei');
  });

  it('Neue Strafsache → Priorität hoch und Aufgabe an den Federführenden', async () => {
    const r1 = await owner.post('/api/automations', { name: 'Strafsache hoch', trigger: 'case.created', conditions: { area: 'strafrecht' }, action: 'priority', params: { priority: 3 } });
    assert.equal(r1.status, 201, r1.text);
    const r2 = await owner.post('/api/automations', { name: 'Erstgespräch', trigger: 'case.created', action: 'task', params: { title: 'Erstgespräch führen', dueDays: 2, to: 'lead' } });
    assert.equal(r2.status, 201, r2.text);
    const k = (await owner.post('/api/cases', { title: 'Automatik-Akte', area: 'strafrecht', clientName: 'Anna Auto', lawyerId: me.id })).json.case;
    assert.equal(k.priority, 3, 'Priorität durch die Regel');
    const tasks = (await owner.get(`/api/tasks?scope=all&caseId=${k.id}`)).json.tasks;
    const t = tasks.find((x) => x.title === 'Erstgespräch führen');
    assert.ok(t, 'Aufgabe angelegt');
    assert.equal(t.assignedTo, me.id);
    const notes = (await owner.get(`/api/cases/${k.id}`)).json.notes || [];
    assert.ok(JSON.stringify(notes).includes('Automatik'), 'Verlaufseintrag');
    // andere Rechtsgebiete: keine Priorität, aber die Aufgabe
    const z = (await owner.post('/api/cases', { title: 'Zivil-Akte', area: 'zivilrecht', clientName: 'Zora Zivil', lawyerId: me.id })).json.case;
    assert.equal(z.priority, 2);
    const list = (await owner.get('/api/automations')).json.rules;
    assert.equal(list.find((x) => x.name === 'Strafsache hoch').runs, 1);
  });

  it('Rechnung bezahlt → Akte abschließen; Statuswechsel → Notiz', async () => {
    await owner.post('/api/automations', { name: 'Bezahlt schließt', trigger: 'invoice.paid', action: 'status', params: { status: 'geschlossen' } });
    await owner.post('/api/automations', { name: 'Abschluss-Notiz', trigger: 'case.status', conditions: { status: 'in_bearbeitung' }, action: 'note', params: { text: 'Bitte Honorarvereinbarung prüfen.' } });
    const k = (await owner.post('/api/cases', { title: 'Rechnungs-Akte', area: 'vertragsrecht', clientName: 'Rudi Rechnung', lawyerId: null })).json.case;
    assert.equal(k.status, 'offen');
    await owner.patch(`/api/cases/${k.id}`, { lawyerId: me.id });
    await new Promise((r) => setTimeout(r, 200));
    const notes = JSON.stringify((await owner.get(`/api/cases/${k.id}`)).json.notes || []);
    assert.ok(notes.includes('Honorarvereinbarung prüfen'), 'Statuswechsel löste die Notiz aus');
    const inv = (await owner.post('/api/invoices', { caseId: k.id, items: [{ description: 'Beratung', quantity: 1, unitPrice: 1000 }] })).json.invoice;
    assert.equal((await owner.patch(`/api/invoices/${inv.id}`, { status: 'bezahlt' })).status, 200);
    assert.equal((await owner.get(`/api/cases/${k.id}`)).json.case.status, 'geschlossen');
  });

  it('Eigene Felder: „nur Kanzlei“ sieht der Mandant nicht; bearbeiten und finden', async () => {
    const a = await owner.post('/api/areas', {
      name: 'Verkehrsrecht',
      short: 'VRK',
      steps: ['Eingang', 'Gutachten', 'Verhandlung', 'Urteil', 'Berufung', 'Vollstreckung'],
      fields: [
        { key: 'kennzeichen', label: 'Kennzeichen', type: 'text' },
        { key: 'haftnummer', label: 'Haftnummer', type: 'text', internal: true },
      ],
    });
    assert.equal(a.status, 201, a.text);
    const key = a.json.area.key;
    const m = client(srv.base);
    assert.equal((await m.post('/api/auth/register', { displayName: 'Vera Verkehr', email: 'vera.verkehr', password: PASSWORD })).status, 201);
    const mAreas = (await m.get('/api/auth/me')).json.areas.list.find((x) => x.key === key);
    assert.deepEqual(mAreas.fields.map((f) => f.key), ['kennzeichen'], 'Mandant sieht interne Felder nicht');
    const own = (await m.post('/api/cases', { title: 'Unfall am Pier', area: key, description: 'Bitte um Hilfe nach einem Unfall.', answers: { kennzeichen: 'LS-123', haftnummer: 'GEHEIM' } })).json.case;
    await owner.patch(`/api/cases/${own.id}`, { lawyerId: me.id });
    const r = await owner.patch(`/api/cases/${own.id}`, { answers: { kennzeichen: 'LS-123', haftnummer: 'H-4711' } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await owner.get(`/api/cases/${own.id}`)).json.case.intakeAnswers.haftnummer.value, 'H-4711');
    assert.equal((await m.get(`/api/cases/${own.id}`)).json.case.intakeAnswers.haftnummer, undefined, 'Mandant sieht die interne Angabe nicht');
    assert.equal((await m.patch(`/api/cases/${own.id}`, { answers: { kennzeichen: 'X' } })).status, 403);
    const s = (await owner.get('/api/search?q=H-4711')).json.results.cases;
    assert.ok(s.some((c) => c.id === own.id), 'Suche findet die Akte über die Angabe');
    // Sechs Schritte: Schritt 6 geht, Schritt 7 gibt es nicht
    const st5 = await owner.patch(`/api/cases/${own.id}`, { step: 5 });
    assert.equal(st5.status, 200, st5.text);
    assert.equal((await owner.get(`/api/cases/${own.id}`)).json.case.stepLabel, 'Vollstreckung');
    assert.equal((await owner.patch(`/api/cases/${own.id}`, { step: 6 })).status, 400);
  });

  it('Status-Namen und neue Platzhalter', async () => {
    const st = { offen: { label: 'Neu', color: 'amber' }, in_bearbeitung: { label: 'Läuft', color: 'sky' }, geschlossen: { label: 'Erledigt', color: 'emerald' } };
    assert.equal((await owner.put('/api/config/statuses/draft', st)).status, 200);
    assert.equal((await owner.post('/api/config/statuses/publish')).status, 200);
    assert.equal((await anwalt.get('/api/auth/me')).json.siteConfig.statuses.geschlossen.label, 'Erledigt');
    assert.equal((await owner.put('/api/config/statuses/draft', { ...st, offen: { label: 'x', color: 'lila' } })).status, 400);
    const ph = (await owner.get('/api/snippets')).json.placeholders;
    assert.ok(ph.frist && ph.termin);
  });

  it('Browser: Automatik-Seite, Regel aus Vorschlag, Angaben in der Akte bearbeiten', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' })).newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#content .page-title');
      await page.goto(`${srv.base}/dashboard?tab=automation#settings`);
      await page.waitForSelector('.auto-rule');
      const before = await page.locator('.auto-rule').count();
      await page.click('[data-action="auto-edit"] >> nth=0'); // „Neue Regel“
      await page.waitForSelector('form[data-form="auto-save"]');
      await page.fill('#auName', 'Notiz bei neuer Akte');
      await page.selectOption('#auAct', 'note');
      await page.fill('#auText', 'Willkommen!');
      await page.click('form[data-form="auto-save"] button[type=submit]');
      await page.waitForFunction((n) => document.querySelectorAll('.auto-rule').length === n + 1, before);
      // Status-Seite zeigt die Vorschau
      await page.goto(`${srv.base}/dashboard?tab=statuses#settings`);
      await page.waitForSelector('form[data-form="cfg-statuses"] .status-row');
      // Akte mit eigenen Feldern: Angaben bearbeiten
      const vk = (await owner.get('/api/areas')).json.areas.find((a) => a.name === 'Verkehrsrecht');
      const k = (await owner.post('/api/cases', { title: 'Feld-Akte', area: vk.key, clientName: 'Fritz Feld', lawyerId: me.id })).json.case;
      await page.evaluate((id) => openCase(id), k.id);
      await page.waitForSelector('#modalBody .case-root');
      await page.evaluate(() => document.querySelector('#modalBody [data-action="case-answers"]')?.scrollIntoView());
      await page.click('#modalBody [data-action="case-answers"]', { timeout: 15000 }).catch(async () => {
        await page.click('#modalBody [data-action="case-tab"][data-tab="ueberblick"]').catch(() => {});
        await page.click('#modalBody [data-action="case-answers"]');
      });
      await page.waitForSelector('form[data-form="case-answers"]');
      await page.fill('form[data-form="case-answers"] [data-answer="haftnummer"]', 'H-0815');
      await page.click('form[data-form="case-answers"] button[type=submit]');
      await page.waitForFunction(() => /H-0815/.test(document.querySelector('#modalBody .intake-answers')?.textContent || ''));
      assert.deepEqual(problems, []);
    } finally {
      await browser.close();
    }
  });
});
