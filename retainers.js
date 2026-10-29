'use strict';
/*
 * Dauermandate: Firmen oder Stammmandanten zahlen eine feste Pauschale je Zeitraum (z. B. monatlich). Die Rechnung entsteht
 * zum Fälligkeitstag von selbst – mit der gewählten Rechnungsart (Zahlungsziel, Standardtext), Meldung im Ticket der Akte und
 * in Discord. Fällige Zeiträume werden nachgeholt (höchstens drei je Durchlauf); eine Frist („bis“) beendet das Dauermandat.
 * Fälligkeiten rechnen immer ab dem Startdatum (31. Januar + 1 Monat = 28. Februar, danach wieder der 31.), nichts driftet.
 */
const { z } = require('zod');
const { db, nextInvoiceNumber } = require('./db');
const { INVOICE_SELECT, getCase, addSystemNote, logActivity, berlinToday, invoiceRow } = require('./models');
const billing = require('./billing');
const discord = require('./discord');
const tickets = require('./tickets');

db.exec(`
  CREATE TABLE IF NOT EXISTS retainers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    client_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_name     TEXT NOT NULL,
    client_contact  TEXT NOT NULL DEFAULT '',
    case_id         INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    amount          INTEGER NOT NULL,
    interval_months INTEGER NOT NULL DEFAULT 1,
    start_date      TEXT NOT NULL,
    end_date        TEXT,
    runs            INTEGER NOT NULL DEFAULT 0,
    type_key        TEXT NOT NULL DEFAULT 'rechnung',
    note            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','pausiert','beendet')),
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_invoice_id INTEGER
  );
`);
try {
  db.exec('ALTER TABLE invoices ADD COLUMN retainer_id INTEGER');
} catch {
  /* Spalte ist schon da */
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** JJJJ-MM-TT + n Monate, ab dem Starttag gerechnet (kürzere Monate schneiden den Tag ab). */
function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const total = m - 1 + n;
  const yy = y + Math.floor(total / 12);
  const mm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const dueAt = (r, k = r.runs) => addMonths(r.start_date, k * r.interval_months);
const nextDue = (r) => (r.status === 'beendet' || (r.end_date && dueAt(r) > r.end_date) ? null : dueAt(r));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** „Oktober 2026“ bzw. „Oktober – Dezember 2026“. */
function periodLabel(r, k) {
  const a = dueAt(r, k);
  if (r.interval_months === 1) return `${MONTHS[Number(a.slice(5, 7)) - 1]} ${a.slice(0, 4)}`;
  const b = addMonths(a, r.interval_months - 1);
  const [ma, mb] = [MONTHS[Number(a.slice(5, 7)) - 1], MONTHS[Number(b.slice(5, 7)) - 1]];
  return a.slice(0, 4) === b.slice(0, 4) ? `${ma} – ${mb} ${a.slice(0, 4)}` : `${ma} ${a.slice(0, 4)} – ${mb} ${b.slice(0, 4)}`;
}

const row = (r) => ({
  id: r.id,
  title: r.title,
  clientUserId: r.client_user_id,
  clientName: r.client_name,
  clientContact: r.client_contact,
  caseId: r.case_id,
  caseNumber: r.case_id ? (getCase(r.case_id) || {}).case_number || null : null,
  amount: r.amount,
  intervalMonths: r.interval_months,
  startDate: r.start_date,
  endDate: r.end_date,
  runs: r.runs,
  nextDue: nextDue(r),
  typeKey: r.type_key,
  typeLabel: billing.typeName(r.type_key) || 'Rechnung',
  note: r.note,
  status: r.status,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  lastInvoiceId: r.last_invoice_id,
});

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum angeben.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s, 'Ungültiges Datum');
const input = z.object({
  title: z.string().trim().min(3).max(120),
  clientName: z.string().trim().min(2).max(120),
  clientContact: z.string().trim().max(120).default(''),
  clientUserId: z.number().int().positive().nullable().optional(),
  caseId: z.number().int().positive().nullable().optional(),
  amount: z.number().int().min(1).max(1_000_000_000),
  intervalMonths: z.number().int().min(1).max(12).default(1),
  startDate: day,
  endDate: day.nullable().optional(),
  typeKey: z.string().max(40).default('rechnung'),
  note: z.string().trim().max(1000).default(''),
});

function check(d) {
  const t = billing.type(d.typeKey);
  if (!t || !t.active) throw fail('Diese Rechnungsart gibt es nicht (mehr).');
  if (d.endDate && d.endDate < d.startDate) throw fail('Das Ende darf nicht vor dem Beginn liegen.');
  if (d.caseId && !getCase(d.caseId)) throw fail('Akte nicht gefunden.', 404);
  if (d.clientUserId && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(d.clientUserId)) throw fail('Mandantenkonto nicht gefunden.', 404);
}

const get = (id) => db.prepare('SELECT * FROM retainers WHERE id = ?').get(id) || null;
const list = () => db.prepare("SELECT * FROM retainers ORDER BY CASE status WHEN 'aktiv' THEN 0 WHEN 'pausiert' THEN 1 ELSE 2 END, title").all().map(row);

