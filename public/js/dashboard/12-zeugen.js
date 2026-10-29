/*
 * Kanzlei-Dashboard – Zeugenverwaltung in der Akte: Lager (belastend/entlastend/neutral), Stand der Befragung, Ladungstermin
 * (mit Übernahme in den Kalender), erwartete und tatsächliche Aussage und Vorhalte (Widersprüche zu Aussagen oder Beweisen).
 * Zeugen sind Beteiligte der Akte mit der Rolle „Zeuge“ (siehe parties.js); nur die Kanzlei sieht sie.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const WITNESS_STATUS = { offen: ['Offen', 'slate'], kontaktiert: ['Kontaktiert', 'sky'], geladen: ['Geladen', 'amber'], ausgesagt: ['Ausgesagt', 'emerald'], nicht_erreichbar: ['Nicht erreichbar', 'red'] };
const WITNESS_SIDE = { belastend: ['belastend', 'red'], entlastend: ['entlastend', 'emerald'], neutral: ['neutral', 'slate'] };

/** Zeugen einer Akte (nur Kanzlei): Karten mit Stand, Ladung, Aussage und Vorhalten. */
function witnessesSection(c, parties = []) {
  if (!isStaff()) return '';
  const list = parties.filter((p) => p.role === 'zeuge');
  if (!list.length && !c.canEdit) return '';
  const add = c.canEdit ? `<button type="button" class="btn-outline btn-sm" data-action="wit-add" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Zeuge hinzufügen</span></button>` : '';
  const refs = [...list.map((p) => `Aussage ${p.name}`), ...(st.caseAttachments || []).map((a) => `B${a.no}`)];
  return `<div class="section" id="secWitnesses"><div class="section-head"><h3 class="section-title">Zeugen <span class="text-xs text-dim font-normal sec-meta">${list.length ? `${list.length} erfasst` : 'noch keine'}</span></h3>${add}</div>
      ${list.length ? `<div class="wit-list">${list.map((p) => witnessCard(c, p, refs)).join('')}</div>` : '<p class="text-sm text-dim">Zeugen mit Kontakt, Ladung, Aussage und Vorhalten verwalten – damit nichts vor der Verhandlung offen bleibt.</p>'}
    </div>`;
}

