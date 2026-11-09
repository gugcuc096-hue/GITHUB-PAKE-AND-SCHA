'use strict';
/*
 * Tathergang in der Akte (Reiter „Fall“, nur Kanzlei): Text mit Absätzen, Zeilen mit Uhrzeit werden zur Zeitleiste.
 * Mandanten sehen ihn nicht und können ihn nicht ändern; leere Abschnitte im Reiter „Fall“ stehen einheitlich in einer Zeile.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD, caseShow } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Tathergang', () => {
  let srv;
  let a;
  let kase;
  before(async () => {
    srv = await startServer();
    a = client(srv.base);
    const me = await a.login(TEAM.admin);
    kase = (await a.post('/api/cases', { title: 'Raub am Juwelier', area: 'strafrecht', clientName: 'Vito Russo', lawyerId: me.id })).json.case;
  });
  after(async () => {
    if (srv) await srv.stop();
  });

  it('API: Kanzlei schreibt, Mandant sieht und ändert nichts', async () => {
    const r = await a.patch(`/api/cases/${kase.id}`, { incident: '14:05 – Waffe gezogen\n14:31 – Festnahme' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await a.get(`/api/cases/${kase.id}`)).json.case.incident, '14:05 – Waffe gezogen\n14:31 – Festnahme');
    const m = client(srv.base);
    assert.equal((await m.post('/api/auth/register', { displayName: 'Mia Mandant', email: 'mia.tat', password: PASSWORD })).status, 201);
    const own = (await m.post('/api/cases', { title: 'Eigene Anfrage', area: 'zivilrecht', description: 'Bitte um Hilfe bei einem Vertrag.' })).json.case;
    assert.equal((await m.get(`/api/cases/${own.id}`)).json.case.incident, undefined, 'Mandant sieht den Tathergang nicht');
    assert.equal((await m.patch(`/api/cases/${own.id}`, { incident: 'x' })).status, 403);
  });

  it('Browser: im Reiter „Fall“ zuerst, Zeitleiste aus Uhrzeiten, leere Abschnitte einheitlich', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const k2 = (await a.post('/api/cases', { title: 'Leere Akte', area: 'strafrecht', clientName: 'Paul Weber', lawyerId: (await a.get('/api/auth/session')).json.user.id })).json.case;
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' })).newPage();
    try {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#nav a.nav-item');
      await page.waitForSelector('#content .page-title');
      await page.evaluate((id) => openCase(id), k2.id);
      await page.waitForSelector('#modalBody .case-root');
      await page.click('#modalBody [data-action="case-tab"][data-tab="fall"]');
      await page.waitForFunction(() => document.querySelector('#modalBody .case-root').dataset.caseTab === 'fall');
      // Reihenfolge im Reiter „Fall“ – leere Abschnitte zählen mit (im Design „Ruhig“ verborgen, über „+ Hinzufügen“ erreichbar)
      const order = await page.$$eval('#modalBody .section[id]', (l) => l.filter((x) => x.closest('[data-pane]')?.dataset.pane === 'fall').map((x) => x.id));
      assert.equal(order[0], 'secTathergang', `Tathergang zuerst: ${order}`);
      assert.ok(order.indexOf('secCharges') > 0 && order.indexOf('secWitnesses') > order.indexOf('secCharges'), `${order}`);
      // leer: eine Zeile wie die übrigen (auch Zeugen ohne Erklärtext)
      assert.ok(await page.$('#secTathergang.sec-empty [data-action="story-edit"]'));
      assert.ok(await page.$('#secWitnesses.sec-empty [data-action="wit-add"]'), 'Zeugen ohne Einträge als kurze Zeile');
      await caseShow(page, '#secTathergang [data-action="story-edit"]');
      await page.click('#secTathergang [data-action="story-edit"]');
      await page.fill('#secTathergang textarea', 'Russo betritt den Juwelier.\n\n14:05 – Waffe gezogen\n14.12 Uhr Flucht Richtung Hafen\n- Festnahme an der Tankstelle');
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('#secTathergang .story-steps li');
      const steps = await page.$$eval('#secTathergang .story-steps li', (l) => l.map((x) => [x.querySelector('time')?.textContent || '', x.querySelector('span').textContent]));
      assert.deepEqual(steps, [['14:05', 'Waffe gezogen'], ['14:12', 'Flucht Richtung Hafen'], ['', 'Festnahme an der Tankstelle']]);
      assert.match(await page.textContent('#secTathergang .story p'), /Russo betritt den Juwelier/);
      assert.equal((await a.get(`/api/cases/${k2.id}`)).json.case.incident.split('\n').length, 5);
    } finally {
      await browser.close();
    }
  });
});
