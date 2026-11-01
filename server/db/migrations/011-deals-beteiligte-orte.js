'use strict';
/* Deal-Rechner, Ticket-Verlauf, Strafmaß, Mandantenprofil, Beteiligte, Widersprüche, Tatort-Karte */

module.exports = function up({ db, addColumn }) {
  // Deal-Rechner: Angebote der Staatsanwaltschaft und die Antwort des Mandanten
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_deals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      offer_he        INTEGER,
      offer_fine      INTEGER,
      note            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'offen',
      answered_at     TEXT,
      answered_via    TEXT,
      created_by      INTEGER,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Gesicherter Verlauf gelöschter Akten-Tickets (nur Kanzlei)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_transcripts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      channel_name  TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      html          TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Strafmaß der Akte: Einschätzung der Kanzlei und verminderte Schuldfähigkeit (§ 8)
  addColumn('cases', 'sentence_estimate', 'INTEGER');
  addColumn('cases', 'sentence_fine', 'INTEGER');
  addColumn('cases', 'sentence_reduced', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('cases', 'intake_answers', 'TEXT'); // Antworten auf die Zusatzfelder des Rechtsgebiets (JSON: { key: { label, value } })
  // Tatsächliches Strafmaß beim Abschluss (Vergleich mit der Einschätzung der Kanzlei, nur intern)
  addColumn('cases', 'sentence_actual_he', 'INTEGER');
  addColumn('cases', 'sentence_actual_fine', 'INTEGER');
  // Mandantenkartei: Stammdaten je Mandant (Schlüssel wie bei Notizen) – Geburtsdatum (IC) aus dem letzten Vertrag
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_profiles (
      client_key      TEXT PRIMARY KEY,
      birth           TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Beteiligte einer Akte (Gegenpartei, Zeugen, Gericht …) – mit Kontakt; die Kanzlei sieht Überschneidungen mit anderen Akten
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_parties (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'sonstige',
      name       TEXT NOT NULL,
      contact    TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_parties_case ON case_parties(case_id);
  `);
  // Zeugenverwaltung: Lager, Stand, Ladung, erwartete und tatsächliche Aussage; dazu Vorhalte (Widersprüche)
  addColumn('case_parties', 'side', "TEXT NOT NULL DEFAULT ''"); // belastend | entlastend | neutral
  addColumn('case_parties', 'status', "TEXT NOT NULL DEFAULT 'offen'");
  addColumn('case_parties', 'summon_at', 'TEXT');
  addColumn('case_parties', 'expected', "TEXT NOT NULL DEFAULT ''");
  addColumn('case_parties', 'statement', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS party_contradictions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id   INTEGER NOT NULL REFERENCES case_parties(id) ON DELETE CASCADE,
      case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      ref        TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_party_contradictions_case ON party_contradictions(case_id);
  `);

  // Tatort-Karte: Orte einer Akte (Tatort, Festnahme, Fundort …) mit Postleitzahl und Position auf der FiveM-Karte (nur Kanzlei)
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_places (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      postal      TEXT NOT NULL,
      x           REAL NOT NULL,
      y           REAL NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'tatort',
      label       TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT '',
      happened_at TEXT,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_places_case ON case_places(case_id);
  `);
  // Blickrichtung (Grad, 0 = Norden, 90 = Osten), Sichtweite (m) und Sichtfeld (Grad) – für die Sichtlinien der Tatort-Karte
  addColumn('case_places', 'look_dir', 'INTEGER');
  addColumn('case_places', 'look_range', 'INTEGER NOT NULL DEFAULT 80');
  addColumn('case_places', 'look_fov', 'INTEGER NOT NULL DEFAULT 70');
};
