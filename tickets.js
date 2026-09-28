'use strict';
/*
 * Discord-Tickets: Für jede Akte ein eigener, privater Discord-Kanal („Ticket“).
 *
 *  - Neue Akte (Website-Formular oder Dashboard) → Kanal #ps-2026-0012-name in der Ticket-Kategorie
 *  - Sichtbar für: die eingestellten Team-Rollen, die zuständigen Anwälte (mit verknüpftem Discord)
 *    und den Mandanten (Discord-Konto mit dem Website-Konto verknüpft bzw. über Aktenzeichen + Pin
 *    auf der Website „Discord-Ticket beitreten“)
 *  - Alles, was der Mandant auch im Portal sieht, erscheint automatisch im Kanal: Status, Verfahrensstand,
 *    Zuständigkeit, Hinweise, Nachrichten, Anhänge, Termine/Fristen, Verträge, Rechnungen
 *  - Interne Notizen, interne Anhänge und Aufgaben landen NIE im Ticket (der Mandant liest mit).
 *  - Akte geschlossen → Kanal wandert ins Archiv, der Mandant kann nur noch lesen; wieder geöffnet → zurück.
 *
 * Technik: Nur die Discord-REST-API mit einem Bot-Token (Umgebungsvariable DISCORD_BOT_TOKEN – nie in der
 * Datenbank, nie im Frontend). Es läuft kein dauerhafter Bot-Prozess; einmalig meldet sich der Bot am
 * Gateway an (von Discord vor dem ersten Senden verlangt). Alle Aufrufe je Akte laufen nacheinander in
 * einer Warteschlange und blockieren nie die eigentliche Anfrage; Fehler landen an der Akte und im Log.
 */
const crypto = require('crypto');
const { db, getSetting, setSetting } = require('./db');
const { truncate, CASE_STATUS, STEPS } = require('./helpers');
const { getCase, caseLawyers } = require('./models');
const discord = require('./discord');

const API = 'https://discord.com/api/v10';
const ID_RE = /^\d{15,25}$/;
const isId = (v) => ID_RE.test(String(v || ''));

/* ---------------------------------------------------------------- Berechtigungen */
const P = {
  CREATE_INSTANT_INVITE: 1 << 0,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  EMBED_LINKS: 1 << 14,
  ATTACH_FILES: 1 << 15,
  READ_MESSAGE_HISTORY: 1 << 16,
  MENTION_EVERYONE: 1 << 17,
  MANAGE_ROLES: 1 << 28,
};
const PERM_NAMES = {
  CREATE_INSTANT_INVITE: 'Einladung erstellen (Mandanten dem Server hinzufügen)',
  MANAGE_CHANNELS: 'Kanäle verwalten',
  VIEW_CHANNEL: 'Kanäle ansehen',
  SEND_MESSAGES: 'Nachrichten senden',
  MANAGE_MESSAGES: 'Nachrichten verwalten (anheften)',
  EMBED_LINKS: 'Links einbetten',
  ATTACH_FILES: 'Dateien anhängen',
  READ_MESSAGE_HISTORY: 'Nachrichtenverlauf lesen',
  MENTION_EVERYONE: 'Alle Rollen erwähnen (Team-Rolle pingen)',
  MANAGE_ROLES: 'Berechtigungen verwalten (Rollen verwalten)',
};
const REQUIRED = Object.keys(PERM_NAMES);
const INVITE_PERMISSIONS = REQUIRED.reduce((s, k) => s + P[k], 0);
const MEMBER_ALLOW = P.VIEW_CHANNEL + P.SEND_MESSAGES + P.EMBED_LINKS + P.ATTACH_FILES + P.READ_MESSAGE_HISTORY;
const READ_ONLY = P.VIEW_CHANNEL + P.READ_MESSAGE_HISTORY;
const BOT_ALLOW = MEMBER_ALLOW + P.MANAGE_MESSAGES + P.MANAGE_CHANNELS + P.MANAGE_ROLES;

const COLORS = { gold: discord.GOLD, red: discord.RED, green: 0x10b981, blue: 0x38bdf8, slate: 0x64748b };

/* ---------------------------------------------------------------- Einstellungen */
const token = () => discord.envValue('DISCORD_BOT_TOKEN');

function config() {
  return {
    enabled: getSetting('discord_tickets_enabled', '0') === '1',
    guildId: getSetting('discord_ticket_guild', ''),
    categoryId: getSetting('discord_ticket_category', ''),
    archiveId: getSetting('discord_ticket_archive', ''),
    roleIds: String(getSetting('discord_ticket_roles', '') || '')
      .split(/[\s,;]+/)
      .filter(isId),
    pingRoles: getSetting('discord_ticket_ping', '1') === '1',
  };
}

/** Sind Tickets eingeschaltet und vollständig eingerichtet? */
function active() {
  const c = config();
  return c.enabled && !!token() && isId(c.guildId) && isId(c.categoryId);
}

function inviteUrl() {
  const appId = getSetting('discord_bot_id', '') || discord.envValue('DISCORD_CLIENT_ID');
  if (!isId(appId)) return null;
  const guild = config().guildId;
  const params = new URLSearchParams({ client_id: appId, scope: 'bot', permissions: String(INVITE_PERMISSIONS) });
  if (isId(guild)) {
    params.set('guild_id', guild);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params}`;
}

/* ---------------------------------------------------------------- REST */
class DiscordApiError extends Error {
  constructor(status, body) {
    super(describeError(status, body));
    this.status = status;
    this.code = body && body.code;
  }
}

function describeError(status, body) {
  const code = body && body.code;
  const known = {
    10003: 'Kanal nicht gefunden (gelöscht?).',
    10004: 'Discord-Server nicht gefunden – stimmt die Server-ID und ist der Bot eingeladen?',
    10007: 'Die Person ist nicht auf dem Discord-Server.',
    10013: 'Discord-Konto nicht gefunden.',
    50001: 'Der Bot hat keinen Zugriff (fehlende Rechte auf Server oder Kategorie).',
    50013: 'Dem Bot fehlen Berechtigungen (z. B. „Kanäle verwalten“ oder „Berechtigungen verwalten“).',
    50035: 'Ungültige Angaben (z. B. falsche Kategorie-ID).',
  };
  if (status === 401) return 'Der Bot-Token ist ungültig (DISCORD_BOT_TOKEN prüfen).';
  if (known[code]) return known[code];
  const msg = body && body.message ? String(body.message) : '';
  return `Discord antwortet mit ${status}${msg ? ': ' + truncate(msg, 160) : ''}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, path, body, attempt = 0) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bot ${token()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://pake-scha.ls, 1.0) PakeScha-Kanzlei',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 429 && attempt < 3) {
    const info = await res.json().catch(() => ({}));
    await sleep(Math.min(15, Number(info.retry_after) || 1) * 1000 + 250);
    return rest(method, path, body, attempt + 1);
  }
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new DiscordApiError(res.status, data);
  return data;
}

/**
 * Discord verlangt, dass sich ein Bot mindestens einmal am Gateway anmeldet, bevor er per REST
 * Nachrichten sendet. Das passiert hier einmalig je Token (kurz verbinden, anmelden, trennen).
 */
async function identifyOnce() {
  const t = token();
  if (!t || typeof WebSocket !== 'function') return;
  const hash = crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
  if (getSetting('discord_bot_identified', '') === hash) return;
  await new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* schon geschlossen */
      }
      if (ok) setSetting('discord_bot_identified', hash);
      resolve();
    };
    const timer = setTimeout(() => finish(false), 15000);
    try {
      ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    } catch {
      return finish(false);
    }
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.op === 10) ws.send(JSON.stringify({ op: 2, d: { token: t, intents: 0, properties: { os: 'linux', browser: 'pake-scha', device: 'pake-scha' } } }));
      else if (msg.op === 0 && msg.t === 'READY') finish(true);
      else if (msg.op === 9) finish(false);
    });
    ws.addEventListener('error', () => finish(false));
    ws.addEventListener('close', () => finish(false));
  });
}

