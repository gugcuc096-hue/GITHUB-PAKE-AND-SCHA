'use strict';
/*
 * Kanzlei-Lager (nur Kanzlei): Gegenstände, Geld und Schwarzgeld ein- und auslagern. Der Bestand ist die Summe aller
 * Buchungen. Schwarzgeld sehen und buchen standardmäßig nur das Board of Partners (Einstellung „storage_black_all“).
 *  GET    /api/storage                 Bestand, Gegenstände und letzte Buchungen
 *  POST   /api/storage/entries         buchen { kind, itemId?, direction: in|out, amount, note }
 *  DELETE /api/storage/entries/:id     Buchung stornieren (Board of Partners)
 *  Gegenstände (Einstellungen, nur Admins):
 *  POST   /api/storage/items           { name }
 *  PATCH  /api/storage/items/:id       { name?, sortOrder? }
 *  POST   /api/storage/items/:id/image Bild (JPG/PNG/WebP, Rohdaten)
 *  DELETE /api/storage/items/:id       entfernen (mit Buchungen: nur ausgeblendet, der Verlauf bleibt)
 */
const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting, tx } = require('../db');
const { requireAuth, requireStaff, requireAdmin } = require('../auth');
const { wrap, parseBody, idParam, isBoard } = require('../helpers');
const { logActivity } = require('../models');
const { imageBody, saveImage, removeFile, itemImageUrl } = require('../uploads');

const router = express.Router();
router.use(requireAuth, requireStaff);

const KIND_LABEL = { item: 'Gegenstand', geld: 'Geld', schwarzgeld: 'Schwarzgeld' };
const MAX_ITEMS = 200;
const ENTRY_LIMIT = 150;

/** Schwarzgeld: Board of Partners immer, alle anderen nur, wenn es in den Einstellungen freigegeben ist. */
const blackAllowed = (u) => isBoard(u) || getSetting('storage_black_all', '0') === '1';

const itemRow = (i, stock = 0) => ({ id: i.id, name: i.name, imageUrl: itemImageUrl(i.image), active: !!i.active, sortOrder: i.sort_order, stock });
const entryRow = (e, u) => ({
  id: e.id,
  kind: e.kind,
  itemId: e.item_id,
  itemName: e.item_name,
  amount: e.amount,
  note: e.note,
  userName: e.user_name,
  createdAt: e.created_at,
  canDelete: isBoard(u),
});

const balance = (kind) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM storage_entries WHERE kind = ?').get(kind).n;
const itemStock = (id) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM storage_entries WHERE kind = 'item' AND item_id = ?").get(id).n;

