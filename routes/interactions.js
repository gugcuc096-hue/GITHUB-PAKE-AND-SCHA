'use strict';
/*
 * Discord-Interaktionen: Klicks auf die Buttons im Ticket (Akte übernehmen, Akte schließen, Wieder öffnen,
 * Anliegen erledigt). Discord schickt jeden Klick per HTTP an diese Adresse – eingetragen im Developer
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
const { getCase, caseAccess } = require('../models');
const tickets = require('../tickets');
const cases = require('./cases');
const concerns = require('./concerns');

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

/** Nur für die klickende Person sichtbare Antwort. */
const ephemeral = (content, components) => ({ type: 4, data: { content, flags: 64, ...(components ? { components } : {}) } });
/** Die (nur für sie sichtbare) Rückfrage ersetzen. */
const update = (content) => ({ type: 7, data: { content, components: [] } });

const NOT_LINKED =
  'Dein Discord-Konto ist mit keinem Konto der Kanzlei-Website verknüpft. Bitte im Dashboard unter „Mein Profil“ → „Discord verbinden“ verknüpfen und dann erneut klicken.';

function handleCase(action, id, u, channelId) {
  const c = getCase(id);
  if (!c || c.discord_channel_id !== channelId) return ephemeral('Dieses Ticket gehört zu keiner (bestehenden) Akte mehr.');
  if (!isStaff(u)) return ephemeral('Diese Buttons sind für die Kanzlei. Bei Fragen schreiben Sie einfach hier in den Kanal.');
  const access = caseAccess(c, u);
  const via = ' (über Discord)';
  if (action === 'claim') {
    if (c.status === 'geschlossen') return ephemeral('Die Akte ist geschlossen.');
    if (c.lawyer_id) return ephemeral(`Die Akte hat bereits einen federführenden Anwalt (${c.lawyer_name || '—'}).`);
    cases.claimCase(c, u, via);
    return ephemeral(`✅ Du hast die Akte ${c.case_number} übernommen.`);
  }
  if (!access.canEdit) return ephemeral('Schließen und wieder öffnen können nur die zuständigen Anwälte und das Board of Partners.');
  if (action === 'close') {
    if (c.status === 'geschlossen') return ephemeral('Die Akte ist bereits geschlossen.');
    return ephemeral(`Akte **${c.case_number}** wirklich schließen? Das Ticket wandert ins Archiv, der Mandant kann dann nur noch lesen.`, [
      { type: 1, components: [{ type: 2, style: 4, label: 'Ja, Akte schließen', custom_id: `case:closeok:${c.id}` }] },
    ]);
  }
  if (action === 'closeok') {
    if (c.status === 'geschlossen') return update('Die Akte ist bereits geschlossen.');
    cases.setCaseStatus(c, u, 'geschlossen', via);
    return update(`🔒 Akte ${c.case_number} geschlossen.`);
  }
  if (action === 'reopen') {
    if (c.status !== 'geschlossen') return ephemeral('Die Akte ist nicht geschlossen.');
    cases.setCaseStatus(c, u, c.lawyer_id ? 'in_bearbeitung' : 'offen', via);
    return ephemeral(`🔓 Akte ${c.case_number} wieder geöffnet.`);
  }
  return ephemeral('Unbekannte Aktion.');
}

function handleConcern(action, id, u, channelId) {
  const k = db.prepare(`${concerns.SELECT} WHERE k.id = ?`).get(id);
  if (!k || k.discord_channel_id !== channelId) return ephemeral('Dieses Ticket gehört zu keinem (bestehenden) Anliegen mehr.');
  if (!isBoard(u)) return ephemeral('Nur für das Board of Partners.');
  const status = action === 'done' ? 'erledigt' : action === 'reopen' ? 'in_bearbeitung' : null;
  if (!status) return ephemeral('Unbekannte Aktion.');
  const r = concerns.changeConcern(k, u, { status }, ' über Discord');
  if (r.error) return ephemeral(r.error);
  if (!r.changed) return ephemeral('Keine Änderung – das Anliegen hat diesen Status bereits.');
  return ephemeral(status === 'erledigt' ? `✅ Anliegen ${k.reference} als erledigt markiert.` : `🔓 Anliegen ${k.reference} wieder geöffnet.`);
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
  if (body.type !== 3) return res.json(ephemeral('Diese Aktion wird nicht unterstützt.'));

  try {
    const [kind, action, idText] = String(body.data?.custom_id || '').split(':');
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return res.json(ephemeral('Unbekannter Button.'));
    if (String(body.guild_id || '') !== tickets.config().guildId) return res.json(ephemeral('Dieser Server ist nicht für die Kanzlei-Tickets eingerichtet.'));
    const discordId = String(body.member?.user?.id || body.user?.id || '');
    const u = tickets.isId(discordId) ? db.prepare('SELECT * FROM users WHERE discord_id = ? AND active = 1').get(discordId) : null;
    if (!u) return res.json(ephemeral(NOT_LINKED));
    const channelId = String(body.channel_id || body.channel?.id || '');
    if (kind === 'case') return res.json(handleCase(action, id, u, channelId));
    if (kind === 'concern') return res.json(handleConcern(action, id, u, channelId));
    return res.json(ephemeral('Unbekannter Button.'));
  } catch (err) {
    console.warn('Discord-Interaktion fehlgeschlagen:', err.message);
    return res.json(ephemeral('Das hat nicht geklappt – bitte im Dashboard erledigen.'));
  }
});

module.exports = router;
