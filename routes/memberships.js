'use strict';
/*
 * VIP & Perma-Mandat – Stufen (Preise, Laufzeit, Rabatt) und Mitgliedschaften verwaltet das Board of Partners.
 * Das Team sieht die aktive Mitgliedschaft eines Mandanten (Rechnungsformular, Akte), Mandanten ihre eigene.
 * Logik für Ablauf, Erinnerung und Discord-Rolle: ../memberships.js
 */
const express = require('express');
const { z } = require('zod');
const { db, tx, nextInvoiceNumber } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard, dateOnly } = require('../helpers');
const { getCase, caseAccess, logActivity } = require('../models');
const tickets = require('../tickets');
const ms = require('../memberships');

const router = express.Router();
router.use(requireAuth);

function requireBoard(req, res, next) {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
}

const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;
const nowIso = () => new Date().toISOString();
const plusDays = (iso, days) => new Date(Date.parse(iso) + days * ms.DAY).toISOString();

/* ---------------------------------------------------------------- Stufen */
function tierRow(t) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    kindLabel: ms.KIND_LABEL[t.kind] || t.kind,
    price: t.price,
    durationDays: t.duration_days ?? null,
    discountPct: t.discount_pct,
    benefits: t.benefits,
    discordRoleId: t.discord_role_id || '',
    active: !!t.active,
    sortOrder: t.sort_order,
    activeMembers: db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE tier_id = ? AND status = 'aktiv'").get(t.id).n,
  };
}

router.get('/tiers', requireStaff, (req, res) => {
  const board = isBoard(req.user);
  const rows = db.prepare(`SELECT * FROM membership_tiers ${board ? '' : 'WHERE active = 1'} ORDER BY sort_order, price`).all();
  res.json({ tiers: rows.map(tierRow), canManage: board });
});

const roleField = z.union([z.string().trim().regex(/^\d{15,25}$/, 'Die ID besteht aus 15–25 Ziffern.'), z.literal('')]);
const tierFields = {
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['vip', 'perma']),
  price: z.number().int().min(0).max(1_000_000_000),
  durationDays: z.number().int().min(1).max(3650).nullable(),
  discountPct: z.number().min(0).max(100),
  benefits: z.string().trim().max(1000),
  discordRoleId: roleField,
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
};

function checkTier(d, res) {
  // Perma = unbefristet, VIP braucht eine Laufzeit
  if (d.kind === 'perma') d.durationDays = null;
  else if (d.kind === 'vip' && !d.durationDays) {
    res.status(400).json({ error: 'Bitte eine Laufzeit in Tagen angeben (z. B. 30) – unbefristet ist nur das Perma-Mandat.' });
    return false;
  }
  return true;
}

router.post(
  '/tiers',
  requireBoard,
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({ ...tierFields, durationDays: tierFields.durationDays.optional(), benefits: tierFields.benefits.optional(), discordRoleId: roleField.optional(), active: tierFields.active.optional(), sortOrder: tierFields.sortOrder.optional() }),
      req,
      res
    );
    if (!d || !checkTier(d, res)) return;
    const order = d.sortOrder ?? db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM membership_tiers').get().n;
    const info = db
      .prepare('INSERT INTO membership_tiers (name, kind, price, duration_days, discount_pct, benefits, discord_role_id, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.name, d.kind, d.price, d.durationDays ?? null, d.discountPct, d.benefits || '', d.discordRoleId || '', d.active === false ? 0 : 1, order);
    const t = db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(Number(info.lastInsertRowid));
    logActivity(req.user, 'VIP-Stufe angelegt', 'membership_tier', t.id, `${t.name}: ${money(t.price)}, ${t.discount_pct} %, ${t.duration_days ? `${t.duration_days} Tage` : 'unbefristet'}`);
    res.status(201).json({ tier: tierRow(t) });
  })
);

