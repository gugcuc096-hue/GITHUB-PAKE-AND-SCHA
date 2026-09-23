'use strict';
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { requireAuth, createSession, publicUser } = require('../auth');
const { wrap } = require('../helpers');
const discord = require('../discord');

const router = express.Router();
const STATE_COOKIE = 'ds_state';
const STATE_MAX_AGE = 10 * 60 * 1000;

function stateCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/discord' };
}

function startFlow(req, res, mode) {
  const cfg = discord.oauthConfig(req);
  if (!cfg) return res.redirect(mode === 'login' ? '/login.html?discord=disabled' : '/dashboard.html?discord=disabled#profile');
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, `${mode}.${state}`, { ...stateCookieOptions(), maxAge: STATE_MAX_AGE });
  res.redirect(discord.authorizeUrl(cfg, state));
}

router.get('/status', (req, res) => {
  res.json({ oauth: !!discord.oauthConfig(req) });
});

// Verknüpfen: nur für angemeldete Nutzer (Navigation, daher Weiterleitung statt JSON-Fehler).
router.get('/connect', (req, res) => {
  if (!req.user) return res.redirect('/login.html?next=' + encodeURIComponent('/dashboard.html#profile'));
  startFlow(req, res, 'link');
});

router.get('/login', (req, res) => startFlow(req, res, 'login'));

router.get(
  '/callback',
  wrap(async (req, res) => {
    const raw = req.cookies?.[STATE_COOKIE] || '';
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
    const [mode, expected] = raw.split('.');
    const failTarget = mode === 'login' ? '/login.html' : '/dashboard.html';
    const fail = (code) => res.redirect(`${failTarget}?discord=${code}${mode === 'login' ? '' : '#profile'}`);

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

    if (!req.user) return res.redirect('/login.html?discord=session');
    const other = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(profile.id, req.user.id);
    if (other) return fail('taken');
    db.prepare('UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = ? WHERE id = ?').run(
      profile.id,
      profile.username,
      profile.avatar,
      req.user.id
    );
    res.redirect('/dashboard.html?discord=linked#profile');
  })
);

router.post('/unlink', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL WHERE id = ?').run(req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

module.exports = router;
