/*
 * Kanzlei-Dashboard – Teil 3 von 12: Ansichten: Übersicht, Akten, Globale Suche, Papierkorb, Aufgaben-Übersicht, Aktenkennzahlen.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Ansichten
   ================================================================ */
const views = {};

/* ---------------------------------------------------------------- Übersicht */
function upcomingEvents(limit = 6) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return st.events
    .filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff))
    .sort(byStart)
    .slice(0, limit);
}

function eventRow(e, { date = true } = {}) {
  const closed = e.status === 'erledigt' || e.status === 'abgesagt';
  const side = closed ? statusBadge(EVENT_STATUS, e.status) : `${e.status === 'angefragt' ? badge('Anfrage', 'amber') : ''}${countdownHtml(e)}`;
  const meta = [EVENT_TYPES[e.type], `${date ? fmtDay(e.startsAt) + ', ' : ''}${fmtTime(e.startsAt)} Uhr`, e.caseNumber, isStaff() ? e.assignedName : null]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  return `<button type="button" class="ev-row ${closed ? 'ev-done' : ''}" data-action="open-event" data-id="${e.id}">
      <span class="ev-bar ev-bg-${esc(e.type)}"></span>
      <span class="ev-main"><span class="ev-title">${esc(e.title)}</span><span class="ev-meta">${meta}</span></span>
      <span class="ev-side">${side}</span></button>`;
}

/** Kanzlei: Priorität; Mandant: seine angegebene Dringlichkeit (nur wenn nicht „Normal“). */
function caseLevelText(c) {
  if (isStaff()) return PRIORITY[c.priority] ? ` · ${esc(PRIORITY[c.priority][2])}` : '';
  return c.urgency !== 'normal' && URGENCY[c.urgency] ? ` · ${esc(URGENCY[c.urgency][0])}` : '';
}
/** Badge neben der Akte: Kanzlei sieht nur die Priorität, der Mandant seine Dringlichkeit. */
const caseLevelBadge = (c) => (isStaff() ? priorityBadge(c) : c.urgency !== 'normal' && URGENCY[c.urgency] ? badge(...URGENCY[c.urgency]) : '');

function caseListRow(c, extra = '') {
  return `<div class="list-row" data-action="open-case" data-id="${c.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(c.title)}</div>
        <div class="meta"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.clientName)}${caseLevelText(c)}</div></div>
      <div class="flex items-center gap-2 shrink-0">${extra || statusBadge(CASE_STATUS, c.status)}</div></div>`;
}

function kpi(label, value, sub, ico, href) {
  return `<a href="${href}" class="panel kpi block">
      <div class="kpi-label">${icon(ico, 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></a>`;
}
function kpiEvent(label, e) {
  if (!e) {
    return `<a href="#calendar" class="panel kpi block"><div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
        <div class="kpi-value" style="color:var(--text-dim)">—</div><div class="kpi-sub">Nichts geplant</div></a>`;
  }
  return `<button type="button" class="panel kpi block w-full text-left" data-action="open-event" data-id="${e.id}">
      <div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value" style="font-size:clamp(1.15rem,3.4vw,1.55rem)">${esc(e.title)}</div>
      <div class="kpi-sub">${esc(fmtDay(e.startsAt))}, ${esc(fmtTime(e.startsAt))} Uhr</div>${countdownHtml(e)}</button>`;
}

function dutyStrip() {
  const list = st.duty?.onDuty || [];
  if (!isStaff()) {
    return list.length
      ? `<div class="banner banner-gold items-center"><span class="duty-dot s-dienst"></span><div>Die Kanzlei ist gerade erreichbar: <strong>${list.length} ${list.length === 1 ? 'Anwalt' : 'Anwälte'} im Dienst</strong>.</div></div>`
      : '';
  }
  return `<section class="panel duty-strip">
      <span class="text-[0.7rem] uppercase tracking-widest text-dim">Jetzt im Dienst</span>
      ${list.length
      ? list.map((m) => `<span class="duty-chip">${avatarWrap(m.avatarUrl, m.name, m.status, 'xs')}<span>${esc(m.name)}</span><span class="st">${esc(m.statusLabel)}</span></span>`).join('')
      : '<span class="text-sm text-dim">Niemand – der Eilnotdienst ist gerade nicht besetzt.</span>'}
      <span class="ml-auto flex gap-2">${myDutyStatus() === 'off'
      ? `<button class="btn-gold btn-sm" data-action="duty-set" data-status="dienst"><span class="duty-dot s-dienst"></span><span>Dienst beginnen</span></button>`
      : `<button class="btn-outline btn-sm" data-action="duty-set" data-status="off">Dienst beenden</button>`}</span>
    </section>`;
}

