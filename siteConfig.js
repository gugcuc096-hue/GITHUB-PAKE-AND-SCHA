'use strict';
/*
 * Konfiguration ohne Code: Banner, Startseite, Beschriftungen und Mitteilungstexte.
 * Jeder Bereich hat einen veröffentlichten Stand (gilt für alle) und optional einen Entwurf (nur zum Ansehen/Bearbeiten);
 * „Veröffentlichen“ macht den Entwurf gültig, „Verwerfen“ löscht ihn. Jede Veröffentlichung steht im Änderungsprotokoll
 * (mit „Zurücksetzen“). Fehlt etwas, gelten die Standardwerte – die Seite sieht dann aus wie bisher.
 */
const { z } = require('zod');
const { db } = require('./db');
const configLog = require('./configLog');

db.exec(`
  CREATE TABLE IF NOT EXISTS site_config (
    key          TEXT PRIMARY KEY,
    published    TEXT,
    draft        TEXT,
    updated_by   INTEGER,
    updated_at   TEXT,
    published_at TEXT
  );
`);

const SECTIONS = {
  ablauf: 'Ablauf',
  rechner: 'Tarifrechner',
  honorar: 'Honorarordnung',
  vip: 'VIP & Lifetime',
  team: 'Team',
  stimmen: 'Mandantenstimmen',
  faq: 'Fragen & Antworten',
  raenge: 'Kanzleiränge',
  karriere: 'Karriere',
  kontakt: 'Kontakt',
};
const SECTION_IDS = Object.keys(SECTIONS);

/** Begriffe, die sich im ganzen Dashboard und auf der Website umbenennen lassen. */
const TERMS = {
  mandant: { label: 'Mandant', sg: 'Mandant', pl: 'Mandanten' },
  akte: { label: 'Akte', sg: 'Akte', pl: 'Akten' },
  anwalt: { label: 'Anwalt', sg: 'Anwalt', pl: 'Anwälte' },
  rechnung: { label: 'Rechnung', sg: 'Rechnung', pl: 'Rechnungen' },
};

/** Texte der Benachrichtigungen (Standardtexte stehen in messageTemplates.js). */
const MESSAGE_KEYS = ['payment', 'docs', 'appointment', 'review', 'receipt'];

const url = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^(https?:\/\/[^\s]+|\/[^\s]*|#[^\s]*|mailto:[^\s]+)$/i.test(v), 'Bitte eine Adresse mit https:// (oder /pfad) angeben.');
const day = z.string().trim().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Datum als JJJJ-MM-TT.');

const SPECS = {
  banner: {
    perm: 'site.edit',
    label: 'Banner',
    schema: z.object({
      enabled: z.boolean(),
      text: z.string().trim().max(240),
      tone: z.enum(['gold', 'sky', 'amber', 'red', 'green']),
      link: url,
      linkLabel: z.string().trim().max(40),
      from: day,
      to: day,
      audience: z.array(z.enum(['public', 'mandant', 'staff'])).max(3),
      dismissible: z.boolean(),
    }),
    defaults: { enabled: false, text: '', tone: 'gold', link: '', linkLabel: '', from: '', to: '', audience: ['public', 'mandant', 'staff'], dismissible: true },
  },
  home: {
    perm: 'site.edit',
    label: 'Startseite',
    schema: z.object({
      order: z.array(z.enum(SECTION_IDS)).max(SECTION_IDS.length),
      hidden: z.array(z.enum(SECTION_IDS)).max(SECTION_IDS.length),
      faq: z.array(z.object({ q: z.string().trim().min(3).max(160), a: z.string().trim().min(3).max(800) })).max(12).nullable(),
      links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: url.refine((v) => v !== '', 'Adresse fehlt.') })).max(8),
      contactEmail: z.string().trim().max(120).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Keine gültige E-Mail-Adresse.'),
      kpis: z.object({ closed: z.boolean(), success: z.boolean(), rating: z.boolean() }),
    }),
    defaults: { order: SECTION_IDS, hidden: [], faq: null, links: [], contactEmail: '', kpis: { closed: true, success: true, rating: true } },
  },
  labels: {
    perm: 'site.edit',
    label: 'Beschriftungen',
    schema: z.object({
      terms: z.record(z.enum(Object.keys(TERMS)), z.object({ sg: z.string().trim().min(2).max(30), pl: z.string().trim().min(2).max(30) })),
      hints: z.record(z.string().regex(/^[\w.-]{2,80}$/), z.string().trim().max(300)),
    }),
    defaults: { terms: {}, hints: {} },
  },
  messages: {
    perm: 'settings.edit',
    label: 'Mitteilungstexte',
    schema: z.object({
      tone: z.enum(['sie', 'du']),
      docsAfterDays: z.number().int().min(1).max(30),
      texts: z.record(z.enum(MESSAGE_KEYS), z.string().max(1200)),
    }),
    defaults: { tone: 'sie', docsAfterDays: 3, texts: {} },
  },
};
const KEYS = Object.keys(SPECS);

