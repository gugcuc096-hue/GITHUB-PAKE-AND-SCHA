'use strict';
/*
 * Präzedenzfälle: anlegen, suchen, Rechte, Entwurf aus der Akte, „Ähnliche Fälle“ in der Akte – API und Browser
 * (Wiki-Reiter und Akte am PC und am Handy).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD, pickTab } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

/** Akte mit Anklage (Diebstahl, Raub) – liefert die Paragraphen der Anklage mit. */
async function caseWithCharges(who, title) {
  const c = (await who.post('/api/cases', { title, area: 'strafrecht', clientName: 'Anna Anonym' })).json.case;
  const parsed = (await who.post('/api/penal/parse', { text: 'Diebstahl\nRaub' })).json.items;
  await who.post(`/api/cases/${c.id}/charges/bulk`, { items: parsed.map((i) => ({ offenceId: i.offenceId, count: 1 })) });
  const paras = (await who.get(`/api/cases/${c.id}/charges`)).json.charges.map((x) => x.para);
  return { c, paras };
}

describe('Präzedenzfälle (API)', () => {
  let srv;
  let owner;
  let lawyer;
  let mandant;
  let first;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    lawyer = client(srv.base);
    mandant = client(srv.base);
    await owner.login(TEAM.admin);
    await lawyer.login(TEAM.anwalt);
    first = await caseWithCharges(owner, 'Juwelier am Vinewood Boulevard');
  });
  after(() => srv.stop());

  const body = (extra = {}) => ({ title: 'Einbruch mit Geständnis', area: 'strafrecht', outcome: 'milderung', sentenceHe: 40, sentenceFine: 15000, paragraphs: '§ 33, § 34', tags: 'Geständnis, Ersttäter', summary: 'Ersttäter, geständig, Beute zurückgegeben.', arguments: 'Frühes Geständnis und Schadenswiedergutmachung.', result: '40 HE statt 90 HE', lessons: 'Früh mit der Staatsanwaltschaft sprechen.', ...extra });

  it('anlegen, ansehen, Prüfung der Angaben; Mandanten haben keinen Zugriff', async () => {
    assert.equal((await owner.post('/api/precedents', { ...body(), title: 'x' })).status, 400);
    assert.equal((await owner.post('/api/precedents', body({ area: 'gibts-nicht' }))).status, 400);
    assert.equal((await owner.post('/api/precedents', body({ outcome: 'quatsch' }))).status, 400);
    const r = await owner.post('/api/precedents', body());
    assert.equal(r.status, 201, r.text);
    const p = r.json.precedent;
    assert.equal(p.areaLabel, 'Strafrecht');
    assert.equal(p.outcomeLabel, 'Strafmilderung erreicht');
    assert.equal(p.success, true);
    assert.deepEqual(p.paragraphs, ['§ 33', '§ 34']);
    assert.deepEqual(p.tags, ['Geständnis', 'Ersttäter']);
    assert.equal((await lawyer.get(`/api/precedents/${p.id}`)).json.canEdit, false, 'fremder Eintrag: nur ansehen');
    await mandant.post('/api/auth/register', { displayName: 'Mia Mandant', email: 'mia.mandant', password: 'Mandanten-Passwort-9' });
    assert.equal((await mandant.get('/api/precedents')).status, 403);
    assert.equal((await mandant.post('/api/precedents', body())).status, 403);
  });

  it('Suche und Filter: Wörter, Rechtsgebiet, Ergebnis, Schlagwort – Umlaute egal', async () => {
    await lawyer.post('/api/precedents', body({ title: 'Verkehrsunfall mit Fahrerflucht', area: 'zivilrecht', outcome: 'verloren', paragraphs: '§ 50', tags: 'Fahrerflucht', summary: 'Zeuge sah das Kennzeichen.', arguments: '', result: '', lessons: '' }));
    const all = (await owner.get('/api/precedents')).json;
    assert.equal(all.precedents.length, 2);
    const names = (q) => q.json.precedents.map((x) => x.title);
    assert.deepEqual(names(await owner.get('/api/precedents?q=gestaendnis')), ['Einbruch mit Geständnis'], 'ä = ae');
    assert.deepEqual(names(await owner.get('/api/precedents?q=zeuge+kennzeichen')), ['Verkehrsunfall mit Fahrerflucht']);
    assert.deepEqual(names(await owner.get('/api/precedents?area=zivilrecht')), ['Verkehrsunfall mit Fahrerflucht']);
    assert.deepEqual(names(await owner.get('/api/precedents?outcome=milderung')), ['Einbruch mit Geständnis']);
    assert.deepEqual(names(await owner.get('/api/precedents?tag=fahrerflucht')), ['Verkehrsunfall mit Fahrerflucht']);
    assert.equal((await owner.get('/api/precedents?q=nichts-da')).json.precedents.length, 0);
    assert.ok(all.tags.some((t) => t.tag === 'Geständnis' && t.n === 1));
    // Liste ohne lange Texte
    assert.equal(all.precedents[0].lessons, '');
  });

  it('ändern und löschen: wer ihn angelegt hat oder das Board', async () => {
    const mine = (await lawyer.get('/api/precedents')).json.precedents.find((p) => p.title.startsWith('Verkehrsunfall'));
    const edit = await lawyer.patch(`/api/precedents/${mine.id}`, { ...body(), title: 'Verkehrsunfall mit Fahrerflucht (geändert)', area: 'zivilrecht' });
    assert.equal(edit.status, 200, edit.text);
    const theirs = (await owner.get('/api/precedents')).json.precedents.find((p) => p.title.startsWith('Einbruch'));
    assert.equal((await lawyer.patch(`/api/precedents/${theirs.id}`, body())).status, 403);
    assert.equal((await lawyer.del(`/api/precedents/${theirs.id}`)).status, 403);
    assert.equal((await owner.patch(`/api/precedents/${mine.id}`, { ...body(), title: 'Board darf das auch' })).status, 200);
    assert.equal((await owner.del(`/api/precedents/${mine.id}`)).status, 200);
    assert.equal((await owner.get(`/api/precedents/${mine.id}`)).status, 404);
  });

  it('Entwurf aus der Akte, ein Eintrag je Akte, Aktennummer für die, die die Akte sehen dürfen', async () => {
    await owner.patch(`/api/cases/${first.c.id}`, { status: 'geschlossen', outcome: 'freispruch' });
    const draft = (await owner.get(`/api/precedents/draft/${first.c.id}`)).json;
    assert.equal(draft.draft.title, 'Juwelier am Vinewood Boulevard');
    assert.equal(draft.draft.outcome, 'freispruch');
    assert.deepEqual(draft.draft.paragraphs.sort(), first.paras.sort());
    assert.equal(draft.existingId, null);
    assert.equal((await mandant.get(`/api/precedents/draft/${first.c.id}`)).status, 403, 'Mandanten: kein Zugriff');
    const made = await owner.post('/api/precedents', { ...body({ title: 'Juwelier – Freispruch', outcome: 'freispruch', paragraphs: first.paras.join(', ') }), caseId: first.c.id });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.precedent.caseNumber, first.c.caseNumber);
    assert.equal((await owner.post('/api/precedents', { ...body(), caseId: first.c.id })).status, 409, 'nur ein Eintrag je Akte');
    assert.equal((await owner.get(`/api/precedents/draft/${first.c.id}`)).json.existingId, made.json.precedent.id);
    assert.equal((await lawyer.post('/api/precedents', { ...body({ title: 'Zweiter Eintrag zur Akte' }), caseId: first.c.id })).status, 409, 'auch für andere: nur ein Eintrag je Akte');
    assert.equal((await lawyer.post('/api/precedents', { ...body({ title: 'Akte gibt es nicht' }), caseId: 999999 })).status, 404);
    const notes = (await owner.get(`/api/cases/${first.c.id}`)).json;
    assert.equal(notes.precedentId, made.json.precedent.id);
    assert.ok(notes.notes.some((n) => /Präzedenzfall festgehalten/.test(n.body)));
  });

  it('Ähnliche Fälle in der Akte: gleiche Paragraphen zählen vor dem Rechtsgebiet; eigene Akte nie; Mandant sieht nichts', async () => {
    const second = await caseWithCharges(owner, 'Banküberfall Doe');
    const detail = (await owner.get(`/api/cases/${second.c.id}`)).json;
    assert.ok(detail.similar.length >= 1);
    assert.equal(detail.similar[0].title, 'Juwelier – Freispruch');
    assert.equal(detail.similar[0].sharedParagraphs, first.paras.length);
    assert.ok(!detail.similar.some((s) => s.caseId === second.c.id));
    const own = (await owner.get(`/api/cases/${first.c.id}`)).json;
    assert.ok(!own.similar.some((s) => s.caseId === first.c.id), 'der eigene Fall ist nicht „ähnlich“');
    // Akte ohne Anklage und anderes Rechtsgebiet: nichts Ähnliches
    const plain = (await owner.post('/api/cases', { title: 'Mietstreit Müller', area: 'verfassungsrecht', clientName: 'Karl Klein' })).json.case;
    assert.deepEqual((await owner.get(`/api/cases/${plain.id}`)).json.similar, []);
    const m = (await mandant.get('/api/cases')).json;
    assert.equal(JSON.stringify(m).includes('similar'), false);
  });
});

