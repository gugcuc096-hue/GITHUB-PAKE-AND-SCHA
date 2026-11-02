'use strict';
/* Karriereseite: keine Initiativbewerbung mehr – man bewirbt sich auf eine ausgeschriebene Stelle. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Karriere ohne Initiativbewerbung', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(() => srv.stop());

  it('weder die Seite noch ihr Skript bieten „Initiativbewerbung“ an', async () => {
    const html = (await client(srv.base).get('/karriere')).text;
    assert.ok(!/initiativ/i.test(html), 'Seite');
    assert.ok(!/initiativ/i.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'karriere.js'), 'utf8')), 'Skript');
  });

  it('Browser: die Auswahl enthält nur ausgeschriebene Stellen; ohne Stellen entfällt das Formular', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const adm = client(srv.base);
    await adm.login(require('./helpers').TEAM.admin);
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE' })).newPage();
      const created = await adm.post('/api/admin/positions', { title: 'Associate Test', description: 'x', requirements: 'y', active: true });
      assert.ok([200, 201].includes(created.status), `Stelle anlegen: ${created.status}`);
      await page.goto(`${srv.base}/karriere`);
      await page.waitForFunction(() => document.querySelectorAll('#apPosition option').length > 0);
      const values = await page.$$eval('#apPosition option', (l) => l.map((o) => o.value));
      assert.ok(values.length > 0 && values.every((v) => v !== ''), `nur echte Stellen: ${values}`);
      assert.equal(await page.locator('[data-apply=""]').count(), 0, 'kein „Initiativ bewerben“');
      assert.equal(await page.isVisible('#bewerben'), true);
      // alle Stellen ausblenden → kein Formular mehr
      const list = (await adm.get('/api/admin/positions')).json;
      for (const p of list.positions || []) await adm.patch(`/api/admin/positions/${p.id}`, { active: false });
      await page.goto(`${srv.base}/karriere`);
      await page.waitForFunction(() => /keine Stellen ausgeschrieben/.test(document.querySelector('#positions')?.textContent || ''));
      assert.equal(await page.isVisible('#bewerben'), false, 'Formular entfällt');
    } finally {
      await browser.close();
    }
  });
});
