'use strict';
/*
 * Kooperationen – anlegen und pflegen (Board of Partners), Erkennung für das Rechnungsformular (Team)
 * und „Meine Vorteile“ für Mandanten. Logik der Erkennung: ../cooperations.js
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, isBoard } = require('../helpers');
const { getCase, caseAccess, logActivity } = require('../models');
const tickets = require('../tickets');
const coop = require('../cooperations');

const router = express.Router();
router.use(requireAuth);

function requireBoard(req, res, next) {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
}

const load = (id) => db.prepare('SELECT * FROM cooperations WHERE id = ?').get(id) || null;

function members(id) {
  return db
    .prepare(
      `SELECT m.user_id, m.added_by_name, m.created_at, u.display_name, u.email, u.discord_id
       FROM cooperation_members m JOIN users u ON u.id = m.user_id
       WHERE m.cooperation_id = ? ORDER BY u.display_name`
    )
    .all(id)
    .map((m) => ({ userId: m.user_id, name: m.display_name, email: m.email, discordLinked: !!m.discord_id, addedBy: m.added_by_name, addedAt: m.created_at }));
}

/** Für das Team: Grunddaten; für das Board zusätzlich Discord-Rollen (mit Namen) und zugeordnete Konten. */
async function row(k, u, full = isBoard(u)) {
  const base = {
    id: k.id,
    name: k.name,
    description: k.description,
    discountPct: k.discount_pct,
    validUntil: k.valid_until || null,
    active: !!k.active,
    valid: coop.isValid(k),
  };
  if (!full) return base;
  const roleIds = coop.splitIds(k.role_ids);
  const guildId = coop.guildOf(k);
  let roles = roleIds.map((id) => ({ id, name: null }));
  let roleError = null;
  if (roleIds.length) {
    try {
      const all = await coop.guildRoles(guildId);
      roles = roleIds.map((id) => ({ id, name: all.find((r) => r.id === id)?.name || null }));
      if (roles.some((r) => !r.name)) roleError = 'Mindestens eine Rolle gibt es auf dem Server nicht (mehr).';
    } catch (err) {
      roleError = err.message;
    }
  }
  return { ...base, guildId: k.guild_id || '', usesDefaultGuild: !k.guild_id, roles, roleError, members: members(k.id), createdAt: k.created_at };
}

router.get(
  '/',
  requireStaff,
  wrap(async (req, res) => {
    const list = db.prepare('SELECT * FROM cooperations ORDER BY active DESC, name COLLATE NOCASE').all();
    const cfg = tickets.config();
    res.json({
      // ?basic=1: nur Grunddaten (Rechnungsformular) – ohne Rollen-Abfrage bei Discord
      cooperations: await Promise.all(list.map((k) => row(k, req.user, isBoard(req.user) && req.query.basic !== '1'))),
      canManage: isBoard(req.user),
      discord: { bot: tickets.hasToken(), defaultGuild: tickets.isId(cfg.guildId) },
    });
  })
);

