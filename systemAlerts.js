'use strict';
/*
 * Systemwarnungen ans Board of Partners – Discord-Ereignis „system.alert“ und Hinweis in der Übersicht:
 *  - Kanzlei-Bot (Gateway) seit 15 Minuten nicht verbunden, obwohl eingeschaltet
 *  - tägliche Datensicherung fehlgeschlagen
 *  - Speicher auf der Disk fast voll
 *  - Server ist abgestürzt und wurde neu gestartet
 * Jede Störung wird einmal gemeldet, ist sie behoben, folgt eine Entwarnung. Der Zustand liegt in den
 * Einstellungen und übersteht Neustarts (kein erneuter Alarm nach jedem Deploy).
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH, getSetting, setSetting } = require('./db');
const discord = require('./discord');

const BOT_OFFLINE_MINUTES = 15;
const DISK_LOW_BYTES = 300 * 1024 * 1024; // Warnung unter 300 MB frei …
const DISK_OK_BYTES = 400 * 1024 * 1024; // … Entwarnung ab 400 MB
const GREEN = 0x10b981;

function readState() {
  try {
    const s = JSON.parse(getSetting('system_alerts', '{}'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}
const saveState = (s) => setSetting('system_alerts', JSON.stringify(s));

const fmtTime = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

/** Fehlertexte ohne Links und lange Zeichenketten (keine Tokens o. Ä. nach Discord). */
function clean(text) {
  return String(text || '')
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '[Link]')
    .replace(/[A-Za-z0-9._-]{32,}/g, '…')
    .slice(0, 300);
}

/** Störung melden – nur beim ersten Auftreten. */
function raise(key, { title, description, fields = [] }) {
  const s = readState();
  if (s[key]) return false;
  s[key] = { since: new Date().toISOString(), title, description: description || '' };
  saveState(s);
  console.warn(`Systemwarnung: ${title}${description ? ` – ${description}` : ''}`);
  discord.notify('system.alert', { title: `⚠️ ${title}`, description, fields, color: discord.RED });
  return true;
}

/** Störung behoben → Entwarnung (nur wenn vorher gewarnt wurde). quiet: ohne Nachricht (z. B. Bot ausgeschaltet). */
function resolve(key, { title, description } = {}, quiet = false) {
  const s = readState();
  if (!s[key]) return false;
  const since = s[key].since;
  delete s[key];
  saveState(s);
  if (!quiet) {
    console.log(`Systemwarnung behoben: ${title}`);
    discord.notify('system.alert', { title: `✅ ${title}`, description, fields: [{ name: 'Gestört seit', value: fmtTime(since) }], color: GREEN });
  }
  return true;
}

/** Aktive Warnungen für die Übersicht des Boards. */
function active() {
  return Object.entries(readState()).map(([key, a]) => ({ key, title: a.title, description: a.description, since: a.since }));
}

/* ---------------------------------------------------------------- Kanzlei-Bot */
let botDownSince = null;
function checkBot() {
  let st;
  try {
    st = require('./discordBot').status();
  } catch {
    return;
  }
  if (!st.wanted) {
    botDownSince = null;
    resolve('bot', {}, true); // ausgeschaltet → keine Störung
    return;
  }
  if (st.state === 'verbunden') {
    botDownSince = null;
    resolve('bot', { title: 'Kanzlei-Bot wieder verbunden', description: 'Rang-Sync, Join Roles, Willkommensnachrichten und Automatiken laufen wieder.' });
    return;
  }
  botDownSince ||= Date.now();
  if (Date.now() - botDownSince < BOT_OFFLINE_MINUTES * 60 * 1000) return;
  const label = { verbindet: 'verbindet …', getrennt: 'getrennt – verbindet neu', fehler: 'Fehler', aus: 'aus' }[st.state] || st.state;
  raise('bot', {
    title: `Kanzlei-Bot seit ${BOT_OFFLINE_MINUTES} Minuten offline`,
    description: `Rang-Sync, Join Roles, Willkommensnachrichten und Automatiken laufen gerade nicht. Status: ${label}.${st.error ? ` ${clean(st.error)}` : ''} Im Dashboard unter Einstellungen → Discord → „Neu verbinden“. Tickets und Kanzlei-Meldungen sind nicht betroffen.`,
  });
}

