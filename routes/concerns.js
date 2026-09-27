'use strict';
/*
 * Anliegen an das Board of Partners (Führungsebene): Mitarbeiter und Mandanten reichen ein Anliegen ein
 * – auf Wunsch anonym –, das Board antwortet, schreibt interne Notizen, übernimmt und setzt den Status.
 * Jede Person sieht nur ihre eigenen Anliegen; das Board sieht alle.
 *
 * Anonymität: Das Board sieht bei anonymen Anliegen weder Namen noch Konto der einreichenden Person
 * (weder in der Oberfläche, im Protokoll noch in Discord). Gespeichert wird die Zuordnung nur, damit
 * Antworten die richtige Person erreichen.
 *
 * Discord: „concern.created“ (neues Anliegen) und „concern.updated“ (Rückmeldung der einreichenden
 * Person, Statusänderung) – Kanal und Rollen-Ping wie alle Ereignisse unter Einstellungen → Discord.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const { wrap, parseBody, idParam, truncate, isBoard } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');

const router = express.Router();
// Offen für alle angemeldeten Konten (Mandanten und Mitarbeiter).
router.use(requireAuth);

const CATEGORIES = {
  personal: 'Personal & Beförderung',
  beschwerde: 'Beschwerde / Konflikt',
  betreuung: 'Betreuung meines Mandats',
  abrechnung: 'Rechnung & Honorar',
  vorschlag: 'Vorschlag / Lob / Idee',
  organisation: 'Organisation & Abläufe',
  finanzen: 'Gehalt & Finanzen',
  sonstiges: 'Sonstiges',
};
// Welche Kategorien wer auswählen kann (das Board sieht immer alle Bezeichnungen).
const STAFF_CATEGORIES = ['personal', 'beschwerde', 'vorschlag', 'organisation', 'finanzen', 'sonstiges'];
const CLIENT_CATEGORIES = ['betreuung', 'beschwerde', 'abrechnung', 'vorschlag', 'sonstiges'];
const isStaffRole = (role) => role === 'anwalt' || role === 'admin';
const categoriesFor = (u) => Object.fromEntries((isStaffRole(u.role) ? STAFF_CATEGORIES : CLIENT_CATEGORIES).map((k) => [k, CATEGORIES[k]]));
const STATUS = { offen: 'Offen', in_bearbeitung: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
const URGENCY = { normal: 'Normal', dringend: 'Dringend' };
const CLOSED = ['erledigt', 'abgelehnt'];
const ANON = 'Anonym';

const SELECT = `
  SELECT k.*, au.rank AS author_rank, asg.display_name AS assigned_name,
         (SELECT COUNT(*) FROM concern_messages m WHERE m.concern_id = k.id AND m.system = 0 AND m.internal = 0) AS reply_count
  FROM concerns k
  LEFT JOIN users au ON au.id = k.author_id
  LEFT JOIN users asg ON asg.id = k.assigned_to`;

/** Gruppe der einreichenden Person (bleibt auch bei anonymen Anliegen sichtbar). */
const groupLabel = (k) => (k.author_group === 'mandant' ? 'Mandant' : 'Mitarbeiter');

/** Name der einreichenden Person aus Sicht des Betrachters. */
function authorLabel(k, viewer) {
  if (k.author_id === viewer.id) return 'Sie';
  return k.anonymous ? ANON : k.author_name;
}

function row(k, viewer) {
  const mine = k.author_id === viewer.id;
  return {
    id: k.id,
    subject: k.subject,
    category: k.category,
    categoryLabel: CATEGORIES[k.category] || k.category,
    urgency: k.urgency,
    status: k.status,
    statusLabel: STATUS[k.status] || k.status,
    closed: CLOSED.includes(k.status),
    anonymous: !!k.anonymous,
    mine,
    author: authorLabel(k, viewer),
    authorGroup: k.author_group,
    authorGroupLabel: groupLabel(k),
    authorRank: k.author_group === 'mandant' || (k.anonymous && !mine) ? null : k.author_rank || null,
    assignedTo: k.assigned_to,
    assignedName: k.assigned_name || null,
    replyCount: k.reply_count,
    // Für die einreichende Person: Das Board hat seit dem letzten Öffnen geantwortet oder den Status geändert.
    unseen: mine && !!k.board_activity_at && (!k.author_seen_at || k.board_activity_at > k.author_seen_at),
    createdAt: k.created_at,
    updatedAt: k.updated_at,
    closedAt: k.closed_at,
  };
}

