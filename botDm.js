'use strict';
/*
 * Kanzlei-Bot: Nachrichten-Vorlage per Direktnachricht an alle Mitglieder mit einer Rolle – z. B. die Anleitung
 * für die Mitarbeiter eines Kooperationspartners („So bekommt ihr den VIP-Preis“).
 *
 *  - Empfänger: Mitglieder des Kanzlei-Servers mit der gewählten Rolle (ohne Bots), höchstens MAX_RECIPIENTS.
 *  - Langsam: eine Direktnachricht alle SEND_GAP_MS – Discord wertet schnelle Massen-DMs als Spam.
 *  - Ein Durchgang gleichzeitig; Fortschritt und Ergebnis stehen in bot_dm_runs (abbrechbar).
 *
 * Optional „Website-Zugang mitschicken“:
 *  - Konto mit diesem Discord vorhanden → nur Hinweis (E-Mail-Adresse, „Mit Discord anmelden“, /passwort).
 *    Das Passwort bleibt unverändert – niemand verliert seinen Zugang.
 *  - Noch kein Konto → Mandantenkonto mit verknüpftem Discord (Kooperationen über Discord-Rollen greifen damit
 *    sofort) und Einmal-Passwort wie bei /passwort: steht nur in der Direktnachricht (Spoiler), gespeichert wird
 *    nur der Hash, beim ersten Login mit Passwort wird ein eigenes festgelegt. Kommt die Nachricht nicht an
 *    (Direktnachrichten geschlossen), wird das neue Konto wieder entfernt.
 *  - Gesperrte Konten bekommen nur die Vorlage, keine Zugangsdaten.
 */
const { db } = require('./db');
const { hashPassword, generateTempPassword } = require('./auth');
const { truncate, firmEmail, firmLocalFrom, EMAIL_DOMAIN } = require('./helpers');
const { logActivity } = require('./models');
const tickets = require('./tickets');
const msgs = require('./botMessages');
const bot = require('./discordBot');

const MAX_RECIPIENTS = 250;
const SEND_GAP_MS = process.env.BOT_DM_GAP_MS !== undefined ? Math.max(0, Number(process.env.BOT_DM_GAP_MS) || 0) : 1500; // Tests: 0
const MAX_PROBLEMS = 50;
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let active = null; // { id, cancel }

/** Anzeigename auf dem Server (Spitzname, sonst globaler Name, sonst Benutzername). */
const memberName = (m) => String(m.nick || m.user.global_name || m.user.username || 'Mitglied').trim();

async function roleInfo(roleId) {
  const roles = await tickets.rest('GET', `/guilds/${tickets.config().guildId}/roles`);
  const r = (roles || []).find((x) => String(x.id) === roleId);
  if (!r) throw Object.assign(new Error('Diese Rolle gibt es auf dem Server nicht.'), { status: 400 });
  return { id: String(r.id), name: r.name };
}

/** Mitglieder mit der Rolle (ohne Bots), nach Namen sortiert. */
async function membersWithRole(roleId) {
  const all = await bot.listMembers();
  return all
    .filter((m) => m.user && !m.user.bot && (m.roles || []).map(String).includes(roleId))
    .sort((a, b) => memberName(a).localeCompare(memberName(b), 'de'));
}

const accountOf = (discordId) => db.prepare('SELECT id, email, display_name, active FROM users WHERE discord_id = ?').get(discordId);

function ensureReady() {
  if (!tickets.hasToken()) throw Object.assign(new Error('Kein Bot-Token (DISCORD_BOT_TOKEN in Render setzen).'), { status: 400 });
  if (!tickets.isId(tickets.config().guildId)) throw Object.assign(new Error('Keine Server-ID – bitte unter Discord-Bot → Tickets eintragen.'), { status: 400 });
}

