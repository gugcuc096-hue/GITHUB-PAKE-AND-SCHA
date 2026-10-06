'use strict';
/*
 * /api/google – Google Docs der Kanzlei (googleDrive.js, googleDocs.js)
 *
 *   GET    /status            Board: Verbindung, Anzahl Docs, Weiterleitungs-Adresse für die Einrichtung
 *   GET    /connect           Board: weiter zur Google-Anmeldung (Kanzlei-Konto)
 *   GET    /callback          Rückkehr von Google
 *   POST   /disconnect        Board: Verbindung trennen (Docs bleiben in Drive, werden aber nicht mehr aktualisiert)
 *   POST   /resync            Board: alle Docs neu schreiben
 *   GET    /docs/:kind/:id    Druckansicht: Gibt es ein Google Doc? Darf ich eins anlegen?
 *   POST   /docs/:kind/:id    Kanzlei: Google Doc anlegen bzw. sofort aktualisieren
 *   DELETE /docs/:kind/:id    Kanzlei: Freigabe beenden (Doc in den Drive-Papierkorb)
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { wrap, isBoard } = require('../helpers');
const { getCase, caseAccess, logActivity, INVOICE_SELECT } = require('../models');
const drive = require('../googleDrive');
const gdocs = require('../googleDocs');

const router = express.Router();
const STATE_COOKIE = 'gd_state';
const stateCookie = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/google' });
const LABEL = { invoice: 'Rechnung', contract: 'Vertrag', extract: 'Aktenauszug' };

const boardOnly = (req, res, next) => (isBoard(req.user) ? next() : res.status(403).json({ error: 'Nur das Board of Partners verwaltet die Google-Verbindung.' }));

/* ---------------------------------------------------------------- Verbindung (Board) */
router.get('/status', requireAuth, boardOnly, (req, res) => {
  res.json({ ...drive.status(req), ...gdocs.stats() });
});

router.get('/connect', requireAuth, (req, res) => {
  if (!isBoard(req.user)) return res.redirect('/dashboard.html#settings');
  if (!drive.configured()) return res.redirect('/dashboard.html?google=config#settings');
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...stateCookie(), maxAge: 10 * 60 * 1000 });
  res.redirect(drive.authorizeUrl(req, state));
});

router.get(
  '/callback',
  wrap(async (req, res) => {
    const back = (code) => res.redirect(`/dashboard.html?google=${code}#settings`);
    const expected = req.cookies && req.cookies[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, stateCookie());
    if (!req.user) return res.redirect('/login.html?next=' + encodeURIComponent('/dashboard.html#settings'));
    if (!isBoard(req.user)) return back('rechte');
    if (req.query.error) return back(req.query.error === 'access_denied' ? 'abgebrochen' : 'fehler');
    if (!expected || req.query.state !== expected) return back('sitzung');
    try {
      const email = await drive.connect(req, String(req.query.code || ''), req.user);
      logActivity(req.user, 'Google-Konto verbunden', 'settings', null, email || '');
      require('../systemAlerts').resolve('google', { title: 'Google Docs wieder verbunden', description: email ? `Konto: ${email}` : '' });
      gdocs.retryPending();
      back('verbunden');
    } catch (err) {
      console.warn('Google-Anmeldung fehlgeschlagen:', err.message);
      back(err.code === 'scope' ? 'drive' : err.code === 'refresh' ? 'dauerhaft' : 'fehler');
    }
  })
);

router.post(
  '/disconnect',
  requireAuth,
  boardOnly,
  wrap(async (req, res) => {
    await drive.disconnect();
    logActivity(req.user, 'Google-Konto getrennt', 'settings', null, '');
    res.json({ ...drive.status(req), ...gdocs.stats() });
  })
);

router.post('/resync', requireAuth, boardOnly, (req, res) => {
  if (!drive.connected()) return res.status(409).json({ error: 'Das Google-Konto der Kanzlei ist nicht verbunden.' });
  res.json({ queued: gdocs.resyncAll() });
});

/* ---------------------------------------------------------------- Docs je Dokument */
/** Darf die Person das Dokument sehen? Aktenauszüge als Google Doc gibt es nur für die Kanzlei. */
function visible(kind, id, u) {
  if (kind === 'invoice') {
    const inv = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
    return !!inv && require('./invoices').visibleTo(inv, u);
  }
  if (kind === 'contract') return require('./contracts').contractVisible(id, u);
  if (kind === 'extract') {
    const c = getCase(id);
    return !!c && isStaff(u) && caseAccess(c, u).canView;
  }
  return false;
}

function target(req, res) {
  const kind = req.params.kind;
  const id = Number(req.params.id);
  if (!gdocs.KINDS.includes(kind) || !Number.isInteger(id) || id <= 0 || !visible(kind, id, req.user)) {
    res.status(404).json({ error: 'Dokument nicht gefunden.' });
    return null;
  }
  return { kind, id };
}

router.get('/docs/:kind/:id', requireAuth, (req, res) => {
  const t = target(req, res);
  if (!t) return;
  res.json({
    configured: drive.configured(),
    available: drive.connected(),
    canCreate: isStaff(req.user),
    doc: gdocs.docInfo(gdocs.rowFor(t.kind, t.id)),
  });
});

router.post(
  '/docs/:kind/:id',
  requireAuth,
  wrap(async (req, res) => {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Google Docs legt die Kanzlei an.' });
    const t = target(req, res);
    if (!t) return;
    if (!drive.connected()) return res.status(409).json({ error: 'Das Google-Konto der Kanzlei ist nicht verbunden (Einstellungen → Google Docs).' });
    const existed = !!gdocs.rowFor(t.kind, t.id);
    const options = t.kind === 'extract' && req.body && typeof req.body.options === 'object' ? req.body.options : undefined;
    const doc = await gdocs.publish(t.kind, t.id, req.user, options);
    const caseId = (gdocs.rowFor(t.kind, t.id) || {}).case_id;
    logActivity(req.user, existed ? 'Google Doc aktualisiert' : 'Google Doc erstellt', t.kind === 'invoice' ? 'invoice' : 'case', t.kind === 'invoice' ? t.id : caseId, `${LABEL[t.kind]} · ${doc.url}`);
    res.status(existed ? 200 : 201).json({ doc });
  })
);

router.delete(
  '/docs/:kind/:id',
  requireAuth,
  wrap(async (req, res) => {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Keine Berechtigung.' });
    const t = target(req, res);
    if (!t) return;
    const r = gdocs.rowFor(t.kind, t.id);
    if (!r) return res.status(404).json({ error: 'Zu diesem Dokument gibt es kein Google Doc.' });
    await gdocs.remove(t.kind, t.id);
    logActivity(req.user, 'Google Doc gelöscht', t.kind === 'invoice' ? 'invoice' : 'case', t.kind === 'invoice' ? t.id : r.case_id, LABEL[t.kind]);
    res.json({ success: true });
  })
);

module.exports = router;
