'use strict';
/*
 * Nummerierte Migrationen: jede Datei server/db/migrations/NNN-name.js exportiert up(ctx) und läuft genau einmal –
 * in der Reihenfolge ihrer Nummer. Erledigte stehen in der Tabelle schema_migrations.
 *
 * Neue Tabelle oder Spalte? Neue Datei mit der nächsten Nummer anlegen (nie eine erledigte Datei ändern).
 * Die Dateien 001–014 sind das bisherige Schema; sie sind so geschrieben, dass sie auch auf einer bestehenden
 * Datenbank gefahrlos laufen (IF NOT EXISTS, addColumn prüft die Spalte) – so werden ältere Datenbanken und
 * eingespielte Sicherungen ohne schema_migrations automatisch auf den aktuellen Stand gebracht.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');

/** Alle Migrationen in Reihenfolge: [{ id: '001-grundtabellen', file }] */
function listMigrations() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{3}-[\w-]+\.js$/.test(f))
    .sort()
    .map((f) => ({ id: f.replace(/\.js$/, ''), file: path.join(DIR, f) }));
}

function runMigrations(ctx) {
  const { db } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const ran = [];
  for (const m of listMigrations()) {
    if (done.has(m.id)) continue;
    require(m.file)(ctx);
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(m.id);
    ran.push(m.id);
  }
  if (ran.length && done.size) console.log(`Datenbank aktualisiert: ${ran.join(', ')}`);
  return ran;
}

module.exports = { runMigrations, listMigrations };
