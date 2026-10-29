'use strict';
/*
 * 360°-Feedback: Runde starten, anonym Rückmeldung geben, schließen, freigeben – API (Rechte, Prüfung, Anonymität ab drei
 * Rückmeldungen, nur eigene Ergebnisse) und Ansicht im Browser am PC und am Handy.
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

describe('360°-Feedback (API)', () => {
  let srv;
  let board;
  let partner;
  let lawyer;
  let mandant;
  let rid;
  let target; // eine Person, die selbst nicht mitschreibt – wird von den drei Konten bewertet
  before(async () => {
    srv = await startServer();
    board = client(srv.base);
    partner = client(srv.base);
    lawyer = client(srv.base);
    mandant = client(srv.base);
    await board.login(TEAM.admin);
    await partner.login(TEAM.partner);
    await lawyer.login(TEAM.anwalt);
    // Das Test-Team hat drei Konten – für anonyme Rückmeldungen braucht es eine vierte Person
    const nina = await board.post('/api/admin/users', { displayName: 'Nina Neu', email: 'nina.neu', role: 'anwalt', rank: 'Junior Associate' });
    assert.equal(nina.status, 201, nina.text);
  });
  after(() => srv.stop());

  it('Runde starten: nur Board, Name nötig, nur eine laufende Runde', async () => {
    assert.equal((await lawyer.post('/api/feedback/rounds', { title: 'Q4 2026' })).status, 403);
    assert.equal((await board.post('/api/feedback/rounds', { title: 'x' })).status, 400);
    assert.equal((await board.post('/api/feedback/rounds', { title: 'Q4 2026', dueDate: 'bald' })).status, 400);
    const r = await board.post('/api/feedback/rounds', { title: 'Q4 2026', dueDate: '2026-12-15' });
    assert.equal(r.status, 201, r.text);
    rid = r.json.id;
    assert.equal((await board.post('/api/feedback/rounds', { title: 'Noch eine' })).status, 409);
    const mine = (await lawyer.get('/api/feedback')).json.rounds[0];
    assert.equal(mine.status, 'offen');
    assert.equal(mine.mine, true);
    assert.equal(mine.given, 0);
    assert.equal(mine.expected, mine.participants - 1);
    assert.equal((await mandant.get('/api/feedback')).status, 401);
  });

  it('Rückmeldung: Kolleginnen und Kollegen ohne mich, Prüfung der Werte, ändern statt doppelt', async () => {
    const sheet = (await lawyer.get(`/api/feedback/rounds/${rid}/sheet`)).json;
    const meId = (await lawyer.get('/api/auth/me')).json.user.id;
    assert.ok(sheet.colleagues.length >= 3);
    assert.ok(!sheet.colleagues.some((c) => c.id === meId), 'nicht über sich selbst');
    const ids = new Set(sheet.colleagues.map((c) => c.id));
    const adminId = (await board.get('/api/auth/me')).json.user.id;
    const partnerId = (await partner.get('/api/auth/me')).json.user.id;
    target = sheet.colleagues.find((c) => c.id !== adminId && c.id !== partnerId);
    assert.ok(target, 'eine vierte Person im Team');
    const url = (about) => `/api/feedback/rounds/${rid}/entries/${about}`;
    assert.equal((await lawyer.put(url(meId), { r_team: 4 })).status, 400, 'über sich selbst');
    assert.equal((await lawyer.put(url(target.id), { r_team: 6 })).status, 400);
    assert.equal((await lawyer.put(url(target.id), { r_team: 0 })).status, 400);
    assert.equal((await lawyer.put(url(target.id), {})).status, 400, 'etwas muss drinstehen');
    assert.equal((await lawyer.put(url(999999), { r_team: 3 })).status, 404);
    const ok = await lawyer.put(url(target.id), { r_team: 4, r_reliable: 5, strengths: 'Immer erreichbar.' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.colleagues.find((c) => c.id === target.id).given, true);
    const again = await lawyer.put(url(target.id), { r_team: 5, r_reliable: 5, strengths: 'Immer erreichbar.', improve: 'Etwas mehr Doku.' });
    assert.equal(again.json.colleagues.find((c) => c.id === target.id).ratings.r_team, 5, 'geändert');
    assert.equal((await lawyer.get('/api/feedback')).json.rounds[0].given, 1, 'nicht doppelt gezählt');
    assert.equal((await mandant.put(url(target.id), { r_team: 3 })).status, 401);
  });

  it('Ergebnisse: erst nach dem Schließen (Board) bzw. der Freigabe; unter drei Rückmeldungen verborgen; Kommentare ohne Absender', async () => {
    const url = (about) => `/api/feedback/rounds/${rid}/entries/${about}`;
    await board.put(url(target.id), { r_team: 3, r_reliable: 4, r_know: 4, r_comm: 5, strengths: 'Hilft bei Akten.', improve: 'Fristen früher melden.' });
    assert.equal((await board.get(`/api/feedback/rounds/${rid}/results`)).status, 409, 'Runde läuft noch');
    // nur zwei Rückmeldungen → verborgen
    await board.post(`/api/feedback/rounds/${rid}/close`, {});
    let res = (await board.get(`/api/feedback/rounds/${rid}/results`)).json;
    let t = res.people.find((p) => p.id === target.id);
    assert.equal(t.n, 2);
    assert.equal(t.hidden, true);
    assert.equal(t.averages, undefined);
    assert.equal(t.strengths, undefined);
    // Runde geschlossen: nichts mehr abgeben
    assert.equal((await partner.put(url(target.id), { r_team: 5 })).status, 409);
    assert.equal((await lawyer.get(`/api/feedback/rounds/${rid}/results`)).status, 409, 'noch nicht freigegeben');
  });

  it('mit drei Rückmeldungen erscheinen Durchschnitt und gemischte Kommentare; nach der Freigabe sieht jede Person nur die eigenen', async () => {
    // neue Runde, damit alle drei antworten können
    const r2 = (await board.post('/api/feedback/rounds', { title: 'Q1 2027' })).json.id;
    const url = (about) => `/api/feedback/rounds/${r2}/entries/${about}`;
    await board.put(url(target.id), { r_team: 5, r_reliable: 4, r_know: 4, r_comm: 3, strengths: 'Ruhig unter Druck.', improve: 'Mehr delegieren.' });
    await partner.put(url(target.id), { r_team: 4, r_reliable: 4, r_know: 5, r_comm: 3, strengths: 'Klare Schriftsätze.', improve: '' });
    await lawyer.put(url(target.id), { r_team: 3, r_reliable: 5, r_know: 5, r_comm: null, strengths: 'Immer erreichbar.', improve: 'Pausen einhalten.' });
    await board.post(`/api/feedback/rounds/${r2}/close`, {});
    const res = (await board.get(`/api/feedback/rounds/${r2}/results`)).json;
    const t = res.people.find((p) => p.id === target.id);
    assert.equal(t.n, 3);
    assert.equal(t.hidden, false);
    assert.deepEqual(t.averages, { r_team: 4, r_reliable: 4.3, r_know: 4.7, r_comm: null }, 'je Dimension erst ab drei Bewertungen');
    assert.deepEqual([...t.strengths].sort(), ['Immer erreichbar.', 'Klare Schriftsätze.', 'Ruhig unter Druck.']);
    assert.deepEqual([...t.improve].sort(), ['Mehr delegieren.', 'Pausen einhalten.']);
    // keine Absender in der Antwort
    const raw = JSON.stringify(res);
    for (const key of ['from_user_id', 'fromUserId', 'author', 'givenBy']) assert.ok(!raw.includes(key), `kein ${key}`);
    // Beteiligung (Board): Zahlen, kein Inhalt
    const prog = (await board.get(`/api/feedback/rounds/${r2}/progress`)).json.progress;
    assert.ok(prog.every((p) => typeof p.given === 'number' && !('strengths' in p)));
    assert.equal((await lawyer.get(`/api/feedback/rounds/${r2}/progress`)).status, 403);
    // Freigabe: erst nach dem Schließen, nur Board, einmal
    assert.equal((await lawyer.post(`/api/feedback/rounds/${r2}/publish`, {})).status, 403);
    assert.equal((await board.post(`/api/feedback/rounds/${r2}/publish`, {})).status, 200);
    assert.equal((await board.post(`/api/feedback/rounds/${r2}/publish`, {})).status, 409);
    const own = (await lawyer.get(`/api/feedback/rounds/${r2}/results`)).json;
    assert.equal(own.people.length, 1, 'nur die eigenen Ergebnisse');
    assert.equal(own.people[0].id, (await lawyer.get('/api/auth/me')).json.user.id);
    assert.equal((await lawyer.get('/api/feedback')).json.rounds[0].statusLabel, 'Ergebnisse freigegeben');
  });
});

describe('360°-Feedback im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.post('/api/admin/users', { displayName: 'Nina Neu', email: 'nina.neu', role: 'anwalt', rank: 'Junior Associate' });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Board startet die Runde, ein Anwalt gibt Rückmeldung (Bewertung, Text), Board sieht die Beteiligung`, async () => {
      const problems = [];
      const open = async (email) => {
        const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => problems.push(e.message));
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', email);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
        await page.evaluate(() => (location.hash = '#feedback'));
        await page.waitForSelector('.page-title');
        return { ctx, page };
      };
      const b = await open(TEAM.admin);
      if (name === 'PC') {
        await b.page.click('[data-action="fb-new"]');
        await b.page.fill('#fbTitle', 'Q4 2026');
        await b.page.click('form[data-form="fb-start"] button[type=submit]');
      }
      await b.page.waitForSelector('.fb-card');
      assert.ok((await b.page.textContent('.fb-card')).includes('Läuft'));
      await b.ctx.close();

      const l = await open(TEAM.anwalt);
      await l.page.waitForSelector('[data-action="fb-give"]');
      await l.page.click('[data-action="fb-give"]');
      await l.page.waitForSelector('.fb-person');
      const first = l.page.locator('.fb-person').first();
      await first.locator('summary').click();
      await first.locator('input[name="r_team"][value="4"]').check({ force: true });
      await first.locator('input[name="r_know"][value="5"]').check({ force: true });
      await first.locator('textarea[name="strengths"]').fill('Sehr zuverlässig.');
      await first.locator('button[type=submit]').click();
      await l.page.waitForFunction(() => document.querySelector('.fb-person[open] .badge, .fb-person .badge')?.textContent.includes('abgegeben'));
      const bad = await l.page.$$eval('.fb-person', (els) => els.flatMap((e) => [...e.querySelectorAll('*')].filter((x) => x.children.length === 0 && x.clientWidth > 0 && x.scrollWidth > x.clientWidth + 1).map((x) => x.className)));
      assert.deepEqual(bad, [], 'nichts ragt über den Rand');
      await l.ctx.close();

      const b2 = await open(TEAM.admin);
      await b2.page.waitForSelector('[data-action="fb-progress"]');
      await b2.page.click('[data-action="fb-progress"]');
      await b2.page.waitForSelector('#modalBody .list-row');
      assert.match(await b2.page.textContent('#modalBody'), /\d+ \/ \d+/);
      assert.ok(!(await b2.page.textContent('#modalBody')).includes('Sehr zuverlässig'), 'Beteiligung zeigt keine Inhalte');
      await b2.ctx.close();
      assert.deepEqual(problems, []);
    });
  }
});
