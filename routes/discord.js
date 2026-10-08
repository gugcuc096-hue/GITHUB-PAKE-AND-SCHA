'use strict';
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, tx } = require('../db');
const { requireAuth, createSession, publicUser, hashPassword, generateStrongPassword } = require('../auth');
const { wrap } = require('../helpers');
const { getCase, addSystemNote, logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');

const router = express.Router();
const STATE_COOKIE = 'ds_state';
const STATE_MAX_AGE = 10 * 60 * 1000;

function stateCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/discord' };
}

/**
 * mode: login | signup | link | case | application. Außer beim reinen Login wird zusätzlich „guilds.join“
 * angefragt (nur wenn Discord-Tickets aktiv sind) – damit fügt der Bot den Mandanten dem Server hinzu.
 */
const FAIL_TARGET = { login: '/login.html', signup: '/register.html', case: '/', application: '/bewerbung.html' };
function startFlow(req, res, mode, extra = '') {
  const cfg = discord.oauthConfig(req);
  if (!cfg) {
    const target = FAIL_TARGET[mode] ? `${FAIL_TARGET[mode]}?${mode === 'case' ? 'ticket' : 'discord'}=disabled` : '/dashboard.html?discord=disabled#profile';
    return res.redirect(target);
  }
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, [mode, state, extra].filter(Boolean).join('.'), { ...stateCookieOptions(), maxAge: STATE_MAX_AGE });
  const scopes = mode !== 'login' && tickets.active() ? ['identify', 'guilds.join'] : ['identify'];
  // Ticket-Beitritt immer mit Discord-Bestätigung (kein stilles Durchwinken)
  res.redirect(discord.authorizeUrl(cfg, state, scopes, ['case', 'application', 'signup'].includes(mode) ? 'consent' : 'none'));
}

/* ================================================================
   Konto per Discord – ohne Passwort
   ================================================================
 * „Mit Discord registrieren“ (Registrierung) und „Konto mit Discord anlegen“ (direkt nach einer Mandatsanfrage auf
 * der Website, mit Aktenzeichen + Pin) legen ein Mandantenkonto an bzw. melden an, wenn es schon eins gibt.
 * „Mit Discord anmelden“ ohne Konto fragt dagegen erst nach (Login-Seite): So entsteht nicht aus Versehen ein
 * zweites Konto, etwa für Mitarbeiter, die ihr Discord noch nicht verknüpft haben.
 * Der Name im Spiel (IC) kommt aus der Mandatsanfrage – sonst wird er beim ersten Besuch im Dashboard abgefragt.
 */
const PENDING_COOKIE = 'ds_signup';
const pendingSignups = new Map(); // Schlüssel → { profile, until }
function rememberPending(res, profile) {
  for (const [k, v] of pendingSignups) if (v.until < Date.now()) pendingSignups.delete(k);
  const key = crypto.randomBytes(24).toString('hex');
  pendingSignups.set(key, { profile: { id: profile.id, username: profile.username, handle: profile.handle, avatar: profile.avatar }, until: Date.now() + STATE_MAX_AGE });
  res.cookie(PENDING_COOKIE, key, { ...stateCookieOptions(), maxAge: STATE_MAX_AGE });
}
function takePending(req, res, { keep = false } = {}) {
  const key = String(req.cookies?.[PENDING_COOKIE] || '');
  const p = pendingSignups.get(key);
  if (!p || p.until < Date.now()) return null;
  if (!keep) {
    pendingSignups.delete(key);
    res.clearCookie(PENDING_COOKIE, stateCookieOptions());
  }
  return p.profile;
}

