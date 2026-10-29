'use strict';
/*
 * Kaltstart und Systemzustand: Skripte werden im Hintergrund gepackt (der Server bleibt ansprechbar) und fertig auf der Platte
 * abgelegt, fehlende Indizes für Fremdschlüssel werden angelegt, der Systemzustand zeigt Zeiten, Datenbank und Selbsttest –
 * API (Rechte) und Ansicht im Dashboard am PC und am Handy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

const ROOT = path.join(__dirname, '..');
const node = (code, env = {}) => execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

describe('Skripte packen, ohne den Server zu blockieren', () => {
  it('im Hintergrund gepackt: der Server bleibt ansprechbar, Ergebnis liegt danach auf der Platte und wird beim nächsten Start nur gelesen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packed-'));
    const script = `
      process.env.NODE_ENV = 'production';
      const assets = require('./assets');
      let last = Date.now(), worst = 0;
      const t = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 20); last = now; }, 20);
      const t0 = Date.now();
      assets.packAll().then((n) => { clearInterval(t); console.log(JSON.stringify({ n, ms: Date.now() - t0, worst })); process.exit(0); });
    `;
    const first = JSON.parse(node(script, { PACK_DIR: dir }).split('\n').pop());
    assert.ok(first.n > 10, `Dateien gepackt: ${first.n}`);
    // Das Packen läuft in Hintergrundfäden: der Takt des Servers bricht nie lange ab (blockierend waren es mehrere Sekunden)
    assert.ok(first.worst < 900, `längste Pause des Servers ${first.worst} ms`);
    const versions = fs.readdirSync(dir);
    assert.equal(versions.length, 1, 'eine Version auf der Platte');
    assert.ok(fs.readdirSync(path.join(dir, versions[0])).length >= first.n);
    // Zweiter Start: nur lesen – deutlich schneller als neu rechnen
    const second = JSON.parse(node(script, { PACK_DIR: dir }).split('\n').pop());
    assert.ok(second.ms < first.ms / 2, `zweiter Lauf ${second.ms} ms statt ${first.ms} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Indizes für Fremdschlüssel', () => {
  it('fehlende werden angelegt, vorhandene bleiben, ein zweiter Lauf legt nichts an', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-'));
    const out = node(
      `
      const { db } = require('./db');
      const health = require('./health');
      health.ensureIndexes();
      db.exec('CREATE TABLE zz_eltern (id INTEGER PRIMARY KEY); CREATE TABLE zz_kinder (id INTEGER PRIMARY KEY, eltern INTEGER REFERENCES zz_eltern(id), bezug INTEGER REFERENCES zz_eltern(id)); CREATE INDEX idx_zz_bezug ON zz_kinder(bezug);');
      const made = health.ensureIndexes();
      const again = health.ensureIndexes();
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'zz_kinder'").all().map((r) => r.name).sort();
      console.log(JSON.stringify({ made, again, idx }));
    `,
      { DB_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test' }
    );
    const r = JSON.parse(out.split('\n').pop());
    assert.deepEqual([r.made, r.again], [1, 0]);
    assert.deepEqual(r.idx, ['idx_fk_zz_kinder_eltern', 'idx_zz_bezug']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Systemzustand (API)', () => {
  let srv;
  let admin;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    await admin.login(TEAM.admin);
  });
  after(() => srv.stop());

  it('Zeiten, Datenbank, Sicherungen, Anfragen und Selbsttest', async () => {
    await admin.get('/api/cases');
    await admin.get('/api/cases');
    const r = await admin.get('/api/system');
    assert.equal(r.status, 200, r.text);
    const s = r.json;
    assert.ok(s.uptimeSeconds >= 0 && s.node.startsWith('v'));
    assert.ok(s.bootMs > 0 && s.bootMs < 60000, `Startdauer ${s.bootMs}`);
    assert.ok(s.db.bytes > 0 && s.db.indexes > 10 && s.db.counts.users >= 3);
    assert.ok(s.routes.some((x) => x.route === 'GET /api/cases' && x.n >= 2), 'Anfragen gezählt');
    assert.ok(!s.routes.some((x) => x.route.includes('/api/events')), 'Live-Verbindung nicht mitgezählt');
    assert.ok(Array.isArray(s.slow));
  });

  it('Selbsttest gründlich und Datenbank optimieren; Rechte', async () => {
    const c = await admin.post('/api/system/check');
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.result.ok, true, JSON.stringify(c.json.result.checks.filter((x) => !x.ok)));
    assert.ok(c.json.result.deep && c.json.result.checks.some((x) => x.name.includes('quick_check')));
    assert.equal(c.json.snapshot.selfTest.deep, true, 'Ergebnis gemerkt');
    const o = await admin.post('/api/system/optimize');
    assert.equal(o.status, 200, o.text);
    assert.ok(o.json.ms >= 0);
    // ohne Anmeldung, als Mandant und ohne Recht „System“: kein Zugriff
    assert.equal((await client(srv.base).get('/api/system')).status, 401);
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Sven System', email: 'sven.system', password: 'Mandanten-Passwort-5' });
    await m.login('sven.system', 'Mandanten-Passwort-5');
    assert.equal((await m.get('/api/system')).status, 403);
    assert.equal((await m.post('/api/system/check')).status, 403);
  });
});

describe('Systemzustand im Dashboard (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Ansicht „Systemzustand“, Selbsttest jetzt, Datenbank optimieren`, async () => {
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
        await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
        await page.waitForFunction(() => !!views.system, null, { timeout: 15000 }); // Verwaltungsteile laden nach
        await page.evaluate(() => navigate('system'));
        await page.waitForSelector('#content .kpi', { timeout: 10000 });
        assert.equal(await page.textContent('#content .page-title'), 'Systemzustand');
        assert.ok((await page.textContent('#content')).includes('Start dauerte'));
        await page.click('[data-action="sys-check"]');
        await page.waitForFunction(() => document.querySelectorAll('.sys-checks li.ok').length >= 5 && document.body.textContent.includes('gründlich'), null, { timeout: 15000 });
        assert.equal(await page.$$eval('.sys-checks li.bad', (x) => x.length), 0);
        await page.click('[data-action="sys-optimize"]');
        await page.waitForFunction(() => [...document.querySelectorAll('.ps-toast')].some((t) => t.textContent.includes('optimiert')), null, { timeout: 10000 });
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
