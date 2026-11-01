/*
 * Kanzlei-Dashboard – Rechtsklick-Menü auf Zeilen (Akten, Aufgaben, Termine):
 * die häufigsten Handgriffe, ohne die Akte zu öffnen (öffnen, anpinnen, übernehmen, Aktenzeichen kopieren, Aktenauszug;
 * Aufgabe erledigen/bearbeiten/löschen; Termin öffnen). Am Handy: langes Drücken bleibt beim Wischen (13-bewegung.js).
 * Tastatur: Kontextmenü-Taste bzw. Umschalt+F10 auf einer markierten Zeile. Esc oder Klick daneben schließt.
 */
'use strict';

let ctxMenuEl = null;
function ctxClose() {
  if (!ctxMenuEl) return;
  const el = ctxMenuEl;
  ctxMenuEl = null;
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), window.PS.motion.calm() ? 0 : 160);
}
/** Einträge für die Zeile (oder null, wenn es für sie kein Menü gibt). */
function ctxItems(row) {
  const act = row.dataset.action;
  const id = Number(row.dataset.id);
  const item = (label, ic, action, data = {}, cls = '') => ({ label, ic, action, data, cls });
  if (act === 'open-case' || act === 'case-pick') {
    const c = (st.cases || []).find((x) => x.id === id) || (st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null);
    const list = [item('Akte öffnen', 'folder', 'open-case', { id })];
    if (!c || !isStaff()) return list;
    list.push({ ...item(c.starred ? 'Lösen (nicht mehr oben)' : 'Anpinnen (steht oben)', 'tack', 'case-star', { id }), pressed: !!c.starred });
    if (!c.lawyerId && !c.closed) list.push(item('Akte übernehmen', 'user', 'claim-case', { id }));
    list.push('-');
    list.push(item('Aktenzeichen kopieren', 'copy', 'copy', { text: c.caseNumber }));
    list.push({ label: 'Aktenauszug', ic: 'doc', href: `/aktenauszug?id=${id}` });
    list.push(item('Aufgabe zur Akte', 'check', 'task-new', { caseId: id }));
    list.push(item('Frist / Termin', 'calendar', 'new-event', { caseId: id }));
    return list;
  }
  if (act === 'task-edit') {
    const t = typeof findTask === 'function' ? findTask(id) : null;
    if (!t) return null;
    const list = [item(t.done ? 'Wieder öffnen' : 'Als erledigt markieren', 'check', 'ctx-task-toggle', { id }), item('Bearbeiten', 'edit', 'task-edit', { id })];
    if (t.caseId) list.push(item('Akte öffnen', 'folder', 'open-case', { id: t.caseId }));
    list.push('-', item('Löschen', 'trash', 'task-delete', { id }, 'danger'));
    return list;
  }
  if (act === 'open-event') return [item('Termin öffnen', 'calendar', 'open-event', { id })];
  return null;
}
function ctxOpen(row, x, y) {
  ctxClose();
  const items = ctxItems(row);
  if (!items || !items.length) return false;
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it) => {
      if (it === '-') return '<div class="ctx-sep" role="separator"></div>';
      if (it.href) return `<a class="ctx-item" role="menuitem" href="${esc(it.href)}" target="_blank" rel="noopener">${icon(it.ic, 'ico-sm')}<span>${esc(it.label)}</span></a>`;
      const data = Object.entries(it.data)
        .map(([k, v]) => ` data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${esc(String(v))}"`)
        .join('');
      return `<button type="button" class="ctx-item ${it.cls}" role="menuitem" data-action="${esc(it.action)}"${data}${it.pressed !== undefined ? ` aria-pressed="${it.pressed}"` : ''}>${icon(it.ic, 'ico-sm')}<span>${esc(it.label)}</span></button>`;
    })
    .join('');
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, innerWidth - r.width - 8));
  const top = y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = `${x - left}px ${y - top}px`;
  ctxMenuEl = menu;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menu.querySelector('.ctx-item')?.focus({ preventScroll: true });
  return true;
}
const CTX_ROWS = '[data-action="open-case"][data-id], [data-action="case-pick"][data-id], .task-row [data-action="task-edit"][data-id], [data-action="open-event"][data-id]';
function ctxRowOf(target) {
  if (!target || !target.closest || target.closest('.ctx-menu, input, textarea, [contenteditable="true"]')) return null;
  const task = target.closest('.task-row');
  if (task) return task.querySelector('[data-action="task-edit"][data-id]');
  const row = target.closest(CTX_ROWS);
  // Nur „Zeilen“ (Listen, Tabellen, Kalender), nicht jeder Link mit open-case im Fließtext
  return row && row.matches('tr, .list-row, .row, .cal-ev, .ev-row, .kanban-card, .gs-item, [role="button"]') ? row : null;
}
document.addEventListener('contextmenu', (e) => {
  if (!st.user || e.shiftKey) return; // Umschalt + Rechtsklick: das Menü des Browsers
  const row = ctxRowOf(e.target);
  if (!row) return ctxClose();
  if (ctxOpen(row, e.clientX, e.clientY)) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if (ctxMenuEl) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ctxClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = $$('.ctx-item', ctxMenuEl);
      const i = list.indexOf(document.activeElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    }
    return;
  }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    const row = ctxRowOf(document.activeElement);
    if (!row) return;
    const r = row.getBoundingClientRect();
    if (ctxOpen(row, r.left + 24, r.top + Math.min(r.height, 40))) e.preventDefault();
  }
});
document.addEventListener('click', (e) => {
  if (!ctxMenuEl) return;
  if (!ctxMenuEl.contains(e.target) || e.target.closest('.ctx-item')) setTimeout(ctxClose, 0);
});
window.addEventListener('scroll', ctxClose, { passive: true, capture: true });
window.addEventListener('resize', ctxClose);

Object.assign(actions, {
  // Aufgabe aus dem Menü abhaken: wie der Haken in der Zeile (gleiche Rückmeldung und Rückgängig-Logik)
  'ctx-task-toggle': async (el) => {
    const box = document.querySelector(`.task-row [data-action="task-toggle"][data-id="${el.dataset.id}"]`);
    if (box) return actions['task-toggle'](box);
    const t = findTask(Number(el.dataset.id));
    if (!t) return;
    await api.patch('/api/tasks/' + t.id, { done: !t.done });
    toast(t.done ? 'Aufgabe wieder geöffnet.' : 'Erledigt.');
    if (typeof afterTaskChange === 'function') await afterTaskChange();
  },
});
