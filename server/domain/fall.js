'use strict';
/*
 * Fall-Bausteine je Rechtsgebiet: Die Akte zeigt im Reiter „Fall“ nicht überall Tathergang und Anklagepunkte, sondern das,
 * was zum Rechtsgebiet gehört:
 *  – Zivilrecht:       Streitgegenstand/Sachverhalt, Ansprüche (+ Streitwert), Anträge, Zeugen, Beweismittel, Karte (optional), Korrespondenz
 *  – Verfassungsrecht: angegriffener Akt + Verfahrensart, Zulässigkeit (Checkliste), Grundrechte/Normen mit Rechtfertigungsprüfung,
 *                      Beteiligte, Beweismittel & Anhänge
 *  – Vertragsrecht:    Vertragsgegenstand & Ziel (Modus Gestaltung/Streit), Vertragsparteien, Klauseln mit Ampel, Laufzeit & Fristen,
 *                      Entwurfsversionen, Anlagen; im Streitmodus zusätzlich Pflichtverletzung und Ansprüche
 * Dieses Schema ist die einzige Quelle: Prüfung der Eingaben (zod) und Anzeige im Dashboard (generisch) folgen daraus.
 */
const { z } = require('zod');
const { db } = require('../db/db');

const TRI = { type: 'tri', options: [['offen', 'offen'], ['ja', 'ja'], ['nein', 'nein']] };
const CHECK = { type: 'check', options: [['offen', 'offen'], ['ja', 'erfüllt'], ['nein', 'nicht erfüllt']] };

/** Feld: key, label, type (text | textarea | select | date | money | tri | check), options [[Schlüssel, Beschriftung, Farbe?]], when {Feld: Wert}, wide */
const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

