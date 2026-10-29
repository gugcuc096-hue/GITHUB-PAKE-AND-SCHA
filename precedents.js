'use strict';
/*
 * Präzedenzfälle (Kanzlei-Wiki → Reiter „Präzedenzfälle“): abgeschlossene Fälle als durchsuchbares Wissen – Sachverhalt in
 * Kürze (ohne Namen), Argumente, Ergebnis, Strafmaß, Paragraphen, Schlagworte und Nachbesprechung („Was lief gut, was nicht?“).
 * In jeder Akte zeigt die Kanzlei „Ähnliche Fälle“ (gleiches Rechtsgebiet und gleiche Paragraphen der Anklage).
 * Nur die Kanzlei sieht diese Einträge; zu einer Akte verlinkt wird nur, wer die Akte selbst sehen darf.
 */
const { z } = require('zod');
const { db } = require('./db');
const { OUTCOMES } = require('./helpers');
const areas = require('./areas');

db.exec(`
  CREATE TABLE IF NOT EXISTS precedents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id       INTEGER UNIQUE REFERENCES cases(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    area          TEXT NOT NULL DEFAULT '',
    summary       TEXT NOT NULL DEFAULT '',
    arguments     TEXT NOT NULL DEFAULT '',
    result        TEXT NOT NULL DEFAULT '',
    lessons       TEXT NOT NULL DEFAULT '',
    outcome       TEXT NOT NULL DEFAULT '',
    sentence_he   INTEGER,
    sentence_fine INTEGER,
    paragraphs    TEXT NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '',
    created_by    TEXT NOT NULL DEFAULT '',
    created_by_id INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_precedents_area ON precedents(area);
`);

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
/** „§ 12 Abs. 2“ und „§12“ sind derselbe Paragraph. */
const paraKey = (s) => fold(s).replace(/\s+/g, '').replace(/abs.*$/, '').replace(/[.,;]+$/, '');
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const row = (r, { caseNumber = null } = {}) => ({
  id: r.id,
  caseId: r.case_id,
  caseNumber,
  title: r.title,
  area: r.area,
  areaLabel: r.area ? areas.name(r.area) : '',
  summary: r.summary,
  arguments: r.arguments,
  result: r.result,
  lessons: r.lessons,
  outcome: r.outcome,
  outcomeLabel: r.outcome && OUTCOMES[r.outcome] ? OUTCOMES[r.outcome].label : '',
  success: r.outcome && OUTCOMES[r.outcome] ? OUTCOMES[r.outcome].success : null,
  sentenceHe: r.sentence_he,
  sentenceFine: r.sentence_fine,
  paragraphs: list(r.paragraphs),
  tags: list(r.tags),
  createdBy: r.created_by,
  createdById: r.created_by_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const text = (n) => z.string().trim().max(n).default('');
const csv = (n, item) =>
  z
    .union([z.string(), z.array(z.string())])
    .default('')
    .transform((v) => (Array.isArray(v) ? v : String(v).split(',')).map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(item)).max(n))
    .transform((a) => [...new Set(a)].join(', '));

const input = z.object({
  caseId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(140),
  area: z.string().max(40).default(''),
  summary: text(3000),
  arguments: text(4000),
  result: text(2000),
  lessons: text(3000),
  outcome: z.string().max(30).default(''),
  sentenceHe: z.number().int().min(0).max(100000).nullable().optional(),
  sentenceFine: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  paragraphs: csv(15, 30),
  tags: csv(15, 30),
});

function check(d) {
  if (d.area && !areas.exists(d.area)) throw Object.assign(new Error('Dieses Rechtsgebiet gibt es nicht.'), { status: 400 });
  if (d.outcome && !OUTCOMES[d.outcome]) throw Object.assign(new Error('Dieses Ergebnis gibt es nicht.'), { status: 400 });
}

function create(data, user) {
  const d = input.parse(data);
  check(d);
  if (d.caseId && db.prepare('SELECT 1 FROM precedents WHERE case_id = ?').get(d.caseId)) throw Object.assign(new Error('Zu dieser Akte gibt es schon einen Präzedenzfall.'), { status: 409 });
  const info = db
    .prepare(
      `INSERT INTO precedents (case_id, title, area, summary, arguments, result, lessons, outcome, sentence_he, sentence_fine, paragraphs, tags, created_by, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(d.caseId || null, d.title, d.area, d.summary, d.arguments, d.result, d.lessons, d.outcome, d.sentenceHe ?? null, d.sentenceFine ?? null, d.paragraphs, d.tags, user.display_name, user.id);
  return Number(info.lastInsertRowid);
}
function update(id, data) {
  const d = input.parse(data);
  check(d);
  const cur = db.prepare('SELECT * FROM precedents WHERE id = ?').get(id);
  const caseId = d.caseId === undefined ? cur.case_id : d.caseId || null;
  if (caseId && caseId !== cur.case_id && db.prepare('SELECT 1 FROM precedents WHERE case_id = ?').get(caseId)) throw Object.assign(new Error('Zu dieser Akte gibt es schon einen Präzedenzfall.'), { status: 409 });
  db.prepare(
    `UPDATE precedents SET case_id = ?, title = ?, area = ?, summary = ?, arguments = ?, result = ?, lessons = ?, outcome = ?, sentence_he = ?, sentence_fine = ?,
       paragraphs = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(caseId, d.title, d.area, d.summary, d.arguments, d.result, d.lessons, d.outcome, d.sentenceHe ?? null, d.sentenceFine ?? null, d.paragraphs, d.tags, id);
}

/** Suche: alle Wörter müssen irgendwo vorkommen (Titel, Texte, Schlagworte, Paragraphen). */
function search({ q = '', area = '', outcome = '', tag = '', limit = 200 } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return db
    .prepare('SELECT * FROM precedents ORDER BY updated_at DESC, id DESC')
    .all()
    .filter((r) => (!area || r.area === area) && (!outcome || r.outcome === outcome) && (!tag || list(r.tags).map(fold).includes(fold(tag))))
    .filter((r) => {
      if (!words.length) return true;
      const hay = fold([r.title, r.summary, r.arguments, r.result, r.lessons, r.tags, r.paragraphs, r.area ? areas.name(r.area) : ''].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

function meta() {
  const tags = new Map();
  for (const r of db.prepare('SELECT tags FROM precedents').all()) for (const t of list(r.tags)) tags.set(t, (tags.get(t) || 0) + 1);
  return { tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40).map(([tag, n]) => ({ tag, n })), outcomes: Object.fromEntries(Object.entries(OUTCOMES).map(([k, v]) => [k, v.label])) };
}

/** Entwurf aus einer Akte: Titel, Rechtsgebiet, Sachverhalt (gekürzt), Ergebnis, Strafmaß und Paragraphen der Anklage. */
function draftFromCase(c) {
  const charges = db.prepare('SELECT para FROM case_charges WHERE case_id = ? ORDER BY id').all(c.id).map((r) => r.para);
  return {
    caseId: c.id,
    title: c.title,
    area: c.area,
    summary: String(c.description || '').slice(0, 1500),
    outcome: c.outcome || '',
    sentenceHe: c.sentence_actual_he ?? null,
    sentenceFine: c.sentence_actual_fine ?? null,
    paragraphs: [...new Set(charges.map((p) => String(p).trim()).filter(Boolean))],
    tags: [],
  };
}

/** Ähnliche Fälle zu einer Akte: gleiche Paragraphen der Anklage (3 Punkte je Treffer) und gleiches Rechtsgebiet (2 Punkte). */
function similarFor(c, { limit = 5 } = {}) {
  const mine = new Set(db.prepare('SELECT para FROM case_charges WHERE case_id = ?').all(c.id).map((r) => paraKey(r.para)).filter(Boolean));
  return db
    .prepare('SELECT * FROM precedents WHERE case_id IS NULL OR case_id != ?')
    .all(c.id)
    .map((r) => {
      const shared = list(r.paragraphs).map(paraKey).filter((k) => mine.has(k));
      return { r, score: (r.area && r.area === c.area ? 2 : 0) + shared.length * 3, shared: shared.length };
    })
    .filter((x) => x.score >= 3 || (x.score >= 2 && !mine.size))
    .sort((a, b) => b.score - a.score || b.r.id - a.r.id)
    .slice(0, limit)
    .map((x) => ({ ...row(x.r), sharedParagraphs: x.shared }));
}

module.exports = { row, create, update, search, meta, draftFromCase, similarFor, paraKey, input };
