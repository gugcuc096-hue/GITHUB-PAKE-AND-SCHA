'use strict';
/*
 * Mehrere Lese-Abrufe in einem: fragt die genannten Schnittstellen intern beim eigenen Server ab – mit der Sitzung
 * der anfragenden Person, also mit genau ihren Rechten – und liefert die Antworten zusammen. Spart Wege über das Netz
 * (Dashboard-Start, Startseite); Rechte und Zählweise bleiben dieselben wie beim einzelnen Abruf.
 */
async function collect(req, jobs) {
  const base = `http://127.0.0.1:${req.socket.localPort}`;
  const headers = { cookie: req.get('cookie') || '', accept: 'application/json', 'accept-encoding': 'identity' };
  const out = {};
  await Promise.all(
    Object.entries(jobs).map(async ([key, path]) => {
      try {
        const resp = await fetch(base + path, { headers });
        out[key] = resp.ok ? await resp.json() : null;
      } catch {
        out[key] = null; // ein fehlender Teil ist nicht kritisch – die Seite holt ihn sonst selbst
      }
    })
  );
  return out;
}

/** Für <script type="application/json">: kein „</script>“ und keine HTML-Kommentare im eingebetteten Text. */
const jsonForHtml = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

module.exports = { collect, jsonForHtml };
