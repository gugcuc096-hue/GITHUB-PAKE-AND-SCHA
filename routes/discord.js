'use strict';
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { requireAuth, createSession, publicUser } = require('../auth');
const { wrap } = require('../helpers');
const discord = require('../discord');
const tickets = require('../tickets');

const router = express.Router();
const STATE_COOKIE = 'ds_state';
const STATE_MAX_AGE = 10 * 60 * 1000;

function stateCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/discord' };
}

/**
 * mode: login | link | case. Beim Verknüpfen und beim Ticket-Beitritt wird zusätzlich „guilds.join“
 * angefragt (nur wenn Discord-Tickets aktiv sind) – damit fügt der Bot den Mandanten dem Server hinzu.
 */
function startFlow(req, res, mode, extra = '') {
  const cfg = discord.oauthConfig(req);
  if (!cfg) {
    const target = mode === 'login' ? '/login.html?discord=disabled' : mode === 'case' ? '/?discord=disabled#akte' : '/dashboard.html?discord=disabled#profile';
    return res.redirect(target);
  }
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, [mode, state, extra].filter(Boolean).join('.'), { ...stateCookieOptions(), maxAge: STATE_MAX_AGE });
  const scopes = mode !== 'login' && tickets.active() ? ['identify', 'guilds.join'] : ['identify'];
  // Ticket-Beitritt immer mit Discord-Bestätigung (kein stilles Durchwinken)
  res.redirect(discord.authorizeUrl(cfg, state, scopes, mode === 'case' ? 'consent' : 'none'));
}

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
 * Discord-Ticket beitreten ohne Konto: Aktenzeichen + Aktenpin (Formular auf der Startseite, POST –
 * der Pin steht so nicht in der Adresszeile). Danach Discord-Anmeldung; der Mandant wird dem Server
 * und dem Ticket seiner Akte hinzugefügt.
 */
const joinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.redirect('/?ticket=limit#akte') });
router.post('/case-join', express.urlencoded({ extended: false, limit: '2kb' }), joinLimiter, (req, res) => {
  // Nur Formulare der eigenen Website (Schutz vor fremden Seiten, die den Ablauf anstoßen)
  const origin = req.get('origin');
  if (origin && !(origin === 'null' && req.get('sec-fetch-site') === 'same-origin')) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      host = '';
    }
    if (host !== req.get('host')) return res.redirect('/?ticket=error#akte');
  }
  const number = String(req.body?.caseNumber || '').trim().toUpperCase().slice(0, 30);
  const pin = String(req.body?.pin || '').trim().slice(0, 10);
  if (!tickets.active()) return res.redirect('/?ticket=disabled#akte');
  const c = number && pin ? db.prepare('SELECT id FROM cases WHERE case_number = ? AND access_pin = ?').get(number, pin) : null;
  if (!c) return res.redirect('/?ticket=notfound#akte');
  startFlow(req, res, 'case', String(c.id));
});

/** Wartet höchstens ms auf den Abgleich (die Weiterleitung soll nicht hängen). */
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

router.get(
  '/callback',
  wrap(async (req, res) => {
    const raw = req.cookies?.[STATE_COOKIE] || '';
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
    const [mode, expected, extra] = raw.split('.');
    const failTarget = mode === 'login' ? '/login.html' : mode === 'case' ? '/' : '/dashboard.html';
    const fail = (code) => res.redirect(`${failTarget}?${mode === 'case' ? 'ticket' : 'discord'}=${code}${mode === 'login' ? '' : mode === 'case' ? '#akte' : '#profile'}`);

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
      if (!user) return fail('notlinked');
      if (!user.active) return fail('locked');
      db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?').run(profile.username, profile.avatar, user.id);
      createSession(res, user.id);
      return res.redirect('/dashboard.html');
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
      return res.redirect('/?ticket=pending#akte');
    }

    if (!req.user) return res.redirect('/login.html?discord=session');
    const other = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(profile.id, req.user.id);
    if (other) return fail('taken');
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
    res.redirect('/dashboard.html?discord=linked#profile');
  })
);

router.post('/unlink', requireAuth, async (req, res) => {
  // VIP-/Perma-Rolle entfernen, solange die Discord-ID noch bekannt ist
  const m = require('../memberships').activeFor(req.user.id);
  if (m && m.discord_role_id) await require('../memberships').setRole(req.user.id, m.discord_role_id, false).catch(() => {});
  db.prepare('UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE id = ?').run(req.user.id);
  tickets.syncUser(req.user.id); // aus den Tickets entfernen
  tickets.syncBoardAll();
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

module.exports = router;
