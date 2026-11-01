'use strict';
/* Ränge, Website-Texte, Einarbeitung, persönliche Einstellungen, Termin-Einladungen */

module.exports = function up({ db, addColumn }) {
  /* Ränge (vom Board in den Einstellungen gepflegt) – Inhalt der Rang-Karten auf der Startseite */
  db.exec(`
    CREATE TABLE IF NOT EXISTS ranks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      level       TEXT NOT NULL DEFAULT 'associate' CHECK (level IN ('board','associate')),
      badge       TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      footer      TEXT NOT NULL DEFAULT '',
      sort        INTEGER NOT NULL DEFAULT 0
    );
  `);
  /* Website-Texte, die das Board direkt auf der Seite geändert hat (Schlüssel = Fingerabdruck des Originaltexts) */
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_texts (
      page        TEXT NOT NULL,
      key         TEXT NOT NULL,
      original    TEXT NOT NULL DEFAULT '',
      text        TEXT NOT NULL,
      updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (page, key)
    );
  `);
  /* Einarbeitung neuer Anwälte: Checkliste je Person, Mentor aus dem Board */
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mentor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      done_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS onboarding_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      sort        INTEGER NOT NULL DEFAULT 0,
      done_at     TEXT,
      done_by     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_items_user ON onboarding_items(user_id);
  `);
  addColumn('appointments', 'client_reminded', 'INTEGER NOT NULL DEFAULT 0');

  // Persönliche Einstellungen (Reihenfolge der Abschnitte einer Akte …) und Standardreihenfolge je Rechtsgebiet (vom Board)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS case_section_defaults (
      area       TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Einladungen von Kollegen zu einem Termin/Gespräch (Zusage/Absage je Person)
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_invites (
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status         TEXT NOT NULL DEFAULT 'offen',        -- offen | zugesagt | abgesagt
      invited_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at   TEXT,
      PRIMARY KEY (appointment_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_appt_invites_user ON appointment_invites(user_id, status);
  `);
};
