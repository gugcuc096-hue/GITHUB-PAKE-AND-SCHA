'use strict';
const express = require('express');
const { z } = require('zod');
const { db, nextInvoiceNumber, getSetting } = require('../db');
const { requireAuth, requireStaff, requireAdmin, isStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, truncate } = require('../helpers');
const { INVOICE_SELECT, invoiceRow, getCase, addSystemNote, logActivity } = require('../models');
const discord = require('../discord');

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
  return isStaff(u) || (inv.case_client_id && inv.case_client_id === u.id);
}

router.get('/', (req, res) => {
  const u = req.user;
  const rows = isStaff(u)
    ? db.prepare(`${INVOICE_SELECT} ORDER BY i.created_at DESC, i.id DESC`).all()
    : db.prepare(`${INVOICE_SELECT} WHERE c.client_id = ? ORDER BY i.created_at DESC, i.id DESC`).all(u.id);
  res.json({ invoices: rows.map(invoiceRow) });
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
  surchargePct: z.number().min(0).max(100).default(0),
  dueDate: dateOnly.nullable().optional(),
  notes: z.string().trim().max(3000).optional(),
});

/** Berechnung wie im Tarifrechner der Startseite: erst Rabatt, dann Zuschlag. */
function computeTotals(items, discountPct, surchargePct) {
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  const discountAmount = Math.round((subtotal * discountPct) / 100);
  const surchargeAmount = Math.round(((subtotal - discountAmount) * surchargePct) / 100);
  return { subtotal, discountAmount, surchargeAmount, total: subtotal - discountAmount + surchargeAmount };
}

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

    const items = d.items.map((it) => ({ ...it, total: it.quantity * it.unitPrice }));
    const t = computeTotals(items, d.discountPct, d.surchargePct);
    const number = nextInvoiceNumber(d.kind);

    const info = db
      .prepare(
        `INSERT INTO invoices (number, kind, case_id, client_name, client_contact, subject, items_json, subtotal,
                               discount_pct, discount_amount, surcharge_pct, surcharge_amount, total, notes, due_date,
                               issued_by, issuer_name, issuer_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        u.rank || ''
      );

    const label = d.kind === 'rechnung' ? 'Rechnung' : 'Honorarvereinbarung';
    if (c) addSystemNote(c.id, u, `${label} ${number} über ${money(t.total)} erstellt.`, true);
    logActivity(u, `${label} erstellt`, 'invoice', Number(info.lastInsertRowid), `${number} · ${clientName} · ${money(t.total)}`);
    discord.notify('invoice.created', {
      title: `🧾 ${label} ${number}`,
      description: d.subject ? truncate(d.subject, 300) : undefined,
      fields: [
        { name: 'Empfänger', value: clientName },
        { name: 'Betrag', value: money(t.total) },
        { name: 'Akte', value: c ? c.case_number : '—' },
        { name: 'Erstellt von', value: u.display_name },
      ],
    });

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
    if (d.status !== inv.status) logActivity(req.user, 'Rechnungsstatus geändert', 'invoice', inv.id, `${inv.number}: ${inv.status} → ${d.status}`);
    res.json({ invoice: invoiceRow(db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(inv.id)) });
  })
);

router.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const inv = id && db.prepare('SELECT id, number FROM invoices WHERE id = ?').get(id);
    if (!inv) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    logActivity(req.user, 'Rechnung gelöscht', 'invoice', inv.id, inv.number);
    res.json({ success: true });
  })
);

module.exports = router;
