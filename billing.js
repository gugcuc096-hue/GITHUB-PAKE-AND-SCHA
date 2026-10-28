'use strict';
/*
 * Gebührenkategorien und Rechnungsarten als Daten (Einstellungen → Listen):
 *  - Kategorien der Honorarordnung („Rechtsberatung“, „Notfall & Sofortdienst“ …) – auch die Reiter auf der Website;
 *  - Rechnungsarten mit Grundart (Rechnung / Honorarvereinbarung), Zahlungsziel in Tagen, Vorschuss in Prozent,
 *    Auslagenpauschale und Standardtext. Die Grundart bestimmt Nummernkreis und Darstellung, die Art ergänzt Voreinstellungen.
 * Standardgebühren je Rechtsgebiet liegen am Rechtsgebiet (areas.default_fees) und füllen neue Rechnungen vor.
 */
const { z } = require('zod');
const { db } = require('./db');
require('./areas'); // legt die Tabelle areas an (hier kommen Spalten dazu)

db.exec(`
  CREATE TABLE IF NOT EXISTS fee_categories (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS invoice_types (
    key            TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    base           TEXT NOT NULL DEFAULT 'rechnung',   -- rechnung | honorarvereinbarung
    due_days       INTEGER NOT NULL DEFAULT 7,         -- Zahlungsziel in Tagen (0 = kein Datum)
    advance_pct    INTEGER NOT NULL DEFAULT 0,         -- Vorschuss in % vor Beginn der Tätigkeit
    expense_label  TEXT NOT NULL DEFAULT '',           -- Auslagenpauschale: Bezeichnung der Position
    expense_amount INTEGER NOT NULL DEFAULT 0,         -- … und Betrag (0 = keine)
    note           TEXT NOT NULL DEFAULT '',           -- Standardtext (Anmerkungen / Vereinbarungstext)
    sort_order     INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1
  );
`);
for (const [table, ddl] of [
  ['invoices', 'type_key TEXT'],
  ['areas', "default_fees TEXT NOT NULL DEFAULT '[]'"],
  ['areas', "default_type TEXT NOT NULL DEFAULT ''"],
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    /* Spalte ist schon da */
  }
}

const BASES = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
const SEED_CATEGORIES = [
  ['rechtsberatung', 'Rechtsberatung'],
  ['strafrecht', 'Strafrecht & Haftvertretung'],
  ['notfall', 'Notfall & Sofortdienst'],
  ['gericht', 'Gerichtsverfahren'],
  ['vertraege', 'Verträge & Dokumente'],
];
if (!db.prepare('SELECT COUNT(*) AS n FROM fee_categories').get().n) {
  const ins = db.prepare('INSERT INTO fee_categories (key, name, sort_order) VALUES (?, ?, ?)');
  SEED_CATEGORIES.forEach(([k, n], i) => ins.run(k, n, i + 1));
  // Kategorien aus älteren Leistungen nicht verlieren
  for (const r of db.prepare("SELECT DISTINCT category AS k FROM fees WHERE category NOT IN (SELECT key FROM fee_categories) AND category != ''").all()) {
    db.prepare('INSERT OR IGNORE INTO fee_categories (key, name, sort_order) VALUES (?, ?, 99)').run(r.k, r.k.charAt(0).toUpperCase() + r.k.slice(1));
  }
}
if (!db.prepare('SELECT COUNT(*) AS n FROM invoice_types').get().n) {
  const ins = db.prepare('INSERT INTO invoice_types (key, name, base, due_days, advance_pct, sort_order) VALUES (?, ?, ?, 7, ?, ?)');
  ins.run('rechnung', 'Rechnung', 'rechnung', 0, 1);
  ins.run('honorarvereinbarung', 'Honorarvereinbarung', 'honorarvereinbarung', 0, 2);
}

const slug = (s, fallback) =>
  String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/* ---------------------------------------------------------------- Gebührenkategorien */
const catRow = (r) => ({ key: r.key, name: r.name, sortOrder: r.sort_order, active: !!r.active, usage: db.prepare('SELECT COUNT(*) AS n FROM fees WHERE category = ?').get(r.key).n });
const categories = ({ activeOnly = false } = {}) => db.prepare(`SELECT * FROM fee_categories ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name`).all().map(catRow);
const category = (key) => {
  const r = db.prepare('SELECT * FROM fee_categories WHERE key = ?').get(key);
  return r ? catRow(r) : null;
};
const categoryInput = z.object({ name: z.string().trim().min(2).max(60), active: z.boolean().default(true) });
/** Zod-Prüfung für die Kategorie einer Leistung: muss existieren. */
const categoryKeySchema = z.string().refine((k) => !!category(k), 'Diese Kategorie gibt es nicht.');
function createCategory(data) {
  const d = categoryInput.parse(data);
  let key = slug(d.name, 'kategorie');
  const base = key;
  for (let i = 2; category(key); i++) key = `${base}-${i}`;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fee_categories').get().m;
  db.prepare('INSERT INTO fee_categories (key, name, sort_order, active) VALUES (?, ?, ?, ?)').run(key, d.name, max + 1, d.active ? 1 : 0);
  return category(key);
}
function updateCategory(key, data) {
  if (!category(key)) throw fail('Kategorie nicht gefunden.', 404);
  const d = categoryInput.parse(data);
  db.prepare('UPDATE fee_categories SET name = ?, active = ? WHERE key = ?').run(d.name, d.active ? 1 : 0, key);
  return category(key);
}
function removeCategory(key) {
  const c = category(key);
  if (!c) throw fail('Kategorie nicht gefunden.', 404);
  if (c.usage) throw fail(`Diese Kategorie enthält noch ${c.usage} Leistungen – bitte erst verschieben oder die Kategorie ausblenden.`, 409);
  db.prepare('DELETE FROM fee_categories WHERE key = ?').run(key);
}
function reorderCategories(keys) {
  const st = db.prepare('UPDATE fee_categories SET sort_order = ? WHERE key = ?');
  keys.forEach((k, i) => st.run(i + 1, k));
}

