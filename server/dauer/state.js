'use strict';
/* Laufzeit-Zustand des Dauerbetriebs (ohne Datenbank) – geteilt zwischen Start, Live-Sicherung, Wecker und Routen. */
const crypto = require('crypto');

module.exports = {
  instance: crypto.randomBytes(6).toString('hex'), // diese Instanz (bei Render: dieser Container)
  startedAt: new Date().toISOString(),
  phase: 'start', // start → wiederherstellen → bereit
  phaseText: 'Der Server startet …',
  bootError: null,
  creds: null, // { rt, k } aus dem Wiederherstellungs-Schlüssel
  restore: null, // Ergebnis der Wiederherstellung beim Start
  predecessor: null, // { instance, lease } – wer vorher lief
  frozen: false, // nach der Übergabe: keine Änderungen mehr annehmen
  frozenAt: null,
  pings: { self: null, external: null, sources: {}, count: 0 },
};
