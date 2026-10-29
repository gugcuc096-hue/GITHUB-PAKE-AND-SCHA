'use strict';
/*
 * Dauermandate (Rechnungen → Reiter „Dauermandate“): feste Pauschale je Zeitraum, die Rechnung entsteht von selbst.
 *  GET    /api/retainers            alle (Kanzlei)
 *  GET    /api/retainers/:id        eines mit seinen Rechnungen (Kanzlei)
 *  POST   /api/retainers            anlegen            (Board of Partners)
 *  PATCH  /api/retainers/:id        ändern             (Board of Partners)
 *  POST   /api/retainers/:id/status { status }  aktiv | pausiert | beendet   (Board of Partners)

 *  POST   /api/retainers/sweep      alle fälligen Zeiträume sofort abrechnen (Board of Partners)
 *  POST   /api/retainers/:id/run    fälligen Zeitraum sofort abrechnen        (Board of Partners)
 *  DELETE /api/retainers/:id        nur ohne Rechnungen                       (Board of Partners)
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, idParam, isBoard } = require('../helpers');
const { logActivity, berlinToday } = require('../models');
const retainers = require('../retainers');

const router = express.Router();
router.use(requireAuth, requireStaff);

const problems = (err) => (err.issues ? err.issues.map((i) => `${i.path.join('.') || 'Angabe'}: ${i.message}`).join(' ') : err.message);
const guard = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || (err.issues ? 400 : 500)).json({ error: problems(err) });
    }
  });
const board = (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Dauermandate pflegt das Board of Partners.' }));
const load = (req, res) => {
  const id = idParam(req);
  const r = id && retainers.get(id);
  if (!r) res.status(404).json({ error: 'Dauermandat nicht gefunden.' });
  return r || null;
};

router.get('/', (req, res) => res.json({ retainers: retainers.list() }));

/** Alle fälligen Zeiträume sofort abrechnen (läuft sonst automatisch alle paar Minuten). */
router.post(
  '/sweep',
  board,
  guard((req, res) => {
    const made = retainers.sweep();
    if (made) logActivity(req.user, 'Dauermandate abgerechnet', 'retainer', null, `${made} Rechnung${made === 1 ? '' : 'en'}`);
    res.json({ made, retainers: retainers.list() });
  })
);

router.get('/:id', (req, res) => {
  const r = load(req, res);
  if (r) res.json({ retainer: retainers.row(r), invoices: retainers.invoicesOf(r.id) });
});

router.post(
  '/',
  board,
  guard((req, res) => {
    const id = retainers.create(req.body, req.user);
    const r = retainers.get(id);
    logActivity(req.user, 'Dauermandat angelegt', 'retainer', id, `${r.title} · ${r.client_name} · ${r.amount} $`);
    res.status(201).json({ retainer: retainers.row(r) });
  })
);

router.patch(
  '/:id',
  board,
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    retainers.update(r.id, req.body);
    logActivity(req.user, 'Dauermandat geändert', 'retainer', r.id, r.title);
    res.json({ retainer: retainers.row(retainers.get(r.id)) });
  })
);

router.post(
  '/:id/status',
  board,
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    retainers.setStatus(r.id, req.body && req.body.status);
    logActivity(req.user, 'Dauermandat: Stand geändert', 'retainer', r.id, `${r.title} → ${req.body.status}`);
    res.json({ retainer: retainers.row(retainers.get(r.id)) });
  })
);

router.post(
  '/:id/run',
  board,
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    if (r.status !== 'aktiv') return res.status(409).json({ error: 'Nur aktive Dauermandate lassen sich abrechnen.' });
    const due = retainers.nextDue(r);
    if (!due) return res.status(409).json({ error: 'Es ist nichts mehr abzurechnen.' });
    if (due > berlinToday()) return res.status(409).json({ error: `Der nächste Zeitraum ist erst am ${due.split('-').reverse().join('.')} fällig.` });
    const inv = retainers.invoiceNext(r);
    res.status(201).json({ invoiceId: inv.id, number: inv.number, retainer: retainers.row(retainers.get(r.id)) });
  })
);

router.delete(
  '/:id',
  board,
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    retainers.remove(r.id);
    logActivity(req.user, 'Dauermandat gelöscht', 'retainer', r.id, r.title);
    res.json({ success: true });
  })
);

module.exports = { router };
