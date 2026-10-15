'use strict';
/*
 * Wochenbericht fürs Board: jeden Montag ab 10 Uhr (Berliner Zeit) einmal per Discord-Direktnachricht
 * an alle Board-Mitglieder mit verknüpftem Discord. Die letzten 7 Tage (Vergleich zur Woche davor),
 * offene Rechnungen, liegengebliebene Akten, Fristen und Gerichtstermine der nächsten 7 Tage, Board-Eingang.
 * Abschaltbar in den Einstellungen; „An mich senden“ zum Ausprobieren.
 */
const { db, getSetting, setSetting } = require('./db');
const { BOARD_RANK_SQL } = require('./helpers');
const { idleLimit } = require('./models');
const tickets = require('./tickets');

const enabled = () => getSetting('weekly_report', '1') === '1';
const setEnabled = (on) => setSetting('weekly_report', on ? '1' : '0');

const money = (n) => `${Math.round(n || 0).toLocaleString('de-DE')} $`;
const one = (sql, ...args) => db.prepare(sql).get(...args) || {};

/** Kalenderwoche (ISO 8601) eines Datums. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/** Alle Zahlen des Berichts. */
function numbers() {
  const paid = (from, to) =>
    one(
      `SELECT COALESCE(SUM(total), 0) AS sum, COUNT(*) AS n FROM invoices
        WHERE kind = 'rechnung' AND status = 'bezahlt'
          AND julianday(COALESCE(paid_at, created_at)) > julianday('now', ?) AND julianday(COALESCE(paid_at, created_at)) <= julianday('now', ?)`,
      from,
      to
    );
  const open = one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS sum, COALESCE(SUM(due_date IS NOT NULL AND due_date != '' AND date(due_date) < date('now')), 0) AS overdue
       FROM invoices WHERE kind = 'rechnung' AND status = 'offen'`
  );
  const days = idleLimit();
  const top = one(
    `SELECT u.display_name AS name, COUNT(*) AS n FROM cases c JOIN users u ON u.id = c.lawyer_id
      WHERE c.status = 'geschlossen' AND julianday(c.closed_at) > julianday('now', '-7 days')
      GROUP BY c.lawyer_id ORDER BY n DESC, u.display_name LIMIT 1`
  );
  return {
    revenue: paid('-7 days', '+0 days').sum,
    revenuePrev: paid('-14 days', '-7 days').sum,
    paidCount: paid('-7 days', '+0 days').n,
    casesNew: one("SELECT COUNT(*) AS n FROM cases WHERE julianday(created_at) > julianday('now', '-7 days')").n,
    casesClosed: one("SELECT COUNT(*) AS n FROM cases WHERE status = 'geschlossen' AND julianday(closed_at) > julianday('now', '-7 days')").n,
    casesOpen: one("SELECT COUNT(*) AS n FROM cases WHERE status != 'geschlossen'").n,
    openInvoices: open.n,
    openSum: open.sum,
    overdue: open.overdue,
    idleDays: days,
    idle: days ? one("SELECT COUNT(*) AS n FROM cases WHERE status != 'geschlossen' AND julianday(updated_at) <= julianday('now', ?)", `-${days} days`).n : 0,
    deadlines: one(
      `SELECT COALESCE(SUM(type = 'frist'), 0) AS frist, COALESCE(SUM(type = 'gericht'), 0) AS gericht FROM appointments
        WHERE status = 'bestaetigt' AND type IN ('frist','gericht') AND julianday(starts_at) > julianday('now') AND julianday(starts_at) <= julianday('now', '+7 days')`
    ),
    applications: one("SELECT COUNT(*) AS n FROM applications WHERE status IN ('eingegangen','in_pruefung','gespraech')").n,
    concerns: one("SELECT COUNT(*) AS n FROM concerns WHERE status IN ('offen','in_bearbeitung')").n,
    top: top.n ? top : null,
  };
}

const trend = (now, prev) => {
  if (!prev) return now ? 'Vorwoche: 0 $' : 'wie in der Vorwoche';
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${pct > 0 ? '+' : ''}${pct} % zur Vorwoche (${money(prev)})`;
};

