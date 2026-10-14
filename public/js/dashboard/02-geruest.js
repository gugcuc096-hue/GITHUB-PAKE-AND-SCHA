/*
 * Kanzlei-Dashboard – Teil 2 von 12: Grundgerüst: Navigation, Dialog, Routing.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Grundgerüst: Navigation, Dialog, Routing
   ================================================================ */
/* Menügruppen: Kanzlei, Board-Eingang und Verwaltung lassen sich auf- und zuklappen (im Browser gemerkt);
 * Verwaltung ist anfangs zu. Liegt die geöffnete Seite in einer zugeklappten Gruppe, ist sie trotzdem sichtbar. */
const NAV_FOLDABLE = { Kanzlei: false, 'Board-Eingang': false, Verwaltung: true }; // Gruppe → anfangs zugeklappt?
function navClosedPrefs() {
  try {
    return JSON.parse(localStorage.getItem('ps.navClosed') || '{}') || {};
  } catch {
    return {};
  }
}
function toggleNavGroup(group) {
  const prefs = navClosedPrefs();
  const closed = group in prefs ? prefs[group] : NAV_FOLDABLE[group];
  prefs[group] = !closed;
  try {
    localStorage.setItem('ps.navClosed', JSON.stringify(prefs));
  } catch {
    /* nur Komfort – ohne Speicher gilt die Auswahl bis zum Neuladen */
  }
  st.navClosed = prefs;
  renderNav();
}
/** Board: „Anliegen“ führt in den Eingang; eigene Anliegen sind dort ein Reiter. */
const concernsMerged = () => isBoard();
function navCount(key) {
  if (key === 'concerns-board') return (st.concernOpen || 0) + (st.concernUnseen || 0);
  return { cases: st.chatUnread, mail: st.unread, applications: st.newApplications, tasks: st.dueTasks, concerns: st.concernUnseen, personnel: st.personnelNew, 'name-requests': st.nameOpen, vip: st.vipReqOpen, reviews: st.reviewOpen, invoices: st.paymentReports }[key] || 0;
}
function navActive(key) {
  if (key === 'invoices') return st.view === 'invoices' || st.view === 'invoice-new';
  if (key === 'concerns-board' && concernsMerged()) return st.view === 'concerns-board' || st.view === 'concerns';
  if (key === 'stats') return st.view === 'stats' || st.view === 'work'; // Aktenbearbeitung = Reiter der Statistik
  return st.view === key;
}
function renderNav() {
  const prefs = st.navClosed || (st.navClosed = navClosedPrefs());
  const groups = []; // [{ name, items: [key] }]
  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.hidden || !allowed(key)) continue;
    if (key === 'concerns' && concernsMerged()) continue; // steckt im Board-Punkt „Anliegen“
    const name = v.section && (!v.staffSection || isStaff()) ? v.section : groups.length ? groups[groups.length - 1].name : null;
    if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, items: [] });
    groups[groups.length - 1].items.push(key);
  }
  const item = (key) => {
    const v = VIEWS[key];
    const count = navCount(key);
    const active = navActive(key);
    const label = isBoard() && v.navLabel ? v.navLabel : viewLabel(key);
    return `<a href="#${key}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${esc(label)}</span>${count ? `<span class="nav-count">${count > 99 ? '99+' : count}</span>` : ''}</a>`;
  };
  let html = '';
  groups.forEach((g, i) => {
    const items = g.items.map(item).join('');
    if (!g.name) {
      html += items;
      return;
    }
    if (!(g.name in NAV_FOLDABLE)) {
      html += `<div class="nav-section">${esc(g.name)}</div>${items}`;
      return;
    }
    const closed = (g.name in prefs ? prefs[g.name] : NAV_FOLDABLE[g.name]) && !g.items.some(navActive);
    const total = g.items.reduce((n, k) => n + navCount(k), 0);
    html += `<button type="button" class="nav-section nav-toggle" data-action="nav-group" data-group="${esc(g.name)}" aria-expanded="${!closed}" aria-controls="navGroup${i}">
        <span>${esc(g.name)}</span>${closed && total ? `<span class="nav-count">${total > 99 ? '99+' : total}</span>` : ''}${icon('chevronDown', 'ico-sm nav-chev')}</button>
      <div class="nav-group" id="navGroup${i}" ${closed ? 'hidden' : ''}>${items}</div>`;
  });
  $('#nav').innerHTML = html;

  // Handy-Leiste: Mitarbeiter haben Aufgaben statt Post (Post steht ohnehin oben als Briefsymbol)
  const bottom = isStaff() ? ['overview', 'cases', 'tasks', 'calendar'] : ['overview', 'cases', 'calendar', 'mail'];
  const dot = (n) => (n ? `<span class="dot-badge">${n > 99 ? '99+' : n}</span>` : '');
  $('#bottomNav').innerHTML =
    bottom
      .map(
        (k) =>
          `<a href="#${k}" class="bn-item ${st.view === k ? 'active' : ''}">${icon(VIEWS[k].icon)}<span>${esc(viewLabel(k, true))}</span>${dot({ mail: st.unread, cases: st.chatUnread, tasks: st.dueTasks }[k])}</a>`
      )
      .join('') + `<button type="button" class="bn-item" data-action="open-sidebar">${icon('more')}<span>Mehr</span></button>`;

  const mailBadge = $('#topMailBadge');
  mailBadge.textContent = st.unread > 99 ? '99+' : String(st.unread);
  mailBadge.classList.toggle('hidden', !st.unread);
  $('#pageTitle').textContent = viewLabel(st.view);
  // Tab und App-Symbol (installierte App) zeigen, wie viel Neues wartet – die Summe der Zähler im Menü
  const waiting = groups.reduce((n, g) => n + g.items.reduce((m, k) => m + navCount(k), 0), 0);
  document.title = `${waiting ? `(${waiting > 99 ? '99+' : waiting}) ` : ''}${viewLabel(st.view)} | Pake & Scha`;
  setAppBadge(waiting);
}
/** Zahl auf dem App-Symbol (Handy/PC, wenn als App installiert) – nur wo der Browser das kann. */
function setAppBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function myDutyStatus() {
  return st.duty?.me?.status || 'off';
}

