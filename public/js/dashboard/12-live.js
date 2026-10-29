/*
 * Kanzlei-Dashboard – gemeinsames Arbeiten: Was ein Kollege gerade geändert hat, leuchtet nach der Live-Aktualisierung kurz
 * auf („Michael hat die Akte aktualisiert“), und beim gleichzeitigen Bearbeiten desselben Feldes warnt das Dashboard,
 * statt still zu überschreiben („Jemand war schneller“ – Neuen Stand behalten oder die eigene Änderung speichern).
 * Die Live-Verbindung selbst (Server-Ereignisse, „wer ist hier“, „tippt gerade“) steht in 14-start.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Konflikte beim gleichzeitigen Bearbeiten */
const EDIT_LABEL = {
  title: 'Titel', area: 'Rechtsgebiet', urgency: 'Dringlichkeit', description: 'Sachverhalt', clientName: 'Mandant', clientPhone: 'Telefon', opponent: 'Gegenpartei',
  courtRef: 'Gerichtsaktenzeichen', step: 'Stand', status: 'Status', priority: 'Priorität', publicNote: 'Statushinweis', lawyerId: 'zuständiger Anwalt',
  note: 'Notiz', dueDate: 'Fälligkeit', assignedTo: 'Zuständige Person', done: 'Erledigt',
};
const editShown = (field, v) => {
  if (v === null || v === undefined || v === '') return 'leer';
  if (field === 'area') return AREAS[v] || v;
  if (field === 'step') return STEPS[Number(v)] || v;
  if (field === 'status') return (CASE_STATUS[v] || [v])[0];
  if (field === 'done') return v ? 'ja' : 'nein';
  if (field === 'priority') return (PRIORITY[Number(v)] || [v])[0];
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
};

/** Werte aus der geöffneten Akte, die das Dashboard zuletzt sah – nur für die Felder der Änderung. */
function caseExpect(id, body) {
  const c = st.caseInfo;
  if (!c || c.id !== id) return undefined;
  const seen = { title: c.title, area: c.area, urgency: c.urgency, description: c.description, clientName: c.clientName, clientPhone: c.clientPhone, opponent: c.opponent, courtRef: c.courtRef, step: c.step, publicNote: c.publicNote, status: c.status, priority: c.priority, lawyerId: c.lawyerId };
  const out = {};
  for (const k of Object.keys(body)) if (k in seen) out[k] = seen[k] ?? null;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Wie api.patch, aber mit „expect“: Hat inzwischen jemand anderes eines der Felder geändert, fragt das Dashboard nach, statt
 * still zu überschreiben. expect: ausdrücklich der Wert, den man zuletzt sah (sonst aus der geöffneten Akte).
 */
async function guardedPatch(url, body, expect, { reload } = {}) {
  const send = (withExpect) => api.patch(url, withExpect && expect ? { ...body, expect } : body);
  try {
    return await send(true);
  } catch (err) {
    if (err.status !== 409 || !err.conflict) throw err;
    const lines = err.conflict.map((x) => `• ${EDIT_LABEL[x.field] || x.field}: jetzt „${editShown(x.field, x.current)}“`).join('\n');
    const overwrite = await ask(`${lines}\n\nHier steht inzwischen etwas anderes, als du gesehen hast. Soll deine Änderung den neuen Stand überschreiben?`, {
      title: 'Jemand war schneller',
      confirmText: 'Meine Änderung speichern',
      cancelText: 'Neuen Stand behalten',
    });
    if (!overwrite) {
      if (reload) await Promise.resolve(reload()).catch(() => {});
      throw Object.assign(new Error('Nicht gespeichert – hier steht jetzt der neue Stand.'), { status: 409 });
    }
    return send(false);
  }
}

/** Akte ändern (Aktenkopf, Direktbearbeitung, Stand) mit Schutz vor gleichzeitigem Bearbeiten. */
async function casePatch(id, body, expect = caseExpect(id, body)) {
  const r = await guardedPatch('/api/cases/' + id, body, expect, { reload: () => reloadCase(id) });
  if (r && r.case && st.caseInfo && st.caseInfo.id === id) Object.assign(st.caseInfo, r.case);
  return r;
}

/* ---------------------------------------------------------------- Aufleuchten nach der Live-Aktualisierung */
/**
 * Zustand der sichtbaren Teile vor dem Neuzeichnen: Abschnitte der Akte, Zeugen, Aufgaben, Termine, Akten- und Aufgabenzeilen.
 * Schlüssel = Art und Nummer, Wert = Kurzfassung des Textes.
 */
const FLASH_ITEMS = '.section[id], .wit-card[id], [data-action="open-case"][data-id], [data-action="task-edit"][data-id], [data-action="open-event"][data-id]';
function liveSnap(root) {
  const snap = new Map();
  if (!root) return snap;
  for (const el of $$(FLASH_ITEMS, root)) {
    const key = el.id || `${el.dataset.action}:${el.dataset.id}`;
    snap.set(key, (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400));
  }
  return snap;
}
/** Nach dem Neuzeichnen: neue und geänderte Teile kurz hervorheben; by = wer geändert hat (nur Kanzlei bekommt den Namen). */
function liveFlash(root, before, by) {
  if (!root || !before) return;
  const calm = window.PS.motion.calm();
  let n = 0;
  for (const el of $$(FLASH_ITEMS, root)) {
    const key = el.id || `${el.dataset.action}:${el.dataset.id}`;
    const now = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (before.has(key) && before.get(key) === now) continue;
    // Abschnitte nur, wenn sie schon vorher da waren (sonst blitzt beim ersten Laden alles auf) und nichts Kleineres darin geändert ist
    if (!before.size) continue;
    const target = el.matches('[data-action]') ? el.closest('.list-row, tr, .task-row, .event-row, .card, article') || el : el;
    if (target.classList.contains('section') && $$('.wit-card, [data-action="task-edit"], [data-action="open-event"]', target).some((x) => x.classList.contains('live-flash'))) continue;
    target.classList.remove('live-flash', 'live-flash-static');
    void target.offsetWidth;
    target.classList.add(calm ? 'live-flash-static' : 'live-flash');
    setTimeout(() => target.classList.remove('live-flash', 'live-flash-static'), calm ? 3000 : 2400);
    n++;
  }
  if (n && by) liveByChip(by);
}
function liveByChip(by) {
  const head = $('#modalBody .case-head') || $('#modalBody');
  if (!head || !$('#modal.open')) return;
  $('#liveBy')?.remove();
  const chip = document.createElement('div');
  chip.id = 'liveBy';
  chip.className = 'live-by';
  chip.setAttribute('role', 'status');
  chip.textContent = `${by} hat die Akte aktualisiert`;
  head.prepend(chip);
  setTimeout(() => chip.remove(), 6000);
}
