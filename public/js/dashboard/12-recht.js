/*
 * Kanzlei-Dashboard – Teil 12 von 14: Recht – Anklagepunkte & Strafmaß-Rechner, Gesetzestext (StGB) und
 * Verhandlungsmodus.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Strafkatalog laden (einmal je Sitzung) */
async function loadPenal(force = false) {
  if (st.penal && !force) return st.penal;
  st.penal = await api.get('/api/penal');
  return st.penal;
}
const usd = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} $`;

/** Strafrahmen eines Tatbestands in Worten: „bis 20 HE oder Geldstrafe“, „ab 45 HE“, „Geldstrafe bis 10.000 $“. */
function penaltyText(o) {
  const fine = o.fineMax != null ? `Geldstrafe bis ${usd(o.fineMax)}` : 'Geldstrafe';
  if (o.fine === 'only') return fine;
  const he =
    o.maxHe == null ? `ab ${o.minHe} HE` : o.minHe === o.maxHe ? `${o.maxHe} HE` : o.minHe > 0 ? `${o.minHe}–${o.maxHe} HE` : `bis ${o.maxHe} HE`;
  return o.fine === 'alt' ? `${he} oder ${fine}` : he;
}
const citeShort = (o) => `§ ${o.para}${o.paragraph ? ` ${o.paragraph.replace('Satz', 'S.')}` : ''}`;

/* ---------------------------------------------------------------- Akte: Anklagepunkte */
function chargesSection(c, data, deals = []) {
  if (!isStaff() || !data) return '';
  const { charges, sentence: s, estimate } = data;
  const edit = c.canEdit;
  const hearingBtn = `<button type="button" class="btn-ghost btn-sm" data-action="hearing-start" data-id="${c.id}">${icon('scale', 'ico-sm')}<span>Verhandlungsmodus</span></button>`;
  const addBtn = edit
    ? `<button type="button" class="btn-outline btn-sm" data-action="charge-pick" data-id="${c.id}">${icon('plus', 'ico-sm')}<span>Anklagepunkt</span></button><button type="button" class="btn-ghost btn-sm" data-action="charge-import" data-id="${c.id}">${icon('doc', 'ico-sm')}<span>Anklage einfügen</span></button>`
    : '';
  if (!charges.length) {
    // Nur Strafsachen zeigen den Abschnitt immer – sonst kommt er über „⋯ Mehr“
    if (c.area !== 'strafrecht' && !deals.length) return '';
    // Ein Angebot der Staatsanwaltschaft bleibt auch ohne Anklagepunkte sichtbar
    const deal = deals.length ? `<div class="section deal-only">${dealBlock(c, deals, { mitigations: [] }, { he: null })}</div>` : '';
    return emptySection('secCharges', 'Anklagepunkte', 'noch keine', `${addBtn}${hearingBtn}`, 'Tatbestände aus dem Strafgesetzbuch – der Strafmaß-Rechner zeigt sofort, was droht.') + deal;
  }
  const haft = s.fineOnly ? 'keine' : s.minHe > 0 ? (s.minHe === s.maxHe ? `${s.maxHe} HE` : `${s.minHe}–${s.maxHe} HE`) : `bis ${s.maxHe} HE`;
  const haftSub = s.fineOnly ? 'nur Geldstrafe' : s.open || s.capped ? `Gesamtstrafe höchstens ${s.cap} HE (§ 3 Abs. 2)` : s.severe ? 'besonders schwerer Fall – Rahmen bis 180 HE' : 'Gesamtstrafe nach § 3';
  const rows = charges
    .map(
      (ch) => `<div class="chg-row">
        <div class="chg-main">
          <button type="button" class="chg-cite" data-action="law-open" data-para="${esc(ch.para)}" title="Gesetzestext anzeigen">${esc(citeShort(ch))}</button>
          <div class="chg-title"><span>${esc(ch.title)}</span><span class="chg-range">${esc(penaltyText(ch))}${ch.note ? ` · ${esc(ch.note)}` : ''}</span></div>
        </div>
        <div class="chg-side">
          ${
            edit
              ? `${ch.attempt ? `<button type="button" class="chg-flag ${ch.attempted ? 'on' : ''}" data-action="charge-flag" data-case-id="${c.id}" data-id="${ch.id}" data-flag="attempted" aria-pressed="${ch.attempted}" title="Nur versucht – Milderung möglich (§ 9 Abs. 2)">Versuch</button>` : ''}
              <button type="button" class="chg-flag ${ch.aiding ? 'on' : ''}" data-action="charge-flag" data-case-id="${c.id}" data-id="${ch.id}" data-flag="aiding" aria-pressed="${ch.aiding}" title="Beihilfe – Milderung möglich (§ 10 Abs. 4)">Beihilfe</button>
              <span class="stepper" role="group" aria-label="Anzahl">
                <button type="button" data-action="charge-count" data-case-id="${c.id}" data-id="${ch.id}" data-count="${ch.count - 1}" ${ch.count <= 1 ? 'disabled' : ''} aria-label="Einmal weniger">−</button>
                <span>${ch.count}×</span>
                <button type="button" data-action="charge-count" data-case-id="${c.id}" data-id="${ch.id}" data-count="${ch.count + 1}" ${ch.count >= 20 ? 'disabled' : ''} aria-label="Einmal mehr">+</button>
              </span>
              <button type="button" class="icon-btn sm" data-action="charge-remove" data-case-id="${c.id}" data-id="${ch.id}" aria-label="Anklagepunkt entfernen" title="Entfernen">${icon('trash', 'ico-sm')}</button>`
              : `${ch.attempted ? badge('Versuch', 'slate') : ''}${ch.aiding ? badge('Beihilfe', 'slate') : ''}<span class="chg-count">${ch.count}×</span>`
          }
        </div></div>`
    )
    .join('');
  const est = edit
    ? `<label class="chg-est"><input type="number" min="0" max="999" inputmode="numeric" class="field" value="${estimate.he ?? ''}" placeholder="—" data-change="sentence-set" data-case-id="${c.id}" data-key="he" aria-label="Einschätzung in Hafteinheiten"><span>HE</span></label>
       <label class="chg-est"><input type="number" min="0" step="1000" inputmode="numeric" class="field" value="${estimate.fine ?? ''}" placeholder="—" data-change="sentence-set" data-case-id="${c.id}" data-key="fine" aria-label="Einschätzung Geldstrafe in Dollar"><span>$</span></label>`
    : `<div class="chg-big">${estimate.he != null ? `${estimate.he} HE` : '—'}</div><div class="chg-sub">${estimate.fine != null ? usd(estimate.fine) : ''}</div>`;
  const mitig = s.mitigations.length ? `<p class="chg-mitig">${icon('info', 'ico-sm')}<span>Milderung möglich: ${s.mitigations.map(esc).join(' · ')}</span></p>` : '';
  return `<div class="section" id="secCharges">
      <div class="section-head"><h3 class="section-title">Anklagepunkte <span class="text-xs text-dim font-normal sec-meta">Strafmaß-Rechner</span></h3>
        <div class="section-actions">${addBtn}${hearingBtn}</div></div>
      <div class="chg-sum">
        <div><div class="chg-k">Freiheitsstrafe</div><div class="chg-big" data-count="chg:${c.id}:he">${esc(haft)}</div><div class="chg-sub">${esc(haftSub)}</div></div>
        <div><div class="chg-k">Geldstrafe</div><div class="chg-big" data-count="chg:${c.id}:fine">${s.fineMax ? `bis ${esc(usd(s.fineMax))}` : '—'}</div><div class="chg-sub">${s.fineMax ? (s.fineOnly ? 'Summe der Höchstbeträge' : 'statt Haft, wo das Gesetz es zulässt') : 'nicht vorgesehen'}</div></div>
        <div class="chg-est-cell"><div class="chg-k">Einschätzung der Kanzlei</div><div class="chg-est-row">${est}</div>
          ${edit ? `<label class="check chg-reduced"><input type="checkbox" data-change="sentence-set" data-case-id="${c.id}" data-key="reduced" ${estimate.reduced ? 'checked' : ''}> Verminderte Schuldfähigkeit (§ 8)</label>` : ''}</div>
      </div>
      ${mitig}
      ${dealBlock(c, deals, s, estimate)}
      <div class="chg-list">${rows}</div>
    </div>`;
}

/* ---------------------------------------------------------------- Deal-Rechner (Angebot der Staatsanwaltschaft) */
const DEAL_STATUS = { offen: ['wartet auf Mandant', 'amber'], angenommen: ['angenommen', 'emerald'], abgelehnt: ['abgelehnt', 'red'], zurueckgezogen: ['zurückgezogen', 'slate'] };
const dealOffer = (d) => [d.he != null ? `${d.he} HE` : '', d.fine != null ? usd(d.fine) : ''].filter(Boolean).join(' + ');
const DEAL_VIA = { portal: 'im Portal', discord: 'per Discord', kanzlei: 'im Spiel' };
/** Vergleich mit dem Strafmaß: „8 HE unter der Einschätzung“ bzw. unter/über dem Rahmen. */
function dealCompare(d, s, estimate) {
  if (d.he == null) return '';
  const ref = estimate.he != null ? estimate.he : s.minHe > 0 && s.minHe === s.maxHe ? s.maxHe : null;
  if (ref != null) {
    const diff = ref - d.he;
    return diff > 0 ? `<span class="deal-good">${diff} HE weniger als erwartet (${ref} HE)</span>` : diff < 0 ? `<span class="deal-bad">${-diff} HE mehr als erwartet (${ref} HE)</span>` : `<span>genau wie erwartet (${ref} HE)</span>`;
  }
  if (s.maxHe != null) return d.he < s.maxHe ? `<span class="deal-good">unter dem Rahmen (bis ${s.maxHe} HE)</span>` : `<span class="deal-bad">am oberen Rand (bis ${s.maxHe} HE)</span>`;
  return '';
}
function dealBlock(c, deals, s, estimate) {
  const d = deals[0];
  const add = c.canEdit ? `<button type="button" class="btn-outline btn-sm" data-action="deal-new" data-id="${c.id}">${icon('plus', 'ico-sm')}<span>${d && d.status === 'offen' ? 'Neues Angebot' : 'Angebot der StA'}</span></button>` : '';
  if (!d) return c.canEdit ? `<div class="deal-row deal-empty"><span class="text-sm text-dim">Deal der Staatsanwaltschaft? Eintragen, mit dem Strafmaß vergleichen und vom Mandanten bestätigen lassen.</span>${add}</div>` : '';
  const answer = d.status === 'offen' && c.canEdit
    ? `<button type="button" class="btn-ghost btn-sm" data-action="deal-answer" data-case-id="${c.id}" data-id="${d.id}" data-accept="1" title="Der Mandant hat im Spiel zugestimmt">Zustimmung erfassen</button>
       <button type="button" class="btn-ghost btn-sm" data-action="deal-answer" data-case-id="${c.id}" data-id="${d.id}" data-accept="0" title="Der Mandant hat im Spiel abgelehnt">Ablehnung erfassen</button>
       <button type="button" class="icon-btn sm" data-action="deal-withdraw" data-case-id="${c.id}" data-id="${d.id}" aria-label="Angebot zurückziehen" title="Angebot zurückziehen">${icon('x', 'ico-sm')}</button>`
    : '';
  return `<div class="deal-row">
      <div class="deal-main"><div class="chg-k">Angebot der Staatsanwaltschaft</div>
        <div class="deal-offer"><strong>${esc(dealOffer(d))}</strong>${statusBadge(DEAL_STATUS, d.status)}</div>
        <div class="text-xs text-dim">${dealCompare(d, s, estimate)}${d.answeredAt ? ` · ${esc(DEAL_VIA[d.answeredVia] || '')} am ${esc(fmtDate(d.answeredAt))}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>
      <div class="deal-actions">${answer}${add}</div>
    </div>`;
}
/** Mandant: offenes Angebot mit „Annehmen“ / „Ablehnen“, sonst die Antwort. */
function dealClientCard(c, deals) {
  const d = deals.find((x) => x.status !== 'zurueckgezogen');
  if (!d) return '';
  const open = d.status === 'offen';
  return `<div class="section deal-card" id="secCharges">
      <h3 class="section-title">Angebot der Staatsanwaltschaft</h3>
      <p class="text-sm">Die Staatsanwaltschaft bietet an: <strong>${esc(dealOffer(d))}</strong>${d.note ? ` – ${esc(d.note)}` : ''}.</p>
      ${open
        ? `<p class="text-sm text-dim mt-1">Besprechen Sie das Angebot bitte mit Ihrem Anwalt. Ihre Antwort wird mit Datum in der Akte festgehalten.</p>
           <div class="form-actions mt-3"><button type="button" class="btn-outline btn-md" data-action="deal-answer" data-case-id="${c.id}" data-id="${d.id}" data-accept="0">Ablehnen</button><button type="button" class="btn-gold btn-md" data-action="deal-answer" data-case-id="${c.id}" data-id="${d.id}" data-accept="1">Angebot annehmen</button></div>`
        : `<p class="mt-2">${statusBadge(DEAL_STATUS, d.status)} <span class="text-xs text-dim">am ${esc(fmtDate(d.answeredAt))}</span></p>`}
    </div>`;
}
function dealForm(caseId) {
  return `<h2 id="modalTitle" class="modal-title">Angebot der Staatsanwaltschaft</h2>
      <p class="modal-sub">Der Mandant bekommt das Angebot im Portal und – mit verknüpftem Discord – als Nachricht mit „Annehmen“ / „Ablehnen“.</p>
      <form data-form="deal" data-case-id="${caseId}" class="form-grid">
        <div><label class="label" for="dealHe">Hafteinheiten</label><input id="dealHe" name="he" type="number" min="0" max="999" inputmode="numeric" class="field" placeholder="z. B. 15"></div>
        <div><label class="label" for="dealFine">Geldstrafe ($)</label><input id="dealFine" name="fine" type="number" min="0" step="1000" inputmode="numeric" class="field" placeholder="z. B. 5000"></div>
        <div class="span-2"><label class="label" for="dealNote">Bedingungen (optional)</label><input id="dealNote" name="note" class="field" maxlength="500" placeholder="z. B. Geständnis zu § 21, Anklage wegen § 30 fällt weg"></div>
        <div class="span-2 form-actions"><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button><button class="btn-gold btn-md">Eintragen &amp; Mandant fragen</button></div>
      </form>`;
}

