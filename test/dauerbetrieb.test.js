'use strict';
/*
 * Dauerbetrieb (Render Free): Jede Änderung landet im (nachgebauten) Google Drive, jeder Neustart holt alles zurück.
 * Mehrere Server-Instanzen teilen sich ein Drive – wie bei Render, wo ein Deploy eine neue Instanz startet.
 *  - Einrichtung: ohne Google wartet die Live-Sicherung, nach dem Verbinden: Ordner, Gesamtstand, Journale, Schlüssel
 *  - Deploy: neue Instanz übernimmt von der alten (die lehnt danach Änderungen mit „bitte wiederholen“ ab), nichts fehlt
 *  - Absturz (SIGKILL): neue Instanz hat jede Änderung bis kurz davor, auch Bilder (bei Bedarf sofort nachgeladen)
 *  - Drive beim Start nicht erreichbar: keine leere Datenbank, Warteseite, danach vollständig
 *  - gelöschte Bilder bleiben im Drive, Speicherwächter räumt bei knappem Drive auf und warnt, Wecker wird erkannt
 *  - Ohne Schlüssel gestartet, aber Daten im Drive: nichts wird überschrieben, Auswahl angeboten
 */
const { test, before, after } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');
const { createFakeDrive } = require('./fakeDrive');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, step = 150) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Zeitüberschreitung beim Warten');
    await sleep(step);
  }
}

let fd;
let fast;
const servers = [];
const start = async (env = {}) => {
  const s = await startServer({ env: { ...fast, ...env } });
  servers.push(s);
  return s;
};
const login = async (s) => {
  const c = client(s.base);
  await c.login(TEAM.admin);
  return c;
};
const data = {};

before(async () => {
  fd = createFakeDrive();
  await fd.start();
  fast = { DAUERBETRIEB: '1', DAUER_JOURNAL_MS: '250', DAUER_LEASE_MS: '1000', DAUER_SCAN_MS: '400', DAUER_PING_MS: '600000', DAUER_HANDOVER_MS: '8000', DAUER_GUARD_MS: '600000', DAUER_TAKEOVER_MS: '4000', ...fd.env() };
});
after(async () => {
  for (const s of servers) await s.stop().catch(() => {});
  await fd.close();
});

