'use strict';
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const evidence = require('../evidence');
const { editConflicts } = require('../helpers');
const { db, tx, nextCaseNumber, randomPin, getSetting } = require('../db');
const { requireAuth, requireAdmin, isStaff, findUserByLogin } = require('../auth');
const {
  wrap,
  parseBody,
  isoDateTime,
  idParam,
  AREAS,
  URGENCIES,
  URGENCY_LABEL,
  PRIORITIES,
  PRIORITY_DISCORD,
  PRIORITY_FROM_URGENCY,
  CASE_STATUS,
  OUTCOMES,
  STEPS,
  truncate,
  MAX_ATTACHMENTS_PER_CASE,
  isBoard,
} = require('../helpers');
const {
  CASE_SELECT,
  getCase,
  caseAccess,
  syncCaseWork,
  caseLawyers,
  coLawyersOf,
  caseRow,
  noteRow,
  addSystemNote,
  APPT_SELECT,
  apptVisible,
  apptRow,
  INVOICE_SELECT,
  invoiceRow,
  attachmentRow,
  externalDocsForCase,
  TASK_SELECT,
  taskRow,
  logActivity,
} = require('../models');
const features = require('../features');
const areas = require('../areas');
const discord = require('../discord');
const tickets = require('../tickets');
const reviewRequest = require('../reviewRequest');
const trash = require('../trash');
const caseChat = require('../caseChat');
const { contractsForCase } = require('./contracts');
const { workForCase } = require('./work');
const { imageBody, saveImage, removeFile, evidencePath } = require('../uploads');

const router = express.Router();
router.use(requireAuth);

const MAX_CO_LAWYERS = 10;

/** „Anna Pake (federführend), Ben Scha“ – für Discord und Verlauf. */
function lawyerNames(c) {
  const all = caseLawyers(c);
  if (!all.length) return 'Noch nicht zugewiesen';
  return all.map((l) => (l.lead && all.length > 1 ? `${l.name} (federführend)` : l.name)).join(', ');
}

/** Discord-IDs der zuständigen Anwälte – ohne die Person, die gerade handelt. */
function lawyerMentions(c, user, onlyIds = null) {
  return caseLawyers(c)
    .filter((l) => l.discordId && (!user || l.id !== user.id) && (!onlyIds || onlyIds.includes(l.id)))
    .map((l) => l.discordId);
}

/** Aktive Anwälte/Board of Partners zu den IDs; unbekannte oder deaktivierte IDs werden gemeldet. */
function activeLawyers(ids) {
  if (!ids.length) return { found: [], missing: [] };
  const rows = db
    .prepare(`SELECT id, display_name FROM users WHERE role IN ('anwalt','admin') AND active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  return { found: rows, missing: ids.filter((id) => !rows.some((r) => r.id === id)) };
}

function notifyCreated(c, user) {
  discord.notify('case.created', {
    title: `Neue Akte ${c.case_number}`,
    description: truncate(c.title, 300),
    color: c.priority >= 4 ? discord.RED : discord.GOLD,
    fields: [
      { name: 'Mandant', value: c.client_account_name || c.client_name || '—' },
      // Team-Kanal (nur Kanzlei): Priorität + was der Mandant angegeben hat
      { name: 'Priorität', value: PRIORITY_DISCORD[c.priority] || PRIORITY_DISCORD[2] },
      // Angabe des Mandanten nur, wenn er mehr als „Normal“ gewählt hat (von der Kanzlei angelegte Akten: nie)
      c.urgency !== 'normal' ? { name: 'Dringlichkeit (Angabe Mandant)', value: URGENCY_LABEL[c.urgency] || c.urgency } : null,
      { name: 'Zuständig', value: lawyerNames(c) },
      { name: 'Angelegt von', value: user ? user.display_name : 'Website-Formular' },
      require('./clients').flagField(c), // Kanzlei-Kanal, nie ins Ticket
    ],
    mentionIds: lawyerMentions(c, user),
  });
}

/** Neu zugewiesene Anwälte in Discord anpingen (Ereignis „case.assigned“). */
function notifyAssigned(c, user, newIds) {
  if (!newIds.length) return;
  const names = caseLawyers(c)
    .filter((l) => newIds.includes(l.id))
    .map((l) => l.name)
    .join(', ');
  discord.notify('case.assigned', {
    title: `${c.case_number}: ${newIds.length === 1 ? 'Anwalt' : 'Anwälte'} zugewiesen`,
    description: truncate(c.title, 300),
    fields: [
      { name: 'Neu zugewiesen', value: names },
      { name: 'Zuständig insgesamt', value: lawyerNames(c) },
      { name: 'Zugewiesen von', value: user.display_name },
    ],
    mentionIds: lawyerMentions(c, user, newIds),
  });
}

/**
 * Übergabe an einen neuen federführenden Anwalt: Die Übergabe-Notiz steht intern im Verlauf und kommt per Discord-DM
 * beim neuen Anwalt an (mit Stand und Link). Der Mandant bekommt im Chat (und im Ticket) nur, wer jetzt sein
 * Ansprechpartner ist.
 */
function handover(c, by, leadId, text) {
  const lead = db.prepare('SELECT id, display_name, rank, discord_id FROM users WHERE id = ?').get(leadId);
  if (!lead) return;
  if (text) addSystemNote(c.id, by, `Übergabe an ${lead.display_name}: ${text}`, true);
  const msg = `Ihr neuer Ansprechpartner in dieser Sache ist ${lead.display_name}${lead.rank ? ` (${lead.rank})` : ''}. Sie erreichen die Kanzlei wie gewohnt hier im Chat.`;
  const noteId = Number(
    db.prepare('INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal) VALUES (?, ?, ?, ?, ?, 0)').run(c.id, by.id, by.display_name, by.role, msg).lastInsertRowid
  );
  caseChat.markRead(c.id, by.id, noteId);
  tickets.post(c.id, { event: 'chat', title: `💬 Nachricht von ${by.display_name}`, description: msg, color: tickets.COLORS.gold, mention: 'client', by: by.rank || 'Pake & Scha', byDiscordId: by.discord_id });
  if (lead.id === by.id || !tickets.hasToken() || !tickets.isId(lead.discord_id)) return;
  const base = tickets.siteBase();
  (async () => {
    const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: lead.discord_id });
    await tickets.rest('POST', `/channels/${ch.id}/messages`, {
      embeds: [
        tickets.embed({
          title: `📁 Akte übergeben: ${c.case_number}`,
          description: `${by.display_name} hat Ihnen die Akte „${truncate(c.title, 200)}“ übergeben – Sie sind jetzt federführend.`,
          fields: [
            { name: 'Übergabe', value: truncate(text || '– (keine Notiz)', 1000), inline: false },
            { name: 'Mandant', value: c.client_name || '–' },
            { name: 'Stand', value: c.status === 'geschlossen' ? 'Abgeschlossen' : areas.stepsOf(c.area)[c.step] || STEPS[0] },
          ],
        }),
      ],
      components: base ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Akte öffnen', url: `${base}/dashboard?case=${c.id}#cases` }] }] : undefined,
      allowed_mentions: { parse: [] },
    });
  })().catch(() => {});
}

/* ---------------------------------------------------------------- Liste */
router.get('/', (req, res) => {
  const u = req.user;
  const rows = isStaff(u)
    ? db.prepare(`${CASE_SELECT} ORDER BY c.updated_at DESC`).all()
    : db.prepare(`${CASE_SELECT} WHERE c.client_id = ? ORDER BY c.updated_at DESC`).all(u.id);
  const unread = caseChat.unreadFor(u).cases;
  const stars = starredIds(u.id);
  // Liste ohne Sachverhalt (steht in der Akte selbst) – bei vielen Akten deutlich weniger zu laden
  res.json({ cases: rows.map((c) => ({ ...caseRow(c, u), description: undefined, chatUnread: unread[c.id] || 0, starred: stars.has(c.id) })) });
});

/* ---------------------------------------------------------------- Nachrichten (Chat Kanzlei ↔ Mandant) */
/** Neue Nachrichten der Gegenseite (Badges in Navigation und Aktenliste). */
router.get('/chat-unread', (req, res) => {
  res.json(caseChat.unreadFor(req.user));
});

/** Nachrichten nach ?after= (regelmäßiges Nachladen im offenen Chat) und der Lesestand der Gegenseite. */
router.get('/:id/chat', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  // ?before=ID&limit=N: ältere Nachrichten („Ältere laden“); sonst alle neueren nach ?after=
  if (req.query.before !== undefined) {
    const before = Math.max(0, Number(req.query.before) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    return res.json({ ...caseChat.page(c.id, { before, limit }), read: caseChat.readState(c, req.user) });
  }
  const after = Math.max(0, Number(req.query.after) || 0);
  res.json({ messages: caseChat.messages(c.id, after), read: caseChat.readState(c, req.user) });
});

