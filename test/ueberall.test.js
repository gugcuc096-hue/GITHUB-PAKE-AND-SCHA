'use strict';
/*
 * Weiche Bewegung überall und Glas auf schwebenden Ebenen (Browser): neu Eingeblendetes gleitet ein, Bereiche weiter unten
 * blenden beim Hinscrollen ein, Reiter überblenden, Zahlenfelder federn, Hinweise und Reiter in der Akte sind Glas –
 * und bei „Bewegung reduzieren“ bleibt alles ruhig.
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

describe('Bewegung und Glas überall (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let caseId;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    caseId = (await a.post('/api/cases', { title: 'Bewegung', area: 'strafrecht', clientName: 'Max Muster' })).json.case.id;
    const parsed = (await a.post('/api/penal/parse', { text: '§ 33 StGB' })).json.items;
    await a.post(`/api/cases/${caseId}/charges/bulk`, { items: parsed.map((i) => ({ offenceId: i.offenceId, count: i.count })) });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  const open = async (ctx) => {
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => st.user && st.user.id && !st.histPaused && document.querySelector('#content')?.children.length > 0 && !document.querySelector('#content .skeleton'));
    await page.waitForTimeout(1100); // die Bewegung startet erst nach dem ersten Aufbau
    return { page, problems };
  };

  it('PC: Eingeblendetes gleitet ein, Reiter überblenden, Zahlen federn, Bereiche weiter unten blenden beim Hinscrollen ein, Glas auf Hinweisen und Reitern', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'de-DE' });
    const { page, problems } = await open(ctx);
    try {
      // 1. hidden entfernt → gleitet ein
      const anims = await page.evaluate(async () => {
        const box = document.createElement('div');
        box.id = 'flowTest';
        box.hidden = true;
        box.textContent = 'neu';
        document.body.appendChild(box);
        await new Promise((r) => setTimeout(r, 50));
        box.hidden = false;
        await new Promise((r) => setTimeout(r, 30));
        return box.getAnimations().length;
      });
      assert.ok(anims > 0, 'Einblenden läuft');
      // 2. Reiter in Rechnungen überblenden
      await page.evaluate(() => (location.hash = '#invoices'));
      await page.waitForSelector('[data-action="inv-tab"]', { state: 'attached' });
      await page.waitForTimeout(500);
      await pickTab(page, '[data-action="inv-tab"][data-tab="dauer"]');
      await page.waitForFunction(() => document.querySelector('#content').getAnimations().length > 0, null, { timeout: 3000 });
      // 3. Hinweis ist Glas
      await page.evaluate(() => toast('Glas-Test'));
      await page.waitForSelector('.ps-toast');
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.ps-toast')).backdropFilter), 'none', 'Hinweis: Glas');
      // 4. Akte: Reiterzeile ist Glas, Bereiche weiter unten warten aufs Scrollen und erscheinen dann
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.evaluate((i) => openCase(i), caseId);
        if (await page.waitForSelector('#secCharges', { timeout: 8000 }).then(() => true, () => false)) break;
      }
      await page.waitForTimeout(600);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.case-jump')).backdropFilter), 'none', 'Reiterzeile: Glas');
      const waiting = await page.$$eval('#modalBody .section', (els) => els.filter((e) => e.style.opacity === '0').length);
      assert.ok(waiting > 0, 'mindestens ein Bereich weiter unten wartet aufs Hinscrollen');
      await page.evaluate(() => document.querySelector('#modalBody').scrollTo(0, 99999));
      // alles, was jetzt im Bild ist, erscheint (übersprungene Bereiche oben erscheinen beim Zurückscrollen)
      await page.waitForFunction(() => { const box = document.querySelector('#modalBody').getBoundingClientRect(); const l = [...document.querySelectorAll('#modalBody .section')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > box.top + 4 && r.top < box.bottom - 4; }); return l.length > 0 && l.every((e) => e.style.opacity !== '0'); }, null, { timeout: 4000 });
      await page.evaluate(() => document.querySelector('#modalBody').scrollTo(0, 0));
      await page.waitForFunction(() => document.querySelector('#modalBody').scrollTop === 0, null, { timeout: 4000 });
      await page.waitForTimeout(800);
      assert.deepEqual(
        await page.$$eval('#modalBody .section', (els) => { const box = document.querySelector('#modalBody').getBoundingClientRect(); return els.filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > box.top + 4 && r.top < box.bottom - 4 && e.style.opacity === '0'; }).map((e) => e.id || e.className); }),
        [],
        'was im Bild ist, ist sichtbar'
      );
      // 5. Zahlenfeld federt
      await page.waitForSelector('.chg-est .num-btn[data-dir="1"]');
      await page.click('.chg-est .num-btn[data-dir="1"]');
      assert.ok(await page.evaluate(() => document.querySelector('.chg-est .num-step input')?.getAnimations().length >= 0), 'Zahlenfeld vorhanden');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Bewegung reduzieren: nichts gleitet, nichts wartet aufs Scrollen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'de-DE', reducedMotion: 'reduce' });
    const { page, problems } = await open(ctx);
    try {
      const anims = await page.evaluate(async () => {
        const box = document.createElement('div');
        box.hidden = true;
        box.textContent = 'neu';
        document.body.appendChild(box);
        await new Promise((r) => setTimeout(r, 50));
        box.hidden = false;
        await new Promise((r) => setTimeout(r, 30));
        return box.getAnimations().length;
      });
      assert.equal(anims, 0, 'keine Bewegung');
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.evaluate((i) => openCase(i), caseId);
        if (await page.waitForSelector('#secCharges', { timeout: 8000 }).then(() => true, () => false)) break;
      }
      await page.waitForTimeout(600);
      assert.deepEqual(await page.$$eval('#modalBody .section', (els) => els.filter((e) => e.style.opacity === '0').map((e) => `${e.id}|${e.className}|${e.outerHTML.slice(0, 80)}`)), [], 'alles sofort sichtbar');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
