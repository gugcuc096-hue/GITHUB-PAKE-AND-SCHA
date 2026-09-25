'use strict';
const { db } = require('./db');
const { isStaff, userAvatarUrl } = require('./auth');
const { STEPS, CASE_STATUS, EVENT_TYPES, APPLICATION_STATUS, DUTY_STATUS, truncate } = require('./helpers');
const { avatarUrl, teamPhotoUrl } = require('./uploads');

/* ================================================================
   Aktivitätsprotokoll
   ================================================================ */
/** Hält fest, wer was geändert hat (sichtbar für die Kanzleileitung). Fehler hier dürfen nie eine Aktion blockieren. */
function logActivity(user, action, entity = '', entityId = null, details = '') {
  try {
    db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(
      user ? user.id : null,
      user ? user.display_name : 'System',
      action,
      entity,
      entityId ?? null,
      truncate(details, 500)
    );
    // Protokoll begrenzen: nur die letzten 5000 Einträge behalten.
    if (Math.random() < 0.02) db.prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 5000').run();
  } catch (err) {
    console.warn('Protokoll-Eintrag fehlgeschlagen:', err.message);
  }
}

/* ================================================================
   Akten
   ================================================================ */
const CASE_SELECT = `
  SELECT c.*,
         cu.display_name AS client_account_name, cu.email AS client_email, cu.phone AS client_account_phone,
         lu.display_name AS lawyer_name, lu.discord_id AS lawyer_discord_id,
         (SELECT group_concat(e.external_id, ' ') FROM case_external_docs e WHERE e.case_id = c.id) AS external_doc_ids
  FROM cases c
  LEFT JOIN users cu ON cu.id = c.client_id
  LEFT JOIN users lu ON lu.id = c.lawyer_id`;

function getCase(id) {
  return db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(id) || null;
}

function caseAccess(c, u) {
  const admin = u.role === 'admin';
  const staff = isStaff(u);
  const owner = u.role === 'mandant' && c.client_id === u.id;
  return {
    canView: staff || owner,
    canEdit: admin || (staff && c.lawyer_id === u.id),
    canClaim: staff && !c.lawyer_id,
    canDelete: admin,
  };
}