/* ---------------------------------------------------------------- Datensicherung */
function backupFailed(err) {
  raise('backup', {
    title: 'Datensicherung fehlgeschlagen',
    description: `Die tägliche Sicherung der Datenbank hat nicht geklappt: ${clean(err && err.message)}. Der Server versucht es stündlich erneut. Einstellungen → System → Datensicherung → „Jetzt sichern“.`,
  });
}
function backupOk() {
  resolve('backup', { title: 'Datensicherung klappt wieder', description: 'Die tägliche Sicherung wurde angelegt.' });
}

/* ---------------------------------------------------------------- Speicher */
function freeBytes() {
  try {
    const s = fs.statfsSync(path.dirname(DB_PATH));
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}
function checkDisk() {
  const free = freeBytes();
  if (free === null) return;
  const mb = Math.round(free / 1024 / 1024);
  if (free < DISK_LOW_BYTES) {
    raise('disk', {
      title: 'Speicher fast voll',
      description: `Auf der Disk sind nur noch ${mb} MB frei. Ohne Platz scheitern Datensicherungen und Bild-Uploads. In Render die Disk vergrößern (Dienst → Disks) oder alte Sicherungen entfernen.`,
    });
  } else if (free > DISK_OK_BYTES) {
    resolve('disk', { title: 'Wieder genug Speicher frei', description: `Auf der Disk sind ${mb} MB frei.` });
  }
}

/* ---------------------------------------------------------------- Absturz erkennen */
// Beim Start wird „läuft“ vermerkt, beim geordneten Beenden (Deploy, Neustart: SIGTERM) wieder gelöscht.
// Steht der Vermerk beim nächsten Start noch da, ist der Server abgestürzt.
function markRunning() {
  let prev = null;
  try {
    prev = JSON.parse(getSetting('server_running', 'null'));
  } catch {
    prev = null;
  }
  if (prev && prev.startedAt) {
    discord.notify('system.alert', {
      title: '⚠️ Server ist abgestürzt und wurde neu gestartet',
      description: `Die Website war kurz nicht erreichbar und läuft wieder.${prev.crash ? ` Fehler: ${clean(prev.crash)}` : ''}`,
      fields: [{ name: 'Lief seit', value: fmtTime(prev.startedAt) }],
      color: discord.RED,
    });
    console.warn('Systemwarnung: Der Server wurde nach einem Absturz neu gestartet.');
  }
  setSetting('server_running', JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }));

  const stopCleanly = (signal) => {
    try {
      setSetting('server_running', '');
    } catch {
      /* Datenbank schon zu */
    }
    process.exit(signal === 'SIGINT' ? 130 : 0);
  };
  process.once('SIGTERM', () => stopCleanly('SIGTERM'));
  process.once('SIGINT', () => stopCleanly('SIGINT'));
  // Absturzgrund für die Meldung beim nächsten Start festhalten – danach wie üblich beenden
  process.on('uncaughtException', (err) => {
    try {
      const s = JSON.parse(getSetting('server_running', 'null')) || {};
      setSetting('server_running', JSON.stringify({ ...s, crash: String((err && err.message) || err) }));
    } catch {
      /* egal – Hauptsache beenden */
    }
    console.error(err);
    process.exit(1);
  });
}

function start() {
  markRunning();
  const tick = () => {
    try {
      checkBot();
      checkDisk();
    } catch (err) {
      console.warn('Systemprüfung fehlgeschlagen:', err.message);
    }
  };
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 60 * 1000).unref();
}

module.exports = { start, raise, resolve, active, backupFailed, backupOk, checkBot, checkDisk, clean, BOT_OFFLINE_MINUTES };
