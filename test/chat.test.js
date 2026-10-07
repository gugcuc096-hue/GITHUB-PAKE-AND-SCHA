'use strict';
/*
 * Kommunikation: Nachrichten in der Akte (Kanzlei ↔ Mandant), Bewerberseite mit persönlichem Link und Nachrichten
 * zwischen Board und Bewerber (inkl. Discord-Direktnachricht über die nachgebaute Discord-Schnittstelle) sowie
 * VIP-/Lifetime-Preise im Mandatsvertrag.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM } = require('./helpers');

const STUB = path.join(__dirname, 'discordStub.js');
const { MEMBERS } = require('./discordStub');

describe('Nachrichten, Bewerberseite und VIP-Preise', () => {
  let server;
  let stateFile;
  const as = {};
  const state = {};
  const discordState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const sql = (fn) => {
    const db = new DatabaseSync(path.join(server.dir, 'test.db'));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };

  before(async () => {
    stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-chat-')), 'discord.json');
    server = await startServer({ env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_STUB_STATE: stateFile, PUBLIC_URL: 'https://kanzlei.example' }, preload: [STUB] });
    as.admin = client(server.base);
    as.anwalt = client(server.base);
    as.mandant = client(server.base);
    as.fremd = client(server.base);
    as.admin.me = await as.admin.login(TEAM.admin);
    as.anwalt.me = await as.anwalt.login(TEAM.anwalt);
    for (const [c, name, email] of [
      [as.mandant, 'Max Mustermann', 'max.mustermann'],
      [as.fremd, 'Erika Fremd', 'erika.fremd'],
    ]) {
      assert.equal((await c.post('/api/auth/register', { displayName: name, email, password: 'Mandanten-Passwort-1' })).status, 201);
      c.me = await c.login(email, 'Mandanten-Passwort-1');
    }
    const r = await as.anwalt.post('/api/cases', { title: 'Körperverletzung Würfelpark', area: 'strafrecht', clientEmail: 'max.mustermann' });
    assert.equal(r.status, 201, r.text);
    state.caseId = r.json.case.id;
  });
  after(async () => {
    if (server) await server.stop();
  });

  describe('Akte: Nachrichten Kanzlei ↔ Mandant', () => {
    it('Nachricht des Mandanten ist für den zuständigen Anwalt neu – nicht für andere', async () => {
      const r = await as.mandant.post(`/api/cases/${state.caseId}/notes`, { body: 'Ich habe noch Fotos vom Tatort.' });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.message.fromFirm, false);
      assert.equal(r.json.message.body, 'Ich habe noch Fotos vom Tatort.');
      state.clientMsg = r.json.id;
      assert.deepEqual((await as.anwalt.get('/api/cases/chat-unread')).json, { total: 1, cases: { [state.caseId]: 1 } });
      assert.equal((await as.admin.get('/api/cases/chat-unread')).json.total, 0, 'nicht im Aktenteam');
      const list = (await as.anwalt.get('/api/cases')).json.cases;
      assert.equal(list.find((c) => c.id === state.caseId).chatUnread, 1);
      // eigene Nachricht ist für den Mandanten nicht „neu“
      assert.equal((await as.mandant.get('/api/cases/chat-unread')).json.total, 0);
    });

    it('Akte liefert die Nachrichten; interne Notizen und Systemeinträge stehen nicht im Chat', async () => {
      await as.anwalt.post(`/api/cases/${state.caseId}/notes`, { body: 'Nur intern: Zeuge unzuverlässig.', internal: true });
      const d = (await as.anwalt.get(`/api/cases/${state.caseId}`)).json;
      assert.deepEqual(
        d.chat.messages.map((m) => m.body),
        ['Ich habe noch Fotos vom Tatort.']
      );
      const mine = (await as.mandant.get(`/api/cases/${state.caseId}`)).json;
      assert.ok(!mine.notes.some((n) => n.internal), 'Mandant sieht keine internen Notizen');
      assert.deepEqual(mine.chat.messages.map((m) => m.body), ['Ich habe noch Fotos vom Tatort.']);
    });

    it('Gelesen: Lesestand zählt, „gelesen“ für die Gegenseite, nie über die letzte Nachricht hinaus', async () => {
      assert.equal((await as.anwalt.post(`/api/cases/${state.caseId}/chat/read`, { lastId: state.clientMsg + 999 })).status, 200);
      assert.equal((await as.anwalt.get('/api/cases/chat-unread')).json.total, 0);
      const r = await as.anwalt.post(`/api/cases/${state.caseId}/notes`, { body: 'Bitte unter Beweismittel hochladen.' });
      assert.equal(r.status, 201);
      assert.equal(r.json.message.fromFirm, true);
      assert.equal(r.json.message.authorRank, 'Senior Associate');
      // Mandant: eine neue Nachricht; nachladen ab der eigenen
      assert.equal((await as.mandant.get('/api/cases/chat-unread')).json.total, 1);
      const poll = (await as.mandant.get(`/api/cases/${state.caseId}/chat?after=${state.clientMsg}`)).json;
      assert.deepEqual(poll.messages.map((m) => m.body), ['Bitte unter Beweismittel hochladen.']);
      assert.ok(poll.read.other >= state.clientMsg, 'Kanzlei hat die Nachricht des Mandanten gelesen');
      await as.mandant.post(`/api/cases/${state.caseId}/chat/read`, { lastId: r.json.id });
      assert.equal((await as.mandant.get('/api/cases/chat-unread')).json.total, 0);
      const forFirm = (await as.anwalt.get(`/api/cases/${state.caseId}/chat`)).json;
      assert.equal(forFirm.read.other, r.json.id, 'Mandant hat gelesen');
      // Lesestand liegt nie hinter der letzten Nachricht zurück und nie davor
      const stored = sql((db) => db.prepare('SELECT last_id FROM case_chat_reads WHERE case_id = ? AND user_id = ?').get(state.caseId, as.anwalt.me.id).last_id);
      assert.ok(stored <= r.json.id, `${stored} <= ${r.json.id}`);
    });

    it('Fremde sehen weder Nachrichten noch Lesestand', async () => {
      assert.equal((await as.fremd.get(`/api/cases/${state.caseId}/chat`)).status, 404);
      assert.equal((await as.fremd.post(`/api/cases/${state.caseId}/chat/read`, { lastId: 1 })).status, 404);
      assert.equal((await as.fremd.post(`/api/cases/${state.caseId}/notes`, { body: 'Hallo?' })).status, 404);
    });
  });

  describe('Mandatsvertrag: VIP-/Lifetime-Preise', () => {
    it('Vorbelegung nennt den Rabatt des Mandanten, der Vertrag weist ihn je Leistung aus', async () => {
      const none = (await as.anwalt.get(`/api/cases/${state.caseId}/contracts/defaults`)).json;
      assert.equal(none.discount, null, 'ohne Mitgliedschaft kein Rabatt');
      const tier = await as.admin.post('/api/memberships/tiers', { name: 'Gold', kind: 'vip', price: 50000, durationDays: 30, discountPct: 20 });
      assert.equal(tier.status, 201, tier.text);
      const grant = await as.admin.post('/api/memberships', { userId: as.mandant.me.id, tierId: tier.json.tier.id, invoice: false });
      assert.equal(grant.status, 201, grant.text);
      const d = (await as.anwalt.get(`/api/cases/${state.caseId}/contracts/defaults`)).json;
      assert.deepEqual(d.discount, { kind: 'vip', label: 'VIP Gold', pct: 20 });

      const { templates } = (await as.anwalt.get('/api/contract-templates')).json;
      const k = await as.anwalt.post(`/api/cases/${state.caseId}/contracts`, {
        templateId: templates.find((t) => t.key === 'mandatsvertrag').id,
        lawyerId: as.anwalt.me.id,
        data: {},
        services: [
          { name: 'Erstberatung', price: 12000, listPrice: 15000, discount: 'VIP Gold −20 %', qty: 1 },
          { name: 'Haftprüfung', price: 8000, listPrice: 10000, discount: 'VIP Gold −20 %', qty: 2 },
        ],
      });
      assert.equal(k.status, 201, k.text);
      const data = k.json.contract.data;
      assert.equal(data.leistungen, '• Erstberatung – 12.000 $ (VIP Gold −20 %, regulär 15.000 $)\n• 2 × Haftprüfung à 8.000 $ (VIP Gold −20 %, regulär 10.000 $) = 16.000 $');
      assert.equal(data.grundgebuehr, '28.000 $');
    });
  });

  describe('Bewerbung: persönliche Bewerberseite und Nachrichten', () => {
    it('Bewerbung liefert den persönlichen Link; Nummer + Code führen ebenfalls dorthin', async () => {
      const r = await client(server.base).post('/api/public/applications', {
        positionId: null,
        name: 'Joe Hampton',
        age: 31,
        discord: 'z0r3k_',
        motivation: 'Ich möchte meine Erfahrung als Staatsanwalt in die anwaltliche Beratung bei Pake & Scha einbringen.',
        accept: true,
      });
      assert.equal(r.status, 201, r.text);
      assert.match(r.json.token, /^[\w-]{30,}$/);
      assert.equal(r.json.portal, `/bewerbung.html#${r.json.token}`);
      Object.assign(state, { app: r.json });
      state.appId = (await as.admin.get('/api/admin/applications')).json.applications.find((a) => a.number === r.json.number).id;
      const access = await client(server.base).post('/api/public/application-access', { number: r.json.number.toLowerCase(), code: r.json.code });
      assert.equal(access.status, 200);
      assert.equal(access.json.token, r.json.token);
      assert.equal((await client(server.base).post('/api/public/application-access', { number: r.json.number, code: '000000' })).status, 404);
    });

    it('Bewerberseite: Stand und Nachrichten nur mit gültigem Link', async () => {
      const pub = client(server.base);
      const d = (await pub.post('/api/public/application-portal', { token: state.app.token })).json;
      assert.equal(d.number, state.app.number);
      assert.equal(d.status, 'eingegangen');
      assert.deepEqual(d.messages, []);
      assert.equal(d.discord.connected, false);
      assert.equal((await pub.post('/api/public/application-portal', { token: 'x'.repeat(32) })).status, 404);
      assert.equal((await pub.post('/api/public/application-portal', { token: 'kurz' })).status, 400);
    });

    it('Nachricht des Bewerbers: Board sieht sie als neu, beim Öffnen gelesen', async () => {
      const r = await client(server.base).post('/api/public/application-portal/messages', { token: state.app.token, body: 'Wann kann ich mit einer Rückmeldung rechnen?' });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.message.fromBoard, false);
      const row = () => as.admin.get('/api/admin/applications').then((x) => x.json.applications.find((a) => a.id === state.appId));
      assert.equal((await row()).unreadMessages, 1);
      const detail = (await as.admin.get(`/api/admin/applications/${state.appId}`)).json;
      assert.deepEqual(detail.messages.map((m) => m.body), ['Wann kann ich mit einer Rückmeldung rechnen?']);
      assert.equal(detail.portal, state.app.portal);
      assert.equal((await row()).unreadMessages, 0, 'beim Öffnen gelesen');
      assert.equal((await as.anwalt.get(`/api/admin/applications/${state.appId}`)).status, 403, 'nur Board of Partners');
    });

    it('Antwort des Boards erscheint auf der Bewerberseite; mit Discord auch als Direktnachricht', async () => {
      let r = await as.admin.post(`/api/admin/applications/${state.appId}/messages`, { body: 'Danke! Wir melden uns bis Freitag.' });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.discordSent, false, 'ohne verbundenes Discord keine Direktnachricht');
      const d = (await client(server.base).post('/api/public/application-portal', { token: state.app.token, after: 0 })).json;
      assert.deepEqual(d.messages.map((m) => [m.fromBoard, m.body]), [
        [false, 'Wann kann ich mit einer Rückmeldung rechnen?'],
        [true, 'Danke! Wir melden uns bis Freitag.'],
      ]);
      assert.equal(d.messages[1].author, as.admin.me.displayName);
      // Bewerber hat beim Öffnen gelesen → Board sieht „gelesen“
      assert.equal((await as.admin.get(`/api/admin/applications/${state.appId}/messages?after=${d.messages[1].id}`)).json.applicantRead, d.messages[1].id);

      // Discord verbunden (wie nach „Discord verbinden“ auf der Bewerberseite)
      sql((db) => db.prepare('UPDATE applications SET discord_user_id = ? WHERE id = ?').run(MEMBERS.jaywa, state.appId));
      r = await as.admin.post(`/api/admin/applications/${state.appId}/messages`, { body: 'Passt Ihnen Samstag?' });
      assert.equal(r.json.discordSent, true);
      const dm = discordState().dms.filter((x) => x.to === MEMBERS.jaywa).pop();
      assert.equal(dm.embeds[0].description, 'Passt Ihnen Samstag?');
      assert.equal(dm.components[0].components[0].url, `https://kanzlei.example${state.app.portal}`);
    });

    it('Gesprächseinladung und neuer Stand kommen als Nachricht bzw. Direktnachricht an', async () => {
      const startsAt = new Date(Date.now() + 2 * 864e5).toISOString();
      const r = await as.admin.post(`/api/admin/applications/${state.appId}/interview`, { startsAt, location: 'Kanzlei Würfelpark' });
      assert.equal(r.status, 200, r.text);
      const d = (await client(server.base).post('/api/public/application-portal', { token: state.app.token })).json;
      assert.equal(d.status, 'gespraech');
      assert.equal(d.interviewAt, startsAt);
      assert.match(d.messages.at(-1).body, /^Wir laden Sie zum Bewerbungsgespräch ein: .+ · Ort: Kanzlei Würfelpark\./);
      await new Promise((res) => setTimeout(res, 200));
      assert.match(discordState().dms.filter((x) => x.to === MEMBERS.jaywa).pop().embeds[0].title, /Einladung zum Bewerbungsgespräch/);

      await as.admin.patch(`/api/admin/applications/${state.appId}`, { status: 'abgelehnt' });
      await new Promise((res) => setTimeout(res, 200));
      assert.match(discordState().dms.filter((x) => x.to === MEMBERS.jaywa).pop().embeds[0].description, /Abgelehnt/);
      // Alte Statusabfrage funktioniert weiter (Nachricht = letzte Nachricht des Boards)
      const old = await client(server.base).post('/api/public/application-status', { number: state.app.number, code: state.app.code });
      assert.equal(old.status, 200);
      assert.match(old.json.publicNote, /Bewerbungsgespräch/);
      assert.equal(old.json.portal, state.app.portal);
    });

    it('Bewerber-Discord verbinden: nur von der eigenen Website und mit gültigem Link', async () => {
      const post = (token, origin) =>
        fetch(`${server.base}/api/discord/application-join`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) },
          body: new URLSearchParams({ token }).toString(),
        });
      assert.equal((await post(state.app.token, 'https://boese.example')).status, 403, 'fremde Seite blockiert');
      assert.equal((await post('x'.repeat(32))).headers.get('location'), '/bewerbung.html?discord=notfound');
      // gültig, aber Discord-Anmeldung (OAuth) ist im Test nicht eingerichtet
      assert.equal((await post(state.app.token)).headers.get('location'), '/bewerbung.html?discord=disabled');
    });
  });
});
