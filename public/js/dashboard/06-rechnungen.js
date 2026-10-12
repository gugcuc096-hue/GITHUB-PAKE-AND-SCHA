/*
 * Kanzlei-Dashboard – Teil 6 von 12: Rechnungen, Rechnungs-/Honorar-Generator und Mandantenkartei.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Rechnungen */
/**
 * Zahlung melden: Der Mandant meldet „bezahlt“ (optional mit Screenshot), die Kanzlei bestätigt den Eingang
 * oder weist die Meldung zurück. Knöpfe für Rechnungsliste und Akte.
 */
function paymentButtons(i) {
  if (i.status !== 'offen') return '';
  if (!isStaff()) {
    if (!i.paymentReport) return `<button class="btn-gold btn-sm" data-action="inv-pay-report" data-id="${i.id}">${icon('check', 'ico-sm')}<span>Als bezahlt melden</span></button>`;
    return i.paymentReport.proof
      ? ''
      : `<label class="btn-ghost btn-sm file-btn" title="Screenshot der Überweisung nachreichen">${icon('camera', 'ico-sm')}<span>Screenshot nachreichen</span><input type="file" accept="image/*" data-upload="pay-proof" data-id="${i.id}" aria-label="Screenshot der Überweisung hochladen"></label>`;
  }
  if (!i.paymentReport) return '';
  return `${i.paymentReport.proof ? `<a class="btn-outline btn-sm" href="/api/invoices/${i.id}/payment-proof" target="_blank" rel="noopener">${icon('eye', 'ico-sm')}<span>Nachweis</span></a>` : ''}<button class="btn-gold btn-sm" data-action="inv-status" data-id="${i.id}" data-status="bezahlt" data-reported="1">${icon('check', 'ico-sm')}<span>Eingang bestätigen</span></button><button class="btn-ghost btn-sm" data-action="inv-pay-reject" data-id="${i.id}" data-number="${esc(i.number)}">Nicht eingegangen</button>`;
}

/** Nach einer Änderung an einer Rechnung: Akte (falls die Rechnung dort angeklickt wurde) bzw. Ansicht und Badge neu laden. */
async function afterInvoiceChange(el) {
  load.paymentReports().then(renderNav).catch(() => {});
  if (el && el.closest('#modalBody') && st.modalCaseId) await reloadCase(st.modalCaseId);
  else await refreshBehind();
}

/** Mandant: Zahlung melden – mit den Zahlungsangaben der Kanzlei, Hinweis und optional Screenshot. */
async function paymentReportModal(id) {
  const { invoice: i, firm } = await api.get('/api/invoices/' + id);
  openModal(`
      <h2 class="modal-title">Zahlung melden</h2>
      <p class="modal-sub">${esc(INVOICE_KIND[i.kind])} <span class="font-mono text-gold">${esc(i.number)}</span> über <strong>${money(i.total)}</strong>${i.dueDate ? ` · fällig ${esc(fmtDateOnly(i.dueDate))}` : ''}. Sobald die Kanzlei den Eingang geprüft hat, steht die Rechnung auf „Bezahlt“.</p>
      <div class="pay-info">${icon('receipt', 'ico-sm')}<div><div class="label">Zahlungsangaben der Kanzlei</div><div class="text-sm pre-line">${esc(firm.paymentInfo)}</div></div></div>
      <form data-form="inv-pay-report" data-id="${i.id}" class="form-grid">
        <div><label class="label" for="payNote">Hinweis an die Kanzlei <span class="text-dim">(optional)</span></label>
          <textarea id="payNote" name="note" class="field" rows="3" maxlength="500" placeholder="z. B. wann und von welchem Konto Sie überwiesen haben"></textarea></div>
        <div><span class="label">Screenshot der Überweisung <span class="text-dim">(optional)</span></span>
          <label class="btn-outline btn-sm file-btn">${icon('camera', 'ico-sm')}<span id="payProofName">Bild auswählen</span><input type="file" name="proof" accept="image/*" aria-label="Screenshot der Überweisung auswählen"></label>
          <p class="form-hint">Den Screenshot sieht nur die Kanzlei.</p></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Zahlung melden</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`);
}

/** Kanzlei: gemeldete Zahlung ist nicht eingegangen – optional mit Hinweis an den Mandanten (Ticket). */
function paymentRejectModal(id, number) {
  openModal(`
      <h2 class="modal-title">Zahlung nicht eingegangen?</h2>
      <p class="modal-sub">Die Meldung zu <span class="font-mono text-gold">${esc(number)}</span> wird zurückgesetzt – die Rechnung bleibt offen. Der Mandant erfährt es in der Akte und über Discord (Ticket bzw. Direktnachricht) und kann die Zahlung erneut melden.</p>
      <form data-form="inv-pay-reject" data-id="${id}" class="form-grid">
        <div><label class="label" for="payReason">Hinweis an den Mandanten <span class="text-dim">(optional)</span></label>
          <textarea id="payReason" name="reason" class="field" rows="3" maxlength="300" placeholder="z. B. Betrag unvollständig oder kein Eingang auf dem Kanzleikonto"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn-danger btn-md">Meldung zurückweisen</button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`);
}

