'use strict';
const express = require('express');
const { z } = require('zod');
const { db, nextInvoiceNumber, getSetting } = require('../db');
const { requireAuth, requireStaff, requireAdmin, isStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, truncate } = require('../helpers');
const { imageBody, saveImage, removeFile, evidencePath } = require('../uploads');
const { INVOICE_SELECT, invoiceRow, getCase, caseLawyers, addSystemNote, logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');
const coop = require('../cooperations');
const memberships = require('../memberships');

const router = express.Router();
router.use(requireAuth);

const money = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;

/** Rechnungsdaten der Kanzlei (im Dashboard unter Einstellungen pflegbar). */
function firmInfo() {
  return {
    address: getSetting('firm_address', 'Pake & Scha Legal Consulting\nWürfelpark\nLos Santos, San Andreas'),
    paymentInfo: getSetting('firm_payment_info', 'Zahlbar per Überweisung an Pake & Scha Legal Consulting (Maze Bank).'),
    contact: getSetting('firm_contact', 'kontakt@pake-scha.ls'),
  };
}

function visibleTo(inv, u) {
  return isStaff(u) || (inv.case_client_id && inv.case_client_id === u.id) || (inv.client_user_id && inv.client_user_id === u.id);
}

router.get('/', (req, res) => {
  const u = req.user;
  const rows = isStaff(u)
    ? db.prepare(`${INVOICE_SELECT} ORDER BY i.created_at DESC, i.id DESC`).all()
    : db.prepare(`${INVOICE_SELECT} WHERE c.client_id = ? OR i.client_user_id = ? ORDER BY i.created_at DESC, i.id DESC`).all(u.id, u.id);
  res.json({ invoices: rows.map(invoiceRow) });
});

/** Briefkopf der Kanzlei (Anschrift, Kontakt) – z. B. für den Aktenauszug. */
router.get('/firm', (req, res) => res.json({ firm: firmInfo() }));

/** Kanzlei: offene Rechnungen, die der Mandant als bezahlt gemeldet hat (Badge „Rechnungen“). */
router.get('/payment-reports', requireStaff, (req, res) => {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'offen' AND payment_reported_at IS NOT NULL").get();
  res.json({ count: n });
});

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const inv = id && db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
    if (!inv || !visibleTo(inv, req.user)) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    res.json({ invoice: invoiceRow(inv), firm: firmInfo() });
  })
);

const itemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(999),
  unitPrice: z.number().int().min(0).max(1_000_000_000),
});

const createSchema = z.object({
  kind: z.enum(['rechnung', 'honorarvereinbarung']).default('rechnung'),
  caseId: z.number().int().positive().nullable().optional(),
  clientName: z.string().trim().max(120).optional(),
  clientContact: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(200).optional(),
  items: z.array(itemSchema).min(1).max(50),
  discountPct: z.number().min(0).max(100).default(0),
  cooperationId: z.number().int().positive().nullable().optional(),
  membershipId: z.number().int().positive().nullable().optional(), // VIP / Lifetime
  surchargePct: z.number().min(0).max(100).default(0),
  dueDate: dateOnly.nullable().optional(),
  notes: z.string().trim().max(3000).optional(),
});

/**
 * Berechnung wie im Tarifrechner der Startseite: erst Rabatte, dann Zuschlag.
 * VIP-/Lifetime-Rabatt, Kooperationsrabatt und sonstiger Rabatt beziehen sich auf die Zwischensumme
 * (zusammen höchstens 100 %); der Zuschlag auf den Betrag danach.
 */
function computeTotals(items, discountPct, surchargePct, coopPct = 0, memberPct = 0) {
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  let rest = subtotal;
  const take = (pct) => {
    const amount = Math.min(rest, Math.round((subtotal * pct) / 100));
    rest -= amount;
    return amount;
  };
  const memberAmount = take(memberPct);
  const coopAmount = take(coopPct);
  const discountAmount = take(discountPct);
  const surchargeAmount = Math.round((rest * surchargePct) / 100);
  return { subtotal, memberAmount, coopAmount, discountAmount, surchargeAmount, total: rest + surchargeAmount };
}
const VIA_LABEL = { discord: 'Discord-Rolle erkannt', konto: 'Konto zugeordnet', manuell: 'von Hand gewählt' };

