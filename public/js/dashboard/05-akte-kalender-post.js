/*
 * Kanzlei-Dashboard – Teil 5 von 12: Akte: Aufgaben & Wiedervorlagen, Tickets, Aktenansicht · Kalender, Kanzlei-Post, Pinnwand.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen */
function taskItem(t, { showCase = true } = {}) {
  const due = dueInfo(t.dueDate, t.done);
  const meta = [
    showCase && t.caseNumber ? `<button type="button" class="link-btn font-mono" data-action="open-case" data-id="${t.caseId}" title="${esc(t.caseTitle || '')}">${esc(t.caseNumber)}</button>` : null,
    t.assignedName ? esc(t.assignedName) : '<span class="text-amber-300">niemand zuständig</span>',
    t.done && t.doneByName ? `erledigt von ${esc(t.doneByName)}` : null,
  ].filter(Boolean);
  return `<div class="task-row ${t.done ? 'is-done' : ''}">
      <button type="button" class="task-check" data-action="task-toggle" data-id="${t.id}" data-done="${t.done ? 1 : 0}" aria-label="${t.done ? 'Wieder öffnen' : 'Als erledigt markieren'}" title="${t.done ? 'Wieder öffnen' : 'Erledigt'}">${t.done ? icon('check', 'ico-sm') : ''}</button>
      <div class="main"><div class="title">${esc(t.title)}</div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}<div class="meta">${meta.join(' · ')}</div></div>
      <div class="side">${due ? `<span class="countdown ${due.cls}">${esc(due.text)}</span>` : ''}
        <span class="task-actions"><button type="button" class="icon-btn sm" data-action="task-edit" data-id="${t.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="task-delete" data-id="${t.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></span></div>
    </div>`;
}

function caseTasksSection(c, tasks) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  return `<div class="section" id="secTasks">
      <h3 class="section-title">Aufgaben & Wiedervorlagen <span class="text-xs text-dim font-normal" style="font-family:Inter,sans-serif">${open.length} offen · ${done.length} erledigt</span></h3>
      ${tasks.length ? `<div class="task-list">${open.map((t) => taskItem(t, { showCase: false })).join('')}${done.map((t) => taskItem(t, { showCase: false })).join('')}</div>` : '<p class="text-sm text-dim mb-2">Noch keine Aufgaben. Wiedervorlage mit Datum anlegen oder die Checkliste für dieses Rechtsgebiet übernehmen.</p>'}
      <form data-form="task-quick" data-case-id="${c.id}" class="task-quick mt-3">
        <input name="title" class="field" required minlength="2" maxlength="160" placeholder="Neue Aufgabe oder Wiedervorlage …" aria-label="Neue Aufgabe">
        <input name="dueDate" type="date" class="field" aria-label="Fällig am" title="Fällig am (Wiedervorlage)">
        <button type="submit" class="btn-outline btn-md">${icon('plus', 'ico-sm')}<span>Hinzufügen</span></button>
      </form>
      <div class="task-extra">
        <button type="button" class="btn-ghost btn-sm" data-action="task-checklist" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Checkliste ${esc(AREAS[c.area] || '')} übernehmen</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="task-new" data-case-id="${c.id}">${icon('calendar', 'ico-sm')}<span>Mit Zuständigkeit & Notiz …</span></button>
      </div>
    </div>`;
}

function findTask(id) {
  return [...st.caseTasks, ...st.tasks, ...st.myTasks].find((t) => t.id === id) || null;
}

function taskModal(t, preset = {}) {
  const caseId = t ? t.caseId : preset.caseId || null;
  const assignee = t ? t.assignedTo : preset.assignedTo ?? st.user.id;
  const activeCases = st.cases.filter((c) => c.status !== 'geschlossen' || c.id === caseId);
  openModal(`
      <h2 id="modalTitle" class="modal-title">${t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
      <p class="modal-sub">Mit Datum wird die Aufgabe zur Wiedervorlage und erscheint rechtzeitig unter „Handlungsbedarf“.</p>
      <form data-form="task" ${t ? `data-id="${t.id}"` : ''} class="form-grid cols-2">
        <div class="span-2"><label class="label">Aufgabe</label><input name="title" class="field" required minlength="2" maxlength="160" value="${esc(t ? t.title : '')}" autofocus></div>
        <div><label class="label">Fällig am (Wiedervorlage)</label><input name="dueDate" type="date" class="field" value="${esc(t ? t.dueDate || '' : '')}"></div>
        <div><label class="label">Zuständig</label><select name="assignedTo" class="field"><option value="">Niemand</option>${st.lawyers.map((l) => opt(l.id, l.displayName, l.id === assignee)).join('')}</select></div>
        <div class="span-2"><label class="label">Akte (optional)</label><select name="caseId" class="field" ${t ? 'disabled title="Der Aktenbezug lässt sich nachträglich nicht ändern."' : ''}><option value="">Ohne Aktenbezug</option>${activeCases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId)).join('')}</select></div>
        <div class="span-2"><label class="label">Notiz</label><textarea name="note" rows="3" maxlength="1000" class="field">${esc(t ? t.note : '')}</textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button></div>
      </form>`);
}

async function afterTaskChange() {
  load.dueTasks().then(renderNav).catch(() => {});
  if (st.modalCaseId && $('#secTasks')) await reloadCase(st.modalCaseId);
  else await refreshBehind();
}

