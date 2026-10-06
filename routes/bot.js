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
const msgs = require('../botMessages');
const dm = require('../botDm');
const { idParam } = require('../helpers');

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
    joinRoles: bot.joinRolesConfig(),
    ranks: RANKS,
    placeholders: bot.PLACEHOLDERS,
    limits: { rules: bot.MAX_RULES, conditions: bot.MAX_CONDITIONS, joinRoles: bot.MAX_JOIN_ROLES },
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
      }),
      req,
      res
    );
    if (!d) return;
    if (d.enabled && !d.channelId && !d.dm.enabled) {
      return res.status(400).json({ error: 'Bitte einen Kanal für die Willkommensnachricht wählen (oder die Direktnachricht einschalten).' });
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

/* ---------------------------------------------------------------- Join Roles */
router.put(
  '/join-roles',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        enabled: z.boolean(),
        humans: z.array(id).max(bot.MAX_JOIN_ROLES),
        bots: z.array(id).max(bot.MAX_JOIN_ROLES),
        delayMinutes: z.number().int().min(0).max(1440),
        waitScreening: z.boolean(),
        alwaysEnabled: z.boolean(),
        always: z.array(id).max(bot.MAX_JOIN_ROLES),
        alwaysBots: z.boolean(),
      }),
      req,
      res
    );
    if (!d) return;
    if (d.enabled && !d.humans.length && !d.bots.length) return res.status(400).json({ error: 'Join Roles: bitte mindestens eine Rolle für neue Mitglieder oder Bots wählen.' });
    if (d.alwaysEnabled && !d.always.length) return res.status(400).json({ error: 'Standardrollen: bitte mindestens eine Rolle wählen.' });
    const before = bot.joinRolesConfig();
    // Ab dem Einschalten zählen Beitritte (verpasste werden höchstens 24 h nachgeholt – nie alte Mitglieder)
    const since = d.enabled ? (before.enabled && before.since ? before.since : new Date().toISOString()) : null;
    bot.saveJson('bot_join_roles', { ...d, humans: [...new Set(d.humans)], bots: [...new Set(d.bots)], always: [...new Set(d.always)], since });
    logActivity(
      req.user,
      'Discord-Bot: Join Roles gespeichert',
      'settings',
      null,
      `${d.enabled ? `Join Roles: ${d.humans.length} für Mitglieder, ${d.bots.length} für Bots` : 'Join Roles aus'} · ${d.alwaysEnabled ? `Standardrollen: ${d.always.length}` : 'Standardrollen aus'}`
    );
    bot.refresh();
    if (d.alwaysEnabled) bot.scan('nach Speichern').catch(() => {}); // Standardrollen sofort an alle
    res.json(overview());
  })
);

/** Join Roles nachträglich an alle bisherigen Mitglieder (bzw. Bots) – nur fehlende Rollen. */
router.post(
  '/join-roles/apply',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ target: z.enum(['humans', 'bots']) }), req, res);
    if (!d) return;
    const cfg = bot.joinRolesConfig();
    if (!(d.target === 'bots' ? cfg.bots : cfg.humans).length) return res.status(400).json({ error: 'Für diese Gruppe ist noch keine Rolle gespeichert.' });
    const stats = await bot.joinRolesToAll(d.target);
    if (!stats) return res.status(502).json({ error: 'Discord war nicht erreichbar – bitte später erneut versuchen.' });
    if (stats.error) return res.status(502).json({ error: stats.error });
    logActivity(req.user, 'Discord-Bot: Join Roles an alle vergeben', 'settings', null, `${d.target === 'bots' ? 'Bots' : 'Mitglieder'}: ${stats.added} Rolle(n) an ${stats.changed} vergeben`);
    res.json({ stats, ...overview() });
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

/* ---------------------------------------------------------------- Nachrichten (Vorlagen, Senden, Automatik) */
const https = z.string().trim().max(500).refine((v) => !v || /^https:\/\/\S+$/i.test(v), 'Links müssen mit https:// beginnen.');
const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  data: z.object({
    content: z.string().max(2000),
    allowMentions: z.boolean(),
    embed: z.object({
      enabled: z.boolean(),
      author: z.string().max(256),
      title: z.string().max(256),
      url: https,
      description: z.string().max(4000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB.'),
      thumbnail: z.enum(['none', 'server', 'url']),
      thumbnailUrl: https,
      image: https,
      footer: z.string().max(2048),
      timestamp: z.boolean(),
      fields: z.array(z.object({ name: z.string().max(256), value: z.string().max(1024), inline: z.boolean() })).max(10),
    }),
    buttons: z.array(z.object({ label: z.string().trim().max(80), url: https })).max(5),
  }),
});

