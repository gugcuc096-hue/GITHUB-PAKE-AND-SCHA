'use strict';
/*
 * Mandatsvertrag (bzw. Schriftsatz mit Unterschrift des Mandanten) in Discord lesen – als Text für Embeds.
 *
 * Die Vorlage ist dieselbe wie in der Druckansicht (contracts.js): Überschriften (#), zentrierte Zeilen (|),
 * Trenner (===), Anweisungen ([Unterschriften] …), **fett**, *kursiv* und {{platzhalter}}. Hier wird daraus
 * Discord-Markdown: Überschriften fett, Anweisungen entfallen (die Unterschriften stehen als Felder darunter),
 * Platzhalter werden mit den Vertragsdaten gefüllt – leere Felder als Linie wie auf Papier.
 */

const BLANK = '__________';
const DIRECTIVE = /^\[[^\]]+\]$/;
// Discord-Markdown in Werten entschärfen (Namen mit * oder _ sollen nicht formatieren)
const escapeMd = (s) => String(s).replace(/([\\*_~`|>])/g, '\\$1');

/** Platzhalterwerte wie in der Druckansicht: Vertragsdaten und Angaben aus der Akte. */
function values(data, c) {
  return {
    ...data,
    aktenzeichen: c.case_number,
    akte: c.title,
    rechtsgebiet: c.area,
    gerichtsaktenzeichen: c.court_ref || '',
    gegenpartei: c.opponent || '',
    kanzlei: 'Pake & Scha Legal Consulting',
  };
}

/** Vorlage → Discord-Markdown (eine Zeichenkette). */
function toMarkdown(body, data, c) {
  const v = values(data, c);
  const fill = (line) =>
    line.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
      const val = String(v[key] ?? '').trim();
      return val ? escapeMd(val) : BLANK;
    });
  const out = [];
  for (const raw of String(body || '').split('\n')) {
    let line = raw.trimEnd();
    const t = line.trim();
    if (DIRECTIVE.test(t)) continue;
    if (/^={3,}$/.test(t)) {
      out.push('');
      continue;
    }
    const heading = t.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      out.push('', `**${fill(heading[2]).replace(/\*\*/g, '')}**`);
      continue;
    }
    if (t.startsWith('|')) line = t.replace(/^\|\s?/, '');
    out.push(fill(line.replace(/^ {4}/, '')));
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * In Stücke für Embeds teilen (je höchstens `size` Zeichen, an Absätzen). Insgesamt bleibt der Text unter
 * Discords Grenze für eine Nachricht (6000 Zeichen); was darüber hinausgeht, wird mit Hinweis gekürzt.
 */
function chunks(text, { size = 3800, total = 5400 } = {}) {
  let rest = text;
  let clipped = false;
  if (rest.length > total) {
    rest = rest.slice(0, total).replace(/\n[^\n]*$/, '');
    clipped = true;
  }
  const parts = [];
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size / 2) cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return { parts, clipped };
}

/** Name zum Vergleichen: Groß-/Kleinschreibung und Leerzeichen egal (wie bei der Unterschrift im Portal). */
const normName = (s) => String(s || '').toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();

module.exports = { toMarkdown, chunks, normName, escapeMd };
