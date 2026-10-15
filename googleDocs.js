'use strict';
/*
 * Google Docs der Kanzlei: Rechnungen, Verträge/Schriftsätze und Aktenauszüge als Google Doc mit festem Link
 * („Jeder mit dem Link kann ansehen“), angelegt im Google Drive des Kanzlei-Kontos (googleDrive.js).
 *
 * Rechnungen, Verträge und Schriftsätze bekommen ihr Doc automatisch – gleich beim Anlegen, vorhandene Dokumente
 * werden nachgeholt (Start, Verbinden, alle 10 Minuten). Wer die Freigabe eines Dokuments bewusst beendet, dem legt
 * der Server dafür keins mehr an (google_docs_optout), bis jemand es selbst wieder anlegt.
 *
 * Ändert sich etwas – Unterschrift, Rechnungsstatus, Vertragstext, Angaben der Akte –, schreibt der Server das
 * Doc automatisch neu; Link und Freigabe bleiben gleich. Ein Aktenauszug behält die gewählten Abschnitte und
 * folgt ebenfalls automatisch jeder Änderung an der Akte (Notizen, Anhänge, Termine, Verträge, Rechnungen …).
 * Einen Knopf „Aktualisieren“ gibt es nicht. Gelöschte Rechnungen/Verträge (und endgültig gelöschte Akten)
 * wandern auch in Google Drive in den Papierkorb.
 */
const fs = require('fs');
const { db } = require('./db');
const drive = require('./googleDrive');
const render = require('./docxRender');

const KINDS = ['invoice', 'contract', 'extract'];
const DEBOUNCE_MS = 1500;
const RETRY_MS = 10 * 60 * 1000;

const rowFor = (kind, refId) => db.prepare('SELECT * FROM google_docs WHERE kind = ? AND ref_id = ?').get(kind, refId);

function parseOptions(r) {
  try {
    return JSON.parse((r && r.options) || '{}');
  } catch {
    return {};
  }
}

/** Was die Druckansicht über ein Doc erfährt (ohne interne Datei-IDs). */
function docInfo(r) {
  if (!r) return null;
  return {
    url: r.url,
    createdAt: r.created_at,
    createdBy: r.created_by_name || null,
    syncedAt: r.synced_at || null,
    pending: !!r.dirty,
    error: r.sync_error || null,
    options: r.kind === 'extract' ? parseOptions(r) : undefined,
  };
}

/** Nur bekannte Abschnitte des Aktenauszugs, als true/false. */
function extractOptions(input) {
  const out = {};
  for (const [k, d] of Object.entries(render.EXTRACT_OPTIONS)) out[k] = input && typeof input[k] === 'boolean' ? input[k] : d;
  return out;
}

// Alle Schreibvorgänge bei Google nacheinander – nie zwei gleichzeitig auf dasselbe Doc
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

/** Aus wessen Sicht ein Aktenauszug entsteht: wer ihn angelegt hat (sofern noch im Team), sonst das Board. */
function viewerFor(r) {
  const staff = "role IN ('anwalt', 'admin') AND active = 1";
  return (
    (r && r.created_by && db.prepare(`SELECT * FROM users WHERE id = ? AND ${staff}`).get(r.created_by)) ||
    db.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get() ||
    null
  );
}

