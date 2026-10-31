'use strict';
/*
 * Dauermandate: Pauschale mit automatischer Rechnung – API (Rechte, Prüfung, Abrechnung, Nachholen, Pausieren, Beenden)
 * und die Ansicht im Browser am PC und am Handy.
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

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** Datum JJJJ-MM-TT, n Monate vor/nach heute (am 1. des Monats, damit kein Monatsende stört). */
function monthStart(offset) {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1, 12));
  return t.toISOString().slice(0, 10);
}
const label = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

describe('Dauermandate (API)', () => {
  let srv;
  let board;
  let lawyer;
  let mandant;
  before(async () => {
    srv = await startServer();
    board = client(srv.base);
    lawyer = client(srv.base);
    mandant = client(srv.base);
    await board.login(TEAM.admin);
    await lawyer.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  const base = (extra = {}) => ({ title: 'Rechtsbeistand Burgershot', clientName: 'Burgershot GmbH', amount: 12000, intervalMonths: 1, startDate: monthStart(0), typeKey: 'rechnung', ...extra });

  it('anlegen nur durchs Board, Prüfung der Angaben, Kanzlei darf ansehen, Mandanten nicht', async () => {
    assert.equal((await lawyer.post('/api/retainers', base())).status, 403);
    assert.equal((await board.post('/api/retainers', base({ amount: 0 }))).status, 400);
    assert.equal((await board.post('/api/retainers', base({ intervalMonths: 5 }))).status, 201, '5 Monate sind erlaubt (1–12)');
    assert.equal((await board.post('/api/retainers', base({ intervalMonths: 13 }))).status, 400);
    assert.equal((await board.post('/api/retainers', base({ typeKey: 'gibts-nicht' }))).status, 400);
    assert.equal((await board.post('/api/retainers', base({ startDate: '2026-02-30' }))).status, 400);
    assert.equal((await board.post('/api/retainers', base({ endDate: '2020-01-01' }))).status, 400, 'Ende vor Beginn');
    assert.equal((await board.post('/api/retainers', base({ caseId: 999999 }))).status, 404);
    const r = await board.post('/api/retainers', base({ title: 'Wirklich angelegt' }));
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.retainer.status, 'aktiv');
    assert.equal(r.json.retainer.nextDue, monthStart(0));
    assert.ok((await lawyer.get('/api/retainers')).json.retainers.length >= 2);
    await mandant.post('/api/auth/register', { displayName: 'Mia Mandant', email: 'mia.mandant', password: 'Mandanten-Passwort-9' });
    assert.equal((await mandant.get('/api/retainers')).status, 403);
  });

  it('jetzt abrechnen: Rechnung mit Zeitraum, Zahlungsziel der Rechnungsart; nächster Zeitraum rückt vor', async () => {
    await board.post('/api/billing/types', { name: 'Pauschalrechnung', base: 'rechnung', dueDays: 10, advancePct: 0, expenseLabel: '', expenseAmount: 0, note: 'Vielen Dank für die Zusammenarbeit.', active: true });
    const r = (await board.post('/api/retainers', base({ title: 'Pauschale Taxi', clientName: 'Downtown Cab', typeKey: 'pauschalrechnung', amount: 5000 }))).json.retainer;
    const run = await board.post(`/api/retainers/${r.id}/run`, {});
    assert.equal(run.status, 201, run.text);
    const inv = (await board.get(`/api/invoices/${run.json.invoiceId}`)).json.invoice;
    assert.equal(inv.total, 5000);
    assert.equal(inv.clientName, 'Downtown Cab');
    assert.equal(inv.retainerId, r.id);
    assert.equal(inv.typeKey, 'pauschalrechnung');
    assert.match(inv.subject, new RegExp(`Pauschale Taxi – ${label(monthStart(0))}`));
    assert.match(inv.notes, /Vielen Dank/);
    assert.ok(inv.dueDate, 'Zahlungsziel');
    assert.equal(inv.status, 'offen');
    const after = (await board.get(`/api/retainers/${r.id}`)).json;
    assert.equal(after.retainer.runs, 1);
    assert.equal(after.retainer.nextDue, monthStart(1));
    assert.equal(after.invoices.length, 1);
    // der nächste Zeitraum ist noch nicht fällig
    assert.equal((await board.post(`/api/retainers/${r.id}/run`, {})).status, 409);
    assert.equal((await lawyer.post(`/api/retainers/${r.id}/run`, {})).status, 403);
  });

  it('Nachholen: drei fällige Zeiträume werden nacheinander abgerechnet, die Reihenfolge und Bezeichnung stimmen', async () => {
    const r = (await board.post('/api/retainers', base({ title: 'Nachholer', clientName: 'Nachhol AG', startDate: monthStart(-2), amount: 1000 }))).json.retainer;
    assert.equal(r.nextDue, monthStart(-2));
    const sweep = await board.post('/api/retainers/sweep', {});
    assert.equal(sweep.status, 200, sweep.text);
    assert.ok(sweep.json.made >= 3);
    const d = (await board.get(`/api/retainers/${r.id}`)).json;
    assert.equal(d.retainer.runs, 3);
    assert.equal(d.retainer.nextDue, monthStart(1));
    const subjects = d.invoices.map((i) => i.subject).reverse();
    assert.deepEqual(subjects, [-2, -1, 0].map((o) => `Nachholer – ${label(monthStart(o))}`));
    assert.equal((await board.post('/api/retainers/sweep', {})).json.made, 0, 'danach nichts mehr fällig');
    assert.equal((await board.del(`/api/retainers/${r.id}`)).status, 409, 'mit Rechnungen nicht löschbar');
  });

  it('Pausieren hält an, Beenden stoppt für immer, eine Frist beendet von selbst; Beginn nach der ersten Rechnung fix', async () => {
    const p = (await board.post('/api/retainers', base({ title: 'Pausiert', clientName: 'Pause GmbH', startDate: monthStart(-1) }))).json.retainer;
    await board.post(`/api/retainers/${p.id}/status`, { status: 'pausiert' });
    await board.post('/api/retainers/sweep', {});
    assert.equal((await board.get(`/api/retainers/${p.id}`)).json.retainer.runs, 0, 'pausiert: keine Rechnung');
    assert.equal((await board.post(`/api/retainers/${p.id}/run`, {})).status, 409);
    await board.post(`/api/retainers/${p.id}/status`, { status: 'aktiv' });
    await board.post('/api/retainers/sweep', {});
    assert.equal((await board.get(`/api/retainers/${p.id}`)).json.retainer.runs, 2);
    await board.post(`/api/retainers/${p.id}/status`, { status: 'beendet' });
    assert.equal((await board.post('/api/retainers/sweep', {})).json.made, 0);
    assert.equal((await board.post(`/api/retainers/${p.id}/status`, { status: 'quatsch' })).status, 400);

    // Frist: nur noch ein Zeitraum, danach beendet sich das Dauermandat
    const e = (await board.post('/api/retainers', base({ title: 'Befristet', clientName: 'Frist GmbH', startDate: monthStart(-2), endDate: monthStart(-2) }))).json.retainer;
    await board.post('/api/retainers/sweep', {});
    const ed = (await board.get(`/api/retainers/${e.id}`)).json.retainer;
    assert.equal(ed.runs, 1);
    assert.equal(ed.status, 'beendet');
    assert.equal(ed.nextDue, null);

    // Start und Takt sind nach der ersten Rechnung fest, der Betrag nicht
    const a = (await board.post('/api/retainers', base({ title: 'Fest', clientName: 'Fest GmbH', startDate: monthStart(-1) }))).json.retainer;
    await board.post(`/api/retainers/${a.id}/run`, {});
    assert.equal((await board.patch(`/api/retainers/${a.id}`, base({ title: 'Fest', clientName: 'Fest GmbH', startDate: monthStart(-1), intervalMonths: 3 }))).status, 409);
    const ok = await board.patch(`/api/retainers/${a.id}`, base({ title: 'Fest', clientName: 'Fest GmbH', startDate: monthStart(-1), amount: 15000 }));
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.retainer.amount, 15000);
  });

  it('mit Akte: Eintrag im Verlauf und Zuordnung zum Mandantenkonto', async () => {
    const c = (await board.post('/api/cases', { title: 'Dauerberatung Cab', area: 'vertragsrecht', clientEmail: 'mia.mandant' })).json.case;
    const r = (await board.post('/api/retainers', base({ title: 'Beratung Mia', clientName: 'Mia Mandant', caseId: c.id, startDate: monthStart(0) }))).json.retainer;
    assert.equal(r.caseNumber, c.caseNumber);
    const run = await board.post(`/api/retainers/${r.id}/run`, {});
    assert.equal(run.status, 201, run.text);
    const notes = (await board.get(`/api/cases/${c.id}`)).json.notes.map((n) => n.body);
    assert.ok(notes.some((b) => /Dauermandat: Rechnung RE-.* über 12\.000 \$/.test(b)), notes.join(' | '));
    const mine = (await mandant.get('/api/invoices')).json.invoices;
    assert.ok(mine.some((i) => i.retainerId === r.id), 'der Mandant sieht seine Rechnung');
  });
});