/** Board-Ticket einer Bewerbung bzw. eines Anliegens (nur Board of Partners). */
function boardTicketLine(kind, id, t) {
  if (!t) return '';
  const open = t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="btn-discord btn-sm">${DISCORD_ICON}<span>In Discord öffnen</span></a>` : '';
  return `<div class="banner banner-discord items-center justify-between flex-wrap mt-4">
      <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>Discord-Ticket (Board)</strong>${t.exists ? (t.archived ? badge('archiviert', 'slate') : badge('aktiv', 'emerald')) : t.deleted ? badge('per /delete gelöscht', 'slate') : badge('noch nicht angelegt', 'amber')}</div>
        ${t.error ? `<div class="text-xs text-red-300 mt-1">${icon('alert', 'ico-sm')} ${esc(t.error)}</div>` : ''}</div>
      <div class="flex flex-wrap gap-2">${open}<button class="btn-outline btn-sm" data-action="board-ticket-sync" data-kind="${kind}" data-id="${id}">${t.exists ? 'Abgleichen' : t.deleted ? 'Neu anlegen' : 'Ticket anlegen'}</button></div></div>`;
}

/** Discord-Ticket der Akte (nur wenn Discord-Tickets eingerichtet sind). */
function ticketBanner(c, t) {
  if (!t) return '';
  const open = t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="btn-discord btn-sm">${DISCORD_ICON}<span>In Discord öffnen</span></a>` : '';
  if (!isStaff()) {
    if (t.deleted) return ''; // Ticket wurde von der Kanzlei gelöscht
    if (t.clientInTicket) return `<div class="banner banner-discord items-center justify-between flex-wrap"><div><strong>Ihr Discord-Ticket</strong><div class="text-sm text-muted">Alle Neuigkeiten zu dieser Akte erscheinen automatisch in Ihrem privaten Discord-Kanal.</div></div>${open}</div>`;
    if (t.clientLinked)
      return `<div class="banner banner-discord items-center justify-between flex-wrap"><div><strong>Discord-Ticket</strong><div class="text-sm text-muted">Sie werden automatisch hinzugefügt, sobald Sie auf dem Discord-Server der Kanzlei sind.</div></div><button class="btn-outline btn-sm" data-action="ticket-sync" data-id="${c.id}">Erneut prüfen</button></div>`;
    return `<div class="banner banner-discord items-center justify-between flex-wrap"><div><strong>Discord-Ticket</strong><div class="text-sm text-muted">Verbinden Sie Ihr Discord-Konto – dann kommen Sie automatisch in das private Ticket zu Ihrer Akte.</div></div><a href="/api/discord/connect" class="btn-discord btn-sm">${DISCORD_ICON}<span>Discord verbinden</span></a></div>`;
  }
  const client = t.clientInTicket
    ? badge('Mandant im Ticket', 'emerald')
    : t.clientLinked
      ? badge('Mandant nicht auf dem Server', 'amber')
      : badge(c.hasClientAccount ? 'Mandant: Discord nicht verknüpft' : 'Mandant noch nicht beigetreten', 'slate');
  return `<div class="banner banner-discord items-center justify-between flex-wrap">
      <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>Discord-Ticket</strong>${t.exists ? (t.archived ? badge('archiviert', 'slate') : badge('aktiv', 'emerald')) : t.deleted ? badge('per /delete gelöscht', 'slate') : badge('noch nicht angelegt', 'amber')}${t.exists ? client : ''}</div>
        <div class="text-xs text-dim mt-1">${t.exists ? 'Status, Zuständigkeit, Nachrichten, Termine, Verträge und Rechnungen erscheinen automatisch im Kanal – interne Notizen nie.' : t.deleted ? 'Das Ticket wurde im Discord gelöscht und wird nicht automatisch neu angelegt. „Neu anlegen“ erstellt einen frischen Kanal.' : 'Wird automatisch angelegt; hier von Hand anlegen, falls es fehlt.'}${!t.clientInTicket && !c.hasClientAccount ? ' Mandanten ohne Konto treten direkt nach dem Einreichen auf der Website bei – sonst im Ticket mit /add hinzufügen.' : ''}</div>
        ${t.error ? `<div class="text-xs text-red-300 mt-1">${icon('alert', 'ico-sm')} ${esc(t.error)}</div>` : ''}</div>
      <div class="flex flex-wrap gap-2">${open}<button class="btn-outline btn-sm" data-action="ticket-sync" data-id="${c.id}">${t.exists ? 'Abgleichen' : t.deleted ? 'Neu anlegen' : 'Ticket anlegen'}</button></div></div>`;
}

/** Prozessticket: Link zum Kanal auf einem anderen Discord (z. B. DOJ) – nur für die Kanzlei. */
function processTicketBanner(c) {
  if (!isStaff()) return '';
  const pt = c.processTicket;
  const form = c.canEdit
    ? `<div id="ptBox" class="pt-box" hidden>
          <form data-form="process-ticket" data-id="${c.id}" class="form-grid cols-2">
            <div class="span-2"><label class="label" for="ptUrl">Link zum Kanal des Prozesstickets</label><input id="ptUrl" name="url" class="field" required maxlength="300" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://discord.com/channels/…/…" value="${esc(pt ? pt.url : '')}"></div>
            <div class="span-2"><label class="label" for="ptLabel">Bezeichnung (optional)</label><input id="ptLabel" name="label" class="field" maxlength="80" placeholder="z. B. DOJ – Hauptverhandlung" value="${esc(pt ? pt.label : '')}"></div>
            <p class="span-2 text-xs text-dim">Im Discord des DOJ: Rechtsklick auf den Kanal (am Handy lange drücken) → „Link kopieren“ und hier einfügen. Nur für die Kanzlei sichtbar – der Mandant sieht das Prozessticket nicht.</p>
            <div class="span-2 form-actions"><button type="button" class="btn-ghost btn-sm" data-action="pt-toggle">Abbrechen</button><button type="submit" class="btn-discord btn-sm">${DISCORD_ICON}<span>${pt ? 'Speichern' : 'Prozessticket hinzufügen'}</span></button></div>
          </form></div>`
    : '';
  if (!pt) return form;
  return `<div class="banner banner-discord items-center justify-between flex-wrap">
      <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>Prozessticket</strong>${badge('DOJ-Discord', 'sky')}</div>
        ${pt.label ? `<div class="text-sm mt-1 break-words">${esc(pt.label)}</div>` : ''}
        <div class="text-xs text-dim mt-1">Kanal auf einem anderen Discord-Server · nur für die Kanzlei sichtbar</div></div>
      <div class="flex flex-wrap gap-2"><a href="${esc(pt.url)}" target="_blank" rel="noopener noreferrer" class="btn-discord btn-sm">${DISCORD_ICON}<span>Prozessticket öffnen</span></a>${
      c.canEdit ? `<button class="btn-outline btn-sm" data-action="pt-toggle">Ändern</button><button class="btn-ghost btn-sm" data-action="pt-remove" data-id="${c.id}">Entfernen</button>` : ''
    }</div>
      ${form}</div>`;
}

/** Darf das Mandanten-Konto der Akte verknüpfen/lösen: zuständige Anwälte und Board of Partners. */
const canLinkClient = (c) => isStaff() && (c.canEdit || isBoard());

/** Akte ohne Mandanten-Konto: passende Konten (gleicher Name) vorschlagen. */
function clientLinkBanner(c, suggestions) {
  if (c.hasClientAccount || !canLinkClient(c) || !suggestions || !suggestions.length) return '';
  return `<div class="banner banner-amber items-start justify-between flex-wrap">
      <div class="min-w-0"><strong>${suggestions.length === 1 ? 'Passendes Mandanten-Konto gefunden' : 'Passende Mandanten-Konten gefunden'}</strong>
        <div class="text-sm text-muted">Die Akte hat noch kein Website-Konto. Hat sich ${esc(c.clientName === '—' ? 'der Mandant' : c.clientName)} inzwischen registriert? Nach dem Verknüpfen sieht der Mandant die Akte unter „Meine Akten“.</div>
        <div class="mt-3 space-y-2">${suggestions
        .map(
          (a) => `<div class="flex flex-wrap items-center gap-2"><span class="text-sm font-medium">${esc(a.name)}</span><span class="text-xs text-dim">${esc(a.email)}${a.createdAt ? ` · registriert ${esc(fmtDateOnly(String(a.createdAt).slice(0, 10)))}` : ''}</span>
              <button class="btn-gold btn-sm" data-action="case-link-client" data-id="${c.id}" data-client="${a.id}" data-name="${esc(a.name)}">Verknüpfen</button></div>`
        )
        .join('')}</div></div>
      <button class="btn-outline btn-sm" data-action="case-client-search" data-id="${c.id}">Anderes Konto suchen</button></div>`;
}

