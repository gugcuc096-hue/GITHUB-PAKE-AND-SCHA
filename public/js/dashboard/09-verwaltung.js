/*
 * Kanzlei-Dashboard – Teil 9 von 14 (zweite Hälfte): Kooperationen, Aktenbearbeitung, Kanzlei-Statistik, Abmeldungen,
 * Bewerbungen, Protokoll, Bild-Uploads. Wird direkt nach 09-profil-board.js geladen.
 */
'use strict';

/* ---------------------------------------------------------------- Kooperationen (Board of Partners) */
const fmtCoopPct = (n) => `${fmtPct(n)} %`;
const coopState = (k) => (!k.active ? ['inaktiv', 'slate'] : !k.valid ? ['abgelaufen', 'amber'] : ['aktiv', 'emerald']);

function coopCard(k) {
  const [stateLabel, stateColor] = coopState(k);
  const roles = k.roles.length
    ? k.roles.map((r) => `<span class="badge badge-sky">@${esc(r.name || r.id)}</span>`).join(' ')
    : '<span class="text-dim">keine – nur von Hand zugeordnete Konten</span>';
  const members = k.members.length
    ? k.members
        .map(
          (m) => `<span class="badge badge-slate inline-flex items-center gap-1">${esc(m.name)}<button type="button" class="hover:text-red-300" data-action="coop-member-remove" data-id="${k.id}" data-user="${m.userId}" data-name="${esc(m.name)}" aria-label="${esc(m.name)} entfernen">${icon('x', 'ico-sm')}</button></span>`
        )
        .join(' ')
    : '<span class="text-dim">keine</span>';
  return `<div class="panel panel-pad">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h3 class="font-serif text-xl font-semibold">${esc(k.name)}</h3>${badge(`${fmtCoopPct(k.discountPct)} Rabatt`, 'gold')}${badge(stateLabel, stateColor)}</div>
          ${k.validUntil ? `<div class="text-xs text-dim mt-1">gültig bis ${esc(fmtDateOnly(k.validUntil))}</div>` : ''}
          ${k.description ? `<p class="text-sm text-muted mt-2 whitespace-pre-wrap">${esc(k.description)}</p>` : ''}</div>
        <div class="flex flex-wrap gap-2"><button class="btn-outline btn-sm" data-action="coop-edit" data-id="${k.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button class="btn-ghost btn-sm" data-action="coop-delete" data-id="${k.id}">${icon('trash', 'ico-sm')}</button></div>
      </div>
      <div class="info-grid mt-4">
        <div><div class="k">Discord-Rollen</div><div class="v flex flex-wrap gap-1">${roles}</div>
          <div class="text-xs text-dim mt-1">${k.usesDefaultGuild ? 'Server der Kanzlei (Discord-Tickets)' : `Server ${esc(k.guildId)}`}</div>
          ${k.roleError ? `<div class="text-xs text-red-300 mt-1">${icon('alert', 'ico-sm')} ${esc(k.roleError)}</div>` : ''}</div>
        <div><div class="k">Von Hand zugeordnete Konten</div><div class="v flex flex-wrap gap-1">${members}</div>
          <button class="link-btn mt-1" style="font-size:.75rem" data-action="coop-accounts" data-mode="member" data-id="${k.id}">+ Konto zuordnen</button></div>
      </div></div>`;
}

