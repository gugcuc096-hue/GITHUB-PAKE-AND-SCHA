'use strict';
/*
 * Orte einer Akte (Tatort-Karte): Tatort, Festnahme, Fundort, Fahrzeug … mit Postleitzahl der FiveM-Karte von San Andreas.
 * Die Postal-Koordinaten stammen aus „nearest-postal“ (MIT, siehe seeds/postals.LICENSE.txt): [Code, x, y] in Spielkoordinaten.
 * Ein Ort speichert die Postleitzahl und die genaue Position (beim Klick auf die Karte der nächste Postal, wie im Spiel).
 * Nur die Kanzlei sieht die Orte.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const KINDS = { tatort: 'Tatort', festnahme: 'Festnahme', zeuge: 'Zeuge gesehen', fundort: 'Fundort', fahrzeug: 'Fahrzeug', sonstiges: 'Sonstiges' };

let cache = null;
/** Alle Postleitzahlen: { list: [[code, x, y]], by: Map(code → [code, x, y]) } – einmal geladen. */
function postals() {
  if (!cache) {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'postals.json'), 'utf8'));
    cache = { list, by: new Map(list.map((p) => [p[0], p])) };
  }
  return cache;
}
const byCode = (code) => postals().by.get(String(code || '').trim()) || null;

/** Nächste Postleitzahl zu einer Position (wie das Skript im Spiel). */
function nearest(x, y) {
  let best = null;
  let bd = Infinity;
  for (const p of postals().list) {
    const d = (p[1] - x) ** 2 + (p[2] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best ? { code: best[0], x: best[1], y: best[2], dist: Math.sqrt(bd) } : null;
}

const row = (r) => ({
  id: r.id,
  caseId: r.case_id,
  postal: r.postal,
  x: r.x,
  y: r.y,
  kind: r.kind,
  kindLabel: KINDS[r.kind] || r.kind,
  label: r.label,
  note: r.note,
  happenedAt: r.happened_at || null,
  lookDir: r.look_dir === null || r.look_dir === undefined ? null : r.look_dir,
  lookRange: r.look_range || 80,
  lookFov: r.look_fov || 70,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** Orte einer Akte: nach Zeitpunkt (ohne Zeitpunkt zuletzt), dann in der Reihenfolge der Erfassung. */
function listForCase(caseId) {
  return db
    .prepare('SELECT * FROM case_places WHERE case_id = ? ORDER BY (happened_at IS NULL), happened_at, id')
    .all(caseId)
    .map(row);
}

module.exports = { KINDS, postals, byCode, nearest, listForCase, row };