/* ---------------------------------------------------------------- Rechnungsarten */
const typeRow = (r) => ({
  key: r.key,
  name: r.name,
  base: r.base,
  dueDays: r.due_days,
  advancePct: r.advance_pct,
  expenseLabel: r.expense_label,
  expenseAmount: r.expense_amount,
  note: r.note,
  sortOrder: r.sort_order,
  active: !!r.active,
  usage: db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE type_key = ?').get(r.key).n,
});
const types = ({ activeOnly = false } = {}) => db.prepare(`SELECT * FROM invoice_types ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name`).all().map(typeRow);
const type = (key) => {
  const r = key ? db.prepare('SELECT * FROM invoice_types WHERE key = ?').get(key) : null;
  return r ? typeRow(r) : null;
};
const typeName = (key) => (type(key) || {}).name || '';
const typeInput = z.object({
  name: z.string().trim().min(2).max(60),
  base: z.enum(Object.keys(BASES)),
  dueDays: z.number().int().min(0).max(365).default(7),
  advancePct: z.number().int().min(0).max(100).default(0),
  expenseLabel: z.string().trim().max(80).default(''),
  expenseAmount: z.number().int().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(3000).default(''),
  active: z.boolean().default(true),
});
function createType(data) {
  const d = typeInput.parse(data);
  if (d.expenseAmount > 0 && !d.expenseLabel) throw fail('Bitte die Bezeichnung der Auslagenpauschale angeben.');
  let key = slug(d.name, 'art');
  const base = key;
  for (let i = 2; type(key); i++) key = `${base}-${i}`;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM invoice_types').get().m;
  db.prepare('INSERT INTO invoice_types (key, name, base, due_days, advance_pct, expense_label, expense_amount, note, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    key, d.name, d.base, d.dueDays, d.advancePct, d.expenseLabel, d.expenseAmount, d.note, max + 1, d.active ? 1 : 0
  );
  return type(key);
}
function updateType(key, data) {
  if (!type(key)) throw fail('Rechnungsart nicht gefunden.', 404);
  const d = typeInput.parse(data);
  if (d.expenseAmount > 0 && !d.expenseLabel) throw fail('Bitte die Bezeichnung der Auslagenpauschale angeben.');
  db.prepare('UPDATE invoice_types SET name = ?, base = ?, due_days = ?, advance_pct = ?, expense_label = ?, expense_amount = ?, note = ?, active = ? WHERE key = ?').run(
    d.name, d.base, d.dueDays, d.advancePct, d.expenseLabel, d.expenseAmount, d.note, d.active ? 1 : 0, key
  );
  return type(key);
}
function removeType(key) {
  const t = type(key);
  if (!t) throw fail('Rechnungsart nicht gefunden.', 404);
  if (t.usage) throw fail(`Diese Art wird noch in ${t.usage} Rechnungen verwendet – bitte ausblenden statt löschen.`, 409);
  if (['rechnung', 'honorarvereinbarung'].includes(key)) throw fail('Die beiden Grundarten bleiben bestehen – bitte ausblenden.', 409);
  db.prepare('DELETE FROM invoice_types WHERE key = ?').run(key);
  db.prepare("UPDATE areas SET default_type = '' WHERE default_type = ?").run(key);
}
function reorderTypes(keys) {
  const st = db.prepare('UPDATE invoice_types SET sort_order = ? WHERE key = ?');
  keys.forEach((k, i) => st.run(i + 1, k));
}

/** Zeile für Anmerkungen: „Vorschuss 30 % = 4.500 $ vor Beginn der Tätigkeit fällig.“ */
const advanceLine = (pct, total) => (pct > 0 && total > 0 ? `Vorschuss: ${pct} % (${Math.round((total * pct) / 100).toLocaleString('de-DE')} $) werden vor Beginn der Tätigkeit fällig.` : '');

module.exports = { BASES, categories, category, categoryKeySchema, createCategory, updateCategory, removeCategory, reorderCategories, types, type, typeName, createType, updateType, removeType, reorderTypes, advanceLine };
