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

describe('Aufgaben-Pakete', () => {
  it('Standard-Pakete sind angelegt, Zeilen mit „| Tage“ ergeben Fristen', async () => {
    const r = await as.admin.get('/api/task-packages');
    assert.equal(r.status, 200);
    const fest = r.json.packages.find((p) => p.name === 'Festnahme');
    assert.ok(fest && fest.items.length >= 3);
    assert.equal(fest.items[2].days, 2);
  });

  it('Paket übernehmen legt Aufgaben mit Frist an, vorhandene Titel werden übersprungen', async () => {
    const pkgs = (await as.admin.get('/api/task-packages')).json.packages;
    const fest = pkgs.find((p) => p.name === 'Festnahme');
    const r = await as.admin.post(`/api/task-packages/${fest.id}/apply`, { caseId: id.a });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.added, fest.items.length);
    const tasks = (await as.admin.get(`/api/cases/${id.a}`)).json.tasks;
    assert.ok(tasks.some((t) => t.title === 'Haftprüfung beantragen' && t.dueDate));
    const again = await as.admin.post(`/api/task-packages/${fest.id}/apply`, { caseId: id.a });
    assert.equal(again.json.added, 0);
    assert.equal(again.json.skipped, fest.items.length);
  });

  it('Pflegen darf nur das Board; Anwalt ohne Board-Rang bekommt 403', async () => {
    const make = await as.admin.post('/api/task-packages', { name: 'Hausdurchsuchung', area: 'strafrecht', items: 'Durchsuchungsbeschluss prüfen | 1\nBeweismittel sichten' });
    assert.equal(make.status, 201, make.text);
    const pid = make.json.package.id;
    const upd = await as.admin.patch(`/api/task-packages/${pid}`, { items: 'Durchsuchungsbeschluss prüfen | 1' });
    assert.equal(upd.json.package.items.length, 1);
    assert.equal((await as.admin.post('/api/task-packages', { name: 'Leer', area: '', items: ' | ' })).status, 400);
    const plain = (await as.anwalt.get('/api/auth/me')).json.user;
    if (!plain.board) assert.equal((await as.anwalt.post('/api/task-packages', { name: 'Test', area: '', items: 'Eins' })).status, 403);
    assert.equal((await as.admin.del(`/api/task-packages/${pid}`)).status, 200);
  });
});

describe('Abschluss: Rechnung, Strafmaß, Beitrittslink', () => {
  it('tatsächliches Strafmaß wird intern gespeichert und fließt in die Statistik „Einschätzung gegen Ergebnis“', async () => {
    const c = (await as.admin.post('/api/cases', { title: 'Körperverletzung Würfelpark', area: 'strafrecht', clientName: 'Toni Marino' })).json.case;
    assert.equal((await as.admin.patch(`/api/cases/${c.id}/charges/sentence`, { he: 40 })).status, 200);
    const r = await as.admin.patch(`/api/cases/${c.id}`, { status: 'geschlossen', outcome: 'milderung', actualHe: 44 });
    assert.equal(r.status, 200, r.text);
    const detail = (await as.admin.get(`/api/cases/${c.id}`)).json;
    assert.equal(detail.sentence.estimateHe, 40);
    assert.equal(detail.sentence.actualHe, 44);
    const stats = (await as.admin.get('/api/stats')).json;
    assert.equal(stats.forecast.count, 1);
    assert.equal(stats.forecast.avgDiff, 4);
    assert.equal(stats.forecast.hit, 1, '44 liegt innerhalb von ±10 % von 40');
  });

  it('Mandanten sehen das Strafmaß nicht und dürfen es nicht setzen', async () => {
    const m = client(server.base);
    await m.post('/api/auth/register', { displayName: 'Rita Roth', email: 'rita.roth', password: 'Mandanten-Passwort-5' });
    await m.login('rita.roth', 'Mandanten-Passwort-5');
    const own = (await m.post('/api/cases', { title: 'Eigene Sache', area: 'zivilrecht', description: 'Eine Beschreibung der Sache.' })).json?.case;
    if (own) assert.equal((await m.patch(`/api/cases/${own.id}`, { actualHe: 1 })).status, 403);
    assert.equal((await m.get(`/api/cases/${id.a}/join-link`)).status, 404);
  });

  it('Beitrittslink gibt es nur, wenn Tickets und Discord-Anmeldung eingerichtet sind', async () => {
    const r = await as.admin.get(`/api/cases/${id.a}/join-link`);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /nicht eingerichtet/);
  });

  it('der Link mit falscher Pin führt zurück auf die Startseite', async () => {
    const r = await fetch(`${server.base}/api/discord/case-join?c=PS-2026-0001&p=000000`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /ticket=(notfound|disabled)/);
  });
});

