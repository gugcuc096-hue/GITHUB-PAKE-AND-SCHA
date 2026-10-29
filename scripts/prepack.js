'use strict';
/*
 * Skripte und Stylesheets vorab verkleinern und komprimieren (läuft bei „npm install“ bzw. von Hand mit „npm run pack:assets“).
 * Die Ergebnisse liegen in .packed/ – der Server liest sie beim Start nur noch, statt sie neu zu rechnen. Schlägt das
 * hier fehl, ist das kein Fehler: der Server packt dann beim Start im Hintergrund selbst. Das Skript bricht nie ab.
 */
process.env.NODE_ENV = 'production';
const started = Date.now();
(async () => {
  try {
    const n = await require('../assets').packAll();
    console.log(`Vorab gepackt: ${n} Dateien in ${Date.now() - started} ms (.packed/)`);
  } catch (err) {
    console.warn('Vorab packen übersprungen:', err.message);
  }
  process.exit(0);
})();
