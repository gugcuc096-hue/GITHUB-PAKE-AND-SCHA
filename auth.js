'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { avatarUrl } = require('./uploads');

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}
function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

/** 22 Zeichen, URL-sicher -- für automatisch erzeugte Start-Passwörter. */
function generateStrongPassword() {
  return crypto.randomBytes(16).toString('base64url');
}

/** Gut ablesbares Einmal-Passwort (ohne verwechselbare Zeichen), z. B. "K7mP-x3Qa-9Rtw". */
function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
  return token;
}

function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Löscht alle Sessions eines Nutzers außer der aktuellen (z. B. nach Passwortänderung). */
function destroyOtherSessions(req, userId) {
  const token = req.cookies?.[SESSION_COOKIE];
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, token || '');
}

/** Meldet einen Nutzer auf allen Geräten ab (Sperre, Passwort-Reset durch Admin). */
function destroyAllSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function discordAvatarUrl(u) {
  if (!u.discord_id || !u.discord_avatar) return null;
  return `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=128`;
}

/** Eigenes Profilbild hat Vorrang, sonst das Discord-Bild, sonst null (Initialen). */
function userAvatarUrl(u) {
  return avatarUrl(u.avatar) || discordAvatarUrl(u);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    phone: u.phone || null,
    rank: u.rank || null,
    // Board of Partners: Rolle „Board of Partners“ (admin) oder Partner-Rang – z. B. für die Aktenbearbeitung
    board: u.role === 'admin' || (u.role === 'anwalt' && ['Founding Partner', 'Equity Partner', 'Partner'].includes(u.rank)),
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    avatarUrl: userAvatarUrl(u),
    hasOwnAvatar: !!u.avatar,
    duty: { status: u.duty_status || 'off', note: u.duty_note || '', since: u.duty_since || null },
    discord: u.discord_id
      ? { id: u.discord_id, username: u.discord_username || null, avatarUrl: discordAvatarUrl(u) }
      : null,
  };
}

/** Lädt den Nutzer zur Session-Cookie, falls vorhanden, sonst req.user = null. */
function loadUser(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  req.user = null;
  if (!token) return next();

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return next();
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!row || !row.active) return next();
  req.user = row;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung.' });
    next();
  };
}

const isStaff = (u) => !!u && (u.role === 'anwalt' || u.role === 'admin');
const isAdmin = (u) => !!u && u.role === 'admin';
const requireStaff = requireRole('anwalt', 'admin');
const requireAdmin = requireRole('admin');

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  generateStrongPassword,
  generateTempPassword,
  createSession,
  destroySession,
  destroyOtherSessions,
  destroyAllSessions,
  userAvatarUrl,
  publicUser,
  loadUser,
  requireAuth,
  requireRole,
  requireStaff,
  requireAdmin,
  isStaff,
  isAdmin,
};
