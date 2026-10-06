/*
 * Kanzlei-Dashboard – Teil 2 von 12: Grundgerüst: Navigation, Dialog, Routing.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Grundgerüst: Navigation, Dialog, Routing
   ================================================================ */
function renderNav() {
  let html = '';
  let section = null;
  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.hidden || !allowed(key)) continue;
    if (v.section && v.section !== section) {
      section = v.section;
      html += `<div class="nav-section">${esc(section)}</div>`;
    }
    const count = { mail: st.unread, applications: st.newApplications, tasks: st.dueTasks, concerns: st.concernUnseen, 'concerns-board': st.concernOpen, personnel: st.personnelNew, 'name-requests': st.nameOpen, vip: st.vipReqOpen, reviews: st.reviewOpen }[key] || 0;
    const active = st.view === key || (key === 'invoices' && st.view === 'invoice-new');
    html += `<a href="#${key}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${esc(viewLabel(key))}</span>${count ? `<span class="nav-count">${count > 99 ? '99+' : count}</span>` : ''}</a>`;
  }
  $('#nav').innerHTML = html;

  const bottom = ['overview', 'cases', 'calendar', 'mail'];
  $('#bottomNav').innerHTML =
    bottom
      .map(
        (k) =>
          `<a href="#${k}" class="bn-item ${st.view === k ? 'active' : ''}">${icon(VIEWS[k].icon)}<span>${esc(viewLabel(k, true))}</span>${k === 'mail' && st.unread ? `<span class="dot-badge">${st.unread > 99 ? '99+' : st.unread}</span>` : ''}</a>`
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
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('show');
}

function openModal(html, { wide = false } = {}) {
  $('#modalBody').innerHTML = html;
  $('#modalCard').classList.toggle('wide', wide);
  const modal = $('#modal');
  modal.classList.add('open');
  modal.scrollTop = 0;
  $('#modalBody').scrollTop = 0;
  document.body.classList.add('modal-open');
  tickCountdowns();
  const focusTarget = $('#modalBody [autofocus]');
  if (focusTarget && window.matchMedia('(min-width: 768px)').matches) focusTarget.focus();
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
function closeModal() {
  const modal = $('#modal');
  if (!modal.classList.contains('open')) return;
  modal.classList.remove('open');
  $('#modalBody').innerHTML = '';
  document.body.classList.remove('modal-open');
  st.modalCaseId = null;
  st.modalAppId = null;
  st.modalConcernId = null;
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
  if (location.hash !== '#' + view) history.pushState(null, '', '#' + view);
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
/** Nach Unterdialogen aus einer Akte heraus zurück zur Akte springen. */
async function returnOrClose() {
  const caseId = st.returnCase;
  st.returnCase = null;
  if (caseId) await openCase(caseId);
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
