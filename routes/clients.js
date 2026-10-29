'use strict';
/*
 * /api/clients – Mandantenkartei (nur Kanzlei): alles zu einem Mandanten auf einer Seite.
 *
 *   GET    /                 Liste aller Mandanten (Akten, offene Rechnungen, VIP, Vermerk, letzte Aktivität)
 *   GET    /:key             Karte: Konto, Akten, Rechnungen, Verträge, VIP, interne Notizen, Vermerk
 *   POST   /:key/notes       interne Notiz anlegen (Kanzlei)
 *   DELETE /notes/:id        eigene Notiz löschen (Board: alle)
 *   PUT    /:key/flag        Vermerk setzen/aufheben – „Nur gegen Vorkasse“ / „Nicht mehr annehmen“ (nur Board)
 *
 * Wer ist ein Mandant? Ein Konto (Schlüssel „u<ID>“) – oder, bei Akten/Rechnungen ohne Konto, der Name („n:<name>“).
 * Akten ohne Konto, deren Name genau einem Konto entspricht, gehören zu diesem Konto (Charakternamen sind eindeutig).
 * Mandanten sehen weder Kartei noch Notizen noch Vermerk – auch nicht im Discord-Ticket ihrer Akte.
 */
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, isStaff, userAvatarUrl } = require('../auth');
const { wrap, parseBody, isBoard, truncate } = require('../helpers');
const { CASE_SELECT, caseRow, INVOICE_SELECT, invoiceRow, logActivity } = require('../models');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => (isStaff(req.user) ? next() : res.status(403).json({ error: 'Die Mandantenkartei ist nur für die Kanzlei.' })));

const FLAGS = { vorkasse: 'Nur gegen Vorkasse', sperre: 'Nicht mehr annehmen' };

/* ---------------------------------------------------------------- Zuordnung */
const norm = (s) => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const nameKey = (name) => `n:${norm(name)}`;

/** Konten, die Mandanten sind (Rolle Mandant oder Mandant einer Akte/Rechnung), und eindeutige Namen → Konto. */
function accounts() {
  const rows = db
    .prepare(
      `SELECT id, display_name, email, phone, discord_id, discord_username, avatar, discord_avatar, role, active, created_at FROM users
        WHERE role = 'mandant' OR id IN (SELECT client_id FROM cases WHERE client_id IS NOT NULL)
           OR id IN (SELECT client_user_id FROM invoices WHERE client_user_id IS NOT NULL)`
    )
    .all();
  const byName = new Map();
  for (const u of rows) {
    const k = norm(u.display_name);
    byName.set(k, byName.has(k) ? null : u.id); // gleicher Name zweimal → nicht zuordnen
  }
  return { rows, byName };
}

/** Schlüssel „u<ID>“ für Konten; „n:<name>“ wird zum Konto, wenn der Name genau einem Konto gehört. */
function resolve(key, byName) {
  const k = String(key || '');
  if (/^u\d+$/.test(k)) return k;
  if (k.startsWith('n:') && k.length > 2) {
    const uid = byName.get(norm(k.slice(2)));
    return uid ? `u${uid}` : nameKey(k.slice(2));
  }
  return null;
}

/** Alle Mandanten mit ihren Akten und Rechnungen: Map Schlüssel → { userId, name, caseIds, invoiceIds }. */
function buildIndex() {
  const { rows, byName } = accounts();
  const index = new Map();
  const entry = (key, init) => {
    if (!index.has(key)) index.set(key, { key, userId: null, name: '', caseIds: [], invoiceIds: [], ...init });
    return index.get(key);
  };
  for (const u of rows) entry(`u${u.id}`, { userId: u.id, name: u.display_name, account: u });
  const caseKey = new Map();
  for (const c of db.prepare("SELECT id, client_id, client_name FROM cases ORDER BY id").all()) {
    let key = null;
    if (c.client_id) key = `u${c.client_id}`;
    else if (norm(c.client_name)) key = resolve(nameKey(c.client_name), byName);
    if (!key) continue;
    caseKey.set(c.id, key);
    entry(key, { name: c.client_name }).caseIds.push(c.id);
  }
  for (const i of db.prepare('SELECT id, client_user_id, client_name, case_id FROM invoices ORDER BY id').all()) {
    let key = null;
    if (i.client_user_id) key = `u${i.client_user_id}`;
    else if (i.case_id && caseKey.has(i.case_id)) key = caseKey.get(i.case_id);
    else if (norm(i.client_name)) key = resolve(nameKey(i.client_name), byName);
    if (!key) continue;
    entry(key, { name: i.client_name }).invoiceIds.push(i.id);
  }
  return { index, byName };
}

