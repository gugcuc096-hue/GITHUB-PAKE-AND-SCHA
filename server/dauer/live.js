'use strict';
/*
 * Live-Sicherung im Dauerbetrieb: JEDE Änderung an der Datenbank landet nach etwa zwei Sekunden verschlüsselt im
 * Google Drive.
 *  - SQLite-„Session“ zeichnet alle Änderungen auf; alle ~1,5 s wird das Paket (Changeset) abgeholt und als Journal
 *    hochgeladen. Pakete sind winzig (meist wenige KB) – Datenvolumen und Drive bleiben klein.
 *  - Ein Gesamtstand (VACUUM INTO, gepackt, verschlüsselt) entsteht beim Start, nach 300 Journalen / 8 MB, nach
 *    30 Minuten mit Änderungen und bei Schemaänderungen. Danach beginnt die Journal-Zählung neu.
 *  - Hochgeladen wird streng der Reihe nach; klappt etwas nicht, wird es wiederholt (die Warteschlange bleibt im
 *    Speicher), bis das Drive wieder antwortet.
 *  - Herzschlag („lease“) alle 30 s im Drive. Startet eine neue Instanz (Deploy), übergibt diese hier: keine
 *    Änderungen mehr annehmen, letztes Paket hochladen, „freigegeben“ melden. Danach schreibt sie nie wieder.
 *  - Beim Beenden (SIGTERM von Render) dasselbe: letzter Stand hoch, dann aus.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const state = require('./state');
const drive = require('./gdrive');
const pack = require('./pack');
const store = require('./store');
const { db, DB_PATH, getSetting, setSetting } = require('../db/db');

const TMP = store.tmpDir(DB_PATH);
let running = false; // Live-Sicherung aktiv (Google verbunden, Ordner da)
let waitTimer = null;
let tick = null;
let leaseTimer = null;
let key = null;
let root = null;
let leaseId = null;
let lin = null;
let gen = 0;
let seq = 0;
let session = null;
let schemaVersion = null;
let needBase = false;
const queue = [];
let draining = null;
let fenced = false;
const since = { base: 0, journals: 0, bytes: 0 };
const stats = {
  startedAt: null,
  lastChangeAt: null,
  lastUploadAt: null,
  lastBaseAt: null,
  lastBaseBytes: null,
  journals: 0,
  bases: 0,
  bytes: 0,
  failures: 0,
  failingSince: null,
  lastError: null,
  lastErrorAt: null,
  restoredAt: null,
};

/* ---------------------------------------------------------------- Schlüssel & Linie */
function sealLocal(buf) {
  return pack.sealRecovery({ rt: '-', k: buf.toString('base64') }, cfg.clientSecret() || 'ohne-secret');
}
function unsealLocal(text) {
  try {
    return pack.unsealRecovery(text, cfg.clientSecret() || 'ohne-secret').k;
  } catch {
    return null;
  }
}

/** Datenschlüssel: aus dem Wiederherstellungs-Schlüssel, sonst aus der Datenbank, sonst neu. */
function ensureKey() {
  if (state.creds && state.creds.k) {
    key = state.creds.k;
    const saved = unsealLocal(getSetting('dauer_key', ''));
    if (!saved || !saved.equals(key)) setSetting('dauer_key', sealLocal(key));
    return key;
  }
  key = unsealLocal(getSetting('dauer_key', ''));
  if (!key) {
    key = crypto.randomBytes(32);
    setSetting('dauer_key', sealLocal(key));
  }
  return key;
}

function ensureLineage() {
  lin = getSetting('dauer_lineage', '');
  if (!lin) {
    lin = crypto.randomBytes(4).toString('hex');
    setSetting('dauer_lineage', lin);
  }
  return lin;
}

/** Refresh-Token: die Verbindung aus dem Dashboard, sonst der aus dem Wiederherstellungs-Schlüssel. */
function token() {
  try {
    const t = require('../integrations/googleDrive').currentRefreshToken();
    if (t) return t;
  } catch {
    /* noch nicht verbunden */
  }
  return state.creds ? state.creds.rt : null;
}

/* ---------------------------------------------------------------- Aufzeichnen */
function sequences() {
  try {
    return Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((r) => [r.name, r.seq]));
  } catch {
    return {};
  }
}

