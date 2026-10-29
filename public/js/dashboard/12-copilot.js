/*
 * Kanzlei-Dashboard – Co-Pilot in der Akte (nur Kanzlei): zeigt Lücken und Risiken der Akte mit Sprung zur Stelle, fasst
 * den Stand zusammen, beantwortet Fragen („Wann ist die nächste Frist?“, „Was sagt B3?“) und entwirft Texte (Einleitung,
 * Statusnachricht, Übergabe, Verhandlung, Vorhalte, Beweisverzeichnis). Eingebaut und regelbasiert (assistant.js) –
 * kein KI-Dienst, keine Fremdanbindung. Er liest nur die Akte und schreibt nie von selbst hinein.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const CP_LEVEL = { rot: ['dringend', 'red'], gelb: ['beachten', 'amber'], info: ['Hinweis', 'slate'] };
st.cp = { caseId: null, data: null, answer: null, draft: null, showAll: false, open: false };

/** Abschnitt in der Akte: zuerst nur der Rahmen, die Inhalte holt copilotInit. */
function copilotSection(c) {
  if (!isStaff()) return '';
  return `<div class="section cp" id="secCopilot" data-case-id="${c.id}">
      <div class="section-head"><h3 class="section-title">${icon('info', 'ico-sm')} Co-Pilot <span class="text-xs text-dim font-normal sec-meta">liest nur diese Akte · ohne KI-Dienst</span></h3>
        <button type="button" class="btn-ghost btn-sm" data-action="cp-refresh">${icon('restore', 'ico-sm')}<span>Neu prüfen</span></button></div>
      <div class="cp-body" id="cpBody"><div class="cp-top"><span class="cp-chip">Co-Pilot sieht die Akte durch …</span></div></div>
    </div>`;
}

function cpLines(list) {
  return list
    .map((l) =>
      l.heading
        ? `<div class="cp-h">${esc(l.text)}</div>`
        : `<div class="cp-line${l.level ? ` lv-${l.level}` : ''}">${l.level ? `<span class="cp-dot ${l.level}" aria-hidden="true"></span>` : ''}<span>${esc(l.text)}</span>${l.ref ? cpRefButton(l.ref) : ''}</div>`
    )
    .join('');
}
const cpRefButton = (ref) => `<button type="button" class="cp-go" data-action="cp-go" data-type="${esc(ref.type)}" data-id="${ref.id ?? ''}" data-no="${ref.no ?? ''}" title="Zur Stelle springen" aria-label="Zur Stelle springen">${icon('chevronRight', 'ico-sm')}</button>`;

function renderCopilot() {
  const box = $('#cpBody');
  const d = st.cp.data;
  if (!box || !d) return;
  const count = (lv) => d.gaps.filter((g) => g.level === lv).length;
  const shown = st.cp.showAll ? d.gaps : d.gaps.slice(0, 5);
  const chips = ['rot', 'gelb', 'info'].filter(count).map((lv) => `<span class="cp-chip ${lv}">${count(lv)} ${CP_LEVEL[lv][0]}</span>`).join('');
  box.innerHTML = `
      <div class="cp-top">${chips || '<span class="cp-chip ok">Keine Lücken gefunden</span>'}<button type="button" class="btn-ghost btn-sm cp-toggle" data-action="cp-open" aria-expanded="${st.cp.open}">${icon(st.cp.open ? 'chevronUp' : 'chevronDown', 'ico-sm')}<span>${st.cp.open ? 'Zuklappen' : 'Öffnen'}</span></button></div>
      <div class="cp-more" ${st.cp.open ? '' : 'hidden'}>
      ${shown.length ? `<div class="cp-gaps">${cpLines(shown.map((g) => ({ text: g.text, ref: g.ref, level: g.level })))}</div>` : ''}
      ${d.gaps.length > 5 ? `<button type="button" class="btn-ghost btn-sm" data-action="cp-all">${st.cp.showAll ? 'Weniger anzeigen' : `Alle ${d.gaps.length} anzeigen`}</button>` : ''}
      <details class="cp-sum" ${st.cp.sumOpen ? 'open' : ''}><summary>Zusammenfassung der Akte</summary>${d.summary.map((s) => `<div class="cp-h">${esc(s.title)}</div>${cpLines(s.lines)}`).join('')}</details>
      <form data-form="cp-ask" class="cp-ask"><input name="q" class="field" maxlength="300" minlength="2" required placeholder="Frag die Akte … z. B. „Wann ist die nächste Frist?“ oder „Was sagt B3?“" aria-label="Frage an den Co-Pilot" autocomplete="off"><button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Fragen</span></button></form>
      <div class="chip-row cp-chips">${d.questions.map((q) => `<button type="button" class="chip" data-action="cp-q" data-q="${esc(q.label)}">${esc(q.label)}</button>`).join('')}</div>
      <div id="cpAnswer" class="cp-answer" aria-live="polite">${st.cp.answer ? cpAnswerHtml(st.cp.answer) : ''}</div>
      <div class="cp-draftbar"><label class="label" for="cpDraftKind">Entwurf aus den Aktendaten</label>
        <div class="flex flex-wrap gap-2"><select id="cpDraftKind" class="field" style="max-width:320px">${d.drafts.map((x) => opt(x.id, x.label, (st.cp.draft && st.cp.draft.kind) === x.id)).join('')}</select>
        <button type="button" class="btn-outline btn-md" data-action="cp-draft">${icon('edit', 'ico-sm')}<span>Entwurf erstellen</span></button></div></div>
      <div id="cpDraft">${st.cp.draft ? cpDraftHtml(st.cp.draft) : ''}</div>
      </div>`;
}
const cpAnswerHtml = (a) => `<div class="cp-card"><div class="cp-card-title">${esc(a.title)}</div>${cpLines(a.lines)}${
  a.unknown ? '' : ''
}</div>`;
const cpDraftHtml = (x) => `<div class="cp-card"><div class="cp-card-title">${esc(x.title)} <span class="text-xs text-dim font-normal">Entwurf – bitte prüfen und anpassen</span></div>
    <textarea id="cpDraftText" class="field cp-draft-text" rows="12" aria-label="${esc(x.title)}">${esc(x.text)}</textarea>
    <div class="flex flex-wrap gap-2 mt-2"><button type="button" class="btn-outline btn-sm" data-action="cp-copy">${icon('copy', 'ico-sm')}<span>Kopieren</span></button>
      <button type="button" class="btn-ghost btn-sm" data-action="cp-note">${icon('pin', 'ico-sm')}<span>Als interne Notiz speichern</span></button>
      ${x.kind === 'statusnachricht' ? `<button type="button" class="btn-ghost btn-sm" data-action="cp-chat">${icon('send', 'ico-sm')}<span>In den Chat einfügen</span></button>` : ''}</div></div>`;

