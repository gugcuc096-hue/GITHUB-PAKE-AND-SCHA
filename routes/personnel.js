'use strict';
/*
 * Personalprotokoll: Beförderungen und Einstellungen – für alle Mitarbeiter sichtbar.
 *
 * Einträge entstehen automatisch:
 *  - Einstellung: Bewerber eingestellt, Mitarbeiterkonto angelegt, Mandantenkonto zum Mitarbeiter gemacht
 *  - Beförderung / Rückstufung / Rangänderung: „Befördern“ hier (nur Board of Partners) sowie
 *    Rangänderungen unter Benutzer bzw. Team (beides ebenfalls nur Board of Partners)
 *
 * Befördern darf nur das Board of Partners. Niemand ändert seinen eigenen Rang; Partner ohne
 * Board-Rolle (admin) befördern höchstens bis zum eigenen Rang und nur Kollegen unterhalb ihres Rangs.
 *
 * Discord: „personnel.changed“ – z. B. in einen eigenen Kanal „#beförderungen“.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff, userAvatarUrl } = require('../auth');
const { wrap, parseBody, idParam, isBoard, RANKS, BOARD_RANKS, RANK_ORDER_SQL, truncate } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');

const TYPES = { einstellung: 'Einstellung', befoerderung: 'Beförderung', rueckstufung: 'Rückstufung', rangaenderung: 'Rangänderung' };
const SLATE = 0x64748b;
const rankIndex = (r) => RANKS.indexOf(r || '');

/** Beförderung (höherer Rang), Rückstufung (niedrigerer) oder Rangänderung (kein/alter Rang beteiligt). */
function changeType(oldRank, newRank) {
  const a = rankIndex(oldRank);
  const b = rankIndex(newRank);
  if (a >= 0 && b >= 0) return b < a ? 'befoerderung' : 'rueckstufung';
  if (a < 0 && b >= 0) return 'befoerderung';
  return 'rangaenderung';
}

function announce(e) {
  const person = e.userId ? db.prepare('SELECT discord_id FROM users WHERE id = ?').get(e.userId) : null;
  const fields = [];
  let title;
  let description;
  let color = discord.GOLD;
  if (e.type === 'einstellung') {
    title = `👋 Neu im Team: ${e.name}`;
    description = `${e.name} verstärkt ab sofort Pake & Scha Legal Consulting${e.newRank ? ` als **${e.newRank}**` : ''}. Herzlich willkommen!`;
    fields.push({ name: 'Rang', value: e.newRank || '—' }, { name: 'Eingestellt von', value: e.byName || 'System' });
  } else {
    if (e.type === 'befoerderung') {
      title = `🎉 Beförderung: ${e.name}`;
      description = `${e.name} ist ab sofort **${e.newRank}**. Herzlichen Glückwunsch!`;
    } else {
      title = `Rangänderung: ${e.name}`;
      description = `${e.name} ist ab sofort ${e.newRank ? `**${e.newRank}**` : 'ohne Rang'}.`;
      color = SLATE;
    }
    fields.push(
      { name: 'Bisher', value: e.oldRank || '—' },
      { name: 'Neu', value: e.newRank || '—' },
      { name: e.type === 'befoerderung' ? 'Befördert von' : 'Geändert von', value: e.byName || 'System' }
    );
  }
  if (e.note) fields.push({ name: e.type === 'einstellung' ? 'Notiz' : 'Begründung', value: truncate(e.note, 500), inline: false });
  discord.notify('personnel.changed', {
    title,
    description,
    color,
    fields,
    // Die betroffene Person wird erwähnt, wenn ihr Konto mit Discord verknüpft ist.
    mentionIds: e.type !== 'rueckstufung' && person?.discord_id ? [person.discord_id] : [],
  });
}

/**
 * Trägt ein Ereignis ins Personalprotokoll ein und meldet es in Discord.
 * by: handelnde Person (req.user) oder null (System).
 */
