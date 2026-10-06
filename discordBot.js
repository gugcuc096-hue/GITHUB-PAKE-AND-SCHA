'use strict';
/*
 * Kanzlei-Bot (Discord): dauerhafte Gateway-Verbindung und Server-Module – wie Sapphire, aber im eigenen Bot.
 *
 *  - Rang-Sync: Rang/Rolle auf der Website → Discord-Rollen (nur Konten mit verknüpftem Discord).
 *    Beförderung, Rückstufung, Deaktivierung, Verknüpfen/Trennen wirken sofort; zusätzlich alle 10 Minuten ein Abgleich.
 *  - Role Connections: Rolle X wird automatisch vergeben (und entfernt), wenn die Bedingungen zutreffen
 *    (Mitglied hat / hat nicht Rolle Y; verknüpft mit ODER bzw. UND). Regeln dürfen aufeinander aufbauen.
 *  - Join Roles: Rollen für neue Mitglieder bzw. Bots – sofort, verzögert oder erst nach Bestätigung der Serverregeln.
 *  - Willkommen & Abschied: Nachricht im Kanal (Text + Embed), optional Direktnachricht.
 *
 * Server = Server-ID aus den Discord-Ticket-Einstellungen. Token nur aus DISCORD_BOT_TOKEN (nie in der Datenbank,
 * nie im Frontend). Für Beitritte und Rollenänderungen braucht der Bot im Discord Developer Portal → Bot den
 * privilegierten „SERVER MEMBERS INTENT“; ohne ihn verweigert Discord die Verbindung (Status zeigt das an).
 * Alle Rollenänderungen laufen nacheinander in einer Warteschlange und stehen mit Grund im Discord-Audit-Log.
 */
const { db, getSetting, setSetting } = require('./db');
const { ASSOCIATE_RANKS, isBoard, truncate } = require('./helpers');
const tickets = require('./tickets');

const { isId } = tickets;
const botMessages = require('./botMessages');
// GUILDS + GUILD_MEMBERS (privilegiert); GUILD_MESSAGES nur, wenn eine „alle X Nachrichten“-Automatik aktiv ist
const intents = () => (1 << 0) | (1 << 1) | (botMessages.hasMessageJobs() ? 1 << 9 : 0);
const SCAN_EVERY = 10 * 60 * 1000;
const MAX_RULES = 25;
const MAX_CONDITIONS = 10;
const REASON = 'Pake & Scha Bot: Rollen-Automatik';

const guildId = () => tickets.config().guildId;
const now = () => new Date().toISOString();