views.cooperations = {
  async load() {
    st.coops = await api.get('/api/cooperations');
    st.coopList = st.coops.cooperations;
  },
  render() {
    const d = st.coops;
    const warn = !d.discord.bot
      ? `<div class="banner banner-amber">${icon('alert')}<div>Es ist kein Discord-Bot eingerichtet (<code>DISCORD_BOT_TOKEN</code>). Discord-Rollen werden dann nicht erkannt – es gelten nur von Hand zugeordnete Konten.</div></div>`
      : !d.discord.defaultGuild
        ? `<div class="banner banner-amber">${icon('alert')}<div>Kein Discord-Server hinterlegt: unter <a href="/dashboard?tab=bot&amp;modul=tickets#settings" class="text-gold underline">Einstellungen → Discord → Tickets</a> die Server-ID eintragen oder bei jeder Kooperation den Server angeben.</div></div>`
        : '';
    return `
        <div class="page-head">
          <div><h1 class="page-title">Kooperationen</h1><p class="page-sub">Rabatt für Mitglieder von Kooperationspartnern – automatisch erkannt über ihre Discord-Rolle.</p></div>
          <div class="page-actions"><button class="btn-outline btn-md" data-action="coop-accounts" data-mode="check">${icon('search', 'ico-sm')}<span>Mandant prüfen</span></button><button class="btn-gold btn-md" data-action="coop-new">${icon('plus')}<span>Neue Kooperation</span></button></div>
        </div>
        ${warn}
        <div class="panel panel-pad mb-4 text-sm text-muted">
          <strong class="text-white">So funktioniert's:</strong> Kooperation anlegen (z. B. „Burgershot“, 15 %) und die Discord-Rolle der Mitglieder auswählen.
          Erstellt jemand eine Rechnung zu einer Akte, liest der Bot die Discord-Rollen des Mandanten (verknüpftes Discord bzw. „Discord-Ticket beitreten“) und setzt den Kooperationsrabatt automatisch ein.
          Ohne Discord: Mandantenkonten von Hand zuordnen – oder die Kooperation in der Rechnung selbst auswählen.
        </div>
        ${d.cooperations.length ? `<div class="stack">${d.cooperations.map(coopCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Kooperationen.', 'tag', nextStep('Neue Kooperation', 'coop-new'))}</div>`}`;
  },
};

function coopForm(k = null) {
  return `
      <h2 id="modalTitle" class="modal-title">${k ? `${esc(k.name)} bearbeiten` : 'Neue Kooperation'}</h2>
      <p class="modal-sub">Mitglieder erhalten den Rabatt auf Rechnungen und Honorarvereinbarungen. Erkannt werden sie über ihre Discord-Rolle oder weil ihr Konto von Hand zugeordnet ist.</p>
      <form data-form="coop" ${k ? `data-id="${k.id}"` : ''} class="form-grid cols-2">
        <div><label class="label">Name des Partners</label><input name="name" class="field" required minlength="2" maxlength="80" value="${esc(k ? k.name : '')}" placeholder="z. B. Burgershot" autofocus></div>
        <div><label class="label">Rabatt in %</label><input name="discountPct" type="number" inputmode="decimal" min="0.5" max="100" step="0.5" class="field" required value="${esc(k ? k.discountPct : 10)}"></div>
        <div><label class="label">Gültig bis <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="validUntil" type="date" class="field" value="${esc(k && k.validUntil ? k.validUntil : '')}"></div>
        <div class="flex items-end"><label class="check"><input type="checkbox" name="active" ${!k || k.active ? 'checked' : ''}> Aktiv</label></div>
        <div class="span-2"><label class="label">Vereinbarung / interne Notiz <span class="text-dim font-normal normal-case tracking-normal">(nur für das Team)</span></label><textarea name="description" rows="2" maxlength="1000" class="field" placeholder="z. B. Ansprechpartner, Bedingungen, seit wann">${esc(k ? k.description : '')}</textarea></div>
        <fieldset class="span-2 form-grid">
          <legend class="label flex items-center gap-2">${DISCORD_ICON} Discord-Rollen der Mitglieder</legend>
          <div><label class="label">Discord-Server-ID <span class="text-dim font-normal normal-case tracking-normal">(leer = Server der Kanzlei aus „Discord-Tickets“; ein anderer Server geht, wenn der Bot dort ist)</span></label>
            <div class="flex gap-2"><input id="coopGuild" name="guildId" class="field" inputmode="numeric" maxlength="25" value="${esc(k ? k.guildId : '')}" placeholder="leer lassen = Kanzlei-Server"><button type="button" class="btn-outline btn-md shrink-0" data-action="coop-load-roles">Rollen laden</button></div></div>
          <div id="coopRoles" class="text-sm text-dim">Rollen werden geladen …</div>
          <div><label class="label">Weitere Rollen-IDs <span class="text-dim font-normal normal-case tracking-normal">(optional, kommagetrennt – falls die Liste nicht lädt)</span></label><input name="roleIdsExtra" class="field" maxlength="400" value="" placeholder="123456789012345678"></div>
        </fieldset>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${k ? 'Speichern' : 'Kooperation anlegen'}</span></button></div>
      </form>`;
}

/** Rollen des Servers als Häkchen-Liste; bereits gewählte (auch unbekannte) bleiben angehakt. */
async function loadCoopRoles(selected) {
  const box = $('#coopRoles');
  if (!box) return;
  const guildId = ($('#coopGuild')?.value || '').trim();
  const chosen = new Set(selected || $$('#coopRoles input[name="role"]:checked').map((i) => i.value));
  box.innerHTML = 'Rollen werden geladen …';
  try {
    const { roles } = await api.get(`/api/cooperations/roles?fresh=1${guildId ? `&guildId=${encodeURIComponent(guildId)}` : ''}`);
    const unknown = [...chosen].filter((id) => !roles.some((r) => r.id === id));
    box.innerHTML = roles.length || unknown.length
      ? `<div class="label">Rollen auswählen – wer eine davon hat, bekommt den Rabatt</div><div class="chip-row" style="flex-wrap:wrap">${[
          ...roles.map((r) => `<label class="check chip"><input type="checkbox" name="role" value="${esc(r.id)}" ${chosen.has(r.id) ? 'checked' : ''}> @${esc(r.name)}</label>`),
          ...unknown.map((id) => `<label class="check chip"><input type="checkbox" name="role" value="${esc(id)}" checked> ${esc(id)} <span class="text-red-300">(nicht gefunden)</span></label>`),
        ].join('')}</div>`
      : 'Auf dem Server gibt es keine passenden Rollen.';
  } catch (e) {
    box.innerHTML = `<div class="text-red-300">${icon('alert', 'ico-sm')} ${esc(e.message)}</div>${[...chosen]
      .map((id) => `<label class="check chip mt-2"><input type="checkbox" name="role" value="${esc(id)}" checked> ${esc(id)}</label>`)
      .join('')}`;
  }
}

function coopAccountsDialog(mode, k) {
  return `
      <h2 id="modalTitle" class="modal-title">${mode === 'member' ? `Konto zu „${esc(k.name)}“ zuordnen` : 'Mandant prüfen'}</h2>
      <p class="modal-sub">${mode === 'member' ? 'Für Mitglieder ohne Discord (oder ohne die Rolle): Das Konto erhält den Rabatt dann immer.' : 'Welche Kooperation gilt für diesen Mandanten? Geprüft werden seine Discord-Rollen und von Hand zugeordnete Konten.'}</p>
      <input id="coopAccSearch" class="field" type="search" maxlength="80" placeholder="Name oder E-Mail suchen …" autocomplete="off" data-mode="${mode}" data-id="${k ? k.id : ''}" aria-label="Mandantenkonto suchen" autofocus>
      <div id="coopAccList" class="mt-4 text-sm text-dim">Tippen, um Mandantenkonten zu suchen.</div>
      <div id="coopCheckResult" class="mt-4"></div>`;
}
async function searchCoopAccounts(input) {
  const q = input.value.trim();
  const { accounts } = await api.get(`/api/cases/client-accounts?q=${encodeURIComponent(q)}`);
  if (!input.isConnected || input.value.trim() !== q) return;
  const mode = input.dataset.mode;
  $('#coopAccList').innerHTML = accounts.length
    ? accounts
        .map(
          (a) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.email)}</div></div>
              <button class="btn-${mode === 'member' ? 'gold' : 'outline'} btn-sm shrink-0" data-action="${mode === 'member' ? 'coop-member-add' : 'coop-check'}" data-id="${esc(input.dataset.id)}" data-user="${a.id}" data-name="${esc(a.name)}">${mode === 'member' ? 'Zuordnen' : 'Prüfen'}</button></div>`
        )
        .join('')
    : '<p class="text-sm text-dim">Kein Mandantenkonto gefunden.</p>';
}
function coopDetectHtml(r, name) {
  const hits = r.matches.length
    ? r.matches
        .map((m, i) => `<div class="flex flex-wrap items-center gap-2">${badge(`${fmtCoopPct(m.discountPct)}`, i === 0 ? 'gold' : 'slate')}<strong>${esc(m.name)}</strong><span class="text-xs text-dim">${esc(m.detail)}</span>${i === 0 && r.matches.length > 1 ? badge('wird angewandt (höchster Rabatt)', 'emerald') : ''}</div>`)
        .join('')
    : `<div class="text-muted">${r.checkedDiscord ? 'Keine Kooperation – der Mandant hat keine der eingestellten Discord-Rollen.' : 'Keine Kooperation erkannt.'}</div>`;
  return `<div class="banner ${r.matches.length ? 'banner-gold' : 'banner-slate'} is-stack">
      <div class="text-xs uppercase tracking-widest opacity-80 mb-2">Ergebnis für ${esc(name)}</div><div class="space-y-2">${hits}</div>
      ${r.notes.length ? `<div class="text-xs text-dim mt-2">${r.notes.map(esc).join('<br>')}</div>` : ''}</div>`;
}

/* ---------------------------------------------------------------- Aktenbearbeitung (nur Board of Partners) */
const WORK_DAYS = [
  [7, '7 Tage'],
  [30, '30 Tage'],
  [90, '90 Tage'],
  [365, '1 Jahr'],
  [0, 'Alles'],
];

function workCaseLine(w) {
  return `<div class="list-row wrap">
      <div class="main"><div class="title flex flex-wrap items-center gap-2"><button type="button" class="link-btn font-mono" data-action="open-case" data-id="${w.caseId}">${esc(w.caseNumber)}</button>${esc(w.caseTitle)}</div>
        <div class="meta">${statusBadge(ROLE_BADGE, w.role)} seit ${esc(fmtDate(w.since))}${w.running ? '' : ` · beendet ${esc(fmtDate(w.endedAt))}${w.endReason ? ' (' + esc(w.endReason) + ')' : ''}`}${w.estimated ? ' · <span title="Vor Einführung der Erfassung – Beginn aus dem Aktenverlauf geschätzt">≈ geschätzt</span>' : ''}</div></div>
      <div class="shrink-0 text-right"><div class="font-mono text-sm ${w.running ? 'text-emerald-300' : 'text-gold'}">${w.estimated ? '≈ ' : ''}${esc(fmtDur(w.durationMs))}</div><div class="text-xs text-dim">${w.running ? 'läuft' : 'abgeschlossen'}</div></div>
    </div>`;
}

views.work = {
  async load() {
    st.work = await api.get('/api/work?days=' + (st.workDays ?? 90));
  },
  render() {
    const w = st.work;
    const sm = w.summary;
    const chips = WORK_DAYS.map(([d, l]) => `<button class="chip ${w.days === d ? 'active' : ''}" data-action="work-days" data-days="${d}">${esc(l)}</button>`).join('');
    const members = w.members.length
      ? w.members
          .map(
            (m) => `<section class="panel panel-pad">
              <div class="panel-head"><div><h2 class="panel-title">${esc(m.name)}</h2><div class="text-xs text-dim">${esc(m.rank || 'ohne Rang')}${m.active ? '' : ' · deaktiviert'}</div></div>
                ${m.runningCount ? badge(`${m.runningCount} in Bearbeitung`, 'emerald') : badge('keine laufende Akte', 'slate')}</div>
              <div class="work-stats">
                <div><span class="k">Laufend</span><span class="v">${m.runningCount}</span><span class="s">${esc(fmtDur(m.runningMs))} insgesamt</span></div>
                <div><span class="k">Abgeschlossen</span><span class="v">${m.finishedCount}</span><span class="s">${esc(fmtDur(m.finishedMs))} insgesamt</span></div>
                <div><span class="k">Ø je Akte</span><span class="v">${esc(fmtDur(m.avgFinishedMs))}</span><span class="s">abgeschlossene</span></div>
              </div>
              ${m.cases.length ? `<details class="work-list" ${m.runningCount ? 'open' : ''}><summary>${m.cases.length} ${m.cases.length === 1 ? 'Akte' : 'Akten'} im Zeitraum</summary>${m.cases.map(workCaseLine).join('')}</details>` : '<p class="text-sm text-dim">Keine Akten im Zeitraum.</p>'}
            </section>`
          )
          .join('')
      : empty('Keine Mitarbeiter mit Akten im Zeitraum.', 'users');
    const caseRows = w.cases.length
      ? `<div class="tbl-wrap"><table class="tbl tbl-cards">
            <thead><tr><th>Akte</th><th>Zuständig</th><th>Status</th><th>Bearbeitungsdauer</th></tr></thead>
            <tbody>${w.cases
            .map(
              (c) => `<tr class="row" data-action="open-case" data-id="${c.id}">
                <td class="td-main"><div class="font-mono text-gold text-xs">${esc(c.caseNumber)}</div><div class="font-medium">${esc(c.title)}</div></td>
                <td data-label="Zuständig">${c.team.length ? c.team.map((t) => esc(t.name) + (t.role === 'lead' && c.team.length > 1 ? ' <span class="text-dim text-xs">(federführend)</span>' : '')).join(', ') : c.closed ? '<span class="text-dim">—</span>' : badge('Unbesetzt', 'amber')}</td>
                <td data-label="Status">${stageBadge(c)}</td>
                <td data-label="Dauer" class="nowrap"><span class="font-mono ${c.closed ? 'text-gold' : 'text-emerald-300'}">${esc(fmtDur(c.durationMs))}</span><div class="text-xs text-dim">${c.closed ? `bis Abschluss ${esc(fmtDate(c.closedAt))}` : `offen seit ${esc(fmtDate(c.openedAt))}`}</div></td></tr>`
            )
            .join('')}</tbody></table></div>`
      : empty('Keine Akten im Zeitraum.', 'folder');
    return `
        <div class="page-head">
          <div><h1 class="page-title">Kanzlei-Statistik</h1><p class="page-sub">Wer bearbeitet welche Akten – und wie lange. Nur für das Board of Partners sichtbar; erfasst wird automatisch bei Zuweisung, Abgabe und Abschluss.</p></div>
        </div>
        <div class="chip-row mb-4" role="group" aria-label="Zeitraum">${chips}</div>
        <div class="kpi-grid mb-4 lg:mb-5">
          ${kpi('Akten in Bearbeitung', String(sm.runningCases), `${sm.unassigned} davon ohne Anwalt`, 'briefcase', '#work')}
          ${kpi('Abgeschlossen', String(sm.closedCases), w.days ? `in den letzten ${w.days} Tagen` : 'insgesamt', 'check', '#work')}
          ${kpi('Ø Bearbeitungsdauer', fmtDur(sm.avgClosedMs), 'Eröffnung bis Abschluss', 'clock', '#work')}
          ${kpi('Mitarbeiter', String(w.members.filter((m) => m.runningCount).length), 'mit laufenden Akten', 'users', '#work')}
        </div>
        ${sm.estimatedEntries ? '<p class="form-hint mb-4">≈ = vor Einführung der Erfassung; Beginn aus dem Aktenverlauf geschätzt.</p>' : ''}
        <div class="grid-2 mb-4 lg:mb-5 items-start">${members}</div>
        <section class="panel panel-pad"><div class="panel-head"><h2 class="panel-title">Akten nach Bearbeitungsdauer</h2></div>${caseRows}</section>`;
  },
};


/* ---------------------------------------------------------------- Kanzlei-Statistik (Board of Partners) */
/*
 * Säulen in Gold (Reihe 1) und Blau (Reihe 2), geprüft auf dem dunklen Kartenhintergrund (Farbsehschwächen,
 * Abstand, Kontrast). Schrift bleibt in den Textfarben; Werte gibt es zusätzlich per Tooltip und als Tabelle.
 */
const STAT_MONTH = (key) => new Date(`${key}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const fmtNum = (n, digits = 1) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits });
/** Achsen-Beschriftung kurz: 12.500 → „12,5k“, 2.000.000 → „2 Mio.“ */
function compactNum(n) {
  if (n >= 1e6) return `${fmtNum(n / 1e6)} Mio.`;
  if (n >= 1e3) return `${fmtNum(n / 1e3, n >= 1e4 ? 0 : 1)}k`;
  return fmtNum(n, 0);
}
/** Runde Obergrenze für die y-Achse: Schritte 1 · 2 · 2,5 · 5 × 10ⁿ, 3 bis 6 Schritte – die knappste über dem Höchstwert. */
function niceScale(max, integer = false) {
  if (!max) return { top: integer ? 4 : 1000, step: integer ? 1 : 250 };
  let best = null;
  for (const n of [4, 5, 3, 6]) {
    const raw = max / n;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((x) => x >= raw && (!integer || Number.isInteger(x))) || Math.ceil(raw);
    if (!best || step * n < best.top) best = { top: step * n, step };
  }
  return best;
}
const fmtDays = (d) => (d == null ? '—' : fmtDur(d * 864e5));

