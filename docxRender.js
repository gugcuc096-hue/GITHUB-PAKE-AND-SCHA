'use strict';
/*
 * Word-Dateien (DOCX) im Layout der Druckansichten – Grundlage für die Google Docs: Google wandelt die Datei
 * beim Hochladen in ein Google Doc um (googleDocs.js). Aufbau, Schriften, Größen und Farben folgen
 * invoice.html, vertrag.html (+ contract-render.js) und aktenauszug.html.
 *
 * Was Google Docs nicht kann, ist so nah wie möglich nachgebaut: einfarbiger Goldbalken statt Farbverlauf,
 * gerader statt schräger Stempel, Tabellen ohne Rahmen statt CSS-Raster, Großbuchstaben direkt im Text
 * (Google übernimmt weder „Kapitälchen“ noch Zeichenabstand).
 */
const fs = require('fs');
const path = require('path');
const D = require('docx');

const LOGO = fs.readFileSync(path.join(__dirname, 'public', 'img', 'logo.png'));
const TZ = 'Europe/Berlin';

/* ---------------------------------------------------------------- Einheiten */
const hp = (pt) => Math.round(pt * 2); // Schriftgröße in halben Punkt
const tw = (pt) => Math.round(pt * 20); // Abstände in twip (1/20 Punkt)
const mm = (v) => Math.round(v * 56.6929); // Millimeter → twip
const rem = (v) => v * 12; // 1rem = 16px = 12pt
const eighths = (pt) => Math.max(2, Math.round(pt * 8)); // Linienstärke in 1/8 Punkt
// CSS line-height bezieht sich auf die Schriftgröße, Word/Google auf die natürliche Zeilenhöhe der Schrift.
const NATURAL_LINE = { Inter: 1.24, 'JetBrains Mono': 1.32, Tinos: 1.15, 'Roboto Serif': 1.18, 'Cormorant Garamond': 1.21 };
const lineMul = (cssLineHeight, font) => Math.round((cssLineHeight / (NATURAL_LINE[font] || 1.15)) * 240);

