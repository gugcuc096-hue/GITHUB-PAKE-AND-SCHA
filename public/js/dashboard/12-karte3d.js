/*
 * Kanzlei-Dashboard – 3D-Ansicht der Tatort-Karte: dasselbe Kartenbild als Gelände (Höhen grob aus den Grüntönen des Bildes
 * geschätzt, Wasser flach, Stadt niedrig), frei dreh- und kippbar. Eigenes, kleines WebGL – keine Fremdbibliothek.
 * Die Nadeln und Beschriftungen liegen als Zeichnung (2D-Fläche) darüber und werden aus der Kamera berechnet.
 * Bedienung: Ziehen dreht und kippt, Shift/rechte Taste verschiebt, Mausrad bzw. zwei Finger zoomen und verschieben.
 * Wird nach 12-karte.js geladen; KarteView ruft Karte3D nur auf, wenn die 3D-Ansicht eingeschaltet ist.
 */
'use strict';

const K3_N = 384; // Gitterpunkte je Seite des Geländes
const K3_MAX_H = 1100; // höchste Erhebung in Metern (bewusst überhöht, damit das Relief sichtbar ist)
const K3_FOV = 0.8;
const K3_FOG = [0.05, 0.33, 0.47]; // Dunst über dem Meer – Himmel und Ferne gehen darin auf
let kTerrain = null; // { n, h: Float32Array } – gemeinsam für alle Karten

const k3Clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Höhen aus dem Kartenbild schätzen: Wasser 0, Stadt niedrig, dunkles Grün (Berge) hoch. */
function karte3dTerrain() {
  if (kTerrain || !kImg) return kTerrain;
  const n = K3_N;
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(kImg, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data;
  let h = new Float32Array(n * n); // Zeile 0 = Norden
  for (let i = 0; i < n * n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    if (b - r >= 18) continue; // Wasser
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat < 30 && lum > 175) h[i] = 25; // Stadt und Flughafen
    else h[i] = 40 + Math.pow(k3Clamp((198 - lum) / 78, 0, 1), 1.2) * (K3_MAX_H - 40);
  }
  // glätten (3 × 3, dreimal), damit aus der Schummerung des Bildes weiche Hänge werden
  for (let pass = 0; pass < 3; pass++) {
    const o = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let xx = 0; xx < n; xx++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const x2 = xx + dx;
            if (yy < 0 || x2 < 0 || yy >= n || x2 >= n) continue;
            s += h[yy * n + x2];
            c++;
          }
        }
        o[y * n + xx] = s / c;
      }
    }
    h = o;
  }
  kTerrain = { n, h };
  return kTerrain;
}

