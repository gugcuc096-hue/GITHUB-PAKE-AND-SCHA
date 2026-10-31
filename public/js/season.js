/*
 * Saison-Deko (Einstellungen → Stil & Saison): theme.js setzt <html data-season="…">, dieses Skript baut dazu eine
 * eigene Szene – komplett HINTER dem Inhalt (eine feste Ebene mit z-index -1): Felder, Karten und Texte bleiben frei.
 * Jede Saison hat ihren eigenen Himmel, ihre eigene Landschaft (einmal gezeichnet) und eigene Bewegung (≤ 30 Bilder/s):
 *   halloween    Vollmond, Spukhaus mit flackernden Fenstern, tote Bäume, Grabsteine, Kürbisse, Fledermaus-Schwärme,
 *                Glut, Nebel und ab und zu ein Blitz
 *   weihnachten  Polarlicht, Sternenhimmel, verschneite Hügel mit Tannen, Hütte mit Rauch, geschmückter Baum,
 *                Schnee in drei Tiefen, der Schlitten fliegt vorbei, Lichterkette an der Kopfzeile
 *   silvester    Skyline von Los Santos mit Blinklichtern, Feuerwerk (Chrysantheme, Ring, Trauerweide, Palme,
 *                Glitzer) mit Spiegelung im Wasser und Finale
 *   valentin     Herzbäume, Laterne, schlagendes Herz, Bokeh, aufsteigende Herzen, Rosenblätter, Herz-Explosionen
 *   ostern       Morgenröte, Wiese mit Blumen und Gras, bemalte Eier, Hase, Blütenbaum, Schmetterlinge, Blütenregen
 *   sommer       Retro-Sonne über dem Meer, Riesenrad am Pier, Palmen, Glitzern auf dem Wasser, Möwen
 *   blackfriday  Goldenes Raster bis zum Horizont, Laser, fallende Goldmünzen
 *   jubilaeum    Bühnenvorhang, Scheinwerfer, Sektperlen, Konfetti-Kanonen
 * Im Dashboard leiser. Bei „Bewegung reduzieren“ bleibt nur die stehende Szene. Je Gerät abschaltbar: PS.season.off(true).
 */
