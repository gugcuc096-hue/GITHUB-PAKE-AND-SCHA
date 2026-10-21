'use strict';
/*
 * Service Worker für die installierbare App (PWA) – am PC und am Handy.
 * Bewusst schlank: Seiten und Daten kommen immer frisch vom Server (nichts Vertrauliches im Zwischenspeicher). Nur
 * der Programmcode (Skripte, Stylesheets, Schriften mit Versionsnummer) liegt lokal – nach einem Update hat er eine
 * neue Nummer und wird neu geladen. Ohne Verbindung zeigt die App statt einer Browser-Fehlerseite eine eigene
 * Offline-Seite.
 */
const CACHE = 'ps-offline-v3';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icon-192.png', '/fonts/cormorant-garamond-latin-wght-normal.woff2'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App-Hülle: Skripte, Stylesheets und Schriften mit Versionsnummer (?v=…) ändern sich nie – sie kommen nach dem ersten
// Laden sofort aus dem Zwischenspeicher, auch bei schlechter Verbindung. Nur Programmcode, nie Daten oder Seiten.
const STATIC = 'ps-static-v1';
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
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
