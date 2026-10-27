/*
 * Kanzlei-Dashboard – Teil 3 von 14: Ansichten: Übersicht, Akten, Globale Suche, Papierkorb, Aufgaben-Übersicht, Aktenkennzahlen.
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
  // Zusage des Mandanten per Discord-Knopf (nur Kanzlei sieht sie als Markierung)
  const reply = isStaff() && !closed && e.clientResponse ? (e.clientResponse === 'zugesagt' ? badge('Zugesagt', 'emerald') : badge('Passt nicht', 'red')) : '';
  const side = closed ? statusBadge(EVENT_STATUS, e.status) : `${e.status === 'angefragt' ? badge('Anfrage', 'amber') : ''}${reply}${countdownHtml(e)}`;
  const meta = [EVENT_TYPES[e.type], `${date ? fmtDay(e.startsAt) + ', ' : ''}${fmtTime(e.startsAt)} Uhr`, e.caseNumber, isStaff() ? e.assignedName : null]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  return `<button type="button" class="ev-row ${closed ? 'ev-done' : ''}" data-action="open-event" data-id="${e.id}">
      <span class="ev-bar ev-bg-${esc(e.type)}"></span>
      <span class="ev-main"><span class="ev-title">${esc(e.title)}</span><span class="ev-meta">${meta}</span>${fristBar(e)}</span>
      <span class="ev-side">${side}</span></button>`;
}

/** Kanzlei: Priorität; Mandant: seine angegebene Dringlichkeit (nur wenn nicht „Normal“). */
function caseLevelText(c) {
  if (isStaff()) return PRIORITY[c.priority] ? ` · ${esc(PRIORITY[c.priority][2])}` : '';
  return c.urgency !== 'normal' && URGENCY[c.urgency] ? ` · ${esc(URGENCY[c.urgency][0])}` : '';
}
/** Badge neben der Akte: Kanzlei sieht nur die Priorität, der Mandant seine Dringlichkeit. */
const caseLevelBadge = (c) => (isStaff() ? priorityBadge(c) : c.urgency !== 'normal' && URGENCY[c.urgency] ? badge(...URGENCY[c.urgency]) : '');

/** Stern der Merkliste (je Person): gemerkte Akten stehen oben in Aktenliste und Übersicht. */
function starBtn(c) {
  const on = !!c.starred;
  return `<button type="button" class="star-btn${on ? ' on' : ''}" data-action="case-star" data-id="${c.id}" aria-pressed="${on}" title="${on ? 'Aus der Merkliste nehmen' : 'Merken – steht dann oben'}" aria-label="${on ? 'Aus der Merkliste nehmen' : 'Akte merken'}">${icon('star', 'ico-sm')}</button>`;
}

function caseListRow(c, extra = '', cls = '') {
  return `<div class="list-row${cls ? ` ${cls}` : ''}" data-action="open-case" data-id="${c.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${c.starred ? starBtn(c) : ''}${esc(c.title)}</div>
        <div class="meta"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.clientName)}${caseLevelText(c)}</div></div>
      <div class="flex items-center gap-2 shrink-0">${extra || stageBadge(c)}</div></div>`;
}

