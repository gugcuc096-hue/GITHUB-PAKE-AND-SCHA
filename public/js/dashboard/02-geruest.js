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
  document.title = `${viewLabel(st.view)} | Pake & Scha`;
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
    if (!onOverlayEntry()) history.pushState({ psOverlay: 1 }, '', url);
    else if (url !== location.pathname + location.search + location.hash) history.replaceState({ psOverlay: 1 }, '', url);
  } else if (onOverlayEntry()) {
    // per X/Esc/Speichern geschlossen: den Eintrag des Fensters wieder entfernen
    st.histSkip = Date.now();
    history.back();
  }
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
const AUTO_SAVE_FIELDS = '[data-case-priority], [data-user-field], [data-ext-sort], [data-upload], [data-no-dirty], #msgRoleInsert, input[type="search"]';
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
const askDiscard = (page = false) =>
  ask(page ? 'Ihre Eingaben auf dieser Seite sind noch nicht gespeichert und gehen sonst verloren.' : 'Ihre Eingaben in diesem Fenster sind noch nicht gespeichert und gehen sonst verloren.', {
    title: 'Eingaben verwerfen?',
    confirmText: 'Verwerfen',
    cancelText: 'Weiter bearbeiten',
    danger: true,
  });
/** Zu einer anderen Seite – bei ungespeicherten Eingaben erst nachfragen. */
async function leaveTo(view) {
  if (unsavedInputs() && !(await askDiscard(true))) return;
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
  const same = key && st.modalCurrent && st.modalCurrent.key === key;
  // child: auch nach dem Absenden eines Formulars als Unterfenster öffnen (z. B. „Rechnung erstellt“ über der Akte)
  if (modal.classList.contains('open') && !st.modalRestoring && (child || !st.modalReplace) && !same) stashModal();
  st.modalCurrent = { key, reopen, wide };
  body.innerHTML = html;
  $('#modalCard').classList.toggle('wide', wide);
  modal.classList.add('open');
  modal.scrollTop = 0;
  body.scrollTop = 0;
  document.body.classList.add('modal-open');
  tickCountdowns();
  const focusTarget = $('#modalBody [autofocus]');
  if (focusTarget && window.matchMedia('(min-width: 768px)').matches) focusTarget.focus();
  scheduleHistory();
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

const loadingHtml = () =>
  `<div class="stack">${'<div class="panel panel-pad"><div class="skeleton" style="width:40%"></div><div class="skeleton mt-4"></div><div class="skeleton mt-3" style="width:70%"></div></div>'.repeat(2)}</div>`;
const errorHtml = (msg) =>
  `<div class="panel">${empty(msg || 'Daten konnten nicht geladen werden.', 'alert')}<div class="text-center pb-6"><button class="btn-outline btn-md" data-action="reload-view">Erneut versuchen</button></div></div>`;

function handleError(e) {
  if (e && e.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent('/dashboard.html' + location.search + location.hash);
    return;
  }
  toast(e?.message || 'Unbekannter Fehler.', 'error');
}
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
  content.innerHTML = loadingHtml();
  window.scrollTo(0, 0);
  const token = ++st.navToken;
  try {
    if (views[view].load) await views[view].load();
  } catch (e) {
    if (token !== st.navToken) return;
    handleError(e);
    content.innerHTML = errorHtml(e.message);
    return;
  }
  if (token !== st.navToken) return;
  renderView();
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
