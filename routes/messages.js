'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam, truncate } = require('../helpers');
const { MESSAGE_SELECT, messageRow, getCase, caseAccess } = require('../models');
const discord = require('../discord');

const router = express.Router();
router.use(requireAuth);

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Zu viele Nachrichten in kurzer Zeit. Bitte kurz warten.' }),
});

router.get('/', (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'inbox';
  const rows =
    box === 'sent'
      ? db.prepare(`${MESSAGE_SELECT} WHERE m.sender_id = ? AND m.sender_deleted = 0 ORDER BY m.created_at DESC, m.id DESC LIMIT 300`).all(req.user.id)
      : db.prepare(`${MESSAGE_SELECT} WHERE m.recipient_id = ? AND m.recipient_deleted = 0 ORDER BY m.created_at DESC, m.id DESC LIMIT 300`).all(req.user.id);
  res.json({ box, messages: rows.map(messageRow) });
});

router.get('/unread-count', (req, res) => {
  const n = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND is_read = 0 AND recipient_deleted = 0')
    .get(req.user.id).n;
  res.json({ unread: n });
});

// Mandanten schreiben nur an die Kanzlei; das Team an alle aktiven Nutzer.
router.get('/contacts', (req, res) => {
  const rows =
    req.user.role === 'mandant'
      ? db
          .prepare("SELECT id, display_name AS displayName, role, rank FROM users WHERE role IN ('anwalt','admin') AND active = 1 ORDER BY display_name")
          .all()
      : db
          .prepare(
            `SELECT id, display_name AS displayName, role, rank FROM users WHERE id != ? AND active = 1
             ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'anwalt' THEN 1 ELSE 2 END, display_name`
          )
          .all(req.user.id);
  res.json({ contacts: rows });
});

const createSchema = z.object({
  recipientId: z.number().int().positive().optional(),
  broadcast: z.boolean().optional(),
  subject: z.string().trim().max(150).optional(),
  body: z.string().trim().min(1).max(5000),
  caseId: z.number().int().positive().nullable().optional(),
  priority: z.boolean().optional(),
});

router.post(
  '/',
  messageLimiter,
  wrap(async (req, res) => {
    const u = req.user;
    const d = parseBody(createSchema, req, res);
    if (!d) return;

    let recipients;
    if (d.broadcast) {
      if (!isStaff(u)) return res.status(403).json({ error: 'Rundschreiben kann nur das Team versenden.' });
      recipients = db.prepare("SELECT id FROM users WHERE role IN ('anwalt','admin') AND active = 1 AND id != ?").all(u.id).map((r) => r.id);
      if (!recipients.length) return res.status(400).json({ error: 'Es gibt keine weiteren aktiven Teammitglieder.' });
    } else {
      if (!d.recipientId) return res.status(400).json({ error: 'Bitte einen Empfänger auswählen.' });
      const recipient = db.prepare('SELECT * FROM users WHERE id = ?').get(d.recipientId);
      if (!recipient || !recipient.active) return res.status(404).json({ error: 'Empfänger nicht gefunden.' });
      if (recipient.id === u.id) return res.status(400).json({ error: 'Sie können sich nicht selbst eine Nachricht senden.' });
      if (u.role === 'mandant' && !isStaff(recipient)) return res.status(403).json({ error: 'Als Mandant können Sie nur an die Kanzlei schreiben.' });
      recipients = [recipient.id];
    }

    let caseId = null;
    if (d.caseId) {
      const c = getCase(d.caseId);
      if (c && caseAccess(c, u).canView) caseId = c.id;
    }

    const subject = (d.subject || '').trim();
    const ids = tx(() => {
      const insert = db.prepare(
        'INSERT INTO messages (sender_id, recipient_id, case_id, subject, body, priority) VALUES (?, ?, ?, ?, ?, ?)'
      );
      return recipients.map((rid) => Number(insert.run(u.id, rid, caseId, subject, d.body, d.priority ? 1 : 0).lastInsertRowid));
    });

    if (d.broadcast) {
      discord.notify('message.broadcast', {
        title: `📢 Rundschreiben: ${truncate(subject || 'Ohne Betreff', 200)}`,
        description: truncate(d.body, 600),
        fields: [{ name: 'Von', value: u.display_name }],
      });
    }

    const first = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(ids[0]);
    res.status(201).json({ message: messageRow(first), sent: ids.length });
  })
);

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE messages SET is_read = 1 WHERE recipient_id = ? AND is_read = 0').run(req.user.id);
  res.json({ success: true });
});

// Nur der Empfänger markiert als gelesen/ungelesen.
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!m || m.recipient_id !== req.user.id) return res.status(404).json({ error: 'Nachricht nicht gefunden.' });
    const d = parseBody(z.object({ isRead: z.boolean() }), req, res);
    if (!d) return;
    db.prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(d.isRead ? 1 : 0, m.id);
    res.json({ success: true });
  })
);

// Löschen wirkt nur für die eigene Seite; sind beide Seiten gelöscht, wird die Nachricht entfernt.
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const m = id && db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    const uid = req.user.id;
    if (!m || (m.recipient_id !== uid && m.sender_id !== uid)) return res.status(404).json({ error: 'Nachricht nicht gefunden.' });
    tx(() => {
      if (m.recipient_id === uid) db.prepare('UPDATE messages SET recipient_deleted = 1, is_read = 1 WHERE id = ?').run(m.id);
      if (m.sender_id === uid) db.prepare('UPDATE messages SET sender_deleted = 1 WHERE id = ?').run(m.id);
      db.prepare('DELETE FROM messages WHERE id = ? AND recipient_deleted = 1 AND (sender_deleted = 1 OR sender_id IS NULL)').run(m.id);
    });
    res.json({ success: true });
  })
);

module.exports = router;
