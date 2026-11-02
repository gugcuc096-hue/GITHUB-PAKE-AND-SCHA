/*
 * Kanzlei-Dashboard – Teil 2 von 14: Grundgerüst: Navigation, Dialog, Routing.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Grundgerüst: Navigation, Dialog, Routing
   ================================================================ */
/* Menügruppen: Kanzlei und Board of Partners lassen sich auf- und zuklappen (im Browser gemerkt). Führt ein
 * Seitenwechsel in eine zugeklappte Gruppe, ist sie für diese Seite offen (nicht gemerkt) – und lässt sich trotzdem zuklappen, auch während man auf einer ihrer Seiten ist. */
const NAV_FOLDABLE = { Kanzlei: false, 'Board of Partners': false }; // Gruppe → anfangs zugeklappt?
/*
 * Menü-Bündel: verwandte Seiten sind ein Menüpunkt; die Seite zeigt oben Reiter zu den anderen (nur erlaubte).
 * Der Menüpunkt steht an der Stelle der ersten Seite, zählt alle zusammen und führt zur zuletzt besuchten.
 */
const NAV_HUBS = {
  inbox: { label: 'Board-Eingang', icon: 'bell', views: [['concerns-board', 'Anliegen'], ['applications', 'Bewerbungen'], ['name-requests', 'Namen'], ['reviews', 'Stimmen'], ['resolutions', 'Beschlüsse']] },
  people: { label: 'Team & Personal', icon: 'users', views: [['team', 'Team'], ['users', 'Benutzer'], ['personnel', 'Beförderungen']] },
  numbers: { label: 'Statistik & Protokoll', icon: 'chart', views: [['stats', 'Überblick'], ['work', 'Aktenbearbeitung'], ['audit', 'Protokoll']] },
  offers: { label: 'Preise & Mitglieder', icon: 'crown', views: [['vip', 'VIP & Lifetime'], ['cooperations', 'Kooperationen'], ['fees', 'Honorarordnung']] },
};
/** Bündel einer Seite (nur wenn mindestens zwei seiner Seiten erlaubt sind): { key, hub, members } */
function hubOf(view) {
  if (view === 'concerns' && concernsMerged()) view = 'concerns-board';
  for (const [key, hub] of Object.entries(NAV_HUBS)) {
    if (!hub.views.some(([k]) => k === view)) continue;
    const members = hub.views.filter(([k]) => allowed(k));
    return members.length > 1 ? { key, hub, members } : null;
  }
  return null;
}
const hubTabActive = (k) => st.view === k || (k === 'concerns-board' && st.view === 'concerns' && concernsMerged());
/** Reiter oben auf einer Seite eines Bündels. */
function hubTabs(view) {
  const h = hubOf(view);
  if (!h) return '';
  (st.hubLast || (st.hubLast = {}))[h.key] = view === 'concerns' ? 'concerns-board' : view;
  return `<div class="chip-row settings-tabs hub-tabs" role="tablist" aria-label="${esc(h.hub.label)}">${h.members
    .map(([k, l]) => {
      const n = navCount(k);
      const on = hubTabActive(k);
      return `<a href="#${k}" class="chip ${on ? 'active' : ''}" role="tab" aria-selected="${on}">${icon(VIEWS[k].icon, 'ico-sm')}<span class="tab-label" data-label="${esc(l)}">${esc(l)}</span>${n ? `<span class="nav-count">${n > 99 ? '99+' : n}</span>` : ''}</a>`;
    })
    .join('')}</div>`;
}
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
/** Schlüssel eines Menüpunkts in Einstellungen → Navigation (Bündel: „hub-…“, sonst die Seite). */
const navCfgKey = (key) => {
  const h = hubOf(key);
  return h ? `hub-${h.key}` : key;
};
function renderNav() {
  const prefs = st.navClosed || (st.navClosed = navClosedPrefs());
  const groups = []; // [{ name, items: [key] }]
  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.hidden || v.navHidden || !allowed(key)) continue;
    if (key === 'concerns' && concernsMerged()) continue; // steckt im Board-Punkt „Anliegen“
    const h = hubOf(key);
    if (h && h.members[0][0] !== key) continue; // steckt im Menüpunkt des Bündels
    const name = v.section && (!v.staffSection || isStaff()) ? v.section : groups.length ? groups[groups.length - 1].name : null;
    if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, items: [] });
    groups[groups.length - 1].items.push(key);
  }
  // Einstellungen → Navigation (je Personengruppe): ausgeblendete Punkte weg, Reihenfolge je Gruppe, eigene Namen
  const navCfg = (st.siteConfig && st.siteConfig.nav) || null;
  if (navCfg) {
    const hidden = new Set(navCfg.hidden || []);
    const rank = (k) => {
      const i = (navCfg.order || []).indexOf(k);
      return i < 0 ? 1000 : i;
    };
    groups.forEach((g) => {
      g.items = g.items.filter((k) => !hidden.has(navCfgKey(k)) || navActive(k));
      g.items = g.items.map((k, i) => [k, i]).sort((a, b) => rank(navCfgKey(a[0])) - rank(navCfgKey(b[0])) || a[1] - b[1]).map(([k]) => k);
    });
    for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].items.length) groups.splice(i, 1);
  }
  const navLabel = (key, fallback) => (navCfg && navCfg.labels && navCfg.labels[navCfgKey(key)]) || fallback;
  // Menüpunkt eines Bündels: aktiv bzw. Zähler über alle seine Seiten
  const itemActive = (key) => (hubOf(key) ? hubOf(key).members.some(([k]) => hubTabActive(k)) : navActive(key));
  const itemCount = (key) => (hubOf(key) ? hubOf(key).members.reduce((n, [k]) => n + navCount(k), 0) : navCount(key));
  const item = (key) => {
    const h = hubOf(key);
    if (h) {
      // Bündel: ein Punkt für alle seine Seiten
      const count = itemCount(key);
      const active = itemActive(key);
      const target = (st.hubLast && st.hubLast[h.key]) || h.members[0][0];
      return `<a href="#${target}" class="nav-item ${active ? 'active' : ''}" data-hub="${h.key}" ${active ? 'aria-current="page"' : ''}>${icon(h.hub.icon)}<span>${esc(navLabel(key, h.hub.label))}</span>${count ? `<span class="nav-count">${count > 99 ? '99+' : count}</span>` : ''}</a>`;
    }
    const v = VIEWS[key];
    const count = navCount(key);
    const active = navActive(key);
    const label = navLabel(key, isBoard() && v.navLabel ? v.navLabel : viewLabel(key));
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
    if (st.navOpenedFor !== st.view && g.items.some(itemActive) && navGroupClosed(prefs, g.name)) temp[g.name] = st.view;
    const closed = navGroupClosed(prefs, g.name) && temp[g.name] !== st.view;
    const total = g.items.reduce((n, k) => n + itemCount(k), 0);
    html += `<button type="button" class="nav-section nav-toggle" data-action="nav-group" data-group="${esc(g.name)}" aria-expanded="${!closed}" aria-controls="navGroup${i}">
        <span>${esc(g.name)}</span>${closed && total ? `<span class="nav-count">${total > 99 ? '99+' : total}</span>` : ''}${icon('chevronDown', 'ico-sm nav-chev')}</button>
      <div class="nav-group" id="navGroup${i}" ${closed ? 'hidden' : ''}>${items}</div>`;
  });
  // Unten: Einstellungen (Zahnrad, inkl. Systemzustand) und Mein Profil – nicht als eigene Menügruppe
  const foot = [['settings', ['settings', 'system']], ['profile', ['profile']]]
    .filter(([k]) => allowed(k))
    .map(([k, views]) => {
      const active = views.includes(st.view);
      return `<a href="#${k}" class="nav-item nav-foot-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${icon(VIEWS[k].icon)}<span>${esc(viewLabel(k))}</span></a>`;
    })
    .join('');
  // Eigene Links (Einstellungen → Navigation), z. B. Discord-Server oder Wiki – öffnen in einem neuen Tab
  const links = navCfg && navCfg.links && navCfg.links.length
    ? `<div class="nav-section">Links</div>${navCfg.links
        .map((l) => `<a href="${esc(l.url)}" class="nav-item nav-ext" target="_blank" rel="noopener">${icon('external')}<span>${esc(l.label)}</span></a>`)
        .join('')}`
    : '';
  $('#nav').innerHTML = html + links + (foot ? `<div class="nav-foot">${foot}</div>` : '');
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
  // Handy: Uhr (Stempeluhr) mit Statuspunkt statt eines einzelnen Punkts; PC: Punkt und Text
  btn.innerHTML = `<span class="duty-ico" aria-hidden="true">${icon('clock', 'ico-sm')}<span class="duty-dot s-${s}"></span></span><span class="duty-dot duty-dot-main s-${s}"></span><span class="lbl">${esc(DUTY[s])}</span>`;
  btn.title = `Dienststatus: ${DUTY[s]}`;
  btn.setAttribute('aria-label', btn.title);
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
  if (!wasOpen) {
    // Ursprung merken: beim Schließen zieht sich das Fenster dorthin zurück (morphRow)
    const t = st.trigger && Date.now() - st.trigger.at < 1500 ? st.trigger.el : null;
    st.modalOrigin = t ? { el: t, sel: t.dataset.id ? `#content [data-action="${t.dataset.action}"][data-id="${t.dataset.id}"]` : null } : null;
  }
  if (!wasOpen && (st.morphFrom || triggerRect())) morphOpen(st.morphFrom || triggerRect());
  st.morphFrom = null;
  // Fensterwechsel (neues Fenster über dem alten, Zurück, Inhalt nach dem Laden): weich statt hart
  if (wasOpen) {
    body.classList.remove('swap-in', 'swap-back');
    playIn(body, st.modalStack.length ? 'swap-fwd' : 'swap-in');
  }
  // Neu geöffnet: Abschnitte blenden gestaffelt ein (der Aktenkopf fliegt schon aus der Zeile), Zahlen zählen hoch
  else {
    playIn(body, 'modal-stagger');
    // nur dieses eine Mal – späteres Neuzeichnen (Live-Updates) soll nicht erneut einblenden
    clearTimeout(st.staggerTimer);
    st.staggerTimer = setTimeout(() => body.classList.remove('modal-stagger'), 650);
  }
  window.PS.countUp(body);
  modal.scrollTop = 0;
  body.scrollTop = 0;
  document.body.classList.add('modal-open');
  tickCountdowns();
  hidePendingDeletes();
  const focusTarget = $('#modalBody [autofocus]');
  if (focusTarget && window.matchMedia('(min-width: 768px)').matches) focusTarget.focus();
  scheduleHistory();
  syncDepth();
}
/** Unterfenster: das vorherige Fenster schimmert als Kante hinter dem Blatt (motion.css). */
const syncDepth = () => $('#modalCard')?.classList.toggle('is-stacked', st.modalStack.length > 0);
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
  const list = { rows, render, pos: LIST_PAGE, cols };
  moreLists.set(id, list);
  virtualLists.set(id, list);
  queueMicrotask(watchMoreRows);
  return rows.slice(0, LIST_PAGE).map(render).join('') + moreRowHtml(id, rows.length - LIST_PAGE, cols);
}
/**
 * Zeichnet die Einträge [k * LIST_PAGE, …) als Elemente der Liste id, jedes mit der Nummer k seines Abschnitts
 * (für das Zusammenklappen weit entfernter Abschnitte, siehe unten).
 */
