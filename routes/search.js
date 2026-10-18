'use strict';
/*
 * Globale Suche im Dashboard (Strg + K): Akten, Mandanten, Rechnungen, Aufgaben, Termine, Kanzlei-Post,
 * Notizen & Chat der Akten, Kanzlei-Wiki und Strafgesetzbuch.
 * Gesucht wird nur in dem, was die angemeldete Person auch sonst sehen darf:
 *  - Kanzlei: alle Akten, Mandantenkonten, Rechnungen, Aufgaben und Termine, eigene Post, Notizen (auch interne), Wiki, StGB
 *  - Mandanten: eigene Akten, eigene Rechnungen, freigegebene Termine, eigene Post, Chat der eigenen Akten (nie interne Notizen)
 * Die Suche denkt mit: Umlaute zählen gleich (Müller = Mueller = Muller) und kleine Tippfehler finden trotzdem
 * Akten und Mandanten („Mülller“, „Schmitd“). Die gefundenen Wörter gehen als „terms“ mit – das Dashboard hebt sie hervor.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { CASE_SELECT, caseRow, APPT_SELECT, apptRow, apptVisible, INVOICE_SELECT, invoiceRow, TASK_SELECT, taskRow, MESSAGE_SELECT, messageRow } = require('../models');

const router = express.Router();
router.use(requireAuth);

const LIMIT = 6;

/** Für den Vergleich: klein, Umlaute ausgeschrieben, ohne Akzente. */
const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

/** Levenshtein-Abstand, bricht ab sobald er über max liegt. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const tolerance = (t) => (t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0);

/**
 * Passt der Text zu allen Suchwörtern (enthalten oder mit kleinem Tippfehler)? Liefert die getroffenen Wörter
 * (Originalschreibweise, zum Hervorheben) – oder null.
 */
function fuzzyMatch(text, terms) {
  const words = String(text || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const folded = words.map(fold);
  const hits = [];
  for (const t of terms) {
    const tol = tolerance(t);
    let found = -1;
    for (let i = 0; i < words.length && found < 0; i++) {
      const w = folded[i];
      if (w.includes(t) || (tol && (distance(w, t, tol) <= tol || (w.length > t.length && distance(w.slice(0, t.length), t, tol) <= tol)))) found = i;
    }
    if (found < 0) return null;
    hits.push(words[found]);
  }
  return hits;
}

/** Ausschnitt rund um den ersten Treffer. */
function snippet(text, terms) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const f = fold(s);
  let at = -1;
  for (const t of terms) if ((at = f.indexOf(t)) >= 0) break;
  if (at < 0 || s.length <= 140) return s.slice(0, 140);
  const start = Math.max(0, at - 50);
  return `${start ? '… ' : ''}${s.slice(start, start + 140)}${start + 140 < s.length ? ' …' : ''}`;
}

