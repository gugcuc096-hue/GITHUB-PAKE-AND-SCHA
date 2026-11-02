'use strict';
/*
 * Aufbau im Google Drive (Ordner „Pake & Scha – Dauerbetrieb (nicht löschen)“, nie freigegeben):
 *   stand-<Linie>-<Gen>.psb        Gesamtstand der Datenbank (gepackt + verschlüsselt)
 *   journal-<Linie>-<Gen>-<Nr>.psj jede Änderung seit diesem Stand, Paket für Paket (SQLite-Changesets)
 *   lease                           wer gerade schreibt (Herzschlag) – für die Übergabe beim Deploy
 *   anspruch-<Instanz>              „ich übernehme“ einer neu startenden Instanz
 *   Dateien/                        jedes hochgeladene Bild einzeln (verschlüsselt)
 * Linie = eine Datenbank-Geschichte (neue Linie nur bei einer ganz frischen Datenbank). Gen = Nummer des Gesamtstands.
 * Wiederhergestellt wird der neueste Gesamtstand der aktiven Linie plus alle Journale dazu – lückenlos der Reihe nach.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync, constants } = require('node:sqlite');
const drive = require('./gdrive');
const pack = require('./pack');

const ROOT_NAME = 'Pake & Scha – Dauerbetrieb (nicht löschen)';
const FILES_NAME = 'Dateien';
const pad = (n, w = 6) => String(n).padStart(w, '0');

async function findRoot() {
  return drive.findFolder('dauer-root');
}
async function ensureRoot() {
  return drive.ensureFolder(ROOT_NAME, 'dauer-root');
}
async function ensureFilesFolder(rootId) {
  return drive.ensureFolder(FILES_NAME, 'dauer-files', rootId);
}

/** Alles im Hauptordner, sortiert nach Art. */
async function scan(rootId) {
  const files = await drive.inFolder(rootId);
  const out = { bases: [], journals: [], lease: null, claims: [], other: [] };
  for (const f of files) {
    const p = f.appProperties || {};
    if (p.ps === 'base') out.bases.push({ ...f, lin: p.lin, gen: Number(p.gen) });
    else if (p.ps === 'journal') out.journals.push({ ...f, lin: p.lin, gen: Number(p.gen), seq: Number(p.seq) });
    else if (p.ps === 'lease') out.lease = !out.lease || String(f.createdTime) > String(out.lease.createdTime) ? f : out.lease;
    else if (p.ps === 'claim') out.claims.push(f);
    else if (p.ps !== 'dauer-files') out.other.push(f);
  }
  return out;
}

/** Welcher Stand gilt: aktive Linie (Merkmal am Ordner), sonst die mit dem jüngsten Gesamtstand. */
function pick(s, activeLin) {
  if (!s.bases.length) return null;
  let lin = activeLin && s.bases.some((b) => b.lin === activeLin) ? activeLin : null;
  if (!lin) lin = [...s.bases].sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))[0].lin;
  const bases = s.bases.filter((b) => b.lin === lin).sort((a, b) => b.gen - a.gen);
  const chainFor = (base) => {
    const js = s.journals.filter((j) => j.lin === lin && j.gen === base.gen).sort((a, b) => a.seq - b.seq);
    const chain = [];
    for (const j of js) {
      if (j.seq !== chain.length + 1) break; // Lücke: alles danach gehört nicht zu einem lückenlosen Stand
      chain.push(j);
    }
    return chain;
  };
  return { lin, base: bases[0], journals: chainFor(bases[0]), older: bases.slice(1).map((b) => ({ base: b, journals: chainFor(b) })) };
}

/** Schattentabellen von Volltext-Indizes: die füllen Trigger beim Einspielen selbst. */
function shadowTables(db) {
  const vts = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all().map((r) => r.name);
  return (t) => vts.some((v) => t.startsWith(`${v}_`));
}

