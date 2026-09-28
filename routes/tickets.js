'use strict';
/*
 * Discord-Tickets (je Akte ein privater Kanal) – Einrichtung für das Board of Partners und
 * „Discord abgleichen“ in der Akte. Die eigentliche Logik steckt in ../tickets.js.
 */
const express = require('express');
const { z } = require('zod');
const { setSetting } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { wrap, parseBody, idParam } = require('../helpers');
const { getCase, caseAccess, logActivity } = require('../models');
const tickets = require('../tickets');

const router = express.Router();
router.use(requireAuth);

router.get('/settings', requireAdmin, (req, res) => {
  res.json(tickets.status());
});

const idField = z.union([z.string().trim().regex(/^\d{15,25}$/, 'Die ID besteht aus 15–25 Ziffern.'), z.literal('')]);

router.patch(
  '/settings',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        enabled: z.boolean().optional(),
        guildId: idField.optional(),
        categoryId: idField.optional(),
        archiveId: idField.optional(),
        roleIds: z.string().trim().max(300).optional(),
        pingRoles: z.boolean().optional(),
      }),
      req,
      res
    );
    if (!d) return;
    if (d.roleIds !== undefined) {
      const ids = d.roleIds.split(/[\s,;]+/).filter(Boolean);
      if (ids.some((id) => !tickets.isId(id))) return res.status(400).json({ error: 'Rollen-IDs bestehen nur aus Ziffern (mehrere mit Komma trennen).' });
      d.roleIds = ids.join(',');
    }
    const map = { enabled: 'discord_tickets_enabled', guildId: 'discord_ticket_guild', categoryId: 'discord_ticket_category', archiveId: 'discord_ticket_archive', roleIds: 'discord_ticket_roles', pingRoles: 'discord_ticket_ping' };
    for (const [k, key] of Object.entries(map)) {
      if (d[k] === undefined) continue;
      setSetting(key, typeof d[k] === 'boolean' ? (d[k] ? '1' : '0') : d[k]);
    }
    logActivity(req.user, 'Einstellungen geändert', 'settings', null, `Discord-Tickets: ${Object.keys(d).join(', ')}`);
    res.json(tickets.status());
  })
);

router.post(
  '/test',
  requireAdmin,
  wrap(async (req, res) => {
    res.json({ ...(await tickets.test()), status: tickets.status() });
  })
);

/** Tickets für alle offenen Akten ohne Kanal nachträglich anlegen. */
router.post(
  '/backfill',
  requireAdmin,
  wrap(async (req, res) => {
    if (!tickets.active()) return res.status(400).json({ error: 'Discord-Tickets sind noch nicht vollständig eingerichtet (Token, Server, Kategorie, eingeschaltet).' });
    const r = await tickets.backfill();
    logActivity(req.user, 'Discord-Tickets nachgeholt', 'settings', null, `${r.created} von ${r.total} Akten`);
    res.json({ ...r, status: tickets.status() });
  })
);

/** Ticket einer Akte anlegen bzw. Mitglieder abgleichen (z. B. nachdem der Mandant dem Server beigetreten ist). */
router.post(
  '/cases/:id/sync',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!tickets.active()) return res.status(400).json({ error: 'Discord-Tickets sind nicht eingerichtet.' });
    await tickets.syncCase(c.id);
    const fresh = getCase(c.id);
    if (fresh.discord_error && req.user.role !== 'mandant') return res.status(502).json({ error: fresh.discord_error, ticket: tickets.ticketInfo(fresh, req.user) });
    res.json({ ticket: tickets.ticketInfo(fresh, req.user) });
  })
);

module.exports = router;
