'use strict';
const { getSetting } = require('./db');
const { truncate } = require('./helpers');

const GOLD = 0xd4af37;
const RED = 0xef4444;

// Nur echte Discord-Webhook-URLs zulassen (verhindert, dass der Server
// beliebige Adressen aufruft).
const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const EVENTS = {
  'case.created': 'Neues Mandat / neue Akte',
  'case.status': 'Statusänderung einer Akte',
  'calendar.created': 'Neuer Gerichtstermin / neue Frist',
  'calendar.reminder': 'Erinnerung 24 h vor Frist oder Gerichtstermin',
  'appointment.requested': 'Terminanfrage eines Mandanten',
  'invoice.created': 'Rechnung / Honorarvereinbarung erstellt',
  'message.broadcast': 'Rundschreiben an das Team',
  'application.created': 'Neue Bewerbung',
  'duty.changed': 'Dienstbeginn / Dienstende eines Anwalts',
  'task.assigned': 'Aufgabe einem anderen Teammitglied zugewiesen',
};

function isValidWebhookUrl(url) {
  return WEBHOOK_RE.test(String(url || '').trim());
}

function webhookUrl() {
  const fromDb = getSetting('discord_webhook_url', '');
  const url = fromDb || process.env.DISCORD_WEBHOOK_URL || '';
  return isValidWebhookUrl(url) ? url.trim() : '';
}

/**
 * Eigener Kanal je Ereignis: Ein Discord-Webhook gehört immer zu genau einem Kanal.
 * Für verschiedene Kanäle wird deshalb je Kanal ein Webhook angelegt und hier dem
 * Ereignis zugeordnet. Ereignisse ohne Eintrag gehen an den Standard-Webhook.
 */
function eventWebhooks() {
  const raw = getSetting('discord_event_webhooks', null);
  if (!raw) return {};
  try {
    const map = JSON.parse(raw);
    const out = {};
    for (const [event, url] of Object.entries(map || {})) {
      if (EVENTS[event] && isValidWebhookUrl(url)) out[event] = String(url).trim();
    }
    return out;
  } catch {
    return {};
  }
}

function webhookFor(event) {
  return eventWebhooks()[event] || webhookUrl();
}

function enabledEvents() {
  const raw = getSetting('discord_events', null);
  if (!raw) return Object.keys(EVENTS);
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((e) => EVENTS[e]) : Object.keys(EVENTS);
  } catch {
    return Object.keys(EVENTS);
  }
}

/* ---------------------------------------------------------------- Rollen-Ping */
// Eine Discord-Rolle (z. B. die Anwälte) wird bei ausgewählten Ereignissen erwähnt.
// @everyone/@here bleiben ausgeschlossen – gepingt wird nur genau diese Rolle.
const DEFAULT_PING_EVENTS = ['case.created'];

/** Akzeptiert die Rollen-ID oder die Erwähnung <@&ID>; liefert '' (leer), die ID oder null (ungültig). */
function parseRoleId(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const m = s.match(/^<@&(\d{15,25})>$/) || s.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}

function pingRole() {
  return parseRoleId(getSetting('discord_ping_role', '') || process.env.DISCORD_PING_ROLE || '') || '';
}

function pingEvents() {
  const raw = getSetting('discord_ping_events', null);
  if (!raw) return DEFAULT_PING_EVENTS;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((e) => EVENTS[e]) : DEFAULT_PING_EVENTS;
  } catch {
    return DEFAULT_PING_EVENTS;
  }
}

/** Eigene Rolle je Ereignis (leer = Standard-Rolle). */
function eventRoles() {
  const raw = getSetting('discord_event_roles', null);
  if (!raw) return {};
  try {
    const out = {};
    for (const [event, id] of Object.entries(JSON.parse(raw) || {})) {
      const role = parseRoleId(id);
      if (EVENTS[event] && role) out[event] = role;
    }
    return out;
  } catch {
    return {};
  }
}

/** Welche Rolle bei diesem Ereignis gepingt wird ([] = kein Ping). */
function rolesFor(event) {
  if (!pingEvents().includes(event)) return [];
  const role = eventRoles()[event] || pingRole();
  return role ? [role] : [];
}

function publicUrl(pathname = '/dashboard.html') {
  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base + pathname : undefined;
}