/** Gelesen bis lastId. */
router.post('/:id/chat/read', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  const d = parseBody(z.object({ lastId: z.number().int().min(0) }), req, res);
  if (!d) return;
  // nie über die letzte vorhandene Nachricht hinaus
  const max = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM notes WHERE case_id = ? AND internal = 0 AND system = 0').get(c.id).m;
  caseChat.markRead(c.id, req.user.id, Math.min(d.lastId, max));
  res.json({ success: true });
});

/* ---------------------------------------------------------------- Anlegen */
const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  area: areas.activeKeySchema,
  urgency: z.enum(URGENCIES).default('normal'),
  description: z.string().trim().max(4000).default(''),
  answers: z.record(z.any()).optional(), // Antworten auf die Zusatzfelder des Rechtsgebiets
  clientEmail: z.string().trim().max(120).optional(), // Login-Adresse, Teil vor dem @ oder frühere Adresse
  clientName: z.string().trim().max(80).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  opponent: z.string().trim().max(120).optional(),
  courtRef: z.string().trim().max(60).optional(),
  lawyerId: z.number().int().positive().nullable().optional(),
  coLawyerIds: z.array(z.number().int().positive()).max(MAX_CO_LAWYERS).optional(),
  priority: z.number().int().min(1).max(4).optional(), // nur Kanzlei; sonst aus der Dringlichkeit
});

