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

// Hochgeladene Dateien liegen neben der Datenbank (auf Render also ebenfalls auf der Disk).
// public/ wird unter /media ausgeliefert (Profilbilder), evidence/ nur über die API mit Rechteprüfung.
const UPLOAD_DIR = path.join(path.dirname(DB_PATH), 'uploads');
const PUBLIC_MEDIA_DIR = path.join(UPLOAD_DIR, 'public');
const EVIDENCE_DIR = path.join(UPLOAD_DIR, 'evidence');
for (const dir of [path.join(PUBLIC_MEDIA_DIR, 'avatars'), path.join(PUBLIC_MEDIA_DIR, 'team'), EVIDENCE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

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

  -- Stempeluhr: eine Zeile pro Dienstschicht (ended_at NULL = läuft noch).
  CREATE TABLE IF NOT EXISTS duty_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    note        TEXT NOT NULL DEFAULT '',
    auto_closed INTEGER NOT NULL DEFAULT 0
  );

  -- Bewerbungssystem
  CREATE TABLE IF NOT EXISTS positions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    requirements TEXT NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    number         TEXT NOT NULL UNIQUE,
    access_code    TEXT NOT NULL,
    position_id    INTEGER REFERENCES positions(id) ON DELETE SET NULL,
    position_title TEXT NOT NULL,
    name           TEXT NOT NULL,
    age            INTEGER,
    phone          TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL DEFAULT '',
    discord        TEXT NOT NULL DEFAULT '',
    experience     TEXT NOT NULL DEFAULT '',
    motivation     TEXT NOT NULL,
    availability   TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'eingegangen' CHECK (status IN ('eingegangen','in_pruefung','gespraech','angenommen','abgelehnt')),
    rating         INTEGER NOT NULL DEFAULT 0,
    public_note    TEXT NOT NULL DEFAULT '',
    interview_at   TEXT,
    hired_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS application_notes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name    TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Beweismittel / Bildanhänge zu Akten (Dateien in uploads/evidence)
  CREATE TABLE IF NOT EXISTS case_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    file          TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    caption       TEXT NOT NULL DEFAULT '',
    internal      INTEGER NOT NULL DEFAULT 0,
    uploader_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploader_name TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Aktivitätsprotokoll für die Kanzleileitung
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name  TEXT NOT NULL DEFAULT 'System',
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL DEFAULT '',
    entity_id  INTEGER,
    details    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Externe Dokumente (derzeit FiveNet) als Referenz an einer Akte. Der Inhalt
  -- bleibt in FiveNet; gespeichert werden Adresse, Dokument-ID und die vom
  -- Anwalt erfassten Metadaten. external_id ist TEXT, weil FiveNet int64 nutzt.
  CREATE TABLE IF NOT EXISTS case_external_docs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL DEFAULT 'fivenet',
    external_id    TEXT NOT NULL,
    original_url   TEXT NOT NULL,
    canonical_url  TEXT NOT NULL,
    host           TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    doc_type       TEXT NOT NULL DEFAULT '',
    doc_date       TEXT,
    doc_author     TEXT NOT NULL DEFAULT '',
    summary        TEXT NOT NULL DEFAULT '',
    viewed_as      TEXT NOT NULL DEFAULT '',
    internal       INTEGER NOT NULL DEFAULT 1,
    attested       INTEGER NOT NULL DEFAULT 0,
    linked_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    linked_by_name TEXT NOT NULL,
    linked_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT,
    UNIQUE (case_id, provider, external_id)
  );

  -- Aufgaben & Wiedervorlagen (mit oder ohne Aktenbezug, nur für das Team)
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    due_date    TEXT,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    done_at     TEXT,
    done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Weitere Anwälte einer Akte (Mitbearbeitung). Der federführende Anwalt steht in cases.lawyer_id
  -- und ist hier nie zusätzlich eingetragen.
  CREATE TABLE IF NOT EXISTS case_lawyers (
    case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (case_id, user_id)
  );

  -- Vertragsvorlagen (z. B. Mandatsvertrag), im Dashboard von der Kanzleileitung pflegbar
  CREATE TABLE IF NOT EXISTS contract_templates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT UNIQUE,                  -- mitgelieferte Vorlage (zum Zurücksetzen), sonst NULL
    name            TEXT NOT NULL,
    body            TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    updated_by_name TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Verträge einer Akte: Vorlagentext und ausgefüllte Felder werden beim Erstellen festgehalten
  CREATE TABLE IF NOT EXISTS case_contracts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    template_name     TEXT NOT NULL,
    body              TEXT NOT NULL,
    data              TEXT NOT NULL DEFAULT '{}',
    lawyer_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    lawyer_signature  TEXT,
    lawyer_signed_at  TEXT,
    client_signature  TEXT,
    client_signed_at  TEXT,
    client_signed_via TEXT,                       -- 'portal' (selbst) oder 'kanzlei' (im Spiel unterschrieben, erfasst)
    client_recorded_by_name TEXT NOT NULL DEFAULT '',
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name   TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
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
addColumn('users', 'avatar', 'TEXT');
addColumn('users', 'duty_status', "TEXT NOT NULL DEFAULT 'off'");
addColumn('users', 'duty_note', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'duty_since', 'TEXT');
addColumn('team_members', 'photo', 'TEXT');
// FiveNet: Abschrift des Dokumenttexts und aus FiveNet übernommene Bilder
addColumn('case_external_docs', 'content_text', "TEXT NOT NULL DEFAULT ''");
addColumn('case_external_docs', 'content_at', 'TEXT');
addColumn('case_external_docs', 'content_by_name', "TEXT NOT NULL DEFAULT ''");
// Reihenfolge in der Akte (per Ziehen festgelegt); NULL = noch nicht einsortiert, erscheint oben.
addColumn('case_external_docs', 'sort_order', 'INTEGER');
addColumn('case_attachments', 'external_doc_id', 'INTEGER REFERENCES case_external_docs(id) ON DELETE SET NULL');
addColumn('case_attachments', 'source_url', 'TEXT');
addColumn('case_attachments', 'content_hash', 'TEXT');

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
  CREATE INDEX IF NOT EXISTS idx_case_lawyers_user ON case_lawyers(user_id);
  CREATE INDEX IF NOT EXISTS idx_contracts_case ON case_contracts(case_id);
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
  CREATE INDEX IF NOT EXISTS idx_duty_user ON duty_sessions(user_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_duty_open ON duty_sessions(ended_at);
  CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
  CREATE INDEX IF NOT EXISTS idx_app_notes ON application_notes(application_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_case ON case_attachments(case_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_extdocs_case ON case_external_docs(case_id);
  CREATE INDEX IF NOT EXISTS idx_extdocs_ref ON case_external_docs(provider, external_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_extdoc ON case_attachments(external_doc_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, done, due_date);
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
const nextApplicationNumber = () => nextNumber('BW', 'applications', 'number');

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
  randomPin,
  getSetting,
  setSetting,
};
