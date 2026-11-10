'use strict';
/*
 * Konfiguration ohne Code: Banner, Startseite, Beschriftungen und Mitteilungstexte.
 * Jeder Bereich hat einen veröffentlichten Stand (gilt für alle) und optional einen Entwurf (nur zum Ansehen/Bearbeiten);
 * „Veröffentlichen“ macht den Entwurf gültig, „Verwerfen“ löscht ihn. Jede Veröffentlichung steht im Änderungsprotokoll
 * (mit „Zurücksetzen“). Fehlt etwas, gelten die Standardwerte – die Seite sieht dann aus wie bisher.
 */
const { z } = require('zod');
const { db } = require('../db/db');
const configLog = require('../core/configLog');

const SECTIONS = {
  aktuelles: 'Aktuelles',
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

/*
 * Startseite der Website, direkt auf der Seite einstellbar (Board, ?bearbeiten → „Startseite anpassen“):
 * Reihenfolge und Sichtbarkeit der Abschnitte unter dem Startbereich, welche Anwälte (und wie viele), welche
 * Rechtsgebiete, wie viele Meldungen und der zweite Knopf im Startbereich. Angewendet beim Ausliefern
 * (server/web/sitePages.js → applyStart), also ohne Flackern.
 */
const START_SECTIONS = { fakten: 'Kennzahlen', gebiete: 'Rechtsgebiete', ansprechpartner: 'Anwälte', stimmen: 'Mandantenstimme', neuigkeiten: 'Aktuelles', ablauf: 'Ablauf eines Mandats', sitz: 'Kanzleisitz mit Karte', band: 'Abschluss mit „Mandat anfragen“' };
const START_IDS = Object.keys(START_SECTIONS);
/** Gespeicherte Reihenfolge vervollständigen: ein später hinzugekommener Abschnitt steht hinter seinem Vorgänger aus der Standard-Reihenfolge. */
function startOrder(order) {
  const out = order.filter((id, i) => START_IDS.includes(id) && order.indexOf(id) === i);
  START_IDS.forEach((id, i) => {
    if (out.includes(id)) return;
    const prev = START_IDS.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
  });
  return out;
}
const LAWYER_MODES = { leitung: 'Kanzleileitung (Board of Partners)', auswahl: 'Eigene Auswahl', dienst: 'Wer gerade im Dienst ist zuerst', alle: 'Alle Anwälte' };
const HERO_SECOND = { notdienst: 'Notdienst bei Festnahme', anwaelte: 'Unsere Anwälte', honorare: 'Honorare & Tarifrechner', kontakt: 'Kontakt', keiner: 'Kein zweiter Knopf' };
const knownIds = (v) => (Array.isArray(v) ? v.filter((id) => START_IDS.includes(id)) : v);
/** Kanzleisitz auf der Startseite: Pin auf dem Kartenbild (x/y in Prozent der Kartenbreite/-höhe), Anschrift, Telefon, Zeiten. */
const SEAT_DEFAULTS = { x: null, y: null, address: '', phone: '', hours: '', note: '' };
const seatSchema = z
  .object({
    x: z.number().min(0).max(100).nullable().default(null),
    y: z.number().min(0).max(100).nullable().default(null),
    address: z.string().trim().max(160).default(''),
    phone: z.string().trim().max(40).default(''),
    hours: z.string().trim().max(120).default(''),
    note: z.string().trim().max(200).default(''),
  })
  .default(SEAT_DEFAULTS);
const START_DEFAULTS = { order: START_IDS, hidden: [], lawyerMode: 'leitung', lawyers: [], lawyerCount: 3, areas: [], newsCount: 3, heroSecond: 'notdienst', heroNote: true, seat: SEAT_DEFAULTS };
const startSchema = z
  .object({
    // Abschnitte, die es nicht mehr gibt (z. B. „leitsatz“), fallen aus gespeicherten Einstellungen einfach heraus
    order: z.preprocess(knownIds, z.array(z.enum(START_IDS)).max(START_IDS.length)).default(START_DEFAULTS.order),
    hidden: z.preprocess(knownIds, z.array(z.enum(START_IDS)).max(START_IDS.length)).default(START_DEFAULTS.hidden),
    lawyerMode: z.enum(Object.keys(LAWYER_MODES)).default('leitung'),
    lawyers: z.array(z.number().int().positive()).max(12).default([]),
    lawyerCount: z.number().int().min(1).max(9).default(3),
    areas: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(20).default([]),
    newsCount: z.number().int().min(1).max(6).default(3),
    // „Verfahrensstand abfragen“ gibt es als Knopf nicht mehr – gespeicherte Wahl fällt auf den Notdienst zurück
    heroSecond: z.preprocess((v) => (v === 'verfahrensstand' ? 'notdienst' : v), z.enum(Object.keys(HERO_SECOND))).default('notdienst'),
    heroNote: z.boolean().default(true),
    seat: seatSchema,
  })
  .default(START_DEFAULTS);

/** Begriffe, die sich im ganzen Dashboard und auf der Website umbenennen lassen. */
const TERMS = {
  mandant: { label: 'Mandant', sg: 'Mandant', pl: 'Mandanten' },
  akte: { label: 'Akte', sg: 'Akte', pl: 'Akten' },
  anwalt: { label: 'Anwalt', sg: 'Anwalt', pl: 'Anwälte' },
  rechnung: { label: 'Rechnung', sg: 'Rechnung', pl: 'Rechnungen' },
};

/** Texte der Benachrichtigungen (Standardtexte stehen in messageTemplates.js). */
const MESSAGE_KEYS = ['payment', 'docs', 'appointment', 'review', 'receipt'];

/** Stil-Vorlagen (Einstellungen → Konfiguration → Stil & Saison): Akzentfarbe, Glas, Rundung, Schrift. */
const PRESETS = {
  gold: { label: 'Klassisch Gold', accent: '#c9a45c', glass: 50, radius: 50, font: 'klassisch' },
  nacht: { label: 'Nacht-Blau', accent: '#7cc4fa', glass: 65, radius: 60, font: 'modern' },
  smaragd: { label: 'Smaragd', accent: '#34d399', glass: 55, radius: 50, font: 'klassisch' },
  bordeaux: { label: 'Bordeaux', accent: '#e8a0b4', glass: 45, radius: 40, font: 'elegant' },
  platin: { label: 'Platin', accent: '#d9dee8', glass: 70, radius: 30, font: 'modern' },
};
/** Schriftpaare: Überschrift / Text. */
const FONTS = {
  klassisch: { label: 'Klassisch (Cormorant + Inter)' },
  modern: { label: 'Modern (Inter überall)' },
  elegant: { label: 'Elegant (Cormorant kursiv)' },
};

const url = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^(https?:\/\/[^\s]+|\/[^\s]*|#[^\s]*|mailto:[^\s]+)$/i.test(v), 'Bitte eine Adresse mit https:// (oder /pfad) angeben.');
const day = z.string().trim().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Datum als JJJJ-MM-TT.');

const BANNER_STYLES = ['edel', 'dezent', 'hinweis', 'dringend', 'feierlich'];
/** Personengruppen für Menü und Dashboard-Start: Mandanten, Team (ohne Board), Board of Partners. */
const PROFILES = ['mandant', 'team', 'board'];
const viewKey = z.string().regex(/^[a-z][a-z-]{1,39}$/);
const navProfile = z.object({ order: z.array(viewKey).max(80).default([]), hidden: z.array(viewKey).max(80).default([]), labels: z.record(viewKey, z.string().trim().max(40)).default({}) });
const NAV_EMPTY = { order: [], hidden: [], labels: {} };
/** Bausteine der Dashboard-Startseite (Kennzahlen und Kästen); Mandanten haben eigene. */
const START_BLOCKS = ['kpi-requests', 'kpi-work', 'kpi-deadline', 'kpi-mail', 'kpi-cases', 'kpi-next', 'kpi-invoices', 'attention', 'requests', 'events', 'recent', 'pinboard', 'todo', 'duty', 'absence'];
const startProfile = z.object({ order: z.array(z.enum(START_BLOCKS)).max(START_BLOCKS.length).default([]), hidden: z.array(z.enum(START_BLOCKS)).max(START_BLOCKS.length).default([]) });
const START_EMPTY = { order: [], hidden: [] };
const statusDef = z.object({ label: z.string().trim().min(2).max(30), color: z.enum(['amber', 'sky', 'emerald', 'gold', 'red', 'slate']) });

const SPECS = {
  banner: {
    perm: 'site.edit',
    label: 'Banner',
    schema: z.object({
      enabled: z.boolean(),
      title: z.string().trim().max(80).default(''), // fette Zeile vorne (Schrift der Überschriften)
      text: z.string().trim().max(240),
      tone: z.enum(['gold', 'sky', 'amber', 'red', 'green', 'glass', 'night']),
      style: z.enum(BANNER_STYLES).default('edel'), // Aufmachung: edel, dezent, hinweis, dringend, feierlich
      // Weitere Meldungen, die sich mit der ersten abwechseln (bis zu drei insgesamt)
      slides: z.array(z.object({ title: z.string().trim().max(80).default(''), text: z.string().trim().min(1).max(240), icon: z.string().trim().max(8).default(''), link: url, linkLabel: z.string().trim().max(40).default('') })).max(2).default([]),
      icon: z.string().trim().max(8).default(''), // Emoji vor dem Text, z. B. 🎃
      countdown: z.boolean().default(false), // Countdown bis zum Ende (Datum „bis“)
      link: url,
      linkLabel: z.string().trim().max(40),
      from: day,
      to: day,
      audience: z.array(z.enum(['public', 'mandant', 'staff'])).max(3),
      dismissible: z.boolean(),
    }),
    defaults: { enabled: false, title: '', text: '', tone: 'gold', style: 'edel', slides: [], icon: '', countdown: false, link: '', linkLabel: '', from: '', to: '', audience: ['public', 'mandant', 'staff'], dismissible: true },
  },
  style: {
    perm: 'site.edit',
    label: 'Stil & Saison',
    schema: z.object({
      design: z.enum(['ruhig', 'klassisch']).optional(), // „Ruhig“ (Standard seit 11/2026) oder das bisherige Design „Klassisch“
      preset: z.enum(Object.keys(PRESETS).concat('eigen')),
      accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB.'),
      glass: z.number().int().min(0).max(100),
      radius: z.number().int().min(0).max(100),
      font: z.enum(Object.keys(FONTS)),
      motion: z.enum(['voll', 'normal', 'ruhig']),
      season: z.enum(['auto', 'aus', ...Object.keys(require('../domain/promotions').SEASONS)]),
      seasonDash: z.boolean(),
    }),
    defaults: { design: 'ruhig', preset: 'gold', accent: '#c9a45c', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'auto', seasonDash: true },
  },
  numbering: {
    perm: 'settings.edit',
    label: 'Aktenzeichen',
    schema: z.object({
      pattern: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .refine((v) => (v.match(/\{NR\}/g) || []).length === 1, 'Das Muster braucht genau einmal {NR} (die laufende Nummer).')
        .refine((v) => /^([A-Za-z0-9/._-]|\{(JJJJ|JJ|MM|NR|BEREICH|KUERZEL)\})+$/.test(v), 'Erlaubt sind Buchstaben, Ziffern, - / . _ und die Platzhalter {JJJJ} {JJ} {MM} {NR} {BEREICH} {KUERZEL}.'),
      digits: z.number().int().min(2).max(6),
    }),
    defaults: { pattern: 'PS-{JJJJ}-{NR}', digits: 4 },
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
      // Aktuelles: automatische Meldungen aus Personalprotokoll und Stellen (domain/news.js)
      news: z.object({ hires: z.boolean(), promotions: z.boolean(), positions: z.boolean() }).default({ hires: true, promotions: true, positions: true }),
      start: startSchema,
    }),
    defaults: { order: SECTION_IDS, hidden: [], faq: null, links: [], contactEmail: '', kpis: { closed: true, success: true, rating: true }, news: { hires: true, promotions: true, positions: true }, start: START_DEFAULTS },
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
  // Menü des Dashboards je Personengruppe: Reihenfolge, Ausblenden, eigene Namen; dazu eigene Links
  nav: {
    perm: 'site.edit',
    label: 'Navigation',
    schema: z.object({
      profiles: z.object({ mandant: navProfile, team: navProfile, board: navProfile }),
      links: z
        .array(z.object({ label: z.string().trim().min(1).max(40), url: url.refine((v) => v !== '', 'Adresse fehlt.'), audience: z.array(z.enum(PROFILES)).min(1).max(3) }))
        .max(8),
    }),
    defaults: { profiles: { mandant: NAV_EMPTY, team: NAV_EMPTY, board: NAV_EMPTY }, links: [] },
  },
  // Startseite des Dashboards je Personengruppe: Reihenfolge und Ausblenden der Kacheln und Kästen
  start: {
    perm: 'site.edit',
    label: 'Dashboard-Start',
    schema: z.object({ profiles: z.object({ mandant: startProfile, team: startProfile, board: startProfile }) }),
    defaults: { profiles: { mandant: START_EMPTY, team: START_EMPTY, board: START_EMPTY } },
  },
  // Aussehen der Discord-Meldungen je Ereignis: Farbe, Titel (mit {titel}), ausgeblendete Felder; Fußzeile für alle
  discordLook: {
    perm: 'discord.edit',
    label: 'Discord-Meldungen',
    schema: z.object({
      events: z.record(
        z.string().regex(/^[a-z]+\.[a-z]+$/),
        z.object({ color: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'Farbe als #RRGGBB.').default(''), title: z.string().trim().max(120).default(''), hide: z.array(z.string().trim().min(1).max(80)).max(25).default([]) })
      ),
      footer: z.string().trim().max(120),
    }),
    defaults: { events: {}, footer: '' },
  },
  // Tarifrechner der Website: Bündelrabatt und Prioritätszuschlag (welche Leistungen drinstehen: Honorarordnung)
  calculator: {
    perm: 'site.edit',
    label: 'Tarifrechner',
    schema: z.object({
      bundleMin: z.number().int().min(2).max(10),
      bundlePct: z.number().min(0).max(50),
      priorityPct: z.number().min(0).max(100),
      priorityLabel: z.string().trim().min(2).max(60),
      prioritySub: z.string().trim().max(120),
    }),
    defaults: { bundleMin: 3, bundlePct: 10, priorityPct: 15, priorityLabel: 'Priorisierte Bearbeitung', prioritySub: 'Vorrangige Terminierung innerhalb von 2 Stunden' },
  },
  // Namen und Farben der drei Status einer Akte (Verfahrensschritte stehen je Rechtsgebiet unter Listen)
  statuses: {
    perm: 'settings.edit',
    label: 'Status',
    schema: z.object({ offen: statusDef, in_bearbeitung: statusDef, geschlossen: statusDef }),
    defaults: { offen: { label: 'Offen', color: 'amber' }, in_bearbeitung: { label: 'In Bearbeitung', color: 'sky' }, geschlossen: { label: 'Abgeschlossen', color: 'slate' } },
  },
  // Rechnungen, Aktenauszug, Verträge: Logo-Position, Zeile unter dem Namen, Fußzeile, Unterschrift, Wasserzeichen
  documents: {
    perm: 'settings.edit',
    label: 'Dokumente',
    schema: z.object({
      logoPos: z.enum(['links', 'mitte', 'rechts']),
      tagline: z.string().trim().max(80),
      footer: z.string().trim().max(200),
      signature: z.boolean(),
      signatureStyle: z.enum(['schrift', 'klar']),
      watermark: z.string().trim().max(30),
      watermarkOn: z.array(z.enum(['invoice', 'extract', 'contract'])).max(3),
    }),
    defaults: { logoPos: 'links', tagline: 'Legal Consulting & Advocacy', footer: '', signature: true, signatureStyle: 'schrift', watermark: '', watermarkOn: [] },
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
  if (key === 'statuses') applyStatuses();
  return next;
}
/** Status-Namen auch für Discord, Ticket und Verlauf (helpers.CASE_STATUS wird überall gelesen). */
function applyStatuses() {
  try {
    const s = get('statuses');
    const CASE_STATUS = require('../core/helpers').CASE_STATUS;
    for (const k of Object.keys(CASE_STATUS)) if (s[k] && s[k].label) CASE_STATUS[k] = s[k].label;
  } catch {
    /* Standardnamen */
  }
}
setImmediate(applyStatuses);
/** Für das Zurücksetzen im Änderungsprotokoll. */
function setPublished(key, value) {
  db.prepare(
    `INSERT INTO site_config (key, published, published_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET published = excluded.published, published_at = excluded.published_at, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify({ ...SPECS[key].defaults, ...SPECS[key].schema.parse(value) }));
  if (key === 'statuses') applyStatuses();
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
  const slides = [{ title: b.title || '', text: b.text, icon: b.icon || '', link: b.link, linkLabel: b.linkLabel }, ...(b.slides || [])];
  const id = require('crypto')
    .createHash('sha1')
    .update(`${slides.map((x) => `${x.title}|${x.text}|${x.link}`).join('||')}|${b.tone}|${b.style || 'edel'}`)
    .digest('hex')
    .slice(0, 10);
  const endsAt = b.countdown && b.to ? require('../domain/promotions').berlinEndOfDay(b.to) : null;
  return { id, title: b.title || '', text: b.text, tone: b.tone, style: b.style || 'edel', icon: b.icon || '', endsAt, link: b.link, linkLabel: b.linkLabel, dismissible: b.dismissible, slides };
}
/** Aktionsbanner: kündigt eine laufende Rabattaktion mit Countdown an (für alle außer der Kanzlei selbst). */
function promoBanner(user, promo) {
  if (!promo || !promo.announce) return null;
  const who = audienceOf(user);
  const id = `promo-${promo.id}-${promo.to}`;
  const pct = String(promo.pct).replace('.', ',');
  const text = promo.message || `${promo.name}: ${pct} % auf alle Leistungen – automatisch auf jeder Rechnung.`;
  const sub = promo.message || `${pct} % auf alle Leistungen – wird automatisch abgezogen.`;
  return { id, promo: true, text, title: promo.name, sub, tone: 'promo', occasion: promo.occasion, icon: promo.icon, pct: promo.pct, endsAt: promo.endsAt, link: who === 'staff' ? '' : '/#rechner', linkLabel: 'Jetzt berechnen', dismissible: true };
}

/** Personengruppe für Menü und Dashboard-Start (ohne Anmeldung: keine). */
function profileOf(user) {
  if (!user) return null;
  if (user.role === 'mandant') return 'mandant';
  return require('../core/helpers').isBoard(user) ? 'board' : 'team';
}

/** Beschriftungen, wie sie die Oberfläche braucht. */
function labelsPayload(source = get('labels')) {
  return { terms: source.terms, hints: source.hints };
}

/** Alles, was Website und Dashboard beim Start brauchen (öffentlich, nach Person gefiltert). */
function publicPayload(user, { draft = false } = {}) {
  const pick = (k) => (draft ? getForEdit(k) : get(k));
  const promo = require('../domain/promotions').publicCurrent();
  const style = pick('style');
  // Menü und Dashboard-Start: nur die eigene Personengruppe; Tarifrechner und Dokumente für alle
  const prof = profileOf(user);
  const nav = pick('nav');
  const navMine = prof ? { ...nav.profiles[prof], links: nav.links.filter((l) => l.audience.includes(prof)) } : null;
  const startMine = prof ? pick('start').profiles[prof] : null;
  return {
    banner: activeBanner(user, pick('banner')),
    promo,
    promoBanner: promoBanner(user, promo),
    home: pick('home'),
    labels: labelsPayload(pick('labels')),
    style,
    season: require('../domain/promotions').season(style.season),
    nav: navMine,
    start: startMine,
    calculator: pick('calculator'),
    statuses: user ? pick('statuses') : null,
    documents: pick('documents'),
    draft,
  };
}

module.exports = { START_SECTIONS, START_IDS, startOrder, START_DEFAULTS, LAWYER_MODES, HERO_SECOND, BANNER_STYLES, PROFILES, START_BLOCKS, profileOf, PRESETS, FONTS, SPECS, KEYS, SECTIONS, SECTION_IDS, TERMS, MESSAGE_KEYS, get, getDraft, hasDraft, getForEdit, saveDraft, discardDraft, publish, setPublished, activeBanner, labelsPayload, publicPayload };
