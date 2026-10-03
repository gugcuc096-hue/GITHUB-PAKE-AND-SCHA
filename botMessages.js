'use strict';
/*
 * Kanzlei-Bot: eigene Nachrichten (wie Sapphire „Messages → Templates“).
 *
 *  - Vorlage = Text + Embed (Autor, Titel, Link, Beschreibung, Farbe, Bilder, Felder, Fußzeile, Zeitstempel) + Link-Buttons
 *  - Senden: von Hand in einen Kanal · gesendete Nachrichten später auf den Stand der Vorlage bringen oder löschen
 *  - Zeitplan: alle N Minuten/Stunden/Tage ab einer Startzeit in einen Kanal (verpasste Termine einmal nachholen)
 *  - Alle X Nachrichten: nach X Nachrichten von Mitgliedern im Kanal erneut posten; optional die vorige Kopie löschen,
 *    dann bleibt die Nachricht immer unten („Sticky“). Dafür bekommt der Bot das – nicht privilegierte – Gateway-Intent
 *    GUILD_MESSAGES; den Inhalt fremder Nachrichten liest er nicht (nur: neue Nachricht in Kanal X).
 *
 * Erwähnungen (@everyone, Rollen, Personen) pingen nur, wenn die Vorlage das ausdrücklich erlaubt.
 */
const { db } = require('./db');
const { truncate } = require('./helpers');
const tickets = require('./tickets');

const { isId } = tickets;
const MAX_TEMPLATES = 50;
const MAX_JOBS = 10; // je Vorlage
const MIN_INTERVAL = 5; // Minuten
const MAX_INTERVAL = 30 * 24 * 60;
const STICKY_COOLDOWN = 15 * 1000;
const now = () => new Date().toISOString();
const guildId = () => tickets.config().guildId;

/* Eigene Warteschlange – unabhängig vom (evtl. langen) Rollen-Abgleich */
let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(fn).catch((err) => console.warn('Discord-Bot (Nachrichten):', err.message));
  chain = run;
  return run;
}

