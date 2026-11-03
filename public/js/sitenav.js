/*
 * Website in Unterseiten: alte Links auf Abschnitte der früheren Startseite (Lesezeichen, Discord-Nachrichten,
 * /#honorar …) führen sofort auf die neue Unterseite – noch bevor etwas gezeichnet wird.
 */
(function () {
  'use strict';
  /*
   * Unterseiten vorladen: ruht die Maus (oder der Finger) kurz auf einem Link zu einer anderen Unterseite, holt der
   * Browser sie schon – der Klick öffnet sie dann ohne Wartezeit. Nicht für Anmeldung, Dashboard, Schnittstellen.
   */
  var done = {};
  var timer = null;
  var SKIP = /^\/(api|dashboard|login|logout|registrieren|uploads)(\/|$)/;
  function target(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-nofade')) return null;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.search || SKIP.test(u.pathname) || u.pathname === location.pathname || done[u.pathname]) return null;
    return u.pathname;
  }
  function prefetch(path) {
    done[path] = true;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = path;
    document.head.appendChild(l);
  }
  var c = navigator.connection;
  if (!(c && (c.saveData || /2g/.test(c.effectiveType || '')))) {
    document.addEventListener('pointerover', function (e) {
      var path = target(e);
      clearTimeout(timer);
      if (path) timer = setTimeout(function () { prefetch(path); }, 80);
    }, { passive: true });
    document.addEventListener('touchstart', function (e) {
      var path = target(e);
      if (path) prefetch(path);
    }, { passive: true });
  }

  if (location.pathname !== '/' || !location.hash) return;
  var MAP = {
    rechner: '/honorare#rechner',
    honorar: '/honorare#honorar',
    vip: '/honorare#vip',
    team: '/anwaelte',
    raenge: '/kanzlei#raenge',
    stimmen: '/kanzlei#stimmen',
    karriere: '/kanzlei#karriere',
    kontakt: '/kontakt',
    anliegen: '/kontakt#anliegen',
    faq: '/kontakt#faq',
  };
  var to = MAP[location.hash.slice(1)];
  if (!to) return;
  var parts = to.split('#');
  location.replace(parts[0] + location.search + (parts[1] ? '#' + parts[1] : ''));
})();
