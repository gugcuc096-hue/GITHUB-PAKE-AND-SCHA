/*
 * Bewegungs-System (zu /css/motion.css): kleine Rückmeldungen, die überall gleich wirken – Dashboard und Website.
 *  - Knöpfe: Ring vom Klickpunkt aus; nach dem Speichern ein kurzer Haken
 *  - Felder: Fehler wackeln kurz
 *  - Menüs („Mehr“, Chips): schließen rückwärts statt abrupt
 *  - Listen: einzelne neue Zeilen gleiten ein (ein ganzes Neuzeichnen nicht)
 *  - Menü: Gold-Indikator gleitet zum aktiven Punkt, geänderte Zähler federn
 *  - Konfetti in Gold bei einem Erfolg (window.PS.confetti)
 * Alles entfällt bei „Bewegung reduzieren“ (PS.motion.calm()).
 */
(() => {
  'use strict';
  const PS = window.PS;
  if (!PS || !PS.motion) return;
  const calm = () => PS.motion.calm();
  const canAnimate = () => !calm() && typeof Element.prototype.animate === 'function';

  /* ---------------------------------------------------------------- Knöpfe: Ring */
  const BTN = '.btn-gold, .btn-outline, .btn-ghost, .btn-danger, .btn-discord, .icon-btn';
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (calm() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const btn = e.target.closest && e.target.closest(BTN);
      if (!btn || btn.disabled || btn.classList.contains('ps-saved')) return;
      const r = btn.getBoundingClientRect();
      if (!r.width) return;
      let box = btn.querySelector(':scope > .ps-ripple-box');
      if (!box) {
        box = document.createElement('span');
        box.className = 'ps-ripple-box';
        box.setAttribute('aria-hidden', 'true');
        btn.appendChild(box);
      }
      const ring = document.createElement('span');
      ring.className = 'ps-ripple';
      const far = Math.max(Math.hypot(e.clientX - r.left, e.clientY - r.top), Math.hypot(r.right - e.clientX, r.bottom - e.clientY), Math.hypot(e.clientX - r.left, r.bottom - e.clientY), Math.hypot(r.right - e.clientX, e.clientY - r.top));
      ring.style.left = `${e.clientX - r.left}px`;
      ring.style.top = `${e.clientY - r.top}px`;
      ring.style.setProperty('--r', String(Math.ceil((far * 2) / 8) + 2));
      box.appendChild(ring);
      ring.addEventListener('animationend', () => ring.remove(), { once: true });
    },
    { passive: true }
  );

  /* ---------------------------------------------------------------- Knöpfe: Haken nach dem Speichern */
  document.addEventListener('ps:form-ok', (e) => {
    if (calm()) return;
    const form = e.target && e.target.tagName === 'FORM' ? e.target : null;
    const btn = form && form.querySelector('button[type="submit"]:not(.ps-saved)');
    if (!btn || !btn.isConnected) return;
    btn.classList.add('ps-saved');
    setTimeout(() => btn.isConnected && btn.classList.remove('ps-saved'), 760);
  });

  /* ---------------------------------------------------------------- Felder: Fehler wackeln */
  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target;
      if (calm() || !el || !el.classList) return;
      el.classList.remove('ps-shake');
      void el.offsetWidth;
      el.classList.add('ps-shake');
      el.addEventListener('animationend', () => el.classList.remove('ps-shake'), { once: true });
    },
    true
  );
  // Eigene Prüfungen und Antworten des Servers (PS.fieldError) setzen die Meldung direkt unter das Feld
  new MutationObserver((list) => {
    if (calm()) return;
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.classList || !n.classList.contains('ps-field-error')) continue;
        const field = n.previousElementSibling && n.previousElementSibling.matches('.field, input, select, textarea') ? n.previousElementSibling : n.parentElement && n.parentElement.querySelector('.field');
        if (!field) continue;
        field.classList.remove('ps-shake');
        void field.offsetWidth;
        field.classList.add('ps-shake');
        field.addEventListener('animationend', () => field.classList.remove('ps-shake'), { once: true });
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------------------------------------------------------------- Menüs: rückwärts schließen */
  document.addEventListener(
    'click',
    (e) => {
      const sum = e.target.closest && e.target.closest('details.more-menu > summary');
      if (!sum || calm()) return;
      const menu = sum.parentElement;
      if (!menu.open) return;
      e.preventDefault();
      menu.classList.add('is-closing');
      setTimeout(() => {
        menu.classList.remove('is-closing');
        menu.open = false;
      }, 110);
    },
    true
  );

  /* ---------------------------------------------------------------- Listen: einzelne neue Zeilen gleiten ein */
  const ROW = '.task-row, .req-row, .party-row, .list-row, .tl-item, .pack, .party-row';
  let rowsOn = false;
  const rowObs = new MutationObserver((list) => {
    if (!rowsOn || calm()) return;
    const fresh = [];
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(ROW)) fresh.push(n);
        else if (n.querySelectorAll) n.querySelectorAll(ROW).forEach((x) => fresh.push(x));
      }
    }
    // Ein ganzes Neuzeichnen (viele Zeilen auf einmal) bleibt ruhig – nur einzelne neue Einträge gleiten ein
    if (!fresh.length || fresh.length > 3) return;
    fresh.forEach((el) => {
      el.classList.add('ps-row-in');
      el.addEventListener('animationend', () => el.classList.remove('ps-row-in'), { once: true });
    });
  });
  const startRows = () => {
    const root = document.querySelector('#content') || document.body;
    rowObs.observe(root, { childList: true, subtree: true });
    const modal = document.querySelector('#modalBody');
    if (modal) rowObs.observe(modal, { childList: true, subtree: true });
    setTimeout(() => (rowsOn = true), 900); // nicht beim ersten Aufbau der Seite
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startRows);
  else startRows();

  /* ---------------------------------------------------------------- Menü: Gold-Indikator und federnde Zähler */
  const nav = () => document.querySelector('#nav');
  let ind = null;
  let lastY = null;
  const counts = new Map();
  function placeIndicator() {
    const n = nav();
    if (!n) return;
    if (!ind || !ind.isConnected) {
      ind = document.createElement('span');
      ind.className = 'nav-ind is-hidden';
      ind.setAttribute('aria-hidden', 'true');
      n.prepend(ind);
    }
    const active = n.querySelector('.nav-item.active');
    if (!active || active.offsetParent === null) {
      ind.classList.add('is-hidden');
      return;
    }
    const y = active.offsetTop + (active.offsetHeight - 24) / 2;
    ind.style.height = '24px';
    if (lastY === null || calm()) ind.style.transition = 'none';
    ind.style.transform = `translateY(${y}px)`;
    if (lastY === null || calm()) {
      void ind.offsetWidth;
      ind.style.transition = '';
    }
    ind.classList.remove('is-hidden');
    lastY = y;
  }
  function bumpCounts() {
    const n = nav();
    if (!n) return;
    n.querySelectorAll('.nav-item').forEach((a) => {
      const key = a.getAttribute('href') || '';
      const el = a.querySelector('.nav-count');
      const val = el ? el.textContent : '';
      const prev = counts.get(key);
      counts.set(key, val);
      if (el && prev !== undefined && prev !== val && !calm()) {
        el.classList.remove('ps-bump');
        void el.offsetWidth;
        el.classList.add('ps-bump');
      }
    });
  }
  const startNav = () => {
    const n = nav();
    if (!n) return;
    let queued = false;
    new MutationObserver((list) => {
      // Nur auf das Neuzeichnen des Menüs reagieren, nicht auf den Indikator selbst
      if (list.every((m) => m.target === ind || (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every((x) => x.classList && x.classList.contains('nav-ind'))))) return;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        placeIndicator();
        bumpCounts();
      });
    }).observe(n, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => placeIndicator(), { passive: true });
    placeIndicator();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startNav);
  else startNav();

  /* ---------------------------------------------------------------- Konfetti in Gold */
  // in der Kanzleifarbe (Einstellungen → Stil & Saison): Grundton, hell, dunkel und zwei Mischungen
  const COLORS = ['var(--gold-500)', 'var(--gold-light)', 'var(--gold-600)', 'color-mix(in srgb, var(--gold-500), #fff 75%)', 'color-mix(in srgb, var(--gold-500), #fff 20%)'];
  function confetti(x, y, { count = 36 } = {}) {
    if (!canAnimate()) return;
    const box = document.createElement('div');
    box.className = 'ps-confetti';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    document.body.appendChild(box);
    const done = [];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--c', COLORS[i % COLORS.length]);
      box.appendChild(p);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 160 + Math.random() * 220;
      const dx = Math.cos(angle) * speed;
      const dy = Math.sin(angle) * speed;
      const spin = (Math.random() - 0.5) * 900;
      done.push(
        p
          .animate(
            [
              { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
              { transform: `translate(${dx * 0.7}px, ${dy * 0.7 - 20}px) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.55 },
              { transform: `translate(${dx}px, ${dy + 260}px) rotate(${spin}deg)`, opacity: 0 },
            ],
            { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' }
          )
          .finished.catch(() => {})
      );
    }
    Promise.all(done).then(() => box.remove());
  }
  PS.confetti = confetti;

  /* ---------------------------------------------------------------- Website ↔ Dashboard: sanfter Übergang */
  // Die Seite blendet kurz aus, die nächste blendet selbst ein (body.page-in bzw. Seitenaufbau des Dashboards).
  const GO_PATHS = new Set(['/', '/dashboard', '/login', '/registrieren']);
  function go(url) {
    if (calm()) return void (location.href = url);
    document.documentElement.classList.add('ps-leaving');
    setTimeout(() => (location.href = url), 180);
  }
  PS.go = go;
  window.addEventListener('pageshow', (e) => e.persisted && document.documentElement.classList.remove('ps-leaving')); // Zurück-Taste
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-nofade')) return;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      return;
    }
    if (u.origin !== location.origin || !GO_PATHS.has(u.pathname)) return;
    if (u.pathname === location.pathname && (u.hash || !u.search) && !a.hasAttribute('data-leave')) return; // gleiche Seite (Sprungmarke)
    if (u.pathname === location.pathname && u.search === location.search) return;
    e.preventDefault();
    go(u.pathname + u.search + u.hash);
  });

  /* ---------------------------------------------------------------- Überall: weiche Bewegung für alles, was erscheint */
  // Nur mit der Einzel-Eigenschaft „translate“ (kollidiert nicht mit transform von Wischen, Ziehen oder Gleiten der Zeilen).
  const CAN = () => !calm() && typeof Element.prototype.animate === 'function';
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const NO_FLOW = 'script, style, option, optgroup, template, [data-no-flow], .ps-toast-root, .nav-ind, .ps-ripple-box, .kmap, .kmap-gl, .swipe-hint';
  const fadeUp = (el, y = 8, ms = 240) => el.animate([{ opacity: 0, translate: `0 ${y}px` }, { opacity: 1, translate: '0 0' }], { duration: ms, easing: EASE });

  // 1. Etwas wird eingeblendet (hidden entfernt: Hinweise, Kästchen, Felder, Vorschauen …): es gleitet kurz ein
  let flowOn = false;
  new MutationObserver((list) => {
    if (!flowOn || !CAN()) return;
    for (const m of list) {
      const el = m.target;
      if (m.oldValue === null || el.hidden || !el.isConnected || el.matches(NO_FLOW)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      fadeUp(el, 6, 240);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, subtree: true });
  setTimeout(() => (flowOn = true), 900); // nicht beim ersten Aufbau der Seite

  // 2. Bilder blenden ein, sobald sie geladen sind (statt plötzlich zu erscheinen)
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !flowOn || !CAN() || img.closest('[data-no-flow], .brand, .site-avatar, .hdr-av')) return;
      const r = img.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    },
    true
  );

  // 3. Lange Seiten und Akten: Bereiche unterhalb des sichtbaren Teils blenden beim Hinscrollen ein (nur solche, die beim
  //    Zeichnen noch nicht im Bild waren – was man schon sieht, bleibt ruhig)
  const REVEAL = '#content > .panel, #content > section, #content .kpi-grid, #content .chg-sum, #modalBody .section, #modalBody > .panel';
  const seen = new WeakSet();
  const io =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (!en.isIntersecting) continue;
              io.unobserve(en.target);
              const el = en.target;
              el.style.opacity = '';
              el.style.translate = '';
              setTimeout(() => (el.style.transition = ''), 620);
            }
          },
          { rootMargin: '0px 0px -4% 0px', threshold: 0.01 }
        )
      : null;
  let scanQueued = false;
  function scan() {
    scanQueued = false;
    if (!io || !CAN()) return;
    document.querySelectorAll(REVEAL).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (!r.height || r.top < innerHeight * 0.94 || el.matches(NO_FLOW) || el.closest('.sec-wrap.is-hidden-sec')) return;
      el.style.transition = 'opacity 520ms cubic-bezier(0.2, 0.8, 0.2, 1), translate 520ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      el.style.opacity = '0';
      el.style.translate = '0 18px';
      io.observe(el);
    });
  }
  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  };
  const scanObs = new MutationObserver(queueScan);
  const startScan = () => {
    ['#content', '#modalBody'].forEach((sel) => {
      const root = document.querySelector(sel);
      if (root) scanObs.observe(root, { childList: true, subtree: sel === '#modalBody' });
    });
    queueScan();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startScan);
  else startScan();

  // 4. Reiter und Umschalter („Rechnungen / Dauermandate“, Einstellungen …): der neue Inhalt blendet überlappend ein
  let tabAt = 0;
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target.closest && e.target.closest('[role="tab"], [data-action$="-tab"]');
      // Bereichs- und Akte-Reiter haben ihren eigenen Übergang (Leiste bleibt stehen, Strich gleitet – 13-reiter.js)
      if (t) tabAt = t.closest('.hub-tabs, .case-jump-list') ? 0 : Date.now();
    },
    true
  );
  const tabObs = new MutationObserver((list) => {
    if (!tabAt || Date.now() - tabAt > 1800 || !CAN()) return;
    tabAt = 0;
    const box = list[0].target;
    fadeUp(box, 10, 280);
  });
  const startTabs = () => ['#content', '#modalBody'].forEach((sel) => document.querySelector(sel) && tabObs.observe(document.querySelector(sel), { childList: true }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startTabs);
  else startTabs();

  // 5. Zahlenfelder: der Wert federt beim Drücken von − / +
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.num-btn');
    if (!b || !CAN()) return;
    const input = b.parentElement && b.parentElement.querySelector('input');
    if (input) requestAnimationFrame(() => input.animate([{ scale: 1.22 }, { scale: 1 }], { duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }));
  });

  /* ---------------------------------------------------------------- Glas: Glanz folgt der Maus (depth.css → .is-lit) */
  // Nur mit Maus; ein Bild pro Frame; die Fläche unter dem Zeiger bekommt --mx/--my, beim Verlassen klingt der Glanz aus.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    // Flächen mit eigenem Spotlight (api.js, .ps-spot) setzen --mx/--my selbst – die bleiben unberührt
    const LIT = ':is(.panel, .kpi, .glass-card, .modal-card):not(.ps-spot)';
    let lit = null;
    let ev = null;
    let queued = false;
    const paint = () => {
      queued = false;
      const el = ev && ev.target && ev.target.closest ? ev.target.closest(LIT) : null;
      if (el !== lit) {
        if (lit) lit.classList.remove('is-lit');
        lit = el;
      }
      if (!el || calm()) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${Math.round(ev.clientX - r.left)}px`);
      el.style.setProperty('--my', `${Math.round(ev.clientY - r.top)}px`);
      el.classList.add('is-lit');
    };
    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        ev = e;
        if (!queued) {
          queued = true;
          requestAnimationFrame(paint);
        }
      },
      { passive: true }
    );
    document.documentElement.addEventListener('pointerleave', () => lit && lit.classList.remove('is-lit')); // Maus verlässt das Fenster
  }

  /*
   * Website-Navigation: ein leuchtender goldener Strich liegt unter dem Menüpunkt der aktuellen Seite
   * (aria-current) bzw. des Abschnitts, in dem man gerade liest (Scrollspy, .nav-link[data-section]), und folgt beim
   * Darüberfahren der Maus. Beim Wechsel auf eine andere Unterseite gleitet er von der alten Stelle zur neuen
   * (Stelle in sessionStorage). Gilt für jede <nav data-ink> mit .nav-link.
   */
  function siteNavInk() {
    document.querySelectorAll('nav[data-ink]').forEach((nav) => {
      const links = [...nav.querySelectorAll('.nav-link')];
      if (!links.length || nav.querySelector('.nav-ink')) return;
      const ink = document.createElement('span');
      ink.className = 'nav-ink';
      ink.setAttribute('aria-hidden', 'true');
      nav.appendChild(ink);
      let hover = null;
      const KEY = 'ps.ink';
      const isActive = (l) => l.classList.contains('nav-active') || (!l.dataset.section && l.getAttribute('aria-current') === 'page');
      const remember = (v) => {
        try {
          if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
          else sessionStorage.removeItem(KEY);
        } catch {
          /* ohne Speicher erscheint der Strich einfach an seiner Stelle */
        }
      };
      const place = () => {
        const active = links.find(isActive);
        const target = hover || active;
        if (!target || !target.getClientRects().length) {
          ink.style.opacity = '0';
          if (!hover) remember(null);
          return;
        }
        const nr = nav.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        ink.style.width = `${r.width}px`;
        ink.style.transform = `translateX(${r.left - nr.left}px)`;
        ink.style.opacity = hover && hover !== active ? '0.55' : '1';
        if (target === active && nav.offsetWidth) remember({ x: r.left - nr.left, w: r.width, nw: nr.width });
      };
      // Von der Stelle der vorigen Seite aus losgleiten (gleiche Breite der Leiste, sonst stimmt die Stelle nicht)
      let from = null;
      try {
        from = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      } catch {
        from = null;
      }
      if (from && Math.abs(from.nw - nav.getBoundingClientRect().width) < 2 && !calm()) {
        ink.style.width = `${from.w}px`;
        ink.style.transform = `translateX(${from.x}px)`;
        ink.style.opacity = '1';
        void ink.offsetWidth; // Startstelle festhalten, dann gleiten
      }
      const spied = links.filter((l) => l.dataset.section && document.getElementById(l.dataset.section));
      const spy = () => {
        if (!spied.length) return;
        const y = window.scrollY + 140;
        let current = null;
        let best = -Infinity;
        for (const l of spied) {
          const el = document.getElementById(l.dataset.section);
          if (!el.getClientRects().length) continue;
          const top = el.getBoundingClientRect().top + window.scrollY;
          if (top <= y && top > best) {
            best = top;
            current = l.dataset.section;
          }
        }
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        if (atBottom) {
          const last = spied.filter((l) => document.getElementById(l.dataset.section).getClientRects().length).sort((a, b) => document.getElementById(a.dataset.section).getBoundingClientRect().top - document.getElementById(b.dataset.section).getBoundingClientRect().top).pop();
          if (last) current = last.dataset.section;
        }
        links.forEach((l) => l.classList.toggle('nav-active', !!current && l.dataset.section === current));
        place();
      };
      let queued = false;
      const onScroll = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          spy();
        });
      };
      links.forEach((l) => {
        l.addEventListener('pointerenter', () => {
          hover = l;
          place();
        });
        l.addEventListener('pointerleave', () => {
          hover = null;
          place();
        });
      });
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      window.addEventListener('load', onScroll);
      document.fonts && document.fonts.ready && document.fonts.ready.then(onScroll);
      if (from && ink.style.opacity === '1') {
        // erst gleiten, wenn die Seite steht (Schrift geladen) – sonst landet der Strich neben dem Menüpunkt
        ink.classList.add('is-ready');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          spy();
          place();
        }));
      } else {
        spy();
        place();
        requestAnimationFrame(() => ink.classList.add('is-ready')); // erst danach gleiten (nicht von links hereinfliegen)
      }
    });
  }
  /*
   * Glanz über „Recht bekommen.“ (Startseite): eine eigene Ebene mit hellem Text gleitet über den stehenden Goldverlauf –
   * Fenster und Inhalt werden gegenläufig verschoben, also nur verschoben, nie neu gemalt (auch ohne Grafikkarte billig).
   * Beim Laden, beim Darüberfahren und in „Schön“ alle 9 Sekunden; „Schnell“ und „Bewegung reduzieren“: kein Glanz.
   */
  function heroShine() {
    const el = document.querySelector('.kz-shine');
    if (!el || el.querySelector('.kz-shine-band') || /[?&]bearbeiten\b/.test(location.search) || typeof el.animate !== 'function') return;
    const text = el.textContent;
    const band = document.createElement('span');
    band.className = 'kz-shine-band';
    band.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.textContent = text;
    band.appendChild(inner);
    el.appendChild(band);
    const gfx = () => document.documentElement.dataset.gfx;
    let running = null;
    const run = () => {
      if (calm() || gfx() === 'lite' || document.hidden || running) return;
      const w = el.offsetWidth;
      const bw = band.offsetWidth;
      if (!w || !bw) return;
      inner.style.width = `${w}px`;
      const opts = { duration: 1700, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' };
      band.style.visibility = 'visible';
      running = band.animate([{ transform: `translateX(${-bw}px)` }, { transform: `translateX(${w}px)` }], opts);
      inner.animate([{ transform: `translateX(${bw}px)` }, { transform: `translateX(${-w}px)` }], opts);
      running.onfinish = running.oncancel = () => {
        running = null;
        band.style.visibility = '';
      };
    };
    setTimeout(run, 900); // nach dem Einblenden des Startbereichs
    el.closest('h1')?.addEventListener('pointerenter', run);
    setInterval(() => gfx() === 'full' && run(), 9000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siteNavInk);
  else siteNavInk();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', heroShine);
  else heroShine();
  // Website: Kopfleiste „gescrollt“ (dichter, goldene Haarlinie)
  if (!document.getElementById('sidebar')) {
    const scrolled = () => document.documentElement.classList.toggle('is-scrolled', window.scrollY > 12);
    window.addEventListener('scroll', scrolled, { passive: true });
    scrolled();
  }

  /*
   * Felder:
   *  - Schwebende Beschriftung: Bei „Beschriftung + Feld“ (label.label[for] direkt vor input/textarea.field) sitzt die
   *    Beschriftung im Feld und wandert beim Tippen/Fokus nach oben. Nur kurze Beschriftungen ohne Knöpfe darin.
   *  - Geldfelder (input[data-money]): Tausenderpunkte beim Tippen (150000 → 150.000). Lesen (el.value) und Absenden
   *    liefern weiter die reinen Ziffern – Formulare und Server merken davon nichts.
   */
  const FL_TYPES = new Set(['', 'text', 'email', 'number', 'tel', 'url', 'password', 'search']);
  const NATIVE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const fmtMoney = (d) => (d ? Number(d).toLocaleString('de-DE') : '');
  // „150.000“ (Tausenderpunkte) → 150000; „1500.5“ / „1500,50“ → 1500 (ganze Dollar)
  const moneyDigits = (v) => {
    const t = String(v == null ? '' : v).trim();
    return /^\d{1,3}(\.\d{3})+$/.test(t) ? digits(t) : digits(t.split(/[.,]/)[0]);
  };
  function upgradeMoney(el) {
    if (el.dataset.moneyOn) return;
    el.dataset.moneyOn = '1';
    const raw = moneyDigits(NATIVE.get.call(el));
    try {
      el.type = 'text';
    } catch {
      return;
    }
    el.inputMode = 'numeric';
    el.autocomplete = 'off';
    el.classList.add('money-field');
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() {
        return digits(NATIVE.get.call(this));
      },
      set(v) {
        NATIVE.set.call(this, fmtMoney(moneyDigits(v)));
      },
    });
    NATIVE.set.call(el, fmtMoney(raw));
  }
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!el || !el.dataset || !el.dataset.moneyOn) return;
      const shown = NATIVE.get.call(el);
      const caret = el.selectionStart == null ? shown.length : el.selectionStart;
      const before = digits(shown.slice(0, caret)).length;
      const next = fmtMoney(digits(shown));
      if (next === shown) return;
      NATIVE.set.call(el, next);
      let pos = 0;
      for (let n = 0; pos < next.length && n < before; pos++) if (/\d/.test(next[pos])) n++;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* egal */
      }
    },
    true
  );
  // Absenden: kurz die reinen Ziffern ins Feld (FormData liest den echten Feldinhalt), danach wieder mit Punkten
  document.addEventListener(
    'submit',
    (e) => {
      const list = e.target.querySelectorAll ? e.target.querySelectorAll('input[data-money-on]') : [];
      if (!list.length) return;
      list.forEach((el) => NATIVE.set.call(el, digits(NATIVE.get.call(el))));
      setTimeout(() => list.forEach((el) => el.isConnected && NATIVE.set.call(el, fmtMoney(digits(NATIVE.get.call(el))))), 400);
    },
    true
  );
  let flSeq = 0;
  function floatLabel(label) {
    label.dataset.fl = '0';
    const field = label.nextElementSibling;
    const box = label.parentElement;
    if (!field || !box || !field.classList.contains('field') || field.disabled) return;
    if (label.htmlFor && field.id !== label.htmlFor) return;
    const extras = [...label.children];
    // Kleine Knöpfe in der Beschriftung („+ neu“) wandern oben rechts ins Feld, alles andere bleibt, wie es ist
    if (extras.some((c) => c.tagName !== 'BUTTON') || label.textContent.trim().length > 40 || box.classList.contains('fl')) return;
    const isArea = field.tagName === 'TEXTAREA';
    const isSelect = field.tagName === 'SELECT' && !field.multiple;
    if (!isArea && !isSelect && !(field.tagName === 'INPUT' && FL_TYPES.has(field.getAttribute('type') || ''))) return;
    // Beschriftung ohne for: mit dem Feld verbinden (Klick und Vorlesen)
    if (!label.htmlFor) {
      if (!field.id) field.id = `fl-${++flSeq}`;
      label.htmlFor = field.id;
    }
    if (box.closest('.cfg-row, .color-row, table, .ie, .inline-form, .chat-compose, .gs-box, [data-no-fl]') || box.matches('form, .form-grid, .flex, .grid')) return;
    label.dataset.fl = '1';
    box.classList.add('fl');
    if (extras.length) {
      const holder = document.createElement('span');
      holder.className = 'fl-extra';
      extras.forEach((c) => holder.appendChild(c));
      label.textContent = label.textContent.trim();
      box.appendChild(holder);
    }
    if (isArea) box.classList.add('fl-area');
    if (isSelect) box.classList.add('fl-select', 'is-up'); // eine Auswahl hat immer einen Wert
    const sync = () => box.classList.toggle('is-up', isSelect || field.value !== '');
    field.addEventListener('input', sync);
    field.addEventListener('change', sync);
    sync();
  }
  let flQueued = false;
  function fieldScan() {
    flQueued = false;
    document.querySelectorAll('input[data-money]:not([data-money-on])').forEach(upgradeMoney);
    document.querySelectorAll('label.label:not([data-fl])').forEach(floatLabel);
    // Programmatisch gesetzte Werte (Entwürfe, Vorlagen): Beschriftung oben halten
    document.querySelectorAll('.fl:not(.fl-select)').forEach((box) => {
      const f = box.querySelector(':scope > .field');
      if (f) box.classList.toggle('is-up', f.value !== '');
    });
  }
  const fieldObs = new MutationObserver(() => {
    if (flQueued) return;
    flQueued = true;
    requestAnimationFrame(fieldScan);
  });
  const startFields = () => {
    fieldObs.observe(document.body, { childList: true, subtree: true });
    fieldScan();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startFields);
  else startFields();
})();
