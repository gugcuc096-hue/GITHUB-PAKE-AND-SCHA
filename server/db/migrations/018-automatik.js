'use strict';
/* Automatik-Regeln („Wenn … dann …“) und welche Regel bei welcher Akte schon gelaufen ist */

module.exports = function up({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      trigger     TEXT NOT NULL,
      conditions  TEXT NOT NULL DEFAULT '{}',
      action      TEXT NOT NULL,
      params      TEXT NOT NULL DEFAULT '{}',
      runs        INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS automation_done (
      rule_id  INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mark     TEXT NOT NULL DEFAULT '',
      at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (rule_id, case_id, mark)
    );
  `);
};
