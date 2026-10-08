'use strict';
/*
 * Discord-Interaktionen: Klicks auf die Buttons im Ticket (Akte übernehmen, Akte schließen, Wieder öffnen,
 * Anliegen erledigt), die Ticket-Befehle /add, /remove, /delete und die übrigen Befehle des Kanzlei-Bots
 * (/passwort, /akte, /notiz, /dienst, /imdienst, /termine, /hilfe – siehe ../botCommands.js).
 * Jede Antwort ist ein Embed.
 * Discord schickt jeden Klick und Befehl per HTTP an diese Adresse – eingetragen im Developer
 * Portal unter „Interactions Endpoint URL“ (<PUBLIC_URL>/api/discord/interactions).
 *
 * Sicherheit:
 *  - Jede Anfrage ist von Discord signiert (Ed25519). Ohne gültige Signatur mit DISCORD_PUBLIC_KEY → 401.
 *    Discord prüft das beim Eintragen der URL selbst (auch mit absichtlich falschen Signaturen).
 *  - Wer klickt, wird über sein verknüpftes Discord-Konto dem Website-Konto zugeordnet; es gelten dieselben
 *    Rechte wie im Dashboard (Akte: zuständige Anwälte / Board of Partners; Anliegen: Board of Partners).
 *  - Der Button muss im Ticket-Kanal genau dieser Akte bzw. dieses Anliegens liegen.
 */
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { isStaff } = require('../auth');
const { isBoard } = require('../helpers');
const { getCase, caseAccess, logActivity, addSystemNote } = require('../models');
const tickets = require('../tickets');
const bot = require('../botCommands');
const cases = require('./cases');
const concerns = require('./concerns');
const contractRoutes = require('./contracts');

const router = express.Router();

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // DER-Kopf eines Ed25519-Public-Keys

function verified(req) {
  const hex = tickets.publicKeyHex();
  const sig = String(req.get('x-signature-ed25519') || '');
  const ts = String(req.get('x-signature-timestamp') || '');
  if (!hex || !/^[0-9a-f]{128}$/i.test(sig) || !/^\d{1,12}$/.test(ts) || !Buffer.isBuffer(req.body)) return false;
  // Alte Anfragen (Wiederholung) ablehnen
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(ts, 'utf8'), req.body]), key, Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

const { fail, done, info, confirm, replaceWith, NOT_LINKED } = bot;
const { COLORS } = tickets;

function handleCase(action, id, u, channelId) {
  const c = getCase(id);
  if (!c || c.discord_channel_id !== channelId) return fail('Dieses Ticket gehört zu keiner (bestehenden) Akte mehr.');
  if (!isStaff(u)) return info('Diese Buttons sind für die Kanzlei. Bei Fragen schreiben Sie einfach hier in den Kanal.');
  const access = caseAccess(c, u);
  const via = ' (über Discord)';
  if (action === 'claim') {
    if (c.status === 'geschlossen') return fail('Die Akte ist geschlossen.');
    if (c.lawyer_id) return info(`Die Akte hat bereits einen federführenden Anwalt (${c.lawyer_name || '—'}).`, 'Schon vergeben');
    cases.claimCase(c, u, via);
    return done(`Du hast die Akte **${c.case_number}** übernommen.`, 'Akte übernommen');
  }
  if (!access.canEdit) return fail('Schließen und wieder öffnen können nur die zuständigen Anwälte und das Board of Partners.', 'Keine Berechtigung');
  if (action === 'close') {
    if (c.status === 'geschlossen') return info('Die Akte ist bereits geschlossen.');
    return confirm('🔒 Akte schließen?', `Akte **${c.case_number}** wirklich schließen? Das Ticket wandert ins Archiv, der Mandant kann dann nur noch lesen.`, [
      { type: 1, components: [{ type: 2, style: 4, label: 'Ja, Akte schließen', custom_id: `case:closeok:${c.id}` }] },
    ]);
  }
  if (action === 'closeok') {
    if (c.status === 'geschlossen') return replaceWith({ title: 'ℹ️ Schon geschlossen', description: 'Die Akte ist bereits geschlossen.', color: COLORS.slate });
    cases.setCaseStatus(c, u, 'geschlossen', via);
    return replaceWith({ title: '🔒 Akte geschlossen', description: `Akte **${c.case_number}** ist geschlossen, das Ticket wandert ins Archiv.`, color: COLORS.slate });
  }
  if (action === 'reopen') {
    if (c.status !== 'geschlossen') return info('Die Akte ist nicht geschlossen.');
    cases.setCaseStatus(c, u, c.lawyer_id ? 'in_bearbeitung' : 'offen', via);
    return done(`Akte **${c.case_number}** ist wieder offen.`, '🔓 Wieder geöffnet');
  }
  return fail('Unbekannte Aktion.');
}

