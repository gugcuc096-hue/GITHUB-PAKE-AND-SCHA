'use strict';
/*
 * Ein-Klick-Übernahme aus FiveNet: Benutzerskript für Tampermonkey & Co., das im eigenen Browser läuft – dort, wo die Person
 * ohnehin in FiveNet angemeldet ist. Es liest nur, was auf dem Bildschirm steht (wie Markieren und Kopieren), und übergibt es
 * per postMessage an das offene Kanzlei-Dashboard. Kein Passwort, keine Sitzungs-Cookies, kein Abruf durch den Server.
 * Das Dashboard prüft die Herkunft der Nachricht und zeigt alles zur Bestätigung an (public/js/dashboard/04-…).
 */

/** Quelltext des Benutzerskripts für diese Kanzlei-Adresse und FiveNet-Instanz. */
function source({ kanzlei, fivenet }) {
  return `// ==UserScript==
// @name         Pake & Scha – FiveNet-Dokument übernehmen
// @namespace    ${kanzlei}
// @version      1.0
// @description  Knopf auf FiveNet-Dokumenten: übergibt Titel, Text und Bilder an das offene Kanzlei-Dashboard (zur Bestätigung).
// @match        ${fivenet}/*
// @grant        none
// @run-at       document-idle
// @updateURL    ${kanzlei}/fivenet-import.user.js
// @downloadURL  ${kanzlei}/fivenet-import.user.js
// ==/UserScript==
(function () {
  'use strict';
  var KANZLEI = ${JSON.stringify(kanzlei)};
  var MAX_HTML = 500000;
  var btn = null;

  function docId() {
    var m = location.pathname.match(/\\/documents\\/(\\d+)/);
    return m ? m[1] : '';
  }

  // Der Bereich mit dem Dokumenttext: der größte Textbereich unter den üblichen Kandidaten.
  function contentElement() {
    var best = null;
    var size = 0;
    document.querySelectorAll('.ProseMirror, .tiptap, [contenteditable], .prose, article, main').forEach(function (el) {
      var n = (el.innerText || '').length;
      if (n > size) { best = el; size = n; }
    });
    return best || document.body;
  }

  function collect() {
    var sel = window.getSelection();
    var html = '';
    var text = '';
    if (sel && !sel.isCollapsed && String(sel).trim().length > 20) {
      // Markierter Text hat Vorrang (falls die automatische Erkennung den falschen Bereich trifft)
      var box = document.createElement('div');
      for (var i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
      html = box.innerHTML;
      text = String(sel);
    } else {
      var el = contentElement();
      html = el.innerHTML;
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

  function send() {
    var payload = collect();
    if (!payload.documentId) return;
    var win = window.open(KANZLEI + '/dashboard?import=fivenet', 'ps-kanzlei');
    if (!win) { alert('Das Kanzlei-Fenster wurde vom Browser blockiert – bitte Pop-ups für diese Seite erlauben.'); return; }
    var acked = false;
    var started = Date.now();
    window.addEventListener('message', function (e) {
      if (e.origin === KANZLEI && e.data && e.data.type === 'ps-ack') acked = true;
    });
    // Das Dashboard braucht einen Moment (ggf. Anmeldung) – bis zur Bestätigung alle 0,7 s erneut anbieten
    var timer = setInterval(function () {
      if (acked || win.closed || Date.now() - started > 180000) { clearInterval(timer); if (acked) flash('Übergeben – weiter im Kanzlei-Fenster.'); return; }
      try { win.postMessage(payload, KANZLEI); } catch (err) { /* Fenster lädt noch */ }
    }, 700);
  }

  function flash(text) {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { btn.textContent = old; }, 3500);
  }

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

module.exports = { source };