/** Nach einer Änderung: Akte mit der Antwort neu zeichnen (ohne alles neu zu laden). */
async function afterCharges(caseId, payload) {
  if (st.modalCaseId === caseId) await reloadCase(caseId);
  return payload;
}

/* ---------------------------------------------------------------- Tatbestand auswählen */
function pickerRows(q) {
  const norm = (x) => String(x).toLowerCase().replace(/§\s*/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const needle = norm(q.trim());
  const laws = new Map(st.penal.laws.map((l) => [l.para, l]));
  const list = st.penal.offences.filter((o) => {
    if (!needle) return true;
    const hay = norm(`${o.para} ${o.paragraph} ${o.title} ${o.note} ${laws.get(o.para)?.title || ''} ${laws.get(o.para)?.chapterTitle || ''}`);
    return needle.split(/\s+/).every((w) => hay.includes(w) || norm(o.para) === w);
  });
  if (!list.length) return `<p class="gs-hint">Kein Tatbestand für „${esc(q)}“. Suchen Sie nach Paragraph (z. B. 21) oder Stichwort (z. B. Diebstahl).</p>`;
  let chapter = null;
  return list
    .map((o) => {
      const l = laws.get(o.para);
      const head = l && l.chapter !== chapter ? `<div class="pk-chapter">${esc(l.chapter)} · ${esc(l.chapterTitle)}</div>` : '';
      chapter = l ? l.chapter : chapter;
      const added = st.pickerAdded.get(o.id) || 0;
      return `${head}<div class="pk-row ${added ? 'added' : ''}">
          <button type="button" class="pk-add" data-action="charge-add" data-id="${o.id}">
            <span class="pk-cite">${esc(citeShort(o))}</span>
            <span class="pk-main"><span class="pk-title">${esc(o.title)}</span><span class="pk-range">${esc(penaltyText(o))}</span></span>
            <span class="pk-state">${added ? `${icon('check', 'ico-sm')}${added > 1 ? `${added}×` : ''}` : icon('plus', 'ico-sm')}</span>
          </button>
          <button type="button" class="icon-btn sm" data-action="law-open" data-para="${esc(o.para)}" aria-label="Gesetzestext § ${esc(o.para)}" title="Gesetzestext">${icon('book', 'ico-sm')}</button>
        </div>`;
    })
    .join('');
}
async function chargePicker(caseId) {
  await loadPenal();
  st.pickerCase = caseId;
  st.pickerAdded = new Map();
  openModal(`
      <h2 class="modal-title">Anklagepunkt hinzufügen</h2>
      <p class="modal-sub">Antippen fügt den Tatbestand hinzu – mehrmals antippen zählt ihn mehrfach. Das Buch-Symbol zeigt den Gesetzestext.</p>
      <label class="search mt-1">${icon('search')}<input id="pkSearch" class="field" type="search" placeholder="Paragraph oder Stichwort, z. B. 34 oder Raub" autocomplete="off" aria-label="Tatbestand suchen" autofocus></label>
      <div id="pkList" class="pk-list">${pickerRows('')}</div>
      <div class="form-actions mt-4"><button type="button" class="btn-gold btn-md" data-action="close-modal">${icon('check')}<span>Fertig</span></button></div>`);
  $('#pkSearch').addEventListener('input', (e) => ($('#pkList').innerHTML = pickerRows(e.target.value)));
}

/* ---------------------------------------------------------------- Anklage einfügen (Text aus FiveNet / DOJ-Ticket) */
/*
 * Der Anklagetext wird hineinkopiert, der Server erkennt Paragraphen, Anzahl, Versuch/Beihilfe und Tatbestände am Namen
 * (POST /api/penal/parse). Vor dem Übernehmen lässt sich jeder Vorschlag abwählen, umstellen (Absatz) und zählen.
 * Gelesen wird nur der eingefügte Text – die Website greift dafür nicht auf FiveNet zu.
 */
const chargeImport = { caseId: null, items: [], unknown: [], over: new Map(), seq: 0, timer: 0, text: '' };
/** Vorschlag mit den Anpassungen der Person (an/aus, gewählter Tatbestand, Anzahl, Versuch, Beihilfe). */
function ciState(it) {
  const o = chargeImport.over.get(it.key) || {};
  const id = o.id || it.offenceId;
  const off = (st.penal && st.penal.offences.find((x) => x.id === id)) || it;
  return { on: o.on !== false, id, off, count: o.count || it.count, attempted: (o.attempted ?? it.attempted) && !!off.attempt, aiding: o.aiding ?? it.aiding };
}
function ciOver(key, patch) {
  chargeImport.over.set(key, { ...(chargeImport.over.get(key) || {}), ...patch });
  chargeImportRender();
}
function chargeImportHtml() {
  const { items, unknown, text } = chargeImport;
  if (!items.length && !unknown.length) {
    return text.trim() ? `<p class="ci-empty">${icon('info', 'ico-sm')}<span>Noch kein Tatbestand erkannt – ein Paragraph (z. B. § 33) oder ein Name aus dem Strafkatalog (z. B. Diebstahl) genügt.</span></p>` : '';
  }
  const rows = items
    .map((it) => {
      const s = ciState(it);
      const o = s.off;
      const alt = it.alternatives.length
        ? `<select class="field ci-alt" data-change="ci-alt" data-key="${esc(it.key)}" aria-label="Welcher Absatz?">${it.alternatives.map((a) => opt(a.id, `${a.citation} – ${a.title}`, a.id === s.id)).join('')}</select>`
        : '';
      return `<div class="chg-row ci-row ${s.on ? '' : 'is-off'}">
        <div class="chg-main">
          <label class="ci-check"><input type="checkbox" data-change="ci-toggle" data-key="${esc(it.key)}" ${s.on ? 'checked' : ''} aria-label="${esc(`${citeShort(o)} ${o.title} übernehmen`)}"></label>
          <span class="pk-cite">${esc(citeShort(o))}</span>
          <div class="chg-title"><span>${esc(o.title)}</span><span class="chg-range">${esc(penaltyText(o))}</span>${alt}
            <span class="ci-src" title="${esc(it.lines.join('\n'))}">„${esc(it.lines[0])}“${it.lines.length > 1 ? ` +${it.lines.length - 1}` : ''}</span></div>
        </div>
        <div class="chg-side">
          ${o.attempt ? `<button type="button" class="chg-flag ${s.attempted ? 'on' : ''}" data-action="ci-flag" data-key="${esc(it.key)}" data-flag="attempted" aria-pressed="${s.attempted}">Versuch</button>` : ''}
          <button type="button" class="chg-flag ${s.aiding ? 'on' : ''}" data-action="ci-flag" data-key="${esc(it.key)}" data-flag="aiding" aria-pressed="${s.aiding}">Beihilfe</button>
          <span class="stepper" role="group" aria-label="Anzahl">
            <button type="button" data-action="ci-count" data-key="${esc(it.key)}" data-count="${s.count - 1}" ${s.count <= 1 ? 'disabled' : ''} aria-label="Einmal weniger">−</button>
            <span>${s.count}×</span>
            <button type="button" data-action="ci-count" data-key="${esc(it.key)}" data-count="${s.count + 1}" ${s.count >= 20 ? 'disabled' : ''} aria-label="Einmal mehr">+</button>
          </span>
        </div></div>`;
    })
    .join('');
  const miss = unknown.length
    ? `<p class="ci-unknown">${icon('alert', 'ico-sm')}<span>Nicht übernommen: ${unknown.map((u) => `<b>${esc(u.ref)}</b> (${esc(u.reason)})`).join(' · ')}</span></p>`
    : '';
  return `${items.length ? `<div class="ci-head"><span>Erkannt</span><span class="sec-count">${items.length}</span></div><div class="chg-list ci-list">${rows}</div>` : ''}${miss}`;
}
function chargeImportRender() {
  const box = $('#ciResult');
  if (!box) return;
  box.innerHTML = chargeImportHtml();
  const n = chargeImport.items.filter((it) => ciState(it).on).length;
  const btn = $('#ciSave');
  if (btn) {
    btn.disabled = !n;
    btn.querySelector('span').textContent = n ? `${n === 1 ? '1 Anklagepunkt' : `${n} Anklagepunkte`} übernehmen` : 'Übernehmen';
  }
}
async function chargeImportParse() {
  const ta = $('#ciText');
  if (!ta) return;
  const text = ta.value;
  const seq = ++chargeImport.seq;
  chargeImport.text = text;
  if (!text.trim()) {
    chargeImport.items = [];
    chargeImport.unknown = [];
    return chargeImportRender();
  }
  const r = await api.post('/api/penal/parse', { text });
  if (seq !== chargeImport.seq || !$('#ciText')) return; // inzwischen weitergetippt oder geschlossen
  chargeImport.items = r.items.map((it) => ({ ...it, key: String(it.offenceId) }));
  chargeImport.unknown = r.unknown;
  chargeImportRender();
}
async function chargeImportModal(caseId) {
  await loadPenal();
  Object.assign(chargeImport, { caseId, items: [], unknown: [], over: new Map(), text: '' });
  st.returnCase = caseId;
  openModal(`
      <h2 class="modal-title">Anklage einfügen</h2>
      <p class="modal-sub">Den Anklagetext aus FiveNet oder dem DOJ-Ticket hier hineinkopieren – die erkannten Tatbestände erscheinen darunter und lassen sich vor dem Übernehmen anpassen. Gelesen wird nur der eingefügte Text.</p>
      <form data-form="charge-import" data-case-id="${caseId}">
        <textarea id="ciText" name="text" class="field ci-text" rows="6" maxlength="20000" placeholder="z. B.&#10;§ 33 StGB – Diebstahl (2x)&#10;§ 66 Abs. 1 Widerstand gegen Vollstreckungsbeamte&#10;Gefährliche Körperverletzung" aria-label="Anklagetext" autofocus></textarea>
        <div id="ciResult" class="ci-result" aria-live="polite"></div>
        <div class="form-actions mt-4"><button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button><button type="submit" class="btn-gold btn-md" id="ciSave" disabled>${icon('check')}<span>Übernehmen</span></button></div>
      </form>`);
  const ta = $('#ciText');
  ta.addEventListener('input', () => {
    clearTimeout(chargeImport.timer);
    chargeImport.timer = setTimeout(() => guard(chargeImportParse), 250);
  });
  if (ta.value.trim()) guard(chargeImportParse); // wiederhergestellter Entwurf
}

/* ---------------------------------------------------------------- Gesetzestext */
function lawTextHtml(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const abs = line.match(/^\((\d+)\)\s*(.*)$/);
      if (abs) return `<p><span class="law-abs">(${abs[1]})</span> ${esc(abs[2])}</p>`;
      if (/^\d+\.\s/.test(line) || /^–\s/.test(line)) return `<p class="law-item">${esc(line)}</p>`;
      return `<p>${esc(line)}</p>`;
    })
    .join('');
}
async function openLaw(para) {
  const r = await api.get('/api/penal/laws/' + encodeURIComponent(para));
  const l = r.law;
  openModal(
    `
      <p class="text-xs uppercase tracking-widest text-dim">${esc(l.chapter)} · ${esc(l.chapterTitle)}</p>
      <h2 class="modal-title mt-1"><span class="text-gold">§ ${esc(l.para)}</span> ${esc(l.title)}</h2>
      <div class="law-text">${lawTextHtml(l.text) || '<p class="text-dim">Kein Text hinterlegt.</p>'}</div>
      ${
        r.offences.length
          ? `<div class="law-ranges">${r.offences
              .map(
                (o) =>
                  `<div><span class="pk-cite">${esc(citeShort(o))}</span><span>${esc(o.title)}</span><span class="pk-range">${esc(penaltyText(o))}</span>${
                    isBoard() ? `<button type="button" class="icon-btn sm" data-action="offence-edit" data-id="${o.id}" aria-label="Strafrahmen bearbeiten" title="Strafrahmen bearbeiten">${icon('edit', 'ico-sm')}</button>` : ''
                  }</div>`
              )
              .join('')}</div>`
          : ''
      }
      <div class="form-actions mt-5"><button type="button" class="btn-outline btn-md" data-action="close-modal">Zurück</button>${
        isBoard()
          ? `<button type="button" class="btn-ghost btn-md" data-action="law-edit" data-para="${esc(l.para)}">${icon('edit', 'ico-sm')}<span>Text bearbeiten</span></button><button type="button" class="btn-ghost btn-md" data-action="offence-add-to" data-para="${esc(l.para)}">${icon('plus', 'ico-sm')}<span>Tatbestand</span></button>`
          : ''
      }</div>`,
    { key: `law-${l.para}`, reopen: () => openLaw(l.para) }
  );
}

