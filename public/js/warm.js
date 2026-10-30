/*
 * Dashboard vorwärmen (Startseite, Karriere): Wer auf „Login“ zeigt oder tippt – oder die Seite eine Weile offen hat –,
 * hat meist vor, ins Dashboard zu gehen. Dessen Skript und Stile laden dann schon im Hintergrund (niedrige Priorität,
 * versionierte Adressen), der Klick öffnet es ohne Wartezeit. Nichts davon bei „Datensparmodus“ oder langsamer Leitung.
 */
(() => {
  'use strict';
  const conn = navigator.connection || {};
  if (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')) return;
  const me = document.currentScript;
  const v = me && me.src ? new URL(me.src).searchParams.get('v') : '';
  const q = v ? `?v=${encodeURIComponent(v)}` : '';
  let done = false;
  const warm = () => {
    if (done) return;
    done = true;
    for (const [href, as] of [['/js/dashboard.bundle.js', 'script'], ['/css/app.css', 'style'], ['/css/depth.css', 'style']]) {
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.as = as;
      l.href = href + q;
      document.head.appendChild(l);
    }
  };
  const target = (e) => e.target.closest && e.target.closest('a[href^="/login"], a[href^="/dashboard"]');
  document.addEventListener('pointerover', (e) => target(e) && warm(), { passive: true });
  document.addEventListener('touchstart', (e) => target(e) && warm(), { passive: true });
  document.addEventListener('focusin', (e) => target(e) && warm());
  // wer die Seite ein paar Sekunden offen hat, kommt oft noch ins Dashboard
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1)))(() => setTimeout(warm, 6000), { timeout: 8000 });
})();