/** Vorschau: wer würde die Nachricht bekommen – und wer hat schon ein Website-Konto? */
async function preview(roleId) {
  ensureReady();
  const role = await roleInfo(roleId);
  const list = await membersWithRole(roleId);
  const members = list.map((m) => {
    const acc = accountOf(m.user.id);
    return { id: m.user.id, name: memberName(m), account: acc ? (acc.active ? 'vorhanden' : 'gesperrt') : 'keins' };
  });
  return {
    role,
    count: members.length,
    max: MAX_RECIPIENTS,
    accounts: {
      existing: members.filter((m) => m.account === 'vorhanden').length,
      missing: members.filter((m) => m.account === 'keins').length,
      locked: members.filter((m) => m.account === 'gesperrt').length,
    },
    members: members.slice(0, 100),
  };
}

/* ---------------------------------------------------------------- Website-Zugang */
/** Freie Login-Adresse aus dem Namen, z. B. „John Doe“ → john.doe@pake-scha.ls (sonst john.doe2 …). */
function freeEmail(name, discordId) {
  const base = firmLocalFrom(name.replace(/\s+/g, '.')) || `mandant.${discordId.slice(-6)}`;
  const taken = (local) => !!db.prepare('SELECT 1 FROM users WHERE email = ? OR old_email = ?').get(`${local}@${EMAIL_DOMAIN}`, `${local}@${EMAIL_DOMAIN}`);
  for (let n = 1; n < 1000; n++) {
    const local = n === 1 ? base : `${base.slice(0, 40)}${n}`;
    if (firmEmail(local) && !taken(local)) return `${local}@${EMAIL_DOMAIN}`;
  }
  return `mandant.${discordId}@${EMAIL_DOMAIN}`;
}

function createAccount(m) {
  const name = truncate(memberName(m), 80);
  const displayName = name.length >= 2 ? name : `Mandant ${m.user.id.slice(-4)}`;
  const email = freeEmail(displayName, m.user.id);
  const password = generateTempPassword();
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, role, discord_id, discord_username, must_change_password, created_via)
       VALUES (?, ?, ?, 'mandant', ?, ?, 1, 'discord-dm')`
    )
    .run(email, hashPassword(password), displayName, m.user.id, m.user.username || null);
  return { id: Number(info.lastInsertRowid), email, displayName, password };
}

const loginUrl = () => (tickets.siteBase() ? `${tickets.siteBase()}/login.html` : '');

function accessEmbed(kind, acc) {
  const login = loginUrl();
  const base = { color: 0xd4af37, footer: { text: 'Pake & Scha Legal Consulting · Nachricht nicht weitergeben' }, timestamp: now() };
  if (kind === 'neu') {
    return {
      ...base,
      title: '🔑 Dein Zugang zur Website',
      description: `Hallo **${acc.displayName}**, für dich wurde ein Konto im Mandantenportal angelegt – **dein Discord ist bereits verknüpft**. Am einfachsten meldest du dich auf der Website mit **„Mit Discord anmelden“** an.`,
      fields: [
        { name: 'E-Mail-Adresse', value: `\`${acc.email}\``, inline: false },
        { name: 'Einmal-Passwort', value: `||\`${acc.password}\`||  ← zum Anzeigen anklicken`, inline: false },
        ...(login ? [{ name: 'Anmelden', value: login, inline: false }] : []),
        { name: 'Wichtig', value: 'Beim ersten Login mit Passwort legst du ein eigenes fest. Passwort vergessen? `/passwort` auf dem Server eingeben.', inline: false },
      ],
    };
  }
  return {
    ...base,
    title: '🔑 Dein Zugang zur Website',
    description: `Hallo **${acc.display_name}**, du hast bereits ein Konto im Mandantenportal – **dein Discord ist damit verknüpft**. Melde dich mit **„Mit Discord anmelden“** oder mit deiner E-Mail-Adresse an.`,
    fields: [
      { name: 'E-Mail-Adresse', value: `\`${acc.email}\``, inline: false },
      ...(login ? [{ name: 'Anmelden', value: login, inline: false }] : []),
      { name: 'Passwort vergessen?', value: '`/passwort` auf dem Server eingeben – der Bot schickt dir ein neues.', inline: false },
    ],
  };
}