Object.assign(actions, {
  'charge-pick': (el) => chargePicker(Number(el.dataset.id)),
  'charge-add': async (el) => {
    const id = Number(el.dataset.id);
    const caseId = st.pickerCase;
    // sofort sichtbar: Haken an der Zeile – die Akte dahinter wird im Hintergrund neu geladen
    st.pickerAdded.set(id, (st.pickerAdded.get(id) || 0) + 1);
    $('#pkList').innerHTML = pickerRows($('#pkSearch').value);
    try {
      await api.post(`/api/cases/${caseId}/charges`, { offenceId: id });
      buzz();
    } catch (e) {
      st.pickerAdded.set(id, st.pickerAdded.get(id) - 1);
      $('#pkList') && ($('#pkList').innerHTML = pickerRows($('#pkSearch').value));
      throw e;
    }
  },
  'charge-count': async (el) => afterCharges(Number(el.dataset.caseId), await api.patch(`/api/cases/${el.dataset.caseId}/charges/${el.dataset.id}`, { count: Number(el.dataset.count) })),
  'charge-flag': async (el) => {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.classList.toggle('on', on); // sofort sichtbar
    await afterCharges(Number(el.dataset.caseId), await api.patch(`/api/cases/${el.dataset.caseId}/charges/${el.dataset.id}`, { [el.dataset.flag]: on }));
  },
  'charge-remove': async (el) => {
    el.closest('.chg-row')?.classList.add('undo-hidden');
    await afterCharges(Number(el.dataset.caseId), await api.del(`/api/cases/${el.dataset.caseId}/charges/${el.dataset.id}`));
    toast('Anklagepunkt entfernt.');
  },
  'sentence-set': async (el) => {
    const key = el.dataset.key;
    const v = key === 'reduced' ? el.checked : el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
    if (key !== 'reduced' && v !== null && !Number.isFinite(v)) return;
    await afterCharges(Number(el.dataset.caseId), await api.patch(`/api/cases/${el.dataset.caseId}/charges/sentence`, { [key]: v }));
  },
  'law-open': (el) => openLaw(el.dataset.para),
  'charge-import': (el) => chargeImportModal(Number(el.dataset.id)),
  'ci-toggle': (el) => ciOver(el.dataset.key, { on: el.checked }),
  'ci-alt': (el) => ciOver(el.dataset.key, { id: Number(el.value) }),
  'ci-count': (el) => ciOver(el.dataset.key, { count: Math.min(20, Math.max(1, Number(el.dataset.count))) }),
  'ci-flag': (el) => ciOver(el.dataset.key, { [el.dataset.flag]: el.getAttribute('aria-pressed') !== 'true' }),
});
Object.assign(forms, {
  'charge-import': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const items = chargeImport.items
      .map(ciState)
      .filter((x) => x.on)
      .map((x) => ({ offenceId: x.id, count: x.count, attempted: x.attempted, aiding: x.aiding }));
    if (!items.length) throw new Error('Bitte mindestens einen erkannten Tatbestand auswählen.');
    await api.post(`/api/cases/${caseId}/charges/bulk`, { items });
    toast(items.length === 1 ? '1 Anklagepunkt übernommen.' : `${items.length} Anklagepunkte übernommen.`);
    await returnOrClose();
    await reloadCase(caseId);
  },
});