const parse = (raw) => {
  try {
    const d = JSON.parse(raw || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
};

/* ---------------------------------------------------------------- Platzhalter & Aufbau */
const PLACEHOLDERS = {
  '{server}': 'Servername',
  '{membercount}': 'Mitgliederzahl',
  '{date}': 'heutiges Datum',
  '{time}': 'aktuelle Uhrzeit',
  '{website}': 'Link zur Website',
};

let guildCache = null;
async function guildInfo() {
  if (guildCache && guildCache.id === guildId() && guildCache.until > Date.now()) return guildCache.data;
  const data = await tickets.rest('GET', `/guilds/${guildId()}?with_counts=true`);
  guildCache = { id: guildId(), data, until: Date.now() + 5 * 60 * 1000 };
  return data;
}

function variables(guild) {
  const tz = { timeZone: 'Europe/Berlin' };
  return {
    '{server}': (guild && guild.name) || 'Server',
    '{membercount}': guild && guild.approximate_member_count ? String(guild.approximate_member_count) : '',
    '{date}': new Date().toLocaleDateString('de-DE', { ...tz, day: '2-digit', month: '2-digit', year: 'numeric' }),
    '{time}': new Date().toLocaleTimeString('de-DE', { ...tz, hour: '2-digit', minute: '2-digit' }),
    '{website}': tickets.siteBase() || '',
  };
}
const fill = (text, v) => String(text || '').replace(/\{(?:server|membercount|date|time|website)\}/g, (m) => v[m] ?? m);
const httpsUrl = (u) => (/^https:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim() : null);

/** Discord-Nachricht aus einer Vorlage – null, wenn sie leer wäre. */
function build(data, guild) {
  const v = variables(guild);
  const e = data.embed || {};
  let embed = null;
  if (e.enabled) {
    const out = {};
    const author = fill(e.author, v).trim();
    const title = fill(e.title, v).trim();
    const description = fill(e.description, v).trim();
    const footer = fill(e.footer, v).trim();
    if (author) out.author = { name: truncate(author, 256) };
    if (title) out.title = truncate(title, 256);
    if (title && httpsUrl(e.url)) out.url = httpsUrl(e.url);
    if (description) out.description = truncate(description, 4000);
    const color = parseInt(String(e.color || '').replace('#', ''), 16);
    if (Number.isFinite(color)) out.color = color;
    if (e.thumbnail === 'server' && guild && guild.icon) out.thumbnail = { url: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256` };
    else if (e.thumbnail === 'url' && httpsUrl(e.thumbnailUrl)) out.thumbnail = { url: httpsUrl(e.thumbnailUrl) };
    if (httpsUrl(e.image)) out.image = { url: httpsUrl(e.image) };
    const fields = (Array.isArray(e.fields) ? e.fields : [])
      .map((f) => ({ name: fill(f.name, v).trim(), value: fill(f.value, v).trim(), inline: !!f.inline }))
      .filter((f) => f.name && f.value)
      .slice(0, 10)
      .map((f) => ({ name: truncate(f.name, 256), value: truncate(f.value, 1024), inline: f.inline }));
    if (fields.length) out.fields = fields;
    if (footer) out.footer = { text: truncate(footer, 2048) };
    if (e.timestamp) out.timestamp = now();
    if (out.author || out.title || out.description || out.image || out.thumbnail || out.fields) embed = out;
  }
  const content = truncate(fill(data.content, v).trim(), 2000);
  const buttons = (Array.isArray(data.buttons) ? data.buttons : [])
    .filter((b) => b && String(b.label || '').trim() && httpsUrl(b.url))
    .slice(0, 5)
    .map((b) => ({ type: 2, style: 5, label: truncate(String(b.label).trim(), 80), url: httpsUrl(b.url) }));
  if (!content && !embed) return null;
  return {
    content,
    embeds: embed ? [embed] : [],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
    allowed_mentions: data.allowMentions ? { parse: ['roles', 'users', 'everyone'] } : { parse: [] },
  };
}

/** Zeichen im Embed (Discord erlaubt höchstens 6000). */
function embedLength(data) {
  const e = data.embed || {};
  if (!e.enabled) return 0;
  return [e.author, e.title, e.description, e.footer, ...(e.fields || []).flatMap((f) => [f.name, f.value])].reduce((n, s) => n + String(s || '').length, 0);
}

/* ---------------------------------------------------------------- Vorlagen lesen */
const getTemplate = (id) => db.prepare('SELECT * FROM bot_messages WHERE id = ?').get(id);

function jobRow(j) {
  return {
    id: j.id,
    kind: j.kind,
    channelId: j.channel_id,
    enabled: !!j.enabled,
    intervalMinutes: j.interval_minutes,
    nextRunAt: j.next_run_at,
    everyMessages: j.every_messages,
    counter: j.counter,
    replacePrevious: !!j.replace_previous,
    lastSentAt: j.last_sent_at,
    lastError: j.last_error,
    createdByName: j.created_by_name,
  };
}

function templateRow(t) {
  return {
    id: t.id,
    name: t.name,
    data: parse(t.data),
    updatedByName: t.updated_by_name,
    updatedAt: t.updated_at,
    jobs: db.prepare('SELECT * FROM bot_message_jobs WHERE template_id = ? ORDER BY id').all(t.id).map(jobRow),
    sent: db
      .prepare('SELECT * FROM bot_message_sent WHERE template_id = ? ORDER BY id DESC LIMIT 20')
      .all(t.id)
      .map((s) => ({ id: s.id, channelId: s.channel_id, messageId: s.discord_message_id, sentByName: s.sent_by_name, sentAt: s.sent_at, updatedAt: s.updated_at })),
  };
}
const listTemplates = () => db.prepare('SELECT * FROM bot_messages ORDER BY name COLLATE NOCASE, id').all().map(templateRow);

/* ---------------------------------------------------------------- Senden, aktualisieren, löschen */
async function message(t) {
  const msg = build(parse(t.data), await guildInfo().catch(() => null));
  if (!msg) throw Object.assign(new Error('Die Vorlage ist leer – bitte Text oder Embed ausfüllen.'), { status: 400 });
  return msg;
}

/** Von Hand senden (merkt sich die Nachricht zum späteren Aktualisieren). */
async function sendTemplate(t, channelId, byName) {
  const msg = await message(t);
  const res = await tickets.rest('POST', `/channels/${channelId}/messages`, msg);
  db.prepare('INSERT INTO bot_message_sent (template_id, channel_id, discord_message_id, sent_by_name) VALUES (?, ?, ?, ?)').run(t.id, channelId, String(res.id), byName || '');
  return res;
}

/** Gesendete Nachricht auf den aktuellen Stand der Vorlage bringen. */
async function updateSent(t, sent) {
  const msg = await message(t);
  try {
    await tickets.rest('PATCH', `/channels/${sent.channel_id}/messages/${sent.discord_message_id}`, msg);
  } catch (err) {
    if (err.code === 10008 || err.code === 10003) {
      db.prepare('DELETE FROM bot_message_sent WHERE id = ?').run(sent.id);
      throw Object.assign(new Error('Die Nachricht gibt es in Discord nicht mehr – sie wurde aus der Liste entfernt.'), { status: 404 });
    }
    throw err;
  }
  db.prepare('UPDATE bot_message_sent SET updated_at = ? WHERE id = ?').run(now(), sent.id);
}

async function deleteSent(sent) {
  await tickets.rest('DELETE', `/channels/${sent.channel_id}/messages/${sent.discord_message_id}`).catch((err) => {
    if (err.status !== 404) throw err;
  });
  db.prepare('DELETE FROM bot_message_sent WHERE id = ?').run(sent.id);
}

/* ---------------------------------------------------------------- Automatik */
/** Eine Automatik ausführen: neu posten, danach (falls gewünscht) die vorige Kopie löschen. */
async function postJob(jobId) {
  const job = db.prepare('SELECT * FROM bot_message_jobs WHERE id = ?').get(jobId);
  const t = job && getTemplate(job.template_id);
  if (!job || !t || !job.enabled) return;
  try {
    const res = await tickets.rest('POST', `/channels/${job.channel_id}/messages`, await message(t));
    if (job.replace_previous && job.last_message_id) {
      await tickets.rest('DELETE', `/channels/${job.channel_id}/messages/${job.last_message_id}`).catch(() => {});
    }
    db.prepare('UPDATE bot_message_jobs SET last_message_id = ?, last_sent_at = ?, last_error = NULL WHERE id = ?').run(String(res.id), now(), job.id);
  } catch (err) {
    db.prepare('UPDATE bot_message_jobs SET last_error = ?, last_sent_at = ? WHERE id = ?').run(truncate(err.message, 300), now(), job.id);
    console.warn(`Discord-Bot: Automatik „${t.name}“ fehlgeschlagen:`, err.message);
  }
}

/** Zeitplan: fällige Automatiken posten; der nächste Termin liegt immer in der Zukunft (keine Nachrichtenflut nach Ausfällen). */
function runSchedules() {
  if (!tickets.hasToken()) return;
  const due = db.prepare("SELECT * FROM bot_message_jobs WHERE kind = 'zeitplan' AND enabled = 1 AND next_run_at <= ?").all(now());
  for (const job of due) {
    const step = Math.max(MIN_INTERVAL, job.interval_minutes || 60) * 60e3;
    const last = Date.parse(job.next_run_at) || Date.now();
    const next = last + Math.max(1, Math.ceil((Date.now() - last + 1) / step)) * step;
    db.prepare('UPDATE bot_message_jobs SET next_run_at = ? WHERE id = ?').run(new Date(next).toISOString(), job.id);
    enqueue(() => postJob(job.id));
  }
}

/** Gibt es aktive „alle X Nachrichten“-Automatiken? (Dann braucht das Gateway das Intent GUILD_MESSAGES.) */
const hasMessageJobs = () => !!db.prepare("SELECT 1 FROM bot_message_jobs WHERE kind = 'nachrichten' AND enabled = 1 LIMIT 1").get();

const inflight = new Set();
/** Neue Nachricht im Server (Gateway MESSAGE_CREATE): Zähler der Kanal-Automatiken erhöhen. Bots zählen nicht. */
function onMessage(d) {
  if (!d || d.guild_id !== guildId() || !d.author || d.author.bot || d.webhook_id) return;
  const jobs = db.prepare("SELECT * FROM bot_message_jobs WHERE kind = 'nachrichten' AND enabled = 1 AND channel_id = ?").all(d.channel_id);
  for (const job of jobs) {
    const counter = (job.counter || 0) + 1;
    const cooling = job.last_sent_at && Date.now() - Date.parse(job.last_sent_at) < STICKY_COOLDOWN;
    if (counter >= (job.every_messages || 1) && !cooling && !inflight.has(job.id)) {
      db.prepare('UPDATE bot_message_jobs SET counter = 0 WHERE id = ?').run(job.id);
      inflight.add(job.id);
      enqueue(() => postJob(job.id)).finally(() => inflight.delete(job.id));
    } else {
      db.prepare('UPDATE bot_message_jobs SET counter = ? WHERE id = ?').run(counter, job.id);
    }
  }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      runSchedules();
    } catch (err) {
      console.warn('Discord-Bot: Zeitplan fehlgeschlagen:', err.message);
    }
  }, 30 * 1000);
  timer.unref();
}

module.exports = {
  PLACEHOLDERS,
  MAX_TEMPLATES,
  MAX_JOBS,
  MIN_INTERVAL,
  MAX_INTERVAL,
  build,
  embedLength,
  getTemplate,
  templateRow,
  listTemplates,
  sendTemplate,
  updateSent,
  deleteSent,
  postJob,
  runSchedules,
  hasMessageJobs,
  onMessage,
  start,
  enqueue,
  isId,
};
