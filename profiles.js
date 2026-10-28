'use strict';
/*
 * Öffentliche Anwalts-Profilseiten: /team/<name> – Foto, Rang, Beschreibung, Schwerpunkte, Erfolge,
 * Mandantenstimmen und „Mandat anfragen“. Wird auf dem Server zusammengesetzt (views/anwalt.html), damit
 * Discord & Co. in der Link-Vorschau gleich Name, Rang und Foto zeigen.
 *
 * Zahlen nur, wo sie nichts über einzelne Mandate verraten: erst ab mehreren abgeschlossenen Akten bzw.
 * Bewertungen, und nur wenn das Board „Erfolge öffentlich zeigen“ eingeschaltet hat (wie auf der Startseite).
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, getSetting } = require('./db');
const { teamRow, TEAM_SELECT } = require('./models');
const { OUTCOMES, DUTY_STATUS } = require('./helpers');

const MIN_CLOSED = 3; // abgeschlossene Akten, ab denen Zahlen erscheinen
const MIN_RATED = 3; // Akten mit Ergebnis (Erfolg oder nicht) für die Erfolgsquote
const MIN_REVIEWS = 3; // freigegebene Bewertungen für den Durchschnitt
// Öffentliches Profil: alle Rechtsgebiete außer „Sonstiges“
const AREA_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k !== 'sonstiges' && require('./areas').exists(k) ? require('./areas').name(k) : undefined) });


const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Adresse aus dem Namen: „Dr. Jürgen Weiß“ → „dr-juergen-weiss“. */
function slugify(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'anwalt'
  );
}

/** Sichtbare Teammitglieder → Adresse (gleiche Namen bekommen die Nummer angehängt). */
function slugMap() {
  const rows = db.prepare('SELECT id, name FROM team_members WHERE visible = 1').all();
  const seen = new Map();
  for (const r of rows) seen.set(slugify(r.name), (seen.get(slugify(r.name)) || 0) + 1);
  return new Map(rows.map((r) => [r.id, seen.get(slugify(r.name)) > 1 ? `${slugify(r.name)}-${r.id}` : slugify(r.name)]));
}

