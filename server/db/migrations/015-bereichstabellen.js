'use strict';
/* Tabellen der Bereiche: Website-Konfiguration, Rechtsgebiete, Gebühren/Rechnungsarten, Termin- und Fristenarten,
   Präzedenzfälle, Dauermandate, Rabatt-Freigaben, 360°-Feedback (vorher beim Laden des jeweiligen Moduls angelegt) */

module.exports = function up({ db, addColumn }) {
  // web/siteConfig.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_config (
      key          TEXT PRIMARY KEY,
      published    TEXT,
      draft        TEXT,
      updated_by   INTEGER,
      updated_at   TEXT,
      published_at TEXT
    );
  `);

  // domain/areas.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      key          TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      short        TEXT NOT NULL DEFAULT '',
      color        TEXT NOT NULL DEFAULT 'gold',
      icon         TEXT NOT NULL DEFAULT 'scale',
      intake_title TEXT NOT NULL DEFAULT '',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      active       INTEGER NOT NULL DEFAULT 1,
      steps        TEXT NOT NULL DEFAULT '[]',
      checklist    TEXT NOT NULL DEFAULT '[]',
      outcomes     TEXT NOT NULL DEFAULT '[]',
      fields       TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // domain/billing.js

  db.exec(`
    CREATE TABLE IF NOT EXISTS fee_categories (
      key        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS invoice_types (
      key            TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      base           TEXT NOT NULL DEFAULT 'rechnung',   -- rechnung | honorarvereinbarung
      due_days       INTEGER NOT NULL DEFAULT 7,         -- Zahlungsziel in Tagen (0 = kein Datum)
      advance_pct    INTEGER NOT NULL DEFAULT 0,         -- Vorschuss in % vor Beginn der Tätigkeit
      expense_label  TEXT NOT NULL DEFAULT '',           -- Auslagenpauschale: Bezeichnung der Position
      expense_amount INTEGER NOT NULL DEFAULT 0,         -- … und Betrag (0 = keine)
      note           TEXT NOT NULL DEFAULT '',           -- Standardtext (Anmerkungen / Vereinbarungstext)
      sort_order     INTEGER NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1
    );
  `);
  for (const [table, ddl] of [
    ['invoices', 'type_key TEXT'],
    ['areas', "default_fees TEXT NOT NULL DEFAULT '[]'"],
    ['areas', "default_type TEXT NOT NULL DEFAULT ''"],
  ]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch {
      /* Spalte ist schon da */
    }
  }

  // domain/eventKinds.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_kinds (
      key             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      base            TEXT NOT NULL DEFAULT 'frist',
      default_minutes INTEGER NOT NULL DEFAULT 0,
      default_location TEXT NOT NULL DEFAULT '',
      client_visible  INTEGER NOT NULL DEFAULT -1,   -- -1 = wie die Grundart
      rule_amount     INTEGER NOT NULL DEFAULT 0,    -- 0 = keine Rechenregel
      rule_unit       TEXT NOT NULL DEFAULT 'tage',  -- tage | werktage | wochen | monate
      rule_from       TEXT NOT NULL DEFAULT '',      -- „Zustellung“, „Verkündung“ …
      weekend_shift   INTEGER NOT NULL DEFAULT 1,    -- Fristende am Wochenende → nächster Werktag (§ 193 BGB)
      sort_order      INTEGER NOT NULL DEFAULT 0,
      active          INTEGER NOT NULL DEFAULT 1
    );
  `);
  addColumn('appointments', 'kind', 'TEXT');

  // domain/precedents.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS precedents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id       INTEGER UNIQUE REFERENCES cases(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      area          TEXT NOT NULL DEFAULT '',
      summary       TEXT NOT NULL DEFAULT '',
      arguments     TEXT NOT NULL DEFAULT '',
      result        TEXT NOT NULL DEFAULT '',
      lessons       TEXT NOT NULL DEFAULT '',
      outcome       TEXT NOT NULL DEFAULT '',
      sentence_he   INTEGER,
      sentence_fine INTEGER,
      paragraphs    TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '',
      created_by    TEXT NOT NULL DEFAULT '',
      created_by_id INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_precedents_area ON precedents(area);
  `);

  // domain/retainers.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS retainers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      client_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      client_name     TEXT NOT NULL,
      client_contact  TEXT NOT NULL DEFAULT '',
      case_id         INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      amount          INTEGER NOT NULL,
      interval_months INTEGER NOT NULL DEFAULT 1,
      start_date      TEXT NOT NULL,
      end_date        TEXT,
      runs            INTEGER NOT NULL DEFAULT 0,
      type_key        TEXT NOT NULL DEFAULT 'rechnung',
      note            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','pausiert','beendet')),
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_invoice_id INTEGER
    );
  `);
  addColumn('invoices', 'retainer_id', 'INTEGER');

  // domain/discountApprovals.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS discount_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      status            TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','genehmigt','abgelehnt','verwendet')),
      requested_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      requested_by_name TEXT NOT NULL DEFAULT '',
      discount_pct      REAL NOT NULL,
      subtotal          INTEGER NOT NULL DEFAULT 0,
      case_id           INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      client_name       TEXT NOT NULL DEFAULT '',
      reason            TEXT NOT NULL DEFAULT '',
      decided_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_by_name   TEXT NOT NULL DEFAULT '',
      decided_at        TEXT,
      decided_via       TEXT NOT NULL DEFAULT '',
      decision_note     TEXT NOT NULL DEFAULT '',
      invoice_id        INTEGER,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // domain/feedback360.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_rounds (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','geschlossen','veroeffentlicht')),
      due_date   TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS feedback_participants (
      round_id INTEGER NOT NULL REFERENCES feedback_rounds(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (round_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS feedback_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id      INTEGER NOT NULL REFERENCES feedback_rounds(id) ON DELETE CASCADE,
      about_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      r_team        INTEGER, r_reliable INTEGER, r_know INTEGER, r_comm INTEGER,
      strengths     TEXT NOT NULL DEFAULT '',
      improve       TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (round_id, about_user_id, from_user_id)
    );
  `);
};
