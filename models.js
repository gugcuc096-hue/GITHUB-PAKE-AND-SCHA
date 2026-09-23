'use strict';
const { db } = require('./db');
const { isStaff } = require('./auth');
const { STEPS, CASE_STATUS, EVENT_TYPES } = require('./helpers');

/* ================================================================
   Akten
   ================================================================ */
const CASE_SELECT = `
  SELECT c.*,
         cu.display_name AS client_account_name, cu.email AS client_email, cu.phone AS client_account_phone,
         lu.display_name AS lawyer_name, lu.discord_id AS lawyer_discord_id
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
function teamRow(t, withAdminFields = false) {
  const row = {
    id: t.id,
    name: t.name,
    roleTitle: t.role_title,
    description: t.description,
    initials: t.initials,
    tier: t.tier,
    sortOrder: t.sort_order,
  };
  if (withAdminFields) {
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

module.exports = {
  CASE_SELECT,
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
