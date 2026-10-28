'use strict';
/*
 * Rechte der Konfiguration: Wer darf Website, Listen, Vorlagen, Honorarordnung, Einstellungen und Discord ändern?
 *  - Inhaber (users.is_owner): darf alles und bestimmt als Einziger Web-Admins und die Rechte-Tabelle.
 *  - Web-Admin (users.web_admin): vom Inhaber ernannt, pflegt die Kanzlei-Konfiguration.
 *  - Board of Partners / Anwälte: bekommen nur, was in der Rechte-Tabelle für ihre Gruppe angehakt ist (ab Werk nichts).
 * Beschlüsse, Personal, Statistik und die eigenen Akten hängen nicht an diesen Rechten.
 */
const { db, getSetting, setSetting } = require('./db');
const { isBoard } = require('./helpers');

/** Bereiche der Konfiguration – Schlüssel, Name und was dahinter steckt. */
const PERMS = [
  { key: 'site.edit', label: 'Website & Team', hint: 'Texte der Website, Team-Seite, Ränge, Banner, Startseite' },
  { key: 'templates.edit', label: 'Vorlagen & Textbausteine', hint: 'Vertrags- und Schriftsatz-Vorlagen, Textbausteine' },
  { key: 'fees.edit', label: 'Honorarordnung', hint: 'Gebühren, Pakete, Tarife' },
  { key: 'settings.edit', label: 'Kanzlei-Einstellungen', hint: 'Kanzleidaten, Erinnerungen, Feature-Schalter, Listen' },
  { key: 'discord.edit', label: 'Discord & Bot', hint: 'Webhook, Login, Tickets, Rang-Sync, Bot-Module' },
  { key: 'system.edit', label: 'Integrationen, Lager & Sicherung', hint: 'Google, FiveNet, Lager, Backups, Notfall' },
  { key: 'config.audit', label: 'Änderungsprotokoll', hint: 'ansehen und Änderungen zurücksetzen' },
];
/** Nur der Inhaber – nicht in der Rechte-Tabelle einstellbar. */
const OWNER_ONLY = 'access.manage';
const KEYS = PERMS.map((p) => p.key);
/** Gruppen der Rechte-Tabelle (der Inhaber hat immer alles). */
const GROUPS = [
  { key: 'webadmin', label: 'Web-Admin' },
  { key: 'board', label: 'Board of Partners' },
  { key: 'anwalt', label: 'Anwälte & Mitarbeiter' },
];
const DEFAULTS = { webadmin: [...KEYS], board: [], anwalt: [] };

function matrix() {
  let saved = {};
  try {
    saved = JSON.parse(getSetting('perm_matrix', '{}')) || {};
  } catch {
    saved = {};
  }
  const out = {};
  for (const g of GROUPS) out[g.key] = Array.isArray(saved[g.key]) ? saved[g.key].filter((k) => KEYS.includes(k)) : [...DEFAULTS[g.key]];
  return out;
}
function saveMatrix(m) {
  const clean = {};
  for (const g of GROUPS) clean[g.key] = [...new Set((m[g.key] || []).filter((k) => KEYS.includes(k)))];
  setSetting('perm_matrix', JSON.stringify(clean));
  return clean;
}

const isOwner = (u) => !!u && !!u.is_owner && u.role === 'admin';
const isWebAdmin = (u) => !!u && !!u.web_admin && (u.role === 'anwalt' || u.role === 'admin');

/** Alle Rechte eines Nutzers (Inhaber: alle inkl. Inhaber-Recht). */
function permsOf(u) {
  if (!u || (u.role !== 'anwalt' && u.role !== 'admin')) return [];
  if (isOwner(u)) return [...KEYS, OWNER_ONLY];
  const m = matrix();
  const out = new Set(m.anwalt);
  if (isBoard(u)) m.board.forEach((k) => out.add(k));
  if (isWebAdmin(u)) m.webadmin.forEach((k) => out.add(k));
  return [...out];
}
const can = (u, key) => permsOf(u).includes(key);
const canAny = (u, keys) => keys.some((k) => can(u, k));

/** Middleware: braucht Anmeldung und das Recht `key`. */
function requirePerm(...keys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
    if (!canAny(req.user, keys)) return res.status(403).json({ error: 'Dafür fehlt Ihnen das Recht – das vergibt der Inhaber unter Einstellungen → Rechte.' });
    next();
  };
}
const requireOwner = requirePerm(OWNER_ONLY);

/** Gibt es noch keinen Inhaber (neue Installation, ältere Daten), wird das erste aktive Board-Konto zum Inhaber. */
function ensureOwner() {
  if (db.prepare("SELECT 1 FROM users WHERE is_owner = 1 AND role = 'admin' AND active = 1").get()) return;
  const email = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const byEmail = email && db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND (email = ? OR old_email = ?)").get(email, email);
  const first = byEmail || db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!first) return;
  db.prepare('UPDATE users SET is_owner = 0').run();
  db.prepare('UPDATE users SET is_owner = 1 WHERE id = ?').run(first.id);
}

/**
 * Web-Admin ernennen oder entziehen (nur der Inhaber – das prüft der Aufrufer). Gleicht die Discord-Rolle „Web Admin“ ab.
 * Liefert { ok, error?, user? }.
 */
function setWebAdmin(actor, userId, on) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !u.active || (u.role !== 'anwalt' && u.role !== 'admin')) return { ok: false, error: 'Web-Admin kann nur ein aktives Mitglied der Kanzlei sein.' };
  if (u.is_owner) return { ok: false, error: 'Der Inhaber hat ohnehin alle Rechte.' };
  if (!!u.web_admin === !!on) return { ok: true, user: u, unchanged: true };
  db.prepare('UPDATE users SET web_admin = ? WHERE id = ?').run(on ? 1 : 0, u.id);
  require('./configLog').add(actor, { area: 'webadmin', key: String(u.id), label: `${on ? 'Web-Admin ernannt' : 'Web-Admin entzogen'}: ${u.display_name}` });
  require('./models').logActivity(actor, on ? 'Web-Admin ernannt' : 'Web-Admin entzogen', 'user', u.id, u.display_name);
  try {
    require('./discordBot').syncUser(u.id);
  } catch {
    /* Discord nicht eingerichtet */
  }
  return { ok: true, user: { ...u, web_admin: on ? 1 : 0 } };
}

module.exports = {
  setWebAdmin, PERMS, KEYS, GROUPS, OWNER_ONLY, DEFAULTS, matrix, saveMatrix, permsOf, can, canAny, isOwner, isWebAdmin, requirePerm, requireOwner, ensureOwner };
