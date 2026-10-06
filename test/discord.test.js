'use strict';
/*
 * Kanzlei-Bot gegen eine nachgebaute Discord-Schnittstelle (test/discordStub.js) – es geht nichts nach außen:
 *  - Willkommensnachricht genau einmal, auch wenn Discord die Beitrittszeit unterschiedlich genau liefert
 *  - Rollen für die Vorlagen-Vorschau (erwähnbar? darf der Bot alle Rollen pingen?)
 *  - Vorlage per Direktnachricht an alle Mitglieder einer Rolle, optional mit Website-Zugang
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

const STUB = path.join(__dirname, 'discordStub.js');
const { GUILD, ROLES, MEMBERS } = require('./discordStub'); // im Testprozess: Konstanten + abgefangene Aufrufe
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Willkommensnachricht', () => {
  it('kommt genau einmal – auch wenn die Beitrittszeit beim Abgleich anders formatiert ist', async () => {
    // Eigene Datenbank im Testprozess (bevor db.js geladen wird)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-welcome-'));
    process.env.DB_PATH = path.join(dir, 'w.db');
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    const stub = require('./discordStub');
    const { setSetting } = require('../db');
    const bot = require('../discordBot');
    setSetting('discord_ticket_guild', GUILD);
    const channel = '900000000000000500';
    setSetting('bot_welcome', JSON.stringify({ enabled: true, channelId: channel, since: new Date(Date.now() - 3600e3).toISOString(), content: 'Willkommen {user}!', embed: { enabled: false } }));

    const iso = new Date(Date.now() - 5 * 60e3).toISOString(); // z. B. 2026-10-06T17:28:01.393Z
    const user = { id: MEMBERS.jaywa, username: 'jaywa', global_name: 'Jaywa' };
    // Live-Ereignis (Gateway) mit Mikrosekunden, Abgleich (REST) mit Millisekunden – so kam die Nachricht doppelt
    await bot._test.handleJoin({ user, joined_at: iso.replace('Z', '449+00:00'), roles: [] });
    await bot._test.catchUpJoins([{ user, joined_at: iso.replace('Z', '000+00:00'), roles: [] }], { welcomed: 0, errors: [] });
    await bot._test.catchUpJoins([{ user, joined_at: iso, roles: [] }], { welcomed: 0, errors: [] });
    const welcomes = stub.state.channelMessages.filter((m) => m.channel === channel);
    assert.equal(welcomes.length, 1, JSON.stringify(welcomes));
    assert.equal(welcomes[0].content, `Willkommen <@${MEMBERS.jaywa}>!`);

    // Wer später erneut beitritt, wird wieder begrüßt
    await bot._test.catchUpJoins([{ user, joined_at: new Date(Date.now() - 60e3).toISOString(), roles: [] }], { welcomed: 0, errors: [] });
    assert.equal(stub.state.channelMessages.filter((m) => m.channel === channel).length, 2);
    assert.equal(bot._test.sameJoin('2026-10-06T17:28:01.393449+00:00', '2026-10-06T17:28:01.393000+00:00'), true);
    assert.equal(bot._test.sameJoin('2026-10-06T17:28:01+00:00', '2026-10-06T19:28:01+00:00'), false);
  });
});

describe('Nachrichten-Vorlagen: Rollen und Direktnachrichten', () => {
  let server;
  let admin;
  let stateFile;
  let tid;
  const stubState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  before(async () => {
    stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-discord-')), 'state.json');
    server = await startServer({
      env: { DISCORD_BOT_TOKEN: 'test-token', DISCORD_STUB_STATE: stateFile, BOT_DM_GAP_MS: '0', PUBLIC_URL: 'https://kanzlei.example' },
      preload: [STUB],
    });
    admin = client(server.base);
    await admin.login(TEAM.admin);
    const r = await admin.patch('/api/tickets/settings', { guildId: GUILD });
    assert.equal(r.status, 200, r.text);
  });
  after(async () => {
    if (server) await server.stop();
  });

  async function waitForRun(templateId) {
    for (let i = 0; i < 100; i++) {
      const { runs } = (await admin.get(`/api/bot/dm-runs?templateId=${templateId}`)).json;
      if (runs[0] && runs[0].status !== 'läuft') return runs[0];
      await sleep(100);
    }
    throw new Error('Versand wird nicht fertig');
  }

  it('liefert die Rollen mit „erwähnbar“ und ob der Bot alle Rollen pingen darf', async () => {
    const r = await admin.get('/api/bot/discord?refresh=1');
    assert.equal(r.status, 200, r.text);
    const byName = Object.fromEntries(r.json.roles.map((x) => [x.name, x]));
    assert.equal(byName.Burgershot.mentionable, false);
    assert.equal(byName.Mitarbeiter.mentionable, true);
    assert.equal(byName.Burgershot.color, '#e67e22');
    assert.equal(r.json.botMentionAll, false);
  });

  it('Vorlage anlegen; Empfänger-Vorschau zählt nur Menschen mit der Rolle', async () => {
    const r = await admin.post('/api/bot/messages', {
      name: 'Burgershot-Anleitung',
      data: {
        content: '',
        allowMentions: false,
        embed: { enabled: true, author: '', title: '🍔 So bekommst du den VIP-Preis', url: '', description: 'Anleitung für {server}', color: '#d4af37', thumbnail: 'none', thumbnailUrl: '', image: '', footer: 'Pake & Scha', timestamp: false, fields: [] },
        buttons: [],
      },
    });
    assert.equal(r.status, 201, r.text);
    tid = r.json.template.id;
    const p = await admin.get(`/api/bot/messages/${tid}/dm?roleId=${ROLES.burgershot}`);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.count, 3, 'zwei Bots ausgenommen');
    assert.deepEqual(p.json.members.map((m) => [m.name, m.username]), [['Closed Dms', 'closed'], ['John Jaywa', 'jaywa'], ['MO', 'mo']]);
    assert.deepEqual(p.json.accounts, { existing: 0, missing: 3, locked: 0 });
  });

  it('nur das Board darf Direktnachrichten verschicken', async () => {
    const lawyer = client(server.base);
    await lawyer.login(TEAM.anwalt);
    assert.equal((await lawyer.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: true })).status, 403);
  });

  it('Auswahl und Namen werden geprüft', async () => {
    const tooShort = await admin.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: true, recipients: [{ id: MEMBERS.jaywa, name: 'J' }] });
    assert.equal(tooShort.status, 400);
    assert.match(tooShort.json.error, /mindestens 2 Zeichen/);
    // Nur Mitglieder mit der Rolle zählen – wer sie nicht hat, wird nicht angeschrieben
    const none = await admin.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: true, recipients: [{ id: '900000000000000999' }] });
    assert.equal(none.status, 400);
    assert.equal((await admin.get('/api/bot/dm-runs')).json.runs.length, 0);
  });

  it('Versand mit Website-Zugang: neue Konten mit geprüftem Namen, verknüpftem Discord und Einmal-Passwort', async () => {
    const r = await admin.post(`/api/bot/messages/${tid}/dm`, {
      roleId: ROLES.burgershot,
      withLogin: true,
      // Name fürs Konto vom Board korrigiert; MO ohne Angabe → Spitzname
      recipients: [{ id: MEMBERS.jaywa, name: 'John Doe' }, { id: MEMBERS.mo }, { id: MEMBERS.closed, name: 'Carl Closed' }],
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.run.total, 3);
    const run = await waitForRun(tid);
    assert.equal(run.status, 'fertig');
    assert.equal(run.sent, 2);
    assert.equal(run.failed, 1);
    assert.equal(run.accountsCreated, 2);
    assert.deepEqual(run.problems, [{ name: 'Closed Dms', reason: 'nimmt keine Direktnachrichten an' }]);

    const dms = stubState().dms;
    assert.deepEqual(dms.map((d) => d.to).sort(), [MEMBERS.jaywa, MEMBERS.mo].sort());
    const jaywa = dms.find((d) => d.to === MEMBERS.jaywa);
    assert.equal(jaywa.embeds[0].title, '🍔 So bekommst du den VIP-Preis');
    assert.equal(jaywa.embeds[0].description, 'Anleitung für Testserver');
    assert.deepEqual(jaywa.allowed_mentions, { parse: [] });
    const access = jaywa.embeds[1];
    assert.match(access.description, /Discord ist bereits verknüpft/);
    const email = access.fields.find((f) => f.name === 'E-Mail-Adresse').value.replace(/`/g, '');
    const password = access.fields.find((f) => f.name === 'Einmal-Passwort').value.match(/\|\|`([^`]+)`\|\|/)[1];
    assert.equal(email, 'john.doe@pake-scha.ls');
    assert.match(access.description, /Hallo \*\*John Doe\*\*/);
    assert.deepEqual(jaywa.components.at(-1).components[0], { type: 2, style: 5, label: 'Zur Anmeldung', url: 'https://kanzlei.example/login.html' });

    // Mit den Zugangsdaten aus der Direktnachricht anmelden – neues Passwort ist Pflicht
    const john = client(server.base);
    const u = await john.login(email, password);
    assert.equal(u.role, 'mandant');
    assert.equal(u.displayName, 'John Doe');
    assert.equal(u.mustChangePassword, true);

    // Wer keine Direktnachrichten annimmt, bekommt auch kein Konto (das Passwort kennt niemand)
    const { users } = (await admin.get('/api/admin/users')).json;
    assert.ok(users.some((x) => x.email === 'mo@pake-scha.ls'));
    assert.ok(!users.some((x) => x.displayName === 'Carl Closed' || x.displayName === 'Closed Dms'), 'Konto wieder entfernt');
    assert.ok(!JSON.stringify((await admin.get('/api/bot/dm-runs')).json).includes(password), 'Passwort nirgends gespeichert');
  });

  it('zweiter Versand: vorhandene Konten behalten ihr Passwort', async () => {
    const before = stubState().dms.length;
    const r = await admin.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: true });
    assert.equal(r.status, 201, r.text);
    const run = await waitForRun(tid);
    assert.equal(run.accountsCreated, 0);
    assert.equal(run.accountsExisting, 2);
    const access = stubState().dms.slice(before).find((d) => d.to === MEMBERS.mo).embeds[1];
    assert.match(access.description, /bereits ein Konto/);
    assert.ok(!access.fields.some((f) => /Passwort$/.test(f.name) && /\|\|/.test(f.value)), 'kein neues Passwort');
    assert.equal((await admin.get('/api/bot/dm-runs')).json.runs.length, 2);
  });

  it('ohne Website-Zugang nur die Vorlage, nur an Ausgewählte; unbekannte Rolle wird abgelehnt', async () => {
    let before = stubState().dms.length;
    assert.equal((await admin.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: false, recipients: [{ id: MEMBERS.mo }] })).status, 201);
    assert.equal((await waitForRun(tid)).total, 1);
    assert.deepEqual(stubState().dms.slice(before).map((d) => d.to), [MEMBERS.mo]);
    before = stubState().dms.length;
    assert.equal((await admin.post(`/api/bot/messages/${tid}/dm`, { roleId: ROLES.burgershot, withLogin: false })).status, 201);
    await waitForRun(tid);
    const sent = stubState().dms.slice(before);
    assert.equal(sent.length, 2);
    assert.ok(sent.every((d) => d.embeds.length === 1 && !d.components.length));
    const bad = await admin.get(`/api/bot/messages/${tid}/dm?roleId=900000000000000999`);
    assert.equal(bad.status, 400);
  });
});
