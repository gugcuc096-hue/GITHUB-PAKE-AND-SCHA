'use strict';
/* Aufgaben & Wiedervorlagen – nur für das Team, mit oder ohne Aktenbezug. */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, dateOnly, truncate, CHECKLISTS } = require('../helpers');
const { TASK_SELECT, taskRow, getCase, addSystemNote } = require('../models');
const discord = require('../discord');

const router = express.Router();
router.use(requireAuth, requireStaff);

const MAX_TASKS_PER_CASE = 60;

function activeStaff(id) {
  return db.prepare("SELECT id, display_name, discord_id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(id);
}

function getTask(id) {
  return db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) || null;
}

function touchCase(caseId) {
  if (caseId) db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(caseId);
}

function notifyAssigned(task, assignee, by) {
  if (!assignee || assignee.id === by.id) return;
  discord.notify('task.assigned', {
    title: `Neue Aufgabe für ${assignee.display_name}`,
    description: truncate(task.title, 300),
    fields: [
      { name: 'Akte', value: task.case_number || '—' },
      { name: 'Fällig', value: task.due_date ? new Date(`${task.due_date}T12:00:00Z`).toLocaleDateString('de-DE') : 'ohne Datum' },
      { name: 'Von', value: by.display_name },
    ],
    mentionIds: assignee.discord_id ? [assignee.discord_id] : [],
  });
}

/* ---------------------------------------------------------------- Liste */
router.get('/', (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const done = req.query.state === 'done' ? 1 : 0;
  const where = ['t.done = ?'];
  const params = [done];
  if (scope === 'mine') {
    where.push('t.assigned_to = ?');
    params.push(req.user.id);
  }
  const caseId = Number(req.query.caseId);
  if (Number.isInteger(caseId) && caseId > 0) {
    where.push('t.case_id = ?');
    params.push(caseId);
  }
  const order = done ? 't.done_at DESC, t.id DESC LIMIT 200' : 't.due_date IS NULL, t.due_date ASC, t.id ASC LIMIT 500';
  const rows = db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...params);
  res.json({ tasks: rows.map(taskRow) });
});

/** Anzahl eigener offener Aufgaben, die heute oder früher fällig sind (Badge in der Navigation). */
router.get('/due-count', (req, res) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.today)) ? String(req.query.today) : new Date().toISOString().slice(0, 10);
  const n = db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE assigned_to = ? AND done = 0 AND due_date IS NOT NULL AND due_date <= ?')
    .get(req.user.id, today).n;
  res.json({ due: n });
});

/* ---------------------------------------------------------------- Anlegen */
const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  note: z.string().trim().max(1000).optional(),
  dueDate: dateOnly.nullable().optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  caseId: z.number().int().positive().nullable().optional(),
});

router.post(
  '/',
  wrap(async (req, res) => {
    const d = parseBody(createSchema, req, res);
    if (!d) return;
    let c = null;
    if (d.caseId) {
      c = getCase(d.caseId);
      if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
      const n = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE case_id = ?').get(c.id).n;
      if (n >= MAX_TASKS_PER_CASE) return res.status(400).json({ error: `Pro Akte sind höchstens ${MAX_TASKS_PER_CASE} Aufgaben möglich.` });
    }
    // Ohne Angabe: zuständiger Anwalt der Akte, sonst die anlegende Person.
    const assigneeId = d.assignedTo === undefined ? (c && c.lawyer_id) || req.user.id : d.assignedTo;
    let assignee = null;
    if (assigneeId) {
      assignee = activeStaff(assigneeId);
      if (!assignee) return res.status(400).json({ error: 'Die zuständige Person ist kein aktives Teammitglied.' });
    }
    const info = db
      .prepare('INSERT INTO tasks (case_id, title, note, due_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c ? c.id : null, d.title, d.note || '', d.dueDate || null, assigneeId || null, req.user.id);
    touchCase(c && c.id);
    const task = getTask(Number(info.lastInsertRowid));
    notifyAssigned(task, assignee, req.user);
    res.status(201).json({ task: taskRow(task) });
  })
);

/** Übernimmt die Checkliste des Rechtsgebiets als Aufgaben (bereits vorhandene Titel werden übersprungen). */
router.post(
  '/checklist',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ caseId: z.number().int().positive() }), req, res);
    if (!d) return;
    const c = getCase(d.caseId);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const template = CHECKLISTS[c.area] || CHECKLISTS.sonstiges;
    const existing = new Set(db.prepare('SELECT title FROM tasks WHERE case_id = ?').all(c.id).map((t) => t.title));
    const titles = template.filter((t) => !existing.has(t));
    const assigneeId = c.lawyer_id && activeStaff(c.lawyer_id) ? c.lawyer_id : req.user.id;
    tx(() => {
      const ins = db.prepare('INSERT INTO tasks (case_id, title, assigned_to, created_by) VALUES (?, ?, ?, ?)');
      titles.forEach((t) => ins.run(c.id, t, assigneeId, req.user.id));
      if (titles.length) touchCase(c.id);
    });
    res.status(201).json({ added: titles.length });
  })
);

/* ---------------------------------------------------------------- Bearbeiten */
const updateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  note: z.string().trim().max(1000).optional(),
  dueDate: dateOnly.nullable().optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  done: z.boolean().optional(),
});

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const t = id && getTask(id);
    if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
    const d = parseBody(updateSchema, req, res);
    if (!d) return;

    const sets = [];
    const values = [];
    const set = (col, v) => {
      sets.push(`${col} = ?`);
      values.push(v);
    };
    if (d.title !== undefined) set('title', d.title);
    if (d.note !== undefined) set('note', d.note);
    if (d.dueDate !== undefined) set('due_date', d.dueDate || null);
    let newAssignee = null;
    if (d.assignedTo !== undefined && d.assignedTo !== t.assigned_to) {
      if (d.assignedTo) {
        newAssignee = activeStaff(d.assignedTo);
        if (!newAssignee) return res.status(400).json({ error: 'Die zuständige Person ist kein aktives Teammitglied.' });
      }
      set('assigned_to', d.assignedTo);
    }
    const toggled = d.done !== undefined && d.done !== !!t.done;
    if (toggled) {
      set('done', d.done ? 1 : 0);
      set('done_at', d.done ? new Date().toISOString() : null);
      set('done_by', d.done ? req.user.id : null);
    }
    if (!sets.length) return res.json({ task: taskRow(t) });

    tx(() => {
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values, t.id);
      if (toggled && t.case_id) {
        addSystemNote(t.case_id, req.user, `${d.done ? 'Aufgabe erledigt' : 'Aufgabe wieder geöffnet'}: ${truncate(d.title || t.title, 160)}`, true);
        touchCase(t.case_id);
      }
    });
    const updated = getTask(t.id);
    notifyAssigned(updated, newAssignee, req.user);
    res.json({ task: taskRow(updated) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const t = id && getTask(id);
    if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
    const allowed = req.user.role === 'admin' || t.created_by === req.user.id || t.assigned_to === req.user.id;
    if (!allowed) return res.status(403).json({ error: 'Nur wer die Aufgabe angelegt hat, die zuständige Person oder die Kanzleileitung kann sie löschen.' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    res.json({ success: true });
  })
);

module.exports = router;
