'use strict';
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, nextApplicationNumber, randomPin } = require('../db');
const { requireAuth, requireAdmin, hashPassword, generateTempPassword } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime, deriveInitials, truncate, APPLICATION_STATUS, rankField, BOARD_RANKS, RANKS, isBoard, firmEmail, EMAIL_HINT } = require('../helpers');
const { applicationRow, positionRow, logActivity } = require('../models');
const discord = require('../discord');
const personnel = require('./personnel');
const tickets = require('../tickets');

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const WELCOME = 'Herzlichen Glückwunsch – willkommen im Team von Pake & Scha! Ihre Zugangsdaten erhalten Sie direkt vom Board of Partners.';

// skipFailedRequests: Tippfehler im Formular (400) verbrauchen kein Kontingent.
const limit = (windowMs, max, message, skipFailedRequests = false) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests,
    handler: (req, res) => res.status(429).json({ error: message }),
  });


/* ================================================================
   Nachrichten zwischen Board und Bewerber
   ================================================================
 * Der Bewerber hat kein Konto: Er erreicht seine Bewerbung über einen persönlichen Link (/bewerbung.html#<token>,
 * nach dem Absenden angezeigt und auf dem Gerät gemerkt; Bewerbungsnummer + Zugangscode führen ebenfalls dorthin).
 * Dort sieht er den Stand (Fortschritt), den Gesprächstermin und schreibt mit dem Board. Verbindet er sein Discord,
 * kommen Antworten und neue Stände zusätzlich als Discord-Direktnachricht. Ins Board-Ticket kommen die Nachrichten
 * nur als Protokoll fürs Board – der Bewerber ist nicht im Ticket (dort stehen auch interne Notizen).
 */
const newToken = () => crypto.randomBytes(24).toString('base64url');
const portalPath = (a) => `/bewerbung.html#${a.access_token}`;

function messageRow(m) {
  return { id: m.id, fromBoard: !!m.from_board, author: m.author_name, body: m.body, createdAt: m.created_at };
}
function messagesOf(appId, after = 0) {
  return db.prepare('SELECT * FROM application_messages WHERE application_id = ? AND id > ? ORDER BY id').all(appId, after).map(messageRow);
}
const lastMessageId = (appId) => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM application_messages WHERE application_id = ?').get(appId).m;

/** Nachricht speichern (Board oder Bewerber) – liefert die neue Nachricht. */
function addMessage(a, { fromBoard, user = null, body }) {
  const info = db
    .prepare('INSERT INTO application_messages (application_id, from_board, author_id, author_name, body) VALUES (?, ?, ?, ?, ?)')
    .run(a.id, fromBoard ? 1 : 0, user ? user.id : null, fromBoard ? (user ? user.display_name : 'Board of Partners') : a.name, body);
  const id = Number(info.lastInsertRowid);
  // Wer schreibt, hat alles davor gelesen
  db.prepare(`UPDATE applications SET ${fromBoard ? 'board_read_id' : 'applicant_read_id'} = ?, updated_at = datetime('now') WHERE id = ?`).run(id, a.id);
  return messageRow(db.prepare('SELECT * FROM application_messages WHERE id = ?').get(id));
}

/** Discord-Direktnachricht an den Bewerber (nur wenn er sein Discord verbunden hat). */
async function dmApplicant(a, { title, description, fields }) {
  if (!tickets.isId(a.discord_user_id) || !tickets.hasToken()) return false;
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: a.discord_user_id });
    const base = tickets.siteBase();
    await tickets.rest('POST', `/channels/${ch.id}/messages`, {
      embeds: [tickets.embed({ title, description, fields, footer: `Bewerbung ${a.number} · Pake & Scha Legal Consulting` })],
      components: base ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Zur Bewerbung', url: base + portalPath(a) }] }] : undefined,
    });
    return true;
  } catch {
    return false;
  }
}
const statusText = (a) => `Neuer Stand: **${APPLICATION_STATUS[a.status] || a.status}**`;

/* ================================================================
   Öffentlich: Karriereseite
   ================================================================ */
const publicRouter = express.Router();