function clientAccountList(c, accounts) {
  if (!accounts.length) return '<p class="text-sm text-dim py-4">Kein passendes Mandanten-Konto gefunden. Der Mandant muss sich zuerst auf der Website registrieren.</p>';
  return accounts
    .map(
      (a) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(a.name)}${a.suggested ? ' ' + badge('passt zum Namen in der Akte', 'emerald') : ''}${a.id === c.clientId ? ' ' + badge('aktuell verknüpft', 'slate') : ''}</div>
          <div class="meta">${esc([a.email, a.phone, a.createdAt ? `registriert ${fmtDateOnly(String(a.createdAt).slice(0, 10))}` : ''].filter(Boolean).join(' · '))}</div></div>
          ${a.id === c.clientId ? '' : `<button class="btn-gold btn-sm shrink-0" data-action="case-link-client" data-id="${c.id}" data-client="${a.id}" data-name="${esc(a.name)}">Verknüpfen</button>`}</div>`
    )
    .join('');
}

function clientSearchDialog(c, accounts) {
  return `
      <h2 id="modalTitle" class="modal-title">Mandanten-Konto verknüpfen</h2>
      <p class="modal-sub">Akte <span class="font-mono text-gold">${esc(c.caseNumber)}</span>${c.clientName && c.clientName !== '—' ? ` · Mandant laut Akte: <strong>${esc(c.clientName)}</strong>` : ''}. Wählen Sie das Website-Konto des Mandanten – danach sieht er die Akte mit Terminen, Verträgen, Rechnungen und Nachrichten in seinem Portal${c.hasClientAccount ? '. Das bisher verknüpfte Konto verliert den Zugriff' : ''}.</p>
      <input id="clientAccSearch" class="field" type="search" maxlength="80" placeholder="Name oder E-Mail suchen …" autocomplete="off" data-case-id="${c.id}" aria-label="Mandanten-Konto suchen" autofocus>
      <div id="clientAccList" class="mt-4">${clientAccountList(c, accounts)}</div>
      <div class="form-actions mt-4"><button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button></div>`;
}

async function searchClientAccounts(input) {
  const c = st.caseInfo;
  if (!c || String(c.id) !== input.dataset.caseId) return;
  const q = input.value.trim();
  const { accounts } = await api.get(`/api/cases/client-accounts?caseId=${c.id}&q=${encodeURIComponent(q)}`);
  if (input.isConnected && input.value.trim() === q) $('#clientAccList').innerHTML = clientAccountList(c, accounts);
}

/** Priorität direkt in der Akte ändern (Auswahl neben dem Status). */
async function setCasePriority(sel) {
  const id = Number(sel.dataset.id);
  const priority = Number(sel.value);
  try {
    await api.patch('/api/cases/' + id, { priority });
  } catch (err) {
    sel.value = sel.dataset.value;
    throw err;
  }
  toast(`Priorität: ${PRIORITY[priority][0]}`);
  await reloadCase(id);
}

function caseDetail({ case: c, notes, appointments, invoices, attachments = [], externalDocs = [], tasks = [], contracts = [], work, ticket, clientSuggestions, review }) {
  const staff = isStaff();
  const admin = isAdmin();
  const me = st.user.id;
  const ratio = c.closed ? 1 : c.step / 3;

  // Bearbeitungsstand: zuständige Anwälte klicken den gewünschten Schritt direkt an
  const stepEditable = c.canEdit && !c.closed;
  const track = `
      <div class="track ${stepEditable ? 'is-editable' : ''} mb-6">
        ${stepEditable ? '<div class="track-head"><span>Bearbeitungsstand</span><span class="track-hint">Schritt anklicken, um ihn zu ändern</span></div>' : ''}
        <div class="track-line"><div class="track-fill" style="width:${ratio * 75}%"></div>
        <div class="grid grid-cols-4">${STEPS.map((s, i) => {
        const done = c.closed || i < c.step;
        const cur = !c.closed && i === c.step;
        const inner = `<div class="track-node ${done ? 'done' : cur ? 'current' : ''}">${done ? '✓' : i + 1}</div><span class="track-label text-[0.7rem] sm:text-xs text-muted text-center">${s}</span>`;
        return stepEditable && !cur
          ? `<button type="button" class="track-step" data-action="case-step" data-id="${c.id}" data-step="${i}" title="Bearbeitungsstand: ${esc(s)}" aria-label="Bearbeitungsstand auf „${esc(s)}“ setzen">${inner}</button>`
          : `<div class="track-step" ${cur ? 'aria-current="step"' : ''}>${inner}</div>`;
      }).join('')}</div></div></div>`;

  const info = [
    ['Mandant', c.clientName + (staff && !c.hasClientAccount ? ' (ohne Konto)' : '')],
    staff ? ['Kontakt', [c.clientPhone, c.clientEmail].filter(Boolean).join(' · ') || '—'] : null,
    [caseTeam(c).length > 1 ? 'Zuständige Anwälte' : 'Zuständig', teamText(c)],
    ['Rechtsgebiet', AREAS[c.area] || c.area],
    [staff ? 'Dringlichkeit (Angabe Mandant)' : 'Dringlichkeit', (URGENCY[c.urgency] || [c.urgency])[0]],
    c.opponent ? ['Gegenpartei', c.opponent] : null,
    c.courtRef ? ['Gerichtsaktenzeichen', c.courtRef] : null,
    ['Eröffnet', fmtDate(c.createdAt)],
    staff ? ['Eingang über', SOURCES[c.source] || c.source] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`)
    .join('');

  const statusSeg = c.canEdit
    ? `<div class="case-controls mb-5"><div class="chip-row" role="group" aria-label="Status ändern">${Object.entries(CASE_STATUS)
        .map(([k, [l]]) => `<button type="button" class="chip ${c.status === k ? 'active' : ''}" data-action="case-status" data-id="${c.id}" data-status="${k}">${esc(l)}</button>`)
        .join('')}</div>${
        staff
          ? `<label class="case-prio prio-${c.priority || 2}"><span>Priorität</span><select class="field" data-case-priority data-id="${c.id}" data-value="${c.priority || 2}" aria-label="Priorität der Akte">${Object.entries(PRIORITY)
              .map(([k, [l]]) => opt(k, l, Number(k) === (c.priority || 2)))
              .join('')}</select></label>`
          : ''
      }</div>`
    : '';

  const claim = c.canClaim
    ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div>${icon('alert')} Diese Akte hat noch keinen zuständigen Anwalt.</div><button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Akte übernehmen</button></div>`
    : '';

  const quick = [];
  if (staff) {
    quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button>`);
    quick.push(`<button class="btn-outline btn-sm" data-action="new-invoice" data-case-id="${c.id}">${icon('receipt', 'ico-sm')}<span>Rechnung</span></button>`);
    quick.push(`<a class="btn-outline btn-sm" href="/aktenauszug.html?id=${c.id}" target="_blank" rel="noopener">${icon('printer', 'ico-sm')}<span>Aktenauszug (PDF)</span></a>`);
    if (c.clientId) quick.push(`<button class="btn-outline btn-sm" data-action="compose" data-recipient="${c.clientId}" data-case-id="${c.id}" data-return-case="${c.id}">${icon('mail', 'ico-sm')}<span>Mandant anschreiben</span></button>`);
    if (!c.hasClientAccount && canLinkClient(c)) quick.push(`<button class="btn-outline btn-sm" data-action="case-client-search" data-id="${c.id}">${icon('user', 'ico-sm')}<span>Mandanten-Konto verknüpfen</span></button>`);
    if (!c.processTicket && c.canEdit) quick.push(`<button class="btn-outline btn-sm" data-action="pt-toggle">${icon('plus', 'ico-sm')}<span>Prozessticket (DOJ)</span></button>`);
    if (c.lawyerId === me) quick.push(`<button class="btn-ghost btn-sm" data-action="release-case" data-id="${c.id}">Akte abgeben</button>`);
    if (c.isCoLawyer) quick.push(`<button class="btn-ghost btn-sm" data-action="leave-case" data-id="${c.id}">Mitarbeit beenden</button>`);
    if (admin) quick.push(`<button class="btn-danger btn-sm" data-action="delete-case" data-id="${c.id}" data-number="${esc(c.caseNumber)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>`);
  } else {
    if (!c.closed) quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button>`);
    quick.push(`<button class="btn-outline btn-sm" data-action="compose" ${c.lawyerId ? `data-recipient="${c.lawyerId}"` : ''} data-case-id="${c.id}" data-return-case="${c.id}">${icon('mail', 'ico-sm')}<span>Nachricht zur Akte</span></button>`);
    quick.push(`<a class="btn-outline btn-sm" href="/aktenauszug.html?id=${c.id}" target="_blank" rel="noopener">${icon('printer', 'ico-sm')}<span>Aktenauszug (PDF)</span></a>`);
  }

  const editForm = c.canEdit
    ? `<details class="edit-box section">
          <summary>Akte bearbeiten</summary>
          <form data-form="case-edit" data-id="${c.id}" class="form-grid cols-2">
            <div class="span-2"><label class="label">Titel</label><input name="title" class="field" required minlength="3" maxlength="120" value="${esc(c.title)}"></div>
            <div><label class="label">Rechtsgebiet</label><select name="area" class="field">${Object.entries(AREAS).map(([k, l]) => opt(k, l, c.area === k)).join('')}</select></div>
            <div><label class="label">Dringlichkeit (Angabe Mandant)</label><select name="urgency" class="field">${Object.entries(URGENCY).map(([k, [l]]) => opt(k, l, c.urgency === k)).join('')}</select></div>
            <div><label class="label">Verfahrensstand</label><select name="step" class="field">${STEPS.map((s, i) => opt(i, s, c.step === i)).join('')}</select></div>
            ${staff ? `<div><label class="label">Priorität (nur intern)</label><select name="priority" class="field">${Object.entries(PRIORITY).map(([k, [l]]) => opt(k, l, Number(k) === (c.priority || 2))).join('')}</select></div>` : ''}
            ${c.hasClientAccount && canLinkClient(c) ? `<div class="span-2 flex flex-wrap items-center justify-between gap-2 text-sm"><div><span class="text-xs uppercase tracking-widest text-dim mr-1">Mandanten-Konto</span> <strong>${esc(c.clientName)}</strong>${c.clientEmail ? ` <span class="text-dim">· ${esc(c.clientEmail)}</span>` : ''}</div><div class="flex flex-wrap gap-2">${isBoard() && c.clientId ? `<button type="button" class="btn-outline btn-sm" data-action="name-direct" data-user-id="${c.clientId}" data-name="${esc(c.clientName)}" data-email="${esc(c.clientEmail || '')}" data-return-case="${c.id}">Name korrigieren</button>` : ''}<button type="button" class="btn-outline btn-sm" data-action="case-client-search" data-id="${c.id}">Anderes Konto</button><button type="button" class="btn-ghost btn-sm" data-action="case-unlink-client" data-id="${c.id}">Verknüpfung lösen</button></div></div>` : ''}
            ${!c.hasClientAccount ? `<div><label class="label">Mandant</label><input name="clientName" class="field" maxlength="80" value="${esc(c.clientName === '—' ? '' : c.clientName)}"></div>` : ''}
            <div><label class="label">Telefon Mandant</label><input name="clientPhone" class="field" maxlength="40" value="${esc(c.clientPhone || '')}"></div>
            <div><label class="label">Gegenpartei</label><input name="opponent" class="field" maxlength="120" value="${esc(c.opponent)}"></div>
            <div><label class="label">Gerichtsaktenzeichen</label><input name="courtRef" class="field" maxlength="60" value="${esc(c.courtRef)}"></div>
            ${c.canManageLawyers ? lawyerPicker({ leadId: c.lawyerId, coIds: (c.coLawyers || []).map((l) => l.id), withLead: admin, extra: caseTeam(c) }) : ''}
            <div class="span-2"><label class="label">Sachverhalt</label><textarea name="description" rows="5" maxlength="4000" class="field">${esc(c.description)}</textarea></div>
            <div class="span-2"><label class="label">Statushinweis (sichtbar für den Mandanten und in der öffentlichen Abfrage)</label><textarea name="publicNote" rows="2" maxlength="500" class="field">${esc(c.publicNote)}</textarea></div>
            <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Änderungen speichern</span></button></div>
          </form></details>`
    : '';

  const apptList = appointments.length
    ? appointments.map((e) => eventRow(e)).join('')
    : '<p class="text-sm text-dim">Keine Termine oder Fristen zu dieser Akte.</p>';

  const invoiceList = invoices.length
    ? invoices
        .map(
          (i) => `<div class="list-row wrap"><div class="main"><div class="title"><span class="font-mono text-gold">${esc(i.number)}</span> · ${esc(INVOICE_KIND[i.kind])}</div><div class="meta">${esc(fmtDate(i.createdAt))} · ${esc(i.issuerName)}</div></div>
            <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end"><span class="font-mono nowrap">${money(i.total)}</span>${invoiceBadge(i)}<a class="icon-btn sm" href="/invoice.html?id=${i.id}" target="_blank" rel="noopener" aria-label="Drucken / PDF">${icon('printer', 'ico-sm')}</a></div></div>`
        )
        .join('')
    : '';

  const noteList = notes.length
    ? `<div class="timeline">${notes
        .map((n) => {
          const canDelete = !n.system && (n.authorId === me || admin);
          return `<div class="tl-item ${n.internal ? 'tl-internal' : ''} ${n.system ? 'tl-system' : ''}">
              <div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span>${n.authorRole && ROLES[n.authorRole] ? `<span>${esc(ROLES[n.authorRole])}</span>` : ''}<span>${esc(fmtDate(n.createdAt))}</span>${n.internal ? badge('intern', 'amber') : ''}
              ${canDelete ? `<button class="ml-auto text-dim hover:text-red-300" data-action="delete-note" data-case-id="${c.id}" data-id="${n.id}" aria-label="Notiz löschen">${icon('trash', 'ico-sm')}</button>` : ''}</div>
              <div class="tl-body">${esc(n.body)}</div></div>`;
        })
        .join('')}</div>`
    : '<p class="text-sm text-dim">Noch keine Einträge.</p>';

  return `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5 pr-12">
        <div class="min-w-0"><div class="font-mono text-gold text-sm">${esc(c.caseNumber)}</div>
          <h2 id="modalTitle" class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(c.title)}</h2></div>
        <div class="flex flex-wrap gap-2">${memberBadge(c.membership)}${statusBadge(CASE_STATUS, c.status)}${caseLevelBadge(c)}</div>
      </div>
      ${claim}
      ${statusSeg}
      ${track}
      ${staff ? caseStats(c, { appointments, attachments, externalDocs, tasks }) : ''}
      <div class="info-grid mb-5">${info}</div>
      ${clientLinkBanner(c, clientSuggestions)}
      ${ticketBanner(c, ticket)}
      ${processTicketBanner(c)}
      ${quick.length ? `<div class="form-actions mb-2">${quick.join('')}</div>` : ''}
      ${editForm}
      ${staff ? '' : reviewSection(c, review)}
      <div class="section"><h3 class="section-title">Sachverhalt</h3><p class="text-sm whitespace-pre-wrap text-muted">${esc(c.description || '—')}</p></div>
      ${c.publicNote ? `<div class="section"><h3 class="section-title">Statushinweis</h3><div class="banner banner-gold mb-0"><p class="text-sm whitespace-pre-wrap">${esc(c.publicNote)}</p></div></div>` : ''}
      <div class="section" id="secEvents"><h3 class="section-title">Termine & Fristen</h3>${apptList}</div>
      ${staff ? caseTasksSection(c, tasks) : ''}
      ${contractsSection(c, contracts.filter((k) => k.kind !== 'schriftsatz'))}
      ${briefsSection(c, contracts.filter((k) => k.kind === 'schriftsatz'))}
      ${invoiceList ? `<div class="section"><h3 class="section-title">Rechnungen & Honorare</h3>${invoiceList}</div>` : ''}
      ${externalSection(c, externalDocs)}
      ${attachmentsSection(c, attachments)}
      ${caseWorkSection(c, work)}
      <div class="section" id="secNotes"><h3 class="section-title">Verlauf & Notizen</h3>
        ${noteList}
        <form data-form="add-note" data-id="${c.id}" class="mt-4 space-y-3">
          <textarea name="body" rows="3" maxlength="4000" required class="field" placeholder="${staff ? 'Notiz, Telefonat, Beweismittel, nächster Schritt …' : 'Nachricht oder Ergänzung zu Ihrer Akte …'}" aria-label="Neue Notiz"></textarea>
          <div class="flex flex-wrap items-center justify-between gap-3">
            ${staff ? '<label class="check"><input type="checkbox" name="internal" checked> Nur intern (für den Mandanten unsichtbar)</label>' : '<span></span>'}
            <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Speichern</span></button>
          </div>
        </form>
      </div>`;
}

