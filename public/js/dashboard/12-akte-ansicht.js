/*
 * Kanzlei-Dashboard – Ansicht der Akte anpassen: Abschnitte (Anklage, Nachrichten, Termine, Zeugen, Karte, Beweise …) per
 * Ziehen oder mit den Pfeilen umsortieren, ausblenden und einklappen. Gespeichert je Person (auf jedem Gerät gleich);
 * das Board kann je Rechtsgebiet eine Standardansicht vorgeben, die gilt, solange jemand nichts Eigenes eingestellt hat.
 * Der Kopf der Akte, Sachverhalt und Details bleiben, wo sie sind. Mandanten sehen die feste Reihenfolge.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

// [Schlüssel, Anker in der Akte, Bezeichnung]
const CASE_SEC = [
  ['subject', 'secSubject', 'Angegriffener Akt / Vertragsgegenstand'],
  ['tathergang', 'secTathergang', 'Tathergang'],
  ['charges', 'secCharges', 'Anklage'],
  ['admiss', 'secAdmiss', 'Zulässigkeit'],
  ['claims', 'secClaims', 'Ansprüche'],
  ['motions', 'secMotions', 'Anträge'],
  ['norms', 'secNorms', 'Grundrechte / Normen'],
  ['participants', 'secParticipants', 'Beteiligte'],
  ['parties', 'secParties', 'Vertragsparteien'],
  ['clauses', 'secClauses', 'Klauseln'],
  ['term', 'secTerm', 'Laufzeit & Fristen'],
  ['versions', 'secVersions', 'Entwurfsversionen'],
  ['vclaims', 'secVclaims', 'Ansprüche (Streit)'],
  ['chat', 'secChat', 'Nachrichten'],
  ['events', 'secEvents', 'Termine & Fristen'],
  ['witnesses', 'secWitnesses', 'Zeugen'],
  ['karte', 'secKarte', 'Tatort-Karte'],
  ['corr', 'secCorr', 'Korrespondenz'],
  ['contracts', 'secContracts', 'Verträge'],
  ['briefs', 'secBriefs', 'Schriftsätze'],
  ['external', 'secExternal', 'Dokumente'],
  ['evidence', 'secEvidence', 'Beweise'],
  ['requests', 'secRequests', 'Unterlagen'],
  ['tasks', 'secTasks', 'Aufgaben'],
  ['invoices', 'secInvoices', 'Rechnungen'],
  ['work', 'secWork', 'Zeiten'],
  ['notes', 'secNotes', 'Verlauf & Notizen'],
];
const SEC_KEYS = CASE_SEC.map((s) => s[0]);
/*
 * Die Akte in vier Reitern statt einer langen Seite: Überblick (Stand, Details, Sachverhalt, Aufgaben, Zeiten, Verlauf),
 * Kommunikation, Fall und Dokumente. Kopf und wichtige Hinweise stehen über allen Reitern. Innerhalb eines Reiters gelten
 * Reihenfolge, Ausblenden und Einklappen wie gehabt („Ansicht anpassen“ zeigt alle Abschnitte auf einmal).
 */
const CASE_TABS = [
  ['ueberblick', 'Überblick', ['tasks', 'work', 'notes']],
  ['kommunikation', 'Kommunikation', ['chat', 'events', 'requests']],
  ['fall', 'Fall', ['subject', 'tathergang', 'charges', 'admiss', 'claims', 'motions', 'norms', 'participants', 'parties', 'clauses', 'term', 'versions', 'vclaims', 'witnesses', 'evidence', 'karte', 'corr']],
  ['dokumente', 'Dokumente', ['contracts', 'briefs', 'external', 'invoices']],
];
const casePaneOf = (key) => (CASE_TABS.find((t) => t[2].includes(key)) || CASE_TABS[0])[0];
/** Reiter der offenen Akte wechseln (ohne neu zu zeichnen). */
function caseTabSet(tab) {
  const root = $('#modalBody .case-root');
  if (!root || !CASE_TABS.some((t) => t[0] === tab)) return;
  const from = CASE_TABS.findIndex((t) => t[0] === (root.dataset.caseTab || st.caseTab));
  st.caseTab = tab;
  if (root.dataset.caseTab === tab) return;
  // Richtung für die Überblendung (motion.css): nach rechts weiter = das Alte geht nach links hinaus, das Neue kommt von rechts
  if (wchInside()) document.documentElement.dataset.wchDir = CASE_TABS.findIndex((t) => t[0] === tab) > from ? 'fwd' : 'back';
  const h0 = root.offsetHeight;
  root.dataset.caseTab = tab;
  root.querySelectorAll('.case-jump [data-action="case-tab"]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const pick = root.querySelector('.case-jump .tabrow-pick select');
  if (pick) pick.value = String(CASE_TABS.findIndex((t) => t[0] === tab));
  // Bewegung: Goldstrich gleitet, der neue Reiter blendet weich ein, die Höhe des Fensters folgt
  tabInk(root.querySelector('.case-jump-list'));
  // Läuft der Wechsel in einer Überblendung (13-weich.js), blenden alt und neu ineinander über – die Einblendungen hier entfallen
  if (!wchInside() && !window.PS.motion.calm() && typeof Element.prototype.animate === 'function') {
    root.querySelectorAll(':scope [data-pane]').forEach((pane) => {
      if (pane.getClientRects().length) pane.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    });
    heightGlide(root, h0);
  }
}
/** Abschnitt sichtbar machen (passenden Reiter öffnen) – für Sprünge aus Kacheln, Hinweisen und Links. */
function caseReveal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const pane = el.closest('[data-pane]');
  if (pane) caseTabSet(pane.dataset.pane);
  return el;
}
const caseSecKey = (anchor) => (CASE_SEC.find((s) => s[1] === anchor) || [anchor])[0];
let kSecPrefs = null; // { mine, defaults: { Rechtsgebiet: Ansicht }, board }

