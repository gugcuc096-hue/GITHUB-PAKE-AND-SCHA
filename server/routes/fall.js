'use strict';
/*
 * Fall-Bausteine einer Akte je Rechtsgebiet (nur Kanzlei; ändern dürfen die zuständigen Anwälte) – Aufbau siehe domain/fall.js:
 *  PUT    /api/cases/:id/fall                 Einzelangaben ändern (nur die mitgeschickten Felder), z. B. { streitwert, mode, c_frist }
 *  POST   /api/cases/:id/fall/items           { kind, …Felder }   Eintrag anlegen (Anspruch, Antrag, Klausel, Norm …)
 *  PATCH  /api/cases/:id/fall/items/:iid      { …Felder }          Eintrag ändern
 *  DELETE /api/cases/:id/fall/items/:iid      Eintrag entfernen
 * Jede Antwort enthält den vollständigen Stand { fall }.
 */
const express = require('express');
const { z } = require('zod');
const { requireAuth, requireStaff, isStaff } = require('../core/auth');
const { wrap, parseBody, idParam } = require('../core/helpers');
const { getCase, caseAccess, addSystemNote } = require('../db/models');
const fall = require('../domain/fall');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireStaff);

function load(req, res) {
  const id = idParam(req);
  const c = id && getCase(id);
  const access = c && isStaff(req.user) ? caseAccess(c, req.user) : null;
  if (!c || !access || !access.canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  if (!access.canEdit) {
    res.status(403).json({ error: 'Das ändern nur die zuständigen Anwälte.' });
    return null;
  }
  if (!fall.LAYOUT[c.area]) {
    res.status(400).json({ error: 'Für dieses Rechtsgebiet gibt es keine eigenen Fall-Bausteine.' });
    return null;
  }
  return c;
}

const label = (kind, d) => {
  const spec = fall.KINDS[kind];
  const t = String(d[spec.title] ?? '');
  const o = spec.fields.find((x) => x.key === spec.title);
  const shown = o && o.options ? (o.options.find((x) => x[0] === t) || [, t])[1] : t;
  return shown.length > 70 ? `${shown.slice(0, 67)}…` : shown;
};

router.put(
  '/',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const fields = fall.uniqueBy(fall.allMetaFields(c.area));
    const d = parseBody(fall.schemaFor(fields, { partial: true }), req, res);
    if (!d) return;
    const before = fall.meta(c.id, c.area);
    fall.saveMeta(c.id, c.area, d);
    if (d.mode && d.mode !== before.mode) addSystemNote(c.id, req.user, `Modus der Akte: ${d.mode === 'streit' ? 'Vertragsstreit' : 'Vertragsgestaltung'}.`, true);
    if (d.procedure && d.procedure !== before.procedure) {
      const o = fields.find((x) => x.key === 'procedure').options.find((x) => x[0] === d.procedure);
      addSystemNote(c.id, req.user, `Verfahrensart: ${o[1]}.`, true);
    }
    res.json({ fall: fall.payload(c) });
  })
);

/** Art des Eintrags prüfen: muss im Aufbau dieses Rechtsgebiets vorkommen. */
const kindOk = (c, kind) => !!fall.KINDS[kind] && fall.LAYOUT[c.area].sections.some((s) => s.item === kind);

router.post(
  '/items',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const kind = String((req.body || {}).kind || '');
    if (!kindOk(c, kind)) return res.status(400).json({ error: 'Diese Art Eintrag gibt es in dieser Akte nicht.' });
    const { kind: _k, ...rest } = req.body;
    const d = parseBody(fall.schemaFor(fall.KINDS[kind].fields), { body: rest }, res);
    if (!d) return;
    try {
      fall.addItem(c.id, kind, d, req.user);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    addSystemNote(c.id, req.user, `${fall.KINDS[kind].label} erfasst: ${label(kind, d)}.`, true);
    res.status(201).json({ fall: fall.payload(c) });
  })
);

router.patch(
  '/items/:iid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const cur = fall.one(c.id, Number(req.params.iid));
    if (!cur || !kindOk(c, cur.kind)) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    const d = parseBody(fall.schemaFor(fall.KINDS[cur.kind].fields, { partial: true }), req, res);
    if (!d) return;
    const data = Object.fromEntries(fall.KINDS[cur.kind].fields.map((s) => [s.key, d[s.key] === undefined ? cur[s.key] : d[s.key]]));
    // Pflichtfelder bleiben Pflicht
    const bad = fall.KINDS[cur.kind].fields.find((s) => s.required && !['select', 'tri', 'check', 'date', 'money'].includes(s.type) && !String(data[s.key]).trim());
    if (bad) return res.status(400).json({ error: `„${bad.label}“ ist nötig.`, fieldErrors: { [bad.key]: 'Bitte ausfüllen.' } });
    fall.saveItem(c.id, cur.id, data);
    res.json({ fall: fall.payload(c) });
  })
);

router.delete(
  '/items/:iid',
  wrap(async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const cur = fall.one(c.id, Number(req.params.iid));
    if (!cur || !kindOk(c, cur.kind)) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    fall.removeItem(c.id, cur.id);
    addSystemNote(c.id, req.user, `${fall.KINDS[cur.kind].label} entfernt: ${label(cur.kind, cur)}.`, true);
    res.json({ fall: fall.payload(c) });
  })
);

module.exports = { router };
