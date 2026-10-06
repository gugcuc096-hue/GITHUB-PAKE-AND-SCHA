/*
 * Kanzlei-Dashboard – Teil 4 von 12: Akte: Verträge, Schriftsätze, externe Dokumente (FiveNet, Google Docs & Sheets) und ihre Reihenfolge.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Verträge (Mandatsvertrag u. a.) */
const CONTRACT_STATUS = { entwurf: ['Entwurf', 'slate'], teilweise: ['Teilweise unterschrieben', 'amber'], unterschrieben: ['Unterschrieben', 'emerald'] };

/** Alle unterzeichnenden Anwälte eines Vertrags – der erste zuerst. */
const contractLawyers = (k) => [
  { userId: k.lawyerId, name: k.lawyerName || k.data.anwalt || '—', signature: k.lawyerSignature, signedAt: k.lawyerSignedAt },
  ...(k.coLawyers || []),
];

function contractCard(k, c) {
  const staff = isStaff();
  const lawyers = contractLawyers(k);
  const signs = [
    ...lawyers.map((l) => (l.signedAt ? `✓ Anwalt (${esc(l.signature)})` : `Anwalt: ${esc(l.name)} – offen`)),
    k.clientSignedAt ? `✓ Mandant (${esc(k.clientSignature)}${k.clientSignedVia === 'kanzlei' ? ', im Spiel' : ''})` : 'Mandant – offen',
  ].join(' · ');
  const mine = staff && lawyers.some((l) => l.userId === st.user.id && !l.signedAt);
  const clientCanSign = !staff && !k.clientSignedAt;
  return `<div class="contract-row">
      <div class="contract-main">
        <div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(k.templateName)}</span>${statusBadge(CONTRACT_STATUS, k.status)}</div>
        <div class="text-xs text-dim mt-1">${signs} · erstellt ${esc(fmtDate(k.createdAt))}${k.createdByName ? ' von ' + esc(k.createdByName) : ''}</div>
      </div>
      <div class="contract-actions">
        <a class="${clientCanSign || mine ? 'btn-gold' : 'btn-outline'} btn-sm" href="/vertrag.html?id=${k.id}" target="_blank" rel="noopener">${icon(clientCanSign || mine ? 'edit' : 'printer', 'ico-sm')}<span>${clientCanSign ? 'Ansehen & unterschreiben' : mine ? 'Ansehen & unterschreiben' : 'Ansehen / PDF'}</span></a>
        ${staff && c.canEdit && !k.locked ? `<button type="button" class="btn-ghost btn-sm" data-action="contract-edit" data-id="${k.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>` : ''}
        ${staff && c.canEdit && !k.clientSignedAt ? `<button type="button" class="btn-ghost btn-sm" data-action="contract-record" data-id="${k.id}" data-case-id="${c.id}">${icon('check', 'ico-sm')}<span>Unterschrift Mandant erfassen</span></button>` : ''}
        ${staff && (isAdmin() || (c.canEdit && !k.locked)) ? `<button type="button" class="btn-ghost btn-sm fn-danger" data-action="contract-delete" data-id="${k.id}" data-case-id="${c.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
      </div>
    </div>`;
}

function contractsSection(c, list) {
  const staff = isStaff();
  if (!staff && !list.length) return '';
  return `<div class="section" id="secContracts">
      <h3 class="section-title">Verträge ${staff && c.canEdit ? `<span class="ext-add"><button type="button" class="btn-outline btn-sm" data-action="contract-new" data-case-id="${c.id}">${icon('doc', 'ico-sm')}<span>Mandatsvertrag erstellen</span></button></span>` : ''}</h3>
      ${list.length
      ? `<div class="stack">${list.map((k) => contractCard(k, c)).join('')}</div>`
      : `<p class="text-sm text-dim">Noch kein Vertrag. „Mandatsvertrag erstellen“ füllt die Vorlage der Kanzlei mit den Daten dieser Akte – danach unterschreiben Anwalt (auf Wunsch mehrere Anwälte) und Mandant (im Portal oder im Spiel), und der Vertrag lässt sich drucken oder als PDF speichern.</p>`}
      ${!staff && list.some((k) => !k.clientSignedAt) ? '<p class="form-hint">Bitte lesen Sie den Vertrag und unterschreiben Sie ihn über „Ansehen &amp; unterschreiben“.</p>' : ''}
    </div>`;
}

/** Formular: Vertrag erstellen (k = null) oder bearbeiten. */
function contractForm(c, { templates, defaults, k = null }) {
  const v = k ? k.data : defaults.data;
  const team = defaults.team || [];
  const lawyers = isAdmin() ? st.lawyers.map((l) => ({ id: l.id, name: l.displayName })) : team;
  const lawyerId = k ? k.lawyerId : defaults.lawyerId;
  st.contractBirths = defaults.births || {};
  // Weitere unterzeichnende Anwälte: gleiche Auswahl wie oben; bereits eingetragene bleiben sichtbar
  const savedCo = k ? k.coLawyers || [] : [];
  const coCandidates = [...lawyers, ...savedCo.filter((x) => x.userId && !lawyers.some((l) => l.id === x.userId)).map((x) => ({ id: x.userId, name: x.name }))];
  const rankOf = (id) => (st.lawyers.find((l) => l.id === id) || savedCo.find((x) => x.userId === id) || {}).rank || '';
  const coRows = coCandidates
    .map((l) => {
      const sel = savedCo.find((x) => x.userId === l.id);
      const isMain = l.id === lawyerId;
      const on = !!sel && !isMain;
      const birth = sel ? sel.birth : st.contractBirths[l.id] || '';
      return `<label class="svc co-row"><input type="checkbox" class="co-check" value="${l.id}" ${on ? 'checked' : ''} ${isMain ? 'disabled' : ''}>
          <span class="svc-name">${esc(l.name)}${rankOf(l.id) ? ` <span class="text-dim">· ${esc(rankOf(l.id))}</span>` : ''} <span class="co-main text-dim" ${isMain ? '' : 'hidden'}>(erster Anwalt)</span></span>
          <input class="field co-birth" maxlength="40" placeholder="Geb. (IC) TT.MM.JJJJ" value="${esc(birth)}" aria-label="Geburtsdatum ${esc(l.name)}" ${on ? '' : 'disabled'}></label>`;
    })
    .join('');
  const maxCo = defaults.maxCoLawyers || 4;
  const field = (name, label, attrs = '', span = false) =>
    `<div class="${span ? 'span-2' : ''}"><label class="label" for="kf_${name}">${esc(label)}</label><input id="kf_${name}" name="${name}" class="field" maxlength="${name.includes('gebuehr') ? 200 : 120}" value="${esc(v[name] || '')}" ${attrs}></div>`;
  // Leistungen aus der Honorarordnung (Mehrfachauswahl, Menge je Leistung); gespeicherte Auswahl beim Bearbeiten wiederherstellen
  const saved = (k && Array.isArray(k.data.services) ? k.data.services : []).map((x) => ({ ...x }));
  const fees = (st.fees || []).map((f) => ({ name: f.name, price: f.price, category: f.category }));
  saved.filter((x) => !fees.some((f) => f.name === x.name)).forEach((x) => fees.push({ name: x.name, price: x.price, category: '_alt' }));
  const cats = { ...FEE_CATEGORIES, _alt: 'Aus diesem Vertrag (nicht mehr in der Honorarordnung)' };
  const svcList = Object.entries(cats)
    .map(([cat, label]) => {
      const list = fees.filter((f) => f.category === cat);
      if (!list.length) return '';
      return `<div class="svc-cat">${esc(label)}</div>${list
        .map((f) => {
          const sel = saved.find((x) => x.name === f.name);
          const price = sel ? sel.price : f.price;
          return `<label class="svc"><input type="checkbox" class="svc-check" data-name="${esc(f.name)}" data-price="${price}" ${sel ? 'checked' : ''}>
              <span class="svc-name">${esc(f.name)}</span>
              <input type="number" class="field svc-qty" min="1" max="99" value="${sel ? sel.qty : 1}" aria-label="Menge ${esc(f.name)}" ${sel ? '' : 'disabled'}>
              <span class="svc-price">${esc(money(price))}</span></label>`;
        })
        .join('')}`;
    })
    .join('');
  return `
      <h2 id="modalTitle" class="modal-title">${k ? `${esc(k.templateName)} bearbeiten` : 'Mandatsvertrag erstellen'}</h2>
      <p class="modal-sub"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.title)}</p>
      <form data-form="${k ? 'contract-edit' : 'contract-new'}" data-case-id="${c.id}" ${k ? `data-id="${k.id}"` : ''} class="form-grid cols-2">
        ${!k && templates.length > 1 ? `<div class="span-2"><label class="label">Vorlage</label><select name="templateId" class="field">${templates.map((t) => opt(t.id, t.name)).join('')}</select></div>` : !k ? `<input type="hidden" name="templateId" value="${templates[0] ? templates[0].id : ''}">` : ''}
        <div class="span-2 form-sub">Anwalt</div>
        <div class="span-2"><label class="label" for="kf_lawyer">Unterzeichnender Anwalt</label><select id="kf_lawyer" name="lawyerId" class="field">${lawyers.map((l) => opt(l.id, l.name, l.id === lawyerId)).join('')}</select>
          <p class="form-hint">Unterschreibt den Vertrag selbst${coCandidates.length > 1 ? ' – weitere unterzeichnende Anwälte lassen sich unten ergänzen' : ''}.</p></div>
        ${field('anwalt', 'Name im Vertrag')}
        ${field('anwalt_rang', 'Rang', 'placeholder="z. B. Senior Associate"')}
        ${field('anwalt_geburtsdatum', 'Geburtsdatum (IC)', 'placeholder="TT.MM.JJJJ"')}
        <div></div>
        <div class="span-2 form-sub">Weitere unterzeichnende Anwälte <span class="text-dim font-normal normal-case tracking-normal">– optional</span></div>
        ${coCandidates.length > 1
        ? `<div class="span-2"><div class="svc-list co-list" id="coList" data-max="${maxCo}">${coRows}</div>
            <p class="form-hint">Bis zu ${maxCo} weitere Anwälte. Jeder unterschreibt selbst; vollständig unterschrieben ist der Vertrag erst, wenn alle Anwälte und der Mandant unterschrieben haben. Name und Rang kommen aus dem Profil, das Geburtsdatum (IC) erscheint im Vertrag.</p></div>`
        : `<p class="span-2 form-hint">Weitere Anwälte können mitunterschreiben, sobald sie der Akte zugewiesen sind (Aktenteam unter „Anwälte der Akte“).</p>`}
        <div class="span-2 form-sub">Mandant</div>
        ${field('mandant', 'Name des Mandanten')}
        ${field('mandant_geburtsdatum', 'Geburtsdatum (IC)', 'placeholder="TT.MM.JJJJ"')}
        <div class="span-2 form-sub">Honorar</div>
        ${svcList ? `<div class="span-2"><div class="label">Leistungen aus der Honorarordnung <span class="text-dim font-normal normal-case tracking-normal">– mehrere wählbar, die Summe wird zur Grundgebühr</span></div>
          <div class="svc-list" id="svcList">${svcList}</div>
          <div class="svc-sum"><span>Summe der Leistungen</span><strong id="svcSum">${esc(money(saved.reduce((sum, x) => sum + x.price * x.qty, 0)))}</strong></div></div>` : ''}
        <div><label class="label" for="kf_grundgebuehr">Grundgebühr</label><input id="kf_grundgebuehr" name="grundgebuehr" class="field" maxlength="200" value="${esc(v.grundgebuehr || '')}" placeholder="z. B. 100.000 $">
          <p class="form-hint">${svcList ? 'Wird aus den gewählten Leistungen berechnet – bei Bedarf anpassbar (z. B. Rabatt).' : 'Betrag in $.'}</p></div>
        ${field('zusatzgebuehr', 'Zusatzgebühr', 'placeholder="z. B. 25.000 $ je weiterem Verhandlungstag"')}
        <div class="span-2 form-sub">Unterzeichnung</div>
        ${field('datum', 'Datum', 'placeholder="TT.MM.JJJJ"')}
        ${field('ort', 'Ort')}
        <p class="span-2 form-hint">Leere Felder erscheinen im Vertrag als Linie zum handschriftlichen Ausfüllen. Nach der ersten Unterschrift ist der Vertrag nicht mehr änderbar.</p>
        <div class="span-2 form-actions">
          <button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>${k ? 'Speichern' : 'Vertrag erstellen'}</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button>
        </div>
      </form>`;
}

async function afterAbsenceChange() {
  st.absences = await api.get('/api/absences');
  if (st.view === 'duty' || st.view === 'overview') renderView();
}

async function refreshSettingsTemplates() {
  st.contractTemplates = await api.get('/api/contract-templates?all=1');
  if (st.view === 'settings') renderView();
}

function contractServices(form) {
  return [...form.querySelectorAll('.svc-check:checked')].map((box) => ({
    name: box.dataset.name,
    price: Number(box.dataset.price) || 0,
    qty: Math.min(99, Math.max(1, Number(box.closest('.svc').querySelector('.svc-qty').value) || 1)),
  }));
}

/** Leistungen geändert: Summe neu berechnen und als Grundgebühr eintragen. */
function updateServiceSum(form) {
  const list = contractServices(form);
  const sum = list.reduce((s, x) => s + x.price * x.qty, 0);
  const out = form.querySelector('#svcSum');
  if (out) out.textContent = money(sum);
  if (list.length && form.elements.grundgebuehr) form.elements.grundgebuehr.value = money(sum);
}

/* ---------------------------------------------------------------- Schriftsätze (Vollmacht, Akteneinsicht, Haftbeschwerde …) */
// Felder, die in Schriftsätzen vorkommen können (sichtbar sind nur die der gewählten Vorlage)
const BRIEF_FIELDS = [
  ['empfaenger', 'Empfänger', 'textarea', 'z. B. District Court San Andreas\nStaatsanwaltschaft Los Santos'],
  ['betreff', 'Betreff / Bezug', 'input', ''],
  ['fivenet_az', 'Aktenzeichen (FiveNet)', 'input', 'DOC - 74412 – oder Link auf das FiveNet-Dokument'],
  ['anwalt', 'Anwalt im Dokument', 'input', ''],
  ['anwalt_rang', 'Rang', 'input', 'z. B. Senior Associate'],
  ['anwalt_geburtsdatum', 'Geburtsdatum Anwalt (IC)', 'input', 'TT.MM.JJJJ'],
  ['mandant', 'Name des Mandanten', 'input', ''],
  ['mandant_geburtsdatum', 'Geburtsdatum Mandant (IC)', 'input', 'TT.MM.JJJJ'],
  ['festnahme', 'Festnahme bzw. Haft', 'input', 'z. B. Festnahme am 01.10.2026, Mission Row'],
  ['begruendung', 'Begründung / eigener Text', 'textarea', 'Leer lassen, wenn der Absatz entfallen soll.'],
  ['datum', 'Datum', 'input', 'TT.MM.JJJJ'],
  ['ort', 'Ort', 'input', ''],
];
/** Wie auf dem Server: wer muss unterschreiben? */
function signatureNeeds(body, kind) {
  const lines = String(body || '').split('\n').map((l) => l.trim().toLowerCase());
  const both = lines.includes('[unterschriften]');
  const lawyer = both || lines.includes('[unterschrift anwalt]');
  const client = both || lines.includes('[unterschrift mandant]');
  if (!lawyer && !client) return kind === 'schriftsatz' ? { lawyer: true, client: false } : { lawyer: true, client: true };
  return { lawyer, client };
}
const usedFields = (body) => new Set([...String(body || '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()));
/** Unter dem FiveNet-Aktenzeichen: die in der Akte hinterlegten FiveNet-Dokumente zum Übernehmen – sonst Hinweis zum manuellen Eintrag. */
function fivenetRefHint(defaults) {
  const docs = defaults.fivenetDocs || [];
  if (!docs.length) return '<p class="form-hint">In dieser Akte ist noch kein FiveNet-Dokument hinterlegt – bitte manuell eintragen (z. B. DOC - 74412). Steht dort „DOC - Nummer“, wird das Aktenzeichen im Dokument zum Link auf die Akte in FiveNet.</p>';
  return `<div class="chip-row fn-refs mt-2">${docs
    .map((d) => `<button type="button" class="chip" data-action="brief-fivenet" data-ref="${esc(d.ref)}" title="${esc(d.title || d.ref)}">${esc(d.ref)}${d.title ? ` · ${esc(d.title.length > 40 ? d.title.slice(0, 39) + '…' : d.title)}` : ''}</button>`)
    .join('')}</div><p class="form-hint">Aus FiveNet-Dokumenten der Akte übernehmen. Im Schriftsatz wird „DOC - Nummer“ zum Link, über den Sachbearbeiter die Akte direkt in FiveNet öffnen.</p>`;
}

function briefCard(k, c) {
  const staff = isStaff();
  const lawyers = k.needsLawyer ? contractLawyers(k) : [];
  const signs = [
    ...lawyers.map((l) => (l.signedAt ? `✓ Anwalt (${esc(l.signature)})` : `Anwalt: ${esc(l.name)} – offen`)),
    ...(k.needsClient ? [k.clientSignedAt ? `✓ Mandant (${esc(k.clientSignature)}${k.clientSignedVia === 'kanzlei' ? ', im Spiel' : ''})` : 'Mandant – offen'] : []),
  ].join(' · ');
  const mine = staff && lawyers.some((l) => l.userId === st.user.id && !l.signedAt);
  const clientCanSign = !staff && k.needsClient && !k.clientSignedAt;
  return `<div class="contract-row">
      <div class="contract-main">
        <div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(k.templateName)}</span>${statusBadge(CONTRACT_STATUS, k.status)}${staff ? (k.internal ? badge('nur intern', 'amber') : badge('für Mandant sichtbar', 'sky')) : ''}</div>
        <div class="text-xs text-dim mt-1">${signs ? signs + ' · ' : ''}erstellt ${esc(fmtDate(k.createdAt))}${k.createdByName ? ' von ' + esc(k.createdByName) : ''}</div>
      </div>
      <div class="contract-actions">
        <a class="${clientCanSign || mine ? 'btn-gold' : 'btn-outline'} btn-sm" href="/vertrag.html?id=${k.id}" target="_blank" rel="noopener">${icon(clientCanSign || mine ? 'edit' : 'printer', 'ico-sm')}<span>${clientCanSign || mine ? 'Ansehen & unterschreiben' : 'Ansehen / PDF'}</span></a>
        ${staff && c.canEdit && !k.locked ? `<button type="button" class="btn-ghost btn-sm" data-action="brief-edit" data-id="${k.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>` : ''}
        ${staff && c.canEdit && !k.needsClient ? `<button type="button" class="btn-ghost btn-sm" data-action="brief-visibility" data-id="${k.id}" data-case-id="${c.id}">${icon(k.internal ? 'eye' : 'shield', 'ico-sm')}<span>${k.internal ? 'Für Mandant freigeben' : 'Nur intern'}</span></button>` : ''}
        ${staff && c.canEdit && k.needsClient && !k.clientSignedAt ? `<button type="button" class="btn-ghost btn-sm" data-action="contract-record" data-id="${k.id}" data-case-id="${c.id}">${icon('check', 'ico-sm')}<span>Unterschrift Mandant erfassen</span></button>` : ''}
        ${staff && (isAdmin() || (c.canEdit && !k.locked)) ? `<button type="button" class="btn-ghost btn-sm fn-danger" data-action="contract-delete" data-id="${k.id}" data-case-id="${c.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
      </div>
    </div>`;
}

function briefsSection(c, list) {
  const staff = isStaff();
  if (!staff && !list.length) return '';
  return `<div class="section" id="secBriefs">
      <h3 class="section-title">Schriftsätze ${staff && c.canEdit ? `<span class="ext-add"><button type="button" class="btn-outline btn-sm" data-action="brief-new" data-case-id="${c.id}">${icon('doc', 'ico-sm')}<span>Schriftsatz erstellen</span></button></span>` : ''}</h3>
      ${list.length
      ? `<div class="stack">${list.map((k) => briefCard(k, c)).join('')}</div>`
      : '<p class="text-sm text-dim">Noch keine Schriftsätze. „Schriftsatz erstellen“ füllt eine Vorlage der Kanzlei – z. B. Vollmacht, Antrag auf Akteneinsicht oder Haftbeschwerde – mit den Daten dieser Akte; danach drucken oder als PDF speichern. Schriftsätze sind zunächst nur für die Kanzlei sichtbar (außer der Mandant muss unterschreiben, z. B. bei der Vollmacht).</p>'}
      ${!staff && list.some((k) => k.needsClient && !k.clientSignedAt) ? '<p class="form-hint">Bitte lesen und unterschreiben Sie das Dokument über „Ansehen &amp; unterschreiben“.</p>' : ''}
    </div>`;
}

function briefForm(c, { templates, defaults, k = null }) {
  const v = k ? k.data : defaults.data;
  const team = defaults.team || [];
  const lawyers = isAdmin() ? st.lawyers.map((l) => ({ id: l.id, name: l.displayName })) : team;
  const lawyerId = k ? k.lawyerId : defaults.lawyerId;
  const field = ([name, label, type, ph]) =>
    `<div class="${type === 'textarea' ? 'span-2' : ''}" data-bf="${name}"><label class="label" for="bf_${name}">${esc(label)}</label>${
      type === 'textarea'
        ? `<textarea id="bf_${name}" name="${name}" rows="${name === 'begruendung' ? 6 : 3}" maxlength="${name === 'begruendung' ? 6000 : 400}" class="field" placeholder="${esc(ph)}">${esc(v[name] || '')}</textarea>`
        : `<input id="bf_${name}" name="${name}" class="field" maxlength="200" value="${esc(v[name] || '')}" placeholder="${esc(ph)}">`
    }${name === 'fivenet_az' ? fivenetRefHint(defaults) : ''}</div>`;
  return `
      <h2 id="modalTitle" class="modal-title">${k ? `${esc(k.templateName)} bearbeiten` : 'Schriftsatz erstellen'}</h2>
      <p class="modal-sub"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.title)}</p>
      <form data-form="${k ? 'brief-edit' : 'brief-new'}" data-case-id="${c.id}" ${k ? `data-id="${k.id}"` : ''} class="form-grid cols-2">
        ${!k ? `<div class="span-2"><label class="label" for="bf_tpl">Vorlage</label><select id="bf_tpl" name="templateId" class="field">${templates.map((t) => opt(t.id, t.name)).join('')}</select></div>` : ''}
        <div class="span-2"><label class="label" for="bf_lawyer">Zuständiger Anwalt</label><select id="bf_lawyer" name="lawyerId" class="field">${lawyers.map((l) => opt(l.id, l.name, l.id === lawyerId)).join('')}</select>
          <p class="form-hint" data-bf-hint="lawyer">Unterschreibt den Schriftsatz selbst (in der Druckansicht).</p></div>
        ${BRIEF_FIELDS.map(field).join('')}
        ${!k ? `<label class="check span-2"><input type="checkbox" name="visible" id="bf_visible"> Für den Mandanten sichtbar (Mandantenportal und Ticket)</label>` : ''}
        <p class="span-2 form-hint">Angezeigt werden nur die Felder, die in der Vorlage vorkommen. Leere Felder erscheinen als Linie zum handschriftlichen Ausfüllen. Nach der ersten Unterschrift ist der Inhalt nicht mehr änderbar.</p>
        <div class="span-2 form-actions">
          <button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>${k ? 'Speichern' : 'Schriftsatz erstellen'}</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button>
        </div>
      </form>`;
}
/** Nur die Felder der gewählten Vorlage zeigen; Sichtbarkeit nach Unterschriften (Mandant muss unterschreiben → sichtbar). */
function syncBriefForm(form) {
  if (!form) return;
  const id = Number(form.elements.templateId ? form.elements.templateId.value : 0);
  const k = form.dataset.id ? (st.caseContracts || []).find((x) => x.id === Number(form.dataset.id)) : null;
  const tpl = k ? { body: k.body || '', kind: 'schriftsatz' } : (st.briefTemplates || []).find((t) => t.id === id);
  if (!tpl) return;
  const needs = signatureNeeds(tpl.body, 'schriftsatz');
  // Unterschriftsfeld nutzt Ort/Datum sowie Name (und Rang) der Unterzeichnenden – auch wenn sie im Text nicht vorkommen
  const used = new Set([...usedFields(tpl.body), 'datum', 'ort', ...(needs.lawyer ? ['anwalt', 'anwalt_rang'] : []), ...(needs.client ? ['mandant'] : [])]);
  $$('[data-bf]', form).forEach((el) => (el.hidden = !used.has(el.dataset.bf)));
  const hint = $('[data-bf-hint="lawyer"]', form);
  if (hint) hint.textContent = needs.lawyer ? 'Unterschreibt den Schriftsatz selbst (in der Druckansicht).' : 'Steht im Dokument; unterschreiben muss nur der Mandant.';
  const vis = $('#bf_visible', form);
  if (vis) {
    vis.checked = needs.client ? true : vis.dataset.touched ? vis.checked : false;
    vis.disabled = needs.client;
    vis.closest('label').title = needs.client ? 'Der Mandant muss unterschreiben – deshalb immer sichtbar.' : '';
  }
}
function briefBody(f) {
  const fd = new FormData(f);
  const data = {};
  BRIEF_FIELDS.forEach(([k]) => {
    const box = f.querySelector(`[data-bf="${k}"]`);
    if (box && !box.hidden) data[k] = String(fd.get(k) || '').trim();
  });
  return { lawyerId: Number(fd.get('lawyerId')), data };
}

function contractBody(f) {
  const fd = new FormData(f);
  const data = {};
  ['anwalt', 'anwalt_rang', 'anwalt_geburtsdatum', 'mandant', 'mandant_geburtsdatum', 'grundgebuehr', 'zusatzgebuehr', 'datum', 'ort'].forEach((k) => (data[k] = val(fd, k)));
  const body = { lawyerId: Number(fd.get('lawyerId')), data };
  if (f.querySelector('#svcList')) body.services = contractServices(f);
  if (f.querySelector('#coList')) {
    body.coLawyers = [...f.querySelectorAll('.co-check:checked')]
      .filter((box) => !box.disabled)
      .map((box) => ({ id: Number(box.value), birth: box.closest('.co-row').querySelector('.co-birth').value.trim() }));
  }
  return body;
}

/* ---------------------------------------------------------------- Externe Dokumente (FiveNet, Google Docs & Google Sheets) */
const EXT = {
  fivenet: { name: 'FiveNet', noun: 'FiveNet-Dokument', badgeCls: 'fn-badge', inputId: 'fnInput' },
  gdocs: { name: 'Google Docs', noun: 'Google-Docs-Dokument', badgeCls: 'fn-badge gd', inputId: 'gdInput', google: true },
  gsheets: { name: 'Google Sheets', noun: 'Google-Sheets-Tabelle', badgeCls: 'fn-badge gs', inputId: 'gdInput', google: true },
};
const extOf = (d) => EXT[d.provider] || EXT.fivenet;
const extUrl = (caseId, linkId = null, suffix = '') => `/api/cases/${caseId}/external${linkId ? '/' + linkId : ''}${suffix}`;

function externalDocCard(d, c, sortable = false) {
  const staff = isStaff();
  const p = extOf(d);
  const gd = !!p.google;
  const sheet = d.provider === 'gsheets';
  const gid = sheet && d.documentId.includes('#gid=') ? d.documentId.split('#gid=')[1] : '';
  const canManage = staff && (d.linkedById === st.user.id || c.canEdit);
  const meta = [
    d.docType,
    sheet ? (gid ? `Tabellenblatt-ID ${gid}` : 'erstes Tabellenblatt') : null,
    gd ? (d.documentId.startsWith('e/') ? 'im Web veröffentlicht' : null) : `Dokument-ID ${d.documentId}`,
    d.docDate ? `erstellt ${fmtDateOnly(d.docDate)}` : null,
    d.docAuthor || null,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const images = st.caseAttachments.map((a, i) => ({ a, i })).filter(({ a }) => a.externalDocId === d.id);
  const rows = sheet && d.contentText ? d.contentText.split('\n').filter(Boolean).length : 0;
  const content = d.contentText
    ? `<details class="fn-text"><summary>${icon(sheet ? 'table' : 'doc', 'ico-sm')}<span>${sheet ? 'Tabelle anzeigen' : 'Abschrift anzeigen'}</span><span class="text-dim text-xs">${sheet ? `${rows.toLocaleString('de-DE')} Zeile${rows === 1 ? '' : 'n'}` : `${d.contentText.length.toLocaleString('de-DE')} Zeichen`} · Stand ${esc(fmtDate(d.contentAt))}${d.contentByName ? ' · ' + esc(d.contentByName) : ''}</span></summary>
          ${sheet ? sheetTable(d.contentText) : `<div class="fn-pre">${esc(d.contentText)}</div>`}
          <div class="fn-actions"><button type="button" class="btn-ghost btn-sm" data-action="fn-copy-text" data-id="${d.id}">${icon('copy', 'ico-sm')}<span>${sheet ? 'Tabelle kopieren (für Excel/Sheets)' : 'Text kopieren'}</span></button>
            <a class="btn-ghost btn-sm" href="${extUrl(c.id, d.id, '/text')}" download>${icon('download', 'ico-sm')}<span>Als Textdatei</span></a></div>
          <p class="form-hint">Abschrift – maßgeblich ist das Original in ${esc(p.name)}; spätere Änderungen dort sind hier erst nach „Aktualisieren“ enthalten.</p></details>`
    : '';
  const gallery = images.length
    ? `<div class="att-grid fn-gallery">${images
        .map(({ a, i }) => `<button type="button" class="att" data-action="att-open" data-index="${i}" aria-label="${esc(a.caption || 'Bild ansehen')}"><img src="${esc(a.url)}" alt="${esc(a.caption)}" loading="lazy"></button>`)
        .join('')}</div>`
    : '';
  const also = staff && d.alsoIn && d.alsoIn.length
    ? `<div class="fn-foot">Auch verknüpft mit: ${d.alsoIn
        .map((o) => `<button type="button" class="link-btn font-mono" data-action="open-case" data-id="${o.id}" title="${esc(o.title)}">${esc(o.caseNumber)}</button>`)
        .join(', ')}</div>`
    : '';
  const linkedOn = esc(parseDate(d.linkedAt)?.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) || '—');
  return `<div class="fn-doc ${gd ? `is-${esc(d.provider)}` : ''}" data-doc-id="${d.id}">
      <div class="fn-head">
        ${sortable ? `<button type="button" class="fn-grip" aria-label="Verschieben: gedrückt halten und ziehen – oder mit den Pfeiltasten ↑ ↓" title="Gedrückt halten und nach oben oder unten ziehen">${icon('grip', 'ico-sm')}</button>` : ''}
        <span class="${p.badgeCls}">${esc(p.name)}</span>
        <div class="fn-main"><div class="fn-title">${esc(d.title || `${p.noun}${gd ? '' : ' ' + d.documentId}`)}</div><div class="fn-meta">${meta}</div></div>
        ${staff && d.internal ? badge('intern', 'amber') : ''}
      </div>
      ${d.summary ? `<p class="fn-summary">${esc(d.summary)}</p>` : ''}
      ${content}
      ${gallery}
      <div class="fn-foot">Quelle: ${esc(p.name)} (${esc(d.host)}) · Verknüpft von ${esc(d.linkedByName)} am ${linkedOn}${staff && d.viewedAs ? ` · eingesehen als „${esc(d.viewedAs)}“` : ''}</div>
      ${also}
      <div class="fn-actions">
        <a class="btn-outline btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${icon('external', 'ico-sm')}<span>In ${esc(p.name)} öffnen</span></a>
        ${staff ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-cite" data-id="${d.id}">${icon('copy', 'ico-sm')}<span>Zitat kopieren</span></button>` : ''}
        ${staff && gd ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}" data-reload="1">${icon('download', 'ico-sm')}<span>${d.contentText ? 'Aktualisieren' : 'Inhalt laden'}</span></button>` : ''}
        ${staff && !gd && !d.contentText ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}" data-focus="fnContent">${icon('doc', 'ico-sm')}<span>Text & Bilder übernehmen</span></button>` : ''}
        ${staff && st.caseAttachments.length < 40 ? `<label class="btn-ghost btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Bild anhängen</span><input type="file" accept="image/*" multiple data-upload="fivenet-img" data-case-id="${c.id}" data-doc-id="${d.id}" aria-label="Bilder zum Dokument hinzufügen"></label>` : ''}
        ${canManage ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
          <button type="button" class="btn-ghost btn-sm fn-danger" data-action="fn-delete" data-id="${d.id}" data-case-id="${c.id}">${icon('trash', 'ico-sm')}<span>Entfernen</span></button>` : ''}
      </div>
    </div>`;
}

/** Abschrift einer Google-Sheets-Tabelle (tabulatorgetrennt) als Tabelle; die erste Zeile gilt als Kopfzeile. */
function sheetTable(text) {
  const rows = String(text).split('\n').map((l) => l.split('\t'));
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const cells = (r, tag) => Array.from({ length: cols }, (_, i) => `<${tag}>${esc(r[i] || '')}</${tag}>`).join('');
  return `<div class="fn-table-wrap"><table class="fn-table">
      <thead><tr>${cells(rows[0], 'th')}</tr></thead>
      <tbody>${rows
      .slice(1)
      .map((r) => (r.length === 1 && !r[0] ? `<tr class="gap"><td colspan="${cols}"></td></tr>` : `<tr>${cells(r, 'td')}</tr>`))
      .join('')}</tbody></table></div>`;
}

function externalSection(c, docs) {
  const staff = isStaff();
  const sortable = staff && docs.length > 1;
  if (!staff && !docs.length) return '';
  return `<div class="section" id="secExternal">
      <h3 class="section-title">Externe Dokumente ${staff ? `<span class="ext-add">
        <button type="button" class="btn-outline btn-sm" data-action="fn-add">${icon('link', 'ico-sm')}<span>FiveNet-Dokument</span></button>
        <button type="button" class="btn-outline btn-sm" data-action="gd-add" data-provider="gdocs">${icon('doc', 'ico-sm')}<span>Google-Docs-Dokument</span></button>
        <button type="button" class="btn-outline btn-sm" data-action="gd-add" data-provider="gsheets">${icon('table', 'ico-sm')}<span>Google-Sheets-Tabelle</span></button></span>` : ''}</h3>
      ${docs.length
      ? `${sortable ? `<div class="ext-sortbar">
              <span class="form-hint">${icon('grip', 'ico-sm')} Reihenfolge ändern: Dokument gedrückt halten und nach oben oder unten ziehen.</span>
              <select class="field ext-sort" data-ext-sort data-case-id="${c.id}" aria-label="Dokumente sortieren">
                <option value="">Sortieren …</option>
                <option value="date-asc">Datum: älteste zuerst</option>
                <option value="date-desc">Datum: neueste zuerst</option>
                <option value="title">Titel A–Z</option>
                <option value="source">Nach Quelle</option>
              </select></div>` : ''}
            <div class="stack"${sortable ? ` id="extList" data-case-id="${c.id}"` : ''}>${docs.map((d) => externalDocCard(d, c, sortable)).join('')}</div>`
      : '<p class="text-sm text-dim">Noch keine externen Dokumente. Polizeiberichte und Strafakten aus FiveNet, Verträge und Schriftsätze aus Google Docs oder Aufstellungen aus Google Sheets lassen sich per Link mit der Akte verknüpfen – mit Abschrift und Bildern.</p>'}
      ${!staff ? '<p class="form-hint">Öffnen im Original ist nur mit einer Berechtigung in FiveNet bzw. bei Google möglich.</p>' : ''}
    </div>`;
}

function externalCitation(d) {
  const parts = [d.docType, d.docDate ? fmtDateOnly(d.docDate) : null].filter(Boolean).join(', ');
  const head = extOf(d).google ? extOf(d).noun : `FiveNet-Dokument Nr. ${d.documentId}`;
  return `${head}${d.title ? ` „${d.title}“` : ''}${parts ? ` (${parts})` : ''}, ${d.url}`;
}

/** Hinweis unter dem Link-Feld, solange noch nichts geladen ist. */
const googleIdleHint = (provider) =>
  provider === 'gsheets'
    ? 'Link einfügen – bei „Jeder, der über den Link verfügt“ wird das Tabellenblatt automatisch geladen.'
    : 'Link einfügen – bei „Jeder, der über den Link verfügt“ werden Text und Bilder automatisch geladen.';

/** Dialog: Dokument verknüpfen (d = null) oder Angaben bearbeiten – für FiveNet, Google Docs und Google Sheets. */
function externalForm(provider, d, c) {
  const fn = st.fivenet || { instance: { url: 'https://fivenet.modernv.net', host: 'fivenet.modernv.net' }, docTypes: [], lastViewedAs: '' };
  const p = EXT[provider];
  const gd = !!p.google;
  const sheet = provider === 'gsheets';
  const editing = !!d;
  const v = d || { title: '', docType: '', docDate: '', docAuthor: '', summary: '', viewedAs: gd ? '' : fn.lastViewedAs || '', internal: true };
  const inputBox = gd
    ? `<div class="span-2"><label class="label" for="gdInput">${sheet ? 'Link zur Google-Sheets-Tabelle' : 'Link zum Google-Docs-Dokument'}</label>
          <input id="gdInput" name="input" class="field font-mono text-sm" required maxlength="600" autocomplete="off" spellcheck="false" autofocus placeholder="https://docs.google.com/${sheet ? 'spreadsheets' : 'document'}/d/…/edit">
          <div id="gdCheck" class="fn-check" aria-live="polite"><span class="text-dim">${esc(googleIdleHint(provider))}</span></div></div>`
    : `<div class="span-2"><label class="label" for="fnInput">Link zum FiveNet-Dokument</label>
          <input id="fnInput" name="input" class="field font-mono text-sm" required maxlength="500" autocomplete="off" spellcheck="false" autofocus placeholder="${esc(fn.instance.url)}/documents/1234">
          <div id="fnCheck" class="fn-check" aria-live="polite"><span class="text-dim">Adresse aus FiveNet einfügen – die Dokument-ID wird automatisch erkannt.</span></div></div>`;
  const known = editing
    ? `<div class="span-2"><div class="label">${esc(p.noun)}</div><div class="fn-check ok"><div class="fn-line">${icon('check', 'ico-sm')}<span>${gd ? esc(d.host) : `Dokument-ID <strong>${esc(d.documentId)}</strong> · ${esc(d.host)}`}</span><a class="link-btn push" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">In ${esc(p.name)} öffnen ↗</a></div></div>
          ${gd ? '<div id="gdCheck" class="fn-check hidden" aria-live="polite"></div>' : ''}</div>`
    : inputBox;
  const contentHint = sheet
    ? 'Wird bei freigegebenen Tabellen automatisch gefüllt. Sonst: in Google Sheets die Zellen markieren (Strg+A), Strg+C – hier Strg+V.'
    : gd
    ? 'Wird bei freigegebenen Dokumenten automatisch gefüllt. Sonst: in Google Docs Strg+A, Strg+C – hier Strg+V.'
    : 'Im FiveNet-Dokument den Inhalt mit der Maus markieren → Strg+C, dann hier Strg+V. Text wird als Abschrift gespeichert, enthaltene Bilder werden automatisch übernommen.';
  return `
      <h2 id="modalTitle" class="modal-title">${editing ? `${esc(p.noun)} bearbeiten` : `${esc(p.noun)} hinzufügen`}</h2>
      <p class="modal-sub"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.title)}</p>
      <form data-form="${editing ? 'ext-edit' : 'ext-link'}" data-provider="${provider}" data-case-id="${c.id}" ${editing ? `data-id="${d.id}"` : ''} class="form-grid cols-2">
        ${known}
        <div class="span-2"><label class="label" for="fnTitle">Titel</label><input id="fnTitle" name="title" class="field" maxlength="300" value="${esc(v.title)}" placeholder="${sheet ? 'z. B. Beweismittelliste' : gd ? 'z. B. Kaufvertrag Autohaus' : 'z. B. Polizeibericht – Verkehrskontrolle'}"></div>
        <div><label class="label">Dokumentart</label><input name="docType" class="field" maxlength="60" list="fnTypes" value="${esc(v.docType)}" placeholder="${sheet ? 'z. B. Aufstellung' : gd ? 'z. B. Vertrag' : 'z. B. Polizeibericht'}"><datalist id="fnTypes">${(fn.docTypes || []).map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></div>
        <div><label class="label">Erstellt am</label><input name="docDate" type="date" class="field" value="${esc(v.docDate || '')}"></div>
        <div class="${gd ? 'span-2' : ''}"><label class="label">Verfasser / Behörde</label><input name="docAuthor" class="field" maxlength="120" value="${esc(v.docAuthor)}" placeholder="${sheet ? 'z. B. LSPD Asservatenkammer' : gd ? 'z. B. Autohaus Premium Deluxe' : 'z. B. LSPD, Officer J. Miller'}"></div>
        ${gd ? '' : `<div><label class="label">Eingesehen als (FiveNet-Charakter)</label><input name="viewedAs" class="field" maxlength="80" value="${esc(v.viewedAs || '')}" placeholder="eigene Angabe, optional"></div>`}
        <div class="span-2"><label class="label">Kurzinhalt / Relevanz für die Akte</label><textarea name="summary" rows="3" maxlength="2000" class="field" placeholder="Was steht drin, warum ist es wichtig?">${esc(v.summary)}</textarea></div>
        <div class="span-2 fn-content-box">
          <div class="fn-line"><label class="label" for="fnContent">Inhalt aus ${esc(p.name)} – ${sheet ? 'Tabelle' : 'Text & Bilder'} (optional)</label>
            ${gd && editing ? `<button type="button" class="btn-ghost btn-sm push" data-action="gd-reload" data-url="${esc(d.url)}">${icon('download', 'ico-sm')}<span>Neu aus ${esc(p.name)} laden</span></button>` : ''}</div>
          <textarea id="fnContent" name="contentText" rows="7" maxlength="60000" class="field fn-content${sheet ? ' is-sheet' : ''}" ${sheet ? 'wrap="off"' : ''} placeholder="${esc(contentHint)}">${esc(v.contentText || '')}</textarea>
          <div id="fnPending" class="fn-pending"></div>
          <div class="fn-line mt-2">
            <label class="btn-ghost btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Bilder / Screenshots wählen</span><input type="file" accept="image/*" multiple data-upload="fn-pending" aria-label="Bilder auswählen"></label>
            <span class="form-hint">Screenshots (Win+Umschalt+S) oder „Bild kopieren“ lassen sich auch direkt mit Strg+V einfügen.</span>
          </div>
        </div>
        <label class="check span-2"><input type="checkbox" name="clientVisible" ${v.internal ? '' : 'checked'}> Für den Mandanten sichtbar (sonst nur intern) – gilt auch für Abschrift und Bilder</label>
        ${editing || gd ? '' : `<label class="check span-2 fn-attest"><input type="checkbox" name="attest" required> Ich habe dieses Dokument in FiveNet mit meinem eigenen Charakter geöffnet und darf es einsehen und für die Akte übernehmen.</label>
          <div class="span-2 banner banner-gold mb-0">${icon('shield')}<div>FiveNet bietet externen Anwendungen keine Schnittstelle (kein OAuth2). Die Kanzlei ruft das Dokument deshalb nicht selbst ab und fragt nie nach Ihrem FiveNet-Passwort. Übernommen wird nur, was Sie hier einfügen – Bilder daraus lädt der Server direkt aus dem FiveNet-Dateispeicher.</div></div>`}
        ${gd && !editing ? `<div class="span-2 banner banner-gold mb-0">${icon('shield')}<div>Die Kanzlei nutzt kein Google-Konto und fragt nie nach Passwörtern. Geladen werden nur ${sheet ? 'Tabellen' : 'Dokumente'}, die per Link freigegeben oder im Web veröffentlicht sind – genau so, wie sie jeder mit dem Link sehen kann.${sheet ? ' Übernommen wird das Tabellenblatt aus dem Link (sonst das erste Blatt).' : ''}</div></div>` : ''}
        <div class="span-2 form-actions">
          <button type="submit" class="btn-gold btn-md">${icon(editing ? 'check' : 'link', 'ico-sm')}<span>${editing ? 'Speichern' : 'Mit Akte verknüpfen'}</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button>
        </div>
      </form>`;
}

/** Live-Prüfung des eingefügten FiveNet-Links (Dokument-ID, Dubletten, Querverweise). */
async function checkFivenetInput(input) {
  const box = $('#fnCheck');
  if (!box) return;
  const token = ++st.fnCheckToken;
  const value = input.value.trim();
  const submit = $('form[data-form="ext-link"] button[type="submit"]');
  if (submit) submit.disabled = false;
  if (!value) {
    box.className = 'fn-check';
    box.innerHTML = '<span class="text-dim">Adresse aus FiveNet einfügen – die Dokument-ID wird automatisch erkannt.</span>';
    return;
  }
  box.className = 'fn-check';
  box.innerHTML = '<span class="text-dim">Wird geprüft …</span>';
  let r;
  try {
    r = await api.post('/api/fivenet/resolve', { input: value, caseId: st.modalCaseId || undefined });
  } catch (e) {
    if (token !== st.fnCheckToken || !box.isConnected) return;
    box.className = 'fn-check bad';
    box.innerHTML = `${icon('x', 'ico-sm')}<span>${esc(e.message)}</span>`;
    return;
  }
  if (token !== st.fnCheckToken || !box.isConnected) return;
  const lines = [
    `<div class="fn-line">${icon('check', 'ico-sm')}<span>Dokument-ID <strong>${esc(r.documentId)}</strong> erkannt · ${esc(r.host)}</span><a class="link-btn push" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">In FiveNet öffnen ↗</a></div>`,
  ];
  if (r.linkedHere) lines.push(`<div class="fn-warn">Bereits mit dieser Akte verknüpft (von ${esc(r.linkedHere.linkedByName)}).</div>`);
  if (r.otherCases.length) lines.push(`<div class="text-xs text-muted">Auch verknüpft mit: ${r.otherCases.map((o) => `<span class="font-mono">${esc(o.caseNumber)}</span>`).join(', ')}</div>`);
  const title = $('#fnTitle');
  if (title && !title.value && r.suggestedTitle) {
    title.value = r.suggestedTitle;
    lines.push('<div class="text-xs text-dim">Titel aus einer anderen Akte übernommen – bitte prüfen.</div>');
  }
  box.className = `fn-check ${r.linkedHere ? 'warn' : 'ok'}`;
  box.innerHTML = lines.join('');
  if (submit) submit.disabled = !!r.linkedHere;
}

/** Setzt automatisch geladenen Inhalt in das Abschrift-Feld (nicht über eigene Änderungen hinweg). */
function fillContent(text, replace) {
  const area = $('#fnContent');
  if (!area || !(replace || !area.value.trim() || area.dataset.auto === '1')) return;
  area.value = text.length > 60000 ? text.slice(0, 60000) : text;
  area.dataset.auto = '1';
  if (text.length > 60000) toast('Der Inhalt ist sehr lang – die Abschrift wurde auf 60.000 Zeichen gekürzt.', 'error');
}

/**
 * Google Docs / Google Sheets: Link erkennen und – falls freigegeben – den Inhalt automatisch übernehmen
 * (Docs: Text und Bilder, Sheets: das Tabellenblatt als Tabelle).
 * replace = true: vorhandene Abschrift ersetzen (Aktualisieren im Bearbeiten-Dialog).
 */
async function loadGoogleDoc(value, { replace = false } = {}) {
  const box = $('#gdCheck');
  if (!box) return;
  const provider = box.closest('form')?.dataset.provider === 'gsheets' ? 'gsheets' : 'gdocs';
  const p = EXT[provider];
  const token = ++st.fnCheckToken;
  const submit = $('form[data-form="ext-link"] button[type="submit"]');
  if (submit) submit.disabled = false;
  box.classList.remove('hidden');
  if (!value) {
    box.className = 'fn-check';
    box.innerHTML = `<span class="text-dim">${esc(googleIdleHint(provider))}</span>`;
    return;
  }
  box.className = 'fn-check';
  box.innerHTML = `<span class="text-dim">${esc(p.name)} wird geladen …</span>`;
  let r;
  try {
    r = await api.post(`/api/${provider}/fetch`, { input: value, caseId: st.modalCaseId || undefined });
  } catch (e) {
    if (token !== st.fnCheckToken || !box.isConnected) return;
    box.className = 'fn-check bad';
    box.innerHTML = `${icon('x', 'ico-sm')}<span>${esc(e.message)}</span>`;
    return;
  }
  if (token !== st.fnCheckToken || !box.isConnected) return;
  const lines = [];
  const openLink = `<a class="link-btn push" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">In ${esc(p.name)} öffnen ↗</a>`;
  const loaded = provider === 'gsheets' ? typeof r.text === 'string' : !!r.html;
  const title = $('#fnTitle');
  if (loaded && title && !title.value && (r.title || r.suggestedTitle)) title.value = r.title || r.suggestedTitle;
  const name = r.title ? `„${esc(r.title)}“ ` : '';
  if (loaded && provider === 'gsheets') {
    fillContent(r.text, replace);
    st.fnPending.urls = [];
    renderPending();
    const rows = r.rows.toLocaleString('de-DE');
    lines.push(
      `<div class="fn-line">${icon('check', 'ico-sm')}<span>${name || 'Tabelle '}geladen · ${r.rows ? `${rows} Zeile${r.rows === 1 ? '' : 'n'}` : 'das Tabellenblatt ist leer'}${r.published ? ' · im Web veröffentlicht' : ''}</span>${openLink}</div>`
    );
    if (r.truncated) lines.push(`<div class="fn-warn">Die Tabelle ist sehr groß – übernommen wurden die ersten ${rows} von ${r.totalRows.toLocaleString('de-DE')} Zeilen (höchstens 60.000 Zeichen).</div>`);
    if (r.columnsCut) lines.push('<div class="fn-warn">Übernommen wurden nur die ersten 50 Spalten.</div>');
    if (!r.gid) lines.push('<div class="text-xs text-dim">Übernommen wurde das erste Tabellenblatt. Für ein anderes Blatt dieses in Google Sheets öffnen und die Adresse aus der Adresszeile einfügen.</div>');
  } else if (loaded) {
    const { text, images } = parsePastedHtml(r.html);
    const urls = images.map((src) => externalImageUrl('gdocs', src)).filter(Boolean);
    fillContent(text, replace);
    st.fnPending.urls = [];
    addPendingImages({ urls });
    lines.push(
      `<div class="fn-line">${icon('check', 'ico-sm')}<span>${name || 'Dokument '}geladen · ${text.length.toLocaleString('de-DE')} Zeichen · ${urls.length} Bild${urls.length === 1 ? '' : 'er'}${r.published ? ' · im Web veröffentlicht' : ''}</span>${openLink}</div>`
    );
  } else {
    lines.push(`<div class="fn-line">${icon('check', 'ico-sm')}<span>${esc(p.name.replace(' ', '-'))}-Link erkannt</span>${openLink}</div>`);
    lines.push(`<div class="fn-warn">${esc(r.contentError || 'Der Inhalt konnte nicht geladen werden.')}</div>`);
  }
  if (r.linkedHere && !replace) lines.push(`<div class="fn-warn">Bereits mit dieser Akte verknüpft (von ${esc(r.linkedHere.linkedByName)}).</div>`);
  if (r.otherCases.length) lines.push(`<div class="text-xs text-muted">Auch verknüpft mit: ${r.otherCases.map((o) => `<span class="font-mono">${esc(o.caseNumber)}</span>`).join(', ')}</div>`);
  box.className = `fn-check ${loaded && !(r.linkedHere && !replace) ? 'ok' : 'warn'}`;
  box.innerHTML = lines.join('');
  if (submit) submit.disabled = !!r.linkedHere;
  if (replace && loaded) toast('Neuer Stand geladen – mit „Speichern“ übernehmen.');
}

function fivenetBody(f) {
  const fd = new FormData(f);
  return {
    title: val(fd, 'title'),
    docType: val(fd, 'docType'),
    docDate: val(fd, 'docDate') || null,
    docAuthor: val(fd, 'docAuthor'),
    summary: val(fd, 'summary'),
    viewedAs: val(fd, 'viewedAs'),
    internal: fd.get('clientVisible') !== 'on',
    contentText: String(fd.get('contentText') ?? '').replace(/\s+$/, '').replace(/^\s*\n/, ''),
  };
}

/* ---------------------------------------------------------------- FiveNet: Inhalt übernehmen (Einfügen) */
const FN_BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD']);
const FN_IMAGE_PATHS = ['/api/filestore/', '/api/image_proxy/'];
const FN_MAX_IMAGES = 10;

/**
 * Wandelt kopiertes HTML aus FiveNet in lesbaren Text und sammelt die Bildadressen.
 * DOMParser lädt keine Bilder und führt keine Skripte aus; übernommen werden nur Textknoten.
 */
function parsePastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, svg, button, input, select, textarea').forEach((n) => n.remove());
  const images = [];
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) images.push(src);
    const marker = doc.createElement('p');
    marker.textContent = '[Bild]';
    img.replaceWith(marker);
  });
  const out = [];
  // inCell: innerhalb einer Tabellenzelle bleiben Absätze in einer Zeile (Google Docs setzt <p> in jede Zelle).
  const walk = (node, inCell = false) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        out.push(n.nodeValue.replace(/\s+/g, ' '));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') {
        out.push('\n');
        continue;
      }
      if (tag === 'HR') {
        out.push('\n————————\n');
        continue;
      }
      const cell = tag === 'TD' || tag === 'TH';
      const block = FN_BLOCK.has(tag) && !inCell;
      // Listenpunkte und Tabellenzeilen ohne Leerzeile untereinander, Absätze mit Leerzeile.
      const tight = tag === 'LI' || tag === 'TR' || tag === 'DT' || tag === 'DD';
      if (block) out.push('\n');
      else if (inCell && FN_BLOCK.has(tag)) out.push(' ');
      if (tag === 'LI') out.push('• ');
      if (cell && n.previousElementSibling) out.push(' | ');
      walk(n, inCell || cell);
      if (block && !tight) out.push('\n');
      if (/^H[1-6]$/.test(tag)) out.push('\n');
    }
  };
  // Im Web veröffentlichte Google-Docs-Seiten tragen den Inhalt in #contents.
  walk(doc.querySelector('#contents') || doc.body);
  const text = out
    .join('')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, images };
}

