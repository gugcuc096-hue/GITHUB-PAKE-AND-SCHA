'use strict';
/*
 * Live-Anzeige im Discord: Ein (für alle gesperrter) Sprachkanal heißt automatisch z. B. „🟢 Im Dienst: 3“ – gezählt
 * wird, wer im Dashboard bzw. mit /dienst im Dienst ist. Discord erlaubt nur zwei Umbenennungen je 10 Minuten und
 * Kanal; deshalb höchstens alle 5 Minuten – die letzte Änderung kommt danach sicher an.
 * Einstellung (Einstellungen → Discord → Übersicht): bot_duty_channel = { channelId, template } mit {anzahl}.
 */
const { getSetting, setSetting } = require('./db');
const tickets = require('./tickets');

const MIN_GAP_MS = 5 * 60 * 1000;
const DEFAULT_TEMPLATE = '🟢 Im Dienst: {anzahl}';
let timer = null;
let lastAt = 0;
let lastName = null;

function config() {
  try {
    return { channelId: '', template: DEFAULT_TEMPLATE, ...JSON.parse(getSetting('bot_duty_channel', '') || '{}') };
  } catch {
    return { channelId: '', template: DEFAULT_TEMPLATE };
  }
}
const nameFor = (template, n) => String(template || DEFAULT_TEMPLATE).replace(/\{anzahl\}/g, String(n)).slice(0, 100);

/** Nach jeder Änderung des Dienststatus (und regelmäßig): Kanalnamen anpassen, wenn er sich ändert. */
function update() {
  const c = config();
  if (!c.channelId || !tickets.hasToken()) return;
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) {
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        update();
      }, wait);
      timer.unref?.();
    }
    return;
  }
  const name = nameFor(c.template, require('./models').onDutyMembers().length);
  if (name === lastName) return;
  lastAt = Date.now();
  tickets.rest('PATCH', `/channels/${c.channelId}`, { name }).then(
    () => (lastName = name),
    (err) => console.warn('Live-Anzeige im Kanalnamen:', err.message)
  );
}

function save(c) {
  setSetting('bot_duty_channel', JSON.stringify({ channelId: c.channelId || '', template: c.template || DEFAULT_TEMPLATE }));
  lastName = null;
  lastAt = 0; // neue Einstellung: sofort anwenden
  update();
}

module.exports = { config, save, update, nameFor, DEFAULT_TEMPLATE };
