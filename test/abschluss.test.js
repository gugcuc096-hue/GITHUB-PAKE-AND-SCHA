'use strict';
/*
 * Rechnung aus dem Mandatsvertrag, Abschluss mit Ergebnis (intern), Erfolgszahlen der Startseite und
 * „Direkt anfragen“ (Wunschanwalt von der Teamkarte).
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
  const reg = await as.mandant.post('/api/auth/register', { displayName: 'Rosa Rechnung', email: 'rosa.rechnung', password: 'Mandanten-Passwort-7' });
  assert.equal(reg.status, 201, reg.text);
  await as.mandant.login('rosa.rechnung', 'Mandanten-Passwort-7');
  data.caseId = (await as.mandant.post('/api/cases', { title: 'Festnahme Vespucci Beach', area: 'strafrecht', description: 'Festnahme ohne Belehrung am Strand.' })).json.case.id;
  // Das Board weist die Akte dem Anwalt zu (er erstellt Vertrag und Rechnung und schließt ab)
  assert.equal((await as.admin.patch(`/api/cases/${data.caseId}`, { lawyerId: as.anwalt.me.id })).status, 200);
  data.templates = (await as.admin.get('/api/contract-templates')).json.templates;
});
after(async () => {
  if (server) await server.stop();
});

const mandatsvertrag = () => data.templates.find((t) => t.key === 'mandatsvertrag').id;

describe('Rechnung aus dem Mandatsvertrag', () => {
  it('ohne Vertrag: nichts vorzuschlagen; Mandanten kommen nicht heran', async () => {
    const r = await as.anwalt.get(`/api/cases/${data.caseId}/contracts/billing`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { contract: null, items: [], invoices: [] });
    assert.equal((await as.mandant.get(`/api/cases/${data.caseId}/contracts/billing`)).status, 403);
  });

  it('Leistungen zum regulären Preis, Summe laut Vertrag mit Rabatt, Zusatzgebühr als Hinweis', async () => {
    const k = await as.anwalt.post(`/api/cases/${data.caseId}/contracts`, {
      templateId: mandatsvertrag(),
      lawyerId: as.anwalt.me.id,
      data: { zusatzgebuehr: '5.000 $ je weiterem Gerichtstermin', datum: '12.10.2026' },
      services: [
        { name: 'Erstberatung', price: 12000, listPrice: 15000, discount: 'VIP Gold −20 %', qty: 1 },
        { name: 'Haftprüfung', price: 8000, listPrice: 10000, discount: 'VIP Gold −20 %', qty: 2 },
      ],
    });
    assert.equal(k.status, 201, k.text);
    data.contractId = k.json.contract.id;
    const r = (await as.anwalt.get(`/api/cases/${data.caseId}/contracts/billing`)).json;
    assert.equal(r.contract.id, data.contractId);
    assert.equal(r.contract.status, 'entwurf');
    assert.equal(r.contract.total, 28000, 'Summe laut Vertrag (ermäßigt)');
    assert.equal(r.contract.discount, 'VIP Gold −20 %');
    assert.equal(r.contract.extraFee, '5.000 $ je weiterem Gerichtstermin');
    assert.equal(r.contract.date, '12.10.2026');
    assert.deepEqual(r.items, [
      { description: 'Erstberatung', quantity: 1, unitPrice: 15000 },
      { description: 'Haftprüfung', quantity: 2, unitPrice: 10000 },
    ]);
    assert.deepEqual(r.invoices, []);
  });

  it('ohne Leistungen: die Grundgebühr; ein unterschriebener Vertrag hat Vorrang vor einem neueren Entwurf', async () => {
    // Der erste Vertrag wird unterschrieben (Anwalt + Mandant), danach entsteht ein neuer Entwurf nur mit Grundgebühr
    const lawyerSign = await as.anwalt.post(`/api/contracts/${data.contractId}/sign`, { as: 'anwalt' });
    assert.equal(lawyerSign.status, 200, lawyerSign.text);
    const sign = await as.mandant.post(`/api/contracts/${data.contractId}/sign`, { as: 'mandant', name: 'Rosa Rechnung' });
    assert.equal(sign.status, 200, sign.text);
    const k2 = await as.anwalt.post(`/api/cases/${data.caseId}/contracts`, { templateId: mandatsvertrag(), lawyerId: as.anwalt.me.id, data: { grundgebuehr: '7.500 $' } });
    assert.equal(k2.status, 201, k2.text);
    const r = (await as.anwalt.get(`/api/cases/${data.caseId}/contracts/billing`)).json;
    assert.equal(r.contract.id, data.contractId, 'unterschriebener Vertrag zählt');
    assert.equal(r.contract.status, 'unterschrieben');
    // ohne den unterschriebenen: die Grundgebühr des Entwurfs
    const only = await as.admin.post('/api/cases', { title: 'Beratung Mirror Park', area: 'zivilrecht', clientName: 'Gustav Grund' });
    const k3 = await as.admin.post(`/api/cases/${only.json.case.id}/contracts`, { templateId: mandatsvertrag(), lawyerId: as.admin.me.id, data: { grundgebuehr: '7.500 $' } });
    assert.equal(k3.status, 201, k3.text);
    const g = (await as.admin.get(`/api/cases/${only.json.case.id}/contracts/billing`)).json;
    assert.deepEqual(g.items, [{ description: 'Grundgebühr laut Mandatsvertrag', quantity: 1, unitPrice: 7500 }]);
    assert.equal(g.contract.total, 7500);
  });

  it('bereits erstellte Rechnungen der Akte werden genannt (stornierte nicht)', async () => {
    const inv = await as.anwalt.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Erstberatung', quantity: 1, unitPrice: 15000 }] });
    assert.equal(inv.status, 201, inv.text);
    const storno = await as.anwalt.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Irrtum', quantity: 1, unitPrice: 100 }] });
    assert.equal((await as.admin.patch(`/api/invoices/${storno.json.invoice.id}`, { status: 'storniert' })).status, 200);
    const r = (await as.anwalt.get(`/api/cases/${data.caseId}/contracts/billing`)).json;
    assert.deepEqual(
      r.invoices.map((i) => [i.number, i.total, i.status]),
      [[inv.json.invoice.number, 15000, 'offen']]
    );
  });
});

describe('Abschluss mit Ergebnis', () => {
  it('Ergebnis nur beim Abschließen bzw. an abgeschlossenen Akten – und nur durch die Kanzlei', async () => {
    const early = await as.anwalt.patch(`/api/cases/${data.caseId}`, { outcome: 'freispruch' });
    assert.equal(early.status, 400, early.text);
    assert.equal((await as.anwalt.patch(`/api/cases/${data.caseId}`, { status: 'geschlossen', outcome: 'quatsch' })).status, 400);
    assert.equal((await as.mandant.patch(`/api/cases/${data.caseId}`, { outcome: 'freispruch' })).status, 403);
  });

  it('Abschließen mit Ergebnis: intern im Verlauf, Mandant sieht weder Ergebnis noch Eintrag', async () => {
    const closed = await as.anwalt.patch(`/api/cases/${data.caseId}`, { status: 'geschlossen', outcome: 'freispruch' });
    assert.equal(closed.status, 200, closed.text);
    assert.equal(closed.json.case.status, 'geschlossen');
    assert.equal(closed.json.case.outcome, 'freispruch');
    const staffView = (await as.anwalt.get(`/api/cases/${data.caseId}`)).json;
    assert.equal(staffView.case.outcome, 'freispruch');
    const note = staffView.notes.find((n) => n.body === 'Ergebnis: Freispruch');
    assert.ok(note, 'Verlaufseintrag für die Kanzlei');
    assert.equal(note.internal, true);
    const clientView = (await as.mandant.get(`/api/cases/${data.caseId}`)).json;
    assert.equal(clientView.case.outcome, undefined);
    assert.ok(!clientView.notes.some((n) => /Ergebnis/.test(n.body)), 'kein Eintrag für den Mandanten');
  });

  it('Ergebnis an der abgeschlossenen Akte korrigieren; wieder öffnen behält es für den nächsten Abschluss', async () => {
    const r = await as.admin.patch(`/api/cases/${data.caseId}`, { outcome: 'milderung' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.case.outcome, 'milderung');
    const reopen = await as.admin.patch(`/api/cases/${data.caseId}`, { status: 'in_bearbeitung', step: 2 });
    assert.equal(reopen.json.case.outcome, 'milderung');
    // ohne Ergebnis abschließen geht weiterhin (z. B. ältere Abläufe) – das bisherige bleibt stehen
    const again = await as.admin.patch(`/api/cases/${data.caseId}`, { status: 'geschlossen' });
    assert.equal(again.json.case.outcome, 'milderung');
  });
});

describe('Erfolge auf der Startseite', () => {
  const pub = () => client(server.base).get('/api/public/stats');

  it('erst ab 10 abgeschlossenen Verfahren bzw. 5 Akten mit Ergebnis', async () => {
    const r = await pub();
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { visible: true, closed: null, successRate: null, rating: null });
  });

  it('Erfolgsquote: Beratungen und vorzeitig beendete Mandate zählen nicht mit', async () => {
    // schon geschlossen: 1 × Strafmilderung (Erfolg). Dazu 9 weitere:
    const outcomes = ['freispruch', 'eingestellt', 'vergleich', 'verloren', 'verloren', 'erledigt', 'erledigt', 'beendet', null];
    for (const [i, outcome] of outcomes.entries()) {
      const c = (await as.admin.post('/api/cases', { title: `Statistik-Akte ${i + 1}`, area: 'strafrecht', clientName: `Mandant ${i + 1}` })).json.case;
      const r = await as.admin.patch(`/api/cases/${c.id}`, outcome ? { status: 'geschlossen', outcome } : { status: 'geschlossen' });
      assert.equal(r.status, 200, r.text);
    }
    const r = (await pub()).json;
    assert.equal(r.closed, 10);
    // gewertet: milderung, freispruch, eingestellt, vergleich (Erfolg) + 2 × verloren → 4 von 6
    assert.equal(r.successRate, 67);
    // nichts Internes in der Antwort
    assert.deepEqual(Object.keys(r).sort(), ['closed', 'rating', 'successRate', 'visible']);
  });

  it('abschaltbar unter Einstellungen → Website', async () => {
    const off = await as.admin.patch('/api/admin/settings', { showSuccessPublic: false });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.json.settings.showSuccessPublic, false);
    assert.deepEqual((await pub()).json, { visible: false });
    await as.admin.patch('/api/admin/settings', { showSuccessPublic: true });
    assert.equal((await pub()).json.visible, true);
  });
});

describe('Direkt anfragen (Wunschanwalt)', () => {
  it('Teamkarten mit aktivem Anwaltskonto sind anfragbar – ohne Konto-Daten preiszugeben', async () => {
    const { team } = (await client(server.base).get('/api/team')).json;
    const bookable = team.filter((m) => m.bookable);
    assert.ok(bookable.length, JSON.stringify(team));
    for (const m of team) {
      assert.equal(m.userId, undefined);
      assert.equal(m.userEmail, undefined);
    }
    data.member = bookable[0];
  });

  it('die Anfrage landet direkt beim Wunschanwalt (zugewiesen, in Bearbeitung)', async () => {
    const r = await client(server.base).post('/api/public/cases', {
      name: 'Wilma Wunsch',
      area: 'strafrecht',
      description: 'Ich möchte genau diesen Anwalt für meine Verteidigung.',
      teamMemberId: data.member.id,
    });
    assert.equal(r.status, 201, r.text);
    assert.ok(r.json.lawyerName, 'Name für die Bestätigung');
    const c = (await as.admin.get('/api/cases')).json.cases.find((x) => x.caseNumber === r.json.caseNumber);
    assert.equal(c.status, 'in_bearbeitung');
    assert.equal(c.lawyerName, r.json.lawyerName);
    const det = (await as.admin.get(`/api/cases/${c.id}`)).json;
    assert.ok(det.notes.some((n) => n.body.includes(`gewünscht: ${r.json.lawyerName}`)));
  });

  it('unbekannte oder ausgeblendete Teamkarte: Anfrage geht wie immer an alle', async () => {
    const r = await client(server.base).post('/api/public/cases', {
      name: 'Otto Offen',
      area: 'zivilrecht',
      description: 'Bitte um Rückruf wegen eines Mietstreits.',
      teamMemberId: 99999,
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.lawyerName, null);
    const c = (await as.admin.get('/api/cases')).json.cases.find((x) => x.caseNumber === r.json.caseNumber);
    assert.equal(c.status, 'offen');
    assert.equal(c.lawyerId, null);
  });
});
