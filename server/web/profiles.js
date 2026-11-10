'use strict';
/*
 * Öffentliche Anwalts-Profilseiten: /team/<name> – Foto, Rang, Beschreibung, Schwerpunkte, Erfolge,
 * Mandantenstimmen und „Mandat anfragen“. Wird auf dem Server in die Hülle der Website gesetzt (index.html, Abschnitte
 * data-page="profil" – gleiche Kopfzeile, Fußzeile und Fenster wie jede Unterseite), damit
 * Discord & Co. in der Link-Vorschau gleich Name, Rang und Foto zeigen.
 *
 * Zahlen nur, wo sie nichts über einzelne Mandate verraten: erst ab mehreren abgeschlossenen Akten bzw.
 * Bewertungen, und nur wenn das Board „Erfolge öffentlich zeigen“ eingeschaltet hat (wie auf der Startseite).
 */
const { db, getSetting } = require('../db/db');
const { teamRow, TEAM_SELECT } = require('../db/models');
const { OUTCOMES, DUTY_STATUS } = require('../core/helpers');

const MIN_CLOSED = 3; // abgeschlossene Akten, ab denen Zahlen erscheinen
const MIN_RATED = 3; // Akten mit Ergebnis (Erfolg oder nicht) für die Erfolgsquote
const MIN_REVIEWS = 3; // freigegebene Bewertungen für den Durchschnitt
// Öffentliches Profil: alle Rechtsgebiete außer „Sonstiges“
const AREA_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k !== 'sonstiges' && require('../domain/areas').exists(k) ? require('../domain/areas').name(k) : undefined) });


const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')[0] || '').join('').slice(0, 2).toUpperCase() || '★';

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
  const facts = { focus, closed: null, successRate: null, wins: [], rating: null, reviews: [], selected: [] };
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
    // Ausgewählte Verfahren: die drei jüngsten mit gutem Ausgang – nur Rechtsgebiet, Ergebnis und Monat, nichts zur Sache
    facts.selected = db
      .prepare(`SELECT area, outcome, closed_at FROM cases WHERE status = 'geschlossen' AND outcome IS NOT NULL AND id IN (${ids}) ORDER BY closed_at DESC`)
      .all(userId, userId)
      .filter((c) => OUTCOMES[c.outcome] && OUTCOMES[c.outcome].success && AREA_LABEL[c.area])
      .slice(0, 3)
      .map((c) => ({ area: AREA_LABEL[c.area], outcome: OUTCOMES[c.outcome].label, when: monthYear(c.closed_at) }));
  }
  if (rated >= MIN_RATED) facts.successRate = Math.round((won / rated) * 100);

  const { publicName } = require('../routes/reviews');
  const reviews = db.prepare(`SELECT * FROM reviews WHERE status = 'freigegeben' AND case_id IN (${ids}) ORDER BY COALESCE(decided_at, created_at) DESC`).all(userId, userId);
  if (reviews.length >= MIN_REVIEWS) facts.rating = { avg: reviews.reduce((s, r) => s + r.rating, 0) / reviews.length, count: reviews.length };
  facts.reviews = reviews.slice(0, 3).map((r) => ({ rating: r.rating, body: r.body, name: publicName(r) }));
  return facts;
}


const toDate = (v) => new Date(String(v || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
const monthYear = (v) => {
  const d = toDate(v);
  return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
};

/*
 * Freie Zeiten für ein Gespräch: die nächsten Tage, je drei Abendzeiten (Ortszeit der Kanzlei). Eine Zeit entfällt, wenn
 * der Anwalt dort schon einen Termin hat (± 90 Minuten). Gewählt wird ein Wunschtermin – er geht mit der Mandatsanfrage
 * an den Anwalt, der ihn bestätigt.
 */
const SLOT_TIMES = [17 * 60, 19 * 60, 21 * 60];
const SLOT_DAYS = 5;
const TZ = 'Europe/Berlin';
function wall(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function freeSlots(userId, now = new Date()) {
  const busy = new Map();
  for (const a of db.prepare("SELECT starts_at FROM appointments WHERE assigned_to = ? AND type != 'frist' AND status IN ('angefragt', 'bestaetigt')").all(userId)) {
    const d = toDate(a.starts_at);
    if (isNaN(d)) continue;
    const w = wall(d);
    busy.set(w.day, (busy.get(w.day) || []).concat(w.minutes));
  }
  const days = [];
  for (let i = 1; i <= SLOT_DAYS; i++) {
    const d = new Date(now.getTime() + i * 864e5);
    const { day } = wall(d);
    const taken = busy.get(day) || [];
    days.push({
      day,
      label: d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: TZ }).replace('.', ''),
      date: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: TZ }),
      slots: SLOT_TIMES.map((m) => ({ time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, free: !taken.some((t) => Math.abs(t - m) < 90) })),
    });
  }
  return days;
}