router.patch(
  '/tiers/:id',
  requireBoard,
  wrap(async (req, res) => {
    const t = db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(idParam(req));
    if (!t) return res.status(404).json({ error: 'Stufe nicht gefunden.' });
    const d = parseBody(z.object(tierFields).partial(), req, res);
    if (!d) return;
    const merged = { kind: d.kind ?? t.kind, durationDays: d.durationDays !== undefined ? d.durationDays : t.duration_days };
    if (!checkTier(merged, res)) return;
    const map = { name: 'name', kind: 'kind', price: 'price', discountPct: 'discount_pct', benefits: 'benefits', discordRoleId: 'discord_role_id', active: 'active', sortOrder: 'sort_order' };
    const sets = ['duration_days = ?'];
    const vals = [merged.durationDays ?? null];
    for (const [k, col] of Object.entries(map)) {
      if (d[k] === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k]);
    }
    db.prepare(`UPDATE membership_tiers SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, t.id);
    const fresh = db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(t.id);
    logActivity(req.user, 'VIP-Stufe geändert', 'membership_tier', t.id, `${fresh.name}: ${money(fresh.price)}, ${fresh.discount_pct} %, ${fresh.duration_days ? `${fresh.duration_days} Tage` : 'unbefristet'}${fresh.active ? '' : ', inaktiv'}`);
    res.json({ tier: tierRow(fresh) });
  })
);

router.delete(
  '/tiers/:id',
  requireBoard,
  wrap(async (req, res) => {
    const t = db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(idParam(req));
    if (!t) return res.status(404).json({ error: 'Stufe nicht gefunden.' });
    db.prepare('DELETE FROM membership_tiers WHERE id = ?').run(t.id); // Mitgliedschaften behalten Name und Rabatt
    logActivity(req.user, 'VIP-Stufe gelöscht', 'membership_tier', t.id, t.name);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Mitgliedschaften */
const MEMBER_SELECT = `
  SELECT m.*, u.display_name, u.email, u.discord_id,
         (SELECT COUNT(*) FROM invoices i WHERE i.membership_id = m.id) AS invoice_count,
         (SELECT COALESCE(SUM(i.subtotal), 0) FROM invoices i WHERE i.membership_id = m.id AND i.status != 'storniert') AS work_value,
         (SELECT COALESCE(SUM(i.member_amount), 0) FROM invoices i WHERE i.membership_id = m.id AND i.status != 'storniert') AS covered
  FROM memberships m JOIN users u ON u.id = m.user_id`;

function memberRow(m) {
  const expired = m.status === 'aktiv' && m.expires_at && m.expires_at <= nowIso();
  return {
    id: m.id,
    userId: m.user_id,
    name: m.display_name,
    email: m.email,
    discordLinked: !!m.discord_id,
    tierId: m.tier_id,
    tierName: m.tier_name,
    kind: m.kind,
    kindLabel: ms.KIND_LABEL[m.kind] || m.kind,
    discountPct: m.discount_pct,
    pricePaid: m.price_paid,
    startsAt: m.starts_at,
    expiresAt: m.expires_at || null,
    status: expired ? 'abgelaufen' : m.status,
    note: m.note,
    endedAt: m.ended_at,
    endedBy: m.ended_by_name,
    endReason: m.end_reason,
    createdBy: m.created_by_name,
    createdAt: m.created_at,
    // Wie viel Arbeit hat der Mandant verursacht? (Wert der Leistungen vs. gezahlter Preis)
    usage: { invoices: m.invoice_count, workValue: m.work_value, covered: m.covered },
  };
}

router.get('/', requireBoard, (req, res) => {
  const all = req.query.status === 'alle';
  const rows = db.prepare(`${MEMBER_SELECT} ${all ? '' : "WHERE m.status = 'aktiv'"} ORDER BY m.status = 'aktiv' DESC, m.created_at DESC LIMIT 300`).all();
  res.json({ memberships: rows.map(memberRow) });
});

/** Rechnung für die Mitgliedschaft selbst (Mandant sieht sie in seinem Portal). */
function membershipInvoice(u, target, tier, label) {
  const number = nextInvoiceNumber('rechnung');
  const items = [{ description: label, quantity: 1, unitPrice: tier.price, total: tier.price }];
  const info = db
    .prepare(
      `INSERT INTO invoices (number, kind, case_id, client_name, client_contact, subject, items_json, subtotal, discount_pct, discount_amount,
                             surcharge_pct, surcharge_amount, total, notes, due_date, issued_by, issuer_name, issuer_rank, client_user_id)
       VALUES (?, 'rechnung', NULL, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '', NULL, ?, ?, ?, ?)`
    )
    .run(number, target.display_name, target.phone || target.email || '', label, JSON.stringify(items), tier.price, tier.price, u.id, u.display_name, u.rank || '', target.id);
  return { id: Number(info.lastInsertRowid), number };
}

const tierLabel = (t) => `${t.name} – ${t.duration_days ? `${t.duration_days} Tage` : 'unbefristet'}`;

router.post(
  '/',
  requireBoard,
  wrap(async (req, res) => {
    const d = parseBody(
      z.object({
        userId: z.number().int().positive(),
        tierId: z.number().int().positive(),
        note: z.string().trim().max(500).optional(),
        invoice: z.boolean().optional(),
        replace: z.boolean().optional(),
        startsOn: dateOnly.optional(),
      }),
      req,
      res
    );
    if (!d) return;
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'mandant' AND active = 1").get(d.userId);
    if (!target) return res.status(400).json({ error: 'VIP und Perma-Mandat gibt es nur für aktive Mandantenkonten.' });
    const tier = db.prepare('SELECT * FROM membership_tiers WHERE id = ? AND active = 1').get(d.tierId);
    if (!tier) return res.status(400).json({ error: 'Diese Stufe gibt es nicht oder sie ist deaktiviert.' });
    const current = ms.activeFor(target.id);
    if (current && !d.replace) {
      return res.status(409).json({ error: `${target.display_name} hat bereits „${current.tier_name}“ (${current.expires_at ? `bis ${ms.fmtDate(current.expires_at)}` : 'unbefristet'}).`, current: ms.brief(current) });
    }
    const start = d.startsOn ? new Date(`${d.startsOn}T00:00:00`).toISOString() : nowIso();
    const expires = tier.duration_days ? plusDays(start, tier.duration_days) : null;
    let invoice = null;
    const id = tx(() => {
      if (current) {
        db.prepare("UPDATE memberships SET status = 'beendet', ended_at = ?, ended_by_name = ?, end_reason = ? WHERE id = ?").run(nowIso(), req.user.display_name, `ersetzt durch ${tier.name}`, current.id);
      }
      const info = db
        .prepare(
          `INSERT INTO memberships (user_id, tier_id, tier_name, kind, discount_pct, price_paid, starts_at, expires_at, note, discord_role_id, created_by, created_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(target.id, tier.id, tier.name, tier.kind, tier.discount_pct, tier.price, start, expires, d.note || '', tier.discord_role_id || '', req.user.id, req.user.display_name);
      if (d.invoice !== false && tier.price > 0) invoice = membershipInvoice(req.user, target, tier, tierLabel(tier));
      return Number(info.lastInsertRowid);
    });
    const m = db.prepare('SELECT * FROM memberships WHERE id = ?').get(id);
    logActivity(req.user, `${ms.KIND_LABEL[tier.kind]} vergeben`, 'membership', id, `${target.display_name}: ${tier.name}${expires ? ` bis ${ms.fmtDate(expires)}` : ' (unbefristet)'}${current ? ` – ersetzt ${current.tier_name}` : ''}${invoice ? ` · Rechnung ${invoice.number}` : ''}`);
    // Discord: alte Rolle weg, neue Rolle dazu, Mandant benachrichtigen
    const warnings = [];
    if (current && current.discord_role_id && current.discord_role_id !== m.discord_role_id) {
      const w = await ms.setRole(target.id, current.discord_role_id, false);
      if (w) warnings.push(w);
    }
    if (m.discord_role_id) {
      const w = await ms.setRole(target.id, m.discord_role_id, true);
      if (w) warnings.push(w);
    }
    ms.dm(target.id, {
      title: tier.kind === 'perma' ? '👑 Willkommen im Perma-Mandat' : `⭐ Willkommen bei ${tier.name}`,
      description: `Ihre Mitgliedschaft **${tier.name}** bei Pake & Scha ist aktiv${expires ? ` bis **${ms.fmtDate(expires)}**` : ' – **unbefristet**'}.${tier.discount_pct ? ` Sie erhalten **${tier.discount_pct} % Rabatt** auf alle Leistungen der Kanzlei.` : ''}${tier.benefits ? `\n\n**Ihre Vorteile:**\n${tier.benefits}` : ''}`,
      color: tickets.COLORS.gold,
    });
    ms.notify(`${tier.kind === 'perma' ? '👑 Perma-Mandat' : '⭐ VIP'} vergeben`, m, [{ name: 'Vergeben von', value: req.user.display_name }]);
    res.status(201).json({ membership: memberRow(db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(id)), invoice, warnings });
  })
);

