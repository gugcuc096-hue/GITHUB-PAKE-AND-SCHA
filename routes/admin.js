'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx, getSetting, setSetting } = require('../db');
const { requireAuth, requireAdmin, requireStaff, hashPassword, generateTempPassword, destroyAllSessions, userAvatarUrl } = require('../auth');
const { wrap, parseBody, idParam, DUTY_STATUS } = require('../helpers');
const { logActivity } = require('../models');
const { removeFile } = require('../uploads');
const discord = require('../discord');

const ROLE_LABEL = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Kanzleileitung' };

/* Verzeichnis der Anwälte (für Zuweisungen) -- für das ganze Team */
const directoryRouter = express.Router();
directoryRouter.get('/', requireAuth, requireStaff, (req, res) => {
  const lawyers = db
    .prepare(
      `SELECT * FROM users
       WHERE role IN ('anwalt','admin') AND active = 1
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, display_name`
    )
    .all()
    .map((u) => ({ id: u.id, displayName: u.display_name, role: u.role, rank: u.rank, avatarUrl: userAvatarUrl(u) }));
  res.json({ lawyers });
});

/* Kanzleileitung */
const router = express.Router();
router.use(requireAuth, requireAdmin);

function userRow(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    rank: u.rank,
    phone: u.phone,
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    discordUsername: u.discord_username || null,
    avatarUrl: userAvatarUrl(u),
    duty: u.duty_status && u.duty_status !== 'off' ? u.duty_status : null,
    dutyLabel: u.duty_status && u.duty_status !== 'off' ? DUTY_STATUS[u.duty_status] : null,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}

function activeAdminCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
}

router.get('/users', (req, res) => {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'anwalt' THEN 1 ELSE 2 END, display_name")
    .all();
  res.json({ users: rows.map(userRow) });
});

router.post(
  '/users',
  wrap(async (req, res) => {
    const schema = z.object({
      displayName: z.string().trim().min(2).max(80),
      email: z.string().trim().email().max(120),
      role: z.enum(['mandant', 'anwalt', 'admin']),
      rank: z.string().trim().max(60).optional(),
      phone: z.string().trim().max(40).optional(),
    });
    const d = parseBody(schema, req, res);
    if (!d) return;
    const email = d.email.toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });
    }
    const password = generateTempPassword();
    const info = db
      .prepare('INSERT INTO users (email, password_hash, display_name, role, rank, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(email, hashPassword(password), d.displayName, d.role, d.rank || null, d.phone || null);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    logActivity(req.user, 'Konto angelegt', 'user', user.id, `${user.display_name} (${ROLE_LABEL[user.role]})`);
    res.status(201).json({ user: userRow(user), credentials: { email, password } });
  })
);

router.patch(
  '/users/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const target = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
    const schema = z.object({
      role: z.enum(['mandant', 'anwalt', 'admin']).optional(),
      rank: z.string().trim().max(60).nullable().optional(),
      active: z.boolean().optional(),
      displayName: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().email().max(120).optional(),
    });
    const d = parseBody(schema, req, res);
    if (!d) return;

    const self = id === req.user.id;
    if (self && d.active === false) return res.status(400).json({ error: 'Sie können sich nicht selbst sperren.' });
    if (self && d.role && d.role !== 'admin') return res.status(400).json({ error: 'Sie können sich nicht selbst die Admin-Rechte entziehen.' });
    const losesAdmin = target.role === 'admin' && target.active && ((d.role && d.role !== 'admin') || d.active === false);
    if (losesAdmin && activeAdminCount() <= 1) {
      return res.status(400).json({ error: 'Es muss mindestens ein aktiver Admin bestehen bleiben.' });
    }
    if (d.email && d.email.toLowerCase() !== target.email) {
      if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(d.email.toLowerCase(), id)) {
        return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });
      }
    }

    const sets = [];
    const values = [];
    const set = (col, val) => {
      sets.push(`${col} = ?`);
      values.push(val);
    };
    if (d.role !== undefined) set('role', d.role);
    if (d.rank !== undefined) set('rank', d.rank || null);
    if (d.active !== undefined) set('active', d.active ? 1 : 0);
    if (d.displayName !== undefined) set('display_name', d.displayName);
    if (d.email !== undefined) set('email', d.email.toLowerCase());
    if (!sets.length) return res.json({ user: userRow(target) });

    tx(() => {
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      if (d.active === false || (d.role && d.role !== target.role)) destroyAllSessions(id);
      // Gesperrte oder zu Mandanten herabgestufte Konten werden ausgestempelt.
      if (d.active === false || d.role === 'mandant') {
        db.prepare('UPDATE duty_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(new Date().toISOString(), id);
        db.prepare("UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ?").run(id);
      }
      // Name/Rang im verknüpften Team-Profil mitziehen.
      if (d.displayName !== undefined) db.prepare('UPDATE team_members SET name = ? WHERE user_id = ?').run(d.displayName, id);
      if (d.rank) db.prepare('UPDATE team_members SET role_title = ? WHERE user_id = ?').run(d.rank, id);
    });
    const changes = [];
    if (d.role !== undefined && d.role !== target.role) changes.push(`Rolle: ${ROLE_LABEL[target.role]} → ${ROLE_LABEL[d.role]}`);
    if (d.active !== undefined && !!d.active !== !!target.active) changes.push(d.active ? 'entsperrt' : 'gesperrt');
    if (d.rank !== undefined && (d.rank || null) !== target.rank) changes.push(`Rang: ${d.rank || '—'}`);
    if (d.displayName !== undefined && d.displayName !== target.display_name) changes.push(`Name: ${d.displayName}`);
    if (changes.length) logActivity(req.user, 'Konto geändert', 'user', id, `${target.display_name}: ${changes.join(', ')}`);
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

// Passwort vergessen: Die Kanzleileitung erzeugt ein Einmal-Passwort (keine Shell nötig).
router.post(
  '/users/:id/reset-password',
  wrap(async (req, res) => {
    const id = idParam(req);
    const target = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
    if (id === req.user.id) return res.status(400).json({ error: 'Ihr eigenes Passwort ändern Sie unter "Profil".' });
    const password = generateTempPassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), id);
    destroyAllSessions(id);
    logActivity(req.user, 'Passwort zurückgesetzt', 'user', id, target.display_name);
    res.json({ credentials: { email: target.email, password } });
  })
);

