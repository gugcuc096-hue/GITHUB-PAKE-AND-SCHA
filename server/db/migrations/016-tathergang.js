'use strict';
/* Tathergang der Akte: was ist passiert, Schritt für Schritt (nur für die Kanzlei, Reiter „Fall“) */

module.exports = function up({ addColumn }) {
  addColumn('cases', 'incident', "TEXT NOT NULL DEFAULT ''");
};
