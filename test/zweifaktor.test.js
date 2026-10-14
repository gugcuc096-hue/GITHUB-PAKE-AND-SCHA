'use strict';
/*
 * Zwei-Faktor-Anmeldung per Discord-Direktnachricht, Bewertungsanfrage nach dem Abschluss und Kanzlei-Statistik –
 * gegen die nachgebaute Discord-Schnittstelle (test/discordStub.js), es geht nichts nach außen.
 *  - Board: Code ist Pflicht, falscher Code zählt Versuche, „Diesem Gerät vertrauen“ überspringt den Code
 *  - Alle anderen: im Profil wählbar, Ausschalten nur mit Passwort
 *  - Ohne Bot oder ohne Discord: nur Passwort (niemand sperrt sich aus)
 *  - Bewertung: genau eine Direktnachricht je Akte, ohne Ergebnis, mit Link direkt zur Bewertung
 *  - Statistik: nur Board, Zahlen aus Rechnungen und Akten
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');
const { MEMBERS } = require('./discordStub');

const STUB = path.join(__dirname, 'discordStub.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Zwei-Faktor-Anmeldung per Discord-DM', () => {
  let server;
  let stateFile;
  let db;
  let admin; // angemeldet bleiben: der Server erlaubt nur 20 Anmeldeversuche je 15 Minuten
  const LEX_DISCORD = MEMBERS.mo;
  const dms = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).dms;
  /** Letzter Anmeldecode, den der Bot an diese Discord-ID geschickt hat. */
  const lastCode = (discordId) => {
    const dm = dms().filter((m) => m.to === discordId).pop();
    assert.ok(dm, 'Direktnachricht mit Code');
    return dm.content.match(/\*\*(\d{6})\*\*/)[1];
  };

  before(async () => {
    stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-2fa-')), 'state.json');
    server = await startServer({
      env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_STUB_STATE: stateFile, PUBLIC_URL: 'https://kanzlei.example' },
      preload: [STUB],
    });
    db = new DatabaseSync(path.join(server.dir, 'test.db'));
    db.prepare('UPDATE users SET discord_id = ?, discord_username = ? WHERE email = ?').run(MEMBERS.jaywa, 'jaywa', TEAM.admin);
    db.prepare('UPDATE users SET discord_id = ? WHERE email = ?').run(LEX_DISCORD, TEAM.anwalt);
  });
  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  it('Board: erst mit dem Code aus der DM angemeldet, falsche Codes zählen, vertrautes Gerät ohne Code', async () => {
    admin = client(server.base);
    const first = await admin.post('/api/auth/login', { email: TEAM.admin, password: PASSWORD });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.success, undefined, 'noch keine Sitzung');
    assert.equal(first.json.twoFactor.to, '@jaywa');
    assert.equal(first.json.twoFactor.minutes, 10);
    assert.equal((await admin.get('/api/auth/me')).status, 401, 'ohne Code kein Zugang');
    const code = lastCode(MEMBERS.jaywa);
    const dm = dms().filter((m) => m.to === MEMBERS.jaywa).pop();
    assert.match(dm.embeds[0].title, /Anmeldung bei Pake & Scha/);
    assert.ok(!JSON.stringify(dm).includes(PASSWORD), 'kein Passwort in der Nachricht');
    // Code liegt nur als Hash in der Datenbank
    const row = db.prepare('SELECT code_hash FROM login_challenges ORDER BY expires_at DESC LIMIT 1').get();
    assert.ok(row && !row.code_hash.includes(code));

    const challenge = first.json.twoFactor.challenge;
    const wrong = await admin.post('/api/auth/login/code', { challenge, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.json.error, /Noch 4 Versuche/);
    const early = await admin.post('/api/auth/login/resend', { challenge });
    assert.equal(early.status, 429, 'neuer Code erst nach 30 Sekunden');
    const ok = await admin.post('/api/auth/login/code', { challenge, code: `${code.slice(0, 3)} ${code.slice(3)}`, trust: true });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.user.email, TEAM.admin);
    const me = (await admin.get('/api/auth/me')).json;
    assert.equal(me.twoFactor.on, true);
    assert.equal(me.twoFactor.mandatory, true);
    assert.equal(me.twoFactor.trustedDevices, 1);
    assert.equal((await admin.post('/api/auth/login/code', { challenge, code })).status, 410, 'ein Code gilt nur einmal');

    // Board kann nicht ausschalten
    const off = await admin.patch('/api/auth/two-factor', { enabled: false, password: PASSWORD });
    assert.equal(off.status, 400);
    assert.match(off.json.error, /Pflicht/);

    // Vertrautes Gerät: nach dem Abmelden ohne Code wieder drin
    await admin.post('/api/auth/logout');
    const sent = dms().length;
    const again = await admin.post('/api/auth/login', { email: TEAM.admin, password: PASSWORD });
    assert.equal(again.json.success, true, again.text);
    assert.equal(dms().length, sent, 'kein neuer Code');
    // Geräte vergessen → nächstes Mal wieder mit Code (die Sitzung bleibt)
    const forget = await admin.del('/api/auth/two-factor/devices');
    assert.equal(forget.json.forgotten, 1);
    assert.equal(forget.json.trustedDevices, 0);

    // Fünf falsche Codes → Anmeldung neu starten
    const other = client(server.base);
    const c2 = (await other.post('/api/auth/login', { email: TEAM.admin, password: PASSWORD })).json.twoFactor.challenge;
    const real = lastCode(MEMBERS.jaywa);
    const bad = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++) assert.equal((await other.post('/api/auth/login/code', { challenge: c2, code: bad })).status, 400);
    const last = await other.post('/api/auth/login/code', { challenge: c2, code: bad });
    assert.equal(last.status, 410);
    assert.equal(last.json.restart, true);
    assert.equal((await other.post('/api/auth/login/code', { challenge: c2, code: real })).status, 410, 'auch der richtige Code gilt danach nicht mehr');
  });

  it('Andere: im Profil einschalten, Ausschalten nur mit Passwort; gesperrte DMs mit klarer Meldung', async () => {
    const lex = client(server.base);
    assert.equal((await lex.post('/api/auth/login', { email: TEAM.anwalt, password: PASSWORD })).json.success, true, 'ohne Einschalten nur Passwort');
    const st = (await lex.get('/api/auth/two-factor')).json;
    assert.deepEqual([st.on, st.mandatory, st.possible], [false, false, true]);
    assert.equal((await lex.patch('/api/auth/two-factor', { enabled: true })).json.on, true);
    await lex.post('/api/auth/logout');
    const step = await lex.post('/api/auth/login', { email: TEAM.anwalt, password: PASSWORD });
    assert.ok(step.json.twoFactor, 'jetzt mit Code');
    assert.equal((await lex.post('/api/auth/login/code', { challenge: step.json.twoFactor.challenge, code: lastCode(LEX_DISCORD) })).status, 200);
    const noPw = await lex.patch('/api/auth/two-factor', { enabled: false });
    assert.equal(noPw.status, 400);
    assert.match(noPw.json.error, /Passwort/);
    assert.equal((await lex.patch('/api/auth/two-factor', { enabled: false, password: PASSWORD })).json.on, false);

    // Discord lässt keine DMs zu → verständliche Meldung, keine Sitzung
    db.prepare('UPDATE users SET discord_id = ?, two_factor = 1 WHERE email = ?').run(MEMBERS.closed, TEAM.anwalt);
    const closed = client(server.base);
    const r = await closed.post('/api/auth/login', { email: TEAM.anwalt, password: PASSWORD });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /Direktnachrichten/);
    assert.equal((await closed.get('/api/auth/me')).status, 401);

    // Board ohne verknüpftes Discord: nur Passwort (sonst wäre man ausgesperrt) – mit Hinweis im Status
    const partner = client(server.base);
    assert.equal((await partner.post('/api/auth/login', { email: TEAM.partner, password: PASSWORD })).json.success, true);
    const ps = (await partner.get('/api/auth/me')).json.twoFactor;
    assert.deepEqual([ps.on, ps.mandatory, ps.hasDiscord, ps.botReady], [false, true, false, true]);
  });

  it('Bewertung: nach dem Abschluss genau eine DM mit Link zur Bewertung, ohne Ergebnis', async () => {
    const mandant = client(server.base);
    assert.equal((await mandant.post('/api/auth/register', { displayName: 'Erika Muster', email: 'erika.muster', password: 'Ein-langes-Passwort-1' })).status, 201);
    const discordId = '900000000000000150';
    db.prepare("UPDATE users SET discord_id = ? WHERE email LIKE 'erika.muster@%'").run(discordId);
    const kase = (await admin.post('/api/cases', { title: 'Verkehrsunfall am Pier', area: 'zivilrecht', clientEmail: 'erika.muster', description: 'Unfall' })).json.case;
    assert.ok(kase && kase.id);
    const toErika = () => dms().filter((m) => m.to === discordId);

    const close = await admin.patch(`/api/cases/${kase.id}`, { status: 'geschlossen', outcome: 'verloren' });
    assert.equal(close.status, 200, close.text);
    for (let i = 0; i < 50 && !toErika().length; i++) await sleep(50);
    assert.equal(toErika().length, 1, 'Direktnachricht kommt');
    const dm = toErika()[0];
    assert.match(dm.embeds[0].title, /Wie zufrieden waren Sie mit uns/);
    assert.match(dm.embeds[0].description, new RegExp(kase.caseNumber));
    assert.equal(dm.components[0].components[0].url, `https://kanzlei.example/dashboard.html?case=${kase.id}&bewerten=1#cases`);
    assert.ok(!/verloren|Verurteilt/i.test(JSON.stringify(dm)), 'Ergebnis steht nicht in der Nachricht');
    assert.ok(db.prepare('SELECT review_requested_at FROM cases WHERE id = ?').get(kase.id).review_requested_at);

    // Wieder öffnen und erneut schließen: keine zweite Nachricht
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { status: 'in_bearbeitung' })).status, 200);
    assert.equal((await admin.patch(`/api/cases/${kase.id}`, { status: 'geschlossen', outcome: 'vergleich' })).status, 200);
    await sleep(400);
    assert.equal(toErika().length, 1, 'nur einmal je Akte');
  });
});

