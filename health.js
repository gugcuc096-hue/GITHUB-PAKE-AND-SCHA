'use strict';
/*
 * Systemzustand: Startdauer, Laufzeit, Speicher, Datenbank, Sicherungen, die langsamsten Anfragen und ein Selbsttest.
 * Zusätzlich beim Start: fehlende Indizes für alle Fremdschlüssel anlegen (Abfragen über Akte → Notizen, Rechnungen usw.
 * bleiben auch bei vielen Tausend Zeilen schnell). Die Zahlen liegen nur im Arbeitsspeicher und gehen mit einem Neustart weg.
 */
const fs = require('fs');
const { db, DB_PATH, UPLOAD_DIR, getSetting } = require('./db');

let bootMs = null;
/** Der Server nimmt Anfragen an: so lange (seit Prozessstart) hat der Start gedauert. */
const markReady = () => (bootMs = Math.round(process.uptime() * 1000));

/* ---------------------------------------------------------------- Indizes */
/** Legt für jede Fremdschlüssel-Spalte ohne Index einen an. Liefert die Zahl neu angelegter Indizes. */
function ensureIndexes() {
  let created = 0;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all();
    if (!fks.length) continue;
    const first = new Set(
      db
        .prepare(`PRAGMA index_list("${name}")`)
        .all()
        .map((i) => (db.prepare(`PRAGMA index_info("${i.name}")`).all()[0] || {}).name)
    );
    for (const pk of db.prepare(`PRAGMA table_info("${name}")`).all()) if (pk.pk === 1) first.add(pk.name);
    for (const fk of fks) {
      if (first.has(fk.from)) continue;
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_fk_${name}_${fk.from}" ON "${name}"("${fk.from}")`);
      first.add(fk.from);
      created++;
    }
  }
  return created;
}

/* ---------------------------------------------------------------- Anfragen messen */
const MAX_ROUTES = 300;
const RING = 200;
const routes = new Map(); // "GET /api/cases/:id" → { n, total, max, ring[], slow }
const slowLog = []; // letzte langsame Anfragen (> SLOW_MS)
const SLOW_MS = 1000;

const routeKey = (req) => {
  const path = req.originalUrl.split('?')[0].split('/').filter(Boolean).slice(0, 4).map((s) => (/^\d+$/.test(s) ? ':id' : s.length > 24 ? ':x' : s));
  return `${req.method} /${path.join('/')}`;
};

/** Express-Zwischenstufe: misst jede Anfrage (Live-Verbindungen ausgenommen). */
function timing(req, res, next) {
  if (!req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/api/events')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const key = routeKey(req);
    let r = routes.get(key);
    if (!r) {
      if (routes.size >= MAX_ROUTES) return;
      r = { n: 0, total: 0, max: 0, ring: [], slow: 0 };
      routes.set(key, r);
    }
    r.n++;
    r.total += ms;
    r.max = Math.max(r.max, ms);
    r.ring.push(ms);
    if (r.ring.length > RING) r.ring.shift();
    if (ms > SLOW_MS) {
      r.slow++;
      slowLog.push({ at: new Date().toISOString(), route: key, ms: Math.round(ms), status: res.statusCode });
      if (slowLog.length > 20) slowLog.shift();
    }
  });
  next();
}
const p95 = (ring) => {
  const s = [...ring].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
};

/* ---------------------------------------------------------------- Selbsttest */
const REQUIRED_TABLES = ['users', 'cases', 'notes', 'settings', 'sessions', 'invoices', 'case_attachments', 'appointments'];