/* ================================================================ Einstellungen */
function readJson(key) {
  try {
    const v = JSON.parse(getSetting(key, '') || 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
const saveJson = (key, value) => setSetting(key, JSON.stringify(value));

/** Rang-Sync: je Website-Rang bzw. Gruppe eine Discord-Rolle. strict: auch Mitglieder ohne verknüpftes Konto bereinigen. */
function rankSyncConfig() {
  const c = readJson('bot_rank_sync');
  return {
    enabled: !!c.enabled,
    ranks: c.ranks && typeof c.ranks === 'object' ? { ...c.ranks } : {},
    staff: c.staff || '',
    board: c.board || '',
    associates: c.associates || '',
    client: c.client || '',
    strict: !!c.strict,
  };
}

/** Role Connections: [{ id, roleId, mode: 'or'|'and', conditions: [{ has, roleId }] }] */
function connectionsConfig() {
  const c = readJson('bot_role_connections');
  return { enabled: !!c.enabled, rules: Array.isArray(c.rules) ? c.rules : [] };
}

const EMBED_DEFAULT = { enabled: false, title: '', description: '', color: '#d4af37', thumbnail: 'avatar', image: '', footer: '', timestamp: true };
const WELCOME_DEFAULT = {
  enabled: false,
  channelId: '',
  content: 'Willkommen {user} auf **{server}**!',
  embed: {
    ...EMBED_DEFAULT,
    enabled: true,
    title: 'Willkommen bei Pake & Scha',
    description: 'Schön, dass du da bist, **{user.name}**!\nDu bist Mitglied Nr. **{membercount}**.\n\nMandat anfragen und Akten einsehen: {website}',
    footer: 'Pake & Scha Legal Consulting',
  },
  dm: { enabled: false, content: '', embed: { ...EMBED_DEFAULT, enabled: true, title: 'Willkommen bei Pake & Scha', description: 'Hallo {user.name}, schön, dass du auf **{server}** bist!' } },
  leave: { enabled: false, channelId: '', content: '**{user.name}** hat den Server verlassen.', embed: { ...EMBED_DEFAULT } },
  since: null,
};
function welcomeConfig() {
  const c = readJson('bot_welcome');
  const part = (def, v) => ({ ...def, ...(v || {}), embed: { ...def.embed, ...((v && v.embed) || {}) } });
  return {
    ...WELCOME_DEFAULT,
    ...c,
    embed: { ...WELCOME_DEFAULT.embed, ...(c.embed || {}) },
    dm: part(WELCOME_DEFAULT.dm, c.dm),
    leave: part(WELCOME_DEFAULT.leave, c.leave),
  };
}

/** Join Roles: Rollen für neue Mitglieder (humans) bzw. Bots, optional verzögert und erst nach Regel-Bestätigung. */
const MAX_JOIN_ROLES = 10;
function joinRolesConfig() {
  const c = readJson('bot_join_roles');
  const ids = (v) => (Array.isArray(v) ? v.filter(isId).slice(0, MAX_JOIN_ROLES) : []);
  const delay = Number(c.delayMinutes);
  return {
    enabled: !!c.enabled,
    humans: ids(c.humans),
    bots: ids(c.bots),
    delayMinutes: Number.isInteger(delay) && delay >= 0 && delay <= 1440 ? delay : 0,
    waitScreening: c.waitScreening !== false,
    since: c.since || null,
    // Standardrollen: jedes Mitglied hat sie dauerhaft (auch bisherige; werden zurückgegeben, wenn jemand sie entfernt)
    alwaysEnabled: !!c.alwaysEnabled,
    always: ids(c.always),
    alwaysBots: !!c.alwaysBots,
  };
}
/** Standardrollen, die ein Mitglied haben muss (leer, wenn aus). */
function alwaysRoles(isBot = false) {
  const jr = joinRolesConfig();
  return jr.alwaysEnabled && (!isBot || jr.alwaysBots) ? jr.always : [];
}

/** Frühere „Rollen beim Beitritt“ aus dem Willkommens-Modul einmalig in Join Roles übernehmen. */
function migrateJoinRoles() {
  if (getSetting('bot_join_roles', '')) return;
  const w = readJson('bot_welcome');
  const roles = Array.isArray(w.joinRoles) ? w.joinRoles.filter(isId) : [];
  if (!roles.length) return;
  saveJson('bot_join_roles', { enabled: !!w.enabled, humans: roles, bots: [], delayMinutes: 0, waitScreening: false, since: w.since || now() });
  saveJson('bot_welcome', { ...w, joinRoles: [] });
}

const anyRoleModule = () => rankSyncConfig().enabled || connectionsConfig().enabled || alwaysRoles().length > 0;
const wanted = () =>
  tickets.hasToken() && isId(guildId()) && (anyRoleModule() || welcomeConfig().enabled || joinRolesConfig().enabled || botMessages.hasMessageJobs());

/* ================================================================ Warteschlange & Fehler */
let chain = Promise.resolve();
const lastErrors = [];
function noteError(err, where = '') {
  const message = `${where ? where + ': ' : ''}${err && err.message ? err.message : String(err)}`;
  lastErrors.unshift({ at: now(), message: truncate(message, 300) });
  lastErrors.length = Math.min(lastErrors.length, 10);
  console.warn('Discord-Bot:', message);
}
/** Alles, was Rollen ändert oder Nachrichten schickt, läuft nacheinander. */
function enqueue(fn, where) {
  const run = chain.then(fn).catch((err) => noteError(err, where));
  chain = run;
  return run;
}

/* ================================================================ Rollen-Logik */
/** Alle Rollen, die der Rang-Sync verwaltet. */
function managedRoles(rs) {
  return new Set([...Object.values(rs.ranks), rs.staff, rs.board, rs.associates, rs.client].filter(isId));
}

/** Rollen, die ein Discord-Mitglied laut Website haben soll – null, wenn kein Website-Konto verknüpft ist. */
function wantedFor(discordId, rs) {
  const u = db.prepare('SELECT id, role, rank, active FROM users WHERE discord_id = ?').get(discordId);
  if (!u) return null;
  if (!u.active) return [];
  const out = new Set();
  const add = (r) => isId(r) && out.add(r);
  const staff = u.role === 'anwalt' || u.role === 'admin';
  if (staff) {
    add(rs.ranks[u.rank]);
    add(rs.staff);
    if (isBoard(u)) add(rs.board);
    if (ASSOCIATE_RANKS.includes(u.rank)) add(rs.associates);
  }
  if (u.role === 'mandant') add(rs.client);
  return [...out];
}

/** Role Connections anwenden, bis sich nichts mehr ändert (Regeln können aufeinander aufbauen). */
function evaluate(rules, roles) {
  const set = new Set(roles);
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const r of rules) {
      if (!isId(r.roleId) || !Array.isArray(r.conditions) || !r.conditions.length) continue;
      const results = r.conditions.filter((c) => isId(c.roleId)).map((c) => (c.has === false ? !set.has(c.roleId) : set.has(c.roleId)));
      if (!results.length) continue;
      const ok = r.mode === 'and' ? results.every(Boolean) : results.some(Boolean);
      if (ok && !set.has(r.roleId)) {
        set.add(r.roleId);
        changed = true;
      } else if (!ok && set.has(r.roleId)) {
        set.delete(r.roleId);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return set;
}

/**
 * Soll-Rollen eines Mitglieds aus seinen aktuellen Rollen: erst Rang-Sync, dann Role Connections.
 * forceRemove: verwaltete Rang-Rollen auch ohne verknüpftes Konto entfernen (z. B. nach „Discord trennen“).
 */
function desiredRoles(discordId, roles, { forceRemove = false } = {}) {
  let desired = new Set(roles);
  const rs = rankSyncConfig();
  if (rs.enabled) {
    const want = wantedFor(discordId, rs);
    if (want || forceRemove || rs.strict) {
      for (const r of managedRoles(rs)) desired.delete(r);
      for (const r of want || []) desired.add(r);
    }
  }
  // Standardrollen: vor den Role Connections (sie dürfen darauf aufbauen) und danach noch einmal – sie gelten immer
  for (const r of alwaysRoles()) desired.add(r);
  const rc = connectionsConfig();
  if (rc.enabled) desired = evaluate(rc.rules, desired);
  for (const r of alwaysRoles()) desired.add(r);
  desired.delete(guildId()); // @everyone
  return desired;
}

function diff(current, desired) {
  const cur = new Set(current);
  return { add: [...desired].filter((r) => !cur.has(r)), remove: [...cur].filter((r) => !desired.has(r) && r !== guildId()) };
}

/** Rollen setzen/entfernen (einzeln – verwaltete Discord-Rollen wie Booster bleiben unberührt). */
async function changeRoles(memberId, add, remove, stats) {
  const g = guildId();
  const names = roleNameCache();
  for (const [list, method] of [
    [add, 'PUT'],
    [remove, 'DELETE'],
  ]) {
    for (const r of list) {
      try {
        await tickets.rest(method, `/guilds/${g}/members/${memberId}/roles/${r}`, undefined, { reason: REASON });
        if (stats) stats[method === 'PUT' ? 'added' : 'removed']++;
      } catch (err) {
        if (method === 'DELETE' && err.status === 404) continue;
        const role = names[r] ? `„${names[r]}“` : r;
        const hint = err.code === 50013 ? ' – die Bot-Rolle muss in den Server-Einstellungen über dieser Rolle stehen.' : '';
        const e = new Error(`Rolle ${role} ${method === 'PUT' ? 'nicht vergeben' : 'nicht entfernt'} (Mitglied ${memberId}): ${err.message}${hint}`);
        noteError(e);
        if (stats) stats.errors.push(e.message);
      }
    }
  }
}

/** Ein Mitglied prüfen und Rollen angleichen. roles: aktuelle Rollen (sonst von Discord geholt). */
async function applyMember(discordId, { roles, forceRemove = false, stats } = {}) {
  if (!isId(guildId()) || !isId(discordId) || !anyRoleModule()) return null;
  if (!roles) {
    try {
      const m = await tickets.rest('GET', `/guilds/${guildId()}/members/${discordId}`);
      if (m.user && m.user.bot) return null;
      roles = m.roles || [];
    } catch (err) {
      if (err.status === 404) return null; // nicht auf dem Server
      throw err;
    }
  }
  const { add, remove } = diff(roles, desiredRoles(discordId, roles, { forceRemove }));
  if (add.length || remove.length) await changeRoles(discordId, add, remove, stats);
  return { add, remove };
}

/* Rollenänderungen aus Discord bündeln (eigene Änderungen lösen weitere Ereignisse aus). */
const pending = new Map();
function queueMember(discordId, roles, delay = 1500) {
  const p = pending.get(discordId) || {};
  clearTimeout(p.timer);
  p.roles = roles;
  p.timer = setTimeout(() => {
    pending.delete(discordId);
    enqueue(() => applyMember(discordId, { roles: p.roles }), 'Rollen-Automatik');
  }, delay);
  if (p.timer.unref) p.timer.unref();
  pending.set(discordId, p);
}

/**
 * Website-Änderung (Rang, Rolle, Aktiv, Discord verknüpft/getrennt) → sofort abgleichen.
 * previousDiscordId: vorher verknüpftes Discord (nach dem Trennen dort die Rang-Rollen entfernen).
 */
function syncUser(userId, { previousDiscordId } = {}) {
  if (!tickets.hasToken() || !isId(guildId()) || !anyRoleModule()) return;
  const u = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId);
  if (u && isId(u.discord_id)) enqueue(() => applyMember(u.discord_id), 'Rang-Sync');
  if (isId(previousDiscordId) && (!u || u.discord_id !== previousDiscordId)) {
    enqueue(() => applyMember(previousDiscordId, { forceRemove: true }), 'Rang-Sync');
  }
}

/* ================================================================ Vollständiger Abgleich */
async function listMembers() {
  const all = [];
  let after = '0';
  for (let i = 0; i < 100; i++) {
    const page = await tickets.rest('GET', `/guilds/${guildId()}/members?limit=1000&after=${after}`);
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return all;
}

let scanning = null;
/** Alle Mitglieder prüfen: Rang-Sync + Role Connections anwenden, verpasste Begrüßungen nachholen. */
function scan(trigger = 'manuell') {
  if (scanning) return scanning;
  scanning = enqueue(async () => {
    const stats = { trigger, startedAt: now(), members: 0, changed: 0, added: 0, removed: 0, welcomed: 0, errors: [] };
    try {
      const members = await listMembers();
      for (const m of members) {
        if (!m.user) continue;
        if (m.user.bot) {
          // Bots: nur Standardrollen (falls „auch für Bots“), sonst nichts
          const missing = alwaysRoles(true).filter((r) => !(m.roles || []).includes(r));
          if (missing.length) {
            stats.changed++;
            await changeRoles(m.user.id, missing, [], stats);
          }
          continue;
        }
        stats.members++;
        if (!anyRoleModule()) continue;
        const { add, remove } = diff(m.roles || [], desiredRoles(m.user.id, m.roles || []));
        if (add.length || remove.length) {
          stats.changed++;
          await changeRoles(m.user.id, add, remove, stats);
        }
      }
      await catchUpJoins(members, stats);
    } catch (err) {
      stats.error = err.code === 50001 || err.status === 403 ? `${err.message} Für die Mitgliederliste braucht der Bot den „SERVER MEMBERS INTENT“ (Developer Portal → Bot).` : err.message;
    }
    stats.finishedAt = now();
    stats.errors = stats.errors.slice(0, 10);
    saveJson('bot_last_scan', stats);
    return stats;
  }, 'Abgleich').finally(() => {
    scanning = null;
  });
  return scanning;
}

/* ================================================================ Willkommen & Abschied */
const avatarUrl = (user) =>
  user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith('a_') ? 'gif' : 'png'}?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;

let guildCache = null;
async function guildInfo(fresh = false) {
  if (!fresh && guildCache && guildCache.until > Date.now() && guildCache.id === guildId()) return guildCache.data;
  const data = await tickets.rest('GET', `/guilds/${guildId()}?with_counts=true`);
  guildCache = { id: guildId(), data, until: Date.now() + 5 * 60 * 1000 };
  return data;
}

/** Platzhalter für Willkommens-/Abschiedsnachrichten. */
const PLACEHOLDERS = {
  '{user}': 'Erwähnung des Mitglieds (@Name)',
  '{user.name}': 'Anzeigename',
  '{user.username}': 'Benutzername',
  '{user.id}': 'Discord-ID',
  '{user.avatar}': 'Profilbild-URL',
  '{server}': 'Servername',
  '{membercount}': 'Mitgliederzahl',
  '{date}': 'heutiges Datum',
  '{website}': 'Link zur Website',
};
function variables(user, guild) {
  const name = (user.global_name || user.username || 'Mitglied').replace(/[*_~`|>]/g, '\\$&');
  return {
    '{user}': `<@${user.id}>`,
    '{user.name}': name,
    '{user.username}': user.username || '',
    '{user.id}': user.id,
    '{user.avatar}': avatarUrl(user),
    '{server}': (guild && guild.name) || 'Server',
    '{membercount}': guild && guild.approximate_member_count ? String(guild.approximate_member_count) : '',
    '{date}': new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }),
    '{website}': tickets.siteBase() || '',
  };
}
const fill = (text, vars) => String(text || '').replace(/\{(?:user(?:\.(?:name|username|id|avatar))?|server|membercount|date|website)\}/g, (m) => vars[m] ?? m);
const httpsUrl = (u) => (/^https:\/\/\S+$/i.test(u) ? u : null);

function buildEmbed(e, vars, user, guild) {
  if (!e || !e.enabled) return null;
  const out = {};
  const title = fill(e.title, vars).trim();
  const description = fill(e.description, vars).trim();
  if (title) out.title = truncate(title, 256);
  if (description) out.description = truncate(description, 4000);
  const color = parseInt(String(e.color || '').replace('#', ''), 16);
  if (Number.isFinite(color)) out.color = color;
  if (e.thumbnail === 'avatar' && user) out.thumbnail = { url: avatarUrl(user) };
  else if (e.thumbnail === 'server' && guild && guild.icon) out.thumbnail = { url: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256` };
  const image = httpsUrl(fill(e.image, vars).trim());
  if (image) out.image = { url: image };
  const footer = fill(e.footer, vars).trim();
  if (footer) out.footer = { text: truncate(footer, 2048) };
  if (e.timestamp) out.timestamp = now();
  return out.title || out.description || out.image || out.thumbnail ? out : null;
}

/** Nachricht aus Text + Embed bauen; erwähnt wird höchstens das Mitglied selbst (nie @everyone/Rollen). */
function buildMessage(part, user, guild, { mention = true } = {}) {
  const vars = variables(user, guild);
  const content = truncate(fill(part.content, vars).trim(), 2000);
  const embed = buildEmbed(part.embed, vars, user, guild);
  if (!content && !embed) return null;
  return { content: content || undefined, embeds: embed ? [embed] : [], allowed_mentions: { parse: [], users: mention ? [user.id] : [] } };
}

async function sendDm(userId, payload) {
  const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: userId });
  return tickets.rest('POST', `/channels/${ch.id}/messages`, payload);
}

/**
 * Derselbe Beitritt? Discord liefert die Beitrittszeit im Live-Ereignis und beim Abruf der Mitgliederliste nicht
 * immer gleich genau (z. B. „…:01.393449+00:00“ bzw. „…:01.393000+00:00“). Als Text verglichen galt ein schon
 * begrüßter Beitritt beim Abgleich alle 10 Minuten deshalb als neu – die Willkommensnachricht kam doppelt.
 * Jetzt zählt die Zeit: weniger als eine Minute Abstand = derselbe Beitritt.
 */
const SAME_JOIN_MS = 60 * 1000;
function sameJoin(a, b) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < SAME_JOIN_MS : String(a) === String(b);
}
/** Gibt es für diesen Beitritt schon einen Eintrag (discord_welcomes bzw. discord_join_roles)? */
const joinRecorded = (table, memberId, joinedAt) => db.prepare(`SELECT joined_at FROM ${table} WHERE member_id = ?`).all(memberId).some((r) => sameJoin(r.joined_at, joinedAt));

/** Begrüßen – genau einmal je Beitritt. */
async function welcomeMember(member, joinedAt, stats) {
  const w = welcomeConfig();
  if (!w.enabled) return;
  const user = member.user;
  // Prüfen und Eintragen ohne await dazwischen – ein gleichzeitiger Abgleich kann sich nicht dazwischenschieben
  if (joinRecorded('discord_welcomes', user.id, joinedAt)) return;
  if (!db.prepare('INSERT OR IGNORE INTO discord_welcomes (member_id, joined_at) VALUES (?, ?)').run(user.id, joinedAt).changes) return;
  const guild = await guildInfo(true).catch(() => null);
  const msg = isId(w.channelId) ? buildMessage(w, user, guild) : null;
  if (msg) await tickets.rest('POST', `/channels/${w.channelId}/messages`, msg).catch((err) => noteError(err, 'Willkommensnachricht'));
  const dm = w.dm.enabled ? buildMessage(w.dm, user, guild, { mention: false }) : null;
  if (dm) await sendDm(user.id, dm).catch(() => {}); // DMs geschlossen → still
  if (stats) stats.welcomed++;
}

const markJoinDone = (memberId, joinedAt, result) =>
  db.prepare('UPDATE discord_join_roles SET done_at = ?, result = ? WHERE member_id = ? AND joined_at = ?').run(now(), result, memberId, joinedAt);

/**
 * Join Roles für einen Beitritt vormerken (einmal je Beitritt). Liefert die Rollen, die sofort mitvergeben
 * werden können – sonst [] (dann später über die Warteschlange: Verzögerung bzw. Regel-Bestätigung).
 */
function queueJoinRoles(member, joinedAt) {
  const jr = joinRolesConfig();
  const list = jr.enabled ? (member.user.bot ? jr.bots : jr.humans) : [];
  if (!list.length) return [];
  const due = new Date((Date.parse(joinedAt) || Date.now()) + jr.delayMinutes * 60e3).toISOString();
  const fresh =
    !joinRecorded('discord_join_roles', member.user.id, joinedAt) &&
    db.prepare('INSERT OR IGNORE INTO discord_join_roles (member_id, joined_at, is_bot, due_at) VALUES (?, ?, ?, ?)').run(member.user.id, joinedAt, member.user.bot ? 1 : 0, due).changes > 0;
  if (!fresh || Date.parse(due) > Date.now() || (jr.waitScreening && member.pending)) return [];
  markJoinDone(member.user.id, joinedAt, 'beim Beitritt vergeben');
  return list;
}

/**
 * Neues Mitglied: begrüßen, Join Roles (sofort oder vorgemerkt), dazu Rang-Sync und Role Connections –
 * alle Rollen in einem Schritt. opts.welcome / opts.join: beim Nachholen nur den jeweils fälligen Teil.
 */
async function handleJoin(member, stats, { welcome = true, join = true } = {}) {
  const user = member.user;
  if (!user) return;
  const joinedAt = member.joined_at || now();
  if (welcome && !user.bot) await welcomeMember(member, joinedAt, stats);
  const joinNow = join ? queueJoinRoles(member, joinedAt) : [];
  const base = member.roles || [];
  const withJoin = [...new Set([...base, ...joinNow])];
  const desired = !user.bot && anyRoleModule() ? desiredRoles(user.id, withJoin) : new Set([...withJoin, ...(user.bot ? alwaysRoles(true) : [])]);
  const { add, remove } = diff(base, desired);
  if (add.length || remove.length) await changeRoles(user.id, add, remove, stats);
}

/**
 * Fällige Join Roles vergeben (Verzögerung abgelaufen, Regeln bestätigt). memberId: nur dieses Mitglied
 * (z. B. direkt nach der Regel-Bestätigung). Wer die Regeln nach 7 Tagen nicht bestätigt hat, fällt heraus.
 */
async function processJoinQueue({ memberId = null, stats = null } = {}) {
  const jr = joinRolesConfig();
  if (!jr.enabled || !tickets.hasToken() || !isId(guildId())) return;
  const recheck = new Date(Date.now() - 60e3).toISOString();
  const rows = memberId
    ? db.prepare('SELECT * FROM discord_join_roles WHERE member_id = ? AND done_at IS NULL AND due_at <= ?').all(memberId, now())
    : db
        .prepare('SELECT * FROM discord_join_roles WHERE done_at IS NULL AND due_at <= ? AND (checked_at IS NULL OR checked_at <= ?) ORDER BY due_at LIMIT 50')
        .all(now(), recheck);
  for (const r of rows) {
    let m;
    try {
      m = await tickets.rest('GET', `/guilds/${guildId()}/members/${r.member_id}`);
    } catch (err) {
      if (err.status === 404) {
        markJoinDone(r.member_id, r.joined_at, 'nicht mehr auf dem Server');
        continue;
      }
      throw err;
    }
    if (m.joined_at && !sameJoin(m.joined_at, r.joined_at)) {
      markJoinDone(r.member_id, r.joined_at, 'erneut beigetreten');
      continue;
    }
    if (jr.waitScreening && m.pending) {
      if (Date.now() - Date.parse(r.joined_at) > 7 * 24 * 3600e3) markJoinDone(r.member_id, r.joined_at, 'Regeln nach 7 Tagen nicht bestätigt');
      else db.prepare('UPDATE discord_join_roles SET checked_at = ? WHERE member_id = ? AND joined_at = ?').run(now(), r.member_id, r.joined_at);
      continue;
    }
    const base = m.roles || [];
    const withJoin = [...new Set([...base, ...(r.is_bot ? jr.bots : jr.humans)])];
    const desired = !r.is_bot && anyRoleModule() ? desiredRoles(r.member_id, withJoin) : new Set(withJoin);
    const { add, remove } = diff(base, desired);
    if (add.length || remove.length) await changeRoles(r.member_id, add, remove, stats);
    markJoinDone(r.member_id, r.joined_at, 'vergeben');
  }
}
const joinQueueDue = () =>
  joinRolesConfig().enabled &&
  !!db.prepare('SELECT 1 FROM discord_join_roles WHERE done_at IS NULL AND due_at <= ? AND (checked_at IS NULL OR checked_at <= ?) LIMIT 1').get(now(), new Date(Date.now() - 60e3).toISOString());

/** Beim Abgleich: Beitritte der letzten 24 h (seit dem Einschalten) nachholen, falls der Bot offline war. */
async function catchUpJoins(members, stats) {
  const w = welcomeConfig();
  const jr = joinRolesConfig();
  const from = (on, since) => (on && since ? Math.max(Date.parse(since) || 0, Date.now() - 24 * 3600e3) : Infinity);
  const fromWelcome = from(w.enabled, w.since);
  const fromJoin = from(jr.enabled, jr.since);
  if (fromWelcome === Infinity && fromJoin === Infinity) return;
  for (const m of members) {
    if (!m.user || !m.joined_at) continue;
    const t = Date.parse(m.joined_at);
    const welcome = !m.user.bot && t > fromWelcome && !joinRecorded('discord_welcomes', m.user.id, m.joined_at);
    const join = t > fromJoin && !joinRecorded('discord_join_roles', m.user.id, m.joined_at);
    if (welcome || join) await handleJoin(m, stats, { welcome, join });
  }
  await processJoinQueue({ stats });
}

/** Join Roles an alle bisherigen Mitglieder (target: humans | bots) – nur fehlende Rollen, nie entfernen. */
function joinRolesToAll(target = 'humans') {
  return enqueue(async () => {
    const jr = joinRolesConfig();
    const stats = { members: 0, changed: 0, added: 0, removed: 0, skipped: 0, errors: [] };
    try {
      for (const m of await listMembers()) {
        if (!m.user || !!m.user.bot !== (target === 'bots')) continue;
        if (jr.waitScreening && m.pending) {
          stats.skipped++;
          continue;
        }
        stats.members++;
        const missing = (target === 'bots' ? jr.bots : jr.humans).filter((r) => !(m.roles || []).includes(r));
        if (missing.length) {
          stats.changed++;
          await changeRoles(m.user.id, missing, [], stats);
        }
      }
    } catch (err) {
      stats.error = err.message;
    }
    stats.errors = stats.errors.slice(0, 10);
    return stats;
  }, 'Join Roles an alle');
}

async function handleLeave(user) {
  const w = welcomeConfig();
  if (!w.leave.enabled || !isId(w.leave.channelId) || !user || user.bot) return;
  const guild = await guildInfo().catch(() => null);
  const msg = buildMessage(w.leave, user, guild, { mention: false });
  if (msg) await tickets.rest('POST', `/channels/${w.leave.channelId}/messages`, msg);
}

/** Testnachricht mit dem eigenen Discord-Konto als „neues Mitglied“. kind: join | dm | leave */
async function testWelcome(kind, discordId) {
  const w = welcomeConfig();
  let user;
  try {
    user = (await tickets.rest('GET', `/guilds/${guildId()}/members/${discordId}`)).user;
  } catch (err) {
    if (err.status === 404) throw new Error('Ihr verknüpftes Discord-Konto ist nicht auf dem Server.');
    throw err;
  }
  const guild = await guildInfo(true).catch(() => null);
  if (kind === 'dm') {
    const msg = buildMessage(w.dm, user, guild, { mention: false });
    if (!msg) throw new Error('Die Direktnachricht ist leer.');
    await sendDm(user.id, msg);
    return 'als Direktnachricht an Sie';
  }
  const part = kind === 'leave' ? w.leave : w;
  if (!isId(part.channelId)) throw new Error('Bitte zuerst einen Kanal wählen.');
  const msg = buildMessage(part, user, guild, { mention: kind !== 'leave' });
  if (!msg) throw new Error('Die Nachricht ist leer.');
  await tickets.rest('POST', `/channels/${part.channelId}/messages`, msg);
  return 'im gewählten Kanal';
}

/* ================================================================ Gateway */
const gw = { ws: null, intents: 0, state: 'aus', error: null, since: null, seq: null, sessionId: null, resumeUrl: null, heartbeat: null, jitter: null, acked: true, retry: 0, reconnectTimer: null, lastEvent: null };
const FATAL = {
  4004: 'Der Bot-Token ist ungültig (DISCORD_BOT_TOKEN prüfen).',
  4010: 'Ungültiger Shard.',
  4011: 'Discord verlangt Sharding (sehr großer Bot).',
  4012: 'Ungültige Gateway-Version.',
  4013: 'Ungültige Intents.',
  4014: 'Discord verweigert den „SERVER MEMBERS INTENT“. Im Discord Developer Portal → Bot → „Privileged Gateway Intents“ den „SERVER MEMBERS INTENT“ einschalten und speichern, dann hier „Neu verbinden“.',
};

function clearTimers() {
  clearInterval(gw.heartbeat);
  clearTimeout(gw.jitter);
  gw.heartbeat = null;
  gw.jitter = null;
}

function stop(state = 'aus') {
  clearTimeout(gw.reconnectTimer);
  gw.reconnectTimer = null;
  clearTimers();
  const ws = gw.ws;
  gw.ws = null;
  if (ws) {
    try {
      ws.close(1000);
    } catch {
      /* schon zu */
    }
  }
  gw.state = state;
  gw.sessionId = null;
  gw.seq = null;
  gw.resumeUrl = null;
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* Verbindung bricht ab → close-Handler übernimmt */
  }
}

