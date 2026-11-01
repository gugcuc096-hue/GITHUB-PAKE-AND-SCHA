/*
 * Aussehen der Dokumente (Einstellungen → Dokumente): Logo links/mittig/rechts, Zeile unter dem Namen, eigene Fußzeile,
 * Unterschrift in Schreibschrift, Wasserzeichen (z. B. „ENTWURF“). Gilt für Rechnung, Aktenauszug und Verträge.
 * Nutzung: PS.docLook.apply(root, firm.doc, 'invoice' | 'extract' | 'contract', { signer }).
 */
(() => {
  'use strict';
  const PS = window.PS || (window.PS = {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function apply(root, doc, kind, { signer = '' } = {}) {
    if (!root || !doc) return;
    root.classList.remove('doc-logo-links', 'doc-logo-mitte', 'doc-logo-rechts');
    root.classList.add(`doc-logo-${doc.logoPos || 'links'}`);
    const tag = root.querySelector('.head .tag');
    if (tag) {
      tag.textContent = doc.tagline || '';
      tag.hidden = !doc.tagline;
    }
    root.querySelector('.doc-footline')?.remove();
    if (doc.footer) {
      const foot = root.querySelector('.foot');
      const line = document.createElement('div');
      line.className = 'doc-footline';
      line.textContent = doc.footer;
      if (foot) foot.before(line);
      else root.appendChild(line);
    }
    root.querySelector('.doc-watermark')?.remove();
    if (doc.watermark && (doc.watermarkOn || []).includes(kind)) {
      const wm = document.createElement('div');
      wm.className = 'doc-watermark';
      wm.setAttribute('aria-hidden', 'true');
      wm.textContent = doc.watermark;
      root.prepend(wm);
    }
    // Unterschrift unter „Mit freundlichen Grüßen“ (Rechnung) in Schreibschrift bzw. klar
    const issuer = root.querySelector('.issuer .name');
    root.querySelector('.doc-sign')?.remove();
    if (issuer && doc.signature && signer) {
      const sig = document.createElement('div');
      sig.className = `doc-sign doc-sign-${doc.signatureStyle || 'schrift'}`;
      sig.innerHTML = esc(signer);
      issuer.before(sig);
    }
  }
  PS.docLook = { apply };
})();
