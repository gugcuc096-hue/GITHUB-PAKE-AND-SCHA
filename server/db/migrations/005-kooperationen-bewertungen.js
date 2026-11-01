'use strict';
/* Kooperationen, Mandantenstimmen, Schriftsätze, Zahlungserinnerungen */

module.exports = function up({ db, addColumn }) {
   // dashboard | web

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
  // Mandantenstimmen: Bewertungen abgeschlossener Akten durch den Mandanten; auf der Website erst nach Freigabe durch das Board
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id         INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body            TEXT NOT NULL,
      name_mode       TEXT NOT NULL DEFAULT 'initialen' CHECK (name_mode IN ('voll','initialen','anonym')),
      author_name     TEXT NOT NULL DEFAULT '',        -- Name zum Zeitpunkt der Bewertung
      area            TEXT NOT NULL DEFAULT '',        -- Rechtsgebiet der Akte (für die Anzeige)
      status          TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','freigegeben','abgelehnt')),
      decided_by_name TEXT NOT NULL DEFAULT '',
      decided_at      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_case ON reviews(case_id) WHERE case_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
  `);
  // Schriftsätze: Vorlagen und Dokumente der Art „schriftsatz“ (sonst „vertrag“); interne Schriftsätze sieht der Mandant nicht
  addColumn('contract_templates', 'kind', "TEXT NOT NULL DEFAULT 'vertrag'");
  addColumn('case_contracts', 'kind', "TEXT NOT NULL DEFAULT 'vertrag'");
  addColumn('case_contracts', 'internal', 'INTEGER NOT NULL DEFAULT 0');
  // Zahlungserinnerungen (paymentReminders.js): zuletzt erinnert, Anzahl der Erinnerungen
  addColumn('invoices', 'reminded_at', 'TEXT');
  addColumn('invoices', 'reminder_count', 'INTEGER NOT NULL DEFAULT 0');
};
