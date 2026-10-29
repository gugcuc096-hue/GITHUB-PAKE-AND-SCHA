'use strict';
/*
 * 360°-Feedback: Das Board startet eine Runde (z. B. „Q4 2026“); alle Kanzlei-Mitglieder geben den anderen anonym
 * Rückmeldung – vier Bewertungen (1–5) und zwei Freitexte („Das läuft gut“ / „Das kann besser“). Ergebnisse sind je Person
 * zusammengefasst; Kommentare erscheinen ohne Absender und gemischt, und erst ab drei Rückmeldungen (sonst ließe sich auf
 * einzelne Personen schließen). Das Board schließt die Runde und gibt die Ergebnisse frei – danach sieht jede Person ihre
 * eigenen, das Board die aller. Wer wie viel abgegeben hat, sieht das Board (nicht, was).
 */
const crypto = require('node:crypto');
const { db } = require('./db');
const { isBoard } = require('./helpers');
const { logActivity } = require('./models');

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback_rounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','geschlossen','veroeffentlicht')),
    due_date   TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at  TEXT
  );
  CREATE TABLE IF NOT EXISTS feedback_participants (
    round_id INTEGER NOT NULL REFERENCES feedback_rounds(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (round_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS feedback_entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id      INTEGER NOT NULL REFERENCES feedback_rounds(id) ON DELETE CASCADE,
    about_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    r_team        INTEGER, r_reliable INTEGER, r_know INTEGER, r_comm INTEGER,
    strengths     TEXT NOT NULL DEFAULT '',
    improve       TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (round_id, about_user_id, from_user_id)
  );
`);

const MIN_RESPONSES = 3; // darunter werden Ergebnisse einer Person nicht gezeigt
const DIMENSIONS = { r_team: 'Zusammenarbeit', r_reliable: 'Zuverlässigkeit', r_know: 'Fachwissen', r_comm: 'Kommunikation' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const STATUS = { offen: 'Läuft', geschlossen: 'Geschlossen', veroeffentlicht: 'Ergebnisse freigegeben' };

const staffNow = () => db.prepare("SELECT id, display_name, rank, role FROM users WHERE active = 1 AND role IN ('anwalt','admin') ORDER BY display_name").all();
const round = (id) => db.prepare('SELECT * FROM feedback_rounds WHERE id = ?').get(id) || null;
const participants = (roundId) =>
  db.prepare('SELECT u.id, u.display_name AS name, u.rank FROM feedback_participants p JOIN users u ON u.id = p.user_id WHERE p.round_id = ? ORDER BY u.display_name').all(roundId);

function roundRow(r, user) {
  const parts = participants(r.id);
  const mine = parts.some((p) => p.id === user.id);
  const given = db.prepare('SELECT COUNT(*) AS n FROM feedback_entries WHERE round_id = ? AND from_user_id = ?').get(r.id, user.id).n;
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    statusLabel: STATUS[r.status],
    dueDate: r.due_date,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    participants: parts.length,
    mine,
    given,
    expected: mine ? parts.length - 1 : 0,
  };
}
const list = (user) => db.prepare('SELECT * FROM feedback_rounds ORDER BY id DESC LIMIT 20').all().map((r) => roundRow(r, user));

function start({ title, dueDate }, user) {
  if (!isBoard(user)) throw fail('Eine Runde startet das Board of Partners.', 403);
  const t = String(title || '').trim();
  if (t.length < 3 || t.length > 80) throw fail('Bitte einen Namen für die Runde angeben (z. B. „Q4 2026“).');
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw fail('Ungültiges Datum.');
  if (db.prepare("SELECT 1 FROM feedback_rounds WHERE status = 'offen'").get()) throw fail('Es läuft schon eine Runde – bitte erst schließen.', 409);
  const staff = staffNow();
  if (staff.length < MIN_RESPONSES + 1) throw fail(`Für anonyme Rückmeldungen braucht es mindestens ${MIN_RESPONSES + 1} Kanzlei-Mitglieder.`);
  const id = Number(db.prepare('INSERT INTO feedback_rounds (title, due_date, created_by) VALUES (?, ?, ?)').run(t, dueDate || null, user.id).lastInsertRowid);
  const ins = db.prepare('INSERT INTO feedback_participants (round_id, user_id) VALUES (?, ?)');
  for (const s of staff) ins.run(id, s.id);
  logActivity(user, '360°-Feedback gestartet', 'feedback', id, `${t} · ${staff.length} Personen`);
  announce(id, t, dueDate).catch(() => {});
  return id;
}

/** Direktnachricht an alle Teilnehmenden (verknüpftes Discord). */
async function announce(id, title, dueDate) {
  const { dm } = require('./memberships');
  for (const p of participants(id)) {
    await dm(p.id, { title: '🗣️ Neue Feedback-Runde', description: `**${title}** hat begonnen. Geben Sie Ihren Kolleginnen und Kollegen anonym Rückmeldung${dueDate ? ` – bis ${dueDate.split('-').reverse().join('.')}` : ''}.\n\nIm Dashboard unter „360°-Feedback“.` }).catch(() => false);
  }
}

/** Kolleginnen und Kollegen, die ich bewerten kann – mit meiner bisherigen Rückmeldung. */
function mySheet(roundId, user) {
  const r = round(roundId);
  if (!r) throw fail('Runde nicht gefunden.', 404);
  if (!participants(roundId).some((p) => p.id === user.id)) throw fail('Sie nehmen an dieser Runde nicht teil.', 403);
  const mine = new Map(db.prepare('SELECT * FROM feedback_entries WHERE round_id = ? AND from_user_id = ?').all(roundId, user.id).map((e) => [e.about_user_id, e]));
  return {
    round: roundRow(r, user),
    dimensions: DIMENSIONS,
    colleagues: participants(roundId)
      .filter((p) => p.id !== user.id)
      .map((p) => {
        const e = mine.get(p.id);
        return { id: p.id, name: p.name, rank: p.rank, given: !!e, ratings: e ? Object.fromEntries(Object.keys(DIMENSIONS).map((k) => [k, e[k]])) : null, strengths: e ? e.strengths : '', improve: e ? e.improve : '' };
      }),
  };
}

function save(roundId, aboutId, user, body) {
  const r = round(roundId);
  if (!r) throw fail('Runde nicht gefunden.', 404);
  if (r.status !== 'offen') throw fail('Diese Runde ist geschlossen.', 409);
  const parts = participants(roundId);
  if (!parts.some((p) => p.id === user.id)) throw fail('Sie nehmen an dieser Runde nicht teil.', 403);
  if (aboutId === user.id) throw fail('Über sich selbst gibt es keine Rückmeldung.');
  if (!parts.some((p) => p.id === aboutId)) throw fail('Diese Person nimmt nicht teil.', 404);
  const rating = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw fail('Bewertungen gehen von 1 bis 5.');
    return n;
  };
  const text = (v) => String(v || '').trim().slice(0, 800);
  const e = { r_team: rating(body.r_team), r_reliable: rating(body.r_reliable), r_know: rating(body.r_know), r_comm: rating(body.r_comm), strengths: text(body.strengths), improve: text(body.improve) };
  if (Object.values(e).every((v) => v === null || v === '')) throw fail('Bitte mindestens eine Bewertung oder einen Text angeben.');
  db.prepare(
    `INSERT INTO feedback_entries (round_id, about_user_id, from_user_id, r_team, r_reliable, r_know, r_comm, strengths, improve)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (round_id, about_user_id, from_user_id) DO UPDATE SET r_team = excluded.r_team, r_reliable = excluded.r_reliable, r_know = excluded.r_know,
       r_comm = excluded.r_comm, strengths = excluded.strengths, improve = excluded.improve, updated_at = datetime('now')`
  ).run(roundId, aboutId, user.id, e.r_team, e.r_reliable, e.r_know, e.r_comm, e.strengths, e.improve);
}

function setStatus(roundId, to, user) {
  if (!isBoard(user)) throw fail('Das entscheidet das Board of Partners.', 403);
  const r = round(roundId);
  if (!r) throw fail('Runde nicht gefunden.', 404);
  if (to === 'geschlossen' && r.status !== 'offen') throw fail('Die Runde ist schon geschlossen.', 409);
  if (to === 'veroeffentlicht' && r.status === 'offen') throw fail('Erst die Runde schließen.', 409);
  if (to === 'veroeffentlicht' && r.status === 'veroeffentlicht') throw fail('Die Ergebnisse sind schon freigegeben.', 409);
  db.prepare("UPDATE feedback_rounds SET status = ?, closed_at = COALESCE(closed_at, datetime('now')) WHERE id = ?").run(to, roundId);
  logActivity(user, to === 'geschlossen' ? '360°-Feedback geschlossen' : '360°-Feedback: Ergebnisse freigegeben', 'feedback', roundId, r.title);
}

/** Gemischte, aber stabile Reihenfolge: der Absender lässt sich aus der Reihenfolge nicht ablesen. */
const shuffled = (arr, seed) => arr.map((x) => [crypto.createHash('sha1').update(`${seed}:${x}`).digest('hex'), x]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);

function resultFor(roundId, aboutId) {
  const rows = db.prepare('SELECT * FROM feedback_entries WHERE round_id = ? AND about_user_id = ?').all(roundId, aboutId);
  if (rows.length < MIN_RESPONSES) return { n: rows.length, hidden: true };
  const avg = {};
  for (const k of Object.keys(DIMENSIONS)) {
    const v = rows.map((r) => r[k]).filter((x) => x != null);
    avg[k] = v.length >= MIN_RESPONSES ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }
  const seed = `${roundId}:${aboutId}`;
  return { n: rows.length, hidden: false, averages: avg, strengths: shuffled(rows.map((r) => r.strengths).filter(Boolean), seed), improve: shuffled(rows.map((r) => r.improve).filter(Boolean), seed + 'i') };
}

/** Ergebnisse: Board alle (ab „geschlossen“), alle anderen nur die eigenen (erst nach der Freigabe). */
function results(roundId, user) {
  const r = round(roundId);
  if (!r) throw fail('Runde nicht gefunden.', 404);
  const board = isBoard(user);
  if (r.status === 'offen') throw fail('Die Runde läuft noch – Ergebnisse gibt es erst danach.', 409);
  if (!board && r.status !== 'veroeffentlicht') throw fail('Das Board hat die Ergebnisse noch nicht freigegeben.', 409);
  const parts = participants(roundId);
  const people = (board ? parts : parts.filter((p) => p.id === user.id)).map((p) => ({ id: p.id, name: p.name, rank: p.rank, ...resultFor(roundId, p.id) }));
  return { round: roundRow(r, user), dimensions: DIMENSIONS, minResponses: MIN_RESPONSES, people };
}

/** Board: wer wie viel abgegeben hat (nicht, was). */
function progress(roundId, user) {
  if (!isBoard(user)) throw fail('Das sieht nur das Board of Partners.', 403);
  const r = round(roundId);
  if (!r) throw fail('Runde nicht gefunden.', 404);
  const parts = participants(roundId);
  const counts = new Map(db.prepare('SELECT from_user_id AS u, COUNT(*) AS n FROM feedback_entries WHERE round_id = ? GROUP BY from_user_id').all(roundId).map((x) => [x.u, x.n]));
  return parts.map((p) => ({ id: p.id, name: p.name, given: counts.get(p.id) || 0, expected: parts.length - 1 }));
}

module.exports = { list, start, mySheet, save, setStatus, results, progress, DIMENSIONS, MIN_RESPONSES };