router.post(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    const d = parseBody(createSchema, req, res);
    if (!d) return;

    let clientId = null;
    let clientName = '';
    let lawyerId = null;
    let coIds = [];
    let source = 'portal';

    if (u.role === 'mandant') {
      if (d.description.length < 10) return res.status(400).json({ error: 'Bitte beschreiben Sie den Sachverhalt etwas ausführlicher (mind. 10 Zeichen).' });
      clientId = u.id;
    } else {
      source = 'kanzlei';
      if (d.clientEmail) {
        const client = findUserByLogin(d.clientEmail);
        if (!client) return res.status(404).json({ error: 'Kein Konto mit dieser E-Mail-Adresse gefunden. Lassen Sie das Feld leer und tragen Sie nur den Namen ein.' });
        clientId = client.id;
      } else if (!d.clientName || d.clientName.length < 2) {
        return res.status(400).json({ error: 'Bitte den Namen des Mandanten angeben.' });
      }
      clientName = d.clientName || '';
      lawyerId = u.id;
      if (d.lawyerId !== undefined && u.role === 'admin') {
        if (d.lawyerId !== null) {
          const lawyer = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(d.lawyerId);
          if (!lawyer) return res.status(400).json({ error: 'Der gewählte Anwalt existiert nicht.' });
        }
        lawyerId = d.lawyerId;
      }
      // Weitere Anwälte: wer die Akte anlegt, ist federführend (oder das Board of Partners weist zu).
      coIds = [...new Set(d.coLawyerIds || [])];
      const { missing } = activeLawyers(coIds);
      if (missing.length) return res.status(400).json({ error: 'Mindestens ein gewählter Anwalt existiert nicht oder ist deaktiviert.' });
      if (!lawyerId && coIds.length) lawyerId = coIds.shift(); // ohne Federführung übernimmt der erste
      coIds = coIds.filter((cid) => cid !== lawyerId);
    }

    // Zusatzfelder des Rechtsgebiets: von Mandanten Pflicht, wo so eingestellt; die Kanzlei darf Lücken lassen
    const checked = areas.checkAnswers(d.area, d.answers, { enforceRequired: u.role === 'mandant' });
    if (checked.error) return res.status(400).json({ error: checked.error });

    const id = tx(() => {
      const info = db
        .prepare(
          `INSERT INTO cases (case_number, access_pin, title, area, urgency, priority, description, client_id, client_name, client_phone,
                              opponent, court_ref, lawyer_id, status, source, intake_answers)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          nextCaseNumber(),
          randomPin(),
          d.title,
          d.area,
          d.urgency,
          (isStaff(u) && d.priority) || PRIORITY_FROM_URGENCY[d.urgency] || 2,
          d.description,
          clientId,
          clientName,
          d.clientPhone || '',
          d.opponent || '',
          d.courtRef || '',
          lawyerId,
          lawyerId ? 'in_bearbeitung' : 'offen',
          source,
          Object.keys(checked.answers).length ? JSON.stringify(checked.answers) : null
        );
      const newId = Number(info.lastInsertRowid);
      const addCo = db.prepare('INSERT INTO case_lawyers (case_id, user_id, added_by) VALUES (?, ?, ?)');
      coIds.forEach((cid) => addCo.run(newId, cid, u.id));
      addSystemNote(newId, u, 'Akte angelegt.');
      syncCaseWork(newId);
      return newId;
    });

    const c = getCase(id);
    notifyCreated(c, u);
    tickets.caseCreated(id);
    require('../discordBot').syncCaseClient(c);
    if (isStaff(u)) logActivity(u, 'Akte angelegt', 'case', id, `${c.case_number} – ${c.title}`);
    res.status(201).json({ case: caseRow(c, u) });
  })
);

/* ---------------------------------------------------------------- Mandanten-Konto nachträglich verknüpfen */
/** Name vergleichbar machen: Kleinbuchstaben, ohne Titel/Satzzeichen, einfache Leerzeichen. */
const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b(dr|prof|jur|med|rer|nat)\.?\s*/g, '')
    .replace(/[^a-z0-9äöüß ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const accountRow = (u, suggested = false) => ({ id: u.id, name: u.display_name, email: u.email, phone: u.phone || '', suggested, createdAt: u.created_at });

/** Mandantenkonten, deren Name zum Namen in der Akte passt (Vorschläge). */
function clientSuggestions(c) {
  const wanted = normName(c.client_name);
  if (!wanted || wanted.length < 3) return [];
  return db
    .prepare("SELECT id, display_name, email, phone, created_at FROM users WHERE role = 'mandant' AND active = 1")
    .all()
    .filter((u) => {
      const n = normName(u.display_name);
      return n && (n === wanted || n.includes(wanted) || wanted.includes(n));
    })
    .slice(0, 5)
    .map((u) => accountRow(u, true));
}

/** Suche nach Mandantenkonten (Name oder E-Mail) – nur Team. Vorschläge zur Akte zuerst. */
router.get('/client-accounts', (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Keine Berechtigung.' });
  const q = String(req.query.q || '').trim().slice(0, 80);
  const c = Number(req.query.caseId) ? getCase(Number(req.query.caseId)) : null;
  const needle = q.toLowerCase();
  const suggestions = (c && !c.client_id ? clientSuggestions(c) : []).filter((a) => !needle || `${a.name} ${a.email}`.toLowerCase().includes(needle));
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const found = db
    .prepare(
      `SELECT id, display_name, email, phone, created_at FROM users
       WHERE role = 'mandant' AND active = 1 AND (? = '' OR display_name LIKE ? OR email LIKE ?)
       ORDER BY created_at DESC LIMIT 25`
    )
    .all(q, like, like)
    .filter((u) => !suggestions.some((x) => x.id === u.id))
    .map((u) => accountRow(u));
  res.json({ accounts: [...suggestions, ...found] });
});

/* ---------------------------------------------------------------- Papierkorb (nur Admins) */
router.get('/trash', requireAdmin, (req, res) => {
  res.json({ items: trash.list(), keepDays: trash.KEEP_DAYS });
});

router.post(
  '/trash/:id/restore',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    if (!id) return res.status(404).json({ error: 'Eintrag nicht im Papierkorb.' });
    const { caseId } = trash.restore(id);
    const c = getCase(caseId);
    // Beim Löschen kam das Ticket ins Archiv (Mandant nur lesend) – beim nächsten Abgleich wieder herrichten
    if (c.discord_channel_id) db.prepare('UPDATE cases SET discord_archived = 1 WHERE id = ?').run(c.id);
    addSystemNote(c.id, req.user, 'Akte aus dem Papierkorb wiederhergestellt', true);
    tickets.post(c.id, {
      event: 'restored',
      title: '♻️ Akte wiederhergestellt',
      description: `Die Akte **${c.case_number}** ist wieder da – das Ticket geht wie gewohnt weiter.`,
      color: tickets.COLORS.green,
      by: req.user.display_name,
      byDiscordId: req.user.discord_id,
    });
    logActivity(req.user, 'Akte wiederhergestellt', 'case', c.id, `${c.case_number} – ${c.title}`);
    const updated = getCase(c.id);
    res.json({ case: { ...caseRow(updated, req.user), ...caseAccess(updated, req.user) } });
  })
);

router.delete(
  '/trash/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const t = trash.get(idParam(req));
    if (!t) return res.status(404).json({ error: 'Eintrag nicht im Papierkorb.' });
    trash.purge(t.id);
    logActivity(req.user, 'Akte endgültig gelöscht', 'case', t.caseId, `${t.caseNumber} – ${t.title}`);
    res.json({ success: true });
  })
);

/** Mandanten-Konto mit der Akte verknüpfen (clientId) oder die Verknüpfung lösen (null). */
router.put(
  '/:id/client',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, u).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!isStaff(u) || !(caseAccess(c, u).canEdit || isBoard(u))) {
      return res.status(403).json({ error: 'Nur die zuständigen Anwälte und das Board of Partners können den Mandanten verknüpfen.' });
    }
    const d = parseBody(z.object({ clientId: z.number().int().positive().nullable() }), req, res);
    if (!d) return;
    if (d.clientId === c.client_id) return res.json({ case: { ...caseRow(c, u), ...caseAccess(c, u) } });
    let account = null;
    if (d.clientId !== null) {
      account = db.prepare("SELECT id, display_name, email FROM users WHERE id = ? AND role = 'mandant' AND active = 1").get(d.clientId);
      if (!account) return res.status(400).json({ error: 'Das gewählte Konto existiert nicht oder ist kein aktives Mandantenkonto.' });
    }
    const note = account
      ? `Mandanten-Konto verknüpft: ${account.display_name}${c.client_id ? ` (vorher: ${c.client_account_name || '—'})` : ''}`
      : `Verknüpfung mit dem Mandanten-Konto ${c.client_account_name || ''} gelöst`;
    tx(() => {
      // Beim Lösen den Namen in der Akte behalten, damit der Mandant weiter genannt wird.
      if (!account && !c.client_name && c.client_account_name) db.prepare('UPDATE cases SET client_name = ? WHERE id = ?').run(c.client_account_name, c.id);
      db.prepare("UPDATE cases SET client_id = ?, updated_at = datetime('now') WHERE id = ?").run(account ? account.id : null, c.id);
      // Mandanten-Termine der Akte gehören ab jetzt (bzw. nicht mehr) zum Konto
      db.prepare('UPDATE appointments SET client_id = ? WHERE case_id = ? AND client_id IS ?').run(account ? account.id : null, c.id, c.client_id ?? null);
      addSystemNote(c.id, u, note, true); // intern – der (neue) Mandant soll frühere Konten nicht sehen
    });
    logActivity(u, 'Akte geändert', 'case', c.id, `${c.case_number}: ${note}`);
    const updated = getCase(c.id);
    // Rolle „Mandant mit offener Akte“: beim bisherigen und beim neuen Konto angleichen
    require('../discordBot').syncCaseClient(c);
    require('../discordBot').syncCaseClient(updated);
    // Discord-Ticket: Mandant kommt hinein (verknüpftes Discord) bzw. wird entfernt
    if (account) {
      tickets.post(c.id, {
        event: 'account',
        title: '👤 Mandanten-Konto verknüpft',
        description: `Die Akte ist jetzt mit dem Portal-Konto von **${account.display_name}** verbunden – Termine, Verträge, Rechnungen und Nachrichten sieht der Mandant im Mandantenportal.`,
        color: tickets.COLORS.green,
        by: u.display_name,
      });
    } else {
      tickets.syncCase(c.id);
    }
    res.json({ case: { ...caseRow(updated, u), ...caseAccess(updated, u) } });
  })
);

/* ---------------------------------------------------------------- Detail */
/** Akte mit allem, was die Person sehen darf (Dashboard, Aktenauszug, Google Doc des Aktenauszugs). */
const LEAN_CHAT = 40; // Nachrichten, die die offene Akte zuerst lädt
const LEAN_LOG = 60; // Einträge im Verlauf, die die offene Akte zuerst lädt
/**
 * lean: das Dashboard lädt nur die jüngsten Nachrichten und Verlaufseinträge (ältere auf Wunsch) – Aktenauszug und
 * Google Doc bekommen weiterhin alles. all: im Dashboard den ganzen Verlauf laden.
 */
function caseDetail(c, u, { lean = false, all = false } = {}) {
  const access = caseAccess(c, u);
  const staff = isStaff(u);
  let notes = db
    .prepare('SELECT * FROM notes WHERE case_id = ? ORDER BY created_at ASC, id ASC')
    .all(c.id)
    .filter((n) => staff || !n.internal);
  // Dashboard: Nachrichten stehen im Chat (eigene Seite), im Verlauf nur die jüngsten Einträge plus angepinnte Notizen
  let logMore = 0;
  if (lean) {
    const log = notes.filter((n) => n.system || n.internal);
    const keep = new Set(log.slice(all ? 0 : -LEAN_LOG).map((n) => n.id));
    logMore = log.length - keep.size;
    notes = log.filter((n) => keep.has(n.id) || n.pinned);
  }
  const appointments = db
    .prepare(`${APPT_SELECT} WHERE a.case_id = ? ORDER BY a.starts_at ASC`)
    .all(c.id)
    .filter((a) => apptVisible(a, u));
  const invoices = db.prepare(`${INVOICE_SELECT} WHERE i.case_id = ? ORDER BY i.created_at DESC`).all(c.id);
  const attachments = db
    .prepare('SELECT * FROM case_attachments WHERE case_id = ? ORDER BY created_at ASC, id ASC')
    .all(c.id)
    .filter((a) => staff || !a.internal);

  const tasks = staff
    ? db.prepare(`${TASK_SELECT} WHERE t.case_id = ? ORDER BY t.done ASC, t.due_date IS NULL, t.due_date ASC, t.id ASC`).all(c.id)
    : [];
  // Kanzlei: Links der Google Docs – fertige Dokumente öffnen im Dashboard direkt das Doc
  const contracts = contractsForCase(c.id, u);
  const gdocs = staff ? require('../googleDocs') : null;
  const invoiceDocs = gdocs ? gdocs.urls('invoice', invoices.map((i) => i.id)) : new Map();
  const contractDocs = gdocs ? gdocs.urls('contract', contracts.map((k) => k.id)) : new Map();

  const clients = staff ? require('./clients') : null;
  // Dienststatus der zuständigen Anwälte („im Dienst“ in der Akte) – Mandanten nur, wenn er auch öffentlich angezeigt wird
  const teamIds = caseLawyers(c).map((l) => l.id);
  const lawyerDuty =
    teamIds.length && (staff || getSetting('show_duty_public', '1') === '1')
      ? Object.fromEntries(
          db
            .prepare(`SELECT id, duty_status FROM users WHERE active = 1 AND duty_status != 'off' AND id IN (${teamIds.map(() => '?').join(',')})`)
            .all(...teamIds)
            .map((r) => [r.id, r.duty_status])
        )
      : {};
  return {
    case: {
      ...caseRow(c, u),
      ...access,
      lawyerDuty,
      // Kanzlei: Mandantenkartei (Name in der Akte führt dorthin) und Vermerk wie „Nur gegen Vorkasse“
      clientKey: clients ? clients.clientKeyForCase(c) : undefined,
      clientFlag: clients ? clients.flagForCase(c) : undefined,
    },
    notes: notes.map(noteRow),
    appointments: appointments.map((a) => apptRow(a, u)),
    invoices: invoices.map((i) => ({ ...invoiceRow(i), googleDoc: invoiceDocs.get(i.id) })),
    attachments: attachments.map((a) => attachmentRow(a, c.id, staff)),
    externalDocs: externalDocsForCase(c.id, u),
    contracts: contracts.map((k) => ({ ...k, googleDoc: contractDocs.get(k.id) })),
    // Bearbeitungszeiten nur für das Board of Partners
    work: isBoard(u) ? { rows: workForCase(c.id), closedAt: c.closed_at || null } : undefined,
    tasks: staff ? tasks.map(taskRow) : undefined,
    // Nachrichten mit dem Mandanten und Lesestand
    chat: lean ? { ...caseChat.page(c.id, { limit: all ? 100000 : LEAN_CHAT }), read: caseChat.readState(c, u) } : { messages: caseChat.messages(c.id), read: caseChat.readState(c, u) },
    logMore: lean && logMore > 0 ? logMore : undefined,
    ticket: tickets.ticketInfo(c, u),
    // Gesicherte Verläufe gelöschter Tickets (nur Kanzlei)
    transcripts: staff ? require('../transcripts').listForCase(c.id) : undefined,
    // Angebote der Staatsanwaltschaft (Deal-Rechner) – Kanzlei und Mandant
    deals: require('../deals').forCase(c.id),
    // Mandant: eigene Bewertung der (abgeschlossenen) Akte
    review: require('./reviews').reviewForCase(c, u),
    // Kanzlei: Anklagepunkte und Strafmaß (Strafmaß-Rechner)
    charges: staff ? require('./penal').payload(c) : undefined,
    // Team: passende Mandantenkonten, solange die Akte noch keins hat (z. B. Mandant hat sich später registriert)
    clientSuggestions: staff && !c.client_id ? clientSuggestions(c) : undefined,
    // Kanzlei: verknüpfte Akten mit ihren Beweismitteln (gemeinsame Beweismappe) und der Laufzettel der Akte
    links: staff ? linkedCases(c.id) : undefined,
    linkedEvidence: staff ? linkedEvidence(c.id) : undefined,
    routing: staff ? routingSlip(c.id) : undefined,
    // Kanzlei: Beteiligte (Gegenpartei, Zeugen …) und Überschneidungen mit anderen Akten (Interessenkonflikt prüfen)
    // Fehlende Unterlagen: Kanzlei und Mandant sehen dieselbe Liste
    requests: require('../docRequests').listForCase(c.id),
    // Kanzlei: Einschätzung (Strafmaß-Rechner) und tatsächliches Strafmaß – Grundlage des Vergleichs in der Statistik
    sentence: staff
      ? { estimateHe: c.sentence_estimate ?? null, estimateFine: c.sentence_fine ?? null, actualHe: c.sentence_actual_he ?? null, actualFine: c.sentence_actual_fine ?? null }
      : undefined,
    parties: staff ? require('../parties').listForCase(c.id) : undefined,
    // Kanzlei: ähnliche Präzedenzfälle (gleiche Paragraphen/Rechtsgebiet) und der Eintrag zu dieser Akte
    similar: staff ? require('../precedents').similarFor(c) : undefined,
    precedentId: staff ? ((db.prepare('SELECT id FROM precedents WHERE case_id = ?').get(c.id) || {}).id ?? null) : undefined,
    overlaps: staff
      ? (() => {
          const p = require('../parties');
          return { opponent: p.opponentOverlaps(c), client: p.clientOverlaps(c, c.client_account_name || c.client_name) };
        })()
      : undefined,
  };
}

/* ---------------------------------------------------------------- Verknüpfte Akten (nur Kanzlei) */
const linkPair = (a, b) => (a < b ? [a, b] : [b, a]);
function linkedIds(caseId) {
  return db
    .prepare('SELECT b_id AS id FROM case_links WHERE a_id = ? UNION SELECT a_id AS id FROM case_links WHERE b_id = ?')
    .all(caseId, caseId)
    .map((r) => r.id);
}
function linkedCases(caseId) {
  const ids = linkedIds(caseId);
  if (!ids.length) return [];
  return db
    .prepare(
      `SELECT c.id, c.case_number, c.title, c.status, COALESCE(u.display_name, c.client_name) AS client
       FROM cases c LEFT JOIN users u ON u.id = c.client_id WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.created_at ASC`
    )
    .all(...ids)
    .map((r) => ({ id: r.id, caseNumber: r.case_number, title: r.title, status: r.status, clientName: r.client || '—' }));
}
/** Beweismittel der verknüpften Akten – mit ihrer Nummer (B1, B2 …) in der jeweiligen Akte. */
function linkedEvidence(caseId) {
  return linkedCases(caseId)
    .map((k) => ({
      caseId: k.id,
      caseNumber: k.caseNumber,
      clientName: k.clientName,
      attachments: db
        .prepare('SELECT * FROM case_attachments WHERE case_id = ? ORDER BY created_at ASC, id ASC')
        .all(k.id)
        .map((a) => attachmentRow(a, k.id, true)),
    }))
    .filter((k) => k.attachments.length);
}
/** Laufzettel: wer die Akte bearbeitet hat (Einträge im Verlauf), zuletzt zuerst. */
function routingSlip(caseId) {
  return db
    .prepare(
      `SELECT author_name AS name, MAX(created_at) AS last, COUNT(*) AS n FROM notes
       WHERE case_id = ? AND author_role IN ('anwalt', 'admin') AND author_name != '' GROUP BY author_name ORDER BY last DESC LIMIT 8`
    )
    .all(caseId)
    .map((r) => ({ name: r.name, lastAt: r.last, count: r.n }));
}

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const access = caseAccess(c, req.user);
    // Fremde Akten liefern 404 statt 403, damit ihre Existenz nicht verraten wird.
    if (!access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });

    const detail = caseDetail(c, req.user, { lean: req.query.lean === '1', all: req.query.all === '1' });
    detail.case.starred = starredIds(req.user.id).has(c.id);
    res.json(detail);
  })
);

/* ---------------------------------------------------------------- Merkliste (Stern, je Person) */
function starredIds(userId) {
  return new Set(db.prepare('SELECT case_id FROM case_stars WHERE user_id = ?').all(userId).map((r) => r.case_id));
}
router.put('/:id/star', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  const d = parseBody(z.object({ on: z.boolean() }), req, res);
  if (!d) return;
  if (d.on) db.prepare('INSERT OR IGNORE INTO case_stars (user_id, case_id) VALUES (?, ?)').run(req.user.id, c.id);
  else db.prepare('DELETE FROM case_stars WHERE user_id = ? AND case_id = ?').run(req.user.id, c.id);
  res.json({ starred: d.on });
});

/* ---------------------------------------------------------------- Bearbeiten */
const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  area: areas.keySchema.optional(),
  urgency: z.enum(URGENCIES).optional(),
  description: z.string().trim().max(4000).optional(),
  clientName: z.string().trim().max(80).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  opponent: z.string().trim().max(120).optional(),
  courtRef: z.string().trim().max(60).optional(),
  status: z.enum(Object.keys(CASE_STATUS)).optional(),
  step: z.number().int().min(0).max(3).optional(),
  priority: z.number().int().min(1).max(4).optional(), // nur Kanzlei, intern
  outcome: z.enum(Object.keys(OUTCOMES)).optional(), // Ergebnis beim Abschluss – nur Kanzlei, intern
  actualHe: z.number().int().min(0).max(100000).nullable().optional(), // tatsächliches Strafmaß (HE) – nur Kanzlei, intern
  actualFine: z.number().int().min(0).max(100000000).nullable().optional(),
  publicNote: z.string().trim().max(500).optional(),
  lawyerId: z.number().int().positive().nullable().optional(),
  handover: z.string().trim().max(1000).optional(), // Übergabe an den neuen federführenden Anwalt (intern)
  // Vollständige Liste der weiteren Anwälte (ersetzt die bisherige)
  coLawyerIds: z.array(z.number().int().positive()).max(MAX_CO_LAWYERS).optional(),
});

const FIELD_COLUMNS = {
  title: 'title',
  area: 'area',
  urgency: 'urgency',
  description: 'description',
  clientName: 'client_name',
  clientPhone: 'client_phone',
  opponent: 'opponent',
  courtRef: 'court_ref',
  step: 'step',
  publicNote: 'public_note',
};

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const access = caseAccess(c, u);
    if (!access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });

    const d = parseBody(updateSchema, req, res);
    if (!d) return;

    // Gleichzeitiges Bearbeiten: Das Dashboard schickt mit „expect“ die Werte, die es zuletzt sah. Hat inzwischen jemand anderes
    // eines dieser Felder geändert (und nicht auf denselben Wert), antwortet der Server mit 409 – nichts wird überschrieben.
    const clash = editConflicts(req.body && req.body.expect, d, {
      title: c.title,
      area: c.area,
      urgency: c.urgency,
      description: c.description,
      clientName: c.client_name,
      clientPhone: c.client_phone,
      opponent: c.opponent,
      courtRef: c.court_ref,
      step: c.step,
      publicNote: c.public_note,
      status: c.status,
      priority: c.priority || 2,
      lawyerId: c.lawyer_id,
    });
    if (clash.length) return res.status(409).json({ error: 'Jemand hat diese Akte inzwischen geändert.', conflict: clash });

    const sets = [];
    const values = [];
    const history = [];
    let newStatus = d.status;

    // Übernehmen / Abgeben / Zuweisen hat eigene Regeln: Eine unbesetzte Akte
    // darf jedes Teammitglied übernehmen, ohne vorher "canEdit" zu haben.
    const coBefore = coLawyersOf(c).map((l) => l.id);
    let coAfter = coBefore;
    let leadAfter = c.lawyer_id;
    let lawyerChanged = false;
    if (d.lawyerId !== undefined && d.lawyerId !== c.lawyer_id) {
      const isClaim = isStaff(u) && d.lawyerId === u.id && !c.lawyer_id;
      const isRelease = isStaff(u) && d.lawyerId === null && c.lawyer_id === u.id;
      if (u.role !== 'admin' && !isClaim && !isRelease) {
        return res.status(403).json({ error: 'Keine Berechtigung, den federführenden Anwalt zu ändern.' });
      }
      leadAfter = d.lawyerId;
      // Gibt der federführende Anwalt ab, übernimmt der erste (aktive) weitere Anwalt die Federführung.
      if (leadAfter === null && coBefore.length && d.coLawyerIds === undefined) {
        const { found } = activeLawyers(coBefore);
        leadAfter = coBefore.find((id) => found.some((f) => f.id === id)) ?? null;
      }
      if (leadAfter !== null) {
        const lawyer = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(leadAfter);
        if (!lawyer) return res.status(400).json({ error: 'Der gewählte Anwalt existiert nicht.' });
        history.push(isRelease ? `Akte abgegeben – federführend jetzt: ${lawyer.display_name}` : `Federführend: ${lawyer.display_name}`);
      } else {
        history.push('Akte wurde abgegeben (derzeit ohne zuständigen Anwalt).');
      }
      coAfter = coBefore.filter((id) => id !== leadAfter);
      sets.push('lawyer_id = ?');
      values.push(leadAfter);
      lawyerChanged = true;
      if (!newStatus && leadAfter && c.status === 'offen') newStatus = 'in_bearbeitung';
      if (!newStatus && !leadAfter && c.status === 'in_bearbeitung') newStatus = 'offen';
    }

    // Weitere Anwälte: zusammenstellen dürfen das Board of Partners und der federführende Anwalt;
    // ein weiterer Anwalt darf sich selbst austragen.
    let coChanged = false;
    let coAdded = [];
    if (d.coLawyerIds !== undefined) {
      const wanted = [...new Set(d.coLawyerIds)].filter((id) => id !== leadAfter);
      const added = wanted.filter((id) => !coBefore.includes(id));
      const removed = coBefore.filter((id) => !wanted.includes(id) && id !== leadAfter);
      const isLeadNow = isStaff(u) && (c.lawyer_id === u.id || leadAfter === u.id);
      const selfLeave = !added.length && removed.length === 1 && removed[0] === u.id;
      if ((added.length || removed.length) && u.role !== 'admin' && !isLeadNow && !selfLeave) {
        return res.status(403).json({ error: 'Weitere Anwälte kann nur der federführende Anwalt oder das Board of Partners zuweisen.' });
      }
      const { found, missing } = activeLawyers(added);
      if (missing.length) return res.status(400).json({ error: 'Mindestens ein gewählter Anwalt existiert nicht oder ist deaktiviert.' });
      if (added.length || removed.length || coAfter.length !== wanted.length) {
        const nameOf = (id) => found.find((f) => f.id === id)?.display_name || coLawyersOf(c).find((l) => l.id === id)?.name || `#${id}`;
        if (selfLeave) history.push(`${u.display_name} arbeitet nicht mehr an der Akte mit`);
        else if (added.length || removed.length) {
          history.push(
            `Weitere Anwälte: ${[...added.map((id) => '+ ' + nameOf(id)), ...removed.map((id) => '− ' + nameOf(id))].join(', ')}`
          );
        }
        coAfter = wanted;
        coChanged = true;
        coAdded = added;
      }
      if (!leadAfter && coAfter.length) {
        // Ohne Federführung wird der erste weitere Anwalt federführend.
        leadAfter = coAfter[0];
        coAfter = coAfter.slice(1);
        const at = sets.indexOf('lawyer_id = ?');
        if (at >= 0) values[at] = leadAfter;
        else {
          sets.push('lawyer_id = ?');
          values.push(leadAfter);
        }
        lawyerChanged = true;
        const leadName = activeLawyers([leadAfter]).found[0]?.display_name || coLawyersOf(c).find((l) => l.id === leadAfter)?.name || `#${leadAfter}`;
        const gone = history.findIndex((h) => h.startsWith('Akte wurde abgegeben (derzeit'));
        if (gone >= 0) history.splice(gone, 1);
        history.push(`Federführend: ${leadName}`);
        // Die Akte bleibt besetzt – kein automatischer Wechsel auf „offen“.
        if (d.status === undefined) newStatus = c.status === 'offen' ? 'in_bearbeitung' : undefined;
      }
    } else if (lawyerChanged && coAfter.length !== coBefore.length) {
      coChanged = true; // neuer Federführender stand bisher unter den weiteren Anwälten
    }

    const editFields = Object.keys(FIELD_COLUMNS).filter((k) => d[k] !== undefined);
    const wantsEdit = editFields.length > 0 || d.status !== undefined || d.priority !== undefined || d.outcome !== undefined || d.actualHe !== undefined || d.actualFine !== undefined;
    if (d.priority !== undefined && !isStaff(u)) return res.status(403).json({ error: 'Die Priorität legen nur die Anwälte fest.' });
    if (d.outcome !== undefined && !isStaff(u)) return res.status(403).json({ error: 'Das Ergebnis hält die Kanzlei fest.' });
    if ((d.actualHe !== undefined || d.actualFine !== undefined) && !isStaff(u)) return res.status(403).json({ error: 'Das Strafmaß hält die Kanzlei fest.' });
    // Ergebnis: beim Abschließen oder an einer bereits abgeschlossenen Akte (Korrektur)
    if (d.outcome !== undefined && (newStatus || c.status) !== 'geschlossen') {
      return res.status(400).json({ error: 'Das Ergebnis wird beim Abschließen der Akte festgehalten.' });
    }
    // Wer die Akte gerade selbst übernommen hat, darf im selben Schritt weiterarbeiten.
    const canEditNow = access.canEdit || (lawyerChanged && leadAfter === u.id);
    if (wantsEdit && !canEditNow) {
      return res.status(403).json({ error: 'Nur der zuständige Anwalt oder das Board of Partners kann diese Akte bearbeiten.' });
    }

    for (const key of editFields) {
      sets.push(`${FIELD_COLUMNS[key]} = ?`);
      values.push(d[key]);
    }
    if (d.step !== undefined && d.step !== c.step) history.push(`Verfahrensstand: ${areas.stepsOf(c.area)[d.step]}`);
    // Priorität ist intern: eigener (interner) Verlaufseintrag, nichts davon im Ticket oder für den Mandanten
    const internalHistory = [];
    if (d.priority !== undefined && d.priority !== (c.priority || 2)) {
      sets.push('priority = ?');
      values.push(d.priority);
      internalHistory.push(`Priorität: ${PRIORITIES[d.priority]}`);
    }
    // Ergebnis ist ebenfalls intern (Statistik der Kanzlei) – nicht im Ticket, nicht für den Mandanten
    if (d.outcome !== undefined && d.outcome !== c.outcome) {
      sets.push('outcome = ?');
      values.push(d.outcome);
      internalHistory.push(`Ergebnis: ${OUTCOMES[d.outcome].label}`);
    }
    // Tatsächliches Strafmaß: nur intern, stiller Vergleich mit der Einschätzung (Statistik)
    if (d.actualHe !== undefined && d.actualHe !== c.sentence_actual_he) {
      sets.push('sentence_actual_he = ?');
      values.push(d.actualHe);
    }
    if (d.actualFine !== undefined && d.actualFine !== c.sentence_actual_fine) {
      sets.push('sentence_actual_fine = ?');
      values.push(d.actualFine);
    }
    if (newStatus && newStatus !== c.status) {
      sets.push('status = ?');
      values.push(newStatus);
      history.push(`Status: ${CASE_STATUS[c.status]} → ${CASE_STATUS[newStatus]}`);
    }

    if (!sets.length && !coChanged) return res.json({ case: { ...caseRow(c, u), ...access } });

    sets.push("updated_at = datetime('now')");
    tx(() => {
      db.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`).run(...values, c.id);
      if (coChanged || lawyerChanged) {
        const keep = new Set(coAfter);
        coBefore.filter((id) => !keep.has(id)).forEach((id) => db.prepare('DELETE FROM case_lawyers WHERE case_id = ? AND user_id = ?').run(c.id, id));
        const addCo = db.prepare('INSERT OR IGNORE INTO case_lawyers (case_id, user_id, added_by) VALUES (?, ?, ?)');
        coAfter.filter((id) => !coBefore.includes(id)).forEach((id) => addCo.run(c.id, id, u.id));
      }
      if (history.length) addSystemNote(c.id, u, history.join(' · '));
      if (internalHistory.length) addSystemNote(c.id, u, internalHistory.join(' · '), true);
      if (lawyerChanged || coChanged || (newStatus && newStatus !== c.status)) {
        const workReason =
          c.lawyer_id === u.id && leadAfter !== u.id ? 'abgegeben' : coBefore.includes(u.id) && !coAfter.includes(u.id) && leadAfter !== u.id ? 'Mitarbeit beendet' : 'nicht mehr zuständig';
        syncCaseWork(c.id, workReason);
      }
    });

    const updated = getCase(c.id);
    if (lawyerChanged && leadAfter && c.lawyer_id && leadAfter !== c.lawyer_id) handover(updated, u, leadAfter, d.handover);
    const newlyAssigned = [...(lawyerChanged && leadAfter && leadAfter !== c.lawyer_id && !coBefore.includes(leadAfter) ? [leadAfter] : []), ...coAdded];
    notifyAssigned(updated, u, newlyAssigned);
    if (history.length || internalHistory.length) logActivity(u, 'Akte geändert', 'case', c.id, `${c.case_number}: ${[...history, ...internalHistory].join(' · ')}`);
    if (newStatus && newStatus !== c.status) {
      discord.notify('case.status', {
        title: `${updated.case_number}: ${CASE_STATUS[newStatus]}`,
        description: truncate(updated.title, 300),
        fields: [
          { name: 'Mandant', value: updated.client_account_name || updated.client_name || '—' },
          { name: 'Zuständig', value: lawyerNames(updated) },
          newStatus === 'geschlossen' && updated.outcome ? { name: 'Ergebnis', value: OUTCOMES[updated.outcome].label } : null,
          { name: 'Geändert von', value: u.display_name },
        ],
      });
    }
    // Sieg-Moment: Erfolg fürs Team in Discord feiern – ohne Mandant, Aktenzeichen oder Sachverhalt
    if (newStatus === 'geschlossen' && c.status !== 'geschlossen' && OUTCOMES[updated.outcome]?.success) {
      const AREA = { [updated.area]: updated.area === 'sonstiges' ? '' : areas.name(updated.area) };
      discord.notify('case.victory', {
        title: `🏆 ${OUTCOMES[updated.outcome].label}!`,
        description: `Ein ${AREA[updated.area] ? `${AREA[updated.area]}s-` : ''}Mandat wurde erfolgreich abgeschlossen. Starke Arbeit, Team!`,
        fields: [{ name: 'Erreicht von', value: caseLawyers(updated).map((l) => l.name).join(', ') || u.display_name }],
      });
    }
    ticketUpdate(c, updated, u, { history, editFields, d, newStatus, newlyAssigned });
    if (newStatus && newStatus !== c.status) require('../discordBot').syncCaseClient(updated); // Rolle „Mandant mit offener Akte“
    // Aktenzeichen, Titel, Gericht und Gegenpartei stehen in den Verträgen → deren Google Docs neu schreiben
    require('../googleDocs').touchCase(c.id);
    res.json({ case: { ...caseRow(updated, u), ...caseAccess(updated, u) } });
  })
);

/* ---------------------------------------------------------------- Prozessticket (Kanal auf einem anderen Discord, z. B. DOJ) */
// Nur Links auf einen Discord-Kanal (discord.com/channels/<Server>/<Kanal>[/<Nachricht>]) – keine anderen Adressen.
const PROCESS_TICKET_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})(?:\/(\d{15,25}))?\/?$/i;

router.put(
  '/:id/process-ticket',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(u)) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!caseAccess(c, u).canEdit) return res.status(403).json({ error: 'Nur die zuständigen Anwälte und das Board of Partners können das Prozessticket hinterlegen.' });
    const d = parseBody(z.object({ url: z.string().trim().max(300), label: z.string().trim().max(80).optional() }), req, res);
    if (!d) return;
    const m = d.url.match(PROCESS_TICKET_RE);
    if (!m) return res.status(400).json({ error: 'Bitte einen Discord-Kanal-Link einfügen (Rechtsklick auf den Kanal → „Link kopieren“), z. B. https://discord.com/channels/123…/456….' });
    const url = `https://discord.com/channels/${m[1]}/${m[2]}${m[3] ? `/${m[3]}` : ''}`;
    const label = d.label || '';
    const had = !!c.process_ticket_url;
    tx(() => {
      db.prepare("UPDATE cases SET process_ticket_url = ?, process_ticket_label = ?, updated_at = datetime('now') WHERE id = ?").run(url, label, c.id);
      addSystemNote(c.id, u, `Prozessticket ${had ? 'geändert' : 'hinterlegt'}${label ? `: ${label}` : ''}`, true);
    });
    logActivity(u, `Prozessticket ${had ? 'geändert' : 'hinterlegt'}`, 'case', c.id, `${c.case_number}${label ? `: ${label}` : ''}`);
    const updated = getCase(c.id);
    res.json({ case: { ...caseRow(updated, u), ...caseAccess(updated, u) } });
  })
);

router.delete(
  '/:id/process-ticket',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(u)) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!caseAccess(c, u).canEdit) return res.status(403).json({ error: 'Nur die zuständigen Anwälte und das Board of Partners können das Prozessticket entfernen.' });
    if (c.process_ticket_url) {
      tx(() => {
        db.prepare("UPDATE cases SET process_ticket_url = NULL, process_ticket_label = NULL, updated_at = datetime('now') WHERE id = ?").run(c.id);
        addSystemNote(c.id, u, 'Prozessticket entfernt', true);
      });
      logActivity(u, 'Prozessticket entfernt', 'case', c.id, c.case_number);
    }
    const updated = getCase(c.id);
    res.json({ case: { ...caseRow(updated, u), ...caseAccess(updated, u) } });
  })
);

