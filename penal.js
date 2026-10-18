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

module.exports = { init, offences, laws, law, caseCharges, sentence, chargesText, offenceRow, citation, usd, CAP, CAP_SEVERE, FINE_PER_HE, FINE_MODES };