function renderUser() {
  const u = st.user;
  $('#userCard').innerHTML = `${avatarWrap(u.avatarUrl, u.displayName, isStaff() ? myDutyStatus() : null)}
      <div class="meta"><div class="name">${esc(u.displayName)}</div><div class="role">${esc(u.rank || ROLES[u.role] || '')}</div></div>
      <button class="icon-btn sm" data-action="logout" title="Abmelden" aria-label="Abmelden">${icon('logout', 'ico-sm')}</button>`;
  $('#topAvatar').innerHTML = avatarInner(u);
  renderDutyBtn();
}

/* ---------------------------------------------------------------- Dienststatus (Kopfzeile) */
function renderDutyBtn() {
  const wrap = $('#dutyWrap');
  if (!isStaff()) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const s = myDutyStatus();
  const btn = $('#dutyBtn');
  btn.classList.toggle('on', s !== 'off');
  btn.innerHTML = `<span class="duty-dot s-${s}"></span><span class="lbl">${esc(DUTY[s])}</span>`;
}
function openDutyPop() {
  const s = myDutyStatus();
  $('#dutyPop').innerHTML =
    Object.entries(DUTY)
      .map(([k, l]) => `<button type="button" class="pop-item ${s === k ? 'active' : ''}" role="menuitem" data-action="duty-set" data-status="${k}"><span class="duty-dot s-${k}"></span>${esc(l)}${s === k ? '<span class="ml-auto text-xs">✓</span>' : ''}</button>`)
      .join('') +
    `<button type="button" class="pop-item" role="menuitem" data-action="absence-new">${icon('calendar', 'ico-sm')}Abmelden (Abwesenheit)…</button>` +
    '<div class="pop-note"><a href="#duty" class="text-xs text-gold hover:underline">Stempeluhr, Dienstzeiten & Abmeldungen →</a></div>';
  $('#dutyPop').classList.add('open');
  $('#dutyBtn').setAttribute('aria-expanded', 'true');
}
function closeDutyPop() {
  $('#dutyPop').classList.remove('open');
  $('#dutyBtn').setAttribute('aria-expanded', 'false');
}
async function setDutyStatus(status, note) {
  const before = myDutyStatus();
  const body = { status };
  if (note !== undefined) body.note = note;
  st.duty = await api.post('/api/duty', body);
  closeDutyPop();
  renderUser();
  if (status === 'off') toast(before === 'off' ? 'Sie sind außer Dienst.' : 'Dienst beendet – gute Erholung!');
  else if (before === 'off') toast(`Dienst begonnen – Status: ${DUTY[status]}.`);
  else toast(`Status: ${DUTY[status]}`);
  if (st.view === 'duty') await refreshBehind();
  else if (st.view === 'overview') renderView();
}

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebarBackdrop').classList.add('show');
  scheduleHistory();
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('show');
  scheduleHistory();
}

/*
 * Zurück-Taste (Browser, Handy-Geste, Maustaste): Ist ein Fenster oder das Handy-Menü offen, bekommt es einen
 * eigenen Eintrag im Verlauf. „Zurück“ schließt dann genau dieses Fenster (wie X) statt die Seite zu verlassen.
 * Ist eine Akte offen, steht sie in der Adresse (?case=12) – nach dem Neuladen ist sie wieder offen.
 */
