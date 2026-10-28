'use strict';
/*
 * Termin- und Fristenarten (Einstellungen → Listen):
 *  GET    /api/event-kinds             alle Arten (Kanzlei)
 *  POST   /api/event-kinds             anlegen           (Recht „Kanzlei-Einstellungen“)
 *  PUT    /api/event-kinds/order       Reihenfolge { keys }
 *  PUT    /api/event-kinds/:key        ändern, auch ausblenden
 *  DELETE /api/event-kinds/:key        nur unbenutzte
 *  POST   /api/event-kinds/:key/calc   Fristenrechner { from: 'JJJJ-MM-TT' } → Fristende
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../auth');
const { wrap } = require('../helpers');
const { requirePerm } = require('../permissions');
const kinds = require('../eventKinds');
const configLog = require('../configLog');
const { logActivity } = require('../models');

const router = express.Router();
router.use(requireAuth, requireStaff);

const problems = (err) => (err.issues ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ') : err.message);
const guard = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || (err.issues ? 400 : 500)).json({ error: problems(err) });
    }
  });
const withUsage = (k) => ({ ...k, usage: kinds.usage(k.key) });

router.get('/', (req, res) => res.json({ kinds: kinds.list().map(withUsage), bases: kinds.BASES, units: kinds.UNITS }));

router.post(
  '/',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const k = kinds.create(req.body);
    configLog.add(req.user, { area: 'event_kinds', key: k.key, label: `Terminart angelegt: ${k.name}`, perm: 'settings.edit' });
    logActivity(req.user, 'Terminart angelegt', 'settings', null, k.name);
    res.status(201).json({ kind: withUsage(k) });
  })
);
router.put(
  '/order',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys.filter((k) => kinds.get(k)) : [];
    if (!keys.length) return res.status(400).json({ error: 'Keine Reihenfolge übergeben.' });
    kinds.reorder(keys);
    res.json({ kinds: kinds.list().map(withUsage) });
  })
);
router.put(
  '/:key',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const k = kinds.update(req.params.key, req.body);
    configLog.add(req.user, { area: 'event_kinds', key: k.key, label: `Terminart geändert: ${k.name}`, perm: 'settings.edit' });
    res.json({ kind: withUsage(k) });
  })
);
router.delete(
  '/:key',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const k = kinds.get(req.params.key);
    if (!k) return res.status(404).json({ error: 'Art nicht gefunden.' });
    kinds.remove(k.key);
    configLog.add(req.user, { area: 'event_kinds', key: k.key, label: `Terminart gelöscht: ${k.name}`, perm: 'settings.edit' });
    res.json({ kinds: kinds.list().map(withUsage) });
  })
);
router.post(
  '/:key/calc',
  guard((req, res) => {
    const k = kinds.get(req.params.key);
    if (!k) return res.status(404).json({ error: 'Art nicht gefunden.' });
    res.json(kinds.compute(k, req.body && req.body.from));
  })
);

module.exports = { router };