const FIELD_LABELS = { title: 'Titel', area: 'Rechtsgebiet', urgency: 'Dringlichkeit', description: 'Sachverhalt', clientName: 'Mandant', opponent: 'Gegenseite', courtRef: 'Gerichtsaktenzeichen' };

/** Änderung der Akte im Discord-Ticket melden (nur, was der Mandant auch im Portal sieht). */
function ticketUpdate(before, c, u, { history, editFields, d, newStatus, newlyAssigned }) {
  const statusChanged = !!newStatus && newStatus !== before.status;
  const noteChanged = d.publicNote !== undefined && d.publicNote !== (before.public_note || '') && !!d.publicNote;
  const changed = editFields.filter((k) => FIELD_LABELS[k] && d[k] !== undefined && String(d[k]) !== String(before[FIELD_COLUMNS[k]] ?? ''));
  const lines = [...history];
  if (changed.length) lines.push(`Angaben aktualisiert: ${changed.map((k) => FIELD_LABELS[k]).join(', ')}`);
  const closing = statusChanged && newStatus === 'geschlossen';
  if (closing) reviewRequest.afterClose(c.id).catch(() => {}); // Mandant einmal um eine Bewertung bitten (Portal + Discord-DM)
  if (!lines.length && !noteChanged) return;
  const reopening = statusChanged && before.status === 'geschlossen';
  const stepChanged = d.step !== undefined && d.step !== before.step;
  const title = closing
    ? '🔒 Akte geschlossen'
    : reopening
      ? '🔓 Akte wieder geöffnet'
      : statusChanged || stepChanged
        ? '📌 Stand der Akte aktualisiert'
        : newlyAssigned.length || history.some((h) => /Federführend|Anwälte|abgegeben|arbeitet nicht mehr/.test(h))
          ? '👤 Zuständigkeit geändert'
          : noteChanged && !lines.length
            ? '💡 Neuer Hinweis der Kanzlei'
            : '✏️ Akte aktualisiert';
  const description = [
    closing ? 'Die Akte ist abgeschlossen. Das Ticket wird archiviert – der Verlauf bleibt lesbar.' : null,
    lines.length ? lines.map((l) => `• ${l}`).join('\n') : null,
    noteChanged ? `**Hinweis der Kanzlei:** ${d.publicNote}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  const lawyerChanged = newlyAssigned.length > 0 || history.some((h) => /Federführend|Anwälte|abgegeben|arbeitet nicht mehr/.test(h));
  const event = [
    ...(closing || reopening ? ['closed'] : []),
    ...(noteChanged ? ['note'] : []),
    ...(lawyerChanged ? ['lawyer'] : []),
    ...(statusChanged || stepChanged ? ['step'] : []),
    ...(changed.length ? ['update'] : []),
  ];
  tickets.post(c.id, {
    event: event.length ? event : 'update',
    title,
    description,
    color: closing ? tickets.COLORS.slate : reopening ? tickets.COLORS.green : tickets.COLORS.gold,
    fields: [
      { name: 'Status', value: CASE_STATUS[c.status] },
      { name: 'Verfahrensstand', value: areas.stepsOf(c.area)[c.step] || STEPS[0] },
      { name: 'Zuständig', value: lawyerNames(c), inline: false },
    ],
    mention: statusChanged || stepChanged || noteChanged ? 'client' : undefined,
    mentionIds: caseLawyers(c)
      .filter((l) => newlyAssigned.includes(l.id))
      .map((l) => l.discordId),
    by: u.display_name,
    byDiscordId: u.discord_id,
  });
}

router.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    // Erst in den Papierkorb (30 Tage wiederherstellbar) – Bilddateien bleiben bis zum endgültigen Löschen liegen
    trash.trashCase(c.id, req.user);
    tickets.caseDeleted(c, req.user.display_name);
    require('../discordBot').syncCaseClient(c);
    logActivity(req.user, 'Akte gelöscht', 'case', c.id, `${c.case_number} – ${c.title} (Papierkorb)`);
    res.json({ success: true, keepDays: trash.KEEP_DAYS });
  })
);

/* ---------------------------------------------------------------- Beweismittel / Bildanhänge */
router.post(
  '/:id/attachments',
  imageBody,
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (c.status === 'geschlossen' && !isStaff(req.user)) return res.status(403).json({ error: 'Die Akte ist geschlossen.' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_attachments WHERE case_id = ?').get(c.id).n;
    if (count >= MAX_ATTACHMENTS_PER_CASE) {
      return res.status(400).json({ error: `Pro Akte sind höchstens ${MAX_ATTACHMENTS_PER_CASE} Anhänge möglich.` });
    }
    const caption = String(req.query.caption || '').trim().slice(0, 200);
    const internal = req.query.internal === '1' && isStaff(req.user);
    // Bild gehört zu einem verknüpften externen Dokument (FiveNet / Google Docs) dieser Akte (nur Team).
    let externalDocId = null;
    if (req.query.fivenetDoc && isStaff(req.user)) {
      const link = db.prepare('SELECT id FROM case_external_docs WHERE id = ? AND case_id = ?').get(Number(req.query.fivenetDoc) || 0, c.id);
      if (!link) return res.status(404).json({ error: 'Das Dokument ist nicht mit dieser Akte verknüpft.' });
      externalDocId = link.id;
    }
    const saved = saveImage(req, 'evidence');
    const info = tx(() => {
      const r = db
        .prepare(
          `INSERT INTO case_attachments (case_id, file, mime, size, caption, internal, uploader_id, uploader_name, external_doc_id, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.id,
          saved.file,
          saved.mime,
          saved.size,
          caption,
          internal ? 1 : 0,
          req.user.id,
          req.user.display_name,
          externalDocId,
          crypto.createHash('sha256').update(req.body).digest('hex')
        );
      addSystemNote(c.id, req.user, `Anhang hinzugefügt${caption ? ': ' + caption : ''}.`, internal);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      return r;
    });
    const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(Number(info.lastInsertRowid));
    if (!internal) {
      tickets.post(c.id, {
        event: 'attachment',
        title: '📎 Neuer Anhang in der Akte',
        description: `${caption ? `**${caption}**\n` : ''}Im ${isStaff(req.user) ? 'Mandantenportal' : 'Portal'} unter der Akte ${c.case_number} abrufbar.`,
        color: tickets.COLORS.blue,
        mention: isStaff(req.user) ? 'client' : 'lawyers',
        by: req.user.display_name,
        byDiscordId: req.user.discord_id,
      });
    }
    res.status(201).json({ attachment: attachmentRow(row, c.id, isStaff(req.user)) });
  })
);