describe('Dauermandate im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    for (const n of ['PC', 'Handy']) await a.post('/api/retainers', { title: `Rechtsbeistand Burgershot ${n}`, clientName: 'Burgershot GmbH', amount: 12000, intervalMonths: 1, startDate: monthStart(0), typeKey: 'rechnung' });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Reiter Dauermandate – anlegen, fällig abrechnen, Rechnungen ansehen, ohne Überlappung`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
      await page.evaluate(() => (location.hash = '#invoices'));
      await page.waitForSelector('[data-action="inv-tab"][data-tab="dauer"]');
      await pickTab(page, '[data-action="inv-tab"][data-tab="dauer"]');
      await page.waitForSelector('.ret-card');
      // neu anlegen
      await page.click('[data-action="ret-new"]');
      const title = `Pauschale ${name}`;
      await page.fill('#rtTitle', title);
      await page.fill('#rtClient', 'Test GmbH');
      await page.fill('#rtAmount', '2500');
      await page.selectOption('#rtInterval', '3');
      await page.fill('#rtStart', monthStart(1));
      await page.click('form[data-form="ret-save"] button[type=submit]');
      await page.waitForFunction((t) => [...document.querySelectorAll('.ret-card')].some((c) => c.textContent.includes(t) && c.textContent.includes('vierteljährlich')), title);
      // fällig → abrechnen
      const due = page.locator('.ret-card', { hasText: `Rechtsbeistand Burgershot ${name}` });
      assert.ok((await due.textContent()).includes('Fällig'));
      await due.locator('[data-action="ret-run"]').click();
      await page.waitForFunction((n) => [...document.querySelectorAll('.ret-card')].some((c) => c.textContent.includes(`Rechtsbeistand Burgershot ${n}`) && /1 erstellt/.test(c.textContent)), name);
      await page.locator('.ret-card', { hasText: `Rechtsbeistand Burgershot ${name}` }).locator('[data-action="ret-invoices"]').click();
      await page.waitForSelector('#modalBody .list-row');
      assert.match(await page.textContent('#modalBody'), /Rechtsbeistand Burgershot \w+ – /);
      await page.click('.modal-close');
      const bad = await page.$$eval('.ret-card', (cards) => cards.flatMap((c) => [...c.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => el.className)));
      assert.deepEqual(bad, [], 'nichts ragt über den Rand');
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});
