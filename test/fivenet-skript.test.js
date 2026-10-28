'use strict';
/*
 * FiveNet: Ein-Klick-Übernahme per Benutzerskript (Übergabe an das Dashboard per postMessage) und Erkennung von Titel,
 * Art, Verfasser und Datum beim Einfügen – API (Skript-Auslieferung) und Browser (PC und Handy).
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

describe('FiveNet-Skript (API)', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(() => srv.stop());

  it('Benutzerskript ist öffentlich abrufbar, trägt Kanzlei- und FiveNet-Adresse und ist gültiges JavaScript', async () => {
    const r = await client(srv.base).get('/fivenet-import.user.js');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(r.text, /^\/\/ ==UserScript==/);
    assert.match(r.text, /@match\s+https:\/\/fivenet\.modernv\.net\/\*/);
    assert.ok(r.text.includes(`var KANZLEI = ${JSON.stringify(srv.base)}`), 'Kanzlei-Adresse eingesetzt');
    assert.match(r.text, /@downloadURL\s+http:\/\/127\.0\.0\.1:\d+\/fivenet-import\.user\.js/);
    assert.doesNotThrow(() => new Function(r.text.split('==/UserScript==')[1]), 'Skriptkörper ist gültig');
    assert.doesNotMatch(r.text, /password|passwort|cookie/i, 'kein Zugriff auf Zugangsdaten');
  });
});

