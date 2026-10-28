/*
 * Kanzlei-Dashboard – Einstellungen: Listen (Rechtsgebiete mit Schritten, Checkliste, Ergebnissen und Zusatzfeldern im
 * Mandatsformular). Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html).
 */
'use strict';

const AREA_COLOR_LABEL = { gold: 'Gold', sky: 'Blau', emerald: 'Grün', amber: 'Orange', red: 'Rot', violet: 'Violett', slate: 'Grau' };
const AREA_TONE = { gold: 'gold', sky: 'sky', emerald: 'emerald', amber: 'amber', red: 'red', violet: 'violet', slate: 'slate' };

async function loadLists() {
  st.lists = await api.get('/api/areas');
}
async function refreshAreas() {
  await loadLists();
  const me = await api.get('/api/auth/me');
  setAreas(me.areas);
}

function listsPanels() {
  if (!st.lists) return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  return areasPanel();
}

function areasPanel() {
  const list = st.lists.areas;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Rechtsgebiete</h2><button type="button" class="btn-gold btn-sm" data-action="area-new">${icon('plus', 'ico-sm')}<span>Neues Rechtsgebiet</span></button></div>
      <p class="text-sm text-muted mb-4">Alles, was zu einem Rechtsgebiet gehört, an einer Stelle: Name, Kürzel, Farbe, Symbol, Kurztitel für Website-Anfragen, Verfahrensschritte, Checkliste, passende Ergebnisse und Zusatzfragen im Mandatsformular. Umbenennen zieht überall mit; <strong>Ausblenden statt Löschen</strong> – bestehende Akten behalten ihr Rechtsgebiet.</p>
      <div class="area-list">${list.map((a, i) => areaCard(a, i, list.length)).join('')}</div>
    </section>`;
}

function areaCard(a, i, n) {
  const u = a.usage;
  return `<div class="area-card ${a.active ? '' : 'is-off'}" data-key="${esc(a.key)}">
      <span class="area-dot tone-${esc(a.color)}" aria-hidden="true">${icon(a.icon, 'ico-sm')}</span>
      <div class="area-main">
        <div class="area-name"><strong>${esc(a.name)}</strong>${a.short ? `<span class="area-short">${esc(a.short)}</span>` : ''}${a.active ? '' : badge('ausgeblendet', 'slate')}</div>
        <div class="area-meta">Website: „${esc(a.intakeTitle)}“ · ${u.cases} ${u.cases === 1 ? 'Akte' : 'Akten'}${u.packages ? ` · ${u.packages} Aufgaben-${u.packages === 1 ? 'Paket' : 'Pakete'}` : ''}${a.fields.length ? ` · ${a.fields.length} Zusatz${a.fields.length === 1 ? 'frage' : 'fragen'}` : ''}${a.customSteps ? ' · eigene Schritte' : ''}</div>
      </div>
      <div class="area-btns">
        <button type="button" class="icon-btn sm" data-action="area-move" data-key="${esc(a.key)}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="area-move" data-key="${esc(a.key)}" data-dir="1" aria-label="Nach unten" ${i === n - 1 ? 'disabled' : ''}>${icon('chevronDown', 'ico-sm')}</button>
        <button type="button" class="btn-outline btn-sm" data-action="area-edit" data-key="${esc(a.key)}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="area-toggle" data-key="${esc(a.key)}">${a.active ? 'Ausblenden' : 'Einblenden'}</button>
        ${u.cases || u.packages ? '' : `<button type="button" class="icon-btn sm fn-danger" data-action="area-delete" data-key="${esc(a.key)}" data-name="${esc(a.name)}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>`}
      </div>
    </div>`;
}

const areaFieldRow = (f = { key: '', label: '', type: 'text', required: false, hint: '', options: [] }) => `<div class="area-field" ${f.key ? `data-key="${esc(f.key)}"` : ''}>
    <input class="field" data-f="label" maxlength="80" value="${esc(f.label)}" placeholder="Frage / Bezeichnung (z. B. Tatort)" aria-label="Bezeichnung">
    <select class="field" data-f="type" aria-label="Art des Feldes">${Object.entries(st.lists.fieldTypes).map(([k, l]) => opt(k, l, f.type === k)).join('')}</select>
    <label class="check"><input type="checkbox" data-f="required" ${f.required ? 'checked' : ''}> Pflicht</label>
    <input class="field" data-f="hint" maxlength="200" value="${esc(f.hint)}" placeholder="Hinweis unter dem Feld (optional)" aria-label="Hinweis">
    <input class="field" data-f="options" maxlength="600" value="${esc((f.options || []).join(', '))}" placeholder="Auswahl: Möglichkeiten, durch Komma getrennt" aria-label="Möglichkeiten der Auswahl">
    <button type="button" class="icon-btn sm" data-action="area-field-del" aria-label="Feld entfernen">${icon('trash', 'ico-sm')}</button>
  </div>`;

function areaFormHtml(a) {
  const L = st.lists;
  const steps = a && a.customSteps ? a.steps : L.defaultSteps;
  return `<h2 class="modal-title">${a ? `Rechtsgebiet: ${esc(a.name)}` : 'Neues Rechtsgebiet'}</h2>
    <p class="modal-sub">${a ? 'Änderungen gelten sofort – auch für bestehende Akten (Name, Schritte).' : 'Nach dem Anlegen erscheint es in Formularen und auf der Website.'}</p>
    <form data-form="area-save" ${a ? `data-key="${esc(a.key)}"` : ''} class="form-grid cols-2">
      <div><label class="label" for="arName">Name</label><input id="arName" name="name" class="field" required minlength="2" maxlength="50" value="${esc(a ? a.name : '')}" placeholder="z. B. Verkehrsrecht"></div>
      <div><label class="label" for="arShort">Kürzel (bis 6 Zeichen)</label><input id="arShort" name="short" class="field" maxlength="6" value="${esc(a ? a.short : '')}" placeholder="VRK"></div>
      <div><label class="label" for="arColor">Farbe</label><select id="arColor" name="color" class="field">${L.colors.map((c) => opt(c, AREA_COLOR_LABEL[c] || c, a ? a.color === c : c === 'gold')).join('')}</select></div>
      <div><label class="label" for="arIcon">Symbol</label><select id="arIcon" name="icon" class="field">${L.icons.map((c) => opt(c, c, a ? a.icon === c : c === 'scale')).join('')}</select></div>
      <div class="span-2"><label class="label" for="arIntake">Kurztitel für Website-Anfragen</label><input id="arIntake" name="intakeTitle" class="field" maxlength="80" value="${esc(a ? a.intakeTitle : '')}" placeholder="z. B. Verkehrsrecht / Unfall"><p class="form-hint">So heißt das Rechtsgebiet in der Auswahl der Website und im Titel neuer Akten („Verkehrsrecht / Unfall – Max Muster“).</p></div>
      <label class="check span-2"><input type="checkbox" name="active" ${!a || a.active ? 'checked' : ''}> Eingeschaltet (in Formularen und auf der Website wählbar)</label>
      <div class="span-2"><div class="label">Verfahrensschritte</div>
        <label class="check"><input type="checkbox" name="stdSteps" ${a && a.customSteps ? '' : 'checked'} data-action="area-steps-toggle"> Standard verwenden (${esc(L.defaultSteps.join(' → '))})</label>
        <div class="area-steps ${a && a.customSteps ? '' : 'hidden'}" id="arSteps">${steps.map((s, i) => `<input class="field" data-step="${i}" maxlength="30" value="${esc(s)}" aria-label="Schritt ${i + 1}" placeholder="Schritt ${i + 1}">`).join('')}</div>
        <p class="form-hint">Vier Schritte; danach folgt immer „Abgeschlossen“.</p></div>
      <div class="span-2"><label class="label" for="arCheck">Checkliste (ein Punkt je Zeile)</label><textarea id="arCheck" name="checklist" class="field" rows="6" maxlength="3000" placeholder="Mandantengespräch führen">${esc(a ? a.checklist.join('\n') : '')}</textarea><p class="form-hint">Wird in der Akte unter „Aufgaben → Checkliste“ als Aufgaben übernommen.</p></div>
      <div class="span-2"><div class="label">Ergebnisse beim Abschluss</div><p class="form-hint mt-0">Nichts angehakt = alle Ergebnisse stehen zur Wahl.</p>
        <div class="area-outcomes">${L.outcomes.map((o) => `<label class="check"><input type="checkbox" name="outcome" value="${esc(o.key)}" ${a && a.outcomes.includes(o.key) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></div>
      <div class="span-2"><div class="label">Zusatzfragen im Mandatsformular</div><p class="form-hint mt-0">Erscheinen auf der Website und im Dashboard, sobald dieses Rechtsgebiet gewählt ist; die Antworten stehen in der Akte unter „Angaben zum Mandat“. Pflichtfragen gelten für Mandanten und Website-Anfragen.</p>
        <div id="arFields">${(a ? a.fields : []).map(areaFieldRow).join('')}</div>
        <button type="button" class="btn-outline btn-sm mt-2" data-action="area-field-add">${icon('plus', 'ico-sm')}<span>Frage hinzufügen</span></button></div>
      ${a ? `<div class="span-2 form-hint">Aufgaben-Pakete für dieses Rechtsgebiet (${a.usage.packages}) pflegen Sie in der Akte unter „Aufgaben → Pakete“; Standardgebühren in der Honorarordnung.</div>` : ''}
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${a ? 'Speichern' : 'Anlegen'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

const areaSlug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

function collectArea(f) {
  const fd = new FormData(f);
  const used = new Set([...f.querySelectorAll('.area-field[data-key]')].map((r) => r.dataset.key));
  const fields = [];
  for (const row of f.querySelectorAll('.area-field')) {
    const label = row.querySelector('[data-f="label"]').value.trim();
    if (!label) continue;
    let key = row.dataset.key;
    if (!key) {
      const base = `f_${areaSlug(label) || 'feld'}`;
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
    }
    fields.push({
      key,
      label,
      type: row.querySelector('[data-f="type"]').value,
      required: row.querySelector('[data-f="required"]').checked,
      hint: row.querySelector('[data-f="hint"]').value.trim(),
      options: row.querySelector('[data-f="options"]').value.split(',').map((x) => x.trim()).filter(Boolean),
    });
  }
  return {
    name: val(fd, 'name'),
    short: val(fd, 'short'),
    color: val(fd, 'color'),
    icon: val(fd, 'icon'),
    intakeTitle: val(fd, 'intakeTitle'),
    active: fd.has('active'),
    steps: fd.has('stdSteps') ? null : [...f.querySelectorAll('[data-step]')].map((i) => i.value.trim()),
    checklist: String(fd.get('checklist') || '').split('\n').map((x) => x.trim()).filter(Boolean),
    outcomes: fd.getAll('outcome'),
    fields,
  };
}

Object.assign(actions, {
  'area-new': () => openModal(areaFormHtml(null), { wide: true }),
  'area-edit': (el) => openModal(areaFormHtml(st.lists.areas.find((a) => a.key === el.dataset.key)), { wide: true }),
  'area-steps-toggle': (el) => $('#arSteps').classList.toggle('hidden', el.checked),
  'area-field-add': (el) => $('#arFields').insertAdjacentHTML('beforeend', areaFieldRow()),
  'area-field-del': (el) => el.closest('.area-field').remove(),
  'area-toggle': async (el) => {
    const a = st.lists.areas.find((x) => x.key === el.dataset.key);
    await api.put(`/api/areas/${a.key}`, { ...areaPayload(a), active: !a.active });
    await refreshAreas();
    toast(a.active ? `„${a.name}“ ausgeblendet – bestehende Akten behalten es.` : `„${a.name}“ eingeblendet.`);
    renderView();
  },
  'area-move': async (el) => {
    const keys = st.lists.areas.map((a) => a.key);
    const i = keys.indexOf(el.dataset.key);
    const j = i + Number(el.dataset.dir);
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    await api.put('/api/areas/order', { keys });
    await refreshAreas();
    renderView();
  },
  'area-delete': async (el) => {
    if (!(await askDelete('Rechtsgebiet löschen?', `„${el.dataset.name}“ wird gelöscht. Das geht nur, weil keine Akte und kein Paket daran hängt.`))) return;
    await api.del(`/api/areas/${el.dataset.key}`);
    await refreshAreas();
    toast('Rechtsgebiet gelöscht.');
    renderView();
  },
});

/** Die gespeicherten Werte eines Rechtsgebiets als Eingabe für PUT (z. B. nur „aktiv“ umschalten). */
const areaPayload = (a) => ({ name: a.name, short: a.short, color: a.color, icon: a.icon, intakeTitle: a.intakeTitle, active: a.active, steps: a.customSteps ? a.steps : null, checklist: a.checklist, outcomes: a.outcomes, fields: a.fields });

Object.assign(forms, {
  'area-save': async (f) => {
    const body = collectArea(f);
    if (f.dataset.key) await api.put(`/api/areas/${f.dataset.key}`, body);
    else await api.post('/api/areas', body);
    await refreshAreas();
    toast(f.dataset.key ? 'Rechtsgebiet gespeichert.' : 'Rechtsgebiet angelegt.');
    await modalBack();
    renderView();
  },
});
