'use strict';
/*
 * Google-Sheets-Anbindung – nach denselben Regeln wie Google Docs (gdocs.js).
 *
 * Per Link freigegebene Tabellen („Jeder, der über den Link verfügt“) stellt Google ohne Anmeldung
 * als CSV bereit (…/spreadsheets/d/<ID>/export?format=csv&gid=<Blatt>), im Web veröffentlichte
 * Tabellen unter …/spreadsheets/d/e/<ID>/pub?output=csv. Übernommen wird das Tabellenblatt aus dem
 * Link (#gid=…), sonst das erste Blatt. Kein Google-Konto, keine Passwörter, keine Cookies;
 * nicht freigegebene Tabellen leitet Google zur Anmeldung um – das wird erkannt und klar gemeldet.
 *
 * Die Abschrift wird als tabulatorgetrennter Text gespeichert (eine Zeile je Tabellenzeile):
 * Das Dashboard zeigt sie als Tabelle, und kopiert lässt sie sich direkt in Excel/Sheets einfügen.
 */
const { fetchLimited } = require('./remote');
const { HOST, DOC_ID, PUB_ID, titleFrom, isGoogleContent, isLogin, NOT_SHARED: DOC_NOT_SHARED } = require('./gdocs');

const GID = /^\d{1,12}$/;
const MAX_EXPORT_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 60000; // wie die Abschrift aller externen Dokumente
const MAX_COLUMNS = 50;

const NOT_SHARED = DOC_NOT_SHARED.replace('In Google Docs', 'In Google Sheets').replace('Das Dokument', 'Die Tabelle');

/**
 * Erkennt eine Google-Sheets-Tabelle. Akzeptiert Links wie
 *   https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing        (erstes Tabellenblatt)
 *   https://docs.google.com/spreadsheets/d/<ID>/edit?gid=123#gid=123    (bestimmtes Tabellenblatt)
 *   https://docs.google.com/spreadsheets/d/e/<ID>/pubhtml               (im Web veröffentlicht)
 *   <ID>                                                                (nur die Tabellen-ID)
 */
function parseSheetRef(input) {
  const text = String(input ?? '').trim();
  const example = `https://${HOST}/spreadsheets/d/…/edit`;
  if (!text) return { ok: false, error: 'Bitte einen Google-Sheets-Link einfügen.' };
  if (text.length > 600) return { ok: false, error: 'Der Link ist zu lang.' };

  let id;
  let gid = '';
  let published = false;
  if (DOC_ID.test(text)) {
    id = text;
  } else {
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return { ok: false, error: `Das ist kein gültiger Link. Beispiel: ${example}` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Nur http(s)-Links sind möglich.' };
    if (url.username || url.password) return { ok: false, error: 'Der Link darf keine Zugangsdaten enthalten.' };
    if (url.hostname.toLowerCase() !== HOST || url.port) return { ok: false, error: `Das ist kein Google-Sheets-Link (${HOST}).` };
    if (url.pathname.startsWith('/document/')) {
      return { ok: false, error: 'Das ist ein Google-Docs-Textdokument – bitte über „Google-Docs-Dokument“ hinzufügen.' };
    }
    if (/^\/(presentation|forms|drawings)\//.test(url.pathname)) {
      return { ok: false, error: 'Möglich sind nur Google-Sheets-Tabellen – keine Präsentationen oder Formulare.' };
    }
    const pub = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([^/]+)(?:\/.*)?$/);
    const doc = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)(?:\/.*)?$/);
    if (pub) {
      id = pub[1];
      published = true;
    } else if (doc) {
      id = doc[1];
    } else {
      return { ok: false, error: `Das ist kein Link auf eine einzelne Google-Sheets-Tabelle. Erwartet wird z. B. ${example}` };
    }
    // Neuere Links tragen das Blatt in ?gid=…, ältere nur in #gid=…
    const fromHash = url.hash.match(/(?:^#|&)gid=([^&]*)/);
    gid = url.searchParams.get('gid') ?? (fromHash ? fromHash[1] : '');
    if (gid && !GID.test(gid)) return { ok: false, error: 'Der Link enthält eine ungültige Tabellenblatt-Angabe (gid).' };
  }

  if (published ? !PUB_ID.test(id) : !DOC_ID.test(id)) return { ok: false, error: 'Der Link enthält keine gültige Google-Sheets-ID.' };
  const base = `https://${HOST}/spreadsheets/d/${published ? 'e/' : ''}${id}`;
  return {
    ok: true,
    documentId: `${published ? 'e/' : ''}${id}${gid ? `#gid=${gid}` : ''}`,
    canonicalUrl: published ? `${base}/pubhtml${gid ? `?gid=${gid}&single=true` : ''}` : `${base}/edit${gid ? `#gid=${gid}` : ''}`,
    exportUrl: published ? `${base}/pub?output=csv${gid ? `&gid=${gid}&single=true` : ''}` : `${base}/export?format=csv${gid ? `&gid=${gid}` : ''}`,
    host: HOST,
    input: text,
    published,
    gid,
  };
}

