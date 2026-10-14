'use strict';
/*
 * Kanzlei-Statistik für das Board of Partners: Umsatz je Monat (bezahlte Rechnungen nach Zahlungsdatum), offene
 * Forderungen, neue und abgeschlossene Akten je Monat, Erfolgsquote und Bearbeitungszeit – gesamt und je
 * federführendem Anwalt – sowie die Ergebnisse der abgeschlossenen Akten. Nur lesend, alles aus vorhandenen Daten.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { isBoard, OUTCOMES } = require('../helpers');

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
});

/** SQLite-Zeit („2026-10-13 20:00:00“, UTC) oder ISO → Millisekunden; null bei leer/ungültig. */
function ms(v) {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}
const DAY = 864e5;
const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
/** Monatsschlüssel in Berliner Zeit (Jahreswechsel und Monatsende wie im Spiel-Alltag). */
const monthKey = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);

router.get('/', (req, res) => {
  const now = Date.now();

  // Die letzten 12 Monate (ältester zuerst)
  const months = [];
  const d = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: `${MONTHS_DE[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`, revenue: 0, paid: 0, opened: 0, closed: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));

  // Rechnungen (Honorarvereinbarungen sind kein Umsatz)
  const invoices = db.prepare("SELECT total, status, due_date, created_at, paid_at FROM invoices WHERE kind = 'rechnung'").all();
  let revenue30 = 0;
  let revenuePrev30 = 0;
  let openSum = 0;
  let openCount = 0;
  let overdueSum = 0;
  let overdueCount = 0;
  for (const i of invoices) {
    if (i.status === 'bezahlt') {
      const t = ms(i.paid_at) ?? ms(i.created_at);
      if (t == null) continue;
      const m = byKey.get(monthKey(t));
      if (m) {
        m.revenue += i.total;
        m.paid += 1;
      }
      if (t > now - 30 * DAY) revenue30 += i.total;
      else if (t > now - 60 * DAY) revenuePrev30 += i.total;
    } else if (i.status === 'offen') {
      openSum += i.total;
      openCount += 1;
      const due = ms(i.due_date ? `${i.due_date}T23:59:59Z` : null);
      if (due != null && due < now) {
        overdueSum += i.total;
        overdueCount += 1;
      }
    }
  }

  // Akten
  const cases = db.prepare('SELECT id, status, outcome, lawyer_id, created_at, closed_at FROM cases').all();
  let closed30 = 0;
  let closedPrev30 = 0;
  let opened30 = 0;
  const durations = [];
  const outcomeCount = {};
  for (const c of cases) {
    const created = ms(c.created_at);
    const mo = created != null && byKey.get(monthKey(created));
    if (mo) mo.opened += 1;
    if (created != null && created > now - 30 * DAY) opened30 += 1;
    if (c.status !== 'geschlossen') continue;
    const closedAt = ms(c.closed_at);
    if (closedAt != null) {
      const mc = byKey.get(monthKey(closedAt));
      if (mc) mc.closed += 1;
      if (closedAt > now - 30 * DAY) closed30 += 1;
      else if (closedAt > now - 60 * DAY) closedPrev30 += 1;
      if (created != null) durations.push(Math.max(0, (closedAt - created) / DAY));
    }
    if (c.outcome && OUTCOMES[c.outcome]) outcomeCount[c.outcome] = (outcomeCount[c.outcome] || 0) + 1;
  }
  const rate = (list) => {
    const rated = list.filter((c) => c.outcome && OUTCOMES[c.outcome] && OUTCOMES[c.outcome].success !== null);
    const won = rated.filter((c) => OUTCOMES[c.outcome].success).length;
    return { rated: rated.length, won, pct: rated.length ? Math.round((won / rated.length) * 100) : null };
  };

  // Je federführendem Anwalt (aktive Kanzlei-Konten und alle, die Akten haben)
  const users = db.prepare("SELECT id, display_name, rank, role, active FROM users WHERE role IN ('anwalt', 'admin')").all();
  const lawyers = users
    .map((u) => {
      const own = cases.filter((c) => c.lawyer_id === u.id);
      const done = own.filter((c) => c.status === 'geschlossen');
      const days = done.map((c) => (ms(c.closed_at) != null && ms(c.created_at) != null ? (ms(c.closed_at) - ms(c.created_at)) / DAY : null)).filter((x) => x != null);
      return {
        id: u.id,
        name: u.display_name,
        rank: u.rank || null,
        active: !!u.active,
        open: own.length - done.length,
        closed: done.length,
        success: rate(done),
        avgDays: avg(days),
      };
    })
    .filter((l) => l.active || l.open || l.closed)
    .sort((a, b) => b.open + b.closed - (a.open + a.closed) || a.name.localeCompare(b.name, 'de'));

  res.json({
    generatedAt: new Date(now).toISOString(),
    kpis: {
      revenue30,
      revenuePrev30,
      openSum,
      openCount,
      overdueSum,
      overdueCount,
      casesOpen: cases.filter((c) => c.status !== 'geschlossen').length,
      casesClosed: cases.filter((c) => c.status === 'geschlossen').length,
      opened30,
      closed30,
      closedPrev30,
      success: rate(cases.filter((c) => c.status === 'geschlossen')),
      avgDays: avg(durations),
    },
    months,
    lawyers,
    unassignedOpen: cases.filter((c) => c.status !== 'geschlossen' && !c.lawyer_id).length,
    outcomes: Object.entries(OUTCOMES)
      .map(([key, o]) => ({ key, label: o.label, success: o.success, count: outcomeCount[key] || 0 }))
      .filter((o) => o.count),
  });
});

module.exports = router;
