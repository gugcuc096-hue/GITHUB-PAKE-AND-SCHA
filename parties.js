'use strict';
/*
 * Beteiligte einer Akte: Gegenpartei, Zeugen, Gericht, Staatsanwaltschaft. Nur die Kanzlei sieht sie.
 * Überschneidungen: Taucht ein Beteiligter in einer anderen Akte als Mandant auf (oder umgekehrt der Mandant dieser
 * Akte als Gegenpartei einer anderen), bekommt die Akte einen Hinweis – Grundlage für die Prüfung eines Interessenkonflikts.
 */
const { db } = require('./db');

const ROLES = { gegenpartei: 'Gegenpartei', zeuge: 'Zeuge', gericht: 'Gericht', staatsanwalt: 'Staatsanwaltschaft', sonstige: 'Sonstige' };

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const row = (r) => ({ id: r.id, role: r.role, roleLabel: ROLES[r.role] || r.role, name: r.name, contact: r.contact, createdBy: r.created_by, createdAt: r.created_at });

/** Alle anderen Akten, in denen dieser Name als Mandant vorkommt. */
function asClient(name, exceptCaseId) {
  const n = norm(name);
  if (!n) return [];
  return db
    .prepare(
      `SELECT c.id, c.case_number FROM cases c LEFT JOIN users u ON u.id = c.client_id
        WHERE c.id != ? AND (LOWER(TRIM(c.client_name)) = ? OR LOWER(TRIM(u.display_name)) = ?)`
    )
    .all(exceptCaseId, n, n)
    .map((r) => ({ caseId: r.id, caseNumber: r.case_number, as: 'Mandant' }));
}

/** Alle anderen Akten, in denen dieser Name als Gegenpartei vorkommt (Feld „Gegenpartei“ oder Beteiligter). */
function asOpponent(name, exceptCaseId) {
  const n = norm(name);
  if (!n) return [];
  const a = db
    .prepare('SELECT id, case_number FROM cases WHERE id != ? AND LOWER(TRIM(opponent)) = ?')
    .all(exceptCaseId, n)
    .map((r) => ({ caseId: r.id, caseNumber: r.case_number, as: 'Gegenpartei' }));
  const b = db
    .prepare(
      `SELECT c.id, c.case_number FROM case_parties p JOIN cases c ON c.id = p.case_id
        WHERE p.case_id != ? AND p.role = 'gegenpartei' AND LOWER(TRIM(p.name)) = ?`
    )
    .all(exceptCaseId, n)
    .map((r) => ({ caseId: r.id, caseNumber: r.case_number, as: 'Gegenpartei' }));
  const seen = new Set();
  return [...a, ...b].filter((x) => !seen.has(x.caseId) && seen.add(x.caseId));
}

/** Beteiligte einer Akte, je Beteiligtem mit Überschneidungen (Mandant in einer anderen Akte). */
function listForCase(caseId) {
  return db
    .prepare('SELECT * FROM case_parties WHERE case_id = ? ORDER BY id ASC')
    .all(caseId)
    .map((r) => ({ ...row(r), overlaps: ['gegenpartei', 'zeuge'].includes(r.role) ? asClient(r.name, caseId) : [] }));
}

/** Die Gegenpartei aus dem Feld der Akte als Beteiligter gelesen: kommt sie anderswo als Mandant vor? */
function opponentOverlaps(c) {
  return c.opponent ? asClient(c.opponent, c.id) : [];
}

/** Ist der Mandant dieser Akte in einer anderen Akte Gegenpartei? */
function clientOverlaps(c, clientName) {
  return asOpponent(clientName || c.client_name, c.id);
}

module.exports = { ROLES, listForCase, opponentOverlaps, clientOverlaps, row };
