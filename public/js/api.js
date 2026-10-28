/* Gemeinsame Helfer für alle Seiten: window.PS = { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm, drafts, applications } */
(() => {
  'use strict';

  // Kennung dieses Tabs: Der Server meldet eigene Änderungen nicht noch einmal live an denselben Tab zurück
  const tab = Math.random().toString(36).slice(2, 12);

  /*
   * Animationen je Gerät: „auto“ folgt dem System („Bewegung reduzieren“, z. B. Windows: Animationseffekte aus),
   * „on“ zeigt sie immer, „off“ nie (Mein Profil → Animationen). Die gedämpfte Fassung steckt in /css/calm.css –
   * dessen media-Attribut wird hier gesetzt; Animationen per Skript fragen motion.calm().
   */
  const MOTION_KEY = 'ps.motion';
  const motion = {
    get() {
      try {
        const v = localStorage.getItem(MOTION_KEY);
        return v === 'on' || v === 'off' ? v : 'auto';
      } catch {
        return 'auto';
      }
    },
    set(v) {
      try {
        if (v === 'on' || v === 'off') localStorage.setItem(MOTION_KEY, v);
        else localStorage.removeItem(MOTION_KEY);
      } catch {
        /* ohne Speicher bleibt es beim System */
      }
      motion.apply();
    },
    apply() {
      const v = motion.get();
      const media = v === 'on' ? 'not all' : v === 'off' ? 'all' : '(prefers-reduced-motion: reduce)';
      document.querySelectorAll('link[data-calm]').forEach((l) => l.media !== media && (l.media = media));
      document.documentElement.dataset.motion = v;
    },
    /** Gedämpft (keine Bewegung)? */
    calm() {
      const v = motion.get();
      return v === 'off' || (v !== 'on' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    },
    /** Meldet das System selbst „Bewegung reduzieren“? */
    systemCalm: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  motion.apply();

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json', 'X-PS-Tab': tab } };
    if (body instanceof Blob) {
      opts.headers['Content-Type'] = body.type || 'image/jpeg';
      opts.body = body;
    } else if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body ?? {});
    }
    let res;
    // Lesen darf es nach kurzer Pause noch einmal versuchen – z. B. während eines Updates, wenn der Server für einen
    // Moment neu startet (Render: ca. eine Minute). Ändern (POST & Co.) nie automatisch wiederholen.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(url, opts);
        if (method !== 'GET' || attempt >= 3 || ![502, 503, 504].includes(res.status)) break;
      } catch {
        if (method !== 'GET' || attempt >= 3) {
          throw Object.assign(new Error('Der Server ist gerade nicht erreichbar (z. B. während eines Updates). Ihre Eingaben bleiben erhalten – bitte gleich erneut versuchen.'), { status: 0 });
        }
      }
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
    let data = null;
    try { data = await res.json(); } catch { /* leere Antwort */ }
    if (!res.ok) {
      // fields: Hinweise je Feld (Name → Text), damit das Formular sie direkt am Feld zeigen kann
      throw Object.assign(new Error((data && data.error) || `Fehler ${res.status}`), { status: res.status, fields: (data && data.fields) || null });
    }
    // Erfolgreiche Änderung: Vorgeladenes (z. B. Akten beim Drüberfahren) ist damit veraltet
    if (method !== 'GET') document.dispatchEvent(new CustomEvent('ps:changed', { detail: { method, url } }));
    return data;
  }

  const api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    patch: (url, body) => request('PATCH', url, body),
    put: (url, body) => request('PUT', url, body),
    del: (url) => request('DELETE', url),
    /** Lädt ein Bild (Blob) als Binärdaten hoch. */
    upload: (url, blob) => request('POST', url, blob),
  };

  /**
   * Verkleinert ein Bild im Browser (spart Speicher und Upload-Zeit) und liefert ein JPEG.
   * square: mittig quadratisch zuschneiden (Profilbilder).
   */
  /** webp: kleiner speichern, wo das Bild nur im Browser erscheint (nicht in Word-Dateien/Link-Vorschauen); ältere Browser bekommen JPEG. */
  function resizeImage(file, { max = 1600, square = false, quality = 0.86, webp = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('Bitte eine Bilddatei (JPG, PNG, WebP) auswählen.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let sx = 0;
        let sy = 0;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (square) {
          const s = Math.min(sw, sh);
          sx = (sw - s) / 2;
          sy = (sh - s) / 2;
          sw = s;
          sh = s;
        }
        const scale = Math.min(1, max / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a1228'; // Hintergrund für transparente PNGs
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const done = (blob) => (blob ? resolve(blob) : reject(new Error('Das Bild konnte nicht verarbeitet werden.')));
        if (!webp) return canvas.toBlob(done, 'image/jpeg', quality);
        canvas.toBlob((blob) => (blob && blob.type === 'image/webp' ? resolve(blob) : canvas.toBlob(done, 'image/jpeg', quality)), 'image/webp', 0.82);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Dieses Bildformat wird vom Browser nicht unterstützt. Bitte JPG oder PNG verwenden.'));
      };
      img.src = url;
    });
  }

  /** HTML-Escaping: jede Nutzereingabe, die per innerHTML ausgegeben wird, läuft hierdurch. */
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /** SQLite liefert "YYYY-MM-DD HH:MM:SS" in UTC, Termine kommen als ISO-String. */
  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const s = String(value);
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(value) {
    const d = parseDate(value);
    return d ? d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} $`;

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  /** Kurze Meldung unten. action: { label, onClick } – Knopf in der Meldung (z. B. „Rückgängig“); duration in ms. */
  function toast(message, type = 'ok', { action = null, duration = 0 } = {}) {
    let root = document.getElementById('psToastRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'psToastRoot';
      root.className = 'ps-toast-root';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'ps-toast' + (type === 'error' ? ' error' : '');
    el.textContent = message;
    // Kurz ausblenden statt hart verschwinden
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      if (el.classList.contains('out')) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 230);
    };
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ps-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        close();
        action.onClick();
      });
      el.classList.add('has-action');
      el.appendChild(btn);
    }
    // Karte: Leiste läuft bis zum Ausblenden ab, wegwischen schließt; höchstens drei übereinander
    const ms = duration || (type === 'error' ? 6000 : 3500);
    const bar = document.createElement('span');
    bar.className = 'ps-toast-bar';
    bar.style.animationDuration = `${ms}ms`;
    el.appendChild(bar);
    let dragX = null;
    el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.ps-toast-action')) dragX = e.clientX;
    });
    el.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      const dx = e.clientX - dragX;
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220));
    });
    const drop = (e) => {
      if (dragX === null) return;
      const dx = e.clientX - dragX;
      dragX = null;
      if (Math.abs(dx) > 70) close();
      else el.style.transform = el.style.opacity = '';
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
    root.appendChild(el);
    const live = [...root.children].filter((t) => !t.classList.contains('out'));
    live.slice(0, Math.max(0, live.length - 3)).forEach((t) => t.dispatchEvent(new Event('ps:close')));
    el.addEventListener('ps:close', close);
    timer = setTimeout(close, ms);
    return { close };
  }

  /**
   * Bestätigungsdialog im Design der Kanzlei (ersetzt das graue Browser-Fenster von window.confirm).
   * Liefert ein Promise<boolean>. Optionen: title, confirmText, cancelText, danger (roter Knopf).
   * Texte werden nur per textContent gesetzt – Nutzereingaben können kein HTML einschleusen.
   */
  function confirmDialog(message, { title = 'Bitte bestätigen', confirmText = 'OK', cancelText = 'Abbrechen', danger = false } = {}) {
    return new Promise((resolve) => {
      const previous = document.activeElement;
      const root = document.createElement('div');
      root.className = 'ps-dialog-root';
      root.innerHTML = `
        <div class="ps-dialog${danger ? ' is-danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="psDialogTitle" aria-describedby="psDialogText">
          <div class="ps-dialog-mark" aria-hidden="true"><img src="/apple-touch-icon.png" alt=""></div>
          <h2 id="psDialogTitle" class="ps-dialog-title"></h2>
          <p id="psDialogText" class="ps-dialog-text"></p>
          <div class="ps-dialog-actions">
            <button type="button" class="btn-ghost btn-md" data-ps-dialog="cancel"></button>
            <button type="button" class="${danger ? 'btn-danger' : 'btn-gold'} btn-md" data-ps-dialog="ok"></button>
          </div>
        </div>`;
      root.querySelector('.ps-dialog-title').textContent = title;
      root.querySelector('.ps-dialog-text').textContent = message || '';
      const ok = root.querySelector('[data-ps-dialog="ok"]');
      const cancel = root.querySelector('[data-ps-dialog="cancel"]');
      ok.textContent = confirmText;
      cancel.textContent = cancelText;
      document.body.appendChild(root);
      document.body.classList.add('ps-dialog-open');
      requestAnimationFrame(() => root.classList.add('open'));
      // Bei riskanten Aktionen liegt der Fokus zuerst auf „Abbrechen“ – Enter löscht nicht versehentlich.
      (danger ? cancel : ok).focus();

      let done = false;
      const close = (result) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        root.classList.remove('open');
        if (!document.querySelector('.ps-dialog-root.open')) document.body.classList.remove('ps-dialog-open');
        setTimeout(() => root.remove(), 180);
        if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
        resolve(result);
      };
      // Tastatur wird abgefangen, bevor andere Handler (z. B. Esc schließt die Akte) sie sehen.
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          (document.activeElement === ok ? cancel : ok).focus();
        } else if (e.key === 'Enter' && e.target !== ok && e.target !== cancel) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener('keydown', onKey, true);
      ok.addEventListener('click', () => close(true));
      cancel.addEventListener('click', () => close(false));
      // Daneben klicken = Abbrechen – aber nicht, wenn der Klick im Dialog begann (z. B. Text markiert)
      let pressOutside = false;
      root.addEventListener('pointerdown', (e) => (pressOutside = e.target === root));
      root.addEventListener('click', (e) => {
        if (e.target === root && pressOutside) close(false);
      });
    });
  }

  /**
   * „← Zur Akte“ / „← Dashboard“ in Druckansichten (Vertrag, Schriftsatz, Rechnung, Aktenauszug): Aus dem Dashboard
   * öffnen sie sich in einem neuen Tab – dann schließt der Knopf diesen Tab, und man ist wieder im Dashboard genau dort,
   * wo man war (z. B. in der offenen Akte). Sonst (Link aus Discord, Lesezeichen) führt er zum Ziel des Links.
   */
  function closeToDashboard(link) {
    if (!link) return;
    link.addEventListener('click', (e) => {
      let fromDashboard = false;
      try {
        const ref = new URL(document.referrer);
        fromDashboard = ref.origin === location.origin && ref.pathname === '/dashboard';
      } catch {
        /* kein Verweis – direkt aufgerufen */
      }
      if (!fromDashboard || history.length > 1) return;
      e.preventDefault();
      window.close();
      setTimeout(() => (location.href = link.href), 300); // Browser erlaubt das Schließen nicht: wie ein normaler Link
    });
  }

  /*
   * Entwürfe: Angefangene Texte in Formularen bleiben im Browser erhalten – nach Neuladen, abgelaufener Anmeldung,
   * geschlossenem Tab oder wenn das Handy die App beendet. Gespeichert werden nur Textfelder (keine Passwörter, Dateien,
   * versteckten Felder oder Auswahlen), je Formular und Datensatz, höchstens 7 Tage. Nach erfolgreichem Absenden oder
   * „Verwerfen“ ist der Entwurf weg. Formulare mit data-nodraft (oder Felder damit) bleiben außen vor.
   */
  const DRAFT_PREFIX = 'ps.draft:';
  const DRAFT_TTL = 7 * 864e5;
  const drafts = (() => {
    let scope = 'gast';
    let onRestore = null;
    const held = new Set(); // Formulare, die gerade abgeschickt werden – nicht wieder befüllen
    const timers = new WeakMap();
    const store = {
      get(k) {
        try {
          const raw = localStorage.getItem(k);
          const d = raw ? JSON.parse(raw) : null;
          if (!d || Date.now() - d.t > DRAFT_TTL) {
            if (raw) localStorage.removeItem(k);
            return null;
          }
          return d.v;
        } catch {
          return null;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem(k, JSON.stringify({ v, t: Date.now() }));
        } catch {
          /* Speicher voll oder gesperrt – dann eben ohne Entwurf */
        }
      },
      del(k) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* egal */
        }
      },
      keys(prefix) {
        try {
          return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
        } catch {
          return [];
        }
      },
    };
    /** Formular-Schlüssel: Name (data-form bzw. id) und alle data-Angaben (Akte, Datensatz …). */
    function formKey(form) {
      if (!form || form.matches('[data-nodraft]')) return null;
      const name = form.dataset.form || form.id;
      if (!name) return null;
      const extra = Object.keys(form.dataset)
        .filter((k) => k !== 'form' && !k.startsWith('draft'))
        .sort()
        .map((k) => `${k}=${form.dataset[k]}`)
        .join('&');
      return `${DRAFT_PREFIX}${scope}|${name}${extra ? `|${extra}` : ''}|`;
    }
    const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'datetime-local', 'time', 'month']);
    function eligible(el) {
      if (!el || !el.form || el.disabled || el.readOnly || el.matches('[data-nodraft], [aria-hidden="true"]')) return false;
      if (el.tagName === 'TEXTAREA') return !!(el.name || el.id);
      return el.tagName === 'INPUT' && TEXT_TYPES.has(el.type) && !!(el.name || el.id);
    }
    function fieldKey(el) {
      const name = el.name || el.id;
      const same = [...el.form.elements].filter((x) => (x.name || x.id) === name);
      return `${name}#${Math.max(0, same.indexOf(el))}`;
    }
    function save(el) {
      const fk = formKey(el.form);
      if (!fk || !eligible(el)) return;
      const k = fk + fieldKey(el);
      if (el.value === el.defaultValue || !el.value.trim()) store.del(k);
      else store.set(k, el.value);
    }
    function restore(form) {
      const fk = formKey(form);
      if (!fk || held.has(fk)) return;
      let restored = 0;
      for (const el of form.elements) {
        if (!eligible(el) || el.value !== el.defaultValue) continue;
        const v = store.get(fk + fieldKey(el));
        if (v == null || v === el.value) continue;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        restored++;
      }
      if (restored && onRestore) onRestore(form);
    }
    function clear(form) {
      const fk = formKey(form);
      if (fk) store.keys(fk).forEach(store.del);
    }
    /** Beim Absenden: Formular nicht wieder befüllen; done(true) löscht den Entwurf, done(false) behält ihn. */
    function hold(form) {
      const fk = formKey(form);
      if (!fk) return () => {};
      held.add(fk);
      return (ok) => {
        held.delete(fk);
        if (ok) store.keys(fk).forEach(store.del);
      };
    }
    function scan(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === 'FORM') restore(node);
      else node.querySelectorAll('form').forEach(restore);
    }
    /** Einschalten (einmal je Seite): scope trennt die Entwürfe verschiedener Konten im selben Browser. */
    function watch(opts = {}) {
      scope = opts.scope || 'gast';
      onRestore = opts.onRestore || null;
      store.keys(DRAFT_PREFIX).forEach((k) => store.get(k)); // abgelaufene aufräumen
      document.addEventListener('input', (e) => {
        const el = e.target;
        if (!eligible(el)) return;
        clearTimeout(timers.get(el));
        timers.set(el, setTimeout(() => save(el), 250));
      });
      // reset() (z. B. nach dem Absenden) und Auswahl aus der Autovervollständigung
      document.addEventListener('change', (e) => eligible(e.target) && save(e.target));
      new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
      scan(document.body);
    }
    /** Alle Entwürfe dieses Kontos löschen (Abmelden). */
    const clearAll = () => store.keys(`${DRAFT_PREFIX}${scope}|`).forEach(store.del);
    return { watch, clear, clearAll, hold, store, key: (name) => `${DRAFT_PREFIX}${scope}|${name}` };
  })();

  /*
   * Bewerbungen, deren persönlicher Link auf diesem Gerät gespeichert ist (Karriereseite und Bewerberseite merken ihn):
   * list() liest sie, summary() holt Stand und neue Nachrichten vom Server (ohne sie als gelesen zu markieren) und
   * vergisst Links, die es nicht mehr gibt.
   */
  const applications = (() => {
    const KEY = 'ps.bewerbungen';
    function list() {
      try {
        const l = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(l) ? l.filter((x) => x && typeof x.token === 'string' && x.token.length >= 20 && x.token.length <= 64) : [];
      } catch {
        return [];
      }
    }
    async function summary() {
      const mine = list().slice(0, 5);
      if (!mine.length) return [];
      const r = await api.post('/api/public/application-summary', { tokens: mine.map((x) => x.token) });
      const known = new Set(r.applications.map((a) => a.token));
      if (known.size !== mine.length) {
        try {
          localStorage.setItem(KEY, JSON.stringify(mine.filter((x) => known.has(x.token))));
        } catch {
          /* ohne Speicher bleibt die Liste eben */
        }
      }
      return r.applications;
    }
    return { list, summary };
  })();

  /*
   * Fehler direkt am Feld: rote Umrandung und ein kurzer Satz darunter statt einer Meldung oben in der Ecke.
   * Gilt für die Prüfungen des Browsers (required, minlength …), eigene Prüfungen (fieldError) und die Antwort
   * des Servers (fieldErrors). Sobald man das Feld ändert, verschwindet der Hinweis.
   */
  const FE_CSS = `.ps-invalid,.ps-invalid:focus{border-color:#f87171!important;box-shadow:0 0 0 3px rgba(248,113,113,.18)!important}
.ps-field-error{display:flex;align-items:flex-start;gap:.35rem;margin:.35rem 0 0;color:#fca5a5;font-size:.8rem;line-height:1.35;text-align:left;animation:psFeIn .18s ease-out}
.ps-field-error::before{content:'!';flex:none;display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;margin-top:.05rem;border-radius:50%;background:rgba(248,113,113,.18);color:#fca5a5;font-size:.68rem;font-weight:700}
@keyframes psFeIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}`;
  function feStyle() {
    if (document.getElementById('psFieldErrorCss')) return;
    const st = document.createElement('style');
    st.id = 'psFieldErrorCss';
    st.textContent = FE_CSS;
    document.head.appendChild(st);
  }
  /** Wohin der Hinweis kommt: hinter die Feldgruppe (Auswahlliste, E-Mail-Endung) bzw. hinter die Beschriftung des Häkchens. */
  function feAnchor(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.closest('label') || el;
    return el.closest('.combo, .email-group') || el;
  }
  function feClear(el) {
    if (!el || !el.classList || !el.classList.contains('ps-invalid')) return;
    el.classList.remove('ps-invalid');
    el.removeAttribute('aria-invalid');
    const id = el.dataset.psErr;
    if (id) {
      document.getElementById(id)?.remove();
      const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
      delete el.dataset.psErr;
    }
  }
  let feSeq = 0;
  // Wert beim Markieren: der Hinweis verschwindet erst, wenn sich der Wert wirklich ändert (manche Browser
  // melden beim Verlassen des Feldes ein „change“ ohne neue Eingabe – das darf den Hinweis nicht gleich löschen)
  const feVals = new WeakMap();
  const feValue = (el) => (el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value);
  /** Markiert ein Feld mit Hinweis. focus: Feld anspringen (beim ersten Fehler eines Formulars). */
  function fieldError(el, message, { focus = true } = {}) {
    if (!el || !el.isConnected) return;
    feStyle();
    feClear(el);
    const p = document.createElement('p');
    p.className = 'ps-field-error';
    p.id = `psErr${++feSeq}`;
    p.textContent = message || 'Bitte prüfen.';
    feAnchor(el).insertAdjacentElement('afterend', p);
    el.classList.add('ps-invalid');
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), p.id].filter(Boolean).join(' '));
    el.dataset.psErr = p.id;
    feVals.set(el, feValue(el));
    if (focus) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: motion.calm() ? 'auto' : 'smooth' });
    }
  }
  /** Alle Hinweise eines Formulars entfernen. */
  const clearFieldErrors = (form) => form && form.querySelectorAll('.ps-invalid').forEach(feClear);
  /**
   * Antwort des Servers am Formular zeigen: markiert die genannten Felder. Liefert true, wenn mindestens eines
   * gefunden wurde (dann reicht der Hinweis am Feld, sonst bleibt es bei der allgemeinen Meldung).
   */
  function fieldErrors(form, err) {
    if (!form || !err || !err.fields) return false;
    let first = true;
    for (const [name, message] of Object.entries(err.fields)) {
      const el = form.elements[name];
      const field = el && (el instanceof RadioNodeList ? el[0] : el);
      if (!field || field.type === 'hidden' || !field.isConnected) continue;
      fieldError(field, message, { focus: first });
      first = false;
    }
    return !first;
  }
  /** Deutscher Satz zur Prüfung des Browsers (statt der grauen Sprechblase). */
  function validityText(el) {
    const v = el.validity;
    if (v.valueMissing) return el.type === 'checkbox' ? 'Bitte bestätigen.' : el.tagName === 'SELECT' || el.type === 'radio' ? 'Bitte auswählen.' : 'Bitte ausfüllen.';
    if (v.typeMismatch) return el.type === 'email' ? 'Bitte eine gültige E-Mail-Adresse angeben.' : el.type === 'url' ? 'Bitte einen vollständigen Link angeben (https://…).' : 'Bitte prüfen.';
    if (v.tooShort) return `Mindestens ${el.minLength} Zeichen (aktuell ${el.value.length}).`;
    if (v.tooLong) return `Höchstens ${el.maxLength} Zeichen.`;
    if (v.rangeUnderflow) return `Mindestens ${el.min}.`;
    if (v.rangeOverflow) return `Höchstens ${el.max}.`;
    if (v.patternMismatch) return el.title || 'Bitte im richtigen Format angeben.';
    if (v.badInput) return 'Bitte eine gültige Eingabe.';
    if (v.customError) return el.validationMessage;
    return 'Bitte prüfen.';
  }
  // Prüfung des Browsers abfangen: der erste ungültige Eintrag eines Absendens wird angesprungen, alle markiert
  let feBatch = null;
  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target;
      if (!el || !el.form) return;
      e.preventDefault();
      const first = !feBatch || feBatch !== el.form;
      feBatch = el.form;
      queueMicrotask(() => (feBatch = null));
      fieldError(el, validityText(el), { focus: first });
    },
    true,
  );
  /*
   * Live: Nach einer kurzen Tipp-Pause und beim Verlassen eines bearbeiteten Feldes wird geprüft („Mindestens 3 Zeichen
   * (aktuell 1).“) – nicht erst beim Absenden. Ein leeres Pflichtfeld wird beim Tippen nicht angemahnt, erst beim
   * Verlassen (wenn man darin etwas getippt hatte) oder beim Absenden. Steht ein Hinweis, zieht er bei jeder Eingabe nach
   * und verschwindet, sobald der Wert passt. Chat-Eingaben bleiben außen vor.
   */
  const FE_PAUSE = 700;
  const feTimers = new WeakMap();
  const feLiveOk = (el) => !!(el && el.form && el.willValidate && !el.matches('.chat-input, [data-nolive]'));
  function feLive(el, { typing = false } = {}) {
    if (!el || !el.isConnected) return;
    const marked = el.classList.contains('ps-invalid');
    const changed = feVals.get(el) !== feValue(el);
    if (!feLiveOk(el) || el.validity.valid || (typing && el.validity.valueMissing)) {
      // gültig (oder leer beim Tippen): Hinweis weg – eigene/Server-Hinweise aber nur, wenn sich der Wert geändert hat
      if (marked && changed) feClear(el);
      return;
    }
    const text = validityText(el);
    const p = marked && document.getElementById(el.dataset.psErr);
    if (p) {
      // Hinweis steht schon: nur den Text nachziehen (kein erneutes Einblenden bei jedem Tastendruck)
      if (p.textContent !== text) p.textContent = text;
      feVals.set(el, feValue(el));
    } else fieldError(el, text, { focus: false });
  }
  // Während eine Maustaste/ein Finger unten ist, nichts einblenden: der Hinweis schiebt sonst den Knopf weg, auf den
  // gerade geklickt wird („Akte anlegen“) – der Klick ginge ins Leere. Geprüft wird direkt nach dem Loslassen.
  let feDown = false;
  document.addEventListener('pointerdown', () => (feDown = true), true);
  const feUp = () => setTimeout(() => (feDown = false), 0);
  document.addEventListener('pointerup', feUp, true);
  document.addEventListener('pointercancel', feUp, true);
  function feLater(el, opts) {
    if (!feDown) return feLive(el, opts);
    const run = () => {
      document.removeEventListener('pointerup', run, true);
      document.removeEventListener('pointercancel', run, true);
      setTimeout(() => feLive(el, opts), 0); // erst nach dem Klick (Absenden prüft dann selbst)
    };
    document.addEventListener('pointerup', run, true);
    document.addEventListener('pointercancel', run, true);
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    clearTimeout(feTimers.get(el));
    if (el.classList.contains('ps-invalid')) feLive(el, { typing: true });
    else if (e.isTrusted && feLiveOk(el)) {
      el.dataset.psDirty = '1';
      feTimers.set(el, setTimeout(() => feLater(el, { typing: true }), FE_PAUSE));
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    // Auswahlknöpfe: eine Wahl erledigt den Hinweis der ganzen Gruppe
    if (el.type === 'radio' && el.name && el.form) [...el.form.querySelectorAll('input[type="radio"]')].filter((r) => r.name === el.name).forEach(feClear);
    else if (el.classList.contains('ps-invalid')) feLive(el);
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.psDirty) return;
    clearTimeout(feTimers.get(el));
    feLater(el);
  });
  document.addEventListener('reset', (e) => e.target.querySelectorAll && e.target.querySelectorAll('[data-ps-dirty]').forEach((el) => delete el.dataset.psDirty));
  document.addEventListener('reset', (e) => clearFieldErrors(e.target));

  /*
   * Zahlen zählen hoch: Elemente mit data-count (Schlüssel) zeigen ihre Zahlen kurz hochzählend – beim ersten Erscheinen
   * von 0, danach nur bei einer Änderung vom zuletzt gezeigten Wert (14 → 15). Mehrere Zahlen in einem Text („12–30 HE“)
   * laufen gemeinsam; das Format (Tausenderpunkt, Komma, „ %“, „ $“, „ ★“) bleibt. whenVisible: erst, wenn die Zahl ins
   * Bild scrollt; ms: Dauer (Summen in Formularen laufen kürzer). Ändert sich der Wert mitten im Zählen, geht es von der
   * gerade gezeigten Zahl aus weiter. Bei „Bewegung reduzieren“ sofort.
   */
  const countMemory = new Map(); // Schlüssel → { to: Zielwerte, shown: gerade gezeigte Werte, run: Kennung des Laufs }
  const NUM_RE = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/g;
  const parseNum = (s) => Number(s.replace(/\./g, '').replace(',', '.'));
  function countUp(root, { whenVisible = false, ms = 900 } = {}) {
    if (!root || !root.querySelectorAll) return;
    const reduce = motion.calm();
    root.querySelectorAll('[data-count]').forEach((el) => {
      const text = el.textContent;
      const parts = [...text.matchAll(NUM_RE)];
      if (!parts.length) return;
      const target = parts.map((m) => parseNum(m[0]));
      if (!target.every(Number.isFinite)) return;
      const key = el.dataset.count;
      const mem = countMemory.get(key);
      const from = target.map((_, i) => (mem ? (mem.shown[i] ?? mem.to[i] ?? 0) : 0));
      const entry = { to: target, shown: from, run: {} };
      countMemory.set(key, entry);
      if (reduce || from.every((v, i) => v === target[i])) {
        entry.shown = target;
        return;
      }
      const decimals = parts.map((m) => (m[0].split(',')[1] || '').length);
      const fmt = (vals) => {
        let out = '';
        let pos = 0;
        parts.forEach((m, i) => {
          out += text.slice(pos, m.index) + vals[i].toLocaleString('de-DE', { minimumFractionDigits: decimals[i], maximumFractionDigits: decimals[i] });
          pos = m.index + m[0].length;
        });
        return out + text.slice(pos);
      };
      const { run } = entry;
      const start = () => {
        const t0 = performance.now();
        const step = (now) => {
          if (entry.run !== run) return; // inzwischen neu gezeichnet – der neue Lauf übernimmt
          if (!el.isConnected) {
            entry.shown = target;
            return;
          }
          const p = Math.min(1, (now - t0) / ms);
          const e = 1 - Math.pow(1 - p, 3);
          entry.shown = p < 1 ? from.map((f, i) => f + (target[i] - f) * e) : target;
          el.textContent = p < 1 ? fmt(entry.shown) : text;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      el.textContent = fmt(from);
      if (whenVisible && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((x) => x.isIntersecting)) return;
          io.disconnect();
          start();
        }, { threshold: 0.4 });
        io.observe(el);
      } else start();
    });
  }

  /*
   * Zählwerk (Kanzlei-Lager): Elemente mit data-roll (Schlüssel) rollen ihre Ziffern bei einer Änderung wie bei einer
   * alten Kasse vom alten zum neuen Stand – beim ersten Erscheinen von Null aus. Im Text steht dabei immer der echte
   * Wert (die rollenden Ziffern sind nur Bild per CSS), danach ist es wieder ganz normaler Text.
   */
  const rollMemory = new Map();
  function roll(root) {
    if (!root || !root.querySelectorAll) return;
    const calm = motion.calm();
    root.querySelectorAll('[data-roll]').forEach((el) => {
      const text = el.textContent;
      const key = el.dataset.roll;
      const prev = rollMemory.has(key) ? rollMemory.get(key) : null;
      rollMemory.set(key, text);
      const now = text.replace(/\D/g, '');
      if (calm || prev === text || !now) return;
      const old = prev == null ? '' : prev.replace(/\D/g, '');
      const up = (Number(now) || 0) >= (Number(old) || 0);
      let left = now.length;
      el.innerHTML = [...text]
        .map((ch) => {
          if (!/\d/.test(ch)) return esc(ch);
          const k = --left; // Stelle von rechts (0 = Einer)
          const f = Number(old[old.length - 1 - k] || 0);
          const t = Number(ch);
          // Streifen 0–9 zweimal: aufwärts rollt jede Ziffer vorwärts (9 → 0 über die Zehn), abwärts rückwärts
          const [a, z] = up ? [f, t >= f ? t : t + 10] : [f + 10, t <= f ? t + 10 : t];
          return `<span class="ps-rd" style="--a:${a};--z:${z};--k:${k}"><span class="ps-rd-t">${ch}</span></span>`;
        })
        .join('');
      el.classList.add('ps-rolling');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ps-roll-go')));
      setTimeout(() => {
        if (!el.isConnected || !el.classList.contains('ps-rolling')) return;
        el.textContent = text;
        el.classList.remove('ps-rolling', 'ps-roll-go');
      }, 1150);
    });
  }

  /*
   * Gold-Spotlight: Über Karten (Startseite, Karriere) und Kacheln (Dashboard) folgt ein weiches Licht der Maus,
   * der goldene Rand leuchtet in ihrer Nähe auf. Nur mit Maus; Karten mit Formularfeldern bleiben ruhig.
   * Dazu der einmalige Goldschimmer über großen Überschriften (.gold-shine) – gedämpft ohne Bewegung (calm.css) –
   * und das goldene Abzeichen „Anwalt des Monats“ (Teamkarte der Startseite, Profilseite).
   */
  const FX_CSS = `.ps-spot-rel{position:relative}.ps-spot{isolation:isolate}
.ps-spot::after,.ps-spot::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .35s ease}
.ps-spot::after{z-index:-1;background:radial-gradient(420px circle at var(--mx,50%) var(--my,50%),rgba(212,175,55,.11),transparent 62%)}
.ps-spot::before{padding:1px;background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),rgba(240,208,110,.95),rgba(212,175,55,.25) 45%,transparent 72%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.ps-spot.ps-spot-on::after,.ps-spot.ps-spot-on::before{opacity:1}
.gold-shine{background:linear-gradient(110deg,var(--gold-500,#d4af37) 0 41%,#fff7d6 50%,var(--gold-500,#d4af37) 59% 100%) 0 0/250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;padding:0 .14em;margin:0 -.14em;-webkit-box-decoration-break:clone;box-decoration-break:clone;animation:ps-shine 2.2s ease-in-out .5s both}
@keyframes ps-shine{from{background-position:100% 0}to{background-position:0 0}}
.lotm-badge{display:inline-flex;align-items:center;padding:.32rem .85rem;border-radius:999px;font-size:.62rem;font-weight:600;letter-spacing:.18em;text-transform:uppercase;line-height:1.2;color:#1a1405;background:linear-gradient(110deg,#b8902a 0%,#f3d77a 45%,#d4af37 60%,#9c7a20 100%) 0 0/220% 100%;box-shadow:0 6px 22px rgba(212,175,55,.35),inset 0 1px 0 rgba(255,255,255,.45);white-space:nowrap}
.pf-head .lotm-badge{margin-left:.5rem;vertical-align:middle}
@media (max-width:479px){.pf-head .lotm-badge{margin:.5rem 0 0}}
.lotm-on-card{position:absolute;top:-.85rem;left:50%;transform:translateX(-50%);z-index:2}
.team-card.is-lotm{position:relative;overflow:visible;border-color:rgba(212,175,55,.55);box-shadow:0 0 0 1px rgba(212,175,55,.25),0 18px 60px rgba(212,175,55,.14)}
.ps-tilt{will-change:transform;transition:transform .14s ease-out,box-shadow .35s ease,border-color .35s ease!important}
.ps-tilt:not(.ps-tilt-on){transition:transform .7s cubic-bezier(.16,1,.3,1),box-shadow .35s ease,border-color .35s ease!important}
[data-roll]{font-variant-numeric:lining-nums tabular-nums}
.ps-rolling .ps-rd{--rh:1.15em;position:relative;display:inline-block;height:var(--rh);line-height:var(--rh);overflow:hidden;vertical-align:top}
.ps-rolling .ps-rd-t{visibility:hidden}
.ps-rolling .ps-rd::after{content:'0\\A 1\\A 2\\A 3\\A 4\\A 5\\A 6\\A 7\\A 8\\A 9\\A 0\\A 1\\A 2\\A 3\\A 4\\A 5\\A 6\\A 7\\A 8\\A 9';white-space:pre;position:absolute;left:0;right:0;top:0;text-align:center;transform:translateY(calc(var(--a) * var(--rh) * -1))}
.ps-roll-go .ps-rd::after{transform:translateY(calc(var(--z) * var(--rh) * -1));transition:transform .85s cubic-bezier(.2,.75,.2,1) calc(var(--k) * 45ms)}`;
  const fxStyle = document.createElement('style');
  fxStyle.id = 'psFxCss';
  fxStyle.textContent = FX_CSS;
  document.head.appendChild(fxStyle);

  const SPOT_SEL = '.glass-card, .kpi';
  const spotOk = new WeakMap();
  let spotEl = null;
  let spotXY = null;
  let spotRaf = 0;
  function spotTarget(t) {
    const el = t && t.closest ? t.closest(SPOT_SEL) : null;
    if (!el) return null;
    if (!spotOk.has(el)) spotOk.set(el, !el.querySelector('input, textarea, select'));
    return spotOk.get(el) ? el : null;
  }
  function spotOff() {
    if (spotEl) spotEl.classList.remove('ps-spot-on');
    spotEl = null;
  }
  /*
   * In 3D zur Maus neigen sich die Teamkarten der Startseite, die Profilkarte eines Anwalts und die Karteikarte eines
   * Mandanten – große Karten weniger stark. Nicht bei gedämpften Animationen und nicht, solange in der Karte ein Feld
   * bearbeitet wird.
   */
  const TILT_SEL = '.team-card, .pf-card, .client-cover, .kpi'; // Kacheln der Übersicht nur ganz leicht (siehe tilt)
  let tiltEl = null;
  function tiltOff() {
    if (tiltEl) {
      tiltEl.classList.remove('ps-tilt-on');
      tiltEl.style.transform = '';
    }
    tiltEl = null;
  }
  const editing = (el) => {
    const a = document.activeElement;
    return !!a && el.contains(a) && a.matches('input, textarea, select');
  };
  function tilt(el, x, y) {
    if (motion.calm() || editing(el)) {
      if (el.classList.contains('ps-tilt-on')) {
        el.classList.remove('ps-tilt-on');
        el.style.transform = '';
      }
      return;
    }
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const k = Math.min(1, Math.pow(640 / size, 1.5)) * (el.classList.contains('kpi') ? 0.4 : 1);
    const px = Math.max(-0.5, Math.min(0.5, (x - r.left) / r.width - 0.5));
    const py = Math.max(-0.5, Math.min(0.5, (y - r.top) / r.height - 0.5));
    el.classList.add('ps-tilt', 'ps-tilt-on');
    el.style.transform = `perspective(${k >= 1 ? 900 : Math.round(900 / k)}px) translateY(${(-6 * k).toFixed(1)}px) rotateX(${(-py * 9 * k).toFixed(2)}deg) rotateY(${(px * 11 * k).toFixed(2)}deg) scale(${(1 + 0.015 * k).toFixed(4)})`;
  }
  /*
   * Streiflicht: Auf dem Aktendeckel und der Karteikarte liegt ein weiches Licht dort, wo die Maus ist (app.css), und das
   * geprägte Aktenzeichen glänzt in seiner Nähe – wie Licht, das über eine Prägung streift.
   */
  const LIGHT_SEL = '.case-cover, .client-cover';
  let lightEl = null;
  function lightOff() {
    if (lightEl) {
      lightEl.classList.remove('ps-lit');
      lightEl.querySelectorAll('.case-emboss').forEach((n) => n.style.removeProperty('--ex'));
    }
    lightEl = null;
  }
  function light(el, x, y) {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--lx', `${Math.round(x - r.left)}px`);
    el.style.setProperty('--ly', `${Math.round(y - r.top)}px`);
    el.classList.add('ps-lit');
    const emb = el.querySelector('.case-emboss');
    if (emb) {
      const b = emb.getBoundingClientRect();
      emb.style.setProperty('--ex', `${Math.round(x - b.left)}px`);
      emb.style.setProperty('--ey', `${Math.round(y - b.top)}px`);
    }
  }
  const closestOf = (t, sel) => (t && t.closest ? t.closest(sel) : null);
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = spotTarget(e.target);
      if (el !== spotEl) {
        spotOff();
        if (el && !el.classList.contains('ps-spot')) {
          if (getComputedStyle(el).position === 'static') el.classList.add('ps-spot-rel');
          el.classList.add('ps-spot');
        }
        spotEl = el;
      }
      const tl = closestOf(e.target, TILT_SEL);
      if (tl !== tiltEl) {
        tiltOff();
        tiltEl = tl;
      }
      const li = closestOf(e.target, LIGHT_SEL);
      if (li !== lightEl) {
        lightOff();
        lightEl = li;
      }
      if (!spotEl && !tiltEl && !lightEl) return;
      spotXY = [e.clientX, e.clientY];
      if (spotRaf) return;
      spotRaf = requestAnimationFrame(() => {
        spotRaf = 0;
        const [x, y] = spotXY;
        if (spotEl && !spotEl.isConnected) spotOff();
        if (spotEl) {
          const r = spotEl.getBoundingClientRect();
          // Lage in der Karte von der Mitte aus – stimmt auch, solange die Karte geneigt ist
          spotEl.style.setProperty('--mx', `${Math.round(x - (r.left + r.width / 2) + spotEl.offsetWidth / 2)}px`);
          spotEl.style.setProperty('--my', `${Math.round(y - (r.top + r.height / 2) + spotEl.offsetHeight / 2)}px`);
          spotEl.classList.add('ps-spot-on');
        }
        if (tiltEl && !tiltEl.isConnected) tiltOff();
        if (tiltEl) tilt(tiltEl, x, y);
        if (lightEl && !lightEl.isConnected) lightOff();
        if (lightEl) light(lightEl, x, y);
      });
    },
    { passive: true }
  );
  document.documentElement.addEventListener('mouseleave', () => {
    spotOff();
    tiltOff();
    lightOff();
  });

  /*
   * Seitenübergang Teamkarte → Profilseite (index.html, views/anwalt.html): nur dorthin. Jeder andere Wechsel überspringt
   * ihn – sonst bricht der Browser ihn auf einer Seite ohne Übergang (Dashboard, Login …) ab und meldet einen Fehler.
   */
  window.addEventListener('pageswap', (e) => {
    const vt = e.viewTransition;
    if (!vt) return;
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p && p.catch(() => {}));
    let to = null;
    try {
      to = e.activation && e.activation.entry ? new URL(e.activation.entry.url) : null;
    } catch {
      to = null;
    }
    if (!to || to.origin !== location.origin || !to.pathname.startsWith('/team/') || motion.calm()) vt.skipTransition();
  });

  /**
   * Startseite/Karriere: Daten, die der Server gleich in die Seite geschrieben hat (#psBoot). boot('team', '/api/team')
   * nimmt sie – einmal – und fragt nur nach, wenn etwas fehlt.
   */
  let bootData;
  function boot(key, url) {
    if (bootData === undefined) {
      try {
        bootData = JSON.parse(document.getElementById('psBoot')?.textContent || 'null');
      } catch {
        bootData = null;
      }
    }
    const v = bootData && bootData[key];
    if (v) {
      delete bootData[key];
      return Promise.resolve(v);
    }
    return api.get(url);
  }

  /*
   * Lesefortschritt: In langen Akten, Verträgen, Aktenauszügen und Wiki-Artikeln läuft oben eine dünne goldene Linie mit.
   * Gilt für Bereiche mit data-readbar (bzw. die Seite selbst, wenn <body data-readbar> gesetzt ist) – erst ab einer
   * Länge von knapp zwei Bildschirmen.
   */
  let readBar = null;
  function readProgress(e) {
    const t = e.target;
    const el = t === document || t === document.documentElement ? document.scrollingElement : t;
    if (!el || !el.matches) return;
    const page = el === document.scrollingElement;
    if (page ? !document.body.hasAttribute('data-readbar') : !el.matches('[data-readbar]')) return;
    const max = el.scrollHeight - el.clientHeight;
    if (!readBar) {
      readBar = document.createElement('div');
      readBar.className = 'read-bar';
      readBar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(readBar);
    }
    const long = el.scrollHeight > el.clientHeight * 1.8 && (page || el.closest('.modal.open, #modal.open, [data-readbar]'));
    readBar.style.opacity = long && max > 0 ? '1' : '0';
    readBar.style.transform = `scaleX(${long && max > 0 ? Math.min(1, el.scrollTop / max).toFixed(4) : 0})`;
  }
  document.addEventListener('scroll', readProgress, { capture: true, passive: true });
  const readBarOff = () => readBar && (readBar.style.opacity = '0');

  /**
   * Abschrift mit Zwischenüberschriften („## “ groß, „### “ kleiner – siehe transcript.js) als HTML; alles andere bleibt Text.
   * Der Aufrufer setzt white-space: pre-wrap auf den Behälter.
   */
  function transcriptHtml(text) {
    const out = [];
    let buf = [];
    const flush = () => {
      const body = buf.join('\n').replace(/^\n+|\n+$/g, '');
      if (body) out.push(esc(body));
      buf = [];
    };
    for (const line of String(text || '').split('\n')) {
      const m = line.match(/^(#{2,3}) (\S.*)$/);
      if (m) {
        flush();
        out.push(`<span class="tx-h tx-h${m[1].length}" role="heading" aria-level="${m[1].length + 1}">${esc(m[2].trim())}</span>`);
      } else buf.push(line);
    }
    flush();
    return out.join('');
  }
  /** Dasselbe als Klartext ohne Markierungen (Kopieren). */
  const transcriptPlain = (text) =>
    String(text || '')
      .split('\n')
      .map((l) => l.replace(/^#{2,3} (?=\S)/, ''))
      .join('\n');

  window.PS = { transcriptHtml, transcriptPlain, readBarOff, boot, api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm: confirmDialog, closeToDashboard, drafts, applications, tab, fieldError, fieldErrors, clearFieldErrors, countUp, roll, motion };
})();
