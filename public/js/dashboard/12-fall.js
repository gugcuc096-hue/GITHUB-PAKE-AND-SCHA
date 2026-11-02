/*
 * Kanzlei-Dashboard – Fall-Bausteine je Rechtsgebiet (Reiter „Fall“ der Akte): Zivilrecht (Ansprüche, Anträge, Korrespondenz,
 * Streitwert), Verfassungsrecht (angegriffener Akt, Zulässigkeit, Grundrechte/Normen, Beteiligte), Vertragsrecht (Gegenstand,
 * Parteien, Klauseln mit Ampel, Laufzeit, Entwurfsversionen, Modus Gestaltung/Streit). Aufbau und Felder kommen vom Server
 * (domain/fall.js, in der Akte unter „fall“); hier wird nur generisch gezeichnet und gespeichert. Nur Kanzlei.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/** Grundreihenfolge je Rechtsgebiet im Reiter „Fall“ (eigene und vom Board vorgegebene Ansichten gehen vor). */
const FALL_ORDER = {
  zivilrecht: ['tathergang', 'claims', 'motions', 'witnesses', 'evidence', 'karte', 'corr'],
  verfassungsrecht: ['subject', 'admiss', 'norms', 'participants', 'evidence'],
  vertragsrecht: ['subject', 'parties', 'clauses', 'term', 'versions', 'vclaims', 'evidence'],
};
const fallAnchor = (key) => `sec${key[0].toUpperCase()}${key.slice(1)}`;
/** Bezeichnung eines Standard-Abschnitts im Rechtsgebiet der offenen Akte (z. B. „Anlagen“ statt „Beweismittel & Anhänge“). */
const fallTitle = (key, dflt) => (st.caseFall && st.caseFall.retitle && st.caseFall.retitle[key]) || dflt;
/** Standard-Abschnitt in diesem Rechtsgebiet unterdrücken (nur wenn es noch nichts darin gibt)? */
const fallQuiet = (key, hasData) => !!(st.caseFall && !hasData && ((st.caseFall.hide || []).includes(key) || (st.caseFall.quiet || []).includes(key)));

const FALL_CHECK = { offen: ['offen', 'slate'], ja: ['erfüllt', 'emerald'], nein: ['nicht erfüllt', 'red'] };
const FALL_TRI = { offen: ['offen', 'slate'], ja: ['ja', 'emerald'], nein: ['nein', 'red'] };
const FALL_DONE_STATES = new Set(['erledigt', 'anerkannt']);

const fallOptionOf = (spec, v) => (spec.options || []).find((o) => o[0] === v);
const fallEmpty = (v) => v === '' || v == null;
/** Wert eines Felds als Text. */
function fallShow(spec, v) {
  if (spec.type === 'date') return v ? fmtDateOnly(v) : '';
  if (spec.type === 'money') return v == null ? '' : money(v);
  if (spec.type === 'select') return (fallOptionOf(spec, v) || [v, v])[1];
  return String(v ?? '');
}
const fallWhenOk = (spec, meta) => !spec.when || Object.entries(spec.when).every(([k, v]) => meta[k] === v);

/** Fristhinweis (Verjährung, Antwortfrist …) – rot, wenn überschritten. */
function fallDue(date, done) {
  const d = dueInfo(date, done);
  return d && d.cls !== 'cd-dim' ? `<span class="fall-due ${d.cls}">${icon('clock', 'ico-sm')}${esc(d.text)}</span>` : '';
}

