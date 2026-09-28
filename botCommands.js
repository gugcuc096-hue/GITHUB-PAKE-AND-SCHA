'use strict';
/*
 * Befehle des Kanzlei-Bots im Discord (Slash-Commands) und einheitliche Antworten als Embed.
 * Die Befehle kommen über routes/interactions.js (von Discord signiert) hier an; angemeldet werden sie in
 * tickets.js (registerCommands). Jede Antwort des Bots ist ein Embed – Erwähnungen (Pings) stehen nur dann
 * zusätzlich im Nachrichtentext, wenn jemand wirklich benachrichtigt werden soll.
 *
 *  /passwort   Neues Einmal-Passwort per Direktnachricht (E-Mail bleibt gleich). Nur mit verknüpftem Discord.
 *  /akte       Stand einer Akte (im Ticket: diese Akte) – nur, wer die Akte auch im Dashboard sehen darf.
 *  /notiz      Interne Notiz zur Akte (nur Kanzlei; nie für den Mandanten sichtbar, nie im Ticket).
 *  /dienst     Dienststatus (Stempeluhr) setzen.   /imdienst  Wer ist im Dienst?
 *  /termine    Eigene nächste Termine und Fristen. /hilfe     Übersicht aller Befehle.
 */
const { db } = require('./db');
const { isStaff, hashPassword, generateTempPassword, destroyAllSessions } = require('./auth');
const { truncate, CASE_STATUS, STEPS, EVENT_TYPES, DUTY_STATUS } = require('./helpers');
const { getCase, caseAccess, caseLawyers, onDutyMembers, APPT_SELECT, logActivity } = require('./models');
const tickets = require('./tickets');

const { COLORS } = tickets;
const FOOTER = 'Pake & Scha Legal Consulting';

/* ---------------------------------------------------------------- Antworten als Embed */
function card({ title, description, fields, color = COLORS.gold, footer = FOOTER, url } = {}) {
  const e = { color, footer: { text: footer }, timestamp: new Date().toISOString() };
  if (title) e.title = truncate(title, 256);
  if (description) e.description = truncate(description, 4000);
  if (url) e.url = url;
  const list = (fields || []).filter((f) => f && f.name);
  if (list.length) e.fields = list.slice(0, 25).map((f) => ({ name: truncate(f.name, 256), value: truncate(f.value || '—', 1024), inline: f.inline !== false }));
  return e;
}

/** Antwort auf einen Befehl/Klick. ephemeral: nur für die Person sichtbar. content nur für Pings. */
function respond(embedOpts, { ephemeral = true, components, content, users = [] } = {}) {
  return {
    type: 4,
    data: {
      ...(content ? { content } : {}),
      embeds: [card(embedOpts)],
      ...(components ? { components } : {}),
      ...(ephemeral ? { flags: 64 } : {}),
      allowed_mentions: { parse: [], users },
    },
  };
}
const fail = (text, title = 'Nicht möglich') => respond({ title: `⛔ ${title}`, description: text, color: COLORS.red });
const done = (text, title = 'Erledigt') => respond({ title: `✅ ${title}`, description: text, color: COLORS.green });
const info = (text, title = 'Hinweis') => respond({ title: `ℹ️ ${title}`, description: text, color: COLORS.gold });
/** Rückfrage mit Button (z. B. „Ja, löschen“). */
const confirm = (title, text, components) => respond({ title, description: text, color: COLORS.red }, { components });
/** Die (nur für die Person sichtbare) Rückfrage durch ein Ergebnis ersetzen. */
const replaceWith = (embedOpts) => ({ type: 7, data: { embeds: [card(embedOpts)], components: [] } });

const linkRow = (label, url) => (url ? [{ type: 1, components: [{ type: 2, style: 5, label, url }] }] : undefined);
const dashboardLink = (path) => (tickets.siteBase() ? `${tickets.siteBase()}${path}` : null);
const ts = (iso, style = 'f') => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `<t:${Math.floor(t / 1000)}:${style}>` : '—';
};

