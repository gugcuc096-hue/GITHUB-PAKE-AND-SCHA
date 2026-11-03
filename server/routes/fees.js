'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db/db');
const { requireAuth } = require('../core/auth');
const { requirePerm } = require('../core/permissions');
const { wrap, parseBody, idParam } = require('../core/helpers');
const billing = require('../domain/billing');
const honorar = require('../domain/honorar');
const { feeRow, logActivity } = require('../db/models');
const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;

const ORDER = 'ORDER BY sort_order ASC, id ASC';

/* Öffentlich: Honorarordnung für Startseite, Tarifrechner und Rechnungs-Generator */
const publicRouter = express.Router();
publicRouter.get('/', (req, res) => {
  // ausgeblendete Kategorien verschwinden samt ihren Leistungen (Website, Tarifrechner, Rechnungs-Generator);
  // dazu Pakete und Rang-Faktoren für den Honorarrechner
  res.json({ ...honorar.publicFees(), packages: honorar.packages({ activeOnly: true }), rankFactors: honorar.rankFactors() });
});

/* Board of Partners: Honorarordnung pflegen */
const adminRouter = express.Router();
adminRouter.use(requireAuth, requirePerm('fees.edit'));

const amount = z.number().min(0).max(1_000_000_000);
const configSchema = z
  .object({
    priceMax: amount.optional(), // Spanne: bis … (Festpreis, je Einheit)
    unit: z.string().trim().max(30).optional(), // je Einheit: „Stunde“, „Termin“ …
    unitMax: z.number().int().min(1).max(999).optional(),
    pct: z.number().min(0).max(100).optional(), // Prozent / Erfolgsanteil
    minFee: amount.optional(), // Mindesthonorar
    cap: amount.optional(), // Deckel
    base: amount.optional(), // Grundgebühr (Grundgebühr + Erfolgsanteil)
    baseMax: amount.optional(),
    tiers: z.array(z.object({ upTo: amount, price: amount })).max(12).optional(), // Staffel nach Streitwert
    valueLabel: z.string().trim().max(40).optional(), // „Streitwert“, „Erwarteter Schaden“ …
    valueMin: amount.optional(),
    valueMax: amount.optional(),
    valueStep: z.number().min(1).max(1_000_000).optional(),
    valueDefault: amount.optional(),
  })
  .strip();
const surchargeSchema = z
  .object({ name: z.string().trim().min(2).max(60), pct: z.number().min(0).max(500).optional(), amount: amount.optional() })
  .refine((s) => (s.pct || 0) > 0 || (s.amount || 0) > 0, { message: 'Zuschlag braucht Prozent oder Betrag.' });
const schema = z.object({
  category: billing.categoryKeySchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().int().min(0).max(1_000_000_000),
  inCalculator: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  areas: z.array(z.string().trim().min(2).max(40)).max(20).optional(),
  model: z.enum(Object.keys(honorar.H.MODELS)).optional(),
  config: configSchema.optional(),
  includes: z.array(z.string().trim().min(1).max(160)).max(15).optional(),
  surcharges: z.array(surchargeSchema).max(8).optional(),
});
const toJson = (v) => JSON.stringify(v);

function load(id) {
  return db.prepare('SELECT * FROM fees WHERE id = ?').get(id) || null;
}

adminRouter.get('/', (req, res) => {
  res.json({
    fees: db.prepare(`SELECT * FROM fees ${ORDER}`).all().map(feeRow),
    categories: billing.categories(),
    packages: honorar.packages(),
    rankFactors: honorar.rankFactors(),
    ranks: require('../core/helpers').RANKS,
    models: honorar.H.MODELS,
  });
});

/* Rang-Faktoren: { Rang: Faktor } – 1 = Standardsatz */
adminRouter.put(
  '/rank-factors',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ factors: z.record(z.string().trim().min(2).max(60), z.number().min(0.3).max(5)) }), req, res);
    if (!d) return;
    const ranks = new Set(require('../core/helpers').RANKS);
    const clean = Object.fromEntries(Object.entries(d.factors).filter(([k]) => ranks.has(k)));
    const saved = honorar.setRankFactors(clean);
    logActivity(req.user, 'Honorar je Rang geändert', 'fee', null, Object.entries(saved).map(([k, f]) => `${k} × ${String(f).replace('.', ',')}`).join(', ') || 'alle Standardsatz');
    res.json({ rankFactors: saved });
  })
);

