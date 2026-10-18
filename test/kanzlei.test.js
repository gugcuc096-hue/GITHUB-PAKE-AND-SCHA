'use strict';
/*
 * Strafkatalog & Strafmaß-Rechner, Kanzlei-Wiki, Board-Beschlüsse, Anwalt des Monats, mitdenkende Suche
 * und Stornieren einer Rechnung (statt Knopf in der Liste).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

let server;
const as = {};
const data = {};

before(async () => {
  server = await startServer();
  for (const k of ['admin', 'partner', 'anwalt']) {
    as[k] = client(server.base);
    as[k].me = await as[k].login(TEAM[k]);
  }
  as.mandant = client(server.base);
  assert.equal((await as.mandant.post('/api/auth/register', { displayName: 'Jürgen Müller', email: 'juergen.mueller', password: 'Mandanten-Passwort-9' })).status, 201);
  as.mandant.me = await as.mandant.login('juergen.mueller', 'Mandanten-Passwort-9');
  const c = await as.anwalt.post('/api/cases', { title: 'Schießerei am Pier', area: 'strafrecht', clientEmail: 'juergen.mueller' });
  assert.equal(c.status, 201, c.text);
  data.caseId = c.json.case.id;
  data.catalog = (await as.anwalt.get('/api/penal')).json;
});
after(async () => {
  if (server) await server.stop();
});

const offence = (para) => data.catalog.offences.find((o) => o.para === para);

describe('Strafkatalog & Strafmaß-Rechner', () => {
  it('StGB ist eingespielt: Gesetzestexte und Strafrahmen, nur für die Kanzlei', async () => {
    assert.ok(data.catalog.offences.length > 100 && data.catalog.laws.length > 100);
    assert.equal(data.catalog.cap, 120);
    assert.equal(data.catalog.capSevere, 180);
    assert.equal(data.catalog.canEdit, false, 'Associate pflegt den Katalog nicht');
    const law = await as.anwalt.get('/api/penal/laws/21');
    assert.equal(law.status, 200);
    assert.match(law.json.law.title, /Körperverletzung/);
    assert.equal((await as.mandant.get('/api/penal')).status, 403);
  });

  it('gleicher Tatbestand zweimal = Anzahl 2 statt doppelter Zeile; Gesamtstrafe gedeckelt (§ 3)', async () => {
    const kv = offence('21');
    let r = await as.anwalt.post(`/api/cases/${data.caseId}/charges`, { offenceId: kv.id });
    assert.equal(r.status, 201, r.text);
    r = await as.anwalt.post(`/api/cases/${data.caseId}/charges`, { offenceId: kv.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.charges.length, 1);
    assert.equal(r.json.charges[0].count, 2);
    // Mord: nach oben offen, schwerer Fall → Obergrenze 180 HE
    r = await as.anwalt.post(`/api/cases/${data.caseId}/charges`, { offenceId: offence('18').id });
    assert.equal(r.json.sentence.cap, 180);
    assert.equal(r.json.sentence.maxHe, 180);
    assert.equal(r.json.sentence.severe, true);
    // Mandant sieht keine Anklagepunkte, ändert keine
    assert.equal((await as.mandant.get(`/api/cases/${data.caseId}`)).json.charges, undefined);
    assert.equal((await as.mandant.post(`/api/cases/${data.caseId}/charges`, { offenceId: kv.id })).status, 404);
  });

  it('Board pflegt den Katalog, Associates nicht', async () => {
    const body = { para: '21', paragraph: 'Abs. 9', title: 'Testtatbestand', minHe: 1, maxHe: 5, fine: 'alt', fineMax: 2000 };
    assert.equal((await as.anwalt.post('/api/penal/offences', body)).status, 403);
    const r = await as.partner.post('/api/penal/offences', body);
    assert.equal(r.status, 201, r.text);
    assert.equal((await as.partner.patch(`/api/penal/offences/${r.json.offence.id}`, { ...body, maxHe: 0 })).status, 400, 'Obergrenze unter Untergrenze');
    assert.equal((await as.partner.del(`/api/penal/offences/${r.json.offence.id}`)).status, 200);
  });
});

describe('Kanzlei-Wiki', () => {
  it('Grundlagen-Artikel sind da (ohne Server-Regeln); Mandanten haben keinen Zugang', async () => {
    const r = await as.anwalt.get('/api/wiki');
    assert.equal(r.status, 200);
    assert.ok(r.json.articles.length >= 4);
    assert.equal(r.json.canEdit, false);
    assert.ok(r.json.articles.every((a) => !/serverregel|regelwerk/i.test(`${a.title} ${a.text}`)));
    assert.equal((await as.mandant.get('/api/wiki')).status, 403);
  });

  it('Board schreibt, Associates lesen', async () => {
    const body = { title: 'Haftprüfung beantragen', category: 'Gerichtspraxis', body: '## Ablauf\n- Antrag stellen\n- **Frist** beachten' };
    assert.equal((await as.anwalt.post('/api/wiki', body)).status, 403);
    const r = await as.admin.post('/api/wiki', body);
    assert.equal(r.status, 201, r.text);
    data.wikiId = r.json.article.id;
    const read = await as.anwalt.get(`/api/wiki/${data.wikiId}`);
    assert.equal(read.json.article.body, body.body);
    assert.equal((await as.admin.patch(`/api/wiki/${data.wikiId}`, { pinned: true })).json.article.pinned, true);
  });
});

describe('Board-Beschlüsse', () => {
  it('Antrag, Abstimmung, entschieden sobald alle abgestimmt haben', async () => {
    assert.equal((await as.anwalt.get('/api/resolutions')).status, 403, 'nur Board of Partners');
    const r = await as.admin.post('/api/resolutions', { title: 'Notfallhonorar auf 7.500 $ erhöhen', body: 'Mehr Einsätze nachts.', deadlineHours: 72, vote: 'ja' });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.resolution.reference, /^B-\d{4}-001$/);
    assert.equal(r.json.resolution.status, 'offen');
    assert.equal((await as.partner.get('/api/resolutions/pending')).json.pending, 1);
    assert.equal((await as.admin.get('/api/resolutions/pending')).json.pending, 0, 'eigene Stimme schon abgegeben');
    const v = await as.partner.post(`/api/resolutions/${r.json.resolution.id}/vote`, { vote: 'nein' });
    assert.equal(v.status, 200, v.text);
    // 1 Ja, 1 Nein → nicht mehr Ja als Nein → abgelehnt
    assert.equal(v.json.decided, 'abgelehnt');
    assert.equal((await as.partner.post(`/api/resolutions/${r.json.resolution.id}/vote`, { vote: 'ja' })).status, 409);
  });

  it('Abstimmung beenden bzw. zurückziehen nur durch die antragstellende Person (oder Admin)', async () => {
    const r = (await as.partner.post('/api/resolutions', { title: 'Neue Dienstwagen anschaffen', deadlineHours: null, vote: 'ja' })).json.resolution;
    assert.equal(r.reference.endsWith('-002'), true);
    const closed = await as.partner.post(`/api/resolutions/${r.id}/close`);
    assert.equal(closed.json.decided, 'angenommen');
    const r2 = (await as.partner.post('/api/resolutions', { title: 'Kanzleifeier im Bahama Mamas' })).json.resolution;
    assert.equal((await as.partner.post(`/api/resolutions/${r2.id}/withdraw`)).json.resolution.status, 'zurueckgezogen');
    const list = (await as.admin.get('/api/resolutions')).json.resolutions;
    assert.deepEqual(list.map((x) => x.status).sort(), ['abgelehnt', 'angenommen', 'zurueckgezogen']);
  });
});

describe('Anwalt des Monats', () => {
  it('vom Board gewählt: Lorbeer auf der Teamkarte und der Profilseite', async () => {
    const team = (await client(server.base).get('/api/team')).json.team;
    const lex = team.find((m) => /Lex/.test(m.name));
    assert.ok(lex);
    assert.ok(team.every((m) => !m.lawyerOfMonth), 'automatisch: im Vormonat nichts abgeschlossen → niemand');
    const s = await as.admin.patch('/api/admin/settings', { lotmMode: 'manual', lotmMember: lex.id });
    assert.equal(s.status, 200, s.text);
    assert.equal(s.json.settings.lotmCurrent.name, lex.name);
    const after = (await client(server.base).get('/api/team')).json.team;
    assert.match(after.find((m) => m.id === lex.id).lawyerOfMonth, /^\S+ \d{4}$/);
    assert.equal(after.filter((m) => m.lawyerOfMonth).length, 1);
    const page = await client(server.base).get(`/team/${lex.slug}`);
    assert.match(page.text, /lotm-badge[^>]*>.*Anwalt des Monats/s);
    await as.admin.patch('/api/admin/settings', { lotmMode: 'off' });
    assert.ok((await client(server.base).get('/api/team')).json.team.every((m) => !m.lawyerOfMonth));
  });
});

describe('Suche, die mitdenkt', () => {
  it('Umlaute und Tippfehler finden Mandanten und Akten; gefundene Wörter zum Hervorheben', async () => {
    for (const q of ['Mueller', 'Muller', 'Müler']) {
      const r = (await as.anwalt.get(`/api/search?q=${encodeURIComponent(q)}`)).json;
      assert.ok(r.results.clients.some((c) => c.name === 'Jürgen Müller'), `Mandant über „${q}“`);
      assert.ok(r.results.cases.some((c) => c.id === data.caseId), `Akte über „${q}“`);
    }
    const typo = (await as.anwalt.get(`/api/search?q=${encodeURIComponent('Schiesserei')}`)).json;
    assert.ok(typo.results.cases.some((c) => c.id === data.caseId));
    assert.ok(typo.terms.includes('Schießerei'));
  });

  it('Notizen & Chat: Kanzlei auch interne Notizen, Mandant nur den Chat seiner Akte', async () => {
    await as.anwalt.post(`/api/cases/${data.caseId}/notes`, { body: 'Zeuge Kowalski widerspricht sich', internal: true });
    await as.mandant.post(`/api/cases/${data.caseId}/notes`, { body: 'Kowalski war gar nicht am Pier' });
    const staff = (await as.anwalt.get('/api/search?q=Kowalski')).json.results.notes;
    assert.equal(staff.length, 2);
    const own = (await as.mandant.get('/api/search?q=Kowalski')).json.results.notes;
    assert.deepEqual(own.map((n) => n.internal), [false]);
    assert.equal((await as.mandant.get('/api/search?q=Kowalski')).json.results.wiki.length, 0);
  });

  it('Wiki und Strafgesetzbuch (nur Kanzlei)', async () => {
    const r = (await as.anwalt.get(`/api/search?q=${encodeURIComponent('Haftprüfung')}`)).json.results;
    assert.ok(r.wiki.some((a) => a.id === data.wikiId));
    const p = (await as.anwalt.get(`/api/search?q=${encodeURIComponent('§ 21')}`)).json.results.penal;
    assert.equal(p[0].para, '21');
    assert.ok((await as.anwalt.get('/api/search?q=Koerperverletzung')).json.results.penal.some((l) => l.para === '21'));
  });
});

describe('Rechnung stornieren', () => {
  it('geht weiterhin über die Rechnung selbst (Knopf in der Druckansicht)', async () => {
    const inv = await as.anwalt.post('/api/invoices', { kind: 'rechnung', caseId: data.caseId, clientName: 'Jürgen Müller', items: [{ description: 'Beratung', quantity: 1, unitPrice: 1000 }] });
    assert.equal(inv.status, 201, inv.text);
    const r = await as.anwalt.patch(`/api/invoices/${inv.json.invoice.id}`, { status: 'storniert' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await as.anwalt.get(`/api/invoices/${inv.json.invoice.id}`)).json.invoice.status, 'storniert');
  });
});
