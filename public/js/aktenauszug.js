/*
 * Aktenauszug (Druckansicht / PDF): Stammdaten, Sachverhalt, Termine, externe Dokumente, Verträge, Rechnungen,
 * Verlauf und Anhänge einer Akte – Abschnitte frei wählbar. Die Daten kommen aus derselben Schnittstelle wie die
 * Akte im Dashboard; Mandanten sehen dort ohnehin nur, was für sie freigegeben ist. Interne Angaben (interne
 * Notizen, Aufgaben, Priorität, interne Dokumente/Anhänge) kommen nur auf Wunsch der Kanzlei in den Auszug.
 */
(() => {
  'use strict';
  const { api, esc, fmtDate, parseDate, money } = window.PS;
  window.PS.closeToDashboard(document.getElementById('backLink'));

  const AREAS = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
  const URGENCY = { normal: 'Normal', eilig: 'Eilig', notfall: 'Notfall' };
  const PRIORITY = { 1: 'Niedrig', 2: 'Normal', 3: 'Hoch', 4: 'Kritisch' };
  const EVENT_STATUS = { angefragt: 'Angefragt', bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt', erledigt: 'Erledigt' };
  const INVOICE_KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
  const INVOICE_STATUS = { offen: 'Offen', bezahlt: 'Bezahlt', storniert: 'Storniert' };
  const CONTRACT_STATUS = { entwurf: 'Entwurf', teilweise: 'Teilweise unterschrieben', unterschrieben: 'Unterschrieben' };
  const PROVIDER = { fivenet: 'FiveNet', gdocs: 'Google Docs', gsheets: 'Google Sheets' };
  const ROLES = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Board of Partners' };

  // [Schlüssel, Bezeichnung, Standard, { sub: übergeordneter Schlüssel, staff: nur Kanzlei }]
  const OPTIONS = [
    ['description', 'Sachverhalt', true],
    ['events', 'Termine & Fristen', true],
    ['docs', 'Externe Dokumente (FiveNet, Google)', true],
    ['docsText', 'mit Abschrift / Inhalt', false, { sub: 'docs' }],
    ['contracts', 'Verträge & Schriftsätze', true],
    ['invoices', 'Rechnungen & Honorare', true],
    ['log', 'Verlauf & Notizen', true],
    ['logSystem', 'automatische Einträge (Status, Zuständigkeit …)', true, { sub: 'log' }],
    ['attachments', 'Anhänge (Beweismittel)', true],
    ['images', 'Bilder abdrucken', false, { sub: 'attachments' }],
    ['internal', 'Interne Angaben einbeziehen', false, { staff: true, group: 'Nur für die Kanzlei' }],
    ['tasks', 'Aufgaben & Wiedervorlagen', true, { staff: true, sub: 'internal' }],
  ];
  const STORE = 'ps-aktenauszug';

  const root = document.getElementById('doc');
  const panel = document.getElementById('optsPanel');
  const id = Number(new URLSearchParams(location.search).get('id'));
  const dateDe = (v) => {
    const d = parseDate(v);
    return d ? d.toLocaleDateString('de-DE') : '—';
  };
  const dayDe = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('de-DE') : '—');
  const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;
  const intPill = (on) => (on ? pill('intern', 'int') : '');

  let data = null;
  let firm = { address: '', contact: '' };
  let staff = false;
  let opts = {};

  function loadOpts() {
    const defaults = Object.fromEntries(OPTIONS.map(([k, , d]) => [k, d]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }
  function saveOpts() {
    try {
      localStorage.setItem(STORE, JSON.stringify(opts));
    } catch {
      /* privates Fenster o. Ä. – dann gilt die Auswahl nur jetzt */
    }
  }

  function renderPanel() {
    let html = '<h3>Abschnitte</h3>';
    let group = null;
    for (const [key, label, , o = {}] of OPTIONS) {
      if (o.staff && !staff) continue;
      if (o.group && o.group !== group) {
        group = o.group;
        html += `<h3>${esc(group)}</h3>`;
      }
      const parentOff = o.sub && !opts[o.sub];
      html += `<label class="${o.sub ? 'sub' : ''}"><input type="checkbox" data-opt="${key}" ${opts[key] ? 'checked' : ''} ${parentOff ? 'disabled' : ''}> ${esc(label)}</label>`;
    }
    html += `<p class="note">${
      staff
        ? 'Ohne „Interne Angaben“ enthält der Auszug nur, was auch der Mandant im Portal sieht – geeignet zur Weitergabe. Ein Google Doc übernimmt diese Auswahl; jeder mit dem Link kann es lesen.'
        : 'Der Auszug enthält alles, was Sie im Mandantenportal zu dieser Akte sehen.'
    } Die Auswahl merkt sich dieser Browser.</p>`;
    panel.innerHTML = html;
  }

  panel.addEventListener('change', (e) => {
    const key = e.target.dataset.opt;
    if (!key) return;
    opts[key] = e.target.checked;
    saveOpts();
    renderPanel();
    render();
  });
  document.getElementById('printBtn').addEventListener('click', () => {
    document.getElementById('opts').open = false;
    window.print();
  });
  // Klick außerhalb schließt die Auswahl
  document.addEventListener('click', (e) => {
    const box = document.getElementById('opts');
    if (box.open && !box.contains(e.target)) box.open = false;
  });

  /* ---------------------------------------------------------------- Abschnitte */
  function factsSection(c, internal) {
    const lawyers = [c.lawyerName ? `${c.lawyerName}${(c.coLawyers || []).length ? ' (federführend)' : ''}` : null, ...(c.coLawyers || []).map((l) => l.name)].filter(Boolean);
    const facts = [
      ['Mandant', c.clientName],
      ['Gegenpartei', c.opponent || '—'],
      ['Rechtsgebiet', AREAS[c.area] || c.area],
      ['Dringlichkeit (Angabe Mandant)', URGENCY[c.urgency] || c.urgency],
      ['Status', c.statusLabel],
      ['Verfahrensstand', c.stepLabel],
      ['Zuständig', lawyers.length ? lawyers.join(', ') : 'Noch nicht zugewiesen'],
      ['Gerichtsaktenzeichen', c.courtRef || '—'],
      ['Angelegt', fmtDate(c.createdAt)],
      ['Zuletzt geändert', fmtDate(c.updatedAt)],
    ];
    if (internal && c.priority) facts.push(['Priorität (intern)', PRIORITY[c.priority] || c.priority]);
    if (internal && c.processTicket) facts.push(['Prozessticket (intern)', `<a href="${esc(c.processTicket.url)}">${esc(c.processTicket.label || c.processTicket.url)}</a>`, true]);
    return `<section><h2>Stammdaten</h2><div class="facts">${facts
      .map(([k, v, raw]) => `<div><div class="k">${esc(k)}</div><div class="v">${raw ? v : esc(v)}</div></div>`)
      .join('')}</div>${c.publicNote ? `<div class="callout" style="margin-top:0.9rem"><strong>Hinweis der Kanzlei:</strong> ${esc(c.publicNote)}</div>` : ''}</section>`;
  }

  function eventsSection(list, internal) {
    const rows = list.filter((e) => internal || !staff || e.clientVisible);
    return `<section><h2>Termine &amp; Fristen</h2>${
      rows.length
        ? `<table><thead><tr><th>Datum</th><th>Art</th><th>Termin</th><th>Status</th></tr></thead><tbody>${rows
            .map(
              (e) =>
                `<tr><td class="nowrap">${esc(fmtDate(e.startsAt))}</td><td>${esc(e.typeLabel)}</td><td>${esc(e.title)}${e.location ? `<div class="dim">${esc(e.location)}</div>` : ''}${staff && !e.clientVisible ? intPill(true) : ''}</td><td>${esc(EVENT_STATUS[e.status] || e.status)}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="empty">Keine Termine oder Fristen.</p>'
    }</section>`;
  }

  function docsSection(list, internal, withText) {
    const rows = list.filter((d) => internal || !d.internal);
    return `<section><h2>Externe Dokumente</h2>${
      rows.length
        ? rows
            .map(
              (d) => `<div class="doc"><div class="t">${esc(d.title || d.documentId || 'Dokument')}${intPill(d.internal)}</div>
                <div class="dim">${[PROVIDER[d.provider] || d.provider, d.docType, d.docDate ? dayDe(d.docDate) : null, d.docAuthor ? `Verfasser: ${d.docAuthor}` : null].filter(Boolean).map(esc).join(' · ')}</div>
                ${d.url ? `<div><a href="${esc(d.url)}">${esc(d.url)}</a></div>` : ''}
                ${d.summary ? `<div class="text" style="margin-top:0.3rem">${esc(d.summary)}</div>` : ''}
                ${withText && d.contentText ? `<div class="transcript">${esc(d.contentText)}</div>` : ''}</div>`
            )
            .join('')
        : '<p class="empty">Keine externen Dokumente.</p>'
    }</section>`;
  }

  function contractsSection(all, internal) {
    const list = all.filter((k) => k.kind !== 'schriftsatz');
    const briefs = all.filter((k) => k.kind === 'schriftsatz' && (internal || !k.internal));
    return contractTable('Mandatsverträge', list, 'Keine Verträge.') + (briefs.length ? contractTable('Schriftsätze', briefs, '') : '');
  }

  function contractTable(title, list, emptyText) {
    const signed = (k) =>
      [
        ...(k.needsLawyer === false ? [] : [`${k.lawyerName || 'Anwalt'}: ${k.lawyerSignedAt ? `unterschrieben ${dateDe(k.lawyerSignedAt)}` : 'offen'}`]),
        ...(k.needsLawyer === false ? [] : (k.coLawyers || []).map((l) => `${l.name}: ${l.signedAt ? `unterschrieben ${dateDe(l.signedAt)}` : 'offen'}`)),
        ...(k.needsClient === false ? [] : [`Mandant: ${k.clientSignedAt ? `unterschrieben ${dateDe(k.clientSignedAt)}` : 'offen'}`]),
      ]
        .map(esc)
        .join('<br>');
    return `<section><h2>${esc(title)}</h2>${
      list.length
        ? `<table><thead><tr><th>Dokument</th><th>Erstellt</th><th>Status</th><th>Unterschriften</th></tr></thead><tbody>${list
            .map((k) => `<tr><td>${esc(k.templateName)}${intPill(k.internal)}</td><td class="nowrap">${esc(dateDe(k.createdAt))}</td><td>${esc(CONTRACT_STATUS[k.status] || k.status)}</td><td>${signed(k)}</td></tr>`)
            .join('')}</tbody></table>`
        : `<p class="empty">${esc(emptyText)}</p>`
    }</section>`;
  }

  function invoicesSection(list) {
    const open = list.filter((i) => i.status === 'offen').reduce((s, i) => s + i.total, 0);
    return `<section><h2>Rechnungen &amp; Honorare</h2>${
      list.length
        ? `<table><thead><tr><th>Nummer</th><th>Art</th><th>Datum</th><th class="num">Betrag</th><th>Status</th></tr></thead><tbody>${list
            .map(
              (i) =>
                `<tr><td class="mono nowrap">${esc(i.number)}</td><td>${esc(INVOICE_KIND[i.kind] || i.kind)}${i.subject ? `<div class="dim">${esc(i.subject)}</div>` : ''}</td><td class="nowrap">${esc(dateDe(i.createdAt))}</td><td class="num">${money(i.total)}</td><td>${esc(INVOICE_STATUS[i.status] || i.status)}${i.overdueDays > 0 ? `<div class="dim">${i.overdueDays} ${i.overdueDays === 1 ? 'Tag' : 'Tage'} überfällig</div>` : ''}</td></tr>`
            )
            .join('')}</tbody></table>${open ? `<p class="text" style="text-align:right;margin-top:0.5rem">Offen insgesamt: <strong>${money(open)}</strong></p>` : ''}`
        : '<p class="empty">Keine Rechnungen.</p>'
    }</section>`;
  }

  function tasksSection(list) {
    return `<section><h2>Aufgaben &amp; Wiedervorlagen ${intPill(true)}</h2>${
      list.length
        ? `<table><thead><tr><th>Aufgabe</th><th>Fällig</th><th>Zuständig</th><th>Stand</th></tr></thead><tbody>${list
            .map(
              (t) =>
                `<tr><td>${esc(t.title)}${t.note ? `<div class="dim">${esc(t.note)}</div>` : ''}</td><td class="nowrap">${esc(t.dueDate ? dayDe(t.dueDate) : '—')}</td><td>${esc(t.assignedName || '—')}</td><td>${t.done ? `erledigt ${esc(dateDe(t.doneAt))}${t.doneByName ? ` (${esc(t.doneByName)})` : ''}` : 'offen'}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="empty">Keine Aufgaben.</p>'
    }</section>`;
  }

  function logSection(notes, internal, withSystem) {
    const rows = notes.filter((n) => (internal || !n.internal) && (withSystem || !n.system));
    return `<section><h2>Verlauf &amp; Notizen</h2>${
      rows.length
        ? `<div class="log">${rows
            .map(
              (n) => `<div class="entry ${n.system ? 'sys' : ''}"><div class="when">${esc(fmtDate(n.createdAt))} · <span class="who">${esc(n.author || 'System')}</span>${n.authorRole && ROLES[n.authorRole] ? ` (${esc(ROLES[n.authorRole])})` : ''}${intPill(n.internal)}</div><div class="body">${esc(n.body)}</div></div>`
            )
            .join('')}</div>`
        : '<p class="empty">Keine Einträge.</p>'
    }</section>`;
  }

  function attachmentsSection(list, internal, withImages) {
    const rows = list.filter((a) => internal || !a.internal);
    return `<section><h2>Anhänge (Beweismittel)</h2>${
      rows.length
        ? `<table><thead><tr><th>Nr.</th><th>Beschreibung</th><th class="hide-sm">Hochgeladen von</th><th>Datum</th></tr></thead><tbody>${rows
            .map((a, n) => `<tr><td class="mono">${n + 1}</td><td>${esc(a.caption || 'Bild')}${intPill(a.internal)}</td><td class="hide-sm">${esc(a.uploaderName || '—')}</td><td class="nowrap">${esc(dateDe(a.createdAt))}</td></tr>`)
            .join('')}</tbody></table>${
            withImages
              ? `<div class="gallery">${rows
                  .map((a, n) => `<figure><img src="${esc(a.url)}" alt="${esc(a.caption || `Anhang ${n + 1}`)}" loading="eager" decoding="async"><figcaption>Nr. ${n + 1}${a.caption ? ` – ${esc(a.caption)}` : ''}</figcaption></figure>`)
                  .join('')}</div>`
              : ''
          }`
        : '<p class="empty">Keine Anhänge.</p>'
    }</section>`;
  }

  /* ---------------------------------------------------------------- Seite */
  function render() {
    const c = data.case;
    const internal = staff && !!opts.internal;
    const stand = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    document.title = `Aktenauszug ${c.caseNumber} | Pake & Scha`;
    root.className = 'paper';
    root.innerHTML = `
      <div class="head">
        <div class="brand"><img class="mark" src="/img/logo.svg" width="32" height="60" alt="Pake &amp; Scha" decoding="async"><div><div class="firm">Pake &amp; Scha</div><div class="tag">Legal Consulting &amp; Advocacy</div></div></div>
        <div class="addr">${esc(firm.address)}${firm.contact ? '\n' + esc(firm.contact) : ''}</div>
      </div>
      <div class="title">
        <div><h1>Aktenauszug</h1><div class="sub">${esc(c.title)}</div></div>
        <div class="meta">
          <span>Aktenzeichen</span><span>${esc(c.caseNumber)}</span>
          <span>Stand</span><span>${esc(stand)}</span>
          ${c.courtRef ? `<span>Gericht</span><span>${esc(c.courtRef)}</span>` : ''}
        </div>
      </div>
      ${internal ? '<div class="confidential"><strong>Vertraulich – enthält interne Angaben der Kanzlei.</strong> Nicht an Mandanten oder Dritte weitergeben.</div>' : ''}
      ${factsSection(c, internal)}
      ${opts.description && c.description ? `<section><h2>Sachverhalt</h2><div class="text">${esc(c.description)}</div></section>` : ''}
      ${opts.events ? eventsSection(data.appointments || [], internal) : ''}
      ${opts.docs ? docsSection(data.externalDocs || [], internal, opts.docsText) : ''}
      ${opts.contracts ? contractsSection(data.contracts || [], internal) : ''}
      ${opts.invoices ? invoicesSection(data.invoices || []) : ''}
      ${internal && opts.tasks ? tasksSection(data.tasks || []) : ''}
      ${opts.log ? logSection(data.notes || [], internal, opts.logSystem) : ''}
      ${opts.attachments ? attachmentsSection(data.attachments || [], internal, opts.images) : ''}
      <div class="foot"><span>Pake &amp; Scha Legal Consulting · Aktenauszug ${esc(c.caseNumber)}</span><span>Stand ${esc(stand)}</span></div>`;
    // Seitenzahlen im Druck (Browser mit @page-Randfeldern, z. B. Chrome/Edge)
    let pageStyle = document.getElementById('pageStyle');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'pageStyle';
      document.head.appendChild(pageStyle);
    }
    const label = `Aktenauszug ${c.caseNumber}`.replace(/["\\]/g, '');
    pageStyle.textContent = `@page { @bottom-left { content: "Pake & Scha · ${label}"; font: 8pt Inter, sans-serif; color: #55607a; margin-left: 16mm; } @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 8pt Inter, sans-serif; color: #55607a; margin-right: 16mm; } }`;
  }

  if (!Number.isInteger(id) || id <= 0) {
    root.innerHTML = 'Keine Akte angegeben. <a href="/dashboard.html#cases">Zum Dashboard</a>';
    return;
  }
  Promise.all([api.get('/api/auth/me'), api.get('/api/cases/' + id), api.get('/api/invoices/firm').catch(() => ({ firm }))])
    .then(([me, caseData, f]) => {
      const u = me.user || me;
      staff = u.role === 'anwalt' || u.role === 'admin';
      data = caseData;
      firm = f.firm || firm;
      opts = loadOpts();
      // Zurück in genau diese Akte (aus dem Dashboard geöffnet: Tab schließen, siehe closeToDashboard)
      document.getElementById('backLink').href = `/dashboard.html?case=${id}#cases`;
      document.getElementById('backLink').textContent = '← Zur Akte';
      renderPanel();
      render();
      // Google Doc mit den hier gewählten Abschnitten (nur Kanzlei)
      if (staff) window.PS.googleDoc.mount({ kind: 'extract', id, getOptions: () => ({ ...opts }) });
      if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 600);
    })
    .catch((err) => {
      if (err.status === 401) {
        location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      root.innerHTML = `${esc(err.message)}<br><br><a href="/dashboard.html#cases">Zum Dashboard</a>`;
    });
})();
