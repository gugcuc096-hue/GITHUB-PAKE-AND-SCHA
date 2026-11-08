#!/usr/bin/env node
'use strict';
/*
 * Design „Ruhig“: erzeugt public/css/ruhig-formen.css – die eckigeren Formen für Website und Dashboard.
 *
 * Das bisherige Design („Klassisch“) bleibt in seinen Stylesheets unverändert. Dieses Skript liest jede Regel mit
 * border-radius aus ihnen und schreibt dieselbe Regel mit kleinerer Rundung, nur gültig unter
 * html[data-design="ruhig"] (server/web/theme.js setzt das Attribut je nach Einstellungen → Stil & Saison → Design).
 *   ≥ 16px → 6px · 12–15px → 5px · 8–11px → 4px · 4–7px → 3px · kleiner bleibt
 *   Pillen (999px …) → 4px – außer bei runden Dingen (Profilbilder, Punkte, Schalter, Ladekreise …), die bleiben rund
 *   50 % (Kreise) bleibt
 * Die Rundungs-Variablen (--r-sm, --r-md, --radius) stellt ruhig.css ein.
 *
 * Aufruf nach Änderungen an einem Stylesheet: npm run build:ruhig
 * (test/design-ruhig.test.js prüft, dass die Datei zum aktuellen Stand passt.)
 */
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const CSS = path.join(__dirname, '..', 'public', 'css');
const SOURCES = ['tailwind.css', 'app.css', 'select.css', 'controls.css', 'depth.css', 'motion.css', 'fall.css', 'website.css', 'kanzlei.css', 'karriere.css', 'season.css', 'gfx.css'];
const OUT = path.join(CSS, 'ruhig-formen.css');
const SCOPE = 'html[data-design="ruhig"]';

// Runde Dinge bleiben rund: Profilbilder/Initialen, Punkte, Schalter, Ladekreise, Regler, Radio-Knöpfe, Fortschrittsbalken
const ROUND = /ava|avatar|photo|pfp|portrait|initial|dot|pulse|blob|orb|toggle|knob|thumb|spinner|spin|loader|ring|radio|slider|range|bar-fill|progress|meter|track-node|step-node|node|badge-count|count-badge|bubble-count|unread|pip|bullet|circle|round|rounded-full|seal|logo|emoji|swatch|color|cursor|scrollbar|kz-flow|hr-num|num-badge|-num\b|notify-count|indicator|caret|ping|legend i|track-fill|dp-ring|skel-dot|fb-dot/i;

// Nie umrechnen: die Skizze des klassischen Designs in Stil & Saison
const KEEP = /design-shot-klassisch/;

const PILL = /^(9{2,}px|var\(--r-pill\)|9999px|100vmax|100vw|50vh|1e3px|1000px)$/;
function mapOne(v) {
  const m = /^(\d*\.?\d+)(px|rem|em)$/.exec(v);
  if (!m) return v;
  const px = Number(m[1]) * (m[2] === 'px' ? 1 : 16);
  if (px >= 16) return '6px';
  if (px >= 12) return '5px';
  if (px >= 8) return '4px';
  if (px >= 4) return '3px';
  return v;
}
/** Neue Rundung oder null (unverändert lassen). */
function mapRadius(value, selector) {
  const v = value.trim().replace(/\s*!important$/, '');
  if (/^(0|inherit|initial|unset|50%|100%)$/.test(v) || /%/.test(v)) return null;
  if (/var\(--(r-sm|r-md|radius)\)/.test(v) && !/calc/.test(v)) return null; // regeln die Variablen
  if (PILL.test(v)) return ROUND.test(selector) ? null : '4px';
  const parts = v.split(/\s+/);
  if (parts.some((p) => !/^(\d*\.?\d+)(px|rem|em)$|^0$/.test(p))) return null;
  const out = parts.map(mapOne).join(' ');
  return out === v ? null : out;
}

const scoped = (sel) =>
  sel
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('::view-transition') && !s.startsWith('@'))
    .map((s) => (/^html\b/.test(s) ? s.replace(/^html/, SCOPE) : /^:root\b/.test(s) ? s.replace(/^:root/, SCOPE) : `${SCOPE} ${s}`))
    .join(',\n');

function build() {
  const out = postcss.root();
  for (const file of SOURCES) {
    const src = fs.readFileSync(path.join(CSS, file), 'utf8');
    const root = postcss.parse(src, { from: file });
    const rules = [];
    root.walkRules((rule) => {
      if (rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
      const decls = [];
      rule.walkDecls(/^border(-(top|bottom)-(left|right))?-radius$/, (d) => {
        if (d.parent !== rule) return;
        const parts = rule.selectors.filter((s) => !s.startsWith('::view-transition') && !KEEP.test(s));
        // Gemischte Selektorlisten: runde und eckige Teile getrennt behandeln
        const square = parts.filter((s) => !(PILL.test(d.value.trim().replace(/\s*!important$/, '')) && ROUND.test(s)));
        if (!square.length) return;
        const nv = mapRadius(d.value, square.join(','));
        if (nv) decls.push([d.prop, nv + (d.important ? ' !important' : ''), square]);
      });
      if (!decls.length) return;
      // Regel(n) mit denselben Selektoren zusammenfassen
      const bySel = new Map();
      for (const [prop, value, sels] of decls) {
        const key = sels.join(',');
        if (!bySel.has(key)) bySel.set(key, []);
        bySel.get(key).push([prop, value]);
      }
      for (const [key, list] of bySel) {
        const sel = scoped(key);
        if (!sel) continue;
        const r = postcss.rule({ selector: sel });
        for (const [prop, value] of list) r.append(postcss.decl({ prop, value }));
        // Umgebende @media/@supports übernehmen
        let wrap = r;
        for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) {
          const a = postcss.atRule({ name: p.name, params: p.params });
          a.append(wrap);
          wrap = a;
        }
        rules.push(wrap);
      }
    });
    if (rules.length) {
      out.append(postcss.comment({ text: ` ${file} ` }));
      for (const r of rules) out.append(r);
    }
  }
  const head = `/*\n * Design „Ruhig“ – eckigere Formen (erzeugt von scripts/build-ruhig.js, nicht von Hand ändern).\n * Gilt nur unter ${SCOPE}; „Klassisch“ nutzt weiter die Rundungen der Original-Stylesheets.\n */\n`;
  return head + out.toString().replace(/\n{3,}/g, '\n\n') + '\n';
}

if (require.main === module) {
  const css = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== css) {
      console.error('public/css/ruhig-formen.css ist veraltet – bitte „npm run build:ruhig“ ausführen.');
      process.exit(1);
    }
    console.log('ruhig-formen.css ist aktuell.');
  } else {
    fs.writeFileSync(OUT, css);
    console.log(`ruhig-formen.css geschrieben (${css.split('\n').length} Zeilen).`);
  }
}
module.exports = { build, mapRadius };