/** Höhe an einer Spielposition (bilinear). */
function karte3dHeight(wx, wy) {
  const t = kTerrain;
  if (!t) return 0;
  const I = KMAP_IMG;
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
/** Blickmatrix (z zeigt nach oben); liefert auch die Blickrichtung und „rechts“/„oben“ für die Strahlberechnung. */
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

const K3_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv;
uniform mat4 uVP;
out vec2 vUv; out vec3 vNor; out float vDist;
void main(){ vUv=aUv; vNor=aNor; gl_Position=uVP*vec4(aPos,1.0); vDist=gl_Position.w; }`;
const K3_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec3 uFog; uniform float uFogK;
in vec2 vUv; in vec3 vNor; in float vDist;
out vec4 o;
void main(){
  vec3 c=texture(uTex,vUv).rgb;
  vec3 n=normalize(vNor);
  float d=max(dot(n,normalize(vec3(-0.5,-0.35,0.8))),0.0);
  c*=0.56+0.6*d;
  c=mix(c,uFog,clamp(vDist*uFogK,0.0,0.92));

  o=vec4(c,1.0);
}`;

class Karte3D {
  constructor(host) {
    this.host = host;
    this.cam = { tx: 0, ty: 0, dist: 6000, yaw: 0, pitch: 0.95 };
    this.vp = new Float32Array(16);
    this.queued = false;
    this.ok = this.init();
  }

  init() {
    if (!karte3dTerrain()) return false;
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
    const mk = (type, src) => {
      const s = ctx.createShader(type);
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      return s;
    };
    const pr = ctx.createProgram();
    ctx.attachShader(pr, mk(ctx.VERTEX_SHADER, K3_VS));
    ctx.attachShader(pr, mk(ctx.FRAGMENT_SHADER, K3_FS));
    ctx.linkProgram(pr);
    if (!ctx.getProgramParameter(pr, ctx.LINK_STATUS)) {
      this.destroy();
      return false;
    }
    this.pr = pr;
    this.uVP = ctx.getUniformLocation(pr, 'uVP');
    this.uFog = ctx.getUniformLocation(pr, 'uFog');
    this.uFogK = ctx.getUniformLocation(pr, 'uFogK');
    // Gelände
    const n = kTerrain.n;
    const I = KMAP_IMG;
    const pos = new Float32Array((n * n + 4) * 3);
    const nor = new Float32Array((n * n + 4) * 3);
    const uv = new Float32Array((n * n + 4) * 2);
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
        uv[k * 2] = i / (n - 1);
        uv[k * 2 + 1] = j / (n - 1);
      }
    }
    // Meer rings um die Karte: eine große, flache Fläche, deren Textur am Rand ausläuft (Randfarbe = Wasser) – kein schwebendes Kartenstück
    const SEA = 60000;
    const sea = [[-SEA, -SEA], [SEA, -SEA], [SEA, SEA], [-SEA, SEA]];
    sea.forEach(([sx, sy], q) => {
      const k = n * n + q;
      pos.set([sx, sy, -1.5], k * 3);
      nor.set([0, 0, 1], k * 3);
      uv.set([(sx - I.minX) / (I.maxX - I.minX), (I.maxY - sy) / (I.maxY - I.minY)], k * 2);
    });
    const idx = new Uint32Array((n - 1) * (n - 1) * 6 + 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const e = c + 1;
        idx.set([a, c, b, b, c, e], q);
        q += 6;
      }
    }
    idx.set([n * n, n * n + 1, n * n + 2, n * n, n * n + 2, n * n + 3], q);
    this.count = idx.length;
    this.vao = ctx.createVertexArray();
    ctx.bindVertexArray(this.vao);
    const buf = (data, name, size) => {
      const b = ctx.createBuffer();
      ctx.bindBuffer(ctx.ARRAY_BUFFER, b);
      ctx.bufferData(ctx.ARRAY_BUFFER, data, ctx.STATIC_DRAW);
      const loc = ctx.getAttribLocation(pr, name);
      ctx.enableVertexAttribArray(loc);
      ctx.vertexAttribPointer(loc, size, ctx.FLOAT, false, 0, 0);
    };
    buf(pos, 'aPos', 3);
    buf(nor, 'aNor', 3);
    buf(uv, 'aUv', 2);
    const ib = ctx.createBuffer();
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, ib);
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, idx, ctx.STATIC_DRAW);
    // Kartenbild als Oberfläche
    const tex = ctx.createTexture();
    ctx.bindTexture(ctx.TEXTURE_2D, tex);
    let src = kImg;
    const maxTex = ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
    if (kImg.naturalWidth > maxTex) {
      // kleinere Grafikkarten (Handys): Bild auf die erlaubte Größe verkleinern
      const sm = document.createElement('canvas');
      sm.width = maxTex;
      sm.height = maxTex;
      sm.getContext('2d').drawImage(kImg, 0, 0, maxTex, maxTex);
      src = sm;
    }
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, src);
    ctx.generateMipmap(ctx.TEXTURE_2D);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR_MIPMAP_LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    const aniso = ctx.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) ctx.texParameterf(ctx.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, ctx.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    this.tex = tex;
    ctx.enable(ctx.DEPTH_TEST);
    this.resize();
    return true;
  }

  resize() {
    if (!this.gl) return;
    const c = this.host.cv;
    this.glc.width = c.width;
    this.glc.height = c.height;
    this.glc.style.cssText = '';
    this.schedule();
  }

  /** Kamera aus der 2D-Ansicht übernehmen (Mitte und Maßstab bleiben, Blick von Süden schräg nach unten). */
  fromFlat() {
    const v = this.host.view;
    const c = this.cam;
    c.tx = v.cx - this.host.inset / 2 / v.s;
    c.ty = v.cy;
    c.dist = k3Clamp(this.host.H / (v.s * 2 * Math.tan(K3_FOV / 2)), 350, 22000);
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

  fit() {
    const h = this.host;
    let box = KMAP_CITY;
    if (h.pins.length) {
      const xs = h.pins.map((p) => p.x);
      const ys = h.pins.map((p) => p.y);
      box = { minX: Math.min(...xs) - 160, maxX: Math.max(...xs) + 160, minY: Math.min(...ys) - 160, maxY: Math.max(...ys) + 160 };
    }
    const ext = Math.max(box.maxX - box.minX, box.maxY - box.minY, 700);
    Object.assign(this.cam, { tx: (box.minX + box.maxX) / 2, ty: (box.minY + box.maxY) / 2, dist: k3Clamp(ext * 1.5, 900, 22000), yaw: 0, pitch: 0.95 });
    this.draw();
  }

  focus(x, y, s) {
    const c = this.cam;
    c.tx = x;
    c.ty = y;
    c.dist = k3Clamp(Math.min(c.dist, this.host.H / (s * 2 * Math.tan(K3_FOV / 2))), 600, 22000);
    this.draw();
  }

  zoomBy(f) {
    this.cam.dist = k3Clamp(this.cam.dist / f, 350, 22000);
    this.draw();
  }

  /** Ziehen: drehen (Seitwärts) und kippen (Aufwärts/Abwärts); mit Shift oder rechter Taste verschieben. */
  drag(dx, dy, pan) {
    const c = this.cam;
    if (pan) this.pan(dx, dy);
    else {
      c.yaw -= dx * 0.006;
      c.pitch = k3Clamp(c.pitch + dy * 0.005, 0.14, 1.45);
    }
    this.draw();
  }

  pan(dx, dy) {
    const c = this.cam;
    const per = (2 * c.dist * Math.tan(K3_FOV / 2)) / this.host.H; // Meter je Bildpunkt
    const fx = Math.sin(c.yaw);
    const fy = Math.cos(c.yaw);
    const flat = Math.max(Math.sin(c.pitch), 0.3); // flach geneigt wirkt ein Bildpunkt senkrecht länger
    c.tx += (-dx * fy + (dy * fx) / flat) * per;
    c.ty += (dx * fx + (dy * fy) / flat) * per;
    const I = KMAP_IMG;
    c.tx = k3Clamp(c.tx, I.minX, I.maxX);
    c.ty = k3Clamp(c.ty, I.minY, I.maxY);
  }

  matrices() {
    const c = this.cam;
    const h = this.host;
    const tz = karte3dHeight(c.tx, c.ty);
    const cp = Math.cos(c.pitch);
    const eye = [c.tx - Math.sin(c.yaw) * cp * c.dist, c.ty - Math.cos(c.yaw) * cp * c.dist, tz + Math.sin(c.pitch) * c.dist];
    const look = k3Look(eye, [c.tx, c.ty, tz]);
    const proj = k3Persp(K3_FOV, h.W / h.H, Math.max(20, c.dist * 0.01), c.dist * 3 + 16000);
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
    const { eye, look } = this;
    const h = this.host;
    const th = Math.tan(K3_FOV / 2);
    const nx = (px / h.W) * 2 - 1;
    const ny = 1 - (py / h.H) * 2;
    const dir = [0, 1, 2].map((i) => look.f[i] + nx * th * (h.W / h.H) * look.r[i] + ny * th * look.u[i]);
    const l = Math.hypot(...dir);
    const d = dir.map((v) => v / l);
    const at = (t) => [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
    const far = this.cam.dist * 3 + 16000;
    const I = KMAP_IMG;
    let t = Math.max(20, this.cam.dist * 0.01);
    let prev = t;
    while (t < far) {
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

  /** Nadelköpfe: Lage am Bildschirm je Nadel (für Treffer und Zeichnung). */
  heads() {
    const pole = k3Clamp(this.cam.dist * 0.07, 70, 1400);
    return this.host.pins
      .map((p) => {
        const z = karte3dHeight(p.x, p.y);
        const base = this.project(p.x, p.y, z);
        const head = this.project(p.x, p.y, z + pole);
        return base && head ? { p, base, head } : null;
      })
      .filter(Boolean);
  }

  pinAt(px, py) {
    let best = null;
    let bd = 17 * 17;
    for (const h of this.heads()) {
      const d = (h.head.x - px) ** 2 + (h.head.y - py) ** 2;
      if (d <= bd) {
        bd = d;
        best = h.p;
      }
    }
    return best;
  }

  schedule() {
    if (this.queued || !this.gl) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  draw() {
    const h = this.host;
    if (!this.gl || !h.W) return;
    this.matrices();
    const gl = this.gl;
    gl.viewport(0, 0, this.glc.width, this.glc.height);
    gl.clearColor(K3_FOG[0], K3_FOG[1], K3_FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pr);
    gl.uniformMatrix4fv(this.uVP, false, this.vp);
    gl.uniform3f(this.uFog, K3_FOG[0], K3_FOG[1], K3_FOG[2]);
    gl.uniform1f(this.uFogK, 0.5 / (this.cam.dist * 3));
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    this.overlay();
  }

  /** Nadeln, gewählter Punkt, Orientierung und Kompass über dem Gelände. */
  overlay() {
    const h = this.host;
    const x = h.ctx;
    x.setTransform(h.dpr, 0, 0, h.dpr, 0, 0);
    x.clearRect(0, 0, h.W, h.H);
    const c = this.cam;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (c.dist > 2800) {
      x.font = '600 11px system-ui, sans-serif';
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(255,255,255,.9)';
      x.fillStyle = '#0b1d3a';
      for (const [name, lx, ly] of KMAP_LANDMARKS) {
        const p = this.project(lx, ly, karte3dHeight(lx, ly));
        if (!p) continue;
        x.strokeText(name, p.x, p.y);
        x.fillText(name, p.x, p.y);
      }
    }
    // Postleitzahlen rund um die Kartenmitte, sobald man nah genug dran ist
    if (c.dist < 3600 && kPostals) {
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
      karteLabelFlow(x, items, h.W / 2, h.H / 2, true, 160);
      x.textAlign = 'center';
    }
    if (h.sel) {
      const z = karte3dHeight(h.sel.x, h.sel.y);
      const b = this.project(h.sel.x, h.sel.y, z);
      const t = this.project(h.sel.x, h.sel.y, z + k3Clamp(c.dist * 0.07, 70, 1400));
      if (b && t) {
        x.strokeStyle = '#e11d48';
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(b.x, b.y);
        x.lineTo(t.x, t.y);
        x.stroke();
        x.beginPath();
        x.arc(b.x, b.y, 9, 0, 7);
        x.stroke();
        x.beginPath();
        x.arc(t.x, t.y, 5, 0, 7);
        x.fillStyle = '#e11d48';
        x.fill();
      }
    }
    const heads = this.heads().sort((a, b) => b.base.d - a.base.d);
    x.font = '700 10px system-ui, sans-serif';
    for (const { p, base, head } of heads) {
      const color = (PLACE_KINDS[p.kind] || PLACE_KINDS.sonstiges)[2];
      x.globalAlpha = h.dim.has(p.id) ? 0.22 : 1;
      x.strokeStyle = '#06101f';
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(base.x, base.y);
      x.lineTo(head.x, head.y);
      x.stroke();
      x.strokeStyle = color;
      x.lineWidth = 1.5;
      x.stroke();
      x.fillStyle = 'rgba(6,16,31,.55)';
      x.beginPath();
      x.ellipse(base.x, base.y, 6, 3, 0, 0, 7);
      x.fill();
      if (h.hl === p.id) {
        x.strokeStyle = color;
        x.lineWidth = 2;
        x.beginPath();
        x.arc(head.x, head.y, 15, 0, 7);
        x.stroke();
      }
      x.fillStyle = color;
      x.strokeStyle = '#06101f';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(head.x, head.y, 10, 0, 7);
      x.fill();
      x.stroke();
      x.fillStyle = '#06101f';
      x.fillText(String(h.pins.indexOf(p) + 1), head.x, head.y + 0.5);
      x.globalAlpha = 1;
    }
    // Kompass: die Nadel zeigt nach Norden
    const kx = 30;
    const ky = h.H - 34;
    x.save();
    x.translate(kx, ky);
    x.fillStyle = 'rgba(6,15,30,.7)';
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
    x.fillText('N', 0, 11);
    x.restore();
    x.textAlign = 'start';
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
  if (!kImg) {
    karteImage();
    await new Promise((res) => {
      const t = setInterval(() => {
        if (kImg || kImgState === 'failed') {
          clearInterval(t);
          res();
        }
      }, 60);
    });
  }
  const m = new Karte3D(view);
  if (!m.ok) {
    toast('Die 3D-Ansicht braucht WebGL – das lässt dieser Browser nicht zu.');
    if (m.glc) m.destroy();
    return false;
  }
  m.fromFlat();
  view.m3 = m;
  view.draw();
  return true;
}