/* ================================================================
   Verhandlungsmodus: ruhige Vollbild-Ansicht für die Verhandlung im Spiel – Kurzfassung der Akte, Anklagepunkte mit
   Strafrahmen, Beweise groß zum Zeigen, Notizen mit Uhrzeit und eine Redezeit-Uhr. „Beenden“ speichert die Notizen als
   Verhandlungsprotokoll (interne Notiz) in der Akte. Notizen und Startzeit liegen bis dahin im Browser – ein Neuladen
   oder versehentliches Schließen verliert nichts, beim nächsten Öffnen geht es weiter.
   ================================================================ */
const HEARING_KEY = (id) => `ps.hearing.${id}`;
const HEARING_TAGS = ['Zeuge', 'Einspruch', 'Richter', 'Staatsanwalt', 'Beweis', 'Urteil'];
const hearing = { caseId: null, data: null, state: null, tick: 0, speech: null, photo: -1, tab: 'case' };

function hearingLoad(id) {
  try {
    const s = JSON.parse(localStorage.getItem(HEARING_KEY(id)) || 'null');
    if (s && Number.isFinite(s.start) && Array.isArray(s.notes)) return s;
  } catch {
    /* ohne Speicher eben frisch */
  }
  return { start: Date.now(), notes: [] };
}
function hearingSave() {
  try {
    localStorage.setItem(HEARING_KEY(hearing.caseId), JSON.stringify(hearing.state));
  } catch {
    /* Speicher voll oder gesperrt – Notizen bleiben bis zum Beenden im Fenster */
  }
}
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const clockOf = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

