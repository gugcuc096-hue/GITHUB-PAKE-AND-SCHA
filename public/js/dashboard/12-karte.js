/*
 * Kanzlei-Dashboard – Tatort-Karte in der Akte: Orte (Tatort, Festnahme, Fundort, Fahrzeug …) mit der Postleitzahl der FiveM-Karte
 * von San Andreas, als Stecknadeln auf einer Karte, die aus den Postal-Koordinaten selbst gezeichnet wird (siehe places.js).
 * Ziehen verschiebt, Mausrad bzw. zwei Finger zoomen, ein Klick wählt den nächsten Postal – wie das Skript im Spiel. Ein Regler
 * zeigt den Ablauf nach Zeitpunkt. Nur die Kanzlei sieht die Orte. Als Untergrund dient das Kartenbild „GTA V Postal Code Map“
 * (SiphonalGaming, Nummern und Titel retuschiert), ausgerichtet auf die Postal-Koordinaten; fehlt das Bild, leuchten die Postals selbst.
 * Die 3D-Ansicht (Drehen und Kippen) steht in 12-karte3d.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const PLACE_KINDS = {
  tatort: ['Tatort', 'red', '#f87171'],
  festnahme: ['Festnahme', 'amber', '#fbbf24'],
  zeuge: ['Zeuge gesehen', 'sky', '#7dd3fc'],
  fundort: ['Fundort', 'emerald', '#6ee7b7'],
  fahrzeug: ['Fahrzeug', 'slate', '#cbd5e1'],
  sonstiges: ['Sonstiges', 'gold', '#f1d27a'],
};
// Spielkoordinaten (x nach Osten, y nach Norden): ganze Karte und der Ausschnitt um Los Santos
const KMAP_WORLD = { minX: -3600, maxX: 3900, minY: -3600, maxY: 6900 };
const KMAP_CITY = { minX: -2300, maxX: 1600, minY: -3300, maxY: 1500 };
// Orientierungspunkte (ungefähre Lage) – nur beim Herauszoomen beschriftet
const KMAP_LANDMARKS = [
  ['Los Santos', 150, -900],
  ['Flughafen LSIA', -1030, -2730],
  ['Del Perro', -1850, -1230],
  ['Vinewood', 400, 250],
  ['Fort Zancudo', -2000, 3100],
  ['Sandy Shores', 1850, 3700],
  ['Bolingbroke', 1700, 2580],
  ['Grapeseed', 2500, 4800],
  ['Mt. Chiliad', 450, 5600],
  ['Paleto Bay', -120, 6200],
];

// Lage des Kartenbilds (2000 × 2000 px) in Spielkoordinaten – per Abgleich der 1.687 Postals mit den Straßen des Bildes ermittelt
const KMAP_IMG = { src: '/img/karte-gta.webp', minX: -5743.6, maxX: 6674.9, minY: -4081.2, maxY: 8389.9 };
let kImg = null; // geladenes Kartenbild (oder null, solange es lädt bzw. fehlt)
let kImgState = '';
let kWater = '#12a9d4'; // Farbe des Meeres am Bildrand – füllt alles um das Bild herum

/** Kartenbild einmal laden; danach zeichnen sich alle offenen Karten neu. */
function karteImage() {
  if (kImgState) return;
  kImgState = 'loading';
  const im = new Image();
  im.onload = () => {
    kImg = im;
    kImgState = 'ready';
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const cx = c.getContext('2d');
      cx.drawImage(im, 0, 0, 40, 40, 0, 0, 1, 1);
      const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
      kWater = `rgb(${r},${g},${b})`;
    } catch {
      /* Standardfarbe bleibt */
    }
    kViews.forEach((v) => v.draw());
  };
  im.onerror = () => {
    kImgState = 'failed';
  };
  im.src = KMAP_IMG.src;
}

let kPostals = null; // { list: [[code, x, y]], by: Map }
let kGlow = null; // vorgezeichnete Leuchtfläche der Postals (Los Santos, Sandy Shores, Paleto …)
const kViews = new Map(); // Canvas-ID → Karte