/** Änderungen seit dem letzten Paket abholen und einreihen. */
function rotate() {
  if (!session) return false;
  const cs = session.changeset();
  if (!cs || !cs.length) return false;
  session.close();
  session = db.createSession();
  seq += 1;
  const data = store.encodeJournal(cs, sequences(), key);
  queue.push({ kind: 'journal', lin, gen, seq, data });
  since.journals += 1;
  since.bytes += data.length;
  stats.lastChangeAt = new Date().toISOString();
  const sv = db.prepare('PRAGMA schema_version').get().schema_version;
  if (sv !== schemaVersion) needBase = true; // Tabellen geändert → frischer Gesamtstand
  return true;
}

/** Gesamtstand: alles bis jetzt einsammeln, Kopie ziehen und im selben Moment eine neue Aufzeichnung beginnen. */
function snapshot() {
  rotate();
  fs.mkdirSync(TMP, { recursive: true });
  const next = gen + 1;
  const file = path.join(TMP, `stand-${lin}-${next}.db`);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  if (session) session.close();
  session = db.createSession(); // ab hier zählt jede Änderung zum neuen Stand – ohne Lücke (alles synchron)
  schemaVersion = db.prepare('PRAGMA schema_version').get().schema_version;
  gen = next;
  seq = 0;
  needBase = false;
  since.base = Date.now();
  since.journals = 0;
  since.bytes = 0;
  // Nach einem längeren Drive-Ausfall: wartende Pakete älterer Stände stecken schon im neuen Gesamtstand – nicht
  // alle einzeln nachschieben. Im Normalfall (wenige Pakete) gehen sie vorher hoch, damit nichts von einem einzigen
  // Upload abhängt.
  const old = queue.filter((q) => q.kind === 'journal' && q.gen < gen && !q.busy);
  if (old.length > 20) for (const q of old) queue.splice(queue.indexOf(q), 1);
  queue.push({ kind: 'base', lin, gen, file, at: new Date().toISOString() });
}

/* ---------------------------------------------------------------- Hochladen */
async function uploadItem(item) {
  if (item.kind === 'journal') {
    await drive.uploadBuffer({
      name: `journal-${item.lin}-${store.pad(item.gen)}-${store.pad(item.seq, 7)}.psj`,
      parent: root.id,
      appProperties: { ps: 'journal', lin: item.lin, gen: String(item.gen), seq: String(item.seq), inst: state.instance },
      data: item.data,
    });
    stats.journals += 1;
    stats.bytes += item.data.length;
    return;
  }
  const enc = `${item.file}.psb`;
  let meta;
  if (!fs.existsSync(enc)) meta = await pack.encryptFile(item.file, enc, key);
  else meta = item.meta;
  item.meta = meta;
  await require('./guard').beforeUpload(meta.bytes);
  await drive.uploadFile({
    name: `stand-${item.lin}-${store.pad(item.gen)}.psb`,
    parent: root.id,
    appProperties: { ps: 'base', lin: item.lin, gen: String(item.gen), at: item.at, sha: meta.sha256, size: String(meta.plainBytes), inst: state.instance, kid: pack.keyId(key) },
    file: enc,
  });
  fs.rmSync(item.file, { force: true });
  fs.rmSync(enc, { force: true });
  stats.bases += 1;
  stats.bytes += meta.bytes;
  stats.lastBaseAt = new Date().toISOString();
  stats.lastBaseBytes = meta.bytes;
  pruneOld(item.gen).catch((err) => console.warn('Dauerbetrieb: Aufräumen im Drive fehlgeschlagen:', err.message));
}

/** Ältere Stände dieser Linie löschen – der vorige bleibt als Rückfall. */
async function pruneOld(currentGen) {
  const s = await store.scan(root.id);
  const old = [...s.bases.filter((b) => b.lin === lin && b.gen < currentGen - 1), ...s.journals.filter((j) => j.lin === lin && j.gen < currentGen - 1)];
  const hourAgo = Date.now() - 3600 * 1000;
  old.push(...s.claims.filter((c) => Date.parse(c.createdTime) < hourAgo));
  for (const f of old) await drive.remove(f.id);
}

let again = false; // während eines Uploads kamen weitere Änderungen – danach gleich einsammeln
let streak = 0; // Fehlversuche hintereinander (für die wachsende Pause)
let pausedUntil = 0; // Google-Zugang abgelaufen: nicht im Sekundentakt nachfragen

