'use strict';
/*
 * Geheimes Mandat: Eine Akte lässt sich auf das Board of Partners beschränken. Andere Mitarbeiter sehen sie dann nirgends
 * (Liste, Akte, Suche, Aufgaben, Kalender, Rechnungen) – außer sie sind der Akte selbst zugewiesen. Nur das Board stellt das um;
 * der Mandant sieht seine eigene Akte weiter.
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

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

describe('Geheimes Mandat (nur Board of Partners)', () => {
  let srv;
  let board;
  let anwalt;
  let mandant;
  let me;
  let kase;
  before(async () => {
    srv = await startServer();
    board = client(srv.base);
    me = await board.login(TEAM.admin);
    anwalt = client(srv.base);
    await anwalt.login(TEAM.anwalt);
    mandant = client(srv.base);
    assert.equal((await mandant.post('/api/auth/register', { displayName: 'Gerd Geheim', email: 'gerd.geheim', password: PASSWORD })).status, 201);
    const own = (await mandant.post('/api/cases', { title: 'Heikle Sache Zylinder', area: 'zivilrecht', description: 'Bitte vertraulich behandeln.' })).json.case;
    assert.equal((await board.patch(`/api/cases/${own.id}`, { lawyerId: me.id })).status, 200);
    kase = own;
  });
  after(async () => {
    if (srv) await srv.stop();
  });

  it('nur das Board stellt eine Akte auf geheim', async () => {
    const r = await anwalt.patch(`/api/cases/${kase.id}`, { boardOnly: true });
    assert.equal(r.status, 403, r.text);
    const ok = await board.patch(`/api/cases/${kase.id}`, { boardOnly: true });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await board.get(`/api/cases/${kase.id}`)).json.case.boardOnly, true);
  });

  it('andere Mitarbeiter sehen die Akte nirgends', async () => {
    await board.post('/api/tasks', { title: 'Zylinder-Aufgabe', caseId: kase.id, assignedTo: me.id });
    await board.post('/api/calendar', { type: 'intern', title: 'Zylinder-Besprechung', startsAt: inDays(3), caseId: kase.id });
    await board.post('/api/invoices', { caseId: kase.id, items: [{ description: 'Zylinder-Beratung', quantity: 1, unitPrice: 5000 }] });

    assert.ok([403, 404].includes((await anwalt.get(`/api/cases/${kase.id}`)).status), 'Akte selbst gesperrt');
    assert.ok(!(await anwalt.get('/api/cases')).json.cases.some((c) => c.id === kase.id), 'nicht in der Aktenliste');
    assert.ok(!(await anwalt.get('/api/tasks?scope=all')).json.tasks.some((t) => t.caseId === kase.id), 'keine Aufgaben');
    assert.ok(!(await anwalt.get('/api/calendar')).json.events.some((e) => e.caseId === kase.id), 'keine Termine');
    assert.ok(!(await anwalt.get('/api/invoices')).json.invoices.some((i) => i.caseId === kase.id), 'keine Rechnungen');
    const s = (await anwalt.get('/api/search?q=Zylinder')).json.results;
    for (const [k, list] of Object.entries(s)) {
      for (const x of list || []) assert.notEqual(k === 'cases' ? x.id : x.caseId, kase.id, `Suche (${k}) verrät die Akte`);
    }
    assert.equal((await anwalt.patch(`/api/cases/${kase.id}`, { lawyerId: (await anwalt.get('/api/auth/session')).json.user.id })).status >= 400, true, 'nicht übernehmbar');

    // Board und Mandant sehen weiter alles
    assert.ok((await board.get('/api/tasks?scope=all')).json.tasks.some((t) => t.caseId === kase.id), 'Board: Aufgabe');
    assert.ok((await board.get('/api/calendar')).json.events.some((e) => e.caseId === kase.id), 'Board: Termin');
    assert.ok((await board.get('/api/invoices')).json.invoices.some((i) => i.caseId === kase.id), 'Board: Rechnung');
    assert.ok((await board.get('/api/cases')).json.cases.some((c) => c.id === kase.id && c.boardOnly));
    assert.ok((await board.get('/api/search?q=Zylinder')).json.results.cases.some((c) => c.id === kase.id));
    const m = await mandant.get(`/api/cases/${kase.id}`);
    assert.equal(m.status, 200);
    assert.equal(m.json.case.boardOnly, undefined, 'Mandant erfährt nichts vom Vermerk');
  });

  it('zugewiesene Anwälte sehen die Akte, freigeben macht sie wieder sichtbar', async () => {
    const aid = (await anwalt.get('/api/auth/session')).json.user.id;
    assert.equal((await board.patch(`/api/cases/${kase.id}`, { coLawyerIds: [aid] })).status, 200);
    assert.equal((await anwalt.get(`/api/cases/${kase.id}`)).status, 200);
    assert.ok((await anwalt.get('/api/cases')).json.cases.some((c) => c.id === kase.id));
    assert.equal((await board.patch(`/api/cases/${kase.id}`, { coLawyerIds: [] })).status, 200);
    assert.ok(!(await anwalt.get('/api/cases')).json.cases.some((c) => c.id === kase.id));

    assert.equal((await board.patch(`/api/cases/${kase.id}`, { boardOnly: false })).status, 200);
    assert.equal((await anwalt.get(`/api/cases/${kase.id}`)).status, 200);
    assert.ok((await anwalt.get('/api/invoices')).json.invoices.some((i) => i.caseId === kase.id));
  });

  it('beim Anlegen geheim: nur mit Board-Rang', async () => {
    const b = (await board.post('/api/cases', { title: 'Geheim von Anfang an', area: 'zivilrecht', clientName: 'Vera Vertraulich', boardOnly: true })).json.case;
    assert.equal(b.boardOnly, true);
    assert.ok([403, 404].includes((await anwalt.get(`/api/cases/${b.id}`)).status));
    const a = (await anwalt.post('/api/cases', { title: 'Versuch geheim', area: 'zivilrecht', clientName: 'Otto Offen', boardOnly: true })).json.case;
    assert.equal(a.boardOnly, false, 'ohne Board-Rang bleibt die Akte offen');
  });

  it('Browser: Board stellt über „Mehr“ auf geheim, Akte trägt das Schloss', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const k = (await board.post('/api/cases', { title: 'Schloss-Akte', area: 'zivilrecht', clientName: 'Sina Schloss', lawyerId: me.id })).json.case;
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' })).newPage();
    try {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#nav a.nav-item');
      await page.waitForSelector('#content .page-title');
      await page.evaluate((id) => openCase(id), k.id);
      await page.waitForSelector('#modalBody .case-root');
      assert.equal(await page.$('#modalBody .secret-badge'), null);
      await page.click('#modalBody .more-menu:not(.case-add) > summary');
      await page.click('#modalBody [data-action="case-secret"]');
      await page.click('.ps-dialog-root.open [data-ps-dialog="ok"]');
      await page.waitForSelector('#modalBody .secret-badge');
      assert.equal((await board.get(`/api/cases/${k.id}`)).json.case.boardOnly, true);
    } finally {
      await browser.close();
    }
  });
});