router.post(
  '/:id/renew',
  requireBoard,
  wrap(async (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id = ?').get(idParam(req));
    if (!m) return res.status(404).json({ error: 'Mitgliedschaft nicht gefunden.' });
    if (m.kind === 'perma' || !m.expires_at) return res.status(400).json({ error: 'Ein Perma-Mandat ist unbefristet – es muss nicht verlängert werden.' });
    if (m.status === 'beendet') return res.status(400).json({ error: 'Beendete Mitgliedschaften lassen sich nicht verlängern – bitte neu vergeben.' });
    const d = parseBody(z.object({ invoice: z.boolean().optional() }), req, res);
    if (!d) return;
    const tier = m.tier_id ? db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(m.tier_id) : null;
    if (!tier || !tier.duration_days) return res.status(400).json({ error: 'Die Stufe gibt es nicht mehr – bitte eine neue Mitgliedschaft vergeben.' });
    const base = m.status === 'aktiv' && m.expires_at > nowIso() ? m.expires_at : nowIso();
    const expires = plusDays(base, tier.duration_days);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
    let invoice = null;
    tx(() => {
      db.prepare("UPDATE memberships SET status = 'aktiv', expires_at = ?, reminded_at = NULL, ended_at = NULL, price_paid = price_paid + ? WHERE id = ?").run(expires, tier.price, m.id);
      if (d.invoice !== false && tier.price > 0) invoice = membershipInvoice(req.user, target, tier, `Verlängerung ${tierLabel(tier)}`);
    });
    logActivity(req.user, 'VIP verlängert', 'membership', m.id, `${target.display_name}: ${m.tier_name} bis ${ms.fmtDate(expires)}${invoice ? ` · Rechnung ${invoice.number}` : ''}`);
    const warnings = [];
    if (m.status !== 'aktiv' && m.discord_role_id) {
      const w = await ms.setRole(m.user_id, m.discord_role_id, true);
      if (w) warnings.push(w);
    }
    ms.dm(m.user_id, { title: `✅ ${m.tier_name} verlängert`, description: `Ihre Mitgliedschaft **${m.tier_name}** ist jetzt gültig bis **${ms.fmtDate(expires)}**.`, color: tickets.COLORS.green });
    ms.notify('🔁 VIP verlängert', { ...m, expires_at: expires });
    res.json({ membership: memberRow(db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(m.id)), invoice, warnings });
  })
);

