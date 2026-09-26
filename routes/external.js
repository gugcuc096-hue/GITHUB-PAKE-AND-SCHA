'use strict';
/*
 * Externe Dokumente in Akten: FiveNet, Google Docs und Google Sheets.
 *
 * - FiveNet: geprüfte Referenz; Text und Bilder übernimmt der Anwalt per Kopieren/Einfügen
 *   (FiveNet bietet keine Schnittstelle für Drittanwendungen, siehe fivenet.js).
 * - Google Docs: per Link freigegebene Dokumente lädt der Server selbst (Text + Bilder),
 *   nicht freigegebene lassen sich ebenfalls per Kopieren/Einfügen übernehmen (siehe gdocs.js).
 * - Google Sheets: gleiche Regeln; übernommen wird das Tabellenblatt aus dem Link (siehe gsheets.js).
 *
 * /api/cases/:id/external         – verknüpfen, bearbeiten, entfernen, Reihenfolge, Bilder, Textdatei
 * /api/cases/:id/fivenet          – gleicher Router (ältere Adresse, bleibt gültig)
 * /api/gdocs/fetch                – Google-Docs-Link erkennen und freigegebenen Inhalt laden
 * /api/gsheets/fetch              – Google-Sheets-Link erkennen und freigegebenes Tabellenblatt laden
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff, isStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, truncate, MAX_ATTACHMENTS_PER_CASE } = require('../helpers');
const { getCase, caseAccess, addSystemNote, externalDocRow, logActivity } = require('../models');
const { saveImageBuffer } = require('../uploads');
const fivenet = require('../fivenet');
const gdocs = require('../gdocs');
const gsheets = require('../gsheets');

const MAX_DOCS_PER_CASE = 100;
const MAX_IMAGES_PER_IMPORT = 10;

/** Alles, was sich zwischen den Quellen unterscheidet. */
const PROVIDERS = {
  fivenet: {
    noun: 'FiveNet-Dokument',
    this: 'Dieses',
    attest: true,
    parse: (input) => fivenet.parseDocumentRef(input),
    imageUrl: (raw, link) => fivenet.imageUrlFor(raw, link.host),
    fetchImage: (url) => fivenet.fetchImage(url),
    label: (id, title) => `#${id}${title ? ' – ' + truncate(title, 120) : ''}`,
    fileName: (id) => `FiveNet-${id}`,
    heading: (id, title) => `FiveNet-Dokument Nr. ${id}${title ? ' – ' + title : ''}`,
    imageHint: 'Kein Bild aus dem FiveNet-Dateispeicher',
  },
  gdocs: {
    noun: 'Google-Docs-Dokument',
    this: 'Dieses',
    attest: false,
    parse: (input) => gdocs.parseDocumentRef(input),
    imageUrl: (raw) => gdocs.imageUrlFor(raw),
    fetchImage: (url) => gdocs.fetchImage(url),
    label: (id, title) => (title ? `„${truncate(title, 120)}“` : 'ohne Titel'),
    fileName: (id) => `GoogleDocs-${id.replace(/^e\//, '').slice(0, 16)}`,
    heading: (id, title) => `Google-Docs-Dokument${title ? ' „' + title + '“' : ''}`,
    imageHint: 'Kein Bild aus Google Docs',
  },
  gsheets: {
    noun: 'Google-Sheets-Tabelle',
    this: 'Diese',
    attest: false,
    parse: (input) => gsheets.parseSheetRef(input),
    imageUrl: (raw) => gdocs.imageUrlFor(raw),
    fetchImage: (url) => gdocs.fetchImage(url),
    label: (id, title) => (title ? `„${truncate(title, 120)}“` : 'ohne Titel'),
    fileName: (id) => `GoogleSheets-${id.replace(/^e\//, '').slice(0, 16)}${id.includes('#gid=') ? '-Blatt' + id.split('#gid=')[1] : ''}`,
    heading: (id, title) => `Google-Sheets-Tabelle${title ? ' „' + title + '“' : ''}`,
    imageHint: 'Kein Bild von Google',
    // Abschrift ist tabulatorgetrennt – in der Textdatei als ausgerichtete Tabelle.
    formatText: (text) => gsheets.formatTable(text),
  },
};
const providerOf = (link) => PROVIDERS[link.provider] || PROVIDERS.fivenet;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const touchCase = (caseId) => db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(caseId);

/** Andere Akten mit demselben Dokument (für Dublettenwarnung und Querverweise). */
function linksTo(provider, externalId) {
  return db
    .prepare(
      `SELECT e.id, e.case_id, e.linked_by_name, e.linked_at, e.title, c.case_number, c.title AS case_title
       FROM case_external_docs e JOIN cases c ON c.id = e.case_id
       WHERE e.provider = ? AND e.external_id = ? ORDER BY c.case_number`
    )
    .all(provider, externalId);
}