/** Nach dem Öffnen/Neuzeichnen der Akte: Analyse holen und anzeigen. */
async function copilotInit(caseId) {
  if (!isStaff() || !$('#cpBody')) return;
  if (st.cp.caseId !== caseId) st.cp = { caseId, data: null, answer: null, draft: null, showAll: false, sumOpen: false };
  try {
    st.cp.data = await api.get(`/api/cases/${caseId}/copilot`);
  } catch {
    if ($('#cpBody')) $('#cpBody').innerHTML = '<p class="text-sm text-dim">Der Co-Pilot ist gerade nicht erreichbar.</p>';
    return;
  }
  if (st.modalCaseId === caseId) renderCopilot();
}

function cpFlash(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: window.PS.motion.calm() ? 'auto' : 'smooth' });
  el.classList.remove('cp-flash');
  void el.offsetWidth;
  el.classList.add('cp-flash');
}

Object.assign(actions, {
  'cp-refresh': () => copilotInit(st.modalCaseId),
  // Zugeklappt (Standard) bleibt die Akte ruhig: nur die Zeile mit den Zahlen, kein Springen beim Nachladen
  'cp-open': () => {
    st.cp.open = !st.cp.open;
    renderCopilot();
  },
  'cp-all': () => {
    st.cp.showAll = !st.cp.showAll;
    renderCopilot();
  },
  'cp-q': async (el) => {
    st.cp.open = true;
    const f = $('form[data-form="cp-ask"]');
    if (f) f.elements.q.value = el.dataset.q;
    await forms['cp-ask'](f || { dataset: {}, elements: { q: { value: el.dataset.q } } });
  },
  // Sprung zur Stelle in der Akte
  'cp-go': async (el) => {
    const { type, id, no } = el.dataset;
    if (type === 'event') return openEvent(Number(id), st.modalCaseId);
    if (type === 'task') {
      const t = (st.caseTasks || []).find((x) => x.id === Number(id));
      if (t) {
        st.returnCase = st.modalCaseId;
        await Promise.all([load.lawyers(), load.cases()]);
        return taskModal(t);
      }
    }
    if (type === 'witness') return cpFlash($(`#wit${id}`) || $('#secWitnesses'));
    if (type === 'evidence') return actions['ev-open']({ dataset: { no } });
    if (type === 'invoice') return window.open(`/rechnung?id=${id}`, '_blank', 'noopener');
    if (type === 'precedent') return openPrecedent(Number(id), { child: true });
    if (type === 'chat') return cpFlash($('#secChat'));
    return cpFlash($('.case-head') || $('#modalBody'));
  },
  'cp-draft': async () => {
    const kind = $('#cpDraftKind').value;
    const r = await api.post(`/api/cases/${st.modalCaseId}/copilot/draft`, { kind });
    st.cp.draft = { ...r.draft, kind };
    $('#cpDraft').innerHTML = cpDraftHtml(st.cp.draft);
    $('#cpDraftText').focus();
  },
  'cp-copy': async () => {
    try {
      await navigator.clipboard.writeText($('#cpDraftText').value);
      toast('Entwurf kopiert.');
    } catch {
      $('#cpDraftText').select();
      toast('Bitte mit Strg+C kopieren.', 'error');
    }
  },
  // Der Entwurf wird erst durch diesen Klick zur Notiz – der Co-Pilot schreibt nie von selbst in die Akte
  'cp-note': async () => {
    const body = `${st.cp.draft.title} (Entwurf):\n${$('#cpDraftText').value}`.slice(0, 4000);
    await api.post(`/api/cases/${st.modalCaseId}/notes`, { body, internal: true });
    toast('Als interne Notiz gespeichert.');
    await reloadCase(st.modalCaseId);
  },
  'cp-chat': () => {
    const box = $('#secChat .chat-input');
    if (!box) return;
    box.value = $('#cpDraftText').value.slice(0, 3900);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    cpFlash($('#secChat'));
    box.focus();
    toast('In das Nachrichtenfeld eingefügt – noch nicht gesendet.');
  },
});

Object.assign(forms, {
  'cp-ask': async (f) => {
    const q = f.elements.q.value.trim();
    if (q.length < 2) return;
    const r = await api.post(`/api/cases/${st.modalCaseId}/copilot/ask`, { q });
    st.cp.answer = r.answer;
    if ($('#cpAnswer')) {
      $('#cpAnswer').innerHTML = cpAnswerHtml(r.answer);
      if (r.answer.intent === 'stand') st.cp.sumOpen = true;
    }
  },
});