async function newCaseModal() {
  const staff = isStaff();
  if (staff) await load.lawyers();
  openModal(`
      <h2 class="modal-title">${staff ? 'Neue Akte anlegen' : 'Mandat einreichen'}</h2>
      <p class="modal-sub">${staff ? 'Mandanten ohne Website-Konto einfach per Name erfassen. Die Akte wird Ihnen direkt zugewiesen – weitere Anwälte können Sie unten hinzufügen.' : 'Schildern Sie Ihr Anliegen – ein Anwalt der Kanzlei meldet sich umgehend.'}</p>
      <form data-form="new-case" class="form-grid cols-2">
        ${staff ? `
          <div><label class="label" for="ncName">Mandant (Name)</label><input id="ncName" name="clientName" class="field" maxlength="80" placeholder="z. B. John Doe" autofocus></div>
          <div><label class="label" for="ncPhone">Telefon (im Spiel)</label><input id="ncPhone" name="clientPhone" class="field" maxlength="40" placeholder="555-0123"></div>
          <div class="span-2"><label class="label" for="ncEmail">…oder Login-E-Mail eines registrierten Mandanten (optional)</label><input id="ncEmail" name="clientEmail" type="text" autocapitalize="none" spellcheck="false" class="field" placeholder="z. B. max.mustermann@pake-scha.ls – verknüpft die Akte mit dem Konto"></div>` : ''}
        <div class="span-2"><label class="label" for="ncTitle">Titel</label><input id="ncTitle" name="title" class="field" required minlength="3" maxlength="120" placeholder="z. B. Festnahme am Legion Square" ${staff ? '' : 'autofocus'}></div>
        <div><label class="label">Rechtsgebiet</label><select name="area" class="field">${Object.entries(AREAS).map(([k, l]) => opt(k, l)).join('')}</select></div>
        <div><label class="label">${staff ? 'Dringlichkeit (Angabe Mandant)' : 'Dringlichkeit'}</label><select name="urgency" class="field">${Object.entries(URGENCY).map(([k, [l]]) => opt(k, l)).join('')}</select></div>
        ${staff ? `<div><label class="label">Priorität (nur intern)</label><select name="priority" class="field">${opt('', 'Automatisch – nach Dringlichkeit', true)}${Object.entries(PRIORITY).map(([k, [l]]) => opt(k, l)).join('')}</select></div>
          <div class="self-end text-xs text-dim pb-2">Normal → Normale, Eilig → Hohe, Notfall → Kritische Priorität. Später jederzeit in der Akte änderbar.</div>` : ''}
        ${staff ? `<div><label class="label">Gegenpartei</label><input name="opponent" class="field" maxlength="120" placeholder="optional"></div>
          <div><label class="label">Gerichtsaktenzeichen</label><input name="courtRef" class="field" maxlength="60" placeholder="optional"></div>` : ''}
        ${staff ? lawyerPicker({ leadId: st.user.id, withLead: isAdmin(), emptyLead: 'Noch niemand (offene Anfrage)' }) : ''}
        <div class="span-2"><label class="label">Sachverhalt</label><textarea name="description" rows="5" class="field" ${staff ? '' : 'required minlength="10"'} maxlength="4000" placeholder="Was ist passiert? Wer ist beteiligt? Gibt es bereits Fristen oder Termine?"></textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${staff ? 'Akte anlegen' : 'Mandat einreichen'}</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Kalender */
function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function calendarStaff() {
  const m = st.cal.month;
  const y = m.getFullYear();
  const mo = m.getMonth();
  const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // Montag zuerst
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

  const byDay = new Map();
  st.events
    .filter((e) => st.cal.types[e.type] && e.status !== 'abgesagt')
    .forEach((e) => {
      const d = parseDate(e.startsAt);
      if (!d) return;
      const k = dayKey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    });
  byDay.forEach((list) => list.sort(byStart));

  const todayKey = dayKey(new Date());
  let grid = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < cells; i++) {
    const d = new Date(y, mo, 1 - offset + i);
    const k = dayKey(d);
    const evs = byDay.get(k) || [];
    const label = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (evs.length ? `, ${evs.length} Einträge` : '');
    grid += `<button type="button" class="cal-day ${d.getMonth() !== mo ? 'muted' : ''} ${k === todayKey ? 'today' : ''} ${k === st.cal.selected ? 'selected' : ''}" data-action="cal-select" data-day="${k}" aria-label="${esc(label)}">
        <span class="cal-num">${d.getDate()}</span>
        ${evs.slice(0, 3).map((e) => `<span class="cal-ev t-${esc(e.type)} ${e.status === 'erledigt' ? 'line-through opacity-60' : ''}">${esc(fmtTime(e.startsAt))} ${esc(e.title)}</span>`).join('')}
        ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} weitere</span>` : ''}
        ${evs.length ? `<span class="cal-dots">${evs.slice(0, 4).map((e) => `<i class="cal-dot" style="background:${EVENT_COLORS[e.type]}"></i>`).join('')}</span>` : ''}
      </button>`;
  }

  const selected = byDay.get(st.cal.selected) || [];
  const selDate = new Date(`${st.cal.selected}T12:00:00`);
  const deadlines = st.events.filter((e) => e.type === 'frist' && e.status === 'bestaetigt').sort(byStart).slice(0, 8);
  const requests = st.events.filter((e) => e.status === 'angefragt').sort(byStart);

  return `
      <div class="page-head">
        <div><h1 class="page-title">Kalender & Fristen</h1><p class="page-sub">Gerichtstermine, Mandantengespräche und Fristen des ganzen Teams – mit Live-Countdown.</p></div>
        <div class="page-actions"><button class="btn-gold btn-md" data-action="new-event" data-day="${st.cal.selected}">${icon('plus')}<span>Neuer Eintrag</span></button></div>
      </div>
      ${requests.length ? `<section class="panel panel-pad mb-4"><div class="panel-head"><h2 class="panel-title">Terminanfragen von Mandanten</h2>${badge(`${requests.length} offen`, 'amber')}</div>${requests.map((e) => eventRow(e)).join('')}</section>` : ''}
      <div class="cal-layout">
        <section class="panel panel-pad">
          <div class="cal-toolbar">
            <button class="icon-btn" data-action="cal-nav" data-dir="-1" aria-label="Vorheriger Monat">${icon('chevronLeft')}</button>
            <div class="cal-month">${esc(m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }))}</div>
            <button class="icon-btn" data-action="cal-nav" data-dir="1" aria-label="Nächster Monat">${icon('chevronRight')}</button>
            <button class="btn-outline btn-sm" data-action="cal-today">Heute</button>
          </div>
          <div class="cal-grid">${grid}</div>
          <div class="chip-row mt-3">${Object.entries(EVENT_TYPES)
          .map(([k, l]) => `<button class="chip ${st.cal.types[k] ? 'active' : ''}" data-action="cal-type" data-type="${k}" aria-pressed="${st.cal.types[k]}"><i class="cal-dot" style="background:${EVENT_COLORS[k]}"></i>${esc(l)}</button>`)
          .join('')}</div>
        </section>
        <aside class="stack">
          <section id="dayAgenda" class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">${esc(selDate.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
              <button class="btn-outline btn-sm" data-action="new-event" data-day="${st.cal.selected}">${icon('plus', 'ico-sm')}<span>Eintrag</span></button></div>
            ${selected.length ? selected.map((e) => eventRow(e, { date: false })).join('') : empty('Keine Einträge an diesem Tag.', 'calendar')}
          </section>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">Offene Fristen</h2></div>
            ${deadlines.length ? deadlines.map((e) => eventRow(e)).join('') : empty('Keine offenen Fristen.', 'clock')}
          </section>
        </aside>
      </div>`;
}

