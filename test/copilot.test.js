'use strict';
/*
 * Co-Pilot der Akte (regelbasiert, ohne KI-Dienst): Lücken und Risiken, Zusammenfassung, Fragen, Entwürfe – API (Inhalte,
 * Rechte, schreibt nie von selbst) und Bedienung in der Akte am PC und am Handy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');
const assistant = require('../assistant');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

async function seed(base, name) {
  const a = client(base);
  await a.login(TEAM.admin);
  const kase = (await a.post('/api/cases', { title: `Raubüberfall ${name}`, area: 'strafrecht', clientName: 'John Doe', opponent: 'Staatsanwaltschaft' })).json.case;
  const ev = (await a.upload(`/api/cases/${kase.id}/attachments?caption=Standbild%20Bodycam`, PNG, 'image/png')).json.attachment;
  await a.patch(`/api/cases/${kase.id}/attachments/${ev.id}`, { side: 'entlastend', status: 'bestritten', description: 'Zeigt, dass die Waffe erst später gezogen wurde.' });
  const w = (await a.post(`/api/cases/${kase.id}/parties`, { role: 'zeuge', name: 'Fritz Falkenhagen', summonAt: inDays(3) })).json.parties[0];
  await a.post('/api/tasks', { title: 'Akteneinsicht beantragen', caseId: kase.id, dueDate: '2020-01-01' });
  await a.post('/api/calendar', { title: 'Stellungnahme', type: 'frist', caseId: kase.id, startsAt: inDays(1) });
  return { a, kase, ev, w };
}

describe('Co-Pilot (API)', () => {
  let srv;
  let a;
  let kase;
  before(async () => {
    srv = await startServer();
    ({ a, kase } = await seed(srv.base, 'API'));
  });
  after(() => srv.stop());

  const base = () => `/api/cases/${kase.id}/copilot`;
  const ask = async (q) => (await a.post(`${base()}/ask`, { q })).json.answer;
  const texts = (x) => x.lines.map((l) => l.text).join('\n');

  it('Lücken und Risiken mit Dringlichkeit und Verweis auf die Stelle', async () => {
    const r = await a.get(base());
    assert.equal(r.status, 200, r.text);
    const g = r.json.gaps;
    const find = (re) => g.find((x) => re.test(x.text));
    assert.equal(find(/Frist „Stellungnahme“/).level, 'rot');
    assert.deepEqual(find(/Frist „Stellungnahme“/).ref.type, 'event');
    assert.equal(find(/Akteneinsicht beantragen.*überfällig/).level, 'rot');
    assert.equal(find(/Fritz Falkenhagen: Ladung in 3 Tagen/).level, 'gelb');
    assert.equal(find(/B1.*bestritten/).level, 'gelb');
    assert.equal(find(/B1.*bestritten/).ref.no, 1);
    assert.deepEqual(g.map((x) => x.level), [...g.map((x) => x.level)].sort((x, y) => ['rot', 'gelb', 'info'].indexOf(x) - ['rot', 'gelb', 'info'].indexOf(y)), 'dringendes zuerst');
    assert.ok(r.json.summary.some((s) => s.title === 'Zeugen') && r.json.summary.some((s) => s.title === 'Beweismittel'));
    assert.ok(r.json.questions.length >= 10 && r.json.drafts.length >= 5);
  });

  it('Fragen: Stichwörter, B-Nummern, ehrliches „weiß ich nicht“', async () => {
    assert.equal((await ask('Wie ist der Stand?')).intent, 'stand');
    assert.match(texts(await ask('Wann ist die nächste Frist?')), /Stellungnahme/);
    assert.match(texts(await ask('Wie stehen die Zeugen?')), /Fritz Falkenhagen/);
    const risiken = await ask('Wo gibt es Risiken?');
    assert.equal(risiken.intent, 'risiken');
    assert.match(texts(risiken), /überfällig/);
    const b1 = await ask('Was sagt B1?');
    assert.match(b1.title, /^B1 – Standbild Bodycam/);
    assert.match(texts(b1), /Waffe erst später gezogen/);
    assert.match(texts(await ask('Was zeigt B9?')), /gibt es in dieser Akte nicht/);
    const unknown = await ask('Wie wird das Wetter?');
    assert.equal(unknown.unknown, true);
    assert.match(texts(unknown), /keine Angaben/);
    assert.equal((await a.post(`${base()}/ask`, { q: 'x' })).status, 400, 'zu kurz');
  });

  it('Entwürfe aus den Aktendaten – ohne etwas in der Akte zu ändern', async () => {
    const before = (await a.get(`/api/cases/${kase.id}`)).json.notes.length;
    for (const kind of ['einleitung', 'statusnachricht', 'uebergabe', 'verhandlung', 'vorhalt', 'beweisverzeichnis']) {
      const r = await a.post(`${base()}/draft`, { kind });
      assert.equal(r.status, 200, `${kind}: ${r.text}`);
      assert.ok(r.json.draft.text.length > 20, kind);
    }
    const einleitung = (await a.post(`${base()}/draft`, { kind: 'einleitung' })).json.draft.text;
    assert.ok(einleitung.includes(kase.caseNumber) && einleitung.includes('John Doe') && einleitung.includes('Staatsanwaltschaft'));
    assert.match((await a.post(`${base()}/draft`, { kind: 'beweisverzeichnis' })).json.draft.text, /B1 – Standbild Bodycam/);
    assert.match((await a.post(`${base()}/draft`, { kind: 'uebergabe' })).json.draft.text, /Fritz Falkenhagen/);
    assert.equal((await a.post(`${base()}/draft`, { kind: 'roman' })).status, 400);
    assert.equal((await a.get(`/api/cases/${kase.id}`)).json.notes.length, before, 'der Co-Pilot schreibt nie von selbst in die Akte');
  });

  it('nur Kanzlei: Mandanten und fremde Anfragen kommen nicht heran', async () => {
    assert.equal((await client(srv.base).get(base())).status, 401);
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Mia Mandant', email: 'mia.mandant', password: 'Mandanten-Passwort-5' });
    await m.login('mia.mandant', 'Mandanten-Passwort-5');
    assert.equal((await m.get(base())).status, 404);
    assert.equal((await m.post(`${base()}/ask`, { q: 'Wie ist der Stand?' })).status, 404);
    assert.equal((await a.get('/api/cases/999999/copilot')).status, 404);
  });
});

describe('Co-Pilot: Regeln im Einzelnen', () => {
  const base = { case: { id: 1, caseNumber: 'PS-1', title: 'T', area: 'strafrecht', areaLabel: 'Strafrecht', step: 2, stepLabel: 'Verhandlung', statusLabel: 'In Bearbeitung', clientName: 'A', closed: false, lawyerId: 5, lawyerName: 'Dr. X', idleDays: 0, hasClientAccount: true, publicNote: 'ok' }, appointments: [], tasks: [], parties: [], attachments: [], invoices: [], requests: [], chat: { messages: [] }, charges: { charges: [], sentence: {}, estimate: {} } };
  const now = new Date('2026-06-10T10:00:00Z');

  it('Zeuge: Ladung vorbei ohne Aussage ist dringend, mit Aussage nicht; Interessenkonflikt', () => {
    const w = { id: 1, role: 'zeuge', name: 'Zeno', status: 'geladen', statusLabel: 'Geladen', side: 'belastend', summonAt: '2026-06-01T10:00:00Z', statement: '', contradictions: [], overlaps: [] };
    const g1 = assistant.gaps({ ...base, parties: [w] }, now);
    assert.ok(g1.some((x) => x.level === 'rot' && /keine Aussage erfasst/.test(x.text)));
    const g2 = assistant.gaps({ ...base, parties: [{ ...w, statement: 'Hat alles gesehen.' }] }, now);
    assert.ok(!g2.some((x) => /keine Aussage/.test(x.text)));
    const g3 = assistant.gaps({ ...base, parties: [{ ...w, status: 'ausgesagt', overlaps: [{ caseNumber: 'PS-9' }] }] }, now);
    assert.ok(g3.some((x) => x.level === 'rot' && /Interessenkonflikt/.test(x.text) && /PS-9/.test(x.text)));
  });

  it('unbeantwortete Nachricht des Mandanten, überfällige Rechnung, liegengebliebene Akte', () => {
    const msg = (hoursAgo, fromFirm) => ({ id: 3, fromFirm, body: 'Hallo?', createdAt: new Date(now - hoursAgo * 36e5).toISOString() });
    assert.ok(assistant.gaps({ ...base, chat: { messages: [msg(30, false)] } }, now).some((x) => x.level === 'gelb' && /unbeantwortet/.test(x.text)));
    assert.ok(assistant.gaps({ ...base, chat: { messages: [msg(100, false)] } }, now).some((x) => x.level === 'rot' && /unbeantwortet/.test(x.text)));
    assert.ok(!assistant.gaps({ ...base, chat: { messages: [msg(100, true)] } }, now).some((x) => /unbeantwortet/.test(x.text)), 'Kanzlei hat zuletzt geschrieben');
    assert.ok(assistant.gaps({ ...base, invoices: [{ id: 1, number: 'R-1', status: 'offen', total: 100, overdueDays: 20 }] }, now).some((x) => x.level === 'rot' && /R-1/.test(x.text)));
    assert.ok(assistant.gaps({ ...base, case: { ...base.case, idleDays: 9 } }, now).some((x) => x.level === 'gelb' && /9 Tagen ohne Aktivität/.test(x.text)));
  });

  it('abgeschlossene Akte meldet keine offenen Fristen, aber fehlende Rechnung', () => {
    const closed = { ...base, case: { ...base.case, closed: true }, appointments: [{ id: 1, type: 'frist', title: 'F', typeLabel: 'Frist', startsAt: '2026-06-11T10:00:00Z', status: 'bestaetigt' }] };
    const g = assistant.gaps(closed, now);
    assert.ok(!g.some((x) => /Frist/.test(x.text)));
    assert.ok(g.some((x) => /keine Rechnung/.test(x.text)));
  });

  it('Mandanten-Sicht kennt nur freigegebene Angaben (Termine, Unterlagen, Rechnungen, Anwalt)', () => {
    const d = { ...base, appointments: [{ id: 1, type: 'gericht', title: 'Verhandlung', typeLabel: 'Gerichtstermin', startsAt: '2026-06-12T10:00:00Z', status: 'bestaetigt', clientVisible: true }, { id: 2, type: 'intern', title: 'GEHEIMER Teamtermin', typeLabel: 'Intern', startsAt: '2026-06-11T10:00:00Z', status: 'bestaetigt', clientVisible: false }], tasks: [{ id: 1, title: 'GEHEIM Aufgabe', done: false }], requests: [{ id: 1, title: 'Führerschein-Foto', createdAt: '2026-06-01 10:00:00' }] };
    const termine = assistant.answer(d, 'Wann ist mein nächster Termin?', { now, audience: 'client' });
    const text = termine.lines.map((l) => l.text).join(' ');
    assert.match(text, /Verhandlung/);
    assert.ok(!/GEHEIM/.test(text));
    assert.match(assistant.answer(d, 'Was fehlt noch von mir?', { now, audience: 'client' }).lines.map((l) => l.text).join(' '), /Führerschein-Foto/);
    const zeug = assistant.answer(d, 'Welche Zeugen gibt es und welche Strafe droht?', { now, audience: 'client' });
    assert.equal(zeug.unknown, true, 'Strategie und Beweise bleiben beim Anwalt');
    assert.ok(!assistant.summary(d, now, 'client').map((s) => s.title).includes('Aufgaben'));
  });
});

describe('Co-Pilot in der Akte (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Lücken, Frage, Entwurf, als Notiz speichern`, async () => {
      const { kase } = await seed(srv.base, name);
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/login`);
        await page.fill('#email', TEAM.admin);
        await page.fill('#password', PASSWORD);
        await page.click('button[type=submit]');
        await page.waitForURL(/dashboard/);
        await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
        for (let versuch = 0; versuch < 3; versuch++) {
          await page.evaluate((id) => openCase(id), kase.id);
          if (await page.waitForSelector('#cpBody .cp-top', { timeout: 10000 }).then(() => true, () => false)) break;
        }
        await page.waitForSelector('#cpBody .cp-top');
        assert.ok((await page.textContent('#cpBody .cp-top')).includes('dringend'));
        // zugeklappt bleibt die Akte ruhig: nur die Zeile mit den Zahlen
        assert.equal(await page.evaluate(() => document.querySelector('#cpBody .cp-more').hidden), true);
        await page.click('#cpBody [data-action="cp-open"]');
        await page.waitForFunction(() => !document.querySelector('#cpBody .cp-more').hidden);
        assert.ok((await page.textContent('#cpBody .cp-gaps')).includes('Akteneinsicht beantragen'));
        // Sprung zur Stelle: Zeuge wird hervorgehoben
        await page.click('#cpBody .cp-line:has-text("Fritz Falkenhagen") .cp-go');
        await page.waitForFunction(() => document.querySelector('.cp-flash'), null, { timeout: 5000 });
        // Frage per Chip und per Eingabe
        await page.click('#cpBody [data-action="cp-q"]:has-text("Wie stehen die Zeugen?")');
        await page.waitForFunction(() => document.querySelector('#cpAnswer')?.textContent.includes('Fritz Falkenhagen'), null, { timeout: 8000 });
        await page.fill('#cpBody form[data-form="cp-ask"] input[name="q"]', 'Was sagt B1?');
        await page.click('#cpBody form[data-form="cp-ask"] button[type=submit]');
        await page.waitForFunction(() => document.querySelector('#cpAnswer')?.textContent.includes('B1 – Standbild Bodycam'), null, { timeout: 8000 });
        // Entwurf erzeugen, bearbeiten, als interne Notiz speichern
        await page.selectOption('#cpDraftKind', 'einleitung');
        await page.click('[data-action="cp-draft"]');
        await page.waitForSelector('#cpDraftText');
        assert.ok((await page.inputValue('#cpDraftText')).includes(kase.caseNumber));
        await page.fill('#cpDraftText', `${await page.inputValue('#cpDraftText')}\nZusatz vom Anwalt (${name})`);
        await page.click('[data-action="cp-note"]');
        await page.waitForFunction((t) => document.querySelector('#secNotes')?.textContent.includes(t), `Zusatz vom Anwalt (${name})`, { timeout: 8000 });
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }
});
