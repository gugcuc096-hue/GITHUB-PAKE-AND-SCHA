'use strict';
/*
 * Eigene Auswahl für Datum, Uhrzeit und Farbe (statt der Browser-Fenster, deren Leisten sich nicht gestalten lassen) und weiche
 * Wechsel im Kalender-Reiter: Monate gleiten, der goldene Rahmen wandert von Tag zu Tag, Uhrzeit-Spalten rollen zum Wert,
 * ein Klick auf einen Tag zeichnet den Kalender nicht neu.
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

describe('Datum, Uhrzeit, Farbe und Kalender-Reiter (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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

  const login = async (page) => {
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForSelector('#nav a.nav-item');
    await page.waitForSelector('#content .page-title');
  };

  it('Uhrzeit-Feld: eigene Spalten statt Browser-Fenster, Wert übernehmen, leeren', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => document.querySelector('#content').insertAdjacentHTML('afterbegin', '<form id="tf"><input type="time" id="tt" name="t" class="field" value="08:15"></form>'));
      await page.evaluate(() => {
        window.__ev = [];
        document.getElementById('tt').addEventListener('change', (e) => window.__ev.push(e.target.value));
      });
      await page.click('#tt');
      await page.waitForSelector('.dp.dp-time');
      assert.equal(await page.locator('.dp .dp-day').count(), 0, 'reine Uhrzeit: kein Kalender');
      assert.equal(await page.locator('.dp [data-dp-hh="08"].sel').count(), 1, 'Stunde aus dem Feld ist gewählt');
      assert.equal(await page.locator('.dp [data-dp-mm="15"].sel').count(), 1, 'Minute aus dem Feld ist gewählt');
      // Die gewählte Stunde liegt mittig in der Spalte (nicht am Ende, nicht außerhalb)
      const centered = await page.evaluate(() => {
        const col = document.querySelector('.dp [data-dp-col="hh"]');
        const sel = col.querySelector('.sel');
        const c = col.getBoundingClientRect();
        const s = sel.getBoundingClientRect();
        return Math.abs(s.top + s.height / 2 - (c.top + c.height / 2));
      });
      assert.ok(centered < 4, `gewählte Stunde mittig (Abstand ${centered})`);
      await page.click('.dp [data-dp-hh="22"]');
      await page.click('.dp [data-dp-mm="30"]');
      assert.equal(await page.inputValue('#tt'), '08:15', 'erst „Übernehmen“ setzt den Wert');
      await page.click('.dp [data-dp-act="ok"]');
      assert.equal(await page.inputValue('#tt'), '22:30');
      assert.deepEqual(await page.evaluate(() => window.__ev), ['22:30']);
      assert.equal(await page.locator('.dp').count(), 0, 'geschlossen');
      await page.click('#tt');
      await page.waitForSelector('.dp.dp-time');
      await page.click('.dp [data-dp-act="clear"]');
      assert.equal(await page.inputValue('#tt'), '');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Farbfeld: eigene Farbauswahl – Farbmuster, Hex-Eingabe, Ziehen; Ereignisse wie beim Browser-Feld', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => {
        document.querySelector('#content').insertAdjacentHTML('afterbegin', '<input type="color" id="cc" value="#d4af37" aria-label="Farbe">');
        window.__ev = [];
        for (const t of ['input', 'change']) document.getElementById('cc').addEventListener(t, (e) => window.__ev.push(`${t}:${e.target.value}`));
      });
      await page.click('#cc');
      await page.waitForSelector('.cp');
      assert.equal(await page.inputValue('.cp-hex'), '#d4af37');
      await page.click('.cp-sw[data-cp-sw="#10b981"]');
      assert.equal(await page.inputValue('#cc'), '#10b981');
      await page.fill('.cp-hex', '#3b82f6');
      assert.equal(await page.inputValue('#cc'), '#3b82f6');
      const sv = await (await page.$('.cp-sv')).boundingBox();
      await page.mouse.move(sv.x + 4, sv.y + 4);
      await page.mouse.down();
      await page.mouse.move(sv.x + sv.width - 4, sv.y + sv.height - 4, { steps: 4 });
      await page.mouse.up();
      assert.match(await page.inputValue('#cc'), /^#0[0-9a-f]{5}$/, 'unten rechts im Farbfeld = fast schwarz');
      const ev = await page.evaluate(() => window.__ev);
      assert.ok(ev.includes('input:#10b981') && ev.includes('change:#10b981'), 'Ereignisse input und change');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.cp').count(), 0);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Kalender-Fenster: Monate gleiten (nur das neue Raster zählt Tage), der Rahmen wandert, der Tag-Klick zeichnet nicht neu', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => document.querySelector('#content').insertAdjacentHTML('afterbegin', '<input type="datetime-local" id="dd" class="field" value="2026-03-10T09:30">'));
      await page.click('#dd');
      await page.waitForSelector('.dp .dp-ring');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('.dp .dp-day.sel').count(), 1);
      await page.click('.dp [data-dp-nav="1"]');
      await page.waitForTimeout(80);
      assert.equal(await page.locator('.dp .dp-grid').count(), 2, 'beim Gleiten kurz zwei Raster');
      assert.equal(await page.locator('.dp .dp-day').count(), 42, '… aber nur das neue zählt Tage');
      await page.waitForFunction(() => document.querySelectorAll('.dp .dp-grid').length === 1);
      assert.equal((await page.textContent('.dp .dp-title')).trim(), 'April 2026');
      // Tag wählen: derselbe Knopf bleibt (kein Neuzeichnen), der Rahmen wandert dorthin
      await page.evaluate(() => (document.querySelector('.dp [data-dp-day="2026-04-08"]').__keep = true));
      const before = await page.$eval('.dp .dp-ring', (e) => e.style.transform);
      await page.click('.dp [data-dp-day="2026-04-08"]');
      await page.waitForTimeout(500);
      const after2 = await page.evaluate(() => {
        const b = document.querySelector('.dp [data-dp-day="2026-04-08"]');
        const ring = document.querySelector('.dp .dp-ring');
        return { kept: !!b.__keep, sel: b.classList.contains('sel'), ring: ring.style.transform, left: b.offsetLeft, top: b.offsetTop };
      });
      assert.ok(after2.kept && after2.sel, 'Knopf bleibt, wird gewählt');
      assert.equal(after2.ring, `translate(${after2.left}px, ${after2.top}px)`, 'Rahmen liegt auf dem gewählten Tag');
      assert.notEqual(after2.ring, before);
      await page.click('.dp [data-dp-hh="18"]');
      await page.click('.dp [data-dp-mm="45"]');
      await page.click('.dp [data-dp-act="ok"]');
      assert.equal(await page.inputValue('#dd'), '2026-04-08T18:45');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Kalender-Reiter: Tag wechseln gleitet (Rahmen, Tagesliste), Raster bleibt stehen; Monatswechsel und „Heute“ gleiten', async () => {
    const adm = client(srv.base);
    await adm.login(TEAM.admin);
    const me = (await adm.get('/api/auth/session')).json.user;
    const kase = (await adm.post('/api/cases', { title: 'Kalender-Akte', area: 'zivilrecht', clientName: 'Karl Kalender', lawyerId: me.id })).json.case;
    const now = new Date();
    const other = now.getDate() > 15 ? 6 : 24;
    const at = (d, h) => {
      const x = new Date(now.getFullYear(), now.getMonth(), d, h, 0, 0, 0);
      return x.toISOString().slice(0, 16);
    };
    assert.equal((await adm.post('/api/calendar', { type: 'gericht', title: 'Anderer Tag A', startsAt: at(other, 9), caseId: kase.id })).status, 201);
    assert.equal((await adm.post('/api/calendar', { type: 'gericht', title: 'Anderer Tag B', startsAt: at(other, 14), caseId: kase.id })).status, 201);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.hash = '#calendar'));
      await page.waitForSelector('.cal-ring', { state: 'attached' });
      await page.waitForFunction(() => document.querySelector('.cal-ring').style.transform.startsWith('translate'));
      await page.waitForTimeout(600);
      await page.evaluate(() => (document.querySelector('#content .cal-grid').__keep = true));
      const start = await page.$eval('.cal-ring', (e) => e.style.transform);
      const titleBefore = await page.$eval('#dayAgenda .panel-title', (e) => e.textContent.trim());
      await page.click(`#content .cal-day:not(.muted)[data-day$="-${String(other).padStart(2, '0')}"]`);
      await page.waitForFunction((t) => document.querySelector('#dayAgenda .panel-title').textContent.trim() !== t, titleBefore);
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        kept: !!document.querySelector('#content .cal-grid').__keep,
        selected: document.querySelectorAll('.cal-day.selected').length,
        ring: document.querySelector('.cal-ring').style.transform,
        day: document.querySelector('.page-actions [data-action="new-event"]').dataset.day,
        sel: document.querySelector('.cal-day.selected').dataset.day,
        rows: document.querySelectorAll('#dayAgenda [data-action="open-event"]').length,
      }));
      assert.ok(state.kept, 'das Raster wurde nicht neu gezeichnet');
      assert.equal(state.selected, 1);
      assert.notEqual(state.ring, start, 'Rahmen ist zum neuen Tag gewandert');
      assert.equal(state.day, state.sel, '„Neuer Eintrag“ gilt für den gewählten Tag');
      assert.ok(state.rows >= 2, `Tagesliste zeigt die zwei Einträge (${state.rows})`);
      // Der Rahmen gleitet wirklich (Zwischenwerte), statt zu springen
      await page.evaluate(() => {
        window.__x = [];
        const t0 = performance.now();
        const f = () => {
          window.__x.push(Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.cal-ring')).transform).e));
          if (performance.now() - t0 < 700) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      await page.click(`#content .cal-day:not(.muted)[data-day$="-${String(now.getDate()).padStart(2, '0')}"]`);
      await page.waitForTimeout(800);
      const xs = await page.evaluate(() => window.__x);
      const distinct = new Set(xs).size;
      assert.ok(distinct >= 3 || xs[0] === xs[xs.length - 1], `Rahmen zeigt Zwischenschritte (${distinct})`);
      // Monatswechsel: Raster und Monatsname gleiten
      await page.click('[data-action="cal-nav"][data-dir="1"]');
      await page.waitForTimeout(60);
      assert.ok((await page.$eval('#content .cal-grid', (e) => e.getAnimations().length)) >= 1, 'Raster gleitet');
      assert.ok((await page.$eval('#content .cal-month', (e) => e.getAnimations().length)) >= 1, 'Monatsname gleitet');
      await page.waitForTimeout(400);
      await page.click('[data-action="cal-today"]');
      await page.waitForFunction(() => document.querySelector('.cal-day.today.selected'));
      assert.equal(await page.locator('.cal-ring').count(), 1);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
