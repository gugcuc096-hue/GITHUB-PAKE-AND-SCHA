'use strict';
/*
 * Live-Aktualisierung (Server-Sent Events, GET /api/events): wer bekommt welche Meldung?
 * Gemeldet wird nur „Akte X / Bereich Y geändert“ – Mandanten nur zu eigenen Akten, Bereiche nur die Kanzlei,
 * der Tab, der die Änderung gemacht hat, nicht noch einmal.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM } = require('./helpers');

describe('Live-Aktualisierung', () => {
  let server;
  const as = {};
  const ids = {};
  const streams = [];

  /** Live-Verbindung öffnen und alle Meldungen sammeln. */
  async function listen(who, tab) {
    const ctrl = new AbortController();
    const res = await fetch(`${server.base}/api/events?tab=${tab}`, { headers: { Cookie: who.cookie(), Accept: 'text/event-stream' }, signal: ctrl.signal });
    const s = { status: res.status, events: [], close: () => ctrl.abort() };
    streams.push(s);
    if (res.status !== 200) return s;
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    (async () => {
      const dec = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (line) s.events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch {
        /* geschlossen */
      }
    })();
    return s;
  }
  const settle = () => new Promise((r) => setTimeout(r, 250));

  before(async () => {
    server = await startServer();
    as.anwalt = client(server.base);
    as.anwalt.me = await as.anwalt.login(TEAM.anwalt);
    as.mandant = client(server.base);
    as.fremd = client(server.base);
    for (const [c, name, email] of [
      [as.mandant, 'Lena Live', 'lena.live'],
      [as.fremd, 'Fritz Fremd', 'fritz.fremd'],
    ]) {
      assert.equal((await c.post('/api/auth/register', { displayName: name, email, password: 'Mandanten-Passwort-1' })).status, 201);
      await c.login(email, 'Mandanten-Passwort-1');
    }
    ids.own = (await as.anwalt.post('/api/cases', { title: 'Live-Akte', area: 'zivilrecht', clientEmail: 'lena.live' })).json.case.id;
    ids.other = (await as.anwalt.post('/api/cases', { title: 'Fremde Akte', area: 'zivilrecht', clientEmail: 'fritz.fremd' })).json.case.id;
  });
  after(async () => {
    for (const s of streams) s.close();
    if (server) await server.stop();
  });

  it('ohne Anmeldung keine Live-Verbindung', async () => {
    const res = await fetch(`${server.base}/api/events`);
    assert.equal(res.status, 401);
  });

  it('Mandant: nur eigene Akten; Kanzlei: Akte und Bereich; der ändernde Tab nicht', async () => {
    const mandant = await listen(as.mandant, 'm1');
    const fremd = await listen(as.fremd, 'f1');
    const anwaltSelf = await listen(as.anwalt, 'a-self');
    const anwaltOther = await listen(as.anwalt, 'a-other');
    await settle();
    const r = await as.anwalt.post(`/api/cases/${ids.own}/notes`, { body: 'Termin steht fest.' }, { 'X-PS-Tab': 'a-self' });
    assert.equal(r.status, 201, r.text);
    await settle();
    assert.deepEqual(mandant.events, [{ k: 'case', id: ids.own, chat: false }], 'eigene Akte, keine Bereichsmeldung');
    assert.deepEqual(fremd.events, [], 'fremde Akte: nichts');
    assert.deepEqual(anwaltSelf.events, [], 'eigener Tab: nichts');
    assert.deepEqual(anwaltOther.events, [{ k: 'case', id: ids.own, chat: false }, { k: 'area', a: 'cases' }], 'anderer Tab derselben Person');
    // Gelesen-Markierung: nur „Chat“ – die Akte muss nicht neu gezeichnet werden
    const n = anwaltOther.events.length;
    assert.equal((await as.mandant.post(`/api/cases/${ids.own}/chat/read`, { lastId: r.json.id })).status, 200);
    await settle();
    assert.deepEqual(anwaltOther.events.slice(n), [{ k: 'case', id: ids.own, chat: true }], 'gelesen: nur die Akte, keine Liste');
    // Änderung an der fremden Akte erreicht den Mandanten nicht
    mandant.events.length = 0;
    await as.anwalt.patch(`/api/cases/${ids.other}`, { title: 'Fremde Akte (neu)' });
    await settle();
    assert.deepEqual(mandant.events, []);
    assert.equal(fremd.events.length, 1);
    // Fehlgeschlagene Änderungen melden nichts
    const before = anwaltOther.events.length;
    await as.mandant.patch(`/api/cases/${ids.other}`, { title: 'Hack' });
    await settle();
    assert.equal(anwaltOther.events.length, before);
  });

  it('Eingänge über die öffentlichen Seiten erreichen nur die Kanzlei – Abfragen melden nichts', async () => {
    const kanzlei = await listen(as.anwalt, 'a-public');
    const mandant = await listen(as.mandant, 'm-public');
    await settle();
    const guest = client(server.base);
    const web = await guest.post('/api/public/cases', { name: 'Gina Gast', area: 'zivilrecht', description: 'Anfrage über die Website zum Live-Test.' });
    assert.equal(web.status, 201, web.text);
    const app = await guest.post('/api/public/applications', { positionId: null, name: 'Ben Bewerber', discord: 'ben.bewerber', motivation: 'Ich möchte bei Pake & Scha anfangen und bringe Erfahrung aus der Rechtsberatung mit.', accept: true });
    assert.equal(app.status, 201, app.text);
    await settle();
    assert.deepEqual(kanzlei.events, [{ k: 'area', a: 'cases' }, { k: 'area', a: 'applications' }]);
    // Antwort des Bewerbers auf seiner Seite: die Kanzlei sieht sie im offenen Fenster sofort
    assert.equal((await guest.post('/api/public/application-portal/messages', { token: app.json.token, body: 'Passt mir gut.' })).status, 201);
    assert.equal((await guest.post('/api/public/application-portal', { token: app.json.token })).status, 200);
    await settle();
    assert.deepEqual(kanzlei.events.slice(2), [{ k: 'area', a: 'applications' }], 'Lesen der Bewerberseite meldet nichts');
    assert.deepEqual(mandant.events, [], 'Mandanten bekommen davon nichts');
  });
});