let botUser = null;
async function botId() {
  if (botUser && botUser.token === token()) return botUser.id;
  const me = await rest('GET', '/users/@me');
  botUser = { id: String(me.id), name: me.global_name || me.username, token: token() };
  setSetting('discord_bot_id', botUser.id);
  return botUser.id;
}

/** Ist die Person Mitglied des Discord-Servers? (Kurz zwischengespeichert.) */
const memberCache = new Map();
async function isMember(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let value;
  try {
    await rest('GET', `/guilds/${guildId}/members/${userId}`);
    value = true;
  } catch (err) {
    if (err.status === 404) value = false;
    else throw err;
  }
  memberCache.set(key, { value, until: Date.now() + (value ? 30 * 60 * 1000 : 60 * 1000) });
  return value;
}

/**
 * Fügt eine Person dem Discord-Server hinzu (OAuth-Scope „guilds.join“ beim Verknüpfen).
 * Der Zugangstoken wird nur für diesen einen Aufruf verwendet und nicht gespeichert.
 */
async function joinGuild(userId, accessToken) {
  if (!active() || !isId(userId) || !accessToken) return false;
  const { guildId } = config();
  try {
    await rest('PUT', `/guilds/${guildId}/members/${userId}`, { access_token: accessToken });
    memberCache.set(`${guildId}:${userId}`, { value: true, until: Date.now() + 30 * 60 * 1000 });
    return true;
  } catch (err) {
    console.warn('Discord-Tickets: Server-Beitritt fehlgeschlagen:', err.message);
    return false;
  }
}

/* ---------------------------------------------------------------- Akte ↔ Kanal */
function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
const channelName = (c) => [String(c.case_number).toLowerCase(), slug(c.client_account_name || c.client_name)].filter(Boolean).join('-').slice(0, 90);
const channelUrl = (c) => (c.discord_channel_id && isId(config().guildId) ? `https://discord.com/channels/${config().guildId}/${c.discord_channel_id}` : null);

/** Discord-IDs des Mandanten: verknüpftes Konto und/oder über die Website („Discord-Ticket beitreten“). */
function clientDiscordIds(c) {
  const acc = c.client_id ? db.prepare('SELECT discord_id FROM users WHERE id = ? AND active = 1').get(c.client_id) : null;
  return [...new Set([acc && acc.discord_id, c.discord_client_id].filter(isId))];
}
const clientDiscordId = (c) => clientDiscordIds(c)[0] || null;

/** Per /add hinzugefügte Personen (bleiben beim Abgleich erhalten, bis /remove). */
const parseExtra = (r) => {
  try {
    const list = JSON.parse(r.discord_extra || '[]');
    return Array.isArray(list) ? list.filter(isId) : [];
  } catch {
    return [];
  }
};

/** Wer soll (zusätzlich zu den Team-Rollen) im Ticket sein? */
function wantedMembers(c) {
  const map = new Map();
  for (const id of parseExtra(c)) map.set(id, 'extra');
  for (const l of caseLawyers(c)) if (isId(l.discordId)) map.set(l.discordId, 'lawyer');
  for (const id of clientDiscordIds(c)) map.set(id, 'client');
  return map;
}
/** Erster Mandanten-Account, der schon im Ticket ist (für Erwähnungen). */
const clientInChannel = (c) => clientDiscordIds(c).find((id) => parseMembers(c).includes(id)) || null;

const parseMembers = (c) => {
  try {
    const list = JSON.parse(c.discord_members || '[]');
    return Array.isArray(list) ? list.filter(isId) : [];
  } catch {
    return [];
  }
};

function saveState(caseId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE cases SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), caseId);
}

function memberOverwrite(id, kind, closed) {
  // Geschlossene Akte: Mandant und hinzugefügte Personen lesen nur noch mit; Anwälte behalten Schreibrechte.
  if (kind !== 'lawyer' && closed) return { id, type: 1, allow: String(READ_ONLY), deny: String(P.SEND_MESSAGES) };
  return { id, type: 1, allow: String(MEMBER_ALLOW), deny: '0' };
}

const URGENCY_LABEL = { normal: 'Normal', eilig: 'Eilig', notfall: '🚨 Notfall' };
const AREA_LABEL = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };

function lawyerText(c) {
  const all = caseLawyers(c);
  if (!all.length) return 'Noch nicht zugewiesen';
  return all.map((l) => (l.lead && all.length > 1 ? `${l.name} (federführend)` : l.name)).join(', ');
}

/** Legt den Kanal an und sendet die Begrüßung. quiet: ohne Rollen-Ping (z. B. beim Nachholen). */
async function createChannel(c, { quiet = false } = {}) {
  const cfg = config();
  await identifyOnce();
  const bot = await botId();
  const closed = c.status === 'geschlossen';
  const members = wantedMembers(c);
  const added = [];
  const overwrites = [
    { id: cfg.guildId, type: 0, allow: '0', deny: String(P.VIEW_CHANNEL) }, // @everyone
    { id: bot, type: 1, allow: String(BOT_ALLOW), deny: '0' },
    ...cfg.roleIds.map((id) => ({ id, type: 0, allow: String(MEMBER_ALLOW), deny: '0' })),
  ];
  for (const [id, kind] of members) {
    if (id === bot) continue;
    if (await isMember(cfg.guildId, id)) {
      overwrites.push(memberOverwrite(id, kind, closed));
      added.push(id);
    }
  }
  const channel = await rest('POST', `/guilds/${cfg.guildId}/channels`, {
    name: channelName(c),
    type: 0,
    parent_id: closed && isId(cfg.archiveId) ? cfg.archiveId : cfg.categoryId,
    topic: truncate(`Akte ${c.case_number} · ${c.title} – Pake & Scha Legal Consulting`, 1000),
    permission_overwrites: overwrites,
  });
  saveState(c.id, { discord_channel_id: String(channel.id), discord_members: JSON.stringify(added), discord_archived: closed ? 1 : 0, discord_error: null });
  c.discord_channel_id = String(channel.id);
  c.discord_members = JSON.stringify(added);

  const clientIn = clientDiscordIds(c).find((id) => added.includes(id)) || null;
  const client = clientIn || clientDiscordId(c);
  const lawyerIds = caseLawyers(c)
    .map((l) => l.discordId)
    .filter((id) => isId(id) && added.includes(id));
  const intro = clientIn
    ? `Willkommen <@${client}>! Das ist das Ticket zu Ihrer Akte bei Pake & Scha. Alle Neuigkeiten – Status, Termine, Verträge, Rechnungen – erscheinen automatisch hier.`
    : 'Neues Ticket zur Akte. Alle Neuigkeiten erscheinen automatisch hier.';
  const pingRoles = cfg.pingRoles && !quiet;
  const pings = [...(pingRoles ? cfg.roleIds.map((id) => `<@&${id}>`) : []), ...lawyerIds.map((id) => `<@${id}>`)].join(' ');
  const panel = panelFor('case', c);
  const msg = await send(channel.id, {
    content: pings || undefined, // nur die Erwähnungen (pingen) – alles andere steht im Embed
    components: panel.components,
    embeds: [
      embed({
        title: `📁 Akte ${c.case_number}: ${truncate(c.title, 200)}`,
        description: `${intro}${c.description ? `\n\n**Sachverhalt**\n>>> ${truncate(c.description, 1500)}` : ''}`,
        fields: [
          { name: 'Mandant', value: c.client_account_name || c.client_name || '—' },
          { name: 'Rechtsgebiet', value: AREA_LABEL[c.area] || c.area || '—' },
          { name: 'Dringlichkeit', value: URGENCY_LABEL[c.urgency] || c.urgency },
          { name: 'Status', value: `${CASE_STATUS[c.status]} · ${STEPS[c.step] || STEPS[0]}` },
          { name: 'Zuständig', value: lawyerText(c), inline: false },
          ...(clientIn
            ? []
            : [
                {
                  name: 'Mandant im Ticket',
                  value: client
                    ? '⏳ Noch nicht auf dem Discord-Server – wird automatisch hinzugefügt, sobald er beitritt (Akte → „Discord abgleichen“).'
                    : '⏳ Noch kein Discord verknüpft. Mandant: im Portal „Mein Profil → Discord verbinden“ oder auf der Website unter „Aktenstatus“ mit Aktenzeichen + Pin „Discord-Ticket beitreten“.',
                  inline: false,
                },
              ]),
        ],
        color: c.urgency === 'notfall' ? COLORS.red : COLORS.gold,
      }),
    ],
    allowed_mentions: { parse: [], users: [...(clientIn ? [client] : []), ...lawyerIds], roles: pingRoles ? cfg.roleIds : [] },
  });
  if (msg && msg.id) {
    saveState(c.id, { discord_panel_id: String(msg.id), discord_panel_state: panel.state });
    rest('PUT', `/channels/${channel.id}/pins/${msg.id}`).catch(() => {});
  }
  return channel.id;
}