async function startHearing(caseId) {
  const data = await api.get('/api/cases/' + caseId);
  hearing.caseId = caseId;
  hearing.data = data;
  hearing.state = hearingLoad(caseId);
  hearing.photo = -1;
  hearing.tab = 'case';
  hearingSave();
  let el = $('#hearing');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hearing';
    el.className = 'hearing';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Verhandlungsmodus');
    document.body.appendChild(el);
  }
  el.innerHTML = hearingHtml();
  document.body.classList.add('hearing-open');
  renderHearingNotes();
  clearInterval(hearing.tick);
  hearing.tick = setInterval(hearingClock, 1000);
  hearingClock();
  if (window.matchMedia('(hover: hover)').matches) $('#hrInput').focus();
}

function hearingHtml() {
  const { case: c, attachments = [], charges } = hearing.data;
  const s = charges && charges.sentence;
  const list = charges ? charges.charges : [];
  const photos = attachments.filter((a) => /^image\//.test(a.mime));
  const facts = [
    ['Mandant', c.clientName],
    c.opponent ? ['Gegenpartei', c.opponent] : null,
    c.courtRef ? ['Gerichtsaktenzeichen', c.courtRef] : null,
    ['Zuständig', caseTeam(c).map((l) => l.name).join(', ') || '—'],
  ].filter(Boolean);
  const haft = !s || !list.length ? '' : s.fineOnly ? 'nur Geldstrafe' : s.minHe > 0 ? `${s.minHe}–${s.maxHe} HE` : `bis ${s.maxHe} HE`;
  return `
    <header class="hr-top">
      <div class="hr-id"><span class="font-mono text-gold text-sm">${esc(c.caseNumber)}</span><strong>${esc(c.title)}</strong></div>
      <div class="hr-clock" title="Dauer der Verhandlung"><span class="hr-live" aria-hidden="true"></span><span id="hrTimer">0:00</span></div>
      <div class="hr-actions">
        <button type="button" class="btn-ghost btn-sm" data-action="plea-open">${icon('doc', 'ico-sm')}<span>Plädoyer</span></button>
        <div class="hr-speech-wrap">
          <button type="button" class="btn-ghost btn-sm" data-action="hr-speech-menu" aria-haspopup="true" aria-expanded="false">${icon('clock', 'ico-sm')}<span id="hrSpeechLabel">Redezeit</span></button>
          <div class="hr-pop" id="hrSpeechPop" hidden>${[2, 3, 5, 10].map((m) => `<button type="button" data-action="hr-speech" data-min="${m}">${m} Min.</button>`).join('')}<button type="button" data-action="hr-speech" data-min="0">Aus</button></div>
        </div>
        <button type="button" class="btn-gold btn-sm" data-action="hr-end">${icon('check', 'ico-sm')}<span>Beenden & speichern</span></button>
        <button type="button" class="icon-btn" data-action="hr-close" aria-label="Verhandlungsmodus schließen (Notizen bleiben erhalten)" title="Schließen – Notizen bleiben erhalten">${icon('x')}</button>
      </div>
    </header>
    <div class="hr-tabs" role="tablist">
      <button type="button" role="tab" class="hr-tab active" data-action="hr-tab" data-tab="case" aria-selected="true">Akte & Beweise</button>
      <button type="button" role="tab" class="hr-tab" data-action="hr-tab" data-tab="notes" aria-selected="false">Notizen <span class="hr-count" id="hrNoteCount"></span></button>
    </div>
    <main class="hr-grid" data-tab="case">
      <section class="hr-col hr-left" aria-label="Akte">
        <div class="hr-card">
          <h3 class="hr-h">Sachverhalt</h3>
          ${c.description ? `<p class="hr-desc">${esc(c.description)}</p>` : '<p class="text-dim text-sm">Noch nicht beschrieben.</p>'}
          <dl class="hr-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        </div>
        ${
          list.length
            ? `<div class="hr-card">
          <h3 class="hr-h">Anklagepunkte <span class="hr-h-meta">${esc(haft)}${s && s.fineMax ? ` · Geldstrafe bis ${esc(usd(s.fineMax))}` : ''}</span></h3>
          <div class="hr-charges">${list
            .map(
              (ch) => `<button type="button" class="hr-charge" data-action="hr-law" data-para="${esc(ch.para)}">
                <span class="chg-cite">${esc(citeShort(ch))}</span>
                <span class="hr-charge-main"><span>${ch.count > 1 ? `${ch.count}× ` : ''}${esc(ch.title)}${ch.attempted ? ' · Versuch' : ''}${ch.aiding ? ' · Beihilfe' : ''}</span><span class="chg-range">${esc(penaltyText(ch))}</span></span>
              </button>`
            )
            .join('')}</div>
          ${s && s.mitigations.length ? `<p class="chg-mitig">${icon('info', 'ico-sm')}<span>Milderung möglich: ${s.mitigations.map(esc).join(' · ')}</span></p>` : ''}
          ${charges.estimate && charges.estimate.he != null ? `<p class="hr-est">Unsere Einschätzung: <strong>${charges.estimate.he} HE</strong>${charges.estimate.fine != null ? ` · ${esc(usd(charges.estimate.fine))}` : ''}</p>` : ''}
          <div id="hrLaw" class="hr-law" hidden></div>
        </div>`
            : ''
        }
        <div class="hr-card">
          <h3 class="hr-h">Beweise <span class="hr-h-meta">${photos.length ? `${photos.length} ${photos.length === 1 ? 'Bild' : 'Bilder'} – antippen zum Zeigen` : ''}</span></h3>
          ${
            photos.length
              ? `<div class="hr-photos">${photos
                  .map(
                    (a, i) => `<button type="button" class="hr-photo" data-action="hr-photo" data-index="${i}" aria-label="${esc(a.caption || `Beweis ${i + 1}`)} groß anzeigen">
                      <img src="${esc(a.thumbUrl || a.url)}" alt="" loading="lazy" decoding="async"><span>${esc(a.caption || `Beweis ${i + 1}`)}</span></button>`
                  )
                  .join('')}</div>`
              : '<p class="text-dim text-sm">Keine Bilder in der Akte.</p>'
          }
        </div>
      </section>
      <section class="hr-col hr-notes" aria-label="Notizen">
        <div class="hr-notes-head"><h3 class="hr-h">Notizen</h3><span class="text-xs text-dim">mit Uhrzeit · werden beim Beenden gespeichert</span></div>
        <div class="hr-note-list" id="hrNotes" aria-live="polite"></div>
        <div class="hr-tags">${HEARING_TAGS.map((t) => `<button type="button" class="chg-flag" data-action="hr-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="hr-input">
          <textarea id="hrInput" class="field" rows="2" maxlength="1500" placeholder="Was passiert gerade? Enter speichert die Notiz."></textarea>
          <button type="button" class="btn-gold chat-send" data-action="hr-note" aria-label="Notiz hinzufügen" title="Notiz hinzufügen">${icon('plus')}</button>
        </div>
      </section>
    </main>
    <div class="hr-lightbox" id="hrLightbox" hidden></div>`;
}

function renderHearingNotes() {
  const box = $('#hrNotes');
  if (!box) return;
  const notes = hearing.state.notes;
  box.innerHTML = notes.length
    ? notes
        .map(
          (n, i) => `<div class="hr-note"><span class="hr-note-time">${esc(clockOf(n.t))}</span><span class="hr-note-text">${esc(n.text)}</span>
            <button type="button" class="hr-note-del" data-action="hr-note-del" data-index="${i}" aria-label="Notiz löschen" title="Löschen">${icon('x', 'ico-sm')}</button></div>`
        )
        .join('')
    : '<p class="hr-empty">Noch keine Notizen. Schreiben Sie mit, was Zeugen, Richter und Staatsanwaltschaft sagen – jede Notiz bekommt automatisch die Uhrzeit.</p>';
  box.scrollTop = box.scrollHeight;
  const count = $('#hrNoteCount');
  if (count) count.textContent = notes.length ? String(notes.length) : '';
}

function hearingClock() {
  if (!hearing.state || !$('#hrTimer')) return clearInterval(hearing.tick);
  $('#hrTimer').textContent = mmss(Date.now() - hearing.state.start);
  const label = $('#hrSpeechLabel');
  if (!label) return;
  if (!hearing.speech) {
    label.textContent = 'Redezeit';
    label.parentElement.classList.remove('hr-speech-on', 'hr-speech-over');
    return;
  }
  const left = hearing.speech - Date.now();
  label.textContent = left > 0 ? mmss(left) : `+${mmss(-left)}`;
  label.parentElement.classList.add('hr-speech-on');
  label.parentElement.classList.toggle('hr-speech-over', left <= 0);
}

function hearingAddNote(text) {
  const t = String(text || '').trim();
  if (!t) return;
  hearing.state.notes.push({ t: Date.now(), text: t.slice(0, 1500) });
  hearingSave();
  renderHearingNotes();
}

function showHearingPhoto(i) {
  const photos = (hearing.data.attachments || []).filter((a) => /^image\//.test(a.mime));
  const box = $('#hrLightbox');
  if (i < 0 || !photos.length) {
    hearing.photo = -1;
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  hearing.photo = (i + photos.length) % photos.length;
  const a = photos[hearing.photo];
  box.hidden = false;
  box.innerHTML = `
    <button type="button" class="hr-lb-close icon-btn" data-action="hr-photo-close" aria-label="Schließen">${icon('x')}</button>
    ${photos.length > 1 ? `<button type="button" class="hr-lb-nav prev" data-action="hr-photo-step" data-step="-1" aria-label="Vorheriges Bild">${icon('chevronLeft')}</button><button type="button" class="hr-lb-nav next" data-action="hr-photo-step" data-step="1" aria-label="Nächstes Bild">${icon('chevronRight')}</button>` : ''}
    <figure><img src="${esc(a.url)}" alt="${esc(a.caption || '')}"><figcaption>${esc(a.caption || `Beweis ${hearing.photo + 1}`)} · ${hearing.photo + 1} / ${photos.length}</figcaption></figure>`;
}

function closeHearing() {
  clearInterval(hearing.tick);
  hearing.speech = null;
  $('#hearing')?.remove();
  document.body.classList.remove('hearing-open');
  hearing.caseId = null;
}

/** Notizen als Verhandlungsprotokoll in die Akte (interne Notiz; lange Protokolle in mehreren Teilen). */
async function endHearing() {
  const notes = hearing.state.notes;
  const minutes = Math.max(1, Math.round((Date.now() - hearing.state.start) / 60000));
  if (notes.length) {
    const head = `Verhandlungsprotokoll · ${new Date(hearing.state.start).toLocaleDateString('de-DE')} ${clockOf(hearing.state.start)}–${clockOf(Date.now())} (${minutes} Min.)`;
    const lines = notes.map((n) => `[${clockOf(n.t)}] ${n.text}`);
    const parts = [];
    let cur = head;
    for (const l of lines) {
      if ((cur + '\n' + l).length > 3900) {
        parts.push(cur);
        cur = `${head} – Fortsetzung`;
      }
      cur += '\n' + l;
    }
    parts.push(cur);
    for (const body of parts) await api.post(`/api/cases/${hearing.caseId}/notes`, { body, internal: true });
  }
  const id = hearing.caseId;
  try {
    localStorage.removeItem(HEARING_KEY(id));
  } catch {
    /* egal */
  }
  closeHearing();
  toast(notes.length ? `Verhandlungsprotokoll gespeichert (${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}, ${minutes} Min.).` : 'Verhandlungsmodus beendet.');
  if (st.modalCaseId === id) await reloadCase(id);
}

// Tasten im Verhandlungsmodus: Enter speichert die Notiz, Pfeile blättern Beweise, Esc schließt nur Bild bzw. Menü –
// die übrigen Kürzel des Dashboards (Suche, Fenster schließen) ruhen solange
window.addEventListener(
  'keydown',
  (e) => {
    if (!document.body.classList.contains('hearing-open')) return;
    if ($('#prompter')) return promptKey(e); // Teleprompter: Leertaste, Pfeile, Esc
    if (e.target.id === 'hrInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      hearingAddNote(e.target.value);
      e.target.value = '';
      return;
    }
    if (hearing.photo >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      showHearingPhoto(hearing.photo + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (hearing.photo >= 0) showHearingPhoto(-1);
      else if (!$('#hrSpeechPop').hidden) $('#hrSpeechPop').hidden = true;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') e.stopPropagation();
  },
  true
);

Object.assign(actions, {
  'hearing-start': (el) => startHearing(Number(el.dataset.id)),
  'hr-close': () => {
    closeHearing();
    toast('Verhandlungsmodus geschlossen – Notizen und Uhr laufen weiter, wenn Sie ihn wieder öffnen.');
  },
  'hr-end': async () => {
    const n = hearing.state.notes.length;
    const text = n ? `${n === 1 ? 'Die Notiz wird' : `Die ${n} Notizen werden`} als Verhandlungsprotokoll (intern) in der Akte gespeichert.` : 'Es gibt keine Notizen – es wird nichts gespeichert.';
    if (!(await window.PS.confirm(text, { title: 'Verhandlung beenden?', confirmText: n ? 'Beenden & speichern' : 'Beenden' }))) return;
    await endHearing();
  },
  'hr-note': () => {
    const input = $('#hrInput');
    hearingAddNote(input.value);
    input.value = '';
    input.focus();
  },
  'hr-note-del': (el) => {
    hearing.state.notes.splice(Number(el.dataset.index), 1);
    hearingSave();
    renderHearingNotes();
  },
  'hr-tag': (el) => {
    const input = $('#hrInput');
    input.value = `${el.dataset.tag}: ${input.value.replace(/^[^:]{1,20}:\s*/, '')}`;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  },
  'hr-tab': (el) => {
    hearing.tab = el.dataset.tab;
    $('#hearing .hr-grid').dataset.tab = hearing.tab;
    $$('#hearing .hr-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === hearing.tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === hearing.tab));
    });
    if (hearing.tab === 'notes') renderHearingNotes();
  },
  'hr-speech-menu': (el) => {
    const pop = $('#hrSpeechPop');
    pop.hidden = !pop.hidden;
    el.setAttribute('aria-expanded', String(!pop.hidden));
  },
  'hr-speech': (el) => {
    const min = Number(el.dataset.min);
    hearing.speech = min ? Date.now() + min * 60000 : null;
    $('#hrSpeechPop').hidden = true;
    hearingClock();
  },
  'hr-photo': (el) => showHearingPhoto(Number(el.dataset.index)),
  'hr-photo-step': (el) => showHearingPhoto(hearing.photo + Number(el.dataset.step)),
  'hr-photo-close': () => showHearingPhoto(-1),
  'hr-law': async (el) => {
    const box = $('#hrLaw');
    if (!box.hidden && box.dataset.para === el.dataset.para) {
      box.hidden = true;
      return;
    }
    const r = await api.get('/api/penal/laws/' + encodeURIComponent(el.dataset.para));
    box.dataset.para = el.dataset.para;
    box.innerHTML = `<div class="hr-law-head"><strong><span class="text-gold">§ ${esc(r.law.para)}</span> ${esc(r.law.title)}</strong><button type="button" class="icon-btn sm" data-action="hr-law-close" aria-label="Gesetzestext schließen">${icon('x', 'ico-sm')}</button></div><div class="law-text">${lawTextHtml(r.law.text)}</div>`;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  'hr-law-close': () => ($('#hrLaw').hidden = true),
});

/* ---------------------------------------------------------------- Plädoyer-Baukasten mit Teleprompter */
/*
 * Im Verhandlungsmodus: Plädoyer aus vier Bausteinen (Eröffnung, Sachverhalt, Beweiswürdigung, Antrag). „Vorschlag“
 * füllt sie aus Akte, Anklagepunkten, Beweisen und Einschätzung; gespeichert wird mit den Notizen der Verhandlung
 * (im Browser). Der Teleprompter zeigt den Text groß und lässt ihn langsam durchlaufen – Leertaste hält an,
 * Pfeile ändern das Tempo, Esc schließt.
 */
const PLEA_PARTS = [
  ['open', 'Eröffnung'],
  ['facts', 'Sachverhalt'],
  ['evidence', 'Beweiswürdigung'],
  ['motion', 'Antrag'],
];
function pleaSuggestion() {
  const { case: c, attachments = [], charges, deals = [] } = hearing.data;
  const who = c.clientName && c.clientName !== '—' ? c.clientName : 'meinen Mandanten';
  const list = (charges && charges.charges) || [];
  const est = charges && charges.estimate;
  const s = charges && charges.sentence;
  const deal = deals.find((d) => d.status === 'angenommen');
  const facts = String(c.description || '').trim();
  return {
    open: `Hohes Gericht, ich vertrete heute ${who} in der Sache „${c.title}“ (${c.caseNumber}).`,
    facts: facts ? `Zum Sachverhalt: ${facts.length > 600 ? `${facts.slice(0, 600)} …` : facts}` : 'Zum Sachverhalt: …',
    evidence: [
      list.length ? `Die Anklage stützt sich auf ${list.map((ch) => `${citeShort(ch)} (${ch.title})`).join(', ')}.` : 'Die Anklage stützt sich auf …',
      attachments.length ? `Es liegen ${attachments.length} Beweismittel vor; keines davon belegt den Vorwurf zweifelsfrei.` : 'Beweismittel, die den Vorwurf zweifelsfrei belegen, liegen nicht vor.',
      s && s.mitigations && s.mitigations.length ? `Zu berücksichtigen ist: ${s.mitigations.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    motion: deal
      ? `Entsprechend der Absprache mit der Staatsanwaltschaft beantrage ich eine Strafe von ${dealOffer(deal)}.`
      : est && est.he != null
        ? `Ich beantrage, ${who} zu einer Strafe von höchstens ${est.he} HE${est.fine != null ? ` und ${usd(est.fine)}` : ''} zu verurteilen – hilfsweise den Freispruch.`
        : `Ich beantrage, ${who} freizusprechen.`,
  };
}
const pleaState = () => (hearing.state.plea = hearing.state.plea || { open: '', facts: '', evidence: '', motion: '' });
const pleaText = () =>
  PLEA_PARTS.map(([k]) => pleaState()[k].trim())
    .filter(Boolean)
    .join('\n\n');
function openPlea() {
  const p = pleaState();
  let el = $('#pleaPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pleaPanel';
    el.className = 'plea-panel';
    $('#hearing').appendChild(el);
  }
  el.innerHTML = `<div class="plea-card" role="dialog" aria-modal="true" aria-labelledby="pleaTitle">
      <div class="plea-head"><h2 id="pleaTitle" class="font-serif text-2xl">Plädoyer</h2>
        <div class="flex gap-2"><button type="button" class="btn-ghost btn-sm" data-action="plea-suggest">${icon('refresh', 'ico-sm')}<span>Vorschlag</span></button>
        <button type="button" class="btn-gold btn-sm" data-action="plea-prompter" ${pleaText() ? '' : 'disabled'}>${icon('view', 'ico-sm')}<span>Teleprompter</span></button>
        <button type="button" class="icon-btn" data-action="plea-close" aria-label="Plädoyer schließen">${icon('x')}</button></div></div>
      <p class="text-sm text-dim mb-3">Bausteine bearbeiten – gespeichert wird automatisch mit den Notizen der Verhandlung.</p>
      ${PLEA_PARTS.map(([k, l]) => `<label class="label" for="plea_${k}">${esc(l)}</label><textarea id="plea_${k}" class="field plea-field" data-plea="${k}" rows="${k === 'facts' || k === 'evidence' ? 4 : 2}">${esc(p[k])}</textarea>`).join('')}
    </div>`;
  $('#plea_open').focus();
}
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.plea;
  if (!k || !hearing.state) return;
  pleaState()[k] = e.target.value;
  hearingSave();
  const btn = $('[data-action="plea-prompter"]');
  if (btn) btn.disabled = !pleaText();
});