publicRouter.get('/positions', (req, res) => {
  const rows = db.prepare('SELECT * FROM positions WHERE active = 1 ORDER BY sort_order ASC, id ASC').all();
  res.json({ positions: rows.map(positionRow) });
});

const applySchema = z.object({
  positionId: z.number().int().positive().nullable(),
  name: z.string().trim().min(2).max(80),
  age: z.number().int().min(16).max(99).nullable().optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.string().trim().email().max(120), z.literal('')]).optional(),
  discord: z.string().trim().min(2).max(60),
  experience: z.string().trim().max(3000).optional(),
  motivation: z.string().trim().min(50).max(4000),
  availability: z.string().trim().max(500).optional(),
  accept: z.literal(true),
  website: z.string().max(0).optional(), // Honeypot
});

publicRouter.post(
  '/applications',
  limit(60 * 60 * 1000, 3, 'Sie haben bereits mehrere Bewerbungen gesendet. Bitte versuchen Sie es später erneut.', true),
  wrap(async (req, res) => {
    const d = parseBody(applySchema, req, res);
    if (!d) return;
    let positionTitle = 'Initiativbewerbung';
    if (d.positionId) {
      const p = db.prepare('SELECT * FROM positions WHERE id = ? AND active = 1').get(d.positionId);
      if (!p) return res.status(400).json({ error: 'Diese Stelle ist nicht mehr ausgeschrieben.' });
      positionTitle = p.title;
    }
    const code = randomPin();
    const token = newToken();
    const { number, id } = tx(() => {
      const nr = nextApplicationNumber();
      const info = db
        .prepare(
          `INSERT INTO applications (number, access_code, access_token, position_id, position_title, name, age, phone, email, discord, experience, motivation, availability)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(nr, code, token, d.positionId, positionTitle, d.name, d.age ?? null, d.phone || '', d.email || '', d.discord, d.experience || '', d.motivation, d.availability || '');
      return { number: nr, id: Number(info.lastInsertRowid) };
    });
    tickets.boardCreated('application', id);
    discord.notify('application.created', {
      title: `📝 Neue Bewerbung ${number}`,
      description: truncate(d.motivation, 400),
      fields: [
        { name: 'Name', value: d.name },
        { name: 'Stelle', value: positionTitle },
        { name: 'Discord', value: d.discord },
        { name: 'Alter', value: d.age ? String(d.age) : '—' },
      ],
    });
    res.status(201).json({ number, code, positionTitle, token, portal: `/bewerbung.html#${token}` });
  })
);

publicRouter.post(
  '/application-status',
  limit(15 * 60 * 1000, 15, 'Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.'),
  wrap(async (req, res) => {
    const d = parseBody(z.object({ number: z.string().trim().min(1).max(30), code: z.string().trim().min(1).max(10) }), req, res);
    if (!d) return;
    const a = db.prepare('SELECT * FROM applications WHERE number = ? AND access_code = ?').get(d.number.toUpperCase(), d.code);
    if (!a) return res.status(404).json({ error: 'Keine Bewerbung mit diesen Angaben gefunden.' });
    res.json({
      number: a.number,
      positionTitle: a.position_title,
      status: a.status,
      statusLabel: APPLICATION_STATUS[a.status],
      publicNote: (db.prepare('SELECT body FROM application_messages WHERE application_id = ? AND from_board = 1 ORDER BY id DESC LIMIT 1').get(a.id) || {}).body || a.public_note || null,
      interviewAt: a.status === 'gespraech' ? a.interview_at : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      portal: portalPath(a),
    });
  })
);

/* ---------------------------------------------------------------- Bewerberseite (persönlicher Link) */
const portalLimiter = limit(15 * 60 * 1000, 400, 'Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.');
const writeLimiter = limit(15 * 60 * 1000, 30, 'Sie haben viele Nachrichten in kurzer Zeit gesendet. Bitte kurz warten.', true);
const tokenSchema = z.string().trim().min(20).max(64);
function byToken(token) {
  return db.prepare('SELECT * FROM applications WHERE access_token = ?').get(token) || null;
}

/** Bewerbungsnummer + Zugangscode → persönlicher Link (für alle, die nur die Nummer notiert haben). */
publicRouter.post(
  '/application-access',
  limit(15 * 60 * 1000, 15, 'Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.'),
  wrap(async (req, res) => {
    const d = parseBody(z.object({ number: z.string().trim().min(1).max(30), code: z.string().trim().min(1).max(10) }), req, res);
    if (!d) return;
    const a = db.prepare('SELECT * FROM applications WHERE number = ? AND access_code = ?').get(d.number.toUpperCase(), d.code);
    if (!a) return res.status(404).json({ error: 'Keine Bewerbung mit diesen Angaben gefunden.' });
    res.json({ token: a.access_token, portal: portalPath(a) });
  })
);

/** Bewerberseite: Stand, Gesprächstermin, Nachrichten (after: nur neuere – zum Nachladen). */
publicRouter.post(
  '/application-portal',
  portalLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ token: tokenSchema, after: z.number().int().min(0).optional() }), req, res);
    if (!d) return;
    const a = byToken(d.token);
    if (!a) return res.status(404).json({ error: 'Diese Bewerbung wurde nicht gefunden – der Link ist ungültig oder die Bewerbung wurde gelöscht.' });
    const last = lastMessageId(a.id);
    if (last > a.applicant_read_id) db.prepare('UPDATE applications SET applicant_read_id = ? WHERE id = ?').run(last, a.id);
    res.json({
      number: a.number,
      name: a.name,
      positionTitle: a.position_title,
      status: a.status,
      statusLabel: APPLICATION_STATUS[a.status] || a.status,
      interviewAt: a.status === 'gespraech' ? a.interview_at : null,
      hired: !!a.hired_user_id,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      messages: messagesOf(a.id, d.after || 0),
      boardRead: a.board_read_id,
      discord: { connected: tickets.isId(a.discord_user_id), available: discord.oauthConfigured() && tickets.hasToken() },
    });
  })
);

