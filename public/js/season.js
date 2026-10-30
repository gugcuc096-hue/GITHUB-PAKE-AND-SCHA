/*
 * Saison-Deko (Einstellungen → Konfiguration → Stil & Saison): theme.js setzt <html data-season="…">, dieses Skript
 * schmückt die Seite passend dazu – hinter dem Inhalt (in .ambient-bg) und, wo es passt, oben darüber:
 *   halloween    Glut steigt auf, Nebel, Mond, Spinnennetz, ab und zu ein Fledermaus-Schwarm
 *   weihnachten  Schneefall in drei Tiefen, Lichterkette mit funkelnden Birnen
 *   silvester    Feuerwerk mit Raketen, Funkenregen in Gold
 *   valentin     aufsteigende Herzen, rosa Schimmer
 *   ostern       fallende Blütenblätter, Frühlingslicht
 *   sommer       Sonnenstrahlen, schwebende Lichtpunkte
 *   blackfriday  Goldglitzer auf Schwarz
 *   jubilaeum    Goldkonfetti zur Begrüßung, danach sanfter Glitzer
 * Im Dashboard deutlich dezenter. Bei „Bewegung reduzieren“ bleibt nur die ruhige Deko (ohne Teilchen).
 * Jede Person kann die Deko für sich abschalten: PS.season.off(true) (Mein Profil → Animationen).
 */