describe('Präzedenzfälle im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let closed;
  let closedByDevice = {};
  let open;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const a = client(srv.base);
    await a.login(TEAM.admin);
    closed = await caseWithCharges(a, 'Juwelier am Vinewood Boulevard');
    await a.patch(`/api/cases/${closed.c.id}`, { status: 'geschlossen', outcome: 'freispruch' });
    for (const n of ['PC', 'Handy']) {
      closedByDevice[n] = await caseWithCharges(a, `Juwelier am Vinewood Boulevard ${n}`);
      await a.patch(`/api/cases/${closedByDevice[n].c.id}`, { status: 'geschlossen', outcome: 'freispruch' });
    }
    open = await caseWithCharges(a, 'Banküberfall Doe');
    await a.post('/api/precedents', { title: 'Ladendiebstahl – Einstellung', area: 'strafrecht', outcome: 'eingestellt', paragraphs: closed.paras.join(', '), tags: 'Ersttäter', summary: 'Geringer Wert, Ersttäter.', arguments: 'Täter-Opfer-Ausgleich.', result: 'Eingestellt.', lessons: '' });
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 900 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Wiki-Reiter mit Suche, Neuer Fall; Akte zeigt ähnliche Fälle und „Als Präzedenzfall festhalten“`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForFunction(() => st.user && st.user.id, null, { timeout: 15000 });
      // Wiki → Präzedenzfälle
      await page.evaluate(() => (location.hash = '#wiki'));
      await page.waitForSelector('[data-action="wiki-tab"][data-tab="fall"]');
      await pickTab(page, '[data-action="wiki-tab"][data-tab="fall"]');
      await page.waitForSelector('.prec-card');
      await page.fill('#precSearch', 'ausgleich');
      await page.waitForFunction(() => document.querySelectorAll('.prec-card').length === 1);
      await page.fill('#precSearch', 'gibts-nicht-xyz');
      await page.waitForFunction(() => !document.querySelector('.prec-card'));
      await page.fill('#precSearch', '');
      await page.waitForSelector('.prec-card');
      // Neuer Fall
      await page.click('[data-action="prec-new"]');
      await page.fill('#prTitle', `Handy-Test ${name}`);
      await page.selectOption('#prArea', 'strafrecht');
      await page.selectOption('#prOutcome', 'freispruch');
      await page.fill('#prTags', 'Test, Beweis');
      await page.click('form[data-form="prec-save"] button[type=submit]');
      await page.waitForFunction((t) => [...document.querySelectorAll('.prec-card')].some((c) => c.textContent.includes(t)), `Handy-Test ${name}`);
      await page.click('.prec-card');
      await page.waitForSelector('#modalBody .prec-block, #modalBody .prec-meta');
      await page.click('[data-action="close-modal"], .modal-close');
      // Offene Akte: ähnliche Fälle ohne „festhalten“-Knopf
      await page.evaluate((id) => openCase(id), open.c.id);
      await page.waitForSelector('#precStrip .prec-row');
      assert.equal(await page.$('[data-action="prec-from-case"]'), null, 'offene Akte: kein Festhalten');
      assert.ok((await page.textContent('#precStrip')).includes('Ladendiebstahl'));
      await page.click('#precStrip .prec-row:has-text("Ladendiebstahl")');
      await page.waitForSelector('#modalBody .prec-block');
      assert.ok((await page.textContent('#modalBody')).includes('Täter-Opfer-Ausgleich'));
      await page.click('.modal-close');
      await page.waitForSelector('#precStrip');
      // Abgeschlossene Akte: festhalten mit Vorbelegung
      await page.evaluate((id) => openCase(id), closedByDevice[name].c.id);
      await page.waitForSelector('[data-action="prec-from-case"]');
      await page.click('[data-action="prec-from-case"]');
      await page.waitForSelector('#prTitle');
      assert.equal(await page.inputValue('#prTitle'), `Juwelier am Vinewood Boulevard ${name}`);
      assert.equal(await page.inputValue('#prOutcome'), 'freispruch');
      assert.ok((await page.inputValue('#prParas')).length > 0, 'Paragraphen der Anklage vorbelegt');
      if (name === 'PC') {
        await page.click('form[data-form="prec-save"] button[type=submit]');
        await page.waitForSelector('[data-action="prec-open"][data-child="1"]');
        assert.equal(await page.$('[data-action="prec-from-case"]'), null, 'danach nur noch ansehen');
      }
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }
});