function invoiceTable(rows) {
  const staff = isStaff();
  if (!rows.length) return empty(st.invoices.length ? 'Keine Dokumente für diese Auswahl.' : staff ? 'Noch keine Rechnungen erstellt.' : 'Es liegen keine Rechnungen vor.', 'receipt');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Dokument</th><th>Empfänger</th><th>Akte</th><th style="text-align:right">Betrag</th><th>Status</th><th>Datum</th><th></th></tr></thead>
      <tbody>${rows
      .map(
        (i) => `<tr>
          <td class="td-main"><div class="font-mono text-gold text-sm nowrap">${docTitleLink(`/invoice.html?id=${i.id}`, esc(i.number))}</div><div class="text-xs text-dim">${esc(INVOICE_KIND[i.kind])}${i.subject ? ' · ' + esc(i.subject) : ''}</div></td>
          <td data-label="Empfänger">${staff && i.clientKey ? clientLink(i.clientKey, i.clientName) : esc(i.clientName)}</td>
          <td data-label="Akte">${i.caseNumber ? `<button class="text-gold font-mono text-xs hover:underline" data-action="open-case" data-id="${i.caseId}">${esc(i.caseNumber)}</button>` : '—'}</td>
          <td data-label="Betrag" class="font-mono nowrap" style="text-align:right">${money(i.total)}</td>
          <td data-label="Status">${invoiceBadge(i, true)}${staff && paymentReported(i) && i.paymentReport.note ? `<div class="text-xs text-dim pay-note">„${esc(i.paymentReport.note)}“</div>` : ''}</td>
          <td data-label="Datum" class="text-xs text-dim nowrap"><div>${esc(fmtDate(i.createdAt))}${i.dueDate && i.status === 'offen' ? `<div${i.overdueDays > 0 ? ` class="text-red-300" title="${esc(overdueText(i))}"` : ''}>fällig ${esc(fmtDateOnly(i.dueDate))}</div>` : ''}</div></td>
          <td class="td-actions inv-actions">
            ${staff && safeGdoc(i.googleDoc) ? gdocBtn(safeGdoc(i.googleDoc)) : docViewBtn(`/invoice.html?id=${i.id}`)}
            ${
              // Zahlungserinnerung als normaler kleiner Knopf bei den Aktionen (stand früher klein unter dem Datum)
              staff && i.status === 'offen'
                ? `<button type="button" class="btn-ghost btn-sm" data-action="inv-remind" data-id="${i.id}" data-number="${esc(i.number)}" title="${esc(
                    i.remindedAt
                      ? `${i.reminderCount === 1 ? '1 Erinnerung' : `${i.reminderCount} Erinnerungen`}, zuletzt ${fmtDate(i.remindedAt)} – klicken, um erneut zu erinnern (Discord-DM und Ticket)`
                      : 'Zahlungserinnerung an den Mandanten senden (Discord-DM und Ticket)'
                  )}">${icon('bell', 'ico-sm')}<span>${i.remindedAt ? `erinnert ${esc(new Date(i.remindedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }))}` : 'Erinnern'}</span></button>`
                : ''
            }
            ${paymentButtons(i)}
            ${staff && i.status === 'offen' && !paymentReported(i) ? `<button class="btn-gold btn-sm" data-action="inv-status" data-id="${i.id}" data-status="bezahlt">Bezahlt</button><button class="btn-ghost btn-sm" data-action="inv-status" data-id="${i.id}" data-status="storniert">Storno</button>` : ''}
            ${staff && i.status !== 'offen' ? `<button class="btn-ghost btn-sm" data-action="inv-status" data-id="${i.id}" data-status="offen">Wieder offen</button>` : ''}
            ${isAdmin() ? `<button class="icon-btn sm" data-action="inv-delete" data-id="${i.id}" data-number="${esc(i.number)}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>` : ''}
          </td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

views.invoices = {
  async load() {
    await load.invoices();
  },
  render() {
    const staff = isStaff();
    // Filter ohne Treffer mehr (z. B. letzte gemeldete Zahlung bestätigt): wieder alle zeigen
    const gone = (st.invFilter === 'gemeldet' && !st.invoices.some(paymentReported)) || (st.invFilter === 'ueberfaellig' && !st.invoices.some((i) => i.overdueDays > 0));
    const f = gone ? 'alle' : st.invFilter;
    const match = (i, s) => s === 'alle' || (s === 'ueberfaellig' ? i.overdueDays > 0 : s === 'gemeldet' ? paymentReported(i) : i.status === s);
    const rows = st.invoices.filter((i) => match(i, f));
    const sum = (s) => st.invoices.filter((i) => match(i, s)).reduce((a, i) => a + i.total, 0);
    const count = (s) => st.invoices.filter((i) => match(i, s)).length;
    return `
        <div class="page-head">
          <div><h1 class="page-title">${staff ? 'Rechnungen & Honorare' : 'Meine Rechnungen'}</h1>
            <p class="page-sub">${staff ? 'Offizielle Rechnungen und Honorarvereinbarungen – als PDF speichern oder drucken.' : 'Rechnungen und Honorarvereinbarungen zu Ihren Mandaten.'}</p></div>
          ${staff ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="new-invoice">${icon('plus')}<span>Neues Dokument</span></button></div>` : ''}
        </div>
        ${staff ? `<div class="kpi-grid kpi-grid-3">
          <div class="panel kpi"><div class="kpi-label">${icon('clock', 'ico-sm')}Offene Forderungen</div><div class="kpi-value">${money(sum('offen'))}</div><div class="kpi-sub">${count('offen')} offen</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('alert', 'ico-sm')}Überfällig</div><div class="kpi-value">${money(sum('ueberfaellig'))}</div><div class="kpi-sub">${count('ueberfaellig')} überfällig</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('check', 'ico-sm')}Bezahlt</div><div class="kpi-value">${money(sum('bezahlt'))}</div><div class="kpi-sub">${count('bezahlt')} Dokument(e)</div></div>
        </div>` : ''}
        <div class="chip-row mb-4">${[['alle', 'Alle'], ['offen', 'Offen'], ...(count('gemeldet') ? [['gemeldet', staff ? 'Zahlung gemeldet' : 'Gemeldet']] : []), ...(count('ueberfaellig') ? [['ueberfaellig', 'Überfällig']] : []), ['bezahlt', 'Bezahlt'], ['storniert', 'Storniert']]
        .map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-action="inv-filter" data-value="${k}">${l} <span class="chip-count">${count(k)}</span></button>`)
        .join('')}</div>
        <div class="panel p-2 md:p-3">${invoiceTable(rows)}</div>`;
  },
};

