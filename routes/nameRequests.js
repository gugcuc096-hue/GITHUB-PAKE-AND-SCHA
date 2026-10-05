'use strict';
/*
 * Namensänderung: Jeder Benutzer beantragt im Profil einen neuen Namen, das Board of Partners genehmigt oder
 * lehnt ab. Genehmigt → neuer Name im Konto (und im Team-Profil der Website, falls verknüpft). Niemand entscheidet
 * über seinen eigenen Antrag. Benachrichtigung per Discord-Direktnachricht (falls verknüpft) und Webhook.
 * Ohne Antrag: Das Board ändert den eigenen Namen und Namen von Mandanten (z. B. Groß-/Kleinschreibung) direkt –
 * die Änderung steht trotzdem in der Historie, im Protokoll und wird gemeldet. Mitarbeiter-Namen nur per Antrag.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const { wrap, parseBody, idParam, isBoard } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');

const router = express.Router();
router.use(requireAuth);

const ROLE_LABEL = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Board of Partners' };
const STATUS_LABEL = { offen: 'Offen', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' };

function row(r) {
  return {
    id: r.id,
    userId: r.user_id,
    oldName: r.old_name,
    newName: r.new_name,
    reason: r.reason,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status] || r.status,
    decidedBy: r.decided_by_name || null,
    decidedById: r.decided_by || null,
    decisionNote: r.decision_note || '',
    direct: !!r.direct, // ohne Antrag direkt durch das Board geändert
    createdAt: r.created_at,
    decidedAt: r.decided_at || null,
    // nur in der Board-Liste
    currentName: r.current_name,
    email: r.email,
    role: r.role ? ROLE_LABEL[r.role] || r.role : undefined,
    rank: r.rank || null,
  };
}

/** Direktnachricht an die antragstellende Person (falls Bot + verknüpftes Discord). */
async function dmUser(userId, embed) {
  const u = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId);
  if (!u || !tickets.isId(u.discord_id) || !tickets.hasToken()) return;
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: u.discord_id });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, { embeds: [tickets.embed(embed)] });
  } catch {
    /* DMs gesperrt o. ä. – der Status steht auch im Profil */
  }
}

/* ---------------------------------------------------------------- Eigene Anträge */
router.get('/mine', (req, res) => {
  const rows = db.prepare('SELECT * FROM name_requests WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(req.user.id);
  res.json({ requests: rows.map(row) });
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ newName: z.string().trim().min(2).max(80), reason: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    const u = req.user;
    const newName = d.newName.replace(/\s+/g, ' ');
    if (newName === u.display_name) return res.status(400).json({ error: 'Das ist bereits Ihr aktueller Name.' });
    if (db.prepare("SELECT id FROM name_requests WHERE user_id = ? AND status = 'offen'").get(u.id)) {
      return res.status(409).json({ error: 'Sie haben bereits einen offenen Antrag. Warten Sie die Entscheidung ab oder ziehen Sie ihn zurück.' });
    }
    const info = db.prepare('INSERT INTO name_requests (user_id, old_name, new_name, reason) VALUES (?, ?, ?, ?)').run(u.id, u.display_name, newName, d.reason || '');
    logActivity(u, 'Namensänderung beantragt', 'user', u.id, `${u.display_name} → ${newName}`);
    discord.notify('name.requested', {
      title: '✏️ Namensänderung beantragt',
      description: d.reason || undefined,
      fields: [
        { name: 'Bisher', value: u.display_name },
        { name: 'Neu', value: newName },
        { name: 'Konto', value: `${ROLE_LABEL[u.role] || u.role}${u.rank ? ` · ${u.rank}` : ''}` },
      ],
      link: discord.publicUrl('/dashboard.html#name-requests'),
    });
    res.status(201).json({ request: row(db.prepare('SELECT * FROM name_requests WHERE id = ?').get(Number(info.lastInsertRowid))) });
  })
);