function drain() {
  if (draining) return draining;
  if (Date.now() < pausedUntil) return Promise.resolve();
  draining = (async () => {
    try {
      while (queue.length && !fenced) {
        const item = queue[0];
        item.busy = true;
        try {
          await uploadItem(item);
          queue.shift();
          stats.lastUploadAt = new Date().toISOString();
          pausedUntil = 0;
          streak = 0;
          // Was während des Uploads geändert wurde, als ein Paket hinterher (bündelt viele schnelle Aktionen)
          if (!queue.length && again && !state.frozen) {
            again = false;
            try {
              rotate();
            } catch (err) {
              console.error('Dauerbetrieb: Aufzeichnen fehlgeschlagen:', err.message);
            }
          }
          if (stats.failingSince) {
            stats.failingSince = null;
            require('./notify').resolve('dauer-upload', { title: 'Sicherung im Google Drive läuft wieder', description: 'Alle zurückgehaltenen Änderungen sind jetzt im Google Drive.' });
          }
        } catch (err) {
          item.busy = false;
          stats.failures += 1;
          streak += 1;
          stats.lastError = err.message;
          stats.lastErrorAt = new Date().toISOString();
          stats.failingSince ||= Date.now();
          if (err.code === 'full') await require('./guard').emergency().catch(() => {});
          if (Date.now() - stats.failingSince > 3 * 60 * 1000) {
            require('./notify').raise('dauer-upload', {
              title: 'Sicherung im Google Drive klappt nicht',
              description: `Seit ${Math.round((Date.now() - stats.failingSince) / 60000)} Minuten lassen sich Änderungen nicht ins Google Drive hochladen: ${err.message}. Sie sind nicht verloren, solange der Server läuft (${queue.length} Pakete warten) – bitte jetzt nicht neu starten oder deployen. Der Server versucht es laufend weiter.`,
            });
          }
          console.warn(`Dauerbetrieb: Hochladen fehlgeschlagen (${queue.length} warten): ${err.message}`);
          await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(streak - 1, 5))));
          if (err.code === 'expired' || err.code === 'not_connected') {
            pausedUntil = Date.now() + 60000; // erst in einer Minute wieder versuchen (bis Google neu verbunden ist)
            if (!stats.failingSince || Date.now() - stats.failingSince > 60000) {
              require('./notify').raise('dauer-upload', {
                title: 'Sicherung im Google Drive gestoppt: Google-Zugang abgelaufen',
                description: `Google hat den Zugang abgelehnt (${err.message}). Änderungen warten im Speicher (${queue.length} Pakete) – bitte sofort im Dashboard Google neu verbinden und danach den neuen Wiederherstellungs-Schlüssel in Render eintragen. Bis dahin nicht neu starten oder deployen.`,
              });
            }
            break;
          }
        }
      }
    } finally {
      draining = null;
    }
  })();
  return draining;
}

/** Warten, bis alles oben ist (höchstens ms). */
async function flush(ms = 20000) {
  const until = Date.now() + ms;
  while ((queue.length || draining) && Date.now() < until && !fenced) {
    if (!draining) drain();
    await Promise.race([draining, new Promise((r) => setTimeout(r, 250))]);
  }
  return queue.length === 0;
}

/* ---------------------------------------------------------------- Takt */
function onTick() {
  if (!running || state.frozen) return;
  try {
    rotate();
    const due = needBase || since.journals >= cfg.BASE_AFTER_JOURNALS || since.bytes >= cfg.BASE_AFTER_BYTES || (since.journals > 0 && Date.now() - since.base >= cfg.BASE_EVERY_MS);
    if (due && !queue.some((q) => q.kind === 'base')) snapshot();
  } catch (err) {
    console.error('Dauerbetrieb: Aufzeichnen fehlgeschlagen:', err.message);
    needBase = true;
  }
  if (queue.length) drain();
}

/**
 * Nach jeder Änderung über die Website (POST/PUT/PATCH/DELETE beantwortet): sofort einsammeln und hochladen statt auf
 * den nächsten Takt zu warten – so ist eine Aktion schon Bruchteile einer Sekunde nach der Antwort im Drive.
 */
let touchQueued = false;
function touch() {
  if (!running || state.frozen || touchQueued) return;
  if (draining) {
    again = true; // läuft gerade ein Upload: danach in einem Paket
    return;
  }
  touchQueued = true;
  setImmediate(() => {
    touchQueued = false;
    onTick();
  });
}

