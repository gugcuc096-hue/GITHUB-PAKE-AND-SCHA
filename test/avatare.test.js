'use strict';
/*
 * Profilbilder: die Spalte „Zuständig“ zeigt das Foto statt der Initialen, kaputte Bilder werden zu Initialen, die Mandantenliste
 * zeigt Avatar, Rechnungs-Chip (rot bei Überfälligem) und Hinweise – API und Browser (PC und Handy).
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Profilbilder und Mandantenliste (API)', () => {
  let srv;
  let admin;
  let anwalt;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    anwalt = client(srv.base);
    await admin.login(TEAM.admin);
    await anwalt.login(TEAM.anwalt);
  });
  after(() => srv.stop());

  it('Akte nennt das Foto der zuständigen Anwälte (federführend und weitere), ohne Foto null', async () => {
    assert.equal((await admin.upload('/api/auth/avatar', PNG, 'image/png')).status, 200);
    const k = (await admin.post('/api/cases', { title: 'Foto in Zuständig', area: 'zivilrecht', clientName: 'Fiona Foto' })).json.case;
    const list = (await admin.get('/api/cases')).json.cases;
    const row = list.find((c) => c.id === k.id);
    assert.match(row.lawyerAvatarUrl || '', /^\/media\/avatars\//, 'eigenes Foto des federführenden Anwalts');
    const other = (await anwalt.get('/api/auth/me')).json.user;
    const add = await admin.patch(`/api/cases/${k.id}`, { coLawyerIds: [other.id] });
    if (add.status === 200) {
      const again = (await admin.get('/api/cases')).json.cases.find((c) => c.id === k.id);
      assert.ok(again.coLawyers.every((l) => 'avatarUrl' in l), 'weitere Anwälte tragen avatarUrl');
    }
  });

  it('Mandantenliste: Avatar-Adresse, überfällige Rechnungen, Alter der ältesten, „neu“', async () => {
    const k = (await admin.post('/api/cases', { title: 'Offene Posten', area: 'zivilrecht', clientName: 'Rita Rechnung' })).json.case;
    const late = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
    const inv = await admin.post('/api/invoices', { caseId: k.id, dueDate: late, items: [{ description: 'Beratung', quantity: 1, unitPrice: 4200 }] });
    assert.equal(inv.status, 201, inv.text);
    const rita = (await admin.get('/api/clients')).json.clients.find((c) => c.name === 'Rita Rechnung');
    assert.ok(rita, 'Mandantin in der Liste');
    assert.equal(rita.openSum, 4200);
    assert.equal(rita.overdueCount, 1);
    assert.equal(typeof rita.openOldestDays, 'number');
    assert.equal(rita.isNew, true);
    assert.equal(rita.avatarUrl, null, 'ohne Konto kein Bild');
  });
});

describe('Profilbilder und Mandantenliste (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.upload('/api/auth/avatar', PNG, 'image/png');
    const k = (await a.post('/api/cases', { title: 'Offene Posten', area: 'zivilrecht', clientName: 'Rita Rechnung' })).json.case;
    const late = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
    await a.post('/api/invoices', { caseId: k.id, dueDate: late, items: [{ description: 'Beratung', quantity: 1, unitPrice: 4200 }] });
    await a.post('/api/cases', { title: 'Ruhige Akte', area: 'strafrecht', clientName: 'Rolf Ruhig' });
  });
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

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Zuständig zeigt das Foto, Mandanten mit Avatar, Rechnungs-Chip und Hinweisen; kaputtes Bild wird zu Initialen`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await login(page);
        // Akten: Foto in „Zuständig“
        await page.goto(`${srv.base}/dashboard#cases`);
        await page.waitForSelector('#caseList .who2-av img', { timeout: 15000 });
        assert.match(await page.$eval('#caseList .who2-av img', (i) => i.getAttribute('src')), /^\/media\/avatars\//);
        // Mandanten
        await page.goto(`${srv.base}/dashboard#clients`);
        await page.waitForFunction(() => (document.querySelector('#clientList') || {}).textContent?.includes('Rita Rechnung'), null, { timeout: 15000 });
        const rita = await page.evaluate(() => {
          const row = [...document.querySelectorAll('#clientList tr.row')].find((r) => r.textContent.includes('Rita Rechnung'));
          return {
            avatar: !!row.querySelector('.avatar'),
            chip: (row.querySelector('.badge-money') || {}).textContent || '',
            chipRed: !!row.querySelector('.badge-money.badge-red'),
            hints: [...row.querySelectorAll('td[data-label="Hinweise"] .badge')].map((b) => b.textContent.trim()),
          };
        });
        assert.equal(rita.avatar, true, 'Avatar vor dem Namen');
        assert.match(rita.chip, /4\.200/);
        assert.equal(rita.chipRed, true, 'überfällig = rot');
        assert.ok(rita.hints.includes('1 überfällig') && rita.hints.includes('Neu'), JSON.stringify(rita.hints));
        const rolf = await page.evaluate(() => {
          const row = [...document.querySelectorAll('#clientList tr.row')].find((r) => r.textContent.includes('Rolf Ruhig'));
          return { chip: !!row.querySelector('.badge-money'), hints: [...row.querySelectorAll('td[data-label="Hinweise"] .badge')].map((b) => b.textContent.trim()) };
        });
        assert.equal(rolf.chip, false, 'ohne offene Rechnung kein Chip');
        assert.deepEqual(rolf.hints, ['Neu']);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), true, 'kein seitliches Scrollen');
        // kaputtes Bild → Initialen
        const text = await page.evaluate(async () => {
          const box = document.createElement('div');
          box.innerHTML = avatarWrap('/uploads/gibt-es-nicht.png', 'Tina Test', null, 'sm');
          document.body.appendChild(box);
          await new Promise((r) => setTimeout(r, 1200));
          const out = { img: !!box.querySelector('img'), text: box.querySelector('.avatar').textContent.trim() };
          box.remove();
          return out;
        });
        assert.deepEqual(text, { img: false, text: 'TT' });
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
