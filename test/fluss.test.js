'use strict';
/*
 * Bewegung mit Gefühl: Kalender-Einträge lassen sich am PC mit der Maus und am Handy mit gedrücktem Halten auf einen anderen Tag
 * ziehen (Pendel-Neigung, Rückfedern ohne Ziel, Einrasten am Ziel), Aufgaben-Haken federn auf und die Akte sortiert beim
 * Abhaken weich um.
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

describe('Ziehen im Kalender und Abhaken (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
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
    await page.waitForFunction(() => st.user && st.user.id && views.calendar, null, { timeout: 15000 });
  };
  /** Mittag (Berlin) von heute + n Tagen, damit der Eintrag sicher auf diesem Kalendertag liegt. */
  const noon = (n) => {
    const d = new Date();
    d.setUTCHours(10, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString();
  };
  const dayOf = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const fire = (page, selector, type, x, y, pointerType) =>
    page.evaluate(([sel, t, cx, cy, pt]) => {
      const el = sel === 'document' ? document : document.querySelector(sel);
      const ev = new PointerEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerType: pt, button: 0, isPrimary: true });
      el.dispatchEvent(ev);
    }, [selector, type, x, y, pointerType]);
  const center = async (page, selector) => {
    const b = await page.locator(selector).first().boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  for (const [name, device, pointer] of [
    ['PC', { viewport: { width: 1366, height: 900 } }, 'mouse'],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'touch'],
  ]) {
    it(`${name}: Eintrag auf einen anderen Tag ziehen (${pointer === 'touch' ? 'gedrückt halten' : 'Maus'}), ohne Ziel federt er zurück`, async () => {
      const a = client(srv.base);
      await a.login(TEAM.admin);
      const ev = (await a.post('/api/calendar', { title: `Verhandlung ${name}`, type: 'gericht', startsAt: noon(0) })).json.event;
      assert.ok(ev, 'Eintrag angelegt');
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await login(page);
        await page.evaluate(() => navigate('calendar'));
        // am Handy hält man die Zeile in der Tagesübersicht, am PC den Eintrag im Raster
        const chipSel = pointer === 'touch' ? `#content #dayAgenda [data-action="open-event"][data-id="${ev.id}"]` : `#content .cal-ev[data-ev="${ev.id}"]`;
        await page.waitForSelector(chipSel);
        const tomorrow = dayOf(noon(1));
        const targetSel = `#content .cal-day[data-day="${tomorrow}"]`;
        await page.waitForSelector(targetSel);

        // Wischen/Scrollen am Handy (Bewegung vor dem Halten) hebt nichts ab
        let c = await center(page, chipSel);
        if (pointer === 'touch') {
          await fire(page, chipSel, 'pointerdown', c.x, c.y, pointer);
          await fire(page, 'document', 'pointermove', c.x + 30, c.y + 30, pointer);
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(() => !!document.querySelector('.cal-ghost')), false, 'beim Wischen wird nichts abgehoben');
          await fire(page, 'document', 'pointerup', c.x + 30, c.y + 30, pointer);
          await page.waitForTimeout(300);
        }

        // 1) Loslassen über keinem Tag: nichts ändert sich, der Eintrag federt zurück
        c = await center(page, chipSel);
        await fire(page, chipSel, 'pointerdown', c.x, c.y, pointer);
        if (pointer === 'touch') await page.waitForTimeout(520); // gedrückt halten → abheben
        await fire(page, 'document', 'pointermove', c.x + 40, c.y + 5, pointer);
        await fire(page, 'document', 'pointermove', c.x + 90, c.y + 8, pointer);
        await page.waitForSelector('.cal-ghost');
        const tilt = await page.$eval('.cal-ghost', (g) => g.style.transform);
        assert.match(tilt, /rotate\(-?[\d.]+deg\)/, 'Pendel-Neigung');
        assert.ok(await page.evaluate(() => document.body.classList.contains('cal-dragging')));
        await fire(page, 'document', 'pointermove', 1, 1, pointer); // Ecke ohne Tag
        await fire(page, 'document', 'pointerup', 1, 1, pointer);
        await page.waitForFunction(() => !document.querySelector('.cal-ghost') && !document.body.classList.contains('cal-dragging'), null, { timeout: 3000 });
        assert.equal(dayOf((await a.get('/api/calendar')).json.events.find((x) => x.id === ev.id).startsAt), dayOf(noon(0)), 'Tag unverändert');

        // 2) Auf den nächsten Tag loslassen: Eintrag wechselt den Tag, die Uhrzeit bleibt
        c = await center(page, chipSel);
        await fire(page, chipSel, 'pointerdown', c.x, c.y, pointer);
        if (pointer === 'touch') await page.waitForTimeout(520);
        const t = await center(page, targetSel);
        await fire(page, 'document', 'pointermove', (c.x + t.x) / 2, (c.y + t.y) / 2, pointer);
        await fire(page, 'document', 'pointermove', t.x, t.y, pointer);
        await page.waitForSelector(`${targetSel}.drop-target`);
        await fire(page, 'document', 'pointerup', t.x, t.y, pointer);
        await page.waitForFunction(() => !document.querySelector('.cal-ghost'), null, { timeout: 3000 });
        await page.waitForFunction((id) => st.events.find((e) => e.id === id) && st.events.find((e) => e.id === id).startsAt.slice(0, 10) !== '', ev.id);
        const moved = (await a.get('/api/calendar')).json.events.find((x) => x.id === ev.id);
        assert.equal(dayOf(moved.startsAt), tomorrow);
        assert.equal(new Date(moved.startsAt).toISOString().slice(11, 16), '10:00', 'Uhrzeit bleibt');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }

  it('Handy: Aufgabe in der Akte abhaken – der Haken federt auf, die Aufgabe rutscht weich nach unten', async () => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    const kase = (await a.post('/api/cases', { title: 'Mietstreit', area: 'zivilrecht', clientName: 'Paul Weber' })).json.case;
    const t1 = (await a.post('/api/tasks', { title: 'Erste Aufgabe', caseId: kase.id })).json.task;
    await a.post('/api/tasks', { title: 'Zweite Aufgabe', caseId: kase.id });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.evaluate((id) => openCase(id), kase.id);
        if (await page.waitForSelector('#secTasks', { timeout: 10000 }).then(() => true, () => false)) break;
      }
      await page.click(`#secTasks [data-action="task-toggle"][data-id="${t1.id}"]`);
      await page.waitForFunction((id) => document.querySelector(`#secTasks [data-action="task-toggle"][data-id="${id}"]`)?.classList.contains('pop'), t1.id, { timeout: 8000 });
      await page.waitForFunction((id) => {
        const rows = [...document.querySelectorAll('#secTasks .task-row')];
        return rows.length === 2 && rows[1].querySelector(`[data-id="${id}"]`);
      }, t1.id, { timeout: 8000 });
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
  it('PC: Menüpunkt links – die Überschrift fliegt nicht hinter der Seitenleiste los (nur die Kachel der Übersicht löst den Flug aus)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await login(page);
      await page.waitForSelector('#nav a.nav-item[href="#invoices"]');
      // Ab dem Klick 700 ms lang beobachten, ob an der neuen Überschrift eine Flug-Animation (nicht CSS) läuft
      const flights = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let seen = 0;
            const t0 = performance.now();
            const tick = () => {
              const t = document.querySelector('#content .page-title');
              if (t) seen = Math.max(seen, t.getAnimations().filter((a) => !(a instanceof CSSAnimation)).length);
              if (performance.now() - t0 < 700) requestAnimationFrame(tick);
              else resolve(seen);
            };
            document.querySelector('#nav a.nav-item[href="#invoices"]').click();
            tick();
          })
      );
      await page.waitForSelector('#content .page-title');
      assert.equal(flights, 0, 'keine Flug-Animation an der Überschrift');
    } finally {
      await ctx.close();
    }
  });
  it('PC: Karteikarte eines Mandanten neigt sich nicht zur Maus (man liest und schreibt darin)', async () => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    await a.post('/api/cases', { title: 'Kartei ohne Wackeln', area: 'zivilrecht', clientName: 'Paula Ruhig' });
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
      await login(page);
      await page.goto(`${srv.base}/dashboard#clients`);
      await page.waitForFunction(() => (document.querySelector('#clientList') || {}).textContent?.includes('Paula Ruhig'), null, { timeout: 15000 });
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.click('#clientList [data-action]').catch(() => {});
        if (await page.waitForSelector('#modalBody .client-cover', { timeout: 5000 }).then(() => true, () => false)) break;
      }
      await page.waitForSelector('#modalBody .client-cover');
      const box = await page.locator('#modalBody .client-cover').boundingBox();
      await page.mouse.move(box.x + box.width * 0.85, box.y + 20);
      await page.mouse.move(box.x + box.width * 0.9, box.y + 30, { steps: 4 });
      await page.waitForTimeout(300);
      assert.equal(await page.$eval('#modalBody .client-cover', (c) => c.style.transform), '', 'keine Neigung');
      assert.equal(await page.$eval('#modalBody .client-cover', (c) => c.classList.contains('ps-tilt')), false);
    } finally {
      await ctx.close();
    }
  });
});
