'use strict';
/*
 * /api/fivenet: Verbindungsstatus, Link-Prüfung und Erreichbarkeit der Instanz.
 * Das Verknüpfen mit Akten übernimmt routes/external.js (FiveNet und Google Docs).
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff, requireAdmin } = require('../auth');
const { wrap, parseBody } = require('../helpers');
const fivenet = require('../fivenet');

/* ---------------------------------------------------------------- /api/fivenet */
const router = express.Router();
router.use(requireAuth, requireStaff);

/** Verbindungsstatus, Schnittstellenprüfung und Vorschläge für das Formular. */
router.get('/status', (req, res) => {
  const inst = fivenet.instance();
  const last = db
    .prepare("SELECT viewed_as FROM case_external_docs WHERE linked_by = ? AND viewed_as != '' ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  const used = db
    .prepare("SELECT doc_type, COUNT(*) AS n FROM case_external_docs WHERE doc_type != '' GROUP BY doc_type ORDER BY n DESC LIMIT 30")
    .all()
    .map((r) => r.doc_type);
  const counts = db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT external_id) AS docs FROM case_external_docs WHERE provider = 'fivenet'").get();
  res.json({
    instance: { url: inst.url, host: inst.host, source: inst.source, valid: inst.valid },
    capabilities: fivenet.CAPABILITIES,
    interfaces: fivenet.INTERFACES,
    docTypes: [...new Set([...used, ...fivenet.DOC_TYPES])],
    lastViewedAs: last ? last.viewed_as : '',
    stats: { links: counts.n, documents: counts.docs },
  });
});

/**
 * Erkennt ein Dokument aus einer eingefügten Adresse und meldet vorhandene
 * Verknüpfungen (für die Live-Prüfung im Dialog und die Dublettenwarnung).
 */
router.post(
  '/resolve',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ input: z.string().max(600), caseId: z.number().int().positive().optional() }), req, res);
    if (!d) return;
    const ref = fivenet.parseDocumentRef(d.input);
    if (!ref.ok) return res.status(400).json({ error: ref.error });
    const links = db
      .prepare(
        `SELECT e.id, e.case_id, e.linked_by_name, e.linked_at, e.title, c.case_number, c.title AS case_title
         FROM case_external_docs e JOIN cases c ON c.id = e.case_id
         WHERE e.provider = 'fivenet' AND e.external_id = ? ORDER BY c.case_number`
      )
      .all(ref.documentId);
    const here = d.caseId ? links.find((l) => l.case_id === d.caseId) : null;
    // Bereits erfasster Titel aus einer anderen Akte als Vorschlag (spart Abtippen).
    const known = links.find((l) => l.title);
    res.json({
      documentId: ref.documentId,
      url: ref.canonicalUrl,
      host: ref.host,
      linkedHere: here ? { id: here.id, linkedByName: here.linked_by_name, linkedAt: here.linked_at } : null,
      otherCases: links.filter((l) => l.case_id !== d.caseId).map((l) => ({ id: l.case_id, caseNumber: l.case_number, title: l.case_title })),
      suggestedTitle: known ? known.title : '',
    });
  })
);

/** Erreichbarkeit der FiveNet-Instanz prüfen (öffentlicher Endpunkt /api/version). */
router.post(
  '/check',
  requireAdmin,
  wrap(async (req, res) => {
    const inst = fivenet.instance();
    res.json({ instance: { url: inst.url, host: inst.host }, result: await fivenet.checkInstance(inst) });
  })
);

module.exports = { router };
