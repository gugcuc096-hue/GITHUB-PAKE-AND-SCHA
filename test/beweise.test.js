'use strict';
/*
 * Beweismittel: feste B-Nummern (auch nach dem Löschen nie neu vergeben), Angaben je Beweismittel (Art, Herkunft, Zeitpunkt,
 * Lager, Stand, Beschreibung – Einschätzung nur für die Kanzlei) und klickbare Verweise „B7“ in der Akte am PC und am Handy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD, pickTab } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Beweismittel (API)', () => {
  let srv;
  let owner;
  let other;
  let mandant;
  let kase;
  const up = async (caption, internal = 0) => (await owner.upload(`/api/cases/${kase.id}/attachments?caption=${encodeURIComponent(caption)}&internal=${internal}`, PNG, 'image/png')).json.attachment;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    other = client(srv.base);
    mandant = client(srv.base);
    await owner.login(TEAM.admin);
    await other.login(TEAM.anwalt);
    await mandant.post('/api/auth/register', { displayName: 'Bea Beweis', email: 'bea.beweis', password: 'Mandanten-Passwort-5' });
    await mandant.login('bea.beweis', 'Mandanten-Passwort-5');
    kase = (await owner.post('/api/cases', { title: 'Verkehrskontrolle Doe', area: 'strafrecht', clientEmail: 'bea.beweis' })).json.case;
  });
  after(() => srv.stop());

  it('feste Nummern: B1, B2, B3 – nach dem Löschen wird keine Nummer neu vergeben', async () => {
    const a = await up('Standbild Bodycam');
    const b = await up('Tatort von Norden', 1);
    const c = await up('Screenshot Chat');
    assert.deepEqual([a.no, b.no, c.no], [1, 2, 3]);
    assert.equal((await owner.del(`/api/cases/${kase.id}/attachments/${c.id}`)).status, 200);
    const d = await up('Neues Foto');
    assert.equal(d.no, 4, 'B3 bleibt frei – ein Verweis „B3“ meint nie ein anderes Bild');
    // Mandant sieht nur Nicht-Internes, aber mit denselben Nummern
    const seen = (await mandant.get(`/api/cases/${kase.id}`)).json.attachments;
    assert.deepEqual(seen.map((x) => x.no), [1, 4]);
    // andere Akte zählt für sich
    const k2 = (await owner.post('/api/cases', { title: 'Zweite Akte', area: 'zivilrecht', clientName: 'Paul Weber' })).json.case;
    const e = (await owner.upload(`/api/cases/${k2.id}/attachments`, PNG, 'image/png')).json.attachment;
    assert.equal(e.no, 1);
  });

  it('beschreiben: Art, Herkunft, Zeitpunkt, Lager, Stand, Beschreibung – Prüfung der Werte', async () => {
    const list = (await owner.get(`/api/cases/${kase.id}`)).json.attachments;
    const a = list.find((x) => x.no === 1);
    assert.deepEqual([a.kind, a.status, a.side, a.source], ['foto', 'gesichert', '', ''], 'Standardwerte');
    const r = await owner.patch(`/api/cases/${kase.id}/attachments/${a.id}`, {
      caption: 'Standbild Bodycam 22:14',
      kind: 'bodycam',
      source: 'Polizeiakte',
      obtainedAt: '2026-10-12T22:14:00.000Z',
      side: 'entlastend',
      status: 'eingereicht',
      description: 'Zeigt, dass die Waffe erst nach dem Angriff gezogen wurde.',
    });
    assert.equal(r.status, 200, r.text);
    const got = r.json.attachment;
    assert.deepEqual([got.no, got.kindLabel, got.statusLabel, got.side, got.obtainedAt], [1, 'Bodycam / Video', 'Eingereicht', 'entlastend', '2026-10-12T22:14:00.000Z']);
    assert.equal((await owner.patch(`/api/cases/${kase.id}/attachments/${a.id}`, { kind: 'hologramm' })).status, 400);
    assert.equal((await owner.patch(`/api/cases/${kase.id}/attachments/${a.id}`, { status: 'weg' })).status, 400);
    assert.equal((await owner.patch(`/api/cases/${kase.id}/attachments/${a.id}`, { obtainedAt: 'gestern' })).status, 400);
    // Stand-Wechsel steht im internen Verlauf
    const notes = (await owner.get(`/api/cases/${kase.id}`)).json.notes;
    assert.ok(notes.some((n) => n.body.includes('Beweismittel B1: Eingereicht') && n.internal));
  });

  it('Einschätzung nur für die Kanzlei: Mandanten sehen Nummer, Art und Zeitpunkt, aber kein Lager, Stand, Herkunft, Beschreibung', async () => {
    const m = (await mandant.get(`/api/cases/${kase.id}`)).json.attachments.find((x) => x.no === 1);
    assert.equal(m.kindLabel, 'Bodycam / Video');
    assert.equal(m.obtainedAt, '2026-10-12T22:14:00.000Z');
    for (const k of ['side', 'status', 'source', 'description']) assert.equal(k in m, false, `${k} nicht für Mandanten`);
    assert.equal((await mandant.patch(`/api/cases/${kase.id}/attachments/${m.id}`, { side: 'belastend' })).status, 404);
  });

  it('ändern nur die zuständigen Anwälte; fremde Anhänge und Akten nicht erreichbar', async () => {
    const a = (await owner.get(`/api/cases/${kase.id}`)).json.attachments.find((x) => x.no === 4);
    const r = await other.patch(`/api/cases/${kase.id}/attachments/${a.id}`, { side: 'neutral' });
    assert.ok([403, 404].includes(r.status), `kein Zugriff: ${r.status}`);
    assert.equal((await owner.patch(`/api/cases/${kase.id}/attachments/999999`, { side: 'neutral' })).status, 404);
    assert.equal((await owner.patch(`/api/cases/999999/attachments/${a.id}`, { side: 'neutral' })).status, 404);
  });
});

describe('Beweismittel in der Akte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Beweisliste, beschreiben, „B2“ im Chat öffnet das Beweismittel`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const kase = (await a.post('/api/cases', { title: `Verkehrskontrolle ${name}`, area: 'strafrecht', clientName: 'John Doe' })).json.case;
      await a.upload(`/api/cases/${kase.id}/attachments?caption=Standbild`, PNG, 'image/png');
      await a.upload(`/api/cases/${kase.id}/attachments?caption=Tatort`, PNG, 'image/png');
      assert.equal((await a.post(`/api/cases/${kase.id}/notes`, { body: 'Siehe B2 und B9 zur Lage.' })).status, 201);
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
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((id) => openCase(id), kase.id);
          if (await page.waitForSelector('#secEvidence', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        // Verweis im Chat: B2 existiert → Knopf, B9 nicht → bleibt Text
        await page.waitForSelector('#chatList .ev-ref', { timeout: 8000 });
        assert.deepEqual(await page.$$eval('#chatList .ev-ref', (b) => b.map((x) => x.textContent)), ['B2']);
        // Beweisliste
        await pickTab(page, '[data-action="ev-view"][data-value="liste"]');
        await page.waitForSelector('.ev-table');
        assert.equal(await page.$$eval('.ev-table tbody tr', (r) => r.length), 2);
        await page.click('.ev-table tbody tr:nth-child(2) [data-action="ev-edit"]');
        await page.waitForSelector('form[data-form="ev-save"]');
        await page.fill('#evCaption', 'Tatort von Norden');
        await page.selectOption('#evKind', 'foto');
        await page.fill('#evSource', 'Mandant');
        await page.selectOption('#evSide', 'entlastend');
        await page.selectOption('#evStatus', 'eingereicht');
        await page.fill('#evDesc', 'Zeigt freie Sicht auf die Kreuzung.');
        await page.click('form[data-form="ev-save"] button[type=submit]');
        await page.waitForFunction(() => document.querySelector('.ev-table') && document.querySelector('.ev-table').textContent.includes('Eingereicht'), null, { timeout: 8000 });
        const row = await page.textContent('.ev-table tbody tr:nth-child(2)');
        assert.ok(row.includes('Tatort von Norden') && row.includes('entlastend') && row.includes('Herkunft: Mandant'), row);
        // Klick auf den Verweis im Chat öffnet die Großansicht von B2 mit der Beschreibung
        await page.click('#chatList .ev-ref');
        await page.waitForSelector('.lightbox-img');
        const box = await page.textContent('#modalBody');
        assert.ok(box.includes('Beweismittel B2') && box.includes('Zeigt freie Sicht auf die Kreuzung.') && box.includes('Herkunft: Mandant'), box);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
