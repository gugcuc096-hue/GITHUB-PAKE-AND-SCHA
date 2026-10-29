'use strict';
/*
 * Befehlsleiste (Strg + K): Befehle und „Gehe zu …“ in der Suche, „>“ nur Befehle, zuletzt geöffnete Akten, neue Trefferarten
 * (Präzedenzfälle, Zeugen, Beweismittel – nur Kanzlei) – API (Rechte) und Browser am PC und am Handy.
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

async function seed(base) {
  const m = client(base);
  await m.post('/api/auth/register', { displayName: 'Cora Befehl', email: 'cora.befehl', password: 'Mandanten-Passwort-5' });
  const a = client(base);
  await a.login(TEAM.admin);
  const made = await a.post('/api/cases', { title: 'Raubüberfall Tankstelle', area: 'strafrecht', clientEmail: 'cora.befehl' });
  assert.equal(made.status, 201, made.text);
  const kase = made.json.case;
  await a.upload(`/api/cases/${kase.id}/attachments?caption=Standbild%20Kasse`, PNG, 'image/png');
  const wit = await a.post(`/api/cases/${kase.id}/parties`, { role: 'zeuge', name: 'Fritz Falkenhagen', contact: 'Discord fritz' });
  assert.equal(wit.status, 201, wit.text);
  const prec = await a.post('/api/precedents', { title: 'Tankstellenraub – Strafmilderung', area: 'strafrecht', summary: 'Geständnis und Rückgabe der Beute.', outcome: 'milderung' });
  assert.ok([200, 201].includes(prec.status), prec.text);
  return { a, kase };
}

describe('Befehlsleiste (API)', () => {
  let srv;
  let a;
  let kase;
  before(async () => {
    srv = await startServer();
    ({ a, kase } = await seed(srv.base));
  });
  after(() => srv.stop());

  it('Kanzlei findet Präzedenzfälle, Zeugen und Beweismittel; „B1“ findet das Beweismittel B1', async () => {
    const r = (await a.get('/api/search?q=' + encodeURIComponent('Falkenhagen'))).json.results;
    assert.equal(r.witnesses.length, 1);
    assert.deepEqual([r.witnesses[0].name, r.witnesses[0].caseId], ['Fritz Falkenhagen', kase.id]);
    const p = (await a.get('/api/search?q=' + encodeURIComponent('Tankstellenraub'))).json.results;
    assert.equal(p.precedents.length, 1);
    assert.equal(p.precedents[0].title, 'Tankstellenraub – Strafmilderung');
    const e = (await a.get('/api/search?q=Standbild')).json.results.evidence;
    assert.deepEqual([e.length, e[0].no, e[0].caseId], [1, 1, kase.id]);
    const b = (await a.get('/api/search?q=B1')).json.results.evidence;
    assert.equal(b.length, 1);
    assert.equal(b[0].caption, 'Standbild Kasse');
  });

  it('Mandanten sehen keine Präzedenzfälle, Zeugen und Beweismittel-Treffer anderer Akten', async () => {
    const m = client(srv.base);
    await m.login('cora.befehl', 'Mandanten-Passwort-5');
    for (const q of ['Falkenhagen', 'Tankstellenraub', 'Standbild', 'B1']) {
      const r = (await m.get('/api/search?q=' + encodeURIComponent(q))).json.results;
      assert.deepEqual([r.witnesses, r.precedents, r.evidence], [[], [], []], q);
    }
  });
});

describe('Befehlsleiste (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let kase;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    ({ kase } = await seed(srv.base));
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Befehle, „Gehe zu …“, „>“, zuletzt geöffnet, Zeuge und Beweismittel in der Suche`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      const open = async () => {
        // die erste Seitenansicht schließt beim Fertigwerden offene Fenster – dann die Suche noch einmal öffnen
        for (let versuch = 0; versuch < 3; versuch++) {
          if (await page.evaluate(() => !!document.querySelector('#modal.open'))) {
            await page.evaluate(() => closeModal());
            await page.waitForFunction(() => !document.querySelector('#modal.open'), null, { timeout: 8000 });
            await page.waitForTimeout(400); // Schließen läuft noch aus
          }
          await page.evaluate(() => openSearch());
          if (await page.waitForSelector('#gsInput', { timeout: 4000 }).then(() => true, () => false)) {
            await page.waitForTimeout(600);
            if (await page.evaluate(() => !!document.querySelector('#gsInput'))) return;
          }
        }
        await page.waitForSelector('#gsInput');
      };
      const type = async (t) => {
        await page.fill('#gsInput', t);
        await page.dispatchEvent('#gsInput', 'input');
      };
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });

        // ohne Eingabe: wichtigste Befehle, noch keine zuletzt geöffneten Akten
        await open();
        assert.ok((await page.textContent('#gsResults')).includes('Neue Akte anlegen'));
        assert.equal(await page.$('[data-action="gs-recent"]'), null, 'noch nichts geöffnet');

        // Akte öffnen → erscheint danach unter „Zuletzt geöffnet“
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((id) => closeModal() || openCase(id), kase.id);
          if (await page.waitForSelector('#secEvidence', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        await open();
        assert.ok((await page.textContent('#gsResults [data-action="gs-recent"]')).includes(kase.caseNumber));

        // „>“ zeigt nur Befehle, „gehe zu kal“ springt in den Kalender
        await type('>');
        assert.equal(await page.$$eval('#gsResults .gs-item:not(.gs-cmd)', (x) => x.length), 0);
        assert.ok((await page.$$eval('#gsResults .gs-cmd', (x) => x.length)) >= 5);
        await type('gehe zu kal');
        await page.waitForFunction(() => document.querySelector('#gsResults .gs-cmd .title')?.textContent.includes('Kalender'));
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => st.view === 'calendar', null, { timeout: 8000 });

        // „>neue akte“ öffnet das Formular anstelle der Suche
        await open();
        await type('>neue akte');
        await page.waitForSelector('#gsResults .gs-cmd');
        await page.keyboard.press('Enter');
        await page.waitForSelector('form[data-form="new-case"]', { timeout: 8000 });

        // Zeuge: Treffer öffnet die Akte, B1: öffnet das Beweismittel
        await open();
        await type('Falkenhagen');
        await page.waitForSelector('#gsResults [data-type="witnesses"]');
        await page.click('#gsResults [data-type="witnesses"]');
        await page.waitForSelector('#secWitnesses', { timeout: 10000 });
        await open();
        await type('Standbild');
        await page.waitForSelector('#gsResults [data-type="evidence"]');
        await page.click('#gsResults [data-type="evidence"]');
        await page.waitForSelector('.lightbox-img', { timeout: 10000 });
        assert.ok((await page.textContent('#modalBody')).includes('Beweismittel B1'));

        // Enter nach einem Aktenzeichen öffnet die Akte, nie einen Befehl
        await open();
        await type(kase.caseNumber);
        await page.waitForSelector('#gsResults [data-type="cases"]');
        assert.equal(await page.$eval('#gsResults .gs-item', (x) => x.dataset.type || x.dataset.action), 'cases');
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
