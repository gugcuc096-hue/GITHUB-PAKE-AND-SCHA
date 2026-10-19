'use strict';
/*
 * Deal-Rechner: Ein Angebot der Staatsanwaltschaft (z. B. „15 HE statt Anklage“) wird in der Akte eingetragen und neben
 * das Strafmaß gestellt. Der Mandant stimmt im Portal oder per Discord-Knopf zu oder lehnt ab – mit Zeitpunkt und Weg
 * dokumentiert (Verlauf der Akte, Ticket). Die Kanzlei kann die Antwort auch „im Spiel“ erfassen.
 * Knöpfe in der Direktnachricht: deal:yes:<id> / deal:no:<id> – antworten kann nur der Mandant der Akte.
 */
const { db } = require('./db');
const { getCase, addSystemNote } = require('./models');
const tickets = require('./tickets');

const usd = (n) => `${Number(n).toLocaleString('de-DE')} $`;
const offerText = (d) => [d.offer_he != null ? `${d.offer_he} HE` : null, d.offer_fine != null ? usd(d.offer_fine) : null].filter(Boolean).join(' + ') || 'ohne Strafe';

function row(d) {
  return {
    id: d.id,
    he: d.offer_he,
    fine: d.offer_fine,
    note: d.note,
    status: d.status,
    answeredAt: d.answered_at,
    answeredVia: d.answered_via,
    createdByName: d.created_by_name,
    createdAt: d.created_at,
  };
}
const forCase = (caseId) => db.prepare('SELECT * FROM case_deals WHERE case_id = ? ORDER BY id DESC').all(caseId).map(row);
const load = (id) => db.prepare('SELECT * FROM case_deals WHERE id = ?').get(id) || null;

/** Discord des Mandanten: verknüpftes Konto, sonst sein Discord aus dem Ticket. */
function clientDiscord(c) {
  const u = c.client_id && db.prepare('SELECT discord_id FROM users WHERE id = ? AND active = 1').get(c.client_id);
  if (u && tickets.isId(u.discord_id)) return u.discord_id;
  const id = tickets.clientDiscordId(c);
  return tickets.isId(id) ? id : null;
}

/** Neues Angebot: Direktnachricht an den Mandanten mit „Annehmen“ / „Ablehnen“. */
async function askClient(dealId) {
  const d = load(dealId);
  const c = d && getCase(d.case_id);
  const to = c && clientDiscord(c);
  if (!to || !tickets.hasToken()) return false;
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: to });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, {
      embeds: [
        tickets.embed({
          title: `⚖️ Angebot der Staatsanwaltschaft – ${c.case_number}`,
          description: `Die Staatsanwaltschaft bietet in Ihrer Sache an: **${offerText(d)}**.${d.note ? `\n\n${d.note}` : ''}\n\nBitte besprechen Sie das Angebot mit Ihrem Anwalt und antworten Sie dann hier oder im Portal.`,
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Annehmen', custom_id: `deal:yes:${d.id}` },
            { type: 2, style: 4, label: 'Ablehnen', custom_id: `deal:no:${d.id}` },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Antwort festhalten. by: { user } (Portal/Kanzlei) oder { discordId } (Knopf). via: portal | discord | kanzlei.
 * Liefert { deal } oder { error }.
 */
function answer(dealId, accept, { user = null, discordId = null, via }) {
  const d = load(dealId);
  const c = d && getCase(d.case_id);
  if (!d || !c) return { error: 'Dieses Angebot gibt es nicht mehr.' };
  if (d.status !== 'offen') return { error: `Das Angebot ist bereits ${d.status === 'zurueckgezogen' ? 'zurückgezogen' : d.status}.` };
  if (via === 'discord' && clientDiscord(c) !== discordId) return { error: 'Antworten kann nur der Mandant dieser Akte.' };
  if (via === 'portal' && (!user || c.client_id !== user.id)) return { error: 'Antworten kann nur der Mandant dieser Akte.' };
  const status = accept ? 'angenommen' : 'abgelehnt';
  db.prepare("UPDATE case_deals SET status = ?, answered_at = datetime('now'), answered_via = ? WHERE id = ?").run(status, via, d.id);
  const how = { portal: 'im Portal', discord: 'per Discord', kanzlei: `im Spiel (erfasst von ${user ? user.display_name : 'der Kanzlei'})` }[via];
  addSystemNote(c.id, user, `Angebot der Staatsanwaltschaft (${offerText(d)}) vom Mandanten ${status} – ${how}.`);
  tickets.post(c.id, {
    event: 'note',
    title: accept ? '✅ Angebot angenommen' : '❌ Angebot abgelehnt',
    description: `Angebot der Staatsanwaltschaft: **${offerText(d)}** – ${how}.`,
    color: accept ? tickets.COLORS.green : tickets.COLORS.slate,
    mention: 'lawyers',
  });
  require('./live').caseChanged(c.id);
  return { deal: row(load(d.id)) };
}

module.exports = { forCase, load, row, askClient, answer, offerText };
