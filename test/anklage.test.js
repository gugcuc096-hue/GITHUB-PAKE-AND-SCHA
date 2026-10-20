'use strict';
/*
 * Anklage einfügen: Der eingefügte Anklagetext (aus FiveNet oder dem DOJ-Ticket) wird gelesen – Paragraphen, Absatz,
 * Anzahl, Versuch/Beihilfe, Tatbestände am Namen – und als Anklagepunkte in einem Schritt übernommen.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM } = require('./helpers');

const SAMPLE = `Anklageschrift der Staatsanwaltschaft
§ 33 StGB – Diebstahl (2x)
§§ 40, 42 StGB
StGB § 29 Abs. 2
§ 66 Absatz 1 Widerstand gegen Vollstreckungsbeamte
Gefährliche Körperverletzung
versuchter Raub
§ 120 StGB
§ 5 StVO
3x Sachbeschädigung
Beihilfe zum Betrug
§ 61 Abs. 4 Satz 2
33 StGB`;

describe('Anklagetext lesen (penal.parseCharges)', () => {
  it('erkennt Paragraphen, Absatz/Satz, Anzahl, Versuch, Beihilfe und Namen – andere Gesetze und Unbekanntes als Hinweis', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-anklage-'));
    process.env.DB_PATH = path.join(dir, 'a.db');
    const penal = require('../penal');
    penal.init();
    const r = penal.parseCharges(SAMPLE);
    const by = (cite) => r.items.find((i) => i.citation === cite);
    assert.equal(by('§ 33 StGB').count, 3, '„(2x)“ und „33 StGB“ zählen zusammen');
    assert.equal(by('§ 40 StGB').count, 4, '§§ 40, 42 und „3x Sachbeschädigung“');
    assert.equal(by('§ 42 StGB').title, 'Hausfriedensbruch');
    assert.equal(by('§ 29 Abs. 2 StGB').title, 'Bedrohung mit einem Verbrechen');
    assert.ok(by('§ 29 Abs. 2 StGB').alternatives.length >= 2, 'andere Absätze zur Auswahl');
    assert.equal(by('§ 66 Abs. 1 StGB').title, 'Widerstand gegen Vollstreckungsbeamte');
    assert.equal(by('§ 23 StGB').title, 'Gefährliche Körperverletzung');
    assert.ok(!by('§ 21 Abs. 1 StGB'), 'nicht zusätzlich „Körperverletzung“');
    assert.equal(by('§ 37 StGB').attempted, true, 'versuchter Raub');
    assert.equal(by('§ 39 StGB').aiding, true, 'Beihilfe zum Betrug');
    assert.equal(by('§ 61 Abs. 4 Satz 2 StGB').title, 'Wiederholtes Eindringen in eine Sperrzone');
    assert.deepEqual(
      r.unknown.map((u) => u.ref),
      ['§ 120', '§ 5 StVO']
    );
    // § 9 / § 10 aus dem Allgemeinen Teil: Versuch bzw. Beihilfe zum Punkt in derselben Zeile
    const v = penal.parseCharges('§ 37 i.V.m. § 9 StGB\n§ 39 StGB i.V.m. § 10');
    assert.equal(v.items.find((i) => i.para === '37').attempted, true);
    assert.equal(v.items.find((i) => i.para === '39').aiding, true);
    assert.deepEqual(v.unknown, []);
    // Leerer Text oder Text ohne Tatbestand: keine Vorschläge
    assert.deepEqual(penal.parseCharges('').items, []);
    assert.deepEqual(penal.parseCharges('Guten Tag, hier steht nichts Strafbares.').items, []);
  });
});

let server;
const as = {};
const data = {};

describe('Anklage einfügen (API)', () => {
  before(async () => {
    server = await startServer();
    for (const k of ['admin', 'anwalt']) {
      as[k] = client(server.base);
      as[k].me = await as[k].login(TEAM[k]);
    }
    as.mandant = client(server.base);
    assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'Anna Anklage', email: 'anna.anklage', password: 'Mandanten-Passwort-9' })).status, 201);
    await as.mandant.login('anna.anklage', 'Mandanten-Passwort-9');
    const c = await as.anwalt.post('/api/cases', { title: 'Juwelier am Vinewood Boulevard', area: 'strafrecht', clientEmail: 'anna.anklage' });
    assert.equal(c.status, 201, c.text);
    data.case = c.json.case;
  });
  after(() => server && server.stop());

  it('liest den Text nur für die Kanzlei – ohne etwas zu speichern', async () => {
    const r = await as.anwalt.post('/api/penal/parse', { text: SAMPLE });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.items.length >= 9);
    assert.equal((await as.mandant.post('/api/penal/parse', { text: SAMPLE })).status, 403);
    assert.equal((await as.anwalt.get(`/api/cases/${data.case.id}/charges`)).json.charges.length, 0, 'nur gelesen');
  });

  it('übernimmt die Auswahl in einem Schritt – gleiche Tatbestände zählen hoch, Versuch nur wo strafbar', async () => {
    const parsed = (await as.anwalt.post('/api/penal/parse', { text: '§ 33 StGB (2x)\nversuchter Raub\nBeihilfe zum Betrug' })).json.items;
    const items = parsed.map((i) => ({ offenceId: i.offenceId, count: i.count, attempted: i.attempted, aiding: i.aiding }));
    const r = await as.anwalt.post(`/api/cases/${data.case.id}/charges/bulk`, { items });
    assert.equal(r.status, 201, r.text);
    const byTitle = (list, t) => list.find((c) => c.title === t);
    assert.equal(byTitle(r.json.charges, 'Diebstahl').count, 2);
    assert.equal(byTitle(r.json.charges, 'Raub').attempted, true);
    assert.equal(byTitle(r.json.charges, 'Betrug').aiding, true);
    assert.ok(r.json.sentence.maxHe > 0, 'Strafmaß gleich mitgerechnet');
    // noch einmal Diebstahl: Anzahl steigt, keine zweite Zeile
    const again = await as.anwalt.post(`/api/cases/${data.case.id}/charges/bulk`, { items: [{ offenceId: byTitle(parsed, 'Diebstahl').offenceId, count: 1 }] });
    assert.equal(again.json.charges.filter((c) => c.title === 'Diebstahl').length, 1);
    assert.equal(byTitle(again.json.charges, 'Diebstahl').count, 3);
    // interne Notiz in der Akte (nicht für den Mandanten)
    const detail = (await as.anwalt.get(`/api/cases/${data.case.id}`)).json;
    assert.ok(detail.notes.some((n) => n.internal && /Anklage übernommen: 2× § 33 StGB – Diebstahl/.test(n.body)));
    const forClient = (await as.mandant.get(`/api/cases/${data.case.id}`)).json;
    assert.ok(!(forClient.notes || []).some((n) => /Anklage übernommen/.test(n.body)), 'Mandant sieht die Notiz nicht');
  });

  it('nur zuständige Anwälte, nur echte Tatbestände, höchstens 40 Punkte – sonst bleibt die Akte unverändert', async () => {
    const one = (await as.anwalt.post('/api/penal/parse', { text: '§ 40 StGB' })).json.items[0];
    assert.equal((await as.mandant.post(`/api/cases/${data.case.id}/charges/bulk`, { items: [{ offenceId: one.offenceId }] })).status, 404);
    assert.equal((await as.anwalt.post(`/api/cases/${data.case.id}/charges/bulk`, { items: [{ offenceId: 999999 }] })).status, 400);
    assert.equal((await as.anwalt.post(`/api/cases/${data.case.id}/charges/bulk`, { items: [] })).status, 400);
    // Akte mit 39 Punkten: zwei neue passen nicht mehr – keiner von beiden kommt dazu
    const all = (await as.anwalt.get('/api/penal')).json.offences;
    const c = (await as.anwalt.post('/api/cases', { title: 'Viele Vorwürfe', area: 'strafrecht', clientName: 'Victor Viel' })).json.case;
    const fill = await as.anwalt.post(`/api/cases/${c.id}/charges/bulk`, { items: all.slice(0, 39).map((o) => ({ offenceId: o.id })) });
    assert.equal(fill.status, 201, fill.text);
    const over = await as.anwalt.post(`/api/cases/${c.id}/charges/bulk`, { items: all.slice(39, 41).map((o) => ({ offenceId: o.id })) });
    assert.equal(over.status, 400);
    assert.match(over.json.error, /40/);
    assert.equal((await as.anwalt.get(`/api/cases/${c.id}/charges`)).json.charges.length, 39, 'alles oder nichts');
  });
});
