/*
 * Kanzlei-Dashboard – Einstellungen → Texte & Banner: Stil & Saison, Rabattaktionen und Aktenzeichen.
 *  - Stil & Saison: Vorlagen, Akzentfarbe, Glas, Rundung, Schrift, Bewegung, Saison-Deko (Entwurf → Veröffentlichen);
 *    jede Änderung zeigt sich sofort im ganzen Dashboard (PS.theme), bis man den Bereich verlässt
 *  - Rabattaktionen: für alle, mit Anlass, Zeitraum (auch jährlich), Ankündigung im Banner (routes/promotions.js)
 *  - Aktenzeichen: eigenes Muster mit Platzhaltern und Vorschau des nächsten Zeichens (numbering.js)
 * Wird nach 07-konfiguration.js geladen.
 */
'use strict';

CFG_TABS.push(['style', 'Stil & Saison', 'site.edit'], ['promos', 'Rabattaktionen', 'settings.edit'], ['numbering', 'Aktenzeichen', 'settings.edit']);
Object.assign(CFG_TONES, { glass: 'Glas (neutral)', night: 'Nacht-Blau' });

const STYLE_PRESETS = {
  gold: { label: 'Klassisch Gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch' },
  nacht: { label: 'Nacht-Blau', accent: '#7cc4fa', glass: 65, radius: 60, font: 'modern' },
  smaragd: { label: 'Smaragd', accent: '#34d399', glass: 55, radius: 50, font: 'klassisch' },
  bordeaux: { label: 'Bordeaux', accent: '#e8a0b4', glass: 45, radius: 40, font: 'elegant' },
  platin: { label: 'Platin', accent: '#d9dee8', glass: 70, radius: 30, font: 'modern' },
};
const STYLE_FONTS = { klassisch: 'Klassisch', modern: 'Modern', elegant: 'Elegant' };
const STYLE_MOTION = { voll: 'Voll', normal: 'Normal', ruhig: 'Ruhig' };
const SEASON_LABELS = { auto: 'Automatisch (Kalender & Aktionen)', aus: 'Aus', halloween: '🎃 Halloween', weihnachten: '🎄 Weihnachten', silvester: '🎆 Silvester', valentin: '💘 Valentinstag', ostern: '🐣 Ostern & Frühling', sommer: '☀️ Sommer', blackfriday: '🖤 Black Friday', jubilaeum: '🥂 Jubiläum' };
const BANNER_ICONS = ['📢', '⚖️', '🎉', '⚠️', '🎃', '🎄', '🎆', '💘', '🐣', '☀️', '🖤', '🥂'];
const NUM_TOKENS = [
  ['{JJJJ}', 'Jahr (2026)'],
  ['{JJ}', 'Jahr kurz (26)'],
  ['{MM}', 'Monat (10)'],
  ['{BEREICH}', 'Kürzel des Rechtsgebiets (STR)'],
  ['{KUERZEL}', 'Kürzel der Federführung (AP)'],
  ['{NR}', 'laufende Nummer'],
];
const NUM_EXAMPLES = ['PS-{JJJJ}-{NR}', '{BEREICH}-{NR}/{JJ}', 'PS/{KUERZEL}/{NR}', 'AZ {JJ}{MM}-{NR}'];

/* Die neuen Bereiche hängen sich in configPanels() ein */
const cfgPanelsBase = configPanels;
// eslint-disable-next-line no-global-assign
configPanels = function () {
  if (st.cfg && st.cfgTab !== 'style') stylePreviewEnd();
  if (!st.cfg) return cfgPanelsBase();
  const tabs = cfgVisibleTabs();
  const tab = tabs.some(([k]) => k === st.cfgTab) ? st.cfgTab : tabs.length ? tabs[0][0] : '';
  const extra = { style: cfgStyle, promos: cfgPromos, numbering: cfgNumbering }[tab];
  if (!extra) return cfgPanelsBase();
  const nav = `<div class="chip-row mb-4" role="tablist" aria-label="Bereiche">${tabs
    .map(([k, label]) => `<button type="button" class="chip ${tab === k ? 'active' : ''}" role="tab" aria-selected="${tab === k}" data-action="cfg-tab" data-tab="${k}"><span>${esc(label)}${st.cfg.config[k] && st.cfg.config[k].draft ? ' •' : ''}</span></button>`)
    .join('')}</div>`;
  return nav + extra();
};