function messageRow(m, k, viewer) {
  let author;
  if (m.system) author = 'System';
  else if (m.from_board) author = m.author_name;
  else author = m.author_id === viewer.id ? 'Sie' : k.anonymous ? ANON : m.author_name;
  return { id: m.id, author, fromBoard: !!m.from_board, internal: !!m.internal, system: !!m.system, body: m.body, createdAt: m.created_at };
}

function load(req, res) {
  const id = idParam(req);
  const k = id && db.prepare(`${SELECT} WHERE k.id = ?`).get(id);
  // Fremde Anliegen sind für Nicht-Board-Mitglieder unsichtbar (404 statt 403).
  if (!k || (!isBoard(req.user) && k.author_id !== req.user.id)) {
    res.status(404).json({ error: 'Anliegen nicht gefunden.' });
    return null;
  }
  return k;
}

function notify(event, k, title, extra = [], description) {
  discord.notify(event, {
    title,
    description: description ? truncate(description, 700) : undefined,
    color: k.urgency === 'dringend' ? discord.RED : discord.GOLD,
    fields: [
      { name: 'Betreff', value: truncate(k.subject, 200) },
      { name: 'Kategorie', value: CATEGORIES[k.category] || k.category },
      { name: 'Von', value: `${k.anonymous ? ANON : k.author_name} (${groupLabel(k)})` },
      ...extra,
    ],
  });
}

/* ---------------------------------------------------------------- Liste & Zähler */
router.get('/', (req, res) => {
  const u = req.user;
  const board = isBoard(u);
  // Board-Mitglieder sehen alle Anliegen („all“) oder nur die selbst eingereichten („mine“).
  const scope = board && req.query.scope !== 'mine' ? 'all' : 'mine';
  const rows = (scope === 'all'
    ? db.prepare(`${SELECT} ORDER BY CASE WHEN k.status IN ('erledigt','abgelehnt') THEN 1 ELSE 0 END, CASE k.urgency WHEN 'dringend' THEN 0 ELSE 1 END, k.updated_at DESC`).all()
    : db.prepare(`${SELECT} WHERE k.author_id = ? ORDER BY k.updated_at DESC`).all(u.id)
  ).map((k) => row(k, u));
  res.json({ concerns: rows, scope, board, categories: CATEGORIES, myCategories: categoriesFor(u), statuses: STATUS, urgencies: URGENCY });
});

/** Zähler für die Navigation: Board = offene Anliegen, alle = eigene mit neuer Antwort. */
router.get('/counts', (req, res) => {
  const u = req.user;
  // Eigene Anliegen zählen für Board-Mitglieder nicht als „offen zu bearbeiten“.
  const open = isBoard(u) ? db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE status = 'offen' AND author_id IS NOT ?").get(u.id).n : 0;
  const unseen = db
    .prepare('SELECT COUNT(*) AS n FROM concerns WHERE author_id = ? AND board_activity_at IS NOT NULL AND (author_seen_at IS NULL OR board_activity_at > author_seen_at)')
    .get(u.id).n;
  res.json({ open, unseen, total: open + unseen });
});

