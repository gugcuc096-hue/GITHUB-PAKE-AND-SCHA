'use strict';
/*
 * Zahlungserinnerungen: Offene Rechnungen/Honorarvereinbarungen, die seit X Tagen überfällig sind (Einstellung,
 * Standard 3 Tage, 0 = aus), erinnern den Mandanten einmal automatisch – per Discord-DM (verknüpftes Discord)
 * und im Ticket der Akte. Die Kanzlei kann zusätzlich jederzeit von Hand erinnern („Erinnern“ an der Rechnung).
 * Rechnungen, die schon vor dem Einschalten so lange überfällig waren, bekommen keine automatische Erinnerung
 * (sonst käme beim ersten Start eine Welle für alte Rechnungen).
 */
const { db, getSetting, setSetting } = require('./db');
const { INVOICE_SELECT, getCase, addSystemNote, logActivity, berlinToday, overdueDays } = require('./models');
const tickets = require('./tickets');
const { dm } = require('./memberships');

const DEFAULT_DAYS = 3;
const MANUAL_PAUSE_MIN = 10; // dieselbe Rechnung höchstens alle 10 Minuten von Hand erinnern

function reminderDays() {
  const n = Number(getSetting('invoice_reminder_days', String(DEFAULT_DAYS)));
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : DEFAULT_DAYS;
}

/** Einstellung speichern; beim Einschalten zählt ab heute (keine Erinnerungen für Altfälle). */
function setReminderDays(n) {
  if (reminderDays() === 0 && n > 0) setSetting('invoice_reminders_since', berlinToday());
  setSetting('invoice_reminder_days', String(n));
}

const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE');
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * Erinnerung senden. by = handelnde Person (null = automatisch).
 * Liefert { sent: ['Discord-DM', 'Ticket'] } – leer, wenn der Mandant über Discord nicht erreichbar ist.
 */
async function sendReminder(invoiceId, by = null) {
  const inv = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(invoiceId);
  if (!inv) throw fail('Dokument nicht gefunden.', 404);
  if (inv.status !== 'offen') throw fail('Nur offene Rechnungen lassen sich anmahnen.');
  if (by && inv.reminded_at && Date.now() - Date.parse(inv.reminded_at) < MANUAL_PAUSE_MIN * 60 * 1000) {
    throw fail(`Zu dieser Rechnung wurde gerade erst erinnert – bitte in ein paar Minuten erneut.`, 429);
  }
  const label = inv.kind === 'honorarvereinbarung' ? 'Honorarvereinbarung' : 'Rechnung';
  const late = overdueDays(inv.due_date);
  const payInfo = getSetting('firm_payment_info', 'Zahlbar per Überweisung an Pake & Scha Legal Consulting (Maze Bank).');
  const description = [
    late > 0
      ? `Die ${label} **${inv.number}** über **${money(inv.total)}** war am **${fmtDay(inv.due_date)}** fällig und ist noch offen.`
      : `Die ${label} **${inv.number}** über **${money(inv.total)}** ist noch offen${inv.due_date ? ` (fällig am ${fmtDay(inv.due_date)})` : ''}.`,
    `Bitte begleichen Sie den Betrag. ${payInfo}`,
    'Bereits bezahlt? Dann ist diese Nachricht hinfällig. Die Rechnung finden Sie im Mandantenportal unter „Rechnungen“.',
  ].join('\n\n');
  const fields = [
    { name: 'Betrag', value: money(inv.total) },
    ...(inv.due_date ? [{ name: late > 0 ? 'Überfällig seit' : 'Fällig am', value: late > 0 ? `${fmtDay(inv.due_date)} (${late} ${late === 1 ? 'Tag' : 'Tage'})` : fmtDay(inv.due_date) }] : []),
    ...(inv.case_number ? [{ name: 'Akte', value: inv.case_number }] : []),
  ];
  const title = `⏰ Zahlungserinnerung: ${label} ${inv.number}`;
  const sent = [];
  const clientId = inv.client_user_id || inv.case_client_id || null;
  if (clientId && (await dm(clientId, { title, description, fields, color: tickets.COLORS.gold }))) sent.push('Discord-DM');
  const c = inv.case_id ? getCase(inv.case_id) : null;
  if (c && tickets.active() && !c.discord_deleted) {
    tickets.post(c.id, { title, description, fields, color: tickets.COLORS.gold, mention: 'client', by: by ? by.display_name : undefined, byDiscordId: by ? by.discord_id : undefined });
    sent.push('Ticket');
  }
  db.prepare('UPDATE invoices SET reminded_at = ?, reminder_count = reminder_count + 1 WHERE id = ?').run(new Date().toISOString(), inv.id);
  const via = sent.length ? sent.join(' und ') : 'nicht zugestellt – der Mandant hat kein verknüpftes Discord und die Rechnung kein Ticket';
  if (c) addSystemNote(c.id, by, `Zahlungserinnerung zu ${label} ${inv.number} ${by ? 'gesendet' : 'automatisch gesendet'} (${via}).`, true);
  logActivity(by, by ? 'Zahlungserinnerung gesendet' : 'Zahlungserinnerung (automatisch)', 'invoice', inv.id, `${inv.number} · ${money(inv.total)} · ${via}`);
  return { sent };
}

/** Automatische Erinnerungen (alle 5 Minuten aufgerufen). */
let running = false;
async function sweep() {
  const days = reminderDays();
  if (!days || running) return;
  running = true;
  try {
    let since = getSetting('invoice_reminders_since', '');
    if (!since) {
      since = berlinToday();
      setSetting('invoice_reminders_since', since);
    }
    const today = berlinToday();
    const due = db.prepare("SELECT id, due_date FROM invoices WHERE status = 'offen' AND due_date IS NOT NULL AND reminded_at IS NULL").all();
    for (const r of due) {
      const remindOn = addDays(r.due_date, days);
      if (remindOn > today || remindOn < since) continue; // noch nicht so weit bzw. Altfall von vor dem Einschalten
      await sendReminder(r.id, null).catch((err) => console.warn(`Zahlungserinnerung ${r.id} fehlgeschlagen:`, err.message));
    }
  } finally {
    running = false;
  }
}

module.exports = { sendReminder, sweep, reminderDays, setReminderDays, DEFAULT_DAYS };