/** Rollen eines Discord-Servers (Auswahl beim Anlegen) – nur Board. */
router.get(
  '/roles',
  requireBoard,
  wrap(async (req, res) => {
    const guildId = String(req.query.guildId || '').trim() || tickets.config().guildId;
    try {
      res.json({ guildId, roles: await coop.guildRoles(guildId, { fresh: req.query.fresh === '1' }) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

/** Welche Kooperation gilt für den Mandanten dieser Akte bzw. dieses Kontos? (Rechnungsformular) */
router.get(
  '/detect',
  requireStaff,
  wrap(async (req, res) => {
    const caseId = Number(req.query.caseId);
    const userId = Number(req.query.userId);
    if (caseId) {
      const c = getCase(caseId);
      if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
      return res.json(await coop.detectForCase(c));
    }
    if (userId) return res.json(await coop.detectForUser(userId));
    res.json({ matches: [], best: null, notes: [], checkedDiscord: false });
  })
);

/** Mandant: eigene Kooperationsvorteile (Profil). */
router.get(
  '/mine',
  wrap(async (req, res) => {
    const r = await coop.detectForUser(req.user.id);
    res.json({ matches: r.matches.map(({ name, discountPct, via }) => ({ name, discountPct, via })) });
  })
);

const idField = z.union([z.string().trim().regex(/^\d{15,25}$/, 'Die ID besteht aus 15–25 Ziffern.'), z.literal('')]);
const fields = {
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000),
  discountPct: z.number().min(0.5).max(100),
  guildId: idField,
  roleIds: z.string().trim().max(400),
  validUntil: dateOnly.nullable(),
  active: z.boolean(),
};

function normalizeRoles(d, res) {
  if (d.roleIds === undefined) return true;
  const ids = d.roleIds.split(/[\s,;]+/).filter(Boolean);
  if (ids.some((id) => !tickets.isId(id))) {
    res.status(400).json({ error: 'Rollen-IDs bestehen nur aus Ziffern (mehrere mit Komma trennen).' });
    return false;
  }
  d.roleIds = [...new Set(ids)].join(',');
  return true;
}

const summary = (k) => `${k.name}: ${k.discount_pct} %${k.role_ids ? ` · Rollen ${k.role_ids}` : ''}${k.active ? '' : ' · inaktiv'}`;

router.post(
  '/',
  requireBoard,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ ...fields, description: fields.description.optional(), guildId: fields.guildId.optional(), roleIds: fields.roleIds.optional(), validUntil: fields.validUntil.optional(), active: fields.active.optional() }), req, res);
    if (!d || !normalizeRoles(d, res)) return;
    const info = db
      .prepare('INSERT INTO cooperations (name, description, discount_pct, guild_id, role_ids, valid_until, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.name, d.description || '', d.discountPct, d.guildId || '', d.roleIds || '', d.validUntil || null, d.active === false ? 0 : 1, req.user.id);
    const k = load(Number(info.lastInsertRowid));
    logActivity(req.user, 'Kooperation angelegt', 'cooperation', k.id, summary(k));
    res.status(201).json({ cooperation: await row(k, req.user) });
  })
);

router.patch(
  '/:id',
  requireBoard,
  wrap(async (req, res) => {
    const k = load(idParam(req));
    if (!k) return res.status(404).json({ error: 'Kooperation nicht gefunden.' });
    const d = parseBody(z.object(fields).partial(), req, res);
    if (!d || !normalizeRoles(d, res)) return;
    const map = { name: 'name', description: 'description', discountPct: 'discount_pct', guildId: 'guild_id', roleIds: 'role_ids', validUntil: 'valid_until', active: 'active' };
    const sets = [];
    const vals = [];
    for (const [key, col] of Object.entries(map)) {
      if (d[key] === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(typeof d[key] === 'boolean' ? (d[key] ? 1 : 0) : d[key]);
    }
    if (sets.length) db.prepare(`UPDATE cooperations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, k.id);
    const fresh = load(k.id);
    logActivity(req.user, 'Kooperation geändert', 'cooperation', k.id, summary(fresh));
    res.json({ cooperation: await row(fresh, req.user) });
  })
);

router.delete(
  '/:id',
  requireBoard,
  wrap(async (req, res) => {
    const k = load(idParam(req));
    if (!k) return res.status(404).json({ error: 'Kooperation nicht gefunden.' });
    db.prepare('DELETE FROM cooperations WHERE id = ?').run(k.id); // Rechnungen behalten Name und Satz
    logActivity(req.user, 'Kooperation gelöscht', 'cooperation', k.id, k.name);
    res.json({ success: true });
  })
);

/** Mandantenkonto von Hand zuordnen (z. B. ohne Discord) bzw. entfernen. */
router.post(
  '/:id/members',
  requireBoard,
  wrap(async (req, res) => {
    const k = load(idParam(req));
    if (!k) return res.status(404).json({ error: 'Kooperation nicht gefunden.' });
    const d = parseBody(z.object({ userId: z.number().int().positive() }), req, res);
    if (!d) return;
    const u = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role = 'mandant' AND active = 1").get(d.userId);
    if (!u) return res.status(400).json({ error: 'Nur aktive Mandantenkonten können zugeordnet werden.' });
    db.prepare('INSERT OR IGNORE INTO cooperation_members (cooperation_id, user_id, added_by_name) VALUES (?, ?, ?)').run(k.id, u.id, req.user.display_name);
    logActivity(req.user, 'Kooperation: Konto zugeordnet', 'cooperation', k.id, `${k.name}: ${u.display_name}`);
    res.json({ cooperation: await row(k, req.user) });
  })
);

router.delete(
  '/:id/members/:userId',
  requireBoard,
  wrap(async (req, res) => {
    const k = load(idParam(req));
    const userId = idParam(req, 'userId');
    if (!k || !userId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
    db.prepare('DELETE FROM cooperation_members WHERE cooperation_id = ? AND user_id = ?').run(k.id, userId);
    logActivity(req.user, 'Kooperation: Konto entfernt', 'cooperation', k.id, `${k.name}: ${u ? u.display_name : userId}`);
    res.json({ cooperation: await row(k, req.user) });
  })
);

module.exports = { router };
