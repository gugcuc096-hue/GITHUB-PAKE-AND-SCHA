'use strict';
/*
 * Fehlende Unterlagen einer Akte:
 *  POST   /api/cases/:id/requests            { title, note? }      – Kanzlei (zuständige Anwälte): Unterlage anfordern
 *  PATCH  /api/cases/:id/requests/:rid       { done }              – Kanzlei oder Mandant der Akte: erledigt / wieder offen
 *  DELETE /api/cases/:id/requests/:rid                             – Kanzlei (zuständige Anwälte)
 *  GET    /api/requests/mine                                       – Mandant: offene Anforderungen aller seiner Akten
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { getCase, caseAccess, addSystemNote } = require('../models');
const requests = require('../docRequests');

const caseRouter = express.Router({ mergeParams: true });
const mineRouter = express.Router();
caseRouter.use(requireAuth);
mineRouter.use(requireAuth);

function load(req, res, { edit }) {
  const id = idParam(req);
  const c = id && getCase(id);
  const access = c ? caseAccess(c, req.user) : null;
  if (!c || !access.canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  if (edit && !access.canEdit) {
    res.status(403).json({ error: 'Unterlagen fordern nur die zuständigen Anwälte an.' });
    return null;
  }
  return c;
}

caseRouter.post(
  '/',
  wrap(async (req, res) => {
    if (!isStaff(req.user)) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const c = load(req, res, { edit: true });
    if (!c) return;
    const d = parseBody(z.object({ title: z.string().trim().min(2).max(120), note: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM case_requests WHERE case_id = ? AND done_at IS NULL').get(c.id).n >= 20) {
      return res.status(400).json({ error: 'Höchstens 20 offene Anforderungen je Akte.' });
    }
    const info = db.prepare('INSERT INTO case_requests (case_id, title, note, created_by) VALUES (?, ?, ?, ?)').run(c.id, d.title, d.note || '', req.user.display_name);
    const r = requests.listForCase(c.id).find((x) => x.id === Number(info.lastInsertRowid));
    addSystemNote(c.id, req.user, `Unterlage angefordert: ${d.title}`, false);
    requests.announce(c.id, { title: d.title, note: d.note || '' }, req.user);
    res.status(201).json({ request: r, requests: requests.listForCase(c.id) });
  })
);

caseRouter.patch(
  '/:rid',
  wrap(async (req, res) => {
    const c = load(req, res, {});
    if (!c) return;
    const rid = idParam(req, 'rid');
    const r = rid && db.prepare('SELECT * FROM case_requests WHERE id = ? AND case_id = ?').get(rid, c.id);
    if (!r) return res.status(404).json({ error: 'Anforderung nicht gefunden.' });
    const d = parseBody(z.object({ done: z.boolean() }), req, res);
    if (!d) return;
    if (d.done) db.prepare("UPDATE case_requests SET done_at = datetime('now'), done_by = ? WHERE id = ?").run(req.user.display_name, r.id);
    else db.prepare("UPDATE case_requests SET done_at = NULL, done_by = '', reminded_at = NULL WHERE id = ?").run(r.id);
    if (d.done && r.done_at == null) {
      addSystemNote(c.id, req.user, `Unterlage ${isStaff(req.user) ? 'erledigt' : 'vom Mandanten als nachgereicht gemeldet'}: ${r.title}`, true);
    }
    res.json({ requests: requests.listForCase(c.id) });
  })
);

caseRouter.delete(
  '/:rid',
  wrap(async (req, res) => {
    if (!isStaff(req.user)) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const c = load(req, res, { edit: true });
    if (!c) return;
    const rid = idParam(req, 'rid');
    const r = rid ? db.prepare('DELETE FROM case_requests WHERE id = ? AND case_id = ?').run(rid, c.id) : { changes: 0 };
    if (!r.changes) return res.status(404).json({ error: 'Anforderung nicht gefunden.' });
    res.json({ requests: requests.listForCase(c.id) });
  })
);

mineRouter.get('/mine', (req, res) => {
  res.json({ requests: req.user.role === 'mandant' ? requests.openForClient(req.user.id) : [] });
});

module.exports = { caseRouter, mineRouter };