router.delete('/:id', (req, res) => {
  const r = db.prepare("SELECT * FROM name_requests WHERE id = ? AND user_id = ? AND status = 'offen'").get(idParam(req), req.user.id);
  if (!r) return res.status(404).json({ error: 'Kein offener Antrag gefunden.' });
  db.prepare("UPDATE name_requests SET status = 'zurueckgezogen', decided_at = datetime('now') WHERE id = ?").run(r.id);
  res.json({ success: true });
});

/* ---------------------------------------------------------------- Board of Partners */
router.get('/', (req, res) => {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  const all = req.query.status === 'alle';
  const rows = db
    .prepare(
      `SELECT r.*, u.display_name AS current_name, u.email, u.role, u.rank
       FROM name_requests r JOIN users u ON u.id = r.user_id
       ${all ? "WHERE r.status != 'zurueckgezogen'" : "WHERE r.status = 'offen'"}
       ORDER BY r.status = 'offen' DESC, r.id DESC LIMIT 200`
    )
    .all();
  res.json({ requests: rows.map(row), open: db.prepare("SELECT COUNT(*) AS n FROM name_requests WHERE status = 'offen'").get().n, me: req.user.id });
});

router.post(
  '/:id/decide',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
    const r = db.prepare('SELECT * FROM name_requests WHERE id = ?').get(idParam(req));
    if (!r) return res.status(404).json({ error: 'Antrag nicht gefunden.' });
    if (r.status !== 'offen') return res.status(400).json({ error: 'Über diesen Antrag wurde bereits entschieden.' });
    if (r.user_id === req.user.id) return res.status(403).json({ error: 'Über den eigenen Antrag entscheidet ein anderes Mitglied des Board of Partners.' });
    const d = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    if (!d.approve && !d.note) return res.status(400).json({ error: 'Bitte bei einer Ablehnung kurz den Grund angeben.' });
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id);
    tx(() => {
      db.prepare("UPDATE name_requests SET status = ?, decided_by = ?, decided_by_name = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(
        d.approve ? 'genehmigt' : 'abgelehnt',
        req.user.id,
        req.user.display_name,
        d.note || '',
        r.id
      );
      if (d.approve) {
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(r.new_name, r.user_id);
        // Team-Profil der Website zieht mit
        db.prepare('UPDATE team_members SET name = ? WHERE user_id = ?').run(r.new_name, r.user_id);
      }
    });
    logActivity(req.user, d.approve ? 'Namensänderung genehmigt' : 'Namensänderung abgelehnt', 'user', r.user_id, `${r.old_name} → ${r.new_name}${d.note ? ` (${d.note})` : ''}`);
    discord.notify('name.requested', {
      title: d.approve ? '✅ Namensänderung genehmigt' : '❌ Namensänderung abgelehnt',
      fields: [
        { name: 'Bisher', value: r.old_name },
        { name: 'Neu', value: r.new_name },
        { name: 'Entschieden von', value: req.user.display_name },
        ...(d.note ? [{ name: 'Hinweis', value: d.note }] : []),
      ],
      color: d.approve ? 0x10b981 : discord.RED,
    });
    dmUser(r.user_id, {
      title: d.approve ? '✅ Namensänderung genehmigt' : '❌ Namensänderung abgelehnt',
      description: d.approve
        ? `Ihr Name im Portal von Pake & Scha lautet jetzt **${r.new_name}** (vorher ${r.old_name}).`
        : `Ihr Antrag auf den Namen **${r.new_name}** wurde abgelehnt.${d.note ? `\n\n**Grund:** ${d.note}` : ''}`,
      color: d.approve ? tickets.COLORS.green : tickets.COLORS.red,
    });
    res.json({ request: row({ ...db.prepare('SELECT * FROM name_requests WHERE id = ?').get(r.id), current_name: d.approve ? r.new_name : target.display_name }) });
  })
);