const overlayOpen = () => $('#modal').classList.contains('open') || $('#sidebar').classList.contains('open');
const onOverlayEntry = () => !!(history.state && history.state.psOverlay);
/** Akte, die gerade offen ist – auch wenn ein Unterfenster (z. B. Vertrag) darüber liegt. */
function openCaseId() {
  for (const m of [st.modalCurrent, ...[...st.modalStack].reverse()]) {
    if (m && m.key && m.key.startsWith('case:')) return Number(m.key.slice(5));
  }
  return null;
}
/** Aktuelle Adresse mit (oder ohne) ?case=… */
function urlWithCase(id) {
  const p = new URLSearchParams(location.search);
  p.delete('case');
  if (id) p.set('case', id);
  const q = p.toString();
  return location.pathname + (q ? '?' + q : '') + location.hash;
}
/** Verlauf an das anpassen, was offen ist (nach dem aktuellen Klick, damit Seitenwechsel zuerst greifen). */
function scheduleHistory() {
  clearTimeout(st.histTimer);
  st.histTimer = setTimeout(syncHistory, 0);
}
function syncHistory() {
  if (st.histPaused || (st.histSkip && Date.now() - st.histSkip < 2000)) return; // eigenes „Zurück“ läuft noch
  st.histSkip = 0;
  if (overlayOpen()) {
    const url = urlWithCase(openCaseId());
    // base: die Seite unter dem Fenster – nur dorthin führt das Schließen später zurück
    if (!onOverlayEntry()) history.pushState({ psOverlay: 1, base: location.pathname + location.search + location.hash }, '', url);
    else if (url !== location.pathname + location.search + location.hash) history.replaceState({ ...history.state, psOverlay: 1 }, '', url);
  } else if (onOverlayEntry()) {
    // per X/Esc/Speichern geschlossen: den Eintrag des Fensters wieder entfernen
    dropOverlayEntry();
  }
}
/**
 * Verlaufseintrag eines geschlossenen Fensters entfernen – ohne je das Dashboard zu verlassen. Ein einfaches
 * „Zurück“ landete sonst auf dem Eintrag davor, und der ist nicht immer die Seite unter dem Fenster: Akte per Link
 * geöffnet, Seite neu geladen, von der Website gekommen, oder der Browser überspringt Einträge (z. B. Brave). Dann
 * führte X auf die Website. Zurück geht es deshalb nur auf genau den Eintrag der Seite darunter; gibt es den nicht
 * direkt davor, wird der Eintrag des Fensters einfach zur Seite umgeschrieben.
 */
function dropOverlayEntry() {
  const page = urlWithCase(null);
  const nav = window.navigation;
  if (nav && nav.currentEntry && typeof nav.traverseTo === 'function') {
    const prev = nav.currentEntry.index > 0 ? nav.entries()[nav.currentEntry.index - 1] : null;
    if (prev && prev.url === new URL(page, location.href).href) {
      st.histSkip = Date.now();
      traverseBack(nav, prev); // genau dieser Eintrag – der Browser überspringt hier nichts
      return;
    }
  } else if (history.state && history.state.base === page) {
    // Browser ohne Navigation API: der Eintrag davor ist die Seite, von der aus das Fenster geöffnet wurde
    st.histSkip = Date.now();
    history.back();
    return;
  }
  history.replaceState(null, '', page);
}
/**
 * Im Verlauf auf genau diesen Eintrag zurückspringen. Der Sprung läuft asynchron: Tippt man währenddessen schon auf
 * einen Menüpunkt (am Handy direkt nach dem Schließen der Akte), landete der Sprung danach wieder auf der alten
 * Seite – Adresse und Ansicht passten nicht mehr zusammen. Dann wird das Ziel nach dem Sprung noch einmal aufgerufen.
 */