function kpi(label, value, sub, ico, href) {
  return `<a href="${href}" class="panel kpi block">
      <div class="kpi-label">${icon(ico, 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value" data-count="kpi:${esc(label)}">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></a>`;
}
/** Kennzahl ohne Inhalt (Mandantenportal): kleine Zeile statt großer Kachel mit „0“ – Wichtiges rückt nach oben. */
function kpiQuiet(label, note, ico, href) {
  return `<a href="${href}" class="panel kpi kpi-quiet">${icon(ico, 'ico-sm')}<span class="kpi-label">${esc(label)}</span><span class="kpi-sub">${esc(note)}</span></a>`;
}
function kpiEvent(label, e) {
  if (!e) {
    return `<a href="#calendar" class="panel kpi block"><div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
        <div class="kpi-value" style="color:var(--text-dim)">—</div><div class="kpi-sub">Nichts geplant</div></a>`;
  }
  return `<button type="button" class="panel kpi block w-full text-left" data-action="open-event" data-id="${e.id}">
      <div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value" style="font-size:clamp(1.15rem,3.4vw,1.55rem)">${esc(e.title)}</div>
      <div class="kpi-sub">${esc(fmtDay(e.startsAt))}, ${esc(fmtTime(e.startsAt))} Uhr</div>${countdownHtml(e)}${fristBar(e)}</button>`;
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

/**
 * Mandantenportal: „Was ist zu tun?“ – ganz oben nur das, was der Mandant gerade selbst erledigen muss, jeweils mit
 * einem Knopf, der direkt dorthin führt: unterschreiben, Rechnung begleichen/als bezahlt melden, neue Nachrichten
 * lesen, Termin heute/morgen, ungelesene Kanzlei-Post.
 */
function todoPanel() {
  const item = (ico, title, meta, actions, tone = '') =>
    `<div class="todo-item ${tone}"><span class="todo-ico">${icon(ico, 'ico-sm')}</span><div class="todo-main"><div class="todo-title">${title}</div>${meta ? `<div class="todo-meta">${meta}</div>` : ''}</div><div class="todo-actions">${actions}</div></div>`;
  const caseRef = (number, title) => `Akte <span class="font-mono text-gold">${esc(number)}</span>${title ? ` · ${esc(title)}` : ''}`;
  const items = [];
  for (const k of st.toSign) {
    items.push(item('edit', `${esc(k.templateName)} unterschreiben`, caseRef(k.caseNumber, k.caseTitle), `<a class="btn-gold btn-sm" href="/vertrag?id=${k.id}" target="_blank" rel="noopener">${icon('edit', 'ico-sm')}<span>Lesen &amp; unterschreiben</span></a>`));
  }
  for (const e of st.events.filter((x) => x.proposal && x.clientId === st.user.id)) {
    items.push(item('calendar', `Terminvorschlag: ${esc(e.title)}`, [`${e.slots.length} Zeiten zur Auswahl`, e.caseNumber ? caseRef(e.caseNumber) : ''].filter(Boolean).join(' · '), `<button class="btn-gold btn-sm" data-action="open-event" data-id="${e.id}">${icon('calendar', 'ico-sm')}<span>Zeit wählen</span></button>`, 'urgent'));
  }
  for (const r of st.openRequests) {
    items.push(
      item(
        'doc',
        `Unterlage nachreichen: ${esc(r.title)}`,
        [r.note ? esc(r.note) : '', caseRef(r.caseNumber, r.caseTitle)].filter(Boolean).join(' · '),
        `<button class="btn-gold btn-sm" data-action="open-case-chat" data-id="${r.caseId}">${icon('chat', 'ico-sm')}<span>An die Kanzlei senden</span></button><button class="btn-ghost btn-sm" data-action="req-toggle" data-case-id="${r.caseId}" data-id="${r.id}" data-done="1">Erledigt</button>`
      )
    );
  }
  // Überfällige zuerst, dann nach Fälligkeit (ohne Fälligkeit zuletzt)
  const open = st.invoices.filter((x) => x.status === 'offen' && !x.paymentReport).sort((a, b) => b.overdueDays - a.overdueDays || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  for (const i of open) {
    const due = i.overdueDays > 0 ? `<span class="text-red-300">${esc(overdueText(i))}</span>` : i.dueDate ? `fällig ${esc(fmtDateOnly(i.dueDate))}` : '';
    items.push(
      item(
        'receipt',
        `${esc(INVOICE_KIND[i.kind])} <span class="font-mono text-gold">${esc(i.number)}</span> über ${esc(money(i.total))} begleichen`,
        [due, i.caseNumber ? caseRef(i.caseNumber) : ''].filter(Boolean).join(' · '),
        `<button class="btn-gold btn-sm" data-action="inv-pay-report" data-id="${i.id}">${icon('check', 'ico-sm')}<span>Als bezahlt melden</span></button><a class="btn-ghost btn-sm" href="/rechnung?id=${i.id}" target="_blank" rel="noopener">Ansehen</a>`,
        i.overdueDays > 0 ? 'urgent' : ''
      )
    );
  }
  for (const c of st.cases.filter((x) => x.chatUnread > 0)) {
    items.push(item('chat', `${c.chatUnread === 1 ? 'Neue Nachricht' : `${c.chatUnread} neue Nachrichten`} von Ihrer Kanzlei`, caseRef(c.caseNumber, c.title), `<button class="btn-gold btn-sm" data-action="open-case-chat" data-id="${c.id}">${icon('chat', 'ico-sm')}<span>Lesen &amp; antworten</span></button>`));
  }
  // Bestätigte Termine heute und morgen (Fristen betreffen die Kanzlei)
  const soon = upcomingEvents(20).filter((e) => {
    const d = parseDate(e.startsAt);
    return e.status === 'bestaetigt' && e.type !== 'frist' && d && daysUntil(dayKey(d)) <= 1;
  });
  for (const e of soon) {
    const when = `${daysUntil(dayKey(parseDate(e.startsAt))) <= 0 ? 'Heute' : 'Morgen'}, ${fmtTime(e.startsAt)} Uhr`;
    items.push(item('calendar', `${esc(when)}: ${esc(e.title)}`, [EVENT_TYPES[e.type], e.location, e.caseNumber ? `Akte ${e.caseNumber}` : ''].filter(Boolean).map(esc).join(' · '), `<button class="btn-outline btn-sm" data-action="open-event" data-id="${e.id}">Details</button>`));
  }
  if (st.unread) {
    items.push(item('mail', `${st.unread === 1 ? 'Eine ungelesene Nachricht' : `${st.unread} ungelesene Nachrichten`} in der Kanzlei-Post`, '', `<a class="btn-outline btn-sm" href="#mail">Öffnen</a>`));
  }
  if (!items.length) {
    if (!st.cases.length) return ''; // Noch kein Mandat: oben steht „Mandat einreichen“
    return `<section class="panel todo-done mb-4 lg:mb-5">${icon('check')}<div><strong>Alles erledigt.</strong> Im Moment müssen Sie nichts tun – wir melden uns, sobald es Neuigkeiten gibt.</div></section>`;
  }
  return `<section class="panel panel-pad todo mb-4 lg:mb-5" aria-labelledby="todoTitle">
      <div class="panel-head"><h2 class="panel-title" id="todoTitle">Was ist zu tun?</h2>${badge(items.length === 1 ? '1 Punkt' : `${items.length} Punkte`, 'gold')}</div>
      <div class="todo-list">${items.join('')}</div>
    </section>`;
}

/** Überfällige/heute fällige eigene Aufgaben und eigene liegengebliebene Akten – nur wenn es etwas zu tun gibt. */
function attentionPanel() {
  const me = st.user.id;
  const overdue = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0);
  const today = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) === 0);
  // Gleiche Schwelle wie die Markierung in der Aktenliste (Einstellungen, Standard 5 Tage)
  const stale = st.cases.filter((c) => c.idleDays > 0 && onCase(c, me)).sort((a, b) => b.idleDays - a.idleDays);
  if (!overdue.length && !today.length && !stale.length) return '';
  const due = [...overdue, ...today];
  return `<section class="panel panel-pad attention mb-4 lg:mb-5">
      <div class="panel-head"><h2 class="panel-title">Handlungsbedarf</h2>
        <div class="flex flex-wrap gap-2">${overdue.length ? badge(`${overdue.length} überfällig`, 'red') : ''}${today.length ? badge(`${today.length} heute fällig`, 'amber') : ''}${stale.length ? badge(`${stale.length} liegengeblieben`, 'amber') : ''}</div></div>
      ${due.length ? `<div class="task-list">${due.slice(0, 5).map((t) => taskItem(t)).join('')}</div>` : ''}
      ${due.length > 5 ? `<a href="#tasks" class="btn-ghost btn-sm mt-2">Alle ${due.length} fälligen Aufgaben anzeigen</a>` : ''}
      ${stale.length ? `<div class="${due.length ? 'mt-4' : ''}"><div class="text-xs uppercase tracking-widest text-dim mb-1">Ihre liegengebliebenen Akten (ohne Aktivität)</div>
        ${stale.slice(0, 4).map((c) => caseListRow(c, activityCell(c), 'row-idle')).join('')}</div>` : ''}
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
      isStaff() ? api.get('/api/onboarding').then((r) => (st.onboarding = r), () => (st.onboarding = null)) : null,
      isAdmin() ? api.get('/api/admin/alerts').then((r) => (st.alerts = r.alerts), () => (st.alerts = [])) : null,
      !isStaff() ? load.requests().catch(() => (st.openRequests = [])) : null,
      !isStaff() ? api.get('/api/contracts/to-sign').then((r) => (st.toSign = r.contracts), () => (st.toSign = [])) : null,
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
      // Board ohne Discord: Die Zwei-Faktor-Anmeldung ist Pflicht, der Code kann aber nirgends hin
      isBoard() && st.twoFactor && st.twoFactor.botReady && !st.twoFactor.hasDiscord
        ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div>${icon('shield')} <strong>Zwei-Faktor-Anmeldung:</strong> Für das Board of Partners ist sie Pflicht – bitte Discord verbinden, dorthin kommt beim Login der Code.</div><a href="#profile" class="btn-outline btn-sm">Zum Profil</a></div>`
        : '',
      u.emailNotice
        ? `<div class="banner banner-gold items-center justify-between flex-wrap"><div>${icon('mail')} <strong>Ihre Login-E-Mail lautet jetzt ${esc(u.email)}</strong>${u.emailNotice.oldEmail ? ` (vorher ${esc(u.emailNotice.oldEmail)})` : ''}. Alle Konten der Kanzlei enden auf @${EMAIL_DOMAIN}. Ihr Passwort bleibt gleich – die alte Adresse funktioniert beim Login weiterhin.</div><button class="btn-outline btn-sm" data-action="email-notice-ok">Verstanden</button></div>`
        : '',
      (() => {
        const mine = staff && st.onboarding && st.onboarding.list.find((e) => e.userId === u.id && !e.doneAt);
        return mine
          ? `<div class="banner banner-gold items-center justify-between flex-wrap"><div>${icon('star')} <strong>Deine Einarbeitung:</strong> ${mine.done} von ${mine.total} Punkten erledigt${mine.mentor ? ` · Mentor: ${esc(mine.mentor.name)}` : ''}</div><a href="#personnel" class="btn-outline btn-sm">Checkliste</a></div>`
          : '';
      })(),
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
          (() => {
            const free = active.filter((c) => !c.lawyerId).length;
            return kpi('Neue Anfragen', active.filter((c) => c.status === 'offen').length, free ? `${free} ${free === 1 ? 'Akte wartet' : 'Akten warten'} auf einen Anwalt` : 'jede Akte hat einen Anwalt', 'folder', '#cases');
          })(),
          kpi('In Bearbeitung', active.filter((c) => c.status === 'in_bearbeitung').length, `${active.filter((c) => onCase(c, u.id)).length} davon bei Ihnen`, 'briefcase', '#cases'),
          kpiEvent('Nächste Frist / Termin', nextDeadline),
          kpi('Kanzlei-Post', st.unread, st.unread === 1 ? 'ungelesene Nachricht' : 'ungelesene Nachrichten', 'mail', '#mail'),
        ]
      : [
          active.length ? kpi('Meine Akten', active.length, active.length === 1 ? 'laufendes Mandat' : 'laufende Mandate', 'folder', '#cases') : kpiQuiet('Meine Akten', 'kein laufendes Mandat', 'folder', '#cases'),
          upcoming[0] ? kpiEvent('Nächster Termin', upcoming[0]) : kpiQuiet('Nächster Termin', 'kein Termin geplant', 'clock', '#calendar'),
          st.unread ? kpi('Kanzlei-Post', st.unread, 'ungelesen', 'mail', '#mail') : kpiQuiet('Kanzlei-Post', 'nichts Ungelesenes', 'mail', '#mail'),
          openInvoices.length
            ? kpi('Offene Rechnungen', money(openSum), openInvoices.length === 1 ? '1 Rechnung' : `${openInvoices.length} Rechnungen`, 'receipt', '#invoices')
            : kpiQuiet('Offene Rechnungen', 'Keine offenen Rechnungen', 'receipt', '#invoices'),
        ];
    // Mandant: Kacheln mit Inhalt zuerst und groß, leere als schmale Zeilen darunter
    const fullKpis = kpis.filter((k) => !k.includes('kpi-quiet'));
    const quietKpis = kpis.filter((k) => k.includes('kpi-quiet'));
    const kpiHtml = staff
      ? `<div class="kpi-grid">${kpis.join('')}</div>`
      : `${fullKpis.length ? `<div class="kpi-grid${fullKpis.length < 4 ? ` kpi-grid-${fullKpis.length}` : ''}">${fullKpis.join('')}</div>` : ''}${quietKpis.length ? `<div class="kpi-quiet-grid">${quietKpis.join('')}</div>` : ''}`;

    const eventsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Fristen & Termine' : 'Ihre Termine'}</h2><a href="#calendar" class="btn-ghost btn-sm">Alle anzeigen</a></div>
          ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : emptyLine('Keine anstehenden Termine.', 'calendar')}
        </section>`;

    // Gemerkte Akten zuerst, danach die zuletzt bearbeiteten
    const starred = st.cases.filter((c) => c.starred && c.status !== 'geschlossen');
    const recent = [...starred, ...st.cases.filter((c) => !starred.includes(c))].slice(0, Math.max(5, starred.length));
    const recentPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Zuletzt bearbeitet' : 'Meine Akten'}</h2><a href="#cases" class="btn-ghost btn-sm">Alle Akten</a></div>
          ${recent.length ? recent.map((c) => caseListRow(c)).join('') : emptyLine(staff ? 'Noch keine Akten.' : 'Sie haben noch kein Mandat eingereicht.', 'folder')}
          ${
            // Mandant: „Mandat einreichen“ steht oben im Seitenkopf, hier zwei gleich breite Knöpfe (am Handy untereinander)
            !staff
              ? `<div class="action-grid mt-4"><button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button><button class="btn-outline btn-md" data-action="compose">${icon('mail', 'ico-sm')}<span>Kanzlei schreiben</span></button></div>`
              : ''
          }
        </section>`;

    const head = `
        ${banner}
        <div class="page-head">
          <div><p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">${esc(today)}</p>
            <h1 class="page-title">${esc(greet)}, ${esc(u.displayName)}</h1>
            <p class="page-sub">${esc(u.rank || ROLES[u.role])} · Pake &amp; Scha Legal Consulting</p></div>
          <div class="page-actions"><button class="btn-outline btn-md" data-action="concern-new">${icon('chat', 'ico-sm')}<span>Anliegen ans Board</span></button>${staff ? `<button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Neue Akte</span></button>` : `<button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Mandat einreichen</span></button>`}</div>
        </div>
        ${staff ? '' : todoPanel()}
        ${dutyStrip()}
        ${absenceStrip()}
        ${kpiHtml}`;

    // Zwei Kästen nebeneinander, einer kurz (≤ 2 Einträge), einer deutlich länger: der kurze wird so hoch wie sein Inhalt
    // und schmaler, der lange bekommt die Breite – kein leerer Raum im kurzen Kasten.
    const fit = (a, b) => (b && Math.abs(a - b) >= 3 && Math.min(a, b) <= 2 ? (a < b ? ' ov-fit-l' : ' ov-fit-r') : '');
    if (!staff) {
      return `${head}${
        upcoming.length
          ? `<div class="grid-2 ov-row${fit(upcoming.length, recent.length + 1)}">${eventsPanel}${recentPanel}</div>`
          : `<div class="grid-2 ov-row">${recentPanel}</div>`
      }`;
    }

    const unassigned = active.filter((c) => !c.lawyerId).slice(0, 5);
    const pinned = st.board.filter((n) => n.pinned).slice(0, 3);
    const requestsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Neue Mandatsanfragen</h2>${unassigned.length ? badge(`${unassigned.length} offen`, 'amber') : ''}</div>
          ${unassigned.length ? unassigned.map((c) => caseListRow(c, `<button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Übernehmen</button>`)).join('') : emptyLine('Alle Anfragen sind vergeben.', 'check')}
        </section>`;
    const boardPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Pinnwand</h2><a href="#board" class="btn-ghost btn-sm">Zur Pinnwand</a></div>
          ${pinned.length ? pinned.map((n) => `<div class="tl-item mb-2" style="border-left:3px solid ${NOTE_COLORS[n.color] || NOTE_COLORS.gold}"><div class="tl-meta"><strong class="text-muted">${esc(n.title || 'Notiz')}</strong> · ${esc(n.authorName)}</div><div class="tl-body">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div></div>`).join('') : emptyLine('Keine angehefteten Notizen.', 'pin')}
        </section>`;

    // Leere Bereiche (keine neuen Anfragen, nichts angeheftet) als schmale Zeile unten statt großem leerem Kasten –
    // das Wichtige rückt nach oben; die übrigen Kästen paarweise, ein einzelner über die volle Breite
    const quietRow = (ico, title, note, action = '') =>
      `<div class="panel quiet-row">${icon(ico, 'ico-sm')}<span class="quiet-title">${esc(title)}</span><span class="sec-empty-note">${esc(note)}</span>${action ? `<span class="quiet-act">${action}</span>` : ''}</div>`;
    const quiet = [
      unassigned.length ? '' : quietRow('check', 'Neue Mandatsanfragen', 'alle Anfragen sind vergeben'),
      pinned.length ? '' : quietRow('pin', 'Pinnwand', 'keine angehefteten Notizen', '<a href="#board" class="btn-ghost btn-sm">Zur Pinnwand</a>'),
      upcoming.length ? '' : quietRow('calendar', 'Fristen & Termine', 'nichts geplant', `<button class="btn-ghost btn-sm" data-action="new-event">${icon('plus', 'ico-sm')}<span>Frist / Termin</span></button>`),
    ].join('');
    // Je Kasten die Zahl der Einträge: ein Paar aus kurzem und langem Kasten teilt die Breite nach Inhalt auf
    const panels = [
      unassigned.length ? [requestsPanel, unassigned.length] : null,
      upcoming.length ? [eventsPanel, upcoming.length] : null,
      [recentPanel, Math.max(recent.length, 1)],
      pinned.length ? [boardPanel, pinned.length] : null,
    ].filter(Boolean);
    const rows = [];
    for (let i = 0; i < panels.length; i += 2) {
      const [a, b] = panels.slice(i, i + 2);
      rows.push(`<div class="grid-2 ov-row${b ? fit(a[1], b[1]) : ''}${i ? ' mt-4 lg:mt-5' : ''}">${a[0]}${b ? b[0] : ''}</div>`);
    }
    return `${head}
        ${attentionPanel()}
        ${rows.join('')}
        ${quiet ? `<div class="quiet-rows">${quiet}</div>` : ''}`;
  },
};

