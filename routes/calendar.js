'use strict';
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, parseBody, idParam, isoDateTime, EVENT_TYPES, truncate } = require('../helpers');
const { getCase, caseAccess, APPT_SELECT, getAppointment, apptVisible, apptRow } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');

const router = express.Router();
router.use(requireAuth);

const TYPE_ICON = { mandant: '🤝', gericht: '⚖️', frist: '⏳', intern: '📌' };

/** Termin/Frist einer Akte im Discord-Ticket melden – nur, wenn der Mandant ihn auch sieht. */
function ticketAppointment(a, title, { by, mention = 'client', note } = {}) {
  if (!a || !a.case_id || !a.client_visible) return;
  tickets.post(a.case_id, {
    event: /Erinnerung/.test(title) ? 'reminder' : /erledigt/.test(title) ? 'deadlineDone' : 'appointment',
    title: `${title}: ${truncate(a.title, 180)}`,
    description: note,
    color: a.status === 'abgesagt' ? tickets.COLORS.slate : tickets.COLORS.blue,
    fields: [
      { name: 'Art', value: EVENT_TYPES[a.type] || a.type },
      { name: a.type === 'frist' ? 'Fällig' : 'Wann', value: fmtDiscordTime(a.starts_at), inline: false },
      ...(a.location ? [{ name: 'Ort', value: a.location }] : []),
    ],
    mention,
    by: by ? by.display_name : undefined,
    byDiscordId: by ? by.discord_id : undefined,
  });
}

// Discord rendert <t:…> automatisch in der Zeitzone jedes Lesers.
const fmtDiscordTime = (iso) => discord.discordTime(iso, 'F');

router.get('/', (req, res) => {
  const u = req.user;
  const rows = isStaff(u)
    ? db.prepare(`${APPT_SELECT} ORDER BY a.starts_at ASC`).all()
    : db
        .prepare(`${APPT_SELECT} WHERE a.client_visible = 1 AND (a.client_id = ? OR c.client_id = ?) ORDER BY a.starts_at ASC`)
        .all(u.id, u.id);
  res.json({ events: rows.map((a) => apptRow(a, u)) });
});

const createSchema = z.object({
  type: z.enum(Object.keys(EVENT_TYPES)).default('mandant'),
  title: z.string().trim().min(2).max(120),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().optional(),
  location: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  caseId: z.number().int().positive().nullable().optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  clientVisible: z.boolean().optional(),
});