function traverseBack(nav, entry) {
  let wanted = null;
  const onNavigate = (e) => {
    if (e.hashChange && e.navigationType !== 'traverse') wanted = new URL(e.destination.url).hash;
  };
  nav.addEventListener('navigate', onNavigate);
  const t = nav.traverseTo(entry.key);
  t.committed.catch(() => {});
  const done = () => {
    nav.removeEventListener('navigate', onNavigate);
    if (wanted && location.hash !== wanted) location.hash = wanted;
  };
  t.finished.then(done, done);
  return t;
}
function onPopState(e) {
  if (st.histSkip && Date.now() - st.histSkip < 2000) {
    st.histSkip = 0;
    scheduleHistory();
    return;
  }
  st.histSkip = 0;
  if (e.state && e.state.psOverlay) {
    // „Vorwärts“ auf ein bereits geschlossenes Fenster: die Akte wieder öffnen, sonst als normalen Eintrag behandeln
    if (overlayOpen()) return;
    const id = Number(new URLSearchParams(location.search).get('case'));
    if (id) guard(() => openCase(id));
    else history.replaceState(null, '', urlWithCase(null));
    return;
  }
  if (!overlayOpen()) return; // normaler Seitenwechsel – erledigt hashchange
  // Zurück bei offener Rückfrage: nur die Rückfrage schließen
  const cancel = document.querySelector('.ps-dialog-root.open [data-ps-dialog="cancel"]');
  if (cancel) {
    cancel.click();
    scheduleHistory();
    return;
  }
  if ($('#sidebar').classList.contains('open')) {
    closeSidebar();
    return;
  }
  // Mit ungespeicherten Eingaben kommt erst die Rückfrage – bis dahin bleibt das Fenster im Verlauf
  if (formDirty($('#modalBody'))) syncHistory();
  guard(() => modalDismiss()).finally(scheduleHistory);
}

/*
 * Ungespeicherte Eingaben: Wer in einem Formular etwas eingetragen hat und das Fenster schließt, die Seite wechselt
 * oder neu lädt, wird vorher gefragt. Felder, die sofort speichern (Priorität, Rolle, Sortierung …), zählen nicht.
 */
const AUTO_SAVE_FIELDS = '[data-case-priority], [data-case-status], [data-user-field], [data-ext-sort], [data-upload], [data-no-dirty], #msgRoleInsert, input[type="search"]';
function formDirty(root, { invoice = false } = {}) {
  if (!root) return false;
  return $$('form[data-form] input, form[data-form] textarea, form[data-form] select', root).some((el) => {
    if (el.disabled || el.type === 'hidden' || el.type === 'file' || el.matches(AUTO_SAVE_FIELDS)) return false;
    if (!invoice && el.closest('#invoiceForm')) return false; // Rechnungs-Entwurf bleibt beim Seitenwechsel erhalten
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') {
      const def = [...el.options].findIndex((o) => o.defaultSelected);
      return el.selectedIndex !== (def < 0 ? 0 : def);
    }
    return el.value !== el.defaultValue;
  });
}
/** Irgendwo etwas Ungespeichertes – im offenen Fenster, in einem Fenster darunter oder auf der Seite? */
function unsavedInputs({ invoice = false } = {}) {
  if (formDirty($('#modalBody')) || st.modalStack.some((m) => m.nodes && formDirty(m.nodes))) return true;
  if (formDirty($('#content'), { invoice })) return true;
  // Rechnungs-Entwurf (geht nur beim Neuladen verloren)
  return invoice && st.view === 'invoice-new' && !!st.draft && (st.draft.items.length > 0 || !!st.draft.subject || !!st.draft.notes);
}
/** „Verwerfen“ bestätigt: die Entwürfe dieser Formulare (im Browser gemerkt) ebenfalls löschen. */
function discardDrafts(...roots) {
  roots.filter(Boolean).forEach((root) => $$('form[data-form]', root).forEach((f) => window.PS.drafts.clear(f)));
}
const askDiscard = (page = false) =>
  ask(page ? 'Ihre Eingaben auf dieser Seite sind noch nicht gespeichert und gehen sonst verloren.' : 'Ihre Eingaben in diesem Fenster sind noch nicht gespeichert und gehen sonst verloren.', {
    title: 'Eingaben verwerfen?',
    confirmText: 'Verwerfen',
    cancelText: 'Weiter bearbeiten',
    danger: true,
  });
/** Zu einer anderen Seite – bei ungespeicherten Eingaben erst nachfragen. */
async function leaveTo(view) {
  if (unsavedInputs()) {
    if (!(await askDiscard(true))) return;
    discardDrafts($('#modalBody'), $('#content'), ...st.modalStack.map((m) => m.nodes));
  }
  closeSidebar();
  return navigate(view || 'overview');
}

/*
 * Dialog-Verlauf: Wird aus einem Fenster heraus ein weiteres geöffnet (z. B. Mandatsvertrag, Termin oder Aufgabe
 * aus der Akte), merkt sich das Dashboard das vorherige. Schließen – X, Esc, Klick daneben, „Abbrechen“ – und
 * Speichern führen genau dorthin zurück; erst das erste Fenster schließt ganz.
 *  - Akten, Anliegen, Bewerbungen und Termine (opts.reopen) werden beim Zurückkehren frisch geladen und an
 *    dieselbe Stelle gescrollt – Änderungen aus dem Unterfenster sind sofort zu sehen.
 *  - Andere Fenster (z. B. ein halb ausgefülltes Formular) kommen genau so zurück, wie sie waren.
 *  - Ein abgeschicktes Formular wird ersetzt (nie dorthin zurück); Seitenwechsel schließen alles (closeModal).
 */
