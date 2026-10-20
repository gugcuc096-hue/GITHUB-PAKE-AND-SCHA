'use strict';
/*
 * Liegengebliebene Akten: Offene Akten, an denen sich seit X Tagen nichts getan hat (Einstellung „case_idle_days“,
 * Standard 5 Tage, 0 = aus), stehen in der Aktenliste markiert. Der federführende Anwalt bekommt dazu einmal je
 * Ruhephase eine Discord-DM (mehrere Akten in einer Nachricht). Ist keine DM möglich (kein verknüpftes Discord,
 * Bot nicht eingerichtet), geht der Hinweis an den Kanzlei-Webhook (Ereignis „case.idle“). Nie ins Ticket der
 * Akte – dort liest der Mandant mit. Sobald sich in der Akte wieder etwas tut, beginnt die Ruhephase von vorn.
 */
const { db } = require('./db');
const { idleLimit, addSystemNote, logActivity } = require('./models');
const discord = require('./discord');
const { dm } = require('./memberships');

const MAX_LINES = 15;

/** Offene Akten mit Anwalt, die seit mindestens `days` Tagen ruhen und in dieser Ruhephase noch nicht gemeldet wurden. */
function dueCases(days) {
  return db
    .prepare(
      `SELECT c.id, c.case_number, c.title, c.lawyer_id, u.discord_id,
              CAST(julianday('now') - julianday(c.updated_at) AS INTEGER) AS quiet
         FROM cases c JOIN users u ON u.id = c.lawyer_id
        WHERE c.status != 'geschlossen' AND u.active = 1
          AND julianday(c.updated_at) <= julianday('now', ?)
          AND (c.idle_notified_at IS NULL OR julianday(c.idle_notified_at) < julianday(c.updated_at))
        ORDER BY c.lawyer_id, c.updated_at`
    )
    .all(`-${days} days`);
}

const dayText = (n) => `${n} ${n === 1 ? 'Tag' : 'Tagen'}`;

async function notifyLawyer(lawyerId, list, days) {
  const link = discord.publicUrl(list.length === 1 ? `/dashboard?case=${list[0].id}#cases` : '/dashboard#cases');
  const lines = list.slice(0, MAX_LINES).map((c) => `• **${c.case_number}** – ${c.title} (seit ${dayText(c.quiet)})`);
  if (list.length > MAX_LINES) lines.push(`… und ${list.length - MAX_LINES} weitere`);
  const message = {
    title: list.length === 1 ? `📂 Akte ${list[0].case_number} liegt seit ${dayText(list[0].quiet)}` : `📂 ${list.length} Akten liegen seit mindestens ${dayText(days)}`,
    description: [
      `${list.length === 1 ? 'An dieser Akte' : 'An diesen Akten'} hat sich seit mindestens ${dayText(days)} nichts getan:`,
      lines.join('\n'),
      'Bitte kurz hineinschauen – schon ein Verlaufseintrag, eine Nachricht oder eine Wiedervorlage beendet die Erinnerung.',
      link ? `[Im Dashboard öffnen](${link})` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    color: discord.GOLD,
  };
  if (await dm(lawyerId, message)) return 'per Discord-DM';
  if (!discord.webhookFor('case.idle') || !discord.enabledEvents().includes('case.idle')) return null;
  discord.notify('case.idle', { ...message, mentionIds: list[0].discord_id ? [list[0].discord_id] : [], link });
  return 'über den Kanzlei-Webhook';
}

/** Alle 5 Minuten aufgerufen (server.js). */
let running = false;
async function sweep() {
  const days = idleLimit();
  if (!days || running) return;
  running = true;
  try {
    const byLawyer = new Map();
    for (const c of dueCases(days)) {
      if (!byLawyer.has(c.lawyer_id)) byLawyer.set(c.lawyer_id, []);
      byLawyer.get(c.lawyer_id).push(c);
    }
    for (const [lawyerId, list] of byLawyer) {
      const via = await notifyLawyer(lawyerId, list, days).catch((err) => {
        console.warn(`Hinweis auf liegengebliebene Akten an Nutzer ${lawyerId} fehlgeschlagen:`, err.message);
        return null;
      });
      // Einmal je Ruhephase (auch ohne Zustellung – die Markierung in der Aktenliste bleibt). updated_at bleibt
      // unberührt, sonst zählte der Hinweis selbst als Aktivität.
      const mark = db.prepare("UPDATE cases SET idle_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
      const note = via ? `zuständiger Anwalt ${via} erinnert` : 'Erinnerung nicht zugestellt (kein verknüpftes Discord, kein Kanzlei-Webhook)';
      for (const c of list) {
        mark.run(c.id);
        addSystemNote(c.id, null, `Akte liegt seit ${dayText(c.quiet)} ohne Aktivität – ${note}.`, true);
      }
      logActivity(null, 'Liegengebliebene Akten', 'user', lawyerId, `${list.map((c) => c.case_number).join(', ')} · ${note}`);
    }
  } finally {
    running = false;
  }
}

module.exports = { sweep, dueCases };
