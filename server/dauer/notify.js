'use strict';
/*
 * Meldungen des Dauerbetriebs: Discord-Ereignis „system.dauer“ – gepingt werden NUR die Web-Admins (und der Inhaber),
 * einzeln mit Namen, nie eine Rolle. Dazu derselbe Hinweis in der Übersicht wie bei den übrigen Systemwarnungen.
 * Jede Störung wird einmal gemeldet; ist sie behoben, folgt eine Entwarnung (ohne Ping).
 */
function webAdminIds() {
  try {
    const { db } = require('../db/db');
    return db
      .prepare("SELECT discord_id FROM users WHERE active = 1 AND discord_id IS NOT NULL AND discord_id != '' AND (web_admin = 1 OR is_owner = 1) AND role IN ('admin', 'anwalt')")
      .all()
      .map((r) => String(r.discord_id));
  } catch {
    return [];
  }
}

const alerts = () => require('../integrations/systemAlerts');

function raise(key, { title, description }) {
  return alerts().raise(key, { title, description }, { event: 'system.dauer', mentionIds: webAdminIds() });
}

function resolve(key, msg = {}, quiet = false) {
  return alerts().resolve(key, msg, quiet, { event: 'system.dauer' });
}

/** Einmalige Mitteilung (z. B. „Server war eingeschlafen – Daten zurück“). */
function info(title, description) {
  console.log(`Dauerbetrieb: ${title} – ${description}`);
  try {
    const discord = require('../integrations/discord');
    discord.notify('system.dauer', { title: `ℹ️ ${title}`, description, mentionIds: webAdminIds(), color: 0x3b82f6 });
  } catch {
    /* Discord nicht eingerichtet */
  }
}

module.exports = { raise, resolve, info, webAdminIds };