function payload(u) {
  const stock = new Map(db.prepare("SELECT item_id, SUM(amount) AS n FROM storage_entries WHERE kind = 'item' GROUP BY item_id").all().map((r) => [r.item_id, r.n]));
  const black = blackAllowed(u);
  const items = db
    .prepare('SELECT * FROM storage_items ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
    .all()
    // Ausgeblendete Gegenstände nur, solange noch etwas davon im Lager liegt (damit nichts „verschwindet“)
    .filter((i) => i.active || stock.get(i.id))
    .map((i) => itemRow(i, stock.get(i.id) || 0));
  const entries = db
    .prepare(`SELECT * FROM storage_entries ${black ? '' : "WHERE kind != 'schwarzgeld'"} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(ENTRY_LIMIT)
    .map((e) => entryRow(e, u));
  return {
    items,
    money: balance('geld'),
    black: black ? balance('schwarzgeld') : null,
    canBlack: black,
    canManage: u.role === 'admin',
    canDelete: isBoard(u),
    blackAll: getSetting('storage_black_all', '0') === '1',
    entries,
  };
}

router.get('/', (req, res) => res.json(payload(req.user)));

const entrySchema = z.object({
  kind: z.enum(['item', 'geld', 'schwarzgeld']),
  itemId: z.number().int().positive().optional(),
  direction: z.enum(['in', 'out']),
  amount: z.number().int().positive().max(1_000_000_000),
  note: z.string().trim().max(300).optional().default(''),
});

router.post(
  '/entries',
  wrap(async (req, res) => {
    const d = parseBody(entrySchema, req, res);
    if (!d) return;
    const u = req.user;
    if (d.kind === 'schwarzgeld' && !blackAllowed(u)) return res.status(403).json({ error: 'Schwarzgeld buchen darf nur das Board of Partners.' });
    let item = null;
    if (d.kind === 'item') {
      item = d.itemId && db.prepare('SELECT * FROM storage_items WHERE id = ?').get(d.itemId);
      if (!item) return res.status(400).json({ error: 'Bitte einen Gegenstand auswählen.' });
      if (!item.active && d.direction === 'in') return res.status(400).json({ error: 'Dieser Gegenstand wurde entfernt und kann nicht mehr eingelagert werden.' });
    }
    const amount = d.direction === 'in' ? d.amount : -d.amount;
    // Entnehmen nur, was da ist – in einer Transaktion, damit zwei gleichzeitige Entnahmen nicht ins Minus führen
    const result = tx(() => {
      const have = item ? itemStock(item.id) : balance(d.kind);
      if (amount < 0 && have + amount < 0) return { error: `Nicht genug im Lager – vorhanden: ${have.toLocaleString('de-DE')}.` };
      const info = db
        .prepare('INSERT INTO storage_entries (kind, item_id, item_name, amount, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(d.kind, item ? item.id : null, item ? item.name : '', amount, d.note, u.id, u.display_name);
      return { id: Number(info.lastInsertRowid) };
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const what = item ? `${d.amount}× ${item.name}` : `$${d.amount.toLocaleString('de-DE')} ${KIND_LABEL[d.kind]}`;
    logActivity(u, d.direction === 'in' ? 'Lager: eingelagert' : 'Lager: entnommen', 'storage', result.id, `${what}${d.note ? ` – ${d.note}` : ''}`);
    res.status(201).json(payload(u));
  })
);

router.delete(
  '/entries/:id',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Buchungen stornieren darf nur das Board of Partners.' });
    const id = idParam(req);
    const e = id && db.prepare('SELECT * FROM storage_entries WHERE id = ?').get(id);
    if (!e) return res.status(404).json({ error: 'Buchung nicht gefunden.' });
    // Storno einer Einlagerung darf den Bestand nicht ins Minus drücken (die Ware ist dann schon wieder raus)
    const have = e.kind === 'item' ? itemStock(e.item_id) : balance(e.kind);
    if (have - e.amount < 0) return res.status(400).json({ error: 'Storno nicht möglich – der Bestand würde ins Minus fallen.' });
    db.prepare('DELETE FROM storage_entries WHERE id = ?').run(e.id);
    logActivity(req.user, 'Lager: Buchung storniert', 'storage', e.id, `${e.amount > 0 ? '+' : ''}${e.amount} ${e.item_name || KIND_LABEL[e.kind]}${e.note ? ` – ${e.note}` : ''} (${e.user_name})`);
    res.json(payload(req.user));
  })
);

/* ---------------------------------------------------------------- Gegenstände (Einstellungen) */
router.get('/items', requireAdmin, (req, res) => {
  const stock = new Map(db.prepare("SELECT item_id, SUM(amount) AS n FROM storage_entries WHERE kind = 'item' GROUP BY item_id").all().map((r) => [r.item_id, r.n]));
  res.json({
    items: db
      .prepare('SELECT * FROM storage_items WHERE active = 1 ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
      .all()
      .map((i) => itemRow(i, stock.get(i.id) || 0)),
    blackAll: getSetting('storage_black_all', '0') === '1',
  });
});

const itemSchema = z.object({ name: z.string().trim().min(1).max(60) });
router.post(
  '/items',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parseBody(itemSchema, req, res);
    if (!d) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM storage_items WHERE active = 1').get().n >= MAX_ITEMS) return res.status(400).json({ error: `Höchstens ${MAX_ITEMS} Gegenstände.` });
    if (db.prepare('SELECT 1 FROM storage_items WHERE active = 1 AND name = ? COLLATE NOCASE').get(d.name)) return res.status(400).json({ error: 'Diesen Gegenstand gibt es schon.' });
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM storage_items').get().n;
    const info = db.prepare('INSERT INTO storage_items (name, sort_order) VALUES (?, ?)').run(d.name, order);
    logActivity(req.user, 'Lager: Gegenstand angelegt', 'storage_item', Number(info.lastInsertRowid), d.name);
    res.status(201).json({ item: itemRow(db.prepare('SELECT * FROM storage_items WHERE id = ?').get(Number(info.lastInsertRowid))) });
  })
);

router.patch(
  '/items/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const item = id && db.prepare('SELECT * FROM storage_items WHERE id = ? AND active = 1').get(id);
    if (!item) return res.status(404).json({ error: 'Gegenstand nicht gefunden.' });
    const d = parseBody(z.object({ name: z.string().trim().min(1).max(60).optional(), sortOrder: z.number().int().min(0).max(100000).optional() }), req, res);
    if (!d) return;
    if (d.name && db.prepare('SELECT 1 FROM storage_items WHERE active = 1 AND id != ? AND name = ? COLLATE NOCASE').get(id, d.name)) {
      return res.status(400).json({ error: 'Diesen Gegenstand gibt es schon.' });
    }
    db.prepare('UPDATE storage_items SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?').run(d.name ?? null, d.sortOrder ?? null, id);
    res.json({ item: itemRow(db.prepare('SELECT * FROM storage_items WHERE id = ?').get(id), itemStock(id)) });
  })
);

router.post(
  '/items/:id/image',
  requireAdmin,
  imageBody,
  wrap(async (req, res) => {
    const id = idParam(req);
    const item = id && db.prepare('SELECT * FROM storage_items WHERE id = ? AND active = 1').get(id);
    if (!item) return res.status(404).json({ error: 'Gegenstand nicht gefunden.' });
    const saved = saveImage(req, 'items');
    db.prepare('UPDATE storage_items SET image = ? WHERE id = ?').run(saved.file, id);
    removeFile('items', item.image);
    res.json({ item: itemRow(db.prepare('SELECT * FROM storage_items WHERE id = ?').get(id), itemStock(id)) });
  })
);

router.delete(
  '/items/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const item = id && db.prepare('SELECT * FROM storage_items WHERE id = ? AND active = 1').get(id);
    if (!item) return res.status(404).json({ error: 'Gegenstand nicht gefunden.' });
    const used = db.prepare('SELECT 1 FROM storage_entries WHERE item_id = ? LIMIT 1').get(id);
    if (used) db.prepare('UPDATE storage_items SET active = 0 WHERE id = ?').run(id);
    else {
      db.prepare('DELETE FROM storage_items WHERE id = ?').run(id);
      removeFile('items', item.image);
    }
    logActivity(req.user, 'Lager: Gegenstand entfernt', 'storage_item', id, item.name);
    res.json({ ok: true });
  })
);

router.put('/settings', requireAdmin, (req, res) => {
  setSetting('storage_black_all', req.body && req.body.blackAll ? '1' : '0');
  res.json({ blackAll: getSetting('storage_black_all', '0') === '1' });
});

module.exports = { router };
