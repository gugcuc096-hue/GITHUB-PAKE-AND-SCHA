'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, nextCaseNumber, randomPin, getSetting } = require('../db');
const { wrap, parseBody, AREAS, URGENCIES, STEPS, CASE_STATUS, truncate } = require('../helpers');
const { addSystemNote, getCase, onDutyMembers } = require('../models');
const discord = require('../discord');

const router = express.Router();

const limit = (windowMs, max, message, skipFailedRequests = false) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests,
    handler: (req, res) => res.status(429).json({ error: message }),
  });

const statusLimiter = limit(15 * 60 * 1000, 15, 'Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.');
// Nur erfolgreich eingereichte Mandate zählen; Tippfehler im Formular verbrauchen kein Kontingent.
const requestLimiter = limit(60 * 60 * 1000, 5, 'Sie haben bereits mehrere Anfragen gesendet. Bitte versuchen Sie es später erneut.', true);

/* Eilnotdienst: Wer ist gerade im Dienst? (abschaltbar unter Einstellungen) */
router.get('/on-duty', (req, res) => {
  if (getSetting('show_duty_public', '1') !== '1') return res.json({ visible: false, count: null, members: [] });
  const members = onDutyMembers().map((m) => ({ name: m.name, rank: m.rank, status: m.status, statusLabel: m.statusLabel }));
  res.json({ visible: true, count: members.length, members });
});

/* Aktenstatus: Aktenzeichen + 6-stelliger Aktenpin (Aktenzeichen allein sind erratbar). */
router.post(
  '/case-status',
  statusLimiter,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ caseNumber: z.string().trim().min(1).max(30), pin: z.string().trim().min(1).max(10) }), req, res);
    if (!d) return;
    const c = db
      .prepare(
        `SELECT c.*, u.display_name AS lawyer_name FROM cases c LEFT JOIN users u ON u.id = c.lawyer_id
         WHERE c.case_number = ? AND c.access_pin = ?`
      )
      .get(d.caseNumber.toUpperCase(), d.pin);
    if (!c) return res.status(404).json({ error: 'Kein Mandat mit diesen Angaben gefunden.' });
    res.json({
      caseNumber: c.case_number,
      lawyer: c.lawyer_name || 'Noch nicht zugewiesen',
      status: c.status === 'geschlossen' ? 'Abgeschlossen' : c.status === 'offen' ? 'Eingegangen' : STEPS[c.step] || STEPS[0],
      statusLabel: CASE_STATUS[c.status],
      step: c.step,
      closed: c.status === 'geschlossen',
      note: c.public_note || null,
      updatedAt: c.updated_at,
    });
  })
);

/*
 * Mandat einreichen direkt von der Startseite -- auch ohne Konto. Der Besucher
 * erhält Aktenzeichen + Aktenpin für die Statusabfrage; das Team wird per
 * Discord benachrichtigt. Angemeldete Mandanten bekommen die Akte ins Konto.
 */
const requestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(40).optional(),
  area: z.enum(AREAS),
  urgency: z.enum(URGENCIES).default('normal'),
  description: z.string().trim().min(10).max(4000),
  website: z.string().max(0).optional(), // Honeypot-Feld: bleibt bei Menschen leer
});

const AREA_TITLES = {
  strafrecht: 'Strafrecht / Festnahme',
  zivilrecht: 'Zivilrecht / Schadensersatz',
  verfassungsrecht: 'Verfassungsbeschwerde',
  vertragsrecht: 'Vertragsrecht / Ausarbeitung',
  sonstiges: 'Sonstiges Anliegen',
};

router.post(
  '/cases',
  requestLimiter,
  wrap(async (req, res) => {
    const d = parseBody(requestSchema, req, res);
    if (!d) return;
    const account = req.user && req.user.role === 'mandant' ? req.user : null;
    const title = truncate(`${AREA_TITLES[d.area]}: ${d.description.replace(/\s+/g, ' ')}`, 110);
    const pin = randomPin();

    const id = tx(() => {
      const info = db
        .prepare(
          `INSERT INTO cases (case_number, access_pin, title, area, urgency, description, client_id, client_name, client_phone, status, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen', 'web')`
        )
        .run(nextCaseNumber(), pin, title, d.area, d.urgency, d.description, account ? account.id : null, account ? '' : d.name, d.phone || '');
      const newId = Number(info.lastInsertRowid);
      addSystemNote(newId, null, 'Mandatsanfrage über das Website-Formular eingegangen.');
      return newId;
    });

    const c = getCase(id);
    discord.notify('case.created', {
      title: `${d.urgency === 'notfall' ? '🚨 NOTFALL – ' : ''}Neue Mandatsanfrage ${c.case_number}`,
      description: truncate(d.description, 500),
      color: d.urgency === 'notfall' ? discord.RED : discord.GOLD,
      fields: [
        { name: 'Mandant', value: account ? account.display_name : d.name },
        { name: 'Telefon', value: d.phone || '—' },
        { name: 'Rechtsgebiet', value: AREA_TITLES[d.area] },
        { name: 'Dringlichkeit', value: d.urgency },
      ],
    });

    res.status(201).json({ caseId: account ? id : undefined, caseNumber: c.case_number, pin, linkedToAccount: !!account });
  })
);

module.exports = router;
