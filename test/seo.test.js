'use strict';
/*
 * Auffindbarkeit und Warteseite: robots.txt, sitemap.xml, „nicht indexieren“ für Internes, kanonische Adresse und
 * Schema.org auf der Startseite – und die ruhige Warteseite, wenn der Server nach einer Ruhepause erst aufwacht.
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

describe('Auffindbarkeit (API)', () => {
  let srv;
  let owner;
  let anon;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    anon = client(srv.base);
    await owner.login(TEAM.admin);
  });
  after(() => srv.stop());

  it('robots.txt: Internes gesperrt, Verweis auf die Sitemap', async () => {
    const r = await anon.get('/robots.txt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    for (const p of ['/api/', '/dashboard', '/login', '/vertrag', '/rechnung']) assert.match(r.text, new RegExp(`Disallow: ${p}`), p);
    assert.match(r.text, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  });

  it('sitemap.xml: Startseite, Karriere und Anwaltsprofile – Karriere nur, solange eingeschaltet', async () => {
    const r = await anon.get('/sitemap.xml');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /xml/);
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    assert.ok(locs.includes('/') && locs.includes('/karriere'), locs.join());
    assert.ok(locs.some((p) => p.startsWith('/team/')), 'sichtbare Anwälte haben ein Profil');
    assert.ok(!locs.some((p) => /dashboard|login|api/.test(p)));
    await owner.put('/api/access/features', { karriere: false });
    const off = await anon.get('/sitemap.xml');
    assert.ok(!off.text.includes('/karriere'), 'Karriere ausgeschaltet');
    await owner.put('/api/access/features', { karriere: true });
  });

  it('Internes trägt „noindex“, öffentliche Seiten nicht', async () => {
    for (const p of ['/dashboard', '/login', '/registrieren', '/api/health', '/vertrag', '/aufwachen']) {
      const r = await anon.get(p, { Accept: 'text/html' });
      assert.match(r.headers.get('x-robots-tag') || '', /noindex/, p);
    }
    for (const p of ['/', '/karriere']) assert.equal((await anon.get(p, { Accept: 'text/html' })).headers.get('x-robots-tag'), null, p);
  });

  it('Startseite: kanonische Adresse, og:url, Schema.org LegalService; Karriere kanonisch; twitter:card nur einmal', async () => {
    const home = (await anon.get('/', { Accept: 'text/html' })).text;
    assert.match(home, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/">/);
    assert.match(home, /<meta property="og:url" content="http:\/\/127\.0\.0\.1:\d+\/">/);
    assert.equal((home.match(/name="twitter:card"/g) || []).length, 1);
    const ld = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@type'], 'LegalService');
    assert.equal(ld.name, 'Pake & Scha Legal Consulting');
    assert.ok(ld.knowsAbout.includes('Strafrecht'));
    assert.match(ld.logo, /^http:\/\/127\.0\.0\.1:\d+\/img\/logo\.png$/);
    const career = (await anon.get('/karriere', { Accept: 'text/html' })).text;
    assert.match(career, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/karriere">/);
    assert.doesNotMatch(career, /application\/ld\+json/);
  });

  it('Warteseite und Service Worker', async () => {
    const wake = await anon.get('/aufwachen', { Accept: 'text/html' });
    assert.equal(wake.status, 200);
    assert.match(wake.text, /wacht gerade auf/);
    const script = wake.text.match(/<script src="([^"]+)"/)[1];
    assert.match(script, /^\/js\/aufwachen\.js\?v=/);
    assert.match((await anon.get(script)).text, /api\/health/);
    const sw = (await anon.get('/sw.js')).text;
    assert.match(sw, /WAKE_URL/);
    assert.match(sw, /ps-offline-v4/);
  });
});

describe('Warteseite beim Aufwachen (Browser)', { skip: chromium ? false : 'Playwright nicht installiert' }, () => {
  let srv;
  let browser;
  let proxy;
  let slow = false;
  let base;
  before(async () => {
    srv = await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    // Kleiner Vermittler vor dem Server: Seitenaufrufe lassen sich künstlich verzögern („Server schläft noch“)
    const http = require('node:http');
    const target = new URL(srv.base);
    proxy = http.createServer((req, res) => {
      const go = () => {
        const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        });
        up.on('error', () => res.destroy());
        req.pipe(up);
      };
      if (slow && req.url === '/login' && /text\/html/.test(req.headers.accept || '')) setTimeout(go, 8000);
      else go();
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${proxy.address().port}`;
  });
  after(async () => {
    if (browser) await browser.close();
    if (proxy) proxy.close();
    if (srv) await srv.stop();
  });

  it('antwortet der Server nach 5 Sekunden noch nicht, erscheint die Warteseite – danach lädt die Seite von selbst', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    await page.goto(`${base}/login`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    slow = true;
    const nav = page.goto(`${base}/login`, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => /wacht gerade auf/.test(document.body.innerText), null, { timeout: 15000 });
    assert.equal(new URL(page.url()).pathname, '/login', 'die Adresse bleibt, damit nach dem Aufwachen dieselbe Seite lädt');
    slow = false;
    await page.waitForSelector('#email', { timeout: 25000 });
    await nav;
    await ctx.close();
  });
});
