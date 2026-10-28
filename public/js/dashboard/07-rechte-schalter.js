/*
 * Kanzlei-Dashboard – Einstellungen: Rechte & Schalter (Inhaber, Web-Admins, Rechte-Tabelle, Feature-Schalter, Änderungsprotokoll).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html).
 */
'use strict';

/* ================================================================
   Einstellungen → Rechte & Schalter
   Inhaber und Web-Admins, Rechte-Tabelle, Feature-Schalter, Änderungsprotokoll
   ================================================================ */

async function loadAccess() {
  st.access = await api.get('/api/access');
  st.accessLog = can('config.audit') ? (await api.get('/api/access/log')).log : [];
}

const logValue = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? esc(v.text || JSON.stringify(v)) : esc(String(v)));

function accessPanels() {
  const a = st.access;
  if (!a) return `<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>`;
  return `${webAdminPanel(a)}<div class="mt-4 lg:mt-5">${permMatrixPanel(a)}</div><div class="mt-4 lg:mt-5">${featuresPanel(a)}</div>${can('config.audit') ? `<div class="mt-4 lg:mt-5">${changeLogPanel()}</div>` : ''}`;
}

function webAdminPanel(a) {
  const admins = a.staff.filter((p) => p.webAdmin || p.owner);
  const candidates = a.staff.filter((p) => !p.webAdmin && !p.owner);
  const row = (p) => `<div class="ev-item">
      <div class="ev-top"><span class="ev-name">${esc(p.displayName)}</span>${p.owner ? badge('Inhaber', 'gold') : badge('Web-Admin', 'blue')}
        ${a.owner && !p.owner ? `<button type="button" class="btn-ghost btn-sm" data-action="webadmin-remove" data-id="${p.id}" data-name="${esc(p.displayName)}">Entziehen</button>` : ''}</div>
      <p class="text-xs text-dim mt-1">${esc(p.rank || (p.role === 'admin' ? 'Board of Partners' : 'Anwalt'))}${p.discord ? ` · Discord: ${esc(p.discord)}` : ' · kein Discord verknüpft'}</p>
    </div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Inhaber &amp; Web-Admins</h2>${a.owner ? badge('Sie sind Inhaber', 'gold') : a.mine.includes('site.edit') ? badge('Sie sind Web-Admin', 'blue') : ''}</div>
      <p class="text-sm text-muted mb-4">Der <strong>Inhaber</strong> bestimmt, wer die Kanzlei-Seite pflegen darf: Website, Vorlagen, Honorarordnung, Einstellungen, Discord. <strong>Web-Admins</strong> ernennt und entzieht nur der Inhaber – hier oder in Discord mit <code>/webadmin</code>. Das Board of Partners behält Beschlüsse, Personal, Statistik und die eigenen Akten.</p>
      <div class="ev-list">${admins.map(row).join('')}</div>
      ${
        a.owner
          ? `<form data-form="webadmin-add" class="flex gap-2 mt-4 flex-wrap"><select name="userId" class="field field-sm" aria-label="Wer wird Web-Admin?" required><option value="">— Person wählen —</option>${candidates.map((p) => opt(p.id, `${p.displayName}${p.rank ? ` (${p.rank})` : ''}`)).join('')}</select>
              <button type="submit" class="btn-outline btn-sm">${icon('plus', 'ico-sm')}<span>Zum Web-Admin ernennen</span></button></form>
            <div class="form-actions mt-4">
              <button type="button" class="btn-ghost btn-md" data-action="webadmin-discord">${DISCORD_ICON}<span>${a.discordRole.id ? 'Discord-Rolle „Web Admin“ abgleichen' : 'Discord-Rolle „Web Admin“ anlegen'}</span></button></div>
            <p class="form-hint">${a.discordRole.id ? 'Die Rolle „Web Admin“ folgt automatisch dem Dashboard – wer hier ernannt oder entzogen wird, bekommt oder verliert sie in Discord.' : 'Legt die Rolle „Web Admin“ im Discord-Server an und gibt sie allen Web-Admins mit verknüpftem Discord (der Bot braucht dafür „Rollen verwalten“).'}</p>`
          : ''
      }
    </section>`;
}

function permMatrixPanel(a) {
  const edit = a.owner;
  const cell = (g, p) => {
    const on = a.matrix[g.key].includes(p.key);
    return `<td class="perm-cell">${edit ? `<input type="checkbox" name="${g.key}" value="${p.key}" ${on ? 'checked' : ''} aria-label="${esc(g.label)}: ${esc(p.label)}">` : on ? icon('check', 'ico-sm') : '<span class="text-dim">–</span>'}</td>`;
  };
  const table = `<div class="perm-wrap"><table class="perm-table">
      <thead><tr><th scope="col">Bereich</th><th scope="col">Inhaber</th>${a.groups.map((g) => `<th scope="col">${esc(g.label)}</th>`).join('')}</tr></thead>
      <tbody>${a.perms
        .map(
          (p) => `<tr><th scope="row"><span class="perm-name">${esc(p.label)}</span><span class="perm-hint">${esc(p.hint)}</span></th><td class="perm-cell">${icon('check', 'ico-sm')}</td>${a.groups.map((g) => cell(g, p)).join('')}</tr>`
        )
        .join('')}</tbody></table></div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Rechte-Tabelle</h2></div>
      <p class="text-sm text-muted mb-4">Wer darf was ändern? Der Inhaber hat immer alles. Ab Werk darf nur der Web-Admin die Konfiguration ändern – wollen Sie dem Board of Partners oder den Anwälten etwas freigeben, setzen Sie hier den Haken.</p>
      ${edit ? `<form data-form="perm-matrix">${table}<div class="form-actions mt-4"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Rechte speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="perm-defaults">Werkseinstellung</button></div></form>` : `${table}<p class="form-hint mt-2">Nur der Inhaber ändert die Rechte-Tabelle.</p>`}
    </section>`;
}

