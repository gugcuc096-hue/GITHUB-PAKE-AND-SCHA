/* Gemeinsame Helfer für alle Seiten: window.PS = { api, esc, fmtDate, parseDate, money, copy, toast } */
(() => {
  'use strict';

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
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
    del: (url) => request('DELETE', url),
  };

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

  window.PS = { api, esc, fmtDate, parseDate, money, copy, toast };
})();
