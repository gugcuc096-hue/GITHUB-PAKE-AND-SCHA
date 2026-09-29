'use strict';
/*
 * VIP & Lifetime – Stufen (Preise, Laufzeit, Rabatt) und Mitgliedschaften verwaltet das Board of Partners.
 * Das Team sieht die aktive Mitgliedschaft eines Mandanten (Rechnungsformular, Akte), Mandanten ihre eigene.
 * Logik für Ablauf, Erinnerung und Discord-Rolle: ../memberships.js
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard, dateOnly } = require('../helpers');
const { getCase, caseAccess, logActivity } = require('../models');
const tickets = require('../tickets');
const discord = require('../discord');
const ms = require('../memberships');

const router = express.Router();
router.use(requireAuth);

function requireBoard(req, res, next) {
  if (!isBoard(req.user)) return res.status(403).json({ error: 'Nur für das Board of Partners.' });
  next();
}

const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;
const nowIso = () => new Date().toISOString();

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
  // Lifetime = unbefristet, VIP braucht eine Laufzeit
  if (d.kind === 'perma') d.durationDays = null;
  else if (d.kind === 'vip' && !d.durationDays) {
    res.status(400).json({ error: 'Bitte eine Laufzeit in Tagen angeben (z. B. 30) – unbefristet ist nur Lifetime.' });
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
    if (!target) return res.status(400).json({ error: 'VIP und Lifetime gibt es nur für aktive Mandantenkonten.' });
    const tier = db.prepare('SELECT * FROM membership_tiers WHERE id = ? AND active = 1').get(d.tierId);
    if (!tier) return res.status(400).json({ error: 'Diese Stufe gibt es nicht oder sie ist deaktiviert.' });
    const current = ms.activeFor(target.id);
    if (current && !d.replace) {
      return res.status(409).json({ error: `${target.display_name} hat bereits „${current.tier_name}“ (${current.expires_at ? `bis ${ms.fmtDate(current.expires_at)}` : 'unbefristet'}).`, current: ms.brief(current) });
    }
    const invoice = d.invoice !== false && tier.price > 0 ? ms.membershipInvoice(req.user, target, tier, ms.tierLabel(tier)) : null;
    const { id, warnings } = await ms.grant({ target, tier, by: req.user, note: d.note || '', startsOn: d.startsOn ? new Date(`${d.startsOn}T00:00:00`).toISOString() : null });
    if (invoice) logActivity(req.user, 'Rechnung für Mitgliedschaft', 'invoice', invoice.id, `${invoice.number} · ${target.display_name} · ${tier.name}`);
    res.status(201).json({ membership: memberRow(db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(id)), invoice, warnings });
  })
);

router.post(
  '/:id/renew',
  requireBoard,
  wrap(async (req, res) => {
    const m = db.prepare('SELECT * FROM memberships WHERE id = ?').get(idParam(req));
    if (!m) return res.status(404).json({ error: 'Mitgliedschaft nicht gefunden.' });
    if (m.kind === 'perma' || !m.expires_at) return res.status(400).json({ error: 'Lifetime ist unbefristet – es muss nicht verlängert werden.' });
    if (m.status === 'beendet') return res.status(400).json({ error: 'Beendete Mitgliedschaften lassen sich nicht verlängern – bitte neu vergeben.' });
    const d = parseBody(z.object({ invoice: z.boolean().optional() }), req, res);
    if (!d) return;
    const tier = m.tier_id ? db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(m.tier_id) : null;
    if (!tier || !tier.duration_days) return res.status(400).json({ error: 'Die Stufe gibt es nicht mehr – bitte eine neue Mitgliedschaft vergeben.' });
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
    const invoice = d.invoice !== false && tier.price > 0 ? ms.membershipInvoice(req.user, target, tier, `Verlängerung ${ms.tierLabel(tier)}`) : null;
    const { warnings } = await ms.extend(m, tier, req.user);
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

/** Aktive VIP/Lifetime-Mitgliedschaften für die Auswahl im Rechnungsformular (auch ohne Akte). */
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

/* ---------------------------------------------------------------- Anfragen (Startseite / Mandantenportal) */
/*
 * Ablauf: Mandant fragt eine Stufe an → Board nimmt an (Rechnung über den Preis, im Portal sichtbar) → sobald die
 * Rechnung auf „bezahlt“ steht, wird die Mitgliedschaft automatisch freigeschaltet (routes/invoices.js). Bezahlt wird
 * im Spiel; „Zahlung bereits erhalten“ schaltet sofort frei. Ablehnen mit Grund.
 */