/* ---------------------------------------------------------------- Einträge (Karten) */
const KINDS = {
  claim: {
    label: 'Anspruch',
    title: 'basis',
    sum: 'amount',
    chips: ['status'],
    fields: [
      f('basis', 'Anspruchsgrundlage', 'text', { required: true, placeholder: 'z. B. § 823 Abs. 1 BGB – Schadensersatz', wide: true }),
      f('claimant', 'Anspruchsteller', 'text', { placeholder: 'wer fordert' }),
      f('opponent', 'Anspruchsgegner', 'text', { placeholder: 'von wem' }),
      f('amount', 'Forderungshöhe ($)', 'money'),
      f('status', 'Stand', 'select', { options: [['geltend', 'Geltend gemacht', 'sky'], ['bestritten', 'Bestritten', 'red'], ['anerkannt', 'Anerkannt', 'emerald']], def: 'geltend' }),
      f('deadline', 'Verjährung / Frist', 'date', { hint: 'Wann verjährt der Anspruch bzw. bis wann muss er geltend gemacht werden?' }),
      f('note', 'Anmerkung', 'textarea', { wide: true }),
    ],
  },
  motion: {
    label: 'Antrag',
    title: 'text',
    chips: ['side'],
    fields: [
      f('side', 'Art', 'select', { options: [['klage', 'Klageantrag', 'sky'], ['abweisung', 'Klageabweisung', 'violet'], ['sonstig', 'Sonstiger Antrag', 'slate']], def: 'klage' }),
      f('text', 'Antrag', 'textarea', { required: true, wide: true, rows: 4, placeholder: 'z. B. Die Beklagte wird verurteilt, an den Kläger 12.500 $ zu zahlen.' }),
    ],
  },
  corr: {
    label: 'Schreiben',
    title: 'type',
    chips: ['direction', 'state'],
    fields: [
      f('type', 'Art', 'select', { options: [['abmahnung', 'Abmahnung', 'amber'], ['mahnung', 'Mahnung', 'amber'], ['fristsetzung', 'Fristsetzung', 'sky'], ['sonstig', 'Sonstiges Schreiben', 'slate']], def: 'fristsetzung' }),
      f('direction', 'Richtung', 'select', { options: [['aus', 'Ausgang', 'slate'], ['ein', 'Eingang', 'slate']], def: 'aus' }),
      f('date', 'Datum', 'date'),
      f('deadline', 'Frist bis', 'date', { hint: 'Setzt das Schreiben eine Frist? Dann hier das Datum eintragen.' }),
      f('state', 'Stand', 'select', { options: [['offen', 'Offen', 'amber'], ['erledigt', 'Beantwortet / erledigt', 'emerald'], ['fruchtlos', 'Frist fruchtlos verstrichen', 'red']], def: 'offen' }),
      f('note', 'Inhalt / Ergebnis', 'textarea', { wide: true }),
    ],
  },
  norm: {
    label: 'Grundrecht / Norm',
    title: 'norm',
    chips: ['assessment'],
    fields: [
      f('norm', 'Grundrecht / Norm', 'text', { required: true, wide: true, placeholder: 'z. B. Art. 5 – Meinungsfreiheit' }),
      f('intervention', 'Eingriff', 'textarea', { wide: true, rows: 3, placeholder: 'Worin besteht der Eingriff?' }),
      f('purpose', 'Legitimer Zweck?', 'tri', TRI),
      f('suitable', 'Geeignet?', 'tri', TRI),
      f('necessary', 'Erforderlich?', 'tri', TRI),
      f('proportional', 'Angemessen?', 'tri', TRI),
      f('reasoning', 'Begründung der Rechtfertigungsprüfung', 'textarea', { wide: true, rows: 4 }),
      f('assessment', 'Einschätzung', 'select', { options: [['offen', 'Noch offen', 'slate'], ['aussichtsreich', 'Aussichtsreich', 'emerald'], ['unsicher', 'Unsicher', 'amber'], ['aussichtslos', 'Aussichtslos', 'red']], def: 'offen' }),
    ],
  },
  participant: {
    label: 'Beteiligter',
    title: 'name',
    chips: ['role'],
    fields: [
      f('name', 'Name / Stelle', 'text', { required: true }),
      f('role', 'Rolle', 'select', { options: [['beschwerdefuehrer', 'Beschwerdeführer / Antragsteller', 'sky'], ['gegner', 'Antragsgegner / Organ', 'red'], ['aeusserung', 'Äußerungsberechtigter', 'violet'], ['vertreter', 'Verfahrensbevollmächtigter', 'emerald'], ['sonstig', 'Sonstiger Beteiligter', 'slate']], def: 'aeusserung' }),
      f('contact', 'Kontakt', 'text', { placeholder: 'Telefon, Discord, Behörde …' }),
      f('deadline', 'Äußerungsfrist', 'date'),
      f('note', 'Stellungnahme / Hinweis', 'textarea', { wide: true }),
    ],
  },
  party: {
    label: 'Vertragspartei',
    title: 'name',
    chips: ['role', 'proof'],
    fields: [
      f('name', 'Name / Firma', 'text', { required: true }),
      f('role', 'Seite', 'select', { options: [['mandant', 'Mandantenseite', 'emerald'], ['gegenseite', 'Gegenseite', 'red'], ['dritter', 'Dritter / Bürge / Garant', 'slate']], def: 'gegenseite' }),
      f('rep', 'Vertretungsbefugnis', 'text', { wide: true, placeholder: 'z. B. Geschäftsführer, einzelvertretungsberechtigt' }),
      f('proof', 'Vertretungsmacht geprüft?', 'check', CHECK),
      f('note', 'Anmerkung', 'textarea', { wide: true }),
    ],
  },
  clause: {
    label: 'Klausel',
    title: 'title',
    chips: ['topic', 'status', 'risk'],
    fields: [
      f('topic', 'Thema', 'select', { options: [['leistung', 'Leistung', 'sky'], ['preis', 'Preis', 'sky'], ['laufzeit', 'Laufzeit', 'sky'], ['haftung', 'Haftung', 'sky'], ['kuendigung', 'Kündigung', 'sky'], ['vertragsstrafe', 'Vertragsstrafe', 'sky'], ['gerichtsstand', 'Gerichtsstand', 'sky'], ['sonstig', 'Sonstiges', 'slate']], def: 'leistung' }),
      f('title', 'Eckpunkt / Klausel', 'text', { required: true, placeholder: 'z. B. Haftung auf Vorsatz und grobe Fahrlässigkeit begrenzt' }),
      f('status', 'Stand', 'select', { options: [['offen', 'Offen', 'slate'], ['verhandelt', 'Verhandelt', 'amber'], ['vereinbart', 'Vereinbart', 'emerald'], ['strittig', 'Strittig', 'red']], def: 'offen' }),
      f('risk', 'Risiko', 'select', { options: [['gruen', 'Risiko gering', 'emerald'], ['gelb', 'Risiko mittel', 'amber'], ['rot', 'Risiko hoch', 'red']], def: 'gruen', light: true }),
      f('text', 'Wortlaut / Verhandlungsstand', 'textarea', { wide: true, rows: 4 }),
    ],
  },
  version: {
    label: 'Entwurfsversion',
    title: 'note',
    numbered: true,
    fields: [
      f('date', 'Datum', 'date', { today: true }),
      f('note', 'Änderungsvermerk', 'textarea', { required: true, wide: true, rows: 3, placeholder: 'Was hat sich gegenüber der letzten Fassung geändert?' }),
    ],
  },
};

