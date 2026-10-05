'use strict';
/*
 * Globale Suche im Dashboard (Strg + K): Akten, Mandanten, Rechnungen, Aufgaben, Termine und Kanzlei-Post.
 * Gesucht wird nur in dem, was die angemeldete Person auch sonst sehen darf:
 *  - Kanzlei: alle Akten, Mandantenkonten, Rechnungen, Aufgaben und Termine, eigene Post
 *  - Mandanten: eigene Akten, eigene Rechnungen, freigegebene Termine, eigene Post
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { CASE_SELECT, caseRow, APPT_SELECT, apptRow, apptVisible, INVOICE_SELECT, invoiceRow, TASK_SELECT, taskRow, MESSAGE_SELECT, messageRow } = require('../models');

const router = express.Router();
router.use(requireAuth);

const LIMIT = 6;

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

  res.json({ q, results: { cases, clients, invoices, tasks, events, messages } });
});

module.exports = router;
