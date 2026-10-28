'use strict';
/*
 * Termin- und Fristenarten (Einstellungen → Listen): eigene Arten wie „Berufung“ oder „Anhörung“ mit Grundart, Dauer,
 * Ort, Sichtbarkeit für Mandanten – und einer Rechenregel („14 Tage ab Zustellung“) für den Fristenrechner.
 * Die Grundart (Mandantengespräch, Gerichtstermin, Frist, Intern) bestimmt weiter, wie sich der Eintrag verhält
 * (Erinnerungen, Mandanten-Abfrage, Farbe); die Art ergänzt Name und Voreinstellungen.
 */
const { z } = require('zod');
const { db } = require('./db');
const { EVENT_TYPES } = require('./helpers');

db.exec(`
  CREATE TABLE IF NOT EXISTS event_kinds (
    key             TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    base            TEXT NOT NULL DEFAULT 'frist',
    default_minutes INTEGER NOT NULL DEFAULT 0,
    default_location TEXT NOT NULL DEFAULT '',
    client_visible  INTEGER NOT NULL DEFAULT -1,   -- -1 = wie die Grundart
    rule_amount     INTEGER NOT NULL DEFAULT 0,    -- 0 = keine Rechenregel
    rule_unit       TEXT NOT NULL DEFAULT 'tage',  -- tage | werktage | wochen | monate
    rule_from       TEXT NOT NULL DEFAULT '',      -- „Zustellung“, „Verkündung“ …
    weekend_shift   INTEGER NOT NULL DEFAULT 1,    -- Fristende am Wochenende → nächster Werktag (§ 193 BGB)
    sort_order      INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1
  );
`);
try {
  db.exec('ALTER TABLE appointments ADD COLUMN kind TEXT');
} catch {
  /* Spalte ist schon da */
}

const BASES = Object.keys(EVENT_TYPES);
const UNITS = { tage: 'Kalendertage', werktage: 'Werktage (Mo–Fr)', wochen: 'Wochen', monate: 'Monate' };

const row = (r) => ({
  key: r.key,
  name: r.name,
  base: r.base,
  defaultMinutes: r.default_minutes,
  defaultLocation: r.default_location,
  clientVisible: r.client_visible < 0 ? null : !!r.client_visible,
  ruleAmount: r.rule_amount,
  ruleUnit: r.rule_unit,
  ruleFrom: r.rule_from,
  weekendShift: !!r.weekend_shift,
  sortOrder: r.sort_order,
  active: !!r.active,
  rule: r.rule_amount > 0 ? ruleText(r) : '',
});
function ruleText(r) {
  const one = r.rule_amount === 1;
  const unit = { tage: one ? 'Tag' : 'Tage', werktage: one ? 'Werktag' : 'Werktage', wochen: one ? 'Woche' : 'Wochen', monate: one ? 'Monat' : 'Monate' }[r.rule_unit];
  return `${r.rule_amount} ${unit}${r.rule_from ? ` ab ${r.rule_from}` : ''}`;
}

const list = ({ activeOnly = false } = {}) => db.prepare(`SELECT * FROM event_kinds ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name`).all().map(row);
const get = (key) => {
  const r = db.prepare('SELECT * FROM event_kinds WHERE key = ?').get(key);
  return r ? row(r) : null;
};
const nameOf = (key) => (get(key) || {}).name || '';

const input = z.object({
  name: z.string().trim().min(2).max(50),
  base: z.enum(BASES),
  defaultMinutes: z.number().int().min(0).max(1440).default(0),
  defaultLocation: z.string().trim().max(120).default(''),
  clientVisible: z.boolean().nullable().default(null),
  ruleAmount: z.number().int().min(0).max(999).default(0),
  ruleUnit: z.enum(Object.keys(UNITS)).default('tage'),
  ruleFrom: z.string().trim().max(40).default(''),
  weekendShift: z.boolean().default(true),
  active: z.boolean().default(true),
});
const slug = (s) =>
  String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'art';

