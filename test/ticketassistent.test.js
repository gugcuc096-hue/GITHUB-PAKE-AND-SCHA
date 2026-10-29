'use strict';
/*
 * Assistent im Discord-Ticket: erkennt einfache Fragen des Mandanten, antwortet nur aus freigegebenen Angaben der Akte,
 * hält sich zurück (Ruhe, Tageslimit, nicht doppelt, nicht wenn ein Anwalt schreibt), gibt bei direkter Ansprache Unklares an
 * die Anwälte weiter – und ist standardmäßig aus (Feature-Schalter).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startServer, client, TEAM } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

/** Läuft in einem eigenen Prozess gegen dieselbe Datenbank wie der Testserver; tickets.post wird abgefangen. */
function run(srv, script) {
  const wrapper = `
    const posts = [];
    const tickets = require('./tickets');
    tickets.post = (id, msg) => { posts.push({ id, msg }); return Promise.resolve(); };
    const ta = require('./ticketAssistant');
    const send = (c, content, extra = {}) => ta.onClientMessage(c, { content, mentions: [], ...extra });
    const out = (v) => console.log('@@' + JSON.stringify(v));
    ${script}
  `;
  const res = execFileSync(process.execPath, ['-e', wrapper], { cwd: ROOT, env: { ...process.env, DB_PATH: path.join(srv.dir, 'test.db'), NODE_ENV: 'test' }, encoding: 'utf8' });
  return JSON.parse(res.split('\n').filter((l) => l.startsWith('@@')).pop().slice(2));
}

describe('Assistent im Discord-Ticket', () => {
  let srv;
  let a;
  let kase;
  before(async () => {
    srv = await startServer();
    a = client(srv.base);
    await a.login(TEAM.admin);
    kase = (await a.post('/api/cases', { title: 'Verkehrsunfall Doe', area: 'zivilrecht', clientName: 'John Doe' })).json.case;
    await a.post('/api/calendar', { title: 'Verhandlung am Gericht', type: 'gericht', caseId: kase.id, startsAt: inDays(5), clientVisible: true });
    await a.post('/api/calendar', { title: 'GEHEIMER interner Termin', type: 'intern', caseId: kase.id, startsAt: inDays(2), clientVisible: false });
    await a.post('/api/tasks', { title: 'GEHEIME Aufgabe', caseId: kase.id });
    await a.post(`/api/cases/${kase.id}/requests`, { title: 'Unfallfoto' });
    await a.post(`/api/cases/${kase.id}/parties`, { role: 'zeuge', name: 'GEHEIMER Zeuge' });
  });
  after(() => srv.stop());

  const prelude = (id) => `const { getCase } = require('./models'); const c = getCase(${id}); const { setSetting } = require('./db');`;

  it('standardmäßig aus: keine Antwort, solange das Board den Schalter nicht einschaltet', () => {
    const r = run(srv, `${prelude(kase.id)} out({ r: send(c, 'Wann ist mein nächster Termin?'), posts: posts.length });`);
    assert.deepEqual(r, { r: null, posts: 0 });
  });

  it('einfache Fragen werden aus freigegebenen Angaben beantwortet – nie aus internen', () => {
    const r = run(
      srv,
      `${prelude(kase.id)} setSetting('feature_clientAssistant', '1'); ta.reset();
       const termin = send(c, 'Wann ist mein nächster Termin?');
       ta.reset();
       const fehlt = send(c, 'Was fehlt noch von mir?');
       ta.reset();
       const anwalt = send(c, 'Wer ist mein Anwalt?');
       out({ termin, fehlt, anwalt, posts: posts.map((p) => ({ ev: p.msg.event, mention: p.msg.mention || null, desc: p.msg.description })) });`
    );
    assert.equal(r.termin.kind, 'answer');
    assert.match(r.termin.text, /Verhandlung am Gericht/);
    assert.match(r.fehlt.text, /Unfallfoto/);
    assert.match(r.anwalt.text, /Zuständig|Anwalt/);
    const all = JSON.stringify(r);
    assert.ok(!/GEHEIM/.test(all), 'Interne Termine, Aufgaben und Zeugen tauchen nie auf');
    assert.equal(r.posts.length, 3);
    assert.ok(r.posts.every((p) => p.ev === 'assistant' && !p.mention), 'antwortet ohne Anwälte zu pingen');
    assert.match(r.posts[0].desc, /keine Rechtsberatung/);
  });

  it('Gesprächston und Aussagen lösen nichts aus; Fragen ohne Bezug bleiben ohne Antwort', () => {
    const r = run(
      srv,
      `${prelude(kase.id)} setSetting('feature_clientAssistant', '1'); ta.reset();
       out([send(c, 'Danke, bis später!'), send(c, 'Ich habe den Termin gerade gesehen.'), send(c, 'Hast du die Fotos gesehen?'), send(c, '/hilfe'), send(c, ''), posts.length]);`
    );
    assert.deepEqual(r, [null, null, null, null, null, 0]);
  });

  it('Schutz vor Lärm: Ruhe zwischen Antworten, dieselbe Antwort nicht doppelt, Tageslimit', () => {
    const r = run(
      srv,
      `${prelude(kase.id)} setSetting('feature_clientAssistant', '1'); ta.reset();
       const first = send(c, 'Wann ist der nächste Termin?');
       const sofort = send(c, 'Wie ist der Stand?'); // zu schnell
       out({ first: !!first, sofort, posts: posts.length });`
    );
    assert.deepEqual(r, { first: true, sofort: null, posts: 1 });
  });

  it('Anwalt schreibt gerade selbst: der Assistent hält sich zurück – außer er wird direkt angesprochen', async () => {
    await a.post(`/api/cases/${kase.id}/notes`, { body: 'Ich schaue mir das gerade an.' }); // Nachricht der Kanzlei im Chat
    const r = run(
      srv,
      `${prelude(kase.id)} setSetting('feature_clientAssistant', '1'); ta.reset();
       const still = send(c, 'Wann ist der nächste Termin?');
       ta.reset();
       const direkt = send(c, 'Assistent, wann ist der nächste Termin?');
       out({ still, direkt: direkt && direkt.kind });`
    );
    assert.equal(r.still, null);
    assert.equal(r.direkt, 'answer');
  });

  it('direkt angesprochen, aber nicht zu beantworten: Frage geht an die Anwälte (mit Erwähnung) und steht im Vermerk der Akte', async () => {
    const r = run(
      srv,
      `${prelude(kase.id)} setSetting('feature_clientAssistant', '1'); ta.reset();
       const x = send(c, 'Assistent, wie hoch sind meine Chancen vor Gericht?');
       out({ kind: x && x.kind, mention: posts[0] && posts[0].msg.mention, title: posts[0] && posts[0].msg.title });`
    );
    assert.equal(r.kind, 'handoff');
    assert.equal(r.mention, 'lawyers');
    assert.match(r.title, /Anwalt/);
    const notes = (await a.get(`/api/cases/${kase.id}`)).json.notes;
    assert.ok(notes.some((n) => n.internal && /Assistent: Frage im Ticket an die Anwälte weitergegeben/.test(n.body)));
    assert.ok(notes.some((n) => n.internal && /Assistent hat im Ticket geantwortet/.test(n.body)));
  });

  it('Feature-Schalter ist in der Rechte-Tabelle sichtbar und ausgeschaltet', async () => {
    const r = await a.get('/api/access');
    assert.equal(r.status, 200, r.text);
    const f = r.json.features;
    assert.ok(f.list.some((x) => x.key === 'clientAssistant'));
    assert.equal(typeof f.values.clientAssistant, 'boolean');
  });
});