function calendarClient() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const upcoming = st.events.filter((e) => parseDate(e.startsAt) >= cutoff && e.status !== 'abgesagt').sort(byStart);
  const past = st.events.filter((e) => !upcoming.includes(e)).sort((a, b) => byStart(b, a)).slice(0, 15);
  return `
      <div class="page-head">
        <div><h1 class="page-title">Termine</h1><p class="page-sub">Ihre Termine mit der Kanzlei und bei Gericht.</p></div>
        <div class="page-actions"><button class="btn-gold btn-md" data-action="new-event">${icon('plus')}<span>Termin anfragen</span></button></div>
      </div>
      <section class="panel panel-pad mb-4"><div class="panel-head"><h2 class="panel-title">Anstehend</h2></div>
        ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : empty('Keine anstehenden Termine.', 'calendar')}</section>
      ${past.length ? `<details class="edit-box"><summary>Vergangene & abgesagte Termine (${past.length})</summary>${past.map((e) => eventRow(e)).join('')}</details>` : ''}`;
}

views.calendar = {
  async load() {
    await Promise.all([load.events(), isStaff() ? load.cases() : null, load.lawyers()]);
    if (!st.cal.month) st.cal.month = monthStart(new Date());
    if (!st.cal.selected) st.cal.selected = dayKey(new Date());
  },
  render() {
    return isStaff() ? calendarStaff() : calendarClient();
  },
};

