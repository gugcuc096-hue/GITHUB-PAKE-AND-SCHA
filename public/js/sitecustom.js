/*
 * Startseite direkt auf der Seite anpassen (Board of Partners, Startseite mit ?bearbeiten – lädt sitetext.js).
 *  - an jedem Abschnitt eine kleine Leiste: nach oben / nach unten / ausblenden / Einstellungen
 *  - Seitenleiste „Startseite anpassen“: Abschnitte, Anwälte (Kanzleileitung, eigene Auswahl, im Dienst zuerst, alle;
 *    wie viele), Rechtsgebiete (welche, Reihenfolge), Aktuelles (wie viele Meldungen), Startbereich (zweiter Knopf,
 *    Hinweis „Bereits Mandant?“)
 * Jede Änderung zeigt sich sofort auf der Seite; „Veröffentlichen“ speichert sie in der Konfiguration „Startseite“
 * (Entwurf → veröffentlichen, wie im Dashboard, mit Änderungsprotokoll) – danach sehen alle Besucher sie.
 */
(function () {
  'use strict';
  if (document.body.dataset.view !== 'start' || window.PS_SITECUSTOM) return;
  window.PS_SITECUSTOM = true;
  const PS = window.PS || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const SECTIONS = { fakten: 'Kennzahlen', gebiete: 'Rechtsgebiete', ansprechpartner: 'Anwälte', stimmen: 'Mandantenstimme', neuigkeiten: 'Aktuelles', ablauf: 'Ablauf eines Mandats', band: 'Abschluss „Mandat anfragen“' };
  const MODES = { leitung: 'Kanzleileitung (Board of Partners)', auswahl: 'Eigene Auswahl', dienst: 'Wer im Dienst ist zuerst', alle: 'Alle Anwälte' };
  const HERO = { notdienst: ['/notdienst', 'Notdienst bei Festnahme'], anwaelte: ['/anwaelte', 'Unsere Anwälte'], honorare: ['/honorare', 'Honorare & Tarifrechner'], kontakt: ['/kontakt', 'Kontakt'], keiner: ['', 'Kein zweiter Knopf'] };
  const ICON = {
    up: '<path d="M5 15l7-7 7 7"/>',
    down: '<path d="M19 9l-7 7-7-7"/>',
    eye: '<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.46 12C3.73 7.94 7.52 5 12 5c4.48 0 8.27 2.94 9.54 7-1.27 4.06-5.06 7-9.54 7-4.48 0-8.27-2.94-9.54-7z"/>',
    eyeOff: '<path d="M13.88 18.83A10 10 0 0112 19c-4.48 0-8.27-2.94-9.54-7a9.96 9.96 0 014.13-5.36M9.88 9.88a3 3 0 104.24 4.24M3 3l18 18M10.73 5.08A10.1 10.1 0 0112 5c4.48 0 8.27 2.94 9.54 7a10.05 10.05 0 01-1.56 3.03"/>',
    cog: '<path d="M10.33 4.32c.43-1.76 2.92-1.76 3.35 0a1.72 1.72 0 002.57 1.06c1.54-.94 3.3.82 2.37 2.37a1.72 1.72 0 001.06 2.57c1.76.43 1.76 2.92 0 3.35a1.72 1.72 0 00-1.06 2.57c.94 1.54-.82 3.3-2.37 2.37a1.72 1.72 0 00-2.57 1.06c-.43 1.76-2.92 1.76-3.35 0a1.72 1.72 0 00-2.57-1.06c-1.54.94-3.3-.82-2.37-2.37a1.72 1.72 0 00-1.06-2.57c-1.76-.43-1.76-2.92 0-3.35a1.72 1.72 0 001.06-2.57c-.94-1.54.82-3.3 2.37-2.37.99.6 2.28.07 2.57-1.06z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>',
    close: '<path d="M6 18L18 6M6 6l12 12"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  async function call(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Das hat nicht geklappt.');
    return data;
  }

  let base = null; // ganze Konfiguration „Startseite“ (Entwurf oder veröffentlicht) – wir ändern nur .start
  let state = null; // .start
  let saved = ''; // zum Erkennen ungespeicherter Änderungen
  let areas = [];
  const main = document.querySelector('main');
  const sectionEl = (id) => main.querySelector(`[data-start="${id}"]`);
  const dirty = () => JSON.stringify(state) !== saved;

  /* ---------------------------------------------------------------- Vorschau auf der Seite */
  function applyPreview() {
    // Abschnitte: Reihenfolge und ausgeblendet (die ausgeblendeten bleiben im Bearbeitungsmodus blass sichtbar)
    const els = state.order.map(sectionEl).filter(Boolean);
    if (els.length) {
      const anchor = els[0].parentNode;
      let after = main.querySelector('.kz-hero');
      for (const el of els) {
        if (after && after.nextElementSibling !== el) after.after(el);
        after = el;
        el.toggleAttribute('data-sc-hidden', state.hidden.includes(el.dataset.start));
      }
      void anchor;
    }
    // Rechtsgebiete
    const list = main.querySelector('#gebiete .kz-tiles');
    if (list) {
      const items = [...list.querySelectorAll('[data-area]')];
      const pick = state.areas.length ? state.areas : items.map((li) => li.dataset.area);
      for (const key of pick) {
        const li = items.find((x) => x.dataset.area === key);
        if (li) list.appendChild(li);
      }
      for (const li of items) li.hidden = state.areas.length > 0 && !state.areas.includes(li.dataset.area);
    }
    // Anwälte und Meldungen
    const lead = document.getElementById('leadGrid');
    if (lead) {
      lead.dataset.mode = state.lawyerMode;
      lead.dataset.count = String(state.lawyerCount);
      lead.dataset.ids = state.lawyers.join(',');
      lead.closest('section')?.classList.remove('hidden');
      PS.site?.renderTeam();
    }
    const teaser = document.getElementById('newsTeaser');
    if (teaser) {
      teaser.dataset.count = String(state.newsCount);
      PS.site?.renderNews();
    }
    // Startbereich
    const second = main.querySelector('[data-hero-second]');
    if (second) {
      const [href, label] = HERO[state.heroSecond] || HERO.notdienst;
      second.hidden = state.heroSecond === 'keiner';
      if (href) {
        second.setAttribute('href', href);
        if (second.dataset.heroSecond !== state.heroSecond) second.textContent = label;
        second.dataset.heroSecond = state.heroSecond;
      }
    }
    const note = main.querySelector('.kz-hero-note');
    if (note) note.hidden = !state.heroNote;
    updateBar();
  }

  /* ---------------------------------------------------------------- Leisten an den Abschnitten */
  function chips() {
    for (const id of Object.keys(SECTIONS)) {
      const el = sectionEl(id);
      if (!el || el.querySelector(':scope > .sc-chip')) continue;
      const chip = document.createElement('div');
      chip.className = 'sc-ui sc-chip';
      chip.innerHTML = `<span class="sc-chip-name">${esc(SECTIONS[id])}</span>
        <button type="button" data-sc="up" title="Nach oben">${svg('up')}</button>
        <button type="button" data-sc="down" title="Nach unten">${svg('down')}</button>
        <button type="button" data-sc="toggle" title="Ein-/ausblenden">${svg('eye')}</button>
        <button type="button" data-sc="open" title="Einstellungen">${svg('cog')}</button>`;
      chip.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const i = state.order.indexOf(id);
        if (b.dataset.sc === 'up' && i > 0) [state.order[i - 1], state.order[i]] = [state.order[i], state.order[i - 1]];
        if (b.dataset.sc === 'down' && i < state.order.length - 1) [state.order[i + 1], state.order[i]] = [state.order[i], state.order[i + 1]];
        if (b.dataset.sc === 'toggle') state.hidden = state.hidden.includes(id) ? state.hidden.filter((x) => x !== id) : [...state.hidden, id];
        if (b.dataset.sc === 'open') return openDrawer(id);
        applyPreview();
        renderDrawer();
        el.scrollIntoView({ block: 'nearest', behavior: PS.motion?.calm?.() ? 'auto' : 'smooth' });
      });
      el.prepend(chip);
    }
    const hero = main.querySelector('.kz-hero');
    if (hero && !hero.querySelector(':scope > .sc-chip')) {
      const chip = document.createElement('div');
      chip.className = 'sc-ui sc-chip';
      chip.innerHTML = `<span class="sc-chip-name">Startbereich</span><button type="button" title="Einstellungen">${svg('cog')}</button>`;
      chip.querySelector('button').addEventListener('click', () => openDrawer('hero'));
      hero.prepend(chip);
    }
    for (const id of Object.keys(SECTIONS)) {
      const btn = sectionEl(id)?.querySelector(':scope > .sc-chip [data-sc="toggle"]');
      if (btn) btn.innerHTML = svg(state.hidden.includes(id) ? 'eyeOff' : 'eye');
    }
  }

  /* ---------------------------------------------------------------- Seitenleiste */
  const drawer = document.createElement('aside');
  drawer.className = 'sc-ui sc-drawer';
  drawer.setAttribute('aria-label', 'Startseite anpassen');
  drawer.setAttribute('role', 'dialog');
  const row = (key, label, { on, i, n, group }) => `<li class="sc-row${on ? '' : ' is-off'}">
      <label><input type="checkbox" data-g="${group}" data-k="${esc(key)}" ${on ? 'checked' : ''}> <span>${esc(label)}</span></label>
      <span class="sc-move"><button type="button" data-g="${group}" data-move="-1" data-k="${esc(key)}" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${svg('up')}</button><button type="button" data-g="${group}" data-move="1" data-k="${esc(key)}" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">${svg('down')}</button></span></li>`;

  function renderDrawer() {
    chips();
    const team = PS.site?.team() || [];
    const order = state.order;
    const areaKeys = state.areas.length ? [...state.areas, ...areas.map((a) => a.key).filter((k) => !state.areas.includes(k))] : areas.map((a) => a.key);
    const pickIds = [...state.lawyers.filter((id) => team.some((m) => m.id === id)), ...team.map((m) => m.id).filter((id) => !state.lawyers.includes(id))];
    const scroll = drawer.querySelector('.sc-body')?.scrollTop || 0;
    drawer.innerHTML = `<div class="sc-head"><div><span class="sc-kicker">Board of Partners</span><h2>Startseite anpassen</h2></div><button type="button" class="sc-x" data-close aria-label="Schließen">${svg('close')}</button></div>
      <div class="sc-body">
        <section data-grp="sections"><h3>Abschnitte</h3><p>Reihenfolge unter dem Startbereich; Häkchen weg = ausgeblendet.</p>
          <ul class="sc-list">${order.map((id, i) => row(id, SECTIONS[id], { on: !state.hidden.includes(id), i, n: order.length, group: 'sections' })).join('')}</ul></section>
        <section data-grp="ansprechpartner"><h3>Anwälte</h3>
          <div class="sc-seg">${Object.entries(MODES).map(([k, l]) => `<label><input type="radio" name="scMode" value="${k}" ${state.lawyerMode === k ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
          <label class="sc-field">Wie viele Karten <span class="sc-num"><button type="button" data-count="lawyerCount" data-d="-1" aria-label="Weniger">−</button><b>${state.lawyerCount}</b><button type="button" data-count="lawyerCount" data-d="1" aria-label="Mehr">+</button></span></label>
          ${state.lawyerMode === 'auswahl'
            ? team.length
              ? `<p>Wer erscheint und in welcher Reihenfolge:</p><ul class="sc-list">${pickIds.map((id, i) => {
                  const m = team.find((x) => x.id === id);
                  return row(String(id), `${m.name} · ${m.roleTitle}`, { on: state.lawyers.includes(id), i, n: pickIds.length, group: 'lawyers' });
                }).join('')}</ul>`
              : '<p class="sc-empty">Noch keine Anwälte auf der Website.</p>'
            : ''}
        </section>
        <section data-grp="gebiete"><h3>Rechtsgebiete</h3><p>Ohne Häkchen erscheinen alle eingeschalteten Rechtsgebiete.</p>
          <ul class="sc-list">${areaKeys.map((k, i) => row(k, (areas.find((a) => a.key === k) || {}).name || k, { on: state.areas.includes(k), i, n: areaKeys.length, group: 'areas' })).join('')}</ul></section>
        <section data-grp="neuigkeiten"><h3>Aktuelles</h3>
          <label class="sc-field">Meldungen auf der Startseite <span class="sc-num"><button type="button" data-count="newsCount" data-d="-1" aria-label="Weniger">−</button><b>${state.newsCount}</b><button type="button" data-count="newsCount" data-d="1" aria-label="Mehr">+</button></span></label>
          <p>Meldungen schreiben Sie im Dashboard unter Einstellungen → Aktuelles.</p></section>
        <section data-grp="hero"><h3>Startbereich</h3>
          <label class="sc-field">Zweiter Knopf <select data-hero>${Object.entries(HERO).map(([k, v]) => `<option value="${k}" ${state.heroSecond === k ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select></label>
          <label class="sc-check"><input type="checkbox" data-note ${state.heroNote ? 'checked' : ''}> Hinweis „Bereits Mandant? …“ zeigen</label>
          <p>Überschrift und Texte ändern Sie, indem Sie sie auf der Seite anklicken.</p></section>
      </div>
      <div class="sc-foot"><span class="sc-state"></span><button type="button" class="btn-ghost btn-md" data-reset>Zurücksetzen</button><button type="button" class="btn-gold btn-md" data-publish>Veröffentlichen</button></div>`;
    drawer.querySelector('.sc-body').scrollTop = scroll;
    updateBar();
  }

  function move(list, key, d) {
    const i = list.indexOf(key);
    const j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const out = list.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  drawer.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) return closeDrawer();
    if (t.hasAttribute('data-reset')) {
      state = JSON.parse(saved);
      applyPreview();
      return renderDrawer();
    }
    if (t.hasAttribute('data-publish')) return publish(t);
    if (t.dataset.count) {
      const k = t.dataset.count;
      const max = k === 'newsCount' ? 6 : 9;
      state[k] = Math.min(max, Math.max(1, state[k] + Number(t.dataset.d)));
    } else if (t.dataset.move) {
      const d = Number(t.dataset.move);
      const g = t.dataset.g;
      if (g === 'sections') state.order = move(state.order, t.dataset.k, d);
      if (g === 'areas') {
        const all = state.areas.length ? [...state.areas, ...areas.map((a) => a.key).filter((k) => !state.areas.includes(k))] : areas.map((a) => a.key);
        const moved = move(all, t.dataset.k, d);
        const on = new Set(state.areas);
        state.areas = on.size ? moved.filter((k) => on.has(k)) : state.areas;
        if (!on.size) areas.sort((a, b) => moved.indexOf(a.key) - moved.indexOf(b.key));
      }
      if (g === 'lawyers') {
        const team = PS.site?.team() || [];
        const all = [...state.lawyers, ...team.map((m) => m.id).filter((id) => !state.lawyers.includes(id))].map(String);
        const moved = move(all, t.dataset.k, d).map(Number);
        state.lawyers = moved.filter((id) => state.lawyers.includes(id));
      }
    } else return;
    applyPreview();
    renderDrawer();
  });
  drawer.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'scMode') state.lawyerMode = t.value;
    else if (t.dataset.hero !== undefined) state.heroSecond = t.value;
    else if (t.dataset.note !== undefined) state.heroNote = t.checked;
    else if (t.dataset.g === 'sections') state.hidden = t.checked ? state.hidden.filter((x) => x !== t.dataset.k) : [...state.hidden, t.dataset.k];
    else if (t.dataset.g === 'areas') {
      const shown = [...drawer.querySelectorAll('input[data-g="areas"]')].map((x) => x.dataset.k);
      const on = new Set(state.areas);
      if (t.checked) on.add(t.dataset.k);
      else on.delete(t.dataset.k);
      state.areas = shown.filter((k) => on.has(k));
    } else if (t.dataset.g === 'lawyers') {
      const shown = [...drawer.querySelectorAll('input[data-g="lawyers"]')].map((x) => Number(x.dataset.k));
      const on = new Set(state.lawyers);
      if (t.checked) on.add(Number(t.dataset.k));
      else on.delete(Number(t.dataset.k));
      state.lawyers = shown.filter((id) => on.has(id)).slice(0, 12);
      if (state.lawyers.length > state.lawyerCount) state.lawyerCount = Math.min(9, state.lawyers.length);
    } else return;
    applyPreview();
    renderDrawer();
  });

  function openDrawer(group) {
    renderDrawer();
    document.body.classList.add('sc-open');
    drawer.classList.add('is-open');
    const sec = group && drawer.querySelector(`[data-grp="${group}"]`);
    if (sec) {
      sec.scrollIntoView({ block: 'start' });
      sec.classList.remove('is-flash');
      void sec.offsetWidth;
      sec.classList.add('is-flash');
    }
  }
  function closeDrawer() {
    drawer.classList.remove('is-open');
    document.body.classList.remove('sc-open');
  }

  async function publish(btn) {
    btn.disabled = true;
    const say = drawer.querySelector('.sc-state');
    try {
      const next = { ...base, start: state };
      await call('PUT', '/api/config/home/draft', next);
      await call('POST', '/api/config/home/publish');
      saved = JSON.stringify(state);
      base = next;
      say.textContent = 'Veröffentlicht – alle Besucher sehen die neue Startseite.';
      if (PS.toast) PS.toast('Startseite veröffentlicht.');
      updateBar();
    } catch (err) {
      say.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function updateBar() {
    const d = dirty();
    const say = drawer.querySelector('.sc-state');
    if (say && d) say.textContent = 'Noch nicht veröffentlicht.';
    else if (say && !say.textContent.startsWith('Veröffentlicht')) say.textContent = '';
    const open = document.getElementById('scOpen');
    if (open) open.classList.toggle('is-dirty', d);
  }

  /* ---------------------------------------------------------------- Start */
  const css = document.createElement('style');
  css.textContent = `
    .site-home [data-sc-hidden] { opacity: .35; filter: grayscale(.6); }
    .site-home [data-sc-hidden]::before { content: 'Ausgeblendet – nur im Bearbeitungsmodus sichtbar'; position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3; padding: 4px 10px; border-radius: 999px; font: 600 11px/1.4 Inter, system-ui, sans-serif; color: #fde68a; background: rgba(245, 158, 11, .15); }
    .site-home main [data-start].hidden { display: block !important; opacity: .35; }
    .sc-chip { position: absolute; top: 12px; right: 12px; z-index: 5; display: inline-flex; align-items: center; gap: 2px; padding: 4px 4px 4px 12px; border-radius: 999px; background: rgba(8, 14, 32, .9); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid rgba(var(--accent-rgb), .45); box-shadow: var(--sh-3); font: 600 12px/1 Inter, system-ui, sans-serif; color: var(--gold-light); opacity: .55; transition: opacity var(--dur-2) ease; }
    [data-start]:hover > .sc-chip, .kz-hero:hover > .sc-chip, .sc-chip:focus-within { opacity: 1; }
    .sc-chip-name { margin-right: 6px; white-space: nowrap; }
    .sc-chip button, .sc-move button, .sc-x { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; color: var(--text-muted); background: none; border: 0; cursor: pointer; }
    .sc-chip button:hover, .sc-move button:hover:not(:disabled), .sc-x:hover { color: #fff; background: rgba(255,255,255,.08); }
    .sc-chip svg, .sc-move svg, .sc-x svg { width: 16px; height: 16px; }
    .sc-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 9998; width: min(420px, 100%); display: flex; flex-direction: column; background: rgba(6, 11, 26, .92); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border-left: 1px solid var(--glass-border); box-shadow: var(--sh-4); color: var(--text-muted); font: 14px/1.5 Inter, system-ui, sans-serif; transform: translateX(105%); visibility: hidden; transition: transform .42s var(--ease-out), visibility 0s linear .42s; }
    .sc-drawer.is-open { transform: none; visibility: visible; transition: transform .42s var(--ease-out), visibility 0s; }
    .sc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 20px 14px; border-bottom: 1px solid var(--line); }
    .sc-head h2 { margin: 2px 0 0; font: 600 1.55rem/1.15 var(--font-display); color: var(--text-main); }
    .sc-kicker { font: 600 11px/1 Inter, system-ui, sans-serif; letter-spacing: .16em; text-transform: uppercase; color: var(--text-dim); }
    .sc-body { flex: 1; overflow-y: auto; padding: 8px 20px 20px; }
    .sc-body section { padding: 16px 0; border-bottom: 1px solid var(--line); border-radius: 12px; }
    .sc-body section.is-flash { animation: sc-flash 1.2s ease; }
    @keyframes sc-flash { 0%, 40% { background: rgba(var(--accent-rgb), .1); } 100% { background: transparent; } }
    .sc-body h3 { margin: 0 0 6px; font: 600 1.15rem/1.2 var(--font-display); color: var(--text-main); }
    .sc-body p { margin: 6px 0; font-size: 12.5px; color: var(--text-dim); }
    .sc-list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
    .sc-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 4px 10px; border-radius: 10px; background: rgba(255,255,255,.03); border: 1px solid var(--line); }
    .sc-row.is-off { opacity: .6; }
    .sc-row label, .sc-seg label, .sc-check { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; color: var(--text-main); }
    .sc-row label span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sc-move { display: inline-flex; flex: none; }
    .sc-move button:disabled { opacity: .25; cursor: default; }
    .sc-seg { display: grid; gap: 6px; margin: 8px 0 12px; }
    .sc-seg label { padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.03); }
    .sc-seg label:has(input:checked) { border-color: rgba(var(--accent-rgb), .5); background: var(--gold-soft); color: var(--gold-light); }
    .sc-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; color: var(--text-main); }
    .sc-field select { min-height: 38px; max-width: 60%; padding: 0 10px; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(15,23,42,.8); color: #fff; }
    .sc-num { display: inline-flex; align-items: center; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid var(--glass-border); }
    .sc-num button { width: 30px; height: 30px; border-radius: 999px; border: 0; background: rgba(255,255,255,.05); color: #fff; cursor: pointer; font-size: 16px; }
    .sc-num b { min-width: 22px; text-align: center; color: var(--gold-light); }
    .sc-check { margin: 10px 0; }
    .sc-check input, .sc-row input, .sc-seg input { accent-color: var(--gold-500); }
    .sc-foot { display: flex; align-items: center; gap: 8px; padding: 14px 20px calc(14px + var(--safe-bottom)); border-top: 1px solid var(--line); }
    .sc-state { flex: 1; min-width: 0; font-size: 12px; color: var(--text-dim); }
    .sc-empty { font-style: italic; }
    #scOpen.is-dirty::after { content: ''; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%; background: var(--amber); }
    body.sc-open #stBar { right: calc(min(420px, 100%) + 16px); left: auto; transform: none; width: min(560px, calc(100% - min(420px, 100%) - 32px)); }
    @media (max-width: 899px) { body.sc-open #stBar { display: none; } }
  `;
  document.head.appendChild(css);

  Promise.all([call('GET', '/api/config'), call('GET', '/api/public/areas').catch(() => ({ areas: [] }))])
    .then(([cfg, ar]) => {
      const home = cfg.config && cfg.config.home;
      if (!home) return; // ohne Recht „Website bearbeiten“ keine Anpassung
      base = home.draft || home.published;
      const defaults = home.defaults.start;
      state = { ...defaults, ...(base.start || {}) };
      // später hinzugekommene Abschnitte hinter ihren Vorgänger aus der Standard-Reihenfolge (wie der Server: startOrder)
      const all = Object.keys(SECTIONS);
      state.order = state.order.filter((id) => SECTIONS[id]);
      all.forEach((id, i) => {
        if (state.order.includes(id)) return;
        const prev = all.slice(0, i).reverse().find((p) => state.order.includes(p));
        state.order.splice(prev ? state.order.indexOf(prev) + 1 : 0, 0, id);
      });
      saved = JSON.stringify(state);
      areas = (ar.areas || []).filter((a) => a.key !== 'sonstiges').map((a) => ({ key: a.key, name: a.name }));
      document.body.appendChild(drawer);
      // Knopf in der Leiste unten (sitetext.js)
      const bar = document.getElementById('stBar');
      if (bar && !document.getElementById('scOpen')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'scOpen';
        b.className = 'st-reset sc-ui';
        b.textContent = 'Startseite anpassen';
        b.addEventListener('click', () => (drawer.classList.contains('is-open') ? closeDrawer() : openDrawer()));
        bar.insertBefore(b, bar.querySelector('.st-done'));
      }
      chips();
      applyPreview();
      document.addEventListener('keydown', (e) => e.key === 'Escape' && drawer.classList.contains('is-open') && closeDrawer());
      window.addEventListener('beforeunload', (e) => {
        if (dirty()) e.preventDefault();
      });
    })
    .catch(() => {});
})();