const REQ_STATUS = { offen: 'Offen', angenommen: 'Angenommen – Zahlung ausstehend', aktiv: 'Freigeschaltet', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' };
const REQ_SELECT = `
  SELECT r.*, u.display_name, u.email, u.discord_id, i.number AS invoice_number, i.status AS invoice_status
  FROM membership_requests r JOIN users u ON u.id = r.user_id LEFT JOIN invoices i ON i.id = r.invoice_id`;

const publicTier = (t) => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  kindLabel: ms.KIND_LABEL[t.kind] || t.kind,
  price: t.price,
  durationDays: t.duration_days ?? null,
  discountPct: t.discount_pct,
  benefits: t.benefits,
});
const activeTiers = () => db.prepare('SELECT * FROM membership_tiers WHERE active = 1 ORDER BY sort_order, price').all();

function requestRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.display_name,
    email: r.email,
    discordLinked: !!r.discord_id,
    tierId: r.tier_id,
    tierName: r.tier_name,
    kind: r.kind,
    kindLabel: ms.KIND_LABEL[r.kind] || r.kind,
    price: r.price,
    durationDays: r.duration_days ?? null,
    discountPct: r.discount_pct,
    message: r.message,
    status: r.status,
    statusLabel: REQ_STATUS[r.status] || r.status,
    invoice: r.invoice_id ? { id: r.invoice_id, number: r.invoice_number, status: r.invoice_status } : null,
    decidedBy: r.decided_by_name || null,
    decisionNote: r.decision_note || '',
    createdAt: r.created_at,
    decidedAt: r.decided_at || null,
    activatedAt: r.activated_at || null,
  };
}
const loadRequest = (id) => db.prepare(`${REQ_SELECT} WHERE r.id = ?`).get(id) || null;

/** Mandant: Angebot, eigene Mitgliedschaft und eigene Anfragen (Portal „VIP & Lifetime“). */
router.get('/offers', (req, res) => {
  const m = ms.activeFor(req.user.id);
  const tier = m && m.tier_id ? db.prepare('SELECT benefits FROM membership_tiers WHERE id = ?').get(m.tier_id) : null;
  res.json({
    tiers: activeTiers().map(publicTier),
    membership: m ? { ...ms.brief(m), benefits: tier ? tier.benefits : '' } : null,
    requests: db.prepare(`${REQ_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 5`).all(req.user.id).map(requestRow),
  });
});