/* ---------------------------------------------------------------- Herzschlag & Übergabe */
async function writeLease(extra = {}) {
  const props = { ps: 'lease', owner: state.instance, state: state.frozen ? 'released' : 'active', at: new Date().toISOString(), lin, gen: String(gen), seq: String(seq), ...extra };
  if (leaseId) {
    try {
      await drive.setProps(leaseId, props);
      return;
    } catch (err) {
      if (err.code !== 'not_found') throw err;
    }
  }
  const s = await store.scan(root.id);
  if (s.lease) {
    leaseId = s.lease.id;
    await drive.setProps(leaseId, props);
  } else {
    leaseId = (await drive.uploadBuffer({ name: 'lease', parent: root.id, appProperties: props, data: Buffer.from('{}') })).id;
  }
}

async function heartbeat() {
  if (!running || state.frozen) return;
  try {
    const claims = await drive.list(`'${root.id}' in parents and trashed = false${drive.prop('ps', 'claim')}`);
    const other = claims.find((c) => c.appProperties.inst !== state.instance && Date.parse(c.createdTime) > Date.parse(stats.startedAt));
    if (other) {
      console.log(`Dauerbetrieb: Instanz ${other.appProperties.inst} übernimmt – übergebe.`);
      await freeze('anspruch');
      return;
    }
    await writeLease();
  } catch (err) {
    console.warn('Dauerbetrieb: Herzschlag fehlgeschlagen:', err.message);
  }
}

let freezing = null;
/** Keine Änderungen mehr annehmen, alles hochladen, freigeben. Liefert die letzte Position. */
function freeze(reason) {
  if (freezing) return freezing;
  freezing = (async () => {
    state.frozen = true;
    state.frozenAt = new Date().toISOString();
    console.log(`Dauerbetrieb: Übergabe (${reason}) – nehme keine Änderungen mehr an.`);
    try {
      setSetting('server_running', ''); // geordnetes Ende, kein „Absturz“ beim nächsten Start
    } catch {
      /* egal */
    }
    try {
      require('../integrations/discordBot').stop('aus');
    } catch {
      /* Bot war aus */
    }
    clearInterval(tick);
    clearInterval(leaseTimer);
    if (running) {
      try {
        rotate();
      } catch (err) {
        console.error('Dauerbetrieb: letztes Paket fehlgeschlagen:', err.message);
      }
      const ok = await flush(cfg.HANDOVER_TIMEOUT_MS - 2000);
      if (!ok) console.error(`Dauerbetrieb: ${queue.length} Pakete konnten vor der Übergabe nicht hochgeladen werden.`);
      await uploadStagedRestore().catch((err) => console.error('Dauerbetrieb: vorgemerkte Sicherung nicht übernommen:', err.message));
      await writeLease({ state: 'released' }).catch((err) => console.warn('Dauerbetrieb: Freigabe nicht gespeichert:', err.message));
      fenced = true; // ab jetzt schreibt diese Instanz nichts mehr ins Drive
      if (reason !== 'Beenden') watchTakeover();
    }
    return { instance: state.instance, lin, gen, seq, pending: queue.length };
  })();
  return freezing;
}

/**
 * „Sicherung einspielen“ (Einstellungen → Sicherung & Notfall) merkt eine Datenbank als restore.db für den nächsten
 * Start vor. Im Dauerbetrieb ist der nächste Start ein frischer Container – deshalb wird sie beim Übergeben als neuer
 * Gesamtstand ins Drive gelegt; die nächste Instanz lädt genau diese.
 */
async function uploadStagedRestore() {
  const staged = path.join(path.dirname(DB_PATH), 'restore.db');
  if (!fs.existsSync(staged)) return;
  const next = gen + 1;
  const item = { kind: 'base', lin, gen: next, file: path.join(TMP, `eingespielt-${next}.db`), at: new Date().toISOString() };
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(staged, item.file);
  await uploadItem(item);
  gen = next;
  seq = 0;
  fs.rmSync(staged, { force: true });
  console.log(`Dauerbetrieb: vorgemerkte Sicherung als Stand ${next} ins Drive gelegt – die nächste Instanz lädt sie.`);
}