function buildPayload({ title, description, fields = [], color = GOLD, mentionIds = [], roleIds = [], link }) {
  const mentions = [...new Set(mentionIds.filter((id) => /^\d{5,25}$/.test(String(id))))].map(String);
  const roles = [...new Set(roleIds.filter((id) => /^\d{15,25}$/.test(String(id))))].map(String);
  const content = [...roles.map((id) => `<@&${id}>`), ...mentions.map((id) => `<@${id}>`)].join(' ');
  return {
    username: 'Pake & Scha Kanzlei',
    content: content || undefined,
    // Nur ausdrücklich genannte Nutzer und die eingestellte Rolle pingen -- nie @everyone/@here aus Nutzertexten.
    allowed_mentions: { parse: [], users: mentions, roles },
    embeds: [
      {
        title: truncate(title, 256),
        description: description ? truncate(description, 4000) : undefined,
        color,
        url: link,
        fields: fields
          .filter((f) => f && f.name)
          .slice(0, 25)
          .map((f) => ({ name: truncate(f.name, 256), value: truncate(f.value || '—', 1024), inline: f.inline !== false })),
        footer: { text: 'Pake & Scha Legal Consulting' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function postWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord antwortet mit ${res.status}${text ? ': ' + truncate(text, 200) : ''}`);
  }
}

/**
 * Sendet ein Kanzlei-Update an Discord, falls ein Webhook konfiguriert und das
 * Ereignis aktiviert ist. Blockiert nie die eigentliche Anfrage; Fehler landen im Log.
 */
function notify(event, message) {
  const url = webhookFor(event);
  if (!url || !enabledEvents().includes(event)) return;
  const payload = buildPayload({ link: publicUrl(), ...message, roleIds: rolesFor(event) });
  postWebhook(url, payload).catch((err) => console.warn(`Discord-Webhook (${event}) fehlgeschlagen: ${err.message}`));
}

/**
 * Testnachricht an jeden eingerichteten Kanal. Jede Nachricht nennt die Ereignisse,
 * die in diesem Kanal ankommen – so lässt sich die Zuordnung direkt in Discord prüfen.
 * Liefert { sent, failed: [{ events, error }] }.
 */
async function sendTestAll(userName) {
  const enabled = enabledEvents();
  const channels = new Map();
  const standard = webhookUrl();
  if (standard) channels.set(standard, []);
  for (const event of Object.keys(EVENTS)) {
    const url = webhookFor(event);
    if (!url) continue;
    if (!channels.has(url)) channels.set(url, []);
    if (enabled.includes(event)) channels.get(url).push(event);
  }
  const result = { sent: 0, failed: [], pinged: [] };
  for (const [url, events] of channels) {
    // Rollen in der Beschreibung werden von Discord als Name angezeigt (ohne zu pingen) –
    // so sieht man direkt, ob die Rollen-ID stimmt.
    const list = events.length
      ? events.map((e) => `• ${EVENTS[e]}${rolesFor(e).length ? ` → pingt <@&${rolesFor(e)[0]}>` : ''}`).join('\n')
      : '• (keine Ereignisse eingeschaltet)';
    const roles = [...new Set(events.flatMap((e) => rolesFor(e)))];
    const standardNote = url === standard ? '\n\nDas ist der Standard-Kanal: Ereignisse ohne eigenen Kanal landen hier.' : '';
    const pingNote = roles.length
      ? '\n\nKam über dieser Nachricht kein Ping an? Dann in Discord: Servereinstellungen → Rollen → Rolle wählen → „Erlaube jedem, @mention für diese Rolle zu verwenden“ einschalten. Ohne diese Einstellung dürfen Webhooks die Rolle nicht pingen.'
      : '';
    try {
      await postWebhook(
        url,
        buildPayload({
          title: 'Verbindung hergestellt',
          description: `Getestet von ${userName}. In diesem Kanal kommen an:\n${list}${standardNote}${pingNote}`,
          link: publicUrl(),
          roleIds: roles,
        })
      );
      result.sent += 1;
      result.pinged.push(...roles);
    } catch (err) {
      result.failed.push({ events: events.map((e) => EVENTS[e]), error: err.message });
    }
  }
  result.pinged = [...new Set(result.pinged)];
  return result;
}

/* ================================================================
   OAuth2 (Discord-Konto mit Website-Konto verknüpfen / Discord-Login)
   ================================================================ */
function publicBase(req) {
  const fromEnv = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(fromEnv) ? fromEnv : `${req.protocol}://${req.get('host')}`;
}

function oauthConfig(req) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.DISCORD_REDIRECT_URI || `${publicBase(req)}/api/discord/callback`,
  };
}

function authorizeUrl(cfg, state) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function fetchDiscordUser(cfg, code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`Token-Austausch fehlgeschlagen (${tokenRes.status})`);
  const token = await tokenRes.json();

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!userRes.ok) throw new Error(`Discord-Profil konnte nicht geladen werden (${userRes.status})`);
  const u = await userRes.json();
  return { id: String(u.id), username: u.global_name || u.username, avatar: u.avatar || null };
}

module.exports = {
  GOLD,
  RED,
  EVENTS,
  isValidWebhookUrl,
  webhookUrl,
  eventWebhooks,
  webhookFor,
  enabledEvents,
  DEFAULT_PING_EVENTS,
  parseRoleId,
  pingRole,
  pingEvents,
  eventRoles,
  rolesFor,
  notify,
  sendTestAll,
  oauthConfig,
  authorizeUrl,
  fetchDiscordUser,
};
