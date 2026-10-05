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
    closed_at     TEXT,
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

  -- Aktivitätsprotokoll für das Board of Partners
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

  -- Bearbeitung von Akten: wer war wann zuständig (automatisch bei Zuweisung, Abgabe, Schließen).
  -- Nur für das Board of Partners auswertbar.
  CREATE TABLE IF NOT EXISTS case_work (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'lead',     -- 'lead' (federführend) | 'co' (weiterer Anwalt)
    started_at TEXT NOT NULL,                    -- ISO-Zeitpunkt
    ended_at   TEXT,
    end_reason TEXT NOT NULL DEFAULT '',
    estimated  INTEGER NOT NULL DEFAULT 0        -- vor Einführung der Erfassung: aus dem Aktenverlauf geschätzt
  );

  -- Anliegen an das Board of Partners (Führungsebene) von Mitarbeitern und Mandanten: Einreichung, Antworten, Status
  CREATE TABLE IF NOT EXISTS concerns (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name       TEXT NOT NULL DEFAULT '',
    author_group      TEXT NOT NULL DEFAULT 'mitarbeiter', -- mitarbeiter | mandant (bleibt auch bei anonymen Anliegen sichtbar)
    anonymous         INTEGER NOT NULL DEFAULT 0,  -- dem Board wird die einreichende Person nicht angezeigt
    category          TEXT NOT NULL DEFAULT 'sonstiges',
    urgency           TEXT NOT NULL DEFAULT 'normal',
    subject           TEXT NOT NULL,
    body              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'offen', -- offen | in_bearbeitung | erledigt | abgelehnt
    assigned_to       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_seen_at    TEXT,                          -- zuletzt von der einreichenden Person geöffnet
    board_activity_at TEXT,                          -- letzte sichtbare Antwort/Statusänderung des Boards
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at         TEXT
  );
  CREATE TABLE IF NOT EXISTS concern_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    concern_id  INTEGER NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL DEFAULT '',
    from_board  INTEGER NOT NULL DEFAULT 0,
    internal    INTEGER NOT NULL DEFAULT 0,          -- interne Notiz des Boards (für die einreichende Person unsichtbar)
    system      INTEGER NOT NULL DEFAULT 0,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Personalprotokoll: Einstellungen und Beförderungen/Rangänderungen (für alle Mitarbeiter sichtbar)
  CREATE TABLE IF NOT EXISTS personnel_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    person_name TEXT NOT NULL,
    type        TEXT NOT NULL,                       -- einstellung | befoerderung | rueckstufung | rangaenderung
    old_rank    TEXT,
    new_rank    TEXT,
    note        TEXT NOT NULL DEFAULT '',
    by_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    by_name     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Abmeldungen des Teams (Abwesenheit von–bis, Grund); werden auf Wunsch in Discord gemeldet
  CREATE TABLE IF NOT EXISTS absences (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date      TEXT NOT NULL,                -- YYYY-MM-DD
    end_date        TEXT NOT NULL,                -- YYYY-MM-DD (einschließlich)
    reason          TEXT NOT NULL DEFAULT 'sonstiges',
    note            TEXT NOT NULL DEFAULT '',
    returned_at     TEXT,                         -- vorzeitig zurückgemeldet
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Vertragsvorlagen (z. B. Mandatsvertrag), im Dashboard vom Board of Partners pflegbar
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

  -- Discord-Bot: bereits begrüßte Beitritte (ein Beitritt = Mitglied + Beitrittszeitpunkt; verhindert doppelte Begrüßung)
  CREATE TABLE IF NOT EXISTS discord_welcomes (
    member_id  TEXT NOT NULL,
    joined_at  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, joined_at)
  );

  -- Discord-Bot, Join Roles: Warteschlange je Beitritt (Verzögerung / Regel-Bestätigung abwarten; übersteht Neustarts)
  CREATE TABLE IF NOT EXISTS discord_join_roles (
    member_id  TEXT NOT NULL,
    joined_at  TEXT NOT NULL,
    is_bot     INTEGER NOT NULL DEFAULT 0,
    due_at     TEXT NOT NULL,
    checked_at TEXT,
    done_at    TEXT,
    result     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (member_id, joined_at)
  );
  CREATE INDEX IF NOT EXISTS idx_join_roles_open ON discord_join_roles(done_at, due_at);

  -- Discord-Bot, Nachrichten: eigene Vorlagen (Text + Embed + Link-Buttons)
  CREATE TABLE IF NOT EXISTS bot_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    data            TEXT NOT NULL DEFAULT '{}',
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Automatik je Vorlage: 'zeitplan' (alle N Minuten ab Startzeit) oder 'nachrichten' (alle N Nachrichten im Kanal)
  CREATE TABLE IF NOT EXISTS bot_message_jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id      INTEGER NOT NULL REFERENCES bot_messages(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('zeitplan', 'nachrichten')),
    channel_id       TEXT NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER,
    next_run_at      TEXT,
    every_messages   INTEGER,
    counter          INTEGER NOT NULL DEFAULT 0,
    replace_previous INTEGER NOT NULL DEFAULT 1,
    last_message_id  TEXT,
    last_sent_at     TEXT,
    last_error       TEXT,
    created_by_name  TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bot_jobs_template ON bot_message_jobs(template_id);
  -- Von Hand gesendete Vorlagen (zum späteren Aktualisieren oder Löschen in Discord)
  CREATE TABLE IF NOT EXISTS bot_message_sent (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id        INTEGER NOT NULL REFERENCES bot_messages(id) ON DELETE CASCADE,
    channel_id         TEXT NOT NULL,
    discord_message_id TEXT NOT NULL,
    sent_by_name       TEXT NOT NULL DEFAULT '',
    sent_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bot_sent_template ON bot_message_sent(template_id);

  -- Weitere unterzeichnende Anwälte eines Vertrags (der erste steht in case_contracts.lawyer_id).
  -- Name und Rang werden beim Eintragen festgehalten, damit der Vertrag später gleich bleibt.
  CREATE TABLE IF NOT EXISTS case_contract_lawyers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES case_contracts(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NOT NULL DEFAULT '',
    rank        TEXT NOT NULL DEFAULT '',
    birth       TEXT NOT NULL DEFAULT '',
    signature   TEXT,
    signed_at   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );
`);

/* ================================================================
   Migrationen für bestehende Datenbanken
   ================================================================ */
// Neue Spalten lassen sich per ALTER TABLE ergänzen.
addColumn('users', 'discord_id', 'TEXT');
addColumn('users', 'discord_username', 'TEXT');
addColumn('users', 'discord_avatar', 'TEXT');
addColumn('users', 'personnel_seen_id', 'INTEGER'); // zuletzt gesehener Eintrag im Personalprotokoll
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
// Zeitpunkt des Schließens einer Akte (für die Bearbeitungsdauer); beim Wiedereröffnen wieder NULL.
addColumn('cases', 'closed_at', 'TEXT');
// Discord-Ticket je Akte (Kanal, Mitglieder mit eigener Berechtigung, Mandant ohne Konto, letzter Fehler)
addColumn('cases', 'discord_channel_id', 'TEXT');
addColumn('cases', 'discord_members', 'TEXT');
addColumn('cases', 'discord_client_id', 'TEXT');
addColumn('cases', 'discord_archived', 'INTEGER NOT NULL DEFAULT 0');
addColumn('cases', 'discord_error', 'TEXT');
addColumn('cases', 'discord_panel_id', 'TEXT'); // Nachricht mit den Buttons (Übernehmen, Schließen …)
addColumn('cases', 'discord_panel_state', 'TEXT');
addColumn('cases', 'discord_extra', 'TEXT'); // per /add hinzugefügte Personen (Discord-IDs)
// Priorität (nur intern, für die Kanzlei): 1 niedrig · 2 normal · 3 hoch · 4 kritisch
addColumn('cases', 'priority', 'INTEGER NOT NULL DEFAULT 2');
// Prozessticket: Link zum Kanal auf einem anderen Discord (z. B. DOJ) – nur für die Kanzlei sichtbar
addColumn('cases', 'process_ticket_url', 'TEXT');
addColumn('cases', 'process_ticket_label', 'TEXT');
// Board-Tickets (Discord-Kanal je Bewerbung bzw. Anliegen, nur für das Board of Partners)
for (const table of ['applications', 'concerns']) {
  addColumn(table, 'discord_channel_id', 'TEXT');
  addColumn(table, 'discord_members', 'TEXT');
  addColumn(table, 'discord_archived', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(table, 'discord_error', 'TEXT');
  addColumn(table, 'discord_panel_id', 'TEXT');
  addColumn(table, 'discord_panel_state', 'TEXT');
  addColumn(table, 'discord_extra', 'TEXT');
}
// VIP & Perma-Mandat: Stufen (Preis, Laufzeit, Rabatt – pflegt das Board of Partners) und vergebene Mitgliedschaften
db.exec(`
  CREATE TABLE IF NOT EXISTS membership_tiers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'vip',     -- vip (auf Zeit) | perma (unbefristet)
    price          INTEGER NOT NULL DEFAULT 0,
    duration_days  INTEGER,                          -- NULL = unbefristet
    discount_pct   REAL NOT NULL DEFAULT 0,
    benefits       TEXT NOT NULL DEFAULT '',
    discord_role_id TEXT NOT NULL DEFAULT '',
    active         INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS memberships (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id         INTEGER REFERENCES membership_tiers(id) ON DELETE SET NULL,
    tier_name       TEXT NOT NULL,                   -- festgehalten, falls die Stufe später geändert wird
    kind            TEXT NOT NULL,
    discount_pct    REAL NOT NULL,
    price_paid      INTEGER NOT NULL DEFAULT 0,      -- Summe inkl. Verlängerungen
    starts_at       TEXT NOT NULL,
    expires_at      TEXT,                            -- NULL = unbefristet (Perma)
    status          TEXT NOT NULL DEFAULT 'aktiv',   -- aktiv | abgelaufen | beendet
    note            TEXT NOT NULL DEFAULT '',
    discord_role_id TEXT NOT NULL DEFAULT '',
    reminded_at     TEXT,
    ended_at        TEXT,
    ended_by_name   TEXT,
    end_reason      TEXT,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);

  -- Anfrage eines Mandanten (Startseite / Portal) → Board nimmt an (Rechnung) → bezahlt → Mitgliedschaft aktiv
  CREATE TABLE IF NOT EXISTS membership_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id         INTEGER REFERENCES membership_tiers(id) ON DELETE SET NULL,
    tier_name       TEXT NOT NULL,
    kind            TEXT NOT NULL,
    price           INTEGER NOT NULL,
    duration_days   INTEGER,
    discount_pct    REAL NOT NULL,
    discord_role_id TEXT NOT NULL DEFAULT '',
    message         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'offen',   -- offen | angenommen (Rechnung offen) | aktiv | abgelehnt | zurueckgezogen
    invoice_id      INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    membership_id   INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
    decided_by_name TEXT,
    decision_note   TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at      TEXT,
    activated_at    TEXT
  );

  -- Namensänderung: Antrag im Profil, Entscheidung durch das Board of Partners
  CREATE TABLE IF NOT EXISTS name_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_name        TEXT NOT NULL,
    new_name        TEXT NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'offen',   -- offen | genehmigt | abgelehnt | zurueckgezogen
    decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_by_name TEXT,
    decision_note   TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at      TEXT
  );
