'use strict';
/*
 * VIP & Perma-Mandat: Mitgliedschaften von Mandanten.
 *
 *  - Stufen (membership_tiers) pflegt das Board of Partners: Name, Art (VIP auf Zeit / Perma unbefristet),
 *    Preis, Laufzeit in Tagen, Rabatt in % und Leistungen – optional mit Discord-Rolle.
 *  - Eine Mitgliedschaft (memberships) gehört zu genau einem Mandantenkonto. Rabatt, Name und Art werden beim
 *    Vergeben festgehalten, damit spätere Preisänderungen laufende Mitgliedschaften nicht verändern.
 *  - Wirkung: Rabatt in jeder Rechnung (Perma meist 100 %), Badge in Akten, Discord-Rolle (Bot).
 *  - Ablauf: Hintergrundaufgabe (server.js) setzt abgelaufene VIP-Mitgliedschaften auf „abgelaufen“, entfernt die
 *    Rolle und erinnert den Mandanten 3 Tage vorher per Discord-Direktnachricht.
 */
const { db } = require('./db');
const discord = require('./discord');
const tickets = require('./tickets');

const KIND_LABEL = { vip: 'VIP', perma: 'Perma-Mandat' };
const DAY = 24 * 60 * 60 * 1000;
const REMIND_DAYS = 3;
const now = () => new Date().toISOString();

/** Aktive Mitgliedschaft eines Kontos (höchstens eine) oder null. */
function activeFor(userId) {
  if (!userId) return null;
  return (
    db
      .prepare("SELECT * FROM memberships WHERE user_id = ? AND status = 'aktiv' AND (expires_at IS NULL OR expires_at > ?) ORDER BY discount_pct DESC, id DESC")
      .get(userId, now()) || null
  );
}

/** Kurzform für Akten, Rechnungsformular und Profil. */
function brief(m) {
  if (!m) return null;
  return { id: m.id, name: m.tier_name, kind: m.kind, kindLabel: KIND_LABEL[m.kind] || m.kind, discountPct: m.discount_pct, expiresAt: m.expires_at || null };
}

/* ---------------------------------------------------------------- Discord (Rolle, Direktnachricht) */
function discordTarget(userId) {
  const u = db.prepare('SELECT id, display_name, discord_id FROM users WHERE id = ?').get(userId);
  const guild = tickets.config().guildId;
  return u && tickets.isId(u.discord_id) && tickets.hasToken() ? { u, guild } : null;
}

/** Rolle vergeben bzw. entfernen. Liefert eine Fehlermeldung oder null (auch null, wenn es nichts zu tun gibt). */
async function setRole(userId, roleId, add) {
  const t = discordTarget(userId);
  if (!t || !tickets.isId(roleId) || !tickets.isId(t.guild)) return null;
  try {
    await tickets.rest(add ? 'PUT' : 'DELETE', `/guilds/${t.guild}/members/${t.u.discord_id}/roles/${roleId}`);
    return null;
  } catch (err) {
    if (!add && err.status === 404) return null;
    return `Discord-Rolle ${add ? 'nicht vergeben' : 'nicht entfernt'}: ${err.message}${err.code === 50013 ? ' (Die Bot-Rolle muss in den Server-Einstellungen über der VIP-Rolle stehen.)' : ''}`;
  }
}

/** Direktnachricht als Embed (falls Bot und verknüpftes Discord vorhanden). */
async function dm(userId, embed) {
  const t = discordTarget(userId);
  if (!t) return false;
  try {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: t.u.discord_id });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, { embeds: [tickets.embed(embed)] });
    return true;
  } catch {
    return false;
  }
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : 'unbefristet');

/** Webhook „VIP / Perma-Mandat“ ans Team. */
function notify(title, m, extra = []) {
  const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.user_id);
  discord.notify('membership.changed', {
    title,
    fields: [
      { name: 'Mandant', value: u ? u.display_name : '—' },
      { name: 'Stufe', value: `${m.tier_name} · ${m.discount_pct} % Rabatt` },
      { name: 'Gültig bis', value: fmtDate(m.expires_at) },
      ...extra,
    ],
    color: m.kind === 'perma' ? discord.GOLD : 0x38bdf8,
  });
}

/* ---------------------------------------------------------------- Ablauf & Erinnerung (alle 5 Minuten) */
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const t = now();
    // Abgelaufen
    for (const m of db.prepare("SELECT * FROM memberships WHERE status = 'aktiv' AND expires_at IS NOT NULL AND expires_at <= ?").all(t)) {
      db.prepare("UPDATE memberships SET status = 'abgelaufen', ended_at = ? WHERE id = ? AND status = 'aktiv'").run(t, m.id);
      if (m.discord_role_id) await setRole(m.user_id, m.discord_role_id, false);
      await dm(m.user_id, {
        title: `⌛ ${m.tier_name} abgelaufen`,
        description: `Ihre Mitgliedschaft **${m.tier_name}** bei Pake & Scha ist am ${fmtDate(m.expires_at)} abgelaufen. Zum Verlängern melden Sie sich einfach bei der Kanzlei.`,
        color: tickets.COLORS.slate,
      });
      notify(`⌛ ${KIND_LABEL[m.kind] || 'Mitgliedschaft'} abgelaufen`, m);
    }
    // Erinnerung wenige Tage vorher
    const soon = new Date(Date.now() + REMIND_DAYS * DAY).toISOString();
    for (const m of db.prepare("SELECT * FROM memberships WHERE status = 'aktiv' AND expires_at IS NOT NULL AND expires_at <= ? AND reminded_at IS NULL").all(soon)) {
      db.prepare('UPDATE memberships SET reminded_at = ? WHERE id = ?').run(t, m.id);
      await dm(m.user_id, {
        title: `⏳ ${m.tier_name} läuft bald ab`,
        description: `Ihre Mitgliedschaft **${m.tier_name}** (${m.discount_pct} % Rabatt) läuft am **${fmtDate(m.expires_at)}** ab. Zum Verlängern melden Sie sich einfach bei der Kanzlei.`,
        color: tickets.COLORS.gold,
      });
    }
  } finally {
    sweeping = false;
  }
}

/** Discord nachträglich verknüpft → Rolle der aktiven Mitgliedschaft vergeben. */
async function syncUser(userId) {
  const m = activeFor(userId);
  if (m && m.discord_role_id) await setRole(userId, m.discord_role_id, true);
}

module.exports = { KIND_LABEL, activeFor, brief, setRole, dm, notify, sweep, syncUser, fmtDate, DAY };
