'use strict';
/*
 * Service Worker für die installierbare App (PWA) – am PC und am Handy.
 * Bewusst schlank: Seiten, Skripte und Daten kommen immer frisch vom Server (keine veralteten Stände nach
 * Updates, nichts Vertrauliches im Zwischenspeicher). Nur wenn gar keine Verbindung besteht, zeigt die App
 * statt einer Browser-Fehlerseite eine eigene Offline-Seite.
 */
const CACHE = 'ps-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Nur Seitenaufrufe (GET) abfangen – alles andere (API, Formulare, Downloads) läuft unverändert übers Netz.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
