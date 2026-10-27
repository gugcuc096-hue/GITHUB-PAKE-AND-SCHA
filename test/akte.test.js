'use strict';
/*
 * Aufgeräumte Akte: kurze Titel bei Website-Anfragen, Beteiligte mit Interessenkonflikt-Hinweis,
 * Änderungen der Stammdaten einzeln per PATCH (Grundlage für „Rückgängig“ und Direktbearbeitung).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');
const { intakeTitle } = require('../caseTitles');

let server;
const as = {};
const id = {};

before(async () => {
  server = await startServer();
  for (const k of ['admin', 'partner', 'anwalt']) {
    as[k] = client(server.base);
    await as[k].login(TEAM[k]);
  }
  id.a = (await as.admin.post('/api/cases', { title: 'Raub am Pillbox Hill', area: 'strafrecht', clientName: 'Paul Weber' })).json.case.id;
  id.b = (await as.admin.post('/api/cases', { title: 'Mietstreit Vespucci', area: 'zivilrecht', clientName: 'Lena Fuchs', opponent: 'Paul Weber' })).json.case.id;
});
after(async () => {
  if (server) await server.stop();
});

describe('Kurze Titel', () => {
  it('Website-Anfrage bekommt „Rechtsgebiet – Name“, der Text bleibt im Sachverhalt', async () => {
    const text = 'Ich wurde gestern in Davis festgenommen und brauche dringend anwaltliche Unterstützung, bitte meldet euch.';
    const r = await client(server.base).post('/api/public/cases', { name: 'Erika Musterfrau', area: 'strafrecht', description: text });
    assert.equal(r.status, 201, r.text);
    const list = await as.admin.get('/api/cases');
    const c = list.json.cases.find((x) => x.caseNumber === r.json.caseNumber);
    assert.equal(c.title, 'Strafrecht / Festnahme – Erika Musterfrau');
    const detail = await as.admin.get(`/api/cases/${c.id}`);
    assert.equal(detail.json.case.description, text);
  });

  it('intakeTitle kürzt auf 110 Zeichen und kommt ohne Namen aus', () => {
    assert.equal(intakeTitle('sonstiges', ''), 'Sonstiges Anliegen');
    assert.equal(intakeTitle('xyz', 'A'), 'Sonstiges Anliegen – A');
    assert.ok(intakeTitle('strafrecht', 'x'.repeat(300)).length <= 110);
  });
});

describe('Beteiligte', () => {
  it('Kanzlei legt Beteiligte an, ändert und löscht sie', async () => {
    const r = await as.admin.post(`/api/cases/${id.a}/parties`, { role: 'zeuge', name: 'Hans Zeuge', contact: 'Tel. 555-0100' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.parties.length, 1);
    const pid = r.json.parties[0].id;
    const p = await as.admin.patch(`/api/cases/${id.a}/parties/${pid}`, { role: 'gericht', name: 'LSSD Gericht' });
    assert.equal(p.status, 200);
    assert.equal(p.json.parties[0].role, 'gericht');
    const d = await as.admin.get(`/api/cases/${id.a}`);
    assert.equal(d.json.parties.length, 1);
    const del = await as.admin.del(`/api/cases/${id.a}/parties/${pid}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.parties.length, 0);
  });

  it('prüft Rolle und Name', async () => {
    assert.equal((await as.admin.post(`/api/cases/${id.a}/parties`, { role: 'kaffee', name: 'Hans' })).status, 400);
    assert.equal((await as.admin.post(`/api/cases/${id.a}/parties`, { role: 'zeuge', name: 'H' })).status, 400);
  });

  it('Mandanten sehen die Beteiligten nicht und können sie nicht anlegen', async () => {
    const m = client(server.base);
    await m.post('/api/auth/register', { displayName: 'Nina Neu', email: 'nina.neu', password: 'Mandanten-Passwort-5' });
    await m.login('nina.neu', 'Mandanten-Passwort-5');
    assert.equal((await m.post(`/api/cases/${id.a}/parties`, { role: 'zeuge', name: 'Hans Zeuge' })).status, 404);
  });

  it('Gegenpartei = Mandant einer anderen Akte wird als Überschneidung gemeldet', async () => {
    const r = await as.admin.get(`/api/cases/${id.b}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.overlaps.opponent.some((o) => o.caseId === id.a), 'Gegenpartei „Paul Weber“ ist Mandant in Akte A');
    const a = await as.admin.get(`/api/cases/${id.a}`);
    assert.ok(a.json.overlaps.client.some((o) => o.caseId === id.b), 'Mandant von A ist Gegenpartei in B');
  });
});

describe('Direktbearbeitung', () => {
  it('einzelne Felder lassen sich per PATCH ändern und zurücksetzen', async () => {
    const before = (await as.admin.get(`/api/cases/${id.a}`)).json.case;
    const r = await as.admin.patch(`/api/cases/${id.a}`, { courtRef: 'LS-2026/77', opponent: 'Staatsanwaltschaft' });
    assert.equal(r.status, 200, r.text);
    const now = (await as.admin.get(`/api/cases/${id.a}`)).json.case;
    assert.equal(now.courtRef, 'LS-2026/77');
    assert.equal(now.opponent, 'Staatsanwaltschaft');
    assert.equal(now.title, before.title);
    await as.admin.patch(`/api/cases/${id.a}`, { courtRef: before.courtRef || '', opponent: before.opponent || '' });
    assert.equal((await as.admin.get(`/api/cases/${id.a}`)).json.case.courtRef, before.courtRef || '');
  });
});