/** Daten laden und als DOCX aufbereiten. null = gibt es nicht mehr. */
async function build(kind, refId, { options, viewer } = {}) {
  if (kind === 'invoice') {
    const { INVOICE_SELECT, invoiceRow } = require('./models');
    const inv = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(refId);
    if (!inv) return null;
    const row = invoiceRow(inv);
    const label = row.kind === 'honorarvereinbarung' ? 'Honorarvereinbarung' : 'Rechnung';
    return {
      caseId: inv.case_id || null,
      name: `${label} ${row.number}${row.clientName ? ` – ${row.clientName}` : ''}`,
      docx: await render.invoiceDocx(row, require('./routes/invoices').firmInfo()),
    };
  }
  if (kind === 'contract') {
    const d = require('./routes/contracts').contractDocData(refId);
    if (!d) return null;
    const client = d.contract.data && d.contract.data.mandant;
    return {
      caseId: d.case.id,
      name: `${d.contract.templateName} ${d.case.caseNumber}${client ? ` – ${client}` : ''}`,
      docx: await render.contractDocx(d.contract, d.case, d.header, { fivenetUrl: d.fivenetUrl }),
    };
  }
  if (kind === 'extract') {
    const { getCase } = require('./models');
    const c = getCase(refId);
    if (!c) return null;
    // Ohne Person, aus deren Sicht der Auszug entsteht, nicht löschen, sondern als Fehler melden
    if (!viewer) throw new Error('Kein aktives Teammitglied für den Aktenauszug gefunden.');
    const data = require('./routes/cases').caseDetail(c, viewer);
    const opts = extractOptions(options);
    // Bilder der Anhänge (nur JPEG/PNG – andere Formate kann ein Word-/Google-Dokument nicht einbetten)
    const files = {};
    if (opts.attachments && opts.images) {
      const { evidencePath, detectImage } = require('./uploads');
      for (const a of data.attachments || []) {
        const r = db.prepare('SELECT file FROM case_attachments WHERE id = ?').get(a.id);
        try {
          const buf = r && fs.readFileSync(evidencePath(r.file));
          const type = buf && detectImage(buf);
          if (type && (type.ext === 'jpg' || type.ext === 'png')) files[a.id] = { data: buf, type: type.ext };
        } catch {
          /* Datei fehlt – im Doc steht dann „Bild nicht verfügbar“ */
        }
      }
    }
    return {
      caseId: c.id,
      name: `Aktenauszug ${c.case_number}${c.title ? ` – ${c.title}` : ''}`,
      docx: await render.extractDocx(data, require('./routes/invoices').firmInfo(), { ...opts, staff: true, files }),
    };
  }
  return null;
}

/** Vorhandenes Doc neu schreiben; existiert es in Drive nicht mehr, neu anlegen (dann mit neuem Link). */
async function write(r, doc) {
  try {
    await drive.updateDoc(r.file_id, doc.name, doc.docx);
    db.prepare("UPDATE google_docs SET case_id = ?, synced_at = datetime('now'), dirty = 0, sync_error = '' WHERE id = ?").run(doc.caseId, r.id);
  } catch (err) {
    if (err.code !== 'not_found') throw err;
    const f = await drive.createDoc(r.kind, doc.name, doc.docx);
    db.prepare("UPDATE google_docs SET case_id = ?, file_id = ?, url = ?, synced_at = datetime('now'), dirty = 0, sync_error = '' WHERE id = ?").run(doc.caseId, f.id, f.url, r.id);
  }
}

function recordError(r, err) {
  db.prepare('UPDATE google_docs SET dirty = 1, sync_error = ? WHERE id = ?').run(String(err.message || err).slice(0, 300), r.id);
}

/**
 * Doc anlegen bzw. sofort aktualisieren (Knopf in der Druckansicht). Rechte prüft die Route.
 * options: nur beim Aktenauszug (gewählte Abschnitte).
 */