/* ---------------------------------------------------------------- Rechnungs-/Honorar-Generator */
function newDraft(caseId = null) {
  const d = {
    kind: 'rechnung',
    caseId,
    clientName: '',
    clientContact: '',
    subject: '',
    items: [],
    discountPct: 0,
    surchargePct: 0,
    coopId: null, // Kooperation (Rabatt-Satz kommt aus der Kooperation)
    coopAuto: false, // automatisch aus der Erkennung gesetzt
    memberId: null, // VIP / Lifetime (Rabatt-Satz kommt aus der Mitgliedschaft)
    dueDate: dayKey(new Date(Date.now() + 7 * 864e5)),
    notes: '',
  };
  applyCaseToDraft(d, caseId, true);
  return d;
}
function applyCaseToDraft(d, caseId, force = false) {
  const c = caseId ? st.cases.find((x) => x.id === caseId) : null;
  // VIP / Lifetime des Mandanten automatisch übernehmen (änderbar)
  if (c && c.membership) d.memberId = c.membership.id;
  else if (force || c) d.memberId = null;
  if (!c) return;
  if (force || !d.clientName) d.clientName = c.clientName === '—' ? '' : c.clientName;
  if (force || !d.clientContact) d.clientContact = c.clientPhone || c.clientEmail || '';
  if (force || !d.subject) d.subject = `Mandat ${c.caseNumber} – ${c.title}`.slice(0, 200);
}
function clampPct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}
const draftCoop = (d) => (d.coopId ? (st.coopList || []).find((k) => k.id === d.coopId && k.valid) || null : null);
const draftMember = (d) => (d.memberId ? (st.memberList || []).find((m) => m.id === d.memberId) || null : null);
/** Wie auf dem Server: Kooperationsrabatt und Rabatt auf die Zwischensumme, danach der Zuschlag. */
function draftTotals(d) {
  const subtotal = d.items.reduce((s, it) => s + (Math.max(1, Math.round(Number(it.quantity) || 1))) * Math.max(0, Math.round(Number(it.unitPrice) || 0)), 0);
  let k = draftCoop(d);
  let m = draftMember(d);
  // VIP/Lifetime und Kooperation werden nicht addiert – es gilt der höhere Rabatt (wie auf dem Server)
  const coopDropped = !!(k && m && m.discountPct >= k.discountPct);
  if (k && m) {
    if (coopDropped) k = null;
    else m = null;
  }
  const cp = k ? k.discountPct : 0;
  const mp = m ? m.discountPct : 0;
  const dp = clampPct(d.discountPct);
  const sp = clampPct(d.surchargePct);
  let rest = subtotal;
  const take = (pct) => {
    const amount = Math.min(rest, Math.round((subtotal * pct) / 100));
    rest -= amount;
    return amount;
  };
  const member = take(mp);
  const coop = take(cp);
  const discount = take(dp);
  const surcharge = Math.round((rest * sp) / 100);
  return { subtotal, member, memberName: m ? m.name : '', mp, coop, coopName: k ? k.name : '', cp, coopDropped, discount, surcharge, total: rest + surcharge, dp, sp };
}
function itemRowHtml(it, i) {
  return `<div class="item-row">
      <input class="field item-desc" data-item="description" data-index="${i}" value="${esc(it.description)}" placeholder="Leistung / Beschreibung" maxlength="200" aria-label="Leistung">
      <input class="field item-qty" data-item="quantity" data-index="${i}" type="number" inputmode="numeric" min="1" max="999" step="1" value="${esc(it.quantity)}" aria-label="Menge">
      <input class="field item-price" data-item="unitPrice" data-index="${i}" type="number" inputmode="numeric" min="0" step="1" value="${esc(it.unitPrice)}" aria-label="Einzelpreis in Dollar">
      <div class="item-total" data-item-total="${i}">${money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</div>
      <button type="button" class="icon-btn sm item-remove" data-action="inv-remove-item" data-index="${i}" aria-label="Position entfernen">${icon('x', 'ico-sm')}</button></div>`;
}
function invoiceItemsHtml(d) {
  return d.items.length ? d.items.map(itemRowHtml).join('') : '<p class="text-sm text-dim py-4">Noch keine Positionen – Leistungen oben anhaken oder eine freie Position erfassen.</p>';
}
/** Leistung an-/abgehakt: Position hinzufügen bzw. entfernen (ohne die Seite neu aufzubauen). */
function toggleInvoiceFee(id, on) {
  const d = st.draft;
  const fee = st.fees.find((f) => f.id === id);
  const qty = $(`.inv-fee-qty[data-fee="${id}"]`);
  if (on && fee && !d.items.some((it) => it.feeId === id)) {
    d.items.push({ feeId: id, description: fee.name, quantity: Math.max(1, Math.round(Number(qty?.value) || 1)), unitPrice: fee.price });
  } else if (!on) {
    d.items = d.items.filter((it) => it.feeId !== id);
  }
  if (qty) qty.disabled = !on;
  $('#invItems').innerHTML = invoiceItemsHtml(d);
  updateInvoiceSummary();
}
function filterInvoiceFees(q) {
  const needle = q.trim().toLowerCase();
  let header = null;
  let headerHasHit = false;
  let hits = 0;
  // style.display statt Klasse: .svc setzt selbst display:grid
  const close = () => header && (header.style.display = headerHasHit ? '' : 'none');
  for (const el of $$('#feeList > *')) {
    if (el.hasAttribute('data-fee-cat')) {
      close();
      header = el;
      headerHasHit = false;
    } else if (el.dataset.feeName !== undefined) {
      const hit = !needle || el.dataset.feeName.includes(needle);
      el.style.display = hit ? '' : 'none';
      if (hit) {
        headerHasHit = true;
        hits += 1;
      }
    }
  }
  close();
  $('#feeNone')?.classList.toggle('hidden', hits > 0);
}

/* ---------------------------------------------------------------- Rechnung aus dem Mandatsvertrag */
/**
 * Vertrag der gewählten Akte holen (Leistungen, Summe laut Vertrag, schon erstellte Rechnungen). auto: Positionen gleich
 * übernehmen, wenn noch keine da sind und für die Akte noch nichts abgerechnet wurde. Liefert true, wenn übernommen.
 */
