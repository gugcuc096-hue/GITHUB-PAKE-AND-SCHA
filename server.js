'use strict';
/*
 * Start des Servers. Im Dauerbetrieb (Render Free, siehe server/dauer/) wird zuerst der Stand aus dem Google Drive
 * geladen – solange zeigt der Server eine Warteseite und /api/ping antwortet schon (Wecker). Danach startet die
 * eigentliche Anwendung (app.js) mit der wiederhergestellten Datenbank. Ohne Dauerbetrieb startet sie sofort.
 */
require('dotenv').config();

require('./server/dauer/boot')
  .prepare()
  .then(() => require('./app'))
  .catch((err) => {
    console.error('Start fehlgeschlagen:', err);
    process.exit(1);
  });