/** Vorlage prüfen – mit verständlicher Meldung, welches Feld nicht passt. */
const TEMPLATE_LABELS = {
  name: 'Name der Vorlage',
  content: 'Nachricht',
  author: 'Autor',
  title: 'Titel',
  url: 'Titel-Link',
  description: 'Beschreibung',
  color: 'Farbe',
  thumbnailUrl: 'Kleines Bild (Link)',
  image: 'Großes Bild (Link)',
  footer: 'Fußzeile',
  fields: 'Felder',
  buttons: 'Buttons',
  label: 'Beschriftung',
};
function parseTemplate(req, res) {
  const r = templateSchema.safeParse(req.body ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const path = issue.path.filter((p) => p !== 'data' && p !== 'embed');
  const [first, index, sub] = path;
  let where = TEMPLATE_LABELS[first] || first;
  if (first === 'buttons' && typeof index === 'number') where = `Button ${index + 1}${sub ? ` → ${sub === 'url' ? 'Link' : 'Beschriftung'}` : ''}`;
  if (first === 'fields' && typeof index === 'number') where = `Feld ${index + 1}${sub ? ` → ${sub === 'name' ? 'Name' : 'Wert'}` : ''}`;
  const custom = /[äöüÄÖÜß]|https|#RRGGBB/.test(issue.message);
  const why = custom ? issue.message : issue.code === 'too_big' ? 'zu lang' : issue.code === 'too_small' ? 'zu kurz' : 'ungültig';
  res.status(400).json({ error: `${where || 'Vorlage'}: ${why}` });
  return null;
}

function checkTemplate(d, res) {
  if (!msgs.build(d.data, null)) {
    res.status(400).json({ error: 'Die Nachricht ist leer – bitte Text oder Embed (z. B. Titel oder Beschreibung) ausfüllen.' });
    return false;
  }
  if (msgs.embedLength(d.data) > 6000) {
    res.status(400).json({ error: 'Das Embed ist zu lang (Discord erlaubt insgesamt 6000 Zeichen).' });
    return false;
  }
  if (d.data.buttons.some((b) => (b.label && !b.url) || (!b.label && b.url))) {
    res.status(400).json({ error: 'Jeder Button braucht eine Beschriftung und einen https-Link.' });
    return false;
  }
  return true;
}

function loadTemplate(req, res) {
  const tid = idParam(req, 'tid');
  const t = tid && msgs.getTemplate(tid);
  if (!t) res.status(404).json({ error: 'Vorlage nicht gefunden.' });
  return t;
}
const messagesOverview = () => ({ templates: msgs.listTemplates(), placeholders: msgs.PLACEHOLDERS, limits: { templates: msgs.MAX_TEMPLATES, jobs: msgs.MAX_JOBS, minInterval: msgs.MIN_INTERVAL }, status: bot.status() });

router.get('/messages', (req, res) => res.json(messagesOverview()));

router.post(
  '/messages',
  wrap(async (req, res) => {
    const d = parseTemplate(req, res);
    if (!d || !checkTemplate(d, res)) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM bot_messages').get().n >= msgs.MAX_TEMPLATES) return res.status(400).json({ error: `Höchstens ${msgs.MAX_TEMPLATES} Vorlagen.` });
    const info = db.prepare('INSERT INTO bot_messages (name, data, updated_by_name) VALUES (?, ?, ?)').run(d.name, JSON.stringify(d.data), req.user.display_name);
    logActivity(req.user, 'Discord-Bot: Nachrichten-Vorlage angelegt', 'settings', null, d.name);
    res.status(201).json({ template: msgs.templateRow(msgs.getTemplate(Number(info.lastInsertRowid))), ...messagesOverview() });
  })
);

router.put(
  '/messages/:tid',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    if (!t) return;
    const d = parseTemplate(req, res);
    if (!d || !checkTemplate(d, res)) return;
    db.prepare("UPDATE bot_messages SET name = ?, data = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?").run(d.name, JSON.stringify(d.data), req.user.display_name, t.id);
    logActivity(req.user, 'Discord-Bot: Nachrichten-Vorlage geändert', 'settings', null, d.name);
    res.json({ template: msgs.templateRow(msgs.getTemplate(t.id)), ...messagesOverview() });
  })
);