(() => {
  'use strict';
  const root = document.documentElement;
  const OFF_KEY = 'ps.season.off';
  const dash = () => !!document.getElementById('content') && !!document.getElementById('sidebar');
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

  let stopLoop = null;
  let timers = [];
  let current = '';

  function ensureCss() {
    if (document.getElementById('psSeasonCss')) return;
    const l = document.createElement('link');
    l.id = 'psSeasonCss';
    l.rel = 'stylesheet';
    l.href = `/css/season.css${ver}`;
    document.head.appendChild(l);
  }

  function clear() {
    if (stopLoop) stopLoop();
    stopLoop = null;
    timers.forEach(clearTimeout);
    timers = [];
    document.querySelectorAll('.ps-season').forEach((n) => n.remove());
    root.classList.remove('has-season');
  }

  /* ---------------------------------------------------------------- Teilchen auf einer Leinwand */
  function canvasLayer() {
    const host = document.querySelector('.ambient-bg') || document.body;
    const c = document.createElement('canvas');
    c.className = 'ps-season ps-season-canvas';
    c.setAttribute('aria-hidden', 'true');
    host.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const size = () => {
      w = innerWidth;
      h = innerHeight;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener('resize', size);
    return { c, ctx, get w() { return w; }, get h() { return h; }, drop: () => removeEventListener('resize', size) };
  }

  function loop(step) {
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) step(dt, now / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const density = (per) => {
    const n = Math.round((innerWidth * innerHeight) / per);
    return Math.max(12, Math.min(dash() ? 60 : 160, dash() ? Math.round(n * 0.45) : n));
  };

  /** Teilchen, die fallen (Schnee, Blüten, Glitzer) oder steigen (Glut, Herzen, Lichtpunkte). */
  function particles(kind) {
    const L = canvasLayer();
    const { ctx } = L;
    const rising = kind === 'ember' || kind === 'heart' || kind === 'mote';
    const per = { snow: 9000, ember: 26000, heart: 42000, petal: 26000, mote: 30000, glitter: 16000 }[kind] || 20000;
    const make = (anywhere) => {
      const z = rnd(0.35, 1); // Tiefe: weiter hinten = kleiner, langsamer, blasser
      return {
        x: rnd(0, L.w),
        y: anywhere ? rnd(0, L.h) : rising ? L.h + 20 : -20,
        z,
        r: { snow: rnd(1, 3.4), ember: rnd(0.8, 2.4), heart: rnd(6, 13), petal: rnd(4, 8), mote: rnd(1, 2.6), glitter: rnd(0.8, 2) }[kind] * z,
        v: { snow: rnd(18, 46), ember: rnd(14, 36), heart: rnd(12, 26), petal: rnd(20, 42), mote: rnd(5, 14), glitter: rnd(10, 26) }[kind] * z,
        sway: rnd(0.4, 1.4),
        phase: rnd(0, Math.PI * 2),
        rot: rnd(0, Math.PI * 2),
        spin: rnd(-1.4, 1.4),
        hue: kind === 'ember' ? rnd(18, 42) : kind === 'heart' ? rnd(330, 355) : kind === 'petal' ? rnd(320, 350) : 45,
      };
    };
    const list = Array.from({ length: density(per) }, () => make(true));
    const heart = (x, y, s) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.3);
      ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
      ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
      ctx.fill();
    };
    stopLoop = loop((dt, t) => {
      ctx.clearRect(0, 0, L.w, L.h);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.y += (rising ? -p.v : p.v) * dt;
        p.x += Math.sin(t * p.sway + p.phase) * 14 * dt * p.z + (kind === 'snow' ? 6 * dt : 0);
        p.rot += p.spin * dt;
        if (rising ? p.y < -30 : p.y > L.h + 30) list[i] = make(false);
        if (p.x < -30) p.x = L.w + 20;
        if (p.x > L.w + 30) p.x = -20;
        const a = 0.25 + p.z * 0.6;
        if (kind === 'snow') {
          ctx.fillStyle = `rgba(255,255,255,${a * 0.85})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, 6.283);
          ctx.fill();
        } else if (kind === 'ember') {
          const flick = 0.55 + 0.45 * Math.sin(t * 7 + p.phase);
          ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${a * flick})`;
          ctx.shadowColor = `hsla(${p.hue}, 100%, 55%, 0.9)`;
          ctx.shadowBlur = 8 * p.z;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, 6.283);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (kind === 'heart') {
          ctx.fillStyle = `hsla(${p.hue}, 85%, 68%, ${a * 0.55})`;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(t + p.phase) * 0.25);
          heart(0, -p.r / 2, p.r);
          ctx.restore();
        } else if (kind === 'petal') {
          ctx.fillStyle = `hsla(${p.hue}, 70%, 88%, ${a * 0.8})`;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, 0.55 + 0.45 * Math.sin(t * 2 + p.phase));
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, 6.283);
          ctx.fill();
          ctx.restore();
        } else {
          // Lichtpunkte und Glitzer: funkeln
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (kind === 'glitter' ? 3 : 1.2) + p.phase));
          ctx.fillStyle = kind === 'glitter' ? `hsla(46, 90%, ${70 + 20 * tw}%, ${a * tw})` : `hsla(48, 100%, 85%, ${a * tw * 0.7})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (kind === 'glitter' ? 0.6 + tw * 0.6 : 1), 0, 6.283);
          ctx.fill();
          if (kind === 'glitter' && tw > 0.92) {
            ctx.fillRect(p.x - p.r * 3, p.y - 0.4, p.r * 6, 0.8);
            ctx.fillRect(p.x - 0.4, p.y - p.r * 3, 0.8, p.r * 6);
          }
        }
      }
    });
    const stop = stopLoop;
    stopLoop = () => {
      stop();
      L.drop();
    };
  }

  /** Feuerwerk: Raketen steigen auf und zerplatzen in Funken mit Schwerkraft. */
  function fireworks() {
    const L = canvasLayer();
    const { ctx } = L;
    const rockets = [];
    const sparks = [];
    let next = 0.6;
    const hues = [45, 48, 0, 200, 280, 140];
    stopLoop = loop((dt) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, L.w, L.h);
      ctx.globalCompositeOperation = 'lighter';
      next -= dt;
      if (next <= 0) {
        next = dash() ? rnd(3.5, 6) : rnd(1.1, 2.6);
        rockets.push({ x: rnd(L.w * 0.12, L.w * 0.88), y: L.h + 10, vy: -rnd(L.h * 0.62, L.h * 0.85), top: rnd(L.h * 0.12, L.h * 0.42), hue: hues[Math.floor(rnd(0, hues.length))] });
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy * dt;
        r.vy *= 0.985;
        ctx.fillStyle = `hsla(${r.hue}, 100%, 75%, 0.9)`;
        ctx.fillRect(r.x - 1, r.y, 2, 6);
        if (r.y <= r.top) {
          rockets.splice(i, 1);
          const n = dash() ? 40 : 80;
          for (let k = 0; k < n; k++) {
            const ang = (k / n) * Math.PI * 2 + rnd(-0.05, 0.05);
            const sp = rnd(60, 190);
            sparks.push({ x: r.x, y: r.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rnd(1.1, 1.9), age: 0, hue: r.hue + rnd(-12, 12) });
          }
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.age += dt;
        if (s.age > s.life) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 70 * dt;
        s.vx *= 0.985;
        s.vy *= 0.985;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const a = 1 - s.age / s.life;
        ctx.fillStyle = `hsla(${s.hue}, 100%, ${60 + 25 * a}%, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.6 * a + 0.4, 0, 6.283);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    });
    const stop = stopLoop;
    stopLoop = () => {
      stop();
      L.drop();
    };
  }

  /* ---------------------------------------------------------------- Deko über dem Inhalt */
  function overlay(html, cls) {
    const el = document.createElement('div');
    el.className = `ps-season ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }
  const BAT = '<svg viewBox="0 0 64 28"><path d="M32 10c-2-4-5-5-7-4 1 2 0 4-2 4-3 0-5-3-9-3-4 0-8 3-14 9 6-2 10-1 12 2 1-2 4-3 6-2 1-2 4-3 6-1 2 1 3 4 4 6l4-3 4 3c1-2 2-5 4-6 2-2 5-1 6 1 2-1 5 0 6 2 2-3 6-4 12-2-6-6-10-9-14-9-4 0-6 3-9 3-2 0-3-2-2-4-2-1-5 0-7 4z"/></svg>';
  function bats() {
    const fly = () => {
      if (document.hidden || calm()) return;
      const flock = overlay(Array.from({ length: Math.round(rnd(3, 7)) }, (_, i) => `<span class="bat" style="--d:${(i * 0.18).toFixed(2)}s;--y:${Math.round(rnd(-40, 40))}px;--s:${rnd(0.6, 1.1).toFixed(2)}">${BAT}</span>`).join(''), 'ps-bats');
      flock.style.top = `${Math.round(rnd(8, 38))}vh`;
      timers.push(setTimeout(() => flock.remove(), 9000));
    };
    timers.push(setTimeout(fly, 2500));
    const again = () => timers.push(setTimeout(() => (fly(), again()), rnd(14000, 26000)));
    again();
  }
  function garland() {
    const n = Math.max(10, Math.round(innerWidth / 70));
    const colors = ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#f472b6'];
    const bulbs = Array.from({ length: n }, (_, i) => {
      const x = ((i + 0.5) / n) * 100;
      const sag = Math.sin(((i + 0.5) / n) * Math.PI * Math.ceil(n / 6)) ** 2 * 10;
      return `<span class="bulb" style="left:${x.toFixed(2)}%;top:${(4 + sag).toFixed(1)}px;--c:${colors[i % colors.length]};--d:${((i * 0.37) % 2.4).toFixed(2)}s"></span>`;
    }).join('');
    overlay(`<span class="wire"></span>${bulbs}`, 'ps-garland');
  }

  /* ---------------------------------------------------------------- Saison wählen */
  const SCENES = {
    halloween() {
      overlay('', 'ps-moon');
      overlay('<span></span><span></span>', 'ps-fog');
      if (!dash()) overlay('<svg viewBox="0 0 160 160"><g fill="none" stroke="currentColor" stroke-width=".8"><path d="M0 0L160 160M0 0L80 160M0 0L160 80M0 0L30 160M0 0L160 30"/><path d="M0 30q12 2 22-6q4 14 10 22q10-4 24-2M0 62q22 4 40-12q6 26 18 40q20-8 44-4M0 96q30 6 58-18q10 38 26 58q30-12 64-6"/></g></svg>', 'ps-web');
      if (!calm()) {
        particles('ember');
        if (!dash()) bats();
      }
    },
    weihnachten() {
      if (!dash() || innerWidth >= 768) garland();
      overlay('', 'ps-frost');
      if (!calm()) particles('snow');
    },
    silvester() {
      overlay('', 'ps-night');
      if (!calm()) fireworks();
    },
    valentin() {
      overlay('', 'ps-rose');
      if (!calm()) particles('heart');
    },
    ostern() {
      overlay('', 'ps-spring');
      if (!calm()) particles('petal');
    },
    sommer() {
      overlay('<span></span><span></span><span></span>', 'ps-sun');
      if (!calm()) particles('mote');
    },
    blackfriday() {
      overlay('', 'ps-noir');
      if (!calm()) particles('glitter');
    },
    jubilaeum() {
      overlay('', 'ps-gala');
      if (!calm()) {
        particles('glitter');
        if (!dash()) timers.push(setTimeout(() => window.PS && window.PS.confetti && window.PS.confetti(innerWidth / 2, innerHeight * 0.3, { count: 90 }), 900));
      }
    },
  };

  function set(name) {
    const s = SCENES[name] ? name : '';
    if (s) root.dataset.season = s;
    else delete root.dataset.season;
    clear();
    current = s;
    if (!s || isOff()) return;
    ensureCss();
    root.classList.add('has-season');
    try {
      SCENES[s]();
    } catch {
      /* Deko darf nie die Seite stören */
    }
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
