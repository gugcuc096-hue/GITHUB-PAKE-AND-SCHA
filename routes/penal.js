'use strict';
/*
 * Strafkatalog (StGB) und Anklagepunkte einer Akte.
 *  GET    /api/penal                       Katalog + Paragraphen (Kanzlei)
 *  GET    /api/penal/laws/:para            Gesetzestext eines Paragraphen (Kanzlei)
 *  POST/PATCH/DELETE /api/penal/offences   Katalog pflegen (Board of Partners)
 *  PUT    /api/penal/laws/:para            Gesetzestext ändern (Board)
 *  GET/POST/PATCH/DELETE /api/cases/:id/charges[/:cid]   Anklagepunkte (Kanzlei; ändern: zuständige Anwälte)
 *  PATCH  /api/cases/:id/charges/sentence  Einschätzung der Kanzlei, verminderte Schuldfähigkeit
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff, isStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard } = require('../helpers');
const { getCase, caseAccess, addSystemNote, logActivity } = require('../models');
const penal = require('../penal');

const router = express.Router();
router.use(requireAuth, requireStaff);
// Katalog und Gesetzestext pflegt das Board of Partners (Wiki → Strafgesetzbuch)
const requireBoard = (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Den Strafkatalog pflegt das Board of Partners.' }));

router.get('/', (req, res) => {
  res.json({ offences: penal.offences(), laws: penal.laws(), cap: penal.CAP, capSevere: penal.CAP_SEVERE, finePerHe: penal.FINE_PER_HE, canEdit: isBoard(req.user) });
});

/** Anklagetext lesen (eingefügt aus FiveNet/DOJ-Ticket – hier wird nichts abgerufen): Vorschläge aus dem Strafkatalog. */
router.post('/parse', (req, res) => {
  const d = parseBody(z.object({ text: z.string().max(20000) }), req, res);
  if (!d) return;
  res.json(penal.parseCharges(d.text));
});

router.get('/laws/:para', (req, res) => {
  const l = penal.law(req.params.para);
  if (!l) return res.status(404).json({ error: 'Paragraph nicht gefunden.' });
  res.json({ law: l, offences: penal.offences().filter((o) => o.para === l.para) });
});

const he = z.number().int().min(0).max(999);
const offenceSchema = z
  .object({
    para: z.string().trim().regex(/^\d{1,3}[a-z]?$/, 'Bitte nur die Nummer des Paragraphen, z. B. 21 oder 103a.'),
    paragraph: z.string().trim().max(40).default(''),
    title: z.string().trim().min(2).max(160),
    minHe: he.default(0),
    maxHe: he.nullable().default(null),
    fine: z.enum(['none', 'alt', 'only']).default('none'),
    fineMax: z.number().int().min(0).max(100000000).nullable().default(null),
    attempt: z.boolean().default(false),
    severe: z.boolean().default(false),
    note: z.string().trim().max(300).default(''),
  })
  .refine((d) => d.maxHe == null || d.maxHe >= d.minHe, { message: 'Die Obergrenze darf nicht unter der Untergrenze liegen.', path: ['maxHe'] });

const ensureLaw = (para, title) => db.prepare('INSERT OR IGNORE INTO penal_laws (para, title) VALUES (?, ?)').run(para, title);

