'use strict';
/* Feature-Schalter: Funktionen der Kanzlei, die sich ohne Code ein- und ausschalten lassen (Einstellungen → Rechte & Schalter). */
const { getSetting, setSetting } = require('./db');

const FEATURES = [
  { key: 'reviews', label: 'Bewertungen', hint: 'Mandantenstimmen auf der Website und die Bewertungsbitte nach Abschluss' },
  { key: 'vip', label: 'VIP & Lifetime', hint: 'Mitgliedschaften auf der Website und im Dashboard' },
  { key: 'karriere', label: 'Karriere-Seite', hint: 'Seite „Karriere“ und Bewerbungen' },
  { key: 'clientLink', label: 'Mandanten-Link', hint: 'Einladungs-Link, mit dem ein Mandant einer Akte beitritt' },
  { key: 'slots', label: 'Terminvorschläge', hint: 'Mandanten wählen aus vorgeschlagenen Terminen' },
  // Standardmäßig aus: Der Bot antwortet erst, wenn das Board es einschaltet
  { key: 'clientAssistant', label: 'Assistent im Discord-Ticket', hint: 'Der Bot beantwortet einfache Fragen im Ticket (Stand, Termine, fehlende Unterlagen, Rechnung, Anwalt) aus freigegebenen Angaben der Akte – bei Unklarem holt er den Anwalt', off: true },
];
const KEYS = FEATURES.map((f) => f.key);

const DEFAULT_OFF = new Set(FEATURES.filter((f) => f.off).map((f) => f.key));
const on = (key) => (DEFAULT_OFF.has(key) ? getSetting(`feature_${key}`, '0') === '1' : getSetting(`feature_${key}`, '1') !== '0');
const all = () => Object.fromEntries(KEYS.map((k) => [k, on(k)]));
function save(values) {
  for (const k of KEYS) if (typeof values[k] === 'boolean') setSetting(`feature_${k}`, values[k] ? '1' : '0');
  return all();
}
/** Middleware: Route nur, wenn die Funktion eingeschaltet ist (sonst 404 wie „gibt es nicht“). */
const requireFeature = (key) => (req, res, next) => (on(key) ? next() : res.status(404).json({ error: 'Diese Funktion ist ausgeschaltet.' }));

module.exports = { FEATURES, KEYS, on, all, save, requireFeature };
