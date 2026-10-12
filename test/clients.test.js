'use strict';
/*
 * Mandantenkartei: Zuordnung (Konto, Akten ohne Konto mit gleichem Namen, Rechnungen), Summen, interne Notizen,
 * Vermerk (nur Board) mit Hinweis in der Akte – und dass Mandanten davon nichts sehen.
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
  await as.admin.login(TEAM.admin);
  await as.anwalt.login(TEAM.anwalt);
  as.mandant = client(server.base);
  const reg = await as.mandant.post('/api/auth/register', { displayName: 'Victor Rossi', email: 'victor.rossi', password: 'Mandanten-Passwort-7' });
  assert.equal(reg.status, 201, reg.text);
  data.victorId = (await as.mandant.login('victor.rossi', 'Mandanten-Passwort-7')).id;
  // Akte im Portal (mit Konto) …
  data.case1 = (await as.mandant.post('/api/cases', { title: 'Festnahme am Legion Square', area: 'strafrecht', description: 'Ich wurde ohne Grund festgenommen.' })).json.case.id;
  // … und eine von der Kanzlei ohne Konto angelegte Akte mit demselben Namen
  const k2 = await as.admin.post('/api/cases', { title: 'Mietstreit Vinewood', area: 'zivilrecht', clientName: 'victor  ROSSI' });
  assert.equal(k2.status, 201, k2.text);
  data.case2 = k2.json.case.id;
  // Mandantin ganz ohne Konto
  data.case3 = (await as.admin.post('/api/cases', { title: 'Verkehrsunfall Del Perro', area: 'zivilrecht', clientName: 'Erika Ohnekonto' })).json.case.id;
  const inv = (body) => as.admin.post('/api/invoices', { items: [{ description: 'Beratung', quantity: 1, unitPrice: 1000 }], ...body });
  data.inv1 = (await inv({ caseId: data.case1, items: [{ description: 'Beratung', quantity: 1, unitPrice: 15000 }] })).json.invoice.id;
  data.inv2 = (await inv({ caseId: data.case2, items: [{ description: 'Vertretung', quantity: 1, unitPrice: 5000 }] })).json.invoice.id;
  assert.equal((await as.admin.patch(`/api/invoices/${data.inv2}`, { status: 'bezahlt' })).status, 200);
  data.inv3 = (await inv({ clientName: 'Erika Ohnekonto', items: [{ description: 'Beratung', quantity: 1, unitPrice: 2000 }] })).json.invoice.id;
});
after(async () => {
  if (server) await server.stop();
});

describe('Mandantenkartei', () => {
  it('nur für die Kanzlei', async () => {
    assert.equal((await as.mandant.get('/api/clients')).status, 403);
    assert.equal((await as.mandant.get(`/api/clients/u${data.victorId}`)).status, 403);
    assert.equal((await client(server.base).get('/api/clients')).status, 401);
  });

  it('Liste: Konto und Akte ohne Konto mit gleichem Namen gehören zusammen, Summen stimmen', async () => {
    const r = await as.anwalt.get('/api/clients');
    assert.equal(r.status, 200, r.text);
    const victor = r.json.clients.find((c) => c.key === `u${data.victorId}`);
    assert.ok(victor, JSON.stringify(r.json.clients));
    assert.equal(victor.name, 'Victor Rossi');
    assert.equal(victor.hasAccount, true);
    assert.equal(victor.casesTotal, 2);
    assert.equal(victor.casesOpen, 2);
    assert.equal(victor.openSum, 15000);
    assert.equal(r.json.clients.filter((c) => /victor/i.test(c.name)).length, 1, 'kein zweiter Eintrag für den Namen');
    const erika = r.json.clients.find((c) => c.name === 'Erika Ohnekonto');
    assert.equal(erika.hasAccount, false);
    assert.equal(erika.key, 'n:erika ohnekonto');
    assert.equal(erika.casesTotal, 1);
    assert.equal(erika.openSum, 2000, 'Rechnung ohne Akte über den Namen zugeordnet');
  });

  it('Karte: Akten, Rechnungen, Verträge, Summen – auch über den Namen erreichbar', async () => {
    const r = await as.anwalt.get(`/api/clients/u${data.victorId}`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.cases.map((c) => c.id).sort(), [data.case1, data.case2].sort());
    assert.deepEqual(r.json.invoices.map((i) => i.id).sort(), [data.inv1, data.inv2].sort());
    assert.deepEqual(r.json.stats, { casesOpen: 2, casesTotal: 2, openSum: 15000, openCount: 1, paidSum: 5000 });
    assert.equal(r.json.account.email, 'victor.rossi@pake-scha.ls');
    assert.equal(r.json.flag, null);
    assert.equal(r.json.canFlag, false, 'Vermerk setzt nur das Board');
    const byName = await as.anwalt.get(`/api/clients/${encodeURIComponent('n:Victor Rossi')}`);
    assert.equal(byName.json.key, `u${data.victorId}`, 'Name führt zum Konto');
    assert.equal((await as.anwalt.get(`/api/clients/${encodeURIComponent('n:Niemand Unbekannt')}`)).status, 404);
    // Akte kennt ihren Mandanten (für den Link in der Akte)
    const det = (await as.anwalt.get(`/api/cases/${data.case2}`)).json.case;
    assert.equal(det.clientKey, 'n:victor rossi');
  });

  it('interne Notizen: Kanzlei schreibt, nur eigene löschen (Board alle)', async () => {
    const r = await as.anwalt.post(`/api/clients/u${data.victorId}/notes`, { body: 'Zahlt zuverlässig, bevorzugt Kontakt über Discord.' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.notes[0].body, 'Zahlt zuverlässig, bevorzugt Kontakt über Discord.');
    assert.equal(r.json.notes[0].author, 'Dr. jur. Damat Lex');
    const noteId = r.json.notes[0].id;
    assert.equal((await as.anwalt.post(`/api/clients/u${data.victorId}/notes`, { body: ' ' })).status, 400);
    const adminNote = (await as.admin.post(`/api/clients/u${data.victorId}/notes`, { body: 'Notiz des Boards' })).json.notes.find((n) => n.body === 'Notiz des Boards');
    assert.equal((await as.anwalt.del(`/api/clients/notes/${adminNote.id}`)).status, 403);
    assert.equal((await as.anwalt.del(`/api/clients/notes/${noteId}`)).status, 200);
    assert.equal((await as.admin.del(`/api/clients/notes/${adminNote.id}`)).status, 200);
    assert.equal((await as.anwalt.get(`/api/clients/u${data.victorId}`)).json.notes.length, 0);
  });

  it('Vermerk: nur das Board, erscheint in der Akte – Mandant sieht nichts', async () => {
    assert.equal((await as.anwalt.put(`/api/clients/u${data.victorId}/flag`, { flag: 'vorkasse', reason: 'Zwei Rechnungen nicht bezahlt' })).status, 403);
    const r = await as.admin.put(`/api/clients/u${data.victorId}/flag`, { flag: 'vorkasse', reason: 'Zwei Rechnungen nicht bezahlt' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.flag.label, 'Nur gegen Vorkasse');
    assert.equal(r.json.flag.reason, 'Zwei Rechnungen nicht bezahlt');
    assert.equal(r.json.flag.setBy, 'Dr. Alois Pake');
    // in beiden Akten des Mandanten (auch der ohne Konto) – nur für die Kanzlei
    for (const id of [data.case1, data.case2]) assert.equal((await as.anwalt.get(`/api/cases/${id}`)).json.case.clientFlag.flag, 'vorkasse');
    const mine = (await as.mandant.get(`/api/cases/${data.case1}`)).json.case;
    assert.equal(mine.clientFlag, undefined);
    assert.equal(mine.clientKey, undefined);
    assert.equal((await as.anwalt.get('/api/clients')).json.clients.find((c) => c.key === `u${data.victorId}`).flag.flag, 'vorkasse');
    // aufheben
    const off = await as.admin.put(`/api/clients/u${data.victorId}/flag`, { flag: '' });
    assert.equal(off.json.flag, null);
    assert.equal((await as.anwalt.get(`/api/cases/${data.case1}`)).json.case.clientFlag, null);
  });

  it('Vermerk ohne Konto: neue Anfrage über die Website mit demselben Namen bekommt den Hinweis', async () => {
    const r = await as.admin.put(`/api/clients/${encodeURIComponent('n:erika ohnekonto')}/flag`, { flag: 'sperre', reason: 'Beleidigt Mitarbeiter' });
    assert.equal(r.status, 200, r.text);
    const web = await client(server.base).post('/api/public/cases', { name: 'Erika Ohnekonto', area: 'zivilrecht', description: 'Ich brauche schon wieder Hilfe bei einem Unfall.' });
    assert.equal(web.status, 201, web.text);
    const found = (await as.anwalt.get('/api/cases')).json.cases.find((c) => c.caseNumber === web.json.caseNumber);
    const det = (await as.anwalt.get(`/api/cases/${found.id}`)).json.case;
    assert.equal(det.clientFlag.label, 'Nicht mehr annehmen');
    assert.equal(det.clientFlag.reason, 'Beleidigt Mitarbeiter');
    const card = (await as.anwalt.get(`/api/clients/${encodeURIComponent('n:erika ohnekonto')}`)).json;
    assert.equal(card.stats.casesTotal, 2);
  });
});
