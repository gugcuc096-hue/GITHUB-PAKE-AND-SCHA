'use strict';
/*
 * Sicherung der hochgeladenen Bilder (Profilbilder, Team-Fotos, Beweismittel) und Einspielen von Sicherungen:
 *  - Download aller Bilder als ein .tar.gz (Ordner uploads/ neben der Datenbank, Pfade wie auf der Disk)
 *  - Hochladen einer heruntergeladenen Sicherung – Datenbank (.db) wird als restore.db für den nächsten
 *    Start vorgemerkt (siehe db.js), Bilder (.tar.gz) werden sofort ergänzt
 * Beim Einspielen werden nur Bilder (geprüft anhand der Dateisignatur) mit einfachen Dateinamen in die drei
 * bekannten Ordner geschrieben; vorhandene Dateien bleiben unverändert.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, UPLOAD_DIR } = require('./db');
const { detectImage, MAX_BYTES } = require('./uploads');

const FOLDERS = ['public/avatars', 'public/team', 'evidence'];
const RESTORE_PATH = path.join(path.dirname(DB_PATH), 'restore.db');
const MAX_DB_UPLOAD = 1024 * 1024 * 1024; // 1 GB
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024; // entpackt höchstens 8 GB
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function filesIn(folder) {
  const dir = path.join(UPLOAD_DIR, folder);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && NAME_RE.test(e.name))
      .map((e) => ({ folder, name: e.name, file: path.join(dir, e.name) }));
  } catch {
    return [];
  }
}

/** Anzahl und Größe aller hochgeladenen Bilder. */
function stats() {
  let files = 0;
  let bytes = 0;
  for (const folder of FOLDERS) {
    for (const f of filesIn(folder)) {
      try {
        bytes += fs.statSync(f.file).size;
        files += 1;
      } catch {
        /* gerade gelöscht */
      }
    }
  }
  return { files, bytes };
}

/* ---------------------------------------------------------------- tar (ustar) */
function octal(n, width) {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(dir, name, size, mtime) {
  const h = Buffer.alloc(512);
  // Lange Pfade: Ordner ins ustar-Feld „prefix“, Dateiname ins Namensfeld
  const full = `${dir}/${name}`;
  if (Buffer.byteLength(full) <= 100) h.write(full, 0, 100, 'utf8');
  else {
    h.write(name, 0, 100, 'utf8');
    h.write(dir, 345, 155, 'utf8');
  }
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 'ascii');
  h.fill(' ', 148, 156); // Prüfsumme wird mit Leerzeichen berechnet
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

async function* tarEntries() {
  for (const folder of FOLDERS) {
    for (const f of filesIn(folder)) {
      let data;
      let mtime;
      try {
        data = await fs.promises.readFile(f.file); // Bilder sind höchstens wenige MB groß
        mtime = (await fs.promises.stat(f.file)).mtimeMs;
      } catch {
        continue; // inzwischen gelöscht
      }
      yield tarHeader(`uploads/${folder}`, f.name, data.length, mtime);
      yield data;
      if (data.length % 512) yield Buffer.alloc(512 - (data.length % 512));
    }
  }
  yield Buffer.alloc(1024); // Ende des Archivs
}

/** Alle Bilder als .tar.gz in einen Stream (z. B. die HTTP-Antwort) schreiben. */
function writeArchive(out) {
  return pipeline(Readable.from(tarEntries()), zlib.createGzip({ level: 6 }), out);
}

/* ---------------------------------------------------------------- Einspielen */
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** Pfad im Archiv → [Ordner, Dateiname] oder null (alles andere wird übersprungen). */
function targetOf(entryName) {
  const m = String(entryName)
    .replace(/\\/g, '/')
    .match(/(?:^|\/)(public\/avatars|public\/team|evidence)\/([^/]+)$/);
  if (!m || !NAME_RE.test(m[2])) return null;
  return [m[1], m[2]];
}

/**
 * Bilder aus einem (entpackten) tar-Stream übernehmen. Liefert { added, existing, skipped }.
 * Unterstützt normale Dateien (ustar/GNU); Verzeichnisse, Links und Zusatz-Header werden übersprungen.
 */
async function extractTar(source) {
  const result = { added: 0, existing: 0, skipped: 0 };
  let pending = Buffer.alloc(0);
  let entry = null; // { target, size, left, pad, chunks }
  let total = 0;
  let ended = false;
  const free = freeBytes(UPLOAD_DIR);
  let written = 0;

  const finishEntry = () => {
    const e = entry;
    entry = null;
    if (!e.target) return;
    const data = Buffer.concat(e.chunks);
    if (!detectImage(data)) {
      result.skipped += 1;
      return;
    }
    const [folder, name] = e.target;
    const file = path.join(UPLOAD_DIR, folder, name);
    if (fs.existsSync(file)) {
      result.existing += 1;
      return;
    }
    if (free !== null && written + data.length > free - 50 * 1024 * 1024) throw fail('Zu wenig freier Speicher auf der Disk.', 507);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { flag: 'wx' });
    written += data.length;
    result.added += 1;
  };

  for await (const chunk of source) {
    if (ended) continue; // Rest nach dem Ende-Block ignorieren
    total += chunk.length;
    if (total > MAX_ARCHIVE_BYTES) throw fail('Das Archiv ist zu groß.', 413);
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (entry) {
        if (entry.left > 0) {
          if (!pending.length) break;
          const take = Math.min(entry.left, pending.length);
          if (entry.target) entry.chunks.push(pending.subarray(0, take));
          entry.left -= take;
          pending = pending.subarray(take);
          if (entry.left > 0) break;
        }
        if (pending.length < entry.pad) break;
        pending = pending.subarray(entry.pad);
        finishEntry();
        continue;
      }
      if (pending.length < 512) break;
      const h = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (h.every((b) => b === 0)) {
        ended = true;
        break;
      }
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      const stored = parseInt(h.toString('ascii', 148, 156).replace(/[^0-7]/g, ''), 8);
      if (sum !== stored) throw fail('Das ist kein gültiges Archiv mit Bildern (.tar.gz).');
      const size = parseInt(h.toString('ascii', 124, 136).replace(/[^0-7]/g, '') || '0', 8);
      const type = String.fromCharCode(h[156] || 48);
      const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      const prefix = h.toString('ascii', 257, 262) === 'ustar' ? h.toString('utf8', 345, 500).replace(/\0.*$/s, '') : '';
      const fullName = prefix ? `${prefix}/${name}` : name;
      const isFile = type === '0' || type === '\0';
      const target = isFile && size > 0 && size <= MAX_BYTES ? targetOf(fullName) : null;
      if (isFile && !target) result.skipped += 1;
      entry = { target, left: size, pad: (512 - (size % 512)) % 512, chunks: [] };
    }
  }
  if (entry) throw fail('Das Archiv ist unvollständig.');
  return result;
}