function featuresPanel(a) {
  const edit = a.mine.includes('settings.edit');
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Funktionen ein- und ausschalten</h2></div>
      <p class="text-sm text-muted mb-4">Ausgeschaltete Funktionen verschwinden von Website und Dashboard; vorhandene Daten bleiben erhalten.</p>
      <form data-form="features" class="form-grid">
        ${a.features.list.map((f) => `<label class="check"><input type="checkbox" name="${f.key}" ${a.features.values[f.key] ? 'checked' : ''} ${edit ? '' : 'disabled'}> <strong>${esc(f.label)}</strong> – ${esc(f.hint)}</label>`).join('')}
        ${edit ? `<div class="form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button></div>` : ''}
      </form>
    </section>`;
}

function changeLogPanel() {
  const list = st.accessLog || [];
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Änderungsprotokoll</h2>${list.length ? badge(`${list.length} Einträge`, 'slate') : ''}</div>
      <p class="text-sm text-muted mb-4">Wer hat wann welche Einstellung geändert – mit „Zurücksetzen“ auf den vorherigen Wert.</p>
      ${
        list.length
          ? `<div class="ev-list">${list
              .map(
                (e) => `<div class="ev-item">
                <div class="ev-top"><span class="ev-name">${esc(e.label)}</span>
                  ${e.revertedAt ? badge('zurückgesetzt', 'slate') : e.revertible && can(e.perm || 'config.audit') ? `<button type="button" class="btn-ghost btn-sm" data-action="log-revert" data-id="${e.id}">Zurücksetzen</button>` : ''}</div>
                <p class="text-xs text-dim mt-1">${esc(e.user)} · ${esc(fmtDate(e.at))}${e.before !== null || e.after !== null ? ` · ${logValue(e.before)} → ${logValue(e.after)}` : ''}</p>
              </div>`
              )
              .join('')}</div>`
          : empty('Noch keine Änderungen aufgezeichnet.', 'list')
      }
    </section>`;
}

Object.assign(actions, {
  'webadmin-remove': async (el) => {
    if (!(await ask(`${el.dataset.name} verliert die Rechte zur Konfiguration und die Discord-Rolle „Web Admin“.`, { title: 'Web-Admin entziehen?', confirmText: 'Entziehen', danger: true }))) return;
    await api.del(`/api/access/web-admins/${el.dataset.id}`);
    await loadAccess();
    toast('Web-Admin entzogen.');
    renderView();
  },
  'webadmin-discord': async () => {
    const r = await api.post('/api/access/discord-role', {});
    await loadAccess();
    toast(r.created ? 'Die Rolle „Web Admin“ wurde in Discord angelegt.' : 'Die Rolle „Web Admin“ wird abgeglichen.');
    renderView();
  },
  'perm-defaults': async () => {
    const a = st.access;
    for (const g of a.groups) for (const p of a.perms) {
      const box = $(`form[data-form="perm-matrix"] input[name="${g.key}"][value="${p.key}"]`);
      if (box) box.checked = a.defaults[g.key].includes(p.key);
    }
    toast('Werkseinstellung eingetragen – bitte noch speichern.', 'info');
  },
  'log-revert': async (el) => {
    await api.post(`/api/access/log/${el.dataset.id}/revert`, {});
    await Promise.all([loadAccess(), api.get('/api/admin/settings').then((r) => (st.settings = r.settings), () => {})]);
    toast('Auf den vorherigen Wert zurückgesetzt.');
    renderView();
  },
});

Object.assign(forms, {
  'webadmin-add': async (f) => {
    const userId = Number(new FormData(f).get('userId'));
    if (!userId) return;
    await api.post('/api/access/web-admins', { userId });
    await loadAccess();
    toast('Zum Web-Admin ernannt.');
    renderView();
  },
  'perm-matrix': async (f) => {
    const fd = new FormData(f);
    const body = {};
    for (const g of st.access.groups) body[g.key] = fd.getAll(g.key);
    await api.put('/api/access/matrix', body);
    await loadAccess();
    toast('Rechte gespeichert.');
    renderView();
  },
  features: async (f) => {
    const fd = new FormData(f);
    const body = {};
    for (const x of st.access.features.list) body[x.key] = fd.has(x.key);
    const r = await api.put('/api/access/features', body);
    st.access.features.values = r.values;
    st.features = r.values;
    await loadAccess();
    toast('Schalter gespeichert.');
    renderView();
  },
});