router.get(
  '/:id/attachments/:attId/file',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(a.mime);
    res.sendFile(evidencePath(a.file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Datei nicht gefunden.' });
    });
  })
);

/*
 * Vorschaubild: Der Browser verkleinert das Bild (WebP, höchstens ~480 px) und lädt es einmal hoch – beim Hochladen
 * oder später beim ersten Anzeigen (für ältere bzw. aus FiveNet/Google übernommene Bilder). Kanzlei oder wer das Bild
 * hochgeladen hat; ein vorhandenes Vorschaubild wird nicht überschrieben.
 */
const thumbBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 300 * 1024 });
router.put(
  '/:id/attachments/:attId/thumb',
  thumbBody,
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    if (!isStaff(req.user) && a.uploader_id !== req.user.id) return res.status(403).json({ error: 'Keine Berechtigung.' });
    if (a.thumb) return res.json({ attachment: attachmentRow(a, c.id, isStaff(req.user)) });
    const saved = saveImage(req, 'evidence');
    const done = db.prepare('UPDATE case_attachments SET thumb = ? WHERE id = ? AND thumb IS NULL').run(saved.file, a.id);
    if (!done.changes) removeFile('evidence', saved.file); // gleichzeitig schon angelegt
    res.json({ attachment: attachmentRow(db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(a.id), c.id, isStaff(req.user)) });
  })
);