describe('Fehlende Unterlagen', () => {
  let mandant;
  let caseId;
  before(async () => {
    mandant = client(server.base);
    await mandant.post('/api/auth/register', { displayName: 'Uwe Unterlage', email: 'uwe.unterlage', password: 'Mandanten-Passwort-5' });
    await mandant.login('uwe.unterlage', 'Mandanten-Passwort-5');
    caseId = (await as.admin.post('/api/cases', { title: 'Mietstreit Davis', area: 'zivilrecht', clientEmail: 'uwe.unterlage' })).json.case.id;
  });

  it('Kanzlei fordert an, Mandant sieht die Anforderung in Akte und unter „Was ist zu tun?“', async () => {
    const r = await as.admin.post(`/api/cases/${caseId}/requests`, { title: 'Mietvertrag als Foto', note: 'Bitte alle Seiten' });
    assert.equal(r.status, 201, r.text);
    const own = (await mandant.get(`/api/cases/${caseId}`)).json;
    assert.equal(own.requests.length, 1);
    const mine = (await mandant.get('/api/requests/mine')).json.requests;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].caseNumber, own.case.caseNumber);
    assert.deepEqual((await as.admin.get('/api/requests/mine')).json.requests, [], 'Kanzlei hat keine eigenen To-dos');
  });

  it('Mandant darf nicht anfordern oder löschen, aber als nachgereicht abhaken', async () => {
    assert.equal((await mandant.post(`/api/cases/${caseId}/requests`, { title: 'Etwas anderes' })).status, 404);
    const rid = (await mandant.get(`/api/cases/${caseId}`)).json.requests[0].id;
    assert.equal((await mandant.del(`/api/cases/${caseId}/requests/${rid}`)).status, 404);
    const done = await mandant.patch(`/api/cases/${caseId}/requests/${rid}`, { done: true });
    assert.equal(done.status, 200);
    assert.equal(done.json.requests[0].done, true);
    assert.deepEqual((await mandant.get('/api/requests/mine')).json.requests, []);
    // wieder öffnen setzt die Erinnerung zurück
    assert.equal((await as.admin.patch(`/api/cases/${caseId}/requests/${rid}`, { done: false })).json.requests[0].done, false);
  });

  it('Anwalt ohne Zuständigkeit darf nichts anfordern', async () => {
    const r = await as.anwalt.post(`/api/cases/${caseId}/requests`, { title: 'Etwas' });
    assert.ok([403, 404].includes(r.status), String(r.status));
  });
});