/* ---------------------------------------------------------------- Einreichen */
router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        category: z.string(),
        urgency: z.enum(Object.keys(URGENCY)).default('normal'),
        subject: z.string().trim().min(3).max(150),
        body: z.string().trim().min(10).max(5000),
        anonymous: z.boolean().optional(),
      }),
      req,
      res
    );
    if (!d) return;
    const u = req.user;
    if (!Object.hasOwn(categoriesFor(u), d.category)) return res.status(400).json({ error: 'Bitte eine gültige Kategorie wählen.' });
    const recent = db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE author_id = ? AND created_at > datetime('now', '-1 hour')").get(u.id).n;
    if (recent >= 10) return res.status(429).json({ error: 'Zu viele Anliegen in kurzer Zeit. Bitte später erneut versuchen.' });
    const info = db
      .prepare(
        "INSERT INTO concerns (author_id, author_name, author_group, anonymous, category, urgency, subject, body, author_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
      )
      .run(u.id, u.display_name, isStaffRole(u.role) ? 'mitarbeiter' : 'mandant', d.anonymous ? 1 : 0, d.category, d.urgency, d.subject, d.body);
    const k = db.prepare(`${SELECT} WHERE k.id = ?`).get(Number(info.lastInsertRowid));
    notify('concern.created', k, `📨 Neues Anliegen an das Board of Partners`, [{ name: 'Dringlichkeit', value: URGENCY[k.urgency] }], k.body);
    // Anonyme Anliegen erscheinen nicht im Protokoll (dort stünde sonst der Name).
    if (!k.anonymous) logActivity(u, 'Anliegen ans Board eingereicht', 'concern', k.id, truncate(k.subject, 120));
    res.status(201).json({ concern: row(k, u) });
  })
);

/* ---------------------------------------------------------------- Detail */
router.get('/:id', (req, res) => {
  const k = load(req, res);
  if (!k) return;
  const u = req.user;
  const board = isBoard(u);
  if (k.author_id === u.id) db.prepare("UPDATE concerns SET author_seen_at = datetime('now') WHERE id = ?").run(k.id);
  const messages = db
    .prepare('SELECT * FROM concern_messages WHERE concern_id = ? ORDER BY created_at ASC, id ASC')
    .all(k.id)
    // Interne Notizen: nur für das Board – nie für die einreichende Person (auch wenn sie selbst im Board ist).
    .filter((m) => (board && k.author_id !== u.id) || !m.internal)
    .map((m) => messageRow(m, k, u));
  const boardMembers = board
    ? db
        .prepare("SELECT id, display_name, rank FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'anwalt' AND rank IN ('Founding Partner','Equity Partner','Partner'))) ORDER BY display_name")
        .all()
        .map((b) => ({ id: b.id, name: b.display_name, rank: b.rank }))
    : undefined;
  const boardReplies = db.prepare('SELECT COUNT(*) AS n FROM concern_messages WHERE concern_id = ? AND from_board = 1').get(k.id).n;
  res.json({
    concern: { ...row(k, u), body: k.body },
    messages,
    board,
    boardMembers,
    statuses: STATUS,
    canWithdraw: k.author_id === u.id && k.status === 'offen' && !boardReplies,
    canDelete: u.role === 'admin' && k.author_id !== u.id,
  });
});

/* ---------------------------------------------------------------- Antworten */
router.post(
  '/:id/messages',
  wrap(async (req, res) => {
    const k = load(req, res);
    if (!k) return;
    const u = req.user;
    const board = isBoard(u);
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional() }), req, res);
    if (!d) return;
    const mine = k.author_id === u.id;
    // Das eigene Anliegen beantwortet man als einreichende Person (auch wenn man selbst im Board ist).
    const asBoard = board && !mine;
    const internal = asBoard && !!d.internal;
    if (!asBoard && CLOSED.includes(k.status)) {
      return res.status(400).json({ error: 'Dieses Anliegen ist abgeschlossen. Für etwas Neues bitte ein neues Anliegen einreichen.' });
    }
    tx(() => {
      db.prepare('INSERT INTO concern_messages (concern_id, author_id, author_name, from_board, internal, body) VALUES (?, ?, ?, ?, ?, ?)').run(
        k.id,
        u.id,
        u.display_name,
        asBoard ? 1 : 0,
        internal ? 1 : 0,
        d.body
      );
      if (asBoard && !internal) db.prepare("UPDATE concerns SET board_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(k.id);
      else if (!asBoard) db.prepare("UPDATE concerns SET updated_at = datetime('now'), author_seen_at = datetime('now') WHERE id = ?").run(k.id);
      // Antwort des Boards auf ein offenes Anliegen: automatisch „In Bearbeitung“
      if (asBoard && !internal && k.status === 'offen') {
        db.prepare("UPDATE concerns SET status = 'in_bearbeitung', assigned_to = COALESCE(assigned_to, ?) WHERE id = ?").run(u.id, k.id);
      }
    });
    if (!asBoard) notify('concern.updated', k, `💬 Rückmeldung zu einem Anliegen ans Board`, [{ name: 'Status', value: STATUS[k.status] }], d.body);
    res.status(201).json({ success: true });
  })
);

