'use strict';
/*
 * Öffentliche Seiten (Startseite, Karriere) werden beim Ausliefern ergänzt:
 *  - Rang-Karten aus der Tabelle ranks (zwischen <!--ranks:board--> … <!--/ranks:board-->)
 *  - geänderte Website-Texte: jedes reine Text-Element bekommt data-t="<Schlüssel>"; hat das Board
 *    den Text geändert, steht gleich der neue Text drin (kein Flackern, Link-Vorschau sieht ihn auch)
 *  - absolute Adresse des Vorschaubilds (og:image), die Discord für die Link-Vorschau braucht
 * Der Schlüssel ist ein Fingerabdruck des Originaltexts: ändert sich der Text im Code, gilt wieder das Original.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
const ranks = require('./ranks');
const { collect, jsonForHtml } = require('./collect');

const PAGES = { index: 'index.html', karriere: 'karriere.html' };
const raw = {};
const read = (page) => {
  if (!raw[page] || process.env.NODE_ENV !== 'production') raw[page] = fs.readFileSync(path.join(__dirname, 'public', PAGES[page]), 'utf8');
  return raw[page];
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s) =>
  String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const norm = (s) => decode(s).replace(/\s+/g, ' ').trim();
const keyOf = (page, text) => crypto.createHash('sha1').update(`${page}|${text}`).digest('hex').slice(0, 12);

// Reine Text-Elemente (ohne Unterelemente). Elemente mit id füllt meist das Skript – die bleiben außen vor.
const LEAF = /<(h[1-6]|p|li|span|a|button|label|div|small|strong|em|dt|dd|td|th)(\s[^<>]*)?>([^<]+)<\/\1>/g;
const editable = (attrs, text) => !/\sid=|data-no-edit/.test(attrs || '') && /\p{L}.*\p{L}/u.test(text);

/** Alle bearbeitbaren Texte einer Seite: Map key → Originaltext. */
function texts(page) {
  const out = new Map();
  for (const chunk of read(page).split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head>[\s\S]*?<\/head>)/)) {
    if (/^<(script|style|head)/.test(chunk)) continue;
    for (const m of chunk.matchAll(LEAF)) {
      const t = norm(m[3]);
      if (editable(m[2], t)) out.set(keyOf(page, t), t);
    }
  }
  return out;
}

function overrides(page) {
  const map = new Map();
  for (const r of db.prepare('SELECT key, text FROM site_texts WHERE page = ?').all(page)) map.set(r.key, r.text);
  return map;
}

function render(page, origin) {
  const over = overrides(page);
  let html = read(page)
    .split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head>[\s\S]*?<\/head>)/)
    .map((chunk) => {
      if (/^<(script|style|head)/.test(chunk)) return chunk;
      return chunk.replace(LEAF, (all, tag, attrs = '', inner) => {
        const t = norm(inner);
        if (!editable(attrs, t)) return all;
        const key = keyOf(page, t);
        const text = over.has(key) ? esc(over.get(key)) : inner;
        return `<${tag}${attrs} data-t="${key}">${text}</${tag}>`;
      });
    })
    .join('');
  // Rang-Karten erst danach einsetzen: die pflegt das Board unter Einstellungen → Ränge, nicht als Website-Text
  if (page === 'index') {
    for (const level of ['board', 'associate']) {
      const cards = ranks.cardsHtml(level);
      html = html.replace(new RegExp(`(<!--ranks:${level}-->)[\\s\\S]*?(<!--/ranks:${level}-->)`), (_, a, b) => `${a}${cards}\n${b}`);
    }
  }
  return html.replace(/(content=")\/img\/og-image\.png"/g, `$1${origin}/img/og-image.png"`);
}

/*
 * Startseite und Karriere bringen ihre Daten gleich mit (Team, Honorare, Erfolge, Stimmen, Dienststatus, Stellen,
 * Anmeldestatus) – als JSON in der Seite statt bis zu neun Abrufen danach. Fehlt ein Teil, holt die Seite ihn wie
 * bisher selbst.
 */
const BOOT = {
  index: {
    session: '/api/auth/session',
    team: '/api/team',
    fees: '/api/fees',
    memberships: '/api/public/memberships',
    stats: '/api/public/stats',
    reviews: '/api/public/reviews',
    duty: '/api/public/on-duty',
    positions: '/api/public/positions',
    areas: '/api/public/areas',
  },
  karriere: { session: '/api/auth/session', positions: '/api/public/positions' },
};
function handler(page) {
  return async (req, res, next) => {
    try {
      let html = require('./assets').rewrite(render(page, `${req.protocol}://${req.get('host')}`));
      if (BOOT[page]) {
        const data = await collect(req, BOOT[page]);
        html = html.replace(/<body[^>]*>/, (tag) => `${tag}\n<script type="application/json" id="psBoot">${jsonForHtml(data)}</script>`);
      }
      res.set('Cache-Control', 'private, no-cache'); // enthält den Anmeldestatus der Person
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Weitere Seiten mit Link-Vorschau (Anmeldung, Registrierung, Bewerberseite): nur die absolute Adresse des
 * Vorschaubilds einsetzen – sonst zeigt Discord kein Bild.
 */
const previewRaw = {};
function previewHandler(file) {
  return (req, res, next) => {
    try {
      if (!previewRaw[file] || process.env.NODE_ENV !== 'production') previewRaw[file] = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
      const origin = `${req.protocol}://${req.get('host')}`;
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(require('./assets').rewrite(previewRaw[file].replace(/(content=")\/img\/og-image\.png"/g, `$1${origin}/img/og-image.png"`)));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { PAGES, texts, render, handler, previewHandler, keyOf };