/** Journal-Paket: { cs: Changeset, sq: Zähler (sqlite_sequence), at } */
function encodeJournal(changeset, seqs, key) {
  const head = Buffer.from(JSON.stringify({ sq: seqs, at: new Date().toISOString() }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  return pack.encrypt(Buffer.concat([len, head, Buffer.from(changeset)]), key, { gzip: true });
}
function decodeJournal(buf, key) {
  const raw = pack.decrypt(buf, key);
  const n = raw.readUInt32BE(0);
  const head = JSON.parse(raw.subarray(4, 4 + n).toString('utf8'));
  return { ...head, cs: raw.subarray(4 + n) };
}

/** Parallel laden, in fester Reihenfolge liefern. */
async function fetchAll(items, worker, limit = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

/**
 * Stand aus dem Drive in die Datei `target` bauen: Gesamtstand laden, entschlüsseln, alle Journale einspielen,
 * Volltextindex neu aufbauen, prüfen. Liefert Angaben zum Stand.
 */
async function rebuild(choice, key, target, { log = () => {} } = {}) {
  const tmp = `${target}.laden`;
  fs.rmSync(tmp, { force: true });
  const t0 = Date.now();
  await drive.downloadTo(choice.base.id, tmp);
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(target + ext, { force: true });
  const plain = await pack.decryptFile(tmp, target, key);
  fs.rmSync(tmp, { force: true });
  const want = choice.base.appProperties && choice.base.appProperties.sha;
  if (want && want !== plain.sha256) throw new Error('Der Gesamtstand im Drive ist beschädigt (Prüfsumme stimmt nicht).');
  const raws = await fetchAll(choice.journals, (j) => drive.download(j.id));
  const db = new DatabaseSync(target);
  let applied = 0;
  let conflicts = 0;
  let lastAt = choice.base.appProperties.at || choice.base.createdTime;
  let broken = null;
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    const skip = shadowTables(db);
    const seqs = {};
    for (let i = 0; i < raws.length; i++) {
      let j;
      try {
        j = decodeJournal(raws[i], key);
      } catch (err) {
        broken = `Journal ${choice.journals[i].seq}: ${err.message}`;
        break;
      }
      const ok = db.applyChangeset(j.cs, {
        filter: (t) => !skip(t),
        onConflict: (type) => {
          conflicts += 1;
          return type === constants.SQLITE_CHANGESET_DATA || type === constants.SQLITE_CHANGESET_CONFLICT ? constants.SQLITE_CHANGESET_REPLACE : constants.SQLITE_CHANGESET_OMIT;
        },
      });
      if (!ok) {
        broken = `Journal ${choice.journals[i].seq} ließ sich nicht einspielen`;
        break;
      }
      for (const [name, seq] of Object.entries(j.sq || {})) seqs[name] = Math.max(seqs[name] || 0, Number(seq) || 0);
      applied += 1;
      lastAt = j.at || lastAt;
    }
    // Zähler für neue Nummern: nie niedriger als zuletzt vergeben (auch wenn die Zeile wieder gelöscht wurde)
    try {
      for (const [name, seq] of Object.entries(seqs)) db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(seq, name);
    } catch {
      /* keine AUTOINCREMENT-Tabellen */
    }
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%fts5%'").all()) {
      try {
        db.exec(`INSERT INTO "${name}"("${name}") VALUES('rebuild')`);
      } catch {
        /* kein externer Inhalt – bleibt, wie er ist */
      }
    }
    const check = db.prepare('PRAGMA quick_check').get();
    const verdict = check && Object.values(check)[0];
    if (verdict !== 'ok') throw new Error(`Die wiederhergestellte Datenbank ist beschädigt: ${verdict}`);
    db.exec('PRAGMA journal_mode = DELETE;');
  } finally {
    db.close();
  }
  log(`Dauerbetrieb: Stand ${choice.lin}/${choice.base.gen} + ${applied} Journale in ${Date.now() - t0} ms geladen.`);
  return {
    lin: choice.lin,
    gen: choice.base.gen,
    seq: applied,
    at: lastAt,
    bytes: plain.bytes,
    journals: applied,
    conflicts,
    broken,
    ms: Date.now() - t0,
  };
}

/** Kurzer Vergleich zweier Datenbanken: Zeilen je Tabelle (für den Probelauf). */
function rowCounts(db) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'").all()) {
    if (/_fts_/.test(name)) continue;
    out[name] = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n;
  }
  return out;
}

module.exports = { ROOT_NAME, FILES_NAME, pad, findRoot, ensureRoot, ensureFilesFolder, scan, pick, rebuild, rowCounts, encodeJournal, decodeJournal, shadowTables, fetchAll, tmpDir: (dbPath) => path.join(path.dirname(dbPath), '.dauer') };
