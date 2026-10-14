'use strict';
/*
 * Zwei-Faktor-Anmeldung per Discord-Direktnachricht.
 *
 * Nach richtigem Passwort schickt der Kanzlei-Bot einen 6-stelligen Code an das verknüpfte Discord; erst mit dem Code
 * gibt es eine Sitzung. Für das Board of Partners ist das Pflicht, alle anderen schalten es im Profil ein.
 *
 * - Ohne Bot-Token oder ohne verknüpftes Discord gibt es keinen Weg für den Code – dann gilt nur das Passwort (sonst
 *   wäre man ausgesperrt). Das Board sieht dazu im Profil einen Hinweis.
 * - „Diesem Gerät 30 Tage vertrauen“: ein zufälliges Merkmal im Cookie (gespeichert nur als Hash).
 * - Wer sich mit „Mit Discord anmelden“ anmeldet, hat Discord schon bestätigt – dort kein zusätzlicher Code.
 * - Notschalter: TWO_FACTOR_OFF=1 in Render schaltet die Abfrage ab (z. B. wenn Discord nicht erreichbar ist).
 *
 * Codes und Merkmale liegen nur als SHA-256-Hash in der Datenbank und fehlen in Datensicherungen.
 */
const crypto = require('crypto');
const { db } = require('./db');
const { isBoard } = require('./helpers');
const tickets = require('./tickets');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 4;
const RESEND_AFTER_MS = 30 * 1000;
const TRUST_DAYS = 30;
const TRUST_COOKIE = 'tdev';

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const nowIso = () => new Date().toISOString();
const inMs = (ms) => new Date(Date.now() + ms).toISOString();

const switchedOff = () => /^(1|true|ja|on)$/i.test(String(process.env.TWO_FACTOR_OFF || '').trim());
/** Kann ein Code überhaupt ankommen? (Bot eingerichtet, Discord verknüpft, kein Notschalter) */
const deliverable = (u) => !switchedOff() && tickets.hasToken() && tickets.isId(u && u.discord_id);

/** Stand für das Profil: an/aus, Pflicht (Board), möglich (Bot + Discord). */
function status(u) {
  const mandatory = isBoard(u);
  const possible = deliverable(u);
  return {
    on: possible && (mandatory || !!u.two_factor),
    mandatory,
    possible,
    chosen: !!u.two_factor,
    botReady: !switchedOff() && tickets.hasToken(),
    hasDiscord: tickets.isId(u.discord_id),
    switchedOff: switchedOff(),
    trustedDevices: db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ? AND expires_at > ?').get(u.id, nowIso()).n,
  };
}
const required = (u) => status(u).on;

/* ---------------------------------------------------------------- Vertraute Geräte */
function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
}
/** Kurzbeschreibung des Geräts aus dem Browser-Kennzeichen, z. B. „Chrome · Windows“. */
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}
function isTrusted(req, userId) {
  const token = req.cookies?.[TRUST_COOKIE];
  if (!token || token.length > 128) return false;
  const row = db.prepare('SELECT token_hash FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires_at > ?').get(hash(token), userId, nowIso());
  if (!row) return false;
  db.prepare('UPDATE trusted_devices SET last_used_at = ? WHERE token_hash = ?').run(nowIso(), row.token_hash);
  return true;
}
function trustDevice(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ms = TRUST_DAYS * 864e5;
  db.prepare('INSERT INTO trusted_devices (token_hash, user_id, label, expires_at) VALUES (?, ?, ?, ?)').run(hash(token), userId, deviceLabel(req), inMs(ms));
  res.cookie(TRUST_COOKIE, token, { ...cookieOptions(), maxAge: ms });
}
/** Alle vertrauten Geräte vergessen – außer dem aktuellen (keepReq), z. B. bei „Auf anderen Geräten abmelden“. */
function forgetDevices(userId, keepReq = null) {
  const keep = keepReq && keepReq.cookies?.[TRUST_COOKIE] ? hash(keepReq.cookies[TRUST_COOKIE]) : '';
  return db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND token_hash != ?').run(userId, keep).changes;
}

/* ---------------------------------------------------------------- Anmeldecodes */
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

