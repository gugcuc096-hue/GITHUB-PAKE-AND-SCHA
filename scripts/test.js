'use strict';
/*
 * Tests getrennt starten:
 *   npm run test:schnell  – alles ohne Browser (API, Dateien); in etwa einer Minute durch
 *   npm run test:browser  – nur die Dateien mit Browser-Prüfungen (Chromium über Playwright)
 *   npm test              – alles (so läuft es auch bei jedem Pull Request)
 * Weitere Argumente gehen an node --test, z. B. npm run test:schnell -- --test-name-pattern=Archiv
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const [mode, ...rest] = process.argv.slice(2);
const all = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).sort();
const usesBrowser = (f) => /require\('playwright'\)/.test(fs.readFileSync(path.join(ROOT, 'test', f), 'utf8'));

let files = all;
const args = ['--test'];
if (mode === 'schnell') args.unshift('--require', path.join(ROOT, 'test', 'ohne-browser.js'));
else if (mode === 'browser') {
  files = all.filter(usesBrowser);
  args.push('--test-concurrency=2');
} else {
  console.error('Aufruf: node scripts/test.js schnell|browser [Argumente für node --test]');
  process.exit(2);
}
const r = spawnSync(process.execPath, [...args, ...rest, ...files.map((f) => path.join('test', f))], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
