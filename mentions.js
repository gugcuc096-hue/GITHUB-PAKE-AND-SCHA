'use strict';
/*
 * @Erwähnung in internen Notizen: „@Damat bitte prüfen“ oder „@Damat Lex …“ benachrichtigt den Kollegen –
 * per Discord-DM mit Link zur Akte, ohne Discord als Nachricht in der Kanzlei-Post. Gefunden werden nur aktive
 * Kanzlei-Konten (nie Mandanten); ein Vorname, den mehrere tragen, braucht den Nachnamen dazu.
 */
const { db } = require('./db');

const TITLES = new Set(['dr', 'prof', 'jur', 'med', 'rer', 'nat', 'mag', 'll', 'mba', 'von', 'van', 'de']);
const parts = (name) =>
  String(name || '')
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[.,]/g, ''))
    .filter((p) => p.length >= 2 && !TITLES.has(p));

/** Erwähnte Kanzlei-Konten in einem Text (ohne die schreibende Person). */
function find(text, authorId) {
  const caps = [...String(text || '').matchAll(/(?:^|[^\p{L}\p{N}@])@([\p{L}][\p{L}'-]*)(?:\s([\p{L}][\p{L}'-]*))?/gu)];
  if (!caps.length) return [];
  const staff = db
    .prepare("SELECT id, display_name FROM users WHERE role IN ('anwalt', 'admin') AND active = 1 AND id != ?")
    .all(authorId || 0)
    .map((u) => ({ ...u, parts: parts(u.display_name) }));
  const hit = new Map();
  for (const [, a, b] of caps) {
    const w1 = a.toLowerCase();
    const w2 = (b || '').toLowerCase();
    // Vor- und Nachname direkt hintereinander („@Damat Lex“)
    const both = w2 ? staff.filter((u) => u.parts.some((p, i) => p === w1 && u.parts[i + 1] === w2)) : [];
    const one = staff.filter((u) => u.parts.includes(w1));
    const pick = both.length === 1 ? both : one.length === 1 ? one : [];
    for (const u of pick) hit.set(u.id, u);
  }
  return [...hit.values()].map(({ id, display_name }) => ({ id, name: display_name }));
}

/**
 * Erwähnte benachrichtigen. Liefert [{ id, name, via: 'dm' | 'post' }].
 * c: Akte (Zeile aus der Datenbank), author: schreibende Person, body: Text der Notiz.
 */
async function notify(c, author, body) {
  const list = find(body, author.id);
  if (!list.length) return [];
  const { dm } = require('./memberships');
  const discord = require('./discord');
  const link = discord.publicUrl(`/dashboard?case=${c.id}#cases`);
  const short = body.length > 900 ? `${body.slice(0, 897)}…` : body;
  const out = [];
  for (const u of list) {
    const sent = await dm(u.id, {
      title: `💬 ${author.display_name} hat dich erwähnt`,
      description: `Interne Notiz in der Akte **${c.case_number}** · ${c.title}:\n>>> ${short}${link ? `\n\n[Akte öffnen](${link})` : ''}`,
      color: discord.GOLD,
    });
    if (!sent) {
      db.prepare('INSERT INTO messages (sender_id, recipient_id, case_id, subject, body) VALUES (?, ?, ?, ?, ?)').run(
        author.id,
        u.id,
        c.id,
        `Erwähnung in Akte ${c.case_number}`,
        `${author.display_name} hat dich in einer internen Notiz erwähnt:\n\n${body}`
      );
    }
    out.push({ ...u, via: sent ? 'dm' : 'post' });
  }
  return out;
}

module.exports = { find, notify };
