'use strict';
/*
 * Aktuelles (Website → /aktuelles, auf der Startseite die neuesten drei):
 *  - Meldungen des Boards (Tabelle news): Titel, Text, angepinnt (steht oben), sichtbar
 *  - automatisch – nur aus echten Vorgängen, nichts ausgedacht:
 *      „Neu im Team“      Einstellung aus dem Personalprotokoll
 *      „Beförderung“      Beförderung aus dem Personalprotokoll (Rückstufungen und Kündigungen erscheinen nie)
 *      „Wir stellen ein“  offene Stelle (Karriere)
 *    Jede Quelle lässt sich unter Einstellungen → Startseite abschalten.
 */
const { z } = require('zod');
const { db } = require('../db/db');

const AUTO_DAYS = 120; // ältere Personalmeldungen sind keine Neuigkeit mehr
const input = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().max(4000).default(''),
  pinned: z.boolean().default(false),
  visible: z.boolean().default(true),
});

const row = (r) => ({
  id: r.id,
  kind: 'meldung',
  title: r.title,
  body: r.body,
  pinned: !!r.pinned,
  visible: !!r.visible,
  author: r.author_name,
  at: r.created_at,
  updatedAt: r.updated_at,
});

/** Meldungen des Boards (für die Verwaltung: auch unsichtbare). */
function manual({ all = false } = {}) {
  return db
    .prepare(`SELECT * FROM news ${all ? '' : 'WHERE visible = 1'} ORDER BY pinned DESC, created_at DESC, id DESC`)
    .all()
    .map(row);
}

function sources() {
  try {
    const home = require('../web/siteConfig').get('home');
    return { hires: true, promotions: true, positions: true, ...(home.news || {}) };
  } catch {
    return { hires: true, promotions: true, positions: true };
  }
}

/** Automatische Meldungen aus Personalprotokoll und Stellen. */
function automatic() {
  const on = sources();
  const out = [];
  const types = [on.hires && 'einstellung', on.promotions && 'befoerderung'].filter(Boolean);
  if (types.length) {
    const rows = db
      .prepare(
        `SELECT id, type, person_name, new_rank, created_at FROM personnel_events
          WHERE type IN (${types.map(() => '?').join(',')}) AND created_at > datetime('now', ?)
          ORDER BY created_at DESC LIMIT 20`
      )
      .all(...types, `-${AUTO_DAYS} days`);
    for (const r of rows) {
      const rank = r.new_rank ? ` als ${r.new_rank}` : '';
      out.push(
        r.type === 'einstellung'
          ? { id: `p${r.id}`, kind: 'team', title: `Neu im Team: ${r.person_name}`, body: `${r.person_name} verstärkt die Kanzlei${rank}.`, at: r.created_at }
          : { id: `p${r.id}`, kind: 'befoerderung', title: `Beförderung: ${r.person_name}`, body: `${r.person_name} ist ab sofort ${r.new_rank || 'in neuer Funktion'}.`, at: r.created_at }
      );
    }
  }
  if (on.positions) {
    const features = require('../core/features');
    if (features.on('karriere')) {
      for (const p of db.prepare('SELECT id, title, created_at FROM positions WHERE active = 1 ORDER BY sort_order, id').all()) {
        out.push({ id: `s${p.id}`, kind: 'stelle', title: `Wir stellen ein: ${p.title}`, body: 'Bewerbung direkt über die Karriereseite.', at: p.created_at, link: '/karriere' });
      }
    }
  }
  return out;
}

/** Alles für die Website: angepinnte Meldungen zuerst, dann nach Datum. */
function feed(limit = 30) {
  const pinned = manual().filter((n) => n.pinned);
  const rest = [...manual().filter((n) => !n.pinned), ...automatic()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return [...pinned, ...rest].slice(0, limit).map(({ visible, updatedAt, ...n }) => n);
}

function create(data, user) {
  const d = input.parse(data);
  const r = db
    .prepare('INSERT INTO news (title, body, pinned, visible, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(d.title, d.body, d.pinned ? 1 : 0, d.visible ? 1 : 0, user ? user.id : null, user ? user.display_name || user.name || '' : '');
  return get(r.lastInsertRowid);
}
function update(id, data) {
  const d = input.parse(data);
  const r = db.prepare("UPDATE news SET title = ?, body = ?, pinned = ?, visible = ?, updated_at = datetime('now') WHERE id = ?").run(d.title, d.body, d.pinned ? 1 : 0, d.visible ? 1 : 0, id);
  return r.changes ? get(id) : null;
}
function remove(id) {
  return db.prepare('DELETE FROM news WHERE id = ?').run(id).changes > 0;
}
function get(id) {
  const r = db.prepare('SELECT * FROM news WHERE id = ?').get(id);
  return r ? row(r) : null;
}

module.exports = { feed, manual, automatic, create, update, remove, get, input, sources };