/**
 * Übernommen werden nur Bilder der jeweiligen Quelle: FiveNet-Dateispeicher / Bild-Proxy
 * bzw. Google-Inhaltsserver (*.googleusercontent.com). Der Server prüft dasselbe noch einmal.
 */
function externalImageUrl(provider, src) {
  if (EXT[provider]?.google) {
    try {
      const u = new URL(src);
      if (u.protocol !== 'https:' || u.port || !u.hostname.endsWith('.googleusercontent.com')) return null;
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }
  const base = st.fivenet?.instance?.url || 'https://fivenet.modernv.net';
  try {
    const u = new URL(src, base);
    const b = new URL(base);
    if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '') || u.port !== b.port) return null;
    if (!FN_IMAGE_PATHS.some((p) => u.pathname.startsWith(p))) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function dataUrlToBlob(src) {
  const m = String(src).match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1].toLowerCase() });
}

function pendingCount() {
  return st.fnPending.urls.length + st.fnPending.blobs.length;
}

function addPendingImages({ urls = [], blobs = [] }) {
  let dropped = 0;
  for (const u of urls) {
    if (st.fnPending.urls.includes(u)) continue;
    if (pendingCount() >= FN_MAX_IMAGES) dropped += 1;
    else st.fnPending.urls.push(u);
  }
  for (const b of blobs) {
    if (pendingCount() >= FN_MAX_IMAGES) dropped += 1;
    else st.fnPending.blobs.push(b);
  }
  if (dropped) toast(`Pro Vorgang werden höchstens ${FN_MAX_IMAGES} Bilder übernommen – ${dropped} weggelassen.`, 'error');
  renderPending();
}