describe('Terminvorschläge', () => {
  let mandant;
  let caseId;
  const inDays = (n, h = 10) => {
    const d = new Date(Date.now() + n * 864e5);
    d.setUTCHours(h, 0, 0, 0);
    return d.toISOString();
  };
  before(async () => {
    mandant = client(server.base);
    await mandant.post('/api/auth/register', { displayName: 'Tina Termin', email: 'tina.termin', password: 'Mandanten-Passwort-5' });
    await mandant.login('tina.termin', 'Mandanten-Passwort-5');
    caseId = (await as.admin.post('/api/cases', { title: 'Beratung Mietrecht', area: 'zivilrecht', clientEmail: 'tina.termin' })).json.case.id;
  });

  it('Kanzlei bietet drei Zeiten, der Mandant wählt eine – danach ist der Termin bestätigt', async () => {
    const r = await as.admin.post('/api/calendar', { type: 'mandant', title: 'Erstgespräch', startsAt: inDays(5, 14), caseId, slots: [inDays(3, 10), inDays(4, 16)] });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.event.status, 'angefragt');
    assert.equal(r.json.event.proposal, true);
    assert.equal(r.json.event.slots.length, 3);
    assert.deepEqual(r.json.event.slots, [...r.json.event.slots].sort(), 'aufsteigend');
    const id2 = r.json.event.id;

    const mine = (await mandant.get('/api/calendar')).json.events.find((e) => e.id === id2);
    assert.equal(mine.proposal, true);
    assert.equal((await mandant.post(`/api/calendar/${id2}/choose`, { startsAt: inDays(9, 9) })).status, 400, 'nur vorgeschlagene Zeiten');
    assert.equal((await as.admin.post(`/api/calendar/${id2}/choose`, { startsAt: mine.slots[0] })).status, 404, 'Kanzlei wählt nicht für den Mandanten');

    const pick = mine.slots[1];
    const ok = await mandant.post(`/api/calendar/${id2}/choose`, { startsAt: pick });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.event.status, 'bestaetigt');
    assert.equal(ok.json.event.startsAt, pick);
    assert.deepEqual(ok.json.event.slots, []);
    assert.equal((await mandant.post(`/api/calendar/${id2}/choose`, { startsAt: pick })).status, 400, 'nur einmal');
  });

  it('Vorschläge gibt es nur für Mandantengespräche mit Mandanten-Konto', async () => {
    const noAccount = (await as.admin.post('/api/cases', { title: 'Ohne Konto', area: 'zivilrecht', clientName: 'Karl Kein' })).json.case.id;
    assert.equal((await as.admin.post('/api/calendar', { type: 'mandant', title: 'Gespräch', startsAt: inDays(5), caseId: noAccount, slots: [inDays(6)] })).status, 400);
    assert.equal((await as.admin.post('/api/calendar', { type: 'gericht', title: 'Verhandlung', startsAt: inDays(5), caseId, slots: [inDays(6)] })).status, 400);
    assert.equal((await as.admin.post('/api/calendar', { type: 'mandant', title: 'Gespräch', startsAt: inDays(5), caseId, slots: [inDays(1, 8), inDays(2, 8), inDays(3, 8)] })).status, 400, 'höchstens zwei weitere');
  });

  it('Speichern eines Vorschlags ohne neue Zeit behält die Auswahl', async () => {
    const r = await as.admin.post('/api/calendar', { type: 'mandant', title: 'Zweitgespräch', startsAt: inDays(6, 14), caseId, slots: [inDays(7, 10)] });
    const e = r.json.event;
    const saved = await as.admin.patch(`/api/calendar/${e.id}`, { title: 'Zweitgespräch (neu)', startsAt: e.startsAt });
    assert.equal(saved.json.event.proposal, true);
    const moved = await as.admin.patch(`/api/calendar/${e.id}`, { startsAt: inDays(8, 12) });
    assert.equal(moved.json.event.proposal, false, 'feste neue Zeit beendet den Vorschlag');
  });
});