/** SQLite-Zeit („2026-09-28 21:00:00“, UTC) oder ISO → ISO. */
const sqlTime = (v) => (String(v || '').includes('T') ? String(v) : `${String(v || '').replace(' ', 'T')}Z`);

const NOT_LINKED =
  'Dein Discord-Konto ist mit keinem Konto der Kanzlei-Website verknüpft. Verknüpfen: auf der Website anmelden → „Mein Profil“ → „Discord verbinden“.';

/* ---------------------------------------------------------------- Hilfsfunktionen */
const option = (body, name) => (body.data?.options || []).find((o) => o.name === name)?.value;

/** Akte aus dem Aktenzeichen (auch nur die laufende Nummer, z. B. „12“) oder aus dem Ticket-Kanal. */
function caseFrom(body) {
  const text = String(option(body, 'aktenzeichen') || '').trim().toUpperCase();
  if (text) {
    let row = db.prepare('SELECT id FROM cases WHERE UPPER(case_number) = ?').get(text);
    if (!row && /^\d{1,6}$/.test(text)) row = db.prepare('SELECT id FROM cases WHERE case_number LIKE ? ORDER BY id DESC').get(`%-${text.padStart(4, '0')}`);
    return { c: row ? getCase(row.id) : null, asked: text };
  }
  const t = tickets.ticketByChannel(String(body.channel_id || ''));
  return { c: t && t.kind === 'case' ? t.row : null, asked: null };
}

/* ---------------------------------------------------------------- /passwort */
const COOLDOWN_MS = 10 * 60 * 1000;
const lastReset = new Map(); // userId → Zeitpunkt (Schutz vor Spam)

function editOriginal(body, response) {
  return tickets.rest('PATCH', `/webhooks/${body.application_id}/${body.token}/messages/@original`, { embeds: response.data.embeds, components: response.data.components || [] });
}

/**
 * Neues Einmal-Passwort erzeugen und per Direktnachricht schicken. Erst wenn die Nachricht angekommen ist,
 * bleibt es gültig – kann der Bot keine DM schicken, wird das alte Passwort wiederhergestellt.
 */
async function sendNewPassword(body, u, discordId) {
  const before = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(u.id);
  const password = generateTempPassword();
  const newHash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, u.id);
  const login = dashboardLink('/login.html');
  try {
    const dm = await tickets.rest('POST', '/users/@me/channels', { recipient_id: discordId });
    await tickets.rest('POST', `/channels/${dm.id}/messages`, {
      embeds: [
        card({
          title: '🔑 Neue Zugangsdaten',
          description: `Hallo **${u.display_name}**, du hast mit \`/passwort\` ein neues Passwort für das Portal von Pake & Scha angefordert. Deine E-Mail-Adresse bleibt gleich.`,
          fields: [
            { name: 'E-Mail', value: `\`${u.email}\``, inline: false },
            { name: 'Neues Passwort', value: `||\`${password}\`||  ← zum Anzeigen anklicken`, inline: false },
            ...(login ? [{ name: 'Anmelden', value: login, inline: false }] : []),
            { name: 'Nicht angefordert?', value: 'Dann bitte sofort beim Board of Partners melden.', inline: false },
          ],
          footer: 'Beim Login legst du ein eigenes Passwort fest · Nachricht nicht weitergeben',
        }),
      ],
      ...(login ? { components: linkRow('Zum Login', login) } : {}),
    });
  } catch (err) {
    // Passwort zurücksetzen, falls es inzwischen niemand anderes geändert hat
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ? AND password_hash = ?').run(before.password_hash, before.must_change_password, u.id, newHash);
    lastReset.delete(u.id);
    const text =
      err.code === 50007
        ? 'Ich kann dir keine Direktnachricht schicken. Erlaube Direktnachrichten von Servermitgliedern (Rechtsklick auf den Server → Privatsphäre-Einstellungen) und versuche es dann erneut.\n\nDein Passwort wurde **nicht** geändert.'
        : `Das hat nicht geklappt (${err.message}).\n\nDein Passwort wurde **nicht** geändert.`;
    await editOriginal(body, fail(text, 'Keine Direktnachricht möglich'));
    return;
  }
  destroyAllSessions(u.id); // überall abmelden – nur das neue Passwort gilt
  logActivity(u, 'Passwort über Discord zurückgesetzt', 'user', u.id, `${u.display_name} (/passwort, Direktnachricht)`);
  await editOriginal(body, done('Ich habe dir eine **Direktnachricht** mit deinem neuen Passwort geschickt. Deine E-Mail-Adresse bleibt gleich; beim Login legst du ein eigenes Passwort fest.', 'Neues Passwort unterwegs'));
}

