'use strict';
/*
 * VIP & Lifetime: Mitgliedschaften von Mandanten.
 *
 *  - Stufen (membership_tiers) pflegt das Board of Partners: Name, Art (VIP auf Zeit / Lifetime unbefristet),
 *    Preis, Laufzeit in Tagen, Rabatt in % und Leistungen – optional mit Discord-Rolle.
 *  - Eine Mitgliedschaft (memberships) gehört zu genau einem Mandantenkonto. Rabatt, Name und Art werden beim
 *    Vergeben festgehalten, damit spätere Preisänderungen laufende Mitgliedschaften nicht verändern.
 *  - Wirkung: Rabatt in jeder Rechnung (Lifetime meist 100 %), Badge in Akten, Discord-Rolle (Bot).
 *  - Ablauf: Hintergrundaufgabe (server.js) setzt abgelaufene VIP-Mitgliedschaften auf „abgelaufen“, entfernt die
 *    Rolle und erinnert den Mandanten 3 Tage vorher per Discord-Direktnachricht.
 */
const { db, tx, nextInvoiceNumber } = require('./db');
const { logActivity } = require('./models');
const discord = require('./discord');
const tickets = require('./tickets');

const KIND_LABEL = { vip: 'VIP', perma: 'Lifetime' };
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

/** Webhook „VIP / Lifetime“ ans Team. */
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

/* ---------------------------------------------------------------- Vergeben, verlängern, Rechnung */
const plusDays = (iso, days) => new Date(Date.parse(iso) + days * DAY).toISOString();
const tierLabel = (t) => `${t.name} – ${t.duration_days ? `${t.duration_days} Tage` : 'unbefristet'}`;

/** Rechnung für die Mitgliedschaft selbst (Mandant sieht sie in seinem Portal). */
function membershipInvoice(by, target, tier, label, { paid = false } = {}) {
  const number = nextInvoiceNumber('rechnung');
  const items = [{ description: label, quantity: 1, unitPrice: tier.price, total: tier.price }];
  const info = db
    .prepare(
      `INSERT INTO invoices (number, kind, case_id, client_name, client_contact, subject, items_json, subtotal, discount_pct, discount_amount,
                             surcharge_pct, surcharge_amount, total, notes, due_date, issued_by, issuer_name, issuer_rank, client_user_id, status, paid_at)
       VALUES (?, 'rechnung', NULL, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '', NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(number, target.display_name, target.phone || target.email || '', label, JSON.stringify(items), tier.price, tier.price, by.id, by.display_name, by.rank || '', target.id, paid ? 'bezahlt' : 'offen', paid ? now() : null);
  return { id: Number(info.lastInsertRowid), number };
}

/**
 * Mitgliedschaft vergeben (ersetzt eine aktive). tier: Zeile aus membership_tiers oder gleich aufgebauter Schnappschuss.
 * Setzt Discord-Rolle, schickt DM und Webhook. Liefert { id, membership, replaced, warnings, expires }.
 */
async function grant({ target, tier, by, note = '', startsOn = null }) {
  const current = activeFor(target.id);
  const start = startsOn || now();
  const expires = tier.duration_days ? plusDays(start, tier.duration_days) : null;
  const id = tx(() => {
    if (current) {
      db.prepare("UPDATE memberships SET status = 'beendet', ended_at = ?, ended_by_name = ?, end_reason = ? WHERE id = ?").run(now(), by.display_name, `ersetzt durch ${tier.name}`, current.id);
    }
    const info = db
      .prepare(
        `INSERT INTO memberships (user_id, tier_id, tier_name, kind, discount_pct, price_paid, starts_at, expires_at, note, discord_role_id, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(target.id, tier.id || null, tier.name, tier.kind, tier.discount_pct, tier.price, start, expires, note || '', tier.discord_role_id || '', by.id || null, by.display_name);
    return Number(info.lastInsertRowid);
  });
  const m = db.prepare('SELECT * FROM memberships WHERE id = ?').get(id);
  logActivity(by.id ? by : null, `${KIND_LABEL[tier.kind] || 'Mitgliedschaft'} vergeben`, 'membership', id, `${target.display_name}: ${tier.name}${expires ? ` bis ${fmtDate(expires)}` : ' (unbefristet)'}${current ? ` – ersetzt ${current.tier_name}` : ''}`);
  const warnings = [];
  if (current && current.discord_role_id && current.discord_role_id !== m.discord_role_id) {
    const w = await setRole(target.id, current.discord_role_id, false);
    if (w) warnings.push(w);
  }
  if (m.discord_role_id) {
    const w = await setRole(target.id, m.discord_role_id, true);
    if (w) warnings.push(w);
  }
  const benefits = tier.benefits ?? (tier.id ? db.prepare('SELECT benefits FROM membership_tiers WHERE id = ?').get(tier.id)?.benefits : '') ?? '';
  dm(target.id, {
    title: tier.kind === 'perma' ? '👑 Willkommen bei Lifetime' : `⭐ Willkommen bei ${tier.name}`,
    description: `Ihre Mitgliedschaft **${tier.name}** bei Pake & Scha ist aktiv${expires ? ` bis **${fmtDate(expires)}**` : ' – **unbefristet**'}.${tier.discount_pct ? ` Sie erhalten **${tier.discount_pct} % Rabatt** auf alle Leistungen der Kanzlei.` : ''}${benefits ? `\n\n**Ihre Vorteile:**\n${benefits}` : ''}`,
    color: tickets.COLORS.gold,
  });
  notify(`${tier.kind === 'perma' ? '👑 Lifetime' : '⭐ VIP'} vergeben`, m, [{ name: 'Vergeben von', value: by.display_name }]);
  return { id, membership: m, replaced: current, warnings, expires };
}

