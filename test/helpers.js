'use strict';
/*
 * Test-Helfer: startet den Server mit einer frischen Datenbank in einem Temp-Ordner auf einem freien Port.
 * Ohne Discord-, FiveNet- oder Google-Zugangsdaten – während der Tests geht nichts nach außen.
 * Die drei Team-Konten bekommen über ADMIN_PASSWORD / SEED_*_PASSWORD ein festes Test-Passwort.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'Test-Passwort-2026!';
const TEAM = {
  admin: 'alois.pake@pake-scha.ls', // Founding Partner (Board of Partners)
  partner: 'michael.scha@pake-scha.ls', // Founding Partner (Board of Partners)
  anwalt: 'damat.lex@pake-scha.ls', // Senior Associate (kein Board)
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * opts.env: zusätzliche Umgebungsvariablen · opts.preload: Module, die vor dem Server geladen werden
 * (z. B. test/googleStub.js – nachgebaute Google-Schnittstelle).
 */
async function startServer(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-test-'));
  const port = await freePort();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(DISCORD_|FIVENET_|GOOGLE_|ADMIN_|SEED_)/.test(key)) delete env[key];
  Object.assign(env, {
    PORT: String(port),
    DB_PATH: path.join(dir, 'test.db'),
    NODE_ENV: 'test',
    ADMIN_PASSWORD: PASSWORD,
    SEED_SCHA_PASSWORD: PASSWORD,
    SEED_LEX_PASSWORD: PASSWORD,
    ...(opts.env || {}),
  });
  const args = [...(opts.preload || []).flatMap((m) => ['--require', m]), 'server.js'];
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`Server ist beim Start beendet worden:\n${log}`);
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {
      /* startet noch */
    }
    if (i > 150) throw new Error(`Server startet nicht:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    dir,
    log: () => log,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => child.once('exit', r));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Kleiner API-Client mit eigener Sitzung (alle Cookies, z. B. „sid“). */
function client(base) {
  const jar = {};
  async function call(method, url, body, headers = {}) {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(Object.keys(jar).length ? { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(i + 1)) jar[pair.slice(0, i)] = pair.slice(i + 1);
      else delete jar[pair.slice(0, i)];
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keine JSON-Antwort */
    }
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), json, text };
  }
  return {
    get: (url, headers) => call('GET', url, undefined, headers),
    post: (url, body = {}, headers) => call('POST', url, body, headers),
    patch: (url, body = {}) => call('PATCH', url, body),
    put: (url, body = {}) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
    /** Rohdaten senden, z. B. ein Bild: upload('/api/cases/1/attachments', buffer, 'image/png') */
    upload: (url, buffer, type) => call('POST', url, buffer, { 'Content-Type': type }),
    async login(email, password = PASSWORD) {
      const r = await call('POST', '/api/auth/login', { email, password });
      assert.equal(r.status, 200, `Anmeldung von ${email}: ${r.text}`);
      return r.json.user;
    },
  };
}

/** Eine Datei aus einem ZIP (z. B. word/document.xml aus einer DOCX) – ohne Zusatzpaket. */
function readZipEntry(buf, name) {
  const zlib = require('node:zlib');
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    }
    p += 46 + nameLen + extra + comment;
  }
  return null;
}

/** Text einer DOCX (Absätze als Zeilen). */
function docxText(buf) {
  return String(readZipEntry(buf, 'word/document.xml') || '')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

module.exports = { ROOT, PASSWORD, TEAM, startServer, client, readZipEntry, docxText };
