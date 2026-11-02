'use strict';
/*
 * Dauerbetrieb (Render Free) – Schnittstellen:
 *   GET  /api/ping                     Wecker (ohne Anmeldung, ohne Datenbank)
 *   POST /api/dauer/uebergabe          neue Instanz bittet um Übergabe (signiert mit dem Datenschlüssel)
 *   GET  /api/dauer                    Stand für Einstellungen → Dauerbetrieb (Recht „System“)
 *   POST /api/dauer/sichern            sofort einen Gesamtstand
 *   POST /api/dauer/probe              Probelauf: Stand aus dem Drive bauen und vergleichen
 *   POST /api/dauer/schluessel         Wiederherstellungs-Schlüssel für Render (nur Inhaber und Web-Admins)
 *   PUT  /api/dauer/einstellungen      Obergrenze im Drive
 *   GET  /api/dauer/linien             alle Stände im Drive · POST /api/dauer/linie { action: adopt|keep, lin }
 *   POST /api/dauer/pruefen            Speicherwächter jetzt messen
 */
const express = require('express');
const { requireAuth } = require('../core/auth');
const { wrap } = require('../core/helpers');
const perms = require('../core/permissions');
const cfg = require('../dauer/config');
const state = require('../dauer/state');
const live = require('../dauer/live');
const wach = require('../dauer/wach');

/** Wecker: so schlank wie möglich. */
function ping(req, res) {
  wach.record(req, new URL(req.originalUrl, 'http://x'));
  res.set('Cache-Control', 'no-store').type('text/plain').send('ok');
}

/** Nach der Übergabe: Änderungen ablehnen – das Dashboard wiederholt sie, bis die neue Instanz sie annimmt. */
function freezeGuard(req, res, next) {
  if (!state.frozen || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.path === '/dauer/uebergabe') return next();
  res.set({ 'Retry-After': '3', 'X-PS-Retry': '1', 'Cache-Control': 'no-store' });
  res.status(503).json({ error: 'Der Server wird gerade aktualisiert – Ihre Änderung wird gleich gespeichert.', retry: true });
}

/** Jede beantwortete Änderung sofort ins Drive (nicht erst beim nächsten Takt). */
function afterWrite(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && cfg.enabled()) res.on('finish', () => live.touch());
  next();
}

const router = express.Router();

router.post(
  '/uebergabe',
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    if (!cfg.enabled()) return res.status(404).json({ error: 'Dauerbetrieb ist aus.' });
    const pos = await live.handover(req.body || {});
    res.json(pos);
  })
);

const canSystem = perms.requirePerm('system.edit');
const keyHolder = (req, res, next) => (perms.isOwner(req.user) || perms.isWebAdmin(req.user) ? next() : res.status(403).json({ error: 'Den Wiederherstellungs-Schlüssel sehen nur der Inhaber und die Web-Admins.' }));

function overview() {
  const google = (() => {
    try {
      return require('../integrations/googleDrive').status();
    } catch {
      return null;
    }
  })();
  let files = null;
  try {
    files = require('../dauer/files').status();
  } catch {
    files = null;
  }
  return {
    enabled: cfg.enabled(),
    mode: cfg.mode(),
    instance: state.instance,
    startedAt: state.startedAt,
    uptimeS: Math.round(process.uptime()),
    phase: state.phase,
    restore: state.restore,
    predecessor: state.predecessor,
    live: live.status(),
    files,
    guard: require('../dauer/guard').status(),
    wake: wach.status(),
    recovery: live.recoveryState(),
    google: google && { configured: google.configured, connected: google.connected, account: google.account, connectedAt: google.connectedAt, error: google.error },
    selfUrl: cfg.selfUrl() || null,
    budgetMb: require('../dauer/guard').budgetMb(),
  };
}

router.get('/', requireAuth, canSystem, (req, res) => res.json(overview()));

router.post(
  '/sichern',
  requireAuth,
  canSystem,
  wrap(async (req, res) => {
    await live.forceBase();
    res.json(overview());
  })
);

router.post(
  '/probe',
  requireAuth,
  canSystem,
  wrap(async (req, res) => {
    const result = await live.probe();
    res.json({ probe: result, ...overview() });
  })
);

router.post('/schluessel', requireAuth, canSystem, keyHolder, (req, res) => {
  const key = live.recoveryKey();
  console.log(`Dauerbetrieb: Wiederherstellungs-Schlüssel angezeigt für ${req.user.display_name}.`);
  res.set('Cache-Control', 'no-store').json({ key });
});

router.put(
  '/einstellungen',
  requireAuth,
  canSystem,
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    await require('../dauer/guard').setBudget((req.body || {}).budgetMb);
    res.json(overview());
  })
);

router.post(
  '/pruefen',
  requireAuth,
  canSystem,
  wrap(async (req, res) => {
    await require('../dauer/guard').check();
    res.json(overview());
  })
);

router.get(
  '/linien',
  requireAuth,
  canSystem,
  wrap(async (req, res) => res.json({ lines: await live.lines() }))
);

router.post(
  '/linie',
  requireAuth,
  canSystem,
  keyHolder,
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    const { action, lin } = req.body || {};
    res.json(await live.chooseLine(String(action || ''), String(lin || '')));
  })
);

module.exports = { router, ping, freezeGuard, afterWrite, overview };