`);
// Namensänderung ohne Antrag (Board of Partners: eigener Name oder Korrektur bei Mandanten)
addColumn('name_requests', 'direct', 'INTEGER NOT NULL DEFAULT 0');
// Rechnung: angewandte Mitgliedschaft (VIP/Perma) und Rechnungsempfänger-Konto (z. B. Rechnung für die Mitgliedschaft selbst)
addColumn('invoices', 'membership_id', 'INTEGER REFERENCES memberships(id) ON DELETE SET NULL');
addColumn('invoices', 'member_name', "TEXT NOT NULL DEFAULT ''");
addColumn('invoices', 'member_pct', 'REAL NOT NULL DEFAULT 0');
addColumn('invoices', 'member_amount', 'INTEGER NOT NULL DEFAULT 0');
addColumn('invoices', 'client_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
// Login-E-Mail: alle Konten auf @pake-scha.ls; die vorherige Adresse bleibt als Login-Alias gültig
addColumn('users', 'old_email', 'TEXT');
addColumn('users', 'email_notice', 'INTEGER NOT NULL DEFAULT 0'); // 1 = Hinweis „Ihre E-Mail wurde umgestellt“ zeigen
db.exec('CREATE INDEX IF NOT EXISTS idx_users_old_email ON users(old_email)');
// Ticket per /delete gelöscht → nicht automatisch neu anlegen (nur über „Ticket anlegen“ im Dashboard)
for (const table of ['cases', 'applications', 'concerns']) addColumn(table, 'discord_deleted', 'INTEGER NOT NULL DEFAULT 0');
// Reihenfolge in der Akte (per Ziehen festgelegt); NULL = noch nicht einsortiert, erscheint oben.
addColumn('case_external_docs', 'sort_order', 'INTEGER');
addColumn('case_attachments', 'external_doc_id', 'INTEGER REFERENCES case_external_docs(id) ON DELETE SET NULL');
addColumn('case_attachments', 'source_url', 'TEXT');
addColumn('case_attachments', 'content_hash', 'TEXT');
// Anliegen ans Board: Vorgangsnummer + Pin (Statusabfrage auf der Website), Kontakt, Herkunft
addColumn('concerns', 'reference', 'TEXT');
addColumn('concerns', 'access_pin', 'TEXT');
addColumn('concerns', 'contact', "TEXT NOT NULL DEFAULT ''");
addColumn('concerns', 'source', "TEXT NOT NULL DEFAULT 'dashboard'"); // dashboard | web

// Kooperationen (z. B. mit einem Unternehmen): Rabatt auf Rechnungen für dessen Mitglieder – erkannt über
// Discord-Rollen (Bot liest die Rollen des Mandanten) oder von Hand zugeordnete Mandantenkonten.
db.exec(`
  CREATE TABLE IF NOT EXISTS cooperations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',          -- intern: Vereinbarung, Ansprechpartner …
    discount_pct  REAL NOT NULL DEFAULT 0,
    guild_id      TEXT NOT NULL DEFAULT '',          -- leer = Discord-Server der Kanzlei
    role_ids      TEXT NOT NULL DEFAULT '',          -- Discord-Rollen (kommagetrennt)
    valid_until   TEXT,                              -- YYYY-MM-DD (einschließlich), optional
    active        INTEGER NOT NULL DEFAULT 1,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cooperation_members (
    cooperation_id INTEGER NOT NULL REFERENCES cooperations(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by_name  TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (cooperation_id, user_id)
  );
`);
// Rechnung: angewandter Kooperationsrabatt (Name und Satz werden festgehalten, falls die Kooperation sich ändert)
addColumn('invoices', 'cooperation_id', 'INTEGER REFERENCES cooperations(id) ON DELETE SET NULL');
addColumn('invoices', 'coop_name', "TEXT NOT NULL DEFAULT ''");
addColumn('invoices', 'coop_pct', 'REAL NOT NULL DEFAULT 0');
addColumn('invoices', 'coop_amount', 'INTEGER NOT NULL DEFAULT 0');
addColumn('invoices', 'coop_via', "TEXT NOT NULL DEFAULT ''"); // discord | konto | manuell
// Zahlungserinnerungen (paymentReminders.js): zuletzt erinnert, Anzahl der Erinnerungen
addColumn('invoices', 'reminded_at', 'TEXT');
addColumn('invoices', 'reminder_count', 'INTEGER NOT NULL DEFAULT 0');

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
  CREATE INDEX IF NOT EXISTS idx_contract_lawyers ON case_contract_lawyers(contract_id);
  CREATE INDEX IF NOT EXISTS idx_contract_lawyers_user ON case_contract_lawyers(user_id);
  CREATE INDEX IF NOT EXISTS idx_absences_dates ON absences(end_date, start_date);
  CREATE INDEX IF NOT EXISTS idx_concerns_status ON concerns(status, updated_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_concerns_reference ON concerns(reference);
  CREATE INDEX IF NOT EXISTS idx_concerns_author ON concerns(author_id);
  CREATE INDEX IF NOT EXISTS idx_concern_messages ON concern_messages(concern_id);
  CREATE INDEX IF NOT EXISTS idx_personnel_created ON personnel_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_case_work_case ON case_work(case_id, ended_at);
  CREATE INDEX IF NOT EXISTS idx_case_work_user ON case_work(user_id);
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

// Papierkorb für Akten (siehe trash.js): gelöschte Akten liegen hier 30 Tage als Momentaufnahme.
db.exec(`
  CREATE TABLE IF NOT EXISTS case_trash (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id         INTEGER NOT NULL,
    case_number     TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    client_name     TEXT NOT NULL DEFAULT '',
    deleted_by      INTEGER,
    deleted_by_name TEXT NOT NULL DEFAULT '',
    deleted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    payload         TEXT NOT NULL,                     -- JSON: Zeilen der Akte und aller abhängigen Tabellen
    files           TEXT NOT NULL DEFAULT '[]'         -- JSON: Bilddateien der Anhänge (bleiben bis zum endgültigen Löschen)
  );
  CREATE INDEX IF NOT EXISTS idx_case_trash_number ON case_trash(case_number);
`);

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
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// Einmalig: offene Akten mit „Eilig“/„Notfall“ bekommen die passende Start-Priorität (Hoch/Kritisch) –
// nur wo noch „Normal“ steht und niemand die Priorität bisher von Hand geändert hat.
if (!getSetting('migrated_priority_from_urgency')) {
  const n = db
    .prepare(
      `UPDATE cases SET priority = CASE urgency WHEN 'notfall' THEN 4 ELSE 3 END
       WHERE status != 'geschlossen' AND priority = 2 AND urgency IN ('eilig', 'notfall')
         AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.case_id = cases.id AND n.system = 1 AND n.body LIKE 'Priorität:%')`
    )
    .run().changes;
  setSetting('migrated_priority_from_urgency', new Date().toISOString());
  if (n) console.log(`Priorität aus der Dringlichkeit übernommen: ${n} Akte(n).`);
}

// Ältere Anliegen (vor Einführung der Vorgangsnummer) nachträglich nummerieren.
for (const row of db.prepare('SELECT id FROM concerns WHERE reference IS NULL ORDER BY id').all()) {
  db.prepare('UPDATE concerns SET reference = ?, access_pin = ? WHERE id = ?').run(nextConcernNumber(), randomPin(), row.id);
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
};
