'use strict';
/*
 * Vorladen und Bilder: Das Dashboard wird von Startseite/Karriere aus schon vorgewärmt, die Menüseiten laden im Leerlauf
 * vor, das Vorschaubild ist klein geblieben.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Vorladen und Bilder', () => {
  it('Vorschaubild bleibt ein PNG im Format 1200×630 und ist unter 120 KB', () => {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'og-image.png'));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), 1200);
    assert.equal(buf.readUInt32BE(20), 630);
    assert.ok(buf.length < 120 * 1024, `${buf.length} Bytes`);
  });

  it('Startseite und Karriere laden warm.js (versioniert, aufgeschoben)', async () => {
    const srv = await startServer();
    try {
      for (const p of ['/', '/karriere']) {
        const html = (await client(srv.base).get(p)).text;
        assert.match(html, /<script src="\/js\/warm\.js\?v=[^"]+" defer><\/script>/, p);
      }
    } finally {
      await srv.stop();
    }
  });
});

describe('Vorladen (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  it('Startseite: beim Zeigen auf „Login“ werden Dashboard-Skript und -Stile vorgeladen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await page.goto(`${srv.base}/`);
      assert.equal(await page.$$eval('link[rel=prefetch]', (l) => l.length), 0, 'am Anfang noch nichts');
      await page.hover('a[href^="/login"]');
      await page.waitForFunction(() => document.querySelectorAll('link[rel=prefetch]').length === 3);
      const hrefs = await page.$$eval('link[rel=prefetch]', (l) => l.map((x) => x.getAttribute('href')));
      assert.ok(hrefs.some((h) => /^\/js\/dashboard\.bundle\.js\?v=\w+/.test(h)), hrefs.join(' '));
      assert.ok(hrefs.some((h) => /^\/css\/depth\.css\?v=\w+/.test(h)));
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Dashboard: die Hauptseiten laden im Leerlauf vor und stehen dann sofort bereit', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForFunction(() => st.user && st.user.id);
      await page.waitForFunction(() => ['cases', 'tasks', 'calendar', 'invoices'].every((v) => st.seenViews && st.seenViews.has(v)), null, { timeout: 20000 });
      // ein Klick zeigt die Seite ohne Platzhalter
      await page.click('a.nav-item[href="#calendar"]');
      await page.waitForSelector('#content .page-head, #content h1', { timeout: 3000 });
      assert.equal(await page.$('#content .skeleton'), null, 'kein Ladeplatzhalter');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
