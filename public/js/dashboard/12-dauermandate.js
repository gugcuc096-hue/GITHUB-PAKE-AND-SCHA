/*
 * Kanzlei-Dashboard – Dauermandate: feste Pauschale je Zeitraum, die Rechnung entsteht zum Fälligkeitstag von selbst
 * (Rechnungen → Reiter „Dauermandate“, siehe retainers.js). Ansehen darf die Kanzlei, pflegen das Board of Partners.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const RETAINER_INTERVAL = { 1: 'monatlich', 2: 'alle 2 Monate', 3: 'vierteljährlich', 6: 'halbjährlich', 12: 'jährlich' };
const RETAINER_STATUS = { aktiv: ['Aktiv', 'emerald'], pausiert: ['Pausiert', 'amber'], beendet: ['Beendet', 'slate'] };

async function loadRetainers() {
  st.retainers = (await api.get('/api/retainers')).retainers;
}

const retainerDue = (r) => (r.nextDue ? fmtDateOnly(r.nextDue) : '—');
const retainerIsDue = (r) => r.status === 'aktiv' && r.nextDue && r.nextDue <= dayKey(new Date());

function retainerCard(r) {
  const board = isBoard();
  const due = retainerIsDue(r);
  return `<article class="ret-card ${r.status === 'beendet' ? 'is-off' : ''}">
      <header class="ret-head"><div class="ret-title"><strong>${esc(r.title)}</strong><span class="ret-client">${esc(r.clientName)}${r.caseNumber ? ` · <span class="font-mono text-gold">${esc(r.caseNumber)}</span>` : ''}</span></div>
        <div class="ret-badges">${statusBadge(RETAINER_STATUS, r.status)}${due ? badge('Fällig', 'amber') : ''}</div></header>
      <div class="ret-facts">
        <div><div class="k">Pauschale</div><div class="v"><span class="font-mono text-gold">${money(r.amount)}</span> <span class="text-dim">${esc(RETAINER_INTERVAL[r.intervalMonths] || `alle ${r.intervalMonths} Monate`)}</span></div></div>
        <div><div class="k">Nächste Rechnung</div><div class="v">${esc(retainerDue(r))}</div></div>
        <div><div class="k">Laufzeit</div><div class="v">ab ${esc(fmtDateOnly(r.startDate))}${r.endDate ? ` bis ${esc(fmtDateOnly(r.endDate))}` : ' · unbefristet'}</div></div>
        <div><div class="k">Rechnungsart</div><div class="v">${esc(r.typeLabel)} · ${r.runs} erstellt</div></div>
      </div>
      ${r.note ? `<p class="text-sm text-muted ret-note">${esc(r.note)}</p>` : ''}
      <div class="ret-actions">
        <button type="button" class="btn-ghost btn-sm" data-action="ret-invoices" data-id="${r.id}">${icon('receipt', 'ico-sm')}<span>Rechnungen</span></button>
        ${board && due ? `<button type="button" class="btn-gold btn-sm" data-action="ret-run" data-id="${r.id}">${icon('check', 'ico-sm')}<span>Jetzt abrechnen</span></button>` : ''}
        ${board && r.status !== 'beendet' ? `<button type="button" class="btn-ghost btn-sm" data-action="ret-edit" data-id="${r.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>` : ''}
        ${board && r.status === 'aktiv' ? `<button type="button" class="btn-ghost btn-sm" data-action="ret-status" data-id="${r.id}" data-status="pausiert">Pausieren</button>` : ''}
        ${board && r.status === 'pausiert' ? `<button type="button" class="btn-ghost btn-sm" data-action="ret-status" data-id="${r.id}" data-status="aktiv">Fortsetzen</button>` : ''}
        ${board && r.status !== 'beendet' ? `<button type="button" class="btn-ghost btn-sm" data-action="ret-status" data-id="${r.id}" data-status="beendet">Beenden</button>` : ''}
        ${board && !r.runs ? `<button type="button" class="icon-btn sm push fn-danger" data-action="ret-delete" data-id="${r.id}" data-title="${esc(r.title)}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>` : ''}
      </div>
    </article>`;
}

function retainersPanel() {
  const list = st.retainers || [];
  const monthly = list.filter((r) => r.status === 'aktiv').reduce((a, r) => a + r.amount / r.intervalMonths, 0);
  return `<p class="text-sm text-muted mb-4">Feste Pauschalen für Firmen und Stammmandanten: Die Rechnung entsteht zum Fälligkeitstag <strong>von selbst</strong> (mit Zahlungsziel und Text der gewählten Rechnungsart, Meldung im Ticket und in Discord). Pausieren hält sie an, Beenden stoppt für immer.</p>
    ${list.length ? `<div class="kpi-grid kpi-grid-3 mb-4"><div class="panel kpi"><div class="kpi-label">${icon('clock', 'ico-sm')}Aktive Dauermandate</div><div class="kpi-value">${list.filter((r) => r.status === 'aktiv').length}</div></div>
      <div class="panel kpi"><div class="kpi-label">${icon('receipt', 'ico-sm')}Pro Monat</div><div class="kpi-value">${money(Math.round(monthly))}</div><div class="kpi-sub">aus aktiven Dauermandaten</div></div>
      <div class="panel kpi"><div class="kpi-label">${icon('alert', 'ico-sm')}Fällig</div><div class="kpi-value">${list.filter(retainerIsDue).length}</div></div></div>` : ''}
    ${isBoard() && list.some(retainerIsDue) ? `<div class="banner banner-gold mb-4">${icon('clock')}<div><strong>${list.filter(retainerIsDue).length} Dauermandat${list.filter(retainerIsDue).length === 1 ? ' ist' : 'e sind'} fällig.</strong> Die Rechnungen entstehen automatisch – oder gleich: <button type="button" class="link-btn" data-action="ret-sweep">Alle fälligen jetzt abrechnen</button></div></div>` : ''}
    ${list.length ? `<div class="ret-list">${list.map(retainerCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Dauermandate.', 'receipt')}</div>`}`;
}

async function retainerForm(r) {
  const bill = await api.get('/api/billing').catch(() => null);
  const types = bill ? bill.types.filter((t) => t.active || (r && r.typeKey === t.key)) : [{ key: 'rechnung', name: 'Rechnung' }];
  await load.cases();
  const v = r || { title: '', clientName: '', clientContact: '', caseId: null, amount: '', intervalMonths: 1, startDate: dayKey(new Date()), endDate: '', typeKey: 'rechnung', note: '' };
  return `<h2 class="modal-title">${r ? `Dauermandat: ${esc(r.title)}` : 'Neues Dauermandat'}</h2>
    <form data-form="ret-save" ${r ? `data-id="${r.id}"` : ''} class="form-grid cols-2">
      <div class="span-2"><label class="label" for="rtTitle">Bezeichnung</label><input id="rtTitle" name="title" class="field" required minlength="3" maxlength="120" value="${esc(v.title)}" placeholder="z. B. Rechtsbeistand Burgershot" autofocus></div>
      <div><label class="label" for="rtClient">Empfänger / Mandant</label><input id="rtClient" name="clientName" class="field" required minlength="2" maxlength="120" value="${esc(v.clientName)}"></div>
      <div><label class="label" for="rtContact">Kontakt (optional)</label><input id="rtContact" name="clientContact" class="field" maxlength="120" value="${esc(v.clientContact)}"></div>
      <div class="span-2"><label class="label" for="rtCase">Akte (optional)</label><select id="rtCase" name="caseId" class="field"><option value="">Ohne Aktenbezug</option>${st.cases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === v.caseId)).join('')}</select><p class="form-hint">Mit Akte: Meldung im Ticket, Verlaufseintrag und Zuordnung zum Mandantenkonto.</p></div>
      <div><label class="label" for="rtAmount">Pauschale in $ je Zeitraum</label><input id="rtAmount" name="amount" type="number" min="1" step="1" required class="field" value="${esc(v.amount)}"></div>
      <div><label class="label" for="rtInterval">Takt</label><select id="rtInterval" name="intervalMonths" class="field" ${r && r.runs ? 'disabled' : ''}>${Object.entries(RETAINER_INTERVAL).map(([k, l]) => opt(k, l, Number(k) === v.intervalMonths)).join('')}</select></div>
      <div><label class="label" for="rtStart">Erste Rechnung am</label><input id="rtStart" name="startDate" type="date" required class="field" value="${esc(v.startDate)}" ${r && r.runs ? 'disabled' : ''}></div>
      <div><label class="label" for="rtEnd">Letzte Rechnung bis (optional)</label><input id="rtEnd" name="endDate" type="date" class="field" value="${esc(v.endDate || '')}"></div>
      <div class="span-2"><label class="label" for="rtType">Rechnungsart</label><select id="rtType" name="typeKey" class="field">${types.map((t) => opt(t.key, t.name, t.key === v.typeKey)).join('')}</select><p class="form-hint">Bestimmt Zahlungsziel und Standardtext (Einstellungen → Listen → Rechnungsarten).</p></div>
      <div class="span-2"><label class="label" for="rtNote">Anmerkung auf der Rechnung (optional)</label><textarea id="rtNote" name="note" rows="3" maxlength="1000" class="field">${esc(v.note)}</textarea></div>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${r ? 'Speichern' : 'Anlegen'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}

const retainerById = (id) => (st.retainers || []).find((r) => r.id === Number(id));
async function refreshRetainers() {
  await loadRetainers();
  renderView();
}

Object.assign(actions, {
  'inv-tab': async (el) => {
    st.invTab = ['dauer', 'freigaben'].includes(el.dataset.tab) ? el.dataset.tab : 'rechnungen';
    if (st.invTab === 'dauer') await loadRetainers();
    if (st.invTab === 'freigaben') await loadApprovals();
    renderView();
  },
  'ret-new': async () => openModal(await retainerForm(null), { wide: true }),
  'ret-edit': async (el) => openModal(await retainerForm(retainerById(el.dataset.id)), { wide: true }),
  'ret-status': async (el) => {
    const r = retainerById(el.dataset.id);
    const to = el.dataset.status;
    if (to === 'beendet' && !(await ask('Dauermandat beenden?', `„${r.title}“ erstellt danach keine Rechnungen mehr. Das lässt sich nicht rückgängig machen.`, 'Beenden'))) return;
    await api.post(`/api/retainers/${r.id}/status`, { status: to });
    toast(to === 'aktiv' ? 'Dauermandat läuft wieder.' : to === 'pausiert' ? 'Dauermandat pausiert.' : 'Dauermandat beendet.');
    await refreshRetainers();
  },
  'ret-run': async (el) => {
    const r = retainerById(el.dataset.id);
    const res = await api.post(`/api/retainers/${r.id}/run`, {});
    toast(`Rechnung ${res.number} erstellt.`);
    await refreshRetainers();
  },
  'ret-sweep': async () => {
    const res = await api.post('/api/retainers/sweep', {});
    toast(res.made ? `${nWord(res.made, 'Rechnung', 'Rechnungen')} erstellt.` : 'Es ist nichts fällig.');
    await refreshRetainers();
  },
  'ret-delete': async (el) => {
    if (!(await askDelete('Dauermandat löschen?', `„${el.dataset.title}“ wird gelöscht (es gibt noch keine Rechnungen dazu).`))) return;
    await api.del(`/api/retainers/${el.dataset.id}`);
    toast('Dauermandat gelöscht.');
    await refreshRetainers();
  },
  'ret-invoices': async (el) => {
    const { retainer: r, invoices } = await api.get(`/api/retainers/${el.dataset.id}`);
    openModal(`<h2 class="modal-title">${esc(r.title)}</h2><p class="modal-sub">${nWord(invoices.length, 'Rechnung', 'Rechnungen')} aus diesem Dauermandat</p>
      ${invoices.length ? `<div class="list-rows">${invoices.map((i) => `<div class="list-row wrap"><div class="main"><div class="title">${docTitleLink(`/rechnung?id=${i.id}`, esc(i.number), 'font-mono text-gold')} · ${esc(i.subject)}</div><div class="meta">${esc(fmtDate(i.createdAt))}${i.dueDate ? ` · fällig ${esc(fmtDateOnly(i.dueDate))}` : ''}</div></div><div class="flex items-center gap-2 shrink-0"><span class="font-mono text-gold nowrap">${money(i.total)}</span>${statusBadge(INVOICE_STATUS, i.status)}</div></div>`).join('')}</div>` : '<p class="text-sm text-dim">Noch keine Rechnung erstellt.</p>'}`);
  },
});

Object.assign(forms, {
  'ret-save': async (f) => {
    const fd = new FormData(f);
    const body = {
      title: val(fd, 'title'),
      clientName: val(fd, 'clientName'),
      clientContact: val(fd, 'clientContact'),
      caseId: val(fd, 'caseId') ? Number(val(fd, 'caseId')) : null,
      amount: Number(val(fd, 'amount')),
      intervalMonths: Number(val(fd, 'intervalMonths') || f.elements.intervalMonths.value || 1),
      startDate: val(fd, 'startDate') || f.elements.startDate.value,
      endDate: val(fd, 'endDate') || null,
      typeKey: val(fd, 'typeKey'),
      note: val(fd, 'note'),
    };
    if (f.dataset.id) await api.patch(`/api/retainers/${f.dataset.id}`, body);
    else await api.post('/api/retainers', body);
    toast(f.dataset.id ? 'Dauermandat gespeichert.' : 'Dauermandat angelegt.');
    await modalBack();
    await refreshRetainers();
  },
});
