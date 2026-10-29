'use strict';
/*
 * Beweismittel einer Akte (die Bildanhänge, Tabelle case_attachments): feste B-Nummer je Akte (B1, B2 … – wird auch nach dem
 * Löschen nie neu vergeben, damit „B7“ in Schriftsätzen und Notizen immer dasselbe meint), Art, Herkunft, Zeitpunkt der
 * Erhebung, Lager (belastend/entlastend/neutral), Stand und Beschreibung. Die Einschätzung (Lager, Stand, Herkunft,
 * Beschreibung) sieht nur die Kanzlei.
 */
const KINDS = { foto: 'Foto', screenshot: 'Screenshot', dokument: 'Dokument', bodycam: 'Bodycam / Video', sonstiges: 'Sonstiges' };
const SIDES = { belastend: 'belastend', entlastend: 'entlastend', neutral: 'neutral' };
const STATUS = { gesichert: 'Gesichert', eingereicht: 'Eingereicht', bestritten: 'Bestritten', ausgeschlossen: 'Ausgeschlossen' };

module.exports = { KINDS, SIDES, STATUS };
