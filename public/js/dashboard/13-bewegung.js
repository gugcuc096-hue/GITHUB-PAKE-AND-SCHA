/*
 * Kanzlei-Dashboard – Bewegung, die zeigt, woher etwas kommt: Beweisbilder fliegen aus dem Vorschaubild in die
 * Großansicht (mit Lupe am PC und Zoom mit zwei Fingern am Handy), eine neue Akte fliegt an ihren Platz in der Liste,
 * Kacheln und Menüpunkte gleiten in die Seitenüberschrift, gesendete Chat-Nachrichten gleiten aus dem Eingabefeld,
 * Balken der Statistik wachsen beim ersten Anzeigen. Alles kurz (unter 0,45 s) und bei „Bewegung reduzieren“ aus.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const flyOk = () => !window.PS.motion.calm() && typeof Element.prototype.animate === 'function';
const FLY_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const rectStyle = (r, radius) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: `${radius}px` });
const inView = (r) => !!r && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;

/** Ein Bild fliegt (fest über allem) von einem Rechteck zum anderen und verschwindet dann. */
function flyImage(src, from, to, { radiusFrom = 12, radiusTo = 12, ms = 360 } = {}) {
  const img = document.createElement('img');
  img.className = 'fly-img';
  img.alt = '';
  img.src = src;
  Object.assign(img.style, rectStyle(from, radiusFrom));
  document.body.appendChild(img);
  return img
    .animate([rectStyle(from, radiusFrom), rectStyle(to, radiusTo)], { duration: ms, easing: FLY_EASE, fill: 'forwards' })
    .finished.catch(() => {})
    .then(() => img.remove());
}

/* ================================================================
   Beweisbild: Großansicht wächst aus dem Vorschaubild und kehrt beim Schließen dorthin zurück
   ================================================================ */
/** Großansicht ist offen (10-aktionen.js, att-open): from = Rechteck des angeklickten Vorschaubilds. */
function lightboxEnter(from) {
  const box = $('#modalBody .lb-zoom');
  if (!box) return;
  zoomBind(box);
  const img = box.querySelector('.lightbox-img');
  const reveal = () => box.classList.remove('is-flying');
  if (!from || !flyOk()) return reveal();
  const fly = () => {
    if (!img.isConnected || !box.classList.contains('is-flying')) return;
    const to = img.getBoundingClientRect();
    if (!to.width || !to.height) return reveal();
    flyImage(img.currentSrc || img.src, from, to, { radiusTo: 0 }).then(reveal);
  };
  if (img.complete && img.naturalWidth) return requestAnimationFrame(fly);
  // Lädt das Bild länger, erscheint es einfach (ohne Flug)
  const late = setTimeout(reveal, 600);
  img.addEventListener('load', () => (clearTimeout(late), requestAnimationFrame(fly)), { once: true });
  img.addEventListener('error', () => (clearTimeout(late), reveal()), { once: true });
}
/**
 * Vor dem Zurück aus der Großansicht: Bild und Lage merken. Ergebnis: Funktion, die nach dem Wiederherstellen der
 * Akte das Bild zurück in sein Vorschaubild fliegen lässt (oder null).
 */
function lightboxLeave() {
  const img = $('#modalBody .lb-zoom .lightbox-img');
  const back = st.lightboxBack;
  if (!img || !back || !flyOk()) return null;
  const from = img.getBoundingClientRect();
  const src = img.currentSrc || img.src;
  if (!from.width || !from.height) return null;
  return () => {
    const att = $(`#modalBody .att[data-action="att-open"][${back.attr}="${back.value}"]`);
    const to = att && att.getBoundingClientRect();
    if (!inView(to)) return;
    att.classList.add('is-landing');
    flyImage(src, from, to, { radiusFrom: 0, radiusTo: 12, ms: 320 }).then(() => att.classList.remove('is-landing'));
  };
}

