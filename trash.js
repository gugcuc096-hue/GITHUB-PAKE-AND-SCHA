'use strict';
/*
 * Papierkorb für Akten: „Akte löschen“ legt vorher eine vollständige Momentaufnahme ab – die Akte mit allem,
 * was an ihr hängt (Notizen, Anhänge, externe Dokumente, Aufgaben, Anwälte, Verträge, Bearbeitungszeiten …),
 * ermittelt über die Fremdschlüssel der Datenbank. Danach wird wie bisher gelöscht, sodass gelöschte Akten in
 * keiner Liste und keiner Abfrage mehr auftauchen. Wiederherstellen schreibt alles mit den ursprünglichen
 * Nummern zurück und verknüpft Termine, Rechnungen und Nachrichten wieder mit der Akte.
 * Nach 30 Tagen wird endgültig gelöscht (inkl. der Bilddateien, die bis dahin auf der Disk bleiben).
 */
const { db, tx } = require('./db');
const { removeFile } = require('./uploads');

const KEEP_DAYS = 30;

// Tabelle case_trash: siehe db.js (dort auch die Vergabe der Aktenzeichen, die Nummern im Papierkorb freihält).

/** Fremdschlüssel-Graph: Elterntabelle → [{ table, column, parentColumn, onDelete }]. */
function fkGraph() {
  const graph = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
      (graph[fk.table] ||= []).push({ table: name, column: fk.from, parentColumn: fk.to || 'id', onDelete: String(fk.on_delete || '').toUpperCase() });
    }
  }
  return graph;
}

// Binärwerte (falls je vorhanden) JSON-tauglich machen
const encode = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? { __b64: Buffer.from(v).toString('base64') } : v]));
const decode = (v) => (v && typeof v === 'object' && typeof v.__b64 === 'string' ? Buffer.from(v.__b64, 'base64') : v);

/** Momentaufnahme einer Akte: Zeilen je Tabelle (Eltern vor Kindern) + Verweise zum Wiederverknüpfen. */
function snapshot(caseId) {
  const graph = fkGraph();
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseRow) return null;
  const order = [['cases', [caseRow]]];
  const seen = new Set([`cases:${caseRow.id}`]);
  const relink = [];
  const queue = [['cases', [caseRow]]];
  while (queue.length) {
    const [parent, parentRows] = queue.shift();
    for (const ref of graph[parent] || []) {
      const values = [...new Set(parentRows.map((r) => r[ref.parentColumn]).filter((v) => v !== null && v !== undefined))];
      if (!values.length) continue;
      const ph = values.map(() => '?').join(',');
      const found = db.prepare(`SELECT * FROM "${ref.table}" WHERE "${ref.column}" IN (${ph})`).all(...values);
      if (ref.onDelete === 'CASCADE') {
        const fresh = found.filter((r) => (r.id === undefined ? true : !seen.has(`${ref.table}:${r.id}`)));
        fresh.forEach((r) => r.id !== undefined && seen.add(`${ref.table}:${r.id}`));
        if (!fresh.length) continue;
        order.push([ref.table, fresh]);
        queue.push([ref.table, fresh]);
      } else if (ref.onDelete === 'SET NULL') {
        // Zeilen außerhalb der Akte (Termine, Rechnungen, Nachrichten …): nur den Verweis merken
        for (const r of found) if (r.id !== undefined) relink.push({ table: ref.table, column: ref.column, id: r.id, value: r[ref.column] });
      }
    }
  }
  const rows = order.map(([table, list]) => [table, list.map(encode)]);
  return { rows, relink: relink.filter((r) => !seen.has(`${r.table}:${r.id}`)) };
}

