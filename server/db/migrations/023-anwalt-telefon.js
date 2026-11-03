'use strict';
/*
 * Telefonnummer eines Anwalts (im Spiel) für seine Profilseite auf der Website – gepflegt in der Team-Verwaltung.
 * Bewusst eine eigene Angabe und nicht die Telefonnummer seines Kontos: die bleibt privat.
 */
module.exports = function up({ addColumn }) {
  addColumn('team_members', 'phone', "TEXT NOT NULL DEFAULT ''");
};
