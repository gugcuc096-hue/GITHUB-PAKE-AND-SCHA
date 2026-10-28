'use strict';
/*
 * Rechte & Schalter (Einstellungen → Rechte): Inhaber, Web-Admins, Rechte-Tabelle, Änderungsprotokoll, Feature-Schalter.
 * Web-Admins und die Rechte-Tabelle bestimmt nur der Inhaber; Schalter und Protokoll hängen an eigenen Rechten.
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff, userAvatarUrl } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { logActivity } = require('../models');
const perms = require('../permissions');
const configLog = require('../configLog');
const features = require('../features');

const router = express.Router();
router.use(requireAuth, requireStaff);

const person = (u) => ({
  id: u.id,
  displayName: u.display_name,
  role: u.role,
  rank: u.rank,
  avatarUrl: userAvatarUrl(u),
  discord: u.discord_username || null,
  webAdmin: !!u.web_admin,
  owner: !!u.is_owner,
});

router.get('/', (req, res) => {
  const me = req.user;
  const owner = perms.isOwner(me);
  const staff = db.prepare("SELECT * FROM users WHERE role IN ('anwalt','admin') AND active = 1 ORDER BY display_name").all().map(person);
  const bot = require('../discordBot');
  res.json({
    perms: perms.PERMS,
    groups: perms.GROUPS,
    matrix: perms.matrix(),
    defaults: perms.DEFAULTS,
    mine: perms.permsOf(me),
    owner,
    staff: owner || perms.can(me, 'config.audit') ? staff : staff.filter((p) => p.webAdmin || p.owner),
    features: { list: features.FEATURES, values: features.all() },
    discordRole: { id: bot.webAdminRole() || null },
  });
});

/* ---------------------------------------------------------------- Inhaber: Rechte-Tabelle, Web-Admins */
const matrixBody = z.object({
  webadmin: z.array(z.string()).max(40),
  board: z.array(z.string()).max(40),
  anwalt: z.array(z.string()).max(40),
});

router.put(
  '/matrix',
  perms.requireOwner,
  wrap(async (req, res) => {
    const d = parseBody(matrixBody, req, res);
    if (!d) return;
    const before = perms.matrix();
    const after = perms.saveMatrix(d);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      configLog.add(req.user, { area: 'permissions', key: 'perm_matrix', label: 'Rechte-Tabelle geändert', perm: perms.OWNER_ONLY, before, after, revertible: true });
      logActivity(req.user, 'Rechte-Tabelle geändert', 'settings', null, '');
    }
    res.json({ matrix: after });
  })
);

router.post(
  '/web-admins',
  perms.requireOwner,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ userId: z.number().int().positive() }), req, res);
    if (!d) return;
    const r = perms.setWebAdmin(req.user, d.userId, true);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ webAdmin: person(r.user) });
  })
);

router.delete(
  '/web-admins/:id',
  perms.requireOwner,
  wrap(async (req, res) => {
    const id = idParam(req);
    const r = id && perms.setWebAdmin(req.user, id, false);
    if (!r || !r.ok) return res.status(400).json({ error: (r && r.error) || 'Nicht gefunden.' });
    res.json({ ok: true });
  })
);

/** Inhaber an ein anderes Board-Konto übergeben (z. B. wenn der Betreiber wechselt). */
router.post(
  '/owner',
  perms.requireOwner,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ userId: z.number().int().positive(), confirm: z.literal(true) }), req, res);
    if (!d) return;
    const t = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin' AND active = 1").get(d.userId);
    if (!t) return res.status(400).json({ error: 'Der neue Inhaber muss ein aktives Konto im Board of Partners (Rolle Admin) sein.' });
    db.prepare('UPDATE users SET is_owner = 0').run();
    db.prepare('UPDATE users SET is_owner = 1, web_admin = 0 WHERE id = ?').run(t.id);
    configLog.add(req.user, { area: 'webadmin', key: String(t.id), label: `Inhaber übergeben an ${t.display_name}` });
    logActivity(req.user, 'Inhaber übergeben', 'user', t.id, t.display_name);
    res.json({ ok: true });
  })
);

/** Discord-Rolle „Web Admin“ anlegen (oder die vorhandene nehmen) und alle Web-Admins abgleichen. */
router.post(
  '/discord-role',
  perms.requireOwner,
  wrap(async (req, res) => {
    try {
      const r = await require('../discordBot').ensureWebAdminRole();
      configLog.add(req.user, { area: 'webadmin', key: 'discord_role', label: r.created ? 'Discord-Rolle „Web Admin“ angelegt' : 'Discord-Rolle „Web Admin“ übernommen' });
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

/* ---------------------------------------------------------------- Feature-Schalter */
router.put(
  '/features',
  perms.requirePerm('settings.edit'),
  wrap(async (req, res) => {
    const d = parseBody(z.object(Object.fromEntries(features.KEYS.map((k) => [k, z.boolean().optional()]))), req, res);
    if (!d) return;
    res.json({ values: features.save(d) });
  })
);

/* ---------------------------------------------------------------- Änderungsprotokoll */
router.get('/log', perms.requirePerm('config.audit'), (req, res) => {
  const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 150));
  res.json({ log: configLog.list(limit) });
});

router.post(
  '/log/:id/revert',
  wrap(async (req, res) => {
    const id = idParam(req);
    const r = id && db.prepare('SELECT perm FROM config_log WHERE id = ?').get(id);
    if (!r) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    if (!perms.can(req.user, 'config.audit') || (r.perm && !perms.can(req.user, r.perm))) return res.status(403).json({ error: 'Dafür fehlt Ihnen das Recht.' });
    try {
      res.json({ entry: configLog.revert(id, req.user) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  })
);

/* ---------------------------------------------------------------- Öffentlich: welche Funktionen sind an? */
const publicRouter = express.Router();
publicRouter.get('/features', (req, res) => res.json({ features: features.all() }));

module.exports = { router, publicRouter };