router.post(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    const d = parseBody(createSchema, req, res);
    if (!d) return;
    const startsAt = new Date(d.startsAt).toISOString();
    const endsAt = d.endsAt ? new Date(d.endsAt).toISOString() : null;
    if (endsAt && endsAt < startsAt) return res.status(400).json({ error: 'Das Ende darf nicht vor dem Beginn liegen.' });

    let c = null;
    if (d.caseId) {
      c = getCase(d.caseId);
      if (!c || !caseAccess(c, u).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    }

    let row;
    if (u.role === 'mandant') {
      // Mandanten stellen Terminanfragen, die die Kanzlei bestätigt.
      if (new Date(startsAt) < new Date()) return res.status(400).json({ error: 'Bitte einen Termin in der Zukunft wählen.' });
      row = {
        type: 'mandant',
        status: 'angefragt',
        clientId: u.id,
        assignedTo: c ? c.lawyer_id : null,
        clientVisible: 1,
        location: d.location || 'Kanzlei Würfelpark',
      };
    } else {
      let assignedTo = d.assignedTo === undefined ? u.id : d.assignedTo;
      if (assignedTo) {
        const a = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin')").get(assignedTo);
        if (!a) return res.status(400).json({ error: 'Die zuständige Person existiert nicht.' });
      }
      row = {
        type: d.type,
        status: 'bestaetigt',
        clientId: c ? c.client_id : null,
        assignedTo,
        clientVisible: (d.clientVisible ?? ['mandant', 'gericht'].includes(d.type)) ? 1 : 0,
        location: d.location ?? (d.type === 'frist' ? '' : 'Kanzlei Würfelpark'),
      };
    }

    const info = db
      .prepare(
        `INSERT INTO appointments (case_id, client_id, type, title, starts_at, ends_at, location, note, status, assigned_to, created_by, client_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(c ? c.id : null, row.clientId, row.type, d.title, startsAt, endsAt, row.location, d.note || '', row.status, row.assignedTo, u.id, row.clientVisible);

    const a = getAppointment(Number(info.lastInsertRowid));
    if (u.role === 'mandant') ticketAppointment(a, '📅 Terminanfrage des Mandanten', { by: u, mention: 'lawyers' });
    else ticketAppointment(a, a.status === 'angefragt' ? '📅 Terminvorschlag' : a.type === 'frist' ? '⏳ Neue Frist' : '📅 Neuer Termin', { by: u });
    if (u.role === 'mandant') {
      discord.notify('appointment.requested', {
        title: `${TYPE_ICON.mandant} Terminanfrage: ${a.title}`,
        description: `${u.display_name} bittet um einen Termin.`,
        fields: [
          { name: 'Wunschtermin', value: fmtDiscordTime(a.starts_at), inline: false },
          { name: 'Akte', value: a.case_number || 'Allgemeine Beratung' },
          { name: 'Ort', value: a.location || '—' },
        ],
        mentionIds: a.assigned_discord_id ? [a.assigned_discord_id] : [],
      });
    } else if (a.type === 'gericht' || a.type === 'frist') {
      discord.notify('calendar.created', {
        title: `${TYPE_ICON[a.type]} ${EVENT_TYPES[a.type]}: ${truncate(a.title, 200)}`,
        fields: [
          { name: a.type === 'frist' ? 'Fällig' : 'Beginn', value: fmtDiscordTime(a.starts_at), inline: false },
          { name: 'Akte', value: a.case_number || '—' },
          { name: 'Zuständig', value: a.assigned_name || '—' },
          { name: 'Ort', value: a.location || '—' },
        ],
        mentionIds: a.assigned_discord_id && a.assigned_to !== u.id ? [a.assigned_discord_id] : [],
      });
    }
    require('../googleDocs').touchExtract(a.case_id); // Termine stehen im Aktenauszug
    res.status(201).json({ event: apptRow(a, u) });
  })
);

const updateSchema = createSchema.partial().extend({
  status: z.enum(['angefragt', 'bestaetigt', 'abgesagt', 'erledigt']).optional(),
});

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const a = id && getAppointment(id);
    if (!a || !apptVisible(a, u)) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    const d = parseBody(updateSchema, req, res);
    if (!d) return;

    if (!isStaff(u)) {
      // Mandanten dürfen eigene Termine nur absagen.
      const onlyCancel = Object.keys(d).length === 1 && d.status === 'abgesagt';
      if (!onlyCancel || a.client_id !== u.id) return res.status(403).json({ error: 'Termine kann nur die Kanzlei ändern. Sie können Ihren Termin absagen.' });
      db.prepare("UPDATE appointments SET status = 'abgesagt' WHERE id = ?").run(a.id);
      ticketAppointment(getAppointment(a.id), '❌ Termin vom Mandanten abgesagt', { by: u, mention: 'lawyers' });
      return res.json({ event: apptRow(getAppointment(a.id), u) });
    }

    const sets = [];
    const values = [];
    const set = (col, val) => {
      sets.push(`${col} = ?`);
      values.push(val);
    };
    if (d.type !== undefined) set('type', d.type);
    if (d.title !== undefined) set('title', d.title);
    if (d.startsAt !== undefined) {
      set('starts_at', new Date(d.startsAt).toISOString());
      set('reminded', 0);
      set('client_reminded', 0);
    }
    if (d.endsAt !== undefined) set('ends_at', d.endsAt ? new Date(d.endsAt).toISOString() : null);
    if (d.location !== undefined) set('location', d.location);
    if (d.note !== undefined) set('note', d.note);
    if (d.status !== undefined) set('status', d.status);
    if (d.clientVisible !== undefined) set('client_visible', d.clientVisible ? 1 : 0);
    if (d.assignedTo !== undefined) {
      if (d.assignedTo) {
        const person = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin')").get(d.assignedTo);
        if (!person) return res.status(400).json({ error: 'Die zuständige Person existiert nicht.' });
      }
      set('assigned_to', d.assignedTo);
    }
    if (d.caseId !== undefined) {
      if (d.caseId) {
        const c = getCase(d.caseId);
        if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
        set('case_id', c.id);
        set('client_id', c.client_id);
      } else {
        set('case_id', null);
      }
    }
    if (!sets.length) return res.json({ event: apptRow(a, u) });

    db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`).run(...values, a.id);
    const updated = getAppointment(a.id);
    if (updated.ends_at && updated.ends_at < updated.starts_at) {
      db.prepare('UPDATE appointments SET ends_at = NULL WHERE id = ?').run(a.id);
    }
    // Ticket: bestätigt / abgesagt / erledigt / verlegt oder neu für den Mandanten sichtbar
    const becameVisible = updated.client_visible && (!a.client_visible || updated.case_id !== a.case_id);
    const moved = updated.starts_at !== a.starts_at;
    if (becameVisible) ticketAppointment(updated, updated.type === 'frist' ? '⏳ Neue Frist' : '📅 Neuer Termin', { by: u });
    else if (updated.status !== a.status) {
      const label = { bestaetigt: '✅ Termin bestätigt', abgesagt: '❌ Termin abgesagt', erledigt: '✔️ Termin erledigt', angefragt: '📅 Termin wieder offen' }[updated.status];
      if (label) ticketAppointment(updated, updated.type === 'frist' && updated.status === 'erledigt' ? '✔️ Frist erledigt' : label, { by: u });
    } else if (moved) ticketAppointment(updated, updated.type === 'frist' ? '⏳ Frist geändert' : '🔁 Termin verlegt', { by: u });
    const gdocs = require('../googleDocs');
    gdocs.touchExtract(updated.case_id);
    if (a.case_id !== updated.case_id) gdocs.touchExtract(a.case_id);
    res.json({ event: apptRow(getAppointment(a.id), u) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const a = id && getAppointment(id);
    if (!a || !isStaff(u)) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    if (u.role !== 'admin' && a.created_by !== u.id && a.assigned_to !== u.id) {
      return res.status(403).json({ error: 'Nur Ersteller, Zuständige oder das Board of Partners können diesen Eintrag löschen.' });
    }
    db.prepare('DELETE FROM appointments WHERE id = ?').run(a.id);
    require('../googleDocs').touchExtract(a.case_id);
    res.json({ success: true });
  })
);

/**
 * Wird vom Server alle paar Minuten aufgerufen: erinnert per Discord an
 * Fristen und Gerichtstermine, die in den nächsten 24 Stunden anstehen.
 */
function sendDueReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const due = db
    .prepare(
      `${APPT_SELECT}
       WHERE a.type IN ('frist','gericht') AND a.status = 'bestaetigt' AND a.reminded = 0
         AND a.starts_at > ? AND a.starts_at <= ?`
    )
    .all(now.toISOString(), soon.toISOString());
  for (const a of due) {
    db.prepare('UPDATE appointments SET reminded = 1 WHERE id = ?').run(a.id);
    ticketAppointment(a, `⏰ Erinnerung – ${EVENT_TYPES[a.type]} in weniger als 24 Stunden`);
    discord.notify('calendar.reminder', {
      title: `⏰ Erinnerung – ${EVENT_TYPES[a.type]}: ${truncate(a.title, 200)}`,
      color: discord.RED,
      fields: [
        { name: a.type === 'frist' ? 'Fällig' : 'Beginn', value: fmtDiscordTime(a.starts_at), inline: false },
        { name: 'Akte', value: a.case_number || '—' },
        { name: 'Zuständig', value: a.assigned_name || '—' },
      ],
      mentionIds: a.assigned_discord_id ? [a.assigned_discord_id] : [],
    });
  }
}

