'use strict';
/*
 * Gemeinsames Arbeiten: Konflikte beim gleichzeitigen Bearbeiten (409 statt stilles Überschreiben), Name der ändernden Person
 * im Live-Ereignis (nur für die Kanzlei) und das kurze Aufleuchten von Änderungen eines Kollegen im Dashboard.
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

/** Live-Verbindung (/api/events) öffnen und die Ereignisse sammeln. */
async function listen(base, cookie) {
  const ctl = new AbortController();
  const events = [];
  const res = await fetch(`${base}/api/events?tab=test-${Math.random()}`, { headers: { Cookie: cookie, Accept: 'text/event-stream' }, signal: ctl.signal });
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk);
        for (;;) {
          const i = buf.indexOf('\n\n');
          if (i < 0) break;
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = /^data: (.*)$/m.exec(block);
          if (m) events.push(JSON.parse(m[1]));
        }
      }
    } catch {
      /* geschlossen */
    }
  })();
  return { events, close: () => ctl.abort() };
}
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
};

describe('Gleichzeitiges Bearbeiten (API)', () => {
  let srv;
  let admin;
  let partner;
  let kase;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    partner = client(srv.base);
    await admin.login(TEAM.admin);
    await partner.login(TEAM.partner);
    kase = (await admin.post('/api/cases', { title: 'Mietstreit Davis', area: 'zivilrecht', clientName: 'Paul Davis', publicNote: 'Alter Hinweis' })).json.case;
    await admin.patch(`/api/cases/${kase.id}`, { publicNote: 'Alter Hinweis', lawyerId: null }); // Ausgangslage
  });
  after(() => srv.stop());

  it('Akte: Änderung an einem Feld, das ein Kollege inzwischen geändert hat, wird mit 409 abgewiesen – nichts wird überschrieben', async () => {
    assert.equal((await partner.patch(`/api/cases/${kase.id}`, { publicNote: 'Neuer Hinweis von Michael' })).status, 200);
    const r = await admin.patch(`/api/cases/${kase.id}`, { publicNote: 'Mein Hinweis', expect: { publicNote: 'Alter Hinweis' } });
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.json.conflict, [{ field: 'publicNote', current: 'Neuer Hinweis von Michael' }]);
    assert.equal((await admin.get(`/api/cases/${kase.id}`)).json.case.publicNote, 'Neuer Hinweis von Michael', 'unverändert');
  });

  it('kein Konflikt: ohne „expect“, bei unverändertem Feld, bei gleichem neuen Wert und bei anderen Feldern', async () => {
    const note = (await admin.get(`/api/cases/${kase.id}`)).json.case.publicNote;
    // anderes Feld geändert als das erwartete → kein Konflikt
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { opponent: 'Gegner A', expect: { opponent: '' } })).status, 200);
    // unverändertes Feld
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { opponent: 'Gegner B', expect: { opponent: 'Gegner A' } })).status, 200);
    // Kollege hat bereits denselben neuen Wert gesetzt
    await partner.patch(`/api/cases/${kase.id}`, { courtRef: 'AZ-1' });
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { courtRef: 'AZ-1', expect: { courtRef: '' } })).status, 200);
    // bewusst überschreiben: ohne „expect“
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { publicNote: 'Überschrieben' })).status, 200);
    assert.equal((await admin.get(`/api/cases/${kase.id}`)).json.case.publicNote, 'Überschrieben');
    assert.notEqual(note, 'Überschrieben');
    // Felder, die nicht Teil der Änderung sind, zählen nicht
    await partner.patch(`/api/cases/${kase.id}`, { title: 'Titel von Michael' });
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { opponent: 'Gegner C', expect: { title: 'Mietstreit Davis' } })).status, 200);
  });

  it('Aufgabe: gleiche Regel – Titel und „erledigt“', async () => {
    const t = (await admin.post('/api/tasks', { title: 'Akte prüfen', caseId: kase.id })).json.task;
    assert.ok(t, 'Aufgabe angelegt');
    await partner.patch(`/api/tasks/${t.id}`, { title: 'Akte genau prüfen' });
    const r = await admin.patch(`/api/tasks/${t.id}`, { title: 'Mein Titel', expect: { title: 'Akte prüfen' } });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.conflict[0].current, 'Akte genau prüfen');
    // Kollege hat sie schon erledigt: wer „erledigt“ setzt, bekommt keinen Konflikt
    await partner.patch(`/api/tasks/${t.id}`, { done: true });
    assert.equal((await admin.patch(`/api/tasks/${t.id}`, { done: true, expect: { done: false } })).status, 200);
  });
});