router.get('/', (req, res) => {
  const u = req.user;
  const staff = isStaff(u);
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ q, results: {} });
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const L = (col) => `${col} LIKE ? ESCAPE '\\'`;

  // Akten (Kanzlei: alle, Mandant: eigene); Treffer im Aktenzeichen zuerst, offene vor geschlossenen
  const caseWhere = [L('c.case_number'), L('c.title'), L('c.client_name'), L('cu.display_name'), L('c.opponent'), L('c.court_ref')];
  const caseArgs = Array(caseWhere.length).fill(like);
  if (staff) {
    // auch per FiveNet-/Google-Link oder Dokument-ID (wie die Aktensuche)
    caseWhere.push("c.id IN (SELECT case_id FROM case_external_docs WHERE external_id = ? OR canonical_url = ? OR original_url = ?)");
    caseArgs.push(q, q, q);
  }
  const cases = db
    .prepare(
      `${CASE_SELECT} WHERE (${caseWhere.join(' OR ')}) ${staff ? '' : 'AND c.client_id = ?'}
       ORDER BY (c.case_number LIKE ? ESCAPE '\\') DESC, (c.status = 'geschlossen'), c.updated_at DESC LIMIT 8`
    )
    .all(...caseArgs, ...(staff ? [] : [u.id]), like)
    .map((c) => caseRow(c, u));

  // Mandantenkonten (nur Kanzlei)
  const clients = staff
    ? db
        .prepare(
          `SELECT u.id, u.display_name, u.email, u.phone, u.active,
                  (SELECT COUNT(*) FROM cases c WHERE c.client_id = u.id) AS case_count
           FROM users u WHERE u.role = 'mandant' AND (${L('u.display_name')} OR ${L('u.email')} OR ${L('u.phone')})
           ORDER BY u.active DESC, u.display_name LIMIT ${LIMIT}`
        )
        .all(like, like, like)
        .map((r) => ({ id: r.id, name: r.display_name, email: r.email, phone: r.phone || '', active: !!r.active, caseCount: r.case_count }))
    : [];

  // Rechnungen
  const invoices = db
    .prepare(
      `${INVOICE_SELECT} WHERE (${L('i.number')} OR ${L('i.client_name')} OR ${L('i.subject')} OR ${L('c.case_number')})
       ${staff ? '' : 'AND (c.client_id = ? OR i.client_user_id = ?)'}
       ORDER BY (i.status = 'offen') DESC, i.created_at DESC LIMIT ${LIMIT}`
    )
    .all(like, like, like, like, ...(staff ? [] : [u.id, u.id]))
    .map(invoiceRow);

  // Aufgaben (nur Kanzlei)
  const tasks = staff
    ? db
        .prepare(`${TASK_SELECT} WHERE (${L('t.title')} OR ${L('t.note')}) ORDER BY t.done ASC, t.due_date IS NULL, t.due_date ASC LIMIT ${LIMIT}`)
        .all(like, like)
        .map(taskRow)
    : [];

  // Termine & Fristen (Mandant: nur freigegebene eigene) – nächstgelegene zuerst
  const events = db
    .prepare(
      `${APPT_SELECT} WHERE (${L('a.title')} OR ${L('a.location')} OR ${L('a.note')} OR ${L('c.case_number')})
       ${staff ? '' : 'AND a.client_visible = 1 AND (a.client_id = ? OR c.client_id = ?)'}
       ORDER BY abs(julianday(a.starts_at) - julianday('now')) LIMIT 20`
    )
    .all(like, like, like, like, ...(staff ? [] : [u.id, u.id]))
    .filter((a) => apptVisible(a, u))
    .slice(0, LIMIT)
    .map((a) => apptRow(a, u));

  // Kanzlei-Post: nur eigene Nachrichten (Eingang und Gesendet)
  const messages = db
    .prepare(
      `${MESSAGE_SELECT} WHERE ((m.recipient_id = ? AND m.recipient_deleted = 0) OR (m.sender_id = ? AND m.sender_deleted = 0))
         AND (${L('m.subject')} OR ${L('m.body')})
       ORDER BY m.created_at DESC LIMIT ${LIMIT}`
    )
    .all(u.id, u.id, like, like)
    .map((m) => ({ ...messageRow(m), box: m.recipient_id === u.id ? 'inbox' : 'sent', body: undefined, preview: String(m.body || '').slice(0, 140) }));

  const terms = [...new Set(fold(q).split(/\s+/).filter((t) => t.length >= 2))];
  const hitWords = new Set();

  // Tippfehler & Umlaute: fehlen Akten oder Mandanten, unscharf nachsuchen (nur in dem, was die Person sehen darf)
  if (terms.length && cases.length < 8) {
    const have = new Set(cases.map((c) => c.id));
    const pool = db.prepare(`${CASE_SELECT} ${staff ? '' : 'WHERE c.client_id = ?'} ORDER BY (c.status = 'geschlossen'), c.updated_at DESC LIMIT 3000`).all(...(staff ? [] : [u.id]));
    for (const c of pool) {
      if (cases.length >= 8) break;
      if (have.has(c.id)) continue;
      const hit = fuzzyMatch(`${c.case_number} ${c.title} ${c.client_name || ''} ${c.client_account_name || ''} ${c.opponent || ''}`, terms);
      if (!hit) continue;
      hit.forEach((w) => hitWords.add(w));
      cases.push(caseRow(c, u));
    }
  }
  if (staff && terms.length && clients.length < LIMIT) {
    const have = new Set(clients.map((c) => c.id));
    const pool = db
      .prepare(
        `SELECT u.id, u.display_name, u.email, u.phone, u.active, (SELECT COUNT(*) FROM cases c WHERE c.client_id = u.id) AS case_count
         FROM users u WHERE u.role = 'mandant' ORDER BY u.active DESC, u.display_name LIMIT 3000`
      )
      .all();
    for (const r of pool) {
      if (clients.length >= LIMIT) break;
      if (have.has(r.id)) continue;
      const hit = fuzzyMatch(r.display_name, terms);
      if (!hit) continue;
      hit.forEach((w) => hitWords.add(w));
      clients.push({ id: r.id, name: r.display_name, email: r.email, phone: r.phone || '', active: !!r.active, caseCount: r.case_count });
    }
  }

  // Notizen & Chat der Akten: Kanzlei alles außer Systemeinträgen, Mandanten nur den Chat der eigenen Akten
  const variants = [...new Set([q, q.replace(/ae/gi, 'ä').replace(/oe/gi, 'ö').replace(/ue/gi, 'ü')])];
  const noteLike = variants.map(() => L('n.body')).join(' OR ');
  const notes = db
    .prepare(
      `SELECT n.id, n.case_id, n.author_name, n.body, n.internal, n.created_at, c.case_number, c.title AS case_title
       FROM notes n JOIN cases c ON c.id = n.case_id
       WHERE n.system = 0 AND (${noteLike}) ${staff ? '' : 'AND n.internal = 0 AND c.client_id = ?'}
       ORDER BY n.created_at DESC LIMIT ${LIMIT}`
    )
    .all(...variants.map((v) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`), ...(staff ? [] : [u.id]))
    .map((n) => ({ id: n.id, caseId: n.case_id, caseNumber: n.case_number, caseTitle: n.case_title, author: n.author_name, internal: !!n.internal, createdAt: n.created_at, preview: snippet(n.body, terms) }));

  // Kanzlei-Wiki und Strafgesetzbuch (nur Kanzlei)
  let wiki = [];
  let penal = [];
  if (staff && terms.length) {
    const { plain } = require('./wiki');
    wiki = db
      .prepare('SELECT id, title, category, body FROM wiki_articles ORDER BY pinned DESC, updated_at DESC')
      .all()
      .map((a) => ({ a, text: plain(a.body) }))
      .filter(({ a, text }) => terms.every((t) => fold(`${a.title} ${a.category} ${text}`).includes(t)) || fuzzyMatch(a.title, terms))
      .slice(0, LIMIT)
      .map(({ a, text }) => ({ id: a.id, title: a.title, category: a.category, preview: snippet(text, terms) }));
    const p = require('../penal');
    const para = q.replace(/^§\s*/, '').trim().toLowerCase();
    penal = p
      .laws()
      .filter((l) => l.para === para || fuzzyMatch(`${l.title} ${l.chapterTitle}`, terms) || terms.every((t) => fold(l.title).includes(t)))
      .sort((a, b) => (b.para === para) - (a.para === para))
      .slice(0, LIMIT)
      .map((l, i) => ({ id: i + 1, para: l.para, title: l.title, chapter: l.chapterTitle }));
  }

  res.json({ q, terms: [...hitWords], results: { cases, clients, notes, invoices, tasks, events, messages, wiki, penal } });
});

module.exports = router;