/**
 * Mandanten an ihren bestätigten Termin erinnern: per Discord-Direktnachricht etwa 1 Stunde vorher
 * (nicht, wenn der Termin selbst erst kurz vorher vereinbart wurde).
 */
const CLIENT_REMIND_MIN = 60;
function sendClientReminders() {
  const now = Date.now();
  const due = db
    .prepare(
      `${APPT_SELECT}
       WHERE a.type = 'mandant' AND a.status = 'bestaetigt' AND a.client_visible = 1 AND a.client_reminded = 0 AND a.case_id IS NOT NULL
         AND a.starts_at > ? AND a.starts_at <= ?`
    )
    .all(new Date(now).toISOString(), new Date(now + CLIENT_REMIND_MIN * 60000).toISOString());
  for (const a of due) {
    db.prepare('UPDATE appointments SET client_reminded = 1 WHERE id = ?').run(a.id);
    const created = Date.parse(String(a.created_at || '').replace(' ', 'T') + 'Z');
    if (created && Date.parse(a.starts_at) - created < CLIENT_REMIND_MIN * 60000) continue;
    tickets
      .dmClient(a.case_id, {
        title: `⏰ Erinnerung: ${truncate(a.title, 200)}`,
        description: 'Ihr Termin bei Pake & Scha beginnt bald. Bitte seien Sie pünktlich – falls etwas dazwischenkommt, sagen Sie den Termin im Mandantenportal ab.',
        fields: [{ name: 'Wann', value: fmtDiscordTime(a.starts_at), inline: false }, ...(a.location ? [{ name: 'Ort', value: a.location }] : [])],
        color: tickets.COLORS.blue,
      })
      .catch((err) => console.warn('Terminerinnerung an Mandanten fehlgeschlagen:', err.message));
  }
}

module.exports = router;
module.exports.sendDueReminders = () => {
  sendDueReminders();
  sendClientReminders();
};
