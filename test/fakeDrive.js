'use strict';
/*
 * Nachgebautes Google (Anmeldung + Drive) als echter HTTP-Server im Testprozess – für den Dauerbetrieb, bei dem
 * mehrere Server-Instanzen nacheinander bzw. gleichzeitig DASSELBE Drive benutzen. Die Server bekommen
 * GOOGLE_API_BASE und GOOGLE_OAUTH_BASE auf diese Adresse gesetzt.
 *
 * Nachgebaut: Token (authorization_code, refresh_token), Dateien anlegen (Metadaten, multipart, resumable in Stücken),
 * auflisten mit q (in parents, trashed, name, mimeType, appProperties has {…}), Metadaten lesen/ändern, Inhalt laden
 * (alt=media), endgültig löschen, Freigaben, about.storageQuota.
 * Störungen: ctl.down (alles 503), ctl.failUploads, ctl.full (403 storageQuotaExceeded), ctl.quota { limit, extraUsage }.
 */
const http = require('http');
const crypto = require('crypto');

function createFakeDrive({ refreshToken = 'rt-dauer-test' } = {}) {
  const files = new Map();
  const sessions = new Map();
  const ctl = { down: false, failUploads: false, full: false, quota: { limit: 15 * 1024 ** 3, extraUsage: 0 } };
  const calls = [];
  let seq = 0;
  let base = '';
  const now = () => new Date(Date.now() + seq).toISOString(); // streng steigend
  const usage = () => [...files.values()].reduce((n, f) => n + (f.content ? f.content.length : 0), 0) + ctl.quota.extraUsage;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const view = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, size: String(f.content ? f.content.length : 0), createdTime: f.createdTime, modifiedTime: f.modifiedTime, appProperties: f.appProperties, webViewLink: `https://docs.google.com/document/d/${f.id}/edit` });

  function create(meta, content) {
    if (meta.parents && !meta.parents.every((p) => files.has(p))) return null;
    const id = `f${++seq}${crypto.randomBytes(3).toString('hex')}`;
    const t = now();
    const f = { id, name: meta.name || 'ohne Namen', mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || [], appProperties: { ...(meta.appProperties || {}) }, content: content || null, createdTime: t, modifiedTime: t, permissions: [] };
    files.set(id, f);
    return f;
  }

  /** q: Bedingungen mit „and“, appProperties has { key='a' and value='b' } */
  function matcher(q) {
    const conds = [];
    let rest = String(q || '').replace(/appProperties has \{ key='((?:\\'|[^'])*)' and value='((?:\\'|[^'])*)' \}/g, (_, k, v) => {
      const key = k.replace(/\\'/g, "'");
      const val = v.replace(/\\'/g, "'");
      conds.push((f) => f.appProperties[key] === val);
      return 'TRUE';
    });
    for (const part of rest.split(' and ').map((x) => x.trim())) {
      let m;
      if (part === 'TRUE' || !part) continue;
      if ((m = /^'((?:\\'|[^'])*)' in parents$/.exec(part))) {
        const id = m[1];
        conds.push((f) => f.parents.includes(id));
      } else if (part === 'trashed = false') conds.push(() => true);
      else if ((m = /^mimeType = '((?:\\'|[^'])*)'$/.exec(part))) {
        const v = m[1];
        conds.push((f) => f.mimeType === v);
      } else if ((m = /^name = '((?:\\'|[^'])*)'$/.exec(part))) {
        const v = m[1].replace(/\\'/g, "'");
        conds.push((f) => f.name === v);
      } else throw new Error(`Nicht nachgebaute Suche: ${part}`);
    }
    return (f) => conds.every((c) => c(f));
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }

  function multipart(buf, type) {
    const boundary = /boundary=([^;]+)/.exec(type)[1];
    const parts = buf.toString('latin1').split(`--${boundary}`).slice(1, -1);
    const out = parts.map((p) => {
      const i = p.indexOf('\r\n\r\n');
      return Buffer.from(p.slice(i + 4, -2), 'latin1');
    });
    return { meta: JSON.parse(out[0].toString('utf8')), media: out[1] };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    calls.push(`${req.method} ${url.pathname}`);
    try {
      if (ctl.down) return send(res, 503, { error: { message: 'Backend Error' } });
      if (url.pathname === '/token') {
        const p = new URLSearchParams((await body(req)).toString());
        if (p.get('grant_type') === 'authorization_code') {
          return send(res, 200, {
            access_token: `at-${++seq}`,
            expires_in: 3599,
            refresh_token: refreshToken,
            scope: 'openid email https://www.googleapis.com/auth/drive.file',
            id_token: `x.${Buffer.from(JSON.stringify({ email: 'kanzlei@example.org' })).toString('base64url')}.x`,
          });
        }
        if (p.get('refresh_token') !== refreshToken) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: `at-${++seq}`, expires_in: 3599 });
      }
      if (url.pathname === '/revoke') return send(res, 200, {});
      if (!/^Bearer at-\d+$/.test(req.headers.authorization || '')) return send(res, 401, { error: { message: 'unauthenticated' } });

      // Upload: Sitzung fortsetzen
      if (req.method === 'PUT' && url.searchParams.get('upload_id')) {
        const s = sessions.get(url.searchParams.get('upload_id'));
        if (!s) return send(res, 404, { error: { message: 'Sitzung unbekannt' } });
        if (ctl.failUploads) return send(res, 503, { error: { message: 'Backend Error' } });
        const chunk = await body(req);
        s.data = Buffer.concat([s.data, chunk]);
        if (s.data.length < s.length) return send(res, 308, undefined, { Range: `bytes=0-${s.data.length - 1}` });
        sessions.delete(url.searchParams.get('upload_id'));
        if (ctl.full) return send(res, 403, { error: { message: 'The user\'s Drive storage quota has been exceeded.' } });
        const f = create(s.meta, s.data);
        if (!f) return send(res, 404, { error: { message: 'Ordner fehlt' } });
        return send(res, 200, view(f));
      }
      if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        const type = url.searchParams.get('uploadType');
        const buf = await body(req);
        if (ctl.failUploads) return send(res, 503, { error: { message: 'Backend Error' } });
        if (type === 'resumable') {
          const id = `u${++seq}`;
          sessions.set(id, { meta: JSON.parse(buf.toString() || '{}'), length: Number(req.headers['x-upload-content-length']), data: Buffer.alloc(0) });
          return send(res, 200, {}, { Location: `${base}/upload/drive/v3/files?upload_id=${id}` });
        }
        if (ctl.full) return send(res, 403, { error: { message: 'The user\'s Drive storage quota has been exceeded.' } });
        const { meta, media } = multipart(buf, req.headers['content-type']);
        const f = create(meta, media);
        if (!f) return send(res, 404, { error: { message: 'Ordner fehlt' } });
        return send(res, 200, view(f));
      }
      let m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (m && req.method === 'PATCH') {
        const f = files.get(decodeURIComponent(m[1]));
        if (!f) return send(res, 404, { error: { message: 'File not found' } });
        const { meta, media } = multipart(await body(req), req.headers['content-type']);
        Object.assign(f, { name: meta.name || f.name, content: media, modifiedTime: now() });
        return send(res, 200, view(f));
      }
      if (url.pathname === '/drive/v3/about') {
        return send(res, 200, { storageQuota: { limit: String(ctl.quota.limit), usage: String(usage()) }, user: { emailAddress: 'kanzlei@example.org' } });
      }
      if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
        const match = matcher(url.searchParams.get('q'));
        return send(res, 200, { files: [...files.values()].filter(match).map(view) });
      }
      if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
        const meta = JSON.parse((await body(req)).toString() || '{}');
        const f = create(meta, null);
        if (!f) return send(res, 404, { error: { message: 'Ordner fehlt' } });
        return send(res, 200, view(f));
      }
      m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(url.pathname);
      if (m) {
        const f = files.get(decodeURIComponent(m[1]));
        if (!f) return send(res, 404, { error: { message: 'File not found' } });
        f.permissions.push(JSON.parse((await body(req)).toString()));
        return send(res, 200, { id: `p${++seq}` });
      }
      m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const f = files.get(decodeURIComponent(m[1]));
        if (!f) return send(res, 404, { error: { message: 'File not found' } });
        if (req.method === 'GET') {
          if (url.searchParams.get('alt') === 'media') {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            return res.end(f.content || Buffer.alloc(0));
          }
          return send(res, 200, view(f));
        }
        if (req.method === 'PATCH') {
          const meta = JSON.parse((await body(req)).toString() || '{}');
          if (meta.appProperties) for (const [k, v] of Object.entries(meta.appProperties)) v === null ? delete f.appProperties[k] : (f.appProperties[k] = String(v));
          if (meta.name) f.name = meta.name;
          if (meta.trashed) files.delete(f.id);
          f.modifiedTime = now();
          return send(res, 200, view(f));
        }
        if (req.method === 'DELETE') {
          files.delete(f.id);
          return send(res, 204);
        }
      }
      return send(res, 400, { error: { message: `Nicht nachgebaut: ${req.method} ${url.pathname}` } });
    } catch (err) {
      return send(res, 500, { error: { message: err.message } });
    }
  });

  return {
    ctl,
    files,
    calls,
    refreshToken,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${server.address().port}`;
      return base;
    },
    get base() {
      return base;
    },
    env() {
      return { GOOGLE_API_BASE: base, GOOGLE_OAUTH_BASE: base, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret-dauer' };
    },
    byKind(kind) {
      return [...files.values()].filter((f) => f.appProperties.ps === kind);
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { createFakeDrive };
