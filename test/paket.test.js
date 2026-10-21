'use strict';
/*
 * Saubere Adressen (ohne „.html“) samt Weiterleitung der alten, Start-Abruf /api/start, Passwörter mit scrypt
 * (alte bcrypt-Hashes werden beim Login umgestellt), Volltext-Suche in Notizen, Merkliste je Person, angepinnte
 * Notizen, @Erwähnungen, eingebettete Startseiten-Daten und das tägliche Aufräumen.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM } = require('./helpers');

let server;
let sql;
const as = {};
const data = {};

before(async () => {
  server = await startServer();
  sql = new DatabaseSync(path.join(server.dir, 'test.db'));
  for (const k of ['admin', 'partner', 'anwalt']) {
    as[k] = client(server.base);
    data[k] = await as[k].login(TEAM[k]);
  }
  as.mandant = client(server.base);
  assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'Mara Müller', email: 'mara.mueller', password: 'Mandanten-Passwort-5' })).status, 201);
  data.mandant = await as.mandant.login('mara.mueller', 'Mandanten-Passwort-5');
  data.caseId = (await as.admin.post('/api/cases', { title: 'Raub am Pillbox Hill', area: 'strafrecht', clientEmail: 'mara.mueller' })).json.case.id;
  data.otherId = (await as.admin.post('/api/cases', { title: 'Mietstreit Vespucci', area: 'zivilrecht', clientName: 'Paul Weber' })).json.case.id;
});
after(async () => {
  sql?.close();
  if (server) await server.stop();
});

describe('Saubere Adressen', () => {
  const page = (url) => client(server.base).get(url, { Accept: 'text/html' });

  it('neue Adressen liefern die Seiten direkt', async () => {
    for (const url of ['/', '/login', '/registrieren', '/karriere', '/bewerbung', '/dashboard', '/vertrag', '/rechnung', '/aktenauszug', '/offline']) {
      const r = await page(url);
      assert.equal(r.status, 200, `${url}: ${r.status}`);
      assert.match(r.headers.get('content-type'), /text\/html/, url);
    }
  });

  it('alte .html-Adressen leiten dauerhaft weiter – Abfrage und Sprungmarke bleiben erhalten', async () => {
    const map = {
      '/index.html': '/',
      '/login.html': '/login',
      '/register.html': '/registrieren',
      '/register': '/registrieren',
      '/karriere.html': '/karriere',
      '/bewerbung.html': '/bewerbung',
      '/dashboard.html': '/dashboard',
      '/vertrag.html?id=12': '/vertrag?id=12',
      '/invoice.html?id=5': '/rechnung?id=5',
      '/invoice?id=5': '/rechnung?id=5',
      '/aktenauszug.html?id=3': '/aktenauszug?id=3',
      '/offline.html': '/offline',
      '/Dashboard.html?case=4': '/dashboard?case=4',
    };
    for (const [from, to] of Object.entries(map)) {
      const r = await page(from);
      assert.equal(r.status, 301, `${from}: ${r.status}`);
      assert.equal(r.location, to, from);
    }
    // Unbekanntes bleibt 404, Dateien mit Endung (z. B. Bilder) werden nicht umgeleitet
    assert.equal((await page('/gibtsnicht.html')).status, 404);
    assert.equal((await page('/manifest.webmanifest')).status, 200);
  });

  it('Seiten, Bot-Texte und App verlinken nur noch die neuen Adressen', () => {
    const root = path.join(__dirname, '..');
    const files = [
      ...fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join('public', f)),
      ...fs.readdirSync(path.join(root, 'public/js')).filter((f) => f.endsWith('.js')).map((f) => path.join('public/js', f)),
      ...fs.readdirSync(path.join(root, 'public/js/dashboard')).map((f) => path.join('public/js/dashboard', f)),
      ...fs.readdirSync(root).filter((f) => f.endsWith('.js')).filter((f) => f !== 'server.js'),
      ...fs.readdirSync(path.join(root, 'routes')).map((f) => path.join('routes', f)),
      'public/sw.js',
    ];
    const old = /["'`(=]\/(index|login|register|karriere|bewerbung|dashboard|vertrag|invoice|aktenauszug)\.html\b/;
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      assert.doesNotMatch(text, old, `${f} enthält noch eine alte Adresse`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url.split('?')[0], '/dashboard');
    assert.equal(manifest.id, '/dashboard.html', 'die installierte App behält ihre Kennung');
    for (const s of manifest.shortcuts || []) assert.match(s.url, /^\/dashboard\b/);
  });
});

describe('Start-Abruf /api/start', () => {
  it('liefert Konto und alle Zähler in einem Abruf – je nach Rolle', async () => {
    const r = await as.admin.get('/api/start?today=2026-10-20');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.me.user.id, data.admin.id);
    for (const k of ['chatUnread', 'unread', 'duty', 'dueTasks', 'paymentReports', 'newApplications', 'nameOpen', 'resolutionOpen']) assert.ok(k in r.json.counts, `Board: ${k}`);
    const lawyer = (await as.anwalt.get('/api/start')).json.counts;
    assert.ok('dueTasks' in lawyer && !('newApplications' in lawyer), 'Anwalt: Kanzlei-Zähler, keine Board-Zähler');
    const m = (await as.mandant.get('/api/start')).json;
    assert.equal(m.me.user.id, data.mandant.id);
    assert.ok(!('dueTasks' in m.counts) && !('newApplications' in m.counts), 'Mandant: keine Kanzlei-Zähler');
    assert.ok(Array.isArray(m.counts.duty.onDuty), 'Mandant sieht nur, wer im Dienst ist');
  });

  it('nur die Zähler (me=0) und ohne Anmeldung 401', async () => {
    const r = await as.anwalt.get('/api/start?me=0');
    assert.equal(r.status, 200);
    assert.equal(r.json.me, undefined);
    assert.equal((await client(server.base).get('/api/start')).status, 401);
  });
});

describe('Passwörter', () => {
  it('neue Konten bekommen scrypt, ältere bcrypt-Hashes werden beim Login umgestellt', async () => {
    const hashOf = (id) => sql.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(id).h;
    assert.match(hashOf(data.mandant.id), /^scrypt\$16384\$8\$1\$/);
    sql.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync('Mandanten-Passwort-5', 4), data.mandant.id);
    const wrong = await client(server.base).post('/api/auth/login', { email: 'mara.mueller', password: 'falsch-falsch-1' });
    assert.equal(wrong.status, 401);
    assert.match(hashOf(data.mandant.id), /^\$2[aby]\$/, 'falsches Passwort ändert nichts');
    await client(server.base).login('mara.mueller', 'Mandanten-Passwort-5');
    assert.match(hashOf(data.mandant.id), /^scrypt\$/);
    await client(server.base).login('mara.mueller', 'Mandanten-Passwort-5');
  });
});

describe('Volltext-Suche', () => {
  it('findet Notizen über den Index – „mueller“ findet „Müller“, Wortanfänge zählen', async () => {
    assert.equal((await as.admin.post(`/api/cases/${data.caseId}/notes`, { body: 'Zeuge Günther Müller sah den Fluchtwagen am Pillbox Hill.', internal: true })).status, 201);
    const notes = async (who, q) => (await who.get(`/api/search?q=${encodeURIComponent(q)}`)).json.results.notes || [];
    assert.equal((await notes(as.admin, 'mueller')).length, 1);
    assert.equal((await notes(as.admin, 'Fluchtwa')).length, 1, 'Wortanfang');
    assert.equal((await notes(as.admin, 'günther fluchtwagen')).length, 1, 'mehrere Wörter');
    assert.equal((await notes(as.admin, 'Ballas')).length, 0);
    assert.equal((await notes(as.mandant, 'mueller')).length, 0, 'interne Notizen bleiben für Mandanten unsichtbar');
  });
});

describe('Merkliste, angepinnte Notizen, @Erwähnung', () => {
  it('Stern gilt nur für die eigene Person und kommt in Liste und Akte mit', async () => {
    assert.equal((await as.anwalt.put(`/api/cases/${data.otherId}/star`, { on: true })).status, 200);
    const starred = async (who) => (await who.get('/api/cases')).json.cases.filter((c) => c.starred).map((c) => c.id);
    assert.deepEqual(await starred(as.anwalt), [data.otherId]);
    assert.deepEqual(await starred(as.admin), [], 'andere sehen den Stern nicht');
    assert.equal((await as.anwalt.get(`/api/cases/${data.otherId}`)).json.case.starred, true);
    assert.equal((await as.mandant.put(`/api/cases/${data.otherId}/star`, { on: true })).status, 404, 'fremde Akte');
    assert.equal((await as.mandant.put(`/api/cases/${data.caseId}/star`, { on: true })).status, 200, 'eigene Akte darf auch der Mandant merken');
    await as.anwalt.put(`/api/cases/${data.otherId}/star`, { on: false });
    assert.deepEqual(await starred(as.anwalt), []);
  });

  it('nur interne Notizen, nur Kanzlei, höchstens drei', async () => {
    const add = async (body, internal = true) => (await as.admin.post(`/api/cases/${data.otherId}/notes`, { body, internal })).json.id;
    const ids = [await add('Eins'), await add('Zwei'), await add('Drei'), await add('Vier')];
    const open = await add('Nachricht an den Mandanten', false);
    const pin = (id, on = true, who = as.admin) => who.put(`/api/cases/${data.otherId}/notes/${id}/pin`, { on });
    for (const id of ids.slice(0, 3)) assert.equal((await pin(id)).status, 200);
    const fourth = await pin(ids[3]);
    assert.equal(fourth.status, 400);
    assert.match(fourth.json.error, /drei/);
    assert.equal((await pin(open)).status, 404, 'keine Nachrichten an den Mandanten');
    assert.equal((await pin(ids[0], false, as.mandant)).status, 404, 'Mandanten dürfen nicht');
    const notes = (await as.admin.get(`/api/cases/${data.otherId}`)).json.notes;
    assert.deepEqual(notes.filter((n) => n.pinned).map((n) => n.body).sort(), ['Drei', 'Eins', 'Zwei']);
    assert.equal((await pin(ids[0], false)).status, 200);
    assert.equal((await pin(ids[3])).status, 200, 'nach dem Lösen ist wieder Platz');
  });

  it('@Name in interner Notiz benachrichtigt – ohne Discord als Kanzlei-Post, nie sich selbst, nie Mandanten', async () => {
    const post = (body, internal = true, who = as.admin) => who.post(`/api/cases/${data.otherId}/notes`, { body, internal });
    let r = await post('@Damat bitte die Zeugenliste prüfen, @Alois zur Info');
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.mentioned.map((m) => [m.id, m.via]), [[data.anwalt.id, 'post']], 'nur Damat – die schreibende Person nicht');
    const mail = (await as.anwalt.get('/api/messages?box=inbox')).json.messages.find((m) => /Erwähnung in Akte/.test(m.subject));
    assert.ok(mail, 'Kanzlei-Post bei Damat');
    assert.match(mail.body, /Zeugenliste/);
    r = await post('@Mara bitte melden', true);
    assert.deepEqual(r.json.mentioned, [], 'Mandanten werden nie erwähnt');
    r = await post('@Damat Lex – Nachricht an den Mandanten', false);
    assert.equal(r.json.mentioned.length, 0, 'nur in internen Notizen');
    r = await post('Mail an info@Damat.de', true);
    assert.equal(r.json.mentioned.length, 0, 'E-Mail-Adressen sind keine Erwähnung');
  });
});

describe('Startseite mit eingebetteten Daten', () => {
  it('Startseite und Karriere bringen ihre Daten gleich mit – sicher eingebettet', async () => {
    for (const url of ['/', '/karriere']) {
      const r = await client(server.base).get(url, { Accept: 'text/html' });
      const m = r.text.match(/<script type="application\/json" id="psBoot">([\s\S]*?)<\/script>/);
      assert.ok(m, `${url}: psBoot fehlt`);
      assert.doesNotMatch(m[1], /</, 'kein „<“ im eingebetteten JSON');
      const boot = JSON.parse(m[1]);
      assert.ok(boot && typeof boot === 'object');
      assert.match(r.headers.get('cache-control'), /no-cache/);
    }
  });
});

describe('Automatisch aufräumen', () => {
  it('löscht abgelaufene Sitzungen, Codes und Geräte – Akten bleiben', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-maint-'));
    process.env.DB_PATH = path.join(dir, 'm.db');
    const { db } = require('../db');
    const maintenance = require('../maintenance');
    const uid = db.prepare("INSERT INTO users (email, password_hash, display_name, role) VALUES ('x@pake-scha.ls', 'x', 'X', 'mandant')").run().lastInsertRowid;
    const past = new Date(Date.now() - 864e5).toISOString();
    const future = new Date(Date.now() + 864e5).toISOString();
    for (const [t, exp] of [['alt', past], ['neu', future]]) {
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(t, uid, exp);
      db.prepare("INSERT INTO login_challenges (token_hash, user_id, code_hash, sent_at, expires_at) VALUES (?, ?, 'c', ?, ?)").run(t, uid, past, exp);
      db.prepare('INSERT INTO trusted_devices (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(t, uid, exp);
    }
    const r = maintenance.run();
    assert.deepEqual(r, { sessions: 1, challenges: 1, devices: 1, vacuumed: true });
    assert.deepEqual(db.prepare('SELECT token FROM sessions').all().map((x) => x.token), ['neu']);
    assert.equal(maintenance.run().vacuumed, false, 'verdichtet wird nur einmal im Monat');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
