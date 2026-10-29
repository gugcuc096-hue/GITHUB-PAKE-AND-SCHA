'use strict';
/*
 * Co-Pilot der Akte (nur Kanzlei, siehe assistant.js – regelbasiert, ohne KI-Dienst):
 *  GET  /api/cases/:id/copilot          Zusammenfassung, Lücken und Risiken, Fragen und Entwürfe zur Auswahl
 *  POST /api/cases/:id/copilot/ask      { q }     Antwort auf eine Frage
 *  POST /api/cases/:id/copilot/draft    { kind }  Entwurf eines Textes aus den Aktendaten
 * Er liest nur, was die Person in der Akte ohnehin sieht, und schreibt nie in die Akte.
 */
const express = require('express');
const { z } = require('zod');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { getCase, caseAccess } = require('../models');
const assistant = require('../assistant');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

/** Akte samt allem, was die Person sieht (dieselbe Antwort wie die Aktenansicht). */
function load(req, res) {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !isStaff(req.user) || !caseAccess(c, req.user).canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  return require('./cases').caseDetail(c, req.user, { lean: true });
}

router.get(
  '/',
  wrap(async (req, res) => {
    const d = load(req, res);
    if (!d) return;
    const now = new Date();
    res.json({
      now: now.toISOString(),
      summary: assistant.summary(d, now),
      gaps: assistant.gaps(d, now),
      questions: assistant.INTENTS.map(({ id, label }) => ({ id, label })),
      drafts: assistant.DRAFTS,
    });
  })
);

router.post(
  '/ask',
  wrap(async (req, res) => {
    const d = load(req, res);
    if (!d) return;
    const body = parseBody(z.object({ q: z.string().trim().min(2).max(300) }), req, res);
    if (!body) return;
    res.json({ answer: assistant.answer(d, body.q) });
  })
);

router.post(
  '/draft',
  wrap(async (req, res) => {
    const d = load(req, res);
    if (!d) return;
    const body = parseBody(z.object({ kind: z.enum(assistant.DRAFTS.map((x) => x.id)) }), req, res);
    if (!body) return;
    res.json({ draft: assistant.draft(d, body.kind) });
  })
);

module.exports = { router };