/** Der Bericht als Discord-Embed. */
function report(now = new Date()) {
  const n = numbers();
  const base = tickets.siteBase();
  const fields = [
    { name: '💰 Umsatz', value: `**${money(n.revenue)}** aus ${n.paidCount} bezahlten Rechnung${n.paidCount === 1 ? '' : 'en'}\n${trend(n.revenue, n.revenuePrev)}` },
    { name: '📁 Akten', value: `${n.casesNew} neu · ${n.casesClosed} abgeschlossen · ${n.casesOpen} laufend${n.top ? `\nMeiste Abschlüsse: ${n.top.name} (${n.top.n})` : ''}` },
    { name: '🧾 Offene Rechnungen', value: n.openInvoices ? `${n.openInvoices} über ${money(n.openSum)}${n.overdue ? ` · **${n.overdue} überfällig**` : ''}` : 'keine' },
    { name: '📅 Nächste 7 Tage', value: `${n.deadlines.frist || 0} Fristen · ${n.deadlines.gericht || 0} Gerichtstermine` },
    { name: '📥 Board-Eingang', value: `${n.applications} offene Bewerbung${n.applications === 1 ? '' : 'en'} · ${n.concerns} offene${n.concerns === 1 ? 's' : ''} Anliegen` },
  ];
  if (n.idleDays) fields.splice(3, 0, { name: '⏸️ Liegengeblieben', value: n.idle ? `**${n.idle} Akte${n.idle === 1 ? '' : 'n'}** seit ${n.idleDays}+ Tagen ohne Aktivität` : 'keine' });
  return {
    title: `📊 Wochenbericht – KW ${isoWeek(now)}`,
    description: `Die letzten 7 Tage in der Kanzlei.${base ? `\n[Kanzlei-Statistik öffnen](${base}/dashboard.html#stats)` : ''}`,
    fields,
    color: tickets.COLORS.gold,
    footer: 'Pake & Scha Legal Consulting · jeden Montag',
  };
}

const boardWithDiscord = () =>
  db
    .prepare(
      `SELECT id, display_name, discord_id FROM users
        WHERE active = 1 AND discord_id IS NOT NULL AND discord_id != '' AND (role = 'admin' OR (role = 'anwalt' AND ${BOARD_RANK_SQL()}))`
    )
    .all();

/** Bericht an die Empfänger senden (Standard: alle Board-Mitglieder mit Discord). */
async function send(recipients = boardWithDiscord()) {
  if (!tickets.hasToken()) return { sent: 0, failed: recipients.length, error: 'Der Discord-Bot ist nicht eingerichtet.' };
  const e = report();
  let sent = 0;
  for (const u of recipients) {
    try {
      const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: u.discord_id });
      await tickets.rest('POST', `/channels/${ch.id}/messages`, { embeds: [tickets.embed(e)] });
      sent++;
    } catch (err) {
      console.warn(`Wochenbericht an ${u.display_name} nicht zugestellt:`, err.message);
    }
  }
  return { sent, failed: recipients.length - sent };
}

/** Alle 5 Minuten aufgerufen: montags ab 10 Uhr (Berlin) einmal je Woche. */
let running = false;
async function sweep(now = new Date()) {
  if (!enabled() || running) return null;
  const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  if (berlin.getDay() !== 1 || berlin.getHours() < 10) return null;
  const key = berlin.toLocaleDateString('sv-SE');
  if (getSetting('weekly_report_last', '') === key) return null;
  running = true;
  try {
    setSetting('weekly_report_last', key);
    return await send();
  } finally {
    running = false;
  }
}

module.exports = { enabled, setEnabled, numbers, report, send, sweep };
