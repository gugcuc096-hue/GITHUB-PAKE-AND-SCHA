'use strict';
/* Einarbeitung neuer Anwälte (Checkliste + Mentor) – sichtbar für das Board, den Mentor und die Person selbst. */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard, truncate, BOARD_RANK_SQL } = require('../helpers');
const { logActivity } = require('../models');
const onboarding = require('../onboarding');

const router = express.Router();
router.use(requireAuth, requireStaff);

const boardOnly = (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Nur für das Board of Partners.' }));

function entry(o) {
  const items = db.prepare('SELECT id, label, done_at AS doneAt, done_by AS doneBy FROM onboarding_items WHERE user_id = ? ORDER BY sort, id').all(o.user_id);
  return {
    userId: o.user_id,
    name: o.name,
    rank: o.rank || null,
    mentor: o.mentor_id ? { id: o.mentor_id, name: o.mentor_name } : null,
    startedAt: o.started_at,
    doneAt: o.done_at,
    items,
    done: items.filter((i) => i.doneAt).length,
    total: items.length,
  };
}

const SELECT = `SELECT o.*, u.display_name AS name, u.rank, m.display_name AS mentor_name
  FROM onboarding o JOIN users u ON u.id = o.user_id LEFT JOIN users m ON m.id = o.mentor_id
  WHERE u.active = 1`;

/** Darf diese Einarbeitung sehen und abhaken: Board, Mentor oder die Person selbst. */
const mayTick = (u, o) => isBoard(u) || o.user_id === u.id || o.mentor_id === u.id;

router.get('/', (req, res) => {
  const u = req.user;
  // Fertige Einarbeitungen bleiben noch 14 Tage sichtbar
  const rows = db
    .prepare(`${SELECT} AND (o.done_at IS NULL OR o.done_at > datetime('now', '-14 days')) ORDER BY o.done_at IS NOT NULL, o.started_at DESC`)
    .all()
    .filter((o) => mayTick(u, o));
  const board = isBoard(u);
  res.json({
    board,
    list: rows.map(entry),
    mentors: board ? db.prepare(`SELECT id, display_name AS name FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'anwalt' AND ${BOARD_RANK_SQL()})) ORDER BY display_name`).all() : [],
    candidates: board
      ? db.prepare("SELECT id, display_name AS name FROM users WHERE active = 1 AND role = 'anwalt' AND id NOT IN (SELECT user_id FROM onboarding) ORDER BY display_name").all()
      : [],
    template: board ? onboarding.template() : undefined,
  });
});

router.post(
  '/',
  boardOnly,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ userId: z.number().int().positive(), mentorId: z.number().int().positive().nullable().optional() }), req, res);
    if (!d) return;
    const u = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND active = 1 AND role IN ('anwalt','admin')").get(d.userId);
    if (!u) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    if (!onboarding.start(u.id, d.mentorId ?? req.user.id)) return res.status(409).json({ error: 'Die Einarbeitung läuft schon.' });
    logActivity(req.user, 'Einarbeitung begonnen', 'user', u.id, u.display_name);
    res.status(201).json({ success: true });
  })
);

router.patch(
  '/:userId',
  boardOnly,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ mentorId: z.number().int().positive().nullable() }), req, res);
    if (!d) return;
    const userId = Number(req.params.userId);
    if (d.mentorId && !db.prepare(`SELECT 1 FROM users WHERE id = ? AND active = 1 AND (role = 'admin' OR (role = 'anwalt' AND ${BOARD_RANK_SQL()}))`).get(d.mentorId))
      return res.status(400).json({ error: 'Mentor muss zum Board of Partners gehören.' });
    const r = db.prepare('UPDATE onboarding SET mentor_id = ? WHERE user_id = ?').run(d.mentorId, userId);
    if (!r.changes) return res.status(404).json({ error: 'Keine Einarbeitung gefunden.' });
    res.json({ success: true });
  })
);

router.post(
  '/:userId/items',
  boardOnly,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ label: z.string().trim().min(2).max(160) }), req, res);
    if (!d) return;
    const userId = Number(req.params.userId);
    if (!db.prepare('SELECT 1 FROM onboarding WHERE user_id = ?').get(userId)) return res.status(404).json({ error: 'Keine Einarbeitung gefunden.' });
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM onboarding_items WHERE user_id = ?').get(userId).s;
    db.prepare('INSERT INTO onboarding_items (user_id, label, sort) VALUES (?, ?, ?)').run(userId, d.label, sort);
    onboarding.refreshDone(userId);
    res.status(201).json({ success: true });
  })
);

router.patch(
  '/items/:id',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ done: z.boolean() }), req, res);
    if (!d) return;
    const item = db.prepare('SELECT i.*, o.mentor_id FROM onboarding_items i JOIN onboarding o ON o.user_id = i.user_id WHERE i.id = ?').get(idParam(req));
    if (!item || !mayTick(req.user, item)) return res.status(404).json({ error: 'Punkt nicht gefunden.' });
    db.prepare(`UPDATE onboarding_items SET done_at = ${d.done ? "datetime('now')" : 'NULL'}, done_by = ? WHERE id = ?`).run(d.done ? req.user.display_name : '', item.id);
    onboarding.refreshDone(item.user_id);
    if (d.done) logActivity(req.user, 'Einarbeitung: Punkt erledigt', 'user', item.user_id, truncate(item.label, 120));
    res.json({ success: true });
  })
);

router.delete(
  '/:userId',
  boardOnly,
  wrap(async (req, res) => {
    const userId = Number(req.params.userId);
    db.prepare('DELETE FROM onboarding_items WHERE user_id = ?').run(userId);
    const r = db.prepare('DELETE FROM onboarding WHERE user_id = ?').run(userId);
    if (!r.changes) return res.status(404).json({ error: 'Keine Einarbeitung gefunden.' });
    logActivity(req.user, 'Einarbeitung beendet', 'user', userId, '');
    res.json({ success: true });
  })
);

module.exports = router;
