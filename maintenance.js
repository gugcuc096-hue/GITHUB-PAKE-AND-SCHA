'use strict';
/*
 * Automatisch aufräumen – einmal am Tag (kurz nach dem Start, danach alle 24 Stunden):
 *  - abgelaufene Anmeldungen (Sitzungen), Zwei-Faktor-Codes und „vertraute Geräte“ löschen
 *  - die Datenbank ihre Abfragen neu einschätzen lassen (PRAGMA optimize) und das Schreib-Protokoll (WAL) kürzen
 *  - einmal im Monat die Datenbank verdichten (VACUUM): gelöschte Akten, Bilder-Verweise usw. geben ihren Platz frei,
 *    Sicherungen werden kleiner
 * Akten, Notizen, Rechnungen und das Protokoll bleiben unangetastet.
 */
const { db, getSetting, setSetting } = require('./db');

const DAY = 24 * 60 * 60 * 1000;
const VACUUM_EVERY = 30 * DAY;

function run() {
  const now = new Date().toISOString();
  const removed = {
    sessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes,
    challenges: db.prepare('DELETE FROM login_challenges WHERE expires_at < ?').run(now).changes,
    devices: db.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').run(now).changes,
  };
  db.exec('PRAGMA optimize;');
  const last = Date.parse(getSetting('maintenance_vacuum_at', '') || '') || 0;
  let vacuumed = false;
  if (Date.now() - last > VACUUM_EVERY) {
    try {
      db.exec('VACUUM;');
      setSetting('maintenance_vacuum_at', now);
      vacuumed = true;
    } catch (err) {
      console.warn('Datenbank verdichten fehlgeschlagen (nächster Versuch morgen):', err.message);
    }
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  setSetting('maintenance_at', now);
  return { ...removed, vacuumed };
}

let timer = null;
function start() {
  if (timer || process.env.NODE_ENV === 'test') return;
  const tick = () => {
    try {
      const r = run();
      if (r.sessions || r.challenges || r.devices || r.vacuumed) {
        console.log(`Aufgeräumt: abgelaufene Sitzungen ${r.sessions}, Zwei-Faktor-Codes ${r.challenges}, vertraute Geräte ${r.devices}${r.vacuumed ? ' · Datenbank verdichtet' : ''}.`);
      }
    } catch (err) {
      console.warn('Aufräumen fehlgeschlagen:', err.message);
    }
  };
  setTimeout(tick, 60 * 1000).unref();
  timer = setInterval(tick, DAY);
  timer.unref();
}

module.exports = { start, run };
