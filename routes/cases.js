'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx, nextCaseNumber, randomPin } = require('../db');
const { requireAuth, requireAdmin, isStaff } = require('../auth');
const { wrap, parseBody, idParam, AREAS, URGENCIES, CASE_STATUS, STEPS, truncate } = require('../helpers');
const {
  CASE_SELECT,
  getCase,
  caseAccess,
  caseRow,
  noteRow,
  addSystemNote,
  APPT_SELECT,
  apptVisible,
  apptRow,
  INVOICE_SELECT,
  invoiceRow,
  attachmentRow,
  logActivity,
} = require('../models');
const discord = require('../discord');
const { imageBody, saveImage, removeFile, evidencePath } = require('../uploads');

const MAX_ATTACHMENTS_PER_CASE = 40;

const router = express.Router();
router.use(requireAuth);

const URGENCY_LABEL = { normal: 'Normal', eilig: 'Eilig', notfall: '🚨 Notfall' };

function notifyCreated(c, user) {
  discord.notify('case.created', {
    title: `Neue Akte ${c.case_number}`,
    description: truncate(c.title, 300),
    color: c.urgency === 'notfall' ? discord.RED : discord.GOLD,
    fields: [
      { name: 'Mandant', value: c.client_account_name || c.client_name || '—' },
      { name: 'Dringlichkeit', value: URGENCY_LABEL[c.urgency] || c.urgency },
      { name: 'Zuständig', value: c.lawyer_name || 'Noch nicht zugewiesen' },
      { name: 'Angelegt von', value: user ? user.display_name : 'Website-Formular' },
    ],
    mentionIds: c.lawyer_discord_id && (!user || c.lawyer_id !== user.id) ? [c.lawyer_discord_id] : [],
  });
}

/* ---------------------------------------------------------------- Liste */
router.get('/', (req, res) => {
  const u = req.user;
  const rows = isStaff(u)
    ? db.prepare(`${CASE_SELECT} ORDER BY c.updated_at DESC`).all()
    : db.prepare(`${CASE_SELECT} WHERE c.client_id = ? ORDER BY c.updated_at DESC`).all(u.id);
  res.json({ cases: rows.map((c) => caseRow(c, u)) });
});

/* ---------------------------------------------------------------- Anlegen */
const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  area: z.enum(AREAS),
  urgency: z.enum(URGENCIES).default('normal'),
  description: z.string().trim().max(4000).default(''),
  clientEmail: z.union([z.string().trim().email().max(120), z.literal('')]).optional(),
  clientName: z.string().trim().max(80).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  opponent: z.string().trim().max(120).optional(),
  courtRef: z.string().trim().max(60).optional(),
  lawyerId: z.number().int().positive().nullable().optional(),
});

