'use strict';
/*
 * Abschriften mit Zwischenüberschriften: Beim Einfügen aus FiveNet bzw. Google Docs erkennt die Kanzlei Überschriften und
 * markiert sie im gespeicherten Text mit „## “ (große Überschrift) bzw. „### “ (kleinere). Alles andere bleibt unverändert,
 * ältere Abschriften ohne Markierung sehen aus wie bisher. Dieses Modul zerlegt den Text für Textdatei und Word/Google Doc;
 * die Darstellung im Browser macht dieselbe Regel in public/js/api.js (PS.transcriptHtml).
 */

/** [{ level: 2|3, text }, { body: 'Absatztext' }, …] – Leerzeilen am Rand der Textteile fallen weg. */
function segments(text) {
  const out = [];
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').replace(/^\n+|\n+$/g, '');
    if (body) out.push({ body });
    buf = [];
  };
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(#{2,3}) (\S.*)$/);
    if (m) {
      flush();
      out.push({ level: m[1].length, text: m[2].trim() });
    } else buf.push(line);
  }
  flush();
  return out;
}

/** Klartext ohne Markierungen; Überschriften stehen zwischen Leerzeilen (Textdatei, Kopieren). */
function plain(text) {
  return segments(text)
    .map((s) => (s.body !== undefined ? s.body : s.text))
    .join('\n\n');
}

module.exports = { segments, plain };
