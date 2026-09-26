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
  publicUser,
  requireAuth,
  isStaff,
} = require('../auth');
const { wrap, parseBody } = require('../helpers');
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
  email: z.string().trim().email().max(120),
  password: z.string().min(10).max(200),
  phone: z.string().trim().max(40).optional(),
});

router.post(
  '/register',
  registerLimiter,
  wrap(async (req, res) => {
    const data = parseBody(registerSchema, req, res);
    if (!data) return;
    const email = data.email.toLowerCase();
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
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email.toLowerCase());
    if (!user || !verifyPassword(data.password, user.password_hash)) {
      return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort ist falsch.' });
    }
    if (!user.active) return res.status(403).json({ error: 'Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.' });
    createSession(res, user.id);
    if (isStaff(user)) logActivity(user, 'Anmeldung', 'user', user.id);
    res.json({ success: true, user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
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
    // Namen des Teams pflegt das Board of Partners (Team-Verwaltung), Mandanten ändern ihren selbst.
    if (data.displayName !== undefined && req.user.role === 'mandant') {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(data.displayName, req.user.id);
    }
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