/* ---------------------------------------------------------------- Status / Zuständigkeit (Board) */
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const k = load(req, res);
    if (!k) return;
    const u = req.user;
    if (!isBoard(u)) return res.status(403).json({ error: 'Nur das Board of Partners kann den Status ändern.' });
    if (k.author_id === u.id) return res.status(403).json({ error: 'Über das eigene Anliegen entscheidet ein anderes Mitglied des Board of Partners.' });
    const d = parseBody(z.object({ status: z.enum(Object.keys(STATUS)).optional(), assignedTo: z.number().int().positive().nullable().optional() }), req, res);
    if (!d) return;
    const notes = [];
    const sets = [];
    const values = [];
    if (d.status && d.status !== k.status) {
      sets.push('status = ?', 'closed_at = ?');
      values.push(d.status, CLOSED.includes(d.status) ? new Date().toISOString() : null);
      notes.push(`Status: ${STATUS[k.status]} → ${STATUS[d.status]} (${u.display_name})`);
    }
    if (d.assignedTo !== undefined && d.assignedTo !== k.assigned_to) {
      let name = null;
      if (d.assignedTo !== null) {
        const m = db
          .prepare("SELECT id, display_name FROM users WHERE id = ? AND active = 1 AND (role = 'admin' OR (role = 'anwalt' AND rank IN ('Founding Partner','Equity Partner','Partner')))")
          .get(d.assignedTo);
        if (!m) return res.status(400).json({ error: 'Zuständig kann nur ein Mitglied des Board of Partners sein.' });
        name = m.display_name;
      }
      sets.push('assigned_to = ?');
      values.push(d.assignedTo);
      notes.push(name ? `Zuständig im Board: ${name}` : 'Zuständigkeit im Board aufgehoben');
    }
    if (!sets.length) return res.json({ success: true });
    tx(() => {
      db.prepare(`UPDATE concerns SET ${sets.join(', ')}, updated_at = datetime('now'), board_activity_at = datetime('now') WHERE id = ?`).run(...values, k.id);
      db.prepare('INSERT INTO concern_messages (concern_id, author_id, author_name, from_board, system, body) VALUES (?, ?, ?, 1, 1, ?)').run(k.id, u.id, u.display_name, notes.join(' · '));
    });
    if (d.status && d.status !== k.status) {
      notify('concern.updated', k, `📋 Anliegen ans Board: ${STATUS[d.status]}`, [{ name: 'Geändert von', value: u.display_name }]);
      logActivity(u, 'Anliegen ans Board: Status', 'concern', k.id, `${truncate(k.subject, 80)}: ${STATUS[d.status]}`);
    }
    res.json({ success: true });
  })
);

/** Zurückziehen (eigenes, noch unbeantwortetes Anliegen) bzw. Löschen durch das Board. */
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const k = load(req, res);
    if (!k) return;
    const u = req.user;
    const boardReplies = db.prepare('SELECT COUNT(*) AS n FROM concern_messages WHERE concern_id = ? AND from_board = 1').get(k.id).n;
    const canWithdraw = k.author_id === u.id && k.status === 'offen' && !boardReplies;
    if (!canWithdraw && u.role !== 'admin') {
      return res.status(403).json({ error: 'Zurückziehen geht nur, solange das Board noch nicht reagiert hat.' });
    }
    db.prepare('DELETE FROM concerns WHERE id = ?').run(k.id);
    res.json({ success: true });
  })
);

module.exports = { router, CATEGORIES, STATUS };
