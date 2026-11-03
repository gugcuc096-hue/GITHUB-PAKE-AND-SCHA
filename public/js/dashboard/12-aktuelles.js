'use strict';
/*
 * Einstellungen → Website → Aktuelles: Meldungen für die Website (/aktuelles, die neuesten drei auf der Startseite).
 * Das Board schreibt Meldungen (Titel, Text, angeheftet, sichtbar); dazu kommen automatische Meldungen aus dem
 * Personalprotokoll (neu im Team, Beförderung) und den offenen Stellen – abschaltbar unter Einstellungen → Startseite.
 */
async function loadNews() {
  st.news = await api.get('/api/site/news').catch(() => null);
  return st.news;
}

function newsPanel() {
  const d = st.news;
  if (!d) {
    loadNews().then(() => st.settingsTab === 'aktuelles' && renderView());
    return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  }
  const edit = st.newsEdit ? d.news.find((n) => n.id === st.newsEdit) : null;
  const row = (n) => `<li class="news-row${n.visible ? '' : ' is-hidden'}">
      <div class="min-w-0"><div class="news-row-title">${n.pinned ? `${icon('pin', 'ico-xs')} ` : ''}${esc(n.title)}${n.visible ? '' : ' <span class="badge badge-slate">verborgen</span>'}</div>
        <div class="text-xs text-dim">${esc(fmtDay(n.at))}${n.author ? ` · ${esc(n.author)}` : ''}</div></div>
      <div class="flex gap-1 shrink-0"><button type="button" class="icon-btn" data-action="news-edit" data-id="${n.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button>
        <button type="button" class="icon-btn" data-action="news-delete" data-id="${n.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></li>`;
  const auto = d.auto.length
    ? `<ul class="news-list">${d.auto.map((n) => `<li class="news-row is-auto"><div class="min-w-0"><div class="news-row-title">${esc(n.title)}</div><div class="text-xs text-dim">${esc(fmtDay(n.at))} · automatisch</div></div></li>`).join('')}</ul>`
    : '<p class="text-sm text-dim">Gerade keine automatischen Meldungen.</p>';
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">${edit ? 'Meldung bearbeiten' : 'Neue Meldung'}</h2>${edit ? '<button type="button" class="btn-ghost btn-sm" data-action="news-new">Neue Meldung</button>' : ''}</div>
      <p class="text-sm text-muted mb-4">Erscheint auf der Website unter <a class="link-btn" href="/aktuelles" target="_blank" rel="noopener">Aktuelles</a>; die neuesten drei auch auf der Startseite. Angeheftete Meldungen stehen immer oben.</p>
      <form data-form="news-save" class="form-grid">
        <input type="hidden" name="id" value="${edit ? edit.id : ''}">
        <div><label class="label" for="newsTitle">Titel</label><input id="newsTitle" name="title" class="field" required minlength="3" maxlength="120" value="${esc(edit ? edit.title : '')}" placeholder="z. B. Neue Sprechzeiten ab Montag"></div>
        <div><label class="label" for="newsBody">Text</label><textarea id="newsBody" name="body" rows="5" maxlength="4000" class="field">${esc(edit ? edit.body : '')}</textarea></div>
        <div class="flex flex-wrap gap-4"><label class="check"><input type="checkbox" name="pinned" ${edit && edit.pinned ? 'checked' : ''}> Oben anheften</label>
          <label class="check"><input type="checkbox" name="visible" ${!edit || edit.visible ? 'checked' : ''}> Auf der Website zeigen</label></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${edit ? 'Speichern' : 'Veröffentlichen'}</span></button></div>
      </form>
    </section>
    <section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title">Meldungen des Boards</h2></div>
      ${d.news.length ? `<ul class="news-list">${d.news.map(row).join('')}</ul>` : '<p class="text-sm text-dim">Noch keine Meldungen.</p>'}
    </section>
    <section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title">Automatisch</h2></div>
      <p class="text-sm text-muted mb-3">Aus dem Personalprotokoll (Einstellungen und Beförderungen der letzten 120 Tage) und den offenen Stellen. Ein- und ausschalten unter Einstellungen → Startseite.</p>
      ${auto}
    </section>`;
}

Object.assign(actions, {
  'news-edit': (el) => {
    st.newsEdit = Number(el.dataset.id);
    renderView();
    setTimeout(() => document.getElementById('newsTitle')?.focus(), 30);
  },
  'news-new': () => {
    st.newsEdit = null;
    renderView();
  },
  'news-delete': async (el) => {
    const n = st.news && st.news.news.find((x) => x.id === Number(el.dataset.id));
    if (!n || !(await window.PS.confirm(`„${n.title}“ wird von der Website entfernt.`, { title: 'Meldung löschen?', confirmText: 'Löschen' }))) return;
    const r = await api.del(`/api/site/news/${n.id}`);
    st.news.news = r.news;
    if (st.newsEdit === n.id) st.newsEdit = null;
    toast('Meldung gelöscht.');
    renderView();
  },
});

Object.assign(forms, {
  'news-save': async (form) => {
    const f = new FormData(form);
    const body = { title: String(f.get('title') || '').trim(), body: String(f.get('body') || '').trim(), pinned: f.get('pinned') === 'on', visible: f.get('visible') === 'on' };
    const id = Number(f.get('id')) || 0;
    const r = id ? await api.put(`/api/site/news/${id}`, body) : await api.post('/api/site/news', body);
    st.news.news = r.news;
    st.newsEdit = null;
    toast(id ? 'Meldung gespeichert.' : 'Meldung veröffentlicht.');
    renderView();
  },
});
