'use strict';
/*
 * Ein-Klick-Übernahme aus FiveNet: Benutzerskript für Tampermonkey & Co., das im eigenen Browser läuft – dort, wo die Person
 * ohnehin in FiveNet angemeldet ist. Es liest nur, was auf dem Bildschirm steht (wie Markieren und Kopieren), und übergibt es
 * per postMessage an das offene Kanzlei-Dashboard. Kein Passwort, keine Sitzungs-Cookies, kein Abruf durch den Server.
 * Das Dashboard prüft die Herkunft der Nachricht und zeigt alles zur Bestätigung an (public/js/dashboard/04-…).
 */

/*
 * Der gemeinsame Kern (Dokument lesen, an das Kanzlei-Fenster senden) steht ohne Zeilenkommentare da, damit er sich als
 * Lesezeichen („Bookmarklet“) auf eine Zeile bringen lässt: Erweiterungen wie Tampermonkey sind dafür nicht nötig.
 *  - docId / contentElement: die Dokument-Nummer aus der Adresse und der größte Textbereich unter den üblichen Kandidaten.
 *  - withImages: Bilder mit vollständiger Adresse mitgeben (FiveNet lädt sie oft erst beim Scrollen und nutzt relative
 *    Adressen); die Kopie verändert die Seite nicht, Bildunterschriften (alt, title, figcaption) bleiben erhalten. Bei einer
 *    Auswahl passen die Bildlisten nicht zusammen – dann zählt nur die Kopie.
 *  - collect: markierter Text hat Vorrang (falls die automatische Erkennung den falschen Bereich trifft).
 *  - send: das Dashboard braucht einen Moment (ggf. Anmeldung) – bis zur Bestätigung alle 0,7 s erneut anbieten.
 */
function core(kanzlei) {
  return `var KANZLEI = ${JSON.stringify(kanzlei)};
var MAX_HTML = 500000;
function docId() {
  var m = location.pathname.match(/\\/documents\\/(\\d+)/);
  return m ? m[1] : '';
}
function contentElement() {
  var best = null;
  var size = 0;
  document.querySelectorAll('.ProseMirror, .tiptap, [contenteditable], .prose, article, main').forEach(function (el) {
    var n = (el.innerText || '').length;
    if (n > size) { best = el; size = n; }
  });
  return best || document.body;
}
function withImages(root, source) {
  var live = source.querySelectorAll ? source.querySelectorAll('img') : [];
  var copy = root.querySelectorAll('img');
  for (var i = 0; i < copy.length; i++) {
    var img = copy[i];
    var orig = live.length === copy.length ? live[i] : null;
    var src = (orig && (orig.currentSrc || orig.src)) || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
    if (!src) {
      var set = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
      src = set.split(',')[0].trim().split(' ')[0];
    }
    if (src) {
      try { src = new URL(src, location.href).href; } catch (err) { src = src; }
      img.setAttribute('src', src);
    }
  }
  return root.innerHTML;
}
function collect() {
  var sel = window.getSelection();
  var html = '';
  var text = '';
  if (sel && !sel.isCollapsed && String(sel).trim().length > 20) {
    var box = document.createElement('div');
    var range = sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : document.body;
    for (var i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
    html = withImages(box, range.nodeType === 1 ? range : range.parentNode || document.body);
    text = String(sel);
  } else {
    var el = contentElement();
    html = withImages(el.cloneNode(true), el);
    text = el.innerText || '';
  }
  var h = document.querySelector('h1, h2');
  var title = ((h && h.textContent) || document.title || '').replace(/\\s+/g, ' ').trim();
  return {
    type: 'ps-fivenet-doc',
    v: 1,
    nonce: String(Date.now()) + Math.random().toString(36).slice(2),
    documentId: docId(),
    title: title.slice(0, 300),
    html: html.slice(0, MAX_HTML),
    text: text.slice(0, 60000),
  };
}
function say(text) {
  var d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'position:fixed;right:18px;bottom:64px;z-index:2147483647;max-width:320px;padding:10px 16px;border-radius:12px;font:600 13px system-ui,sans-serif;color:#02050e;background:linear-gradient(135deg,#e6c25a,#b8912a);box-shadow:0 6px 20px rgba(0,0,0,.35)';
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 4500);
}
function send() {
  var payload = collect();
  if (!payload.documentId) { say('Bitte zuerst ein FiveNet-Dokument öffnen (die Adresse enthält /documents/…).'); return; }
  var win = window.open(KANZLEI + '/dashboard?import=fivenet', 'ps-kanzlei');
  if (!win) { alert('Das Kanzlei-Fenster wurde vom Browser blockiert – bitte Pop-ups für diese Seite erlauben.'); return; }
  var acked = false;
  var started = Date.now();
  window.addEventListener('message', function (e) {
    if (e.origin === KANZLEI && e.data && e.data.type === 'ps-ack') acked = true;
  });
  var timer = setInterval(function () {
    if (acked || win.closed || Date.now() - started > 180000) { clearInterval(timer); if (acked) say('Übergeben – weiter im Kanzlei-Fenster.'); return; }
    try { win.postMessage(payload, KANZLEI); } catch (err) { acked = acked; }
  }, 700);
}`;
}

/** Quelltext des Benutzerskripts für diese Kanzlei-Adresse und FiveNet-Instanz. */
function source({ kanzlei, fivenet }) {
  return `// ==UserScript==
// @name         Pake & Scha – FiveNet-Dokument übernehmen
// @namespace    ${kanzlei}
// @version      1.2
// @description  Knopf auf FiveNet-Dokumenten: übergibt Titel, Text und Bilder an das offene Kanzlei-Dashboard (zur Bestätigung).
// @match        ${fivenet}/*
// @grant        none
// @run-at       document-idle
// @updateURL    ${kanzlei}/fivenet-import.user.js
// @downloadURL  ${kanzlei}/fivenet-import.user.js
// ==/UserScript==
(function () {
  'use strict';
${core(kanzlei)
  .split('\n')
  .map((l) => (l ? `  ${l}` : l))
  .join('\n')}
  var btn = null;
  function ensureButton() {
    var on = !!docId();
    if (on && !btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '→ An Pake & Scha senden';
      btn.title = 'Dokument (oder markierten Text) an das Kanzlei-Dashboard übergeben';
      btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 16px;border:0;border-radius:999px;font:600 13px system-ui,sans-serif;color:#02050e;background:linear-gradient(135deg,#e6c25a,#b8912a);box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer';
      btn.addEventListener('click', send);
      document.body.appendChild(btn);
    } else if (!on && btn) {
      btn.remove();
      btn = null;
    }
  }
  // FiveNet ist eine Single-Page-App: die Adresse ändert sich ohne Neuladen – deshalb regelmäßig nachsehen
  setInterval(ensureButton, 1000);
  ensureButton();
})();
`;
}

/**
 * Dasselbe als Lesezeichen („javascript:“-Adresse): ein Klick in der Lesezeichenleiste auf einer FiveNet-Seite sendet das
 * Dokument – ohne Erweiterung, in jedem Browser (auch wenn Tampermonkey fehlt oder Benutzerskripte gesperrt sind).
 */
function bookmarklet({ kanzlei }) {
  const code = `(function(){'use strict';${core(kanzlei).replace(/\n\s*/g, ' ')} send();})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

module.exports = { source, bookmarklet };
