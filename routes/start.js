'use strict';
/*
 * Start des Dashboards in einem Abruf: eigenes Konto, alle Zähler der Navigation (Badges) und der Dienststatus.
 * Vorher waren das bis zu 13 einzelne Abrufe beim Laden und alle zwei Minuten erneut. Die Werte kommen weiterhin
 * aus denselben Schnittstellen (mit der Sitzung der Person, intern über den eigenen Server) – Rechte und Zählweise
 * bleiben also genau gleich; nur der Weg über das Netz entfällt.
 */
const express = require('express');
const { requireAuth } = require('../auth');
const { wrap, isBoard } = require('../helpers');
const { collect } = require('../collect');

const router = express.Router();

/*
 * Zwischenspeicher für die Zähler: Das regelmäßige Nachsehen (alle 30 s je offenem Tab, ?me=0) beantwortet der Server
 * je Person 15 Sekunden lang aus dem Speicher. Jede Änderung über die API (POST/PATCH/PUT/DELETE) leert ihn sofort
 * (live.js ruft invalidate()) – Zähler hinken also höchstens bei Änderungen nach, die nicht über die Website kommen
 * (Discord, Zeitpläne), und das nur für wenige Sekunden. Der erste Abruf beim Laden (mit Konto) kommt immer frisch.
 */
const TTL_MS = 15000;
const MAX_ENTRIES = 500;
const cache = new Map(); // "Nutzer-ID|today|Rolle|Rang" → { at, body }
const stats = { hits: 0, misses: 0 };
let invalidatedAt = 0;
function invalidate() {
  invalidatedAt = Date.now();
  cache.clear();
}

router.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const u = req.user;
    const staff = u.role === 'anwalt' || u.role === 'admin';
    const board = isBoard(u);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.today || '')) ? req.query.today : new Date().toISOString().slice(0, 10);
    const jobs = {
      me: '/api/auth/me',
      chatUnread: '/api/cases/chat-unread',
      unread: '/api/messages/unread-count',
      duty: staff ? '/api/duty' : '/api/public/on-duty',
      concerns: '/api/concerns/counts',
    };
    if (staff) Object.assign(jobs, { dueTasks: `/api/tasks/due-count?today=${today}`, payments: '/api/invoices/payment-reports', personnel: '/api/personnel/counts' });
    if (board) Object.assign(jobs, { applications: '/api/admin/applications', names: '/api/name-requests', resolutions: '/api/resolutions/pending', reviews: '/api/reviews?status=neu', vip: '/api/memberships/requests' });
    if (req.query.me === '0') delete jobs.me; // regelmäßiges Nachsehen: nur die Zähler

    // Nur das regelmäßige Nachsehen (ohne Konto) kommt aus dem Zwischenspeicher; Rolle/Rang stehen im Schlüssel
    const key = `${u.id}|${today}|${u.role}|${u.rank || ''}`;
    const hit = req.query.me === '0' ? cache.get(key) : null;
    if (hit && Date.now() - hit.at < TTL_MS) {
      stats.hits += 1;
      return res.json(hit.body);
    }
    stats.misses += 1;
    const startedAt = Date.now();
    const r = await collect(req, jobs);
    if (jobs.me && !r.me) return res.status(401).json({ error: 'Bitte melden Sie sich an.' });

    const counts = { chatUnread: r.chatUnread?.total, unread: r.unread?.unread, concernUnseen: r.concerns?.unseen, concernOpen: r.concerns?.open };
    counts.duty = r.duty ? (staff ? r.duty : { me: null, onDuty: r.duty.members || [] }) : undefined;
    if (staff) Object.assign(counts, { dueTasks: r.dueTasks?.due, paymentReports: r.payments?.count, personnelNew: r.personnel?.unseen });
    if (board) {
      const apps = r.applications?.applications;
      Object.assign(counts, {
        newApplications: apps ? apps.filter((a) => a.status === 'eingegangen').length + apps.reduce((n, a) => n + (a.unreadMessages || 0), 0) : undefined,
        nameOpen: r.names?.open,
        resolutionOpen: r.resolutions?.pending,
        reviewOpen: r.reviews?.open,
        vipReqOpen: r.vip?.open,
      });
    }
    for (const k of Object.keys(counts)) if (counts[k] === undefined || counts[k] === null) delete counts[k];
    const body = { ...(r.me ? { me: r.me } : {}), counts };
    // Nur speichern, wenn zwischendurch nichts geändert wurde (invalidate() setzt die Marke)
    if (req.query.me === '0' && invalidatedAt < startedAt) {
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(key, { at: Date.now(), body });
    }
    res.json(body);
  })
);

module.exports = { router, invalidate, stats };
