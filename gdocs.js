'use strict';
/*
 * Google-Docs-Anbindung.
 *
 * Google stellt Dokumente, die per Link freigegeben sind („Jeder, der über den Link verfügt“),
 * ohne Anmeldung als Export bereit (…/document/d/<ID>/export?format=html). Im Web veröffentlichte
 * Dokumente (…/document/d/e/<ID>/pub) sind ebenfalls öffentlich lesbar. Genau diese beiden Wege
 * werden genutzt – ohne Google-Konto, ohne Passwörter oder Cookies. Nicht freigegebene Dokumente
 * leitet Google zur Anmeldung um; das wird erkannt und klar gemeldet. Für sie bleibt der Weg,
 * den Inhalt in Google Docs zu kopieren und in der Akte einzufügen.
 */
const { fetchLimited } = require('./remote');

const HOST = 'docs.google.com';
const DOC_ID = /^[A-Za-z0-9_-]{25,100}$/;
const PUB_ID = /^2PACX-[A-Za-z0-9_-]{20,200}$/;
const MAX_EXPORT_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const NOT_SHARED =
  'Das Dokument ist nicht öffentlich freigegeben. In Google Docs oben rechts „Freigeben“ → „Allgemeiner Zugriff: Jeder, der über den Link verfügt“ (Betrachter) einstellen – oder den Inhalt kopieren und unten einfügen.';

const isGoogleContent = (host) => host === HOST || host.endsWith('.googleusercontent.com');
const isLogin = (url) => url.hostname === 'accounts.google.com' || /ServiceLogin|signin/i.test(url.pathname);

/**
 * Erkennt ein Google-Docs-Textdokument. Akzeptiert Links wie
 *   https://docs.google.com/document/d/<ID>/edit?usp=sharing   (auch /view, /u/0/…, ohne https://)
 *   https://docs.google.com/document/d/e/<ID>/pub               (im Web veröffentlicht)
 *   <ID>                                                        (nur die Dokument-ID)
 */
function parseDocumentRef(input) {
  const text = String(input ?? '').trim();
  const example = `https://${HOST}/document/d/…/edit`;
  if (!text) return { ok: false, error: 'Bitte einen Google-Docs-Link einfügen.' };
  if (text.length > 600) return { ok: false, error: 'Der Link ist zu lang.' };

  let id;
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
    if (url.hostname.toLowerCase() !== HOST || url.port) return { ok: false, error: `Das ist kein Google-Docs-Link (${HOST}).` };
    if (/^\/(spreadsheets|presentation|forms|drawings)\//.test(url.pathname)) {
      return { ok: false, error: 'Möglich sind nur Google-Docs-Textdokumente – keine Tabellen, Präsentationen oder Formulare.' };
    }
    const pub = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/e\/([^/]+)(?:\/(?:pub|pubhtml)?)?\/?$/);
    const doc = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([^/]+)(?:\/.*)?$/);
    if (pub) {
      id = pub[1];
      published = true;
    } else if (doc) {
      id = doc[1];
    } else {
      return { ok: false, error: `Das ist kein Link auf ein einzelnes Google-Docs-Dokument. Erwartet wird z. B. ${example}` };
    }
  }

  if (published ? !PUB_ID.test(id) : !DOC_ID.test(id)) return { ok: false, error: 'Der Link enthält keine gültige Google-Docs-Dokument-ID.' };
  return published
    ? {
        ok: true,
        documentId: `e/${id}`,
        canonicalUrl: `https://${HOST}/document/d/e/${id}/pub`,
        exportUrl: `https://${HOST}/document/d/e/${id}/pub?embedded=true`,
        host: HOST,
        input: text,
        published: true,
      }
    : {
        ok: true,
        documentId: id,
        canonicalUrl: `https://${HOST}/document/d/${id}/edit`,
        exportUrl: `https://${HOST}/document/d/${id}/export?format=html`,
        host: HOST,
        input: text,
        published: false,
      };
}

/** Dokumenttitel aus Content-Disposition (filename*=UTF-8''… bzw. filename="…") oder <title>. */
function titleFrom(headers, html) {
  const cd = headers.get('content-disposition') || '';
  let name = '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = cd.match(/filename="([^"]+)"/i);
  try {
    if (star) name = decodeURIComponent(star[1]);
  } catch {
    name = '';
  }
  if (!name && plain) name = plain[1];
  if (!name) {
    const t = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
    if (t) name = t[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return name.replace(/\.html?$/i, '').replace(/\s+-\s+Google (Docs|Präsentationen)$/i, '').trim().slice(0, 300);
}

/**
 * Lädt ein freigegebenes Dokument als HTML. Weiterleitungen sind nur zu Google-Inhaltsservern
 * erlaubt; eine Weiterleitung zur Google-Anmeldung bedeutet: nicht freigegeben.
 * Liefert { html, title } – <style>/<script> werden bereits hier entfernt.
 */
async function fetchDocument(ref) {
  let result;
  try {
    result = await fetchLimited(ref.exportUrl, {
      maxBytes: MAX_EXPORT_BYTES,
      accept: 'text/html',
      timeoutMs: 12000,
      maxRedirects: 3,
      sourceLabel: 'Google Docs',
      allowRedirect: (next) => next.protocol === 'https:' && isGoogleContent(next.hostname) && !isLogin(next),
      onRedirectDenied: (next) => {
        if (isLogin(next)) throw new Error(NOT_SHARED);
      },
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new Error(NOT_SHARED);
    if (err.status === 404) throw new Error('Google Docs findet dieses Dokument nicht – bitte den Link prüfen.');
    if (err.status === 429) throw new Error('Google Docs hat die Anfrage vorübergehend abgelehnt. Bitte gleich noch einmal versuchen – oder den Inhalt kopieren und einfügen.');
    throw err;
  }
  const type = result.headers.get('content-type') || '';
  if (!/text\/html/i.test(type)) throw new Error('Google Docs hat kein Dokument geliefert. Bitte den Link prüfen – oder den Inhalt kopieren und einfügen.');
  let html = result.buffer.toString('utf8');
  // Eine Anmeldeseite statt des Dokuments (manche Konten leiten nicht um, sondern zeigen sie direkt).
  if (/accounts\.google\.com\/(ServiceLogin|v3\/signin)/i.test(html) && !/doc-content|id="contents"/i.test(html)) throw new Error(NOT_SHARED);
  const title = titleFrom(result.headers, html);
  html = html.replace(/<(style|script|noscript)\b[\s\S]*?<\/\1>/gi, '');
  return { html, title };
}

/** Bildadressen aus Google-Docs-Inhalten: nur https und nur Google-Inhaltsserver. */
function imageUrlFor(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!url.hostname.toLowerCase().endsWith('.googleusercontent.com')) return null;
  url.hash = '';
  return url.toString();
}

async function fetchImage(url) {
  const { buffer } = await fetchLimited(url, {
    maxBytes: MAX_IMAGE_BYTES,
    accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
    maxRedirects: 2,
    sourceLabel: 'Google',
    allowRedirect: (next) => next.protocol === 'https:' && next.hostname.endsWith('.googleusercontent.com'),
  });
  return buffer;
}

module.exports = { HOST, parseDocumentRef, fetchDocument, imageUrlFor, fetchImage, NOT_SHARED };
