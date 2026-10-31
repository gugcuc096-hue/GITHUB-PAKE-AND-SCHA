'use strict';
/*
 * Feinschliff aus dem Rundgang: eine Reiterleiste für alles (am PC umbrechen, am Handy Auswahlliste), Auswahllisten mit
 * Pfeil, Mandantenname in der Akte nur einmal (als Feld), Dienststatus am Handy verständlich, größere Tippflächen am
 * Handy und Discord ohne Bot-Token als normaler Zustand.
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

describe('Discord ohne Bot-Token (API)', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    if (srv) await srv.stop();
  });
  it('Rollen und Kanäle: „nicht eingerichtet“ ist kein Fehler', async () => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    const r = await a.get('/api/bot/discord');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.configured, false);
    assert.match(r.json.error, /Bot-Token/);
  });
});

describe('Reiterleisten, Akte und Handy (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let kase;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    kase = (await a.post('/api/cases', { title: 'Raub am Juwelier mit einem sehr langen Titel, der zwei Zeilen braucht', area: 'strafrecht', clientName: 'Vito Russo' })).json.case;
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
    await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
  };

  it('PC: Reiter der Einstellungen brechen um statt abgeschnitten zu werden; Auswahllisten haben einen Pfeil', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('#content .settings-tabs.tabrow');
      const row = await page.$eval('#content .settings-tabs', (r) => ({ sw: r.scrollWidth, cw: r.clientWidth, wrap: getComputedStyle(r).flexWrap, n: r.children.length }));
      assert.ok(row.n >= 5, 'mehrere Reiter');
      assert.equal(row.wrap, 'wrap');
      assert.ok(row.sw <= row.cw + 1, `alle Reiter sichtbar (${row.sw} > ${row.cw})`);
      assert.equal(await page.$('.tabrow-pick'), null, 'am PC keine Auswahlliste');
      // Auswahlliste mit Pfeil: eingebauter Pfeil (moderne Browser) oder Pfeilbild
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('#content select.field');
      const arrow = await page.$eval('#content select.field', (s) => {
        const cs = getComputedStyle(s);
        const icon = CSS.supports('appearance', 'base-select') ? getComputedStyle(s, '::picker-icon').display : 'none';
        return { bg: cs.backgroundImage, icon };
      });
      assert.ok(arrow.icon !== 'none' || /svg/.test(arrow.bg), `Pfeil sichtbar: ${JSON.stringify(arrow)}`);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Handy: zu breite Reiterleiste wird zur Auswahlliste, die den Reiter wechselt; Akte springt per Liste', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('.tabrow-pick select');
      assert.equal(await page.$eval('#content .settings-tabs', (r) => getComputedStyle(r).display), 'none', 'Leiste versteckt');
      await page.selectOption('.tabrow-pick select', { label: 'Listen' });
      await page.waitForFunction(() => st.settingsTab === 'listen');
      assert.equal(await page.$eval('.tabrow-pick select', (s) => s.options[s.selectedIndex].text), 'Listen', 'Liste zeigt den gewählten Reiter');
      assert.equal(await page.$$eval('.tabrow-pick', (l) => l.length), 1, 'genau eine Liste');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'nichts ragt seitlich heraus');
      // Akte: Sprungleiste als „Springen zu …“
      await page.evaluate((id) => openCase(id), kase.id);
      await page.waitForSelector('#modal.open .case-jump .tabrow-pick select');
      assert.equal(await page.$eval('#modal .case-jump .tabrow-pick select', (s) => s.options[0].text), 'Springen zu …');
      // Dienststatus: Uhr mit Statuspunkt und verständlicher Beschriftung
      const duty = await page.$eval('#dutyBtn', (b) => ({ label: b.getAttribute('aria-label'), ico: getComputedStyle(b.querySelector('.duty-ico')).display }));
      assert.equal(duty.label, 'Dienststatus: Außer Dienst');
      assert.notEqual(duty.ico, 'none');
      // größere Tippfläche bei Touch (der Stern bleibt optisch gleich groß)
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        const star = await page.$eval('#modal .star-btn', (b) => ({ w: b.getBoundingClientRect().width, after: getComputedStyle(b, '::after').content, inset: getComputedStyle(b, '::after').top }));
        assert.ok(star.w < 30, 'Stern optisch unverändert');
        assert.notEqual(star.after, 'none');
        assert.equal(star.inset, '-9px');
      }
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Akte: Mandantenname nur einmal – Link zur Kartei, Stift benennt um; langer Titel bekommt am PC zwei Zeilen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await login(page);
      await page.evaluate((id) => openCase(id), kase.id);
      await page.waitForSelector('#modal.open [data-ie="clientName"]', { state: 'attached' });
      const text = await page.$eval('#modalBody', (b) => b.textContent);
      assert.ok(!text.includes('Name des Mandanten'), 'keine zweite Zeile');
      assert.equal(await page.$$eval('#modalBody [data-ie="clientName"]', (l) => l.length), 1);
      assert.ok(await page.isVisible('#modalBody .ie-swap .client-link'), 'der Name öffnet die Kartei');
      assert.equal(await page.isVisible('#modalBody [data-ie="clientName"]'), false, 'Feld erst nach dem Stift');
      // Stift: Feld statt Link, speichern, danach wieder der Link mit neuem Namen
      await page.click('#modalBody [data-ie-open="clientName"]');
      await page.fill('#modalBody [data-ie="clientName"] input', 'Vito Russo jr.');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#modalBody .ie-swap .client-link')?.textContent === 'Vito Russo jr.' && !document.querySelector('#modalBody .ie-swap.is-renaming'));
      const title = await page.$eval('#modalBody .case-title', (t) => ({ h: t.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(t).lineHeight), clamp: getComputedStyle(t).webkitLineClamp }));
      assert.equal(title.clamp, '2');
      assert.ok(title.h > title.lh * 1.5, 'zwei Zeilen');
    } finally {
      await ctx.close();
    }
  });
});
