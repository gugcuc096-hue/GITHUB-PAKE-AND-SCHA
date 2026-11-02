/*
 * Kanzlei-Dashboard – Einstellungen → Dauerbetrieb (Render Free): Server wach halten, jede Änderung im Google Drive,
 * Wiederherstellung nach jedem Neustart. Live-Anzeige (alle 5 s, solange die Seite offen ist), Einrichtungs-Checkliste,
 * Wiederherstellungs-Schlüssel für Render, Probelauf, Obergrenze im Drive, Auswahl bei einem fremden Stand.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const dauerAgo = (iso) => {
  if (!iso) return '–';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return fmtDate(iso);
};
const dauerMb = (n) => (n == null ? '–' : typeof fmtBytes === 'function' ? fmtBytes(n) : `${Math.round(n / 1048576)} MB`);

async function loadDauer() {
  st.dauer = await api.get('/api/dauer').catch(() => null);
  return st.dauer;
}

/** Solange „Dauerbetrieb“ offen ist: alle 5 s auffrischen (nur die Zahlen, ohne die Seite neu aufzubauen). */
let dauerTimer = 0;
function dauerWatch() {
  clearInterval(dauerTimer);
  dauerTimer = setInterval(async () => {
    const box = document.getElementById('dauerLive');
    if (!box || st.view !== 'settings' || st.settingsTab !== 'dauer' || document.hidden) {
      if (!box) clearInterval(dauerTimer);
      return;
    }
    if (!(await loadDauer())) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = dauerLiveHtml(st.dauer);
    box.replaceWith(fresh.firstElementChild);
  }, 5000);
}

function dauerChecks(d) {
  const lv = d.live || {};
  const wake = d.wake || {};
  const extAt = wake.external && wake.external.at;
  const extFresh = extAt && Date.now() - new Date(extAt).getTime() < 10 * 60 * 1000;
  const probe = lv.probe;
  return [
    { ok: d.enabled, title: 'Dauerbetrieb ist an', text: d.enabled ? esc(d.mode.why) : `Aus (${esc(d.mode.why)}). Auf Render Free schaltet er sich von selbst ein; sonst in Render <code>DAUERBETRIEB=1</code> setzen.` },
    { ok: !!(d.google && d.google.connected), title: 'Google-Konto verbunden', text: d.google && d.google.connected ? `Konto ${esc(d.google.account || '')}` : 'Einstellungen → Integrationen → Google Docs → „Mit Google verbinden“. Ohne Google wird nichts gesichert.', action: d.google && d.google.connected ? '' : `<button type="button" class="btn-outline btn-sm" data-action="settings-tab" data-tab="integrations">${icon('link', 'ico-sm')}<span>Zu Google</span></button>` },
    { ok: !!lv.running, title: 'Live-Sicherung läuft', text: lv.running ? `Jede Änderung geht sofort nach der Aktion ins Drive (Gesamtstand ${lv.gen}, seitdem ${lv.seq} ${lv.seq === 1 ? 'Paket' : 'Pakete'}).` : lv.stats && lv.stats.lastError ? `Fehler: ${esc(lv.stats.lastError)}` : 'Startet, sobald Google verbunden ist.' },
    {
      ok: !!(d.recovery && d.recovery.ok),
      title: 'Wiederherstellungs-Schlüssel in Render',
      text: !d.recovery || !d.recovery.set
        ? '<strong>Fehlt noch – ohne ihn ist nach einem Neustart alles weg.</strong> Schlüssel anzeigen, in Render unter <em>Environment</em> als <code>DAUERBETRIEB_SCHLUESSEL</code> eintragen, speichern.'
        : !d.recovery.valid
          ? `Ungültig: ${esc(d.recovery.error || '')}`
          : !d.recovery.tokenOk
            ? 'Veraltet – Google wurde neu verbunden. Bitte den neuen Schlüssel in Render eintragen.'
            : !d.recovery.keyOk
              ? 'Passt nicht zum Datenschlüssel dieser Datenbank. Bitte den aktuellen Schlüssel eintragen.'
              : 'Eingetragen und gültig.',
      action: `<button type="button" class="btn-outline btn-sm" data-action="dauer-key">${icon('key', 'ico-sm')}<span>Schlüssel anzeigen</span></button>`,
    },
    {
      ok: !!extFresh,
      title: 'Externer Wecker ruft an',
      text: extAt ? `Zuletzt ${esc(dauerAgo(extAt))} (${esc(wake.external.src)}).` : 'Noch kein Aufruf. cron-job.org einrichten (Anleitung unten) – weckt den Server auch nach einem Neustart.',
    },
    {
      ok: !!(probe && probe.ok),
      title: 'Probelauf bestanden',
      text: probe ? (probe.ok ? `${esc(fmtDate(probe.at))}: ${probe.rows} Zeilen in ${probe.tables} Tabellen aus dem Drive nachgebaut – identisch (${probe.ms} ms).` : `${esc(fmtDate(probe.at))}: Abweichung (${esc((probe.diffs || []).map((x) => x.table).join(', ') || probe.broken || '')}).`) : 'Baut den Stand aus dem Drive nach und vergleicht ihn mit der laufenden Datenbank.',
      action: `<button type="button" class="btn-outline btn-sm" data-action="dauer-probe">${icon('check', 'ico-sm')}<span>Probelauf</span></button>`,
    },
  ];
}

