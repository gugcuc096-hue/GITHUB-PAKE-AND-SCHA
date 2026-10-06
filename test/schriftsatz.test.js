'use strict';
/*
 * Aktenzeichen aus FiveNet in Anträgen („DOC - 74412“): Vorbelegung aus dem in der Akte hinterlegten
 * FiveNet-Dokument, manuelle Eingabe, einheitliche Schreibweise und Aktualisierung der Standardvorlagen.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, client, TEAM } = require('./helpers');
const contracts = require('../contracts');

const FIVENET = 'https://fivenet.modernv.net';

describe('FiveNet-Aktenzeichen in Anträgen', () => {
  let server;
  let anwalt;
  const state = {};

  before(async () => {
    server = await startServer();
    anwalt = client(server.base);
    await anwalt.login(TEAM.anwalt);
    const r = await anwalt.post('/api/cases', { title: 'Ermittlungsverfahren Doe', area: 'strafrecht', clientName: 'John Doe' });
    assert.equal(r.status, 201, r.text);
    state.caseId = r.json.case.id;
    const { templates } = (await anwalt.get('/api/contract-templates')).json;
    state.akteneinsicht = templates.find((t) => t.key === 'akteneinsicht');
    state.haftbeschwerde = templates.find((t) => t.key === 'haftbeschwerde');
  });
  after(async () => {
    if (server) await server.stop();
  });

  it('Anträge nutzen {{fivenet_az}} als Aktenzeichen, unser Zeichen bleibt', async () => {
    for (const t of [state.akteneinsicht, state.haftbeschwerde]) {
      assert.match(t.body, /\*\*Aktenzeichen:\*\* \{\{fivenet_az\}\}/, t.name);
      assert.match(t.body, /\*\*Unser Zeichen:\*\* \{\{aktenzeichen\}\}/, t.name);
    }
    const list = (await anwalt.get('/api/contract-templates')).json;
    assert.ok(list.fields.fivenet_az, 'Platzhalter in der Vorlagen-Hilfe');
    assert.equal(list.fivenetUrl, FIVENET);
  });

  it('ohne FiveNet-Dokument bleibt das Feld zum manuellen Ausfüllen leer', async () => {
    const d = (await anwalt.get(`/api/cases/${state.caseId}/contracts/defaults`)).json;
    assert.equal(d.data.fivenet_az, '');
    assert.deepEqual(d.fivenetDocs, []);
  });

  it('mit hinterlegtem FiveNet-Dokument wird „DOC - Nummer“ vorbelegt', async () => {
    const link = await anwalt.post(`/api/cases/${state.caseId}/external`, { provider: 'fivenet', input: `${FIVENET}/documents/74412`, attest: true, title: 'Festnahmebericht LSPD' });
    assert.equal(link.status, 201, link.text);
    const d = (await anwalt.get(`/api/cases/${state.caseId}/contracts/defaults`)).json;
    assert.equal(d.data.fivenet_az, 'DOC - 74412');
    assert.deepEqual(d.fivenetDocs, [{ documentId: '74412', title: 'Festnahmebericht LSPD', ref: 'DOC - 74412' }]);
    assert.equal(d.fivenetUrl, FIVENET);
  });

  it('Eingaben werden einheitlich als „DOC - Nummer“ gespeichert, anderes bleibt wie eingegeben', async () => {
    const me = (await anwalt.get('/api/auth/me')).json.user;
    const r = await anwalt.post(`/api/cases/${state.caseId}/contracts`, {
      templateId: state.akteneinsicht.id,
      lawyerId: me.id,
      data: { empfaenger: 'District Court San Andreas', fivenet_az: `${FIVENET}/documents/74412/edit` },
    });
    assert.equal(r.status, 201, r.text);
    state.contractId = r.json.contract.id;
    assert.equal(r.json.contract.data.fivenet_az, 'DOC - 74412');

    const cases = [
      ['doc-555', 'DOC - 555'],
      ['DOC 0815', 'DOC - 815'],
      ['74412', 'DOC - 74412'],
      ['DC-2026-0142', 'DC-2026-0142'], // manuelles Aktenzeichen ohne FiveNet-Dokument
      ['https://andere-seite.example/documents/1', 'https://andere-seite.example/documents/1'], // fremde Adresse: kein FiveNet-Dokument
      ['', ''],
    ];
    for (const [input, stored] of cases) {
      const p = await anwalt.patch(`/api/contracts/${state.contractId}`, { data: { fivenet_az: input } });
      assert.equal(p.status, 200, p.text);
      assert.equal(p.json.contract.data.fivenet_az, stored, input);
    }
    await anwalt.patch(`/api/contracts/${state.contractId}`, { data: { fivenet_az: 'DOC - 74412' } });
    const full = (await anwalt.get(`/api/contracts/${state.contractId}`)).json;
    assert.equal(full.contract.data.fivenet_az, 'DOC - 74412');
    assert.equal(full.fivenetUrl, FIVENET, 'Druckansicht baut den Link aus der Instanz der Kanzlei');
  });

  it('ohne FiveNet-Dokument wird das Gerichtsaktenzeichen der Akte vorgeschlagen', async () => {
    const r = await anwalt.post('/api/cases', { title: 'Haftsache Roe', area: 'strafrecht', clientName: 'Jane Roe', courtRef: 'DC-2026-0142' });
    assert.equal(r.status, 201, r.text);
    const d = (await anwalt.get(`/api/cases/${r.json.case.id}/contracts/defaults`)).json;
    assert.equal(d.data.fivenet_az, 'DC-2026-0142');
  });
});

describe('Standardvorlagen der Anträge werden aktualisiert', () => {
  it('unveränderte alte Fassung → neue Fassung, eigene Änderungen bleiben', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-vorlagen-'));
    const dbPath = path.join(dir, 'alt.db');
    try {
      let server = await startServer({ env: { DB_PATH: dbPath } });
      await server.stop();
      const [oldAkteneinsicht] = contracts.PREVIOUS_VERSIONS.akteneinsicht;
      const own = contracts.PREVIOUS_VERSIONS.haftbeschwerde[0].replace('Mit freundlichen Grüßen', 'Hochachtungsvoll');
      assert.match(oldAkteneinsicht, /\*\*Aktenzeichen:\*\* \{\{gerichtsaktenzeichen\}\}/);
      const db = new DatabaseSync(dbPath);
      db.prepare('UPDATE contract_templates SET body = ? WHERE key = ?').run(oldAkteneinsicht, 'akteneinsicht');
      db.prepare('UPDATE contract_templates SET body = ? WHERE key = ?').run(own, 'haftbeschwerde');
      db.close();

      server = await startServer({ env: { DB_PATH: dbPath } });
      try {
        const admin = client(server.base);
        await admin.login(TEAM.admin);
        const { templates } = (await admin.get('/api/contract-templates')).json;
        assert.equal(templates.find((t) => t.key === 'akteneinsicht').body, contracts.DEFAULT_TEMPLATES.find((t) => t.key === 'akteneinsicht').body);
        assert.equal(templates.find((t) => t.key === 'haftbeschwerde').body, own, 'selbst geänderte Vorlage bleibt unverändert');
      } finally {
        await server.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