function render(member, facts, { origin, url, slots = [] }) {
  const lead = member.tier === 'leitung';
  const photo = member.photoUrl ? `${origin}${member.photoUrl}` : `${origin}/img/og-image.png`;
  const portrait = member.photoUrl
    ? `<img class="pf-photo" src="${esc(member.photoUrl)}" alt="${esc(member.name)}" width="144" height="144" decoding="async">`
    : `<span class="pf-photo kz-mono" aria-hidden="true">${esc(String(member.initials || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '–')}</span>`;
  // Telefon im Spiel (Team-Verwaltung): zum Kopieren – im Rollenspiel wählt man die Nummer im Spiel
  const phone = member.phone
    ? `<p class="pf-phone"><button type="button" class="pf-phone-btn" data-copy="${esc(member.phone)}" title="Nummer kopieren">${require('./icons').svg('phone')}<span class="pf-phone-k">Telefon</span><span class="pf-phone-n">${esc(member.phone)}</span>${require('./icons').svg('copy', 'kz-ico pf-phone-c')}</button></p>`
    : '';
  const duty = member.duty ? `<p class="pf-duty"><span class="duty-dot s-${esc(member.duty)}"></span>${esc(DUTY_STATUS[member.duty] || '')}</p>` : '';

  // Schwerpunkte: vom Board eingetragen, sonst die häufigsten Rechtsgebiete seiner Akten
  const focus = member.focus.length ? member.focus : facts.focus;
  const tiles = [];
  if (facts.closed) tiles.push(['Abgeschlossene Mandate', num(facts.closed), 'seit Beginn bei der Kanzlei', 'check']);
  if (facts.successRate !== null) tiles.push(['Erfolgsquote', `${facts.successRate} %`, 'der Verfahren mit Ergebnis', 'chart', facts.successRate]);
  if (facts.rating) tiles.push(['Bewertung', `${num(facts.rating.avg, 1)}`, `aus ${facts.rating.count} Mandantenstimmen`, 'star', null, facts.rating.avg]);
  const section = (title, body) => `<section class="pf-section"><h2 class="pf-h">${title}</h2>${body}</section>`;
  const selected = (facts.selected || []).length
    ? section('Ausgewählte Verfahren', `<ol class="pf-cases">${facts.selected.map((c) => `<li><span class="pf-case-area">${esc(c.area)}</span><strong>${esc(c.outcome)}</strong><span class="pf-case-when">${esc(c.when)}</span></li>`).join('')}</ol><p class="pf-note">Ohne Namen und Einzelheiten – die Verschwiegenheit gilt auch hier.</p>`)
    : '';
  const booking = slots.length
    ? `<section class="pf-section pf-book"><h2 class="pf-h">Freie Zeiten für ein Gespräch</h2><div class="pf-days">${slots
        .map(
          (d) =>
            `<div class="pf-day"><div class="pf-day-h"><b>${esc(d.label)}</b><span>${esc(d.date)}</span></div>${d.slots
              .map((s) => (s.free ? `<a class="pf-slot" href="/?anwalt=${member.id}&amp;termin=${d.day}T${s.time}" rel="nofollow">${s.time}</a>` : `<span class="pf-slot is-taken" title="vergeben">${s.time}</span>`))
              .join('')}</div>`
        )
        .join('')}</div><p class="pf-note">Zeit wählen – sie geht als Wunschtermin mit Ihrer Anfrage an ${esc(member.name)} und wird von der Kanzlei bestätigt.</p></section>`
    : '';
  const main = [
    tiles.length
      ? `<div class="pf-stats">${tiles
          .map(([l, v, s, ico, pct, stars]) => {
            // Kleine Zugabe je Kachel: Balken für die Quote, Sterne für die Bewertung
            const extra =
              pct != null
                ? `<span class="kpi-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`
                : stars != null
                  ? `<span class="kpi-stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i class="${stars >= n - 0.25 ? 'on' : ''}">★</i>`).join('')}</span>`
                  : '';
            return `<div class="kpi"><span class="kpi-ico" aria-hidden="true">${require('./icons').svg(ico)}</span><div class="kpi-label">${esc(l)}</div><div class="kpi-value">${esc(v)}</div>${extra}<div class="kpi-sub">${esc(s)}</div></div>`;
          })
          .join('')}</div>`
      : '',
    selected,
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
            .map((r) => `<figure class="pf-review"><div class="pf-stars" aria-label="${r.rating} von 5 Sternen">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div><blockquote>„${esc(r.body)}“</blockquote><figcaption><span class="kz-avatar" aria-hidden="true">${esc(initials(r.name))}</span><span>${esc(r.name)}</span></figcaption></figure>`)
            .join('')}</div>`
        )
      : '',
  ].join('');
  const aside = [focus.length ? section('Schwerpunkte', `<div class="pf-chips">${focus.map((f) => `<span class="pf-chip">${esc(f)}</span>`).join('')}</div>`) : '', booking].join('');
  const blocks = main || aside ? `<div class="pf-grid${main && aside ? '' : ' is-single'}">${main ? `<div class="pf-main">${main}</div>` : ''}${aside ? `<aside class="pf-aside">${aside}</aside>` : ''}</div>` : '';

  // Mit Konto geht die Anfrage direkt an ihn (Wunschanwalt), sonst an die ganze Kanzlei
  const cta = `<a href="${member.bookable ? `/?anwalt=${member.id}` : '/?mandat=1'}" class="btn-gold kz-btn">Mandat anfragen</a>`;
  const summary = member.description || `${member.roleTitle} bei Pake & Scha Legal Consulting. Mandat direkt anfragen.`;
  const head = `<nav class="kz-crumbs" aria-label="Pfad"><a href="/">Startseite</a><span aria-hidden="true">/</span><a href="/anwaelte">Anwälte</a><span aria-hidden="true">/</span>${esc(member.name)}</nav>
                <div class="pf-head">
                    <div class="pf-portrait">${portrait}</div>
                    <div class="min-w-0">
                        <span class="kz-rubric">${lead ? 'Board of Partners' : 'Associate Attorneys'}</span>${member.lawyerOfMonth ? ` <span class="lotm-badge" title="Für herausragende Arbeit im ${esc(member.lawyerOfMonth)}">Anwalt des Monats</span>` : ''}
                        <h1 class="kz-h1 pf-name">${esc(member.name)}</h1>
                        <p class="pf-rank">${esc(member.roleTitle)}</p>
                        ${duty}
                        ${phone}
                        ${member.description ? `<p class="kz-lead pf-desc">${esc(member.description)}</p>` : ''}
                        <div class="pf-actions kz-actions">${cta}<a href="/anwaelte" class="btn-outline kz-btn">Alle Anwälte</a></div>
                    </div>
                </div>`;
  const meta = {
    path: url.replace(/^https?:\/\/[^/]+/, ''),
    title: `${member.name} – ${member.roleTitle} | Pake & Scha`,
    full: true,
    ogTitle: `${member.name} – ${member.roleTitle}`,
    desc: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    image: photo,
    card: member.photoUrl ? 'summary' : 'summary_large_image',
    themeColor: '#c9a45c',
  };
  return { head, body: blocks, meta };
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
    const lotm = require('../domain/lawyerOfMonth').current();
    if (lotm && lotm.memberId === id) member.lawyerOfMonth = lotm.label;
    if (getSetting('show_duty_public', '1') !== '1') member.duty = null;
    const row = db.prepare('SELECT user_id FROM team_members WHERE id = ?').get(id);
    const showSuccess = getSetting('show_success_public', '1') === '1';
    const facts = row.user_id ? lawyerFacts(row.user_id, showSuccess) : { focus: [], closed: null, successRate: null, wins: [], rating: null, reviews: [], selected: [] };
    const slots = row.user_id && member.bookable ? freeSlots(row.user_id) : [];
    const origin = `${req.protocol}://${req.get('host')}`;
    const p = render(member, facts, { origin, url: `${origin}/team/${slugs.get(id)}`, slots });
    // In der Hülle der Website (Kopfzeile, Fußzeile, Mandatsfenster) – wie jede andere Unterseite
    require('./sitePages')
      .shell(req, { key: 'profil', meta: p.meta }, (html) =>
        html
          // Von der Karte eines Anwalts: Foto und Name gleiten an ihren Platz (Gegenstück in site.js) – im <head>, damit es vor dem Wechsel gilt
          .replace('</head>', '<style>@view-transition { navigation: auto; } .pf-photo { view-transition-name: pf-photo; } .pf-name { view-transition-name: pf-name; }</style>\n</head>')
          .replace('<!--profil:head-->', () => p.head)
          .replace(p.body ? '<!--profil:body-->' : /<section[^>]*data-page="profil"[^>]*>\s*<div class="kz-wrap">\s*<!--profil:body-->[\s\S]*?<\/section>/, () => p.body)
      )
      .then((html) => {
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(html);
      })
      .catch(next);
    return;
  } catch (err) {
    next(err);
  }
}

module.exports = { handler, slugify, slugMap, lawyerFacts, freeSlots };
