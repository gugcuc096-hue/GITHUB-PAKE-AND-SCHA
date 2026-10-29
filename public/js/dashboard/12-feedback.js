/*
 * Kanzlei-Dashboard – 360°-Feedback (Menü Kanzlei → 360°-Feedback, siehe feedback360.js): anonyme Rückmeldungen im Team,
 * Auswertung je Person erst ab drei Rückmeldungen und nach Freigabe durch das Board.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const FB_TONE = { offen: 'amber', geschlossen: 'slate', veroeffentlicht: 'emerald' };

views.feedback = {
  async load() {
    st.feedback = await api.get('/api/feedback');
  },
  render() {
    const f = st.feedback;
    const board = isBoard();
    const running = f.rounds.some((r) => r.status === 'offen');
    return `
      <div class="page-head">
        <div><h1 class="page-title">360°-Feedback</h1><p class="page-sub">Anonyme Rückmeldungen im Team – was läuft gut, was kann besser werden? Ergebnisse je Person gibt es erst ab ${f.minResponses} Rückmeldungen und nach Freigabe durch das Board.</p></div>
        ${board && !running ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="fb-new">${icon('plus')}<span>Neue Runde</span></button></div>` : ''}
      </div>
      ${f.rounds.length ? `<div class="fb-list">${f.rounds.map((r) => feedbackRoundCard(r, board)).join('')}</div>` : `<div class="panel">${empty(board ? 'Noch keine Runde – mit „Neue Runde“ geht es los.' : 'Noch keine Feedback-Runde.', 'users')}</div>`}`;
  },
};

async function refreshFeedback() {
  st.feedback = await api.get('/api/feedback');
  renderView();
}

function feedbackRoundCard(r, board) {
  const pct = r.expected ? Math.round((r.given / r.expected) * 100) : 0;
  const results = r.status === 'veroeffentlicht' || (board && r.status !== 'offen');
  return `<article class="fb-card">
      <header class="fb-head"><div><strong>${esc(r.title)}</strong><span class="fb-sub">${r.participants} Teilnehmende${r.dueDate ? ` · bis ${esc(fmtDateOnly(r.dueDate))}` : ''}</span></div>${badge(r.statusLabel, FB_TONE[r.status] || 'slate')}</header>
      ${r.mine ? `<div class="fb-progress"><div class="fb-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><span class="text-sm text-muted">Ihre Rückmeldungen: <strong>${r.given}</strong> von ${r.expected}</span></div>` : '<p class="text-sm text-dim">Sie nehmen an dieser Runde nicht teil.</p>'}
      <div class="fb-actions">
        ${r.status === 'offen' && r.mine ? `<button type="button" class="btn-gold btn-sm" data-action="fb-give" data-id="${r.id}">${icon('edit', 'ico-sm')}<span>${r.given ? 'Rückmeldungen ergänzen' : 'Rückmeldung geben'}</span></button>` : ''}
        ${results ? `<button type="button" class="btn-outline btn-sm" data-action="fb-results" data-id="${r.id}">${icon('chart', 'ico-sm')}<span>${board ? 'Ergebnisse' : 'Meine Ergebnisse'}</span></button>` : ''}
        ${board ? `<button type="button" class="btn-ghost btn-sm" data-action="fb-progress" data-id="${r.id}">${icon('users', 'ico-sm')}<span>Beteiligung</span></button>` : ''}
        ${board && r.status === 'offen' ? `<button type="button" class="btn-ghost btn-sm" data-action="fb-close" data-id="${r.id}" data-title="${esc(r.title)}">Runde schließen</button>` : ''}
        ${board && r.status === 'geschlossen' ? `<button type="button" class="btn-ghost btn-sm" data-action="fb-publish" data-id="${r.id}" data-title="${esc(r.title)}">Ergebnisse freigeben</button>` : ''}
      </div>
    </article>`;
}

/** 1–5 als Auswahlknöpfe (Radio, per Tastatur bedienbar). */
function fbRating(name, label, value) {
  return `<fieldset class="fb-rate"><legend>${esc(label)}</legend><div class="fb-rate-row">${[1, 2, 3, 4, 5]
    .map((n) => `<label class="fb-dot"><input type="radio" name="${name}" value="${n}" ${Number(value) === n ? 'checked' : ''} aria-label="${esc(label)} ${n} von 5"><span>${n}</span></label>`)
    .join('')}<label class="fb-dot fb-none"><input type="radio" name="${name}" value="" ${value ? '' : 'checked'} aria-label="${esc(label)}: keine Angabe"><span>–</span></label></div></fieldset>`;
}

function feedbackSheetHtml(sheet, openId = null) {
  const done = sheet.colleagues.filter((c) => c.given).length;
  return `<h2 class="modal-title">${esc(sheet.round.title)}</h2>
    <p class="modal-sub">Anonym: Ihre Kolleginnen und Kollegen sehen nie, von wem eine Rückmeldung kommt. ${done} von ${sheet.colleagues.length} abgegeben – Sie müssen nicht alle ausfüllen.</p>
    <div class="fb-people">${sheet.colleagues
      .map(
        (c) => `<details class="fb-person" ${c.id === openId ? 'open' : ''}><summary><span>${esc(c.name)}${c.rank ? ` <span class="text-dim text-xs">· ${esc(c.rank)}</span>` : ''}</span>${c.given ? badge('abgegeben', 'emerald') : ''}</summary>
          <form data-form="fb-save" data-round="${sheet.round.id}" data-about="${c.id}" class="fb-form">
            <div class="fb-rates">${Object.entries(sheet.dimensions).map(([k, l]) => fbRating(k, l, c.ratings && c.ratings[k])).join('')}</div>
            <label class="label" for="fbS${c.id}">Das läuft gut</label><textarea id="fbS${c.id}" name="strengths" rows="3" maxlength="800" class="field" placeholder="Was schätzen Sie an der Zusammenarbeit?">${esc(c.strengths)}</textarea>
            <label class="label mt-2" for="fbI${c.id}">Das kann besser</label><textarea id="fbI${c.id}" name="improve" rows="3" maxlength="800" class="field" placeholder="Was würde helfen? Bitte sachlich und konkret.">${esc(c.improve)}</textarea>
            <div class="form-actions mt-3"><button type="submit" class="btn-gold btn-sm">${icon('check', 'ico-sm')}<span>Speichern</span></button></div>
          </form></details>`
      )
      .join('')}</div>`;
}

