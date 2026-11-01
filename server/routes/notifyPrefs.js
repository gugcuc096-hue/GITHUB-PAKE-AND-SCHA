'use strict';
/*
 * Benachrichtigungen je Person (alle Konten, auch Mandanten):
 *  GET /api/notify-prefs   eigene Wahl (Discord-Direktnachrichten, Ruhezeiten, Dashboard-Hinweise und Ton)
 *  PUT /api/notify-prefs   speichern
 */
const express = require('express');
const { requireAuth } = require('../core/auth');
const { wrap, parseBody } = require('../core/helpers');
const prefs = require('../domain/notifyPrefs');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => res.json({ prefs: prefs.get(req.user.id), hasDiscord: !!req.user.discord_id }));

router.put(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(prefs.schema.partial(), req, res);
    if (!d) return;
    res.json({ prefs: prefs.set(req.user.id, d) });
  })
);

module.exports = { router };