router.post(
  '/offences',
  requireBoard,
  wrap(async (req, res) => {
    const d = parseBody(offenceSchema, req, res);
    if (!d) return;
    ensureLaw(d.para, d.title);
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM penal_offences').get().s;
    const id = Number(
      db
        .prepare(
          `INSERT INTO penal_offences (para, paragraph, title, min_he, max_he, fine_mode, fine_max, attempt, severe, note, sort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(d.para, d.paragraph, d.title, d.minHe, d.maxHe, d.fine, d.fineMax, d.attempt ? 1 : 0, d.severe ? 1 : 0, d.note, sort).lastInsertRowid
    );
    logActivity(req.user, 'Strafkatalog ergänzt', 'penal', id, `§ ${d.para} ${d.paragraph} ${d.title}`.replace(/\s+/g, ' '));
    res.status(201).json({ offence: penal.offences().find((o) => o.id === id) });
  })
);

router.patch(
  '/offences/:id',
  requireBoard,
  wrap(async (req, res) => {
    const id = idParam(req);
    const o = id && db.prepare('SELECT * FROM penal_offences WHERE id = ?').get(id);
    if (!o) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    const d = parseBody(offenceSchema, req, res);
    if (!d) return;
    ensureLaw(d.para, d.title);
    db.prepare(
      `UPDATE penal_offences SET para = ?, paragraph = ?, title = ?, min_he = ?, max_he = ?, fine_mode = ?, fine_max = ?, attempt = ?, severe = ?, note = ?,
              updated_at = datetime('now') WHERE id = ?`
    ).run(d.para, d.paragraph, d.title, d.minHe, d.maxHe, d.fine, d.fineMax, d.attempt ? 1 : 0, d.severe ? 1 : 0, d.note, id);
    logActivity(req.user, 'Strafkatalog geändert', 'penal', id, `§ ${d.para} ${d.paragraph} ${d.title}`.replace(/\s+/g, ' '));
    res.json({ offence: penal.offences().find((x) => x.id === id) });
  })
);

router.delete(
  '/offences/:id',
  requireBoard,
  wrap(async (req, res) => {
    const id = idParam(req);
    const o = id && db.prepare('SELECT * FROM penal_offences WHERE id = ?').get(id);
    if (!o) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    // Anklagepunkte bestehender Akten bleiben (sie tragen ihren eigenen Stand)
    db.prepare('DELETE FROM penal_offences WHERE id = ?').run(id);
    logActivity(req.user, 'Strafkatalog: Eintrag entfernt', 'penal', id, `§ ${o.para} ${o.paragraph} ${o.title}`.replace(/\s+/g, ' '));
    res.json({ success: true });
  })
);

const lawSchema = z.object({ title: z.string().trim().min(2).max(160), text: z.string().trim().max(20000) });
router.put(
  '/laws/:para',
  requireBoard,
  wrap(async (req, res) => {
    const para = String(req.params.para || '');
    if (!/^\d{1,3}[a-z]?$/.test(para)) return res.status(404).json({ error: 'Paragraph nicht gefunden.' });
    const d = parseBody(lawSchema, req, res);
    if (!d) return;
    db.prepare(
      `INSERT INTO penal_laws (para, title, text, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(para) DO UPDATE SET title = excluded.title, text = excluded.text, updated_at = excluded.updated_at`
    ).run(para, d.title, d.text);
    logActivity(req.user, 'Gesetzestext geändert', 'penal', null, `§ ${para} ${d.title}`);
    res.json({ law: penal.law(para) });
  })
);

/* ---------------------------------------------------------------- Anklagepunkte einer Akte */
const caseRouter = express.Router({ mergeParams: true });
caseRouter.use(requireAuth);

/** Akte, die die Person sehen darf (Kanzlei) – mit edit: nur zuständige Anwälte / Board. */
function loadCase(req, res, { edit = false } = {}) {
  const id = idParam(req);
  const c = id && getCase(id);
  const access = c ? caseAccess(c, req.user) : null;
  if (!c || !isStaff(req.user) || !access.canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  if (edit && !access.canEdit) {
    res.status(403).json({ error: 'Anklagepunkte ändern nur die zuständigen Anwälte.' });
    return null;
  }
  return c;
}

function payload(c) {
  const charges = penal.caseCharges(c.id);
  const fresh = getCase(c.id);
  const s = penal.sentence(charges);
  if (fresh.sentence_reduced) s.mitigations.unshift('§ 8 (verminderte Schuldfähigkeit)');
  return { charges, sentence: s, estimate: { he: fresh.sentence_estimate, fine: fresh.sentence_fine, reduced: !!fresh.sentence_reduced } };
}

caseRouter.get('/', (req, res) => {
  const c = loadCase(req, res);
  if (c) res.json(payload(c));
});

caseRouter.post(
  '/',
  wrap(async (req, res) => {
    const c = loadCase(req, res, { edit: true });
    if (!c) return;
    const d = parseBody(z.object({ offenceId: z.number().int().positive(), count: z.number().int().min(1).max(20).default(1) }), req, res);
    if (!d) return;
    const o = db.prepare('SELECT * FROM penal_offences WHERE id = ?').get(d.offenceId);
    if (!o) return res.status(400).json({ error: 'Diesen Tatbestand gibt es im Strafkatalog nicht (mehr).' });
    // gleicher Tatbestand noch einmal: Anzahl hochzählen statt einer zweiten Zeile
    const same = db.prepare('SELECT id, count FROM case_charges WHERE case_id = ? AND offence_id = ? ORDER BY id LIMIT 1').get(c.id, o.id);
    if (same) {
      db.prepare('UPDATE case_charges SET count = ? WHERE id = ?').run(Math.min(20, same.count + d.count), same.id);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      return res.json(payload(c));
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM case_charges WHERE case_id = ?').get(c.id).n >= 40) return res.status(400).json({ error: 'Höchstens 40 Anklagepunkte je Akte.' });
    db.prepare(
      `INSERT INTO case_charges (case_id, offence_id, para, paragraph, title, min_he, max_he, fine_mode, fine_max, attempt, severe, count, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.id, o.id, o.para, o.paragraph, o.title, o.min_he, o.max_he, o.fine_mode, o.fine_max, o.attempt, o.severe, d.count, req.user.id);
    addSystemNote(c.id, req.user, `Anklagepunkt: ${penal.citation(o)} – ${o.title}`, true);
    db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
    res.status(201).json(payload(c));
  })
);

/** Mehrere Anklagepunkte auf einmal (aus einem eingefügten Anklagetext) – gleiche Tatbestände zählen hoch. */
caseRouter.post(
  '/bulk',
  wrap(async (req, res) => {
    const c = loadCase(req, res, { edit: true });
    if (!c) return;
    const item = z.object({ offenceId: z.number().int().positive(), count: z.number().int().min(1).max(20).default(1), attempted: z.boolean().optional(), aiding: z.boolean().optional() });
    const d = parseBody(z.object({ items: z.array(item).min(1).max(40) }), req, res);
    if (!d) return;
    const offences = d.items.map((x) => db.prepare('SELECT * FROM penal_offences WHERE id = ?').get(x.offenceId));
    if (offences.some((o) => !o)) return res.status(400).json({ error: 'Ein Tatbestand steht nicht (mehr) im Strafkatalog – bitte die Vorschläge neu laden.' });
    // alles oder nichts: passt ein Punkt nicht mehr hinein, bleibt die Akte unverändert
    let added;
    try {
      added = tx(() => {
        const list = [];
        d.items.forEach((x, i) => {
          const o = offences[i];
          const same = db.prepare('SELECT id, count FROM case_charges WHERE case_id = ? AND offence_id = ? ORDER BY id LIMIT 1').get(c.id, o.id);
          if (same) db.prepare('UPDATE case_charges SET count = ? WHERE id = ?').run(Math.min(20, same.count + x.count), same.id);
          else {
            if (db.prepare('SELECT COUNT(*) AS n FROM case_charges WHERE case_id = ?').get(c.id).n >= 40) throw Object.assign(new Error('Höchstens 40 Anklagepunkte je Akte.'), { status: 400 });
            db.prepare(
              `INSERT INTO case_charges (case_id, offence_id, para, paragraph, title, min_he, max_he, fine_mode, fine_max, attempt, severe, count, attempted, aiding, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(c.id, o.id, o.para, o.paragraph, o.title, o.min_he, o.max_he, o.fine_mode, o.fine_max, o.attempt, o.severe, x.count, x.attempted && o.attempt ? 1 : 0, x.aiding ? 1 : 0, req.user.id);
          }
          list.push(`${x.count > 1 ? `${x.count}× ` : ''}${penal.citation(o)} – ${o.title}`);
        });
        db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
        return list;
      });
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      throw e;
    }
    addSystemNote(c.id, req.user, `Anklage übernommen: ${added.join(', ')}`, true);
    res.status(201).json(payload(c));
  })
);

caseRouter.patch(
  '/sentence',
  wrap(async (req, res) => {
    const c = loadCase(req, res, { edit: true });
    if (!c) return;
    const d = parseBody(
      z.object({ he: he.nullable().optional(), fine: z.number().int().min(0).max(100000000).nullable().optional(), reduced: z.boolean().optional() }),
      req,
      res
    );
    if (!d) return;
    const sets = [];
    const values = [];
    if (d.he !== undefined) sets.push('sentence_estimate = ?') && values.push(d.he);
    if (d.fine !== undefined) sets.push('sentence_fine = ?') && values.push(d.fine);
    if (d.reduced !== undefined) sets.push('sentence_reduced = ?') && values.push(d.reduced ? 1 : 0);
    if (sets.length) db.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`).run(...values, c.id);
    res.json(payload(c));
  })
);

caseRouter.patch(
  '/:cid',
  wrap(async (req, res) => {
    const c = loadCase(req, res, { edit: true });
    if (!c) return;
    const cid = Number(req.params.cid);
    const ch = db.prepare('SELECT * FROM case_charges WHERE id = ? AND case_id = ?').get(cid, c.id);
    if (!ch) return res.status(404).json({ error: 'Anklagepunkt nicht gefunden.' });
    const d = parseBody(z.object({ count: z.number().int().min(1).max(20).optional(), attempted: z.boolean().optional(), aiding: z.boolean().optional() }), req, res);
    if (!d) return;
    if (d.attempted && !ch.attempt) return res.status(400).json({ error: 'Der Versuch ist bei diesem Tatbestand nicht strafbar.' });
    db.prepare('UPDATE case_charges SET count = ?, attempted = ?, aiding = ? WHERE id = ?').run(
      d.count ?? ch.count,
      d.attempted === undefined ? ch.attempted : d.attempted ? 1 : 0,
      d.aiding === undefined ? ch.aiding : d.aiding ? 1 : 0,
      ch.id
    );
    res.json(payload(c));
  })
);

caseRouter.delete(
  '/:cid',
  wrap(async (req, res) => {
    const c = loadCase(req, res, { edit: true });
    if (!c) return;
    const ch = db.prepare('SELECT * FROM case_charges WHERE id = ? AND case_id = ?').get(Number(req.params.cid), c.id);
    if (!ch) return res.status(404).json({ error: 'Anklagepunkt nicht gefunden.' });
    db.prepare('DELETE FROM case_charges WHERE id = ?').run(ch.id);
    addSystemNote(c.id, req.user, `Anklagepunkt entfernt: ${penal.citation(ch)} – ${ch.title}`, true);
    res.json(payload(c));
  })
);

module.exports = { router, caseRouter, payload };