router.delete('/messages/:tid', (req, res) => {
  const t = loadTemplate(req, res);
  if (!t) return;
  db.prepare('DELETE FROM bot_messages WHERE id = ?').run(t.id); // Automatiken und Liste der Gesendeten gehen mit
  logActivity(req.user, 'Discord-Bot: Nachrichten-Vorlage gelöscht', 'settings', null, t.name);
  bot.refresh();
  res.json(messagesOverview());
});

/** Von Hand in einen Kanal senden. */
router.post(
  '/messages/:tid/send',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    if (!t) return;
    const d = parseBody(z.object({ channelId: id }), req, res);
    if (!d) return;
    try {
      await msgs.sendTemplate(t, d.channelId, req.user.display_name);
    } catch (err) {
      return res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
    }
    logActivity(req.user, 'Discord-Bot: Nachricht gesendet', 'settings', null, t.name);
    res.json({ template: msgs.templateRow(msgs.getTemplate(t.id)), ...messagesOverview() });
  })
);

/** Per Direktnachricht an alle Mitglieder einer Rolle: Vorschau der Empfänger (wer hat schon ein Website-Konto?). */
router.get(
  '/messages/:tid/dm',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    if (!t) return;
    const roleId = String(req.query.roleId || '');
    if (!ID.test(roleId)) return res.status(400).json({ error: 'Bitte eine Rolle wählen.' });
    try {
      res.json(await dm.preview(roleId));
    } catch (err) {
      res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
    }
  })
);

/** Versand starten – läuft im Hintergrund (langsam, abbrechbar); Fortschritt über /dm-runs. */
router.post(
  '/messages/:tid/dm',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    if (!t) return;
    const d = parseBody(
      z.object({
        roleId: id,
        withLogin: z.boolean(),
        // Ausgewählte Empfänger, je optional mit geprüftem Namen für ein neues Website-Konto
        recipients: z
          .array(z.object({ id, name: z.string().trim().max(80).optional() }))
          .max(dm.MAX_RECIPIENTS)
          .optional(),
      }),
      req,
      res
    );
    if (!d) return;
    if ((d.recipients || []).some((r) => r.name !== undefined && r.name.length < 2)) {
      return res.status(400).json({ error: 'Bitte für jedes neue Website-Konto einen Namen mit mindestens 2 Zeichen angeben.' });
    }
    try {
      const run = await dm.start(t, d.roleId, d.withLogin, req.user, d.recipients || null);
      logActivity(req.user, 'Discord-Bot: Direktnachrichten an Rolle gestartet', 'settings', null, `${t.name} → @${run.roleName} (${run.total} Mitglieder${d.withLogin ? ', mit Website-Zugang' : ''})`);
      res.status(201).json({ run, runs: dm.runs(t.id) });
    } catch (err) {
      res.status([400, 409].includes(err.status) ? err.status : 502).json({ error: err.message });
    }
  })
);

router.get('/dm-runs', (req, res) => res.json({ runs: dm.runs(Number(req.query.templateId) || null) }));

router.post('/dm-runs/:rid/cancel', (req, res) => {
  const rid = idParam(req, 'rid');
  const run = rid && db.prepare('SELECT template_id FROM bot_dm_runs WHERE id = ?').get(rid);
  if (!run) return res.status(404).json({ error: 'Versand nicht gefunden.' });
  const cancelled = dm.cancel(rid);
  if (cancelled) logActivity(req.user, 'Discord-Bot: Direktnachrichten abgebrochen', 'settings', rid);
  res.json({ cancelled, runs: dm.runs(run.template_id) });
});

/** Gesendete Nachricht auf den aktuellen Stand der Vorlage bringen bzw. in Discord löschen. */
function loadSent(req, res, t) {
  const sid = idParam(req, 'sid');
  const s = sid && db.prepare('SELECT * FROM bot_message_sent WHERE id = ? AND template_id = ?').get(sid, t.id);
  if (!s) res.status(404).json({ error: 'Gesendete Nachricht nicht gefunden.' });
  return s;
}
router.post(
  '/messages/:tid/sent/:sid/update',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    const s = t && loadSent(req, res, t);
    if (!s) return;
    try {
      await msgs.updateSent(t, s);
    } catch (err) {
      return res.status(err.status === 404 ? 404 : err.status === 400 ? 400 : 502).json({ error: err.message, ...messagesOverview() });
    }
    res.json({ template: msgs.templateRow(msgs.getTemplate(t.id)), ...messagesOverview() });
  })
);
router.delete(
  '/messages/:tid/sent/:sid',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    const s = t && loadSent(req, res, t);
    if (!s) return;
    try {
      await msgs.deleteSent(s);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    res.json({ template: msgs.templateRow(msgs.getTemplate(t.id)), ...messagesOverview() });
  })
);

