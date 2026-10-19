'use strict';
/*
 * Kanzlei-Lager (Gegenstände, Geld, Schwarzgeld), verknüpfte Akten mit gemeinsamer Beweismappe, Laufzettel und die
 * Discord-Rolle „Mandant mit offener Akte“.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Discord-Rolle „Mandant mit offener Akte“', () => {
  it('kommt mit der offenen Akte (Konto oder Ticket-Discord), geht mit dem Abschluss – andere Rollen bleiben', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-rolle-'));
    process.env.DB_PATH = path.join(dir, 'r.db');
    const { db, setSetting } = require('../db');
    const bot = require('../discordBot');
    const ROLE = '900000000000000951';
    const OTHER = '900000000000000952';
    setSetting('bot_rank_sync', JSON.stringify({ enabled: true, ranks: {}, clientOpen: ROLE }));
    const withAccount = '900000000000000301';
    const ticketOnly = '900000000000000302';
    const uid = Number(db.prepare("INSERT INTO users (email, password_hash, display_name, role, discord_id) VALUES ('m@x.ls', 'x', 'Max Mandant', 'mandant', ?)").run(withAccount).lastInsertRowid);
    const a = Number(db.prepare("INSERT INTO cases (case_number, access_pin, title, client_id, status) VALUES ('PS-R-1', '1', 'Akte A', ?, 'in_bearbeitung')").run(uid).lastInsertRowid);
    db.prepare("INSERT INTO cases (case_number, access_pin, title, client_name, status, discord_client_id) VALUES ('PS-R-2', '2', 'Akte B', 'Tom Ticket', 'offen', ?)").run(ticketOnly);
    const roles = (id, cur = [OTHER]) => [...bot._test.desiredRoles(id, cur)];
    assert.deepEqual(roles(withAccount).sort(), [OTHER, ROLE].sort());
    assert.deepEqual(roles(ticketOnly).sort(), [OTHER, ROLE].sort());
    assert.deepEqual(roles('900000000000000303'), [OTHER], 'ohne Akte: nichts dazu');
    db.prepare("UPDATE cases SET status = 'geschlossen' WHERE id = ?").run(a);
    assert.deepEqual(roles(withAccount, [OTHER, ROLE]), [OTHER], 'Akte abgeschlossen → Rolle weg, andere bleibt');
  });
});

let server;
const as = {};
const data = {};

describe('Kanzlei-Lager & verknüpfte Akten', () => {
  before(async () => {
    server = await startServer();
    for (const k of ['admin', 'partner', 'anwalt']) {
      as[k] = client(server.base);
      as[k].me = await as[k].login(TEAM[k]);
    }
    as.mandant = client(server.base);
    assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'Lena Lager', email: 'lena.lager', password: 'Mandanten-Passwort-9' })).status, 201);
    await as.mandant.login('lena.lager', 'Mandanten-Passwort-9');
    for (const [k, title] of [
      ['a', 'Schießerei am Pier – Fahrer'],
      ['b', 'Schießerei am Pier – Beifahrer'],
    ]) {
      const c = await as.anwalt.post('/api/cases', { title, area: 'strafrecht', ...(k === 'a' ? { clientEmail: 'lena.lager' } : { clientName: 'Bernd Beifahrer' }) });
      assert.equal(c.status, 201, c.text);
      data[k] = c.json.case;
    }
  });
  after(async () => {
    if (server) await server.stop();
  });

  it('Gegenstände legt nur ein Admin an (Name + Bild); Mandanten sehen das Lager nicht', async () => {
    assert.equal((await as.anwalt.post('/api/storage/items', { name: 'Schutzweste' })).status, 403);
    const r = await as.admin.post('/api/storage/items', { name: 'Schutzweste' });
    assert.equal(r.status, 201, r.text);
    data.item = r.json.item;
    assert.equal((await as.admin.post('/api/storage/items', { name: 'schutzweste' })).status, 400, 'doppelt');
    const img = await as.admin.upload(`/api/storage/items/${data.item.id}/image`, PNG, 'image/png');
    assert.equal(img.status, 200, img.text);
    assert.match(img.json.item.imageUrl, /^\/media\/items\/[a-f0-9]+\.png$/);
    assert.equal((await fetch(server.base + img.json.item.imageUrl)).status, 200);
    assert.equal((await as.mandant.get('/api/storage')).status, 403);
  });

  it('Einlagern und Entnehmen – nicht mehr als vorhanden; Buchungen mit Name', async () => {
    let r = await as.anwalt.post('/api/storage/entries', { kind: 'item', itemId: data.item.id, direction: 'in', amount: 5, note: 'aus Razzia' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.items.find((i) => i.id === data.item.id).stock, 5);
    r = await as.anwalt.post('/api/storage/entries', { kind: 'item', itemId: data.item.id, direction: 'out', amount: 6 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /vorhanden: 5/);
    await as.anwalt.post('/api/storage/entries', { kind: 'geld', direction: 'in', amount: 25000, note: 'Honorar' });
    r = await as.anwalt.post('/api/storage/entries', { kind: 'geld', direction: 'out', amount: 5000 });
    assert.equal(r.json.money, 20000);
    assert.equal(r.json.entries[0].userName, as.anwalt.me.displayName || r.json.entries[0].userName);
    assert.equal(r.json.entries[0].amount, -5000);
  });

  it('Schwarzgeld: nur das Board – bis die Einstellung es für alle freigibt', async () => {
    assert.equal((await as.anwalt.post('/api/storage/entries', { kind: 'schwarzgeld', direction: 'in', amount: 1000 })).status, 403);
    const view = (await as.anwalt.get('/api/storage')).json;
    assert.equal(view.black, null);
    assert.equal(view.canBlack, false);
    const r = await as.partner.post('/api/storage/entries', { kind: 'schwarzgeld', direction: 'in', amount: 9000 });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.black, 9000);
    assert.ok(!(await as.anwalt.get('/api/storage')).json.entries.some((e) => e.kind === 'schwarzgeld'), 'Buchungen ebenfalls verborgen');
    assert.equal((await as.admin.put('/api/storage/settings', { blackAll: true })).status, 200);
    assert.equal((await as.anwalt.get('/api/storage')).json.black, 9000);
    await as.admin.put('/api/storage/settings', { blackAll: false });
  });

  it('Storno nur durchs Board; ein entfernter Gegenstand bleibt im Verlauf', async () => {
    const list = (await as.partner.get('/api/storage')).json;
    const e = list.entries.find((x) => x.kind === 'geld' && x.amount === -5000);
    assert.equal((await as.anwalt.del('/api/storage/entries/' + e.id)).status, 403);
    const r = await as.partner.del('/api/storage/entries/' + e.id);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.money, 25000);
    assert.equal((await as.admin.del('/api/storage/items/' + data.item.id)).status, 200);
    const after = (await as.anwalt.get('/api/storage')).json;
    assert.ok(after.items.some((i) => i.id === data.item.id && !i.active && i.stock === 5), 'noch 5 im Lager – bleibt sichtbar');
    assert.equal((await as.anwalt.post('/api/storage/entries', { kind: 'item', itemId: data.item.id, direction: 'in', amount: 1 })).status, 400, 'nicht mehr einlagerbar');
    assert.equal((await as.anwalt.post('/api/storage/entries', { kind: 'item', itemId: data.item.id, direction: 'out', amount: 5 })).status, 201, 'aber noch entnehmbar');
  });

  it('Akten verknüpfen: gegenseitig sichtbar, gemeinsame Beweismappe nur für die Kanzlei, Laufzettel', async () => {
    const up = await as.anwalt.upload(`/api/cases/${data.b.id}/attachments?caption=Bodycam&internal=1`, PNG, 'image/png');
    assert.equal(up.status, 201, up.text);
    assert.equal((await as.mandant.post(`/api/cases/${data.a.id}/links`, { otherId: data.b.id })).status, 404, 'Mandant');
    assert.equal((await as.anwalt.post(`/api/cases/${data.a.id}/links`, { otherId: data.a.id })).status, 400, 'nicht mit sich selbst');
    const r = await as.anwalt.post(`/api/cases/${data.a.id}/links`, { otherId: data.b.id });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.links[0].caseNumber, data.b.caseNumber);
    assert.equal((await as.anwalt.post(`/api/cases/${data.b.id}/links`, { otherId: data.a.id })).status, 200, 'schon verknüpft');
    const a = (await as.anwalt.get(`/api/cases/${data.a.id}`)).json;
    assert.equal(a.links.length, 1);
    assert.equal(a.linkedEvidence[0].caseNumber, data.b.caseNumber);
    assert.equal(a.linkedEvidence[0].attachments[0].no, 1);
    assert.equal(a.linkedEvidence[0].attachments[0].caption, 'Bodycam');
    assert.ok(a.routing.length >= 1 && a.routing[0].count >= 1, 'Laufzettel');
    const b = (await as.anwalt.get(`/api/cases/${data.b.id}`)).json;
    assert.equal(b.links[0].id, data.a.id, 'gegenseitig');
    assert.ok(b.notes.some((n) => n.internal && /verknüpft mit/.test(n.body)));
    const m = (await as.mandant.get(`/api/cases/${data.a.id}`)).json;
    assert.equal(m.links, undefined);
    assert.equal(m.linkedEvidence, undefined);
    assert.equal(m.routing, undefined);
    assert.ok(!m.notes.some((n) => /verknüpft/.test(n.body)), 'Verlaufseintrag ist intern');
    assert.equal((await as.anwalt.del(`/api/cases/${data.b.id}/links/${data.a.id}`)).status, 200);
    assert.equal((await as.anwalt.get(`/api/cases/${data.a.id}`)).json.links.length, 0);
  });
});
