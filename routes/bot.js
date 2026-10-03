'use strict';
/*
 * /api/bot – Einstellungen des Kanzlei-Bots (nur Board of Partners):
 * Status der Verbindung, Rollen/Kanäle des Servers, Rang-Sync, Role Connections, Willkommen & Abschied.
 * Der Bot-Token bleibt in der Umgebungsvariable DISCORD_BOT_TOKEN – er wird hier weder gespeichert noch ausgegeben.
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { requireAuth, requireAdmin } = require('../auth');
const { wrap, parseBody, RANKS } = require('../helpers');
const { logActivity } = require('../models');
const { db } = require('../db');
const bot = require('../discordBot');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const ID = /^\d{15,25}$/;
const id = z.string().trim().regex(ID, 'Ungültige ID.');
const idOrEmpty = z.union([id, z.literal('')]);

function overview() {
  return {
    status: bot.status(),
    rankSync: bot.rankSyncConfig(),
    connections: bot.connectionsConfig(),
    welcome: bot.welcomeConfig(),
    ranks: RANKS,
    placeholders: bot.PLACEHOLDERS,
    limits: { rules: bot.MAX_RULES, conditions: bot.MAX_CONDITIONS },
    // Wer bekommt überhaupt Rollen? Nur Konten mit verknüpftem Discord.
    linked: db
      .prepare(
        `SELECT SUM(CASE WHEN role IN ('anwalt','admin') THEN 1 ELSE 0 END) AS staff,
                SUM(CASE WHEN role IN ('anwalt','admin') AND discord_id IS NOT NULL THEN 1 ELSE 0 END) AS staffLinked,
                SUM(CASE WHEN role = 'mandant' AND discord_id IS NOT NULL THEN 1 ELSE 0 END) AS clientsLinked
         FROM users WHERE active = 1`
      )
      .get(),
  };
}

router.get('/', (req, res) => res.json(overview()));

/** Rollen und Kanäle des Servers (für die Auswahllisten). ?refresh=1 lädt neu. */
router.get(
  '/discord',
  wrap(async (req, res) => {
    try {
      res.json(await bot.discordData(req.query.refresh === '1'));
    } catch (err) {
      res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
    }
  })
);

/* ---------------------------------------------------------------- Rang-Sync */
router.put(
  '/rank-sync',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        enabled: z.boolean(),
        ranks: z.record(z.enum(RANKS), idOrEmpty),
        staff: idOrEmpty,
        board: idOrEmpty,
        associates: idOrEmpty,
        client: idOrEmpty,
        strict: z.boolean(),
      }),
      req,
      res
    );
    if (!d) return;
    bot.saveJson('bot_rank_sync', d);
    logActivity(req.user, 'Discord-Bot: Rang-Sync gespeichert', 'settings', null, d.enabled ? 'eingeschaltet' : 'ausgeschaltet');
    bot.refresh();
    if (d.enabled) bot.scan('nach Speichern').catch(() => {});
    res.json(overview());
  })
);

/* ---------------------------------------------------------------- Role Connections */
router.put(
  '/connections',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        enabled: z.boolean(),
        rules: z
          .array(
            z.object({
              id: z.string().trim().max(40).optional(),
              roleId: id,
              mode: z.enum(['or', 'and']),
              conditions: z.array(z.object({ has: z.boolean(), roleId: id })).min(1).max(bot.MAX_CONDITIONS),
            })
          )
          .max(bot.MAX_RULES),
      }),
      req,
      res
    );
    if (!d) return;
    const seen = new Set();
    for (const [i, r] of d.rules.entries()) {
      if (r.conditions.some((c) => c.roleId === r.roleId)) {
        return res.status(400).json({ error: `Regel ${i + 1}: Die Hauptrolle kann nicht ihre eigene Bedingung sein.` });
      }
      if (seen.has(r.roleId)) {
        return res.status(400).json({ error: `Regel ${i + 1}: Diese Hauptrolle hat schon eine Regel – bitte die Bedingungen dort ergänzen.` });
      }
      seen.add(r.roleId);
      r.id = r.id || crypto.randomUUID().slice(0, 8);
    }
    bot.saveJson('bot_role_connections', d);
    logActivity(req.user, 'Discord-Bot: Role Connections gespeichert', 'settings', null, `${d.rules.length} Regel(n), ${d.enabled ? 'eingeschaltet' : 'ausgeschaltet'}`);
    bot.refresh();
    if (d.enabled) bot.scan('nach Speichern').catch(() => {});
    res.json(overview());
  })
);

/* ---------------------------------------------------------------- Willkommen & Abschied */
const embedSchema = z.object({
  enabled: z.boolean(),
  title: z.string().max(256),
  description: z.string().max(4000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB.'),
  thumbnail: z.enum(['avatar', 'server', 'none']),
  image: z.string().trim().max(500).refine((v) => !v || /^https:\/\/\S+$/i.test(v) || v === '{user.avatar}', 'Bild-Link muss mit https:// beginnen.'),
  footer: z.string().max(2048),
  timestamp: z.boolean(),
});

router.put(
  '/welcome',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        enabled: z.boolean(),
        channelId: idOrEmpty,
        content: z.string().max(2000),
        embed: embedSchema,
        dm: z.object({ enabled: z.boolean(), content: z.string().max(2000), embed: embedSchema }),
        leave: z.object({ enabled: z.boolean(), channelId: idOrEmpty, content: z.string().max(2000), embed: embedSchema }),
        joinRoles: z.array(id).max(10),
      }),
      req,
      res
    );
    if (!d) return;
    if (d.enabled && !d.channelId && !d.dm.enabled && !d.joinRoles.length) {
      return res.status(400).json({ error: 'Bitte einen Kanal für die Willkommensnachricht wählen (oder Direktnachricht bzw. Beitrittsrollen einschalten).' });
    }
    if (d.leave.enabled && !d.leave.channelId) return res.status(400).json({ error: 'Bitte einen Kanal für die Abschiedsnachricht wählen.' });
    const before = bot.welcomeConfig();
    // Ab dem Einschalten zählen Beitritte (verpasste werden höchstens 24 h nachgeholt – nie alte Mitglieder)
    const since = d.enabled ? (before.enabled && before.since ? before.since : new Date().toISOString()) : null;
    bot.saveJson('bot_welcome', { ...d, since });
    logActivity(req.user, 'Discord-Bot: Willkommensnachrichten gespeichert', 'settings', null, d.enabled ? 'eingeschaltet' : 'ausgeschaltet');
    bot.refresh();
    res.json(overview());
  })
);

router.post(
  '/welcome/test',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ kind: z.enum(['join', 'dm', 'leave']) }), req, res);
    if (!d) return;
    if (!req.user.discord_id) return res.status(400).json({ error: 'Für den Test bitte zuerst im Profil Ihr Discord-Konto verknüpfen – die Testnachricht nutzt Sie als neues Mitglied.' });
    try {
      const where = await bot.testWelcome(d.kind, req.user.discord_id);
      res.json({ success: true, where });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

/* ---------------------------------------------------------------- Abgleich & Verbindung */
router.post(
  '/scan',
  wrap(async (req, res) => {
    const stats = await bot.scan('manuell');
    logActivity(req.user, 'Discord-Bot: alle Mitglieder abgeglichen', 'settings', null, stats ? `${stats.members} Mitglieder, ${stats.added} Rollen vergeben, ${stats.removed} entfernt` : '');
    res.json({ stats, ...overview() });
  })
);

router.post('/reconnect', (req, res) => {
  bot.restart();
  res.json(overview());
});

module.exports = { router };
