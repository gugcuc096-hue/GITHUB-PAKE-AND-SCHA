/*
 * Warteseite (public/aufwachen.html): wartet, bis der Server nach einer Ruhepause antwortet, und lädt dann die
 * ursprünglich gewünschte Seite neu (die Adresse blieb dieselbe). Eigene Datei, weil die Seitenrichtlinie keine
 * Inline-Skripte erlaubt.
 */
(() => {
  'use strict';
  let tries = 0;
  const again = () => setTimeout(check, Math.min(8000, 2000 + tries * 500));
  function check() {
    tries++;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? location.reload() : again()))
      .catch(again);
  }
  again();
})();
