'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// Render: Ohne "Persistent Disk" ist das Dateisystem flüchtig -- die Datenbank
// wäre nach jedem Deploy/Neustart leer. Disk z. B. unter /var/data mounten und
// DB_PATH=/var/data/pake-scha.db als Umgebungsvariable setzen (siehe README).
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'pake-scha.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

/* ================================================================
   Tabellen-Definitionen
   ================================================================ */
// Tabellen, die bei Altdatenbanken neu aufgebaut werden müssen, sind als
// Funktion definiert (Tabellenname als Parameter), damit Neuanlage und
// Migration exakt dasselbe Schema verwenden.
const CASES_SQL = (name) => `
  CREATE TABLE ${name} (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number   TEXT NOT NULL UNIQUE,
    access_pin    TEXT NOT NULL,
    title         TEXT NOT NULL,
    area          TEXT NOT NULL DEFAULT 'sonstiges',
    urgency       TEXT NOT NULL DEFAULT 'normal',
    description   TEXT NOT NULL DEFAULT '',
    client_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_name   TEXT NOT NULL DEFAULT '',
    client_phone  TEXT NOT NULL DEFAULT '',
    opponent      TEXT NOT NULL DEFAULT '',
    court_ref     TEXT NOT NULL DEFAULT '',
    lawyer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_bearbeitung','geschlossen')),
    step          INTEGER NOT NULL DEFAULT 0,
    public_note   TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'portal',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

// Ein gemeinsamer Kalender für Mandanten-Terminanfragen, Gerichtstermine,
// Fristen und interne Termine.
const APPOINTMENTS_SQL = (name) => `
  CREATE TABLE ${name} (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    client_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type           TEXT NOT NULL DEFAULT 'mandant' CHECK (type IN ('mandant','gericht','frist','intern')),
    title          TEXT NOT NULL,
    starts_at      TEXT NOT NULL,
    ends_at        TEXT,
    location       TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'bestaetigt' CHECK (status IN ('angefragt','bestaetigt','abgesagt','erledigt')),
    assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_visible INTEGER NOT NULL DEFAULT 1,
    reminded       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

const NOTES_SQL = (name) => `
  CREATE TABLE ${name} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL,
    body        TEXT NOT NULL,
    internal    INTEGER NOT NULL DEFAULT 0,
    system      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

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

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('mandant','anwalt','admin')),
    phone         TEXT,
    rank          TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id      INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    subject      TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL,
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Öffentliche Team-Übersicht der Startseite. user_id verknüpft optional
  -- mit einem Login-Konto (Namens-/Rangänderungen werden dann synchronisiert).
  CREATE TABLE IF NOT EXISTS team_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    role_title  TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    initials    TEXT NOT NULL,
    tier        TEXT NOT NULL DEFAULT 'anwalt',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Honorarordnung: Quelle für Startseite, Tarifrechner und Rechnungs-Generator.
  CREATE TABLE IF NOT EXISTS fees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    price         INTEGER NOT NULL DEFAULT 0,
    in_calculator INTEGER NOT NULL DEFAULT 1,
    active        INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Team-Pinnwand (interne Notizen)
  CREATE TABLE IF NOT EXISTS board_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT 'gold',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

createIfMissing('cases', CASES_SQL);
createIfMissing('notes', NOTES_SQL);
createIfMissing('appointments', APPOINTMENTS_SQL);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    number           TEXT NOT NULL UNIQUE,
    kind             TEXT NOT NULL DEFAULT 'rechnung' CHECK (kind IN ('rechnung','honorarvereinbarung')),
    case_id          INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    client_name      TEXT NOT NULL,
    client_contact   TEXT NOT NULL DEFAULT '',
    subject          TEXT NOT NULL DEFAULT '',
    items_json       TEXT NOT NULL DEFAULT '[]',
    subtotal         INTEGER NOT NULL DEFAULT 0,
    discount_pct     REAL NOT NULL DEFAULT 0,
    discount_amount  INTEGER NOT NULL DEFAULT 0,
    surcharge_pct    REAL NOT NULL DEFAULT 0,
    surcharge_amount INTEGER NOT NULL DEFAULT 0,
    total            INTEGER NOT NULL DEFAULT 0,
    notes            TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','bezahlt','storniert')),
    due_date         TEXT,
    issued_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issuer_name      TEXT NOT NULL DEFAULT '',
    issuer_rank      TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at          TEXT
  );
`);

/* ================================================================
   Migrationen für bestehende Datenbanken
   ================================================================ */
