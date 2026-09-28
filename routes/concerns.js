'use strict';
/*
 * Anliegen an das Board of Partners (Führungsebene): Jeder kann ein Anliegen einreichen – Mitarbeiter
 * und Mandanten im Dashboard, alle anderen direkt auf der Startseite (auch ohne Konto) –, auf Wunsch anonym.
 * Einsehen und bearbeiten kann die Anliegen nur das Board of Partners (Menübereich „Board of Partners“):
 * antworten, interne Notizen, Zuständigkeit, Status. Einreichende sehen nur ihre eigenen Anliegen –
 * im Dashboard oder auf der Startseite mit Vorgangsnummer + Pin.
 *
 * Anonymität: Das Board sieht bei anonymen Anliegen weder Namen noch Konto noch Kontakt der einreichenden
 * Person (weder in der Oberfläche, im Protokoll noch in Discord) – nur, ob sie Mitarbeiter, Mandant oder
 * Website-Besucher ist. Gespeichert wird die Zuordnung nur, damit Antworten die richtige Person erreichen.
 *
 * Discord: „concern.created“ (neues Anliegen) und „concern.updated“ (Rückmeldung der einreichenden
 * Person, Statusänderung) – Kanal und Rollen-Ping wie alle Ereignisse unter Einstellungen → Discord.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, nextConcernNumber, randomPin } = require('../db');
const { requireAuth } = require('../auth');
const { wrap, parseBody, idParam, truncate, isBoard } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');

const CATEGORIES = {
  personal: 'Personal & Beförderung',
  beschwerde: 'Beschwerde / Konflikt',
  betreuung: 'Betreuung meines Mandats',
  abrechnung: 'Rechnung & Honorar',
  kooperation: 'Anfrage / Zusammenarbeit',
  vorschlag: 'Vorschlag / Lob / Idee',
  organisation: 'Organisation & Abläufe',
  finanzen: 'Gehalt & Finanzen',
  sonstiges: 'Sonstiges',
};
// Welche Kategorien wer auswählen kann (das Board sieht immer alle Bezeichnungen).
const STAFF_CATEGORIES = ['personal', 'beschwerde', 'vorschlag', 'organisation', 'finanzen', 'sonstiges'];
const OTHER_CATEGORIES = ['betreuung', 'beschwerde', 'abrechnung', 'kooperation', 'vorschlag', 'sonstiges'];
const STATUS = { offen: 'Offen', in_bearbeitung: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
const URGENCY = { normal: 'Normal', dringend: 'Dringend' };
const CLOSED = ['erledigt', 'abgelehnt'];
const ANON = 'Anonym';
const GROUPS = { mitarbeiter: 'Mitarbeiter', mandant: 'Mandant', extern: 'über die Website' };

const isStaffRole = (role) => role === 'anwalt' || role === 'admin';
/** Kategorien zur Auswahl – für Mitarbeiter andere als für Mandanten und Website-Besucher (u = null). */
const categoriesFor = (u) => Object.fromEntries((u && isStaffRole(u.role) ? STAFF_CATEGORIES : OTHER_CATEGORIES).map((k) => [k, CATEGORIES[k]]));
const groupOf = (u) => (!u ? 'extern' : isStaffRole(u.role) ? 'mitarbeiter' : 'mandant');
const groupLabel = (k) => GROUPS[k.author_group] || GROUPS.mitarbeiter;

const SELECT = `
  SELECT k.*, au.rank AS author_rank, asg.display_name AS assigned_name,
         (SELECT COUNT(*) FROM concern_messages m WHERE m.concern_id = k.id AND m.system = 0 AND m.internal = 0) AS reply_count
  FROM concerns k
  LEFT JOIN users au ON au.id = k.author_id
  LEFT JOIN users asg ON asg.id = k.assigned_to`;

const BOARD_MEMBER_SQL = "active = 1 AND (role = 'admin' OR (role = 'anwalt' AND rank IN ('Founding Partner','Equity Partner','Partner')))";

/** Name der einreichenden Person aus Sicht des Betrachters. */
function authorLabel(k, viewer) {
  if (viewer && k.author_id && k.author_id === viewer.id) return 'Sie';
  return k.anonymous ? ANON : k.author_name;
}

