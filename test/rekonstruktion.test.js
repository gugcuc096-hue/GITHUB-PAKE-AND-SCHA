'use strict';
/*
 * Tatort-Rekonstruktion: Blickrichtung und Sichtfeld je Ort, Sichtlinien Zeuge → Tatort, Ablauf als Film mit Untertiteln und
 * Export der Karte als Bild – API (Prüfung der Werte) und Browser (PC und Handy).
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

const T = (h) => new Date(Date.UTC(2026, 9, 5, h, 0, 0)).toISOString();

describe('Tatort-Rekonstruktion (API)', () => {
  let srv;
  let admin;
  let kase;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    await admin.login(TEAM.admin);
    kase = (await admin.post('/api/cases', { title: 'Sicht-Test', area: 'strafrecht', clientName: 'Max Muster' })).json.case;
  });
  after(() => srv.stop());

  it('Blickrichtung, Sichtweite und Sichtfeld speichern, ändern, entfernen; Standardwerte; Prüfung der Werte', async () => {
    const a = await admin.post(`/api/cases/${kase.id}/places`, { x: 100, y: 100, kind: 'zeuge', lookDir: 45, lookRange: 120, lookFov: 90 });
    assert.equal(a.status, 201, a.text);
    const w = a.json.places[0];
    assert.deepEqual([w.lookDir, w.lookRange, w.lookFov], [45, 120, 90]);
    const b = await admin.post(`/api/cases/${kase.id}/places`, { x: 200, y: 200, kind: 'tatort' });
    const t = b.json.places.find((p) => p.kind === 'tatort');
    assert.deepEqual([t.lookDir, t.lookRange, t.lookFov], [null, 80, 70], 'ohne Angabe: keine Blickrichtung, Standardwerte');
    const c = await admin.patch(`/api/cases/${kase.id}/places/${w.id}`, { lookDir: 270 });
    assert.equal(c.json.places.find((p) => p.id === w.id).lookDir, 270);
    assert.equal(c.json.places.find((p) => p.id === w.id).lookRange, 120, 'andere Werte bleiben');
    const d = await admin.patch(`/api/cases/${kase.id}/places/${w.id}`, { lookDir: null });
    assert.equal(d.json.places.find((p) => p.id === w.id).lookDir, null);
    for (const bad of [{ lookDir: 360 }, { lookDir: -1 }, { lookDir: 1.5 }, { lookRange: 4 }, { lookRange: 501 }, { lookFov: 9 }, { lookFov: 181 }]) {
      assert.equal((await admin.patch(`/api/cases/${kase.id}/places/${w.id}`, bad)).status, 400, JSON.stringify(bad));
    }
  });
});

describe('Tatort-Rekonstruktion (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Sichtlinien mit Urteil, Film mit Untertiteln, Export als PNG, Formular mit Blickrichtung`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const id = (await a.post('/api/cases', { title: `Rekonstruktion ${name}`, area: 'strafrecht', clientName: 'Max Muster' })).json.case.id;
      // Tatort im Norden (0, 60), Zeuge im Ursprung blickt nach Norden: 60 m, im Sichtfeld
      await a.post(`/api/cases/${id}/places`, { x: 0, y: 60, kind: 'tatort', label: 'Tankstelle', note: 'Hier fiel der erste Schuss.', happenedAt: T(20) });
      await a.post(`/api/cases/${id}/places`, { x: 0, y: 0, kind: 'zeuge', label: 'Zeuge Falk', lookDir: 0, lookRange: 80, lookFov: 70, happenedAt: T(19) });
      await a.post(`/api/cases/${id}/places`, { x: 300, y: 300, kind: 'festnahme', label: 'Festnahme', happenedAt: T(21) });
      const ctx = await browser.newContext({ ...device, locale: 'de-DE', acceptDownloads: true });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => typeof openCase === 'function' && st.user && st.user.id);
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((i) => openCase(i), id);
          if (await page.waitForSelector('#kmapMini', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        await page.waitForSelector('#kmapMini');
        // Sicht
        assert.equal(await page.isVisible('#kmapSightBox'), false, 'Sicht ist zunächst aus');
        await page.click('[data-action="kmap-sight"]');
        await page.waitForSelector('#kmapSightBox:not([hidden])');
        let text = await page.textContent('#kmapSightBox');
        assert.match(text, /60 m Luftlinie/);
        assert.match(text, /im Sichtfeld/);
        assert.match(text, /blickt nach N \(0°\), Sichtweite 80 m, Sichtfeld 70°/);
        // Zeuge schaut weg → außerhalb
        const wid = (await a.get(`/api/cases/${id}`)).json.places.find((p) => p.kind === 'zeuge').id;
        await a.patch(`/api/cases/${id}/places/${wid}`, { lookDir: 180 });
        await page.evaluate((i) => reloadCase(i), id);
        await page.waitForSelector('#kmapSightBox:not([hidden])');
        text = await page.textContent('#kmapSightBox');
        assert.match(text, /außerhalb des Sichtfelds/);
        // Export
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="kmap-export"]')]);
        assert.match(dl.suggestedFilename(), /^Tatort-Rekonstruktion.*\.png$/);
        const file = await dl.path();
        const head = require('node:fs').readFileSync(file).subarray(0, 8);
        assert.equal(head.toString('hex'), '89504e470d0a1a0a', 'PNG');
        // Film
        await page.click('[data-action="kmap-play"]');
        await page.waitForSelector('.kmap-cap');
        assert.match(await page.textContent('.kmap-cap'), /[12] \/ 3/);
        assert.equal(await page.evaluate(() => document.getElementById('kmapWrap').classList.contains('is-big')), true, 'Film läuft groß');
        await page.waitForFunction(() => /2 \/ 3/.test(document.querySelector('.kmap-cap')?.textContent || ''), null, { timeout: 8000 });
        assert.match(await page.textContent('.kmap-cap'), /Tankstelle/);
        assert.match(await page.textContent('.kmap-cap'), /\+1 Std\./, 'Abstand zum vorigen Schritt');
        await page.click('[data-action="kmap-play"]'); // anhalten
        await page.waitForFunction(() => !document.querySelector('.kmap-cap'), null, { timeout: 8000 });
        assert.equal(await page.evaluate(() => document.getElementById('kmapWrap').classList.contains('is-big')), false, 'danach wieder klein');
        // Formular: Blickrichtung per Himmelsrichtung
        await page.click('[data-action="place-add"]');
        await page.waitForSelector('#plDir');
        await page.click('[data-action="look-dir"][data-deg="135"]');
        assert.equal(await page.inputValue('#plDir'), '135');
        await page.click('[data-action="look-clear"]');
        assert.equal(await page.inputValue('#plDir'), '');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