/* ---------------------------------------------------------------- Karten der Einträge */
function fallCard(c, F, s, it) {
  const kind = F.kinds[s.item];
  const spec = Object.fromEntries(kind.fields.map((x) => [x.key, x]));
  const raw = fallShow(spec[kind.title], it[kind.title]);
  const title = kind.title === 'note' && raw.length > 110 ? `${raw.slice(0, 107)}…` : raw;
  // Felder im Kopf (Titel, Kennzeichen) und Sonderdarstellungen stehen nicht noch einmal in den Zeilen
  const used = new Set([kind.title, ...kind.chips]);
  const chips = kind.chips
    .map((k) => {
      const sp = spec[k];
      if (sp.type === 'check') return it[k] === 'offen' ? '' : badge(`${sp.label.replace(/\?$/, '')}: ${FALL_CHECK[it[k]][0]}`, FALL_CHECK[it[k]][1]);
      const o = fallOptionOf(sp, it[k]);
      if (!o) return '';
      return sp.light ? `<span class="fall-light l-${esc(it[k])}" title="${esc(o[1])}"><i></i>${esc(o[1])}</span>` : badge(o[1], o[2] || 'slate');
    })
    .join('');
  // Rechtfertigungsprüfung (Zweck, Geeignetheit, Erforderlichkeit, Angemessenheit): vier Schritte als Leiste
  const stepKeys = kind.fields.filter((x) => x.type === 'tri').map((x) => x.key);
  stepKeys.forEach((k) => used.add(k));
  const steps = stepKeys.length
    ? `<div class="fall-steps" role="list" aria-label="Rechtfertigungsprüfung">${stepKeys.map((k) => `<span class="fall-step st-${esc(it[k])}" role="listitem"><b>${esc(spec[k].label.replace(/\?$/, ''))}</b><i>${esc(FALL_TRI[it[k]][0])}</i></span>`).join('')}</div>`
    : '';
  // Anspruch: Anspruchsteller → Anspruchsgegner und Forderungshöhe im Kopf; Entwurfsversion: Nummer und Datum
  let flow = '';
  let amount = '';
  if (s.item === 'claim') {
    ['claimant', 'opponent', 'amount'].forEach((k) => used.add(k));
    if (it.claimant || it.opponent) flow = `<div class="fall-flow"><span>${esc(it.claimant || '—')}</span>${icon('chevronRight', 'ico-sm')}<span>${esc(it.opponent || '—')}</span></div>`;
    if (it.amount != null) amount = `<span class="fall-amount num">${esc(money(it.amount))}</span>`;
  }
  if (s.item === 'version') used.add('date');
  const no = kind.numbered ? `<span class="fall-no">v${it.no}</span>` : '';
  const date = s.item === 'version' && it.date ? `<span class="fall-date">${esc(fmtDateOnly(it.date))}</span>` : '';
  const done = FALL_DONE_STATES.has(it.status) || FALL_DONE_STATES.has(it.state);
  const lines = kind.fields
    .filter((x) => !used.has(x.key) && !fallEmpty(it[x.key]))
    .map((x) => {
      const v = it[x.key];
      if (x.type === 'textarea') return `<div class="fall-text"><span class="k">${esc(x.label)}</span><p>${esc(v)}</p></div>`;
      if (x.type === 'date' && /frist|verj/i.test(x.label)) return `<div class="fall-line"><span class="k">${esc(x.label)}</span><span>${esc(fmtDateOnly(v))} ${fallDue(v, done)}</span></div>`;
      return `<div class="fall-line"><span class="k">${esc(x.label)}</span><span>${esc(fallShow(x, v))}</span></div>`;
    })
    .join('');
  const actions = c.canEdit
    ? `<div class="fall-actions"><button type="button" class="btn-ghost btn-sm" data-action="fall-edit" data-case-id="${c.id}" data-sec="${esc(s.key)}" data-id="${it.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
        <button type="button" class="icon-btn sm push" data-action="fall-del" data-case-id="${c.id}" data-id="${it.id}" aria-label="${esc(kind.label)} entfernen" title="Entfernen">${icon('trash', 'ico-sm')}</button></div>`
    : '';
  return `<article class="fall-card" id="fi${it.id}">
      <header class="fall-head"><div class="fall-title">${no}<strong>${esc(title || kind.label)}</strong>${date}</div><div class="fall-chips">${amount}${chips}</div></header>
      ${flow}${steps}${lines}${actions}
    </article>`;
}