/** Hochgeladene Sicherung verarbeiten: Datenbank → restore.db vormerken, .tar.gz → Bilder ergänzen. */
async function receiveUpload(req) {
  const dir = path.dirname(DB_PATH);
  const announced = Number(req.get('content-length')) || 0;
  if (announced > MAX_DB_UPLOAD * 4) throw fail('Die Datei ist zu groß.', 413);
  const freeBefore = freeBytes(dir);
  if (freeBefore !== null && announced > freeBefore - 50 * 1024 * 1024) throw fail('Zu wenig freier Speicher auf der Disk.', 507);
  const tmp = path.join(dir, `.upload-${process.pid}-${Date.now()}.tmp`);
  let size = 0;
  try {
    // Erst auf die Disk schreiben (Größengrenze, freier Speicher), dann anhand des Inhalts erkennen
    const free = freeBytes(dir);
    await pipeline(
      req,
      async function* (source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > MAX_DB_UPLOAD * 4) throw fail('Die Datei ist zu groß.', 413);
          if (free !== null && size > free - 50 * 1024 * 1024) throw fail('Zu wenig freier Speicher auf der Disk.', 507);
          yield chunk;
        }
      },
      fs.createWriteStream(tmp, { flags: 'wx' })
    );
    if (!size) throw fail('Die Datei ist leer.');
    const head = Buffer.alloc(16);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);

    if (head[0] === 0x1f && head[1] === 0x8b) {
      let result;
      let inner = null; // eigener Fehler – pipeline meldet sonst nur „aborted“
      await pipeline(fs.createReadStream(tmp), zlib.createGunzip(), async (source) => {
        try {
          result = await extractTar(source);
        } catch (err) {
          inner = err;
          throw err;
        }
      }).catch((err) => {
        const e = inner || err;
        if (e.status) throw e;
        throw fail('Das Archiv konnte nicht entpackt werden (beschädigt oder kein .tar.gz).');
      });
      return { kind: 'bilder', ...result };
    }

    if (head.toString('latin1') === 'SQLite format 3\0') {
      if (size > MAX_DB_UPLOAD) throw fail('Die Datenbank ist zu groß.', 413);
      checkDatabase(tmp);
      fs.renameSync(tmp, RESTORE_PATH);
      return { kind: 'datenbank', size };
    }
    throw fail('Unbekanntes Format – bitte eine Datenbank-Sicherung (.db) oder ein Bilder-Archiv (.tar.gz) wählen.');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Prüft, ob die Datei eine unbeschädigte Datenbank dieser Anwendung ist. */
function checkDatabase(file) {
  let copy;
  try {
    copy = new DatabaseSync(file, { readOnly: true });
    const ok = copy.prepare('PRAGMA quick_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw fail('Die Datenbank ist beschädigt.');
    const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (!['users', 'cases', 'settings'].every((t) => tables.has(t))) throw fail('Das ist keine Datenbank von Pake & Scha.');
  } catch (err) {
    if (err.status) throw err;
    throw fail('Die Datenbank kann nicht gelesen werden.');
  } finally {
    if (copy) copy.close();
  }
}

/** Gespeicherte Sicherung aus backups/ für den nächsten Start vormerken. */
function stageBackup(file) {
  checkDatabase(file);
  const tmp = `${RESTORE_PATH}.tmp`;
  fs.copyFileSync(file, tmp);
  fs.renameSync(tmp, RESTORE_PATH);
}

/** Vorgemerkte Sicherung (restore.db) – oder null. */
function pendingRestore() {
  try {
    const s = fs.statSync(RESTORE_PATH);
    return { size: s.size, stagedAt: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

function cancelRestore() {
  fs.rmSync(RESTORE_PATH, { force: true });
}

module.exports = { stats, writeArchive, extractTar, receiveUpload, stageBackup, pendingRestore, cancelRestore, FOLDERS };
