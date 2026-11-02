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
  // in einem versteckten Bereich (z. B. zweiter Reiter eines Fensters) lässt sich nichts messen – später, wenn sichtbar
  if (!row.getClientRects().length && !row.classList.contains('tabrow-collapsed')) return;
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

/* ================================================================
   Bewegung der Reiter: Der Goldstrich (bzw. die Auswahl einer Chip-Leiste) gleitet mit leichtem Nachfedern vom alten
   zum neuen Reiter – auch wenn die Leiste dabei neu gezeichnet wird (die alte Stelle wird beim Klick gemerkt). Der neue
   Reiter bekommt ein kurzes Aufleuchten (Symbol hüpft), Zahlen in den Reitern rollen zum neuen Stand.
   Bei „Bewegung reduzieren“ springt alles wie bisher.
   ================================================================ */
const INK_MS = 4000; // so lange nach dem Klick darf die Leiste noch erscheinen (Seite lädt)
const INK_LINE = '.hub-tabs, .case-jump-list'; // Leisten mit Unterstrich; die übrigen haben eine Auswahl-Pille
let inkPending = null; // { key, geo, at }
const inkCounts = new Map(); // Leiste → Zahlen je Reiter (zum Rollen)

const inkItems = (row) => [...row.children].filter((el) => el.matches('button, a') && !el.hidden);
const inkIsOn = (el) => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page';
function inkKey(row) {
  const first = inkItems(row)[0];
  return [row.getAttribute('aria-label') || row.className.split(' ')[0], first ? first.dataset.action || first.getAttribute('href') || '' : '', row.closest('#modal') ? 'm' : 'p'].join('|');
}
function inkGeo(row, el) {
  const rr = row.getBoundingClientRect();
  const ar = el.getBoundingClientRect();
  return { x: ar.left - rr.left + row.scrollLeft, y: ar.top - rr.top + row.scrollTop, w: ar.width, h: ar.height };
}
function inkActive(row) {
  const on = inkItems(row).filter(inkIsOn);
  return on.length === 1 ? on[0] : null;
}
// Klick auf einen Reiter (auch über die Auswahlliste am Handy): Stelle des bisherigen merken
document.addEventListener(
  'click',
  (e) => {
    const item = e.target.closest && e.target.closest('button, a');
    const row = item && item.parentElement;
    if (!row || !row.matches(TABROW_SEL)) return;
    const cur = inkActive(row);
    if (!cur || cur === item || row.classList.contains('tabrow-collapsed')) return;
    inkPending = { key: inkKey(row), geo: inkGeo(row, cur), at: performance.now() };
  },
  true
);
/** Nach dem Wechsel (neu gezeichnet oder nur umgeschaltet): Strich bzw. Pille gleitet von der gemerkten Stelle. */
function tabInk(row) {
  if (!row || !row.isConnected) return;
  inkRoll(row);
  if (!inkPending || row.classList.contains('tabrow-collapsed') || !row.getClientRects().length) return;
  if (performance.now() - inkPending.at > INK_MS) return void (inkPending = null);
  if (inkKey(row) !== inkPending.key) return;
  const cur = inkActive(row);
  if (!cur) return;
  const from = inkPending.geo;
  const to = inkGeo(row, cur);
  if (Math.abs(to.x - from.x) < 2 && Math.abs(to.y - from.y) < 2 && Math.abs(to.w - from.w) < 2) return; // noch nicht umgeschaltet
  inkPending = null;
  if (window.PS.motion.calm() || typeof Element.prototype.animate !== 'function') return;
  inkGlide(row, cur, from, to);
}
function inkGlide(row, active, from, to) {
  const line = row.matches(INK_LINE);
  const cs = getComputedStyle(active);
  const ink = document.createElement('span');
  ink.className = `tab-ink ${line ? 'is-line' : 'is-pill'}`;
  ink.setAttribute('aria-hidden', 'true');
  const thick = parseFloat(cs.borderBottomWidth) || 2;
  if (!line) Object.assign(ink.style, { borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, borderColor: cs.borderColor });
  const box = (g) => (line ? { left: `${g.x}px`, top: `${g.y + g.h - thick}px`, width: `${g.w}px`, height: `${thick}px` } : { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` });
  row.classList.add('ink-host', 'ink-gliding');
  row.append(ink);
  active.classList.remove('ink-arrive');
  void active.offsetWidth;
  active.classList.add('ink-arrive');
  const narrow = window.matchMedia('(max-width: 639px)').matches;
  const anim = ink.animate([box(from), box(to)], { duration: narrow ? 260 : 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
  const done = () => {
    ink.remove();
    if (!row.querySelector(':scope > .tab-ink')) row.classList.remove('ink-gliding');
    setTimeout(() => active.classList.remove('ink-arrive'), 400);
  };
  anim.finished.then(done, done);
}
/** Zahlen in den Reitern („Offen 3“ → „Offen 4“) rollen zum neuen Stand – nach oben bzw. unten. */
function inkRoll(row) {
  const key = inkKey(row);
  const items = inkItems(row);
  const now = items.map((el) => (el.querySelector('.chip-count, .nav-count, .jump-n') || {}).textContent || '');
  const was = inkCounts.get(key);
  inkCounts.set(key, now);
  if (!was || was.length !== now.length || window.PS.motion.calm()) return;
  items.forEach((el, i) => {
    if (was[i] === now[i]) return;
    const n = el.querySelector('.chip-count, .nav-count, .jump-n');
    if (!n) return;
    n.dataset.roll = (parseInt(now[i], 10) || 0) >= (parseInt(was[i], 10) || 0) ? 'up' : 'down';
    n.classList.remove('count-roll');
    void n.offsetWidth;
    n.classList.add('count-roll');
  });
}

let tabrowQueued = false;
function tabrowScan() {
  if (tabrowQueued) return;
  tabrowQueued = true;
  requestAnimationFrame(() => {
    tabrowQueued = false;
    document.querySelectorAll(TABROW_SEL).forEach((row) => {
      tabrowFit(row);
      tabInk(row);
    });
    // Auswahllisten ohne Leiste (die Leiste wurde neu gezeichnet) aufräumen
    document.querySelectorAll('.tabrow-pick').forEach((p) => {
      const row = p.nextElementSibling;
      if (!row || !row.classList.contains('tabrow-collapsed')) p.remove();
    });
  });
}
new MutationObserver((records) => {
  // eigene Änderungen (Auswahlliste) lösen keinen neuen Durchlauf aus; ein Bereich, der sichtbar wird (hidden/open), schon
  if (records.every((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType !== 1 || n.classList.contains('tabrow-pick') || n.classList.contains('tab-ink')))) return;
  tabrowScan();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
window.addEventListener('resize', tabrowScan);
tabrowScan();