/** Schlüssel, unter denen Notizen/Vermerk eines Mandanten liegen können (Konto und – vor der Verknüpfung – Name). */
function aliasKeys(entry) {
  const keys = [entry.key];
  if (entry.userId && entry.account) keys.push(nameKey(entry.account.display_name));
  return keys;
}

function flagOf(keys) {
  for (const k of keys) {
    const f = db.prepare('SELECT * FROM client_flags WHERE client_key = ?').get(k);
    if (f) return { flag: f.flag, label: FLAGS[f.flag], reason: f.reason, setBy: f.set_by_name, setAt: f.set_at };
  }
  return null;
}

/** Vermerk zum Mandanten einer Akte (für den Hinweis in der Akte und bei neuen Anfragen). */
function flagForCase(c) {
  if (!c) return null;
  if (c.client_id) {
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(c.client_id);
    return flagOf([`u${c.client_id}`, ...(u ? [nameKey(u.display_name)] : [])]);
  }
  if (!norm(c.client_name)) return null;
  const { byName } = accounts();
  const key = resolve(nameKey(c.client_name), byName);
  return flagOf([...new Set([key, nameKey(c.client_name)])]);
}

/** Zusatzfeld für Discord-Meldungen an die Kanzlei (nie ins Ticket – dort liest der Mandant mit). */
function flagField(c) {
  const f = flagForCase(c);
  return f ? { name: '⚠️ Mandantenvermerk', value: truncate(`${f.label}${f.reason ? ` – ${f.reason}` : ''}`, 300) } : null;
}

/* ---------------------------------------------------------------- Geburtsdatum (IC) */
const BIRTH_MAX = 40;
/** Schlüssel eines Mandanten zu Akte bzw. Name (Konto, wenn der Name genau einem Konto gehört). */
function keysFor(c, name) {
  const { byName } = accounts();
  const keys = [];
  if (c && c.client_id) {
    keys.push(`u${c.client_id}`);
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(c.client_id);
    if (u) keys.push(nameKey(u.display_name));
  }
  for (const n of [name, c && c.client_name]) if (norm(n)) keys.push(resolve(nameKey(n), byName), nameKey(n));
  return [...new Set(keys.filter(Boolean))];
}
/**
 * Geburtsdatum eines Mandanten: aus der Kartei – sonst aus dem jüngsten Vertrag mit demselben Mandanten (Konto oder
 * gleicher Name, auch in einer anderen Akte).
 */
function birthFor(c, name) {
  const keys = keysFor(c, name);
  if (keys.length) {
    const p = db.prepare(`SELECT birth FROM client_profiles WHERE client_key IN (${keys.map(() => '?').join(',')}) AND birth != '' ORDER BY updated_at DESC LIMIT 1`).get(...keys);
    if (p) return p.birth;
  }
  const want = new Set([norm(name), norm(c && c.client_name)].filter(Boolean));
  for (const r of db.prepare("SELECT k.data, x.client_id FROM case_contracts k JOIN cases x ON x.id = k.case_id WHERE k.data LIKE '%mandant_geburtsdatum%' ORDER BY k.id DESC LIMIT 500").all()) {
    let d = {};
    try {
      d = JSON.parse(r.data || '{}');
    } catch {
      continue;
    }
    if (!d.mandant_geburtsdatum) continue;
    if ((c && c.client_id && r.client_id === c.client_id) || want.has(norm(d.mandant))) return d.mandant_geburtsdatum;
  }
  return '';
}
/** Geburtsdatum aus einem Vertrag in der Kartei merken (beim nächsten Vertrag steht es schon drin). */
function rememberBirth(c, name, birth, user) {
  const b = String(birth || '').trim().slice(0, BIRTH_MAX);
  const key = keysFor(c, name)[0];
  if (!b || !key) return;
  db.prepare(
    `INSERT INTO client_profiles (client_key, birth, updated_by_name) VALUES (?, ?, ?)
     ON CONFLICT(client_key) DO UPDATE SET birth = excluded.birth, updated_by_name = excluded.updated_by_name, updated_at = datetime('now')`
  ).run(key, b, user ? user.display_name : '');
}

const membershipOf = (userId) =>
  userId
    ? db
        .prepare(
          `SELECT tier_name, kind, discount_pct, expires_at FROM memberships WHERE user_id = ? AND status = 'aktiv'
             AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ORDER BY discount_pct DESC LIMIT 1`
        )
        .get(userId) || null
    : null;

const inList = (ids) => ids.map(() => '?').join(',');

