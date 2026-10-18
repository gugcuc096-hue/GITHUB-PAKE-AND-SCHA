/* Gemeinsame Helfer für alle Seiten: window.PS = { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm, drafts, applications } */
(() => {
  'use strict';

  // Kennung dieses Tabs: Der Server meldet eigene Änderungen nicht noch einmal live an denselben Tab zurück
  const tab = Math.random().toString(36).slice(2, 12);

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
    try {
      res = await fetch(url, opts);
    } catch {
      throw Object.assign(new Error('Der Server ist nicht erreichbar. Bitte Verbindung prüfen und erneut versuchen.'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { /* leere Antwort */ }
    if (!res.ok) {
      // fields: Hinweise je Feld (Name → Text), damit das Formular sie direkt am Feld zeigen kann
      throw Object.assign(new Error((data && data.error) || `Fehler ${res.status}`), { status: res.status, fields: (data && data.fields) || null });
    }
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
  function resizeImage(file, { max = 1600, square = false, quality = 0.86 } = {}) {
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
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Das Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', quality);
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

  function toast(message, type = 'ok') {
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
    root.appendChild(el);
    // Kurz ausblenden statt hart verschwinden
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 230);
    }, type === 'error' ? 6000 : 3500);
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
        fromDashboard = ref.origin === location.origin && ref.pathname === '/dashboard.html';
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
@keyframes psFeIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ps-field-error{animation:none}}`;
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
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
  // Ändern = Hinweis weg (auch für die ganze Gruppe gleichnamiger Auswahlknöpfe)
  const feOnEdit = (e) => {
    const el = e.target;
    if (!el || !el.classList || (el.classList.contains('ps-invalid') && feVals.get(el) === feValue(el))) return;
    if (!el.form) return feClear(el);
    if (el.type === 'radio' && el.name) [...el.form.querySelectorAll(`input[type="radio"]`)].filter((r) => r.name === el.name).forEach(feClear);
    else feClear(el);
  };
  document.addEventListener('input', feOnEdit);
  document.addEventListener('change', feOnEdit);
  document.addEventListener('reset', (e) => clearFieldErrors(e.target));

  window.PS = { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm: confirmDialog, closeToDashboard, drafts, applications, tab, fieldError, fieldErrors, clearFieldErrors };
})();
