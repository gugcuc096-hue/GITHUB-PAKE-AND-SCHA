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
      if (!btn || btn.disabled || btn.classList.contains('is-done')) return;
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
    const btn = form && form.querySelector('button[type="submit"]:not(.is-done)');
    if (!btn || !btn.isConnected) return;
    btn.classList.add('is-done');
    setTimeout(() => btn.isConnected && btn.classList.remove('is-done'), 760);
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
  const COLORS = ['#d4af37', '#f3e5ab', '#b8962e', '#fff3c4', '#e8c85a'];
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
})();