function eventForm(e, preset = {}) {
  const isNew = !e;
  const v = e || {};
  const type = v.type || preset.type || 'gericht';
  const start = v.startsAt ? toLocalInput(v.startsAt) : preset.day ? `${preset.day}T10:00` : '';
  const caseId = v.caseId ?? preset.caseId ?? null;
  const assigned = isNew ? st.user.id : v.assignedTo;
  const visible = isNew ? ['mandant', 'gericht'].includes(type) : v.clientVisible;
  const caseOpts = st.cases
    .filter((c) => c.status !== 'geschlossen' || c.id === caseId)
    .map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId))
    .join('');

  const statusBtns = isNew
    ? ''
    : [
        v.status === 'angefragt' ? `<button type="button" class="btn-gold btn-md" data-action="event-status" data-id="${v.id}" data-status="bestaetigt">${icon('check')}<span>Anfrage bestätigen</span></button>` : '',
        v.type === 'frist' && v.status === 'bestaetigt' ? `<button type="button" class="btn-gold btn-md" data-action="event-status" data-id="${v.id}" data-status="erledigt">${icon('check')}<span>Frist erledigt</span></button>` : '',
        ['abgesagt', 'erledigt'].includes(v.status)
          ? `<button type="button" class="btn-outline btn-md" data-action="event-status" data-id="${v.id}" data-status="bestaetigt">Wieder aktivieren</button>`
          : `<button type="button" class="btn-outline btn-md" data-action="event-status" data-id="${v.id}" data-status="abgesagt">Absagen</button>`,
        `<button type="button" class="btn-danger btn-md" data-action="event-delete" data-id="${v.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>`,
      ].join('');

  return `
      <h2 id="modalTitle" class="modal-title">${isNew ? 'Neuer Kalendereintrag' : esc(v.title)}</h2>
      <p class="modal-sub">${isNew ? 'Gerichtstermine, Fristen, Mandantengespräche und interne Termine – mit Countdown im Dashboard und Discord-Erinnerung 24 h vorher.' : `${esc(EVENT_TYPES[v.type] || v.type)} · ${statusBadge(EVENT_STATUS, v.status)}${v.creatorName ? ' · angelegt von ' + esc(v.creatorName) : ''}${v.clientName ? ' · Mandant: ' + esc(v.clientName) : ''}`}</p>
      ${!isNew && !['abgesagt', 'erledigt'].includes(v.status) ? `<div class="mb-4">${countdownHtml(v)}</div>` : ''}
      <form data-form="event" data-id="${isNew ? '' : v.id}" class="form-grid cols-2">
        <div class="span-2"><span class="label">Art</span><div class="seg">${Object.entries(EVENT_TYPES)
        .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="type" value="${k}" ${type === k ? 'checked' : ''}><span><i class="cal-dot" style="background:${EVENT_COLORS[k]}"></i>${esc(l)}</span></label>`)
        .join('')}</div></div>
        <div class="span-2"><label class="label" for="evTitle">Titel</label><input id="evTitle" name="title" class="field" required minlength="2" maxlength="120" value="${esc(v.title || '')}" placeholder="z. B. Hauptverhandlung Strafsache Doe" autofocus></div>
        <div><label class="label" for="evStart">Beginn / Fälligkeit</label><input id="evStart" name="startsAt" type="datetime-local" class="field" required value="${start}"></div>
        <div><label class="label" for="evEnd">Ende (optional)</label><input id="evEnd" name="endsAt" type="datetime-local" class="field" value="${v.endsAt ? toLocalInput(v.endsAt) : ''}"></div>
        <div><label class="label">Akte (optional)</label><select name="caseId" class="field"><option value="">Keine Akte</option>${caseOpts}</select></div>
        <div><label class="label">Zuständig</label><select name="assignedTo" class="field"><option value="">Niemand</option>${st.lawyers.map((l) => opt(l.id, l.displayName, l.id === assigned)).join('')}</select></div>
        <div class="span-2"><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="${esc(v.location ?? (type === 'frist' ? '' : 'Kanzlei Würfelpark'))}" placeholder="z. B. District Court, Saal 2"></div>
        <div class="span-2"><label class="label">Notiz</label><textarea name="note" rows="3" class="field" maxlength="1000" placeholder="Vorbereitung, Unterlagen, Hinweise …">${esc(v.note || '')}</textarea></div>
        <label class="check span-2"><input type="checkbox" name="clientVisible" ${visible ? 'checked' : ''}> Für den Mandanten im Portal sichtbar</label>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${isNew ? 'Eintrag anlegen' : 'Speichern'}</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>
      ${statusBtns ? `<div class="form-actions mt-5 pt-5" style="border-top:1px solid var(--line)">${statusBtns}</div>` : ''}`;
}

function eventRequestForm(caseId) {
  const own = st.cases.filter((c) => c.status !== 'geschlossen');
  const min = toLocalInput(new Date(Date.now() + 15 * 60 * 1000).toISOString());
  return `
      <h2 class="modal-title">Termin anfragen</h2>
      <p class="modal-sub">Nennen Sie Ihren Wunschtermin – die Kanzlei bestätigt ihn oder schlägt eine Alternative vor.</p>
      <form data-form="event-request" class="form-grid cols-2">
        <div class="span-2"><label class="label">Anliegen</label><input name="title" class="field" required minlength="2" maxlength="120" placeholder="z. B. Beratungsgespräch" autofocus></div>
        <div><label class="label">Wunschtermin</label><input name="startsAt" type="datetime-local" class="field" required min="${min}"></div>
        <div><label class="label">Akte</label><select name="caseId" class="field"><option value="">Allgemeine Beratung</option>${own.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId)).join('')}</select></div>
        <div class="span-2"><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="Kanzlei Würfelpark"></div>
        <div class="span-2"><label class="label">Notiz (optional)</label><textarea name="note" rows="3" class="field" maxlength="1000"></textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Anfrage senden</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`;
}

function eventDetailClient(e) {
  const canCancel = e.clientId === st.user.id && !['abgesagt', 'erledigt'].includes(e.status) && parseDate(e.startsAt) > Date.now();
  const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  return `
      <h2 id="modalTitle" class="modal-title">${esc(e.title)}</h2>
      <p class="modal-sub">${esc(EVENT_TYPES[e.type] || e.type)} · ${statusBadge(EVENT_STATUS, e.status)}</p>
      <div class="info-grid mb-4">${cell('Datum', fmtDay(e.startsAt))}${cell('Uhrzeit', fmtTime(e.startsAt) + ' Uhr')}${cell('Ort', e.location || '—')}${e.caseNumber ? cell('Akte', e.caseNumber) : ''}${e.assignedName ? cell('Ansprechpartner', e.assignedName) : ''}</div>
      ${!['abgesagt', 'erledigt'].includes(e.status) ? `<div class="mb-4">${countdownHtml(e)}</div>` : ''}
      ${e.note ? `<div class="tl-item mb-4"><div class="tl-body">${esc(e.note)}</div></div>` : ''}
      ${canCancel ? `<button class="btn-danger btn-md" data-action="event-status" data-id="${e.id}" data-status="abgesagt">Termin absagen</button>` : ''}`;
}

async function openEvent(id, returnCase = null) {
  let e = st.eventCache.get(id);
  if (!e) {
    await load.events();
    e = st.eventCache.get(id);
  }
  if (!e) throw new Error('Termin nicht gefunden.');
  const opts = { key: `event:${id}`, reopen: () => openEvent(id) };
  if (isStaff()) {
    await Promise.all([load.cases(), load.lawyers()]);
    openModal(eventForm(e), opts);
  } else {
    openModal(eventDetailClient(e), opts);
  }
  st.returnCase = returnCase;
}

/* ---------------------------------------------------------------- Kanzlei-Post */
function mailItem(m) {
  const inbox = st.mailBox === 'inbox';
  const who = inbox ? m.senderName : `An: ${m.recipientName}`;
  const unread = inbox && !m.isRead;
  return `<button type="button" class="mail-item ${unread ? 'unread' : ''} ${m.id === st.mailSel ? 'active' : ''}" data-action="mail-open" data-id="${m.id}">
      <div class="flex items-center gap-3">
        ${inbox ? `<span class="avatar sm">${avatarImg(m.senderAvatar, m.senderName)}</span>` : ''}
        <div class="min-w-0 flex-1">
          <div class="from"><span>${m.priority ? '❗ ' : ''}${esc(who)}</span><span class="text-xs text-dim nowrap">${esc(shortDate(m.createdAt))}</span></div>
          <div class="subj">${esc(m.subject || '(kein Betreff)')}${m.caseNumber ? ' · ' + esc(m.caseNumber) : ''}</div>
        </div>
      </div></button>`;
}
function mailReader(m) {
  const inbox = st.mailBox === 'inbox';
  return `
      <button class="btn-ghost btn-sm mb-3 lg:hidden" data-action="mail-back">${icon('chevronLeft', 'ico-sm')}<span>Zurück</span></button>
      <div class="flex flex-wrap items-center gap-2 mb-2">${m.priority ? badge('Wichtig', 'red') : ''}${m.caseNumber ? `<button class="badge badge-gold" data-action="open-case" data-id="${m.caseId}">Akte ${esc(m.caseNumber)}</button>` : ''}</div>
      <h2 class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(m.subject || '(kein Betreff)')}</h2>
      <div class="flex items-center gap-3 mt-3">
        <span class="avatar">${avatarImg(m.senderAvatar, m.senderName)}</span>
        <div class="text-sm text-dim min-w-0">Von <span class="text-muted">${esc(m.senderName)}</span>${m.senderRank ? ' (' + esc(m.senderRank) + ')' : ''} an <span class="text-muted">${esc(m.recipientName)}</span><br>${esc(fmtDate(m.createdAt))}</div>
      </div>
      <div class="mail-body">${esc(m.body)}</div>
      <div class="form-actions">
        ${inbox && m.senderId ? `<button class="btn-gold btn-md" data-action="mail-reply" data-id="${m.id}">${icon('reply', 'ico-sm')}<span>Antworten</span></button>` : ''}
        ${inbox ? `<button class="btn-outline btn-md" data-action="mail-unread" data-id="${m.id}">Als ungelesen</button>` : ''}
        <button class="btn-danger btn-md" data-action="mail-delete" data-id="${m.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
      </div>`;
}

views.mail = {
  async load() {
    await Promise.all([load.messages(), load.unread()]);
  },
  render() {
    const inbox = st.mailBox === 'inbox';
    const sel = st.messages.find((m) => m.id === st.mailSel) || null;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Kanzlei-Post</h1><p class="page-sub">${isStaff() ? 'Interne Nachrichten, Notizen und Rundschreiben im Team – und Post von Mandanten.' : 'Ihre direkte und vertrauliche Verbindung zur Kanzlei.'}</p></div>
          <div class="page-actions">
            ${inbox && st.unread ? `<button class="btn-outline btn-md" data-action="mail-read-all">${icon('check', 'ico-sm')}<span>Alle gelesen</span></button>` : ''}
            <button class="btn-gold btn-md" data-action="compose">${icon('edit', 'ico-sm')}<span>Neue Nachricht</span></button>
          </div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${inbox ? 'active' : ''}" data-action="mail-box" data-value="inbox">Posteingang${st.unread ? ` <span class="chip-count">${st.unread}</span>` : ''}</button>
          <button class="chip ${!inbox ? 'active' : ''}" data-action="mail-box" data-value="sent">Gesendet</button>
        </div>
        <div class="mail-layout ${sel ? 'has-sel' : ''}">
          <div class="panel mail-list">${st.messages.length ? st.messages.map(mailItem).join('') : empty(inbox ? 'Ihr Posteingang ist leer.' : 'Noch keine gesendeten Nachrichten.', 'mail')}</div>
          <div class="panel mail-read">${sel ? mailReader(sel) : `<div class="empty">${icon('mail', 'ico-lg')}<p>Wählen Sie eine Nachricht aus.</p></div>`}</div>
        </div>`;
  },
};

