'use strict';
/*
 * Stil & Saison beim Ausliefern jeder Seite einsetzen (kein Aufblitzen der Standardfarben):
 *  - <style id="psTheme"> mit Akzentfarbe, Glasstärke, Rundung und Schrift aus Einstellungen → Konfiguration → Stil & Saison
 *  - <html data-season="halloween" data-site-motion="ruhig" data-font="modern">
 *  - /js/season.js (Deko: Fledermäuse, Schnee, Feuerwerk … – lädt season.css nur, wenn eine Saison läuft)
 * Die Werte rechnet auch der Browser nach (public/js/siteconfig.js → PS.theme), damit die Vorschau beim Schieben der
 * Regler sofort stimmt und eine aus dem Zwischenspeicher geladene Seite nachzieht.
 */
const siteConfig = require('./siteConfig');
const promotions = require('./promotions');

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const DEFAULTS = siteConfig.SPECS.style.defaults;

/** CSS-Variablen für einen Stil (gleiche Rechnung wie PS.theme.vars im Browser). */
function vars(style) {
  const s = { ...DEFAULTS, ...style };
  const acc = hexRgb(/^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULTS.accent);
  const light = mix(acc, [255, 255, 255], 0.6);
  const dark = mix(acc, [0, 0, 0], 0.14);
  const g = s.glass;
  const blur = Math.round(8 + g * 0.28);
  const sat = (1.15 + g * 0.006).toFixed(2);
  const out = {
    '--gold-500': hex(acc),
    '--gold-600': hex(dark),
    '--gold-light': hex(light),
    '--accent-rgb': acc.join(', '),
    '--accent-light-rgb': light.join(', '),
    '--accent-dark-rgb': dark.join(', '),
    '--gold-hairline': `rgba(${acc.join(', ')}, 0.35)`,
    '--gold-soft': `rgba(${acc.join(', ')}, 0.1)`,
    '--gold-glow': `rgba(${acc.join(', ')}, 0.25)`,
    '--lit-gold': `rgba(${acc.join(', ')}, 0.16)`,
    '--glass-blur': `blur(${blur}px) saturate(${sat})`,
    '--glass-fill': `rgba(9, 16, 36, ${(0.9 - g * 0.004).toFixed(3)})`,
    '--glass-fill-strong': `rgba(8, 14, 32, ${(0.95 - g * 0.0026).toFixed(3)})`,
    '--panel-alpha': (0.9 - g * 0.0032).toFixed(3),
    '--radius': `${Math.round(4 + s.radius * 0.28)}px`,
  };
  if (s.font === 'modern') out['--font-display'] = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  return { vars: out, mobileBlur: `blur(${Math.round(blur * 0.73)}px) saturate(${sat})` };
}

/** Stil als CSS – leer, solange alles auf Standard steht (die Stylesheets haben dieselben Werte). */
function css(style) {
  const s = { ...DEFAULTS, ...style };
  if (s.accent.toLowerCase() === DEFAULTS.accent && s.glass === DEFAULTS.glass && s.radius === DEFAULTS.radius && s.font === DEFAULTS.font) return '';
  const v = vars(s);
  const body = Object.entries(v.vars)
    .map(([k, val]) => `${k}: ${val};`)
    .join(' ');
  return `:root:root { ${body} } @media (max-width: 767px) { :root:root { --glass-blur: ${v.mobileBlur}; } }`;
}

// Dokumente bleiben schlicht (Druck); Warte- und Offline-Seite bekommen gar nichts eingesetzt (eigenständig, aus dem Service Worker)
const DOCS = new Set(['invoice', 'vertrag', 'aktenauszug']);
const BARE = new Set(['offline', 'aufwachen']);

/** Saison für diese Seite ('' = keine). Im Dashboard nur, wenn „auch im Dashboard“ an ist. */
function seasonFor(page, style = siteConfig.get('style')) {
  if (page === 'dashboard' && !style.seasonDash) return '';
  if (DOCS.has(page) || BARE.has(page)) return '';
  return promotions.season(style.season);
}

/** In eine ausgelieferte HTML-Seite einsetzen. */
function inject(html, page) {
  if (BARE.has(page)) return html;
  let style;
  try {
    style = siteConfig.get('style');
  } catch {
    return html;
  }
  const season = seasonFor(page, style);
  const attrs = [season ? `data-season="${season}"` : '', style.motion !== 'normal' ? `data-site-motion="${style.motion}"` : '', style.font !== 'klassisch' ? `data-font="${style.font}"` : '']
    .filter(Boolean)
    .join(' ');
  let out = html;
  if (attrs) out = out.replace(/<html\b/, `<html ${attrs}`);
  const rules = css(style);
  const tags = [rules ? `<style id="psTheme">${rules}</style>` : '', DOCS.has(page) ? '' : '<script src="/js/season.js" defer></script>'].filter(Boolean).join('\n    ');
  if (tags) out = out.replace('</head>', `    ${require('./assets').rewrite(tags)}\n</head>`);
  // Kanzlei-weit „ruhig“: die gedämpfte Bewegung gilt für alle, die selbst nichts eingestellt haben
  if (style.motion === 'ruhig') out = out.replace(/(<link[^>]*data-calm[^>]*media=")[^"]*"|(<link[^>]*media=")[^"]*("[^>]*data-calm)/g, (m, a, b, c) => (a ? `${a}all"` : `${b}all${c}`));
  return out;
}

module.exports = { vars, css, inject, seasonFor };
