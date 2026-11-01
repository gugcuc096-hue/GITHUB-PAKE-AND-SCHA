'use strict';
/*
 * Sicherung außer Haus: Kopien der Datensicherung im Google Drive der Kanzlei, Ordner „Pake & Scha – Sicherungen“.
 * Der Ordner und die Dateien darin werden nie freigegeben (auch nicht per Link) – sie sieht nur, wer im
 * Google-Konto der Kanzlei angemeldet ist.
 *  - Datenbank: jede neue Sicherung aus backups/ (also jede Nacht und nach „Jetzt sichern“)
 *  - Bilder (Profilbilder, Team-Fotos, Beweismittel): einmal pro Woche als .tar.gz
 * Aufbewahrung im Drive wie auf der Disk (7 Tage alle, bis 5 Wochen eine je Woche), von den Bildern die letzten 4.
 * Klappt das Hochladen dreimal hintereinander nicht, bekommt das Board eine Systemwarnung (Discord + Übersicht).
 * Wiederherstellen: Datei im Drive herunterladen und unter Einstellungen → Rechte & System → Sicherung & Notfall → „Sicherung hochladen …“ einspielen.
 */
const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./db');
const drive = require('./googleDrive');
const backup = require('./backup');
const media = require('./mediaBackup');

const MEDIA_EVERY_DAYS = 7;
const KEEP_MEDIA = 4;
const ALERT_AFTER = 3; // Fehlversuche hintereinander (stündlich) bis zur Warnung
const DB_MIME = 'application/x-sqlite3';
const MEDIA_MIME = 'application/gzip';
const MEDIA_RE = /^pake-scha-bilder-\d{4}-\d{2}-\d{2}\.tar\.gz$/;

