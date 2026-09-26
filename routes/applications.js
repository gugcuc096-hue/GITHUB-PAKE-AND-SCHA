'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, nextApplicationNumber, randomPin } = require('../db');
const { requireAuth, requireAdmin, hashPassword, generateTempPassword } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime, deriveInitials, truncate, APPLICATION_STATUS, rankField, BOARD_RANKS } = require('../helpers');
const { applicationRow, positionRow, logActivity } = require('../models');
const discord = require('../discord');

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
    const number = tx(() => {
      const nr = nextApplicationNumber();
      db.prepare(
        `INSERT INTO applications (number, access_code, position_id, position_title, name, age, phone, email, discord, experience, motivation, availability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(nr, code, d.positionId, positionTitle, d.name, d.age ?? null, d.phone || '', d.email || '', d.discord, d.experience || '', d.motivation, d.availability || '');
      return nr;
    });
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
    res.status(201).json({ number, code, positionTitle });
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
      publicNote: a.public_note || null,
      interviewAt: a.status === 'gespraech' ? a.interview_at : null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    });
  })
);

/* ================================================================
   Kanzleileitung: Bewerbungen
   ================================================================ */
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

function load(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id) || null;
}
function detail(a) {
  const notes = db
    .prepare('SELECT * FROM application_notes WHERE application_id = ? ORDER BY created_at ASC, id ASC')
    .all(a.id)
    .map((n) => ({ id: n.id, authorId: n.author_id, author: n.author_name, body: n.body, createdAt: n.created_at }));
  const hired = a.hired_user_id ? db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(a.hired_user_id) : null;
  return { application: applicationRow(a), notes, hiredUser: hired ? { id: hired.id, email: hired.email, displayName: hired.display_name } : null };
}

adminRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC, id DESC').all();
  res.json({ applications: rows.map(applicationRow) });
});

adminRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const a = id && load(id);
  if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  res.json(detail(a));
});

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
    tx(() => {
      db.prepare(
        "UPDATE applications SET status = 'gespraech', interview_at = ?, public_note = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(startsAt, d.publicNote ?? (a.public_note || `Wir laden Sie zum Gespräch ein. Ort: ${location}.`), a.id);
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
        email: z.string().trim().email().max(120),
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
    const email = d.email.toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });

    const password = generateTempPassword();
    tx(() => {
      const info = db
        .prepare('INSERT INTO users (email, password_hash, display_name, role, rank, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(email, hashPassword(password), a.name, d.role, d.rank || null, a.phone || null);
      const userId = Number(info.lastInsertRowid);
      if (d.createProfile !== false) {
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM team_members').get().m;
        db.prepare(
          'INSERT INTO team_members (name, role_title, description, initials, tier, sort_order, user_id, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(a.name, d.rank || 'Mitarbeiter', d.description || '', deriveInitials(a.name), BOARD_RANKS.includes(d.rank) ? 'leitung' : 'anwalt', maxOrder + 1, userId, d.visible === false ? 0 : 1);
      }
      db.prepare(
        "UPDATE applications SET status = 'angenommen', hired_user_id = ?, public_note = CASE WHEN public_note = '' THEN ? ELSE public_note END, updated_at = datetime('now') WHERE id = ?"
      ).run(userId, 'Herzlichen Glückwunsch – willkommen im Team von Pake & Scha! Ihre Zugangsdaten erhalten Sie direkt von der Kanzleileitung.', a.id);
    });
    logActivity(req.user, 'Bewerber eingestellt', 'application', a.id, `${a.name} als ${d.rank || 'Mitarbeiter (ohne Rang)'}`);
    res.json({ ...detail(load(a.id)), credentials: { email, password } });
  })
);

adminRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    db.prepare('DELETE FROM applications WHERE id = ?').run(a.id);
    logActivity(req.user, 'Bewerbung gelöscht', 'application', a.id, `${a.number} (${a.name})`);
    res.json({ success: true });
  })
);

/* ================================================================
   Kanzleileitung: Stellenausschreibungen
   ================================================================ */
const positionsRouter = express.Router();
positionsRouter.use(requireAuth, requireAdmin);

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

module.exports = { publicRouter, adminRouter, positionsRouter };