/** CSV nach RFC 4180 (Anführungszeichen, "" als Escape, Zeilenumbrüche in Zellen). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Zeilen → tabulatorgetrennter Text. Zellen werden einzeilig (Umbruch → " / "), leere Zeilen am
 * Rand entfallen, mehrere leere Zeilen werden zu einer. Gekürzt wird nur an Zeilengrenzen.
 */
function rowsToText(rows) {
  const clean = rows.map((r) => {
    const cells = r.slice(0, MAX_COLUMNS).map((c) => c.replace(/\r?\n|\r/g, ' / ').replace(/[\t\u0000-\u0008\u000b-\u001f]/g, ' ').trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells;
  });
  // Tatsächlich benutzte Spalten (der Export enthält oft leere Zellen bis zum Blattrand).
  const columns = rows.reduce((n, r) => {
    let last = r.length;
    while (last && !String(r[last - 1]).trim()) last -= 1;
    return Math.max(n, last);
  }, 0);
  const lines = [];
  for (const cells of clean) {
    if (!cells.length && (!lines.length || lines[lines.length - 1] === '')) continue;
    lines.push(cells.join('\t'));
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const total = lines.filter(Boolean).length;
  let size = 0;
  let keep = 0;
  while (keep < lines.length && size + lines[keep].length + 1 <= MAX_TEXT) {
    size += lines[keep].length + 1;
    keep += 1;
  }
  const kept = lines.slice(0, keep);
  return {
    text: kept.join('\n'),
    rows: kept.filter(Boolean).length,
    totalRows: total,
    truncated: keep < lines.length,
    columnsCut: columns > MAX_COLUMNS,
  };
}

/** Lädt das Tabellenblatt als CSV und liefert { title, text, rows, totalRows, truncated, columnsCut }. */
async function fetchSheet(ref) {
  let result;
  try {
    result = await fetchLimited(ref.exportUrl, {
      maxBytes: MAX_EXPORT_BYTES,
      accept: 'text/csv',
      timeoutMs: 12000,
      maxRedirects: 3,
      sourceLabel: 'Google Sheets',
      allowRedirect: (next) => next.protocol === 'https:' && isGoogleContent(next.hostname) && !isLogin(next),
      onRedirectDenied: (next) => {
        if (isLogin(next)) throw new Error(NOT_SHARED);
      },
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      throw new Error(
        `Google Sheets verweigert den Zugriff (${err.status}). Meist ist die Tabelle nicht öffentlich freigegeben – oder der Besitzer hat „Herunterladen, Drucken und Kopieren“ für Betrachter deaktiviert. Freigabe prüfen oder den Inhalt kopieren und unten einfügen.`
      );
    }
    if (err.status === 400 || err.status === 404) {
      throw new Error(
        ref.gid
          ? 'Google Sheets findet diese Tabelle oder dieses Tabellenblatt nicht – bitte den Link prüfen (das Blatt öffnen und die Adresse aus der Adresszeile kopieren).'
          : 'Google Sheets findet diese Tabelle nicht – bitte den Link prüfen.'
      );
    }
    if (err.status === 429) throw new Error('Google Sheets hat die Anfrage vorübergehend abgelehnt. Bitte gleich noch einmal versuchen – oder den Inhalt kopieren und einfügen.');
    throw err;
  }
  const type = result.headers.get('content-type') || '';
  const body = result.buffer.toString('utf8');
  if (/text\/html/i.test(type)) {
    // Eine Anmelde- oder Fehlerseite statt der Tabelle.
    throw new Error(/accounts\.google\.com/i.test(body) ? NOT_SHARED : 'Google Sheets hat keine Tabelle geliefert. Bitte den Link prüfen – oder den Inhalt kopieren und einfügen.');
  }
  if (!/text\/(csv|plain)|application\/(csv|octet-stream)/i.test(type)) {
    throw new Error('Google Sheets hat keine Tabelle geliefert. Bitte den Link prüfen – oder den Inhalt kopieren und einfügen.');
  }
  const title = titleFrom(result.headers, '').replace(/\.csv$/i, '').trim();
  return { title, ...rowsToText(parseCsv(body)) };
}

/**
 * Abschrift (tabulatorgetrennt) als ausgerichtete Nur-Text-Tabelle für die Textdatei.
 * Die erste Zeile gilt als Kopfzeile; sehr lange Zellen sprengen nur ihre eigene Zeile.
 */
function formatTable(text) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((l) => (l ? l.split('\t') : []));
  const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (columns <= 1) return String(text || '');
  const widths = Array.from({ length: columns }, (_, i) => Math.min(40, rows.reduce((w, r) => Math.max(w, (r[i] || '').length), 0)));
  const line = (r) =>
    widths
      .map((w, i) => (r[i] || '').padEnd(w))
      .join(' | ')
      .trimEnd();
  const out = rows.map((r) => (r.length ? line(r) : ''));
  if (out.length > 1) out.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('-+-'));
  return out.join('\n');
}

module.exports = { parseSheetRef, parseCsv, rowsToText, fetchSheet, formatTable, NOT_SHARED };
