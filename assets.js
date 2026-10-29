'use strict';
/*
 * Schneller laden: Skripte und Stylesheets bekommen in den Seiten eine Versionsnummer (?v=…, aus dem Inhalt aller
 * Dateien) und bleiben dann ein Jahr im Browser – ohne Nachfragen beim Server. Nach einem Update ändert sich die
 * Nummer, und jeder lädt automatisch die neue Fassung (kein Strg+F5 nötig). Die Seiten selbst werden immer frisch
 * geladen (no-cache).
 *
 * Kleiner ausliefern: Skripte und CSS kommen verkleinert (esbuild: Leerraum und Kommentare raus, Namen bleiben) und
 * fertig komprimiert – Brotli für alle Browser, die es können, sonst gzip. Komprimiert wird einmal je Fassung, nicht
 * bei jedem Abruf.
 *
 * Dashboard in zwei Bündeln (gleiche Reihenfolge, alle im strikten Modus – zusammengefügt verhalten sie sich wie
 * einzeln geladen): /js/dashboard.bundle.js für alle, /js/dashboard.staff.js mit den Verwaltungsteilen (Team,
 * Einstellungen, Discord, Statistik, Wiki, Lager …) lädt das Dashboard nur für die Kanzlei nach.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, 'public');
const DASH_DIR = path.join(PUBLIC, 'js', 'dashboard');
const YEAR = 'public, max-age=31536000, immutable';
/** Nur für die Kanzlei (Mandanten laden sie nie): Teile, deren Ansichten Kanzlei/Board vorbehalten sind. */
const STAFF_PARTS = new Set(['07-konfiguration.js', '07-listen.js', '07-rechte-schalter.js', '07-team-einstellungen.js', '08-discord.js', '09-system.js', '09-verwaltung.js', '13-kanzlei.js']);
const PROD = () => process.env.NODE_ENV === 'production';

let esbuild = null;
try {
  esbuild = require('esbuild');
} catch {
  /* ohne esbuild: unverkleinert (nur komprimiert) */
}

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
  const version = hash.digest('hex').slice(0, 12);
  if (cache && cache.version === version) return Object.assign(cache, { at, pages: new Map() }); // Skripte unverändert: Komprimiertes behalten
  const parts = fs.readdirSync(DASH_DIR).filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort();
  const join = (list) => list.map((f) => `/* ---- ${f} ---- */\n${fs.readFileSync(path.join(DASH_DIR, f), 'utf8')}`).join('\n;\n');
  return {
    version,
    bundle: join(parts.filter((f) => !STAFF_PARTS.has(f))),
    staff: join(parts.filter((f) => STAFF_PARTS.has(f))),
    pages: new Map(),
    packed: new Map(),
    at,
  };
}
// Im Betrieb einmal je Start (die Dateien ändern sich nur mit einem Update); beim Entwickeln nach 2 s frisch
const state = () => (cache && (PROD() || Date.now() - cache.at < 2000) ? cache : (cache = build()));
/** Nach einem Neubau des Tailwind-CSS beim Start: Versionsnummer neu berechnen. */
const reset = () => (cache = null);