/** Überfällige/heute fällige eigene Aufgaben und eigene Akten ohne Bewegung – nur wenn es etwas zu tun gibt. */
const STALE_DAYS = 7;
function attentionPanel() {
  const me = st.user.id;
  const overdue = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0);
  const today = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) === 0);
  const stale = st.cases.filter((c) => {
    const d = parseDate(c.updatedAt);
    return c.status === 'in_bearbeitung' && onCase(c, me) && d && -daysUntil(dayKey(d)) >= STALE_DAYS;
  });
  if (!overdue.length && !today.length && !stale.length) return '';
  const due = [...overdue, ...today];
  return `<section class="panel panel-pad attention mb-4 lg:mb-5">
      <div class="panel-head"><h2 class="panel-title">Handlungsbedarf</h2>
        <div class="flex flex-wrap gap-2">${overdue.length ? badge(`${overdue.length} überfällig`, 'red') : ''}${today.length ? badge(`${today.length} heute fällig`, 'amber') : ''}${stale.length ? badge(`${stale.length} ruhende Akte${stale.length === 1 ? '' : 'n'}`, 'slate') : ''}</div></div>
      ${due.length ? `<div class="task-list">${due.slice(0, 5).map((t) => taskItem(t)).join('')}</div>` : ''}
      ${due.length > 5 ? `<a href="#tasks" class="btn-ghost btn-sm mt-2">Alle ${due.length} fälligen Aufgaben anzeigen</a>` : ''}
      ${stale.length ? `<div class="${due.length ? 'mt-4' : ''}"><div class="text-xs uppercase tracking-widest text-dim mb-1">Ihre Akten seit ${STALE_DAYS}+ Tagen ohne Bewegung</div>
        ${stale.slice(0, 4).map((c) => caseListRow(c, badge(relDays(c.updatedAt), 'slate'))).join('')}</div>` : ''}
    </section>`;
}