/* ---------------------------------------------------------------- Akten */
function filteredCases() {
  const q = st.caseQuery.trim().toLowerCase();
  // Ein eingefügter FiveNet-/Google-Docs-Link oder eine Dokument-ID findet die Akten, mit denen das Dokument verknüpft ist.
  const extId = q ? externalIdFrom(st.caseQuery) : null;
  return st.cases.filter((c) => {
    // Archiv (seit über 30 Tagen abgeschlossen) nur im Reiter „Archiv“ – die Suche findet aber alles
    const stateOk = caseMatches(c, st.caseFilter) && (st.caseFilter === 'archiv' || !!q || !isArchived(c));
    const mineOk = !st.caseMine || onCase(c);
    const textOk =
      !q ||
      [c.caseNumber, c.title, c.clientName, c.lawyerName, ...(c.coLawyers || []).map((l) => l.name), c.courtRef, c.opponent].join(' ').toLowerCase().includes(q) ||
      // Google-Sheets-IDs tragen ggf. das Tabellenblatt (#gid=…) – gefunden wird jede Verknüpfung der Tabelle.
      (!!extId && (c.externalDocIds || []).some((x) => x.split('#')[0] === extId));
    return stateOk && mineOk && textOk;
  });
}
const ARCHIVE_DAYS = 30;
/** Seit über 30 Tagen abgeschlossen: steht nicht mehr in der normalen Liste, sondern im Archiv. */
function isArchived(c) {
  const t = c.status === 'geschlossen' && parseDate(c.closedAt || c.updatedAt);
  return !!t && Date.now() - t > ARCHIVE_DAYS * 86400000;
}
/** Filter der Aktenliste: alle, aktiv, ein Status, „liegt“ (liegengeblieben, nur Kanzlei) oder „archiv“. */
function caseMatches(c, f) {
  if (f === 'archiv') return isArchived(c);
  if (f === 'alle') return true;
  if (f === 'aktiv') return c.status !== 'geschlossen';
  if (f === 'liegt') return c.idleDays > 0;
  return c.status === f;
}
function caseCount(f) {
  return st.cases.filter((c) => caseMatches(c, f) && (f === 'archiv' || !isArchived(c))).length;
}
/** VIP / Lifetime des Mandanten als Badge. */
function memberBadge(m) {
  if (!m) return '';
  return m.kind === 'perma' ? badge('👑 Lifetime', 'gold') : badge(`⭐ ${m.name}`, 'sky');
}
// Offene Akten von Lifetime- und VIP-Mandanten stehen oben (sonst bleibt die Reihenfolge)
const memberRank = (c) => (c.status === 'geschlossen' || !c.membership ? 0 : c.membership.kind === 'perma' ? 2 : 1);
/** Prioritäts-Badge (nur Kanzlei), z. B. „Hohe Priorität“ mit Stufen-Anzeige; short: nur „Hoch“ (Spalte „Priorität“). */
function priorityBadge(c, short = false) {
  const p = PRIORITY[c.priority] ? c.priority : 2;
  const [label, color, text] = PRIORITY[p];
  return `<span class="badge badge-${color} prio-badge"${short ? ` title="${esc(text)}"` : ''}>${prioBars(p)}${esc(short ? label : text)}</span>`;
}
/** Stufen-Anzeige der Priorität (1–4 Balken). */
const prioBars = (p) => `<span class="prio-bars" aria-hidden="true">${[1, 2, 3, 4].map((i) => `<i class="${i <= p ? 'on' : ''}"></i>`).join('')}</span>`;
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
  const by = sorters[mode] || sorters.aktualisiert;
  return list.sort((a, b) => !!b.starred - !!a.starred || by(a, b)); // Merkliste zuerst
}

