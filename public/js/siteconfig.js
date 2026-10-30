/*
 * Konfiguration aus dem Dashboard (Einstellungen → Texte & Banner): Banner, Startseite (Abschnitte, FAQ, Links, Kennzahlen),
 * Beschriftungen und Hinweise. Gilt für Website, Karriere und Dashboard; ohne Konfiguration sieht alles aus wie bisher.
 *   PS.siteConfig.apply(cfg, { page })   alles anwenden (cfg = { banner, home, labels })
 *   PS.siteConfig.labels(root)           Begriffe und Hinweise in einem Teil der Seite ersetzen (Dashboard: nach jedem Zeichnen)
 */
(() => {
  'use strict';
  const PS = window.PS;
  if (!PS) return;
  const esc = PS.esc;

  /* ---------------------------------------------------------------- Beschriftungen */
  // Begriffe: Mehrzahl zuerst; „compounds“ = auch Zusammensetzungen (Mandantenkonto → Klientenkonto)
  const TERMS = {
    mandant: { sg: 'Mandant', pl: 'Mandanten', compounds: true },
    akte: { sg: 'Akte', pl: 'Akten', compounds: false },
    anwalt: { sg: 'Anwalt', pl: 'Anwälte', compounds: false },
    rechnung: { sg: 'Rechnung', pl: 'Rechnungen', compounds: false },
  };
  let rules = []; // [[RegExp, ersetzen]]
  let hints = {};
  let labelsOn = false;
  let editing = false; // „Hinweise bearbeiten“ im Dashboard: jeder Hinweis bekommt seinen Schlüssel

  function setLabels(cfg) {
    const terms = (cfg && cfg.terms) || {};
    hints = (cfg && cfg.hints) || {};
    rules = [];
    for (const [key, t] of Object.entries(terms)) {
      const base = TERMS[key];
      if (!base || !t) continue;
      const tail = base.compounds ? '(?=[a-zäöüß]*(?![a-zäöüß]))' : '(?![a-zäöüß])';
      if (t.pl && t.pl !== base.pl) rules.push([new RegExp(`(?<![A-Za-zÄÖÜäöüß])${base.pl}${tail}`, 'g'), t.pl]);
      if (t.sg && t.sg !== base.sg) rules.push([new RegExp(`(?<![A-Za-zÄÖÜäöüß])${base.sg}(?!en)${base.compounds ? '' : '(?![a-zäöüß])'}`, 'g'), t.sg]);
    }
    labelsOn = rules.length > 0 || Object.keys(hints).length > 0;
  }
  const replaceTerms = (text) => rules.reduce((s, [re, to]) => s.replace(re, to), text);

  const SKIP = 'script, style, textarea, input, code, pre, [data-nolabels], .case-number, .mono';
  function walk(root) {
    if (!rules.length || !root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest(SKIP)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const next = replaceTerms(n.nodeValue);
      if (next !== n.nodeValue) n.nodeValue = next;
    }
    for (const el of root.querySelectorAll ? root.querySelectorAll('[placeholder], [title], [aria-label]') : []) {
      for (const a of ['placeholder', 'title', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v) {
          const next = replaceTerms(v);
          if (next !== v) el.setAttribute(a, next);
        }
      }
    }
  }

  /** Schlüssel eines Hinweises: Formular.Feld (z. B. „settings-firm.firmSeat“) – das erste Feld im selben Block. */
  function hintKey(hint) {
    const form = hint.closest('form');
    const block = hint.parentElement;
    const field = block && block.querySelector('input[name], select[name], textarea[name]');
    if (!form || !field) return null;
    return `${form.dataset.form || form.id || 'form'}.${field.name}`;
  }
  function hintsIn(root) {
    if (!root || !root.querySelectorAll) return;
    for (const h of root.querySelectorAll('.form-hint')) {
      const key = hintKey(h);
      if (!key) continue;
      h.dataset.hintKey = key;
      if (hints[key] !== undefined && h.dataset.hintDone !== hints[key]) {
        h.textContent = hints[key];
        h.dataset.hintDone = hints[key];
      }
    }
  }
  function labels(root = document.body) {
    if (!labelsOn && !editing) return;
    walk(root);
    hintsIn(root);
  }

  /* Dashboard: neu Gezeichnetes laufend anpassen */
  let queued = false;
  const pending = new Set();
  function observe(...roots) {
    const obs = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
      if (queued || !pending.size || (!labelsOn && !editing)) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const batch = [...pending];
        pending.clear();
        for (const n of batch) if (n.isConnected) labels(n);
      });
    });
    for (const r of roots) if (r) obs.observe(r, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------- Banner */
  // Glasleiste mit Symbol, Text, Countdown und Knopf. Eine laufende Rabattaktion bekommt ihr eigenes Banner
  // (Plakette „−15 %“, Farben des Anlasses) über dem normalen Banner.
  const pad2 = (n) => String(n).padStart(2, '0');
  function countdownHtml(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const parts = [d ? `<b>${d}</b><i>T</i>` : '', `<b>${pad2(Math.floor((s % 86400) / 3600))}</b><i>:</i><b>${pad2(Math.floor((s % 3600) / 60))}</b><i>:</i><b>${pad2(s % 60)}</b>`];
    return parts.join('');
  }
  function tickCountdown(el, endsAt) {
    const box = el.querySelector('.sb-count');
    if (!box) return;
    const end = Date.parse(endsAt);
    const step = () => {
      if (!el.isConnected) return clearInterval(timer);
      const left = end - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        el.classList.add('is-leaving');
        return setTimeout(() => el.remove(), 220);
      }
      const html = countdownHtml(left);
      if (box.dataset.html === html) return;
      // Ziffern, die sich ändern, kippen kurz (die anderen bleiben ruhig)
      const old = [...box.querySelectorAll('b')].map((b) => b.textContent);
      box.innerHTML = html;
      box.dataset.html = html;
      box.querySelectorAll('b').forEach((b, i) => old[i] !== undefined && old[i] !== b.textContent && b.classList.add('flip'));
    };
    const timer = setInterval(step, 1000);
    step();
  }
  function banner(b, host, { before = true, className = '', id = 'siteBanner' } = {}) {
    document.getElementById(id)?.remove();
    if (!b || !host) return;
    let hidden = false;
    try {
      hidden = b.dismissible && sessionStorage.getItem(`ps-banner-${b.id}`) === '1';
    } catch {
      /* ohne Speicher: immer zeigen */
    }
    if (hidden) return;
    const el = document.createElement('div');
    el.id = id;
    el.className = `site-banner tone-${b.tone}${b.promo ? ` is-promo occ-${b.occasion}` : ''}${b.endsAt ? ' has-count' : ''} ${className}`.trim();
    el.setAttribute('role', 'status');
    const ext = b.link && /^https?:/i.test(b.link);
    const link = b.link ? `<a class="site-banner-link sb-cta" href="${esc(b.link)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(b.linkLabel || 'Mehr erfahren')}<span aria-hidden="true">→</span></a>` : '';
    const pct = b.promo ? `<span class="sb-pct" aria-label="${esc(String(b.pct).replace('.', ','))} Prozent Rabatt">−${esc(String(b.pct).replace('.', ','))}&nbsp;%</span>` : '';
    const count = b.endsAt ? `<span class="sb-count" title="Endet am ${esc(new Date(b.endsAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}" aria-label="Endet in"></span>` : '';
    el.innerHTML = `<span class="sb-shine" aria-hidden="true"></span>${b.icon ? `<span class="sb-icon" aria-hidden="true">${esc(b.icon)}</span>` : ''}${pct}<span class="site-banner-text">${esc(b.text)}</span>${count}${link}${
      b.dismissible ? '<button type="button" class="site-banner-x" aria-label="Hinweis schließen">×</button>' : ''
    }`;
    el.querySelector('.site-banner-x')?.addEventListener('click', () => {
      try {
        sessionStorage.setItem(`ps-banner-${b.id}`, '1');
      } catch {
        /* egal */
      }
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    });
    if (before) host.before(el);
    else host.prepend(el);
    if (b.endsAt) tickCountdown(el, b.endsAt);
    labels(el);
    return el;
  }
  /** Normales Banner und Aktionsbanner zusammen (das Aktionsbanner steht oben). */
  function banners(cfg, host, opts = {}) {
    if (!cfg) return;
    banner(cfg.banner, host, { ...opts, id: 'siteBanner' });
    const promo = banner(cfg.promoBanner, host, { ...opts, id: 'promoBanner' });
    const plain = document.getElementById('siteBanner');
    if (promo && plain) plain.before(promo);
  }

  /* ---------------------------------------------------------------- Stil: Akzentfarbe, Glas, Rundung, Schrift */
  // Gleiche Rechnung wie theme.js auf dem Server – für die Vorschau beim Schieben der Regler und für Seiten aus dem
  // Zwischenspeicher. Setzt die Variablen als Inline-Stil auf <html>.
  const THEME_DEFAULTS = { accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal' };
  function themeVars(style) {
    const s = { ...THEME_DEFAULTS, ...style };
    const hex = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : THEME_DEFAULTS.accent;
    const acc = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (b, t) => acc.map((v, i) => Math.round(v + (b[i] - v) * t));
    const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const light = mix([255, 255, 255], 0.6);
    const dark = mix([0, 0, 0], 0.14);
    const g = Number(s.glass);
    const blur = Math.round(8 + g * 0.28);
    const sat = (1.15 + g * 0.006).toFixed(2);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const v = {
      '--gold-500': toHex(acc),
      '--gold-600': toHex(dark),
      '--gold-light': toHex(light),
      '--accent-rgb': acc.join(', '),
      '--accent-light-rgb': light.join(', '),
      '--accent-dark-rgb': dark.join(', '),
      '--gold-hairline': `rgba(${acc.join(', ')}, 0.35)`,
      '--gold-soft': `rgba(${acc.join(', ')}, 0.1)`,
      '--gold-glow': `rgba(${acc.join(', ')}, 0.25)`,
      '--lit-gold': `rgba(${acc.join(', ')}, 0.16)`,
      '--glass-blur': `blur(${mobile ? Math.round(blur * 0.73) : blur}px) saturate(${sat})`,
      '--glass-fill': `rgba(9, 16, 36, ${(0.9 - g * 0.004).toFixed(3)})`,
      '--glass-fill-strong': `rgba(8, 14, 32, ${(0.95 - g * 0.0026).toFixed(3)})`,
      '--panel-alpha': (0.9 - g * 0.0032).toFixed(3),
      '--radius': `${Math.round(4 + Number(s.radius) * 0.28)}px`,
    };
    if (s.font === 'modern') v['--font-display'] = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    return v;
  }
  let themed = [];
  function applyTheme(style, { force = false } = {}) {
    const root = document.documentElement;
    themed.forEach((k) => root.style.removeProperty(k));
    themed = [];
    if (!style) return;
    const s = { ...THEME_DEFAULTS, ...style };
    const plain = s.accent.toLowerCase() === THEME_DEFAULTS.accent && +s.glass === 50 && +s.radius === 50 && s.font === 'klassisch';
    // Der Server setzt den Stil schon beim Ausliefern ein (<style id="psTheme">); hier zieht die Seite nach, wenn er sich
    // seitdem geändert hat (gerade veröffentlicht, Vorschau, Seite aus dem Zwischenspeicher)
    if (plain && !force) document.getElementById('psTheme')?.remove();
    else {
      for (const [k, val] of Object.entries(themeVars(s))) {
        root.style.setProperty(k, val);
        themed.push(k);
      }
    }
    if (s.font !== 'klassisch') root.dataset.font = s.font;
    else delete root.dataset.font;
  }
  /** Saison aus der Konfiguration (falls die Seite aus dem Zwischenspeicher kam und noch die alte zeigt). */
  function applySeason(season) {
    if (season === undefined || !PS.season) return;
    if ((document.documentElement.dataset.season || '') !== (season || '')) PS.season.set(season || '');
  }
  PS.theme = { vars: themeVars, apply: applyTheme, season: applySeason };

  /* ---------------------------------------------------------------- Startseite */
  const FEATURE_SECTION = { vip: 'vip', stimmen: 'reviews', karriere: 'karriere' };
  function applyHome(h, features = {}) {
    const main = document.getElementById('start');
    if (!main || !h) return;
    // Reihenfolge: die genannten Abschnitte tauschen nur untereinander die Plätze
    const found = h.order.map((id) => document.getElementById(id)).filter((el) => el && el.parentElement === main);
    const slots = [...found].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (found.length === slots.length && found.some((el, i) => el !== slots[i])) {
      const anchors = slots.map((el) => {
        const m = document.createComment('slot');
        el.before(m);
        return m;
      });
      found.forEach((el, i) => anchors[i].after(el));
      anchors.forEach((m) => m.remove());
    }
    const off = new Set(h.hidden);
    for (const [id, f] of Object.entries(FEATURE_SECTION)) if (features[f] === false) off.add(id);
    for (const id of off) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
      document.querySelectorAll(`a[href="#${id}"]`).forEach((a) => (a.style.display = 'none'));
    }
    // Fragen & Antworten
    const faq = document.querySelector('#faq .glass-card');
    if (faq && h.faq && h.faq.length) {
      faq.innerHTML = h.faq
        .map(
          (f) => `<div class="faq-item" data-act="faq">
            <button class="w-full flex items-center justify-between py-5 text-left" aria-expanded="false"><span class="font-medium text-white text-base pr-4">${esc(f.q)}</span>
              <svg class="faq-icon w-5 h-5 text-[var(--gold-500)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg></button>
            <div class="faq-answer"><p class="text-sm text-[var(--text-muted)] pb-5 leading-relaxed pr-8">${esc(f.a)}</p></div></div>`
        )
        .join('');
    }
    // Kontakt: E-Mail-Adresse und weitere Links (Discord, Instagram …)
    const btn = document.getElementById('emailCopyBtn');
    if (btn && h.contactEmail) {
      btn.dataset.email = h.contactEmail;
      btn.textContent = `${h.contactEmail} kopieren`;
    }
    const kontakt = document.querySelector('#kontakt .glass-card');
    document.getElementById('siteLinks')?.remove();
    if (kontakt && h.links && h.links.length) {
      const row = document.createElement('div');
      row.id = 'siteLinks';
      row.className = 'site-links';
      row.innerHTML = h.links.map((l) => `<a href="${esc(l.url)}"${/^https?:/i.test(l.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('');
      kontakt.appendChild(row);
    }
    PS.kpis = h.kpis;
    window.dispatchEvent(new CustomEvent('ps:kpis'));
  }

  /* ---------------------------------------------------------------- Anwenden */
  function apply(cfg, { page = 'site', features = {}, preview = false } = {}) {
    if (!cfg) return;
    setLabels(cfg.labels);
    applyTheme(cfg.style, { force: !!preview });
    applySeason(cfg.season);
    PS.promo = cfg.promo || null;
    window.dispatchEvent(new CustomEvent('ps:promo'));
    if (page === 'site') {
      banners(cfg, document.querySelector('.topstrip') || document.body.firstElementChild);
      if (document.getElementById('start')) applyHome(cfg.home, features);
      if (preview) {
        const r = document.createElement('div');
        r.className = 'site-preview';
        r.innerHTML = 'Vorschau – so sieht die Seite mit dem <strong>Entwurf</strong> aus. <a href="/dashboard#settings">Zurück zu den Einstellungen</a>';
        document.body.prepend(r);
      }
    }
    labels(document.body);
  }

  function setHintMode(on) {
    editing = !!on;
    document.body.classList.toggle('hint-edit', editing);
    if (editing) hintsIn(document.body);
  }

  PS.siteConfig = { apply, labels, banner, banners, observe, setLabels, hintsIn, setHintMode, isOn: () => labelsOn };

  /* Website und Karriere laden sich selbst; das Dashboard ruft apply() mit der Konfiguration aus /api/auth/me auf */
  if (document.querySelector('#start, #careerPage, body[data-page="karriere"]') || location.pathname.startsWith('/karriere')) {
    const preview = /[?&]vorschau\b/.test(location.search);
    PS.boot('session', '/api/auth/session')
      .then(async (r) => {
        let cfg = r && r.siteConfig;
        if (preview) cfg = await PS.api.get('/api/public/site-config?draft=1').catch(() => cfg);
        apply(cfg, { features: (r && r.features) || {}, preview: preview && !!(cfg && cfg.draft) });
        if (document.getElementById('start')) observe(document.getElementById('start'));
      })
      .catch(() => {});
  }
})();
