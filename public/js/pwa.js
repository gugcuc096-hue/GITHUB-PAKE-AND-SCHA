/*
 * Installierbare App (PWA): meldet den Service Worker an und merkt sich, ob der Browser die Installation
 * anbietet (Chrome/Edge am PC, Chrome unter Android). Elemente mit der Klasse „pwa-only“ erscheinen nur dann;
 * window.PSApp.install() öffnet den Installationsdialog des Browsers.
 */
(() => {
  'use strict';
  const root = document.documentElement;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone()) root.classList.add('pwa-standalone');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* ohne Service Worker läuft die Seite ganz normal weiter */
      });
    });
  }

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // eigener Knopf statt Browser-Hinweis am Handy; das Symbol in der Adressleiste bleibt
    deferred = event;
    root.classList.add('pwa-can-install');
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    root.classList.remove('pwa-can-install');
    root.classList.add('pwa-installed');
  });

  window.PSApp = {
    canInstall: () => !!deferred,
    isStandalone: standalone,
    async install() {
      if (!deferred) return false;
      const prompt = deferred;
      deferred = null;
      root.classList.remove('pwa-can-install');
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      return !!choice && choice.outcome === 'accepted';
    },
  };
})();