async function loadContractBilling(d, auto = false) {
  const caseId = d.caseId;
  if (!caseId) {
    d.billing = null;
    return false;
  }
  if (d.billing && d.billing.caseId === caseId) return false;
  let r;
  try {
    r = await api.get(`/api/cases/${caseId}/contracts/billing`);
  } catch {
    r = { contract: null, items: [], invoices: [] };
  }
  if (st.draft !== d || d.caseId !== caseId) return false;
  d.billing = { caseId, ...r };
  if (auto && r.contract && !d.items.length && !r.invoices.length) {
    applyContractItems(d);
    return true;
  }
  return false;
}
/** Leistungen des Vertrags als Positionen (zum regulären Preis; passende Leistungen der Honorarordnung sind angehakt). */
function applyContractItems(d) {
  const b = d.billing;
  if (!b || !b.contract || !b.items.length) return;
  const feeByName = new Map(st.fees.map((f) => [f.name.trim().toLowerCase(), f]));
  d.items = b.items.map((it) => {
    const fee = feeByName.get(it.description.trim().toLowerCase());
    return fee ? { feeId: fee.id, ...it } : { ...it };
  });
  if (!d.notes) d.notes = `Abrechnung gemäß ${b.contract.templateName}${b.contract.date ? ` vom ${b.contract.date}` : ''}.`;
  d.fromContract = b.contract.id;
}
function contractStripHtml(d) {
  const b = d.billing;
  if (!b || !b.contract) return '';
  const k = b.contract;
  const applied = d.fromContract === k.id;
  const state = { unterschrieben: 'unterschrieben', teilweise: 'teilweise unterschrieben' }[k.status] || 'Entwurf';
  const billed = b.invoices.length
    ? `<span class="ts-label">· bereits erstellt: ${b.invoices.map((i) => `<span class="font-mono">${esc(i.number)}</span> (${esc(money(i.total))})`).join(', ')}</span>`
    : '';
  return `<div class="ticket-strips">${ticketStrip({
    title: applied ? 'Aus dem Vertrag übernommen' : 'Vertrag vorhanden',
    ico: icon('doc'),
    tone: 'gold',
    badges: `<span class="ts-label">${esc(k.templateName)} · ${state} · laut Vertrag ${esc(money(k.total))}${k.discount ? ` (${esc(k.discount)})` : ''}</span>${billed}`,
    actions: applied ? '' : `<button type="button" class="btn-outline btn-sm" data-action="inv-from-contract">${icon('plus', 'ico-sm')}<span>Leistungen übernehmen</span></button>`,
    hint: [
      applied ? 'Regulärer Preis je Leistung – VIP/Lifetime und Kooperation werden unten wie bei jeder Rechnung abgezogen.' : '',
      k.extraFee ? `Zusatzgebühr laut Vertrag: ${esc(k.extraFee)} – bei Bedarf als freie Position ergänzen.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  })}</div>`;
}
/** Summenbox: Betrag laut Vertrag – mit Hinweis, wenn die Rechnung davon abweicht (Rundung je Position zählt nicht). */
function contractCompareHtml(d, t) {
  const k = d.billing && d.billing.contract;
  if (!k || d.fromContract !== k.id) return '';
  const tolerance = Math.max(1, d.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0));
  const off = Math.abs(t.total - k.total) > tolerance;
  return `<div class="sum-row mt-2"><span class="text-muted">Laut Vertrag</span><span class="v">${money(k.total)}</span></div>
      ${off ? `<p class="form-hint" style="color:#fcd34d">${icon('alert', 'ico-sm')} Weicht vom Vertrag ab – z. B. weil Positionen geändert wurden oder VIP/Kooperation nicht mehr gilt.</p>` : ''}`;
}

/** Nur die Zahlen der Summenbox – wird beim Tippen aktualisiert, der Button bleibt stehen. */
function summaryFiguresHtml() {
  const d = st.draft;
  const t = draftTotals(d);
  return `
      <h2 class="panel-title mb-3">${esc(INVOICE_KIND[d.kind])}</h2>
      <div class="sum-row"><span class="text-muted">Positionen</span><span class="v">${d.items.length}</span></div>
      <div class="sum-row"><span class="text-muted">Zwischensumme</span><span class="v">${money(t.subtotal)}</span></div>
      ${t.mp ? `<div class="sum-row" style="color:#fcd34d"><span>${esc(t.memberName)} (${fmtPct(t.mp)} %)</span><span class="v">− ${money(t.member)}</span></div>` : ''}
      ${t.cp ? `<div class="sum-row" style="color:#6ee7b7"><span>Kooperation ${esc(t.coopName)} (${fmtPct(t.cp)} %)</span><span class="v">− ${money(t.coop)}</span></div>` : ''}
      ${t.dp ? `<div class="sum-row" style="color:#6ee7b7"><span>Rabatt (${fmtPct(t.dp)} %)</span><span class="v">− ${money(t.discount)}</span></div>` : ''}
      ${t.sp ? `<div class="sum-row" style="color:#fcd34d"><span>Zuschlag (${fmtPct(t.sp)} %)</span><span class="v">+ ${money(t.surcharge)}</span></div>` : ''}
      <div class="sum-row sum-total"><span class="font-semibold">Gesamtbetrag</span><span class="v">${money(t.total)}</span></div>
      ${t.mp && !t.total ? `<p class="form-hint">Vollständig abgedeckt – die Rechnung dokumentiert den Wert der Arbeit (${money(t.subtotal)}) und gilt sofort als bezahlt.</p>` : ''}
      ${t.coopDropped ? '<p class="form-hint">Kooperationsrabatt entfällt – der VIP-/Lifetime-Rabatt ist höher (Rabatte werden nicht addiert).</p>' : ''}
      ${contractCompareHtml(d, t)}`;
}
function summaryHtml() {
  return `
      <div id="invSumFigures">${summaryFiguresHtml()}</div>
      <p class="form-hint mb-4">Nach dem Erstellen öffnet sich die Druckansicht – dort „Als PDF speichern“ wählen.</p>
      <button type="submit" class="btn-gold btn-lg btn-block">${icon('check')}<span>Dokument erstellen</span></button>
      ${st.invoiceFrom ? `<button type="button" class="btn-ghost btn-md btn-block mt-2" data-action="inv-back">Abbrechen</button>` : '<a href="#invoices" class="btn-ghost btn-md btn-block mt-2">Abbrechen</a>'}`;
}
function updateInvoiceSummary() {
  // Nicht die ganze Box ersetzen: Verlässt man ein Feld per Klick auf „Dokument erstellen“, würde der
  // Button sonst während des Klicks ausgetauscht und der Klick ginge verloren.
  const box = $('#invSumFigures');
  if (box) box.innerHTML = summaryFiguresHtml();
  st.draft.items.forEach((it, i) => {
    const el = $(`[data-item-total="${i}"]`);
    if (el) el.textContent = money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0));
  });
}

/** Kooperation im Rechnungsformular: Auswahl + Ergebnis der Erkennung (Discord-Rolle / zugeordnetes Konto). */
function coopBoxHtml() {
  const d = st.draft;
  const list = (st.coopList || []).filter((k) => k.valid || k.id === d.coopId);
  if (!list.length) return '';
  const det = st.coopDetect && st.coopDetect.draft === d && st.coopDetect.caseId === d.caseId ? st.coopDetect : null;
  let info = '';
  if (!d.caseId) info = '<div class="form-hint">Mit Aktenbezug prüft die Kanzlei automatisch, ob der Mandant zu einer Kooperation gehört (Discord-Rolle).</div>';
  else if (!det || det.loading) info = `<div class="form-hint">${icon('clock', 'ico-sm')} Discord-Rollen des Mandanten werden geprüft …</div>`;
  else {
    info = det.matches.length
      ? det.matches.map((m, i) => `<div class="text-sm mt-2" style="color:#6ee7b7">🤝 ${i === 0 ? 'Erkannt' : 'Ebenfalls'}: <strong>${esc(m.name)}</strong> · ${fmtPct(m.discountPct)} % <span class="text-dim">(${esc(m.detail)})</span></div>`).join('')
      : `<div class="form-hint">${det.checkedDiscord ? 'Keine Kooperation erkannt – der Mandant hat keine der Kooperations-Rollen.' : 'Keine Kooperation erkannt.'}</div>`;
    if (det.notes && det.notes.length) info += `<div class="form-hint">${det.notes.map(esc).join('<br>')}</div>`;
  }
  return `<div class="span-2"><label class="label">Kooperation</label>
      <select name="cooperationId" class="field"><option value="">Keine Kooperation</option>${list.map((k) => opt(k.id, `${k.name} – ${fmtPct(k.discountPct)} % Rabatt${k.valid ? '' : ' (nicht mehr aktiv)'}`, k.id === d.coopId)).join('')}</select>
      ${info}</div>`;
}
/** VIP / Lifetime im Rechnungsformular. */
function memberBoxHtml() {
  const d = st.draft;
  const list = st.memberList || [];
  if (!list.length) return '';
  const m = draftMember(d);
  const info = m
    ? `<div class="text-sm mt-2" style="color:#fcd34d">${m.kind === 'perma' ? '👑' : '⭐'} <strong>${esc(m.clientName)}</strong> hat <strong>${esc(m.name)}</strong> · ${fmtPct(m.discountPct)} % ${m.discountPct >= 100 ? '– Leistungen vollständig abgedeckt' : 'Rabatt'}${m.expiresAt ? ` <span class="text-dim">(bis ${esc(fmtDateOnly(String(m.expiresAt).slice(0, 10)))})</span>` : ''}</div>`
    : '<div class="form-hint">Hat der Mandant VIP oder Lifetime, wird das mit Aktenbezug automatisch gewählt.</div>';
  return `<div class="span-2"><label class="label">VIP / Lifetime</label>
      <select name="membershipId" class="field"><option value="">Keins</option>${list.map((x) => opt(x.id, `${x.clientName} – ${x.name} (${fmtPct(x.discountPct)} %)`, x.id === d.memberId)).join('')}</select>${info}</div>`;
}
function refreshMemberBox() {
  const box = $('#invMember');
  if (box) box.innerHTML = memberBoxHtml();
}

function refreshCoopBox() {
  const box = $('#invCoop');
  if (box) box.innerHTML = coopBoxHtml();
}
/** Gehört der Mandant der gewählten Akte zu einer Kooperation? Setzt den Rabatt automatisch (änderbar). */
async function runCoopDetect() {
  const d = st.draft;
  if (!d || !(st.coopList || []).some((k) => k.valid)) return;
  const caseId = d.caseId;
  if (!caseId || (st.coopDetect && st.coopDetect.draft === d && st.coopDetect.caseId === caseId)) return refreshCoopBox();
  st.coopDetect = { caseId, draft: d, loading: true };
  refreshCoopBox();
  let r;
  try {
    r = await api.get('/api/cooperations/detect?caseId=' + caseId);
  } catch (e) {
    r = { matches: [], notes: [e.message], checkedDiscord: false };
  }
  if (st.draft !== d || d.caseId !== caseId) return;
  st.coopDetect = { caseId, draft: d, ...r };
  if (r.matches.length && (!d.coopId || d.coopAuto)) {
    d.coopId = r.matches[0].id;
    d.coopAuto = true;
    toast(`Kooperation ${r.matches[0].name} erkannt – ${fmtPct(r.matches[0].discountPct)} % Rabatt übernommen.`);
  }
  refreshCoopBox();
  updateInvoiceSummary();
}

views['invoice-new'] = {
  async load() {
    const [coops, members] = await Promise.all([
      api.get('/api/cooperations?basic=1').catch(() => ({ cooperations: [] })),
      api.get('/api/memberships/active').catch(() => ({ memberships: [] })),
      load.fees(),
      load.cases(),
    ]);
    st.coopList = coops.cooperations;
    st.memberList = members.memberships;
    if (!st.draft) st.draft = newDraft();
    else if (st.draft.caseId && st.draft.memberId == null) applyCaseToDraft(st.draft, st.draft.caseId);
    await loadContractBilling(st.draft, true);
    runCoopDetect(); // läuft im Hintergrund, die Seite wartet nicht auf Discord
  },
  render() {
    const d = st.draft;
    // Leistungen aus der Honorarordnung zum Abhaken – angehakte stehen sofort als Position in der Rechnung
    const picked = new Map(d.items.filter((it) => it.feeId).map((it) => [it.feeId, it]));
    const feeList = Object.entries(FEE_CATEGORIES)
      .map(([cat, label]) => {
        const list = st.fees.filter((f) => f.category === cat);
        if (!list.length) return '';
        return `<div class="svc-cat" data-fee-cat>${esc(label)}</div>${list
          .map((f) => {
            const it = picked.get(f.id);
            return `<label class="svc" data-fee-name="${esc(f.name.toLowerCase())}"><input type="checkbox" class="inv-fee" data-fee="${f.id}" ${it ? 'checked' : ''}>
                <span class="svc-name">${esc(f.name)}</span>
                <input type="number" class="field inv-fee-qty" data-fee="${f.id}" min="1" max="999" inputmode="numeric" value="${it ? esc(it.quantity) : 1}" aria-label="Menge ${esc(f.name)}" ${it ? '' : 'disabled'}>
                <span class="svc-price">${esc(money(f.price))}</span></label>`;
          })
          .join('')}`;
      })
      .join('');
    const hv = d.kind === 'honorarvereinbarung';
    return `
        <div class="page-head">
          <div>${
            st.invoiceFrom
              ? `<button type="button" class="text-sm text-dim hover:text-white inline-flex items-center gap-1" data-action="inv-back">${icon('chevronLeft', 'ico-sm')}Akte ${esc(st.invoiceFrom.caseNumber)}</button>`
              : `<a href="#invoices" class="text-sm text-dim hover:text-white inline-flex items-center gap-1">${icon('chevronLeft', 'ico-sm')}Rechnungen</a>`
          }
            <h1 class="page-title mt-1">Rechnung / Honorar erstellen</h1>
            <p class="page-sub">Positionen aus der Honorarordnung übernehmen oder frei erfassen – Summen werden live berechnet.</p></div>
        </div>
        <form id="invoiceForm" data-form="invoice" class="inv-layout" novalidate>
          <div class="stack">
            <section class="panel panel-pad">
              <div class="seg mb-4">
                <label class="seg-opt"><input type="radio" name="kind" value="rechnung" ${!hv ? 'checked' : ''}><span>${icon('receipt', 'ico-sm')}Rechnung</span></label>
                <label class="seg-opt"><input type="radio" name="kind" value="honorarvereinbarung" ${hv ? 'checked' : ''}><span>${icon('scale', 'ico-sm')}Honorarvereinbarung</span></label>
              </div>
              <div class="form-grid cols-2">
                <div class="span-2"><label class="label">Akte (optional)</label><select name="caseId" class="field"><option value="">Ohne Aktenbezug</option>${st.cases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === d.caseId)).join('')}</select></div>
                <div><label class="label">Empfänger / Mandant</label><input name="clientName" class="field" required maxlength="120" value="${esc(d.clientName)}" placeholder="Name des Mandanten"></div>
                <div><label class="label">Kontakt (Telefon / E-Mail)</label><input name="clientContact" class="field" maxlength="120" value="${esc(d.clientContact)}" placeholder="optional"></div>
                <div class="span-2"><label class="label">Betreff / Leistungsgegenstand</label><input name="subject" class="field" maxlength="200" value="${esc(d.subject)}" placeholder="z. B. Strafverteidigung – Verfahren wegen …"></div>
              </div>
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Leistungen</h2><button type="button" class="btn-ghost btn-sm" data-action="inv-add-item">${icon('edit', 'ico-sm')}<span>Freie Position</span></button></div>
              <div id="invContract">${contractStripHtml(d)}</div>
              ${feeList
              ? `<div class="label">Aus der Honorarordnung <span class="text-dim font-normal normal-case tracking-normal">– einfach anhaken, mehrere möglich; Menge rechts</span></div>
                   <input id="feeFilter" type="search" class="field mt-1" placeholder="Leistung suchen …" aria-label="Leistungen durchsuchen" autocomplete="off">
                   <div class="svc-list" id="feeList">${feeList}<p class="text-sm text-dim py-2 hidden" id="feeNone">Keine Leistung gefunden.</p></div>`
              : '<p class="text-sm text-dim">Die Honorarordnung ist leer – Positionen über „Freie Position“ erfassen.</p>'}
              <h3 class="section-title mt-5">Positionen</h3>
              <div class="item-head"><span>Leistung</span><span>Menge</span><span>Einzelpreis ($)</span><span style="text-align:right">Summe</span><span></span></div>
              <div id="invItems">${invoiceItemsHtml(d)}</div>
            </section>
            <section class="panel panel-pad">
              <div class="form-grid cols-2">
                <div class="span-2" id="invMember" style="display:contents">${memberBoxHtml()}</div>
                <div class="span-2" id="invCoop" style="display:contents">${coopBoxHtml()}</div>
                <div><label class="label">Rabatt in %</label><input name="discountPct" type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field" value="${esc(d.discountPct)}">
                  <div class="chip-row mt-2"><button type="button" class="chip" data-action="inv-preset" data-field="discountPct" data-value="10">Mandatsbündel 10 %</button><button type="button" class="chip" data-action="inv-preset" data-field="discountPct" data-value="0">Kein Rabatt</button></div></div>
                <div><label class="label">Zuschlag in %</label><input name="surchargePct" type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field" value="${esc(d.surchargePct)}">
                  <div class="chip-row mt-2"><button type="button" class="chip" data-action="inv-preset" data-field="surchargePct" data-value="15">Priorisiert +15 %</button><button type="button" class="chip" data-action="inv-preset" data-field="surchargePct" data-value="0">Kein Zuschlag</button></div></div>
                <div><label class="label">Zahlbar bis</label><input name="dueDate" type="date" class="field" value="${esc(d.dueDate || '')}"></div>
                <div class="span-2"><label class="label">${hv ? 'Vereinbarungstext / Bedingungen' : 'Anmerkungen'}</label>
                  <textarea name="notes" rows="4" class="field" maxlength="3000" placeholder="${hv ? 'z. B. Die Vergütung ist als Vorschuss vor Aufnahme der Tätigkeit fällig. Zusätzliche Termine werden gesondert berechnet.' : 'z. B. Vielen Dank für Ihr Vertrauen.'}">${esc(d.notes)}</textarea></div>
              </div>
            </section>
          </div>
          <aside id="invSummary" class="panel panel-pad inv-summary">${summaryHtml()}</aside>
        </form>`;
  },
};

function onInvoiceInput(t) {
  const d = st.draft;
  if (!d) return;
  if (t.id === 'feeFilter') return filterInvoiceFees(t.value);
  if (t.classList.contains('inv-fee-qty')) {
    // Menge in der Liste geändert → Position mitziehen
    const i = d.items.findIndex((it) => it.feeId === Number(t.dataset.fee));
    if (i < 0 || t.value === '') return;
    d.items[i].quantity = Math.min(999, Math.max(1, Math.round(Number(t.value) || 1)));
    const row = $(`[data-item="quantity"][data-index="${i}"]`);
    if (row) row.value = d.items[i].quantity;
    return updateInvoiceSummary();
  }
  if (t.dataset.item) {
    const it = d.items[Number(t.dataset.index)];
    if (!it) return;
    it[t.dataset.item] = t.dataset.item === 'description' ? t.value : t.value === '' ? '' : Number(t.value);
    // Menge in der Position geändert → Liste oben mitziehen
    if (it.feeId && t.dataset.item === 'quantity') {
      const q = $(`.inv-fee-qty[data-fee="${it.feeId}"]`);
      if (q && t.value !== '') q.value = t.value;
    }
  } else if (['clientName', 'clientContact', 'subject', 'notes', 'dueDate'].includes(t.name)) {
    d[t.name] = t.value;
  } else if (t.name === 'discountPct' || t.name === 'surchargePct') {
    d[t.name] = t.value === '' ? 0 : Number(t.value);
  }
  updateInvoiceSummary();
}
function onInvoiceChange(t) {
  const d = st.draft;
  if (!d) return;
  if (t.classList.contains('inv-fee')) return toggleInvoiceFee(Number(t.dataset.fee), t.checked);
  if (t.name === 'kind') {
    d.kind = t.value;
    renderView();
  } else if (t.name === 'caseId') {
    d.caseId = t.value ? Number(t.value) : null;
    applyCaseToDraft(d, d.caseId);
    if (d.coopAuto) {
      // automatisch gesetzte Kooperation gehörte zum Mandanten der vorigen Akte
      d.coopId = null;
      d.coopAuto = false;
    }
    d.billing = null;
    renderView();
    runCoopDetect();
    loadContractBilling(d, true).then((applied) => {
      if (st.draft !== d || st.view !== 'invoice-new') return;
      if (applied) renderView();
      else if ($('#invContract')) $('#invContract').innerHTML = contractStripHtml(d);
    });
  } else if (t.name === 'cooperationId') {
    d.coopId = t.value ? Number(t.value) : null;
    d.coopAuto = false;
    updateInvoiceSummary();
  } else if (t.name === 'membershipId') {
    d.memberId = t.value ? Number(t.value) : null;
    refreshMemberBox();
    updateInvoiceSummary();
  } else {
    onInvoiceInput(t);
  }
}

/* ---------------------------------------------------------------- Mandantenkartei (nur Kanzlei) */
// Alles zu einem Mandanten auf einer Seite: Akten, Rechnungen, Verträge, VIP, interne Notizen und Vermerk.
// Erreichbar über „Mandanten“ im Menü, den Namen in der Akte bzw. in der Rechnungsliste und die globale Suche.
const CLIENT_FLAG_TONE = { vorkasse: 'amber', sperre: 'red' };
const CLIENT_FILTERS = [
  ['alle', 'Alle', () => true],
  ['offen', 'Offene Rechnungen', (c) => c.openSum > 0],
  ['vermerk', 'Mit Vermerk', (c) => !!c.flag],
  ['vip', 'VIP & Lifetime', (c) => !!c.membership],
];
const clientFlagBadge = (f) => (f ? badge(f.label, CLIENT_FLAG_TONE[f.flag] || 'amber') : '');
/** Link zur Kartei – z. B. der Name des Mandanten in der Akte oder in der Rechnungsliste. */
const clientLink = (key, name, cls = '') => `<button type="button" class="link-btn client-link${cls ? ` ${cls}` : ''}" data-action="open-client" data-key="${esc(key)}" title="Mandantenkartei öffnen">${esc(name)}</button>`;

function filteredClients() {
  const q = st.clientQuery.trim().toLowerCase();
  const test = (CLIENT_FILTERS.find(([k]) => k === st.clientFilter) || CLIENT_FILTERS[0])[2];
  return st.clients.filter((c) => test(c) && (!q || [c.name, c.email].join(' ').toLowerCase().includes(q)));
}

function clientTable() {
  const rows = filteredClients();
  if (!rows.length) return empty(st.clients.length ? 'Keine Mandanten für diese Auswahl.' : 'Noch keine Mandanten.', 'idCard');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Mandant</th><th>Akten</th><th style="text-align:right">Offene Rechnungen</th><th>Hinweise</th><th>Letzte Aktivität</th></tr></thead>
      <tbody>${rows
      .map(
        (c) => `<tr class="row" data-action="open-client" data-key="${esc(c.key)}">
          <td class="td-main"><div class="font-medium">${esc(c.name)}</div><div class="text-xs text-dim">${c.hasAccount ? esc(c.email) : 'ohne Konto'}</div></td>
          <td data-label="Akten"><span>${c.casesTotal ? `${c.casesOpen} laufend <span class="text-dim">· ${c.casesTotal} gesamt</span>` : '<span class="text-dim">keine</span>'}</span></td>
          <td data-label="Offene Rechnungen" class="nowrap" style="text-align:right">${c.openSum ? `<span class="font-mono">${money(c.openSum)}</span>` : '<span class="text-dim">—</span>'}</td>
          <td data-label="Hinweise">${c.flag || c.membership ? `<div class="flex flex-wrap gap-1.5">${clientFlagBadge(c.flag)}${memberBadge(c.membership)}</div>` : '<span class="text-dim">—</span>'}</td>
          <td data-label="Letzte Aktivität" class="nowrap text-muted">${esc(relDays(c.lastActivity))}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

