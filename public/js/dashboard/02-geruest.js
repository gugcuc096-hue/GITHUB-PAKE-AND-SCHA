/*
 * Kanzlei-Dashboard – Teil 2 von 14: Grundgerüst: Navigation, Dialog, Routing.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Grundgerüst: Navigation, Dialog, Routing
   ================================================================ */
/* Menügruppen: Kanzlei, Board-Eingang und Verwaltung lassen sich auf- und zuklappen (im Browser gemerkt);
 * Verwaltung ist anfangs zu. Führt ein Seitenwechsel in eine zugeklappte Gruppe, ist sie für diese Seite offen
 * (nicht gemerkt) – und lässt sich trotzdem zuklappen, auch während man auf einer ihrer Seiten ist. */
const NAV_FOLDABLE = { Kanzlei: false, 'Board-Eingang': false, Verwaltung: true }; // Gruppe → anfangs zugeklappt?
function navClosedPrefs() {
  try {
    return JSON.parse(localStorage.getItem('ps.navClosed') || '{}') || {};
  } catch {
    return {};
  }
}
const navGroupClosed = (prefs, group) => (group in prefs ? prefs[group] : NAV_FOLDABLE[group]);
function saveNavPrefs(prefs) {
  st.navClosed = prefs;
  try {
    localStorage.setItem('ps.navClosed', JSON.stringify(prefs));
  } catch {
    /* nur Komfort – ohne Speicher gilt die Auswahl bis zum Neuladen */
  }
}
function toggleNavGroup(group) {
  const prefs = st.navClosed || navClosedPrefs();
  // Was man sieht, zählt: offen → zuklappen, zu → aufklappen (auch wenn die Gruppe nur für die aktuelle Seite offen war)
  const btn = [...document.querySelectorAll('[data-action="nav-group"]')].find((b) => b.dataset.group === group);
  prefs[group] = btn ? btn.getAttribute('aria-expanded') === 'true' : !navGroupClosed(prefs, group);
  if (st.navTemp) delete st.navTemp[group];
  saveNavPrefs(prefs);
  renderNav();
  // Aufgeklappte Gruppe kurz einblenden (nur hier, nicht bei jedem Neuzeichnen des Menüs)
  if (!prefs[group]) {
    const btn = [...document.querySelectorAll('[data-action="nav-group"]')].find((b) => b.dataset.group === group);
    const list = btn && document.getElementById(btn.getAttribute('aria-controls'));
    if (list) playIn(list, 'nav-reveal');
  }
}
/** Board: „Anliegen“ führt in den Eingang; eigene Anliegen sind dort ein Reiter. */
const concernsMerged = () => isBoard();
function navCount(key) {
  if (key === 'concerns-board') return (st.concernOpen || 0) + (st.concernUnseen || 0);
  return { cases: st.chatUnread, mail: st.unread, applications: st.newApplications, tasks: st.dueTasks, concerns: st.concernUnseen, personnel: st.personnelNew, 'name-requests': st.nameOpen, vip: st.vipReqOpen, reviews: st.reviewOpen, invoices: st.paymentReports, resolutions: st.resolutionOpen }[key] || 0;
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
    // Gerade auf eine Seite dieser Gruppe gewechselt, die Gruppe ist aber zu: für diese Seite aufklappen (nicht gemerkt)
    const temp = st.navTemp || (st.navTemp = {});
    if (st.navOpenedFor !== st.view && g.items.some(navActive) && navGroupClosed(prefs, g.name)) temp[g.name] = st.view;
    const closed = navGroupClosed(prefs, g.name) && temp[g.name] !== st.view;
    const total = g.items.reduce((n, k) => n + navCount(k), 0);
    html += `<button type="button" class="nav-section nav-toggle" data-action="nav-group" data-group="${esc(g.name)}" aria-expanded="${!closed}" aria-controls="navGroup${i}">
        <span>${esc(g.name)}</span>${closed && total ? `<span class="nav-count">${total > 99 ? '99+' : total}</span>` : ''}${icon('chevronDown', 'ico-sm nav-chev')}</button>
      <div class="nav-group" id="navGroup${i}" ${closed ? 'hidden' : ''}>${items}</div>`;
  });
  $('#nav').innerHTML = html;
  st.navOpenedFor = st.view;

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
function formDirty(root, { invoice = false, skip = '' } = {}) {
  if (!root) return false;
  return $$('form[data-form] input, form[data-form] textarea, form[data-form] select', root).some((el) => {
    if (el.disabled || el.type === 'hidden' || el.type === 'file' || el.matches(AUTO_SAVE_FIELDS) || (skip && el.matches(skip))) return false;
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
  // Aus einer Akten-Zeile geöffnet: Fenster wächst aus der Zeile hervor (nur beim ersten Öffnen, nicht beim Ersetzen)
  if (!wasOpen && st.morphFrom) morphOpen(st.morphFrom);
  st.morphFrom = null;
  // Fensterwechsel (neues Fenster über dem alten, Zurück, Inhalt nach dem Laden): weich statt hart
  if (wasOpen) playIn(body, 'swap-in');
  modal.scrollTop = 0;
  body.scrollTop = 0;
  document.body.classList.add('modal-open');
  tickCountdowns();
  hidePendingDeletes();
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
  hidePendingDeletes();
}
/*
 * Akte „fliegt auf“: Aus einer Liste geöffnet, wächst das Fenster aus der angeklickten Zeile hervor; beim Schließen
 * zieht es sich dorthin zurück. Reine Optik über clip-path (kein Verzerren der Schrift) – geöffnet bzw. geschlossen
 * ist sofort, wie ohne Animation. Nur am PC (am Handy kommt das Blatt von unten), nicht bei „Bewegung reduzieren“.
 */
const MORPH_MS = 380;
const morphOk = () => window.matchMedia('(min-width: 640px)').matches && !window.PS.motion.calm() && typeof Element.prototype.animate === 'function';
/** Ausschnitt des Fensters, der genau über der Zeile liegt (liegt die Zeile außerhalb: der nächste Rand). */
function morphClip(card, rect) {
  const r = card.getBoundingClientRect();
  const cut = (v, max) => Math.min(Math.max(0, v), Math.max(0, max - 48));
  return `inset(${cut(rect.top - r.top, r.height)}px ${cut(r.right - rect.right, r.width)}px ${cut(r.bottom - rect.bottom, r.height)}px ${cut(rect.left - r.left, r.width)}px round 14px)`;
}
function morphOpen(rect) {
  const modal = $('#modal');
  const card = $('#modalCard');
  if (!morphOk()) return;
  modal.classList.add('morphing'); // eigenes Einblenden des Fensters aus (app.css)
  const anim = card.animate([{ clipPath: morphClip(card, rect), opacity: 0.6 }, { clipPath: 'inset(0px 0px 0px 0px round 20px)', opacity: 1 }], { duration: MORPH_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  anim.onfinish = anim.oncancel = () => modal.classList.remove('morphing');
}
/** Zeile der offenen Akte in der Liste dahinter – nur, wenn sie zu sehen ist. */
function morphRow() {
  const row = st.modalCaseId && document.querySelector(`#content [data-action="open-case"][data-id="${st.modalCaseId}"]`);
  if (!row || !morphOk()) return null;
  const r = row.getBoundingClientRect();
  return r.height && r.bottom > 0 && r.top < window.innerHeight ? r : null;
}
/** Openers: Akten-Zeile merken, aus der das Fenster hervorwachsen soll. */
function openCaseFrom(el) {
  st.morphFrom = morphOk() && !$('#modal').classList.contains('open') ? el.getBoundingClientRect() : null;
  return openCase(Number(el.dataset.id)).finally(() => (st.morphFrom = null));
}

/**
 * Weiches Schließen: Das echte Fenster ist sofort zu (Zustand und Tests bleiben einfach); eine stumme Kopie ohne ids
 * an derselben Scrollposition blendet kurz aus und liegt unter einem gleich danach geöffneten Fenster.
 * Bei „Bewegung reduzieren“ blendet sie nur aus, ohne zu gleiten (app.css, Ende).
 */
function fadeOutModal(modal, { morph = false } = {}) {
  const rowRect = morph ? morphRow() : null;
  const ghost = modal.cloneNode(true);
  const body = $('#modalBody');
  const ghostBody = ghost.querySelector('#modalBody');
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  ghost.classList.remove('open');
  ghost.classList.add('modal-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  document.body.appendChild(ghost);
  ghost.scrollTop = modal.scrollTop;
  if (ghostBody && body) ghostBody.scrollTop = body.scrollTop;
  const card = rowRect && ghost.querySelector('.modal-card');
  if (card) {
    // Zurück in die Zeile: die Kopie zieht sich auf die Zeile zusammen und blendet aus
    ghost.classList.add('morph-out');
    card.animate([{ clipPath: 'inset(0px 0px 0px 0px round 20px)', opacity: 1 }, { clipPath: morphClip(card, rowRect), opacity: 0.25 }], { duration: MORPH_MS - 60, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
  }
  setTimeout(() => ghost.remove(), card ? MORPH_MS : 240);
}
/** Alles schließen – auch die vorherigen Fenster (Seitenwechsel, Abmelden). morph: Akte zieht sich in ihre Zeile zurück. */
function closeModal({ morph = false } = {}) {
  st.modalStack = [];
  st.modalCurrent = null;
  const modal = $('#modal');
  if (!modal.classList.contains('open')) return;
  scheduleHistory();
  fadeOutModal(modal, { morph });
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
  if (!prev) return closeModal({ morph: true });
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
  const seen = st.seenViews || (st.seenViews = new Set());
  // Schon einmal geladen: sofort mit dem letzten Stand zeigen und im Hintergrund auffrischen (kein Warten beim Menüwechsel).
  // Formularseiten nicht – dort sollen keine Eingaben unter den Fingern neu gezeichnet werden.
  if (seen.has(view) && !INSTANT_SKIP.has(view)) {
    let shown = null;
    try {
      shown = views[view].render();
      renderView();
      playIn(content, 'view-in');
    } catch {
      shown = null; // alter Stand passt nicht mehr – normal laden
    }
    if (shown !== null) {
      // Hat die Person schon geklickt, gescrollt oder getippt, wird nicht mehr unter ihr neu gezeichnet
      // (die frischen Daten stehen trotzdem bereit und erscheinen beim nächsten Zeichnen)
      let touched = false;
      const mark = () => (touched = true);
      const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
      EVENTS.forEach((ev) => window.addEventListener(ev, mark, { capture: true, passive: true }));
      try {
        if (views[view].load) await views[view].load();
      } catch {
        return; // offline o. Ä.: der zuletzt geladene Stand bleibt stehen
      } finally {
        EVENTS.forEach((ev) => window.removeEventListener(ev, mark, { capture: true }));
      }
      seen.add(view);
      if (touched || token !== st.navToken || views[view].render() === shown || liveBusy(content)) return;
      const y = window.scrollY;
      renderView();
      window.scrollTo(0, y);
      return;
    }
  }
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
  seen.add(view);
  renderView();
  playIn(content, 'view-in');
}
const INSTANT_SKIP = new Set(['invoice-new', 'settings', 'profile']);
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
  hidePendingDeletes();
  window.PS.countUp($('#content')); // Kennzahlen zählen hoch (erstes Erscheinen bzw. bei Änderung)
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
/*
 * Löschen mit „Rückgängig“ statt Nachfrage (Aufgaben, Notizen, Termine): Der Eintrag verschwindet sofort, unten steht
 * ein paar Sekunden „… gelöscht · Rückgängig“. Erst danach wird wirklich gelöscht. Verlässt man die Seite vorher,
 * wird sofort gelöscht (keepalive) – und weil der Browser solche Anfragen beim Verlassen abbrechen kann, merkt sich
 * das Dashboard sie und holt sie beim nächsten Öffnen nach (die Nummern werden nie neu vergeben, doppelt ist harmlos).
 * Wird zwischendurch neu gezeichnet, bleibt der Eintrag trotzdem ausgeblendet.
 */
const UNDO_MS = 6000;
const UNDO_KEY = 'ps.undoDeletes';
const pendingDeletes = new Map(); // url → { hide, commit }
const undoStore = {
  list() {
    try {
      const l = JSON.parse(localStorage.getItem(UNDO_KEY) || '[]');
      return Array.isArray(l) ? l : [];
    } catch {
      return [];
    }
  },
  save(l) {
    try {
      if (l.length) localStorage.setItem(UNDO_KEY, JSON.stringify(l));
      else localStorage.removeItem(UNDO_KEY);
    } catch {
      /* ohne Speicher eben nur keepalive */
    }
  },
  add: (url) => undoStore.save([...undoStore.list().filter((x) => x.url !== url), { url, uid: st.user && st.user.id, at: Date.now() }]),
  remove: (url) => undoStore.save(undoStore.list().filter((x) => x.url !== url)),
};
/** Beim Start: Löschungen nachholen, die beim letzten Verlassen der Seite nicht mehr durchkamen. */
function replayUndoDeletes() {
  const now = Date.now();
  for (const x of undoStore.list()) {
    if (!st.user || x.uid !== st.user.id || pendingDeletes.has(x.url)) continue;
    if (now - x.at < UNDO_MS + 500) continue; // läuft in einem anderen Tab noch (Rückgängig möglich)
    undoStore.remove(x.url);
    if (now - x.at < 7 * 864e5) api.del(x.url).catch(() => {});
  }
}
function hidePendingDeletes() {
  for (const p of pendingDeletes.values()) $$(p.hide).forEach((el) => el.classList.add('undo-hidden'));
}
/** hide: Selektor aller Stellen, an denen der Eintrag steht; after: nach dem Löschen neu laden. */
function undoDelete({ url, hide, label, after }) {
  if (pendingDeletes.has(url)) return;
  let timer = 0;
  const show = () => $$(hide).forEach((el) => el.classList.remove('undo-hidden'));
  const commit = async () => {
    clearTimeout(timer);
    if (!pendingDeletes.delete(url)) return;
    note.close();
    try {
      await api.del(url).catch((err) => {
        if (err.status !== 404) throw err; // schon weg (z. B. von einem anderen Tab nachgeholt)
      });
      undoStore.remove(url);
      if (after) await after();
    } catch (err) {
      undoStore.remove(url);
      show();
      handleError(err);
    }
  };
  pendingDeletes.set(url, { hide, commit });
  undoStore.add(url);
  hidePendingDeletes();
  const note = toast(`${label} gelöscht.`, 'ok', {
    duration: UNDO_MS,
    action: {
      label: 'Rückgängig',
      onClick: () => {
        clearTimeout(timer);
        undoStore.remove(url);
        if (pendingDeletes.delete(url)) show();
      },
    },
  });
  timer = setTimeout(commit, UNDO_MS);
}
// Seite wird verlassen: Ausstehendes jetzt löschen (keepalive überlebt das Schließen des Tabs). Bleibt gemerkt und
// wird beim nächsten Start nachgeholt, falls der Browser die Anfrage abbricht.
window.addEventListener('pagehide', () => {
  const list = undoStore.list();
  for (const url of pendingDeletes.keys()) {
    const x = list.find((e) => e.url === url);
    if (x) x.at = Date.now() - UNDO_MS - 1000; // Rückgängig-Zeit vorbei: beim nächsten Start sofort nachholbar
    fetch(url, { method: 'DELETE', keepalive: true, credentials: 'same-origin', headers: { Accept: 'application/json', 'X-PS-Tab': window.PS.tab } }).catch(() => {});
  }
  undoStore.save(list);
  pendingDeletes.clear();
});

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

/* ---------------------------------------------------------------- Eingabe mit Vorschlägen */
/**
 * Freitext-Feld mit eigener Vorschlagsliste im Stil der Auswahllisten (statt <datalist>, das sich nicht gestalten lässt).
 * Tippen filtert, Pfeiltasten wählen, Enter übernimmt, Esc schließt – eigener Text bleibt erlaubt.
 */
function comboField({ id, name, value = '', options = [], maxlength = 120, placeholder = '' }) {
  return `<div class="combo">
      <input id="${esc(id)}" name="${esc(name)}" class="field combo-input" maxlength="${maxlength}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"
        autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(id)}List" data-combo>
      <button type="button" class="combo-toggle" tabindex="-1" aria-label="Vorschläge zeigen" data-combo-toggle>${icon('chevronDown', 'ico-sm')}</button>
      <ul class="combo-list" id="${esc(id)}List" role="listbox" hidden>${options
        .map((o) => `<li role="option" data-value="${esc(o)}">${esc(o)}</li>`)
        .join('')}</ul>
    </div>`;
}

const combo = {
  list: (input) => input.parentElement.querySelector('.combo-list'),
  items: (input) => [...combo.list(input).children].filter((li) => !li.hidden),
  open(input, all = false) {
    const q = all ? '' : input.value.trim().toLowerCase();
    const list = combo.list(input);
    let any = false;
    for (const li of list.children) {
      li.hidden = !!q && !li.dataset.value.toLowerCase().includes(q);
      li.classList.remove('active');
      li.setAttribute('aria-selected', String(li.dataset.value === input.value));
      any = any || !li.hidden;
    }
    list.hidden = !any;
    input.setAttribute('aria-expanded', String(any));
  },
  close(input) {
    combo.list(input).hidden = true;
    input.setAttribute('aria-expanded', 'false');
  },
  pick(input, li) {
    input.value = li.dataset.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    combo.close(input);
  },
  move(input, dir) {
    const items = combo.items(input);
    if (!items.length) return;
    const i = items.findIndex((li) => li.classList.contains('active'));
    items.forEach((li) => li.classList.remove('active'));
    const next = items[(i + dir + items.length) % items.length];
    next.classList.add('active');
    next.scrollIntoView({ block: 'nearest' });
  },
};
document.addEventListener('focusin', (e) => e.target.matches('[data-combo]') && combo.open(e.target, true));
document.addEventListener('input', (e) => e.target.matches('[data-combo]') && e.isTrusted && combo.open(e.target));
document.addEventListener('focusout', (e) => e.target.matches('[data-combo]') && combo.close(e.target));
document.addEventListener('mousedown', (e) => {
  const li = e.target.closest('.combo-list li');
  const toggle = e.target.closest('[data-combo-toggle]');
  if (!li && !toggle) return;
  e.preventDefault(); // Fokus bleibt im Feld
  const input = (li || toggle).closest('.combo').querySelector('[data-combo]');
  if (li) combo.pick(input, li);
  else if (combo.list(input).hidden) {
    input.focus();
    combo.open(input, true);
  } else combo.close(input);
});
document.addEventListener(
  'keydown',
  (e) => {
    const input = e.target.closest && e.target.closest('[data-combo]');
    if (!input) return;
    const open = !combo.list(input).hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) combo.open(input, true);
      combo.move(input, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && open) {
      const active = combo.list(input).querySelector('li.active');
      if (active) {
        e.preventDefault();
        combo.pick(input, active);
      }
    } else if (e.key === 'Escape' && open) {
      // Nur die Liste schließen, nicht das Fenster
      e.preventDefault();
      e.stopPropagation();
      combo.close(input);
    }
  },
  true
);

/* ---------------------------------------------------------------- Kalender für Datums- und Terminfelder */
/**
 * Eigener Kalender im Stil der Kanzlei für alle Datums- und Uhrzeitfelder (input.field type="date" / "datetime-local").
 * Die Felder bleiben echte Datumsfelder (gleicher Wert, Tippen am PC geht weiter) – nur das Aufklapp-Fenster ist unseres.
 * Datum: Tag anklicken = übernommen. Termin: Tag + Uhrzeit wählen, „Übernehmen“.
 */
const DP_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DP_SEL = 'input.field[type="date"], input.field[type="datetime-local"]';
const pad2 = (n) => String(n).padStart(2, '0');
const dpKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dp = { el: null, input: null, view: null, day: '', hh: '', mm: '' };

function dpParse(input) {
  const [date, time = ''] = String(input.value || '').split('T');
  const [hh = '', mm = ''] = time.split(':');
  return { date, hh, mm };
}

function dpRender() {
  const input = dp.input;
  const withTime = input.type === 'datetime-local';
  const min = String(input.min || '').slice(0, 10);
  const max = String(input.max || '').slice(0, 10);
  const y = dp.view.getFullYear();
  const m = dp.view.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7)); // Woche beginnt Montag
  const today = dpKey(new Date());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const cell = (d) => {
    const k = dpKey(d);
    const off = (min && k < min) || (max && k > max);
    return `<button type="button" class="dp-day${d.getMonth() !== m ? ' out' : ''}${k === today ? ' today' : ''}${k === dp.day ? ' sel' : ''}" data-dp-day="${k}" ${off ? 'disabled' : ''} aria-label="${d.getDate()}. ${DP_MONTHS[d.getMonth()]} ${d.getFullYear()}" aria-pressed="${k === dp.day}">${d.getDate()}</button>`;
  };
  const mins = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
  if (dp.mm && !mins.includes(dp.mm)) mins.push(dp.mm), mins.sort();
  dp.el.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav" data-dp-nav="-1" aria-label="Voriger Monat">${icon('chevronLeft', 'ico-sm')}</button>
      <div class="dp-title">${DP_MONTHS[m]} ${y}</div>
      <button type="button" class="dp-nav" data-dp-nav="1" aria-label="Nächster Monat">${icon('chevronRight', 'ico-sm')}</button>
    </div>
    <div class="dp-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span class="dp-wd">${w}</span>`).join('')}${days.map(cell).join('')}</div>
    ${
      withTime
        ? `<div class="dp-time"><span class="dp-time-label">${icon('clock', 'ico-sm')}Uhrzeit</span>
            <select class="field field-sm" data-dp-time="hh" aria-label="Stunde">${Array.from({ length: 24 }, (_, h) => pad2(h))
              .map((h) => `<option ${h === dp.hh ? 'selected' : ''}>${h}</option>`)
              .join('')}</select><span class="dp-colon">:</span>
            <select class="field field-sm" data-dp-time="mm" aria-label="Minute">${mins.map((x) => `<option ${x === dp.mm ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`
        : ''
    }
    <div class="dp-foot">
      <button type="button" class="btn-ghost btn-sm" data-dp-act="today">${withTime ? 'Jetzt' : 'Heute'}</button>
      ${input.required ? '' : '<button type="button" class="btn-ghost btn-sm" data-dp-act="clear">Leeren</button>'}
      ${withTime ? '<button type="button" class="btn-gold btn-sm" data-dp-act="ok">Übernehmen</button>' : ''}
    </div>`;
  dpPlace();
}

function dpPlace() {
  if (!dp.el || !dp.input) return;
  const r = dp.input.getBoundingClientRect();
  const w = dp.el.offsetWidth;
  const h = dp.el.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : Math.max(8, Math.min(below, window.innerHeight - h - 8));
  dp.el.style.left = `${left}px`;
  dp.el.style.top = `${top}px`;
}

function dpOpen(input) {
  if (dp.input === input) return;
  dpClose();
  const v = dpParse(input);
  dp.input = input;
  dp.day = v.date;
  const now = new Date();
  dp.hh = v.hh || pad2(Math.min(23, now.getHours() + 1));
  dp.mm = v.mm || '00';
  const base = v.date ? new Date(`${v.date}T00:00`) : input.min ? new Date(`${String(input.min).slice(0, 10)}T00:00`) : now;
  dp.view = new Date(base.getFullYear(), base.getMonth(), 1);
  dp.el = document.createElement('div');
  dp.el.className = 'dp';
  dp.el.setAttribute('role', 'dialog');
  dp.el.setAttribute('aria-label', input.type === 'datetime-local' ? 'Datum und Uhrzeit wählen' : 'Datum wählen');
  dp.el.style.width = `${Math.min(360, Math.max(304, input.offsetWidth))}px`; // so breit wie das Feld
  document.body.appendChild(dp.el);
  input.setAttribute('aria-expanded', 'true');
  if (input.dataset.dpRo) input.blur(); // am Handy keine Eingabe-Markierung im Feld
  dpRender();
  // Passt der Kalender weder unter noch über das Feld (Handy), Feld nach oben holen statt es zu verdecken
  const r = input.getBoundingClientRect();
  const h = dp.el.offsetHeight;
  if (r.bottom + h + 14 > window.innerHeight && r.top - h - 14 < 0) {
    input.scrollIntoView({ block: 'start', behavior: 'instant' });
    dpPlace();
  }
}

function dpClose() {
  if (!dp.el) return;
  dp.el.remove();
  if (dp.input) {
    dp.input.removeAttribute('aria-expanded');
    if (dp.input.dataset.dpRo) {
      dp.input.readOnly = false; // nur fürs Antippen gesperrt, damit sich nicht das System-Rad öffnet
      delete dp.input.dataset.dpRo;
    }
  }
  dp.el = null;
  dp.input = null;
}

function dpSet(value) {
  const input = dp.input;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function dpCommit() {
  if (!dp.day) return;
  dpSet(dp.input.type === 'datetime-local' ? `${dp.day}T${dp.hh}:${dp.mm}` : dp.day);
  dpClose();
}

// Antippen am Handy: kurz schreibschützen, damit nicht das System-Rad aufgeht
document.addEventListener('pointerdown', (e) => {
  const input = e.target.closest && e.target.closest(DP_SEL);
  if (input && e.pointerType !== 'mouse' && !input.readOnly && !input.disabled) {
    input.readOnly = true;
    input.dataset.dpRo = '1';
  }
});
document.addEventListener('click', (e) => {
  const input = e.target.closest && e.target.closest(DP_SEL);
  if (input && !input.disabled && (!input.readOnly || input.dataset.dpRo)) return dpOpen(input);
  if (!dp.el) return;
  if (!dp.el.contains(e.target)) return dpClose();
  const nav = e.target.closest('[data-dp-nav]');
  const day = e.target.closest('[data-dp-day]');
  const act = e.target.closest('[data-dp-act]');
  if (nav) {
    dp.view = new Date(dp.view.getFullYear(), dp.view.getMonth() + Number(nav.dataset.dpNav), 1);
    dpRender();
  } else if (day && !day.disabled) {
    dp.day = day.dataset.dpDay;
    if (dp.input.type === 'datetime-local') dpRender();
    else dpCommit();
  } else if (act) {
    const a = act.dataset.dpAct;
    if (a === 'clear') {
      dpSet('');
      dpClose();
    } else if (a === 'today') {
      const n = new Date();
      dp.day = dpKey(n);
      dp.view = new Date(n.getFullYear(), n.getMonth(), 1);
      if (dp.input.type === 'datetime-local') {
        dp.hh = pad2(n.getHours());
        dp.mm = pad2(Math.floor(n.getMinutes() / 5) * 5);
        dpRender();
      } else dpCommit();
    } else if (a === 'ok') dpCommit();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target.closest && e.target.closest('[data-dp-time]');
  if (t) dp[t.dataset.dpTime] = t.value;
});
// Fenster offen lassen, wenn man darin klickt (Fokus bleibt im Feld)
document.addEventListener('mousedown', (e) => {
  if (dp.el && dp.el.contains(e.target) && !e.target.closest('select')) e.preventDefault();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (!dp.el) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // nur den Kalender schließen, nicht das Fenster dahinter
      dpClose();
    } else if (e.key === 'Tab' && e.target === dp.input) dpClose();
  },
  true
);
window.addEventListener('resize', () => dpPlace());
document.addEventListener('scroll', () => dpPlace(), true);
