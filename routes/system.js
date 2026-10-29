'use strict';
/*
 * Systemzustand (nur mit dem Recht „System“, siehe Rechte-Tabelle):
 *  GET  /api/system          Startdauer, Laufzeit, Speicher, Datenbank, Sicherungen, langsamste Anfragen, letzter Selbsttest
 *  POST /api/system/check    Selbsttest jetzt ausführen (gründlich: ganze Datenbank durchsehen)
 *  POST /api/system/optimize Datenbank optimieren (PRAGMA optimize, ANALYZE, WAL kürzen)
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { requirePerm } = require('../permissions');
const { wrap } = require('../helpers');
const health = require('../health');
const { logActivity } = require('../models');

const router = express.Router();
router.use(requireAuth, requirePerm('system.edit'));

router.get('/', (req, res) => res.json(health.snapshot()));

router.post(
  '/check',
  wrap(async (req, res) => {
    const result = health.runSelfTest({ deep: true });
    logActivity(req.user, 'system.check', 'system', null, result.ok ? 'Selbsttest: in Ordnung' : 'Selbsttest: Probleme gefunden');
    res.json({ result, snapshot: health.snapshot() });
  })
);

router.post(
  '/optimize',
  wrap(async (req, res) => {
    const started = Date.now();
    db.exec('ANALYZE; PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);');
    logActivity(req.user, 'system.optimize', 'system', null, `Datenbank optimiert (${Date.now() - started} ms)`);
    res.json({ ms: Date.now() - started, snapshot: health.snapshot() });
  })
);

module.exports = router;
