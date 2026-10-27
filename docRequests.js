'use strict';
/*
 * Fehlende Unterlagen („Beleg fehlt“): Die Kanzlei fordert in der Akte etwas beim Mandanten an. Der Mandant sieht es im
 * Portal unter „Was ist zu tun?“ und im Ticket; ist es nach REMIND_DAYS Tagen noch offen, erinnert ihn der Bot einmal
 * per Discord-DM und im Ticket. Erledigt markieren können Kanzlei und Mandant.
 */
const { db } = require('./db');
const { getCase } = require('./models');
const tickets = require('./tickets');
const { dm } = require('./memberships');

const REMIND_DAYS = 3;

const row = (r) => ({ id: r.id, title: r.title, note: r.note, createdBy: r.created_by, createdAt: r.created_at, done: !!r.done_at, doneAt: r.done_at, doneBy: r.done_by });

function listForCase(caseId) {
  return db.prepare('SELECT * FROM case_requests WHERE case_id = ? ORDER BY (done_at IS NOT NULL) ASC, id ASC').all(caseId).map(row);
}

/** Offene Anforderungen aller Akten eines Mandanten (für „Was ist zu tun?“). */
function openForClient(userId) {
  return db
    .prepare(
      `SELECT r.*, c.case_number, c.title AS case_title FROM case_requests r JOIN cases c ON c.id = r.case_id
        WHERE c.client_id = ? AND r.done_at IS NULL AND c.status != 'geschlossen' ORDER BY r.id ASC`
    )
    .all(userId)
    .map((r) => ({ ...row(r), caseId: r.case_id, caseNumber: r.case_number, caseTitle: r.case_title }));
}

async function tell(caseId, r, { title, by }) {
  const c = getCase(caseId);
  if (!c) return [];
  const description = [`**${r.title}**`, r.note || '', 'Bitte reichen Sie die Unterlage über Ihre Akte im Mandantenportal oder per Nachricht an die Kanzlei nach.'].filter(Boolean).join('\n\n');
  const sent = [];
  if (c.client_id && (await dm(c.client_id, { title, description, fields: [{ name: 'Akte', value: c.case_number }], color: tickets.COLORS.gold }))) sent.push('Discord-DM');
  if (tickets.active() && !c.discord_deleted) {
    tickets.post(c.id, { event: 'note', title, description, color: tickets.COLORS.gold, mention: 'client', by: by ? by.display_name : undefined, byDiscordId: by ? by.discord_id : undefined });
    sent.push('Ticket');
  }
  return sent;
}

const announce = (caseId, r, by) => tell(caseId, r, { title: '📎 Unterlage fehlt', by }).catch(() => []);

/** Automatische Erinnerung nach REMIND_DAYS Tagen (alle 5 Minuten aufgerufen), einmal je Anforderung. */
let running = false;
async function sweep() {
  if (running) return;
  running = true;
  try {
    const due = db
      .prepare(
        `SELECT r.* FROM case_requests r JOIN cases c ON c.id = r.case_id
          WHERE r.done_at IS NULL AND r.reminded_at IS NULL AND c.status != 'geschlossen'
            AND r.created_at <= datetime('now', ?)`
      )
      .all(`-${REMIND_DAYS} days`);
    for (const r of due) {
      db.prepare('UPDATE case_requests SET reminded_at = ? WHERE id = ?').run(new Date().toISOString(), r.id);
      await tell(r.case_id, r, { title: '⏰ Erinnerung: Unterlage fehlt noch' }).catch((err) => console.warn(`Erinnerung an Unterlage ${r.id} fehlgeschlagen:`, err.message));
    }
  } finally {
    running = false;
  }
}

module.exports = { REMIND_DAYS, row, listForCase, openForClient, announce, sweep };
