/*
 * Kanzlei-Dashboard – Beweismittel mit festen B-Nummern: Art, Herkunft, Zeitpunkt, Lager (belastend/entlastend/neutral),
 * Stand (gesichert/eingereicht/bestritten/ausgeschlossen) und Beschreibung. Dazu die Beweisliste (Tabelle), das
 * Verzeichnis zum Kopieren und klickbare Verweise „B7“ in allen Texten der Akte (Chat, Notizen, Zeugen, Vorhalte).
 * Die Einschätzung (Lager, Stand, Herkunft, Beschreibung) sieht nur die Kanzlei.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const EV_KIND = { foto: 'Foto', screenshot: 'Screenshot', dokument: 'Dokument', bodycam: 'Bodycam / Video', sonstiges: 'Sonstiges' };
const EV_STATUS = { gesichert: ['Gesichert', 'slate'], eingereicht: ['Eingereicht', 'emerald'], bestritten: ['Bestritten', 'amber'], ausgeschlossen: ['Ausgeschlossen', 'red'] };
const EV_SIDE = { belastend: ['belastend', 'red'], entlastend: ['entlastend', 'emerald'], neutral: ['neutral', 'slate'] };

const evView = () => {
  try {
    return localStorage.getItem('ps.evView') === 'liste' ? 'liste' : 'kacheln';
  } catch {
    return 'kacheln';
  }
};

/** Lager und Stand als kleine Marken (nur Kanzlei; „gesichert“ ist der Normalfall und bleibt unsichtbar). */
function evChips(a) {
  if (!isStaff()) return '';
  return `${a.side ? statusBadge(EV_SIDE, a.side) : ''}${a.status && a.status !== 'gesichert' ? statusBadge(EV_STATUS, a.status) : ''}`;
}

/** Zeile „Art · erhoben am … · Herkunft“ für Lightbox und Vorschau. */
function evMetaLine(a) {
  return [a.kindLabel || EV_KIND[a.kind] || '', a.obtainedAt ? `erhoben ${fmtDate(a.obtainedAt)}` : '', a.source ? `Herkunft: ${a.source}` : ''].filter(Boolean).map(esc).join(' · ');
}

/** Beschreibung, Lager und Stand im Detailfenster (nur Kanzlei). */
function evDetails(a) {
  if (!isStaff()) return '';
  return `<div class="ev-meta">${evChips(a) || badge('gesichert', 'slate')}${a.description ? `<p>${esc(a.description)}</p>` : ''}</div>`;
}

/** Umschalter Kacheln/Liste und „Verzeichnis kopieren“ über den Beweismitteln (nur Kanzlei). */
function evidenceToolbar(attachments) {
  if (!isStaff() || !attachments.length) return '';
  const v = evView();
  return `<div class="ev-toolbar"><div class="chip-row" role="tablist" aria-label="Darstellung der Beweismittel">
      <button type="button" class="chip ${v === 'kacheln' ? 'active' : ''}" role="tab" aria-selected="${v === 'kacheln'}" data-action="ev-view" data-value="kacheln">${icon('image', 'ico-sm')}<span>Kacheln</span></button>
      <button type="button" class="chip ${v === 'liste' ? 'active' : ''}" role="tab" aria-selected="${v === 'liste'}" data-action="ev-view" data-value="liste">${icon('list', 'ico-sm')}<span>Beweisliste</span></button></div>
      <button type="button" class="btn-ghost btn-sm" data-action="ev-copy">${icon('copy', 'ico-sm')}<span>Verzeichnis kopieren</span></button></div>`;
}

