/*
 * Kanzlei-Dashboard – eine Reiterleiste für alles: Reiter- und Filterleisten (.chip-row mit einer gewählten Auswahl,
 * Bündel-Reiter, Sprungleiste der Akte), die nicht in die Zeile passen, brechen am PC um; am Handy werden sie zu einer
 * Auswahlliste. Die Liste klickt den passenden Reiter – alle Aktionen bleiben, wie sie sind.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const TABROW_NARROW = '(max-width: 699px)';
/** Kandidaten: Chip-Leisten (ohne die, die schon umbrechen) und die Sprungleiste der Akte. */
const TABROW_SEL = '.chip-row:not(.chip-wrap):not(.fn-refs), .case-jump-list';

/** Die wählbaren Einträge einer Leiste – nur wenn sie wie Reiter wirkt (mind. zwei, höchstens einer gewählt). */
function tabrowItems(row) {
  const items = [...row.children].filter((el) => el.matches('button, a') && !el.hidden);
  if (items.length < 2) return null;
  const on = items.filter((el) => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page');
  const jump = row.classList.contains('case-jump-list');
  if (!jump && on.length !== 1) return null; // Aktionsknöpfe ohne Auswahl (z. B. „Mandatsbündel 10 %“) bleiben, wie sie sind
  return { items, active: on[0] || null, jump };
}
/** Beschriftung eines Eintrags für die Auswahlliste: Text und Zahl („Offen · 3“). */
function tabrowLabel(el) {
  const count = el.querySelector('.chip-count, .nav-count, .jump-n');
  const n = count ? count.textContent.trim() : '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.chip-count, .nav-count, .jump-n, svg').forEach((x) => x.remove());
  const text = clone.textContent.replace(/\s+/g, ' ').replace(/•$/, '').trim();
  return n && n !== '0' ? `${text} · ${n}` : text;
}

function tabrowFit(row) {
  const info = tabrowItems(row);
  const prev = row.previousElementSibling && row.previousElementSibling.classList.contains('tabrow-pick') ? row.previousElementSibling : null;
  if (!info) {
    if (prev) prev.remove();
    row.classList.remove('tabrow', 'tabrow-collapsed');
    return;
  }
  row.classList.add('tabrow');
  const narrow = window.matchMedia(TABROW_NARROW).matches;
  // messen, ob die Leiste in die Zeile passt (dafür kurz sichtbar)
  row.classList.remove('tabrow-collapsed');
  const fits = !narrow || row.scrollWidth <= row.clientWidth + 4;
  if (fits) {
    if (prev) prev.remove();
    return;
  }
  const cs = getComputedStyle(row);
  const margins = [cs.marginTop, cs.marginBottom];
  row.classList.add('tabrow-collapsed');
  const labels = info.items.map(tabrowLabel);
  const sel = info.active ? info.items.indexOf(info.active) : -1;
  const sig = `${labels.join('|')}#${sel}`;
  if (prev && prev.dataset.sig === sig) return;
  const name = row.getAttribute('aria-label') || (row.closest('.case-jump') ? 'Abschnitt der Akte' : 'Auswahl');
  const pick = document.createElement('div');
  pick.className = 'tabrow-pick';
  pick.dataset.sig = sig;
  if (!row.closest('.case-jump')) [pick.style.marginTop, pick.style.marginBottom] = margins; // Abstand wie die Leiste
  pick.innerHTML = `<select class="field" aria-label="${esc(name)}">${info.jump && sel < 0 ? `<option value="" selected disabled>Springen zu …</option>` : ''}${labels.map((l, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  pick.querySelector('select').addEventListener('change', (e) => {
    const el = info.items[Number(e.target.value)];
    if (el && el.isConnected) el.click();
    if (info.jump) e.target.value = ''; // Sprungleiste: danach wieder „Springen zu …“
  });
  if (prev) prev.replaceWith(pick);
  else row.before(pick);
}

let tabrowQueued = false;
function tabrowScan() {
  if (tabrowQueued) return;
  tabrowQueued = true;
  requestAnimationFrame(() => {
    tabrowQueued = false;
    document.querySelectorAll(TABROW_SEL).forEach(tabrowFit);
    // Auswahllisten ohne Leiste (die Leiste wurde neu gezeichnet) aufräumen
    document.querySelectorAll('.tabrow-pick').forEach((p) => {
      const row = p.nextElementSibling;
      if (!row || !row.classList.contains('tabrow-collapsed')) p.remove();
    });
  });
}
new MutationObserver((records) => {
  // eigene Änderungen (Auswahlliste, Klassen) lösen keinen neuen Durchlauf aus
  if (records.every((r) => [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType !== 1 || n.classList.contains('tabrow-pick')))) return;
  tabrowScan();
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', tabrowScan);
tabrowScan();