/** Einstellungen einmal laden (Kanzlei); ohne Antwort gilt die Standardreihenfolge. */
async function caseSecLoad() {
  if (!isStaff() || kSecPrefs) return;
  try {
    kSecPrefs = await api.get('/api/prefs/case-sections');
  } catch {
    kSecPrefs = { mine: null, defaults: {}, board: false };
  }
}

/** Gültige Ansicht für ein Rechtsgebiet: eigene, sonst die Standardansicht des Rechtsgebiets, sonst die Grundreihenfolge. */
function caseSecLayout(area) {
  const mine = kSecPrefs && kSecPrefs.mine;
  const view = mine || (kSecPrefs && kSecPrefs.defaults && kSecPrefs.defaults[area]) || null;
  // Ohne eigene oder vorgegebene Ansicht gilt die Grundreihenfolge des Rechtsgebiets (12-fall.js), sonst die allgemeine
  const base = view ? view.order : (typeof FALL_ORDER !== 'undefined' && FALL_ORDER[area]) || [];
  const order = base.filter((k) => SEC_KEYS.includes(k));
  // Abschnitte, die es bei der gespeicherten Ansicht noch nicht gab (z. B. Tathergang): an ihrem Standardplatz einfügen
  SEC_KEYS.forEach((k, i) => {
    if (order.includes(k)) return;
    const next = SEC_KEYS.slice(i + 1).find((x) => order.includes(x));
    order.splice(next ? order.indexOf(next) : order.length, 0, k);
  });
  return { order, hidden: new Set(view ? view.hidden : []), collapsed: new Set(view ? view.collapsed : []), source: mine ? 'mine' : view ? 'default' : 'standard' };
}
const caseSecIsHidden = (c, anchor) => isStaff() && caseSecLayout(c.area).hidden.has(caseSecKey(anchor));

/** Sprungleiste in der Reihenfolge der Akte. */
function caseSecSort(c, jumps, staff) {
  if (!staff) return jumps;
  const { order } = caseSecLayout(c.area);
  return jumps.slice().sort((a, b) => order.indexOf(caseSecKey(a[0])) - order.indexOf(caseSecKey(b[0])));
}

const SEC_SOURCE = { mine: 'Deine Ansicht', default: 'Standardansicht des Rechtsgebiets', standard: 'Grundansicht' };