/* ---------------------------------------------------------------- Direkt ändern (Board of Partners) */
/** Mandanten-Konten für die direkte Korrektur suchen (Name oder E-Mail). */
router.get('/accounts', (req, res) => {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  const q = String(req.query.q || '').trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const rows = db
    .prepare(
      `SELECT id, display_name, email, created_at FROM users
       WHERE role = 'mandant' AND (? = '' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
       ORDER BY display_name COLLATE NOCASE LIMIT 20`
    )
    .all(q, like, like);
  res.json({ accounts: rows.map((u) => ({ id: u.id, name: u.display_name, email: u.email, createdAt: u.created_at })) });
});

router.post(
  '/direct',
  wrap(async (req, res) => {
    const me = req.user;
    if (!isBoard(me)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
    const d = parseBody(
      z.object({ userId: z.number().int().positive(), newName: z.string().trim().min(2).max(80), reason: z.string().trim().max(500).optional() }),
      req,
      res
    );
    if (!d) return;
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(d.userId);
    if (!target) return res.status(404).json({ error: 'Konto nicht gefunden.' });
    const self = target.id === me.id;
    if (!self && target.role !== 'mandant') {
      return res.status(403).json({ error: 'Namen von Mitarbeitern ändern sich nur per Antrag im Profil der Person.' });
    }
    const newName = d.newName.replace(/\s+/g, ' ');
    if (newName === target.display_name) return res.status(400).json({ error: 'Das ist bereits der aktuelle Name.' });
    const note = self ? 'Eigener Name – direkt geändert (Board of Partners)' : 'Direkt durch das Board of Partners geändert';
    tx(() => {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(newName, target.id);
      db.prepare('UPDATE team_members SET name = ? WHERE user_id = ?').run(newName, target.id); // Team-Profil zieht mit
      const open = db.prepare("SELECT * FROM name_requests WHERE user_id = ? AND status = 'offen'").get(target.id);
      if (open && open.new_name === newName) {
        // Genau der beantragte Name → Antrag gilt als genehmigt
        db.prepare("UPDATE name_requests SET status = 'genehmigt', decided_by = ?, decided_by_name = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(
          me.id,
          me.display_name,
          note,
          open.id
        );
      } else {
        if (open && self) db.prepare("UPDATE name_requests SET status = 'zurueckgezogen', decided_at = datetime('now') WHERE id = ?").run(open.id);
        // Eintrag für die Historie (Profil der Person, Liste „Namensänderungen → Alle“)
        db.prepare(
          `INSERT INTO name_requests (user_id, old_name, new_name, reason, status, decided_by, decided_by_name, decision_note, decided_at, direct)
           VALUES (?, ?, ?, ?, 'genehmigt', ?, ?, ?, datetime('now'), 1)`
        ).run(target.id, target.display_name, newName, d.reason || '', me.id, me.display_name, note);
      }
    });
    logActivity(me, self ? 'Eigenen Namen geändert' : 'Name geändert', 'user', target.id, `${target.display_name} → ${newName}${d.reason ? ` (${d.reason})` : ''}`);
    discord.notify('name.requested', {
      title: self ? '✏️ Name geändert (Board of Partners, eigener Name)' : '✏️ Name eines Mandanten korrigiert',
      fields: [
        { name: 'Bisher', value: target.display_name },
        { name: 'Neu', value: newName },
        { name: 'Geändert von', value: me.display_name },
        ...(d.reason ? [{ name: 'Grund', value: d.reason }] : []),
      ],
    });
    if (!self) {
      dmUser(target.id, {
        title: '✏️ Ihr Name wurde angepasst',
        description: `Das Board of Partners hat Ihren Namen im Portal von Pake & Scha auf **${newName}** geändert (vorher ${target.display_name}).${d.reason ? `\n\n**Grund:** ${d.reason}` : ''}`,
        color: tickets.COLORS.gold,
      });
    }
    res.json({ user: { id: target.id, displayName: newName } });
  })
);

module.exports = { router };
