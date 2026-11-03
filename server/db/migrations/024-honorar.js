'use strict';
/*
 * Honorarrechner: Leistungen je Rechtsgebiet mit eigenem Preismodell (Festpreis, je Einheit, Prozent/Staffel vom
 * Streitwert, Erfolgshonorar, Grundgebühr + Erfolgsanteil), Spanne, „Was ist enthalten?“ und Zuschlägen; Pakete je
 * Rechtsgebiet; gespeicherte Angebote (Code HON-1234) und die Honorarvereinbarung in der Akte (mit Erfolgshonorar).
 * Rechnung siehe public/js/honorar-calc.js, Ablauf server/domain/honorar.js.
 */
module.exports = function up({ addColumn, createIfMissing }) {
  addColumn('fees', 'areas', "TEXT NOT NULL DEFAULT '[]'"); // Rechtsgebiete (leer = alle)
  addColumn('fees', 'model', "TEXT NOT NULL DEFAULT 'fest'");
  addColumn('fees', 'config', "TEXT NOT NULL DEFAULT '{}'"); // Einstellungen des Preismodells
  addColumn('fees', 'includes', "TEXT NOT NULL DEFAULT ''"); // „Was ist enthalten?“ – je Zeile ein Punkt
  addColumn('fees', 'surcharges', "TEXT NOT NULL DEFAULT '[]'"); // [{ name, pct } | { name, amount }]

  createIfMissing(
    'fee_packages',
    (t) => `CREATE TABLE ${t} (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      area        TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      fee_ids     TEXT NOT NULL DEFAULT '[]',
      price       INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  createIfMissing(
    'fee_offers',
    (t) => `CREATE TABLE ${t} (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL UNIQUE,
      area           TEXT NOT NULL DEFAULT '',
      team_member_id INTEGER,
      selection      TEXT NOT NULL DEFAULT '{}',
      quote          TEXT NOT NULL DEFAULT '{}',
      total_low      INTEGER NOT NULL DEFAULT 0,
      total_high     INTEGER NOT NULL DEFAULT 0,
      case_id        INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  createIfMissing(
    'case_fee_agreements',
    (t) => `CREATE TABLE ${t} (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id            INTEGER NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
      offer_code         TEXT NOT NULL DEFAULT '',
      quote              TEXT NOT NULL DEFAULT '{}',
      created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name    TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      success_value      INTEGER,
      success_amount     INTEGER,
      success_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      settled_at         TEXT
    )`
  );
};
