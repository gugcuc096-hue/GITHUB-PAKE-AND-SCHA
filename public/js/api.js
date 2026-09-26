/* Gemeinsame Helfer für alle Seiten: window.PS = { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm } */
(() => {
  'use strict';

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
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
      throw Object.assign(new Error((data && data.error) || `Fehler ${res.status}`), { status: res.status });
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
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
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
      root.addEventListener('click', (e) => {
        if (e.target === root) close(false);
      });
    });
  }

  window.PS = { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage, confirm: confirmDialog };
})();
