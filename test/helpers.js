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

async function startServer() {
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
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

/** Kleiner API-Client mit eigener Sitzung (Cookie „sid“). */
function client(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(0, i) === 'sid') cookie = pair.slice(i + 1) ? pair : '';
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keine JSON-Antwort */
    }
    return { status: res.status, headers: res.headers, json, text };
  }
  return {
    get: (url, headers) => call('GET', url, undefined, headers),
    post: (url, body = {}, headers) => call('POST', url, body, headers),
    patch: (url, body = {}) => call('PATCH', url, body),
    put: (url, body = {}) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
    async login(email, password = PASSWORD) {
      const r = await call('POST', '/api/auth/login', { email, password });
      assert.equal(r.status, 200, `Anmeldung von ${email}: ${r.text}`);
      return r.json.user;
    },
  };
}

module.exports = { ROOT, PASSWORD, TEAM, startServer, client };