/* ---------------------------------------------------------------- Einzelangaben (je Abschnitt) */
const VALUE = f('streitwert', 'Streitwert / Schadenssumme ($)', 'money', { hint: 'Grundlage für Gebühren und Einschätzung. Die Summe der Ansprüche steht daneben als Vergleich.' });
const SUBJECT_VERF = [
  f('actType', 'Art des Akts', 'select', { options: [['gesetz', 'Gesetz'], ['verordnung', 'Verordnung'], ['massnahme', 'Behördenmaßnahme'], ['urteil', 'Urteil']] }),
  f('procedure', 'Verfahrensart', 'select', { options: [['verfassungsbeschwerde', 'Verfassungsbeschwerde', 'violet'], ['normenkontrolle', 'Normenkontrolle', 'sky'], ['organstreit', 'Organstreit', 'amber'], ['eilantrag', 'Eilantrag', 'red']] }),
  f('actTitle', 'Bezeichnung', 'text', { wide: true, placeholder: 'z. B. Versammlungsverbot vom 12.03. / Urteil des Obergerichts' }),
  f('actAuthority', 'Erlassende Stelle / Gericht', 'text'),
  f('actDate', 'Datum', 'date'),
  f('actSummary', 'Inhalt und Beschwer', 'textarea', { wide: true, rows: 4, placeholder: 'Was wird angegriffen, und worin liegt die Beschwer?' }),
];
const ADMISS = [
  f('c_befugnis', 'Beschwerdebefugnis', 'check', { ...CHECK, hint: 'Möglichkeit einer eigenen, gegenwärtigen und unmittelbaren Grundrechtsverletzung' }),
  f('c_rechtsweg', 'Rechtsweg erschöpft', 'check', { ...CHECK, hint: 'Alle ordentlichen Rechtsmittel ausgeschöpft' }),
  f('c_frist', 'Frist eingehalten', 'check', { ...CHECK, hint: 'Beschwerdefrist gewahrt' }),
  f('c_subsid', 'Subsidiarität', 'check', { ...CHECK, hint: 'Keine andere zumutbare Möglichkeit, die Verletzung zu beseitigen' }),
  f('admissNote', 'Anmerkung zur Zulässigkeit', 'textarea', { wide: true }),
];
const SUBJECT_VERTR = [
  f('mode', 'Modus', 'select', { options: [['gestaltung', 'Vertragsgestaltung', 'emerald'], ['streit', 'Vertragsstreit', 'red']], def: 'gestaltung' }),
  f('subjectText', 'Vertragsgegenstand', 'textarea', { wide: true, rows: 3, placeholder: 'Worum geht es in dem Vertrag?' }),
  f('goal', 'Ziel des Mandanten', 'textarea', { wide: true, rows: 3, placeholder: 'Was soll am Ende erreicht sein?' }),
  f('breach', 'Pflichtverletzung', 'textarea', { wide: true, rows: 3, when: { mode: 'streit' }, placeholder: 'Welche Pflicht wurde wann und wie verletzt?' }),
];
const TERM = [
  f('start', 'Beginn', 'date'),
  f('end', 'Ende', 'date'),
  f('notice', 'Kündigungsfristen', 'text', { wide: true, placeholder: 'z. B. 14 Tage zum Monatsende' }),
  f('options', 'Optionen / Verlängerung', 'textarea', { wide: true, rows: 2 }),
];

