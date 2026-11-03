'use strict';
/*
 * Design-Paket: Banner als Siegel-Leiste (Titel, Aufmachung, mehrere Meldungen im Wechsel), goldener Navi-Strich auf
 * Startseite und Karriere, kein „E-Mail kopieren“-Knopf mehr, schwebende Beschriftungen, Geldfelder mit
 * Tausenderpunkten (Absenden liefert reine Ziffern), Rechtsklick-Menü auf Aktenzeilen.
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

const BANNER = { enabled: true, title: 'Notdienst am Wochenende', text: 'Nur über den Eilnotdienst erreichbar.', tone: 'gold', style: 'hinweis', icon: '', countdown: false, link: '', linkLabel: '', from: '', to: '', audience: ['public', 'mandant', 'staff'], dismissible: true, slides: [{ title: 'Wir stellen ein', text: 'Junior Associates gesucht.', icon: '⚖️', link: '/karriere', linkLabel: 'Zu den Stellen' }] };

describe('Design-Paket', () => {
  let srv;
  let owner;
  before(async () => {
    srv = await startServer();
    owner = client(srv.base);
    await owner.login(TEAM.admin);
  });
  after(async () => {
    if (srv) await srv.stop();
  });

  it('Scrollleisten: jede Seite lädt die goldene Leiste, nirgends wird die Browser-Standardleiste erzwungen', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const pages = [...fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join('public', f))];
    for (const f of pages) {
      const html = fs.readFileSync(path.join(root, f), 'utf8');
      if (/href="\/css\/fonts\.css"/.test(html)) assert.match(html, /href="\/css\/scrollbar\.css"/, `${f} lädt scrollbar.css`);
      if (/href="\/css\/fonts\.css"/.test(html)) assert.match(html, /href="\/css\/feinschliff\.css"/, `${f} lädt feinschliff.css`);
    }
    // <datalist> zeichnet der Browser selbst (weiße Standardleiste, nicht gestaltbar) → eigene Vorschlagsliste (comboField)
    const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk('public/js').filter((n) => n.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /<datalist/, `${f}: <datalist> statt comboField`);
    const css = fs.readFileSync(path.join(root, 'public/css/scrollbar.css'), 'utf8');
    assert.match(css, /::-webkit-scrollbar-thumb/);
    assert.match(css, /gradient/);
    for (const f of fs.readdirSync(path.join(root, 'public/css')).filter((n) => n.endsWith('.css') && n !== 'tailwind.css')) {
      const txt = fs.readFileSync(path.join(root, 'public/css', f), 'utf8').replace(/@supports not selector\(::-webkit-scrollbar\)[^\n]*/g, '').replace(/::picker\(select\) \{[^}]*\}/g, ''); // die geöffnete Auswahlliste braucht die Standard-Eigenschaften (eigenes Element)
      assert.doesNotMatch(txt, /scrollbar-width:\s*thin|scrollbar-color/, `${f}: erzwingt die Standardleiste (zeigt dann weiß statt Gold)`);
    }
  });

  it('Banner: Titel, Aufmachung und weitere Meldungen kommen bei allen an; ungültige Werte werden abgelehnt', async () => {
    assert.equal((await owner.put('/api/config/banner/draft', { ...BANNER, style: 'grell' })).status, 400);
    assert.equal((await owner.put('/api/config/banner/draft', { ...BANNER, slides: [BANNER.slides[0], BANNER.slides[0], BANNER.slides[0]] })).status, 400, 'höchstens drei Meldungen');
    assert.equal((await owner.put('/api/config/banner/draft', BANNER)).status, 200);
    assert.equal((await owner.post('/api/config/banner/publish')).status, 200);
    const b = (await client(srv.base).get('/api/auth/session')).json.siteConfig.banner;
    assert.equal(b.title, 'Notdienst am Wochenende');
    assert.equal(b.style, 'hinweis');
    assert.equal(b.slides.length, 2);
    assert.equal(b.slides[0].text, BANNER.text);
    assert.equal(b.slides[1].linkLabel, 'Zu den Stellen');
  });

  it('Browser: Banner wechselt, Navi-Strich gleitet, kein Kopier-Knopf, Felder und Rechtsklick', { skip: chromium ? false : 'Playwright nicht installiert' }, async () => {
    const me = (await owner.get('/api/auth/session')).json.user;
    const kase = (await owner.post('/api/cases', { title: 'Rechtsklick-Akte', area: 'zivilrecht', clientName: 'Rita Rechts', lawyerId: me.id })).json.case;
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    try {
      // Website: Banner mit zwei Meldungen, Punkte schalten um
      await page.goto(`${srv.base}/`);
      await page.waitForSelector('#siteBanner.sb-hinweis.has-slides');
      await page.click('#siteBanner .sb-dot[data-i="0"]');
      assert.match(await page.textContent('#siteBanner .sb-slide.is-on'), /Notdienst am Wochenende/);
      await page.click('#siteBanner .sb-dot[data-i="1"]');
      await page.waitForFunction(() => /Wir stellen ein/.test(document.querySelector('#siteBanner .sb-slide.is-on')?.textContent || ''));
      // kein „E-Mail kopieren“ mehr im Kontaktbereich
      assert.equal(await page.locator('#emailCopyBtn').count(), 0);
      // Website in Unterseiten: die aktuelle Seite ist im Menü markiert (goldener Strich darunter)
      await page.goto(`${srv.base}/anwaelte`);
      assert.equal(await page.getAttribute('header nav a[data-nav="anwaelte"]', 'aria-current'), 'page');
      assert.match(await page.$eval('header nav a[data-nav="anwaelte"]', (a) => getComputedStyle(a, '::after').transform), /matrix\(1, 0, 0, 1/);
      assert.equal(await page.$eval('header nav a[data-nav="kontakt"]', (a) => getComputedStyle(a, '::after').transform), 'matrix(0, 0, 0, 1, 0, 0)');
      // Karriere: derselbe Strich
      await page.goto(`${srv.base}/karriere`);
      await page.evaluate(() => document.getElementById('ablauf').scrollIntoView());
      await page.waitForFunction(() => document.querySelector('nav[data-ink] .nav-link.nav-active')?.dataset.section === 'ablauf');
      assert.equal(await page.locator('nav[data-ink] .nav-ink').count(), 1);

      // Dashboard
      await page.goto(`${srv.base}/login`);
      await page.fill('#email', TEAM.admin);
      await page.fill('#password', PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL(/dashboard/);
      await page.waitForSelector('#nav a.nav-item');
      await page.waitForSelector('#content .page-title');
      // Scrollleisten in Gold: kein Element darf die Browser-Standardleiste erzwingen (sonst weiß mit Pfeilen)
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('.set-nav');
      assert.deepEqual(
        await page.evaluate(() => ['.set-nav', 'html'].map((q) => { const c = getComputedStyle(document.querySelector(q)); return [c.scrollbarWidth, c.scrollbarColor]; })),
        [['auto', 'auto'], ['auto', 'auto']]
      );
      // Schwebende Beschriftung im Formular „Neue Akte“
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForSelector('[data-action="new-case"]');
      await page.click('[data-action="new-case"] >> nth=0');
      await page.waitForSelector('#ncTitle');
      await page.waitForFunction(() => document.querySelector('#ncTitle').parentElement.classList.contains('fl'));
      assert.equal(await page.evaluate(() => document.querySelector('#ncTitle').parentElement.classList.contains('is-up')), false);
      await page.fill('#ncTitle', 'Schwebend');
      // Die geöffnete Auswahlliste ist ein eigenes Browser-Element und braucht ihre schmale Gold-Leiste direkt
      assert.deepEqual(
        await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#modal select'), '::picker(select)'); return [c.scrollbarWidth, /212, 175, 55|\d/.test(c.scrollbarColor) && c.scrollbarColor !== 'auto']; }),
        ['thin', true]
      );
      assert.equal(await page.evaluate(() => document.querySelector('#ncTitle').parentElement.classList.contains('is-up')), true);
      await page.evaluate(() => closeModal());
      await page.waitForFunction(() => !document.querySelector('#modal.open'));

      // Geldfeld: Tausenderpunkte beim Tippen, gespeichert werden die reinen Ziffern (Dauermandat)
      const field = await page.evaluate(() => {
        const f = document.createElement('form');
        f.innerHTML = '<input name="amount" data-money type="number" class="field" value="2500">';
        document.body.appendChild(f);
        return true;
      });
      assert.ok(field);
      await page.waitForFunction(() => document.querySelector('input[data-money]')?.dataset.moneyOn === '1');
      assert.equal(await page.inputValue('input[data-money]'), '2.500');
      await page.fill('input[data-money]', '');
      await page.type('input[data-money]', '150000');
      assert.equal(await page.inputValue('input[data-money]'), '150.000');
      assert.equal(await page.evaluate(() => document.querySelector('input[data-money]').value), '150000', 'el.value liefert Ziffern');
      const sent = await page.evaluate(() => {
        const f = document.querySelector('input[data-money]').form;
        let got = null;
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          got = new FormData(f).get('amount');
        });
        f.requestSubmit();
        return got;
      });
      assert.equal(sent, '150000', 'Absenden liefert reine Ziffern');

      // Rechtsklick auf eine Aktenzeile: Menü mit Anpinnen, Kopieren …
      await page.evaluate(() => (location.hash = '#cases'));
      await page.waitForFunction(() => st.view === 'cases' && !document.documentElement.dataset.wch); // die Seite blendet über – erst danach die Zeile suchen
      const row = page.locator(`[data-action="open-case"][data-id="${kase.id}"]`).first();
      await row.waitFor();
      // Das Menü schließt bei jedem Scrollen – unter Last verschiebt sich die Liste noch einmal (Schrift/Bilder laden nach): dann erneut öffnen
      let labels = [];
      for (let versuch = 0; ; versuch++) {
        await row.click({ button: 'right' });
        await page.waitForSelector('.ctx-menu.is-open');
        labels = await page.$$eval('.ctx-menu .ctx-item', (l) => l.map((x) => x.textContent.trim()));
        assert.ok(labels.includes('Akte öffnen') && labels.some((t) => /Anpinnen/.test(t)) && labels.includes('Aktenzeichen kopieren'), labels.join(' | '));
        const ok = await page.click('.ctx-menu [data-action="case-star"]', { timeout: 4000 }).then(() => true, () => false);
        if (ok) break;
        if (versuch >= 4) throw new Error('Das Rechtsklick-Menü blieb nicht offen');
        await page.waitForFunction(() => !document.querySelector('.ctx-menu'));
      }
      await page.waitForFunction(() => !document.querySelector('.ctx-menu'));
      await page.waitForFunction((id) => document.querySelector(`[data-action="case-star"][data-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', kase.id);
      // Esc schließt das Menü
      await row.click({ button: 'right' });
      await page.waitForSelector('.ctx-menu.is-open');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.ctx-menu'));
      assert.deepEqual(problems, []);
    } finally {
      await browser.close();
    }
  });
});
