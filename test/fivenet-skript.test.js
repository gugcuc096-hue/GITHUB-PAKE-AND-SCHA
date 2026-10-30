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

  it('Lesezeichen (ohne Erweiterung): nur für die Kanzlei, trägt die Kanzlei-Adresse und ist gültiges JavaScript', async () => {
    assert.equal((await client(srv.base).get('/api/fivenet/status')).status, 401, 'ohne Anmeldung nicht abrufbar');
    const a = client(srv.base);
    await a.login(TEAM.admin);
    const st = await a.get('/api/fivenet/status');
    assert.equal(st.status, 200);
    const url = st.json.bookmarklet;
    assert.ok(url.startsWith('javascript:'));
    const code = decodeURIComponent(url.slice('javascript:'.length));
    assert.ok(code.includes(`var KANZLEI = ${JSON.stringify(srv.base)}`));
    assert.ok(!code.includes('\n'), 'eine Zeile');
    assert.doesNotThrow(() => new Function(code));
    assert.doesNotMatch(code, /password|passwort|cookie/i);
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
    // die erste Seitenansicht schließt beim Fertigwerden offene Fenster – erst abwarten, dann Akten öffnen
    await page.waitForFunction(() => typeof st !== 'undefined' && st.user && st.user.id && !st.histPaused && document.querySelector('#content')?.children.length > 0 && !document.querySelector('#content .skeleton'));
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

  it('Zwischenüberschriften: <h1>–<h6>, Fettdruck-Absätze, GROSSBUCHSTABEN und „§ 3 Titel“ werden erkannt – Sätze und Kürzel nicht', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await login(page);
    const r = await page.evaluate(() => {
      const html = '<h1>Polizeibericht</h1><p>Einleitung des Berichts.</p><h3>Beweismittel</h3><p>B1 liegt vor.</p><p><strong>Zeugenaussagen</strong></p><p><strong>Das ist ein ganzer Satz im Fettdruck.</strong></p><p>SACHVERHALT UND ABLAUF</p><p>LSPD</p><p>DOC - 74412</p><p>§ 3 Pflichten des Mandanten</p><ul><li><strong>Listenpunkt fett</strong></li></ul><table><tr><td><strong>Zelle</strong></td><td>Wert</td></tr></table>';
      const { text } = parsePastedHtml(html);
      return { text, html: PS.transcriptHtml(text), plain: PS.transcriptPlain(text) };
    });
    const lines = r.text.split('\n');
    assert.ok(lines.includes('## Polizeibericht'), 'h1 groß');
    assert.ok(lines.includes('### Beweismittel'), 'h3 klein');
    assert.ok(lines.includes('### Zeugenaussagen'), 'Fettdruck-Absatz');
    assert.ok(lines.includes('Das ist ein ganzer Satz im Fettdruck.'), 'Satz bleibt Text');
    assert.ok(lines.includes('### SACHVERHALT UND ABLAUF'), 'Großbuchstaben');
    assert.ok(lines.includes('LSPD') && lines.includes('DOC - 74412'), 'Kürzel und Aktenzeichen bleiben Text');
    assert.ok(lines.includes('### § 3 Pflichten des Mandanten'), 'Paragraph');
    assert.ok(!lines.some((l) => /^#+ (Zelle|Wert)/.test(l)), 'Tabellenzellen keine Überschrift');
    assert.match(r.html, /<span class="tx-h tx-h2" role="heading" aria-level="3">Polizeibericht<\/span>/);
    assert.match(r.html, /tx-h3[^>]*>Beweismittel</);
    assert.ok(!r.html.includes('##'), 'Markierungen verschwinden in der Anzeige');
    assert.ok(!r.plain.includes('##'), 'Klartext ohne Markierungen');
    assert.match(r.plain, /Beweismittel\n\nB1 liegt vor\./);
    // Text ist maskiert
    assert.equal(await page.evaluate(() => PS.transcriptHtml('## <b>x</b>\n<i>y</i>')), '<span class="tx-h tx-h2" role="heading" aria-level="3">&lt;b&gt;x&lt;/b&gt;</span>&lt;i&gt;y&lt;/i&gt;');
    await ctx.close();
  });

  it('Abschrift mit Überschriften: Anzeige in der Akte groß, Textdatei und Kopie ohne Markierungen', async () => {
    const a = client(srv.base);
    await a.login(TEAM.admin);
    const c = (await a.post('/api/cases', { title: 'Abschrift Überschriften', area: 'strafrecht', clientName: 'Hanna Heading' })).json.case;
    const link = await a.post(`/api/cases/${c.id}/external`, { provider: 'fivenet', input: '4801', attest: true, title: 'Bericht', contentText: '## Sachverhalt\nDer Fahrer wurde angehalten.\n\n### Beweise\nB1 und B2' });
    assert.equal(link.status, 201, link.text);
    const txt = await a.get(`/api/cases/${c.id}/external/${link.json.document.id}/text`);
    assert.equal(txt.status, 200);
    assert.ok(!txt.text.includes('##'), 'Textdatei ohne Markierungen');
    assert.match(txt.text, /Sachverhalt\r\n\r\nDer Fahrer wurde angehalten\./);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await login(page);
    await page.evaluate((id) => openCase(id), c.id);
    await page.waitForSelector('.fn-text summary');
    await page.click('.fn-text summary');
    await page.waitForSelector('.fn-pre .tx-h2');
    const sizes = await page.$$eval('.fn-pre .tx-h2, .fn-pre .tx-h3', (els) => els.map((e) => [e.textContent, parseFloat(getComputedStyle(e).fontSize)]));
    const body = await page.$eval('.fn-pre', (e) => parseFloat(getComputedStyle(e).fontSize));
    assert.deepEqual(sizes.map((x) => x[0]), ['Sachverhalt', 'Beweise']);
    assert.ok(sizes[0][1] > body * 1.4 && sizes[1][1] > body, `Überschriften größer als der Text: ${JSON.stringify(sizes)} vs ${body}`);
    // Kopieren: ohne Markierungen
    assert.ok(!(await page.evaluate((t) => PS.transcriptPlain(t), '## Sachverhalt\nText')).includes('#'));
    await ctx.close();
  });
  it('Profil: Skript kopieren und Lesezeichen anbieten (falls Tampermonkey nichts anzeigt) – das Lesezeichen sendet ein FiveNet-Dokument ans Dashboard', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await login(page);
    await page.waitForFunction(() => typeof fivenetProfilePanel === 'function');
    await page.evaluate(() => go('profile'));
    await page.waitForSelector('.fn-oneclick');
    // Hinweise zur Erweiterung und Weg ohne Erweiterung stehen da
    const panel = await page.textContent('.fn-oneclick');
    assert.match(panel, /Benutzerskripte zulassen/);
    assert.match(panel, /Skript kopieren/);
    assert.match(await page.getAttribute('.fn-bookmarklet a[data-action="fn-bm-hint"]', 'href'), /^javascript:/);
    // „Skript kopieren“ legt das Benutzerskript in die Zwischenablage
    await page.click('[data-action="fn-script-copy"]');
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.startsWith('// ==UserScript==')), null, { timeout: 5000 });
    // „Adresse kopieren“ legt das Lesezeichen ab; ein Klick auf den Ziehknopf tut nichts außer einem Hinweis
    await page.click('[data-action="fn-bm-copy"]');
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.startsWith('javascript:')), null, { timeout: 5000 });
    const bookmarklet = await page.evaluate(() => navigator.clipboard.readText());
    await page.click('[data-action="fn-bm-hint"]');
    assert.ok((await page.textContent('#toasts, .ps-toast, [role="status"]').catch(() => '')) !== null);
    assert.equal(page.url().startsWith('javascript:'), false);

    // Das Lesezeichen auf einer (nachgebildeten) FiveNet-Seite ausführen: das Dashboard öffnet sich mit der Akten-Auswahl
    await ctx.route('https://fivenet.modernv.net/**', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>FiveNet</title><main><h1>Haftbefehl Doe</h1><p>Erstellt von: Staatsanwaltschaft</p><p>Der Beschuldigte wurde angehört.</p><img src="/api/filestore/abc" alt="Foto Tatort"></main>' })
    );
    const fake = await ctx.newPage();
    await fake.goto('https://fivenet.modernv.net/documents/4802');
    const popup = ctx.waitForEvent('page');
    await fake.evaluate((code) => {
      // wie ein Klick auf das Lesezeichen: die Adresse „javascript:…“ wird als Skript ausgeführt
      window.eval(decodeURIComponent(code.slice('javascript:'.length)));
    }, bookmarklet);
    const dash = await popup;
    await dash.waitForSelector('#fnImportList .fn-pick', { timeout: 15000 });
    assert.match(await dash.textContent('#modalBody'), /Dokument\s*4802/);
    assert.match(await dash.textContent('#modalBody'), /Haftbefehl Doe/);
    // Auf einer Seite ohne Dokument: nur ein Hinweis, kein Fenster
    const other = await ctx.newPage();
    await other.goto('https://fivenet.modernv.net/overview');
    await other.evaluate((code) => window.eval(decodeURIComponent(code.slice('javascript:'.length))), bookmarklet);
    await other.waitForFunction(() => document.body.innerText.includes('Bitte zuerst ein FiveNet-Dokument öffnen'));
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});
