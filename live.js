'use strict';
/*
 * Live-Aktualisierung des Dashboards (Server-Sent Events, GET /api/events).
 *
 * Geschickt wird nur, DASS sich etwas geändert hat – nie Inhalte:
 *   { k: 'case', id, chat }  Akte geändert (chat = nur Nachrichten/Gelesen) – nur an Personen, die die Akte sehen dürfen
 *   { k: 'area', a }         Bereich geändert (Aufgaben, Kalender, Post …) – nur an die Kanzlei
 * Das Dashboard lädt daraufhin über die normale API nach; dort gelten die üblichen Rechte.
 * Der Tab, der die Änderung selbst gemacht hat (Kopfzeile X-PS-Tab), bekommt sie nicht noch einmal.
 */
const { db } = require('./db');
const { isStaff } = require('./auth');

const clients = new Set(); // { res, userId, tab }
const HEARTBEAT_MS = 25000; // hält die Verbindung durch Proxys (Render) offen

function handler(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client = { res, userId: req.user.id, tab: String(req.query.tab || '').slice(0, 40) };
  clients.add(client);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  beat.unref();
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
  });
}

// Nutzer frisch aus der Datenbank: Rechte gelten wie bei jeder Anfrage (gesperrt = nichts mehr)
const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id);

function send(event, { exceptTab = '' } = {}) {
  if (!clients.size) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const { getCase, caseAccess } = require('./models');
  const c = event.k === 'case' ? getCase(event.id) : null;
  if (event.k === 'case' && !c) return;
  const users = new Map();
  for (const cl of clients) {
    if (exceptTab && cl.tab === exceptTab) continue;
    if (!users.has(cl.userId)) users.set(cl.userId, userById(cl.userId) || null);
    const u = users.get(cl.userId);
    if (!u) continue;
    // Akte: wer sie sehen darf; alles andere: nur die Kanzlei
    if (event.k === 'case' ? !caseAccess(c, u).canView : !isStaff(u)) continue;
    try {
      cl.res.write(data);
    } catch {
      clients.delete(cl);
    }
  }
}

const caseChanged = (id, { chat = false, exceptTab } = {}) => Number(id) > 0 && send({ k: 'case', id: Number(id), chat: !!chat }, { exceptTab });
const areaChanged = (area, { exceptTab } = {}) => area && send({ k: 'area', a: String(area) }, { exceptTab });

/** Bereich einer API-Adresse: /api/admin/applications → applications, sonst der erste Teil. */
function areaOf(path) {
  const seg = path.split('/').filter(Boolean);
  return seg[0] === 'admin' ? seg[1] : seg[0];
}

const AREA_SKIP = new Set(['auth', 'events', 'search', 'discord', 'public', 'fees', 'site', 'gdocs', 'gsheets', 'fivenet']);
// Öffentliche Seiten (ohne Anmeldung): nur echte Eingänge melden – Abfragen (Status, Bewerberseite lesen) nicht
const PUBLIC_AREAS = {
  '/public/cases': 'cases',
  '/public/applications': 'applications',
  '/public/application-portal/messages': 'applications',
  '/public/concerns': 'concerns',
  '/public/concern-reply': 'concerns',
};

/**
 * Nach jeder erfolgreichen Änderung über die API (POST/PATCH/PUT/DELETE unter /api) melden, was sich geändert hat.
 * Änderungen ohne Webanfrage (Discord, Zeitpläne) melden ihre Module selbst (caseChanged/areaChanged).
 */
function middleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.path; // relativ zu /api
  const tab = String(req.get('x-ps-tab') || '').slice(0, 40);
  res.on('finish', () => {
    if (res.statusCode >= 400 || !clients.size) return;
    try {
      if (PUBLIC_AREAS[path]) return areaChanged(PUBLIC_AREAS[path]);
      const area = areaOf(path);
      const m = path.match(/^\/(cases|contracts|invoices)\/(\d+)(\/[^/]+)?/);
      // Nur „gelesen“ im Chat: betrifft die Akte, aber keine Listen der ganzen Kanzlei
      if (m && m[1] === 'cases' && /^\/chat/.test(m[3] || '')) return caseChanged(m[2], { chat: true, exceptTab: tab });
      if (m && m[1] === 'cases') caseChanged(m[2], { exceptTab: tab });
      else if (m && m[1] === 'contracts') {
        const k = db.prepare('SELECT case_id FROM case_contracts WHERE id = ?').get(Number(m[2]));
        if (k) caseChanged(k.case_id, { exceptTab: tab });
      } else if (m && m[1] === 'invoices') {
        const inv = db.prepare('SELECT case_id FROM invoices WHERE id = ?').get(Number(m[2]));
        if (inv && inv.case_id) caseChanged(inv.case_id, { exceptTab: tab });
      }
      if (!AREA_SKIP.has(area)) areaChanged(area, { exceptTab: tab });
    } catch (err) {
      console.warn('Live-Aktualisierung:', err.message);
    }
  });
  next();
}

const count = () => clients.size;

module.exports = { handler, middleware, caseChanged, areaChanged, count };
