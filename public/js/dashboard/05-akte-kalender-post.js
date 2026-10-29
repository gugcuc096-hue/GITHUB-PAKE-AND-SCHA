/*
 * Kanzlei-Dashboard – Teil 5 von 14: Akte: Aufgaben & Wiedervorlagen, Tickets, Aktenansicht · Kalender, Kanzlei-Post, Pinnwand.
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
  return `<div class="task-row ${t.done ? 'is-done' : ''}" data-id="${t.id}">
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
  if (!tasks.length)
    return emptySection(
      'secTasks',
      'Aufgaben & Wiedervorlagen',
      'noch keine',
      `<button type="button" class="btn-outline btn-sm" data-action="task-new" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Aufgabe</span></button><button type="button" class="btn-ghost btn-sm" data-action="task-checklist" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Checkliste ${esc(AREAS[c.area] || '')} übernehmen</span></button>${c.canEdit ? `<button type="button" class="btn-ghost btn-sm" data-action="task-package" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Aufgaben-Paket …</span></button>` : ''}`,
      'Mit Datum wird eine Aufgabe zur Wiedervorlage und erscheint rechtzeitig unter „Handlungsbedarf“.'
    );
  return `<div class="section" id="secTasks">
      <h3 class="section-title">Aufgaben & Wiedervorlagen <span class="text-xs text-dim font-normal sec-meta">${open.length} offen · ${done.length} erledigt</span></h3>
      <div class="task-list">${open.map((t) => taskItem(t, { showCase: false })).join('')}${done.map((t) => taskItem(t, { showCase: false })).join('')}</div>
      <form data-form="task-quick" data-case-id="${c.id}" class="task-quick mt-3">
        <input name="title" class="field" required minlength="2" maxlength="160" placeholder="Neue Aufgabe oder Wiedervorlage …" aria-label="Neue Aufgabe">
        <input name="dueDate" type="date" class="field" aria-label="Fällig am" title="Fällig am (Wiedervorlage)">
        <button type="submit" class="btn-outline btn-md">${icon('plus', 'ico-sm')}<span>Hinzufügen</span></button>
      </form>
      <div class="task-extra">
        <button type="button" class="btn-ghost btn-sm" data-action="task-checklist" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Checkliste ${esc(AREAS[c.area] || '')} übernehmen</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="task-new" data-case-id="${c.id}">${icon('calendar', 'ico-sm')}<span>Mit Zuständigkeit & Notiz …</span></button>
        ${c.canEdit ? `<button type="button" class="btn-ghost btn-sm" data-action="task-package" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Aufgaben-Paket …</span></button>` : ''}
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

/** Aufgaben-Pakete je Anlass („Festnahme“ → Vollmacht, Akteneinsicht, Haftprüfung …) – Auswahl für eine Akte. */
function taskPackagesHtml(caseId, packages, area) {
  const sorted = [...packages].sort((a, b) => (b.area === area) - (a.area === area));
  const cards = sorted
    .map(
      (p) => `<div class="pack${p.area === area ? ' is-fit' : ''}">
        <div class="pack-head"><strong>${esc(p.name)}</strong>${p.area ? badge(AREAS[p.area] || p.area, 'slate') : ''}</div>
        <ul class="pack-items">${p.items.map((i) => `<li>${esc(i.title)}${i.days != null ? ` <span class="text-dim">· in ${i.days} ${i.days === 1 ? 'Tag' : 'Tagen'}</span>` : ''}</li>`).join('')}</ul>
        <button type="button" class="btn-outline btn-sm" data-action="task-package-apply" data-id="${p.id}" data-case-id="${caseId}">${icon('plus', 'ico-sm')}<span>${p.items.length} Aufgaben übernehmen</span></button>
      </div>`
    )
    .join('');
  return `<h2 id="modalTitle" class="modal-title">Aufgaben-Paket</h2>
    <p class="modal-sub">Legt alle Aufgaben eines Anlasses auf einmal an – mit Fristen ab heute. Schon vorhandene Aufgaben bleiben unberührt.</p>
    <div class="pack-list">${cards || '<p class="text-sm text-dim">Noch keine Pakete.</p>'}</div>
    <div class="form-actions mt-4">${isBoard() ? `<button type="button" class="btn-ghost btn-sm" data-action="task-package-edit" data-case-id="${caseId}">${icon('edit', 'ico-sm')}<span>Pakete pflegen</span></button>` : ''}<button type="button" class="btn-ghost btn-md" data-action="back-to-case">Schließen</button></div>`;
}
/** Pakete pflegen (Board): ein Formular je Paket, eine Aufgabe pro Zeile, „| Tage“ für die Frist. */
function taskPackagesEditHtml(caseId, packages) {
  const form = (p) => `<form data-form="task-package" ${p ? `data-id="${p.id}"` : ''} data-case-id="${caseId}" class="pack-form form-grid cols-2">
      <div><label class="label">Name</label><input name="name" class="field" required minlength="2" maxlength="60" value="${esc(p ? p.name : '')}" placeholder="z. B. Festnahme"></div>
      <div><label class="label">Rechtsgebiet</label><select name="area" class="field"><option value="">Alle</option>${areaOptions(p && p.area).map(([k, l]) => opt(k, l, p && p.area === k)).join('')}</select></div>
      <div class="span-2"><label class="label">Aufgaben <span class="text-dim font-normal normal-case tracking-normal">– eine je Zeile, optional „| Tage“ bis zur Frist</span></label><textarea name="items" class="field" rows="5" maxlength="3000" required placeholder="Vollmacht einholen | 1&#10;Akteneinsicht beantragen | 2">${esc(p ? p.itemsText : '')}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-outline btn-sm">${icon('check', 'ico-sm')}<span>${p ? 'Speichern' : 'Paket anlegen'}</span></button>${p ? `<button type="button" class="btn-ghost btn-sm danger" data-action="task-package-del" data-id="${p.id}" data-case-id="${caseId}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}</div>
    </form>`;
  return `<h2 id="modalTitle" class="modal-title">Aufgaben-Pakete pflegen</h2>
    <p class="modal-sub">Nur das Board of Partners. Änderungen gelten für künftige Übernahmen – bestehende Aufgaben bleiben.</p>
    ${packages.map(form).join('<hr class="pack-sep">')}<hr class="pack-sep">
    <h3 class="section-title">Neues Paket</h3>${form(null)}
    <div class="form-actions mt-4"><button type="button" class="btn-ghost btn-md" data-action="task-package" data-case-id="${caseId}">Zurück</button></div>`;
}

/** Fehlende Unterlagen: die Kanzlei fordert an, der Mandant sieht ein To-do (auch im Portal unter „Was ist zu tun?“). */
function requestsSection(c, list) {
  const staff = isStaff();
  const add = c.canEdit && !c.closed ? `<button type="button" class="btn-outline btn-sm" data-action="req-new" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Unterlage anfordern</span></button>` : '';
  if (!list.length) return staff ? emptySection('secRequests', 'Fehlende Unterlagen', 'keine', add, 'Der Mandant sieht die Anforderung im Portal, im Ticket und wird nach 3 Tagen erinnert.') : '';
  const open = list.filter((r) => !r.done);
  const rows = list
    .map(
      (r) => `<div class="req-row${r.done ? ' is-done' : ''}" data-id="${r.id}">
        <button type="button" class="req-check" data-action="req-toggle" data-case-id="${c.id}" data-id="${r.id}" data-done="${r.done ? '' : '1'}" aria-label="${r.done ? 'Wieder offen' : 'Als erledigt markieren'}" title="${r.done ? 'Wieder offen' : staff ? 'Als erledigt markieren' : 'Ich habe es nachgereicht'}">${r.done ? icon('check', 'ico-sm') : ''}</button>
        <div class="req-main"><div class="req-title">${esc(r.title)}</div>${r.note ? `<div class="req-note">${esc(r.note)}</div>` : ''}<div class="req-meta">angefordert ${esc(fmtDate(r.createdAt))}${r.done ? ` · erledigt${r.doneBy ? ` (${esc(r.doneBy)})` : ''}` : ''}</div></div>
        ${staff && c.canEdit ? `<button type="button" class="icon-btn sm" data-action="req-del" data-case-id="${c.id}" data-id="${r.id}" aria-label="Anforderung löschen">${icon('trash', 'ico-sm')}</button>` : ''}
      </div>`
    )
    .join('');
  return `<div class="section" id="secRequests"><h3 class="section-title">Fehlende Unterlagen <span class="text-xs text-dim font-normal sec-meta">${open.length} offen</span></h3>
      <div class="req-list">${rows}</div>${add ? `<div class="mt-3">${add}</div>` : ''}
      ${staff ? '' : '<p class="form-hint">Bitte reichen Sie die Unterlagen per Nachricht an die Kanzlei nach und haken Sie sie danach ab.</p>'}</div>`;
}

async function afterTaskChange() {
  load.dueTasks().then(renderNav).catch(() => {});
  if (st.modalCaseId && $('#secTasks')) await reloadCase(st.modalCaseId);
  else await refreshBehind();
}

/** Board-Ticket einer Bewerbung bzw. eines Anliegens (nur Board of Partners). */
/*
 * Discord-Tickets und Prozessticket als schmale Leiste oben in der Akte bzw. Bewerbung: Status auf einen Blick,
 * Erklärungen nur, wenn etwas zu tun ist (sonst im Tooltip).
 */
const ticketState = (t) => (t.exists ? (t.archived ? badge('archiviert', 'slate') : badge('aktiv', 'emerald')) : t.deleted ? badge('per /delete gelöscht', 'slate') : badge('noch nicht angelegt', 'amber'));
/** Rechnungen der Akte: offen und bezahlt als Summen – zählen beim Öffnen hoch und bei einer Zahlung mit. */
function invoiceSums(c, list) {
  const live = list.filter((i) => i.status !== 'storniert');
  if (live.length < 2) return '';
  const sum = (s) => live.filter((i) => i.status === s).reduce((n, i) => n + (i.total || 0), 0);
  return `<div class="inv-sums"><span>Offen <b data-count="case${c.id}:open">${esc(money(sum('offen')))}</b></span><span>Bezahlt <b data-count="case${c.id}:paid">${esc(money(sum('bezahlt')))}</b></span></div>`;
}

/** Interne Notiz: @Namen hervorheben (nur Darstellung – Benachrichtigt wird auf dem Server). */
const mentionHtml = (text) => esc(text).replace(/(^|[^\p{L}\p{N}@])(@[\p{L}][\p{L}'-]*(?: [\p{Lu}][\p{L}'-]*)?)/gu, '$1<span class="mention">$2</span>');

const ticketOpen = (url, label = 'Öffnen') =>
  url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="btn-discord btn-sm">${DISCORD_ICON}<span>${esc(label)}</span></a><button type="button" class="icon-btn sm" data-action="copy" data-text="${esc(url)}" title="Link zum Ticket kopieren" aria-label="Link zum Ticket kopieren">${icon('link', 'ico-sm')}</button>`
    : '';
function ticketStrip({ title, tip = '', badges = '', hint = '', error = '', actions = '', extra = '', ico = DISCORD_ICON, tone = '' }) {
  return `<div class="ticket-strip${tone ? ` strip-${tone}` : ''}">
      <div class="ts-main"><span class="ts-title" ${tip ? `title="${esc(tip)}"` : ''}>${ico}<strong>${esc(title)}</strong></span>${badges}</div>
      ${actions ? `<div class="ts-actions">${actions}</div>` : ''}
      ${hint ? `<div class="ts-hint">${hint}</div>` : ''}
      ${error ? `<div class="ts-hint text-red-300">${icon('alert', 'ico-sm')} ${esc(error)}</div>` : ''}
      ${extra}
    </div>`;
}

function boardTicketLine(kind, id, t) {
  if (!t) return '';
  return ticketStrip({
    title: 'Discord-Ticket (Board)',
    badges: ticketState(t),
    error: t.error,
    actions: `${ticketOpen(t.url)}<button class="btn-ghost btn-sm" data-action="board-ticket-sync" data-kind="${kind}" data-id="${id}">${t.exists ? 'Abgleichen' : t.deleted ? 'Neu anlegen' : 'Ticket anlegen'}</button>`,
  });
}

/** Discord-Ticket der Akte (nur wenn Discord-Tickets eingerichtet sind). */
function ticketBanner(c, t, transcripts = []) {
  if (!t) return '';
  if (!isStaff()) {
    if (t.deleted) return ''; // Ticket wurde von der Kanzlei gelöscht
    if (t.clientInTicket) return ticketStrip({ title: 'Ihr Discord-Ticket', tip: 'Alle Neuigkeiten zu dieser Akte erscheinen automatisch in Ihrem privaten Discord-Kanal.', badges: badge('verbunden', 'emerald'), actions: ticketOpen(t.url) });
    if (t.clientLinked)
      return ticketStrip({ title: 'Discord-Ticket', hint: 'Sie werden automatisch hinzugefügt, sobald Sie auf dem Discord-Server der Kanzlei sind.', actions: `<button class="btn-ghost btn-sm" data-action="ticket-sync" data-id="${c.id}">Erneut prüfen</button>` });
    return ticketStrip({ title: 'Discord-Ticket', hint: 'Verbinden Sie Ihr Discord-Konto – dann kommen Sie automatisch in das private Ticket zu Ihrer Akte.', actions: `<a href="/api/discord/connect" class="btn-discord btn-sm">${DISCORD_ICON}<span>Discord verbinden</span></a>` });
  }
  const client = t.clientInTicket
    ? badge('Mandant im Ticket', 'emerald')
    : t.clientLinked
      ? badge('Mandant nicht auf dem Server', 'amber')
      : badge(c.hasClientAccount ? 'Mandant: Discord nicht verknüpft' : 'Mandant noch nicht beigetreten', 'slate');
  // Erklärungen im Tooltip; als Zeile nur, wenn etwas zu tun ist (Ticket fehlt bzw. wurde gelöscht)
  const info = `Status, Zuständigkeit, Nachrichten, Termine, Verträge und Rechnungen erscheinen automatisch im Kanal – interne Notizen nie.${!t.clientInTicket && !c.hasClientAccount ? ' Mandanten ohne Konto treten direkt nach dem Einreichen auf der Website bei – sonst im Ticket mit /add hinzufügen.' : ''}`;
  const hint = t.exists
    ? ''
    : t.deleted
      ? 'Das Ticket wurde im Discord gelöscht und wird nicht automatisch neu angelegt. „Neu anlegen“ erstellt einen frischen Kanal.'
      : 'Wird automatisch angelegt; hier von Hand anlegen, falls es fehlt.';
  return ticketStrip({
    title: 'Discord-Ticket',
    tip: info,
    badges: ticketState(t) + (t.exists ? client : ''),
    hint: esc(hint),
    error: t.error,
    // Gesicherter Verlauf des zuletzt gelöschten Tickets (öffnet als eigene Seite)
    actions: `${ticketOpen(t.url)}${transcripts.length ? `<a class="btn-ghost btn-sm" href="/api/cases/${c.id}/transcripts/${transcripts[0].id}" target="_blank" rel="noopener" title="${esc(`${transcripts[0].count} Nachrichten · gesichert ${fmtDate(transcripts[0].createdAt)}`)}">${icon('doc', 'ico-sm')}<span>Verlauf</span></a>` : ''}<button class="btn-ghost btn-sm" data-action="ticket-sync" data-id="${c.id}">${t.exists ? 'Abgleichen' : t.deleted ? 'Neu anlegen' : 'Ticket anlegen'}</button>`,
  });
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
  return ticketStrip({
    title: 'Prozessticket',
    tip: 'Kanal auf einem anderen Discord-Server · nur für die Kanzlei sichtbar',
    badges: `${badge('DOJ-Discord', 'sky')}${pt.label ? `<span class="ts-label">${esc(pt.label)}</span>` : ''}`,
    actions: `${ticketOpen(pt.url)}${c.canEdit ? `<button class="btn-ghost btn-sm" data-action="pt-toggle">Ändern</button><button class="btn-ghost btn-sm" data-action="pt-remove" data-id="${c.id}">Entfernen</button>` : ''}`,
    extra: form,
  });
}

/*
 * Tickets als kleine Chips im Aktenkopf (Kanzlei): „Ticket · aktiv“ und „Prozess · Palermo-03“. Details und Knöpfe
 * (Öffnen, Abgleichen, Ändern, Entfernen) stehen im kleinen Menü am Chip – statt zweier voller Leisten.
 */
function chipMenu({ ico, label, tone = '', body }) {
  return `<details class="more-menu case-chipmenu"><summary class="case-chip${tone ? ` tone-${tone}` : ''}">${ico}<span>${esc(label)}</span><i class="chip-state" aria-hidden="true"></i></summary><div class="more-pop chip-pop">${body}</div></details>`;
}
function ticketChips(c, t, transcripts = []) {
  if (!isStaff()) return '';
  const out = [];
  if (t) {
    const tone = t.error ? 'red' : t.exists ? 'ok' : 'amber';
    const label = t.exists ? (t.archived ? 'Ticket · archiviert' : 'Ticket · aktiv') : t.deleted ? 'Ticket · gelöscht' : 'Ticket · fehlt';
    const client = t.clientInTicket
      ? badge('Mandant im Ticket', 'emerald')
      : t.clientLinked
        ? badge('Mandant nicht auf dem Server', 'amber')
        : badge(c.hasClientAccount ? 'Mandant: Discord nicht verknüpft' : 'Mandant noch nicht beigetreten', 'slate');
    const hint = t.exists
      ? 'Status, Zuständigkeit, Nachrichten, Termine, Verträge und Rechnungen erscheinen automatisch im Kanal – interne Notizen nie.'
      : t.deleted
        ? 'Das Ticket wurde im Discord gelöscht und wird nicht automatisch neu angelegt. „Neu anlegen“ erstellt einen frischen Kanal.'
        : 'Wird automatisch angelegt; hier von Hand anlegen, falls es fehlt.';
    const verlauf = transcripts.length
      ? `<a class="btn-ghost btn-sm" href="/api/cases/${c.id}/transcripts/${transcripts[0].id}" target="_blank" rel="noopener" title="${esc(`${transcripts[0].count} Nachrichten · gesichert ${fmtDate(transcripts[0].createdAt)}`)}">${icon('doc', 'ico-sm')}<span>Verlauf</span></a>`
      : '';
    out.push(
      chipMenu({
        ico: DISCORD_ICON,
        label,
        tone,
        body: `<div class="chip-pop-head">${ticketState(t)}${t.exists ? client : ''}</div><p class="chip-pop-hint">${esc(hint)}</p>${t.error ? `<p class="chip-pop-hint text-red-300">${icon('alert', 'ico-sm')} ${esc(t.error)}</p>` : ''}
          <div class="chip-pop-actions">${ticketOpen(t.url)}${verlauf}<button class="btn-ghost btn-sm" data-action="ticket-sync" data-id="${c.id}">${t.exists ? 'Abgleichen' : t.deleted ? 'Neu anlegen' : 'Ticket anlegen'}</button>${t.exists && !t.clientInTicket && c.canEdit && feature('clientLink') ? `<button class="btn-outline btn-sm" data-action="client-join-link" data-id="${c.id}" title="Beitrittslink erzeugen: kopieren oder als Nachricht senden">${icon('link', 'ico-sm')}<span>Mandanten-Link</span></button>` : ''}</div>`,
      })
    );
  }
  const pt = c.processTicket;
  if (pt) {
    out.push(
      chipMenu({
        ico: DISCORD_ICON,
        label: `Prozess${pt.label ? ` · ${pt.label}` : ''}`,
        tone: 'sky',
        body: `<div class="chip-pop-head">${badge('DOJ-Discord', 'sky')}</div><p class="chip-pop-hint">Kanal auf einem anderen Discord-Server · nur für die Kanzlei sichtbar.</p>
          <div class="chip-pop-actions">${ticketOpen(pt.url)}${c.canEdit ? `<button class="btn-ghost btn-sm" data-action="pt-toggle">Ändern</button><button class="btn-ghost btn-sm" data-action="pt-remove" data-id="${c.id}">Entfernen</button>` : ''}</div>`,
      })
    );
  }
  return out.length ? `<div class="case-chips">${out.join('')}</div>` : '';
}
/** „Details“ in der Akte: zugeklappt, wenn man sie einmal zugeklappt hat (gilt für alle Akten dieses Geräts). */
function detailsClosed() {
  try {
    return localStorage.getItem('ps.caseDetailsClosed') === '1';
  } catch {
    return false;
  }
}
/** Eingabe für das Prozessticket (öffnet über „Prozessticket (DOJ)“ bzw. „Ändern“). */
function processTicketForm(c) {
  if (!isStaff() || !c.canEdit) return '';
  const pt = c.processTicket;
  return `<div id="ptBox" class="pt-box" hidden>
          <form data-form="process-ticket" data-id="${c.id}" class="form-grid cols-2">
            <div class="span-2"><label class="label" for="ptUrl">Link zum Kanal des Prozesstickets</label><input id="ptUrl" name="url" class="field" required maxlength="300" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://discord.com/channels/…/…" value="${esc(pt ? pt.url : '')}"></div>
            <div class="span-2"><label class="label" for="ptLabel">Bezeichnung (optional)</label><input id="ptLabel" name="label" class="field" maxlength="80" placeholder="z. B. DOJ – Hauptverhandlung" value="${esc(pt ? pt.label : '')}"></div>
            <p class="span-2 text-xs text-dim">Im Discord des DOJ: Rechtsklick auf den Kanal (am Handy lange drücken) → „Link kopieren“ und hier einfügen. Nur für die Kanzlei sichtbar – der Mandant sieht das Prozessticket nicht.</p>
            <div class="span-2 form-actions"><button type="button" class="btn-ghost btn-sm" data-action="pt-toggle">Abbrechen</button><button type="submit" class="btn-discord btn-sm">${DISCORD_ICON}<span>${pt ? 'Speichern' : 'Prozessticket hinzufügen'}</span></button></div>
          </form></div>`;
}

/*
 * Felder direkt in der Akte ändern: Klick auf den Wert → Eingabe, Enter oder Verlassen speichert (Esc verwirft), danach
 * „Rückgängig“. Die Akte wird dabei nicht neu geladen. Nur für zuständige Anwälte und das Board (c.canEdit).
 */
const IE_LABEL = { title: 'Titel', clientName: 'Mandant', clientPhone: 'Telefon', opponent: 'Gegenpartei', courtRef: 'Gerichtsaktenzeichen', area: 'Rechtsgebiet', description: 'Sachverhalt', publicNote: 'Statushinweis' };
function ie(c, key, value, { type = 'text', placeholder = '', cls = '' } = {}) {
  const v = String(value ?? '');
  const shown = key === 'area' ? AREAS[v] || v : v;
  if (!c.canEdit) return shown ? esc(shown) : '';
  return `<span class="ie ${cls}" role="button" tabindex="0" data-ie="${key}" data-type="${type}" data-id="${c.id}" data-value="${esc(v)}" data-placeholder="${esc(placeholder)}" title="Zum Ändern anklicken">${shown ? esc(shown) : `<span class="ie-empty">${esc(placeholder)}</span>`}</span>`;
}

/** Beteiligte (Gegenpartei, Zeugen …) mit Hinweis auf Überschneidungen mit anderen Akten. */
function partiesHtml(c, parties = [], overlaps = {}) {
  const hit = (list) => list.map((o) => `<button type="button" class="ov-link" data-action="open-case" data-id="${o.caseId}">${esc(o.caseNumber)}</button>`).join(', ');
  const warn = [];
  if ((overlaps.client || []).length) warn.push(`Der Mandant ist in ${hit(overlaps.client)} <strong>Gegenpartei</strong>.`);
  if ((overlaps.opponent || []).length) warn.push(`Die Gegenpartei ist in ${hit(overlaps.opponent)} <strong>Mandant</strong>.`);
  for (const p of parties) if ((p.overlaps || []).length) warn.push(`${esc(p.name)} (${esc(p.roleLabel)}) ist in ${hit(p.overlaps)} <strong>Mandant</strong>.`);
  const rows = parties
    .filter((p) => p.role !== 'zeuge') // Zeugen haben einen eigenen Abschnitt
    .map(
      (p) => `<div class="party-row"><span class="party-role">${esc(p.roleLabel)}</span><span class="party-name">${esc(p.name)}</span><span class="party-contact">${esc(p.contact || '')}</span>
        ${c.canEdit ? `<button type="button" class="icon-btn sm" data-action="party-del" data-case-id="${c.id}" data-id="${p.id}" aria-label="Beteiligten entfernen" title="Entfernen">${icon('trash', 'ico-sm')}</button>` : ''}</div>`
    )
    .join('');
  const add = c.canEdit
    ? `<form data-form="party-add" data-id="${c.id}" class="party-add"><select name="role" class="field" aria-label="Rolle">${Object.entries({ gegenpartei: 'Gegenpartei', gericht: 'Gericht', staatsanwalt: 'Staatsanwaltschaft', sonstige: 'Sonstige' }).map(([k, l]) => opt(k, l)).join('')}</select>
        <input name="name" class="field" required minlength="2" maxlength="120" placeholder="Name" aria-label="Name"><input name="contact" class="field" maxlength="160" placeholder="Kontakt (optional)" aria-label="Kontakt">
        <button type="submit" class="btn-outline btn-sm">${icon('plus', 'ico-sm')}<span>Hinzufügen</span></button></form>`
    : '';
  return `<div class="parties" id="partiesBox"><div class="k">Beteiligte</div>
      ${warn.length ? `<div class="party-warn">${icon('alert', 'ico-sm')}<div>${warn.join('<br>')}<span class="party-warn-note">Bitte auf einen möglichen Interessenkonflikt prüfen.</span></div></div>` : ''}
      ${rows || '<p class="text-sm text-dim">Noch niemand erfasst. Zeugen: eigener Abschnitt weiter unten.</p>'}${add}</div>`;
}

/** Verlauf nach Phasen: frühere Schritte des Verfahrens sind eingeklappt, der aktuelle steht offen. */
function phaseGroups(log) {
  const phases = [{ label: 'Eingang', items: [] }];
  for (const n of log) {
    const m = n.system && /^Verfahrensstand: (.+?)(?: ·|$)/.exec(n.body || '');
    if (m) phases.push({ label: m[1], items: [] });
    phases[phases.length - 1].items.push(n);
  }
  return phases;
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
/** „Rückgängig“ für eine Änderung am Aktenkopf: stellt den alten Wert wieder her. */
const undoPatch = (id, body) => ({
  label: 'Rückgängig',
  onClick: () =>
    guard(async () => {
      await api.patch('/api/cases/' + id, body);
      await reloadCase(id);
    }),
});

async function setCasePriority(sel) {
  const id = Number(sel.dataset.id);
  const priority = Number(sel.value);
  const was = Number(sel.dataset.value);
  // Balken und Farbe springen sofort um – scheitert das Speichern, zurück auf den alten Stand
  const box = sel.closest('.prop');
  const show = (p) => {
    box.className = box.className.replace(/\bprio-\d\b/, `prio-${p}`);
    $$('.prio-bars i', box).forEach((i, k) => i.classList.toggle('on', k < p));
  };
  show(priority);
  try {
    await api.patch('/api/cases/' + id, { priority });
  } catch (err) {
    sel.value = sel.dataset.value;
    if (box.isConnected) show(Number(sel.dataset.value));
    throw notSaved(err);
  }
  toast(`Priorität: ${PRIORITY[priority][0]}`, 'ok', { duration: 6000, action: undoPatch(id, { priority: was }) });
  await reloadCase(id);
}

/**
 * Stand im Aktenkopf ändern: „offen“, „step:N“ (Schritt des Verfahrens, die Akte ist dann in Bearbeitung) oder
 * „geschlossen“ (mit Rückfrage wie der Kreis „Abgeschlossen“).
 */
async function setCaseStatus(sel) {
  const id = Number(sel.dataset.id);
  const v = sel.value;
  if (v === 'geschlossen') {
    sel.value = sel.dataset.value; // erst der Abschluss-Dialog schließt die Akte
    return closeCase(id);
  }
  const undo = previewStage(v);
  const was = sel.dataset.value;
  try {
    await api.patch('/api/cases/' + id, v.startsWith('step:') ? { status: 'in_bearbeitung', step: Number(v.slice(5)) } : { status: v });
  } catch (err) {
    undo();
    throw notSaved(err);
  }
  const back = was.startsWith('step:') ? { status: 'in_bearbeitung', step: Number(was.slice(5)) } : { status: was };
  toast(`Stand: ${v.startsWith('step:') ? STEPS[Number(v.slice(5))] : CASE_STATUS[v][0]}`, 'ok', { duration: 6000, action: undoPatch(id, back) });
  await reloadCase(id);
}

/**
 * Stand sofort zeigen, bevor der Server antwortet – im Aktenkopf (Auswahl und Farbpunkt) und im Bearbeitungsstand.
 * stage: „offen“ oder „step:N“. Gibt eine Funktion zurück, die alles auf den alten Stand zurücksetzt.
 */
function previewStage(stage) {
  const body = $('#modalBody');
  const sel = body.querySelector('[data-case-status]');
  const box = sel && sel.closest('.prop');
  const track = body.querySelector('.track');
  const before = { cls: box && box.className, track: track && track.innerHTML };
  if (sel) {
    sel.value = stage;
    box.className = box.className.replace(/\bst-\S+/, `st-${stage.startsWith('step:') ? 'in_bearbeitung' : stage}`);
  }
  if (track && stage.startsWith('step:')) {
    const at = Number(stage.slice(5));
    const nodes = $$('.track-node', track);
    const fill = track.querySelector('.track-fill');
    let pop = 0;
    nodes.forEach((n, i) => {
      const was = n.classList.contains('done');
      n.classList.toggle('done', i < at);
      n.classList.toggle('current', i === at);
      n.textContent = i < at ? '✓' : String(i + 1);
      // neu erreichte Schritte springen kurz auf, während die goldene Linie hinläuft
      if (!window.PS.motion.calm() && ((i < at && !was) || i === at)) n.animate(TRACK_POP, { duration: 420, delay: 120 + pop++ * 130, easing: 'ease-out', fill: 'backwards' });
    });
    fill.style.width = `${(at / (nodes.length - 1)) * 80}%`;
    trackGlow(fill, 700);
  }
  return () => {
    if (sel && sel.isConnected) {
      sel.value = sel.dataset.value;
      box.className = before.cls;
    }
    if (track && track.isConnected) track.innerHTML = before.track;
  };
}

/*
 * Bearbeitungsstand animiert: Beim Öffnen der Akte läuft die goldene Linie bis zum aktuellen Schritt, die erreichten
 * Kreise springen nacheinander auf; beim Weiterschalten wandert ein Lichtpunkt mit. Bei „Bewegung reduzieren“ nicht.
 */
const TRACK_POP = [
  { transform: 'scale(0.55)', opacity: 0.35 },
  { transform: 'scale(1.14)', opacity: 1, offset: 0.7 },
  { transform: 'none', opacity: 1 },
];
function trackGlow(fill, ms) {
  if (!fill || window.PS.motion.calm()) return;
  fill.classList.add('moving');
  clearTimeout(fill._glow);
  fill._glow = setTimeout(() => fill.classList.remove('moving'), ms);
}
function animateTrack(track) {
  if (!track || window.PS.motion.calm()) return;
  const fill = track.querySelector('.track-fill');
  if (fill && parseFloat(fill.style.width) > 0) {
    fill.animate([{ width: '0%' }, { width: fill.style.width }], { duration: 900, delay: 150, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
    trackGlow(fill, 1100);
  }
  $$('.track-node.done, .track-node.current', track).forEach((n, i) => n.animate(TRACK_POP, { duration: 420, delay: 200 + i * 150, easing: 'ease-out', fill: 'backwards' }));
}

/**
 * Verfahren abschließen: eigenes Fenster über der Akte (X führt zurück) – oben, was noch offen ist (unbezahlte
 * Rechnungen, fehlende Unterschriften, offene Aufgaben, kommende Termine), darunter das Ergebnis (intern, Grundlage der
 * Erfolgsquote auf der Startseite). Abschließen geht auch mit offenen Punkten – die Liste dient nur der Kontrolle.
 */
async function closeCase(id) {
  const data = await api.get('/api/cases/' + id);
  openModal(closeCaseHtml(data), { key: `close:${id}` });
}
function closeOpenItems({ invoices = [], contracts = [], tasks = [], appointments = [] }) {
  const now = Date.now();
  const items = [];
  invoices
    .filter((i) => i.status === 'offen')
    .forEach((i) => items.push([icon('receipt', 'ico-sm'), `${invKind(i)} <span class="font-mono">${esc(i.number)}</span> über ${esc(money(i.total))} ist noch offen${i.overdueDays > 0 ? ` – seit ${dayCount(i.overdueDays)} überfällig` : ''}`]));
  contracts
    .filter((k) => !k.internal && k.status !== 'unterschrieben')
    .forEach((k) => items.push([icon('edit', 'ico-sm'), `${esc(k.templateName)} – ${k.status === 'entwurf' ? 'noch nicht unterschrieben' : 'Unterschrift fehlt noch'}`]));
  tasks
    .filter((t) => !t.done)
    .forEach((t) => items.push([icon('check', 'ico-sm'), `Aufgabe „${esc(t.title)}“${t.dueDate ? ` – fällig ${esc(fmtDateOnly(t.dueDate))}` : ''}`]));
  appointments
    .filter((a) => !['abgesagt', 'erledigt'].includes(a.status) && (parseDate(a.startsAt)?.getTime() || 0) > now)
    .forEach((a) => items.push([icon('calendar', 'ico-sm'), `${esc(a.typeLabel || 'Termin')} „${esc(a.title)}“ am ${esc(fmtDate(a.startsAt))}`]));
  return items;
}
function outcomeOptions(selected = '', area = '') {
  return `<option value="">Bitte wählen …</option>${outcomeEntries(area, selected)
    .map(([k, [l]]) => opt(k, l, k === selected))
    .join('')}`;
}
function closeCaseHtml(data) {
  const c = data.case;
  const open = closeOpenItems(data);
  const check = open.length
    ? `<div class="close-check is-open">
        <div class="close-check-head">${icon('alert', 'ico-sm')}<span>Noch offen</span><span class="sec-count">${open.length}</span></div>
        <ul class="close-list">${open.map(([ico, text]) => `<li>${ico}<span>${text}</span></li>`).join('')}</ul>
        <p class="form-hint">Abschließen geht trotzdem – die Liste ist nur zur Kontrolle.</p>
      </div>`
    : `<div class="close-check is-done">${icon('check', 'ico-sm')}<span>Nichts mehr offen: keine unbezahlten Rechnungen, alle Unterschriften da, keine offenen Aufgaben oder Termine.</span></div>`;
  // Noch keine (nicht stornierte) Rechnung: gleich vorschlagen – aus dem Mandatsvertrag und den erfassten Zeiten
  const sent = data.sentence;
  const noInvoice = !(data.invoices || []).some((i) => i.status !== 'storniert');
  const invoiceHint = noInvoice
    ? `<div class="close-check is-open close-invoice">
        <div class="close-check-head">${icon('receipt', 'ico-sm')}<span>Noch keine Rechnung</span></div>
        <p class="form-hint">Aus Vertrag und Zeiten erstellen? Du kommst danach hierher zurück.</p>
        <button type="button" class="btn-outline btn-sm" data-action="new-invoice" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Rechnung erstellen</span></button>
      </div>`
    : '';
  return `
      <p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Akte ${esc(c.caseNumber)}</p>
      <h2 id="modalTitle" class="modal-title">Verfahren abschließen</h2>
      <p class="modal-sub">${esc(c.title)}</p>
      ${check}${invoiceHint}
      <form data-form="case-close" data-id="${c.id}" data-no-invoice="${noInvoice ? '1' : ''}" class="form-grid mt-5">
        <div><label class="label" for="ccOutcome">Ergebnis</label>
          <select id="ccOutcome" name="outcome" class="field" required>${outcomeOptions(c.outcome || '', c.area)}</select>
          <p class="form-hint">Nur für die Kanzlei – daraus entsteht die Erfolgsquote auf der Startseite. Beratung ohne Verfahren und vorzeitig beendete Mandate zählen dort nicht mit.</p></div>
        ${
          sent && sent.estimateHe != null
            ? `<div><div class="label">Tatsächliches Strafmaß <span class="text-dim font-normal normal-case tracking-normal">– optional, für den Vergleich mit eurer Einschätzung (${esc(String(sent.estimateHe))} HE${sent.estimateFine ? ` · ${esc(money(sent.estimateFine))}` : ''})</span></div>
          <div class="chg-est"><span class="num-step"><input type="number" name="actualHe" min="0" max="100000" class="field" placeholder="HE" value="${sent.actualHe ?? ''}" aria-label="Tatsächliche Haftstrafe in Hafteinheiten"></span><span>HE</span><span class="num-step"><input type="number" name="actualFine" min="0" max="100000000" class="field" placeholder="$" value="${sent.actualFine ?? ''}" aria-label="Tatsächliche Geldstrafe"></span><span>$</span></div>
          <p class="form-hint">Nur intern – die Statistik zeigt, wie gut die Einschätzung getroffen hat.</p></div>`
            : ''
        }
        <p class="text-sm text-muted">Der Mandant sieht den Abschluss im Portal, ein Discord-Ticket wird archiviert. Wieder öffnen geht jederzeit über den Bearbeitungsstand.</p>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Abschließen</span></button></div>
      </form>`;
}

/** Ergebnis einer abgeschlossenen Akte nachträglich ändern (Auswahl im Aktenkopf). */
async function setCaseOutcome(sel) {
  const id = Number(sel.dataset.id);
  if (!sel.value) return void (sel.value = sel.dataset.value);
  const was = sel.dataset.value;
  try {
    await api.patch('/api/cases/' + id, { outcome: sel.value });
  } catch (err) {
    sel.value = sel.dataset.value;
    throw err;
  }
  toast(`Ergebnis: ${OUTCOMES[sel.value][0]}`, 'ok', { duration: 6000, ...(was ? { action: undoPatch(id, { outcome: was }) } : {}) });
  await reloadCase(id);
}

/* ---------------------------------------------------------------- Nachrichten (Chat in Akte und Bewerbung) */
function chatDayLabel(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const key = (x) => x.toLocaleDateString('de-DE');
  if (key(d) === key(new Date())) return 'Heute';
  if (key(d) === key(new Date(Date.now() - 864e5))) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
const chatTime = (iso) => (parseDate(iso) || new Date()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
/**
 * Eine Sprechblase. x: { id, side ('out' = eigene Seite, 'in' = Gegenseite), author, sub, body, createdAt, del }.
 * prevDay: Tag der vorherigen Nachricht – davor kommt bei einem neuen Tag die Trennlinie („Heute“, „Gestern“ …).
 */
function chatBubble(x, prevDay) {
  const day = chatDayLabel(x.createdAt);
  return `${day !== prevDay ? `<div class="chat-day"><span>${esc(day)}</span></div>` : ''}
    <div class="chat-msg ${x.side}" data-id="${x.id}">
      <div class="chat-bubble">
        ${x.author ? `<div class="chat-author">${esc(x.author)}${x.sub ? ` <span>· ${esc(x.sub)}</span>` : ''}</div>` : ''}
        <div class="chat-text">${esc(x.body)}</div>
        <div class="chat-foot"><span>${esc(chatTime(x.createdAt))}${x.via ? ` · ${esc(x.via)}` : ''}</span><span class="chat-receipt"></span>${x.del || ''}</div>
      </div>
    </div>`;
}
/** Mehrere Nachrichten (toBubble: Nachricht → Angaben für chatBubble). prevDay: Tag vor der ersten. */
function chatBubbles(list, toBubble, prevDay = null) {
  return list
    .map((m) => {
      const html = chatBubble(toBubble(m), prevDay);
      prevDay = chatDayLabel(m.createdAt);
      return html;
    })
    .join('');
}
/**
 * „Gesendet“ / „Gelesen 14:32“ unter der letzten eigenen Nachricht (otherRead: bis wohin die Gegenseite gelesen hat,
 * otherAt: wann sie zuletzt weitergelesen hat).
 */
function chatReceipts(list, otherRead, otherAt) {
  if (!list) return;
  if (otherRead !== undefined) list.dataset.otherRead = String(otherRead);
  if (otherAt !== undefined) list.dataset.otherAt = otherAt || '';
  const read = Number(list.dataset.otherRead) || 0;
  const at = parseDate(list.dataset.otherAt);
  const when = at ? ` ${dayKey(at) === dayKey(new Date()) ? '' : `${at.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}, `}${fmtTime(at)}` : '';
  const outs = $$('.chat-msg.out:not(.pending)', list);
  outs.forEach((el) => (el.querySelector('.chat-receipt').textContent = ''));
  const last = outs[outs.length - 1];
  if (last) last.querySelector('.chat-receipt').textContent = Number(last.dataset.id) <= read ? `· gelesen${when}` : '· gesendet';
}
/** Neue Nachrichten unten anhängen (doppelte werden übersprungen); scrollt mit, wenn man unten war. */
function chatAppend(list, messages, toBubble) {
  if (!list || !messages.length) return;
  const fresh = messages.filter((m) => !list.querySelector(`.chat-msg[data-id="${m.id}"]`));
  if (!fresh.length) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.querySelector('.chat-empty')?.remove();
  const days = $$('.chat-day span', list);
  list.insertAdjacentHTML('beforeend', chatBubbles(fresh, toBubble, days.length ? days[days.length - 1].textContent : null));
  list.dataset.lastId = String(Math.max(Number(list.dataset.lastId) || 0, ...fresh.map((m) => m.id)));
  if (atBottom || fresh.some((m) => toBubble(m).side === 'out')) list.scrollTop = list.scrollHeight;
  chatReceipts(list);
}
/**
 * Nachricht sofort als blasse Sprechblase zeigen („wird gesendet …“) und dann senden. Klappt es nicht, verschwindet
 * sie wieder und der Text steht zurück im Eingabefeld. listSel: Nachrichtenliste; send(body) → gespeicherte Nachricht.
 */
async function chatSendNow(f, listSel, toBubble, send) {
  const input = f.elements.body;
  const body = input.value.trim();
  if (!body) return null;
  const fromRect = input.getBoundingClientRect(); // die Nachricht gleitet von hier an ihren Platz (13-bewegung.js)
  input.value = '';
  input.style.height = '';
  input.focus();
  window.PS.drafts.clear(f); // gesendet ist gesendet – auch wer jetzt sofort neu lädt, bekommt sie nicht als Entwurf zurück
  const list = $(listSel);
  let pending = null;
  if (list) {
    list.querySelector('.chat-empty')?.remove();
    const days = $$('.chat-day span', list);
    list.insertAdjacentHTML('beforeend', chatBubble({ id: '', side: 'out', author: '', body, createdAt: new Date().toISOString() }, days.length ? days[days.length - 1].textContent : null));
    pending = list.lastElementChild;
    pending.classList.add('pending');
    pending.querySelector('.chat-receipt').textContent = '· wird gesendet …';
    list.scrollTop = list.scrollHeight;
  }
  const flight = chatFly(pending, fromRect);
  try {
    const msg = await send(body);
    pending?.remove();
    if (msg) {
      chatAppend($(listSel), [msg], toBubble);
      chatFlyContinue(flight, $(`${listSel} .chat-msg[data-id="${msg.id}"]`));
    }
    return msg;
  } catch (err) {
    pending?.remove();
    // Formular inzwischen neu gezeichnet? Dann das aktuelle Eingabefeld (das input-Ereignis legt den Entwurf wieder an)
    const box = input.isConnected ? input : $(`form[data-form="${f.dataset.form}"] textarea[name="body"]`);
    if (box) {
      box.value = box.value.trim() ? `${body}\n${box.value}` : body;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    throw notSaved(err, 'Nicht gesendet, der Text steht wieder im Eingabefeld');
  }
}
function chatForm({ form, attrs, placeholder }) {
  // Kanzlei im Akten-Chat: „/“ öffnet die Textbausteine (13-kanzlei.js)
  const snippets = form === 'chat-send' && isStaff();
  return `<form data-form="${form}" ${attrs} class="chat-form">
          <textarea name="body" rows="1" maxlength="${form === 'chat-send' ? 4000 : 3000}" required class="field chat-input" placeholder="${esc(snippets ? `${placeholder} ( / für Textbausteine)` : placeholder)}" aria-label="Nachricht schreiben"${snippets ? ' data-snippets' : ''}></textarea>
          <button type="submit" class="btn-gold chat-send" aria-label="Senden" title="Senden">${icon('send')}</button>
        </form>`;
}

/* Akte: Kanzlei ↔ Mandant */
function caseBubble(m) {
  const side = m.fromFirm === isStaff() ? 'out' : 'in';
  const mine = m.authorId === st.user.id;
  return {
    id: m.id,
    side,
    // Namen zeigen: bei der Gegenseite immer, in der Kanzlei auch bei Kollegen
    author: side === 'in' || (isStaff() && !mine) ? m.author : '',
    sub: m.authorRank || (m.fromFirm ? '' : 'Mandant'),
    via: m.viaDiscord ? 'über Discord' : '',
    body: m.body,
    createdAt: m.createdAt,
    del:
      mine || isAdmin()
        ? `<button type="button" class="chat-del" data-action="delete-note" data-case-id="${st.chatCaseId}" data-id="${m.id}" aria-label="Nachricht löschen" title="Nachricht löschen">${icon('trash', 'ico-sm')}</button>`
        : '',
  };
}
function chatSection(c, chat, ticket) {
  const staff = isStaff();
  st.chatCaseId = c.id;
  const list = chat ? chat.messages : [];
  const reach = !staff
    ? ''
    : c.hasClientAccount
      ? `${esc(c.clientName)} sieht die Nachrichten im Mandantenportal${ticket && ticket.clientInTicket ? ' und im Discord-Ticket' : ''}.`
      : ticket && ticket.clientInTicket
        ? 'Der Mandant hat kein Portal-Konto – Nachrichten erreichen ihn über das Discord-Ticket.'
        : 'Der Mandant hat noch kein Portal-Konto und ist nicht im Discord-Ticket – Nachrichten liest er erst, wenn er eines davon hat.';
  const empty = staff ? 'Noch keine Nachrichten. Schreiben Sie dem Mandanten direkt hier.' : 'Noch keine Nachrichten. Schreiben Sie Ihrer Kanzlei – Ihr Anwalt wird benachrichtigt.';
  // Mandant: Ist sein Anwalt gerade da? (Stempeluhr der Kanzlei)
  const duty = c.lawyerDuty || {};
  const present = staff ? [] : caseTeam(c).filter((l) => DUTY_SHORT[duty[l.id]]);
  const dutyLine = present.length
    ? `<p class="chat-duty s-${duty[present[0].id]}"><span class="duty-dot s-${duty[present[0].id]}"></span><span>${present
        .map((l) => `<strong>${esc(l.name)}</strong> ist ${DUTY_SHORT[duty[l.id]]}`)
        .join(', ')}${duty[present[0].id] === 'dienst' ? ' – Antworten kommen meist schnell.' : '.'}</span></p>`
    : '';
  return `<div class="section" id="secChat">
      <h3 class="section-title">Nachrichten <span class="text-xs text-dim font-normal sec-meta">${staff ? 'mit dem Mandanten' : 'mit Ihrer Kanzlei'}</span></h3>
      <div class="chat">
        <div class="chat-list" id="chatList" data-case-id="${c.id}" data-last-id="${list.length ? list[list.length - 1].id : 0}" data-other-read="${chat ? chat.read.other : 0}" data-other-at="${esc((chat && chat.read.otherAt) || '')}" aria-live="polite">
          ${chat && chat.more ? `<div class="chat-more"><button type="button" class="btn-ghost btn-sm" data-action="chat-older" data-case-id="${c.id}">${icon('chevronUp', 'ico-sm')}<span>Ältere Nachrichten laden</span></button></div>` : ''}
          ${list.length ? chatBubbles(list, caseBubble) : `<p class="chat-empty">${esc(empty)}</p>`}
        </div>
        ${dutyLine}
        ${chatForm({ form: 'chat-send', attrs: `data-case-id="${c.id}"`, placeholder: staff ? `Nachricht an ${c.clientName === '—' ? 'den Mandanten' : c.clientName} …` : 'Nachricht an Ihre Kanzlei …' })}
        <p class="chat-hint"><span class="hidden md:inline">Enter sendet · Umschalt + Enter für eine neue Zeile. </span>${reach}</p>
      </div>
    </div>`;
}
/** Nach dem Öffnen/Neuzeichnen: ans Ende scrollen, Lesebestätigung, als gelesen merken. */
function initChat(data) {
  const list = $('#chatList');
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  chatReceipts(list);
  markChatRead(Number(list.dataset.caseId), Number(list.dataset.lastId), data && data.chat ? data.chat.read.mine : 0);
}
async function markChatRead(caseId, lastId, mine = 0) {
  if (!lastId || lastId <= mine) return;
  await api.post(`/api/cases/${caseId}/chat/read`, { lastId }).catch(() => {});
  await load.chatUnread().catch(() => {});
  renderNav();
  // Aktenliste bzw. „Was ist zu tun?“ dahinter: Die Nachrichten dieser Akte sind jetzt gelesen
  const c = st.cases.find((x) => x.id === caseId);
  if (c && c.chatUnread) {
    c.chatUnread = 0;
    if (st.view === 'overview' || st.view === 'cases') renderView();
  }
}
/** Neue Nachrichten nachladen (alle paar Sekunden, solange der Chat der Akte offen ist). */
async function pollChat() {
  const list = $('#chatList');
  if (!list || document.hidden || st.chatPolling) return;
  st.chatPolling = true;
  try {
    const caseId = Number(list.dataset.caseId);
    const r = await api.get(`/api/cases/${caseId}/chat?after=${Number(list.dataset.lastId) || 0}`);
    if (!list.isConnected) return;
    if (r.messages.length) typingHide();
    chatAppend(list, r.messages, caseBubble);
    chatReceipts(list, r.read.other, r.read.otherAt);
    if (r.messages.length) await markChatRead(caseId, Number(list.dataset.lastId), r.read.mine);
  } catch {
    /* nächster Versuch beim nächsten Takt */
  } finally {
    st.chatPolling = false;
  }
}

/*
 * „Wer ist gerade hier?“: Kolleginnen und Kollegen, die dieselbe Akte gerade offen haben (Live-Verbindung, siehe
 * 14-start.js), als kleine Profilbilder neben dem Aktenzeichen – und „… schreibt gerade“ im Akten-Chat.
 */
function hereStrip(caseId) {
  const users = st.here.caseId === caseId ? st.here.users : [];
  if (!users.length) return '<span class="case-here" id="caseHere" hidden></span>';
  const first = (n) => String(n || '').replace(/\b(Dr|Prof|jur|med|rer|nat)\.\s*/gi, '').trim().split(/\s+/)[0] || 'Jemand';
  const text = users.length === 1 ? `${first(users[0].name)} ist auch hier` : users.length === 2 ? `${first(users[0].name)} und ${first(users[1].name)} sind auch hier` : `${first(users[0].name)} und ${users.length - 1} weitere sind auch hier`;
  const all = users.map((u) => u.name).join(', ');
  return `<span class="case-here" id="caseHere" title="Gerade in dieser Akte: ${esc(all)}" aria-label="Gerade in dieser Akte: ${esc(all)}">
      <span class="case-here-faces">${users
        .slice(0, 3)
        .map((u) => `<span class="avatar">${avatarImg(u.avatarUrl, u.name)}</span>`)
        .join('')}</span><span class="case-here-text">${esc(text)}</span></span>`;
}
function hereRender() {
  const el = $('#caseHere');
  const head = el && el.closest('[data-case-head]');
  if (head) el.outerHTML = hereStrip(Number(head.dataset.caseHead));
}
let typingTimer = 0;
function typingShow(caseId, name) {
  const list = $('#chatList');
  if (!list || Number(list.dataset.caseId) !== caseId) return;
  let el = $('#chatTyping');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  if (!el) {
    el = document.createElement('div');
    el.id = 'chatTyping';
    el.className = 'chat-typing';
    el.setAttribute('role', 'status');
    list.appendChild(el);
  } else list.appendChild(el); // bleibt immer ganz unten
  el.innerHTML = `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(name || 'Jemand')} schreibt gerade …</span>`;
  if (atBottom) list.scrollTop = list.scrollHeight;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(typingHide, 4500);
}
function typingHide() {
  clearTimeout(typingTimer);
  $('#chatTyping')?.remove();
}

/** Kürzel für den Laufzettel: „Dr. Alois Pake“ → „AP“. */
const slipInitials = (name) =>
  String(name || '')
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms)\.?\s+/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
/** Verknüpfte Akten als Chips (öffnen die Akte; zuständige Anwälte können die Verknüpfung lösen). */
function linksHtml(c, links) {
  return `<div class="case-links">${links
    .map(
      (k) => `<span class="case-link ${k.status === 'geschlossen' ? 'is-closed' : ''}"><button type="button" class="case-link-open" data-action="open-case" data-id="${k.id}" title="${esc(k.title)}"><span class="font-mono">${esc(k.caseNumber)}</span><span class="case-link-who">${esc(k.clientName)}</span></button>${
        c.canEdit ? `<button type="button" class="case-link-x" data-action="case-unlink" data-id="${c.id}" data-other="${k.id}" data-number="${esc(k.caseNumber)}" aria-label="Verknüpfung mit ${esc(k.caseNumber)} lösen" title="Verknüpfung lösen">${icon('x', 'ico-sm')}</button>` : ''
      }</span>`
    )
    .join('')}</div>`;
}
/** Laufzettel: wer die Akte bearbeitet hat – Kürzel und Tag, voller Name im Tooltip. */
function routingHtml(routing) {
  return `<div class="slip">${routing
    .map((r) => `<span class="slip-row" title="${esc(`${r.name} – ${r.count} ${r.count === 1 ? 'Eintrag' : 'Einträge'}, zuletzt ${fmtDate(r.lastAt)}`)}"><b>${esc(slipInitials(r.name))}</b><span>${esc(shortDate(r.lastAt))}</span></span>`)
    .join('')}</div>`;
}

function caseDetail({ case: c, notes, appointments, invoices, attachments = [], externalDocs = [], tasks = [], contracts = [], work, ticket, transcripts = [], clientSuggestions, review, chat, charges, deals = [], links = [], linkedEvidence = [], routing = [], parties = [], overlaps = {}, requests = [], similar = [], precedentId = null, logMore = 0 }) {
  const staff = isStaff();
  const admin = isAdmin();
  const me = st.user.id;
  // Bearbeitungsstand: die vier Schritte des Verfahrens und als fünfter Kreis „Abgeschlossen“. Zuständige Anwälte klicken
  // direkt an: einen Schritt, „Abgeschlossen“ (schließt das Verfahren) oder bei abgeschlossener Akte einen Schritt (öffnet
  // sie wieder dort).
  const stages = [...stepsOf(c.area), 'Abgeschlossen'];
  const last = stages.length - 1;
  const at = c.closed ? last : c.step;
  const track = `
      <div class="track track-5 ${c.canEdit ? 'is-editable' : ''} mb-6">
        ${c.canEdit ? '<div class="track-head"><span>Bearbeitungsstand</span></div>' : ''}
        <div class="track-line"><div class="track-fill" style="width:${(at / last) * 80}%"></div>
        <div class="grid grid-cols-5">${stages
          .map((s, i) => {
            const done = i < at || (c.closed && i === last);
            const cur = i === at && !c.closed;
            const inner = `<div class="track-node ${done ? 'done' : cur ? 'current' : ''}">${done ? '✓' : i + 1}</div><span class="track-label text-[0.7rem] sm:text-xs text-muted text-center">${esc(STEP_BREAKS[s] || s)}</span>`;
            const action = i === last ? 'case-close' : c.closed ? 'case-reopen' : 'case-step';
            const label = i === last ? 'Verfahren abschließen' : c.closed ? `Akte wieder öffnen – Stand „${s}“` : `Bearbeitungsstand auf „${s}“ setzen`;
            return c.canEdit && i !== at
              ? `<button type="button" class="track-step" data-action="${action}" data-id="${c.id}" data-step="${i}" title="${esc(label)}" aria-label="${esc(label)}">${inner}</button>`
              : `<div class="track-step" ${i === at ? 'aria-current="step"' : ''}>${inner}</div>`;
          })
          .join('')}</div></div></div>`;

  const phoneHtml = staff && c.canEdit ? ie(c, 'clientPhone', c.clientPhone, { placeholder: 'Telefon eintragen' }) : esc(c.clientPhone || '');
  const contactHtml = [
    staff ? phoneHtml : c.clientPhone ? esc(c.clientPhone) : '',
    c.clientDiscord ? `${DISCORD_ICON.replace('class="ico"', 'class="ico-sm inline-ico"')} ${esc(c.clientDiscord)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const info = [
    // Kanzlei: der Name öffnet die Mandantenkartei; Mandanten ohne Konto lassen sich hier umbenennen
    staff && c.clientKey
      ? [
          'Mandant',
          null,
          `${clientLink(c.clientKey, c.clientName)}${c.hasClientAccount ? '' : ' <span class="text-dim">(ohne Konto)</span>'}`,
        ]
      : ['Mandant', c.clientName + (staff && !c.hasClientAccount ? ' (ohne Konto)' : '')],
    // Erreichbar über Telefon und Discord – die Login-Adresse nur, wenn es sonst nichts gibt
    staff
      ? ['Kontakt', null, contactHtml || (c.clientEmail ? mailBreakHtml(c.clientEmail) : '<span class="text-dim">—</span>')]
      : null,
    staff ? null : [caseTeam(c).length > 1 ? 'Zuständige Anwälte' : 'Zuständig', null, teamHtml(c)],
    ['Rechtsgebiet', null, c.canEdit ? ie(c, 'area', c.area, { type: 'select' }) : esc(AREAS[c.area] || c.area)],
    c.opponent || c.canEdit ? ['Gegenpartei', null, c.canEdit ? ie(c, 'opponent', c.opponent, { placeholder: 'Gegenpartei eintragen' }) : esc(c.opponent)] : null,
    c.courtRef || c.canEdit
      ? ['Gerichtsaktenzeichen', null, c.canEdit ? `${ie(c, 'courtRef', c.courtRef, { placeholder: 'Aktenzeichen des Gerichts' })}${c.courtRef ? ` <button type="button" class="copy-btn" data-action="copy" data-text="${esc(c.courtRef)}" title="Gerichtsaktenzeichen kopieren" aria-label="Gerichtsaktenzeichen kopieren">${icon('copy', 'ico-xs')}</button>` : ''}` : copyable(c.courtRef, 'Gerichtsaktenzeichen kopieren')]
      : null,
    staff && links.length ? ['Verknüpfte Akten', null, linksHtml(c, links)] : null,
    staff && routing.length ? ['Laufzettel', null, routingHtml(routing)] : null,
  ]
    .filter(Boolean)
    .map(([k, v, html]) => `<div><div class="k">${esc(k)}</div><div class="v">${html != null ? html : esc(v)}</div></div>`)
    .join('');

  const accountRow =
    staff && c.hasClientAccount && canLinkClient(c)
      ? `<div class="account-row"><div><span class="k inline">Mandanten-Konto</span> <strong>${esc(c.clientName)}</strong>${c.clientEmail ? ` <span class="text-dim">· ${esc(c.clientEmail)}</span>` : ''}</div><div class="flex flex-wrap gap-2">${isBoard() && c.clientId ? `<button type="button" class="btn-outline btn-sm" data-action="name-direct" data-user-id="${c.clientId}" data-name="${esc(c.clientName)}" data-email="${esc(c.clientEmail || '')}" data-return-case="${c.id}">Name korrigieren</button>` : ''}<button type="button" class="btn-outline btn-sm" data-action="case-client-search" data-id="${c.id}">Anderes Konto</button><button type="button" class="btn-ghost btn-sm" data-action="case-unlink-client" data-id="${c.id}">Verknüpfung lösen</button></div></div>`
      : staff && c.canEdit && !c.hasClientAccount
        ? `<div class="account-row"><div><span class="k inline">Name des Mandanten</span> ${ie(c, 'clientName', c.clientName === '—' ? '' : c.clientName, { placeholder: 'Name eintragen' })}</div></div>`
        : '';

  // Aktenkopf: eine Leiste unter dem Titel – je Angabe ein Feld „STATUS | ● In Bearbeitung“. Zuständige Anwälte
  // wählen Status und Priorität direkt aus; alle anderen sehen dieselben Felder nur zum Lesen.
  const prio = PRIORITY[c.priority] ? c.priority : 2;
  const prop = (cls, key, value, title = '') => {
    const tag = value.includes('<select') ? 'label' : 'span'; // mit Auswahl: Klick auf die Bezeichnung öffnet sie
    return `<${tag} class="prop ${cls}"${title ? ` title="${esc(title)}"` : ''}><span class="prop-k">${esc(key)}</span><span class="prop-v">${value}</span></${tag}>`;
  };
  const dot = '<i class="prop-dot" aria-hidden="true"></i>';
  // Status = genauer Stand: Offen, ein Schritt des Verfahrens oder Abgeschlossen (statt nur „In Bearbeitung“)
  const stageValue = c.status === 'in_bearbeitung' ? `step:${c.step}` : c.status;
  const statusValue = c.canEdit
    ? `${dot}<select data-case-status data-id="${c.id}" data-value="${esc(stageValue)}" aria-label="Stand der Akte">${[
        opt('offen', 'Offen', stageValue === 'offen'),
        ...stepsOf(c.area).map((s, i) => opt(`step:${i}`, s, stageValue === `step:${i}`)),
        opt('geschlossen', 'Abgeschlossen', stageValue === 'geschlossen'),
      ].join('')}</select>`
    : `${dot}<span>${esc(caseStage(c)[0])}</span>`;
  const prioValue = c.canEdit
    ? `${prioBars(prio)}<select data-case-priority data-id="${c.id}" data-value="${prio}" aria-label="Priorität der Akte">${Object.entries(PRIORITY)
        .map(([k, [l]]) => opt(k, l, Number(k) === prio))
        .join('')}</select>`
    : `${prioBars(prio)}<span>${esc(PRIORITY[prio][0])}</span>`;
  const urgency = URGENCY[c.urgency] ? URGENCY[c.urgency][0] : c.urgency;
  // Ergebnis (nur Kanzlei, abgeschlossene Akte): zuständige Anwälte ändern es direkt hier
  const outcomeValue =
    staff && c.closed
      ? c.canEdit
        ? `<select data-case-outcome data-id="${c.id}" data-value="${esc(c.outcome || '')}" aria-label="Ergebnis des Verfahrens">${c.outcome ? '' : '<option value="">Nicht erfasst</option>'}${outcomeEntries(c.area, c.outcome)
            .map(([k, [, , short]]) => opt(k, short, k === c.outcome))
            .join('')}</select>`
        : `<span>${esc(c.outcome && OUTCOMES[c.outcome] ? OUTCOMES[c.outcome][2] : 'Nicht erfasst')}</span>`
      : '';
  const headProps = [
    // Der Stand steht in den fünf Kreisen darunter – die Auswahl nur, solange die Akte noch „Offen“ ist (Start)
    c.status === 'offen' ? prop(`prop-status st-${esc(c.status)}`, 'Status', statusValue) : '',
    staff ? prop(`prop-prio prio-${prio}`, 'Priorität', prioValue) : '',
    outcomeValue ? prop(`prop-outcome ${outcomeTone(c.outcome)}`, 'Ergebnis', outcomeValue, 'Nur für die Kanzlei – Grundlage der Erfolgsquote auf der Startseite') : '',
    // Kanzlei: Angabe des Mandanten nur als Hinweis neben der Priorität (wenn mehr als „Normal“);
    // der Mandant sieht hier seine eigene Dringlichkeit
    staff && c.urgency !== 'normal'
      ? prop(`prop-urg urg-${esc(c.urgency)}`, 'Mandant', esc(urgency), 'Dringlichkeit, die der Mandant beim Einreichen angegeben hat')
      : '',
    staff ? '' : prop(`prop-urg urg-${esc(c.urgency)}`, 'Dringlichkeit', esc(urgency), 'Ihre Angabe beim Einreichen'),
    memberBadge(c.membership),
  ].join('');

  // Liegengeblieben (nur Kanzlei): ruhige Leiste ganz oben – mit dem, was dagegen hilft
  const idleStrip = c.idleDays
    ? `<div class="ticket-strips idle-strip">${ticketStrip({
        title: `Liegt seit ${dayCount(c.idleDays)}`,
        tip: 'Offene Akte ohne Aktivität. Ein Verlaufseintrag, eine Nachricht, ein Termin oder eine Wiedervorlage beendet den Hinweis.',
        ico: icon('clock'),
        tone: 'amber',
        badges: `<span class="ts-label">keine Aktivität seit ${esc(fmtDay(c.updatedAt))}</span>`,
        actions: `<button type="button" class="btn-outline btn-sm" data-action="task-new" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Wiedervorlage</span></button><button type="button" class="btn-ghost btn-sm" data-action="note-focus">${icon('edit', 'ico-sm')}<span>Notiz</span></button>`,
      })}</div>`
    : '';

  const claim = c.canClaim
    ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div>${icon('alert')} Diese Akte hat noch keinen zuständigen Anwalt.</div><button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Akte übernehmen</button></div>`
    : '';

  const quick = [];
  if (staff) {
    quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button>`);
    quick.push(`<button class="btn-outline btn-sm" data-action="new-invoice" data-case-id="${c.id}">${icon('receipt', 'ico-sm')}<span>Rechnung</span></button>`);
    quick.push(`<a class="btn-outline btn-sm" href="/aktenauszug?id=${c.id}" target="_blank" rel="noopener">${icon('doc', 'ico-sm')}<span>Aktenauszug</span></a>`);
    quick.push(`<button class="btn-outline btn-sm" data-action="chat-focus">${icon('chat', 'ico-sm')}<span>Mandant anschreiben</span></button>`);
    if (!c.hasClientAccount && canLinkClient(c)) quick.push(`<button class="btn-outline btn-sm" data-action="case-client-search" data-id="${c.id}">${icon('user', 'ico-sm')}<span>Mandanten-Konto verknüpfen</span></button>`);
    if (!c.processTicket && c.canEdit) quick.push(`<button class="btn-outline btn-sm" data-action="pt-toggle">${icon('plus', 'ico-sm')}<span>Prozessticket (DOJ)</span></button>`);
    // Seltene bzw. folgenreiche Aktionen stehen im Menü „⋯ Mehr“ statt zwischen den täglichen Knöpfen
    const more = [
      // Strafsachen haben den Abschnitt „Anklagepunkte“ immer – sonst kommt er von hier
      c.area !== 'strafrecht' && c.canEdit && charges && !charges.charges.length ? `<button type="button" class="more-item" data-action="charge-pick" data-id="${c.id}">${icon('scale', 'ico-sm')}<span>Anklagepunkte</span></button>` : '',
      c.area !== 'strafrecht' && !(charges && charges.charges.length) ? `<button type="button" class="more-item" data-action="hearing-start" data-id="${c.id}">${icon('scale', 'ico-sm')}<span>Verhandlungsmodus</span></button>` : '',
      c.canEdit ? `<button type="button" class="more-item" data-action="case-link" data-id="${c.id}">${icon('link', 'ico-sm')}<span>Akte verknüpfen</span></button>` : '',
      c.lawyerId === me ? `<button type="button" class="more-item" data-action="release-case" data-id="${c.id}">${icon('logout', 'ico-sm')}<span>Akte abgeben</span></button>` : '',
      c.isCoLawyer ? `<button type="button" class="more-item" data-action="leave-case" data-id="${c.id}">${icon('logout', 'ico-sm')}<span>Mitarbeit beenden</span></button>` : '',
      admin ? `<button type="button" class="more-item danger" data-action="delete-case" data-id="${c.id}" data-number="${esc(c.caseNumber)}">${icon('trash', 'ico-sm')}<span>Akte löschen</span></button>` : '',
    ].join('');
    if (more) quick.push(`<details class="more-menu"><summary class="btn-ghost btn-sm" aria-label="Weitere Aktionen">${icon('more', 'ico-sm')}<span>Mehr</span></summary><div class="more-pop">${more}</div></details>`);
  } else {
    if (!c.closed) quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button>`);
    quick.push(`<button class="btn-outline btn-sm" data-action="chat-focus">${icon('chat', 'ico-sm')}<span>Nachricht zur Akte</span></button>`);
    quick.push(`<a class="btn-outline btn-sm" href="/aktenauszug?id=${c.id}" target="_blank" rel="noopener">${icon('doc', 'ico-sm')}<span>Aktenauszug</span></a>`);
  }

  const newEventBtn =
    staff || !c.closed
      ? `<button type="button" class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('plus', 'ico-sm')}<span>${staff ? 'Frist / Termin' : 'Termin anfragen'}</span></button>`
      : '';
  const eventsSection = appointments.length
    ? `<div class="section" id="secEvents"><h3 class="section-title">Termine & Fristen</h3>${appointments.map((e) => eventRow(e)).join('')}</div>`
    : emptySection('secEvents', 'Termine & Fristen', 'keine', newEventBtn);

  const invoiceList = invoices.length
    ? invoices
        .map(
          (i) => {
            // Kanzlei: das Symbol öffnet direkt das Google Doc, die Nummer die Ansicht der Website
            const gd = staff ? safeGdoc(i.googleDoc) : null;
            const open = gd
              ? `<a class="icon-btn sm" href="${esc(gd)}" target="_blank" rel="noopener noreferrer" aria-label="Google Doc öffnen" title="Google Doc öffnen">${icon('doc', 'ico-sm')}</a>`
              : `<a class="icon-btn sm" href="/rechnung?id=${i.id}" target="_blank" rel="noopener" aria-label="Ansehen" title="Ansehen">${icon('eye', 'ico-sm')}</a>`;
            return `<div class="list-row wrap inv-row"><div class="main"><div class="title">${docTitleLink(`/rechnung?id=${i.id}`, esc(i.number), 'font-mono text-gold')} · ${esc(invKind(i))}</div><div class="meta">${esc(fmtDate(i.createdAt))} · ${esc(i.issuerName)}</div></div>
            <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end"><span class="font-mono nowrap">${money(i.total)}</span>${invoiceBadge(i)}${open}</div>${
              paymentButtons(i) ? `<div class="inv-pay-row">${paymentButtons(i)}</div>` : ''
            }</div>`;
          }
        )
        .join('')
    : '';

  // Verlauf: automatische Einträge und (nur Kanzlei) interne Notizen – Nachrichten stehen im Chat
  const log = notes.filter((n) => n.system || n.internal);
  const noteItem = (n) => {
    const canDelete = !n.system && (n.authorId === me || admin);
    const pinBtn = staff && n.internal && !n.system
      ? `<button type="button" class="icon-btn sm tl-pin${n.pinned ? ' on' : ''}" data-action="note-pin" data-case-id="${c.id}" data-id="${n.id}" data-on="${n.pinned ? '0' : '1'}" aria-label="${n.pinned ? 'Notiz lösen' : 'Notiz oben anpinnen'}" title="${n.pinned ? 'Lösen' : 'Oben in der Akte anpinnen'}">${icon('pin', 'ico-sm')}</button>`
      : '';
    return `<div class="tl-item ${n.internal ? 'tl-internal' : ''} ${n.system ? 'tl-system' : ''}">
              <div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span>${n.authorRole && ROLES[n.authorRole] ? `<span>${esc(ROLES[n.authorRole])}</span>` : ''}<span>${esc(fmtDate(n.createdAt))}</span>${n.internal ? '<span class="stamp-mini" title="Interne Notiz – nur für die Kanzlei">Vertraulich</span>' : ''}
              ${pinBtn}${canDelete ? `<button type="button" class="icon-btn sm tl-del" data-action="delete-note" data-case-id="${c.id}" data-id="${n.id}" aria-label="Notiz löschen" title="Notiz löschen">${icon('trash', 'ico-sm')}</button>` : ''}</div>
              <div class="tl-body">${n.internal ? mentionHtml(n.body) : esc(n.body)}</div></div>`;
  };
  // Mit Phasen: frühere Schritte des Verfahrens klappen zu einer Zeile zusammen, der aktuelle bleibt offen
  const phases = staff ? phaseGroups(log) : [{ items: log }];
  const noteList = log.length
    ? phases.length > 1
      ? `<div class="timeline phases">${phases
          .map((ph, i) => {
            const last = i === phases.length - 1;
            if (!ph.items.length) return '';
            const from = fmtDateOnly(String(ph.items[0].createdAt).slice(0, 10));
            const to = fmtDateOnly(String(ph.items[ph.items.length - 1].createdAt).slice(0, 10));
            return `<details class="phase" ${last ? 'open' : ''}><summary><span class="phase-name">${esc(ph.label)}</span><span class="phase-meta">${ph.items.length} ${ph.items.length === 1 ? 'Eintrag' : 'Einträge'} · ${esc(from === to ? from : `${from} – ${to}`)}</span></summary>${ph.items.map(noteItem).join('')}</details>`;
          })
          .join('')}</div>`
      : `<div class="timeline">${log.map(noteItem).join('')}</div>`
    : '<p class="text-sm text-dim">Noch keine Einträge.</p>';

  // Angepinnte interne Notizen: ganz oben in der Akte, damit sie niemand übersieht (nur Kanzlei)
  const pinned = staff ? notes.filter((n) => n.pinned && n.internal && !n.system) : [];
  const pinnedStrip = pinned.length
    ? `<div class="pin-notes">${pinned
        .map(
          (n) => `<div class="pin-note">${icon('pin', 'ico-sm')}<div class="pin-body"><div class="pin-text">${esc(n.body)}</div><div class="pin-meta">${esc(n.author)} · ${esc(fmtDate(n.createdAt))}</div></div>
            <button type="button" class="icon-btn sm" data-action="note-pin" data-case-id="${c.id}" data-id="${n.id}" data-on="0" aria-label="Notiz lösen" title="Lösen">${icon('x', 'ico-sm')}</button></div>`
        )
        .join('')}</div>`
    : '';

  // Abschnitte der Akte (in dieser Reihenfolge) – die Sprungleiste zeigt nur, was es in der Akte gibt
  const contractList = contracts.filter((k) => k.kind !== 'schriftsatz');
  const briefList = contracts.filter((k) => k.kind === 'schriftsatz');
  const parts = {
    charges: staff ? chargesSection(c, charges, deals) : dealClientCard(c, deals),
    chat: chatSection(c, chat, ticket),
    witnesses: witnessesSection(c, parties),
    contracts: contractsSection(c, contractList),
    briefs: briefsSection(c, briefList),
    external: externalSection(c, externalDocs),
    evidence: attachmentsSection(c, attachments, linkedEvidence),
    requests: requestsSection(c, requests),
    tasks: staff ? caseTasksSection(c, tasks) : '',
    invoices: invoiceList
      ? `<div class="section" id="secInvoices"><h3 class="section-title">Rechnungen & Honorare</h3>${invoiceSums(c, invoices)}${invoiceList}</div>`
      : '',
    work: caseWorkSection(c, work),
  };
  const openTasks = tasks.filter((t) => !t.done).length;
  const jumps = [
    ['secCharges', 'Anklage', charges ? charges.charges.length : 0, parts.charges],
    ['secChat', 'Nachrichten', chat ? chat.messages.length : 0, parts.chat],
    ['secEvents', 'Termine', appointments.length, true],
    ['secWitnesses', 'Zeugen', parties.filter((p) => p.role === 'zeuge').length, parts.witnesses],
    ['secContracts', 'Verträge', contractList.length, parts.contracts],
    ['secBriefs', 'Schriftsätze', briefList.length, parts.briefs],
    ['secExternal', 'Dokumente', externalDocs.length, parts.external],
    ['secEvidence', 'Beweise', attachments.length + linkedEvidence.reduce((n, k) => n + k.attachments.length, 0), parts.evidence],
    ['secRequests', 'Unterlagen', requests.filter((r) => !r.done).length, parts.requests],
    ['secTasks', 'Aufgaben', openTasks, parts.tasks],
    ['secInvoices', 'Rechnungen', invoices.length, parts.invoices],
    ['secWork', 'Zeiten', 0, parts.work],
    ['secNotes', 'Verlauf', 0, true],
  ].filter((j) => j[3]);
  const jumpBar = `<nav class="case-jump" aria-label="Abschnitte der Akte"><div class="case-jump-list">${jumps
    .map(([id, label, n]) => `<button type="button" class="jump" data-action="scroll-to" data-target="${id}">${esc(label)}${n ? `<span class="jump-n">${n}</span>` : ''}</button>`)
    .join('')}</div></nav>`;

  return `
      <div class="case-head case-cover mb-5" data-case-head="${c.id}">
        <span class="cover-tab" aria-hidden="true">${staff && c.priority >= 3 && !c.closed ? `<i class="cover-tab-dot p${c.priority}"></i>` : ''}Akte</span>
        ${c.closed ? '<span class="cover-stamp" aria-hidden="true">Abgeschlossen</span>' : ''}
        <div class="pr-12"><div class="case-num-row"><button type="button" class="font-mono text-gold text-sm case-emboss copy-az" data-action="copy" data-text="${esc(c.caseNumber)}" title="Aktenzeichen kopieren" aria-label="Aktenzeichen ${esc(c.caseNumber)} kopieren">${esc(c.caseNumber)}</button>${staff ? starBtn(c) : ''}<span class="case-area">${esc(AREAS[c.area] || c.area)}</span>${staff ? hereStrip(c.id) : ''}</div>
          <h2 id="modalTitle" class="case-title" title="${esc(c.title)}">${c.canEdit ? ie(c, 'title', c.title, { placeholder: 'Titel eintragen', cls: 'ie-title' }) : esc(c.title)}</h2>
          ${staff ? ticketChips(c, ticket, transcripts) : ''}</div>
        <div class="case-props">${headProps}</div>
      </div>
      ${jumpBar}
      ${staff ? clientFlagStrip(c.clientFlag, { inCase: true }) : ''}
      ${idleStrip}
      ${pinnedStrip}
      ${claim}
      ${track}
      ${
        staff
          ? `<div class="info-grid stats-4 mb-4">${caseStats(c, { appointments, tasks })}</div>
      <details class="case-details mb-5" ${detailsClosed() ? '' : 'open'}><summary>Details</summary>
        <div class="info-grid">${info}</div>${accountRow}${partiesHtml(c, parties, overlaps)}</details>`
          : `<div class="info-grid mb-5">${info}</div>`
      }
      ${clientLinkBanner(c, clientSuggestions)}
      ${staff ? processTicketForm(c) : ticket ? `<div class="ticket-strips">${ticketBanner(c, ticket, transcripts)}</div>` : ''}
      ${quick.length ? `<div class="form-actions case-quick mb-2">${quick.join('')}</div>` : ''}
      ${staff ? '' : reviewSection(c, review)}
      ${
        c.canEdit
          ? `${intakeAnswersHtml(c)}<div class="section"><h3 class="section-title">Sachverhalt</h3><div class="ie-block">${ie(c, 'description', c.description, { type: 'textarea', placeholder: 'Sachverhalt beschreiben …', cls: 'ie-text' })}</div></div>
      <div class="section"><h3 class="section-title">Statushinweis <span class="text-xs text-dim font-normal">sichtbar für den Mandanten</span></h3><div class="ie-block">${ie(c, 'publicNote', c.publicNote, { type: 'textarea', placeholder: 'Statushinweis für den Mandanten …', cls: 'ie-text' })}</div></div>`
          : `${intakeAnswersHtml(c)}${c.description ? `<div class="section"><h3 class="section-title">Sachverhalt</h3><p class="text-sm whitespace-pre-wrap text-muted">${esc(c.description)}</p></div>` : emptySection('', 'Sachverhalt', 'noch nicht beschrieben')}
      ${c.publicNote ? `<div class="section"><h3 class="section-title">Statushinweis</h3><div class="banner banner-gold mb-0"><p class="text-sm whitespace-pre-wrap">${esc(c.publicNote)}</p></div></div>` : ''}`
      }
      ${staff ? precedentStrip(c, similar, precedentId) : ''}
      ${parts.charges}
      ${parts.chat}
      ${eventsSection}
      ${parts.witnesses}
      ${parts.contracts}
      ${parts.briefs}
      ${parts.external}
      ${parts.evidence}
      ${parts.requests}
      ${parts.tasks}
      ${parts.invoices}
      ${parts.work}
      <div class="section" id="secNotes"><h3 class="section-title">${staff ? 'Verlauf & interne Notizen' : 'Verlauf'}</h3>
        <p class="case-origin">Eröffnet ${esc(fmtDate(c.createdAt))}${staff ? ` · Eingang über ${esc(SOURCES[c.source] || c.source)}` : ''}</p>
        ${logMore ? `<div class="log-more"><button type="button" class="btn-ghost btn-sm" data-action="log-older" data-case-id="${c.id}">${icon('chevronDown', 'ico-sm')}<span>${logMore} ältere ${logMore === 1 ? 'Eintrag' : 'Einträge'} laden</span></button></div>` : ''}
        ${noteList}
        ${staff
        ? `<form data-form="add-note" data-id="${c.id}" class="mt-4 space-y-3">
          <input type="hidden" name="internal" value="on">
          <textarea name="body" rows="3" maxlength="4000" required class="field" placeholder="Notiz, Telefonat, Beweismittel, nächster Schritt … ( / für Textbausteine, @Name benachrichtigt Kollegen)" aria-label="Neue interne Notiz" data-snippets></textarea>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-xs text-dim">Interne Notizen sieht nur die Kanzlei – Nachrichten an den Mandanten oben unter „Nachrichten“.</span>
            <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Notiz speichern</span></button>
          </div>
        </form>`
        : ''}
      </div>`;
}

/** Zusatzfelder des Rechtsgebiets im Formular „Neue Akte / Mandat einreichen“ (Einstellungen → Listen → Rechtsgebiete). */
function areaFieldsHtml(areaKey, saved = {}, staff = false) {
  const a = AREA_META.list.find((x) => x.key === areaKey);
  if (!a || !a.fields || !a.fields.length) return '';
  const field = (f) => {
    const id = `ncF-${f.key}`;
    const req = f.required && !staff && f.type !== 'checkbox' ? ' required' : '';
    const label = `${esc(f.label)}${f.required && !staff ? ' *' : ''}`;
    const hint = f.hint ? `<p class="form-hint">${esc(f.hint)}</p>` : '';
    const v = saved[f.key] ?? '';
    if (f.type === 'checkbox') return `<label class="check span-2"><input type="checkbox" id="${id}" data-answer="${esc(f.key)}" ${v === true || v === 'Ja' ? 'checked' : ''}> ${esc(f.label)}</label>`;
    if (f.type === 'textarea') return `<div class="span-2"><label class="label" for="${id}">${label}</label><textarea id="${id}" data-answer="${esc(f.key)}" rows="3" maxlength="2000" class="field"${req}>${esc(v)}</textarea>${hint}</div>`;
    if (f.type === 'select') return `<div><label class="label" for="${id}">${label}</label><select id="${id}" data-answer="${esc(f.key)}" class="field"${req}><option value="">– bitte wählen –</option>${f.options.map((o) => opt(o, o, v === o)).join('')}</select>${hint}</div>`;
    return `<div><label class="label" for="${id}">${label}</label><input id="${id}" data-answer="${esc(f.key)}" type="${f.type === 'date' ? 'date' : 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} maxlength="300" class="field" value="${esc(v)}"${req}>${hint}</div>`;
  };
  return `<div class="area-fields-grid form-grid cols-2"><div class="span-2 label mb-0">Angaben zu ${esc(a.name)}</div>${a.fields.map(field).join('')}</div>`;
}
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('form[data-form="new-case"] [data-area-select]');
  const box = sel && document.getElementById('ncAreaFields');
  if (!box) return;
  const saved = {};
  box.querySelectorAll('[data-answer]').forEach((el) => (saved[el.dataset.answer] = el.type === 'checkbox' ? el.checked : el.value));
  box.innerHTML = areaFieldsHtml(sel.value, saved, isStaff());
});
/** Antworten auf die Zusatzfelder in der Akte (Bezeichnung zum Zeitpunkt des Einreichens). */
function intakeAnswersHtml(c) {
  const rows = Object.values(c.intakeAnswers || {});
  if (!rows.length) return '';
  return `<div class="section"><h3 class="section-title">Angaben zum Mandat</h3><dl class="intake-answers">${rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl></div>`;
}

/* ---------------------------------------------------------------- Mandanten-Konto beim Tippen des Namens vorschlagen */
let ncTimer = 0;
let ncSeq = 0;
function ncPick(account) {
  const input = $('#ncName');
  const box = $('#ncPicked');
  if (!input || !box) return;
  $('#ncEmail').value = account ? account.email : '';
  box.hidden = !account;
  box.innerHTML = account ? `${icon('link', 'ico-sm')}<span>Verknüpft mit dem Konto <strong>${esc(account.name)}</strong> · ${esc(account.email)}</span><button type="button" class="ie-link" data-action="nc-unpick">lösen</button>` : '';
  if (account) input.value = account.name;
  ncClose();
}
function ncClose() {
  const list = $('#ncSuggest');
  if (list) {
    list.hidden = true;
    list.innerHTML = '';
  }
  const input = $('#ncName');
  if (input) input.setAttribute('aria-expanded', 'false');
}
document.addEventListener('input', (e) => {
  const input = e.target.closest && e.target.closest('#ncName');
  if (!input) return;
  // Name geändert: eine frühere Verknüpfung gilt nicht mehr
  if ($('#ncEmail') && $('#ncEmail').value) ncPick(null);
  clearTimeout(ncTimer);
  const q = input.value.trim();
  if (q.length < 2) return ncClose();
  const seq = ++ncSeq;
  ncTimer = setTimeout(
    () =>
      guard(async () => {
        const { accounts } = await api.get(`/api/cases/client-accounts?q=${encodeURIComponent(q)}`);
        if (seq !== ncSeq || !$('#ncSuggest')) return;
        const list = $('#ncSuggest');
        if (!accounts.length) return ncClose();
        list.innerHTML = accounts
          .slice(0, 6)
          .map((a) => `<li role="option"><button type="button" class="client-suggest-item" data-action="nc-pick" data-name="${esc(a.name)}" data-email="${esc(a.email)}"><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span></button></li>`)
          .join('');
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }),
    180
  );
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#ncSuggest') && !$('#ncSuggest').hidden) {
    e.stopPropagation();
    ncClose();
  }
});
document.addEventListener('click', (e) => {
  if ($('#ncSuggest') && !e.target.closest('.client-suggest')) ncClose();
});

async function newCaseModal() {
  const staff = isStaff();
  if (staff) await load.lawyers();
  openModal(`
      <h2 class="modal-title">${staff ? 'Neue Akte anlegen' : 'Mandat einreichen'}</h2>
      <p class="modal-sub">${staff ? 'Mandanten ohne Website-Konto einfach per Name erfassen. Die Akte wird Ihnen direkt zugewiesen – weitere Anwälte können Sie unten hinzufügen.' : 'Schildern Sie Ihr Anliegen – ein Anwalt der Kanzlei meldet sich umgehend.'}</p>
      <form data-form="new-case" class="form-grid cols-2">
        ${staff ? `
          <div class="client-suggest"><label class="label" for="ncName">Mandant (Name)</label><input id="ncName" name="clientName" class="field" maxlength="80" placeholder="Name eintippen – passende Konten erscheinen" autocomplete="off" autofocus role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ncSuggest">
            <input type="hidden" name="clientEmail" id="ncEmail">
            <ul class="client-suggest-list" id="ncSuggest" role="listbox" hidden></ul>
            <div class="client-picked" id="ncPicked" hidden></div></div>
          <div><label class="label" for="ncPhone">Telefon (im Spiel)</label><input id="ncPhone" name="clientPhone" class="field" maxlength="40" placeholder="555-0123"></div>` : ''}
        <div class="span-2"><label class="label" for="ncTitle">Titel</label><input id="ncTitle" name="title" class="field" required minlength="3" maxlength="120" placeholder="z. B. Festnahme am Legion Square" ${staff ? '' : 'autofocus'}></div>
        <div><label class="label">Rechtsgebiet${staff && can('settings.edit') ? ' <button type="button" class="ie-link" data-action="area-quick-new">+ neu</button>' : ''}</label><select name="area" class="field" data-area-select>${areaOptions().map(([k, l]) => opt(k, l)).join('')}</select></div>
        ${staff
          ? `<div><label class="label">Priorität</label><select name="priority" class="field">${Object.entries(PRIORITY).map(([k, [l]]) => opt(k, l, k === '2')).join('')}</select></div>`
          : `<div><label class="label">Dringlichkeit</label><select name="urgency" class="field">${Object.entries(URGENCY).map(([k, [l]]) => opt(k, l)).join('')}</select></div>`}
        ${staff ? `<div><label class="label">Gegenpartei</label><input name="opponent" class="field" maxlength="120" placeholder="optional"></div>
          <div><label class="label">Gerichtsaktenzeichen</label><input name="courtRef" class="field" maxlength="60" placeholder="optional"></div>` : ''}
        ${staff ? lawyerPicker({ leadId: st.user.id, withLead: isAdmin(), emptyLead: 'Noch niemand (offene Anfrage)' }) : ''}
        <div class="span-2 area-fields" id="ncAreaFields">${areaFieldsHtml((areaOptions()[0] || [''])[0], {}, staff)}</div>
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
        ${evs.slice(0, 3).map((e) => `<span class="cal-ev t-${esc(e.type)} ${e.status === 'erledigt' ? 'line-through opacity-60' : ''}${e.id === st.cal.landed ? ' cal-landed' : ''}" data-ev="${e.id}" title="Zum Verschieben auf einen anderen Tag ziehen">${esc(fmtTime(e.startsAt))} ${esc(e.title)}</span>`).join('')}
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
            ${selected.length ? selected.map((e) => eventRow(e, { date: false })).join('') : empty('Keine Einträge an diesem Tag.', 'calendar', nextStep('Eintrag anlegen', 'new-event', { day: st.cal.selected }))}
          </section>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">Offene Fristen</h2></div>
            ${deadlines.length ? deadlines.map((e) => eventRow(e)).join('') : empty('Keine offenen Fristen.', 'clock')}
          </section>
        </aside>
      </div>`;
}

/*
 * Kalender (PC): einen Eintrag mit der Maus auf einen anderen Tag ziehen – die Uhrzeit bleibt, der Eintrag rastet am
 * neuen Tag weich ein. Der Mandant erfährt die Verlegung wie sonst auch (Ticket bzw. Discord-Nachricht).
 */
const calDrag = { ev: null, chip: null, ghost: null, over: null, x: 0, y: 0, moved: false };
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.pointerType !== 'mouse' || st.view !== 'calendar' || !isStaff()) return;
  const chip = e.target.closest && e.target.closest('#content .cal-ev[data-ev]');
  if (chip) Object.assign(calDrag, { ev: Number(chip.dataset.ev), chip, x: e.clientX, y: e.clientY, moved: false });
});
document.addEventListener('pointermove', (e) => {
  if (!calDrag.ev) return;
  if (!calDrag.moved) {
    if (Math.hypot(e.clientX - calDrag.x, e.clientY - calDrag.y) < 6) return;
    calDrag.moved = true;
    calDrag.ghost = calDrag.chip.cloneNode(true);
    calDrag.ghost.classList.add('cal-ghost');
    document.body.appendChild(calDrag.ghost);
    document.body.classList.add('cal-dragging');
  }
  calDrag.ghost.style.left = `${e.clientX + 10}px`;
  calDrag.ghost.style.top = `${e.clientY + 10}px`;
  const day = document.elementFromPoint(e.clientX, e.clientY)?.closest('#content .cal-day[data-day]') || null;
  if (day === calDrag.over) return;
  calDrag.over?.classList.remove('drop-target');
  calDrag.over = day;
  day?.classList.add('drop-target');
});
document.addEventListener('pointerup', async () => {
  const { ev, moved, over, ghost } = calDrag;
  Object.assign(calDrag, { ev: null, chip: null, ghost: null, over: null, moved: false });
  if (!ev || !moved) return;
  ghost.remove();
  over?.classList.remove('drop-target');
  document.body.classList.remove('cal-dragging');
  // Der Klick nach dem Loslassen wählt keinen Tag aus
  const eat = (c) => {
    c.stopPropagation();
    c.preventDefault();
  };
  window.addEventListener('click', eat, true);
  setTimeout(() => window.removeEventListener('click', eat, true), 0);
  const e = st.events.find((x) => x.id === ev);
  const from = e && parseDate(e.startsAt);
  if (!over || !from || dayKey(from) === over.dataset.day) return;
  const [y, m, d] = over.dataset.day.split('-').map(Number);
  const to = new Date(from);
  to.setFullYear(y, m - 1, d);
  const body = { startsAt: to.toISOString() };
  if (e.endsAt) body.endsAt = new Date(parseDate(e.endsAt).getTime() + (to - from)).toISOString();
  await guard(async () => {
    await api.patch(`/api/calendar/${ev}`, body);
    st.cal.selected = over.dataset.day;
    st.cal.landed = ev;
    toast(`„${e.title}“ auf ${to.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })} verschoben.`);
    await refreshBehind();
    st.cal.landed = null;
  });
});

/** Monatswechsel: der neue Monat gleitet von der Seite herein, aus der man kommt. */
function calSlide(dir) {
  const grid = $('#content .cal-grid');
  if (!grid || window.PS.motion.calm() || typeof grid.animate !== 'function') return;
  grid.animate([{ transform: `translateX(${dir * 36}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
}
// Am Handy: über den Kalender wischen wechselt den Monat
let calTouch = null;
document.addEventListener('touchstart', (e) => {
  const grid = e.target.closest && e.target.closest('#content .cal-grid');
  calTouch = grid && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!calTouch || st.view !== 'calendar') return;
  const t = e.changedTouches[0];
  const dx = t.clientX - calTouch.x;
  const dy = t.clientY - calTouch.y;
  calTouch = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
  const btn = $(`#content [data-action="cal-nav"][data-dir="${dx < 0 ? 1 : -1}"]`);
  if (btn) btn.click();
}, { passive: true });

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
        ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : empty('Keine anstehenden Termine.', 'calendar', nextStep('Termin anfragen', 'new-event'))}</section>
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

/** Terminart (eigene Arten aus Einstellungen → Listen) und – wo es eine Rechenregel gibt – der Fristenrechner. */
function eventKindBox(v, isNew) {
  const kinds = st.eventKinds || [];
  if (!kinds.length && !v.kind) return '';
  const list = kinds.some((k) => k.key === v.kind) ? kinds : v.kind ? [...kinds, { key: v.kind, name: v.typeLabel || v.kind, base: v.type, ruleAmount: 0 }] : kinds;
  return `<div class="span-2 kind-box"><label class="label" for="evKind">Terminart</label>
      <select id="evKind" name="kind" class="field" data-event-kind><option value="">Standard (nach der Art oben)</option>${list.map((k) => `<option value="${esc(k.key)}" ${v.kind === k.key ? 'selected' : ''}>${esc(k.name)}${k.rule ? ` – ${esc(k.rule)}` : ''}</option>`).join('')}</select>
      <div class="deadline-calc" id="evCalc" hidden>
        <label class="label" for="evFrom" id="evFromLabel">Ausgangsdatum</label>
        <input id="evFrom" type="date" class="field" data-event-from>
        <p class="form-hint" id="evCalcOut" aria-live="polite"></p>
      </div></div>`;
}

function eventForm(e, preset = {}) {
  const isNew = !e;
  const v = e || {};
  const type = v.type || preset.type || 'gericht';
  const start = v.startsAt ? toLocalInput(v.startsAt) : preset.start || (preset.day ? `${preset.day}T10:00` : '');
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
      <p class="modal-sub">${isNew ? 'Gerichtstermine, Fristen, Mandantengespräche und interne Termine – mit Countdown im Dashboard und Discord-Erinnerung 24 h vorher.' : `${esc(evLabel(v))} · ${statusBadge(EVENT_STATUS, v.status)}${v.creatorName ? ' · angelegt von ' + esc(v.creatorName) : ''}${v.clientName ? ' · Mandant: ' + esc(v.clientName) : ''}`}</p>
      ${!isNew && !['abgesagt', 'erledigt'].includes(v.status) ? `<div class="mb-4">${countdownHtml(v)}${fristBar(v)}</div>` : ''}
      <form data-form="event" data-id="${isNew ? '' : v.id}" class="form-grid cols-2">
        <div class="span-2"><span class="label">Art</span><div class="seg">${Object.entries(EVENT_TYPES)
        .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="type" value="${k}" ${type === k ? 'checked' : ''}><span><i class="cal-dot" style="background:${EVENT_COLORS[k]}"></i>${esc(l)}</span></label>`)
        .join('')}</div></div>
        ${eventKindBox(v, isNew)}
        <div class="span-2"><label class="label" for="evTitle">Titel</label><input id="evTitle" name="title" class="field" required minlength="2" maxlength="120" value="${esc(v.title || preset.title || '')}" placeholder="z. B. Hauptverhandlung Strafsache Doe" autofocus></div>
        <div><label class="label" for="evStart">Beginn / Fälligkeit</label><input id="evStart" name="startsAt" type="datetime-local" class="field" required value="${start}"></div>
        <div><label class="label" for="evEnd">Ende (optional)</label><input id="evEnd" name="endsAt" type="datetime-local" class="field" value="${v.endsAt ? toLocalInput(v.endsAt) : ''}"></div>
        <div><label class="label">Akte (optional)</label><select name="caseId" class="field"><option value="">Keine Akte</option>${caseOpts}</select></div>
        <div><label class="label">Zuständig</label><select name="assignedTo" class="field"><option value="">Niemand</option>${st.lawyers.map((l) => opt(l.id, l.displayName, l.id === assigned)).join('')}</select></div>
        <div class="span-2"><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="${esc(v.location ?? (type === 'frist' ? '' : 'Kanzlei Würfelpark'))}" placeholder="z. B. District Court, Saal 2"></div>
        <div class="span-2"><label class="label">Notiz</label><textarea name="note" rows="3" class="field" maxlength="1000" placeholder="Vorbereitung, Unterlagen, Hinweise …">${esc(v.note || preset.note || '')}</textarea></div>
        <label class="check span-2"><input type="checkbox" name="clientVisible" ${visible ? 'checked' : ''}> Für den Mandanten im Portal sichtbar</label>
        ${isNew && feature('slots') ? `<details class="span-2 slot-box"><summary>Terminvorschlag: Mandant wählt die Zeit</summary>
          <p class="form-hint">Nur für Mandantengespräche in einer Akte mit Mandanten-Konto. Oben steht die erste Zeit, hier bis zu zwei weitere – der Mandant tippt im Portal eine an, danach ist der Termin bestätigt.</p>
          <div class="form-grid cols-2"><div><label class="label" for="evSlot2">Zweite Zeit</label><input id="evSlot2" name="slot2" type="datetime-local" class="field"></div>
          <div><label class="label" for="evSlot3">Dritte Zeit</label><input id="evSlot3" name="slot3" type="datetime-local" class="field"></div></div></details>`
          : v.proposal ? `<div class="span-2 banner banner-gold"><div>${icon('calendar')} <strong>Mandant wählt aus:</strong> ${v.slots.map((x) => esc(fmtDate(x))).join(' · ')}</div></div>` : ''}
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
      <p class="modal-sub">${esc(evLabel(e))} · ${statusBadge(EVENT_STATUS, e.status)}</p>
      <div class="info-grid mb-4">${cell('Datum', fmtDay(e.startsAt))}${cell('Uhrzeit', fmtTime(e.startsAt) + ' Uhr')}${cell('Ort', e.location || '—')}${e.caseNumber ? cell('Akte', e.caseNumber) : ''}${e.assignedName ? cell('Ansprechpartner', e.assignedName) : ''}</div>
      ${!['abgesagt', 'erledigt'].includes(e.status) ? `<div class="mb-4">${countdownHtml(e)}${fristBar(e)}</div>` : ''}
      ${e.proposal && e.clientId === st.user.id ? `<div class="slot-pick mb-4"><div class="k mb-2">Bitte eine Zeit wählen</div><div class="flex flex-wrap gap-2">${e.slots.map((x) => `<button type="button" class="btn-gold btn-md" data-action="event-choose" data-id="${e.id}" data-at="${esc(x)}">${esc(fmtDay(x))}, ${esc(fmtTime(x))} Uhr</button>`).join('')}</div><p class="form-hint">Mit einem Klick bestätigt. Passt keine Zeit? Schreiben Sie der Kanzlei unter „Nachrichten“ in der Akte.</p></div>` : ''}
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
      <div class="flex flex-wrap items-center gap-2 mb-2">${m.priority ? badge('Wichtig', 'red') : ''}${m.caseNumber ? `<button type="button" class="btn-outline btn-sm" data-action="open-case" data-id="${m.caseId}">${icon('folder', 'ico-sm')}<span>Akte ${esc(m.caseNumber)}</span></button>` : ''}</div>
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
          <div class="panel mail-list">${st.messages.length ? st.messages.map(mailItem).join('') : empty(inbox ? 'Ihr Posteingang ist leer.' : 'Noch keine gesendeten Nachrichten.', 'mail', nextStep('Nachricht schreiben', 'compose', {}, 'edit'))}</div>
          <div class="panel mail-read">${sel ? mailReader(sel) : empty('Wählen Sie links eine Nachricht aus.', 'mail')}</div>
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
        ${st.board.length ? `<div class="board-grid">${st.board.map(noteCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Notizen an der Pinnwand.', 'pin', nextStep('Notiz anheften', 'board-new'))}</div>`}`;
  },
};


/* ---------------------------------------------------------------- Terminart wählen & Fristenrechner */
function eventKindApply(select) {
  const form = select.closest('form');
  const k = (st.eventKinds || []).find((x) => x.key === select.value);
  const calc = form.querySelector('#evCalc');
  if (!k) {
    calc.hidden = true;
    return;
  }
  const radio = form.querySelector(`input[name="type"][value="${k.base}"]`);
  if (radio) radio.checked = true;
  const title = form.elements.title;
  if (!title.value.trim() || (st.eventKinds || []).some((x) => x.name === title.value.trim())) title.value = k.name;
  if (k.defaultLocation) form.elements.location.value = k.defaultLocation;
  if (k.clientVisible !== null && k.clientVisible !== undefined) form.elements.clientVisible.checked = k.clientVisible;
  const start = form.elements.startsAt.value;
  if (k.defaultMinutes && start) {
    const end = new Date(new Date(start).getTime() + k.defaultMinutes * 60000);
    form.elements.endsAt.value = toLocalInput(end.toISOString());
  }
  calc.hidden = !k.ruleAmount;
  if (k.ruleAmount) {
    form.querySelector('#evFromLabel').textContent = `${k.ruleFrom || 'Ausgangsdatum'} (${k.rule})`;
    form.querySelector('#evCalcOut').textContent = 'Datum eintragen – das Fristende wird berechnet und als Fälligkeit übernommen.';
    if (form.querySelector('#evFrom').value) eventKindCalc(form.querySelector('#evFrom'));
  }
}
async function eventKindCalc(input) {
  const form = input.closest('form');
  const key = form.elements.kind.value;
  const out = form.querySelector('#evCalcOut');
  if (!key || !input.value) return;
  try {
    const r = await api.post(`/api/event-kinds/${encodeURIComponent(key)}/calc`, { from: input.value });
    out.textContent = `${r.text} · ${r.rule}. Feiertage sind nicht berücksichtigt.`;
    form.elements.startsAt.value = `${r.date}T${form.querySelector('input[name="type"]:checked')?.value === 'frist' ? '23:59' : '10:00'}`;
  } catch (err) {
    out.textContent = err.message;
  }
}
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('select[data-event-kind]');
  if (sel) return eventKindApply(sel);
  const from = e.target.closest && e.target.closest('input[data-event-from]');
  if (from) guard(() => eventKindCalc(from));
});
