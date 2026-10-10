/*
 * Kanzlei-Dashboard – Teil 7 von 12: Team, Benutzer, Honorarordnung, Einstellungen.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Team-Verwaltung */
function memberCard(m, i, total) {
  const account = m.userId
    ? `${badge(m.userActive ? 'Login aktiv' : 'Login gesperrt', m.userActive ? 'emerald' : 'red')}<span class="text-xs text-dim">${esc(m.userEmail || '')} · ${esc(ROLES[m.userRole] || '')}</span>`
    : badge('Kein Login-Konto', 'slate');
  return `<div class="panel member-card">
      <span class="avatar-wrap"><span class="avatar lg ${m.tier === 'leitung' ? '' : 'slate'}">${m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials)}</span>${m.duty ? `<span class="presence s-${esc(m.duty)}"></span>` : ''}</span>
      <div class="body">
        <div class="flex flex-wrap items-center gap-2"><h3 class="font-serif text-xl font-semibold">${esc(m.name)}</h3>${m.visible ? '' : badge('Auf Website ausgeblendet', 'amber')}</div>
        <div class="text-xs uppercase tracking-widest text-gold mt-0.5">${esc(m.roleTitle)} · ${m.tier === 'leitung' ? 'Board of Partners' : 'Associate Attorneys'}</div>
        ${m.description ? `<p class="text-sm text-muted mt-2">${esc(m.description)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-3">${account}</div>
      </div>
      <div class="actions">
        <button class="icon-btn sm" data-action="team-move" data-id="${m.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${icon('chevronUp', 'ico-sm')}</button>
        <button class="icon-btn sm" data-action="team-move" data-id="${m.id}" data-dir="1" ${i === total - 1 ? 'disabled' : ''} aria-label="Nach unten">${icon('chevronDown', 'ico-sm')}</button>
        <button class="btn-outline btn-sm" data-action="team-edit" data-id="${m.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
        <button class="icon-btn sm" data-action="team-delete" data-id="${m.id}" aria-label="Entfernen">${icon('trash', 'ico-sm')}</button>
      </div></div>`;
}

function teamPhotoControls(m) {
  return `<div class="flex flex-wrap gap-2">
        <label class="btn-outline btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Foto hochladen</span><input type="file" accept="image/*" data-upload="team" data-id="${m.id}" aria-label="Foto hochladen"></label>
        ${m.hasOwnPhoto ? `<button type="button" class="btn-ghost btn-sm" data-action="team-photo-remove" data-id="${m.id}">Foto entfernen</button>` : ''}
      </div>
      <p class="form-hint">${m.hasOwnPhoto ? 'Eigenes Foto für die Website.' : 'Ohne eigenes Foto wird das Profilbild des verknüpften Kontos verwendet.'}</p>`;
}

function memberModal(m) {
  const isNew = !m;
  const v = m || { tier: 'anwalt', visible: true };
  const linkable = st.users.filter((u) => u.role !== 'mandant' && !st.team.some((t) => t.userId === u.id));
  const accountBlock =
    m && m.userId
      ? `<p class="text-sm mb-3">Verknüpft mit <strong>${esc(m.userEmail)}</strong> (${esc(ROLES[m.userRole] || '')}). Name und Rang werden automatisch ins Konto übernommen.</p>
           <label class="check"><input type="checkbox" name="unlink"> Verknüpfung lösen (das Login-Konto selbst bleibt bestehen)</label>`
      : `<div class="seg mb-3">
             <label class="seg-opt"><input type="radio" name="accountMode" value="none" checked><span>Kein Konto</span></label>
             ${linkable.length ? '<label class="seg-opt"><input type="radio" name="accountMode" value="link"><span>Bestehendes verknüpfen</span></label>' : ''}
             <label class="seg-opt"><input type="radio" name="accountMode" value="create"><span>Neues Login-Konto</span></label>
           </div>
           <div data-account-pane="link" class="hidden"><select name="userId" class="field"><option value="">Konto wählen …</option>${linkable.map((u) => opt(u.id, `${u.displayName} (${u.email})`)).join('')}</select></div>
           <div data-account-pane="create" class="hidden">
             <div class="form-grid cols-2">
               <div><label class="label">E-Mail (Login)</label>${emailField('accountEmail', { value: m ? emailLocalFromName(m.name) : '' })}</div>
               <div><label class="label">Rolle</label><select name="accountRole" class="field">${opt('anwalt', 'Anwalt')}${opt('admin', 'Board of Partners (Admin)')}</select></div>
             </div>
             <p class="form-hint">Es wird ein Einmal-Passwort erzeugt und nach dem Speichern angezeigt.</p>
           </div>`;
  openModal(`
      <h2 class="modal-title">${isNew ? 'Teammitglied hinzufügen' : 'Teammitglied bearbeiten'}</h2>
      <p class="modal-sub">Änderungen erscheinen sofort im Bereich „Unser Team“ auf der Website.</p>
      <form data-form="team" data-id="${m ? m.id : ''}" class="form-grid cols-2">
        ${m
        ? `<div class="span-2 flex flex-wrap items-center gap-4">
              <span id="tmPhoto" class="avatar xl ${m.tier === 'leitung' ? '' : 'slate'}">${m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials)}</span>
              <div id="tmPhotoCtl">${teamPhotoControls(m)}</div>
            </div>`
        : '<p class="span-2 form-hint">Ein Foto für die Website können Sie direkt nach dem Anlegen hinzufügen.</p>'}
        <div class="span-2"><label class="label" for="tmName">Name</label><input id="tmName" name="name" class="field" required minlength="2" maxlength="80" value="${esc(v.name || '')}" placeholder="z. B. Dr. jur. Damat Lex" autofocus></div>
        <div><label class="label" for="tmRank">Rang</label>${rankSelect('roleTitle', v.roleTitle || '', { id: 'tmRank', required: true, emptyLabel: 'Rang wählen …' })}</div>
        <div><label class="label" for="tmTier">Ebene auf der Website</label><select id="tmTier" name="tier" class="field">${opt('leitung', 'Board of Partners (gold)', v.tier === 'leitung')}${opt('anwalt', 'Associate Attorneys', v.tier !== 'leitung')}</select></div>
        <div class="span-2"><label class="label" for="tmDesc">Kurzbeschreibung</label><textarea id="tmDesc" name="description" class="field" rows="3" maxlength="400" placeholder="Schwerpunkte, Zuständigkeiten …">${esc(v.description || '')}</textarea></div>
        <div><label class="label" for="tmInit">Initialen</label><input id="tmInit" name="initials" class="field" maxlength="5" value="${esc(v.initials || '')}" placeholder="automatisch"></div>
        <div class="flex items-end pb-2"><label class="check"><input type="checkbox" name="visible" ${v.visible ? 'checked' : ''}> Auf der Website anzeigen</label></div>
        <fieldset class="span-2 rounded-2xl p-4" style="border:1px solid var(--glass-border);background:rgba(15,23,42,.35)">
          <legend class="label px-1 mb-0">Login-Konto fürs Dashboard</legend>${accountBlock}
        </fieldset>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${isNew ? 'Hinzufügen' : 'Speichern'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`);
}

views.team = {
  async load() {
    const [t, u] = await Promise.all([api.get('/api/admin/team'), api.get('/api/admin/users')]);
    st.team = t.team;
    st.users = u.users;
  },
  render() {
    return `
        <div class="page-head">
          <div><h1 class="page-title">Team-Verwaltung</h1><p class="page-sub">Teammitglieder hinzufügen, umbenennen, Ränge ändern oder entfernen – live auf der Website.</p></div>
          <div class="page-actions"><a href="/#team" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Website ansehen</span></a><button class="btn-gold btn-md" data-action="team-new">${icon('plus')}<span>Mitglied hinzufügen</span></button></div>
        </div>
        ${st.team.length ? `<div class="stack">${st.team.map((m, i) => memberCard(m, i, st.team.length)).join('')}</div>` : `<div class="panel">${empty('Noch keine Teammitglieder.', 'users')}</div>`}`;
  },
};

/* ---------------------------------------------------------------- Benutzer */
function userTable() {
  const q = st.userQuery.trim().toLowerCase();
  const f = st.userFilter;
  const rows = st.users.filter(
    (u) =>
      (f === 'alle' || (f === 'team' ? u.role !== 'mandant' : f === 'mandanten' ? u.role === 'mandant' : !u.active)) &&
      (!q || `${u.displayName} ${u.email} ${u.rank || ''}`.toLowerCase().includes(q))
  );
  if (!rows.length) return empty('Keine Benutzer gefunden.', 'users');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Name</th><th>Rolle</th><th>Rang</th><th>Discord</th><th>Letzter Login</th><th></th></tr></thead>
      <tbody>${rows
      .map((u) => {
        const self = u.id === st.user.id;
        return `<tr>
            <td class="td-main"><div class="flex items-center gap-3">${avatarWrap(u.avatarUrl, u.displayName, u.duty, 'sm')}<div class="min-w-0">
              <div class="font-medium flex flex-wrap items-center gap-2">${esc(u.displayName)}${self ? badge('Sie', 'gold') : ''}${!u.active ? badge('Gesperrt', 'red') : ''}${u.mustChangePassword ? badge('Einmal-Passwort', 'amber') : ''}${u.dutyLabel ? badge(u.dutyLabel, 'emerald') : ''}</div>
              <div class="text-xs text-dim break-all">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div>${u.oldEmail ? `<div class="text-xs text-dim break-all" title="Funktioniert beim Login weiterhin">vorher: ${esc(u.oldEmail)}</div>` : ''}</div></div></td>
            <td data-label="Rolle"><select class="field" style="min-width:150px" data-user-field="role" data-id="${u.id}" ${self ? 'disabled' : ''} aria-label="Rolle">${Object.entries(ROLES).map(([k, l]) => opt(k, l, u.role === k)).join('')}</select></td>
            <td data-label="Rang">${rankSelect('rank', u.rank || '', { emptyLabel: '—', attrs: `style="min-width:170px" data-user-field="rank" data-id="${u.id}" aria-label="Rang"` })}</td>
            <td data-label="Discord" class="text-sm">${u.discordUsername ? esc(u.discordUsername) : '<span class="text-dim">—</span>'}</td>
            <td data-label="Letzter Login" class="text-xs text-dim nowrap">${esc(fmtDate(u.lastLoginAt))}</td>
            <td class="td-actions">${
            self
              ? ''
              : `<button class="btn-outline btn-sm" data-action="user-reset" data-id="${u.id}" title="Einmal-Passwort erzeugen">${icon('key', 'ico-sm')}<span>Passwort</span></button>
                   <button class="btn-ghost btn-sm" data-action="user-toggle" data-id="${u.id}">${u.active ? 'Sperren' : 'Entsperren'}</button>
                   <button class="icon-btn sm" data-action="user-delete" data-id="${u.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>`
          }</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}

views.users = {
  async load() {
    st.users = (await api.get('/api/admin/users')).users;
  },
  render() {
    const count = (f) => st.users.filter((u) => f === 'alle' || (f === 'team' ? u.role !== 'mandant' : f === 'mandanten' ? u.role === 'mandant' : !u.active)).length;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Benutzer & Zugänge</h1><p class="page-sub">Rollen vergeben, Konten sperren und vergessene Passwörter per Klick zurücksetzen – ganz ohne Shell.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="user-new">${icon('plus')}<span>Konto anlegen</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="userSearch" class="field" type="search" placeholder="Name oder E-Mail …" value="${esc(st.userQuery)}" aria-label="Benutzer suchen"></label>
          <div class="chip-row">${[['alle', 'Alle'], ['team', 'Team'], ['mandanten', 'Mandanten'], ['gesperrt', 'Gesperrt']]
          .map(([k, l]) => `<button class="chip ${st.userFilter === k ? 'active' : ''}" data-action="user-filter" data-value="${k}">${l} <span class="chip-count">${count(k)}</span></button>`)
          .join('')}</div>
        </div>
        <div id="userList" class="panel p-2 md:p-3">${userTable()}</div>`;
  },
};

async function updateUserField(t) {
  const id = Number(t.dataset.id);
  const field = t.dataset.userField;
  const value = field === 'rank' ? t.value.trim() || null : t.value;
  if (field === 'role' && !(await ask(`Die Rolle wird auf „${ROLES[value]}“ geändert. Das Konto wird dabei abgemeldet.`, { title: 'Rolle ändern?', confirmText: 'Rolle ändern' }))) {
    $('#userList').innerHTML = userTable();
    return;
  }
  try {
    await api.patch('/api/admin/users/' + id, { [field]: value });
    toast('Gespeichert.');
  } finally {
    await views.users.load();
    if (st.view === 'users') $('#userList').innerHTML = userTable();
  }
}

/* ---------------------------------------------------------------- Honorarordnung */
function feeModal(f, category) {
  const v = f || { category: category || 'rechtsberatung', inCalculator: true, active: true, price: 0 };
  openModal(`
      <h2 class="modal-title">${f ? 'Leistung bearbeiten' : 'Neue Leistung'}</h2>
      <p class="modal-sub">Erscheint sofort in der Honorarordnung, im Tarifrechner der Website und im Rechnungs-Generator.</p>
      <form data-form="fee" data-id="${f ? f.id : ''}" class="form-grid cols-2">
        <div class="span-2"><label class="label">Bezeichnung</label><input name="name" class="field" required minlength="2" maxlength="120" value="${esc(v.name || '')}" autofocus></div>
        <div><label class="label">Kategorie</label><select name="category" class="field">${Object.entries(FEE_CATEGORIES).map(([k, l]) => opt(k, l, v.category === k)).join('')}</select></div>
        <div><label class="label">Preis ($)</label><input name="price" type="number" inputmode="numeric" min="0" step="1" required class="field" value="${esc(v.price)}"></div>
        <div class="span-2"><label class="label">Beschreibung</label><textarea name="description" rows="3" maxlength="400" class="field">${esc(v.description || '')}</textarea></div>
        <div><label class="label">Reihenfolge</label><input name="sortOrder" type="number" min="0" step="1" class="field" value="${esc(v.sortOrder ?? '')}" placeholder="automatisch"></div>
        <div class="flex flex-col justify-end gap-2 pb-1">
          <label class="check"><input type="checkbox" name="inCalculator" ${v.inCalculator ? 'checked' : ''}> Im Tarifrechner anbieten</label>
          <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Auf der Website anzeigen</label>
        </div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}
views.fees = {
  async load() {
    st.adminFees = (await api.get('/api/admin/fees')).fees;
  },
  render() {
    return `
        <div class="page-head">
          <div><h1 class="page-title">Honorarordnung</h1><p class="page-sub">Preise und Leistungen pflegen – die Website und der Tarifrechner übernehmen Änderungen sofort.</p></div>
          <div class="page-actions"><a href="/#honorar" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Website ansehen</span></a><button class="btn-gold btn-md" data-action="fee-new">${icon('plus')}<span>Leistung hinzufügen</span></button></div>
        </div>
        ${Object.entries(FEE_CATEGORIES)
        .map(([cat, label]) => {
          const rows = st.adminFees.filter((f) => f.category === cat);
          return `<section class="panel panel-pad mb-4">
              <div class="panel-head"><h2 class="panel-title">${esc(label)}</h2><button class="btn-ghost btn-sm" data-action="fee-new" data-category="${cat}">${icon('plus', 'ico-sm')}<span>Leistung</span></button></div>
              ${rows.length
              ? rows
                  .map(
                    (f) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(f.name)} ${!f.active ? badge('Ausgeblendet', 'slate') : ''} ${f.inCalculator ? badge('Tarifrechner', 'sky') : ''}</div><div class="meta">${esc(f.description)}</div></div>
                      <div class="flex items-center gap-2 shrink-0"><span class="font-mono text-gold nowrap">${money(f.price)}</span>
                      <button class="icon-btn sm" data-action="fee-edit" data-id="${f.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button>
                      <button class="icon-btn sm" data-action="fee-delete" data-id="${f.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></div>`
                  )
                  .join('')
              : '<p class="text-sm text-dim py-2">Keine Leistungen in dieser Kategorie.</p>'}
            </section>`;
        })
        .join('')}`;
  },
};

/* ---------------------------------------------------------------- Einstellungen */
/* ---------------------------------------------------------------- FiveNet: Verbindungsstatus & Schnittstellenprüfung */
const INTERFACE_STATUS = {
  unavailable: ['Nicht vorhanden', 'slate'],
  blocked: ['Nur mit Passwort-Sitzung', 'red'],
  unsuitable: ['Ungeeignet', 'amber'],
  respected: ['Berücksichtigt', 'emerald'],
  used: ['Genutzt', 'emerald'],
};
function fivenetInterfaces() {
  const list = st.fivenet?.interfaces || [];
  return `<div class="if-list">${list
    .map((i) => `<div class="if-row"><div class="flex items-center justify-between gap-2 flex-wrap"><strong class="text-sm">${esc(i.label)}</strong>${statusBadge(INTERFACE_STATUS, i.status)}</div><p class="text-xs text-dim mt-1">${esc(i.note)}</p></div>`)
    .join('')}</div>`;
}
function fivenetProfilePanel() {
  const fn = st.fivenet;
  if (!fn) return '';
  const cap = fn.capabilities;
  const row = (k, v, ok) => `<div class="fn-status-row"><span class="k">${esc(k)}</span><span class="v ${ok ? 'text-emerald-300' : 'text-dim'}">${v}</span></div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('link')} FiveNet-Verbindung</h2>${badge('Referenz-Modus', 'gold')}</div>
      <div class="fn-status">
        ${row('Instanz', `<a class="link-btn" href="${esc(fn.instance.url)}" target="_blank" rel="noopener noreferrer">${esc(fn.instance.host)} ↗</a>`, true)}
        ${row('Account', cap.accountLink ? 'Verbunden ✓' : 'Nicht verbindbar – FiveNet bietet keine Freigabe für externe Anwendungen', cap.accountLink)}
        ${row('Aktiver Charakter', cap.characterSelect ? 'Abrufbar' : 'Nicht abrufbar – FiveNet gibt ihn nur in der eigenen Oberfläche preis', cap.characterSelect)}
        ${row('Dokumentabruf', cap.documentFetch ? 'Automatisch' : 'Nicht automatisch – Text & Bilder per Kopieren/Einfügen übernehmen', cap.documentFetch)}
        ${fn.lastViewedAs ? row('Zuletzt angegeben', `„${esc(fn.lastViewedAs)}“ <span class="text-xs">(eigene Angabe)</span>`, false) : ''}
      </div>
      <div class="banner banner-amber mt-4 mb-0">${icon('shield')}<div><strong>Niemals das FiveNet-Passwort eingeben.</strong> Die Kanzlei-Plattform fragt nie danach. Eine Verbindung über Passwort oder Sitzungs-Cookies wäre unsicher und ist bewusst nicht vorgesehen.</div></div>
      <ol class="text-sm text-muted list-decimal pl-5 mt-4 space-y-1">
        <li>In FiveNet den Charakter wählen, der das Dokument sehen darf.</li>
        <li>Dokument öffnen und die Adresse aus der Adresszeile kopieren.</li>
        <li>In der Akte „FiveNet-Dokument hinzufügen“ – die Dokument-ID wird automatisch erkannt.</li>
        <li>Optional: den Dokumentinhalt in FiveNet markieren, Strg+C, im Feld „Inhalt aus FiveNet“ Strg+V – Text wird zur Abschrift, Bilder werden als Anhang übernommen.</li>
      </ol>
      <details class="edit-box mt-4"><summary>Ergebnis der Schnittstellenprüfung</summary>${fivenetInterfaces()}</details>
    </section>`;
}
/** Google Docs: Kanzlei-Konto verbinden – Rechnungen, Verträge, Schriftsätze und Aktenauszüge als Google Doc. */
function googleDocsPanel(g) {
  if (!g) return '';
  const status = g.connected ? (g.error ? badge('Verbindung getrennt', 'amber') : badge('Verbunden', 'emerald')) : g.configured ? badge('Nicht verbunden', 'slate') : badge('Nicht eingerichtet', 'slate');
  const counts = g.counts || {};
  const total = (counts.invoice || 0) + (counts.contract || 0) + (counts.extract || 0);
  let body;
  if (!g.configured) {
    body = `<ol class="text-sm text-muted list-decimal pl-5 mt-3 space-y-1">
        <li>console.cloud.google.com → Projekt anlegen → „Google Drive API“ aktivieren</li>
        <li>Google Auth Platform: Zielgruppe „Extern“, App <strong>veröffentlichen</strong> („In Produktion“), Datenzugriff <code class="font-mono text-xs">…/auth/drive.file</code></li>
        <li>Client erstellen (Webanwendung), Weiterleitungs-URI: <code class="font-mono text-gold text-xs break-all">${esc(g.redirectUri || location.origin + '/api/google/callback')}</code></li>
        <li>In Render unter „Environment“: <code class="font-mono text-xs">GOOGLE_CLIENT_ID</code>, <code class="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> – danach neu deployen. Ausführlich im README unter „Google Docs“.</li></ol>`;
  } else if (!g.connected) {
    body = `<p class="text-sm text-muted mt-3">Mit dem <strong>gemeinsamen Google-Konto der Kanzlei</strong> anmelden. Die Website erhält nur Zugriff auf Dateien, die sie selbst anlegt – nicht auf den übrigen Inhalt des Google Drive.</p>
        <div class="form-actions mt-3"><a href="/api/google/connect" class="btn-gold btn-md">${icon('link', 'ico-sm')}<span>Kanzlei-Google-Konto verbinden</span></a></div>
        <p class="form-hint mt-2">Weiterleitungs-URI in Google: <code class="font-mono text-xs break-all">${esc(g.redirectUri || '')}</code></p>`;
  } else {
    body = `${g.error ? `<div class="banner banner-amber mt-3 mb-0">${icon('alert')}<div>${esc(g.error)}<div class="mt-2"><a href="/api/google/connect" class="btn-gold btn-sm">Neu verbinden</a></div></div></div>` : ''}
        <p class="text-sm mt-3">Verbunden mit <strong>${esc(g.account || 'Google-Konto')}</strong>${g.connectedAt ? ` · seit ${esc(fmtDate(g.connectedAt))}` : ''}${g.connectedBy ? ` · von ${esc(g.connectedBy)}` : ''}</p>
        <p class="text-sm text-muted mt-1">${total ? `${counts.invoice || 0} Rechnungen · ${counts.contract || 0} Verträge/Schriftsätze · ${counts.extract || 0} Aktenauszüge im Ordner „Pake &amp; Scha – Dokumente“` : 'Noch keine Google Docs angelegt.'}${g.pending ? ` · <span class="text-amber-300">${g.pending} warten auf Aktualisierung</span>` : ''}</p>
        <div class="form-actions mt-3">
          <button type="button" class="btn-outline btn-md" data-action="google-resync" ${total ? '' : 'disabled'}>${icon('restore', 'ico-sm')}<span>Alle Google Docs neu schreiben</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="google-disconnect">${icon('x', 'ico-sm')}<span>Trennen</span></button>
        </div>`;
  }
  return `<section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('doc')} Google Docs</h2>${status}</div>
      <p class="text-sm text-muted">Rechnungen, Verträge, Schriftsätze und Aktenauszüge lassen sich in der Druckansicht mit „Als Google Doc“ ausgeben – im Layout der Druckansicht, im Google Drive der Kanzlei und für <strong>jeden mit dem Link lesbar</strong>. Unterschriften, Zahlungen und Änderungen übernimmt der Server automatisch; der Link bleibt gleich. Die Druckansicht bleibt wie bisher.</p>
      ${body}
    </section>`;
}

function fivenetSettingsPanel(s) {
  const fn = st.fivenet;
  const inst = s.fivenetInstance;
  return `<section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('link')} FiveNet</h2>${badge(inst.host, 'gold')}</div>
      <p class="text-sm text-muted mb-4">Akten können FiveNet-Dokumente als geprüfte Referenz enthalten (Link, Dokument-ID, Angaben des Anwalts). ${fn ? `Derzeit <strong>${fn.stats.links}</strong> Verknüpfung${fn.stats.links === 1 ? '' : 'en'} mit <strong>${fn.stats.documents}</strong> Dokument${fn.stats.documents === 1 ? '' : 'en'}.` : ''}</p>
      <div class="grid-2">
        <form data-form="settings-fivenet" class="form-grid top">
          <div><label class="label">Adresse der FiveNet-Instanz</label><input name="fivenetUrl" class="field font-mono text-sm" maxlength="200" value="${esc(s.fivenetUrl)}" placeholder="${esc(s.fivenetEnvUrl || s.fivenetDefaultUrl)}" autocomplete="off">
            <p class="form-hint">Leer lassen = ${s.fivenetEnvUrl ? 'Umgebungsvariable FIVENET_URL' : 'Standard'} (${esc(s.fivenetEnvUrl || s.fivenetDefaultUrl)}). Nur Links dieser Instanz werden in Akten angenommen; bestehende Verknüpfungen behalten ihre Adresse.</p></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
            <button type="button" class="btn-outline btn-md" data-action="fn-check">${icon('globe', 'ico-sm')}<span>Erreichbarkeit prüfen</span></button></div>
          <div id="fnCheckResult" class="text-sm" aria-live="polite"></div>
        </form>
        <div><div class="label">Ergebnis der Schnittstellenprüfung (FiveNet v2026.9)</div>${fivenetInterfaces()}</div>
      </div>
    </section>`;
}

/** Ping-Pause in Tickets: dieselbe Person höchstens alle N Minuten erwähnen (0 = immer, -1 = nie). */
const PING_COOLDOWNS = [
  [60, 'Wenige – je Person höchstens einmal pro Stunde (empfohlen)'],
  [180, 'Sehr wenige – je Person höchstens alle 3 Stunden'],
  [1440, 'Minimal – je Person höchstens einmal am Tag'],
  [30, 'Etwas mehr – je Person höchstens alle 30 Minuten'],
  [0, 'Bei jeder Nachricht, die die Person betrifft'],
  [-1, 'Keine – nur beim Eröffnen des Tickets'],
];

/* ---------------------------------------------------------------- Einstellungen: Vertragsvorlagen */
const TPL_HELP = [
  ['# Titel', 'großer Dokumenttitel'],
  ['## II. Abschnitt', 'goldene Abschnittsüberschrift'],
  ['### § 1 Überschrift', 'fette Paragraphenüberschrift'],
  ['1. Text', 'nummerierter Absatz'],
  ['| Text', 'zentrierte Zeile (Parteien)'],
  ['    Text', 'eingerückte Zeile (4 Leerzeichen)'],
  ['**fett**  *kursiv*', 'Hervorhebung'],
  ['===', 'neue Seite'],
  ['[Unterschriften]', 'Unterschriftsfeld Anwälte und Mandant (sonst am Ende)'],
  ['[Unterschrift Anwalt]', 'nur der Anwalt unterschreibt (Schriftsätze: Standard)'],
  ['[Unterschrift Mandant]', 'nur der Mandant unterschreibt (z. B. Vollmacht)'],
  ['{{begruendung}}', 'allein in einer Zeile: Absatz entfällt, wenn leer'],
  ['[Weitere Anwälte]', 'weitere unterzeichnende Anwälte bei den Parteien (entfällt, wenn es keine gibt)'],
];

function contractTemplatesPanel() {
  const t = st.contractTemplates;
  if (!t) return '';
  const rows = t.templates.length
    ? t.templates
        .map(
          (x) => `<div class="contract-row">
              <div class="contract-main"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(x.name)}</span>${badge(x.kind === 'schriftsatz' ? 'Schriftsatz' : 'Vertrag', x.kind === 'schriftsatz' ? 'sky' : 'gold')}${x.active ? badge('aktiv', 'emerald') : badge('inaktiv', 'slate')}${x.isDefault ? badge('mitgeliefert', 'slate') : ''}</div>
                <div class="text-xs text-dim mt-1">Zuletzt geändert ${esc(fmtDate(x.updatedAt))}${x.updatedByName ? ' von ' + esc(x.updatedByName) : ''} · ${x.body.length.toLocaleString('de-DE')} Zeichen</div></div>
              <div class="contract-actions">
                <button type="button" class="btn-outline btn-sm" data-action="tpl-edit" data-id="${x.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
                <a class="btn-ghost btn-sm" href="/vertrag.html?vorlage=${x.id}&beispiel=1" target="_blank" rel="noopener">${icon('external', 'ico-sm')}<span>Vorschau</span></a>
                ${x.isDefault ? `<button type="button" class="btn-ghost btn-sm" data-action="tpl-reset" data-id="${x.id}">Original wiederherstellen</button>` : ''}
                <button type="button" class="btn-ghost btn-sm fn-danger" data-action="tpl-delete" data-id="${x.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
              </div></div>`
        )
        .join('')
    : '<p class="text-sm text-dim">Keine Vorlagen vorhanden.</p>';
  return `<section class="panel panel-pad mt-4 lg:mt-5" id="secTemplates">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('doc')} Vertragsvorlagen</h2>
        <button type="button" class="btn-outline btn-sm" data-action="tpl-new">${icon('plus', 'ico-sm')}<span>Neue Vorlage</span></button></div>
      <p class="text-sm text-muted mb-4">Grundlage für „Mandatsvertrag erstellen“ (Art „Vertrag“) und „Schriftsatz erstellen“ (Art „Schriftsatz“, z. B. Vollmacht, Antrag auf Akteneinsicht, Haftbeschwerde) in der Akte. Änderungen gelten für neue Dokumente – bereits erstellte behalten ihren Text.</p>
      <div class="stack">${rows}</div>
      <form data-form="contract-header" class="form-grid cols-2 mt-5">
        <div><label class="label">Kopfzeile rechts (jede Vertragsseite)</label><textarea name="header" rows="2" maxlength="300" class="field">${esc(t.header)}</textarea></div>
        <div class="form-actions items-end"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Kopfzeile speichern</span></button></div>
      </form>
    </section>`;
}

function templateForm(x) {
  const t = st.contractTemplates;
  const fields = { ...t.fields, ...t.autoFields };
  return `
      <h2 id="modalTitle" class="modal-title">${x ? 'Vorlage bearbeiten' : 'Neue Vertragsvorlage'}</h2>
      <p class="modal-sub">Platzhalter anklicken, um sie an der Cursorposition einzufügen.</p>
      <form data-form="tpl-save" ${x ? `data-id="${x.id}"` : ''} class="form-grid cols-2">
        <div><label class="label" for="tplName">Name</label><input id="tplName" name="name" class="field" required minlength="2" maxlength="80" value="${esc(x ? x.name : '')}" placeholder="z. B. Vollmacht"></div>
        <label class="check self-end"><input type="checkbox" name="active" ${!x || x.active ? 'checked' : ''}> Aktiv (in Akten auswählbar)</label>
        <div><label class="label" for="tplKind">Art</label><select id="tplKind" name="kind" class="field">${opt('vertrag', 'Vertrag – „Mandatsvertrag erstellen“', !x || x.kind !== 'schriftsatz')}${opt('schriftsatz', 'Schriftsatz – „Schriftsatz erstellen“', !!x && x.kind === 'schriftsatz')}</select></div>
        <div class="span-2"><div class="label">Platzhalter</div><div class="tpl-chips">${Object.entries(fields)
        .map(([k, label]) => `<button type="button" class="tpl-chip" data-action="tpl-insert" data-text="{{${k}}}" title="${esc(label)}">{{${esc(k)}}}</button>`)
        .join('')}</div></div>
        <div class="span-2"><label class="label" for="tplBody">Text der Vorlage</label><textarea id="tplBody" name="body" rows="20" maxlength="30000" class="field tpl-body" spellcheck="true" required>${esc(x ? x.body : '# Titel\n\n| -zwischen-\n| **{{anwalt}}**\n| - und -\n| **{{mandant}}**\n===\n## Bedingungen\n\n### § 1 …\nText …\n===\n[Unterschriften]\n')}</textarea></div>
        <details class="span-2 edit-box"><summary>Formatierung</summary>
          <div class="tpl-help">${TPL_HELP.map(([code, what]) => `<code>${esc(code)}</code><span>${esc(what)}</span>`).join('')}</div>
          <p class="form-hint">Leere Platzhalter erscheinen im Vertrag als Linie zum handschriftlichen Ausfüllen.</p></details>
        <div class="span-2 form-actions">
          <button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button>
        </div>
      </form>`;
}

/** Prüfbericht Discord-Login: was der laufende Server in Render findet (nur Namen, keine Werte). */
function discordOAuthCheck(d) {
  if (!d) return '';
  const TEXT = {
    DISCORD_CLIENT_ID: { missing: 'fehlt – in Render unter „Environment“ anlegen', empty: 'ist leer', invalid: 'sollte nur aus Ziffern bestehen – bitte die „Client ID“ kopieren, nicht Name oder Secret' },
    DISCORD_CLIENT_SECRET: { missing: 'fehlt – in Render unter „Environment“ anlegen', empty: 'ist leer', invalid: 'wirkt unvollständig – im Developer Portal „Reset Secret“ und neu kopieren' },
    PUBLIC_URL: { missing: 'fehlt (optional) – empfohlen: ' + location.origin, empty: 'ist leer (optional)', invalid: 'muss mit https:// beginnen, z. B. ' + location.origin },
  };
  const rows = d.vars
    .map((v) => {
      const ok = v.status === 'ok';
      const optional = v.name === 'PUBLIC_URL';
      const cls = ok ? 'text-emerald-300' : optional ? 'text-amber-300' : 'text-red-300';
      const msg = ok ? 'gefunden' : TEXT[v.name][v.status];
      return `<div class="oauth-row"><code class="font-mono text-xs">${esc(v.name)}</code><span class="${cls} text-xs">${ok ? '✓' : optional ? '!' : '✕'} ${esc(msg)}${v.nameFixed ? ' · Name enthält Leerzeichen/Kleinbuchstaben – wird erkannt, bitte in Render korrigieren' : ''}</span></div>`;
    })
    .join('');
  const started = parseDate(d.serverStartedAt);
  return `<div class="oauth-check mt-4">
      <div class="label">Prüfung: Was der Server gerade sieht</div>
      ${rows}
      ${d.similarNames.length ? `<p class="form-hint text-amber-300">Ähnliche Namen gefunden: ${d.similarNames.map((n) => `<code class="font-mono">${esc(n)}</code>`).join(', ')} – vermutlich vertippt.</p>` : ''}
      <p class="form-hint">Server gestartet: ${esc(started ? started.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—')}${d.commit ? ` · Version ${esc(d.commit)}` : ''}. Wurden die Variablen in Render danach geändert, ist ein Neustart nötig: „Manual Deploy“ → „Deploy latest commit“.</p>
      <p class="form-hint">Redirect in Discord (OAuth2 → Redirects): <code class="font-mono text-gold break-all">${esc(d.redirectUri || location.origin + '/api/discord/callback')}</code></p>
    </div>`;
}

views.settings = {
  async load() {
    const q = new URLSearchParams(location.search).get('tab');
    if (SETTINGS_TABS.some(([k]) => k === q)) st.settingsTab = q;
    const modul = new URLSearchParams(location.search).get('modul');
    if (BOT_MODULES.some(([k]) => k === modul)) st.botModule = modul;
    if (modul) history.replaceState(history.state, '', `${location.pathname}?tab=${st.settingsTab || 'general'}#settings`);
    const [r, tpl, tk, bot, backups] = await Promise.all([
      api.get('/api/admin/settings'),
      api.get('/api/contract-templates?all=1'),
      api.get('/api/tickets/settings'),
      api.get('/api/bot').catch(() => null),
      api.get('/api/admin/backups').catch(() => null),
      load.fivenet(true),
    ]);
    st.google = await api.get('/api/google/status').catch(() => null);
    st.backups = backups;
    st.settings = r.settings;
    st.contractTemplates = tpl;
    st.ticketSettings = tk;
    st.bot = bot;
    if (st.settingsTab === 'bot' && bot && !st.botDiscord) await loadBotDiscord();
    if (st.settingsTab === 'bot' && bot) await loadBotMessages().catch(() => {});
  },
  render() {
    const s = st.settings;
    const tab = SETTINGS_TABS.some(([k]) => k === st.settingsTab) ? st.settingsTab : 'general';
    const head = `<div class="page-head"><div><h1 class="page-title">Einstellungen</h1><p class="page-sub">Kanzlei &amp; Rechnungen, Discord, Integrationen, System und Vertragsvorlagen.</p></div></div>
        <div class="chip-row settings-tabs" role="tablist" aria-label="Bereiche der Einstellungen">${SETTINGS_TABS.map(
          ([k, label, ic]) => `<button type="button" class="chip ${tab === k ? 'active' : ''}" role="tab" aria-selected="${tab === k}" data-action="settings-tab" data-tab="${k}">${ic === 'discord' ? DISCORD_ICON : icon(ic, 'ico-sm')}<span>${esc(label)}</span></button>`
        ).join('')}</div>`;
    if (tab === 'bot') return head + botSettings();
    if (tab === 'contracts') return head + contractTemplatesPanel();
    if (tab === 'integrations') return `${head}${fivenetSettingsPanel(s)}${googleDocsPanel(st.google)}`;
    if (tab === 'system') return `${head}${backupPanel()}<div class="mt-4 lg:mt-5">${emergencyPanel()}</div>`;
    return `${head}
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Rechnungsdaten der Kanzlei</h2></div>
          <form data-form="settings-firm" class="form-grid cols-2">
            <div><label class="label">Anschrift (Briefkopf)</label><textarea name="firmAddress" rows="3" maxlength="300" class="field">${esc(s.firmAddress)}</textarea></div>
            <div><label class="label">Zahlungshinweis</label><textarea name="firmPaymentInfo" rows="3" maxlength="300" class="field">${esc(s.firmPaymentInfo)}</textarea></div>
            <div><label class="label">Kontakt</label><input name="firmContact" maxlength="120" class="field" value="${esc(s.firmContact)}"></div>
            <div><label class="label">Zahlungserinnerung (Tage nach Fälligkeit)</label><input type="number" name="invoiceReminderDays" min="0" max="60" step="1" class="field" value="${esc(s.invoiceReminderDays)}">
              <p class="form-hint">Offene Rechnungen erinnern den Mandanten so viele Tage nach dem Fälligkeitsdatum einmal automatisch – per Discord-DM und im Ticket der Akte. 0 = aus. Von Hand geht es jederzeit mit „Erinnern“ an der Rechnung.</p></div>
            <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
          </form>
        </section>
        <div class="mt-4 lg:mt-5">${websitePanel(s)}</div>`;
  },
};

/* Einstellungen in Reitern – „bot“ ist der Discord-Reiter (Webhook, Login, Tickets und Bot-Module; alte Links ?tab=bot gelten weiter) */
const SETTINGS_TABS = [
  ['general', 'Kanzlei & Rechnungen', 'receipt'],
  ['bot', 'Discord', 'discord'],
  ['integrations', 'Integrationen', 'link'],
  ['system', 'System', 'shield'],
  ['contracts', 'Vertragsvorlagen', 'doc'],
];

/** Discord → Webhook: Kanzlei-Updates in Kanäle, je Ereignis Kanal und Rolle. */
function discordWebhookPanel(s) {
  return `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Discord-Webhook</h2>${s.discordWebhookActive ? badge('Aktiv', 'emerald') : badge('Nicht verbunden', 'slate')}</div>
        <p class="text-sm text-muted mb-4">Wichtige Kanzlei-Updates (neue Mandate, Fristen, Terminanfragen …) automatisch nach Discord senden – auf Wunsch je Ereignis in einen eigenen Kanal. In Discord: Kanal → Einstellungen → Integrationen → Webhooks → „Neuer Webhook“ → URL kopieren.</p>
        <form data-form="settings-discord" class="form-grid">
          <div><label class="label">Webhook-URL (Standard-Kanal)</label><input name="webhook" class="field font-mono text-xs" value="${esc(s.discordWebhookUrl)}" placeholder="https://discord.com/api/webhooks/…" autocomplete="off">
            ${s.discordWebhookFromEnv ? '<p class="form-hint">Aktuell wird die URL aus der Umgebungsvariable DISCORD_WEBHOOK_URL verwendet.</p>' : ''}</div>
          <div><label class="label" for="pingRole">Standard-Rolle zum Pingen (Rollen-ID)</label><input id="pingRole" name="pingRole" class="field font-mono text-xs" value="${esc(s.discordPingRole)}" placeholder="z. B. 1546979799820537986" inputmode="numeric" autocomplete="off">
            <p class="form-hint">Wird bei allen Ereignissen mit Haken bei „Rolle pingen“ erwähnt, sofern dort keine eigene Rolle steht. Rollen-ID: Discord → Einstellungen → Erweitert → Entwicklermodus an, dann Servereinstellungen → Rollen → Rechtsklick auf die Rolle → „Rollen-ID kopieren“.</p></div>
          <div class="banner banner-amber mb-0">${icon('alert')}<div><strong>Wichtig, damit der Ping ankommt:</strong> In Discord unter Servereinstellungen → Rollen → Rolle wählen → „<em>Erlaube jedem, @mention für diese Rolle zu verwenden</em>“ einschalten. Sonst kommt die Nachricht an, aber niemand wird gepingt. @everyone/@here werden nie gepingt.</div></div>
          <div>
            <div class="label">Ereignisse – Kanal und Rolle</div>
            <p class="form-hint mb-2">Leer = Standard-Kanal bzw. Standard-Rolle. Für einen weiteren Kanal in Discord dort einen eigenen Webhook anlegen und die URL beim Ereignis eintragen.</p>
            <div class="ev-list">${Object.entries(s.availableEvents)
            .map(
              ([k, l]) => `<div class="ev-item">
                  <div class="ev-top"><span class="ev-name">${esc(l)}</span>
                    <label class="check"><input type="checkbox" name="events" value="${esc(k)}" ${s.discordEvents.includes(k) ? 'checked' : ''}> Nachricht</label>
                    <label class="check"><input type="checkbox" name="pingEvents" value="${esc(k)}" ${s.discordPingEvents.includes(k) ? 'checked' : ''}> Rolle pingen</label></div>
                  <div class="ev-fields">
                    <input name="eventWebhook" data-event="${esc(k)}" class="field font-mono text-xs" value="${esc((s.discordEventWebhooks || {})[k] || '')}" placeholder="Kanal: Standard" autocomplete="off" aria-label="Webhook-URL (Kanal) für: ${esc(l)}">
                    <input name="eventRole" data-event="${esc(k)}" class="field font-mono text-xs" value="${esc((s.discordEventRoles || {})[k] || '')}" placeholder="Rolle: Standard" inputmode="numeric" autocomplete="off" aria-label="Rollen-ID für: ${esc(l)}">
                  </div>
                </div>`
            )
            .join('')}</div>
          </div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
            <button type="button" class="btn-outline btn-md" data-action="discord-test" ${s.discordWebhookActive ? '' : 'disabled'}>${icon('send', 'ico-sm')}<span>Testnachricht</span></button></div>
        </form>
      </section>`;
}

/** Discord → Discord-Login: Einrichtung und Prüfung der Umgebungsvariablen. */
function discordLoginPanel(s) {
  return `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title">Discord-Login</h2>${s.discordOAuthConfigured ? badge('Eingerichtet', 'emerald') : badge('Nicht eingerichtet', 'slate')}</div>
        <p class="text-sm text-muted">Teammitglieder und Mandanten können ihr Discord-Konto im Profil verknüpfen und sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Fristen und Zuweisungen im Kanal erwähnt.</p>
        ${s.discordOAuthConfigured ? '' : `<ol class="text-sm text-muted list-decimal pl-5 mt-3 space-y-1">
          <li>discord.com/developers/applications → „New Application“</li>
          <li>OAuth2 → Redirect hinzufügen: <code class="font-mono text-gold text-xs break-all">${esc((s.discordOAuth && s.discordOAuth.redirectUri) || location.origin + '/api/discord/callback')}</code></li>
          <li>In Render unter „Environment“ setzen: <code class="font-mono text-xs">DISCORD_CLIENT_ID</code>, <code class="font-mono text-xs">DISCORD_CLIENT_SECRET</code>, <code class="font-mono text-xs">PUBLIC_URL</code> – danach „Manual Deploy“ → „Deploy latest commit“.</li></ol>`}
        ${discordOAuthCheck(s.discordOAuth)}
      </section>`;
}

/** Kanzlei & Rechnungen → Website (Dienststatus öffentlich). */
function websitePanel(s) {
  return `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title">Website</h2></div>
        <form data-form="settings-website" class="form-grid">
          <label class="check"><input type="checkbox" name="showDutyPublic" ${s.showDutyPublic ? 'checked' : ''}> Dienststatus öffentlich anzeigen – „Eilnotdienst: 2 Anwälte im Dienst“ in der Kopfzeile und grüne Punkte bei den Teamkarten</label>
          <div class="form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button><a href="/karriere.html" target="_blank" rel="noopener" class="btn-ghost btn-md">${icon('globe', 'ico-sm')}<span>Karriereseite</span></a></div>
        </form>
      </section>`;
}

/** System → Notfall-Zugang. */
function emergencyPanel() {
  return `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title">Notfall-Zugang</h2></div>
        <p class="text-sm text-muted">Passwort vergessen und kein Admin mehr erreichbar? In Render unter „Environment“ die Variable <code class="font-mono text-gold text-xs">ADMIN_RESET_PASSWORD</code> (mind. 10 Zeichen) setzen und neu deployen. Das Konto des Board of Partners erhält dieses Passwort. Danach die Variable wieder entfernen.</p>
        <p class="text-sm text-muted mt-2">Gibt es gar keinen aktiven Admin mehr, stellt der Server das Konto von Dr. Alois Pake beim Start automatisch wieder her (Passwort im Render-Log bzw. aus <code class="font-mono text-xs">ADMIN_PASSWORD</code>).</p>
      </section>`;
}

/** Einstellungen → System: tägliche Datensicherung, „Jetzt sichern“, Herunterladen. */
const fmtBytes = (n) =>
  n == null
    ? '–'
    : n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
      : n >= 1024 * 1024
        ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
        : `${Math.max(1, Math.round(n / 1024))} KB`;
function backupPanel() {
  const b = st.backups;
  if (!b) return '';
  const last = b.backups[0];
  const pending = b.pendingRestore;
  return `<section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('shield')} Datensicherung</h2>${last ? badge(`zuletzt ${fmtDate(last.createdAt)}`, 'emerald') : badge('noch keine Sicherung', 'amber')}</div>
      <p class="text-sm text-muted">Jeden Tag wird automatisch eine Kopie der Datenbank angelegt – Akten, Konten, Verträge, Rechnungen, Nachrichten und Einstellungen (ohne Login-Sitzungen). Aufbewahrt werden die letzten ${b.keepDays} Tage, danach eine Sicherung je Woche bis ${Math.round(b.keepWeeklyDays / 7)} Wochen zurück. Laden Sie regelmäßig eine Sicherung herunter, damit es auch eine Kopie außerhalb von Render gibt. Bilder (Profilbilder, Team-Fotos, Beweismittel) gibt es unten als eigenes Archiv.</p>
      <p class="form-hint mt-2">Datenbank ${fmtBytes(b.dbSize)} · freier Speicher auf der Disk ${fmtBytes(b.free)}</p>
      ${
      pending
        ? `<div class="banner banner-amber is-stack mt-3 mb-0"><strong>Eine Datenbank-Sicherung ist zum Einspielen vorgemerkt</strong> (${esc(fmtBytes(pending.size))}, ${esc(fmtDate(pending.stagedAt))}). Sie ersetzt die aktuelle Datenbank beim nächsten Neustart des Dienstes – auf Render: Dienst öffnen → <em>Manual Deploy</em> → <em>Restart service</em>. Die aktuelle Datenbank bleibt als Kopie erhalten; danach müssen sich alle neu anmelden.
              <div class="mt-2"><button type="button" class="btn-ghost btn-sm" data-action="backup-cancel-restore">${icon('x', 'ico-sm')}<span>Vormerkung aufheben</span></button></div></div>`
        : ''
    }
      <div class="form-actions mt-3"><button type="button" class="btn-outline btn-md" data-action="backup-now">${icon('shield', 'ico-sm')}<span>Jetzt sichern</span></button></div>
      <div class="mt-3">${b.backups.length
      ? b.backups
          .map(
            (x) => `<div class="list-row wrap flex-col sm:flex-row"><div class="main"><div class="title font-mono text-sm">${esc(x.name)}</div><div class="meta">${esc(fmtDate(x.createdAt))} · ${esc(fmtBytes(x.size))}</div></div>
                <div class="flex flex-wrap gap-2 shrink-0"><a class="btn-ghost btn-sm" href="/api/admin/backups/${encodeURIComponent(x.name)}" download>${icon('download', 'ico-sm')}<span>Herunterladen</span></a>
                <button type="button" class="btn-ghost btn-sm" data-action="backup-restore" data-name="${esc(x.name)}">${icon('restore', 'ico-sm')}<span>Einspielen</span></button></div></div>`
          )
          .join('')
      : '<p class="text-sm text-dim">Die erste Sicherung entsteht automatisch kurz nach dem Start des Servers.</p>'}</div>
      <h3 class="section-title mt-6">Bilder &amp; Anhänge</h3>
      <p class="text-sm text-muted">${b.media.files} ${b.media.files === 1 ? 'Bild' : 'Bilder'} (Profilbilder, Team-Fotos, Beweismittel der Akten) · ${esc(fmtBytes(b.media.bytes))}. Das Archiv enthält alle Bilder mit ihren Ordnern; laden Sie es zusammen mit einer Datenbank-Sicherung herunter.</p>
      <div class="form-actions mt-3"><a class="btn-outline btn-md" href="/api/admin/backups/media" download>${icon('download', 'ico-sm')}<span>Bilder herunterladen (.tar.gz)</span></a></div>
      <h3 class="section-title mt-6">Sicherung einspielen</h3>
      <p class="text-sm text-muted">Eine heruntergeladene Sicherung wieder hochladen – z. B. nach einem Umzug oder wenn die Disk verloren ging: <strong>Bilder-Archiv (.tar.gz)</strong> wird sofort ergänzt (vorhandene Bilder bleiben unverändert). Eine <strong>Datenbank-Sicherung (.db)</strong> – hochgeladen oder oben per „Einspielen“ – wird beim nächsten Neustart eingespielt und ersetzt dann die aktuelle Datenbank.</p>
      <div class="form-actions mt-3"><label class="btn-outline btn-md file-btn">${icon('restore', 'ico-sm')}<span>Sicherung hochladen …</span><input type="file" accept=".db,.gz,.tgz,application/gzip,application/x-sqlite3" data-upload="backup" aria-label="Sicherung hochladen"></label></div>
    </section>`;
}
