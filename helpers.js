'use strict';
const { z } = require('zod');

const STEPS = ['Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung'];
const CASE_STATUS = { offen: 'Offen', in_bearbeitung: 'In Bearbeitung', geschlossen: 'Geschlossen' };
const AREAS = ['strafrecht', 'zivilrecht', 'verfassungsrecht', 'vertragsrecht', 'sonstiges'];
const URGENCIES = ['normal', 'eilig', 'notfall'];
const EVENT_TYPES = { mandant: 'Mandantengespräch', gericht: 'Gerichtstermin', frist: 'Frist', intern: 'Intern' };
const FEE_CATEGORIES = ['rechtsberatung', 'strafrecht', 'notfall', 'gericht', 'vertraege'];
const DUTY_STATUS = { dienst: 'Im Dienst', gericht: 'Im Gericht', pause: 'Pause', off: 'Außer Dienst' };
const APPLICATION_STATUS = {
  eingegangen: 'Eingegangen',
  in_pruefung: 'In Prüfung',
  gespraech: 'Einladung zum Gespräch',
  angenommen: 'Angenommen',
  abgelehnt: 'Abgelehnt',
};

// Deutsche Feldnamen für Validierungsfehler
const FIELD_LABELS = {
  displayName: 'Name',
  name: 'Name',
  email: 'E-Mail-Adresse',
  password: 'Passwort',
  newPassword: 'Neues Passwort',
  currentPassword: 'Aktuelles Passwort',
  phone: 'Telefon',
  title: 'Titel',
  area: 'Rechtsgebiet',
  urgency: 'Dringlichkeit',
  description: 'Beschreibung',
  clientEmail: 'E-Mail des Mandanten',
  clientName: 'Mandant',
  clientPhone: 'Telefon des Mandanten',
  clientContact: 'Kontakt',
  opponent: 'Gegenpartei',
  courtRef: 'Gerichtsaktenzeichen',
  publicNote: 'Statushinweis',
  status: 'Status',
  step: 'Verfahrensstand',
  body: 'Text',
  subject: 'Betreff',
  recipientId: 'Empfänger',
  startsAt: 'Beginn',
  endsAt: 'Ende',
  location: 'Ort',
  note: 'Notiz',
  type: 'Art',
  roleTitle: 'Rang / Titel',
  initials: 'Initialen',
  role: 'Rolle',
  rank: 'Rang',
  items: 'Positionen',
  discountPct: 'Rabatt',
  surchargePct: 'Zuschlag',
  dueDate: 'Fälligkeitsdatum',
  price: 'Preis',
  category: 'Kategorie',
  discordWebhookUrl: 'Discord-Webhook-URL',
  caseNumber: 'Aktenzeichen',
  pin: 'Aktenpin',
  age: 'Alter',
  discord: 'Discord-Name',
  experience: 'Erfahrung',
  motivation: 'Motivation',
  availability: 'Verfügbarkeit',
  positionId: 'Stelle',
  rating: 'Bewertung',
  requirements: 'Anforderungen',
  interviewAt: 'Gesprächstermin',
  startedAt: 'Dienstbeginn',
  endedAt: 'Dienstende',
  number: 'Bewerbungsnummer',
  code: 'Zugangscode',
  accept: 'Bestätigung',
  input: 'FiveNet-Adresse',
  docType: 'Dokumentart',
  docDate: 'Erstellungsdatum',
  docAuthor: 'Verfasser / Behörde',
  summary: 'Kurzinhalt',
  viewedAs: 'FiveNet-Charakter',
  attest: 'Bestätigung der Einsicht',
  assignedTo: 'Zuständig',
  caseId: 'Akte',
  done: 'Erledigt',
  fivenetUrl: 'FiveNet-Adresse',
  contentText: 'Inhalt aus FiveNet',
  urls: 'Bilder',
};