function publish(kind, refId, user, options) {
  return serial(async () => {
    const existing = rowFor(kind, refId);
    const opts = kind === 'extract' ? extractOptions(options || parseOptions(existing)) : {};
    const doc = await build(kind, refId, { options: opts, viewer: kind === 'extract' ? user : null });
    if (!doc) throw Object.assign(new Error('Dokument nicht gefunden.'), { status: 404 });
    if (existing) {
      try {
        await write(existing, doc);
        if (kind === 'extract') db.prepare('UPDATE google_docs SET options = ? WHERE id = ?').run(JSON.stringify(opts), existing.id);
      } catch (err) {
        recordError(existing, err);
        throw err;
      }
    } else {
      const f = await drive.createDoc(kind, doc.name, doc.docx);
      db.prepare(
        "INSERT INTO google_docs (kind, ref_id, case_id, file_id, url, options, created_by, created_by_name, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run(kind, refId, doc.caseId, f.id, f.url, JSON.stringify(opts), user ? user.id : null, user ? user.display_name : '');
    }
    return docInfo(rowFor(kind, refId));
  });
}

/** Im Hintergrund neu schreiben (nach einer Änderung). Wirft nie. */
async function sync(kind, refId) {
  const r = rowFor(kind, refId);
  if (!r) return;
  if (!drive.connected()) return; // bleibt markiert und wird nach dem (erneuten) Verbinden nachgeholt
  try {
    const doc = await build(kind, refId, { options: parseOptions(r), viewer: kind === 'extract' ? viewerFor(r) : null });
    if (!doc) {
      // Rechnung/Vertrag gibt es nicht mehr → auch in Drive aufräumen
      db.prepare('DELETE FROM google_docs WHERE id = ?').run(r.id);
      await drive.trashDoc(r.file_id).catch(() => {});
      return;
    }
    await write(r, doc);
  } catch (err) {
    console.warn(`Google Doc (${kind} ${refId}) konnte nicht aktualisiert werden:`, err.message);
    recordError(r, err);
  }
}

const timers = new Map();
/** Nach einer Änderung: Doc (falls vorhanden) gesammelt neu schreiben – mehrere Änderungen kurz hintereinander = ein Vorgang. */
function touch(kind, refId) {
  try {
    const r = rowFor(kind, Number(refId));
    if (!r) return;
    db.prepare('UPDATE google_docs SET dirty = 1 WHERE id = ?').run(r.id);
    const key = `${kind}:${r.ref_id}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        serial(() => sync(kind, r.ref_id));
      }, DEBOUNCE_MS).unref()
    );
    // Der Aktenauszug listet Verträge und Rechnungen mit Stand – zieht mit
    if (kind !== 'extract' && r.case_id) touch('extract', r.case_id);
  } catch (err) {
    console.warn('Google Doc: Aktualisierung nicht vorgemerkt:', err.message);
  }
}

/** Angaben der Akte geändert (Aktenzeichen, Titel, Gericht …): Verträge und Aktenauszug der Akte neu schreiben. */
function touchCase(caseId) {
  for (const r of db.prepare("SELECT ref_id FROM google_docs WHERE kind = 'contract' AND case_id = ?").all(caseId)) touch('contract', r.ref_id);
  touchExtract(caseId);
}

/** Irgendetwas an der Akte geändert: Aktenauszug (falls es ein Google Doc gibt) neu schreiben. */
function touchExtract(caseId) {
  if (Number(caseId) > 0) touch('extract', Number(caseId));
}

/** Z. B. Kopfzeile der Verträge oder Anschrift der Kanzlei geändert: alle Docs dieser Art neu schreiben. */
function touchKind(kind) {
  for (const r of db.prepare('SELECT ref_id FROM google_docs WHERE kind = ?').all(kind)) touch(kind, r.ref_id);
}

/** Rechnung/Vertrag gelöscht oder Freigabe beendet: Eintrag entfernen, Doc in den Drive-Papierkorb. */
function remove(kind, refId) {
  const r = rowFor(kind, Number(refId));
  if (!r) return Promise.resolve(false);
  db.prepare('DELETE FROM google_docs WHERE id = ?').run(r.id);
  if (kind !== 'extract' && r.case_id) touchExtract(r.case_id);
  return serial(() => drive.trashDoc(r.file_id))
    .then(() => true)
    .catch((err) => {
      console.warn(`Google Doc ${r.file_id} konnte nicht in den Papierkorb:`, err.message);
      return true;
    });
}

/** Akte endgültig gelöscht: Verträge und Aktenauszug der Akte auch in Drive löschen (Rechnungen bleiben). */
function removeForCase(caseId) {
  for (const r of db.prepare("SELECT kind, ref_id FROM google_docs WHERE case_id = ? AND kind IN ('contract', 'extract')").all(caseId)) remove(r.kind, r.ref_id);
}

/* ---------------------------------------------------------------- Automatisch anlegen */
// Aktenauszüge nicht – die entstehen mit gewählten Abschnitten auf Knopfdruck.
const AUTO_SQL = {
  invoice: `SELECT i.id FROM invoices i
             WHERE NOT EXISTS (SELECT 1 FROM google_docs g WHERE g.kind = 'invoice' AND g.ref_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM google_docs_optout o WHERE o.kind = 'invoice' AND o.ref_id = i.id)
             ORDER BY i.id`,
  contract: `SELECT k.id FROM case_contracts k
              WHERE NOT EXISTS (SELECT 1 FROM google_docs g WHERE g.kind = 'contract' AND g.ref_id = k.id)
                AND NOT EXISTS (SELECT 1 FROM google_docs_optout o WHERE o.kind = 'contract' AND o.ref_id = k.id)
              ORDER BY k.id`,
};
const MAX_AUTO_TRIES = 3; // je Dokument und Serverstart – danach bleibt es beim Knopf in der Druckansicht
const autoFails = new Map();
const optedOut = (kind, refId) => !!db.prepare('SELECT 1 FROM google_docs_optout WHERE kind = ? AND ref_id = ?').get(kind, refId);

/** Doc für ein Dokument anlegen, falls es noch keins gibt (läuft in der Warteschlange). Wirft nie. */
async function autoCreate(kind, refId) {
  if (!drive.connected() || rowFor(kind, refId) || optedOut(kind, refId)) return;
  const key = `${kind}:${refId}`;
  try {
    const doc = await build(kind, refId, {});
    if (!doc) return; // inzwischen gelöscht
    const f = await drive.createDoc(kind, doc.name, doc.docx);
    db.prepare(
      "INSERT INTO google_docs (kind, ref_id, case_id, file_id, url, options, created_by, created_by_name, synced_at) VALUES (?, ?, ?, ?, ?, '{}', NULL, '', datetime('now'))"
    ).run(kind, refId, doc.caseId, f.id, f.url);
    autoFails.delete(key);
  } catch (err) {
    autoFails.set(key, (autoFails.get(key) || 0) + 1);
    console.warn(`Google Doc (${kind} ${refId}) konnte nicht automatisch angelegt werden:`, err.message);
  }
}

/** Gleich nach dem Anlegen einer Rechnung bzw. eines Vertrags/Schriftsatzes. */
function ensure(kind, refId) {
  optIn(kind, refId); // neues Dokument (SQLite vergibt Nummern gelöschter Einträge neu) → kein alter Vermerk
  if (!drive.connected()) return;
  serial(() => autoCreate(kind, Number(refId))).catch(() => {});
}

/** Fehlende Docs für vorhandene Dokumente nachholen – nacheinander im Hintergrund. Anzahl der vorgemerkten. */
let ensuring = false;
function ensureAll() {
  if (!drive.connected() || ensuring) return 0;
  const todo = [];
  for (const kind of Object.keys(AUTO_SQL)) {
    for (const r of db.prepare(AUTO_SQL[kind]).all()) if ((autoFails.get(`${kind}:${r.id}`) || 0) < MAX_AUTO_TRIES) todo.push([kind, r.id]);
  }
  if (!todo.length) return 0;
  ensuring = true;
  (async () => {
    try {
      for (const [kind, id] of todo) await serial(() => autoCreate(kind, id));
    } finally {
      ensuring = false;
    }
  })();
  return todo.length;
}

/** „Freigabe beenden“: kein automatisches Doc mehr für dieses Dokument … */
function optOut(kind, refId) {
  if (kind !== 'extract') db.prepare('INSERT OR IGNORE INTO google_docs_optout (kind, ref_id) VALUES (?, ?)').run(kind, Number(refId));
}
/** … bis jemand es selbst wieder anlegt. */
function optIn(kind, refId) {
  db.prepare('DELETE FROM google_docs_optout WHERE kind = ? AND ref_id = ?').run(kind, Number(refId));
}

/** Links der Docs für Listen im Dashboard: Map ref_id → url. */
function urls(kind, refIds) {
  const ids = [...new Set(refIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT ref_id, url FROM google_docs WHERE kind = ? AND ref_id IN (${ids.map(() => '?').join(',')})`).all(kind, ...ids);
  return new Map(rows.map((r) => [r.ref_id, r.url]));
}

/** Markierte (z. B. wegen Störung nicht geschriebene) Docs nachholen. */
function retryPending() {
  if (!drive.connected()) return 0;
  const rows = db.prepare('SELECT kind, ref_id FROM google_docs WHERE dirty = 1').all();
  for (const r of rows) touch(r.kind, r.ref_id);
  return rows.length;
}

/** Board: alle Docs neu schreiben (z. B. nach geändertem Layout). */
function resyncAll() {
  const rows = db.prepare('SELECT kind, ref_id FROM google_docs').all();
  for (const r of rows) touch(r.kind, r.ref_id);
  return rows.length;
}

function stats() {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const r of db.prepare('SELECT kind, COUNT(*) AS n FROM google_docs GROUP BY kind').all()) counts[r.kind] = r.n;
  return { counts, pending: db.prepare('SELECT COUNT(*) AS n FROM google_docs WHERE dirty = 1').get().n };
}

function start() {
  const run = () => {
    retryPending();
    ensureAll();
  };
  setTimeout(run, 5000).unref();
  setInterval(run, RETRY_MS).unref();
}

module.exports = {
  KINDS,
  rowFor,
  docInfo,
  publish,
  touch,
  touchCase,
  touchExtract,
  touchKind,
  remove,
  removeForCase,
  retryPending,
  resyncAll,
  stats,
  start,
  extractOptions,
  ensure,
  ensureAll,
  optOut,
  optIn,
  urls,
};
