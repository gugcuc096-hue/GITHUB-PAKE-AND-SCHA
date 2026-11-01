'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { DB_PATH, PUBLIC_MEDIA_DIR } = require('./server/db/db');
const { loadUser, requireAuth } = require('./server/core/auth');
const { runBootstrap } = require('./server/core/bootstrap');
const calendarRoutes = require('./server/routes/calendar');
const dutyRoutes = require('./server/routes/duty');
const fees = require('./server/routes/fees');
const team = require('./server/routes/team');
const admin = require('./server/routes/admin');
const applications = require('./server/routes/applications');
const fivenetRoutes = require('./server/routes/fivenet');
const externalRoutes = require('./server/routes/external');
const contractRoutes = require('./server/routes/contracts');
const concernRoutes = require('./server/routes/concerns');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Render/Nginx/Cloudflare sitzen als Reverse Proxy davor (wichtig für "secure"-Cookies und Rate-Limits).
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(require('./server/db/health').timing); // misst jede API-Anfrage (Systemzustand im Dashboard)

app.use(
  helmet({
    // Content-Security-Policy: Skripte nur von der eigenen Domain (Tailwind ist fest eingebaut, kein CDN mehr),
    // keine Plugins, keine fremden Frames, Formulare nur an die eigene Seite bzw. die Discord-Anmeldung.
    // Alle Skripte liegen als Dateien unter /js (keine Inline-Skripte, keine onclick-Attribute) – eingeschleuster
    // Skriptcode würde nicht ausgeführt. Google Fonts und Bilder (z. B. Discord-Avatare, Embed-Vorschauen) kommen
    // weiterhin von außen.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Strenge Richtlinie: nur Skriptdateien der eigenen Domain – keine Inline-Skripte, keine onclick-Attribute
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'], // Schriften kommen vom eigenen Server (public/fonts)
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://discord.com'],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // „same-origin“ statt „no-referrer“: fremde Seiten erfahren weiterhin nichts, aber Formulare der
    // eigenen Seite (z. B. „Discord-Ticket beitreten“) senden ihre Herkunft mit (sonst „Origin: null“).
    referrerPolicy: { policy: 'same-origin' },
  })
);
// Übergabe aus FiveNet („→ An Pake & Scha senden“ bzw. Lesezeichen): Das Kanzlei-Fenster wird vom FiveNet-Tab geöffnet und
// muss dessen Nachrichten empfangen und bestätigen können. Helmets Standard „same-origin“ (Cross-Origin-Opener-Policy) trennt
// diese Verbindung – das Fenster blieb leer. Deshalb nur für diese Einstiegsadresse (und die Anmeldeseite davor) gelockert.
app.use((req, res, next) => {
  const fromFivenet = (req.path === '/dashboard' && req.query.import === 'fivenet') || (req.path === '/login' && /(^|[?&])import=fivenet\b/.test(String(req.query.next || '')));
  if (fromFivenet) res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  next();
});
// Discord-Button-Klicks (Ticket-Panel): brauchen den unveränderten Rohtext für die Signaturprüfung –
// deshalb vor express.json().
app.use('/api/discord/interactions', require('./server/routes/interactions'));
// Live-Aktualisierung (Server-Sent Events): vor der Komprimierung, die den Datenstrom sonst puffern würde
const live = require('./server/core/live');
app.get('/api/events', cookieParser(), loadUser, live.handler);
// Antworten komprimiert ausliefern (gzip) – das Dashboard-Skript wird so ca. fünfmal kleiner
app.use(compression());
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());
app.use(loadUser);
app.use((req, res, next) => require('./server/db/db').actor.run({ user: req.user }, next)); // Wer ändert? – fürs Änderungsprotokoll

// CSRF-Schutz zusätzlich zu SameSite-Cookies: schreibende Anfragen nur von der eigenen Domain.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  // Formular-Navigationen mit „Origin: null“ akzeptieren, wenn der Browser „same-origin“ bestätigt (nicht fälschbar).
  if (!origin || (origin === 'null' && req.get('sec-fetch-site') === 'same-origin')) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Ungültige Herkunft der Anfrage.' });
  }
  if (host !== req.get('host')) return res.status(403).json({ error: 'Anfrage von fremder Seite blockiert.' });
  next();
});

