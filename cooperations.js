'use strict';
/*
 * Kooperationen: Rabatt auf Rechnungen für Mitglieder eines Kooperationspartners (z. B. eines Unternehmens).
 *
 * Wer gehört dazu?
 *  - Discord-Rolle: Der Bot liest die Rollen des Mandanten auf dem Discord-Server (Standard: der Server aus
 *    „Discord-Tickets“, je Kooperation auch ein anderer Server, auf dem der Bot ist). Hat der Mandant eine der
 *    eingestellten Rollen, ist die Kooperation erkannt. Discord-IDs des Mandanten: sein verknüpftes Discord-Konto,
 *    bei Akten ohne Konto das Discord aus „Discord-Ticket beitreten“.
 *  - Von Hand: Das Board of Partners ordnet Mandantenkonten einer Kooperation zu (ohne Discord).
 *
 * Der Bot-Token (DISCORD_BOT_TOKEN) bleibt auf dem Server; gelesen werden nur Rollen einzelner Mitglieder
 * (GET /guilds/{id}/members/{user}) und die Rollenliste des Servers – dafür braucht der Bot keine Sonderrechte.
 */
const { db } = require('./db');
const tickets = require('./tickets');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const splitIds = (s) =>
  String(s || '')
    .split(/[\s,;]+/)
    .filter(tickets.isId);

/** Server, auf dem die Rollen einer Kooperation gelesen werden. */
const guildOf = (k) => (tickets.isId(k.guild_id) ? k.guild_id : tickets.config().guildId);

/** Kooperation gilt gerade (aktiv und nicht abgelaufen)? */
const isValid = (k) => !!k.active && (!k.valid_until || k.valid_until >= today());

/* ---------------------------------------------------------------- Discord (mit kurzem Zwischenspeicher) */
const roleCache = new Map(); // guildId → { until, roles: [{ id, name, color, position }] }
const memberRoleCache = new Map(); // guildId:userId → { until, roles: [id] | null }

async function guildRoles(guildId, { fresh = false } = {}) {
  if (!tickets.hasToken()) throw new Error('Kein Bot-Token hinterlegt (DISCORD_BOT_TOKEN auf dem Server setzen).');
  if (!tickets.isId(guildId)) throw new Error('Keine Discord-Server-ID – unter Einstellungen → Discord-Bot → Tickets den Server eintragen oder bei der Kooperation angeben.');
  const hit = roleCache.get(guildId);
  if (!fresh && hit && hit.until > Date.now()) return hit.roles;
  const list = await tickets.rest('GET', `/guilds/${guildId}/roles`);
  const roles = (list || [])
    .filter((r) => r.name !== '@everyone' && !r.managed) // Bot-/Integrationsrollen weglassen
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: String(r.id), name: r.name, color: r.color || 0 }));
  roleCache.set(guildId, { until: Date.now() + 10 * 60 * 1000, roles });
  return roles;
}

/** Rollen einer Person auf dem Server; null = nicht auf dem Server. */
async function memberRoles(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const hit = memberRoleCache.get(key);
  if (hit && hit.until > Date.now()) return hit.roles;
  let roles;
  try {
    const m = await tickets.rest('GET', `/guilds/${guildId}/members/${userId}`);
    roles = (m && m.roles ? m.roles : []).map(String);
  } catch (err) {
    if (err.status !== 404) throw err;
    roles = null;
  }
  memberRoleCache.set(key, { until: Date.now() + 2 * 60 * 1000, roles });
  return roles;
}

/* ---------------------------------------------------------------- Erkennung */
/**
 * Welche Kooperationen gelten für diese Person?
 * who: { userId?, discordIds?: [] } → { matches: [{ id, name, discountPct, via, detail }], best, notes: [] }
 * via: 'discord' (Rolle erkannt) | 'konto' (von Hand zugeordnet). notes: Hinweise für das Team (z. B. Bot fehlt).
 */