const MODAL_STATE = ['modalCaseId', 'modalAppId', 'modalConcernId', 'caseInfo', 'caseAttachments', 'caseDocs', 'caseContracts', 'caseTasks', 'returnCase', 'msgId', 'msgTab', 'msgUseTab'];

/** Das gerade offene Fenster beiseitelegen (Inhalt samt Eingaben, Scrollposition und zugehörigem Zustand). */
function stashModal() {
  const body = $('#modalBody');
  const scroll = [$('#modal').scrollTop, body.scrollTop]; // vor dem Ausräumen lesen – danach ist das Fenster leer und oben
  const nodes = document.createDocumentFragment();
  while (body.firstChild) nodes.appendChild(body.firstChild);
  const state = {};
  MODAL_STATE.forEach((k) => (state[k] = st[k]));
  st.modalStack.push({ ...(st.modalCurrent || {}), nodes, state, scroll });
  // Das neue Fenster zeigt keine Akte/Bewerbung/kein Anliegen mehr – Aktualisierungen im Hintergrund dürfen es nicht ersetzen
  st.modalCaseId = null;
  st.modalAppId = null;
  st.modalConcernId = null;
}

/**
 * opts.key: was das Fenster zeigt (z. B. 'case:12') – dasselbe noch einmal öffnen ersetzt es nur.
 * opts.reopen: lädt das Fenster neu (für die Rückkehr aus einem Unterfenster).
 */
function openModal(html, { wide = false, key = null, reopen = null, child = false } = {}) {
  const modal = $('#modal');
  const body = $('#modalBody');
  // Dasselbe Fenster noch einmal oder die Platzhalter, die gerade geladen werden: nur ersetzen, nicht stapeln
  const same = (key && st.modalCurrent && st.modalCurrent.key === key) || !!(st.modalCurrent && st.modalCurrent.placeholder);
  // child: auch nach dem Absenden eines Formulars als Unterfenster öffnen (z. B. „Rechnung erstellt“ über der Akte)
  if (modal.classList.contains('open') && !st.modalRestoring && (child || !st.modalReplace) && !same) stashModal();
  const wasOpen = modal.classList.contains('open');
  st.modalCurrent = { key, reopen, wide };
  body.innerHTML = html;
  // Titel für Screenreader: das Fenster heißt wie seine erste Überschrift (wo kein id="modalTitle" gesetzt ist)
  if (!body.querySelector('#modalTitle')) {
    const head = body.querySelector('.modal-title, h1, h2, h3');
    if (head) head.id = 'modalTitle';
  }
  $('#modalCard').classList.toggle('wide', wide);
  modal.classList.add('open');
  // Fensterwechsel (neues Fenster über dem alten, Zurück, Inhalt nach dem Laden): weich statt hart
  if (wasOpen) playIn(body, 'swap-in');
  modal.scrollTop = 0;
  body.scrollTop = 0;
  document.body.classList.add('modal-open');
  tickCountdowns();
  const focusTarget = $('#modalBody [autofocus]');
  if (focusTarget && window.matchMedia('(min-width: 768px)').matches) focusTarget.focus();
  scheduleHistory();
}
/*
 * Lange Listen (Akten, Rechnungen, Mandanten, Aufgaben): erst LIST_PAGE Einträge zeichnen, beim Scrollen kommen die
 * nächsten von selbst (oder per Klick auf „… weitere“). Gefiltert und gesucht wird weiter über alle Einträge – so
 * bleiben Seite und Suche auch mit vielen hundert Akten flüssig.
 */