/** Beweisliste: eine Zeile je Beweismittel mit allen Angaben auf einen Blick. */
function evidenceTable(c, attachments) {
  return `<div class="tbl-wrap"><table class="tbl ev-table"><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Art</th><th>Lager</th><th>Stand</th><th>Erhoben</th><th></th></tr></thead><tbody>${attachments
    .map(
      (a) => `<tr>
        <td><button type="button" class="ev-ref" data-action="ev-open" data-no="${a.no}">B${a.no}</button></td>
        <td>${esc(a.caption || '–')}${a.internal ? ' <span class="stamp-mini">Vertraulich</span>' : ''}${a.source ? `<div class="text-xs text-dim">Herkunft: ${esc(a.source)}</div>` : ''}</td>
        <td>${esc(a.kindLabel || EV_KIND[a.kind] || '')}</td>
        <td>${a.side ? statusBadge(EV_SIDE, a.side) : '<span class="text-dim">–</span>'}</td>
        <td>${statusBadge(EV_STATUS, a.status || 'gesichert')}</td>
        <td class="nowrap">${a.obtainedAt ? esc(fmtDate(a.obtainedAt)) : '<span class="text-dim">–</span>'}</td>
        <td class="nowrap">${c.canEdit ? `<button type="button" class="icon-btn sm" data-action="ev-edit" data-id="${a.id}" aria-label="B${a.no} beschreiben" title="Beschreiben">${icon('edit', 'ico-sm')}</button>` : ''}</td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

/** Verzeichnis als Text, z. B. für den Schriftsatz: „B1 – Bodycam-Standbild (Bodycam / Video, erhoben …)“. */
function evidenceText() {
  return (st.caseAttachments || [])
    .map((a) => {
      const info = [a.kindLabel || EV_KIND[a.kind], a.obtainedAt ? `erhoben ${fmtDate(a.obtainedAt)}` : '', a.source ? `Herkunft: ${a.source}` : ''].filter(Boolean).join(', ');
      return `B${a.no} – ${a.caption || 'ohne Bezeichnung'}${info ? ` (${info})` : ''}`;
    })
    .join('\n');
}

function evidenceForm(caseId, a) {
  return `<p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Beweismittel B${a.no}</p>
    <h2 class="modal-title">Beweismittel beschreiben</h2>
    <form data-form="ev-save" data-case-id="${caseId}" data-id="${a.id}" class="form-grid cols-2">
      <div class="span-2"><label class="label" for="evCaption">Bezeichnung</label><input id="evCaption" name="caption" class="field" maxlength="200" value="${esc(a.caption)}" placeholder="z. B. Standbild Bodycam, Tatort von Norden" autofocus></div>
      <div><label class="label" for="evKind">Art</label><select id="evKind" name="kind" class="field">${Object.entries(EV_KIND).map(([k, l]) => opt(k, l, a.kind === k)).join('')}</select></div>
      <div><label class="label" for="evAt">Aufgenommen / erhoben am</label><input id="evAt" name="obtainedAt" type="datetime-local" class="field" value="${a.obtainedAt ? esc(toLocalInput(a.obtainedAt)) : ''}"></div>
      <div class="span-2"><label class="label" for="evSource">Herkunft</label><input id="evSource" name="source" class="field" maxlength="200" value="${esc(a.source || '')}" placeholder="Wer hat es erhoben oder geliefert? z. B. Mandant, Polizeiakte, FiveNet-Dokument"></div>
      <div><label class="label" for="evSide">Lager</label><select id="evSide" name="side" class="field">${opt('', 'noch offen', !a.side)}${Object.entries(EV_SIDE).map(([k, [l]]) => opt(k, l, a.side === k)).join('')}</select><p class="form-hint">Wem nützt das Beweismittel?</p></div>
      <div><label class="label" for="evStatus">Stand</label><select id="evStatus" name="status" class="field">${Object.entries(EV_STATUS).map(([k, [l]]) => opt(k, l, (a.status || 'gesichert') === k)).join('')}</select></div>
      <div class="span-2"><label class="label" for="evDesc">Beschreibung</label><textarea id="evDesc" name="description" rows="4" maxlength="2000" class="field" placeholder="Was zeigt es, was belegt es, was ist zu beachten?">${esc(a.description || '')}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

const evById = (id) => (st.caseAttachments || []).find((a) => a.id === id);

Object.assign(actions, {
  'ev-view': (el) => {
    try {
      localStorage.setItem('ps.evView', el.dataset.value === 'liste' ? 'liste' : 'kacheln');
    } catch {
      /* ohne Speicher gilt die Darstellung nur bis zum Neuladen */
    }
    if (st.modalCaseId) reloadCase(st.modalCaseId);
  },
  'ev-copy': async () => {
    const text = evidenceText();
    try {
      await navigator.clipboard.writeText(text);
      toast('Beweisverzeichnis kopiert.');
    } catch {
      toast('Kopieren hat nicht geklappt – bitte den Text von Hand markieren.', 'error');
    }
  },
  // „B7“ angeklickt (Verweis im Text oder Nummer in der Liste): Beweismittel in der Großansicht öffnen
  'ev-open': (el) => {
    const i = (st.caseAttachments || []).findIndex((a) => a.no === Number(el.dataset.no));
    if (i >= 0) actions['att-open']({ dataset: { index: String(i) }, classList: { contains: () => false } });
  },
  'ev-edit': (el) => {
    const a = evById(Number(el.dataset.id));
    if (a && isStaff()) openModal(evidenceForm(st.modalCaseId || st.returnCase, a), { wide: true, child: true });
  },
  // Aus der Großansicht: erst zurück zur Akte, dann das Formular darüber
  'ev-edit-box': async (el) => {
    st.returnCase = st.modalCaseId || st.returnCase;
    await modalDismiss(returnOrClose);
    actions['ev-edit'](el);
  },
});

Object.assign(forms, {
  'ev-save': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const fd = new FormData(f);
    const at = val(fd, 'obtainedAt');
    await api.patch(`/api/cases/${caseId}/attachments/${f.dataset.id}`, {
      caption: val(fd, 'caption'),
      kind: val(fd, 'kind'),
      source: val(fd, 'source'),
      obtainedAt: at ? new Date(at).toISOString() : null,
      side: val(fd, 'side'),
      status: val(fd, 'status'),
      description: val(fd, 'description'),
    });
    toast('Beweismittel gespeichert.');
    await modalBack();
    await reloadCase(caseId);
  },
});

/*
 * Verweise „B7“ in Texten der geöffneten Akte werden zu Knöpfen, die das Beweismittel öffnen – nur wenn es diese Nummer
 * in der Akte gibt und die Person es sehen darf. Ein Beobachter am Fenster erledigt das auch für neue Chat-Nachrichten.
 */
function linkEvidenceRefs(root) {
  const nos = new Set((st.caseAttachments || []).map((a) => a.no));
  if (!root || !nos.size) return;
  const SKIP = 'script, style, textarea, input, select, option, button, a, label, .att, .ev-no, .dp-no, .modal-title, .ev-ref';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!/\bB\d/.test(n.data) || (n.parentElement && n.parentElement.closest(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode() && nodes.length < 200) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let i = 0;
    let hit = false;
    for (const m of n.data.matchAll(/\bB(\d{1,3})\b/g)) {
      if (!nos.has(Number(m[1]))) continue;
      hit = true;
      frag.append(n.data.slice(i, m.index));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ev-ref';
      b.dataset.action = 'ev-open';
      b.dataset.no = m[1];
      b.title = `Beweismittel B${m[1]} öffnen`;
      b.textContent = m[0];
      frag.append(b);
      i = m.index + m[0].length;
    }
    if (!hit) continue;
    frag.append(n.data.slice(i));
    n.replaceWith(frag);
  }
}
{
  const pending = new Set();
  let scheduled = false;
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.closest && n.closest('#modalBody') && !n.classList.contains('ev-ref')) pending.add(n);
    if (!pending.size || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const nodes = [...pending];
      pending.clear();
      for (const n of nodes) if (n.isConnected) linkEvidenceRefs(n);
    });
  }).observe(document.body, { childList: true, subtree: true });
}
