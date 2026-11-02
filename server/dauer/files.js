'use strict';
/*
 * Hochgeladene Dateien im Dauerbetrieb (Profilbilder, Team-Fotos, Lager-Bilder, Beweismittel, Zahlungsnachweise):
 *  - jede Datei einzeln und verschlüsselt im Drive-Ordner „Dateien“, gleich nach dem Hochladen (sonst beim
 *    Abgleich alle 15 Sekunden); welche Datei wo liegt, steht in der Tabelle dauer_files – also in der Datenbank
 *    und damit in jeder Sicherung.
 *  - nach einem Neustart lädt der Server alle Dateien im Hintergrund zurück; wird eine vorher gebraucht, holt er
 *    genau diese sofort (ensureLocal).
 *  - gelöschte Dateien bleiben 30 Tage im Drive (falls versehentlich), danach werden sie endgültig gelöscht.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const state = require('./state');
const drive = require('./gdrive');
const pack = require('./pack');
const store = require('./store');
const { db, UPLOAD_DIR } = require('../db/db');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
let folderId = null;
let active = false;
let scanTimer = null;
const seen = new Set(); // Pfade, die in dieser Laufzeit lokal da waren (nur deren Fehlen heißt „gelöscht“)
const pending = new Map(); // laufende Downloads je Pfad
const uploads = new Set();
const stats = { restoring: false, restored: 0, toRestore: 0, failed: 0, lastError: null, uploaded: 0, lastScanAt: null };

const rel = (abs) => path.relative(UPLOAD_DIR, abs).split(path.sep).join('/');
const absOf = (p) => path.join(UPLOAD_DIR, ...p.split('/'));
const validRel = (p) => !!p && !p.startsWith('..') && !path.isAbsolute(p) && p.split('/').every((s) => NAME_RE.test(s));

function walk(dir = UPLOAD_DIR, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!NAME_RE.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const row = (p) => db.prepare('SELECT * FROM dauer_files WHERE path = ?').get(p);

async function upload(p) {
  if (!active || state.frozen || uploads.has(p)) return;
  uploads.add(p);
  try {
    const abs = absOf(p);
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return; // schon wieder weg
    }
    const old = row(p);
    if (old && old.drive_id && old.state === 'ok' && old.size === buf.length) return;
    await require('./guard').beforeUpload(buf.length);
    const f = await drive.uploadBuffer({ name: `${p.replace(/\//g, '__')}.pse`, parent: folderId, appProperties: { ps: 'file', p }, data: pack.encrypt(buf, require('./live').dataKey()) });
    db.prepare(
      `INSERT INTO dauer_files (path, size, drive_id, state, deleted_at, synced_at) VALUES (?, ?, ?, 'ok', NULL, datetime('now'))
       ON CONFLICT(path) DO UPDATE SET size = excluded.size, drive_id = excluded.drive_id, state = 'ok', deleted_at = NULL, synced_at = excluded.synced_at`
    ).run(p, buf.length, f.id);
    require('./live').touch(); // Verzeichnis-Eintrag gleich mit ins Drive
    if (old && old.drive_id && old.drive_id !== f.id) await drive.remove(old.drive_id).catch(() => {});
    stats.uploaded += 1;
  } catch (err) {
    stats.lastError = `${p}: ${err.message}`;
    console.warn(`Dauerbetrieb: Datei ${p} nicht im Drive: ${err.message}`);
  } finally {
    uploads.delete(p);
  }
}

/** Gerade gespeichert (uploads.js) – sofort hochladen. */
function touched(abs) {
  if (!active) return;
  const p = rel(abs);
  if (!validRel(p)) return;
  seen.add(p);
  upload(p);
}

/** Gerade gelöscht (uploads.js). */
function removed(abs) {
  if (!active) return;
  const p = rel(abs);
  if (!validRel(p)) return;
  seen.delete(p);
  db.prepare("UPDATE dauer_files SET state = 'deleted', deleted_at = datetime('now') WHERE path = ? AND state = 'ok'").run(p);
}

