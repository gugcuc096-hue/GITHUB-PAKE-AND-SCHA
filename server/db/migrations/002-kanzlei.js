'use strict';
/* Kanzlei: Rechnungen, Dienst, Bewerbungen, Anhänge, Protokoll, Aufgaben, Anliegen, Personal, Verträge, Discord-Bot */

module.exports = function up({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      number           TEXT NOT NULL UNIQUE,
      kind             TEXT NOT NULL DEFAULT 'rechnung' CHECK (kind IN ('rechnung','honorarvereinbarung')),
      case_id          INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      client_name      TEXT NOT NULL,
      client_contact   TEXT NOT NULL DEFAULT '',
      subject          TEXT NOT NULL DEFAULT '',
      items_json       TEXT NOT NULL DEFAULT '[]',
      subtotal         INTEGER NOT NULL DEFAULT 0,
      discount_pct     REAL NOT NULL DEFAULT 0,
      discount_amount  INTEGER NOT NULL DEFAULT 0,
      surcharge_pct    REAL NOT NULL DEFAULT 0,
      surcharge_amount INTEGER NOT NULL DEFAULT 0,
      total            INTEGER NOT NULL DEFAULT 0,
      notes            TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','bezahlt','storniert')),
      due_date         TEXT,
      issued_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      issuer_name      TEXT NOT NULL DEFAULT '',
      issuer_rank      TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at          TEXT
    );

    -- Stempeluhr: eine Zeile pro Dienstschicht (ended_at NULL = läuft noch).
    CREATE TABLE IF NOT EXISTS duty_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at  TEXT NOT NULL,
      ended_at    TEXT,
      note        TEXT NOT NULL DEFAULT '',
      auto_closed INTEGER NOT NULL DEFAULT 0
    );

    -- Bewerbungssystem
    CREATE TABLE IF NOT EXISTS positions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      requirements TEXT NOT NULL DEFAULT '',
      active       INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      number         TEXT NOT NULL UNIQUE,
      access_code    TEXT NOT NULL,
      position_id    INTEGER REFERENCES positions(id) ON DELETE SET NULL,
      position_title TEXT NOT NULL,
      name           TEXT NOT NULL,
      age            INTEGER,
      phone          TEXT NOT NULL DEFAULT '',
      email          TEXT NOT NULL DEFAULT '',
      discord        TEXT NOT NULL DEFAULT '',
      experience     TEXT NOT NULL DEFAULT '',
      motivation     TEXT NOT NULL,
      availability   TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'eingegangen' CHECK (status IN ('eingegangen','in_pruefung','gespraech','angenommen','abgelehnt')),
      rating         INTEGER NOT NULL DEFAULT 0,
      public_note    TEXT NOT NULL DEFAULT '',
      interview_at   TEXT,
      hired_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS application_notes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name    TEXT NOT NULL,
      body           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Beweismittel / Bildanhänge zu Akten (Dateien in uploads/evidence)
    CREATE TABLE IF NOT EXISTS case_attachments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      file          TEXT NOT NULL,
      mime          TEXT NOT NULL,
      size          INTEGER NOT NULL,
      caption       TEXT NOT NULL DEFAULT '',
      internal      INTEGER NOT NULL DEFAULT 0,
      uploader_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Aktivitätsprotokoll für das Board of Partners
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name  TEXT NOT NULL DEFAULT 'System',
      action     TEXT NOT NULL,
      entity     TEXT NOT NULL DEFAULT '',
      entity_id  INTEGER,
      details    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Externe Dokumente (derzeit FiveNet) als Referenz an einer Akte. Der Inhalt
    -- bleibt in FiveNet; gespeichert werden Adresse, Dokument-ID und die vom
    -- Anwalt erfassten Metadaten. external_id ist TEXT, weil FiveNet int64 nutzt.
    CREATE TABLE IF NOT EXISTS case_external_docs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      provider       TEXT NOT NULL DEFAULT 'fivenet',
      external_id    TEXT NOT NULL,
      original_url   TEXT NOT NULL,
      canonical_url  TEXT NOT NULL,
      host           TEXT NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      doc_type       TEXT NOT NULL DEFAULT '',
      doc_date       TEXT,
      doc_author     TEXT NOT NULL DEFAULT '',
      summary        TEXT NOT NULL DEFAULT '',
      viewed_as      TEXT NOT NULL DEFAULT '',
      internal       INTEGER NOT NULL DEFAULT 1,
      attested       INTEGER NOT NULL DEFAULT 0,
      linked_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      linked_by_name TEXT NOT NULL,
      linked_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT,
      UNIQUE (case_id, provider, external_id)
    );

    -- Aufgaben & Wiedervorlagen (mit oder ohne Aktenbezug, nur für das Team)
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      due_date    TEXT,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      done        INTEGER NOT NULL DEFAULT 0,
      done_at     TEXT,
      done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Weitere Anwälte einer Akte (Mitbearbeitung). Der federführende Anwalt steht in cases.lawyer_id
    -- und ist hier nie zusätzlich eingetragen.
    CREATE TABLE IF NOT EXISTS case_lawyers (
      case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (case_id, user_id)
    );

    -- Bearbeitung von Akten: wer war wann zuständig (automatisch bei Zuweisung, Abgabe, Schließen).
    -- Nur für das Board of Partners auswertbar.
    CREATE TABLE IF NOT EXISTS case_work (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'lead',     -- 'lead' (federführend) | 'co' (weiterer Anwalt)
      started_at TEXT NOT NULL,                    -- ISO-Zeitpunkt
      ended_at   TEXT,
      end_reason TEXT NOT NULL DEFAULT '',
      estimated  INTEGER NOT NULL DEFAULT 0        -- vor Einführung der Erfassung: aus dem Aktenverlauf geschätzt
    );

    -- Anliegen an das Board of Partners (Führungsebene) von Mitarbeitern und Mandanten: Einreichung, Antworten, Status
    CREATE TABLE IF NOT EXISTS concerns (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name       TEXT NOT NULL DEFAULT '',
      author_group      TEXT NOT NULL DEFAULT 'mitarbeiter', -- mitarbeiter | mandant (bleibt auch bei anonymen Anliegen sichtbar)
      anonymous         INTEGER NOT NULL DEFAULT 0,  -- dem Board wird die einreichende Person nicht angezeigt
      category          TEXT NOT NULL DEFAULT 'sonstiges',
      urgency           TEXT NOT NULL DEFAULT 'normal',
      subject           TEXT NOT NULL,
      body              TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'offen', -- offen | in_bearbeitung | erledigt | abgelehnt
      assigned_to       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_seen_at    TEXT,                          -- zuletzt von der einreichenden Person geöffnet
      board_activity_at TEXT,                          -- letzte sichtbare Antwort/Statusänderung des Boards
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at         TEXT
    );
    CREATE TABLE IF NOT EXISTS concern_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concern_id  INTEGER NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
      author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL DEFAULT '',
      from_board  INTEGER NOT NULL DEFAULT 0,
      internal    INTEGER NOT NULL DEFAULT 0,          -- interne Notiz des Boards (für die einreichende Person unsichtbar)
      system      INTEGER NOT NULL DEFAULT 0,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Personalprotokoll: Einstellungen und Beförderungen/Rangänderungen (für alle Mitarbeiter sichtbar)
    CREATE TABLE IF NOT EXISTS personnel_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      person_name TEXT NOT NULL,
      type        TEXT NOT NULL,                       -- einstellung | befoerderung | rueckstufung | rangaenderung
      old_rank    TEXT,
      new_rank    TEXT,
      note        TEXT NOT NULL DEFAULT '',
      by_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      by_name     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Abmeldungen des Teams (Abwesenheit von–bis, Grund); werden auf Wunsch in Discord gemeldet
    CREATE TABLE IF NOT EXISTS absences (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date      TEXT NOT NULL,                -- YYYY-MM-DD
      end_date        TEXT NOT NULL,                -- YYYY-MM-DD (einschließlich)
      reason          TEXT NOT NULL DEFAULT 'sonstiges',
      note            TEXT NOT NULL DEFAULT '',
      returned_at     TEXT,                         -- vorzeitig zurückgemeldet
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Vertragsvorlagen (z. B. Mandatsvertrag), im Dashboard vom Board of Partners pflegbar
    CREATE TABLE IF NOT EXISTS contract_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      key             TEXT UNIQUE,                  -- mitgelieferte Vorlage (zum Zurücksetzen), sonst NULL
      name            TEXT NOT NULL,
      body            TEXT NOT NULL,
      active          INTEGER NOT NULL DEFAULT 1,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Verträge einer Akte: Vorlagentext und ausgefüllte Felder werden beim Erstellen festgehalten
    CREATE TABLE IF NOT EXISTS case_contracts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      template_name     TEXT NOT NULL,
      body              TEXT NOT NULL,
      data              TEXT NOT NULL DEFAULT '{}',
      lawyer_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      lawyer_signature  TEXT,
      lawyer_signed_at  TEXT,
      client_signature  TEXT,
      client_signed_at  TEXT,
      client_signed_via TEXT,                       -- 'portal' (selbst) oder 'kanzlei' (im Spiel unterschrieben, erfasst)
      client_recorded_by_name TEXT NOT NULL DEFAULT '',
      created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name   TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Discord-Bot: bereits begrüßte Beitritte (ein Beitritt = Mitglied + Beitrittszeitpunkt; verhindert doppelte Begrüßung)
    CREATE TABLE IF NOT EXISTS discord_welcomes (
      member_id  TEXT NOT NULL,
      joined_at  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (member_id, joined_at)
    );

    -- Discord-Bot, Join Roles: Warteschlange je Beitritt (Verzögerung / Regel-Bestätigung abwarten; übersteht Neustarts)
    CREATE TABLE IF NOT EXISTS discord_join_roles (
      member_id  TEXT NOT NULL,
      joined_at  TEXT NOT NULL,
      is_bot     INTEGER NOT NULL DEFAULT 0,
      due_at     TEXT NOT NULL,
      checked_at TEXT,
      done_at    TEXT,
      result     TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (member_id, joined_at)
    );
    CREATE INDEX IF NOT EXISTS idx_join_roles_open ON discord_join_roles(done_at, due_at);

    -- Discord-Bot, Nachrichten: eigene Vorlagen (Text + Embed + Link-Buttons)
    CREATE TABLE IF NOT EXISTS bot_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      data            TEXT NOT NULL DEFAULT '{}',
      updated_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Automatik je Vorlage: 'zeitplan' (alle N Minuten ab Startzeit) oder 'nachrichten' (alle N Nachrichten im Kanal)
    CREATE TABLE IF NOT EXISTS bot_message_jobs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id      INTEGER NOT NULL REFERENCES bot_messages(id) ON DELETE CASCADE,
      kind             TEXT NOT NULL CHECK (kind IN ('zeitplan', 'nachrichten')),
      channel_id       TEXT NOT NULL,
      enabled          INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER,
      next_run_at      TEXT,
      every_messages   INTEGER,
      counter          INTEGER NOT NULL DEFAULT 0,
      replace_previous INTEGER NOT NULL DEFAULT 1,
      last_message_id  TEXT,
      last_sent_at     TEXT,
      last_error       TEXT,
      created_by_name  TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_jobs_template ON bot_message_jobs(template_id);
    -- Von Hand gesendete Vorlagen (zum späteren Aktualisieren oder Löschen in Discord)
    CREATE TABLE IF NOT EXISTS bot_message_sent (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id        INTEGER NOT NULL REFERENCES bot_messages(id) ON DELETE CASCADE,
      channel_id         TEXT NOT NULL,
      discord_message_id TEXT NOT NULL,
      sent_by_name       TEXT NOT NULL DEFAULT '',
      sent_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_sent_template ON bot_message_sent(template_id);
    -- Vorlage per Direktnachricht an alle Mitglieder einer Rolle: Fortschritt und Ergebnis je Durchgang
    CREATE TABLE IF NOT EXISTS bot_dm_runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id       INTEGER REFERENCES bot_messages(id) ON DELETE SET NULL,
      template_name     TEXT NOT NULL DEFAULT '',
      role_id           TEXT NOT NULL,
      role_name         TEXT NOT NULL DEFAULT '',
      with_login        INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'läuft',
      total             INTEGER NOT NULL DEFAULT 0,
      sent              INTEGER NOT NULL DEFAULT 0,
      failed            INTEGER NOT NULL DEFAULT 0,
      accounts_created  INTEGER NOT NULL DEFAULT 0,
      accounts_existing INTEGER NOT NULL DEFAULT 0,
      problems          TEXT NOT NULL DEFAULT '[]',
      error             TEXT,
      started_by_name   TEXT NOT NULL DEFAULT '',
      started_at        TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at       TEXT
    );

    -- Weitere unterzeichnende Anwälte eines Vertrags (der erste steht in case_contracts.lawyer_id).
    -- Name und Rang werden beim Eintragen festgehalten, damit der Vertrag später gleich bleibt.
    CREATE TABLE IF NOT EXISTS case_contract_lawyers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES case_contracts(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name        TEXT NOT NULL DEFAULT '',
      rank        TEXT NOT NULL DEFAULT '',
      birth       TEXT NOT NULL DEFAULT '',
      signature   TEXT,
      signed_at   TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
  `);
};