/* Pakete je Rechtsgebiet: mehrere Leistungen zum Paketpreis („Sie sparen X $“) */
const packageSchema = z.object({
  area: z.string().trim().max(40).default(''),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).default(''),
  feeIds: z.array(z.number().int().positive()).min(2).max(15),
  price: z.number().int().min(0).max(1_000_000_000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
const loadPackage = (id) => db.prepare('SELECT * FROM fee_packages WHERE id = ?').get(id) || null;
adminRouter.post(
  '/packages',
  wrap(async (req, res) => {
    const d = parseBody(packageSchema, req, res);
    if (!d) return;
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fee_packages').get().m;
    const info = db
      .prepare('INSERT INTO fee_packages (area, name, description, fee_ids, price, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(d.area, d.name, d.description, toJson(d.feeIds), d.price, d.active ? 1 : 0, d.sortOrder ?? max + 1);
    logActivity(req.user, 'Paket angelegt', 'fee', null, `${d.name} (${money(d.price)})`);
    res.status(201).json({ package: honorar.packageRow(loadPackage(Number(info.lastInsertRowid))) });
  })
);
adminRouter.patch(
  '/packages/:id',
  wrap(async (req, res) => {
    const p = loadPackage(idParam(req));
    if (!p) return res.status(404).json({ error: 'Paket nicht gefunden.' });
    const d = parseBody(packageSchema.partial(), req, res);
    if (!d) return;
    db.prepare('UPDATE fee_packages SET area = ?, name = ?, description = ?, fee_ids = ?, price = ?, active = ?, sort_order = ? WHERE id = ?').run(
      d.area ?? p.area,
      d.name ?? p.name,
      d.description ?? p.description,
      d.feeIds ? toJson(d.feeIds) : p.fee_ids,
      d.price ?? p.price,
      d.active === undefined ? p.active : d.active ? 1 : 0,
      d.sortOrder ?? p.sort_order,
      p.id
    );
    res.json({ package: honorar.packageRow(loadPackage(p.id)) });
  })
);
adminRouter.delete(
  '/packages/:id',
  wrap(async (req, res) => {
    const p = loadPackage(idParam(req));
    if (!p) return res.status(404).json({ error: 'Paket nicht gefunden.' });
    db.prepare('DELETE FROM fee_packages WHERE id = ?').run(p.id);
    logActivity(req.user, 'Paket gelöscht', 'fee', null, p.name);
    res.json({ success: true });
  })
);

adminRouter.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(schema, req, res);
    if (!d) return;
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fees').get().m;
    const info = db
      .prepare('INSERT INTO fees (category, name, description, price, in_calculator, active, sort_order, areas, model, config, includes, surcharges) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.category, d.name, d.description || '', d.price, d.inCalculator === false ? 0 : 1, d.active === false ? 0 : 1, d.sortOrder ?? maxOrder + 1, toJson(d.areas || []), d.model || 'fest', toJson(d.config || {}), (d.includes || []).join('\n'), toJson(d.surcharges || []));
    logActivity(req.user, 'Leistung hinzugefügt', 'fee', Number(info.lastInsertRowid), `${d.name} (${money(d.price)})`);
    res.status(201).json({ fee: feeRow(load(Number(info.lastInsertRowid))) });
  })
);

adminRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const f = id && load(id);
    if (!f) return res.status(404).json({ error: 'Leistung nicht gefunden.' });
    const d = parseBody(schema.partial(), req, res);
    if (!d) return;
    db.prepare(
      'UPDATE fees SET category = ?, name = ?, description = ?, price = ?, in_calculator = ?, active = ?, sort_order = ?, areas = ?, model = ?, config = ?, includes = ?, surcharges = ? WHERE id = ?'
    ).run(
      d.category ?? f.category,
      d.name ?? f.name,
      d.description ?? f.description,
      d.price ?? f.price,
      d.inCalculator === undefined ? f.in_calculator : d.inCalculator ? 1 : 0,
      d.active === undefined ? f.active : d.active ? 1 : 0,
      d.sortOrder ?? f.sort_order,
      d.areas ? toJson(d.areas) : f.areas,
      d.model ?? f.model,
      d.config ? toJson(d.config) : f.config,
      d.includes ? d.includes.join('\n') : f.includes,
      d.surcharges ? toJson(d.surcharges) : f.surcharges,
      f.id
    );
    if (d.price !== undefined && d.price !== f.price) logActivity(req.user, 'Preis geändert', 'fee', f.id, `${f.name}: ${money(f.price)} → ${money(d.price)}`);
    res.json({ fee: feeRow(load(f.id)) });
  })
);

adminRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const f = id && load(id);
    if (!f) return res.status(404).json({ error: 'Leistung nicht gefunden.' });
    db.prepare('DELETE FROM fees WHERE id = ?').run(id);
    logActivity(req.user, 'Leistung gelöscht', 'fee', id, f.name);
    res.json({ success: true });
  })
);

module.exports = { publicRouter, adminRouter };