/** Mitglieder und Archiv-Zustand des Kanals an die Akte angleichen. Liefert neu hinzugekommene Personen. */
async function syncMembers(c) {
  const cfg = config();
  const bot = await botId();
  const closed = c.status === 'geschlossen';
  const wanted = wantedMembers(c);
  const current = new Set(parseMembers(c));
  const joined = [];
  const archivedBefore = !!c.discord_archived;
  for (const [id, kind] of wanted) {
    if (id === bot) continue;
    // Beim Mandanten Schreibrecht an den Akten-Status anpassen (auch wenn schon drin).
    const needsUpdate = !current.has(id) || (kind !== 'lawyer' && archivedBefore !== closed);
    if (!needsUpdate) continue;
    if (!current.has(id) && !(await isMember(cfg.guildId, id))) continue;
    const o = memberOverwrite(id, kind, closed);
    await rest('PUT', `/channels/${c.discord_channel_id}/permissions/${id}`, { type: 1, allow: o.allow, deny: o.deny });
    if (!current.has(id)) joined.push({ id, kind });
    current.add(id);
  }
  for (const id of [...current]) {
    if (wanted.has(id)) continue;
    await rest('DELETE', `/channels/${c.discord_channel_id}/permissions/${id}`).catch((err) => {
      if (err.status !== 404) throw err;
    });
    current.delete(id);
  }
  saveState(c.id, { discord_members: JSON.stringify([...current]) });
  c.discord_members = JSON.stringify([...current]);
  return joined;
}

async function syncArchive(c) {
  const cfg = config();
  const closed = c.status === 'geschlossen';
  if (!!c.discord_archived === closed) return;
  const parent = closed ? (isId(cfg.archiveId) ? cfg.archiveId : null) : cfg.categoryId;
  if (parent) await rest('PATCH', `/channels/${c.discord_channel_id}`, { parent_id: parent, lock_permissions: false });
  saveState(c.id, { discord_archived: closed ? 1 : 0 });
  c.discord_archived = closed ? 1 : 0;
}

function embed({ title, description, fields = [], color = COLORS.gold, footer }) {
  return {
    title: truncate(title, 256),
    description: description ? truncate(description, 4000) : undefined,
    color,
    fields: fields
      .filter((f) => f && f.name)
      .slice(0, 25)
      .map((f) => ({ name: truncate(f.name, 256), value: truncate(f.value || '—', 1024), inline: f.inline !== false })),
    footer: { text: footer || 'Pake & Scha Legal Consulting' },
    timestamp: new Date().toISOString(),
  };
}

function send(channelId, payload) {
  return rest('POST', `/channels/${channelId}/messages`, payload);
}

/* ---------------------------------------------------------------- Panel (Buttons im Ticket) */
/*
 * Buttons zum Übernehmen/Schließen/Wieder öffnen funktionieren nur, wenn Discord Klicks an die Website
 * schicken kann: Developer Portal → „Interactions Endpoint URL“ = <PUBLIC_URL>/api/discord/interactions
 * und DISCORD_PUBLIC_KEY in Render (siehe routes/interactions.js). Ohne das gibt es nur den Link-Button.
 */
const publicKeyHex = () => {
  const k = discord.envValue('DISCORD_PUBLIC_KEY').toLowerCase();
  return /^[0-9a-f]{64}$/.test(k) ? k : '';
};
const panelInteractive = () => !!publicKeyHex();
const siteBase = () => {
  const b = discord.envValue('PUBLIC_URL').replace(/\/+$/, '');
  return /^https?:\/\//.test(b) ? b : '';
};
const button = (label, customId, style = 2, extra = {}) => ({ type: 2, style, label, custom_id: customId, ...extra });
const linkButton = (label, url) => ({ type: 2, style: 5, label, url });

/** Buttons je Ticket-Art; state ändert sich, sobald andere Buttons nötig sind. */
function panelFor(kind, r) {
  const interactive = panelInteractive();
  const base = siteBase();
  const buttons = [];
  let state;
  if (kind === 'case') {
    const closed = r.status === 'geschlossen';
    if (interactive) {
      if (!closed && !r.lawyer_id) buttons.push(button('Akte übernehmen', `case:claim:${r.id}`, 3, { emoji: { name: '🙋' } }));
      buttons.push(closed ? button('Wieder öffnen', `case:reopen:${r.id}`, 1, { emoji: { name: '🔓' } }) : button('Akte schließen', `case:close:${r.id}`, 4, { emoji: { name: '🔒' } }));
    }
    if (base) buttons.push(linkButton('Im Dashboard öffnen', `${base}/dashboard.html?case=${r.id}`));
    state = `${closed ? 'closed' : 'open'}|${r.lawyer_id ? 'taken' : 'free'}`;
  } else if (kind === 'concern') {
    const closed = BOARD_KINDS.concern.closed.includes(r.status);
    if (interactive) buttons.push(closed ? button('Wieder öffnen', `concern:reopen:${r.id}`, 1, { emoji: { name: '🔓' } }) : button('Als erledigt markieren', `concern:done:${r.id}`, 3, { emoji: { name: '✅' } }));
    if (base) buttons.push(linkButton('Im Dashboard öffnen', `${base}/dashboard.html#concerns-board`));
    state = closed ? 'closed' : 'open';
  } else {
    if (base) buttons.push(linkButton('Im Dashboard öffnen', `${base}/dashboard.html#applications`));
    state = 'link';
  }
  const components = buttons.length ? [{ type: 1, components: buttons }] : [];
  return { components, state: `${state}|${interactive ? 'i' : 'l'}|${base ? 'b' : ''}` };
}

/**
 * Panel eines Tickets auf den aktuellen Stand bringen: Buttons der angehefteten Begrüßung bzw. einer
 * eigenen „Ticket-Steuerung“ tauschen (z. B. „Schließen“ ↔ „Wieder öffnen“). Ältere Tickets ohne Panel
 * bekommen eins. save(fields) schreibt discord_panel_id/-state an die Zeile.
 */
async function refreshPanel(kind, r, save) {
  if (!r || !r.discord_channel_id) return;
  const { components, state } = panelFor(kind, r);
  if (state === r.discord_panel_state) return;
  if (r.discord_panel_id) {
    try {
      await rest('PATCH', `/channels/${r.discord_channel_id}/messages/${r.discord_panel_id}`, { components });
      save({ discord_panel_state: state });
      return;
    } catch (err) {
      if (err.code !== 10008) throw err; // Nachricht gelöscht → neues Panel
    }
  }
  if (!components.length) {
    save({ discord_panel_state: state });
    return;
  }
  const msg = await send(r.discord_channel_id, {
    embeds: [embed({ title: '🎛️ Ticket-Steuerung', description: 'Die wichtigsten Aktionen für dieses Ticket. Weitere Befehle: `/hilfe`', color: COLORS.slate })],
    components,
    allowed_mentions: { parse: [] },
  });
  if (msg && msg.id) {
    save({ discord_panel_id: String(msg.id), discord_panel_state: state });
    rest('PUT', `/channels/${r.discord_channel_id}/pins/${msg.id}`).catch(() => {});
  }
}
const refreshCasePanel = (caseId) => refreshPanel('case', getCase(caseId), (f) => saveState(caseId, f));