/**
 * Säulendiagramm über die 12 Monate. series: [{ key, label, cls }], fmt: Wert → Text.
 * Ein Monat = eine Spalte (ganze Höhe als Trefferfläche) mit Tooltip bei Maus, Fokus und Tippen; Pfeiltasten wechseln.
 */
function columnChart(months, series, { fmt, axis, integer = false, label, labelValues = false, note = () => '' }) {
  const max = Math.max(0, ...months.flatMap((m) => series.map((s) => m[s.key])));
  const { top, step } = niceScale(max, integer);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const pct = (v) => `${Math.round((v / top) * 1000) / 10}%`;
  // Beschriftung nur am höchsten und am jüngsten Monat (eine Reihe), nie an jeder Säule
  const s0 = series[0].key;
  const maxIdx = months.reduce((b, m, i) => (m[s0] > months[b][s0] ? i : b), 0);
  const labelled = labelValues ? new Set([maxIdx, months.length - 1].filter((i) => months[i][s0] > 0)) : new Set();
  const cols = months
    .map((m, i) => {
      const full = STAT_MONTH(m.key);
      const tip = `<div class="chart-tip-title">${esc(full)}</div>${series
        .map((s) => `<div class="chart-tip-row"><i class="sw ${s.cls}"></i>${esc(s.label)}<b>${esc(fmt(m[s.key]))}</b></div>`)
        .join('')}${note(m) ? `<div class="chart-tip-note">${esc(note(m))}</div>` : ''}`;
      const aria = `${full}: ${series.map((s) => `${s.label} ${fmt(m[s.key])}`).join(', ')}${note(m) ? `, ${note(m)}` : ''}`;
      const bars = series
        .map(
          (s, si) =>
            `<span class="vchart-bar ${s.cls}" style="height:${pct(m[s.key])}">${si === 0 && labelled.has(i) ? `<b class="vchart-val">${esc(compactNum(m[s.key]))}</b>` : ''}</span>`
        )
        .join('');
      return `<div class="vchart-col${series.length > 1 ? ' grouped' : ''}" role="img" tabindex="${i === months.length - 1 ? 0 : -1}" aria-label="${esc(aria)}" data-tip="${esc(tip)}">${bars}</div>`;
    })
    .join('');
  return `<div class="vchart">
      <div class="vchart-y" aria-hidden="true">${ticks.map((v) => `<span style="bottom:${pct(v)}">${esc(axis(v))}</span>`).join('')}</div>
      <div class="vchart-main">
        <div class="vchart-grid" aria-hidden="true">${ticks.map((v, i) => `<i${i === 0 ? ' class="base"' : ''} style="bottom:${pct(v)}"></i>`).join('')}</div>
        <div class="vchart-cols" role="group" aria-label="${esc(label)}">${cols}</div>
        <div class="vchart-x" aria-hidden="true">${months.map((m) => `<span>${esc(m.label.split(' ')[0])}</span>`).join('')}</div>
        <div class="chart-tip" role="tooltip" hidden></div>
      </div>
    </div>`;
}
const chartLegend = (series) =>
  `<div class="chart-legend">${series.map((s) => `<span><i class="sw ${s.cls}"></i>${esc(s.label)}</span>`).join('')}</div>`;