function passwortCommand(body, u, discordId) {
  if (!u) return fail(`${NOT_LINKED}\n\nPasswort vergessen und kein Discord verknüpft? Das Board of Partners kann es zurücksetzen.`, 'Kein verknüpftes Konto');
  const last = lastReset.get(u.id);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const min = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60000);
    return info(`Du hast gerade erst ein neues Passwort angefordert – schau in deine Direktnachrichten. Ein weiteres geht in ${min} Minute${min === 1 ? '' : 'n'}.`, 'Schon unterwegs');
  }
  lastReset.set(u.id, Date.now());
  setImmediate(() =>
    sendNewPassword(body, u, discordId).catch((err) => {
      console.warn('/passwort fehlgeschlagen:', err.message);
    })
  );
  return { type: 5, data: { flags: 64 } }; // „Bot denkt nach …“ – Ergebnis folgt per Bearbeitung
}

/* ---------------------------------------------------------------- /akte */
function akteCommand(body, u) {
  if (!u) return fail(NOT_LINKED, 'Kein verknüpftes Konto');
  const { c, asked } = caseFrom(body);
  if (!c || !caseAccess(c, u).canView) {
    return fail(asked ? `Keine Akte **${asked}** gefunden (oder kein Zugriff).` : 'Bitte ein Aktenzeichen angeben, z. B. `/akte aktenzeichen:PS-2026-0012` – im Ticket-Kanal einer Akte geht es auch ohne.', 'Akte nicht gefunden');
  }
  const staff = isStaff(u);
  const now = new Date().toISOString();
  const next = db
    .prepare(
      `SELECT title, type, starts_at FROM appointments WHERE case_id = ? AND status IN ('angefragt','bestaetigt') AND starts_at >= ?
       ${staff ? '' : 'AND client_visible = 1'} ORDER BY starts_at LIMIT 1`
    )
    .get(c.id, now);
  const openTasks = staff ? db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE case_id = ? AND done = 0').get(c.id).n : null;
  const lawyers = caseLawyers(c).map((l) => `${l.name}${l.lead ? ' (federführend)' : ''}`);
  return respond(
    {
      title: `📁 ${c.case_number}: ${c.title}`,
      color: c.status === 'geschlossen' ? COLORS.slate : c.urgency === 'notfall' ? COLORS.red : COLORS.gold,
      fields: [
        { name: 'Status', value: CASE_STATUS[c.status] || c.status },
        { name: 'Verfahrensstand', value: STEPS[c.step] || STEPS[0] },
        { name: 'Mandant', value: c.client_account_name || c.client_name || '—' },
        { name: 'Zuständig', value: lawyers.length ? lawyers.join(', ') : 'noch niemand', inline: false },
        next ? { name: 'Nächster Termin', value: `${EVENT_TYPES[next.type] || 'Termin'}: ${next.title} – ${ts(next.starts_at)} (${ts(next.starts_at, 'R')})`, inline: false } : null,
        openTasks !== null ? { name: 'Offene Aufgaben', value: String(openTasks) } : null,
        { name: 'Zuletzt geändert', value: ts(sqlTime(c.updated_at || c.created_at), 'R') },
        c.public_note ? { name: 'Hinweis der Kanzlei', value: c.public_note, inline: false } : null,
      ],
    },
    { components: linkRow('Im Dashboard öffnen', dashboardLink(`/dashboard.html?case=${c.id}`)) }
  );
}

