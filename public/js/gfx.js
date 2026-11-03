/*
 * Grafikstufe je Gerät – läuft als allererstes Skript im <head> (vor dem ersten Bild), damit nichts flackert.
 *
 *   html[data-gfx="full"]  volle Optik (Glas in Kopfzeile, Menü und Fenstern; leuchtende Hintergründe bewegen sich)
 *   html[data-gfx="mid"]   „Ausgewogen“ – sieht fast gleich aus: kein Weichzeichner (deckende Verläufe), keine
 *                          Dauer-Animationen, stehende Leuchten, deckende Flächen; Bewegung nur beim Bedienen
 *   html[data-gfx="lite"]  „Schnell“: zusätzlich keine Seitenübergänge, kein Glanz, kaum Übergänge
 *
 * Automatisch („auto“, Standard): ohne echte Grafikkarte (Hardwarebeschleunigung aus, SwiftShader/llvmpipe/„Microsoft
 * Basic Render“) „mid“; „lite“ bei schwachen Geräten, „Transparenz reduzieren“ oder Datensparmodus. Dazu misst ein
 * Wächter die Bildwiederholrate des Monitors (60, 120, 144 Hz …) und dann die Bildrate im Leerlauf und beim Scrollen:
 * Wird die Rate des Monitors zweimal deutlich verfehlt, geht es eine Stufe herunter (full → mid → lite); das merkt sich
 * das Gerät eine Woche. Von Hand: Mein Profil → Animationen → Grafik („auto“, „full“, „mid“, „lite“).
 *
 * window.PSGfx = { mode, pref, set(pref), reason, hz }
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'ps.gfx'; // Wahl: auto | full | mid | lite
  var MODES = ['full', 'mid', 'lite'];
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
    var res = sw ? { mode: 'mid', why: sw } : { mode: 'full', why: 'Grafikkarte' };
    store.set(LEARN, JSON.stringify({ mode: res.mode, why: res.why, at: Date.now(), ua: nav.userAgent }));
    return res;
  }

  var pref = store.get(KEY);
  if (MODES.indexOf(pref) < 0) pref = 'auto';
  var auto = pref === 'auto' ? detect() : null;
  var mode = pref === 'auto' ? auto.mode : pref;
  root.dataset.gfx = mode;

  var api = {
    mode: mode,
    pref: pref,
    reason: auto ? auto.why : 'von Hand gewählt',
    hz: null, // gemessene Bildwiederholrate des Monitors (nach den ersten Sekunden)
    /** Wahl ändern (auto | full | mid | lite) – gilt sofort. */
    set: function (p) {
      p = MODES.indexOf(p) >= 0 ? p : 'auto';
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
   * Wächter: zuerst die Bildwiederholrate des Monitors bestimmen (kürzeste gleichmäßige Abstände zwischen zwei Bildern →
   * 60, 75, 90, 120, 144, 165 … Hz), dann die Bildrate im Leerlauf nach dem Laden und bei jedem Scrollen in den ersten
   * Minuten messen. Liegt der Median zweimal deutlich über dem Bildtakt des Monitors (mehr als 15 % langsamer) oder
   * ruckelt jedes zehnte Bild doppelt so lang, geht es eine Stufe herunter. Läuft nur bei „auto“ und nur, solange der
   * Tab sichtbar ist.
   */
  var RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];
  var snapHz = function (hz) {
    var best = 60;
    for (var i = 0; i < RATES.length; i++) if (Math.abs(RATES[i] - hz) < Math.abs(best - hz)) best = RATES[i];
    return best;
  };
  function sample(ms, done) {
    if (document.hidden || typeof requestAnimationFrame !== 'function') return done(null);
    var times = [];
    var last = 0;
    var end = 0;
    function frame(t) {
      if (last) times.push(t - last);
      last = t;
      if (!end) end = t + ms;
      if (t < end) requestAnimationFrame(frame);
      else {
        times.sort(function (x, y) {
          return x - y;
        });
        if (times.length < 8) return done(null);
        done({ p10: times[Math.floor(times.length * 0.1)], median: times[Math.floor(times.length / 2)], p90: times[Math.floor(times.length * 0.9)] });
      }
    }
    requestAnimationFrame(frame);
  }
  var watching = false;
  function watch() {
    if (watching || api.pref !== 'auto' || api.mode === 'lite' || typeof requestAnimationFrame !== 'function') return;
    if (navigator.webdriver && window.__gfxAuto !== true) return;
    watching = true;
    var bad = 0;
    var runs = 0;
    var started = Date.now();
    function judge(r) {
      runs += 1;
      if (!r) return;
      // Bildtakt des Monitors: aus den kürzesten Abständen (Test: window.__gfxHz legt ihn fest)
      if (!api.hz) api.hz = window.__gfxHz || snapHz(1000 / r.p10);
      var budget = 1000 / api.hz;
      if (r.median > budget * 1.15 || r.p90 > budget * 2) bad += 1;
      else bad = Math.max(0, bad - 1);
      if (bad >= 2) {
        var next = MODES[Math.min(MODES.length - 1, MODES.indexOf(api.mode) + 1)];
        var why = 'Bildrate gemessen (' + Math.round(1000 / r.median) + ' von ' + api.hz + ' Bildern/s)';
        store.set(LEARN, JSON.stringify({ mode: next, why: why, at: Date.now(), ua: navigator.userAgent }));
        apply(next, why);
        bad = 0;
        if (next === 'lite') stop();
      }
    }
    var busy = false;
    function onScroll() {
      if (busy || api.mode === 'lite') return;
      if (Date.now() - started > 3 * 60 * 1000 || runs >= 10) return stop();
      busy = true;
      sample(900, function (r) {
        judge(r);
        setTimeout(function () {
          busy = false;
        }, 1500);
      });
    }
    function stop() {
      window.removeEventListener('scroll', onScroll, true);
      watching = false;
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    var idle = function () {
      sample(1500, function (r) {
        judge(r);
        if (api.mode !== 'lite') setTimeout(function () {
          sample(1500, judge);
        }, 2500);
      });
    };
    if (document.readyState === 'complete') setTimeout(idle, 2000);
    else window.addEventListener('load', function () {
      setTimeout(idle, 2000);
    });
  }
  /*
   * Seitenwechsel der Website (View Transitions): in „Schnell“ ganz ohne Überblendung – die Bilder der alten und neuen
   * Seite zu berechnen kostet ohne Grafikkarte am meisten. („Ausgewogen“ blendet nur den Inhalt über, siehe kanzlei.css.)
   */
  var skipVt = function (e) {
    if (api.mode === 'lite' && e.viewTransition) e.viewTransition.skipTransition();
  };
  window.addEventListener('pageswap', skipVt);
  window.addEventListener('pagereveal', skipVt);
  watch();
})();