/*
 * Beitrittslink für den Mandanten (nur Kanzlei): ein Klick auf den Link startet die Discord-Anmeldung und nimmt den
 * Mandanten ins Ticket der Akte auf. Der Link enthält Aktenzeichen und Pin der Akte – wie die Angaben für den Beitritt
 * auf der Startseite; er wird nur der Kanzlei angezeigt.
 */
router.get(
  '/:id/join-link',
  features.requireFeature('clientLink'),
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(req.user) || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!tickets.active() || !discord.oauthConfigured()) {
      return res.status(400).json({ error: 'Der Discord-Beitritt ist nicht eingerichtet (Tickets und Discord-Anmeldung in den Einstellungen).' });
    }
    const url = `${discord.publicBase(req)}/api/discord/case-join?c=${encodeURIComponent(c.case_number)}&p=${encodeURIComponent(c.access_pin)}`;
    res.json({ url, text: `Hier kommen Sie in den Discord-Kanal Ihrer Akte ${c.case_number}: ${url}` });
  })
);

router.get(
  '/:id/attachments/:attId/thumb',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    res.set('Cache-Control', 'private, max-age=604800');
    if (!a.thumb) res.type(a.mime); // Vorschaubild: Typ aus der Dateiendung (.webp/.jpg/.png)
    res.sendFile(evidencePath(a.thumb || a.file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Datei nicht gefunden.' });
    });
  })
);

