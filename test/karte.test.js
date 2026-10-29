'use strict';
/*
 * Tatort-Karte: Orte einer Akte mit Postleitzahl der FiveM-Karte (Tatort, Festnahme, Fundort …) – API (Postals, Anlegen, Ändern,
 * Löschen, Rechte) und Browser (Karte in der Akte, Zeitregler, Hinzufügen per Postleitzahl und per Klick, PC und Handy).
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

describe('Tatort-Karte (API)', () => {
  let srv;
  let admin;
  let anwalt;
  let mandant;
  let kase;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    anwalt = client(srv.base);
    mandant = client(srv.base);
    await admin.login(TEAM.admin);
    await anwalt.login(TEAM.anwalt);
    await mandant.post('/api/auth/register', { displayName: 'Karla Karte', email: 'karla.karte', password: 'Mandanten-Passwort-5' });
    await mandant.login('karla.karte', 'Mandanten-Passwort-5');
    kase = (await admin.post('/api/cases', { title: 'Überfall Little Seoul', area: 'strafrecht', clientEmail: 'karla.karte' })).json.case;
  });
  after(() => srv.stop());

  it('Postleitzahlen: nur für die Kanzlei, 1687 Einträge [Code, x, y]', async () => {
    assert.equal((await client(srv.base).get('/api/places/postals')).status, 401);
    assert.equal((await mandant.get('/api/places/postals')).status, 403);
    const r = await anwalt.get('/api/places/postals');
    assert.equal(r.status, 200);
    assert.equal(r.json.postals.length, 1687);
    const [code, x, y] = r.json.postals.find((p) => p[0] === '8054');
    assert.equal(code, '8054');
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  });

  it('anlegen per Postleitzahl und per Position (nächster Postal), sortiert nach Zeitpunkt, Prüfung der Werte', async () => {
    const a = await admin.post(`/api/cases/${kase.id}/places`, { postal: '8054', kind: 'tatort', label: 'Tankstelle', happenedAt: T(20) });
    assert.equal(a.status, 201, a.text);
    const b = await admin.post(`/api/cases/${kase.id}/places`, { x: 440, y: -980, kind: 'festnahme', label: 'Vor der Wache', note: 'siehe B2', happenedAt: T(18) });
    assert.equal(b.status, 201, b.text);
    const list = b.json.places;
    assert.deepEqual(list.map((p) => p.label), ['Vor der Wache', 'Tankstelle'], 'früherer Zeitpunkt zuerst');
    assert.equal(list[0].x, 440);
    assert.match(list[0].postal, /^\d{3,5}$/);
    assert.equal(list[1].kindLabel, 'Tatort');
    // Fehler
    assert.equal((await admin.post(`/api/cases/${kase.id}/places`, { postal: '99999', kind: 'tatort' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${kase.id}/places`, { kind: 'tatort' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${kase.id}/places`, { postal: '8054', kind: 'quatsch' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${kase.id}/places`, { postal: 'abc', kind: 'tatort' })).status, 400);
  });

  it('ändern und löschen; Verlauf hält es intern fest', async () => {
    const first = (await admin.get(`/api/cases/${kase.id}`)).json.places[1];
    const r = await admin.patch(`/api/cases/${kase.id}/places/${first.id}`, { label: 'Tankstelle Little Seoul', kind: 'fundort', postal: '8055' });
    assert.equal(r.status, 200, r.text);
    const changed = r.json.places.find((p) => p.id === first.id);
    assert.equal(changed.label, 'Tankstelle Little Seoul');
    assert.equal(changed.kind, 'fundort');
    assert.equal(changed.postal, '8055');
    const del = await admin.del(`/api/cases/${kase.id}/places/${first.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.places.length, 1);
    const notes = (await admin.get(`/api/cases/${kase.id}`)).json.notes.map((n) => n.body).join('\n');
    assert.match(notes, /Ort erfasst: Tatort, Postal 8054/);
    assert.match(notes, /Ort entfernt/);
    assert.equal((await admin.del(`/api/cases/${kase.id}/places/99999`)).status, 404);
  });

  it('Mandanten sehen nichts und ändern nichts; nicht zuständige Anwälte dürfen nur lesen', async () => {
    const mine = (await mandant.get(`/api/cases/${kase.id}`)).json;
    assert.equal(mine.places, undefined);
    assert.equal((await mandant.post(`/api/cases/${kase.id}/places`, { postal: '8054', kind: 'tatort' })).status, 404);
    const other = await anwalt.post(`/api/cases/${kase.id}/places`, { postal: '8054', kind: 'tatort' });
    assert.ok([403, 404].includes(other.status), `Status ${other.status}`);
  });
});

describe('Tatort-Karte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  });
  /** Jede Prüfung bekommt ihre eigene Akte mit drei Orten (eine Prüfung legt selbst weitere an). */
  const seed = async (title) => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    const id = (await a.post('/api/cases', { title, area: 'strafrecht', clientName: 'Karl Karte' })).json.case.id;
    const add = (b) => a.post(`/api/cases/${id}/places`, b);
    await add({ postal: '8054', kind: 'tatort', label: 'Tankstelle', happenedAt: T(20) });
    await add({ postal: '7094', kind: 'zeuge', label: 'Zeuge am Straßenrand', note: 'laut B1', happenedAt: T(19) });
    await add({ postal: '8000', kind: 'festnahme', label: 'Fluchtauto gestoppt', happenedAt: T(21) });
    return id;
  };
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  const login = async (page) => {
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => st.user && st.user.id && typeof fivenetProfilePanel === 'function');
  };
  const open = async (page, caseId) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate((id) => openCase(id), caseId);
      if (await page.waitForSelector('#secKarte #kmapMini', { timeout: 10000 }).then(() => true, () => false)) break;
    }
    await page.waitForFunction(() => typeof kViews !== 'undefined' && kViews.has('kmapMini') && kViews.get('kmapMini').pins.length === 3, null, { timeout: 10000 });
  };

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Karte mit Nadeln und Liste, Zeitregler, Nadel anklicken, Ort per Postleitzahl und per Klick hinzufügen`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await login(page);
        await open(page, await seed(`Überfall Little Seoul (${name})`));
        // Liste nach Zeitpunkt: 19 Uhr, 20 Uhr, 21 Uhr
        const labels = await page.$$eval('#secKarte .place-label', (n) => n.map((x) => x.textContent));
        assert.deepEqual(labels, ['Zeuge am Straßenrand', 'Tankstelle', 'Fluchtauto gestoppt']);
        // Beweisverweis in der Notiz wird anklickbar (kein B1 in dieser Akte → bleibt Text)
        assert.match(await page.textContent('#secKarte .place-note'), /B1/);
        // Zeichenfläche ist nicht leer
        const painted = await page.evaluate(() => {
          const cv = document.getElementById('kmapMini');
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          let lit = 0;
          for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 120 || d[i + 1] > 120) lit += 1;
          return lit;
        });
        assert.ok(painted > 5, `Karte gezeichnet (${painted})`);
        // Zeitregler: auf 1 → zwei Orte ausgegraut
        await page.$eval('#kmapTime', (r) => {
          r.value = '1';
          r.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$$eval('#secKarte .place-row.is-later', (n) => n.length), 2);
        await page.$eval('#kmapTime', (r) => {
          r.value = '3';
          r.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$$eval('#secKarte .place-row.is-later', (n) => n.length), 0);
        // Nadel anklicken → Eintrag in der Liste markiert
        await page.locator('#kmapMini').scrollIntoViewIfNeeded();
        await page.evaluate(() => document.getElementById('kmapMini').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(400);
        const pos = await page.evaluate(() => {
          const v = kViews.get('kmapMini');
          const r = v.cv.getBoundingClientRect();
          const p = v.pins[1];
          return { x: r.left + v.sx(p.x), y: r.top + v.sy(p.y), id: p.id };
        });
        await page.mouse.click(pos.x, pos.y);
        await page.waitForSelector(`#secKarte .place-row.is-on[data-place="${pos.id}"]`, { timeout: 5000 });
        // Hinzufügen per Postleitzahl
        await page.click('[data-action="place-add"]');
        await page.waitForSelector('#kmapForm');
        await page.waitForFunction(() => kViews.has('kmapForm'));
        await page.fill('#plPostal', '9999999');
        await page.fill('#plPostal', '7152');
        await page.waitForFunction(() => /gefunden/.test(document.getElementById('plHint').textContent), null, { timeout: 5000 });
        await page.selectOption('#plKind', 'fundort');
        await page.fill('#plLabel', 'Waffe im Gebüsch');
        await page.click('form[data-form="place-save"] button[type=submit]');
        await page.waitForFunction(() => document.querySelectorAll('#secKarte .place-row').length === 4, null, { timeout: 10000 });
        // Hinzufügen per Klick auf die Karte: der nächste Postal wird gewählt
        await page.click('[data-action="place-add"]');
        await page.waitForSelector('#kmapForm');
        await page.waitForFunction(() => kViews.has('kmapForm') && kViews.get('kmapForm').W > 0);
        const at = await page.evaluate(() => {
          const v = kViews.get('kmapForm');
          const r = v.cv.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.click(at.x, at.y);
        await page.waitForFunction(() => /^\d{3,5}$/.test(document.getElementById('plPostal').value), null, { timeout: 5000 });
        assert.match(await page.textContent('#plHint'), /gefunden/);
        await page.click('[data-action="close-modal"]');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