const prompter = { speed: 1, paused: false, raf: 0, last: 0 };
function openPrompter() {
  const text = pleaText();
  if (!text) return;
  const el = document.createElement('div');
  el.id = 'prompter';
  el.className = 'prompter';
  el.innerHTML = `<div class="prompter-text" id="prompterText">${text.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}<p class="prompter-end">— Ende —</p></div>
    <div class="prompter-bar"><button type="button" class="btn-ghost btn-sm" data-action="prompter-speed" data-step="-1" aria-label="Langsamer">−</button>
      <span id="prompterSpeed">Tempo 1</span>
      <button type="button" class="btn-ghost btn-sm" data-action="prompter-speed" data-step="1" aria-label="Schneller">+</button>
      <button type="button" class="btn-outline btn-sm" data-action="prompter-pause" id="prompterPause">Pause</button>
      <button type="button" class="btn-ghost btn-sm" data-action="prompter-close">Schließen</button></div>`;
  $('#hearing').appendChild(el);
  Object.assign(prompter, { speed: 1, paused: false, last: performance.now() });
  cancelAnimationFrame(prompter.raf);
  const box = $('#prompterText');
  const step = (t) => {
    if (!$('#prompter')) return;
    const dt = t - prompter.last;
    prompter.last = t;
    if (!prompter.paused) box.scrollTop += (dt / 1000) * 22 * prompter.speed; // Pixel je Sekunde
    prompter.raf = requestAnimationFrame(step);
  };
  prompter.raf = requestAnimationFrame(step);
}
function promptSpeed(step) {
  prompter.speed = Math.max(0.5, Math.min(4, prompter.speed + step * 0.5));
  $('#prompterSpeed').textContent = `Tempo ${prompter.speed.toLocaleString('de-DE')}`;
}
function promptPause() {
  prompter.paused = !prompter.paused;
  $('#prompterPause').textContent = prompter.paused ? 'Weiter' : 'Pause';
}
function closePrompter() {
  cancelAnimationFrame(prompter.raf);
  $('#prompter')?.remove();
}
function promptKey(e) {
  const key = { ' ': () => promptPause(), ArrowUp: () => promptSpeed(1), ArrowRight: () => promptSpeed(1), ArrowDown: () => promptSpeed(-1), ArrowLeft: () => promptSpeed(-1), Escape: () => closePrompter() }[e.key];
  if (!key) return;
  e.preventDefault();
  e.stopPropagation();
  key();
}

Object.assign(actions, {
  'plea-open': () => openPlea(),
  'plea-close': () => $('#pleaPanel')?.remove(),
  'plea-suggest': async () => {
    const p = pleaState();
    if (PLEA_PARTS.some(([k]) => p[k].trim()) && !(await ask('Die Bausteine werden durch den Vorschlag ersetzt.', { title: 'Vorschlag einfügen?', confirmText: 'Ersetzen' }))) return;
    Object.assign(p, pleaSuggestion());
    hearingSave();
    openPlea();
  },
  'plea-prompter': () => openPrompter(),
  'prompter-speed': (el) => promptSpeed(Number(el.dataset.step)),
  'prompter-pause': () => promptPause(),
  'prompter-close': () => closePrompter(),
});