function row(k, viewer) {
  const mine = !!viewer && !!k.author_id && k.author_id === viewer.id;
  const board = isBoard(viewer);
  return {
    id: k.id,
    reference: k.reference,
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
    authorRank: k.author_group !== 'mitarbeiter' || (k.anonymous && !mine) ? null : k.author_rank || null,
    // Kontakt (Telefon/Discord) von Website-Einreichungen – nur für das Board und nie bei anonymen Anliegen
    contact: board && !k.anonymous && k.contact ? k.contact : null,
    source: k.source,
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

/** Nachricht aus Sicht des Betrachters; asAuthor = Sicht der einreichenden Person (auch ohne Konto). */
function messageRow(m, k, viewer, asAuthor = false) {
  let author;
  if (m.system) author = 'System';
  else if (m.from_board) author = m.author_name;
  else author = asAuthor || (viewer && k.author_id && m.author_id === viewer.id) ? 'Sie' : k.anonymous ? ANON : m.author_name;
  return { id: m.id, author, fromBoard: !!m.from_board, internal: !!m.internal, system: !!m.system, body: m.body, createdAt: m.created_at };
}

function notify(event, k, title, extra = [], description) {
  discord.notify(event, {
    title,
    description: description ? truncate(description, 700) : undefined,
    color: k.urgency === 'dringend' ? discord.RED : discord.GOLD,
    fields: [
      { name: 'Vorgang', value: k.reference || '—' },
      { name: 'Betreff', value: truncate(k.subject, 200) },
      { name: 'Kategorie', value: CATEGORIES[k.category] || k.category },
      { name: 'Von', value: `${k.anonymous ? ANON : k.author_name} (${groupLabel(k)})` },
      ...(!k.anonymous && k.contact ? [{ name: 'Kontakt', value: truncate(k.contact, 100) }] : []),
      ...extra,
    ],
  });
}

const concernSchema = {
  category: z.string().max(40),
  urgency: z.enum(Object.keys(URGENCY)).default('normal'),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(10).max(5000),
  anonymous: z.boolean().optional(),
};

/**
 * Legt ein Anliegen an (Dashboard oder Startseite). user = angemeldetes Konto oder null (Website ohne Konto).
 * Liefert { concern, pin } bzw. { error, status }.
 */
function createConcern({ user, name, contact = '', source, d }) {
  if (!Object.hasOwn(categoriesFor(user), d.category)) return { status: 400, error: 'Bitte eine gültige Kategorie wählen.' };
  if (user) {
    const recent = db.prepare("SELECT COUNT(*) AS n FROM concerns WHERE author_id = ? AND created_at > datetime('now', '-1 hour')").get(user.id).n;
    if (recent >= 10) return { status: 429, error: 'Zu viele Anliegen in kurzer Zeit. Bitte später erneut versuchen.' };
  }
  const pin = randomPin();
  const id = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO concerns (reference, access_pin, author_id, author_name, author_group, anonymous, category, urgency, subject, body, contact, source, author_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        nextConcernNumber(),
        pin,
        user ? user.id : null,
        user ? user.display_name : name || ANON,
        groupOf(user),
        d.anonymous ? 1 : 0,
        d.category,
        d.urgency,
        d.subject,
        d.body,
        contact,
        source
      );
    return Number(info.lastInsertRowid);
  });
  const k = db.prepare(`${SELECT} WHERE k.id = ?`).get(id);
  notify('concern.created', k, '📨 Neues Anliegen an das Board of Partners', [{ name: 'Dringlichkeit', value: URGENCY[k.urgency] }], k.body);
  tickets.boardCreated('concern', k.id);
  // Anonyme Anliegen erscheinen nicht im Protokoll (dort stünde sonst der Name).
  if (user && !k.anonymous) logActivity(user, 'Anliegen ans Board eingereicht', 'concern', k.id, `${k.reference}: ${truncate(k.subject, 110)}`);
  return { concern: k, pin };
}

/** Nachricht der einreichenden Person (Dashboard oder Startseite). Liefert eine Fehlermeldung oder null. */
function addAuthorMessage(k, body, user) {
  if (CLOSED.includes(k.status)) return 'Dieses Anliegen ist abgeschlossen. Für etwas Neues bitte ein neues Anliegen einreichen.';
  tx(() => {
    db.prepare('INSERT INTO concern_messages (concern_id, author_id, author_name, from_board, internal, body) VALUES (?, ?, ?, 0, 0, ?)').run(
      k.id,
      user ? user.id : k.author_id,
      user ? user.display_name : k.author_name,
      body
    );
    db.prepare("UPDATE concerns SET updated_at = datetime('now'), author_seen_at = datetime('now') WHERE id = ?").run(k.id);
  });
  notify('concern.updated', k, '💬 Rückmeldung zu einem Anliegen ans Board', [{ name: 'Status', value: STATUS[k.status] }], body);
  tickets.boardPost('concern', k.id, {
    title: `💬 Rückmeldung von ${k.anonymous ? 'Anonym' : k.author_name} (${groupLabel(k)})`,
    description: body,
    color: tickets.COLORS.blue,
  });
  return null;
}