function handleConcern(action, id, u, channelId) {
  const k = db.prepare(`${concerns.SELECT} WHERE k.id = ?`).get(id);
  if (!k || k.discord_channel_id !== channelId) return fail('Dieses Ticket gehört zu keinem (bestehenden) Anliegen mehr.');
  if (!isBoard(u)) return fail('Nur für das Board of Partners.', 'Keine Berechtigung');
  const status = action === 'done' ? 'erledigt' : action === 'reopen' ? 'in_bearbeitung' : null;
  if (!status) return fail('Unbekannte Aktion.');
  const r = concerns.changeConcern(k, u, { status }, ' über Discord');
  if (r.error) return fail(r.error);
  if (!r.changed) return info('Keine Änderung – das Anliegen hat diesen Status bereits.');
  return status === 'erledigt' ? done(`Anliegen **${k.reference}** ist als erledigt markiert.`, 'Anliegen erledigt') : done(`Anliegen **${k.reference}** ist wieder offen.`, '🔓 Wieder geöffnet');
}

/*
 * Vertrag in Discord lesen und unterschreiben (Knopf unter „Vertrag erstellt“ im Akten-Ticket):
 *  ksign:read:<id>  → Vertragstext nur für die Person sichtbar (Mandant oder Kanzlei), beim Mandanten mit „Jetzt unterschreiben“
 *  ksign:sign:<id>  → Fenster (Modal): vollständigen Namen eintippen – wie die Unterschrift im Mandantenportal
 *  ksign:modal:<id> → Unterschrift speichern
 * Der Mandant braucht dafür kein Website-Konto: Es zählt das Discord, mit dem er im Ticket ist.
 */
function handleContract(action, id, body, discordId, channelId) {
  if (action === 'modal') {
    const typed = body.data?.components?.[0]?.components?.[0]?.value || '';
    const who = body.member?.user?.global_name || body.member?.user?.username || body.user?.username || '';
    const r = contractRoutes.signViaDiscord(id, discordId, channelId, typed, who);
    if (r.error) return fail(r.error);
    return done(`**${r.k.template_name}** ist mit Ihrer Unterschrift (**${r.signature}**) versehen. Die Kanzlei wird benachrichtigt.`, 'Unterschrieben');
  }
  const r = contractRoutes.discordContract(id, discordId, channelId);
  if (r.error) return fail(r.error);
  if (action === 'sign') {
    if (!r.canSign) return info(r.viewer !== 'mandant' ? 'Unterschreiben kann nur der Mandant dieser Akte.' : 'Sie haben bereits unterschrieben.');
    return {
      type: 9,
      data: {
        custom_id: `ksign:modal:${r.k.id}`,
        title: 'Vertrag unterschreiben',
        components: [
          {
            type: 1,
            components: [{ type: 4, custom_id: 'name', style: 1, label: 'Ihr vollständiger Name (wie im Vertrag)', min_length: 3, max_length: 120, required: true, placeholder: (r.data.mandant || 'Vor- und Nachname').slice(0, 100) }],
          },
        ],
      },
    };
  }
  if (action !== 'read') return fail('Unbekannter Button.');
  const view = contractRoutes.discordReadView(r.k, r.c, r.data);
  const portal = tickets.siteBase() && (r.viewer === 'kanzlei' || r.c.client_id) ? `${tickets.siteBase()}/vertrag.html?id=${r.k.id}` : null;
  const buttons = [
    ...(r.canSign ? [{ type: 2, style: 3, label: 'Jetzt unterschreiben', emoji: { name: '✍️' }, custom_id: `ksign:sign:${r.k.id}` }] : []),
    ...(portal ? [{ type: 2, style: 5, label: 'Druckansicht im Portal', url: portal }] : []),
  ];
  const card = (o) => bot.respond(o).data.embeds[0];
  const embeds = view.parts.map((text, i) =>
    card({ title: i === 0 ? `📝 ${r.k.template_name} · ${r.c.case_number}` : undefined, description: text, color: COLORS.gold, ...(i === view.parts.length - 1 ? { fields: [{ name: 'Unterschriften', value: view.status || '—' }] } : {}) })
  );
  return {
    type: 4,
    data: {
      embeds,
      ...(buttons.length ? { components: [{ type: 1, components: buttons }] } : {}),
      flags: 64,
      allowed_mentions: { parse: [] },
    },
  };
}

const TICKET_LABEL = { case: 'Akte', application: 'Bewerbung', concern: 'Anliegen' };
const ticketName = (t) => `${TICKET_LABEL[t.kind]} ${t.kind === 'case' ? t.row.case_number : t.kind === 'application' ? t.row.number : t.row.reference || ''}`.trim();

