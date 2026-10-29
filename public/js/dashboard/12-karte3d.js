/*
 * Kanzlei-Dashboard – 3D-Ansicht der Tatort-Karte: Satellitenbild auf einem Geländemodell, frei dreh- und kippbar.
 *  - Gelände: Höhenkarte /img/karte-hoehe.bin (384 × 384, 16 Bit, 0–1000 m). Sie ist geschätzt – aus Küstenabstand, Schummerung
 *    des Satellitenbilds und den bekannten Höhen der Berge (Mount Chiliad, Mount Gordo …); echte Spieldaten gibt es nicht frei.
 *  - Wasser mit Wellen, Spiegelung des Himmels und Sonnenglanz; Himmel mit Horizont und Dunst in der Ferne.
 *  - Nadeln, Tatweg und Postleitzahlen liegen als Zeichnung (2D-Fläche) darüber und werden aus der Kamera berechnet.
 * Eigenes, kleines WebGL – keine Fremdbibliothek. Ohne WebGL 2 bleibt es bei der 2D-Karte.
 * Bedienung: Ziehen dreht und kippt, Shift/rechte Taste verschiebt, Mausrad bzw. zwei Finger zoomen und verschieben.
 * Wird nach 12-karte.js geladen; KarteView ruft Karte3D nur auf, wenn die 3D-Ansicht eingeschaltet ist.
 */
'use strict';

