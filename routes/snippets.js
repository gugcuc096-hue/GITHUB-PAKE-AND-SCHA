'use strict';
/*
 * Textbausteine für den Akten-Chat und interne Notizen (nur Kanzlei).
 * Im Eingabefeld „/“ tippen → Auswahl der Bausteine; „/mandatsübernahme“ + Enter fügt den Text ein. Platzhalter wie in den
 * Schriftsätzen ({{mandant}}, {{anwalt}}, {{anwalt_rang}}, {{aktenzeichen}} …) füllt das Dashboard aus der offenen Akte.
 *  GET    /api/snippets          alle Bausteine + Platzhalter
 *  POST   /api/snippets          neuer Baustein (jede Person der Kanzlei)
 *  PATCH/DELETE /api/snippets/:id  ändern/löschen (wer ihn angelegt hat oder das Board of Partners)
 */
const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting, tx } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard } = require('../helpers');
const { logActivity } = require('../models');

const router = express.Router();
router.use(requireAuth, requireStaff);

/** Platzhalter – dieselben Namen wie in den Schriftsätzen, dazu ein paar für den Chat. */
const PLACEHOLDERS = {
  mandant: 'Name des Mandanten',
  anwalt: 'Ihr Name (wer den Baustein einfügt)',
  anwalt_rang: 'Ihr Rang',
  anwalt_telefon: 'Ihre Telefonnummer (aus dem Profil)',
  zustaendig: 'Federführender Anwalt der Akte',
  aktenzeichen: 'Aktenzeichen der Akte',
  akte: 'Titel der Akte',
  rechtsgebiet: 'Rechtsgebiet der Akte',
  gerichtsaktenzeichen: 'Gerichtsaktenzeichen der Akte',
  gegenpartei: 'Gegenpartei der Akte',
  anklagepunkte: 'Anklagepunkte aus dem Strafmaß-Rechner (je Zeile einer)',
  kanzlei: 'Pake & Scha Legal Consulting',
  datum: 'Heutiges Datum',
  uhrzeit: 'Aktuelle Uhrzeit',
  ort: 'Los Santos, San Andreas',
};

/** Befehl vergleichen: klein, Umlaute ausgeschrieben („mandatsübernahme“ = „mandatsuebernahme“). */
const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

const unknownPlaceholders = (body) => [
  ...new Set([...String(body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()).filter((p) => !PLACEHOLDERS[p])),
];

function row(s, user) {
  return {
    id: s.id,
    command: s.command,
    title: s.title,
    body: s.body,
    createdByName: s.created_by_name,
    updatedAt: s.updated_at,
    canEdit: s.created_by === user.id || isBoard(user),
  };
}
const load = (id) => db.prepare('SELECT * FROM text_snippets WHERE id = ?').get(id) || null;
const all = () => db.prepare('SELECT * FROM text_snippets ORDER BY command COLLATE NOCASE').all();

router.get('/', (req, res) => {
  res.json({ snippets: all().map((s) => row(s, req.user)), placeholders: PLACEHOLDERS });
});

const schema = z.object({
  command: z
    .string()
    .trim()
    .transform((v) => v.replace(/^\/+/, '').toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9äöüß-]{2,32}$/, 'Befehl: 2–32 Zeichen, nur Buchstaben, Ziffern und Bindestrich (z. B. mandatsübernahme).')),
  title: z.string().trim().min(2, 'Bitte einen kurzen Namen angeben.').max(80),
  body: z.string().trim().min(1, 'Bitte einen Text eingeben.').max(3000),
});

function check(d, res, exceptId = null) {
  const bad = unknownPlaceholders(d.body);
  if (bad.length) {
    res.status(400).json({ error: `Unbekannte Platzhalter: ${bad.map((p) => `{{${p}}}`).join(', ')}.`, field: 'body' });
    return false;
  }
  const clash = all().find((s) => s.id !== exceptId && fold(s.command) === fold(d.command));
  if (clash) {
    res.status(409).json({ error: `Den Befehl /${clash.command} gibt es schon („${clash.title}“).`, field: 'command' });
    return false;
  }
  return true;
}

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(schema, req, res);
    if (!d || !check(d, res)) return;
    const id = Number(
      db
        .prepare('INSERT INTO text_snippets (command, title, body, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)')
        .run(d.command, d.title, d.body, req.user.id, req.user.display_name).lastInsertRowid
    );
    logActivity(req.user, 'Textbaustein angelegt', 'snippet', id, `/${d.command}`);
    res.status(201).json({ snippet: row(load(id), req.user) });
  })
);