function create(data, user) {
  const d = input.parse(data);
  check(d);
  const c = d.caseId ? getCase(d.caseId) : null;
  const info = db
    .prepare(
      `INSERT INTO retainers (title, client_user_id, client_name, client_contact, case_id, amount, interval_months, start_date, end_date, type_key, note, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(d.title, d.clientUserId ?? (c ? c.client_id : null) ?? null, d.clientName, d.clientContact, d.caseId || null, d.amount, d.intervalMonths, d.startDate, d.endDate || null, d.typeKey, d.note, user.id, user.display_name);
  return Number(info.lastInsertRowid);
}
function update(id, data) {
  const d = input.parse(data);
  check(d);
  const cur = get(id);
  // Start und Takt nur ändern, solange noch nichts abgerechnet wurde (sonst verschöbe sich die Zählung)
  if (cur.runs > 0 && (d.startDate !== cur.start_date || d.intervalMonths !== cur.interval_months)) throw fail('Beginn und Takt lassen sich nicht mehr ändern, sobald abgerechnet wurde – bitte ein neues Dauermandat anlegen.', 409);
  db.prepare(
    `UPDATE retainers SET title = ?, client_user_id = ?, client_name = ?, client_contact = ?, case_id = ?, amount = ?, interval_months = ?, start_date = ?, end_date = ?, type_key = ?, note = ? WHERE id = ?`
  ).run(d.title, d.clientUserId ?? cur.client_user_id, d.clientName, d.clientContact, d.caseId ?? cur.case_id, d.amount, d.intervalMonths, d.startDate, d.endDate || null, d.typeKey, d.note, id);
}
function setStatus(id, status) {
  if (!['aktiv', 'pausiert', 'beendet'].includes(status)) throw fail('Ungültiger Stand.');
  db.prepare('UPDATE retainers SET status = ? WHERE id = ?').run(status, id);
}
function remove(id) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE retainer_id = ?').get(id).n;
  if (n) throw fail(`Es gibt schon ${n} Rechnung${n === 1 ? '' : 'en'} dazu – bitte beenden statt löschen.`, 409);
  db.prepare('DELETE FROM retainers WHERE id = ?').run(id);
}
const invoicesOf = (id) => db.prepare(`${INVOICE_SELECT} WHERE i.retainer_id = ? ORDER BY i.id DESC`).all(id).map(invoiceRow);

/** Rechnung für den nächsten Zeitraum erstellen. Liefert die Rechnung. */
function invoiceNext(r, today = berlinToday()) {
  const t = billing.type(r.type_key) || billing.type('rechnung');
  const period = periodLabel(r, r.runs);
  const subject = `${r.title} – ${period}`;
  const items = [{ description: `Dauermandat ${r.title} (${period})`, quantity: 1, unitPrice: r.amount, total: r.amount }];
  const issuer = r.created_by ? db.prepare('SELECT * FROM users WHERE id = ?').get(r.created_by) : null;
  const kind = t.base;
  const number = nextInvoiceNumber(kind);
  const due = t.dueDays > 0 ? addDays(today, t.dueDays) : null;
  const notes = [r.note, t.note].filter(Boolean).join('\n\n');
  const info = db
    .prepare(
      `INSERT INTO invoices (number, kind, case_id, client_name, client_contact, subject, items_json, subtotal, total, notes, due_date, issued_by, issuer_name, issuer_rank, client_user_id, status, type_key, retainer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?)`
    )
    .run(number, kind, r.case_id || null, r.client_name, r.client_contact, subject, JSON.stringify(items), r.amount, r.amount, notes, due, issuer ? issuer.id : null, issuer ? issuer.display_name : 'Dauermandat', issuer ? issuer.rank || '' : '', r.client_user_id || null, t.key, r.id);
  const id = Number(info.lastInsertRowid);
  db.prepare('UPDATE retainers SET runs = runs + 1, last_invoice_id = ? WHERE id = ?').run(id, r.id);
  const money = `${Math.round(r.amount).toLocaleString('de-DE')} $`;
  const c = r.case_id ? getCase(r.case_id) : null;
  if (c) addSystemNote(c.id, issuer, `Dauermandat: ${t.name} ${number} über ${money} (${period}) erstellt.`, true);
  logActivity(issuer, 'Dauermandat abgerechnet', 'invoice', id, `${number} · ${r.client_name} · ${money} · ${period}`);
  try {
    discord.notify('invoice.created', { title: `🧾 ${t.name} ${number}`, description: subject, fields: [{ name: 'Empfänger', value: r.client_name }, { name: 'Betrag', value: money }, { name: 'Dauermandat', value: period }, { name: 'Akte', value: c ? c.case_number : '—' }] });
    if (c) tickets.post(c.id, { event: 'invoice', title: `🧾 ${t.name} ${number}`, description: `${subject}\nIm Mandantenportal unter „Rechnungen“ abrufbar.`, fields: [{ name: 'Betrag', value: money }, ...(due ? [{ name: 'Fällig am', value: new Date(`${due}T12:00:00`).toLocaleDateString('de-DE') }] : [])], mention: 'client', by: issuer ? issuer.display_name : 'Dauermandat', byDiscordId: issuer ? issuer.discord_id : null });
    require('./googleDocs').ensure('invoice', id);
    require('./googleDocs').touchExtract(r.case_id || null);
  } catch (err) {
    console.warn('Dauermandat: Meldung fehlgeschlagen:', err.message);
  }
  return db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
}

/** Alle fälligen Zeiträume abrechnen (höchstens `max` je Dauermandat und Durchlauf). Liefert die Zahl der Rechnungen. */
function sweep({ today = berlinToday(), max = 3 } = {}) {
  let made = 0;
  for (const r0 of db.prepare("SELECT * FROM retainers WHERE status = 'aktiv'").all()) {
    for (let i = 0; i < max; i++) {
      const r = get(r0.id);
      const due = nextDue(r);
      if (!due) {
        if (r.status === 'aktiv') setStatus(r.id, 'beendet');
        break;
      }
      if (due > today) break;
      invoiceNext(r, today);
      made++;
    }
    const after = get(r0.id);
    if (after.status === 'aktiv' && !nextDue(after)) setStatus(after.id, 'beendet');
  }
  return made;
}

module.exports = { row, list, get, create, update, setStatus, remove, invoicesOf, invoiceNext, sweep, nextDue, periodLabel, addMonths };