function caseRow(c, u) {
  const staff = isStaff(u);
  const owner = u && c.client_id === u.id;
  return {
    id: c.id,
    caseNumber: c.case_number,
    accessPin: staff || owner ? c.access_pin : undefined,
    title: c.title,
    area: c.area,
    urgency: c.urgency,
    description: c.description,
    clientId: c.client_id,
    clientName: c.client_account_name || c.client_name || '—',
    clientEmail: staff ? c.client_email || null : undefined,
    clientPhone: staff ? c.client_phone || c.client_account_phone || '' : undefined,
    hasClientAccount: !!c.client_id,
    opponent: c.opponent,
    courtRef: c.court_ref,
    lawyerId: c.lawyer_id,
    lawyerName: c.lawyer_name || null,
    status: c.status,
    statusLabel: CASE_STATUS[c.status] || c.status,
    step: c.step,
    stepLabel: STEPS[c.step] || STEPS[0],
    closed: c.status === 'geschlossen',
    publicNote: c.public_note,
    source: c.source,
    // Für die Aktensuche per FiveNet-Link oder Dokument-ID (nur Team).
    fivenetIds: staff ? String(c.external_doc_ids || '').split(' ').filter(Boolean) : undefined,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function noteRow(n) {
  return {
    id: n.id,
    authorId: n.author_id,
    author: n.author_name,
    authorRole: n.author_role,
    body: n.body,
    internal: !!n.internal,
    system: !!n.system,
    createdAt: n.created_at,
  };
}

/** Automatischer Verlaufseintrag in der Akte (z. B. Statuswechsel). */
function addSystemNote(caseId, user, body, internal = false) {
  db.prepare(
    `INSERT INTO notes (case_id, author_id, author_name, author_role, body, internal, system)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(caseId, user ? user.id : null, user ? user.display_name : 'System', user ? user.role : 'system', body, internal ? 1 : 0);
}

/* ================================================================
   Externe Dokumente (FiveNet-Referenzen)
   ================================================================ */
/**
 * others: andere Akten, die dasselbe Dokument referenzieren (nur für das Team).
 * Mandanten sehen weder die Charakter-Angabe noch Querverweise auf fremde Akten.
 */
function externalDocRow(d, u, others = []) {
  const staff = isStaff(u);
  return {
    id: d.id,
    provider: d.provider,
    documentId: d.external_id,
    url: d.canonical_url,
    originalUrl: staff ? d.original_url : undefined,
    host: d.host,
    title: d.title,
    docType: d.doc_type,
    docDate: d.doc_date || null,
    docAuthor: d.doc_author,
    summary: d.summary,
    contentText: d.content_text || '',
    contentAt: d.content_at || null,
    contentByName: d.content_by_name || '',
    viewedAs: staff ? d.viewed_as : undefined,
    internal: !!d.internal,
    attested: staff ? !!d.attested : undefined,
    linkedById: d.linked_by,
    linkedByName: d.linked_by_name,
    linkedAt: d.linked_at,
    updatedAt: d.updated_at || null,
    alsoIn: staff ? others : undefined,
  };
}

/** Lädt die Referenzen einer Akte inklusive Querverweisen auf andere Akten. */
function externalDocsForCase(caseId, u) {
  const staff = isStaff(u);
  const rows = db
    .prepare(
      `SELECT * FROM case_external_docs WHERE case_id = ?
       ORDER BY COALESCE(doc_date, substr(linked_at, 1, 10)) DESC, id DESC`
    )
    .all(caseId)
    .filter((d) => staff || !d.internal);
  const others = new Map();
  if (staff && rows.length) {
    const ids = [...new Set(rows.map((d) => d.external_id))];
    db.prepare(
      `SELECT e.external_id, c.id, c.case_number, c.title FROM case_external_docs e JOIN cases c ON c.id = e.case_id
       WHERE e.provider = 'fivenet' AND e.case_id != ? AND e.external_id IN (${ids.map(() => '?').join(',')})
       ORDER BY c.case_number`
    )
      .all(caseId, ...ids)
      .forEach((r) => {
        if (!others.has(r.external_id)) others.set(r.external_id, []);
        others.get(r.external_id).push({ id: r.id, caseNumber: r.case_number, title: r.title });
      });
  }
  return rows.map((d) => externalDocRow(d, u, others.get(d.external_id) || []));
}

/* ================================================================
   Aufgaben & Wiedervorlagen
   ================================================================ */
const TASK_SELECT = `
  SELECT t.*, c.case_number, c.title AS case_title, c.status AS case_status,
         au.display_name AS assigned_name, cu.display_name AS creator_name, du.display_name AS done_by_name
  FROM tasks t
  LEFT JOIN cases c  ON c.id  = t.case_id
  LEFT JOIN users au ON au.id = t.assigned_to
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users du ON du.id = t.done_by`;

function taskRow(t) {
  return {
    id: t.id,
    caseId: t.case_id,
    caseNumber: t.case_number || null,
    caseTitle: t.case_title || null,
    caseClosed: t.case_status === 'geschlossen',
    title: t.title,
    note: t.note,
    dueDate: t.due_date || null,
    assignedTo: t.assigned_to,
    assignedName: t.assigned_name || null,
    done: !!t.done,
    doneAt: t.done_at || null,
    doneByName: t.done_by_name || null,
    createdBy: t.created_by,
    creatorName: t.creator_name || null,
    createdAt: t.created_at,
  };
}

/* ================================================================
   Kalender (Termine, Gerichtstermine, Fristen)
   ================================================================ */
const APPT_SELECT = `
  SELECT a.*,
         c.case_number, c.title AS case_title, c.client_id AS case_client_id, c.client_name AS case_client_name,
         cu.display_name AS client_name,
         au.display_name AS assigned_name, au.discord_id AS assigned_discord_id,
         cr.display_name AS creator_name
  FROM appointments a
  LEFT JOIN cases c  ON c.id  = a.case_id
  LEFT JOIN users cu ON cu.id = a.client_id
  LEFT JOIN users au ON au.id = a.assigned_to
  LEFT JOIN users cr ON cr.id = a.created_by`;

function getAppointment(id) {
  return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id) || null;
}

function apptVisible(a, u) {
  if (isStaff(u)) return true;
  return !!a.client_visible && (a.client_id === u.id || a.case_client_id === u.id);
}

function apptRow(a, u) {
  const staff = isStaff(u);
  return {
    id: a.id,
    type: a.type,
    typeLabel: EVENT_TYPES[a.type] || a.type,
    title: a.title,
    startsAt: a.starts_at,
    endsAt: a.ends_at || null,
    location: a.location,
    note: a.note,
    status: a.status,
    caseId: a.case_id,
    caseNumber: a.case_number || null,
    caseTitle: a.case_title || null,
    clientId: a.client_id,
    clientName: a.client_name || a.case_client_name || null,
    assignedTo: a.assigned_to,
    assignedName: a.assigned_name || null,
    createdBy: staff ? a.created_by : undefined,
    creatorName: a.creator_name || null,
    clientVisible: !!a.client_visible,
    createdAt: a.created_at,
  };
}

/* ================================================================
   Kanzlei-Post
   ================================================================ */
const MESSAGE_SELECT = `
  SELECT m.*,
         s.display_name AS sender_name, s.role AS sender_role, s.rank AS sender_rank,
         s.avatar AS sender_avatar, s.discord_id AS sender_discord_id, s.discord_avatar AS sender_discord_avatar,
         r.display_name AS recipient_name, r.role AS recipient_role,
         c.case_number, c.title AS case_title
  FROM messages m
  LEFT JOIN users s ON s.id = m.sender_id
  LEFT JOIN users r ON r.id = m.recipient_id
  LEFT JOIN cases c ON c.id = m.case_id`;

function messageRow(m) {
  return {
    id: m.id,
    senderId: m.sender_id,
    senderName: m.sender_name || 'Ehemaliges Mitglied',
    senderRole: m.sender_role || null,
    senderRank: m.sender_rank || null,
    senderAvatar: m.sender_id
      ? userAvatarUrl({ avatar: m.sender_avatar, discord_id: m.sender_discord_id, discord_avatar: m.sender_discord_avatar })
      : null,
    recipientId: m.recipient_id,
    recipientName: m.recipient_name || '—',
    subject: m.subject || '',
    body: m.body,
    caseId: m.case_id,
    caseNumber: m.case_number || null,
    caseTitle: m.case_title || null,
    priority: !!m.priority,
    isRead: !!m.is_read,
    createdAt: m.created_at,
  };
}

/* ================================================================
   Rechnungen / Honorarvereinbarungen
   ================================================================ */
const INVOICE_SELECT = `
  SELECT i.*, c.case_number, c.client_id AS case_client_id
  FROM invoices i
  LEFT JOIN cases c ON c.id = i.case_id`;

function invoiceRow(i) {
  let items = [];
  try {
    items = JSON.parse(i.items_json);
  } catch {
    items = [];
  }
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    caseId: i.case_id,
    caseNumber: i.case_number || null,
    clientName: i.client_name,
    clientContact: i.client_contact,
    subject: i.subject,
    items,
    subtotal: i.subtotal,
    discountPct: i.discount_pct,
    discountAmount: i.discount_amount,
    surchargePct: i.surcharge_pct,
    surchargeAmount: i.surcharge_amount,
    total: i.total,
    notes: i.notes,
    status: i.status,
    dueDate: i.due_date,
    issuerName: i.issuer_name,
    issuerRank: i.issuer_rank,
    createdAt: i.created_at,
    paidAt: i.paid_at,
  };
}

/* ================================================================
   Team, Honorarordnung, Pinnwand
   ================================================================ */
const TEAM_SELECT = `
  SELECT t.*, u.email AS user_email, u.role AS user_role, u.active AS user_active,
         u.avatar AS user_avatar, u.duty_status AS user_duty_status
  FROM team_members t LEFT JOIN users u ON u.id = t.user_id`;

function teamRow(t, withAdminFields = false) {
  const row = {
    id: t.id,
    name: t.name,
    roleTitle: t.role_title,
    description: t.description,
    initials: t.initials,
    tier: t.tier,
    sortOrder: t.sort_order,
    // Eigenes Team-Foto hat Vorrang, sonst das Profilbild des verknüpften Kontos.
    photoUrl: teamPhotoUrl(t.photo) || avatarUrl(t.user_avatar) || null,
    duty: t.user_duty_status && t.user_duty_status !== 'off' && t.user_active !== 0 ? t.user_duty_status : null,
  };
  if (withAdminFields) {
    row.hasOwnPhoto = !!t.photo;
    row.visible = !!t.visible;
    row.userId = t.user_id || null;
    row.userEmail = t.user_email || null;
    row.userRole = t.user_role || null;
    row.userActive = t.user_active == null ? null : !!t.user_active;
  }
  return row;
}

function feeRow(f) {
  return {
    id: f.id,
    category: f.category,
    name: f.name,
    description: f.description,
    price: f.price,
    inCalculator: !!f.in_calculator,
    active: !!f.active,
    sortOrder: f.sort_order,
  };
}

function boardRow(n) {
  return {
    id: n.id,
    authorId: n.author_id,
    authorName: n.author_name,
    title: n.title,
    body: n.body,
    color: n.color,
    pinned: !!n.pinned,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

/* ================================================================
   Beweismittel, Bewerbungen, Dienstzeiten
   ================================================================ */
function attachmentRow(a, caseId) {
  return {
    id: a.id,
    externalDocId: a.external_doc_id || null,
    caption: a.caption,
    internal: !!a.internal,
    mime: a.mime,
    size: a.size,
    uploaderId: a.uploader_id,
    uploaderName: a.uploader_name,
    createdAt: a.created_at,
    url: `/api/cases/${caseId}/attachments/${a.id}/file`,
  };
}

function positionRow(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    requirements: p.requirements,
    active: !!p.active,
    sortOrder: p.sort_order,
  };
}

function applicationRow(a) {
  return {
    id: a.id,
    number: a.number,
    positionId: a.position_id,
    positionTitle: a.position_title,
    name: a.name,
    age: a.age,
    phone: a.phone,
    email: a.email,
    discord: a.discord,
    experience: a.experience,
    motivation: a.motivation,
    availability: a.availability,
    status: a.status,
    statusLabel: APPLICATION_STATUS[a.status] || a.status,
    rating: a.rating,
    publicNote: a.public_note,
    interviewAt: a.interview_at,
    hiredUserId: a.hired_user_id,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

const DUTY_SELECT = `
  SELECT d.*, u.display_name AS user_name, u.rank AS user_rank
  FROM duty_sessions d JOIN users u ON u.id = d.user_id`;

function dutySessionRow(d) {
  return {
    id: d.id,
    userId: d.user_id,
    userName: d.user_name,
    userRank: d.user_rank || null,
    startedAt: d.started_at,
    endedAt: d.ended_at,
    note: d.note,
    autoClosed: !!d.auto_closed,
  };
}

/** Wer ist gerade im Dienst? (für Dashboard und Website) */
function onDutyMembers() {
  return db
    .prepare(
      `SELECT id, display_name, rank, role, avatar, discord_id, discord_avatar, duty_status, duty_note, duty_since
       FROM users WHERE duty_status != 'off' AND active = 1 AND role IN ('anwalt','admin')
       ORDER BY duty_since ASC`
    )
    .all()
    .map((u) => ({
      id: u.id,
      name: u.display_name,
      rank: u.rank || null,
      status: u.duty_status,
      statusLabel: DUTY_STATUS[u.duty_status] || u.duty_status,
      note: u.duty_note,
      since: u.duty_since,
      avatarUrl: userAvatarUrl(u),
    }));
}

module.exports = {
  logActivity,
  TEAM_SELECT,
  attachmentRow,
  positionRow,
  applicationRow,
  DUTY_SELECT,
  dutySessionRow,
  onDutyMembers,
  CASE_SELECT,
  externalDocRow,
  externalDocsForCase,
  TASK_SELECT,
  taskRow,
  getCase,
  caseAccess,
  caseRow,
  noteRow,
  addSystemNote,
  APPT_SELECT,
  getAppointment,
  apptVisible,
  apptRow,
  MESSAGE_SELECT,
  messageRow,
  INVOICE_SELECT,
  invoiceRow,
  teamRow,
  feeRow,
  boardRow,
};
