'use strict';
/*
 * Mandantenstimmen (Bewertungen): Mandanten bewerten ihre abgeschlossenen Akten im Portal (1–5 Sterne, Text,
 * Namensanzeige). Auf der Website erscheinen Bewertungen erst, wenn das Board of Partners sie freigibt.
 *
 * /api/reviews              – eigene Bewertungen (Mandant) bzw. alle (Board of Partners)
 * /api/reviews/:id/decide   – freigeben oder ablehnen (Board)
 * /api/public/reviews       – freigegebene Bewertungen für die Startseite
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { wrap, parseBody, idParam, isBoard, truncate } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');

const AREA_LABEL = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
const NAME_MODES = ['voll', 'initialen', 'anonym'];

/** Anzeigename auf der Website je nach Wunsch des Mandanten. */
function publicName(r) {
  if (r.name_mode === 'voll' && r.author_name) return r.author_name;
  if (r.name_mode === 'initialen' && r.author_name) {
    return r.author_name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0].toUpperCase()}.`)
      .join(' ');
  }
  return 'Mandant';
}

function reviewRow(r, { withPrivate = false } = {}) {
  return {
    id: r.id,
    caseId: r.case_id,
    caseNumber: withPrivate ? r.case_number || null : undefined,
    rating: r.rating,
    body: r.body,
    nameMode: r.name_mode,
    displayName: publicName(r),
    authorName: withPrivate ? r.author_name : undefined,
    area: AREA_LABEL[r.area] || '',
    status: r.status,
    decidedBy: withPrivate ? r.decided_by_name || null : undefined,
    decidedAt: r.decided_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || null,
  };
}

const SELECT = `SELECT r.*, c.case_number FROM reviews r LEFT JOIN cases c ON c.id = r.case_id`;

/** Für die Akte des Mandanten: seine Bewertung und ob er (noch) bewerten kann. */
function reviewForCase(c, u) {
  if (u.role !== 'mandant' || c.client_id !== u.id) return undefined;
  const r = db.prepare(`${SELECT} WHERE r.case_id = ?`).get(c.id);
  return { canReview: c.status === 'geschlossen' && !r, review: r ? reviewRow(r) : null };
}

const router = express.Router();
router.use(requireAuth);

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(10).max(1000),
  nameMode: z.enum(NAME_MODES).default('initialen'),
});

/** Mandant: eigene Bewertungen · Board: alle (Filter status=neu|freigegeben|abgelehnt|alle). */
router.get('/', (req, res) => {
  const u = req.user;
  const open = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'neu'").get().n;
  if (isBoard(u)) {
    const status = ['neu', 'freigegeben', 'abgelehnt'].includes(req.query.status) ? req.query.status : null;
    const rows = db.prepare(`${SELECT} ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.status = 'neu' DESC, r.created_at DESC LIMIT 300`).all(...(status ? [status] : []));
    return res.json({ reviews: rows.map((r) => reviewRow(r, { withPrivate: true })), open });
  }
  const rows = db.prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC`).all(u.id);
  res.json({ reviews: rows.map((r) => reviewRow(r)), open: undefined });
});

/** Bewertung abgeben (Mandant, eigene abgeschlossene Akte, eine je Akte). */
router.post(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    if (u.role !== 'mandant') return res.status(403).json({ error: 'Bewerten können Mandanten ihre eigenen Akten.' });
    const d = parseBody(schema.extend({ caseId: z.number().int().positive() }), req, res);
    if (!d) return;
    const c = db.prepare('SELECT id, case_number, title, area, status, client_id FROM cases WHERE id = ?').get(d.caseId);
    if (!c || c.client_id !== u.id) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (c.status !== 'geschlossen') return res.status(400).json({ error: 'Bewerten können Sie, sobald die Akte abgeschlossen ist.' });
    if (db.prepare('SELECT 1 FROM reviews WHERE case_id = ?').get(c.id)) return res.status(409).json({ error: 'Zu dieser Akte haben Sie bereits eine Bewertung abgegeben.' });
    const info = db
      .prepare('INSERT INTO reviews (case_id, user_id, rating, body, name_mode, author_name, area) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, u.id, d.rating, d.body, d.nameMode, u.display_name, c.area || '');
    const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(info.lastInsertRowid));
    logActivity(u, 'Bewertung abgegeben', 'case', c.id, `${c.case_number}: ${'★'.repeat(d.rating)}`);
    discord.notify('review.created', {
      title: `${'★'.repeat(d.rating)}${'☆'.repeat(5 - d.rating)} Neue Mandantenstimme`,
      description: truncate(d.body, 600),
      fields: [
        { name: 'Akte', value: c.case_number },
        { name: 'Anzeige auf der Website', value: publicName(r) },
        { name: 'Freigabe', value: 'Dashboard → Mandantenstimmen' },
      ],
    });
    res.status(201).json({ review: reviewRow(r) });
  })
);

/** Eigene Bewertung ändern – danach ist eine erneute Freigabe nötig. */
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const r = id && db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    if (!r || r.user_id !== req.user.id) return res.status(404).json({ error: 'Bewertung nicht gefunden.' });
    const d = parseBody(schema, req, res);
    if (!d) return;
    db.prepare(
      "UPDATE reviews SET rating = ?, body = ?, name_mode = ?, status = 'neu', decided_by_name = '', decided_at = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(d.rating, d.body, d.nameMode, r.id);
    logActivity(req.user, 'Bewertung geändert', 'case', r.case_id, `${'★'.repeat(d.rating)}`);
    res.json({ review: reviewRow(db.prepare(`${SELECT} WHERE r.id = ?`).get(r.id)) });
  })
);

/** Board: freigeben oder ablehnen. */
router.post(
  '/:id/decide',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur das Board of Partners gibt Bewertungen frei.' });
    const id = idParam(req);
    const r = id && db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    if (!r) return res.status(404).json({ error: 'Bewertung nicht gefunden.' });
    const d = parseBody(z.object({ status: z.enum(['freigegeben', 'abgelehnt']) }), req, res);
    if (!d) return;
    db.prepare("UPDATE reviews SET status = ?, decided_by_name = ?, decided_at = datetime('now') WHERE id = ?").run(d.status, req.user.display_name, r.id);
    logActivity(req.user, d.status === 'freigegeben' ? 'Bewertung veröffentlicht' : 'Bewertung abgelehnt', 'case', r.case_id, `${'★'.repeat(r.rating)} · ${truncate(r.body, 80)}`);
    res.json({ review: reviewRow(db.prepare(`${SELECT} WHERE r.id = ?`).get(r.id), { withPrivate: true }) });
  })
);

/** Löschen: der Mandant seine eigene, das Board jede. */
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const r = id && db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    if (!r || (r.user_id !== req.user.id && !isBoard(req.user))) return res.status(404).json({ error: 'Bewertung nicht gefunden.' });
    db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
    logActivity(req.user, 'Bewertung gelöscht', 'case', r.case_id, `${'★'.repeat(r.rating)} · ${truncate(r.body, 80)}`);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Öffentlich: freigegebene Bewertungen */
const publicRouter = express.Router();
publicRouter.get('/reviews', (req, res) => {
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'freigegeben' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 12").all();
  res.json({
    reviews: rows.map((r) => ({ rating: r.rating, body: r.body, name: publicName(r), area: AREA_LABEL[r.area] || '', date: r.created_at })),
  });
});

module.exports = { router, publicRouter, reviewForCase, publicName };
