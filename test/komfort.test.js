'use strict';
/*
 * Dienststatus der zuständigen Anwälte in der Akte („im Dienst“ für Kanzlei und Mandant; für Mandanten nur, wenn der
 * Dienststatus auch öffentlich angezeigt wird).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

let server;
const as = {};
const data = {};

before(async () => {
  server = await startServer();
  as.admin = client(server.base);
  as.anwalt = client(server.base);
  as.admin.me = await as.admin.login(TEAM.admin);
  as.anwalt.me = await as.anwalt.login(TEAM.anwalt);
  as.mandant = client(server.base);
  assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'Dora Dienst', email: 'dora.dienst', password: 'Mandanten-Passwort-7' })).status, 201);
  await as.mandant.login('dora.dienst', 'Mandanten-Passwort-7');
  data.caseId = (await as.mandant.post('/api/cases', { title: 'Abgeschlepptes Fahrzeug', area: 'zivilrecht', description: 'Mein Auto wurde ohne Grund abgeschleppt.' })).json.case.id;
  assert.equal((await as.admin.patch(`/api/cases/${data.caseId}`, { lawyerId: as.anwalt.me.id, coLawyerIds: [as.admin.me.id] })).status, 200);
});
after(async () => {
  if (server) await server.stop();
});

const dutyOf = async (who) => (await who.get(`/api/cases/${data.caseId}`)).json.case.lawyerDuty;

describe('Dienststatus in der Akte', () => {
  it('außer Dienst: nichts angezeigt', async () => {
    assert.deepEqual(await dutyOf(as.admin), {});
    assert.deepEqual(await dutyOf(as.mandant), {});
  });

  it('im Dienst bzw. im Gericht: Kanzlei und Mandant sehen es je Anwalt', async () => {
    assert.equal((await as.anwalt.post('/api/duty', { status: 'dienst' })).status, 200);
    assert.equal((await as.admin.post('/api/duty', { status: 'gericht' })).status, 200);
    const expected = { [as.anwalt.me.id]: 'dienst', [as.admin.me.id]: 'gericht' };
    assert.deepEqual(await dutyOf(as.admin), expected);
    assert.deepEqual(await dutyOf(as.mandant), expected);
  });

  it('Dienststatus nicht öffentlich: Mandant sieht ihn auch in der Akte nicht, die Kanzlei schon', async () => {
    assert.equal((await as.admin.patch('/api/admin/settings', { showDutyPublic: false })).status, 200);
    assert.deepEqual(await dutyOf(as.mandant), {});
    assert.equal(Object.keys(await dutyOf(as.anwalt)).length, 2);
    await as.admin.patch('/api/admin/settings', { showDutyPublic: true });
  });

  it('ausgestempelt: wieder nichts', async () => {
    await as.anwalt.post('/api/duty', { status: 'off' });
    await as.admin.post('/api/duty', { status: 'off' });
    assert.deepEqual(await dutyOf(as.mandant), {});
  });
});