const chartTable = (head, rows) =>
  `<details class="chart-table"><summary>Werte als Tabelle</summary><div class="tbl-wrap"><table class="tbl">
      <thead><tr>${head.map((h, i) => `<th${i ? ' style="text-align:right"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="font-mono nowrap" style="text-align:right"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;

/* Tooltip: eine Blase je Diagramm, über der Spalte; Maus, Tastatur und Tippen */
function chartTipShow(col) {
  const main = col.closest('.vchart-main');
  const tip = main && main.querySelector('.chart-tip');
  if (!tip) return;
  main.querySelectorAll('.vchart-col.is-active').forEach((c) => c !== col && c.classList.remove('is-active'));
  col.classList.add('is-active');
  tip.innerHTML = col.dataset.tip;
  tip.hidden = false;
  const half = tip.offsetWidth / 2;
  const center = col.offsetLeft + col.offsetWidth / 2;
  tip.style.left = `${Math.min(Math.max(center, half), main.clientWidth - half)}px`;
}
function chartTipHide(col) {
  const main = col.closest('.vchart-main');
  col.classList.remove('is-active');
  const tip = main && main.querySelector('.chart-tip');
  if (tip && !main.querySelector('.vchart-col.is-active')) tip.hidden = true;
}
document.addEventListener('pointerover', (e) => {
  const col = e.target.closest?.('.vchart-col');
  if (col) chartTipShow(col);
});
document.addEventListener('pointerout', (e) => {
  const col = e.pointerType === 'mouse' && e.target.closest?.('.vchart-col');
  if (col && !col.contains(e.relatedTarget) && document.activeElement !== col) chartTipHide(col);
});
document.addEventListener('focusin', (e) => {
  const col = e.target.closest?.('.vchart-col');
  if (col) chartTipShow(col);
});
document.addEventListener('focusout', (e) => {
  const col = e.target.closest?.('.vchart-col');
  if (col) chartTipHide(col);
});
document.addEventListener('keydown', (e) => {
  const col = e.target.closest?.('.vchart-col');
  if (!col) return;
  if (e.key === 'Escape') return chartTipHide(col);
  const all = [...col.parentElement.children];
  const i = all.indexOf(col);
  const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[e.key];
  if (next == null || !all[next]) return;
  e.preventDefault();
  all.forEach((c) => (c.tabIndex = c === all[next] ? 0 : -1));
  all[next].focus();
});

function statKpi(label, value, sub, ico, series = null) {
  return `<div class="panel kpi"><div class="kpi-label">${icon(ico, 'ico-sm')}${esc(label)}</div><div class="kpi-value" data-count="stat:${esc(label)}">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div>${series ? sparkline(series, label) : ''}</div>`;
}
/** Kleine goldene Verlaufslinie der letzten 8 Wochen unter einer Kennzahl (älteste links). */
function sparkline(values, label) {
  const w = 120;
  const h = 28;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [Math.round((i / (values.length - 1)) * w * 10) / 10, Math.round((h - 3 - (v / max) * (h - 6)) * 10) / 10]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(`${label}: Verlauf der letzten 8 Wochen`)}">
      <polygon class="spark-fill" points="0,${h} ${line} ${w},${h}"/><polyline class="spark-line" points="${line}" pathLength="1"/><circle class="spark-dot" cx="${last[0]}" cy="${last[1]}" r="2.4"/></svg>`;
}
/** „▲ 12 % ggü. Vorzeitraum“ (die 30 Tage davor) – ohne Vergleichswert nur dessen Summe. */
function trendText(now, before) {
  if (!before) return `30 Tage davor: ${money(0)}`;
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} % ggü. Vorzeitraum`;
}
const successCell = (s) =>
  s.pct == null
    ? '<span class="text-dim" title="Noch keine abgeschlossene Akte mit gewertetem Ergebnis">—</span>'
    : `<span class="nowrap"><span class="stat-meter" aria-hidden="true"><span style="width:${s.pct}%"></span></span><span class="tabular-nums">${s.pct} %</span> <span class="text-dim text-xs tabular-nums">(${s.won}/${s.rated})</span></span>`;
const OUTCOME_KIND = (o) => (o.success === true ? 'zählt als Erfolg' : o.success === false ? 'kein Erfolg' : 'ohne Wertung');

