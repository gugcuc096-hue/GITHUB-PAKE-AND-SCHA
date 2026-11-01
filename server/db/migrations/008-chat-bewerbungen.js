'use strict';
/* Akten-Chat (Lesestand), Discord-Übernahme, Zahlung melden, Bewerbungs-Chat */

module.exports = function up({ db, crypto, tableExists, addColumn, setSetting }) {
  /*
   * Nachrichten in der Akte (Chat Kanzlei ↔ Mandant): das sind die für den Mandanten sichtbaren Einträge in notes
   * (internal = 0, system = 0). Hier steht nur, bis wohin jemand gelesen hat (für „neu“-Hinweise und „gelesen“).
   */
  const hadChatReads = tableExists('case_chat_reads');
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_chat_reads (
      case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_id  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (case_id, user_id)
    );
  `);

  // Nachrichten aus dem Discord-Ticket (Übernahme in den Chat der Akte): Discord-Nachrichten-ID gegen Doppelte
  addColumn('notes', 'discord_message_id', 'TEXT');
  addColumn('notes', 'pinned', 'INTEGER NOT NULL DEFAULT 0'); // interne Notiz oben in der Akte angepinnt
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_discord_msg ON notes(discord_message_id) WHERE discord_message_id IS NOT NULL');

  // Konto per Discord angelegt: Name im Spiel (IC) wird beim ersten Login einmal abgefragt
  addColumn('users', 'needs_name', 'INTEGER NOT NULL DEFAULT 0');

  // Rechnung: Mandant meldet die Zahlung (mit Notiz und optional Screenshot), die Kanzlei bestätigt
  addColumn('invoices', 'payment_reported_at', 'TEXT');
  addColumn('invoices', 'payment_note', "TEXT NOT NULL DEFAULT ''");
  addColumn('invoices', 'payment_proof', "TEXT NOT NULL DEFAULT ''");
  addColumn('invoices', 'payment_reported_by', 'INTEGER');

  /*
   * Bewerbungen: Nachrichten zwischen Board und Bewerber (Bewerberseite mit persönlichem Link statt Statusabfrage).
   * access_token: geheimer Link /bewerbung#<token> · discord_user_id: per Discord-Anmeldung verbunden (Antworten
   * kommen dann als Discord-Direktnachricht) · *_read_id: bis wohin Bewerber bzw. Board gelesen haben.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      from_board     INTEGER NOT NULL DEFAULT 0,
      author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name    TEXT NOT NULL DEFAULT '',
      body           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_application_messages ON application_messages(application_id, id);
  `);
  addColumn('applications', 'access_token', "TEXT NOT NULL DEFAULT ''");
  addColumn('applications', 'discord_user_id', "TEXT NOT NULL DEFAULT ''");
  addColumn('applications', 'applicant_read_id', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('applications', 'board_read_id', 'INTEGER NOT NULL DEFAULT 0');
  for (const row of db.prepare("SELECT id FROM applications WHERE access_token = ''").all()) {
    db.prepare('UPDATE applications SET access_token = ? WHERE id = ?').run(crypto.randomBytes(24).toString('base64url'), row.id);
  }

  // Akten-Chat neu: Bisherige Nachrichten gelten als gelesen (sonst wären beim ersten Start alle „neu“).
  if (!hadChatReads) setSetting('chat_read_floor', db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM notes').get().m);
};
