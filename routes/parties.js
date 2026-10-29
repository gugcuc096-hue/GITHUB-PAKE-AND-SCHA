'use strict';
/*
 * Beteiligte einer Akte (nur Kanzlei, ändern dürfen die zuständigen Anwälte):
 *  POST   /api/cases/:id/parties           { role, name, contact? }
 *  PATCH  /api/cases/:id/parties/:pid      { role?, name?, contact?, side?, status?, summonAt?, expected?, statement? }
 *  DELETE /api/cases/:id/parties/:pid
 *  POST   /api/cases/:id/parties/:pid/contradictions        { text, ref? }   Vorhalt zu einer Aussage
 *  DELETE /api/cases/:id/parties/:pid/contradictions/:cid
 * Zeugen führen zusätzlich Lager, Stand, Ladungstermin sowie erwartete und tatsächliche Aussage (nur Kanzlei).
 * Jede Antwort liefert die vollständige Liste.
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime } = require('../helpers');
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
  side: z.enum(['', ...Object.keys(parties.SIDES)]).optional(),
  status: z.enum(Object.keys(parties.STATUS)).optional(),
  summonAt: isoDateTime.nullable().optional(),
  expected: z.string().trim().max(2000).optional(),
  statement: z.string().trim().max(6000).optional(),
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
    db.prepare(
      'INSERT INTO case_parties (case_id, role, name, contact, created_by, side, status, summon_at, expected, statement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(c.id, d.role, d.name, d.contact || '', req.user.display_name, d.side || '', d.status || 'offen', d.summonAt ? new Date(d.summonAt).toISOString() : null, d.expected || '', d.statement || '');
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
    const summon = d.summonAt === undefined ? p.summon_at : d.summonAt ? new Date(d.summonAt).toISOString() : null;
    db.prepare('UPDATE case_parties SET role = ?, name = ?, contact = ?, side = ?, status = ?, summon_at = ?, expected = ?, statement = ? WHERE id = ?').run(
      d.role ?? p.role,
      d.name ?? p.name,
      d.contact ?? p.contact,
      d.side ?? p.side,
      d.status ?? p.status,
      summon,
      d.expected ?? p.expected,
      d.statement ?? p.statement,
      p.id
    );
    // Wichtige Wechsel stehen im Verlauf (nur Kanzlei): Stand und Ladungstermin
    if (d.status && d.status !== p.status) addSystemNote(c.id, req.user, `${parties.ROLES[p.role] || 'Beteiligter'} ${p.name}: ${parties.STATUS[d.status]}`, true);
    if (d.summonAt !== undefined && summon !== p.summon_at && summon) {
      addSystemNote(c.id, req.user, `${p.name}: Ladung zum ${new Date(summon).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' })} Uhr`, true);
    }
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

/* Vorhalte: Widersprüche zwischen Aussagen oder zu Beweisen, je Zeuge */
router.post(
  '/:pid/contradictions',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const pid = idParam(req, 'pid');
    const p = pid && db.prepare('SELECT * FROM case_parties WHERE id = ? AND case_id = ?').get(pid, c.id);
    if (!p) return res.status(404).json({ error: 'Beteiligter nicht gefunden.' });
    const d = parseBody(z.object({ text: z.string().trim().min(3).max(1000), ref: z.string().trim().max(80).optional() }), req, res);
    if (!d) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM party_contradictions WHERE party_id = ?').get(p.id).n >= 20) return res.status(400).json({ error: 'Höchstens 20 Vorhalte je Person.' });
    db.prepare('INSERT INTO party_contradictions (party_id, case_id, text, ref, created_by) VALUES (?, ?, ?, ?, ?)').run(p.id, c.id, d.text, d.ref || '', req.user.display_name);
    addSystemNote(c.id, req.user, `Vorhalt zu ${p.name}${d.ref ? ` (${d.ref})` : ''}: ${d.text.length > 120 ? `${d.text.slice(0, 119)}…` : d.text}`, true);
    res.status(201).json({ parties: parties.listForCase(c.id) });
  })
);

router.delete(
  '/:pid/contradictions/:cid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const pid = idParam(req, 'pid');
    const cid = idParam(req, 'cid');
    const row = pid && cid && db.prepare('SELECT * FROM party_contradictions WHERE id = ? AND party_id = ? AND case_id = ?').get(cid, pid, c.id);
    if (!row) return res.status(404).json({ error: 'Vorhalt nicht gefunden.' });
    db.prepare('DELETE FROM party_contradictions WHERE id = ?').run(row.id);
    res.json({ parties: parties.listForCase(c.id) });
  })
);

module.exports = { router };