function feedbackResultsHtml(res) {
  const bar = (v) => (v == null ? '<span class="text-dim">—</span>' : `<span class="fb-meter" aria-label="${v} von 5"><i style="width:${(v / 5) * 100}%"></i></span><span class="fb-val">${String(v).replace('.', ',')}</span>`);
  const list = (title, items) => (items.length ? `<div class="fb-comments"><div class="k">${esc(title)}</div><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '');
  return `<h2 class="modal-title">${esc(res.round.title)} – Ergebnisse</h2>
    <p class="modal-sub">Je Person zusammengefasst; Kommentare ohne Absender und gemischt. Unter ${res.minResponses} Rückmeldungen werden keine Ergebnisse gezeigt.</p>
    <div class="fb-results">${res.people
      .map(
        (p) => `<section class="fb-result"><header><strong>${esc(p.name)}</strong>${p.rank ? `<span class="text-dim text-xs"> · ${esc(p.rank)}</span>` : ''}<span class="fb-n">${p.n} ${p.n === 1 ? 'Rückmeldung' : 'Rückmeldungen'}</span></header>
          ${p.hidden ? `<p class="text-sm text-dim">Noch zu wenige Rückmeldungen (mindestens ${res.minResponses} nötig), damit niemand erkennbar wird.</p>` : `<div class="fb-avgs">${Object.entries(res.dimensions).map(([k, l]) => `<div class="fb-avg"><span class="fb-avg-l">${esc(l)}</span>${bar(p.averages[k])}</div>`).join('')}</div>${list('Das läuft gut', p.strengths)}${list('Das kann besser', p.improve)}`}</section>`
      )
      .join('')}</div>`;
}

Object.assign(actions, {
  'fb-new': () =>
    openModal(`<h2 class="modal-title">Neue Feedback-Runde</h2><p class="modal-sub">Alle aktiven Kanzlei-Mitglieder nehmen teil und bekommen eine Direktnachricht in Discord (wenn verknüpft).</p>
      <form data-form="fb-start" class="form-grid">
        <div><label class="label" for="fbTitle">Name der Runde</label><input id="fbTitle" name="title" class="field" required minlength="3" maxlength="80" placeholder="z. B. Q4 2026" autofocus></div>
        <div><label class="label" for="fbDue">Abgabe bis (optional)</label><input id="fbDue" name="dueDate" type="date" class="field"></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Runde starten</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div></form>`),
  'fb-give': async (el) => openModal(feedbackSheetHtml(await api.get(`/api/feedback/rounds/${el.dataset.id}/sheet`)), { wide: true }),
  'fb-results': async (el) => openModal(feedbackResultsHtml(await api.get(`/api/feedback/rounds/${el.dataset.id}/results`)), { wide: true }),
  'fb-progress': async (el) => {
    const { progress } = await api.get(`/api/feedback/rounds/${el.dataset.id}/progress`);
    openModal(`<h2 class="modal-title">Beteiligung</h2><p class="modal-sub">Wer wie viele Rückmeldungen abgegeben hat – nicht, was darin steht.</p>
      <div class="list-rows">${progress.map((p) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(p.name)}</div></div><div class="shrink-0"><span class="font-mono ${p.given >= p.expected ? 'text-emerald-300' : 'text-gold'}">${p.given} / ${p.expected}</span></div></div>`).join('')}</div>`);
  },
  'fb-close': async (el) => {
    if (!(await ask(`Die Runde „${el.dataset.title}“ wird geschlossen – danach lässt sich nichts mehr abgeben.`, { title: 'Runde schließen?', confirmText: 'Schließen' }))) return;
    await api.post(`/api/feedback/rounds/${el.dataset.id}/close`, {});
    toast('Runde geschlossen.');
    await refreshFeedback();
  },
  'fb-publish': async (el) => {
    if (!(await ask(`Danach sieht jede Person ihre eigenen Ergebnisse aus „${el.dataset.title}“.`, { title: 'Ergebnisse freigeben?', confirmText: 'Freigeben' }))) return;
    await api.post(`/api/feedback/rounds/${el.dataset.id}/publish`, {});
    toast('Ergebnisse freigegeben.');
    await refreshFeedback();
  },
});

Object.assign(forms, {
  'fb-start': async (f) => {
    const fd = new FormData(f);
    await api.post('/api/feedback/rounds', { title: val(fd, 'title'), dueDate: val(fd, 'dueDate') || null });
    toast('Runde gestartet.');
    await modalBack();
    await refreshFeedback();
  },
  'fb-save': async (f) => {
    const fd = new FormData(f);
    const body = { strengths: val(fd, 'strengths'), improve: val(fd, 'improve') };
    for (const k of ['r_team', 'r_reliable', 'r_know', 'r_comm']) body[k] = val(fd, k) === '' ? null : Number(val(fd, k));
    const sheet = await api.put(`/api/feedback/rounds/${f.dataset.round}/entries/${f.dataset.about}`, body);
    toast('Rückmeldung gespeichert.');
    replaceModal(feedbackSheetHtml(sheet, Number(f.dataset.about)));
  },
});