/* ================================================================ Dashboard (angemeldet) */
const router = express.Router();
router.use(requireAuth);

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

/* ---------------------------------------------------------------- Liste & Zähler */
router.get('/', (req, res) => {
  const u = req.user;
  const board = isBoard(u);
  // „mine“ (Standard): die eigenen Anliegen. „all“: alle Anliegen – nur für das Board of Partners.
  if (req.query.scope === 'all' && !board) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const rows = (scope === 'all'
    ? db.prepare(`${SELECT} ORDER BY CASE WHEN k.status IN ('erledigt','abgelehnt') THEN 1 ELSE 0 END, CASE k.urgency WHEN 'dringend' THEN 0 ELSE 1 END, k.updated_at DESC`).all()
    : db.prepare(`${SELECT} WHERE k.author_id = ? ORDER BY k.updated_at DESC`).all(u.id)
  ).map((k) => row(k, u));
  res.json({ concerns: rows, scope, board, categories: CATEGORIES, myCategories: categoriesFor(u), statuses: STATUS, urgencies: URGENCY });
});

/** Zähler für die Navigation: Board = offene Anliegen (ohne eigene), alle = eigene mit neuer Antwort. */
router.get('/counts', (req, res) => {
  const u = req.user;
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
    const d = parseBody(z.object(concernSchema), req, res);
    if (!d) return;
    const r = createConcern({ user: req.user, source: 'dashboard', d });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.status(201).json({ concern: row(r.concern, req.user) });
  })
);

/* ---------------------------------------------------------------- Detail */
router.get('/:id', (req, res) => {
  const k = load(req, res);
  if (!k) return;
  const u = req.user;
  const board = isBoard(u);
  const mine = k.author_id === u.id;
  if (mine) db.prepare("UPDATE concerns SET author_seen_at = datetime('now') WHERE id = ?").run(k.id);
  const messages = db
    .prepare('SELECT * FROM concern_messages WHERE concern_id = ? ORDER BY created_at ASC, id ASC')
    .all(k.id)
    // Interne Notizen: nur für das Board – nie für die einreichende Person (auch wenn sie selbst im Board ist).
    .filter((m) => (board && !mine) || !m.internal)
    .map((m) => messageRow(m, k, u));
  const boardMembers = board
    ? db
        .prepare(`SELECT id, display_name, rank FROM users WHERE ${BOARD_MEMBER_SQL} ORDER BY display_name`)
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
    canWithdraw: mine && k.status === 'offen' && !boardReplies,
    canDelete: u.role === 'admin' && !mine,
    ticket: board && !mine ? tickets.boardTicketInfo('concern', k) : undefined,
  });
});

/* ---------------------------------------------------------------- Antworten */
router.post(
  '/:id/messages',
  wrap(async (req, res) => {
    const k = load(req, res);
    if (!k) return;
    const u = req.user;
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional() }), req, res);
    if (!d) return;
    // Das eigene Anliegen beantwortet man als einreichende Person (auch wenn man selbst im Board ist).
    const asBoard = isBoard(u) && k.author_id !== u.id;
    if (!asBoard) {
      const err = addAuthorMessage(k, d.body, u);
      if (err) return res.status(400).json({ error: err });
      return res.status(201).json({ success: true });
    }
    const internal = !!d.internal;
    tx(() => {
      db.prepare('INSERT INTO concern_messages (concern_id, author_id, author_name, from_board, internal, body) VALUES (?, ?, ?, 1, ?, ?)').run(
        k.id,
        u.id,
        u.display_name,
        internal ? 1 : 0,
        d.body
      );
      if (!internal) {
        db.prepare("UPDATE concerns SET board_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(k.id);
        // Antwort des Boards auf ein offenes Anliegen: automatisch „In Bearbeitung“
        if (k.status === 'offen') db.prepare("UPDATE concerns SET status = 'in_bearbeitung', assigned_to = COALESCE(assigned_to, ?) WHERE id = ?").run(u.id, k.id);
      }
    });
    tickets.boardPost('concern', k.id, {
      title: internal ? `🔒 Interne Notiz von ${u.display_name}` : `↩️ Antwort von ${u.display_name} an die einreichende Person`,
      description: d.body,
      color: internal ? tickets.COLORS.slate : tickets.COLORS.gold,
      by: u.display_name,
    });
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
        const m = db.prepare(`SELECT id, display_name FROM users WHERE id = ? AND ${BOARD_MEMBER_SQL}`).get(d.assignedTo);
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
    tickets.boardPost('concern', k.id, {
      title: d.status && CLOSED.includes(d.status) ? `🔒 Anliegen ${STATUS[d.status].toLowerCase()}` : '📌 Anliegen aktualisiert',
      description: notes.map((n) => `• ${n}`).join('\n'),
      color: d.status && CLOSED.includes(d.status) ? tickets.COLORS.slate : tickets.COLORS.gold,
      by: u.display_name,
    });
    if (d.status && d.status !== k.status) {
      notify('concern.updated', k, `📋 Anliegen ans Board: ${STATUS[d.status]}`, [{ name: 'Geändert von', value: u.display_name }]);
      logActivity(u, 'Anliegen ans Board: Status', 'concern', k.id, `${k.reference}: ${STATUS[d.status]}`);
    }
    res.json({ success: true });
  })
);

