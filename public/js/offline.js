/*
 * Offline-Modus (freiwillig, je Gerät – Profil → „Offline-Modus“). Aus: nichts wird gespeichert. An:
 *  - Zuletzt gesehene Ansichten (Akten, Aufgaben, Termine, Rechnungen, Übersicht …) liegen unverschlüsselt im Browser dieses
 *    Geräts (IndexedDB) und erscheinen ohne Verbindung mit dem Stand von damals; unten steht „Offline – Stand von …“.
 *  - Zwei Dinge lassen sich offline erledigen und werden gesendet, sobald die Verbindung wieder da ist: eine interne Notiz in
 *    einer Akte und das Abhaken einer Aufgabe. Alles andere braucht Verbindung und sagt das klar.
 *  - Beim Abmelden, beim Ausschalten und beim Wechsel des Kontos wird alles gelöscht. Einträge sind höchstens 14 Tage alt.
 * Der Service Worker (sw.js) hält zusätzlich die Dashboard-Seite bereit, damit sie auch ohne Netz öffnet.
 * Wird nach api.js geladen und legt sich um window.PS.api (dieselben Aufrufe, nur mit Rückfall auf den Zwischenspeicher).
 */
(() => {
  'use strict';
  const PS = window.PS;
  if (!PS || !PS.api || !window.indexedDB) return;
  const api = PS.api;
  const KEY = 'ps.offline';
  const MAX_AGE = 14 * 24 * 3600e3;
  const MAX_ENTRIES = 160;
  const MAX_BYTES = 600 * 1024; // je Antwort

  const enabled = () => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };
  /** Nur diese Lese-Anfragen werden zwischengespeichert (Übersichten und Akten – keine Verwaltung, keine Suche, keine Dateien). */
  const CACHEABLE = [
    /^\/api\/auth\/session$/,
    /^\/api\/start(\?[^/]*)?$/,
    /^\/api\/cases(\?[^/]*)?$/,
    /^\/api\/cases\/\d+(\?[^/]*)?$/,
    /^\/api\/tasks(\?[^/]*)?$/,
    /^\/api\/messages(\?[^/]*)?$/,
    /^\/api\/(calendar|invoices|board|directory|duty|absences|clients|onboarding|areas|features)(\?[^/]*)?$/,
    /^\/api\/discord\/status$/,
  ];
  const cacheable = (url) => CACHEABLE.some((re) => re.test(url));

  /* ---------------------------------------------------------------- IndexedDB */
  let dbp = null;
  const open = () =>
    (dbp ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('ps-offline', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('cache', { keyPath: 'k' });
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  const all = (store) => tx(store, 'readonly', (s) => s.getAll());
  const wipe = async () => {
    await tx('cache', 'readwrite', (s) => s.clear());
    await tx('queue', 'readwrite', (s) => s.clear());
  };

  const state = { offline: false, at: null, queued: 0, owner: null };
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn({ ...state }));

  async function put(url, data) {
    try {
      const json = JSON.stringify(data);
      if (json.length > MAX_BYTES) return;
      await tx('cache', 'readwrite', (s) => s.put({ k: url, at: Date.now(), data: json }));
      prune();
    } catch {
      /* Zwischenspeicher voll oder gesperrt – dann eben ohne */
    }
  }
  let pruning = false;
  async function prune() {
    if (pruning) return;
    pruning = true;
    try {
      const rows = (await all('cache')).sort((a, b) => b.at - a.at);
      const old = rows.filter((r, i) => i >= MAX_ENTRIES || Date.now() - r.at > MAX_AGE);
      if (old.length) await tx('cache', 'readwrite', (s) => old.forEach((r) => s.delete(r.k)));
    } finally {
      pruning = false;
    }
  }
  const read = async (url) => {
    const row = await tx('cache', 'readonly', (s) => s.get(url));
    return row && Date.now() - row.at < MAX_AGE ? { at: row.at, data: JSON.parse(row.data) } : null;
  };

  /* ---------------------------------------------------------------- Warteschlange */
  /** Was offline erledigt werden darf (und später gesendet wird). */
  const QUEUEABLE = [
    { method: 'POST', re: /^\/api\/cases\/\d+\/notes$/, ok: (b) => b && typeof b.body === 'string' },
    { method: 'PATCH', re: /^\/api\/tasks\/\d+$/, ok: (b) => b && typeof b.done === 'boolean' && Object.keys(b).every((k) => k === 'done' || k === 'expect') },
  ];
  const queueable = (method, url, body) => QUEUEABLE.some((q) => q.method === method && q.re.test(url) && q.ok(body));
  const count = async () => (await all('queue')).length;

  async function enqueue(method, url, body) {
    const { expect, ...clean } = body || {};
    await tx('queue', 'readwrite', (s) => s.add({ method, url, body: clean, at: Date.now() }));
    state.queued = await count();
    changed();
  }

  let flushing = false;
  /** Gespeichertes senden – der Reihe nach; bei fehlender Verbindung später weiter, bei Ablehnung melden und verwerfen. */
  async function flush() {
    if (flushing || !enabled() || navigator.onLine === false) return { sent: 0, failed: 0 };
    flushing = true;
    let sent = 0;
    const failed = [];
    try {
      for (const q of await all('queue')) {
        try {
          await orig[q.method === 'POST' ? 'post' : 'patch'](q.url, q.body);
          sent++;
        } catch (err) {
          if (err.status === 0) break; // weiter offline: später noch einmal
          failed.push(err.message);
        }
        await tx('queue', 'readwrite', (s) => s.delete(q.id));
      }
    } finally {
      flushing = false;
      state.queued = await count();
      changed();
    }
    if (sent) PS.toast(sent === 1 ? 'Eine Änderung vom Offline-Modus gesendet.' : `${sent} Änderungen vom Offline-Modus gesendet.`);
    if (failed.length) PS.toast(`${failed.length === 1 ? 'Eine Änderung' : `${failed.length} Änderungen`} konnte nicht gesendet werden: ${failed[0]}`, 'error');
    if (sent || failed.length) document.dispatchEvent(new CustomEvent('ps:offline-synced', { detail: { sent, failed: failed.length } }));
    return { sent, failed: failed.length };
  }

  /** Abgehakte Aufgaben aus der Warteschlange über den Zwischenspeicher legen (die Anzeige bleibt so, wie man sie verlassen hat). */
  async function overlay(data) {
    const q = (await all('queue')).filter((x) => x.method === 'PATCH');
    if (!q.length) return data;
    const done = new Map(q.map((x) => [Number(x.url.split('/').pop()), x.body.done]));
    const fix = (list) => Array.isArray(list) && list.forEach((t) => t && done.has(t.id) && 'done' in t && (t.done = done.get(t.id)));
    fix(data);
    if (data && typeof data === 'object') {
      fix(data.tasks);
      fix(data.myTasks);
    }
    return data;
  }

  /* ---------------------------------------------------------------- um api herum */
  const orig = { get: api.get, post: api.post, patch: api.patch };

  api.get = async (url) => {
    if (!enabled() || !cacheable(url)) return orig.get(url);
    if (navigator.onLine !== false) {
      try {
        const data = await orig.get(url);
        put(url, data);
        if (url === '/api/auth/session' && data && data.user) await setOwner(data.user.id);
        if (state.offline) {
          state.offline = false;
          changed();
          flush();
        }
        return data;
      } catch (err) {
        if (err.status !== 0) throw err; // Server antwortet mit Fehler: das ist kein Offline
        const hit = await read(url);
        if (!hit) throw err;
        return serve(hit);
      }
    }
    const hit = await read(url);
    if (!hit) throw Object.assign(new Error('Du bist offline – diese Ansicht war noch nicht geladen.'), { status: 0 });
    return serve(hit);
  };
  async function serve(hit) {
    state.offline = true;
    state.at = hit.at;
    changed();
    return overlay(hit.data);
  }
  for (const method of ['post', 'patch']) {
    api[method] = async (url, body) => {
      if (!enabled() || !queueable(method.toUpperCase(), url, body)) return orig[method](url, body);
      const later = async () => {
        await enqueue(method.toUpperCase(), url, body);
        PS.toast('Offline gespeichert – wird gesendet, sobald du wieder verbunden bist.');
        return { queued: true, mentioned: [] };
      };
      if (navigator.onLine === false) return later(); // ohne Verbindung gar nicht erst versuchen
      try {
        return await orig[method](url, body);
      } catch (err) {
        if (err.status !== 0) throw err;
        return later();
      }
    };
  }
  // Wer sich zuletzt hier angemeldet hat, darf den Zwischenspeicher lesen – bei einem anderen Konto wird alles gelöscht
  async function setOwner(id) {
    const row = await tx('meta', 'readonly', (s) => s.get('owner'));
    if (row && row.v !== id) await wipe();
    await tx('meta', 'readwrite', (s) => s.put({ k: 'owner', v: id }));
    state.owner = id;
  }

  /* ---------------------------------------------------------------- Hinweisleiste */
  const bar = () => {
    let el = document.getElementById('offlineBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'offlineBar';
      el.className = 'offline-bar';
      el.setAttribute('role', 'status');
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  };
  listeners.add((s) => {
    if (!document.body) return;
    const el = bar();
    const offline = s.offline || navigator.onLine === false;
    el.hidden = !(enabled() && (offline || s.queued));
    if (el.hidden) return;
    const time = s.at ? new Date(s.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    el.textContent = `${offline ? `Offline${time ? ` – Stand von ${time}` : ''}` : 'Wieder online'}${s.queued ? ` · ${s.queued} ${s.queued === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf die Verbindung` : ''}`;
  });
  window.addEventListener('offline', () => changed());
  window.addEventListener('online', () => {
    changed();
    flush();
  });

  /* ---------------------------------------------------------------- Service Worker informieren */
  const tellWorker = async (on) => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active && reg.active.postMessage({ type: 'offline-mode', on });
    } catch {
      /* ohne Service Worker gibt es nur den Zwischenspeicher der Daten */
    }
  };

  /* ---------------------------------------------------------------- Öffentliche Schnittstelle */
  PS.offline = {
    enabled,
    supported: true,
    async set(on) {
      try {
        if (on) localStorage.setItem(KEY, '1');
        else localStorage.removeItem(KEY);
      } catch {
        throw new Error('Dieses Gerät erlaubt kein Speichern im Browser.');
      }
      if (!on) await this.clear();
      state.offline = false;
      changed();
      await tellWorker(on);
    },
    /** Alles löschen (Abmelden, Ausschalten, anderes Konto). */
    async clear() {
      await wipe().catch(() => {});
      state.queued = 0;
      state.offline = false;
      changed();
    },
    async stats() {
      const rows = enabled() ? await all('cache').catch(() => []) : [];
      return { entries: rows.length, oldest: rows.length ? Math.min(...rows.map((r) => r.at)) : null, queued: enabled() ? await count().catch(() => 0) : 0 };
    },
    flush,
    on: (fn) => listeners.add(fn),
    state: () => ({ ...state }),
  };

  if (enabled()) {
    count().then((n) => {
      state.queued = n;
      changed();
      if (navigator.onLine !== false) flush();
    });
    tellWorker(true);
  }
})();