/** Darf die Person dieses Ticket verwalten (/add, /remove, /delete)? Liefert eine Fehlerantwort oder null. */
function ticketPermission(t, u) {
  // Rechte wie im Dashboard: Akte → zuständige Anwälte und Board of Partners; Board-Tickets → Board of Partners
  if (t.kind === 'case') {
    if (!isStaff(u) || !(caseAccess(t.row, u).canEdit || isBoard(u))) return fail('Das können die zuständigen Anwälte und das Board of Partners.', 'Keine Berechtigung');
  } else if (!isBoard(u)) {
    return fail('Nur für das Board of Partners.', 'Keine Berechtigung');
  }
  return null;
}

/** /add @person bzw. /remove @person im Ticket-Kanal. */
function handleAddRemove(body, u, actorId) {
  const name = body.data.name;
  const t = tickets.ticketByChannel(String(body.channel_id || ''));
  if (!t || !t.row) return fail('/add und /remove funktionieren nur in Ticket-Kanälen (Akten, Bewerbungen, Anliegen).', 'Kein Ticket-Kanal');
  const denied = ticketPermission(t, u);
  if (denied) return denied;
  const targetId = String((body.data.options || []).find((o) => o.name === 'person')?.value || '');
  const target = body.data.resolved?.users?.[targetId];
  if (!tickets.isId(targetId) || !target) return fail('Bitte eine Person auswählen.');
  if (target.bot) return fail('Bots können nicht hinzugefügt werden.');
  const who = target.global_name || target.username || targetId;
  const fixed = tickets.fixedMemberRole(t.kind, t.row, targetId);
  const extras = tickets.extraMembers(t.row);

  if (name === 'add') {
    if (!body.data.resolved?.members?.[targetId]) return fail(`**${who}** ist nicht auf diesem Discord-Server – bitte zuerst einladen.`);
    if (fixed) return info(`**${who}** ist bereits im Ticket (${fixed}).`, 'Schon dabei');
    if (extras.includes(targetId)) return info(`**${who}** ist bereits hinzugefügt.`, 'Schon dabei');
    tickets.markMember(targetId);
    tickets.setExtra(t.kind, t.row.id, targetId, true);
    tickets.syncTicket(t.kind, t.row.id);
    logActivity(u, 'Discord-Ticket: Person hinzugefügt', t.kind, t.row.id, `${ticketName(t)}: ${who}`);
    return bot.respond(
      { title: '➕ Person hinzugefügt', description: `<@${targetId}> wurde von <@${actorId}> zum Ticket hinzugefügt.`, color: COLORS.green, footer: `${ticketName(t)} · Pake & Scha Legal Consulting` },
      { ephemeral: false, content: `<@${targetId}>`, users: [targetId] } // nur die hinzugefügte Person wird gepingt
    );
  }

  if (!extras.includes(targetId)) {
    return info(fixed ? `**${who}** gehört als ${fixed} fest zum Ticket – das ändert ihr über die Website.` : `**${who}** wurde nicht per /add hinzugefügt.`, 'Nicht entfernt');
  }
  tickets.setExtra(t.kind, t.row.id, targetId, false);
  tickets.syncTicket(t.kind, t.row.id);
  logActivity(u, 'Discord-Ticket: Person entfernt', t.kind, t.row.id, `${ticketName(t)}: ${who}`);
  return bot.respond(
    {
      title: '➖ Person entfernt',
      description: fixed ? `<@${targetId}> ist nicht mehr zusätzlich eingetragen, bleibt aber als ${fixed} im Ticket.` : `<@${targetId}> wurde von <@${actorId}> aus dem Ticket entfernt.`,
      color: COLORS.slate,
      footer: `${ticketName(t)} · Pake & Scha Legal Consulting`,
    },
    { ephemeral: false }
  );
}

/* /delete: erst Rückfrage (nur für die Person sichtbar), dann löschen. Der Grund wartet kurz im Speicher. */
const pendingDelete = new Map(); // `${kind}:${id}:${discordId}` → { reason, until }