/* ---------------------------------------------------------------- Abschnitte je Rechtsgebiet */
// Schlüssel der Abschnitte = Schlüssel in der Ansicht der Akte (12-akte-ansicht.js, prefs.js)
const LAYOUT = {
  zivilrecht: {
    retitle: { tathergang: 'Streitgegenstand / Sachverhalt' },
    hide: ['charges'],
    quiet: ['karte'], // nur sichtbar, wenn es schon Orte gibt (sonst „⋯ Mehr → Karte“)
    sections: [
      { key: 'claims', title: 'Ansprüche', meta: [VALUE], item: 'claim', sumLabel: 'Summe der Ansprüche', hint: 'Je Anspruch: Grundlage, wer von wem was fordert, Stand und Verjährung.' },
      { key: 'motions', title: 'Anträge', item: 'motion', hint: 'Klageantrag bzw. Klageabweisung – so, wie sie im Schriftsatz stehen sollen.' },
      { key: 'corr', title: 'Außergerichtliche Korrespondenz', item: 'corr', hint: 'Abmahnung, Mahnung, Fristsetzung – mit Datum und Frist.' },
    ],
  },
  verfassungsrecht: {
    retitle: { evidence: 'Beweismittel & Anhänge' },
    hide: ['tathergang', 'charges', 'witnesses', 'karte'],
    sections: [
      { key: 'subject', title: 'Angegriffener Akt & Verfahren', meta: SUBJECT_VERF },
      { key: 'admiss', title: 'Zulässigkeit', checks: ADMISS.slice(0, 4), meta: [ADMISS[4]], hint: 'Vier Prüfpunkte, bevor ein Schriftsatz Sinn ergibt.' },
      { key: 'norms', title: 'Betroffene Grundrechte / Normen', item: 'norm', hint: 'Je Norm: Eingriff, Rechtfertigungsprüfung (Zweck, Geeignetheit, Erforderlichkeit, Angemessenheit) und Einschätzung.' },
      { key: 'participants', title: 'Beteiligte / Äußerungsberechtigte', item: 'participant' },
    ],
  },
  vertragsrecht: {
    retitle: { evidence: 'Anlagen' },
    hide: ['tathergang', 'charges', 'witnesses', 'karte'],
    sections: [
      { key: 'subject', title: 'Vertragsgegenstand & Ziel', meta: SUBJECT_VERTR, modeSwitch: true },
      { key: 'parties', title: 'Vertragsparteien', item: 'party', hint: 'Mit Vertretungsbefugnis – wer darf für wen unterschreiben?' },
      { key: 'clauses', title: 'Eckpunkte / Klauseln', item: 'clause', hint: 'Je Klausel: Thema, Stand der Verhandlung und Risikoampel.', ampel: true },
      { key: 'term', title: 'Laufzeit & Fristen', meta: TERM },
      { key: 'versions', title: 'Entwurfsversionen', item: 'version', hint: 'v1, v2 … mit Datum und Änderungsvermerk.' },
      { key: 'vclaims', title: 'Ansprüche aus dem Streit', meta: [VALUE], item: 'claim', sumLabel: 'Summe der Ansprüche', when: { mode: 'streit' }, hint: 'Nur im Modus „Vertragsstreit“: Ansprüche wie im Zivilrecht.' },
    ],
  },
};

const SECTION_KEYS = ['subject', 'admiss', 'claims', 'motions', 'norms', 'participants', 'parties', 'clauses', 'term', 'versions', 'vclaims', 'corr'];

const allMetaFields = (area) => (LAYOUT[area] ? LAYOUT[area].sections.flatMap((s) => [...(s.checks || []), ...(s.meta || [])]) : []);
const uniqueBy = (list) => [...new Map(list.map((x) => [x.key, x])).values()];

