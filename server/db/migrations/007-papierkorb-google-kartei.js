'use strict';
/* Papierkorb, Google Docs, Mandantenkartei */

module.exports = function up({ db }) {
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

  // Google Docs der Kanzlei (siehe googleDocs.js): je Rechnung, Vertrag/Schriftsatz bzw. Aktenauszug ein Doc mit
  // festem Link. Bewusst ohne Fremdschlüssel – Einträge überstehen Papierkorb und Wiederherstellen der Akte.
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_docs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT NOT NULL CHECK (kind IN ('invoice', 'contract', 'extract')),
      ref_id          INTEGER NOT NULL,                  -- Rechnung, Vertrag bzw. Akte (Aktenauszug)
      case_id         INTEGER,
      file_id         TEXT NOT NULL,
      url             TEXT NOT NULL,
      options         TEXT NOT NULL DEFAULT '{}',        -- Aktenauszug: gewählte Abschnitte
      created_by      INTEGER,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at       TEXT,
      dirty           INTEGER NOT NULL DEFAULT 0,        -- 1 = muss neu geschrieben werden
      sync_error      TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_google_docs_ref ON google_docs(kind, ref_id);
    CREATE INDEX IF NOT EXISTS idx_google_docs_case ON google_docs(case_id);
    -- Freigabe eines Dokuments bewusst beendet („Freigabe beenden“): der Server legt dafür kein Google Doc mehr
    -- automatisch an, bis jemand es selbst wieder anlegt (googleDocs.js)
    CREATE TABLE IF NOT EXISTS google_docs_optout (
      kind       TEXT NOT NULL,
      ref_id     INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, ref_id)
    );
  `);

  // Mandantenkartei (routes/clients.js): interne Notizen und Vermerk je Mandant – Schlüssel „u<Konto-ID>“ oder „n:<name>“
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_key  TEXT NOT NULL,
      body        TEXT NOT NULL,
      author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_client_notes_key ON client_notes(client_key);
    CREATE TABLE IF NOT EXISTS client_flags (
      client_key  TEXT PRIMARY KEY,
      flag        TEXT NOT NULL CHECK (flag IN ('vorkasse','sperre')),
      reason      TEXT NOT NULL DEFAULT '',
      set_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      set_by_name TEXT NOT NULL DEFAULT '',
      set_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};
