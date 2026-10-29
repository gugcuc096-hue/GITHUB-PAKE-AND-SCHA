/*
 * Kanzlei-Dashboard – Präzedenzfälle: Reiter im Kanzlei-Wiki (durchsuchbar nach Rechtsgebiet, Ergebnis, Schlagwort,
 * Paragraph) sowie in der Akte „Ähnliche Fälle“ und „Als Präzedenzfall festhalten“. Nur Kanzlei (siehe precedents.js).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const precOutcomes = () => Object.entries(OUTCOMES).map(([k, v]) => [k, v[0]]);
const precOutcomeBadge = (p) => (p.outcomeLabel ? badge(p.outcomeLabel, p.success === true ? 'emerald' : p.success === false ? 'red' : 'slate') : '');
const precSentence = (p) => [p.sentenceHe != null ? `${Number(p.sentenceHe).toLocaleString('de-DE')} HE` : '', p.sentenceFine != null ? money(p.sentenceFine) : ''].filter(Boolean).join(' · ');

async function loadPrecedents() {
  const q = new URLSearchParams();
  if (st.precQ) q.set('q', st.precQ);
  if (st.precArea) q.set('area', st.precArea);
  if (st.precOutcome) q.set('outcome', st.precOutcome);
  if (st.precTag) q.set('tag', st.precTag);
  st.precedents = await api.get(`/api/precedents${q.toString() ? `?${q}` : ''}`);
}

function precedentCard(p) {
  const sentence = precSentence(p);
  return `<button type="button" class="panel prec-card" data-action="prec-open" data-id="${p.id}">
      <span class="prec-top"><span class="wiki-cat">${esc(p.areaLabel || 'ohne Rechtsgebiet')}</span>${precOutcomeBadge(p)}</span>
      <span class="wiki-card-title">${esc(p.title)}</span>
      ${p.summary ? `<span class="wiki-card-text">${esc(p.summary)}</span>` : ''}
      <span class="prec-meta">${sentence ? `<span class="prec-sentence">${esc(sentence)}</span>` : ''}${p.paragraphs.map((x) => `<span class="prec-chip prec-para">${esc(x)}</span>`).join('')}${p.tags.map((x) => `<span class="prec-chip">${esc(x)}</span>`).join('')}</span>
    </button>`;
}

function precedentList() {
  const list = (st.precedents && st.precedents.precedents) || [];
  const filtered = st.precQ || st.precArea || st.precOutcome || st.precTag;
  if (!list.length) return `<div class="panel">${empty(filtered ? 'Kein Präzedenzfall passt zu dieser Auswahl.' : 'Noch keine Präzedenzfälle – nach Abschluss einer Akte „Als Präzedenzfall festhalten“ wählen.', 'scale')}</div>`;
  return `<div class="wiki-grid">${list.map(precedentCard).join('')}</div>`;
}

/** Reiter „Präzedenzfälle“ im Kanzlei-Wiki. */
function precedentsPanel() {
  const meta = st.precedents || { tags: [] };
  return `<p class="text-sm text-muted mb-4">Abgeschlossene Fälle als Wissen der Kanzlei: Was wurde vorgeworfen, was hat funktioniert, wie ging es aus? In jeder Akte erscheinen daraus „Ähnliche Fälle“ (gleiche Paragraphen und Rechtsgebiet). Keine Namen von Mandanten eintragen – der Sachverhalt bleibt anonym.</p>
    <div class="wiki-tools">
      <label class="search">${icon('search')}<input id="precSearch" class="field" type="search" placeholder="Fälle suchen: Paragraph, Argument, Schlagwort …" value="${esc(st.precQ || '')}" autocomplete="off" aria-label="Präzedenzfälle suchen"></label>
      <div class="prec-filters">
        <select class="field" data-prec-filter="precArea" aria-label="Rechtsgebiet">${opt('', 'Alle Rechtsgebiete', !st.precArea)}${areaOptions().map(([k, l]) => opt(k, l, st.precArea === k)).join('')}</select>
        <select class="field" data-prec-filter="precOutcome" aria-label="Ergebnis">${opt('', 'Alle Ergebnisse', !st.precOutcome)}${precOutcomes().map(([k, l]) => opt(k, l, st.precOutcome === k)).join('')}</select>
      </div>
      ${meta.tags.length ? `<div class="chip-row">${[['', 'Alle']].concat(meta.tags.map((t) => [t.tag, `${t.tag} · ${t.n}`])).map(([k, l]) => `<button type="button" class="chip ${(st.precTag || '') === k ? 'active' : ''}" data-action="prec-tag" data-tag="${esc(k)}">${esc(l)}</button>`).join('')}</div>` : ''}
    </div>
    <div id="precList">${precedentList()}</div>`;
}

