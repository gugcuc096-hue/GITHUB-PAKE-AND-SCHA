'use strict';
/*
 * Board-Beschlüsse: Ein Mitglied des Board of Partners stellt einen Antrag zur Abstimmung, alle stimmen mit
 * Ja, Nein oder Enthaltung (änderbar, solange offen). Entschieden ist er, sobald alle abgestimmt haben, die Frist
 * abläuft oder die antragstellende Person die Abstimmung beendet: angenommen bei mehr Ja- als Nein-Stimmen.
 * Jeder Beschluss bekommt ein Aktenzeichen (B-2026-001) und bleibt im Beschlussprotokoll.
 *  GET  /api/resolutions               Liste (offene zuerst) + wer abstimmt
 *  POST /api/resolutions               Antrag stellen
 *  POST /api/resolutions/:id/vote      { vote: ja|nein|enthaltung, comment }
 *  POST /api/resolutions/:id/close     Abstimmung jetzt beenden (Antragsteller oder Admin)
 *  POST /api/resolutions/:id/withdraw  Antrag zurückziehen (Antragsteller oder Admin, nur offen)
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { wrap, parseBody, idParam, isBoard, BOARD_RANKS, truncate } = require('../helpers');
const { logActivity } = require('../models');
const discord = require('../discord');

const router = express.Router();
router.use(requireAuth, (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Nur für das Board of Partners.' })));

const STATUS = { offen: 'Offen', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' };
const VOTES = ['ja', 'nein', 'enthaltung'];

/** Wer abstimmt: alle aktiven Konten des Board of Partners. */
function boardMembers() {
  return db
    .prepare(`SELECT id, display_name FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'anwalt' AND rank IN (${BOARD_RANKS.map(() => '?').join(', ')}))) ORDER BY display_name COLLATE NOCASE`)
    .all(...BOARD_RANKS);
}

const load = (id) => db.prepare('SELECT * FROM resolutions WHERE id = ?').get(id) || null;
const votesOf = (id) =>
  db.prepare('SELECT v.*, u.display_name FROM resolution_votes v LEFT JOIN users u ON u.id = v.user_id WHERE v.resolution_id = ? ORDER BY v.voted_at').all(id);

function counts(votes) {
  const c = { ja: 0, nein: 0, enthaltung: 0 };
  for (const v of votes) c[v.vote]++;
  return c;
}

function row(r, user, members) {
  const votes = votesOf(r.id);
  const memberIds = new Set(members.map((m) => m.id));
  const mine = votes.find((v) => v.user_id === user.id);
  const open = r.status === 'offen';
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    body: r.body,
    status: r.status,
    statusLabel: STATUS[r.status] || r.status,
    deadline: r.deadline,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    counts: counts(votes),
    votes: votes.map((v) => ({ userId: v.user_id, name: v.display_name || 'Ehemaliges Mitglied', vote: v.vote, comment: v.comment, votedAt: v.voted_at })),
    // offen: wer noch fehlt (abgeschlossen zählt nur, wer abgestimmt hat)
    missing: open ? members.filter((m) => !votes.some((v) => v.user_id === m.id)).map((m) => m.display_name) : [],
    eligible: open ? members.length : votes.length,
    myVote: mine ? mine.vote : null,
    canVote: open && memberIds.has(user.id),
    canManage: open && (r.created_by === user.id || user.role === 'admin'),
  };
}

/** Entscheiden: mehr Ja als Nein = angenommen. */
function decide(r, by) {
  const votes = votesOf(r.id);
  const c = counts(votes);
  const status = c.ja > c.nein ? 'angenommen' : 'abgelehnt';
  db.prepare("UPDATE resolutions SET status = ?, decided_at = datetime('now'), tally = ? WHERE id = ? AND status = 'offen'").run(status, JSON.stringify(c), r.id);
  logActivity(by, `Beschluss ${STATUS[status].toLowerCase()}`, 'resolution', r.id, `${r.reference} ${r.title} (${c.ja} Ja, ${c.nein} Nein, ${c.enthaltung} Enthaltung)`);
  discord.notify('resolution.created', {
    title: `${status === 'angenommen' ? '✅' : '❌'} Beschluss ${r.reference} ${STATUS[status].toLowerCase()}`,
    description: truncate(r.title, 300),
    color: status === 'angenommen' ? 0x34d399 : 0xf87171,
    fields: [
      { name: 'Ja', value: String(c.ja) },
      { name: 'Nein', value: String(c.nein) },
      { name: 'Enthaltung', value: String(c.enthaltung) },
    ],
  });
  require('../live').areaChanged('resolutions');
  return status;
}

/** Alle haben abgestimmt → entscheiden. */
function settleIfComplete(r, by) {
  const members = boardMembers();
  const voted = new Set(votesOf(r.id).map((v) => v.user_id));
  if (members.length && members.every((m) => voted.has(m.id))) return decide(r, by);
  return null;
}

/** Hintergrund (alle 5 Minuten): abgelaufene Fristen entscheiden. */
function sweep() {
  const due = db.prepare("SELECT * FROM resolutions WHERE status = 'offen' AND deadline IS NOT NULL AND deadline <= datetime('now')").all();
  for (const r of due) decide(r, null);
  return due.length;
}

