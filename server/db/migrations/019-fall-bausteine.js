'use strict';
/* Fall-Bausteine je Rechtsgebiet (Zivil, Verfassung, Vertrag): Angaben der Akte als JSON und Einträge (Ansprüche, Klauseln, Normen …) */

module.exports = function up({ db }) {
  db.exec(`
    -- Einzelangaben je Akte (Streitwert, angegriffener Akt, Verfahrensart, Zulässigkeit, Vertragsmodus, Laufzeit …)
    CREATE TABLE IF NOT EXISTS case_fall (
      case_id    INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Einträge je Akte: kind = claim | motion | corr | norm | participant | party | clause | version
    CREATE TABLE IF NOT EXISTS case_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      no         INTEGER NOT NULL DEFAULT 0,       -- laufende Nummer je Art (z. B. Entwurfsversion v3)
      data       TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_items_case ON case_items(case_id, kind);
  `);
};