/* ---------------------------------------------------------------- Formatierung wie im Browser */
function parseDate(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
const dateDe = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('de-DE', { timeZone: TZ }) : '—';
};
const dayDe = (s) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '—');
const fmtDate = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '—';
};
const dateTime = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
};
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} $`;
const pct = (n) => String(n).replace('.', ',');

/* ---------------------------------------------------------------- Bausteine */
const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const CELL_NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const line = (pt, color) => ({ style: D.BorderStyle.SINGLE, size: eighths(pt), color, space: 0 });

/** Textstücke; Zeilenumbrüche im Text werden zu Umbrüchen im Absatz. */
function runs(text, o = {}) {
  return String(text ?? '')
    .split('\n')
    .map(
      (t, i) =>
        new D.TextRun({
          text: t,
          break: i ? 1 : undefined,
          font: o.font,
          size: o.size ? hp(o.size) : undefined,
          bold: o.bold || undefined,
          italics: o.italic || undefined,
          color: o.color,
          underline: o.underline ? { type: D.UnderlineType.SINGLE, color: o.underlineColor } : undefined,
          shading: o.highlight ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.highlight } : undefined,
        })
    );
}

function para(children, o = {}) {
  return new D.Paragraph({
    children: Array.isArray(children) ? children : runs(children, o),
    alignment: o.align,
    spacing: {
      before: tw(o.before || 0),
      after: tw(o.after || 0),
      ...(o.line ? { line: lineMul(o.line, o.font), lineRule: D.LineRuleType.AUTO } : {}),
    },
    border: o.border,
    shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    indent: o.indent,
    keepNext: o.keepNext || undefined,
    keepLines: o.keepLines || undefined,
    tabStops: o.tabStops,
    pageBreakBefore: o.pageBreakBefore || undefined,
    // Absatzmarke in derselben Größe wie der Text – sonst bestimmt bei leeren Absätzen die Standardgröße die Höhe
    run: o.mark || o.size ? { size: hp(o.mark || o.size), font: o.font } : undefined,
  });
}

/** Leerer Absatz als Abstand (Google übernimmt Abstände in Punkt zuverlässiger als feste Zeilenhöhen). */
const spacer = (pt) => para([new D.TextRun({ text: '', size: 2 })], { before: pt, mark: 1 });

function cell(children, o = {}) {
  return new D.TableCell({
    children: [].concat(children).length ? [].concat(children) : [para('')],
    width: o.width ? { size: o.width, type: D.WidthType.DXA } : undefined,
    borders: { ...CELL_NO_BORDERS, ...(o.borders || {}) },
    margins: { top: tw(o.pt || 0), bottom: tw(o.pb || 0), left: tw(o.pl ?? 0), right: tw(o.pr ?? 0) },
    verticalAlign: o.valign,
    shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    columnSpan: o.span,
  });
}

function table(rows, widths, o = {}) {
  return new D.Table({
    rows: rows.map((r) => (r instanceof D.TableRow ? r : new D.TableRow({ children: r, cantSplit: o.cantSplit || undefined }))),
    width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA },
    columnWidths: widths,
    layout: D.TableLayoutType.FIXED,
    borders: NO_BORDERS,
    alignment: o.align,
  });
}

function logo(heightPx = 60) {
  return new D.ImageRun({ type: 'png', data: LOGO, transformation: { width: Math.round((heightPx * 275) / 512), height: heightPx } });
}

async function pack(doc) {
  return D.Packer.toBuffer(doc);
}

/* ================================================================
   Kopf wie auf Rechnung und Aktenauszug: Logo, „Pake & Scha“, Anschrift rechts
   ================================================================ */
const INK = '0F172A';
const MUTED = '55607A';
const GOLD = 'B8962E';
const HAIR = 'E5E1D3';

function firmHead(firm, contentWidth) {
  const addrW = mm(70);
  const logoW = mm(12);
  return table(
    [
      [
        cell(para([logo(60)]), { width: logoW, valign: D.VerticalAlign.CENTER, pb: rem(1.25), borders: { bottom: line(0.75, HAIR) } }),
        cell(
          [
            para('Pake & Scha', { font: 'Cormorant Garamond', size: rem(1.6), bold: true, color: INK, line: 1.1 }),
            para('LEGAL CONSULTING & ADVOCACY', { font: 'Inter', size: rem(0.62), color: GOLD, before: 1.5 }),
          ],
          { width: contentWidth - addrW - logoW, valign: D.VerticalAlign.CENTER, pl: rem(0.85) * 0.75, pb: rem(1.25), borders: { bottom: line(0.75, HAIR) } }
        ),
        cell(para(`${firm.address || ''}${firm.contact ? '\n' + firm.contact : ''}`, { font: 'Inter', size: rem(0.78), color: MUTED, align: D.AlignmentType.RIGHT, line: 1.5 }), {
          width: addrW,
          valign: D.VerticalAlign.TOP,
          pb: rem(1.25),
          borders: { bottom: line(0.75, HAIR) },
        }),
      ],
    ],
    [logoW, contentWidth - addrW - logoW, addrW]
  );
}

/** Kennzahlen rechts neben der Überschrift (Nummer, Datum …): Bezeichnung grau, Wert in Mono rechtsbündig. */
function metaCells(pairs, size, labelW, valueW) {
  const lines = (pick, o) => pairs.map((p) => para(pick(p), { font: o.font, size, color: o.color, align: o.align, after: rem(0.15) }));
  return [
    cell(lines((p) => p[0], { font: 'Inter', color: MUTED }), { width: labelW, valign: D.VerticalAlign.BOTTOM }),
    cell(lines((p) => p[1], { font: 'JetBrains Mono', color: INK, align: D.AlignmentType.RIGHT }), { width: valueW, valign: D.VerticalAlign.BOTTOM }),
  ];
}

/* ================================================================
   Rechnung / Honorarvereinbarung (invoice.html)
   ================================================================ */
const KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };

async function invoiceDocx(inv, firm) {
  const hv = inv.kind === 'honorarvereinbarung';
  const pageW = 11906; // A4
  const margin = mm(16);
  const W = pageW - 2 * margin;
  const body = [];

  // Stempel (im Browser schräg über dem Kopf) – hier gerade, rechts neben der Überschrift
  const stamp = inv.status === 'bezahlt' ? ['BEZAHLT', '047857'] : inv.status === 'storniert' ? ['STORNIERT', 'B91C1C'] : null;

  body.push(firmHead(firm, W));

  // Überschrift + Kennzahlen
  const meta = [
    ['Nummer', inv.number],
    ['Datum', dateDe(inv.createdAt)],
    ...(inv.caseNumber ? [['Aktenzeichen', inv.caseNumber]] : []),
    ...(inv.dueDate && !hv ? [['Zahlbar bis', dayDe(inv.dueDate)]] : []),
    ...(inv.dueDate && hv ? [['Vorschuss fällig', dayDe(inv.dueDate)]] : []),
  ];
  const labelW = mm(30);
  const valueW = mm(34);
  const stampW = stamp ? mm(42) : 0;
  const titleCells = [
    cell(para(KIND[inv.kind] || 'Rechnung', { font: 'Cormorant Garamond', size: rem(2.1), bold: true, color: INK, line: 1 }), {
      width: W - labelW - valueW - stampW,
      valign: D.VerticalAlign.BOTTOM,
    }),
  ];
  if (stamp) {
    titleCells.push(
      cell(
        para(stamp[0], {
          font: 'Inter',
          size: rem(1.3),
          bold: true,
          color: stamp[1],
          align: D.AlignmentType.CENTER,
          border: { top: line(2.25, stamp[1]), bottom: line(2.25, stamp[1]), left: line(2.25, stamp[1]), right: line(2.25, stamp[1]) },
        }),
        { width: stampW, valign: D.VerticalAlign.CENTER, pl: 6, pr: 14 }
      )
    );
  }
  titleCells.push(...metaCells(meta, rem(0.82), labelW, valueW));
  body.push(spacer(rem(1.75)), table([titleCells], [W - labelW - valueW - stampW, ...(stamp ? [stampW] : []), labelW, valueW]), spacer(rem(1.25)));

  // Parteien
  const label = (t) => para(t.toUpperCase(), { font: 'Inter', size: rem(0.64), bold: true, color: GOLD, after: rem(0.35) });
  // Name fett, darunter weitere Zeilen (Kontakt bzw. Rang und Kanzlei)
  const party = (name, rest) =>
    para([...runs(name, { font: 'Inter', size: rem(1), bold: true, color: INK }), ...runs(rest.map((t) => `\n${t}`).join(''), { font: 'Inter', size: rem(0.9), color: INK }).slice(1)], { line: 1.5, font: 'Inter' });
  const half = Math.round((W - mm(8)) / 2);
  body.push(
    table(
      [
        [
          cell([label(hv ? 'Mandant' : 'Rechnungsempfänger'), party(inv.clientName || '', inv.clientContact ? String(inv.clientContact).split('\n') : [])], { width: half }),
          cell(para(''), { width: W - 2 * half }),
          cell([label(hv ? 'Beauftragte Kanzlei' : 'Bearbeitet von'), party(inv.issuerName || 'Pake & Scha', [...(inv.issuerRank ? [inv.issuerRank] : []), 'Pake & Scha Legal Consulting'])], { width: half }),
        ],
      ],
      [half, W - 2 * half, half]
    ),
    spacer(rem(1.5))
  );

  if (inv.subject) {
    body.push(
      para([...runs(`${hv ? 'Gegenstand der Vereinbarung' : 'Betreff'}: `, { font: 'Inter', size: rem(0.9), bold: true, color: INK }), ...runs(inv.subject, { font: 'Inter', size: rem(0.9), color: INK })], {
        fill: 'FAF8F1',
        border: { left: { style: D.BorderStyle.SINGLE, size: eighths(2.25), color: GOLD, space: 8 } },
        indent: { left: tw(rem(0.9)), right: tw(rem(0.9)) },
        before: 0,
        after: rem(1.25),
        line: 1.9,
        font: 'Inter',
      })
    );
  }
  if (hv) {
    body.push(
      para('Zwischen dem oben genannten Mandanten und der Kanzlei Pake & Scha Legal Consulting wird für die anwaltliche Tätigkeit folgende Vergütung vereinbart:', {
        font: 'Inter',
        size: rem(0.86),
        color: INK,
        line: 1.55,
        after: rem(1),
      })
    );
  }

  // Positionen
  const colW = [0, mm(18), mm(30), mm(32)];
  colW[0] = W - colW[1] - colW[2] - colW[3];
  const th = (t, right) =>
    cell(para(t.toUpperCase(), { font: 'Inter', size: rem(0.66), bold: true, color: MUTED, align: right ? D.AlignmentType.RIGHT : undefined }), {
      pt: rem(0.5),
      pb: rem(0.5),
      pl: rem(0.4),
      pr: rem(0.4),
      borders: { bottom: line(1.125, INK) },
    });
  const td = (t, num) =>
    cell(para(t, { font: num ? 'JetBrains Mono' : 'Inter', size: rem(0.86), color: INK, align: num ? D.AlignmentType.RIGHT : undefined }), {
      pt: rem(0.65),
      pb: rem(0.65),
      pl: rem(0.4),
      pr: rem(0.4),
      borders: { bottom: line(0.75, HAIR) },
    });
  body.push(
    table(
      [
        new D.TableRow({ tableHeader: true, children: [th('Leistung'), th('Menge', true), th('Einzelpreis', true), th('Betrag', true)] }),
        ...(inv.items || []).map((it) => [td(it.description), td(String(it.quantity), true), td(money(it.unitPrice), true), td(money(it.quantity * it.unitPrice), true)]),
      ],
      colW
    )
  );

  // Summen (rechts, 300px breit)
  const totW = Math.min(W, tw(225));
  const totRow = (l, v, o = {}) => [
    cell(para(l, { font: 'Inter', size: o.size || rem(0.88), bold: o.bold, color: INK }), { width: totW - mm(32), pt: o.pt ?? rem(0.3), pb: rem(0.3), borders: o.borders }),
    cell(para(v, { font: o.mono === false ? 'Inter' : 'JetBrains Mono', size: o.size || rem(0.88), bold: o.bold, color: o.color || INK, align: D.AlignmentType.RIGHT }), {
      width: mm(32),
      pt: o.pt ?? rem(0.3),
      pb: rem(0.3),
      borders: o.borders,
    }),
  ];
  const totals = [totRow('Zwischensumme', money(inv.subtotal))];
  if (inv.memberAmount) totals.push(totRow(`${inv.membershipName} (${pct(inv.memberPct)} %)`, `− ${money(inv.memberAmount)}`));
  if (inv.coopAmount) totals.push(totRow(`Kooperationsrabatt ${inv.cooperationName} (${pct(inv.coopPct)} %)`, `− ${money(inv.coopAmount)}`));
  if (inv.discountAmount) totals.push(totRow(`Rabatt (${pct(inv.discountPct)} %)`, `− ${money(inv.discountAmount)}`));
  if (inv.surchargeAmount) totals.push(totRow(`Zuschlag (${pct(inv.surchargePct)} %)`, `+ ${money(inv.surchargeAmount)}`));
  totals.push(totRow(hv ? 'Vereinbartes Honorar' : 'Gesamtbetrag', money(inv.total), { size: rem(1.15), bold: true, color: GOLD, pt: rem(0.6), borders: { top: line(1.125, INK) } }));
  if (inv.memberAmount && !inv.total) {
    totals.push([
      cell(para(`Vollständig abgedeckt durch ${inv.membershipName}`, { font: 'Inter', size: rem(0.8), italic: true, color: INK, align: D.AlignmentType.RIGHT }), { span: 2, width: totW, pt: rem(0.3) }),
    ]);
  }
  body.push(spacer(rem(1)), table(totals, [totW - mm(32), mm(32)], { align: D.AlignmentType.RIGHT }));

  if (inv.notes) body.push(para(inv.notes, { font: 'Inter', size: rem(0.86), color: INK, line: 1.55, before: rem(1.5) }));
  if (!hv && firm.paymentInfo) body.push(para(firm.paymentInfo, { font: 'Inter', size: rem(0.82), color: MUTED, before: rem(1.25) }));

  if (hv) {
    const sw = Math.round((W - tw(rem(2.5))) / 2);
    const sig = (t) => cell(para(t, { font: 'Inter', size: rem(0.78), color: MUTED }), { width: sw, pt: rem(0.4), borders: { top: line(0.75, INK) } });
    body.push(spacer(rem(3)), table([[sig('Ort, Datum · Unterschrift Mandant'), cell(para(''), { width: W - 2 * sw }), sig('Ort, Datum · Pake & Scha Legal Consulting')]], [sw, W - 2 * sw, sw]));
  } else {
    body.push(
      para('Mit freundlichen Grüßen', { font: 'Inter', size: rem(0.86), color: INK, before: rem(2) }),
      para(inv.issuerName || 'Pake & Scha', { font: 'Cormorant Garamond', size: rem(1.25), bold: true, color: INK }),
      para(`${inv.issuerRank ? inv.issuerRank + ' · ' : ''}Pake & Scha Legal Consulting`, { font: 'Inter', size: rem(0.86), color: INK })
    );
  }

  // Fußzeile am Ende des Dokuments (wie im Browser)
  body.push(
    para([...runs('Pake & Scha Legal Consulting · Würfelpark, Los Santos', { font: 'Inter', size: rem(0.7), color: MUTED }), new D.TextRun({ text: '\t' }), ...runs(inv.number, { font: 'Inter', size: rem(0.7), color: MUTED })], {
      before: rem(2.5),
      border: { top: { style: D.BorderStyle.SINGLE, size: eighths(0.75), color: HAIR, space: 9 } },
      tabStops: [{ type: D.TabStopType.RIGHT, position: W }],
    })
  );

  return pack(
    new D.Document({
      creator: 'Pake & Scha Legal Consulting',
      title: `${KIND[inv.kind] || 'Rechnung'} ${inv.number}`,
      styles: { default: { document: { run: { font: 'Inter', size: hp(10.5), color: INK } } } },
      sections: [
        {
          properties: {
            titlePage: true,
            page: { size: { width: pageW, height: 16838 }, margin: { top: mm(16), bottom: mm(16), left: margin, right: margin, header: mm(5), footer: mm(8) } },
          },
          // Goldbalken oben auf der ersten Seite (im Browser ein Farbverlauf)
          headers: { first: new D.Header({ children: [para([new D.TextRun({ text: '', size: 2 })], { border: { bottom: { style: D.BorderStyle.SINGLE, size: 30, color: 'C9A633', space: 0 } } })] }), default: new D.Header({ children: [para('')] }) },
          children: body,
        },
      ],
    })
  );
}

/* ================================================================
   Verträge & Schriftsätze (vertrag.html + public/js/contract-render.js)
   Die Zeilenregeln unten entsprechen contract-render.js – bei Änderungen dort bitte hier mitziehen.
   ================================================================ */
const K_GOLD = 'B8975A';
const K_INK = '000000';
const K_MUTED = '666666';
const K_SOFT = '1A1A1A';
const OPTIONAL_LINES = new Set(['begruendung']);
const CO_DIRECTIVE = /^\[weitere anw(?:ä|ae)lte\]$/i;
const coLawyersOf = (sig) => (sig && Array.isArray(sig.coLawyers) ? sig.coLawyers : []);

/** Platzhalterwerte wie in vertrag.js: Vertragsdaten und Angaben aus der Akte. */
function contractValues(k, c) {
  return { ...k.data, aktenzeichen: c.caseNumber, akte: c.title, rechtsgebiet: c.area, gerichtsaktenzeichen: c.courtRef || '', gegenpartei: c.opponent || '', kanzlei: 'Pake & Scha Legal Consulting' };
}

// FiveNet-Aktenzeichen „DOC - 74412“ → Link auf das Dokument; Adresse immer aus der Instanz der Kanzlei (wie contract-render.js)
const FIVENET_REF = /^DOC - (\d{1,19})$/;
const K_LINK = '1A4FA0';
function fivenetLink(value, opts) {
  const m = String(value).match(FIVENET_REF);
  const base = opts && String(opts.fivenetUrl || '').replace(/\/+$/, '');
  return m && /^https?:\/\/[^\s"'<>]+$/i.test(base) ? `${base}/documents/${m[1]}` : '';
}

// Zeilenende in mehrzeiligen Werten, wenn der Absatz zeilenweise aufgeteilt wird (opts.split in inlineRuns)
const LINE_END = Symbol('Zeilenende');

/** Leeres Feld zum Ausfüllen (im Browser eine Linie von 38 mm). */
function blankRun(o) {
  const size = o.size || 11;
  return new D.TextRun({ text: '_'.repeat(Math.max(8, Math.round(108 / (size * 0.5)))), font: o.font, size: hp(size), color: '444444' });
}

/**
 * **fett**, *kursiv* und {{platzhalter}} mit denselben regulären Ausdrücken wie contract-render.js – statt
 * HTML-Tags entstehen Textstücke mit Formatierung. Werte werden (wie dort) erst danach eingesetzt, Sternchen
 * in Werten lösen also keine Formatierung aus.
 */
function inlineRuns(raw, values, base, opts = {}) {
  const [B1, B0, I1, I0, P1, P0] = ['\u0001', '\u0002', '\u0003', '\u0004', '\u0005', '\u0006'];
  let s = String(raw)
    .replace(/[\u0001-\u0006]/g, '')
    .replace(/\*\*(.+?)\*\*/g, `${B1}$1${B0}`)
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, `$1${I1}$2${I0}`);
  s = s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m) => `${P1}${m}${P0}`);
  const out = [];
  let bold = false;
  let italic = false;
  let buf = '';
  const style = () => ({ ...base, bold: bold || base.bold, italic, size: bold && base.boldSize ? base.boldSize : base.size });
  const flush = () => {
    if (buf) out.push(...runs(buf, style()));
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === B1 || ch === B0) {
      flush();
      bold = ch === B1;
    } else if (ch === I1 || ch === I0) {
      flush();
      italic = ch === I1;
    } else if (ch === P1) {
      flush();
      const end = s.indexOf(P0, i);
      const m = s.slice(i + 1, end);
      i = end;
      const key = m.replace(/^\{\{\s*|\s*\}\}$/g, '').toLowerCase();
      if (!(key in values)) out.push(...runs(m, { ...style(), color: '991B1B', highlight: 'FEE2E2' }));
      else {
        const v = String(values[key] ?? '').trim();
        const href = key === 'fivenet_az' && fivenetLink(v, opts);
        if (href) out.push(new D.ExternalHyperlink({ link: href, children: runs(v, { ...style(), color: K_LINK, underline: true }) }));
        else if (!v) out.push(blankRun(style()));
        else if (opts.split) v.split('\n').forEach((line, j) => out.push(...(j ? [LINE_END] : []), ...runs(line, style())));
        else out.push(...runs(v, style()));
      }
    } else buf += ch;
  }
  flush();
  return out;
}

/** Zerlegt den Vertragstext in Seiten und Bausteine – Regeln wie render() in contract-render.js. */
function contractPages(body, values, sig) {
  const pages = [[]];
  let signed = false;
  const push = (b) => pages[pages.length - 1].push(b);
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  let coAfter = -1;
  if (coLawyersOf(sig).length && !lines.some((l) => CO_DIRECTIVE.test(l.trim()))) {
    coAfter = lines.findIndex((l) => /^\|/.test(l.trim()) && /\{\{\s*anwalt_geburtsdatum\s*\}\}/i.test(l));
  }
  lines.forEach((raw, i) => {
    const ln = raw.replace(/\s+$/, '');
    const t = ln.trim();
    let m;
    let opt;
    if (t === '===') pages.push([]);
    else if (/^\[unterschriften\]$/i.test(t)) {
      push({ type: 'sign', who: 'both' });
      signed = true;
    } else if (/^\[unterschrift anwalt\]$/i.test(t)) {
      push({ type: 'sign', who: 'lawyer' });
      signed = true;
    } else if (/^\[unterschrift mandant\]$/i.test(t)) {
      push({ type: 'sign', who: 'client' });
      signed = true;
    } else if (CO_DIRECTIVE.test(t)) push({ type: 'co' });
    else if ((opt = t.match(/^\{\{\s*([a-z_]+)\s*\}\}$/i)) && OPTIONAL_LINES.has(opt[1].toLowerCase()) && !String(values[opt[1].toLowerCase()] ?? '').trim()) {
      /* freier Text leer → Absatz entfällt */
    } else if (!t) push({ type: 'space' });
    else if ((m = ln.match(/^#\s+(.*)$/))) push({ type: 'title', text: m[1] });
    else if ((m = ln.match(/^##\s+(.*)$/))) push({ type: 'section', text: m[1] });
    else if ((m = ln.match(/^###\s+(.*)$/))) push({ type: 'para', text: m[1] });
    else if ((m = ln.match(/^\|\s?(.*)$/))) {
      const cc = m[1].trim();
      push(!cc ? { type: 'gap' } : { type: 'center', text: cc, between: /^-\s*[a-zäöü]+\s*-$/i.test(cc) });
    } else if ((m = ln.match(/^(\d{1,3})\.\s+(.*)$/))) push({ type: 'item', num: m[1], text: m[2] });
    else if ((m = ln.match(/^(?: {2,}|\t)\s*(.*)$/))) push({ type: 'indent', text: m[1] });
    else push({ type: 'p', text: ln });
    if (i === coAfter) push({ type: 'co' });
  });
  if (!signed) push({ type: 'sign', who: sig && sig.kind === 'schriftsatz' ? 'lawyer' : 'both' });
  return pages.filter((p) => p.some((b) => b.type !== 'space'));
}

/** Schreibschrift verkleinern, bis der Name ins Feld passt (im Browser misst fitSignatures die Breite). */
function fitScript(text, basePt, avgEm, widthPt) {
  const need = String(text || '').length * basePt * avgEm;
  return need <= widthPt ? basePt : Math.max(12 * 0.75, Math.floor((basePt * widthPt) / need));
}

/** Unterschriftsfelder wie signatures() in contract-render.js. */
function signatureBlock(values, sig, who, W) {
  const v = (key) => String(values[key] ?? '').trim();
  const clientSigned = sig && sig.clientSignature;
  const clientNote = clientSigned
    ? sig.clientSignedVia === 'kanzlei'
      ? `im Spiel unterschrieben · erfasst am ${dateTime(sig.clientSignedAt)}${sig.clientRecordedByName ? ' von ' + sig.clientRecordedByName : ''}`
      : `digital unterschrieben am ${dateTime(sig.clientSignedAt)}`
    : '';
  const lawyers = [{ name: v('anwalt'), rank: v('anwalt_rang'), signature: sig && sig.lawyerSignature, signedAt: sig && sig.lawyerSignedAt }, ...coLawyersOf(sig)];
  const gap = mm(16);
  const colW = Math.round((W - gap) / 2);
  const colPt = colW / 20 - 2 * 2.83; // Feldbreite abzüglich Innenabstand (2 mm je Seite)
  const block = (o, first) => {
    const size = fitScript(o.signature, o.lawyer ? 26 : 23, o.lawyer ? 0.36 : 0.42, colPt);
    const scriptLine = (o.lawyer ? 26 : 23) * 1.25;
    return [
      para(o.signature ? runs(o.signature, { font: o.lawyer ? 'Allura' : 'Dancing Script', size, color: o.lawyer ? '0000FF' : K_INK }) : [new D.TextRun({ text: '' })], {
        before: (first ? 0 : 12 / 0.3528) + Math.max(0, 15 / 0.3528 - scriptLine),
        mark: o.lawyer ? 26 : 23,
        font: o.lawyer ? 'Allura' : 'Dancing Script',
        indent: { left: mm(2) },
        keepNext: true,
      }),
      para(o.name, { font: 'Roboto Serif', size: 10.5, bold: true, color: K_INK, border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: '333333', space: 6 } }, keepNext: true }),
      para(o.role, { font: 'Roboto Serif', size: 9, color: K_MUTED, keepNext: true }),
      para(o.note, { font: 'Inter', size: 8, color: '888888', before: 1.5 / 0.3528 }),
    ];
  };
  const lawyerBlocks = lawyers.flatMap((l, i) =>
    block(
      {
        lawyer: true,
        signature: l.signature,
        name: l.name || 'Anwalt',
        role: `${l.rank ? l.rank + ', ' : ''}Pake & Scha Legal Consulting`,
        note: l.signature ? `digital unterschrieben am ${dateTime(l.signedAt)}` : 'Unterschrift Anwalt',
      },
      i === 0
    )
  );
  const clientBlock = block(
    {
      lawyer: false,
      signature: clientSigned ? sig.clientSignature : '',
      name: v('mandant') || 'Mandant',
      role: who === 'client' ? 'Vollmachtgeber / Mandant' : 'Mandant',
      note: clientNote || 'Unterschrift Mandant',
    },
    true
  );
  const placeRuns = (o) => (v('ort') ? runs(v('ort'), o) : [blankRun(o)]);
  const dateRuns = (o) => (v('datum') ? runs(v('datum'), { ...o, bold: true }) : [blankRun(o)]);
  const so = { font: 'Roboto Serif', size: 10.5, color: K_INK };
  const placeLine =
    who === 'both'
      ? [...runs('Unterzeichnet in ', so), ...placeRuns(so), ...runs(' am ', so), ...dateRuns(so)]
      : [...placeRuns(so), ...runs(', den ', so), ...dateRuns(so)];
  const left = who === 'client' ? clientBlock : lawyerBlocks;
  const right = who === 'both' ? clientBlock : [para('')];
  return {
    top: 10,
    bottom: 0,
    make: (before, pageBreak) => [
      para(placeLine, { before, after: 16 / 0.3528, keepNext: true, pageBreakBefore: pageBreak, font: 'Roboto Serif', mark: 10.5 }),
      table(
        [
          [
            cell(left, { width: colW, pl: 0, pr: 0 }),
            cell(para(''), { width: W - 2 * colW }),
            cell(right, { width: colW }),
          ],
        ],
        [colW, W - 2 * colW, colW],
        { cantSplit: true }
      ),
    ],
  };
}

/** Kopfzeile jeder Seite: Kanzlei links (gold), Anschrift rechts, darunter eine graue Linie. */
function contractHeader(headerText, W) {
  const lines = String(headerText || '').split('\n');
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const addrW = Math.min(Math.round(W / 2), Math.max(mm(30), tw(longest * 10 * 0.52 + 6)));
  const bottom = { bottom: line(0.75, '9A9A9A') };
  return new D.Header({
    children: [
      table(
        [
          [
            cell(para('PAKE & SCHA\nLEGAL CONSULTING', { font: 'Tinos', size: 13, bold: true, color: K_GOLD, line: 1.15 }), { width: W - addrW, valign: D.VerticalAlign.BOTTOM, pb: 3.75, borders: bottom }),
            cell(para(headerText || '', { font: 'Tinos', size: 10, bold: true, color: K_MUTED, line: 1.35 }), { width: addrW, valign: D.VerticalAlign.BOTTOM, pb: 3.75, borders: bottom }),
          ],
        ],
        [W - addrW, addrW]
      ),
    ],
  });
}

/** opts.fivenetUrl: Adresse der FiveNet-Instanz – „DOC - Nummer“ wird zum Link auf das Dokument. */
async function contractDocx(k, c, headerText, opts = {}) {
  const pageW = 12240; // US Letter wie die Druckansicht
  const side = mm(25);
  const W = pageW - 2 * side;
  const values = contractValues(k, c);
  const inl = (text, base, extra) => inlineRuns(text, values, base, extra ? { ...opts, ...extra } : opts);
  const pt = (vmm) => vmm / 0.3528; // mm → pt
  const centerBase = { font: 'Roboto Serif', size: 9.5, color: K_INK, boldSize: 11 };

  // Bausteine mit oberem/unterem Abstand (mm) – Abstände benachbarter Absätze fallen wie im Browser zusammen
  const toBlocks = (b) => {
    const P = (runsFn, o, top, bottom) => ({ top, bottom, make: (before, pageBreak) => [para(runsFn(), { ...o, before, after: 0, pageBreakBefore: pageBreak })] });
    switch (b.type) {
      case 'title':
        return [P(() => inl(b.text, { font: 'Tinos', size: 30, bold: true, color: K_GOLD }), { align: D.AlignmentType.CENTER, line: 1.2, font: 'Tinos', mark: 30, keepNext: true }, 24, 10)];
      case 'section':
        return [P(() => inl(b.text, { font: 'Tinos', size: 17, bold: true, color: K_GOLD }), { align: D.AlignmentType.CENTER, line: 1.3, font: 'Tinos', mark: 17, keepNext: true }, 8, 7)];
      case 'para':
        return [P(() => inl(b.text, { font: 'Tinos', size: 11, bold: true, color: K_SOFT }), { line: 1.4, font: 'Tinos', mark: 11, keepNext: true }, 7, 3)];
      case 'p': {
        // Mehrzeilige Werte (z. B. Empfänger): je Zeile ein eigener Absatz ohne Zwischenabstand. Word und Google Docs
        // ziehen im Blocksatz sonst jede Zeile vor einem Zeilenumbruch über die ganze Breite – der Browser nicht.
        const lines = [[]];
        for (const r of inl(b.text, { font: 'Tinos', size: 11, color: K_SOFT }, { split: true })) r === LINE_END ? lines.push([]) : lines[lines.length - 1].push(r);
        const o = { align: D.AlignmentType.JUSTIFIED, line: 2, font: 'Tinos', mark: 11, keepLines: true };
        return lines.map((rs, j) => P(() => rs, { ...o, keepNext: j < lines.length - 1 }, 0, j === lines.length - 1 ? 2 : 0));
      }
      case 'center':
        return b.between
          ? [P(() => inl(b.text, { ...centerBase, size: 15, color: K_MUTED, boldSize: 15 }), { align: D.AlignmentType.CENTER, line: 1.55, font: 'Roboto Serif', mark: 15 }, 2, 2)]
          : [P(() => inl(b.text, centerBase), { align: D.AlignmentType.CENTER, line: 1.55, font: 'Roboto Serif', mark: 9.5 }, 0, 0)];
      case 'item':
        return [
          P(
            () => [...runs(`${b.num}.`, { font: 'Tinos', size: 11, bold: true, color: K_SOFT }), new D.TextRun({ text: '\t' }), ...inl(b.text, { font: 'Tinos', size: 11, color: K_SOFT })],
            { line: 2, font: 'Tinos', mark: 11, keepLines: true, indent: { left: mm(7), hanging: mm(7) }, tabStops: [{ type: D.TabStopType.LEFT, position: mm(7) }] },
            0,
            1
          ),
        ];
      case 'indent':
        return [P(() => inl(b.text, { font: 'Tinos', size: 11, color: K_MUTED }), { line: 2, font: 'Tinos', mark: 11, keepLines: true, indent: { left: mm(14) } }, 0, 1)];
      case 'space':
        return [{ height: 3 }];
      case 'gap':
        return [{ height: 9 }];
      case 'co':
        return coLawyersOf(k).flatMap((l) => [
          { height: 5 },
          P(() => runs(l.name, { ...centerBase, size: 11, bold: true }), { align: D.AlignmentType.CENTER, line: 1.55, font: 'Roboto Serif', mark: 11 }, 0, 0),
          P(() => runs(`${l.rank ? l.rank + ', ' : ''}Pake & Scha`, { ...centerBase, size: 11, bold: true }), { align: D.AlignmentType.CENTER, line: 1.55, font: 'Roboto Serif', mark: 11 }, 0, 0),
          P(() => [...runs('geb. am ', centerBase), ...(l.birth ? runs(l.birth, centerBase) : [blankRun(centerBase)])], { align: D.AlignmentType.CENTER, line: 1.55, font: 'Roboto Serif', mark: 9.5 }, 0, 0),
        ]);
      case 'sign':
        return [signatureBlock(values, k, b.who, W)];
      default:
        return [];
    }
  };

  const children = [];
  contractPages(k.body, values, k).forEach((page, pageIndex) => {
    let prevBottom = null; // null = Seitenanfang
    // Seitenumbruch in einem eigenen, winzigen Absatz: Der „Abstand davor“ des ersten Bausteins würde direkt nach
    // einem Umbruch sonst je nach Programm verschluckt.
    if (pageIndex > 0) children.push(para([new D.TextRun({ text: '', size: 2 })], { mark: 1, pageBreakBefore: true }));
    let pageBreak = false;
    for (const blk of page.flatMap(toBlocks)) {
      if (blk.height !== undefined) {
        // Leerraum mit fester Höhe: Rand davor + Höhe als Abstand davor. Nie zugleich „Abstand danach“ und „davor“ –
        // Word/Google addieren beide, LibreOffice nimmt das Maximum.
        children.push(para([new D.TextRun({ text: '', size: 2 })], { before: pt((prevBottom || 0) + blk.height), mark: 1, pageBreakBefore: pageBreak }));
        prevBottom = 0;
      } else {
        const before = prevBottom === null ? blk.top : Math.max(prevBottom, blk.top);
        children.push(...blk.make(pt(before), pageBreak));
        prevBottom = blk.bottom;
      }
      pageBreak = false;
    }
  });

  return pack(
    new D.Document({
      creator: 'Pake & Scha Legal Consulting',
      title: `${k.templateName} ${c.caseNumber}`,
      styles: { default: { document: { run: { font: 'Tinos', size: hp(11), color: K_INK } } } },
      sections: [
        {
          properties: { page: { size: { width: pageW, height: 15840 }, margin: { top: mm(36), bottom: mm(16), left: side, right: side, header: mm(12), footer: mm(8) } } },
          headers: { default: contractHeader(headerText, W) },
          children,
        },
      ],
    })
  );
}

/* ================================================================
   Aktenauszug (aktenauszug.html + public/js/aktenauszug.js)
   ================================================================ */
const AREAS = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
const URGENCY = { normal: 'Normal', eilig: 'Eilig', notfall: 'Notfall' };
const PRIORITY = { 1: 'Niedrig', 2: 'Normal', 3: 'Hoch', 4: 'Kritisch' };
const EVENT_STATUS = { angefragt: 'Angefragt', bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt', erledigt: 'Erledigt' };
const INVOICE_KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
const INVOICE_STATUS = { offen: 'Offen', bezahlt: 'Bezahlt', storniert: 'Storniert' };
const CONTRACT_STATUS = { entwurf: 'Entwurf', teilweise: 'Teilweise unterschrieben', unterschrieben: 'Unterschrieben' };
const PROVIDER = { fivenet: 'FiveNet', gdocs: 'Google Docs', gsheets: 'Google Sheets' };
const ROLES = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Board of Partners' };

/** Abschnitte des Aktenauszugs mit Standardwerten (wie OPTIONS in aktenauszug.js). */
const EXTRACT_OPTIONS = {
  description: true,
  events: true,
  docs: true,
  docsText: false,
  contracts: true,
  invoices: true,
  log: true,
  logSystem: true,
  attachments: true,
  images: false,
  internal: false,
  tasks: true,
};

/** Breite × Höhe aus PNG- bzw. JPEG-Kopf (für das Seitenverhältnis der Bilder). */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

async function extractDocx(data, firm, options = {}) {
  const opts = { ...EXTRACT_OPTIONS, ...options };
  const staff = !!opts.staff;
  const internal = staff && !!opts.internal;
  const files = opts.files || {};
  const c = data.case;
  const pageW = 11906; // A4
  const side = mm(16);
  const W = pageW - 2 * side;
  const stand = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
  const body = [];
  const LINK = '8A6D1F';

  const pill = (text, isInt) => [
    new D.TextRun({ text: ' ' }),
    new D.TextRun({ text: ` ${text.toUpperCase()} `, font: 'Inter', size: hp(rem(0.66)), color: isInt ? '92400E' : MUTED, shading: isInt ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'FFF8EB' } : undefined }),
  ];
  const intPill = (on) => (on ? pill('intern', true) : []);
  const link = (url, o = {}) => new D.ExternalHyperlink({ link: url, children: [new D.TextRun({ text: o.text || url, font: 'Inter', size: hp(o.size || rem(0.84)), color: LINK, underline: {} })] });
  const h2 = (title, extraRuns = []) =>
    para([...runs(title, { font: 'Cormorant Garamond', size: rem(1.3), bold: true, color: INK }), ...extraRuns], {
      before: rem(1.6),
      after: rem(0.6),
      keepNext: true,
      font: 'Cormorant Garamond',
      mark: rem(1.3),
      border: { bottom: { style: D.BorderStyle.SINGLE, size: eighths(0.75), color: HAIR, space: 4 } },
    });
  const empty = (t) => para(t, { font: 'Inter', size: rem(0.84), italic: true, color: MUTED });

  /** Tabelle wie im Auszug: Kopf klein und grau mit dunkler Linie, Zeilen mit heller Linie. cells: [[runs…], …] */
  function grid(headers, rows, widths, numCols = []) {
    const th = (t, i) =>
      cell(para(t.toUpperCase(), { font: 'Inter', size: rem(0.62), bold: true, color: MUTED, align: numCols.includes(i) ? D.AlignmentType.RIGHT : undefined }), {
        pt: rem(0.45),
        pb: rem(0.45),
        pl: rem(0.4),
        pr: rem(0.4),
        borders: { bottom: line(1.125, INK) },
      });
    const td = (content, i) =>
      cell(Array.isArray(content) && content[0] instanceof D.Paragraph ? content : para(content, { font: 'Inter', size: rem(0.82), color: INK, line: 1.45, align: numCols.includes(i) ? D.AlignmentType.RIGHT : undefined }), {
        pt: rem(0.5),
        pb: rem(0.5),
        pl: rem(0.4),
        pr: rem(0.4),
        borders: { bottom: line(0.75, HAIR) },
      });
    return table([new D.TableRow({ tableHeader: true, children: headers.map(th) }), ...rows.map((r) => new D.TableRow({ cantSplit: true, children: r.map(td) }))], widths);
  }
  // Zelle mit Haupttext und grauer Zusatzzeile darunter (z. B. Ort eines Termins)
  const withDim = (main, dim, extra = []) => [
    para([...runs(main, { font: 'Inter', size: rem(0.82), color: INK }), ...extra], { line: 1.45, font: 'Inter', mark: rem(0.82) }),
    ...(dim ? [para(dim, { font: 'Inter', size: rem(0.82), color: MUTED, line: 1.45 })] : []),
  ];
  const mono = (t) => [para(t, { font: 'JetBrains Mono', size: rem(0.82), color: INK, line: 1.45 })];

  // Kopf
  body.push(firmHead(firm, W));
  const meta = [['Aktenzeichen', c.caseNumber], ['Stand', stand], ...(c.courtRef ? [['Gericht', c.courtRef]] : [])];
  const labelW = mm(26);
  const valueW = mm(44);
  body.push(
    spacer(rem(1.75)),
    table(
      [
        [
          cell(
            [
              para('Aktenauszug', { font: 'Cormorant Garamond', size: rem(2.1), bold: true, color: INK, line: 1 }),
              para(c.title || '', { font: 'Inter', size: rem(0.9), color: MUTED, before: rem(0.2) }),
            ],
            { width: W - labelW - valueW, valign: D.VerticalAlign.BOTTOM }
          ),
          ...metaCells(meta, rem(0.82), labelW, valueW),
        ],
      ],
      [W - labelW - valueW, labelW, valueW]
    ),
    spacer(rem(1.25))
  );
  if (internal) {
    body.push(
      para([...runs('Vertraulich – enthält interne Angaben der Kanzlei.', { font: 'Inter', size: rem(0.78), bold: true, color: '92400E' }), ...runs(' Nicht an Mandanten oder Dritte weitergeben.', { font: 'Inter', size: rem(0.78), color: '92400E' })], {
        fill: 'FFF8EB',
        border: { top: line(0.75, 'F1C27D'), bottom: line(0.75, 'F1C27D'), left: line(0.75, 'F1C27D'), right: line(0.75, 'F1C27D') },
        indent: { left: tw(rem(0.8)), right: tw(rem(0.8)) },
        line: 1.9,
        font: 'Inter',
      })
    );
  }

  // Stammdaten
  const lawyers = [c.lawyerName ? `${c.lawyerName}${(c.coLawyers || []).length ? ' (federführend)' : ''}` : null, ...(c.coLawyers || []).map((l) => l.name)].filter(Boolean);
  const facts = [
    ['Mandant', c.clientName],
    ['Gegenpartei', c.opponent || '—'],
    ['Rechtsgebiet', AREAS[c.area] || c.area],
    ['Dringlichkeit (Angabe Mandant)', URGENCY[c.urgency] || c.urgency],
    ['Status', c.statusLabel],
    ['Verfahrensstand', c.stepLabel],
    ['Zuständig', lawyers.length ? lawyers.join(', ') : 'Noch nicht zugewiesen'],
    ['Gerichtsaktenzeichen', c.courtRef || '—'],
    ['Angelegt', fmtDate(c.createdAt)],
    ['Zuletzt geändert', fmtDate(c.updatedAt)],
  ];
  if (internal && c.priority) facts.push(['Priorität (intern)', PRIORITY[c.priority] || c.priority]);
  if (internal && c.processTicket) facts.push(['Prozessticket (intern)', { url: c.processTicket.url, text: c.processTicket.label || c.processTicket.url }]);
  const factW = Math.round((W - tw(rem(1.5))) / 2);
  const fact = (f) =>
    f
      ? [
          para(f[0].toUpperCase(), { font: 'Inter', size: rem(0.64), bold: true, color: GOLD }),
          typeof f[1] === 'object' && f[1] ? para([link(f[1].url, { text: f[1].text, size: rem(0.86) })], { before: rem(0.1) }) : para(String(f[1] ?? ''), { font: 'Inter', size: rem(0.86), color: INK, line: 1.45, before: rem(0.1) }),
        ]
      : [para('')];
  const factRows = [];
  for (let i = 0; i < facts.length; i += 2) {
    factRows.push([cell(fact(facts[i]), { width: factW, pb: rem(0.55) }), cell(para(''), { width: W - 2 * factW }), cell(fact(facts[i + 1]), { width: factW, pb: rem(0.55) })]);
  }
  body.push(h2('Stammdaten'), table(factRows, [factW, W - 2 * factW, factW]));
  if (c.publicNote) {
    body.push(
      para([...runs('Hinweis der Kanzlei: ', { font: 'Inter', size: rem(0.88), bold: true, color: INK }), ...runs(c.publicNote, { font: 'Inter', size: rem(0.88), color: INK })], {
        before: rem(0.9),
        fill: 'FAF8F1',
        border: { left: { style: D.BorderStyle.SINGLE, size: eighths(2.25), color: GOLD, space: 8 } },
        indent: { left: tw(rem(0.9)), right: tw(rem(0.9)) },
        line: 1.9,
        font: 'Inter',
      })
    );
  }

  if (opts.description && c.description) body.push(h2('Sachverhalt'), para(c.description, { font: 'Inter', size: rem(0.88), color: INK, line: 1.6 }));

  if (opts.events) {
    const rows = (data.appointments || []).filter((e) => internal || !staff || e.clientVisible);
    body.push(h2('Termine & Fristen'));
    const w = [mm(34), mm(26), 0, mm(26)];
    w[2] = W - w[0] - w[1] - w[3];
    body.push(
      rows.length
        ? grid(
            ['Datum', 'Art', 'Termin', 'Status'],
            rows.map((e) => [fmtDate(e.startsAt), e.typeLabel || '', withDim(e.title, e.location, staff && !e.clientVisible ? intPill(true) : []), EVENT_STATUS[e.status] || e.status]),
            w
          )
        : empty('Keine Termine oder Fristen.')
    );
  }

  if (opts.docs) {
    const rows = (data.externalDocs || []).filter((d) => internal || !d.internal);
    body.push(h2('Externe Dokumente'));
    if (!rows.length) body.push(empty('Keine externen Dokumente.'));
    rows.forEach((d, i) => {
      const metaLine = [PROVIDER[d.provider] || d.provider, d.docType, d.docDate ? dayDe(d.docDate) : null, d.docAuthor ? `Verfasser: ${d.docAuthor}` : null].filter(Boolean).join(' · ');
      const last = i === rows.length - 1;
      const sep = { bottom: { style: D.BorderStyle.SINGLE, size: eighths(0.75), color: HAIR, space: 6 } };
      // [Inhalt, Optionen] – die Trennlinie kommt an den letzten Absatz des Dokuments
      const parts = [
        [[...runs(d.title || d.documentId || 'Dokument', { font: 'Inter', size: rem(0.84), bold: true, color: INK }), ...intPill(d.internal)], { before: rem(0.6), keepNext: true, font: 'Inter', mark: rem(0.84) }],
        ...(metaLine ? [[metaLine, { font: 'Inter', size: rem(0.84), color: MUTED, keepNext: true }]] : []),
        ...(d.url ? [[[link(d.url)], { keepNext: !!(d.summary || (opts.docsText && d.contentText)) }]] : []),
        ...(d.summary ? [[d.summary, { font: 'Inter', size: rem(0.84), color: INK, line: 1.6, before: rem(0.3) }]] : []),
        ...(opts.docsText && d.contentText ? [[d.contentText, { font: 'Inter', size: rem(0.8), color: INK, line: 1.5, before: rem(0.4), fill: 'F7F7F5', indent: { left: tw(rem(0.7)), right: tw(rem(0.7)) } }]] : []),
      ];
      parts.forEach(([content, o], j) => body.push(para(content, j === parts.length - 1 && !last ? { ...o, border: sep } : o)));
    });
  }

  if (opts.contracts) {
    const all = data.contracts || [];
    const signedText = (k) =>
      [
        ...(k.needsLawyer === false ? [] : [`${k.lawyerName || 'Anwalt'}: ${k.lawyerSignedAt ? `unterschrieben ${dateDe(k.lawyerSignedAt)}` : 'offen'}`]),
        ...(k.needsLawyer === false ? [] : (k.coLawyers || []).map((l) => `${l.name}: ${l.signedAt ? `unterschrieben ${dateDe(l.signedAt)}` : 'offen'}`)),
        ...(k.needsClient === false ? [] : [`Mandant: ${k.clientSignedAt ? `unterschrieben ${dateDe(k.clientSignedAt)}` : 'offen'}`]),
      ].join('\n');
    // Spaltenbreiten wie im Browser (dort automatisch nach Inhalt)
    const w = [mm(40), mm(22), mm(44), 0];
    w[3] = W - w[0] - w[1] - w[2];
    const contractTable = (title, list, emptyText) => {
      body.push(h2(title));
      body.push(
        list.length
          ? grid(
              ['Dokument', 'Erstellt', 'Status', 'Unterschriften'],
              list.map((k) => [withDim(k.templateName, null, intPill(k.internal)), dateDe(k.createdAt), CONTRACT_STATUS[k.status] || k.status, signedText(k)]),
              w
            )
          : empty(emptyText)
      );
    };
    contractTable('Mandatsverträge', all.filter((k) => k.kind !== 'schriftsatz'), 'Keine Verträge.');
    const briefs = all.filter((k) => k.kind === 'schriftsatz' && (internal || !k.internal));
    if (briefs.length) contractTable('Schriftsätze', briefs, '');
  }

  if (opts.invoices) {
    const list = data.invoices || [];
    const open = list.filter((i) => i.status === 'offen').reduce((s, i) => s + i.total, 0);
    body.push(h2('Rechnungen & Honorare'));
    const w = [mm(30), 0, mm(26), mm(22), mm(28)];
    w[1] = W - w[0] - w[2] - w[3] - w[4];
    if (list.length) {
      body.push(
        grid(
          ['Nummer', 'Art', 'Datum', 'Betrag', 'Status'],
          list.map((i) => [mono(i.number), withDim(INVOICE_KIND[i.kind] || i.kind, i.subject), dateDe(i.createdAt), [para(money(i.total), { font: 'JetBrains Mono', size: rem(0.82), color: INK, line: 1.45, align: D.AlignmentType.RIGHT })], withDim(INVOICE_STATUS[i.status] || i.status, i.overdueDays > 0 ? `${i.overdueDays} ${i.overdueDays === 1 ? 'Tag' : 'Tage'} überfällig` : null)]),
          w,
          [3]
        )
      );
      if (open) body.push(para([...runs('Offen insgesamt: ', { font: 'Inter', size: rem(0.88), color: INK }), ...runs(money(open), { font: 'Inter', size: rem(0.88), bold: true, color: INK })], { align: D.AlignmentType.RIGHT, before: rem(0.5), font: 'Inter', mark: rem(0.88) }));
    } else body.push(empty('Keine Rechnungen.'));
  }

  if (internal && opts.tasks) {
    const list = data.tasks || [];
    body.push(h2('Aufgaben & Wiedervorlagen', intPill(true)));
    const w = [0, mm(24), mm(34), mm(40)];
    w[0] = W - w[1] - w[2] - w[3];
    body.push(
      list.length
        ? grid(
            ['Aufgabe', 'Fällig', 'Zuständig', 'Stand'],
            list.map((t) => [withDim(t.title, t.note), t.dueDate ? dayDe(t.dueDate) : '—', t.assignedName || '—', t.done ? `erledigt ${dateDe(t.doneAt)}${t.doneByName ? ` (${t.doneByName})` : ''}` : 'offen']),
            w
          )
        : empty('Keine Aufgaben.')
    );
  }

  if (opts.log) {
    const rows = (data.notes || []).filter((n) => (internal || !n.internal) && (opts.logSystem || !n.system));
    body.push(h2('Verlauf & Notizen'));
    if (!rows.length) body.push(empty('Keine Einträge.'));
    rows.forEach((n, i) => {
      const last = i === rows.length - 1;
      body.push(
        para(
          [
            ...runs(`${fmtDate(n.createdAt)} · `, { font: 'Inter', size: rem(0.72), color: MUTED }),
            ...runs(n.author || 'System', { font: 'Inter', size: rem(0.72), bold: true, color: MUTED }),
            ...(n.authorRole && ROLES[n.authorRole] ? runs(` (${ROLES[n.authorRole]})`, { font: 'Inter', size: rem(0.72), color: MUTED }) : []),
            ...intPill(n.internal),
          ],
          { before: rem(0.55), keepNext: true, font: 'Inter', mark: rem(0.72) }
        ),
        para(n.body || '', {
          font: 'Inter',
          size: rem(0.84),
          color: n.system ? MUTED : INK,
          italic: !!n.system,
          line: 1.5,
          before: rem(0.15),
          border: last ? undefined : { bottom: { style: D.BorderStyle.SINGLE, size: eighths(0.75), color: HAIR, space: 6 } },
        })
      );
    });
  }

  if (opts.attachments) {
    const rows = (data.attachments || []).filter((a) => internal || !a.internal);
    body.push(h2('Anhänge (Beweismittel)'));
    if (rows.length) {
      const w = [mm(14), 0, mm(44), mm(26)];
      w[1] = W - w[0] - w[2] - w[3];
      body.push(grid(['Nr.', 'Beschreibung', 'Hochgeladen von', 'Datum'], rows.map((a, n) => [mono(String(n + 1)), withDim(a.caption || 'Bild', null, intPill(a.internal)), a.uploaderName || '—', dateDe(a.createdAt)]), w));
      if (opts.images) {
        const colW = Math.round((W - tw(rem(0.8))) / 2);
        const maxWpx = (colW / 20) * (96 / 72);
        const maxHpx = mm(90) / 20 * (96 / 72);
        const figure = (a, n) => {
          const f = files[a.id];
          const size = f && imageSize(f.data);
          const caption = para(`Nr. ${n + 1}${a.caption ? ` – ${a.caption}` : ''}`, { font: 'Inter', size: rem(0.72), color: MUTED, before: rem(0.2) });
          if (!f || !size) return [para('Bild nicht verfügbar', { font: 'Inter', size: rem(0.72), italic: true, color: MUTED }), caption];
          const scale = Math.min(1, maxWpx / size.width, maxHpx / size.height);
          return [para([new D.ImageRun({ type: f.type, data: f.data, transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } })]), caption];
        };
        const rowsImg = [];
        for (let i = 0; i < rows.length; i += 2) {
          rowsImg.push([cell(figure(rows[i], i), { width: colW, pt: rem(0.4), pb: rem(0.4) }), cell(para(''), { width: W - 2 * colW }), cell(rows[i + 1] ? figure(rows[i + 1], i + 1) : [para('')], { width: colW, pt: rem(0.4), pb: rem(0.4) })]);
        }
        body.push(spacer(rem(0.6)), table(rowsImg, [colW, W - 2 * colW, colW], { cantSplit: true }));
      }
    } else body.push(empty('Keine Anhänge.'));
  }

  body.push(
    para([...runs(`Pake & Scha Legal Consulting · Aktenauszug ${c.caseNumber}`, { font: 'Inter', size: rem(0.7), color: MUTED }), new D.TextRun({ text: '\t' }), ...runs(`Stand ${stand}`, { font: 'Inter', size: rem(0.7), color: MUTED })], {
      before: rem(2.5),
      border: { top: { style: D.BorderStyle.SINGLE, size: eighths(0.75), color: HAIR, space: 9 } },
      tabStops: [{ type: D.TabStopType.RIGHT, position: W }],
    })
  );

  // Seitenfuß wie im Druck: links Aktenzeichen, rechts „Seite X von Y“
  const footRun = (o) => new D.TextRun({ font: 'Inter', size: hp(8), color: MUTED, ...o });
  const footer = new D.Footer({
    children: [
      new D.Paragraph({
        tabStops: [{ type: D.TabStopType.RIGHT, position: W }],
        children: [footRun({ text: `Pake & Scha · Aktenauszug ${c.caseNumber}` }), footRun({ text: '\tSeite ' }), footRun({ children: [D.PageNumber.CURRENT] }), footRun({ text: ' von ' }), footRun({ children: [D.PageNumber.TOTAL_PAGES] })],
      }),
    ],
  });

  return pack(
    new D.Document({
      creator: 'Pake & Scha Legal Consulting',
      title: `Aktenauszug ${c.caseNumber}`,
      styles: { default: { document: { run: { font: 'Inter', size: hp(10.5), color: INK } } } },
      sections: [
        {
          properties: { page: { size: { width: pageW, height: 16838 }, margin: { top: mm(14), bottom: mm(16), left: side, right: side, header: mm(6), footer: mm(7) } } },
          footers: { default: footer },
          children: body,
        },
      ],
    })
  );
}

module.exports = { invoiceDocx, contractDocx, extractDocx, EXTRACT_OPTIONS, _test:{ parseDate, dateDe, dayDe, fmtDate, dateTime, money, contractPages, inlineRuns, contractValues } };
