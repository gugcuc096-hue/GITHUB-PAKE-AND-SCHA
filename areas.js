'use strict';
/*
 * Rechtsgebiete als Daten statt als Code: Name, Kürzel, Farbe, Symbol, Kurztitel für Website-Anfragen, Reihenfolge,
 * Verfahrensschritte, Checkliste, erlaubte Ergebnisse und Zusatzfelder im Mandatsformular – alles pflegbar unter
 * Einstellungen → Listen → Rechtsgebiete. Der Schlüssel (key) bleibt für immer gleich; Umbenennen ändert nur den Namen,
 * deshalb behalten alle Akten, Aufgaben-Pakete und Auswertungen ihr Rechtsgebiet. „Ausblenden“ statt Löschen: ein
 * ausgeblendetes Rechtsgebiet erscheint nicht mehr in Formularen, bestehende Akten behalten es.
 */
const { z } = require('zod');
const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS areas (
    key          TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    short        TEXT NOT NULL DEFAULT '',
    color        TEXT NOT NULL DEFAULT 'gold',
    icon         TEXT NOT NULL DEFAULT 'scale',
    intake_title TEXT NOT NULL DEFAULT '',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    steps        TEXT NOT NULL DEFAULT '[]',
    checklist    TEXT NOT NULL DEFAULT '[]',
    outcomes     TEXT NOT NULL DEFAULT '[]',
    fields       TEXT NOT NULL DEFAULT '[]'
  );
