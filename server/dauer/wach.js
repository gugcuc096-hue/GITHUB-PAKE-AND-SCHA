'use strict';
/*
 * Wachhalten: Render Free legt einen Dienst nach 15 Minuten ohne Aufruf schlafen. Drei Wecker halten ihn wach:
 *  1. Selbst-Ping: der Server ruft alle ~4 Minuten seine eigene öffentliche Adresse auf (läuft über Renders
 *     Eingang und zählt deshalb als Besuch).
 *  2. Externer Wecker (cron-job.org, UptimeRobot …): ruft jede Minute /api/ping auf – weckt den Server auch nach
 *     einem Neustart sofort.
 *  3. GitHub Actions (.github/workflows/wachhalten.yml) alle 5 Minuten – Reserve.
 * Bleibt der externe Wecker 20 Minuten aus, bekommen die Web-Admins eine Discord-Meldung.
 */
const cfg = require('./config');
const state = require('./state');

let started = false;
let pingTimer = null;

/** Woher kommt der Ping? ?src=… oder am Browser-Kennzeichen erkennbar. */
function sourceOf(req, url) {
  const src = String(url.searchParams.get('src') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  const ua = String(req.headers['user-agent'] || '');
  if (src === 'self' || req.headers['x-ps-instance']) return 'self';
  if (src) return src;
  if (/cron-job\.org/i.test(ua)) return 'cron-job.org';
  if (/uptimerobot/i.test(ua)) return 'uptimerobot';
  if (/betteruptime|betterstack/i.test(ua)) return 'betterstack';
  if (/github/i.test(ua)) return 'github';
  if (/render/i.test(ua)) return 'render';
  return 'extern';
}

/** Jeder Aufruf von /api/ping (auch während des Starts, ohne Datenbank). */
function record(req, url) {
  const src = sourceOf(req, url);
  const now = new Date().toISOString();
  const p = state.pings;
  p.count += 1;
  p.sources[src] = now;
  if (src === 'self') p.selfIn = now;
  else if (src !== 'render') p.external = { at: now, src };
}

async function selfPing() {
  const base = cfg.selfUrl();
  if (!base || state.frozen) return;
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/ping?src=self`, { headers: { 'X-PS-Instance': state.instance, 'User-Agent': 'pake-scha-wecker' }, signal: AbortSignal.timeout(20000) });
    state.pings.self = { at: new Date().toISOString(), ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch (err) {
    state.pings.self = { at: new Date().toISOString(), ok: false, ms: Date.now() - t0, error: err.message };
  }
}

function watchdog() {
  if (state.frozen) return;
  const notify = require('./notify');
  const up = Date.now() - Date.parse(state.startedAt);
  const ext = state.pings.external && Date.parse(state.pings.external.at);
  const silent = ext ? Date.now() - ext : up;
  if (up < cfg.WAKE_ALERT_MS) return;
  if (silent >= cfg.WAKE_ALERT_MS) {
    notify.raise('dauer-wecker', {
      title: 'Externer Wecker meldet sich nicht',
      description: `Seit ${Math.round(silent / 60000)} Minuten hat kein externer Dienst (cron-job.org, UptimeRobot, GitHub) /api/ping aufgerufen. Der Selbst-Ping hält den Server wach, solange er läuft – nach einem Neustart würde ihn aber niemand wecken. Bitte den Wecker prüfen (Dashboard → Einstellungen → Dauerbetrieb).`,
    });
  } else {
    notify.resolve('dauer-wecker', { title: 'Externer Wecker ist wieder da', description: `Letzter Aufruf von ${state.pings.external.src}.` });
  }
}

function start() {
  if (started || !cfg.enabled()) return;
  started = true;
  const jitter = () => cfg.PING_MS + Math.round((Math.random() - 0.5) * Math.min(60000, cfg.PING_MS / 4));
  const loop = () => {
    pingTimer = setTimeout(async () => {
      await selfPing();
      loop();
    }, jitter());
    pingTimer.unref();
  };
  setTimeout(selfPing, 3000).unref();
  loop();
  setInterval(watchdog, 60000).unref();
}

function status() {
  const p = state.pings;
  return { selfUrl: cfg.selfUrl() || null, self: p.self, selfIn: p.selfIn || null, external: p.external, sources: p.sources, count: p.count, intervalMs: cfg.PING_MS };
}

module.exports = { record, start, status, selfPing, sourceOf };
