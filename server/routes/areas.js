'use strict';
/*
 * Rechtsgebiete (Einstellungen → Listen):
 *  GET    /api/public/areas        eingeschaltete Rechtsgebiete mit Zusatzfeldern (Website, Mandatsformular)
 *  GET    /api/areas               alle, auch ausgeblendete, mit Nutzung (Kanzlei)
 *  POST   /api/areas               neu anlegen                    (Recht „Kanzlei-Einstellungen“)
 *  PUT    /api/areas/order         Reihenfolge { keys: [...] }
 *  PUT    /api/areas/:key          ändern (Name, Farbe, Symbol, Kurztitel, Schritte, Checkliste, Ergebnisse, Zusatzfelder, ein/aus)
 *  DELETE /api/areas/:key          nur wenn nichts mehr daran hängt – sonst ausblenden
 *  GET    /api/areas/:key/template  Akten-Vorlage: alles, was sich umbenennen lässt (Katalog) und die eigenen Bezeichnungen
 *  PUT    /api/areas/:key/labels    eigene Bezeichnungen speichern { labels: { 'sec.claims': 'Forderungen', … } } (leer = Standard)
 *  POST   /api/areas/:key/preview   Vorschau mit Beispieldaten { labels?, mode? } – schreibt nichts, benachrichtigt niemanden
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../core/auth');
const { wrap } = require('../core/helpers');
const { requirePerm } = require('../core/permissions');
const areas = require('../domain/areas');
const configLog = require('../core/configLog');
const { logActivity } = require('../db/models');
const { OUTCOMES } = require('../core/helpers');

const router = express.Router();
router.use(requireAuth, requireStaff);

const withUsage = (a) => ({ ...a, usage: areas.usage(a.key) });
const problems = (err) => (err.issues ? err.issues.map((i) => i.message).join(' ') : err.message);
const outcomesCatalog = () => Object.entries(OUTCOMES).map(([key, o]) => ({ key, label: o.label }));

router.get('/', (req, res) =>
  res.json({ areas: areas.list().map(withUsage), colors: areas.COLORS, icons: areas.ICONS, fieldTypes: areas.FIELD_TYPES, defaultSteps: areas.DEFAULT_STEPS, outcomes: outcomesCatalog() })
);

const guard = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || (err.issues ? 400 : 500)).json({ error: problems(err) });
    }
  });

router.post(
  '/',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const a = areas.create(req.body);
    configLog.add(req.user, { area: 'areas', key: a.key, label: `Rechtsgebiet angelegt: ${a.name}`, perm: 'settings.edit' });
    logActivity(req.user, 'Rechtsgebiet angelegt', 'settings', null, a.name);
    res.status(201).json({ area: withUsage(a) });
  })
);

router.put(
  '/order',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys.filter((k) => areas.exists(k)) : [];
    if (!keys.length) return res.status(400).json({ error: 'Keine Reihenfolge übergeben.' });
    areas.reorder(keys);
    configLog.add(req.user, { area: 'areas', key: 'order', label: 'Reihenfolge der Rechtsgebiete geändert', perm: 'settings.edit' });
    res.json({ areas: areas.list().map(withUsage) });
  })
);

router.put(
  '/:key',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const before = areas.get(req.params.key);
    const a = areas.update(req.params.key, req.body);
    const what = [before.name !== a.name ? `Name „${before.name}“ → „${a.name}“` : '', before.active !== a.active ? (a.active ? 'eingeschaltet' : 'ausgeblendet') : ''].filter(Boolean).join(', ');
    configLog.add(req.user, { area: 'areas', key: a.key, label: `Rechtsgebiet geändert: ${a.name}${what ? ` (${what})` : ''}`, perm: 'settings.edit' });
    logActivity(req.user, 'Rechtsgebiet geändert', 'settings', null, `${a.name}${what ? ` – ${what}` : ''}`);
    res.json({ area: withUsage(a) });
  })
);

/* Akten-Vorlage je Rechtsgebiet: umbenennen und ansehen, ohne eine Akte anzulegen (nichts wird gespeichert oder gemeldet) */
const fall = require('../domain/fall');
const areaOf = (req, res) => {
  const a = areas.get(req.params.key);
  if (!a) res.status(404).json({ error: 'Rechtsgebiet nicht gefunden.' });
  return a;
};
router.get(
  '/:key/template',
  wrap(async (req, res) => {
    const a = areaOf(req, res);
    if (!a) return;
    res.json({ area: { key: a.key, name: a.name }, labels: a.labels, catalog: fall.catalog(a.key), hasBlocks: !!fall.LAYOUT[a.key], modes: a.key === 'vertragsrecht' ? [['gestaltung', 'Vertragsgestaltung'], ['streit', 'Vertragsstreit']] : [] });
  })
);
router.put(
  '/:key/labels',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const a = areaOf(req, res);
    if (!a) return;
    const labels = fall.checkLabels(a.key, req.body && req.body.labels);
    areas.setLabels(a.key, labels);
    const n = Object.keys(labels).length;
    configLog.add(req.user, { area: 'areas', key: a.key, label: `Akten-Vorlage „${a.name}“: ${n ? `${n} eigene Bezeichnung${n === 1 ? '' : 'en'}` : 'zurück auf die Standardbezeichnungen'}`, perm: 'settings.edit' });
    logActivity(req.user, 'Akten-Vorlage geändert', 'settings', null, a.name);
    res.json({ labels });
  })
);
router.post(
  '/:key/preview',
  guard((req, res) => {
    const a = areaOf(req, res);
    if (!a) return;
    const body = req.body || {};
    const labels = body.labels === undefined ? a.labels : fall.checkLabels(a.key, body.labels);
    const mode = body.mode === 'streit' ? 'streit' : 'gestaltung';
    res.json({ area: { key: a.key, name: a.name }, fall: fall.payload({ id: 0, area: a.key }, { sample: true, labels, mode }) });
  })
);

router.delete(
  '/:key',
  requirePerm('settings.edit'),
  guard((req, res) => {
    const a = areas.get(req.params.key);
    if (!a) return res.status(404).json({ error: 'Rechtsgebiet nicht gefunden.' });
    areas.remove(a.key);
    configLog.add(req.user, { area: 'areas', key: a.key, label: `Rechtsgebiet gelöscht: ${a.name}`, perm: 'settings.edit' });
    res.json({ areas: areas.list().map(withUsage) });
  })
);

const publicRouter = express.Router();
publicRouter.get('/areas', (req, res) => res.json({ areas: areas.publicList() }));

module.exports = { router, publicRouter };
