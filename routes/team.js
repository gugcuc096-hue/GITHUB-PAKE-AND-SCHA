'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx, getSetting } = require('../db');
const { requirePerm } = require('../permissions');
const { requireAuth, hashPassword, generateTempPassword, destroyAllSessions } = require('../auth');
const { wrap, parseBody, idParam, deriveInitials, RANKS, rankEnum, firmEmail, EMAIL_HINT } = require('../helpers');
const { teamRow, TEAM_SELECT, logActivity } = require('../models');
const { imageBody, saveImage, removeFile } = require('../uploads');
const personnel = require('./personnel');
const tickets = require('../tickets');

const ORDER = 'ORDER BY t.sort_order ASC, t.id ASC';

/* Öffentlich: Team-Übersicht der Startseite (Änderungen sind sofort live) */
const publicRouter = express.Router();
publicRouter.get('/', (req, res) => {
  const showDuty = getSetting('show_duty_public', '1') === '1';
  const rows = db.prepare(`${TEAM_SELECT} WHERE t.visible = 1 ${ORDER}`).all();
  const slugs = require('../profiles').slugMap(); // Adresse der Profilseite /team/<slug>
  const lotm = require('../lawyerOfMonth').current(); // Anwalt des Monats: Abzeichen an der Karte
  res.json({
    team: rows.map((t) => {
      const row = teamRow(t);
      if (!showDuty) row.duty = null;
      row.slug = slugs.get(t.id);
      if (lotm && lotm.memberId === t.id) row.lawyerOfMonth = lotm.label;
      return row;
    }),
  });
});

/* Board of Partners: Team verwalten */
const adminRouter = express.Router();
adminRouter.use(requireAuth, requirePerm('site.edit'));

const accountSchema = z.object({
  email: z.string().trim().min(1).max(120), // Teil vor dem @ oder Adresse mit @pake-scha.ls
  role: z.enum(['anwalt', 'admin']),
});
// Liste aus einem Textfeld (Komma bzw. Zeilen) für die Profilseite: höchstens max Einträge mit je itemMax Zeichen
const textList = (sep, max, itemMax, what) =>
  z
    .string()
    .max(2000)
    .transform((s) => s.split(sep).map((x) => x.trim()).filter(Boolean))
    .refine((a) => a.length <= max, `Höchstens ${max} ${what}.`)
    .refine((a) => a.every((x) => x.length <= itemMax), `Je Eintrag höchstens ${itemMax} Zeichen.`);
const memberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  roleTitle: rankEnum(),
  tier: z.enum(['leitung', 'anwalt']).optional(),
  description: z.string().trim().max(400).optional(),
  focus: textList(/[,\n]/, 6, 40, 'Schwerpunkte').optional(),
  highlights: textList(/\n/, 6, 140, 'Erfolge').optional(),
  initials: z.string().trim().max(5).optional(),
  visible: z.boolean().optional(),
  userId: z.number().int().positive().nullable().optional(),
  createAccount: accountSchema.optional(),
});

function load(id) {
  return db.prepare(`${TEAM_SELECT} WHERE t.id = ?`).get(id) || null;
}

/** Legt ein Login-Konto für ein Teammitglied an und liefert das Einmal-Passwort zurück. */
function createAccount(account, name, rank) {
  const email = firmEmail(account.email);
  if (!email) {
    const err = new Error(EMAIL_HINT);
    err.status = 400;
    throw err;
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    const err = new Error('Diese E-Mail-Adresse ist bereits vergeben.');
    err.status = 409;
    throw err;
  }
  const password = generateTempPassword();
  const info = db
    .prepare('INSERT INTO users (email, password_hash, display_name, role, rank, must_change_password) VALUES (?, ?, ?, ?, ?, 1)')
    .run(email, hashPassword(password), name, account.role, rank.slice(0, 60));
  return { userId: Number(info.lastInsertRowid), email, password };
}

