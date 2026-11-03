/*
 * Grafikstufe je Gerät – läuft als allererstes Skript im <head> (vor dem ersten Bild), damit nichts flackert.
 *
 *   html[data-gfx="full"]  volle Optik (Glas in Kopfzeile, Menü und Fenstern; leuchtende Hintergründe bewegen sich)
 *   html[data-gfx="lite"]  schnelle Optik: kein Weichzeichner hinter Flächen, keine Dauer-Animationen, Saison-Szene als
 *                          stehendes Bild, keine Seitenübergänge – sieht fast gleich aus, braucht einen Bruchteil.
 *
 * Automatisch („auto“, Standard): „lite“, wenn der Browser ohne echte Grafikkarte zeichnet (Hardwarebeschleunigung aus,
 * SwiftShader/llvmpipe/„Microsoft Basic Render“), bei schwachen Geräten, „Transparenz reduzieren“ oder Datensparmodus.
 * Dazu misst ein Wächter in den ersten Sekunden und beim Scrollen die Bildrate: Ruckelt es (unter ~45 Bildern pro
 * Sekunde), schaltet er sofort auf „lite“ und merkt sich das für dieses Gerät (eine Woche, dann wird neu gemessen).
 * Von Hand: Mein Profil → Animationen → Grafik („auto“, „lite“ = schnell, „full“ = schön).
 *
 * window.PSGfx = { mode, pref, set(pref), reason }
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'ps.gfx'; // Wahl: auto | lite | full
  var LEARN = 'ps.gfx.auto'; // gemessen: { mode, at, why, ua }
  var WEEK = 7 * 864e5;
  var store = {
    get: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch (e) {
        /* privates Fenster: nur für diese Seite */
      }
    },
  };
  var mq = function (q) {
    try {
      return window.matchMedia(q).matches;
    } catch (e) {
      return false;
    }
  };

  /** Zeichnet der Browser ohne Grafikkarte? (Ergebnis eine Woche gemerkt – WebGL anzulegen kostet etwas Zeit.) */
  function softwareRendering() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: true, powerPreference: 'low-power' }) || c.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: true });
      if (!gl) return 'kein WebGL mit Grafikkarte';
      var info = gl.getExtension('WEBGL_debug_renderer_info');
      var r = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      if (/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|microsoft basic|google swiftshader/i.test(r)) return 'Software-Rendering (' + r.slice(0, 60) + ')';
      return '';
    } catch (e) {
      return 'WebGL nicht verfügbar';
    }
  }

  function detect() {
    var nav = navigator;
    // Automatisierte Tests (Playwright): feste volle Optik, außer ein Test will die Erkennung prüfen (window.__gfxAuto)
    if (nav.webdriver && window.__gfxAuto !== true) return { mode: 'full', why: 'Testbrowser' };
    if (mq('(prefers-reduced-transparency: reduce)')) return { mode: 'lite', why: 'Transparenz reduzieren' };
    if (nav.connection && nav.connection.saveData) return { mode: 'lite', why: 'Datensparmodus' };
    if ((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2)) return { mode: 'lite', why: 'schwaches Gerät' };
    var learned = null;
    try {
      learned = JSON.parse(store.get(LEARN) || 'null');
    } catch (e) {
      learned = null;
    }
    if (learned && learned.ua === nav.userAgent && Date.now() - learned.at < WEEK) return { mode: learned.mode, why: learned.why, cached: true };
    var sw = softwareRendering();
    var res = sw ? { mode: 'lite', why: sw } : { mode: 'full', why: 'Grafikkarte' };
    store.set(LEARN, JSON.stringify({ mode: res.mode, why: res.why, at: Date.now(), ua: nav.userAgent }));
    return res;
  }

  var pref = store.get(KEY);
  if (pref !== 'lite' && pref !== 'full') pref = 'auto';
  var auto = pref === 'auto' ? detect() : null;
  var mode = pref === 'auto' ? auto.mode : pref;
  root.dataset.gfx = mode;

  var api = {
    mode: mode,
    pref: pref,
    reason: auto ? auto.why : 'von Hand gewählt',
    /** Wahl ändern (auto | lite | full) – gilt sofort. */
    set: function (p) {
      p = p === 'lite' || p === 'full' ? p : 'auto';
      store.set(KEY, p === 'auto' ? null : p);
      if (p === 'auto') store.set(LEARN, null);
      api.pref = p;
      var d = p === 'auto' ? detect() : { mode: p, why: 'von Hand gewählt' };
      apply(d.mode, d.why);
      if (p === 'auto') watch();
    },
  };
  function apply(m, why) {
    api.mode = m;
    api.reason = why;
    if (root.dataset.gfx !== m) {
      root.dataset.gfx = m;
      try {
        document.dispatchEvent(new CustomEvent('ps:gfx', { detail: { mode: m, why: why } }));
      } catch (e) {
        /* alte Browser */
      }
    }
  }
  window.PSGfx = api;

  /*
   * Wächter: Bildrate messen (requestAnimationFrame) – im Leerlauf nach dem Laden und bei jedem Scrollen in den ersten
   * Minuten. Zwei schlechte Messungen (Median über 22 ms ≈ unter 45 Bilder/s) → „lite“. Läuft nur bei „auto“ + „full“
   * und nur, solange der Tab sichtbar ist.
   */
  var watching = false;
  function watch() {
    if (watching || api.pref !== 'auto' || api.mode !== 'full' || typeof requestAnimationFrame !== 'function') return;
    if (navigator.webdriver && window.__gfxAuto !== true) return;
    watching = true;
    var bad = 0;
    var runs = 0;
    var started = Date.now();
    function sample(ms, done) {
      if (document.hidden) return done(null);
      var times = [];
      var last = 0;
      var end = 0;
      function frame(t) {
        if (last) times.push(t - last);
        last = t;
        if (!end) end = t + ms;
        if (t < end) requestAnimationFrame(frame);
        else {
          times.sort(function (a, b) {
            return a - b;
          });
          done(times.length > 8 ? times[Math.floor(times.length / 2)] : null);
        }
      }
      requestAnimationFrame(frame);
    }
    function judge(median) {
      runs += 1;
      if (median != null && median > 25) bad += 1;
      if (bad >= 2) {
        store.set(LEARN, JSON.stringify({ mode: 'lite', why: 'Bildrate gemessen (' + Math.round(1000 / median) + '/s)', at: Date.now(), ua: navigator.userAgent }));
        apply('lite', 'Bildrate gemessen');
        stop();
      }
    }
    var busy = false;
    function onScroll() {
      if (busy || api.mode !== 'full') return;
      if (Date.now() - started > 3 * 60 * 1000 || runs >= 8) return stop();
      busy = true;
      sample(900, function (m) {
        judge(m);
        setTimeout(function () {
          busy = false;
        }, 1500);
      });
    }
    function stop() {
      window.removeEventListener('scroll', onScroll, true);
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    var idle = function () {
      sample(1500, function (m) {
        judge(m);
        if (api.mode === 'full') setTimeout(function () {
          sample(1500, judge);
        }, 2500);
      });
    };
    if (document.readyState === 'complete') setTimeout(idle, 2000);
    else window.addEventListener('load', function () {
      setTimeout(idle, 2000);
    });
  }
  watch();
})();
