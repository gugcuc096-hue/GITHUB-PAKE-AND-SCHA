'use strict';
/*
 * Benachrichtigungen je Person (Profil → Benachrichtigungen):
 *  - Discord-Direktnachrichten: „an“, „still“ (kommen an, aber ohne Ton/Push – Discord-Flag SUPPRESS_NOTIFICATIONS)
 *    oder „aus“ (gar nicht).
 *  - Ruhezeiten (z. B. 22:00–08:00, Uhrzeit Berlin): in dieser Zeit kommen Direktnachrichten still an.
 *  - Dashboard: Hinweise (kleine Meldungen bei Neuem) und Ton – wirken nur im Browser (siehe 12-live.js).
 * Greift zentral im Discord-Versand (tickets.rest): jede Direktnachricht an ein verknüpftes Konto beachtet die Wahl.
 * Codes beim Login (Zwei-Faktor) und Zugangsdaten kommen immer an (wichtig: true).
 */
const { z } = require('zod');
const { db } = require('../db/db');

const KEY = 'notify';
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM.');
const schema = z.object({
  dm: z.enum(['an', 'still', 'aus']),
  quiet: z.boolean(),
  quietFrom: hhmm,
  quietTo: hhmm,
  toasts: z.boolean(),
  sound: z.boolean(),
});
const DEFAULTS = { dm: 'an', quiet: false, quietFrom: '22:00', quietTo: '08:00', toasts: true, sound: false };

function get(userId) {
  const r = db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(userId, KEY);
  if (!r) return { ...DEFAULTS };
  try {
    const v = schema.partial().safeParse(JSON.parse(r.value));
    return { ...DEFAULTS, ...(v.success ? v.data : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function set(userId, value) {
  const v = schema.parse({ ...get(userId), ...value });
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(userId, KEY, JSON.stringify(v));
  return v;
}

const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Liegt der Zeitpunkt (Berlin) in den Ruhezeiten? Über Mitternacht (22:00–08:00) geht auch. */
function inQuiet(p, at = new Date()) {
  if (!p.quiet) return false;
  const now = minutes(at.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/^24/, '00'));
  const a = minutes(p.quietFrom);
  const b = minutes(p.quietTo);
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

/**
 * Was mit einer Direktnachricht an dieses Discord-Konto passiert: 'senden', 'still' oder 'nicht'.
 * Unbekanntes Discord-Konto (nicht mit der Website verknüpft): normal senden.
 */
function dmMode(discordId, at = new Date()) {
  const u = discordId ? db.prepare('SELECT id FROM users WHERE discord_id = ?').get(String(discordId)) : null;
  if (!u) return 'senden';
  const p = get(u.id);
  if (p.dm === 'aus') return 'nicht';
  if (p.dm === 'still' || inQuiet(p, at)) return 'still';
  return 'senden';
}

module.exports = { schema, DEFAULTS, get, set, inQuiet, dmMode };