function schedule(resume) {
  clearTimers();
  if (!wanted()) return stop('aus');
  const delays = [2, 5, 15, 30, 60];
  const sec = delays[Math.min(gw.retry, delays.length - 1)];
  gw.retry++;
  gw.state = 'getrennt';
  clearTimeout(gw.reconnectTimer);
  gw.reconnectTimer = setTimeout(() => connect(resume), sec * 1000);
  if (gw.reconnectTimer.unref) gw.reconnectTimer.unref();
}

/** Aktuelle Verbindung schließen und neu verbinden (resume: Sitzung fortsetzen). */
function reconnectNow(resume) {
  const ws = gw.ws;
  gw.ws = null;
  clearTimers();
  if (ws) {
    try {
      ws.close(4000);
    } catch {
      /* egal */
    }
  }
  if (!resume) {
    gw.sessionId = null;
    gw.seq = null;
  }
  clearTimeout(gw.reconnectTimer);
  gw.reconnectTimer = setTimeout(() => connect(resume && !!gw.sessionId), 500);
  if (gw.reconnectTimer.unref) gw.reconnectTimer.unref();
}

async function connect(resume = false) {
  gw.reconnectTimer = null;
  if (!wanted()) return stop('aus');
  if (typeof WebSocket !== 'function') {
    gw.state = 'fehler';
    gw.error = 'Diese Node-Version hat keinen WebSocket-Client (Node 22 oder neuer nötig).';
    return;
  }
  gw.state = 'verbindet';
  let url = resume && gw.resumeUrl;
  if (!url) {
    try {
      url = (await tickets.rest('GET', '/gateway/bot')).url;
    } catch (err) {
      gw.error = err.message;
      if (err.status === 401) {
        gw.state = 'fehler';
        return;
      }
      return schedule(false);
    }
  }
  let ws;
  try {
    ws = new WebSocket(`${url}/?v=10&encoding=json`);
  } catch (err) {
    gw.error = err.message;
    return schedule(false);
  }
  gw.ws = ws;
  ws.addEventListener('message', (ev) => {
    if (gw.ws === ws) onMessage(ws, ev.data, resume);
  });
  ws.addEventListener('close', (ev) => {
    if (gw.ws === ws) onClose(ev.code);
  });
  ws.addEventListener('error', () => {}); // „close“ folgt
}

