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
  function banner(b, host, { before = true, className = '' } = {}) {
    document.getElementById('siteBanner')?.remove();
    if (!b || !host) return;
    let hidden = false;
    try {
      hidden = b.dismissible && sessionStorage.getItem(`ps-banner-${b.id}`) === '1';
    } catch {
      /* ohne Speicher: immer zeigen */
    }
    if (hidden) return;
    const el = document.createElement('div');
    el.id = 'siteBanner';
    el.className = `site-banner tone-${b.tone} ${className}`.trim();
    el.setAttribute('role', 'status');
    const link = b.link ? `<a class="site-banner-link" href="${esc(b.link)}"${/^https?:/i.test(b.link) ? ' target="_blank" rel="noopener"' : ''}>${esc(b.linkLabel || 'Mehr erfahren')} →</a>` : '';
    el.innerHTML = `<span class="site-banner-text">${esc(b.text)}</span>${link}${b.dismissible ? '<button type="button" class="site-banner-x" aria-label="Hinweis schließen">×</button>' : ''}`;
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
    labels(el);
  }

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
    if (page === 'site') {
      banner(cfg.banner, document.querySelector('.topstrip') || document.body.firstElementChild);
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

  PS.siteConfig = { apply, labels, banner, observe, setLabels, hintsIn, setHintMode, isOn: () => labelsOn };

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
