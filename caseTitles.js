'use strict';
/*
 * Titel für Akten, die über die Startseite eingehen: „Strafrecht / Festnahme – Mandantenname“. Der Text des Mandanten
 * steht ohnehin im Sachverhalt; früher stand er zusätzlich (abgeschnitten) im Titel, was Listen unleserlich machte.
 */
const AREA_TITLES = {
  strafrecht: 'Strafrecht / Festnahme',
  zivilrecht: 'Zivilrecht / Schadensersatz',
  verfassungsrecht: 'Verfassungsbeschwerde',
  vertragsrecht: 'Vertragsrecht / Ausarbeitung',
  sonstiges: 'Sonstiges Anliegen',
};

/** „Strafrecht / Festnahme – Esad De La Cruz“ (höchstens 110 Zeichen). */
function intakeTitle(area, name) {
  const base = AREA_TITLES[area] || AREA_TITLES.sonstiges;
  const who = String(name || '').replace(/\s+/g, ' ').trim();
  const title = who ? `${base} – ${who}` : base;
  return title.length > 110 ? `${title.slice(0, 109)}…` : title;
}

module.exports = { AREA_TITLES, intakeTitle };
