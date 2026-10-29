/*
 * Kanzlei-Dashboard – Offline-Modus: Ein- und Ausschalten und Zwischenspeicher leeren (Profil → Offline-Modus). Die eigentliche
 * Arbeit (Zwischenspeicher, Warteschlange, Hinweisleiste) macht /js/offline.js; die Anzeige im Profil steht in 09-profil-board.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

Object.assign(actions, {
  'offline-toggle': async (el) => {
    await window.PS.offline.set(el.dataset.on === '1');
    toast(el.dataset.on === '1' ? 'Offline-Modus ist an – die nächsten Ansichten bleiben auf diesem Gerät lesbar.' : 'Offline-Modus ist aus, der Zwischenspeicher gelöscht.');
    st.offlineStats = await window.PS.offline.stats();
    renderView();
  },
  'offline-clear': async () => {
    await window.PS.offline.clear();
    st.offlineStats = await window.PS.offline.stats();
    toast('Zwischenspeicher geleert.');
    renderView();
  },
});
