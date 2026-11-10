'use strict';
/*
 * Paket F (Fachfunktionen): Vorlage „Vergleichsangebot“, Statuslink für Mandanten ohne Konto, Prüfschema je
 * Anklagepunkt und Eskalation offener Fristen an das Board of Partners. Dazu aus Paket A die Volltextsuche im
 * Sachverhalt (Treffer mit Ausschnitt).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM } = require('./helpers');

describe('Fachfunktionen (API)', () => {
  let srv;
  let anwalt;
  let caseId;
  before(async () => {
    srv = await startServer();
    anwalt = client(srv.base);
    await anwalt.login(TEAM.anwalt);
    const r = await anwalt.post('/api/cases', { title: 'Schlägerei am Hafen', area: 'strafrecht', clientName: 'John Doe', description: 'Streit vor dem Lokal' });
    assert.equal(r.status, 201, r.text);
    caseId = r.json.case.id;
  });
  after(() => srv.stop());

  it('Vorlage „Vergleichsangebot“ ist dabei, mit Betrag und Annahmefrist', async () => {
    const { templates } = (await anwalt.get('/api/contract-templates')).json;
    const t = templates.find((x) => x.key === 'vergleichsangebot');
    assert.ok(t, 'Vorlage fehlt');
    assert.equal(t.kind, 'schriftsatz');
    assert.match(t.body, /\{\{vergleichsbetrag\}\}/);
    assert.match(t.body, /\{\{annahmefrist\}\}/);
  });

  it('Statuslink: erzeugen, ohne Anmeldung abrufen, erneuern macht den alten ungültig, abschalten', async () => {
    const anon = client(srv.base);
    const a = await anwalt.post(`/api/cases/${caseId}/status-link`, {});
    assert.equal(a.status, 200, a.text);
    assert.match(a.json.url, /\/verfahrensstand\?t=[\w-]{20,}$/);
    const first = a.json.token;
    const view = await anon.get(`/api/public/case-status/link/${first}`);
    assert.equal(view.status, 200, view.text);
    assert.equal(view.json.area, 'Strafrecht');
    assert.ok(view.json.caseNumber);
    assert.equal(view.json.description, undefined, 'kein Inhalt der Akte');
    assert.equal((await anwalt.get(`/api/cases/${caseId}`)).json.case.statusToken, first);
    const b = await anwalt.post(`/api/cases/${caseId}/status-link`, {});
    assert.notEqual(b.json.token, first);
    assert.equal((await anon.get(`/api/public/case-status/link/${first}`)).status, 404, 'alter Link gilt nicht mehr');
    assert.equal((await anon.get(`/api/public/case-status/link/${b.json.token}`)).status, 200);
    assert.equal((await anwalt.del(`/api/cases/${caseId}/status-link`)).status, 200);
    assert.equal((await anon.get(`/api/public/case-status/link/${b.json.token}`)).status, 404);
    assert.equal((await anon.post(`/api/cases/${caseId}/status-link`, {})).status, 401);
  });

  it('Prüfschema je Anklagepunkt: Standard offen, Stand und Notiz werden gespeichert, Unsinn abgelehnt', async () => {
    const pen = (await anwalt.get('/api/penal')).json;
    const r = await anwalt.post(`/api/cases/${caseId}/charges`, { offenceId: pen.offences[0].id });
    assert.ok(r.status < 300, r.text);
    const ch = r.json.charges[0];
    assert.equal(ch.checklist.length, 6);
    assert.ok(ch.checklist.every((x) => x.state === 'offen'));
    const list = ch.checklist.map((x) => ({ k: x.k, state: x.k === 'rw' ? 'angreifbar' : x.k === 'objektiv' ? 'gegeben' : 'offen', note: x.k === 'rw' ? 'Notwehr' : '' }));
    const p = await anwalt.patch(`/api/cases/${caseId}/charges/${ch.id}`, { checklist: list });
    assert.equal(p.status, 200, p.text);
    const saved = p.json.charges[0].checklist;
    assert.equal(saved.find((x) => x.k === 'rw').state, 'angreifbar');
    assert.equal(saved.find((x) => x.k === 'rw').note, 'Notwehr');
    assert.equal(saved.find((x) => x.k === 'objektiv').state, 'gegeben');
    assert.equal(p.json.charges[0].count, 1, 'Anzahl bleibt');
    assert.equal((await anwalt.patch(`/api/cases/${caseId}/charges/${ch.id}`, { checklist: [{ k: 'gibts-nicht', state: 'offen' }] })).status, 400);
    assert.equal((await anwalt.patch(`/api/cases/${caseId}/charges/${ch.id}`, { checklist: [{ k: 'rw', state: 'vielleicht' }] })).status, 400);
  });

  it('Suche findet Akten über den Sachverhalt und zeigt die Fundstelle', async () => {
    await anwalt.patch(`/api/cases/${caseId}`, { incident: 'Der Mandant wurde nach einer Verfolgungsjagd am Pillbox Hill gestoppt.' });
    const r = (await anwalt.get('/api/search?q=Verfolgungsjagd')).json;
    const hit = (r.results.cases || []).find((c) => c.id === caseId);
    assert.ok(hit, 'Akte nicht gefunden');
    assert.equal(hit.previewLabel, 'Sachverhalt');
    assert.match(hit.preview, /Verfolgungsjagd/);
  });
});

describe('Eskalation offener Fristen', () => {
  it('meldet eine bald ablaufende, offene Frist genau einmal (Vermerk in der Akte), erledigte nicht', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-esk-'));
    process.env.DB_PATH = path.join(dir, 'e.db');
    const { db } = require('../server/db/db');
    const cal = require('../server/routes/calendar');
    const lawyer = db.prepare("SELECT id FROM users WHERE role IN ('anwalt','admin') LIMIT 1").get();
    const caseId = Number(db.prepare("INSERT INTO cases (case_number, access_pin, title, area, lawyer_id) VALUES ('PS-T-1', '1234', 'Test', 'strafrecht', ?)").run(lawyer ? lawyer.id : null).lastInsertRowid);
    const soon = new Date(Date.now() + 2 * 3600e3).toISOString();
    const later = new Date(Date.now() + 3 * 864e5).toISOString();
    const add = (title, at, status = 'bestaetigt') =>
      Number(db.prepare("INSERT INTO appointments (case_id, type, title, starts_at, status) VALUES (?, 'frist', ?, ?, ?)").run(caseId, title, at, status).lastInsertRowid);
    const offen = add('Berufung einlegen', soon);
    const erledigt = add('Schon erledigt', soon, 'erledigt');
    const spaeter = add('Noch Zeit', later);
    cal.sendDueReminders();
    cal.sendDueReminders();
    const esc = (id) => db.prepare('SELECT escalated FROM appointments WHERE id = ?').get(id).escalated;
    assert.equal(esc(offen), 1);
    assert.equal(esc(erledigt), 0);
    assert.equal(esc(spaeter), 0);
    const notes = db.prepare("SELECT body FROM notes WHERE case_id = ? AND body LIKE '%eskaliert%'").all(caseId);
    assert.equal(notes.length, 1, 'nur einmal');
    assert.match(notes[0].body, /Berufung einlegen/);
  });
});