/** Zurückziehen (eigenes, noch unbeantwortetes Anliegen) bzw. Löschen durch einen Admin. */
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
    tickets.boardDeleted('concern', k, canWithdraw ? 'Zurückgezogen' : u.display_name);
    res.json({ success: true });
  })
);

/* ================================================================ Startseite (auch ohne Konto) */
const publicRouter = express.Router();
const limit = (windowMs, max, message, skipFailedRequests = false) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, skipFailedRequests, handler: (req, res) => res.status(429).json({ error: message }) });
// Nur erfolgreich eingereichte Anliegen zählen; Tippfehler im Formular verbrauchen kein Kontingent.
const submitLimiter = limit(60 * 60 * 1000, 5, 'Sie haben bereits mehrere Anliegen gesendet. Bitte versuchen Sie es später erneut.', true);
const lookupLimiter = limit(15 * 60 * 1000, 20, 'Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.');

/** Kategorien für das Formular – abhängig davon, wer angemeldet ist. */
publicRouter.get('/concern-options', (req, res) => {
  res.json({
    categories: categoriesFor(req.user),
    account: req.user ? { name: req.user.display_name, group: GROUPS[groupOf(req.user)] } : null,
  });
});

publicRouter.post(
  '/concerns',
  submitLimiter,
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        ...concernSchema,
        name: z.string().trim().max(80).optional(),
        contact: z.string().trim().max(100).optional(),
        website: z.string().max(0).optional(), // Honeypot-Feld: bleibt bei Menschen leer
      }),
      req,
      res
    );
    if (!d) return;
    const user = req.user || null;
    if (!user && !d.anonymous && (!d.name || d.name.length < 2)) return res.status(400).json({ error: 'Bitte Ihren Namen angeben – oder anonym einreichen.' });
    const r = createConcern({ user, name: d.anonymous ? '' : d.name, contact: d.anonymous ? '' : d.contact || '', source: 'web', d });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.status(201).json({ reference: r.concern.reference, pin: r.pin, linkedToAccount: !!user });
  })
);

function publicLoad(res, d) {
  const k = db.prepare(`${SELECT} WHERE k.reference = ? AND k.access_pin = ?`).get(d.reference.toUpperCase(), d.pin);
  if (!k) res.status(404).json({ error: 'Kein Anliegen mit diesen Angaben gefunden.' });
  return k;
}
const lookupSchema = { reference: z.string().trim().min(1).max(30), pin: z.string().trim().min(1).max(10) };

/** Statusabfrage mit Vorgangsnummer + Pin: Antworten des Boards (ohne interne Notizen). */
publicRouter.post(
  '/concern-status',
  lookupLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object(lookupSchema), req, res);
    if (!d) return;
    const k = publicLoad(res, d);
    if (!k) return;
    db.prepare("UPDATE concerns SET author_seen_at = datetime('now') WHERE id = ?").run(k.id);
    const messages = db
      .prepare('SELECT * FROM concern_messages WHERE concern_id = ? AND internal = 0 ORDER BY created_at ASC, id ASC')
      .all(k.id)
      .map((m) => messageRow(m, k, null, true));
    res.json({
      reference: k.reference,
      subject: k.subject,
      body: k.body,
      categoryLabel: CATEGORIES[k.category] || k.category,
      status: k.status,
      statusLabel: STATUS[k.status],
      closed: CLOSED.includes(k.status),
      anonymous: !!k.anonymous,
      createdAt: k.created_at,
      messages,
    });
  })
);

/** Antwort der einreichenden Person über die Startseite. */
publicRouter.post(
  '/concern-reply',
  lookupLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ ...lookupSchema, body: z.string().trim().min(1).max(5000) }), req, res);
    if (!d) return;
    const k = publicLoad(res, d);
    if (!k) return;
    const err = addAuthorMessage(k, d.body, null);
    if (err) return res.status(400).json({ error: err });
    res.status(201).json({ success: true });
  })
);

module.exports = { router, publicRouter, CATEGORIES, STATUS };
