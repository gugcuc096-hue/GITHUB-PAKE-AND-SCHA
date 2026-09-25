'use strict';
/*
 * FiveNet-Dokumente in Akten. Die Kanzlei ruft FiveNet dabei nie im Namen eines
 * Benutzers auf (siehe fivenet.js): gespeichert wird eine geprüfte Referenz.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff, requireAdmin, isStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, truncate, MAX_ATTACHMENTS_PER_CASE } = require('../helpers');
const { getCase, caseAccess, addSystemNote, externalDocRow, logActivity } = require('../models');
const { saveImageBuffer } = require('../uploads');
const fivenet = require('../fivenet');

const MAX_DOCS_PER_CASE = 100;
const MAX_IMAGES_PER_IMPORT = 10;

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
  const counts = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT external_id) AS docs FROM case_external_docs').get();
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

/* ---------------------------------------------------------------- /api/cases/:id/fivenet */
const caseRouter = express.Router({ mergeParams: true });
caseRouter.use(requireAuth);

function loadCase(req, res) {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  return c;
}

function loadLink(req, res, c, { manage = true } = {}) {
  const linkId = idParam(req, 'linkId');
  const link = linkId && db.prepare('SELECT * FROM case_external_docs WHERE id = ? AND case_id = ?').get(linkId, c.id);
  if (!link || (link.internal && !isStaff(req.user))) {
    res.status(404).json({ error: 'Verknüpfung nicht gefunden.' });
    return null;
  }
  // Ändern/Entfernen: wer verknüpft hat, der zuständige Anwalt oder die Kanzleileitung.
  if (manage && link.linked_by !== req.user.id && !caseAccess(c, req.user).canEdit) {
    res.status(403).json({ error: 'Nur wer das Dokument verknüpft hat, der zuständige Anwalt oder die Kanzleileitung kann das ändern.' });
    return null;
  }
  return link;
}

const optDate = z.union([dateOnly, z.literal('')]).nullable().optional();
const metaFields = {
  title: z.string().trim().max(300).optional(),
  docType: z.string().trim().max(60).optional(),
  docDate: optDate,
  docAuthor: z.string().trim().max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  viewedAs: z.string().trim().max(80).optional(),
  internal: z.boolean().optional(),
  // Abschrift des Dokumenttexts (vom Anwalt aus FiveNet kopiert)
  contentText: z.string().trim().max(60000).optional(),
};

const docLabel = (id, title) => `#${id}${title ? ' – ' + truncate(title, 120) : ''}`;