const K3_HMAP = '/img/karte-hoehe.bin';
const K3_EXAG = 1.35; // Höhen leicht überhöht, damit das Relief wirkt
const K3_FOV = 0.8;
const K3_SKY = { horizon: [0.62, 0.74, 0.86], zenith: [0.16, 0.36, 0.62] };
const K3_SUN = (() => {
  const v = [-0.45, 0.45, 0.62]; // aus Nordwesten – wie die Schatten im Satellitenbild
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
let kTerrain = null; // { n, h: Float32Array, rect } – gemeinsam für alle Karten
let kTerrainWait = null;

const k3Clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const k3Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Höhenkarte laden (einmal); ohne Datei bleibt das Gelände flach. */
function karte3dTerrain() {
  if (kTerrain) return Promise.resolve(kTerrain);
  if (kTerrainWait) return kTerrainWait;
  kTerrainWait = fetch(K3_HMAP, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null)
    .then((buf) => {
      const n = 384;
      const h = new Float32Array(n * n);
      if (buf && buf.byteLength === n * n * 2) {
        const u = new Uint16Array(buf);
        for (let i = 0; i < u.length; i++) h[i] = (u[i] / 65535) * 1000 * K3_EXAG;
      }
      kTerrain = { n, h, rect: KMAP_LAYERS.sat };
      return kTerrain;
    });
  return kTerrainWait;
}

/** Höhe an einer Spielposition (bilinear). */
function karte3dHeight(wx, wy) {
  const t = kTerrain;
  if (!t) return 0;
  const I = t.rect;
  const u = k3Clamp((wx - I.minX) / (I.maxX - I.minX), 0, 1) * (t.n - 1);
  const v = k3Clamp((I.maxY - wy) / (I.maxY - I.minY), 0, 1) * (t.n - 1);
  const i = Math.min(t.n - 2, Math.floor(u));
  const j = Math.min(t.n - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const a = t.h[j * t.n + i];
  const b = t.h[j * t.n + i + 1];
  const c = t.h[(j + 1) * t.n + i];
  const e = t.h[(j + 1) * t.n + i + 1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + e * fu) * fv;
}

function k3Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function k3Persp(fovy, asp, near, far) {
  const t = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = t / asp;
  o[5] = t;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}
/** Blickmatrix (z zeigt nach oben); liefert auch die Blickrichtung und „rechts“/„oben“ für Strahlen und Himmel. */
function k3Look(e, c) {
  let fx = c[0] - e[0];
  let fy = c[1] - e[1];
  let fz = c[2] - e[2];
  let l = Math.hypot(fx, fy, fz);
  fx /= l;
  fy /= l;
  fz /= l;
  let sx = fy;
  let sy = -fx;
  l = Math.hypot(sx, sy) || 1;
  sx /= l;
  sy /= l;
  const ux = sy * fz;
  const uy = -sx * fz;
  const uz = sx * fy - sy * fx;
  const m = new Float32Array([sx, ux, -fx, 0, sy, uy, -fy, 0, 0, uz, -fz, 0, -(sx * e[0] + sy * e[1]), -(ux * e[0] + uy * e[1] + uz * e[2]), fx * e[0] + fy * e[1] + fz * e[2], 1]);
  return { m, f: [fx, fy, fz], r: [sx, sy, 0], u: [ux, uy, uz] };
}

// Gelände und Meer: Licht von der Sonne, Wasser (Höhe ≈ 0) mit Wellen, Himmelsspiegelung und Glanz, Dunst in der Ferne
const K3_VS = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uVP; uniform vec4 uTexR;
out vec2 vUv; out vec3 vNor; out vec3 vPos; out float vDist;
void main(){
  vUv = vec2((aPos.x - uTexR.x) / uTexR.z, (uTexR.y - aPos.y) / uTexR.w);
  vNor = aNor; vPos = aPos;
  gl_Position = uVP * vec4(aPos, 1.0); vDist = gl_Position.w;
}`;
const K3_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec3 uSun; uniform vec3 uEye; uniform vec3 uHor; uniform vec3 uZen;
uniform float uFogK; uniform float uTime;
in vec2 vUv; in vec3 vNor; in vec3 vPos; in float vDist;
out vec4 o;
void main(){
  vec3 tex = texture(uTex, clamp(vUv, 0.0005, 0.9995)).rgb;
  float edge = step(0.0, vUv.x) * step(vUv.x, 1.0) * step(0.0, vUv.y) * step(vUv.y, 1.0);
  tex = mix(vec3(0.07, 0.24, 0.42), tex, edge);
  vec3 n = normalize(vNor);
  float diff = max(dot(n, uSun), 0.0);
  vec3 land = tex * (0.58 + 0.62 * diff);
  land = mix(vec3(dot(land, vec3(0.3, 0.59, 0.11))), land, 1.12);
  float water = 1.0 - smoothstep(0.6, 3.0, vPos.z);
  vec2 p = vPos.xy * 0.018; float t = uTime;
  // Wellen werden in der Ferne flacher – sonst flimmern sie dort als Streifen
  float wa = 1.0 / (1.0 + vDist / 1800.0);
  vec3 wn = normalize(vec3(
    (sin(p.x * 1.3 + t * 0.9) * 0.05 + sin(p.y * 2.3 - t * 0.7) * 0.04 + sin((p.x + p.y) * 4.1 + t * 1.7) * 0.02 * wa) * wa,
    (cos(p.y * 1.2 + t * 0.8) * 0.05 + cos(p.x * 2.1 + t * 0.6) * 0.04 + cos((p.x - p.y) * 3.7 - t * 1.4) * 0.02 * wa) * wa, 1.0));
  vec3 v = normalize(uEye - vPos);
  float fres = pow(1.0 - max(dot(wn, v), 0.0), 4.0);
  vec3 r = reflect(-v, wn);
  vec3 sky = mix(uHor, uZen, clamp(r.z * 1.6, 0.0, 1.0));
  vec3 deep = vec3(0.03, 0.17, 0.32);
  vec3 wcol = mix(mix(deep, tex, 0.6), sky, 0.18 + 0.6 * fres);
  float spec = pow(max(dot(reflect(-uSun, wn), v), 0.0), 160.0);
  wcol += vec3(1.0, 0.95, 0.82) * spec * 1.4;
  vec3 c = mix(land, wcol, water);
  float fog = clamp(1.0 - exp(-vDist * uFogK), 0.0, 1.0);
  o = vec4(mix(c, uHor, fog), 1.0);
}`;
// Himmel: Verlauf vom Horizont zum Zenit, Sonne mit Hof
const K3_SKY_VS = `#version 300 es
in vec2 aP; out vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
const K3_SKY_FS = `#version 300 es
precision highp float;
uniform vec3 uF; uniform vec3 uR; uniform vec3 uU; uniform vec2 uT; uniform vec3 uSun; uniform vec3 uHor; uniform vec3 uZen;
in vec2 vP; out vec4 o;
void main(){
  vec3 d = normalize(uF + vP.x * uT.x * uR + vP.y * uT.y * uU);
  float h = clamp(d.z, 0.0, 1.0);
  vec3 c = mix(uHor, uZen, pow(h, 0.55));
  float s = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18);
  if (d.z < 0.0) c = uHor;
  o = vec4(c, 1.0);
}`;

class Karte3D {
  constructor(host) {
    this.host = host;
    this.cam = { tx: 0, ty: 0, dist: 6000, yaw: 0, pitch: 0.95 };
    this.vp = new Float32Array(16);
    this.queued = false;
    this.flight = null;
    this.t0 = performance.now();
    this.dropAt = performance.now();
    // Bewegtes Wasser nur für Menschen: nicht bei „Bewegung reduzieren“ und nicht in automatisierten Browsern (Tests)
    this.live = !navigator.webdriver && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.ok = this.init();
  }

  init() {
    if (!kTerrain) return false;
    const gl = document.createElement('canvas');
    gl.className = 'kmap-gl';
    gl.setAttribute('aria-hidden', 'true');
    this.glc = gl;
    this.host.cv.parentNode.insertBefore(gl, this.host.cv);
    const ctx = gl.getContext('webgl2', { antialias: true, alpha: false });
    if (!ctx) {
      gl.remove();
      return false;
    }
    this.gl = ctx;
    const prog = (vs, fs) => {
      const mk = (type, src) => {
        const s = ctx.createShader(type);
        ctx.shaderSource(s, src);
        ctx.compileShader(s);
        return s;
      };
      const pr = ctx.createProgram();
      ctx.attachShader(pr, mk(ctx.VERTEX_SHADER, vs));
      ctx.attachShader(pr, mk(ctx.FRAGMENT_SHADER, fs));
      ctx.linkProgram(pr);
      return ctx.getProgramParameter(pr, ctx.LINK_STATUS) ? pr : null;
    };
    this.pr = prog(K3_VS, K3_FS);
    this.sky = prog(K3_SKY_VS, K3_SKY_FS);
    if (!this.pr || !this.sky) {
      this.destroy();
      return false;
    }
    const U = (pr, names) => Object.fromEntries(names.map((n) => [n, ctx.getUniformLocation(pr, n)]));
    this.u = U(this.pr, ['uVP', 'uTexR', 'uTex', 'uSun', 'uEye', 'uHor', 'uZen', 'uFogK', 'uTime']);
    this.us = U(this.sky, ['uF', 'uR', 'uU', 'uT', 'uSun', 'uHor', 'uZen']);
    // Gelände (+ ein großes Meer ringsum, etwas tiefer, damit an der Kante nichts flimmert)
    const n = kTerrain.n;
    const I = kTerrain.rect;
    const pos = new Float32Array((n * n + 4) * 3);
    const nor = new Float32Array((n * n + 4) * 3);
    const cw = (I.maxX - I.minX) / (n - 1);
    const ch = (I.maxY - I.minY) / (n - 1);
    const H = (i, j) => kTerrain.h[k3Clamp(j, 0, n - 1) * n + k3Clamp(i, 0, n - 1)];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos[k * 3] = I.minX + i * cw;
        pos[k * 3 + 1] = I.maxY - j * ch;
        pos[k * 3 + 2] = H(i, j);
        // Zeile j läuft nach Süden: Steigung nach Norden = (Höhe(j-1) − Höhe(j+1)) / 2 Zellen
        const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cw);
        const gy = (H(i, j - 1) - H(i, j + 1)) / (2 * ch);
        const l = Math.hypot(gx, gy, 1);
        nor[k * 3] = -gx / l;
        nor[k * 3 + 1] = -gy / l;
        nor[k * 3 + 2] = 1 / l;
      }
    }
    const SEA = 70000;
    [[-SEA, -SEA], [SEA, -SEA], [SEA, SEA], [-SEA, SEA]].forEach(([sx, sy], q) => {
      pos.set([sx, sy, -1.5], (n * n + q) * 3);
      nor.set([0, 0, 1], (n * n + q) * 3);
    });
    const idx = new Uint32Array((n - 1) * (n - 1) * 6 + 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const c = a + n;
        idx.set([a, c, a + 1, a + 1, c, c + 1], q);
        q += 6;
      }
    }
    idx.set([n * n, n * n + 1, n * n + 2, n * n, n * n + 2, n * n + 3], q);
    this.count = idx.length;
    this.vao = ctx.createVertexArray();
    ctx.bindVertexArray(this.vao);
    const buf = (data, pr, name, size) => {
      const b = ctx.createBuffer();
      ctx.bindBuffer(ctx.ARRAY_BUFFER, b);
      ctx.bufferData(ctx.ARRAY_BUFFER, data, ctx.STATIC_DRAW);
      const loc = ctx.getAttribLocation(pr, name);
      ctx.enableVertexAttribArray(loc);
      ctx.vertexAttribPointer(loc, size, ctx.FLOAT, false, 0, 0);
    };
    buf(pos, this.pr, 'aPos', 3);
    buf(nor, this.pr, 'aNor', 3);
    const ib = ctx.createBuffer();
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, ib);
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, idx, ctx.STATIC_DRAW);
    this.skyVao = ctx.createVertexArray();
    ctx.bindVertexArray(this.skyVao);
    buf(new Float32Array([-1, -1, 3, -1, -1, 3]), this.sky, 'aP', 2);
    ctx.bindVertexArray(null);
    this.tex = ctx.createTexture();
    this.texRect = kTerrain.rect;
    this.retexture(false);
    ctx.enable(ctx.DEPTH_TEST);
    this.resize();
    return true;
  }

  /** Oberfläche: das Satellitenbild (sonst das Kartenbild) als Textur hochladen. */
  retexture(redraw = true) {
    const ctx = this.gl;
    if (!ctx) return;
    const base = kLayers.sat.img ? { img: kLayers.sat.img, rect: KMAP_LAYERS.sat } : karteBase();
    if (!base) return;
    this.texRect = base.rect;
    let src = base.img;
    const maxTex = ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
    if (src.naturalWidth > maxTex) {
      // kleinere Grafikkarten (Handys): Bild auf die erlaubte Größe verkleinern
      const sm = document.createElement('canvas');
      sm.width = maxTex;
      sm.height = maxTex;
      sm.getContext('2d').drawImage(src, 0, 0, maxTex, maxTex);
      src = sm;
    }
    ctx.bindTexture(ctx.TEXTURE_2D, this.tex);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, src);
    ctx.generateMipmap(ctx.TEXTURE_2D);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR_MIPMAP_LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    const aniso = ctx.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) ctx.texParameterf(ctx.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, ctx.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    if (redraw) this.draw();
  }

  resize() {
    if (!this.gl) return;
    const c = this.host.cv;
    this.glc.width = c.width;
    this.glc.height = c.height;
    this.schedule();
  }

  /** Kamera aus der 2D-Ansicht übernehmen (Mitte und Maßstab bleiben, Blick von Süden schräg nach unten). */
  fromFlat() {
    const v = this.host.view;
    const c = this.cam;
    c.tx = v.cx - this.host.inset / 2 / v.s;
    c.ty = v.cy;
    c.dist = k3Clamp(this.host.H / (v.s * 2 * Math.tan(K3_FOV / 2)), 350, 26000);
    c.yaw = 0;
    c.pitch = 0.95;
  }

  /** Und zurück: dieselbe Mitte, derselbe Ausschnitt in der 2D-Ansicht. */
  toFlat() {
    const v = this.host.view;
    const c = this.cam;
    v.s = k3Clamp(this.host.H / (c.dist * 2 * Math.tan(K3_FOV / 2)), this.host.minScale(), KMAP_SMAX);
    v.cx = c.tx + this.host.inset / 2 / v.s;
    v.cy = c.ty;
  }

  /** Weicher Kameraflug zu einem Ziel (ohne Bewegung – etwa in Tests – sofort dort). */
  flyTo(to, ms = 1100) {
    const from = { ...this.cam };
    const goal = { ...from, ...to };
    // auf dem kürzeren Weg drehen
    goal.yaw = from.yaw + ((((goal.yaw - from.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    if (!this.live) {
      Object.assign(this.cam, goal);
      this.draw();
      return;
    }
    const start = performance.now();
    this.flight = { from, goal, start, ms };
    this.schedule();
  }

  fit() {
    const h = this.host;
    let box = KMAP_CITY;
    if (h.pins.length) {
      const xs = h.pins.map((p) => p.x);
      const ys = h.pins.map((p) => p.y);
      box = { minX: Math.min(...xs) - 160, maxX: Math.max(...xs) + 160, minY: Math.min(...ys) - 160, maxY: Math.max(...ys) + 160 };
    }
    const ext = Math.max(box.maxX - box.minX, box.maxY - box.minY, 700);
    this.flyTo({ tx: (box.minX + box.maxX) / 2, ty: (box.minY + box.maxY) / 2, dist: k3Clamp(ext * 1.5, 900, 26000), yaw: 0, pitch: 0.95 });
  }

  focus(x, y, s) {
    const dist = k3Clamp(Math.min(this.cam.dist, this.host.H / (s * 2 * Math.tan(K3_FOV / 2))), 600, 26000);
    // nicht näher als ~1,6 km – darunter wird das Satellitenbild unscharf
    this.flyTo({ tx: x, ty: y, dist: Math.max(dist, 1600), pitch: Math.min(Math.max(this.cam.pitch, 0.7), 1.05), yaw: this.cam.yaw + 0.35 });
  }

  zoomBy(f) {
    this.flight = null;
    this.cam.dist = k3Clamp(this.cam.dist / f, 300, 26000);
    this.draw();
  }

  /** Ziehen: drehen (seitwärts) und kippen (auf/ab); mit Shift oder rechter Taste verschieben. */
  drag(dx, dy, pan) {
    this.flight = null;
    const c = this.cam;
    if (pan) this.pan(dx, dy);
    else {
      c.yaw -= dx * 0.006;
      c.pitch = k3Clamp(c.pitch + dy * 0.005, 0.12, 1.45);
    }
    this.draw();
  }

  pan(dx, dy) {
    this.flight = null;
    const c = this.cam;
    const per = (2 * c.dist * Math.tan(K3_FOV / 2)) / this.host.H; // Meter je Bildpunkt
    const fx = Math.sin(c.yaw);
    const fy = Math.cos(c.yaw);
    const flat = Math.max(Math.sin(c.pitch), 0.3); // flach geneigt wirkt ein Bildpunkt senkrecht länger
    c.tx += (-dx * fy + (dy * fx) / flat) * per;
    c.ty += (dx * fx + (dy * fy) / flat) * per;
    const I = kTerrain.rect;
    c.tx = k3Clamp(c.tx, I.minX, I.maxX);
    c.ty = k3Clamp(c.ty, I.minY, I.maxY);
  }

  matrices() {
    const c = this.cam;
    const h = this.host;
    const tz = karte3dHeight(c.tx, c.ty);
    const cp = Math.cos(c.pitch);
    const eye = [c.tx - Math.sin(c.yaw) * cp * c.dist, c.ty - Math.cos(c.yaw) * cp * c.dist, tz + Math.sin(c.pitch) * c.dist];
    // nicht unter das Gelände
    eye[2] = Math.max(eye[2], karte3dHeight(eye[0], eye[1]) + 40);
    const look = k3Look(eye, [c.tx, c.ty, tz]);
    this.near = Math.max(15, c.dist * 0.01);
    this.far = c.dist * 4 + 30000;
    const proj = k3Persp(K3_FOV, h.W / h.H, this.near, this.far);
    this.vp = k3Mul(proj, look.m);
    this.eye = eye;
    this.look = look;
  }

  /** Spielposition (mit Höhe) → Bildpunkt; null, wenn hinter der Kamera. */
  project(x, y, z) {
    const m = this.vp;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0.01) return null;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    return { x: ((cx / w + 1) / 2) * this.host.W, y: ((1 - cy / w) / 2) * this.host.H, d: w };
  }

  /** Bildpunkt → Spielposition auf dem Gelände (Strahl gegen das Höhenfeld). */
  groundAt(px, py) {
    if (!this.eye) this.matrices();
    const { eye, look } = this;
    const h = this.host;
    const th = Math.tan(K3_FOV / 2);
    const nx = (px / h.W) * 2 - 1;
    const ny = 1 - (py / h.H) * 2;
    const dir = [0, 1, 2].map((i) => look.f[i] + nx * th * (h.W / h.H) * look.r[i] + ny * th * look.u[i]);
    const l = Math.hypot(...dir);
    const d = dir.map((v) => v / l);
    const at = (t) => [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
    const I = kTerrain.rect;
    let t = this.near;
    let prev = t;
    while (t < this.far) {
      const p = at(t);
      if (p[0] < I.minX || p[0] > I.maxX || p[1] < I.minY || p[1] > I.maxY) {
        if (p[2] < 0) return null;
      } else if (p[2] <= karte3dHeight(p[0], p[1])) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          const q = at(mid);
          if (q[2] <= karte3dHeight(q[0], q[1])) hi = mid;
          else lo = mid;
        }
        const q = at(hi);
        return { x: q[0], y: q[1] };
      }
      prev = t;
      t += Math.max(8, t * 0.008);
    }
    return null;
  }

  /** Nadeln am Bildschirm: Fußpunkt auf dem Gelände (Kopf liegt in der Zeichnung darüber). */
  bases() {
    return this.host.pins
      .map((p, i) => {
        const b = this.project(p.x, p.y, karte3dHeight(p.x, p.y));
        return b ? { p, i, b } : null;
      })
      .filter(Boolean);
  }

  pinAt(px, py) {
    let best = null;
    let bd = 18 * 18;
    for (const { p, b } of this.bases()) {
      const d = Math.min((b.x - px) ** 2 + (b.y - py) ** 2, (b.x - px) ** 2 + (b.y - 25 - py) ** 2);
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Nächstes Bild anfordern; solange Wasser lebt oder die Kamera fliegt, läuft es mit ~30 Bildern je Sekunde weiter. */
  schedule() {
    if (this.queued || !this.gl) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (!this.gl) return;
      this.draw();
      const busy = this.flight || performance.now() - this.dropAt < 900;
      if (busy || (this.live && !document.hidden && this.host.cv.isConnected)) {
        if (busy) this.schedule();
        else setTimeout(() => this.schedule(), 33);
      }
    });
  }

  draw() {
    const h = this.host;
    if (!this.gl || !h.W) return;
    const now = performance.now();
    if (this.flight) {
      const f = this.flight;
      const k = k3Clamp((now - f.start) / f.ms, 0, 1);
      const e = k3Ease(k);
      for (const key of ['tx', 'ty', 'dist', 'yaw', 'pitch']) this.cam[key] = f.from[key] + (f.goal[key] - f.from[key]) * e;
      // beim Flug kurz herauszoomen, damit man sieht, wohin es geht
      this.cam.dist *= 1 + Math.sin(Math.PI * k) * 0.35;
      if (k >= 1) this.flight = null;
      else this.schedule();
    }
    this.matrices();
    const gl = this.gl;
    const time = this.live ? (now - this.t0) / 1000 : 0;
    gl.viewport(0, 0, this.glc.width, this.glc.height);
    gl.clearColor(...K3_SKY.horizon, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Himmel
    const th = Math.tan(K3_FOV / 2);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky);
    gl.uniform3fv(this.us.uF, this.look.f);
    gl.uniform3fv(this.us.uR, this.look.r);
    gl.uniform3fv(this.us.uU, this.look.u);
    gl.uniform2f(this.us.uT, th * (h.W / h.H), th);
    gl.uniform3fv(this.us.uSun, K3_SUN);
    gl.uniform3fv(this.us.uHor, K3_SKY.horizon);
    gl.uniform3fv(this.us.uZen, K3_SKY.zenith);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Gelände und Meer
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.pr);
    const T = this.texRect;
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
    gl.uniform4f(this.u.uTexR, T.minX, T.maxY, T.maxX - T.minX, T.maxY - T.minY);
    gl.uniform3fv(this.u.uSun, K3_SUN);
    gl.uniform3fv(this.u.uEye, this.eye);
    gl.uniform3fv(this.u.uHor, K3_SKY.horizon);
    gl.uniform3fv(this.u.uZen, K3_SKY.zenith);
    gl.uniform1f(this.u.uFogK, 1 / (this.cam.dist * 3.2 + 9000));
    gl.uniform1f(this.u.uTime, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    this.overlay(now);
  }

  /** Postleitzahlen, Tatweg, Nadeln mit Infokarte und Kompass über dem Gelände. */
  overlay(now) {
    const h = this.host;
    const x = h.ctx;
    x.setTransform(h.dpr, 0, 0, h.dpr, 0, 0);
    x.clearRect(0, 0, h.W, h.H);
    const c = this.cam;
    // Postleitzahlen rund um die Kartenmitte, sobald man nah genug dran ist
    if (c.dist < 3400 && kPostals) {
      const reach = Math.max(700, c.dist * 1.1);
      const items = [];
      for (const [code, px, py] of kPostals.list) {
        if (Math.abs(px - c.tx) > reach || Math.abs(py - c.ty) > reach) continue;
        const q = this.project(px, py, karte3dHeight(px, py));
        if (q && q.x > 0 && q.y > 0 && q.x < h.W && q.y < h.H) items.push([code, q.x, q.y]);
      }
      x.fillStyle = '#0b1d3a';
      x.strokeStyle = 'rgba(255,255,255,.9)';
      x.lineWidth = 1;
      for (const [, qx, qy] of items) {
        x.beginPath();
        x.arc(qx, qy, 2.2, 0, 7);
        x.fill();
        x.stroke();
      }
      karteLabelFlow(x, items, h.W / 2, h.H / 2, true, 110);
    }
    // gewählter Punkt (Formular)
    if (h.sel) {
      const z = karte3dHeight(h.sel.x, h.sel.y);
      const b = this.project(h.sel.x, h.sel.y, z);
      if (b) karteDrawPin(x, b.x, b.y, { kind: 'sonstiges' }, -1, { hl: true, t: now / 1000 });
    }
    // Tatweg: über dem Gelände entlang, in zeitlicher Reihenfolge
    if (h.pins.length > 1) {
      const segs = [];
      for (let k = 1; k < h.pins.length; k++) {
        const a = h.pins[k - 1];
        const b = h.pins[k];
        const pts = [];
        for (let s = 0; s <= 32; s++) {
          const wx = a.x + ((b.x - a.x) * s) / 32;
          const wy = a.y + ((b.y - a.y) * s) / 32;
          const q = this.project(wx, wy, karte3dHeight(wx, wy) + 8);
          if (q) pts.push([q.x, q.y]);
        }
        segs.push({ pts, dim: h.dim.has(b.id) });
      }
      karteDrawRoute(x, segs);
    }
    // Nadeln von hinten nach vorn; beim Einschalten fallen sie kurz herein
    const drop = k3Clamp((now - this.dropAt) / 700, 0, 1);
    let card = null;
    const list = this.bases().sort((a, b) => b.b.d - a.b.d);
    for (const { p, i, b } of list) {
      const lift = this.live ? (1 - k3Ease(drop)) * 60 : 0;
      const head = karteDrawPin(x, b.x, b.y, p, i, { dim: h.dim.has(p.id), hl: h.hl === p.id, t: now / 1000, lift });
      if (h.hl === p.id) card = [p, head.x, head.y];
    }
    h.showCard(...(card || [null]));
    // Kompass: die Nadel zeigt nach Norden
    const kx = 30;
    const ky = h.H - 34;
    x.save();
    x.translate(kx, ky);
    x.fillStyle = 'rgba(6,15,30,.72)';
    x.beginPath();
    x.arc(0, 0, 20, 0, 7);
    x.fill();
    x.rotate(c.yaw);
    x.fillStyle = '#e11d48';
    x.beginPath();
    x.moveTo(0, -15);
    x.lineTo(5, 3);
    x.lineTo(-5, 3);
    x.closePath();
    x.fill();
    x.fillStyle = '#e2e8f0';
    x.font = '700 9px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('N', 0, 11);
    x.restore();
  }

  destroy() {
    if (this.gl) {
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    if (this.glc) this.glc.remove();
    this.gl = null;
    this.host.ctx.clearRect(0, 0, this.host.cv.width, this.host.cv.height);
  }
}

/** Zwischen Karte (2D) und Gelände (3D) umschalten; gibt zurück, ob 3D jetzt an ist. */
async function karteSet3d(view, on) {
  if (!on) {
    if (view.m3) {
      view.m3.toFlat();
      view.m3.destroy();
      view.m3 = null;
      view.cv.style.cursor = '';
      view.draw();
    }
    return false;
  }
  if (view.m3) return true;
  await Promise.all([karte3dTerrain(), karteImage('sat').then((img) => img || karteImage('karte'))]);
  if (!view.cv.isConnected) return false;
  const m = new Karte3D(view);
  if (!m.ok) {
    toast('Die 3D-Ansicht braucht WebGL – das lässt dieser Browser nicht zu.');
    if (m.glc) m.destroy();
    return false;
  }
  m.fromFlat();
  // Auftakt: aus der Draufsicht schräg auf das Geschehen kippen
  const goal = { pitch: 0.82, yaw: -0.35, dist: m.cam.dist * 0.9 };
  m.cam.pitch = 1.4;
  view.m3 = m;
  m.dropAt = performance.now();
  m.flyTo(goal, 1300);
  m.schedule();
  return true;
}
