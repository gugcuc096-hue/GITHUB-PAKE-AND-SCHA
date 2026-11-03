'use strict';
/*
 * Honorarvereinbarung der Akte (aus einem Angebot des Honorarrechners, Code HON-4821):
 *   GET    /api/cases/:id/honorar          Vereinbarung, Rechnungspositionen und Rechenweg
 *   POST   /api/cases/:id/honorar          { code } – Angebot übernehmen (ersetzt eine bisherige)
 *   DELETE /api/cases/:id/honorar          Vereinbarung lösen (solange das Erfolgshonorar nicht abgerechnet ist)
 *   POST   /api/cases/:id/honorar/settle   { value } – erstrittener Betrag → Rechnung über das Erfolgshonorar mit Rechenweg
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db/db');
const { requireAuth, requireStaff, isStaff } = require('../core/auth');
const { wrap, parseBody, idParam } = require('../core/helpers');
const { getCase, caseAccess, addSystemNote, logActivity } = require('../db/models');
const honorar = require('../domain/honorar');
const { H } = honorar;

const caseRouter = express.Router({ mergeParams: true });
caseRouter.use(requireAuth, requireStaff);

function load(req, res, { edit = false } = {}) {
  const id = idParam(req);
  const c = id && getCase(id);
  const access = c && isStaff(req.user) ? caseAccess(c, req.user) : null;
  if (!c || !access || !access.canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  if (edit && !access.canEdit) {
    res.status(403).json({ error: 'Das ändern nur die zuständigen Anwälte und das Board of Partners.' });
    return null;
  }
  return c;
}

const payload = (caseId) => {
  const agreement = honorar.agreementFor(caseId);
  return { agreement, items: honorar.invoiceItems(agreement), rechenweg: agreement ? honorar.rechenweg(agreement.quote) : '' };
};

caseRouter.get('/', (req, res) => {
  const c = load(req, res);
  if (!c) return;
  res.json(payload(c.id));
});

caseRouter.post(
  '/',
  wrap(async (req, res) => {
    const c = load(req, res, { edit: true });
    if (!c) return;
    const d = parseBody(z.object({ code: z.string().trim().min(4).max(20) }), req, res);
    if (!d) return;
    const r = honorar.attachOffer(c.id, d.code, req.user);
    if (r.error) return res.status(r.status).json({ error: r.error });
    addSystemNote(c.id, req.user, `Honorarvereinbarung aus Angebot ${r.offer.code} übernommen (${H.range(r.offer.totalLow, r.offer.totalHigh)}).`, true);
    logActivity(req.user, 'Honorarangebot übernommen', 'case', c.id, `${c.case_number} · ${r.offer.code}`);
    res.status(201).json(payload(c.id));
  })
);

caseRouter.delete(
  '/',
  wrap(async (req, res) => {
    const c = load(req, res, { edit: true });
    if (!c) return;
    const a = honorar.agreementFor(c.id);
    if (!a) return res.status(404).json({ error: 'Diese Akte hat keine Honorarvereinbarung.' });
    if (a.settledAt) return res.status(409).json({ error: 'Das Erfolgshonorar ist schon abgerechnet – die Vereinbarung bleibt.' });
    db.prepare('DELETE FROM case_fee_agreements WHERE case_id = ?').run(c.id);
    addSystemNote(c.id, req.user, `Honorarvereinbarung (${a.offerCode}) gelöst.`, true);
    res.json({ success: true });
  })
);

/** Erfolgshonorar abrechnen: erstrittener Betrag → Rechnung mit Rechenweg (je Erfolgsposition eine Zeile). */
caseRouter.post(
  '/settle',
  wrap(async (req, res) => {
    const c = load(req, res, { edit: true });
    if (!c) return;
    const d = parseBody(z.object({ value: z.number().int().min(1).max(1_000_000_000) }), req, res);
    if (!d) return;
    const a = honorar.agreementFor(c.id);
    if (!a || !a.hasSuccess) return res.status(400).json({ error: 'Diese Akte hat keine Vereinbarung mit Erfolgshonorar.' });
    if (a.settledAt) return res.status(409).json({ error: 'Das Erfolgshonorar ist schon abgerechnet.' });
    const parts = H.settle(a.quote.success, d.value);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    const notes = [
      `Erfolgshonorar laut Honorarvereinbarung ${a.offerCode} – erstrittener Betrag ${H.money(d.value)}.`,
      'Rechenweg:',
      ...parts.map((p) => `• ${p.name}: ${p.steps.join(' → ')} = ${H.money(p.amount)}`),
    ].join('\n');
    const invoices = require('./invoices');
    const body = invoices.createSchema.parse({
      kind: 'rechnung',
      caseId: c.id,
      subject: `Erfolgshonorar – ${c.title}`.slice(0, 200),
      items: parts.map((p) => ({ description: p.line.slice(0, 200), quantity: 1, unitPrice: p.amount })),
      promo: false, // vereinbarter Prozentsatz – keine Rabattaktion
      notes,
    });
    const r = await invoices.createInvoice(req.user, body);
    if (r.status !== 201) return res.status(r.status).json(r.body);
    db.prepare("UPDATE case_fee_agreements SET success_value = ?, success_amount = ?, success_invoice_id = ?, settled_at = datetime('now') WHERE case_id = ?").run(d.value, total, r.body.invoice.id, c.id);
    addSystemNote(c.id, req.user, `Erfolgshonorar abgerechnet: ${parts.map((p) => p.steps[0]).join(' + ')} → ${H.money(total)} (Rechnung ${r.body.invoice.number}).`, true);
    res.status(201).json({ ...payload(c.id), invoice: r.body.invoice, parts, total });
  })
);

module.exports = { caseRouter };