function dauerLiveHtml(d) {
  const lv = d.live || {};
  const s = lv.stats || {};
  const f = d.files || {};
  const g = d.guard || {};
  const wake = d.wake || {};
  const tile = (label, value, hint = '') => `<div class="dauer-tile"><div class="dauer-tile-label">${label}</div><div class="dauer-tile-value">${value}</div>${hint ? `<div class="dauer-tile-hint">${hint}</div>` : ''}</div>`;
  const budget = g.budget || d.budgetMb * 1048576;
  const pct = budget ? Math.min(100, Math.round(((g.ours || 0) / budget) * 100)) : 0;
  const drivePct = g.limit ? Math.min(100, Math.round(((g.usage || 0) / g.limit) * 100)) : null;
  return `<div id="dauerLive">
      <div class="dauer-tiles">
        ${tile('Wach seit', esc(dauerAgo(d.startedAt)).replace(/^vor /, ''), `Instanz ${esc(d.instance)}`)}
        ${tile('Letzte Sicherung', esc(dauerAgo(s.lastUploadAt)), lv.queue ? `<span class="dauer-warn">${lv.queue} warten</span>` : 'alles im Drive')}
        ${tile('Externer Wecker', esc(dauerAgo(wake.external && wake.external.at)), wake.external ? esc(wake.external.src) : 'noch keiner')}
        ${tile('Selbst-Ping', esc(dauerAgo(wake.self && wake.self.at)), wake.self ? (wake.self.ok ? `ok · ${wake.self.ms} ms` : `<span class="dauer-warn">fehlgeschlagen</span>`) : wake.selfUrl ? 'gleich' : 'keine Adresse')}
        ${tile('Bilder im Drive', `${f.files || 0}`, f.restoring ? `zurückholen: ${f.restored}/${f.toRestore}` : f.deleted ? `${f.deleted} gelöscht (30 Tage)` : f.files ? esc(dauerMb(f.bytes)) : 'noch keine')}
        ${tile('Pakete', `${s.journals || 0}`, `${s.bases || 0} ${s.bases === 1 ? 'Gesamtstand' : 'Gesamtstände'} · ${esc(dauerMb(s.bytes))}`)}
      </div>
      <div class="dauer-meter mt-4" role="img" aria-label="Belegung im Google Drive: ${pct} Prozent der Obergrenze">
        <div class="dauer-meter-head"><span>Sicherungen im Google Drive</span><span>${esc(dauerMb(g.ours))} von höchstens ${esc(dauerMb(budget))}</span></div>
        <div class="dauer-bar"><i style="width:${pct}%"></i></div>
        ${drivePct != null ? `<div class="dauer-meter-head mt-2"><span>Ganzes Google Drive</span><span>${esc(dauerMb(g.usage))} von ${esc(dauerMb(g.limit))} (${drivePct} %)</span></div><div class="dauer-bar is-drive"><i style="width:${drivePct}%"></i></div>` : ''}
        ${g.tight ? `<p class="form-hint dauer-warn mt-2">Platz ist knapp – Tages-/Wochensicherungen pausieren, die Live-Sicherung läuft weiter.</p>` : ''}
      </div>
    </div>`;
}