/* ---------------------------------------------------------------- /notiz */
function notizCommand(body, u) {
  if (!u) return fail(NOT_LINKED, 'Kein verknüpftes Konto');
  if (!isStaff(u)) return fail('Interne Notizen sind nur für die Kanzlei. Nachrichten an Ihren Anwalt schreiben Sie einfach hier in den Kanal oder im Portal.');
  const { c, asked } = caseFrom(body);
  if (!c) return fail(asked ? `Keine Akte **${asked}** gefunden.` : 'Bitte ein Aktenzeichen angeben – im Ticket-Kanal einer Akte geht es auch ohne.', 'Akte nicht gefunden');
  const text = String(option(body, 'text') || '').trim();
  if (!text) return fail('Die Notiz ist leer.');
  db.prepare('INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal) VALUES (?, ?, ?, ?, ?, 1)').run(c.id, u.id, u.display_name, u.role, truncate(text, 4000));
  db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
  logActivity(u, 'Interne Notiz (Discord)', 'case', c.id, c.case_number);
  return done(`Interne Notiz zu **${c.case_number}** gespeichert – nur für die Kanzlei sichtbar (nicht für den Mandanten, nicht im Ticket).\n\n>>> ${truncate(text, 1500)}`, 'Notiz gespeichert');
}

/* ---------------------------------------------------------------- /dienst, /imdienst */
const DUTY_ICON = { dienst: '🟢', gericht: '⚖️', pause: '☕', off: '⚪' };

function dienstCommand(body, u) {
  if (!u) return fail(NOT_LINKED, 'Kein verknüpftes Konto');
  if (!isStaff(u)) return fail('Die Stempeluhr ist nur für die Kanzlei.');
  const status = String(option(body, 'status') || '');
  if (!DUTY_STATUS[status]) return fail('Unbekannter Status.');
  const note = option(body, 'notiz') !== undefined ? truncate(String(option(body, 'notiz')).trim(), 120) : undefined;
  const duty = require('./routes/duty'); // erst hier laden (Router mit eigener Initialisierung)
  const r = duty.changeDuty(u, status, note);
  logActivity(u, 'Dienststatus (Discord)', 'user', u.id, DUTY_STATUS[status]);
  if (status === 'off') {
    return respond({ title: '⚪ Außer Dienst', description: r.ended ? `Dienst beendet – Dauer **${duty.fmtDuration(r.duration)}**. Danke!` : 'Du warst nicht im Dienst.', color: COLORS.slate });
  }
  return respond({
    title: `${DUTY_ICON[status]} ${DUTY_STATUS[status]}`,
    description: `${r.started ? 'Dienst begonnen' : 'Status geändert'}${note ? ` – ${note}` : ''}. Beenden mit \`/dienst status:Außer Dienst\`.`,
    color: COLORS.green,
  });
}

function imDienstCommand() {
  const list = onDutyMembers();
  const lines = list.map((m) => `${DUTY_ICON[m.status] || '🟢'} **${m.name}**${m.rank ? ` · ${m.rank}` : ''} – ${m.statusLabel} seit ${ts(m.since, 'R')}${m.note ? `\n　└ ${m.note}` : ''}`);
  return respond({
    title: `👥 Im Dienst: ${list.length}`,
    description: lines.length ? lines.join('\n') : 'Gerade ist niemand von der Kanzlei im Dienst.',
    color: list.length ? COLORS.green : COLORS.slate,
  });
}