`);

const DEFAULT_STEPS = ['Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung'];
const COLORS = ['gold', 'sky', 'emerald', 'amber', 'red', 'violet', 'slate'];
const ICONS = ['scale', 'shield', 'book', 'doc', 'folder', 'box', 'briefcase', 'users', 'star', 'crown', 'home', 'seal', 'ballot', 'tag'];
const FIELD_TYPES = { text: 'Text (eine Zeile)', textarea: 'Text (mehrzeilig)', date: 'Datum', number: 'Zahl', select: 'Auswahl', checkbox: 'Ja / Nein' };

/** Die fünf Rechtsgebiete, mit denen die Kanzlei gestartet ist – beim ersten Start eingetragen, vorhandene Akten bleiben unberührt. */
const SEED = [
  { key: 'strafrecht', name: 'Strafrecht', short: 'STR', color: 'red', icon: 'shield', intake_title: 'Strafrecht / Festnahme',
    checklist: ['Mandantengespräch führen und Sachverhalt aufnehmen', 'Vollmacht / Honorarvereinbarung erstellen', 'Akteneinsicht: Polizeibericht aus FiveNet verknüpfen', 'Beweismittel sichten und sichern', 'Verteidigungsstrategie festlegen', 'Hauptverhandlung vorbereiten'] },
  { key: 'zivilrecht', name: 'Zivilrecht', short: 'ZIV', color: 'sky', icon: 'scale', intake_title: 'Zivilrecht / Schadensersatz',
    checklist: ['Mandantengespräch führen und Unterlagen anfordern', 'Honorarvereinbarung erstellen', 'Anspruch prüfen', 'Schreiben an die Gegenseite aufsetzen', 'Antwortfrist der Gegenseite im Kalender eintragen', 'Klage oder Vergleich vorbereiten'] },
  { key: 'verfassungsrecht', name: 'Verfassungsrecht', short: 'VER', color: 'violet', icon: 'book', intake_title: 'Verfassungsbeschwerde',
    checklist: ['Mandantengespräch führen', 'Honorarvereinbarung erstellen', 'Zulässigkeit und Fristen prüfen', 'Schriftsatz entwerfen', 'Schriftsatz bei Gericht einreichen', 'Mündliche Verhandlung vorbereiten'] },
  { key: 'vertragsrecht', name: 'Vertragsrecht', short: 'VTR', color: 'emerald', icon: 'doc', intake_title: 'Vertragsrecht / Ausarbeitung',
    checklist: ['Anforderungen des Mandanten aufnehmen', 'Honorarvereinbarung erstellen', 'Vertragsentwurf erstellen', 'Entwurf mit dem Mandanten abstimmen', 'Unterzeichnung organisieren', 'Unterzeichneten Vertrag ablegen (FiveNet-Dokument oder Anhang)'] },
  { key: 'sonstiges', name: 'Sonstiges', short: 'SON', color: 'slate', icon: 'folder', intake_title: 'Sonstiges Anliegen',
    checklist: ['Mandantengespräch führen', 'Honorarvereinbarung erstellen', 'Nächste Schritte festlegen'] },
];

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM areas').get().n) return;
  const ins = db.prepare('INSERT INTO areas (key, name, short, color, icon, intake_title, sort_order, checklist) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  SEED.forEach((a, i) => ins.run(a.key, a.name, a.short, a.color, a.icon, a.intake_title, i + 1, JSON.stringify(a.checklist)));
  // Rechtsgebiete, die nur in Akten oder Paketen vorkommen (ältere Daten), nicht verlieren
  for (const r of db.prepare("SELECT DISTINCT area AS k FROM cases WHERE area NOT IN (SELECT key FROM areas) AND area != ''").all()) {
    db.prepare('INSERT OR IGNORE INTO areas (key, name, short, sort_order) VALUES (?, ?, ?, 99)').run(r.k, r.k.charAt(0).toUpperCase() + r.k.slice(1), r.k.slice(0, 3).toUpperCase());
  }
}
seed();

const json = (text, fallback) => {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const row = (r) => ({
  key: r.key,
  name: r.name,
  short: r.short,
  color: r.color,
  icon: r.icon,
  intakeTitle: r.intake_title || r.name,
  sortOrder: r.sort_order,
  active: !!r.active,
  steps: json(r.steps, []).length === 4 ? json(r.steps, []) : DEFAULT_STEPS,
  customSteps: json(r.steps, []).length === 4,
  checklist: json(r.checklist, []),
  outcomes: json(r.outcomes, []),
  fields: json(r.fields, []),
  defaultFees: json(r.default_fees, []).filter((n) => Number.isInteger(n)),
  defaultType: r.default_type || '',
});

let cache = null;
const bump = () => (cache = null);
function all() {
  if (!cache) cache = db.prepare('SELECT * FROM areas ORDER BY sort_order, name').all().map(row);
  return cache;
}
const get = (key) => all().find((a) => a.key === key) || null;
const exists = (key) => !!get(key);
const list = ({ activeOnly = false } = {}) => (activeOnly ? all().filter((a) => a.active) : all());
/** Anzeigename – auch für ausgeblendete oder (versehentlich) unbekannte Rechtsgebiete. */
const name = (key) => (get(key) || { name: key || '' }).name;
const names = () => Object.fromEntries(all().map((a) => [a.key, a.name]));
const intakeTitleOf = (key) => (get(key) || get('sonstiges') || { intakeTitle: 'Anfrage' }).intakeTitle;
const checklistOf = (key) => (get(key) && get(key).checklist.length ? get(key).checklist : (get('sonstiges') || { checklist: [] }).checklist);
const stepsOf = (key) => (get(key) || { steps: DEFAULT_STEPS }).steps;

/** Zod-Prüfung für Rechtsgebiet-Felder: muss existieren. */
const keySchema = z.string().refine((k) => exists(k), 'Dieses Rechtsgebiet gibt es nicht.');
/** … und für neue Akten außerdem eingeschaltet (ausgeblendete Rechtsgebiete nimmt niemand mehr an). */
const activeKeySchema = keySchema.refine((k) => get(k).active, 'Dieses Rechtsgebiet nehmen wir derzeit nicht an.');

/* ---------------------------------------------------------------- Verwalten */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Schlüssel: Kleinbuchstaben, Ziffern, _ (2–31 Zeichen).'),
  label: z.string().trim().min(2).max(80),
  type: z.enum(Object.keys(FIELD_TYPES)),
  required: z.boolean().default(false),
  hint: z.string().trim().max(200).default(''),
  options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
const input = z.object({
  name: z.string().trim().min(2).max(50),
  short: z.string().trim().max(6).default(''),
  color: z.enum(COLORS).default('gold'),
  icon: z.enum(ICONS).default('scale'),
  intakeTitle: z.string().trim().max(80).default(''),
  active: z.boolean().default(true),
  steps: z.array(z.string().trim().min(2).max(30)).length(4).nullable().default(null),
  checklist: z.array(z.string().trim().min(2).max(160)).max(20).default([]),
  outcomes: z.array(z.string()).max(20).default([]),
  fields: z
    .array(fieldSchema)
    .max(12)
    .superRefine((fields, ctx) => {
      const seen = new Set();
      for (const f of fields) {
        if (seen.has(f.key)) ctx.addIssue({ code: 'custom', message: `Der Schlüssel „${f.key}“ kommt doppelt vor.` });
        seen.add(f.key);
        if (f.type === 'select' && f.options.length < 2) ctx.addIssue({ code: 'custom', message: `„${f.label}“: eine Auswahl braucht mindestens zwei Möglichkeiten.` });
      }
    })
    .default([]),
  defaultFees: z.array(z.number().int().positive()).max(30).default([]),
  defaultType: z.string().max(40).default(''),
});

/** Standardgebühren und Rechnungsart müssen es geben (sonst stillschweigend ignorieren wäre irreführend). */
function checkDefaults(d) {
  const ids = new Set(db.prepare('SELECT id FROM fees').all().map((r) => r.id));
  const bad = d.defaultFees.find((id) => !ids.has(id));
  if (bad) throw Object.assign(new Error('Eine der Standardgebühren gibt es nicht mehr.'), { status: 400 });
  if (d.defaultType && !db.prepare('SELECT 1 FROM invoice_types WHERE key = ?').get(d.defaultType)) throw Object.assign(new Error('Diese Rechnungsart gibt es nicht.'), { status: 400 });
}

function create(data) {
  const d = input.parse(data);
  checkDefaults(d);
  let key = slug(d.name) || 'gebiet';
  for (let i = 2; exists(key) || db.prepare('SELECT 1 FROM areas WHERE key = ?').get(key); i++) key = `${slug(d.name) || 'gebiet'}-${i}`;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM areas').get().m;
  db.prepare('INSERT INTO areas (key, name, short, color, icon, intake_title, sort_order, active, steps, checklist, outcomes, fields, default_fees, default_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    key, d.name, d.short, d.color, d.icon, d.intakeTitle, max + 1, d.active ? 1 : 0, JSON.stringify(d.steps || []), JSON.stringify(d.checklist), JSON.stringify(d.outcomes), JSON.stringify(d.fields), JSON.stringify(d.defaultFees), d.defaultType
  );
  bump();
  return get(key);
}
function update(key, data) {
  if (!exists(key)) throw Object.assign(new Error('Rechtsgebiet nicht gefunden.'), { status: 404 });
  const d = input.parse(data);
  checkDefaults(d);
  db.prepare('UPDATE areas SET name = ?, short = ?, color = ?, icon = ?, intake_title = ?, active = ?, steps = ?, checklist = ?, outcomes = ?, fields = ?, default_fees = ?, default_type = ? WHERE key = ?').run(
    d.name, d.short, d.color, d.icon, d.intakeTitle, d.active ? 1 : 0, JSON.stringify(d.steps || []), JSON.stringify(d.checklist), JSON.stringify(d.outcomes), JSON.stringify(d.fields), JSON.stringify(d.defaultFees), d.defaultType, key
  );
  bump();
  return get(key);
}
function reorder(keys) {
  const st = db.prepare('UPDATE areas SET sort_order = ? WHERE key = ?');
  keys.forEach((k, i) => st.run(i + 1, k));
  bump();
}
/** Wie oft wird das Rechtsgebiet gebraucht? (Akten, Aufgaben-Pakete) */
function usage(key) {
  return {
    cases: db.prepare('SELECT COUNT(*) AS n FROM cases WHERE area = ?').get(key).n,
    packages: db.prepare('SELECT COUNT(*) AS n FROM task_packages WHERE area = ?').get(key).n,
  };
}
function remove(key) {
  const u = usage(key);
  if (u.cases || u.packages) throw Object.assign(new Error(`„${name(key)}“ wird noch gebraucht (${u.cases} Akten, ${u.packages} Aufgaben-Pakete) – bitte ausblenden statt löschen.`), { status: 409 });
  db.prepare('DELETE FROM areas WHERE key = ?').run(key);
  bump();
}

/* ---------------------------------------------------------------- Zusatzfelder im Mandatsformular */
/**
 * Prüft die Antworten zu den Zusatzfeldern eines Rechtsgebiets. Liefert { answers, error }: answers = { key: { label, value } }
 * (die Bezeichnung wird mitgespeichert, damit spätere Änderungen alte Akten nicht verfälschen).
 */
function checkAnswers(areaKey, given, { enforceRequired = true } = {}) {
  const area = get(areaKey);
  const answers = {};
  const src = given && typeof given === 'object' ? given : {};
  for (const f of area ? area.fields : []) {
    let v = src[f.key];
    if (f.type === 'checkbox') v = v === true || v === 'true' || v === 'ja' ? 'Ja' : v === false || v === 'false' || v === 'nein' ? 'Nein' : '';
    v = v === undefined || v === null ? '' : String(v).trim();
    if (!v && f.required && enforceRequired && f.type !== 'checkbox') return { answers, error: `Bitte „${f.label}“ ausfüllen.` };
    if (!v) continue;
    if (v.length > (f.type === 'textarea' ? 2000 : 300)) return { answers, error: `„${f.label}“ ist zu lang.` };
    if (f.type === 'number' && !Number.isFinite(Number(v.replace(',', '.')))) return { answers, error: `„${f.label}“ muss eine Zahl sein.` };
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { answers, error: `„${f.label}“ muss ein Datum sein.` };
    if (f.type === 'select' && !f.options.includes(v)) return { answers, error: `„${f.label}“: bitte eine der angebotenen Möglichkeiten wählen.` };
    answers[f.key] = { label: f.label, value: v };
  }
  return { answers, error: null };
}

/** Für Website und Dashboard (öffentlich lesbar): nur, was zum Ausfüllen gebraucht wird. */
const publicList = () =>
  list({ activeOnly: true }).map((a) => ({ key: a.key, name: a.name, short: a.short, color: a.color, icon: a.icon, intakeTitle: a.intakeTitle, fields: a.fields }));

/** Für Dashboard und Startseite beim Start: eingeschaltete mit Feldern, dazu alle Namen/Schritte (auch ausgeblendete) zum Anzeigen alter Akten. */
const clientPayload = () => ({ list: publicList(), names: names(), steps: Object.fromEntries(all().map((a) => [a.key, a.steps])), outcomes: Object.fromEntries(all().filter((a) => a.outcomes.length).map((a) => [a.key, a.outcomes])), colors: Object.fromEntries(all().map((a) => [a.key, a.color])) });

module.exports = { clientPayload, activeKeySchema, DEFAULT_STEPS, COLORS, ICONS, FIELD_TYPES, list, get, exists, name, names, intakeTitleOf, checklistOf, stepsOf, keySchema, create, update, reorder, remove, usage, checkAnswers, publicList, bump };
