'use strict';
/*
 * Persönliche Ansicht der Akte (Kanzlei): Reihenfolge der Abschnitte, ausgeblendete und eingeklappte Abschnitte – je Person
 * gespeichert, damit sie auf jedem Gerät gleich aussieht. Das Board kann je Rechtsgebiet eine Standardansicht vorgeben, die
 * gilt, solange jemand nichts Eigenes eingestellt hat.
 *
 *  GET    /api/prefs/case-sections                     eigene Ansicht + Standards je Rechtsgebiet
 *  PUT    /api/prefs/case-sections                     eigene Ansicht speichern { order, hidden, collapsed }
 *  DELETE /api/prefs/case-sections                     eigene Ansicht zurücksetzen
 *  PUT    /api/prefs/case-sections/default/:area       Standard für ein Rechtsgebiet (nur Board)
 *  DELETE /api/prefs/case-sections/default/:area       Standard entfernen (nur Board)
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, isBoard } = require('../helpers');
const { logActivity } = require('../models');

const SECTIONS = ['charges', 'chat', 'events', 'witnesses', 'karte', 'contracts', 'briefs', 'external', 'evidence', 'requests', 'tasks', 'invoices', 'work', 'notes'];
const keyList = z.array(z.enum(SECTIONS)).max(SECTIONS.length);
const viewSchema = z.object({ order: keyList, hidden: keyList.default([]), collapsed: keyList.default([]) });
const KEY = 'caseSections';

const parse = (raw) => {
  try {
    const v = viewSchema.safeParse(JSON.parse(raw));
    return v.success ? v.data : null;
  } catch {
    return null;
  }
};

const router = express.Router();
router.use(requireAuth, requireStaff);

router.get(
  '/case-sections',
  wrap(async (req, res) => {
    const mine = db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(req.user.id, KEY);
    const defaults = {};
    for (const r of db.prepare('SELECT area, value FROM case_section_defaults').all()) {
      const v = parse(r.value);
      if (v) defaults[r.area] = v;
    }
    res.json({ mine: mine ? parse(mine.value) : null, defaults, sections: SECTIONS, board: isBoard(req.user) });
  })
);

router.put(
  '/case-sections',
  wrap(async (req, res) => {
    const d = parseBody(viewSchema, req, res);
    if (!d) return;
    db.prepare(
      `INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(req.user.id, KEY, JSON.stringify(d));
    res.json({ mine: d });
  })
);

router.delete(
  '/case-sections',
  wrap(async (req, res) => {
    db.prepare('DELETE FROM user_prefs WHERE user_id = ? AND key = ?').run(req.user.id, KEY);
    res.json({ mine: null });
  })
);

const areaOf = (req) => {
  const area = String(req.params.area || '');
  return require('../areas').exists(area) ? area : null;
};

router.put(
  '/case-sections/default/:area',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Die Standardansicht je Rechtsgebiet legt nur das Board of Partners fest.' });
    const area = areaOf(req);
    if (!area) return res.status(404).json({ error: 'Rechtsgebiet nicht gefunden.' });
    const d = parseBody(viewSchema, req, res);
    if (!d) return;
    db.prepare(
      `INSERT INTO case_section_defaults (area, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT(area) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`
    ).run(area, JSON.stringify(d), req.user.id);
    logActivity(req.user, 'Standardansicht der Akte', 'settings', 0, `Rechtsgebiet ${area}: ${d.order.join(', ')}`);
    res.json({ area, view: d });
  })
);

router.delete(
  '/case-sections/default/:area',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Die Standardansicht je Rechtsgebiet legt nur das Board of Partners fest.' });
    const area = areaOf(req);
    if (!area) return res.status(404).json({ error: 'Rechtsgebiet nicht gefunden.' });
    db.prepare('DELETE FROM case_section_defaults WHERE area = ?').run(area);
    res.json({ area, view: null });
  })
);

module.exports = { router, SECTIONS };
