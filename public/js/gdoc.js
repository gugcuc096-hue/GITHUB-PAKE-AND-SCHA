/*
 * Knopf „Google Doc“ in den Druckansichten (Rechnung, Vertrag/Schriftsatz, Aktenauszug).
 * Kanzlei: Google Doc anlegen bzw. sofort aktualisieren · alle mit Zugriff: Doc öffnen und Link kopieren.
 * Das Doc liegt im Google Drive der Kanzlei, ist „Jeder mit dem Link: ansehen“ und wird bei Änderungen
 * (Unterschrift, Bezahlt …) automatisch neu geschrieben – der Link bleibt gleich.
 *
 * Aufruf, sobald die Seite ihre Daten hat: window.PS.googleDoc.mount({ kind, id, getOptions })
 */
(() => {
  'use strict';
  const { api, copy, toast, fmtDate } = window.PS;

  // Eigene Stile (die Druckansichten laden app.css nicht); erscheinen nicht im Druck
  const style = document.createElement('style');
  style.textContent = `
    .gdoc { display: inline-flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .gdoc .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .gdoc .gdoc-g { display: inline-block; width: 0.95em; height: 1.15em; border-radius: 2px; background: #4285f4; position: relative; flex-shrink: 0; }
    .gdoc .gdoc-g::after { content: ''; position: absolute; left: 22%; right: 22%; top: 38%; height: 34%; border-top: 2px solid #fff; border-bottom: 2px solid #fff; }
    .gdoc .gdoc-warn { color: #fcd34d; font-size: 0.78rem; max-width: 22rem; }
    .ps-toast-root { position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 90; display: flex; flex-direction: column; gap: 0.6rem; max-width: calc(100vw - 2rem); font-family: 'Inter', system-ui, sans-serif; }
    .ps-toast { background: rgba(6, 11, 25, 0.97); color: #f8fafc; border: 1px solid rgba(212, 175, 55, 0.35); border-left: 3px solid #d4af37; border-radius: 12px; padding: 0.8rem 1.1rem; max-width: 360px; font-size: 0.875rem; box-shadow: 0 15px 40px rgba(0, 0, 0, 0.6); }
    .ps-toast.error { border-left-color: #ef4444; }
    /* Bestätigungsdialog (wie in vertrag.html bzw. app.css) – Rechnung und Aktenauszug haben ihn sonst nicht */
    :root { --gold-500: #d4af37; --gold-hairline: rgba(212, 175, 55, 0.35); --text-main: #f8fafc; --text-muted: #cbd5e1; }
    .ps-dialog-root { position: fixed; inset: 0; z-index: 85; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(2, 5, 14, 0.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; transition: opacity 0.16s ease; }
    .ps-dialog-root.open { opacity: 1; }
    .ps-dialog { width: 100%; max-width: 440px; text-align: center; padding: 1.75rem 1.5rem 1.4rem; border-radius: 22px; border: 1px solid var(--gold-hairline); border-top: 2px solid var(--gold-500); background: linear-gradient(180deg, rgba(14, 22, 46, 0.98), rgba(6, 11, 25, 0.98)); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03) inset; transform: translateY(8px) scale(0.98); transition: transform 0.16s ease; }
    .ps-dialog-root.open .ps-dialog { transform: none; }
    .ps-dialog.is-danger { border-top-color: #ef4444; }
    .ps-dialog-mark { width: 56px; height: 56px; margin: 0 auto 0.9rem; border-radius: 16px; overflow: hidden; border: 1px solid var(--gold-hairline); box-shadow: 0 8px 24px rgba(212, 175, 55, 0.15); }
    .ps-dialog-mark img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ps-dialog-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.6rem; font-weight: 600; line-height: 1.2; color: var(--text-main); }
    .ps-dialog-text { margin-top: 0.6rem; font-size: 0.92rem; line-height: 1.55; color: var(--text-muted); white-space: pre-line; word-break: break-word; }
    .ps-dialog-actions { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap-reverse; margin-top: 1.4rem; }
    .ps-dialog-actions > * { min-width: 8.5rem; }
    @media (max-width: 480px) { .ps-dialog-actions > * { flex: 1 1 100%; } }
    body.ps-dialog-open { overflow: hidden; }
    .ps-dialog button { border-radius: 999px; padding: 0.65rem 1.2rem; font: 600 0.88rem 'Inter', sans-serif; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.05); color: #f8fafc; }
    .ps-dialog .btn-gold { background: linear-gradient(135deg, #d4af37, #b8962e); color: #02050e; border: 0; }
    .ps-dialog .btn-danger { background: #b91c1c; border: 0; color: #fff; }
    @media print { .gdoc, .ps-toast-root { display: none !important; } }`;
  document.head.appendChild(style);

  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const icon = () => el('span', { class: 'gdoc-g', 'aria-hidden': 'true' });

  function mount({ kind, id, getOptions }) {
    const actions = document.querySelector('.toolbar .actions');
    const printBtn = document.getElementById('printBtn');
    if (!actions || !id) return;
    let box = actions.querySelector('.gdoc');
    if (!box) {
      box = el('span', { class: 'gdoc' });
      actions.insertBefore(box, printBtn && printBtn.parentNode === actions ? printBtn : null);
    }
    let info = null;
    let busy = false;

    function draw() {
      box.replaceChildren();
      if (!info) return;
      const { doc, canCreate, available, configured } = info;
      if (doc) {
        const open = el('a', { class: 'btn', href: doc.url, target: '_blank', rel: 'noopener', title: `Google Doc öffnen – jeder mit dem Link kann es ansehen${doc.syncedAt ? ` · Stand ${fmtDate(doc.syncedAt)}` : ''}` });
        open.append(icon(), document.createTextNode(' Google Doc öffnen'));
        const copyBtn = el('button', { class: 'btn', type: 'button', title: 'Link zum Teilen kopieren' }, 'Link kopieren');
        copyBtn.addEventListener('click', async () => toast((await copy(doc.url)) ? 'Link kopiert – jeder mit dem Link kann das Google Doc ansehen.' : doc.url));
        box.append(open, copyBtn);
        if (canCreate) {
          const refresh = el('button', { class: 'btn', type: 'button', title: kind === 'extract' ? 'Google Doc mit der aktuellen Auswahl der Abschnitte neu schreiben' : 'Google Doc jetzt neu schreiben (passiert bei Änderungen sonst automatisch)' }, busy ? 'Wird aktualisiert …' : 'Aktualisieren');
          refresh.disabled = busy || !available;
          refresh.addEventListener('click', () => publish(false));
          const del = el('button', { class: 'btn', type: 'button', title: 'Google Doc löschen – der Link funktioniert danach nicht mehr' }, 'Löschen');
          del.disabled = busy || !available;
          del.addEventListener('click', unpublish);
          box.append(refresh, del);
        }
        if (doc.error && canCreate) box.append(el('span', { class: 'gdoc-warn', title: doc.error }, '⚠ Letzte Aktualisierung fehlgeschlagen'));
        return;
      }
      if (!canCreate) return; // Mandanten: nur vorhandene Docs
      const create = el('button', { class: 'btn', type: 'button' });
      create.append(icon(), document.createTextNode(busy ? ' Wird erstellt …' : ' Als Google Doc'));
      if (!available) {
        create.disabled = true;
        create.title = configured
          ? 'Das Google-Konto der Kanzlei ist nicht verbunden – Board of Partners: Dashboard → Einstellungen → Google Docs.'
          : 'Google Docs ist noch nicht eingerichtet – siehe README („Google Docs“).';
      } else {
        create.title = 'Als Google Doc im Drive der Kanzlei anlegen – jeder mit dem Link kann es ansehen, Änderungen erscheinen automatisch.';
        create.disabled = busy;
        create.addEventListener('click', () => publish(true));
      }
      box.append(create);
    }

    async function publish(isNew) {
      if (busy) return;
      busy = true;
      draw();
      // Neues Fenster sofort öffnen (sonst blockt der Browser es nach der Wartezeit) und danach zum Doc leiten
      const win = isNew ? window.open('', '_blank') : null;
      if (win) {
        try {
          win.document.title = 'Google Doc wird erstellt …';
          win.document.body.style.cssText = 'font: 15px system-ui, sans-serif; background: #02050e; color: #e2e8f0; display: grid; place-items: center; height: 100vh; margin: 0;';
          win.document.body.textContent = 'Google Doc wird erstellt …';
        } catch {
          /* egal */
        }
      }
      try {
        const body = kind === 'extract' && getOptions ? { options: getOptions() } : {};
        const r = await api.post(`/api/google/docs/${kind}/${id}`, body);
        info.doc = r.doc;
        if (win) win.location.href = r.doc.url;
        // Kein automatisches Kopieren: Das neue Fenster hat den Fokus, der Browser würde es ohnehin verweigern.
        toast(isNew ? 'Google Doc erstellt – jeder mit dem Link kann es ansehen. Zum Teilen „Link kopieren“.' : 'Google Doc aktualisiert.');
      } catch (err) {
        if (win) win.close();
        toast(err.message || 'Google Doc konnte nicht erstellt werden.', 'error');
      } finally {
        busy = false;
        draw();
      }
    }

    async function unpublish() {
      const ok = await window.PS.confirm('Das Google Doc wandert in den Papierkorb des Kanzlei-Drive. Wer den Link hat, kann es danach nicht mehr öffnen. Die Druckansicht bleibt unverändert.', {
        title: 'Google Doc löschen?',
        confirmText: 'Löschen',
        danger: true,
      });
      if (!ok) return;
      busy = true;
      draw();
      try {
        await api.del(`/api/google/docs/${kind}/${id}`);
        info.doc = null;
        toast('Google Doc gelöscht – der Link ist nicht mehr gültig.');
      } catch (err) {
        toast(err.message || 'Google Doc konnte nicht gelöscht werden.', 'error');
      } finally {
        busy = false;
        draw();
      }
    }

    api
      .get(`/api/google/docs/${kind}/${id}`)
      .then((r) => {
        info = r;
        draw();
      })
      .catch(() => {
        /* ohne Zugriff bzw. ohne Google: kein Knopf */
      });
  }

  window.PS.googleDoc = { mount };
})();
