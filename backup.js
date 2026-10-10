'use strict';
/*
 * Datensicherung: Einmal am Tag eine Kopie der Datenbank in den Ordner backups/ neben der Datenbank
 * (auf Render also auf der Persistent Disk). Aufbewahrt werden die Sicherungen der letzten 7 Tage und
 * danach eine je Woche bis 5 Wochen zurück. Login-Sitzungen werden aus den Kopien entfernt.
 * Das Board of Partners (Admin) kann unter Einstellungen → System jederzeit sichern und herunterladen.
 * Wiederherstellen: Sicherung als „restore.db“ neben die Datenbank legen und neu starten (siehe db.js / README).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { db, DB_PATH } = require('./db');

const DIR = path.join(path.dirname(DB_PATH), 'backups');
const NAME_RE = /^pake-scha-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2})(\d{2}))?\.db$/;
const KEEP_DAILY_DAYS = 7;
const KEEP_WEEKLY_DAYS = 35;

/** Zeitpunkt einer Sicherung aus dem Dateinamen (UTC). */
function stampOf(name) {
  const m = name.match(NAME_RE);
  if (!m) return null;
  return Date.parse(`${m[1]}T${m[2] || '00'}:${m[3] || '00'}:${m[4] || '00'}Z`);
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(DIR, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString(), stamp: stampOf(name) };
    })
    .sort((a, b) => b.stamp - a.stamp || b.createdAt.localeCompare(a.createdAt));
}

function freeBytes() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const s = fs.statfsSync(DIR);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

function dbBytes() {
  let n = 0;
  for (const ext of ['', '-wal']) {
    try {
      n += fs.statSync(DB_PATH + ext).size;
    } catch {
      /* keine WAL-Datei */
    }
  }
  return n;
}

/** ISO-Kalenderwoche „JJJJ-WW“ (für die wöchentliche Aufbewahrung). */
function isoWeek(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // Donnerstag derselben Woche
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-${Math.ceil(((d - yearStart) / 864e5 + 1) / 7)}`;
}

/** Alte Sicherungen löschen: 7 Tage alle, bis 5 Wochen die neueste je Woche, ältere gar nicht. */
function prune(now = Date.now()) {
  const weeks = new Set();
  for (const b of list()) {
    const age = (now - b.stamp) / 864e5; // Alter nach dem Datum im Dateinamen
    if (age <= KEEP_DAILY_DAYS) continue;
    if (age <= KEEP_WEEKLY_DAYS) {
      const wk = isoWeek(b.stamp);
      if (!weeks.has(wk)) {
        weeks.add(wk);
        continue;
      }
    }
    fs.rmSync(path.join(DIR, b.name), { force: true });
  }
}

/** Sicherung anlegen. „auto“ = eine je Tag, „manual“ = mit Uhrzeit im Namen. */
function create(kind = 'manual') {
  fs.mkdirSync(DIR, { recursive: true });
  const iso = new Date().toISOString();
  const name = kind === 'auto' ? `pake-scha-${iso.slice(0, 10)}.db` : `pake-scha-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}.db`;
  const free = freeBytes();
  if (free !== null && free < dbBytes() * 2 + 20 * 1024 * 1024) throw new Error('Zu wenig freier Speicher auf der Disk für eine Sicherung.');
  const tmp = path.join(DIR, `.${name}.tmp`);
  fs.rmSync(tmp, { force: true });
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // konsistente Kopie, auch während der Server läuft
    // Keine gültigen Login-Sitzungen in Sicherungen (Tokens) – restlos entfernen
    const copy = new DatabaseSync(tmp);
    try {
      copy.exec('PRAGMA secure_delete = ON; DELETE FROM sessions; VACUUM;');
    } finally {
      copy.close();
    }
    fs.renameSync(tmp, path.join(DIR, name));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  prune();
  return list().find((b) => b.name === name);
}

/** Tägliche Sicherung, falls es für heute (UTC) noch keine gibt. */
function ensureToday() {
  const day = new Date().toISOString().slice(0, 10);
  if (list().some((b) => b.name.startsWith(`pake-scha-${day}`))) return null;
  const b = create('auto');
  console.log(`Datensicherung angelegt: ${b.name} (${Math.round(b.size / 1024)} KB).`);
  return b;
}

/** Beim Start: nach einer Minute prüfen, danach stündlich. */
function start() {
  const alerts = () => require('./systemAlerts');
  const run = () => {
    try {
      ensureToday();
      alerts().backupOk(); // Entwarnung, falls vorher gewarnt wurde
    } catch (err) {
      console.warn('Datensicherung fehlgeschlagen:', err.message);
      alerts().backupFailed(err); // Board einmal per Discord warnen
    }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

/** Pfad einer Sicherung (nur gültige Namen aus dem Sicherungsordner), sonst null. */
function fileOf(name) {
  if (!NAME_RE.test(String(name))) return null;
  const file = path.join(DIR, name);
  return fs.existsSync(file) ? file : null;
}

module.exports = { list, create, ensureToday, prune, start, fileOf, freeBytes, dbBytes, DIR, KEEP_DAILY_DAYS, KEEP_WEEKLY_DAYS };
