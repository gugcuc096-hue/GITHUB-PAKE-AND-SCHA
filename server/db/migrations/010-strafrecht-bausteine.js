'use strict';
/* Strafgesetzbuch, Anklagepunkte, Textbausteine, Vorschaubilder, Terminvorschläge */

module.exports = function up({ db, addColumn }) {
  /* ---------------------------------------------------------------- Strafgesetzbuch & Strafmaß-Rechner (penal.js) */
  db.exec(`
    -- Gesetzestext je Paragraph (aus dem StGB des Staates San Andreas; das Board kann ihn anpassen)
    CREATE TABLE IF NOT EXISTS penal_laws (
      para          TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      chapter       TEXT NOT NULL DEFAULT '',
      chapter_title TEXT NOT NULL DEFAULT '',
      text          TEXT NOT NULL DEFAULT '',
      updated_at    TEXT
    );
    -- Strafkatalog: je Tatbestand (Paragraph bzw. Absatz) der Strafrahmen in Hafteinheiten (HE) und die Geldstrafe
    CREATE TABLE IF NOT EXISTS penal_offences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      para       TEXT NOT NULL,
      paragraph  TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL,
      min_he     INTEGER NOT NULL DEFAULT 0,
      max_he     INTEGER,                       -- NULL = ohne Obergrenze („nicht unter …“)
      fine_mode  TEXT NOT NULL DEFAULT 'none',  -- none: nur Freiheitsstrafe · alt: oder Geldstrafe · only: nur Geldstrafe
      fine_max   INTEGER,                       -- NULL = 3.000 $ je Hafteinheit (§ 13 Abs. 2)
      attempt    INTEGER NOT NULL DEFAULT 0,    -- Versuch strafbar
      severe     INTEGER NOT NULL DEFAULT 0,    -- besonders schwerer Fall nach § 3 Abs. 2 (Gesamtstrafe bis 180 HE)
      note       TEXT NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    -- Anklagepunkte einer Akte: Stand des Katalogs beim Hinzufügen (spätere Änderungen am Katalog ändern alte Akten nicht)
    CREATE TABLE IF NOT EXISTS case_charges (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      offence_id INTEGER REFERENCES penal_offences(id) ON DELETE SET NULL,
      para       TEXT NOT NULL,
      paragraph  TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL,
      min_he     INTEGER NOT NULL DEFAULT 0,
      max_he     INTEGER,
      fine_mode  TEXT NOT NULL DEFAULT 'none',
      fine_max   INTEGER,
      attempt    INTEGER NOT NULL DEFAULT 0,
      severe     INTEGER NOT NULL DEFAULT 0,
      count      INTEGER NOT NULL DEFAULT 1,
      attempted  INTEGER NOT NULL DEFAULT 0,    -- nur versucht (§ 9 Abs. 2: kann milder bestraft werden)
      aiding     INTEGER NOT NULL DEFAULT 0,    -- Beihilfe (§ 10 Abs. 4: kann gemildert werden)
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_charges_case ON case_charges(case_id);

    -- Kanzlei-Wiki: Abläufe, Wissen, Musterargumente (Board schreibt, das Team liest)
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT 'Allgemein',
      body       TEXT NOT NULL DEFAULT '',
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Board-Beschlüsse: Antrag, Abstimmung (ja / nein / Enthaltung), Ergebnis im Beschlussprotokoll
    CREATE TABLE IF NOT EXISTS resolutions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      reference       TEXT UNIQUE,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'offen',   -- offen · angenommen · abgelehnt · zurueckgezogen
      deadline        TEXT,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at      TEXT,
      tally           TEXT NOT NULL DEFAULT ''          -- Stimmen beim Abschluss (für das Protokoll)
    );
    CREATE TABLE IF NOT EXISTS resolution_votes (
      resolution_id INTEGER NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote          TEXT NOT NULL CHECK (vote IN ('ja', 'nein', 'enthaltung')),
      comment       TEXT NOT NULL DEFAULT '',
      voted_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (resolution_id, user_id)
    );
  `);
  // Textbausteine für Akten-Chat und Notizen: „/befehl“ fügt den Text ein, {{platzhalter}} werden aus der Akte gefüllt
  db.exec(`
    CREATE TABLE IF NOT EXISTS text_snippets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      command         TEXT NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Vorschaubild (WebP, im Browser verkleinert) je Beweismittel – Raster laden schneller, das Original erst beim Öffnen
  addColumn('case_attachments', 'thumb', 'TEXT');
  // Lesebestätigung mit Uhrzeit, einmalige Erinnerung an ungelesene Nachrichten, Zusage des Mandanten zu Terminen
  addColumn('case_chat_reads', 'read_at', 'TEXT');
  addColumn('cases', 'chat_nudged_id', 'INTEGER');
  addColumn('appointments', 'client_response', 'TEXT');
  // Terminvorschlag: bis zu drei Zeiten (JSON, aufsteigend) – der Mandant wählt eine, der Termin ist dann bestätigt
  addColumn('appointments', 'slots', 'TEXT');
  addColumn('appointments', 'client_response_at', 'TEXT');
};