function handleDelete(body, u, actorId) {
  const t = tickets.ticketByChannel(String(body.channel_id || ''));
  if (!t || !t.row) return fail('/delete funktioniert nur in Ticket-Kanälen (Akten, Bewerbungen, Anliegen).', 'Kein Ticket-Kanal');
  const denied = ticketPermission(t, u);
  if (denied) return denied;
  const reason = String((body.data.options || []).find((o) => o.name === 'grund')?.value || '').trim().slice(0, 200);
  for (const [k, v] of pendingDelete) if (v.until < Date.now()) pendingDelete.delete(k); // alte Rückfragen vergessen
  pendingDelete.set(`${t.kind}:${t.row.id}:${actorId}`, { reason, until: Date.now() + 5 * 60 * 1000 });
  return confirm(
    '🗑️ Ticket löschen?',
    `Der Kanal zu **${ticketName(t)}** wird endgültig gelöscht – der Verlauf in Discord ist danach weg.\n\n${
      t.kind === 'case' ? 'Die Akte selbst bleibt erhalten. Ein neues Ticket gibt es nur, wenn es im Dashboard über „Ticket anlegen“ angelegt wird.' : 'Die Bewerbung bzw. das Anliegen bleibt erhalten; neu anlegen geht im Dashboard.'
    }${reason ? `\n\n**Grund:** ${reason}` : ''}`,
    [{ type: 1, components: [{ type: 2, style: 4, label: 'Ja, Ticket löschen', emoji: { name: '🗑️' }, custom_id: `tdel:${t.kind}:${t.row.id}` }] }]
  );
}

function confirmDelete(kind, id, u, actorId, channelId) {
  const t = tickets.ticketByChannel(channelId);
  if (!t || t.kind !== kind || t.row.id !== id) return replaceWith({ title: 'ℹ️ Nicht mehr möglich', description: 'Dieses Ticket gibt es nicht mehr.', color: COLORS.slate });
  const denied = ticketPermission(t, u);
  if (denied) return denied;
  const key = `${kind}:${id}:${actorId}`;
  const pending = pendingDelete.get(key);
  pendingDelete.delete(key);
  const reason = pending && pending.until > Date.now() ? pending.reason : '';
  tickets.deleteTicket(kind, id, { by: u.display_name, reason });
  const name = ticketName(t);
  if (kind === 'case') addSystemNote(id, u, `Discord-Ticket gelöscht (über Discord)${reason ? ` – Grund: ${reason}` : ''}.`, true);
  logActivity(u, 'Discord-Ticket gelöscht', kind, id, `${name}${reason ? ` · ${reason}` : ''}`);
  return replaceWith({ title: '🗑️ Ticket wird gelöscht', description: `Der Kanal zu **${name}** verschwindet in wenigen Sekunden.`, color: COLORS.red });
}

router.post('/', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  if (!verified(req)) return res.status(401).send('invalid request signature');
  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  if (body.type === 1) return res.json({ type: 1 }); // PING (Prüfung durch Discord)
  if (![2, 3, 5].includes(body.type)) return res.json(fail('Diese Aktion wird nicht unterstützt.'));

  try {
    if (String(body.guild_id || '') !== tickets.config().guildId) return res.json(fail('Dieser Server ist nicht für den Kanzlei-Bot eingerichtet.'));
    const discordId = String(body.member?.user?.id || body.user?.id || '');
    const u = tickets.isId(discordId) ? db.prepare('SELECT * FROM users WHERE discord_id = ? AND active = 1').get(discordId) : null;

    if (body.type === 2) {
      // Slash-Command
      const name = body.data?.name;
      if (Object.hasOwn(bot.commands, name)) return res.json(bot.commands[name](body, u, discordId)); // prüfen selbst, ob ein Konto nötig ist
      if (!u) return res.json(fail(NOT_LINKED, 'Kein verknüpftes Konto'));
      if (name === 'add' || name === 'remove') return res.json(handleAddRemove(body, u, discordId));
      if (name === 'delete') return res.json(handleDelete(body, u, discordId));
      return res.json(fail('Unbekannter Befehl.'));
    }

    const [kind, action, idText] = String(body.data?.custom_id || '').split(':');
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return res.json(fail('Unbekannter Button.'));
    const channelId = String(body.channel_id || body.channel?.id || '');
    // Vertrag lesen/unterschreiben: auch ohne Website-Konto (der Mandant zählt über sein Discord im Ticket)
    if (kind === 'ksign') return res.json(handleContract(action, id, body, discordId, channelId));
    if (body.type === 5) return res.json(fail('Unbekanntes Formular.'));
    if (!u) return res.json(fail(`${NOT_LINKED} Danach erneut klicken.`, 'Kein verknüpftes Konto'));
    if (kind === 'case') return res.json(handleCase(action, id, u, channelId));
    if (kind === 'concern') return res.json(handleConcern(action, id, u, channelId));
    if (kind === 'tdel' && ['case', 'application', 'concern'].includes(action)) return res.json(confirmDelete(action, id, u, discordId, channelId));
    return res.json(fail('Unbekannter Button.'));
  } catch (err) {
    console.warn('Discord-Interaktion fehlgeschlagen:', err.message);
    return res.json(fail('Das hat nicht geklappt – bitte im Dashboard erledigen.', 'Fehler'));
  }
});

module.exports = router;