/** Automatik anlegen: Zeitplan (alle N Minuten ab Start) oder „alle N Nachrichten“ im Kanal. */
router.post(
  '/messages/:tid/jobs',
  wrap(async (req, res) => {
    const t = loadTemplate(req, res);
    if (!t) return;
    const d = parseBody(
      z.object({
        kind: z.enum(['zeitplan', 'nachrichten']),
        channelId: id,
        intervalMinutes: z.number().int().min(msgs.MIN_INTERVAL).max(msgs.MAX_INTERVAL).optional(),
        startAt: z.string().optional(),
        everyMessages: z.number().int().min(1).max(1000).optional(),
        replacePrevious: z.boolean(),
      }),
      req,
      res
    );
    if (!d) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM bot_message_jobs WHERE template_id = ?').get(t.id).n >= msgs.MAX_JOBS) {
      return res.status(400).json({ error: `Höchstens ${msgs.MAX_JOBS} Automatiken je Vorlage.` });
    }
    let next = null;
    if (d.kind === 'zeitplan') {
      if (!d.intervalMinutes) return res.status(400).json({ error: `Bitte einen Abstand von mindestens ${msgs.MIN_INTERVAL} Minuten angeben.` });
      const start = d.startAt ? Date.parse(d.startAt) : NaN;
      if (!Number.isFinite(start)) return res.status(400).json({ error: 'Bitte Datum und Uhrzeit für den ersten Versand angeben.' });
      // Startzeit in der Vergangenheit → nächster passender Termin in der Zukunft
      const step = d.intervalMinutes * 60e3;
      next = start > Date.now() ? start : start + Math.ceil((Date.now() - start + 1) / step) * step;
    } else if (!d.everyMessages) {
      return res.status(400).json({ error: 'Bitte angeben, nach wie vielen Nachrichten erneut gepostet wird.' });
    }
    db.prepare(
      `INSERT INTO bot_message_jobs (template_id, kind, channel_id, interval_minutes, next_run_at, every_messages, replace_previous, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      t.id,
      d.kind,
      d.channelId,
      d.kind === 'zeitplan' ? d.intervalMinutes : null,
      next ? new Date(next).toISOString() : null,
      d.kind === 'nachrichten' ? d.everyMessages : null,
      d.replacePrevious ? 1 : 0,
      req.user.display_name
    );
    logActivity(req.user, 'Discord-Bot: Automatik angelegt', 'settings', null, `${t.name}: ${d.kind === 'zeitplan' ? `alle ${d.intervalMinutes} Min.` : `alle ${d.everyMessages} Nachrichten`}`);
    bot.refresh(); // ggf. Gateway mit Intent GUILD_MESSAGES neu anmelden
    res.status(201).json({ template: msgs.templateRow(msgs.getTemplate(t.id)), ...messagesOverview() });
  })
);

function loadJob(req, res) {
  const jid = idParam(req, 'jid');
  const j = jid && db.prepare('SELECT * FROM bot_message_jobs WHERE id = ?').get(jid);
  if (!j) res.status(404).json({ error: 'Automatik nicht gefunden.' });
  return j;
}
router.patch(
  '/messages/jobs/:jid',
  wrap(async (req, res) => {
    const j = loadJob(req, res);
    if (!j) return;
    const d = parseBody(z.object({ enabled: z.boolean() }), req, res);
    if (!d) return;
    db.prepare('UPDATE bot_message_jobs SET enabled = ?, counter = 0 WHERE id = ?').run(d.enabled ? 1 : 0, j.id);
    bot.refresh();
    res.json({ template: msgs.templateRow(msgs.getTemplate(j.template_id)), ...messagesOverview() });
  })
);
router.delete('/messages/jobs/:jid', (req, res) => {
  const j = loadJob(req, res);
  if (!j) return;
  db.prepare('DELETE FROM bot_message_jobs WHERE id = ?').run(j.id);
  bot.refresh();
  res.json({ template: msgs.templateRow(msgs.getTemplate(j.template_id)), ...messagesOverview() });
});

module.exports = { router };