describe('Verlauf und Chat nachladen', () => {
  let cid;
  before(async () => {
    cid = (await as.admin.post('/api/cases', { title: 'Lange Akte', area: 'zivilrecht', clientName: 'Lena Lang' })).json.case.id;
    for (let i = 1; i <= 55; i++) await as.admin.post(`/api/cases/${cid}/notes`, { body: `Nachricht ${i}`, internal: false });
    for (let i = 1; i <= 70; i++) await as.admin.post(`/api/cases/${cid}/notes`, { body: `Interne Notiz ${i}`, internal: true });
  });

  it('?lean=1 liefert nur die jüngsten Nachrichten und Einträge, der Rest kommt auf Wunsch', async () => {
    const full = (await as.admin.get(`/api/cases/${cid}`)).json;
    assert.equal(full.chat.messages.length, 55, 'ohne lean: alles (Aktenauszug)');
    assert.ok(full.notes.some((n) => !n.internal && !n.system), 'ohne lean: auch die Nachrichten in den Einträgen');

    const lean = (await as.admin.get(`/api/cases/${cid}?lean=1`)).json;
    assert.equal(lean.chat.messages.length, 40);
    assert.equal(lean.chat.more, true);
    assert.equal(lean.chat.messages[39].body, 'Nachricht 55', 'die jüngsten, aufsteigend');
    assert.equal(lean.notes.length, 60);
    assert.ok(lean.notes.every((n) => n.internal || n.system), 'Nachrichten stehen nur im Chat');
    assert.ok(lean.logMore >= 10, `älterer Verlauf: ${lean.logMore}`);

    const older = (await as.admin.get(`/api/cases/${cid}/chat?before=${lean.chat.messages[0].id}&limit=40`)).json;
    assert.equal(older.messages.length, 15);
    assert.equal(older.more, false);
    assert.equal(older.messages[0].body, 'Nachricht 1');

    const all = (await as.admin.get(`/api/cases/${cid}?lean=1&all=1`)).json;
    assert.equal(all.chat.messages.length, 55);
    assert.equal(all.logMore, undefined);
    assert.ok(all.notes.length > lean.notes.length);
  });

  it('der Mandant bekommt weiterhin keine internen Einträge', async () => {
    const m = client(server.base);
    await m.post('/api/auth/register', { displayName: 'Lena Lang', email: 'lena.lang', password: 'Mandanten-Passwort-5' });
    await m.login('lena.lang', 'Mandanten-Passwort-5');
    await as.admin.patch(`/api/cases/${cid}`, { clientEmail: 'lena.lang' }).catch(() => {});
    const r = await m.get(`/api/cases/${cid}?lean=1`);
    assert.equal(r.status, 404, 'fremde Akte bleibt unsichtbar');
  });
});

describe('Dateien aus der Akte werden im Browser zwischengespeichert', () => {
  it('Vorschaubild und Datei: privat, mit ETag – ein zweiter Abruf kommt als 304', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await as.admin.upload(`/api/cases/${id.a}/attachments?caption=Test`, png, 'image/png');
    assert.equal(up.status, 201, up.text);
    const att = up.json.attachment;
    for (const url of [att.url, att.thumbUrl].filter(Boolean)) {
      const first = await as.admin.get(url);
      assert.equal(first.status, 200, url);
      assert.match(first.headers.get('cache-control'), /private/);
      const etag = first.headers.get('etag');
      assert.ok(etag, `ETag für ${url}`);
      // fetch hängt bei eigenen If-None-Match-Kopfzeilen „no-cache“ an – ein Browser tut das beim normalen Laden nicht
      const status = await new Promise((resolve, reject) => {
        const u = new URL(server.base + url);
        require('node:http')
          .get({ host: u.hostname, port: u.port, path: u.pathname, headers: { Cookie: as.admin.cookie(), 'If-None-Match': etag } }, (res) => {
            res.resume();
            resolve(res.statusCode);
          })
          .on('error', reject);
      });
      assert.equal(status, 304, url);
    }
  });
});

describe('Startseite und Dashboard: Kanzleisitz', () => {
  it('Kanzleisitz: eine Einstellung für Website, Rechnungen und den Ort neuer Termine', async () => {
    assert.deepEqual((await client(server.base).get('/api/public/firm')).json, { seat: 'Würfelpark, Los Santos', place: 'Würfelpark' });
    assert.equal((await as.anwalt.patch('/api/admin/settings', { firmSeat: 'Vinewood Hills, Los Santos' })).status, 403, 'nur Board');
    const set = await as.admin.patch('/api/admin/settings', { firmSeat: 'Vinewood Hills, Los Santos' });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual((await client(server.base).get('/api/public/firm')).json, { seat: 'Vinewood Hills, Los Santos', place: 'Vinewood Hills' });
    assert.equal((await as.admin.get('/api/invoices/firm')).json.firm.seat, 'Vinewood Hills, Los Santos');
    const ev = (await as.admin.post('/api/calendar', { type: 'mandant', title: 'Ort-Test', startsAt: new Date(Date.now() + 864e5).toISOString() })).json.event;
    assert.equal(ev.location, 'Kanzlei Vinewood Hills');
    await as.admin.patch('/api/admin/settings', { firmSeat: 'Würfelpark, Los Santos' });
  });
});