views.overview = {
  async load() {
    await Promise.all([
      load.cases(),
      load.events(),
      load.invoices(),
      load.board(),
      load.unread(),
      load.duty(),
      load.myTasks(),
      isStaff() ? api.get('/api/absences').then((r) => (st.absences = r)) : null,
      isAdmin() ? api.get('/api/admin/alerts').then((r) => (st.alerts = r.alerts), () => (st.alerts = [])) : null,
    ]);
  },
  render() {
    const u = st.user;
    const staff = isStaff();
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const active = st.cases.filter((c) => c.status !== 'geschlossen');
    const upcoming = upcomingEvents(6);
    const nextDeadline = upcomingEvents(50).find((e) => e.status === 'bestaetigt' && (e.type === 'frist' || e.type === 'gericht'));
    const openInvoices = st.invoices.filter((i) => i.status === 'offen');
    const openSum = openInvoices.reduce((s, i) => s + i.total, 0);

    const banner = [
      ...(isAdmin() ? st.alerts : []).map(
        (a) => `<div class="banner banner-red">${icon('alert')}<div><strong>Systemwarnung: ${esc(a.title)}</strong> <span class="opacity-80">(seit ${esc(fmtDate(a.since))})</span>${a.description ? `<br>${esc(a.description)}` : ''}</div></div>`
      ),
      u.emailNotice
        ? `<div class="banner banner-gold items-center justify-between flex-wrap"><div>${icon('mail')} <strong>Ihre Login-E-Mail lautet jetzt ${esc(u.email)}</strong>${u.emailNotice.oldEmail ? ` (vorher ${esc(u.emailNotice.oldEmail)})` : ''}. Alle Konten der Kanzlei enden auf @${EMAIL_DOMAIN}. Ihr Passwort bleibt gleich – die alte Adresse funktioniert beim Login weiterhin.</div><button class="btn-outline btn-sm" data-action="email-notice-ok">Verstanden</button></div>`
        : '',
      !staff && st.cases.some((c) => c.status === 'geschlossen' && !c.reviewed)
        ? (() => {
            const c = st.cases.find((x) => x.status === 'geschlossen' && !x.reviewed);
            return `<div class="banner banner-gold items-center justify-between flex-wrap"><div>${icon('star')} <strong>Wie zufrieden waren Sie mit uns?</strong> Ihre Akte ${esc(c.caseNumber)} ist abgeschlossen – über eine kurze Bewertung freuen wir uns.</div><button class="btn-outline btn-sm" data-action="open-case" data-id="${c.id}">Jetzt bewerten</button></div>`;
          })()
        : '',
      u.mustChangePassword
        ? `<div class="banner banner-amber">${icon('alert')}<div><strong>Bitte eigenes Passwort festlegen.</strong> Sie nutzen ein automatisch erzeugtes oder zurückgesetztes Passwort. <a href="#profile" class="underline">Jetzt ändern</a></div></div>`
        : '',
    ].join('');

    const kpis = staff
      ? [
          kpi('Neue Anfragen', active.filter((c) => c.status === 'offen').length, `${active.filter((c) => !c.lawyerId).length} ohne Anwalt`, 'folder', '#cases'),
          kpi('In Bearbeitung', active.filter((c) => c.status === 'in_bearbeitung').length, `${active.filter((c) => onCase(c, u.id)).length} davon bei Ihnen`, 'briefcase', '#cases'),
          kpiEvent('Nächste Frist / Termin', nextDeadline),
          kpi('Kanzlei-Post', st.unread, st.unread === 1 ? 'ungelesene Nachricht' : 'ungelesene Nachrichten', 'mail', '#mail'),
        ]
      : [
          kpi('Meine Akten', active.length, 'laufende Mandate', 'folder', '#cases'),
          kpiEvent('Nächster Termin', upcoming[0]),
          kpi('Kanzlei-Post', st.unread, 'ungelesen', 'mail', '#mail'),
          kpi('Offene Rechnungen', money(openSum), `${openInvoices.length} Dokument(e)`, 'receipt', '#invoices'),
        ];

    const eventsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Fristen & Termine' : 'Ihre Termine'}</h2><a href="#calendar" class="btn-ghost btn-sm">Alle anzeigen</a></div>
          ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : empty('Keine anstehenden Termine.', 'calendar')}
        </section>`;

    const recent = st.cases.slice(0, 5);
    const recentPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Zuletzt bearbeitet' : 'Meine Akten'}</h2><a href="#cases" class="btn-ghost btn-sm">Alle Akten</a></div>
          ${recent.length ? recent.map((c) => caseListRow(c)).join('') : empty(staff ? 'Noch keine Akten.' : 'Sie haben noch kein Mandat eingereicht.', 'folder')}
          ${!staff ? `<div class="form-actions mt-4"><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Mandat einreichen</span></button><button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button><button class="btn-outline btn-md" data-action="compose">${icon('mail', 'ico-sm')}<span>Nachricht an die Kanzlei</span></button></div>` : ''}
        </section>`;

    const head = `
        ${banner}
        <div class="page-head">
          <div><p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">${esc(today)}</p>
            <h1 class="page-title">${esc(greet)}, ${esc(u.displayName)}</h1>
            <p class="page-sub">${esc(u.rank || ROLES[u.role])} · Pake &amp; Scha Legal Consulting</p></div>
          <div class="page-actions"><button class="btn-outline btn-md" data-action="concern-new">${icon('chat', 'ico-sm')}<span>Anliegen ans Board</span></button>${staff ? `<button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Neue Akte</span></button>` : ''}</div>
        </div>
        ${dutyStrip()}
        ${absenceStrip()}
        <div class="kpi-grid">${kpis.join('')}</div>`;

    if (!staff) return `${head}<div class="grid-2">${eventsPanel}${recentPanel}</div>`;

    const unassigned = active.filter((c) => !c.lawyerId).slice(0, 5);
    const pinned = st.board.filter((n) => n.pinned).slice(0, 3);
    const requestsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Neue Mandatsanfragen</h2>${unassigned.length ? badge(`${unassigned.length} offen`, 'amber') : ''}</div>
          ${unassigned.length ? unassigned.map((c) => caseListRow(c, `<button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Übernehmen</button>`)).join('') : empty('Alle Anfragen sind vergeben.', 'check')}
        </section>`;
    const boardPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Pinnwand</h2><a href="#board" class="btn-ghost btn-sm">Zur Pinnwand</a></div>
          ${pinned.length ? pinned.map((n) => `<div class="tl-item mb-2" style="border-left:3px solid ${NOTE_COLORS[n.color] || NOTE_COLORS.gold}"><div class="tl-meta"><strong class="text-muted">${esc(n.title || 'Notiz')}</strong> · ${esc(n.authorName)}</div><div class="tl-body">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div></div>`).join('') : empty('Keine angehefteten Notizen.', 'pin')}
        </section>`;

    return `${head}
        ${attentionPanel()}
        <div class="grid-2">${requestsPanel}${eventsPanel}</div>
        <div class="grid-2 mt-4 lg:mt-5">${recentPanel}${boardPanel}</div>`;
  },
};