/* ---------------------------------------------------------------- Banner: Symbol, Countdown, echte Vorschau */
const cfgBannerBase = cfgBanner;
// eslint-disable-next-line no-global-assign
cfgBanner = function () {
  const html = cfgBannerBase();
  const b = cfgWork('banner');
  const extra = `<div><label class="label" for="cfgBIcon">Symbol (optional)</label><input id="cfgBIcon" name="icon" class="field" maxlength="8" value="${esc(b.icon || '')}" placeholder="z. B. 📢">
        <div class="chip-row chip-wrap mt-2">${BANNER_ICONS.map((i) => `<button type="button" class="chip chip-emoji" data-action="banner-icon" data-icon="${i}" aria-label="Symbol ${i}">${i}</button>`).join('')}</div></div>
      <label class="check span-2"><input type="checkbox" name="countdown" ${b.countdown ? 'checked' : ''}> Countdown bis zum Ende zeigen (braucht „Anzeigen bis“)</label>
      <p class="form-hint span-2 flex items-center gap-2">${icon('tag', 'ico-sm')}<span>Läuft eine <button type="button" class="link-btn" data-action="cfg-tab" data-tab="promos">Rabattaktion</button>, erscheint automatisch ein eigenes Aktionsbanner mit Countdown darüber.</span></p>`;
  setTimeout(cfgBannerMount, 0);
  return html.replace('<div class="span-2"><label class="label" for="cfgBLink">', `${extra}<div class="span-2"><label class="label" for="cfgBLink">`);
};
// eslint-disable-next-line no-global-assign
cfgBannerPreview = function (b) {
  return b.text ? '<div id="cfgBannerLiveHost" class="cfg-banner-host"></div>' : '<p class="form-hint">Noch kein Text.</p>';
};
const cfgCollectBannerBase = cfgCollectBanner;
// eslint-disable-next-line no-global-assign
cfgCollectBanner = function (f) {
  const fd = new FormData(f);
  return { ...cfgCollectBannerBase(f), icon: val(fd, 'icon'), countdown: fd.has('countdown') };
};
CFG_COLLECT.banner = (f) => cfgCollectBanner(f);
/** Vorschau = das echte Banner (gleicher Code wie auf der Website), mit laufendem Countdown. */
function cfgBannerMount() {
  const host = $('#cfgBannerLiveHost');
  const f = $('form[data-form="cfg-banner"]');
  if (!host || !f || !PS.siteConfig) return;
  const b = cfgCollectBanner(f);
  const endsAt = b.countdown && b.to ? new Date(`${b.to}T23:59:59`).toISOString() : null;
  PS.siteConfig.banner({ ...b, id: 'preview', endsAt, dismissible: false, link: b.link ? '#' : '' }, host, { before: false, id: 'cfgBannerLive', className: 'cfg-banner-live' });
}

