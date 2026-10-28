'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, nextCaseNumber, randomPin, getSetting } = require('../db');
const { wrap, parseBody, AREAS, URGENCIES, URGENCY_LABEL, PRIORITY_DISCORD, PRIORITY_FROM_URGENCY, OUTCOMES, truncate } = require('../helpers');
const { addSystemNote, getCase, onDutyMembers, syncCaseWork } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');
const { intakeTitle } = require('../caseTitles');
const areas = require('../areas');

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

// Nur erfolgreich eingereichte Mandate zählen; Tippfehler im Formular verbrauchen kein Kontingent.
const requestLimiter = limit(60 * 60 * 1000, 5, 'Sie haben bereits mehrere Anfragen gesendet. Bitte versuchen Sie es später erneut.', true);

/* Eilnotdienst: Wer ist gerade im Dienst? (abschaltbar unter Einstellungen) */
/** Kanzleisitz für die Website (eine Einstellung – dieselbe wie Rechnungen und Termin-Orte). */
router.get('/firm', (req, res) => {
  const { firmSeat, firmPlace } = require('../models');
  res.json({ seat: firmSeat(), place: firmPlace() });
});

router.get('/on-duty', (req, res) => {
  if (getSetting('show_duty_public', '1') !== '1') return res.json({ visible: false, count: null, members: [] });
  const members = onDutyMembers().map((m) => ({ name: m.name, rank: m.rank, status: m.status, statusLabel: m.statusLabel }));
  res.json({ visible: true, count: members.length, members });
});

/*
 * Erfolge der Kanzlei für die Startseite (abschaltbar unter Einstellungen → Website). Gezählt werden abgeschlossene
 * Akten; die Erfolgsquote kommt aus dem Ergebnis, das beim Abschließen gewählt wird (Beratung ohne Verfahren und
 * vorzeitig beendete Mandate zählen nicht mit), dazu die Durchschnittsbewertung der Mandantenstimmen. Kleine Zahlen
 * sagen nichts aus – erst ab einer Mindestanzahl.
 */
const STATS_MIN_CLOSED = 10;
const STATS_MIN_RATED = 5;
router.get('/stats', (req, res) => {
  if (getSetting('show_success_public', '1') !== '1') return res.json({ visible: false });
  const closed = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE status = 'geschlossen'").get().n;
  let won = 0;
  let rated = 0;
  for (const r of db.prepare("SELECT outcome, COUNT(*) AS n FROM cases WHERE status = 'geschlossen' AND outcome IS NOT NULL GROUP BY outcome").all()) {
    const o = OUTCOMES[r.outcome];
    if (!o || o.success === null) continue;
    rated += r.n;
    if (o.success) won += r.n;
  }
  // Durchschnitt aller freigegebenen Mandantenstimmen (wie das Karussell erst ab drei)
  const rv = db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE status = 'freigegeben'").get();
  res.json({
    visible: true,
    closed: closed >= STATS_MIN_CLOSED ? closed : null,
    successRate: rated >= STATS_MIN_RATED ? Math.round((won / rated) * 100) : null,
    rating: rv.n >= 3 ? { avg: Math.round(rv.avg * 10) / 10, count: rv.n } : null,
  });
});

/*
 * Mandat einreichen direkt von der Startseite -- auch ohne Konto. Der Besucher
 * erhält das Aktenzeichen (der Pin dient nur dem direkten Beitritt zum Discord-Ticket); das Team wird per
 * Discord benachrichtigt. Angemeldete Mandanten bekommen die Akte ins Konto.
 */
const requestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(40).optional(),
  area: areas.activeKeySchema,
  answers: z.record(z.any()).optional(),
  urgency: z.enum(URGENCIES).default('normal'),
  description: z.string().trim().min(10).max(4000),
  teamMemberId: z.number().int().positive().optional(), // Wunschanwalt (Teamkarte „Direkt anfragen“)
  website: z.string().max(0).optional(), // Honeypot-Feld: bleibt bei Menschen leer
});

/** Wunschanwalt: sichtbare Teamkarte mit aktivem Anwalts-/Board-Konto – sonst geht die Anfrage wie immer an alle. */
function wishLawyer(teamMemberId) {
  if (!teamMemberId) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.display_name, u.discord_id FROM team_members t JOIN users u ON u.id = t.user_id
          WHERE t.id = ? AND t.visible = 1 AND u.active = 1 AND u.role IN ('anwalt','admin')`
      )
      .get(teamMemberId) || null
  );
}


router.post(
  '/cases',
  requestLimiter,
  wrap(async (req, res) => {
    const d = parseBody(requestSchema, req, res);
    if (!d) return;
    const account = req.user && req.user.role === 'mandant' ? req.user : null;
    // Kurzer Titel mit Namen; der Text des Mandanten steht im Sachverhalt
    const checked = areas.checkAnswers(d.area, d.answers);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const title = intakeTitle(d.area, account ? account.display_name : d.name);
    const pin = randomPin();
    const lawyer = wishLawyer(d.teamMemberId);

    const id = tx(() => {
      const info = db
        .prepare(
          `INSERT INTO cases (case_number, access_pin, title, area, urgency, priority, description, client_id, client_name, client_phone, lawyer_id, status, source, intake_answers)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?)`
        )
        // Start-Priorität aus der Dringlichkeit, die der Mandant angibt (die Kanzlei passt sie danach an)
        .run(nextCaseNumber(), pin, title, d.area, d.urgency, PRIORITY_FROM_URGENCY[d.urgency] || 2, d.description, account ? account.id : null, account ? '' : d.name, d.phone || '', lawyer ? lawyer.id : null, lawyer ? 'in_bearbeitung' : 'offen', Object.keys(checked.answers).length ? JSON.stringify(checked.answers) : null);
      const newId = Number(info.lastInsertRowid);
      addSystemNote(newId, null, `Mandatsanfrage über das Website-Formular eingegangen${lawyer ? ` – gewünscht: ${lawyer.display_name}` : ''}.`);
      if (lawyer) syncCaseWork(newId);
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
        { name: 'Rechtsgebiet', value: areas.name(d.area) },
        lawyer ? { name: 'Wunschanwalt', value: `${lawyer.display_name} (zugewiesen)` } : null,
        { name: 'Priorität', value: PRIORITY_DISCORD[c.priority] || PRIORITY_DISCORD[2] },
        d.urgency !== 'normal' ? { name: 'Dringlichkeit (Angabe Mandant)', value: URGENCY_LABEL[d.urgency] || d.urgency } : null,
        require('./clients').flagField(c), // bekannter Mandant mit Vermerk (Kanzlei-Kanal, nie ins Ticket)
      ],
      mentionIds: lawyer && lawyer.discord_id ? [lawyer.discord_id] : [], // Wunschanwalt wird gepingt
    });

    tickets.caseCreated(id);
    res.status(201).json({
      caseId: account ? id : undefined,
      caseNumber: c.case_number,
      pin,
      linkedToAccount: !!account,
      lawyerName: lawyer ? lawyer.display_name : null,
      // Discord-Ticket: ohne verknüpftes Konto kann der Mandant mit Aktenzeichen + Pin beitreten
      discordTicket: tickets.active() && discord.oauthConfigured(),
      // … oder gleich ein Konto mit Discord anlegen (die Akte hängt dann daran)
      discordSignup: !account && discord.oauthConfigured(),
    });
  })
);

module.exports = router;