/**
 * Nach einer Übergabe: Übernimmt die neue Instanz wirklich? Solange ihr Anspruch einen frischen Herzschlag hat, wird
 * gewartet. Bleibt er aus (Start abgebrochen, Deploy fehlgeschlagen) und hat niemand übernommen, arbeitet diese
 * Instanz weiter – sonst wäre die Website bis zum nächsten Deploy schreibgeschützt.
 */
function watchTakeover() {
  const quiet = cfg.TAKEOVER_QUIET_MS;
  const check = async () => {
    if (!state.frozen || !fenced) return;
    try {
      const s = await store.scan(root.id);
      const lease = s.lease && s.lease.appProperties;
      if (lease && lease.owner !== state.instance) return; // übernommen – fertig
      const newer = s.bases.some((b) => Date.parse(b.createdTime) > Date.parse(state.frozenAt));
      if (newer) return; // neue Instanz hat schon einen Stand angelegt
      const alive = s.claims.some((c) => c.appProperties.inst !== state.instance && Date.now() - Date.parse(c.appProperties.at || c.modifiedTime || c.createdTime) < quiet);
      if (alive || Date.now() - Date.parse(state.frozenAt) < quiet) {
        setTimeout(check, Math.max(2000, cfg.LEASE_MS)).unref();
        return;
      }
      await resume();
    } catch (err) {
      console.warn('Dauerbetrieb: Übergabe-Wächter:', err.message);
      setTimeout(check, Math.max(5000, cfg.LEASE_MS * 2)).unref();
    }
  };
  setTimeout(check, Math.max(2000, cfg.LEASE_MS)).unref();
}

/** Übergabe ist gescheitert: wieder Änderungen annehmen, mit einem frischen Gesamtstand weiter. */
async function resume() {
  console.warn('Dauerbetrieb: Die neue Instanz hat nicht übernommen – diese Instanz arbeitet weiter.');
  fenced = false;
  freezing = null;
  state.frozen = false;
  state.frozenAt = null;
  snapshot();
  tick = setInterval(onTick, cfg.JOURNAL_MS);
  tick.unref();
  leaseTimer = setInterval(() => heartbeat(), cfg.LEASE_MS);
  leaseTimer.unref();
  stats.startedAt = new Date().toISOString(); // ältere Ansprüche gelten nicht mehr
  await drain();
  await writeLease().catch(() => {});
  try {
    require('../integrations/discordBot').start();
  } catch {
    /* Bot aus */
  }
  require('./notify').info('Update nicht übernommen – die Website läuft normal weiter', 'Eine neue Version hat beim Start keine Daten übernommen (Start abgebrochen oder Deploy fehlgeschlagen). Die bisherige Instanz nimmt wieder Änderungen an; nichts ging verloren. Bitte das Deploy in Render prüfen.');
}

/** Bitte einer neuen Instanz (POST /api/dauer/uebergabe), signiert mit dem Datenschlüssel. */
async function handover({ from, ts, sig }) {
  if (!key) throw Object.assign(new Error('Live-Sicherung nicht aktiv.'), { status: 409 });
  if (!from || from === state.instance) throw Object.assign(new Error('Eigene Instanz.'), { status: 409 });
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) throw Object.assign(new Error('Abgelaufen.'), { status: 403 });
  const want = require('./boot').sign(key, `uebergabe|${ts}|${from}`);
  if (typeof sig !== 'string' || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw Object.assign(new Error('Ungültige Signatur.'), { status: 403 });
  return freeze(`Deploy → ${from}`);
}

/** Render beendet die Instanz (SIGTERM): letzter Stand hoch. */
async function shutdown() {
  if (!running && !state.frozen) return;
  await Promise.race([freeze('Beenden'), new Promise((r) => setTimeout(r, 25000))]);
}