/* ---------------------------------------------------------------- Abschnitte */
function fallSegment(spec, value, attrs) {
  const map = spec.type === 'check' ? FALL_CHECK : FALL_TRI;
  return `<div class="fall-seg" role="radiogroup" aria-label="${esc(spec.label)}">${spec.options
    .map(([k]) => `<button type="button" class="fall-seg-btn st-${esc(k)}${value === k ? ' on' : ''}" role="radio" aria-checked="${value === k}" ${attrs} data-key="${esc(spec.key)}" data-val="${esc(k)}">${esc(map[k][0])}</button>`)
    .join('')}</div>`;
}

function fallSectionHtml(c, F, s) {
  const edit = c.canEdit;
  const id = fallAnchor(s.key);
  const items = s.item ? F.items[s.item] || [] : [];
  const kind = s.item ? F.kinds[s.item] : null;
  const m = F.meta;
  const metaSpecs = s.meta.filter((x) => fallWhenOk(x, m));
  const filled = metaSpecs.filter((x) => !fallEmpty(m[x.key]) && x.key !== 'mode');
  const attrs = `data-action="fall-set" data-case-id="${c.id}"`;
  const addBtn = edit && kind ? `<button type="button" class="btn-outline btn-sm" data-action="fall-add" data-case-id="${c.id}" data-sec="${esc(s.key)}">${icon('plus', 'ico-sm')}<span>${esc(kind.label)}</span></button>` : '';
  const editableMeta = metaSpecs.filter((x) => x.key !== 'mode');
  const metaBtn = edit && editableMeta.length ? `<button type="button" class="btn-ghost btn-sm" data-action="fall-meta" data-case-id="${c.id}" data-sec="${esc(s.key)}">${icon('edit', 'ico-sm')}<span>${s.item && editableMeta.length === 1 ? esc(editableMeta[0].label.split(/[ /(]/)[0]) : 'Bearbeiten'}</span></button>` : '';
  const buttons = `${metaBtn}${addBtn}`;
  const nothing = !items.length && !filled.length && !s.checks.length && !s.modeSwitch;
  if (nothing) return emptySection(id, s.title, 'noch nichts erfasst', buttons, s.hint);

  const checked = s.checks.filter((x) => m[x.key] === 'ja').length;
  const count = s.checks.length ? `${checked} von ${s.checks.length} erfüllt` : items.length ? `${items.length} erfasst` : '';
  const modeSpec = s.meta.find((x) => x.key === 'mode');
  const mode = s.modeSwitch && modeSpec
    ? `<div class="fall-mode" role="radiogroup" aria-label="Modus">${modeSpec.options
        .map(([k, l, col]) => `<button type="button" class="fall-mode-btn c-${esc(col || 'slate')}${m.mode === k ? ' on' : ''}" role="radio" aria-checked="${m.mode === k}" ${edit ? attrs : 'disabled'} data-key="mode" data-val="${esc(k)}">${esc(l)}</button>`)
        .join('')}</div>`
    : '';
  const checks = s.checks.length
    ? `<ul class="fall-checks">${s.checks
        .map((x) => `<li class="fall-check st-${esc(m[x.key])}"><div class="fall-check-text"><strong>${esc(x.label)}</strong>${x.hint ? `<span>${esc(x.hint)}</span>` : ''}</div>${edit ? fallSegment(x, m[x.key], attrs) : badge(...FALL_CHECK[m[x.key]])}</li>`)
        .join('')}</ul>`
    : '';
  const dl = filled.length
    ? `<dl class="fall-dl">${filled
        .map((x) => `<div class="${x.wide || x.type === 'textarea' ? 'wide' : ''}"><dt>${esc(x.label)}</dt><dd>${x.type === 'textarea' ? `<p>${esc(m[x.key])}</p>` : esc(fallShow(x, m[x.key]))}</dd></div>`)
        .join('')}</dl>`
    : '';
  // Streitwert und Summe der Ansprüche nebeneinander
  const sum = kind && kind.sum ? items.reduce((n, i) => n + (Number(i[kind.sum]) || 0), 0) : 0;
  const worth = metaSpecs.find((x) => x.key === 'streitwert');
  const stat = kind && kind.sum && items.length ? `<div class="fall-sum"><span>${esc(s.sumLabel || 'Summe')}</span><strong class="num">${esc(money(sum))}</strong>${worth && m.streitwert != null && m.streitwert !== sum ? `<em>Streitwert ${esc(money(m.streitwert))}</em>` : ''}</div>` : '';
  const dlNoWorth = worth && stat ? dl.replace(/<div class="[^"]*"><dt>Streitwert[^]*?<\/dd><\/div>/, '') : dl;
  const cards = items.length ? `<div class="fall-list">${items.map((it) => fallCard(c, F, s, it)).join('')}</div>` : kind ? `<p class="text-sm text-dim">${esc(s.hint || 'Noch nichts erfasst.')}</p>` : '';
  return `<div class="section fall-sec" id="${id}"><div class="section-head"><h3 class="section-title">${esc(s.title)} <span class="text-xs text-dim font-normal sec-meta">${esc(count)}</span></h3><div class="section-tools">${buttons}</div></div>
      ${mode}${checks}${dlNoWorth}${stat}${cards}</div>`;
}

