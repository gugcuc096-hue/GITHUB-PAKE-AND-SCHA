'use strict';
/*
 * Prüfungen ohne Server: strenge Content-Security-Policy (keine Inline-Skripte, keine onclick-Attribute),
 * vollständige Skript-Verweise der Seiten, die 12 Teile des Dashboards und keine Zugangsdaten im Code.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('./helpers');

const PUBLIC = path.join(ROOT, 'public');
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file);
const htmlPages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).map((f) => path.join(PUBLIC, f));
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const browserScripts = walk(path.join(PUBLIC, 'js'), '.js');

describe('Strenge Content-Security-Policy', () => {
  it('keine Inline-Skripte in den Seiten', () => {
    for (const page of htmlPages) {
      const inline = [...read(page).matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["']application\/(ld\+)?json/.test(m[1]));
      assert.equal(inline.length, 0, `${rel(page)}: Inline-Skript gefunden – Code gehört in eine Datei unter public/js/`);
    }
  });

  it('keine onclick/onchange/…-Attribute in Seiten und erzeugtem HTML', () => {
    const handler = /<[a-z][^>]*\son[a-z]+\s*=/i; // in Seiten
    const generated = /\son(click|change|input|submit|load|error|key[a-z]+|mouse[a-z]+|pointer[a-z]+|touch[a-z]+|focus|blur|paste|drag[a-z]*|drop)\s*=\s*["'\\]/i; // in Skripten
    for (const page of htmlPages) {
      const m = read(page).match(handler);
      assert.equal(m, null, `${rel(page)}: Inline-Handler „${m && m[0].slice(-40)}“ – bitte data-act/data-action + addEventListener`);
    }
    for (const file of browserScripts) {
      const m = read(file).match(generated);
      assert.equal(m, null, `${rel(file)}: Inline-Handler im erzeugten HTML „${m && m[0]}“`);
    }
  });

  it('keine javascript:-Links', () => {
    for (const file of [...htmlPages, ...browserScripts]) assert.doesNotMatch(read(file), /javascript:/i, rel(file));
  });

  it('alle eingebundenen Skripte und Stylesheets existieren', () => {
    for (const page of htmlPages) {
      const refs = [...read(page).matchAll(/<(?:script[^>]+src|link[^>]+href)\s*=\s*["'](\/[^"'?#]+)/gi)].map((m) => m[1]);
      for (const ref of refs) assert.ok(fs.existsSync(path.join(PUBLIC, ref)), `${rel(page)} verweist auf ${ref}, die Datei fehlt`);
    }
  });

  it('alle Browser-Skripte sind gültiges JavaScript', () => {
    for (const file of browserScripts) assert.doesNotThrow(() => new vm.Script(read(file), { filename: rel(file) }), rel(file));
  });
});

describe('Dashboard in Teilen (public/js/dashboard/)', () => {
  const dir = path.join(PUBLIC, 'js', 'dashboard');
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

  it('dashboard.html lädt alle Teile in der richtigen Reihenfolge', () => {
    const loaded = [...read(path.join(PUBLIC, 'dashboard.html')).matchAll(/<script src="\/js\/dashboard\/([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(loaded, parts);
    assert.ok(parts.length >= 2 && /^01-/.test(parts[0]), 'Teile sind nummeriert (01-…)');
  });

  it('jeder Teil läuft im strikten Modus', () => {
    for (const f of parts) {
      const code = read(path.join(dir, f)).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
      assert.match(code, /^'use strict';/, `${f}: 'use strict'; fehlt am Anfang`);
    }
  });

  it('keine doppelten Namen über die Teile hinweg', () => {
    // Zusammen übersetzt wie im Browser (gemeinsamer Gültigkeitsbereich): doppeltes const/let wäre ein Fehler
    const joined = parts.map((f) => read(path.join(dir, f))).join('\n;\n');
    assert.doesNotThrow(() => new vm.Script(`(() => {\n${joined}\n})`, { filename: 'dashboard (alle Teile)' }));
    // doppelte Funktionen würden sich still überschreiben
    const seen = new Map();
    for (const f of parts) {
      for (const m of read(path.join(dir, f)).matchAll(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) {
        assert.ok(!seen.has(m[1]), `function ${m[1]} doppelt: ${seen.get(m[1])} und ${f}`);
        seen.set(m[1], f);
      }
    }
  });
});

describe('Keine Zugangsdaten im Code', () => {
  const PATTERNS = [
    ['Discord-Bot-Token', /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/],
    ['privater Schlüssel', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub-Token', /\bgh[pousr]_[A-Za-z\d]{36}\b/],
    ['Discord-Webhook mit Token', /discord(?:app)?\.com\/api\/webhooks\/\d{15,}\/[A-Za-z\d_-]{40,}/],
  ];
  const files = (() => {
    try {
      return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      return [...walk(ROOT, '.js').filter((f) => !f.includes('node_modules')), ...htmlPages].map(rel);
    }
  })().filter((f) => /\.(js|html|json|md|txt|css|yml|example)$/.test(f) && f !== 'package-lock.json');

  it('keine Tokens, Schlüssel oder Webhook-Adressen im Repository', () => {
    for (const f of files) {
      const text = read(path.join(ROOT, f));
      for (const [name, re] of PATTERNS) assert.doesNotMatch(text, re, `${f}: sieht nach ${name} aus – gehört in die Umgebungsvariablen (Render → Environment)`);
    }
  });
});
