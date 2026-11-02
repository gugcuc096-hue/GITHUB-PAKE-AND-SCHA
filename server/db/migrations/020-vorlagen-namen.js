'use strict';
/* Eigene Bezeichnungen der Akten-Vorlage je Rechtsgebiet (Reiter, Abschnitte, Einträge, Felder) – siehe domain/fall.js */

module.exports = function up({ addColumn }) {
  addColumn('areas', 'labels', "TEXT NOT NULL DEFAULT '{}'");
};
