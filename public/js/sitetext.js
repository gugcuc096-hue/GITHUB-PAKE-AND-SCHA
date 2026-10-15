/*
 * Website-Texte direkt auf der Seite ändern (nur Board of Partners).
 * Aufruf: Startseite bzw. Karriereseite mit ?bearbeiten (Link in Einstellungen → Website).
 * Text anklicken → ändern → Feld verlassen oder Enter = gespeichert. Leeren = Original wiederherstellen.
 */
(function () {
  if (!new URLSearchParams(location.search).has('bearbeiten')) return;
  const page = /karriere/.test(location.pathname) ? 'karriere' : 'index';

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
    return data;
  }

  function start() {
    const style = document.createElement('style');
    style.textContent = `
      .st-on [data-t] { cursor: text; border-radius: 4px; }
      .st-on [data-t]:hover { outline: 1px dashed rgba(212,175,55,.7); outline-offset: 3px; }
      .st-on [data-t][contenteditable] { outline: 2px solid #d4af37; outline-offset: 3px; background: rgba(212,175,55,.08); }
      .st-on .faq-answer { max-height: none !important; }
      .st-on .reveal { opacity: 1 !important; transform: none !important; }
      #stBar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 9999; display: flex; align-items: center; gap: 12px;
        width: min(640px, calc(100% - 32px)); padding: 12px 16px; border-radius: 14px; background: #0b1530; border: 1px solid rgba(212,175,55,.45);
        box-shadow: 0 12px 40px rgba(0,0,0,.5); color: #e2e8f0; font: 14px/1.4 Inter, system-ui, sans-serif; }
      #stBar .st-msg { flex: 1; min-width: 0; }
      #stBar button { min-height: 40px; padding: 0 16px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
      #stBar .st-done { background: #d4af37; color: #0a1228; }
      #stBar .st-reset { border: 1px solid rgba(212,175,55,.45); color: #f1d98a; }
    `;
    document.head.appendChild(style);
    document.body.classList.add('st-on');
    const bar = document.createElement('div');
    bar.id = 'stBar';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="st-msg">Text anklicken und ändern – gespeichert wird beim Verlassen des Feldes.</span>' +
      '<button type="button" class="st-reset" hidden>Original</button><button type="button" class="st-done">Fertig</button>';
    document.body.appendChild(bar);
    const msg = bar.querySelector('.st-msg');
    const resetBtn = bar.querySelector('.st-reset');
    const say = (t) => (msg.textContent = t);
    let current = null;

    bar.querySelector('.st-done').addEventListener('click', () => {
      location.href = location.pathname + location.hash;
    });

    const textOf = (el) => (el.innerText || el.textContent).replace(/\s+/g, ' ').trim();

    async function save(el) {
      const text = textOf(el);
      if (text === el.dataset.stSaved) return;
      try {
        const r = await call('PUT', '/api/site/texts', { page, key: el.dataset.t, text });
        document.querySelectorAll(`[data-t="${el.dataset.t}"]`).forEach((x) => {
          x.textContent = r.text;
          x.dataset.stSaved = r.text;
        });
        say(r.changed ? 'Gespeichert.' : 'Original wiederhergestellt.');
      } catch (err) {
        say(err.message);
        el.textContent = el.dataset.stSaved;
      }
    }

    function stop(el) {
      el.removeAttribute('contenteditable');
      resetBtn.hidden = true;
      current = null;
      save(el);
    }

    document.addEventListener(
      'click',
      (e) => {
        if (e.target.closest('#stBar')) return;
        const el = e.target.closest('[data-t]');
        // Links und Knöpfe lösen im Bearbeitungsmodus nichts aus
        if (e.target.closest('a, button, [data-act]')) e.preventDefault();
        if (!el || el === current) return;
        e.stopPropagation();
        if (current) stop(current);
        current = el;
        el.dataset.stSaved = el.dataset.stSaved ?? textOf(el);
        try {
          el.contentEditable = 'plaintext-only';
        } catch {
          el.contentEditable = 'true';
        }
        el.focus();
        resetBtn.hidden = false;
        say('Ändern – Enter oder daneben klicken speichert.');
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (!current) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        current.blur();
      } else if (e.key === 'Escape') {
        current.textContent = current.dataset.stSaved;
        current.blur();
      }
    });
    document.addEventListener('focusout', (e) => {
      if (current && e.target === current && !(e.relatedTarget && e.relatedTarget === resetBtn)) stop(current);
    });
    resetBtn.addEventListener('mousedown', (e) => e.preventDefault());
    resetBtn.addEventListener('click', () => {
      if (!current) return;
      current.textContent = '';
      current.blur();
    });
  }

  call('GET', '/api/auth/session')
    .then((r) => {
      if (r.user && r.user.board) start();
    })
    .catch(() => {});
})();
