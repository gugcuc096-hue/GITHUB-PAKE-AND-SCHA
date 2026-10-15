'use strict';
/*
 * Automatisch aufräumen: abgelehnte Bewerbungen sowie erledigte oder abgelehnte Anliegen werden nach
 * einer einstellbaren Zahl von Tagen ohne Änderung gelöscht – samt Discord-Ticket (auch im Archiv).
 * 0 Tage = aus. Läuft höchstens einmal je Stunde.
 */
const { db, getSetting, setSetting } = require('./db');
const tickets = require('./tickets');

const DEFAULT_DAYS = 60;
const days = () => {
  const n = Number(getSetting('cleanup_days', String(DEFAULT_DAYS)));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAYS;
};
const setDays = (n) => setSetting('cleanup_days', String(n));

let lastRun = 0;
function sweep({ force = false } = {}) {
  const n = days();
  if (!n || (!force && Date.now() - lastRun < 60 * 60 * 1000)) return { applications: 0, concerns: 0 };
  lastRun = Date.now();
  const cutoff = `-${n} days`;
  const apps = db.prepare("SELECT id FROM applications WHERE status = 'abgelehnt' AND updated_at < datetime('now', ?)").all(cutoff);
  const concerns = db.prepare("SELECT id FROM concerns WHERE status IN ('erledigt','abgelehnt') AND updated_at < datetime('now', ?)").all(cutoff);
  for (const [kind, table, rows] of [
    ['application', 'applications', apps],
    ['concern', 'concerns', concerns],
  ]) {
    for (const r of rows) {
      tickets.deleteTicket(kind, r.id, { by: 'Automatisch aufgeräumt', reason: `Seit ${n} Tagen abgeschlossen.`, delayMs: 0 });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(r.id);
    }
  }
  if (apps.length || concerns.length) console.log(`Aufgeräumt: ${apps.length} Bewerbung(en), ${concerns.length} Anliegen (älter als ${n} Tage).`);
  return { applications: apps.length, concerns: concerns.length };
}

module.exports = { DEFAULT_DAYS, days, setDays, sweep };