function editable(req, res) {
  const id = idParam(req);
  const s = id && load(id);
  if (!s) {
    res.status(404).json({ error: 'Textbaustein nicht gefunden.' });
    return null;
  }
  if (s.created_by !== req.user.id && !isBoard(req.user)) {
    res.status(403).json({ error: 'Ändern kann ihn nur, wer ihn angelegt hat, oder das Board of Partners.' });
    return null;
  }
  return s;
}

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const s = editable(req, res);
    if (!s) return;
    const d = parseBody(schema, req, res);
    if (!d || !check(d, res, s.id)) return;
    db.prepare("UPDATE text_snippets SET command = ?, title = ?, body = ?, updated_at = datetime('now') WHERE id = ?").run(d.command, d.title, d.body, s.id);
    logActivity(req.user, 'Textbaustein geändert', 'snippet', s.id, `/${d.command}`);
    res.json({ snippet: row(load(s.id), req.user) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const s = editable(req, res);
    if (!s) return;
    db.prepare('DELETE FROM text_snippets WHERE id = ?').run(s.id);
    logActivity(req.user, 'Textbaustein gelöscht', 'snippet', s.id, `/${s.command}`);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Startbausteine (einmalig beim ersten Start) */
const GRUSS = '\n\nMit freundlichen Grüßen\n{{anwalt}}\n{{anwalt_rang}} · {{kanzlei}}';
const STARTER = [
  [
    'mandatsübernahme',
    'Mandat übernommen',
    `Sehr geehrte/r {{mandant}},

vielen Dank für Ihr Vertrauen. Ich habe Ihr Mandat in der Sache „{{akte}}“ (Aktenzeichen {{aktenzeichen}}) übernommen und bin ab sofort Ihr Ansprechpartner.
Ich sehe mir die Unterlagen an und melde mich in Kürze mit den nächsten Schritten. Bei Fragen erreichen Sie mich jederzeit hier im Chat.${GRUSS}`,
  ],
  [
    'vollmacht',
    'Bitte um Unterschrift',
    `Sehr geehrte/r {{mandant}},

damit ich für Sie tätig werden kann, benötige ich Ihre Unterschrift unter dem Mandatsvertrag bzw. der Vollmacht. Sie finden das Dokument in Ihrem Portal unter der Akte {{aktenzeichen}} – „Lesen & unterschreiben“ genügt.${GRUSS}`,
  ],
  [
    'termin',
    'Termin bestätigt',
    `Sehr geehrte/r {{mandant}},

hiermit bestätige ich unseren Termin. Bitte bringen Sie alle Unterlagen zur Sache „{{akte}}“ mit (Strafbefehle, Schreiben, Fotos o. Ä.). Sollten Sie verhindert sein, sagen Sie bitte kurz hier im Chat ab.${GRUSS}`,
  ],
  [
    'akteneinsicht',
    'Akteneinsicht beantragt',
    `Sehr geehrte/r {{mandant}},

ich habe am {{datum}} Akteneinsicht beantragt (Gerichtsaktenzeichen {{gerichtsaktenzeichen}}). Sobald mir die Ermittlungsakte vorliegt, prüfe ich sie und bespreche das Ergebnis mit Ihnen.${GRUSS}`,
  ],
  [
    'anklage',
    'Anklagepunkte mitteilen',
    `Sehr geehrte/r {{mandant}},

nach aktuellem Stand werden Ihnen folgende Punkte vorgeworfen:
{{anklagepunkte}}

Bitte äußern Sie sich gegenüber den Behörden nicht ohne Rücksprache mit mir. Wir besprechen die Verteidigung vor der Verhandlung gemeinsam.${GRUSS}`,
  ],
  [
    'verhandlung',
    'Vorbereitung Verhandlung',
    `Sehr geehrte/r {{mandant}},

Ihre Verhandlung in der Sache „{{akte}}“ steht an. Bitte erscheinen Sie pünktlich und in angemessener Kleidung, beantworten Sie Fragen ruhig und sachlich und überlassen Sie rechtliche Ausführungen mir. Wenn Sie vorher noch etwas besprechen möchten, schreiben Sie mir gern.${GRUSS}`,
  ],
  [
    'rechnung',
    'Rechnung gestellt',
    `Sehr geehrte/r {{mandant}},

die Rechnung zu Ihrem Mandat ({{aktenzeichen}}) liegt in Ihrem Portal unter „Rechnungen“. Nach der Überweisung können Sie die Zahlung dort mit „Als bezahlt melden“ bestätigen.${GRUSS}`,
  ],
  [
    'rückruf',
    'Nicht erreicht',
    `Sehr geehrte/r {{mandant}},

ich habe heute ({{datum}}, {{uhrzeit}} Uhr) versucht, Sie zu erreichen. Bitte melden Sie sich kurz hier im Chat oder telefonisch unter {{anwalt_telefon}}.${GRUSS}`,
  ],
  [
    'abschluss',
    'Mandat abgeschlossen',
    `Sehr geehrte/r {{mandant}},

das Verfahren „{{akte}}“ ist abgeschlossen. Vielen Dank für Ihr Vertrauen in {{kanzlei}}. Über eine kurze Bewertung in Ihrem Portal würden wir uns sehr freuen – und wenn Sie wieder Hilfe brauchen, sind wir für Sie da.${GRUSS}`,
  ],
];

function seed() {
  if (getSetting('snippets_seeded')) return;
  tx(() => {
    if (!db.prepare('SELECT 1 FROM text_snippets LIMIT 1').get()) {
      const ins = db.prepare("INSERT INTO text_snippets (command, title, body, created_by_name) VALUES (?, ?, ?, 'Kanzlei')");
      for (const [c, t, b] of STARTER) ins.run(c, t, b);
    }
    setSetting('snippets_seeded', '1');
  });
}

module.exports = { router, seed, PLACEHOLDERS, fold };
