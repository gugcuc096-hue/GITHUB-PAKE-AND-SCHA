'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { boardRow } = require('../models');

// Team-Pinnwand: interne Notizen, Hinweise und To-dos für das ganze Team.
const router = express.Router();
router.use(requireAuth, requireStaff);

const COLORS = ['gold', 'blue', 'green', 'red', 'slate'];
const schema = z.object({
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(4000),
  color: z.enum(COLORS).optional(),
  pinned: z.boolean().optional(),
});

function load(id) {
  return db.prepare('SELECT * FROM board_notes WHERE id = ?').get(id) || null;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM board_notes ORDER BY pinned DESC, updated_at DESC, id DESC').all();
  res.json({ notes: rows.map(boardRow) });
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(schema, req, res);
    if (!d) return;
    const info = db
      .prepare('INSERT INTO board_notes (author_id, author_name, title, body, color, pinned) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, req.user.display_name, d.title || '', d.body, d.color || 'gold', d.pinned ? 1 : 0);
    res.status(201).json({ note: boardRow(load(Number(info.lastInsertRowid))) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const n = id && load(id);
    if (!n) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
    const d = parseBody(schema.partial(), req, res);
    if (!d) return;
    // Anheften darf jeder; Inhalt ändern nur Autor oder Kanzleileitung.
    const contentChange = d.title !== undefined || d.body !== undefined || d.color !== undefined;
    if (contentChange && n.author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sie können nur eigene Notizen bearbeiten.' });
    }
    db.prepare(
      `UPDATE board_notes SET title = ?, body = ?, color = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      d.title ?? n.title,
      d.body ?? n.body,
      d.color ?? n.color,
      d.pinned === undefined ? n.pinned : d.pinned ? 1 : 0,
      n.id
    );
    res.json({ note: boardRow(load(n.id)) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const n = id && load(id);
    if (!n) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
    if (n.author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sie können nur eigene Notizen löschen.' });
    }
    db.prepare('DELETE FROM board_notes WHERE id = ?').run(n.id);
    res.json({ success: true });
  })
);

module.exports = router;
