'use strict';
/*
 * Nachrichten in der Akte (Chat Kanzlei ↔ Mandant).
 *
 * Nachrichten sind die für den Mandanten sichtbaren Einträge der Akte (notes mit internal = 0 und system = 0) –
 * so bleibt alles, was bisher als sichtbare Notiz geschrieben wurde, im Chat erhalten, und das Discord-Ticket
 * bekommt jede Nachricht wie gewohnt (routes/cases.js → POST /:id/notes). Interne Notizen und automatische
 * Einträge bleiben im „Verlauf“.
 *
 * Gelesen: case_chat_reads merkt sich je Akte und Person die zuletzt gelesene Nachricht. „Neu“ ist für Anwälte, was
 * der Mandant in ihren Akten (federführend oder mitarbeitend) geschrieben hat, für den Mandanten, was die Kanzlei in
 * seinen Akten geschrieben hat. Nachrichten von vor der Einführung (chat_read_floor) gelten als gelesen.
 */
const { db, getSetting } = require('./db');

/* ---------------------------------------------------------------- Aus dem Discord-Ticket übernehmen */
// Wird erst beim Aufruf geladen (tickets.js lädt viele Module – so entsteht kein Kreis beim Start)
const ticketsMod = () => require('./tickets');
const MAX_BODY = 4000;

const CHAT = 'n.internal = 0 AND n.system = 0';
const floor = () => Number(getSetting('chat_read_floor', 0)) || 0;
const fromFirm = (n) => n.author_role !== 'mandant';

function row(n) {
  return {
    id: n.id,
    authorId: n.author_id,
    author: n.author_name,
    authorRank: fromFirm(n) ? n.author_rank || '' : '',
    fromFirm: fromFirm(n),
    viaDiscord: !!n.discord_message_id, // aus dem Discord-Ticket übernommen
    body: n.body,
    createdAt: n.created_at,
  };
}

/** Nachrichten einer Akte (optional nur die nach einer bestimmten Nachricht). */
function messages(caseId, after = 0) {
  return db
    .prepare(`SELECT n.*, u.rank AS author_rank FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.case_id = ? AND ${CHAT} AND n.id > ? ORDER BY n.id`)
    .all(caseId, after)
    .map(row);
}

/** Gelesen bis lastId (nie zurück). */
function markRead(caseId, userId, lastId) {
  if (!(lastId > 0)) return;
  db.prepare(
    `INSERT INTO case_chat_reads (case_id, user_id, last_id) VALUES (?, ?, ?)
     ON CONFLICT(case_id, user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`
  ).run(caseId, userId, lastId);
}

/**
 * mine: bis wohin die Person selbst gelesen hat · other: bis wohin die Gegenseite gelesen hat
 * (für „gelesen“ unter den eigenen Nachrichten: beim Mandanten irgendein Anwalt, bei der Kanzlei der Mandant).
 */
function readState(c, u) {
  const mine = db.prepare('SELECT last_id FROM case_chat_reads WHERE case_id = ? AND user_id = ?').get(c.id, u.id);
  const staff = u.role === 'anwalt' || u.role === 'admin';
  const other = staff
    ? c.client_id
      ? db.prepare('SELECT last_id FROM case_chat_reads WHERE case_id = ? AND user_id = ?').get(c.id, c.client_id)
      : null
    : db
        .prepare("SELECT MAX(r.last_id) AS last_id FROM case_chat_reads r JOIN users u ON u.id = r.user_id WHERE r.case_id = ? AND u.role IN ('anwalt','admin')")
        .get(c.id);
  return { mine: Math.max(mine ? mine.last_id : 0, floor()), other: Math.max(other && other.last_id ? other.last_id : 0, floor()) };
}

/** Ungelesene Nachrichten der Gegenseite: { total, cases: { [caseId]: Anzahl } }. */
function unreadFor(u) {
  const staff = u.role === 'anwalt' || u.role === 'admin';
  const rows = db
    .prepare(
      `SELECT n.case_id AS id, COUNT(*) AS n FROM notes n
       JOIN cases c ON c.id = n.case_id
       LEFT JOIN case_chat_reads r ON r.case_id = n.case_id AND r.user_id = ?
       WHERE ${CHAT} AND n.id > MAX(COALESCE(r.last_id, 0), ?)
         AND ${
           staff
             ? "n.author_role = 'mandant' AND (c.lawyer_id = ? OR EXISTS (SELECT 1 FROM case_lawyers cl WHERE cl.case_id = c.id AND cl.user_id = ?))"
             : "n.author_role IN ('anwalt','admin') AND c.client_id = ? AND ? > 0"
         }
       GROUP BY n.case_id`
    )
    .all(u.id, floor(), u.id, u.id);
  const cases = {};
  let total = 0;
  for (const r of rows) {
    cases[r.id] = r.n;
    total += r.n;
  }
  return { total, cases };
}

/**
 * Nachricht aus dem Discord-Ticket einer Akte in den Chat übernehmen (Gateway-Ereignis MESSAGE_CREATE).
 * Übernommen wird nur, was der Mandant (sein Discord im Ticket) oder ein Anwalt/Board-Mitglied mit Zugriff schreibt –
 * keine Bots, keine per /add hinzugefügten Dritten. Ohne „MESSAGE CONTENT INTENT“ liefert Discord keinen Text,
 * dann wird nichts übernommen. Nachrichten der Website kommen vom Bot und werden daher nie doppelt übernommen.
 * Liefert die neue Nachricht (für Tests) oder null.
 */
function importFromDiscord(d) {
  const tickets = ticketsMod();
  if (!d || !d.author || d.author.bot || d.webhook_id || ![0, 19].includes(d.type ?? 0)) return null;
  const t = tickets.ticketByChannel(String(d.channel_id || ''));
  if (!t || t.kind !== 'case' || !t.row) return null;
  const c = t.row;
  const authorId = String(d.author.id);
  // Erwähnungen lesbar machen (<@123> → @Name), Anhänge als Links anhängen
  let text = String(d.content || '');
  for (const m of d.mentions || []) text = text.replace(new RegExp(`<@!?${m.id}>`, 'g'), `@${m.global_name || m.username || 'Person'}`);
  const files = (d.attachments || []).map((a) => a && a.url).filter((u) => /^https:\/\//.test(String(u || '')));
  const body = [text.trim(), ...files.map((u) => `📎 ${u}`)].filter(Boolean).join('\n').slice(0, MAX_BODY);
  if (!body) return null;
  if (db.prepare('SELECT 1 FROM notes WHERE discord_message_id = ?').get(String(d.id))) return null;

  let author = null;
  if (tickets.clientDiscordIds(c).includes(authorId)) {
    const account = c.client_id ? db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(c.client_id) : null;
    author = { id: account ? account.id : null, name: account ? account.display_name : c.client_name || d.author.global_name || d.author.username || 'Mandant', role: 'mandant' };
  } else {
    const u = db.prepare("SELECT * FROM users WHERE discord_id = ? AND active = 1 AND role IN ('anwalt','admin')").get(authorId);
    if (u && require('./models').caseAccess(c, u).canView) author = { id: u.id, name: u.display_name, role: u.role };
  }
  if (!author) return null;
  const info = db
    .prepare('INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal, discord_message_id) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(c.id, author.id, author.name, author.role, body, String(d.id));
  db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
  const id = Number(info.lastInsertRowid);
  if (author.id) markRead(c.id, author.id, id); // eigene Nachricht gilt als gelesen
  return messages(c.id, id - 1)[0] || null;
}

module.exports = { messages, markRead, readState, unreadFor, importFromDiscord };