function create(data) {
  const d = input.parse(data);
  let key = slug(d.name);
  for (let i = 2; get(key); i++) key = `${slug(d.name)}-${i}`;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM event_kinds').get().m;
  db.prepare(
    'INSERT INTO event_kinds (key, name, base, default_minutes, default_location, client_visible, rule_amount, rule_unit, rule_from, weekend_shift, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(key, d.name, d.base, d.defaultMinutes, d.defaultLocation, d.clientVisible === null ? -1 : d.clientVisible ? 1 : 0, d.ruleAmount, d.ruleUnit, d.ruleFrom, d.weekendShift ? 1 : 0, max + 1, d.active ? 1 : 0);
  return get(key);
}
function update(key, data) {
  if (!get(key)) throw Object.assign(new Error('Art nicht gefunden.'), { status: 404 });
  const d = input.parse(data);
  db.prepare(
    'UPDATE event_kinds SET name = ?, base = ?, default_minutes = ?, default_location = ?, client_visible = ?, rule_amount = ?, rule_unit = ?, rule_from = ?, weekend_shift = ?, active = ? WHERE key = ?'
  ).run(d.name, d.base, d.defaultMinutes, d.defaultLocation, d.clientVisible === null ? -1 : d.clientVisible ? 1 : 0, d.ruleAmount, d.ruleUnit, d.ruleFrom, d.weekendShift ? 1 : 0, d.active ? 1 : 0, key);
  return get(key);
}
const usage = (key) => db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE kind = ?').get(key).n;
function remove(key) {
  const n = usage(key);
  if (n) throw Object.assign(new Error(`Diese Art wird noch in ${n} Kalendereinträgen verwendet – bitte ausblenden statt löschen.`), { status: 409 });
  db.prepare('DELETE FROM event_kinds WHERE key = ?').run(key);
}
function reorder(keys) {
  const st = db.prepare('UPDATE event_kinds SET sort_order = ? WHERE key = ?');
  keys.forEach((k, i) => st.run(i + 1, k));
}

/* ---------------------------------------------------------------- Fristenrechner */
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T12:00:00Z`);
function addMonths(d, n) {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last)); // 31. Januar + 1 Monat = 28./29. Februar (§ 188 Abs. 3 BGB)
  return out;
}
function addWorkdays(d, n) {
  const out = new Date(d);
  let left = n;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (![0, 6].includes(out.getUTCDay())) left--;
  }
  return out;
}
/**
 * Fristende aus einem Ausgangsdatum (z. B. Zustellung). Liefert { date, weekday, shifted, text } – Feiertage werden nicht
 * berücksichtigt (nur Samstag/Sonntag verschieben das Ende auf den Montag).
 */
function compute(kind, from) {
  if (!kind || !kind.ruleAmount) throw Object.assign(new Error('Für diese Art ist keine Rechenregel hinterlegt.'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || Number.isNaN(parse(from).getTime())) throw Object.assign(new Error('Bitte ein gültiges Datum angeben.'), { status: 400 });
  const start = parse(from);
  let end;
  if (kind.ruleUnit === 'tage') (end = new Date(start)).setUTCDate(end.getUTCDate() + kind.ruleAmount);
  else if (kind.ruleUnit === 'wochen') (end = new Date(start)).setUTCDate(end.getUTCDate() + kind.ruleAmount * 7);
  else if (kind.ruleUnit === 'monate') end = addMonths(start, kind.ruleAmount);
  else end = addWorkdays(start, kind.ruleAmount);
  let shifted = false;
  if (kind.weekendShift) {
    while ([0, 6].includes(end.getUTCDay())) {
      end.setUTCDate(end.getUTCDate() + 1);
      shifted = true;
    }
  }
  const date = iso(end);
  const pretty = `${WEEKDAYS[end.getUTCDay()]}, ${date.split('-').reverse().join('.')}`;
  return { date, weekday: WEEKDAYS[end.getUTCDay()], shifted, text: `Fristende: ${pretty}${shifted ? ' (das rechnerische Ende fiel auf ein Wochenende – nächster Werktag)' : ''}`, rule: `${kind.rule}` };
}

module.exports = { BASES, UNITS, list, get, nameOf, create, update, remove, reorder, usage, compute, input };
