'use strict';
/*
 * Termin-Zusage per Knopf: Trägt die Kanzlei einen Termin für den Mandanten ein (oder verlegt ihn), bekommt der
 * Mandant – mit verknüpftem Discord bzw. seinem Discord aus dem Ticket – eine Direktnachricht mit „Passt“ und
 * „Passt nicht“. Die Antwort steht im Kalender und in der Akte; bei „Passt nicht“ erfährt es der zuständige Anwalt
 * per Direktnachricht. Fristen fragen nicht nach. Knöpfe: appt:yes:<id> / appt:no:<id> – antworten kann nur der
 * Mandant dieses Termins (sein Discord).
 */
const { db } = require('./db');
const { getAppointment, getCase } = require('./models');
const tickets = require('./tickets');

/** Discord des Mandanten: verknüpftes Konto, sonst sein Discord aus dem Ticket der Akte. */
function clientDiscordOf(a) {
  const uid = a.client_id || a.case_client_id;
  const u = uid && db.prepare('SELECT discord_id FROM users WHERE id = ? AND active = 1').get(uid);
  if (u && tickets.isId(u.discord_id)) return u.discord_id;
  const c = a.case_id && getCase(a.case_id);
  const id = c && tickets.clientDiscordId(c);
  return tickets.isId(id) ? id : null;
}
const asksClient = (a) => !!a && !!a.client_visible && a.type !== 'frist' && ['bestaetigt', 'angefragt'].includes(a.status) && !!(a.client_id || a.case_id);
const upcoming = (a) => new Date(a.starts_at).getTime() > Date.now();

/** Nach Anlegen/Verlegen durch die Kanzlei: Mandant fragen (vorherige Antwort verfällt). Liefert true, wenn gesendet. */
async function askClient(id) {
  db.prepare('UPDATE appointments SET client_response = NULL, client_response_at = NULL WHERE id = ?').run(id);
  const a = getAppointment(id);
  if (!asksClient(a) || !upcoming(a) || !tickets.hasToken()) return false;
  const discordId = clientDiscordOf(a);
  if (!discordId) return false;
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: discordId });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, {
      embeds: [
        tickets.embed({
          title: `📅 ${a.title}`.slice(0, 256),
          description: `Ihre Kanzlei hat einen Termin für Sie eingetragen${a.case_number ? ` (Akte **${a.case_number}**)` : ''}. Passt Ihnen der Termin?`,
          fields: [{ name: 'Wann', value: require('./discord').discordTime(a.starts_at, 'F'), inline: false }, ...(a.location ? [{ name: 'Ort', value: a.location }] : [])],
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Passt', emoji: { name: '✅' }, custom_id: `appt:yes:${a.id}` },
            { type: 2, style: 4, label: 'Passt nicht', custom_id: `appt:no:${a.id}` },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    });
    return true;
  } catch {
    return false; // Direktnachrichten gesperrt – der Termin steht trotzdem im Portal
  }
}

/** Antwort per Knopf. Liefert { text } oder { error }. */
function answer(action, id, discordId) {
  const a = getAppointment(id);
  if (!asksClient(a)) return { error: 'Diesen Termin gibt es so nicht mehr.' };
  if (clientDiscordOf(a) !== discordId) return { error: 'Antworten kann nur der Mandant dieses Termins.' };
  if (!upcoming(a)) return { error: 'Der Termin liegt schon in der Vergangenheit.' };
  const yes = action === 'yes';
  db.prepare("UPDATE appointments SET client_response = ?, client_response_at = datetime('now') WHERE id = ?").run(yes ? 'zugesagt' : 'passt_nicht', a.id);
  const live = require('./live');
  live.areaChanged('calendar');
  if (a.case_id) live.caseChanged(a.case_id);
  if (!yes && tickets.isId(a.assigned_discord_id)) {
    (async () => {
      const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: a.assigned_discord_id });
      await tickets.rest('POST', `/channels/${ch.id}/messages`, {
        embeds: [
          tickets.embed({
            title: `🙅 Termin passt dem Mandanten nicht: ${a.title}`.slice(0, 256),
            description: `${a.client_name || a.case_client_name || 'Der Mandant'} kann ${require('./discord').discordTime(a.starts_at, 'F')} nicht${a.case_number ? ` (Akte **${a.case_number}**)` : ''}. Bitte einen neuen Termin vorschlagen.`,
            color: tickets.COLORS.red,
          }),
        ],
        allowed_mentions: { parse: [] },
      });
    })().catch(() => {});
  }
  return { text: yes ? 'Danke – Ihre Zusage ist bei der Kanzlei angekommen.' : 'Danke – die Kanzlei weiß Bescheid und meldet sich mit einem neuen Vorschlag.' };
}

module.exports = { askClient, answer };
