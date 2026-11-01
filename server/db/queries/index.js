'use strict';
/*
 * Gemeinsame Datenbankabfragen, je Bereich eine Datei. Jede Abfrage ist ein vorbereiteter SQL-Befehl mit Namen:
 *   const Q = require('../db/queries');
 *   const u = Q.users.getById.get(id);
 *   Q.cases.touchById.run(caseId);
 * Neue Abfragen, die an mehr als einer Stelle gebraucht werden, kommen hierher statt als SQL-Text in die Route.
 */
module.exports = Object.assign({}, require('./users'), require('./cases'), require('./office'), require('./money'));
