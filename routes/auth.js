'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db } = require('../db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyOtherSessions,
  otherSessionCount,
  publicUser,
  requireAuth,
  isStaff,
  findUserByLogin,
} = require('../auth');
const { wrap, parseBody, firmEmail, EMAIL_HINT } = require('../helpers');
const { logActivity } = require('../models');
const { imageBody, saveImage, removeFile } = require('../uploads');

const router = express.Router();

const limitHandler = (message) => (req, res) => res.status(429).json({ error: message });
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.'),
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('Zu viele Registrierungen von diesem Anschluss. Bitte später erneut versuchen.'),
});

// Selbst-Registrierung vergibt ausschließlich die Rolle "mandant". Höhere
// Rollen vergibt nur das Board of Partners im Dashboard.
const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().min(1).max(120), // nur der Teil vor dem @ oder komplette Adresse mit @pake-scha.ls
  password: z.string().min(10).max(200),
  phone: z.string().trim().max(40).optional(),
});

router.post(
  '/register',
  registerLimiter,
  wrap(async (req, res) => {
    const data = parseBody(registerSchema, req, res);
    if (!data) return;
    const email = firmEmail(data.email);
    if (!email) return res.status(400).json({ error: EMAIL_HINT });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' });
    }
    const info = db
      .prepare("INSERT INTO users (email, password_hash, display_name, role, phone) VALUES (?, ?, ?, 'mandant', ?)")
      .run(email, hashPassword(data.password), data.displayName, data.phone || null);
    createSession(res, Number(info.lastInsertRowid));
    res.status(201).json({ success: true });
  })
);

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const data = parseBody(z.object({ email: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) }), req, res);
    if (!data) return;
    const user = findUserByLogin(data.email);
    if (!user || !verifyPassword(data.password, user.password_hash)) {
      return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort ist falsch.' });
    }
    if (!user.active) return res.status(403).json({ error: 'Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.' });
    createSession(res, user.id);
    if (isStaff(user)) logActivity(user, 'Anmeldung', 'user', user.id);
    res.json({ success: true, user: publicUser(user) });
  })
);

// Hinweis „Ihre Login-E-Mail wurde umgestellt“ gelesen
router.post('/email-notice', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET email_notice = 0 WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
});

/** Anmeldungen auf anderen Geräten: Anzahl bzw. dort überall abmelden. */
router.get('/sessions', requireAuth, (req, res) => {
  res.json({ others: otherSessionCount(req, req.user.id) });
});

router.post('/logout-others', requireAuth, (req, res) => {
  const ended = destroyOtherSessions(req, req.user.id);
  logActivity(req.user, 'Auf anderen Geräten abgemeldet', 'user', req.user.id, `${ended} Anmeldung(en) beendet`);
  res.json({ ended, others: 0 });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Für öffentliche Seiten: liefert ohne Anmeldung { user: null } statt 401.
router.get('/session', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch(
  '/profile',
  requireAuth,
  wrap(async (req, res) => {
    const schema = z.object({
      phone: z.string().trim().max(40).optional(),
      displayName: z.string().trim().min(2).max(80).optional(),
    });
    const data = parseBody(schema, req, res);
    if (!data) return;
    if (data.phone !== undefined) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(data.phone || null, req.user.id);
    // Namen ändert niemand mehr selbst: Antrag im Profil → Entscheidung durch das Board of Partners (routes/nameRequests.js)
    if (data.displayName !== undefined && data.displayName !== req.user.display_name) {
      return res.status(400).json({ error: 'Namensänderungen bitte im Profil beim Board of Partners beantragen.' });
    }
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

/*
 * Konto per Discord angelegt: Der Name im Spiel (IC) wird beim ersten Besuch einmal abgefragt – danach gelten die
 * üblichen Regeln (Namensänderung per Antrag ans Board).
 */
router.post(
  '/initial-name',
  requireAuth,
  wrap(async (req, res) => {
    if (!req.user.needs_name) return res.status(400).json({ error: 'Ihr Name ist bereits hinterlegt – Änderungen bitte im Profil beim Board of Partners beantragen.' });
    const data = parseBody(z.object({ displayName: z.string().trim().min(3).max(80) }), req, res);
    if (!data) return;
    const name = data.displayName.replace(/\s+/g, ' ');
    if (!/\S+\s+\S+/.test(name)) return res.status(400).json({ error: 'Bitte Vor- und Nachnamen Ihres Charakters angeben (z. B. „John Doe“).' });
    db.prepare('UPDATE users SET display_name = ?, needs_name = 0 WHERE id = ?').run(name, req.user.id);
    logActivity(req.user, 'Name beim ersten Login festgelegt', 'user', req.user.id, `${req.user.display_name} → ${name}`);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

// Profilbild: der Browser schneidet quadratisch zu und verkleinert, der Server prüft das Format.
router.post(
  '/avatar',
  requireAuth,
  imageBody,
  wrap(async (req, res) => {
    const saved = saveImage(req, 'avatars');
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(saved.file, req.user.id);
    removeFile('avatars', req.user.avatar);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

router.delete('/avatar', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  removeFile('avatars', req.user.avatar);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });
    const data = parseBody(schema, req, res);
    if (!data) return;
    if (!verifyPassword(data.currentPassword, req.user.password_hash)) {
      return res.status(400).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
    }
    if (data.currentPassword === data.newPassword) {
      return res.status(400).json({ error: 'Das neue Passwort muss sich vom bisherigen unterscheiden.' });
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(data.newPassword), req.user.id);
    destroyOtherSessions(req, req.user.id);
    res.json({ success: true });
  })
);

module.exports = router;