/* ---------------------------------------------------------------- Stil & Saison */
let stylePreviewing = false;
function stylePreview(s) {
  stylePreviewing = true;
  PS.theme && PS.theme.apply(s, { force: true });
}
function stylePreviewEnd() {
  if (!stylePreviewing) return;
  stylePreviewing = false;
  const pub = st.siteConfig && st.siteConfig.style;
  PS.theme && PS.theme.apply(pub || {});
  PS.theme && PS.theme.season(pub && pub.seasonDash === false ? '' : (st.siteConfig && st.siteConfig.season) || '');
}
function cfgStyle() {
  const s = cfgWork('style');
  const preset = (k, p) => `<button type="button" class="style-preset ${s.preset === k ? 'is-on' : ''}" data-action="style-preset" data-preset="${k}" style="--sw:${p.accent}">
      <span class="sp-swatch"><i></i><i></i><i></i></span><span class="sp-name">${esc(p.label)}</span></button>`;
  const seg = (name, map, cur) =>
    `<div class="seg${name === 'font' ? ' seg-fonts' : ''}" role="radiogroup">${Object.entries(map)
      .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${k}" ${cur === k ? 'checked' : ''}><span${name === 'font' ? ` class="font-try font-try-${k}"` : ''}>${esc(l)}</span></label>`)
      .join('')}</div>`;
  setTimeout(() => stylePreview(styleCollect($('form[data-form="cfg-style"]'))), 0);
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Stil &amp; Saison</h2></div>
      <p class="text-sm text-muted mb-4">Farbe, Glas und Form der Website und des Dashboards – jede Änderung sehen Sie sofort hier im Dashboard. Für alle gilt sie erst nach „Veröffentlichen“.</p>
      <form data-form="cfg-style" class="form-grid cols-2">
        <input type="hidden" name="preset" value="${esc(s.preset)}">
        <div class="span-2"><div class="label">Vorlagen</div><div class="style-presets">${Object.entries(STYLE_PRESETS).map(([k, p]) => preset(k, p)).join('')}</div></div>
        <div><label class="label" for="stAccent">Akzentfarbe</label><div class="color-row"><input id="stAccentPick" type="color" value="${esc(s.accent)}" aria-label="Farbe wählen" data-sync="accent"><input id="stAccent" name="accent" class="field font-mono" maxlength="7" value="${esc(s.accent)}" pattern="#[0-9a-fA-F]{6}"></div></div>
        <div><div class="label">Schrift der Überschriften</div>${seg('font', STYLE_FONTS, s.font)}</div>
        <div><label class="label" for="stGlass">Glas <span class="range-val" data-for="stGlass">${s.glass}</span></label><input id="stGlass" name="glass" type="range" min="0" max="100" step="5" value="${s.glass}" class="range"><div class="range-ends"><span>klar</span><span>milchig</span></div></div>
        <div><label class="label" for="stRadius">Rundung <span class="range-val" data-for="stRadius">${s.radius}</span></label><input id="stRadius" name="radius" type="range" min="0" max="100" step="5" value="${s.radius}" class="range"><div class="range-ends"><span>kantig</span><span>rund</span></div></div>
        <div class="span-2"><div class="label">Bewegung für alle</div>${seg('motion', STYLE_MOTION, s.motion)}<p class="form-hint">„Ruhig“ dämpft Animationen für alle, die es nicht selbst eingestellt haben (Mein Profil → Animationen).</p></div>
        <div class="span-2 style-sample" aria-hidden="true">
          <div class="kpi panel"><div class="kpi-label">Offene Akten</div><div class="kpi-value">12</div></div>
          <div class="panel panel-pad"><div class="panel-title">Muster</div><div class="chip-row mt-2"><span class="chip active"><span>Aktiv</span></span><span class="chip"><span>Chip</span></span></div><div class="form-actions mt-3"><span class="btn-gold btn-sm">Speichern</span><span class="btn-outline btn-sm">Abbrechen</span></div></div>
        </div>
        <div class="span-2"><h3 class="label mt-2">Saison-Deko</h3>
          <div class="form-grid cols-2">
            <div><label class="label" for="stSeason">Saison</label><select id="stSeason" name="season" class="field">${Object.entries(SEASON_LABELS).map(([k, l]) => opt(k, l, s.season === k)).join('')}</select>
              <p class="form-hint">Automatisch: Halloween (20.10.–1.11.), Weihnachten (ab 1.12.), Silvester, Valentinstag, Ostern – und während einer Rabattaktion deren Anlass.</p></div>
            <div><label class="check mt-6"><input type="checkbox" name="seasonDash" ${s.seasonDash ? 'checked' : ''}> Auch im Dashboard (dezenter)</label></div>
            <div class="span-2"><div class="label">Ansehen</div><div class="chip-row chip-wrap"><button type="button" class="chip" data-action="season-try" data-season=""><span>Ohne Deko</span></button>${Object.entries(SEASON_LABELS)
              .filter(([k]) => k !== 'auto' && k !== 'aus')
              .map(([k, l]) => `<button type="button" class="chip" data-action="season-try" data-season="${k}"><span>${esc(l)}</span></button>`)
              .join('')}</div></div>
          </div>
        </div>
        <div class="span-2">${cfgBar('style', `<a class="btn-ghost btn-md" href="/?vorschau=1" target="_blank" rel="noopener">${icon('globe', 'ico-sm')}<span>Website mit Entwurf</span></a>`)}</div>
      </form>
    </section>`;
}
function styleCollect(f) {
  if (!f) return cfgWork('style');
  const fd = new FormData(f);
  const accent = /^#[0-9a-f]{6}$/i.test(val(fd, 'accent')) ? val(fd, 'accent').toLowerCase() : '#d4af37';
  return {
    preset: val(fd, 'preset') || 'eigen',
    accent,
    glass: Number(val(fd, 'glass') || 50),
    radius: Number(val(fd, 'radius') || 50),
    font: val(fd, 'font') || 'klassisch',
    motion: val(fd, 'motion') || 'normal',
    season: val(fd, 'season') || 'auto',
    seasonDash: fd.has('seasonDash'),
  };
}
CFG_COLLECT.style = styleCollect;

