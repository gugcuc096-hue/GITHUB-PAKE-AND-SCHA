'use strict';
/*
 * Präzedenzfälle (Kanzlei-Wiki → „Präzedenzfälle“), nur Kanzlei:
 *  GET    /api/precedents?q&area&outcome&tag    Liste (ohne lange Texte) + Schlagworte
 *  GET    /api/precedents/draft/:caseId         Entwurf aus einer Akte (Titel, Sachverhalt, Ergebnis, Strafmaß, Paragraphen)
 *  GET    /api/precedents/:id                   ein Eintrag mit allen Texten
 *  POST   /api/precedents                       anlegen (jede Kanzlei-Person)
 *  PATCH  /api/precedents/:id                   ändern (wer ihn angelegt hat, das Board)
 *  DELETE /api/precedents/:id                   löschen (wer ihn angelegt hat, das Board)
 * Die Aktennummer zu einem Eintrag sieht nur, wer die Akte selbst einsehen darf.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, idParam, isBoard } = require('../helpers');
const { getCase, caseAccess, logActivity, addSystemNote } = require('../models');
const precedents = require('../precedents');

const router = express.Router();
router.use(requireAuth, requireStaff);

const problems = (err) => (err.issues ? err.issues.map((i) => `${i.path.join('.') || 'Angabe'}: ${i.message}`).join(' ') : err.message);
const guard = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || (err.issues ? 400 : 500)).json({ error: problems(err) });
    }
  });

/** Aktennummer nur, wenn die Person die Akte sehen darf. */
function caseNumberFor(r, user) {
  if (!r.case_id) return null;
  const c = getCase(r.case_id);
  return c && caseAccess(c, user).canView ? c.case_number : null;
}
const full = (r, user) => precedents.row(r, { caseNumber: caseNumberFor(r, user) });
const brief = (r, user) => {
  const x = full(r, user);
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return { ...x, summary: cut(x.summary, 220), arguments: cut(x.arguments, 160), result: cut(x.result, 160), lessons: '' };
};
const canChange = (r, user) => isBoard(user) || r.created_by_id === user.id;
const load = (req, res) => {
  const id = idParam(req);
  const r = id && db.prepare('SELECT * FROM precedents WHERE id = ?').get(id);
  if (!r) res.status(404).json({ error: 'Präzedenzfall nicht gefunden.' });
  return r || null;
};

router.get('/', (req, res) => {
  const { q, area, outcome, tag } = req.query;
  const rows = precedents.search({ q: String(q || ''), area: String(area || ''), outcome: String(outcome || ''), tag: String(tag || '') });
  res.json({ precedents: rows.map((r) => brief(r, req.user)), ...precedents.meta() });
});

router.get(
  '/draft/:caseId',
  guard((req, res) => {
    const c = getCase(Number(req.params.caseId));
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const existing = db.prepare('SELECT id FROM precedents WHERE case_id = ?').get(c.id);
    res.json({ draft: precedents.draftFromCase(c), existingId: existing ? existing.id : null });
  })
);

router.get('/:id', (req, res) => {
  const r = load(req, res);
  if (r) res.json({ precedent: full(r, req.user), canEdit: canChange(r, req.user) });
});

router.post(
  '/',
  guard((req, res) => {
    // Eine Akte als Vorlage: nur eine, die die Person sehen darf
    if (req.body && req.body.caseId) {
      const c = getCase(Number(req.body.caseId));
      if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    }
    const id = precedents.create(req.body, req.user);
    const r = db.prepare('SELECT * FROM precedents WHERE id = ?').get(id);
    logActivity(req.user, 'Präzedenzfall angelegt', 'precedent', id, r.title);
    if (r.case_id) addSystemNote(r.case_id, req.user, 'Als Präzedenzfall festgehalten.', true);
    res.status(201).json({ precedent: full(r, req.user), canEdit: true });
  })
);

router.patch(
  '/:id',
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    if (!canChange(r, req.user)) return res.status(403).json({ error: 'Ändern kann, wer den Eintrag angelegt hat, oder das Board of Partners.' });
    if (req.body && req.body.caseId && req.body.caseId !== r.case_id) {
      const c = getCase(Number(req.body.caseId));
      if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    }
    precedents.update(r.id, req.body);
    const next = db.prepare('SELECT * FROM precedents WHERE id = ?').get(r.id);
    res.json({ precedent: full(next, req.user), canEdit: true });
  })
);

router.delete(
  '/:id',
  guard((req, res) => {
    const r = load(req, res);
    if (!r) return;
    if (!canChange(r, req.user)) return res.status(403).json({ error: 'Löschen kann, wer den Eintrag angelegt hat, oder das Board of Partners.' });
    db.prepare('DELETE FROM precedents WHERE id = ?').run(r.id);
    logActivity(req.user, 'Präzedenzfall gelöscht', 'precedent', r.id, r.title);
    res.json({ success: true });
  })
);

module.exports = { router };