test('Einrichtung: ohne Google wartet die Sicherung, nach dem Verbinden ist jede Änderung im Drive', async () => {
  const A = await start();
  data.A = A;
  const adm = await login(A);
  let st = await adm.get('/api/dauer');
  assert.equal(st.status, 200);
  assert.equal(st.json.enabled, true);
  assert.equal(st.json.live.live, 'wartet-auf-google');
  assert.equal(st.json.recovery.set, false);
  // Wecker antwortet ohne Anmeldung und wird erkannt
  const ping = await fetch(`${A.base}/api/ping?src=cron`);
  assert.equal(await ping.text(), 'ok');
  // Google verbinden (wie im Dashboard)
  const go = await adm.get('/api/google/connect');
  await adm.get(`/api/google/callback?code=abc&state=${new URL(go.location).searchParams.get('state')}`);
  st = await until(async () => {
    const r = await adm.get('/api/dauer');
    return r.json.live.running && r.json;
  });
  assert.equal(st.wake.external.src, 'cron');
  assert.equal(fd.byKind('dauer-root').length, 1);
  assert.equal(fd.byKind('base').length, 1, 'erster Gesamtstand liegt im Drive');
  // Arbeit: Akte, Notiz, Profilbild
  const me = (await adm.get('/api/auth/session')).json.user;
  const c = await adm.post('/api/cases', { title: 'Dauer-Akte 1', area: 'strafrecht', clientName: 'Max Muster', lawyerId: me.id });
  assert.equal(c.status, 201);
  data.caseId = c.json.case.id;
  assert.equal((await adm.post(`/api/cases/${data.caseId}/notes`, { body: 'Zeugenaussage Bankraub am Hafen', internal: true })).status, 201);
  const av = await adm.upload('/api/auth/avatar', PNG, 'image/png');
  assert.equal(av.status, 200);
  data.avatar = av.json.user.avatarUrl;
  assert.match(data.avatar, /^\/media\/avatars\//);
  await until(() => fd.byKind('journal').length >= 2 && fd.byKind('file').length === 1);
  // jedes Paket und jedes Bild ist verschlüsselt
  for (const f of [...fd.byKind('journal'), ...fd.byKind('file'), ...fd.byKind('base')]) assert.equal(f.content.subarray(0, 4).toString(), 'PSE1');
  assert.ok(!fd.byKind('file')[0].content.includes(PNG.subarray(8)), 'Bild liegt nicht im Klartext im Drive');
  // Schlüssel für Render (nur Inhaber/Web-Admins) und Probelauf
  const k = await adm.post('/api/dauer/schluessel', {});
  assert.equal(k.status, 200);
  assert.match(k.json.key, /^PSD1\./);
  data.key = k.json.key;
  const anwalt = client(A.base);
  await anwalt.login(TEAM.anwalt);
  assert.notEqual((await anwalt.post('/api/dauer/schluessel', {})).status, 200, 'Anwalt ohne Rechte sieht den Schlüssel nicht');
  const probe = await adm.post('/api/dauer/probe', {});
  assert.equal(probe.status, 200, JSON.stringify(probe.json));
  assert.equal(probe.json.probe.ok, true, JSON.stringify(probe.json.probe));
  data.adm = adm;
});

test('Deploy: neue Instanz übernimmt nahtlos, die alte nimmt keine Änderungen mehr an', async () => {
  const A = data.A;
  // Änderung direkt vor dem Deploy
  assert.equal((await data.adm.post(`/api/cases/${data.caseId}/notes`, { body: 'Letzte Notiz vor dem Update', internal: true })).status, 201);
  const B = await start({ DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: A.base });
  data.B = B;
  // alte Instanz: Änderungen → 503 mit „bitte wiederholen“, Lesen geht
  const w = await data.adm.post(`/api/cases/${data.caseId}/notes`, { body: 'zu spät', internal: true });
  assert.equal(w.status, 503);
  assert.equal(w.headers.get('x-ps-retry'), '1');
  assert.equal((await data.adm.get(`/api/cases/${data.caseId}`)).status, 200);
  // neue Instanz: gleiche Sitzung gilt weiter (niemand muss sich neu anmelden), alles da
  const same = await (await fetch(`${B.base}/api/auth/session`, { headers: { Cookie: data.adm.cookie(), Accept: 'application/json' } })).json();
  assert.equal(same.user && same.user.email, TEAM.admin, 'Sitzung aus der alten Instanz gilt weiter');
  const b = await login(B);
  const st = (await b.get('/api/dauer')).json;
  assert.equal(st.restore.mode, 'wiederhergestellt');
  assert.equal(st.predecessor.handover, 'direkt');
  const kase = await b.get(`/api/cases/${data.caseId}`);
  assert.equal(kase.status, 200);
  const notes = JSON.stringify(kase.json);
  assert.match(notes, /Letzte Notiz vor dem Update/);
  assert.doesNotMatch(notes, /zu spät/);
  // Volltextsuche funktioniert auch nach dem Wiederherstellen
  const search = await b.get('/api/search?q=Bankraub');
  if (search.status === 200) assert.match(JSON.stringify(search.json), /Bankraub|Dauer-Akte/);
  // Bild kommt aus dem Drive zurück (byte-genau)
  const img = await fetch(`${B.base}${data.avatar}`);
  assert.equal(img.status, 200);
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(PNG));
  await A.stop();
  data.b = b;
});