router.post(
  '/',
  requireStaff,
  wrap(async (req, res) => {
    const u = req.user;
    const d = parseBody(createSchema, req, res);
    if (!d) return;

    let c = null;
    if (d.caseId) {
      c = getCase(d.caseId);
      if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    }
    const clientName = d.clientName || (c ? c.client_account_name || c.client_name : '');
    if (!clientName || clientName.length < 2) return res.status(400).json({ error: 'Bitte den Rechnungsempfänger angeben.' });
    const clientContact = d.clientContact || (c ? c.client_phone || c.client_account_phone || c.client_email || '' : '');

    // Kooperationsrabatt: Satz immer aus der Kooperation (nicht aus dem Formular); festhalten, wie er zustande kam
    let k = null;
    let via = '';
    if (d.cooperationId) {
      k = db.prepare('SELECT * FROM cooperations WHERE id = ?').get(d.cooperationId);
      if (!k || !coop.isValid(k)) return res.status(400).json({ error: 'Die gewählte Kooperation gibt es nicht oder sie ist nicht (mehr) aktiv.' });
      via = 'manuell';
      if (c) {
        const found = await coop.detectForCase(c).catch(() => null);
        const hit = found && found.matches.find((m) => m.id === k.id);
        if (hit) via = hit.via;
      }
    }
    // VIP / Lifetime: Satz aus der (aktiven) Mitgliedschaft
    let ms = null;
    if (d.membershipId) {
      ms = db.prepare("SELECT * FROM memberships WHERE id = ? AND status = 'aktiv' AND (expires_at IS NULL OR expires_at > ?)").get(d.membershipId, new Date().toISOString());
      if (!ms) return res.status(400).json({ error: 'Die gewählte VIP-/Lifetime-Mitgliedschaft ist nicht (mehr) aktiv.' });
    }
    // VIP/Lifetime und Kooperation werden nicht addiert – es gilt der höhere Rabatt
    if (ms && k) {
      if (ms.discount_pct >= k.discount_pct) k = null;
      else ms = null;
    }
    const items = d.items.map((it) => ({ ...it, total: it.quantity * it.unitPrice }));
    const t = computeTotals(items, d.discountPct, d.surchargePct, k ? k.discount_pct : 0, ms ? ms.discount_pct : 0);
    const clientUserId = ms ? ms.user_id : c ? c.client_id || null : null;
    const number = nextInvoiceNumber(d.kind);

    const info = db
      .prepare(
        `INSERT INTO invoices (number, kind, case_id, client_name, client_contact, subject, items_json, subtotal,
                               discount_pct, discount_amount, surcharge_pct, surcharge_amount, total, notes, due_date,
                               issued_by, issuer_name, issuer_rank, cooperation_id, coop_name, coop_pct, coop_amount, coop_via,
                               membership_id, member_name, member_pct, member_amount, client_user_id, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        number,
        d.kind,
        c ? c.id : null,
        clientName,
        clientContact,
        d.subject || '',
        JSON.stringify(items),
        t.subtotal,
        d.discountPct,
        t.discountAmount,
        d.surchargePct,
        t.surchargeAmount,
        t.total,
        d.notes || '',
        d.dueDate || null,
        u.id,
        u.display_name,
        u.rank || '',
        k ? k.id : null,
        k ? k.name : '',
        k ? k.discount_pct : 0,
        t.coopAmount,
        via,
        ms ? ms.id : null,
        ms ? ms.tier_name : '',
        ms ? ms.discount_pct : 0,
        t.memberAmount,
        clientUserId,
        // 0 $ (z. B. Lifetime): gilt sofort als beglichen; die Positionen dokumentieren den Wert der Arbeit
        t.total === 0 ? 'bezahlt' : 'offen',
        t.total === 0 ? new Date().toISOString() : null
      );

    const label = d.kind === 'rechnung' ? 'Rechnung' : 'Honorarvereinbarung';
    const coopText = [
      ms ? `${ms.tier_name} ${ms.discount_pct} % (Wert ${money(t.subtotal)}, abgedeckt ${money(t.memberAmount)})` : '',
      k ? `Kooperationsrabatt ${k.name} ${k.discount_pct} % (${VIA_LABEL[via]})` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (c) addSystemNote(c.id, u, `${label} ${number} über ${money(t.total)} erstellt.${coopText ? ` ${coopText}.` : ''}`, true);
    logActivity(u, `${label} erstellt`, 'invoice', Number(info.lastInsertRowid), `${number} · ${clientName} · ${money(t.total)}${coopText ? ` · ${coopText}` : ''}`);
    discord.notify('invoice.created', {
      title: `🧾 ${label} ${number}`,
      description: d.subject ? truncate(d.subject, 300) : undefined,
      fields: [
        { name: 'Empfänger', value: clientName },
        { name: 'Betrag', value: money(t.total) },
        ...(ms ? [{ name: ms.tier_name, value: `${ms.discount_pct} % (− ${money(t.memberAmount)}, Wert der Leistungen ${money(t.subtotal)})` }] : []),
        ...(k ? [{ name: 'Kooperationsrabatt', value: `${k.name} · ${k.discount_pct} % (− ${money(t.coopAmount)}, ${VIA_LABEL[via]})` }] : []),
        { name: 'Akte', value: c ? c.case_number : '—' },
        { name: 'Erstellt von', value: u.display_name },
      ],
    });

    if (c) {
      tickets.post(c.id, {
        title: `🧾 ${label} ${number}`,
        description: `${d.subject ? `${truncate(d.subject, 300)}\n` : ''}Im Mandantenportal unter „Rechnungen“ abrufbar.`,
        fields: [
          { name: 'Betrag', value: money(t.total) },
          ...(ms ? [{ name: ms.tier_name, value: t.total === 0 ? 'vollständig abgedeckt' : `${ms.discount_pct} %` }] : []),
          ...(k ? [{ name: 'Kooperationsrabatt', value: `${k.name} · ${k.discount_pct} %` }] : []),
          ...(d.dueDate ? [{ name: 'Fällig am', value: new Date(`${d.dueDate}T12:00:00`).toLocaleDateString('de-DE') }] : []),
        ],
        mention: 'client',
        by: u.display_name,
        byDiscordId: u.discord_id,
      });
    }
    const inv = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(Number(info.lastInsertRowid));
    res.status(201).json({ invoice: invoiceRow(inv) });
  })
);

router.patch(
  '/:id',
  requireStaff,
  wrap(async (req, res) => {
    const id = idParam(req);
    const inv = id && db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    const d = parseBody(z.object({ status: z.enum(['offen', 'bezahlt', 'storniert']) }), req, res);
    if (!d) return;
    db.prepare('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?').run(
      d.status,
      d.status === 'bezahlt' ? new Date().toISOString() : null,
      inv.id
    );
    if (d.status !== inv.status) {
      logActivity(req.user, 'Rechnungsstatus geändert', 'invoice', inv.id, `${inv.number}: ${inv.status} → ${d.status}`);
      require('../googleDocs').touch('invoice', inv.id); // Stempel „BEZAHLT“/„STORNIERT“ im Google Doc
    }
    // Zahlungsmeldung des Mandanten: Bestätigung ins Ticket; wieder „offen“ → alte Meldung gilt nicht mehr
    if (inv.payment_reported_at && inv.status === 'offen' && d.status === 'bezahlt') {
      const full = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(inv.id);
      tellClient(
        full,
        {
          title: `✅ Zahlung eingegangen: ${docLabel(inv)} ${inv.number}`,
          description: `Vielen Dank – Ihre Zahlung über **${money(inv.total)}** ist eingegangen. Die ${docLabel(inv)} ist damit beglichen.`,
          color: tickets.COLORS.green,
        },
        req.user
      );
    } else if (inv.payment_reported_at && inv.status !== 'offen' && d.status === 'offen') {
      db.prepare("UPDATE invoices SET payment_reported_at = NULL, payment_note = '', payment_proof = '', payment_reported_by = NULL WHERE id = ?").run(inv.id);
      if (inv.payment_proof) removeFile('evidence', inv.payment_proof);
    }
    // VIP/Lifetime-Anfrage: bezahlt → Mitgliedschaft freischalten, storniert → Anfrage abgelehnt
    let warnings = [];
    if (d.status !== inv.status && d.status === 'bezahlt') {
      const a = await memberships.activateRequestByInvoice(inv.id, req.user);
      if (a) warnings = a.warnings;
    } else if (d.status !== inv.status && d.status === 'storniert') {
      memberships.cancelRequestByInvoice(inv.id, req.user);
    }
    res.json({ invoice: invoiceRow(db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(inv.id)), warnings });
  })
);

/* ---------------------------------------------------------------- Zahlung melden (Mandant) */
/** Empfänger der Rechnung: der Mandant der Akte bzw. das Konto, auf das die Rechnung läuft. */
const isRecipient = (inv, u) => u.role === 'mandant' && ((inv.case_client_id && inv.case_client_id === u.id) || (inv.client_user_id && inv.client_user_id === u.id));
const docLabel = (inv) => (inv.kind === 'honorarvereinbarung' ? 'Honorarvereinbarung' : 'Rechnung');
const loadInvoice = (id) => (id ? db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id) : null);

/** Mandant informieren: im Ticket der Akte – ohne Ticket (z. B. VIP-Rechnung ohne Akte) per Discord-Direktnachricht. */
function tellClient(inv, msg, by) {
  const c = inv.case_id ? getCase(inv.case_id) : null;
  if (c && tickets.active() && !c.discord_deleted) {
    tickets.post(c.id, { ...msg, mention: 'client', by: by.display_name, byDiscordId: by.discord_id });
    return;
  }
  const clientId = inv.client_user_id || inv.case_client_id;
  if (clientId) memberships.dm(clientId, { title: msg.title, description: msg.description, color: msg.color }).catch(() => {});
}

/** Wer bekommt die Meldung im Team-Kanal gepingt: die Anwälte der Akte, sonst wer die Rechnung erstellt hat. */
function paymentPingIds(inv, c) {
  const ids = c ? caseLawyers(c).map((l) => l.discordId) : [];
  if (!ids.length && inv.issued_by) {
    const issuer = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(inv.issued_by);
    if (issuer && issuer.discord_id) ids.push(issuer.discord_id);
  }
  return ids.filter(Boolean);
}

/**
 * Mandant meldet: „Ich habe bezahlt“ (optional mit Hinweis, z. B. Verwendungszweck, und Screenshot als Nachweis).
 * Die Rechnung bleibt offen, bis die Kanzlei den Zahlungseingang bestätigt („Bezahlt“) oder die Meldung zurückweist.
 */
router.post(
  '/:id/payment-report',
  wrap(async (req, res) => {
    const u = req.user;
    const inv = loadInvoice(idParam(req));
    if (!inv || !visibleTo(inv, u)) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    if (!isRecipient(inv, u)) return res.status(403).json({ error: 'Nur der Empfänger der Rechnung kann eine Zahlung melden.' });
    if (inv.status !== 'offen') return res.status(400).json({ error: 'Diese Rechnung ist nicht (mehr) offen.' });
    if (inv.payment_reported_at) return res.status(409).json({ error: 'Die Zahlung ist bereits gemeldet – die Kanzlei prüft den Eingang.' });
    const d = parseBody(z.object({ note: z.string().trim().max(500).optional() }), req, res);
    if (!d) return;
    db.prepare("UPDATE invoices SET payment_reported_at = datetime('now'), payment_note = ?, payment_reported_by = ? WHERE id = ?").run(d.note || '', u.id, inv.id);

    const label = docLabel(inv);
    const c = inv.case_id ? getCase(inv.case_id) : null;
    const fields = [
      { name: 'Betrag', value: money(inv.total) },
      { name: 'Gemeldet von', value: u.display_name },
      ...(d.note ? [{ name: 'Hinweis des Mandanten', value: truncate(d.note, 500) }] : []),
      ...(inv.case_number ? [{ name: 'Akte', value: inv.case_number }] : []),
    ];
    const viaTicket = !!c && tickets.active() && !!c.discord_channel_id && !c.discord_deleted;
    if (c) addSystemNote(c.id, u, `${label} ${inv.number} als bezahlt gemeldet – bitte den Zahlungseingang prüfen.${d.note ? ` Hinweis: ${truncate(d.note, 300)}` : ''}`, true);
    logActivity(u, 'Zahlung gemeldet', 'invoice', inv.id, `${inv.number} · ${money(inv.total)}`);
    discord.notify('invoice.payment', {
      title: `💸 Zahlung gemeldet: ${label} ${inv.number}`,
      description: 'Der Mandant meldet die Zahlung. Bitte den Eingang prüfen und die Rechnung im Dashboard als „Bezahlt“ bestätigen.',
      fields: [{ name: 'Empfänger', value: inv.client_name || '—' }, ...fields],
      // Mit Ticket pingt die Nachricht im Ticket – im Team-Kanal dann nicht noch einmal
      mentionIds: viaTicket ? [] : paymentPingIds(inv, c),
    });
    if (c) {
      tickets.post(c.id, {
        title: `💸 Zahlung gemeldet: ${label} ${inv.number}`,
        description: 'Der Mandant hat die Zahlung über das Mandantenportal gemeldet. Die Kanzlei prüft den Eingang und bestätigt ihn.',
        fields,
        color: tickets.COLORS.blue,
        mention: 'lawyers',
        by: u.display_name,
        byDiscordId: u.discord_id,
      });
    }
    res.json({ invoice: invoiceRow(loadInvoice(inv.id)) });
  })
);

/** Screenshot der Überweisung zur Meldung hochladen (ersetzt einen früheren). Liegt geschützt, nicht öffentlich. */
router.post(
  '/:id/payment-proof',
  imageBody,
  wrap(async (req, res) => {
    const u = req.user;
    const inv = loadInvoice(idParam(req));
    if (!inv || !visibleTo(inv, u)) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    if (!isRecipient(inv, u)) return res.status(403).json({ error: 'Nur der Empfänger der Rechnung kann einen Nachweis hochladen.' });
    if (inv.status !== 'offen' || !inv.payment_reported_at) return res.status(400).json({ error: 'Bitte zuerst die Zahlung melden.' });
    const saved = saveImage(req, 'evidence');
    db.prepare('UPDATE invoices SET payment_proof = ? WHERE id = ?').run(saved.file, inv.id);
    if (inv.payment_proof) removeFile('evidence', inv.payment_proof);
    if (inv.case_id) addSystemNote(inv.case_id, u, `Zahlungsnachweis (Screenshot) zu ${docLabel(inv)} ${inv.number} hochgeladen.`, true);
    res.json({ invoice: invoiceRow(loadInvoice(inv.id)) });
  })
);

/** Nachweis ansehen: Kanzlei und der Empfänger selbst. */
router.get(
  '/:id/payment-proof',
  wrap(async (req, res) => {
    const inv = loadInvoice(idParam(req));
    if (!inv || !visibleTo(inv, req.user) || !inv.payment_proof) return res.status(404).json({ error: 'Kein Nachweis vorhanden.' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(evidencePath(inv.payment_proof), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Datei nicht gefunden.' });
    });
  })
);

/** Kanzlei: Zahlung ist (noch) nicht eingegangen – Meldung zurückweisen; der Mandant wird im Ticket informiert. */
router.post(
  '/:id/payment-reject',
  requireStaff,
  wrap(async (req, res) => {
    const u = req.user;
    const inv = loadInvoice(idParam(req));
    if (!inv) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    if (inv.status !== 'offen' || !inv.payment_reported_at) return res.status(400).json({ error: 'Zu dieser Rechnung liegt keine offene Zahlungsmeldung vor.' });
    const d = parseBody(z.object({ reason: z.string().trim().max(300).optional() }), req, res);
    if (!d) return;
    db.prepare("UPDATE invoices SET payment_reported_at = NULL, payment_note = '', payment_proof = '', payment_reported_by = NULL WHERE id = ?").run(inv.id);
    if (inv.payment_proof) removeFile('evidence', inv.payment_proof);
    const label = docLabel(inv);
    // Für den Mandanten sichtbar in der Akte – der Hinweis richtet sich an ihn
    if (inv.case_id) addSystemNote(inv.case_id, u, `Zahlung zu ${label} ${inv.number} ist noch nicht eingegangen – bitte die Überweisung prüfen und erneut melden.${d.reason ? ` Hinweis der Kanzlei: ${truncate(d.reason, 300)}` : ''}`, false);
    tellClient(
      inv,
      {
        title: `⚠️ Zahlung noch nicht eingegangen: ${label} ${inv.number}`,
        description: `Ihre Zahlung über **${money(inv.total)}** ist bei uns noch nicht eingegangen.${d.reason ? `\n\n${truncate(d.reason, 300)}` : ''}\n\nBitte prüfen Sie die Überweisung und melden Sie die Zahlung im Mandantenportal unter „Rechnungen“ erneut.`,
        color: tickets.COLORS.gold,
      },
      u
    );
    logActivity(u, 'Zahlungsmeldung zurückgewiesen', 'invoice', inv.id, `${inv.number}${d.reason ? ` · ${truncate(d.reason, 120)}` : ''}`);
    res.json({ invoice: invoiceRow(loadInvoice(inv.id)) });
  })
);

/** Zahlungserinnerung von Hand senden (Discord-DM an den Mandanten und ins Ticket der Akte). */
router.post(
  '/:id/remind',
  requireStaff,
  wrap(async (req, res) => {
    const id = idParam(req);
    if (!id) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    const { sent } = await require('../paymentReminders').sendReminder(id, req.user);
    res.json({ sent, invoice: invoiceRow(db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id)) });
  })
);

router.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const inv = id && db.prepare('SELECT id, number, payment_proof FROM invoices WHERE id = ?').get(id);
    if (!inv) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    if (inv.payment_proof) removeFile('evidence', inv.payment_proof);
    logActivity(req.user, 'Rechnung gelöscht', 'invoice', inv.id, inv.number);
    require('../googleDocs').remove('invoice', inv.id);
    res.json({ success: true });
  })
);

module.exports = router;
module.exports.firmInfo = firmInfo;
module.exports.visibleTo = visibleTo;