/* ---------------------------------------------------------------- Durchgang */
const runRow = (r) => ({
  id: r.id,
  templateId: r.template_id,
  templateName: r.template_name,
  roleId: r.role_id,
  roleName: r.role_name,
  withLogin: !!r.with_login,
  status: r.status,
  total: r.total,
  sent: r.sent,
  failed: r.failed,
  accountsCreated: r.accounts_created,
  accountsExisting: r.accounts_existing,
  problems: JSON.parse(r.problems || '[]'),
  error: r.error || null,
  startedByName: r.started_by_name,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

/** Letzte Durchgänge (ein „läuft“ ohne aktiven Durchgang – z. B. nach einem Neustart – gilt als abgebrochen). */
function runs(templateId = null) {
  db.prepare("UPDATE bot_dm_runs SET status = 'abgebrochen', error = 'Server wurde neu gestartet.', finished_at = ? WHERE status = 'läuft' AND id != ?").run(now(), active ? active.id : 0);
  const rows = templateId
    ? db.prepare('SELECT * FROM bot_dm_runs WHERE template_id = ? ORDER BY id DESC LIMIT 10').all(templateId)
    : db.prepare('SELECT * FROM bot_dm_runs ORDER BY id DESC LIMIT 10').all();
  return rows.map(runRow);
}

/** Einem Mitglied schicken: Vorlage (+ ggf. Zugang). Liefert 'neu' | 'vorhanden' | 'gesperrt' | null. */
async function sendTo(m, t, guild, withLogin, starter) {
  const payload = msgs.build(JSON.parse(t.data || '{}'), guild);
  payload.allowed_mentions = { parse: [] }; // in Direktnachrichten pingt niemand
  let created = null;
  let kind = null;
  if (withLogin) {
    const acc = accountOf(m.user.id);
    if (!acc) {
      created = createAccount(m);
      kind = 'neu';
      payload.embeds = [...payload.embeds, accessEmbed('neu', created)].slice(0, 10);
    } else if (acc.active) {
      kind = 'vorhanden';
      payload.embeds = [...payload.embeds, accessEmbed('vorhanden', acc)].slice(0, 10);
    } else kind = 'gesperrt';
    const login = loginUrl();
    if (login && kind !== 'gesperrt' && payload.components.length < 5) {
      payload.components = [...payload.components, { type: 1, components: [{ type: 2, style: 5, label: 'Zur Anmeldung', url: login }] }];
    }
  }
  try {
    await bot.sendDm(m.user.id, payload);
  } catch (err) {
    // Nicht angekommen → neu angelegtes Konto wieder entfernen (niemand kennt das Passwort)
    if (created) db.prepare("DELETE FROM users WHERE id = ? AND created_via = 'discord-dm' AND last_login_at IS NULL").run(created.id);
    throw err;
  }
  if (created) {
    logActivity(starter, 'Website-Konto per Discord angelegt', 'user', created.id, `${created.displayName} (${created.email}) – Zugang per Direktnachricht`);
    require('./memberships').syncUser(created.id).catch(() => {});
    bot.syncUser(created.id); // Rang-Sync / Role Connections für Mandanten
  }
  return kind;
}

const reason = (err) =>
  err && err.code === 50007 ? 'nimmt keine Direktnachrichten an' : err && err.status === 404 ? 'nicht mehr auf dem Server' : truncate(String((err && err.message) || err), 160);

async function work(runId, list, t, withLogin, starter) {
  const guild = await tickets.rest('GET', `/guilds/${tickets.config().guildId}?with_counts=true`).catch(() => null);
  const problems = [];
  const n = { sent: 0, failed: 0, created: 0, existing: 0 };
  const save = (extra = '') =>
    db
      .prepare(`UPDATE bot_dm_runs SET sent = ?, failed = ?, accounts_created = ?, accounts_existing = ?, problems = ?${extra} WHERE id = ?`)
      .run(n.sent, n.failed, n.created, n.existing, JSON.stringify(problems.slice(0, MAX_PROBLEMS)), runId);
  let status = 'fertig';
  let error = null;
  try {
    for (let i = 0; i < list.length; i++) {
      if (active && active.cancel) {
        status = 'abgebrochen';
        break;
      }
      const m = list[i];
      try {
        const kind = await sendTo(m, t, guild, withLogin, starter);
        n.sent++;
        if (kind === 'neu') n.created++;
        if (kind === 'vorhanden') n.existing++;
        if (kind === 'gesperrt') problems.push({ name: memberName(m), reason: 'Website-Konto gesperrt – ohne Zugangsdaten gesendet' });
      } catch (err) {
        n.failed++;
        problems.push({ name: memberName(m), reason: reason(err) });
        if (err && err.status === 401) throw err; // Token ungültig – alle weiteren würden auch scheitern
      }
      save();
      if (i < list.length - 1) await sleep(SEND_GAP_MS);
    }
  } catch (err) {
    status = 'fehler';
    error = reason(err);
  }
  db.prepare('UPDATE bot_dm_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, now(), runId);
  save();
  logActivity(starter, 'Discord-Bot: Direktnachrichten an Rolle', 'settings', null, `${t.name}: ${n.sent} gesendet, ${n.failed} nicht zugestellt${withLogin ? `, ${n.created} Konto/Konten angelegt` : ''} (${status})`);
}

/** Durchgang starten (läuft im Hintergrund weiter). */
async function start(t, roleId, withLogin, starter) {
  ensureReady();
  if (active) throw Object.assign(new Error('Es läuft bereits ein Versand per Direktnachricht – bitte warten oder abbrechen.'), { status: 409 });
  const role = await roleInfo(roleId);
  if (!msgs.build(JSON.parse(t.data || '{}'), null)) throw Object.assign(new Error('Die Vorlage ist leer.'), { status: 400 });
  const list = await membersWithRole(roleId);
  if (!list.length) throw Object.assign(new Error(`Niemand auf dem Server hat die Rolle „${role.name}“.`), { status: 400 });
  if (list.length > MAX_RECIPIENTS) {
    throw Object.assign(new Error(`Die Rolle „${role.name}“ haben ${list.length} Mitglieder – per Direktnachricht gehen höchstens ${MAX_RECIPIENTS} auf einmal. Bitte eine kleinere Rolle wählen oder die Nachricht in einen Kanal senden.`), { status: 400 });
  }
  const info = db
    .prepare('INSERT INTO bot_dm_runs (template_id, template_name, role_id, role_name, with_login, total, started_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.id, t.name, role.id, role.name, withLogin ? 1 : 0, list.length, starter.display_name);
  const runId = Number(info.lastInsertRowid);
  active = { id: runId, cancel: false };
  const who = { id: starter.id, display_name: starter.display_name };
  work(runId, list, t, withLogin, who)
    .catch((err) => console.warn('Direktnachrichten an Rolle:', err.message))
    .finally(() => {
      active = null;
    });
  return runRow(db.prepare('SELECT * FROM bot_dm_runs WHERE id = ?').get(runId));
}

function cancel(runId) {
  if (!active || active.id !== runId) return false;
  active.cancel = true;
  return true;
}

/**
 * Discord verknüpfen, obwohl es an einem vom Bot angelegten, nie benutzten Konto hängt (die Person hatte schon ein
 * eigenes Konto): Das unbenutzte Konto gibt das Discord frei und wird gesperrt. Liefert true, wenn freigegeben.
 */
function releaseUnusedBotAccount(discordId, exceptUserId) {
  const u = db
    .prepare(
      `SELECT id, display_name, email FROM users WHERE discord_id = ? AND id != ? AND created_via = 'discord-dm' AND last_login_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.client_id = users.id)`
    )
    .get(discordId, exceptUserId);
  if (!u) return false;
  db.prepare('UPDATE users SET discord_id = NULL, discord_username = NULL, active = 0 WHERE id = ?').run(u.id);
  logActivity(null, 'Unbenutztes Bot-Konto gesperrt', 'user', u.id, `${u.display_name} (${u.email}) – Discord mit einem anderen Konto verknüpft`);
  return true;
}

module.exports = { preview, start, cancel, runs, releaseUnusedBotAccount, MAX_RECIPIENTS, _test: { freeEmail, memberName } };