/* ---------------------------------------------------------------- Akten */
function filteredCases() {
  const q = st.caseQuery.trim().toLowerCase();
  // Ein eingefügter FiveNet-/Google-Docs-Link oder eine Dokument-ID findet die Akten, mit denen das Dokument verknüpft ist.
  const extId = q ? externalIdFrom(st.caseQuery) : null;
  return st.cases.filter((c) => {
    const f = st.caseFilter;
    const stateOk = f === 'alle' || (f === 'aktiv' ? c.status !== 'geschlossen' : c.status === f);
    const mineOk = !st.caseMine || onCase(c);
    const textOk =
      !q ||
      [c.caseNumber, c.title, c.clientName, c.lawyerName, ...(c.coLawyers || []).map((l) => l.name), c.courtRef, c.opponent].join(' ').toLowerCase().includes(q) ||
      // Google-Sheets-IDs tragen ggf. das Tabellenblatt (#gid=…) – gefunden wird jede Verknüpfung der Tabelle.
      (!!extId && (c.externalDocIds || []).some((x) => x.split('#')[0] === extId));
    return stateOk && mineOk && textOk;
  });
}
function caseCount(f) {
  return st.cases.filter((c) => f === 'alle' || (f === 'aktiv' ? c.status !== 'geschlossen' : c.status === f)).length;
}
/** VIP / Lifetime des Mandanten als Badge. */
function memberBadge(m) {
  if (!m) return '';
  return m.kind === 'perma' ? badge('👑 Lifetime', 'gold') : badge(`⭐ ${m.name}`, 'sky');
}
// Offene Akten von Lifetime- und VIP-Mandanten stehen oben (sonst bleibt die Reihenfolge)
const memberRank = (c) => (c.status === 'geschlossen' || !c.membership ? 0 : c.membership.kind === 'perma' ? 2 : 1);
/** Prioritäts-Badge (nur Kanzlei), z. B. „Hohe Priorität“ mit Stufen-Anzeige. */
function priorityBadge(c) {
  const p = PRIORITY[c.priority] ? c.priority : 2;
  const [, color, text] = PRIORITY[p];
  const bars = [1, 2, 3, 4].map((i) => `<i class="${i <= p ? 'on' : ''}"></i>`).join('');
  return `<span class="badge badge-${color} prio-badge"><span class="prio-bars" aria-hidden="true">${bars}</span>${esc(text)}</span>`;
}
const caseTime = (c, key) => parseDate(c[key])?.getTime() || 0;
const URGENCY_RANK = { normal: 0, eilig: 1, notfall: 2 };

/** Sortierung der Aktenliste (Auswahl über der Liste, wird im Browser gemerkt). */
function sortCases(list) {
  const mode = st.caseSort === 'prioritaet' && !isStaff() ? 'aktualisiert' : st.caseSort;
  const byUpdated = (a, b) => caseTime(b, 'updatedAt') - caseTime(a, 'updatedAt');
  const sorters = {
    aktualisiert: (a, b) => memberRank(b) - memberRank(a) || byUpdated(a, b),
    // Offene Akten vor geschlossenen, dann Priorität, Dringlichkeit, VIP/Lifetime, zuletzt geändert
    prioritaet: (a, b) =>
      (a.status === 'geschlossen') - (b.status === 'geschlossen') ||
      (b.priority || 2) - (a.priority || 2) ||
      URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] ||
      memberRank(b) - memberRank(a) ||
      byUpdated(a, b),
    neueste: (a, b) => caseTime(b, 'createdAt') - caseTime(a, 'createdAt'),
    aelteste: (a, b) => caseTime(a, 'createdAt') - caseTime(b, 'createdAt'),
  };
  return list.sort(sorters[mode] || sorters.aktualisiert);
}