caseRouter.post(
  '/',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const d = parseBody(z.object({ input: z.string().max(600), attest: z.literal(true), ...metaFields }), req, res);
    if (!d) return;
    const ref = fivenet.parseDocumentRef(d.input);
    if (!ref.ok) return res.status(400).json({ error: ref.error });

    const existing = db
      .prepare("SELECT * FROM case_external_docs WHERE case_id = ? AND provider = 'fivenet' AND external_id = ?")
      .get(c.id, ref.documentId);
    if (existing) {
      return res.status(409).json({
        error: `Dieses FiveNet-Dokument ist bereits mit der Akte verknüpft (von ${existing.linked_by_name}).`,
        linkId: existing.id,
      });
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_external_docs WHERE case_id = ?').get(c.id).n;
    if (count >= MAX_DOCS_PER_CASE) return res.status(400).json({ error: `Pro Akte sind höchstens ${MAX_DOCS_PER_CASE} FiveNet-Dokumente möglich.` });

    const internal = d.internal !== false;
    let row;
    try {
      row = tx(() => {
        const info = db
          .prepare(
            `INSERT INTO case_external_docs (case_id, provider, external_id, original_url, canonical_url, host, title, doc_type, doc_date,
                                             doc_author, summary, viewed_as, internal, attested, linked_by, linked_by_name,
                                             content_text, content_at, content_by_name)
             VALUES (?, 'fivenet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .run(
            c.id,
            ref.documentId,
            ref.input,
            ref.canonicalUrl,
            ref.host,
            d.title || '',
            d.docType || '',
            d.docDate || null,
            d.docAuthor || '',
            d.summary || '',
            d.viewedAs || '',
            internal ? 1 : 0,
            req.user.id,
            req.user.display_name,
            d.contentText || '',
            d.contentText ? new Date().toISOString() : null,
            d.contentText ? req.user.display_name : ''
          );
        addSystemNote(c.id, req.user, `FiveNet-Dokument verknüpft: ${docLabel(ref.documentId, d.title)}.`, internal);
        db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
        return db.prepare('SELECT * FROM case_external_docs WHERE id = ?').get(Number(info.lastInsertRowid));
      });
    } catch (err) {
      // Gleichzeitiges Doppel-Verknüpfen: die UNIQUE-Regel der Tabelle greift.
      if (String(err?.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Dieses FiveNet-Dokument ist bereits mit der Akte verknüpft.' });
      }
      throw err;
    }
    logActivity(req.user, 'FiveNet-Dokument verknüpft', 'case', c.id, `${c.case_number}: ${docLabel(ref.documentId, d.title)}`);
    res.status(201).json({ document: externalDocRow(row, req.user) });
  })
);

const COLUMNS = { title: 'title', docType: 'doc_type', docDate: 'doc_date', docAuthor: 'doc_author', summary: 'summary', viewedAs: 'viewed_as' };

caseRouter.patch(
  '/:linkId',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const link = loadLink(req, res, c);
    if (!link) return;
    const d = parseBody(z.object(metaFields), req, res);
    if (!d) return;
    const sets = [];
    const values = [];
    for (const [key, col] of Object.entries(COLUMNS)) {
      if (d[key] === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(key === 'docDate' ? d[key] || null : d[key]);
    }
    if (d.internal !== undefined) {
      sets.push('internal = ?');
      values.push(d.internal ? 1 : 0);
    }
    const textChanged = d.contentText !== undefined && d.contentText !== link.content_text;
    if (textChanged) {
      sets.push('content_text = ?', 'content_at = ?', 'content_by_name = ?');
      values.push(d.contentText, d.contentText ? new Date().toISOString() : null, d.contentText ? req.user.display_name : '');
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      tx(() => {
        db.prepare(`UPDATE case_external_docs SET ${sets.join(', ')} WHERE id = ?`).run(...values, link.id);
        if (textChanged) {
          addSystemNote(c.id, req.user, `Abschrift von FiveNet-Dokument ${docLabel(link.external_id, d.title ?? link.title)} ${d.contentText ? 'aktualisiert' : 'entfernt'}.`, !!(d.internal ?? link.internal));
          db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
        }
        if (d.internal !== undefined && !!d.internal !== !!link.internal) {
          // Übernommene Bilder folgen der Sichtbarkeit des Dokuments.
          db.prepare('UPDATE case_attachments SET internal = ? WHERE external_doc_id = ?').run(d.internal ? 1 : 0, link.id);
          addSystemNote(
            c.id,
            req.user,
            `FiveNet-Dokument ${docLabel(link.external_id, d.title ?? link.title)} ist jetzt ${d.internal ? 'nur intern' : 'für den Mandanten sichtbar'}.`,
            true
          );
        }
      });
    }
    res.json({ document: externalDocRow(db.prepare('SELECT * FROM case_external_docs WHERE id = ?').get(link.id), req.user) });
  })
);

caseRouter.delete(
  '/:linkId',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const link = loadLink(req, res, c);
    if (!link) return;
    tx(() => {
      db.prepare('DELETE FROM case_external_docs WHERE id = ?').run(link.id);
      addSystemNote(c.id, req.user, `FiveNet-Verknüpfung entfernt: ${docLabel(link.external_id, link.title)}.`, !!link.internal);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
    });
    logActivity(req.user, 'FiveNet-Verknüpfung entfernt', 'case', c.id, `${c.case_number}: ${docLabel(link.external_id, link.title)}`);
    res.json({ success: true });
  })
);

/**
 * Übernimmt Bilder aus eingefügtem Dokumentinhalt. Geladen werden nur Adressen, die der
 * Anwalt mit dem Inhalt eingefügt hat – und nur vom Host des verknüpften Dokuments aus dem
 * FiveNet-Dateispeicher/Bild-Proxy. Nacheinander, mit Zeit- und Größengrenze.
 */
caseRouter.post(
  '/:linkId/images',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const link = loadLink(req, res, c, { manage: false });
    if (!link) return;
    const d = parseBody(z.object({ urls: z.array(z.string().max(2000)).min(1).max(MAX_IMAGES_PER_IMPORT) }), req, res);
    if (!d) return;

    const known = new Set(
      db.prepare('SELECT source_url FROM case_attachments WHERE external_doc_id = ? AND source_url IS NOT NULL').all(link.id).map((r) => r.source_url)
    );
    let free = MAX_ATTACHMENTS_PER_CASE - db.prepare('SELECT COUNT(*) AS n FROM case_attachments WHERE case_id = ?').get(c.id).n;
    const caption = truncate(`FiveNet ${link.external_id}${link.title ? ' – ' + link.title : ''}`, 180);
    const result = { imported: 0, skipped: 0, failed: [] };

    for (const raw of [...new Set(d.urls)]) {
      const url = fivenet.imageUrlFor(raw, link.host);
      if (!url) {
        result.failed.push({ url: truncate(raw, 200), error: 'Kein Bild aus dem FiveNet-Dateispeicher' });
        continue;
      }
      if (known.has(url)) {
        result.skipped += 1;
        continue;
      }
      if (free <= 0) {
        result.failed.push({ url, error: `Höchstens ${MAX_ATTACHMENTS_PER_CASE} Anhänge pro Akte` });
        continue;
      }
      try {
        const saved = saveImageBuffer(await fivenet.fetchImage(url), 'evidence');
        db.prepare(
          `INSERT INTO case_attachments (case_id, file, mime, size, caption, internal, uploader_id, uploader_name, external_doc_id, source_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(c.id, saved.file, saved.mime, saved.size, caption, link.internal ? 1 : 0, req.user.id, req.user.display_name, link.id, url);
        known.add(url);
        free -= 1;
        result.imported += 1;
      } catch (err) {
        result.failed.push({ url, error: err.status === 400 ? 'Kein unterstütztes Bildformat (JPG, PNG, WebP)' : err.message });
      }
    }

    if (result.imported) {
      tx(() => {
        addSystemNote(
          c.id,
          req.user,
          `${result.imported} Bild${result.imported === 1 ? '' : 'er'} aus FiveNet-Dokument ${docLabel(link.external_id, link.title)} übernommen.`,
          !!link.internal
        );
        db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      });
    }
    res.json(result);
  })
);

/** Abschrift als Textdatei (auch für den Mandanten, wenn das Dokument für ihn freigegeben ist). */
caseRouter.get(
  '/:linkId/text',
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const link = loadLink(req, res, c, { manage: false });
    if (!link) return;
    if (!link.content_text) return res.status(404).json({ error: 'Zu diesem Dokument gibt es keine Abschrift.' });
    const date = (v) => (v ? new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : '');
    const meta = [link.doc_type, link.doc_date ? `erstellt ${new Date(`${link.doc_date}T12:00:00Z`).toLocaleDateString('de-DE')}` : '', link.doc_author]
      .filter(Boolean)
      .join(' · ');
    const head = [
      `FiveNet-Dokument Nr. ${link.external_id}${link.title ? ' – ' + link.title : ''}`,
      `Quelle: ${link.canonical_url}`,
      meta,
      `Akte ${c.case_number} · Abschrift übernommen am ${date(link.content_at)} von ${link.content_by_name || link.linked_by_name}`,
      'Maßgeblich ist das Original in FiveNet; spätere Änderungen dort sind hier nicht enthalten.',
      '-'.repeat(72),
    ].filter(Boolean);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="FiveNet-${link.external_id}.txt"`);
    res.send(`${head.join('\r\n')}\r\n\r\n${link.content_text.replace(/\r?\n/g, '\r\n')}\r\n`);
  })
);

module.exports = { router, caseRouter };
