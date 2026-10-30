'use strict';
/*
 * Orte einer Akte (Tatort-Karte, nur Kanzlei; ändern dürfen die zuständigen Anwälte):
 *  GET    /api/places/postals          alle Postleitzahlen [[code, x, y], …] (für die Karte)
 *  POST   /api/cases/:id/places        { postal? | x, y, kind, label?, note?, happenedAt?, lookDir? (0–359°, null = keine), lookRange? (m), lookFov? (°) }
 *  PATCH  /api/cases/:id/places/:pid   dieselben Felder
 *  DELETE /api/cases/:id/places/:pid
 * Jede Antwort der Akte-Adressen liefert die vollständige Liste { places }.
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff, isStaff } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime } = require('../helpers');
const { getCase, caseAccess, addSystemNote } = require('../models');
const places = require('../places');

/* ---------------------------------------------------------------- /api/places */
const postalsRouter = express.Router();
postalsRouter.use(requireAuth, requireStaff);
postalsRouter.get('/postals', (req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');
  res.json({ postals: places.postals().list });
});

/* ---------------------------------------------------------------- /api/cases/:id/places */
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
    res.status(403).json({ error: 'Orte ändern nur die zuständigen Anwälte.' });
    return null;
  }
  return c;
}

const fields = {
  postal: z.string().trim().regex(/^\d{3,5}$/, 'Postleitzahl wie 7152').optional(),
  x: z.number().min(-6000).max(6000).optional(),
  y: z.number().min(-6000).max(9000).optional(),
  kind: z.enum(Object.keys(places.KINDS)),
  label: z.string().trim().max(80).optional(),
  note: z.string().trim().max(1000).optional(),
  happenedAt: isoDateTime.nullable().optional(),
  lookDir: z.number().int().min(0).max(359).nullable().optional(),
  lookRange: z.number().int().min(5).max(500).optional(),
  lookFov: z.number().int().min(10).max(180).optional(),
};
const createBody = z.object(fields);
const patchBody = z.object(fields).partial();

/** Position bestimmen: Postleitzahl (Mitte des Postals) oder genaue Koordinaten (dann nächster Postal). */
function position(d, res) {
  if (d.x !== undefined && d.y !== undefined) {
    const n = places.nearest(d.x, d.y);
    return { postal: n.code, x: Math.round(d.x * 10) / 10, y: Math.round(d.y * 10) / 10 };
  }
  if (d.postal) {
    const p = places.byCode(d.postal);
    if (!p) {
      res.status(400).json({ error: `Die Postleitzahl ${d.postal} gibt es auf der Karte nicht.` });
      return null;
    }
    return { postal: p[0], x: p[1], y: p[2] };
  }
  res.status(400).json({ error: 'Bitte eine Postleitzahl oder einen Punkt auf der Karte angeben.' });
  return null;
}

const when = (v) => (v ? new Date(v).toISOString() : null);

router.post(
  '/',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const d = parseBody(createBody, req, res);
    if (!d) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM case_places WHERE case_id = ?').get(c.id).n >= 60) return res.status(400).json({ error: 'Höchstens 60 Orte je Akte.' });
    const pos = position(d, res);
    if (!pos) return;
    db.prepare(
      'INSERT INTO case_places (case_id, postal, x, y, kind, label, note, happened_at, created_by, look_dir, look_range, look_fov) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      c.id,
      pos.postal,
      pos.x,
      pos.y,
      d.kind,
      d.label || '',
      d.note || '',
      when(d.happenedAt),
      req.user.display_name,
      d.lookDir === undefined ? null : d.lookDir,
      d.lookRange || 80,
      d.lookFov || 70
    );
    addSystemNote(c.id, req.user, `Ort erfasst: ${places.KINDS[d.kind]}, Postal ${pos.postal}${d.label ? ` – ${d.label}` : ''}.`, true);
    res.status(201).json({ places: places.listForCase(c.id) });
  })
);

router.patch(
  '/:pid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const pid = Number(req.params.pid);
    const cur = db.prepare('SELECT * FROM case_places WHERE id = ? AND case_id = ?').get(pid, c.id);
    if (!cur) return res.status(404).json({ error: 'Ort nicht gefunden.' });
    const d = parseBody(patchBody, req, res);
    if (!d) return;
    const sets = [];
    const values = [];
    const set = (col, v) => {
      sets.push(`${col} = ?`);
      values.push(v);
    };
    if (d.x !== undefined || d.y !== undefined || d.postal !== undefined) {
      const pos = position(d.x !== undefined && d.y !== undefined ? { x: d.x, y: d.y } : { postal: d.postal }, res);
      if (!pos) return;
      set('postal', pos.postal);
      set('x', pos.x);
      set('y', pos.y);
    }
    if (d.kind !== undefined) set('kind', d.kind);
    if (d.label !== undefined) set('label', d.label);
    if (d.note !== undefined) set('note', d.note);
    if (d.happenedAt !== undefined) set('happened_at', when(d.happenedAt));
    if (d.lookDir !== undefined) set('look_dir', d.lookDir);
    if (d.lookRange !== undefined) set('look_range', d.lookRange);
    if (d.lookFov !== undefined) set('look_fov', d.lookFov);
    if (sets.length) db.prepare(`UPDATE case_places SET ${sets.join(', ')} WHERE id = ?`).run(...values, pid);
    res.json({ places: places.listForCase(c.id) });
  })
);

router.delete(
  '/:pid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const cur = db.prepare('SELECT * FROM case_places WHERE id = ? AND case_id = ?').get(Number(req.params.pid), c.id);
    if (!cur) return res.status(404).json({ error: 'Ort nicht gefunden.' });
    db.prepare('DELETE FROM case_places WHERE id = ?').run(cur.id);
    addSystemNote(c.id, req.user, `Ort entfernt: ${places.KINDS[cur.kind] || cur.kind}, Postal ${cur.postal}${cur.label ? ` – ${cur.label}` : ''}.`, true);
    res.json({ places: places.listForCase(c.id) });
  })
);

module.exports = { router, postalsRouter };