async function composeModal(preset = {}) {
  await Promise.all([load.contacts(), load.cases()]);
  const staff = isStaff();
  const team = st.contacts.filter((c) => c.role !== 'mandant');
  const clients = st.contacts.filter((c) => c.role === 'mandant');
  const label = (c) => c.displayName + (c.rank ? ' · ' + c.rank : '');
  // Team nach Rang: Board of Partners (Founding → Partner), Associate Attorneys (Senior → Junior), dann ohne Rang
  const byRank = (a, b) => (RANKS.indexOf(a.rank) + 1 || 99) - (RANKS.indexOf(b.rank) + 1 || 99) || a.displayName.localeCompare(b.displayName, 'de');
  const teamGroups = [
    ...Object.entries(RANK_GROUPS).map(([g, ranks]) => [g, team.filter((c) => ranks.includes(c.rank))]),
    ['Weitere Mitarbeiter', team.filter((c) => !RANKS.includes(c.rank))],
  ]
    .filter(([, list]) => list.length)
    .map(([g, list]) => `<optgroup label="${esc(g)}">${list.sort(byRank).map((c) => opt(c.id, label(c), c.id === preset.recipientId)).join('')}</optgroup>`)
    .join('');
  const cases = st.cases.filter((c) => c.status !== 'geschlossen' || c.id === preset.caseId);
  openModal(`
      <h2 class="modal-title">${preset.reply ? 'Antworten' : 'Neue Nachricht'}</h2>
      <p class="modal-sub">${staff ? 'Nachrichten sind nur für Absender und Empfänger sichtbar. Rundschreiben gehen an alle aktiven Teammitglieder.' : 'Ihre Nachricht geht direkt an das ausgewählte Kanzleimitglied.'}</p>
      <form data-form="compose" class="form-grid">
        <div><label class="label" for="cmpTo">Empfänger</label>
          <select id="cmpTo" name="recipient" class="field" required>
            <option value="">Bitte auswählen …</option>
            ${staff ? '<option value="broadcast">📢 Rundschreiben an das ganze Team</option>' : ''}
            ${teamGroups}
            ${clients.length ? `<optgroup label="Mandanten">${clients.map((c) => opt(c.id, c.displayName, c.id === preset.recipientId)).join('')}</optgroup>` : ''}
          </select></div>
        <div><label class="label" for="cmpSubject">Betreff</label><input id="cmpSubject" name="subject" class="field" maxlength="150" value="${esc(preset.subject || '')}"></div>
        <div><label class="label">Bezug zur Akte (optional)</label><select name="caseId" class="field"><option value="">Kein Aktenbezug</option>${cases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === preset.caseId)).join('')}</select></div>
        <div><label class="label" for="cmpBody">Nachricht</label><textarea id="cmpBody" name="body" rows="7" class="field" required maxlength="5000" autofocus></textarea></div>
        <label class="check"><input type="checkbox" name="priority"> Als wichtig markieren</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Senden</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Pinnwand */
function noteCard(n) {
  const own = n.authorId === st.user.id || isAdmin();
  return `<article class="panel board-note" style="--note:${NOTE_COLORS[n.color] || NOTE_COLORS.gold}">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-semibold leading-snug">${n.pinned ? '📌 ' : ''}${esc(n.title || 'Notiz')}</h3>
        <div class="flex gap-1 shrink-0">
          <button class="icon-btn sm" data-action="board-pin" data-id="${n.id}" title="${n.pinned ? 'Lösen' : 'Anheften'}" aria-label="${n.pinned ? 'Lösen' : 'Anheften'}" ${n.pinned ? 'style="color:var(--gold-500)"' : ''}>${icon('pin', 'ico-sm')}</button>
          ${own ? `<button class="icon-btn sm" data-action="board-edit" data-id="${n.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="board-delete" data-id="${n.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>` : ''}
        </div></div>
      <div class="body">${esc(n.body)}</div>
      <div class="foot"><span>${esc(n.authorName)}</span><span>${esc(fmtDate(n.updatedAt))}</span></div></article>`;
}
function noteModal(n) {
  const v = n || { color: 'gold', pinned: false };
  openModal(`
      <h2 class="modal-title">${n ? 'Notiz bearbeiten' : 'Neue Notiz'}</h2>
      <p class="modal-sub">Für das ganze Team sichtbar – ideal für Hinweise, Übergaben und To-dos.</p>
      <form data-form="board" data-id="${n ? n.id : ''}" class="form-grid">
        <div><label class="label">Überschrift</label><input name="title" class="field" maxlength="120" value="${esc(v.title || '')}" placeholder="z. B. Übergabe Wochenende" autofocus></div>
        <div><label class="label">Text</label><textarea name="body" rows="6" class="field" required maxlength="4000">${esc(v.body || '')}</textarea></div>
        <div><span class="label">Farbe</span><div class="flex gap-3">${Object.entries(NOTE_COLORS)
        .map(([k, c]) => `<label class="color-opt" title="${k}"><input type="radio" name="color" value="${k}" ${v.color === k ? 'checked' : ''}><span class="color-dot" style="background:${c}"></span></label>`)
        .join('')}</div></div>
        <label class="check"><input type="checkbox" name="pinned" ${v.pinned ? 'checked' : ''}> Oben anheften (erscheint auch in der Übersicht)</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}
views.board = {
  async load() {
    await load.board();
  },
  render() {
    return `
        <div class="page-head">
          <div><h1 class="page-title">Team-Pinnwand</h1><p class="page-sub">Interne Notizen, Übergaben und Hinweise für die ganze Kanzlei.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="board-new">${icon('plus')}<span>Neue Notiz</span></button></div>
        </div>
        ${st.board.length ? `<div class="board-grid">${st.board.map(noteCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Notizen. Heften Sie die erste an!', 'pin')}</div>`}`;
  },
};
