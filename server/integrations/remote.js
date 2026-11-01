'use strict';
/*
 * Abrufe externer Quellen (FiveNet, Google Docs) mit festen Grenzen: Zeitlimit,
 * Höchstgröße und Weiterleitungen nur zu ausdrücklich erlaubten Zielen.
 * Es werden nie Cookies oder Zugangsdaten mitgeschickt.
 */
const USER_AGENT = 'PakeScha-Kanzlei/1.0';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Lädt eine Adresse und liefert { buffer, headers, url }.
 * allowRedirect(nextUrl) entscheidet über jede Weiterleitung (Standard: keine).
 * onRedirectDenied(nextUrl) darf einen eigenen Fehler werfen (z. B. "nicht freigegeben").
 * Fehler tragen eine deutsche Meldung; err.status enthält den HTTP-Status, falls vorhanden.
 */
async function fetchLimited(
  startUrl,
  { maxBytes, accept = '*/*', timeoutMs = 8000, maxRedirects = 0, allowRedirect = () => false, onRedirectDenied, sourceLabel = 'Die Quelle' } = {}
) {
  let url = startUrl;
  for (let hop = 0; ; hop += 1) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(err?.name === 'TimeoutError' ? 'Zeitüberschreitung' : `${sourceLabel} ist nicht erreichbar`);
    }
    if (REDIRECTS.has(res.status)) {
      res.body?.cancel().catch(() => {});
      let next = null;
      try {
        next = new URL(res.headers.get('location') || '', url);
      } catch {
        next = null;
      }
      if (next && onRedirectDenied && !allowRedirect(next)) onRedirectDenied(next);
      if (!next || hop >= maxRedirects || !allowRedirect(next)) {
        throw Object.assign(new Error(`${sourceLabel} antwortet mit ${res.status}`), { status: res.status });
      }
      url = next.toString();
      continue;
    }
    if (res.status !== 200) {
      res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`${sourceLabel} antwortet mit ${res.status}`), { status: res.status });
    }
    const tooBig = () => new Error(`Datei größer als ${Math.round(maxBytes / 1024 / 1024)} MB`);
    if (Number(res.headers.get('content-length') || 0) > maxBytes) {
      res.body?.cancel().catch(() => {});
      throw tooBig();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw tooBig();
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), headers: res.headers, url };
  }
}

module.exports = { fetchLimited };
