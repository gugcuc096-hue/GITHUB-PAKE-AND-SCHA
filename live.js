'use strict';
/*
 * Live-Aktualisierung des Dashboards (Server-Sent Events, GET /api/events).
 *
 * Geschickt wird nur, DASS sich etwas geändert hat – nie Inhalte:
 *   { k: 'case', id, chat }  Akte geändert (chat = nur Nachrichten/Gelesen) – nur an Personen, die die Akte sehen dürfen
 *   { k: 'area', a }         Bereich geändert (Aufgaben, Kalender, Post …) – nur an die Kanzlei
 *   { k: 'presence', id, users }  wer aus der Kanzlei die Akte gerade offen hat – nur an die Kanzlei in dieser Akte
 *   { k: 'typing', id, name }     jemand schreibt im Akten-Chat – an alle anderen, die die Akte gerade offen haben
 * Das Dashboard lädt daraufhin über die normale API nach; dort gelten die üblichen Rechte.
 * Der Tab, der die Änderung selbst gemacht hat (Kopfzeile X-PS-Tab), bekommt sie nicht noch einmal.
 */
const { db } = require('./db');
const { isStaff } = require('./auth');

const clients = new Set(); // { res, userId, tab, caseId }
const HEARTBEAT_MS = 25000; // hält die Verbindung durch Proxys (Render) offen

function handler(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  // Fassung des Programmcodes: weicht sie vom offenen Dashboard ab, bietet es „Neu laden“ an (Update eingespielt)
  res.write(`data: ${JSON.stringify({ k: 'hello', v: require('./assets').version() })}\n\n`);
  const client = { res, userId: req.user.id, tab: String(req.query.tab || '').slice(0, 40) };
  clients.add(client);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  beat.unref();
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
    if (client.caseId) presenceChanged(client.caseId);
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
    if (res.statusCode >= 400) return;
    require('./routes/start').invalidate(); // Zähler der Navigation neu berechnen
    if (!clients.size) return;
    // Vorschaubild eines Anhangs: ändert für andere nichts Sichtbares – niemand muss neu laden
    if (/^\/cases\/\d+\/attachments\/\d+\/thumb$/.test(path)) return;
    // Merkliste (Stern): gilt nur für die eigene Person – andere müssen nichts nachladen
    if (/^\/cases\/\d+\/star$/.test(path)) return;
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

/*
 * „Wer ist gerade hier?“ – je Tab merkt sich der Server nur im Speicher, welche Akte offen ist (POST /api/events/presence).
 * Die Angabe hängt an der Live-Verbindung: schließt der Tab, ist sie weg. Gezeigt werden nur Kolleginnen und Kollegen
 * der Kanzlei (nie Mandanten); „tippt gerade“ sehen alle anderen in derselben Akte – Mandanten nur „Die Kanzlei“.
 */
function write(cl, event) {
  try {
    cl.res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    clients.delete(cl);
  }
}

/** Wer aus der Kanzlei die Akte gerade offen hat (jede Person einmal, auch mit mehreren Tabs). */
function presentStaff(caseId) {
  const { userAvatarUrl } = require('./auth');
  const seen = new Map();
  for (const cl of clients) {
    if (cl.caseId !== caseId || seen.has(cl.userId)) continue;
    const u = userById(cl.userId);
    if (u && isStaff(u)) seen.set(u.id, { id: u.id, name: u.display_name, avatarUrl: userAvatarUrl(u) || null });
  }
  return [...seen.values()];
}

function presenceChanged(caseId) {
  const users = presentStaff(caseId);
  const staff = new Map();
  for (const cl of clients) {
    if (cl.caseId !== caseId) continue;
    if (!staff.has(cl.userId)) staff.set(cl.userId, isStaff(userById(cl.userId)));
    if (staff.get(cl.userId)) write(cl, { k: 'presence', id: caseId, users });
  }
}

function presence(req, res) {
  const { getCase, caseAccess } = require('./models');
  const tab = String(req.get('x-ps-tab') || '').slice(0, 40);
  const caseId = Number(req.body?.caseId) || null;
  let c = null;
  if (caseId) {
    c = getCase(caseId);
    if (!c || !caseAccess(c, req.user).canView) return res.status(404).json({ error: 'Akte nicht gefunden.' });
  }
  const mine = [...clients].filter((cl) => cl.userId === req.user.id && cl.tab === tab);
  // Ohne Live-Verbindung gibt es nichts zu merken (sie meldet sich nach dem Verbinden erneut)
  if (!mine.length) return res.json({ ok: false, users: [] });
  const before = new Set(mine.map((cl) => cl.caseId || null));
  mine.forEach((cl) => (cl.caseId = caseId));
  for (const id of before) if (id && id !== caseId) presenceChanged(id);
  if (caseId && !before.has(caseId)) presenceChanged(caseId);
  if (caseId && req.body?.typing) {
    const staffTyping = isStaff(req.user);
    for (const cl of clients) {
      if (cl.caseId !== caseId || cl.userId === req.user.id) continue;
      const u = userById(cl.userId);
      if (!u || !caseAccess(c, u).canView) continue;
      write(cl, { k: 'typing', id: caseId, name: staffTyping && !isStaff(u) ? 'Die Kanzlei' : req.user.display_name });
    }
  }
  res.json({ ok: true, users: caseId && isStaff(req.user) ? presentStaff(caseId) : [] });
}

const count = () => clients.size;

module.exports = { handler, middleware, presence, caseChanged, areaChanged, count };