function linkSummary(links, caseId) {
  const here = caseId ? links.find((l) => l.case_id === caseId) : null;
  const known = links.find((l) => l.title);
  return {
    linkedHere: here ? { id: here.id, linkedByName: here.linked_by_name, linkedAt: here.linked_at } : null,
    otherCases: links.filter((l) => l.case_id !== caseId).map((l) => ({ id: l.case_id, caseNumber: l.case_number, title: l.case_title })),
    suggestedTitle: known ? known.title : '',
  };
}

/* ---------------------------------------------------------------- /api/gdocs */
const gdocsRouter = express.Router();
gdocsRouter.use(requireAuth, requireStaff);

// Gemeinsame Grenze für Google Docs und Google Sheets.
const gdocsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Zu viele Abrufe bei Google. Bitte in ein paar Minuten erneut versuchen.' }),
});

/**
 * Erkennt einen Google-Docs-Link und lädt – falls freigegeben – den Inhalt als HTML.
 * Das HTML wird im Browser nur gelesen (DOMParser), nie angezeigt.
 */
gdocsRouter.post(
  '/fetch',
  gdocsLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ input: z.string().max(600), caseId: z.number().int().positive().optional() }), req, res);
    if (!d) return;
    const ref = gdocs.parseDocumentRef(d.input);
    if (!ref.ok) return res.status(400).json({ error: ref.error });
    const body = {
      documentId: ref.documentId,
      url: ref.canonicalUrl,
      host: ref.host,
      published: ref.published,
      ...linkSummary(linksTo('gdocs', ref.documentId), d.caseId),
      title: '',
      html: '',
      contentError: null,
    };
    try {
      const doc = await gdocs.fetchDocument(ref);
      body.title = doc.title;
      body.html = doc.html;
    } catch (err) {
      body.contentError = err.message;
    }
    res.json(body);
  })
);

/* ---------------------------------------------------------------- /api/gsheets */
const gsheetsRouter = express.Router();
gsheetsRouter.use(requireAuth, requireStaff);

/** Erkennt einen Google-Sheets-Link und lädt – falls freigegeben – das Tabellenblatt als Text. */
gsheetsRouter.post(
  '/fetch',
  gdocsLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ input: z.string().max(600), caseId: z.number().int().positive().optional() }), req, res);
    if (!d) return;
    const ref = gsheets.parseSheetRef(d.input);
    if (!ref.ok) return res.status(400).json({ error: ref.error });
    const body = {
      documentId: ref.documentId,
      url: ref.canonicalUrl,
      host: ref.host,
      published: ref.published,
      gid: ref.gid,
      ...linkSummary(linksTo('gsheets', ref.documentId), d.caseId),
      title: '',
      text: null,
      rows: 0,
      totalRows: 0,
      truncated: false,
      columnsCut: false,
      contentError: null,
    };
    try {
      Object.assign(body, await gsheets.fetchSheet(ref));
    } catch (err) {
      body.contentError = err.message;
    }
    res.json(body);
  })
);

/* ---------------------------------------------------------------- /api/cases/:id/external */
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
  // Ändern/Entfernen: wer verknüpft hat, der zuständige Anwalt oder das Board of Partners.
  if (manage && link.linked_by !== req.user.id && !caseAccess(c, req.user).canEdit) {
    res.status(403).json({ error: 'Nur wer das Dokument verknüpft hat, der zuständige Anwalt oder das Board of Partners kann das ändern.' });
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
  // Abschrift des Dokumenttexts (kopiert bzw. aus Google geladen). Führende Tabulatoren bleiben erhalten:
  // Bei Google-Sheets-Tabellen stehen sie für leere Zellen am Zeilenanfang.
  contentText: z
    .string()
    .max(60000)
    .transform((v) => v.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/^ +/, '').replace(/\s+$/, ''))
    .optional(),
};