const evidenceBody = z.object({
  caption: z.string().trim().max(200).optional(),
  kind: z.enum(Object.keys(evidence.KINDS)).optional(),
  source: z.string().trim().max(200).optional(),
  obtainedAt: isoDateTime.nullable().optional(),
  side: z.enum(['', ...Object.keys(evidence.SIDES)]).optional(),
  status: z.enum(Object.keys(evidence.STATUS)).optional(),
  description: z.string().trim().max(2000).optional(),
});

// Beweismittel beschreiben: Bezeichnung, Art, Herkunft, Zeitpunkt, Lager, Stand (nur zuständige Anwälte)
router.patch(
  '/:id/attachments/:attId',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    const access = c ? caseAccess(c, req.user) : null;
    if (!c || !isStaff(req.user) || !access.canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!access.canEdit) return res.status(403).json({ error: 'Beweismittel beschreiben nur die zuständigen Anwälte.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    const d = parseBody(evidenceBody, req, res);
    if (!d) return;
    const when = d.obtainedAt === undefined ? a.obtained_at : d.obtainedAt ? new Date(d.obtainedAt).toISOString() : null;
    db.prepare('UPDATE case_attachments SET caption = ?, kind = ?, source = ?, obtained_at = ?, side = ?, ev_status = ?, description = ? WHERE id = ?').run(
      d.caption ?? a.caption,
      d.kind ?? a.kind,
      d.source ?? a.source,
      when,
      d.side ?? a.side,
      d.status ?? a.ev_status,
      d.description ?? a.description,
      a.id
    );
    // Wichtige Wechsel stehen im Verlauf (nur Kanzlei)
    if (d.status && d.status !== a.ev_status) addSystemNote(c.id, req.user, `Beweismittel B${a.ev_no}: ${evidence.STATUS[d.status]}`, true);
    const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(a.id);
    res.json({ attachment: attachmentRow(row, c.id, true) });
  })
);

router.delete(
  '/:id/attachments/:attId',
  wrap(async (req, res) => {
    const id = idParam(req);
    const attId = idParam(req, 'attId');
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const a = attId && db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?').get(attId, c.id);
    if (!a || (a.internal && !isStaff(req.user))) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
    if (a.uploader_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Nur die hochladende Person oder das Board of Partners kann den Anhang löschen.' });
    }
    db.prepare('DELETE FROM case_attachments WHERE id = ?').run(a.id);
    removeFile('evidence', a.file);
    if (a.thumb) removeFile('evidence', a.thumb);
    res.json({ success: true });
  })
);

/* ---------------------------------------------------------------- Deal-Rechner: Angebote der Staatsanwaltschaft */
const dealSchema = z
  .object({
    he: z.number().int().min(0).max(999).nullable().optional(),
    fine: z.number().int().min(0).max(100000000).nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.he != null || d.fine != null, 'Bitte Hafteinheiten und/oder Geldstrafe des Angebots angeben.');
router.post(
  '/:id/deals',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(req.user) || !caseAccess(c, req.user).canEdit) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const d = parseBody(dealSchema, req, res);
    if (!d) return;
    const deals = require('../deals');
    const dealId = tx(() => {
      // Ein neues Angebot ersetzt ein noch offenes
      db.prepare("UPDATE case_deals SET status = 'zurueckgezogen' WHERE case_id = ? AND status = 'offen'").run(c.id);
      const info = db
        .prepare('INSERT INTO case_deals (case_id, offer_he, offer_fine, note, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.id, d.he ?? null, d.fine ?? null, d.note || '', req.user.id, req.user.display_name);
      return Number(info.lastInsertRowid);
    });
    addSystemNote(c.id, req.user, `Angebot der Staatsanwaltschaft eingetragen: ${deals.offerText(deals.load(dealId))} – der Mandant kann zustimmen oder ablehnen.`);
    const sent = await deals.askClient(dealId);
    res.status(201).json({ deal: deals.row(deals.load(dealId)), discord: sent });
  })
);
router.post('/:id/deals/:did/answer', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  const d = parseBody(z.object({ accept: z.boolean() }), req, res);
  if (!d) return;
  const deal = db.prepare('SELECT id FROM case_deals WHERE id = ? AND case_id = ?').get(idParam(req, 'did'), c.id);
  if (!deal) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
  // Mandant im Portal – oder die Kanzlei erfasst die Antwort aus dem Spiel
  const staff = isStaff(req.user);
  if (staff && !caseAccess(c, req.user).canEdit) return res.status(403).json({ error: 'Nur die zuständigen Anwälte können die Antwort erfassen.' });
  const r = require('../deals').answer(deal.id, d.accept, { user: req.user, via: staff ? 'kanzlei' : 'portal' });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});
router.delete('/:id/deals/:did', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !isStaff(req.user) || !caseAccess(c, req.user).canEdit) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  const r = db.prepare("UPDATE case_deals SET status = 'zurueckgezogen' WHERE id = ? AND case_id = ? AND status = 'offen'").run(idParam(req, 'did'), c.id);
  if (!r.changes) return res.status(404).json({ error: 'Kein offenes Angebot.' });
  addSystemNote(c.id, req.user, 'Angebot der Staatsanwaltschaft zurückgezogen.', true);
  res.json({ success: true });
});

