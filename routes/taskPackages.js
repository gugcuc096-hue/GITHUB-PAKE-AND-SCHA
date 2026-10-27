'use strict';
/*
 * Aufgaben-Pakete je Anlass (z. B. „Festnahme“ → Vollmacht, Akteneinsicht, Haftprüfung):
 *  GET    /api/task-packages              alle Pakete (Team)
 *  POST   /api/task-packages              neues Paket (Board)
 *  PATCH  /api/task-packages/:id          ändern (Board)
 *  DELETE /api/task-packages/:id          löschen (Board)
 *  POST   /api/task-packages/:id/apply    { caseId } – legt die Aufgaben in der Akte an (vorhandene Titel werden übersprungen)
 * Eine Zeile je Aufgabe, optional mit Frist in Tagen nach dem Übernehmen: „Haftprüfung beantragen | 2“.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody, idParam, isBoard, AREAS } = require('../helpers');
const { getCase, caseAccess } = require('../models');

const router = express.Router();
router.use(requireAuth, requireStaff);

const MAX_ITEMS = 30;

/** „Titel | Tage“ je Zeile → [{ title, days }]. */
function parseItems(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const [title, days] = line.split('|').map((x) => x.trim());
      const n = Number(days);
      return title ? { title: title.slice(0, 160), days: days !== undefined && days !== '' && Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : null } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

const row = (r) => ({ id: r.id, name: r.name, area: r.area, itemsText: r.items, items: parseItems(r.items) });

router.get('/', (req, res) => {
  res.json({ packages: db.prepare('SELECT * FROM task_packages ORDER BY area ASC, name ASC').all().map(row) });
});

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  area: z.enum([...AREAS, '']).default(''),
  items: z.string().trim().min(2).max(3000),
});

function requireBoard(req, res) {
  if (isBoard(req.user)) return true;
  res.status(403).json({ error: 'Aufgaben-Pakete pflegt das Board of Partners.' });
  return false;
}

router.post(
  '/',
  wrap(async (req, res) => {
    if (!requireBoard(req, res)) return;
    const d = parseBody(schema, req, res);
    if (!d) return;
    if (!parseItems(d.items).length) return res.status(400).json({ error: 'Bitte mindestens eine Aufgabe eintragen.' });
    if (db.prepare('SELECT COUNT(*) AS n FROM task_packages').get().n >= 40) return res.status(400).json({ error: 'Höchstens 40 Pakete.' });
    const info = db.prepare('INSERT INTO task_packages (name, area, items) VALUES (?, ?, ?)').run(d.name, d.area, d.items);
    res.status(201).json({ package: row(db.prepare('SELECT * FROM task_packages WHERE id = ?').get(Number(info.lastInsertRowid))) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    if (!requireBoard(req, res)) return;
    const id = idParam(req);
    const p = id && db.prepare('SELECT * FROM task_packages WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Paket nicht gefunden.' });
    const d = parseBody(schema.partial(), req, res);
    if (!d) return;
    const items = d.items ?? p.items;
    if (!parseItems(items).length) return res.status(400).json({ error: 'Bitte mindestens eine Aufgabe eintragen.' });
    db.prepare('UPDATE task_packages SET name = ?, area = ?, items = ? WHERE id = ?').run(d.name ?? p.name, d.area ?? p.area, items, p.id);
    res.json({ package: row(db.prepare('SELECT * FROM task_packages WHERE id = ?').get(p.id)) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    if (!requireBoard(req, res)) return;
    const id = idParam(req);
    const r = id ? db.prepare('DELETE FROM task_packages WHERE id = ?').run(id) : { changes: 0 };
    if (!r.changes) return res.status(404).json({ error: 'Paket nicht gefunden.' });
    res.json({ ok: true });
  })
);

const MAX_TASKS_PER_CASE = 60;
router.post(
  '/:id/apply',
  wrap(async (req, res) => {
    const id = idParam(req);
    const p = id && db.prepare('SELECT * FROM task_packages WHERE id = ?').get(id);
    if (!p) return res.status(404).json({ error: 'Paket nicht gefunden.' });
    const d = parseBody(z.object({ caseId: z.number().int().positive() }), req, res);
    if (!d) return;
    const c = getCase(d.caseId);
    const access = c ? caseAccess(c, req.user) : null;
    if (!c || !access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!access.canEdit) return res.status(403).json({ error: 'Nur die zuständigen Anwälte können Aufgaben-Pakete übernehmen.' });
    const existing = new Set(db.prepare('SELECT title FROM tasks WHERE case_id = ?').all(c.id).map((t) => t.title));
    const total = existing.size;
    const items = parseItems(p.items).filter((i) => !existing.has(i.title));
    if (total + items.length > MAX_TASKS_PER_CASE) return res.status(400).json({ error: `Höchstens ${MAX_TASKS_PER_CASE} Aufgaben pro Akte.` });
    const assignee = c.lawyer_id && db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(c.lawyer_id) ? c.lawyer_id : req.user.id;
    const due = (days) => (days == null ? null : new Date(Date.now() + days * 864e5).toISOString().slice(0, 10));
    tx(() => {
      const ins = db.prepare('INSERT INTO tasks (case_id, title, due_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?)');
      items.forEach((i) => ins.run(c.id, i.title, due(i.days), assignee, req.user.id));
      if (items.length) db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
    });
    res.status(201).json({ added: items.length, skipped: parseItems(p.items).length - items.length });
  })
);

module.exports = { router, parseItems };