// Checklisten-Vorlagen je Rechtsgebiet (werden auf Wunsch als Aufgaben in eine Akte übernommen).
const CHECKLISTS = {
  strafrecht: [
    'Mandantengespräch führen und Sachverhalt aufnehmen',
    'Vollmacht / Honorarvereinbarung erstellen',
    'Akteneinsicht: Polizeibericht aus FiveNet verknüpfen',
    'Beweismittel sichten und sichern',
    'Verteidigungsstrategie festlegen',
    'Hauptverhandlung vorbereiten',
  ],
  zivilrecht: [
    'Mandantengespräch führen und Unterlagen anfordern',
    'Honorarvereinbarung erstellen',
    'Anspruch prüfen',
    'Schreiben an die Gegenseite aufsetzen',
    'Antwortfrist der Gegenseite im Kalender eintragen',
    'Klage oder Vergleich vorbereiten',
  ],
  vertragsrecht: [
    'Anforderungen des Mandanten aufnehmen',
    'Honorarvereinbarung erstellen',
    'Vertragsentwurf erstellen',
    'Entwurf mit dem Mandanten abstimmen',
    'Unterzeichnung organisieren',
    'Unterzeichneten Vertrag ablegen (FiveNet-Dokument oder Anhang)',
  ],
  verfassungsrecht: [
    'Mandantengespräch führen',
    'Honorarvereinbarung erstellen',
    'Zulässigkeit und Fristen prüfen',
    'Schriftsatz entwerfen',
    'Schriftsatz bei Gericht einreichen',
    'Mündliche Verhandlung vorbereiten',
  ],
  sonstiges: ['Mandantengespräch führen', 'Honorarvereinbarung erstellen', 'Nächste Schritte festlegen'],
};

/** Höchstzahl an Bildanhängen pro Akte (Beweismittel inkl. aus FiveNet übernommener Bilder). */
const MAX_ATTACHMENTS_PER_CASE = 40;

/** Express 4 fängt Fehler aus async-Handlern nicht selbst ab. */
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Validiert req.body; bei Fehlern wird direkt mit 400 geantwortet und null zurückgegeben. */
function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((i) => FIELD_LABELS[i.path[0]] || i.path[0]).filter(Boolean))];
  res.status(400).json({
    error: fields.length ? `Bitte prüfen Sie folgende Angaben: ${fields.join(', ')}.` : 'Ungültige Angaben.',
  });
  return null;
}

function idParam(req, name = 'id') {
  const n = Number(req.params[name]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Ungültiges Datum');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optText = (max) => z.string().trim().max(max).optional();

/** Kürzt Text für Vorschauen und Discord-Nachrichten. */
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function deriveInitials(name) {
  const cleaned = String(name).replace(/\b(Dr|Prof|iur|med|jur|rer|nat)\.\s*/gi, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + '.' + words[words.length - 1][0] + '.').toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return '??';
}

/* Ränge der Kanzlei: Board of Partners und Associate Attorneys (keine weiteren). */
const BOARD_RANKS = ['Founding Partner', 'Equity Partner', 'Partner'];
const ASSOCIATE_RANKS = ['Senior Associate', 'Associate', 'Junior Associate'];
const RANKS = [...BOARD_RANKS, ...ASSOCIATE_RANKS];
/** Leer (kein Rang) oder einer der Ränge. */
const rankField = z.union([z.enum(RANKS), z.literal('')]);
/**
 * Gehört zum Board of Partners? Board of Partners und Kanzleileitung sind dasselbe:
 * die Dashboard-Rolle „Board of Partners“ (admin) oder ein Partner-Rang.
 */
const isBoard = (u) => !!u && (u.role === 'admin' || (u.role === 'anwalt' && BOARD_RANKS.includes(u.rank)));
/** SQL-Sortierung nach Rang (Founding Partner zuerst … Junior Associate, dann ohne Rang). */
const RANK_ORDER_SQL = (col = 'rank') => `CASE ${col} ${RANKS.map((r, i) => `WHEN '${r}' THEN ${i}`).join(' ')} ELSE ${RANKS.length} END`;

module.exports = {
  BOARD_RANKS,
  ASSOCIATE_RANKS,
  RANKS,
  rankField,
  isBoard,
  RANK_ORDER_SQL,
  STEPS,
  CASE_STATUS,
  AREAS,
  URGENCIES,
  EVENT_TYPES,
  FEE_CATEGORIES,
  DUTY_STATUS,
  APPLICATION_STATUS,
  CHECKLISTS,
  MAX_ATTACHMENTS_PER_CASE,
  wrap,
  parseBody,
  idParam,
  isoDateTime,
  dateOnly,
  optText,
  truncate,
  deriveInitials,
};
