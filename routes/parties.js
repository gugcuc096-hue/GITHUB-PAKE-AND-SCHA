'use strict';
/*
 * Beteiligte einer Akte (nur Kanzlei, ändern dürfen die zuständigen Anwälte):
 *  POST   /api/cases/:id/parties           { role, name, contact? }
 *  PATCH  /api/cases/:id/parties/:pid      { role?, name?, contact? }
 *  DELETE /api/cases/:id/parties/:pid
 * Jede Antwort liefert die vollständige Liste.
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { getCase, caseAccess, addSystemNote } = require('../models');
const parties = require('../parties');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

function load(req, res) {
  const id = idParam(req);
  const c = id && getCase(id);
  const access = c ? caseAccess(c, req.user) : null;
  if (!c || !isStaff(req.user) || !access.canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  if (!access.canEdit) {
    res.status(403).json({ error: 'Beteiligte ändern nur die zuständigen Anwälte.' });
    return null;
  }
  return c;
}

const body = z.object({
  role: z.enum(Object.keys(parties.ROLES)),
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().max(160).optional(),
});

router.post(
  '/',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const d = parseBody(body, req, res);
    if (!d) return;
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_parties WHERE case_id = ?').get(c.id).n;
    if (count >= 40) return res.status(400).json({ error: 'Höchstens 40 Beteiligte je Akte.' });
    db.prepare('INSERT INTO case_parties (case_id, role, name, contact, created_by) VALUES (?, ?, ?, ?, ?)').run(c.id, d.role, d.name, d.contact || '', req.user.display_name);
    addSystemNote(c.id, req.user, `Beteiligter: ${parties.ROLES[d.role]} ${d.name}`, true);
    res.status(201).json({ parties: parties.listForCase(c.id) });
  })
);

router.patch(
  '/:pid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const pid = idParam(req, 'pid');
    const p = pid && db.prepare('SELECT * FROM case_parties WHERE id = ? AND case_id = ?').get(pid, c.id);
    if (!p) return res.status(404).json({ error: 'Beteiligter nicht gefunden.' });
    const d = parseBody(body.partial(), req, res);
    if (!d) return;
    db.prepare('UPDATE case_parties SET role = ?, name = ?, contact = ? WHERE id = ?').run(d.role ?? p.role, d.name ?? p.name, d.contact ?? p.contact, p.id);
    res.json({ parties: parties.listForCase(c.id) });
  })
);

router.delete(
  '/:pid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const pid = idParam(req, 'pid');
    const p = pid && db.prepare('SELECT * FROM case_parties WHERE id = ? AND case_id = ?').get(pid, c.id);
    if (!p) return res.status(404).json({ error: 'Beteiligter nicht gefunden.' });
    db.prepare('DELETE FROM case_parties WHERE id = ?').run(p.id);
    addSystemNote(c.id, req.user, `Beteiligter entfernt: ${p.name}`, true);
    res.json({ parties: parties.listForCase(c.id) });
  })
);

module.exports = { router };
