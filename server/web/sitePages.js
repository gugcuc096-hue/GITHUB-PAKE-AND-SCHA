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
const { db } = require('../db/db');
const ranks = require('../domain/ranks');
const icons = require('./icons');
const { collect, jsonForHtml } = require('../domain/collect');

const PAGES = { index: 'index.html', karriere: 'karriere.html' };
const raw = {};
const read = (page) => {
  if (!raw[page] || process.env.NODE_ENV !== 'production') raw[page] = fs.readFileSync(path.join(__dirname, '..', '..', 'public', PAGES[page]), 'utf8');
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

function render(page, origin, view = null) {
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
  if (page === 'index') html = shape(html, view || { key: 'start' });
  // Symbole aus dem Dashboard (<!--icon:name-->), damit Website und Dashboard dieselben zeigen
  html = html.replace(/<!--icon:([a-zA-Z]+)-->/g, (_, n) => icons.svg(n));
  html = html.replace(/(content=")\/img\/og-image\.png"/g, `$1${origin}/img/og-image.png"`);
  return html.replace('</head>', `    ${require('./seo').headExtras(page, origin, view)}\n</head>`);
}

/*
 * Website in echten Unterseiten: index.html enthält alle Abschnitte der Website, jeder mit data-page="…" (eine oder
 * mehrere Seiten). Je Adresse bleiben nur die Abschnitte dieser Seite übrig – Kopf, Fußzeile und Fenster (Mandat,
 * Anmelden, Anliegen) gibt es überall. So bleibt jeder Text an genau einer Stelle (und im Bearbeitungsmodus änderbar).
 */
const VIEWS = {
  start: { path: '/', title: 'Pake & Scha – Kanzlei in Los Santos', desc: 'Pake & Scha Legal Consulting: Strafrecht, Zivilrecht, Verfassungsrecht und Vertragsrecht in Los Santos. Mandat online anfragen.' },
  kanzlei: { path: '/kanzlei', title: 'Die Kanzlei', desc: 'Wer wir sind, wie wir arbeiten und wie die Kanzlei aufgebaut ist.' },
  rechtsgebiete: { path: '/rechtsgebiete', title: 'Rechtsgebiete', desc: 'Strafrecht, Zivilrecht, Verfassungsrecht und Vertragsrecht – wobei wir Sie vertreten.' },
  anwaelte: { path: '/anwaelte', title: 'Anwälte', desc: 'Die Anwältinnen und Anwälte der Kanzlei Pake & Scha.' },
  honorare: { path: '/honorare', title: 'Honorare', desc: 'Honorarordnung, Tarifrechner und Mitgliedschaften der Kanzlei Pake & Scha.' },
  notdienst: { path: '/notdienst', title: 'Notdienst', desc: 'Festnahme, Durchsuchung, U-Haft: so erreichen Sie einen Anwalt der Kanzlei.' },
  aktuelles: { path: '/aktuelles', title: 'Aktuelles', desc: 'Neuigkeiten aus der Kanzlei Pake & Scha.' },
  verfahrensstand: { path: '/verfahrensstand', title: 'Verfahrensstand', desc: 'Stand Ihres Verfahrens mit Aktenzeichen und Pin abfragen.' },
  kontakt: { path: '/kontakt', title: 'Kontakt', desc: 'Mandat anfragen, Anliegen an die Kanzleileitung, Kanzleisitz und häufige Fragen.' },
  impressum: { path: '/impressum', title: 'Impressum', desc: 'Impressum der Kanzlei Pake & Scha (Rollenspiel).' },
};
/** Rechtsgebiete mit eigener, ausgeschriebener Seite in index.html; weitere bekommen eine schlichte Seite. */
const AREA_PAGES = ['strafrecht', 'zivilrecht', 'verfassungsrecht', 'vertragsrecht'];

function publicAreas() {
  const areas = require('../domain/areas');
  return areas.list({ activeOnly: true }).filter((a) => a.key !== 'sonstiges');
}
/** Adresse → Ansicht ({ key, area }) oder null. */
function viewOf(urlPath) {
  const p = urlPath.replace(/\/+$/, '') || '/';
  for (const [key, v] of Object.entries(VIEWS)) if (v.path === p) return { key };
  const m = p.match(/^\/rechtsgebiete\/([a-z0-9-]{2,40})$/);
  if (m) {
    const a = publicAreas().find((x) => x.key === m[1]);
    if (a) return { key: 'gebiet', area: a };
  }
  return null;
}
function metaOf(view) {
  if (view.meta) return view.meta; // Profilseite eines Anwalts (profiles.js)
  if (view.key === 'gebiet') return { path: `/rechtsgebiete/${view.area.key}`, title: view.area.name, desc: `${view.area.name}: wobei wir Sie vertreten und wie ein Mandat abläuft.` };
  return VIEWS[view.key];
}

const HEAD_EXTRAS = '<style>@view-transition { navigation: auto; }</style>';

/** Zweiter Knopf im Startbereich (Startseite anpassen → Startbereich). */
const HERO_LINKS = { anwaelte: ['/anwaelte', 'Unsere Anwälte'], honorare: ['/honorare', 'Honorare & Tarifrechner'], kontakt: ['/kontakt', 'Kontakt'] };
const START_SECTION = /<section\b[^>]*\bdata-start="([a-z]+)"[^>]*>[\s\S]*?<\/section>\s*/g;
/** Einstellungen der Startseite anwenden: Abschnitte (Reihenfolge, ausblenden), Rechtsgebiete, Anwälte, Meldungen, Startbereich. */
function applyStart(html, cfg, edit = false) {
  const { START_IDS } = require('./siteConfig');
  const order = [...cfg.order.filter((id) => START_IDS.includes(id)), ...START_IDS.filter((id) => !cfg.order.includes(id))];
  const hidden = new Set(cfg.hidden);
  const found = new Map();
  let first = -1;
  html = html.replace(START_SECTION, (all, id, at) => {
    if (first < 0) first = at;
    // Bearbeitungsmodus (Startseite anpassen): ausgeblendete Abschnitte bleiben sichtbar markiert, damit man sie wieder einschalten kann
    if (!hidden.has(id)) found.set(id, all);
    else if (edit) found.set(id, all.replace('<section', '<section data-sc-hidden'));
    return '\u0000';
  });
  if (first >= 0) {
    const sorted = order.filter((id) => found.has(id)).map((id) => found.get(id)).join('');
    let placed = false;
    html = html.replace(/\u0000/g, () => (placed ? '' : ((placed = true), sorted)));
  }
  // Rechtsgebiete: nur die gewählten, in dieser Reihenfolge (leer = alle)
  if (cfg.areas.length && !edit) {
    html = html.replace(/(<section id="gebiete"[\s\S]*?<ol class="[^"]*">)([\s\S]*?)(<\/ol>)/, (all, a, list, b) => {
      const items = new Map([...list.matchAll(/<li\b[^>]*\bdata-area="([a-z0-9-]+)"[^>]*>[\s\S]*?<\/li>/g)].map((m) => [m[1], m[0]]));
      const picked = cfg.areas.filter((k) => items.has(k)).map((k) => items.get(k));
      return a + (picked.length ? picked : [...items.values()]).join('') + b;
    });
  }
  html = html.replace('id="leadGrid" class="kz-people" data-mode="leitung" data-count="3"', `id="leadGrid" class="kz-people" data-mode="${esc(cfg.lawyerMode)}" data-count="${Number(cfg.lawyerCount) || 3}" data-ids="${cfg.lawyers.map(Number).join(',')}"`);
  html = html.replace('id="newsTeaser" class="kz-news-cards" data-count="3"', `id="newsTeaser" class="kz-news-cards" data-count="${Number(cfg.newsCount) || 3}"`);
  if (cfg.heroSecond !== 'notdienst') {
    const l = HERO_LINKS[cfg.heroSecond];
    if (l) html = html.replace(/<!--hero:second-->[\s\S]*?<!--\/hero:second-->/, `<a href="${l[0]}" class="btn-outline kz-btn is-lg" data-hero-second="${esc(cfg.heroSecond)}">${esc(l[1])}</a>`);
    else if (edit) html = html.replace('data-hero-second="notdienst"', 'data-hero-second="notdienst" hidden');
    else html = html.replace(/<!--hero:second-->[\s\S]*?<!--\/hero:second-->/, '');
  }
  if (!cfg.heroNote) html = edit ? html.replace('<!--hero:note--><p class="kz-hero-note"', '<!--hero:note--><p class="kz-hero-note" hidden') : html.replace(/<!--hero:note-->[\s\S]*?<!--\/hero:note-->/, '');
  return html;
}

const SECTION = /<section\b[^>]*\bdata-page="([^"]+)"[^>]*>[\s\S]*?<\/section>/g;
function shape(html, view) {
  const want = view.key === 'gebiet' ? (AREA_PAGES.includes(view.area.key) ? `gebiet:${view.area.key}` : 'gebiet:*') : view.key;
  html = html.replace(SECTION, (all, pages) => (pages.split(/\s+/).includes(want) ? all : ''));
  const areas = publicAreas();
  const active = new Set(areas.map((a) => a.key));
  // Rechtsgebiete-Liste: ausgeblendete fallen weg, eigene (vom Board angelegte) kommen dazu
  html = html.replace(/<li\b[^>]*\bdata-area="([a-z0-9-]+)"[^>]*>[\s\S]*?<\/li>/g, (all, key) => (active.has(key) ? all : ''));
  html = html.replace(/<!--areas:more-->/g, () =>
    areas
      .filter((a) => !AREA_PAGES.includes(a.key))
      .map((a) => `<li class="kz-tile" data-area="${esc(a.key)}"><a href="/rechtsgebiete/${esc(a.key)}"><span class="kz-tile-ico">${icons.areaIcon(a.key)}</span><span class="kz-area-name">${esc(a.name)}</span><span class="kz-area-text">${esc(a.intakeTitle || a.name)}</span><span class="kz-more">Zum Rechtsgebiet</span></a></li>`)
      .join('')
  );
  if (view.key === 'gebiet') {
    const a = view.area;
    const steps = a.steps.map((st) => `<li>${esc(st)}</li>`).join('');
    html = html.replace(/\{\{gebiet:name\}\}/g, esc(a.name)).replace('<!--gebiet:steps-->', steps).replace(/data-gebiet-key/g, `data-area-key="${esc(a.key)}"`);
    // Großes, zurückhaltendes Symbol des Rechtsgebiets hinter der Überschrift
    html = html.replace(/(<section class="kz-pagehead[^"]*" data-page="gebiet:[^"]+">)/g, `$1<span class="kz-pagehead-ico" aria-hidden="true">${icons.areaIcon(a.key)}</span>`);
  }
  html = html.replace(/(id="factAreas">)\d+/, `$1${areas.length}`); // Eckdaten: Zahl der Rechtsgebiete
  if (view.key === 'start') {
    let start = null;
    try {
      start = require('./siteConfig').get('home').start;
    } catch {
      /* Standard */
    }
    html = applyStart(html, start || require('./siteConfig').START_DEFAULTS, !!view.edit);
  }
  // Übrige Rechtsgebiete unter einem Rechtsgebiet (ohne das aktuelle)
  if (view.key === 'gebiet') {
    html = html.replace('<!--gebiet:others-->', areas.filter((a) => a.key !== view.area.key).map((a) => `<a href="/rechtsgebiete/${esc(a.key)}">${esc(a.name)}</a>`).join(''));
  }
  // Kopf und Titel der Seite
  const m = metaOf(view);
  const title = view.key === 'start' || m.full ? m.title : `${m.title} – Pake & Scha`;
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(m.desc)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(m.ogTitle || (view.key === 'start' ? 'Pake & Scha – Recht haben. Recht bekommen.' : title))}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(m.desc)}"`);
  if (m.image) html = html.replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(m.image)}"`);
  if (m.card) html = html.replace(/(<meta name="twitter:card" content=")[^"]*"/, `$1${m.card}"`);
  if (m.themeColor) html = html.replace(/(<meta name="theme-color" content=")[^"]*"/, `$1${m.themeColor}"`);
  // Menü: aktuelle Seite markieren
  const navKey = view.key === 'gebiet' ? 'rechtsgebiete' : view.key === 'profil' ? 'anwaelte' : view.key;
  html = html.replace(new RegExp(`data-nav="${navKey}"`, 'g'), `data-nav="${navKey}" aria-current="page"`);
  html = html.replace(/<body([^>]*)class="/, `<body$1data-view="${view.key}" class="`);
  // Weiche Seitenwechsel zwischen den Unterseiten (Kopf und Fußzeile bleiben stehen, nur der Inhalt blendet über) –
  // nur auf diesen Seiten: Anmeldung, Dashboard usw. machen nicht mit, dorthin geht es wie bisher.
  // (Vorladen beim Darüberfahren: js/sitenav.js)
  html = html.replace('</head>', `    ${HEAD_EXTRAS}\n</head>`);
  // Kanzleisitz gleich richtig (sonst kurz der Standardwert)
  try {
    const { firmSeat, firmPlace } = require('../db/models');
    html = html.replace(/(<[^>]+data-firm-seat[^>]*>)[^<]*/g, `$1${esc(firmSeat())}`).replace(/(<[^>]+data-firm-place[^>]*>)[^<]*/g, `$1${esc(firmPlace())}`);
  } catch {
    /* Standardwert bleibt */
  }
  return html;
}

/*
 * Startseite und Karriere bringen ihre Daten gleich mit (Team, Honorare, Erfolge, Stimmen, Dienststatus, Stellen,
 * Anmeldestatus) – als JSON in der Seite statt bis zu neun Abrufen danach. Fehlt ein Teil, holt die Seite ihn wie
 * bisher selbst.
 */
const BOOT_COMMON = { session: '/api/auth/session', areas: '/api/public/areas', duty: '/api/public/on-duty' };
const BOOT_VIEW = {
  start: { team: '/api/team', news: '/api/public/news', stats: '/api/public/stats' },
  kanzlei: { stats: '/api/public/stats', reviews: '/api/public/reviews', positions: '/api/public/positions' },
  anwaelte: { team: '/api/team' },
  honorare: { fees: '/api/fees', memberships: '/api/public/memberships' },
  aktuelles: { news: '/api/public/news' },
  gebiet: { team: '/api/team' },
};
const BOOT = { karriere: { session: '/api/auth/session', positions: '/api/public/positions' } };
/** Fertige Seite der Website für eine Ansicht (mit Daten zum Start); fill() darf den Inhalt noch ergänzen. */
async function shell(req, view, fill = (h) => h, page = 'index') {
  let html = require('./theme').inject(require('./assets').rewrite(render(page, `${req.protocol}://${req.get('host')}`, view)), page);
  html = fill(html);
  const boot = page === 'index' ? { ...BOOT_COMMON, ...(BOOT_VIEW[view.key] || {}) } : BOOT[page];
  if (boot) {
    const data = await collect(req, boot);
    html = html.replace(/<body[^>]*>/, (tag) => `${tag}\n<script type="application/json" id="psBoot">${jsonForHtml(data)}</script>`);
  }
  return html;
}

function handler(page) {
  return async (req, res, next) => {
    try {
      let view = null;
      if (page === 'index') {
        view = viewOf(req.path);
        if (!view) return next();
        if (view.key === 'start' && 'bearbeiten' in req.query) view = { ...view, edit: true }; // Startseite anpassen (Board)
      }
      const html = await shell(req, view, undefined, page);
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
      if (!previewRaw[file] || process.env.NODE_ENV !== 'production') previewRaw[file] = fs.readFileSync(path.join(__dirname, '..', '..', 'public', file), 'utf8');
      const origin = `${req.protocol}://${req.get('host')}`;
      res.set('Cache-Control', 'no-cache');
      const html = require('./assets').rewrite(previewRaw[file].replace(/(content=")\/img\/og-image\.png"/g, `$1${origin}/img/og-image.png"`));
      res.type('html').send(require('./theme').inject(html, file.replace(/\.html$/, '')));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { HERO_LINKS, applyStart, shell, PAGES, VIEWS, AREA_PAGES, texts, render, handler, previewHandler, keyOf, viewOf, metaOf, publicAreas };