/** Prüft, dass das Wichtigste da ist. deep: ganze Datenbank durchsehen (kann bei großen Datenbanken dauern). */
function selfTest({ deep = false } = {}) {
  const checks = [];
  const add = (name, fn) => {
    try {
      const detail = fn();
      checks.push({ name, ok: true, detail: detail || '' });
    } catch (err) {
      checks.push({ name, ok: false, detail: String(err.message || err).slice(0, 200) });
    }
  };
  add('Datenbank beschreibbar', () => {
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
  });
  add('Wichtige Tabellen vorhanden', () => {
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (missing.length) throw new Error(`fehlt: ${missing.join(', ')}`);
    return `${have.size} Tabellen`;
  });
  add('Einstellungen lesbar', () => {
    getSetting('maintenance_at', '');
  });
  add('Ordner für Bilder und Dateien beschreibbar', () => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
  });
  add('Fremdschlüssel ohne Index', () => {
    let missing = 0;
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all();
      const first = new Set(db.prepare(`PRAGMA index_list("${name}")`).all().map((i) => (db.prepare(`PRAGMA index_info("${i.name}")`).all()[0] || {}).name));
      for (const pk of db.prepare(`PRAGMA table_info("${name}")`).all()) if (pk.pk === 1) first.add(pk.name);
      missing += fks.filter((f) => !first.has(f.from)).length;
    }
    if (missing) throw new Error(`${missing} ohne Index`);
    return 'alle haben einen';
  });
  if (deep) {
    add('Datenbank-Prüfung (quick_check)', () => {
      const r = db.prepare('PRAGMA quick_check').all().map((x) => Object.values(x)[0]);
      if (r.length !== 1 || r[0] !== 'ok') throw new Error(r.slice(0, 3).join('; '));
      return 'ok';
    });
    add('Fremdschlüssel in Ordnung', () => {
      const bad = db.prepare('PRAGMA foreign_key_check').all();
      if (bad.length) throw new Error(`${bad.length} Verweise ins Leere (erste: ${bad[0].table})`);
      return 'ok';
    });
  }
  return { ok: checks.every((c) => c.ok), at: new Date().toISOString(), deep, checks };
}

/* ---------------------------------------------------------------- Übersicht */
const size = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};
const TABLES = ['cases', 'notes', 'case_attachments', 'invoices', 'appointments', 'tasks', 'users', 'sessions', 'audit_log'];

function snapshot() {
  const backup = require('./backup');
  const mem = process.memoryUsage();
  const counts = {};
  for (const t of TABLES) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    } catch {
      /* Tabelle gibt es (noch) nicht */
    }
  }
  const backups = backup.list();
  const last = getSetting('last_selftest', '');
  return {
    now: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    bootMs,
    node: process.version,
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    db: {
      bytes: size(DB_PATH),
      walBytes: size(`${DB_PATH}-wal`),
      pageCount: db.prepare('PRAGMA page_count').get().page_count,
      freePages: db.prepare('PRAGMA freelist_count').get().freelist_count,
      indexes: db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index'").get().n,
      counts,
    },
    disk: { freeBytes: backup.freeBytes() },
    backups: { count: backups.length, last: backups[0] ? backups[0].createdAt : null },
    maintenanceAt: getSetting('maintenance_at', '') || null,
    routes: [...routes.entries()]
      .map(([route, r]) => ({ route, n: r.n, avg: Math.round(r.total / r.n), p95: Math.round(p95(r.ring)), max: Math.round(r.max), slow: r.slow }))
      .sort((a, b) => b.p95 * Math.min(b.n, 20) - a.p95 * Math.min(a.n, 20))
      .slice(0, 12),
    slow: [...slowLog].reverse(),
    selfTest: last ? JSON.parse(last) : null,
  };
}

/** Selbsttest ausführen und das Ergebnis merken (Übersicht). Beim ersten Fehler Warnung ans Board, bei Entwarnung zurücknehmen. */
function runSelfTest(opts) {
  const result = selfTest(opts);
  const { setSetting } = require('./db');
  setSetting('last_selftest', JSON.stringify(result));
  try {
    const alerts = require('./systemAlerts');
    if (!result.ok) {
      const bad = result.checks.filter((c) => !c.ok);
      alerts.raise('selftest', { title: 'Selbsttest des Servers meldet Probleme', description: bad.map((c) => `${c.name}: ${c.detail}`).join('\n').slice(0, 800) });
    } else alerts.resolve('selftest', { title: 'Selbsttest des Servers wieder in Ordnung' });
  } catch {
    /* ohne Benachrichtigung weiter */
  }
  return result;
}

module.exports = { markReady, ensureIndexes, timing, selfTest, runSelfTest, snapshot, routeKey };