const LIST_PAGE = 50;
const moreLists = new Map(); // Kennung → { rows, render, pos, cols }
let moreSeq = 0;
function moreRowHtml(id, left, cols) {
  const label = `${left === 1 ? '1 weiterer Eintrag' : `${left} weitere Einträge`} …`;
  return cols
    ? `<tr class="more-rows" data-more="${id}"><td colspan="${cols}"><button type="button" class="more-btn" data-action="list-more" data-id="${id}">${label}</button></td></tr>`
    : `<div class="more-rows" data-more="${id}"><button type="button" class="more-btn" data-action="list-more" data-id="${id}">${label}</button></div>`;
}
/** rows: alle Einträge, render: Eintrag → HTML; cols: Anzahl Spalten, wenn die Einträge Tabellenzeilen sind. */
function lazyRows(rows, render, cols = 0) {
  if (rows.length <= LIST_PAGE) return rows.map(render).join('');
  for (const id of moreLists.keys()) if (!document.querySelector(`[data-more="${id}"]`)) moreLists.delete(id); // alte Listen vergessen
  const id = `l${++moreSeq}`;
  moreLists.set(id, { rows, render, pos: LIST_PAGE, cols });
  queueMicrotask(watchMoreRows);
  return rows.slice(0, LIST_PAGE).map(render).join('') + moreRowHtml(id, rows.length - LIST_PAGE, cols);
}
/** Nächste Einträge einer Liste anhängen. */
function showMoreRows(id) {
  const list = moreLists.get(id);
  const marker = document.querySelector(`[data-more="${id}"]`);
  if (!list || !marker) return;
  const next = list.rows.slice(list.pos, list.pos + LIST_PAGE);
  list.pos += next.length;
  marker.insertAdjacentHTML('beforebegin', next.map(list.render).join(''));
  const left = list.rows.length - list.pos;
  if (left > 0) marker.outerHTML = moreRowHtml(id, left, list.cols);
  else {
    marker.remove();
    moreLists.delete(id);
  }
  watchMoreRows();
}
// Rechtzeitig nachladen, bevor man unten ankommt (auch im Fenster mit eigenem Scrollbereich)
const moreObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && showMoreRows(e.target.dataset.more)), { rootMargin: '600px 0px' }) : null;
function watchMoreRows() {
  if (!moreObserver) return;
  moreObserver.disconnect();
  $$('[data-more]').forEach((el) => moreObserver.observe(el));
}

/** Platzhalter für ein Fenster, das noch lädt (Kopf, Kennzahlen, Abschnitte). */
function modalSkeletonHtml() {
  const row = (w) => `<div class="skel-row"><div class="flex-1">${skelLine(w)}${skelLine('34%', 'mt-2 skel-sm')}</div>${skelLine('64px', 'skel-pill')}</div>`;
  return `<div class="skel-page pr-12" aria-busy="true">
      <h2 id="modalTitle" class="sr-only">Wird geladen …</h2>
      ${skelLine('110px', 'skel-sm')}${skelLine('min(420px, 75%)', 'skel-title mt-3')}
      <div class="flex flex-wrap gap-3 mt-5">${skelLine('150px', 'skel-pill')}${skelLine('130px', 'skel-pill')}</div>
      <div class="grid grid-cols-3 gap-4 mt-8">${skelLine('80%')}${skelLine('70%')}${skelLine('60%')}${skelLine('65%', 'skel-sm')}${skelLine('75%', 'skel-sm')}${skelLine('55%', 'skel-sm')}</div>
      <div class="mt-8">${['70%', '55%', '62%'].map(row).join('')}</div>
    </div>`;
}
/**
 * Fenster, das erst Daten laden muss: Dauert es, erscheint sofort ein Fenster mit Platzhaltern, das die Daten danach
 * füllen (openModal ersetzt es). Wird es vorher geschlossen, bleibt es zu – Ergebnis dann null.
 */
async function withModalPlaceholder({ wide = false } = {}, loadFn) {
  let shown = null;
  const t = setTimeout(() => {
    openModal(modalSkeletonHtml(), { wide });
    shown = st.modalCurrent;
    shown.placeholder = true;
  }, 150);
  try {
    const data = await loadFn();
    return shown && st.modalCurrent !== shown ? null : data; // inzwischen geschlossen oder anderswo hin
  } catch (e) {
    if (shown && st.modalCurrent === shown) await modalBack();
    throw e;
  } finally {
    clearTimeout(t);
  }
}
function replaceModal(html) {
  const body = $('#modalBody');
  const modal = $('#modal');
  const y1 = body.scrollTop;
  const y2 = modal.scrollTop;
  body.innerHTML = html;
  body.scrollTop = y1;
  modal.scrollTop = y2;
  tickCountdowns();
}
/** Alles schließen – auch die vorherigen Fenster (Seitenwechsel, Abmelden). */
function closeModal() {
  st.modalStack = [];
  st.modalCurrent = null;
  const modal = $('#modal');
  if (!modal.classList.contains('open')) return;
  scheduleHistory();
  modal.classList.remove('open');
  $('#modalBody').innerHTML = '';
  document.body.classList.remove('modal-open');
  st.modalCaseId = null;
  st.modalAppId = null;
  st.modalConcernId = null;
  st.returnCase = null;
}
/** Neues Fenster an die Stelle des aktuellen setzen (z. B. Suchergebnis statt Suche) – ohne Rückweg dorthin. */
async function modalInstead(fn) {
  st.modalReplace++;
  try {
    return await fn();
  } finally {
    st.modalReplace--;
  }
}
/** Zurück zum vorherigen Fenster – oder schließen, wenn es keins gibt. */
async function modalBack() {
  if (st.modalRestoring) return; // vorheriges Fenster lädt gerade (z. B. Doppelklick auf X)
  const prev = st.modalStack.pop();
  if (!prev) return closeModal();
  const modal = $('#modal');
  const body = $('#modalBody');
  if (prev.reopen) {
    st.modalRestoring = true;
    try {
      await prev.reopen();
      st.returnCase = null; // die Akte selbst ist wieder offen
    } catch (e) {
      handleError(e);
      return closeModal(); // z. B. Akte inzwischen gelöscht – nicht mit veralteten Daten weiterarbeiten
    } finally {
      st.modalRestoring = false;
    }
  } else {
    body.innerHTML = '';
    body.appendChild(prev.nodes);
    playIn(body, 'swap-in');
    Object.assign(st, prev.state);
    st.modalCurrent = { key: prev.key || null, reopen: null, wide: !!prev.wide };
    $('#modalCard').classList.toggle('wide', !!prev.wide);
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    tickCountdowns();
    scheduleHistory();
  }
  restoreModalScroll(prev.scroll);
}
/** Vom Nutzer geschlossen (X, Esc, daneben, Abbrechen, Zurück-Taste): bei ungespeicherten Eingaben erst nachfragen. */
async function modalDismiss(back = modalBack) {
  if (st.modalRestoring || st.modalAsking) return;
  if (formDirty($('#modalBody'))) {
    st.modalAsking = true;
    try {
      if (!(await askDiscard())) return;
      discardDrafts($('#modalBody'));
    } finally {
      st.modalAsking = false;
    }
  }
  await back();
}
/**
 * An die vorherige Stelle scrollen. Frisch geladene Inhalte (Bilder, nachgeladene Angaben) wachsen oft noch ein
 * paar Pixel – deshalb kurz danach noch einmal, solange niemand selbst gescrollt hat.
 */