function readState() {
  try {
    const s = JSON.parse(getSetting('drive_backup', '{}'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}
const saveState = (s) => setSetting('drive_backup', JSON.stringify(s));

let running = false;
let chain = Promise.resolve();

/** Bilder als .tar.gz in eine Datei neben den Sicherungen schreiben (wird nach dem Hochladen gelöscht). */
async function mediaArchive(name, bytes) {
  fs.mkdirSync(backup.DIR, { recursive: true });
  const free = backup.freeBytes();
  if (free !== null && free < bytes + 50 * 1024 * 1024) throw new Error('Zu wenig freier Speicher auf der Disk für das Bilder-Archiv.');
  const tmp = path.join(backup.DIR, `.${name}.tmp`);
  await media.writeArchive(fs.createWriteStream(tmp));
  return tmp;
}

/** Alte Kopien im Drive löschen – Datenbank wie auf der Disk, Bilder: die letzten 4. */
async function prune() {
  const files = await drive.listFiles('backup');
  const dbs = files
    .filter((f) => backup.NAME_RE.test(f.name))
    .map((f) => ({ ...f, stamp: backup.stampOf(f.name) }))
    .sort((a, b) => b.stamp - a.stamp || String(b.createdTime).localeCompare(String(a.createdTime)));
  const seen = new Set(); // derselbe Name zweimal (z. B. nach erneutem Verbinden) → nur die neueste Kopie behalten
  const old = dbs.filter((f) => (seen.has(f.name) ? true : (seen.add(f.name), false)));
  const kept = dbs.filter((f) => !old.includes(f));
  old.push(...backup.expired(kept));
  const archives = files.filter((f) => MEDIA_RE.test(f.name)).sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  old.push(...archives.slice(KEEP_MEDIA));
  for (const f of old) await drive.deleteFile(f.id);
  return old.length;
}

async function runNow({ fresh = false } = {}) {
  const alerts = require('./systemAlerts');
  if (!drive.connected()) {
    alerts.resolve('drive-backup', {}, true); // Google getrennt → dafür gibt es eine eigene Warnung
    return null;
  }
  const s = readState();
  if (fresh) {
    // gerade (neu) verbunden: sofort eine aktuelle Kopie in den (womöglich neuen) Ordner
    delete s.dbName;
    delete s.mediaAt;
  }
  running = true;
  let uploaded = 0;
  try {
    const newest = backup.list()[0];
    if (newest && newest.name !== s.dbName) {
      const up = await drive.uploadFile('backup', newest.name, path.join(backup.DIR, newest.name), DB_MIME);
      Object.assign(s, { dbName: newest.name, dbAt: new Date().toISOString(), dbSize: up.size });
      saveState(s);
      uploaded += 1;
    }
    if (!s.mediaAt || Date.now() - Date.parse(s.mediaAt) >= MEDIA_EVERY_DAYS * 864e5) {
      const stats = media.stats();
      if (stats.files) {
        const name = `pake-scha-bilder-${new Date().toISOString().slice(0, 10)}.tar.gz`;
        const tmp = await mediaArchive(name, stats.bytes);
        try {
          const up = await drive.uploadFile('backup', name, tmp, MEDIA_MIME);
          Object.assign(s, { mediaName: name, mediaUploadedAt: new Date().toISOString(), mediaSize: up.size, mediaFiles: stats.files });
          uploaded += 1;
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      }
      s.mediaAt = new Date().toISOString(); // ohne Bilder auch „erledigt“ – nächste Prüfung in einer Woche
      saveState(s);
    }
    if (uploaded) await prune();
    if (s.error || s.failures) {
      Object.assign(s, { error: null, errorAt: null, failures: 0 });
      saveState(s);
    }
    alerts.resolve('drive-backup', { title: 'Sicherung im Google Drive klappt wieder', description: 'Die Kopie der Datensicherung liegt wieder im Google Drive der Kanzlei.' });
    if (uploaded) console.log(`Sicherung ins Google Drive kopiert (${uploaded} ${uploaded === 1 ? 'Datei' : 'Dateien'}).`);
    return status();
  } catch (err) {
    Object.assign(s, { error: alerts.clean(err.message), errorAt: new Date().toISOString(), failures: (Number(s.failures) || 0) + 1 });
    saveState(s);
    // abgelaufene/getrennte Google-Verbindung meldet googleDrive.js schon selbst
    if (s.failures >= ALERT_AFTER && !['not_connected', 'expired'].includes(err.code)) {
      alerts.raise('drive-backup', {
        title: 'Sicherung im Google Drive fehlgeschlagen',
        description: `Die Kopie der Datensicherung konnte ${s.failures}× hintereinander nicht ins Google Drive der Kanzlei hochgeladen werden: ${s.error}. Die Sicherung auf der Disk ist davon nicht betroffen; der Server versucht es stündlich erneut.`,
      });
    }
    throw err;
  } finally {
    running = false;
  }
}

/** Neue Sicherung hochladen (falls noch nicht im Drive), Bilder wöchentlich, alte Kopien löschen. Nie parallel. */
function run(opts) {
  const p = chain.then(() => runNow(opts));
  chain = p.catch(() => {});
  return p;
}

/** Nach dem (erneuten) Verbinden des Google-Kontos gleich eine Kopie anlegen (vorher ggf. die heutige Sicherung). */
function afterConnect() {
  setImmediate(() => {
    try {
      backup.ensureToday();
    } catch (err) {
      console.warn('Datensicherung fehlgeschlagen:', err.message);
    }
    run({ fresh: true }).catch((err) => console.warn('Sicherung im Google Drive fehlgeschlagen:', err.message));
  });
}

/** Stand für Einstellungen → Sicherung & Notfall. */
function status() {
  const s = readState();
  return {
    connected: drive.connected(),
    folderUrl: drive.connected() ? drive.folderUrl('backup') : null,
    db: s.dbAt ? { name: s.dbName, at: s.dbAt, size: s.dbSize || null } : null,
    media: s.mediaName ? { name: s.mediaName, at: s.mediaUploadedAt, size: s.mediaSize || null, files: s.mediaFiles || 0 } : null,
    mediaCheckedAt: s.mediaAt || null,
    error: s.error || null,
    errorAt: s.errorAt || null,
    running,
    mediaEveryDays: MEDIA_EVERY_DAYS,
    keepMedia: KEEP_MEDIA,
  };
}

module.exports = { run, afterConnect, status, prune, MEDIA_EVERY_DAYS, KEEP_MEDIA };