/* ---------------------------------------------------------------- Warteschlange */
const queues = new Map();
function enqueue(key, job, onError) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(job).catch((err) => {
    console.warn(`Discord-Tickets (${key}): ${err.message}`);
    if (onError) onError(err);
    else if (typeof key === 'number') {
      try {
        saveState(key, { discord_error: truncate(err.message, 300) });
      } catch {
        /* Akte evtl. gelöscht */
      }
    }
  });
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

/**
 * Kanal sicherstellen (anlegen, falls noch keiner existiert oder er gelöscht wurde), Mitglieder abgleichen.
 * Liefert die (frisch geladene) Akte oder null.
 */
async function ensure(caseId) {
  let c = getCase(caseId);
  if (!c) return null;
  if (!c.discord_channel_id) {
    if (c.discord_deleted) return null; // per /delete gelöscht – nur über „Ticket anlegen“ im Dashboard neu
    await createChannel(c);
    return getCase(caseId);
  }
  try {
    const joined = await syncMembers(c);
    const clientJoined = joined.find((j) => j.kind === 'client');
    if (clientJoined) {
      await send(c.discord_channel_id, {
        content: `<@${clientJoined.id}>`,
        embeds: [
          embed({
            title: '👋 Willkommen im Ticket',
            description: `<@${clientJoined.id}> ist dem Ticket beigetreten. Hier erscheinen alle Neuigkeiten zu Ihrer Akte **${c.case_number}** – Status, Termine, Verträge und Rechnungen.`,
            color: COLORS.green,
          }),
        ],
        allowed_mentions: { parse: [], users: [clientJoined.id] },
      });
    }
  } catch (err) {
    if (err.code !== 10003) throw err;
    // Kanal wurde in Discord gelöscht → neu anlegen
    saveState(c.id, { discord_channel_id: null, discord_members: null, discord_archived: 0, discord_panel_id: null, discord_panel_state: null });
    c = getCase(caseId);
    await createChannel(c);
  }
  saveState(caseId, { discord_error: null });
  return getCase(caseId);
}

/* ---------------------------------------------------------------- Öffentliche Schnittstelle */

/** Neue Akte → Ticket anlegen. */
function caseCreated(caseId, opts = {}) {
  if (!active()) return Promise.resolve();
  return enqueue(caseId, async () => {
    const c = getCase(caseId);
    if (c && !c.discord_channel_id) await createChannel(c, opts);
  });
}

/** Mitglieder/Archiv abgleichen (z. B. nach Discord-Verknüpfung). recreate: per /delete gelöschtes Ticket neu anlegen. */
function syncCase(caseId, { recreate = false } = {}) {
  if (!active()) return Promise.resolve();
  if (recreate) db.prepare('UPDATE cases SET discord_deleted = 0 WHERE id = ?').run(caseId);
  return enqueue(caseId, async () => {
    const c = await ensure(caseId);
    if (c) {
      await syncArchive(c);
      await refreshCasePanel(caseId);
    }
  });
}

/**
 * Nachricht ins Ticket der Akte. msg: { title, description, fields, color, mention: 'client'|'lawyers'|'all', by }
 * Der Archiv-Zustand wird danach angeglichen (Schließen: erst Nachricht, dann ins Archiv).
 */
function post(caseId, msg) {
  if (!active()) return Promise.resolve();
  return enqueue(caseId, async () => {
    let c = await ensure(caseId);
    if (!c) return;
    // Wiedereröffnet: erst aus dem Archiv holen, dann schreiben
    if (c.status !== 'geschlossen' && c.discord_archived) {
      await syncArchive(c);
      await syncMembers(c);
      c = getCase(caseId);
    }
    const members = parseMembers(c);
    const client = clientInChannel(c);
    const mentions = [];
    if ((msg.mention === 'client' || msg.mention === 'all') && client) mentions.push(client);
    if (msg.mention === 'lawyers' || msg.mention === 'all' || Array.isArray(msg.mentionIds)) {
      const ids = Array.isArray(msg.mentionIds) ? msg.mentionIds : caseLawyers(c).map((l) => l.discordId);
      ids.filter((id) => isId(id) && members.includes(id) && id !== msg.byDiscordId).forEach((id) => mentions.push(id));
    }
    const unique = [...new Set(mentions)];
    const payload = {
      content: unique.length ? unique.map((id) => `<@${id}>`).join(' ') : undefined,
      embeds: [embed({ ...msg, footer: msg.by ? `${msg.by} · Pake & Scha Legal Consulting` : undefined })],
      allowed_mentions: { parse: [], users: unique },
    };
    try {
      await send(c.discord_channel_id, payload);
    } catch (err) {
      if (err.code !== 10003) throw err;
      // Kanal wurde in Discord gelöscht → neu anlegen und die Nachricht dort senden
      saveState(c.id, { discord_channel_id: null, discord_members: null, discord_archived: 0, discord_panel_id: null, discord_panel_state: null });
      c = await ensure(caseId);
      await send(c.discord_channel_id, payload);
    }
    await syncArchive(c);
    await refreshCasePanel(caseId);
  });
}

/** Akte gelöscht → Hinweis im Kanal und ins Archiv (der Verlauf bleibt erhalten). */
function caseDeleted(c, by) {
  if (!active() || !c.discord_channel_id) return Promise.resolve();
  return enqueue(`deleted-${c.id}`, async () => {
    const cfg = config();
    await send(c.discord_channel_id, {
      embeds: [embed({ title: `🗑️ Akte ${c.case_number} wurde gelöscht`, description: 'Das Ticket bleibt zur Nachverfolgung im Archiv.', color: COLORS.slate, footer: by ? `${by} · Pake & Scha Legal Consulting` : undefined })],
      allowed_mentions: { parse: [] },
    }).catch(() => {});
    for (const client of clientDiscordIds(c)) {
      await rest('PUT', `/channels/${c.discord_channel_id}/permissions/${client}`, { type: 1, allow: String(READ_ONLY), deny: String(P.SEND_MESSAGES) }).catch(() => {});
    }
    if (isId(cfg.archiveId)) await rest('PATCH', `/channels/${c.discord_channel_id}`, { parent_id: cfg.archiveId, lock_permissions: false }).catch(() => {});
  });
}

/** Alle Tickets einer Person abgleichen (Discord verknüpft/getrennt). */
function syncUser(userId) {
  if (!active()) return Promise.resolve();
  const rows = db
    .prepare(
      `SELECT DISTINCT c.id FROM cases c LEFT JOIN case_lawyers cl ON cl.case_id = c.id
       WHERE c.discord_channel_id IS NOT NULL AND (c.client_id = ? OR c.lawyer_id = ? OR cl.user_id = ?)`
    )
    .all(userId, userId, userId);
  // Offene Akten eines Mandanten ohne Ticket (z. B. vor Einrichtung angelegt) bekommen jetzt eins.
  const missing = db.prepare("SELECT id FROM cases WHERE client_id = ? AND discord_channel_id IS NULL AND discord_deleted = 0 AND status != 'geschlossen'").all(userId);
  return Promise.all([...rows, ...missing].map((r) => syncCase(r.id)));
}

