'use strict';
/*
 * Einladungen von Kollegen zu einem Termin oder Gespräch (Kalender, Bewerbungsgespräch): wer eingeladen ist, steht am Termin,
 * sagt zu oder ab und sieht die Einladung im Dashboard (Kalender und Kanzlei-Post). Discord: Ereignis „appointment.invite“ –
 * dafür lässt sich im Board unter Discord ein eigener Kanal (Webhook) einrichten; die Eingeladenen werden dort erwähnt.
 */
const { db, tx } = require('./db');
const discord = require('./discord');
const { truncate } = require('./helpers');
const { userAvatarUrl } = require('./auth');

const STATUS = { offen: 'offen', zugesagt: 'zugesagt', abgesagt: 'abgesagt' };

/** Eingeladene eines Termins (mit Namen, Foto und Antwort). */
function list(apptId) {
  return db
    .prepare(
      `SELECT i.user_id, i.status, i.responded_at, u.display_name, u.rank, u.avatar, u.discord_id, u.discord_avatar
       FROM appointment_invites i JOIN users u ON u.id = i.user_id
       WHERE i.appointment_id = ? ORDER BY i.created_at, u.display_name`
    )
    .all(apptId)
    .map((r) => ({
      userId: r.user_id,
      name: r.display_name,
      rank: r.rank || null,
      avatarUrl: userAvatarUrl({ avatar: r.avatar, discord_id: r.discord_id, discord_avatar: r.discord_avatar }),
      status: r.status,
      respondedAt: r.responded_at || null,
    }));
}

/** Antwort der angemeldeten Person auf eine Einladung (oder null, wenn sie nicht eingeladen ist). */
const mine = (apptId, userId) => db.prepare('SELECT status FROM appointment_invites WHERE appointment_id = ? AND user_id = ?').get(apptId, userId)?.status || null;

const when = (iso) => discord.discordTime(iso, 'F');

function message(a, by, headline, people) {
  return {
    title: `${headline}: ${truncate(a.title, 160)}`,
    description: `${by.display_name} ${headline === '📨 Einladung' ? 'lädt zu diesem Termin ein' : 'meldet sich zum Termin'}.`,
    fields: [
      { name: 'Wann', value: when(a.starts_at), inline: false },
      { name: 'Ort', value: a.location || '—' },
      { name: 'Akte', value: a.case_number || '—' },
      ...(people && people.length ? [{ name: 'Eingeladen', value: people.map((p) => p.display_name).join(', ') }] : []),
    ],
    mentionIds: (people || []).map((p) => p.discord_id).filter(Boolean),
  };
}

/** Kollegen einladen: nur aktive Anwälte/Admins, nicht die einladende Person, nicht doppelt. Gibt die neu Eingeladenen zurück. */
function invite(a, userIds, by) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== by.id && n !== a.assigned_to))];
  if (!ids.length) return [];
  const people = db
    .prepare(`SELECT id, display_name, discord_id FROM users WHERE active = 1 AND role IN ('anwalt','admin') AND id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const fresh = [];
  tx(() => {
    for (const p of people) {
      const r = db.prepare('INSERT OR IGNORE INTO appointment_invites (appointment_id, user_id, invited_by) VALUES (?, ?, ?)').run(a.id, p.id, by.id);
      if (r.changes) fresh.push(p);
    }
  });
  if (!fresh.length) return fresh;
  discord.notify('appointment.invite', message(a, by, '📨 Einladung', fresh));
  // Im Dashboard sehen die Eingeladenen es in der Kanzlei-Post und im Kalender
  const stamp = new Date(a.starts_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
  for (const p of fresh) {
    db.prepare('INSERT INTO messages (sender_id, recipient_id, case_id, subject, body) VALUES (?, ?, ?, ?, ?)').run(
      by.id,
      p.id,
      a.case_id || null,
      `Einladung: ${truncate(a.title, 120)}`,
      `${by.display_name} lädt dich ein:\n\n${a.title}\n${stamp} Uhr · ${a.location || '—'}\n\nZu- oder absagen im Kalender (Termin öffnen).`
    );
  }
  return fresh;
}

/** Einladung zurückziehen (Eingeladene bleiben sonst stehen). */
function remove(a, userId) {
  return db.prepare('DELETE FROM appointment_invites WHERE appointment_id = ? AND user_id = ?').run(a.id, userId).changes > 0;
}

/** Eingeladene eines Termins auf die gewünschte Liste bringen: Neue einladen, nicht mehr Genannte entfernen. */
function sync(a, wanted, by) {
  const want = new Set((wanted || []).map(Number));
  for (const cur of list(a.id)) if (!want.has(cur.userId)) remove(a, cur.userId);
  return invite(a, [...want], by);
}

/** Zusage/Absage der eingeladenen Person. Gibt true zurück, wenn sich etwas geändert hat. */
function respond(a, user, status) {
  if (!STATUS[status] || status === 'offen') return false;
  const r = db.prepare("UPDATE appointment_invites SET status = ?, responded_at = datetime('now') WHERE appointment_id = ? AND user_id = ? AND status != ?").run(status, a.id, user.id, status);
  if (!r.changes) return false;
  discord.notify('appointment.invite', {
    title: `${status === 'zugesagt' ? '✅ Zusage' : '❌ Absage'}: ${truncate(a.title, 160)}`,
    description: `${user.display_name} ${status === 'zugesagt' ? 'kommt' : 'kann nicht kommen'}.`,
    fields: [{ name: 'Wann', value: when(a.starts_at), inline: false }],
  });
  return true;
}

/** Termin wurde verschoben: Eingeladene bekommen die neue Zeit (Antworten gelten dann neu). */
function moved(a, by) {
  const people = db
    .prepare('SELECT u.id, u.display_name, u.discord_id FROM appointment_invites i JOIN users u ON u.id = i.user_id WHERE i.appointment_id = ?')
    .all(a.id);
  if (!people.length) return;
  db.prepare("UPDATE appointment_invites SET status = 'offen', responded_at = NULL WHERE appointment_id = ?").run(a.id);
  discord.notify('appointment.invite', {
    ...message(a, by, '🔁 Neue Zeit', people),
    description: `${by.display_name} hat den Termin verschoben – bitte erneut zu- oder absagen.`,
  });
}

module.exports = { list, mine, invite, remove, sync, respond, moved };