// Neue Spalten lassen sich per ALTER TABLE ergänzen.
addColumn('users', 'discord_id', 'TEXT');
addColumn('users', 'discord_username', 'TEXT');
addColumn('users', 'discord_avatar', 'TEXT');
addColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
addColumn('team_members', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('team_members', 'visible', 'INTEGER NOT NULL DEFAULT 1');
addColumn('messages', 'priority', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'sender_deleted', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'recipient_deleted', 'INTEGER NOT NULL DEFAULT 0');

// NOT NULL entfernen oder ON-DELETE-Regeln ändern geht in SQLite nur über
// einen Neuaufbau der Tabelle (offizielles 12-Schritte-Verfahren). Vorher
// wird automatisch eine vollständige Sicherungskopie der Datenbank angelegt.
function foreignKeyAction(table, column) {
  const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((f) => f.from === column);
  return fk ? String(fk.on_delete).toUpperCase() : null;
}

function migrateLegacyTables() {
  const plan = [];

  if (!columns('cases').includes('status')) {
    const cols = columns('cases');
    const has = (c) => cols.includes(c);
    plan.push({
      table: 'cases',
      sql: CASES_SQL,
      copy: `INSERT INTO cases_new (id, case_number, access_pin, title, area, urgency, description, client_id,
                                    lawyer_id, status, step, public_note, source, created_at, updated_at)
             SELECT id, case_number, access_pin, title, area, urgency, description, client_id, lawyer_id,
                    CASE WHEN ${has('closed') ? 'closed = 1' : '0'} THEN 'geschlossen'
                         WHEN lawyer_id IS NOT NULL THEN 'in_bearbeitung'
                         ELSE 'offen' END,
                    step, ${has('public_note') ? 'public_note' : "''"}, 'portal', created_at, updated_at
             FROM cases`,
    });
  }

  if (!columns('appointments').includes('type')) {
    plan.push({
      table: 'appointments',
      sql: APPOINTMENTS_SQL,
      copy: `INSERT INTO appointments_new (id, case_id, client_id, type, title, starts_at, location, note, status,
                                           client_visible, created_at)
             SELECT id, case_id, client_id, 'mandant', title, starts_at, COALESCE(location, ''), COALESCE(note, ''),
                    status, 1, created_at
             FROM appointments`,
    });
  }

  if (foreignKeyAction('notes', 'author_id') !== 'SET NULL') {
    plan.push({
      table: 'notes',
      sql: NOTES_SQL,
      copy: `INSERT INTO notes_new (id, case_id, author_id, author_name, author_role, body, internal, system, created_at)
             SELECT id, case_id, author_id, author_name, author_role, body, internal, system, created_at FROM notes`,
    });
  }

  if (!plan.length) return;

  const backupPath = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  console.log(`Migration: Sicherungskopie angelegt unter ${backupPath}`);

  db.exec('PRAGMA foreign_keys = OFF');
  // Ohne abgeschaltete Fremdschlüssel würde DROP TABLE abhängige Zeilen
  // (z. B. Notizen) per CASCADE löschen -- daher hart abbrechen.
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 0) {
    throw new Error('Migration abgebrochen: Fremdschlüssel konnten nicht deaktiviert werden.');
  }
  try {
    db.exec('BEGIN');
    for (const step of plan) {
      db.exec(`DROP TABLE IF EXISTS ${step.table}_new`);
      db.exec(step.sql(`${step.table}_new`));
      db.exec(step.copy);
      db.exec(`DROP TABLE ${step.table}`);
      db.exec(`ALTER TABLE ${step.table}_new RENAME TO ${step.table}`);
    }
    const problems = db.prepare('PRAGMA foreign_key_check').all();
    if (problems.length) console.warn(`Migration: ${problems.length} verwaiste Fremdschlüssel-Verweise gefunden (Daten bleiben erhalten).`);
    db.exec('COMMIT');
    console.log(`Migration: Tabellen aktualisiert (${plan.map((p) => p.table).join(', ')}).`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateLegacyTables();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_cases_client ON cases(client_id);
  CREATE INDEX IF NOT EXISTS idx_cases_lawyer ON cases(lawyer_id);
  CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
  CREATE INDEX IF NOT EXISTS idx_notes_case ON notes(case_id);
  CREATE INDEX IF NOT EXISTS idx_appt_case ON appointments(case_id);
  CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
  CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(starts_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord ON users(discord_id);
`);

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

/** Fortlaufende Nummer pro Jahr, z. B. PS-2026-0007. Lücken durch Löschen führen nicht zu Dubletten. */
function nextNumber(prefix, table, column) {
  const head = `${prefix}-${new Date().getFullYear()}-`;
  const row = db
    .prepare(`SELECT MAX(CAST(substr(${column}, ?) AS INTEGER)) AS m FROM ${table} WHERE ${column} LIKE ?`)
    .get(head.length + 1, `${head}%`);
  return head + String((row?.m ?? 0) + 1).padStart(4, '0');
}

const nextCaseNumber = () => nextNumber('PS', 'cases', 'case_number');
const nextInvoiceNumber = (kind) => nextNumber(kind === 'honorarvereinbarung' ? 'HV' : 'RE', 'invoices', 'number');

function randomPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, DB_PATH, tx, nextCaseNumber, nextInvoiceNumber, randomPin, getSetting, setSetting };