async function sendCode(u, code, req) {
  const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: u.discord_id });
  await tickets.rest('POST', `/channels/${ch.id}/messages`, {
    content: `Ihr Anmeldecode: **${code}**`,
    embeds: [
      tickets.embed({
        title: '🔐 Anmeldung bei Pake & Scha',
        description: `Ihr Code: **${code.slice(0, 3)} ${code.slice(3)}**\n\nGültig ${CODE_MINUTES} Minuten – auf der Anmeldeseite eingeben. Nicht weitergeben: Die Kanzlei fragt nie nach diesem Code.`,
        fields: [
          { name: 'Konto', value: u.email },
          { name: 'Gerät', value: deviceLabel(req) },
          { name: 'Nicht Sie?', value: 'Dann kennt jemand Ihr Passwort – bitte ändern Sie es im Dashboard unter „Profil“.', inline: false },
        ],
      }),
    ],
    allowed_mentions: { parse: [] },
  });
}
function deliveryError(err) {
  const closed = err && (err.code === 50007 || err.status === 403);
  return Object.assign(
    new Error(
      closed
        ? 'Der Kanzlei-Bot kann Ihnen keine Direktnachricht schicken. Bitte in Discord Direktnachrichten von Mitgliedern des Kanzlei-Servers erlauben und erneut anmelden.'
        : 'Der Anmeldecode konnte gerade nicht über Discord verschickt werden. Bitte in einer Minute erneut versuchen.'
    ),
    { status: 502 }
  );
}

/** Code verschicken und Anmeldung offen halten. Liefert { challenge, to, minutes }. */
async function start(u, req) {
  db.prepare('DELETE FROM login_challenges WHERE expires_at < ?').run(nowIso());
  const token = crypto.randomBytes(32).toString('base64url');
  const code = newCode();
  try {
    await sendCode(u, code, req);
  } catch (err) {
    throw deliveryError(err);
  }
  db.prepare('INSERT INTO login_challenges (token_hash, user_id, code_hash, sent_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    hash(token),
    u.id,
    hash(`${token}:${code}`),
    nowIso(),
    inMs(CODE_MINUTES * 60 * 1000)
  );
  return { challenge: token, to: u.discord_username ? `@${u.discord_username}` : 'Ihr Discord', minutes: CODE_MINUTES };
}

const challengeRow = (token) => (typeof token === 'string' && token.length <= 128 ? db.prepare('SELECT * FROM login_challenges WHERE token_hash = ?').get(hash(token)) : null);
const expired = (row) => !row || row.expires_at < nowIso() || row.attempts >= MAX_ATTEMPTS;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Code prüfen. Liefert den Nutzer – oder wirft mit verständlicher Meldung. Ein Code gilt nur einmal. */
function verify(token, code) {
  const row = challengeRow(token);
  if (expired(row)) throw fail('Der Anmeldecode ist abgelaufen. Bitte noch einmal anmelden.', 410);
  const clean = String(code || '').replace(/\D/g, '');
  const ok = clean.length === 6 && crypto.timingSafeEqual(Buffer.from(hash(`${token}:${clean}`)), Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?').run(row.token_hash);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    if (left <= 0) throw fail('Zu viele falsche Codes. Bitte noch einmal anmelden.', 410);
    throw fail(`Der Code stimmt nicht. Noch ${left === 1 ? 'ein Versuch' : `${left} Versuche`}.`);
  }
  db.prepare('DELETE FROM login_challenges WHERE token_hash = ?').run(row.token_hash);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!u || !u.active) throw fail('Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.', 403);
  return u;
}

/** Neuen Code schicken (frühestens nach 30 Sekunden, höchstens 4 Codes je Anmeldung). */
async function resend(token, req) {
  const row = challengeRow(token);
  if (expired(row)) throw fail('Der Anmeldecode ist abgelaufen. Bitte noch einmal anmelden.', 410);
  if (row.sends >= MAX_SENDS) throw fail('Es wurden schon mehrere Codes verschickt. Bitte noch einmal anmelden.', 429);
  const wait = Math.ceil((new Date(row.sent_at).getTime() + RESEND_AFTER_MS - Date.now()) / 1000);
  if (wait > 0) throw fail(`Bitte noch ${wait} Sekunden warten.`, 429);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const code = newCode();
  try {
    await sendCode(u, code, req);
  } catch (err) {
    throw deliveryError(err);
  }
  db.prepare('UPDATE login_challenges SET code_hash = ?, sends = sends + 1, sent_at = ?, attempts = 0, expires_at = ? WHERE token_hash = ?').run(
    hash(`${token}:${code}`),
    nowIso(),
    inMs(CODE_MINUTES * 60 * 1000),
    row.token_hash
  );
  return { minutes: CODE_MINUTES };
}

module.exports = { status, required, isTrusted, trustDevice, forgetDevices, start, verify, resend, TRUST_COOKIE, _test: { deviceLabel } };
