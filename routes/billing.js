'use strict';
/*
 * Gebührenkategorien und Rechnungsarten (Einstellungen → Listen):
 *  GET    /api/billing                     { categories, types, bases }
 *  POST   /api/billing/categories          Kategorie anlegen        (Recht „Kanzlei-Einstellungen“)
 *  PUT    /api/billing/categories/order    Reihenfolge { keys }
 *  PUT    /api/billing/categories/:key     umbenennen, ein-/ausblenden
 *  DELETE /api/billing/categories/:key     nur leere
 *  POST   /api/billing/types · PUT …/order · PUT …/:key · DELETE …/:key   dasselbe für Rechnungsarten
 * Lesen dürfen alle Kanzlei-Mitarbeitenden (Rechnungs-Generator), Ändern braucht das Recht.
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../auth');
const { wrap } = require('../helpers');
const { requirePerm } = require('../permissions');
const billing = require('../billing');
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
const areas = require('../areas');
/** Standardgebühren und Rechnungsart je Rechtsgebiet (füllt neue Rechnungen vor). */
const areaDefaults = () => Object.fromEntries(areas.list().filter((a) => a.defaultFees.length || a.defaultType).map((a) => [a.key, { fees: a.defaultFees, type: a.defaultType }]));
const all = () => ({ categories: billing.categories(), types: billing.types(), bases: billing.BASES, areaDefaults: areaDefaults(), discountApprovalPct: require('../discountApprovals').threshold() });
const log = (req, what, label) => {
  configLog.add(req.user, { area: 'billing', key: what, label, perm: 'settings.edit' });
  logActivity(req.user, label, 'settings', null, '');
};

router.get('/', (req, res) => res.json(all()));

const crud = (path, noun, m) => {
  const { create, update, remove, reorder, get, name } = m;
  router.post(
    `/${path}`,
    requirePerm('settings.edit'),
    guard((req, res) => {
      const x = create(req.body);
      log(req, x.key, `${noun} angelegt: ${x.name}`);
      res.status(201).json(all());
    })
  );
  router.put(
    `/${path}/order`,
    requirePerm('settings.edit'),
    guard((req, res) => {
      const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys.filter((k) => get(k)) : [];
      if (!keys.length) return res.status(400).json({ error: 'Keine Reihenfolge übergeben.' });
      reorder(keys);
      res.json(all());
    })
  );
  router.put(
    `/${path}/:key`,
    requirePerm('settings.edit'),
    guard((req, res) => {
      const x = update(req.params.key, req.body);
      log(req, x.key, `${noun} geändert: ${x.name}`);
      res.json(all());
    })
  );
  router.delete(
    `/${path}/:key`,
    requirePerm('settings.edit'),
    guard((req, res) => {
      const x = get(req.params.key);
      if (!x) return res.status(404).json({ error: `${noun} nicht gefunden.` });
      remove(x.key);
      log(req, x.key, `${noun} gelöscht: ${name(x)}`);
      res.json(all());
    })
  );
};
crud('categories', 'Gebührenkategorie', { create: billing.createCategory, update: billing.updateCategory, remove: billing.removeCategory, reorder: billing.reorderCategories, get: billing.category, name: (x) => x.name });
crud('types', 'Rechnungsart', { create: billing.createType, update: billing.updateType, remove: billing.removeType, reorder: billing.reorderTypes, get: billing.type, name: (x) => x.name });

module.exports = { router };