/** Verkleinern (falls möglich): liefert Rohdaten, Typ und ETag – das Komprimieren folgt getrennt. */
function minify(key, text, type) {
  let code = text;
  if (esbuild) {
    try {
      code =
        type === 'css'
          ? esbuild.transformSync(text, { loader: 'css', minify: true, legalComments: 'none' }).code
          : esbuild.transformSync(text, { loader: 'js', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' }).code;
    } catch (err) {
      console.warn(`Verkleinern von ${key} fehlgeschlagen – wird unverkleinert ausgeliefert:`, err.message);
    }
  }
  const raw = Buffer.from(code);
  return {
    raw,
    type: type === 'css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`,
  };
}
const brotliOpts = (raw) => ({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: PROD() ? 11 : 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }); // beim Entwickeln schnell, im Betrieb so klein wie möglich

/*
 * Fertig komprimierte Dateien liegen im Betrieb zusätzlich auf der Platte (.packed/<Version>/, angelegt bei „npm install“
 * oder beim ersten Start). Nach einem Neustart – z. B. wenn der Server aus dem Ruhezustand aufwacht – werden sie nur
 * gelesen, nicht neu gerechnet: Brotli auf höchster Stufe belegte sonst mehrere Sekunden lang den ganzen Server.
 */
const PACK_DIR = process.env.PACK_DIR || path.join(__dirname, '.packed');
const diskFile = (version, key) => path.join(PACK_DIR, version, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
function readDisk(version, key) {
  if (!PROD()) return null;
  try {
    const d = JSON.parse(fs.readFileSync(diskFile(version, key), 'utf8'));
    return { raw: Buffer.from(d.raw, 'base64'), br: Buffer.from(d.br, 'base64'), gz: Buffer.from(d.gz, 'base64'), type: d.type, etag: d.etag };
  } catch {
    return null;
  }
}
function writeDisk(version, key, p) {
  try {
    const file = diskFile(version, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ raw: p.raw.toString('base64'), br: p.br.toString('base64'), gz: p.gz.toString('base64'), type: p.type, etag: p.etag }));
  } catch {
    /* Platte schreibgeschützt: dann eben nur im Arbeitsspeicher */
  }
}
/** Andere Versionen auf der Platte entfernen – sie wächst nicht mit jedem Update. */
function sweepDisk(version) {
  try {
    for (const d of fs.readdirSync(PACK_DIR)) if (d !== version) fs.rmSync(path.join(PACK_DIR, d), { recursive: true, force: true });
  } catch {
    /* gibt es nicht */
  }
}

/** Verkleinert (falls möglich) und komprimiert – je Fassung einmal. */
function pack(key, text, type) {
  const st = state();
  if (st.packed.has(key)) return st.packed.get(key);
  const disk = readDisk(st.version, key);
  if (disk) {
    st.packed.set(key, disk);
    return disk;
  }
  const m = minify(key, text, type);
  const p = { ...m, br: zlib.brotliCompressSync(m.raw, brotliOpts(m.raw)), gz: zlib.gzipSync(m.raw, { level: 9 }) };
  st.packed.set(key, p);
  return p;
}
/** Wie pack, aber das Komprimieren läuft im Hintergrund – der Server bleibt dabei ansprechbar. */
async function packAsync(key, text, type) {
  const st = state();
  if (st.packed.has(key)) return st.packed.get(key);
  const disk = readDisk(st.version, key);
  if (disk) {
    st.packed.set(key, disk);
    return disk;
  }
  const m = minify(key, text, type);
  const [br, gz] = await Promise.all([util.promisify(zlib.brotliCompress)(m.raw, brotliOpts(m.raw)), util.promisify(zlib.gzip)(m.raw, { level: 9 })]);
  if (state() !== st) return null; // inzwischen neue Fassung (Entwickeln)
  const p = st.packed.get(key) || { ...m, br, gz }; // hat eine Anfrage inzwischen selbst gepackt, gilt deren Ergebnis
  st.packed.set(key, p);
  writeDisk(st.version, key, p);
  return p;
}

function send(req, res, p) {
  const st = state();
  res.set('Cache-Control', req.query.v === st.version ? YEAR : 'no-cache');
  res.set('Content-Type', p.type);
  res.set('Vary', 'Accept-Encoding');
  res.set('ETag', p.etag);
  if (req.get('if-none-match') === p.etag) return res.status(304).end();
  const accept = req.get('accept-encoding') || '';
  const [body, enc] = /\bbr\b/.test(accept) ? [p.br, 'br'] : /\bgzip\b/.test(accept) ? [p.gz, 'gzip'] : [p.raw, null];
  if (enc) res.set('Content-Encoding', enc); // die allgemeine Komprimierung greift dann nicht noch einmal
  res.set('Content-Length', String(body.length));
  res.status(200).end(req.method === 'HEAD' ? undefined : body);
}

/** Versionsnummern einsetzen, die Dashboard-Teile durch das Bündel ersetzen und Wichtiges früh anstoßen. */
function rewrite(html) {
  const { version } = state();
  return html
    .replace(
      /(?:[ \t]*<script src="\/js\/dashboard\/\d\d-[\w-]+\.js"><\/script>\s*)+/,
      `    <script src="/js/dashboard.bundle.js" data-staff="/js/dashboard.staff.js?v=${version}"></script>\n`
    )
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

/** Seiten unter ihrer Adresse ohne „.html“ (/dashboard, /vertrag, /rechnung …); Startseite & Co. haben eigene Routen. */
const ALIAS = { rechnung: 'invoice' };
function pages(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = req.path.match(/^\/([a-z0-9-]+)$/i);
  const html = m && page(`${ALIAS[m[1]] || m[1]}.html`);
  if (!html) return next();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
}

/** /js/dashboard.bundle.js (alle) und /js/dashboard.staff.js (nur Kanzlei – enthält keine Daten, nur Programmcode). */
const bundle = (req, res) => send(req, res, pack('bundle', state().bundle, 'js'));
const staffBundle = (req, res) => send(req, res, pack('staff', state().staff, 'js'));

/** Übrige Skripte und Stylesheets aus public/js und public/css: verkleinert und komprimiert. */
function staticAsset(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = req.path.match(/^\/(js|css)\/([\w./-]+\.(js|css))$/);
  if (!m || m[2].includes('..')) return next();
  const file = path.join(PUBLIC, m[1], m[2]);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) return next();
  send(req, res, pack(req.path, fs.readFileSync(file, 'utf8'), m[3]));
}

/** Alles Auslieferbare verkleinern und komprimieren (nacheinander, im Hintergrund). Liefert die Zahl der Dateien. */
async function packAll() {
  const st = state();
  const items = [
    ['bundle', st.bundle, 'js'],
    ['staff', st.staff, 'js'],
  ];
  for (const f of [...listFiles(path.join(PUBLIC, 'js')), ...listFiles(path.join(PUBLIC, 'css'))]) {
    const rel = '/' + path.relative(PUBLIC, f).split(path.sep).join('/');
    if (!rel.startsWith('/js/dashboard/')) items.push([rel, fs.readFileSync(f, 'utf8'), rel.endsWith('.css') ? 'css' : 'js']);
  }
  for (const [key, text, type] of items) {
    await packAsync(key, text, type);
    await new Promise((resolve) => setImmediate(resolve)); // zwischendurch Anfragen bedienen
  }
  sweepDisk(st.version);
  return items.length;
}

/** Im Betrieb nach dem Start im Hintergrund vorbereiten, damit schon der erste Besucher nicht warten muss. */
function warm() {
  setImmediate(() => packAll().catch((err) => console.warn('Vorbereiten der Skripte fehlgeschlagen:', err.message)));
}

/** Für express.static: Dateien mit der aktuellen Versionsnummer ein Jahr behalten. */
function setHeaders(res) {
  if (res.req && res.req.query && res.req.query.v === state().version) res.set('Cache-Control', YEAR);
}

module.exports = { rewrite, page, pages, bundle, staffBundle, staticAsset, warm, packAll, setHeaders, reset, version: () => state().version, STAFF_PARTS };
