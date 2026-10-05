'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { DB_PATH, PUBLIC_MEDIA_DIR } = require('./db');
const { loadUser } = require('./auth');
const { runBootstrap } = require('./bootstrap');
const calendarRoutes = require('./routes/calendar');
const dutyRoutes = require('./routes/duty');
const fees = require('./routes/fees');
const team = require('./routes/team');
const admin = require('./routes/admin');
const applications = require('./routes/applications');
const fivenetRoutes = require('./routes/fivenet');
const externalRoutes = require('./routes/external');
const contractRoutes = require('./routes/contracts');
const concernRoutes = require('./routes/concerns');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Render/Nginx/Cloudflare sitzen als Reverse Proxy davor (wichtig für "secure"-Cookies und Rate-Limits).
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // Content-Security-Policy: Skripte nur von der eigenen Domain (Tailwind ist fest eingebaut, kein CDN mehr),
    // keine Plugins, keine fremden Frames, Formulare nur an die eigene Seite bzw. die Discord-Anmeldung.
    // Inline-Skripte und onclick-Handler der Seiten bleiben erlaubt; Google Fonts und Bilder (z. B. Discord-Avatare,
    // Embed-Vorschauen) kommen weiterhin von außen.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
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
// Discord-Button-Klicks (Ticket-Panel): brauchen den unveränderten Rohtext für die Signaturprüfung –
// deshalb vor express.json().
app.use('/api/discord/interactions', require('./routes/interactions'));
// Antworten komprimiert ausliefern (gzip) – das Dashboard-Skript wird so ca. fünfmal kleiner
app.use(compression());
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());
app.use(loadUser);

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

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------------------------------------------------------------- API */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/cases/:id/external', externalRoutes.caseRouter);
app.use('/api/cases/:id/contracts', contractRoutes.caseRouter);
app.use('/api/cases/:id/fivenet', externalRoutes.caseRouter); // ältere Adresse, bleibt gültig
app.use('/api/cases', require('./routes/cases'));
app.use('/api/fivenet', fivenetRoutes.router);
app.use('/api/gdocs', externalRoutes.gdocsRouter);
app.use('/api/gsheets', externalRoutes.gsheetsRouter);
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reviews', require('./routes/reviews').router);
app.use('/api/contracts', contractRoutes.router);
app.use('/api/absences', require('./routes/absences').router);
app.use('/api/work', require('./routes/work').router);
app.use('/api/concerns', concernRoutes.router);
app.use('/api/personnel', require('./routes/personnel').router);
app.use('/api/cooperations', require('./routes/cooperations').router);
app.use('/api/memberships', require('./routes/memberships').router);
app.use('/api/name-requests', require('./routes/nameRequests').router);
app.use('/api/contract-templates', contractRoutes.templatesRouter);
app.use('/api/calendar', calendarRoutes);
app.use('/api/messages', require('./routes/messages'));
app.use('/api/board', require('./routes/board'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/fees', fees.publicRouter);
app.use('/api/team', team.publicRouter);
app.use('/api/directory', admin.directoryRouter);
app.use('/api/duty', dutyRoutes);
app.use('/api/admin/team', team.adminRouter);
app.use('/api/admin/fees', fees.adminRouter);
app.use('/api/admin/applications', applications.adminRouter);
app.use('/api/admin/positions', applications.positionsRouter);
app.use('/api/admin', admin.router);
app.use('/api/discord', require('./routes/discord'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/bot', require('./routes/bot').router);
app.use('/api/public', require('./routes/public'));
app.use('/api/public', applications.publicRouter);
app.use('/api/public', concernRoutes.publicRouter);
app.use('/api/public', require('./routes/reviews').publicRouter);
app.use('/api/public', require('./routes/memberships').publicRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Schnittstelle nicht gefunden.' }));

/* ---------------------------------------------------------------- Profilbilder & Team-Fotos */
// Dateinamen sind zufällig und ändern sich bei jedem Upload -> lange Cache-Zeit ist unbedenklich.
app.use(
  '/media',
  express.static(PUBLIC_MEDIA_DIR, { dotfiles: 'deny', index: false, maxAge: '30d', immutable: true }),
  (req, res) => res.status(404).end()
);

/* ---------------------------------------------------------------- Frontend */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

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

// Discord-Erinnerungen an Fristen/Gerichtstermine (24 h vorher).
const reminderTimer = setInterval(() => {
  try {
    calendarRoutes.sendDueReminders();
    dutyRoutes.closeStaleSessions();
    // VIP: abgelaufene Mitgliedschaften beenden, Erinnerung vor Ablauf
    require('./memberships').sweep().catch((err) => console.warn('VIP-Ablauf fehlgeschlagen:', err.message));
    // Zahlungserinnerung für überfällige Rechnungen (einmal je Rechnung)
    require('./paymentReminders').sweep().catch((err) => console.warn('Zahlungserinnerungen fehlgeschlagen:', err.message));
  } catch (err) {
    console.warn('Hintergrundaufgabe fehlgeschlagen:', err.message);
  }
}, 5 * 60 * 1000);
reminderTimer.unref();

app.listen(PORT, () => {
  // Tailwind-CSS auffrischen, falls die Build-Werkzeuge installiert sind (sonst gilt die fertige Datei)
  require('./scripts/build-css').refreshOnStart();
  // Tägliche Datensicherung (backups/ neben der Datenbank)
  require('./backup').start();
  // Papierkorb: Akten nach 30 Tagen endgültig löschen
  require('./trash').start();
  // Systemwarnungen ans Board (Bot offline, Sicherung fehlgeschlagen, Speicher, Absturz)
  require('./systemAlerts').start();
  // Discord-Befehle (/add, /remove, /delete, /passwort, /akte …) anmelden (nur wenn Bot-Token, Server und Public Key eingerichtet sind)
  setTimeout(() => require('./tickets').registerCommands().catch((err) => console.warn('Discord-Befehle nicht angemeldet:', err.message)), 3000).unref();
  // Kanzlei-Bot: dauerhafte Verbindung für Rang-Sync, Role Connections und Willkommensnachrichten (nur wenn eingeschaltet)
  setTimeout(() => require('./discordBot').start(), 4000).unref();
  console.log(`Pake & Scha Server läuft unter http://localhost:${PORT}`);
  console.log(`Datenbank: ${DB_PATH}`);
  if (process.env.RENDER && !process.env.DB_PATH) {
    console.warn('WARNUNG: DB_PATH ist nicht gesetzt. Ohne Render "Persistent Disk" gehen alle Daten bei jedem Deploy/Neustart verloren!');
  }
});