/* ---------------------------------------------------------------- Start */
async function begin() {
  ensureKey();
  ensureLineage();
  drive.useRefreshToken(token);
  root = await store.ensureRoot();
  const s = await store.scan(root.id);
  const restored = state.restore && state.restore.mode === 'wiederhergestellt';
  const otherLines = [...new Set(s.bases.filter((b) => b.lin !== lin).map((b) => b.lin))];
  const mine = s.bases.filter((b) => b.lin === lin);
  if (restored && mine.some((b) => b.gen > state.restore.gen)) {
    // Die vorige Instanz hat weitergearbeitet (dieser Start dauerte zu lange) – mit altem Stand nie live gehen
    console.error('Dauerbetrieb: Die vorige Instanz hat nach der Wiederherstellung weitergearbeitet – Neustart, um ihren Stand zu laden.');
    process.exit(1);
  }
  gen = Math.max(0, ...mine.map((b) => b.gen), restored ? state.restore.gen : 0);
  // Ordner kennt schon eine andere aktive Linie, und wir haben sie nicht geladen → nichts überschreiben, nachfragen
  const active = root.appProperties && root.appProperties.active;
  if (!restored && otherLines.length && (!active || active !== lin)) {
    const newest = s.bases.filter((b) => b.lin !== lin).sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))[0];
    state.conflict = { lin: newest.lin, gen: newest.gen, at: newest.appProperties.at || newest.createdTime, lines: otherLines };
    require('./notify').raise('dauer-konflikt', {
      title: 'Dauerbetrieb: anderer Stand im Google Drive gefunden',
      description: `Der Server ist ohne Wiederherstellung gestartet (kein Wiederherstellungs-Schlüssel in Render?), im Google Drive liegt aber ein Stand vom ${new Date(state.conflict.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}. Nichts wurde überschrieben. Dashboard → Einstellungen → Dauerbetrieb: Stand übernehmen oder den aktuellen behalten.`,
    });
  } else if (!active || active !== lin) {
    await drive.setProps(root.id, { ps: 'dauer-root', active: lin });
    root.appProperties = { ...root.appProperties, active: lin };
  }
  snapshot();
  stats.startedAt = new Date().toISOString();
  running = true;
  await drain(); // erster Gesamtstand muss oben sein, bevor diese Instanz Änderungen annimmt
  if (queue.length) console.warn('Dauerbetrieb: erster Gesamtstand noch nicht im Drive – wird weiter versucht.');
  await writeLease().catch((err) => console.warn('Dauerbetrieb: Herzschlag fehlgeschlagen:', err.message));
  // eigener Anspruch (beim Start abgelegt) ist erledigt
  if (state.claimBeat) state.claimBeat.stop();
  const claims = await drive.list(`'${root.id}' in parents and trashed = false${drive.prop('ps', 'claim')}`).catch(() => []);
  for (const c of claims) if (c.appProperties.inst === state.instance) await drive.remove(c.id).catch(() => {});
  tick = setInterval(onTick, cfg.JOURNAL_MS);
  tick.unref();
  leaseTimer = setInterval(() => heartbeat(), cfg.LEASE_MS);
  leaseTimer.unref();
  require('./files').start(root.id);
  require('./guard').start();
  if (restored) noteRestore();
  console.log(`Dauerbetrieb: Live-Sicherung läuft (Linie ${lin}, Stand ${gen}).`);
}

/** Nach einer Wiederherstellung: Board-Hinweis, wenn es kein geplanter Wechsel war (Absturz, eingeschlafen). */
function noteRestore() {
  const r = state.restore;
  stats.restoredAt = new Date().toISOString();
  const pred = state.predecessor;
  const lease = pred && pred.lease;
  const leaseAge = lease && lease.at ? Date.now() - Date.parse(lease.at) : null;
  if (r.fallback || r.broken) {
    require('./notify').info('Dauerbetrieb: Stand nur teilweise wiederhergestellt', `${r.fallback ? `Der neueste Gesamtstand im Drive war beschädigt (${r.fallback}) – geladen wurde der vorige Stand ${r.gen}. ` : ''}${r.broken ? `Ein Änderungspaket ließ sich nicht einspielen (${r.broken}); geladen ist alles davor. ` : ''}Bitte im Dashboard prüfen, ob die letzten Änderungen da sind.`);
  }
  if (pred && (pred.handover === 'direkt' || pred.handover === 'anspruch' || (lease && lease.state === 'released'))) return; // geplant (Deploy/Neustart)
  const slept = leaseAge !== null && leaseAge > 15 * 60 * 1000;
  require('./notify').info(slept ? 'Server war eingeschlafen – Daten vollständig zurück' : 'Server wurde unerwartet neu gestartet – Daten zurück', `${slept ? `Die Website war etwa ${Math.round(leaseAge / 60000)} Minuten nicht erreichbar (kein Wecker hat sie wach gehalten – bitte cron-job.org prüfen). ` : 'Die vorige Instanz ist ohne Übergabe verschwunden (Absturz oder Neustart durch Render). '}Wiederhergestellt: Stand ${r.gen} mit ${r.journals} Änderungspaketen bis ${new Date(r.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} in ${Math.round(r.ms / 100) / 10} s.${r.broken ? ` Achtung: ${r.broken}.` : ''}`);
}