/** Die Abschnitte der Akte in der gewählten Reihenfolge – jeder mit Leiste (Griff, Pfeile, Ausblenden, Einklappen). */
function caseSecHtml(c, map, meta, staff) {
  if (!staff) return SEC_KEYS.map((k) => (map[k] ? `<div class="sec-plain" data-sec="${k}" data-pane="${casePaneOf(k)}">${map[k]}</div>` : '')).join('\n');
  const L = caseSecLayout(c.area);
  const items = L.order
    .filter((k) => map[k])
    .map((k) => {
      const m = meta[k] || { label: CASE_SEC.find((s) => s[0] === k)[2], n: 0 };
      const hidden = L.hidden.has(k);
      const folded = L.collapsed.has(k);
      const count = m.n ? `<span class="jump-n">${m.n}</span>` : '';
      return `<div class="sec-wrap${hidden ? ' is-hidden-sec' : ''}${folded ? ' is-collapsed' : ''}" data-sec="${k}" data-pane="${casePaneOf(k)}">
        <div class="sec-bar"><button type="button" class="sec-grip" aria-label="Verschieben: ${esc(m.label)}" title="Ziehen zum Verschieben">${icon('grip', 'ico-sm')}</button>
          <span class="sec-name">${esc(m.label)}${count}</span>
          <span class="sec-ctl">
            <button type="button" class="icon-btn sm" data-action="sec-move" data-dir="-1" aria-label="${esc(m.label)} nach oben" title="Nach oben">${icon('chevronUp', 'ico-sm')}</button>
            <button type="button" class="icon-btn sm" data-action="sec-move" data-dir="1" aria-label="${esc(m.label)} nach unten" title="Nach unten">${icon('chevronDown', 'ico-sm')}</button>
            <button type="button" class="sec-tog sec-tog-fold${folded ? ' is-on' : ''}" data-action="sec-fold" aria-pressed="${folded}" title="Beim Öffnen eingeklappt lassen">Eingeklappt</button>
            <button type="button" class="sec-tog sec-tog-hide${hidden ? ' is-on' : ''}" data-action="sec-hide" aria-pressed="${hidden}" title="Abschnitt ausblenden">Ausgeblendet</button>
          </span></div>
        <button type="button" class="sec-folded" data-action="sec-unfold" aria-label="${esc(m.label)} aufklappen">${icon('chevronRight', 'ico-sm')}<span>${esc(m.label)}</span>${count}</button>
        <div class="sec-body">${map[k]}</div></div>`;
    })
    .join('');
  const board = kSecPrefs && kSecPrefs.board;
  const hasDefault = !!(kSecPrefs && kSecPrefs.defaults && kSecPrefs.defaults[c.area]);
  const areaName = typeof AREA_META !== 'undefined' && AREA_META.list ? (AREA_META.list.find((a) => a.key === c.area) || {}).name || c.area : c.area;
  const bar = `<div class="sec-editbar" role="group" aria-label="Ansicht der Akte anpassen">
      <div class="sec-editinfo"><strong>Ansicht anpassen</strong><span class="text-xs text-dim">Ziehen oder Pfeile zum Umsortieren – Ausblenden und Einklappen gelten für diese Ansicht. <span data-sec-source>${SEC_SOURCE[L.source]}</span></span></div>
      <div class="sec-editbtns">
        ${board ? `<button type="button" class="btn-outline btn-sm" data-action="sec-default" title="Diese Ansicht für alle ohne eigene Einstellung in „${esc(areaName)}“">Als Standard für ${esc(areaName)}</button>` : ''}
        ${board && hasDefault ? `<button type="button" class="btn-ghost btn-sm" data-action="sec-default-clear">Standard entfernen</button>` : ''}
        <button type="button" class="btn-ghost btn-sm" data-action="sec-reset">Zurücksetzen</button>
        <button type="button" class="btn-gold btn-sm" data-action="sec-edit">${icon('check', 'ico-sm')}<span>Fertig</span></button>
      </div></div>`;
  return `<div id="caseSections" class="case-sections" data-area="${esc(c.area)}">${bar}${items}</div>`;
}

/** Aktueller Zustand aus der Seite lesen. */
function caseSecRead() {
  const wraps = [...document.querySelectorAll('#caseSections > .sec-wrap')];
  return {
    order: wraps.map((w) => w.dataset.sec),
    hidden: wraps.filter((w) => w.classList.contains('is-hidden-sec')).map((w) => w.dataset.sec),
    collapsed: wraps.filter((w) => w.classList.contains('is-collapsed')).map((w) => w.dataset.sec),
  };
}

