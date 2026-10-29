'use strict';
/*
 * Anwälte zu Gesprächen einladen: Einladung am Termin (Kalender) und am Bewerbungsgespräch, Zusage/Absage, neue Zeit,
 * Nachricht in der Kanzlei-Post – API und Browser (PC und Handy). Discord: eigener Ereignistyp für einen eigenen Kanal.
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

const inHours = (h) => new Date(Date.now() + h * 36e5).toISOString();

describe('Einladungen zu Terminen und Gesprächen (API)', () => {
  let srv;
  let admin;
  let lex;
  let partner;
  let lexId;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    lex = client(srv.base);
    partner = client(srv.base);
    await admin.login(TEAM.admin);
    await lex.login(TEAM.anwalt);
    await partner.login(TEAM.partner);
    lexId = (await lex.get('/api/auth/me')).json.user.id;
  });
  after(() => srv.stop());

  it('Discord kennt den Ereignistyp für Einladungen (eigener Kanal einstellbar)', async () => {
    const r = await admin.get('/api/admin/settings');
    assert.equal(r.status, 200, r.text);
    const events = JSON.stringify(r.json);
    assert.match(events, /appointment\.invite/);
  });

  it('beim Anlegen einladen: Eingeladene sehen die Einladung, bekommen eine Nachricht; Zusage und Absage', async () => {
    const mk = await admin.post('/api/calendar', { type: 'intern', title: 'Strategiegespräch', startsAt: inHours(48), inviteIds: [lexId] });
    assert.equal(mk.status, 201, mk.text);
    const ev = mk.json.event;
    assert.deepEqual(ev.invites.map((i) => [i.userId, i.status]), [[lexId, 'offen']]);
    const mine = (await lex.get('/api/calendar')).json.events.find((e) => e.id === ev.id);
    assert.equal(mine.myInvite, 'offen');
    // Kanzlei-Post
    const mail = (await lex.get('/api/messages')).json.messages.find((m) => /Einladung: Strategiegespräch/.test(m.subject));
    assert.ok(mail, 'Nachricht in der Kanzlei-Post');
    // nur die eingeladene Person antwortet
    assert.equal((await partner.patch(`/api/calendar/${ev.id}/invite`, { status: 'zugesagt' })).status, 404);
    const ja = await lex.patch(`/api/calendar/${ev.id}/invite`, { status: 'zugesagt' });
    assert.equal(ja.status, 200, ja.text);
    assert.equal(ja.json.event.myInvite, 'zugesagt');
    const seen = (await admin.get('/api/calendar')).json.events.find((e) => e.id === ev.id);
    assert.equal(seen.invites[0].status, 'zugesagt');
    assert.equal((await lex.patch(`/api/calendar/${ev.id}/invite`, { status: 'vielleicht' })).status, 400);
  });

  it('nachträglich einladen und wieder austragen; neue Zeit setzt die Antworten zurück; keine Selbsteinladung', async () => {
    const ev = (await admin.post('/api/calendar', { type: 'intern', title: 'Besprechung', startsAt: inHours(30) })).json.event;
    assert.deepEqual(ev.invites, []);
    const me = (await admin.get('/api/auth/me')).json.user.id;
    const partnerId = (await partner.get('/api/auth/me')).json.user.id;
    const r1 = await admin.patch(`/api/calendar/${ev.id}`, { inviteIds: [lexId, partnerId, me] });
    assert.equal(r1.status, 200, r1.text);
    assert.deepEqual(r1.json.event.invites.map((i) => i.userId).sort(), [lexId, partnerId].sort(), 'sich selbst lädt man nicht ein');
    await lex.patch(`/api/calendar/${ev.id}/invite`, { status: 'abgesagt' });
    const moved = await admin.patch(`/api/calendar/${ev.id}`, { startsAt: inHours(52) });
    assert.equal(moved.json.event.invites.find((i) => i.userId === lexId).status, 'offen', 'neue Zeit: bitte neu antworten');
    const r2 = await admin.patch(`/api/calendar/${ev.id}`, { inviteIds: [partnerId] });
    assert.deepEqual(r2.json.event.invites.map((i) => i.userId), [partnerId], 'Lex ausgetragen');
    assert.equal((await lex.get('/api/calendar')).json.events.find((e) => e.id === ev.id).myInvite, null);
  });

  it('Mandanten sehen keine Einladungen', async () => {
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Mia Mandant', email: 'mia.einladung', password: 'Mandanten-Passwort-5' });
    await m.login('mia.einladung', 'Mandanten-Passwort-5');
    const ev = (await admin.post('/api/calendar', { type: 'intern', title: 'Intern', startsAt: inHours(20), inviteIds: [lexId] })).json.event;
    const list = (await m.get('/api/calendar')).json.events;
    assert.equal(list.find((e) => e.id === ev.id), undefined);
    assert.equal((await m.patch(`/api/calendar/${ev.id}/invite`, { status: 'zugesagt' })).status, 404);
  });

  it('Bewerbungsgespräch: Kollegen werden mit dem Termin eingeladen', async () => {
    const sent = await client(srv.base).post('/api/public/applications', { positionId: null, name: 'Gina Gespräch', discord: 'gina.dc', motivation: 'Ich möchte bei Pake & Scha als Associate einsteigen und meine Erfahrung im Strafrecht einbringen – gern im Eilnotdienst.', accept: true });
    assert.equal(sent.status, 201, sent.text);
    const id = (await admin.get('/api/admin/applications')).json.applications.find((a) => a.name === 'Gina Gespräch').id;
    const r = await admin.post(`/api/admin/applications/${id}/interview`, { startsAt: inHours(72), location: 'Kanzlei Würfelpark', inviteIds: [lexId] });
    assert.equal(r.status, 200, r.text);
    const ev = (await lex.get('/api/calendar')).json.events.find((e) => /Bewerbungsgespräch: Gina Gespräch/.test(e.title));
    assert.equal(ev.myInvite, 'offen');
  });
});

describe('Einladungen im Dashboard (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    it(`${name}: Kollegen im Termin einladen; der Eingeladene sieht „Einladungen an dich“ und sagt zu`, async () => {
      const admin = client(srv.base);
      await admin.login(TEAM.admin);
      const lexApi = client(srv.base);
      await lexApi.login(TEAM.anwalt);
      const lexId = (await lexApi.get('/api/auth/me')).json.user.id;
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        // 1) Admin lädt Lex im Termin-Formular ein
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => typeof newEventModal === 'function' || typeof eventForm === 'function');
        await page.goto(`${srv.base}/dashboard#calendar`);
        await page.waitForSelector('[data-action="new-event"]');
        await page.click('[data-action="new-event"]');
        await page.waitForSelector('form[data-form="event"] .invite-chips');
        await page.fill('#evTitle', `Gespräch ${name}`);
        await page.fill('#evStart', new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16));
        await page.locator(`.invite-chip:has-text("${(await lexApi.get('/api/auth/me')).json.user.displayName}")`).click();
        await page.click('form[data-form="event"] button[type=submit]');
        await page.waitForFunction(async () => (await api.get('/api/calendar')).events.some((e) => e.invites && e.invites.length === 1));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        await ctx.close();
        // 2) Lex sieht die Einladung im Kalender und sagt zu
        const ctx2 = await browser.newContext({ ...device, locale: 'de-DE' });
        const p2 = await ctx2.newPage();
        p2.on('pageerror', (e) => problems.push(e.message));
        await p2.goto(`${srv.base}/login`);
        await p2.fill('#email', TEAM.anwalt);
        await p2.fill('#password', PASSWORD);
        await p2.click('button[type=submit]');
        await p2.waitForURL(/dashboard/);
        await p2.goto(`${srv.base}/dashboard#calendar`);
        await p2.waitForSelector('.invite-panel .invite-row');
        assert.match(await p2.textContent('.invite-panel'), new RegExp(`Gespräch ${name}`));
        await p2.click('.invite-panel [data-action="invite-respond"][data-status="zugesagt"]');
        await p2.waitForFunction(() => !document.querySelector('.invite-panel'));
        const ev = (await lexApi.get('/api/calendar')).json.events.find((e) => e.title === `Gespräch ${name}`);
        assert.equal(ev.myInvite, 'zugesagt');
        assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        assert.deepEqual(problems, []);
        await ctx2.close();
      } finally {
        await ctx.close().catch(() => {});
      }
    });
  }
});
