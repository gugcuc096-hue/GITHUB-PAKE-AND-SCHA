/*
 * Kanzlei-Dashboard – Systemzustand (Recht „System“): Startdauer, Laufzeit, Speicher, Datenbank, Sicherungen,
 * langsamste Anfragen und der Selbsttest des Servers (mit „jetzt prüfen“ und „Datenbank optimieren“).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const sysDuration = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} Tg ${h} Std` : h ? `${h} Std ${m} Min` : `${m} Min`;
};

function systemChecks(t) {
  if (!t) return '<p class="text-sm text-dim">Der Selbsttest läuft kurz nach dem Start und täglich. „Jetzt prüfen“ schaut zusätzlich die ganze Datenbank durch.</p>';
  return `<ul class="sys-checks">${t.checks
    .map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${icon(c.ok ? 'check' : 'alert', 'ico-sm')}<span><strong>${esc(c.name)}</strong>${c.detail ? ` <span class="text-dim">· ${esc(c.detail)}</span>` : ''}</span></li>`)
    .join('')}</ul><p class="text-xs text-dim mt-2">Zuletzt ${esc(fmtDate(t.at))}${t.deep ? ' (gründlich)' : ''}</p>`;
}

views.system = {
  async load() {
    st.system = await api.get('/api/system');
  },
  render() {
    return systemPanel(false);
  },
};

/** Systemzustand – als eigene Seite oder in den Einstellungen (Rechte & System → Systemzustand). */
function systemPanel(inSettings) {
  const s = st.system;
  const counts = Object.entries(s.db.counts)
    .map(([k, n]) => `<span class="sys-chip">${esc(k)} <strong>${n.toLocaleString('de-DE')}</strong></span>`)
    .join('');
  const routes = s.routes.length
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Anfrage</th><th>Anzahl</th><th>Ø</th><th>95 %</th><th>Max</th><th>Langsam</th></tr></thead><tbody>${s.routes
        .map((r) => `<tr><td class="font-mono text-xs">${esc(r.route)}</td><td>${r.n}</td><td>${r.avg} ms</td><td>${r.p95} ms</td><td>${r.max} ms</td><td>${r.slow || '–'}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="text-sm text-dim">Seit dem Start gab es noch keine Anfragen.</p>';
  const buttons = `<div class="flex flex-wrap gap-2"><button type="button" class="btn-outline btn-md" data-action="sys-check">${icon('check', 'ico-sm')}<span>Jetzt prüfen</span></button><button type="button" class="btn-ghost btn-md" data-action="sys-optimize">${icon('cog', 'ico-sm')}<span>Datenbank optimieren</span></button></div>`;
  const sub = 'Wie schnell und gesund läuft der Server? Die Zahlen gelten seit dem letzten Start.';
  return `
    ${inSettings ? `<div class="panel-head mb-3"><div><h2 class="panel-title">Systemzustand</h2><p class="text-sm text-muted">${sub}</p></div>${buttons}</div>` : `<div class="page-head"><div><h1 class="page-title">Systemzustand</h1><p class="page-sub">${sub}</p></div>${buttons}</div>`}
    <div class="kpi-grid mb-4 lg:mb-5">
      ${statKpi('Start dauerte', s.bootMs == null ? '–' : `${(s.bootMs / 1000).toFixed(1).replace('.', ',')} s`, `läuft seit ${sysDuration(s.uptimeSeconds)}`, 'clock')}
      ${statKpi('Arbeitsspeicher', fmtBytes(s.memory.rss), `davon Daten ${fmtBytes(s.memory.heapUsed)}`, 'chart')}
      ${statKpi('Datenbank', fmtBytes(s.db.bytes), `${s.db.indexes} Indizes · Protokoll ${fmtBytes(s.db.walBytes)}`, 'box')}
      ${statKpi('Freier Speicher', s.disk.freeBytes == null ? '–' : fmtBytes(s.disk.freeBytes), s.backups.last ? `${s.backups.count} Sicherungen · zuletzt ${fmtDate(s.backups.last)}` : 'noch keine Sicherung', 'download')}
    </div>
    <div class="panel panel-pad mb-4"><h3 class="section-title">Selbsttest</h3>${systemChecks(s.selfTest)}</div>
    <div class="panel panel-pad mb-4"><h3 class="section-title">Anfragen <span class="text-xs text-dim font-normal">langsamste zuerst</span></h3>${routes}
      ${s.slow.length ? `<h4 class="label mt-4">Länger als eine Sekunde</h4><ul class="sys-slow">${s.slow.map((x) => `<li><span class="font-mono text-xs">${esc(x.route)}</span> <strong>${x.ms} ms</strong> <span class="text-dim">${esc(fmtDate(x.at))}</span></li>`).join('')}</ul>` : ''}</div>
    <div class="panel panel-pad"><h3 class="section-title">Datenmenge</h3><div class="sys-chips">${counts}</div></div>`;
}

Object.assign(actions, {
  'sys-check': async () => {
    const r = await api.post('/api/system/check');
    st.system = r.snapshot;
    toast(r.result.ok ? 'Alles in Ordnung.' : 'Der Selbsttest hat Probleme gefunden.', r.result.ok ? 'ok' : 'error');
    renderView();
  },
  'sys-optimize': async () => {
    const r = await api.post('/api/system/optimize');
    st.system = r.snapshot;
    toast(`Datenbank optimiert (${r.ms} ms).`);
    renderView();
  },
});
