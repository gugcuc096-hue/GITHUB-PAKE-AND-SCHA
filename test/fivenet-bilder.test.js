'use strict';
/*
 * FiveNet-Bilder: Marker im Text („[Bild 2]“ → „[Bild → B7]“), Bildunterschriften aus dem Dokument und Übergabe per Skript –
 * API (Marker ersetzen, nur eigene Bilder des Dokuments) und Browser (Einfügen im Dialog, PC und Handy).
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

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

describe('FiveNet-Bilder (API)', () => {
  let srv;
  let owner;
  let mandant;
  let kase;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    mandant = client(srv.base);
    await owner.login(TEAM.admin);
    await mandant.post('/api/auth/register', { displayName: 'Mia Marker', email: 'mia.marker', password: 'Mandanten-Passwort-5' });
    await mandant.login('mia.marker', 'Mandanten-Passwort-5');
    kase = (await owner.post('/api/cases', { title: 'Bildmarker', area: 'strafrecht', clientEmail: 'mia.marker' })).json.case;
  });
  after(() => srv.stop());

  const link = async (text) => {
    const r = await owner.post(`/api/cases/${kase.id}/external`, { provider: 'fivenet', input: String(7000 + Math.floor(Math.random() * 900)), attest: true, title: 'Bericht', contentText: text });
    assert.equal(r.status, 201, r.text);
    return r.json.document;
  };
  const up = async (docId, caption) =>
    (await owner.upload(`/api/cases/${kase.id}/attachments?caption=${encodeURIComponent(caption)}${docId ? `&fivenetDoc=${docId}` : ''}`, PNG, 'image/png')).json.attachment;

  it('Marker werden zu „[Bild → B7]“ – übrige Marker zu „[Bild]“, Bilder anderer Dokumente zählen nicht', async () => {
    const doc = await link('Anfang\n\n[Bild 1]\n\nMitte\n\n[Bild 2]\n\nEnde\n\n[Bild 3]\n\n[Bild 4]');
    const a = await up(doc.id, 'Skizze');
    const b = await up(doc.id, 'Standbild');
    const fremd = await up(null, 'Nicht aus diesem Dokument');
    const r = await owner.post(`/api/cases/${kase.id}/external/${doc.id}/image-marks`, {
      marks: [
        { n: 1, attachmentId: a.id },
        { n: 2, attachmentId: b.id },
        { n: 3, attachmentId: fremd.id },
        { n: 4, attachmentId: null },
      ],
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.linked, 2);
    assert.equal(r.json.contentText, `Anfang\n\n[Bild → B${a.no}]\n\nMitte\n\n[Bild → B${b.no}]\n\nEnde\n\n[Bild]\n\n[Bild]`);
    // gespeichert, aber ohne neuen Verlaufseintrag und ohne neuen Stand der Abschrift
    const saved = (await owner.get(`/api/cases/${kase.id}`)).json.externalDocs.find((d) => d.id === doc.id);
    assert.equal(saved.contentText, r.json.contentText);
    // ein zweiter Aufruf ändert nichts mehr (Marker sind schon ersetzt)
    const again = await owner.post(`/api/cases/${kase.id}/external/${doc.id}/image-marks`, { marks: [] });
    assert.equal(again.json.changed, false);
  });

  it('nur Kanzlei; Prüfung der Werte; nicht erreichbare Adresse meldet Fehler und eine leere Zuordnung', async () => {
    const doc = await link('Text [Bild 1]');
    assert.equal((await mandant.post(`/api/cases/${kase.id}/external/${doc.id}/image-marks`, { marks: [] })).status, 403);
    assert.equal((await owner.post(`/api/cases/${kase.id}/external/${doc.id}/image-marks`, { marks: [{ n: 0, attachmentId: 1 }] })).status, 400);
    assert.equal((await owner.post(`/api/cases/${kase.id}/external/${doc.id}/image-marks`, { marks: 'x' })).status, 400);
    const imgs = await owner.post(`/api/cases/${kase.id}/external/${doc.id}/images`, { urls: ['https://example.org/x.png'], captions: { 'https://example.org/x.png': 'Unterschrift' } });
    assert.equal(imgs.status, 200, imgs.text);
    assert.equal(imgs.json.imported, 0);
    assert.equal(imgs.json.failed.length, 1);
    assert.deepEqual(imgs.json.map, []);
  });
});

describe('FiveNet-Bilder im Dialog (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let admin;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    admin = client(srv.base);
    await admin.login(TEAM.admin);
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
    await page.waitForFunction(() => typeof fivenetProfilePanel === 'function');
  };

  const html = `<p>Der Fahrer wurde angehalten.</p>
    <p><img src="data:image/png;base64,${PNG_B64}" alt="Skizze Unfallort"></p>
    <p>Danach folgte die Kontrolle.</p>
    <figure><img src="data:image/png;base64,${PNG_B64}"><figcaption>Standbild Bodycam 14:02</figcaption></figure>
    <p>Fremdes Bild:</p><p><img src="https://evil.example/x.png" alt="Fremd"></p>`;

  for (const [name, viewport] of [['PC', { width: 1366, height: 900 }], ['Handy', { width: 390, height: 844 }]]) {
    it(`${name}: Einfügen mit Bildern → Marker mit Nummer, Unterschriften, nach dem Speichern „[Bild → B…]“ als Knopf`, async () => {
      const caseId = (await admin.post('/api/cases', { title: `Marker ${name}`, area: 'strafrecht', clientName: 'Max Marker' })).json.case.id;
      const ctx = await browser.newContext({ viewport, locale: 'de-DE', hasTouch: name === 'Handy' });
      const page = await ctx.newPage();
      await login(page);
      await page.evaluate((id) => openCase(id), caseId);
      await page.waitForSelector('[data-action="fn-add"]');
      await page.click('[data-action="fn-add"]');
      await page.waitForSelector('#fnContent');
      await page.evaluate((h) => {
        const dt = new DataTransfer();
        dt.setData('text/html', h);
        dt.setData('text/plain', 'x');
        document.querySelector('#fnContent').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, html);
      await page.waitForFunction(() => document.querySelector('#fnContent').value.includes('[Bild 2]'));
      const text = await page.inputValue('#fnContent');
      assert.match(text, /Der Fahrer wurde angehalten\.\s+\[Bild 1\]\s+Danach folgte die Kontrolle\.\s+\[Bild 2\]\s+Standbild Bodycam 14:02\s+Fremdes Bild:\s+\[Bild\]/, text);
      assert.equal(await page.locator('#fnPending .fn-thumb').count(), 2, 'zwei Bilder vorgemerkt, das fremde nicht');
      // zweites Einfügen zählt weiter (auch das fremde Bild hatte eine Nummer)
      await page.evaluate((h) => {
        const dt = new DataTransfer();
        dt.setData('text/html', h);
        dt.setData('text/plain', 'x');
        const area = document.querySelector('#fnContent');
        area.setSelectionRange(area.value.length, area.value.length);
        area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, `<p>Nachtrag</p><img src="data:image/png;base64,${PNG_B64}">`);
      await page.waitForFunction(() => document.querySelector('#fnContent').value.includes('[Bild 4]'));
      // dritte Marke wieder entfernen: das Bild fliegt raus, der Marker wird später zu „[Bild]“
      await page.click('#fnPending .fn-thumb:nth-child(3) .rm');
      assert.equal(await page.locator('#fnPending .fn-thumb').count(), 2);

      await page.fill('#fnInput', String(8100 + (name === 'PC' ? 1 : 2)));
      await page.check('input[name="attest"]');
      await page.click('form[data-form="ext-link"] button[type="submit"]');
      await page.waitForSelector('.fn-doc .fn-text summary', { timeout: 15000 });
      await page.click('.fn-doc .fn-text summary');
      await page.waitForSelector('.fn-pre .ev-ref', { timeout: 10000 });
      await page.waitForSelector('.fn-gallery .ev-no', { timeout: 10000 });

      const shown = await page.evaluate(() => ({
        text: document.querySelector('.fn-pre').textContent,
        refs: [...document.querySelectorAll('.fn-pre .ev-ref')].map((b) => b.textContent),
        badges: [...document.querySelectorAll('.fn-gallery .ev-no')].map((b) => b.textContent),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      assert.deepEqual(shown.refs, ['B1', 'B2']);
      assert.deepEqual(shown.badges, ['B1', 'B2']);
      assert.match(shown.text, /\[Bild → B1\][\s\S]*\[Bild → B2\][\s\S]*Fremdes Bild:\s*\[Bild\][\s\S]*Nachtrag\s*\[Bild\]/);
      assert.equal(shown.overflow, false, 'kein seitliches Scrollen');

      // Unterschriften: Alt-Text bzw. Bildunterschrift
      const atts = (await admin.get(`/api/cases/${caseId}`)).json.attachments;
      assert.deepEqual(atts.map((a) => a.caption), ['Skizze Unfallort', 'Standbild Bodycam 14:02']);

      // Klick auf den Verweis öffnet die Großansicht von B2
      await page.click('.fn-pre .ev-ref >> nth=1');
      await page.waitForSelector('.lightbox-img', { timeout: 8000 });
      assert.ok((await page.textContent('#modalBody')).includes('Beweismittel B2'));
      await ctx.close();
    });
  }

  it('Parser: Unterschrift aus Alt-Text, Bildunterschrift oder Titel – Dateinamen und Platzhalter zählen nicht; Nummerierung ab Startwert', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await login(page);
    const r = await page.evaluate(() => {
      const p = parsePastedHtml(
        '<img src="/api/filestore/a" alt="IMG_2041.png"><img src="/api/filestore/b" alt="Bild 3"><img src="/api/filestore/c" title="Tatort von Norden"><figure><img src="/api/filestore/d" alt="egal"><figcaption> Fahrzeug  vorn </figcaption></figure><img>',
        5
      );
      return { text: p.text, items: p.items.map((i) => [i.n, i.caption]) };
    });
    assert.deepEqual(r.items, [[5, ''], [6, ''], [7, 'Tatort von Norden'], [8, 'Fahrzeug vorn']]);
    assert.match(r.text, /\[Bild 5\]\s+\[Bild 6\]\s+\[Bild 7\]\s+\[Bild 8\]\s+Fahrzeug vorn\s+\[Bild\]/);
    await ctx.close();
  });
});