/** Tickets für alle offenen Akten ohne Kanal anlegen (nach der Einrichtung). */
async function backfill() {
  const kinds = Object.keys(BOARD_KINDS).filter(boardActive);
  if (!active() && !kinds.length) throw new Error('Discord-Tickets sind nicht vollständig eingerichtet.');
  let created = 0;
  let total = 0;
  if (active()) {
    const rows = db.prepare("SELECT id FROM cases WHERE discord_channel_id IS NULL AND discord_deleted = 0 AND status != 'geschlossen' ORDER BY id").all();
    total += rows.length;
    for (const r of rows) {
      await caseCreated(r.id, { quiet: true });
      if (getCase(r.id)?.discord_channel_id) created += 1;
    }
  }
  // Offene Bewerbungen und Anliegen ohne Ticket
  for (const kind of kinds) {
    const t = BOARD_KINDS[kind];
    const rows = db.prepare(`SELECT id FROM ${t.table} WHERE discord_channel_id IS NULL AND discord_deleted = 0 AND status NOT IN (${t.closed.map(() => '?').join(',')}) ORDER BY id`).all(...t.closed);
    total += rows.length;
    for (const r of rows) {
      await boardCreated(kind, r.id, { quiet: true });
      if (boardRow(kind, r.id)?.discord_channel_id) created += 1;
    }
  }
  // Bestehende offene Tickets bekommen (neue) Buttons
  let panels = 0;
  if (active()) {
    for (const r of db.prepare("SELECT id FROM cases WHERE discord_channel_id IS NOT NULL AND status != 'geschlossen'").all()) {
      await syncCase(r.id);
      panels += 1;
    }
  }
  for (const kind of kinds) {
    const t = BOARD_KINDS[kind];
    for (const r of db.prepare(`SELECT id FROM ${t.table} WHERE discord_channel_id IS NOT NULL AND status NOT IN (${t.closed.map(() => '?').join(',')})`).all(...t.closed)) {
      await boardSync(kind, r.id);
      panels += 1;
    }
  }
  return { created, total, panels };
}

/* ================================================================
   Board-Tickets: Bewerbungen und Anliegen ans Board of Partners
   ================================================================
 * Eigene Kategorie (z. B. „Board of Partners“), sichtbar nur für die Board-Rolle(n) und die
 * Board-Mitglieder mit verknüpftem Discord (Rolle „Board of Partners“ oder Partner-Rang).
 * Anders als Mandats-Tickets sind das interne Kanäle: Bewerber bzw. Einreichende sind nicht drin,
 * deshalb erscheinen hier auch interne Notizen. Anonyme Anliegen bleiben anonym.
 */
const BOARD_RANK_LIST = ['Founding Partner', 'Equity Partner', 'Partner'];
const BOARD_KINDS = {
  application: { table: 'applications', closed: ['angenommen', 'abgelehnt'], flag: 'discord_ticket_board_apps', label: 'Bewerbung' },
  concern: { table: 'concerns', closed: ['erledigt', 'abgelehnt'], flag: 'discord_ticket_board_concerns', label: 'Anliegen' },
};

function boardConfig() {
  return {
    categoryId: getSetting('discord_ticket_board_category', ''),
    archiveId: getSetting('discord_ticket_board_archive', ''),
    roleIds: String(getSetting('discord_ticket_board_roles', '') || '')
      .split(/[\s,;]+/)
      .filter(isId),
    applications: getSetting('discord_ticket_board_apps', '1') === '1',
    concerns: getSetting('discord_ticket_board_concerns', '1') === '1',
  };
}

/** Board-Tickets dieser Art eingeschaltet und eingerichtet? */
function boardActive(kind) {
  const c = config();
  const b = boardConfig();
  if (!c.enabled || !token() || !isId(c.guildId) || !isId(b.categoryId)) return false;
  return kind === 'application' ? b.applications : kind === 'concern' ? b.concerns : false;
}