router.post(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    const d = parseBody(createSchema, req, res);
    if (!d) return;

    let clientId = null;
    let clientName = '';
    let lawyerId = null;
    let source = 'portal';

    if (u.role === 'mandant') {
      if (d.description.length < 10) return res.status(400).json({ error: 'Bitte beschreiben Sie den Sachverhalt etwas ausführlicher (mind. 10 Zeichen).' });
      clientId = u.id;
    } else {
      source = 'kanzlei';
      if (d.clientEmail) {
        const client = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(d.clientEmail.toLowerCase());
        if (!client) return res.status(404).json({ error: 'Kein Konto mit dieser E-Mail-Adresse gefunden. Lassen Sie das Feld leer und tragen Sie nur den Namen ein.' });
        clientId = client.id;
      } else if (!d.clientName || d.clientName.length < 2) {
        return res.status(400).json({ error: 'Bitte den Namen des Mandanten angeben.' });
      }
      clientName = d.clientName || '';
      lawyerId = u.id;
      if (d.lawyerId !== undefined && u.role === 'admin') {
        if (d.lawyerId !== null) {
          const lawyer = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(d.lawyerId);
          if (!lawyer) return res.status(400).json({ error: 'Der gewählte Anwalt existiert nicht.' });
        }
        lawyerId = d.lawyerId;
      }
    }

    const id = tx(() => {
      const info = db
        .prepare(
          `INSERT INTO cases (case_number, access_pin, title, area, urgency, description, client_id, client_name, client_phone,
                              opponent, court_ref, lawyer_id, status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          nextCaseNumber(),
          randomPin(),
          d.title,
          d.area,
          d.urgency,
          d.description,
          clientId,
          clientName,
          d.clientPhone || '',
          d.opponent || '',
          d.courtRef || '',
          lawyerId,
          lawyerId ? 'in_bearbeitung' : 'offen',
          source
        );
      const newId = Number(info.lastInsertRowid);
      addSystemNote(newId, u, 'Akte angelegt.');
      return newId;
    });

    const c = getCase(id);
    notifyCreated(c, u);
    if (isStaff(u)) logActivity(u, 'Akte angelegt', 'case', id, `${c.case_number} – ${c.title}`);
    res.status(201).json({ case: caseRow(c, u) });
  })
);

/* ---------------------------------------------------------------- Detail */
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const access = caseAccess(c, req.user);
    // Fremde Akten liefern 404 statt 403, damit ihre Existenz nicht verraten wird.
    if (!access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });

    const staff = isStaff(req.user);
    const notes = db
      .prepare('SELECT * FROM notes WHERE case_id = ? ORDER BY created_at ASC, id ASC')
      .all(c.id)
      .filter((n) => staff || !n.internal);
    const appointments = db
      .prepare(`${APPT_SELECT} WHERE a.case_id = ? ORDER BY a.starts_at ASC`)
      .all(c.id)
      .filter((a) => apptVisible(a, req.user));
    const invoices = db.prepare(`${INVOICE_SELECT} WHERE i.case_id = ? ORDER BY i.created_at DESC`).all(c.id);
    const attachments = db
      .prepare('SELECT * FROM case_attachments WHERE case_id = ? ORDER BY created_at ASC, id ASC')
      .all(c.id)
      .filter((a) => staff || !a.internal);

    res.json({
      case: { ...caseRow(c, req.user), ...access },
      notes: notes.map(noteRow),
      appointments: appointments.map((a) => apptRow(a, req.user)),
      invoices: invoices.map(invoiceRow),
      attachments: attachments.map((a) => attachmentRow(a, c.id)),
    });
  })
);

/* ---------------------------------------------------------------- Bearbeiten */
const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  area: z.enum(AREAS).optional(),
  urgency: z.enum(URGENCIES).optional(),
  description: z.string().trim().max(4000).optional(),
  clientName: z.string().trim().max(80).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  opponent: z.string().trim().max(120).optional(),
  courtRef: z.string().trim().max(60).optional(),
  status: z.enum(Object.keys(CASE_STATUS)).optional(),
  step: z.number().int().min(0).max(3).optional(),
  publicNote: z.string().trim().max(500).optional(),
  lawyerId: z.number().int().positive().nullable().optional(),
});

const FIELD_COLUMNS = {
  title: 'title',
  area: 'area',
  urgency: 'urgency',
  description: 'description',
  clientName: 'client_name',
  clientPhone: 'client_phone',
  opponent: 'opponent',
  courtRef: 'court_ref',
  step: 'step',
  publicNote: 'public_note',
};

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const access = caseAccess(c, u);
    if (!access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });

    const d = parseBody(updateSchema, req, res);
    if (!d) return;

    const sets = [];
    const values = [];
    const history = [];
    let newStatus = d.status;

    // Übernehmen / Abgeben / Zuweisen hat eigene Regeln: Eine unbesetzte Akte
    // darf jedes Teammitglied übernehmen, ohne vorher "canEdit" zu haben.
    let lawyerChanged = false;
    if (d.lawyerId !== undefined && d.lawyerId !== c.lawyer_id) {
      const isClaim = isStaff(u) && d.lawyerId === u.id && !c.lawyer_id;
      const isRelease = isStaff(u) && d.lawyerId === null && c.lawyer_id === u.id;
      if (u.role !== 'admin' && !isClaim && !isRelease) {
        return res.status(403).json({ error: 'Keine Berechtigung, den zuständigen Anwalt zu ändern.' });
      }
      let lawyerName = null;
      if (d.lawyerId !== null) {
        const lawyer = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(d.lawyerId);
        if (!lawyer) return res.status(400).json({ error: 'Der gewählte Anwalt existiert nicht.' });
        lawyerName = lawyer.display_name;
      }
      sets.push('lawyer_id = ?');
      values.push(d.lawyerId);
      lawyerChanged = true;
      history.push(d.lawyerId ? `Zuständigkeit: ${lawyerName}` : 'Akte wurde abgegeben (derzeit ohne zuständigen Anwalt).');
      if (!newStatus && d.lawyerId && c.status === 'offen') newStatus = 'in_bearbeitung';
      if (!newStatus && !d.lawyerId && c.status === 'in_bearbeitung') newStatus = 'offen';
    }

    const editFields = Object.keys(FIELD_COLUMNS).filter((k) => d[k] !== undefined);
    const wantsEdit = editFields.length > 0 || d.status !== undefined;
    // Wer die Akte gerade selbst übernommen hat, darf im selben Schritt weiterarbeiten.
    const canEditNow = access.canEdit || (lawyerChanged && d.lawyerId === u.id);
    if (wantsEdit && !canEditNow) {
      return res.status(403).json({ error: 'Nur der zuständige Anwalt oder die Kanzleileitung kann diese Akte bearbeiten.' });
    }

    for (const key of editFields) {
      sets.push(`${FIELD_COLUMNS[key]} = ?`);
      values.push(d[key]);
    }
    if (d.step !== undefined && d.step !== c.step) history.push(`Verfahrensstand: ${STEPS[d.step]}`);
    if (newStatus && newStatus !== c.status) {
      sets.push('status = ?');
      values.push(newStatus);
      history.push(`Status: ${CASE_STATUS[c.status]} → ${CASE_STATUS[newStatus]}`);
    }

    if (!sets.length) return res.json({ case: { ...caseRow(c, u), ...access } });

    sets.push("updated_at = datetime('now')");
    tx(() => {
      db.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`).run(...values, c.id);
      if (history.length) addSystemNote(c.id, u, history.join(' · '));
    });

    const updated = getCase(c.id);
    if (history.length) logActivity(u, 'Akte geändert', 'case', c.id, `${c.case_number}: ${history.join(' · ')}`);
    if (newStatus && newStatus !== c.status) {
      discord.notify('case.status', {
        title: `${updated.case_number}: ${CASE_STATUS[newStatus]}`,
        description: truncate(updated.title, 300),
        fields: [
          { name: 'Mandant', value: updated.client_account_name || updated.client_name || '—' },
          { name: 'Zuständig', value: updated.lawyer_name || '—' },
          { name: 'Geändert von', value: u.display_name },
        ],
      });
    }
    res.json({ case: { ...caseRow(updated, u), ...caseAccess(updated, u) } });
  })
);

