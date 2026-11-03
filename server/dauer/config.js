'use strict';
/*
 * Dauerbetrieb (Render Free): Einstellungen aus der Umgebung – ohne Datenbank, weil sie schon vor dem Öffnen der
 * Datenbank gebraucht werden (Wiederherstellung beim Start).
 *
 *   DAUERBETRIEB=1 / 0           an / aus erzwingen. Ohne Angabe: an, wenn der Server auf Render läuft und die
 *                                Datenbank nicht auf einer eigenen Disk liegt (Free-Plan – das Dateisystem ist flüchtig).
 *   DAUERBETRIEB_SCHLUESSEL      Wiederherstellungs-Schlüssel (Dashboard → Einstellungen → Dauerbetrieb): Zugang zum
 *                                Google Drive und Datenschlüssel, verschlüsselt mit GOOGLE_CLIENT_SECRET.
 *   DAUERBETRIEB_LEER_STARTEN=1  Notausgang: ohne Wiederherstellung starten (z. B. Schlüssel verloren).
 *   RENDER_EXTERNAL_URL          setzt Render selbst – eigene öffentliche Adresse (Wecker, Übergabe beim Deploy).
 */
const fs = require('fs');
const path = require('path');

const env = (k) => String(process.env[k] || '').trim();
const num = (k, def) => {
  const n = Number(env(k));
  return Number.isFinite(n) && n > 0 ? n : def;
};

const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', '..', 'data', 'pake-scha.db');

/** Liegt der Ordner auf einem eigenen Laufwerk (Render-Disk)? Dann bleiben die Daten auch ohne Dauerbetrieb. */
function ownDisk(dir) {
  try {
    let d = dir;
    while (!fs.existsSync(d)) d = path.dirname(d);
    return fs.statSync(d).dev !== fs.statSync('/').dev;
  } catch {
    return false;
  }
}

function mode() {
  const v = env('DAUERBETRIEB').toLowerCase();
  if (['1', 'an', 'on', 'true', 'ja'].includes(v)) return { on: true, why: 'eingeschaltet (DAUERBETRIEB=1)' };
  if (['0', 'aus', 'off', 'false', 'nein'].includes(v)) return { on: false, why: 'ausgeschaltet (DAUERBETRIEB=0)' };
  if (env('RENDER') && !ownDisk(path.dirname(DB_PATH))) return { on: true, why: 'automatisch: Render ohne eigene Disk (Free-Plan)' };
  return env('RENDER') ? { on: false, disk: true, why: 'aus: Render mit eigener Disk' } : { on: false, why: 'aus: nicht auf Render' };
}
let cached = null;
const enabled = () => (cached ||= mode()).on;

/** Eigene öffentliche Adresse (für den Selbst-Ping und die Übergabe beim Deploy). */
function selfUrl() {
  const u = env('DAUER_SELF_URL') || env('RENDER_EXTERNAL_URL') || env('PUBLIC_URL');
  return /^https?:\/\//.test(u) ? u.replace(/\/+$/, '') : '';
}

module.exports = {
  DB_PATH,
  mode: () => (cached ||= mode()),
  enabled,
  selfUrl,
  recoveryKey: () => env('DAUERBETRIEB_SCHLUESSEL'),
  forceEmpty: () => ['1', 'ja', 'true'].includes(env('DAUERBETRIEB_LEER_STARTEN').toLowerCase()),
  clientSecret: () => env('GOOGLE_CLIENT_SECRET'),
  clientId: () => env('GOOGLE_CLIENT_ID'),
  apiBase: () => (env('GOOGLE_API_BASE') || 'https://www.googleapis.com').replace(/\/+$/, ''),
  oauthBase: () => (env('GOOGLE_OAUTH_BASE') || 'https://oauth2.googleapis.com').replace(/\/+$/, ''),
  // Takt (Millisekunden) – in Tests per Umgebung verkürzt
  JOURNAL_MS: num('DAUER_JOURNAL_MS', 1500), // so oft werden Änderungen eingesammelt (jede Aktion ist nach ~2 s im Drive)
  LEASE_MS: num('DAUER_LEASE_MS', 30000), // Herzschlag der laufenden Instanz im Drive
  PING_MS: num('DAUER_PING_MS', 4 * 60 * 1000), // Selbst-Ping (Render schläft nach 15 Minuten ohne Aufruf ein)
  SCAN_MS: num('DAUER_SCAN_MS', 15000), // Abgleich der hochgeladenen Dateien
  GUARD_MS: num('DAUER_GUARD_MS', 15 * 60 * 1000), // Speicherwächter
  BASE_EVERY_MS: num('DAUER_BASE_MS', 30 * 60 * 1000), // spätestens dann ein neuer Gesamtstand (wenn sich etwas geändert hat)
  BASE_AFTER_JOURNALS: num('DAUER_BASE_JOURNALS', 300),
  BASE_AFTER_BYTES: num('DAUER_BASE_BYTES', 8 * 1024 * 1024),
  HANDOVER_TIMEOUT_MS: num('DAUER_HANDOVER_MS', 20000),
  TAKEOVER_QUIET_MS: num('DAUER_TAKEOVER_MS', 90000), // so lange ohne Lebenszeichen der neuen Instanz → alte arbeitet weiter
  WAKE_ALERT_MS: num('DAUER_WAKE_ALERT_MS', 20 * 60 * 1000), // so lange ohne externen Wecker → Warnung
  DELETED_KEEP_DAYS: 30, // gelöschte Bilder bleiben so lange im Drive
};
