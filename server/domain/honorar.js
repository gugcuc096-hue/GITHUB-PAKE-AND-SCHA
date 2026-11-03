'use strict';
/*
 * Honorarrechner auf dem Server: Pakete, Rang-Faktoren, Angebote (Code HON-1234) und die Honorarvereinbarung in der Akte.
 * Gerechnet wird mit demselben Kern wie im Browser (public/js/honorar-calc.js) – der Server rechnet jedes Angebot
 * selbst nach und übernimmt keine Beträge aus dem Browser.
 */
const crypto = require('crypto');
const { db, getSetting, setSetting } = require('../db/db');
const { feeRow } = require('../db/models');
const H = require('../../public/js/honorar-calc');
const billing = require('./billing');

const json = (text, fallback) => {
  try {
    const v = JSON.parse(text || '');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
};

/* ---------------------------------------------------------------- Pakete */
function packageRow(p) {
  return { id: p.id, area: p.area || '', name: p.name, description: p.description || '', feeIds: json(p.fee_ids, []).map(Number), price: p.price, active: !!p.active, sortOrder: p.sort_order };
}
function packages({ activeOnly = false } = {}) {
  return db
    .prepare(`SELECT * FROM fee_packages ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order ASC, id ASC`)
    .all()
    .map(packageRow);
}

/* ---------------------------------------------------------------- Rang-Faktoren */
/** { Rang: Faktor } – z. B. Founding Partner 1,3; Junior Associate 0,9. Fehlt ein Rang, gilt 1. */
function rankFactors() {
  const v = json(getSetting('honorar_rank_factors', '{}'), {});
  const out = {};
  for (const [k, f] of Object.entries(v)) if (Number(f) > 0 && Number(f) !== 1) out[k] = Math.round(Number(f) * 100) / 100;
  return out;
}
function setRankFactors(map) {
  setSetting('honorar_rank_factors', JSON.stringify(map || {}));
  return rankFactors();
}
/** Wunschanwalt (sichtbare Teamkarte) → { id, name, rank, factor }; ohne → Standardsatz. */
function lawyerFactor(teamMemberId) {
  if (!teamMemberId) return { factor: 1, label: '' };
  const t = db.prepare('SELECT id, name, role_title FROM team_members WHERE id = ? AND visible = 1').get(teamMemberId);
  if (!t) return { factor: 1, label: '' };
  const f = rankFactors()[t.role_title] || 1;
  return { id: t.id, name: t.name, rank: t.role_title, factor: f, label: `${t.name} (${t.role_title})` };
}

/* ---------------------------------------------------------------- Öffentliche Honorarordnung */
/** Leistungen für Website/Rechner: nur aktive Kategorien, mit Preismodell. */
function publicFees() {
  const cats = billing.categories({ activeOnly: true });
  const on = new Set(cats.map((c) => c.key));
  const fees = db
    .prepare('SELECT * FROM fees WHERE active = 1 ORDER BY sort_order ASC, id ASC')
    .all()
    .filter((f) => on.has(f.category))
    .map(feeRow);
  return { fees, categories: cats.map(({ key, name }) => ({ key, name })) };
}

/* ---------------------------------------------------------------- Angebote */
const pickSchemaShape = (z) =>
  z.object({
    area: z.string().trim().max(40).optional(),
    picks: z
      .array(
        z.object({
          id: z.number().int().positive(),
          qty: z.number().int().min(1).max(999).optional(),
          value: z.number().min(0).max(1_000_000_000).optional(),
          surcharges: z.array(z.string().trim().max(60)).max(10).optional(),
        })
      )
      .max(40)
      .default([]),
    packageId: z.number().int().positive().nullable().optional(),
    teamMemberId: z.number().int().positive().nullable().optional(),
    priority: z.boolean().optional(),
  });

/** Angebot nachrechnen – Preise immer aus der Datenbank. */
function quoteFor(sel) {
  const { fees } = publicFees();
  const calcFees = fees.filter((f) => f.inCalculator);
  const calc = require('../web/siteConfig').get('calculator');
  const promo = require('./promotions').publicCurrent();
  const lawyer = lawyerFactor(sel.teamMemberId);
  const q = H.quote({
    fees: calcFees,
    packages: packages({ activeOnly: true }),
    picks: sel.picks || [],
    packageId: sel.packageId || null,
    factor: lawyer.factor,
    factorLabel: lawyer.label,
    calc,
    priority: !!sel.priority,
    promo,
  });
  return { quote: q, lawyer };
}

function newCode() {
  for (let i = 0; i < 40; i++) {
    const digits = i < 30 ? 4 : 6;
    const code = `HON-${String(crypto.randomInt(10 ** (digits - 1), 10 ** digits))}`;
    if (!db.prepare('SELECT 1 FROM fee_offers WHERE code = ?').get(code)) return code;
  }
  return `HON-${Date.now().toString().slice(-8)}`;
}

/** Angebot speichern → Code (HON-4821). */
function createOffer(sel) {
  const { quote, lawyer } = quoteFor(sel);
  if (!quote.positions.length) return { error: 'Bitte mindestens eine Leistung wählen.' };
  const code = newCode();
  db.prepare('INSERT INTO fee_offers (code, area, team_member_id, selection, quote, total_low, total_high) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    code,
    sel.area || '',
    lawyer.id || null,
    JSON.stringify({ area: sel.area || '', picks: sel.picks || [], packageId: sel.packageId || null, teamMemberId: lawyer.id || null, priority: !!sel.priority }),
    JSON.stringify(quote),
    quote.totalLow,
    quote.totalHigh
  );
  return { code, quote, lawyer: lawyer.id ? { id: lawyer.id, name: lawyer.name, rank: lawyer.rank } : null };
}

const normCode = (code) => {
  const m = String(code || '').trim().toUpperCase().match(/^(?:HON[-\s]?)?(\d{4,8})$/);
  return m ? `HON-${m[1]}` : null;
};
function offerByCode(code) {
  const c = normCode(code);
  const o = c && db.prepare('SELECT * FROM fee_offers WHERE code = ?').get(c);
  if (!o) return null;
  return { code: o.code, area: o.area, selection: json(o.selection, {}), quote: json(o.quote, {}), totalLow: o.total_low, totalHigh: o.total_high, caseId: o.case_id, createdAt: o.created_at };
}

/* ---------------------------------------------------------------- Honorarvereinbarung in der Akte */
function agreementRow(a) {
  if (!a) return null;
  const quote = json(a.quote, {});
  return {
    id: a.id,
    offerCode: a.offer_code,
    quote,
    createdBy: a.created_by_name,
    createdAt: a.created_at,
    hasSuccess: Array.isArray(quote.success) && quote.success.length > 0,
    successValue: a.success_value,
    successAmount: a.success_amount,
    successInvoiceId: a.success_invoice_id,
    settledAt: a.settled_at,
  };
}
const agreementFor = (caseId) => agreementRow(db.prepare('SELECT * FROM case_fee_agreements WHERE case_id = ?').get(caseId));

/** Angebot (Code) als Honorarvereinbarung an die Akte hängen – ersetzt eine bisherige, solange nichts abgerechnet ist. */
function attachOffer(caseId, code, user) {
  const o = offerByCode(code);
  if (!o) return { status: 404, error: 'Kein Angebot mit diesem Code gefunden.' };
  const before = db.prepare('SELECT * FROM case_fee_agreements WHERE case_id = ?').get(caseId);
  if (before && before.settled_at) return { status: 409, error: 'Das Erfolgshonorar dieser Akte ist schon abgerechnet.' };
  db.prepare(
    `INSERT INTO case_fee_agreements (case_id, offer_code, quote, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET offer_code = excluded.offer_code, quote = excluded.quote, created_by = excluded.created_by,
       created_by_name = excluded.created_by_name, created_at = datetime('now')`
  ).run(caseId, o.code, JSON.stringify(o.quote), user ? user.id : null, user ? user.display_name : 'Website');
  db.prepare('UPDATE fee_offers SET case_id = ? WHERE code = ?').run(caseId, o.code);
  return { agreement: agreementFor(caseId), offer: o };
}

/** Positionen für die Rechnung (ohne Erfolgsanteil): Spanne → unterer Betrag, im Generator anpassbar. */
function invoiceItems(agreement) {
  const q = agreement && agreement.quote;
  if (!q || !Array.isArray(q.positions)) return [];
  const items = q.positions
    .filter((p) => p.low > 0 || p.high > 0)
    .map((p) => ({
      description: `${p.name}${p.high > p.low ? ` (Spanne ${H.range(p.low, p.high)})` : ''}`.slice(0, 200),
      quantity: 1,
      unitPrice: Math.round(p.low),
    }));
  if (q.priority && q.priority.low) items.push({ description: `${q.priority.name} ${H.pctText(q.priority.pct)}`.slice(0, 200), quantity: 1, unitPrice: Math.round(q.priority.low) });
  return items;
}

/** Rechenweg des Angebots als Text (Rechnungsnotiz, Akte). */
function rechenweg(q) {
  return (q && Array.isArray(q.steps) ? q.steps : []).join('\n');
}

/* ---------------------------------------------------------------- Startausstattung (einmal) */
/*
 * Einmalig: Rechtsgebiete, Inhalte und Zuschläge für die Standard-Leistungen, dazu Leistungen mit den neuen Preismodellen
 * (Zivilklage mit Erfolgshonorar, Forderung mit Grundgebühr + Erfolgsanteil, Stundenhonorar, Staffel) und zwei Pakete.
 * Alles danach im Dashboard änderbar (Honorarordnung); bereits gepflegte Angaben bleiben unangetastet.
 */
const SEED_AREAS = {
  'Strafrechtliche Vertretung': ['strafrecht'],
  'U-Haft-Vertretung vor Ort': ['strafrecht'],
  'Akteneinsicht & Strafantragsprüfung': ['strafrecht'],
  'Verfassungsbeschwerde / Grundsatzverfahren': ['verfassungsrecht'],
  'Vertragsentwurf (Standard)': ['vertragsrecht'],
  'Vertragsprüfung & Überarbeitung': ['vertragsrecht'],
};
const SEED_EXTRA = {
  'Strafrechtliche Vertretung': {
    includes: ['Akteneinsicht und Prüfung der Vorwürfe', 'Begleitung zu Vernehmungen', 'Schriftverkehr mit Staatsanwaltschaft und Gericht'],
    surcharges: [{ name: 'Eilzuschlag (binnen 2 Stunden)', pct: 25 }, { name: 'Nacht / Wochenende', amount: 15000 }],
  },
  'Vertretung Hauptverhandlung (alle Gerichte)': {
    config: { priceMax: 150000 },
    includes: ['Vorbereitung der Verhandlung', 'Plädoyer, Beweisanträge, Zeugenbefragung', 'Nachbesprechung des Urteils'],
    surcharges: [{ name: 'Zweite Instanz', pct: 50 }],
  },
  'U-Haft-Vertretung vor Ort': { surcharges: [{ name: 'Nacht / Wochenende', amount: 15000 }] },
  'Vertragsentwurf (Standard)': { includes: ['Entwurf nach Ihren Vorgaben', 'eine Überarbeitungsrunde', 'Unterschriftsfertige Fassung'] },
};
const SEED_NEW = [
  {
    category: 'gericht',
    name: 'Zivilklage auf Schadensersatz (Erfolgshonorar)',
    description: 'Wir klagen Ihren Schaden ein – Sie zahlen nur, wenn wir gewinnen: ein Anteil am erstrittenen Betrag.',
    areas: ['zivilrecht'],
    model: 'erfolg',
    config: { pct: 20, minFee: 10000, cap: 300000, valueLabel: 'Erwarteter Schaden', valueMin: 10000, valueMax: 2000000, valueStep: 10000, valueDefault: 150000 },
    includes: ['Prüfung der Ansprüche und Beweise', 'Klageschrift und Vertretung vor Gericht', 'Durchsetzung des Urteils'],
  },
  {
    category: 'gericht',
    name: 'Forderung durchsetzen (Grundgebühr + Erfolgsanteil)',
    description: 'Mahnung, Klage und Vollstreckung: eine kleine Grundgebühr vorab, der Rest nur bei Erfolg.',
    areas: ['zivilrecht', 'vertragsrecht'],
    model: 'grund_erfolg',
    config: { base: 15000, pct: 10, minFee: 5000, cap: 150000, valueLabel: 'Offene Forderung', valueMin: 5000, valueMax: 1000000, valueStep: 5000, valueDefault: 80000 },
    includes: ['Außergerichtliche Mahnung', 'Klage, falls nötig', 'Zwangsvollstreckung'],
  },
  {
    category: 'gericht',
    name: 'Zivilprozess nach Streitwert',
    description: 'Vertretung im Zivilprozess – das Honorar richtet sich nach der Höhe des Streitwerts.',
    areas: ['zivilrecht'],
    model: 'staffel',
    config: { valueLabel: 'Streitwert', valueMin: 10000, valueMax: 2000000, valueStep: 10000, valueDefault: 150000, tiers: [{ upTo: 50000, price: 20000 }, { upTo: 200000, price: 40000 }, { upTo: 1000000, price: 80000 }, { upTo: 0, price: 120000 }] },
  },
  {
    category: 'vertraege',
    name: 'Vertragsverhandlung (je Stunde)',
    description: 'Wir verhandeln für Sie mit der Gegenseite – abgerechnet nach Stunden.',
    areas: ['vertragsrecht'],
    model: 'einheit',
    price: 8000,
    config: { unit: 'Stunde', priceMax: 12000, unitMax: 20 },
  },
];
function seedDefaults() {
  if (getSetting('seeded_honorar')) return;
  const all = db.prepare('SELECT * FROM fees').all();
  const byName = new Map(all.map((f) => [f.name, f]));
  for (const [name, areas] of Object.entries(SEED_AREAS)) {
    const f = byName.get(name);
    if (f && (f.areas === '[]' || !f.areas)) db.prepare('UPDATE fees SET areas = ? WHERE id = ?').run(JSON.stringify(areas), f.id);
  }
  for (const [name, x] of Object.entries(SEED_EXTRA)) {
    const f = byName.get(name);
    if (!f) continue;
    if (x.includes && !f.includes) db.prepare('UPDATE fees SET includes = ? WHERE id = ?').run(x.includes.join('\n'), f.id);
    if (x.surcharges && (f.surcharges === '[]' || !f.surcharges)) db.prepare('UPDATE fees SET surcharges = ? WHERE id = ?').run(JSON.stringify(x.surcharges), f.id);
    if (x.config && (f.config === '{}' || !f.config)) db.prepare('UPDATE fees SET config = ? WHERE id = ?').run(JSON.stringify(x.config), f.id);
  }
  // Neue Leistungen nur, wenn es die Kategorie gibt (sonst wären sie unsichtbar)
  const cats = new Set(billing.categories().map((c) => c.key));
  let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fees').get().m;
  for (const n of SEED_NEW) {
    if (byName.has(n.name) || !cats.has(n.category)) continue;
    db.prepare('INSERT INTO fees (category, name, description, price, in_calculator, active, sort_order, areas, model, config, includes, surcharges) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)').run(
      n.category, n.name, n.description, n.price || 0, ++order, JSON.stringify(n.areas), n.model, JSON.stringify(n.config || {}), (n.includes || []).join('\n'), '[]'
    );
  }
  // Pakete aus vorhandenen Leistungen (nur wenn alle da sind und es noch keine Pakete gibt)
  if (!db.prepare('SELECT COUNT(*) AS n FROM fee_packages').get().n) {
    const fresh = new Map(db.prepare('SELECT id, name, price FROM fees').all().map((f) => [f.name, f]));
    const PACKS = [
      ['strafrecht', 'Strafverteidigung komplett', 'Von der Festnahme bis zum Urteil – alles aus einer Hand.', ['U-Haft-Vertretung vor Ort', 'Strafrechtliche Vertretung', 'Vertretung Hauptverhandlung (alle Gerichte)'], 180000],
      ['vertragsrecht', 'Vertrag rundum', 'Entwurf und Prüfung der Gegenseite im Paket.', ['Vertragsentwurf (Standard)', 'Vertragsprüfung & Überarbeitung'], 50000],
    ];
    PACKS.forEach(([area, name, desc, names, price], i) => {
      const ids = names.map((x) => fresh.get(x)).filter(Boolean).map((f) => f.id);
      if (ids.length === names.length) db.prepare('INSERT INTO fee_packages (area, name, description, fee_ids, price, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(area, name, desc, JSON.stringify(ids), price, i + 1);
    });
  }
  setSetting('seeded_honorar', new Date().toISOString());
}

module.exports = {
  seedDefaults, H, packageRow, packages, rankFactors, setRankFactors, lawyerFactor, publicFees, pickSchemaShape, quoteFor, createOffer, offerByCode, normCode, agreementFor, attachOffer, invoiceItems, rechenweg };