async function openPrecedent(id, { child = false } = {}) {
  const { precedent: p, canEdit } = await api.get(`/api/precedents/${id}`);
  const block = (k, v) => (v ? `<div class="prec-block"><div class="k">${esc(k)}</div><p>${esc(v)}</p></div>` : '');
  const sentence = precSentence(p);
  openModal(
    `<p class="wiki-cat">${esc(p.areaLabel || 'ohne Rechtsgebiet')}</p>
      <h2 class="modal-title mt-2">${esc(p.title)}</h2>
      <p class="modal-sub">${precOutcomeBadge(p)}${sentence ? ` <span class="prec-sentence">${esc(sentence)}</span>` : ''} · Stand ${esc(fmtDate(p.updatedAt))}${p.createdBy ? ` · ${esc(p.createdBy)}` : ''}</p>
      <div class="prec-meta mb-4">${p.paragraphs.map((x) => `<span class="prec-chip prec-para">${esc(x)}</span>`).join('')}${p.tags.map((x) => `<span class="prec-chip">${esc(x)}</span>`).join('')}</div>
      ${block('Sachverhalt', p.summary)}${block('Argumente – was hat funktioniert?', p.arguments)}${block('Ergebnis', p.result)}${block('Nachbesprechung – was lief gut, was nicht?', p.lessons)}
      <div class="form-actions mt-5">
        ${p.caseNumber ? `<button type="button" class="btn-outline btn-md" data-action="open-case-from-prec" data-id="${p.caseId}">${icon('folder', 'ico-sm')}<span>Akte ${esc(p.caseNumber)}</span></button>` : ''}
        ${canEdit ? `<button type="button" class="btn-ghost btn-md" data-action="prec-edit" data-id="${p.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button type="button" class="btn-ghost btn-md" data-action="prec-delete" data-id="${p.id}" data-title="${esc(p.title)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
      </div>`,
    { wide: true, child }
  );
}

function precedentForm(p, { child = false } = {}) {
  const v = p || { title: '', area: '', summary: '', arguments: '', result: '', lessons: '', outcome: '', sentenceHe: null, sentenceFine: null, paragraphs: [], tags: [], caseId: null };
  const join = (a) => (Array.isArray(a) ? a.join(', ') : a || '');
  return `<h2 class="modal-title">${p && p.id ? 'Präzedenzfall bearbeiten' : 'Präzedenzfall festhalten'}</h2>
    <p class="modal-sub">Anonym halten: keine Namen von Mandanten oder Beteiligten.</p>
    <form data-form="prec-save" ${p && p.id ? `data-id="${p.id}"` : ''} data-case-id="${v.caseId || ''}" data-child="${child ? 1 : 0}" class="form-grid cols-2">
      <div class="span-2"><label class="label" for="prTitle">Titel</label><input id="prTitle" name="title" class="field" required minlength="3" maxlength="140" value="${esc(v.title)}" placeholder="z. B. Verkehrskontrolle mit unvollständigen Papieren" autofocus></div>
      <div><label class="label" for="prArea">Rechtsgebiet</label><select id="prArea" name="area" class="field">${opt('', 'ohne', !v.area)}${areaOptions(v.area).map(([k, l]) => opt(k, l, v.area === k)).join('')}</select></div>
      <div><label class="label" for="prOutcome">Ergebnis</label><select id="prOutcome" name="outcome" class="field">${opt('', 'offen', !v.outcome)}${precOutcomes().map(([k, l]) => opt(k, l, v.outcome === k)).join('')}</select></div>
      <div><label class="label" for="prHe">Strafmaß (HE)</label><input id="prHe" name="sentenceHe" type="number" min="0" max="100000" class="field" value="${v.sentenceHe ?? ''}"></div>
      <div><label class="label" for="prFine">Geldstrafe ($)</label><input id="prFine" name="sentenceFine" type="number" min="0" class="field" value="${v.sentenceFine ?? ''}"></div>
      <div><label class="label" for="prParas">Paragraphen (Komma)</label><input id="prParas" name="paragraphs" class="field" maxlength="300" value="${esc(join(v.paragraphs))}" placeholder="§ 12, § 14"></div>
      <div><label class="label" for="prTags">Schlagworte (Komma)</label><input id="prTags" name="tags" class="field" maxlength="300" value="${esc(join(v.tags))}" placeholder="Rennen, Vorstrafe, Geständnis"></div>
      <div class="span-2"><label class="label" for="prSummary">Sachverhalt in Kürze</label><textarea id="prSummary" name="summary" rows="4" maxlength="3000" class="field">${esc(v.summary)}</textarea></div>
      <div class="span-2"><label class="label" for="prArgs">Argumente – was hat funktioniert?</label><textarea id="prArgs" name="arguments" rows="4" maxlength="4000" class="field" placeholder="Verteidigungslinie, überzeugende Beweise, Verhalten vor Gericht …">${esc(v.arguments)}</textarea></div>
      <div class="span-2"><label class="label" for="prResult">Ergebnis im Wortlaut</label><textarea id="prResult" name="result" rows="2" maxlength="2000" class="field">${esc(v.result)}</textarea></div>
      <div class="span-2"><label class="label" for="prLessons">Nachbesprechung – was lief gut, was nicht?</label><textarea id="prLessons" name="lessons" rows="3" maxlength="3000" class="field" placeholder="Was würden wir nächstes Mal anders machen?">${esc(v.lessons)}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

/** In der Akte: Präzedenzfall festhalten bzw. ansehen und „Ähnliche Fälle“. */
function precedentStrip(c, similar = [], precedentId = null) {
  if (!isStaff()) return '';
  const own = precedentId
    ? `<button type="button" class="btn-ghost btn-sm" data-action="prec-open" data-child="1" data-id="${precedentId}">${icon('scale', 'ico-sm')}<span>Präzedenzfall ansehen</span></button>`
    : c.closed && c.canEdit
      ? `<button type="button" class="btn-outline btn-sm" data-action="prec-from-case" data-case-id="${c.id}">${icon('scale', 'ico-sm')}<span>Als Präzedenzfall festhalten</span></button>`
      : '';
  if (!similar.length && !own) return '';
  return `<details class="prec-strip mb-4" id="precStrip" ${similar.length ? 'open' : ''}><summary>${icon('scale', 'ico-sm')}<span>Ähnliche Fälle <span class="text-dim">${similar.length ? `(${similar.length})` : '(keine)'}</span></span></summary>
      ${similar.length ? `<div class="prec-similar">${similar.map((p) => `<button type="button" class="prec-row" data-action="prec-open" data-child="1" data-id="${p.id}"><span class="prec-row-title">${esc(p.title)}</span><span class="prec-row-meta">${precOutcomeBadge(p)}${p.sharedParagraphs ? `<span class="prec-chip prec-para">${p.sharedParagraphs} gleiche${p.sharedParagraphs === 1 ? 'r' : ''} Paragraph${p.sharedParagraphs === 1 ? '' : 'en'}</span>` : ''}${precSentence(p) ? `<span class="prec-sentence">${esc(precSentence(p))}</span>` : ''}</span></button>`).join('')}</div>` : '<p class="text-sm text-dim">Noch kein Präzedenzfall mit gleichen Paragraphen oder Rechtsgebiet.</p>'}
      ${own ? `<div class="mt-2">${own}</div>` : ''}</details>`;
}

Object.assign(actions, {
  'prec-open': (el) => openPrecedent(Number(el.dataset.id), { child: el.dataset.child === '1' }),
  'prec-new': () => openModal(precedentForm(null), { wide: true }),
  'prec-edit': async (el) => {
    const { precedent } = await api.get(`/api/precedents/${el.dataset.id}`);
    openModal(precedentForm(precedent), { wide: true });
  },
  'prec-from-case': async (el) => {
    const { draft, existingId } = await api.get(`/api/precedents/draft/${el.dataset.caseId}`);
    if (existingId) return openPrecedent(existingId, { child: true });
    openModal(precedentForm(draft, { child: true }), { wide: true, child: true });
  },
  'prec-delete': async (el) => {
    if (!(await askDelete('Präzedenzfall löschen?', `„${el.dataset.title}“ wird gelöscht. Die Akte bleibt unverändert.`))) return;
    await api.del(`/api/precedents/${el.dataset.id}`);
    toast('Präzedenzfall gelöscht.');
    await modalBack();
    if (st.view === 'wiki' && st.wikiTab === 'fall') {
      await loadPrecedents();
      renderView();
    } else if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
  'prec-tag': async (el) => {
    st.precTag = el.dataset.tag || '';
    await loadPrecedents();
    renderView();
  },
  'open-case-from-prec': (el) => openCase(Number(el.dataset.id)),
});

Object.assign(forms, {
  'prec-save': async (f) => {
    const fd = new FormData(f);
    const num = (k) => (val(fd, k) === '' ? null : Number(val(fd, k)));
    const body = {
      title: val(fd, 'title'),
      area: val(fd, 'area'),
      outcome: val(fd, 'outcome'),
      sentenceHe: num('sentenceHe'),
      sentenceFine: num('sentenceFine'),
      paragraphs: val(fd, 'paragraphs'),
      tags: val(fd, 'tags'),
      summary: val(fd, 'summary'),
      arguments: val(fd, 'arguments'),
      result: val(fd, 'result'),
      lessons: val(fd, 'lessons'),
    };
    if (f.dataset.caseId) body.caseId = Number(f.dataset.caseId);
    if (f.dataset.id) await api.patch(`/api/precedents/${f.dataset.id}`, body);
    else await api.post('/api/precedents', body);
    toast(f.dataset.id ? 'Präzedenzfall gespeichert.' : 'Präzedenzfall festgehalten.');
    await modalBack();
    if (st.view === 'wiki' && st.wikiTab === 'fall') {
      await loadPrecedents();
      renderView();
    } else if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
});

// Suche und Filter: Liste vom Server neu holen, das Eingabefeld behält den Fokus
let precTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'precSearch') return;
  st.precQ = e.target.value;
  clearTimeout(precTimer);
  precTimer = setTimeout(async () => {
    await loadPrecedents();
    const box = $('#precList');
    if (box) box.innerHTML = precedentList();
  }, 200);
});
document.addEventListener('change', async (e) => {
  const key = e.target.dataset && e.target.dataset.precFilter;
  if (!key) return;
  st[key] = e.target.value;
  await loadPrecedents();
  renderView();
});