/* ---------------------------------------------------------------- Lupe (Maus) */
let lensBox = null;
function lensOff() {
  if (lensBox) lensBox.classList.remove('is-lens');
  lensBox = null;
}
document.addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType !== 'mouse') return;
    const box = e.target.closest ? e.target.closest('.lb-zoom') : null;
    if (box !== lensBox) lensOff();
    if (!box || box.classList.contains('is-flying')) return;
    const img = box.querySelector('.lightbox-img');
    const lens = box.querySelector('.lb-lens');
    if (!img || !lens || !img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return lensOff();
    const b = box.getBoundingClientRect();
    const size = lens.offsetWidth;
    // Vergrößerung: mindestens 2×, bei großen Bildern bis zur vollen Auflösung (höchstens 4×)
    const f = Math.max(2, Math.min(4, img.naturalWidth / r.width));
    const src = img.currentSrc || img.src;
    if (lens.dataset.src !== src) {
      lens.dataset.src = src;
      lens.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    }
    lens.style.backgroundSize = `${r.width * f}px ${r.height * f}px`;
    lens.style.backgroundPosition = `${size / 2 - x * f}px ${size / 2 - y * f}px`;
    lens.style.transform = `translate(${r.left - b.left + x - size / 2}px, ${r.top - b.top + y - size / 2}px)`;
    lensBox = box;
    box.classList.add('is-lens');
  },
  { passive: true }
);

/* ---------------------------------------------------------------- Zoom mit zwei Fingern, Doppeltippen (Handy) */
const pinch = { box: null, img: null, s: 1, x: 0, y: 0, start: null, tap: 0, tapXY: null };
function zoomApply() {
  const z = pinch;
  z.img.style.transform = z.s > 1.001 ? `translate(${z.x}px, ${z.y}px) scale(${z.s})` : '';
  z.box.classList.toggle('is-zoomed', z.s > 1.001);
}
function zoomClamp() {
  const z = pinch;
  const w = z.img.offsetWidth;
  const h = z.img.offsetHeight;
  z.s = Math.min(5, Math.max(1, z.s));
  z.x = Math.min(0, Math.max(w - w * z.s, z.x));
  z.y = Math.min(0, Math.max(h - h * z.s, z.y));
}
/** Punkt (Bildschirm) → Lage im unvergrößerten Bild. */
function zoomLocal(cx, cy) {
  const b = pinch.box.getBoundingClientRect();
  return [cx - b.left - pinch.img.offsetLeft, cy - b.top - pinch.img.offsetTop];
}
const touchMid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
/** Gesten an die Großansicht hängen (nur dort – die übrige Seite scrollt ungebremst). */
function zoomBind(box) {
  if (!box || box.dataset.zoomBound) return;
  box.dataset.zoomBound = '1';
  const img = box.querySelector('.lightbox-img');
  if (!img) return;
  const own = () => {
    if (pinch.box !== box) Object.assign(pinch, { box, img, s: 1, x: 0, y: 0, start: null, tap: 0, tapXY: null });
    return pinch;
  };
  box.addEventListener(
    'touchstart',
    (e) => {
      const z = own();
      const t = e.touches;
      if (t.length === 2) {
        e.preventDefault();
        const [mx, my] = zoomLocal(...touchMid(t));
        z.start = { two: true, d: touchDist(t), s: z.s, lx: (mx - z.x) / z.s, ly: (my - z.y) / z.s };
        return;
      }
      if (t.length !== 1) return;
      // Doppeltippen: auf 2,5× an dieser Stelle bzw. zurück
      const now = Date.now();
      const p = [t[0].clientX, t[0].clientY];
      if (now - z.tap < 300 && z.tapXY && Math.hypot(p[0] - z.tapXY[0], p[1] - z.tapXY[1]) < 30) {
        e.preventDefault();
        z.tap = 0;
        if (z.s > 1.001) z.s = 1;
        else {
          const [lx, ly] = zoomLocal(...p);
          z.s = 2.5;
          z.x = lx - lx * 2.5;
          z.y = ly - ly * 2.5;
        }
        zoomClamp();
        zoomApply();
        return;
      }
      z.tap = now;
      z.tapXY = p;
      if (z.s > 1.001) {
        e.preventDefault(); // vergrößert: mit einem Finger verschieben statt die Seite zu scrollen
        z.start = { two: false, cx: p[0], cy: p[1], x: z.x, y: z.y };
      } else z.start = null;
    },
    { passive: false }
  );
  box.addEventListener(
    'touchmove',
    (e) => {
      const z = own();
      if (!z.start) return;
      const t = e.touches;
      if (z.start.two && t.length === 2) {
        e.preventDefault();
        const [mx, my] = zoomLocal(...touchMid(t));
        z.s = z.start.s * (touchDist(t) / z.start.d);
        z.x = mx - z.start.lx * z.s;
        z.y = my - z.start.ly * z.s;
      } else if (!z.start.two && t.length === 1) {
        e.preventDefault();
        z.x = z.start.x + (t[0].clientX - z.start.cx);
        z.y = z.start.y + (t[0].clientY - z.start.cy);
      } else return;
      zoomClamp();
      zoomApply();
    },
    { passive: false }
  );
  box.addEventListener('touchend', (e) => {
    const z = own();
    if (!z.start || e.touches.length) return;
    z.start = null;
    if (z.s < 1.08) {
      z.s = 1;
      zoomClamp();
      zoomApply();
    }
  });
}