/**
 * Letzte Aktivität einer Akte: „heute“, „gestern“, „vor 5 Tagen“ (genaue Zeit im Tooltip). Liegt die Akte (nur Kanzlei),
 * steht der Wert in Bernstein mit Uhr – statt einer eigenen Markierung unter dem Titel.
 */
function activityCell(c) {
  const when = esc(relDays(c.updatedAt));
  if (!c.idleDays) return `<span class="text-muted" title="${esc(fmtDate(c.updatedAt))}">${when}</span>`;
  return `<span class="act-idle" title="Liegt seit ${dayCount(c.idleDays)} ohne Aktivität (zuletzt ${esc(fmtDate(c.updatedAt))})">${icon('clock', 'ico-sm')}${when}</span>`;
}

/*
 * Mehrfachauswahl (nur Kanzlei): „Auswählen“ über der Liste → Zeilen bekommen ein Kästchen, ein Klick wählt statt zu
 * öffnen. Die Leiste unten setzt Priorität, Stand oder (Admins) die Federführung für alle gewählten Akten auf einmal.
 */
const caseSelecting = () => isStaff() && st.caseSel instanceof Set;
function bulkBar() {
  if (!caseSelecting()) return '';
  const n = st.caseSel.size;
  const sel = (action, label, options) =>
    `<select class="field bulk-sel" data-change="${action}" data-no-dirty aria-label="${esc(label)}" ${n ? '' : 'disabled'}><option value="">${esc(label)} …</option>${options}</select>`;
  return `<div class="bulk-bar" role="region" aria-label="Mehrfachauswahl">
      <span class="bulk-count"><strong>${n}</strong> ${n === 1 ? 'Akte' : 'Akten'} ausgewählt</span>
      <div class="bulk-acts">
        ${sel('bulk-priority', 'Priorität', Object.entries(PRIORITY).map(([k, [l]]) => opt(k, l)).join(''))}
        ${sel('bulk-stage', 'Stand', [opt('offen', 'Offen'), ...STEPS.map((x, i) => opt(`step:${i}`, x)), opt('geschlossen', 'Abschließen …')].join(''))}
        ${isAdmin() ? sel('bulk-lawyer', 'Federführung', st.lawyers.map((l) => opt(l.id, l.displayName)).join('')) : ''}
        <button type="button" class="btn-ghost btn-sm" data-action="case-select">Fertig</button>
      </div></div>`;
}

/** Dieselbe Änderung für alle gewählten Akten (nacheinander, je Akte mit ihren eigenen Rechten). */
async function bulkPatch(body, label) {
  const ids = [...st.caseSel];
  if (!ids.length) return;
  $$('.bulk-sel').forEach((x) => (x.disabled = true));
  let ok = 0;
  let denied = 0;
  for (const id of ids) {
    try {
      await api.patch('/api/cases/' + id, body(id));
      ok++;
    } catch (err) {
      if (err.status === 403) denied++;
      else throw err;
    }
  }
  await load.cases();
  renderView();
  toast(`${label}: ${ok} ${ok === 1 ? 'Akte' : 'Akten'} geändert${denied ? ` · ${denied} ohne Berechtigung übersprungen` : ''}.`, ok ? 'ok' : 'error');
}

