'use strict';
/* Rabattaktionen, verknüpfte Akten, Kanzlei-Lager */

module.exports = function up({ db, addColumn }) {
  /* ---------------------------------------------------------------- Rabattaktionen (promotions.js) */
  db.exec(`
    -- Aktionen für alle (z. B. Halloween −15 %): gelten im Zeitraum automatisch auf jeder neuen Rechnung
    CREATE TABLE IF NOT EXISTS promotions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      pct         REAL NOT NULL,
      occasion    TEXT NOT NULL DEFAULT '',
      starts_on   TEXT NOT NULL,
      ends_on     TEXT NOT NULL,
      yearly      INTEGER NOT NULL DEFAULT 0,
      announce    INTEGER NOT NULL DEFAULT 1,
      message     TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT
    );
  `);
  addColumn('invoices', 'promo_id', 'INTEGER');
  addColumn('invoices', 'promo_name', "TEXT NOT NULL DEFAULT ''");
  addColumn('invoices', 'promo_pct', 'REAL NOT NULL DEFAULT 0');
  addColumn('invoices', 'promo_amount', 'INTEGER NOT NULL DEFAULT 0');

  // Verknüpfte Akten (z. B. ein Vorfall, mehrere Festgenommene) – je Paar eine Zeile, a_id < b_id
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_links (
      a_id            INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      b_id            INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (a_id, b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_case_links_b ON case_links(b_id);
  `);
  // Kanzlei-Lager: Gegenstände (Name + Bild, in den Einstellungen gepflegt) und Buchungen für Gegenstände, Geld und
  // Schwarzgeld (+ einlagern, − entnehmen; der Bestand ist die Summe)
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      image      TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS storage_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL CHECK (kind IN ('item', 'geld', 'schwarzgeld')),
      item_id    INTEGER REFERENCES storage_items(id) ON DELETE SET NULL,
      item_name  TEXT NOT NULL DEFAULT '',
      amount     INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name  TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_storage_entries_kind ON storage_entries(kind, item_id);
  `);
};
