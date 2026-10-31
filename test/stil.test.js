'use strict';
/*
 * Stil & Saison, Rabattaktionen, Aktenzeichen-Muster und das neue Banner:
 *  - Rabattaktionen für alle: Zeiträume (auch jährlich, Ostern/Black Friday), automatisch auf Rechnungen, im Banner
 *  - Aktenzeichen nach eigenem Muster ({BEREICH}-{NR}/{JJ} …) mit Vorschau
 *  - Stil (Akzentfarbe, Glas, Rundung, Schrift, Bewegung) und Saison-Deko werden beim Ausliefern eingesetzt
 *  - Browser: Aktionsbanner mit Countdown, Tarifrechner, Stil-Vorschau im Dashboard, Saison-Deko, Beweisbild-Vorschau
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, TEAM, PASSWORD } = require('./helpers');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* optional */
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const plus = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

describe('Rabattaktionen: Zeiträume und Saison (ohne Server)', () => {
  let srv;
  let promotions;
  before(async () => {
    srv = await startServer(); // Datenbank anlegen
    promotions = require('../promotions');
  });
  after(async () => srv && srv.stop());

  it('jährliche Zeiträume, auch über den Jahreswechsel; Ostern und Black Friday rechnen selbst', () => {
    const silvester = { yearly: 1, occasion: 'silvester', starts_on: '2026-12-29', ends_on: '2027-01-02', active: 1 };
    assert.deepEqual(promotions.runningOn(silvester, '2027-01-01'), ['2026-12-29', '2027-01-02']);
    assert.deepEqual(promotions.runningOn(silvester, '2030-12-30'), ['2030-12-29', '2031-01-02']);
    assert.equal(promotions.runningOn(silvester, '2027-01-03'), null);
    assert.equal(promotions.easter(2026), '2026-04-05');
    assert.equal(promotions.easter(2027), '2027-03-28');
    assert.equal(promotions.blackFriday(2026), '2026-11-27');
    assert.deepEqual(promotions.windowIn({ yearly: 1, occasion: 'ostern', starts_on: '2026-01-01', ends_on: '2026-01-01' }, 2026), ['2026-04-03', '2026-04-06']);
    assert.deepEqual(promotions.windowIn({ yearly: 1, occasion: 'blackfriday', starts_on: '2026-01-01', ends_on: '2026-01-01' }, 2026), ['2026-11-27', '2026-11-30']);
    const once = { yearly: 0, occasion: 'eigen', starts_on: '2026-05-01', ends_on: '2026-05-03', active: 1 };
    assert.ok(promotions.runningOn(once, '2026-05-02'));
    assert.equal(promotions.runningOn(once, '2027-05-02'), null, 'einmalig: nicht im nächsten Jahr');
  });

  it('Saison „auto“ folgt dem Kalender; fest eingestellt oder aus', () => {
    assert.equal(promotions.season('auto', '2031-10-25'), 'halloween');
    assert.equal(promotions.season('auto', '2031-12-10'), 'weihnachten');
    assert.equal(promotions.season('auto', '2031-12-31'), 'silvester');
    assert.equal(promotions.season('auto', '2032-01-02'), 'silvester');
    assert.equal(promotions.season('auto', '2031-02-14'), 'valentin');
    assert.equal(promotions.season('auto', '2031-04-12'), 'ostern'); // Ostersonntag 2031: 13.04.
    assert.equal(promotions.season('auto', '2031-06-15'), '');
    assert.equal(promotions.season('sommer', '2031-01-15'), 'sommer');
    assert.equal(promotions.season('aus', '2031-12-24'), '');
  });

  it('Berliner Tagesende für den Countdown (Sommer- und Winterzeit)', () => {
    assert.equal(promotions.berlinEndOfDay('2026-07-01'), '2026-07-01T21:59:59.000Z');
    assert.equal(promotions.berlinEndOfDay('2026-12-01'), '2026-12-01T22:59:59.000Z');
  });
});

