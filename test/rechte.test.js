'use strict';
/*
 * Rechte der Konfiguration: Inhaber, Web-Admins, Rechte-Tabelle, Änderungsprotokoll, Feature-Schalter.
 * Neben der API auch das Dashboard (Reiter „Rechte & Schalter“) am PC und am Handy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

describe('Rechte der Konfiguration', () => {
  let srv;
  let owner;
  let board;
  let lex;
  let lexUser;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    board = client(srv.base);
    lex = client(srv.base);
    await owner.login(TEAM.admin);
    await board.login(TEAM.partner);
    lexUser = await lex.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  it('der erste Admin ist Inhaber und hat alle Rechte', async () => {
    const me = (await owner.get('/api/auth/me')).json.user;
    assert.equal(me.owner, true);
    assert.ok(me.perms.includes('access.manage') && me.perms.includes('fees.edit') && me.perms.includes('site.edit'));
  });

  it('das Board of Partners ändert ab Werk keine Konfiguration', async () => {
    const me = (await board.get('/api/auth/me')).json.user;
    assert.equal(me.owner, false);
    assert.deepEqual(me.perms, []);
    assert.equal((await board.get('/api/admin/settings')).status, 403);
    assert.equal((await board.patch('/api/admin/settings', { firmContact: 'x' })).status, 403);
    assert.equal((await board.post('/api/admin/fees', { category: 'rechtsberatung', name: 'Test', price: 10 })).status, 403);
    assert.equal((await board.get('/api/site/texts')).status, 403);
    assert.equal((await board.get('/api/bot')).status, 403);
    assert.equal((await board.put('/api/access/matrix', { webadmin: [], board: [], anwalt: [] })).status, 403);
    // Konten und Protokoll bleiben beim Board
    assert.equal((await board.get('/api/admin/users')).status, 200);
  });

  it('nur der Inhaber ernennt Web-Admins', async () => {
    assert.equal((await lex.post('/api/access/web-admins', { userId: lexUser.id })).status, 403);
    assert.equal((await board.post('/api/access/web-admins', { userId: lexUser.id })).status, 403);
    const r = await owner.post('/api/access/web-admins', { userId: lexUser.id });
    assert.equal(r.status, 200, r.text);
    const me = (await lex.get('/api/auth/me')).json.user;
    assert.equal(me.webAdmin, true);
    assert.ok(me.perms.includes('settings.edit') && me.perms.includes('fees.edit'));
    assert.ok(!me.perms.includes('access.manage'));
    // ein Web-Admin ernennt keine weiteren
    assert.equal((await lex.post('/api/access/web-admins', { userId: lexUser.id })).status, 403);
  });

  it('Web-Admins dürfen Einstellungen und Honorarordnung ändern – aber keine Konten anlegen', async () => {
    assert.equal((await lex.patch('/api/admin/settings', { firmContact: 'kontakt@pake-scha.ls' })).status, 200);
    assert.equal((await lex.post('/api/admin/fees', { category: 'rechtsberatung', name: 'Web-Admin-Leistung', price: 25 })).status, 201);
    assert.equal((await lex.get('/api/admin/users')).status, 403);
    assert.equal((await lex.get('/api/admin/audit')).status, 403);
  });

  it('das Änderungsprotokoll nennt Person, alten und neuen Wert – und setzt zurück', async () => {
    await lex.patch('/api/admin/settings', { firmContact: 'zweiter-wert' });
    const log = (await lex.get('/api/access/log')).json.log;
    const e = log.find((x) => x.key === 'firm_contact' && x.after === 'zweiter-wert');
    assert.ok(e, JSON.stringify(log.slice(0, 3)));
    assert.equal(e.user, lexUser.displayName);
    assert.equal(e.before, 'kontakt@pake-scha.ls');
    assert.equal(e.revertible, true);
    // ohne Recht kein Zurücksetzen
    assert.equal((await board.post(`/api/access/log/${e.id}/revert`)).status, 403);
    assert.equal((await lex.post(`/api/access/log/${e.id}/revert`)).status, 200);
    assert.equal((await owner.get('/api/admin/settings')).json.settings.firmContact, 'kontakt@pake-scha.ls');
    // nicht zweimal
    assert.equal((await lex.post(`/api/access/log/${e.id}/revert`)).status, 400);
  });

  it('Rechte-Tabelle: der Inhaber gibt dem Board etwas frei und nimmt es zurück', async () => {
    const m = (await owner.get('/api/access')).json.matrix;
    const r = await owner.put('/api/access/matrix', { ...m, board: ['fees.edit'] });
    assert.equal(r.status, 200, r.text);
    assert.equal((await board.post('/api/admin/fees', { category: 'rechtsberatung', name: 'Board-Leistung', price: 5 })).status, 201);
    assert.equal((await board.patch('/api/admin/settings', { firmContact: 'nein' })).status, 403);
    await owner.put('/api/access/matrix', m);
    assert.equal((await board.post('/api/admin/fees', { category: 'rechtsberatung', name: 'Board-Leistung 2', price: 5 })).status, 403);
    // die Änderung der Tabelle steht im Protokoll und lässt sich zurücksetzen
    const e = (await owner.get('/api/access/log')).json.log.find((x) => x.area === 'permissions' && x.revertible);
    assert.ok(e);
  });

  it('Web-Admin entziehen nimmt die Rechte wieder', async () => {
    assert.equal((await owner.del(`/api/access/web-admins/${lexUser.id}`)).status, 200);
    assert.equal((await lex.patch('/api/admin/settings', { firmContact: 'x' })).status, 403);
    assert.deepEqual((await lex.get('/api/auth/me')).json.user.perms, []);
  });

  it('Feature-Schalter nehmen Funktionen aus Website und API', async () => {
    assert.equal((await board.put('/api/access/features', { reviews: false })).status, 403);
    assert.equal((await owner.put('/api/access/features', { reviews: false, vip: false, karriere: false })).status, 200);
    assert.deepEqual((await client(srv.base).get('/api/public/reviews')).json.reviews, []);
    assert.deepEqual((await client(srv.base).get('/api/public/memberships')).json.tiers, []);
    assert.deepEqual((await client(srv.base).get('/api/public/positions')).json.positions, []);
    const pub = (await client(srv.base).get('/api/public/features')).json.features;
    assert.equal(pub.reviews, false);
    assert.equal(pub.clientLink, true);
    assert.equal((await owner.put('/api/access/features', { reviews: true, vip: true, karriere: true })).status, 200);
  });

  it('Mandanten haben keinen Zugriff auf die Rechte', async () => {
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Rita Rechte', email: 'rita.rechte', password: 'Mandanten-Passwort-5' });
    await m.login('rita.rechte', 'Mandanten-Passwort-5');
    assert.equal((await m.get('/api/access')).status, 403);
    assert.deepEqual((await m.get('/api/auth/me')).json.user.perms, []);
  });
});

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}
const { PASSWORD } = require('./helpers');

describe('Rechte & Schalter im Dashboard', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  async function enter(email, device) {
    const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    return { ctx, page, problems };
  }
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Inhaber ernennt einen Web-Admin und ändert die Rechte-Tabelle`, async () => {
      const { ctx, page, problems } = await enter(TEAM.admin, device);
      await page.evaluate(() => (location.href = '/dashboard?tab=access#settings'));
      await page.waitForSelector('.perm-table', { timeout: 15000 });
      assert.equal(await page.locator('.perm-table tbody tr').count(), 7);
      assert.equal(await noOverflow(page), true);
      // Web-Admin ernennen (beim zweiten Durchlauf ist die Person es schon)
      const option = page.locator('select[name=userId] option', { hasText: 'Lex' }).first();
      if (await option.count()) {
        await page.selectOption('select[name=userId]', (await option.getAttribute('value')) || '');
        await page.click('form[data-form="webadmin-add"] button[type=submit]');
      }
      await page.waitForFunction(() => /Lex/.test(document.querySelector('.ev-list')?.textContent || ''), null, { timeout: 8000 });
      // Board bekommt die Honorarordnung
      await page.check('input[name="board"][value="fees.edit"]');
      await page.click('form[data-form="perm-matrix"] button[type=submit]');
      await page.waitForFunction(() => document.querySelector('input[name="board"][value="fees.edit"]')?.checked === true, null, { timeout: 8000 });
      const matrix = (await (await ctx.request.get(`${srv.base}/api/access`)).json()).matrix;
      assert.ok(matrix.board.includes('fees.edit'));
      assert.deepEqual(problems, []);
      // aufräumen für den nächsten Durchlauf
      await ctx.request.put(`${srv.base}/api/access/matrix`, { data: { ...matrix, board: [] } });
      await ctx.close();
    });
  }

  it('Web-Admin sieht Einstellungen und Honorarordnung, aber nicht die Benutzerverwaltung', async () => {
    const owner = client(srv.base);
    await owner.login(TEAM.admin);
    const lexId = (await client(srv.base).login(TEAM.anwalt)).id;
    await owner.post('/api/access/web-admins', { userId: lexId });
    const { ctx, page, problems } = await enter(TEAM.anwalt, { viewport: { width: 1366, height: 900 } });
    await page.waitForSelector('#nav a[href="#settings"]', { timeout: 15000 });
    assert.ok(await page.locator('#nav a[href="#fees"]').count());
    assert.equal(await page.locator('#nav a[href="#users"]').count(), 0);
    await page.evaluate(() => (location.href = '/dashboard?tab=general#settings'));
    await page.waitForSelector('[data-form="settings-firm"]', { timeout: 15000 });
    // Reiter „Rechte & Schalter“: Rechte-Tabelle nur lesbar, kein Ernennen
    await page.click('[data-action="settings-tab"][data-tab="access"]');
    await page.waitForSelector('.perm-table');
    assert.equal(await page.locator('form[data-form="perm-matrix"]').count(), 0);
    assert.equal(await page.locator('form[data-form="webadmin-add"]').count(), 0);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});
