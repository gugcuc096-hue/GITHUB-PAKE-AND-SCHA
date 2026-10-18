'use strict';
/*
 * Kanzlei-Wiki: internes Nachschlagewerk für das Team (Abläufe, Vorlagen, Gerichtspraxis …).
 *  GET    /api/wiki            alle Artikel (ohne Text, mit Auszug) + Kategorien (Kanzlei)
 *  GET    /api/wiki/:id        ein Artikel mit Text (Kanzlei)
 *  POST/PATCH/DELETE /api/wiki[/:id]   schreiben (Board of Partners)
 *
 * Text in einfacher Schreibweise: „## Überschrift“, „- Aufzählung“, „1. Schritt“, **fett**, „> Hinweis“.
 * Beim ersten Start kommen ein paar Grundlagen-Artikel hinein (keine Server-Regeln – nur Kanzlei-Abläufe).
 */
const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting, tx } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard } = require('../helpers');
const { logActivity } = require('../models');

const router = express.Router();
router.use(requireAuth, requireStaff);

const requireBoard = (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Das Wiki pflegt das Board of Partners.' }));

/** Text ohne Formatzeichen – für Auszug und Suche. */
const plain = (s) =>
  String(s || '')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.|>)\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Auszug für die Karte: ohne Überschriften, Zeilen mit „ · “ getrennt. */
const excerptOf = (s) =>
  String(s || '')
    .split('\n')
    .filter((l) => l.trim() && !/^#{1,3}\s/.test(l))
    .map((l) => plain(l).replace(/[.:]$/, ''))
    .join(' · ');

function articleRow(a, withBody = false) {
  const text = plain(a.body);
  const excerpt = excerptOf(a.body);
  return {
    id: a.id,
    title: a.title,
    category: a.category,
    pinned: !!a.pinned,
    excerpt: excerpt.length > 180 ? `${excerpt.slice(0, 177)}…` : excerpt,
    updatedAt: a.updated_at,
    updatedByName: a.updated_by_name,
    ...(withBody ? { body: a.body } : { text }), // Liste: reiner Text für die Suche im Dashboard
  };
}

const load = (id) => db.prepare('SELECT * FROM wiki_articles WHERE id = ?').get(id) || null;

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM wiki_articles ORDER BY pinned DESC, category COLLATE NOCASE, title COLLATE NOCASE').all();
  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b, 'de'));
  res.json({ articles: rows.map((r) => articleRow(r)), categories, canEdit: isBoard(req.user) });
});

router.get('/:id', (req, res) => {
  const id = idParam(req);
  const a = id && load(id);
  if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
  res.json({ article: articleRow(a, true), canEdit: isBoard(req.user) });
});

const schema = z.object({
  title: z.string().trim().min(2, 'Bitte einen Titel angeben.').max(120),
  category: z.string().trim().min(2).max(40).default('Allgemein'),
  body: z.string().trim().min(1, 'Bitte einen Text eingeben.').max(20000),
  pinned: z.boolean().default(false),
});

