'use strict';
/*
 * Word-Dateien für die Google Docs (docxRender.js): Sie müssen denselben Text enthalten wie die Druckansicht.
 * Für Verträge und Schriftsätze wird jede Standardvorlage einmal mit public/js/contract-render.js (wie im
 * Browser) und einmal mit docxRender.js erzeugt und Wort für Wort verglichen – so fällt auf, wenn eine der
 * beiden Stellen geändert wird und die andere nicht.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, docxText, readZipEntry } = require('./helpers');
const render = require('../docxRender');
const contracts = require('../contracts');

// contract-render.js wie im Browser laden (mit den beiden Helfern aus api.js)
function browserRenderer() {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const parseDate = (v) => (v ? new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z') : null);
  const window = { PS: { esc, parseDate } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'contract-render.js'), 'utf8'), { window });
  return window.PS.contract;
}

const words = (text) =>
  text
    .replace(/_{4,}/g, ' ') // leere Felder: im Browser eine Linie, in Word Unterstriche
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
const htmlWords = (html) =>
  words(
    html
      .replace(/<(?:br|\/?(?:p|div|h1|h2|h3))\b[^>]*>/g, ' ') // Zeilen- und Blockgrenzen
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );

const SAMPLE = {
  anwalt: 'Dr. Alois Pake',
  anwalt_rang: 'Founding Partner',
  anwalt_geburtsdatum: '12.03.1988',
  mandant: 'John Doe',
  mandant_geburtsdatum: '04.07.1995',
  leistungen: '• Vertretung Hauptverhandlung (alle Gerichte) – 100.000 $\n• U-Haft-Vertretung vor Ort – 50.000 $',
  grundgebuehr: '150.000 $',
  zusatzgebuehr: '',
  datum: '06.10.2026',
  ort: 'Los Santos, San Andreas',
  empfaenger: 'District Court San Andreas\nMission Row, Los Santos',
  betreff: 'Ermittlungsverfahren gegen John Doe',
  fivenet_az: 'DOC - 74412',
  festnahme: 'Festnahme am 01.10.2026',
  begruendung: 'Der Beschuldigte ist nicht vorbestraft.',
};
const CASE = { id: 1, caseNumber: 'PS-2026-0001', title: 'Beispielakte', area: 'Strafrecht', courtRef: 'DC-2026-0142', opponent: 'State of San Andreas' };
const OPTS = { fivenetUrl: 'https://fivenet.modernv.net' };
const HEADER = 'Atlee Street (8051)\nTel: 6026158184';
const valuesOf = (data) => ({ ...data, aktenzeichen: CASE.caseNumber, akte: CASE.title, rechtsgebiet: CASE.area, gerichtsaktenzeichen: CASE.courtRef, gegenpartei: CASE.opponent, kanzlei: 'Pake & Scha Legal Consulting' });
/** Links einer DOCX: Ziel-Adressen aus word/_rels/document.xml.rels, die im Text verwendet werden. */
function docxLinks(buf) {
  const rels = String(readZipEntry(buf, 'word/_rels/document.xml.rels') || '');
  const xml = String(readZipEntry(buf, 'word/document.xml') || '');
  return [...xml.matchAll(/<w:hyperlink [^>]*r:id="([^"]+)"[^>]*>(.*?)<\/w:hyperlink>/g)].map(([, id, inner]) => ({
    url: (rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`)) || [])[1],
    text: inner.replace(/<[^>]+>/g, ''),
  }));
}

describe('Word-Dateien für Google Docs', () => {
  const browser = browserRenderer();

  for (const t of contracts.DEFAULT_TEMPLATES) {
    for (const variant of ['unterschrieben', 'leer']) {
      it(`${t.name} (${variant}): gleicher Text wie die Druckansicht`, async () => {
        const signed = variant === 'unterschrieben';
        const k = {
          kind: t.kind,
          templateName: t.name,
          body: t.body,
          data: signed ? SAMPLE : {},
          lawyerSignature: signed ? 'Dr. Alois Pake' : null,
          lawyerSignedAt: signed ? '2026-10-06 10:15:00' : null,
          clientSignature: signed ? 'John Doe' : null,
          clientSignedAt: signed ? '2026-10-06 11:20:00' : null,
          clientSignedVia: signed ? 'portal' : null,
          coLawyers: signed && t.kind !== 'schriftsatz' ? [{ name: 'Maxine Scha', rank: 'Equity Partner', birth: '21.09.1990', signature: 'Maxine Scha', signedAt: '2026-10-06 10:30:00' }] : [],
        };
        const html = browser.render(k.body, valuesOf(k.data), k, OPTS).join(' ');
        const buf = await render.contractDocx(k, CASE, HEADER, OPTS);
        // Uhrzeiten der Unterschriften: Browser hier in UTC, Word in deutscher Zeit – Zahlen der Uhrzeit nicht vergleichen
        const norm = (w) => w.map((x) => x.replace(/^\d\d:\d\d$/, 'HH:MM'));
        assert.deepEqual(norm(words(docxText(buf))), norm(htmlWords(html)));
      });
    }
  }

  it('FiveNet-Aktenzeichen „DOC - Nummer“ ist in Druckansicht und Google Doc ein Link auf das Dokument', async () => {
    const t = contracts.DEFAULT_TEMPLATES.find((x) => x.key === 'akteneinsicht');
    const doc = (data) => ({ kind: 'schriftsatz', templateName: t.name, body: t.body, data, coLawyers: [] });
    const html = (data, opts) => browser.render(t.body, valuesOf(data), doc(data), opts).join(' ');
    const links = async (data, opts) => docxLinks(await render.contractDocx(doc(data), CASE, HEADER, opts));

    assert.match(html({ fivenet_az: 'DOC - 74412' }, OPTS), /<a class="k-val k-link" href="https:\/\/fivenet\.modernv\.net\/documents\/74412" target="_blank" rel="noopener noreferrer"[^>]*>DOC - 74412<\/a>/);
    assert.deepEqual(await links({ fivenet_az: 'DOC - 74412' }, OPTS), [{ url: 'https://fivenet.modernv.net/documents/74412', text: 'DOC - 74412' }]);
    // Manuelles Aktenzeichen, fehlende oder unsichere Instanz-Adresse: nur Text, kein Link
    for (const [data, opts] of [
      [{ fivenet_az: 'DC-2026-0142' }, OPTS],
      [{ fivenet_az: 'DOC - 74412' }, {}],
      [{ fivenet_az: 'DOC - 74412' }, { fivenetUrl: 'javascript:alert(1)//' }],
    ]) {
      assert.ok(!/<a\b/.test(html(data, opts)), JSON.stringify([data, opts]));
      assert.deepEqual(await links(data, opts), [], JSON.stringify([data, opts]));
      assert.ok(html(data, opts).includes(data.fivenet_az));
    }
  });

  it('Blocksatz: mehrzeilige Werte (z. B. Empfänger) stehen zeilenweise in eigenen Absätzen', async () => {
    // Word und Google Docs würden eine Zeile vor einem Zeilenumbruch im Blocksatz über die ganze Breite ziehen
    for (const t of contracts.DEFAULT_TEMPLATES) {
      const k = { kind: t.kind, templateName: t.name, body: t.body, data: SAMPLE, coLawyers: [] };
      const xml = String(readZipEntry(await render.contractDocx(k, CASE, HEADER, OPTS), 'word/document.xml'));
      const justifiedWithBreak = xml.split('</w:p>').filter((p) => p.includes('<w:jc w:val="both"/>') && p.includes('<w:br/>'));
      assert.deepEqual(justifiedWithBreak, [], t.name);
    }
    const t = contracts.DEFAULT_TEMPLATES.find((x) => x.key === 'akteneinsicht');
    const text = docxText(await render.contractDocx({ kind: t.kind, templateName: t.name, body: t.body, data: SAMPLE, coLawyers: [] }, CASE, HEADER, OPTS));
    assert.match(text, /^District Court San Andreas\nMission Row, Los Santos\n/m);
  });

  it('Rechnung: alle Angaben und Beträge', async () => {
    const inv = {
      kind: 'rechnung',
      number: 'RE-2026-0042',
      createdAt: '2026-10-06 09:00:00',
      caseNumber: 'PS-2026-0001',
      dueDate: '2026-10-20',
      clientName: 'John Doe',
      clientContact: 'john@pake-scha.ls',
      issuerName: 'Dr. Alois Pake',
      issuerRank: 'Founding Partner',
      subject: 'Vertretung Hauptverhandlung',
      items: [{ description: 'Hauptverhandlung', quantity: 2, unitPrice: 100000 }],
      subtotal: 200000,
      discountPct: 10,
      discountAmount: 20000,
      total: 180000,
      status: 'storniert',
    };
    const text = docxText(await render.invoiceDocx(inv, { address: 'Pake & Scha Legal Consulting\nWürfelpark', contact: 'kontakt@pake-scha.ls', paymentInfo: 'Zahlbar per Überweisung (Maze Bank).' }));
    for (const s of ['Rechnung', 'RE-2026-0042', '6.10.2026', '20.10.2026', 'John Doe', 'Betreff: Vertretung Hauptverhandlung', '200.000 $', 'Rabatt (10 %)', '− 20.000 $', 'Gesamtbetrag', '180.000 $', 'STORNIERT', 'Zahlbar per Überweisung (Maze Bank).', 'Mit freundlichen Grüßen']) {
      assert.ok(text.includes(s), `fehlt: ${s}`);
    }
  });
});