/** Sprungleiste an die neue Reihenfolge anpassen und gespeicherte Ansicht (verzögert) übertragen. */
let caseSecTimer = 0;
let caseSecPending = null;
/** Gespeichert wird kurz verzögert; beim Fertig-Drücken, Wechseln der Akte oder Schließen sofort. */
function caseSecFlush() {
  clearTimeout(caseSecTimer);
  const mine = caseSecPending;
  caseSecPending = null;
  if (mine) api.put('/api/prefs/case-sections', mine).catch(() => toast('Die Ansicht konnte nicht gespeichert werden.', 'error'));
}
window.addEventListener('pagehide', caseSecFlush);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && caseSecFlush());
function caseSecSync() {
  const view = caseSecRead();
  // Die Reihenfolge enthält nur Abschnitte, die in dieser Akte vorkommen – die übrigen behalten ihren Platz am Ende
  const full = [...new Set([...view.order, ...(kSecPrefs && kSecPrefs.mine ? kSecPrefs.mine.order : []), ...SEC_KEYS])];
  const mine = { order: full, hidden: view.hidden, collapsed: view.collapsed };
  if (kSecPrefs) kSecPrefs.mine = mine;
  const list = document.querySelector('.case-jump-list');
  if (list) {
    const btn = (k) => list.querySelector(`[data-sec-jump="${k}"]`);
    view.order.forEach((k) => btn(k) && list.appendChild(btn(k)));
    view.order.forEach((k) => btn(k) && (btn(k).hidden = view.hidden.includes(k)));
  }
  const src = document.querySelector('[data-sec-source]');
  if (src) src.textContent = SEC_SOURCE.mine;
  caseSecPending = mine;
  clearTimeout(caseSecTimer);
  caseSecTimer = setTimeout(caseSecFlush, 350);
}

/* Ziehen am Griff (Maus und Finger); beim Anpassen sind die Abschnitte zu Leisten zusammengeklappt, das Umsortieren bleibt übersichtlich */
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('.sec-grip');
  if (!grip || e.button > 0) return;
  const wrap = grip.closest('.sec-wrap');
  const box = wrap && wrap.parentNode;
  if (!box || !box.classList.contains('is-editing')) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  wrap.classList.add('is-dragging');
  const scroller = document.getElementById('modalBody') || document.scrollingElement;
  const move = (ev) => {
    const y = ev.clientY;
    for (const sib of box.querySelectorAll(':scope > .sec-wrap')) {
      if (sib === wrap) continue;
      const r = sib.getBoundingClientRect();
      if (y > r.top && y < r.bottom) {
        box.insertBefore(wrap, y < r.top + r.height / 2 ? sib : sib.nextSibling);
        break;
      }
    }
    // am Rand weiterscrollen
    const rect = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    if (y < rect.top + 60) scroller.scrollBy(0, -14);
    else if (y > rect.bottom - 60) scroller.scrollBy(0, 14);
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    wrap.classList.remove('is-dragging');
    caseSecSync();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
});

