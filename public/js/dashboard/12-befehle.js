/*
 * Kanzlei-Dashboard – Befehlsleiste: Die Suche (Strg + K) führt auch Befehle aus. „Neue Rechnung“, „Gehe zu Kalender“,
 * „Dienst starten“ oder „Papierkorb“ eintippen, Enter. Mit „>“ am Anfang zeigt sie nur Befehle. Ohne Eingabe stehen die
 * wichtigsten Befehle und die zuletzt geöffneten Akten bereit. Die Trefferlisten (Akten, Rechnungen … Präzedenzfälle,
 * Zeugen, Beweismittel) und die Suche selbst stehen in 03-uebersicht-akten.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const cmdFold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Alle Befehle, die diese Person gerade ausführen darf. kind: „modal“ öffnet ein Fenster anstelle der Suche, „nav“ wechselt
 * die Seite, „do“ führt etwas aus. top = steht ohne Eingabe oben.
 */
function commandList() {
  const staff = isStaff();
  const out = [];
  const add = (id, label, words, ico, kind, run, extra = {}) => out.push({ id, label, words, ico, kind, run, ...extra });
  add('new-case', staff ? 'Neue Akte anlegen' : 'Mandat einreichen', 'neu akte mandat anlegen erstellen einreichen fall', 'plus', 'modal', () => newCaseModal(), { top: true });
  if (allowed('invoice-new')) add('new-invoice', 'Neue Rechnung erstellen', 'neu rechnung erstellen honorar abrechnen', 'receipt', 'do', () => actions['new-invoice']({ dataset: {} }), { top: true });
  add('new-event', staff ? 'Neuen Termin eintragen' : 'Termin anfragen', 'neu termin frist eintragen anfragen kalender verhandlung', 'calendar', 'modal', () => actions['new-event']({ dataset: {} }), { top: true });
  if (staff) add('new-task', 'Neue Aufgabe', 'neu aufgabe todo erstellen', 'tasks', 'modal', () => actions['task-new']({ dataset: {} }), { top: true });
  if (staff) {
    const duty = myDutyStatus();
    if (duty === 'off') add('duty-on', 'Dienst starten', 'dienst starten einstempeln stempeln anfangen', 'clock', 'do', () => setDutyStatus('dienst'), { top: true });
    else {
      add('duty-off', 'Dienst beenden', 'dienst beenden ausstempeln feierabend ausser', 'clock', 'do', () => setDutyStatus('off'), { top: true });
      if (duty !== 'pause') add('duty-pause', 'Pause machen', 'pause dienst unterbrechen', 'clock', 'do', () => setDutyStatus('pause'));
      if (duty !== 'gericht') add('duty-court', 'Im Gericht', 'gericht dienst verhandlung', 'clock', 'do', () => setDutyStatus('gericht'));
    }
    add('wiki-fall', 'Präzedenzfälle durchsuchen', 'praezedenz praezedenzfaelle fall urteile wiki', 'folder', 'nav', () => { st.wikiTab = 'fall'; return navigate('wiki'); });
    add('wiki-stgb', 'Strafgesetzbuch öffnen', 'strafgesetzbuch stgb gesetz paragraph wiki', 'scale', 'nav', () => { st.wikiTab = 'stgb'; return navigate('wiki'); });
    add('wiki-bausteine', 'Textbausteine öffnen', 'textbausteine vorlagen snippets wiki', 'chat', 'nav', () => { st.wikiTab = 'bausteine'; return navigate('wiki'); });
  }
  if (isAdmin()) add('trash', 'Papierkorb öffnen', 'papierkorb geloeschte akten wiederherstellen', 'trash', 'modal', () => openTrash());
  add('shortcuts', 'Tastenkürzel anzeigen', 'tastenkuerzel kuerzel tastatur hilfe shortcuts', 'info', 'modal', () => shortcutsHelp());
  // Zu jeder Seite im Menü springen
  for (const view of Object.keys(VIEWS)) {
    if (!allowed(view) || view === 'invoice-new') continue;
    const v = VIEWS[view];
    add(`go-${view}`, `Gehe zu ${viewLabel(view)}`, `${viewLabel(view)} ${viewLabel(view, true)} ${v.section || ''} seite oeffnen springen menue`, v.icon || 'folder', 'nav', () => navigate(view));
  }
  add('logout', 'Abmelden', 'abmelden ausloggen logout beenden', 'logout', 'do', () => actions.logout());
  return out;
}

/** Befehle zur Eingabe: jedes Wort muss am Wortanfang eines Stichworts stehen; Treffer im Titel zählen mehr. */
function searchCommands(q, all = false) {
  const words = cmdFold(q).split(/\s+/).filter(Boolean);
  const list = commandList();
  if (!words.length) return all ? list.slice(0, 20) : list.filter((c) => c.top).slice(0, 6);
  return list
    .map((c) => {
      const label = cmdFold(c.label).split(/[^a-z0-9]+/).filter(Boolean);
      const hay = cmdFold(`${c.label} ${c.words}`).split(/[^a-z0-9]+/).filter(Boolean);
      let score = 0;
      for (const w of words) {
        if (label.some((x) => x.startsWith(w))) score += 3;
        else if (hay.some((x) => x.startsWith(w))) score += 1;
        else return null;
      }
      return { c, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, all ? 20 : 4)
    .map((x) => x.c);
}

function gsCmdItem(c) {
  return `<button type="button" class="gs-item gs-cmd" data-action="gs-cmd" data-cmd="${esc(c.id)}">${icon(c.ico)}<span class="main"><span class="title">${esc(c.label)}</span></span><span class="gs-tag">Befehl</span></button>`;
}

/* Zuletzt geöffnete Akten – nur auf diesem Gerät, je Konto, beim Abmelden weg */
const RECENT_KEY = () => `ps.recent:${st.user ? st.user.id : 0}`;
function recentCases() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY()) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && Number.isInteger(x.id)).slice(0, 5) : [];
  } catch {
    return [];
  }
}
function rememberRecent(c) {
  if (!c || !c.id || !st.user) return;
  try {
    const list = [{ id: c.id, nr: c.caseNumber || '', title: c.title || '' }, ...recentCases().filter((x) => x.id !== c.id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY(), JSON.stringify(list));
  } catch {
    /* ohne Speicher gibt es eben keine Liste */
  }
}
function forgetRecent() {
  try {
    localStorage.removeItem(RECENT_KEY());
  } catch {
    /* egal */
  }
}
function recentCasesHtml() {
  const list = recentCases();
  if (!list.length) return '';
  return `<div class="gs-group">Zuletzt geöffnet</div>${list
    .map((x) => `<button type="button" class="gs-item" data-action="gs-recent" data-id="${x.id}">${icon('folder')}<span class="main"><span class="title"><span class="font-mono text-gold">${esc(x.nr)}</span> · ${esc(x.title)}</span></span></button>`)
    .join('')}`;
}

Object.assign(actions, {
  'gs-cmd': async (el) => {
    const c = commandList().find((x) => x.id === el.dataset.cmd);
    if (!c) return;
    if (c.kind === 'modal') return modalInstead(c.run);
    closeModal();
    return c.run();
  },
  'gs-recent': (el) => modalInstead(() => openCase(Number(el.dataset.id))),
});