async function start() {
  if (!cfg.enabled()) return;
  require('./wach').start();
  if (!token()) {
    state.live = 'wartet-auf-google';
    console.warn('Dauerbetrieb: Google ist nicht verbunden – Änderungen werden erst gesichert, wenn das Google-Konto verbunden ist (Dashboard → Einstellungen → Integrationen).');
    waitTimer = setInterval(() => kick(), 60000);
    waitTimer.unref();
    return;
  }
  try {
    await begin();
    state.live = 'aktiv';
  } catch (err) {
    state.live = 'fehler';
    stats.lastError = err.message;
    stats.lastErrorAt = new Date().toISOString();
    console.error('Dauerbetrieb: Live-Sicherung konnte nicht starten:', err.message);
    if (!waitTimer) {
      waitTimer = setInterval(() => kick(), 60000);
      waitTimer.unref();
    }
  }
}

/** Google gerade verbunden (oder neuer Versuch): Live-Sicherung starten, falls sie noch nicht läuft. */
let kicking = null;
function kick() {
  if (!cfg.enabled() || running || state.frozen || kicking || !token()) return kicking;
  kicking = begin()
    .then(() => {
      state.live = 'aktiv';
      clearInterval(waitTimer);
      waitTimer = null;
    })
    .catch((err) => {
      state.live = 'fehler';
      stats.lastError = err.message;
      stats.lastErrorAt = new Date().toISOString();
      console.warn('Dauerbetrieb: Start der Live-Sicherung fehlgeschlagen:', err.message);
    })
    .finally(() => (kicking = null));
  return kicking;
}

/** Sofort einen Gesamtstand (Knopf „Jetzt komplett sichern“). */
async function forceBase() {
  if (!running) throw Object.assign(new Error('Die Live-Sicherung läuft nicht.'), { status: 409 });
  if (!queue.some((q) => q.kind === 'base')) snapshot();
  await flush(120000);
  return status();
}

/** Probelauf: Stand aus dem Drive in eine Kopie bauen und mit der laufenden Datenbank vergleichen. */
async function probe() {
  if (!running) throw Object.assign(new Error('Die Live-Sicherung läuft nicht.'), { status: 409 });
  rotate();
  await flush(60000);
  const s = await store.scan(root.id);
  const choice = store.pick(s, lin);
  if (!choice || choice.lin !== lin) throw Object.assign(new Error('Im Drive liegt noch kein Stand dieser Datenbank.'), { status: 409 });
  fs.mkdirSync(TMP, { recursive: true });
  const target = path.join(TMP, `probe-${Date.now()}.db`);
  const t0 = Date.now();
  try {
    const info = await store.rebuild(choice, key, target);
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(target, { readOnly: true });
    let a;
    let b;
    try {
      a = store.rowCounts(copy);
      b = store.rowCounts(db);
    } finally {
      copy.close();
    }
    const diffs = Object.keys({ ...a, ...b })
      .filter((t) => a[t] !== b[t])
      .map((t) => ({ table: t, drive: a[t] ?? null, live: b[t] ?? null }));
    const result = { ok: diffs.length === 0 && !info.broken, at: new Date().toISOString(), ms: Date.now() - t0, gen: info.gen, journals: info.journals, tables: Object.keys(b).length, rows: Object.values(b).reduce((x, y) => x + y, 0), diffs: diffs.slice(0, 20), broken: info.broken };
    setSetting('dauer_probe', JSON.stringify(result));
    return result;
  } finally {
    for (const ext of ['', '-wal', '-shm', '.laden']) fs.rmSync(target + ext, { force: true });
  }
}