/** Zahlen zum Anwalt aus seinen Akten (federführend oder mitbearbeitend). */
function lawyerFacts(userId, showSuccess) {
  const ids = 'SELECT id FROM cases WHERE lawyer_id = ? UNION SELECT case_id FROM case_lawyers WHERE user_id = ?';
  const cases = db.prepare(`SELECT area, status, outcome FROM cases WHERE id IN (${ids})`).all(userId, userId);
  const areas = new Map();
  for (const c of cases) if (AREA_LABEL[c.area]) areas.set(c.area, (areas.get(c.area) || 0) + 1);
  const focus = [...areas.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([a]) => AREA_LABEL[a]);
  const facts = { focus, closed: null, successRate: null, wins: [], rating: null, reviews: [] };
  if (!showSuccess) return facts;

  const closed = cases.filter((c) => c.status === 'geschlossen');
  let rated = 0;
  let won = 0;
  const wins = new Map();
  for (const c of closed) {
    const o = OUTCOMES[c.outcome];
    if (!o || o.success === null) continue;
    rated++;
    if (o.success) {
      won++;
      wins.set(o.label, (wins.get(o.label) || 0) + 1);
    }
  }
  if (closed.length >= MIN_CLOSED) {
    facts.closed = closed.length;
    facts.wins = [...wins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }
  if (rated >= MIN_RATED) facts.successRate = Math.round((won / rated) * 100);

  const { publicName } = require('./routes/reviews');
  const reviews = db.prepare(`SELECT * FROM reviews WHERE status = 'freigegeben' AND case_id IN (${ids}) ORDER BY COALESCE(decided_at, created_at) DESC`).all(userId, userId);
  if (reviews.length >= MIN_REVIEWS) facts.rating = { avg: reviews.reduce((s, r) => s + r.rating, 0) / reviews.length, count: reviews.length };
  facts.reviews = reviews.slice(0, 3).map((r) => ({ rating: r.rating, body: r.body, name: publicName(r) }));
  return facts;
}

let template = null;
const readTemplate = () => {
  if (!template || process.env.NODE_ENV !== 'production') template = fs.readFileSync(path.join(__dirname, 'views', 'anwalt.html'), 'utf8');
  return template;
};

function render(member, facts, { origin, url }) {
  const lead = member.tier === 'leitung';
  const photo = member.photoUrl ? `${origin}${member.photoUrl}` : `${origin}/img/og-image.png`;
  const portrait = member.photoUrl
    ? `<img class="pf-photo" src="${esc(member.photoUrl)}" alt="${esc(member.name)}" width="136" height="136" decoding="async">`
    : `<div class="pf-photo pf-initials ${lead ? '' : 'slate'}" aria-hidden="true">${esc(member.initials || '?')}</div>`;
  const duty = member.duty ? `<p class="pf-duty"><span class="duty-dot s-${esc(member.duty)}"></span>${esc(DUTY_STATUS[member.duty] || '')}</p>` : '';

  // Schwerpunkte: vom Board eingetragen, sonst die häufigsten Rechtsgebiete seiner Akten
  const focus = member.focus.length ? member.focus : facts.focus;
  const tiles = [];
  if (facts.closed) tiles.push(['Abgeschlossene Mandate', num(facts.closed), '']);
  if (facts.successRate !== null) tiles.push(['Erfolgsquote', `${facts.successRate} %`, 'der Verfahren mit Ergebnis']);
  if (facts.rating) tiles.push(['Bewertung', `★ ${num(facts.rating.avg, 1)}`, `aus ${facts.rating.count} Mandantenstimmen`]);
  const section = (title, body) => `<section class="pf-section"><h2 class="pf-h">${title}</h2>${body}</section>`;
  const blocks = [
    tiles.length
      ? `<div class="pf-stats">${tiles.map(([l, v, s]) => `<div class="panel kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value">${esc(v)}</div><div class="kpi-sub">${esc(s)}</div></div>`).join('')}</div>`
      : '',
    focus.length ? section('Schwerpunkte', `<div class="pf-chips">${focus.map((f) => `<span class="pf-chip">${esc(f)}</span>`).join('')}</div>`) : '',
    member.highlights.length || facts.wins.length
      ? section(
          'Erfolge',
          (member.highlights.length ? `<ul class="pf-highlights">${member.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '') +
            (facts.wins.length ? `<ul class="pf-wins">${facts.wins.map(([label, n]) => `<li><b>${num(n)}×</b><span>${esc(label)}</span></li>`).join('')}</ul>` : '')
        )
      : '',
    facts.reviews.length
      ? section(
          'Mandantenstimmen',
          `<div class="pf-reviews">${facts.reviews
            .map((r) => `<figure class="pf-review"><div class="pf-stars" aria-label="${r.rating} von 5 Sternen">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div><blockquote>„${esc(r.body)}“</blockquote><figcaption>– ${esc(r.name)}</figcaption></figure>`)
            .join('')}</div>`
        )
      : '',
  ].join('');

  // Mit Konto geht die Anfrage direkt an ihn (Wunschanwalt), sonst an die ganze Kanzlei
  const cta = `<a href="${member.bookable ? `/?anwalt=${member.id}` : '/?mandat=1'}" class="btn-gold btn-md">Mandat anfragen</a>`;
  const summary = member.description || `${member.roleTitle} bei Pake & Scha Legal Consulting. Mandat direkt anfragen.`;
  const values = {
    title: esc(`${member.name} – ${member.roleTitle} | Pake & Scha`),
    ogTitle: esc(`${member.name} – ${member.roleTitle}`),
    description: esc(summary.length > 200 ? `${summary.slice(0, 197)}…` : summary),
    url: esc(url),
    image: esc(photo),
    imageAlt: esc(member.photoUrl ? `Foto von ${member.name}` : 'Pake & Scha Legal Consulting'),
    card: member.photoUrl ? 'summary' : 'summary_large_image',
    portrait,
    tier: `<span class="pf-tier ${lead ? '' : 'slate'}">${lead ? 'Board of Partners' : 'Associate Attorneys'}</span>${
      member.lawyerOfMonth ? `<span class="lotm-badge" title="Für herausragende Arbeit im ${esc(member.lawyerOfMonth)}">Anwalt des Monats</span>` : ''
    }`,
    name: esc(member.name),
    rank: esc(member.roleTitle),
    duty,
    desc: member.description ? `<p class="pf-desc">${esc(member.description)}</p>` : '',
    blocks,
    cta,
  };
  return readTemplate().replace(/\{\{(\w+)\}\}/g, (all, k) => (k in values ? values[k] : all));
}

/** GET /team/:slug – unbekannte oder ausgeblendete Profile landen auf der 404-Seite. */
function handler(req, res, next) {
  try {
    const want = String(req.params.slug || '').toLowerCase();
    const slugs = slugMap();
    let id = [...slugs].find(([, s]) => s === want)?.[0];
    const byId = want.match(/(?:^|-)(\d+)$/);
    if (!id && byId && slugs.has(Number(byId[1]))) id = Number(byId[1]);
    if (!id) return next();
    if (slugs.get(id) !== want) return res.redirect(301, `/team/${slugs.get(id)}`);
    const member = teamRow(db.prepare(`${TEAM_SELECT} WHERE t.id = ? AND t.visible = 1`).get(id));
    const lotm = require('./lawyerOfMonth').current();
    if (lotm && lotm.memberId === id) member.lawyerOfMonth = lotm.label;
    if (getSetting('show_duty_public', '1') !== '1') member.duty = null;
    const row = db.prepare('SELECT user_id FROM team_members WHERE id = ?').get(id);
    const showSuccess = getSetting('show_success_public', '1') === '1';
    const facts = row.user_id ? lawyerFacts(row.user_id, showSuccess) : { focus: [], closed: null, successRate: null, wins: [], rating: null, reviews: [] };
    const origin = `${req.protocol}://${req.get('host')}`;
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(require('./assets').rewrite(render(member, facts, { origin, url: `${origin}/team/${slugs.get(id)}` })));
  } catch (err) {
    next(err);
  }
}

module.exports = { handler, slugify, slugMap, lawyerFacts };