(() => {
  'use strict';
  const root = document.documentElement;
  const OFF_KEY = 'ps.season.off';
  const TAU = Math.PI * 2;
  const dash = () => !!document.getElementById('sidebar');
  const calm = () => (window.PS && window.PS.motion ? window.PS.motion.calm() : window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isOff = () => {
    try {
      return localStorage.getItem(OFF_KEY) === '1';
    } catch {
      return false;
    }
  };
  const ver = (() => {
    const s = document.currentScript && document.currentScript.src;
    const m = s && s.match(/[?&]v=([\w-]+)/);
    return m ? `?v=${m[1]}` : '';
  })();

  /* ---------------------------------------------------------------- Werkzeuge */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  /** Zufall mit festem Startwert – die Landschaft sieht nach dem Neuzeichnen gleich aus. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  /** Weicher Lichtschein. Kleine Scheine kommen aus einem einmal gezeichneten Bild je Farbe (Verläufe pro Bild sind teuer). */
  const sprites = new Map();
  function sprite(c) {
    const key = c.join();
    let sp = sprites.get(key);
    if (!sp) {
      if (sprites.size > 48) sprites.clear();
      sp = document.createElement('canvas');
      sp.width = sp.height = 64;
      const g = sp.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(c, 1));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      sprites.set(key, sp);
    }
    return sp;
  }
  function glow(ctx, x, y, r, c, a = 1) {
    if (r <= 0 || a <= 0) return;
    if (r < 80) {
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * Math.min(1, a);
      ctx.drawImage(sprite(c), x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = ga;
      return;
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function vgrad(ctx, y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  /** Hügel: y(x) und Füllen bis zum unteren Rand. */
  function hill(w, h, base, amp, seed, freq = 1) {
    const r = rng(seed);
    const p = [r() * TAU, r() * TAU, r() * TAU];
    const y = (x) => h * base - amp * h * (0.55 * Math.sin((x / w) * freq * TAU + p[0]) + 0.3 * Math.sin((x / w) * freq * 2.3 * TAU + p[1]) + 0.15 * Math.sin((x / w) * freq * 5.1 * TAU + p[2]));
    const fill = (ctx, style, rim) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, y(x));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
      if (rim) {
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) (x ? ctx.lineTo : ctx.moveTo).call(ctx, x, y(x));
        ctx.strokeStyle = rim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    return { y, fill };
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  }
  function branch(ctx, x, y, len, ang, width, depth, r, tips) {
    if (depth === 0 || len < 2) {
      if (tips) tips.push([x, y]);
      return;
    }
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = Math.max(0.6, width);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const n = 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(ctx, x2, y2, len * (0.62 + r() * 0.18), ang + (r() - 0.5) * 0.9 + (i - (n - 1) / 2) * 0.42, width * 0.66, depth - 1, r, tips);
  }
  function pine(ctx, x, y, hgt, color, snow) {
    const w = hgt * 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(x - hgt * 0.03, y - hgt * 0.12, hgt * 0.06, hgt * 0.14);
    for (let i = 0; i < 4; i++) {
      const by = y - hgt * 0.1 - i * hgt * 0.2;
      const tw = w * (1 - i * 0.22);
      ctx.beginPath();
      ctx.moveTo(x, by - hgt * 0.36);
      ctx.lineTo(x - tw / 2, by);
      ctx.lineTo(x + tw / 2, by);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (snow) {
        ctx.beginPath();
        ctx.moveTo(x, by - hgt * 0.36);
        ctx.lineTo(x - tw * 0.22, by - hgt * 0.2);
        ctx.quadraticCurveTo(x, by - hgt * 0.15, x + tw * 0.22, by - hgt * 0.2);
        ctx.closePath();
        ctx.fillStyle = snow;
        ctx.fill();
      }
    }
  }
  function headerBottom() {
    const hd = document.querySelector('.topbar, header.glass-nav, body > header');
    return hd ? Math.max(0, hd.getBoundingClientRect().bottom) : 0;
  }

  /* ---------------------------------------------------------------- Ebene, Leinwände, Takt */
  let stop = null;
  let current = '';
  let timers = [];

  let cssReady = false;
  let gen = 0;
  /** season.css nachladen; die Szene entsteht erst danach (sonst läge sie kurz ungestylt im Seitenfluss). */
  function ensureCss(done) {
    if (cssReady) return done();
    let l = document.getElementById('psSeasonCss');
    if (!l) {
      l = document.createElement('link');
      l.id = 'psSeasonCss';
      l.rel = 'stylesheet';
      l.href = `/css/season.css${ver}`;
      document.head.appendChild(l);
    }
    l.addEventListener('load', () => {
      cssReady = true;
      done();
    }, { once: true });
  }
  function clear() {
    if (stop) stop();
    stop = null;
    timers.forEach(clearTimeout);
    timers = [];
    document.querySelectorAll('.ps-season').forEach((n) => n.remove());
    root.classList.remove('has-season');
  }
  /** Leinwand auf Fenstergröße; die Bewegungsebene in einfacher Auflösung (spart auf hochauflösenden Bildschirmen viel). */
  function fit(c, sharp = true) {
    const dpr = sharp ? Math.min(1.5, window.devicePixelRatio || 1) : 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function run(name) {
    const S = SCENES[name];
    const el = document.createElement('div');
    const isDash = dash();
    el.className = `ps-season ps-scene ps-scene-${name}${isDash ? ' is-dash' : ''}`;
    el.setAttribute('aria-hidden', 'true');
    const still = calm();
    el.innerHTML = `<div class="ps-sky"></div>${S.extra || ''}<canvas class="ps-scenery"></canvas>${still ? '' : '<canvas class="ps-fx"></canvas>'}`;
    document.body.appendChild(el);
    const sc = el.querySelector('.ps-scenery');
    const fx = el.querySelector('.ps-fx');
    let A = null;
    let B = null;
    let s = null;
    const build = () => {
      A = fit(sc);
      s = { w: A.w, h: A.h, u: Math.max(0.55, Math.min(A.w, A.h) / 900), k: isDash ? 0.45 : 1, dash: isDash, top: headerBottom() };
      A.ctx.clearRect(0, 0, A.w, A.h);
      S.scenery(A.ctx, A.w, A.h, s);
      // Dashboard: oben stehen Überschriften und Reiter – Mond & Co. dort deutlich zurücknehmen, unten bleibt die Landschaft
      if (isDash) {
        A.ctx.globalCompositeOperation = 'destination-out';
        A.ctx.fillStyle = vgrad(A.ctx, 0, A.h, [[0, 'rgba(0,0,0,0.7)'], [0.45, 'rgba(0,0,0,0.55)'], [0.75, 'rgba(0,0,0,0)']]);
        A.ctx.fillRect(0, 0, A.w, A.h);
        A.ctx.globalCompositeOperation = 'source-over';
      }
      if (fx) {
        B = fit(fx, false);
        if (S.init) S.init(s);
      }
    };
    build();
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 180);
    };
    window.addEventListener('resize', onResize);
    let raf = 0;
    let last = performance.now();
    let alive = true;
    // Website ~30, Dashboard ~24 Bilder pro Sekunde. Drossel: kommt das Gerät nicht mit (Zeichnen dauert lange oder die
    // ganze Seite ruckelt), erst halb so oft zeichnen, dann nur noch das stehende Bild – die Seite selbst hat Vorrang.
    let every = isDash ? 41 : 31;
    let prev = 0;
    let busy = 0;
    let gap = 0;
    let seen = 0;
    if (fx && S.step) {
      const tick = (now) => {
        if (!alive) return;
        raf = requestAnimationFrame(tick);
        if (document.hidden) {
          prev = 0;
          last = now;
          return;
        }
        if (prev) gap = gap ? gap * 0.95 + (now - prev) * 0.05 : now - prev;
        prev = now;
        if (now - last < every) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t0 = performance.now();
        if (S.trails) {
          B.ctx.globalCompositeOperation = 'destination-out';
          B.ctx.fillStyle = `rgba(0,0,0,${S.trails})`;
          B.ctx.fillRect(0, 0, B.w, B.h);
          B.ctx.globalCompositeOperation = 'source-over';
        } else B.ctx.clearRect(0, 0, B.w, B.h);
        S.step(B.ctx, dt, now / 1000, s);
        const cost = performance.now() - t0;
        busy = seen++ ? busy * 0.9 + cost * 0.1 : cost;
        if (seen > 40 && (busy > 9 || gap > 45)) {
          seen = 0;
          busy = 0;
          gap = 0;
          if (every < 60) every = 66;
          else {
            alive = false; // nur noch Himmel und Landschaft
            cancelAnimationFrame(raf);
            B.ctx.clearRect(0, 0, B.w, B.h);
            el.classList.add('is-still');
          }
        }
      };
      raf = requestAnimationFrame(tick);
    }
    const lights = S.lights && headerLights(S.lights);
    stop = () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      if (lights) lights.remove();
    };
  }

  /** Lichterkette in der Kopfzeile (bleibt in ihr – hängt nicht über den Inhalt). */
  function headerLights(colors) {
    const hd = document.querySelector('.topbar, header.glass-nav');
    if (!hd) return null;
    const box = document.createElement('div');
    box.className = 'ps-season ps-lights';
    box.setAttribute('aria-hidden', 'true');
    const n = Math.max(12, Math.round(hd.getBoundingClientRect().width / 46));
    box.innerHTML = `<span class="wire"></span>${Array.from({ length: n }, (_, i) => `<span class="bulb" style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%;--c:${colors[i % colors.length]};--d:${((i * 0.37) % 2.4).toFixed(2)}s"></span>`).join('')}`;
    hd.appendChild(box);
    return box;
  }

  /* ================================================================ Szenen */
  const SCENES = {};

  /* ---------------------------------------------------------------- Halloween */
  function batShape(ctx, x, y, size, flap) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    const wy = -6 * flap;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(-6, -4 + wy, -14, -2 + wy * 1.4);
    ctx.quadraticCurveTo(-11, 1 + wy * 0.6, -9, 3);
    ctx.quadraticCurveTo(-6, 1, -4, 4);
    ctx.quadraticCurveTo(-2, 2, 0, 5);
    ctx.quadraticCurveTo(2, 2, 4, 4);
    ctx.quadraticCurveTo(6, 1, 9, 3);
    ctx.quadraticCurveTo(11, 1 + wy * 0.6, 14, -2 + wy * 1.4);
    ctx.quadraticCurveTo(6, -4 + wy, 0, -2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -1, 2.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  SCENES.halloween = {
    extra: '<div class="ps-fog"><i></i><i></i></div>',
    lights: ['#f97316', '#a855f7', '#f97316', '#22c55e'],
    scenery(ctx, w, h, s) {
      const r = rng(31);
      const u = s.u;
      // Vollmond mit Hof und Kratern
      const m = { x: w * 0.84, y: Math.max(s.top + 90 * u, h * 0.24), r: 64 * u + 18 };
      s.moon = m;
      glow(ctx, m.x, m.y, m.r * 5, [255, 170, 90], 0.22);
      glow(ctx, m.x, m.y, m.r * 2.2, [255, 230, 190], 0.35);
      const mg = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.1, m.x, m.y, m.r);
      mg.addColorStop(0, '#fff8e6');
      mg.addColorStop(0.7, '#f4dba6');
      mg.addColorStop(1, '#d9b06c');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,110,50,0.22)';
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(m.x + (r() - 0.5) * m.r * 1.2, m.y + (r() - 0.5) * m.r * 1.2, m.r * (0.06 + r() * 0.12), 0, TAU);
        ctx.fill();
      }
      // Hügel hinten mit Spukhaus
      const back = hill(w, h, 0.8, 0.045, 11, 1.1);
      back.fill(ctx, '#1a0e28');
      const hx = w * 0.7;
      const hy = back.y(hx) + 4;
      const hw = 110 * u + 40;
      const hh = hw * 0.62;
      ctx.fillStyle = '#100818';
      ctx.fillRect(hx - hw / 2, hy - hh, hw, hh);
      ctx.beginPath();
      ctx.moveTo(hx - hw * 0.58, hy - hh);
      ctx.lineTo(hx - hw * 0.1, hy - hh * 1.65);
      ctx.lineTo(hx + hw * 0.38, hy - hh);
      ctx.fill();
      ctx.fillRect(hx + hw * 0.18, hy - hh * 1.55, hw * 0.24, hh * 0.6);
      ctx.beginPath();
      ctx.moveTo(hx + hw * 0.14, hy - hh * 1.55);
      ctx.lineTo(hx + hw * 0.3, hy - hh * 2.25);
      ctx.lineTo(hx + hw * 0.46, hy - hh * 1.55);
      ctx.fill();
      s.windows = [
        [hx - hw * 0.34, hy - hh * 0.72, hw * 0.12, hh * 0.22],
        [hx - hw * 0.06, hy - hh * 0.72, hw * 0.12, hh * 0.22],
        [hx + hw * 0.24, hy - hh * 1.38, hw * 0.1, hh * 0.2],
        [hx - hw * 0.15, hy - hh * 1.2, hw * 0.08, hh * 0.16],
        [hx + hw * 0.22, hy - hh * 0.72, hw * 0.12, hh * 0.22],
      ];
      ctx.strokeStyle = '#140a1e';
      ctx.lineCap = 'round';
      for (const fx of [0.18, 0.46, 0.92]) branch(ctx, w * fx, back.y(w * fx) + 2, 34 * u + 12, -Math.PI / 2 + (r() - 0.5) * 0.3, 5 * u + 1, 6, r);
      // mittlerer Hügel
      const mid = hill(w, h, 0.88, 0.032, 23, 1.6);
      mid.fill(ctx, '#0d0716');
      // vorne: große tote Bäume, Grabsteine, Zaun, Kürbisse
      const front = hill(w, h, 0.955, 0.022, 37, 1.3);
      front.fill(ctx, '#050208');
      ctx.strokeStyle = '#050208';
      for (const [fx, d] of [[0.05, 8], [0.95, 8], [0.33, 6]]) branch(ctx, w * fx, front.y(w * fx) + 4, (fx === 0.33 ? 38 : 64) * u + 16, -Math.PI / 2 + (r() - 0.5) * 0.25, (fx === 0.33 ? 6 : 10) * u + 2, d, r);
      ctx.fillStyle = '#08040d';
      for (let i = 0; i < 9; i++) {
        const gx = w * (0.12 + r() * 0.76);
        if (Math.abs(gx - w * 0.33) < 30) continue;
        const gy = front.y(gx) + 6;
        const gw = (12 + r() * 10) * u + 4;
        const gh = gw * (1.3 + r() * 0.6);
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate((r() - 0.5) * 0.25);
        if (r() < 0.3) {
          ctx.fillRect(-gw * 0.12, -gh * 1.2, gw * 0.24, gh * 1.2);
          ctx.fillRect(-gw * 0.45, -gh * 0.95, gw * 0.9, gw * 0.22);
        } else {
          ctx.beginPath();
          ctx.moveTo(-gw / 2, 0);
          ctx.lineTo(-gw / 2, -gh + gw / 2);
          ctx.arc(0, -gh + gw / 2, gw / 2, Math.PI, 0);
          ctx.lineTo(gw / 2, 0);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,150,80,0.16)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.strokeStyle = '#07030b';
      ctx.lineWidth = 2;
      for (let x = w * 0.52; x < w * 0.66; x += 9 * u + 3) {
        const fy = front.y(x);
        ctx.beginPath();
        ctx.moveTo(x, fy + 4);
        ctx.lineTo(x, fy - 22 * u - 6);
        ctx.stroke();
      }
      s.pumpkins = [];
      for (const fx of [0.15, 0.24, 0.58, 0.74, 0.86]) {
        const px = w * fx + (r() - 0.5) * 20;
        const pr = (11 + r() * 7) * u + 3;
        const py = front.y(px) - pr * 0.55;
        const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr * 1.1);
        pg.addColorStop(0, '#ffa23a');
        pg.addColorStop(1, '#a8360a');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.ellipse(px, py, pr * 1.15, pr, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,25,5,0.6)';
        ctx.lineWidth = 1;
        for (const o of [-0.5, 0, 0.5]) {
          ctx.beginPath();
          ctx.ellipse(px + o * pr * 0.9, py, pr * 0.35, pr * 0.95, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = '#3f2a0a';
        ctx.fillRect(px - pr * 0.08, py - pr * 1.25, pr * 0.16, pr * 0.32);
        s.pumpkins.push({ x: px, y: py, r: pr, ph: r() * 10 });
      }
      // Spinnennetz unter der Kopfzeile (nur Website)
      if (!s.dash) {
        const L = Math.min(200, w * 0.16);
        const ox = 0;
        const oy = s.top;
        ctx.strokeStyle = 'rgba(226,232,240,0.16)';
        ctx.lineWidth = 0.8;
        const spokes = 7;
        for (let i = 0; i <= spokes; i++) {
          const a = (i / spokes) * (Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + Math.cos(a) * L, oy + Math.sin(a) * L);
          ctx.stroke();
        }
        for (let ring = 1; ring <= 6; ring++) {
          const d = (ring / 6) * L;
          ctx.beginPath();
          for (let i = 0; i <= spokes; i++) {
            const a = (i / spokes) * (Math.PI / 2);
            const x = ox + Math.cos(a) * d;
            const y = oy + Math.sin(a) * d;
            if (!i) ctx.moveTo(x, y);
            else {
              const pa = ((i - 0.5) / spokes) * (Math.PI / 2);
              ctx.quadraticCurveTo(ox + Math.cos(pa) * d * 0.86, oy + Math.sin(pa) * d * 0.86, x, y);
            }
          }
          ctx.stroke();
        }
        // Spinne am Faden
        ctx.beginPath();
        ctx.moveTo(L * 0.55, oy + L * 0.35);
        ctx.lineTo(L * 0.55, oy + L * 0.9);
        ctx.stroke();
        ctx.fillStyle = '#0a0410';
        ctx.beginPath();
        ctx.arc(L * 0.55, oy + L * 0.9 + 5, 5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#0a0410';
        for (const sgn of [-1, 1]) for (let j = 0; j < 4; j++) {
          ctx.beginPath();
          ctx.moveTo(L * 0.55, oy + L * 0.9 + 4);
          ctx.quadraticCurveTo(L * 0.55 + sgn * 7, oy + L * 0.9 - 2 + j * 3, L * 0.55 + sgn * 10, oy + L * 0.9 + 4 + j * 3);
          ctx.stroke();
        }
      }
    },
    init(s) {
      s.embers = Array.from({ length: Math.round(34 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.h * 0.4, s.h), v: rnd(12, 34), r: rnd(0.8, 2.2), ph: rnd(0, TAU), hue: rnd(16, 40) }));
      s.bats = [];
      s.nextBats = rnd(1.5, 4);
      s.nextBolt = s.dash ? Infinity : rnd(8, 16);
      s.bolt = null;
    },
    step(ctx, dt, t, s) {
      // Blitz: Himmel hellt kurz auf, ein zackiger Strahl
      s.nextBolt -= dt;
      if (s.nextBolt <= 0) {
        const pts = [[rnd(s.w * 0.15, s.w * 0.65), s.top]];
        while (pts[pts.length - 1][1] < s.h * 0.72) {
          const [px, py] = pts[pts.length - 1];
          pts.push([px + rnd(-40, 40), py + rnd(20, 50)]);
        }
        s.bolt = { pts, age: 0 };
        s.nextBolt = rnd(12, 22);
      }
      if (s.bolt) {
        s.bolt.age += dt;
        const a = Math.max(0, 1 - s.bolt.age / 0.45);
        ctx.fillStyle = `rgba(190,170,255,${0.16 * a})`;
        ctx.fillRect(0, 0, s.w, s.h);
        if (s.bolt.age < 0.22) {
          ctx.beginPath();
          s.bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.lineJoin = 'round';
          ctx.strokeStyle = `rgba(180,150,255,${0.25 * a})`;
          ctx.lineWidth = 9;
          ctx.stroke();
          ctx.strokeStyle = `rgba(235,225,255,${a})`;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
        if (a <= 0) s.bolt = null;
      }
      // Fenster und Kürbisse flackern
      for (const [x, y, ww, hh] of s.windows) {
        const f = 0.55 + 0.25 * Math.sin(t * 3.1 + x) + 0.2 * Math.sin(t * 11.7 + y);
        glow(ctx, x + ww / 2, y + hh / 2, ww * 2.4, [255, 150, 60], 0.35 * f);
        ctx.fillStyle = `rgba(255,${170 + 40 * f},90,${0.75 + 0.25 * f})`;
        ctx.fillRect(x, y, ww, hh);
      }
      for (const p of s.pumpkins) {
        const f = 0.7 + 0.2 * Math.sin(t * 5 + p.ph) + 0.1 * Math.sin(t * 17 + p.ph);
        glow(ctx, p.x, p.y, p.r * 2.6, [255, 160, 50], 0.28 * f);
        ctx.fillStyle = `rgba(255,${200 + 40 * f},120,${f})`;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(p.x + sgn * p.r * 0.45, p.y - p.r * 0.45);
          ctx.lineTo(p.x + sgn * p.r * 0.2, p.y - p.r * 0.1);
          ctx.lineTo(p.x + sgn * p.r * 0.7, p.y - p.r * 0.1);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(p.x - p.r * 0.6, p.y + p.r * 0.2);
        for (let i = 0; i <= 6; i++) ctx.lineTo(p.x - p.r * 0.6 + (i * p.r * 1.2) / 6, p.y + p.r * (i % 2 ? 0.55 : 0.3));
        ctx.lineTo(p.x + p.r * 0.6, p.y + p.r * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      // Glut
      for (const e of s.embers) {
        e.y -= e.v * dt;
        e.x += Math.sin(t + e.ph) * 10 * dt;
        if (e.y < s.top) Object.assign(e, { y: s.h + 10, x: rnd(0, s.w) });
        const f = 0.5 + 0.5 * Math.sin(t * 6 + e.ph);
        ctx.fillStyle = `hsla(${e.hue},100%,55%,${0.14 * f})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 3.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `hsla(${e.hue},100%,62%,${0.85 * f})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fill();
      }
      // Fledermaus-Schwärme (am Mond vorbei)
      s.nextBats -= dt;
      if (s.nextBats <= 0) {
        const n = Math.round(rnd(4, 9) * (s.dash ? 0.6 : 1));
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y0 = s.moon.y + rnd(-s.moon.r * 1.5, s.moon.r * 1.5);
        for (let i = 0; i < n; i++) s.bats.push({ x: dir > 0 ? -40 - i * rnd(18, 40) : s.w + 40 + i * rnd(18, 40), y: y0 + rnd(-50, 50), v: dir * rnd(110, 170), size: rnd(0.8, 1.5) * s.u, ph: rnd(0, TAU), wob: rnd(0.8, 1.6) });
        s.nextBats = s.dash ? rnd(28, 45) : rnd(9, 16);
      }
      ctx.fillStyle = '#08030d';
      s.bats = s.bats.filter((b) => b.x > -120 && b.x < s.w + 120);
      for (const b of s.bats) {
        b.x += b.v * dt;
        b.y += Math.sin(t * b.wob * 2 + b.ph) * 18 * dt;
        batShape(ctx, b.x, b.y, b.size * (b.v > 0 ? 1 : 1), Math.sin(t * 16 + b.ph));
      }
    },
  };

  /* ---------------------------------------------------------------- Weihnachten */
  SCENES.weihnachten = {
    lights: ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#f472b6'],
    extra: '<div class="ps-aurora"><i></i><i></i><i></i></div>',
    scenery(ctx, w, h, s) {
      const r = rng(77);
      const u = s.u;
      s.stars = Array.from({ length: Math.round(130 * (s.dash ? 0.5 : 1)) }, () => ({ x: r() * w, y: s.top + r() * h * 0.5, r: r() * 1.3 + 0.3, ph: r() * TAU }));
      const m = { x: w * 0.16, y: Math.max(s.top + 70 * u, h * 0.2), r: 34 * u + 10 };
      glow(ctx, m.x, m.y, m.r * 5, [190, 215, 255], 0.2);
      // Sichel: auf eigener Leinwand ausgeschnitten, damit der Himmel durchscheint
      const mc = document.createElement('canvas');
      mc.width = mc.height = Math.ceil(m.r * 2 + 4);
      const mx = mc.getContext('2d');
      mx.fillStyle = '#eef4ff';
      mx.beginPath();
      mx.arc(m.r + 2, m.r + 2, m.r, 0, TAU);
      mx.fill();
      mx.globalCompositeOperation = 'destination-out';
      mx.beginPath();
      mx.arc(m.r + 2 + m.r * 0.42, m.r + 2 - m.r * 0.18, m.r * 0.92, 0, TAU);
      mx.fill();
      ctx.drawImage(mc, m.x - m.r - 2, m.y - m.r - 2);
      s.moon = m;
      // Hügel mit Schnee und Tannen
      const back = hill(w, h, 0.8, 0.05, 5, 0.9);
      back.fill(ctx, vgrad(ctx, h * 0.72, h, [[0, '#30456a'], [0.25, '#1b2a48']]), 'rgba(226,236,255,0.35)');
      for (let i = 0; i < 26; i++) {
        const x = r() * w;
        pine(ctx, x, back.y(x) + 6, (24 + r() * 26) * u + 6, '#0d1d2c', 'rgba(220,232,255,0.55)');
      }
      const mid = hill(w, h, 0.88, 0.035, 9, 1.4);
      mid.fill(ctx, vgrad(ctx, h * 0.82, h, [[0, '#4a6288'], [0.2, '#24365a']]), 'rgba(235,242,255,0.5)');
      // Hütte mit warmem Fenster
      const cx = w * 0.27;
      const cy = mid.y(cx) + 5;
      const cw = 70 * u + 24;
      ctx.fillStyle = '#1c130e';
      ctx.fillRect(cx - cw / 2, cy - cw * 0.55, cw, cw * 0.55);
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.62, cy - cw * 0.55);
      ctx.lineTo(cx, cy - cw * 0.98);
      ctx.lineTo(cx + cw * 0.62, cy - cw * 0.55);
      ctx.fill();
      ctx.fillStyle = 'rgba(240,246,255,0.92)';
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.66, cy - cw * 0.52);
      ctx.lineTo(cx, cy - cw * 1.02);
      ctx.lineTo(cx + cw * 0.66, cy - cw * 0.52);
      ctx.lineTo(cx + cw * 0.5, cy - cw * 0.6);
      ctx.lineTo(cx, cy - cw * 0.9);
      ctx.lineTo(cx - cw * 0.5, cy - cw * 0.6);
      ctx.fill();
      ctx.fillStyle = '#1c130e';
      ctx.fillRect(cx + cw * 0.22, cy - cw * 0.98, cw * 0.12, cw * 0.28);
      s.chimney = { x: cx + cw * 0.28, y: cy - cw * 1.0 };
      s.cabin = [cx - cw * 0.28, cy - cw * 0.38, cw * 0.2, cw * 0.18];
      for (let i = 0; i < 14; i++) {
        const x = r() * w;
        if (Math.abs(x - cx) < cw) continue;
        pine(ctx, x, mid.y(x) + 6, (38 + r() * 34) * u + 8, '#0b2418', 'rgba(235,242,255,0.7)');
      }
      const front = hill(w, h, 0.96, 0.018, 13, 1.1);
      front.fill(ctx, vgrad(ctx, h * 0.93, h, [[0, '#9fb4d4'], [0.25, '#3d5276']]), 'rgba(255,255,255,0.7)');
      // geschmückter Baum
      const tx = w * 0.87;
      const ty = front.y(tx) + 6;
      const th = 150 * u + 40;
      pine(ctx, tx, ty, th, '#0e3a24', 'rgba(240,248,255,0.75)');
      s.ornaments = [];
      for (let i = 0; i < 18; i++) {
        const lv = r();
        const oy = ty - th * 0.12 - lv * th * 0.72;
        const half = th * 0.25 * (1 - lv * 0.85);
        s.ornaments.push({ x: tx + (r() - 0.5) * 2 * half * 0.85, y: oy, c: pick([[239, 68, 68], [250, 204, 21], [56, 189, 248], [244, 114, 182], [255, 255, 255]]), ph: r() * TAU });
      }
      s.treeStar = { x: tx, y: ty - th * 0.96 };
    },
    init(s) {
      s.snow = Array.from({ length: Math.round(170 * s.k) }, () => {
        const z = rnd(0.3, 1);
        return { x: rnd(0, s.w), y: rnd(0, s.h), z, r: (0.8 + z * 2.4) * s.u + 0.3, v: 14 + z * 38, ph: rnd(0, TAU) };
      });
      s.smoke = [];
      s.nextSleigh = rnd(4, 9);
      s.sleigh = null;
      s.trail = [];
      s.shoot = null;
      s.nextShoot = rnd(5, 12);
    },
    step(ctx, dt, t, s) {
      // (Polarlicht: .ps-aurora in season.css – bewegt der Browser selbst)
      for (const st of s.stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.45 * Math.abs(Math.sin(t * 1.3 + st.ph))})`;
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      // Sternschnuppe
      s.nextShoot -= dt;
      if (s.nextShoot <= 0) {
        s.shoot = { x: rnd(s.w * 0.2, s.w * 0.9), y: rnd(s.top, s.h * 0.3), age: 0 };
        s.nextShoot = rnd(9, 18);
      }
      if (s.shoot) {
        s.shoot.age += dt;
        const p = s.shoot.age / 0.9;
        const x = s.shoot.x - p * 260;
        const y = s.shoot.y + p * 110;
        const g = ctx.createLinearGradient(x, y, x + 90, y - 38);
        g.addColorStop(0, `rgba(255,255,255,${1 - p})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 90, y - 38);
        ctx.stroke();
        if (p >= 1) s.shoot = null;
      }
      // Hütte: warmes Fenster, Rauch
      const [wx, wy, ww, wh] = s.cabin;
      glow(ctx, wx + ww / 2, wy + wh / 2, ww * 2.6, [255, 170, 80], 0.35 + 0.08 * Math.sin(t * 4));
      ctx.fillStyle = '#ffcf7a';
      ctx.fillRect(wx, wy, ww, wh);
      if (Math.random() < dt * 3) s.smoke.push({ x: s.chimney.x, y: s.chimney.y, r: 4, a: 0.35 });
      s.smoke = s.smoke.filter((p) => p.a > 0.01);
      for (const p of s.smoke) {
        p.y -= 16 * dt;
        p.x += (8 + Math.sin(t + p.y * 0.05) * 6) * dt;
        p.r += 6 * dt;
        p.a -= 0.05 * dt;
        ctx.fillStyle = `rgba(200,210,230,${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
      // Baumschmuck funkelt, Stern pulsiert
      for (const o of s.ornaments) {
        const f = 0.55 + 0.45 * Math.abs(Math.sin(t * 2 + o.ph));
        glow(ctx, o.x, o.y, 9 * s.u + 3, o.c, 0.5 * f);
        ctx.fillStyle = rgba(o.c, 0.9);
        ctx.beginPath();
        ctx.arc(o.x, o.y, 2.6 * s.u + 1, 0, TAU);
        ctx.fill();
      }
      const sf = 0.75 + 0.25 * Math.sin(t * 2.2);
      glow(ctx, s.treeStar.x, s.treeStar.y, 40 * s.u * sf + 10, [255, 225, 120], 0.55);
      ctx.fillStyle = '#ffe9a0';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = (i % 2 ? 4 : 10) * s.u + (i % 2 ? 1 : 3);
        ctx.lineTo(s.treeStar.x + Math.cos(a) * rr, s.treeStar.y + Math.sin(a) * rr);
      }
      ctx.fill();
      // Schlitten fliegt am Mond vorbei, mit Glitzerspur
      s.nextSleigh -= dt;
      if (s.nextSleigh <= 0 && !s.sleigh) {
        s.sleigh = { x: s.w + 60, y: s.moon.y + rnd(-20, 40), v: -rnd(120, 160) * (s.dash ? 0.8 : 1) };
        s.nextSleigh = rnd(22, 38);
      }
      if (s.sleigh) {
        const g = s.sleigh;
        g.x += g.v * dt;
        g.y += Math.sin(t * 1.5) * 10 * dt;
        if (Math.random() < 0.9) s.trail.push({ x: g.x + 34 * s.u, y: g.y + rnd(-3, 3), a: 1 });
        ctx.fillStyle = '#050b1c';
        ctx.strokeStyle = '#050b1c';
        ctx.lineWidth = 1.2;
        const u = s.u;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.scale(u, u);
        ctx.beginPath();
        ctx.moveTo(14, 4);
        ctx.quadraticCurveTo(26, 10, 40, 4);
        ctx.lineTo(42, -4);
        ctx.lineTo(18, -4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(30, -8, 4.5, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(10, 7);
        ctx.quadraticCurveTo(28, 12, 44, 6);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const rx = -6 - i * 16;
          const leg = Math.sin(t * 14 + i) * 3;
          ctx.beginPath();
          ctx.ellipse(rx, -2, 6, 2.6, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(rx - 5, -3);
          ctx.lineTo(rx - 8, -8);
          ctx.moveTo(rx - 8, -8);
          ctx.lineTo(rx - 11, -12);
          ctx.moveTo(rx - 8, -8);
          ctx.lineTo(rx - 6, -12);
          ctx.moveTo(rx - 3, 0);
          ctx.lineTo(rx - 4 + leg, 5);
          ctx.moveTo(rx + 3, 0);
          ctx.lineTo(rx + 4 - leg, 5);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(14, -2);
        ctx.lineTo(-56, -4);
        ctx.stroke();
        ctx.restore();
        if (g.x < -260) s.sleigh = null;
      }
      s.trail = s.trail.filter((p) => p.a > 0.02);
      for (const p of s.trail) {
        p.a -= dt * 0.9;
        p.y += 8 * dt;
        ctx.fillStyle = `rgba(255,230,150,${p.a})`;
        ctx.fillRect(p.x, p.y, 1.6, 1.6);
      }
      // Schnee in drei Tiefen, mit Böen
      const gust = Math.sin(t * 0.35) * 18;
      ctx.fillStyle = '#fff';
      for (const f of s.snow) {
        f.y += f.v * dt;
        f.x += (Math.sin(t * 0.8 + f.ph) * 10 + gust) * f.z * dt;
        if (f.y > s.h + 6) Object.assign(f, { y: -6, x: rnd(0, s.w) });
        if (f.x > s.w + 6) f.x = -6;
        if (f.x < -6) f.x = s.w + 6;
        ctx.globalAlpha = 0.35 + f.z * 0.55;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  /* ---------------------------------------------------------------- Silvester */
  const FW_COLORS = [[255, 215, 120], [255, 90, 90], [96, 165, 250], [74, 222, 128], [192, 132, 252], [255, 255, 255], [251, 146, 60]];
  SCENES.silvester = {
    trails: 0.2,
    lights: ['#facc15', '#ffffff', '#facc15', '#c084fc'],
    scenery(ctx, w, h, s) {
      const r = rng(2026);
      const u = s.u;
      const base = h * 0.9;
      s.water = base;
      s.beacons = [];
      const towers = [[0.12, 0.26], [0.84, 0.3], [0.93, 0.22]];
      let x = 0;
      while (x < w) {
        const bw = (24 + r() * 46) * u + 8;
        let bh = h * (0.04 + r() * 0.1) * (Math.abs(x / w - 0.5) < 0.3 ? 0.75 : 1.2);
        for (const [tx, th] of towers) if (Math.abs(x + bw / 2 - w * tx) < bw) bh = h * th;
        const col = r() < 0.5 ? '#07061a' : '#0b0924';
        ctx.fillStyle = col;
        ctx.fillRect(x, base - bh, bw, bh);
        if (bh > h * 0.2) {
          // Turm mit schräger Spitze (Maze Bank) und Blinklicht
          ctx.beginPath();
          ctx.moveTo(x, base - bh);
          ctx.lineTo(x + bw, base - bh - bw * 0.5);
          ctx.lineTo(x + bw, base - bh);
          ctx.fill();
          s.beacons.push({ x: x + bw * 0.85, y: base - bh - bw * 0.45, ph: r() * TAU });
        } else if (r() < 0.3) {
          ctx.fillRect(x + bw * 0.45, base - bh - 18 * u, 2, 18 * u);
          s.beacons.push({ x: x + bw * 0.45 + 1, y: base - bh - 18 * u, ph: r() * TAU });
        }
        // Fenster
        for (let wy = base - bh + 6; wy < base - 6; wy += 7 * u + 3) {
          for (let wx = x + 4; wx < x + bw - 4; wx += 6 * u + 3) {
            if (r() < 0.32) {
              ctx.fillStyle = r() < 0.75 ? 'rgba(253,230,138,0.6)' : 'rgba(147,197,253,0.5)';
              ctx.fillRect(wx, wy, 2.2 * u + 0.6, 3 * u + 0.6);
            }
          }
        }
        x += bw + r() * 4;
      }
      // Wasser mit Spiegelung der Lichter
      ctx.fillStyle = vgrad(ctx, base, h, [[0, '#0a0826'], [1, '#03020c']]);
      ctx.fillRect(0, base, w, h - base);
      ctx.globalAlpha = 0.18;
      ctx.save();
      ctx.translate(0, base * 2);
      ctx.scale(1, -1);
      ctx.drawImage(ctx.canvas, 0, (base - h * 0.5) * (ctx.canvas.width / w), ctx.canvas.width, h * 0.5 * (ctx.canvas.width / w), 0, base - h * 0.5, w, h * 0.5);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(3,2,12,0.55)';
      for (let y = base + 3; y < h; y += 4) ctx.fillRect(0, y, w, 1.5);
    },
    init(s) {
      s.rockets = [];
      s.sparks = [];
      s.streaks = [];
      s.next = 0.5;
      s.finale = s.dash ? Infinity : rnd(18, 26);
    },
    step(ctx, dt, t, s) {
      const launch = () => {
        s.rockets.push({ x: rnd(s.w * 0.1, s.w * 0.9), y: s.water, vy: -rnd(s.h * 0.55, s.h * 0.8), top: rnd(s.top + 40, s.h * 0.42), c: pick(FW_COLORS), kind: pick(['peony', 'peony', 'ring', 'willow', 'palm', 'glitter', 'crossette']) });
      };
      s.next -= dt;
      if (s.next <= 0) {
        launch();
        s.next = s.dash ? rnd(4, 7) : rnd(0.8, 2);
      }
      s.finale -= dt;
      if (s.finale <= 0) {
        for (let i = 0; i < 6; i++) setTimeout(launch, i * 140);
        s.finale = rnd(22, 32);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = s.rockets.length - 1; i >= 0; i--) {
        const rk = s.rockets[i];
        rk.y += rk.vy * dt;
        rk.vy *= 0.985;
        ctx.fillStyle = 'rgba(255,220,160,0.9)';
        ctx.fillRect(rk.x - 1, rk.y, 2, 5);
        if (Math.random() < 0.6) s.sparks.push({ x: rk.x, y: rk.y + 5, vx: rnd(-15, 15), vy: rnd(10, 40), life: 0.4, age: 0, c: [255, 200, 120], r: 1 });
        if (rk.y <= rk.top) {
          s.rockets.splice(i, 1);
          burst(s, rk);
        }
      }
      for (let i = s.sparks.length - 1; i >= 0; i--) {
        const p = s.sparks[i];
        p.age += dt;
        if (p.age > p.life) {
          if (p.split) {
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * TAU;
              s.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.6, age: 0, c: p.c, r: 1.2, g: 60 });
            }
          }
          s.sparks.splice(i, 1);
          continue;
        }
        p.vy += (p.g || 70) * dt;
        p.vx *= p.drag || 0.985;
        p.vy *= p.drag || 0.985;
        const ox = p.x;
        const oy = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = 1 - p.age / p.life;
        const tw = p.twinkle ? (Math.random() < 0.5 ? 1 : 0.2) : 1;
        // als kurzer Strich vom letzten Ort – mit dem Nachleuchten entstehen weiche Schweife
        ctx.strokeStyle = rgba(p.c, a * tw);
        ctx.lineWidth = (p.r || 1.5) * (0.5 + a * 0.9);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // Spiegelung der Explosionen im Wasser
      s.streaks = s.streaks.filter((k) => k.a > 0.02);
      for (const k of s.streaks) {
        k.a -= dt * 1.4;
        for (let i = 0; i < 5; i++) {
          const y = s.water + 4 + rnd(0, s.h - s.water - 6);
          const d = (y - s.water) / (s.h - s.water);
          ctx.fillStyle = rgba(k.c, k.a * 0.22 * (1 - d));
          ctx.fillRect(k.x + rnd(-14, 14) * (1 + d), y, rnd(8, 22), 1.2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const b of s.beacons) {
        const on = Math.sin(t * 3 + b.ph) > 0.6;
        if (on) {
          glow(ctx, b.x, b.y, 7, [255, 60, 60], 0.9);
        }
      }
    },
  };
  function burst(s, rk) {
    const big = s.dash ? 0.6 : 1;
    const add = (o) => s.sparks.push({ x: rk.x, y: rk.y, age: 0, c: rk.c, r: 1.6, ...o });
    if (rk.kind === 'ring') {
      const n = Math.round(48 * big);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        add({ vx: Math.cos(a) * 150, vy: Math.sin(a) * 150 * 0.55, life: 1.4, drag: 0.975, g: 30 });
      }
    } else if (rk.kind === 'willow') {
      const n = Math.round(60 * big);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU);
        const v = rnd(40, 120);
        add({ vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 2.6, drag: 0.97, g: 45, c: [255, 196, 90], r: 1.3 });
      }
    } else if (rk.kind === 'palm') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        for (let j = 0; j < 7; j++) add({ vx: Math.cos(a) * (60 + j * 22), vy: Math.sin(a) * (60 + j * 22), life: 1.5, drag: 0.98, r: 2 });
      }
    } else if (rk.kind === 'crossette') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        add({ vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.55, drag: 0.98, split: true, r: 2 });
      }
    } else {
      const n = Math.round(80 * big);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU);
        const v = rnd(60, 190);
        add({ vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(1.1, 1.9), twinkle: rk.kind === 'glitter', c: rk.kind === 'glitter' ? [255, 240, 200] : rk.c });
      }
    }
    s.streaks.push({ x: rk.x, c: rk.c, a: 1 });
  }

  /* ---------------------------------------------------------------- Valentinstag */
  const PINKS = [[251, 113, 133], [244, 63, 94], [253, 164, 175], [225, 29, 72], [249, 168, 212]];
  SCENES.valentin = {
    lights: ['#fb7185', '#fda4af', '#f43f5e'],
    scenery(ctx, w, h, s) {
      const r = rng(214);
      const u = s.u;
      const ground = hill(w, h, 0.92, 0.025, 14, 1.2);
      ground.fill(ctx, vgrad(ctx, h * 0.88, h, [[0, '#2a0a1e'], [1, '#12030c']]), 'rgba(251,113,133,0.25)');
      // Herzbäume links und rechts
      for (const [fx, size] of [[0.07, 1], [0.93, 0.9], [0.2, 0.55]]) {
        const tx = w * fx;
        const ty = ground.y(tx) + 4;
        const tips = [];
        ctx.strokeStyle = '#1c0612';
        ctx.lineCap = 'round';
        branch(ctx, tx, ty, (60 * u + 22) * size, -Math.PI / 2, (9 * u + 2) * size, 6, r, tips);
        for (const [bx, by] of tips) {
          for (let k = 0; k < 3; k++) {
            const c = PINKS[Math.floor(r() * PINKS.length)];
            ctx.fillStyle = rgba(c, 0.75 + r() * 0.25);
            const hs = (6 + r() * 7) * u * size + 2;
            heartPath(ctx, bx + (r() - 0.5) * 14 * u, by + (r() - 0.5) * 12 * u - hs / 2, hs);
            ctx.fill();
          }
        }
      }
      // Laterne mit Bank
      const lx = w * 0.3;
      const ly = ground.y(lx) + 4;
      ctx.fillStyle = '#16040d';
      ctx.fillRect(lx - 2, ly - 120 * u - 20, 4, 120 * u + 20);
      ctx.fillRect(lx - 9, ly - 130 * u - 24, 18, 12);
      s.lamp = { x: lx, y: ly - 120 * u - 16 };
      const bx = w * 0.38;
      const by = ground.y(bx) + 2;
      ctx.fillRect(bx - 40 * u, by - 22 * u, 80 * u, 5 * u);
      ctx.fillRect(bx - 40 * u, by - 40 * u, 80 * u, 4 * u);
      ctx.fillRect(bx - 34 * u, by - 22 * u, 4 * u, 22 * u);
      ctx.fillRect(bx + 30 * u, by - 22 * u, 4 * u, 22 * u);
    },
    init(s) {
      s.orbs = Array.from({ length: Math.round(16 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.top, s.h), r: rnd(30, 90) * s.u, c: pick(PINKS), vx: rnd(-6, 6), vy: rnd(-5, 5), a: rnd(0.04, 0.1) }));
      s.hearts = Array.from({ length: Math.round(26 * s.k) }, () => newHeart(s, true));
      s.petals = Array.from({ length: Math.round(22 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(0, s.h), r: rnd(4, 8) * s.u, v: rnd(20, 40), rot: rnd(0, TAU), spin: rnd(-1.5, 1.5), ph: rnd(0, TAU) }));
      s.pops = [];
      s.nextPop = s.dash ? Infinity : rnd(4, 8);
    },
    step(ctx, dt, t, s) {
      ctx.globalCompositeOperation = 'lighter';
      for (const o of s.orbs) {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (o.x < -o.r) o.x = s.w + o.r;
        if (o.x > s.w + o.r) o.x = -o.r;
        if (o.y < s.top - o.r) o.y = s.h + o.r;
        if (o.y > s.h + o.r) o.y = s.top - o.r;
        glow(ctx, o.x, o.y, o.r, o.c, o.a);
      }
      // schlagendes Herz unten in der Mitte (Doppelschlag)
      const beat = (tt) => Math.exp(-(((tt % 1.2) * 12) ** 2) / 4) + 0.7 * Math.exp(-((((tt % 1.2) - 0.22) * 12) ** 2) / 4);
      const b = beat(t);
      const hs = s.h * 0.34 * (1 + b * 0.05);
      ctx.save();
      heartPath(ctx, s.w / 2, s.h * 1.02 - hs * 0.95, hs);
      ctx.fillStyle = `rgba(244,63,94,${(s.dash ? 0.05 : 0.08) + b * 0.08})`;
      ctx.fill();
      ctx.restore();
      glow(ctx, s.lamp.x, s.lamp.y, 70 * s.u, [255, 190, 150], 0.35);
      ctx.globalCompositeOperation = 'source-over';
      for (const hh of s.hearts) {
        hh.y -= hh.v * dt;
        hh.x += Math.sin(t * hh.sw + hh.ph) * 12 * dt;
        if (hh.y < s.top - 20) Object.assign(hh, newHeart(s, false));
        ctx.save();
        ctx.translate(hh.x, hh.y);
        ctx.rotate(Math.sin(t + hh.ph) * 0.25);
        heartPath(ctx, 0, -hh.s / 2, hh.s);
        if (hh.line) {
          ctx.strokeStyle = rgba(hh.c, hh.a);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.fillStyle = rgba(hh.c, hh.a);
          ctx.fill();
        }
        ctx.restore();
      }
      for (const p of s.petals) {
        p.y += p.v * dt;
        p.x += Math.sin(t + p.ph) * 18 * dt;
        p.rot += p.spin * dt;
        if (p.y > s.h + 10) Object.assign(p, { y: -10, x: rnd(0, s.w) });
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, 0.5 + 0.5 * Math.sin(t * 2 + p.ph));
        ctx.fillStyle = 'rgba(225,29,72,0.75)';
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // Herz-Explosionen
      s.nextPop -= dt;
      if (s.nextPop <= 0) {
        const x = rnd(s.w * 0.15, s.w * 0.85);
        const y = rnd(s.top + 60, s.h * 0.45);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          s.pops.push({ x, y, vx: Math.cos(a) * rnd(60, 110), vy: Math.sin(a) * rnd(60, 110), age: 0, c: pick(PINKS), s: rnd(6, 11) });
        }
        s.nextPop = rnd(6, 11);
      }
      s.pops = s.pops.filter((p) => p.age < 1.6);
      for (const p of s.pops) {
        p.age += dt;
        p.vx *= 0.97;
        p.vy = p.vy * 0.97 + 30 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        heartPath(ctx, p.x, p.y - p.s / 2, p.s);
        ctx.fillStyle = rgba(p.c, 1 - p.age / 1.6);
        ctx.fill();
      }
    },
  };
  function newHeart(s, anywhere) {
    return { x: rnd(0, s.w), y: anywhere ? rnd(s.top, s.h) : s.h + 20, v: rnd(16, 34), s: rnd(8, 20) * s.u + 2, c: pick(PINKS), a: rnd(0.35, 0.75), ph: rnd(0, TAU), sw: rnd(0.6, 1.4), line: Math.random() < 0.3 };
  }

  /* ---------------------------------------------------------------- Ostern & Frühling */
  SCENES.ostern = {
    extra: '<div class="ps-rays"></div>',
    scenery(ctx, w, h, s) {
      const r = rng(404);
      const u = s.u;
      const sunX = w * 0.62;
      glow(ctx, sunX, h * 0.8, h * 0.45, [255, 210, 150], 0.35);
      const back = hill(w, h, 0.8, 0.05, 41, 0.8);
      back.fill(ctx, vgrad(ctx, h * 0.72, h, [[0, '#2f6b45'], [0.3, '#1b4a30']]), 'rgba(190,242,170,0.35)');
      // Hase auf dem Hügel
      const hx = w * 0.74;
      const hy = back.y(hx) + 2;
      const hs = 14 * u + 4;
      ctx.fillStyle = '#163a26';
      ctx.beginPath();
      ctx.ellipse(hx, hy - hs * 0.7, hs, hs * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx + hs * 0.9, hy - hs * 1.35, hs * 0.5, hs * 0.45, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx + hs * 0.85, hy - hs * 2.15, hs * 0.16, hs * 0.6, -0.15, 0, TAU);
      ctx.ellipse(hx + hs * 1.12, hy - hs * 2.1, hs * 0.16, hs * 0.6, 0.25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(hx - hs * 0.95, hy - hs * 0.8, hs * 0.22, 0, TAU);
      ctx.fill();
      // Blütenbaum links
      const tx = w * 0.08;
      const ty = back.y(tx) + 30;
      const tips = [];
      ctx.strokeStyle = '#2a1a12';
      ctx.lineCap = 'round';
      branch(ctx, tx, ty, 70 * u + 24, -Math.PI / 2 + 0.1, 10 * u + 2, 7, r, tips);
      for (const [bx, by] of tips) {
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = `rgba(${245 + r() * 10},${170 + r() * 40},${200 + r() * 30},${0.7 + r() * 0.3})`;
          ctx.beginPath();
          ctx.arc(bx + (r() - 0.5) * 16 * u, by + (r() - 0.5) * 14 * u, (2.5 + r() * 3) * u + 1, 0, TAU);
          ctx.fill();
        }
      }
      const mid = hill(w, h, 0.88, 0.03, 43, 1.3);
      mid.fill(ctx, vgrad(ctx, h * 0.84, h, [[0, '#3b8a52'], [0.3, '#22603a']]), 'rgba(210,250,190,0.4)');
      const front = hill(w, h, 0.955, 0.02, 47, 1.5);
      front.fill(ctx, vgrad(ctx, h * 0.93, h, [[0, '#4ca463'], [0.4, '#2b7343']]));
      // Blumen
      const flowerCols = ['#fde68a', '#f9a8d4', '#c4b5fd', '#fca5a5', '#ffffff', '#93c5fd'];
      for (let i = 0; i < 70; i++) {
        const fx = r() * w;
        const useMid = r() < 0.5;
        const fy = (useMid ? mid.y(fx) : front.y(fx)) + 4 + r() * 10;
        const fr = (useMid ? 2.2 : 3.2) * u + 1;
        ctx.fillStyle = flowerCols[Math.floor(r() * flowerCols.length)];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * TAU;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.75, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(fx, fy, fr * 0.6, 0, TAU);
        ctx.fill();
      }
      // Gras an der Vorderkante
      ctx.strokeStyle = 'rgba(120,200,110,0.8)';
      ctx.lineWidth = 1.2;
      for (let x = 0; x < w; x += 4) {
        const gy = front.y(x) + 2;
        const gh = (6 + r() * 12) * u;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.quadraticCurveTo(x + (r() - 0.5) * 6, gy - gh * 0.6, x + (r() - 0.5) * 8, gy - gh);
        ctx.stroke();
      }
      // bemalte Eier
      const eggCols = ['#fbcfe8', '#bae6fd', '#fde68a', '#c4b5fd', '#bbf7d0', '#fecaca'];
      for (const fx of [0.2, 0.36, 0.55, 0.68, 0.85]) {
        const ex = w * fx + (r() - 0.5) * 30;
        const er = (11 + r() * 5) * u + 3;
        const ey = front.y(ex) + er * 0.2;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate((r() - 0.5) * 0.5);
        ctx.beginPath();
        ctx.ellipse(0, 0, er * 0.78, er, 0, 0, TAU);
        ctx.fillStyle = eggCols[Math.floor(r() * eggCols.length)];
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = eggCols[Math.floor(r() * eggCols.length)];
        ctx.lineWidth = er * 0.18;
        const style = Math.floor(r() * 3);
        if (style === 0) {
          ctx.beginPath();
          for (let x = -er; x <= er; x += er * 0.3) ctx.lineTo(x, (Math.round(x / (er * 0.3)) % 2 ? -0.12 : 0.12) * er);
          ctx.stroke();
        } else if (style === 1) {
          for (const yy of [-0.4, 0, 0.4]) {
            ctx.beginPath();
            ctx.moveTo(-er, yy * er);
            ctx.lineTo(er, yy * er);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          for (let k = 0; k < 7; k++) {
            ctx.beginPath();
            ctx.arc((r() - 0.5) * er * 1.3, (r() - 0.5) * er * 1.6, er * 0.1, 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      }
    },
    init(s) {
      s.petals = Array.from({ length: Math.round(40 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(0, s.h), r: rnd(3, 6) * s.u + 1, v: rnd(16, 34), rot: rnd(0, TAU), spin: rnd(-2, 2), ph: rnd(0, TAU) }));
      s.flies = Array.from({ length: Math.max(2, Math.round(5 * s.k)) }, () => ({ x: rnd(0, s.w), y: rnd(s.h * 0.4, s.h * 0.85), ph: rnd(0, TAU), sp: rnd(0.25, 0.5), c: pick([[251, 191, 36], [244, 114, 182], [96, 165, 250], [167, 139, 250]]) }));
      s.motes = Array.from({ length: Math.round(30 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.top, s.h), v: rnd(4, 10), ph: rnd(0, TAU) }));
    },
    step(ctx, dt, t, s) {
      for (const m of s.motes) {
        m.y -= m.v * dt;
        if (m.y < s.top) m.y = s.h;
        ctx.fillStyle = `rgba(255,240,200,${0.3 + 0.3 * Math.sin(t * 1.5 + m.ph)})`;
        ctx.fillRect(m.x + Math.sin(t + m.ph) * 6, m.y, 1.6, 1.6);
      }
      for (const p of s.petals) {
        p.y += p.v * dt;
        p.x += (Math.sin(t * 0.9 + p.ph) * 20 + 8) * dt;
        p.rot += p.spin * dt;
        if (p.y > s.h + 8) Object.assign(p, { y: -8, x: rnd(-40, s.w) });
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(t * 2 + p.ph)));
        ctx.fillStyle = 'rgba(255,214,231,0.9)';
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // Schmetterlinge: flattern auf weichen Bahnen
      for (const f of s.flies) {
        f.ph += dt * f.sp;
        const x = f.x + Math.sin(f.ph * 1.3) * s.w * 0.18 + Math.sin(f.ph * 3.1) * 30;
        const y = f.y + Math.sin(f.ph * 2.1) * 50 + Math.cos(f.ph * 4.7) * 12;
        const flap = Math.abs(Math.sin(t * 14 + f.ph * 10));
        const sz = 9 * s.u + 3;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = rgba(f.c, 0.9);
        for (const sgn of [-1, 1]) {
          ctx.save();
          ctx.scale(sgn * (0.25 + flap * 0.75), 1);
          ctx.beginPath();
          ctx.ellipse(sz * 0.55, -sz * 0.3, sz * 0.6, sz * 0.45, -0.4, 0, TAU);
          ctx.ellipse(sz * 0.45, sz * 0.35, sz * 0.4, sz * 0.32, 0.4, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#1f1408';
        ctx.fillRect(-1, -sz * 0.6, 2, sz * 1.2);
        ctx.restore();
      }
    },
  };

  /* ---------------------------------------------------------------- Sommer (Vespucci bei Sonnenuntergang) */
  SCENES.sommer = {
    scenery(ctx, w, h, s) {
      const r = rng(77);
      const u = s.u;
      const hz = h * 0.8;
      s.hz = hz;
      // ferne Berge
      ctx.fillStyle = 'rgba(80,20,90,0.65)';
      ctx.beginPath();
      ctx.moveTo(0, hz);
      for (let x = 0; x <= w; x += 12) ctx.lineTo(x, hz - (Math.sin(x * 0.004 + 1) * 0.5 + 0.5) * h * 0.06 - Math.sin(x * 0.013) * h * 0.015);
      ctx.lineTo(w, hz);
      ctx.fill();
      // Retro-Sonne mit Streifen
      const sx = w * 0.74;
      const sr = Math.min(w, h) * 0.17;
      s.sun = { x: sx, r: sr };
      glow(ctx, sx, hz, sr * 2.6, [255, 120, 140], 0.32);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, hz);
      ctx.clip();
      ctx.fillStyle = vgrad(ctx, hz - sr, hz, [[0, '#ffd56a'], [0.5, '#ff8a5a'], [1, '#ff3d8b']]);
      ctx.beginPath();
      ctx.arc(sx, hz, sr, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 6; i++) {
        const y = hz - sr * 0.55 + sr * i * 0.11;
        ctx.fillRect(sx - sr, y, sr * 2, 1.5 + i * 1.5);
      }
      ctx.restore();
      // Meer
      ctx.fillStyle = vgrad(ctx, hz, h, [[0, '#3a0d4a'], [0.4, '#1a0630'], [1, '#08021a']]);
      ctx.fillRect(0, hz, w, h - hz);
      // Pier mit Riesenrad
      const px = w * 0.24;
      const deck = hz + h * 0.03;
      ctx.fillStyle = '#12041e';
      ctx.fillRect(px - w * 0.12, deck - 4, w * 0.24, 5);
      for (let x = px - w * 0.12; x < px + w * 0.12; x += 14 * u + 6) ctx.fillRect(x, deck, 2.5, h * 0.05);
      const wr = h * 0.09;
      const wy = deck - wr - 10;
      ctx.strokeStyle = '#12041e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, wy, wr, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        ctx.beginPath();
        ctx.moveTo(px, wy);
        ctx.lineTo(px + Math.cos(a) * wr, wy + Math.sin(a) * wr);
        ctx.stroke();
      }
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - wr * 0.5, deck - 4);
      ctx.lineTo(px, wy);
      ctx.lineTo(px + wr * 0.5, deck - 4);
      ctx.stroke();
      s.wheel = { x: px, y: wy, r: wr };
      // Palmen
      for (const [fx, hgt, lean] of [[0.03, 0.4, 0.22], [0.97, 0.38, -0.28], [0.9, 0.26, -0.12]]) palm(ctx, w * fx, h + 4, h * hgt, lean, r);
    },
    init(s) {
      s.glints = Array.from({ length: Math.round(90 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.hz + 4, s.h), len: rnd(6, 26), ph: rnd(0, TAU) }));
      s.gulls = [];
      s.nextGull = rnd(2, 6);
      s.motes = Array.from({ length: Math.round(26 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.top, s.hz), v: rnd(3, 9), ph: rnd(0, TAU) }));
    },
    step(ctx, dt, t, s) {
      ctx.globalCompositeOperation = 'lighter';
      // Glitzern auf dem Wasser – unter der Sonne am stärksten
      for (const g of s.glints) {
        const near = Math.max(0, 1 - Math.abs(g.x - s.sun.x) / (s.sun.r * 1.4));
        const a = (0.08 + near * 0.55) * Math.max(0, Math.sin(t * 2.2 + g.ph));
        if (a < 0.02) continue;
        ctx.fillStyle = near > 0.2 ? `rgba(255,170,150,${a})` : `rgba(200,150,255,${a * 0.6})`;
        ctx.fillRect(g.x - g.len / 2, g.y, g.len * (0.6 + near), 1.4);
        g.x += Math.sin(t * 0.3 + g.ph) * 4 * dt;
      }
      // Riesenrad: Lichter drehen sich
      const wh = s.wheel;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + t * 0.12;
        const c = i % 3 === 0 ? [255, 90, 160] : i % 3 === 1 ? [255, 210, 120] : [120, 200, 255];
        glow(ctx, wh.x + Math.cos(a) * wh.r, wh.y + Math.sin(a) * wh.r, 6, c, 0.8 + 0.2 * Math.sin(t * 4 + i));
      }
      for (const m of s.motes) {
        m.y -= m.v * dt;
        if (m.y < s.top) m.y = s.hz;
        ctx.fillStyle = `rgba(255,220,180,${0.25 + 0.25 * Math.sin(t * 2 + m.ph)})`;
        ctx.fillRect(m.x + Math.sin(t * 0.7 + m.ph) * 8, m.y, 1.5, 1.5);
      }
      ctx.globalCompositeOperation = 'source-over';
      // Möwen
      s.nextGull -= dt;
      if (s.nextGull <= 0) {
        const n = Math.round(rnd(1, 4));
        const y = rnd(s.top + 40, s.hz - s.sun.r * 1.2);
        for (let i = 0; i < n; i++) s.gulls.push({ x: -30 - i * 28, y: y + rnd(-20, 20), v: rnd(50, 80), ph: rnd(0, TAU), size: rnd(0.8, 1.2) * s.u });
        s.nextGull = rnd(8, 16);
      }
      s.gulls = s.gulls.filter((g) => g.x < s.w + 40);
      ctx.strokeStyle = '#1b0626';
      ctx.lineWidth = 1.8;
      for (const g of s.gulls) {
        g.x += g.v * dt;
        g.y += Math.sin(t * 1.2 + g.ph) * 6 * dt;
        const f = Math.sin(t * 6 + g.ph) * 4;
        const z = 10 * g.size;
        ctx.beginPath();
        ctx.moveTo(g.x - z, g.y - f);
        ctx.quadraticCurveTo(g.x - z * 0.4, g.y - z * 0.5 - f * 0.5, g.x, g.y);
        ctx.quadraticCurveTo(g.x + z * 0.4, g.y - z * 0.5 - f * 0.5, g.x + z, g.y - f);
        ctx.stroke();
      }
    },
  };
  function palm(ctx, x, y, hgt, lean, r) {
    ctx.fillStyle = '#100318';
    ctx.strokeStyle = '#100318';
    const tx = x + hgt * lean;
    const ty = y - hgt;
    // Stamm: schmaler werdend, leicht gebogen, mit Ringen
    const pt = (p) => [x + (tx - x) * p + Math.sin(p * Math.PI) * hgt * 0.06 * Math.sign(lean || 1), y + (ty - y) * p];
    const wd = (p) => (1 - p * 0.55) * hgt * 0.024 + 1;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const [cx, cy] = pt(i / 24);
      ctx.lineTo(cx - wd(i / 24), cy);
    }
    for (let i = 24; i >= 0; i--) {
      const [cx, cy] = pt(i / 24);
      ctx.lineTo(cx + wd(i / 24), cy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,120,0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 24; i++) {
      const [cx, cy] = pt(i / 24);
      ctx.beginPath();
      ctx.moveTo(cx - wd(i / 24), cy);
      ctx.lineTo(cx + wd(i / 24), cy - 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#100318';
    // Wedel
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.42 + (r() - 0.5) * 0.15;
      const len = hgt * (0.32 + r() * 0.1);
      const ex = tx + Math.cos(a) * len;
      const ey = ty + Math.sin(a) * len * 0.5 + len * 0.35;
      ctx.lineWidth = hgt * 0.018 + 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * len * 0.6, ty + Math.sin(a) * len * 0.6 - len * 0.1, ex, ey);
      ctx.stroke();
      ctx.lineWidth = 1;
      for (let k = 1; k < 9; k++) {
        const p = k / 9;
        const qx = (1 - p) * (1 - p) * tx + 2 * (1 - p) * p * (tx + Math.cos(a) * len * 0.6) + p * p * ex;
        const qy = (1 - p) * (1 - p) * ty + 2 * (1 - p) * p * (ty + Math.sin(a) * len * 0.6 - len * 0.1) + p * p * ey;
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(qx + 2, qy + len * 0.12 * (1 - p * 0.5));
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------- Black Friday */
  SCENES.blackfriday = {
    scenery(ctx, w, h) {
      const hz = h * 0.72;
      glow(ctx, w / 2, hz, w * 0.6, [212, 175, 55], 0.22);
      ctx.fillStyle = 'rgba(255,215,120,0.9)';
      ctx.fillRect(0, hz - 0.5, w, 1.2);
    },
    init(s) {
      s.hz = s.h * 0.72;
      s.coins = Array.from({ length: Math.round(22 * s.k) }, () => newCoin(s, true));
      s.spark = Array.from({ length: Math.round(40 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.top, s.hz), ph: rnd(0, TAU) }));
    },
    step(ctx, dt, t, s) {
      const acc = [212, 175, 55];
      ctx.globalCompositeOperation = 'lighter';
      // Raster zum Horizont, läuft auf den Betrachter zu
      const vx = s.w / 2;
      for (let i = -14; i <= 14; i++) {
        const x = vx + i * s.w * 0.09;
        ctx.strokeStyle = rgba(acc, 0.35 - Math.abs(i) * 0.012);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vx + i * 6, s.hz);
        ctx.lineTo(vx + (x - vx) * 4, s.h + 40);
        ctx.stroke();
      }
      const off = (t * 0.25) % 1;
      for (let k = 0; k < 14; k++) {
        const z = (k + off) / 14;
        const y = s.hz + (s.h - s.hz) * z * z;
        ctx.strokeStyle = rgba(acc, 0.1 + z * 0.4);
        ctx.lineWidth = 0.6 + z * 1.4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s.w, y);
        ctx.stroke();
      }
      // Laser
      for (const [bx, sp, ph] of [[0.05, 0.5, 0], [0.95, -0.45, 1.3], [0.5, 0.3, 2.2]]) {
        if (s.dash && bx === 0.5) continue;
        const a = -Math.PI / 2 + Math.sin(t * sp + ph) * 0.7;
        const x0 = s.w * bx;
        const y0 = s.h;
        const len = s.h * 1.2;
        const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
        g.addColorStop(0, rgba(acc, 0.35));
        g.addColorStop(1, rgba(acc, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
        ctx.stroke();
      }
      for (const p of s.spark) {
        const a = Math.max(0, Math.sin(t * 2.4 + p.ph));
        if (a < 0.6) continue;
        ctx.fillStyle = rgba([255, 230, 160], (a - 0.6) * 2);
        ctx.fillRect(p.x - 3, p.y - 0.4, 6, 0.8);
        ctx.fillRect(p.x - 0.4, p.y - 3, 0.8, 6);
      }
      ctx.globalCompositeOperation = 'source-over';
      // Münzen
      for (const c of s.coins) {
        c.y += c.v * dt;
        c.spin += c.vs * dt;
        if (c.y > s.h + 20) Object.assign(c, newCoin(s, false));
        const sx = Math.abs(Math.cos(c.spin));
        const g = ctx.createLinearGradient(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
        g.addColorStop(0, '#fff1b8');
        g.addColorStop(0.5, '#d4af37');
        g.addColorStop(1, '#8a6a12');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, Math.max(0.8, c.r * sx), c.r, c.tilt, 0, TAU);
        ctx.fill();
        if (sx > 0.4) {
          ctx.strokeStyle = 'rgba(120,85,10,0.7)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, c.r * sx * 0.7, c.r * 0.7, c.tilt, 0, TAU);
          ctx.stroke();
        }
      }
    },
  };
  function newCoin(s, anywhere) {
    return { x: rnd(0, s.w), y: anywhere ? rnd(s.top, s.h) : -20, v: rnd(40, 90), r: rnd(6, 13) * s.u + 2, spin: rnd(0, TAU), vs: rnd(2, 6), tilt: rnd(-0.4, 0.4) };
  }

  /* ---------------------------------------------------------------- Jubiläum */
  SCENES.jubilaeum = {
    scenery(ctx, w, h) {
      // Bühnenvorhang links und rechts (Falten), Bühnenkante unten
      for (const side of [0, 1]) {
        const cw = Math.min(180, w * 0.12);
        const x0 = side ? w - cw : 0;
        for (let i = 0; i < 8; i++) {
          const fx = x0 + (i / 8) * cw;
          const g = ctx.createLinearGradient(fx, 0, fx + cw / 8, 0);
          g.addColorStop(0, '#2a0712');
          g.addColorStop(0.5, '#6b1428');
          g.addColorStop(1, '#2a0712');
          ctx.fillStyle = g;
          ctx.fillRect(fx, 0, cw / 8 + 1, h);
        }
        ctx.fillStyle = vgrad(ctx, 0, h, [[0, 'rgba(0,0,0,0.5)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.6)']]);
        ctx.fillRect(x0, 0, cw, h);
        ctx.fillStyle = 'rgba(212,175,55,0.8)';
        ctx.fillRect(side ? x0 : x0 + cw - 3, 0, 3, h);
      }
      ctx.fillStyle = vgrad(ctx, h * 0.92, h, [[0, 'rgba(212,175,55,0.35)'], [0.05, '#1a0d05'], [1, '#080402']]);
      ctx.fillRect(0, h * 0.92, w, h * 0.08);
    },
    init(s) {
      s.bubbles = Array.from({ length: Math.round(46 * s.k) }, () => newBubble(s, true));
      s.confetti = [];
      s.nextCannon = s.dash ? Infinity : 1.2;
      s.glitter = Array.from({ length: Math.round(40 * s.k) }, () => ({ x: rnd(0, s.w), y: rnd(s.top, s.h * 0.9), ph: rnd(0, TAU) }));
    },
    step(ctx, dt, t, s) {
      ctx.globalCompositeOperation = 'lighter';
      // Scheinwerfer
      for (const [bx, sp, ph, c] of [[0.2, 0.4, 0, [255, 236, 180]], [0.8, -0.35, 1.7, [255, 236, 180]], [0.5, 0.25, 3.1, [255, 200, 230]]]) {
        const a = -Math.PI / 2 + Math.sin(t * sp + ph) * 0.45;
        const x0 = s.w * bx;
        const y0 = s.h * 0.95;
        const len = s.h;
        const spread = 0.09;
        const g = ctx.createRadialGradient(x0, y0, 0, x0, y0, len);
        g.addColorStop(0, rgba(c, s.dash ? 0.12 : 0.2));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(a - spread) * len, y0 + Math.sin(a - spread) * len);
        ctx.lineTo(x0 + Math.cos(a + spread) * len, y0 + Math.sin(a + spread) * len);
        ctx.closePath();
        ctx.fill();
      }
      for (const p of s.glitter) {
        const a = Math.max(0, Math.sin(t * 2 + p.ph));
        if (a < 0.7) continue;
        ctx.fillStyle = `rgba(255,236,170,${(a - 0.7) * 3})`;
        ctx.fillRect(p.x - 3, p.y - 0.4, 6, 0.8);
        ctx.fillRect(p.x - 0.4, p.y - 3, 0.8, 6);
      }
      ctx.globalCompositeOperation = 'source-over';
      // Sektperlen
      for (const b of s.bubbles) {
        b.v += 6 * dt;
        b.y -= b.v * dt;
        b.x += Math.sin(t * 2 + b.ph) * 6 * dt;
        if (b.y < s.top - 10) Object.assign(b, newBubble(s, false));
        ctx.strokeStyle = `rgba(255,236,180,${b.a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${b.a})`;
        ctx.fillRect(b.x - b.r * 0.4, b.y - b.r * 0.5, 1.2, 1.2);
      }
      // Konfetti-Kanonen aus den unteren Ecken
      s.nextCannon -= dt;
      if (s.nextCannon <= 0) {
        for (const side of [0, 1]) {
          for (let i = 0; i < 45; i++) {
            const a = side ? -Math.PI / 2 - rnd(0.2, 0.75) : -Math.PI / 2 + rnd(0.2, 0.75);
            const v = rnd(380, 620);
            s.confetti.push({ x: side ? s.w - 10 : 10, y: s.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rnd(0, TAU), vr: rnd(-8, 8), c: pick(['#d4af37', '#fff1b8', '#ffffff', '#f43f5e', '#c084fc']), w: rnd(4, 8), h: rnd(2, 4), age: 0 });
          }
        }
        s.nextCannon = rnd(7, 11);
      }
      s.confetti = s.confetti.filter((p) => p.age < 5 && p.y < s.h + 20);
      for (const p of s.confetti) {
        p.age += dt;
        p.vy += 260 * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (p.vy > 70) p.vy = 70;
        p.x += p.vx * dt + Math.sin(p.age * 6 + p.rot) * 20 * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(p.age * 8 + p.rot), 1);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    },
  };
  function newBubble(s, anywhere) {
    return { x: rnd(s.w * 0.1, s.w * 0.9), y: anywhere ? rnd(s.top, s.h) : s.h + 10, v: rnd(10, 30), r: rnd(1.5, 4.5) * s.u + 0.5, a: rnd(0.25, 0.6), ph: rnd(0, TAU) };
  }

  /* ---------------------------------------------------------------- Saison wählen */
  function set(name) {
    const s = SCENES[name] ? name : '';
    if (s) root.dataset.season = s;
    else delete root.dataset.season;
    clear();
    current = s;
    const mine = ++gen;
    if (!s || isOff()) return;
    ensureCss(() => {
      if (mine !== gen) return; // inzwischen andere Saison gewählt
      root.classList.add('has-season');
      try {
        run(s);
      } catch (err) {
        clear(); // Deko darf nie die Seite stören
        if (window.console) console.warn('Saison-Deko:', err);
      }
    });
  }

  window.PS = window.PS || {};
  window.PS.season = {
    set,
    get current() {
      return current;
    },
    isOff,
    off(on) {
      try {
        if (on) localStorage.setItem(OFF_KEY, '1');
        else localStorage.removeItem(OFF_KEY);
      } catch {
        /* ohne Speicher: nur für diesen Besuch */
      }
      set(root.dataset.season || current);
    },
    /** Neu aufbauen (z. B. nachdem „Bewegung“ umgestellt wurde). */
    refresh: () => set(root.dataset.season || current),
  };

  const start = () => set(root.dataset.season || '');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