views.stats = {
  async load() {
    st.stats = await api.get('/api/stats');
  },
  render() {
    const s = st.stats;
    const k = s.kpis;
    const months = s.months;
    const span = `${STAT_MONTH(months[0].key)} – ${STAT_MONTH(months[months.length - 1].key)}`;
    const revenueSeries = [{ key: 'revenue', label: 'Umsatz', cls: 'ser1' }];
    const caseSeries = [
      { key: 'opened', label: 'Neu angelegt', cls: 'ser1' },
      { key: 'closed', label: 'Abgeschlossen', cls: 'ser2' },
    ];
    const hasRevenue = months.some((m) => m.revenue > 0);
    const hasCases = months.some((m) => m.opened || m.closed);
    const revenueChart = hasRevenue
      ? columnChart(months, revenueSeries, {
        fmt: money,
        note: (m) => (m.paid ? `${m.paid} ${m.paid === 1 ? 'Rechnung' : 'Rechnungen'} bezahlt` : ''),
        axis: compactNum,
        label: `Umsatz je Monat, ${span}`,
        labelValues: true,
      }) +
        chartTable(
          ['Monat', 'Umsatz', 'Rechnungen'],
          months.map((m) => [STAT_MONTH(m.key), money(m.revenue), String(m.paid)])
        )
      : empty('Noch keine bezahlten Rechnungen in den letzten 12 Monaten.', 'receipt');
    const caseChart = hasCases
      ? chartLegend(caseSeries) +
        columnChart(months, caseSeries, { fmt: (v) => String(v), axis: (v) => fmtNum(v, 0), integer: true, label: `Akten je Monat, ${span}` }) +
        chartTable(
          ['Monat', 'Neu angelegt', 'Abgeschlossen'],
          months.map((m) => [STAT_MONTH(m.key), String(m.opened), String(m.closed)])
        )
      : empty('Noch keine Akten in den letzten 12 Monaten.', 'folder');
    const lawyerRows = s.lawyers.length
      ? `<div class="tbl-wrap"><table class="tbl tbl-cards stat-tbl">
          <thead><tr><th>Anwalt</th><th style="text-align:right">Laufend</th><th style="text-align:right">Abgeschlossen</th><th>Erfolgsquote</th><th style="text-align:right">Ø bis Abschluss</th></tr></thead>
          <tbody>${[...s.lawyers, { total: true, name: 'Kanzlei gesamt', open: k.casesOpen, closed: k.casesClosed, success: k.success, avgDays: k.avgDays }]
            .map(
              (l) => `<tr${l.total ? ' class="stat-total"' : ''}>
                <td class="td-main"><div class="font-medium">${esc(l.name)}</div><div class="text-xs text-dim">${l.total ? 'alle Akten' : `${esc(l.rank || 'ohne Rang')}${l.active ? '' : ' · deaktiviert'}`}</div></td>
                <td data-label="Laufend" class="tabular-nums" style="text-align:right">${l.open}</td>
                <td data-label="Abgeschlossen" class="tabular-nums" style="text-align:right">${l.closed}</td>
                <td data-label="Erfolgsquote" class="nowrap">${successCell(l.success)}</td>
                <td data-label="Ø bis Abschluss" class="nowrap" style="text-align:right">${esc(fmtDays(l.avgDays))}</td></tr>`
            )
            .join('')}</tbody></table></div>
          ${s.unassignedOpen ? `<p class="form-hint mt-3">${s.unassignedOpen} laufende ${s.unassignedOpen === 1 ? 'Akte hat' : 'Akten haben'} noch keinen federführenden Anwalt.</p>` : ''}`
      : empty('Noch keine Akten mit federführendem Anwalt.', 'users');
    const outMax = Math.max(1, ...s.outcomes.map((o) => o.count));
    const outTotal = s.outcomes.reduce((a, o) => a + o.count, 0);
    const outcomes = s.outcomes.length
      ? `<div class="hbars">${[...s.outcomes]
          .sort((a, b) => b.count - a.count)
          .map(
            (o) => `<div class="hbar-row">
                <div class="hbar-label">${esc(o.label)}<span class="text-xs text-dim">${esc(OUTCOME_KIND(o))}</span></div>
                <div class="hbar-track"><span class="hbar-fill ser1" style="width:${Math.max(2, Math.round((o.count / outMax) * 100))}%"></span></div>
                <div class="hbar-val tabular-nums">${o.count} <span class="text-dim">· ${Math.round((o.count / outTotal) * 100)} %</span></div>
              </div>`
          )
          .join('')}</div>`
      : empty('Noch keine abgeschlossene Akte mit Ergebnis.', 'scale');
    const success = k.success;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Kanzlei-Statistik</h1><p class="page-sub">Umsatz, Akten und Erfolgsquote auf einen Blick – berechnet aus Rechnungen und Akten. Nur für das Board of Partners sichtbar.</p></div>
        </div>
        <div class="kpi-grid mb-4 lg:mb-5">
          ${statKpi('Umsatz 30 Tage', money(k.revenue30), trendText(k.revenue30, k.revenuePrev30), 'receipt', st.stats.weeks && st.stats.weeks.map((x) => x.revenue))}
          ${statKpi('Offene Forderungen', money(k.openSum), `${k.openCount} offen${k.overdueCount ? ` · ${k.overdueCount} überfällig` : ''}`, 'clock')}
          ${statKpi('Abgeschlossen', String(k.closed30), `in 30 Tagen · ${k.opened30} neu`, 'check', st.stats.weeks && st.stats.weeks.map((x) => x.closed))}
          ${statKpi('Erfolgsquote', success.pct == null ? '—' : `${success.pct} %`, success.rated ? `${success.won} von ${success.rated} mit Ergebnis` : 'noch kein Ergebnis', 'scale')}
        </div>
        <div class="grid-2 mb-4 lg:mb-5 items-start">
          <section class="panel panel-pad"><div class="panel-head"><div><h2 class="panel-title">Umsatz je Monat</h2><div class="text-xs text-dim">bezahlte Rechnungen nach Zahlungsdatum · ${esc(span)}</div></div></div>${revenueChart}</section>
          <section class="panel panel-pad"><div class="panel-head"><div><h2 class="panel-title">Akten je Monat</h2><div class="text-xs text-dim">neu angelegt und abgeschlossen · ${esc(span)}</div></div></div>${caseChart}</section>
        </div>
        <section class="panel panel-pad mb-4 lg:mb-5"><div class="panel-head"><div><h2 class="panel-title">Je Anwalt</h2><div class="text-xs text-dim">nach federführendem Anwalt · alle Akten</div></div></div>${lawyerRows}</section>
        <section class="panel panel-pad"><div class="panel-head"><div><h2 class="panel-title">Ergebnisse</h2><div class="text-xs text-dim">abgeschlossene Akten · alle Zeit</div></div></div>${outcomes}</section>`;
  },
};

/* ---------------------------------------------------------------- Abmeldungen */
const ABSENCE_BADGE = { aktiv: ['abgemeldet', 'amber'], geplant: ['geplant', 'sky'], vorbei: ['beendet', 'slate'] };
const absenceDays = (a) => Math.round((new Date(`${a.endDate}T12:00:00`) - new Date(`${a.startDate}T12:00:00`)) / 864e5) + 1;


function absencePanel() {
  const data = st.absences;
  if (!data) return '';
  const list = data.absences.filter((a) => a.state !== 'vorbei');
  const rows = list.length
    ? list
        .map((a) => {
          const left = a.state === 'aktiv' ? daysUntil(a.endDate) : null;
          return `<div class="list-row wrap">
              ${avatarWrap(a.avatarUrl, a.name, null, 'sm')}
              <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(a.name)}${statusBadge(ABSENCE_BADGE, a.state)}${badge(a.reasonLabel, 'slate')}</div>
                <div class="meta">${esc(dayDe(a.startDate))} – ${esc(dayDe(a.endDate))} · ${absenceDays(a)} ${absenceDays(a) === 1 ? 'Tag' : 'Tage'}${left !== null ? ` · ${left === 0 ? 'letzter Tag heute' : `noch ${left + 1} Tage`}` : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
              ${a.canManage
              ? `<div class="flex gap-1 shrink-0">${a.state === 'aktiv' ? `<button class="btn-outline btn-sm" data-action="absence-return" data-id="${a.id}">Zurückmelden</button>` : ''}
                    <button class="btn-ghost btn-sm" data-action="absence-delete" data-id="${a.id}">${a.state === 'geplant' ? 'Zurückziehen' : 'Löschen'}</button></div>`
              : ''}
            </div>`;
        })
        .join('')
    : empty('Niemand ist abgemeldet.', 'calendar');
  const mine = list.find((a) => a.userId === st.user.id && a.state === 'aktiv');
  return `<section class="panel panel-pad mb-4 lg:mb-5" id="secAbsences">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('calendar')} Abmeldungen</h2>
        <button class="btn-outline btn-sm" data-action="absence-new">${icon('plus', 'ico-sm')}<span>Abmelden</span></button></div>
      ${mine ? `<div class="banner banner-amber mb-3">${icon('alert')}<div>Sie sind bis ${esc(dayDe(mine.endDate))} abgemeldet. Wieder da? <button class="link-btn" data-action="absence-return" data-id="${mine.id}">Jetzt zurückmelden</button></div></div>` : ''}
      ${rows}
      <p class="form-hint mt-3">Abmeldungen, Rückmeldungen und Zurückziehen erscheinen auf Wunsch in Discord (Einstellungen → Discord → Webhook → „Abmeldung / Rückmeldung“).</p>
    </section>`;
}

async function absenceModal() {
  const data = st.absences || (st.absences = await api.get('/api/absences'));
  if (isAdmin()) await load.lawyers();
  const today = data.today;
  openModal(`
      <h2 class="modal-title">Abmelden</h2>
      <p class="modal-sub">Abwesenheit eintragen – das Team sieht sie unter „Dienstzeiten“, auf Wunsch geht sie auch in den Discord.</p>
      <form data-form="absence" class="form-grid cols-2">
        ${isAdmin() ? `<div class="span-2"><label class="label">Wer?</label><select name="userId" class="field">${st.lawyers.map((l) => opt(l.id, l.displayName + (l.id === st.user.id ? ' (Sie)' : ''), l.id === st.user.id)).join('')}</select></div>` : ''}
        <div><label class="label" for="abFrom">Von</label><input id="abFrom" name="startDate" type="date" class="field" required min="${esc(today)}" value="${esc(today)}"></div>
        <div><label class="label" for="abTo">Bis (einschließlich)</label><input id="abTo" name="endDate" type="date" class="field" required min="${esc(today)}" value="${esc(today)}"></div>
        <div class="span-2"><label class="label">Grund</label><div class="chip-row" role="radiogroup">${Object.entries(data.reasons)
        .map(([k, l], i) => `<label class="chip-radio"><input type="radio" name="reason" value="${k}" ${i === 0 ? 'checked' : ''}><span>${esc(l)}</span></label>`)
        .join('')}</div></div>
        <div class="span-2"><label class="label" for="abNote">Notiz (optional)</label><input id="abNote" name="note" class="field" maxlength="300" placeholder="z. B. im Urlaub, per Discord erreichbar"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Abmeldung eintragen</span></button></div>
      </form>`);
}

views.duty = {
  async load() {
    if (!st.dutyWeek) st.dutyWeek = mondayOf(new Date());
    const { from, to } = weekRange();
    const [state, data, absences] = await Promise.all([
      api.get('/api/duty'),
      api.get(`/api/duty/sessions?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api.get('/api/absences'),
    ]);
    st.duty = state;
    st.dutyData = data;
    st.absences = absences;
    if (!st.dutyUser || !data.totals.some((t) => t.userId === st.dutyUser)) st.dutyUser = st.user.id;
    renderUser();
  },
  render() {
    const admin = isAdmin();
    const me = st.duty.me;
    const onDuty = st.duty.onDuty;
    const { from, to } = weekRange();
    const lastDay = new Date(to.getTime() - 864e5);
    const weekLabel = `KW ${isoWeek(from)} · ${from.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}–${lastDay.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
    const totals = st.dutyData.totals;
    const sumMinutes = totals.reduce((s, t) => s + t.minutes, 0);
    const selected = totals.find((t) => t.userId === st.dutyUser) || totals[0];
    const sessions = st.dutyData.sessions.filter((s) => selected && s.userId === selected.userId);
    const isCurrentWeek = mondayOf(new Date()).getTime() === from.getTime();

    const myCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Mein Dienst</h2>${me.status !== 'off' ? badge('Eingestempelt', 'emerald') : badge('Ausgestempelt', 'slate')}</div>
          <div class="flex items-center gap-4 mb-4">
            ${avatarWrap(st.user.avatarUrl, st.user.displayName, me.status, 'lg')}
            <div>
              <div class="text-sm text-muted">${esc(DUTY[me.status])}${me.note ? ' · ' + esc(me.note) : ''}</div>
              ${me.status !== 'off' && me.since
              ? `<div class="timer" data-countup="${esc(me.since)}">${esc(fmtElapsed(Date.now() - parseDate(me.since).getTime()))}</div><div class="text-xs text-dim">seit ${esc(fmtTime(me.since))} Uhr</div>`
              : '<div class="timer" style="color:var(--text-dim)">0:00:00</div><div class="text-xs text-dim">Nicht im Dienst</div>'}
            </div>
          </div>
          <div class="duty-options mb-4">${Object.entries(DUTY)
          .map(([k, l]) => `<button type="button" class="duty-opt ${me.status === k ? 'active' : ''}" data-action="duty-set" data-status="${k}"><span class="duty-dot s-${k}"></span>${esc(k === 'off' && me.status !== 'off' ? 'Ausstempeln' : l)}</button>`)
          .join('')}</div>
          <form data-form="duty-note" class="flex flex-col sm:flex-row gap-2">
            <input name="note" class="field" maxlength="120" value="${esc(me.note)}" placeholder="Wo sind Sie? z. B. Mission Row PD, Zelle 3" aria-label="Notiz zum Dienststatus">
            <button type="submit" class="btn-outline btn-md" ${me.status === 'off' ? 'disabled' : ''}>Notiz speichern</button>
          </form>
          <p class="form-hint mt-2">Vergessenes Ausstempeln wird nach 12 Stunden automatisch beendet.</p>
        </section>`;

    const onDutyCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Jetzt im Dienst</h2>${badge(`${onDuty.length}`, onDuty.length ? 'emerald' : 'slate')}</div>
          ${onDuty.length
          ? onDuty
              .map(
                (m) => `<div class="list-row wrap">
                    ${avatarWrap(m.avatarUrl, m.name, m.status, 'sm')}
                    <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${esc(m.statusLabel)}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
                    <div class="flex items-center gap-2 shrink-0"><span class="font-mono text-xs text-gold" data-countup="${esc(m.since)}">${esc(fmtElapsed(Date.now() - (parseDate(m.since)?.getTime() || Date.now())))}</span>
                    ${admin && m.id !== st.user.id ? `<button class="btn-ghost btn-sm" data-action="duty-force-off" data-id="${m.id}" data-name="${esc(m.name)}">Ausstempeln</button>` : ''}</div>
                  </div>`
              )
              .join('')
          : empty('Gerade ist niemand im Dienst.', 'clock')}
        </section>`;

    const totalsTable = `
        <div class="tbl-wrap"><table class="tbl tbl-cards">
          <thead><tr><th>${admin ? 'Teammitglied' : 'Woche'}</th><th>Arbeitszeit</th><th>Schichten</th><th>Status</th></tr></thead>
          <tbody>${totals
          .map(
            (t) => `<tr class="row ${selected && t.userId === selected.userId ? 'is-selected' : ''}" data-action="duty-select" data-id="${t.userId}">
                <td class="td-main"><div class="flex items-center gap-3">${avatarWrap(t.avatarUrl, t.name, t.status !== 'off' ? t.status : null, 'sm')}<div><div class="font-medium">${esc(t.name)}</div><div class="text-xs text-dim">${esc(t.rank || '')}</div></div></div></td>
                <td data-label="Arbeitszeit" class="font-mono nowrap">${esc(fmtHM(t.minutes))}</td>
                <td data-label="Schichten">${t.sessions}</td>
                <td data-label="Status">${t.status !== 'off' ? badge(DUTY[t.status], 'emerald') : '<span class="text-dim text-xs">außer Dienst</span>'}</td></tr>`
          )
          .join('')}</tbody></table></div>`;

    const sessionList = sessions.length
      ? sessions
          .map((s) => {
            const start = parseDate(s.startedAt);
            const end = s.endedAt ? parseDate(s.endedAt) : null;
            const dur = ((end ? end.getTime() : Date.now()) - start.getTime()) / 60000;
            return `<div class="list-row wrap">
                <div class="main"><div class="title">${esc(start.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }))} · ${esc(fmtTime(s.startedAt))} – ${end ? esc(fmtTime(s.endedAt)) : '<span class="text-emerald-300">läuft</span>'} Uhr</div>
                  <div class="meta">${esc(fmtHM(dur))}${s.note ? ' · ' + esc(s.note) : ''}${s.autoClosed ? ' · automatisch beendet' : ''}</div></div>
                ${admin ? `<div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="duty-session-edit" data-id="${s.id}" aria-label="Schicht bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="duty-session-delete" data-id="${s.id}" aria-label="Schicht löschen">${icon('trash', 'ico-sm')}</button></div>` : ''}
              </div>`;
          })
          .join('')
      : empty('Keine Schichten in dieser Woche.', 'clock');

    return `
        <div class="page-head">
          <div><h1 class="page-title">Stempeluhr & Dienstzeiten</h1><p class="page-sub">Dienst beginnen und beenden, Abmeldungen eintragen, Wochenstunden des Teams im Blick – ideal für Gehaltsabrechnung und Eilnotdienst.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="absence-new">${icon('calendar', 'ico-sm')}<span>Abmelden</span></button>
          ${admin ? `<button class="btn-outline btn-md" data-action="duty-session-new">${icon('plus', 'ico-sm')}<span>Schicht nachtragen</span></button>` : ''}</div>
        </div>
        <div class="grid-2 mb-4 lg:mb-5">${myCard}${onDutyCard}</div>
        ${absencePanel()}
        <section class="panel panel-pad mb-4 lg:mb-5">
          <div class="panel-head">
            <div class="week-nav">
              <button class="icon-btn" data-action="duty-week" data-dir="-1" aria-label="Vorherige Woche">${icon('chevronLeft')}</button>
              <span class="lbl">${esc(weekLabel)}</span>
              <button class="icon-btn" data-action="duty-week" data-dir="1" aria-label="Nächste Woche" ${isCurrentWeek ? 'disabled' : ''}>${icon('chevronRight')}</button>
              ${isCurrentWeek ? '' : '<button class="btn-outline btn-sm" data-action="duty-week" data-dir="0">Diese Woche</button>'}
            </div>
            ${admin ? `<span class="text-sm text-muted">Team gesamt: <span class="font-mono text-gold">${esc(fmtHM(sumMinutes))}</span></span>` : ''}
          </div>
          ${totalsTable}
        </section>
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Schichten${selected ? ' – ' + esc(selected.name) : ''}</h2></div>
          ${sessionList}
        </section>`;
  },
};

function dutySessionModal(s) {
  const isNew = !s;
  const members = st.dutyData.totals;
  openModal(`
      <h2 class="modal-title">${isNew ? 'Schicht nachtragen' : 'Schicht bearbeiten'}</h2>
      <p class="modal-sub">${isNew ? 'Zum Beispiel wenn jemand vergessen hat einzustempeln.' : esc(s.userName)}</p>
      <form data-form="duty-session" data-id="${isNew ? '' : s.id}" class="form-grid cols-2">
        ${isNew ? `<div class="span-2"><label class="label">Teammitglied</label><select name="userId" class="field">${members.map((m) => opt(m.userId, m.name, m.userId === st.dutyUser)).join('')}</select></div>` : ''}
        <div><label class="label">Beginn</label><input name="startedAt" type="datetime-local" class="field" required value="${s ? toLocalInput(s.startedAt) : ''}"></div>
        <div><label class="label">Ende</label><input name="endedAt" type="datetime-local" class="field" ${isNew ? 'required' : ''} value="${s && s.endedAt ? toLocalInput(s.endedAt) : ''}"></div>
        <div class="span-2"><label class="label">Notiz</label><input name="note" class="field" maxlength="120" value="${esc(s ? s.note : '')}"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Bewerbungen */