/* ---------------------------------------------------------------- /termine */
const TYPE_ICON = { gericht: '⚖️', frist: '⏰', mandant: '🤝', intern: '🏢' };

function termineCommand(body, u) {
  if (!u) return fail(NOT_LINKED, 'Kein verknüpftes Konto');
  const staff = isStaff(u);
  const rows = staff
    ? db
        .prepare(
          `${APPT_SELECT} WHERE a.status IN ('angefragt','bestaetigt') AND (a.assigned_to = ? OR c.lawyer_id = ?
             OR a.case_id IN (SELECT case_id FROM case_lawyers WHERE user_id = ?)) ORDER BY a.starts_at ASC`
        )
        .all(u.id, u.id, u.id)
    : db
        .prepare(`${APPT_SELECT} WHERE a.status IN ('angefragt','bestaetigt') AND a.client_visible = 1 AND (a.client_id = ? OR c.client_id = ?) ORDER BY a.starts_at ASC`)
        .all(u.id, u.id);
  const from = Date.now() - 30 * 60 * 1000;
  const next = rows.filter((a) => Date.parse(a.starts_at) >= from).slice(0, 10);
  const lines = next.map(
    (a) =>
      `${TYPE_ICON[a.type] || '📅'} **${a.title}** – ${ts(a.starts_at)} (${ts(a.starts_at, 'R')})${a.case_number ? ` · ${a.case_number}` : ''}${a.status === 'angefragt' ? ' · *angefragt*' : ''}${a.location ? `\n　└ ${a.location}` : ''}`
  );
  return respond(
    {
      title: '📅 Deine nächsten Termine',
      description: lines.length ? lines.join('\n') : 'Keine anstehenden Termine oder Fristen.',
      color: lines.length ? COLORS.gold : COLORS.slate,
    },
    { components: linkRow('Kalender öffnen', dashboardLink('/dashboard.html#calendar')) }
  );
}

/* ---------------------------------------------------------------- /hilfe */
function hilfeCommand(body, u) {
  const staff = u && isStaff(u);
  const fields = [
    {
      name: 'Für alle',
      value: [
        '`/passwort` – neues Passwort per Direktnachricht (E-Mail bleibt gleich)',
        '`/akte` – Stand deiner Akte (im Ticket: diese Akte)',
        '`/termine` – deine nächsten Termine',
        '`/imdienst` – wer von der Kanzlei gerade im Dienst ist',
        '`/hilfe` – diese Übersicht',
      ].join('\n'),
      inline: false,
    },
  ];
  if (staff) {
    fields.push(
      {
        name: 'Kanzlei',
        value: ['`/dienst` – Dienststatus setzen (Im Dienst, Gericht, Pause, Außer Dienst)', '`/notiz` – interne Notiz zur Akte (Mandant sieht sie nie)'].join('\n'),
        inline: false,
      },
      {
        name: 'Im Ticket-Kanal',
        value: [
          '`/add @Person` – jemanden ins Ticket holen',
          '`/remove @Person` – hinzugefügte Person entfernen',
          '`/delete` – Ticket-Kanal löschen (Akte bleibt; neu anlegen im Dashboard)',
          'Buttons oben im Ticket: Akte übernehmen, schließen, wieder öffnen',
        ].join('\n'),
        inline: false,
      }
    );
  }
  return respond({
    title: '📖 Befehle des Kanzlei-Bots',
    description: u ? undefined : `⚠️ ${NOT_LINKED}`,
    fields,
  });
}

module.exports = {
  card,
  respond,
  fail,
  done,
  info,
  confirm,
  replaceWith,
  NOT_LINKED,
  commands: {
    passwort: passwortCommand,
    akte: akteCommand,
    notiz: notizCommand,
    dienst: dienstCommand,
    imdienst: imDienstCommand,
    termine: termineCommand,
    hilfe: hilfeCommand,
  },
};
