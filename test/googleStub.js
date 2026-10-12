'use strict';
/*
 * Nachgebaute Google-Schnittstelle für die Tests – wird mit `node --require test/googleStub.js` vor dem Server
 * geladen und fängt nur Aufrufe an Google ab (Anmeldung, Token, Drive). Es geht nichts nach außen.
 *
 * GOOGLE_STUB_STATE=<Datei>: Nach jedem Aufruf steht dort der Stand als JSON (Dateien, Freigaben, Aufrufe);
 *   die hochgeladenen DOCX-Dateien liegen daneben in <Datei>.files/<id>-v<Version>.docx.
 * <Datei>.ctl (optional, JSON): Störungen für Tests, z. B. {"deleted":["doc-1"]} (Datei in Drive gelöscht)
 *   oder {"revoked":true} (Zugriff widerrufen → invalid_grant), {"failUpload":true} (Upload-Stücke scheitern),
 *   {"partialUpload":true} (Google nimmt je Stück nur die Hälfte an → 308 mit Range),
 *   {"add":[{id,name,parents,createdTime}]} (Dateien, die schon im Drive liegen – z. B. alte Sicherungen).
 */
const fs = require('fs');
const path = require('path');

const realFetch = globalThis.fetch;
const STATE = process.env.GOOGLE_STUB_STATE || '';
const FILES_DIR = STATE ? `${STATE}.files` : '';
const state = { files: {}, calls: [], revoked: [], removed: [], seq: 0, lastAuthorize: null };
const sessions = {}; // Upload-Sitzungen („resumable“): upload_id → { method, id, meta }
const save = () => STATE && fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const control = () => {
  try {
    return JSON.parse(fs.readFileSync(`${STATE}.ctl`, 'utf8'));
  } catch {
    return {};
  }
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function multipart(buf, contentType) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  const parts = [];
  let pos = buf.indexOf(`--${boundary}`);
  while (pos !== -1) {
    const next = buf.indexOf(`--${boundary}`, pos + boundary.length + 2);
    if (next === -1) break;
    const part = buf.subarray(pos + boundary.length + 4, next - 2); // ohne „--b\r\n“ und abschließendes „\r\n“
    const sep = part.indexOf('\r\n\r\n');
    parts.push({ headers: part.subarray(0, sep).toString(), body: part.subarray(sep + 4) });
    pos = next;
  }
  return { meta: JSON.parse(parts[0].body.toString()), media: parts[1].body, mediaType: /Content-Type:\s*([^\r\n]+)/i.exec(parts[1].headers)[1] };
}

