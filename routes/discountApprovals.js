'use strict';
/*
 * Rabatt-Freigabe (Rechnungen → Freigaben):
 *  GET  /api/discount-approvals           Board: alle Anfragen · sonst die eigenen; dazu Schwellwert und Zahl der offenen
 *  POST /api/discount-approvals/settings  { pct }  Schwellwert (Recht „Kanzlei-Einstellungen“)
 *  POST /api/discount-approvals/:id/decide  { approve, note? }  Board
 * Angefragt wird beim Erstellen einer Rechnung (routes/invoices.js), nicht hier.
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../auth');
const { requirePerm } = require('../permissions');
const { wrap, idParam } = require('../helpers');
const approvals = require('../discountApprovals');

const router = express.Router();
router.use(requireAuth, requireStaff);

const guard = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

router.get('/', (req, res) => res.json({ requests: approvals.listFor(req.user), thresholdPct: approvals.threshold(), pending: approvals.pendingCount() }));

router.post(
  '/settings',
  requirePerm('settings.edit'),
  guard((req, res) => {
    // das Änderungsprotokoll trägt den Schwellwert selbst ein (configLog.js)
    res.json({ thresholdPct: approvals.setThreshold(req.body && req.body.pct) });
  })
);

router.post(
  '/:id/decide',
  guard((req, res) => {
    const id = idParam(req);
    if (!id) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    const r = approvals.decide(id, req.user, !!(req.body && req.body.approve), { via: 'dashboard', note: req.body && req.body.note });
    res.json({ ...r, pending: approvals.pendingCount() });
  })
);

module.exports = { router };