function caseTable() {
  const rows = sortCases(filteredCases());
  const staff = isStaff();
  const selecting = caseSelecting();
  // Gewählt bleibt nur, was gerade in der Liste steht (Filter/Suche geändert → nicht mehr sichtbare Akten fallen raus)
  if (selecting) for (const id of st.caseSel) if (!rows.some((c) => c.id === id)) st.caseSel.delete(id);
  if (!rows.length) {
    // Nächster Schritt: eingeschränkte Auswahl → zurücksetzen; nur abgeschlossene Akten → ins Archiv bzw. alle zeigen
    const plain = st.caseFilter === 'aktiv' && !st.caseQuery.trim() && !st.caseMine;
    return st.cases.length
      ? plain
        ? empty('Keine laufenden Akten.', 'folder', nextStep('Alle Akten zeigen', 'case-filter', { value: caseCount('alle') ? 'alle' : 'archiv' }, 'folder'))
        : empty('Keine Akten für diese Auswahl.', 'folder', nextStep('Filter zurücksetzen', 'cases-filter-reset', {}, 'refresh'))
      :empty(staff ? 'Noch keine Akten angelegt.' : 'Sie haben noch kein Mandat eingereicht.', 'folder', nextStep(staff ? 'Neue Akte' : 'Mandat einreichen', 'new-case'));
  }
  // Je Akte zwei Zeilen: „Aktenzeichen · Rechtsgebiet“, darunter der Titel. Liegengebliebene Akten:
  // „Letzte Aktivität“ in Bernstein (kein Streifen am Rand).
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr>${selecting ? `<th class="th-check"><button type="button" class="sel-all" data-action="case-select-all" aria-label="Alle sichtbaren Akten auswählen">${rows.length && rows.every((c) => st.caseSel.has(c.id)) ? 'Keine' : 'Alle'}</button></th>` : ''}<th>Akte</th>${staff ? '<th>Mandant</th>' : ''}<th>Zuständig</th>${staff ? '<th>Priorität</th>' : ''}<th>Status</th><th>Letzte Aktivität</th></tr></thead>
      <tbody>${lazyRows(
        rows,
        (c) => `<tr class="row${c.idleDays ? ' row-idle' : ''}${selecting && st.caseSel.has(c.id) ? ' is-picked' : ''}" data-action="${selecting ? 'case-pick' : 'open-case'}" data-id="${c.id}"${selecting ? ` aria-selected="${st.caseSel.has(c.id)}"` : ''}>
          ${selecting ? `<td class="td-check"><span class="pick-box" aria-hidden="true">${icon('check', 'ico-sm')}</span></td>` : ''}<td class="td-main"><div class="case-meta"><span class="font-mono text-gold text-xs">${esc(c.caseNumber)}</span><span class="case-dot" aria-hidden="true">·</span><span>${esc(AREAS[c.area] || c.area)}</span>${staff ? '' : caseLevelBadge(c)}</div>
            <div class="font-medium case-title-line" title="${esc(c.title)}">${staff ? starBtn(c) : ''}<span class="case-title-text">${esc(c.title)}</span>${c.chatUnread ? ` <span class="chat-new" title="Neue Nachrichten">${icon('chat', 'ico-sm')}${c.chatUnread}</span>` : ''}</div></td>
          ${staff ? `<td data-label="Mandant">${esc(c.clientName)}${c.membership ? `<div class="mt-1">${memberBadge(c.membership)}</div>` : ''}</td>` : ''}
          <td data-label="Zuständig">${whoHtml(c)}</td>
          ${staff ? `<td data-label="Priorität">${priorityBadge(c, true)}</td>` : ''}
          <td data-label="Status">${stageBadge(c)}</td>
          <td data-label="Letzte Aktivität" class="nowrap">${activityCell(c)}</td></tr>`,
        (staff ? 6 : 4) + (selecting ? 1 : 0)
      )}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- Globale Suche (Strg + K) */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_MOD = IS_MAC ? '⌘' : 'Strg';
$$('.topbar-search kbd').forEach((k) => (k.textContent = `${KEY_MOD} K`));
$$('.topbar-search').forEach((b) => (b.title = `Suchen (${KEY_MOD} + K)`));
const GS_GROUPS = [
  ['cases', 'Akten', 'folder'],
  ['clients', 'Mandanten', 'user'],
  ['notes', 'Notizen & Chat', 'chat'],
  ['invoices', 'Rechnungen', 'receipt'],
  ['tasks', 'Aufgaben', 'tasks'],
  ['events', 'Termine & Fristen', 'calendar'],
  ['messages', 'Kanzlei-Post', 'mail'],
  ['wiki', 'Kanzlei-Wiki', 'book'],
  ['penal', 'Strafgesetzbuch', 'scale'],
];
/**
 * Treffer hervorheben – der ganze Suchbegriff, seine einzelnen Wörter und die Wörter, die der Server trotz Tippfehler
 * oder Umlaut gefunden hat (st.gsTerms). Text und Treffer werden einzeln escaped.
 */
function hl(text, q) {
  const s = String(text ?? '');
  if (!q) return esc(s);
  const needles = [...new Set([q, ...q.split(/\s+/), ...(st.gsTerms || [])].map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!needles.length) return esc(s);
  const re = new RegExp(needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let out = '';
  let i = 0;
  for (const m of s.matchAll(re)) {
    out += `${esc(s.slice(i, m.index))}<mark>${esc(m[0])}</mark>`;
    i = m.index + m[0].length;
  }
  return out + esc(s.slice(i));
}
/** Textmarker: Suchbegriff im offenen Fenster markieren (nur Text, keine Felder/Knöpfe) und zum ersten Treffer scrollen. */
function markInModal(q) {
  const body = $('#modalBody');
  const needles = [...new Set([q, ...q.split(/\s+/)].map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  if (!body || !needles.length) return;
  const re = new RegExp(needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const hit = new RegExp(re.source, 'i'); // ohne „g“: test() merkt sich sonst die letzte Fundstelle
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('select, option, textarea, input, button, script, .case-jump, mark') || !hit.test(n.data) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode() && nodes.length < 60) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let i = 0;
    re.lastIndex = 0;
    for (const m of n.data.matchAll(re)) {
      frag.append(n.data.slice(i, m.index));
      const mk = document.createElement('mark');
      mk.className = 'hl-mark';
      mk.textContent = m[0];
      frag.append(mk);
      i = m.index + m[0].length;
    }
    frag.append(n.data.slice(i));
    n.replaceWith(frag);
  }
  // Der erste Treffer unterhalb des Aktenkopfs (dort steht meist nur der Titel) wird sichtbar gescrollt
  const marks = $$('mark.hl-mark', body);
  const target = marks.find((m) => !m.closest('.case-head')) || marks[0];
  if (target && !target.closest('.case-head')) setTimeout(() => target.scrollIntoView({ block: 'center', behavior: window.PS.motion.calm() ? 'auto' : 'smooth' }), 420);
}
function gsItem(type, x, q) {
  const line = (title, meta) => `<span class="main"><span class="title">${title}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</span>`;
  const ico = icon(GS_GROUPS.find((g) => g[0] === type)[2]);
  let body = '';
  if (type === 'cases')
    body = line(`<span class="font-mono text-gold">${hl(x.caseNumber, q)}</span> · ${hl(x.title, q)}`, [hl(x.clientName, q), esc(caseStage(x)[0]), x.opponent ? `Gegenpartei: ${hl(x.opponent, q)}` : '', x.courtRef ? hl(x.courtRef, q) : ''].filter(Boolean).join(' · '));
  else if (type === 'clients')
    body = line(`${hl(x.name, q)}${x.active ? '' : ' <span class="text-dim">(gesperrt)</span>'}`, [hl(x.email, q), x.phone ? hl(x.phone, q) : '', `${x.caseCount} ${x.caseCount === 1 ? 'Akte' : 'Akten'}`].filter(Boolean).join(' · '));
  else if (type === 'invoices')
    body = line(`<span class="font-mono text-gold">${hl(x.number, q)}</span> · ${esc(money(x.total))}`, [hl(x.clientName, q), x.subject ? hl(x.subject, q) : '', x.overdueDays > 0 ? overdueText(x) : esc(INVOICE_STATUS[x.status] ? INVOICE_STATUS[x.status][0] : x.status), x.caseNumber ? esc(x.caseNumber) : ''].filter(Boolean).join(' · '));
  else if (type === 'tasks')
    body = line(`${x.done ? '✓ ' : ''}${hl(x.title, q)}`, [x.dueDate ? `fällig ${esc(fmtDateOnly(x.dueDate))}` : 'ohne Datum', x.assignedName ? esc(x.assignedName) : '', x.caseNumber ? esc(x.caseNumber) : '', x.done ? 'erledigt' : ''].filter(Boolean).join(' · '));
  else if (type === 'events')
    body = line(hl(x.title, q), [esc(fmtDate(x.startsAt)), esc(EVENT_TYPES[x.type] || x.type), x.location ? hl(x.location, q) : '', x.caseNumber ? esc(x.caseNumber) : ''].filter(Boolean).join(' · '));
  else if (type === 'notes')
    body = line(`<span class="font-mono text-gold">${esc(x.caseNumber)}</span> · ${esc(x.caseTitle)}`, [hl(x.preview, q), `${esc(x.author)}${x.internal ? ' (intern)' : ''}`, esc(fmtDate(x.createdAt))].join(' · '));
  else if (type === 'wiki') body = line(hl(x.title, q), [esc(x.category), hl(x.preview, q)].join(' · '));
  else if (type === 'penal') body = line(`<span class="text-gold">§ ${esc(x.para)}</span> · ${hl(x.title, q)}`, esc(x.chapter));
  else if (type === 'messages')
    body = line(hl(x.subject || '(ohne Betreff)', q), [x.box === 'inbox' ? `von ${esc(x.senderName)}` : `an ${esc(x.recipientName)}`, esc(fmtDate(x.createdAt)), hl(x.preview, q)].filter(Boolean).join(' · '));
  return `<button type="button" class="gs-item" data-action="gs-open" data-type="${type}" data-id="${x.id}">${ico}${body}</button>`;
}
function renderSearchResults() {
  const box = $('#gsResults');
  if (!box) return;
  const q = st.gsQuery.trim();
  if (q.length < 2) {
    box.innerHTML = `<p class="gs-hint">${isStaff() ? 'Aktenzeichen, Namen, Notizen, Rechnungen, Termine, Wiki oder Paragraphen – auch FiveNet- und Google-Links. Kleine Tippfehler sind kein Problem.' : 'Aktenzeichen, Rechnungsnummern, Termine, Nachrichten oder der Chat Ihrer Akten.'}</p>`;
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
    st.gsTerms = res.terms || [];
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
  // Akte aus der Suche: Treffer in der Akte wie mit einem Gold-Textmarker anstreichen
  const q = st.gsQuery.trim();
  if (type === 'cases') return modalInstead(() => openCase(id)).then(() => markInModal(q));
  if (type === 'notes') return modalInstead(() => openCase(x.caseId)).then(() => markInModal(q));
  if (type === 'wiki') return modalInstead(() => openWikiArticle(id));
  if (type === 'penal') return modalInstead(() => openLaw(x.para));
  if (type === 'clients') return modalInstead(() => openClient(`u${id}`)); // Mandantenkartei
  if (type === 'invoices') {
    if (x.caseId) return modalInstead(() => openCase(x.caseId));
    closeModal();
    window.open(`/rechnung?id=${x.id}`, '_blank', 'noopener');
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
    const filters = [['aktiv', 'Aktiv'], ['offen', 'Offen'], ['in_bearbeitung', 'In Bearbeitung'], ['geschlossen', 'Abgeschlossen'], ['alle', 'Alle']];
    // „Liegengeblieben“ erscheint nur, wenn es solche Akten gibt (oder der Filter gerade gewählt ist)
    if (staff && (caseCount('liegt') || st.caseFilter === 'liegt')) filters.splice(3, 0, ['liegt', 'Liegengeblieben']);
    if (caseCount('archiv') || st.caseFilter === 'archiv') filters.push(['archiv', 'Archiv']);
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
        <div class="list-bar">${staff ? `<button type="button" class="btn-ghost btn-sm ${caseSelecting() ? 'is-on' : ''}" data-action="case-select" aria-pressed="${caseSelecting()}">${icon('check', 'ico-sm')}<span>${caseSelecting() ? 'Auswahl beenden' : 'Auswählen'}</span></button>` : ''}<label class="case-sort"><span>Sortieren</span><select id="caseSort" class="field" aria-label="Akten sortieren">${Object.entries(CASE_SORTS)
        .filter(([k]) => staff || k !== 'prioritaet')
        .map(([k, l]) => opt(k, l, st.caseSort === k))
        .join('')}</select></label></div>
        <div id="caseList" class="panel p-2 md:p-3${caseSelecting() ? ' is-selecting' : ''}">${caseTable()}</div>
        <div id="bulkBarSlot">${bulkBar()}</div>`;
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
    return empty(msg, 'tasks', st.tasks.length || st.taskState === 'done' ? '' : nextStep('Neue Aufgabe', 'task-new'));
  }
  if (st.taskState === 'done') return `<div class="task-list">${lazyRows(list, (t) => taskItem(t))}</div>`;
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
      return `<h2 class="task-group ${key === 'overdue' ? 'is-overdue' : ''}">${esc(label)} <span>${items.length}</span></h2><div class="task-list">${lazyRows(items, (t) => taskItem(t))}</div>`;
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
  // Beweise verknüpfter Akten (nur Kanzlei) – eine Liste für die Bildansicht
  st.linkedAttachments = (data.linkedEvidence || []).flatMap((k) => k.attachments.map((a) => ({ ...a, caseId: k.caseId, caseNumber: k.caseNumber })));
  st.caseDocs = data.externalDocs || [];
  st.caseContracts = data.contracts || [];
  st.caseTasks = data.tasks || [];
  st.caseInfo = data.case;
  st.caseCharges = data.charges || null; // Anklagepunkte (Kanzlei) – auch für den Verhandlungsmodus
  if (data.case) queueThumbs(data.case.id, st.caseAttachments);
}

/*
 * Vorschaubilder: Bilder ohne eigenes Vorschaubild (neu hochgeladen, aus FiveNet/Google übernommen, ältere) verkleinert
 * der Browser einmal auf ~480 px (WebP) und legt sie auf dem Server ab – danach laden Raster und Verhandlungsmodus
 * nur noch die kleinen Bilder. Läuft im Leerlauf, eins nach dem anderen; wer es nicht darf, bekommt einfach das Original.
 */
const thumbTried = new Set();
const thumbQueue = [];
let thumbBusy = false;
function queueThumbs(caseId, attachments) {
  for (const a of attachments || []) {
    if (!a.needsThumb || thumbTried.has(a.id) || !/^image\//.test(a.mime || '')) continue;
    if (!isStaff() && a.uploaderId !== st.user.id) continue;
    thumbTried.add(a.id);
    thumbQueue.push({ caseId, a });
  }
  if (!thumbBusy && thumbQueue.length) (window.requestIdleCallback || setTimeout)(runThumbs, { timeout: 1500 });
}
async function makeThumb(blob, max = 480) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a1228';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const as = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  const webp = await as('image/webp', 0.8);
  return webp && webp.type === 'image/webp' ? webp : as('image/jpeg', 0.82); // ältere Safari können kein WebP schreiben
}
async function runThumbs() {
  thumbBusy = true;
  try {
    while (thumbQueue.length) {
      const { caseId, a } = thumbQueue.shift();
      try {
        const res = await fetch(a.url, { credentials: 'same-origin' });
        if (!res.ok) continue;
        const thumb = await makeThumb(await res.blob());
        const put = await fetch(`/api/cases/${caseId}/attachments/${a.id}/thumb`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': thumb.type, 'X-PS-Tab': window.PS.tab }, body: thumb });
        if (!put.ok) continue;
        const { attachment } = await put.json();
        // ab jetzt das Vorschaubild verwenden (beim nächsten Zeichnen; das sichtbare Bild bleibt ruhig stehen)
        Object.assign(a, { thumbUrl: attachment.thumbUrl, needsThumb: false });
      } catch {
        /* Bild nicht lesbar (z. B. Format) – dann eben das Original */
      }
    }
  } finally {
    thumbBusy = false;
  }
}
/*
 * Akte vorladen: Fährt man mit der Maus über eine Akte (am Handy: beim Antippen), wird sie schon geladen – der Klick
 * öffnet sie dann ohne Wartezeit. Vorgeladenes gilt 15 s und wird bei jeder Änderung (eigene oder live gemeldete) verworfen.
 */
const casePrefetch = new Map(); // id → { at, promise }
const PREFETCH_MS = 15000;
// Die Akte lädt zuerst nur die jüngsten Nachrichten und Verlaufseinträge; wer „Ältere laden“ gewählt hat, behält sie beim Neuzeichnen
const caseFull = new Set();
const caseUrl = (id) => `/api/cases/${id}?lean=1${caseFull.has(id) ? '&all=1' : ''}`;
function prefetchCase(id) {
  const hit = casePrefetch.get(id);
  if (!id || (hit && Date.now() - hit.at < PREFETCH_MS)) return;
  const promise = api.get(caseUrl(id));
  promise.catch(() => casePrefetch.get(id)?.promise === promise && casePrefetch.delete(id));
  casePrefetch.set(id, { at: Date.now(), promise });
}
function takePrefetchedCase(id) {
  const hit = casePrefetch.get(id);
  casePrefetch.delete(id);
  return hit && Date.now() - hit.at < PREFETCH_MS ? hit.promise : null;
}
async function openCase(id) {
  // Dauert das Laden, öffnet sich die Akte sofort mit Platzhaltern
  const data = await withModalPlaceholder({ wide: true }, async () => {
    await load.lawyers();
    return takePrefetchedCase(id) || api.get(caseUrl(id));
  });
  if (!data) return;
  // Erst öffnen (ein vorheriges Fenster wird samt seinem Zustand beiseitegelegt), dann die Akte merken
  openModal(caseDetail(data), { wide: true, key: `case:${id}`, reopen: () => openCase(id) });
  rememberCase(data);
  st.modalCaseId = id;
  if (typeof liveSync === 'function') liveSync(); // Mandanten verbinden sich erst, wenn eine Akte offen ist
  initChat(data);
  animateTrack($('#modalBody .track'));
}
async function reloadCase(id) {
  const data = await api.get(caseUrl(id));
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

/** Beweise verknüpfter Akten (gemeinsame Beweismappe): je Akte eine Zeile kleiner Bilder mit Nummer. */
function linkedEvidenceHtml(linkedEvidence) {
  if (!linkedEvidence.length) return '';
  let i = 0;
  return `<div class="linked-ev">${linkedEvidence
    .map(
      (k) => `<div class="linked-ev-case"><div class="linked-ev-head">${icon('link', 'ico-sm')}<span>Aus Akte <button type="button" class="font-mono text-gold hover:underline" data-action="open-case" data-id="${k.caseId}">${esc(k.caseNumber)}</button> · ${esc(k.clientName)}</span></div>
        <div class="att-grid att-grid-sm">${k.attachments
          .map(
            (a) => `<button type="button" class="att" data-action="att-open" data-linked="${i++}" aria-label="${esc(`B${a.no} aus ${k.caseNumber}${a.caption ? ': ' + a.caption : ''}`)}">
              <img src="${esc(a.thumbUrl || a.url)}" alt="${esc(a.caption)}" loading="lazy" decoding="async"><span class="ev-no">B${a.no}</span></button>`
          )
          .join('')}</div></div>`
    )
    .join('')}</div>`;
}

function attachmentsSection(c, attachments, linkedEvidence = []) {
  const staff = isStaff();
  const canUpload = staff || !c.closed;
  if (!attachments.length && linkedEvidence.length)
    return `<div class="section" id="secEvidence"><h3 class="section-title">Beweismittel & Anhänge <span class="text-xs text-dim font-normal sec-meta">nur aus verknüpften Akten</span></h3>
      ${canUpload ? `<label class="btn-outline btn-sm file-btn mb-3">${icon('camera', 'ico-sm')}<span>Bilder hinzufügen</span><input type="file" accept="image/*" multiple data-upload="evidence" data-case-id="${c.id}" aria-label="Bilder hinzufügen"></label>` : ''}
      ${linkedEvidenceHtml(linkedEvidence)}</div>`;
  if (!attachments.length)
    return emptySection(
      'secEvidence',
      'Beweismittel & Anhänge',
      'noch keine',
      canUpload ? `<label class="btn-outline btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Bilder hinzufügen</span><input type="file" accept="image/*" multiple data-upload="evidence" data-case-id="${c.id}" aria-label="Bilder hinzufügen"></label>` : '',
      `${staff ? 'Fotos, Screenshots und Belege (bis 40 Bilder). Neue Bilder sind zunächst nur für die Kanzlei sichtbar.' : 'Fotos, Screenshots und Belege zu Ihrem Fall (bis 40 Bilder).'} Screenshots auch einfach mit Strg+V einfügen oder ins Fenster ziehen.`
    );
  return `<div class="section" id="secEvidence">
      <h3 class="section-title">Beweismittel & Anhänge <span class="text-xs text-dim font-normal sec-meta">${attachments.length} / 40</span></h3>
      ${canUpload ? `<div class="flex flex-wrap items-center gap-3 mb-3">
          <input id="attCaption" class="field" style="max-width:340px" maxlength="200" placeholder="Beschreibung für neue Bilder (optional)" aria-label="Beschreibung für neue Bilder">
          ${staff ? '<label class="check"><input type="checkbox" id="attInternal" checked> Nur intern (für den Mandanten unsichtbar)</label>' : ''}
        </div>` : ''}
      <div class="att-grid">
        ${attachments
        .map(
          (a, i) => `<button type="button" class="att" data-action="att-open" data-index="${i}" aria-label="${esc(`B${i + 1}${a.caption ? ': ' + a.caption : ''}`)}">
              <img src="${esc(a.thumbUrl || a.url)}" alt="${esc(a.caption)}" loading="lazy" decoding="async"><span class="ev-no">B${i + 1}</span>
              <span class="tag">${a.internal ? '<span class="stamp-mini">Vertraulich</span>' : ''}${a.externalDocId ? badge(extOf(st.caseDocs.find((d) => d.id === a.externalDocId) || {}).name, 'sky') : ''}</span>${a.caption ? `<span class="cap">${esc(a.caption)}</span>` : ''}</button>`
        )
        .join('')}
        ${canUpload && attachments.length < 40
        ? `<label class="att-add file-btn">${icon('camera')}<span>Bilder hinzufügen</span><input type="file" accept="image/*" multiple data-upload="evidence" data-case-id="${c.id}" aria-label="Bilder hinzufügen"></label>`
        : ''}
      </div>
      ${canUpload && attachments.length < 40 ? '<p class="form-hint paste-hint">Tipp: Screenshots einfach mit Strg+V einfügen oder ins Fenster ziehen.</p>' : ''}
      ${linkedEvidenceHtml(linkedEvidence)}
    </div>`;
}

/*
 * Vorschau neben der Akte (ab 1500 px Breite): Ein Klick auf ein Beweisbild zeigt es rechts neben der Akte, ohne das
 * Fenster zu wechseln – mit Blättern, Download und Schwärzen. Auf kleineren Bildschirmen bleibt die Großansicht.
 */
const peekOk = () => window.innerWidth >= 1500 && !!$('#modal.open');
function docPeekOpen(index, linked) {
  const list = linked ? st.linkedAttachments : st.caseAttachments;
  const a = list[index];
  if (!a) return;
  let box = $('#docPeek');
  if (!box) {
    box = document.createElement('aside');
    box.id = 'docPeek';
    box.className = 'doc-peek';
    box.setAttribute('aria-label', 'Vorschau');
    document.body.appendChild(box);
  }
  box.dataset.index = String(index);
  box.dataset.linked = linked ? '1' : '';
  const no = linked ? a.no : index + 1;
  box.innerHTML = `<div class="dp-head"><span class="dp-no">Beweismittel B${no}${linked ? ` · ${esc(a.caseNumber)}` : ''}</span>
      <span class="dp-nav"><button type="button" class="icon-btn sm" data-action="peek-step" data-dir="-1" aria-label="Vorheriges Bild" ${index <= 0 ? 'disabled' : ''}>${icon('chevronLeft', 'ico-sm')}</button><span>${index + 1} / ${list.length}</span><button type="button" class="icon-btn sm" data-action="peek-step" data-dir="1" aria-label="Nächstes Bild" ${index >= list.length - 1 ? 'disabled' : ''}>${icon('chevronRight', 'ico-sm')}</button></span>
      <button type="button" class="icon-btn sm" data-action="peek-close" aria-label="Vorschau schließen" title="Schließen (Esc)">${icon('x', 'ico-sm')}</button></div>
    <div class="dp-img"><img src="${esc(a.url)}" alt="${esc(a.caption)}"></div>
    <div class="dp-meta"><strong>${esc(a.caption || 'Anhang')}</strong><span>${esc(a.uploaderName)} · ${esc(fmtDate(a.createdAt))}${a.internal ? ' · <span class="stamp-mini">Vertraulich</span>' : ''}</span></div>
    <div class="dp-actions"><a class="btn-ghost btn-sm" href="${esc(a.url)}" download>${icon('download', 'ico-sm')}<span>Herunterladen</span></a>${!linked && isStaff() ? `<button type="button" class="btn-ghost btn-sm" data-action="redact-open" data-index="${index}">${icon('edit', 'ico-sm')}<span>Schwärzen</span></button>` : ''}</div>`;
  $('#modal').classList.add('has-peek');
  $$('.att.is-peeked').forEach((b) => b.classList.remove('is-peeked'));
  $(`.att[${linked ? 'data-linked' : 'data-index'}="${index}"]`)?.classList.add('is-peeked');
}
function docPeekClose() {
  $('#docPeek')?.remove();
  $('#modal')?.classList.remove('has-peek');
  $$('.att.is-peeked').forEach((b) => b.classList.remove('is-peeked'));
}

/*
 * Schwärzen (nur Kanzlei): Auf einer Kopie des Beweisbilds Rechtecke ziehen → schwarze Balken. Gespeichert wird eine
 * neue, geschwärzte Kopie als eigenes Beweismittel; das Original bleibt unverändert in der Akte.
 */
const redact = { att: null, index: 0, caseId: 0, img: null, canvas: null, boxes: [], drag: null };
async function redactOpen(index) {
  const a = st.caseAttachments[index];
  if (!a) return;
  const caseId = st.modalCaseId || st.returnCase;
  const blob = await fetch(a.url, { credentials: 'same-origin' }).then((r) => {
    if (!r.ok) throw new Error('Das Bild konnte nicht geladen werden.');
    return r.blob();
  });
  const url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Das Bild konnte nicht geöffnet werden.'));
    i.src = url;
  });
  Object.assign(redact, { att: a, index, caseId, img, boxes: [], drag: null });
  st.returnCase = caseId;
  replaceModal(
    `<p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Beweismittel B${index + 1}</p>
      <h2 class="modal-title">Schwärzen</h2>
      <p class="modal-sub">Mit der Maus bzw. dem Finger Rechtecke über Namen, Nummern oder Gesichter ziehen. Gespeichert wird eine Kopie – das Original bleibt unverändert.</p>
      <div class="redact-wrap"><canvas id="redactCanvas" class="redact-canvas" aria-label="Bild zum Schwärzen"></canvas></div>
      <div class="form-actions mt-3">
        <label class="check mr-auto"><input type="checkbox" id="redactInternal" ${a.internal ? 'checked' : ''}> Kopie nur intern (für den Mandanten unsichtbar)</label>
        <button type="button" class="btn-ghost btn-md" data-action="redact-undo">${icon('restore', 'ico-sm')}<span>Rückgängig</span></button>
        <button type="button" class="btn-gold btn-md" data-action="redact-save">${icon('check', 'ico-sm')}<span>Geschwärzte Kopie speichern</span></button>
      </div>`
  );
  const cv = $('#redactCanvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  redact.canvas = cv;
  redactDraw();
  URL.revokeObjectURL(url);
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const p = pt(e);
    redact.drag = { x: p.x, y: p.y, w: 0, h: 0 };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!redact.drag) return;
    const p = pt(e);
    redact.drag.w = p.x - redact.drag.x;
    redact.drag.h = p.y - redact.drag.y;
    redactDraw();
  });
  const end = () => {
    const d = redact.drag;
    redact.drag = null;
    if (d && Math.abs(d.w) > 4 && Math.abs(d.h) > 4) redact.boxes.push(d);
    redactDraw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
function redactDraw() {
  const { canvas: cv, img, boxes, drag } = redact;
  if (!cv || !img) return;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '#000';
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
  if (drag) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(drag.x, drag.y, drag.w, drag.h);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = Math.max(2, cv.width / 400);
    ctx.strokeRect(drag.x, drag.y, drag.w, drag.h);
  }
}

/* ---------------------------------------------------------------- Aktenübersicht (Kennzahlen im Aktenkopf) */
/**
 * Auf einen Blick (nur Kanzlei): die erste Zeile im Raster der Angaben – nächste Frist, Aufgaben, letzte Aktivität,
 * jeweils Bezeichnung über dem Wert wie alle Angaben; Markierungen (z. B. „in 6 Std“) stehen in einer eigenen Zeile
 * darunter. Ein Klick springt zum Abschnitt. Anzahl der Dokumente und Beweise steht in der Reiterzeile.
 */
function caseStats(c, { appointments, tasks }) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const next = appointments
    .filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff))
    .sort(byStart)[0];
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0).length;
  const fact = (label, value, target, sub = '') =>
    `<button type="button" class="fact" data-action="scroll-to" data-target="${target}"><span class="k">${esc(label)}</span><span class="v">${value}</span>${sub ? `<span class="fact-sub">${sub}</span>` : ''}</button>`;
  return [
    fact('Nächste Frist / Termin', next ? esc(next.title) : '<span class="text-dim">keine</span>', 'secEvents', next ? countdownHtml(next) : ''),
    fact('Aufgaben', open.length ? `${open.length} offen` : '<span class="text-dim">keine offen</span>', 'secTasks', overdue ? `<span class="countdown cd-over">${overdue} überfällig</span>` : ''),
    c.canManageLawyers
      ? `<button type="button" class="fact" data-action="case-team-edit" data-id="${c.id}" title="Zuständige ändern"><span class="k">Zuständig</span><span class="v">${whoHtml(c, { duty: true })}</span></button>`
      : `<div class="fact"><span class="k">Zuständig</span><span class="v">${whoHtml(c, { duty: true })}</span></div>`,
    fact('Letzte Aktivität', c.idleDays ? `<span class="is-idle">${esc(relDays(c.updatedAt))}</span>` : esc(relDays(c.updatedAt)), 'secNotes'),
  ].join('');
}