function restoreModalScroll([top, bodyTop]) {
  const modal = $('#modal');
  const body = $('#modalBody');
  const apply = () => {
    modal.scrollTop = top;
    body.scrollTop = bodyTop;
    return [modal.scrollTop, body.scrollTop];
  };
  let last = apply();
  for (const ms of [50, 200, 600]) {
    setTimeout(() => {
      if (!modal.classList.contains('open') || modal.scrollTop !== last[0] || body.scrollTop !== last[1]) return; // inzwischen selbst gescrollt
      last = apply();
    }, ms);
  }
}

/**
 * Platzhalter in der Form der Seite, solange sie lädt: Titelzeile, je nach Seite Kennzahlen, darunter eine Liste.
 * Graue Flächen statt „wird geladen …“ – die Seite springt danach nicht.
 */
const skelLine = (w, cls = '') => `<div class="skeleton ${cls}" style="width:${w}"></div>`;
function loadingHtml(view = st.view) {
  const line = skelLine;
  const kpis = ['overview', 'invoices', 'duty', 'work', 'stats'].includes(view)
    ? `<div class="kpi-grid kpi-grid-3 skel-kpis">${'<div class="panel kpi">' + line('45%') + line('60%', 'skel-lg mt-3') + '</div>'}${'<div class="panel kpi">' + line('40%') + line('55%', 'skel-lg mt-3') + '</div>'}${'<div class="panel kpi">' + line('50%') + line('35%', 'skel-lg mt-3') + '</div>'}</div>`
    : '';
  const row = (w) => `<div class="skel-row"><div class="skel-dot"></div><div class="flex-1">${line(w)}${line('38%', 'mt-2 skel-sm')}</div>${line('70px', 'skel-pill')}</div>`;
  return `<div class="skel-page" aria-busy="true"><p class="sr-only" role="status">Wird geladen …</p>
      <div class="page-head"><div class="flex-1">${line('min(320px, 60%)', 'skel-title')}${line('min(460px, 85%)', 'mt-3')}</div></div>
      ${kpis}
      <div class="panel panel-pad">${['72%', '58%', '66%', '50%', '62%'].map(row).join('')}</div>
    </div>`;
}
const errorHtml = (msg) =>
  `<div class="panel">${empty(msg || 'Daten konnten nicht geladen werden.', 'alert')}<div class="text-center pb-6"><button class="btn-outline btn-md" data-action="reload-view">Erneut versuchen</button></div></div>`;

function handleError(e) {
  if (e && e.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent('/dashboard.html' + location.search + location.hash);
    return;
  }
  toast(e?.message || 'Unbekannter Fehler.', 'error');
}
/** Sofort angezeigte Änderung ließ sich nicht speichern: Hinweis, dass sie zurückgesprungen ist (401 bleibt 401). */
const notSaved = (err, what = 'Nicht gespeichert') => Object.assign(new Error(`${what} – ${err?.message || 'Unbekannter Fehler.'}`), { status: err?.status });
async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    handleError(e);
  }
}