function storeDocx(id, version, buf, ext = '.docx') {
  if (!FILES_DIR) return;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, `${id}-v${version}${ext}`), buf);
}
const now = () => new Date().toISOString();

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!/(^|\.)googleapis\.com$|^accounts\.google\.com$/.test(url.hostname)) return realFetch(input, init);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = init.headers || {};
  const ctl = control();
  state.calls.push(`${method} ${url.hostname}${url.pathname}`);
  for (const f of ctl.add || []) {
    if (!state.files[f.id] && !state.removed.includes(f.id)) state.files[f.id] = { mimeType: 'application/octet-stream', trashed: false, permissions: [], size: 1, ...f };
  }
  try {
    // Token-Tausch und -Erneuerung
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const p = new URLSearchParams(String(init.body));
      if (!p.get('client_id') || !p.get('client_secret')) return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const scope = p.get('code') === 'ohne-drive' ? 'openid https://www.googleapis.com/auth/userinfo.email' : 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file';
        return json(200, {
          access_token: `at-${++state.seq}`,
          expires_in: 3599,
          refresh_token: 'rt-kanzlei-geheim',
          scope,
          token_type: 'Bearer',
          id_token: `${b64url({ alg: 'none' })}.${b64url({ email: 'kanzlei.pake.scha@gmail.com' })}.x`,
        });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (ctl.revoked || p.get('refresh_token') !== 'rt-kanzlei-geheim') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: `at-${++state.seq}`, expires_in: 3599, token_type: 'Bearer' });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      state.revoked.push(url.searchParams.get('token'));
      return new Response('', { status: 200 });
    }

    // Drive: nur mit Zugriffstoken
    const auth = headers.Authorization || headers.authorization || '';
    if (!/^Bearer at-\d+$/.test(auth) || ctl.revoked) return json(401, { error: { message: 'Request had invalid authentication credentials.' } });
    const exists = (id) => state.files[id] && !state.files[id].trashed && !(ctl.deleted || []).includes(id);

    // Ordner anlegen
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      const meta = JSON.parse(init.body);
      if (meta.parents && !meta.parents.every(exists)) return json(404, { error: { message: `File not found: ${meta.parents[0]}.` } });
      const id = `folder-${++state.seq}`;
      state.files[id] = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], trashed: false, permissions: [], createdTime: now() };
      return json(200, { id });
    }
    // Upload-Sitzung („resumable“, für große Dateien): starten …
    if (url.searchParams.get('uploadType') === 'resumable' && (method === 'POST' || method === 'PATCH')) {
      const meta = JSON.parse(init.body);
      const id = method === 'PATCH' ? decodeURIComponent(url.pathname.split('/').pop()) : null;
      if (id && !exists(id)) return json(404, { error: { message: `File not found: ${id}.` } });
      if (meta.parents && !meta.parents.every(exists)) return json(404, { error: { message: `File not found: ${meta.parents[0]}.` } });
      if (headers['X-Upload-Content-Type'] === undefined) return json(400, { error: { message: 'X-Upload-Content-Type fehlt' } });
      const uploadId = `up-${++state.seq}`;
      sessions[uploadId] = { method, id, meta, length: Number(headers['X-Upload-Content-Length']), received: Buffer.alloc(0), chunks: 0 };
      return new Response('', { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${uploadId}` } });
    }
    // … und Inhalt senden
    if (method === 'PUT' && url.searchParams.get('upload_id')) {
      const sess = sessions[url.searchParams.get('upload_id')];
      if (!sess) return json(404, { error: { message: 'Upload-Sitzung unbekannt' } });
      // In Stücken („Content-Range: bytes a-b/gesamt“, Sicherungen): 308 bis alles da ist
      const range = headers['Content-Range'] && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['Content-Range']);
      if (range) {
        if (ctl.failUpload) return json(503, { error: { message: 'Backend Error' } });
        let chunk = Buffer.from(init.body);
        if (Number(range[1]) !== sess.received.length || Number(range[3]) !== sess.length || chunk.length !== Number(range[2]) - Number(range[1]) + 1) return json(400, { error: { message: 'Content-Range passt nicht' } });
        if (ctl.partialUpload && chunk.length > 1) chunk = chunk.subarray(0, Math.ceil(chunk.length / 2));
        sess.received = Buffer.concat([sess.received, chunk]);
        sess.chunks += 1;
        if (sess.received.length < sess.length) return new Response(null, { status: 308, headers: { Range: `bytes=0-${sess.received.length - 1}` } });
        const id = `file-${++state.seq}`;
        if (sess.meta.parents && !sess.meta.parents.every(exists)) return json(404, { error: { message: `File not found: ${sess.meta.parents[0]}.` } });
        state.files[id] = { id, name: sess.meta.name, mimeType: sess.meta.mimeType, sourceType: headers['Content-Type'], parents: sess.meta.parents || [], trashed: false, version: 1, size: sess.length, permissions: [], upload: 'resumable', chunks: sess.chunks, createdTime: now() };
        storeDocx(id, 1, sess.received, /\.tar\.gz$/.test(sess.meta.name) ? '.tar.gz' : path.extname(sess.meta.name) || '.bin');
        return json(200, { id, name: sess.meta.name, size: String(sess.length) });
      }
      const media = Buffer.from(init.body);
      if (media.length !== sess.length) return json(400, { error: { message: 'Länge stimmt nicht' } });
      let id = sess.id;
      if (id) {
        const f = state.files[id];
        Object.assign(f, { name: sess.meta.name || f.name, sourceType: headers['Content-Type'], version: f.version + 1, size: media.length, upload: 'resumable' });
        storeDocx(id, f.version, media);
      } else {
        id = `doc-${++state.seq}`;
        state.files[id] = { id, name: sess.meta.name, mimeType: sess.meta.mimeType, sourceType: headers['Content-Type'], parents: sess.meta.parents || [], trashed: false, version: 1, size: media.length, permissions: [], upload: 'resumable', createdTime: now() };
        storeDocx(id, 1, media);
      }
      return json(200, { id, webViewLink: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk` });
    }
    // Upload mit Umwandlung in ein Google Doc
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      if (url.searchParams.get('uploadType') !== 'multipart') return json(400, { error: { message: 'uploadType' } });
      const { meta, media, mediaType } = multipart(Buffer.from(init.body), headers['Content-Type']);
      if (meta.parents && !meta.parents.every(exists)) return json(404, { error: { message: `File not found: ${meta.parents[0]}.` } });
      const id = `doc-${++state.seq}`;
      state.files[id] = { id, name: meta.name, mimeType: meta.mimeType, sourceType: mediaType, parents: meta.parents || [], trashed: false, version: 1, size: media.length, permissions: [], createdTime: now() };
      storeDocx(id, 1, media);
      return json(200, { id, webViewLink: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk` });
    }
    // Inhalt eines bestehenden Docs ersetzen
    let m = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (method === 'PATCH' && m) {
      const id = decodeURIComponent(m[1]);
      if (!exists(id)) return json(404, { error: { message: `File not found: ${id}.` } });
      const { meta, media, mediaType } = multipart(Buffer.from(init.body), headers['Content-Type']);
      const f = state.files[id];
      Object.assign(f, { name: meta.name || f.name, sourceType: mediaType, version: f.version + 1, size: media.length });
      storeDocx(id, f.version, media);
      return json(200, { id, webViewLink: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk` });
    }
    // Freigabe
    m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/permissions$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (!exists(id)) return json(404, { error: { message: `File not found: ${id}.` } });
      const perm = JSON.parse(init.body);
      state.files[id].permissions.push(perm);
      return json(200, { id: `perm-${++state.seq}` });
    }
    // Dateien eines Ordners auflisten (q: '<Ordner>' in parents and trashed = false)
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = /^'([^']+)' in parents and trashed = false$/.exec(url.searchParams.get('q') || '');
      if (!q) return json(400, { error: { message: 'Nicht nachgebaute Suche' } });
      const files = Object.values(state.files)
        .filter((f) => f.parents && f.parents.includes(q[1]) && exists(f.id))
        .map((f) => ({ id: f.id, name: f.name, size: String(f.size || 0), createdTime: f.createdTime }));
      return json(200, { files });
    }
    // Endgültig löschen
    m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (method === 'DELETE' && m) {
      const id = decodeURIComponent(m[1]);
      if (!exists(id)) return json(404, { error: { message: `File not found: ${id}.` } });
      delete state.files[id];
      state.removed.push(id);
      return new Response(null, { status: 204 });
    }
    // Papierkorb
    if (method === 'PATCH' && m) {
      const id = decodeURIComponent(m[1]);
      if (!exists(id)) return json(404, { error: { message: `File not found: ${id}.` } });
      Object.assign(state.files[id], JSON.parse(init.body));
      return json(200, { id });
    }
    return json(400, { error: { message: `Nicht nachgebaut: ${method} ${url.pathname}` } });
  } finally {
    save();
  }
};