/** Alle Abschnitte des Rechtsgebiets: Schlüssel → HTML (leer = gibt es hier nicht). */
function fallParts(c, F) {
  const out = {};
  if (!isStaff() || !F || F.area !== c.area) return out;
  for (const s of F.sections) out[s.key] = fallSectionHtml(c, F, s);
  return out;
}
/** Zähler je Abschnitt für Sprungleiste und Reiter. */
function fallCount(F, s) {
  return s.item ? (F.items[s.item] || []).length : s.checks.length ? s.checks.filter((x) => F.meta[x.key] === 'ja').length : 0;
}

/* ---------------------------------------------------------------- Formulare */
function fallField(spec, value, prefix = 'fl') {
  const id = `${prefix}-${spec.key}`;
  const req = spec.required ? ' required' : '';
  const hint = spec.hint ? `<p class="form-hint">${esc(spec.hint)}</p>` : '';
  const label = `<label class="label" for="${id}">${esc(spec.label)}${spec.required ? ' *' : ''}</label>`;
  const wide = spec.wide || spec.type === 'textarea' ? ' class="span-2"' : '';
  const v = value ?? '';
  let input;
  if (spec.type === 'textarea') input = `<textarea id="${id}" name="${esc(spec.key)}" rows="${spec.rows || 3}" maxlength="${spec.rows >= 4 ? 4000 : 2000}" class="field" placeholder="${esc(spec.placeholder)}"${req}>${esc(v)}</textarea>`;
  else if (spec.type === 'select') input = `<select id="${id}" name="${esc(spec.key)}" class="field">${spec.options.map(([k, l]) => opt(k, l, v === k)).join('')}</select>`;
  else if (spec.type === 'date') input = `<input id="${id}" name="${esc(spec.key)}" type="date" class="field" value="${esc(v)}">`;
  else if (spec.type === 'money') input = `<input id="${id}" name="${esc(spec.key)}" type="number" min="0" max="1000000000000" step="1" inputmode="numeric" class="field" value="${v === null || v === '' ? '' : esc(v)}" placeholder="0">`;
  else if (spec.type === 'tri' || spec.type === 'check') {
    const map = spec.type === 'check' ? FALL_CHECK : FALL_TRI;
    input = `<div class="fall-seg fall-seg-form" role="radiogroup" aria-label="${esc(spec.label)}">${spec.options
      .map(([k]) => `<label class="fall-seg-opt st-${esc(k)}"><input type="radio" name="${esc(spec.key)}" value="${esc(k)}" ${(v || 'offen') === k ? 'checked' : ''}><span>${esc(map[k][0])}</span></label>`)
      .join('')}</div>`;
  } else input = `<input id="${id}" name="${esc(spec.key)}" class="field" maxlength="200" value="${esc(v)}" placeholder="${esc(spec.placeholder)}"${req}>`;
  return `<div${wide}>${spec.type === 'tri' || spec.type === 'check' ? `<span class="label">${esc(spec.label)}</span>` : label}${input}${hint}</div>`;
}