const boardRow = (kind, id) => db.prepare(`SELECT * FROM ${BOARD_KINDS[kind].table} WHERE id = ?`).get(id) || null;
function saveBoard(kind, id, fields) {
  const keys = Object.keys(fields);
  if (keys.length) db.prepare(`UPDATE ${BOARD_KINDS[kind].table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}
const boardClosed = (kind, r) => BOARD_KINDS[kind].closed.includes(r.status);
const boardArchive = () => boardConfig().archiveId || config().archiveId;

/** Discord-IDs aller Board-Mitglieder (Rolle „Board of Partners“ oder Partner-Rang) mit verknüpftem Discord. */
function boardMemberIds() {
  return db
    .prepare(`SELECT discord_id FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'anwalt' AND rank IN (${BOARD_RANK_LIST.map(() => '?').join(',')})))`)
    .all(...BOARD_RANK_LIST)
    .map((u) => u.discord_id)
    .filter(isId);
}

const CONCERN_CATEGORY = {
  personal: 'Personal & Beförderung',
  beschwerde: 'Beschwerde / Konflikt',
  betreuung: 'Betreuung meines Mandats',
  abrechnung: 'Rechnung & Honorar',
  kooperation: 'Anfrage / Zusammenarbeit',
  vorschlag: 'Vorschlag / Lob / Idee',
  organisation: 'Organisation & Abläufe',
  finanzen: 'Gehalt & Finanzen',
  sonstiges: 'Sonstiges',
};
const CONCERN_GROUP = { mitarbeiter: 'Mitarbeiter', mandant: 'Mandant', extern: 'über die Website' };
const APP_STATUS_LABEL = { eingegangen: 'Eingegangen', in_pruefung: 'In Prüfung', gespraech: 'Einladung zum Gespräch', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt' };
const CONCERN_STATUS_LABEL = { offen: 'Offen', in_bearbeitung: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
/** Absender eines Anliegens – bei anonymen Anliegen nie der Name. */
const concernFrom = (k) => `${k.anonymous ? 'Anonym' : k.author_name} (${CONCERN_GROUP[k.author_group] || 'Mitarbeiter'})`;

function boardChannelName(kind, r) {
  return kind === 'application'
    ? [String(r.number).toLowerCase(), slug(r.name)].filter(Boolean).join('-').slice(0, 90)
    : [String(r.reference || `an-${r.id}`).toLowerCase(), slug(r.subject)].filter(Boolean).join('-').slice(0, 90);
}

function boardIntro(kind, r) {
  if (kind === 'application') {
    return embed({
      title: `📝 Bewerbung ${r.number}: ${truncate(r.name, 150)}`,
      description: r.motivation ? truncate(r.motivation, 1500) : undefined,
      color: COLORS.gold,
      fields: [
        { name: 'Stelle', value: r.position_title },
        { name: 'Alter', value: r.age ? String(r.age) : '—' },
        { name: 'Discord', value: r.discord || '—' },
        { name: 'Telefon', value: r.phone || '—' },
        ...(r.experience ? [{ name: 'Erfahrung', value: truncate(r.experience, 1000), inline: false }] : []),
        ...(r.availability ? [{ name: 'Verfügbarkeit', value: truncate(r.availability, 300), inline: false }] : []),
        { name: 'Status', value: APP_STATUS_LABEL[r.status] || r.status },
      ],
    });
  }
  return embed({
    title: `📨 Anliegen ${r.reference || ''}: ${truncate(r.subject, 180)}`,
    description: truncate(r.body, 2000),
    color: r.urgency === 'dringend' ? COLORS.red : COLORS.gold,
    fields: [
      { name: 'Kategorie', value: CONCERN_CATEGORY[r.category] || r.category },
      { name: 'Dringlichkeit', value: r.urgency === 'dringend' ? 'Dringend' : 'Normal' },
      { name: 'Von', value: concernFrom(r) },
      ...(!r.anonymous && r.contact ? [{ name: 'Kontakt', value: truncate(r.contact, 100) }] : []),
      { name: 'Status', value: CONCERN_STATUS_LABEL[r.status] || r.status },
    ],
  });
}

async function createBoardChannel(kind, r, { quiet = false } = {}) {
  const cfg = config();
  const b = boardConfig();
  await identifyOnce();
  const bot = await botId();
  const closed = boardClosed(kind, r);
  const added = [];
  const overwrites = [
    { id: cfg.guildId, type: 0, allow: '0', deny: String(P.VIEW_CHANNEL) },
    { id: bot, type: 1, allow: String(BOT_ALLOW), deny: '0' },
    ...b.roleIds.map((id) => ({ id, type: 0, allow: String(MEMBER_ALLOW), deny: '0' })),
  ];
  for (const id of new Set([...boardMemberIds(), ...parseExtra(r)])) {
    if (id === bot || !(await isMember(cfg.guildId, id))) continue;
    overwrites.push({ id, type: 1, allow: String(MEMBER_ALLOW), deny: '0' });
    added.push(id);
  }
  const archive = boardArchive();
  const channel = await rest('POST', `/guilds/${cfg.guildId}/channels`, {
    name: boardChannelName(kind, r),
    type: 0,
    parent_id: closed && isId(archive) ? archive : b.categoryId,
    topic: truncate(`${BOARD_KINDS[kind].label} ${kind === 'application' ? r.number : r.reference || ''} – nur für das Board of Partners`, 1000),
    permission_overwrites: overwrites,
  });
  saveBoard(kind, r.id, { discord_channel_id: String(channel.id), discord_members: JSON.stringify(added), discord_archived: closed ? 1 : 0, discord_error: null });
  const ping = cfg.pingRoles && !quiet && b.roleIds.length;
  const panel = panelFor(kind, r);
  const msg = await send(channel.id, {
    content: ping ? b.roleIds.map((id) => `<@&${id}>`).join(' ') : undefined,
    embeds: [boardIntro(kind, r)],
    components: panel.components,
    allowed_mentions: { parse: [], roles: ping ? b.roleIds : [] },
  });
  if (msg && msg.id) {
    saveBoard(kind, r.id, { discord_panel_id: String(msg.id), discord_panel_state: panel.state });
    rest('PUT', `/channels/${channel.id}/pins/${msg.id}`).catch(() => {});
  }
}

/** Kanal sicherstellen, Board-Mitglieder und Archiv abgleichen. Liefert die frische Zeile oder null. */
async function ensureBoard(kind, id) {
  let r = boardRow(kind, id);
  if (!r) return null;
  if (!r.discord_channel_id) {
    if (r.discord_deleted) return null; // per /delete gelöscht
    await createBoardChannel(kind, r);
    return boardRow(kind, id);
  }
  const cfg = config();
  const bot = await botId();
  const wanted = new Set([...boardMemberIds(), ...parseExtra(r)].filter((m) => m !== bot));
  const current = new Set(parseMembers(r));
  try {
    for (const m of wanted) {
      if (current.has(m) || !(await isMember(cfg.guildId, m))) continue;
      await rest('PUT', `/channels/${r.discord_channel_id}/permissions/${m}`, { type: 1, allow: String(MEMBER_ALLOW), deny: '0' });
      current.add(m);
    }
    for (const m of [...current]) {
      if (wanted.has(m)) continue;
      await rest('DELETE', `/channels/${r.discord_channel_id}/permissions/${m}`).catch((err) => {
        if (err.status !== 404) throw err;
      });
      current.delete(m);
    }
  } catch (err) {
    if (err.code !== 10003) throw err;
    saveBoard(kind, id, { discord_channel_id: null, discord_members: null, discord_archived: 0, discord_panel_id: null, discord_panel_state: null });
    r = boardRow(kind, id);
    await createBoardChannel(kind, r);
    return boardRow(kind, id);
  }
  saveBoard(kind, id, { discord_members: JSON.stringify([...current]), discord_error: null });
  return boardRow(kind, id);
}

async function syncBoardArchive(kind, r) {
  const closed = boardClosed(kind, r);
  if (!!r.discord_archived === closed) return;
  const archive = boardArchive();
  const parent = closed ? (isId(archive) ? archive : null) : boardConfig().categoryId;
  if (parent) await rest('PATCH', `/channels/${r.discord_channel_id}`, { parent_id: parent, lock_permissions: false });
  saveBoard(kind, r.id, { discord_archived: closed ? 1 : 0 });
}

const boardKey = (kind, id) => `${kind}-${id}`;
const boardError = (kind, id) => (err) => {
  try {
    saveBoard(kind, id, { discord_error: truncate(err.message, 300) });
  } catch {
    /* evtl. gelöscht */
  }
};

/** Neue Bewerbung / neues Anliegen → Board-Ticket anlegen. */
function boardCreated(kind, id, opts = {}) {
  if (!boardActive(kind)) return Promise.resolve();
  return enqueue(
    boardKey(kind, id),
    async () => {
      const r = boardRow(kind, id);
      if (r && !r.discord_channel_id) await createBoardChannel(kind, r, opts);
    },
    boardError(kind, id)
  );
}

/** Nachricht ins Board-Ticket; danach Archiv-Zustand angleichen. msg wie bei post(). */
function boardPost(kind, id, msg) {
  if (!boardActive(kind)) return Promise.resolve();
  return enqueue(
    boardKey(kind, id),
    async () => {
      let r = await ensureBoard(kind, id);
      if (!r) return;
      if (!boardClosed(kind, r) && r.discord_archived) {
        await syncBoardArchive(kind, r);
        r = boardRow(kind, id);
      }
      const payload = {
        embeds: [embed({ ...msg, footer: msg.by ? `${msg.by} · Board of Partners` : 'Board of Partners' })],
        allowed_mentions: { parse: [] },
      };
      try {
        await send(r.discord_channel_id, payload);
      } catch (err) {
        if (err.code !== 10003) throw err;
        saveBoard(kind, id, { discord_channel_id: null, discord_members: null, discord_archived: 0, discord_panel_id: null, discord_panel_state: null });
        r = await ensureBoard(kind, id);
        await send(r.discord_channel_id, payload);
      }
      await syncBoardArchive(kind, boardRow(kind, id));
      await refreshPanel(kind, boardRow(kind, id), (f) => saveBoard(kind, id, f));
    },
    boardError(kind, id)
  );
}

/** Mitglieder/Archiv eines Board-Tickets abgleichen (legt es an, falls es fehlt). */
function boardSync(kind, id, { recreate = false } = {}) {
  if (!boardActive(kind)) return Promise.resolve();
  if (recreate) saveBoard(kind, id, { discord_deleted: 0 });
  return enqueue(
    boardKey(kind, id),
    async () => {
      const r = await ensureBoard(kind, id);
      if (r) {
        await syncBoardArchive(kind, r);
        await refreshPanel(kind, boardRow(kind, id), (f) => saveBoard(kind, id, f));
      }
    },
    boardError(kind, id)
  );
}

/** Nach Beförderung, Rollenwechsel oder Discord-Verknüpfung: alle offenen Board-Tickets abgleichen. */
function syncBoardAll() {
  const jobs = [];
  for (const kind of Object.keys(BOARD_KINDS)) {
    if (!boardActive(kind)) continue;
    const t = BOARD_KINDS[kind];
    const rows = db.prepare(`SELECT id FROM ${t.table} WHERE discord_channel_id IS NOT NULL AND status NOT IN (${t.closed.map(() => '?').join(',')})`).all(...t.closed);
    rows.forEach((r) => jobs.push(boardSync(kind, r.id)));
  }
  return Promise.all(jobs);
}

/** Bewerbung/Anliegen gelöscht → Hinweis und ins Archiv (Verlauf bleibt). */
function boardDeleted(kind, r, by) {
  if (!boardActive(kind) || !r.discord_channel_id) return Promise.resolve();
  return enqueue(`deleted-${kind}-${r.id}`, async () => {
    await send(r.discord_channel_id, {
      embeds: [embed({ title: `🗑️ ${BOARD_KINDS[kind].label} ${kind === 'application' ? r.number : r.reference || ''} wurde gelöscht`, description: 'Der Kanal bleibt zur Nachverfolgung im Archiv.', color: COLORS.slate, footer: by ? `${by} · Board of Partners` : undefined })],
      allowed_mentions: { parse: [] },
    }).catch(() => {});
    const archive = boardArchive();
    if (isId(archive)) await rest('PATCH', `/channels/${r.discord_channel_id}`, { parent_id: archive, lock_permissions: false }).catch(() => {});
  });
}

/** Infos für Bewerbung/Anliegen im Dashboard (nur Board). */
function boardTicketInfo(kind, r) {
  if (!boardActive(kind) || !r) return null;
  return {
    url: r.discord_channel_id && isId(config().guildId) ? `https://discord.com/channels/${config().guildId}/${r.discord_channel_id}` : null,
    exists: !!r.discord_channel_id,
    deleted: !r.discord_channel_id && !!r.discord_deleted,
    archived: !!r.discord_archived,
    error: r.discord_error || null,
  };
}

