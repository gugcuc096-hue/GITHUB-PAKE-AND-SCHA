'use strict';
/*
 * Strafgesetzbuch & Strafmaß-Rechner.
 *
 * Beim ersten Start wird das StGB des Staates San Andreas eingespielt (seeds/stgb.json): der Gesetzestext je
 * Paragraph und der Strafkatalog (je Tatbestand Strafrahmen in Hafteinheiten und Geldstrafe). Das Board pflegt
 * beides danach im Kanzlei-Wiki → Strafgesetzbuch.
 *
 * Gerechnet wird nach dem Allgemeinen Teil:
 *  - § 3 Abs. 2: Gesamtstrafe höchstens 120 HE, in besonders schweren Fällen (Leben, körperliche Unversehrtheit,
 *    verfassungsmäßige Ordnung) und bei Terrorstraftaten bis 180 HE
 *  - § 3 Abs. 3: mehrere Geldstrafen werden addiert
 *  - § 13 Abs. 2: ohne festgelegte Höhe höchstens 3.000 $ je Hafteinheit
 *  - § 8, § 9 Abs. 2, § 10 Abs. 4: verminderte Schuldfähigkeit, Versuch und Beihilfe „können“ gemildert werden –
 *    das Gesetz nennt keinen festen Abschlag, deshalb nur als Hinweis (die Einschätzung trägt der Anwalt ein)
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, tx, getSetting, setSetting } = require('./db');

const CAP = 120;
const CAP_SEVERE = 180;
const FINE_PER_HE = 3000;
const FINE_MODES = { none: 'nur Freiheitsstrafe', alt: 'Freiheitsstrafe oder Geldstrafe', only: 'nur Geldstrafe' };

/** Einmalig das StGB einspielen (danach pflegt es das Board – gelöschte Einträge kommen nicht zurück). */
function init() {
  if (getSetting('penal_seeded')) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'stgb.json'), 'utf8'));
  tx(() => {
    const law = db.prepare('INSERT OR IGNORE INTO penal_laws (para, title, chapter, chapter_title, text) VALUES (?, ?, ?, ?, ?)');
    for (const l of seed.laws) law.run(l.para, l.title, l.chapter, l.chapterTitle, l.text);
    if (!db.prepare('SELECT 1 FROM penal_offences LIMIT 1').get()) {
      const off = db.prepare(
        `INSERT INTO penal_offences (para, paragraph, title, min_he, max_he, fine_mode, fine_max, attempt, severe, note, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const o of seed.offences) off.run(o.para, o.paragraph, o.title, o.minHe, o.maxHe, o.fine, o.fineMax, o.attempt ? 1 : 0, o.severe ? 1 : 0, o.note, o.sort);
    }
    setSetting('penal_seeded', seed.version);
  });
}

/** „§ 25 Abs. 3 StGB“ */
const citation = (o) => `§ ${o.para}${o.paragraph ? ` ${o.paragraph}` : ''} StGB`;

function offenceRow(o) {
  return {
    id: o.id,
    para: o.para,
    paragraph: o.paragraph,
    citation: citation(o),
    title: o.title,
    minHe: o.min_he,
    maxHe: o.max_he,
    fine: o.fine_mode,
    fineMax: o.fine_max,
    attempt: !!o.attempt,
    severe: !!o.severe,
    note: o.note,
    sort: o.sort,
    chapter: o.chapter || '',
  };
}

function chargeRow(c) {
  return { ...offenceRow(c), id: c.id, offenceId: c.offence_id, count: c.count, attempted: !!c.attempted, aiding: !!c.aiding };
}

/** Paragraph als Zahl zum Sortieren („103a“ nach „103“). */
const paraKey = (p) => {
  const m = String(p).match(/^(\d+)([a-z]?)$/);
  return m ? Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : 99999;
};

function offences() {
  return db
    .prepare('SELECT o.*, l.chapter FROM penal_offences o LEFT JOIN penal_laws l ON l.para = o.para')
    .all()
    .map(offenceRow)
    .sort((a, b) => paraKey(a.para) - paraKey(b.para) || a.sort - b.sort || a.id - b.id);
}

function laws() {
  return db
    .prepare('SELECT para, title, chapter, chapter_title FROM penal_laws')
    .all()
    .map((l) => ({ para: l.para, title: l.title, chapter: l.chapter, chapterTitle: l.chapter_title }))
    .sort((a, b) => paraKey(a.para) - paraKey(b.para));
}

function law(para) {
  const l = db.prepare('SELECT * FROM penal_laws WHERE para = ?').get(String(para));
  return l ? { para: l.para, title: l.title, chapter: l.chapter, chapterTitle: l.chapter_title, text: l.text, updatedAt: l.updated_at } : null;
}

function caseCharges(caseId) {
  return db.prepare('SELECT * FROM case_charges WHERE case_id = ? ORDER BY id').all(caseId).map(chargeRow);
}

/**
 * Strafrahmen aller Anklagepunkte zusammen.
 * Freiheitsstrafe: Untergrenze nur aus Tatbeständen ohne Geldstrafe (sonst kann das Gericht statt Haft eine Geldstrafe
 * verhängen), Obergrenze aus allen – beides gekappt bei 120 bzw. 180 HE. Geldstrafe: Summe der Höchstbeträge.
 */
function sentence(charges) {
  let minHe = 0;
  let maxHe = 0;
  let open = false;
  let fineMax = 0;
  let fineOnly = charges.length > 0;
  const severe = charges.some((c) => c.severe);
  const cap = severe ? CAP_SEVERE : CAP;
  for (const c of charges) {
    const n = Math.max(1, c.count || 1);
    if (c.fine !== 'only') {
      fineOnly = false;
      if (c.fine === 'none') minHe += c.minHe * n;
      if (c.maxHe == null) open = true;
      else maxHe += c.maxHe * n;
    }
    if (c.fine !== 'none') fineMax += (c.fineMax != null ? c.fineMax : FINE_PER_HE * (c.maxHe || 0)) * n;
  }
  if (open) maxHe = cap;
  const capped = maxHe > cap || minHe > cap;
  return {
    minHe: Math.min(minHe, cap),
    maxHe: Math.min(maxHe, cap),
    cap,
    capped,
    open, // ein Tatbestand ohne Obergrenze („nicht unter …“): Obergrenze ist die Gesamtstrafe
    severe,
    fineMax,
    fineOnly,
    mitigations: [
      charges.some((c) => c.attempted) ? '§ 9 Abs. 2 (Versuch)' : '',
      charges.some((c) => c.aiding) ? '§ 10 Abs. 4 (Beihilfe)' : '',
    ].filter(Boolean),
  };
}

const usd = (n) => `${Number(n).toLocaleString('de-DE')} $`;

/** Anklagepunkte als Text – für den Platzhalter {{anklagepunkte}} in Schriftsätzen. */
function chargesText(caseId) {
  return caseCharges(caseId)
    .map((c) => `${c.count > 1 ? `${c.count}× ` : ''}${c.citation} – ${c.title}${c.attempted ? ' (Versuch)' : ''}${c.aiding ? ' (Beihilfe)' : ''}`)
    .join('\n');
}

/*
 * Anklagetext lesen – eingefügt aus FiveNet oder dem DOJ-Ticket (die Website ruft dafür nichts ab). Erkannt werden
 * Paragraphen („§ 33 StGB“, „§§ 33, 40“, „StGB § 29 Abs. 2“, „Paragraph 66 Absatz 1“), die Anzahl („2x“, „(3×)“,
 * „zweifach“), Versuch und Beihilfe (das Wort in der Zeile oder § 9 / § 10) und – in Zeilen ohne Paragraph – Tatbestände
 * an ihrem Namen („Gefährliche Körperverletzung“). Ergebnis: Vorschläge aus dem Strafkatalog (gleiche Tatbestände
 * zusammengezählt); Paragraphen ohne Tatbestand und andere Gesetze kommen als Hinweis zurück.
 */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const WORD_COUNT = { zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
const COUNT_RE = /(?:^|[^\w.§])(\d{1,2})\s*[x×]\b|(?:^|\s)[x×]\s*(\d{1,2})\b|\b(\d{1,2})\s*-?\s*(?:fach|mal)\b|\b(zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*-?\s*(?:fach|mal)\b/i;
const MARK_RE = /§§?|\bparagra(?:ph|f)(?:en)?\b\.?/gi;
const ITEM_RE = /^\s*(?:(?:,|;|\/|&|\+|und|u\.|sowie|bzw\.?|oder)\s*)?(\d{1,3}[a-z]?)\b(?:\s*(?:abs\.?|absatz)\s*(\d{1,2}))?(?:\s*(?:s\.|satz)\s*(\d{1,2}))?(?:\s*(?:nr\.?|nummer)\s*\d{1,2})?/i;
const LAW_RE = /^\s*(?:des\s+|der\s+)?([A-Za-zÄÖÜäöü]{2,8})\b/;
const OTHER_LAWS = new Set(['stvo', 'stvg', 'stpo', 'btmg', 'waffg', 'gg', 'bgb', 'zpo', 'luftvg', 'owig', 'vwvfg', 'sprengg']);
const GENERAL_PART = { 9: 'attempted', 10: 'aiding' }; // § 9 Versuch, § 10 Beihilfe (Allgemeiner Teil)
const MAX_PARSE = 20000;

function countIn(s) {
  const m = String(s).match(COUNT_RE);
  if (!m) return null;
  const n = m[4] ? WORD_COUNT[m[4].toLowerCase()] : Number(m[1] || m[2] || m[3]);
  return n ? Math.min(20, Math.max(1, n)) : null;
}
const absOf = (p) => (String(p || '').match(/Abs\.\s*(\d+)/) || [])[1] || null;
const satzOf = (p) => (String(p || '').match(/Satz\s*(\d+)/) || [])[1] || null;

/** Paragraphen einer Zeile: [{ para, abs, satz, raw, law, count }] – law: anderes Gesetz (StVO …) oder null. */
function paraRefs(line) {
  const marks = [...line.matchAll(MARK_RE)];
  const refs = [];
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].index : line.length;
    const segment = line.slice(m.index + m[0].length, end);
    let rest = segment;
    const items = [];
    for (let guard = 0; guard < 12; guard++) {
      const it = rest.match(ITEM_RE);
      if (!it) break;
      items.push({ para: it[1].toLowerCase(), abs: it[2] || null, satz: it[3] || null, raw: `§ ${it[0].replace(/^[\s,;/&+]*(?:und|u\.|sowie|bzw\.?|oder)?\s*/i, '').trim()}` });
      rest = rest.slice(it[0].length);
    }
    const law = (rest.match(LAW_RE) || [])[1];
    const other = law && OTHER_LAWS.has(law.toLowerCase()) ? law : null;
    const count = countIn(segment);
    items.forEach((x) => refs.push({ ...x, law: other, count }));
  });
  // „33 StGB“ ohne Paragraphenzeichen
  if (!marks.length) {
    for (const m of line.matchAll(/\b(\d{1,3}[a-z]?)(?:\s*(?:abs\.?|absatz)\s*(\d{1,2}))?\s*StGB\b/gi)) {
      refs.push({ para: m[1].toLowerCase(), abs: m[2] || null, satz: null, raw: `§ ${m[0].replace(/\s*StGB$/i, '')}`, law: null, count: null });
    }
  }
  return refs;
}

/** Tatbestand zu einem Paragraphen: Absatz/Satz wie angegeben, sonst entscheidet der Name in der Zeile, sonst der erste. */
function pickOffence(list, ref, normLine) {
  let cand = list;
  if (ref.abs) {
    const byAbs = list.filter((o) => absOf(o.paragraph) === ref.abs);
    if (byAbs.length) {
      cand = byAbs;
      const bySatz = byAbs.filter((o) => (ref.satz ? satzOf(o.paragraph) === ref.satz : !satzOf(o.paragraph)));
      if (bySatz.length) cand = bySatz;
    }
  }
  if (cand.length > 1) {
    const named = cand.filter((o) => ` ${normLine} `.includes(` ${norm(o.title)} `)).sort((a, b) => b.title.length - a.title.length);
    if (named.length) cand = [named[0]];
  }
  return { offence: cand[0], ambiguous: cand.length > 1 };
}

function parseCharges(text) {
  const all = offences();
  const byPara = new Map();
  for (const o of all) {
    if (!byPara.has(o.para)) byPara.set(o.para, []);
    byPara.get(o.para).push(o);
  }
  // Namen der Tatbestände, längste zuerst („Schwerer Raub“ vor „Raub“)
  const titled = all
    .map((o) => ({ o, t: norm(o.title) }))
    .filter((x) => x.t.length >= 4)
    .sort((a, b) => b.t.length - a.t.length);
  const found = new Map();
  const unknown = [];
  const lines = String(text || '')
    .slice(0, MAX_PARSE)
    .split(/\r?\n|;|•|·/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 300);
  for (const line of lines) {
    const normLine = norm(line);
    const flags = { attempted: /versuch/i.test(line), aiding: /beihilfe/i.test(line) };
    const refs = paraRefs(line);
    const lineCount = countIn(line);
    const hits = [];
    if (refs.length) {
      const single = refs.length === 1;
      for (const r of refs) {
        if (r.law) {
          unknown.push({ ref: `${r.raw} ${r.law}`, reason: 'anderes Gesetz – nicht im Strafgesetzbuch', line });
          continue;
        }
        const list = byPara.get(r.para);
        if (!list) {
          if (GENERAL_PART[r.para]) flags[GENERAL_PART[r.para]] = true;
          else unknown.push({ ref: r.raw, reason: 'kein Tatbestand im Strafkatalog', line });
          continue;
        }
        hits.push({ ...pickOffence(list, r, normLine), list, count: r.count || (single ? lineCount : null) || 1 });
      }
    } else {
      let rest = ` ${normLine} `;
      for (const { o, t } of titled) {
        const i = rest.indexOf(` ${t}`);
        if (i < 0) continue;
        hits.push({ offence: o, ambiguous: false, list: byPara.get(o.para) || [o], count: lineCount || 1 });
        rest = `${rest.slice(0, i + 1)}${'#'.repeat(t.length)}${rest.slice(i + 1 + t.length)}`; // Treffer verbrauchen
      }
    }
    for (const h of hits) {
      const o = h.offence;
      const prev = found.get(o.id);
      if (prev) {
        prev.count = Math.min(20, prev.count + h.count);
        prev.attempted = prev.attempted || (flags.attempted && o.attempt);
        prev.aiding = prev.aiding || flags.aiding;
        if (!prev.lines.includes(line)) prev.lines.push(line);
        continue;
      }
      found.set(o.id, {
        ...o,
        offenceId: o.id,
        count: h.count,
        attempted: !!(flags.attempted && o.attempt),
        aiding: flags.aiding,
        ambiguous: h.ambiguous,
        alternatives: h.list.length > 1 ? h.list.map((x) => ({ id: x.id, citation: x.citation, title: x.title })) : [],
        lines: [line],
      });
    }
  }
  return { items: [...found.values()], unknown: unknown.slice(0, 30) };
}

module.exports = { init, offences, laws, law, caseCharges, sentence, chargesText, parseCharges, offenceRow, citation, usd, CAP, CAP_SEVERE, FINE_PER_HE, FINE_MODES };