/* ---------------------------------------------------------------- Liste */
router.get('/', (req, res) => {
  const { index } = buildIndex();
  const cases = new Map(db.prepare('SELECT id, status, created_at, updated_at FROM cases').all().map((c) => [c.id, c]));
  const invoices = new Map(db.prepare('SELECT id, status, total, due_date, created_at, paid_at FROM invoices').all().map((i) => [i.id, i]));
  const flags = new Map(db.prepare('SELECT * FROM client_flags').all().map((f) => [f.client_key, f]));
  const memberships = new Map(
    db
      .prepare(
        `SELECT user_id, tier_name, kind FROM memberships WHERE status = 'aktiv'
           AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ORDER BY discount_pct`
      )
      .all()
      .map((m) => [m.user_id, m])
  );
  const list = [...index.values()].map((e) => {
    const cs = e.caseIds.map((id) => cases.get(id)).filter(Boolean);
    const inv = e.invoiceIds.map((id) => invoices.get(id)).filter(Boolean);
    const open = inv.filter((i) => i.status === 'offen');
    const dates = [e.account && e.account.created_at, ...cs.map((c) => c.updated_at), ...inv.map((i) => i.paid_at || i.created_at)].filter(Boolean);
    const f = aliasKeys(e).map((k) => flags.get(k)).find(Boolean);
    const m = e.userId ? memberships.get(e.userId) : null;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = open.filter((i) => i.due_date && String(i.due_date).slice(0, 10) < today);
    const oldest = open.map((i) => i.created_at).filter(Boolean).sort()[0];
    const since = [e.account && e.account.created_at, ...cs.map((c) => c.created_at)].filter(Boolean).sort()[0];
    return {
      key: e.key,
      avatarUrl: e.account ? userAvatarUrl(e.account) : null,
      name: (e.account && e.account.display_name) || e.name || '—',
      email: e.account ? e.account.email : null,
      hasAccount: !!e.userId,
      casesOpen: cs.filter((c) => c.status !== 'geschlossen').length,
      casesTotal: cs.length,
      openSum: open.reduce((s, i) => s + i.total, 0),
      openCount: open.length,
      overdueCount: overdue.length,
      openOldestDays: oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 864e5)) : null,
      isNew: !!since && Date.now() - new Date(since).getTime() < 14 * 864e5,
      membership: m ? { name: m.tier_name, kind: m.kind } : null,
      flag: f ? { flag: f.flag, label: FLAGS[f.flag] } : null,
      lastActivity: dates.sort().pop() || null,
    };
  });
  list.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')) || a.name.localeCompare(b.name, 'de'));
  res.json({ clients: list });
});

/* ---------------------------------------------------------------- Karte */
function card(key, u) {
  const { index, byName } = buildIndex();
  const k = resolve(key, byName);
  const e = k && index.get(k);
  if (!e) return null;
  const keys = aliasKeys(e);
  const cases = e.caseIds.length ? db.prepare(`${CASE_SELECT} WHERE c.id IN (${inList(e.caseIds)}) ORDER BY c.updated_at DESC`).all(...e.caseIds).map((c) => caseRow(c, u)) : [];
  const invRows = e.invoiceIds.length ? db.prepare(`${INVOICE_SELECT} WHERE i.id IN (${inList(e.invoiceIds)}) ORDER BY i.created_at DESC, i.id DESC`).all(...e.invoiceIds) : [];
  const gdocs = require('../googleDocs');
  const invDocs = gdocs.urls('invoice', invRows.map((i) => i.id));
  const invoices = invRows.map((i) => ({ ...invoiceRow(i), googleDoc: invDocs.get(i.id) }));
  const { contractsForCase } = require('./contracts');
  const contracts = cases.flatMap((c) => contractsForCase(c.id, u).map((x) => ({ ...x, caseId: c.id, caseNumber: c.caseNumber })));
  const conDocs = gdocs.urls('contract', contracts.map((x) => x.id));
  const notes = db
    .prepare(`SELECT * FROM client_notes WHERE client_key IN (${inList(keys)}) ORDER BY created_at DESC, id DESC`)
    .all(...keys)
    .map((n) => ({ id: n.id, body: n.body, author: n.author_name, authorId: n.author_id, createdAt: n.created_at }));
  const open = invoices.filter((i) => i.status === 'offen');
  const a = e.account;
  const phone = (a && a.phone) || (cases.find((c) => c.clientPhone) || {}).clientPhone || '';
  const since = [a && a.created_at, ...cases.map((c) => c.createdAt)].filter(Boolean).sort()[0] || null;
  return {
    key: e.key,
    name: (a && a.display_name) || e.name || '—',
    account: a ? { email: a.email, discord: a.discord_username || (a.discord_id ? 'verknüpft' : null), active: !!a.active, createdAt: a.created_at, staff: a.role !== 'mandant' } : null,
    phone,
    since,
    membership: membershipOf(e.userId),
    flag: flagOf(keys),
    birth: (db.prepare(`SELECT birth FROM client_profiles WHERE client_key IN (${inList(keys)}) AND birth != '' ORDER BY updated_at DESC LIMIT 1`).get(...keys) || {}).birth || birthFor(e.userId ? { client_id: e.userId } : null, (a && a.display_name) || e.name),
    stats: {
      casesOpen: cases.filter((c) => c.status !== 'geschlossen').length,
      casesTotal: cases.length,
      openSum: open.reduce((s, i) => s + i.total, 0),
      openCount: open.length,
      paidSum: invoices.filter((i) => i.status === 'bezahlt').reduce((s, i) => s + i.total, 0),
    },
    cases,
    invoices,
    contracts: contracts.map((x) => ({ ...x, googleDoc: conDocs.get(x.id) })),
    notes,
    canFlag: isBoard(u),
  };
}