app.use(require('./server/web/seo').noindex);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', live.middleware); // meldet erfolgreiche Änderungen an offene Dashboards
app.post('/api/events/presence', requireAuth, live.presence); // wer hat die Akte gerade offen, wer tippt

/* ---------------------------------------------------------------- API */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/start', require('./server/routes/start').router); // Dashboard-Start: Konto + alle Zähler in einem Abruf
// Jede Änderung an einer Akte (Notizen, Anhänge, Status, Verträge …) schreibt das Google Doc ihres Aktenauszugs neu –
// ohne Knopf. Chat und „gelesen“ stehen nicht im Auszug.
app.use('/api/cases/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (req.method !== 'GET' && id > 0 && !/^\/(chat(\/|$)|star$)/.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400) require('./server/integrations/googleDocs').touchExtract(id);
    });
  }
  next();
});
app.use('/api/cases/:id/external', externalRoutes.caseRouter);
app.use('/api/cases/:id/contracts', contractRoutes.caseRouter);
app.use('/api/task-packages', require('./server/routes/taskPackages').router); // Aufgaben-Pakete je Anlass
app.use('/api/cases/:id/requests', require('./server/routes/docRequests').caseRouter); // fehlende Unterlagen der Akte
app.use('/api/requests', require('./server/routes/docRequests').mineRouter);
app.use('/api/cases/:id/parties', require('./server/routes/parties').router); // Beteiligte der Akte
app.use('/api/places', require('./server/routes/places').postalsRouter); // Postleitzahlen der Karte (nur Kanzlei)
app.use('/api/cases/:id/places', require('./server/routes/places').router); // Orte der Akte (Tatort-Karte)
app.use('/api/cases/:id/charges', require('./server/routes/penal').caseRouter); // Anklagepunkte & Strafmaß-Rechner
app.use('/api/cases/:id/fivenet', externalRoutes.caseRouter); // ältere Adresse, bleibt gültig
app.use('/api/cases', require('./server/routes/cases'));
app.use('/api/clients', require('./server/routes/clients').router);
app.use('/api/fivenet', fivenetRoutes.router);
app.use('/api/gdocs', externalRoutes.gdocsRouter);
app.use('/api/gsheets', externalRoutes.gsheetsRouter);
app.use('/api/tasks', require('./server/routes/tasks'));
app.use('/api/penal', require('./server/routes/penal').router); // Strafkatalog (StGB)
app.use('/api/wiki', require('./server/routes/wiki').router); // Kanzlei-Wiki
app.use('/api/discount-approvals', require('./server/routes/discountApprovals').router); // Rabatt-Freigabe durch das Board
app.use('/api/feedback', require('./server/routes/feedback').router); // 360°-Feedback
app.use('/api/retainers', require('./server/routes/retainers').router); // Dauermandate (Pauschalen mit automatischer Rechnung)
app.use('/api/precedents', require('./server/routes/precedents').router); // Präzedenzfälle (Wiki-Reiter) und „Ähnliche Fälle“
app.use('/api/snippets', require('./server/routes/snippets').router); // Textbausteine (Akten-Chat, Notizen)
app.use('/api/resolutions', require('./server/routes/resolutions').router); // Board-Beschlüsse
app.use('/api/search', require('./server/routes/search'));
app.use('/api/google', require('./server/routes/google'));
app.use('/api/reviews', require('./server/routes/reviews').router);
app.use('/api/contracts', contractRoutes.router);
app.use('/api/absences', require('./server/routes/absences').router);
app.use('/api/work', require('./server/routes/work').router);
app.use('/api/stats', require('./server/routes/stats'));
app.use('/api/storage', require('./server/routes/storage').router); // Kanzlei-Lager
app.use('/api/concerns', concernRoutes.router);
app.use('/api/personnel', require('./server/routes/personnel').router);
app.use('/api/cooperations', require('./server/routes/cooperations').router);
app.use('/api/memberships', require('./server/routes/memberships').router);
app.use('/api/name-requests', require('./server/routes/nameRequests').router);
app.use('/api/contract-templates', contractRoutes.templatesRouter);
app.use('/api/calendar', calendarRoutes);
app.use('/api/messages', require('./server/routes/messages'));
app.use('/api/site', require('./server/routes/site'));
app.use('/api/event-kinds', require('./server/routes/eventKinds').router); // Termin- und Fristenarten mit Fristenrechner
app.use('/api/billing', require('./server/routes/billing').router); // Gebührenkategorien und Rechnungsarten
app.use('/api/areas', require('./server/routes/areas').router); // Rechtsgebiete als Daten (Einstellungen → Listen)
app.use('/api/promotions', require('./server/routes/promotions').router); // Rabattaktionen für alle (Halloween, Weihnachten …)
app.use('/api/config', require('./server/routes/siteConfig').router); // Banner, Startseite, Beschriftungen, Mitteilungen, Export/Import
app.use('/api/access', require('./server/routes/access').router); // Inhaber, Web-Admins, Rechte-Tabelle, Protokoll, Schalter
app.use('/api/onboarding', require('./server/routes/onboarding'));
app.use('/api/board', require('./server/routes/board'));
app.use('/api/invoices', require('./server/routes/invoices'));
app.use('/api/fees', fees.publicRouter);
app.use('/api/team', team.publicRouter);
app.use('/api/directory', admin.directoryRouter);
app.use('/api/prefs', require('./server/routes/prefs').router); // persönliche Ansicht der Akte (Reihenfolge der Abschnitte)
app.use('/api/duty', dutyRoutes);
app.use('/api/admin/team', team.adminRouter);
app.use('/api/admin/fees', fees.adminRouter);
app.use('/api/admin/applications', applications.adminRouter);
app.use('/api/admin/positions', applications.positionsRouter);
app.use('/api/admin', admin.router);
app.use('/api/system', require('./server/routes/system'));
app.use('/api/discord', require('./server/routes/discord'));
app.use('/api/tickets', require('./server/routes/tickets'));
app.use('/api/bot', require('./server/routes/bot').router);
app.use('/api/public', require('./server/routes/access').publicRouter);
app.use('/api/public', require('./server/routes/siteConfig').publicRouter);
app.use('/api/public', require('./server/routes/areas').publicRouter);
app.use('/api/public', require('./server/routes/public'));
app.use('/api/public', applications.publicRouter);
app.use('/api/public', concernRoutes.publicRouter);
app.use('/api/public', require('./server/routes/reviews').publicRouter);
app.use('/api/public', require('./server/routes/memberships').publicRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Schnittstelle nicht gefunden.' }));

/* ---------------------------------------------------------------- Profilbilder & Team-Fotos */
// Dateinamen sind zufällig und ändern sich bei jedem Upload -> lange Cache-Zeit ist unbedenklich.
app.use(
  '/media',
  express.static(PUBLIC_MEDIA_DIR, { dotfiles: 'deny', index: false, maxAge: '30d', immutable: true }),
  (req, res) => res.status(404).end()
);

/* ---------------------------------------------------------------- Frontend */
// Schriften ändern sich praktisch nie – 30 Tage im Browser behalten
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: '30d' }));
// Startseite und Karriere: Rang-Karten, vom Board geänderte Texte und Vorschaubild werden beim Ausliefern eingesetzt
const sitePages = require('./server/web/sitePages');
// Saubere Adressen ohne „.html“ (/login, /dashboard, /rechnung …). Alte Links – Lesezeichen, ältere Discord-Nachrichten,
// die installierte App – leiten dauerhaft weiter; Suchparameter bleiben, den #Teil hängt der Browser selbst wieder an.
const CLEAN = { index: '/', dashboard: '/dashboard', login: '/login', register: '/registrieren', karriere: '/karriere', bewerbung: '/bewerbung', vertrag: '/vertrag', invoice: '/rechnung', aktenauszug: '/aktenauszug', offline: '/offline', aufwachen: '/aufwachen' };
const RENAMED = { index: '/', register: '/registrieren', invoice: '/rechnung' }; // auch ohne „.html“ nur noch unter dem neuen Namen
app.get(/^\/([a-z0-9-]+)(\.html)?$/i, (req, res, next) => {
  const [, name, ext] = req.path.match(/^\/([a-z0-9-]+)(\.html)?$/i);
  const to = ext ? CLEAN[name.toLowerCase()] : RENAMED[name.toLowerCase()];
  if (!to) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(301, to + (q >= 0 ? req.originalUrl.slice(q) : ''));
});
app.get('/fivenet-import.user.js', require('./server/routes/fivenet').userscript);
app.use(require('./server/web/seo').router); // robots.txt, sitemap.xml, „nicht indexieren“ für Internes
app.get('/', sitePages.handler('index'));
app.get('/karriere', sitePages.handler('karriere'));
for (const [route, file] of [['login', 'login.html'], ['registrieren', 'register.html'], ['bewerbung', 'bewerbung.html']]) app.get(`/${route}`, sitePages.previewHandler(file));
// Öffentliche Anwalts-Profile (/team/<name>) mit Link-Vorschau; /team allein führt zum Team auf der Startseite
app.get('/team', (req, res) => res.redirect(302, '/#team'));
app.get('/team/:slug', require('./server/web/profiles').handler);
// Übrige Seiten mit Versionsnummern für Skripte/CSS (dauerhaft im Browser), Dashboard-Teile als ein Bündel
const assets = require('./server/web/assets');
app.get('/js/dashboard.bundle.js', assets.bundle);
app.get('/js/dashboard.staff.js', assets.staffBundle);
// Logo in der Kanzleifarbe (Einstellungen → Stil & Saison; brand.js)
app.get('/img/logo.svg', require('./server/web/brand').logoHandler('svg'));
app.get('/img/logo.png', require('./server/web/brand').logoHandler('png'));
app.use(assets.staticAsset); // übrige Skripte und CSS: verkleinert, Brotli/gzip
app.use(assets.pages);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: assets.setHeaders }));
// Unbekannte Adresse: eigene Seite im Kanzlei-Design (nur für Seitenaufrufe, die ausdrücklich text/html wollen; Bilder, Skripte, API bekommen nur 404)
app.use((req, res) => {
  res.status(404);
  if (req.method === 'GET' && /text\/html/.test(req.get('accept') || '')) return res.set('Cache-Control', 'no-cache').type('html').send(require('./server/web/theme').inject(assets.page('404.html'), '404'));
  res.end();
});

