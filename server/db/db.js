'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { DatabaseSync } = require('node:sqlite');

// Render: Ohne "Persistent Disk" ist das Dateisystem flüchtig -- die Datenbank
// wäre nach jedem Deploy/Neustart leer. Disk z. B. unter /var/data mounten und
// DB_PATH=/var/data/pake-scha.db als Umgebungsvariable setzen (siehe README).
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', '..', 'data', 'pake-scha.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Hochgeladene Dateien liegen neben der Datenbank (auf Render also ebenfalls auf der Disk).
// public/ wird unter /media ausgeliefert (Profilbilder), evidence/ nur über die API mit Rechteprüfung.
const UPLOAD_DIR = path.join(path.dirname(DB_PATH), 'uploads');
const PUBLIC_MEDIA_DIR = path.join(UPLOAD_DIR, 'public');
const EVIDENCE_DIR = path.join(UPLOAD_DIR, 'evidence');
for (const dir of [path.join(PUBLIC_MEDIA_DIR, 'avatars'), path.join(PUBLIC_MEDIA_DIR, 'team'), path.join(PUBLIC_MEDIA_DIR, 'items'), EVIDENCE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Wiederherstellen: Liegt beim Start eine Datei „restore.db“ neben der Datenbank (z. B. eine Sicherung aus
// backups/), ersetzt sie die aktuelle Datenbank. Die bisherige bleibt als „….before-restore-<Zeit>“ erhalten.
const RESTORE_PATH = path.join(path.dirname(DB_PATH), 'restore.db');
if (fs.existsSync(RESTORE_PATH)) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(RESTORE_PATH, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\0') {
    fs.renameSync(RESTORE_PATH, `${RESTORE_PATH}.ungueltig`);
    console.warn('restore.db ist keine SQLite-Datenbank – nicht eingespielt (umbenannt in restore.db.ungueltig).');
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(DB_PATH + ext)) fs.renameSync(DB_PATH + ext, `${DB_PATH}.before-restore-${stamp}${ext}`);
    }
    fs.renameSync(RESTORE_PATH, DB_PATH);
    console.log(`Datenbank aus restore.db wiederhergestellt – die vorherige liegt unter ${path.basename(DB_PATH)}.before-restore-${stamp}.`);
  }
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
// Schneller ohne Risiko: mit WAL genügt „NORMAL“ (nach einem Absturz fehlt höchstens der letzte Schreibvorgang, die
// Datei bleibt heil), 16 MB Zwischenspeicher im Arbeitsspeicher, Hilfstabellen im Speicher statt auf der Disk.
db.exec('PRAGMA synchronous = NORMAL; PRAGMA cache_size = -16000; PRAGMA temp_store = MEMORY;');
// Vorbereitete Abfragen wiederverwenden statt jedes Mal neu zu übersetzen (gleicher SQL-Text → gleiche Abfrage).
// Begrenzt, damit Abfragen mit eingesetzten Werten den Speicher nicht füllen.
{
  const prepare = db.prepare.bind(db);
  const statements = new Map();
  db.prepare = (sql) => {
    let stmt = statements.get(sql);
    if (!stmt) {
      stmt = prepare(sql);
      if (statements.size >= 1000) statements.clear();
      statements.set(sql, stmt);
    }
    return stmt;
  };
}

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}
function createIfMissing(name, sqlFn) {
  if (!tableExists(name)) db.exec(sqlFn(name));
}
function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function addColumn(table, name, ddl) {
  if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

/* ================================================================
   Helfer
   ================================================================ */
/** Führt fn in einer Transaktion aus (node:sqlite hat keinen eigenen Helfer). */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Fortlaufende Nummer pro Jahr, z. B. PS-2026-0007. Lücken durch Löschen führen nicht zu Dubletten.
 * also: weitere [Tabelle, Spalte], deren Nummern ebenfalls belegt sind (Akten im Papierkorb).
 */
function nextNumber(prefix, table, column, also = []) {
  const head = `${prefix}-${new Date().getFullYear()}-`;
  const max = (t, col) =>
    db.prepare(`SELECT MAX(CAST(substr(${col}, ?) AS INTEGER)) AS m FROM ${t} WHERE ${col} LIKE ?`).get(head.length + 1, `${head}%`)?.m ?? 0;
  const m = Math.max(max(table, column), ...also.map(([t, col]) => max(t, col)));
  return head + String(m + 1).padStart(4, '0');
}

const nextCaseNumber = () => nextNumber('PS', 'cases', 'case_number', [['case_trash', 'case_number']]);
const nextInvoiceNumber = (kind) => nextNumber(kind === 'honorarvereinbarung' ? 'HV' : 'RE', 'invoices', 'number');
const nextApplicationNumber = () => nextNumber('BW', 'applications', 'number');
const nextConcernNumber = () => nextNumber('AN', 'concerns', 'reference');

function randomPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
/** Wer gerade ändert (pro Anfrage gesetzt) – damit Einstellungsänderungen im Änderungsprotokoll mit Namen stehen. */
const actor = new AsyncLocalStorage();
const settingHooks = [];
function setSetting(key, value) {
  const next = String(value);
  const hooked = settingHooks.length && actor.getStore();
  const prev = hooked ? getSetting(key, null) : null;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, next);
  if (hooked && prev !== next) for (const h of settingHooks) h(key, prev, next, actor.getStore());
}

/* ================================================================
   Tabellen: nummerierte Migrationen (server/db/migrations/NNN-*.js), jede läuft genau einmal
   ================================================================ */
require('./migrate').runMigrations({ db, DB_PATH, crypto, tableExists, createIfMissing, columns, addColumn, getSetting, setSetting, randomPin, nextConcernNumber });

/*
 * Volltextsuche (SQLite FTS5) über Notizen und Chat der Akten: schnell auch bei vielen tausend Einträgen und nach
 * Relevanz sortiert. Der Index folgt den Notizen über Trigger von selbst; beim Start wird er neu aufgebaut (dauert nur
 * Bruchteile einer Sekunde und fängt alles auf, was z. B. eine eingespielte Sicherung mitbringt).
 */
try {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(body, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN INSERT INTO notes_fts(rowid, body) VALUES (new.id, new.body); END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF body ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.id, old.body);
      INSERT INTO notes_fts(rowid, body) VALUES (new.id, new.body);
    END;
    INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');`);
} catch (err) {
  console.warn('Volltextsuche nicht verfügbar – die Suche arbeitet ohne Index:', err.message);
}

module.exports = {
  db,
  DB_PATH,
  UPLOAD_DIR,
  PUBLIC_MEDIA_DIR,
  EVIDENCE_DIR,
  tx,
  nextCaseNumber,
  nextInvoiceNumber,
  nextApplicationNumber,
  nextConcernNumber,
  randomPin,
  getSetting,
  setSetting,
  actor,
  settingHooks,
};