function record({ type, userId = null, name, oldRank = null, newRank = null, note = '', by = null }) {
  const e = { type, userId, name, oldRank: oldRank || null, newRank: newRank || null, note: String(note || '').trim(), byName: by ? by.display_name : '' };
  const info = db
    .prepare('INSERT INTO personnel_events (user_id, person_name, type, old_rank, new_rank, note, by_id, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.userId, e.name, e.type, e.oldRank, e.newRank, e.note, by ? by.id : null, e.byName);
  try {
    announce(e);
  } catch (err) {
    console.warn('Personalprotokoll: Discord-Meldung fehlgeschlagen:', err.message);
  }
  return Number(info.lastInsertRowid);
}

/** Rangänderung eintragen (nichts, wenn sich der Rang nicht ändert). */
function recordRankChange({ userId = null, name, oldRank, newRank, note = '', by = null }) {
  if ((oldRank || null) === (newRank || null)) return null;
  return record({ type: changeType(oldRank, newRank), userId, name, oldRank, newRank, note, by });
}

/** Einstellung eines neuen Mitarbeiters eintragen. */
function recordHire({ userId, name, rank, note = '', by = null }) {
  return record({ type: 'einstellung', userId, name, newRank: rank || null, note, by });
}

/** Wer darf den Rang dieser Person auf diesen Rang setzen? Liefert eine Fehlermeldung oder null. */
function promotionError(actor, target, newRank) {
  if (!isBoard(actor)) return 'Beförderungen kann nur das Board of Partners vornehmen.';
  if (target.id === actor.id) return 'Den eigenen Rang kann man nicht selbst ändern.';
  if (actor.role === 'admin') return null;
  const own = rankIndex(actor.rank);
  if (target.role === 'admin') return 'Den Rang von Konten mit der Rolle „Board of Partners“ kann nur ein Admin ändern.';
  if (rankIndex(newRank) < own) return `Sie können höchstens bis zu Ihrem eigenen Rang (${actor.rank}) befördern.`;
  const current = rankIndex(target.rank);
  if (current >= 0 && current <= own) return 'Den Rang von Kollegen auf gleicher oder höherer Stufe können Sie nicht ändern.';
  return null;
}

function eventRow(e) {
  return {
    id: e.id,
    type: e.type,
    typeLabel: TYPES[e.type] || e.type,
    userId: e.user_id,
    name: e.person_name,
    currentRank: e.current_rank || null,
    avatarUrl: e.user_id ? userAvatarUrl({ avatar: e.avatar, discord_id: e.discord_id, discord_avatar: e.discord_avatar }) : null,
    oldRank: e.old_rank,
    newRank: e.new_rank,
    note: e.note,
    byName: e.by_name || 'System',
    createdAt: e.created_at,
  };
}

const router = express.Router();
router.use(requireAuth, requireStaff);

/** Protokoll (alle Mitarbeiter). Das Board erhält zusätzlich die Liste für „Befördern“. */
router.get('/', (req, res) => {
  const u = req.user;
  const rows = db
    .prepare(
      `SELECT p.*, x.rank AS current_rank, x.avatar, x.discord_id, x.discord_avatar
       FROM personnel_events p LEFT JOIN users x ON x.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC LIMIT 300`
    )
    .all();
  const maxId = rows.reduce((m, r) => Math.max(m, r.id), 0);
  if (maxId && (u.personnel_seen_id || 0) < maxId) db.prepare('UPDATE users SET personnel_seen_id = ? WHERE id = ?').run(maxId, u.id);
  const board = isBoard(u);
  const staff = board
    ? db
        .prepare(`SELECT id, display_name, role, rank FROM users WHERE active = 1 AND role IN ('anwalt', 'admin') ORDER BY ${RANK_ORDER_SQL()}, display_name`)
        .all()
        .map((s) => ({ id: s.id, name: s.display_name, role: s.role, rank: s.rank || null, editable: !promotionError(u, s, u.role === 'admin' ? RANKS[0] : u.rank) }))
    : undefined;
  res.json({
    events: rows.map(eventRow),
    types: TYPES,
    board,
    canDelete: u.role === 'admin',
    staff,
    // Partner ohne Admin-Rolle: höchster Rang, den sie vergeben dürfen
    maxRank: board && u.role !== 'admin' ? u.rank : null,
  });
});

/** Neue Einträge seit dem letzten Öffnen (für die Navigation). Neue Konten sehen nur die letzten 14 Tage. */
router.get('/counts', (req, res) => {
  // Eigene Aktionen (z. B. selbst befördert) zählen nicht als neu.
  const u = req.user;
  const n = u.personnel_seen_id
    ? db.prepare('SELECT COUNT(*) AS n FROM personnel_events WHERE id > ? AND by_id IS NOT ?').get(u.personnel_seen_id, u.id).n
    : db.prepare("SELECT COUNT(*) AS n FROM personnel_events WHERE created_at > datetime('now', '-14 days') AND by_id IS NOT ?").get(u.id).n;
  res.json({ unseen: n });
});

/** Befördern / Rang ändern – nur Board of Partners. */
router.post(
  '/promote',
  wrap(async (req, res) => {
    const u = req.user;
    if (!isBoard(u)) return res.status(403).json({ error: 'Beförderungen kann nur das Board of Partners vornehmen.' });
    const d = parseBody(
      z.object({ userId: z.number().int().positive(), rank: z.enum(RANKS), note: z.string().trim().max(500).optional() }),
      req,
      res
    );
    if (!d) return;
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1 AND role IN ('anwalt', 'admin')").get(d.userId);
    if (!target) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    if ((target.rank || '') === d.rank) return res.status(400).json({ error: `${target.display_name} hat bereits den Rang ${d.rank}.` });
    const err = promotionError(u, target, d.rank);
    if (err) return res.status(403).json({ error: err });

    let id;
    tx(() => {
      db.prepare('UPDATE users SET rank = ? WHERE id = ?').run(d.rank, target.id);
      // Team-Profil (öffentliche Website) mitziehen: Rang und Gruppe (Board of Partners / Associates)
      db.prepare(
        `UPDATE team_members SET role_title = ?, tier = CASE WHEN ? THEN 'leitung' WHEN tier = 'leitung' THEN 'anwalt' ELSE tier END WHERE user_id = ?`
      ).run(d.rank, BOARD_RANKS.includes(d.rank) ? 1 : 0, target.id);
      id = recordRankChange({ userId: target.id, name: target.display_name, oldRank: target.rank, newRank: d.rank, note: d.note, by: u });
    });
    const type = changeType(target.rank, d.rank);
    logActivity(u, TYPES[type], 'user', target.id, `${target.display_name}: ${target.rank || '—'} → ${d.rank}${d.note ? ` (${truncate(d.note, 120)})` : ''}`);
    tickets.syncBoardAll(); // wer ins Board kommt (oder es verlässt), sieht die Board-Tickets (nicht mehr)
    res.status(201).json({ success: true, id, type, typeLabel: TYPES[type] });
  })
);

/** Eintrag entfernen (z. B. versehentlich erfasst) – ändert keinen Rang. Nur Admins. */
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Einträge kann nur ein Admin entfernen.' });
  const id = idParam(req);
  const e = id && db.prepare('SELECT * FROM personnel_events WHERE id = ?').get(id);
  if (!e) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  db.prepare('DELETE FROM personnel_events WHERE id = ?').run(id);
  logActivity(req.user, 'Personalprotokoll: Eintrag entfernt', 'personnel', id, `${TYPES[e.type] || e.type}: ${e.person_name}`);
  res.json({ success: true });
});

module.exports = { router, record, recordHire, recordRankChange, changeType, TYPES };
