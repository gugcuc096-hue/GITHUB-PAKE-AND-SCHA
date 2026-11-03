'use strict';
/*
 * Dieselben Symbole wie im Dashboard (public/js/dashboard/01-basis.js → ICONS), damit die Website keine eigenen
 * zeichnet: das Objekt wird einmal aus der Datei gelesen und als <svg> gleicher Strichstärke ausgegeben.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let cache = null;
function all() {
  if (cache) return cache;
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'dashboard', '01-basis.js'), 'utf8');
  const m = src.match(/\nconst ICONS = (\{[\s\S]*?\n\});/);
  cache = m ? vm.runInNewContext(`(${m[1]})`, {}, { timeout: 200 }) : {};
  return cache;
}

/** <svg> eines Dashboard-Symbols (leer, wenn es den Namen nicht gibt). */
function svg(name, cls = 'kz-ico') {
  const d = all()[name];
  if (!d) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Symbol je Rechtsgebiet (eigene Gebiete: Waage). */
const AREA_ICON = { strafrecht: 'shield', zivilrecht: 'scale', verfassungsrecht: 'book', vertragsrecht: 'doc' };
const areaIcon = (key) => svg(AREA_ICON[key] || 'scale');

module.exports = { all, svg, areaIcon, AREA_ICON };