/* ---------------------------------------------------------------- Fehler */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges Datenformat.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Die Anfrage ist zu groß.' });
  if (err.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler. Bitte später erneut versuchen.' });
});

/* ---------------------------------------------------------------- Start */
runBootstrap();
try {
  const made = require('./server/db/health').ensureIndexes(); // Indizes für alle Fremdschlüssel (schnelle Abfragen auch bei vielen Daten)
  if (made) console.log(`Datenbank: ${made} fehlende Indizes angelegt.`);
} catch (err) {
  console.warn('Indizes prüfen fehlgeschlagen:', err.message);
}
require('./server/core/permissions').ensureOwner();
require('./server/domain/ranks').init(); // Ränge aus der Datenbank (beim ersten Start: die bisherigen sechs)
require('./server/domain/penal').init(); // Strafgesetzbuch & Strafkatalog (beim ersten Start aus seeds/stgb.json)
require('./server/routes/wiki').seed(); // Kanzlei-Wiki: Grundlagen-Artikel beim ersten Start
require('./server/routes/snippets').seed(); // Textbausteine: Startbausteine beim ersten Start

// Discord-Erinnerungen an Fristen/Gerichtstermine (24 h vorher).
const reminderTimer = setInterval(() => {
  try {
    calendarRoutes.sendDueReminders();
    dutyRoutes.closeStaleSessions();
    // VIP: abgelaufene Mitgliedschaften beenden, Erinnerung vor Ablauf
    require('./server/domain/memberships').sweep().catch((err) => console.warn('VIP-Ablauf fehlgeschlagen:', err.message));
    // Zahlungserinnerung für überfällige Rechnungen (einmal je Rechnung)
    require('./server/domain/paymentReminders').sweep().catch((err) => console.warn('Zahlungserinnerungen fehlgeschlagen:', err.message));
    // Dauermandate: fällige Zeiträume abrechnen
    try {
      require('./server/domain/retainers').sweep();
    } catch (err) {
      console.warn('Dauermandate fehlgeschlagen:', err.message);
    }
    // Fehlende Unterlagen: Mandant nach 3 Tagen einmal erinnern
    require('./server/domain/docRequests').sweep().catch((err) => console.warn('Erinnerung an fehlende Unterlagen fehlgeschlagen:', err.message));
    // Liegengebliebene Akten: zuständigen Anwalt einmal je Ruhephase erinnern
    require('./server/domain/idleCases').sweep().catch((err) => console.warn('Hinweis auf liegengebliebene Akten fehlgeschlagen:', err.message));
    // Abgelehnte Bewerbungen und erledigte Anliegen nach X Tagen löschen (Einstellung, 0 = aus)
    require('./server/db/cleanup').sweep();
    // Wochenbericht fürs Board: montags ab 10 Uhr einmal per Discord-DM
    require('./server/domain/weeklyReport').sweep().catch((err) => console.warn('Wochenbericht fehlgeschlagen:', err.message));
    // Board-Beschlüsse: abgelaufene Abstimmungen entscheiden
    require('./server/routes/resolutions').sweep();
    // Anwalt des Monats: zum Monatswechsel in Discord verkünden
    require('./server/domain/lawyerOfMonth').sweep();
    // Live-Anzeige „Im Dienst: N“ im Discord-Kanalnamen (z. B. nach automatisch beendeten Schichten)
    require('./server/integrations/dutyChannel').update();
    // Ungelesene Nachricht der Kanzlei seit zwei Tagen: einmal per Discord-DM erinnern
    require('./server/domain/caseChat').nudgeSweep().catch((err) => console.warn('Erinnerung an ungelesene Nachrichten fehlgeschlagen:', err.message));
  } catch (err) {
    console.warn('Hintergrundaufgabe fehlgeschlagen:', err.message);
  }
}, 5 * 60 * 1000);
reminderTimer.unref();