router.get('/:key', (req, res) => {
  const c = card(req.params.key, req.user);
  if (!c) return res.status(404).json({ error: 'Mandant nicht gefunden.' });
  res.json(c);
});

/* ---------------------------------------------------------------- Notizen & Vermerk */
router.post(
  '/:key/notes',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ body: z.string().trim().min(1, 'Bitte einen Text eingeben.').max(2000) }), req, res);
    if (!d) return;
    const { index, byName } = buildIndex();
    const k = resolve(req.params.key, byName);
    if (!k || !index.has(k)) return res.status(404).json({ error: 'Mandant nicht gefunden.' });
    db.prepare('INSERT INTO client_notes (client_key, body, author_id, author_name) VALUES (?, ?, ?, ?)').run(k, d.body, req.user.id, req.user.display_name);
    res.status(201).json(card(k, req.user));
  })
);

router.delete('/notes/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM client_notes WHERE id = ?').get(Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
  if (n.author_id !== req.user.id && !isBoard(req.user)) return res.status(403).json({ error: 'Nur eigene Notizen lassen sich löschen.' });
  db.prepare('DELETE FROM client_notes WHERE id = ?').run(n.id);
  res.json({ success: true });
});

router.put(
  '/:key/birth',
  wrap(async (req, res) => {
    const d = parseBody(z.object({ birth: z.string().trim().max(BIRTH_MAX) }), req, res);
    if (!d) return;
    const { index, byName } = buildIndex();
    const k = resolve(req.params.key, byName);
    const e = k && index.get(k);
    if (!e) return res.status(404).json({ error: 'Mandant nicht gefunden.' });
    db.prepare(`DELETE FROM client_profiles WHERE client_key IN (${inList(aliasKeys(e))})`).run(...aliasKeys(e));
    if (d.birth) db.prepare('INSERT INTO client_profiles (client_key, birth, updated_by_name) VALUES (?, ?, ?)').run(k, d.birth, req.user.display_name);
    res.json(card(k, req.user));
  })
);

router.put(
  '/:key/flag',
  wrap(async (req, res) => {
    if (!isBoard(req.user)) return res.status(403).json({ error: 'Den Vermerk setzt das Board of Partners.' });
    const d = parseBody(z.object({ flag: z.enum(['', 'vorkasse', 'sperre']), reason: z.string().trim().max(300).optional().default('') }), req, res);
    if (!d) return;
    const { index, byName } = buildIndex();
    const k = resolve(req.params.key, byName);
    const e = k && index.get(k);
    if (!e) return res.status(404).json({ error: 'Mandant nicht gefunden.' });
    const name = (e.account && e.account.display_name) || e.name;
    db.prepare(`DELETE FROM client_flags WHERE client_key IN (${inList(aliasKeys(e))})`).run(...aliasKeys(e));
    if (d.flag) {
      db.prepare('INSERT INTO client_flags (client_key, flag, reason, set_by, set_by_name) VALUES (?, ?, ?, ?, ?)').run(k, d.flag, d.reason, req.user.id, req.user.display_name);
      logActivity(req.user, 'Mandantenvermerk gesetzt', 'client', e.userId, `${name}: ${FLAGS[d.flag]}${d.reason ? ` – ${d.reason}` : ''}`);
    } else {
      logActivity(req.user, 'Mandantenvermerk aufgehoben', 'client', e.userId, name);
    }
    res.json(card(k, req.user));
  })
);

module.exports = { router, flagForCase, flagField, birthFor, rememberBirth, clientKeyForCase: (c) => (c.client_id ? `u${c.client_id}` : norm(c.client_name) ? nameKey(c.client_name) : null) };
