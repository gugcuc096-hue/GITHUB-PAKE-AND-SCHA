'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { EMAIL_DOMAIN, isBoard } = require('./helpers');
const { avatarUrl } = require('./uploads');
const permissions = require('./permissions');

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/*
 * Passwörter: scrypt (in Node eingebaut). Das Prüfen bei der Anmeldung läuft in einem Hintergrund-Thread – eine
 * Anmeldung hält den Server nicht mehr für alle anderen an. Ältere bcrypt-Hashes gelten weiter und werden bei der
 * nächsten erfolgreichen Anmeldung unbemerkt umgestellt.
 */
const SCRYPT = { N: 16384, r: 8, p: 1 };
const scryptAsync = (plain, salt, len, opts) => new Promise((ok, fail) => crypto.scrypt(plain, salt, len, opts, (err, key) => (err ? fail(err) : ok(key))));
const encodeHash = (salt, key) => `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  return encodeHash(salt, crypto.scryptSync(String(plain), salt, 32, SCRYPT));
}
async function hashPasswordAsync(plain) {
  const salt = crypto.randomBytes(16);
  return encodeHash(salt, await scryptAsync(String(plain), salt, 32, SCRYPT));
}
/** true, wenn das Passwort passt (scrypt oder älteres bcrypt). */
async function verifyPassword(plain, hash) {
  if (typeof hash !== 'string' || !hash) return false;
  if (hash.startsWith('scrypt$')) {
    const [, N, r, p, salt, key] = hash.split('$');
    const want = Buffer.from(key || '', 'base64');
    if (!want.length) return false;
    const got = await scryptAsync(String(plain), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(got, want);
  }
  return bcrypt.compare(String(plain), hash); // bcryptjs arbeitet asynchron in kleinen Häppchen
}
/** Älterer Hash (bcrypt) – nach erfolgreicher Anmeldung auf scrypt umstellen. */
const needsRehash = (hash) => !String(hash || '').startsWith('scrypt$');

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

/** Löscht alle Sessions eines Nutzers außer der aktuellen (z. B. nach Passwortänderung). Liefert die Anzahl. */
function destroyOtherSessions(req, userId) {
  const token = req.cookies?.[SESSION_COOKIE];
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, token || '').changes;
}

/** Anzahl der übrigen gültigen Anmeldungen (andere Geräte/Browser) eines Nutzers. */
function otherSessionCount(req, userId) {
  const token = req.cookies?.[SESSION_COOKIE];
  return db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND token != ? AND expires_at > ?").get(userId, token || '', new Date().toISOString()).n;
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

/**
 * Konto zu einer eingegebenen Adresse: komplette Adresse, nur der Teil vor dem @ („max.mustermann“) oder die
 * frühere Adresse vor der Umstellung auf @pake-scha.ls (z. B. „max@mail.ls“) – beim Login gilt dasselbe Passwort.
 */
function findUserByLogin(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return null;
  const email = v.includes('@') ? v : `${v}@${EMAIL_DOMAIN}`;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || (v.includes('@') ? db.prepare('SELECT * FROM users WHERE old_email = ?').get(v) : null) || null;
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
    board: isBoard(u),
    // Inhaber / Web-Admin und die Rechte für die Konfiguration (Einstellungen, Website, Vorlagen …)
    owner: permissions.isOwner(u),
    webAdmin: permissions.isWebAdmin(u),
    perms: permissions.permsOf(u),
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    // Konto per Discord angelegt: Name im Spiel noch einmal abfragen
    needsName: !!u.needs_name,
    viaDiscord: u.created_via === 'discord',
    // Login-E-Mail wurde auf @pake-scha.ls umgestellt → einmal Hinweis mit der alten Adresse
    emailNotice: u.email_notice ? { oldEmail: u.old_email || null } : null,
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
  // Wer die Seite nutzt, bleibt angemeldet: Ablauf (7 Tage) zählt ab der letzten Nutzung – höchstens einmal am Tag verlängert
  if (new Date(session.expires_at).getTime() - Date.now() < SESSION_MS - RENEW_AFTER_MS) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(Date.now() + SESSION_MS).toISOString(), token);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
  }
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
  findUserByLogin,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  needsRehash,
  generateStrongPassword,
  generateTempPassword,
  createSession,
  destroySession,
  destroyOtherSessions,
  otherSessionCount,
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