/* ================================================================
   Neue Akte fliegt an ihren Platz in der Aktenliste (11-formulare.js, new-case)
   ================================================================ */
/** Vor dem Seitenwechsel: das Formular-Fenster beim Schließen stehen lassen (fadeOutModal). */
function holdModalGhost() {
  st.ghostHold = morphOk();
}
/**
 * Nach dem Seitenwechsel: das stehen gelassene Fenster zieht sich in die Zeile der neuen Akte zusammen, die Zeile leuchtet
 * kurz golden nach. Ergebnis: die Zeile (für „Akte fliegt auf“) oder null, wenn sie nicht zu sehen ist.
 */
async function landInRow(caseId) {
  const ghost = st.heldGhost;
  st.heldGhost = null;
  st.ghostHold = false;
  const row = $(`#content [data-action="open-case"][data-id="${caseId}"]`);
  const r = row && row.getBoundingClientRect();
  const card = ghost && ghost.querySelector('.modal-card');
  if (!ghost || !card || !inView(r) || !morphOk()) {
    if (ghost) {
      ghost.classList.remove('ghost-hold'); // normales Ausblenden
      setTimeout(() => ghost.remove(), 240);
    }
    return inView(r) ? row : null;
  }
  ghost.classList.remove('ghost-hold');
  ghost.classList.add('morph-out');
  await card
    .animate([{ clipPath: 'inset(0px 0px 0px 0px round 20px)', opacity: 1 }, { clipPath: morphClip(card, r), opacity: 0.3 }], { duration: MORPH_MS - 40, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
    .finished.catch(() => {});
  ghost.remove();
  row.classList.add('row-arrive');
  setTimeout(() => row.classList.remove('row-arrive'), 1700);
  await new Promise((res) => setTimeout(res, 260)); // kurz sehen, wo sie liegt – dann öffnet sie sich aus der Zeile
  return row.isConnected ? row : null;
}

/* ================================================================
   Kachel der Übersicht bzw. Menüpunkt: die Überschrift der neuen Seite fliegt von dort an ihren Platz – wie
   Aktenzeichen und Titel beim Öffnen einer Akte. Die Seite selbst ist sofort da und bedienbar.
   ================================================================ */
const heroOk = () => flyOk();
document.addEventListener(
  'click',
  (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('#content a.kpi[href^="#"], #nav a.nav-item[href^="#"]') : null;
    if (!a || !heroOk()) return;
    const view = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!view || view === st.view) return;
    // Menüpunkt: nur mit fester Seitenleiste (am Handy schließt das Menü ohnehin)
    const nav = a.classList.contains('nav-item');
    if (nav && !window.matchMedia('(min-width: 1024px)').matches) return;
    st.heroFrom = { view, label: nav ? a.querySelector('span') || a : a.querySelector('.kpi-label') || a, tile: nav ? null : a };
  },
  true
);
/** go(): Quelle des Klicks für diese Seite (oder null). */
function takeHero(view) {
  const h = st.heroFrom;
  st.heroFrom = null;
  return h && h.view === view && h.label.isConnected && heroOk() ? h : null;
}
/** Seitenwechsel aus einer Kachel/einem Menüpunkt: Startpunkt merken, die Kachel blendet an ihrem Platz aus. */
function heroGo(h, update) {
  st.heroRect = { rect: h.label.getBoundingClientRect(), view: h.view, at: Date.now() };
  if (h.tile) {
    const r = h.tile.getBoundingClientRect();
    const ghost = h.tile.cloneNode(true);
    ghost.removeAttribute('href');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('hero-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '30', pointerEvents: 'none' });
    document.body.appendChild(ghost);
    ghost
      .animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 280, easing: 'ease-out', fill: 'forwards' })
      .finished.catch(() => {})
      .then(() => ghost.remove());
  }
  return update();
}
/** renderView: die neue Überschrift fliegt vom gemerkten Startpunkt an ihren Platz. */
function heroLand() {
  const h = st.heroRect;
  if (!h || h.view !== st.view) return;
  st.heroRect = null;
  const title = $('#content .page-title');
  if (!title || Date.now() - h.at > 1500) return; // Seite kam zu spät – dann ohne Flug
  const to = title.getBoundingClientRect();
  if (!to.height || !h.rect.height) return;
  const s = Math.min(1, h.rect.height / to.height);
  title.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${h.rect.left - to.left}px, ${h.rect.top - to.top}px) scale(${s})`, opacity: 0.35 },
      { transformOrigin: '0 0', transform: 'none', opacity: 1 },
    ],
    { duration: 440, easing: FLY_EASE }
  );
}

/* ================================================================
   Akten-Chat: gesendete Nachricht gleitet aus dem Eingabefeld an ihren Platz (05-akte-kalender-post.js)
   ================================================================ */
/** from: Rechteck des Eingabefelds vor dem Leeren. Ergebnis: die Animation (oder null). */
function chatFly(msgEl, from) {
  const bubble = msgEl && msgEl.querySelector('.chat-bubble');
  if (!bubble || !from || !flyOk()) return null;
  const to = bubble.getBoundingClientRect();
  if (!to.height) return null;
  const frames = [
    { transform: `translate(${Math.round(from.left + 10 - to.left)}px, ${Math.round(from.top - to.top)}px)`, opacity: 0.35 },
    { transform: 'none', opacity: 1 },
  ];
  const anim = bubble.animate(frames, { duration: 340, easing: FLY_EASE });
  anim.psFrames = frames;
  return anim;
}
/** Die gespeicherte Nachricht ersetzt die vorläufige mitten im Gleiten: dort weitermachen. */
function chatFlyContinue(anim, msgEl) {
  if (!anim || anim.playState !== 'running' || !msgEl) return;
  const bubble = msgEl.querySelector('.chat-bubble');
  if (!bubble) return;
  const next = bubble.animate(anim.psFrames, { duration: 340, easing: FLY_EASE });
  next.currentTime = anim.currentTime;
}

/* ================================================================
   Statistik: Säulen und Balken wachsen beim Öffnen der Seite auf ihren Wert (nicht bei jedem Neuzeichnen)
   ================================================================ */
function growBars(root) {
  if (!root || !flyOk()) return;
  root.querySelectorAll('.vchart-cols').forEach((cols) =>
    [...cols.children].forEach((col, i) =>
      col.querySelectorAll('.vchart-bar').forEach((bar) => {
        if (bar.style.height) bar.animate([{ height: '0%' }, { height: bar.style.height }], { duration: 700, delay: i * 35, easing: FLY_EASE, fill: 'backwards' });
      })
    )
  );
  root.querySelectorAll('.hbar-fill, .stat-meter > span').forEach((bar, i) => {
    if (bar.style.width) bar.animate([{ width: '0%' }, { width: bar.style.width }], { duration: 750, delay: Math.min(i, 12) * 40, easing: FLY_EASE, fill: 'backwards' });
  });
}
