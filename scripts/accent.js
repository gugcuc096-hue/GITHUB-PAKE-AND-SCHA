'use strict';
/*
 * Akzentfarbe zum Einstellen (Einstellungen → Konfiguration → Stil & Saison): festes Gold im CSS wird zu Variablen,
 * die theme.js beim Ausliefern der Seite setzt. Läuft beim Bauen von tailwind.css (scripts/build-css.js) und einmalig
 * über die übrigen Stylesheets:  node scripts/accent.js
 *   #d4af37 → var(--gold-500) · #b8962e → var(--gold-600) · #f3e5ab → var(--gold-light)
 *   weitere Goldtöne (#e6c25a, #c9a227 …) → color-mix(…var(--gold-500)…)
 *   rgba(212, 175, 55, a) → rgba(var(--accent-rgb), a) – ebenso das helle (243, 229, 171) und dunkle Gold (184, 150, 46)
 * Die Definitionen selbst (--gold-500: #d4af37) und Selektoren (.bg-\[\#d4af37\]) bleiben unberührt.
 */
const fs = require('fs');
const path = require('path');

const HEX = [
  [/(?<![\\\w-]|--gold-500:\s*|--gold-500,\s*)#d4af37\b/gi, 'var(--gold-500)'],
  [/(?<![\\\w-]|--gold-600:\s*|--gold-600,\s*)#b8962e\b/gi, 'var(--gold-600)'],
  [/(?<![\\\w-]|--gold-light:\s*|--gold-light,\s*)#f3e5ab\b/gi, 'var(--gold-light)'],
];
// weitere Goldtöne (heller/dunkler) als Mischung aus der Akzentfarbe
const LIGHT = 'color-mix(in srgb, var(--gold-500), #fff 15%)';
const PALE = 'color-mix(in srgb, var(--gold-500), #fff 45%)';
const DEEP = 'color-mix(in srgb, var(--gold-500), #000 15%)';
const SHADES = [
  [/(?<![\\\w-])#(e6c25a|e8c862|e8c766|e8c860|e6c76a|efce62|e3c250|f1d27a)\b/gi, LIGHT],
  [/(?<![\\\w-])#(f3dc8a|f6e08f|f3dc8c)\b/gi, PALE],
  [/(?<![\\\w-])#(b8912a|b08f2c|c9a227)\b/gi, DEEP],
];
const RGB = [
  [/rgba\(\s*212\s*,\s*175\s*,\s*55\s*,\s*/g, 'rgba(var(--accent-rgb), '],
  [/rgba\(\s*243\s*,\s*229\s*,\s*171\s*,\s*/g, 'rgba(var(--accent-light-rgb), '],
  [/rgba\(\s*184\s*,\s*150\s*,\s*46\s*,\s*/g, 'rgba(var(--accent-dark-rgb), '],
];
/** Standardwerte der Variablen (stehen in jedem :root, das --gold-500 definiert). */
const ROOT_VARS = '--accent-rgb: 212, 175, 55; --accent-light-rgb: 243, 229, 171; --accent-dark-rgb: 184, 150, 46;';

function accentize(css) {
  let out = css;
  for (const [re, to] of [...HEX, ...SHADES, ...RGB]) out = out.replace(re, to);
  return out;
}
/** In HTML nur die <style>-Blöcke umschreiben (Klassen wie bg-[rgba(212,175,55,0.08)] bleiben – deren CSS steht in tailwind.css). */
function accentizeHtml(html) {
  return html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, a, css, b) => a + accentize(css) + b);
}

module.exports = { accentize, accentizeHtml, ROOT_VARS };

if (require.main === module) {
  const pub = path.join(__dirname, '..', 'public');
  const files = [
    ...fs.readdirSync(path.join(pub, 'css')).filter((f) => f.endsWith('.css')).map((f) => path.join(pub, 'css', f)),
    ...fs.readdirSync(pub).filter((f) => f.endsWith('.html')).map((f) => path.join(pub, f)),
  ];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const next = f.endsWith('.html') ? accentizeHtml(src) : accentize(src);
    if (next !== src) {
      fs.writeFileSync(f, next);
      console.log('angepasst:', path.relative(pub, f));
    }
  }
}