function dauerPanel() {
  const d = st.dauer;
  if (!d) return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  setTimeout(dauerWatch, 0);
  const checks = dauerChecks(d);
  const done = checks.filter((c) => c.ok).length;
  const lv = d.live || {};
  const r = d.restore;
  const url = d.selfUrl || location.origin;
  const head = !d.enabled ? badge('aus', 'slate') : done === checks.length ? badge('alles bereit', 'emerald') : badge(`${done}/${checks.length} erledigt`, 'amber');
  const conflict = lv.conflict
    ? `<div class="banner banner-amber is-stack mb-4"><strong>Im Google Drive liegt ein anderer Stand</strong> (vom ${esc(fmtDate(lv.conflict.at))}). Der Server ist ohne ihn gestartet – vermutlich fehlte der Wiederherstellungs-Schlüssel. Nichts wurde überschrieben.
        <div class="flex flex-wrap gap-2 mt-2"><button type="button" class="btn-gold btn-sm" data-action="dauer-adopt" data-lin="${esc(lv.conflict.lin)}">${icon('restore', 'ico-sm')}<span>Diesen Stand übernehmen</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="dauer-keep">${icon('check', 'ico-sm')}<span>Aktuellen Stand behalten</span></button></div></div>`
    : '';
  const restoreNote =
    r && r.mode === 'wiederhergestellt'
      ? `<p class="form-hint mt-3">Beim Start ${r.from && r.from.handover === 'direkt' ? 'von der vorigen Instanz übernommen' : 'aus dem Drive geladen'}: Stand ${r.gen} + ${r.journals} Pakete bis ${esc(fmtDate(r.at))} in ${(r.ms / 1000).toFixed(1).replace('.', ',')} s.${r.broken ? ` <span class="dauer-warn">${esc(r.broken)}</span>` : ''}</p>`
      : r && r.mode === 'ohne-schluessel' && d.enabled
        ? '<p class="form-hint dauer-warn mt-3">Beim Start gab es keinen Wiederherstellungs-Schlüssel – der Server hat nichts aus dem Drive geladen.</p>'
        : '';
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('shield')} Dauerbetrieb</h2>${head}</div>
      ${conflict}
      <p class="text-sm text-muted">Für Render Free: Der Server <strong>schläft nie ein</strong> (Selbst-Ping alle 4 Minuten, externer Wecker jede Minute, GitHub alle 5 Minuten), und <strong>jede Änderung</strong> – jede Akte, Nachricht, Einstellung, jedes Bild – liegt <strong>sofort nach der Aktion verschlüsselt im Google Drive</strong> (spätestens nach zwei Sekunden). Startet Render den Server neu oder kommt ein Update, holt er sich vorher alles zurück; bei einem Update übergibt die alte Instanz ihren letzten Stand direkt an die neue. Das Drive läuft nie voll: Es gibt eine feste Obergrenze, alte Kopien werden endgültig gelöscht.</p>
      ${d.enabled ? dauerLiveHtml(d) : ''}
      ${restoreNote}
      <h3 class="section-title mt-6">Einrichtung</h3>
      <ol class="dauer-checks">${checks
        .map((c) => `<li class="dauer-check ${c.ok ? 'is-ok' : 'is-open'}"><span class="dauer-check-mark" aria-hidden="true">${icon(c.ok ? 'check' : 'alert', 'ico-sm')}</span><div class="dauer-check-body"><div class="dauer-check-title">${c.title}<span class="sr-only">${c.ok ? ' – erledigt' : ' – offen'}</span></div><div class="dauer-check-text">${c.text}</div></div>${c.action ? `<div class="dauer-check-action">${c.action}</div>` : ''}</li>`)
        .join('')}</ol>
      <h3 class="section-title mt-6">Externer Wecker (cron-job.org)</h3>
      <ol class="text-sm text-muted dauer-steps">
        <li>Auf <a class="link-btn" href="https://cron-job.org" target="_blank" rel="noopener">cron-job.org</a> kostenlos anmelden (deutscher Dienst).</li>
        <li><em>Create cronjob</em> → URL: ${copyable(`${url}/api/ping?src=cron`)}</li>
        <li>Ausführung <em>jede Minute</em>, bei Fehlern per E-Mail benachrichtigen → speichern. Ein zweiter Wecker (z. B. UptimeRobot, alle 5 Minuten mit <code>?src=uptimerobot</code>) schadet nicht.</li>
        <li>GitHub weckt zusätzlich alle 5 Minuten: im Repository unter <em>Settings → Secrets and variables → Actions → Variables</em> die Variable <code>RENDER_URL</code> = ${copyable(url)} anlegen.</li>
      </ol>
      <h3 class="section-title mt-6">Google Drive</h3>
      <form data-form="dauer-budget" class="flex flex-wrap items-end gap-3">
        <label class="block"><span class="label">Obergrenze für alle Sicherungen</span><span class="flex items-center gap-2"><input class="field dauer-budget" type="number" name="budgetMb" min="200" step="100" value="${esc(d.budgetMb)}" aria-label="Obergrenze in MB"><span class="text-sm text-muted">MB</span></span></label>
        <button type="submit" class="btn-outline btn-md">${icon('check', 'ico-sm')}<span>Speichern</span></button>
        <button type="button" class="btn-ghost btn-md" data-action="dauer-check">${icon('refresh', 'ico-sm')}<span>Jetzt messen</span></button>
      </form>
      <p class="form-hint mt-2">Mindestens 500 MB bzw. 5 % des Drives bleiben immer frei. Wird es eng, löscht der Server zuerst ältere Tages-/Wochensicherungen, dann gelöschte Bilder, dann den vorigen Gesamtstand – nie den aktuellen Stand und nie vorhandene Bilder. ${lv.rootUrl ? `Ordner: <a class="link-btn" href="${esc(lv.rootUrl)}" target="_blank" rel="noopener">„Pake &amp; Scha – Dauerbetrieb“</a> (nicht freigegeben, nichts darin von Hand löschen).` : ''}</p>
      <div class="form-actions mt-4">
        <button type="button" class="btn-outline btn-md" data-action="dauer-base" ${lv.running ? '' : 'disabled'}>${icon('shield', 'ico-sm')}<span>Jetzt komplett sichern</span></button>
        <button type="button" class="btn-ghost btn-md" data-action="dauer-refresh">${icon('refresh', 'ico-sm')}<span>Aktualisieren</span></button>
      </div>
    </section>`;
}

Object.assign(actions, {
  'dauer-refresh': async () => {
    await loadDauer();
    renderView();
  },
  'dauer-key': async () => {
    const r = await api.post('/api/dauer/schluessel', {});
    openModal(`<h2 id="modalTitle" class="modal-title">Wiederherstellungs-Schlüssel</h2>
      <p class="text-sm text-muted">In Render: Dienst öffnen → <em>Environment</em> → <em>Add Environment Variable</em> → Name <code>DAUERBETRIEB_SCHLUESSEL</code>, Wert unten → <em>Save Changes</em>. Render startet danach neu und übernimmt den Stand nahtlos.</p>
      <textarea class="field font-mono text-xs mt-3" rows="5" readonly aria-label="Wiederherstellungs-Schlüssel">${esc(r.key)}</textarea>
      <p class="form-hint mt-2">Der Schlüssel enthält den Zugang zum Google Drive und den Datenschlüssel – verschlüsselt mit <code>GOOGLE_CLIENT_SECRET</code>, ohne das Secret wertlos. Nicht weitergeben. Nach einem erneuten Verbinden von Google gibt es einen neuen Schlüssel.</p>
      <div class="form-actions mt-4"><button type="button" class="btn-gold btn-md" data-action="copy" data-text="${esc(r.key)}">${icon('copy', 'ico-sm')}<span>Kopieren</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Schließen</button></div>`);
  },
  'dauer-probe': async (el) => {
    el.disabled = true;
    try {
      const r = await api.post('/api/dauer/probe', {});
      st.dauer = r;
      toast(r.probe.ok ? `Probelauf bestanden: ${r.probe.rows} Zeilen identisch aus dem Drive nachgebaut.` : 'Probelauf: Abweichung gefunden – Details in der Liste.', r.probe.ok ? 'ok' : 'error');
      renderView();
    } finally {
      el.disabled = false;
    }
  },
  'dauer-base': async (el) => {
    el.disabled = true;
    try {
      st.dauer = await api.post('/api/dauer/sichern', {});
      toast('Gesamtstand im Google Drive gespeichert.');
      renderView();
    } finally {
      el.disabled = false;
    }
  },
  'dauer-check': async (el) => {
    el.disabled = true;
    try {
      st.dauer = await api.post('/api/dauer/pruefen', {});
      renderView();
    } finally {
      el.disabled = false;
    }
  },
  'dauer-adopt': async (el) => {
    if (!(await ask('Der Server startet neu und lädt diesen Stand aus dem Google Drive. Was seit dem Start hier geändert wurde, bleibt als eigener Stand im Drive erhalten.', { title: 'Stand übernehmen?', confirmText: 'Übernehmen und neu starten' }))) return;
    await api.post('/api/dauer/linie', { action: 'adopt', lin: el.dataset.lin });
    toast('Der Server startet neu – die Seite lädt gleich von selbst.');
  },
  'dauer-keep': async () => {
    if (!(await ask('Der aktuelle Stand gilt ab jetzt. Der andere Stand bleibt im Drive, bis der Speicherwächter Platz braucht.', { title: 'Aktuellen Stand behalten?', confirmText: 'Behalten' }))) return;
    await api.post('/api/dauer/linie', { action: 'keep' });
    await loadDauer();
    renderView();
  },
});

Object.assign(forms, {
  'dauer-budget': async (form) => {
    const mb = Number(new FormData(form).get('budgetMb'));
    st.dauer = await api.put('/api/dauer/einstellungen', { budgetMb: mb });
    toast(`Obergrenze: ${mb} MB.`);
    renderView();
  },
});
