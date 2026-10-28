'use strict';
/*
 * Website selbst pflegen:
 *  - Ränge anlegen, ändern, verschieben, löschen (Einstellungen → Ränge, nur Board-Rolle)
 *  - Website-Texte direkt auf der Seite ändern (?bearbeiten, Board of Partners)
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { requirePerm } = require('../permissions');
const configLog = require('../configLog');
const { wrap, parseBody, idParam, isBoard, truncate } = require('../helpers');
const { logActivity } = require('../models');
const ranks = require('../ranks');
const sitePages = require('../sitePages');

const router = express.Router();
router.use(requireAuth);

/* ---------------------------------------------------------------- Ränge */
const rankBody = z.object({
  name: z.string().trim().min(2).max(40),
  level: z.enum(['board', 'associate']),
  badge: z.string().trim().max(30).default(''),
  description: z.string().trim().max(600).default(''),
  footer: z.string().trim().max(80).default(''),
});

router.get('/ranks', (req, res) => res.json({ ranks: ranks.list() }));

router.post(
  '/ranks',
  requirePerm('site.edit'),
  wrap(async (req, res) => {
    const d = parseBody(rankBody, req, res);
    if (!d) return;
    const r = ranks.create(d);
    logActivity(req.user, 'Rang angelegt', 'settings', r.id, `${r.name} (${ranks.LEVELS[r.level]})`);
    res.status(201).json({ ranks: ranks.list() });
  })
);

router.patch(
  '/ranks/:id',
  requirePerm('site.edit'),
  wrap(async (req, res) => {
    const id = idParam(req);
    const d = parseBody(rankBody.partial(), req, res);
    if (!d) return;
    const before = id && ranks.byId(id);
    if (!before) return res.status(404).json({ error: 'Rang nicht gefunden.' });
    const r = ranks.update(id, d);
    logActivity(req.user, 'Rang geändert', 'settings', id, r.name === before.name ? r.name : `${before.name} → ${r.name}`);
    res.json({ ranks: ranks.list() });
  })
);

router.post(
  '/ranks/:id/move',
  requirePerm('site.edit'),
  wrap(async (req, res) => {
    const d = parseBody(z.object({ dir: z.union([z.literal(-1), z.literal(1)]) }), req, res);
    if (!d) return;
    if (!ranks.move(idParam(req), d.dir)) return res.status(404).json({ error: 'Rang nicht gefunden.' });
    res.json({ ranks: ranks.list() });
  })
);

router.delete(
  '/ranks/:id',
  requirePerm('site.edit'),
  wrap(async (req, res) => {
    const r = ranks.remove(idParam(req));
    if (r.notFound) return res.status(404).json({ error: 'Rang nicht gefunden.' });
    if (r.error) return res.status(409).json({ error: r.error });
    logActivity(req.user, 'Rang gelöscht', 'settings', r.rank.id, r.rank.name);
    res.json({ ranks: ranks.list() });
  })
);

/* ---------------------------------------------------------------- Website-Texte */
const boardOnly = requirePerm('site.edit'); // Website-Texte: Inhaber / Web-Admin
const PAGE_LABEL = { index: 'Startseite', karriere: 'Karriere' };

router.get('/texts', boardOnly, (req, res) => {
  const rows = db
    .prepare('SELECT s.page, s.key, s.original, s.text, s.updated_at AS updatedAt, u.display_name AS updatedBy FROM site_texts s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.updated_at DESC')
    .all();
  res.json({ texts: rows.map((r) => ({ ...r, pageLabel: PAGE_LABEL[r.page] || r.page })) });
});

const textBody = z.object({ page: z.enum(Object.keys(sitePages.PAGES)), key: z.string().regex(/^[0-9a-f]{12}$/), text: z.string().max(2000) });

router.put(
  '/texts',
  boardOnly,
  wrap(async (req, res) => {
    const d = parseBody(textBody, req, res);
    if (!d) return;
    const original = sitePages.texts(d.page).get(d.key);
    if (original === undefined) return res.status(404).json({ error: 'Diesen Text gibt es auf der Seite nicht mehr – bitte neu laden.' });
    const text = d.text.replace(/\s+/g, ' ').trim();
    const prev = db.prepare('SELECT original, text FROM site_texts WHERE page = ? AND key = ?').get(d.page, d.key);
    const logText = (after) =>
      configLog.add(req.user, { area: 'site_text', key: `${d.page}:${d.key}`, label: `Website-Text (${PAGE_LABEL[d.page]})`, perm: 'site.edit', before: prev ? { original: prev.original, text: prev.text } : null, after, revertible: true });
    if (!text || text === original) {
      if (prev) logText(null);
      db.prepare('DELETE FROM site_texts WHERE page = ? AND key = ?').run(d.page, d.key);
      return res.json({ text: original, original, changed: false });
    }
    db.prepare(
      `INSERT INTO site_texts (page, key, original, text, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(page, key) DO UPDATE SET original = excluded.original, text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).run(d.page, d.key, original, text, req.user.id);
    if (!prev || prev.text !== text) logText({ original, text });
    logActivity(req.user, 'Website-Text geändert', 'settings', null, `${PAGE_LABEL[d.page]}: „${truncate(original, 60)}“ → „${truncate(text, 60)}“`);
    res.json({ text, original, changed: true });
  })
);

router.delete(
  '/texts/:page/:key',
  boardOnly,
  wrap(async (req, res) => {
    const { page, key } = req.params;
    const row = db.prepare('SELECT original, text FROM site_texts WHERE page = ? AND key = ?').get(page, key);
    if (!row) return res.status(404).json({ error: 'Der Text ist nicht geändert.' });
    configLog.add(req.user, { area: 'site_text', key: `${page}:${key}`, label: `Website-Text (${PAGE_LABEL[page] || page}) zurückgesetzt`, perm: 'site.edit', before: { original: row.original, text: row.text }, after: null, revertible: true });
    db.prepare('DELETE FROM site_texts WHERE page = ? AND key = ?').run(page, key);
    logActivity(req.user, 'Website-Text zurückgesetzt', 'settings', null, `${PAGE_LABEL[page] || page}: „${truncate(row.original, 60)}“`);
    res.json({ text: row.original });
  })
);

module.exports = router;
