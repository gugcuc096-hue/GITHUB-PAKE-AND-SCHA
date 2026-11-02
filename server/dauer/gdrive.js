'use strict';
/*
 * Schlanker Google-Drive-Zugang für den Dauerbetrieb – ohne Datenbank, damit er schon beim Start (vor der
 * Wiederherstellung) funktioniert. Der Refresh-Token kommt aus einer austauschbaren Quelle: beim Start aus dem
 * Wiederherstellungs-Schlüssel, danach aus der Verbindung im Dashboard (googleDrive.js).
 * Scope „drive.file“: Die Website sieht nur Dateien, die sie selbst angelegt hat.
 *
 * Jeder Aufruf wiederholt sich bei Netzfehlern, 429 und 5xx bis zu fünfmal mit wachsender Pause.
 */
const crypto = require('crypto');
const fs = require('fs');
const cfg = require('./config');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MULTIPART_MAX = 4 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;
const TIMEOUT = 60000;

let source = () => null; // liefert den Refresh-Token
let access = { token: null, expires: 0, rt: null };

function useRefreshToken(fn) {
  source = fn;
}
const hasToken = () => !!safe(source);
function safe(fn) {
  try {
    return fn() || null;
  } catch {
    return null;
  }
}

function fail(message, status = 502, code = 'drive') {
  return Object.assign(new Error(message), { status, code });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retriable = (status) => status === 429 || status >= 500;

async function accessToken(force = false) {
  const rt = safe(source);
  if (!rt) throw fail('Kein Zugang zum Google Drive (Google nicht verbunden und kein Wiederherstellungs-Schlüssel).', 409, 'not_connected');
  if (!force && access.token && access.rt === rt && Date.now() < access.expires - 60000) return access.token;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${cfg.oauthBase()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId(), client_secret: cfg.clientSecret(), refresh_token: rt, grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (err) {
      if (attempt >= 4) throw fail(`Google nicht erreichbar: ${err.message}`, 503, 'network');
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.access_token) {
      access = { token: json.access_token, expires: Date.now() + (Number(json.expires_in) || 3000) * 1000, rt };
      return access.token;
    }
    if (json.error === 'invalid_grant') throw fail('Google hat den Zugang abgelehnt (abgelaufen oder widerrufen). Im Dashboard Google neu verbinden und den neuen Wiederherstellungs-Schlüssel in Render eintragen.', 409, 'expired');
    if (!retriable(res.status) || attempt >= 4) throw fail(json.error_description || json.error || `Google antwortet mit ${res.status}`);
    await sleep(1000 * 2 ** attempt);
  }
}

/** Ein Aufruf mit Wiederholungen. raw: Antwort ungelesen zurück (Download). */
async function call(method, url, { json, body, headers = {}, raw = false, timeout = TIMEOUT, okStatus = [] } = {}) {
  let forced = false;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${await accessToken(forced)}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json ? JSON.stringify(json) : body,
        redirect: raw && method === 'GET' ? 'follow' : 'manual', // Downloads dürfen umgeleitet werden
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (err.code === 'not_connected' || err.code === 'expired') throw err;
      if (attempt >= 5) throw fail(`Google Drive nicht erreichbar: ${err.message}`, 503, 'network');
      await sleep(Math.min(16000, 800 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 && !forced) {
      forced = true;
      continue;
    }
    if (res.ok || okStatus.includes(res.status)) {
      if (raw) return res;
      if (res.status === 204) return {};
      return res.json().catch(() => ({}));
    }
    const data = await res.json().catch(() => ({}));
    const reason = data.error && (data.error.message || (data.error.errors && data.error.errors[0] && data.error.errors[0].message));
    if (res.status === 404) throw fail(`Google Drive: ${reason || 'nicht gefunden'}`, 404, 'not_found');
    if (res.status === 403 && /storage ?quota|quota.*exceeded|insufficient.*storage/i.test(reason || '')) throw fail('Google Drive ist voll.', 507, 'full');
    if (retriable(res.status) && attempt < 5) {
      await sleep(Math.min(16000, 800 * 2 ** attempt));
      continue;
    }
    throw fail(`Google Drive: ${reason || `Fehler ${res.status}`}`, res.status >= 500 ? 503 : 502);
  }
}

const API = () => `${cfg.apiBase()}/drive/v3`;
const UPLOAD = () => `${cfg.apiBase()}/upload/drive/v3`;
const FIELDS = 'id,name,size,createdTime,modifiedTime,appProperties,parents';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Dateien zu einer Suche (alle Seiten). */
async function list(q) {
  const out = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive', ...(pageToken ? { pageToken } : {}) });
    const data = await call('GET', `${API()}/files?${p}`);
    out.push(...(data.files || []).map((f) => ({ ...f, size: Number(f.size) || 0, appProperties: f.appProperties || {} })));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}
const inFolder = (folderId, extra = '') => list(`'${esc(folderId)}' in parents and trashed = false${extra}`);
const prop = (key, value) => ` and appProperties has { key='${esc(key)}' and value='${esc(value)}' }`;

async function findFolder(tag, parent) {
  const q = `mimeType = '${FOLDER_MIME}' and trashed = false${parent ? ` and '${esc(parent)}' in parents` : ''}${prop('ps', tag)}`;
  const found = await list(q);
  found.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  return found[0] || null;
}

async function createFolder(name, tag, parent) {
  return call('POST', `${API()}/files?fields=${FIELDS}`, { json: { name, mimeType: FOLDER_MIME, appProperties: { ps: tag }, ...(parent ? { parents: [parent] } : {}) } });
}

async function ensureFolder(name, tag, parent) {
  return (await findFolder(tag, parent)) || createFolder(name, tag, parent);
}

function multipartBody(meta, data, mime) {
  const boundary = `ps-${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
}

/** Neue Datei aus dem Speicher (Journal, Bilder). Nie überschreiben – Google würde alte Versionen mitspeichern. */
async function uploadBuffer({ name, parent, appProperties = {}, data, mime = 'application/octet-stream' }) {
  const meta = { name, parents: [parent], appProperties, mimeType: mime };
  if (data.length <= MULTIPART_MAX) {
    const { body, headers } = multipartBody(meta, data, mime);
    return normalize(await call('POST', `${UPLOAD()}/files?uploadType=multipart&fields=${FIELDS}`, { body, headers }));
  }
  return resumable(meta, mime, data.length, async (pos, len) => data.subarray(pos, pos + len));
}

/** Neue Datei von der Platte (Gesamtstand), in Stücken – wenig Arbeitsspeicher auch bei großen Datenbanken. */
async function uploadFile({ name, parent, appProperties = {}, file, mime = 'application/octet-stream' }) {
  const size = fs.statSync(file).size;
  const meta = { name, parents: [parent], appProperties, mimeType: mime };
  if (size <= MULTIPART_MAX) return uploadBuffer({ name, parent, appProperties, data: fs.readFileSync(file), mime });
  const fh = await fs.promises.open(file, 'r');
  try {
    return await resumable(meta, mime, size, async (pos, len) => {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      if (bytesRead !== len) throw fail('Datei hat sich beim Hochladen geändert.', 500);
      return buf;
    });
  } finally {
    await fh.close();
  }
}

async function resumable(meta, mime, size, read) {
  const res = await call('POST', `${UPLOAD()}/files?uploadType=resumable&fields=${FIELDS}`, {
    json: meta,
    headers: { 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    raw: true,
  });
  const session = res.headers.get('location');
  if (!session || !session.startsWith(cfg.apiBase())) throw fail('Google Drive: Upload-Sitzung konnte nicht gestartet werden.');
  let pos = 0;
  for (let attempt = 0; ; ) {
    const len = Math.min(CHUNK, size - pos);
    let r;
    try {
      r = await fetch(session, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': mime, 'Content-Range': `bytes ${pos}-${pos + len - 1}/${size}` },
        body: await read(pos, len),
        redirect: 'manual',
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch (err) {
      if (++attempt > 5) throw fail(`Google Drive nicht erreichbar: ${err.message}`, 503, 'network');
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (r.status === 308) {
      const got = /bytes=0-(\d+)/.exec(r.headers.get('range') || '');
      pos = got ? Number(got[1]) + 1 : 0;
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (r.ok) return normalize(data);
    if (retriable(r.status) && ++attempt <= 5) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const reason = data.error && data.error.message;
    if (r.status === 403 && /quota|storage/i.test(reason || '')) throw fail('Google Drive ist voll.', 507, 'full');
    throw fail(`Google Drive: ${reason || `Fehler ${r.status}`}`);
  }
}

const normalize = (f) => ({ ...f, size: Number(f.size) || 0, appProperties: f.appProperties || {} });

async function download(id) {
  const res = await call('GET', `${API()}/files/${encodeURIComponent(id)}?alt=media`, { raw: true, timeout: 5 * 60 * 1000 });
  return Buffer.from(await res.arrayBuffer());
}

async function downloadTo(id, file) {
  const res = await call('GET', `${API()}/files/${encodeURIComponent(id)}?alt=media`, { raw: true, timeout: 10 * 60 * 1000 });
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  return fs.statSync(file).size;
}

async function meta(id) {
  return normalize(await call('GET', `${API()}/files/${encodeURIComponent(id)}?fields=${FIELDS}`));
}

/** Nur Merkmale ändern – der Inhalt bleibt, es entsteht keine neue Version. */
async function setProps(id, appProperties) {
  return normalize(await call('PATCH', `${API()}/files/${encodeURIComponent(id)}?fields=${FIELDS}`, { json: { appProperties } }));
}

/** Endgültig löschen (nicht in den Papierkorb – der würde weiter Platz belegen). */
async function remove(id) {
  try {
    await call('DELETE', `${API()}/files/${encodeURIComponent(id)}`);
    return true;
  } catch (err) {
    if (err.code === 'not_found') return false;
    throw err;
  }
}

/** Belegung des ganzen Google Drive (limit fehlt bei unbegrenztem Speicher). */
async function about() {
  const a = await call('GET', `${API()}/about?fields=storageQuota,user(emailAddress)`);
  const q = a.storageQuota || {};
  return { limit: q.limit ? Number(q.limit) : null, usage: Number(q.usage) || 0, email: (a.user && a.user.emailAddress) || null };
}

module.exports = { useRefreshToken, hasToken, accessToken, list, inFolder, prop, findFolder, ensureFolder, uploadBuffer, uploadFile, download, downloadTo, meta, setProps, remove, about, FOLDER_MIME };