/** Nachricht des Bewerbers ans Board. */
publicRouter.post(
  '/application-portal/messages',
  writeLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ token: tokenSchema, body: z.string().trim().min(1).max(3000) }), req, res);
    if (!d) return;
    const a = byToken(d.token);
    if (!a) return res.status(404).json({ error: 'Diese Bewerbung wurde nicht gefunden.' });
    const message = addMessage(a, { fromBoard: false, body: d.body });
    tickets.boardPost('application', a.id, { title: `💬 Nachricht von ${truncate(a.name, 150)} (Bewerber)`, description: d.body, color: tickets.COLORS.blue, by: 'Über die Bewerberseite' });
    res.status(201).json({ message });
  })
);

/* ================================================================
   Board of Partners: Bewerbungen
   ================================================================ */
// Board of Partners = Rolle „Board of Partners“ (Admin) oder ein Partner-Rang.
function requireBoard(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
}

const adminRouter = express.Router();
adminRouter.use(requireAuth, requireBoard);

function load(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id) || null;
}
function detail(a) {
  const notes = db
    .prepare('SELECT * FROM application_notes WHERE application_id = ? ORDER BY created_at ASC, id ASC')
    .all(a.id)
    .map((n) => ({ id: n.id, authorId: n.author_id, author: n.author_name, body: n.body, createdAt: n.created_at }));
  const hired = a.hired_user_id ? db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(a.hired_user_id) : null;
  return {
    application: applicationRow(a),
    notes,
    hiredUser: hired ? { id: hired.id, email: hired.email, displayName: hired.display_name } : null,
    ticket: tickets.boardTicketInfo('application', a),
    // Nachrichten mit dem Bewerber und sein persönlicher Link (nur fürs Board)
    messages: messagesOf(a.id),
    applicantRead: a.applicant_read_id,
    portal: portalPath(a),
    discordConnected: tickets.isId(a.discord_user_id),
  };
}

adminRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM application_messages m WHERE m.application_id = a.id AND m.from_board = 0 AND m.id > a.board_read_id) AS unread_messages
       FROM applications a ORDER BY a.created_at DESC, a.id DESC`
    )
    .all();
  res.json({ applications: rows.map((a) => ({ ...applicationRow(a), unreadMessages: a.unread_messages })) });
});

/** Board hat die Nachrichten gesehen (beim Öffnen der Bewerbung bzw. Nachladen im offenen Chat). */
function markBoardRead(a) {
  const last = lastMessageId(a.id);
  if (last > a.board_read_id) db.prepare('UPDATE applications SET board_read_id = ? WHERE id = ?').run(last, a.id);
}

adminRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const a = id && load(id);
  if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  markBoardRead(a);
  res.json(detail(load(a.id)));
});

adminRouter.get('/:id/messages', (req, res) => {
  const id = idParam(req);
  const a = id && load(id);
  if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  markBoardRead(a);
  res.json({ messages: messagesOf(a.id, Math.max(0, Number(req.query.after) || 0)), applicantRead: a.applicant_read_id });
});

/** Nachricht des Boards an den Bewerber (Bewerberseite + Discord-Direktnachricht, falls verbunden). */
adminRouter.post(
  '/:id/messages',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(3000) }), req, res);
    if (!d) return;
    const message = addMessage(a, { fromBoard: true, user: req.user, body: d.body });
    const dm = await dmApplicant(a, { title: '✉️ Neue Nachricht zu Ihrer Bewerbung', description: d.body, fields: [{ name: 'Von', value: `${req.user.display_name} · Board of Partners` }] });
    tickets.boardPost('application', a.id, { title: '✉️ Nachricht an den Bewerber', description: d.body, color: tickets.COLORS.gold, by: req.user.display_name });
    res.status(201).json({ message, applicantRead: a.applicant_read_id, discordSent: dm });
  })
);

adminRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    const d = parseBody(
      z.object({
        status: z.enum(Object.keys(APPLICATION_STATUS)).optional(),
        rating: z.number().int().min(0).max(5).optional(),
        publicNote: z.string().trim().max(1000).optional(),
      }),
      req,
      res
    );
    if (!d) return;
    db.prepare("UPDATE applications SET status = ?, rating = ?, public_note = ?, updated_at = datetime('now') WHERE id = ?").run(
      d.status ?? a.status,
      d.rating ?? a.rating,
      d.publicNote ?? a.public_note,
      a.id
    );
    if (d.status && d.status !== a.status) {
      logActivity(req.user, 'Bewerbungsstatus geändert', 'application', a.id, `${a.number} (${a.name}): ${APPLICATION_STATUS[a.status]} → ${APPLICATION_STATUS[d.status]}`);
    }
    // Board-Ticket: Status, Bewertung, Nachricht an den Bewerber
    const lines = [];
    if (d.status && d.status !== a.status) lines.push(`Status: ${APPLICATION_STATUS[a.status]} → ${APPLICATION_STATUS[d.status]}`);
    if (d.rating !== undefined && d.rating !== a.rating) lines.push(`Bewertung: ${stars(d.rating)}`);
    if (d.publicNote !== undefined && d.publicNote !== a.public_note && d.publicNote) lines.push(`Nachricht an den Bewerber: ${d.publicNote}`);
    if (d.status && d.status !== a.status) dmApplicant({ ...a, status: d.status }, { title: '📌 Ihre Bewerbung bei Pake & Scha', description: statusText({ status: d.status }) });
    if (lines.length) {
      const closing = d.status === 'abgelehnt';
      tickets.boardPost('application', a.id, {
        title: closing ? '❌ Bewerbung abgesagt' : '📌 Bewerbung aktualisiert',
        description: lines.map((l) => `• ${l}`).join('\n'),
        color: closing ? tickets.COLORS.slate : tickets.COLORS.gold,
        by: req.user.display_name,
      });
    }
    res.json(detail(load(a.id)));
  })
);

adminRouter.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(3000) }), req, res);
    if (!d) return;
    db.prepare('INSERT INTO application_notes (application_id, author_id, author_name, body) VALUES (?, ?, ?, ?)').run(a.id, req.user.id, req.user.display_name, d.body);
    tickets.boardPost('application', a.id, { title: `🗒️ Notiz von ${req.user.display_name}`, description: d.body, color: tickets.COLORS.blue, by: req.user.display_name });
    res.status(201).json(detail(a));
  })
);

// Gesprächstermin: Status "Einladung zum Gespräch" + Eintrag im Team-Kalender.
adminRouter.post(
  '/:id/interview',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    const d = parseBody(z.object({ startsAt: isoDateTime, location: z.string().trim().max(120).optional(), publicNote: z.string().trim().max(1000).optional() }), req, res);
    if (!d) return;
    const startsAt = new Date(d.startsAt).toISOString();
    const location = d.location || 'Kanzlei Würfelpark';
    const when = new Date(startsAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
    const invite = d.publicNote || `Wir laden Sie zum Bewerbungsgespräch ein: ${when} Uhr · Ort: ${location}. Bitte geben Sie uns hier kurz Bescheid, ob der Termin passt.`;
    tx(() => {
      db.prepare("UPDATE applications SET status = 'gespraech', interview_at = ?, updated_at = datetime('now') WHERE id = ?").run(startsAt, a.id);
      addMessage(a, { fromBoard: true, user: req.user, body: invite });
      db.prepare(
        `INSERT INTO appointments (type, title, starts_at, location, note, status, assigned_to, created_by, client_visible)
         VALUES ('intern', ?, ?, ?, ?, 'bestaetigt', ?, ?, 0)`
      ).run(
        `Bewerbungsgespräch: ${a.name}`,
        startsAt,
        location,
        `Bewerbung ${a.number} – ${a.position_title}\nDiscord: ${a.discord || '—'} · Telefon: ${a.phone || '—'}`,
        req.user.id,
        req.user.id
      );
    });
    logActivity(req.user, 'Bewerbungsgespräch geplant', 'application', a.id, `${a.number} (${a.name})`);
    dmApplicant({ ...a, status: 'gespraech' }, { title: '📅 Einladung zum Bewerbungsgespräch', description: invite });
    const ts = Math.floor(new Date(startsAt).getTime() / 1000);
    tickets.boardPost('application', a.id, {
      title: '📅 Bewerbungsgespräch geplant',
      fields: [
        { name: 'Wann', value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: false },
        { name: 'Ort', value: location },
      ],
      color: tickets.COLORS.blue,
      by: req.user.display_name,
    });
    res.json(detail(load(a.id)));
  })
);

// Einstellen: Login-Konto (Einmal-Passwort) + optional Team-Profil auf der Website.
adminRouter.post(
  '/:id/hire',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    if (a.hired_user_id) return res.status(400).json({ error: 'Für diese Bewerbung wurde bereits ein Konto angelegt.' });
    const d = parseBody(
      z.object({
        email: z.string().trim().min(1).max(120), // Teil vor dem @ oder Adresse mit @pake-scha.ls
        role: z.enum(['anwalt', 'admin']),
        rank: rankField,
        createProfile: z.boolean().optional(),
        visible: z.boolean().optional(),
        description: z.string().trim().max(400).optional(),
      }),
      req,
      res
    );
    if (!d) return;
    // Partner ohne Admin-Rolle: nur als Anwalt/Mitarbeiter und höchstens bis zum eigenen Rang (wie beim Befördern)
    if (req.user.role !== 'admin') {
      if (d.role === 'admin') return res.status(403).json({ error: 'Konten mit der Rolle „Board of Partners“ (Admin) kann nur ein Admin anlegen.' });
      if (d.rank && RANKS.indexOf(d.rank) < RANKS.indexOf(req.user.rank)) {
        return res.status(403).json({ error: `Sie können höchstens bis zu Ihrem eigenen Rang (${req.user.rank}) einstellen.` });
      }
    }
    const email = firmEmail(d.email);
    if (!email) return res.status(400).json({ error: EMAIL_HINT });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });

    const password = generateTempPassword();
    let hiredId;
    tx(() => {
      const info = db
        .prepare('INSERT INTO users (email, password_hash, display_name, role, rank, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(email, hashPassword(password), a.name, d.role, d.rank || null, a.phone || null);
      const userId = Number(info.lastInsertRowid);
      hiredId = userId;
      if (d.createProfile !== false) {
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM team_members').get().m;
        db.prepare(
          'INSERT INTO team_members (name, role_title, description, initials, tier, sort_order, user_id, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(a.name, d.rank || 'Mitarbeiter', d.description || '', deriveInitials(a.name), BOARD_RANKS.includes(d.rank) ? 'leitung' : 'anwalt', maxOrder + 1, userId, d.visible === false ? 0 : 1);
      }
      db.prepare("UPDATE applications SET status = 'angenommen', hired_user_id = ?, updated_at = datetime('now') WHERE id = ?").run(userId, a.id);
      addMessage(a, { fromBoard: true, user: req.user, body: WELCOME });
    });
    dmApplicant({ ...a, status: 'angenommen' }, { title: '🎉 Willkommen bei Pake & Scha', description: WELCOME });
    logActivity(req.user, 'Bewerber eingestellt', 'application', a.id, `${a.name} als ${d.rank || 'Mitarbeiter (ohne Rang)'}`);
    personnel.recordHire({ userId: hiredId, name: a.name, rank: d.rank || null, note: `Über Bewerbung ${a.number}`, by: req.user });
    tickets.boardPost('application', a.id, {
      title: `✅ ${a.name} eingestellt`,
      description: `Konto angelegt${d.rank ? ` als **${d.rank}**` : ''}. Die Bewerbung ist abgeschlossen – der Kanal wandert ins Archiv.`,
      color: tickets.COLORS.green,
      by: req.user.display_name,
    });
    res.json({ ...detail(load(a.id)), credentials: { email, password } });
  })
);

adminRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    db.prepare('DELETE FROM applications WHERE id = ?').run(a.id);
    tickets.boardDeleted('application', a, req.user.display_name);
    logActivity(req.user, 'Bewerbung gelöscht', 'application', a.id, `${a.number} (${a.name})`);
    res.json({ success: true });
  })
);

/* ================================================================
   Board of Partners: Stellenausschreibungen
   ================================================================ */
const positionsRouter = express.Router();
positionsRouter.use(requireAuth, requireBoard);

const positionSchema = z.object({
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1500).optional(),
  requirements: z.string().trim().max(1500).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

positionsRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM positions ORDER BY sort_order ASC, id ASC').all();
  res.json({ positions: rows.map(positionRow) });
});

positionsRouter.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(positionSchema, req, res);
    if (!d) return;
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM positions').get().m;
    const info = db
      .prepare('INSERT INTO positions (title, description, requirements, active, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(d.title, d.description || '', d.requirements || '', d.active === false ? 0 : 1, d.sortOrder ?? maxOrder + 1);
    logActivity(req.user, 'Stelle ausgeschrieben', 'position', Number(info.lastInsertRowid), d.title);
    res.status(201).json({ position: positionRow(db.prepare('SELECT * FROM positions WHERE id = ?').get(Number(info.lastInsertRowid))) });
  })
);

positionsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const p = id && db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Stelle nicht gefunden.' });
    const d = parseBody(positionSchema.partial(), req, res);
    if (!d) return;
    db.prepare('UPDATE positions SET title = ?, description = ?, requirements = ?, active = ?, sort_order = ? WHERE id = ?').run(
      d.title ?? p.title,
      d.description ?? p.description,
      d.requirements ?? p.requirements,
      d.active === undefined ? p.active : d.active ? 1 : 0,
      d.sortOrder ?? p.sort_order,
      p.id
    );
    res.json({ position: positionRow(db.prepare('SELECT * FROM positions WHERE id = ?').get(p.id)) });
  })
);

positionsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const p = id && db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Stelle nicht gefunden.' });
    db.prepare('DELETE FROM positions WHERE id = ?').run(p.id);
    logActivity(req.user, 'Stelle gelöscht', 'position', p.id, p.title);
    res.json({ success: true });
  })
);

module.exports = { publicRouter, adminRouter, positionsRouter, dmApplicant };
