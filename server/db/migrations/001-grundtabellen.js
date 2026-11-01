'use strict';
/* Grundtabellen: Konten, Sitzungen, Nachrichten, Team, Einstellungen, Akten, Notizen, Termine */
const { CASES_SQL, APPOINTMENTS_SQL, NOTES_SQL } = require('./_kerntabellen');

module.exports = function up({ db, createIfMissing }) {
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

    -- Änderungsprotokoll der Konfiguration: wer hat was wann geändert (mit altem Wert zum Zurücksetzen)
    CREATE TABLE IF NOT EXISTS config_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      user_id   INTEGER,
      user_name TEXT NOT NULL DEFAULT 'System',
      area      TEXT NOT NULL,            -- settings | site_text | permissions | webadmin
      key       TEXT NOT NULL DEFAULT '',
      label     TEXT NOT NULL,
      perm      TEXT NOT NULL DEFAULT '', -- Recht, das zum Zurücksetzen nötig ist
      old_value TEXT,                     -- alter Wert (JSON) – null = es gab keinen
      new_value TEXT,
      revertible INTEGER NOT NULL DEFAULT 0,
      reverted_at TEXT
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
};
