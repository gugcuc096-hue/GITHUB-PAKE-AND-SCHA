'use strict';
/*
 * Aktuelles auf der Website: Meldungen, die das Board von Hand schreibt (Titel, Text, angepinnt, sichtbar).
 * Automatische Meldungen (neu im Team, Beförderung, offene Stelle) stehen nicht hier – die entstehen beim Abruf aus
 * Personalprotokoll und Stellen (server/domain/news.js).
 */
module.exports = function up({ createIfMissing }) {
  createIfMissing(
    'news',
    (t) => `CREATE TABLE ${t} (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      pinned      INTEGER NOT NULL DEFAULT 0,
      visible     INTEGER NOT NULL DEFAULT 1,
      author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
};
