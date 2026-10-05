'use strict';
/*
 * Tailwind (v3) fest bauen: ersetzt das Play-CDN (cdn.tailwindcss.com), das laut Tailwind nicht für
 * den Produktivbetrieb gedacht ist. Gleiches Ergebnis wie das CDN – Tailwind 3 mit Standard-Theme und
 * Autoprefixer – nur einmal vorab statt bei jedem Seitenaufruf im Browser.
 *
 *   npm run build:css     → public/css/tailwind.css neu erzeugen (nach neuen Tailwind-Klassen ausführen)
 *
 * Die fertige Datei liegt im Repository. Sind die Build-Werkzeuge installiert (devDependencies), frischt
 * der Server sie beim Start zusätzlich auf – so fehlen keine Klassen, falls der Build einmal vergessen wurde.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'css', 'tailwind.css');
const HEADER = '/* Automatisch erzeugt mit „npm run build:css“ (Tailwind CSS v3) – nicht von Hand bearbeiten. */\n';

async function buildTailwind() {
  const postcss = require('postcss');
  const tailwind = require('tailwindcss');
  const autoprefixer = require('autoprefixer');
  const { css } = await postcss([
    tailwind({
      // Alle Seiten und Skripte, in denen Tailwind-Klassen stehen (auch in JavaScript erzeugtes HTML)
      content: [path.join(ROOT, 'public', '*.html'), path.join(ROOT, 'public', 'js', '**', '*.js')],
      theme: { extend: {} },
      plugins: [],
    }),
    autoprefixer({ remove: false }),
  ]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
  const next = HEADER + css;
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (prev !== next) fs.writeFileSync(OUT, next);
  return { changed: prev !== next, bytes: Buffer.byteLength(next) };
}

/** Beim Serverstart: nur bauen, wenn die Werkzeuge installiert sind – sonst gilt die fertige Datei. */
function refreshOnStart() {
  try {
    require.resolve('tailwindcss');
    require.resolve('postcss');
    require.resolve('autoprefixer');
  } catch {
    return;
  }
  buildTailwind()
    .then((r) => r.changed && console.log(`Tailwind-CSS aktualisiert (${Math.round(r.bytes / 1024)} KB).`))
    .catch((err) => console.warn('Tailwind-CSS konnte nicht neu gebaut werden – die vorhandene Datei bleibt aktiv:', err.message));
}

module.exports = { buildTailwind, refreshOnStart };

if (require.main === module) {
  buildTailwind()
    .then((r) => console.log(`public/css/tailwind.css ${r.changed ? 'neu erzeugt' : 'unverändert'} (${Math.round(r.bytes / 1024)} KB).`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
