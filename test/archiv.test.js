'use strict';
/*
 * Aktenliste lädt nicht mehr alles: GET /api/cases liefert die Arbeitsliste (laufend + kürzlich abgeschlossen) und nur
 * die Anzahl im Archiv. Das Archiv (seit über 30 Tagen abgeschlossen) kommt seitenweise, die Suche darin läuft auf dem
 * Server. Im Browser: Reiter „Archiv“ lädt nach, die Suche findet archivierte Akten von jedem Reiter aus.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Aktenliste: Archiv seitenweise', () => {
  let srv;
  let owner;
  const ids = {};
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    await owner.login(TEAM.admin);
    const make = async (title, clientName) => (await owner.post('/api/cases', { title, area: 'strafrecht', clientName, description: 'Test' })).json.case.id;
    ids.live = await make('Laufendes Verfahren Vinewood', 'Lara Laufend');
    ids.fresh = await make('Frisch abgeschlossen Paleto', 'Fritz Frisch');
    ids.old = [];
    for (let i = 1; i <= 5; i++) ids.old.push(await make(`Altfall Sandy Shores ${i}`, i === 3 ? 'Zacharias Zeltner' : `Alt Mandant ${i}`));
    const sql = new DatabaseSync(path.join(srv.dir, 'test.db'));
    sql.prepare("UPDATE cases SET status = 'geschlossen', closed_at = ?, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), ids.fresh);
    ids.old.forEach((id, i) => sql.prepare("UPDATE cases SET status = 'geschlossen', closed_at = ?, updated_at = ? WHERE id = ?").run(`2020-0${i + 1}-10T10:00:00.000Z`, `2020-0${i + 1}-10T10:00:00.000Z`, id));
    sql.close();
  });
  after(async () => srv && srv.stop());

  it('Arbeitsliste ohne Archiv, dafür mit dessen Anzahl', async () => {
    const r = (await owner.get('/api/cases')).json;
    const got = r.cases.map((c) => c.id);
    assert.ok(got.includes(ids.live) && got.includes(ids.fresh), 'laufend und kürzlich abgeschlossen sind dabei');
    assert.ok(!ids.old.some((id) => got.includes(id)), 'Archiv ist nicht dabei');
    assert.equal(r.archive, 5);
  });

  it('Archiv seitenweise, neueste zuerst; Suche auf dem Server', async () => {
    const a = (await owner.get('/api/cases?archiv=1&limit=2')).json;
    assert.equal(a.total, 5);
    assert.deepEqual(a.cases.map((c) => c.id), [ids.old[4], ids.old[3]]);
    const b = (await owner.get('/api/cases?archiv=1&limit=2&offset=4')).json;
    assert.deepEqual(b.cases.map((c) => c.id), [ids.old[0]]);
    const s = (await owner.get('/api/cases?archiv=1&q=' + encodeURIComponent('zeltner'))).json;
    assert.equal(s.total, 1);
    assert.equal(s.cases[0].id, ids.old[2]);
    assert.equal(s.cases[0].description, undefined, 'Liste ohne Sachverhalt');
    assert.equal((await owner.get('/api/cases?archiv=1&q=' + encodeURIComponent('100%_'))).json.total, 0, 'Platzhalter werden wörtlich gesucht');
    assert.equal((await owner.get('/api/cases?archiv=1&q=Vinewood')).json.total, 0, 'laufende Akten stehen nicht im Archiv');
    assert.equal((await client(srv.base).get('/api/cases?archiv=1')).status, 401);
  });

  it('Browser: Reiter „Archiv“ lädt nach, die Suche findet archivierte Akten', { skip: !chromium && 'Playwright nicht installiert' }, async () => {
    const browser = await chromium.launch();
    try {
      const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(srv.base + '/login');
      await p.fill('#email', TEAM.admin);
      await p.fill('#password', PASSWORD);
      await p.click('button[type=submit]');
      await p.waitForSelector('#nav a.nav-item', { state: 'attached' });
      await p.evaluate(() => go('cases'));
      await p.waitForSelector('#caseList tr.row');
      assert.equal(await p.evaluate(() => st.cases.length), await p.evaluate(() => st.casesBase.length), 'am Anfang nur die Arbeitsliste');
      assert.match(await p.textContent('[data-action="case-filter"][data-value="archiv"]'), /Archiv\s*5/);
      await p.click('[data-action="case-filter"][data-value="archiv"]');
      await p.waitForFunction(() => document.querySelectorAll('#caseList tr.row').length === 5);
      assert.equal(await p.$('#caseList [data-archive-more]'), null, 'alles geladen – keine Marke mehr');
      // Suche vom Reiter „Alle“ aus
      await p.click('[data-action="case-filter"][data-value="alle"]');
      await p.fill('#caseSearch', 'Zeltner');
      await p.waitForFunction(() => document.querySelectorAll('#caseList tr.row').length === 1 && /Sandy Shores 3/.test(document.querySelector('#caseList').textContent));
      await p.fill('#caseSearch', 'gibt es nirgends');
      await p.waitForFunction(() => /Keine Akten für diese Auswahl/.test(document.querySelector('#caseList').textContent));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});