/** Infos für die Akte im Dashboard / auf der Website. */
function ticketInfo(c, viewer) {
  if (!active()) return null;
  const staff = viewer && (viewer.role === 'anwalt' || viewer.role === 'admin');
  return {
    url: channelUrl(c),
    exists: !!c.discord_channel_id,
    deleted: !c.discord_channel_id && !!c.discord_deleted,
    clientLinked: clientDiscordIds(c).length > 0,
    clientInTicket: !!clientInChannel(c),
    archived: !!c.discord_archived,
    error: staff ? c.discord_error || null : undefined,
  };
}

/** Einrichtung prüfen: Token, Server, Kategorien, Rollen, Rechte des Bots. */
async function test() {
  const cfg = config();
  const checks = [];
  const add = (ok, label, detail = '') => checks.push({ ok, label, detail });
  if (!token()) {
    add(false, 'Bot-Token', 'DISCORD_BOT_TOKEN ist in Render nicht gesetzt.');
    return { ok: false, checks };
  }
  let me;
  try {
    await identifyOnce();
    me = await rest('GET', '/users/@me');
    botUser = { id: String(me.id), name: me.global_name || me.username, token: token() };
    setSetting('discord_bot_id', botUser.id);
    setSetting('discord_bot_name', botUser.name);
    add(true, 'Bot-Token', `angemeldet als ${botUser.name}`);
  } catch (err) {
    add(false, 'Bot-Token', err.message);
    return { ok: false, checks };
  }
  if (!isId(cfg.guildId)) {
    add(false, 'Discord-Server', 'Server-ID fehlt.');
    return { ok: false, checks };
  }
  let guild;
  try {
    guild = await rest('GET', `/guilds/${cfg.guildId}`);
    add(true, 'Discord-Server', guild.name);
  } catch (err) {
    add(false, 'Discord-Server', err.message);
    return { ok: false, checks };
  }
  // Rechte des Bots aus seinen Rollen berechnen
  try {
    const member = await rest('GET', `/guilds/${cfg.guildId}/members/${botUser.id}`);
    const roles = guild.roles || [];
    let perms = 0n;
    for (const r of roles) if (r.id === cfg.guildId || member.roles.includes(r.id)) perms |= BigInt(r.permissions);
    const has = (bit) => (perms & BigInt(P.ADMINISTRATOR)) !== 0n || (perms & BigInt(bit)) !== 0n;
    const missing = REQUIRED.filter((k) => !has(P[k])).map((k) => PERM_NAMES[k]);
    add(!missing.length, 'Berechtigungen des Bots', missing.length ? `Es fehlt: ${missing.join(', ')}` : 'vollständig');
    const roleIds = new Set(roles.map((r) => r.id));
    if (cfg.roleIds.length) {
      const unknown = cfg.roleIds.filter((id) => !roleIds.has(id));
      add(!unknown.length, 'Team-Rollen', unknown.length ? `Unbekannte Rollen-ID: ${unknown.join(', ')}` : roles.filter((r) => cfg.roleIds.includes(r.id)).map((r) => r.name).join(', '));
    } else {
      add(false, 'Team-Rollen', 'Keine Rolle eingetragen – dann sehen nur die zuständigen Anwälte (mit verknüpftem Discord) die Tickets.');
    }
  } catch (err) {
    add(false, 'Berechtigungen des Bots', err.message);
  }
  const b = boardConfig();
  if (b.roleIds.length) {
    try {
      const names = (guild.roles || []).filter((r) => b.roleIds.includes(r.id)).map((r) => r.name);
      const unknown = b.roleIds.filter((id) => !(guild.roles || []).some((r) => r.id === id));
      add(!unknown.length, 'Board-Rollen', unknown.length ? `Unbekannte Rollen-ID: ${unknown.join(', ')}` : names.join(', '));
    } catch (err) {
      add(false, 'Board-Rollen', err.message);
    }
  } else if (isId(b.categoryId)) {
    add(false, 'Board-Rollen', 'Keine Rolle eingetragen – dann sehen nur Board-Mitglieder mit verknüpftem Discord die Board-Tickets.');
  }
  for (const [label, id, required, emptyText] of [
    ['Kategorie Mandats-Tickets', cfg.categoryId, false, 'keine – Mandats-Tickets sind aus'],
    ['Archiv-Kategorie', cfg.archiveId, false, 'keine – geschlossene Tickets bleiben in ihrer Kategorie (Mandant nur noch lesend)'],
    ['Kategorie Board-Tickets', b.categoryId, false, 'keine – Board-Tickets (Bewerbungen, Anliegen) sind aus'],
    ['Board-Archiv', b.archiveId, false, 'keine – geschlossene Board-Tickets wandern ins allgemeine Archiv (bleiben privat)'],
  ]) {
    if (!isId(id)) {
      if (required) add(false, label, 'Kategorie-ID fehlt.');
      else add(true, label, emptyText);
      continue;
    }
    try {
      const ch = await rest('GET', `/channels/${id}`);
      const ok = ch.type === 4 && String(ch.guild_id) === cfg.guildId;
      add(ok, label, ok ? ch.name : 'Die ID gehört zu keiner Kategorie auf diesem Server.');
    } catch (err) {
      add(false, label, err.message);
    }
  }
  if (!isId(cfg.categoryId) && !isId(b.categoryId)) add(false, 'Kategorien', 'Mindestens eine Kategorie (Mandate oder Board) eintragen.');
  if (panelInteractive()) {
    try {
      await registerCommands({ force: true });
      add(true, 'Buttons & Befehle', `Public Key gesetzt, ${COMMANDS.length} Befehle angemeldet (${COMMANDS.map((c) => '/' + c.name).join(', ')})`);
    } catch (err) {
      add(false, 'Buttons & Befehle', `Die Befehle konnten nicht angemeldet werden: ${err.message}`);
    }
  } else {
    add(true, 'Buttons & Befehle', 'kein DISCORD_PUBLIC_KEY – nur „Im Dashboard öffnen“, keine Befehle');
  }
  const ok = checks.every((c) => c.ok || c.label === 'Team-Rollen' || c.label === 'Board-Rollen');
  setSetting('discord_ticket_last_test', JSON.stringify({ at: new Date().toISOString(), ok }));
  return { ok, checks };
}

function status() {
  const cfg = config();
  let lastTest = null;
  try {
    lastTest = JSON.parse(getSetting('discord_ticket_last_test', 'null'));
  } catch {
    lastTest = null;
  }
  return {
    tokenSet: !!token(),
    active: active(),
    botName: getSetting('discord_bot_name', '') || null,
    oauthConfigured: discord.oauthConfigured(),
    inviteUrl: inviteUrl(),
    lastTest,
    ...cfg,
    board: { ...boardConfig(), activeApplications: boardActive('application'), activeConcerns: boardActive('concern') },
    panel: {
      interactive: panelInteractive(),
      publicUrl: !!siteBase(),
      interactionsUrl: `${siteBase() || ''}/api/discord/interactions`,
    },
    counts: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN discord_channel_id IS NOT NULL THEN 1 ELSE 0 END) AS withTicket FROM cases WHERE status != 'geschlossen'").get(),
    boardCounts: {
      applications: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN discord_channel_id IS NOT NULL THEN 1 ELSE 0 END) AS withTicket FROM applications WHERE status NOT IN ('angenommen','abgelehnt')").get(),
      concerns: db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN discord_channel_id IS NOT NULL THEN 1 ELSE 0 END) AS withTicket FROM concerns WHERE status NOT IN ('erledigt','abgelehnt')").get(),
    },
  };
}

/* ================================================================
   Slash-Commands: /add, /remove, /delete im Ticket; übrige Befehle siehe botCommands.js
   ================================================================ */
const TICKET_TABLES = { case: 'cases', application: 'applications', concern: 'concerns' };

/** Zu welchem Ticket gehört dieser Kanal? → { kind, row } oder null */
function ticketByChannel(channelId) {
  if (!isId(channelId)) return null;
  for (const [kind, table] of Object.entries(TICKET_TABLES)) {
    const row = db.prepare(`SELECT id FROM ${table} WHERE discord_channel_id = ?`).get(channelId);
    if (row) return { kind, row: kind === 'case' ? getCase(row.id) : boardRow(kind, row.id) };
  }
  return null;
}

