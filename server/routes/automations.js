'use strict';
/*
 * Automatik-Regeln („Wenn … dann …“) – lesen darf die Kanzlei, ändern nur, wer Einstellungen bearbeiten darf.
 *  GET    /api/automations        Regeln + Auswahl (Auslöser, Aktionen, Rechtsgebiete)
 *  POST   /api/automations        neue Regel
 *  PUT    /api/automations/:id    Regel ändern (danach wird sie für alle Akten neu bewertet)
 *  DELETE /api/automations/:id    Regel löschen
 */
const express = require('express');
const { requireAuth, requireStaff } = require('../core/auth');
const { wrap, parseBody, idParam } = require('../core/helpers');
const perms = require('../core/permissions');
const { logActivity } = require('../db/models');
const auto = require('../domain/automations');

const router = express.Router();
router.use(requireAuth, requireStaff);
const mayEdit = (req, res) => perms.can(req.user, 'settings.edit') || void res.status(403).json({ error: 'Automatik-Regeln legt fest, wer die Einstellungen bearbeiten darf.' });

router.get('/', (req, res) => {
  res.json({
    rules: auto.list().map((r) => ({ ...r, summary: auto.describe(r) })),
    triggers: auto.TRIGGERS,
    actions: auto.ACTIONS,
    canEdit: perms.can(req.user, 'settings.edit'),
  });
});

router.post(
  '/',
  wrap(async (req, res) => {
    if (!mayEdit(req, res)) return;
    const d = parseBody(auto.schema, req, res);
    if (!d) return;
    const r = auto.create(d, req.user);
    logActivity(req.user, 'Automatik-Regel angelegt', 'settings', r.id, `${r.name}: ${auto.TRIGGERS[r.trigger]} → ${auto.describe(r)}`);
    res.status(201).json({ rule: { ...r, summary: auto.describe(r) } });
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    if (!mayEdit(req, res)) return;
    const id = idParam(req);
    if (!id || !auto.get(id)) return res.status(404).json({ error: 'Regel nicht gefunden.' });
    const d = parseBody(auto.schema, req, res);
    if (!d) return;
    const r = auto.update(id, d);
    logActivity(req.user, 'Automatik-Regel geändert', 'settings', id, `${r.name}${r.active ? '' : ' (aus)'}`);
    res.json({ rule: { ...r, summary: auto.describe(r) } });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    if (!mayEdit(req, res)) return;
    const id = idParam(req);
    const r = id && auto.get(id);
    if (!r) return res.status(404).json({ error: 'Regel nicht gefunden.' });
    auto.remove(id);
    logActivity(req.user, 'Automatik-Regel gelöscht', 'settings', id, r.name);
    res.json({ ok: true });
  })
);

module.exports = { router };
