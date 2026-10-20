'use strict';
/*
 * Namen direkt ändern: Das Board of Partners ändert Namen jeder Person ohne Antrag – Mandanten, Anwälte und andere
 * Board-Mitglieder. Die Änderung steht in der Historie, das Team-Profil zieht mit; ohne Board-Rechte geht es nicht.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

let server;
const as = {};

describe('Namen direkt ändern (Board of Partners)', () => {
  before(async () => {
    server = await startServer();
    for (const k of ['admin', 'partner', 'anwalt']) {
      as[k] = client(server.base);
      as[k].me = await as[k].login(TEAM[k]);
    }
    as.mandant = client(server.base);
    assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'max mustermann', email: 'max.namen', password: 'Mandanten-Passwort-9' })).status, 201);
    as.mandant.me = await as.mandant.login('max.namen', 'Mandanten-Passwort-9');
  });
  after(() => server && server.stop());

  it('findet Mandanten und Mitarbeiter – mit Rolle, Rang und „Sie“', async () => {
    const all = (await as.admin.get('/api/name-requests/accounts')).json.accounts;
    const by = (id) => all.find((a) => a.id === id);
    assert.equal(by(as.anwalt.me.id).role, 'anwalt');
    assert.equal(by(as.anwalt.me.id).rank, 'Senior Associate');
    assert.equal(by(as.partner.me.id).roleLabel, 'Board of Partners');
    assert.equal(by(as.admin.me.id).self, true);
    assert.equal(by(as.anwalt.me.id).self, false);
    const lastStaff = all.findLastIndex((a) => a.role !== 'mandant');
    const firstClient = all.findIndex((a) => a.role === 'mandant');
    assert.ok(firstClient === -1 || lastStaff < firstClient, 'Mitarbeiter zuerst');
    const found = (await as.admin.get('/api/name-requests/accounts?q=max.namen')).json.accounts;
    assert.deepEqual(
      found.map((a) => [a.id, a.role]),
      [[as.mandant.me.id, 'mandant']]
    );
  });

  it('ändert den Namen eines Anwalts direkt – Team-Profil, Historie und offener Antrag ziehen mit', async () => {
    const oldName = as.anwalt.me.displayName;
    const team = (await as.admin.get('/api/team')).json;
    const members = team.members || team.team || team;
    assert.ok(members.some((m) => m.name === oldName), 'Anwalt hat ein Team-Profil');
    // Der Anwalt hat genau diesen Namen beantragt → Antrag gilt als genehmigt, kein zweiter Eintrag
    assert.equal((await as.anwalt.post('/api/name-requests', { newName: 'Damat Lexington', reason: 'Neuer Charaktername' })).status, 201);
    const r = await as.admin.post('/api/name-requests/direct', { userId: as.anwalt.me.id, newName: 'Damat  Lexington', reason: 'Neuer Charaktername' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.displayName, 'Damat Lexington');
    assert.equal((await as.anwalt.get('/api/auth/me')).json.user.displayName, 'Damat Lexington');
    const after = (await as.admin.get('/api/team')).json;
    const list = after.members || after.team || after;
    assert.ok(list.some((m) => m.name === 'Damat Lexington'), 'Team-Profil zieht mit');
    assert.ok(!list.some((m) => m.name === oldName));
    const mine = (await as.anwalt.get('/api/name-requests/mine')).json.requests;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'genehmigt');
    assert.equal(mine[0].decidedBy, as.admin.me.displayName);
    // ein anderer Name ohne Antrag: eigener Historien-Eintrag „direkt geändert“
    assert.equal((await as.admin.post('/api/name-requests/direct', { userId: as.anwalt.me.id, newName: 'Damat Lex' })).status, 200);
    const hist = (await as.anwalt.get('/api/name-requests/mine')).json.requests;
    assert.equal(hist[0].direct, true);
    assert.equal(hist[0].oldName, 'Damat Lexington');
    assert.equal(hist[0].newName, 'Damat Lex');
    const audit = (await as.admin.get('/api/admin/audit')).json;
    assert.ok(JSON.stringify(audit).includes('Damat Lexington → Damat Lex'), 'im Protokoll');
  });

  it('auch Mandanten und andere Board-Mitglieder; Partner-Rang darf ebenso', async () => {
    const m = await as.admin.post('/api/name-requests/direct', { userId: as.mandant.me.id, newName: 'Max Mustermann' });
    assert.equal(m.status, 200, m.text);
    assert.equal((await as.mandant.get('/api/auth/me')).json.user.displayName, 'Max Mustermann');
    const b = await as.partner.post('/api/name-requests/direct', { userId: as.admin.me.id, newName: 'Alois Pake-Scha' });
    assert.equal(b.status, 200, b.text);
    assert.equal((await as.admin.get('/api/auth/me')).json.user.displayName, 'Alois Pake-Scha');
    const all = (await as.partner.get('/api/name-requests?status=alle')).json.requests;
    assert.ok(all.some((x) => x.userId === as.admin.me.id && x.direct && x.newName === 'Alois Pake-Scha'));
  });

  it('ohne Board-Rechte weder suchen noch ändern; gleicher Name, leerer Name und unbekanntes Konto abgelehnt', async () => {
    assert.equal((await as.anwalt.get('/api/name-requests/accounts')).status, 403);
    assert.equal((await as.anwalt.post('/api/name-requests/direct', { userId: as.mandant.me.id, newName: 'Max Muster' })).status, 403);
    assert.equal((await as.mandant.post('/api/name-requests/direct', { userId: as.mandant.me.id, newName: 'Max Muster' })).status, 403);
    assert.equal((await as.mandant.get('/api/auth/me')).json.user.displayName, 'Max Mustermann', 'unverändert');
    assert.equal((await as.admin.post('/api/name-requests/direct', { userId: as.mandant.me.id, newName: 'Max Mustermann' })).status, 400);
    assert.equal((await as.admin.post('/api/name-requests/direct', { userId: as.mandant.me.id, newName: ' ' })).status, 400);
    assert.equal((await as.admin.post('/api/name-requests/direct', { userId: 999999, newName: 'Niemand Hier' })).status, 404);
  });
});