async function karteLoadPostals() {
  if (!kPostals) {
    const r = await api.get('/api/places/postals');
    kPostals = { list: r.postals, by: new Map(r.postals.map((p) => [p[0], p])) };
  }
  return kPostals;
}

/** Leuchtfläche: jeder Postal strahlt so weit wie der Abstand zu seinen Nachbarn – dicht bebaute Gebiete leuchten stärker. */
function karteGlow() {
  if (kGlow || !kPostals) return kGlow;
  const W = KMAP_WORLD;
  const w = 1500;
  const h = Math.round((w * (W.maxY - W.minY)) / (W.maxX - W.minX));
  const k = w / (W.maxX - W.minX);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d');
  x.globalCompositeOperation = 'lighter';
  const list = kPostals.list;
  for (const p of list) {
    const d = [];
    for (const q of list) if (q !== p) d.push(Math.hypot(p[1] - q[1], p[2] - q[2]));
    d.sort((a, b) => a - b);
    const r = Math.max(45, Math.min(380, ((d[0] + d[1] + d[2]) / 3) * 1.1)) * k;
    const cx = (p[1] - W.minX) * k;
    const cy = (W.maxY - p[2]) * k;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(70,120,190,.22)');
    g.addColorStop(1, 'rgba(70,120,190,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, 7);
    x.fill();
  }
  kGlow = cv;
  return kGlow;
}

/** Nächster Postal zu einer Position (wie das Skript im Spiel). */
function karteNearest(x, y) {
  let best = null;
  let bd = Infinity;
  for (const p of kPostals.list) {
    const d = (p[1] - x) ** 2 + (p[2] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

class KarteView {
  constructor(canvas, { pins = [], onPick = null, onPin = null, active = true } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.pins = pins;
    this.onPick = onPick;
    this.onPin = onPin;
    this.sel = null; // { x, y, code } – gewählter Punkt
    this.hl = null; // hervorgehobene Nadel (ID)
    this.dim = new Set(); // ausgeblendete Nadeln (Zeitregler)
    this.view = { cx: 0, cy: 0, s: 0.1 };
    this.ptr = new Map();
    this.moved = 0;
    this.W = 0;
    this.H = 0;
    this.inset = 52; // rechts liegt die Werkzeugleiste – Nadeln sollen nicht darunter landen
    this.m3 = null; // 3D-Ansicht (12-karte3d.js), solange eingeschaltet
    this.setActive(active);
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize(true);
  }

  /** Auf Touch-Geräten scrollt ein Finger zunächst die Seite; „Karte bedienen“ gibt die Fläche für Ziehen und Zoomen frei. */
  setActive(on) {
    this.active = on;
    this.cv.style.touchAction = on ? 'none' : 'pan-y';
    this.cv.classList.toggle('is-active', on);
  }

  resize(first = false) {
    const r = this.cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const d = window.devicePixelRatio || 1;
    this.W = r.width;
    this.H = r.height;
    this.cv.width = Math.round(r.width * d);
    this.cv.height = Math.round(r.height * d);
    this.dpr = d;
    if (this.m3) this.m3.resize();
    if (first || !this.fitted) this.fit();
    else this.draw();
  }

  minScale() {
    return Math.min(this.W / (KMAP_WORLD.maxX - KMAP_WORLD.minX), this.H / (KMAP_WORLD.maxY - KMAP_WORLD.minY)) * 0.95;
  }

  /** Ausschnitt wählen: alle Nadeln (mit Rand, mindestens ein Stadtteil groß) – ohne Nadeln Los Santos. */
  fit() {
    if (!this.W) return;
    if (this.m3) return this.m3.fit();
    let box = KMAP_CITY;
    if (this.pins.length) {
      const xs = this.pins.map((p) => p.x);
      const ys = this.pins.map((p) => p.y);
      const pad = 160;
      box = { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
    }
    const w = Math.max(box.maxX - box.minX, 500);
    const h = Math.max(box.maxY - box.minY, 500);
    this.view.s = Math.max(this.minScale(), Math.min(4, Math.min((this.W - this.inset) / w, this.H / h)));
    this.view.cx = (box.minX + box.maxX) / 2 + this.inset / 2 / this.view.s;
    this.view.cy = (box.minY + box.maxY) / 2;
    this.fitted = true;
    this.draw();
  }

  sx(x) {
    return (x - this.view.cx) * this.view.s + this.W / 2;
  }
  sy(y) {
    return this.H / 2 - (y - this.view.cy) * this.view.s;
  }
  wx(px) {
    return (px - this.W / 2) / this.view.s + this.view.cx;
  }
  wy(py) {
    return (this.H / 2 - py) / this.view.s + this.view.cy;
  }

  setPins(pins) {
    this.pins = pins;
    this.draw();
  }
  setSelection(sel) {
    this.sel = sel;
    this.draw();
  }
  highlight(id) {
    this.hl = id;
    this.draw();
  }
  setDim(ids) {
    this.dim = new Set(ids);
    this.draw();
  }
  focus(x, y, s = 1.2) {
    if (this.m3) return this.m3.focus(x, y, s);
    this.view.s = Math.max(this.minScale(), Math.min(4, Math.max(this.view.s, s)));
    this.view.cx = x + this.inset / 2 / this.view.s;
    this.view.cy = y;
    this.draw();
  }
  zoom(f, px = this.W / 2, py = this.H / 2) {
    if (this.m3) return this.m3.zoomBy(f);
    const before = { x: this.wx(px), y: this.wy(py) };
    this.view.s = Math.max(this.minScale(), Math.min(4, this.view.s * f));
    this.view.cx += before.x - this.wx(px);
    this.view.cy += before.y - this.wy(py);
    this.draw();
  }

  bind() {
    const cv = this.cv;
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        this.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      this.ptr.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, type: e.pointerType });
      this.moved = 0;
      this.pinch = this.ptr.size === 2 ? this.pinchState() : null;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.ptr.get(e.pointerId);
      const r = cv.getBoundingClientRect();
      const nx = e.clientX - r.left;
      const ny = e.clientY - r.top;
      if (!p) return this.hover(nx, ny);
      const dx = nx - p.x;
      const dy = ny - p.y;
      p.x = nx;
      p.y = ny;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.m3) {
        if (this.ptr.size === 2) {
          const now = this.pinchState();
          if (this.pinch && this.pinch.d > 0) this.m3.zoomBy(now.d / this.pinch.d);
          if (this.pinch) this.m3.pan(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
          this.pinch = now;
          this.m3.draw();
        } else if (this.moved > 4) this.m3.drag(dx, dy, e.shiftKey || (e.buttons & 2) === 2);
      } else if (this.ptr.size === 2) {
        const now = this.pinchState();
        if (this.pinch && this.pinch.d > 0) this.zoom(now.d / this.pinch.d, now.cx, now.cy);
        this.view.cx -= (now.cx - this.pinch.cx) / this.view.s;
        this.view.cy += (now.cy - this.pinch.cy) / this.view.s;
        this.pinch = now;
        this.draw();
      } else if (this.moved > 4) {
        this.view.cx -= dx / this.view.s;
        this.view.cy += dy / this.view.s;
        this.draw();
      }
    });
    const up = (e) => {
      const p = this.ptr.get(e.pointerId);
      this.ptr.delete(e.pointerId);
      this.pinch = null;
      if (!p || e.type === 'pointercancel' || this.moved > 6 || this.ptr.size) return;
      this.click(p.x, p.y);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => {
      if (this.m3) e.preventDefault();
    });
    cv.addEventListener('dblclick', (e) => {
      const r = cv.getBoundingClientRect();
      this.zoom(2, e.clientX - r.left, e.clientY - r.top);
    });
  }

  pinchState() {
    const [a, b] = [...this.ptr.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  pinAt(px, py) {
    if (this.m3) return this.m3.pinAt(px, py);
    let best = null;
    let bd = 16 * 16;
    for (const p of this.pins) {
      const d = (this.sx(p.x) - px) ** 2 + (this.sy(p.y) - py) ** 2;
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  hover(px, py) {
    this.cv.style.cursor = this.pinAt(px, py) ? 'pointer' : this.onPick ? 'crosshair' : 'grab';
  }

  click(px, py) {
    const pin = this.pinAt(px, py);
    if (pin && this.onPin) return this.onPin(pin);
    if (!this.onPick || !kPostals) return;
    const g = this.m3 ? this.m3.groundAt(px, py) : null;
    if (this.m3 && !g) return;
    const x = g ? g.x : this.wx(px);
    const y = g ? g.y : this.wy(py);
    const p = karteNearest(x, y);
    if (p) this.onPick({ x: p[1], y: p[2], code: p[0] });
  }

  draw() {
    if (!this.W || !kPostals) return;
    if (this.m3) return this.m3.draw();
    const x = this.ctx;
    const { s } = this.view;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = x.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#060f1e');
    bg.addColorStop(1, '#0a1830');
    x.fillStyle = kImg ? kWater : bg;
    x.fillRect(0, 0, this.W, this.H);
    if (kImg) {
      const I = KMAP_IMG;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(kImg, this.sx(I.minX), this.sy(I.maxY), (I.maxX - I.minX) * s, (I.maxY - I.minY) * s);
      x.fillStyle = 'rgba(6,15,30,.18)';
      x.fillRect(0, 0, this.W, this.H);
    }
    const g = kImg ? null : karteGlow();
    if (g) x.drawImage(g, this.sx(KMAP_WORLD.minX), this.sy(KMAP_WORLD.maxY), (KMAP_WORLD.maxX - KMAP_WORLD.minX) * s, (KMAP_WORLD.maxY - KMAP_WORLD.minY) * s);
    // Postals
    const vis = [];
    x.fillStyle = kImg ? 'rgba(8,24,60,.7)' : 'rgba(241,210,122,.75)';
    const dot = Math.max(1, Math.min(2.4, s * 3));
    for (const p of kPostals.list) {
      const px = this.sx(p[1]);
      const py = this.sy(p[2]);
      if (px < -10 || py < -10 || px > this.W + 10 || py > this.H + 10) continue;
      vis.push([p[0], px, py]);
      x.fillRect(px - dot / 2, py - dot / 2, dot, dot);
    }
    if (vis.length <= 150) {
      x.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      x.textBaseline = 'middle';
      if (kImg) {
        x.lineWidth = 3;
        x.strokeStyle = 'rgba(255,255,255,.85)';
        x.fillStyle = '#0b1d3a';
        for (const [code, px, py] of vis) {
          x.strokeText(code, px + 4, py - 6);
          x.fillText(code, px + 4, py - 6);
        }
      } else {
        x.fillStyle = 'rgba(203,213,225,.8)';
        for (const [code, px, py] of vis) x.fillText(code, px + 4, py - 6);
      }
    }
    // Orientierung
    if (s < 0.2) {
      x.font = '600 11px system-ui, sans-serif';
      x.textBaseline = 'middle';
      x.textAlign = 'center';
      x.lineWidth = 3;
      x.strokeStyle = kImg ? 'rgba(255,255,255,.9)' : 'rgba(6,15,30,.8)';
      x.fillStyle = kImg ? '#0b1d3a' : 'rgba(148,163,184,.85)';
      for (const [name, lx, ly] of KMAP_LANDMARKS) {
        x.strokeText(name, this.sx(lx), this.sy(ly));
        x.fillText(name, this.sx(lx), this.sy(ly));
      }
      x.textAlign = 'start';
    }
    // gewählter Punkt
    if (this.sel) {
      const px = this.sx(this.sel.x);
      const py = this.sy(this.sel.y);
      x.strokeStyle = kImg ? '#e11d48' : '#f1d27a';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(px, py, 14, 0, 7);
      x.stroke();
      x.beginPath();
      x.moveTo(px - 22, py);
      x.lineTo(px - 8, py);
      x.moveTo(px + 8, py);
      x.lineTo(px + 22, py);
      x.moveTo(px, py - 22);
      x.lineTo(px, py - 8);
      x.moveTo(px, py + 8);
      x.lineTo(px, py + 22);
      x.stroke();
    }
    // Nadeln
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    this.pins.forEach((p, i) => {
      const px = this.sx(p.x);
      const py = this.sy(p.y);
      if (px < -20 || py < -20 || px > this.W + 20 || py > this.H + 20) return;
      const color = (PLACE_KINDS[p.kind] || PLACE_KINDS.sonstiges)[2];
      x.globalAlpha = this.dim.has(p.id) ? 0.22 : 1;
      if (this.hl === p.id) {
        x.strokeStyle = color;
        x.lineWidth = 2;
        x.beginPath();
        x.arc(px, py, 15, 0, 7);
        x.stroke();
      }
      x.fillStyle = color;
      x.strokeStyle = '#06101f';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(px, py, 10, 0, 7);
      x.fill();
      x.stroke();
      x.fillStyle = '#06101f';
      x.font = '700 10px system-ui, sans-serif';
      x.fillText(String(i + 1), px, py + 0.5);
      x.globalAlpha = 1;
    });
    x.textAlign = 'start';
    // Maßstab
    const nice = [100, 200, 500, 1000, 2000];
    const len = nice.find((n) => n * s >= 60) || 2000;
    x.strokeStyle = 'rgba(203,213,225,.7)';
    x.fillStyle = 'rgba(203,213,225,.85)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(12, this.H - 14);
    x.lineTo(12 + len * s, this.H - 14);
    x.stroke();
    x.font = '600 10px system-ui, sans-serif';
    x.textBaseline = 'alphabetic';
    x.fillText(`${len} m`, 12, this.H - 20);
  }

  destroy() {
    if (this.m3) this.m3.destroy();
    this.m3 = null;
    this.ro.disconnect();
  }
}

/** Karte an eine Zeichenfläche hängen (eine ältere Karte mit gleicher ID wird zuvor abgebaut). */
async function karteMount(id, opts) {
  const cv = document.getElementById(id);
  if (!cv) return null;
  if (kViews.has(id)) kViews.get(id).destroy();
  await karteLoadPostals();
  if (!cv.isConnected) return null;
  karteImage();
  const v = new KarteView(cv, opts);
  kViews.set(id, v);
  return v;
}

/* ---------------------------------------------------------------- Abschnitt in der Akte */
const placePins = () => (st.casePlaces || []).map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind }));

function karteSection(c, places = []) {
  if (!isStaff()) return '';
  if (!places.length && !c.canEdit) return '';
  const add = c.canEdit ? `<button type="button" class="btn-outline btn-sm" data-action="place-add" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Ort hinzufügen</span></button>` : '';
  const timed = places.filter((p) => p.happenedAt).length;
  return `<div class="section" id="secKarte"><div class="section-head"><h3 class="section-title">Tatort-Karte <span class="text-xs text-dim font-normal sec-meta">${places.length ? `${places.length} Ort${places.length === 1 ? '' : 'e'}` : 'noch keine'}</span></h3>${add}</div>
      <div class="kmap-wrap" id="kmapWrap"><canvas id="kmapMini" class="kmap" aria-label="Karte der Orte dieser Akte"></canvas>
        <div class="kmap-tools" role="group" aria-label="Karte">
          <button type="button" class="icon-btn sm" data-action="kmap-zoom" data-id="kmapMini" data-f="1.6" aria-label="Hineinzoomen">${icon('plus', 'ico-sm')}</button>
          <button type="button" class="icon-btn sm" data-action="kmap-zoom" data-id="kmapMini" data-f="0.625" aria-label="Herauszoomen"><span aria-hidden="true">−</span></button>
          <button type="button" class="icon-btn sm" data-action="kmap-fit" data-id="kmapMini" aria-label="Alle Orte zeigen" title="Alle Orte zeigen">${icon('pin', 'ico-sm')}</button>
          <button type="button" class="icon-btn sm kmap-3d" data-action="kmap-3d" data-id="kmapMini" aria-label="3D-Ansicht ein- oder ausschalten" title="3D-Ansicht (drehen und kippen)"><span aria-hidden="true">3D</span></button>
          <button type="button" class="icon-btn sm" data-action="kmap-big" aria-label="Karte größer oder kleiner" title="Größer / kleiner">${icon('expand', 'ico-sm')}</button>
          <button type="button" class="icon-btn sm kmap-touch" data-action="kmap-touch" data-id="kmapMini" aria-label="Karte mit dem Finger bedienen" title="Karte mit dem Finger bedienen">${icon('grip', 'ico-sm')}</button>
        </div></div>
      ${timed > 1 ? `<label class="kmap-time"><span class="text-xs text-dim">Ablauf</span><input type="range" id="kmapTime" min="1" max="${places.length}" value="${places.length}" aria-label="Orte bis zu einem Zeitpunkt zeigen"><output id="kmapTimeOut" class="text-xs font-mono"></output></label>` : ''}
      ${
        places.length
          ? `<ol class="place-list">${places.map((p, i) => placeRow(c, p, i)).join('')}</ol>`
          : '<p class="text-sm text-dim">Tatort, Festnahme, Fundort oder Fahrzeug mit der Postleitzahl der FiveM-Karte festhalten – die Orte erscheinen hier als Nadeln.</p>'
      }
    </div>`;
}

function placeRow(c, p, i) {
  const [label, tone, color] = PLACE_KINDS[p.kind] || PLACE_KINDS.sonstiges;
  return `<li class="place-row" data-place="${p.id}"><button type="button" class="place-main" data-action="place-focus" data-id="${p.id}">
      <span class="place-no" style="background:${color}">${i + 1}</span>
      <span class="place-body"><span class="place-top">${badge(label, tone)}<span class="font-mono text-gold">Postal ${esc(p.postal)}</span>${p.happenedAt ? `<span class="text-xs text-dim">${esc(fmtDate(p.happenedAt))}</span>` : ''}</span>
        ${p.label ? `<span class="place-label">${esc(p.label)}</span>` : ''}${p.note ? `<span class="place-note">${esc(p.note)}</span>` : ''}</span></button>
      ${c.canEdit ? `<span class="place-actions"><button type="button" class="icon-btn sm" data-action="place-edit" data-case-id="${c.id}" data-id="${p.id}" aria-label="Ort bearbeiten">${icon('edit', 'ico-sm')}</button><button type="button" class="icon-btn sm" data-action="place-del" data-case-id="${c.id}" data-id="${p.id}" aria-label="Ort entfernen">${icon('trash', 'ico-sm')}</button></span>` : ''}</li>`;
}

/** Nach dem Zeichnen der Akte: Karte starten, Liste und Regler verbinden. */
async function karteInit() {
  if (!isStaff() || !document.getElementById('kmapMini')) return;
  const pins = placePins();
  const v = await karteMount('kmapMini', { pins, onPin: (p) => placeFocus(p.id) });
  if (!v) return;
  const range = document.getElementById('kmapTime');
  if (range) {
    const out = document.getElementById('kmapTimeOut');
    const places = st.casePlaces || [];
    const apply = () => {
      const n = Number(range.value);
      v.setDim(places.slice(n).map((p) => p.id));
      const last = places[n - 1];
      if (out) out.textContent = last && last.happenedAt ? fmtDate(last.happenedAt) : `${n} / ${places.length}`;
      document.querySelectorAll('.place-row').forEach((li, i) => li.classList.toggle('is-later', i >= n));
    };
    range.addEventListener('input', apply);
    apply();
  }
}

function placeFocus(id) {
  const p = (st.casePlaces || []).find((x) => x.id === id);
  const v = kViews.get('kmapMini');
  if (!p || !v) return;
  v.focus(p.x, p.y, 1.4);
  v.highlight(id);
  document.querySelectorAll('.place-row').forEach((li) => li.classList.toggle('is-on', Number(li.dataset.place) === id));
  const li = document.querySelector(`.place-row[data-place="${id}"]`);
  if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------------------------------------------------------------- Formular */
function placeForm(caseId, p) {
  const v = p || { kind: 'tatort', postal: '', label: '', note: '', happenedAt: null };
  return `<h2 class="modal-title">${p ? 'Ort bearbeiten' : 'Ort hinzufügen'}</h2>
    <p class="modal-sub">Auf die Karte tippen – der nächste Postal wird gewählt – oder die Postleitzahl eingeben.</p>
    <div class="kmap-wrap kmap-form"><canvas id="kmapForm" class="kmap" aria-label="Karte zum Auswählen des Ortes"></canvas>
      <div class="kmap-tools" role="group" aria-label="Karte">
        <button type="button" class="icon-btn sm" data-action="kmap-zoom" data-id="kmapForm" data-f="1.6" aria-label="Hineinzoomen">${icon('plus', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="kmap-zoom" data-id="kmapForm" data-f="0.625" aria-label="Herauszoomen"><span aria-hidden="true">−</span></button>
        <button type="button" class="icon-btn sm" data-action="kmap-fit" data-id="kmapForm" aria-label="Los Santos zeigen" title="Los Santos zeigen">${icon('pin', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm kmap-3d" data-action="kmap-3d" data-id="kmapForm" aria-label="3D-Ansicht ein- oder ausschalten" title="3D-Ansicht (drehen und kippen)"><span aria-hidden="true">3D</span></button>
      </div></div>
    <form data-form="place-save" data-case-id="${caseId}" ${p ? `data-id="${p.id}"` : ''} class="form-grid cols-2">
      <div><label class="label" for="plKind">Art</label><select id="plKind" name="kind" class="field">${Object.entries(PLACE_KINDS).map(([k, [l]]) => opt(k, l, v.kind === k)).join('')}</select></div>
      <div><label class="label" for="plPostal">Postleitzahl</label><input id="plPostal" name="postal" class="field font-mono" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="z. B. 7152" value="${esc(v.postal)}" required>
        <p id="plHint" class="form-hint" aria-live="polite">Wird beim Tippen auf der Karte gezeigt.</p></div>
      <div class="span-2"><label class="label" for="plLabel">Beschriftung</label><input id="plLabel" name="label" class="field" maxlength="80" value="${esc(v.label)}" placeholder="z. B. Tankstelle Little Seoul, Fluchtweg nach Norden"></div>
      <div><label class="label" for="plWhen">Zeitpunkt (optional)</label><input id="plWhen" name="happenedAt" type="datetime-local" class="field" value="${v.happenedAt ? esc(toLocalInput(v.happenedAt)) : ''}"></div>
      <div></div>
      <div class="span-2"><label class="label" for="plNote">Notiz</label><textarea id="plNote" name="note" rows="3" maxlength="1000" class="field" placeholder="Was geschah hier? Beweise wie B7 werden anklickbar.">${esc(v.note)}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${p ? 'Speichern' : 'Hinzufügen'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

/** Karte im Formular: Klick wählt den Postal, Eingabe der Postleitzahl springt dorthin. */
async function placeFormInit(p) {
  const input = document.getElementById('plPostal');
  const hint = document.getElementById('plHint');
  if (!input) return;
  const show = (code) => {
    const hit = kPostals && kPostals.by.get(code);
    hint.textContent = hit ? `Postal ${code} gefunden.` : code ? 'Diese Postleitzahl gibt es auf der Karte nicht.' : 'Wird beim Tippen auf der Karte gezeigt.';
    hint.classList.toggle('text-red-300', !!code && !hit);
    return hit;
  };
  const v = await karteMount('kmapForm', {
    pins: p ? [{ id: p.id, x: p.x, y: p.y, kind: p.kind }] : [],
    onPick: ({ x, y, code }) => {
      input.value = code;
      input.dataset.x = String(x);
      input.dataset.y = String(y);
      v.setSelection({ x, y, code });
      show(code);
    },
    active: true,
  });
  if (!v) return;
  if (p) v.setSelection({ x: p.x, y: p.y, code: p.postal });
  input.addEventListener('input', () => {
    delete input.dataset.x;
    delete input.dataset.y;
    const hit = show(input.value.trim());
    if (hit) {
      v.setSelection({ x: hit[1], y: hit[2], code: hit[0] });
      v.focus(hit[1], hit[2], 1.1);
    } else v.setSelection(null);
  });
  show(input.value.trim());
}

Object.assign(actions, {
  'place-add': async (el) => {
    openModal(placeForm(Number(el.dataset.caseId), null), { wide: true, child: true });
    await placeFormInit(null);
  },
  'place-edit': async (el) => {
    const p = (st.casePlaces || []).find((x) => x.id === Number(el.dataset.id));
    if (!p) return;
    openModal(placeForm(Number(el.dataset.caseId), p), { wide: true, child: true });
    await placeFormInit(p);
  },
  'place-del': async (el) => {
    const caseId = Number(el.dataset.caseId);
    await api.del(`/api/cases/${caseId}/places/${el.dataset.id}`);
    toast('Ort entfernt.');
    await reloadCase(caseId);
  },
  'place-focus': (el) => placeFocus(Number(el.dataset.id)),
  'kmap-zoom': (el) => kViews.get(el.dataset.id)?.zoom(Number(el.dataset.f)),
  'kmap-fit': (el) => kViews.get(el.dataset.id)?.fit(),
  'kmap-big': () => {
    const w = $('#kmapWrap');
    if (!w) return;
    w.classList.toggle('is-big');
    kViews.get('kmapMini')?.resize();
  },
  'kmap-3d': async (el) => {
    const v = kViews.get(el.dataset.id);
    if (!v) return;
    const on = await karteSet3d(v, !v.m3);
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on && window.matchMedia('(hover: none)').matches && !v.active) {
      v.setActive(true);
      document.querySelectorAll(`.kmap-touch[data-id="${el.dataset.id}"]`).forEach((b) => b.classList.add('is-on'));
    }
    if (on) toast('3D: Ziehen dreht und kippt, zwei Finger bzw. Mausrad zoomen. Das Relief ist aus dem Kartenbild geschätzt.');
  },
  'kmap-touch': (el) => {
    const v = kViews.get(el.dataset.id);
    if (!v) return;
    v.setActive(!v.active);
    el.classList.toggle('is-on', v.active);
    toast(v.active ? 'Karte bedienen: Ziehen verschiebt, zwei Finger zoomen. Zum Scrollen die Hand wieder abschalten.' : 'Wischen scrollt wieder die Seite.');
  },
});

Object.assign(forms, {
  'place-save': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const fd = new FormData(f);
    const postal = val(fd, 'postal');
    const input = f.querySelector('#plPostal');
    const when = val(fd, 'happenedAt');
    const body = {
      kind: val(fd, 'kind'),
      label: val(fd, 'label'),
      note: val(fd, 'note'),
      happenedAt: when ? new Date(when).toISOString() : null,
    };
    // genauer Punkt aus dem Klick auf die Karte, sonst die Mitte des Postals
    if (input && input.dataset.x) Object.assign(body, { x: Number(input.dataset.x), y: Number(input.dataset.y) });
    else body.postal = postal;
    if (f.dataset.id) await api.patch(`/api/cases/${caseId}/places/${f.dataset.id}`, body);
    else await api.post(`/api/cases/${caseId}/places`, body);
    toast(f.dataset.id ? 'Ort gespeichert.' : 'Ort hinzugefügt.');
    await modalBack();
    await reloadCase(caseId);
  },
});