function caseTable() {
  const rows = sortCases(filteredCases());
  const staff = isStaff();
  if (!rows.length) {
    return empty(st.cases.length ? 'Keine Akten für diese Auswahl.' : staff ? 'Noch keine Akten angelegt.' : 'Sie haben noch kein Mandat eingereicht.', 'folder');
  }
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Akte</th>${staff ? '<th>Mandant</th>' : ''}<th>Zuständig</th>${staff ? '<th>Priorität</th>' : ''}<th>Status</th><th>Aktualisiert</th></tr></thead>
      <tbody>${rows
      .map(
        (c) => `<tr class="row" data-action="open-case" data-id="${c.id}">
          <td class="td-main"><div class="font-mono text-gold text-xs">${esc(c.caseNumber)}</div><div class="font-medium">${esc(c.title)}${c.chatUnread ? ` <span class="chat-new" title="Neue Nachrichten">${icon('chat', 'ico-sm')}${c.chatUnread}</span>` : ''}</div>
            <div class="text-xs text-dim mt-1 flex flex-wrap items-center gap-2">${esc(AREAS[c.area] || c.area)}${staff ? '' : caseLevelBadge(c)}</div></td>
          ${staff ? `<td data-label="Mandant">${esc(c.clientName)}${c.membership ? `<div class="mt-1">${memberBadge(c.membership)}</div>` : ''}</td>` : ''}
          <td data-label="Zuständig">${c.lawyerName ? `${esc(c.lawyerName)}${(c.coLawyers || []).length ? `<div class="text-xs text-dim">+ ${esc(c.coLawyers.map((l) => l.name).join(', '))}</div>` : ''}` : badge('Unbesetzt', 'amber')}</td>
          ${staff ? `<td data-label="Priorität">${priorityBadge(c)}</td>` : ''}
          <td data-label="Status">${statusBadge(CASE_STATUS, c.status)}</td>
          <td data-label="Aktualisiert" class="text-dim text-xs nowrap">${esc(fmtDate(c.updatedAt))}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- Globale Suche (Strg + K) */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_MOD = IS_MAC ? '⌘' : 'Strg';
$$('.topbar-search kbd').forEach((k) => (k.textContent = `${KEY_MOD} K`));
$$('.topbar-search').forEach((b) => (b.title = `Suchen (${KEY_MOD} + K)`));
const GS_GROUPS = [
  ['cases', 'Akten', 'folder'],
  ['clients', 'Mandanten', 'user'],
  ['invoices', 'Rechnungen', 'receipt'],
  ['tasks', 'Aufgaben', 'tasks'],
  ['events', 'Termine & Fristen', 'calendar'],
  ['messages', 'Kanzlei-Post', 'mail'],
];
/** Treffer hervorheben – Text und Treffer werden einzeln escaped. */
function hl(text, q) {
  const s = String(text ?? '');
  if (!q) return esc(s);
  const lower = s.toLowerCase();
  const needle = q.toLowerCase();
  let out = '';
  let i = 0;
  let j;
  while (needle && (j = lower.indexOf(needle, i)) !== -1) {
    out += `${esc(s.slice(i, j))}<mark>${esc(s.slice(j, j + needle.length))}</mark>`;
    i = j + needle.length;
  }
  return out + esc(s.slice(i));
}
function gsItem(type, x, q) {
  const line = (title, meta) => `<span class="main"><span class="title">${title}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</span>`;
  const ico = icon(GS_GROUPS.find((g) => g[0] === type)[2]);
  let body = '';
  if (type === 'cases')
    body = line(`<span class="font-mono text-gold">${hl(x.caseNumber, q)}</span> · ${hl(x.title, q)}`, [hl(x.clientName, q), esc(CASE_STATUS[x.status] ? CASE_STATUS[x.status][0] : x.status), x.opponent ? `Gegenpartei: ${hl(x.opponent, q)}` : '', x.courtRef ? hl(x.courtRef, q) : ''].filter(Boolean).join(' · '));
  else if (type === 'clients')
    body = line(`${hl(x.name, q)}${x.active ? '' : ' <span class="text-dim">(gesperrt)</span>'}`, [hl(x.email, q), x.phone ? hl(x.phone, q) : '', `${x.caseCount} ${x.caseCount === 1 ? 'Akte' : 'Akten'}`].filter(Boolean).join(' · '));
  else if (type === 'invoices')
    body = line(`<span class="font-mono text-gold">${hl(x.number, q)}</span> · ${esc(money(x.total))}`, [hl(x.clientName, q), x.subject ? hl(x.subject, q) : '', x.overdueDays > 0 ? overdueText(x) : esc(INVOICE_STATUS[x.status] ? INVOICE_STATUS[x.status][0] : x.status), x.caseNumber ? esc(x.caseNumber) : ''].filter(Boolean).join(' · '));
  else if (type === 'tasks')
    body = line(`${x.done ? '✓ ' : ''}${hl(x.title, q)}`, [x.dueDate ? `fällig ${esc(fmtDateOnly(x.dueDate))}` : 'ohne Datum', x.assignedName ? esc(x.assignedName) : '', x.caseNumber ? esc(x.caseNumber) : '', x.done ? 'erledigt' : ''].filter(Boolean).join(' · '));
  else if (type === 'events')
    body = line(hl(x.title, q), [esc(fmtDate(x.startsAt)), esc(EVENT_TYPES[x.type] || x.type), x.location ? hl(x.location, q) : '', x.caseNumber ? esc(x.caseNumber) : ''].filter(Boolean).join(' · '));
  else if (type === 'messages')
    body = line(hl(x.subject || '(ohne Betreff)', q), [x.box === 'inbox' ? `von ${esc(x.senderName)}` : `an ${esc(x.recipientName)}`, esc(fmtDate(x.createdAt)), hl(x.preview, q)].filter(Boolean).join(' · '));
  return `<button type="button" class="gs-item" data-action="gs-open" data-type="${type}" data-id="${x.id}">${ico}${body}</button>`;
}
function renderSearchResults() {
  const box = $('#gsResults');
  if (!box) return;
  const q = st.gsQuery.trim();
  if (q.length < 2) {
    box.innerHTML = `<p class="gs-hint">${isStaff() ? 'Aktenzeichen, Namen, Rechnungsnummern, Termine, Aufgaben oder Nachrichten – auch FiveNet- und Google-Links.' : 'Aktenzeichen, Rechnungsnummern, Termine oder Nachrichten.'}</p>`;
    return;
  }
  const r = st.gsResults || {};
  const html = GS_GROUPS.filter(([k]) => (r[k] || []).length)
    .map(([k, label]) => `<div class="gs-group">${esc(label)}</div>${r[k].map((x) => gsItem(k, x, q)).join('')}`)
    .join('');
  box.innerHTML = html || `<p class="gs-hint">${st.gsLoading ? 'Suche …' : `Keine Treffer für „${esc(q)}“.`}</p>`;
  st.gsActive = 0;
  markSearchActive();
}
function markSearchActive() {
  const items = $$('#gsResults .gs-item');
  items.forEach((el, i) => el.classList.toggle('active', i === st.gsActive));
  if (items[st.gsActive]) items[st.gsActive].scrollIntoView({ block: 'nearest' });
}
async function runSearch() {
  const q = st.gsQuery.trim();
  const token = ++st.gsToken;
  if (q.length < 2) {
    st.gsResults = null;
    renderSearchResults();
    return;
  }
  st.gsLoading = true;
  try {
    const res = await api.get('/api/search?q=' + encodeURIComponent(q));
    if (token !== st.gsToken) return; // inzwischen weitergetippt
    st.gsResults = res.results;
  } finally {
    if (token === st.gsToken) st.gsLoading = false;
  }
  renderSearchResults();
}
function openSearch() {
  st.gsQuery = st.gsQuery || '';
  openModal(`
      <h2 class="modal-title">Suchen</h2>
      <label class="search mt-2">${icon('search')}<input id="gsInput" class="field" type="search" placeholder="${isStaff() ? 'Akten, Mandanten, Rechnungen, Termine …' : 'Akten, Rechnungen, Termine …'}" value="${esc(st.gsQuery)}" autocomplete="off" aria-label="Suchbegriff" autofocus></label>
      <div id="gsResults" class="gs-results" role="listbox" aria-label="Suchergebnisse"></div>
      <div class="gs-foot hidden md:flex"><span><kbd>↑</kbd> <kbd>↓</kbd> auswählen</span><span><kbd>Enter</kbd> öffnen</span><span><kbd>Esc</kbd> schließen</span><span><kbd>${KEY_MOD}</kbd> <kbd>K</kbd> Suche öffnen</span></div>`);
  const input = $('#gsInput');
  input.focus();
  input.select();
  if (st.gsQuery.trim().length >= 2) runSearch().catch(handleError);
  else renderSearchResults();
}
async function openSearchResult(type, id) {
  const list = (st.gsResults && st.gsResults[type]) || [];
  const x = list.find((r) => r.id === id);
  if (!x) return;
  if (type === 'cases') return modalInstead(() => openCase(id));
  if (type === 'clients') {
    // Akten des Mandanten in der Aktenverwaltung
    st.caseQuery = x.name;
    st.caseFilter = 'alle';
    st.caseMine = false;
    closeModal();
    return navigate('cases');
  }
  if (type === 'invoices') {
    if (x.caseId) return modalInstead(() => openCase(x.caseId));
    closeModal();
    window.open(`/invoice.html?id=${x.id}`, '_blank', 'noopener');
    return;
  }
  if (type === 'tasks') {
    if (!st.myTasks.some((t) => t.id === x.id) && !st.tasks.some((t) => t.id === x.id)) st.tasks = [x, ...st.tasks];
    st.returnCase = null;
    await Promise.all([load.lawyers(), load.cases()]);
    return modalInstead(() => taskModal(x));
  }
  if (type === 'events') {
    st.eventCache.set(x.id, x);
    return modalInstead(() => openEvent(x.id));
  }
  if (type === 'messages') {
    st.mailBox = x.box;
    st.mailSel = x.id;
    closeModal();
    await navigate('mail');
    // gelesen markieren wie beim Anklicken in der Liste
    const m = st.messages.find((n) => n.id === x.id);
    if (m && x.box === 'inbox' && !m.isRead) {
      m.isRead = true;
      st.unread = Math.max(0, st.unread - 1);
      api.patch('/api/messages/' + m.id, { isRead: true }).catch(() => {});
      renderView();
    }
  }
}

/* ---------------------------------------------------------------- Papierkorb (gelöschte Akten, nur Admins) */
function trashHtml(t) {
  return `
      <h2 class="modal-title">Papierkorb</h2>
      <p class="modal-sub">Gelöschte Akten bleiben ${t.keepDays} Tage hier und lassen sich vollständig wiederherstellen – mit Notizen, Aufgaben, Anhängen, Verträgen und Bearbeitungszeiten; Termine und Rechnungen bekommen ihren Aktenbezug zurück. Danach werden sie endgültig gelöscht.</p>
      ${
      t.items.length
        ? t.items
            .map(
              (x) => `<div class="list-row wrap flex-col sm:flex-row"><div class="main"><div class="title"><span class="font-mono text-gold">${esc(x.caseNumber)}</span> · ${esc(x.title)}</div>
                  <div class="meta">${esc(x.clientName)} · gelöscht ${esc(fmtDate(x.deletedAt))}${x.deletedBy ? ` von ${esc(x.deletedBy)}` : ''} · endgültig weg am ${esc(fmtDate(x.purgeAt))}</div></div>
                  <div class="flex flex-wrap gap-2 shrink-0"><button type="button" class="btn-outline btn-sm" data-action="trash-restore" data-id="${x.id}" data-number="${esc(x.caseNumber)}">${icon('restore', 'ico-sm')}<span>Wiederherstellen</span></button>
                  <button type="button" class="btn-ghost btn-sm fn-danger" data-action="trash-purge" data-id="${x.id}" data-number="${esc(x.caseNumber)}">${icon('trash', 'ico-sm')}<span>Endgültig löschen</span></button></div></div>`
            )
            .join('')
        : empty('Der Papierkorb ist leer.', 'trash')
    }
      <div class="form-actions mt-4"><button type="button" class="btn-ghost btn-md" data-action="close-modal">Schließen</button></div>`;
}
async function openTrash(replace = false) {
  const t = await api.get('/api/cases/trash');
  (replace ? replaceModal : openModal)(trashHtml(t));
}

views.cases = {
  async load() {
    await Promise.all([load.cases(), load.lawyers()]);
  },
  render() {
    const staff = isStaff();
    const filters = [['aktiv', 'Aktiv'], ['offen', 'Offen'], ['in_bearbeitung', 'In Bearbeitung'], ['geschlossen', 'Geschlossen'], ['alle', 'Alle']];
    return `
        <div class="page-head">
          <div><h1 class="page-title">${staff ? 'Aktenverwaltung' : 'Meine Akten'}</h1>
            <p class="page-sub">${staff ? 'Alle Mandate der Kanzlei – Aktenzeichen, Mandanten, Status, Notizen und Verlauf.' : 'Ihre Mandate bei Pake & Scha. Tippen Sie auf eine Akte für Details.'}</p></div>
          <div class="page-actions">${isAdmin() ? `<button class="btn-ghost btn-md" data-action="case-trash">${icon('trash')}<span>Papierkorb</span></button>` : ''}<button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>${staff ? 'Neue Akte' : 'Mandat einreichen'}</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="caseSearch" class="field" type="search" placeholder="${staff ? 'Aktenzeichen, Mandant, FiveNet-/Docs-Link …' : 'Aktenzeichen, Titel …'}" value="${esc(st.caseQuery)}" aria-label="Akten durchsuchen"></label>
          <div class="chip-row">
            ${filters.map(([k, l]) => `<button class="chip ${st.caseFilter === k ? 'active' : ''}" data-action="case-filter" data-value="${k}">${l} <span class="chip-count">${caseCount(k)}</span></button>`).join('')}
            ${staff ? `<button class="chip ${st.caseMine ? 'active' : ''}" data-action="case-mine">${icon('user', 'ico-sm')}Nur meine</button>` : ''}
          </div>
        </div>
        <div class="list-bar"><label class="case-sort"><span>Sortieren</span><select id="caseSort" class="field" aria-label="Akten sortieren">${Object.entries(CASE_SORTS)
        .filter(([k]) => staff || k !== 'prioritaet')
        .map(([k, l]) => opt(k, l, st.caseSort === k))
        .join('')}</select></label></div>
        <div id="caseList" class="panel p-2 md:p-3">${caseTable()}</div>`;
  },
};

/* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen (Übersicht) */
function filteredTasks() {
  const q = st.taskQuery.trim().toLowerCase();
  return st.tasks.filter((t) => !q || [t.title, t.note, t.caseNumber, t.caseTitle, t.assignedName].join(' ').toLowerCase().includes(q));
}
function taskList() {
  const list = filteredTasks();
  if (!list.length) {
    const msg = st.tasks.length
      ? 'Keine Aufgaben für diese Suche.'
      : st.taskState === 'done'
        ? 'Noch keine erledigten Aufgaben.'
        : st.taskScope === 'mine'
          ? 'Keine offenen Aufgaben – alles erledigt.'
          : 'Keine offenen Aufgaben im Team.';
    return empty(msg, 'tasks');
  }
  if (st.taskState === 'done') return `<div class="task-list">${list.map((t) => taskItem(t)).join('')}</div>`;
  const bucket = (t) => {
    if (!t.dueDate) return 'none';
    const d = daysUntil(t.dueDate);
    return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
  };
  const groups = [['overdue', 'Überfällig'], ['today', 'Heute'], ['week', 'Nächste 7 Tage'], ['later', 'Später'], ['none', 'Ohne Datum']];
  return groups
    .map(([key, label]) => {
      const items = list.filter((t) => bucket(t) === key);
      if (!items.length) return '';
      return `<h3 class="task-group ${key === 'overdue' ? 'is-overdue' : ''}">${esc(label)} <span>${items.length}</span></h3><div class="task-list">${items.map((t) => taskItem(t)).join('')}</div>`;
    })
    .join('');
}

views.tasks = {
  async load() {
    await Promise.all([load.tasks(), load.lawyers(), load.cases(), load.dueTasks()]);
  },
  render() {
    return `
        <div class="page-head">
          <div><h1 class="page-title">Aufgaben & Wiedervorlagen</h1>
            <p class="page-sub">Was ist zu tun, bis wann und von wem – mit oder ohne Aktenbezug. Fällige Aufgaben erscheinen in der Übersicht unter „Handlungsbedarf“.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="task-new">${icon('plus')}<span>Neue Aufgabe</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="taskSearch" class="field" type="search" placeholder="Aufgabe, Aktenzeichen, Person …" value="${esc(st.taskQuery)}" aria-label="Aufgaben durchsuchen"></label>
          <div class="chip-row">
            <button class="chip ${st.taskScope === 'mine' ? 'active' : ''}" data-action="task-scope" data-value="mine">${icon('user', 'ico-sm')}Meine</button>
            <button class="chip ${st.taskScope === 'all' ? 'active' : ''}" data-action="task-scope" data-value="all">${icon('users', 'ico-sm')}Ganzes Team</button>
            <button class="chip ${st.taskState === 'open' ? 'active' : ''}" data-action="task-state" data-value="open">Offen</button>
            <button class="chip ${st.taskState === 'done' ? 'active' : ''}" data-action="task-state" data-value="done">Erledigt</button>
          </div>
        </div>
        <div id="taskList" class="panel panel-pad">${taskList()}</div>`;
  },
};

function rememberCase(data) {
  (data.appointments || []).forEach((e) => st.eventCache.set(e.id, e));
  st.caseAttachments = data.attachments || [];
  st.caseDocs = data.externalDocs || [];
  st.caseContracts = data.contracts || [];
  st.caseTasks = data.tasks || [];
  st.caseInfo = data.case;
}
async function openCase(id) {
  await load.lawyers();
  const data = await api.get('/api/cases/' + id);
  // Erst öffnen (ein vorheriges Fenster wird samt seinem Zustand beiseitegelegt), dann die Akte merken
  openModal(caseDetail(data), { wide: true, key: `case:${id}`, reopen: () => openCase(id) });
  rememberCase(data);
  st.modalCaseId = id;
  initChat(data);
}
async function reloadCase(id) {
  const data = await api.get('/api/cases/' + id);
  rememberCase(data);
  if (st.modalCaseId === id) {
    // Angefangene Nachricht und Chat-Position bleiben beim Neuzeichnen erhalten
    const draft = $('#modalBody .chat-input')?.value || '';
    replaceModal(caseDetail(data));
    if (draft && $('#modalBody .chat-input')) $('#modalBody .chat-input').value = draft;
    initChat(data);
  }
  refreshBehind();
}

function attachmentsSection(c, attachments) {
  const staff = isStaff();
  const canUpload = staff || !c.closed;
  return `<div class="section" id="secEvidence">
      <h3 class="section-title">Beweismittel & Anhänge <span class="text-xs text-dim font-normal" style="font-family:Inter,sans-serif">${attachments.length} / 40</span></h3>
      ${canUpload ? `<div class="flex flex-wrap items-center gap-3 mb-3">
          <input id="attCaption" class="field" style="max-width:340px" maxlength="200" placeholder="Beschreibung für neue Bilder (optional)" aria-label="Beschreibung für neue Bilder">
          ${staff ? '<label class="check"><input type="checkbox" id="attInternal" checked> Nur intern (für den Mandanten unsichtbar)</label>' : ''}
        </div>` : ''}
      <div class="att-grid">
        ${attachments
        .map(
          (a, i) => `<button type="button" class="att" data-action="att-open" data-index="${i}" aria-label="${esc(a.caption || 'Anhang ansehen')}">
              <img src="${esc(a.url)}" alt="${esc(a.caption)}" loading="lazy">
              <span class="tag">${a.internal ? badge('intern', 'amber') : ''}${a.externalDocId ? badge(extOf(st.caseDocs.find((d) => d.id === a.externalDocId) || {}).name, 'sky') : ''}</span>${a.caption ? `<span class="cap">${esc(a.caption)}</span>` : ''}</button>`
        )
        .join('')}
        ${canUpload && attachments.length < 40
        ? `<label class="att-add file-btn">${icon('camera')}<span>Bilder hinzufügen</span><input type="file" accept="image/*" multiple data-upload="evidence" data-case-id="${c.id}" aria-label="Bilder hinzufügen"></label>`
        : ''}
      </div>
      ${!attachments.length && !canUpload ? '<p class="text-sm text-dim">Keine Anhänge.</p>' : ''}
    </div>`;
}

/* ---------------------------------------------------------------- Aktenübersicht (Kennzahlen im Aktenkopf) */
function caseStats(c, { appointments, attachments, externalDocs, tasks }) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const next = appointments
    .filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff))
    .sort(byStart)[0];
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0).length;
  const pill = (label, value, target, extra = '') =>
    `<button type="button" class="stat-pill" data-action="scroll-to" data-target="${target}"><span class="k">${esc(label)}</span><span class="v">${value}</span>${extra}</button>`;
  return `<div class="case-stats mb-5">
      ${pill('Nächste Frist / Termin', next ? esc(next.title) : '<span class="text-dim">keine</span>', 'secEvents', next ? countdownHtml(next) : '')}
      ${pill('Aufgaben', open.length ? `${open.length} offen` : '<span class="text-dim">keine offen</span>', 'secTasks', overdue ? `<span class="countdown cd-over">${overdue} überfällig</span>` : '')}
      ${pill('Externe Dokumente', String(externalDocs.length), 'secExternal')}
      ${pill('Beweismittel', String(attachments.length), 'secEvidence')}
      ${pill('Letzte Aktivität', esc(relDays(c.updatedAt)), 'secNotes')}
    </div>`;
}
