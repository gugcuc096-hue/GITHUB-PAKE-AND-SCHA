'use strict';
/*
 * Ränge der Kanzlei – vom Board in den Einstellungen gepflegt (Tabelle ranks).
 * Ebene „board“ = Board of Partners (volle Board-Rechte), „associate“ = Associate Attorneys.
 * Die Listen in helpers.js (RANKS, BOARD_RANKS, ASSOCIATE_RANKS) werden hier befüllt; alle Module
 * lesen dieselben Arrays. Beim ersten Start werden die bisherigen sechs Ränge samt Texten der
 * Startseite übernommen.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, getSetting, setSetting } = require('./db');
const { RANKS, BOARD_RANKS, ASSOCIATE_RANKS } = require('./helpers');

const LEVELS = { board: 'Board of Partners', associate: 'Associate Attorneys' };

const all = () => db.prepare("SELECT * FROM ranks ORDER BY CASE level WHEN 'board' THEN 0 ELSE 1 END, sort, id").all();

function refresh() {
  const rows = all();
  const fill = (arr, list) => arr.splice(0, arr.length, ...list);
  fill(BOARD_RANKS, rows.filter((r) => r.level === 'board').map((r) => r.name));
  fill(ASSOCIATE_RANKS, rows.filter((r) => r.level === 'associate').map((r) => r.name));
  fill(RANKS, [...BOARD_RANKS, ...ASSOCIATE_RANKS]);
  return rows;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Erste Einrichtung: die sechs bisherigen Ränge mit den Texten der Startseite. */
function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM ranks').get().n) return;
  const defaults = [
    ['Founding Partner', 'board'],
    ['Equity Partner', 'board'],
    ['Partner', 'board'],
    ['Senior Associate', 'associate'],
    ['Associate', 'associate'],
    ['Junior Associate', 'associate'],
  ];
  let html = '';
  try {
    html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  } catch {
    /* ohne Startseite: nur Namen */
  }
  const cards = {};
  const re = /<span[^>]*uppercase font-semibold">([^<]*)<\/span>[\s\S]*?<h4[^>]*>([^<]*)<\/h4>\s*<p[^>]*>([^<]*)<\/p>[\s\S]*?font-mono[^"]*">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) cards[clean(m[2])] = { badge: clean(m[1]), description: clean(m[3]), footer: clean(m[4]) };
  const ins = db.prepare('INSERT INTO ranks (name, level, badge, description, footer, sort) VALUES (?, ?, ?, ?, ?, ?)');
  defaults.forEach(([name, level], i) => {
    const c = cards[name] || {};
    ins.run(name, level, c.badge || '', c.description || '', c.footer || '', i);
  });
}

function init() {
  seed();
  refresh();
}

const byId = (id) => db.prepare('SELECT * FROM ranks WHERE id = ?').get(id);
const inUse = (name) =>
  db.prepare('SELECT COUNT(*) AS n FROM users WHERE rank = ?').get(name).n + db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE role_title = ?').get(name).n;

function create(d) {
  if (db.prepare('SELECT 1 FROM ranks WHERE name = ?').get(d.name)) throw Object.assign(new Error('Diesen Rang gibt es schon.'), { status: 409 });
  const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM ranks WHERE level = ?').get(d.level).s;
  const id = Number(
    db.prepare('INSERT INTO ranks (name, level, badge, description, footer, sort) VALUES (?, ?, ?, ?, ?, ?)').run(d.name, d.level, d.badge, d.description, d.footer, sort).lastInsertRowid
  );
  refresh();
  return byId(id);
}