const OPEN_APP = ['eingegangen', 'in_pruefung', 'gespraech'];
const stars = (n) => `<span class="stars readonly" aria-label="${n} von 5 Sternen">${'★'.repeat(n)}${'<span style="opacity:.25">★</span>'.repeat(5 - n)}</span>`;

function appTable() {
  const f = st.appFilter;
  const rows = st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f));
  if (!rows.length) return empty(st.applications.length ? 'Keine Bewerbungen für diese Auswahl.' : 'Noch keine Bewerbungen eingegangen.', 'userAdd');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Bewerbung</th><th>Stelle</th><th>Eingang</th><th>Bewertung</th><th>Status</th></tr></thead>
      <tbody>${rows
      .map(
        (a) => `<tr class="row" data-action="app-open" data-id="${a.id}">
          <td class="td-main"><div class="font-mono text-gold text-xs">${esc(a.number)}</div><div class="font-medium">${esc(a.name)}${a.age ? ` <span class="text-dim text-xs">(${esc(a.age)})</span>` : ''}${a.unreadMessages ? ` <span class="chat-new" title="Neue Nachrichten des Bewerbers">${icon('chat', 'ico-sm')}${a.unreadMessages}</span>` : ''}</div><div class="text-xs text-dim">Discord: ${esc(a.discord || '—')}</div></td>
          <td data-label="Stelle">${esc(a.positionTitle)}</td>
          <td data-label="Eingang" class="text-xs text-dim nowrap">${esc(fmtDate(a.createdAt))}</td>
          <td data-label="Bewertung">${stars(a.rating)}</td>
          <td data-label="Status">${statusBadge(APP_STATUS, a.status)}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

function positionsPanel() {
  return `<div class="panel panel-pad">
      ${st.positions.length
      ? st.positions
          .map(
            (p) => `<div class="list-row wrap">
              <div class="main"><div class="title">${esc(p.title)} ${p.active ? badge('Ausgeschrieben', 'emerald') : badge('Pausiert', 'slate')}</div><div class="meta">${esc(p.description)}</div></div>
              <div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="position-edit" data-id="${p.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="position-delete" data-id="${p.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></div>`
          )
          .join('')
      : empty('Keine Stellen ausgeschrieben – Initiativbewerbungen sind trotzdem möglich.', 'briefcase', nextStep('Stelle ausschreiben', 'position-new'))}
    </div>`;
}

views.applications = {
  async load() {
    const [a, p] = await Promise.all([api.get('/api/admin/applications'), api.get('/api/admin/positions')]);
    st.applications = a.applications;
    st.positions = p.positions;
    st.newApplications = st.applications.filter((x) => x.status === 'eingegangen').length + st.applications.reduce((n, x) => n + (x.unreadMessages || 0), 0);
  },
  render() {
    const count = (f) => st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f)).length;
    const filters = [['offen', 'Offen'], ...Object.entries(APP_STATUS).map(([k, [l]]) => [k, l]), ['alle', 'Alle']];
    const tabBewerbungen = st.appTab === 'bewerbungen';
    return `
        <div class="page-head">
          <div><h1 class="page-title">Bewerbungen</h1><p class="page-sub">Bewerbungen prüfen, bewerten, zum Gespräch einladen und mit einem Klick einstellen.</p></div>
          <div class="page-actions">
            <a href="/karriere" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Karriereseite</span></a>
            ${tabBewerbungen ? '' : `<button class="btn-gold btn-md" data-action="position-new">${icon('plus')}<span>Neue Stelle</span></button>`}
          </div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="bewerbungen">${icon('userAdd', 'ico-sm')}Bewerbungen <span class="chip-count">${st.applications.length}</span></button>
          <button class="chip ${!tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="stellen">${icon('briefcase', 'ico-sm')}Stellenausschreibungen <span class="chip-count">${st.positions.filter((p) => p.active).length}</span></button>
        </div>
        ${tabBewerbungen
        ? `<div class="chip-row mb-4">${filters.map(([k, l]) => `<button class="chip ${st.appFilter === k ? 'active' : ''}" data-action="app-filter" data-value="${k}">${esc(l)} <span class="chip-count">${count(k)}</span></button>`).join('')}</div>
             <div class="panel p-2 md:p-3">${appTable()}</div>`
        : positionsPanel()}`;
  },
};

async function openApplication(id) {
  const data = await api.get('/api/admin/applications/' + id);
  openModal(appDetail(data), { wide: true, key: `app:${id}`, reopen: () => openApplication(id) });
  st.modalAppId = id;
  initAppChat();
}
async function reloadApplication(data) {
  if (st.modalAppId === data.application.id) {
    const draft = $('#modalBody .chat-input')?.value || '';
    replaceModal(appDetail(data));
    if (draft && $('#modalBody .chat-input')) $('#modalBody .chat-input').value = draft;
    initAppChat();
  }
  refreshBehind();
}

/* ---------------------------------------------------------------- Bewerbung: Fortschritt und Nachrichten */
// Stand der Bewerbung als Kreise (wie der Bearbeitungsstand einer Akte): Eingegangen → In Prüfung → Gespräch → Entscheidung
const APP_STEPS = [
  ['eingegangen', 'Eingegangen'],
  ['in_pruefung', 'In Prüfung'],
  ['gespraech', 'Gespräch'],
  ['angenommen', 'Angenommen'],
];
function appTrack(a) {
  const idx = { eingegangen: 0, in_pruefung: 1, gespraech: 2, angenommen: 3, abgelehnt: 3 }[a.status] ?? 0;
  const rejected = a.status === 'abgelehnt';
  const accepted = a.status === 'angenommen';
  return `<div class="track is-editable mb-5">
      <div class="track-head"><span>Bewerbungsstand${rejected ? ' · <span class="text-red-300">abgelehnt</span>' : ''}</span></div>
      <div class="track-line"><div class="track-fill" style="width:${(idx / 3) * 75}%"></div>
      <div class="grid grid-cols-4">${APP_STEPS.map(([key, label], i) => {
        const last = i === 3;
        const done = i < idx || (last && accepted);
        const cur = !rejected && !accepted && i === idx;
        const node = last && rejected ? '<div class="track-node rejected">✕</div>' : `<div class="track-node ${done ? 'done' : cur ? 'current' : ''}">${done ? '✓' : i + 1}</div>`;
        const inner = `${node}<span class="track-label text-[0.7rem] sm:text-xs text-muted text-center">${esc(last && rejected ? 'Abgelehnt' : label)}</span>`;
        return a.status === key
          ? `<div class="track-step" aria-current="step">${inner}</div>`
          : `<button type="button" class="track-step" data-action="app-status" data-id="${a.id}" data-status="${key}" title="Bewerbungsstand: ${esc(label)}" aria-label="Bewerbungsstand auf „${esc(label)}“ setzen">${inner}</button>`;
      }).join('')}</div></div></div>`;
}
function appBubble(m) {
  return { id: m.id, side: m.fromBoard ? 'out' : 'in', author: m.fromBoard ? (m.author === st.user.displayName ? '' : m.author) : m.author, sub: m.fromBoard ? 'Board of Partners' : 'Bewerber', body: m.body, createdAt: m.createdAt };
}
function appChatSection(a, { messages = [], applicantRead = 0, portal, discordConnected }) {
  const link = `${location.origin}${portal}`;
  return `<div class="section" id="secAppChat">
      <h3 class="section-title">Nachrichten <span class="text-xs text-dim font-normal sec-meta">mit dem Bewerber</span></h3>
      <div class="app-reach">
        ${discordConnected ? badge('Discord verbunden', 'emerald') : badge('Discord nicht verbunden', 'slate')}
        <span class="text-xs text-dim">${discordConnected ? 'Nachrichten und neue Stände bekommt der Bewerber zusätzlich als Discord-Direktnachricht.' : 'Der Bewerber liest Nachrichten auf seiner Bewerberseite – dort kann er auch sein Discord verbinden. Link verloren? „Link zur Bewerberseite“ kopieren und ihm schicken.'}</span>
        <button type="button" class="btn-ghost btn-sm ml-auto" data-action="copy" data-text="${esc(link)}" title="${esc(link)}">${icon('link', 'ico-sm')}<span>Link zur Bewerberseite</span></button>
      </div>
      <div class="chat">
        <div class="chat-list" id="appChatList" data-app-id="${a.id}" data-last-id="${messages.length ? messages[messages.length - 1].id : 0}" data-other-read="${applicantRead}" aria-live="polite">
          ${messages.length ? chatBubbles(messages, appBubble) : '<p class="chat-empty">Noch keine Nachrichten. Fragen, Terminabsprachen und Rückmeldungen laufen hier – der Bewerber antwortet über seine Bewerberseite.</p>'}
        </div>
        ${chatForm({ form: 'app-message', attrs: `data-id="${a.id}"`, placeholder: `Nachricht an ${a.name} …` })}
        <p class="chat-hint"><span class="hidden md:inline">Enter sendet · Umschalt + Enter für eine neue Zeile. </span>Interne Notizen gehören unten unter „Interne Notizen“ – die sieht der Bewerber nie.</p>
      </div>
    </div>`;
}
function initAppChat() {
  const list = $('#appChatList');
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  chatReceipts(list);
  load.appCount().then(renderNav).catch(() => {}); // beim Öffnen gelesen
}
async function pollAppChat() {
  const list = $('#appChatList');
  if (!list || document.hidden || st.appChatPolling) return;
  st.appChatPolling = true;
  try {
    const id = Number(list.dataset.appId);
    const r = await api.get(`/api/admin/applications/${id}/messages?after=${Number(list.dataset.lastId) || 0}`);
    if (!list.isConnected) return;
    chatAppend(list, r.messages, appBubble);
    chatReceipts(list, r.applicantRead);
    if (r.messages.length) load.appCount().then(renderNav).catch(() => {});
  } catch {
    /* nächster Versuch beim nächsten Takt */
  } finally {
    st.appChatPolling = false;
  }
}

function appDetail({ application: a, notes, hiredUser, ticket, ...chat }) {
  const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;
  const qa = (q, text) => (text ? `<div class="qa"><div class="q">${esc(q)}</div><div class="a">${esc(text)}</div></div>` : '');
  return `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4 pr-12">
        <div class="min-w-0"><div class="font-mono text-gold text-sm">${esc(a.number)}</div>
          <h2 id="modalTitle" class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(a.name)}</h2>
          <div class="text-sm text-muted">${esc(a.positionTitle)}</div></div>
        ${statusBadge(APP_STATUS, a.status)}
      </div>
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <span class="text-xs uppercase tracking-widest text-dim">Bewertung</span>
        <span class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5]
        .map((n) => `<button type="button" class="${n <= a.rating ? 'on' : ''}" data-action="app-rate" data-id="${a.id}" data-value="${n === a.rating ? 0 : n}" aria-label="${n} Sterne">★</button>`)
        .join('')}</span>
      </div>
      ${appTrack(a)}
      ${hiredUser ? `<div class="banner banner-gold">${icon('check')}<div>Eingestellt – Login-Konto <strong>${esc(hiredUser.email)}</strong> wurde angelegt.</div></div>` : ''}
      <div class="info-grid mb-5">${cell('Alter', a.age ? String(a.age) : '')}${cell('Telefon', a.phone)}${cell('Discord', a.discord)}${cell('E-Mail', a.email)}${cell('Eingegangen', fmtDate(a.createdAt))}${cell('Gespräch', a.interviewAt ? fmtDate(a.interviewAt) : '')}</div>
      ${boardTicketLine('application', a.id, ticket)}
      <div class="stack">${qa('Motivation', a.motivation)}${qa('Erfahrung', a.experience)}${qa('Verfügbarkeit', a.availability)}</div>

      ${appChatSection(a, chat)}

      <div class="section">
        <form data-form="app-interview" data-id="${a.id}" class="qa form-grid cols-2">
          <div class="q span-2">Zum Gespräch einladen</div>
          <div><label class="label">Termin</label><input name="startsAt" type="datetime-local" class="field" required value="${a.interviewAt ? toLocalInput(a.interviewAt) : ''}"></div>
          <div><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="Kanzlei Würfelpark"></div>
          <div class="span-2 flex flex-wrap items-center gap-3"><button type="submit" class="btn-outline btn-md">${icon('calendar', 'ico-sm')}<span>Gespräch planen</span></button>
          <p class="form-hint">Setzt den Stand auf „Gespräch“, trägt den Termin in den Team-Kalender ein und schickt dem Bewerber die Einladung als Nachricht.</p></div>
        </form>
      </div>

      <div class="form-actions section">
        ${!hiredUser ? `<button class="btn-gold btn-md" data-action="app-hire" data-id="${a.id}">${icon('userAdd', 'ico-sm')}<span>Einstellen & Konto anlegen</span></button>` : ''}
        ${a.status !== 'abgelehnt' && !hiredUser ? `<button class="btn-outline btn-md" data-action="app-status" data-id="${a.id}" data-status="abgelehnt">Absagen</button>` : ''}
        ${isAdmin() ? `<button class="btn-danger btn-md" data-action="app-delete" data-id="${a.id}" data-number="${esc(a.number)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
      </div>

      <div class="section"><h3 class="section-title">Interne Notizen</h3>
        ${notes.length ? `<div class="timeline">${notes.map((n) => `<div class="tl-item"><div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span><span>${esc(fmtDate(n.createdAt))}</span></div><div class="tl-body">${esc(n.body)}</div></div>`).join('')}</div>` : '<p class="text-sm text-dim">Noch keine Notizen.</p>'}
        <form data-form="app-note" data-id="${a.id}" class="mt-3 space-y-3">
          <textarea name="body" rows="2" maxlength="3000" required class="field" placeholder="Eindruck aus dem Gespräch, Rückfragen …" aria-label="Interne Notiz"></textarea>
          <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Notiz speichern</span></button>
        </form>
      </div>`;
}