/** VIP verlängern (ab Ablaufdatum bzw. heute). Liefert { expires, warnings }. */
async function extend(m, tier, by) {
  const base = m.status === 'aktiv' && m.expires_at > now() ? m.expires_at : now();
  const expires = plusDays(base, tier.duration_days);
  db.prepare("UPDATE memberships SET status = 'aktiv', expires_at = ?, reminded_at = NULL, ended_at = NULL, price_paid = price_paid + ? WHERE id = ?").run(expires, tier.price, m.id);
  const target = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.user_id);
  logActivity(by.id ? by : null, 'VIP verlängert', 'membership', m.id, `${target ? target.display_name : ''}: ${m.tier_name} bis ${fmtDate(expires)}`);
  const warnings = [];
  if (m.status !== 'aktiv' && m.discord_role_id) {
    const w = await setRole(m.user_id, m.discord_role_id, true);
    if (w) warnings.push(w);
  }
  dm(m.user_id, { title: `✅ ${m.tier_name} verlängert`, description: `Ihre Mitgliedschaft **${m.tier_name}** ist jetzt gültig bis **${fmtDate(expires)}**.`, color: tickets.COLORS.green });
  notify('🔁 VIP verlängert', { ...m, expires_at: expires });
  return { expires, warnings };
}

/* ---------------------------------------------------------------- Anfragen (Website / Portal) */
/**
 * Rechnung einer angenommenen Anfrage wurde bezahlt → Mitgliedschaft freischalten. Gleiche VIP-Stufe bereits
 * aktiv → verlängern statt ersetzen. Liefert { warnings } oder null (keine passende Anfrage).
 */
async function activateRequestByInvoice(invoiceId, by) {
  const r = db.prepare("SELECT * FROM membership_requests WHERE invoice_id = ? AND status = 'angenommen'").get(invoiceId);
  if (!r) return null;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id);
  if (!target) return null;
  const tier = { id: r.tier_id, name: r.tier_name, kind: r.kind, price: r.price, duration_days: r.duration_days, discount_pct: r.discount_pct, discord_role_id: r.discord_role_id };
  const current = activeFor(target.id);
  let membershipId;
  let warnings = [];
  if (current && r.kind === 'vip' && current.kind === 'vip' && current.tier_id && current.tier_id === r.tier_id && r.duration_days) {
    warnings = (await extend(current, tier, by)).warnings;
    membershipId = current.id;
  } else {
    const g = await grant({ target, tier, by, note: `Anfrage über die Website (Rechnung bezahlt)` });
    warnings = g.warnings;
    membershipId = g.id;
  }
  db.prepare("UPDATE membership_requests SET status = 'aktiv', membership_id = ?, activated_at = ? WHERE id = ?").run(membershipId, now(), r.id);
  return { warnings, membershipId };
}

/** Rechnung einer angenommenen Anfrage storniert → Anfrage gilt als abgelehnt. */
function cancelRequestByInvoice(invoiceId, by) {
  db.prepare("UPDATE membership_requests SET status = 'abgelehnt', decision_note = 'Rechnung storniert', decided_by_name = ?, decided_at = ? WHERE invoice_id = ? AND status = 'angenommen'").run(by.display_name, now(), invoiceId);
}

module.exports = { grant, extend, membershipInvoice, tierLabel, plusDays, activateRequestByInvoice, cancelRequestByInvoice, KIND_LABEL, activeFor, brief, setRole, dm, notify, sweep, syncUser, fmtDate, DAY };
