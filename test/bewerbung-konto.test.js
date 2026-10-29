'use strict';
/*
 * Bewerbung annehmen: Hat die Person schon ein Konto (z. B. als Mandant), wird beim Einstellen dieses Konto zum
 * Mitarbeiterkonto – ohne neues Passwort, ohne zweites Konto. Ohne Konto bleibt es beim Anlegen mit Einmal-Passwort.
 * Dazu der Browser: Knopf „Einstellen“ bzw. „Einstellen & Konto anlegen“.
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

const MOTIVATION = 'Ich möchte bei Pake & Scha als Associate einsteigen und meine Erfahrung im Strafrecht einbringen – gern auch im Eilnotdienst.';
const apply = (srv, name, email) =>
  client(srv.base).post('/api/public/applications', { positionId: null, name, discord: `${name.split(' ')[0].toLowerCase()}.dc`, email, motivation: MOTIVATION, accept: true });

describe('Bewerbung annehmen: mit und ohne vorhandenes Konto (API)', () => {
  let srv;
  let admin;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    await admin.login(TEAM.admin);
  });
  after(() => srv.stop());

  it('mit Mandantenkonto: Detail meldet das Konto, Einstellen macht es zum Mitarbeiterkonto (ohne Zugangsdaten)', async () => {
    const mia = client(srv.base);
    assert.equal((await mia.post('/api/auth/register', { displayName: 'Mia Mandantin', email: 'mia.mandantin', password: 'Mandanten-Passwort-5' })).status, 201);
    const sent = await apply(srv, 'Mia Mandantin', 'mia@example.org');
    assert.equal(sent.status, 201, sent.text);
    const id = (await admin.get('/api/admin/applications')).json.applications.find((a) => a.name === 'Mia Mandantin').id;
    const d1 = (await admin.get(`/api/admin/applications/${id}`)).json;
    assert.equal(d1.existingUser.role, 'mandant');
    assert.equal(d1.existingUser.email, 'mia.mandantin@pake-scha.ls');
    const hire = await admin.post(`/api/admin/applications/${id}/hire`, { role: 'anwalt', rank: 'Junior Associate', createProfile: true });
    assert.equal(hire.status, 200, hire.text);
    assert.equal(hire.json.credentials, null, 'kein neues Passwort');
    assert.equal(hire.json.converted, true);
    const users = (await admin.get('/api/admin/users')).json.users.filter((u) => u.displayName === 'Mia Mandantin');
    assert.equal(users.length, 1, 'kein zweites Konto');
    assert.equal(users[0].role, 'anwalt');
    assert.equal(users[0].rank, 'Junior Associate');
    // das alte Passwort gilt weiter, die Rolle ist neu
    const again = client(srv.base);
    await again.login('mia.mandantin', 'Mandanten-Passwort-5');
    assert.equal((await again.get('/api/auth/me')).json.user.role, 'anwalt');
    // Protokoll: Einstellung
    const ev = (await admin.get('/api/personnel')).json.events.find((e) => e.name === 'Mia Mandantin');
    assert.equal(ev.type, 'einstellung');
  });

  it('ohne Konto: neues Konto mit Einmal-Passwort; bereits eingestellte Konten werden nicht doppelt angelegt', async () => {
    await apply(srv, 'Nico Neu', 'nico.neu@example.org');
    const id = (await admin.get('/api/admin/applications')).json.applications.find((a) => a.name === 'Nico Neu').id;
    assert.equal((await admin.get(`/api/admin/applications/${id}`)).json.existingUser, null);
    const hire = await admin.post(`/api/admin/applications/${id}/hire`, { email: 'nico.neu', role: 'anwalt', rank: 'Junior Associate' });
    assert.equal(hire.status, 200, hire.text);
    assert.match(hire.json.credentials.email, /^nico\.neu@/);
    assert.ok(hire.json.credentials.password.length >= 8);
    assert.equal((await admin.post(`/api/admin/applications/${id}/hire`, { email: 'nico.neu2', role: 'anwalt', rank: 'Junior Associate' })).status, 400);
  });

});

// zweiter Server: Bewerbungen sind je Absender auf 3 pro Stunde begrenzt
describe('Bewerbung annehmen: Sonderfälle (API)', () => {
  let srv;
  let admin;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    await admin.login(TEAM.admin);
  });
  after(() => srv.stop());

  it('Person mit Mitarbeiterkonto wird nicht noch einmal eingestellt', async () => {
    await apply(srv, 'Lex Kollege', 'damat.lex@pake-scha.ls');
    const id = (await admin.get('/api/admin/applications')).json.applications.find((a) => a.name === 'Lex Kollege').id;
    assert.equal((await admin.get(`/api/admin/applications/${id}`)).json.existingUser.role, 'anwalt');
    assert.equal((await admin.post(`/api/admin/applications/${id}/hire`, { email: 'lex.zwei', role: 'anwalt', rank: 'Junior Associate' })).status, 409);
  });

  it('falsche Zuordnung (gleicher Name, andere Person): „neues Konto“ legt trotzdem ein neues an', async () => {
    const t = client(srv.base);
    await t.post('/api/auth/register', { displayName: 'Tom Treffer', email: 'tom.treffer', password: 'Mandanten-Passwort-5' });
    await apply(srv, 'Tom Treffer', 'tom@example.org');
    const id = (await admin.get('/api/admin/applications')).json.applications.find((a) => a.name === 'Tom Treffer').id;
    assert.equal((await admin.get(`/api/admin/applications/${id}`)).json.existingUser.email, 'tom.treffer@pake-scha.ls');
    const hire = await admin.post(`/api/admin/applications/${id}/hire`, { email: 'tom.zwei', role: 'anwalt', rank: 'Junior Associate', newAccount: true });
    assert.equal(hire.status, 200, hire.text);
    assert.equal(hire.json.converted, false);
    assert.match(hire.json.credentials.email, /^tom\.zwei@/);
  });
});

describe('Bewerbung annehmen: Knopf je nach Konto (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  it('PC: „Einstellen“ bei vorhandenem Konto (ohne E-Mail-Feld), sonst „Einstellen & Konto anlegen“ mit E-Mail', async () => {
    const mia = client(srv.base);
    await mia.post('/api/auth/register', { displayName: 'Mia Mandantin', email: 'mia.mandantin', password: 'Mandanten-Passwort-5' });
    await apply(srv, 'Mia Mandantin', 'mia@example.org');
    await apply(srv, 'Nico Neu', 'nico.neu@example.org');
    const admin = client(srv.base);
    await admin.login(TEAM.admin);
    const list = (await admin.get('/api/admin/applications')).json.applications;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForFunction(() => typeof openApplication === 'function');
      const label = async (name) => {
        await page.evaluate((id) => openApplication(id), list.find((a) => a.name === name).id);
        await page.waitForSelector('[data-action="app-hire"]');
        return page.textContent('[data-action="app-hire"]');
      };
      assert.equal((await label('Mia Mandantin')).trim(), 'Einstellen');
      assert.match(await page.textContent('#modalBody .banner'), /Hat schon ein Konto/);
      await page.click('[data-action="app-hire"]');
      await page.waitForSelector('form[data-form="app-hire"]');
      assert.equal(await page.locator('form[data-form="app-hire"] input[name="email"]').count(), 0, 'kein E-Mail-Feld bei vorhandenem Konto');
      await page.evaluate(() => document.querySelector('#modalBack, .modal-close')?.click());
      await page.waitForTimeout(300);
      assert.match(await label('Nico Neu'), /Einstellen & Konto anlegen/);
      await page.click('[data-action="app-hire"]');
      await page.waitForSelector('form[data-form="app-hire"] input[name="email"]');
    } finally {
      await ctx.close();
    }
  });
});