function hireModal(a) {
  // Vorschlag aus der Stellenbezeichnung (z. B. „Associate / Rechtsanwalt (m/w/d)“ → Associate)
  const rank = a.positionTitle.replace(/\s*\(m\/w\/d\)\s*/i, '').replace('Initiativbewerbung', 'Junior Associate').split('/')[0].trim();
  openModal(`
      <h2 class="modal-title">${esc(a.name)} einstellen</h2>
      <p class="modal-sub">Legt ein Login-Konto mit Einmal-Passwort an und auf Wunsch ein Profil im Bereich „Unser Team“ auf der Website.</p>
      <form data-form="app-hire" data-id="${a.id}" class="form-grid cols-2">
        <div class="span-2"><label class="label">E-Mail (Login)</label>${emailField('email', { value: emailLocalFromName(a.name), required: true, autofocus: true })}
          <p class="form-hint">Vorschlag aus dem Namen – frei änderbar. Kontakt-E-Mail aus der Bewerbung: ${esc(a.email || '—')}</p></div>
        <div><label class="label">Rang</label>${rankSelect('rank', RANKS.includes(rank) && (isAdmin() || RANKS.indexOf(rank) >= RANKS.indexOf(st.user.rank)) ? rank : '', { emptyLabel: '— ohne Rang (z. B. Assistenz) —' })}
          ${isAdmin() ? '' : `<p class="form-hint">Sie können bis zu Ihrem eigenen Rang (${esc(st.user.rank || '—')}) einstellen.</p>`}</div>
        <div><label class="label">Rolle im Dashboard</label><select name="role" class="field">${opt('anwalt', 'Anwalt / Mitarbeiter', true)}${isAdmin() ? opt('admin', 'Board of Partners (Admin)') : ''}</select></div>
        <div class="span-2"><label class="label">Kurzbeschreibung für die Website (optional)</label><textarea name="description" rows="2" maxlength="400" class="field"></textarea></div>
        <label class="check span-2"><input type="checkbox" name="createProfile" checked> Team-Profil anlegen</label>
        <label class="check span-2"><input type="checkbox" name="visible" checked> Sofort auf der Website anzeigen</label>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Einstellen</span></button><button type="button" class="btn-ghost btn-md" data-action="app-back" data-id="${a.id}">Zurück</button></div>
      </form>`);
}

