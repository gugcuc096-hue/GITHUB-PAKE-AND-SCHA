'use strict';
/*
 * API-Tests: Anmeldung, Sicherheit, Rechte von Kanzlei und Mandanten, Mandatsanfrage, Notizen,
 * Rechnungen, Papierkorb, Mandantenstimmen, Suche und Datensicherung – gegen einen echten Server
 * mit frischer Datenbank (siehe helpers.js).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let server;
const as = {}; // angemeldete Clients: admin, anwalt, mandant, fremd
const state = {};

before(async () => {
  server = await startServer();
});
after(async () => {
  if (server) await server.stop();
});

describe('Server und Sicherheit', () => {
  it('meldet sich gesund', async () => {
    const r = await client(server.base).get('/api/health');
    assert.equal(r.status, 200);
  });

  it('liefert die strenge Content-Security-Policy aus', async () => {
    const r = await client(server.base).get('/');
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/, 'Skripte nur von der eigenen Domain');
    assert.match(csp, /script-src-attr 'none'/, 'keine onclick-Attribute');
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, 'keine Inline-Skripte');
    assert.match(csp, /frame-ancestors 'self'/, 'keine Einbettung in fremde Seiten');
    assert.match(csp, /object-src 'none'/, 'keine Plugins');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  it('verweigert die API ohne Anmeldung', async () => {
    const r = await client(server.base).get('/api/cases');
    assert.equal(r.status, 401);
  });

  it('blockiert schreibende Anfragen von fremden Seiten (CSRF)', async () => {
    const r = await client(server.base).post('/api/auth/login', { email: TEAM.admin, password: PASSWORD }, { Origin: 'https://boese.example' });
    assert.equal(r.status, 403);
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const r = await client(server.base).post('/api/auth/login', { email: TEAM.admin, password: 'falsch-falsch-falsch' });
    assert.equal(r.status, 401);
  });

  it('meldet Team-Konten mit dem Start-Passwort an', async () => {
    as.admin = client(server.base);
    as.anwalt = client(server.base);
    const admin = await as.admin.login(TEAM.admin);
    const anwalt = await as.anwalt.login(TEAM.anwalt);
    assert.equal(admin.role, 'admin');
    assert.equal(anwalt.role, 'anwalt');
    const me = await as.admin.get('/api/auth/me');
    assert.equal(me.status, 200);
  });

  it('verlängert die Sitzung bei Nutzung (7 Tage ab der letzten Nutzung)', async () => {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(require('node:path').join(server.dir, 'test.db'));
    try {
      const u = client(server.base);
      const user = await u.login(TEAM.partner);
      const soon = new Date(Date.now() + 2 * 864e5).toISOString(); // vor fünf Tagen angemeldet
      db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(soon, user.id);
      const r = await u.get('/api/auth/me');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('set-cookie') || '', /sid=.*Max-Age=604800/i);
      const { expires_at: exp } = db.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').get(user.id);
      assert.ok(new Date(exp) - Date.now() > 6.9 * 864e5, exp);
      // frisch verlängert: nicht bei jeder Anfrage erneut schreiben
      const again = await u.get('/api/auth/me');
      assert.equal(again.headers.get('set-cookie'), null);
    } finally {
      db.close();
    }
  });
});

describe('Mandatsanfrage über die Website', () => {
  it('nimmt eine Anfrage ohne Konto an und vergibt ein Aktenzeichen', async () => {
    const r = await client(server.base).post('/api/public/cases', {
      name: 'Erika Musterfrau',
      phone: '555-0101',
      area: 'strafrecht',
      urgency: 'eilig',
      description: 'Ich wurde festgenommen und brauche dringend anwaltliche Unterstützung.',
    });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.caseNumber, /^PS-/);
    assert.ok(r.json.pin, 'Pin für den Ticket-Beitritt');
    state.webCaseNumber = r.json.caseNumber;
  });

  it('weist Bots über das Honeypot-Feld ab', async () => {
    const r = await client(server.base).post('/api/public/cases', {
      name: 'Bot',
      area: 'sonstiges',
      description: 'Automatisch ausgefülltes Formular mit Werbung.',
      website: 'https://spam.example',
    });
    assert.equal(r.status, 400);
  });

  it('zeigt die Anfrage der Kanzlei in der Aktenliste', async () => {
    const r = await as.admin.get('/api/cases');
    assert.equal(r.status, 200);
    const c = r.json.cases.find((x) => x.caseNumber === state.webCaseNumber);
    assert.ok(c, 'Akte aus der Website-Anfrage');
    assert.equal(c.status, 'offen');
  });
});

describe('Akten und Rechte', () => {
  it('Anwalt legt eine Akte an', async () => {
    const r = await as.anwalt.post('/api/cases', { title: 'Vertragsprüfung Autohaus', area: 'vertragsrecht', clientName: 'Fremder Mandant' });
    assert.equal(r.status, 201, r.text);
    state.foreignCase = r.json.case;
  });

  it('Mandant registriert sich selbst (nur Rolle „mandant“)', async () => {
    as.mandant = client(server.base);
    const r = await as.mandant.post('/api/auth/register', { displayName: 'Max Mustermann', email: 'max.mustermann', password: 'Mandanten-Passwort-1' });
    assert.equal(r.status, 201, r.text);
    const me = await as.mandant.get('/api/auth/me');
    assert.equal(me.json.user.role, 'mandant');
    assert.equal(me.json.user.email, 'max.mustermann@pake-scha.ls');
  });

  it('Mandant sieht keine fremden Akten', async () => {
    const list = await as.mandant.get('/api/cases');
    assert.equal(list.status, 200);
    assert.equal(list.json.cases.length, 0);
    const one = await as.mandant.get(`/api/cases/${state.foreignCase.id}`);
    assert.equal(one.status, 404);
    const search = await as.mandant.get(`/api/search?q=${encodeURIComponent('Autohaus')}`);
    assert.equal(search.status, 200);
    assert.equal(search.json.results.cases.length, 0);
  });

  it('Mandant reicht über das Portal eine eigene Akte ein', async () => {
    const r = await as.mandant.post('/api/cases', { title: 'Streit um Schadensersatz', area: 'zivilrecht', description: 'Mein Wagen wurde beschädigt, der Verursacher zahlt nicht.' });
    assert.equal(r.status, 201, r.text);
    state.ownCase = r.json.case;
    const list = await as.mandant.get('/api/cases');
    assert.deepEqual(list.json.cases.map((c) => c.id), [state.ownCase.id]);
  });

  it('interne Notizen bleiben für den Mandanten unsichtbar', async () => {
    const id = state.ownCase.id;
    assert.equal((await as.admin.post(`/api/cases/${id}/notes`, { body: 'INTERN: Gegner ist vorbestraft.', internal: true })).status, 201);
    assert.equal((await as.admin.post(`/api/cases/${id}/notes`, { body: 'Wir haben den Gegner angeschrieben.' })).status, 201);
    const forClient = await as.mandant.get(`/api/cases/${id}`);
    assert.equal(forClient.status, 200);
    const bodies = forClient.json.notes.map((n) => n.body);
    assert.ok(bodies.includes('Wir haben den Gegner angeschrieben.'));
    assert.ok(!bodies.some((b) => b.includes('INTERN')), 'interne Notiz darf nicht beim Mandanten ankommen');
    const forStaff = await as.admin.get(`/api/cases/${id}`);
    assert.ok(forStaff.json.notes.some((n) => n.body.includes('INTERN')));
  });

  it('Kanzlei findet Akten über die globale Suche', async () => {
    const r = await as.admin.get(`/api/search?q=${encodeURIComponent('Autohaus')}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.results.cases.some((c) => c.id === state.foreignCase.id));
  });
});

describe('Rechnungen', () => {
  it('Kanzlei stellt eine Rechnung zur Akte aus (Summe stimmt)', async () => {
    const r = await as.admin.post('/api/invoices', {
      caseId: state.ownCase.id,
      items: [
        { description: 'Persönliche Rechtsberatung', quantity: 1, unitPrice: 25000 },
        { description: 'Schriftsatz', quantity: 2, unitPrice: 10000 },
      ],
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.invoice.total, 45000);
    assert.equal(r.json.invoice.status, 'offen');
    state.invoice = r.json.invoice;
  });

  it('Mandant sieht nur seine Rechnungen', async () => {
    const own = await as.mandant.get('/api/invoices');
    assert.deepEqual(own.json.invoices.map((i) => i.id), [state.invoice.id]);
    as.fremd = client(server.base);
    assert.equal((await as.fremd.post('/api/auth/register', { displayName: 'Erika Fremd', email: 'erika.fremd', password: 'Fremdes-Passwort-1' })).status, 201);
    const foreign = await as.fremd.get('/api/invoices');
    assert.equal(foreign.json.invoices.length, 0);
    assert.equal((await as.fremd.get(`/api/invoices/${state.invoice.id}`)).status, 404);
  });
});

describe('Papierkorb', () => {
  it('nur das Board sieht den Papierkorb', async () => {
    assert.equal((await as.anwalt.get('/api/cases/trash')).status, 403);
    assert.equal((await as.mandant.get('/api/cases/trash')).status, 403);
  });

  it('gelöschte Akte landet im Papierkorb und lässt sich wiederherstellen', async () => {
    const id = state.foreignCase.id;
    assert.equal((await as.admin.del(`/api/cases/${id}`)).status, 200);
    assert.equal((await as.admin.get(`/api/cases/${id}`)).status, 404);
    const trash = await as.admin.get('/api/cases/trash');
    const item = trash.json.items.find((t) => t.caseId === id);
    assert.ok(item, 'Eintrag im Papierkorb');
    assert.equal(trash.json.keepDays, 30);
    const restored = await as.admin.post(`/api/cases/trash/${item.id}/restore`);
    assert.equal(restored.status, 200, restored.text);
    const back = await as.admin.get(`/api/cases/${id}`);
    assert.equal(back.status, 200);
    assert.equal(back.json.case.title, 'Vertragsprüfung Autohaus');
  });
});

describe('Mandantenstimmen', () => {
  it('Bewerten erst nach Abschluss der Akte', async () => {
    const early = await as.mandant.post('/api/reviews', { caseId: state.ownCase.id, rating: 5, body: 'Schnelle und kompetente Hilfe!' });
    assert.equal(early.status, 400);
    assert.equal((await as.admin.patch(`/api/cases/${state.ownCase.id}`, { status: 'geschlossen' })).status, 200);
  });

  it('Bewertung erscheint erst nach Freigabe durch das Board', async () => {
    const r = await as.mandant.post('/api/reviews', { caseId: state.ownCase.id, rating: 5, body: 'Schnelle und kompetente Hilfe!', nameMode: 'initialen' });
    assert.equal(r.status, 201, r.text);
    const before = await client(server.base).get('/api/public/reviews');
    assert.equal(before.json.reviews.length, 0);
    assert.equal((await as.anwalt.post(`/api/reviews/${r.json.review.id}/decide`, { status: 'freigegeben' })).status, 403);
    assert.equal((await as.admin.post(`/api/reviews/${r.json.review.id}/decide`, { status: 'freigegeben' })).status, 200);
    const after = await client(server.base).get('/api/public/reviews');
    assert.equal(after.json.reviews.length, 1);
    assert.equal(after.json.reviews[0].name, 'M. M.');
  });

  it('pro Akte nur eine Bewertung', async () => {
    const again = await as.mandant.post('/api/reviews', { caseId: state.ownCase.id, rating: 1, body: 'Zweite Bewertung derselben Akte.' });
    assert.equal(again.status, 409);
  });
});

describe('Datensicherung', () => {
  it('nur das Board sieht und lädt Sicherungen', async () => {
    assert.equal((await as.mandant.get('/api/admin/backups')).status, 403);
    assert.equal((await as.anwalt.get('/api/admin/backups')).status, 403);
    assert.equal((await as.admin.get('/api/admin/backups')).status, 200);
  });
});

describe('Abmelden', () => {
  it('beendet die Sitzung', async () => {
    assert.equal((await as.fremd.post('/api/auth/logout')).status, 200);
    assert.equal((await as.fremd.get('/api/cases')).status, 401);
  });
});
