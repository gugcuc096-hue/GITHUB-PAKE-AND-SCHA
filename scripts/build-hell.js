#!/usr/bin/env node
'use strict';
/*
 * Helle Ansicht („Weiß“): erzeugt public/css/hell.css – dieselbe Website und dasselbe Dashboard auf hellem Grund.
 *
 * Jeder Benutzer wählt selbst zwischen „Blau“ (Standard) und „Weiß“ (Knopf in der Kopfzeile; public/js/gfx.js setzt
 * <html data-mode="hell"> vor dem ersten Bild). Dieses Skript liest jede Regel mit einer festen Farbe aus den
 * Stylesheets und schreibt dieselbe Regel für die helle Ansicht um:
 *   Schrift   helle Töne → dunkles Blau (gleiche Abstufung), helle bunte Töne → dunkler, damit sie auf Weiß lesbar sind
 *   Flächen   dunkles Blau → Weiß/Elfenbein (je dunkler, desto „weiter hinten“), weiße Schleier und Linien → blaue
 *   Schatten  viel leichter
 * Danach folgt der Feinschliff von Hand aus scripts/hell-fein.css (Werte, Sonderfälle).
 * Gilt nur im Design „Ruhig“ (html[data-design="ruhig"][data-mode="hell"]); „Klassisch“ bleibt blau.
 *
 * Aufruf nach Änderungen an einem Stylesheet: npm run build:hell (test/hell.test.js prüft den Stand).
 */
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const CSS = path.join(__dirname, '..', 'public', 'css');
// Reihenfolge wie in den Seiten (spätere Regeln gewinnen bei gleichem Gewicht)
const SOURCES = ['tokens.css', 'scrollbar.css', 'feinschliff.css', 'app.css', 'website.css', 'tailwind.css', 'select.css', 'controls.css', 'fall.css', 'depth.css', 'motion.css', 'kanzlei.css', 'karriere.css', 'season.css', 'gfx.css', 'ruhig.css'];
const FEIN = path.join(__dirname, 'hell-fein.css');
const OUT = path.join(CSS, 'hell.css');
const SCOPE = 'html[data-design="ruhig"][data-mode="hell"]';

const INK = [15, 26, 54];
const DIM = [104, 112, 138];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgb([h, s, l]) {
  if (!s) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const out = (c, a) => (a >= 0.995 ? `#${c.map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')}` : `rgba(${c.join(', ')}, ${Number(a.toFixed(3))})`);

/** Eine Farbe umrechnen. kind: 'text' | 'surface' | 'shadow'. Liefert null, wenn sie bleibt. */
function mapColor(c, a, kind) {
  const [h, s, l] = hsl(c);
  const gray = s < 0.3 || (l > 0.88 && s < 0.6);
  const navy = l < 0.24 && (s < 0.3 || (h > 0.5 && h < 0.75));
  if (kind === 'text') {
    if (navy || l < 0.3) return null; // dunkle Schrift (auf Gold, auf Papier) bleibt
    if (l > 0.55 && gray) return out(mix(INK, DIM, clamp((1 - l) / 0.38, 0, 1)), a);
    if (l > 0.5) return out(rgb([h, Math.min(s, 0.8), h > 0.1 && h < 0.2 ? 0.28 : 0.33]), a); // helle bunte Schrift dunkler (Gold etwas mehr)
    return null;
  }
  if (kind === 'shadow') {
    if (l < 0.3 && (gray || navy)) return out([16, 26, 54], a * 0.2);
    return null;
  }
  // Flächen, Ränder, Verläufe
  if (l > 0.85 && gray) return a < 0.995 ? out([16, 26, 54], clamp(a * 1.25, 0, 1)) : null; // weißer Schleier → blauer; deckendes Weiß bleibt
  if (navy || (l < 0.2 && gray)) {
    const tone = l < 0.055 ? [246, 244, 238] : l < 0.115 ? [255, 255, 255] : [240, 237, 229];
    return out(tone, a);
  }
  if (gray && l < 0.6) return out(mix([226, 228, 235], [176, 182, 198], clamp((l - 0.2) / 0.4, 0, 1)), a); // Schiefer-Töne
  return null;
}

// auch rgba(10, 18, 40, var(--panel-alpha, 0.74)): Deckkraft als Variable bleibt als Variable stehen
const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*(?:[\d.]+|var\([^()]*\))\s*)?\)|rgb\(\s*\d+\s+\d+\s+\d+\s*(?:\/\s*(?:[\d.]+%?|var\([^()]*\))\s*)?\)/gi;
function parse(tok) {
  if (tok[0] === '#') {
    let x = tok.slice(1);
    if (x.length <= 4) x = [...x].map((ch) => ch + ch).join('');
    const n = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
    return [n, x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1];
  }
  const v = /[,/]\s*(var\([^()]*\))\s*\)$/.exec(tok);
  if (v) return [tok.match(/\d+/g).slice(0, 3).map(Number), 1, v[1]];
  const nums = tok.match(/[\d.]+%?/g);
  const a = nums[3] == null ? 1 : nums[3].endsWith('%') ? parseFloat(nums[3]) / 100 : Number(nums[3]);
  return [nums.slice(0, 3).map(Number), a];
}
function kindOf(prop) {
  const p = prop.toLowerCase();
  if (/^(color|fill|stroke|caret-color|text-decoration(-color)?|-webkit-text-fill-color|-webkit-text-stroke(-color)?)$/.test(p)) return 'text';
  if (/shadow|^filter$|^backdrop-filter$/.test(p)) return 'shadow';
  if (p.startsWith('--')) return /shadow|^--sh-|glow/.test(p) ? 'shadow' : /text|ink|muted|dim|-fg|color$/.test(p) && !/bg|border|line|rule/.test(p) ? 'text' : 'surface';
  return 'surface';
}
/** Neuer Wert oder null. */
const SCRIM = /backdrop|overlay|scrim|veil|shade|dimmer|lightbox|modal-bg|drawer-bg/i;
function mapValue(prop, value, selector = '') {
  if (!COLOR.test(value)) return null;
  COLOR.lastIndex = 0;
  const kind = kindOf(prop);
  let changed = false;
  const next = value.replace(COLOR, (tok) => {
    const [c, a, alphaVar] = parse(tok);
    let m = mapColor(c, alphaVar ? 0.9 : a, kind);
    // der Schleier hinter einem Fenster dunkelt die Seite ab – auch auf Weiß (statt sie weiß zu überdecken)
    if (m && kind === 'surface' && !alphaVar && a < 0.97 && a > 0.2 && SCRIM.test(selector) && hsl(c)[2] < 0.24) m = out([16, 26, 54], Math.min(0.42, a * 0.55));
    if (!m) return tok;
    changed = true;
    if (!alphaVar) return m;
    const [r, g, bl] = parse(m)[0];
    return `rgba(${r}, ${g}, ${bl}, ${alphaVar})`;
  });
  return changed ? next : null;
}