/** Ändern – beim Umbenennen ziehen Konten, Team-Profile und die Discord-Rollenzuordnung mit. */
function update(id, d) {
  const r = byId(id);
  if (!r) return null;
  const name = d.name ?? r.name;
  if (name !== r.name && db.prepare('SELECT 1 FROM ranks WHERE name = ? AND id != ?').get(name, id))
    throw Object.assign(new Error('Diesen Rang gibt es schon.'), { status: 409 });
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE ranks SET name = ?, level = ?, badge = ?, description = ?, footer = ? WHERE id = ?').run(
      name,
      d.level ?? r.level,
      d.badge ?? r.badge,
      d.description ?? r.description,
      d.footer ?? r.footer,
      id
    );
    if (name !== r.name) {
      db.prepare('UPDATE users SET rank = ? WHERE rank = ?').run(name, r.name);
      db.prepare('UPDATE team_members SET role_title = ? WHERE role_title = ?').run(name, r.name);
      try {
        const sync = JSON.parse(getSetting('bot_rank_sync', '{}') || '{}');
        if (sync.ranks && sync.ranks[r.name] !== undefined) {
          sync.ranks[name] = sync.ranks[r.name];
          delete sync.ranks[r.name];
          setSetting('bot_rank_sync', JSON.stringify(sync));
        }
      } catch {
        /* keine Rollenzuordnung */
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  refresh();
  return byId(id);
}

/** Eine Stelle nach oben (-1) oder unten (+1) innerhalb der Ebene. */
function move(id, dir) {
  const r = byId(id);
  if (!r) return null;
  const list = all().filter((x) => x.level === r.level);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  const upd = db.prepare('UPDATE ranks SET sort = ? WHERE id = ?');
  list.forEach((x, k) => upd.run(k, x.id));
  refresh();
  return byId(id);
}

function remove(id) {
  const r = byId(id);
  if (!r) return { notFound: true };
  const n = inUse(r.name);
  if (n) return { error: `„${r.name}“ ist noch vergeben (${n}×). Bitte zuerst einen anderen Rang zuweisen.` };
  db.prepare('DELETE FROM ranks WHERE id = ?').run(id);
  refresh();
  return { rank: r };
}

const toJson = (r, i) => ({ id: r.id, name: r.name, level: r.level, badge: r.badge, description: r.description, footer: r.footer, number: i + 1, inUse: inUse(r.name) });
const list = () => all().map(toJson);
/** Für das Dashboard: { 'Board of Partners': [...], 'Associate Attorneys': [...] } */
const groups = () => ({ [LEVELS.board]: [...BOARD_RANKS], [LEVELS.associate]: [...ASSOCIATE_RANKS] });

/* ---------------------------------------------------------------- Karten auf der Startseite */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Farben wie bisher: Board in Gold, Associates abgestuft (erster Rang Bernstein, dann Schiefer)
const STYLE = {
  board: ['border-t-[var(--gold-500)]', 'bg-[rgba(212,175,55,0.15)] text-[var(--gold-light)] border border-[var(--gold-hairline)]', 'text-[var(--gold-500)]'],
  a0: ['border-t-amber-500/60', 'bg-amber-500/10 text-amber-300 border border-amber-500/20', 'text-amber-300'],
  a1: ['border-t-slate-500', 'bg-slate-500/10 text-slate-300 border border-slate-500/20', 'text-slate-300'],
  a2: ['border-t-slate-600', 'bg-slate-600/10 text-slate-400 border border-slate-600/20', 'text-slate-400'],
};
function cardsHtml(level) {
  const rows = all();
  const offset = level === 'board' ? 0 : rows.filter((r) => r.level === 'board').length;
  return rows
    .filter((r) => r.level === level)
    .map((r, i) => {
      const [top, badge, foot] = STYLE[level === 'board' ? 'board' : `a${Math.min(i, 2)}`];
      return `
                        <div class="glass-card p-6 border-t-2 ${top} flex flex-col justify-between">
                            <div>
                                <div class="flex items-center justify-between mb-3">
                                    ${r.badge ? `<span class="text-[0.65rem] font-mono px-3 py-1 rounded-full ${badge} uppercase font-semibold">${esc(r.badge)}</span>` : '<span></span>'}
                                    <span class="text-xs text-[var(--text-muted)] font-mono">Rang ${String(offset + i + 1).padStart(2, '0')}</span>
                                </div>
                                <h4 class="font-serif text-2xl font-semibold text-white mb-3">${esc(r.name)}</h4>
                                ${r.description ? `<p class="text-xs text-[var(--text-muted)] leading-relaxed mb-4">${esc(r.description)}</p>` : ''}
                            </div>
                            ${r.footer ? `<div class="pt-4 border-t border-[var(--glass-border)] text-[0.7rem] font-mono ${foot}">${esc(r.footer)}</div>` : ''}
                        </div>`;
    })
    .join('\n');
}

module.exports = { LEVELS, init, refresh, list, groups, create, update, move, remove, cardsHtml, byId };
