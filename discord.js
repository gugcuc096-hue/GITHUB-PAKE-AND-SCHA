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

function publicUrl(pathname = '/dashboard.html') {
  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base + pathname : undefined;
}

function buildPayload({ title, description, fields = [], color = GOLD, mentionIds = [], link }) {
  const mentions = [...new Set(mentionIds.filter((id) => /^\d{5,25}$/.test(String(id))))].map(String);
  return {
    username: 'Pake & Scha Kanzlei',
    content: mentions.length ? mentions.map((id) => `<@${id}>`).join(' ') : undefined,
    // Nur ausdrücklich genannte Nutzer pingen -- nie @everyone/@here aus Nutzertexten.
    allowed_mentions: { parse: [], users: mentions },
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
  const url = webhookUrl();
  if (!url || !enabledEvents().includes(event)) return;
  const payload = buildPayload({ link: publicUrl(), ...message });
  postWebhook(url, payload).catch((err) => console.warn(`Discord-Webhook (${event}) fehlgeschlagen: ${err.message}`));
}

async function sendTest(url, userName) {
  await postWebhook(
    url,
    buildPayload({
      title: 'Verbindung hergestellt',
      description: `Der Discord-Webhook der Kanzlei ist aktiv. Getestet von ${userName}.`,
      link: publicUrl(),
    })
  );
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
  enabledEvents,
  notify,
  sendTest,
  oauthConfig,
  authorizeUrl,
  fetchDiscordUser,
};
