'use strict';
/*
 * Personalprotokoll: Degradieren und Kündigen neben Befördern – Rechte, Wirkung (Rang, Sperre, Website-Profil, offene Akten)
 * und Bedienung im Dashboard.
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

async function makeStaff(admin, name, email, rank) {
  const r = await admin.post('/api/admin/users', { displayName: name, email, role: 'anwalt', rank });
  assert.equal(r.status, 201, r.text);
  return { ...r.json.user, credentials: r.json.credentials };
}

describe('Personalprotokoll: Degradieren und Kündigen (API)', () => {
  let srv;
  let admin;
  let anwalt;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    anwalt = client(srv.base);
    await admin.login(TEAM.admin);
    await anwalt.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  it('Degradieren: nur zu einem niedrigeren Rang, nur Board, Protokoll und Team-Profil ziehen mit', async () => {
    const u = await makeStaff(admin, 'Dora Degrad', 'dora.degrad', 'Senior Associate');
    assert.equal((await anwalt.post('/api/personnel/demote', { userId: u.id, rank: 'Junior Associate' })).status, 403, 'kein Board');
    assert.equal((await admin.post('/api/personnel/demote', { userId: u.id, rank: 'Partner' })).status, 400, 'höherer Rang ist keine Degradierung');
    assert.equal((await admin.post('/api/personnel/demote', { userId: u.id, rank: 'Senior Associate' })).status, 400, 'gleicher Rang');
    const ok = await admin.post('/api/personnel/demote', { userId: u.id, rank: 'Junior Associate', note: 'Leistung' });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.type, 'rueckstufung');
    assert.equal(ok.json.typeLabel, 'Degradierung');
    const row = (await admin.get('/api/admin/users')).json.users.find((x) => x.id === u.id);
    assert.equal(row.rank, 'Junior Associate');
    const ev = (await admin.get('/api/personnel')).json.events.find((e) => e.name === 'Dora Degrad' && e.type === 'rueckstufung');
    assert.equal(ev.oldRank, 'Senior Associate');
    assert.equal(ev.newRank, 'Junior Associate');
    assert.equal(ev.note, 'Leistung');
    assert.equal((await admin.post('/api/personnel/demote', { userId: 1e9, rank: 'Junior Associate' })).status, 404);
  });

  it('Kündigen: Konto gesperrt, Anmeldung und Sitzung enden, Website-Profil weg, offene Akten werden gemeldet; Regeln', async () => {
    const u = await makeStaff(admin, 'Kurt Kündig', 'kurt.kuendig', 'Associate');
    const kurt = client(srv.base);
    assert.equal((await kurt.post('/api/auth/login', { email: u.credentials.email, password: u.credentials.password })).status, 200);
    const k = (await admin.post('/api/cases', { title: 'Fall von Kurt', area: 'strafrecht', clientName: 'Max', lawyerId: u.id })).json.case;
    assert.ok(k.id);
    const list = (await admin.get('/api/personnel')).json.staff.find((s) => s.id === u.id);
    assert.equal(list.terminable, true);
    assert.equal(list.openCases, 1);
    assert.equal((await anwalt.post('/api/personnel/terminate', { userId: u.id })).status, 403, 'kein Board');
    const self = (await admin.get('/api/auth/me')).json.user;
    assert.equal((await admin.post('/api/personnel/terminate', { userId: self.id })).status, 403, 'nicht sich selbst');
    const ok = await admin.post('/api/personnel/terminate', { userId: u.id, note: 'Vertragsende' });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.type, 'kuendigung');
    assert.equal(ok.json.openCases, 1);
    assert.equal((await kurt.get('/api/auth/me')).status, 401, 'Sitzung beendet');
    const again = await client(srv.base).post('/api/auth/login', { email: u.credentials.email, password: u.credentials.password });
    assert.ok([401, 403].includes(again.status), `Anmeldung gesperrt (${again.status})`);
    const users = (await admin.get('/api/admin/users')).json.users.find((x) => x.id === u.id);
    assert.equal(users.active, false);
    const ev = (await admin.get('/api/personnel')).json.events.find((e) => e.name === 'Kurt Kündig' && e.type === 'kuendigung');
    assert.equal(ev.oldRank, 'Associate');
    assert.equal(ev.note, 'Vertragsende');
    assert.equal((await admin.get('/api/personnel')).json.staff.some((s) => s.id === u.id), false, 'taucht in der Liste nicht mehr auf');
    assert.equal((await admin.post('/api/personnel/terminate', { userId: u.id })).status, 404, 'zweimal geht nicht');
  });
});

describe('Personalprotokoll: Bedienung (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Degradieren und Kündigen im Dialog, Protokoll zeigt beides`, async () => {
      const admin = client(srv.base);
      await admin.login(TEAM.admin);
      const d = await makeStaff(admin, `Dora ${name}`, `dora.${name.toLowerCase()}`, 'Senior Associate');
      const k = await makeStaff(admin, `Kurt ${name}`, `kurt.${name.toLowerCase()}`, 'Associate');
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
        await page.waitForFunction(() => typeof views !== 'undefined' && st.user && st.user.id);
        await page.goto(`${srv.base}/dashboard#personnel`);
        await page.waitForSelector('[data-action="personnel-demote"]');
        assert.equal(await page.$$eval('.page-actions button', (b) => b.map((x) => x.textContent.trim()).join('|')), 'Befördern|Degradieren|Kündigen');
        // Degradieren: ein höherer Rang wird im Dialog beanstandet, ein niedrigerer geht
        await page.click('[data-action="personnel-demote"]');
        await page.selectOption('#prUser', String(d.id));
        await page.selectOption('#prRank', 'Partner');
        assert.match(await page.textContent('#prPreview'), /nicht niedriger/);
        await page.selectOption('#prRank', 'Junior Associate');
        await page.fill('#prNote', 'Neuaufstellung');
        await page.click('form[data-form="personnel-demote"] button[type=submit]');
        await page.waitForFunction((n) => [...document.querySelectorAll('.pers-row')].some((r) => r.textContent.includes(n) && /degradiert/.test(r.textContent)), `Dora ${name}`, { timeout: 15000 });
        // Kündigen: ohne Häkchen geht es nicht, mit Häkchen ist das Konto gesperrt
        await page.click('[data-action="personnel-terminate"]');
        await page.selectOption('#tmUser', String(k.id));
        await page.click('form[data-form="personnel-terminate"] button[type=submit]');
        await page.waitForTimeout(400);
        assert.equal((await admin.get('/api/admin/users')).json.users.find((x) => x.id === k.id).active, true, 'ohne Bestätigung passiert nichts');
        await page.check('input[name="sure"]');
        await page.click('form[data-form="personnel-terminate"] button[type=submit]');
        await page.waitForFunction((n) => [...document.querySelectorAll('.pers-row')].some((r) => r.textContent.includes(n) && /gekündigt/.test(r.textContent)), `Kurt ${name}`, { timeout: 15000 });
        assert.equal((await admin.get('/api/admin/users')).json.users.find((x) => x.id === k.id).active, false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
