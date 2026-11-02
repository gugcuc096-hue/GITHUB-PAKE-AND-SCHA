/*
 * Kanzlei-Dashboard – weiche Wechsel: Seiten, Bereiche der Einstellungen und Reiter blenden ineinander über, statt das Alte
 * hart zu entfernen und das Neue von null einzublenden (das wirkt wie „neu geladen“). Dafür sorgt die Überblendung des Browsers
 * (View Transitions): Das Alte bleibt als Bild stehen und blendet aus, während das Neue einblendet; die Höhe gleitet mit.
 * Teile, die sich nicht ändern (Reiterleiste, Leiste der Einstellungen), werden eigens geführt und stehen still.
 * Ohne Browser-Unterstützung oder bei „Bewegung reduzieren“ wird einfach sofort gewechselt (die älteren Einblendungen
 * in 02-geruest.js bleiben dafür bestehen).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html).
 */
'use strict';

// Gesteuerte Browser (Tests, navigator.webdriver) wechseln ohne Überblendung: Messungen und Klicks kurz nach einem Seitenwechsel
// treffen dort sofort die neue Seite. Die Tests der Überblendung selbst schalten sie mit window.__wchForce ein.
const WCH_OK =
  typeof document.startViewTransition === 'function' &&
  typeof CSS !== 'undefined' &&
  CSS.supports('selector(:active-view-transition-type(wch))') &&
  (!navigator.webdriver || window.__wchForce === true);

/** Kann jetzt überblendet werden? (nicht bei „Bewegung reduzieren“, nicht im Hintergrund-Tab, nicht mitten im Ziehen) */
function wchCan() {
  return WCH_OK && !wchInUpdate && !window.PS.motion.calm() && !document.hidden && !document.body.classList.contains('cal-dragging') && !st.heroRect;
}

/**
 * Inhalt wechseln: fn zeichnet den neuen Stand (muss in einem Zug fertig sein). Mit Überblendung läuft fn erst, wenn das Bild
 * des alten Stands steht – danach gleitet alles ineinander. Ergebnis: true, wenn überblendet wurde (sonst lief fn sofort).
 */
let wchInUpdate = false; // gerade läuft das Zeichnen innerhalb einer Überblendung
/** Wird gerade innerhalb einer Überblendung gezeichnet? (Dann brauchen Teile ihre eigenen Einblendungen nicht.) */
const wchInside = () => wchInUpdate;
let wchCur = null; // laufende Überblendung
let wchRescue = null; // Klick, der in die Überblendung fiel: wird danach an das Element darunter weitergegeben

function wchSwap(fn) {
  if (wchInUpdate) {
    fn(); // schon innerhalb einer Überblendung: einfach mitzeichnen
    return Promise.resolve(true);
  }
  if (!wchCan()) {
    fn();
    return Promise.resolve(false);
  }
  const root = document.documentElement;
  // schaltet die Namen der Teile (motion.css) nur für die Dauer des Wechsels ein; bei offenem Fenster nur die des Fensters
  root.dataset.wch = document.body.classList.contains('modal-open') ? 'modal' : '1';
  let err = null; // Fehler beim Zeichnen gehören dem Aufrufer (er fällt dann z. B. auf normales Laden zurück)
  let t;
  try {
    t = document.startViewTransition({
      update: () => {
        wchInUpdate = true;
        try {
          fn();
        } catch (e) {
          err = e;
        } finally {
          wchInUpdate = false;
        }
      },
      types: ['wch'],
    });
  } catch {
    delete root.dataset.wch;
    fn();
    return Promise.resolve(false);
  }
  wchCur = t;
  const done = () => {
    delete root.dataset.wch;
    delete root.dataset.wchDir;
    if (wchCur === t) wchCur = null;
  };
  t.ready.catch(() => {}); // von einer neueren Überblendung abgelöst: kein Fehler, das Neue läuft einfach weiter
  t.finished.then(done, done);
  return t.updateCallbackDone.then(
    () => {
      if (err) throw err;
      return true;
    },
    (e) => {
      throw err || e;
    }
  );
}

/**
 * Leiste der Einstellungen (Suche, Auswahl, Liste) beim Bereichswechsel stehen lassen: Suchtext, Filter und Scrollstand
 * bleiben, nur der gewählte Eintrag wechselt. old = Leiste vor dem Neuzeichnen, fresh = die frisch gezeichnete.
 */
