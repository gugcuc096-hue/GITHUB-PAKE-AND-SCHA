'use strict';
/*
 * Abmeldungen: Ein Teammitglied meldet sich für einen Zeitraum ab (Urlaub, Krankheit, …).
 * Das Team sieht, wer gerade abwesend ist; Abmeldung, vorzeitige Rückmeldung und Zurückziehen
 * gehen auf Wunsch per Webhook in Discord (Ereignis „absence.changed“, Kanal/Rolle wie gewohnt einstellbar).
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff, userAvatarUrl } = require('../auth');
const { wrap, parseBody, idParam, dateOnly } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');

const router = express.Router();
router.use(requireAuth, requireStaff);

const REASONS = { urlaub: 'Urlaub', krank: 'Krankheit', privat: 'Privat', ooc: 'OOC / Real Life', sonstiges: 'Sonstiges' };
const MAX_DAYS = 90;

/** Heutiges Datum in Deutschland (YYYY-MM-DD). */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const days = (from, to) => Math.round((dayMs(to) - dayMs(from)) / 864e5) + 1;
const deDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const span = (a) => `${deDate(a.start_date)} – ${deDate(a.end_date)} (${days(a.start_date, a.end_date)} ${days(a.start_date, a.end_date) === 1 ? 'Tag' : 'Tage'})`;

const SELECT = `
  SELECT a.*, u.display_name, u.rank, u.avatar, u.discord_id, u.discord_avatar
  FROM absences a JOIN users u ON u.id = a.user_id`;

function row(a, viewer) {
  const t = today();
  const state = a.returned_at || a.end_date < t ? 'vorbei' : a.start_date > t ? 'geplant' : 'aktiv';
  return {
    id: a.id,
    userId: a.user_id,
    name: a.display_name,
    rank: a.rank || null,
    avatarUrl: userAvatarUrl(a),
    startDate: a.start_date,
    endDate: a.end_date,
    reason: a.reason,
    reasonLabel: REASONS[a.reason] || a.reason,
    note: a.note,
    returnedAt: a.returned_at || null,
    state,
    createdByName: a.created_by_name,
    createdAt: a.created_at,
    canManage: viewer.role === 'admin' || viewer.id === a.user_id,
  };
}

function notify(title, a, extra = [], color) {
  discord.notify('absence.changed', {
    title,
    description: a.note ? a.note : undefined,
    color,
    fields: [
      { name: 'Zeitraum', value: span(a) },
      { name: 'Grund', value: REASONS[a.reason] || a.reason },
      ...(a.rank ? [{ name: 'Rang', value: a.rank }] : []),
      ...extra,
    ],
  });
}

/** Aktuelle und geplante Abmeldungen; mit ?alle=1 auch die der letzten 30 Tage. */
router.get('/', (req, res) => {
  const t = today();
  const since = req.query.alle === '1' ? new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }) : t;
  const rows = db
    .prepare(`${SELECT} WHERE a.end_date >= ? ORDER BY a.start_date ASC, a.id ASC`)
    .all(since)
    .map((a) => row(a, req.user));
  res.json({ absences: rows, reasons: REASONS, today: t });
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        startDate: dateOnly,
        endDate: dateOnly,
        reason: z.enum(Object.keys(REASONS)),
        note: z.string().trim().max(300).optional(),
        userId: z.number().int().positive().optional(),
      }),
      req,
      res
    );
    if (!d) return;
    const u = req.user;
    // Das Board of Partners kann auch jemand anderen abmelden (z. B. auf Zuruf im Spiel).
    let userId = u.id;
    if (d.userId && d.userId !== u.id) {
      if (u.role !== 'admin') return res.status(403).json({ error: 'Nur das Board of Partners kann andere Teammitglieder abmelden.' });
      const other = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(d.userId);
      if (!other) return res.status(400).json({ error: 'Dieses Teammitglied gibt es nicht.' });
      userId = other.id;
    }
    if (d.endDate < d.startDate) return res.status(400).json({ error: 'Das Ende liegt vor dem Beginn.' });
    if (days(d.startDate, d.endDate) > MAX_DAYS) return res.status(400).json({ error: `Eine Abmeldung kann höchstens ${MAX_DAYS} Tage umfassen.` });
    if (d.endDate < today()) return res.status(400).json({ error: 'Der Zeitraum liegt komplett in der Vergangenheit.' });
    const overlap = db
      .prepare('SELECT id FROM absences WHERE user_id = ? AND returned_at IS NULL AND start_date <= ? AND end_date >= ?')
      .get(userId, d.endDate, d.startDate);
    if (overlap) return res.status(409).json({ error: 'Für diesen Zeitraum gibt es bereits eine Abmeldung.' });
    const info = db
      .prepare('INSERT INTO absences (user_id, start_date, end_date, reason, note, created_by_name) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, d.startDate, d.endDate, d.reason, d.note || '', u.display_name);
    const a = db.prepare(`${SELECT} WHERE a.id = ?`).get(Number(info.lastInsertRowid));
    notify(`📋 Abmeldung: ${a.display_name}`, a, userId !== u.id ? [{ name: 'Eingetragen von', value: u.display_name }] : [], 0x94a3b8);
    logActivity(u, 'Abmeldung eingetragen', 'user', userId, `${a.display_name}: ${span(a)}, ${REASONS[a.reason]}`);
    res.status(201).json({ absence: row(a, u) });
  })
);

function loadOwn(req, res) {
  const id = idParam(req);
  const a = id && db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
  if (!a) {
    res.status(404).json({ error: 'Abmeldung nicht gefunden.' });
    return null;
  }
  if (req.user.role !== 'admin' && a.user_id !== req.user.id) {
    res.status(403).json({ error: 'Nur die eigene Abmeldung (oder als Board of Partners) lässt sich ändern.' });
    return null;
  }
  return a;
}

/** Vorzeitig zurückmelden: Abmeldung endet heute. */
router.post(
  '/:id/return',
  wrap(async (req, res) => {
    const a = loadOwn(req, res);
    if (!a) return;
    const t = today();
    if (a.returned_at || a.end_date < t) return res.status(400).json({ error: 'Diese Abmeldung ist bereits beendet.' });
    if (a.start_date > t) return res.status(400).json({ error: 'Die Abmeldung hat noch nicht begonnen – zum Aufheben bitte „Zurückziehen“.' });
    db.prepare('UPDATE absences SET returned_at = ?, end_date = ? WHERE id = ?').run(new Date().toISOString(), t, a.id);
    const updated = db.prepare(`${SELECT} WHERE a.id = ?`).get(a.id);
    notify(`✅ Zurückgemeldet: ${a.display_name}`, updated, [{ name: 'Ursprünglich bis', value: deDate(a.end_date) }], 0x10b981);
    res.json({ absence: row(updated, req.user) });
  })
);

/** Zurückziehen (z. B. falsch eingetragen oder doch verfügbar). */
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const a = loadOwn(req, res);
    if (!a) return;
    db.prepare('DELETE FROM absences WHERE id = ?').run(a.id);
    if (!a.returned_at && a.end_date >= today()) notify(`↩️ Abmeldung zurückgezogen: ${a.display_name}`, a, [], 0x64748b);
    res.json({ success: true });
  })
);

module.exports = { router, REASONS };