/** Neues Mandantenkonto für ein Discord-Profil (Login nur über Discord; ein Passwort gibt es per /passwort). */
function createDiscordAccount(profile, name) {
  const ic = String(name || '').replace(/\s+/g, ' ').trim();
  const displayName = (ic.length >= 2 ? ic : profile.username || profile.handle || 'Mandant').slice(0, 80);
  const email = require('../botDm').freeEmail(ic.length >= 2 ? ic : profile.handle || profile.username || '', profile.id);
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, role, discord_id, discord_username, discord_avatar, created_via, needs_name)
       VALUES (?, ?, ?, 'mandant', ?, ?, ?, 'discord', ?)`
    )
    .run(email, hashPassword(generateStrongPassword()), displayName, profile.id, profile.username, profile.avatar, ic.length >= 2 ? 0 : 1);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  logActivity(user, 'Konto per Discord angelegt', 'user', user.id, `${user.display_name} (${user.email})`);
  return user;
}

/** Akte aus der Mandatsanfrage mit dem (neuen) Konto verbinden – nur, wenn sie noch keinem Konto gehört. */
function attachCase(caseId, user, discordId) {
  const c = getCase(caseId);
  if (!c || user.role !== 'mandant') return null;
  if (c.client_id && c.client_id !== user.id) return null;
  if (!c.client_id) {
    tx(() => {
      db.prepare("UPDATE cases SET client_id = ?, discord_client_id = COALESCE(discord_client_id, ?), updated_at = datetime('now') WHERE id = ?").run(user.id, discordId, c.id);
      db.prepare('UPDATE appointments SET client_id = ? WHERE case_id = ? AND client_id IS NULL').run(user.id, c.id);
      addSystemNote(c.id, user, 'Mandant hat über Discord ein Konto angelegt – die Akte ist jetzt im Mandantenportal.');
    });
  }
  return c.id;
}

/** Nach der Anmeldung über Discord: Server beitreten (falls erlaubt) und Tickets/Rollen abgleichen. */
async function afterDiscordLogin(user, profile) {
  if (tickets.active()) {
    if (profile.scope && profile.scope.includes('guilds.join')) await within(tickets.joinGuild(profile.id, profile.accessToken), 8000);
    await within(tickets.syncUser(user.id), 8000);
  }
  require('../memberships').syncUser(user.id).catch(() => {});
}

router.get('/register', (req, res) => startFlow(req, res, 'signup'));

/** Login-Seite nach „Mit Discord anmelden“ ohne Konto: für welches Discord würde ein Konto angelegt? */
router.get('/pending', (req, res) => {
  const p = takePending(req, res, { keep: true });
  res.json({ pending: p ? { name: p.username || p.handle || 'Discord' } : null });
});

/** … und nach Bestätigung anlegen. */
router.post(
  '/signup',
  wrap(async (req, res) => {
    const profile = takePending(req, res);
    if (!profile) return res.status(400).json({ error: 'Die Discord-Anmeldung ist abgelaufen. Bitte erneut „Mit Discord anmelden“.' });
    let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
    if (user && !user.active) return res.status(403).json({ error: 'Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.' });
    if (!user) user = createDiscordAccount(profile, '');
    createSession(res, user.id);
    await afterDiscordLogin(user, profile);
    res.json({ success: true, redirect: '/dashboard.html' });
  })
);

router.get('/status', (req, res) => {
  res.json({ oauth: !!discord.oauthConfig(req), tickets: tickets.active() });
});

// Verknüpfen: nur für angemeldete Nutzer (Navigation, daher Weiterleitung statt JSON-Fehler).
router.get('/connect', (req, res) => {
  if (!req.user) return res.redirect('/login.html?next=' + encodeURIComponent('/dashboard.html#profile'));
  startFlow(req, res, 'link');
});

router.get('/login', (req, res) => startFlow(req, res, 'login'));

/*
 * Discord-Ticket beitreten ohne Konto: direkt nach dem Einreichen eines Mandats (Aktenzeichen + Pin aus der Antwort, POST –
 * der Pin steht so nicht in der Adresszeile). Danach Discord-Anmeldung; der Mandant wird dem Server
 * und dem Ticket seiner Akte hinzugefügt.
 */
const joinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.redirect('/?ticket=limit') });
/** Nur Formulare der eigenen Website (Schutz vor fremden Seiten, die den Ablauf anstoßen). */
function fromOwnSite(req) {
  const origin = req.get('origin');
  if (!origin || (origin === 'null' && req.get('sec-fetch-site') === 'same-origin')) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

router.post('/case-join', express.urlencoded({ extended: false, limit: '2kb' }), joinLimiter, (req, res) => {
  if (!fromOwnSite(req)) return res.redirect('/?ticket=error');
  const number = String(req.body?.caseNumber || '').trim().toUpperCase().slice(0, 30);
  const pin = String(req.body?.pin || '').trim().slice(0, 10);
  if (!tickets.active()) return res.redirect('/?ticket=disabled');
  const c = number && pin ? db.prepare('SELECT id FROM cases WHERE case_number = ? AND access_pin = ?').get(number, pin) : null;
  if (!c) return res.redirect('/?ticket=notfound');
  startFlow(req, res, 'case', String(c.id));
});

/** Direkt nach der Mandatsanfrage: Konto mit Discord anlegen – die Akte hängt danach am Konto. */
router.post('/case-account', express.urlencoded({ extended: false, limit: '2kb' }), joinLimiter, (req, res) => {
  if (!fromOwnSite(req)) return res.redirect('/?ticket=error');
  const number = String(req.body?.caseNumber || '').trim().toUpperCase().slice(0, 30);
  const pin = String(req.body?.pin || '').trim().slice(0, 10);
  const c = number && pin ? db.prepare('SELECT id FROM cases WHERE case_number = ? AND access_pin = ?').get(number, pin) : null;
  if (!c) return res.redirect('/?ticket=notfound');
  startFlow(req, res, 'signup', String(c.id));
});

/*
 * Bewerber verbindet sein Discord (Bewerberseite, persönlicher Link): Antworten des Boards und neue Stände kommen
 * dann als Direktnachricht. Der Link-Schlüssel kommt per POST (nicht in der Adresszeile).
 */
router.post('/application-join', express.urlencoded({ extended: false, limit: '2kb' }), joinLimiter, (req, res) => {
  if (!fromOwnSite(req)) return res.redirect('/bewerbung.html?discord=error');
  const token = String(req.body?.token || '').trim().slice(0, 64);
  const a = token.length >= 20 ? db.prepare('SELECT id FROM applications WHERE access_token = ?').get(token) : null;
  if (!a) return res.redirect('/bewerbung.html?discord=notfound');
  startFlow(req, res, 'application', String(a.id));
});

/** Wartet höchstens ms auf den Abgleich (die Weiterleitung soll nicht hängen). */
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

router.get(
  '/callback',
  wrap(async (req, res) => {
    const raw = req.cookies?.[STATE_COOKIE] || '';
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
    const [mode, expected, extra] = raw.split('.');
    const failTarget = FAIL_TARGET[mode] || '/dashboard.html';
    const fail = (code) => res.redirect(`${failTarget}?${mode === 'case' ? 'ticket' : 'discord'}=${code}${FAIL_TARGET[mode] ? '' : '#profile'}`);

    if (!expected || req.query.state !== expected) return fail('state');
    if (req.query.error) return fail('denied');
    const cfg = discord.oauthConfig(req);
    if (!cfg || typeof req.query.code !== 'string') return fail('error');

    let profile;
    try {
      profile = await discord.fetchDiscordUser(cfg, req.query.code);
    } catch (err) {
      console.warn('Discord-OAuth fehlgeschlagen:', err.message);
      return fail('error');
    }

    if (mode === 'login') {
      const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
      if (!user) {
        // Noch kein Konto: auf der Login-Seite nachfragen (neues Mandantenkonto oder mit E-Mail anmelden und verknüpfen)
        rememberPending(res, profile);
        return res.redirect('/login.html?discord=neu');
      }
      if (!user.active) return fail('locked');
      db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?').run(profile.username, profile.avatar, user.id);
      createSession(res, user.id);
      return res.redirect('/dashboard.html');
    }

    // Registrieren mit Discord (ggf. mit der Akte aus der Mandatsanfrage): Konto anlegen oder anmelden
    if (mode === 'signup') {
      const caseId = Number(extra) || null;
      const c = caseId ? getCase(caseId) : null;
      let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
      if (user && !user.active) return fail('locked');
      // Name aus der Mandatsanfrage nur, solange die Akte noch keinem Konto gehört
      if (!user) user = createDiscordAccount(profile, c && !c.client_id ? c.client_name : '');
      else db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?').run(profile.username, profile.avatar, user.id);
      const attached = c ? attachCase(c.id, user, profile.id) : null;
      createSession(res, user.id);
      await afterDiscordLogin(user, profile);
      if (c && !attached) return res.redirect('/dashboard.html?discord=fremdeakte');
      return res.redirect(attached ? `/dashboard.html?case=${attached}#cases` : '/dashboard.html?discord=willkommen');
    }

    // Ticket beitreten (ohne Konto): Discord-ID an der Akte merken, dem Server hinzufügen, Ticket abgleichen
    if (mode === 'case') {
      const caseId = Number(extra);
      const c = Number.isInteger(caseId) && caseId > 0 ? db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId) : null;
      if (!c || !tickets.active()) return fail('error');
      db.prepare('UPDATE cases SET discord_client_id = ? WHERE id = ?').run(profile.id, c.id);
      if (profile.scope.includes('guilds.join')) await tickets.joinGuild(profile.id, profile.accessToken);
      await within(tickets.syncCase(c.id), 8000);
      const info = tickets.ticketInfo(db.prepare('SELECT * FROM cases WHERE id = ?').get(c.id), null);
      if (info && info.url && info.clientInTicket) return res.redirect(info.url);
      return res.redirect('/?ticket=pending');
    }

    // Bewerber: Discord an der Bewerbung merken (für Direktnachrichten), dem Server beitreten, Bestätigung schicken
    if (mode === 'application') {
      const appId = Number(extra);
      const a = Number.isInteger(appId) && appId > 0 ? db.prepare('SELECT * FROM applications WHERE id = ?').get(appId) : null;
      if (!a) return fail('error');
      db.prepare('UPDATE applications SET discord_user_id = ? WHERE id = ?').run(profile.id, a.id);
      if (profile.scope.includes('guilds.join') && tickets.active()) await within(tickets.joinGuild(profile.id, profile.accessToken), 8000);
      await within(
        require('./applications').dmApplicant(
          { ...a, discord_user_id: profile.id },
          { title: '🔔 Benachrichtigungen aktiv', description: 'Ihr Discord ist mit Ihrer Bewerbung verbunden. Antworten des Board of Partners und neue Stände Ihrer Bewerbung erhalten Sie ab jetzt hier als Direktnachricht.' }
        ),
        6000
      );
      return res.redirect(`/bewerbung.html?discord=verbunden#${a.access_token}`);
    }

    if (!req.user) return res.redirect('/login.html?discord=session');
    const other = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(profile.id, req.user.id);
    // Hängt das Discord an einem vom Bot angelegten, nie benutzten Konto, gibt dieses es frei (die Person hat schon ein eigenes)
    if (other && !require('../botDm').releaseUnusedBotAccount(profile.id, req.user.id)) return fail('taken');
    const previousDiscordId = req.user.discord_id;
    db.prepare('UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = ? WHERE id = ?').run(
      profile.id,
      profile.username,
      profile.avatar,
      req.user.id
    );
    // Discord-Tickets: dem Server beitreten (falls nötig) und in die Tickets der eigenen Akten aufnehmen
    if (tickets.active()) {
      if (profile.scope.includes('guilds.join')) await tickets.joinGuild(profile.id, profile.accessToken);
      await within(tickets.syncUser(req.user.id), 8000);
    }
    tickets.syncBoardAll(); // Board-Mitglieder kommen in die Board-Tickets
    require('../memberships').syncUser(req.user.id).catch(() => {}); // VIP-/Perma-Rolle vergeben
    require('../discordBot').syncUser(req.user.id, { previousDiscordId }); // Rang-Rollen (Rang-Sync)
    res.redirect('/dashboard.html?discord=linked#profile');
  })
);

router.post('/unlink', requireAuth, async (req, res) => {
  // VIP-/Perma-Rolle entfernen, solange die Discord-ID noch bekannt ist
  const m = require('../memberships').activeFor(req.user.id);
  if (m && m.discord_role_id) await require('../memberships').setRole(req.user.id, m.discord_role_id, false).catch(() => {});
  db.prepare('UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE id = ?').run(req.user.id);
  require('../discordBot').syncUser(req.user.id, { previousDiscordId: req.user.discord_id }); // Rang-Rollen entfernen
  tickets.syncUser(req.user.id); // aus den Tickets entfernen
  tickets.syncBoardAll();
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

module.exports = router;