router.post(
  '/:id/end',
  requireBoard,
  wrap(async (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id = ?').get(idParam(req));
    if (!m) return res.status(404).json({ error: 'Mitgliedschaft nicht gefunden.' });
    if (m.status !== 'aktiv') return res.status(400).json({ error: 'Die Mitgliedschaft ist nicht mehr aktiv.' });
    const d = parseBody(z.object({ reason: z.string().trim().max(300).optional() }), req, res);
    if (!d) return;
    db.prepare("UPDATE memberships SET status = 'beendet', ended_at = ?, ended_by_name = ?, end_reason = ? WHERE id = ?").run(nowIso(), req.user.display_name, d.reason || '', m.id);
    const target = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.user_id);
    logActivity(req.user, `${ms.KIND_LABEL[m.kind] || 'Mitgliedschaft'} beendet`, 'membership', m.id, `${target ? target.display_name : ''}: ${m.tier_name}${d.reason ? ` – ${d.reason}` : ''}`);
    const warnings = [];
    if (m.discord_role_id) {
      const w = await ms.setRole(m.user_id, m.discord_role_id, false);
      if (w) warnings.push(w);
    }
    ms.notify(`⛔ ${ms.KIND_LABEL[m.kind] || 'Mitgliedschaft'} beendet`, m, [{ name: 'Beendet von', value: req.user.display_name }, ...(d.reason ? [{ name: 'Grund', value: d.reason }] : [])]);
    res.json({ membership: memberRow(db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(m.id)), warnings });
  })
);

/** Aktive Mitgliedschaft zum Mandanten einer Akte bzw. eines Kontos (Rechnungsformular). */
router.get('/detect', requireStaff, (req, res) => {
  const caseId = Number(req.query.caseId);
  let userId = Number(req.query.userId) || null;
  if (caseId) {
    const c = getCase(caseId);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    userId = c.client_id;
  }
  res.json({ membership: ms.brief(ms.activeFor(userId)) });
});

/** Aktive VIP/Perma-Mitgliedschaften für die Auswahl im Rechnungsformular (auch ohne Akte). */
router.get('/active', requireStaff, (req, res) => {
  const rows = db.prepare(`${MEMBER_SELECT} WHERE m.status = 'aktiv' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY u.display_name`).all(nowIso());
  res.json({ memberships: rows.map((m) => ({ ...ms.brief(m), userId: m.user_id, clientName: m.display_name })) });
});

/** Mandant: eigene Mitgliedschaft (Profil). */
router.get('/mine', (req, res) => {
  const m = ms.activeFor(req.user.id);
  const tier = m && m.tier_id ? db.prepare('SELECT benefits FROM membership_tiers WHERE id = ?').get(m.tier_id) : null;
  res.json({ membership: m ? { ...ms.brief(m), benefits: tier ? tier.benefits : '' } : null });
});

module.exports = { router };