function positionModal(p) {
  const v = p || { active: true };
  openModal(`
      <h2 class="modal-title">${p ? 'Stelle bearbeiten' : 'Neue Stelle ausschreiben'}</h2>
      <p class="modal-sub">Erscheint sofort auf der Karriereseite.</p>
      <form data-form="position" data-id="${p ? p.id : ''}" class="form-grid">
        <div><label class="label">Titel</label><input name="title" class="field" required minlength="2" maxlength="100" value="${esc(v.title || '')}" placeholder="z. B. Associate / Rechtsanwalt (m/w/d)" autofocus></div>
        <div><label class="label">Aufgaben</label><textarea name="description" rows="4" maxlength="1500" class="field">${esc(v.description || '')}</textarea></div>
        <div><label class="label">Anforderungen</label><textarea name="requirements" rows="3" maxlength="1500" class="field">${esc(v.requirements || '')}</textarea></div>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Ausgeschrieben (auf der Karriereseite sichtbar)</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Aktivitätsprotokoll */
function auditTable() {
  if (!st.audit.length) return empty(st.auditQuery ? 'Keine Einträge gefunden.' : 'Noch keine Einträge.', 'list');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Details</th></tr></thead>
      <tbody>${st.audit
      .map(
        (e) => `<tr>
          <td class="td-main text-xs text-dim nowrap">${esc(fmtDate(e.createdAt))}</td>
          <td data-label="Wer" class="font-medium">${esc(e.userName)}</td>
          <td data-label="Aktion">${esc(e.action)}</td>
          <td data-label="Details" class="text-sm text-muted" style="word-break:break-word">${esc(e.details || '—')}</td></tr>`
      )
      .join('')}</tbody></table></div>
      ${st.auditHasMore ? '<div class="text-center pt-4"><button class="btn-outline btn-md" data-action="audit-more">Ältere Einträge laden</button></div>' : ''}`;
}
async function loadAudit(append = false) {
  const params = new URLSearchParams();
  if (st.auditQuery) params.set('q', st.auditQuery);
  if (append && st.audit.length) params.set('before', st.audit[st.audit.length - 1].id);
  const r = await api.get('/api/admin/audit?' + params);
  st.audit = append ? st.audit.concat(r.entries) : r.entries;
  st.auditHasMore = r.hasMore;
}
views.audit = {
  async load() {
    await loadAudit();
  },
  render() {
    return `
        <div class="page-head"><div><h1 class="page-title">Aktivitätsprotokoll</h1><p class="page-sub">Wer hat wann was geändert – Akten, Rechnungen, Konten, Team, Bewerbungen und Anmeldungen.</p></div></div>
        <div class="toolbar"><label class="search">${icon('search')}<input id="auditSearch" class="field" type="search" placeholder="Name, Aktion oder Details …" value="${esc(st.auditQuery)}" aria-label="Protokoll durchsuchen"></label></div>
        <div id="auditList" class="panel p-2 md:p-3">${auditTable()}</div>`;
  },
};