Object.assign(actions, {
  'sec-edit': (el) => {
    const box = $('#caseSections');
    if (!box) return;
    const on = !box.classList.contains('is-editing');
    box.classList.toggle('is-editing', on);
    document.querySelectorAll('[data-action="sec-edit"].jump-edit').forEach((b) => b.classList.toggle('is-on', on));
    if (on) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else {
      box.querySelectorAll('.is-open-tmp').forEach((w) => w.classList.remove('is-open-tmp'));
      caseSecFlush();
    }
  },
  'sec-move': (el) => {
    const wrap = el.closest('.sec-wrap');
    if (!wrap) return;
    const dir = Number(el.dataset.dir);
    const sib = dir < 0 ? wrap.previousElementSibling : wrap.nextElementSibling;
    if (!sib || !sib.classList.contains('sec-wrap')) return;
    if (dir < 0) wrap.parentNode.insertBefore(wrap, sib);
    else wrap.parentNode.insertBefore(sib, wrap);
    wrap.scrollIntoView({ block: 'nearest' });
    caseSecSync();
  },
  'sec-hide': (el) => {
    const wrap = el.closest('.sec-wrap');
    const on = wrap.classList.toggle('is-hidden-sec');
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
    caseSecSync();
  },
  'sec-fold': (el) => {
    const wrap = el.closest('.sec-wrap');
    const on = wrap.classList.toggle('is-collapsed');
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
    caseSecSync();
  },
  'sec-unfold': (el) => el.closest('.sec-wrap').classList.add('is-open-tmp'),
  'sec-reset': async () => {
    clearTimeout(caseSecTimer);
    caseSecPending = null;
    await api.del('/api/prefs/case-sections');
    if (kSecPrefs) kSecPrefs.mine = null;
    toast('Ansicht zurückgesetzt.');
    if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
  'sec-default': async () => {
    const box = $('#caseSections');
    if (!box) return;
    const view = caseSecRead();
    const full = [...new Set([...view.order, ...SEC_KEYS])];
    const body = { order: full, hidden: view.hidden, collapsed: view.collapsed };
    await api.put(`/api/prefs/case-sections/default/${encodeURIComponent(box.dataset.area)}`, body);
    if (kSecPrefs) kSecPrefs.defaults[box.dataset.area] = body;
    toast('Standardansicht für dieses Rechtsgebiet gespeichert – sie gilt für alle ohne eigene Einstellung.');
  },
  'sec-default-clear': async () => {
    const box = $('#caseSections');
    if (!box) return;
    await api.del(`/api/prefs/case-sections/default/${encodeURIComponent(box.dataset.area)}`);
    if (kSecPrefs) delete kSecPrefs.defaults[box.dataset.area];
    toast('Standardansicht entfernt.');
    if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
});

/* ================================================================
   Tathergang (Reiter „Fall“, nur Kanzlei): was ist passiert – gut lesbar gegliedert. Absätze bleiben Absätze; Zeilen mit
   Uhrzeit („14:20 – Festnahme vor dem Juwelier“) oder Aufzählungszeichen („- …“) werden zu einer Zeitleiste.
   ================================================================ */
const STORY_STEP = /^\s*(?:(?:[-–•*]\s*)?(\d{1,2}[:.]\d{2})\s*(?:Uhr)?\s*[-–:|]?\s*|[-–•*]\s+)(.+)$/;
/** Schritte der Zeitleiste (für die Zahl im Reiter). */
function storySteps(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.match(STORY_STEP))
    .filter(Boolean);
}
function storyHtml(text) {
  const blocks = String(text || '').trim().split(/\n\s*\n/);
  return `<div class="story">${blocks
    .map((b) => {
      const lines = b.split('\n').filter((l) => l.trim());
      const steps = lines.map((l) => l.match(STORY_STEP));
      if (steps.length && steps.every(Boolean)) {
        return `<ol class="story-steps">${steps.map((m) => `<li>${m[1] ? `<time>${esc(m[1].replace('.', ':'))}</time>` : '<i class="story-dot" aria-hidden="true"></i>'}<span>${esc(m[2].trim())}</span></li>`).join('')}</ol>`;
      }
      return `<p>${lines.map(esc).join('<br>')}</p>`;
    })
    .join('')}</div>`;
}
function tathergangSection(c) {
  if (!isStaff()) return '';
  const v = c.incident || '';
  if (!v && !c.canEdit) return '';
  const tip = 'Was ist passiert – Schritt für Schritt. Eine Zeile je Schritt, gern mit Uhrzeit („14:20 – Festnahme vor dem Juwelier“); Absätze für längere Schilderungen.';
  if (!v) return emptySection('secTathergang', fallTitle('tathergang', 'Tathergang'), 'noch nicht beschrieben', `<button type="button" class="btn-outline btn-sm" data-action="story-edit" data-case-id="${c.id}">${icon('edit', 'ico-sm')}<span>${fallTitle('tathergang', 'Tathergang') === 'Tathergang' ? 'Tathergang beschreiben' : 'Sachverhalt beschreiben'}</span></button>`, tip);
  return storySection(c, v);
}
function storySection(c, v) {
  const n = storySteps(v).length;
  return `<div class="section" id="secTathergang"><div class="section-head"><h3 class="section-title">${esc(fallTitle('tathergang', 'Tathergang'))} <span class="text-xs text-dim font-normal sec-meta">${n ? `${n} Schritt${n === 1 ? '' : 'e'}` : ''}</span></h3>
      ${c.canEdit ? `<button type="button" class="btn-ghost btn-sm story-edit-btn" data-action="story-open">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>` : ''}</div>
      ${c.canEdit ? `<p class="story-hint">Eine Zeile je Schritt, gern mit Uhrzeit („14:20 – Festnahme vor dem Juwelier“); Absätze für längere Schilderungen. Strg+Enter speichert.</p>` : ''}
      <div class="ie-block story-box">${ie(c, 'incident', v, { type: 'textarea', placeholder: `${fallTitle('tathergang', 'Tathergang') === 'Tathergang' ? 'Tathergang' : 'Sachverhalt'} beschreiben …`, cls: 'ie-story' })}</div></div>`;
}
Object.assign(actions, {
  'story-open': () => {
    const field = $('#secTathergang .ie[data-ie="incident"]');
    if (field) ieOpen(field);
  },
  // Leerer Tathergang: Abschnitt zum Schreiben aufklappen und das Feld öffnen
  'story-edit': (el) => {
    const c = st.caseInfo;
    const row = el.closest('#secTathergang');
    if (!c || !row) return;
    row.outerHTML = storySection(c, '');
    const field = $('#secTathergang .ie[data-ie="incident"]');
    if (field) ieOpen(field);
  },
});