app.listen(PORT, () => {
  // Tailwind-CSS auffrischen, falls die Build-Werkzeuge installiert sind (sonst gilt die fertige Datei)
  require('./scripts/build-css').refreshOnStart();
  // Skripte und CSS einmal verkleinern und komprimieren, damit schon der erste Besucher nicht wartet
  if (process.env.NODE_ENV === 'production') require('./server/web/assets').warm();
  // Tägliche Datensicherung (backups/ neben der Datenbank)
  require('./server/db/backup').start();
  // Papierkorb: Akten nach 30 Tagen endgültig löschen
  require('./server/db/trash').start();
  // Aufräumen: abgelaufene Sitzungen/Codes, Datenbank optimieren und monatlich verdichten
  require('./server/db/maintenance').start();
  require('./server/integrations/googleDocs').start();
  // Systemwarnungen ans Board (Bot offline, Sicherung fehlgeschlagen, Speicher, Absturz)
  require('./server/integrations/systemAlerts').start();
  // Discord-Befehle (/add, /remove, /delete, /passwort, /akte …) anmelden (nur wenn Bot-Token, Server und Public Key eingerichtet sind)
  setTimeout(() => require('./server/integrations/tickets').registerCommands().catch((err) => console.warn('Discord-Befehle nicht angemeldet:', err.message)), 3000).unref();
  // Kanzlei-Bot: dauerhafte Verbindung für Rang-Sync, Role Connections und Willkommensnachrichten (nur wenn eingeschaltet)
  setTimeout(() => require('./server/integrations/discordBot').start(), 4000).unref();
  require('./server/db/health').markReady();
  // Kurzer Selbsttest kurz nach dem Start (Ergebnis im Dashboard unter „Systemzustand“, bei Problemen Warnung ans Board)
  setTimeout(() => {
    try {
      require('./server/db/health').runSelfTest();
    } catch (err) {
      console.warn('Selbsttest fehlgeschlagen:', err.message);
    }
  }, 8000).unref();
  console.log(`Pake & Scha Server läuft unter http://localhost:${PORT}`);
  console.log(`Datenbank: ${DB_PATH}`);
  if (process.env.RENDER && !process.env.DB_PATH) {
    console.warn('WARNUNG: DB_PATH ist nicht gesetzt. Ohne Render "Persistent Disk" gehen alle Daten bei jedem Deploy/Neustart verloren!');
  }
});
