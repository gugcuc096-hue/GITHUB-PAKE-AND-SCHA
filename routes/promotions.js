'use strict';
/*
 * Rabattaktionen (Einstellungen → Konfiguration → Rabattaktionen), siehe promotions.js:
 *  GET    /api/promotions        alle Aktionen, die laufende und die Anlässe (Kanzlei)
 *  POST   /api/promotions        anlegen   (Recht „Kanzlei-Einstellungen“)
 *  PUT    /api/promotions/:id    ändern
 *  DELETE /api/promotions/:id    löschen (bestehende Rechnungen behalten ihren Aktionsrabatt)
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { requirePerm } = require('../permissions');
const { wrap, parseBody, idParam } = require('../helpers');
const { logActivity } = require('../models');
const configLog = require('../configLog');
const promotions = require('../promotions');

const router = express.Router();
router.use(requireAuth, requireStaff);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT.');
const schema = z
  .object({
    name: z.string().trim().min(2, 'Bitte einen Namen angeben.').max(80),
    pct: z.number().min(1, 'Mindestens 1 %.').max(90, 'Höchstens 90 %.'),
    occasion: z.enum(Object.keys(promotions.OCCASIONS)).default('eigen'),
    startsOn: day,
    endsOn: day,
    yearly: z.boolean().default(false),
    announce: z.boolean().default(true),
    message: z.string().trim().max(200).default(''),
    active: z.boolean().default(true),
  })
  .refine((v) => v.yearly || v.endsOn >= v.startsOn, { message: 'Das Ende liegt vor dem Start.', path: ['endsOn'] });

const payload = () => ({
  promotions: promotions.list(),
  current: promotions.current(),
  occasions: Object.entries(promotions.OCCASIONS).map(([key, o]) => ({ key, label: o.label, icon: o.icon, from: o.from, to: o.to, computed: !!o.computed })),
  today: promotions.berlinToday(),
});
const fields = (d) => [d.name, d.pct, d.occasion, d.startsOn, d.endsOn, d.yearly ? 1 : 0, d.announce ? 1 : 0, d.message, d.active ? 1 : 0];

router.get('/', (req, res) => res.json(payload()));

router.post(
  '/',
  requirePerm('settings.edit'),
  wrap((req, res) => {
    const d = parseBody(schema, req, res);
    if (!d) return;
    const info = db
      .prepare('INSERT INTO promotions (name, pct, occasion, starts_on, ends_on, yearly, announce, message, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...fields(d), req.user.id);
    const id = Number(info.lastInsertRowid);
    configLog.add(req.user, { area: 'promotions', key: String(id), label: `Rabattaktion „${d.name}“ angelegt (${d.pct} %)`, perm: 'settings.edit', after: d });
    logActivity(req.user, 'Rabattaktion angelegt', 'promotion', id, `${d.name} · ${d.pct} %`);
    res.status(201).json({ ...payload(), id });
  })
);

router.put(
  '/:id',
  requirePerm('settings.edit'),
  wrap((req, res) => {
    const id = idParam(req);
    const before = id && promotions.get(id);
    if (!before) return res.status(404).json({ error: 'Diese Aktion gibt es nicht (mehr).' });
    const d = parseBody(schema, req, res);
    if (!d) return;
    db.prepare("UPDATE promotions SET name = ?, pct = ?, occasion = ?, starts_on = ?, ends_on = ?, yearly = ?, announce = ?, message = ?, active = ?, updated_at = datetime('now') WHERE id = ?").run(...fields(d), id);
    configLog.add(req.user, { area: 'promotions', key: String(id), label: `Rabattaktion „${d.name}“ geändert`, perm: 'settings.edit', before: promotions.row(before), after: d });
    res.json(payload());
  })
);

router.delete(
  '/:id',
  requirePerm('settings.edit'),
  wrap((req, res) => {
    const id = idParam(req);
    const p = id && promotions.get(id);
    if (!p) return res.status(404).json({ error: 'Diese Aktion gibt es nicht (mehr).' });
    db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
    configLog.add(req.user, { area: 'promotions', key: String(id), label: `Rabattaktion „${p.name}“ gelöscht`, perm: 'settings.edit', before: promotions.row(p) });
    res.json(payload());
  })
);

module.exports = { router };