/* ---------------------------------------------------------------- Prüfung */
const MAXTEXT = (t, spec) => (t === 'textarea' ? (spec.rows >= 4 ? 4000 : 2000) : 200);
function fieldSchema(spec) {
  const opts = (spec.options || []).map((o) => o[0]);
  switch (spec.type) {
    case 'select':
    case 'tri':
    case 'check':
      return z.enum(opts);
    case 'date':
      return z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum wie 2026-03-14')]);
    case 'money':
      return z.union([z.null(), z.number().int().min(0).max(1_000_000_000_000)]);
    default:
      return z.string().trim().max(MAXTEXT(spec.type, spec));
  }
}
const emptyOf = (spec) => (spec.type === 'money' ? null : spec.type === 'tri' || spec.type === 'check' ? 'offen' : spec.type === 'select' ? spec.def || spec.options[0][0] : '');

function schemaFor(fields, { partial = false } = {}) {
  const shape = {};
  for (const s of fields) {
    let sch = fieldSchema(s);
    if (s.required && !['select', 'tri', 'check', 'date', 'money'].includes(s.type)) sch = sch.refine((v) => v.length > 0, `„${s.label}“ ist nötig.`);
    shape[s.key] = partial ? sch.optional() : sch.default(emptyOf(s));
  }
  return z.object(shape).strict();
}

const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const withDefaults = (fields, data) => Object.fromEntries(fields.map((s) => [s.key, data[s.key] === undefined ? emptyOf(s) : data[s.key]]));

