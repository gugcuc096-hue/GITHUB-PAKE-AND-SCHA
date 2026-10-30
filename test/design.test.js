'use strict';
/*
 * Designsystem „Tiefe, Glas, Licht“ (public/css/depth.css): auf allen Seiten eingebunden, feste Höhenstufen, Rückfälle ohne
 * Weichzeichner / bei „Transparenz reduzieren“, kein Weichzeichner auf Kennzahlen und Listen (Handy bleibt flüssig).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(PUBLIC, 'css', 'depth.css'), 'utf8');

describe('Designsystem Tiefe, Glas, Licht', () => {
  for (const page of ['dashboard', 'login', 'register', 'bewerbung', 'karriere', '404', 'index']) {
    it(`${page}.html bindet depth.css ein – nach den Grundstilen, vor der Bewegung`, () => {
      const html = fs.readFileSync(path.join(PUBLIC, `${page}.html`), 'utf8');
      const links = [...html.matchAll(/<link rel="stylesheet" href="\/css\/([\w.-]+)"/g)].map((m) => m[1]);
      const at = links.indexOf('depth.css');
      assert.ok(at >= 0, 'depth.css fehlt');
      assert.ok(links.indexOf('motion.css') > at, 'motion.css muss danach kommen');
      if (links.includes('app.css')) assert.ok(links.indexOf('app.css') < at, 'app.css muss davor kommen');
    });
  }

  it('fünf feste Höhenstufen und Licht-Farben', () => {
    for (const t of ['--sh-1', '--sh-2', '--sh-3', '--sh-4', '--lit-edge', '--lit-gold']) assert.match(css, new RegExp(`${t}:`), t);
  });

  it('Glas nur auf Kopfzeile, Menü und Fenster-Hintergrund – nicht auf Karten und Kennzahlen', () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)].map((m) => m[1].trim());
    const joined = blocks.join(' ');
    assert.doesNotMatch(joined, /\.kpi|\.panel|\.list-row|\.chip/);
    assert.match(joined, /\.sidebar/);
    assert.match(joined, /\.modal/);
  });

  it('Glas auf allen schwebenden Ebenen (Hinweise, Menüs, Leisten, Reiter, Karten-Auflagen, Fenster am PC) – auch mit Rückfall', () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)].map((m) => m[1]);
    const joined = blocks.join(' ');
    for (const sel of ['.ps-toast', '.pop', '.more-pop', '.bulk-bar', '.sys-bar', '.kmap-card', '.kmap-cap', '.case-jump', '.modal-card', '.fn-table thead th']) assert.ok(joined.includes(sel), `${sel} fehlt`);
    const off = css.slice(css.indexOf('prefers-reduced-transparency'));
    for (const sel of ['.ps-toast', '.pop', '.case-jump', '.modal-card']) assert.ok(off.includes(sel), `${sel}: kein Rückfall bei „Transparenz reduzieren“`);
  });

  it('Bewegung überall: gemeinsame Übergänge und aufklappbare Bereiche gleiten (mit Ruhe-Fassung)', () => {
    const motion = fs.readFileSync(path.join(PUBLIC, 'css', 'motion.css'), 'utf8');
    const calm = fs.readFileSync(path.join(PUBLIC, 'css', 'calm.css'), 'utf8');
    assert.match(motion, /:where\(a, button, summary[^)]*\) \{\s*transition-property: color, background-color/);
    assert.match(motion, /::details-content \{ block-size: 0/);
    assert.match(calm, /::details-content \{ transition: none !important; \}/);
    // Menüs mit überstehender Auswahl dürfen nicht abgeschnitten werden
    assert.doesNotMatch(motion, /details\.more-menu[^{]*::details-content/);
  });

  it('Rückfälle: ohne Weichzeichner, bei „Transparenz reduzieren“ und im Kontrastmodus', () => {
    assert.match(css, /@supports not/);
    assert.match(css, /prefers-reduced-transparency: reduce/);
    assert.match(css, /forced-colors: active/);
  });
});