function beat(ws) {
  if (gw.ws !== ws) return;
  if (!gw.acked) return reconnectNow(true); // keine Antwort auf den letzten Herzschlag → Verbindung tot
  gw.acked = false;
  send(ws, { op: 1, d: gw.seq });
}

function onMessage(ws, raw, resuming) {
  let msg;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
  } catch {
    return;
  }
  if (msg.s !== null && msg.s !== undefined) gw.seq = msg.s;
  switch (msg.op) {
    case 10: {
      const every = Number(msg.d && msg.d.heartbeat_interval) || 41250;
      clearTimers();
      gw.acked = true;
      gw.jitter = setTimeout(() => beat(ws), Math.floor(every * Math.random()));
      gw.heartbeat = setInterval(() => beat(ws), every);
      if (gw.heartbeat.unref) gw.heartbeat.unref();
      if (gw.jitter.unref) gw.jitter.unref();
      const token = tickets.botToken();
      if (resuming && gw.sessionId) send(ws, { op: 6, d: { token, session_id: gw.sessionId, seq: gw.seq } });
      else {
        gw.intents = intents();
        send(ws, { op: 2, d: { token, intents: gw.intents, properties: { os: 'linux', browser: 'pake-scha', device: 'pake-scha' } } });
      }
      break;
    }
    case 11:
      gw.acked = true;
      break;
    case 1:
      send(ws, { op: 1, d: gw.seq });
      break;
    case 7:
      reconnectNow(true);
      break;
    case 9:
      // Sitzung ungültig: fortsetzbar (d = true) oder neu anmelden
      if (!msg.d) {
        gw.sessionId = null;
        gw.seq = null;
      }
      setTimeout(() => reconnectNow(!!msg.d), 1000 + Math.random() * 4000).unref?.();
      break;
    case 0:
      dispatch(msg.t, msg.d);
      break;
    default:
  }
}

