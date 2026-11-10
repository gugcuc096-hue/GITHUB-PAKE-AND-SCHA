'use strict';
/*
 * Start im Dauerbetrieb – läuft, bevor die Datenbank geöffnet wird:
 *  1. Der Server nimmt sofort Verbindungen an: /api/ping antwortet (Wecker), /api/health meldet „noch nicht bereit“
 *     (Render leitet bei einem Deploy so lange weiter alles an die alte Instanz), Seiten zeigen eine Warteseite,
 *     Änderungen bekommen 503 mit „bitte wiederholen“ (das Dashboard wiederholt sie von selbst).
 *  2. Übergabe: Die neue Instanz bittet die alte über die eigene öffentliche Adresse, keine Änderungen mehr
 *     anzunehmen und ihren letzten Stand hochzuladen (signiert mit dem Datenschlüssel). Ist die alte nicht
 *     erreichbar, aber laut Herzschlag im Drive noch am Leben, legt die neue einen „Anspruch“ ab und wartet.
 *  3. Wiederherstellung: neuester Gesamtstand + alle Journale → Datenbank. Erst danach öffnet die App die Datenbank.
 *
 * Sicherheitsregel: Gibt es einen Schlüssel, aber das Drive ist nicht erreichbar, startet der Server NIE mit einer
 * leeren Datenbank – er versucht es weiter (die Warteseite bleibt). Eine leere Datenbank dürfte sonst den echten
 * Stand im Drive überholen.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const cfg = require('./config');
const state = require('./state');
const pack = require('./pack');
const drive = require('./gdrive');
const store = require('./store');

let server = null;
let handler = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (k, text) => crypto.createHmac('sha256', k).update(text).digest('hex');

function setPhase(phase, text) {
  state.phase = phase;
  state.phaseText = text;
  if (phase !== 'bereit') console.log(`Dauerbetrieb: ${text}`);
}

/* ---------------------------------------------------------------- Warteseite */
const WAIT_HTML = (text) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="4"><title>Pake &amp; Scha – einen Moment</title>
<style>html,body{margin:0;height:100%;background:#050a18;color:#e5e7eb;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{min-height:100%;display:grid;place-items:center;text-align:center;padding:24px;box-sizing:border-box}
h1{font:600 1.6rem Georgia,serif;color:#f3e5ab;margin:18px 0 6px}p{color:#94a3b8;margin:0;max-width:30rem}
.ring{width:46px;height:46px;margin:auto;border-radius:50%;border:3px solid rgba(201,164,92,.2);border-top-color:#c9a45c;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.ring{animation:none}}</style></head>
<body><main><div><div class="ring" aria-hidden="true"></div><h1>Die Kanzlei startet gerade</h1><p>${text}</p><p style="margin-top:10px;font-size:.85rem">Die Seite lädt von selbst neu – Ihre Daten sind sicher.</p></div></main></body></html>`;

function warmHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ping') {
    require('./wach').record(req, url);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('ok');
  }
  if (url.pathname === '/api/health') {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '5' });
    return res.end(JSON.stringify({ ok: false, phase: state.phase, message: state.phaseText, error: state.bootError }));
  }
  if (url.pathname === '/api/dauer/uebergabe') {
    // Landet die Bitte um Übergabe bei uns selbst, gibt es keine laufende Vorgängerin
    res.writeHead(409, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ self: true, instance: state.instance }));
  }
  const html = req.method === 'GET' && /text\/html/.test(req.headers.accept || '');
  res.writeHead(503, {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    'Retry-After': '4',
    'X-PS-Retry': '1', // nicht verarbeitet – darf wiederholt werden
  });
  res.end(html ? WAIT_HTML(state.phaseText) : JSON.stringify({ error: 'Der Server startet gerade und lädt die Daten – bitte einen Moment.', retry: true }));
}

/* ---------------------------------------------------------------- Übergabe */
async function askPredecessor(k) {
  const base = cfg.selfUrl();
  if (!base) return null;
  const ts = Date.now();
  try {
    const res = await fetch(`${base}/api/dauer/uebergabe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PS-Instance': state.instance },
      body: JSON.stringify({ from: state.instance, ts, sig: sign(k, `uebergabe|${ts}|${state.instance}`) }),
      signal: AbortSignal.timeout(cfg.HANDOVER_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.instance && data.instance !== state.instance) return data;
  } catch {
    /* keine laufende Vorgängerin erreichbar */
  }
  return null;
}

/** Vorgängerin lebt laut Herzschlag, war aber nicht erreichbar: Anspruch ablegen und auf die Freigabe warten. */
async function waitForLease(root) {
  const s = await store.scan(root.id);
  const lease = s.lease && s.lease.appProperties;
  if (!lease || lease.owner === state.instance) return { lease: null };
  const at = Date.parse(lease.at || 0) || 0;
  const info = { lease: { owner: lease.owner, state: lease.state, at: lease.at } };
  const stale = () => Date.now() - at > cfg.LEASE_MS * 3 + 5000;
  if (lease.state === 'released' || stale()) return info;
  setPhase('wiederherstellen', 'Die bisherige Instanz läuft noch – sie übergibt gleich ihren letzten Stand …');
  await startClaimBeat(root);
  const until = Date.now() + cfg.LEASE_MS * 3 + 15000;
  while (Date.now() < until) {
    await sleep(Math.min(2000, cfg.LEASE_MS / 2));
    const now = await drive.meta(s.lease.id).catch(() => null);
    const p = now && now.appProperties;
    if (!p || p.state === 'released' || p.owner === state.instance) return { lease: p ? { owner: p.owner, state: p.state, at: p.at } : info.lease, released: true };
    if (Date.now() - (Date.parse(p.at || 0) || 0) > cfg.LEASE_MS * 3 + 5000) return info; // eingeschlafen/abgestürzt
  }
  return info;
}

/** Anspruch mit Herzschlag ablegen (bis die Live-Sicherung ihn nach dem Start löscht). */
async function startClaimBeat(root) {
  if (state.claimBeat) return; // läuft schon (zweiter Versuch)
  const at = () => new Date().toISOString();
  let id = null;
  try {
    const mine = await drive.list(`'${root.id}' in parents and trashed = false${drive.prop('ps', 'claim')}${drive.prop('inst', state.instance)}`);
    id = mine[0] ? mine[0].id : (await drive.uploadBuffer({ name: `anspruch-${state.instance}`, parent: root.id, appProperties: { ps: 'claim', inst: state.instance, at: at() }, data: Buffer.from('{}') })).id;
  } catch (err) {
    console.warn('Dauerbetrieb: Anspruch nicht abgelegt:', err.message);
    return;
  }
  const t = setInterval(() => drive.setProps(id, { at: at() }).catch(() => {}), Math.max(1000, Math.round(cfg.LEASE_MS / 2)));
  t.unref();
  state.claimBeat = { id, stop: () => clearInterval(t) };
}

/* ---------------------------------------------------------------- Wiederherstellung */
async function restore() {
  if (cfg.forceEmpty()) {
    state.restore = { mode: 'leer-erzwungen' };
    console.warn('Dauerbetrieb: DAUERBETRIEB_LEER_STARTEN=1 – Start ohne Wiederherstellung.');
    return;
  }
  const raw = cfg.recoveryKey();
  if (!raw) {
    state.restore = { mode: 'ohne-schluessel' };
    console.warn('Dauerbetrieb: Kein Wiederherstellungs-Schlüssel (DAUERBETRIEB_SCHLUESSEL) – Start mit der vorhandenen bzw. einer neuen Datenbank. Im Dashboard unter Einstellungen → Dauerbetrieb einrichten!');
    return;
  }
  const creds = pack.unsealRecovery(raw, cfg.clientSecret());
  state.creds = creds;
  drive.useRefreshToken(() => (state.creds ? state.creds.rt : null));
  setPhase('wiederherstellen', 'Verbindung zum Google Drive …');
  const root = await store.findRoot();
  if (!root) {
    state.restore = { mode: 'erststart' };
    return;
  }
  setPhase('wiederherstellen', 'Übergabe von der bisherigen Instanz …');
  const pred = await askPredecessor(creds.k);
  let leaseInfo = null;
  if (pred) {
    state.predecessor = { instance: pred.instance, handover: 'direkt', final: { lin: pred.lin, gen: pred.gen, seq: pred.seq } };
  } else {
    leaseInfo = await waitForLease(root);
    state.predecessor = leaseInfo.lease ? { instance: leaseInfo.lease.owner, handover: leaseInfo.released ? 'anspruch' : 'keine', lease: leaseInfo.lease } : null;
  }
  // Lebenszeichen, solange diese Instanz lädt: bleibt es aus (Start abgebrochen), arbeitet die alte Instanz weiter
  await startClaimBeat(root);
  if (process.env.NODE_ENV === 'test' && process.env.DAUER_TEST_ABBRUCH === 'nach-uebergabe') process.exit(3); // nur Tests: abgebrochener Deploy
  setPhase('wiederherstellen', 'Daten werden aus dem Google Drive geladen …');
  let s = await store.scan(root.id);
  let choice = store.pick(s, root.appProperties.active);
  // Die Vorgängerin hat ihren letzten Stand genannt – bis er sichtbar ist, kurz warten (Google listet mit Verzögerung)
  if (pred && choice && pred.lin === choice.lin) {
    for (let i = 0; i < 15 && (choice.base.gen < pred.gen || (choice.base.gen === pred.gen && choice.journals.length < pred.seq)); i++) {
      await sleep(1000);
      s = await store.scan(root.id);
      choice = store.pick(s, root.appProperties.active);
    }
  }
  if (!choice) {
    state.restore = { mode: 'erststart' };
    return;
  }
  fs.mkdirSync(path.dirname(cfg.DB_PATH), { recursive: true });
  const tries = [{ base: choice.base, journals: choice.journals }, ...choice.older];
  let lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    try {
      const info = await store.rebuild({ lin: choice.lin, ...tries[i] }, creds.k, cfg.DB_PATH, { log: console.log });
      state.restore = { mode: 'wiederhergestellt', ...info, fallback: i > 0 ? lastErr && lastErr.message : null, from: state.predecessor };
      return;
    } catch (err) {
      lastErr = err;
      console.error(`Dauerbetrieb: Stand ${choice.lin}/${tries[i].base.gen} nicht nutzbar: ${err.message}`);
      // Drive/Netz gestört oder falscher Schlüssel: neu versuchen statt auf einen älteren Stand auszuweichen –
      // ältere Stände nur, wenn der neueste nachweislich beschädigt ist
      if (err.status || err.code) throw err;
      if (/entschlüsseln/.test(err.message)) {
        const kid = tries[i].base.appProperties && tries[i].base.appProperties.kid;
        if (!kid || kid !== pack.keyId(creds.k)) throw new Error('Der Wiederherstellungs-Schlüssel in Render passt nicht zu den Daten im Google Drive (anderer Datenschlüssel). Bitte den aktuellen Schlüssel aus dem Dashboard eintragen.');
        // richtiger Schlüssel, Datei trotzdem nicht lesbar → beschädigt → nächstälterer Stand
      }
    }
  }
  throw lastErr || new Error('Kein nutzbarer Stand im Google Drive.');
}