caseRouter.post(
  '/',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const d = parseBody(
      z.object({ provider: z.enum(Object.keys(PROVIDERS)).default('fivenet'), input: z.string().max(600), attest: z.boolean().optional(), ...metaFields }),
      req,
      res
    );
    if (!d) return;
    const p = PROVIDERS[d.provider];
    // FiveNet: Die Kanzlei kann die Rechte nicht prüfen – der Anwalt bestätigt die eigene Einsicht.
    if (p.attest && d.attest !== true) return res.status(400).json({ error: 'Bitte bestätigen Sie, dass Sie das Dokument in FiveNet selbst einsehen dürfen.' });
    const ref = p.parse(d.input);
    if (!ref.ok) return res.status(400).json({ error: ref.error });

    const existing = db
      .prepare('SELECT * FROM case_external_docs WHERE case_id = ? AND provider = ? AND external_id = ?')
      .get(c.id, d.provider, ref.documentId);
    if (existing) {
      return res.status(409).json({ error: `${p.this} ${p.noun} ist bereits mit der Akte verknüpft (von ${existing.linked_by_name}).`, linkId: existing.id });
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_external_docs WHERE case_id = ?').get(c.id).n;
    if (count >= MAX_DOCS_PER_CASE) return res.status(400).json({ error: `Pro Akte sind höchstens ${MAX_DOCS_PER_CASE} externe Dokumente möglich.` });

    const internal = d.internal !== false;
    let row;
    try {
      row = tx(() => {
        const info = db
          .prepare(
            `INSERT INTO case_external_docs (case_id, provider, external_id, original_url, canonical_url, host, title, doc_type, doc_date,
                                             doc_author, summary, viewed_as, internal, attested, linked_by, linked_by_name,
                                             content_text, content_at, content_by_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            c.id,
            d.provider,
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
            d.attest ? 1 : 0,
            req.user.id,
            req.user.display_name,
            d.contentText || '',
            d.contentText ? new Date().toISOString() : null,
            d.contentText ? req.user.display_name : ''
          );
        addSystemNote(c.id, req.user, `${p.noun} verknüpft: ${p.label(ref.documentId, d.title)}.`, internal);
        touchCase(c.id);
        return db.prepare('SELECT * FROM case_external_docs WHERE id = ?').get(Number(info.lastInsertRowid));
      });
    } catch (err) {
      // Gleichzeitiges Doppel-Verknüpfen: die UNIQUE-Regel der Tabelle greift.
      if (String(err?.message || '').includes('UNIQUE')) return res.status(409).json({ error: `${p.this} ${p.noun} ist bereits mit der Akte verknüpft.` });
      throw err;
    }
    logActivity(req.user, `${p.noun} verknüpft`, 'case', c.id, `${c.case_number}: ${p.label(ref.documentId, d.title)}`);
    res.status(201).json({ document: externalDocRow(row, req.user) });
  })
);

/**
 * Reihenfolge der Dokumente in der Akte (Ziehen im Dashboard). Erwartet alle Verknüpfungen der
 * Akte genau einmal – so kann eine veraltete Ansicht keine Dokumente „verlieren“.
 */
caseRouter.put(
  '/order',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const d = parseBody(z.object({ ids: z.array(z.number().int().positive()).max(MAX_DOCS_PER_CASE) }), req, res);
    if (!d) return;
    const current = db.prepare('SELECT id FROM case_external_docs WHERE case_id = ?').all(c.id).map((r) => r.id);
    const wanted = new Set(d.ids);
    if (wanted.size !== d.ids.length || wanted.size !== current.length || current.some((id) => !wanted.has(id))) {
      return res.status(409).json({ error: 'Die Dokumente der Akte haben sich inzwischen geändert. Die Akte wird neu geladen – bitte noch einmal verschieben.' });
    }
    tx(() => {
      const set = db.prepare('UPDATE case_external_docs SET sort_order = ? WHERE id = ? AND case_id = ?');
      d.ids.forEach((id, i) => set.run(i + 1, id, c.id));
    });
    res.json({ success: true });
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
    const p = providerOf(link);
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
      const label = p.label(link.external_id, d.title ?? link.title);
      tx(() => {
        db.prepare(`UPDATE case_external_docs SET ${sets.join(', ')} WHERE id = ?`).run(...values, link.id);
        if (textChanged) {
          addSystemNote(c.id, req.user, `Abschrift von ${p.noun} ${label} ${d.contentText ? 'aktualisiert' : 'entfernt'}.`, !!(d.internal ?? link.internal));
          touchCase(c.id);
        }
        if (d.internal !== undefined && !!d.internal !== !!link.internal) {
          // Übernommene Bilder folgen der Sichtbarkeit des Dokuments.
          db.prepare('UPDATE case_attachments SET internal = ? WHERE external_doc_id = ?').run(d.internal ? 1 : 0, link.id);
          addSystemNote(c.id, req.user, `${p.noun} ${label} ist jetzt ${d.internal ? 'nur intern' : 'für den Mandanten sichtbar'}.`, true);
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
    const p = providerOf(link);
    tx(() => {
      db.prepare('DELETE FROM case_external_docs WHERE id = ?').run(link.id);
      addSystemNote(c.id, req.user, `Verknüpfung entfernt: ${p.noun} ${p.label(link.external_id, link.title)}.`, !!link.internal);
      touchCase(c.id);
    });
    logActivity(req.user, `${p.noun}: Verknüpfung entfernt`, 'case', c.id, `${c.case_number}: ${p.label(link.external_id, link.title)}`);
    res.json({ success: true });
  })
);

/**
 * Übernimmt Bilder eines verknüpften Dokuments als Anhänge. Geladen werden nur Adressen der
 * jeweiligen Quelle (FiveNet-Dateispeicher bzw. Google-Inhaltsserver) – nacheinander, mit
 * Zeit- und Größengrenze. Bereits vorhandene Bilder (gleiche Adresse oder gleicher Inhalt)
 * werden übersprungen, damit „Aktualisieren“ keine Dubletten erzeugt.
 */
caseRouter.post(
  '/:linkId/images',
  requireStaff,
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    const link = loadLink(req, res, c, { manage: false });
    if (!link) return;
    const p = providerOf(link);
    const d = parseBody(z.object({ urls: z.array(z.string().max(4000)).min(1).max(MAX_IMAGES_PER_IMPORT) }), req, res);
    if (!d) return;

    const existing = db.prepare('SELECT source_url, content_hash FROM case_attachments WHERE external_doc_id = ?').all(link.id);
    const knownUrls = new Set(existing.map((r) => r.source_url).filter(Boolean));
    const knownHashes = new Set(existing.map((r) => r.content_hash).filter(Boolean));
    let free = MAX_ATTACHMENTS_PER_CASE - db.prepare('SELECT COUNT(*) AS n FROM case_attachments WHERE case_id = ?').get(c.id).n;
    const caption = truncate(`${p.noun} ${p.label(link.external_id, link.title)}`, 180);
    const result = { imported: 0, skipped: 0, failed: [] };

    for (const raw of [...new Set(d.urls)]) {
      const url = p.imageUrl(raw, link);
      if (!url) {
        result.failed.push({ url: truncate(raw, 200), error: p.imageHint });
        continue;
      }
      if (knownUrls.has(url)) {
        result.skipped += 1;
        continue;
      }
      if (free <= 0) {
        result.failed.push({ url, error: `Höchstens ${MAX_ATTACHMENTS_PER_CASE} Anhänge pro Akte` });
        continue;
      }
      try {
        const buf = await p.fetchImage(url);
        const hash = sha256(buf);
        if (knownHashes.has(hash)) {
          result.skipped += 1;
          continue;
        }
        const saved = saveImageBuffer(buf, 'evidence');
        db.prepare(
          `INSERT INTO case_attachments (case_id, file, mime, size, caption, internal, uploader_id, uploader_name, external_doc_id, source_url, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(c.id, saved.file, saved.mime, saved.size, caption, link.internal ? 1 : 0, req.user.id, req.user.display_name, link.id, url, hash);
        knownUrls.add(url);
        knownHashes.add(hash);
        free -= 1;
        result.imported += 1;
      } catch (err) {
        result.failed.push({ url: truncate(url, 200), error: err.status === 400 ? 'Kein unterstütztes Bildformat (JPG, PNG, WebP)' : err.message });
      }
    }

    if (result.imported) {
      tx(() => {
        addSystemNote(
          c.id,
          req.user,
          `${result.imported} Bild${result.imported === 1 ? '' : 'er'} aus ${p.noun} ${p.label(link.external_id, link.title)} übernommen.`,
          !!link.internal
        );
        touchCase(c.id);
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
    const p = providerOf(link);
    const date = (v) => (v ? new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : '');
    const meta = [link.doc_type, link.doc_date ? `erstellt ${new Date(`${link.doc_date}T12:00:00Z`).toLocaleDateString('de-DE')}` : '', link.doc_author]
      .filter(Boolean)
      .join(' · ');
    const head = [
      p.heading(link.external_id, link.title),
      `Quelle: ${link.canonical_url}`,
      meta,
      `Akte ${c.case_number} · Abschrift übernommen am ${date(link.content_at)} von ${link.content_by_name || link.linked_by_name}`,
      `Maßgeblich ist das Original; spätere Änderungen dort sind hier nicht enthalten.`,
      '-'.repeat(72),
    ].filter(Boolean);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${p.fileName(link.external_id)}.txt"`);
    const body = p.formatText ? p.formatText(link.content_text) : link.content_text;
    res.send(`${head.join('\r\n')}\r\n\r\n${body.replace(/\r?\n/g, '\r\n')}\r\n`);
  })
);

module.exports = { caseRouter, gdocsRouter, gsheetsRouter, PROVIDERS };