/* ---------------------------------------------------------------- Lesen und Schreiben */
function meta(caseId, area) {
  const row = db.prepare('SELECT data FROM case_fall WHERE case_id = ?').get(caseId);
  return withDefaults(uniqueBy(allMetaFields(area)), row ? parse(row.data) : {});
}
function saveMeta(caseId, area, patch) {
  const cur = meta(caseId, area);
  const next = { ...cur, ...patch };
  db.prepare(
    `INSERT INTO case_fall (case_id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(case_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(caseId, JSON.stringify(next));
  return next;
}
const itemRow = (r) => ({ id: r.id, kind: r.kind, no: r.no, ...withDefaults(KINDS[r.kind] ? KINDS[r.kind].fields : [], parse(r.data)), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
function items(caseId) {
  const out = {};
  for (const r of db.prepare('SELECT * FROM case_items WHERE case_id = ? ORDER BY kind, no, id').all(caseId)) {
    if (!KINDS[r.kind]) continue;
    (out[r.kind] = out[r.kind] || []).push(itemRow(r));
  }
  return out;
}
const one = (caseId, id) => {
  const r = db.prepare('SELECT * FROM case_items WHERE id = ? AND case_id = ?').get(id, caseId);
  return r && KINDS[r.kind] ? itemRow(r) : null;
};
const MAX_ITEMS = 80;
function addItem(caseId, kind, data, user) {
  const n = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(no), 0) AS no FROM case_items WHERE case_id = ? AND kind = ?').get(caseId, kind);
  if (n.n >= MAX_ITEMS) throw Object.assign(new Error(`Höchstens ${MAX_ITEMS} Einträge dieser Art je Akte.`), { status: 400 });
  const info = db.prepare('INSERT INTO case_items (case_id, kind, no, data, created_by) VALUES (?, ?, ?, ?, ?)').run(caseId, kind, n.no + 1, JSON.stringify(data), (user && user.display_name) || '');
  return one(caseId, Number(info.lastInsertRowid));
}
function saveItem(caseId, id, data) {
  db.prepare("UPDATE case_items SET data = ?, updated_at = datetime('now') WHERE id = ? AND case_id = ?").run(JSON.stringify(data), id, caseId);
  return one(caseId, id);
}
const removeItem = (caseId, id) => db.prepare('DELETE FROM case_items WHERE id = ? AND case_id = ?').run(id, caseId).changes > 0;

/* ---------------------------------------------------------------- Eigene Bezeichnungen */
/*
 * Jede Vorlage lässt sich umbenennen: Reiter der Akte, Abschnitte, Bezeichnung eines Eintrags („Anspruch“) und die Felder darin.
 * Gespeichert wird nur, was vom Standard abweicht, als { 'sec.claims': 'Forderungen', … } je Rechtsgebiet (areas.labels):
 *   tab.<reiter>  ·  sec.<abschnitt>  ·  kind.<eintrag>  ·  field.<eintrag>.<feld>  ·  meta.<feld>
 */
const TABS = [['ueberblick', 'Überblick'], ['kommunikation', 'Kommunikation'], ['fall', 'Fall'], ['dokumente', 'Dokumente']];
// Abschnitte, die es in jeder Akte gibt (je nach Rechtsgebiet ausgeblendet, siehe LAYOUT.hide)
const STANDARD = [['tathergang', 'Tathergang'], ['charges', 'Anklagepunkte'], ['witnesses', 'Zeugen'], ['karte', 'Tatort-Karte'], ['evidence', 'Beweismittel & Anhänge']];
const FIELDKEY = /^(tab|sec|kind|field|meta)\.[a-z0-9_.]+$/;

const areaLabels = (area) => {
  try {
    return require('./areas').get(area)?.labels || {};
  } catch {
    return {};
  }
};
const layoutOf = (area) => LAYOUT[area] || { sections: [], retitle: {}, hide: [], quiet: [] };
const stdTitle = (area, key) => layoutOf(area).retitle?.[key] || STANDARD.find((x) => x[0] === key)[1];

/** Alles, was sich in der Vorlage eines Rechtsgebiets umbenennen lässt: Gruppen mit { id, def } (def = Standardbezeichnung). */
function catalog(area) {
  const lay = layoutOf(area);
  const groups = [];
  groups.push({ title: 'Reiter der Akte', items: TABS.map(([k, l]) => ({ id: `tab.${k}`, def: l })) });
  const sec = STANDARD.filter(([k]) => !(lay.hide || []).includes(k)).map(([k]) => ({ id: `sec.${k}`, def: stdTitle(area, k) }));
  for (const s of lay.sections) sec.push({ id: `sec.${s.key}`, def: s.title });
  groups.push({ title: 'Abschnitte im Reiter „Fall“', items: sec });
  const kinds = [...new Set(lay.sections.map((s) => s.item).filter(Boolean))];
  if (kinds.length) groups.push({ title: 'Bezeichnung eines Eintrags (Schaltfläche „+ …“)', items: kinds.map((k) => ({ id: `kind.${k}`, def: KINDS[k].label })) });
  const seen = new Set();
  for (const s of lay.sections) {
    const fields = uniqueBy([...(s.checks || []), ...(s.meta || [])]).filter((x) => !seen.has(x.key));
    if (fields.length) {
      fields.forEach((x) => seen.add(x.key));
      groups.push({ title: `Angaben: ${s.title}`, items: fields.map((x) => ({ id: `meta.${x.key}`, def: x.label })) });
    }
  }
  for (const k of kinds) groups.push({ title: `Felder: ${KINDS[k].label}`, items: KINDS[k].fields.map((x) => ({ id: `field.${k}.${x.key}`, def: x.label })) });
  return groups;
}
const catalogIds = (area) => new Set(catalog(area).flatMap((g) => g.items.map((i) => i.id)));

/** Eingaben prüfen und bereinigen: nur bekannte Schlüssel, getrimmt, leer = Standard. */
function checkLabels(area, given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw Object.assign(new Error('Ungültige Bezeichnungen.'), { status: 400 });
  const known = catalogIds(area);
  const out = {};
  for (const [id, raw] of Object.entries(given)) {
    if (!FIELDKEY.test(id) || !known.has(id)) throw Object.assign(new Error(`Diese Bezeichnung gibt es in der Vorlage nicht: ${id}`), { status: 400 });
    const v = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (v.length > 80) throw Object.assign(new Error('Bezeichnungen sind höchstens 80 Zeichen lang.'), { status: 400 });
    if (v) out[id] = v;
  }
  return out;
}

/** Eigene Bezeichnungen in den Aufbau einsetzen (verändert nichts an den Daten, nur an der Anzeige). */
function applyLabels(F, labels) {
  const L = labels || {};
  const pick = (id, def) => L[id] || def;
  F.sections = F.sections.map((s) => ({
    ...s,
    title: pick(`sec.${s.key}`, s.title),
    meta: s.meta.map((x) => ({ ...x, label: pick(`meta.${x.key}`, x.label) })),
    checks: s.checks.map((x) => ({ ...x, label: pick(`meta.${x.key}`, x.label) })),
  }));
  for (const k of Object.keys(F.kinds)) {
    F.kinds[k] = { ...F.kinds[k], label: pick(`kind.${k}`, F.kinds[k].label), fields: F.kinds[k].fields.map((x) => ({ ...x, label: pick(`field.${k}.${x.key}`, x.label) })) };
  }
  F.retitle = { ...F.retitle };
  for (const [k] of STANDARD) F.retitle[k] = pick(`sec.${k}`, F.retitle[k] || STANDARD.find((x) => x[0] === k)[1]);
  for (const [k, l] of TABS) F.retitle[`tab.${k}`] = pick(`tab.${k}`, l);
  return F;
}

/* ---------------------------------------------------------------- Beispieldaten für die Vorschau */
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const withIds = (kind, rows) => rows.map((r, i) => ({ id: -(i + 1), kind, no: i + 1, ...withDefaults(KINDS[kind].fields, r), createdBy: 'Beispiel', createdAt: '', updatedAt: '' }));
function sample(area, mode = 'gestaltung') {
  if (area === 'zivilrecht')
    return {
      meta: { streitwert: 18500 },
      items: {
        claim: withIds('claim', [
          { basis: '§ 280 BGB – Schadensersatz wegen Vertragsverletzung', claimant: 'Max Mustermann', opponent: 'Bob Beispiel', amount: 12500, status: 'bestritten', deadline: iso(90), note: 'Rechnung und Mahnung liegen vor.' },
          { basis: '§ 288 BGB – Verzugszinsen', claimant: 'Max Mustermann', opponent: 'Bob Beispiel', amount: 1200, status: 'geltend', deadline: iso(120) },
        ]),
        motion: withIds('motion', [
          { side: 'klage', text: 'Der Beklagte wird verurteilt, an den Kläger 13.700 $ nebst Zinsen zu zahlen.' },
          { side: 'abweisung', text: 'Die Widerklage wird abgewiesen.' },
        ]),
        corr: withIds('corr', [{ type: 'mahnung', direction: 'aus', date: iso(-14), deadline: iso(7), state: 'offen', note: 'Zahlungsfrist 14 Tage gesetzt.' }]),
      },
    };
  if (area === 'verfassungsrecht')
    return {
      meta: { actType: 'urteil', procedure: 'verfassungsbeschwerde', actTitle: 'Urteil des Obergerichts vom 12.03.', actAuthority: 'Obergericht San Andreas', actDate: iso(-30), actSummary: 'Das Gericht hat die Versammlung untersagt; gerügt wird die Verletzung der Versammlungsfreiheit.', c_befugnis: 'ja', c_rechtsweg: 'ja', c_frist: 'offen', c_subsid: 'offen' },
      items: {
        norm: withIds('norm', [{ norm: 'Art. 8 – Versammlungsfreiheit', intervention: 'Untersagung der Versammlung', purpose: 'ja', suitable: 'ja', necessary: 'nein', proportional: 'offen', reasoning: 'Ein milderes Mittel (Auflagen) hätte genügt.', assessment: 'aussichtsreich' }]),
        participant: withIds('participant', [{ name: 'Innenministerium', role: 'aeusserung', deadline: iso(30), note: 'Stellungnahme angefordert.' }, { name: 'Kanzlei Pake & Scha', role: 'vertreter' }]),
      },
    };
  if (area === 'vertragsrecht')
    return {
      meta: { mode, subjectText: 'Mietvertrag über ein Lagerhaus am Hafen', goal: 'Günstige Miete bei langer Laufzeit', breach: 'Miete seit zwei Monaten nicht gezahlt', start: iso(0), end: iso(365), notice: '3 Monate zum Quartalsende', options: 'Einmal um zwei Jahre verlängerbar', streitwert: 8400 },
      items: {
        party: withIds('party', [{ name: 'Hafen Immobilien GmbH', role: 'gegenseite', rep: 'Geschäftsführer, einzelvertretungsberechtigt', proof: 'ja' }, { name: 'Max Mustermann', role: 'mandant' }]),
        clause: withIds('clause', [
          { topic: 'preis', title: 'Miete 2.800 $ im Monat', status: 'vereinbart', risk: 'gruen' },
          { topic: 'haftung', title: 'Haftung auf Vorsatz und grobe Fahrlässigkeit begrenzt', status: 'strittig', risk: 'rot', text: 'Gegenseite will unbegrenzte Haftung.' },
          { topic: 'kuendigung', title: 'Kündigung nur zum Quartalsende', status: 'verhandelt', risk: 'gelb' },
        ]),
        version: withIds('version', [{ date: iso(-20), note: 'Erster Entwurf' }, { date: iso(-6), note: 'Haftung und Kündigung angepasst' }]),
        claim: withIds('claim', [{ basis: '§ 535 BGB – Mietzahlung', claimant: 'Hafen Immobilien GmbH', opponent: 'Max Mustermann', amount: 5600, status: 'geltend' }]),
      },
    };
  return { meta: {}, items: {} };
}

/* ---------------------------------------------------------------- Angaben für das Dashboard */
const publicSpec = (s) => ({ key: s.key, label: s.label, type: s.type, options: s.options || null, def: s.def, required: !!s.required, hint: s.hint || '', placeholder: s.placeholder || '', wide: !!s.wide, rows: s.rows || 0, when: s.when || null, light: !!s.light, today: !!s.today });

/**
 * Aufbau der Akte für ein Rechtsgebiet, mit den eigenen Bezeichnungen. Rechtsgebiete ohne eigene Bausteine (Strafrecht, Sonstiges,
 * eigene) bekommen nur die Bezeichnungen. opts.sample: Beispieldaten statt der Akte (Vorschau), opts.labels: noch nicht
 * gespeicherte Bezeichnungen, opts.mode: Modus der Vorschau (Vertragsrecht).
 */
function payload(c, opts = {}) {
  const layout = layoutOf(c.area);
  const smp = opts.sample ? sample(c.area, opts.mode) : null;
  const m = smp ? withDefaults(uniqueBy(allMetaFields(c.area)), smp.meta) : meta(c.id, c.area);
  const usedKinds = new Set(layout.sections.map((x) => x.item).filter(Boolean));
  const all = smp ? smp.items : items(c.id);
  const F = {
    area: c.area,
    meta: m,
    items: Object.fromEntries([...usedKinds].map((k) => [k, all[k] || []])),
    kinds: Object.fromEntries([...usedKinds].map((k) => [k, { label: KINDS[k].label, title: KINDS[k].title, sum: KINDS[k].sum || null, chips: KINDS[k].chips || [], numbered: !!KINDS[k].numbered, fields: KINDS[k].fields.map(publicSpec) }])),
    sections: layout.sections
      .filter((s) => !s.when || Object.entries(s.when).every(([k, v]) => m[k] === v))
      .map((s) => ({ key: s.key, title: s.title, hint: s.hint || '', item: s.item || null, sumLabel: s.sumLabel || '', modeSwitch: !!s.modeSwitch, ampel: !!s.ampel, meta: (s.meta || []).map(publicSpec), checks: (s.checks || []).map(publicSpec) })),
    retitle: layout.retitle || {},
    hide: layout.hide || [],
    quiet: layout.quiet || [],
  };
  return applyLabels(F, opts.labels || areaLabels(c.area));
}

module.exports = { KINDS, LAYOUT, SECTION_KEYS, TABS, STANDARD, allMetaFields, uniqueBy, schemaFor, meta, saveMeta, items, one, addItem, saveItem, removeItem, payload, withDefaults, catalog, checkLabels, applyLabels, areaLabels, sample };
