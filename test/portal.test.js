'use strict';
/*
 * Mandantenportal einfacher (gegen die nachgebaute Discord-Schnittstelle, test/discordStub.js – es geht nichts nach außen):
 *  - Konto mit einem Klick über Discord (Registrieren, Anmelden ohne Konto, Konto direkt nach der Mandatsanfrage)
 *  - „Als bezahlt melden“ bei Rechnungen (Mandant meldet, Kanzlei bestätigt oder weist zurück)
 *  - „Was ist zu tun?“: Verträge, die auf die Unterschrift des Mandanten warten
 *  - Mandatsvertrag in Discord lesen und unterschreiben (signierte Interaktionen wie von Discord)
 *  - Antworten aus dem Discord-Ticket im Chat der Akte (Gateway-Ereignis, im Testprozess)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM } = require('./helpers');

const STUB = path.join(__dirname, 'discordStub.js');
const { GUILD, MEMBERS } = require('./discordStub');
const CATEGORY = '900000000000000600';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 1×1-PNG (Screenshot der Überweisung)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Antworten aus dem Discord-Ticket im Chat der Akte', () => {
  it('übernimmt Mandant und Kanzlei, ignoriert Bots, Fremde und Doppeltes – und schaltet sich bei verweigertem Intent ab', () => {
    // Eigene Datenbank im Testprozess (bevor db.js geladen wird)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-import-'));
    process.env.DB_PATH = path.join(dir, 'i.db');
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    const { db, setSetting, getSetting } = require('../db');
    const caseChat = require('../caseChat');
    const bot = require('../discordBot');
    for (const [k, v] of [
      ['discord_tickets_enabled', '1'],
      ['discord_ticket_guild', GUILD],
      ['discord_ticket_category', CATEGORY],
      ['discord_ticket_chat_import', '1'],
    ])
      setSetting(k, v);
    const user = (name, role, discordId) =>
      Number(db.prepare('INSERT INTO users (email, password_hash, display_name, role, discord_id) VALUES (?, ?, ?, ?, ?)').run(`${name.replace(/\s/g, '.').toLowerCase()}@pake-scha.ls`, 'x', name, role, discordId).lastInsertRowid);
    const lawyer = user('Mo Anwalt', 'anwalt', MEMBERS.mo);
    const mandant = user('John Jaywa', 'mandant', MEMBERS.jaywa);
    user('Erika Fremd', 'mandant', MEMBERS.closed);
    const channel = '900000000000000777';
    const caseId = Number(
      db
        .prepare("INSERT INTO cases (case_number, access_pin, title, client_id, lawyer_id, status, discord_channel_id) VALUES ('PS-T-1', '1234', 'Testakte', ?, ?, 'in_bearbeitung', ?)")
        .run(mandant, lawyer, channel).lastInsertRowid
    );

    // Nachrichten-Inhalte nur mit MESSAGE CONTENT INTENT (dazu GUILD_MESSAGES)
    assert.ok(bot._test.intents() & (1 << 15), 'MESSAGE_CONTENT');
    assert.ok(bot._test.intents() & (1 << 9), 'GUILD_MESSAGES');
    let seq = 900000000000001000n;
    const msg = (author, content, extra = {}) => ({ id: String(++seq), channel_id: channel, guild_id: GUILD, type: 0, author, content, mentions: [], attachments: [], ...extra });
    const jaywa = { id: MEMBERS.jaywa, username: 'jaywa', global_name: 'Jaywa' };

    // Mandant schreibt im Ticket: Erwähnung lesbar, Anhang als Link
    const first = msg(jaywa, 'Hallo <@900000000000000102>, anbei das Foto.', {
      mentions: [{ id: MEMBERS.mo, username: 'mo', global_name: 'MO' }],
      attachments: [{ url: 'https://cdn.discordapp.com/attachments/1/2/foto.png' }],
    });
    bot._test.dispatch('MESSAGE_CREATE', first);
    let list = caseChat.messages(caseId);
    assert.equal(list.length, 1);
    assert.equal(list[0].body, 'Hallo @MO, anbei das Foto.\n📎 https://cdn.discordapp.com/attachments/1/2/foto.png');
    assert.equal(list[0].fromFirm, false);
    assert.equal(list[0].viaDiscord, true);
    assert.equal(list[0].author, 'John Jaywa');
    assert.equal(caseChat.unreadFor({ id: lawyer, role: 'anwalt' }).total, 1, 'für den Anwalt neu');
    assert.equal(caseChat.unreadFor({ id: mandant, role: 'mandant' }).total, 0, 'eigene Nachricht gilt als gelesen');

    // Dieselbe Nachricht noch einmal (z. B. nach dem Wiederverbinden): kein Duplikat
    bot._test.dispatch('MESSAGE_CREATE', first);
    assert.equal(caseChat.messages(caseId).length, 1);

    // Anwalt antwortet im Ticket
    bot._test.dispatch('MESSAGE_CREATE', msg({ id: MEMBERS.mo, username: 'mo' }, 'Danke, ist angekommen.'));
    list = caseChat.messages(caseId);
    assert.equal(list.length, 2);
    assert.equal(list[1].fromFirm, true);
    assert.equal(list[1].author, 'Mo Anwalt');
    assert.equal(caseChat.unreadFor({ id: mandant, role: 'mandant' }).total, 1, 'für den Mandanten neu');

    // Nicht übernommen: Bots, Webhooks (u. a. Nachrichten der Website), Fremde, andere Kanäle, Systemnachrichten, leere
    bot._test.dispatch('MESSAGE_CREATE', msg({ id: MEMBERS.otherBot, username: 'helper', bot: true }, 'Ich bin ein Bot'));
    bot._test.dispatch('MESSAGE_CREATE', msg(jaywa, 'Per Webhook', { webhook_id: '900000000000000999' }));
    bot._test.dispatch('MESSAGE_CREATE', msg({ id: MEMBERS.closed, username: 'closed' }, 'Ich gehöre nicht zur Akte'));
    bot._test.dispatch('MESSAGE_CREATE', msg(jaywa, 'Anderer Kanal', { channel_id: '900000000000000778' }));
    bot._test.dispatch('MESSAGE_CREATE', msg(jaywa, 'Angepinnt', { type: 6 }));
    bot._test.dispatch('MESSAGE_CREATE', msg(jaywa, '   '));
    assert.equal(caseChat.messages(caseId).length, 2);

    // Ausgeschaltet: nichts wird übernommen, der Intent wird nicht mehr angefragt
    setSetting('discord_ticket_chat_import', '0');
    assert.equal(bot._test.intents() & (1 << 15), 0);
    bot._test.dispatch('MESSAGE_CREATE', msg(jaywa, 'Während aus'));
    assert.equal(caseChat.messages(caseId).length, 2);

    // Discord verweigert den Intent (4014): nur die Übernahme wird abgeschaltet, mit Hinweis für die Einstellungen
    setSetting('discord_ticket_chat_import', '1');
    bot._test.gw.intents = bot._test.intents();
    bot._test.onClose(4014);
    assert.equal(getSetting('discord_ticket_chat_import'), '0');
    assert.match(getSetting('discord_ticket_chat_import_error'), /MESSAGE CONTENT INTENT/);
    assert.match(bot.status().errors[0].message, /MESSAGE CONTENT INTENT verweigert/);
    assert.notEqual(bot.status().state, 'fehler', 'kein endgültiger Fehler – die anderen Module laufen weiter');
  });
});

describe('Mandantenportal: Discord-Konto, Zahlung melden, Unterschriften', () => {
  let server;
  let stateFile;
  const as = {};
  const state = {};
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKeyHex = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const stub = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      return { channelMessages: [], calls: [] };
    }
  };
  /** Wartet, bis fn() etwas liefert (Ticket-Nachrichten laufen im Hintergrund). */
  const waitFor = async (fn, what, ms = 5000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) {
      const v = fn();
      if (v) return v;
    }
    assert.fail(`Zeitüberschreitung: ${what}`);
  };
  const sql = (fn) => {
    const db = new DatabaseSync(path.join(server.dir, 'test.db'));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  /** Discord-Anmeldung durchspielen: Start-Adresse → (Discord) → Rückkehr mit Code „user-<ID>“. */
  async function oauth(c, start, discordId, { method = 'GET', form } = {}) {
    const r = method === 'GET' ? await c.get(start) : await c.upload(start, Buffer.from(new URLSearchParams(form).toString()), 'application/x-www-form-urlencoded');
    assert.equal(r.status, 302, r.text);
    const to = new URL(r.location, server.base);
    if (to.hostname !== 'discord.com') return { start: r, cb: null };
    const cb = await c.get(`/api/discord/callback?code=user-${discordId}&state=${to.searchParams.get('state')}`);
    assert.equal(cb.status, 302, cb.text);
    return { start: r, authorize: to, cb };
  }
  /** Signierte Interaktion wie von Discord (Button-Klick, Formular). */
  async function interact(body) {
    const raw = JSON.stringify({ guild_id: GUILD, ...body });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.sign(null, Buffer.from(ts + raw), keys.privateKey).toString('hex');
    const res = await fetch(`${server.base}/api/discord/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts },
      body: raw,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const click = (discordId, customId, extra = {}) =>
    interact({ type: 3, channel_id: state.channel, member: { user: { id: discordId, username: 'x', global_name: 'Discord-Name' } }, data: { custom_id: customId, component_type: 2 }, ...extra });
  const text = (r) => JSON.stringify(r.json);

  before(async () => {
    stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-portal-')), 'discord.json');
    server = await startServer({
      env: {
        DISCORD_BOT_TOKEN: 'test-token',
        DISCORD_STUB_STATE: stateFile,
        DISCORD_CLIENT_ID: '900000000000000003',
        DISCORD_CLIENT_SECRET: 'test-secret',
        DISCORD_PUBLIC_KEY: publicKeyHex,
        PUBLIC_URL: 'https://kanzlei.example',
      },
      preload: [STUB],
    });
    as.admin = client(server.base);
    as.anwalt = client(server.base);
    as.mandant = client(server.base);
    as.fremd = client(server.base);
    as.admin.me = await as.admin.login(TEAM.admin);
    as.anwalt.me = await as.anwalt.login(TEAM.anwalt);
    // Discord-Tickets an (Server + Kategorie); der Anwalt verknüpft sein Discord (MO)
    const t = await as.admin.patch('/api/tickets/settings', { enabled: true, guildId: GUILD, categoryId: CATEGORY });
    assert.equal(t.status, 200, t.text);
    assert.match((await oauth(as.anwalt, '/api/discord/connect', MEMBERS.mo)).cb.location, /discord=linked/);
    for (const [c, name, email] of [
      [as.mandant, 'Max Mustermann', 'max.mustermann'],
      [as.fremd, 'Erika Fremd', 'erika.fremd'],
    ]) {
      assert.equal((await c.post('/api/auth/register', { displayName: name, email, password: 'Mandanten-Passwort-1' })).status, 201);
      c.me = await c.login(email, 'Mandanten-Passwort-1');
    }
    const r = await as.anwalt.post('/api/cases', { title: 'Körperverletzung Würfelpark', area: 'strafrecht', clientEmail: 'max.mustermann', lawyerId: as.anwalt.me.id });
    assert.equal(r.status, 201, r.text);
    state.caseId = r.json.case.id;
    state.channel = await waitFor(() => sql((db) => db.prepare('SELECT discord_channel_id AS ch FROM cases WHERE id = ?').get(state.caseId)).ch, 'Ticket-Kanal der Akte');
  });
  after(async () => {
    if (server) await server.stop();
  });

  describe('Konto mit einem Klick über Discord', () => {
    it('„Mit Discord registrieren“ legt ein Mandantenkonto an – den Namen im Spiel fragt das Dashboard ab', async () => {
      const c = client(server.base);
      const id = '900000000000000151';
      const { authorize, cb } = await oauth(c, '/api/discord/register', id);
      assert.equal(authorize.searchParams.get('prompt'), 'consent');
      assert.equal(authorize.searchParams.get('scope'), 'identify guilds.join', 'Server beitreten (Tickets aktiv)');
      assert.equal(cb.location, '/dashboard?discord=willkommen');
      const me = (await c.get('/api/auth/me')).json.user;
      assert.equal(me.role, 'mandant');
      assert.equal(me.displayName, 'Neuer Nutzer');
      assert.equal(me.needsName, true);
      assert.equal(me.viaDiscord, true);
      assert.equal(me.discord.id, id);
      assert.ok(stub().calls.includes(`PUT /guilds/${GUILD}/members/${id}`), 'dem Discord-Server beigetreten');

      assert.equal((await c.post('/api/auth/initial-name', { displayName: 'Tony' })).status, 400, 'Vor- und Nachname nötig');
      const ok = await c.post('/api/auth/initial-name', { displayName: 'Tony   Montana' });
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.json.user.displayName, 'Tony Montana');
      assert.equal(ok.json.user.needsName, false);
      assert.equal((await c.post('/api/auth/initial-name', { displayName: 'Toni Anders' })).status, 400, 'nur einmal');
      assert.equal((await as.anwalt.post('/api/auth/initial-name', { displayName: 'Damat Lex' })).status, 400, 'nicht für bestehende Konten');
    });

    it('„Mit Discord anmelden“ ohne Konto fragt erst nach – angelegt wird erst nach Bestätigung', async () => {
      const c = client(server.base);
      const id = '900000000000000152';
      const { authorize, cb } = await oauth(c, '/api/discord/login', id);
      assert.equal(authorize.searchParams.get('scope'), 'identify');
      assert.equal(cb.location, '/login?discord=neu');
      assert.equal((await c.get('/api/auth/me')).status, 401, 'noch nicht angemeldet');
      assert.deepEqual((await c.get('/api/discord/pending')).json, { pending: { name: 'Neuer Nutzer' } });
      assert.deepEqual((await client(server.base).get('/api/discord/pending')).json, { pending: null }, 'nur im selben Browser');

      const s = await c.post('/api/discord/signup');
      assert.equal(s.status, 200, s.text);
      assert.equal(s.json.redirect, '/dashboard');
      const me = (await c.get('/api/auth/me')).json.user;
      assert.equal(me.role, 'mandant');
      assert.equal(me.needsName, true);
      assert.equal((await c.post('/api/discord/signup')).status, 400, 'nur einmal');

      // Beim nächsten Mal meldet „Mit Discord anmelden“ direkt an
      const again = client(server.base);
      assert.equal((await oauth(again, '/api/discord/login', id)).cb.location, '/dashboard');
      assert.equal((await again.get('/api/auth/me')).json.user.id, me.id);
    });

    it('„Konto mit Discord anlegen“ direkt nach der Mandatsanfrage: Die Akte hängt am neuen Konto', async () => {
      const web = client(server.base);
      const req = await web.post('/api/public/cases', { name: 'Lena Berg', area: 'zivilrecht', description: 'Mein Fahrzeug wurde am Pier beschädigt.' });
      assert.equal(req.status, 201, req.text);
      assert.equal(req.json.discordSignup, true);
      const form = { caseNumber: req.json.caseNumber, pin: req.json.pin };

      const wrong = await oauth(client(server.base), '/api/discord/case-account', '900000000000000153', { method: 'POST', form: { ...form, pin: '0000' } });
      assert.equal(wrong.start.location, '/?ticket=notfound');

      const { authorize, cb } = await oauth(web, '/api/discord/case-account', '900000000000000153', { method: 'POST', form });
      assert.equal(authorize.searchParams.get('prompt'), 'consent');
      const caseId = Number((cb.location.match(/^\/dashboard\?case=(\d+)#cases$/) || [])[1]);
      assert.ok(caseId > 0, cb.location);
      const me = (await web.get('/api/auth/me')).json.user;
      assert.equal(me.displayName, 'Lena Berg', 'Name aus der Mandatsanfrage');
      assert.equal(me.needsName, false);
      assert.deepEqual(
        (await web.get('/api/cases')).json.cases.map((c) => c.caseNumber),
        [req.json.caseNumber]
      );
      assert.equal(sql((db) => db.prepare('SELECT discord_client_id AS d FROM cases WHERE id = ?').get(caseId)).d, '900000000000000153', 'Discord im Ticket der Akte');

      // Wer Aktenzeichen und Pin ebenfalls kennt, bekommt die Akte nicht (und nicht deren Namen)
      const other = client(server.base);
      assert.equal((await oauth(other, '/api/discord/case-account', '900000000000000154', { method: 'POST', form })).cb.location, '/dashboard?discord=fremdeakte');
      const otherMe = (await other.get('/api/auth/me')).json.user;
      assert.notEqual(otherMe.displayName, 'Lena Berg');
      assert.equal(otherMe.needsName, true);
      assert.deepEqual((await other.get('/api/cases')).json.cases, []);
    });
  });

  describe('Rechnung: „Als bezahlt melden“', () => {
    before(async () => {
      const r = await as.anwalt.post('/api/invoices', { caseId: state.caseId, items: [{ description: 'Erstberatung', quantity: 1, unitPrice: 15000 }] });
      assert.equal(r.status, 201, r.text);
      state.invoice = r.json.invoice;
    });
    const reports = async () => (await as.anwalt.get('/api/invoices/payment-reports')).json.count;
    const inv = async (c = as.mandant) => (await c.get(`/api/invoices/${state.invoice.id}`)).json.invoice;
    const ticketMsg = (title) => stub().channelMessages.find((m) => m.channel === state.channel && m.embeds && m.embeds[0].title.startsWith(title));

    it('Mandant meldet die Zahlung – die Kanzlei sieht sie (Badge, Akte, Ticket)', async () => {
      assert.equal(await reports(), 0);
      assert.equal((await as.anwalt.post(`/api/invoices/${state.invoice.id}/payment-report`, {})).status, 403, 'nur der Empfänger');
      assert.equal((await as.fremd.post(`/api/invoices/${state.invoice.id}/payment-report`, {})).status, 404);
      const r = await as.mandant.post(`/api/invoices/${state.invoice.id}/payment-report`, { note: 'Überwiesen am 8.10., Verwendungszweck R-Nummer' });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.invoice.status, 'offen', 'bleibt offen, bis die Kanzlei bestätigt');
      assert.equal(r.json.invoice.paymentReport.note, 'Überwiesen am 8.10., Verwendungszweck R-Nummer');
      assert.equal(r.json.invoice.paymentReport.proof, false);
      assert.equal((await as.mandant.post(`/api/invoices/${state.invoice.id}/payment-report`, {})).status, 409, 'schon gemeldet');
      assert.equal(await reports(), 1);
      assert.equal((await as.mandant.get('/api/invoices/payment-reports')).status, 403);
      const notes = (await as.anwalt.get(`/api/cases/${state.caseId}`)).json.notes;
      assert.ok(notes.some((n) => n.internal && /als bezahlt gemeldet/.test(n.body)), 'interner Vermerk in der Akte');
      const msg = await waitFor(() => ticketMsg('💸 Zahlung gemeldet'), 'Ticket-Nachricht');
      assert.ok(msg.embeds[0].fields.some((f) => f.name === 'Hinweis des Mandanten'));
    });

    it('Screenshot als Nachweis: sehen nur die Kanzlei und der Mandant selbst', async () => {
      assert.equal((await as.fremd.upload(`/api/invoices/${state.invoice.id}/payment-proof`, PNG, 'image/png')).status, 404);
      const up = await as.mandant.upload(`/api/invoices/${state.invoice.id}/payment-proof`, PNG, 'image/png');
      assert.equal(up.status, 200, up.text);
      assert.equal(up.json.invoice.paymentReport.proof, true);
      const file = sql((db) => db.prepare('SELECT payment_proof AS f FROM invoices WHERE id = ?').get(state.invoice.id)).f;
      assert.ok(fs.existsSync(path.join(server.dir, 'uploads', 'evidence', file)), 'liegt im geschützten Ordner');
      const get = await as.anwalt.get(`/api/invoices/${state.invoice.id}/payment-proof`);
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('content-type'), 'image/png');
      assert.match(get.headers.get('cache-control'), /no-store/);
      assert.equal((await as.mandant.get(`/api/invoices/${state.invoice.id}/payment-proof`)).status, 200);
      assert.equal((await as.fremd.get(`/api/invoices/${state.invoice.id}/payment-proof`)).status, 404);
      state.proofFile = file;
    });

    it('„Nicht eingegangen“: Meldung zurückgesetzt, Nachweis gelöscht, Mandant im Ticket informiert', async () => {
      assert.equal((await as.mandant.post(`/api/invoices/${state.invoice.id}/payment-reject`, {})).status, 403);
      const r = await as.anwalt.post(`/api/invoices/${state.invoice.id}/payment-reject`, { reason: 'Auf dem Kanzleikonto ist nichts eingegangen.' });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.invoice.paymentReport, null);
      assert.equal(await reports(), 0);
      // Der Server löscht die Datei im Hintergrund – kurz abwarten statt sofort prüfen
      await waitFor(() => !fs.existsSync(path.join(server.dir, 'uploads', 'evidence', state.proofFile)), 'Screenshot gelöscht');
      const msg = await waitFor(() => ticketMsg('⚠️ Zahlung noch nicht eingegangen'), 'Ticket-Nachricht');
      assert.match(msg.embeds[0].description, /nichts eingegangen/);
      const notes = (await as.mandant.get(`/api/cases/${state.caseId}`)).json.notes;
      assert.ok(notes.some((n) => !n.internal && /noch nicht eingegangen.*Hinweis der Kanzlei: Auf dem Kanzleikonto/.test(n.body)), 'Hinweis für den Mandanten in der Akte');
      assert.equal((await as.anwalt.post(`/api/invoices/${state.invoice.id}/payment-reject`, {})).status, 400, 'keine offene Meldung mehr');
    });

    it('Erneut melden, Kanzlei bestätigt: bezahlt, Bestätigung im Ticket; „wieder offen“ verwirft die alte Meldung', async () => {
      assert.equal((await as.mandant.post(`/api/invoices/${state.invoice.id}/payment-report`, {})).status, 200);
      const paid = await as.anwalt.patch(`/api/invoices/${state.invoice.id}`, { status: 'bezahlt' });
      assert.equal(paid.status, 200, paid.text);
      assert.equal(paid.json.invoice.status, 'bezahlt');
      assert.ok(paid.json.invoice.paymentReport, 'Meldung bleibt als Nachweis erhalten');
      assert.equal(await reports(), 0);
      await waitFor(() => ticketMsg('✅ Zahlung eingegangen'), 'Bestätigung im Ticket');
      assert.equal((await as.mandant.post(`/api/invoices/${state.invoice.id}/payment-report`, {})).status, 400, 'bezahlt – nichts mehr zu melden');
      await as.anwalt.patch(`/api/invoices/${state.invoice.id}`, { status: 'offen' });
      assert.equal((await inv()).paymentReport, null);
    });
  });

  describe('Mandatsvertrag: „Was ist zu tun?“ und Unterschrift in Discord', () => {
    before(async () => {
      // Der Mandant verknüpft sein Discord (Jaywa) – damit gehört er zum Ticket
      assert.match((await oauth(as.mandant, '/api/discord/connect', MEMBERS.jaywa)).cb.location, /discord=linked/);
      const { templates } = (await as.anwalt.get('/api/contract-templates')).json;
      const defaults = (await as.anwalt.get(`/api/cases/${state.caseId}/contracts/defaults`)).json;
      const k = await as.anwalt.post(`/api/cases/${state.caseId}/contracts`, {
        templateId: templates.find((t) => t.key === 'mandatsvertrag').id,
        lawyerId: as.anwalt.me.id,
        data: { ...defaults.data, mandant: 'Max Mustermann' },
      });
      assert.equal(k.status, 201, k.text);
      state.contract = k.json.contract;
    });

    it('offene Unterschrift steht beim Mandanten unter „Was ist zu tun?“', async () => {
      const list = (await as.mandant.get('/api/contracts/to-sign')).json.contracts;
      assert.deepEqual(
        list.map((k) => [k.id, k.caseId, k.templateName]),
        [[state.contract.id, state.caseId, state.contract.templateName]]
      );
      assert.deepEqual((await as.anwalt.get('/api/contracts/to-sign')).json.contracts, [], 'nur für Mandanten');
      assert.deepEqual((await as.fremd.get('/api/contracts/to-sign')).json.contracts, [], 'nur eigene Akten');
    });

    it('Ticket-Nachricht zum Vertrag hat den Knopf „Lesen & unterschreiben“', async () => {
      const msg = await waitFor(
        () => stub().channelMessages.find((m) => m.channel === state.channel && m.components && JSON.stringify(m.components).includes(`ksign:read:${state.contract.id}`)),
        'Vertrag im Ticket'
      );
      assert.equal(msg.components[0].components[0].label, 'Lesen & unterschreiben');
    });

    it('nur echte Discord-Anfragen zählen (Signatur)', async () => {
      const res = await fetch(`${server.base}/api/discord/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': 'ab'.repeat(64), 'X-Signature-Timestamp': String(Math.floor(Date.now() / 1000)) },
        body: JSON.stringify({ type: 3 }),
      });
      assert.equal(res.status, 401);
    });

    it('„Lesen“: Mandant sieht den Vertrag mit „Jetzt unterschreiben“, die Kanzlei nur zum Lesen, Fremde gar nicht', async () => {
      const r = await click(MEMBERS.jaywa, `ksign:read:${state.contract.id}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.type, 4);
      assert.equal(r.json.data.flags, 64, 'nur für die Person sichtbar');
      const embeds = r.json.data.embeds;
      assert.match(embeds[0].title, /Mandatsvertrag/);
      assert.ok(embeds.map((e) => e.description).join('\n').includes('Max Mustermann'), 'Platzhalter gefüllt');
      assert.ok(embeds[embeds.length - 1].fields.some((f) => f.name === 'Unterschriften'));
      const buttons = r.json.data.components[0].components;
      assert.deepEqual(
        buttons.map((b) => b.custom_id || b.url),
        [`ksign:sign:${state.contract.id}`, `https://kanzlei.example/vertrag?id=${state.contract.id}`]
      );

      const staff = await click(MEMBERS.mo, `ksign:read:${state.contract.id}`);
      assert.ok(!text(staff).includes('ksign:sign'), 'Kanzlei unterschreibt hier nicht als Mandant');
      assert.match(text(await click(MEMBERS.closed, `ksign:read:${state.contract.id}`)), /sehen nur der Mandant/);
      assert.match(text(await click(MEMBERS.jaywa, `ksign:read:${state.contract.id}`, { channel_id: '900000000000000999' })), /gehört nicht zu diesem Ticket/);
      assert.match(text(await click(MEMBERS.mo, `ksign:sign:${state.contract.id}`)), /Unterschreiben kann nur der Mandant/);
    });

    it('„Jetzt unterschreiben“: Name eintippen wie im Portal – falscher Name wird abgelehnt', async () => {
      const modal = await click(MEMBERS.jaywa, `ksign:sign:${state.contract.id}`);
      assert.equal(modal.json.type, 9, 'Formular (Modal)');
      assert.equal(modal.json.data.custom_id, `ksign:modal:${state.contract.id}`);
      const submit = (name, who = MEMBERS.jaywa) =>
        interact({
          type: 5,
          channel_id: state.channel,
          member: { user: { id: who, username: 'jaywa', global_name: 'Jaywa' } },
          data: { custom_id: `ksign:modal:${state.contract.id}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'name', value: name }] }] },
        });
      assert.match(text(await submit('Moritz Muster')), /stimmt nicht mit dem Namen im Vertrag überein/);
      const ok = await submit('  max   MUSTERMANN ');
      assert.match(ok.json.data.embeds[0].title, /Unterschrieben/);
      const k = (await as.mandant.get(`/api/contracts/${state.contract.id}`)).json.contract;
      assert.equal(k.clientSignature, 'Max Mustermann');
      assert.equal(k.clientSignedVia, 'discord');
      assert.ok(k.clientSignedAt);
      assert.match(text(await submit('Max Mustermann')), /bereits unterschrieben/);
      assert.deepEqual((await as.mandant.get('/api/contracts/to-sign')).json.contracts, [], 'nichts mehr zu tun');
      const msg = await waitFor(() => stub().channelMessages.find((m) => m.channel === state.channel && m.embeds && /vom Mandanten unterschrieben/.test(m.embeds[0].title)), 'Ticket-Nachricht');
      assert.ok(msg.embeds[0].fields.some((f) => f.name === 'Mandant' && /über Discord/.test(f.value)));
      const notes = (await as.anwalt.get(`/api/cases/${state.caseId}`)).json.notes;
      assert.ok(notes.some((n) => /vom Mandanten über Discord unterschrieben \(Max Mustermann, Discord: Jaywa\)/.test(n.body)));
    });

    it('Rechnung ohne Akte (VIP): Zurückweisen und Bestätigen erreichen den Mandanten per Discord-Direktnachricht', async () => {
      const tier = await as.admin.post('/api/memberships/tiers', { name: 'Silber', kind: 'vip', price: 50000, durationDays: 30, discountPct: 10 });
      assert.equal(tier.status, 201, tier.text);
      const grant = await as.admin.post('/api/memberships', { userId: as.mandant.me.id, tierId: tier.json.tier.id });
      assert.equal(grant.status, 201, grant.text);
      const inv = grant.json.invoice;
      assert.equal((await as.mandant.get(`/api/invoices/${inv.id}`)).json.invoice.caseId, null);
      assert.equal((await as.mandant.post(`/api/invoices/${inv.id}/payment-report`, {})).status, 200);
      assert.equal((await as.admin.post(`/api/invoices/${inv.id}/payment-reject`, { reason: 'Betrag fehlt.' })).status, 200);
      const dm = await waitFor(() => (stub().dms || []).find((m) => m.to === MEMBERS.jaywa && /noch nicht eingegangen/.test(m.embeds[0].title)), 'DM „nicht eingegangen“');
      assert.match(dm.embeds[0].description, /Betrag fehlt/);
      assert.equal((await as.mandant.post(`/api/invoices/${inv.id}/payment-report`, {})).status, 200);
      assert.equal((await as.admin.patch(`/api/invoices/${inv.id}`, { status: 'bezahlt' })).status, 200);
      await waitFor(() => (stub().dms || []).find((m) => m.to === MEMBERS.jaywa && /Zahlung eingegangen/.test(m.embeds[0].title)), 'DM „eingegangen“');
    });

    it('Einstellung „Antworten aus dem Ticket“ lässt sich ein- und ausschalten', async () => {
      const on = await as.admin.patch('/api/tickets/settings', { chatImport: true });
      assert.equal(on.status, 200, on.text);
      assert.equal(on.json.chatImport, true);
      const off = await as.admin.patch('/api/tickets/settings', { chatImport: false });
      assert.equal(off.json.chatImport, false);
    });
  });

  describe('Bewerbung: Zugang über Discord statt Zugangscode', () => {
    const applicant = '900000000000000161';
    it('ohne Zugangscode; „Discord verbinden“ schickt den Link zur Bewerberseite per DM', async () => {
      const web = client(server.base);
      const r = await web.post('/api/public/applications', {
        positionId: null,
        name: 'Lena Link',
        discord: 'lena.link',
        motivation: 'Ich möchte bei Pake & Scha als Associate einsteigen und meine Erfahrung im Strafrecht einbringen.',
        accept: true,
      });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.discord, true, 'Discord-Weg verfügbar');
      assert.equal(r.json.code, undefined, 'kein Zugangscode mehr');
      state.bw = r.json;
      const { authorize, cb } = await oauth(web, '/api/discord/application-join', applicant, { method: 'POST', form: { token: r.json.token } });
      assert.equal(authorize.searchParams.get('prompt'), 'consent');
      assert.equal(cb.location, `/bewerbung?discord=verbunden#${r.json.token}`);
      const dm = await waitFor(() => stub().dms.find((x) => x.to === applicant), 'Direktnachricht an den Bewerber');
      assert.match(dm.embeds[0].title, /Ihre Bewerberseite/);
      assert.match(dm.embeds[0].description, new RegExp(r.json.number));
      assert.equal(dm.components[0].components[0].url, `https://kanzlei.example/bewerbung#${r.json.token}`);
    });

    it('„Mit Discord öffnen“ führt auf einem anderen Gerät zur eigenen Bewerbung – ohne verbundene Bewerbung nicht', async () => {
      const { authorize, cb } = await oauth(client(server.base), '/api/discord/application-open', applicant);
      assert.equal(authorize.searchParams.get('scope'), 'identify', 'nur anmelden, kein Server-Beitritt');
      assert.equal(cb.location, `/bewerbung?discord=geoeffnet#${state.bw.token}`);
      assert.equal((await oauth(client(server.base), '/api/discord/application-open', '900000000000000162')).cb.location, '/bewerbung?discord=keine');
      // Die Bewerberseite meldet Discord als verfügbar und verbunden
      const portal = (await client(server.base).post('/api/public/application-portal', { token: state.bw.token })).json;
      assert.deepEqual(portal.discord, { connected: true, available: true });
    });
  });
  describe('Discord-Tickets: nur das Wichtige, Stand im Kanalnamen', () => {
    const titles = () => stub().channelMessages.filter((m) => m.channel === state.channel).map((m) => m.embeds && m.embeds[0] && m.embeds[0].title);
    it('Stand-Wechsel: keine Nachricht, aber das Zeichen vor dem Kanalnamen – zuschaltbar in den Einstellungen', async () => {
      const before = titles().length;
      assert.equal((await as.anwalt.patch(`/api/cases/${state.caseId}`, { step: 3 })).status, 200);
      const renamed = await waitFor(() => (stub().renames || []).find((r) => r.channel === state.channel && r.name.startsWith('⚖️・')), 'Kanalname mit ⚖️');
      assert.match(renamed.name, /^⚖️・ps-/);
      await sleep(300);
      assert.equal(titles().length, before, 'keine Nachricht für den Stand');
      // Ein Anhang kommt nicht mehr ins Ticket, eine Chat-Nachricht schon
      const note = await as.anwalt.post(`/api/cases/${state.caseId}/notes`, { body: 'Bitte morgen um 18 Uhr in die Kanzlei kommen.' });
      assert.equal(note.status, 201, note.text);
      await waitFor(() => titles().some((t) => /Nachricht von/.test(t || '')), 'Chat-Nachricht im Ticket');
      // Meldung „Stand geändert“ zuschalten → kommt wieder
      const s = await as.admin.patch('/api/tickets/settings', { events: { step: true } });
      assert.equal(s.json.events.step.on, true);
      assert.equal(s.json.events.attachment.on, false, 'Rest bleibt wie ab Werk');
      assert.equal((await as.anwalt.patch(`/api/cases/${state.caseId}`, { step: 2 })).status, 200);
      await waitFor(() => titles().some((t) => /Stand der Akte/.test(t || '')), 'Nachricht „Stand der Akte aktualisiert“');
      await as.admin.patch('/api/tickets/settings', { events: { step: false } });
    });
  });
  describe('Termin-Zusage per Knopf, Übergabe, Lesebestätigung, Live-Anzeige im Kanalnamen', () => {
    it('Termin für den Mandanten: DM mit „Passt“ / „Passt nicht“ – nur der Mandant antwortet, Verlegen fragt neu', async () => {
      const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
      const r = await as.anwalt.post('/api/calendar', { type: 'mandant', title: 'Besprechung Zeugenaussage', startsAt, caseId: state.caseId });
      assert.equal(r.status, 201, r.text);
      const id = r.json.event.id;
      const ask = () => stub().dms.filter((x) => x.to === MEMBERS.jaywa && (x.components || []).some((row) => row.components.some((b) => b.custom_id === `appt:yes:${id}`)));
      const dm = await waitFor(() => ask()[0], 'Direktnachricht mit Zusage-Knöpfen');
      assert.match(dm.embeds[0].title, /Besprechung Zeugenaussage/);
      // Ein anderer kann nicht antworten; der Mandant schon – auch ohne Server (Direktnachricht)
      assert.match(text(await click(MEMBERS.mo, `appt:yes:${id}`)), /nur der Mandant/);
      const yes = await interact({ guild_id: undefined, type: 3, user: { id: MEMBERS.jaywa, username: 'jay' }, data: { custom_id: `appt:yes:${id}`, component_type: 2 } });
      assert.match(text(yes), /Zusage ist bei der Kanzlei angekommen/);
      const ev = (await as.anwalt.get('/api/calendar')).json.events.find((e) => e.id === id);
      assert.equal(ev.clientResponse, 'zugesagt');
      // „Passt nicht“ → der zuständige Anwalt bekommt eine Direktnachricht
      await interact({ guild_id: undefined, type: 3, user: { id: MEMBERS.jaywa, username: 'jay' }, data: { custom_id: `appt:no:${id}`, component_type: 2 } });
      await waitFor(() => stub().dms.find((x) => x.to === MEMBERS.mo && /passt dem Mandanten nicht/.test(x.embeds[0].title)), 'DM an den Anwalt');
      // Verlegen: Antwort verfällt, neue Frage
      const moved = await as.anwalt.patch(`/api/calendar/${id}`, { startsAt: new Date(Date.now() + 4 * 86400000).toISOString() });
      assert.equal(moved.json.event.clientResponse, null);
      await waitFor(() => ask().length === 2, 'neue Frage nach dem Verlegen');
    });

    it('Lesebestätigung mit Uhrzeit: die Kanzlei sieht, wann der Mandant gelesen hat', async () => {
      const chat = (await as.anwalt.get(`/api/cases/${state.caseId}/chat`)).json;
      const last = chat.messages[chat.messages.length - 1].id;
      assert.equal((await as.mandant.post(`/api/cases/${state.caseId}/chat/read`, { lastId: last })).status, 200);
      const read = (await as.anwalt.get(`/api/cases/${state.caseId}/chat`)).json.read;
      assert.equal(read.other, last);
      assert.match(read.otherAt, /^\d{4}-\d\d-\d\d \d\d:\d\d/);
    });

    it('Übergabe an einen anderen Anwalt: Notiz intern, DM an den neuen, im Chat nur der neue Ansprechpartner', async () => {
      const r = await as.admin.patch(`/api/cases/${state.caseId}`, { lawyerId: as.admin.me.id, handover: 'Zeuge Miller morgen anrufen, Akteneinsicht läuft.' });
      assert.equal(r.status, 200, r.text);
      const detail = (await as.admin.get(`/api/cases/${state.caseId}`)).json;
      assert.ok(detail.notes.some((n) => n.internal && /Übergabe an .*Zeuge Miller/.test(n.body)), 'Übergabe intern im Verlauf');
      const chat = (await as.mandant.get(`/api/cases/${state.caseId}/chat`)).json.messages;
      const hint = chat[chat.length - 1].body;
      assert.match(hint, /Ihr neuer Ansprechpartner/);
      assert.doesNotMatch(hint, /Miller/, 'die Übergabe-Notiz sieht der Mandant nicht');
      // zurück an den Anwalt (verknüpftes Discord) → er bekommt die Übergabe per DM
      assert.equal((await as.admin.patch(`/api/cases/${state.caseId}`, { lawyerId: as.anwalt.me.id, handover: 'Bitte übernehmen.' })).status, 200);
      const dm = await waitFor(() => stub().dms.find((x) => x.to === MEMBERS.mo && /Akte übergeben/.test(x.embeds[0].title)), 'DM an den neuen Anwalt');
      assert.match(JSON.stringify(dm.embeds[0].fields), /Bitte übernehmen/);
    });

    it('Live-Anzeige: der Sprachkanal heißt „🟢 Im Dienst: N“', async () => {
      const bad = await as.admin.put('/api/bot/duty-channel', { channelId: '900000000000000777', template: 'Im Dienst' });
      assert.equal(bad.status, 400, 'ohne {anzahl}');
      const ok = await as.admin.put('/api/bot/duty-channel', { channelId: '900000000000000777', template: '🟢 Im Dienst: {anzahl}' });
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.json.dutyChannel.channelId, '900000000000000777');
      await waitFor(() => (stub().renames || []).find((x) => x.channel === '900000000000000777' && /^🟢 Im Dienst: \d+$/.test(x.name)), 'Kanal umbenannt');
    });
  });
  describe('Rabatt-Freigabe per Discord-Knopf', () => {
    it('Anfrage kommt als DM mit Genehmigen/Ablehnen ans Board; Klick entscheidet, die anfragende Person wird informiert', async () => {
      const boardDiscord = '900000000000000170';
      assert.match((await oauth(as.admin, '/api/discord/connect', boardDiscord)).cb.location, /discord=linked/);
      assert.equal((await as.admin.post('/api/discount-approvals/settings', { pct: 20 })).status, 200);
      const invoice = (extra = {}) => ({ caseId: state.caseId, items: [{ description: 'Beratung', quantity: 1, unitPrice: 10000 }], discountPct: 35, discountReason: 'Stammkunde seit Jahren', ...extra });
      const asked = await as.anwalt.post('/api/invoices', invoice());
      assert.equal(asked.status, 202, asked.text);
      assert.equal(asked.json.needsApproval, true);
      const id = asked.json.approval.id;
      const dm = await waitFor(() => stub().dms.find((x) => x.to === boardDiscord && (x.components || []).some((row) => row.components.some((b) => b.custom_id === `disc:yes:${id}`))), 'DM an das Board');
      assert.match(dm.embeds[0].description, /35 %/);
      assert.match(dm.embeds[0].description, /Stammkunde seit Jahren/);
      // wer kein Board ist (der Anwalt), darf nicht entscheiden
      assert.match(text(await interact({ guild_id: undefined, type: 3, user: { id: MEMBERS.mo, username: 'mo' }, data: { custom_id: `disc:yes:${id}`, component_type: 2 } })), /nur das Board/);
      assert.equal((await as.anwalt.post('/api/invoices', invoice({ approvalId: id }))).status, 409, 'noch nicht entschieden');
      assert.match(text(await interact({ guild_id: undefined, type: 3, user: { id: boardDiscord, username: 'board' }, data: { custom_id: `disc:yes:${id}`, component_type: 2 } })), /genehmigt/);
      await waitFor(() => stub().dms.find((x) => x.to === MEMBERS.mo && /Rabatt genehmigt/.test(x.embeds[0].title)), 'DM an die anfragende Person');
      assert.match(text(await interact({ guild_id: undefined, type: 3, user: { id: boardDiscord, username: 'board' }, data: { custom_id: `disc:no:${id}`, component_type: 2 } })), /schon entschieden/);
      // jetzt geht die Rechnung durch – einmal
      const made = await as.anwalt.post('/api/invoices', invoice({ approvalId: id }));
      assert.equal(made.status, 201, made.text);
      assert.equal(made.json.invoice.discountPct, 35);
      assert.equal((await as.anwalt.post('/api/invoices', invoice({ approvalId: id }))).status, 409, 'Freigabe ist verbraucht');
      assert.equal((await as.admin.post('/api/discount-approvals/settings', { pct: 0 })).status, 200);
    });
  });
  describe('Deal-Rechner, Prozessticket, Ticket-Verlauf', () => {
    it('Angebot der Staatsanwaltschaft: DM mit Annehmen/Ablehnen – nur der Mandant, Antwort steht in der Akte', async () => {
      assert.equal((await as.anwalt.post(`/api/cases/${state.caseId}/deals`, { note: 'ohne Zahlen' })).status, 400, 'HE oder Geldstrafe nötig');
      const r = await as.anwalt.post(`/api/cases/${state.caseId}/deals`, { he: 15, fine: 5000, note: 'Geständnis zu § 21' });
      assert.equal(r.status, 201, r.text);
      const id = r.json.deal.id;
      const dm = await waitFor(() => stub().dms.find((x) => x.to === MEMBERS.jaywa && (x.components || []).some((row) => row.components.some((b) => b.custom_id === `deal:yes:${id}`))), 'DM mit dem Angebot');
      assert.match(dm.embeds[0].description, /15 HE \+ 5\.000 \$/);
      assert.match(text(await interact({ guild_id: undefined, type: 3, user: { id: MEMBERS.mo, username: 'mo' }, data: { custom_id: `deal:yes:${id}`, component_type: 2 } })), /nur der Mandant/);
      assert.match(text(await interact({ guild_id: undefined, type: 3, user: { id: MEMBERS.jaywa, username: 'jay' }, data: { custom_id: `deal:yes:${id}`, component_type: 2 } })), /angenommen/);
      const detail = (await as.mandant.get(`/api/cases/${state.caseId}`)).json;
      assert.equal(detail.deals[0].status, 'angenommen');
      assert.equal(detail.deals[0].answeredVia, 'discord');
      assert.ok(detail.notes.some((n) => /Angebot der Staatsanwaltschaft \(15 HE \+ 5\.000 \$\) vom Mandanten angenommen – per Discord/.test(n.body)));
      assert.equal((await as.mandant.post(`/api/cases/${state.caseId}/deals/${id}/answer`, { accept: false })).status, 400, 'schon beantwortet');
      // Neues Angebot: Mandant lehnt im Portal ab
      const r2 = await as.anwalt.post(`/api/cases/${state.caseId}/deals`, { he: 10 });
      const no = await as.mandant.post(`/api/cases/${state.caseId}/deals/${r2.json.deal.id}/answer`, { accept: false });
      assert.equal(no.status, 200, no.text);
      assert.equal(no.json.deal.answeredVia, 'portal');
      assert.equal((await as.fremd.post(`/api/cases/${state.caseId}/deals/${r2.json.deal.id}/answer`, { accept: true })).status, 404, 'fremder Mandant');
    });

    it('Schriftsatz ins Prozessticket: Bot postet mit Dokument-Link (nur fertig unterschriebene)', async () => {
      const ch = '900000000000000888';
      assert.equal((await as.anwalt.put(`/api/cases/${state.caseId}/process-ticket`, { url: `https://discord.com/channels/${GUILD}/${ch}`, label: 'DOJ' })).status, 200);
      const tpl = (await as.anwalt.get('/api/contract-templates')).json.templates.find((t) => t.kind === 'schriftsatz' && /Akteneinsicht/.test(t.name));
      const k = (await as.anwalt.post(`/api/cases/${state.caseId}/contracts`, { templateId: tpl.id, lawyerId: as.anwalt.me.id, data: { empfaenger: 'District Court' } })).json.contract;
      assert.equal((await as.anwalt.post(`/api/contracts/${k.id}/process-ticket`)).status, 400, 'erst unterschreiben');
      assert.equal((await as.anwalt.post(`/api/contracts/${k.id}/sign`, { as: 'anwalt' })).status, 200);
      assert.equal((await as.mandant.post(`/api/contracts/${k.id}/process-ticket`)).status, 404, 'interner Schriftsatz: für den Mandanten unsichtbar');
      const r = await as.anwalt.post(`/api/contracts/${k.id}/process-ticket`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.posted, true);
      const msg = stub().channelMessages.find((x) => x.channel === ch);
      assert.match(msg.embeds[0].title, /Akteneinsicht/);
      assert.match(msg.embeds[0].description, /vertrag\?id=/);
    });

    it('Ticket mit /delete gelöscht: der Verlauf liegt vorher gesichert in der Akte (nur Kanzlei)', async () => {
      await interact({ type: 2, channel_id: state.channel, member: { user: { id: MEMBERS.mo, username: 'mo' } }, data: { name: 'delete', options: [] } });
      await click(MEMBERS.mo, `tdel:case:${state.caseId}`);
      const list = await waitFor(() => {
        return sql((db) => db.prepare('SELECT id, message_count FROM ticket_transcripts WHERE case_id = ?').get(state.caseId));
      }, 'gesicherter Verlauf', 8000);
      assert.ok(list.message_count > 0);
      const detail = (await as.anwalt.get(`/api/cases/${state.caseId}`)).json;
      assert.equal(detail.transcripts[0].id, list.id);
      assert.equal((await as.mandant.get(`/api/cases/${state.caseId}`)).json.transcripts, undefined, 'Mandant sieht keine Verläufe');
      assert.equal((await as.mandant.get(`/api/cases/${state.caseId}/transcripts/${list.id}`)).status, 404);
      const html = await as.anwalt.get(`/api/cases/${state.caseId}/transcripts/${list.id}`);
      assert.equal(html.status, 200);
      assert.match(html.text, /Ticket-Verlauf · PS-/);
      assert.match(html.headers ? html.headers.get('content-security-policy') || "default-src 'none'" : "default-src 'none'", /default-src 'none'/);
    });
  });
});