function chunkNodes(list, id, k) {
  const tpl = document.createElement('template');
  tpl.innerHTML = list.rows.slice(k * LIST_PAGE, (k + 1) * LIST_PAGE).map(list.render).join('');
  const nodes = [...tpl.content.children];
  nodes.forEach((n) => {
    n.dataset.vl = id;
    n.dataset.vk = String(k);
  });
  return nodes;
}
/** Nächste Einträge einer Liste anhängen. */
function showMoreRows(id) {
  const list = moreLists.get(id);
  const marker = document.querySelector(`[data-more="${id}"]`);
  if (!list || !marker) return;
  const k = Math.floor(list.pos / LIST_PAGE);
  list.pos = Math.min(list.rows.length, list.pos + LIST_PAGE);
  marker.before(...chunkNodes(list, id, k));
  virtualLists.set(id, list);
  const left = list.rows.length - list.pos;
  if (left > 0) marker.outerHTML = moreRowHtml(id, left, list.cols);
  else {
    marker.remove();
    moreLists.delete(id);
  }
  watchMoreRows();
  virtualTick();
}

/*
 * Listen virtuell zeichnen: Ist eine lange Liste weit heruntergescrollt, werden Abschnitte (je LIST_PAGE Einträge)
 * weit außerhalb des Sichtbereichs durch einen leeren Platzhalter gleicher Höhe ersetzt – die Seite behält ihre Länge
 * und Scrollposition, hat aber nur noch wenige hundert statt tausender Elemente. Kommt man zurück, werden sie wieder
 * gezeichnet. Der erste Abschnitt bleibt immer stehen.
 */
