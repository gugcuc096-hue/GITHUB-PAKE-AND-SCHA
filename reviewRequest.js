'use strict';
/*
 * Nach dem Abschluss einer Akte einmal um eine Bewertung bitten: Im Mandantenportal steht dann „Wie zufrieden waren
 * Sie mit uns?“ (Übersicht und Akte), und hat der Mandant Discord verknüpft, kommt zusätzlich eine Direktnachricht mit
 * Knopf „Jetzt bewerten“, der direkt zur Bewertung in der Akte führt.
 *
 * Genau einmal je Akte (auch nach Wiederöffnen und erneutem Abschluss nicht noch einmal), nur an Mandanten mit Konto
 * und nur, solange es zu der Akte noch keine Bewertung gibt. Das Ergebnis der Akte steht nicht in der Nachricht.
 */
const { db } = require('./db');
const tickets = require('./tickets');
const features = require('./features');

function reviewUrl(caseId) {
  const base = tickets.siteBase();
  return base ? `${base}/dashboard?case=${caseId}&bewerten=1#cases` : null;
}

/** Nach dem Schließen aufrufen. Liefert true, wenn eine Direktnachricht verschickt wurde. */
async function afterClose(caseId) {
  if (!features.on('reviews')) return false;
  const c = db
    .prepare(
      `SELECT c.id, c.case_number, c.status, c.review_requested_at, u.id AS user_id, u.role, u.active, u.discord_id
       FROM cases c LEFT JOIN users u ON u.id = c.client_id WHERE c.id = ?`
    )
    .get(caseId);
  if (!c || c.status !== 'geschlossen' || c.review_requested_at || !c.user_id || c.role !== 'mandant' || !c.active) return false;
  if (db.prepare('SELECT 1 FROM reviews WHERE case_id = ?').get(c.id)) return false;
  db.prepare("UPDATE cases SET review_requested_at = datetime('now') WHERE id = ?").run(c.id);
  if (!tickets.hasToken() || !tickets.isId(c.discord_id)) return false;
  const url = reviewUrl(c.id);
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: c.discord_id });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, {
      embeds: [
        tickets.embed({
          title: '⭐ Wie zufrieden waren Sie mit uns?',
          description: require('./messageTemplates').render('review', { aktenzeichen: c.case_number }),
        }),
      ],
      components: url ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Jetzt bewerten', url }] }] : undefined,
      allowed_mentions: { parse: [] },
    });
    return true;
  } catch {
    return false; // Direktnachrichten gesperrt o. ä. – der Hinweis steht trotzdem im Portal
  }
}

module.exports = { afterClose, reviewUrl };
