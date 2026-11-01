'use strict';
/* VIP & Mitgliedschaften, Namensänderung, Login-E-Mail, Beweismittel-Nummern, Vorgangsnummer der Anliegen */

module.exports = function up({ db, addColumn }) {
  // VIP & Perma-Mandat: Stufen (Preis, Laufzeit, Rabatt – pflegt das Board of Partners) und vergebene Mitgliedschaften
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_tiers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'vip',     -- vip (auf Zeit) | perma (unbefristet)
      price          INTEGER NOT NULL DEFAULT 0,
      duration_days  INTEGER,                          -- NULL = unbefristet
      discount_pct   REAL NOT NULL DEFAULT 0,
      benefits       TEXT NOT NULL DEFAULT '',
      discord_role_id TEXT NOT NULL DEFAULT '',
      active         INTEGER NOT NULL DEFAULT 1,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS memberships (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier_id         INTEGER REFERENCES membership_tiers(id) ON DELETE SET NULL,
      tier_name       TEXT NOT NULL,                   -- festgehalten, falls die Stufe später geändert wird
      kind            TEXT NOT NULL,
      discount_pct    REAL NOT NULL,
      price_paid      INTEGER NOT NULL DEFAULT 0,      -- Summe inkl. Verlängerungen
      starts_at       TEXT NOT NULL,
      expires_at      TEXT,                            -- NULL = unbefristet (Perma)
      status          TEXT NOT NULL DEFAULT 'aktiv',   -- aktiv | abgelaufen | beendet
      note            TEXT NOT NULL DEFAULT '',
      discord_role_id TEXT NOT NULL DEFAULT '',
      reminded_at     TEXT,
      ended_at        TEXT,
      ended_by_name   TEXT,
      end_reason      TEXT,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);

    -- Anfrage eines Mandanten (Startseite / Portal) → Board nimmt an (Rechnung) → bezahlt → Mitgliedschaft aktiv
    CREATE TABLE IF NOT EXISTS membership_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier_id         INTEGER REFERENCES membership_tiers(id) ON DELETE SET NULL,
      tier_name       TEXT NOT NULL,
      kind            TEXT NOT NULL,
      price           INTEGER NOT NULL,
      duration_days   INTEGER,
      discount_pct    REAL NOT NULL,
      discord_role_id TEXT NOT NULL DEFAULT '',
      message         TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'offen',   -- offen | angenommen (Rechnung offen) | aktiv | abgelehnt | zurueckgezogen
      invoice_id      INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      membership_id   INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
      decided_by_name TEXT,
      decision_note   TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at      TEXT,
      activated_at    TEXT
    );

    -- Namensänderung: Antrag im Profil, Entscheidung durch das Board of Partners
    CREATE TABLE IF NOT EXISTS name_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_name        TEXT NOT NULL,
      new_name        TEXT NOT NULL,
      reason          TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'offen',   -- offen | genehmigt | abgelehnt | zurueckgezogen
      decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_by_name TEXT,
      decision_note   TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at      TEXT
    );
  `);
  // Namensänderung ohne Antrag (Board of Partners: eigener Name oder Korrektur bei Mandanten)
  addColumn('name_requests', 'direct', 'INTEGER NOT NULL DEFAULT 0');
  // Rechnung: angewandte Mitgliedschaft (VIP/Perma) und Rechnungsempfänger-Konto (z. B. Rechnung für die Mitgliedschaft selbst)
  addColumn('invoices', 'membership_id', 'INTEGER REFERENCES memberships(id) ON DELETE SET NULL');
  addColumn('invoices', 'member_name', "TEXT NOT NULL DEFAULT ''");
  addColumn('invoices', 'member_pct', 'REAL NOT NULL DEFAULT 0');
  addColumn('invoices', 'member_amount', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('invoices', 'client_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  // Login-E-Mail: alle Konten auf @pake-scha.ls; die vorherige Adresse bleibt als Login-Alias gültig
  addColumn('users', 'old_email', 'TEXT');
  // Woher kommt das Konto? '' = Registrierung/Board, 'discord-dm' = vom Bot beim Versand an eine Rolle angelegt
  addColumn('users', 'created_via', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'email_notice', 'INTEGER NOT NULL DEFAULT 0'); // 1 = Hinweis „Ihre E-Mail wurde umgestellt“ zeigen
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_old_email ON users(old_email)');
  // Ticket per /delete gelöscht → nicht automatisch neu anlegen (nur über „Ticket anlegen“ im Dashboard)
  for (const table of ['cases', 'applications', 'concerns']) addColumn(table, 'discord_deleted', 'INTEGER NOT NULL DEFAULT 0');
  // Reihenfolge in der Akte (per Ziehen festgelegt); NULL = noch nicht einsortiert, erscheint oben.
  addColumn('case_external_docs', 'sort_order', 'INTEGER');
  addColumn('case_attachments', 'external_doc_id', 'INTEGER REFERENCES case_external_docs(id) ON DELETE SET NULL');
  addColumn('case_attachments', 'source_url', 'TEXT');
  addColumn('case_attachments', 'content_hash', 'TEXT');
  // Beweismittel: feste B-Nummer je Akte (wird nie neu vergeben), Art, Herkunft, Zeitpunkt, Lager, Stand, Beschreibung
  addColumn('case_attachments', 'ev_no', 'INTEGER');
  addColumn('case_attachments', 'kind', "TEXT NOT NULL DEFAULT 'foto'");
  addColumn('case_attachments', 'source', "TEXT NOT NULL DEFAULT ''");
  addColumn('case_attachments', 'obtained_at', 'TEXT');
  addColumn('case_attachments', 'side', "TEXT NOT NULL DEFAULT ''");
  addColumn('case_attachments', 'ev_status', "TEXT NOT NULL DEFAULT 'gesichert'");
  addColumn('case_attachments', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumn('cases', 'evidence_seq', 'INTEGER NOT NULL DEFAULT 0');
  // bisherige Nummern bleiben (Reihenfolge des Hochladens = bisheriges B1, B2 …), neue zählen weiter
  db.exec(`
    UPDATE case_attachments SET ev_no = (
      SELECT COUNT(*) FROM case_attachments o
       WHERE o.case_id = case_attachments.case_id AND (o.created_at < case_attachments.created_at OR (o.created_at = case_attachments.created_at AND o.id <= case_attachments.id))
    ) WHERE ev_no IS NULL;
    UPDATE cases SET evidence_seq = MAX(evidence_seq, COALESCE((SELECT MAX(ev_no) FROM case_attachments WHERE case_id = cases.id), 0));
    CREATE TRIGGER IF NOT EXISTS case_attachments_no AFTER INSERT ON case_attachments WHEN NEW.ev_no IS NULL BEGIN
      UPDATE cases SET evidence_seq = evidence_seq + 1 WHERE id = NEW.case_id;
      UPDATE case_attachments SET ev_no = (SELECT evidence_seq FROM cases WHERE id = NEW.case_id) WHERE id = NEW.id;
    END;
  `);
  // Anliegen ans Board: Vorgangsnummer + Pin (Statusabfrage auf der Website), Kontakt, Herkunft
  addColumn('concerns', 'reference', 'TEXT');
  addColumn('concerns', 'access_pin', 'TEXT');
  addColumn('concerns', 'contact', "TEXT NOT NULL DEFAULT ''");
  addColumn('concerns', 'source', "TEXT NOT NULL DEFAULT 'dashboard'");
};
