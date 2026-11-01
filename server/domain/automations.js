'use strict';
/*
 * Automatik-Regeln („Wenn … dann …“), gepflegt vom Board unter Einstellungen → Automatik:
 *
 *   Auslöser (trigger)       Bedingungen (conditions)            Aktionen (action + params)
 *   case.created             area (Rechtsgebiet, leer = alle)     task      { title, dueDays, to: 'lead' | 'creator' }
 *   case.idle                area, days (Tage ohne Aktivität)     priority  { priority: 1–4 }
 *   case.status              area, status (neuer Status)          status    { status: 'offen' | 'in_bearbeitung' | 'geschlossen' }
 *   invoice.paid             area                                 note      { text } (interner Verlaufseintrag)
 *
 * Jede Regel läuft je Akte und Anlass höchstens einmal (case.idle: einmal je Ruhephase). Was eine Regel getan hat,
 * steht als interner Verlaufseintrag „Automatik: …“ in der Akte und zählt bei der Regel mit. Regeln lösen sich nicht
 * gegenseitig aus (eine Statusänderung durch eine Regel startet keine weiteren Regeln) – keine Endlosschleifen.
 */
const { z } = require('zod');
const { db } = require('../db/db');
const { PRIORITIES } = require('../core/helpers');

const TRIGGERS = {
  'case.created': 'Neue Akte angelegt',
  'case.idle': 'Akte liegt X Tage ohne Aktivität',
  'case.status': 'Status einer Akte ändert sich',
  'invoice.paid': 'Rechnung als bezahlt markiert',
};
const ACTIONS = {
  task: 'Aufgabe anlegen',
  priority: 'Priorität setzen',
  status: 'Status setzen',
  note: 'Interne Notiz schreiben',
};
const STATUSES = ['offen', 'in_bearbeitung', 'geschlossen'];

const schema = z
  .object({
    name: z.string().trim().min(2).max(80),
    active: z.boolean().default(true),
    trigger: z.enum(Object.keys(TRIGGERS)),
    conditions: z.object({ area: z.string().trim().max(40).default(''), days: z.number().int().min(1).max(90).optional(), status: z.enum(STATUSES).optional() }).default({}),
    action: z.enum(Object.keys(ACTIONS)),
    params: z
      .object({
        title: z.string().trim().max(160).optional(),
        dueDays: z.number().int().min(0).max(60).optional(),
        to: z.enum(['lead', 'creator']).optional(),
        priority: z.number().int().min(1).max(4).optional(),
        status: z.enum(STATUSES).optional(),
        text: z.string().trim().max(1000).optional(),
      })
      .default({}),
  })
  .superRefine((r, ctx) => {
    const need = (ok, msg) => !ok && ctx.addIssue({ code: 'custom', message: msg });
    if (r.trigger === 'case.idle') need(r.conditions.days, 'Bitte angeben, nach wie vielen Tagen ohne Aktivität.');
    if (r.trigger === 'case.status') need(r.conditions.status, 'Bitte den Status wählen, bei dem die Regel greift.');
    if (r.action === 'task') need(r.params.title && r.params.title.length >= 2, 'Bitte einen Titel für die Aufgabe angeben.');
    if (r.action === 'priority') need(r.params.priority, 'Bitte die Priorität wählen.');
    if (r.action === 'status') need(r.params.status, 'Bitte den Status wählen.');
    if (r.action === 'note') need(r.params.text && r.params.text.length >= 2, 'Bitte den Text der Notiz angeben.');
    if (r.trigger === 'case.status' && r.action === 'status') need(r.conditions.status !== r.params.status, 'Status-Regel würde sich selbst auslösen.');
  });

