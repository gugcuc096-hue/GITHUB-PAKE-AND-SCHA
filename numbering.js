'use strict';
/*
 * Aktenzeichen nach eigenem Muster (Einstellungen → Konfiguration → Aktenzeichen), z. B.
 *   PS-{JJJJ}-{NR}            → PS-2026-0012   (Standard, wie bisher)
 *   {BEREICH}-{NR}/{JJ}       → STR-014/26     (Strafrecht: Kürzel aus Einstellungen → Listen → Rechtsgebiete)
 *   PS/{KUERZEL}/{NR}         → PS/AP/0003     (Kürzel der federführenden Person)
 * Die laufende Nummer zählt je „Rest des Musters“: steht das Jahr drin, beginnt sie jedes Jahr neu, steht der Bereich
 * drin, zählt jeder Bereich für sich. Gelöschte Akten (Papierkorb) behalten ihre Nummer – es entstehen keine Dubletten.
 * Bestehende Akten behalten ihr Zeichen; das Muster gilt nur für neue.
 */
const { db } = require('./db');
const siteConfig = require('./siteConfig');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function initials(name) {
  const parts = String(name || '')
    .replace(/^(dr|prof)\.?\s+/i, '')
    .split(/[\s-]+/)
    .filter((p) => /\p{L}/u.test(p));
  const letters = parts.map((p) => p.match(/\p{L}/u)[0].toUpperCase()).join('');
  return (letters.slice(0, 3) || 'PS').normalize('NFD').replace(/[^A-Z]/g, '') || 'PS';
}

/** Platzhalter außer {NR} füllen. ctx: { area, lawyerId, date } */
function fill(pattern, ctx = {}) {
  const d = ctx.date || new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(d).map((p) => [p.type, p.value]));
  const area = ctx.area ? db.prepare('SELECT short FROM areas WHERE key = ?').get(ctx.area) : null;
  const lawyer = ctx.lawyerId ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(ctx.lawyerId) : null;
  return pattern
    .replace(/\{JJJJ\}/g, parts.year)
    .replace(/\{JJ\}/g, parts.year.slice(2))
    .replace(/\{MM\}/g, parts.month)
    .replace(/\{BEREICH\}/g, ((area && area.short) || ctx.areaShort || 'ALL').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ALL')
    .replace(/\{KUERZEL\}/g, lawyer ? initials(lawyer.display_name) : ctx.initials || 'PS');
}

/** Nächstes freies Aktenzeichen. */
function nextCaseNumber(ctx = {}, cfg = siteConfig.get('numbering')) {
  const filled = fill(cfg.pattern, ctx);
  const [pre, post] = filled.split('{NR}');
  const re = new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`);
  const taken = new Set(db.prepare('SELECT case_number AS n FROM cases UNION ALL SELECT case_number FROM case_trash').all().map((r) => r.n));
  let max = 0;
  for (const n of taken) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let no = max + 1;
  let out = `${pre}${String(no).padStart(cfg.digits, '0')}${post}`;
  while (taken.has(out)) out = `${pre}${String(++no).padStart(cfg.digits, '0')}${post}`;
  return out;
}

/** Vorschau für die Einstellungen: wie die nächsten Zeichen aussähen (ohne etwas zu vergeben). */
function preview(cfg) {
  const area = db.prepare("SELECT key FROM areas WHERE short != '' ORDER BY sort_order, key LIMIT 1").get();
  return nextCaseNumber({ area: area && area.key, initials: 'AP' }, cfg);
}

module.exports = { nextCaseNumber, preview, fill, initials };