test('Absturz (SIGKILL): die nächste Instanz hat jede Änderung bis kurz davor', async () => {
  const B = data.B;
  const b = data.b;
  const me = (await b.get('/api/auth/session')).json.user;
  const c2 = await b.post('/api/cases', { title: 'Akte kurz vor dem Absturz', area: 'strafrecht', clientName: 'Erika', lawyerId: me.id });
  assert.equal(c2.status, 201);
  const att = await b.upload(`/api/cases/${c2.json.case.id}/attachments?caption=Beweis`, PNG, 'image/png');
  assert.equal(att.status, 201, JSON.stringify(att.json));
  data.case2 = c2.json.case.id;
  data.att = att.json.attachment.id;
  // Jede Aktion geht direkt nach der Antwort ins Drive – kurz warten, bis Paket und Bild oben sind
  await until(async () => {
    const s = (await b.get('/api/dauer')).json;
    return s.live.queue === 0 && s.files.files >= 2;
  });
  await sleep(300); // auch der Verzeichnis-Eintrag des Bildes (nach dessen Upload) ist ein eigenes Paket
  await until(async () => (await b.get('/api/dauer')).json.live.queue === 0);
  await B.kill('SIGKILL');
  const C = await start({ DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: B.base });
  data.C = C;
  const c = await login(C);
  const st = (await c.get('/api/dauer')).json;
  assert.equal(st.restore.mode, 'wiederhergestellt');
  assert.notEqual(st.predecessor && st.predecessor.handover, 'direkt');
  const k = await c.get(`/api/cases/${data.case2}`);
  assert.equal(k.status, 200, `Akte fehlt nach dem Absturz: ${JSON.stringify(st.restore)}\n${C.log().slice(-2500)}`);
  assert.equal(k.json.case.title, 'Akte kurz vor dem Absturz');
  // Beweisbild wird beim ersten Aufruf sofort aus dem Drive geholt
  const file = await c.get(`/api/cases/${data.case2}/attachments/${data.att}/file`);
  assert.equal(file.status, 200, `Beweisbild fehlt: ${file.text}\n${C.log().slice(-1500)}`);
  data.c = c;
});

test('gelöschte Bilder bleiben 30 Tage im Drive', async () => {
  const c = data.c;
  await until(async () => (await c.get('/api/dauer')).json.files.files >= 2);
  const before = fd.byKind('file').length;
  assert.equal((await c.del('/api/auth/avatar')).status, 200);
  const st = await until(async () => {
    const s = (await c.get('/api/dauer')).json;
    return s.files.deleted >= 1 && s;
  });
  assert.equal(st.files.deleted, 1);
  assert.equal(fd.byKind('file').length, before, 'Datei im Drive noch da');
});

test('Drive beim Start nicht erreichbar: keine leere Datenbank, danach vollständig', async () => {
  const C = data.C;
  await sleep(600); // letzte Pakete hoch
  await C.kill('SIGTERM'); // geordnet: letzter Stand hoch, Freigabe
  const maxGen = () => Math.max(...fd.byKind('base').map((f) => Number(f.appProperties.gen)));
  const genBefore = maxGen();
  fd.ctl.down = true;
  setTimeout(() => (fd.ctl.down = false), 3500);
  const D = await start({ DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: C.base });
  const d = await login(D);
  const k = await d.get(`/api/cases/${data.case2}`);
  assert.equal(k.status, 200, 'Daten nach dem Ausfall vollständig');
  assert.ok(/Daten werden geladen|Drive/.test(D.log()), 'hat gewartet statt leer zu starten');
  assert.equal(maxGen(), genBefore + 1, 'genau ein neuer Gesamtstand (nach der Wiederherstellung), keiner davor');
  data.D = D;
  data.d = d;
});

test('Deploy bricht nach der Übergabe ab: die bisherige Instanz arbeitet weiter, nichts geht verloren', async () => {
  const D = data.D;
  const d = data.d;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-abbruch-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...fast, PORT: String(await freePort()), DB_PATH: path.join(dir, 'x.db'), NODE_ENV: 'test', DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: D.base, DAUER_TEST_ABBRUCH: 'nach-uebergabe' },
    stdio: 'ignore',
  });
  const code = await new Promise((r) => child.once('exit', r));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 3, 'neue Instanz bricht nach der Übergabe ab');
  // alte Instanz ist eingefroren …
  const me = (await d.get('/api/auth/session')).json.user;
  const frozen = await d.post('/api/cases', { title: 'während des Abbruchs', area: 'strafrecht', clientName: 'Xaver Test', lawyerId: me.id });
  assert.equal(frozen.status, 503);
  // … und nimmt nach ein paar Sekunden ohne Lebenszeichen wieder Änderungen an
  const ok = await until(async () => {
    const r = await d.post('/api/cases', { title: 'nach dem Abbruch', area: 'strafrecht', clientName: 'Xaver Test', lawyerId: me.id });
    return r.status === 201 && r;
  }, 20000, 500);
  assert.equal(ok.json.case.title, 'nach dem Abbruch');
  const st = (await d.get('/api/dauer')).json;
  assert.equal(st.live.frozen, false);
  assert.equal(st.live.running, true);
  await until(async () => (await d.get('/api/dauer')).json.live.queue === 0);
  data.afterAbort = ok.json.case.id;
});

