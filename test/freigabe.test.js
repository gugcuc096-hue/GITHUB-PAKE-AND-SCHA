'use strict';
/*
 * Rabatt-Freigabe: Schwellwert, Anfrage statt Rechnung, Entscheidung des Boards, Verwendung genau einmal – API und
 * Ansicht im Browser (Rechnungsformular, Reiter „Freigaben“) am PC und am Handy. Der Discord-Knopf steht in portal.test.js.
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

const items = [{ description: 'Beratung', quantity: 1, unitPrice: 10000 }];

describe('Rabatt-Freigabe (API)', () => {
  let srv;
  let board;
  let partner;
  let lawyer;
  let mandant;
  before(async () => {
    srv = await startServer();
    board = client(srv.base);
    partner = client(srv.base);
    lawyer = client(srv.base);
    mandant = client(srv.base);
    await board.login(TEAM.admin);
    await partner.login(TEAM.partner);
    await lawyer.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  const invoice = (extra = {}) => ({ clientName: 'Rita Rabatt', items, discountPct: 35, ...extra });

  it('ohne Schwellwert: kein Rabatt braucht eine Freigabe', async () => {
    assert.equal((await lawyer.get('/api/discount-approvals')).json.thresholdPct, 0);
    assert.equal((await lawyer.post('/api/invoices', invoice({ discountPct: 90 }))).status, 201);
  });

  it('Schwellwert: nur mit Recht, 0–100; im Protokoll', async () => {
    assert.equal((await lawyer.post('/api/discount-approvals/settings', { pct: 20 })).status, 403);
    assert.equal((await board.post('/api/discount-approvals/settings', { pct: 150 })).status, 400);
    assert.equal((await board.post('/api/discount-approvals/settings', { pct: -1 })).status, 400);
    const ok = await board.post('/api/discount-approvals/settings', { pct: 20 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.thresholdPct, 20);
    assert.equal((await lawyer.get('/api/discount-approvals')).json.thresholdPct, 20);
    const log = (await board.get('/api/access/log')).json;
    assert.ok(JSON.stringify(log).includes('braucht Freigabe'), 'Änderung steht im Änderungsprotokoll');
    assert.equal((await mandant.get('/api/discount-approvals')).status, 401);
  });

  it('über dem Schwellwert: Anfrage statt Rechnung, gleiche Anfrage wird wiederverwendet; genau der Schwellwert und das Board brauchen keine', async () => {
    const before = (await lawyer.get('/api/invoices')).json.invoices.length;
    const r = await lawyer.post('/api/invoices', invoice({ discountReason: 'Stammkunde' }));
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.needsApproval, true);
    assert.equal(r.json.approval.status, 'offen');
    assert.equal(r.json.approval.discountPct, 35);
    assert.equal(r.json.approval.discountAmount, 3500);
    assert.equal(r.json.approval.reason, 'Stammkunde');
    assert.equal((await lawyer.get('/api/invoices')).json.invoices.length, before, 'es entsteht keine Rechnung');
    const again = await lawyer.post('/api/invoices', invoice());
    assert.equal(again.json.approval.id, r.json.approval.id, 'dieselbe Anfrage');
    assert.equal((await lawyer.post('/api/invoices', invoice({ discountPct: 20 }))).status, 201, 'genau der Schwellwert');
    assert.equal((await board.post('/api/invoices', invoice({ discountPct: 60 }))).status, 201, 'das Board braucht keine Freigabe');
    // falsche oder fremde Freigabe
    assert.equal((await lawyer.post('/api/invoices', invoice({ approvalId: 999999 }))).status, 403);
    assert.equal((await lawyer.post('/api/invoices', invoice({ approvalId: r.json.approval.id }))).status, 409, 'noch offen');
  });

  it('Entscheidung: nur Board, nicht die eigene, einmal; nach Genehmigung geht die Rechnung genau einmal durch (höchstens der genehmigte Rabatt)', async () => {
    const id = (await lawyer.get('/api/discount-approvals')).json.requests[0].id;
    assert.equal((await lawyer.post(`/api/discount-approvals/${id}/decide`, { approve: true })).status, 403, 'Anwalt ist nicht Board');
    const ok = await partner.post(`/api/discount-approvals/${id}/decide`, { approve: true });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.request.status, 'genehmigt');
    assert.equal(ok.json.request.decidedByName.length > 0, true);
    assert.equal((await board.post(`/api/discount-approvals/${id}/decide`, { approve: false })).status, 409, 'schon entschieden');
    assert.equal((await lawyer.post('/api/invoices', invoice({ approvalId: id, discountPct: 50 }))).status, 409, 'mehr als genehmigt');
    const made = await lawyer.post('/api/invoices', invoice({ approvalId: id, discountPct: 30 }));
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.invoice.discountPct, 30);
    assert.equal((await lawyer.post('/api/invoices', invoice({ approvalId: id }))).status, 409, 'verbraucht');
    const mine = (await lawyer.get('/api/discount-approvals')).json.requests.find((r) => r.id === id);
    assert.equal(mine.status, 'verwendet');
    assert.equal(mine.invoiceId, made.json.invoice.id);
  });

  it('Ablehnen mit Hinweis; Board sieht alle, Anwalt nur die eigenen; offene Zahl', async () => {
    const r = (await lawyer.post('/api/invoices', invoice({ clientName: 'Zweite Anfrage', discountPct: 45 }))).json.approval;
    assert.equal((await board.get('/api/discount-approvals')).json.pending, 1);
    const no = await partner.post(`/api/discount-approvals/${r.id}/decide`, { approve: false, note: 'Höchstens 25 %.' });
    assert.equal(no.status, 200, no.text);
    assert.equal(no.json.request.status, 'abgelehnt');
    assert.equal(no.json.pending, 0);
    const chk = await lawyer.post('/api/invoices', invoice({ clientName: 'Zweite Anfrage', discountPct: 45, approvalId: r.id }));
    assert.equal(chk.status, 409);
    assert.match(chk.json.error, /abgelehnt.*Höchstens 25 %/);
    const boardList = (await board.get('/api/discount-approvals')).json.requests;
    const ownList = (await lawyer.get('/api/discount-approvals')).json.requests;
    assert.ok(boardList.length >= ownList.length);
    assert.ok(ownList.every((x) => x.requestedByName === boardList.find((b) => b.id === x.id).requestedByName));
    assert.equal((await partner.get('/api/discount-approvals')).json.requests.length, boardList.length, 'jedes Board-Mitglied sieht alle');
  });
});

describe('Rabatt-Freigabe im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const b = client(srv.base);
    await b.login(TEAM.admin);
    await b.post('/api/discount-approvals/settings', { pct: 20 });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Anwalt fragt hohen Rabatt an (Hinweis, Begründung, Stand) – das Board genehmigt im Reiter „Freigaben“`, async () => {
      const login = async (email) => {
        const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => problems.push(e.message));
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', email);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
        return { ctx, page };
      };
      const problems = [];
      const { ctx, page } = await login(TEAM.anwalt);
      await page.evaluate(() => (location.hash = '#invoice-new'));
      await page.waitForSelector('input[name="discountPct"]');
      await page.fill('input[name="clientName"]', `Rabatt ${name}`);
      await page.click('[data-action="inv-add-item"]');
      await page.fill('[data-item="description"]', 'Beratung');
      await page.fill('[data-item="unitPrice"]', '10000');
      assert.equal(await page.$('input[name="discountReason"]'), null, 'unter dem Schwellwert kein Hinweis');
      await page.fill('input[name="discountPct"]', '40');
      await page.waitForSelector('input[name="discountReason"]');
      assert.match(await page.textContent('.banner.banner-gold'), /Ab 20 % braucht der Rabatt die Freigabe/);
      await page.fill('input[name="discountReason"]', 'Stammkunde');
      await page.click('form[data-form="invoice"] button[type=submit]');
      await page.waitForFunction(() => document.body.textContent.includes('Wartet auf Freigabe'), null, { timeout: 8000 });
      assert.ok(await page.$('input[name="discountReason"]'), 'Formular bleibt mit dem Stand stehen');
      await ctx.close();

      const b = await login(TEAM.admin);
      await b.page.evaluate(() => (location.hash = '#invoices'));
      await b.page.waitForSelector('[data-action="inv-tab"][data-tab="freigaben"]', { state: 'attached' });
      await pickTab(b.page, '[data-action="inv-tab"][data-tab="freigaben"]');
      const card = b.page.locator('.appr-card', { hasText: `Rabatt ${name}` }).or(b.page.locator('.appr-card', { hasText: 'Stammkunde' })).first();
      await card.waitFor();
      assert.ok((await card.textContent()).includes('40 %'));
      await card.locator('[data-action="disc-decide"][data-approve="1"]').click();
      await b.page.waitForFunction(() => document.querySelector('.appr-card')?.textContent.includes('Genehmigt'));
      assert.deepEqual(problems, []);
      await b.ctx.close();
    });
  }
});