describe('Rabattaktionen, Aktenzeichen und Stil (API)', () => {
  let srv;
  let owner;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    await owner.login(TEAM.admin);
  });
  after(async () => srv && srv.stop());

  it('Aktion anlegen: läuft heute, zieht auf jeder neuen Rechnung ab (abwählbar), steht im Protokoll', async () => {
    const day = today();
    const bad = await owner.post('/api/promotions', { name: 'X', pct: 0, occasion: 'eigen', startsOn: day, endsOn: day });
    assert.equal(bad.status, 400);
    const wrong = await owner.post('/api/promotions', { name: 'Rückwärts', pct: 10, occasion: 'eigen', startsOn: plus(day, 3), endsOn: day });
    assert.equal(wrong.status, 400, 'Ende vor Start');
    const r = await owner.post('/api/promotions', { name: 'Herbst-Aktion', pct: 15, occasion: 'halloween', startsOn: day, endsOn: plus(day, 3), announce: true });
    assert.equal(r.status, 201);
    assert.equal(r.json.current.name, 'Herbst-Aktion');
    assert.equal(r.json.promotions[0].running, true);
    // eine schwächere Aktion zur selben Zeit: es gilt die höhere
    await owner.post('/api/promotions', { name: 'Klein', pct: 5, occasion: 'eigen', startsOn: day, endsOn: day });
    assert.equal((await owner.get('/api/promotions')).json.current.pct, 15);

    const inv = await owner.post('/api/invoices', { clientName: 'Paula Preis', items: [{ description: 'Beratung', quantity: 2, unitPrice: 500 }], discountPct: 10 });
    assert.equal(inv.status, 201);
    assert.equal(inv.json.invoice.subtotal, 1000);
    assert.equal(inv.json.invoice.promoAmount, 150);
    assert.equal(inv.json.invoice.promoName, 'Herbst-Aktion');
    assert.equal(inv.json.invoice.discountAmount, 100);
    assert.equal(inv.json.invoice.total, 750);
    const without = await owner.post('/api/invoices', { clientName: 'Paula Preis', items: [{ description: 'Beratung', quantity: 1, unitPrice: 1000 }], promo: false });
    assert.equal(without.json.invoice.promoAmount, 0);
    assert.equal(without.json.invoice.total, 1000);

    const log = (await owner.get('/api/access/log')).json;
    assert.ok(JSON.stringify(log).includes('Rabattaktion „Herbst-Aktion“ angelegt'), 'im Änderungsprotokoll');
  });

  it('Website und Dashboard bekommen die Aktion samt Aktionsbanner (mit Countdown bis Tagesende)', async () => {
    const guest = client(srv.base);
    const s = (await guest.get('/api/auth/session')).json.siteConfig;
    assert.equal(s.promo.name, 'Herbst-Aktion');
    assert.equal(s.promo.icon, '🎃');
    assert.equal(s.promoBanner.promo, true);
    assert.equal(s.promoBanner.pct, 15);
    assert.equal(s.promoBanner.link, '/#rechner');
    assert.ok(Date.parse(s.promoBanner.endsAt) > Date.now());
    const me = (await owner.get('/api/auth/me')).json.siteConfig;
    assert.equal(me.promoBanner.link, '', 'die Kanzlei braucht keinen Rechner-Link');
  });

  it('Aktion pausieren und löschen: danach keine Aktion mehr', async () => {
    const list = (await owner.get('/api/promotions')).json.promotions;
    for (const p of list) {
      const body = { name: p.name, pct: p.pct, occasion: p.occasion, startsOn: p.startsOn, endsOn: p.endsOn, yearly: p.yearly, announce: p.announce, message: p.message, active: false };
      assert.equal((await owner.put(`/api/promotions/${p.id}`, body)).status, 200);
    }
    assert.equal((await owner.get('/api/promotions')).json.current, null);
    for (const p of list) assert.equal((await owner.del(`/api/promotions/${p.id}`)).status, 200);
    assert.equal((await owner.get('/api/promotions')).json.promotions.length, 0);
    assert.equal((await client(srv.base).get('/api/auth/session')).json.siteConfig.promoBanner, null);
  });

  it('Mitarbeiter ohne Recht dürfen Aktionen nur ansehen, Mandanten gar nicht', async () => {
    const staff = client(srv.base);
    await staff.login(TEAM.anwalt);
    assert.equal((await staff.get('/api/promotions')).status, 200);
    assert.equal((await staff.post('/api/promotions', { name: 'Heimlich', pct: 50, occasion: 'eigen', startsOn: today(), endsOn: today() })).status, 403);
  });

  it('Aktenzeichen nach eigenem Muster: je Rechtsgebiet und Jahr fortlaufend, Vorschau, ungültige Muster abgelehnt', async () => {
    assert.equal((await owner.get('/api/config/numbering/preview?pattern=OHNE-NUMMER&digits=4')).status, 400);
    assert.equal((await owner.get(`/api/config/numbering/preview?pattern=${encodeURIComponent('<b>{NR}')}&digits=4`)).status, 400);
    const pv = await owner.get(`/api/config/numbering/preview?pattern=${encodeURIComponent('{BEREICH}-{NR}/{JJ}')}&digits=3`);
    assert.equal(pv.status, 200);
    assert.match(pv.json.next, /^[A-Z]{2,}-001\/\d\d$/);
    assert.equal((await owner.put('/api/config/numbering/draft', { pattern: '{BEREICH}-{NR}/{JJ}', digits: 3 })).status, 200);
    assert.equal((await owner.post('/api/config/numbering/publish', {})).status, 200);
    const yy = String(new Date().getFullYear()).slice(2);
    const a = (await owner.post('/api/cases', { title: 'Raub', area: 'strafrecht', clientName: 'Max Muster' })).json.case;
    const b = (await owner.post('/api/cases', { title: 'Raub 2', area: 'strafrecht', clientName: 'Max Muster' })).json.case;
    const c = (await owner.post('/api/cases', { title: 'Vertrag', area: 'zivilrecht', clientName: 'Max Muster' })).json.case;
    assert.equal(a.caseNumber, `STR-001/${yy}`);
    assert.equal(b.caseNumber, `STR-002/${yy}`);
    assert.equal(c.caseNumber, `ZIV-001/${yy}`);
    // Kürzel der Federführung
    await owner.put('/api/config/numbering/draft', { pattern: 'PS/{KUERZEL}/{NR}', digits: 2 });
    await owner.post('/api/config/numbering/publish', {});
    const d = (await owner.post('/api/cases', { title: 'Kürzel', area: 'strafrecht', clientName: 'Max Muster' })).json.case;
    assert.match(d.caseNumber, /^PS\/[A-Z]{1,3}\/01$/);
    // zurück zum Standard: zählt wie bisher weiter
    await owner.put('/api/config/numbering/draft', { pattern: 'PS-{JJJJ}-{NR}', digits: 4 });
    await owner.post('/api/config/numbering/publish', {});
    const e = (await owner.post('/api/cases', { title: 'Standard', area: 'strafrecht', clientName: 'Max Muster' })).json.case;
    assert.match(e.caseNumber, /^PS-\d{4}-\d{4}$/);
  });

  it('Stil und Saison stecken schon im ausgelieferten HTML (Website, Dashboard, Anmeldung)', async () => {
    const page = async (p) => (await fetch(`${srv.base}${p}`)).text();
    let html = await page('/');
    assert.ok(!html.includes('id="psTheme"'), 'Standardstil: kein Zusatz-CSS');
    assert.match(html, /<script src="\/js\/season\.js\?v=\w+" defer><\/script>/);
    const style = { preset: 'eigen', accent: '#34d399', glass: 80, radius: 20, font: 'modern', motion: 'ruhig', season: 'weihnachten', seasonDash: false };
    assert.equal((await owner.put('/api/config/style/draft', style)).status, 200);
    assert.equal((await owner.post('/api/config/style/publish', {})).status, 200);
    html = await page('/');
    assert.match(html, /<style id="psTheme">:root:root \{ --gold-500: #34d399;/);
    assert.match(html, /--accent-rgb: 52, 211, 153;/);
    assert.match(html, /--radius: 10px;/);
    assert.match(html, /<html data-season="weihnachten" data-site-motion="ruhig" data-font="modern"/);
    assert.match(html, /<link rel="stylesheet" href="\/css\/calm\.css\?v=\w+" media="all" data-calm>/, 'ruhig: gedämpft für alle');
    const dash = await page('/dashboard');
    assert.match(dash, /id="psTheme"/);
    assert.doesNotMatch(dash, /data-season=/, 'Deko nur auf der Website, wenn „auch im Dashboard“ aus ist');
    assert.match(await page('/login'), /data-season="weihnachten"/);
    assert.doesNotMatch(await page('/rechnung'), /data-season=/, 'Dokumente bleiben schlicht');
    const s = (await client(srv.base).get('/api/auth/session')).json.siteConfig;
    assert.equal(s.style.accent, '#34d399');
    assert.equal(s.season, 'weihnachten');
    // ungültige Farbe abgelehnt, Zurücksetzen auf Standard
    assert.equal((await owner.put('/api/config/style/draft', { ...style, accent: 'gold' })).status, 400);
    await owner.put('/api/config/style/draft', { preset: 'gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'aus', seasonDash: true });
    await owner.post('/api/config/style/publish', {});
    html = await page('/');
    assert.ok(!html.includes('id="psTheme"'));
    assert.doesNotMatch(html, /data-season=/);
  });

  it('Kanzleifarbe überall: Logo (SVG und PNG), Browserleiste, Discord-Farbe, Word-Farbe', async () => {
    const brand = require('../brand');
    const svg0 = await (await fetch(`${srv.base}/img/logo.svg`)).text();
    assert.match(svg0, /stroke="#caa32f"/, 'Standard: Originalfarbe');
    const png0 = Buffer.from(await (await fetch(`${srv.base}/img/logo.png`)).arrayBuffer());
    await owner.put('/api/config/style/draft', { preset: 'eigen', accent: '#34d399', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'aus', seasonDash: true });
    await owner.post('/api/config/style/publish', {});
    const svg = await (await fetch(`${srv.base}/img/logo.svg`)).text();
    assert.doesNotMatch(svg, /#caa32f/);
    assert.match(svg, /stroke="#31c891"/, 'Logo in der Akzentfarbe');
    const res = await fetch(`${srv.base}/img/logo.png`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.notDeepEqual(png, png0);
    assert.equal(png.readUInt32BE(16), png0.readUInt32BE(16), 'gleiche Größe');
    const etag = res.headers.get('etag');
    assert.equal((await fetch(`${srv.base}/img/logo.png`, { headers: { 'If-None-Match': etag } })).status, 304);
    assert.match(await (await fetch(`${srv.base}/`)).text(), /<meta name="theme-color" content="#2db584">/);
    // Discord: Gold wird zur Kanzleifarbe, andere Farben bleiben (der Server läuft in einem eigenen Prozess – Farbe hier übergeben)
    const out = require('../discord').brandColors({ embeds: [{ color: 0xd4af37 }, { color: 0xef4444 }] }, { isDefault: false, int: 0x34d399 });
    assert.deepEqual(out.embeds.map((e) => e.color), [0x34d399, 0xef4444]);
    assert.equal(brand.docx('#2db584'), '2DB584');
    await owner.put('/api/config/style/draft', { preset: 'gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'aus', seasonDash: true });
    await owner.post('/api/config/style/publish', {});
    assert.match(await (await fetch(`${srv.base}/img/logo.svg`)).text(), /#caa32f/);
    assert.deepEqual(require('../discord').brandColors({ embeds: [{ color: 0xd4af37 }] }, { isDefault: true }).embeds[0].color, 0xd4af37);
  });

  it('Banner: Symbol und Countdown bis Tagesende', async () => {
    const day = plus(today(), 2);
    await owner.put('/api/config/banner/draft', { enabled: true, text: 'Wartung am Wochenende', tone: 'night', icon: '⚖️', countdown: true, link: '', linkLabel: '', from: '', to: day, audience: ['public', 'mandant', 'staff'], dismissible: true });
    await owner.post('/api/config/banner/publish', {});
    const b = (await client(srv.base).get('/api/auth/session')).json.siteConfig.banner;
    assert.equal(b.icon, '⚖️');
    assert.equal(b.tone, 'night');
    assert.ok(b.endsAt && b.endsAt.startsWith(day) || Date.parse(b.endsAt) > Date.parse(`${day}T20:00:00Z`));
  });
});

describe('Akzentfarbe als Variablen (statisch)', () => {
  const css = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'css', f), 'utf8');
  it('kein festes Gold mehr in den Stylesheets – alles über --gold-500 / --accent-rgb', () => {
    for (const f of ['app.css', 'controls.css', 'depth.css', 'motion.css', 'select.css', 'tailwind.css']) {
      const s = css(f);
      assert.doesNotMatch(s, /rgba\(\s*212\s*,\s*175\s*,\s*55\s*,/, `${f}: rgba(212, 175, 55 …)`);
      const hard = (s.match(/(?<![\\\w-]|--gold-500:\s*|--gold-500,\s*)#d4af37\b/gi) || []).length;
      assert.equal(hard, 0, `${f}: #d4af37 fest eingetragen`);
    }
    assert.match(css('fonts.css'), /--accent-rgb: 212, 175, 55;/, 'Standardwerte für alle Seiten');
    const { accentize } = require('../scripts/accent');
    const once = accentize(css('app.css'));
    assert.equal(accentize(once), once, 'mehrfach anwendbar ohne Änderung');
  });
});

describe('Stil, Saison und Aktionen im Browser', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let owner;
  let caseId;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    owner = client(srv.base);
    await owner.login(TEAM.admin);
    await owner.post('/api/promotions', { name: 'Gruselwoche', pct: 20, occasion: 'halloween', startsOn: today(), endsOn: plus(today(), 2), announce: true });
    caseId = (await owner.post('/api/cases', { title: 'Beweise', area: 'strafrecht', clientName: 'Max Muster' })).json.case.id;
    for (const c of ['Tatort', 'Fluchtwagen']) await owner.upload(`/api/cases/${caseId}/attachments?caption=${c}`, PNG, 'image/png');
  });
  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.stop();
  });

  const login = async (page) => {
    await page.goto(`${srv.base}/login`);
    await page.fill('#email', TEAM.admin);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/dashboard/);
    await page.waitForFunction(() => st.user && st.user.id && !st.histPaused && document.querySelector('#content')?.children.length > 0 && !document.querySelector('#content .skeleton'));
  };

  for (const [name, device] of [
    ['PC', { viewport: { width: 1366, height: 860 } }],
    ['Handy', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    it(`${name}: Aktionsbanner mit Plakette und laufendem Countdown, Aktion im Tarifrechner, kein Überlauf`, async () => {
      const ctx = await browser.newContext({ ...device, locale: 'de-DE' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      try {
        await page.goto(`${srv.base}/`);
        await page.waitForSelector('#promoBanner .sb-count b');
        assert.match(await page.textContent('#promoBanner .sb-pct'), /−20\s%/);
        assert.ok(await page.$('#promoBanner.occ-halloween'), 'Farben des Anlasses');
        const first = await page.textContent('#promoBanner .sb-count');
        await page.waitForFunction((t) => document.querySelector('#promoBanner .sb-count').textContent !== t, first, { timeout: 4000 });
        // Tarifrechner: drei Leistungen → Bündelrabatt und Aktion
        await page.evaluate(() => {
          document.querySelectorAll('.calc-check:not(#priorityAddon)').forEach((c, i) => (c.checked = i < 3));
          calculateTotal();
        });
        await page.waitForSelector('#promoRow:not(.hidden)');
        assert.match(await page.textContent('#promoLabel'), /Gruselwoche \(20 %\)/);
        assert.ok(await page.$('#calcPromoBadge'), 'Plakette am Rechner');
        const sum = await page.evaluate(() => [...document.querySelectorAll('.calc-check:checked:not(#priorityAddon)')].reduce((s, c) => s + Number(c.value), 0));
        await page.waitForFunction((v) => document.getElementById('totalAmount').textContent.replace(/\D/g, '') === String(v), Math.round(sum - Math.round(sum * 0.1) - Math.round(sum * 0.2)), { timeout: 4000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'kein seitlicher Überlauf');
        // Aktion geht mit: weggescrollt → schwebende Leiste unten, wieder oben → weg
        assert.match(await page.textContent('#promoBanner .sb-title'), /Gruselwoche/);
        await page.evaluate(() => window.scrollTo(0, 1800));
        await page.waitForSelector('#promoBannerDock.is-on', { timeout: 5000 });
        const dock = await page.evaluate(() => {
          const r = document.getElementById('promoBannerDock').getBoundingClientRect();
          return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight, x: !!document.querySelector('#promoBannerDock .pd-x') && document.querySelector('#promoBannerDock .pd-x').getBoundingClientRect().right <= innerWidth };
        });
        assert.ok(dock.inside && dock.x, 'Leiste ganz im Bild, Schließen erreichbar');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForSelector('#promoBannerDock:not(.is-on)', { state: 'attached', timeout: 5000 });
        // Schrift der Überschriften: Elegant = Schmuckschrift kursiv, Modern = Inter
        const fonts = await page.evaluate(() => {
          const h = document.querySelector('h1.font-serif, h2.font-serif, .font-serif');
          const read = (f) => {
            document.documentElement.dataset.font = f;
            const cs = getComputedStyle(h);
            return `${cs.fontStyle}|${cs.fontFamily}`;
          };
          const out = { elegant: read('elegant'), modern: read('modern') };
          delete document.documentElement.dataset.font;
          return out;
        });
        assert.match(fonts.elegant, /^italic\|.*Cormorant/);
        assert.match(fonts.modern, /^normal\|.*Inter/);
        // Banner wegklicken: bleibt weg
        await page.click('#promoBanner .site-banner-x');
        await page.waitForFunction(() => !document.getElementById('promoBanner'));
        await page.reload();
        await page.waitForTimeout(800);
        assert.equal(await page.$('#promoBanner'), null);
        assert.deepEqual(problems, []);
      } finally {
        await ctx.close();
      }
    });
  }

  it('PC: Stil-Vorlage färbt das Dashboard sofort, Veröffentlichen gilt für die Website; Saison zum Ansehen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.href = '/dashboard?tab=texte#settings'));
      await page.waitForSelector('[data-action="cfg-tab"][data-tab="style"]', { timeout: 15000 });
      await page.click('[data-action="cfg-tab"][data-tab="style"]');
      await page.waitForSelector('form[data-form="cfg-style"]');
      await page.click('[data-action="style-preset"][data-preset="smaragd"]');
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gold-500').trim() === '#34d399');
      assert.equal(await page.inputValue('#stAccent'), '#34d399');
      // Regler: Zahl daneben läuft mit
      await page.fill('#stRadius', '80').catch(() => {});
      await page.evaluate(() => {
        const r = document.getElementById('stRadius');
        r.value = '80';
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await page.textContent('.range-val[data-for="stRadius"]'), '80');
      // Saison ansehen
      await page.click('[data-action="season-try"][data-season="weihnachten"]');
      await page.waitForFunction(() => document.documentElement.dataset.season === 'weihnachten' && document.querySelector('.topbar .ps-lights .bulb') && document.querySelector('.ps-scene.is-dash .ps-fx'));
      // Anderer Bereich: Vorschau endet, Stil wie veröffentlicht
      await page.click('[data-action="cfg-tab"][data-tab="banner"]');
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gold-500').trim() !== '#34d399');
      // Wieder hin, veröffentlichen
      await page.click('[data-action="cfg-tab"][data-tab="style"]');
      await page.click('[data-action="style-preset"][data-preset="smaragd"]');
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/config/style/publish') && r.ok()), page.click('[data-action="cfg-publish"][data-key="style"]')]);
      const site = await ctx.newPage();
      await site.goto(`${srv.base}/`);
      assert.equal(await site.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gold-500').trim()), '#34d399');
      assert.equal(await site.evaluate(() => getComputedStyle(document.querySelector('.btn-gold')).backgroundImage.includes('52, 211, 153') || getComputedStyle(document.querySelector('.btn-gold')).backgroundImage.includes('oklab')), true, 'Knöpfe in der neuen Farbe');
      assert.deepEqual(problems, []);
    } finally {
      await owner.put('/api/config/style/draft', { preset: 'gold', accent: '#d4af37', glass: 50, radius: 50, font: 'klassisch', motion: 'normal', season: 'auto', seasonDash: true });
      await owner.post('/api/config/style/publish', {});
      await ctx.close();
    }
  });

  it('PC: Rabattaktion im Dashboard anlegen (Anlass füllt Name und Zeitraum), Rechnung zieht sie ab', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.evaluate(() => (location.href = '/dashboard?tab=texte#settings'));
      await page.waitForSelector('[data-action="cfg-tab"][data-tab="promos"]', { timeout: 15000 });
      await page.click('[data-action="cfg-tab"][data-tab="promos"]');
      await page.waitForSelector('.promo-card.is-running');
      await page.click('.panel-head [data-action="promo-new"]');
      await page.waitForSelector('form[data-form="promo-save"]');
      await page.click('.occ-opt:has(input[value="weihnachten"])');
      await page.waitForFunction(() => document.querySelector('#prName').value === 'Weihnachten-Aktion' && /-12-/.test(document.querySelector('#prFrom').value));
      assert.equal(await page.evaluate(() => document.querySelectorAll('.occ-opt:has(input:checked)').length), 1, 'genau ein Anlass gewählt');
      await page.waitForSelector('#promoPreviewBanner.occ-weihnachten .sb-pct');
      await page.fill('#prPct', '25');
      await page.click('form[data-form="promo-save"] button[type=submit]');
      await page.waitForFunction(() => document.querySelectorAll('.promo-card').length === 2);
      assert.match(await page.textContent('.promo-list'), /Weihnachten-Aktion/);
      // Rechnungsformular: laufende Aktion wird angezeigt und abgezogen
      await page.evaluate(() => (location.hash = '#invoices'));
      await page.waitForSelector('[data-action="new-invoice"], [data-action="inv-new"]', { timeout: 10000 }).catch(() => {});
      const shown = await page.evaluate(() => typeof draftTotals === 'function' && draftTotals({ items: [{ quantity: 1, unitPrice: 1000 }], discountPct: 0, surchargePct: 0, promo: true }).promo);
      assert.equal(shown, 200, 'Formular rechnet die Aktion ein');
      assert.match(await page.evaluate(() => promoBoxHtml({ promo: true })), /Gruselwoche/);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Großer Bildschirm: Beweisbild-Vorschau wächst aus dem Vorschaubild, Zähler steht in einer Zeile', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      await login(page);
      await page.waitForTimeout(600);
      for (let versuch = 0; versuch < 3; versuch++) {
        await page.evaluate((i) => openCase(i), caseId);
        if (await page.waitForSelector('.att[data-index="1"]', { timeout: 8000 }).then(() => true, () => false)) break;
      }
      await page.click('.att[data-index="1"]');
      await page.waitForSelector('#docPeek .dp-count');
      const box = await page.evaluate(() => {
        const c = document.querySelector('#docPeek .dp-count').getBoundingClientRect();
        const nav = document.querySelector('#docPeek .dp-nav').getBoundingClientRect();
        return { h: c.height, text: document.querySelector('#docPeek .dp-count').textContent, navH: nav.height };
      });
      assert.equal(box.text, '2 / 2');
      assert.ok(box.h < 26, `Zähler einzeilig (${box.h}px)`);
      assert.ok(box.navH < 44, `Leiste einzeilig (${box.navH}px)`);
      await page.click('#docPeek [data-action="peek-step"][data-dir="-1"]');
      await page.waitForFunction(() => document.querySelector('#docPeek .dp-count')?.textContent === '1 / 2');
      await page.click('#docPeek [data-action="peek-close"]');
      await page.waitForFunction(() => !document.getElementById('docPeek'));
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Saison-Szenen: alle acht liegen hinter dem Inhalt, Felder bleiben klickbar und lesbar', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && /Saison/.test(m.text()) && problems.push(m.text()));
    try {
      await page.goto(`${srv.base}/`);
      await page.waitForFunction(() => window.PS && window.PS.season);
      for (const name of ['halloween', 'weihnachten', 'silvester', 'valentin', 'ostern', 'sommer', 'blackfriday', 'jubilaeum']) {
        await page.evaluate((n) => PS.season.set(n), name);
        await page.waitForSelector(`.ps-scene-${name} .ps-fx`);
        await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
          const scene = document.querySelector('.ps-scene');
          const cs = getComputedStyle(scene);
          // gezeichnet? (Landschaft hat Pixel)
          const c = scene.querySelector('.ps-scenery');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) painted++;
          // was liegt ganz oben in der Mitte des ersten Knopfes?
          const btn = [...document.querySelectorAll('main a, main button')].find((x) => {
            const q = x.getBoundingClientRect();
            return q.width > 20 && q.top > 80 && q.bottom < innerHeight - 20;
          });
          const b = btn.getBoundingClientRect();
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          const fx = scene.querySelector('.ps-fx');
          return { z: cs.zIndex, pos: cs.position, events: cs.pointerEvents, painted, hit: !!top && !top.closest('.ps-season'), scenes: document.querySelectorAll('.ps-scene').length, fxW: fx.width, w: innerWidth };
        });
        assert.equal(r.z, '-1', `${name}: hinter allem`);
        assert.equal(r.pos, 'fixed', `${name}: fest`);
        assert.equal(r.events, 'none', `${name}: nicht klickbar`);
        assert.ok(r.painted > 20, `${name}: Landschaft gezeichnet`);
        assert.ok(r.hit, `${name}: Knopf liegt über der Szene`);
        assert.equal(r.scenes, 1, `${name}: genau eine Szene`);
        assert.equal(r.fxW, r.w, `${name}: Bewegungsebene in einfacher Auflösung (schont schwache Geräte)`);
      }
      await page.evaluate(() => PS.season.set('none'));
      assert.equal(await page.$('.ps-season'), null, 'aus');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-season')), false);
      assert.deepEqual(problems, []);
    } finally {
      await ctx.close();
    }
  });

  it('Bewegung reduzieren: Saison-Deko ohne Teilchen, eigene Abschaltung je Gerät', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'de-DE', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    try {
      await page.goto(`${srv.base}/`);
      await page.waitForFunction(() => window.PS && window.PS.season);
      await page.evaluate(() => PS.season.set('weihnachten'));
      await page.waitForSelector('.ps-scene-weihnachten .ps-scenery');
      assert.equal(await page.$('.ps-scene .ps-fx'), null, 'keine Teilchen, nur das stehende Bild');
      await page.evaluate(() => PS.season.off(true));
      assert.equal(await page.$('.ps-scene'), null, 'abgeschaltet');
      assert.equal(await page.$('.ps-lights'), null, 'Lichterkette weg');
      await page.reload();
      await page.evaluate(() => PS.season.set('halloween'));
      assert.equal(await page.$('.ps-season'), null, 'bleibt aus (gemerkt)');
    } finally {
      await ctx.close();
    }
  });
});