describe('Live-Ereignis: wer hat geändert', () => {
  let srv;
  let admin;
  let partner;
  let mandant;
  let kase;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    partner = client(srv.base);
    mandant = client(srv.base);
    await admin.login(TEAM.admin);
    await partner.login(TEAM.partner);
    await mandant.post('/api/auth/register', { displayName: 'Lena Live', email: 'lena.live', password: 'Mandanten-Passwort-5' });
    await mandant.login('lena.live', 'Mandanten-Passwort-5');
    kase = (await admin.post('/api/cases', { title: 'Live-Akte', area: 'zivilrecht', clientEmail: 'lena.live' })).json.case;
  });
  after(() => srv.stop());

  it('die Kanzlei sieht den Namen der ändernden Person, der Mandant nie', async () => {
    const staff = await listen(srv.base, admin.cookie());
    const client_ = await listen(srv.base, mandant.cookie());
    await until(() => staff.events.length && client_.events.length); // „hello“
    await partner.patch(`/api/cases/${kase.id}`, { description: 'Neuer Sachverhalt' });
    const s = await until(() => staff.events.find((e) => e.k === 'case' && e.id === kase.id));
    const m = await until(() => client_.events.find((e) => e.k === 'case' && e.id === kase.id));
    staff.close();
    client_.close();
    assert.equal(s.by, 'Michael Scha', JSON.stringify(s));
    assert.ok(m && !('by' in m), `Mandant: ${JSON.stringify(m)}`);
  });
});

describe('Gemeinsames Arbeiten im Dashboard (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Änderung eines Kollegen leuchtet auf („… hat die Akte aktualisiert“); „Jemand war schneller“ beim gleichzeitigen Bearbeiten`, async () => {
      const admin = client(srv.base);
      const partner = client(srv.base);
      await admin.login(TEAM.admin);
      await partner.login(TEAM.partner);
      const kase = (await admin.post('/api/cases', { title: `Verkehrskontrolle ${name}`, area: 'strafrecht', clientName: 'John Doe' })).json.case;
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
          if (await page.waitForSelector('#secChat', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        await page.waitForFunction(() => st.here !== undefined && document.querySelector('#secChat'), null, { timeout: 8000 });
        await page.waitForTimeout(800); // Live-Verbindung steht
        // 1) Kollege legt einen Zeugen an → Abschnitt Zeugen leuchtet auf, Hinweis nennt den Namen
        assert.equal((await partner.post(`/api/cases/${kase.id}/parties`, { role: 'zeuge', name: 'Fritz Falkenhagen' })).status, 201);
        await page.waitForFunction(() => document.querySelector('.live-flash, .live-flash-static'), null, { timeout: 8000 });
        await page.waitForFunction(() => document.querySelector('#liveBy')?.textContent.includes('Michael Scha'), null, { timeout: 4000 });
        assert.ok((await page.textContent('#secWitnesses')).includes('Fritz Falkenhagen'));

        // 2) Ich bearbeite den Statushinweis (Feld bleibt offen) – der Kollege ändert ihn inzwischen
        await page.click('[data-ie="publicNote"]');
        await page.waitForSelector('textarea.ie-input, .ie-input');
        await page.fill('.ie-input', 'Mein Hinweis');
        await partner.patch(`/api/cases/${kase.id}`, { publicNote: 'Hinweis von Michael' });
        await page.waitForTimeout(700);
        await page.keyboard.press('Control+Enter');
        await page.waitForSelector('text=Jemand war schneller', { timeout: 8000 });
        const dialog = await page.textContent('body');
        assert.ok(dialog.includes('Jemand war schneller') && dialog.includes('Hinweis von Michael'), `Dialog nennt den neuen Stand: ${dialog.slice(Math.max(0, dialog.indexOf('Jemand war schneller') - 50), dialog.indexOf('Jemand war schneller') + 400)}`);
        // Neuen Stand behalten → nichts wird überschrieben
        await page.click('text=Neuen Stand behalten');
        await page.waitForFunction(() => !document.body.textContent.includes('Jemand war schneller'));
        assert.equal((await admin.get(`/api/cases/${kase.id}`)).json.case.publicNote, 'Hinweis von Michael');
        // noch einmal, diesmal meine Änderung durchsetzen
        await page.waitForFunction(() => document.querySelector('[data-ie="publicNote"]')?.textContent.includes('Hinweis von Michael'), null, { timeout: 8000 });
        await page.click('[data-ie="publicNote"]');
        await page.fill('.ie-input', 'Mein Hinweis');
        await partner.patch(`/api/cases/${kase.id}`, { publicNote: 'Schon wieder Michael' });
        await page.waitForTimeout(700);
        await page.keyboard.press('Control+Enter');
        await page.waitForSelector('text=Jemand war schneller');
        await page.click('text=Meine Änderung speichern');
        await page.waitForFunction(() => !document.body.textContent.includes('Jemand war schneller'));
        await until(() => true);
        const final = (await admin.get(`/api/cases/${kase.id}`)).json.case.publicNote;
        assert.equal(final, 'Mein Hinweis');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