function onClose(code) {
  gw.ws = null;
  clearTimers();
  if (FATAL[code]) {
    gw.state = 'fehler';
    gw.error = FATAL[code];
    gw.sessionId = null;
    return;
  }
  const canResume = ![1000, 4007, 4009].includes(code) && !!gw.sessionId;
  if (!canResume) {
    gw.sessionId = null;
    gw.seq = null;
  }
  schedule(canResume);
}

function dispatch(t, d) {
  gw.lastEvent = now();
  if (t === 'READY') {
    gw.sessionId = d.session_id;
    gw.resumeUrl = d.resume_gateway_url || null;
    gw.state = 'verbunden';
    gw.since = now();
    gw.error = null;
    gw.retry = 0;
    // Nach (Wieder-)Verbindung einmal alles abgleichen – verpasste Ereignisse nachholen
    setTimeout(() => scan('nach Verbindung').catch(() => {}), 5000).unref?.();
    return;
  }
  if (t === 'RESUMED') {
    gw.state = 'verbunden';
    gw.error = null;
    gw.retry = 0;
    return;
  }
  if (!d || d.guild_id !== guildId()) return;
  if (t === 'GUILD_MEMBER_ADD') enqueue(() => handleJoin(d), 'Beitritt');
  else if (t === 'GUILD_MEMBER_UPDATE' && d.user) {
    // Serverregeln bestätigt → vorgemerkte Join Roles sofort vergeben
    if (d.pending === false && db.prepare('SELECT 1 FROM discord_join_roles WHERE member_id = ? AND done_at IS NULL').get(d.user.id)) {
      enqueue(() => processJoinQueue({ memberId: d.user.id }), 'Join Roles');
    }
    if (!d.user.bot) queueMember(d.user.id, d.roles || []);
  }
  else if (t === 'GUILD_MEMBER_REMOVE') enqueue(() => handleLeave(d.user), 'Abschiedsnachricht');
  else if (t === 'MESSAGE_CREATE') botMessages.onMessage(d);
}