// Bleibt, wie es ist: Papier/Dokumente, die Skizzen der Designs, Farbfelder zum Auswählen, Karte, Saison-Deko
const KEEP = /design-shot|doc-|paper|sheet|swatch|color-|map-|leaflet|karte|season|confetti|firework|snow|print|qr|sig-pad|sign-pad/i;

const scoped = (sel) =>
  sel
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('::view-transition') && !/data-design="klassisch"/.test(s))
    .map((s) => {
      if (/^:root:root\[data-design="ruhig"\]/.test(s)) return s.replace(/^:root:root\[data-design="ruhig"\]/, `:root:root[data-design="ruhig"][data-mode="hell"]`);
      if (/^html\[data-design="ruhig"\]/.test(s)) return s.replace(/^html\[data-design="ruhig"\]/, SCOPE);
      if (/^html\b/.test(s)) return s.replace(/^html/, SCOPE);
      if (/^:root\b/.test(s)) return s.replace(/^(:root)+/, `:root:root[data-design="ruhig"][data-mode="hell"]`);
      return `${SCOPE} ${s}`;
    })
    .join(', ');

function build() {
  const parts = [];
  let count = 0;
  for (const file of SOURCES) {
    const root = postcss.parse(fs.readFileSync(path.join(CSS, file), 'utf8'));
    const lines = [];
    root.walkRules((rule) => {
      let wrap = [];
      for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) {
        if (/keyframes|font-face/.test(p.name)) return;
        if (p.name === 'media' && /print/.test(p.params)) return;
        wrap.unshift(`@${p.name} ${p.params}`);
      }
      if (KEEP.test(rule.selector)) return;
      const decls = [];
      rule.each((d) => {
        if (d.type !== 'decl') return;
        const v = mapValue(d.prop, d.value, rule.selector);
        if (v) decls.push(`${d.prop}: ${v}${d.important ? ' !important' : ''};`);
      });
      if (!decls.length) return;
      const sel = scoped(rule.selector);
      if (!sel) return;
      count += decls.length;
      lines.push(`${wrap.map((w) => `${w} { `).join('')}${sel} { ${decls.join(' ')} }${wrap.map(() => ' }').join('')}`);
    });
    if (lines.length) parts.push(`/* ---- ${file} ---- */\n${lines.join('\n')}`);
  }
  const head = `/*\n * ERZEUGT von scripts/build-hell.js (npm run build:hell) – nicht von Hand ändern.\n * Helle Ansicht („Weiß“): ${count} Farbangaben aus den Stylesheets umgerechnet, danach der Feinschliff aus scripts/hell-fein.css.\n */\n`;
  return `${head}${parts.join('\n')}\n/* ==== Feinschliff (scripts/hell-fein.css) ==== */\n${fs.readFileSync(FEIN, 'utf8')}`;
}

if (require.main === module) {
  const css = build();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== css) {
      console.error('public/css/hell.css ist nicht aktuell – bitte „npm run build:hell“ ausführen.');
      process.exit(1);
    }
    console.log('hell.css ist aktuell.');
  } else {
    fs.writeFileSync(OUT, css);
    console.log(`hell.css geschrieben (${(css.length / 1024).toFixed(1)} kB).`);
  }
}

module.exports = { build, mapColor, mapValue, SCOPE };