/* ---------------------------------------------------------------- Linien (anderer Stand im Drive) */
async function chooseLine(action, wanted) {
  if (!running) throw Object.assign(new Error('Die Live-Sicherung läuft nicht.'), { status: 409 });
  const s = await store.scan(root.id);
  if (action === 'keep') {
    await drive.setProps(root.id, { ps: 'dauer-root', active: lin });
    root.appProperties = { ...root.appProperties, active: lin };
    state.conflict = null;
    require('./notify').resolve('dauer-konflikt', {}, true);
    return { ok: true };
  }
  if (action === 'adopt') {
    if (!s.bases.some((b) => b.lin === wanted)) throw Object.assign(new Error('Diesen Stand gibt es im Drive nicht (mehr).'), { status: 404 });
    if (!cfg.recoveryKey()) throw Object.assign(new Error('Bitte zuerst den Wiederherstellungs-Schlüssel in Render eintragen (DAUERBETRIEB_SCHLUESSEL) – sonst kann der Server beim Neustart nichts laden.'), { status: 409 });
    await drive.setProps(root.id, { ps: 'dauer-root', active: wanted });
    state.conflict = null;
    require('./notify').resolve('dauer-konflikt', {}, true);
    // Neustart: Render startet die Instanz neu, beim Start wird die gewählte Linie geladen
    setTimeout(async () => {
      await shutdown();
      process.exit(0);
    }, 500).unref();
    return { ok: true, restarting: true };
  }
  throw Object.assign(new Error('Unbekannte Aktion.'), { status: 400 });
}

/** Alle Stände im Drive (für die Auswahl im Dashboard). */
async function lines() {
  if (!running) return [];
  const s = await store.scan(root.id);
  const by = new Map();
  for (const b of s.bases) {
    const cur = by.get(b.lin);
    if (!cur || b.gen > cur.gen) by.set(b.lin, b);
  }
  return [...by.values()].map((b) => {
    const js = s.journals.filter((j) => j.lin === b.lin && j.gen === b.gen);
    const last = js.sort((x, y) => y.seq - x.seq)[0];
    return { lin: b.lin, gen: b.gen, at: (last && last.createdTime) || b.appProperties.at || b.createdTime, size: Number(b.appProperties.size) || b.size, mine: b.lin === lin, active: root.appProperties && root.appProperties.active === b.lin };
  });
}

function status() {
  return {
    running,
    live: state.live || (cfg.enabled() ? 'startet' : 'aus'),
    lin,
    gen,
    seq,
    queue: queue.length,
    frozen: state.frozen,
    fenced,
    keyId: key ? pack.keyId(key) : null,
    rootUrl: root ? `https://drive.google.com/drive/folders/${encodeURIComponent(root.id)}` : null,
    conflict: state.conflict || null,
    stats: { ...stats },
    probe: (() => {
      try {
        return JSON.parse(getSetting('dauer_probe', 'null'));
      } catch {
        return null;
      }
    })(),
  };
}

/** Wiederherstellungs-Schlüssel für Render (Refresh-Token + Datenschlüssel, verschlüsselt mit dem Client-Secret). */
function recoveryKey() {
  const rt = (() => {
    try {
      return require('../integrations/googleDrive').currentRefreshToken();
    } catch {
      return null;
    }
  })();
  if (!rt) throw Object.assign(new Error('Zuerst das Google-Konto der Kanzlei verbinden (Einstellungen → Integrationen → Google Docs).'), { status: 409 });
  if (!cfg.clientSecret()) throw Object.assign(new Error('GOOGLE_CLIENT_SECRET fehlt in Render.'), { status: 409 });
  ensureKey();
  return pack.sealRecovery({ rt, k: key.toString('base64') }, cfg.clientSecret());
}

/** Passt der Schlüssel in Render zur aktuellen Google-Verbindung und zum Datenschlüssel? */
function recoveryState() {
  const raw = cfg.recoveryKey();
  if (!raw) return { set: false };
  try {
    const c = pack.unsealRecovery(raw, cfg.clientSecret());
    let rt = null;
    try {
      rt = require('../integrations/googleDrive').currentRefreshToken();
    } catch {
      rt = null;
    }
    const keyOk = !key || c.k.equals(key);
    const tokenOk = !rt || rt === c.rt;
    return { set: true, valid: true, keyOk, tokenOk, ok: keyOk && tokenOk };
  } catch (err) {
    return { set: true, valid: false, error: err.message, ok: false };
  }
}

module.exports = { start, kick, touch, freeze, handover, shutdown, forceBase, probe, chooseLine, lines, status, recoveryKey, recoveryState, isRunning: () => running, rootId: () => (root ? root.id : null), dataKey: () => key, flush };