const VIRTUAL_FAR = 2400; // Abstand zum Sichtbereich in Pixeln, ab dem ein Abschnitt zusammengeklappt wird
const virtualLists = new Map(); // Kennung → Liste (auch, wenn sie vollständig gezeichnet ist)
function virtualGap(list, id, k, height) {
  const gap = document.createElement(list.cols ? 'tr' : 'div');
  gap.className = 'v-gap';
  gap.dataset.vl = id;
  gap.dataset.vgap = String(k);
  gap.setAttribute('aria-hidden', 'true');
  if (list.cols) gap.innerHTML = `<td colspan="${list.cols}"></td>`;
  gap.style.height = `${Math.max(0, Math.round(height))}px`;
  return gap;
}
let virtualFrame = 0;
function virtualTick() {
  if (virtualFrame) return;
  virtualFrame = requestAnimationFrame(() => {
    virtualFrame = 0;
    const vh = window.innerHeight;
    for (const [id, list] of virtualLists) {
      if (!document.querySelector(`[data-vl="${id}"]`)) {
        virtualLists.delete(id); // Liste ist nicht mehr auf der Seite
        continue;
      }
      if (list.pos <= LIST_PAGE * 3) continue;
      for (let k = 1; k * LIST_PAGE < list.pos; k++) {
        const gap = document.querySelector(`[data-vgap="${k}"][data-vl="${id}"]`);
        if (gap) {
          const r = gap.getBoundingClientRect();
          if (r.bottom > -VIRTUAL_FAR && r.top < vh + VIRTUAL_FAR) gap.replaceWith(...chunkNodes(list, id, k)); // wieder in Reichweite
          continue;
        }
        const els = document.querySelectorAll(`[data-vk="${k}"][data-vl="${id}"]`);
        if (!els.length) continue;
        const top = els[0].getBoundingClientRect().top;
        const bottom = els[els.length - 1].getBoundingClientRect().bottom;
        if (bottom < -VIRTUAL_FAR || top > vh + VIRTUAL_FAR) {
          els[0].replaceWith(virtualGap(list, id, k, bottom - top));
          for (let i = 1; i < els.length; i++) els[i].remove();
        }
      }
    }
  });
}
window.addEventListener('scroll', virtualTick, { capture: true, passive: true });
window.addEventListener('resize', virtualTick, { passive: true });
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
  body.classList.remove('modal-stagger');
  const modal = $('#modal');
  const y1 = body.scrollTop;
  const y2 = modal.scrollTop;
  body.innerHTML = html;
  body.scrollTop = y1;
  modal.scrollTop = y2;
  tickCountdowns();
  hidePendingDeletes();
  window.PS.countUp(body, { ms: 600 }); // geänderte Zahlen (Strafmaß, Summen) laufen zum neuen Wert
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
/*
 * Jedes Fenster wächst aus dem Knopf oder der Zeile hervor, die es geöffnet hat (nicht nur Akten): Der letzte Klick auf
 * etwas mit data-action wird kurz gemerkt; öffnet sich danach ein Fenster, nimmt es dessen Rechteck als Ausgangspunkt.
 */
