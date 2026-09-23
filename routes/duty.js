'use strict';
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff, requireAdmin, userAvatarUrl } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime, DUTY_STATUS } = require('../helpers');
const { DUTY_SELECT, dutySessionRow, onDutyMembers, logActivity } = require('../models');
const discord = require('../discord');

const router = express.Router();
router.use(requireAuth, requireStaff);

// Wer vergisst auszustempeln, wird nach dieser Zeit automatisch ausgestempelt.
const AUTO_CLOSE_HOURS = 12;
const HOUR = 3600 * 1000;

function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} Std ${min % 60} Min` : `${min} Min`;
}

/** Schließt vergessene Schichten automatisch nach AUTO_CLOSE_HOURS. */
function closeStaleSessions() {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_HOURS * HOUR).toISOString();
  const stale = db.prepare('SELECT * FROM duty_sessions WHERE ended_at IS NULL AND started_at < ?').all(cutoff);
  for (const s of stale) {
    const end = new Date(Date.parse(s.started_at) + AUTO_CLOSE_HOURS * HOUR).toISOString();
    tx(() => {
      db.prepare('UPDATE duty_sessions SET ended_at = ?, auto_closed = 1 WHERE id = ?').run(end, s.id);
      db.prepare("UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ? AND duty_since = ?").run(s.user_id, s.started_at);
    });
  }
}

/**
 * Setzt den Dienststatus. Beim Wechsel von "Außer Dienst" auf einen anderen
 * Status beginnt eine Schicht, zurück auf "Außer Dienst" endet sie.
 */
function setDuty(userId, status, note) {
  const now = new Date().toISOString();
  const open = db.prepare('SELECT * FROM duty_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY id DESC').get(userId);
  return tx(() => {
    if (status === 'off') {
      db.prepare('UPDATE duty_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now, userId);
      db.prepare("UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ?").run(userId);
      return { started: false, ended: !!open, duration: open ? Date.parse(now) - Date.parse(open.started_at) : 0 };
    }
    let since = now;
    if (open) {
      since = open.started_at;
      if (note !== undefined) db.prepare('UPDATE duty_sessions SET note = ? WHERE id = ?').run(note, open.id);
    } else {
      db.prepare('INSERT INTO duty_sessions (user_id, started_at, note) VALUES (?, ?, ?)').run(userId, now, note || '');
    }
    const current = db.prepare('SELECT duty_note FROM users WHERE id = ?').get(userId);
    db.prepare('UPDATE users SET duty_status = ?, duty_note = ?, duty_since = ? WHERE id = ?').run(status, note ?? current.duty_note ?? '', since, userId);
    return { started: !open, ended: false, duration: 0 };
  });
}

function statePayload(userId) {
  const me = db.prepare('SELECT duty_status, duty_note, duty_since FROM users WHERE id = ?').get(userId);
  return {
    me: { status: me.duty_status || 'off', note: me.duty_note || '', since: me.duty_since || null },
    onDuty: onDutyMembers(),
  };
}

router.get('/', (req, res) => {
  closeStaleSessions();
  res.json(statePayload(req.user.id));
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ status: z.enum(Object.keys(DUTY_STATUS)), note: z.string().trim().max(120).optional() }), req, res);
    if (!d) return;
    closeStaleSessions();
    const result = setDuty(req.user.id, d.status, d.note);
    const u = req.user;
    if (result.started) {
      discord.notify('duty.changed', {
        title: `🟢 ${u.display_name} ist jetzt im Dienst`,
        description: d.note || undefined,
        fields: [{ name: 'Status', value: DUTY_STATUS[d.status] }],
      });
    } else if (result.ended) {
      discord.notify('duty.changed', {
        title: `⚪ ${u.display_name} hat den Dienst beendet`,
        fields: [{ name: 'Dauer', value: fmtDuration(result.duration) }],
        color: 0x64748b,
      });
    }
    res.json(statePayload(u.id));
  })
);

/* ---------------------------------------------------------------- Dienstzeiten */
router.get(
  '/sessions',
  wrap(async (req, res) => {
    closeStaleSessions();
    const now = Date.now();
    let fromMs = Date.parse(req.query.from);
    let toMs = Date.parse(req.query.to);
    if (!Number.isFinite(toMs)) toMs = now;
    if (!Number.isFinite(fromMs)) fromMs = toMs - 7 * 24 * HOUR;
    if (toMs <= fromMs || toMs - fromMs > 62 * 24 * HOUR) return res.status(400).json({ error: 'Ungültiger Zeitraum.' });

    const admin = req.user.role === 'admin';
    const onlyUser = admin ? (req.query.userId ? Number(req.query.userId) : null) : req.user.id;
    const params = [new Date(toMs).toISOString(), new Date(fromMs).toISOString()];
    let sql = `${DUTY_SELECT} WHERE d.started_at < ? AND (d.ended_at IS NULL OR d.ended_at > ?)`;
    if (onlyUser) {
      sql += ' AND d.user_id = ?';
      params.push(onlyUser);
    }
    const sessions = db.prepare(`${sql} ORDER BY d.started_at DESC`).all(...params);

    const members = admin
      ? db.prepare("SELECT * FROM users WHERE role IN ('anwalt','admin') AND active = 1 ORDER BY display_name").all()
      : [req.user];
    const totals = new Map(members.map((m) => [m.id, { userId: m.id, name: m.display_name, rank: m.rank || null, avatarUrl: userAvatarUrl(m), status: m.duty_status || 'off', minutes: 0, sessions: 0 }]));
    for (const s of sessions) {
      const start = Math.max(Date.parse(s.started_at), fromMs);
      const end = Math.min(s.ended_at ? Date.parse(s.ended_at) : now, toMs);
      if (!totals.has(s.user_id)) totals.set(s.user_id, { userId: s.user_id, name: s.user_name, rank: s.user_rank, avatarUrl: null, status: 'off', minutes: 0, sessions: 0 });
      const t = totals.get(s.user_id);
      t.minutes += Math.max(0, end - start) / 60000;
      t.sessions += 1;
    }
    res.json({
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      totals: [...totals.values()].map((t) => ({ ...t, minutes: Math.round(t.minutes) })).sort((a, b) => b.minutes - a.minutes),
      sessions: sessions.map(dutySessionRow),
    });
  })
);

/* ---------------------------------------------------------------- Korrekturen (Kanzleileitung) */
const sessionSchema = z.object({
  userId: z.number().int().positive(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  note: z.string().trim().max(120).optional(),
});

router.post(
  '/sessions',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parseBody(sessionSchema, req, res);
    if (!d) return;
    const start = new Date(d.startedAt).toISOString();
    const end = new Date(d.endedAt).toISOString();
    if (end <= start) return res.status(400).json({ error: 'Das Dienstende muss nach dem Beginn liegen.' });
    if (Date.parse(end) - Date.parse(start) > 24 * HOUR) return res.status(400).json({ error: 'Eine Schicht darf höchstens 24 Stunden dauern.' });
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('anwalt','admin')").get(d.userId);
    if (!user) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    const info = db.prepare('INSERT INTO duty_sessions (user_id, started_at, ended_at, note) VALUES (?, ?, ?, ?)').run(user.id, start, end, d.note || 'Nachgetragen');
    logActivity(req.user, 'Dienstzeit nachgetragen', 'duty', Number(info.lastInsertRowid), `${user.display_name}: ${fmtDuration(Date.parse(end) - Date.parse(start))}`);
    res.status(201).json({ session: dutySessionRow(db.prepare(`${DUTY_SELECT} WHERE d.id = ?`).get(Number(info.lastInsertRowid))) });
  })
);

router.patch(
  '/sessions/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const s = id && db.prepare('SELECT * FROM duty_sessions WHERE id = ?').get(id);
    if (!s) return res.status(404).json({ error: 'Schicht nicht gefunden.' });
    const d = parseBody(z.object({ startedAt: isoDateTime.optional(), endedAt: isoDateTime.optional(), note: z.string().trim().max(120).optional() }), req, res);
    if (!d) return;
    const start = d.startedAt ? new Date(d.startedAt).toISOString() : s.started_at;
    const end = d.endedAt ? new Date(d.endedAt).toISOString() : s.ended_at;
    if (end && end <= start) return res.status(400).json({ error: 'Das Dienstende muss nach dem Beginn liegen.' });
    tx(() => {
      db.prepare('UPDATE duty_sessions SET started_at = ?, ended_at = ?, note = ?, auto_closed = 0 WHERE id = ?').run(start, end, d.note ?? s.note, s.id);
      // Offene Schicht wurde beendet -> Person ist außer Dienst; sonst Beginn nachziehen.
      if (!s.ended_at && end) db.prepare("UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ?").run(s.user_id);
      else if (!s.ended_at) db.prepare('UPDATE users SET duty_since = ? WHERE id = ?').run(start, s.user_id);
    });
    logActivity(req.user, 'Dienstzeit korrigiert', 'duty', s.id);
    res.json({ session: dutySessionRow(db.prepare(`${DUTY_SELECT} WHERE d.id = ?`).get(s.id)) });
  })
);

router.delete(
  '/sessions/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const s = id && db.prepare('SELECT * FROM duty_sessions WHERE id = ?').get(id);
    if (!s) return res.status(404).json({ error: 'Schicht nicht gefunden.' });
    tx(() => {
      db.prepare('DELETE FROM duty_sessions WHERE id = ?').run(s.id);
      if (!s.ended_at) db.prepare("UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ?").run(s.user_id);
    });
    logActivity(req.user, 'Dienstzeit gelöscht', 'duty', s.id);
    res.json({ success: true });
  })
);

router.post(
  '/force-off/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const user = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Teammitglied nicht gefunden.' });
    setDuty(user.id, 'off');
    logActivity(req.user, 'Dienst beendet (durch Leitung)', 'duty', user.id, user.display_name);
    res.json(statePayload(req.user.id));
  })
);

module.exports = router;
module.exports.closeStaleSessions = closeStaleSessions;
