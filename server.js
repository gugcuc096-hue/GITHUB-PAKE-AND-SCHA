'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
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

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Render/Nginx/Cloudflare sitzen als Reverse Proxy davor (wichtig für "secure"-Cookies und Rate-Limits).
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // Die Seiten laden Tailwind (CDN), Google Fonts und Discord-Avatare extern
    // und nutzen Inline-Skripte; eine strenge Standard-CSP würde das blockieren.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());
app.use(loadUser);

// CSRF-Schutz zusätzlich zu SameSite-Cookies: schreibende Anfragen nur von der eigenen Domain.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
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
app.use('/api/cases/:id/fivenet', externalRoutes.caseRouter); // ältere Adresse, bleibt gültig
app.use('/api/cases', require('./routes/cases'));
app.use('/api/fivenet', fivenetRoutes.router);
app.use('/api/gdocs', externalRoutes.gdocsRouter);
app.use('/api/tasks', require('./routes/tasks'));
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
app.use('/api/public', require('./routes/public'));
app.use('/api/public', applications.publicRouter);

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
  } catch (err) {
    console.warn('Hintergrundaufgabe fehlgeschlagen:', err.message);
  }
}, 5 * 60 * 1000);
reminderTimer.unref();

app.listen(PORT, () => {
  console.log(`Pake & Scha Server läuft unter http://localhost:${PORT}`);
  console.log(`Datenbank: ${DB_PATH}`);
  if (process.env.RENDER && !process.env.DB_PATH) {
    console.warn('WARNUNG: DB_PATH ist nicht gesetzt. Ohne Render "Persistent Disk" gehen alle Daten bei jedem Deploy/Neustart verloren!');
  }
});