test('Speicherwächter: knappes Drive → aufräumen, Tagessicherungen pausieren, Warnung', async () => {
  const d = data.d;
  // ganzes Drive fast voll: nur noch 100 MB frei (Reserve 500 MB)
  fd.ctl.quota.extraUsage = fd.ctl.quota.limit - 100 * 1024 * 1024;
  const r = await d.post('/api/dauer/pruefen', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.guard.tight, true);
  assert.equal(r.json.guard.lowDrive, true);
  // Live-Sicherung läuft trotzdem weiter
  const me = (await d.get('/api/auth/session')).json.user;
  assert.equal((await d.post('/api/cases', { title: 'trotz vollem Drive', area: 'strafrecht', clientName: 'Xaver Test', lawyerId: me.id })).status, 201);
  await until(async () => (await d.get('/api/dauer')).json.live.queue === 0);
  fd.ctl.quota.extraUsage = 0;
  const ok = await d.post('/api/dauer/pruefen', {});
  assert.equal(ok.json.guard.tight, false);
  // Obergrenze einstellen
  assert.equal((await d.put('/api/dauer/einstellungen', { budgetMb: 50 })).status, 400);
  const set = await d.put('/api/dauer/einstellungen', { budgetMb: 3000 });
  assert.equal(set.json.budgetMb, 3000);
});

test('nach dem abgebrochenen Deploy: die nächste Instanz hat auch die späteren Änderungen', async () => {
  const D = data.D;
  await D.kill('SIGTERM');
  const F = await start({ DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: D.base });
  const f = await login(F);
  const k = await f.get(`/api/cases/${data.afterAbort}`);
  assert.equal(k.status, 200);
  assert.equal(k.json.case.title, 'nach dem Abbruch');
  data.F = F;
  data.f = f;
});

test('Sicherung einspielen: die nächste Instanz startet mit genau dieser Sicherung', async () => {
  const { F, f } = data;
  const b = await f.post('/api/admin/backups', {});
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const me = (await f.get('/api/auth/session')).json.user;
  const later = await f.post('/api/cases', { title: 'nach der Sicherung', area: 'strafrecht', clientName: 'Xaver Test', lawyerId: me.id });
  assert.equal(later.status, 201);
  assert.equal((await f.post(`/api/admin/backups/${encodeURIComponent(b.json.backup.name)}/restore`, {})).status, 200);
  await F.kill('SIGTERM'); // Neustart: die vorgemerkte Sicherung geht als neuer Stand ins Drive
  const G = await start({ DAUERBETRIEB_SCHLUESSEL: data.key, DAUER_SELF_URL: F.base });
  const g = await login(G); // Sicherungen enthalten keine Sitzungen – neu anmelden
  assert.equal((await g.get(`/api/cases/${later.json.case.id}`)).status, 404, 'Änderung nach der Sicherung ist weg');
  assert.equal((await g.get(`/api/cases/${data.afterAbort}`)).status, 200, 'Stand der Sicherung ist da');
  await G.stop();
});

test('ohne Schlüssel gestartet, aber Daten im Drive: nichts wird überschrieben', async () => {
  const activeBefore = fd.byKind('dauer-root')[0].appProperties.active;
  const E = await start({ DAUER_SELF_URL: 'http://127.0.0.1:9' });
  const e = await login(E);
  const go = await e.get('/api/google/connect');
  await e.get(`/api/google/callback?code=abc&state=${new URL(go.location).searchParams.get('state')}`);
  const st = await until(async () => {
    const r = (await e.get('/api/dauer')).json;
    return r.live.running && r;
  });
  assert.ok(st.live.conflict, 'anderer Stand wird gemeldet');
  assert.equal(st.live.conflict.lin, activeBefore);
  assert.equal(fd.byKind('dauer-root')[0].appProperties.active, activeBefore, 'aktiver Stand bleibt');
  const lines = (await e.get('/api/dauer/linien')).json.lines;
  assert.ok(lines.some((l) => l.lin === activeBefore) && lines.some((l) => l.mine));
  await E.stop();
});