function renderPending() {
  const box = $('#fnPending');
  if (!box) return;
  (st.fnPending.previews || []).forEach((u) => URL.revokeObjectURL(u));
  st.fnPending.previews = st.fnPending.blobs.map((b) => URL.createObjectURL(b));
  const source = EXT[box.closest('form')?.dataset.provider]?.name || 'Quelle';
  const items = [
    ...st.fnPending.urls.map((u, i) => ({ src: u, kind: 'url', i, label: `aus ${source}` })),
    ...st.fnPending.blobs.map((b, i) => ({ src: st.fnPending.previews[i], kind: 'blob', i, label: 'eingefügt' })),
  ];
  box.innerHTML = items.length
    ? `<div class="text-xs text-muted mb-1">${items.length} Bild${items.length === 1 ? '' : 'er'} ${items.length === 1 ? 'wird' : 'werden'} beim Speichern als Anhang übernommen:</div>
         <div class="fn-thumbs">${items
         .map((it) => `<div class="fn-thumb"><img src="${esc(it.src)}" alt="" referrerpolicy="no-referrer" loading="lazy"><span class="lbl">${esc(it.label)}</span>
             <button type="button" class="rm" data-action="fn-img-remove" data-kind="${it.kind}" data-index="${it.i}" aria-label="Bild entfernen">${icon('x', 'ico-sm')}</button></div>`)
         .join('')}</div>`
    : '';
}