async function detect({ userId = null, discordIds = [] } = {}) {
  const coops = db.prepare('SELECT * FROM cooperations ORDER BY discount_pct DESC, name').all().filter(isValid);
  const matches = new Map();
  const notes = [];
  if (!coops.length) return { matches: [], best: null, notes, checkedDiscord: false };

  if (userId) {
    const manual = new Set(db.prepare('SELECT cooperation_id FROM cooperation_members WHERE user_id = ?').all(userId).map((r) => r.cooperation_id));
    for (const k of coops) if (manual.has(k.id)) matches.set(k.id, { k, via: 'konto', detail: 'Konto von Hand zugeordnet' });
  }

  const ids = [...new Set(discordIds.filter(tickets.isId))];
  const withRoles = coops.filter((k) => splitIds(k.role_ids).length && !matches.has(k.id));
  let checkedDiscord = false;
  if (withRoles.length) {
    if (!ids.length) {
      notes.push(
        userId
          ? 'Der Mandant hat sein Discord-Konto noch nicht verknüpft (Mein Profil → Discord verbinden) – Discord-Rollen nicht prüfbar.'
          : 'Kein Discord-Konto bekannt (Mandant ohne Website-Konto) – Discord-Rollen nicht prüfbar. Kooperation bei Bedarf von Hand wählen.'
      );
    }
    else if (!tickets.hasToken()) notes.push('Discord-Rollen werden nicht geprüft: Es ist kein Bot-Token hinterlegt.');
    else {
      const byGuild = new Map();
      for (const k of withRoles) {
        const g = guildOf(k);
        if (!tickets.isId(g)) {
          notes.push(`„${k.name}“: kein Discord-Server eingestellt.`);
          continue;
        }
        if (!byGuild.has(g)) byGuild.set(g, []);
        byGuild.get(g).push(k);
      }
      for (const [g, list] of byGuild) {
        let roles = [];
        let onServer = false;
        try {
          for (const id of ids) {
            const r = await memberRoles(g, id);
            if (r) {
              onServer = true;
              roles.push(...r);
            }
          }
          checkedDiscord = true;
        } catch (err) {
          notes.push(`Discord-Rollen konnten nicht gelesen werden (${list.map((k) => k.name).join(', ')}): ${err.message}`);
          continue;
        }
        if (!onServer) {
          notes.push(`Der Mandant ist nicht auf dem Discord-Server${byGuild.size > 1 ? ` von „${list[0].name}“` : ''} – Rollen nicht prüfbar.`);
          continue;
        }
        roles = new Set(roles);
        let names = [];
        try {
          names = await guildRoles(g);
        } catch {
          names = [];
        }
        for (const k of list) {
          const hit = splitIds(k.role_ids).find((r) => roles.has(r));
          if (hit) {
            const name = names.find((r) => r.id === hit)?.name;
            matches.set(k.id, { k, via: 'discord', detail: name ? `Discord-Rolle „${name}“` : 'Discord-Rolle' });
          }
        }
      }
    }
  }

  const list = [...matches.values()]
    .map(({ k, via, detail }) => ({ id: k.id, name: k.name, discountPct: k.discount_pct, via, detail }))
    .sort((a, b) => b.discountPct - a.discountPct);
  return { matches: list, best: list[0] || null, notes, checkedDiscord };
}

/** Kooperationen für die Person hinter einer Akte (Konto und/oder Discord aus „Ticket beitreten“). */
function detectForCase(c) {
  const acc = c.client_id ? db.prepare('SELECT id, discord_id FROM users WHERE id = ?').get(c.client_id) : null;
  return detect({ userId: acc ? acc.id : null, discordIds: [acc && acc.discord_id, c.discord_client_id].filter(Boolean) });
}

function detectForUser(userId) {
  const u = db.prepare('SELECT id, discord_id FROM users WHERE id = ?').get(userId);
  return u ? detect({ userId: u.id, discordIds: [u.discord_id].filter(Boolean) }) : Promise.resolve({ matches: [], best: null, notes: [], checkedDiscord: false });
}

module.exports = { detect, detectForCase, detectForUser, guildRoles, guildOf, isValid, splitIds, today };
