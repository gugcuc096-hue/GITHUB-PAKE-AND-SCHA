'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { wrap, parseBody, idParam, FEE_CATEGORIES } = require('../helpers');
const { feeRow, logActivity } = require('../models');
const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;

const ORDER = 'ORDER BY sort_order ASC, id ASC';

/* Öffentlich: Honorarordnung für Startseite, Tarifrechner und Rechnungs-Generator */
const publicRouter = express.Router();
publicRouter.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM fees WHERE active = 1 ${ORDER}`).all();
  res.json({ fees: rows.map(feeRow) });
});

/* Kanzleileitung: Honorarordnung pflegen */
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

const schema = z.object({
  category: z.enum(FEE_CATEGORIES),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().int().min(0).max(1_000_000_000),
  inCalculator: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

function load(id) {
  return db.prepare('SELECT * FROM fees WHERE id = ?').get(id) || null;
}

adminRouter.get('/', (req, res) => {
  res.json({ fees: db.prepare(`SELECT * FROM fees ${ORDER}`).all().map(feeRow) });
});

adminRouter.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(schema, req, res);
    if (!d) return;
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fees').get().m;
    const info = db
      .prepare('INSERT INTO fees (category, name, description, price, in_calculator, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(d.category, d.name, d.description || '', d.price, d.inCalculator === false ? 0 : 1, d.active === false ? 0 : 1, d.sortOrder ?? maxOrder + 1);
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
      'UPDATE fees SET category = ?, name = ?, description = ?, price = ?, in_calculator = ?, active = ?, sort_order = ? WHERE id = ?'
    ).run(
      d.category ?? f.category,
      d.name ?? f.name,
      d.description ?? f.description,
      d.price ?? f.price,
      d.inCalculator === undefined ? f.in_calculator : d.inCalculator ? 1 : 0,
      d.active === undefined ? f.active : d.active ? 1 : 0,
      d.sortOrder ?? f.sort_order,
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