/** Offene Abstimmungen, bei denen die Person noch nicht abgestimmt hat (Badge im Menü). */
function pendingFor(user) {
  if (!isBoard(user)) return 0;
  return db
    .prepare("SELECT COUNT(*) AS n FROM resolutions r WHERE r.status = 'offen' AND NOT EXISTS (SELECT 1 FROM resolution_votes v WHERE v.resolution_id = r.id AND v.user_id = ?)")
    .get(user.id).n;
}

router.get('/pending', (req, res) => res.json({ pending: pendingFor(req.user) }));

router.get('/', (req, res) => {
  const members = boardMembers();
  const rows = db.prepare("SELECT * FROM resolutions ORDER BY status = 'offen' DESC, COALESCE(decided_at, created_at) DESC, id DESC").all();
  res.json({ resolutions: rows.map((r) => row(r, req.user, members)), members: members.map((m) => m.display_name), pending: pendingFor(req.user) });
});

const DEADLINES = { 24: 24, 48: 48, 72: 72, 168: 168 };
const createSchema = z.object({
  title: z.string().trim().min(4, 'Bitte den Antrag kurz benennen.').max(160),
  body: z.string().trim().max(4000).default(''),
  deadlineHours: z.number().int().nullable().default(72),
  vote: z.enum(VOTES).optional(), // eigene Stimme gleich mit abgeben
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(createSchema, req, res);
    if (!d) return;
    if (d.deadlineHours != null && !DEADLINES[d.deadlineHours]) return res.status(400).json({ error: 'Bitte eine der angebotenen Fristen wählen.' });
    const year = new Date().getFullYear();
    const n = db.prepare('SELECT COUNT(*) AS n FROM resolutions WHERE reference LIKE ?').get(`B-${year}-%`).n + 1;
    const reference = `B-${year}-${String(n).padStart(3, '0')}`;
    const id = Number(
      db
        .prepare(
          `INSERT INTO resolutions (reference, title, body, deadline, created_by, created_by_name)
           VALUES (?, ?, ?, ${d.deadlineHours ? `datetime('now', '+${d.deadlineHours} hours')` : 'NULL'}, ?, ?)`
        )
        .run(reference, d.title, d.body, req.user.id, req.user.display_name).lastInsertRowid
    );
    if (d.vote) db.prepare('INSERT INTO resolution_votes (resolution_id, user_id, vote) VALUES (?, ?, ?)').run(id, req.user.id, d.vote);
    logActivity(req.user, 'Beschluss beantragt', 'resolution', id, `${reference} ${d.title}`);
    discord.notify('resolution.created', {
      title: `🗳️ Neuer Antrag ${reference}`,
      description: `**${truncate(d.title, 200)}**${d.body ? `\n\n${truncate(d.body, 900)}` : ''}`,
      fields: [
        { name: 'Beantragt von', value: req.user.display_name },
        { name: 'Abstimmung', value: d.deadlineHours ? `bis ${d.deadlineHours >= 48 ? `${d.deadlineHours / 24} Tage` : '24 Stunden'}` : 'ohne Frist' },
        { name: 'Abstimmen', value: 'Dashboard → Beschlüsse' },
      ],
    });
    const r = load(id);
    settleIfComplete(r, req.user); // Board aus einer Person
    res.status(201).json({ resolution: row(load(id), req.user, boardMembers()) });
  })
);

function loadOpen(req, res) {
  const id = idParam(req);
  const r = id && load(id);
  if (!r) {
    res.status(404).json({ error: 'Beschluss nicht gefunden.' });
    return null;
  }
  if (r.status !== 'offen') {
    res.status(409).json({ error: 'Über diesen Antrag ist schon entschieden.' });
    return null;
  }
  return r;
}

router.post(
  '/:id/vote',
  wrap(async (req, res) => {
    const r = loadOpen(req, res);
    if (!r) return;
    const d = parseBody(z.object({ vote: z.enum(VOTES), comment: z.string().trim().max(300).default('') }), req, res);
    if (!d) return;
    db.prepare(
      `INSERT INTO resolution_votes (resolution_id, user_id, vote, comment) VALUES (?, ?, ?, ?)
       ON CONFLICT(resolution_id, user_id) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, voted_at = datetime('now')`
    ).run(r.id, req.user.id, d.vote, d.comment);
    const decided = settleIfComplete(r, req.user);
    res.json({ resolution: row(load(r.id), req.user, boardMembers()), decided });
  })
);

function manage(req, res) {
  const r = loadOpen(req, res);
  if (!r) return null;
  if (r.created_by !== req.user.id && req.user.role !== 'admin') {
    res.status(403).json({ error: 'Nur die antragstellende Person kann die Abstimmung beenden.' });
    return null;
  }
  return r;
}

router.post(
  '/:id/close',
  wrap(async (req, res) => {
    const r = manage(req, res);
    if (!r) return;
    const decided = decide(r, req.user);
    res.json({ resolution: row(load(r.id), req.user, boardMembers()), decided });
  })
);

router.post(
  '/:id/withdraw',
  wrap(async (req, res) => {
    const r = manage(req, res);
    if (!r) return;
    const c = counts(votesOf(r.id));
    db.prepare("UPDATE resolutions SET status = 'zurueckgezogen', decided_at = datetime('now'), tally = ? WHERE id = ?").run(JSON.stringify(c), r.id);
    logActivity(req.user, 'Beschluss zurückgezogen', 'resolution', r.id, `${r.reference} ${r.title}`);
    res.json({ resolution: row(load(r.id), req.user, boardMembers()) });
  })
);

module.exports = { router, sweep, pendingFor, boardMembers };