/* ---------------------------------------------------------------- Aktenzeichen */
function cfgNumbering() {
  const n = cfgWork('numbering');
  setTimeout(numberingPreview, 0);
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Aktenzeichen</h2></div>
      <p class="text-sm text-muted mb-4">Wie neue Akten heißen. Bestehende Akten behalten ihr Zeichen. Die laufende Nummer zählt je Muster: mit Jahr beginnt sie jedes Jahr neu, mit Rechtsgebiet zählt jedes Gebiet für sich.</p>
      <form data-form="cfg-numbering" class="form-grid cols-2">
        <div class="span-2"><label class="label" for="numPattern">Muster</label><input id="numPattern" name="pattern" class="field font-mono num-pattern" maxlength="40" value="${esc(n.pattern)}" autocomplete="off" spellcheck="false">
          <div class="chip-row chip-wrap mt-2">${NUM_TOKENS.map(([t, l]) => `<button type="button" class="chip" data-action="num-token" data-token="${t}" title="${esc(l)}"><span class="font-mono">${t}</span></button>`).join('')}</div></div>
        <div><label class="label" for="numDigits">Stellen der Nummer</label><input id="numDigits" name="digits" type="number" min="2" max="6" value="${n.digits}" class="field"></div>
        <div><div class="label">Nächstes Aktenzeichen</div><div class="num-preview" id="numPreview" aria-live="polite"><span class="num-plate">…</span></div></div>
        <div class="span-2"><div class="label">Beispiele</div><div class="chip-row chip-wrap">${NUM_EXAMPLES.map((p) => `<button type="button" class="chip" data-action="num-example" data-pattern="${esc(p)}"><span class="font-mono">${esc(p)}</span></button>`).join('')}</div>
          <p class="form-hint">${NUM_TOKENS.map(([t, l]) => `<code>${t}</code> ${esc(l)}`).join(' · ')}. Erlaubt sind außerdem Buchstaben, Ziffern und <code>- / . _</code>.</p></div>
        <div class="span-2">${cfgBar('numbering')}</div>
      </form>
    </section>`;
}
function numberingCollect(f) {
  const fd = new FormData(f);
  return { pattern: val(fd, 'pattern'), digits: Number(val(fd, 'digits') || 4) };
}
CFG_COLLECT.numbering = numberingCollect;
let numTimer = 0;
function numberingPreview() {
  clearTimeout(numTimer);
  numTimer = setTimeout(async () => {
    const f = $('form[data-form="cfg-numbering"]');
    const box = $('#numPreview');
    if (!f || !box) return;
    const n = numberingCollect(f);
    try {
      const r = await api.get(`/api/config/numbering/preview?pattern=${encodeURIComponent(n.pattern)}&digits=${n.digits}`);
      box.innerHTML = `<span class="num-plate is-ok">${esc(r.next)}</span>`;
      box.firstElementChild.animate && !PS.motion.calm() && box.firstElementChild.animate([{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: 220, easing: 'ease-out' });
    } catch (err) {
      box.innerHTML = `<span class="num-plate is-bad">${esc(err.message)}</span>`;
    }
  }, 220);
}

/* ---------------------------------------------------------------- Rabattaktionen */
async function loadPromos() {
  st.promos = await api.get('/api/promotions');
}
const promoDay = (d) => (d ? fmtDateOnly(d) : '');
function promoState(p) {
  if (!p.active) return badge('Pausiert', 'slate');
  if (p.running) return `<span class="badge badge-emerald promo-live"><i class="live-dot"></i>Läuft jetzt</span>`;
  if (p.next) return badge(`Startet ${promoDay(p.next)}`, 'sky');
  return badge('Beendet', 'slate');
}
function promoCard(p) {
  const period = p.yearly ? `jedes Jahr ${p.occasion === 'ostern' ? 'Karfreitag bis Ostermontag' : p.occasion === 'blackfriday' ? 'Black Friday bis Cyber Monday' : `${promoDay(p.from).slice(0, 6)} – ${promoDay(p.to).slice(0, 6)}`}` : `${promoDay(p.startsOn)} – ${promoDay(p.endsOn)}`;
  return `<article class="promo-card occ-${esc(p.occasion)} ${p.running ? 'is-running' : ''} ${p.active ? '' : 'is-paused'}">
      <div class="promo-icon" aria-hidden="true">${esc(p.icon)}</div>
      <div class="promo-main">
        <div class="promo-top"><strong>${esc(p.name)}</strong>${promoState(p)}</div>
        <div class="text-xs text-dim">${esc(p.occasionLabel)} · ${esc(period)}${p.announce ? ' · im Banner angekündigt' : ''}</div>
        ${p.message ? `<div class="text-sm text-muted mt-1">${esc(p.message)}</div>` : ''}
      </div>
      <div class="promo-pct">−${esc(String(p.pct).replace('.', ','))}&nbsp;%</div>
      <div class="promo-acts">
        <button type="button" class="icon-btn sm" data-action="promo-edit" data-id="${p.id}" aria-label="Bearbeiten" title="Bearbeiten">${icon('edit', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="promo-toggle" data-id="${p.id}" aria-label="${p.active ? 'Pausieren' : 'Fortsetzen'}" title="${p.active ? 'Pausieren' : 'Fortsetzen'}">${icon(p.active ? 'pauseIco' : 'play', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="promo-delete" data-id="${p.id}" aria-label="Löschen" title="Löschen">${icon('trash', 'ico-sm')}</button>
      </div>
    </article>`;
}
function cfgPromos() {
  if (!st.promos) {
    loadPromos().then(() => st.cfgTab === 'promos' && renderView());
    return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  }
  const { promotions, current } = st.promos;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Rabattaktionen</h2><button type="button" class="btn-gold btn-sm" data-action="promo-new">${icon('plus', 'ico-sm')}<span>Neue Aktion</span></button></div>
      <p class="text-sm text-muted mb-4">Ein Rabatt für <strong>alle</strong> zu einem Anlass – z. B. Halloween −15 %. Im Zeitraum zieht jede neue Rechnung ihn automatisch ab, der Tarifrechner der Website rechnet ihn ein und ein Aktionsbanner mit Countdown kündigt ihn an. Laufen zwei gleichzeitig, gilt die höhere.</p>
      ${current ? `<div class="promo-now occ-${esc(current.occasion)}"><span class="promo-now-icon">${esc(current.icon)}</span><div><div class="text-xs uppercase tracking-[0.18em] text-dim">Gerade aktiv</div><strong>${esc(current.name)} · −${esc(String(current.pct).replace('.', ','))} %</strong><div class="text-xs text-dim">bis ${esc(promoDay(current.to))}</div></div></div>` : ''}
      <div class="promo-list">${promotions.length ? promotions.map(promoCard).join('') : empty('Noch keine Aktion. Wie wäre es mit Halloween oder Weihnachten?', 'tag', '<button type="button" class="btn-outline btn-sm" data-action="promo-new" data-occasion="halloween">🎃 Halloween anlegen</button>')}</div>
    </section>`;
}
function promoForm(p) {
  const occ = st.promos.occasions;
  const today = st.promos.today;
  const v = p || { name: '', pct: 10, occasion: 'eigen', startsOn: today, endsOn: today, yearly: false, announce: true, message: '', active: true };
  return `<p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Rabattaktion</p>
      <h2 class="modal-title">${p ? 'Aktion bearbeiten' : 'Neue Aktion'}</h2>
      <form data-form="promo-save" data-id="${p ? p.id : ''}" class="form-grid cols-2">
        <div class="span-2"><div class="label">Anlass</div><div class="occ-grid">${occ
          .map((o) => `<label class="occ-opt"><input type="radio" name="occasion" value="${o.key}" ${v.occasion === o.key ? 'checked' : ''}><span class="occ-ico">${esc(o.icon)}</span><span>${esc(o.label)}</span></label>`)
          .join('')}</div></div>
        <div><label class="label" for="prName">Name</label><input id="prName" name="name" class="field" maxlength="80" required value="${esc(v.name)}" placeholder="z. B. Halloween-Aktion"></div>
        <div><label class="label" for="prPct">Rabatt in %</label><input id="prPct" name="pct" type="number" min="1" max="90" step="1" required class="field" value="${esc(v.pct)}"></div>
        <div><label class="label" for="prFrom">Von</label><input id="prFrom" name="startsOn" type="date" required class="field" value="${esc(v.startsOn)}"></div>
        <div><label class="label" for="prTo">Bis (einschließlich)</label><input id="prTo" name="endsOn" type="date" required class="field" value="${esc(v.endsOn)}"></div>
        <label class="check span-2"><input type="checkbox" name="yearly" ${v.yearly ? 'checked' : ''}> Jedes Jahr wiederholen <span class="text-dim">(Ostern und Black Friday rechnen ihr Datum selbst aus)</span></label>
        <label class="check span-2"><input type="checkbox" name="announce" ${v.announce ? 'checked' : ''}> Im Banner ankündigen (mit Countdown, auf Website und im Mandantenportal)</label>
        <div class="span-2"><label class="label" for="prMsg">Text im Banner (optional)</label><input id="prMsg" name="message" class="field" maxlength="200" value="${esc(v.message)}" placeholder="z. B. Gruselig günstig: 15 % auf alle Leistungen bis Halloween!"></div>
        <label class="check span-2"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Aktiv</label>
        <div class="span-2 cfg-live"><div class="label">So sieht das Banner aus</div><div id="promoPreview" class="cfg-banner-host"></div></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`;
}
function promoCollect(f) {
  const fd = new FormData(f);
  return {
    name: val(fd, 'name'),
    pct: Number(val(fd, 'pct') || 0),
    occasion: val(fd, 'occasion') || 'eigen',
    startsOn: val(fd, 'startsOn'),
    endsOn: val(fd, 'endsOn'),
    yearly: fd.has('yearly'),
    announce: fd.has('announce'),
    message: val(fd, 'message'),
    active: fd.has('active'),
  };
}
function promoPreview() {
  const f = $('form[data-form="promo-save"]');
  const host = $('#promoPreview');
  if (!f || !host || !PS.siteConfig) return;
  const p = promoCollect(f);
  const o = st.promos.occasions.find((x) => x.key === p.occasion) || { icon: '🏷️' };
  const pct = String(p.pct || 0).replace('.', ',');
  PS.siteConfig.banner(
    { id: 'promo-preview', promo: true, tone: 'promo', occasion: p.occasion, icon: o.icon, pct: p.pct || 0, title: p.name || 'Aktion', sub: p.message || `${pct} % auf alle Leistungen – wird automatisch abgezogen.`, text: p.message || '', endsAt: p.endsOn ? new Date(`${p.endsOn}T23:59:59`).toISOString() : null, link: '#', linkLabel: 'Jetzt berechnen', dismissible: false },
    host,
    { before: false, id: 'promoPreviewBanner' }
  );
}
/** Anlass gewählt: Name, Zeitraum und Text vorschlagen (nur, solange die Felder noch nicht selbst ausgefüllt sind). */
function promoApplyOccasion(f, key) {
  const o = st.promos.occasions.find((x) => x.key === key);
  if (!o) return;
  const year = Number(st.promos.today.slice(0, 4));
  const pick = (md) => {
    let d = `${year}-${md}`;
    if (d < st.promos.today && md) d = `${year + 1}-${md}`;
    return d;
  };
  if (!f.elements.name.value || f.elements.name.dataset.auto) {
    f.elements.name.value = o.key === 'eigen' ? '' : `${o.label}-Aktion`;
    f.elements.name.dataset.auto = '1';
  }
  if (o.from && o.to) {
    const from = pick(o.from);
    let to = `${from.slice(0, 4)}-${o.to}`;
    if (to < from) to = `${Number(from.slice(0, 4)) + 1}-${o.to}`;
    // läuft der Anlass gerade schon, ab heute
    const thisYear = `${year}-${o.from}`;
    const thisEnd = o.to < o.from ? `${year + 1}-${o.to}` : `${year}-${o.to}`;
    const running = st.promos.today >= thisYear && st.promos.today <= thisEnd;
    f.elements.startsOn.value = running ? st.promos.today : from;
    f.elements.endsOn.value = running ? thisEnd : to;
  }
  f.elements.yearly.checked = o.key !== 'eigen' && o.key !== 'jubilaeum';
}

/* ---------------------------------------------------------------- Aktionen */
Object.assign(actions, {
  'banner-icon': (el) => {
    const f = el.closest('form');
    f.elements.icon.value = f.elements.icon.value === el.dataset.icon ? '' : el.dataset.icon;
    cfgBannerMount();
  },
  'style-preset': (el) => {
    const f = el.closest('form');
    const p = STYLE_PRESETS[el.dataset.preset];
    f.elements.preset.value = el.dataset.preset;
    f.elements.accent.value = p.accent;
    $('#stAccentPick').value = p.accent;
    f.elements.glass.value = p.glass;
    f.elements.radius.value = p.radius;
    f.querySelectorAll('input[name="font"]').forEach((r) => (r.checked = r.value === p.font));
    $$('.style-preset', f).forEach((b) => b.classList.toggle('is-on', b === el));
    styleSync(f);
  },
  'season-try': (el) => {
    stylePreviewing = true;
    PS.season && PS.season.set(el.dataset.season);
    $$('[data-action="season-try"]').forEach((b) => b.classList.toggle('active', b === el && !!el.dataset.season));
  },
  'num-token': (el) => {
    const input = $('#numPattern');
    const at = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, at) + el.dataset.token + input.value.slice(input.selectionEnd ?? at);
    input.focus();
    input.setSelectionRange(at + el.dataset.token.length, at + el.dataset.token.length);
    numberingPreview();
  },
  'num-example': (el) => {
    $('#numPattern').value = el.dataset.pattern;
    numberingPreview();
  },
  'promo-new': (el) => {
    openModal(promoForm(null), { wide: true });
    const f = $('form[data-form="promo-save"]');
    if (el.dataset.occasion) {
      f.querySelector(`input[name="occasion"][value="${el.dataset.occasion}"]`).checked = true;
      promoApplyOccasion(f, el.dataset.occasion);
    }
    promoPreview();
  },
  'promo-edit': (el) => {
    const p = st.promos.promotions.find((x) => x.id === Number(el.dataset.id));
    if (!p) return;
    openModal(promoForm(p), { wide: true });
    promoPreview();
  },
  'promo-toggle': async (el) => {
    const p = st.promos.promotions.find((x) => x.id === Number(el.dataset.id));
    if (!p) return;
    st.promos = await api.put(`/api/promotions/${p.id}`, { name: p.name, pct: p.pct, occasion: p.occasion, startsOn: p.startsOn, endsOn: p.endsOn, yearly: p.yearly, announce: p.announce, message: p.message, active: !p.active });
    toast(p.active ? 'Aktion pausiert.' : 'Aktion läuft wieder.');
    await refreshSiteConfig();
    renderView();
  },
  'promo-delete': async (el) => {
    const p = st.promos.promotions.find((x) => x.id === Number(el.dataset.id));
    if (!p || !(await ask(`„${p.name}“ wird gelöscht. Bereits erstellte Rechnungen behalten ihren Aktionsrabatt.`, { title: 'Aktion löschen?', confirmText: 'Löschen', danger: true }))) return;
    st.promos = await api.del(`/api/promotions/${p.id}`);
    toast('Aktion gelöscht.');
    await refreshSiteConfig();
    renderView();
  },
});

Object.assign(forms, {
  'cfg-style': async (f) => {
    await cfgSave('style', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
  'cfg-numbering': async (f) => {
    await cfgSave('numbering', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
  'promo-save': async (f) => {
    const id = f.dataset.id;
    const body = promoCollect(f);
    st.promos = id ? await api.put(`/api/promotions/${id}`, body) : await api.post('/api/promotions', body);
    closeModal();
    await refreshSiteConfig();
    toast(id ? 'Aktion gespeichert.' : 'Aktion angelegt.');
    renderView();
    const fresh = st.promos.promotions.find((p) => (id ? p.id === Number(id) : p.id === st.promos.id));
    if (fresh && fresh.running && PS.confetti) PS.confetti(innerWidth / 2, innerHeight / 3, { count: 40 });
  },
});

/** Regler und Farbe: Zahlen neben den Reglern, Farbfeld ↔ Text, Vorschau im ganzen Dashboard. */
function styleSync(f) {
  $$('.range-val', f).forEach((s) => (s.textContent = $(`#${s.dataset.for}`).value));
  stylePreview(styleCollect(f));
}
document.addEventListener('input', (e) => {
  const t = e.target;
  const f = t.closest && t.closest('form[data-form="cfg-style"], form[data-form="cfg-numbering"], form[data-form="promo-save"], form[data-form="cfg-banner"]');
  if (!f) return;
  if (f.dataset.form === 'cfg-style') {
    if (t.dataset.sync === 'accent') f.elements.accent.value = t.value;
    else if (t.name === 'accent' && /^#[0-9a-f]{6}$/i.test(t.value)) $('#stAccentPick').value = t.value;
    if (['accent', 'glass', 'radius', 'font'].includes(t.name) || t.dataset.sync) {
      f.elements.preset.value = 'eigen';
      $$('.style-preset', f).forEach((b) => b.classList.remove('is-on'));
    }
    styleSync(f);
  } else if (f.dataset.form === 'cfg-numbering') numberingPreview();
  else if (f.dataset.form === 'promo-save') {
    if (t.name === 'name') delete t.dataset.auto;
    promoPreview();
  } else cfgBannerMount();
});
document.addEventListener('change', (e) => {
  const f = e.target.closest && e.target.closest('form[data-form="cfg-style"], form[data-form="cfg-banner"], form[data-form="promo-save"]');
  if (!f) return;
  if (f.dataset.form === 'cfg-style') {
    styleSync(f);
    if (e.target.name === 'season' || e.target.name === 'seasonDash') {
      const se = styleCollect(f);
      stylePreviewing = true;
      PS.season && PS.season.set(!se.seasonDash || se.season === 'aus' ? '' : se.season === 'auto' ? (st.siteConfig && st.siteConfig.season) || '' : se.season);
    }
  } else if (f.dataset.form === 'cfg-banner') cfgBannerMount();
  else {
    if (e.target.name === 'occasion') promoApplyOccasion(f, e.target.value);
    promoPreview();
  }
});