router.post(
  '/',
  requireBoard,
  wrap(async (req, res) => {
    const d = parseBody(schema, req, res);
    if (!d) return;
    const id = Number(
      db
        .prepare('INSERT INTO wiki_articles (title, category, body, pinned, created_by, updated_by, updated_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(d.title, d.category, d.body, d.pinned ? 1 : 0, req.user.id, req.user.id, req.user.display_name).lastInsertRowid
    );
    logActivity(req.user, 'Wiki-Artikel angelegt', 'wiki', id, d.title);
    res.status(201).json({ article: articleRow(load(id), true) });
  })
);

router.patch(
  '/:id',
  requireBoard,
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
    const d = parseBody(schema.partial(), req, res);
    if (!d) return;
    db.prepare(
      `UPDATE wiki_articles SET title = ?, category = ?, body = ?, pinned = ?, updated_by = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(d.title ?? a.title, d.category ?? a.category, d.body ?? a.body, d.pinned === undefined ? a.pinned : d.pinned ? 1 : 0, req.user.id, req.user.display_name, id);
    logActivity(req.user, 'Wiki-Artikel geändert', 'wiki', id, d.title ?? a.title);
    res.json({ article: articleRow(load(id), true) });
  })
);

router.delete(
  '/:id',
  requireBoard,
  wrap(async (req, res) => {
    const id = idParam(req);
    const a = id && load(id);
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
    db.prepare('DELETE FROM wiki_articles WHERE id = ?').run(id);
    logActivity(req.user, 'Wiki-Artikel gelöscht', 'wiki', id, a.title);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Grundlagen-Artikel beim ersten Start */
const STARTER = [
  {
    title: 'Willkommen im Kanzlei-Wiki',
    category: 'Allgemein',
    pinned: true,
    body: `Hier steht alles, was man im Kanzleialltag schnell nachschlagen will – Abläufe, Vorlagen und Tipps fürs Gericht.

## So ist das Wiki aufgebaut
- **Artikel** nach Kategorien – oben links durchsuchen oder filtern
- **Strafgesetzbuch** – der komplette Gesetzestext mit Strafrahmen, direkt aus dem Strafkatalog
- Neue Artikel und Änderungen trägt das Board of Partners ein

> Fehlt etwas oder ist etwas veraltet? Kurz über „Anliegen ans Board“ melden.`,
  },
  {
    title: 'Ablauf eines Mandats',
    category: 'Abläufe',
    body: `## 1. Anfrage annehmen
- Neue Anfrage im Dashboard öffnen, Sachverhalt lesen, Priorität setzen
- Zuständigen Anwalt eintragen – bei Bedarf weitere Anwälte hinzunehmen

## 2. Mandatsvertrag
- In der Akte unter „Verträge“ den Mandatsvertrag erstellen
- Der Mandant unterschreibt im Portal oder direkt im Discord-Ticket

## 3. Bearbeitung
- Beweise, Notizen und Termine in der Akte festhalten
- Strafsachen: Anklagepunkte aus dem Strafkatalog eintragen – der Strafmaß-Rechner zeigt den Rahmen
- Interne Notizen sieht der Mandant nie

## 4. Verhandlung
- Mit „Verhandlungsmodus“ öffnet sich die Akte im Vollbild: Uhr, Redezeit, Beweise und Mitschrift
- Beim Beenden landet das Protokoll als interne Notiz in der Akte

## 5. Abschluss
- Rechnung erstellen, Akte mit Ergebnis schließen
- Der Mandant wird automatisch um eine Bewertung gebeten`,
  },
  {
    title: 'Rechnungen & Honorare',
    category: 'Abläufe',
    body: `## Rechnung erstellen
1. In der Akte oder unter „Rechnungen“ auf „Neues Dokument“
2. Leistungen aus der Honorarordnung wählen – VIP- und Lifetime-Rabatte werden automatisch abgezogen
3. Speichern – das Google Doc entsteht von selbst

## Zahlung
- Meldet der Mandant „bezahlt“, erscheint die Rechnung mit Hinweis in der Liste: Eingang bestätigen oder zurückweisen
- Offene Rechnungen erinnern nach der eingestellten Frist automatisch – von Hand mit „Erinnern“
- Stornieren geht in der Rechnung selbst (Leiste oben)`,
  },
  {
    title: 'Auftreten vor Gericht',
    category: 'Gerichtspraxis',
    body: `## Vor der Verhandlung
- Akte und Anklagepunkte durchgehen, Strafrahmen im Strafmaß-Rechner prüfen
- Beweise sortieren – im Verhandlungsmodus lassen sie sich mit den Pfeiltasten durchblättern
- Kurz mit dem Mandanten abstimmen: Einlassung, Geständnis, Schweigen

## In der Verhandlung
- Ruhig und sachlich bleiben, den Richter mit „Euer Ehren“ ansprechen
- Einsprüche kurz begründen („Einspruch – Suggestivfrage“)
- Wichtige Momente mit den Schnell-Schlagworten mitschreiben (Zeuge, Einspruch, Urteil …)

## Strafmaß
- Mildernde Umstände ansprechen: Versuch (§ 9 Abs. 2), Beihilfe (§ 10 Abs. 4), verminderte Schuldfähigkeit (§ 8)
- Die Gesamtstrafe ist nach § 3 Abs. 2 gedeckelt – 120 HE, in besonders schweren Fällen 180 HE`,
  },
  {
    title: 'Schriftsätze aufsetzen',
    category: 'Vorlagen',
    body: `## Schritt für Schritt
1. In der Akte „Schriftsatz“ wählen und die passende Vorlage nehmen
2. Felder ausfüllen – Aktenzeichen, Gericht und Mandant sind schon vorbelegt
3. Bei Strafsachen fügt {{anklagepunkte}} die Anklagepunkte der Akte automatisch ein
4. Speichern – das Dokument liegt als Google Doc bereit und kann unterschrieben werden

> Tipp: Vorlagen pflegt das Board unter Einstellungen → Vertragsvorlagen.`,
  },
];

function seed() {
  if (getSetting('wiki_seeded')) return;
  tx(() => {
    if (!db.prepare('SELECT 1 FROM wiki_articles LIMIT 1').get()) {
      const ins = db.prepare("INSERT INTO wiki_articles (title, category, body, pinned, updated_by_name) VALUES (?, ?, ?, ?, 'Kanzlei')");
      for (const a of STARTER) ins.run(a.title, a.category, a.body, a.pinned ? 1 : 0);
    }
    setSetting('wiki_seeded', '1');
  });
}

module.exports = { router, seed, plain };