function fallForm({ caseId, title, fields, values, sec, kind, id }) {
  const today = dayKey(new Date());
  return `<h2 class="modal-title">${esc(title)}</h2>
    <form data-form="fall-save" data-case-id="${caseId}" data-sec="${esc(sec)}" ${kind ? `data-kind="${esc(kind)}"` : ''} ${id ? `data-id="${id}"` : ''} class="form-grid cols-2">
      ${fields.map((x) => fallField(x, values[x.key] ?? (x.today && !id ? today : undefined))).join('')}
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${id || !kind ? 'Speichern' : 'Hinzufügen'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}
const fallSecOf = (key) => (st.caseFall ? st.caseFall.sections.find((s) => s.key === key) : null);

Object.assign(actions, {
  'fall-add': (el) => {
    const s = fallSecOf(el.dataset.sec);
    const kind = s && st.caseFall.kinds[s.item];
    if (!kind) return;
    openModal(fallForm({ caseId: Number(el.dataset.caseId), title: `${kind.label} hinzufügen`, fields: kind.fields, values: {}, sec: s.key, kind: s.item }), { wide: true, child: true });
  },
  'fall-edit': (el) => {
    const s = fallSecOf(el.dataset.sec);
    const kind = s && st.caseFall.kinds[s.item];
    const it = kind && (st.caseFall.items[s.item] || []).find((x) => x.id === Number(el.dataset.id));
    if (it) openModal(fallForm({ caseId: Number(el.dataset.caseId), title: `${kind.label} bearbeiten`, fields: kind.fields, values: it, sec: s.key, kind: s.item, id: it.id }), { wide: true, child: true });
  },
  'fall-meta': (el) => {
    const s = fallSecOf(el.dataset.sec);
    if (!s) return;
    const fields = s.meta.filter((x) => x.key !== 'mode' && fallWhenOk(x, st.caseFall.meta));
    openModal(fallForm({ caseId: Number(el.dataset.caseId), title: s.title, fields, values: st.caseFall.meta, sec: s.key }), { wide: true, child: true });
  },
  // Schalter und Prüfpunkte: sofort speichern
  'fall-set': async (el) => {
    const caseId = Number(el.dataset.caseId);
    if (el.getAttribute('aria-checked') === 'true') return;
    await api.put(`/api/cases/${caseId}/fall`, { [el.dataset.key]: el.dataset.val });
    await reloadCase(caseId);
  },
  'fall-del': async (el) => {
    const caseId = Number(el.dataset.caseId);
    await api.del(`/api/cases/${caseId}/fall/items/${el.dataset.id}`);
    toast('Eintrag entfernt.');
    await reloadCase(caseId);
  },
});

Object.assign(forms, {
  'fall-save': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const fd = new FormData(f);
    const s = fallSecOf(f.dataset.sec);
    const specs = f.dataset.kind ? st.caseFall.kinds[f.dataset.kind].fields : (s ? s.meta : []);
    const body = {};
    for (const x of specs) {
      if (!fd.has(x.key) && !f.querySelector(`[name="${x.key}"]`)) continue;
      const raw = val(fd, x.key);
      if (raw === '' && (x.type === 'tri' || x.type === 'check' || x.type === 'select')) continue; // Voreinstellung des Servers
      body[x.key] = x.type === 'money' ? (raw === '' ? null : Math.max(0, Math.round(Number(raw)) || 0)) : raw;
    }
    if (f.dataset.kind) {
      if (f.dataset.id) await api.patch(`/api/cases/${caseId}/fall/items/${f.dataset.id}`, body);
      else await api.post(`/api/cases/${caseId}/fall/items`, { kind: f.dataset.kind, ...body });
      toast(f.dataset.id ? 'Gespeichert.' : 'Hinzugefügt.');
    } else {
      await api.put(`/api/cases/${caseId}/fall`, body);
      toast('Gespeichert.');
    }
    await modalBack();
    await reloadCase(caseId);
  },
});