const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const row = (r) => ({
  id: r.id,
  name: r.name,
  active: !!r.active,
  trigger: r.trigger,
  conditions: parse(r.conditions, {}),
  action: r.action,
  params: parse(r.params, {}),
  runs: r.runs,
  lastRunAt: r.last_run_at,
  createdAt: r.created_at,
});
const list = () => db.prepare('SELECT * FROM automations ORDER BY id').all().map(row);
const get = (id) => {
  const r = db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
  return r ? row(r) : null;
};
function create(d, user) {
  const info = db
    .prepare('INSERT INTO automations (name, active, trigger, conditions, action, params, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(d.name, d.active ? 1 : 0, d.trigger, JSON.stringify(d.conditions), d.action, JSON.stringify(d.params), user ? user.id : null);
  return get(Number(info.lastInsertRowid));
}
function update(id, d) {
  db.prepare('UPDATE automations SET name = ?, active = ?, trigger = ?, conditions = ?, action = ?, params = ? WHERE id = ?').run(d.name, d.active ? 1 : 0, d.trigger, JSON.stringify(d.conditions), d.action, JSON.stringify(d.params), id);
  db.prepare('DELETE FROM automation_done WHERE rule_id = ?').run(id); // geänderte Regel: neu bewerten
  return get(id);
}
const remove = (id) => db.prepare('DELETE FROM automations WHERE id = ?').run(id).changes > 0;

/** Was eine Regel tut, als Satz (Liste in den Einstellungen und Verlaufseintrag). */
function describe(r) {
  const p = r.params || {};
  const label = { offen: 'Offen', in_bearbeitung: 'In Bearbeitung', geschlossen: 'Abgeschlossen' };
  if (r.action === 'task') return `Aufgabe „${p.title}“${p.dueDays ? ` (fällig in ${p.dueDays} ${p.dueDays === 1 ? 'Tag' : 'Tagen'})` : ''} an ${p.to === 'creator' ? 'die Person, die die Akte angelegt hat' : 'den Federführenden'}`;
  if (r.action === 'priority') return `Priorität „${PRIORITIES[p.priority]}“`;
  if (r.action === 'status') return `Status „${label[p.status]}“`;
  return `Notiz „${String(p.text || '').slice(0, 60)}“`;
}

let depth = 0; // Regeln lösen keine weiteren Regeln aus
function apply(r, c) {
  const { addSystemNote } = require('../db/models');
  const p = r.params || {};
  const now = new Date();
  if (r.action === 'task') {
    const to = p.to === 'creator' ? c.created_by || c.lawyer_id : c.lawyer_id;
    const due = p.dueDays !== undefined ? new Date(now.getTime() + p.dueDays * 86400000).toISOString().slice(0, 10) : null;
    db.prepare('INSERT INTO tasks (case_id, title, note, due_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, NULL)').run(c.id, p.title, `Automatisch angelegt (Regel „${r.name}“).`, due, to || null);
  } else if (r.action === 'priority') {
    if ((c.priority || 2) === p.priority) return false;
    db.prepare('UPDATE cases SET priority = ? WHERE id = ?').run(p.priority, c.id);
  } else if (r.action === 'status') {
    if (c.status === p.status) return false;
    db.prepare(`UPDATE cases SET status = ?${p.status === 'geschlossen' ? ", closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : ''} WHERE id = ?`).run(p.status, c.id);
  }
  addSystemNote(c.id, null, `Automatik „${r.name}“: ${r.action === 'note' ? p.text : describe(r)}.`, true);
  db.prepare("UPDATE automations SET runs = runs + 1, last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(r.id);
  return true;
}

/**
 * Ein Ereignis ist passiert: passende, aktive Regeln ausführen.
 * ctx: { caseId, status } – status = neuer Status bei case.status. mark: Kennung des Anlasses (je Akte einmal).
 */
function fire(trigger, { caseId, status } = {}, mark = '', onlyRule = null) {
  if (depth > 0 || !caseId) return 0;
  const rules = db
    .prepare('SELECT * FROM automations WHERE active = 1 AND trigger = ?')
    .all(trigger)
    .map(row)
    .filter((r) => !onlyRule || r.id === onlyRule);
  if (!rules.length) return 0;
  depth++;
  let n = 0;
  try {
    for (const r of rules) {
      const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
      if (!c) break;
      if (r.conditions.area && r.conditions.area !== c.area) continue;
      if (trigger === 'case.status' && r.conditions.status !== status) continue;
      const key = mark || trigger;
      if (!db.prepare('INSERT OR IGNORE INTO automation_done (rule_id, case_id, mark) VALUES (?, ?, ?)').run(r.id, c.id, key).changes) continue;
      try {
        if (apply(r, c)) n++;
      } catch (err) {
        console.warn(`Automatik „${r.name}“ bei Akte ${c.id} fehlgeschlagen:`, err.message);
      }
    }
  } finally {
    depth--;
  }
  if (n) {
    try {
      require('../core/live').caseChanged(caseId);
    } catch {
      /* ohne Live */
    }
  }
  return n;
}

/** Alle 5 Minuten (server.js): Regeln „liegt X Tage“ – einmal je Ruhephase (Kennung = letzte Aktivität). */
function sweep() {
  const rules = db.prepare("SELECT * FROM automations WHERE active = 1 AND trigger = 'case.idle'").all().map(row);
  let n = 0;
  for (const r of rules) {
    const cases = db
      .prepare(`SELECT id, updated_at FROM cases WHERE status != 'geschlossen' AND julianday(updated_at) <= julianday('now', ?) ${r.conditions.area ? 'AND area = ?' : ''}`)
      .all(...[`-${r.conditions.days} days`, ...(r.conditions.area ? [r.conditions.area] : [])]);
    for (const c of cases) {
      if (db.prepare('SELECT 1 FROM automation_done WHERE rule_id = ? AND case_id = ? AND mark = ?').get(r.id, c.id, `idle:${c.updated_at}`)) continue;
      n += fire('case.idle', { caseId: c.id }, `idle:${c.updated_at}`, r.id);
    }
  }
  return n;
}

module.exports = { TRIGGERS, ACTIONS, STATUSES, schema, list, get, create, update, remove, describe, fire, sweep };