const hashView = () => decodeURIComponent(location.hash.slice(1)) || 'overview';

async function go(view) {
  if (!allowed(view)) view = 'overview';
  if (view !== 'invoice-new') st.invoiceFrom = null; // Rechnung aus einer Akte: Rückweg gilt nur bis zum Verlassen der Seite
  st.view = view;
  closeModal();
  closeSidebar();
  closeDutyPop();
  renderNav();
  const content = $('#content');
  window.scrollTo(0, 0);
  const token = ++st.navToken;
  // Platzhalter erst, wenn das Laden dauert – schnelle Seiten erscheinen ohne kurzes Aufblitzen
  const slow = setTimeout(() => token === st.navToken && (content.innerHTML = loadingHtml(view)), 120);
  try {
    if (views[view].load) await views[view].load();
  } catch (e) {
    if (token !== st.navToken) return;
    clearTimeout(slow);
    handleError(e);
    content.innerHTML = errorHtml(e.message);
    return;
  }
  clearTimeout(slow);
  if (token !== st.navToken) return;
  renderView();
  playIn(content, 'view-in');
}
/** Sanft einblenden (Seitenwechsel, neues Fenster) – nicht bei jedem Neuzeichnen, sonst flackert es. */
function playIn(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // Animation neu starten
  el.classList.add(cls);
}
function renderView() {
  $('#content').innerHTML = views[st.view].render();
  renderNav();
  tickCountdowns();
}
function navigate(view) {
  // Aus einem offenen Fenster heraus: dessen Verlaufseintrag durch die neue Seite ersetzen (Zurück führt nicht ins Leere)
  if (onOverlayEntry()) history.replaceState(null, '', urlWithCase(null).split('#')[0] + '#' + view);
  else if (location.hash !== '#' + view) history.pushState(null, '', '#' + view);
  return go(view);
}
/**
 * Von einer Seite zurück auf die Seite davor (Rechnung aus der Akte: Abbrechen oder Erstellen) – im Verlauf zurück
 * statt mit einem neuen Eintrag. Sonst führte die Zurück-Taste danach wieder in das verlassene Formular.
 */
async function returnToView(view) {
  const target = new URL(urlWithCase(null).split('#')[0] + '#' + view, location.href).href;
  const nav = window.navigation;
  const prev = nav && nav.currentEntry && nav.currentEntry.index > 0 ? nav.entries()[nav.currentEntry.index - 1] : null;
  if (prev && prev.url === target && !onOverlayEntry() && typeof nav.traverseTo === 'function') {
    st.hashSkip = '#' + view; // die Seite wird hier geladen – nicht noch einmal über hashchange
    try {
      const t = nav.traverseTo(prev.key);
      t.committed.catch(() => {});
      await t.finished;
      return go(view);
    } catch {
      st.hashSkip = null; // Zurück abgebrochen: Eintrag des Formulars einfach ersetzen
    }
  }
  history.replaceState(null, '', target);
  return go(view);
}
/** Lädt die Daten der aktuellen Ansicht neu, ohne einen offenen Dialog zu schließen. */
async function refreshBehind() {
  try {
    if (views[st.view].load) await views[st.view].load();
    renderView();
  } catch (e) {
    handleError(e);
  }
}
/** Nach dem Speichern in einem Unterfenster (z. B. aus der Akte heraus) dorthin zurück, sonst schließen. */
async function returnOrClose() {
  const caseId = st.returnCase;
  st.returnCase = null;
  if (st.modalStack.length) await modalBack();
  else if (caseId) await openCase(caseId);
  else closeModal();
  refreshBehind();
}

function showCredentials(cred, name) {
  const text = `Login: ${location.origin}/login.html\nE-Mail: ${cred.email}\nEinmal-Passwort: ${cred.password}`;
  openModal(`
      <h2 class="modal-title">Zugangsdaten${name ? ' für ' + esc(name) : ''}</h2>
      <p class="modal-sub">Das Einmal-Passwort wird <strong>nur jetzt</strong> angezeigt. Bitte sicher weitergeben (z. B. per Discord-Direktnachricht). Beim ersten Login wird zum Ändern aufgefordert.</p>
      <div class="form-grid">
        <div><div class="label">E-Mail / Login</div><div class="secret-box">${esc(cred.email)}</div></div>
        <div><div class="label">Einmal-Passwort</div><div class="secret-box">${esc(cred.password)}</div></div>
        <div class="form-actions">
          <button class="btn-gold btn-md" data-action="copy" data-text="${esc(text)}">${icon('copy')}<span>Zugangsdaten kopieren</span></button>
          <button class="btn-ghost btn-md" data-action="close-modal">Fertig</button>
        </div>
      </div>`);
}