describe('FiveNet-Übernahme im Dashboard (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let caseId;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    caseId = (await a.post('/api/cases', { title: 'Verkehrskontrolle Doe', area: 'strafrecht', clientName: 'John Doe' })).json.case.id;
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
    await page.waitForSelector('#modalBack, [data-action="nav-group"], nav', { state: 'attached' });
  };

  it('Erkennung: Datum in drei Schreibweisen, „Feld: Wert“-Zeilen, Titel nur aus echten Überschriften', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await login(page);
    const r = await page.evaluate(() => ({
      d1: parseGermanDate('am 2026-10-05 war'),
      d2: parseGermanDate('Stand: 5.10.2026'),
      d3: parseGermanDate('am 5. Oktober 2026 um 10 Uhr'),
      d4: parseGermanDate('31.02.2026'),
      d5: parseGermanDate('kein Datum'),
      full: guessFivenetMeta('Polizeibericht Verkehrskontrolle\nErstellt von: Officer J. Miller\nDatum: 05.10.2026\nDOC - 74412\nDer Fahrer wurde angehalten.', ['Polizeibericht', 'Strafakte (LSPD)']),
      labeled: guessFivenetMeta('Titel: Haftbefehl Doe\nKategorie: Strafakte (LSPD)\nVerfasser: Staatsanwaltschaft\nErstellt am: 12. März 2026', []),
      sentence: guessFivenetMeta('Der Fahrer wurde um 10 Uhr angehalten.\nWeitere Zeile', []),
      colon: guessFivenetMeta('Aktenzeichen: 123\nText', []),
    }));
    assert.deepEqual([r.d1, r.d2, r.d3, r.d4, r.d5], ['2026-10-05', '2026-10-05', '2026-10-05', '', '']);
    assert.equal(r.full.title, 'Polizeibericht Verkehrskontrolle');
    assert.equal(r.full.docType, 'Polizeibericht');
    assert.equal(r.full.docAuthor, 'Officer J. Miller');
    assert.equal(r.full.docDate, '2026-10-05');
    assert.equal(r.full.documentId, '74412');
    assert.deepEqual([r.labeled.title, r.labeled.docType, r.labeled.docAuthor, r.labeled.docDate], ['Haftbefehl Doe', 'Strafakte (LSPD)', 'Staatsanwaltschaft', '2026-03-12']);
    assert.equal(r.sentence.title, '', 'ein Satz ist keine Überschrift');
    assert.equal(r.colon.title, '', 'eine „Feld: Wert“-Zeile ist keine Überschrift');
    await ctx.close();
  });

  for (const [name, device, docId] of [
    ['PC', { viewport: { width: 1366, height: 900 } }, '4711'],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '4712'],
  ]) {
    it(`${name}: Übergabe aus dem Skript → Akte wählen → Formular vorbelegt → verknüpft; fremde Herkunft wird ignoriert`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await login(page);
      // Die Instanz ist nur über https erreichbar – für den Test gilt die eigene Adresse als „FiveNet“
      await page.evaluate(async () => {
        await load.fivenet();
        st.fivenet = { ...st.fivenet, instance: { ...st.fivenet.instance, url: location.origin, host: location.host } };
      });
      const payload = (nonce, id) => ({
        type: 'ps-fivenet-doc',
        v: 1,
        nonce,
        documentId: id,
        title: 'Polizeibericht – Verkehrskontrolle',
        html: '<h1>Polizeibericht</h1><p>Erstellt von: Officer J. Miller</p><p>Datum: 05.10.2026</p><p>Kategorie: Polizeibericht</p><p>Der Fahrer wurde angehalten.</p><script>alert(1)</script><img src="/api/filestore/abc">',
      });
      // fremde Herkunft: nichts passiert
      await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://boese.example', source: window })), payload('n-evil', '999'));
      await page.waitForTimeout(500);
      assert.equal(await page.$('#fnImportList'), null, 'fremde Herkunft ignoriert');
      // richtige Herkunft
      await page.evaluate((data) => window.postMessage(data, '*'), payload(`n-${docId}`, docId));
      await page.waitForSelector('#fnImportList .fn-pick');
      await page.fill('#fnImportSearch', 'Doe');
      await page.click('#fnImportList .fn-pick');
      await page.waitForSelector('#fnInput');
      assert.ok((await page.inputValue('#fnInput')).endsWith(`/documents/${docId}`));
      assert.equal(await page.inputValue('#fnTitle'), 'Polizeibericht – Verkehrskontrolle');
      assert.equal(await page.inputValue('#fnDocType'), 'Polizeibericht');
      assert.equal(await page.inputValue('input[name="docDate"]'), '2026-10-05');
      assert.equal(await page.inputValue('input[name="docAuthor"]'), 'Officer J. Miller');
      const content = await page.inputValue('#fnContent');
      assert.match(content, /Der Fahrer wurde angehalten\./);
      assert.doesNotMatch(content, /alert/, 'Skripte aus der Übergabe landen nicht im Text');
      await page.fill('#fnInput', `https://fivenet.modernv.net/documents/${docId}`); // der Server kennt nur die echte Instanz
      await page.check('input[name="attest"]');
      await page.click('form[data-form="ext-link"] button[type=submit]');
      await page.waitForFunction(() => !document.querySelector('form[data-form="ext-link"]'), null, { timeout: 8000 });
      const docs = (await (async () => {
        const a = client(srv.base);
        await a.login(TEAM.admin);
        return a.get(`/api/cases/${caseId}`);
      })()).json.externalDocs;
      const doc = docs.find((d) => d.documentId === docId);
      assert.ok(doc, 'Dokument verknüpft');
      assert.equal(doc.docAuthor, 'Officer J. Miller');
      assert.equal(doc.docDate, '2026-10-05');
      assert.match(doc.contentText || '', /angehalten/);
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  it('Einfügen im Dialog: Titel, Art, Verfasser und Datum werden erkannt – bestehende Eingaben bleiben', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await login(page);
    await page.evaluate((id) => openCase(id), caseId);
    await page.waitForSelector('[data-action="fn-add"]');
    await page.click('[data-action="fn-add"]');
    await page.waitForSelector('#fnContent');
    await page.fill('#fnDocType', 'Eigene Art');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<h2>Zeugenaussage Miller</h2><p>Erstellt von: Zeuge M. Miller</p><p>Datum: 7.10.2026</p><p>Kategorie: Polizeibericht</p><p>Ich habe den Unfall gesehen.</p>');
      dt.setData('text/plain', 'x');
      document.querySelector('#fnContent').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelector('#fnTitle').value === 'Zeugenaussage Miller');
    assert.equal(await page.inputValue('input[name="docAuthor"]'), 'Zeuge M. Miller');
    assert.equal(await page.inputValue('input[name="docDate"]'), '2026-10-07');
    assert.equal(await page.inputValue('#fnDocType'), 'Eigene Art', 'vorhandene Eingabe bleibt');
    await ctx.close();
  });
});
