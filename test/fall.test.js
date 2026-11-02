'use strict';
/*
 * Fall-Bausteine je Rechtsgebiet (domain/fall.js, routes/fall.js, js/dashboard/12-fall.js): Zivilrecht (Ansprüche, Anträge,
 * Korrespondenz, Streitwert), Verfassungsrecht (angegriffener Akt, Zulässigkeit, Normen, Beteiligte), Vertragsrecht (Gegenstand,
 * Parteien, Klauseln, Laufzeit, Entwurfsversionen, Modus Gestaltung/Streit). API (Prüfung, Rechte) und Browser.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

describe('Fall-Bausteine je Rechtsgebiet (API)', () => {
  let srv;
  let admin;
  let anwalt;
  let zivil;
  let verf;
  let vertrag;
  let straf;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    anwalt = client(srv.base);
    await admin.login(TEAM.admin);
    await anwalt.login(TEAM.anwalt);
    const me = (await admin.get('/api/auth/session')).json.user;
    const mk = async (area, title) => (await admin.post('/api/cases', { title, area, clientName: 'Max Muster', lawyerId: me.id })).json.case;
    zivil = await mk('zivilrecht', 'Zivil');
    verf = await mk('verfassungsrecht', 'Verfassung');
    vertrag = await mk('vertragsrecht', 'Vertrag');
    straf = await mk('strafrecht', 'Straf');
  });
  after(() => srv.stop());

  const fall = async (c) => (await admin.get(`/api/cases/${c.id}`)).json.fall;

  it('die Akte liefert den Aufbau des Rechtsgebiets – Strafrecht hat keinen', async () => {
    assert.equal((await fall(straf)) ?? null, null);
    assert.deepEqual((await fall(zivil)).sections.map((s) => s.key), ['claims', 'motions', 'corr']);
    assert.deepEqual((await fall(verf)).sections.map((s) => s.key), ['subject', 'admiss', 'norms', 'participants']);
    assert.deepEqual((await fall(vertrag)).sections.map((s) => s.key), ['subject', 'parties', 'clauses', 'term', 'versions']);
    assert.equal((await fall(zivil)).retitle.tathergang, 'Streitgegenstand / Sachverhalt');
    assert.equal((await fall(vertrag)).retitle.evidence, 'Anlagen');
    // Mandanten sehen nichts davon
    const m = client(srv.base);
    await m.post('/api/auth/register', { displayName: 'Mia Fall', email: 'mia.fall', password: 'Mandanten-Passwort-5' });
    await m.login('mia.fall', 'Mandanten-Passwort-5');
    assert.equal((await m.put(`/api/cases/${zivil.id}/fall`, { streitwert: 5 })).status, 403);
  });

  it('Zivilrecht: Anspruch mit Status, Frist und Höhe; Streitwert; Antrag; Schreiben mit Frist – geprüft und geändert', async () => {
    const r = await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'claim', basis: '§ 823 BGB', claimant: 'Max', opponent: 'Bob', amount: 12500, status: 'bestritten', deadline: '2026-12-31' });
    assert.equal(r.status, 201);
    const claim = r.json.fall.items.claim[0];
    assert.equal(claim.amount, 12500);
    assert.equal(claim.status, 'bestritten');
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'claim', basis: '', amount: 1 })).status, 400, 'Anspruchsgrundlage ist nötig');
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'claim', basis: 'x', status: 'quatsch' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'claim', basis: 'x', amount: -5 })).status, 400);
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'claim', basis: 'x', deadline: '31.12.2026' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'clause', title: 'x' })).status, 400, 'Klauseln gibt es im Zivilrecht nicht');
    assert.equal((await admin.put(`/api/cases/${zivil.id}/fall`, { streitwert: 15000 })).json.fall.meta.streitwert, 15000);
    assert.equal((await admin.put(`/api/cases/${zivil.id}/fall`, { mode: 'streit' })).status, 400, 'fremde Felder werden abgelehnt');
    assert.equal((await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'motion', side: 'abweisung', text: 'Die Klage wird abgewiesen.' })).status, 201);
    const corr = await admin.post(`/api/cases/${zivil.id}/fall/items`, { kind: 'corr', type: 'fristsetzung', date: '2026-10-01', deadline: '2026-10-15' });
    assert.equal(corr.json.fall.items.corr[0].state, 'offen', 'Voreinstellung');
    // ändern: nur die mitgeschickten Felder
    const up = await admin.patch(`/api/cases/${zivil.id}/fall/items/${claim.id}`, { status: 'anerkannt' });
    assert.equal(up.json.fall.items.claim[0].status, 'anerkannt');
    assert.equal(up.json.fall.items.claim[0].basis, '§ 823 BGB');
    assert.equal((await admin.patch(`/api/cases/${zivil.id}/fall/items/${claim.id}`, { basis: '   ' })).status, 400, 'Pflichtfeld bleibt Pflicht');
    // Verlauf: Eintrag erscheint in den internen Notizen
    const notes = (await admin.get(`/api/cases/${zivil.id}`)).json.notes.map((n) => n.body).join('\n');
    assert.match(notes, /Anspruch erfasst: § 823 BGB/);
    // löschen
    const del = await admin.del(`/api/cases/${zivil.id}/fall/items/${claim.id}`);
    assert.equal(del.json.fall.items.claim.length, 0);
    assert.equal((await admin.del(`/api/cases/${zivil.id}/fall/items/${claim.id}`)).status, 404);
  });

  it('Verfassungsrecht: Zulässigkeit als Checkliste, Verfahrensart, Norm mit Rechtfertigungsprüfung, Beteiligte', async () => {
    const f = (await admin.put(`/api/cases/${verf.id}/fall`, { actType: 'urteil', procedure: 'eilantrag', c_befugnis: 'ja', c_frist: 'nein' })).json.fall;
    assert.equal(f.meta.procedure, 'eilantrag');
    assert.equal(f.meta.c_befugnis, 'ja');
    assert.equal(f.meta.c_rechtsweg, 'offen', 'Voreinstellung der Checkliste');
    assert.equal((await admin.put(`/api/cases/${verf.id}/fall`, { c_frist: 'vielleicht' })).status, 400);
    const n = await admin.post(`/api/cases/${verf.id}/fall/items`, { kind: 'norm', norm: 'Art. 5 – Meinungsfreiheit', purpose: 'ja', suitable: 'ja', necessary: 'nein', assessment: 'aussichtsreich' });
    assert.equal(n.status, 201);
    const norm = n.json.fall.items.norm[0];
    assert.deepEqual([norm.purpose, norm.suitable, norm.necessary, norm.proportional], ['ja', 'ja', 'nein', 'offen']);
    assert.equal((await admin.post(`/api/cases/${verf.id}/fall/items`, { kind: 'participant', name: 'Innenministerium', role: 'aeusserung', deadline: '2026-11-30' })).status, 201);
    assert.equal((await admin.post(`/api/cases/${verf.id}/fall/items`, { kind: 'claim', basis: 'x' })).status, 400, 'Ansprüche gehören nicht zur Verfassungsbeschwerde');
    const notes = (await admin.get(`/api/cases/${verf.id}`)).json.notes.map((x) => x.body).join('\n');
    assert.match(notes, /Verfahrensart: Eilantrag/);
  });

  it('Vertragsrecht: Parteien, Klauseln mit Ampel, Laufzeit, Entwurfsversionen (fortlaufend); Modus „Vertragsstreit“ blendet Ansprüche ein', async () => {
    assert.equal((await fall(vertrag)).meta.mode, 'gestaltung');
    assert.equal((await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'claim', basis: 'x' })).status, 201, 'die Art ist im Vertragsrecht erlaubt, der Abschnitt aber erst im Streit sichtbar');
    assert.ok(!(await fall(vertrag)).sections.some((s) => s.key === 'vclaims'));
    const p = await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'party', name: 'Immo GmbH', role: 'gegenseite', rep: 'Geschäftsführer', proof: 'ja' });
    assert.equal(p.json.fall.items.party[0].proof, 'ja');
    const c = await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'clause', topic: 'haftung', title: 'Haftung begrenzt', status: 'strittig', risk: 'rot' });
    assert.equal(c.json.fall.items.clause[0].risk, 'rot');
    assert.equal((await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'clause', topic: 'sonstwas', title: 'x' })).status, 400);
    await admin.put(`/api/cases/${vertrag.id}/fall`, { start: '2026-01-01', end: '2027-01-01', notice: '14 Tage' });
    await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'version', note: 'Erster Entwurf', date: '2026-02-01' });
    const v = await admin.post(`/api/cases/${vertrag.id}/fall/items`, { kind: 'version', note: 'Haftung angepasst', date: '2026-02-10' });
    assert.deepEqual(v.json.fall.items.version.map((x) => x.no), [1, 2], 'v1, v2 …');
    const s = (await admin.put(`/api/cases/${vertrag.id}/fall`, { mode: 'streit', breach: 'Miete nicht gezahlt' })).json.fall;
    assert.ok(s.sections.some((x) => x.key === 'vclaims'), 'Ansprüche aus dem Streit');
    assert.equal(s.meta.breach, 'Miete nicht gezahlt');
    assert.equal(s.items.claim.length, 1);
    const notes = (await admin.get(`/api/cases/${vertrag.id}`)).json.notes.map((x) => x.body).join('\n');
    assert.match(notes, /Modus der Akte: Vertragsstreit/);
  });

  it('nur die zuständigen Anwälte ändern; Strafrecht hat keine Bausteine; die Ansicht kennt die neuen Abschnitte', async () => {
    assert.equal((await admin.put(`/api/cases/${straf.id}/fall`, { streitwert: 5 })).status, 400);
    assert.equal((await admin.put(`/api/cases/${zivil.id}/fall`, { streitwert: 1 })).status, 200);
    const other = await anwalt.put(`/api/cases/${zivil.id}/fall`, { streitwert: 2 });
    assert.ok([403, 404].includes(other.status), `fremder Anwalt: ${other.status}`);
    const view = { order: ['subject', 'claims', 'corr', 'norms', 'clauses', 'versions', 'vclaims'], hidden: [], collapsed: [] };
    assert.equal((await anwalt.put('/api/prefs/case-sections', view)).status, 200);
  });
});

describe('Fall-Bausteine je Rechtsgebiet (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let zivil;
  let verf;
  let vertrag;
  let straf;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const adm = client(srv.base);
    await adm.login(TEAM.admin);
    const me = (await adm.get('/api/auth/session')).json.user;
    const mk = async (area, title) => (await adm.post('/api/cases', { title, area, clientName: 'Max Muster', lawyerId: me.id })).json.case;
    zivil = await mk('zivilrecht', 'Zivil-Akte');
    verf = await mk('verfassungsrecht', 'Verfassungs-Akte');
    vertrag = await mk('vertragsrecht', 'Vertrags-Akte');
    straf = await mk('strafrecht', 'Straf-Akte');
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  const open = async (viewport = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForSelector('#nav a.nav-item');
    return { ctx, page, problems };
  };
  const settled = (page) => page.waitForFunction(() => !document.documentElement.dataset.wch);
  const fallTab = async (page, c) => {
    await page.evaluate((id) => openCase(id), c.id);
    await page.waitForSelector('#modalBody .case-root');
    if (await page.isVisible('#modalBody [data-action="case-tab"][data-tab="fall"]')) await page.click('#modalBody [data-action="case-tab"][data-tab="fall"]');
    else await page.evaluate(() => caseTabSet('fall')); // Handy: die Reiter sind eine Auswahlliste
    await settled(page);
  };
  const sections = (page) => page.$$eval('#modalBody [data-pane="fall"] .section', (l) => l.map((e) => e.id));

  it('jedes Rechtsgebiet zeigt seine Abschnitte im Reiter „Fall“ in der gewünschten Reihenfolge; Strafrecht bleibt wie es war', async () => {
    const { ctx, page, problems } = await open();
    try {
      await fallTab(page, zivil);
      assert.deepEqual(await sections(page), ['secTathergang', 'secClaims', 'secMotions', 'secWitnesses', 'secEvidence', 'secCorr']);
      assert.match(await page.textContent('#secTathergang .section-title'), /Streitgegenstand \/ Sachverhalt/);
      assert.equal(await page.locator('#secKarte').count(), 0, 'Karte ist im Zivilrecht nur optional');
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      await fallTab(page, verf);
      assert.deepEqual(await sections(page), ['secSubject', 'secAdmiss', 'secNorms', 'secParticipants', 'secEvidence']);
      assert.equal(await page.locator('#secKarte, #secWitnesses, #secTathergang, #secCharges').count(), 0, 'Karte, Zeugen, Tathergang entfallen');
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      await fallTab(page, vertrag);
      assert.deepEqual(await sections(page), ['secSubject', 'secParties', 'secClauses', 'secTerm', 'secVersions', 'secEvidence']);
      assert.match(await page.textContent('#secEvidence .section-title'), /Anlagen/);
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
      await fallTab(page, straf);
      const s = await sections(page);
      assert.ok(s.includes('secTathergang') && s.includes('secCharges') && s.includes('secWitnesses') && s.includes('secKarte'), `Strafrecht: ${s}`);
      assert.ok(!s.includes('secClaims') && !s.includes('secNorms'));
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Zivilrecht: Anspruch und Streitwert über das Formular, Summe, Karte über „Mehr“; Entfernen', async () => {
    const { ctx, page, problems } = await open();
    try {
      await fallTab(page, zivil);
      await page.click('#secClaims [data-action="fall-add"], #secClaims button:has-text("Anspruch")');
      await page.fill('#modalBody input[name="basis"]', '§ 280 BGB – Schadensersatz');
      await page.fill('#modalBody input[name="claimant"]', 'Max Muster');
      await page.fill('#modalBody input[name="opponent"]', 'Bob Gegner');
      await page.fill('#modalBody input[name="amount"]', '12500');
      await page.selectOption('#modalBody select[name="status"]', 'bestritten');
      await page.click('#modalBody form[data-form="fall-save"] button[type=submit]');
      await page.waitForSelector('#secClaims .fall-card');
      assert.match(await page.textContent('#secClaims .fall-card'), /§ 280 BGB/);
      assert.match(await page.textContent('#secClaims .fall-card'), /Bestritten/);
      assert.match(await page.textContent('#secClaims .fall-sum'), /12\.500/);
      // Streitwert
      await page.click('#secClaims [data-action="fall-meta"]');
      await page.fill('#modalBody input[name="streitwert"]', '15000');
      await page.click('#modalBody form[data-form="fall-save"] button[type=submit]');
      await page.waitForFunction(() => /15\.000/.test(document.querySelector('#secClaims .fall-sum')?.textContent || ''));
      // Karte nur über „Mehr“
      assert.equal(await page.locator('#secKarte').count(), 0, 'Karte ist im Zivilrecht nur optional');
      await page.click('#modalBody [data-action="case-tab"][data-tab="ueberblick"]');
      await settled(page);
      await page.click('#modalBody .more-menu summary');
      assert.equal(await page.locator('#modalBody .more-item:has-text("Karte")').count(), 1);
      // Entfernen
      await page.click('#modalBody [data-action="case-tab"][data-tab="fall"]');
      await settled(page);
      await page.click('#secClaims [data-action="fall-del"]');
      await page.waitForFunction(() => !document.querySelector('#secClaims .fall-card'));
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Verfassungsrecht: Zulässigkeit per Klick, Norm mit Rechtfertigungsprüfung; Vertragsrecht: Modus-Schalter blendet die Ansprüche ein', async () => {
    const { ctx, page, problems } = await open();
    try {
      await fallTab(page, verf);
      await page.click('#secAdmiss [data-key="c_befugnis"][data-val="ja"]');
      await page.waitForFunction(() => document.querySelector('#secAdmiss [data-key="c_befugnis"][data-val="ja"]')?.classList.contains('on'));
      await page.click('#secAdmiss [data-key="c_frist"][data-val="nein"]');
      await page.waitForFunction(() => document.querySelector('#secAdmiss [data-key="c_frist"][data-val="nein"]')?.classList.contains('on'));
      assert.match(await page.textContent('#secAdmiss .sec-meta'), /1 von 4 erfüllt/);
      await page.click('#secNorms [data-action="fall-add"]');
      await page.fill('#modalBody input[name="norm"]', 'Art. 14 – Eigentum');
      await page.click('#modalBody label.st-ja:has(input[name="purpose"])');
      await page.click('#modalBody label.st-nein:has(input[name="necessary"])');
      await page.selectOption('#modalBody select[name="assessment"]', 'aussichtsreich');
      await page.click('#modalBody form[data-form="fall-save"] button[type=submit]');
      await page.waitForSelector('#secNorms .fall-card');
      assert.equal(await page.locator('#secNorms .fall-step.st-ja').count(), 1);
      assert.equal(await page.locator('#secNorms .fall-step.st-nein').count(), 1);
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));

      await fallTab(page, vertrag);
      assert.equal(await page.locator('#secVclaims').count(), 0);
      await page.click('#secSubject [data-key="mode"][data-val="streit"]');
      await page.waitForSelector('#secVclaims');
      await page.click('#secClauses [data-action="fall-add"]');
      await page.fill('#modalBody input[name="title"]', 'Haftung begrenzt');
      await page.selectOption('#modalBody select[name="risk"]', 'rot');
      await page.click('#modalBody form[data-form="fall-save"] button[type=submit]');
      await page.waitForSelector('#secClauses .fall-light.l-rot');
      await page.click('#secVersions [data-action="fall-add"]');
      await page.fill('#modalBody textarea[name="note"]', 'Erster Entwurf');
      await page.click('#modalBody form[data-form="fall-save"] button[type=submit]');
      await page.waitForSelector('#secVersions .fall-no');
      assert.equal((await page.textContent('#secVersions .fall-no')).trim(), 'v1');
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Handy: die Bausteine passen in die Breite', async () => {
    const { ctx, page, problems } = await open({ width: 390, height: 844 });
    try {
      await fallTab(page, verf);
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => {
        const root = document.querySelector('#modalBody');
        return [...root.querySelectorAll('.fall-sec *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className).slice(0, 5);
      });
      assert.deepEqual(over, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, true);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });
});
