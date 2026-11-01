'use strict';
/*
 * Einführungstour im Dashboard (je Rolle, ca. 5 Schritte): ob jemand sie schon gesehen hat – je Konto, auf jedem Gerät gleich.
 *  GET  /api/tour   { done }    (done = Version der Tour, die zuletzt angesehen bzw. übersprungen wurde)
 *  PUT  /api/tour   { done }
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db/db');
const { requireAuth } = require('../core/auth');
const { wrap, parseBody } = require('../core/helpers');

const router = express.Router();
router.use(requireAuth);
const KEY = 'tour';

router.get('/', (req, res) => {
  const r = db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(req.user.id, KEY);
  res.json({ done: r ? Number(r.value) || 0 : 0 });
});

router.put(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ done: z.number().int().min(0).max(1000) }), req, res);
    if (!d) return;
    db.prepare(
      `INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(req.user.id, KEY, String(d.done));
    res.json({ done: d.done });
  })
);

module.exports = { router };