const row = (key) => db.prepare('SELECT * FROM site_config WHERE key = ?').get(key);
const parse = (text, key) => {
  try {
    const v = JSON.parse(text);
    const r = SPECS[key].schema.safeParse(v);
    return r.success ? { ...SPECS[key].defaults, ...r.data } : null;
  } catch {
    return null;
  }
};

/** Veröffentlichter Stand (mit Standardwerten ergänzt). */
function get(key) {
  const r = row(key);
  return (r && r.published && parse(r.published, key)) || { ...SPECS[key].defaults };
}
function getDraft(key) {
  const r = row(key);
  return (r && r.draft && parse(r.draft, key)) || null;
}
const hasDraft = (key) => !!getDraft(key);
/** Was jemand mit Bearbeitungsrecht sieht: der Entwurf, sonst der veröffentlichte Stand. */
const getForEdit = (key) => getDraft(key) || get(key);

function saveDraft(key, value, user) {
  const v = SPECS[key].schema.parse(value);
  const json = JSON.stringify({ ...SPECS[key].defaults, ...v });
  db.prepare(
    `INSERT INTO site_config (key, draft, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET draft = excluded.draft, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, json, user ? user.id : null);
  return getDraft(key);
}
function discardDraft(key) {
  db.prepare('UPDATE site_config SET draft = NULL WHERE key = ?').run(key);
}
/** Entwurf (oder einen übergebenen Stand) veröffentlichen; schreibt ins Änderungsprotokoll. */
function publish(key, user, value) {
  const spec = SPECS[key];
  const next = value ? { ...spec.defaults, ...spec.schema.parse(value) } : getDraft(key);
  if (!next) return null;
  const before = get(key);
  db.prepare(
    `INSERT INTO site_config (key, published, draft, updated_by, updated_at, published_at) VALUES (?, ?, NULL, ?, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET published = excluded.published, draft = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at, published_at = excluded.published_at`
  ).run(key, JSON.stringify(next), user ? user.id : null);
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    configLog.add(user, { area: 'site_config', key, label: `${spec.label} veröffentlicht`, perm: spec.perm, before, after: next, revertible: true });
  }
  return next;
}
/** Für das Zurücksetzen im Änderungsprotokoll. */
function setPublished(key, value) {
  db.prepare(
    `INSERT INTO site_config (key, published, published_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET published = excluded.published, published_at = excluded.published_at, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify({ ...SPECS[key].defaults, ...SPECS[key].schema.parse(value) }));
}

/* ---------------------------------------------------------------- Banner */
const berlinDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
function audienceOf(user) {
  if (!user) return 'public';
  return user.role === 'mandant' ? 'mandant' : 'staff';
}
/** Das Banner, das diese Person gerade sieht – oder null. `source` darf auch der Entwurf sein (Vorschau). */
function activeBanner(user, source = get('banner')) {
  const b = source;
  if (!b || !b.enabled || !b.text) return null;
  const today = berlinDay();
  if (b.from && today < b.from) return null;
  if (b.to && today > b.to) return null;
  if (!b.audience.includes(audienceOf(user))) return null;
  // Kennung: ändert sich der Text, erscheint ein weggeklicktes Banner wieder
  const id = require('crypto').createHash('sha1').update(`${b.text}|${b.link}|${b.tone}`).digest('hex').slice(0, 10);
  return { id, text: b.text, tone: b.tone, link: b.link, linkLabel: b.linkLabel, dismissible: b.dismissible };
}

/** Beschriftungen, wie sie die Oberfläche braucht. */
function labelsPayload(source = get('labels')) {
  return { terms: source.terms, hints: source.hints };
}

/** Alles, was Website und Dashboard beim Start brauchen (öffentlich, nach Person gefiltert). */
function publicPayload(user, { draft = false } = {}) {
  const pick = (k) => (draft ? getForEdit(k) : get(k));
  return { banner: activeBanner(user, pick('banner')), home: pick('home'), labels: labelsPayload(pick('labels')), draft };
}

module.exports = { SPECS, KEYS, SECTIONS, SECTION_IDS, TERMS, MESSAGE_KEYS, get, getDraft, hasDraft, getForEdit, saveDraft, discardDraft, publish, setPublished, activeBanner, labelsPayload, publicPayload };