document.addEventListener(
  'click',
  (e) => {
    const el = e.target.closest && e.target.closest('[data-action]');
    st.trigger = el && !el.closest('#nav, #bottomNav, #modal, #sidebar') && !/^(close|modal-back|nav-)/.test(el.dataset.action) ? { rect: el.getBoundingClientRect(), at: Date.now(), el } : null;
  },
  true
);
function triggerRect() {
  const t = st.trigger;
  if (!t || Date.now() - t.at > 1500 || !morphOk()) return null;
  const r = t.rect;
  return r && r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight ? r : null;
}
function morphOpen(rect) {
  const modal = $('#modal');
  const card = $('#modalCard');
  if (!morphOk()) return;
  // Eigenes Einblenden des Fensters aus (app.css) – bis zum Schließen: Fiele die Klasse am Ende der Animation weg,
  // spielte das Fenster sein normales Einblenden noch einmal ab (kurzes Flackern)
  modal.classList.add('morphing');
  card.animate([{ clipPath: morphClip(card, rect), opacity: 0.6 }, { clipPath: 'inset(0px 0px 0px 0px round 20px)', opacity: 1 }], { duration: MORPH_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  // Aktenzeichen und Titel fliegen aus der Zeile an ihren Platz im Aktenkopf
  const parts = st.morphParts || {};
  [
    [parts.num, $('#modalBody .case-num-row .font-mono')],
    [parts.title, $('#modalTitle')],
  ].forEach(([from, el]) => {
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    if (!to.height) return;
    const s = Math.min(1, from.height / to.height);
    el.animate([{ transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})` }, { transformOrigin: '0 0', transform: 'none' }], {
      duration: MORPH_MS + 60,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
  });
}
/**
 * Wohin sich das Fenster beim Schließen zurückzieht: die Zeile der offenen Akte – sonst der Knopf, die Karte oder Zeile,
 * aus der es hervorgewachsen ist (überall, nicht nur bei Akten). Nur, wenn sie noch da und zu sehen ist.
 */
function morphRow() {
  let row = st.modalCaseId && document.querySelector(`#content [data-action="open-case"][data-id="${st.modalCaseId}"]`);
  const o = st.modalOrigin;
  if (!row && o) {
    row = o.el && o.el.isConnected ? o.el : o.sel ? document.querySelector(o.sel) : null;
    if (row && row.closest('#modal, .modal-ghost')) row = null;
  }
  if (!row || !morphOk()) return null;
  const r = row.getBoundingClientRect();
  return r.height && r.bottom > 0 && r.top < window.innerHeight ? r : null;
}
/** Openers: Akten-Zeile merken, aus der das Fenster hervorwachsen soll. */
function openCaseFrom(el) {
  st.morphFrom = morphOk() && !$('#modal').classList.contains('open') ? el.getBoundingClientRect() : null;
  // Aktenzeichen und Titel der Zeile (fliegen in den Aktenkopf)
  const rect = (sel) => {
    const n = st.morphFrom && el.querySelector(sel);
    return n ? n.getBoundingClientRect() : null;
  };
  st.morphParts = { num: rect('.font-mono'), title: rect('.font-medium, .title') };
  return openCase(Number(el.dataset.id)).finally(() => (st.morphFrom = st.morphParts = null));
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
  ghost.removeAttribute('data-readbar');
  ghost.querySelectorAll('[data-readbar]').forEach((n) => n.removeAttribute('data-readbar')); // die Hülle, die ausblendet, zeigt keine Lesefortschritts-Linie
  window.PS.readBarOff();
  ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  ghost.classList.remove('open', 'morphing');
  ghost.classList.add('modal-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  document.body.appendChild(ghost);
  ghost.scrollTop = modal.scrollTop;
  if (ghostBody && body) ghostBody.scrollTop = body.scrollTop;
  // Neue Akte: das Formular bleibt stehen, bis es in seine Zeile fliegt (landInRow, 13-bewegung.js) – spätestens 3 s
  if (st.ghostHold) {
    st.ghostHold = false;
    ghost.classList.add('ghost-hold');
    st.heldGhost = ghost;
    setTimeout(() => ghost.remove(), 3000);
    return;
  }
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
  $('#modalCard')?.classList.remove('is-stacked');
  st.modalCurrent = null;
  const modal = $('#modal');
  if (!modal.classList.contains('open')) return;
  window.PS.readBarOff();
  docPeekClose({ fly: false });
  scheduleHistory();
  fadeOutModal(modal, { morph });
  modal.classList.remove('open', 'morphing');
  $('#modalBody').innerHTML = '';
  document.body.classList.remove('modal-open');
  st.modalCaseId = null;
  st.modalAppId = null;
  st.modalConcernId = null;
  st.returnCase = null;
  st.modalOrigin = null;
  // Die Seite dahinter wurde zurückgestellt (siehe renderView): jetzt einmal weich nachzeichnen
  if (st.behindDirty) {
    const token = st.navToken;
    setTimeout(() => {
      if (st.behindDirty && token === st.navToken && !$('#modal.open') && views[st.view]) renderView();
    }, 0);
  }
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
  const flyBack = lightboxLeave(); // Großansicht eines Beweisbilds: fliegt zurück in ihr Vorschaubild
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
    body.classList.remove('swap-in', 'swap-fwd');
    playIn(body, 'swap-back');
    Object.assign(st, prev.state);
    st.modalCurrent = { key: prev.key || null, reopen: null, wide: !!prev.wide };
    $('#modalCard').classList.toggle('wide', !!prev.wide);
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    tickCountdowns();
    scheduleHistory();
  }
  syncDepth();
  restoreModalScroll(prev.scroll);
  if (flyBack) flyBack();
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
  // Umrisse je nach Ansicht: Kalender als Monatsraster, Post zweispaltig, Akten/Listen mit Filterleiste und Zeilen
  const body =
    view === 'calendar'
      ? `<div class="panel panel-pad"><div class="skel-grid">${Array.from({ length: 35 }, () => '<div class="skel-cell"></div>').join('')}</div></div>`
      : view === 'mail'
        ? `<div class="skel-split"><div class="panel panel-pad">${['70%', '55%', '64%', '48%'].map(row).join('')}</div><div class="panel panel-pad">${line('60%', 'skel-title')}${line('90%', 'mt-4')}${line('82%', 'mt-3')}${line('88%', 'mt-3')}${line('40%', 'mt-3')}</div></div>`
        : ['cases', 'clients', 'tasks', 'invoices'].includes(view)
          ? `<div class="skel-pills">${['86px', '110px', '96px', '120px'].map((w) => line(w, 'skel-pill')).join('')}</div><div class="panel panel-pad">${['72%', '58%', '66%', '50%', '62%', '56%', '68%'].map(row).join('')}</div>`
          : `<div class="panel panel-pad">${['72%', '58%', '66%', '50%', '62%'].map(row).join('')}</div>`;
  return `<div class="skel-page" aria-busy="true"><p class="sr-only" role="status">Wird geladen …</p>
      <div class="page-head"><div class="flex-1">${line('min(320px, 60%)', 'skel-title')}${line('min(460px, 85%)', 'mt-3')}</div></div>
      ${kpis}
      ${body}
    </div>`;
}
const errorHtml = (msg) =>
  `<div class="panel">${empty(msg || 'Daten konnten nicht geladen werden.', 'alert', nextStep('Erneut versuchen', 'reload-view', {}, 'refresh'))}</div>`;

function handleError(e) {
  if (e && e.status === 401) {
    location.href = '/login?next=' + encodeURIComponent('/dashboard' + location.search + location.hash);
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

/** Seite wechseln – aus einer Kachel bzw. einem Menüpunkt mit Übergang in die Überschrift (13-bewegung.js). */
function go(view) {
  const hero = takeHero(view);
  return hero ? heroGo(hero, () => goNow(view)) : goNow(view);
}
async function goNow(view) {
  if (!allowed(view)) view = 'overview';
  if (view !== 'invoice-new') st.invoiceFrom = null; // Rechnung aus einer Akte: Rückweg gilt nur bis zum Verlassen der Seite
  // Richtung des Seitenwechsels: weiter unten im Menü = von rechts, zurück = von links (motion.css)
  const order = Object.keys(VIEWS);
  const dir = order.indexOf(view) >= order.indexOf(st.view) ? 'fwd' : 'back';
  $('#content').dataset.dir = dir;
  // Wechsel innerhalb eines Bereichs (z. B. Überblick → Protokoll): Leiste und Überschrift bleiben stehen, nur der Inhalt
  // wechselt; die Höhe gleitet zur neuen Seite
  const hubFrom = hubOf(st.view);
  const hubTo = hubOf(view);
  const sameHub = !!(hubFrom && hubTo && hubFrom.key === hubTo.key && st.view !== view);
  $('#content').dataset.hubSwitch = sameHub ? '1' : '';
  const h0 = sameHub ? $('#content').offsetHeight : 0;
  // Scrollstand der verlassenen Seite merken; bei Zurück/Vor steht die Seite dort wieder, wo man sie verlassen hat
  (st.scrollMemo || (st.scrollMemo = {}))[st.view] = window.scrollY;
  const restore = st.restoreScroll ? st.scrollMemo[view] || 0 : 0;
  st.restoreScroll = false;
  st.view = view;
  closeModal();
  closeSidebar();
  closeDutyPop();
  const content = $('#content');
  // Das Menü reagiert sofort auf den Klick. Mit Überblendung (13-weich.js) bleibt die alte Seite stehen, bis die neue fertig ist:
  // der Scrollstand wechselt erst dann
  renderNav();
  // Die erste Seite nach dem Öffnen wird nicht überblendet (es gibt nichts Altes) – so ist sie sofort bedienbar
  const smooth = !!st.firstPainted && wchCan();
  if (!smooth) window.scrollTo(0, 0);
  const token = ++st.navToken;
  const paint = async (extra) => {
    const draw = () => {
      if (token !== st.navToken) return;
      if (smooth) content.classList.remove('view-in'); // die Überblendung ersetzt die gestaffelte Einblendung (sonst liefe beides)
      renderView();
      window.scrollTo(0, restore); // nach dem Zeichnen: die Seite hat jetzt ihre Höhe
      if (!smooth) playIn(content, 'view-in');
      growBars(content);
      if (!smooth && sameHub) heightGlide(content, h0);
      if (extra) extra();
    };
    if (smooth) await wchSwap(draw);
    else draw();
  };
  const seen = st.seenViews || (st.seenViews = new Set());
  // Schon einmal geladen: sofort mit dem letzten Stand zeigen und im Hintergrund auffrischen (kein Warten beim Menüwechsel).
  // Formularseiten nicht – dort sollen keine Eingaben unter den Fingern neu gezeichnet werden.
  if (seen.has(view) && !INSTANT_SKIP.has(view)) {
    let shown = null;
    try {
      shown = views[view].render();
      await paint();
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
  let skeleton = '';
  const slow = setTimeout(() => {
    if (token !== st.navToken) return;
    if (smooth) window.scrollTo(0, 0);
    const bar = sameHub ? $('#content > .hub-tabs') : null; // Leiste des Bereichs bleibt beim Laden stehen
    skeleton = loadingHtml(view);
    content.innerHTML = skeleton;
    if (bar) (content.firstElementChild ? content.firstElementChild.after(bar) : content.prepend(bar));
  }, 120);
  try {
    // beim Drüberfahren schon vorgeladen? Dann nur noch auf dieses Laden warten (meist ist es fertig)
    const pre = viewPrefetch.get(view);
    viewPrefetch.delete(view);
    if (views[view].load) await (pre && Date.now() - pre.at < VIEW_PREFETCH_MS ? pre.promise : views[view].load());
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
  await paint(() => {
    if (skeleton && !smooth) skeletonFade(content, skeleton); // Platzhalter blendet aus, während der Inhalt einblendet
  });
}
const INSTANT_SKIP = new Set(['invoice-new', 'settings', 'profile']);

/*
 * Menüpunkt vorladen: Fährt die Maus über einen Menüpunkt (am Handy: beim Antippen), lädt die Seite schon – der Klick
 * zeigt sie dann ohne Wartezeit, auch beim ersten Besuch. Schon besuchte Seiten erscheinen ohnehin sofort.
 */
const viewPrefetch = new Map(); // view → { at, promise }
const VIEW_PREFETCH_MS = 10000;
function prefetchView(view) {
  if (!st.user || !views[view] || !views[view].load || view === st.view || !allowed(view) || INSTANT_SKIP.has(view)) return;
  if (st.seenViews && st.seenViews.has(view)) return;
  const hit = viewPrefetch.get(view);
  if (hit && Date.now() - hit.at < VIEW_PREFETCH_MS) return;
  const promise = Promise.resolve().then(() => views[view].load());
  promise.catch(() => viewPrefetch.get(view)?.promise === promise && viewPrefetch.delete(view));
  viewPrefetch.set(view, { at: Date.now(), promise });
}
let viewPrefetchTimer = 0;
const navTarget = (e) => {
  const a = e.target.closest && e.target.closest('a.nav-item[href^="#"], a.bn-item[href^="#"]');
  return a ? decodeURIComponent(a.getAttribute('href').slice(1)) : null;
};
document.addEventListener('pointerover', (e) => {
  const view = navTarget(e);
  if (!view) return;
  clearTimeout(viewPrefetchTimer);
  viewPrefetchTimer = setTimeout(() => prefetchView(view), e.pointerType === 'mouse' ? 80 : 0);
});
document.addEventListener('pointerout', (e) => navTarget(e) && clearTimeout(viewPrefetchTimer));
document.addEventListener('pointerdown', (e) => {
  const view = navTarget(e);
  if (view) prefetchView(view);
});
/**
 * Bereichs-Reiter beim Neuzeichnen behalten: Hat die neue Seite dieselbe Leiste (gleicher Bereich, gleiche Reiter),
 * bleibt die bisherige stehen und übernimmt nur Auswahl und Zahlen – sie flackert nicht, und Strich, Farbe und
 * Schriftstärke gleiten zum neuen Reiter.
 */
function hubBarKeep(oldBar, fresh) {
  if (!oldBar || !fresh || oldBar === fresh || oldBar.getAttribute('aria-label') !== fresh.getAttribute('aria-label')) return;
  const a = [...oldBar.children].filter((c) => c.matches('a'));
  const b = [...fresh.children].filter((c) => c.matches('a'));
  if (a.length !== b.length || a.some((el, i) => el.getAttribute('href') !== b[i].getAttribute('href'))) return;
  a.forEach((el, i) => {
    if (el.innerHTML !== b[i].innerHTML) el.innerHTML = b[i].innerHTML; // Zahl geändert
    el.className = b[i].className;
    el.setAttribute('aria-selected', b[i].getAttribute('aria-selected') || 'false');
  });
  oldBar.querySelectorAll(':scope > .tab-ink').forEach((x) => x.remove());
  oldBar.classList.remove('ink-gliding');
  fresh.replaceWith(oldBar);
  tabInk(oldBar);
}
/** Höhe gleitet vom alten zum neuen Stand (Reiterwechsel) statt zu springen. */
function heightGlide(el, h0) {
  if (!el || !h0 || window.PS.motion.calm() || typeof Element.prototype.animate !== 'function') return;
  const h1 = el.offsetHeight;
  if (Math.abs(h1 - h0) < 12) return;
  el.style.overflow = 'clip';
  const a = el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: Math.min(420, 220 + Math.abs(h1 - h0) / 8), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  const done = () => (el.style.overflow = '');
  a.finished.then(done, done);
}
/** Ladeplatzhalter weich ausblenden, während der echte Inhalt erscheint (statt hartem Austausch). */
function skeletonFade(content, html) {
  if (window.PS.motion.calm()) return;
  const ov = document.createElement('div');
  ov.className = 'skel-fade';
  ov.setAttribute('aria-hidden', 'true');
  ov.inert = true;
  ov.innerHTML = html;
  content.append(ov);
  const bye = () => ov.remove();
  setTimeout(bye, 400);
}
/** Sanft einblenden (Seitenwechsel, neues Fenster) – nicht bei jedem Neuzeichnen, sonst flackert es. */
function playIn(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // Animation neu starten
  el.classList.add(cls);
}
/*
 * Solange ein Fenster (z. B. eine Akte) offen ist, bleibt die Seite dahinter ruhig: Sie wird nicht bei jeder Änderung im
 * Fenster neu gezeichnet (das sah man durch den abgedunkelten Hintergrund als Neuladen). Stattdessen wird das Neuzeichnen
 * vorgemerkt und beim Schließen des Fensters einmal nachgeholt – dann gleiten die Zeilen weich an ihren neuen Platz.
 * { force: true } zeichnet trotzdem sofort (z. B. wenn das Fenster nichts mit der Seite dahinter zu tun hat).
 */
function renderView({ force = false } = {}) {
  if (!force && $('#modal.open')) {
    st.behindDirty = true;
    return;
  }
  st.behindDirty = false;
  const before = flipSnapshot(); // Positionen der Zeilen vor dem Neuzeichnen (weiches Umsortieren)
  document.body.toggleAttribute('data-readbar', st.view === 'wiki'); // Lesefortschritt in langen Wiki-Artikeln
  window.PS.readBarOff();
  const oldBar = $('#content > .hub-tabs'); // Reiter des Bereichs: bleiben stehen, damit der Goldstrich gleiten kann
  $('#content').innerHTML = views[st.view].render();
  heroLand(); // aus einer Kachel bzw. einem Menüpunkt: die neue Überschrift fliegt von dort an ihren Platz
  flipPlay(before);
  markChangedBadges($('#content'));
  // Seite eines Bündels: Reiter unter der Überschrift
  const tabs = hubTabs(st.view);
  if (tabs) ($('#content > .page-head') || $('#content').firstElementChild)?.insertAdjacentHTML($('#content > .page-head') ? 'afterend' : 'beforebegin', tabs);
  hubBarKeep(oldBar, $('#content > .hub-tabs'));
  renderNav();
  tickCountdowns();
  hidePendingDeletes();
  window.PS.countUp($('#content')); // Kennzahlen zählen hoch (erstes Erscheinen bzw. bei Änderung)
  window.PS.roll($('#content')); // Zählwerk (Lager): Ziffern rollen zum neuen Stand
  st.firstPainted = true;
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
      st.restoreScroll = true;
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
  const flash = live.flash;
  live.flash = false;
  try {
    const before = flash ? liveSnap($('#content')) : null;
    if (views[st.view].load) await views[st.view].load();
    if ($('#modal.open')) {
      st.behindDirty = true; // die Daten sind frisch, gezeichnet wird beim Schließen des Fensters
      return;
    }
    renderView();
    if (before) liveFlash($('#content'), before, '');
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
  const text = `Login: ${location.origin}/login\nE-Mail: ${cred.email}\nEinmal-Passwort: ${cred.password}`;
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
 * Freitext-Feld mit eigener Vorschlagsliste im Stil der Auswahllisten (statt des Browser-Elements „datalist“, das sich nicht gestalten lässt).
 * Tippen filtert, Pfeiltasten wählen, Enter übernimmt, Esc schließt – eigener Text bleibt erlaubt.
 */
function comboField({ id, name, value = '', options = [], maxlength = 120, placeholder = '', attrs = '' }) {
  return `<div class="combo">
      <input id="${esc(id)}" name="${esc(name)}" class="field combo-input" maxlength="${maxlength}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"
        autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(id)}List" data-combo ${attrs}>
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

/* ---------------------------------------------------------------- Kalender, Uhrzeit und Farbe für Felder */
/**
 * Eigene Auswahl im Stil der Kanzlei für alle Datums-, Termin-, Uhrzeit- und Farbfelder (input type="date" / "datetime-local" /
 * "time" mit Klasse field, sowie type="color"). Die Felder bleiben echte Felder (gleicher Wert, Tippen am PC geht weiter) – nur das
 * Aufklapp-Fenster ist unseres (die des Browsers lassen sich nicht gestalten, auch ihre Leisten nicht).
 * Datum: Tag anklicken = übernommen. Termin: Tag + Uhrzeit wählen, „Übernehmen“. Uhrzeit: Stunde + Minute wählen, „Übernehmen“.
 * Bewegung: Monate gleiten, der goldene Tag-Rahmen wandert von Tag zu Tag, Uhrzeit-Spalten rollen zum Wert.
 */
const DP_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DP_SEL = 'input.field[type="date"], input.field[type="datetime-local"], input.field[type="time"]';
const CP_SEL = 'input[type="color"]';
const pad2 = (n) => String(n).padStart(2, '0');
const dpKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dp = { el: null, input: null, view: null, day: '', hh: '', mm: '' };
const dpKind = (input) => (input.type === 'datetime-local' ? 'dt' : input.type === 'time' ? 'time' : 'date');
const dpMotion = () => !window.PS.motion.calm() && typeof Element.prototype.animate === 'function';
const DP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function dpParse(input) {
  if (input.type === 'time') {
    const [hh = '', mm = ''] = String(input.value || '').split(':');
    return { date: '', hh, mm: mm.slice(0, 2) };
  }
  const [date, time = ''] = String(input.value || '').split('T');
  const [hh = '', mm = ''] = time.split(':');
  return { date, hh, mm };
}

/** Die 42 Tage (sechs Wochen, Montag zuerst) des gezeigten Monats. */
function dpGridHtml() {
  const input = dp.input;
  const min = String(input.min || '').slice(0, 10);
  const max = String(input.max || '').slice(0, 10);
  const y = dp.view.getFullYear();
  const m = dp.view.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const today = dpKey(new Date());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const cell = (d) => {
    const k = dpKey(d);
    const off = (min && k < min) || (max && k > max);
    return `<button type="button" class="dp-day${d.getMonth() !== m ? ' out' : ''}${k === today ? ' today' : ''}${k === dp.day ? ' sel' : ''}" data-dp-day="${k}" ${off ? 'disabled' : ''} aria-label="${d.getDate()}. ${DP_MONTHS[d.getMonth()]} ${d.getFullYear()}">${d.getDate()}</button>`;
  };
  return `<i class="dp-ring" aria-hidden="true"></i>${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span class="dp-wd">${w}</span>`).join('')}${days.map(cell).join('')}`;
}

/** Stunden- und Minutenspalte: Stunden einzeln, Minuten in Fünferschritten (ein anderer Wert bleibt zusätzlich stehen). */
function dpTimeHtml() {
  const mins = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
  if (dp.mm && !mins.includes(dp.mm)) mins.push(dp.mm), mins.sort();
  const items = (list, kind, cur) => list.map((x) => `<button type="button" class="dp-tv${x === cur ? ' sel' : ''}" data-dp-${kind}="${x}" aria-label="${kind === 'hh' ? 'Stunde' : 'Minute'} ${x}">${x}</button>`).join('');
  return `<div class="dp-time"><span class="dp-time-label">${icon('clock', 'ico-sm')}Uhrzeit</span>
      <div class="dp-cols"><div class="dp-col" data-dp-col="hh" role="listbox" aria-label="Stunde">${items(Array.from({ length: 24 }, (_, h) => pad2(h)), 'hh', dp.hh)}</div>
      <span class="dp-colon">:</span>
      <div class="dp-col" data-dp-col="mm" role="listbox" aria-label="Minute">${items(mins, 'mm', dp.mm)}</div></div></div>`;
}

function dpRender() {
  const input = dp.input;
  const kind = dpKind(input);
  const m = dp.view.getMonth();
  const y = dp.view.getFullYear();
  dp.el.innerHTML = `
    ${
      kind === 'time'
        ? ''
        : `<div class="dp-head">
      <button type="button" class="dp-nav" data-dp-nav="-1" aria-label="Voriger Monat">${icon('chevronLeft', 'ico-sm')}</button>
      <div class="dp-title" aria-live="polite">${DP_MONTHS[m]} ${y}</div>
      <button type="button" class="dp-nav" data-dp-nav="1" aria-label="Nächster Monat">${icon('chevronRight', 'ico-sm')}</button>
    </div>
    <div class="dp-body"><div class="dp-grid">${dpGridHtml()}</div></div>`
    }
    ${kind === 'date' ? '' : dpTimeHtml()}
    <div class="dp-foot">
      <button type="button" class="btn-ghost btn-sm" data-dp-act="today">${kind === 'date' ? 'Heute' : 'Jetzt'}</button>
      ${input.required ? '' : '<button type="button" class="btn-ghost btn-sm" data-dp-act="clear">Leeren</button>'}
      ${kind === 'date' ? '' : '<button type="button" class="btn-gold btn-sm" data-dp-act="ok">Übernehmen</button>'}
    </div>`;
  dpRing(false);
  dpScrollCols(false);
  dpPlace();
}

/** Goldener Rahmen unter dem gewählten Tag – gleitet beim Wechsel von Tag zu Tag. */
function dpRing(animate) {
  const grid = dp.el && dp.el.querySelector('.dp-grid:not(.dp-leave)');
  const ring = grid && grid.querySelector('.dp-ring');
  if (!ring) return;
  const sel = grid.querySelector('.dp-day.sel');
  if (!sel) {
    ring.style.opacity = '0';
    return;
  }
  ring.style.transition = animate && dpMotion() ? '' : 'none';
  ring.style.opacity = '1';
  ring.style.width = `${sel.offsetWidth}px`;
  ring.style.height = `${sel.offsetHeight}px`;
  ring.style.transform = `translate(${sel.offsetLeft}px, ${sel.offsetTop}px)`;
  if (!animate) void ring.offsetWidth; // ohne Übergang setzen, dann wieder freigeben
  if (!animate) ring.style.transition = '';
}

/** Spalten auf den gewählten Wert rollen (beim Öffnen sofort, danach weich). */
function dpScrollCols(smooth) {
  if (!dp.el) return;
  dp.el.querySelectorAll('.dp-col').forEach((col) => {
    const sel = col.querySelector('.dp-tv.sel');
    if (!sel) return;
    const top = sel.offsetTop - (col.clientHeight - sel.offsetHeight) / 2;
    if (smooth && dpMotion()) col.scrollTo({ top, behavior: 'smooth' });
    else col.scrollTop = top;
  });
}

/** Monat wechseln: das alte Raster gleitet hinaus, das neue herein; der Titel rollt mit. */
function dpMonth(dir, to) {
  if (!dp.el) return;
  const body = dp.el.querySelector('.dp-body');
  const title = dp.el.querySelector('.dp-title');
  if (!body || !title) return;
  dp.view = to || new Date(dp.view.getFullYear(), dp.view.getMonth() + dir, 1);
  title.textContent = `${DP_MONTHS[dp.view.getMonth()]} ${dp.view.getFullYear()}`;
  const old = body.querySelector('.dp-grid:not(.dp-leave)');
  const fresh = document.createElement('div');
  fresh.className = 'dp-grid';
  fresh.innerHTML = dpGridHtml();
  if (!dpMotion() || !old) {
    (old || body).replaceWith(fresh);
    dpRing(false);
    return;
  }
  body.append(fresh);
  old.classList.add('dp-leave');
  old.inert = true;
  // Das hinausgleitende Raster ist nur noch Bild: seine Tage zählen nicht mehr als Tage (Suche, Tastatur, Vorlesen)
  old.setAttribute('aria-hidden', 'true');
  old.querySelectorAll('.dp-day').forEach((b) => {
    b.classList.replace('dp-day', 'dp-gd');
    b.removeAttribute('data-dp-day');
  });
  const slide = dir || 1;
  old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-slide * 34}px)`, opacity: 0 }], { duration: 240, easing: DP_EASE }).finished.then(() => old.remove(), () => old.remove());
  fresh.animate([{ transform: `translateX(${slide * 34}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: DP_EASE });
  title.animate([{ transform: `translateX(${slide * 14}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: DP_EASE });
  dpRing(false);
}

/** Tag wählen, ohne das Fenster neu zu zeichnen (der Rahmen gleitet). */
function dpPick(day) {
  dp.day = day;
  const grid = dp.el.querySelector('.dp-grid:not(.dp-leave)');
  grid.querySelectorAll('.dp-day.sel').forEach((b) => b.classList.remove('sel'));
  const btn = grid.querySelector(`[data-dp-day="${day}"]`);
  if (btn) btn.classList.add('sel');
  dpRing(true);
}

/** Stunde oder Minute wählen. */
function dpPickTime(kind, value) {
  dp[kind] = value;
  const col = dp.el.querySelector(`[data-dp-col="${kind}"]`);
  if (!col) return;
  col.querySelectorAll('.dp-tv.sel').forEach((b) => b.classList.remove('sel'));
  const btn = col.querySelector(`[data-dp-${kind}="${value}"]`);
  if (btn) btn.classList.add('sel');
  dpScrollCols(true);
}

/** Fenster unter (oder über) das Feld setzen. */
function popPlace(el, input) {
  if (!el || !input) return;
  const r = input.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : Math.max(8, Math.min(below, window.innerHeight - h - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
const dpPlace = () => popPlace(dp.el, dp.input);

function dpOpen(input) {
  if (dp.input === input) return;
  dpClose();
  cpClose();
  const kind = dpKind(input);
  const v = dpParse(input);
  dp.input = input;
  dp.day = v.date;
  const now = new Date();
  dp.hh = v.hh || pad2(Math.min(23, now.getHours() + 1));
  dp.mm = v.mm || '00';
  const base = v.date ? new Date(`${v.date}T00:00`) : input.min ? new Date(`${String(input.min).slice(0, 10)}T00:00`) : now;
  dp.view = new Date(base.getFullYear(), base.getMonth(), 1);
  dp.el = document.createElement('div');
  dp.el.className = `dp dp-${kind}`;
  dp.el.setAttribute('role', 'dialog');
  dp.el.setAttribute('aria-label', kind === 'dt' ? 'Datum und Uhrzeit wählen' : kind === 'time' ? 'Uhrzeit wählen' : 'Datum wählen');
  dp.el.style.width = kind === 'time' ? '232px' : `${Math.min(360, Math.max(304, input.offsetWidth))}px`; // Kalender so breit wie das Feld
  document.body.appendChild(dp.el);
  input.setAttribute('aria-expanded', 'true');
  if (input.dataset.dpRo) input.blur(); // am Handy keine Eingabe-Markierung im Feld
  dpRender();
  // Passt das Fenster weder unter noch über das Feld (Handy), Feld nach oben holen statt es zu verdecken
  const r = input.getBoundingClientRect();
  const h = dp.el.offsetHeight;
  if (r.bottom + h + 14 > window.innerHeight && r.top - h - 14 < 0) {
    input.scrollIntoView({ block: 'start', behavior: 'instant' });
    dpPlace();
  }
}

function dpClose() {
  if (!dp.el) return;
  const el = dp.el;
  if (dpMotion()) {
    // Das Fenster blendet aus (als Kopie ohne Klasse „dp“, damit es nicht mehr als geöffnet zählt)
    el.className = 'dp-ghost';
    el.inert = true;
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 130, easing: 'ease-in' }).finished.then(() => el.remove(), () => el.remove());
  } else el.remove();
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
  const kind = dpKind(dp.input);
  if (kind !== 'time' && !dp.day) return;
  dpSet(kind === 'dt' ? `${dp.day}T${dp.hh}:${dp.mm}` : kind === 'time' ? `${dp.hh}:${dp.mm}` : dp.day);
  dpClose();
}

/* ---- Farbe ---- */
const CP_SWATCHES = ['#d4af37', '#f3e5ab', '#b8962e', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#94a3b8', '#ffffff'];
const cp = { el: null, input: null, h: 0, s: 0, v: 1 };

function cpHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0xd4af37;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
function cpHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return pad2(Math.round(c * 255).toString(16));
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function cpRender() {
  const sw = CP_SWATCHES.map((c) => `<button type="button" class="cp-sw" style="background:${c}" data-cp-sw="${c}" aria-label="Farbe ${c}"></button>`).join('');
  cp.el.innerHTML = `
    <div class="cp-sv" data-cp-drag="sv"><i class="cp-sv-thumb"></i></div>
    <div class="cp-hue" data-cp-drag="hue"><i class="cp-hue-thumb"></i></div>
    <div class="cp-row"><span class="cp-prev"></span><input class="field field-sm cp-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Farbwert, z. B. #d4af37"></div>
    <div class="cp-sws">${sw}</div>
    <div class="dp-foot"><button type="button" class="btn-gold btn-sm" data-cp-act="ok">Fertig</button></div>`;
  cpPaint(true);
  popPlace(cp.el, cp.input);
}

/** Alles passend zur gewählten Farbe zeichnen; typing=true lässt das Hex-Feld in Ruhe, solange man darin tippt. */
function cpPaint(refreshHex) {
  const hex = cpHex(cp.h, cp.s, cp.v);
  const sv = cp.el.querySelector('.cp-sv');
  sv.style.setProperty('--cp-hue', `hsl(${cp.h}, 100%, 50%)`);
  const t = sv.querySelector('.cp-sv-thumb');
  t.style.left = `${cp.s * 100}%`;
  t.style.top = `${(1 - cp.v) * 100}%`;
  t.style.background = hex;
  const ht = cp.el.querySelector('.cp-hue-thumb');
  ht.style.left = `${(cp.h / 360) * 100}%`;
  ht.style.background = `hsl(${cp.h}, 100%, 50%)`;
  cp.el.querySelector('.cp-prev').style.background = hex;
  if (refreshHex) cp.el.querySelector('.cp-hex').value = hex;
  cp.el.querySelectorAll('.cp-sw').forEach((b) => b.classList.toggle('sel', b.dataset.cpSw.toLowerCase() === hex));
  return hex;
}

function cpApply(fire) {
  const hex = cp.el.querySelector('.cp-hex') === document.activeElement ? cpHex(cp.h, cp.s, cp.v) : cpPaint(true);
  if (cp.input.value !== hex) {
    cp.input.value = hex;
    cp.input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (fire) cp.input.dispatchEvent(new Event('change', { bubbles: true }));
}

function cpOpen(input) {
  if (cp.input === input) return;
  cpClose();
  dpClose();
  Object.assign(cp, cpHsv(input.value), { input });
  cp.el = document.createElement('div');
  cp.el.className = 'cp';
  cp.el.setAttribute('role', 'dialog');
  cp.el.setAttribute('aria-label', 'Farbe wählen');
  document.body.appendChild(cp.el);
  input.setAttribute('aria-expanded', 'true');
  cpRender();
}

function cpClose() {
  if (!cp.el) return;
  const el = cp.el;
  if (dpMotion()) {
    el.className = 'dp-ghost';
    el.inert = true;
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in' }).finished.then(() => el.remove(), () => el.remove());
  } else el.remove();
  if (cp.input) cp.input.removeAttribute('aria-expanded');
  cp.el = null;
  cp.input = null;
}

// Ziehen im Farbfeld und auf dem Farbband
let cpDrag = null;
function cpMove(e) {
  if (!cpDrag) return;
  const r = cpDrag.box.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
  if (cpDrag.kind === 'sv') {
    cp.s = x;
    cp.v = 1 - y;
  } else cp.h = Math.min(359.99, x * 360);
  cpApply(false);
}
document.addEventListener('pointerdown', (e) => {
  const box = e.target.closest && e.target.closest('[data-cp-drag]');
  if (!box || !cp.el || !cp.el.contains(box)) return;
  e.preventDefault();
  cpDrag = { box, kind: box.dataset.cpDrag };
  box.setPointerCapture && box.setPointerCapture(e.pointerId);
  cpMove(e);
});
document.addEventListener('pointermove', (e) => cpDrag && cpMove(e));
const cpDragEnd = () => {
  if (!cpDrag) return;
  cpDrag = null;
  if (cp.el) cpApply(true);
};
document.addEventListener('pointerup', cpDragEnd);
document.addEventListener('pointercancel', cpDragEnd);
// Hex-Feld: tippen übernimmt eine gültige Farbe sofort
document.addEventListener('input', (e) => {
  if (!cp.el || !e.target.matches || !e.target.matches('.cp-hex')) return;
  const v = e.target.value.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(v)) return;
  Object.assign(cp, cpHsv(v));
  cpApply(true);
  cpPaint(false);
});

// Antippen am Handy: kurz schreibschützen, damit nicht das System-Rad aufgeht
document.addEventListener('pointerdown', (e) => {
  const input = e.target.closest && e.target.closest(DP_SEL);
  if (input && e.pointerType !== 'mouse' && !input.readOnly && !input.disabled) {
    input.readOnly = true;
    input.dataset.dpRo = '1';
  }
});
document.addEventListener(
  'click',
  (e) => {
    // Farbfelder: nicht das Fenster des Browsers öffnen, sondern unseres
    const color = e.target.closest && e.target.closest(CP_SEL);
    if (color && !color.disabled) {
      e.preventDefault();
      return cpOpen(color);
    }
  },
  true
);
document.addEventListener('click', (e) => {
  const input = e.target.closest && e.target.closest(DP_SEL);
  if (input && !input.disabled && (!input.readOnly || input.dataset.dpRo)) return dpOpen(input);
  if (cp.el && !cp.el.contains(e.target) && !(e.target.closest && e.target.closest(CP_SEL))) cpClose();
  if (cp.el && cp.el.contains(e.target)) {
    const swatch = e.target.closest('[data-cp-sw]');
    if (swatch) {
      Object.assign(cp, cpHsv(swatch.dataset.cpSw));
      cpApply(true);
    } else if (e.target.closest('[data-cp-act="ok"]')) cpClose();
    return;
  }
  if (!dp.el) return;
  if (!dp.el.contains(e.target)) return dpClose();
  const nav = e.target.closest('[data-dp-nav]');
  const day = e.target.closest('[data-dp-day]');
  const hh = e.target.closest('[data-dp-hh]');
  const mm = e.target.closest('[data-dp-mm]');
  const act = e.target.closest('[data-dp-act]');
  const kind = dpKind(dp.input);
  if (nav) dpMonth(Number(nav.dataset.dpNav));
  else if (day && !day.disabled) {
    dpPick(day.dataset.dpDay);
    if (kind === 'date') dpCommit();
  } else if (hh) dpPickTime('hh', hh.dataset.dpHh);
  else if (mm) dpPickTime('mm', mm.dataset.dpMm);
  else if (act) {
    const a = act.dataset.dpAct;
    if (a === 'clear') {
      dpSet('');
      dpClose();
    } else if (a === 'today') {
      const n = new Date();
      if (kind !== 'time') {
        const same = dp.view.getFullYear() === n.getFullYear() && dp.view.getMonth() === n.getMonth();
        if (!same) dpMonth(n > dp.view ? 1 : -1, new Date(n.getFullYear(), n.getMonth(), 1));
        dpPick(dpKey(n));
      }
      if (kind !== 'date') {
        dpPickTime('hh', pad2(n.getHours()));
        const m5 = pad2(Math.floor(n.getMinutes() / 5) * 5);
        if (!dp.el.querySelector(`[data-dp-mm="${m5}"]`)) dp.mm = '00';
        dpPickTime('mm', m5);
      } else dpCommit();
    } else if (a === 'ok') dpCommit();
  }
});
// Fenster offen lassen, wenn man darin klickt (Fokus bleibt im Feld)
document.addEventListener('mousedown', (e) => {
  const inside = (dp.el && dp.el.contains(e.target)) || (cp.el && cp.el.contains(e.target));
  if (inside && !e.target.closest('select, .cp-hex')) e.preventDefault();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (!dp.el && !cp.el) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // nur die Auswahl schließen, nicht das Fenster dahinter
      dpClose();
      cpClose();
    } else if (e.key === 'Tab' && dp.el && e.target === dp.input) dpClose();
    else if (e.key === 'Enter' && cp.el && e.target.matches && e.target.matches('.cp-hex')) {
      e.preventDefault();
      cpClose();
    }
  },
  true
);
window.addEventListener('resize', () => {
  dpPlace();
  popPlace(cp.el, cp.input);
});
document.addEventListener(
  'scroll',
  (e) => {
    if (e.target && e.target.closest && (e.target.closest('.dp') || e.target.closest('.cp'))) return; // Spalten rollen im Fenster selbst
    dpPlace();
    popPlace(cp.el, cp.input);
  },
  true
);