/** Gehört die Person ohnehin fest zum Ticket (Anwalt, Mandant, Board)? Dann nicht per /remove entfernbar. */
function fixedMemberRole(kind, row, userId) {
  if (kind === 'case') {
    const w = wantedMembers({ ...row, discord_extra: '[]' });
    return w.get(userId) === 'lawyer' ? 'zuständiger Anwalt' : w.get(userId) === 'client' ? 'Mandant' : null;
  }
  return boardMemberIds().includes(userId) ? 'Mitglied des Board of Partners' : null;
}

/** Discord hat beim Befehl mitgeliefert, dass die Person auf dem Server ist – spart eine Abfrage. */
function markMember(userId) {
  const { guildId } = config();
  if (isId(guildId) && isId(userId)) memberCache.set(`${guildId}:${userId}`, { value: true, until: Date.now() + 30 * 60 * 1000 });
}

/** Person merken und Ticket abgleichen (fügt die Berechtigung hinzu bzw. entfernt sie). */
function setExtra(kind, id, userId, add) {
  const table = TICKET_TABLES[kind];
  const row = db.prepare(`SELECT discord_extra FROM ${table} WHERE id = ?`).get(id);
  if (!row) return false;
  const list = parseExtra(row);
  const has = list.includes(userId);
  if (add === has) return false;
  const next = add ? [...list, userId].slice(-25) : list.filter((x) => x !== userId);
  db.prepare(`UPDATE ${table} SET discord_extra = ? WHERE id = ?`).run(JSON.stringify(next), id);
  return true;
}
function syncTicket(kind, id) {
  return kind === 'case' ? syncCase(id) : boardSync(kind, id);
}
const extraMembers = (row) => parseExtra(row);

/**
 * Ticket-Kanal löschen (/delete). Akte, Bewerbung bzw. Anliegen bleiben unverändert – nur der Discord-Kanal
 * verschwindet. Danach wird er nicht automatisch neu angelegt (discord_deleted), sondern nur über
 * „Ticket anlegen“ im Dashboard. Vor dem Löschen erscheint ein kurzer Hinweis im Kanal.
 */
function deleteTicket(kind, id, { by, reason, delayMs = 5000 } = {}) {
  const table = TICKET_TABLES[kind];
  const row = table && db.prepare(`SELECT id, discord_channel_id FROM ${table} WHERE id = ?`).get(id);
  if (!row || !row.discord_channel_id) return null;
  const channelId = row.discord_channel_id;
  db.prepare(
    `UPDATE ${table} SET discord_deleted = 1, discord_channel_id = NULL, discord_members = NULL, discord_archived = 0,
       discord_panel_id = NULL, discord_panel_state = NULL, discord_extra = NULL, discord_error = NULL WHERE id = ?`
  ).run(id);
  const seconds = Math.round(delayMs / 1000);
  enqueue(kind === 'case' ? id : boardKey(kind, id), async () => {
    await send(channelId, {
      embeds: [
        embed({
          title: '🗑️ Ticket wird gelöscht',
          description: `Dieser Kanal wird in ${seconds} Sekunden gelöscht.${reason ? `\n\n**Grund:** ${truncate(reason, 300)}` : ''}`,
          color: COLORS.red,
          footer: by ? `${by} · Pake & Scha Legal Consulting` : undefined,
        }),
      ],
      allowed_mentions: { parse: [] },
    }).catch(() => {});
    await sleep(delayMs);
    await rest('DELETE', `/channels/${channelId}`).catch((err) => {
      if (err.status !== 404) throw err;
    });
  });
  return channelId;
}

const STR = 3;
const USER = 6;
const aktenzeichen = (description) => ({ type: STR, name: 'aktenzeichen', description, required: false, max_length: 20 });
const COMMANDS = [
  {
    name: 'add',
    description: 'Person zu diesem Ticket hinzufügen (z. B. Zeuge, Gutachter, Kollege)',
    options: [{ type: USER, name: 'person', description: 'Wer soll ins Ticket?', required: true }],
  },
  {
    name: 'remove',
    description: 'Hinzugefügte Person aus diesem Ticket entfernen',
    options: [{ type: USER, name: 'person', description: 'Wer soll raus?', required: true }],
  },
  {
    name: 'delete',
    description: 'Diesen Ticket-Kanal löschen (die Akte bleibt erhalten)',
    options: [{ type: STR, name: 'grund', description: 'Warum wird das Ticket gelöscht? (optional)', required: false, max_length: 200 }],
  },
  { name: 'passwort', description: 'Neues Passwort für dein Website-Konto – kommt per Direktnachricht' },
  { name: 'akte', description: 'Stand einer Akte anzeigen (im Ticket: diese Akte)', options: [aktenzeichen('z. B. PS-2026-0012 – im Ticket nicht nötig')] },
  {
    name: 'notiz',
    description: 'Interne Notiz zur Akte speichern (nur Kanzlei, für den Mandanten unsichtbar)',
    options: [
      { type: STR, name: 'text', description: 'Inhalt der Notiz', required: true, max_length: 1500 },
      aktenzeichen('z. B. PS-2026-0012 – im Ticket nicht nötig'),
    ],
  },
  {
    name: 'dienst',
    description: 'Dienststatus setzen (Stempeluhr der Website)',
    options: [
      {
        type: STR,
        name: 'status',
        description: 'Neuer Status',
        required: true,
        choices: [
          { name: '🟢 Im Dienst', value: 'dienst' },
          { name: '⚖️ Im Gericht', value: 'gericht' },
          { name: '☕ Pause', value: 'pause' },
          { name: '⚪ Außer Dienst', value: 'off' },
        ],
      },
      { type: STR, name: 'notiz', description: 'z. B. „Mission Row PD“ (optional)', required: false, max_length: 120 },
    ],
  },
  { name: 'imdienst', description: 'Wer von der Kanzlei ist gerade im Dienst?' },
  { name: 'termine', description: 'Deine nächsten Termine und Fristen' },
  { name: 'hilfe', description: 'Alle Befehle des Kanzlei-Bots' },
].map((c) => ({ type: 1, dm_permission: false, ...c }));

/**
 * Befehle (/add, /remove, /delete, /passwort, /akte, /notiz, /dienst, /imdienst, /termine, /hilfe) beim Discord-Server anmelden (Guild-Commands, sofort verfügbar). Nur mit Bot-Token,
 * Server-ID und Public Key (sonst kämen die Befehle nicht bei der Website an). Einmal je Einstellung.
 */
async function registerCommands({ force = false } = {}) {
  const cfg = config();
  if (!token() || !isId(cfg.guildId) || !panelInteractive()) return { ok: false, skipped: true };
  const app = await rest('GET', '/applications/@me');
  const key = crypto.createHash('sha256').update(`${app.id}|${cfg.guildId}|${JSON.stringify(COMMANDS)}|${token().slice(-8)}`).digest('hex').slice(0, 16);
  if (!force && getSetting('discord_commands_registered', '') === key) return { ok: true, cached: true };
  await rest('PUT', `/applications/${app.id}/guilds/${cfg.guildId}/commands`, COMMANDS);
  setSetting('discord_commands_registered', key);
  return { ok: true };
}

module.exports = {
  rest, // für Kooperationen (Discord-Rollen lesen) und Bot-Befehle
  embed,
  deleteTicket,
  siteBase,
  COMMANDS,
  hasToken: () => !!token(),
  markMember,
  ticketByChannel,
  fixedMemberRole,
  setExtra,
  syncTicket,
  extraMembers,
  registerCommands,
  publicKeyHex,
  boardActive,
  boardCreated,
  boardPost,
  boardSync,
  boardDeleted,
  syncBoardAll,
  boardTicketInfo,
  active,
  config,
  status,
  test,
  backfill,
  caseCreated,
  caseDeleted,
  syncCase,
  syncUser,
  post,
  joinGuild,
  ticketInfo,
  clientDiscordId,
  COLORS,
  INVITE_PERMISSIONS,
  isId,
};