function checkLinkTarget(userId, memberId = null) {
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin')").get(userId);
  if (!user) return 'Das gewählte Konto existiert nicht oder ist kein Teamkonto.';
  const taken = db.prepare('SELECT id FROM team_members WHERE user_id = ? AND id IS NOT ?').get(userId, memberId);
  if (taken) return 'Dieses Konto ist bereits mit einem anderen Profil verknüpft.';
  return null;
}

adminRouter.get('/', (req, res) => {
  const rows = db.prepare(`${TEAM_SELECT} ${ORDER}`).all();
  const slugs = require('../profiles').slugMap();
  res.json({ team: rows.map((t) => ({ ...teamRow(t, true), slug: slugs.get(t.id) || null })) });
});

adminRouter.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(memberSchema, req, res);
    if (!d) return;
    if (d.createAccount && req.user.role !== 'admin') return res.status(403).json({ error: 'Konten legt nur das Board of Partners an (Menü „Benutzer“).' });
    if (d.userId) {
      const problem = checkLinkTarget(d.userId);
      if (problem) return res.status(400).json({ error: problem });
    }

    // Rang eines verknüpften Kontos vorher (für das Personalprotokoll)
    const linkedBefore = d.userId ? db.prepare('SELECT rank FROM users WHERE id = ?').get(d.userId) : null;
    let credentials = null;
    const id = tx(() => {
      let userId = d.userId || null;
      if (!userId && d.createAccount) {
        credentials = createAccount(d.createAccount, d.name, d.roleTitle);
        userId = credentials.userId;
      }
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM team_members').get().m;
      const info = db
        .prepare(
          `INSERT INTO team_members (name, role_title, description, initials, tier, sort_order, user_id, visible, focus, highlights)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(d.name, d.roleTitle, d.description || '', d.initials || deriveInitials(d.name), d.tier || 'anwalt', maxOrder + 1, userId, d.visible === false ? 0 : 1, (d.focus || []).join('\n'), (d.highlights || []).join('\n'));
      if (userId && d.userId) {
        db.prepare('UPDATE users SET display_name = ?, rank = ? WHERE id = ?').run(d.name, d.roleTitle.slice(0, 60), userId);
      }
      return Number(info.lastInsertRowid);
    });

    logActivity(req.user, 'Teammitglied hinzugefügt', 'team', id, `${d.name} (${d.roleTitle})${credentials ? ' inkl. Login-Konto' : ''}`);
    if (credentials) personnel.recordHire({ userId: credentials.userId, name: d.name, rank: d.roleTitle, by: req.user });
    else if (linkedBefore) personnel.recordRankChange({ userId: d.userId, name: d.name, oldRank: linkedBefore.rank, newRank: d.roleTitle, by: req.user });
    if (d.userId) require('../discordBot').syncUser(d.userId); // Rang am verknüpften Konto → Discord-Rolle
    res.status(201).json({
      member: teamRow(load(id), true),
      credentials: credentials ? { email: credentials.email, password: credentials.password } : null,
    });
  })
);

adminRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && load(id);
    if (!m) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    const d = parseBody(memberSchema.partial(), req, res);
    if (!d) return;
    if (d.createAccount && req.user.role !== 'admin') return res.status(403).json({ error: 'Konten legt nur das Board of Partners an (Menü „Benutzer“).' });
    if (d.userId) {
      const problem = checkLinkTarget(d.userId, m.id);
      if (problem) return res.status(400).json({ error: problem });
    }

    // Rang vorher: der des verknüpften Kontos, sonst der im Profil (für das Personalprotokoll)
    const linkId = d.userId === undefined ? m.user_id : d.userId;
    const rankBefore = linkId ? db.prepare('SELECT rank FROM users WHERE id = ?').get(linkId)?.rank ?? null : m.role_title;
    let credentials = null;
    tx(() => {
      const name = d.name ?? m.name;
      const roleTitle = d.roleTitle ?? m.role_title;
      let userId = d.userId === undefined ? m.user_id : d.userId;
      if (!userId && d.createAccount) {
        credentials = createAccount(d.createAccount, name, roleTitle);
        userId = credentials.userId;
      }
      // Initialen automatisch nachziehen, wenn der Name geändert und keine eigenen angegeben wurden.
      const initials = d.initials !== undefined ? d.initials || deriveInitials(name) : d.name !== undefined ? deriveInitials(name) : m.initials;
      db.prepare(
        'UPDATE team_members SET name = ?, role_title = ?, description = ?, initials = ?, tier = ?, visible = ?, user_id = ?, focus = ?, highlights = ? WHERE id = ?'
      ).run(
        name,
        roleTitle,
        d.description ?? m.description,
        initials,
        d.tier ?? m.tier,
        d.visible === undefined ? m.visible : d.visible ? 1 : 0,
        userId || null,
        d.focus ? d.focus.join('\n') : m.focus || '',
        d.highlights ? d.highlights.join('\n') : m.highlights || '',
        m.id
      );
      // Verknüpftes Login-Konto synchron halten (Name im Dashboard, Rang in Nachrichten/Rechnungen).
      if (userId) db.prepare('UPDATE users SET display_name = ?, rank = ? WHERE id = ?').run(name, roleTitle.slice(0, 60), userId);
    });

    logActivity(req.user, 'Teammitglied geändert', 'team', m.id, d.name && d.name !== m.name ? `${m.name} → ${d.name}` : m.name);
    if (linkId) require('../discordBot').syncUser(linkId); // Rang am verknüpften Konto → Discord-Rolle
    const newName = d.name ?? m.name;
    const newTitle = d.roleTitle ?? m.role_title;
    if (credentials) personnel.recordHire({ userId: credentials.userId, name: newName, rank: newTitle, by: req.user });
    else if (d.roleTitle !== undefined || d.userId !== undefined) {
      personnel.recordRankChange({ userId: linkId || null, name: newName, oldRank: rankBefore, newRank: newTitle, by: req.user });
      tickets.syncBoardAll();
    }
    res.json({
      member: teamRow(load(m.id), true),
      credentials: credentials ? { email: credentials.email, password: credentials.password } : null,
    });
  })
);

adminRouter.post(
  '/reorder',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }), req, res);
    if (!d) return;
    tx(() => {
      const update = db.prepare('UPDATE team_members SET sort_order = ? WHERE id = ?');
      d.ids.forEach((memberId, i) => update.run(i + 1, memberId));
    });
    res.json({ success: true });
  })
);

// Eigenes Foto für das Team-Profil (hat auf der Website Vorrang vor dem Profilbild des Kontos).
adminRouter.post(
  '/:id/photo',
  imageBody,
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && load(id);
    if (!m) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    const saved = saveImage(req, 'team');
    db.prepare('UPDATE team_members SET photo = ? WHERE id = ?').run(saved.file, m.id);
    removeFile('team', m.photo);
    if (lockAccount) require('../discordBot').syncUser(m.user_id); // gesperrt → Rang-Rollen entfernen
    logActivity(req.user, 'Team-Foto geändert', 'team', m.id, m.name);
    res.json({ member: teamRow(load(m.id), true) });
  })
);

adminRouter.delete(
  '/:id/photo',
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && load(id);
    if (!m) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    db.prepare('UPDATE team_members SET photo = NULL WHERE id = ?').run(m.id);
    removeFile('team', m.photo);
    res.json({ member: teamRow(load(m.id), true) });
  })
);

adminRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && load(id);
    if (!m) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    const lockAccount = req.query.lockAccount === '1' && m.user_id && m.user_id !== req.user.id;
    tx(() => {
      db.prepare('DELETE FROM team_members WHERE id = ?').run(m.id);
      if (lockAccount) {
        db.prepare("UPDATE users SET active = 0, duty_status = 'off', duty_since = NULL WHERE id = ?").run(m.user_id);
        db.prepare("UPDATE duty_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL").run(new Date().toISOString(), m.user_id);
        destroyAllSessions(m.user_id);
      }
    });
    removeFile('team', m.photo);
    logActivity(req.user, 'Teammitglied entfernt', 'team', m.id, `${m.name}${lockAccount ? ' (Konto gesperrt)' : ''}`);
    res.json({ success: true, accountLocked: !!lockAccount });
  })
);

module.exports = { publicRouter, adminRouter };
