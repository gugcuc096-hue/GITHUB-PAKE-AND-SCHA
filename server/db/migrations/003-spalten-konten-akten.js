'use strict';
/* Spalten für Konten, Team, Akten (Discord-Ticket, Priorität, Ergebnis), Zwei-Faktor, Board-Tickets */

module.exports = function up({ db, addColumn }) {
  /* ================================================================
     Migrationen für bestehende Datenbanken
     ================================================================ */
  // Neue Spalten lassen sich per ALTER TABLE ergänzen.
  addColumn('users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0'); // Inhaber: bestimmt Web-Admins und Rechte
  addColumn('users', 'web_admin', 'INTEGER NOT NULL DEFAULT 0'); // Web-Admin: pflegt Website, Listen, Vorlagen, Einstellungen
  addColumn('users', 'discord_id', 'TEXT');
  addColumn('users', 'discord_username', 'TEXT');
  addColumn('users', 'discord_avatar', 'TEXT');
  addColumn('users', 'personnel_seen_id', 'INTEGER'); // zuletzt gesehener Eintrag im Personalprotokoll
  addColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('team_members', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  addColumn('team_members', 'visible', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('messages', 'priority', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'sender_deleted', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'recipient_deleted', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'avatar', 'TEXT');
  addColumn('users', 'duty_status', "TEXT NOT NULL DEFAULT 'off'");
  addColumn('users', 'duty_note', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'duty_since', 'TEXT');
  addColumn('team_members', 'photo', 'TEXT');
  // Profilseite: vom Board gepflegte Schwerpunkte und besondere Erfolge (je Zeile ein Eintrag; leer = automatisch)
  addColumn('team_members', 'focus', "TEXT NOT NULL DEFAULT ''");
  addColumn('team_members', 'highlights', "TEXT NOT NULL DEFAULT ''");
  // FiveNet: Abschrift des Dokumenttexts und aus FiveNet übernommene Bilder
  addColumn('case_external_docs', 'content_text', "TEXT NOT NULL DEFAULT ''");
  addColumn('case_external_docs', 'content_at', 'TEXT');
  addColumn('case_external_docs', 'content_by_name', "TEXT NOT NULL DEFAULT ''");
  // Zeitpunkt des Schließens einer Akte (für die Bearbeitungsdauer); beim Wiedereröffnen wieder NULL.
  addColumn('cases', 'closed_at', 'TEXT');
  // Discord-Ticket je Akte (Kanal, Mitglieder mit eigener Berechtigung, Mandant ohne Konto, letzter Fehler)
  addColumn('cases', 'discord_channel_id', 'TEXT');
  addColumn('cases', 'discord_members', 'TEXT');
  addColumn('cases', 'discord_client_id', 'TEXT');
  addColumn('cases', 'discord_archived', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('cases', 'discord_error', 'TEXT');
  addColumn('cases', 'discord_panel_id', 'TEXT'); // Nachricht mit den Buttons (Übernehmen, Schließen …)
  addColumn('cases', 'discord_panel_state', 'TEXT');
  addColumn('cases', 'discord_extra', 'TEXT'); // per /add hinzugefügte Personen (Discord-IDs)
  // Priorität (nur intern, für die Kanzlei): 1 niedrig · 2 normal · 3 hoch · 4 kritisch
  addColumn('cases', 'priority', 'INTEGER NOT NULL DEFAULT 2');
  // Prozessticket: Link zum Kanal auf einem anderen Discord (z. B. DOJ) – nur für die Kanzlei sichtbar
  addColumn('cases', 'process_ticket_url', 'TEXT');
  addColumn('cases', 'process_ticket_label', 'TEXT');
  // Liegengebliebene Akte: wann der zuständige Anwalt zuletzt daran erinnert wurde (einmal je Ruhephase)
  addColumn('cases', 'idle_notified_at', 'TEXT');
  // Ergebnis beim Abschluss (Freispruch, Vergleich … – helpers.OUTCOMES), nur für die Kanzlei; Grundlage der Erfolgsquote
  addColumn('cases', 'outcome', 'TEXT');
  // Nach dem Abschluss einmal um eine Bewertung gebeten (Mandantenportal + Discord-DM)
  addColumn('cases', 'review_requested_at', 'TEXT');

  // Zwei-Faktor-Anmeldung per Discord-DM: je Konto wählbar (für das Board Pflicht), offene Anmeldecodes, vertraute Geräte
  addColumn('users', 'two_factor', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_challenges (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      sends      INTEGER NOT NULL DEFAULT 1,
      sent_at    TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash   TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
  `);
  // Board-Tickets (Discord-Kanal je Bewerbung bzw. Anliegen, nur für das Board of Partners)
  for (const table of ['applications', 'concerns']) {
    addColumn(table, 'discord_channel_id', 'TEXT');
    addColumn(table, 'discord_members', 'TEXT');
    addColumn(table, 'discord_archived', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(table, 'discord_error', 'TEXT');
    addColumn(table, 'discord_panel_id', 'TEXT');
    addColumn(table, 'discord_panel_state', 'TEXT');
    addColumn(table, 'discord_extra', 'TEXT');
  }
};
