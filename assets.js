'use strict';
/*
 * Schneller laden: Skripte und Stylesheets bekommen in den Seiten eine Versionsnummer (?v=…, aus dem Inhalt aller
 * Dateien) und bleiben dann ein Jahr im Browser – ohne Nachfragen beim Server. Nach einem Update ändert sich die
 * Nummer, und jeder lädt automatisch die neue Fassung (kein Strg+F5 nötig). Die Seiten selbst werden immer frisch
 * geladen (no-cache). Die zwölf Dashboard-Teile kommen als eine Datei (/js/dashboard.bundle.js, gleiche Reihenfolge,
 * alle im strikten Modus – zusammengefügt verhalten sie sich wie einzeln geladen).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, 'public');
const DASH_DIR = path.join(PUBLIC, 'js', 'dashboard');
const YEAR = 'public, max-age=31536000, immutable';

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.(js|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

let cache = null;
function build() {
  const at = Date.now();
  const hash = crypto.createHash('sha1');
  for (const f of [...listFiles(path.join(PUBLIC, 'js')), ...listFiles(path.join(PUBLIC, 'css'))].sort()) {
    hash.update(path.relative(PUBLIC, f)).update(fs.readFileSync(f));
  }
  const parts = fs.readdirSync(DASH_DIR).filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort();
  const bundle = parts.map((f) => `/* ---- ${f} ---- */\n${fs.readFileSync(path.join(DASH_DIR, f), 'utf8')}`).join('\n;\n');
  return { version: hash.digest('hex').slice(0, 12), bundle, pages: new Map(), at };
}
// Im Betrieb einmal je Start (die Dateien ändern sich nur mit einem Update); beim Entwickeln nach 2 s frisch
const state = () => (cache && (process.env.NODE_ENV === 'production' || Date.now() - cache.at < 2000) ? cache : (cache = build()));
/** Nach einem Neubau des Tailwind-CSS beim Start: Versionsnummer neu berechnen. */
const reset = () => (cache = null);

/** Versionsnummern einsetzen und die Dashboard-Teile durch das Bündel ersetzen. */
function rewrite(html) {
  const { version } = state();
  return html
    .replace(/(?:[ \t]*<script src="\/js\/dashboard\/\d\d-[\w-]+\.js"><\/script>\s*)+/, '    <script src="/js/dashboard.bundle.js"></script>\n')
    .replace(/\b(src|href)="(\/(?:js|css)\/[^"?#]+\.(?:js|css))"/g, `$1="$2?v=${version}"`);
}

/** Eine Seite aus public/ mit Versionsnummern (im Betrieb einmal gelesen); null, wenn es sie nicht gibt. */
function page(file) {
  const st = state();
  if (!st.pages.has(file)) {
    const p = path.join(PUBLIC, file);
    st.pages.set(file, fs.existsSync(p) ? rewrite(fs.readFileSync(p, 'utf8')) : null);
  }
  return st.pages.get(file);
}

/** Seitenaufrufe wie /dashboard.html oder /vertrag (Startseite & Co. haben eigene Routen). */
function pages(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = req.path.match(/^\/([a-z0-9-]+)(?:\.html)?$/i);
  const html = m && page(`${m[1]}.html`);
  if (!html) return next();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
}

function bundle(req, res) {
  const st = state();
  res.set('Cache-Control', req.query.v === st.version ? YEAR : 'no-cache');
  res.type('application/javascript').send(st.bundle);
}

/** Für express.static: Dateien mit der aktuellen Versionsnummer ein Jahr behalten. */
function setHeaders(res) {
  if (res.req && res.req.query && res.req.query.v === state().version) res.set('Cache-Control', YEAR);
}

module.exports = { rewrite, page, pages, bundle, setHeaders, reset, version: () => state().version };