/** Nach Einstellungsänderungen: verbinden, wenn ein Modul an ist – sonst trennen. */
function refresh() {
  if (!wanted()) {
    if (gw.ws || gw.reconnectTimer || gw.state !== 'aus') stop('aus');
    return;
  }
  if (gw.state === 'fehler' || (!gw.ws && !gw.reconnectTimer)) {
    gw.retry = 0;
    connect(false);
    return;
  }
  // Benötigte Intents geändert (z. B. erste „alle X Nachrichten“-Automatik) → neu anmelden
  if (gw.state === 'verbunden' && gw.intents !== intents()) restart();
}

function restart() {
  stop('aus');
  gw.retry = 0;
  gw.error = null;
  refresh();
}

let timer = null;
/** Beim Serverstart: verbinden und regelmäßig abgleichen (Sicherheitsnetz, falls Ereignisse verloren gehen). */
let queueTimer = null;
function start() {
  migrateJoinRoles();
  botMessages.start(); // Zeitpläne der Nachrichten-Vorlagen
  refresh();
  if (timer) return;
  timer = setInterval(() => {
    refresh();
    if (wanted()) scan('automatisch').catch(() => {});
  }, SCAN_EVERY);
  timer.unref();
  // Join Roles mit Verzögerung bzw. nach Regel-Bestätigung
  queueTimer = setInterval(() => {
    if (wanted() && joinQueueDue()) enqueue(() => processJoinQueue(), 'Join Roles');
  }, 15 * 1000);
  queueTimer.unref();
}