function resetPending() {
  (st.fnPending.previews || []).forEach((u) => URL.revokeObjectURL(u));
  st.fnPending = { urls: [], blobs: [] };
}

function insertAtCursor(el, text) {
  const max = Number(el.getAttribute('maxlength')) || Infinity;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const room = max - (el.value.length - (end - start));
  const piece = text.length > room ? text.slice(0, Math.max(0, room)) : text;
  if (piece.length < text.length) toast('Der Text ist sehr lang und wurde gekürzt (höchstens 60.000 Zeichen).', 'error');
  el.setRangeText(piece, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Aus Google Sheets kopierte Zellen (HTML-Tabelle) → tabulatorgetrennter Text, eine Zeile je Tabellenzeile.
 * Zeilenumbrüche in Zellen werden zu „ / “, wie beim automatischen Laden.
 */
function tableToTsv(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const trs = [...doc.querySelectorAll('tr')];
  if (!trs.length) return '';
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  const cell = (td) => (td.textContent || '').replace(/\s*\n\s*/g, ' / ').replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const lines = trs.map((tr) => {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map(cell);
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells.join('\t');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Einfügen im Dokument-Dialog: HTML → Text + Bildadressen, Bilddateien aus der Zwischenablage → Anhänge. */
function onExternalPaste(e, provider) {
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...(cd.files || [])].filter((f) => /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type));
  const html = cd.getData('text/html');
  const plain = cd.getData('text/plain');
  const inContent = e.target && e.target.id === 'fnContent';
  if (files.length) addPendingImages({ blobs: files });
  // Google Sheets: kopierte Zellen als Tabelle übernehmen (Tabulator zwischen den Spalten).
  const tsv = provider === 'gsheets' && inContent && html ? tableToTsv(html) : '';
  if (tsv) {
    e.preventDefault();
    insertAtCursor(e.target, tsv);
    return;
  }
  if (html && inContent) {
    const { text, images } = parsePastedHtml(html);
    const urls = [];
    const blobs = [];
    let external = 0;
    for (const src of images) {
      const blob = src.startsWith('data:') ? dataUrlToBlob(src) : null;
      if (blob) blobs.push(blob);
      else {
        const u = externalImageUrl(provider, src);
        if (u) urls.push(u);
        else external += 1;
      }
    }
    if (urls.length || blobs.length) addPendingImages({ urls, blobs });
    if (external) toast(`${external} Bild${external === 1 ? '' : 'er'} liegt nicht bei ${EXT[provider].name} – bitte als Screenshot einfügen.`, 'error');
    if (text) {
      e.preventDefault();
      insertAtCursor(e.target, text);
    }
    return;
  }
  if (files.length && !plain) {
    e.preventDefault();
    toast(files.length === 1 ? 'Bild hinzugefügt – wird beim Speichern übernommen.' : `${files.length} Bilder hinzugefügt.`);
  }
}

/** Nach dem Speichern: vorgemerkte Bilder als Anhänge zum FiveNet-Dokument übernehmen. */
async function importPendingImages(caseId, doc) {
  const pending = st.fnPending;
  const result = { ok: 0, failed: 0, skipped: 0, errors: [] };
  if (!pending.urls.length && !pending.blobs.length) return result;
  toast('Bilder werden übernommen …');
  if (pending.urls.length) {
    try {
      const r = await api.post(extUrl(caseId, doc.id, '/images'), { urls: pending.urls });
      result.ok += r.imported;
      result.skipped += r.skipped;
      result.failed += r.failed.length;
      result.errors.push(...r.failed.map((f) => f.error));
    } catch (e) {
      result.failed += pending.urls.length;
      result.errors.push(e.message);
    }
  }
  const caption = (extOf(doc).google ? `${extOf(doc).name}${doc.title ? ' – ' + doc.title : ''}` : `FiveNet ${doc.documentId}${doc.title ? ' – ' + doc.title : ''}`).slice(0, 180);
  for (const b of pending.blobs) {
    try {
      const blob = await resizeImage(b, { max: 1600 });
      await api.upload(`/api/cases/${caseId}/attachments?caption=${encodeURIComponent(caption)}&internal=${doc.internal ? 1 : 0}&fivenetDoc=${doc.id}`, blob);
      result.ok += 1;
    } catch (e) {
      result.failed += 1;
      result.errors.push(e.message);
    }
  }
  resetPending();
  return result;
}

function reportImport(r) {
  if (r.ok) toast(`${r.ok} Bild${r.ok === 1 ? '' : 'er'} als Anhang übernommen.`);
  if (r.skipped && !r.ok && !r.failed) toast('Die Bilder sind bereits in der Akte – nichts Neues.');
  if (r.failed) toast(`${r.failed} Bild${r.failed === 1 ? '' : 'er'} nicht übernommen (${[...new Set(r.errors)].slice(0, 2).join('; ')}). Tipp: als Screenshot mit Strg+V einfügen.`, 'error');
}

/* ---------------------------------------------------------------- Externe Dokumente: Reihenfolge */
// Gedrückt halten (Maus oder Finger) und ziehen; über den Griff mit der Maus sofort. Tastatur: Griff + ↑/↓.
const DRAG_HOLD_MS = 280;
const DRAG_SLOP = 8; // so weit darf sich der Finger während des Haltens bewegen, sonst ist es Scrollen
const DRAG_SKIP = 'a, button:not(.fn-grip), input, select, textarea, label, summary, .fn-text, .fn-gallery';
const drag = { pending: null, active: null, suppressClick: false, saveTimer: 0 };

const extIds = (list) => [...list.children].map((el) => Number(el.dataset.docId));

function scrollParentOf(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement || document.documentElement;
}

/** Verschiebt Karten im DOM und lässt die übrigen sanft an ihren neuen Platz gleiten. */
function reorderWithAnimation(list, apply, except = null) {
  const cards = [...list.children];
  const before = new Map(cards.map((el) => [el, el.offsetTop]));
  apply();
  for (const el of cards) {
    const delta = before.get(el) - el.offsetTop;
    if (!delta || el === except) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    el.getBoundingClientRect();
    el.style.transition = '';
    el.style.transform = '';
  }
}

function cancelPendingDrag() {
  if (!drag.pending) return;
  clearTimeout(drag.pending.timer);
  drag.pending.card.classList.remove('is-pressing');
  drag.pending = null;
}

function startDrag(p) {
  const card = p.card;
  const list = card.parentElement;
  if (!card.isConnected || !list) return;
  card.classList.remove('is-pressing');
  const scroller = scrollParentOf(list);
  drag.active = { card, list, scroller, pointerId: p.pointerId, startY: p.y + scroller.scrollTop, originY: p.y, lastY: p.y, order: extIds(list), raf: 0 };
  card.classList.add('is-dragging');
  card.style.transform = 'scale(1.01)'; // sichtbar „angehoben“, sobald das Halten erkannt ist
  document.body.classList.add('ps-dragging');
  window.getSelection()?.removeAllRanges();
  if (p.touch) navigator.vibrate?.(12);
  drag.active.raf = requestAnimationFrame(autoScrollDrag);
}

function moveDrag(clientY) {
  const a = drag.active;
  a.lastY = clientY;
  const place = () => {
    const dy = clientY + a.scroller.scrollTop - a.startY;
    a.card.style.transform = `translateY(${dy}px) scale(1.01)`;
    return a.card.offsetTop + dy + a.card.offsetHeight / 2; // Mitte der gezogenen Karte (ohne andere Animationen)
  };
  // Auch bei schnellen Bewegungen über mehrere Karten hinweg: so lange tauschen, bis die Position passt.
  for (let i = 0; i < 100; i += 1) {
    const mid = place();
    const next = a.card.nextElementSibling;
    const prev = a.card.previousElementSibling;
    let target = null;
    if (next && mid > next.offsetTop + next.offsetHeight / 2) target = () => next.after(a.card);
    else if (prev && mid < prev.offsetTop + prev.offsetHeight / 2) target = () => prev.before(a.card);
    if (!target) break;
    const top = a.card.offsetTop;
    reorderWithAnimation(a.list, target, a.card);
    a.startY += a.card.offsetTop - top; // Karte bleibt unter Finger/Maus
  }
}

/** Am oberen/unteren Rand beim Ziehen mitscrollen – nur in die Richtung, in die gezogen wird. */
function autoScrollDrag() {
  const a = drag.active;
  if (!a) return;
  const root = a.scroller === document.scrollingElement || a.scroller === document.documentElement;
  const box = root ? { top: 0, bottom: window.innerHeight } : a.scroller.getBoundingClientRect();
  const edge = 70;
  const moved = a.lastY - a.originY;
  let v = 0;
  if (moved < -10 && a.lastY < box.top + edge) v = -Math.min(16, Math.ceil((box.top + edge - a.lastY) / 5));
  else if (moved > 10 && a.lastY > box.bottom - edge) v = Math.min(16, Math.ceil((a.lastY - box.bottom + edge) / 5));
  if (v) {
    const was = a.scroller.scrollTop;
    a.scroller.scrollTop += v;
    if (a.scroller.scrollTop !== was) moveDrag(a.lastY);
  }
  a.raf = requestAnimationFrame(autoScrollDrag);
}

function endDrag() {
  const a = drag.active;
  drag.active = null;
  cancelAnimationFrame(a.raf);
  a.card.classList.remove('is-dragging');
  a.card.getBoundingClientRect();
  a.card.style.transform = ''; // gleitet an ihren Platz
  document.body.classList.remove('ps-dragging');
  drag.suppressClick = true;
  setTimeout(() => (drag.suppressClick = false), 0);
  const order = extIds(a.list);
  if (order.join() !== a.order.join()) saveExternalOrder(Number(a.list.dataset.caseId), order);
}

async function saveExternalOrder(caseId, ids, { quiet = false } = {}) {
  try {
    await api.put(extUrl(caseId, null, '/order'), { ids });
    st.caseDocs.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    if (!quiet) toast('Reihenfolge gespeichert.');
  } catch (e) {
    toast(e.message, 'error');
    if (st.modalCaseId === caseId) await reloadCase(caseId);
  }
}

/** Sortieren-Menü: einmalig nach Datum, Titel oder Quelle ordnen – danach per Ziehen feinjustierbar. */
function sortExternalDocs(select) {
  const how = select.value;
  select.value = '';
  const list = $('#extList');
  if (!how || !list) return;
  const day = (d) => d.docDate || String(d.linkedAt || '').slice(0, 10);
  const source = { fivenet: 0, gdocs: 1, gsheets: 2 };
  const cmp = {
    'date-asc': (x, y) => day(x).localeCompare(day(y)) || x.id - y.id,
    'date-desc': (x, y) => day(y).localeCompare(day(x)) || y.id - x.id,
    title: (x, y) => (x.title || extOf(x).noun).localeCompare(y.title || extOf(y).noun, 'de', { sensitivity: 'base', numeric: true }),
    source: (x, y) => (source[x.provider] ?? 9) - (source[y.provider] ?? 9) || day(y).localeCompare(day(x)),
  }[how];
  const shown = new Set(extIds(list));
  const ids = st.caseDocs.filter((d) => shown.has(d.id)).sort(cmp).map((d) => d.id);
  if (ids.join() === extIds(list).join()) {
    toast('Die Dokumente sind bereits so sortiert.');
    return;
  }
  const byId = new Map([...list.children].map((el) => [Number(el.dataset.docId), el]));
  reorderWithAnimation(list, () => ids.forEach((id) => list.append(byId.get(id))));
  saveExternalOrder(Number(list.dataset.caseId), ids);
}

/** Tastatur: Griff fokussieren, dann ↑/↓ – gespeichert wird kurz nach dem letzten Schritt. */
function moveExternalByKey(grip, dir) {
  const card = grip.closest('.fn-doc');
  const list = card?.parentElement;
  const other = dir < 0 ? card?.previousElementSibling : card?.nextElementSibling;
  if (!other || !list) return;
  reorderWithAnimation(list, () => (dir < 0 ? other.before(card) : other.after(card)));
  grip.focus();
  clearTimeout(drag.saveTimer);
  drag.saveTimer = setTimeout(() => saveExternalOrder(Number(list.dataset.caseId), extIds(list)), 600);
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag.active || drag.pending) return;
  const card = e.target.closest('#extList > .fn-doc');
  if (!card) return;
  const grip = e.target.closest('.fn-grip');
  if (!grip && e.target.closest(DRAG_SKIP)) return;
  const p = { card, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
  if (grip) {
    // Der Griff blockiert das Scrollen (touch-action: none) – hier geht es sofort los.
    e.preventDefault();
    startDrag(p);
    return;
  }
  card.classList.add('is-pressing');
  drag.pending = { ...p, timer: setTimeout(() => { const q = drag.pending; drag.pending = null; if (q) startDrag(q); }, DRAG_HOLD_MS) };
});
document.addEventListener('pointermove', (e) => {
  if (drag.pending && e.pointerId === drag.pending.pointerId) {
    if (Math.hypot(e.clientX - drag.pending.x, e.clientY - drag.pending.y) > DRAG_SLOP) cancelPendingDrag();
    return;
  }
  if (drag.active && e.pointerId === drag.active.pointerId) {
    e.preventDefault();
    moveDrag(e.clientY);
  }
});
const pointerDone = (e) => {
  if (drag.pending && e.pointerId === drag.pending.pointerId) cancelPendingDrag();
  if (drag.active && e.pointerId === drag.active.pointerId) endDrag();
};
document.addEventListener('pointerup', pointerDone);
document.addEventListener('pointercancel', pointerDone);
// Während des Ziehens nicht scrollen, kein Kontextmenü, kein Klick nach dem Loslassen.
document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (drag.active || drag.pending) e.preventDefault(); });
document.addEventListener('click', (e) => {
  if (drag.suppressClick) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.matches?.('#extList .fn-grip')) {
    e.preventDefault();
    moveExternalByKey(e.target, e.key === 'ArrowUp' ? -1 : 1);
  }
});
