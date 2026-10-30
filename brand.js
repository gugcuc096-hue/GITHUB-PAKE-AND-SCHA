'use strict';
/*
 * Kanzleifarbe außerhalb der Stylesheets (Einstellungen → Stil & Saison → Akzentfarbe):
 *  - Logo: /img/logo.svg und /img/logo.png werden in der gewählten Farbe ausgeliefert (Website, Dashboard, Rechnung,
 *    Aktenauszug, Word-/Google-Dokumente, Link-Vorschau)
 *  - Farben für Word-Dokumente (docxRender.js), Discord-Nachrichten (discord.js) und Gesprächsverläufe (transcripts.js)
 * Bei der Standardfarbe bleibt alles genau wie bisher (Originaldateien).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const siteConfig = require('./siteConfig');

const DEFAULT = siteConfig.SPECS.style.defaults.accent; // #d4af37
const LOGO_GOLD = '#caa32f'; // Strichfarbe der Logo-Datei
const IMG = path.join(__dirname, 'public', 'img');

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Akzentfarbe (veröffentlicht) samt hellen/dunklen Tönen. */
function accent() {
  let hex = DEFAULT;
  try {
    const s = siteConfig.get('style');
    if (/^#[0-9a-f]{6}$/i.test(s.accent)) hex = s.accent.toLowerCase();
  } catch {
    /* ohne Datenbank: Standard */
  }
  const rgb = hexRgb(hex);
  const isDefault = hex === DEFAULT;
  return {
    hex,
    rgb,
    isDefault,
    int: parseInt(hex.slice(1), 16),
    dark: isDefault ? '#b8962e' : toHex(mix(rgb, [0, 0, 0], 0.14)),
    light: isDefault ? '#f3e5ab' : toHex(mix(rgb, [255, 255, 255], 0.6)),
    logo: isDefault ? LOGO_GOLD : toHex(mix(rgb, [0, 0, 0], 0.05)),
  };
}

/** Farbe ohne „#“ in Großbuchstaben (Word). */
const docx = (hex) => hex.slice(1).toUpperCase();

/* ---------------------------------------------------------------- Logo als SVG */
let svgRaw = null;
function logoSvg() {
  if (!svgRaw) svgRaw = fs.readFileSync(path.join(IMG, 'logo.svg'), 'utf8');
  const a = accent();
  return a.isDefault ? svgRaw : svgRaw.split(LOGO_GOLD).join(a.logo);
}

/* ---------------------------------------------------------------- Logo als PNG (einfarbig: Farbe tauschen, Kanten behalten) */
const pngCache = new Map();
let pngRaw = null;
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** PNG (RGBA, 8 Bit, nicht verschachtelt) in einer anderen Farbe – die Deckkraft jedes Punkts bleibt. */
function recolorPng(buf, rgb) {
  let p = 8;
  let w = 0;
  let h = 0;
  let ihdr = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = data;
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) return buf; // anderes Format: unverändert
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[row + x];
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = y && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + up;
      else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) {
        const pp = a + up - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  const out = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = y * stride + x * 4;
      const d = y * (stride + 1) + 1 + x * 4;
      out[d] = rgb[0];
      out[d + 1] = rgb[1];
      out[d + 2] = rgb[2];
      out[d + 3] = px[s + 3];
    }
  }
  return Buffer.concat([buf.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function logoPng() {
  if (!pngRaw) pngRaw = fs.readFileSync(path.join(IMG, 'logo.png'));
  const a = accent();
  if (a.isDefault) return pngRaw;
  if (!pngCache.has(a.logo)) {
    if (pngCache.size > 8) pngCache.clear();
    pngCache.set(a.logo, recolorPng(pngRaw, hexRgb(a.logo)));
  }
  return pngCache.get(a.logo);
}

/** Express: /img/logo.svg und /img/logo.png in der Kanzleifarbe (kurz zwischengespeichert, mit ETag). */
function logoHandler(kind) {
  return (req, res) => {
    const body = kind === 'svg' ? logoSvg() : logoPng();
    const tag = `"logo-${accent().logo.slice(1)}"`;
    res.set('ETag', tag);
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    if (req.headers['if-none-match'] === tag) return res.status(304).end();
    res.type(kind === 'svg' ? 'image/svg+xml' : 'image/png').send(body);
  };
}

module.exports = { accent, docx, logoSvg, logoPng, recolorPng, logoHandler };