function settingsSideKeep(old, fresh) {
  if (!old || !fresh || old === fresh) return false;
  const a = [...old.querySelectorAll('.set-nav-item')];
  const b = [...fresh.querySelectorAll('.set-nav-item')];
  if (a.length !== b.length || a.some((el, i) => el.dataset.key !== b[i].dataset.key)) return false;
  a.forEach((el, i) => {
    el.className = b[i].className;
    if (b[i].hasAttribute('aria-current')) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    if (el.innerHTML !== b[i].innerHTML) el.innerHTML = b[i].innerHTML; // z. B. Entwurf-Punkt
  });
  const pick = old.querySelector('#setPick');
  const freshPick = fresh.querySelector('#setPick');
  if (pick && freshPick) pick.value = freshPick.value;
  fresh.replaceWith(old);
  return true;
}

/**
 * Bereich der Einstellungen wechseln (Aktionen settings-tab / cfg-tab): Leiste bleibt stehen, der Inhalt daneben blendet über.
 * draw() setzt den neuen Zustand und zeichnet mit renderView().
 */
function settingsSwitch(draw) {
  return wchSwap(() => {
    // Die Leiste erst jetzt greifen (nicht schon beim Klick): wurde die Seite zwischendurch neu gezeichnet, ist die alte Leiste sonst veraltet
    const old = document.querySelector('.set-side');
    const keepScroll = old ? old.querySelector('.set-nav')?.scrollTop || 0 : 0;
    draw();
    const fresh = document.querySelector('.set-side');
    if (settingsSideKeep(old, fresh)) {
      const nav = old.querySelector('.set-nav');
      if (nav) nav.scrollTop = keepScroll;
    }
  }).then((swapped) => {
    // Ohne Überblendung: der Inhalt neben der Leiste blendet wie bisher ein
    if (!swapped && document.querySelector('.set-main')) playIn(document.querySelector('.set-main'), 'swap-in');
    return swapped;
  });
}

/*
 * Während einer Überblendung fängt der Browser Mausklicks ab (sie landen auf <html>). Wer in dieser Zeit klickt, will etwas
 * bedienen: Die Überblendung endet sofort, und der Klick geht an das Element unter dem Mauszeiger – nichts geht verloren.
 */
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!wchCur || e.target !== document.documentElement || e.button !== 0) return;
    wchRescue = { x: e.clientX, y: e.clientY, at: performance.now() };
    try {
      wchCur.skipTransition();
    } catch {
      /* schon zu Ende */
    }
  },
  true
);
document.addEventListener(
  'click',
  (e) => {
    if (!wchRescue || e.target !== document.documentElement) return;
    const r = wchRescue;
    wchRescue = null;
    if (performance.now() - r.at > 1500) return;
    const el = document.elementFromPoint(r.x, r.y);
    if (!el || el === document.documentElement) return;
    e.stopPropagation();
    e.preventDefault();
    // das Drücken ebenfalls weitergeben: Teile der Oberfläche merken sich, wo ein Klick begann (z. B. „Klick neben das Fenster“)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.x, clientY: r.y, button: 0, pointerType: 'mouse' }));
    if (el.matches('input, textarea, select')) el.focus();
    el.click();
  },
  true
);

/**
 * Reiter-Aktionen (…-tab, …-view, …-mode), die sofort umschalten, laufen zentral in einer Überblendung (14-start.js ruft das
 * auf). Aktionen, die erst Daten holen (async), und die Einstellungen (eigene Führung der Leiste) bleiben, wie sie sind.
 */
const WCH_TAB_ACTION = /^(?!settings-|cfg-)[a-z0-9-]+-(tab|view|mode)$/;
function wchActionOk(name, fn) {
  return WCH_TAB_ACTION.test(name) && !(fn.constructor && fn.constructor.name === 'AsyncFunction') && wchCan();
}

// Rechtsklick direkt nach einem Wechsel: ebenso an das Element unter dem Zeiger weitergeben
document.addEventListener(
  'contextmenu',
  (e) => {
    if (!wchCur || e.target !== document.documentElement) return;
    const x = e.clientX;
    const y = e.clientY;
    try {
      wchCur.skipTransition();
    } catch {
      /* schon zu Ende */
    }
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement) return;
    e.preventDefault();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  },
  true
);