/** Akte in den Papierkorb legen und löschen. Liefert den Papierkorb-Eintrag. */
function trashCase(caseId, user) {
  return tx(() => {
    const snap = snapshot(caseId);
    if (!snap) return null;
    const c = snap.rows[0][1][0];
    // Name des Mandanten festhalten – falls sein Konto gelöscht wird, solange die Akte im Papierkorb liegt
    const clientName = c.client_name || (c.client_id && db.prepare('SELECT display_name FROM users WHERE id = ?').get(c.client_id)?.display_name) || '';
    const files = (snap.rows.find(([t]) => t === 'case_attachments') || [null, []])[1].map((a) => a.file).filter(Boolean);
    const info = db
      .prepare(
        `INSERT INTO case_trash (case_id, case_number, title, client_name, deleted_by, deleted_by_name, payload, files)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(c.id, c.case_number, c.title || '', clientName, user ? user.id : null, user ? user.display_name : '', JSON.stringify(snap), JSON.stringify(files));
    db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    return Number(info.lastInsertRowid);
  });
}

const LIST_SELECT = `
  SELECT t.id, t.case_id, t.case_number, t.title, t.deleted_by_name, t.deleted_at,
         COALESCE(NULLIF(t.client_name, ''), (SELECT display_name FROM users u WHERE u.id = json_extract(t.payload, '$.rows[0][1][0].client_id')), '—') AS client
  FROM case_trash t`;

const listRow = (r) => ({
  id: r.id,
  caseId: r.case_id,
  caseNumber: r.case_number,
  title: r.title,
  clientName: r.client,
  deletedBy: r.deleted_by_name,
  deletedAt: r.deleted_at,
  purgeAt: new Date(Date.parse(r.deleted_at.replace(' ', 'T') + 'Z') + KEEP_DAYS * 864e5).toISOString(),
});

function list() {
  return db.prepare(`${LIST_SELECT} ORDER BY t.deleted_at DESC, t.id DESC`).all().map(listRow);
}

function get(trashId) {
  const r = db.prepare(`${LIST_SELECT} WHERE t.id = ?`).get(trashId);
  return r ? listRow(r) : null;
}

/** Akte wiederherstellen. Wirft einen Fehler mit verständlicher Meldung, wenn es nicht geht. */
function restore(trashId) {
  const t = db.prepare('SELECT * FROM case_trash WHERE id = ?').get(trashId);
  if (!t) throw Object.assign(new Error('Eintrag nicht im Papierkorb.'), { status: 404 });
  if (db.prepare('SELECT id FROM cases WHERE id = ? OR case_number = ?').get(t.case_id, t.case_number)) {
    throw Object.assign(new Error(`Das Aktenzeichen ${t.case_number} ist inzwischen wieder vergeben – Wiederherstellen nicht möglich.`), { status: 409 });
  }
  const snap = JSON.parse(t.payload);
  tx(() => {
    db.exec('PRAGMA defer_foreign_keys = ON'); // Reihenfolge der Zeilen egal – geprüft wird beim Abschluss
    const inserted = new Map(); // Tabelle → rowids der zurückgeschriebenen Zeilen
    for (const [table, list] of snap.rows) {
      const cols = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name));
      if (!cols.size) continue; // Tabelle gibt es nicht mehr
      const ids = inserted.get(table) || new Set();
      inserted.set(table, ids);
      for (const row of list) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        const info = db
          .prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
          .run(...keys.map((k) => decode(row[k])));
        ids.add(Number(info.lastInsertRowid));
      }
    }
    // Verweise außerhalb der Akte wieder setzen – nur wo sie inzwischen nicht neu vergeben wurden
    for (const r of snap.relink) {
      try {
        db.prepare(`UPDATE "${r.table}" SET "${r.column}" = ? WHERE id = ? AND "${r.column}" IS NULL`).run(r.value, r.id);
      } catch {
        /* Tabelle/Spalte gibt es nicht mehr */
      }
    }
    // Verweise auf inzwischen gelöschte Datensätze (z. B. Konto eines Mandanten oder Anwalts): wie beim Löschen
    // in der Datenbank selbst – „leer“ setzen bzw. bei abhängigen Zeilen (ON DELETE CASCADE) weglassen.
    for (const [table, ids] of inserted) {
      const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
      for (const v of db.prepare(`PRAGMA foreign_key_check("${table}")`).all()) {
        const fk = fks.find((f) => f.id === v.fkid);
        if (!fk || !ids.has(v.rowid)) continue;
        if (String(fk.on_delete).toUpperCase() !== 'CASCADE') {
          try {
            db.prepare(`UPDATE "${table}" SET "${fk.from}" = NULL WHERE rowid = ?`).run(v.rowid);
            continue;
          } catch {
            /* Spalte darf nicht leer sein → Zeile weglassen */
          }
        }
        db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`).run(v.rowid);
      }
    }
    // Mandanten-Konto inzwischen gelöscht → Name bleibt in der Akte stehen (wie beim Löschen eines Kontos)
    if (t.client_name) db.prepare("UPDATE cases SET client_name = ? WHERE id = ? AND client_id IS NULL AND client_name = ''").run(t.client_name, t.case_id);
    db.prepare('DELETE FROM case_trash WHERE id = ?').run(t.id);
  });
  return { caseId: t.case_id, caseNumber: t.case_number };
}

/** Endgültig löschen (inkl. Bilddateien der Anhänge). */
function purge(trashId) {
  const t = db.prepare('SELECT id, case_id, files FROM case_trash WHERE id = ?').get(trashId);
  if (!t) return false;
  db.prepare('DELETE FROM case_trash WHERE id = ?').run(t.id);
  // Google Docs der Verträge und des Aktenauszugs dieser Akte ebenfalls löschen (Drive-Papierkorb)
  require('./googleDocs').removeForCase(t.case_id);
  for (const f of JSON.parse(t.files || '[]')) {
    // Datei nur löschen, wenn kein (wiederhergestellter) Anhang sie noch nutzt
    if (!db.prepare('SELECT 1 FROM case_attachments WHERE file = ?').get(f)) removeFile('evidence', f);
  }
  return true;
}

/** Einträge älter als 30 Tage endgültig löschen. */
function purgeExpired() {
  const old = db.prepare(`SELECT id FROM case_trash WHERE deleted_at <= datetime('now', ?)`).all(`-${KEEP_DAYS} days`);
  old.forEach((r) => purge(r.id));
  return old.length;
}

function start() {
  const run = () => {
    try {
      const n = purgeExpired();
      if (n) console.log(`Papierkorb: ${n} Akte(n) nach ${KEEP_DAYS} Tagen endgültig gelöscht.`);
    } catch (err) {
      console.warn('Papierkorb-Bereinigung fehlgeschlagen:', err.message);
    }
  };
  setTimeout(run, 90 * 1000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { trashCase, list, get, restore, purge, purgeExpired, start, KEEP_DAYS };
