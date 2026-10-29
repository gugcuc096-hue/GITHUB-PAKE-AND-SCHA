'use strict';
/*
 * Service Worker für die installierbare App (PWA) – am PC und am Handy.
 * Bewusst schlank: Seiten und Daten kommen immer frisch vom Server (nichts Vertrauliches im Zwischenspeicher). Nur
 * der Programmcode (Skripte, Stylesheets, Schriften mit Versionsnummer) liegt lokal – nach einem Update hat er eine
 * neue Nummer und wird neu geladen. Ohne Verbindung zeigt die App statt einer Browser-Fehlerseite eine eigene
 * Offline-Seite. Einzige Ausnahme: der freiwillige Offline-Modus (Profil), siehe unten und /js/offline.js.
 */
const CACHE = 'ps-offline-v5';
const OFFLINE_URL = '/offline';
const WAKE_URL = '/aufwachen'; // ruhige Warteseite, wenn der Server nach einer Ruhepause (z. B. Render) erst aufwacht
const WAKE_AFTER = 5000; // Antwortet der Server nach so vielen Millisekunden noch nicht, kommt die Warteseite

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll([OFFLINE_URL, '/icon-192.png', '/fonts/cormorant-garamond-latin-wght-normal.woff2']);
      // Warteseite samt ihrem Skript (mit Versionsnummer) – beides muss da sein, wenn der Server schläft
      const wake = await fetch(WAKE_URL);
      const script = (await wake.clone().text()).match(/<script src="([^"]+)"/);
      await cache.put(WAKE_URL, wake);
      if (script) await (await caches.open(STATIC)).add(script[1]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App-Hülle: Skripte, Stylesheets und Schriften mit Versionsnummer (?v=…) ändern sich nie – sie kommen nach dem ersten
// Laden sofort aus dem Zwischenspeicher, auch bei schlechter Verbindung. Nur Programmcode, nie Daten oder Seiten.
const STATIC = 'ps-static-v1';
/*
 * Offline-Modus (freiwillig, Profil → Offline-Modus; siehe /js/offline.js): Nur wenn er an ist, hält der Service Worker die
 * Dashboard-Seite bereit, damit sie auch ohne Verbindung öffnet. Ein Marker im Cache merkt sich „an“; „aus“ löscht beides.
 */
const SHELL = 'ps-offline-shell-v1';
const SHELL_KEY = '/dashboard';
const MODE_KEY = '/__offline-mode';
const offlineMode = async () => !!(await (await caches.open(SHELL)).match(MODE_KEY));
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type !== 'offline-mode') return;
  event.waitUntil(
    (async () => {
      if (!d.on) return caches.delete(SHELL);
      const cache = await caches.open(SHELL);
      await cache.put(MODE_KEY, new Response('1'));
      try {
        const res = await fetch(SHELL_KEY, { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) await cache.put(SHELL_KEY, res);
      } catch {
        /* ohne Verbindung: beim nächsten Aufruf der Seite */
      }
    })()
  );
});
const isShell = (url) => url.origin === self.location.origin && ((/^\/(js|css)\//.test(url.pathname) && url.searchParams.has('v')) || url.pathname.startsWith('/fonts/'));

async function fromShell(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    // ältere Fassungen derselben Datei entfernen – der Speicher wächst nicht mit jedem Update
    const path = new URL(req.url).pathname;
    for (const old of await cache.keys()) if (new URL(old.url).pathname === path) await cache.delete(old);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isShell(url)) {
    event.respondWith(fromShell(req).catch(() => caches.match(req)));
    return;
  }
  // Seitenaufrufe: immer frisch übers Netz – ohne Verbindung die eigene Offline-Seite. Alles andere (API, Formulare,
  // Downloads, Bilder) läuft unverändert übers Netz.
  if (req.mode !== 'navigate') return;
  event.respondWith(navigate(req));
});

/** Seite holen; dauert die erste Antwort länger als WAKE_AFTER, erscheint die Warteseite (sie lädt die Adresse neu, sobald der Server antwortet). */
async function navigate(req) {
  const net = fetch(req);
  net.catch(() => {}); // verworfene Antwort: kein unbehandelter Fehler
  let timer;
  const slow = new Promise((resolve) => (timer = setTimeout(() => resolve(null), WAKE_AFTER)));
  try {
    const first = await Promise.race([net, slow]);
    if (first) {
      // Offline-Modus: die aktuelle Dashboard-Seite für den nächsten Aufruf ohne Verbindung merken
      if (first.ok && new URL(req.url).pathname === SHELL_KEY && (await offlineMode())) (await caches.open(SHELL)).put(SHELL_KEY, first.clone());
      return first;
    }
    return (await caches.match(WAKE_URL)) || net;
  } catch {
    if (new URL(req.url).pathname === SHELL_KEY && (await offlineMode())) {
      const shell = await (await caches.open(SHELL)).match(SHELL_KEY);
      if (shell) return shell;
    }
    return caches.match(OFFLINE_URL);
  } finally {
    clearTimeout(timer);
  }
}