function witnessCard(c, p, refs) {
  const summon = p.summonAt ? `<span class="wit-summon">${icon('calendar', 'ico-sm')}Ladung ${esc(fmtDate(p.summonAt))}</span>` : '';
  const conflict = (p.overlaps || []).length ? `<div class="party-warn">${icon('alert', 'ico-sm')}<div>${esc(p.name)} ist in ${p.overlaps.map((o) => `<button type="button" class="ov-link" data-action="open-case" data-id="${o.caseId}">${esc(o.caseNumber)}</button>`).join(', ')} <strong>Mandant</strong> – bitte auf Interessenkonflikt prüfen.</div></div>` : '';
  const contra = p.contradictions || [];
  return `<article class="wit-card" id="wit${p.id}">
      <header class="wit-head"><div class="wit-name"><strong>${esc(p.name)}</strong>${p.contact ? `<span class="wit-contact">${esc(p.contact)}</span>` : ''}</div>
        <div class="wit-badges">${statusBadge(WITNESS_STATUS, p.status)}${p.side ? statusBadge(WITNESS_SIDE, p.side) : ''}${summon}</div></header>
      ${conflict}
      ${p.expected ? `<div class="wit-block"><div class="k">Erwartete Aussage</div><p>${esc(p.expected)}</p></div>` : ''}
      ${p.statement ? `<details class="wit-block" ${p.status === 'ausgesagt' ? 'open' : ''}><summary class="k">Aussage</summary><p class="wit-statement">${esc(p.statement)}</p></details>` : ''}
      ${
        contra.length
          ? `<div class="wit-block"><div class="k">Vorhalte (${contra.length})</div><ul class="wit-contra">${contra
              .map(
                (x) => `<li><span class="wit-contra-text">${esc(x.text)}${x.ref ? ` <span class="wit-ref">${esc(x.ref)}</span>` : ''}</span>
                  ${c.canEdit ? `<button type="button" class="icon-btn sm" data-action="wit-contra-del" data-case-id="${c.id}" data-id="${p.id}" data-cid="${x.id}" aria-label="Vorhalt entfernen">${icon('x', 'ico-sm')}</button>` : ''}</li>`
              )
              .join('')}</ul></div>`
          : ''
      }
      ${
        c.canEdit
          ? `<div class="wit-actions">
        <button type="button" class="btn-ghost btn-sm" data-action="wit-edit" data-case-id="${c.id}" data-id="${p.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="wit-summon" data-case-id="${c.id}" data-id="${p.id}">${icon('calendar', 'ico-sm')}<span>Ladung im Kalender</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="wit-contra-toggle" data-id="${p.id}">${icon('plus', 'ico-sm')}<span>Vorhalt</span></button>
        <button type="button" class="icon-btn sm push" data-action="party-del" data-case-id="${c.id}" data-id="${p.id}" aria-label="Zeugen entfernen" title="Entfernen">${icon('trash', 'ico-sm')}</button></div>
        <form data-form="wit-contra" data-case-id="${c.id}" data-id="${p.id}" class="wit-contra-form hidden" id="witContra${p.id}">
          <input name="text" class="field" required minlength="3" maxlength="1000" placeholder="Widerspruch oder Vorhalt, z. B. „sagt 22 Uhr, Bodycam zeigt 22:14“" aria-label="Vorhalt">
          <input name="ref" class="field" maxlength="80" list="witRefs${p.id}" placeholder="Bezug (optional): B3, Aussage …" aria-label="Bezug"><datalist id="witRefs${p.id}">${refs.filter((r) => r !== `Aussage ${p.name}`).map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
          <button type="submit" class="btn-outline btn-sm">${icon('check', 'ico-sm')}<span>Speichern</span></button></form>`
          : ''
      }
    </article>`;
}

function witnessForm(caseId, p) {
  const v = p || { name: '', contact: '', side: '', status: 'offen', summonAt: null, expected: '', statement: '' };
  return `<h2 class="modal-title">${p ? `Zeuge: ${esc(p.name)}` : 'Zeuge hinzufügen'}</h2>
    <form data-form="wit-save" data-case-id="${caseId}" ${p ? `data-id="${p.id}"` : ''} class="form-grid cols-2">
      <div><label class="label" for="witName">Name</label><input id="witName" name="name" class="field" required minlength="2" maxlength="120" value="${esc(v.name)}" autofocus></div>
      <div><label class="label" for="witContact">Kontakt</label><input id="witContact" name="contact" class="field" maxlength="160" value="${esc(v.contact)}" placeholder="Telefon, Discord …"></div>
      <div><label class="label" for="witSide">Lager</label><select id="witSide" name="side" class="field">${opt('', 'noch offen', !v.side)}${Object.entries(WITNESS_SIDE).map(([k, [l]]) => opt(k, l, v.side === k)).join('')}</select><p class="form-hint">Wem nützt die Aussage voraussichtlich?</p></div>
      <div><label class="label" for="witStatus">Stand</label><select id="witStatus" name="status" class="field">${Object.entries(WITNESS_STATUS).map(([k, [l]]) => opt(k, l, v.status === k)).join('')}</select></div>
      <div class="span-2"><label class="label" for="witSummon">Ladung / Termin der Aussage</label><input id="witSummon" name="summonAt" type="datetime-local" class="field" value="${v.summonAt ? esc(toLocalInput(v.summonAt)) : ''}"><p class="form-hint">Im Kalender eintragen: „Ladung im Kalender“ an der Karte.</p></div>
      <div class="span-2"><label class="label" for="witExpected">Erwartete Aussage</label><textarea id="witExpected" name="expected" rows="3" maxlength="2000" class="field" placeholder="Was wird die Person voraussichtlich sagen?">${esc(v.expected)}</textarea></div>
      <div class="span-2"><label class="label" for="witStatement">Aussage (tatsächlich)</label><textarea id="witStatement" name="statement" rows="5" maxlength="6000" class="field" placeholder="Wörtlich oder sinngemäß – nach der Befragung">${esc(v.statement)}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${p ? 'Speichern' : 'Hinzufügen'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

const witnessById = (caseId, id) => ((st.caseInfo && st.caseInfo.id === caseId && st.caseParties) || []).find((p) => p.id === id);

Object.assign(actions, {
  'wit-add': (el) => openModal(witnessForm(Number(el.dataset.caseId), null), { wide: true, child: true }),
  'wit-edit': (el) => {
    const p = witnessById(Number(el.dataset.caseId), Number(el.dataset.id));
    if (p) openModal(witnessForm(Number(el.dataset.caseId), p), { wide: true, child: true });
  },
  'wit-contra-toggle': (el) => {
    const f = $(`#witContra${el.dataset.id}`);
    if (!f) return;
    f.classList.toggle('hidden');
    if (!f.classList.contains('hidden')) f.querySelector('input').focus();
  },
  'wit-contra-del': async (el) => {
    const caseId = Number(el.dataset.caseId);
    await api.del(`/api/cases/${caseId}/parties/${el.dataset.id}/contradictions/${el.dataset.cid}`);
    toast('Vorhalt entfernt.');
    await reloadCase(caseId);
  },
  // Ladung in den Kalender: das Formular für neue Einträge, mit Zeugen, Akte und Zeit vorbelegt
  'wit-summon': async (el) => {
    const caseId = Number(el.dataset.caseId);
    const p = witnessById(caseId, Number(el.dataset.id));
    if (!p) return;
    st.returnCase = caseId;
    await Promise.all([load.cases(), load.lawyers()]);
    openModal(eventForm(null, { caseId, type: 'gericht', title: `Zeugenladung: ${p.name}`, start: p.summonAt ? toLocalInput(p.summonAt) : '', note: [p.contact ? `Kontakt: ${p.contact}` : '', p.expected ? `Erwartete Aussage: ${p.expected}` : ''].filter(Boolean).join('\n') }));
  },
});

Object.assign(forms, {
  'wit-save': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const fd = new FormData(f);
    const summon = val(fd, 'summonAt');
    const body = {
      role: 'zeuge',
      name: val(fd, 'name'),
      contact: val(fd, 'contact'),
      side: val(fd, 'side'),
      status: val(fd, 'status'),
      summonAt: summon ? new Date(summon).toISOString() : null,
      expected: val(fd, 'expected'),
      statement: val(fd, 'statement'),
    };
    if (f.dataset.id) await api.patch(`/api/cases/${caseId}/parties/${f.dataset.id}`, body);
    else await api.post(`/api/cases/${caseId}/parties`, body);
    toast(f.dataset.id ? 'Zeuge gespeichert.' : 'Zeuge hinzugefügt.');
    await modalBack();
    await reloadCase(caseId);
  },
  'wit-contra': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const fd = new FormData(f);
    await api.post(`/api/cases/${caseId}/parties/${f.dataset.id}/contradictions`, { text: val(fd, 'text'), ref: val(fd, 'ref') });
    toast('Vorhalt gespeichert.');
    await reloadCase(caseId);
  },
});
