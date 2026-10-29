'use strict';
/*
 * 360°-Feedback (Kanzlei → 360°-Feedback), nur Kanzlei:
 *  GET    /api/feedback                       Runden mit meinem Stand
 *  POST   /api/feedback/rounds                { title, dueDate? } Runde starten (Board)
 *  GET    /api/feedback/rounds/:id/sheet      meine Kolleginnen und Kollegen mit bisherigen Rückmeldungen
 *  PUT    /api/feedback/rounds/:id/entries/:aboutId   Rückmeldung abgeben/ändern (anonym)
 *  GET    /api/feedback/rounds/:id/progress   wer wie viel abgegeben hat (Board)
 *  POST   /api/feedback/rounds/:id/close      Runde schließen (Board)
 *  POST   /api/feedback/rounds/:id/publish    Ergebnisse freigeben (Board)
 *  GET    /api/feedback/rounds/:id/results    Ergebnisse (Board: alle, sonst nur die eigenen nach der Freigabe)
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, idParam } = require('../helpers');
const fb = require('../feedback360');

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
const rid = (req) => idParam(req) || 0;

router.get('/', (req, res) => res.json({ rounds: fb.list(req.user), dimensions: fb.DIMENSIONS, minResponses: fb.MIN_RESPONSES }));
router.post('/rounds', guard((req, res) => res.status(201).json({ id: fb.start(req.body || {}, req.user), rounds: fb.list(req.user) })));
router.get('/rounds/:id/sheet', guard((req, res) => res.json(fb.mySheet(rid(req), req.user))));
router.put(
  '/rounds/:id/entries/:aboutId',
  guard((req, res) => {
    fb.save(rid(req), idParam(req, 'aboutId') || 0, req.user, req.body || {});
    res.json(fb.mySheet(rid(req), req.user));
  })
);
router.get('/rounds/:id/progress', guard((req, res) => res.json({ progress: fb.progress(rid(req), req.user) })));
router.post('/rounds/:id/close', guard((req, res) => (fb.setStatus(rid(req), 'geschlossen', req.user), res.json({ rounds: fb.list(req.user) }))));
router.post('/rounds/:id/publish', guard((req, res) => (fb.setStatus(rid(req), 'veroeffentlicht', req.user), res.json({ rounds: fb.list(req.user) }))));
router.get('/rounds/:id/results', guard((req, res) => res.json(fb.results(rid(req), req.user))));

module.exports = { router };