/** Vor dem Laden der App: Warteseite öffnen und den Stand aus dem Drive holen (wiederholt, bis es klappt). */
async function prepare() {
  if (!cfg.enabled()) return;
  console.log(`Dauerbetrieb: ${cfg.mode().why} – Instanz ${state.instance}.`);
  const port = Number(process.env.PORT) || 3000;
  server = http.createServer((req, res) => (handler || warmHandler)(req, res));
  server.keepAliveTimeout = 65000; // länger als der Proxy davor
  server.headersTimeout = 66000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  for (let attempt = 0; ; attempt++) {
    try {
      await restore();
      state.bootError = null;
      return;
    } catch (err) {
      state.bootError = err.message;
      const wait = Math.min(60000, 2000 * 2 ** Math.min(attempt, 5));
      setPhase('wiederherstellen', `Daten werden geladen – erneuter Versuch in ${Math.round(wait / 1000)} s (${err.message})`);
      await sleep(wait);
    }
  }
}

/** Statt app.listen: im Dauerbetrieb die App in den schon offenen Server hängen, wenn die Live-Sicherung läuft. */
function listen(app, port, cb) {
  if (!server) {
    const s = app.listen(port, cb);
    return s;
  }
  setPhase('start-live', 'Die Daten sind geladen – gleich geht es los …');
  require('./live')
    .start()
    .catch((err) => console.error('Dauerbetrieb: Live-Sicherung startet nicht:', err.message))
    .finally(() => {
      handler = app;
      setPhase('bereit', 'bereit');
      if (cb) cb();
    });
  return server;
}

module.exports = { prepare, listen, sign, warmHandler };