function status() {
  return {
    tokenSet: tickets.hasToken(),
    guildId: guildId(),
    wanted: wanted(),
    state: gw.state,
    error: gw.error,
    since: gw.since,
    lastEvent: gw.lastEvent,
    scanning: !!scanning,
    lastScan: (() => {
      const s = readJson('bot_last_scan');
      return s.startedAt ? s : null;
    })(),
    errors: lastErrors.slice(0, 10),
    joinQueue: db.prepare("SELECT COUNT(*) AS n FROM discord_join_roles WHERE done_at IS NULL").get().n,
    messageIntent: !!(gw.intents & (1 << 9)),
  };
}

/* ================================================================ Rollen & Kanäle für die Einstellungen */
let discordCache = null;
function roleNameCache() {
  const out = {};
  if (discordCache && discordCache.data) for (const r of discordCache.data.roles) out[r.id] = r.name;
  return out;
}

/** Rollen (mit Hinweis, ob der Bot sie vergeben kann) und Textkanäle des Servers. */
async function discordData(fresh = false) {
  if (!tickets.hasToken()) throw Object.assign(new Error('Kein Bot-Token (DISCORD_BOT_TOKEN in Render setzen).'), { status: 400 });
  if (!isId(guildId())) throw Object.assign(new Error('Keine Server-ID – bitte unter Discord-Bot → Tickets eintragen.'), { status: 400 });
  if (!fresh && discordCache && discordCache.id === guildId() && discordCache.until > Date.now()) return discordCache.data;
  const g = guildId();
  const [roles, channels, me, guild] = await Promise.all([
    tickets.rest('GET', `/guilds/${g}/roles`),
    tickets.rest('GET', `/guilds/${g}/channels`),
    tickets.rest('GET', '/users/@me'),
    guildInfo(true).catch(() => null),
  ]);
  const botMember = await tickets.rest('GET', `/guilds/${g}/members/${me.id}`).catch(() => ({ roles: [] }));
  const pos = new Map(roles.map((r) => [r.id, r.position]));
  const botTop = Math.max(0, ...(botMember.roles || []).map((id) => pos.get(id) || 0));
  // Darf der Bot jede Rolle pingen? Recht „@everyone, @here und alle Rollen erwähnen“ (1 << 17) oder Administrator (1 << 3)
  const perms = roles.filter((r) => r.id === g || (botMember.roles || []).includes(r.id)).reduce((acc, r) => acc | BigInt(r.permissions || 0), 0n);
  const botMentionAll = (perms & ((1n << 17n) | (1n << 3n))) !== 0n;
  const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const data = {
    guild: guild ? { name: guild.name, icon: guild.icon ? `https://cdn.discordapp.com/icons/${g}/${guild.icon}.png?size=128` : null, memberCount: guild.approximate_member_count || null } : null,
    bot: { name: me.global_name || me.username || 'Kanzlei-Bot', avatar: avatarUrl(me) },
    botTop,
    botMentionAll,
    roles: roles
      .filter((r) => r.id !== g)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null,
        position: r.position,
        managed: !!r.managed,
        mentionable: !!r.mentionable,
        assignable: !r.managed && r.position < botTop,
      })),
    channels: channels
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((c) => ({ id: c.id, name: c.name, category: categories.get(c.parent_id) || '' })),
  };
  discordCache = { id: g, data, until: Date.now() + 60 * 1000 };
  return data;
}

module.exports = {
  start,
  refresh,
  listMembers,
  sendDm,
  restart,
  status,
  scan,
  syncUser,
  testWelcome,
  discordData,
  rankSyncConfig,
  connectionsConfig,
  welcomeConfig,
  joinRolesConfig,
  joinRolesToAll,
  MAX_JOIN_ROLES,
  saveJson,
  evaluate,
  desiredRoles,
  PLACEHOLDERS,
  MAX_RULES,
  MAX_CONDITIONS,
  WELCOME_DEFAULT,
  _test: { handleJoin, catchUpJoins, sameJoin },
};
