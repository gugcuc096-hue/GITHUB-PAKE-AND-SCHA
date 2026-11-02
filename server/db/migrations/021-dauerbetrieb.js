'use strict';
/*
 * Dauerbetrieb (Render Free): Verzeichnis der hochgeladenen Dateien, die einzeln im Google Drive liegen
 * (Pfad unter uploads/, Größe, Datei-ID im Drive). Steht in der Datenbank – und damit selbst in jeder Sicherung.
 */
module.exports = function up({ createIfMissing }) {
  createIfMissing(
    'dauer_files',
    (t) => `CREATE TABLE ${t} (
      path TEXT PRIMARY KEY,
      size INTEGER NOT NULL DEFAULT 0,
      drive_id TEXT,
      state TEXT NOT NULL DEFAULT 'ok',
      deleted_at TEXT,
      synced_at TEXT
    )`
  );
};