router.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    if (id === req.user.id) return res.status(400).json({ error: 'Sie können sich nicht selbst löschen.' });
    const target = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
    if (target.role === 'admin' && target.active && activeAdminCount() <= 1) {
      return res.status(400).json({ error: 'Der letzte aktive Admin kann nicht gelöscht werden.' });
    }
    try {
      tx(() => {
        // Name bleibt in den Akten erhalten, auch wenn das Konto verschwindet.
        db.prepare("UPDATE cases SET client_name = ? WHERE client_id = ? AND client_name = ''").run(target.display_name, id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      });
    } catch (err) {
      if (String(err?.message || '').toUpperCase().includes('FOREIGN KEY')) {
        return res.status(409).json({ error: 'Das Konto ist noch mit Daten verknüpft. Sperren Sie es stattdessen über "Sperren".' });
      }
      throw err;
    }
    removeFile('avatars', target.avatar);
    logActivity(req.user, 'Konto gelöscht', 'user', id, `${target.display_name} (${target.email})`);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Aktivitätsprotokoll */
router.get('/audit', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const before = Number(req.query.before) || null;
  const params = [];
  let where = '1 = 1';
  if (before) {
    where += ' AND id < ?';
    params.push(before);
  }
  if (q) {
    where += ' AND (user_name LIKE ? OR action LIKE ? OR details LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      userName: r.user_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: r.details,
      createdAt: r.created_at,
    })),
    hasMore: rows.length === 100,
  });
});

/* ---------------------------------------------------------------- Einstellungen */
function settingsPayload() {
  const dbUrl = getSetting('discord_webhook_url', '');
  return {
    discordWebhookUrl: dbUrl,
    discordWebhookFromEnv: !dbUrl && discord.isValidWebhookUrl(process.env.DISCORD_WEBHOOK_URL),
    discordWebhookActive: !!discord.webhookUrl(),
    discordEvents: discord.enabledEvents(),
    availableEvents: discord.EVENTS,
    discordOAuthConfigured: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    firmAddress: getSetting('firm_address', 'Pake & Scha Legal Consulting\nWürfelpark\nLos Santos, San Andreas'),
    firmPaymentInfo: getSetting('firm_payment_info', 'Zahlbar per Überweisung an Pake & Scha Legal Consulting (Maze Bank).'),
    firmContact: getSetting('firm_contact', 'kontakt@pake-scha.ls'),
    showDutyPublic: getSetting('show_duty_public', '1') === '1',
  };
}

router.get('/settings', (req, res) => res.json({ settings: settingsPayload() }));

router.patch(
  '/settings',
  wrap(async (req, res) => {
    const schema = z.object({
      discordWebhookUrl: z.string().trim().max(300).optional(),
      discordEvents: z.array(z.string()).max(20).optional(),
      firmAddress: z.string().trim().max(300).optional(),
      firmPaymentInfo: z.string().trim().max(300).optional(),
      firmContact: z.string().trim().max(120).optional(),
      showDutyPublic: z.boolean().optional(),
    });
    const d = parseBody(schema, req, res);
    if (!d) return;
    if (d.discordWebhookUrl && !discord.isValidWebhookUrl(d.discordWebhookUrl)) {
      return res.status(400).json({ error: 'Das ist keine gültige Discord-Webhook-URL (https://discord.com/api/webhooks/…).' });
    }
    logActivity(req.user, 'Einstellungen geändert', 'settings', null, Object.keys(d).join(', '));
    tx(() => {
      if (d.showDutyPublic !== undefined) setSetting('show_duty_public', d.showDutyPublic ? '1' : '0');
      if (d.discordWebhookUrl !== undefined) setSetting('discord_webhook_url', d.discordWebhookUrl);
      if (d.discordEvents !== undefined) setSetting('discord_events', JSON.stringify(d.discordEvents.filter((e) => discord.EVENTS[e])));
      if (d.firmAddress !== undefined) setSetting('firm_address', d.firmAddress);
      if (d.firmPaymentInfo !== undefined) setSetting('firm_payment_info', d.firmPaymentInfo);
      if (d.firmContact !== undefined) setSetting('firm_contact', d.firmContact);
    });
    res.json({ settings: settingsPayload() });
  })
);

router.post(
  '/discord/test',
  wrap(async (req, res) => {
    const url = discord.webhookUrl();
    if (!url) return res.status(400).json({ error: 'Es ist noch kein Discord-Webhook hinterlegt.' });
    try {
      await discord.sendTest(url, req.user.display_name);
    } catch (err) {
      return res.status(502).json({ error: `Discord hat die Nachricht abgelehnt: ${err.message}` });
    }
    res.json({ success: true });
  })
);

module.exports = { router, directoryRouter };