describe('Kanzlei-Statistik und Anmeldung ohne Bot', () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(async () => {
    if (server) await server.stop();
  });

  it('Ohne Kanzlei-Bot meldet sich auch das Board nur mit Passwort an', async () => {
    const admin = client(server.base);
    const r = await admin.post('/api/auth/login', { email: TEAM.admin, password: PASSWORD });
    assert.equal(r.json.success, true, r.text);
    const tf = (await admin.get('/api/auth/me')).json.twoFactor;
    assert.deepEqual([tf.on, tf.mandatory, tf.botReady], [false, true, false]);
    assert.equal((await admin.patch('/api/auth/two-factor', { enabled: true })).status, 400, 'ohne Bot nicht einschaltbar');
  });

  it('nur für das Board; Umsatz, Akten, Erfolgsquote und Anwälte aus vorhandenen Daten', async () => {
    const lex = client(server.base);
    await lex.login(TEAM.anwalt);
    assert.equal((await lex.get('/api/stats')).status, 403);
    assert.equal((await client(server.base).get('/api/stats')).status, 401);

    const admin = client(server.base);
    const me = await admin.login(TEAM.admin);
    const empty = (await admin.get('/api/stats')).json;
    assert.equal(empty.months.length, 12);
    assert.equal(empty.kpis.revenue30, 0);
    assert.equal(empty.kpis.success.pct, null);

    const won = (await admin.post('/api/cases', { title: 'Haftprüfung Mission Row', area: 'strafrecht', clientName: 'Tom Test', lawyerId: me.id })).json.case;
    const inv = (await admin.post('/api/invoices', { caseId: won.id, items: [{ description: 'Verteidigung', quantity: 1, unitPrice: 25000 }] })).json.invoice;
    await admin.post('/api/invoices', { caseId: won.id, items: [{ description: 'Nachtrag', quantity: 1, unitPrice: 4000 }] }); // bleibt offen
    assert.equal((await admin.patch(`/api/invoices/${inv.id}`, { status: 'bezahlt' })).status, 200);
    assert.equal((await admin.patch(`/api/cases/${won.id}`, { status: 'geschlossen', outcome: 'freispruch' })).status, 200);
    const lost = (await admin.post('/api/cases', { title: 'Bußgeld Vinewood', area: 'zivilrecht', clientName: 'Tina Test', lawyerId: me.id })).json.case;
    assert.equal((await admin.patch(`/api/cases/${lost.id}`, { status: 'geschlossen', outcome: 'verloren' })).status, 200);
    await client(server.base).post('/api/public/cases', { name: 'Willi Web', area: 'zivilrecht', description: 'Anfrage über die Website ohne Anwalt.' });

    const s = (await admin.get('/api/stats')).json;
    assert.equal(s.kpis.revenue30, 25000);
    assert.equal(s.kpis.openSum, 4000);
    assert.equal(s.kpis.openCount, 1);
    assert.equal(s.months[11].revenue, 25000);
    assert.equal(s.months[11].paid, 1);
    assert.equal(s.months[11].opened, 3);
    assert.equal(s.months[11].closed, 2);
    assert.equal(s.kpis.casesClosed, 2);
    assert.equal(s.kpis.closed30, 2);
    assert.deepEqual(s.kpis.success, { rated: 2, won: 1, pct: 50 });
    assert.equal(s.unassignedOpen, 1, 'Website-Anfrage ohne Anwalt');
    const mine = s.lawyers.find((l) => l.id === me.id);
    assert.equal(mine.closed, 2);
    assert.equal(mine.success.pct, 50);
    assert.deepEqual(
      s.outcomes.map((o) => [o.key, o.count]).sort(),
      [
        ['freispruch', 1],
        ['verloren', 1],
      ]
    );
  });
});