/** Datei aus dem Drive holen, falls sie hier (nach einem Neustart) noch fehlt. true = jetzt da. */
async function ensureLocal(abs) {
  if (fs.existsSync(abs)) return true;
  if (!cfg.enabled()) return false;
  const p = rel(abs);
  if (!validRel(p)) return false;
  const r = row(p);
  if (!r || !r.drive_id || r.state !== 'ok') return false;
  if (!pending.has(p)) {
    pending.set(
      p,
      (async () => {
        const key = require('./live').dataKey() || (state.creds && state.creds.k);
        if (!key || !drive.hasToken()) throw new Error('kein Zugang zum Drive');
        const buf = pack.decrypt(await drive.download(r.drive_id), key);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.laden`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, abs);
        seen.add(p);
      })().finally(() => pending.delete(p))
    );
  }
  try {
    await pending.get(p);
    return true;
  } catch (err) {
    stats.lastError = `${p}: ${err.message}`;
    return false;
  }
}

/** Express: vor /media – fehlende Bilder erst aus dem Drive holen. */
function middleware(baseDir) {
  return (req, res, next) => {
    if (!cfg.enabled() || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    let file;
    try {
      file = path.join(baseDir, decodeURIComponent(req.path));
    } catch {
      return next();
    }
    if (!file.startsWith(baseDir + path.sep)) return next();
    ensureLocal(file).finally(() => next());
  };
}

/** Nach dem Start: alle Dateien, die laut Verzeichnis existieren, zurückholen (im Hintergrund, 4 gleichzeitig). */
async function restoreAll() {
  const rows = db.prepare("SELECT path FROM dauer_files WHERE state = 'ok' AND drive_id IS NOT NULL").all().filter((r) => !fs.existsSync(absOf(r.path)));
  if (!rows.length) return;
  stats.restoring = true;
  stats.toRestore = rows.length;
  stats.restored = 0;
  const t0 = Date.now();
  await store.fetchAll(
    rows,
    async (r) => {
      if (await ensureLocal(absOf(r.path))) stats.restored += 1;
      else stats.failed += 1;
    },
    4
  );
  stats.restoring = false;
  console.log(`Dauerbetrieb: ${stats.restored}/${rows.length} Dateien aus dem Drive zurückgeholt (${Math.round((Date.now() - t0) / 1000)} s).`);
}

/** Abgleich: neue/geänderte Dateien hoch, verschwundene als gelöscht markieren, alte Löschungen endgültig entfernen. */
async function scan() {
  if (!active || state.frozen) return;
  stats.lastScanAt = new Date().toISOString();
  const local = new Map();
  for (const abs of walk()) {
    const p = rel(abs);
    if (!validRel(p) || p.endsWith('.laden')) continue;
    try {
      local.set(p, fs.statSync(abs).size);
    } catch {
      /* gerade gelöscht */
    }
  }
  const rows = new Map(db.prepare('SELECT path, size, drive_id, state, deleted_at FROM dauer_files').all().map((r) => [r.path, r]));
  for (const [p, size] of local) {
    seen.add(p);
    const r = rows.get(p);
    if (!r || r.state !== 'ok' || !r.drive_id || r.size !== size) await upload(p);
  }
  for (const r of rows.values()) {
    if (r.state === 'ok' && !local.has(r.path) && seen.has(r.path) && !pending.has(r.path)) {
      seen.delete(r.path);
      db.prepare("UPDATE dauer_files SET state = 'deleted', deleted_at = datetime('now') WHERE path = ?").run(r.path);
    }
  }
  await purge();
}

async function purge(force = false) {
  const days = force ? 0 : cfg.DELETED_KEEP_DAYS;
  const old = db.prepare(`SELECT path, drive_id FROM dauer_files WHERE state = 'deleted' AND deleted_at <= datetime('now', ?) ORDER BY deleted_at`).all(`-${days} days`);
  for (const r of old) {
    if (r.drive_id) await drive.remove(r.drive_id).catch(() => {});
    db.prepare("DELETE FROM dauer_files WHERE path = ? AND state = 'deleted'").run(r.path);
  }
  return old.length;
}

async function start(rootId) {
  if (active) return;
  folderId = (await store.ensureFilesFolder(rootId)).id;
  active = true;
  restoreAll().catch((err) => console.warn('Dauerbetrieb: Dateien zurückholen fehlgeschlagen:', err.message));
  const loop = () => {
    scanTimer = setTimeout(async () => {
      await scan().catch((err) => console.warn('Dauerbetrieb: Datei-Abgleich fehlgeschlagen:', err.message));
      loop();
    }, cfg.SCAN_MS);
    scanTimer.unref();
  };
  // Erster Abgleich erst, wenn die Wiederherstellung angelaufen ist (fehlende Dateien sind dann nicht „gelöscht“)
  setTimeout(() => scan().catch(() => {}), 2000).unref();
  loop();
}

function status() {
  const c = db.prepare("SELECT state, count(*) AS n, COALESCE(sum(size), 0) AS bytes FROM dauer_files GROUP BY state").all();
  const by = Object.fromEntries(c.map((r) => [r.state, r]));
  const local = walk().length;
  return { active, files: (by.ok && by.ok.n) || 0, bytes: (by.ok && by.ok.bytes) || 0, deleted: (by.deleted && by.deleted.n) || 0, deletedBytes: (by.deleted && by.deleted.bytes) || 0, local, ...stats };
}

module.exports = { start, touched, removed, ensureLocal, middleware, scan, purge, status, folder: () => folderId };