views.clients = {
  async load() {
    await load.clients();
  },
  render() {
    const count = (test) => st.clients.filter(test).length;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Mandanten</h1>
            <p class="page-sub">Alle Mandanten mit ihren Akten, Rechnungen, VIP-Status und internen Notizen – ein Klick öffnet die Kartei.</p></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="clientSearch" class="field" type="search" placeholder="Name oder E-Mail …" value="${esc(st.clientQuery)}" aria-label="Mandanten durchsuchen"></label>
          <div class="chip-row">${CLIENT_FILTERS.map(
            ([k, l, test]) => `<button class="chip ${st.clientFilter === k ? 'active' : ''}" data-action="client-filter" data-value="${k}">${l} <span class="chip-count">${count(test)}</span></button>`
          ).join('')}</div>
        </div>
        <div id="clientList" class="panel p-2 md:p-3">${clientTable()}</div>`;
  },
};

async function openClient(key) {
  const d = await api.get('/api/clients/' + encodeURIComponent(key));
  st.clientCard = d;
  openModal(clientCard(d), { wide: true, key: `client:${d.key}`, reopen: () => openClient(d.key) });
}
/** Kartei neu zeichnen (nach Notiz/Vermerk) – die Liste dahinter bekommt die neuen Werte beim nächsten Laden. */
function showClient(d) {
  st.clientCard = d;
  replaceModal(clientCard(d));
  if (st.view === 'clients') load.clients().then(() => $('#clientList') && ($('#clientList').innerHTML = clientTable()), () => {});
}

/** Vermerk als ruhige Leiste (Akte und Kartei): „Nur gegen Vorkasse“ in Bernstein, „Nicht mehr annehmen“ in Rot. */
function clientFlagStrip(f, { inCase = false } = {}) {
  if (!f) return '';
  return `<div class="ticket-strips">${ticketStrip({
    title: `${inCase ? 'Mandantenvermerk: ' : ''}${f.label}`,
    tip: 'Vom Board of Partners gesetzt. Sichtbar nur für die Kanzlei – nie für den Mandanten.',
    ico: icon('alert'),
    tone: CLIENT_FLAG_TONE[f.flag] || 'amber',
    badges: `<span class="ts-label">${f.reason ? `${esc(f.reason)} · ` : ''}${esc(f.setBy || 'Board')}, ${esc(fmtDateOnly(String(f.setAt || '').slice(0, 10)))}</span>`,
  })}</div>`;
}

function clientCard(d) {
  const s = d.stats;
  const facts = [
    d.account ? mailBreakHtml(d.account.email) : '<span class="text-dim">ohne Konto</span>',
    d.phone ? esc(d.phone) : '',
    d.account && d.account.discord ? `${DISCORD_ICON.replace('class="ico"', 'class="ico-sm inline-block align-[-2px]"')} ${esc(d.account.discord)}` : '',
    d.since ? `Mandant seit ${esc(fmtDateOnly(String(d.since).slice(0, 10)))}` : '',
  ].filter(Boolean);
  const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
  const openDoc = (gdoc, href, label) =>
    safeGdoc(gdoc)
      ? `<a class="icon-btn sm" href="${esc(safeGdoc(gdoc))}" target="_blank" rel="noopener noreferrer" aria-label="Google Doc öffnen" title="Google Doc öffnen">${icon('doc', 'ico-sm')}</a>`
      : `<a class="icon-btn sm" href="${href}" target="_blank" rel="noopener" aria-label="${esc(label)}" title="${esc(label)}">${icon('eye', 'ico-sm')}</a>`;

  // Akten ohne den (hier überflüssigen) Mandantennamen: Aktenzeichen · Rechtsgebiet · zuständig
  const caseRowHtml = (c) => `<div class="list-row" data-action="open-case" data-id="${c.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(c.title)}</div>
        <div class="meta"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(AREAS[c.area] || c.area)}${c.lawyerName ? ` · ${esc(c.lawyerName)}` : ''}</div></div>
      <div class="flex items-center gap-2 shrink-0">${stageBadge(c)}</div></div>`;
  const casesPart = d.cases.length
    ? `<div class="section"><h3 class="section-title">Akten <span class="sec-count">${d.cases.length}</span></h3>${d.cases.map(caseRowHtml).join('')}</div>`
    : emptySection('', 'Akten', 'keine');
  const invoicesPart = d.invoices.length
    ? `<div class="section"><h3 class="section-title">Rechnungen &amp; Honorare <span class="sec-count">${d.invoices.length}</span></h3>${d.invoices
        .map(
          (i) => `<div class="list-row wrap inv-row"><div class="main"><div class="title">${docTitleLink(`/invoice.html?id=${i.id}`, esc(i.number), 'font-mono text-gold')} · ${esc(INVOICE_KIND[i.kind])}</div>
              <div class="meta">${esc(fmtDate(i.createdAt))}${i.caseNumber ? ` · Akte ${esc(i.caseNumber)}` : ''}</div></div>
            <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end"><span class="font-mono nowrap">${money(i.total)}</span>${invoiceBadge(i)}${openDoc(i.googleDoc, `/invoice.html?id=${i.id}`, 'Ansehen / PDF')}</div></div>`
        )
        .join('')}</div>`
    : emptySection('', 'Rechnungen & Honorare', 'keine');
  const contractsPart = d.contracts.length
    ? `<div class="section"><h3 class="section-title">Verträge &amp; Schriftsätze <span class="sec-count">${d.contracts.length}</span></h3>${d.contracts
        .map(
          (k) => `<div class="list-row wrap"><div class="main"><div class="title">${docTitleLink(`/vertrag.html?id=${k.id}`, esc(k.templateName), 'font-medium')}</div>
              <div class="meta">Akte ${esc(k.caseNumber)} · ${esc(fmtDate(k.createdAt))}</div></div>
            <div class="flex items-center gap-2 shrink-0">${statusBadge(CONTRACT_STATUS, k.status)}${openDoc(k.status === 'unterschrieben' ? k.googleDoc : null, `/vertrag.html?id=${k.id}`, 'Ansehen / PDF')}</div></div>`
        )
        .join('')}</div>`
    : emptySection('', 'Verträge & Schriftsätze', 'keine');
  const notesPart = `<div class="section"><h3 class="section-title">Interne Notizen <span class="sec-note">nur für die Kanzlei</span></h3>
      <form data-form="client-note" data-key="${esc(d.key)}" class="client-note-form">
        <textarea name="body" class="field" rows="2" maxlength="2000" placeholder="z. B. zahlt zuverlässig, bevorzugt Kontakt über Discord …" aria-label="Neue Notiz"></textarea>
        <div class="form-actions mt-2"><button type="submit" class="btn-outline btn-sm">${icon('plus', 'ico-sm')}<span>Notiz speichern</span></button></div>
      </form>
      ${d.notes
        .map(
          (n) => `<div class="client-note"><div class="cn-head"><span><strong>${esc(n.author)}</strong> · ${esc(fmtDate(n.createdAt))}</span>${
            n.authorId === st.user.id || isBoard()
              ? `<button type="button" class="icon-btn sm" data-action="client-note-delete" data-id="${n.id}" aria-label="Notiz löschen" title="Notiz löschen">${icon('trash', 'ico-sm')}</button>`
              : ''
          }</div><div class="cn-body">${esc(n.body)}</div></div>`
        )
        .join('')}</div>`;
  const flagPart = d.canFlag
    ? `<div class="section"><h3 class="section-title">Vermerk <span class="sec-note">nur Board of Partners</span></h3>
        <p class="text-sm text-muted mb-3">Erscheint der Kanzlei in jeder Akte dieses Mandanten und bei neuen Anfragen in Discord – nie dem Mandanten.</p>
        <form data-form="client-flag" data-key="${esc(d.key)}" class="form-grid cols-2">
          <div><label class="label" for="cfFlag">Vermerk</label><select id="cfFlag" name="flag" class="field">${opt('', 'Kein Vermerk', !d.flag)}${opt('vorkasse', 'Nur gegen Vorkasse', d.flag && d.flag.flag === 'vorkasse')}${opt('sperre', 'Nicht mehr annehmen', d.flag && d.flag.flag === 'sperre')}</select></div>
          <div><label class="label" for="cfReason">Grund</label><input id="cfReason" name="reason" class="field" maxlength="300" value="${esc(d.flag ? d.flag.reason : '')}" placeholder="z. B. zwei Rechnungen nicht bezahlt"></div>
          <div class="span-2 form-actions"><button type="submit" class="btn-outline btn-sm">${icon('check', 'ico-sm')}<span>Vermerk speichern</span></button></div>
        </form></div>`
    : '';

  return `
      <div class="pr-12 mb-4"><p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Mandantenkartei</p>
        <h2 class="modal-title mb-1">${esc(d.name)}</h2>
        <p class="text-sm text-muted client-facts">${facts.join('<span class="text-dim"> · </span>')}</p>
        ${d.membership || (d.account && !d.account.active) ? `<div class="flex flex-wrap gap-1.5 mt-2">${memberBadge(d.membership ? { name: d.membership.tier_name, kind: d.membership.kind } : null)}${d.account && !d.account.active ? badge('Konto deaktiviert', 'slate') : ''}</div>` : ''}
      </div>
      ${clientFlagStrip(d.flag)}
      <div class="info-grid stats-4 mb-5">${cell('Laufende Akten', String(s.casesOpen))}${cell('Akten gesamt', String(s.casesTotal))}${cell('Offene Rechnungen', s.openSum ? `<span class="text-amber-300">${money(s.openSum)}</span>` : '—')}${cell('Bezahlt gesamt', s.paidSum ? money(s.paidSum) : '—')}</div>
      ${casesPart}
      ${invoicesPart}
      ${contractsPart}
      ${notesPart}
      ${flagPart}`;
}

