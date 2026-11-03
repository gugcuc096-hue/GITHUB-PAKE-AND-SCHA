'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx, randomPin, getSetting } = require('../db/db');
const { nextCaseNumber } = require('../domain/numbering');
const { wrap, parseBody, AREAS, URGENCIES, URGENCY_LABEL, PRIORITY_DISCORD, PRIORITY_FROM_URGENCY, OUTCOMES, truncate } = require('../core/helpers');
const { addSystemNote, getCase, onDutyMembers, syncCaseWork } = require('../db/models');
const discord = require('../integrations/discord');
const tickets = require('../integrations/tickets');
const { intakeTitle } = require('../domain/caseTitles');
const areas = require('../domain/areas');

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
  const { firmSeat, firmPlace } = require('../db/models');
  res.json({ seat: firmSeat(), place: firmPlace() });
});

router.get('/on-duty', (req, res) => {
  if (getSetting('show_duty_public', '1') !== '1') return res.json({ visible: false, count: null, members: [] });
  const members = onDutyMembers().map((m) => ({ name: m.name, rank: m.rank, status: m.status, statusLabel: m.statusLabel }));
  res.json({ visible: true, count: members.length, members });
});

/* Aktuelles: Meldungen des Boards und automatische Meldungen (neu im Team, Beförderung, offene Stelle) */
router.get('/news', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ news: require('../domain/news').feed(30) });
});

/*
 * Verfahrensstand ohne Konto: Aktenzeichen + Pin (steht in der Bestätigung der Mandatsanfrage). Gezeigt wird nur, was
 * der Mandant ohnehin sehen darf – Rechtsgebiet, Schritt, Status, zuständiger Anwalt, Hinweis der Kanzlei. Kein Inhalt
 * der Akte, keine Namen von Beteiligten. Fehlversuche zählen (Schutz gegen Durchprobieren der Pins).
 */
const statusLimiter = limit(15 * 60 * 1000, 10, 'Zu viele Versuche. Bitte warten Sie einige Minuten.');
const statusSchema = z.object({ number: z.string().trim().min(3).max(40), pin: z.string().trim().regex(/^\d{4,8}$/, 'Der Pin besteht aus Ziffern.') });
router.post(
  '/case-status',
  statusLimiter,
  wrap(async (req, res) => {
    const d = parseBody(statusSchema, req, res);
    if (!d) return;
    const c = db
      .prepare(
        `SELECT c.case_number, c.area, c.step, c.status, c.public_note, c.created_at, c.updated_at, c.closed_at, lu.display_name AS lawyer_name
           FROM cases c LEFT JOIN users lu ON lu.id = c.lawyer_id
          WHERE c.case_number = ? COLLATE NOCASE AND c.access_pin = ?`
      )
      .get(d.number, d.pin);
    if (!c) return res.status(404).json({ error: 'Kein Verfahren mit diesem Aktenzeichen und Pin gefunden.' });
    const { CASE_STATUS } = require('../core/helpers');
    const steps = areas.stepsOf(c.area);
    res.set('Cache-Control', 'no-store');
    res.json({
      caseNumber: c.case_number,
      area: areas.name(c.area),
      steps: [...steps, 'Abgeschlossen'],
      step: c.status === 'geschlossen' ? steps.length : Math.min(Math.max(c.step || 0, 0), steps.length - 1),
      status: c.status,
      statusLabel: CASE_STATUS[c.status] || c.status,
      lawyer: c.lawyer_name || null,
      note: c.public_note || '',
      openedAt: c.created_at,
      updatedAt: c.updated_at,
      closedAt: c.closed_at,
    });
  })
);

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
  offerCode: z.string().trim().max(20).optional(), // Angebot aus dem Honorarrechner (HON-4821) → Honorarvereinbarung in der Akte
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
    const checked = areas.checkAnswers(d.area, d.answers, { staff: false });
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
        .run(nextCaseNumber({ area: d.area, lawyerId: lawyer ? lawyer.id : null }), pin, title, d.area, d.urgency, PRIORITY_FROM_URGENCY[d.urgency] || 2, d.description, account ? account.id : null, account ? '' : d.name, d.phone || '', lawyer ? lawyer.id : null, lawyer ? 'in_bearbeitung' : 'offen', Object.keys(checked.answers).length ? JSON.stringify(checked.answers) : null);
      const newId = Number(info.lastInsertRowid);
      addSystemNote(newId, null, `Mandatsanfrage über das Website-Formular eingegangen${lawyer ? ` – gewünscht: ${lawyer.display_name}` : ''}.`);
      if (lawyer) syncCaseWork(newId);
      return newId;
    });

    const c = getCase(id);
    discord.notify('case.created', {
      caseId: c ? c.id : null,
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

    // Angebot aus dem Honorarrechner: wird zur Honorarvereinbarung der Akte (Rechnung übernimmt die Positionen)
    if (d.offerCode) {
      const honorar = require('../domain/honorar');
      const offer = honorar.offerByCode(d.offerCode);
      if (offer && !offer.caseId) {
        honorar.attachOffer(id, offer.code, null);
        addSystemNote(id, null, `Honorarangebot ${offer.code} aus dem Tarifrechner übernommen (${honorar.H.range(offer.totalLow, offer.totalHigh)}).`);
      }
    }
    tickets.caseCreated(id);
    require('../domain/automations').fire('case.created', { caseId: id }, 'created'); // Einstellungen → Automatik
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

/*
 * Honorarrechner: Angebot speichern (Code HON-4821 + Link) und wieder abrufen. Der Server rechnet selbst nach –
 * Beträge aus dem Browser zählen nicht. Kein Personenbezug im Angebot, deshalb ohne Anmeldung abrufbar.
 */
const offerLimiter = limit(60 * 60 * 1000, 30, 'Sie haben in kurzer Zeit sehr viele Angebote erstellt. Bitte später erneut versuchen.', true);
router.post(
  '/offers',
  offerLimiter,
  wrap(async (req, res) => {
    const honorar = require('../domain/honorar');
    const d = parseBody(honorar.pickSchemaShape(z), req, res);
    if (!d) return;
    const r = honorar.createOffer(d);
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json({ code: r.code, url: `/honorare?angebot=${r.code}`, quote: r.quote, lawyer: r.lawyer });
  })
);
router.get('/offers/:code', (req, res) => {
  const o = require('../domain/honorar').offerByCode(req.params.code);
  if (!o) return res.status(404).json({ error: 'Kein Angebot mit diesem Code gefunden.' });
  res.set('Cache-Control', 'no-store');
  res.json({ code: o.code, selection: o.selection, quote: o.quote, createdAt: o.createdAt });
});

module.exports = router;
