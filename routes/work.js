'use strict';
/*
 * Aktenbearbeitung: Wer bearbeitet welche Akten, wie lange? Nur für das Board of Partners
 * (Founding Partner, Equity Partner, Partner). Die Daten entstehen automatisch in case_work
 * (siehe syncCaseWork in models.js) – bei Zuweisung, Abgabe, Mitarbeit und Schließen einer Akte.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { isBoard } = require('../helpers');

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
});

const ms = (v) => {
  if (!v) return Date.now();
  const t = Date.parse(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : Date.now();
};

const WORK_SELECT = `
  SELECT w.*, c.case_number, c.title, c.status, c.created_at AS case_created_at, c.closed_at, u.display_name, u.rank, u.active
  FROM case_work w JOIN cases c ON c.id = w.case_id JOIN users u ON u.id = w.user_id`;

function workRow(w, now) {
  const start = ms(w.started_at);
  const end = w.ended_at ? ms(w.ended_at) : now;
  return {
    id: w.id,
    caseId: w.case_id,
    caseNumber: w.case_number,
    caseTitle: w.title,
    caseStatus: w.status,
    userId: w.user_id,
    name: w.display_name,
    role: w.role,
    startedAt: w.started_at,
    endedAt: w.ended_at,
    endReason: w.end_reason,
    estimated: !!w.estimated,
    running: !w.ended_at,
    durationMs: Math.max(0, end - start),
  };
}

/**
 * ?days=30|90|365|0 (0 = alles): Zeitraum für abgeschlossene Bearbeitungen und geschlossene Akten.
 * Laufende Bearbeitungen werden immer gezeigt.
 */
router.get('/', (req, res) => {
  const now = Date.now();
  const days = [0, 7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  const since = days ? now - days * 864e5 : 0;
  const rows = db
    .prepare(`${WORK_SELECT} ORDER BY w.started_at DESC`)
    .all()
    .map((w) => workRow(w, now))
    .filter((w) => w.running || ms(w.endedAt) >= since);

  const staff = db.prepare("SELECT id, display_name, rank, active FROM users WHERE role IN ('anwalt','admin') ORDER BY display_name").all();
  const members = staff
    .map((u) => {
      const mine = rows.filter((w) => w.userId === u.id);
      const running = mine.filter((w) => w.running);
      const finished = mine.filter((w) => !w.running);
      const finishedMs = finished.reduce((s, w) => s + w.durationMs, 0);
      // Je Akte zusammengefasst (mehrere Zeiträume derselben Akte werden addiert)
      const perCase = new Map();
      for (const w of mine) {
        const e = perCase.get(w.caseId) || { caseId: w.caseId, caseNumber: w.caseNumber, caseTitle: w.caseTitle, caseStatus: w.caseStatus, durationMs: 0, running: false, role: w.role, estimated: false, since: w.startedAt, endedAt: w.endedAt, endReason: w.endReason };
        e.durationMs += w.durationMs;
        e.running = e.running || w.running;
        e.estimated = e.estimated || w.estimated;
        if (ms(w.startedAt) < ms(e.since)) e.since = w.startedAt;
        if (w.running) {
          e.role = w.role;
          e.endedAt = null;
          e.endReason = '';
        }
        perCase.set(w.caseId, e);
      }
      return {
        userId: u.id,
        name: u.display_name,
        rank: u.rank || null,
        active: !!u.active,
        runningCount: running.length,
        runningMs: running.reduce((s, w) => s + w.durationMs, 0),
        finishedCount: new Set(finished.map((w) => w.caseId)).size,
        finishedMs,
        avgFinishedMs: finished.length ? Math.round(finishedMs / new Set(finished.map((w) => w.caseId)).size) : null,
        cases: [...perCase.values()].sort((a, b) => (b.running - a.running) || b.durationMs - a.durationMs),
      };
    })
    .filter((m) => m.active || m.cases.length);

  // Akten: laufende (seit Eröffnung) und im Zeitraum geschlossene (Eröffnung → Abschluss)
  const cases = db
    .prepare('SELECT id, case_number, title, status, created_at, closed_at FROM cases WHERE status != ? OR closed_at IS NOT NULL')
    .all('geschlossen')
    .filter((c) => c.status !== 'geschlossen' || ms(c.closed_at) >= since)
    .map((c) => ({
      id: c.id,
      caseNumber: c.case_number,
      title: c.title,
      status: c.status,
      closed: c.status === 'geschlossen',
      openedAt: c.created_at,
      closedAt: c.closed_at,
      durationMs: Math.max(0, (c.status === 'geschlossen' ? ms(c.closed_at) : now) - ms(c.created_at)),
      team: rows.filter((w) => w.caseId === c.id && w.running).map((w) => ({ id: w.userId, name: w.name, role: w.role })),
    }));
  const closed = cases.filter((c) => c.closed);
  res.json({
    days,
    since: since ? new Date(since).toISOString() : null,
    summary: {
      runningCases: cases.filter((c) => !c.closed).length,
      unassigned: cases.filter((c) => !c.closed && !c.team.length).length,
      closedCases: closed.length,
      avgClosedMs: closed.length ? Math.round(closed.reduce((s, c) => s + c.durationMs, 0) / closed.length) : null,
      estimatedEntries: rows.some((w) => w.estimated),
    },
    members,
    cases: cases.sort((a, b) => a.closed - b.closed || b.durationMs - a.durationMs),
  });
});

/** Bearbeitungsverlauf einer Akte (für die Akte selbst). */
function workForCase(caseId) {
  const now = Date.now();
  return db.prepare(`${WORK_SELECT} WHERE w.case_id = ? ORDER BY w.started_at ASC, w.id ASC`).all(caseId).map((w) => workRow(w, now));
}

module.exports = { router, workForCase };
