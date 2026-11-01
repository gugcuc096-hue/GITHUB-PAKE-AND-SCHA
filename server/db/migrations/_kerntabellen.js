'use strict';
/*
 * Akten, Termine und Notizen als Funktion (Tabellenname als Parameter): Neuanlage (001) und Neuaufbau alter
 * Datenbanken (006) verwenden exakt dasselbe Schema.
 */
/* ================================================================
   Tabellen-Definitionen
   ================================================================ */
// Tabellen, die bei Altdatenbanken neu aufgebaut werden müssen, sind als
// Funktion definiert (Tabellenname als Parameter), damit Neuanlage und
// Migration exakt dasselbe Schema verwenden.
const CASES_SQL = (name) => `
  CREATE TABLE ${name} (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number   TEXT NOT NULL UNIQUE,
    access_pin    TEXT NOT NULL,
    title         TEXT NOT NULL,
    area          TEXT NOT NULL DEFAULT 'sonstiges',
    urgency       TEXT NOT NULL DEFAULT 'normal',
    description   TEXT NOT NULL DEFAULT '',
    client_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_name   TEXT NOT NULL DEFAULT '',
    client_phone  TEXT NOT NULL DEFAULT '',
    opponent      TEXT NOT NULL DEFAULT '',
    court_ref     TEXT NOT NULL DEFAULT '',
    lawyer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_bearbeitung','geschlossen')),
    step          INTEGER NOT NULL DEFAULT 0,
    public_note   TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'portal',
    closed_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

// Ein gemeinsamer Kalender für Mandanten-Terminanfragen, Gerichtstermine,
// Fristen und interne Termine.
const APPOINTMENTS_SQL = (name) => `
  CREATE TABLE ${name} (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    client_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type           TEXT NOT NULL DEFAULT 'mandant' CHECK (type IN ('mandant','gericht','frist','intern')),
    title          TEXT NOT NULL,
    starts_at      TEXT NOT NULL,
    ends_at        TEXT,
    location       TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'bestaetigt' CHECK (status IN ('angefragt','bestaetigt','abgesagt','erledigt')),
    assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_visible INTEGER NOT NULL DEFAULT 1,
    reminded       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

const NOTES_SQL = (name) => `
  CREATE TABLE ${name} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL,
    body        TEXT NOT NULL,
    internal    INTEGER NOT NULL DEFAULT 0,
    system      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

module.exports = { CASES_SQL, APPOINTMENTS_SQL, NOTES_SQL };