router.post(
  '/requests',
  wrap(async (req, res) => {
    const u = req.user;
    if (u.role !== 'mandant') return res.status(403).json({ error: 'VIP und Lifetime können nur Mandantenkonten anfragen.' });
    const d = parseBody(z.object({ tierId: z.number().int().positive(), message: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    const tier = db.prepare('SELECT * FROM membership_tiers WHERE id = ? AND active = 1').get(d.tierId);
    if (!tier) return res.status(400).json({ error: 'Dieses Angebot gibt es nicht (mehr).' });
    if (db.prepare("SELECT id FROM membership_requests WHERE user_id = ? AND status IN ('offen', 'angenommen')").get(u.id)) {
      return res.status(409).json({ error: 'Sie haben bereits eine laufende Anfrage. Den Stand sehen Sie im Portal unter „VIP & Lifetime“.' });
    }
    const current = ms.activeFor(u.id);
    if (current && current.kind === 'perma') return res.status(400).json({ error: 'Sie haben bereits Lifetime – mehr geht nicht.' });
    const info = db
      .prepare(
        `INSERT INTO membership_requests (user_id, tier_id, tier_name, kind, price, duration_days, discount_pct, discord_role_id, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(u.id, tier.id, tier.name, tier.kind, tier.price, tier.duration_days ?? null, tier.discount_pct, tier.discord_role_id || '', d.message || '');
    const r = loadRequest(Number(info.lastInsertRowid));
    logActivity(u, 'VIP/Lifetime angefragt', 'membership_request', r.id, `${u.display_name}: ${tier.name} (${money(tier.price)})`);
    discord.notify('membership.changed', {
      title: `🛎️ Neue Anfrage: ${tier.name}`,
      description: d.message || undefined,
      fields: [
        { name: 'Mandant', value: u.display_name },
        { name: 'Stufe', value: `${tier.name} · ${tier.discount_pct} % Rabatt · ${tier.duration_days ? `${tier.duration_days} Tage` : 'unbefristet'}` },
        { name: 'Preis', value: money(tier.price) },
        ...(current ? [{ name: 'Aktuell', value: `${current.tier_name}${current.expires_at ? ` bis ${ms.fmtDate(current.expires_at)}` : ''}` }] : []),
      ],
      link: discord.publicUrl('/dashboard.html#vip'),
      color: tier.kind === 'perma' ? discord.GOLD : 0x38bdf8,
    });
    res.status(201).json({ request: requestRow(r) });
  })
);

router.delete('/requests/:id', (req, res) => {
  const r = db.prepare("SELECT * FROM membership_requests WHERE id = ? AND user_id = ? AND status = 'offen'").get(idParam(req), req.user.id);
  if (!r) return res.status(404).json({ error: 'Keine offene Anfrage gefunden.' });
  db.prepare("UPDATE membership_requests SET status = 'zurueckgezogen', decided_at = datetime('now') WHERE id = ?").run(r.id);
  res.json({ success: true });
});

/** Board: Anfragen (offen + wartet auf Zahlung; ?status=alle für alle). */
router.get('/requests', requireBoard, (req, res) => {
  const all = req.query.status === 'alle';
  const rows = db
    .prepare(`${REQ_SELECT} ${all ? "WHERE r.status != 'zurueckgezogen'" : "WHERE r.status IN ('offen', 'angenommen')"} ORDER BY r.status = 'offen' DESC, r.id DESC LIMIT 200`)
    .all();
  res.json({ requests: rows.map(requestRow), open: db.prepare("SELECT COUNT(*) AS n FROM membership_requests WHERE status = 'offen'").get().n });
});

router.post(
  '/requests/:id/accept',
  requireBoard,
  wrap(async (req, res) => {
    const r = db.prepare('SELECT * FROM membership_requests WHERE id = ?').get(idParam(req));
    if (!r) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    if (r.status !== 'offen') return res.status(400).json({ error: 'Über diese Anfrage wurde bereits entschieden.' });
    const d = parseBody(z.object({ paid: z.boolean().optional(), note: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'mandant' AND active = 1").get(r.user_id);
    if (!target) return res.status(400).json({ error: 'Das Mandantenkonto ist nicht mehr aktiv.' });
    const snap = { name: r.tier_name, price: r.price, duration_days: r.duration_days };
    const invoice = ms.membershipInvoice(req.user, target, snap, ms.tierLabel(snap), { paid: !!d.paid });
    db.prepare("UPDATE membership_requests SET status = 'angenommen', invoice_id = ?, decided_by_name = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(
      invoice.id,
      req.user.display_name,
      d.note || '',
      r.id
    );
    logActivity(req.user, 'VIP/Lifetime-Anfrage angenommen', 'membership_request', r.id, `${target.display_name}: ${r.tier_name} · Rechnung ${invoice.number}${d.paid ? ' (bezahlt)' : ''}`);
    let warnings = [];
    if (d.paid) {
      const a = await ms.activateRequestByInvoice(invoice.id, req.user);
      if (a) warnings = a.warnings;
    } else {
      ms.dm(target.id, {
        title: `🧾 Anfrage angenommen: ${r.tier_name}`,
        description: `Ihre Anfrage für **${r.tier_name}** wurde angenommen. Bitte begleichen Sie die Rechnung **${invoice.number}** über **${money(r.price)}** – sobald sie bezahlt ist, wird Ihre Mitgliedschaft automatisch freigeschaltet.${d.note ? `\n\n${d.note}` : ''}`,
        color: tickets.COLORS.gold,
      });
    }
    res.json({ request: requestRow(loadRequest(r.id)), invoice, warnings });
  })
);

router.post(
  '/requests/:id/decline',
  requireBoard,
  wrap(async (req, res) => {
    const r = db.prepare('SELECT * FROM membership_requests WHERE id = ?').get(idParam(req));
    if (!r) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    if (r.status !== 'offen') return res.status(400).json({ error: 'Über diese Anfrage wurde bereits entschieden.' });
    const d = parseBody(z.object({ reason: z.string().trim().min(2).max(500) }), req, res);
    if (!d) return;
    db.prepare("UPDATE membership_requests SET status = 'abgelehnt', decided_by_name = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(req.user.display_name, d.reason, r.id);
    const target = db.prepare('SELECT display_name FROM users WHERE id = ?').get(r.user_id);
    logActivity(req.user, 'VIP/Lifetime-Anfrage abgelehnt', 'membership_request', r.id, `${target ? target.display_name : ''}: ${r.tier_name} – ${d.reason}`);
    ms.dm(r.user_id, { title: `❌ Anfrage abgelehnt: ${r.tier_name}`, description: `Ihre Anfrage für **${r.tier_name}** wurde abgelehnt.\n\n**Grund:** ${d.reason}`, color: tickets.COLORS.red });
    res.json({ request: requestRow(loadRequest(r.id)) });
  })
);

/* Öffentlich (Startseite): Angebot ohne Anmeldung */
const publicRouter = express.Router();
publicRouter.get('/memberships', (req, res) => {
  res.json({ tiers: activeTiers().map(publicTier) });
});

module.exports = { router, publicRouter };