router.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const files = db.prepare('SELECT file FROM case_attachments WHERE case_id = ?').all(c.id);
    db.prepare('DELETE FROM cases WHERE id = ?').run(c.id);
    files.forEach((f) => removeFile('evidence', f.file));
    logActivity(req.user, 'Akte gelöscht', 'case', c.id, `${c.case_number} – ${c.title}`);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Beweismittel / Bildanhänge */
router.post(
  '/:id/attachments',
  imageBody,
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (c.status === 'geschlossen' && !isStaff(req.user)) return res.status(403).json({ error: 'Die Akte ist geschlossen.' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_attachments WHERE case_id = ?').get(c.id).n;
    if (count >= MAX_ATTACHMENTS_PER_CASE) {
      return res.status(400).json({ error: `Pro Akte sind höchstens ${MAX_ATTACHMENTS_PER_CASE} Anhänge möglich.` });
    }
    const caption = String(req.query.caption || '').trim().slice(0, 200);
    const internal = req.query.internal === '1' && isStaff(req.user);
    const saved = saveImage(req, 'evidence');
    const info = tx(() => {
      const r = db
        .prepare(
          'INSERT INTO case_attachments (case_id, file, mime, size, caption, internal, uploader_id, uploader_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(c.id, saved.file, saved.mime, saved.size, caption, internal ? 1 : 0, req.user.id, req.user.display_name);
      addSystemNote(c.id, req.user, `Anhang hinzugefügt${caption ? ': ' + caption : ''}.`, internal);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      return r;
    });
    const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ attachment: attachmentRow(row, c.id) });
  })
);

router.get(
  '/:id/attachments/:attId/file',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(a.mime);
    res.sendFile(evidencePath(a.file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Datei nicht gefunden.' });
    });
  })
);

router.delete(
  '/:id/attachments/:attId',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    if (a.uploader_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Nur die hochladende Person oder die Kanzleileitung kann den Anhang löschen.' });
    }
    db.prepare('DELETE FROM case_attachments WHERE id = ?').run(a.id);
    removeFile('evidence', a.file);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Notizen */
router.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().optional() }), req, res);
    if (!d) return;
    const internal = !!d.internal && isStaff(req.user);
    tx(() => {
      db.prepare(
        `INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(c.id, req.user.id, req.user.display_name, req.user.role, d.body, internal ? 1 : 0);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
    });
    res.status(201).json({ success: true });
  })
);

router.delete(
  '/:id/notes/:noteId',
  wrap(async (req, res) => {
    const caseId = idParam(req);
    const noteId = idParam(req, 'noteId');
    const n = caseId && noteId && db.prepare('SELECT * FROM notes WHERE id = ? AND case_id = ?').get(noteId, caseId);
    if (!n || n.system) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
    if (n.author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sie können nur eigene Notizen löschen.' });
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
    res.json({ success: true });
  })
);

module.exports = router;