/* ---------------------------------------------------------------- Akten verknüpfen (nur Kanzlei) */
router.post(
  '/:id/links',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(u) || !caseAccess(c, u).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!caseAccess(c, u).canEdit) return res.status(403).json({ error: 'Verknüpfen dürfen die zuständigen Anwälte und das Board.' });
    const d = parseBody(z.object({ otherId: z.number().int().positive() }), req, res);
    if (!d) return;
    const other = d.otherId !== c.id && getCase(d.otherId);
    if (!other) return res.status(400).json({ error: 'Bitte eine andere Akte auswählen.' });
    if (linkedIds(c.id).length >= 20) return res.status(400).json({ error: 'Höchstens 20 verknüpfte Akten.' });
    const [a, b] = linkPair(c.id, other.id);
    const added = tx(() => {
      const r = db.prepare('INSERT OR IGNORE INTO case_links (a_id, b_id, created_by_name) VALUES (?, ?, ?)').run(a, b, u.display_name);
      if (!r.changes) return false;
      addSystemNote(c.id, u, `Akte verknüpft mit ${other.case_number}.`, true);
      addSystemNote(other.id, u, `Akte verknüpft mit ${c.case_number}.`, true);
      return true;
    });
    if (added) {
      logActivity(u, 'Akten verknüpft', 'case', c.id, `${c.case_number} ↔ ${other.case_number}`);
      require('../live').caseChanged(other.id);
    }
    res.status(added ? 201 : 200).json({ links: linkedCases(c.id) });
  })
);
router.delete(
  '/:id/links/:otherId',
  wrap(async (req, res) => {
    const u = req.user;
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !isStaff(u) || !caseAccess(c, u).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    if (!caseAccess(c, u).canEdit) return res.status(403).json({ error: 'Lösen dürfen die zuständigen Anwälte und das Board.' });
    const other = getCase(idParam(req, 'otherId'));
    if (!other) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const [a, b] = linkPair(c.id, other.id);
    const removed = tx(() => {
      const r = db.prepare('DELETE FROM case_links WHERE a_id = ? AND b_id = ?').run(a, b);
      if (!r.changes) return false;
      addSystemNote(c.id, u, `Verknüpfung mit ${other.case_number} gelöst.`, true);
      addSystemNote(other.id, u, `Verknüpfung mit ${c.case_number} gelöst.`, true);
      return true;
    });
    if (removed) {
      logActivity(u, 'Akten-Verknüpfung gelöst', 'case', c.id, `${c.case_number} ↔ ${other.case_number}`);
      require('../live').caseChanged(other.id);
    }
    res.json({ links: linkedCases(c.id) });
  })
);

/* ---------------------------------------------------------------- Gesicherter Ticket-Verlauf (nur Kanzlei) */
router.get('/:id/transcripts/:tid', (req, res) => {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !isStaff(req.user) || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Nicht gefunden.' });
  const t = db.prepare('SELECT html FROM ticket_transcripts WHERE id = ? AND case_id = ?').get(idParam(req, 'tid'), c.id);
  if (!t) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(t.html);
});

/* ---------------------------------------------------------------- Notizen */
router.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const id = idParam(req);
    const c = id && getCase(id);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
    const d = parseBody(z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().optional() }), req, res);
    if (!d) return;
    const internal = !!d.internal && isStaff(req.user);
    const noteId = tx(() => {
      const info = db
        .prepare(`INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(c.id, req.user.id, req.user.display_name, req.user.role, d.body, internal ? 1 : 0);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      return Number(info.lastInsertRowid);
    });
    if (!internal) caseChat.markRead(c.id, req.user.id, noteId); // eigene Nachricht gilt als gelesen
    // @Erwähnung in internen Notizen: Kollegen per DM (sonst Kanzlei-Post) benachrichtigen
    const mentioned = internal ? await require('../mentions').notify(c, req.user, d.body) : [];
    // Interne Notizen bleiben intern – ins Ticket kommt nur, was auch der Mandant sieht.
    if (!internal) {
      tickets.post(c.id, {
        event: 'chat',
        title: `💬 Nachricht von ${req.user.display_name}`,
        description: d.body,
        color: isStaff(req.user) ? tickets.COLORS.gold : tickets.COLORS.blue,
        mention: isStaff(req.user) ? 'client' : 'lawyers',
        by: isStaff(req.user) ? req.user.rank || 'Pake & Scha' : 'Mandant (über das Portal)',
        byDiscordId: req.user.discord_id,
      });
    }
    res.status(201).json({ success: true, id: noteId, mentioned, message: internal ? undefined : caseChat.messages(c.id, noteId - 1)[0] });
  })
);

router.delete(
  '/:id/notes/:noteId',
  wrap(async (req, res) => {
    const caseId = idParam(req);
    const noteId = idParam(req, 'noteId');
    const n = caseId && noteId && db.prepare('SELECT * FROM notes WHERE id = ? AND case_id = ?').get(noteId, caseId);
    if (!n || n.system) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
    if (n.author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sie können nur eigene Notizen löschen.' });
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
    res.json({ success: true });
  })
);

/** Interne Notiz oben in der Akte anpinnen bzw. lösen (Kanzlei; z. B. „Mandant nur per DM erreichbar“). */
router.put('/:id/notes/:noteId/pin', (req, res) => {
  const caseId = idParam(req);
  const noteId = idParam(req, 'noteId');
  const c = caseId && getCase(caseId);
  if (!c || !caseAccess(c, req.user).canView || !isStaff(req.user)) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  const n = noteId && db.prepare('SELECT * FROM notes WHERE id = ? AND case_id = ?').get(noteId, caseId);
  if (!n || n.system || !n.internal) return res.status(404).json({ error: 'Interne Notiz nicht gefunden.' });
  const d = parseBody(z.object({ on: z.boolean() }), req, res);
  if (!d) return;
  if (d.on && !n.pinned && db.prepare('SELECT COUNT(*) AS k FROM notes WHERE case_id = ? AND pinned = 1').get(caseId).k >= 3) {
    return res.status(400).json({ error: 'Höchstens drei angepinnte Notizen je Akte – bitte zuerst eine lösen.' });
  }
  db.prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(d.on ? 1 : 0, n.id);
  res.json({ pinned: d.on });
});

/* ---------------------------------------------------------------- Änderungen aus dem Discord-Ticket (Buttons) */
// Rechte prüft der Aufrufer (routes/interactions.js); hier nur die Änderung samt Verlauf und Meldungen.

function notifyStatus(c, u, newStatus) {
  discord.notify('case.status', {
    title: `${c.case_number}: ${CASE_STATUS[newStatus]}`,
    description: truncate(c.title, 300),
    fields: [
      { name: 'Mandant', value: c.client_account_name || c.client_name || '—' },
      { name: 'Zuständig', value: lawyerNames(c) },
      { name: 'Geändert von', value: u.display_name },
    ],
  });
}

/** Status setzen (z. B. „Akte schließen“ / „Wieder öffnen“). Liefert false, wenn sich nichts ändert. */
function setCaseStatus(c, u, newStatus, via = '') {
  if (!CASE_STATUS[newStatus] || newStatus === c.status) return false;
  const history = [`Status: ${CASE_STATUS[c.status]} → ${CASE_STATUS[newStatus]}${via}`];
  tx(() => {
    db.prepare("UPDATE cases SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, c.id);
    addSystemNote(c.id, u, history.join(' · '));
    syncCaseWork(c.id);
  });
  const updated = getCase(c.id);
  logActivity(u, 'Akte geändert', 'case', c.id, `${c.case_number}: ${history.join(' · ')}`);
  notifyStatus(updated, u, newStatus);
  ticketUpdate(c, updated, u, { history, editFields: [], d: {}, newStatus, newlyAssigned: [] });
  require('../discordBot').syncCaseClient(updated);
  return true;
}

/** Unbesetzte Akte übernehmen (federführend). Liefert false, wenn sie schon besetzt oder geschlossen ist. */
function claimCase(c, u, via = '') {
  if (c.lawyer_id || c.status === 'geschlossen') return false;
  const wasCo = coLawyersOf(c).some((l) => l.id === u.id);
  const newStatus = c.status === 'offen' ? 'in_bearbeitung' : undefined;
  const history = [`Federführend: ${u.display_name}${via}`, ...(newStatus ? [`Status: ${CASE_STATUS[c.status]} → ${CASE_STATUS[newStatus]}`] : [])];
  tx(() => {
    db.prepare("UPDATE cases SET lawyer_id = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?").run(u.id, newStatus || null, c.id);
    db.prepare('DELETE FROM case_lawyers WHERE case_id = ? AND user_id = ?').run(c.id, u.id);
    addSystemNote(c.id, u, history.join(' · '));
    syncCaseWork(c.id);
  });
  const updated = getCase(c.id);
  notifyAssigned(updated, u, wasCo ? [] : [u.id]);
  logActivity(u, 'Akte geändert', 'case', c.id, `${c.case_number}: ${history.join(' · ')}`);
  if (newStatus) notifyStatus(updated, u, newStatus);
  ticketUpdate(c, updated, u, { history, editFields: [], d: {}, newStatus, newlyAssigned: wasCo ? [] : [u.id] });
  return true;
}

module.exports = router;
module.exports.setCaseStatus = setCaseStatus;
module.exports.claimCase = claimCase;
module.exports.caseDetail = caseDetail;
