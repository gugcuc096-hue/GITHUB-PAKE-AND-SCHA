/*
 * Kanzlei-Dashboard – Honorarvereinbarung in der Akte (aus dem Honorarrechner der Website, Code HON-4821):
 * Positionen mit Spanne und Rechenweg, Angebot per Code übernehmen, Rechnung daraus erstellen und beim Abschluss das
 * Erfolgshonorar abrechnen („erstrittener Betrag“ → Rechnung mit Rechenweg). Rechnet mit /js/honorar-calc.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const HK = () => window.PSHonorar;
const feeRange = (lo, hi) => (HK() ? HK().range(lo, hi) : money(lo));
const feePct = (n) => (HK() ? HK().pctText(n) : `${n} %`);

/** Abschnitt „Honorarvereinbarung“ (Reiter Dokumente). Kanzlei ohne Vereinbarung: Feld für den Angebots-Code. */
function feeAgreementSection(c, fa, staff) {
  if (!fa) {
    if (!staff || !c.canEdit) return '';
    return `<div class="section" id="secFee"><h3 class="section-title">Honorarvereinbarung</h3>
      <form data-form="fee-offer-attach" data-id="${c.id}" class="fee-attach">
        <p class="text-sm text-muted">Hat der Mandant im Tarifrechner der Website ein Angebot gespeichert? Mit dem Code wird es zur Honorarvereinbarung dieser Akte – die Rechnung übernimmt die Positionen.</p>
        <div class="fee-attach-row"><input name="code" class="field font-mono" maxlength="20" placeholder="HON-4821" aria-label="Angebots-Code" autocomplete="off" required>
        <button type="submit" class="btn-outline btn-md">${icon('download', 'ico-sm')}<span>Angebot übernehmen</span></button></div>
      </form></div>`;
  }
  const q = fa.quote || {};
  const positions = (q.positions || [])
    .map(
      (p) => `<li class="fee-pos"><div class="fee-pos-main"><span class="fee-pos-name">${esc(p.name)}</span>${p.successOnly ? '<span class="fee-badge">Nur bei Erfolg</span>' : ''}
        <span class="fee-pos-steps">${(p.steps || []).map((s) => esc(s)).join(' · ')}</span></div>
        <span class="fee-pos-sum num">${p.successOnly ? `${feePct(p.success.pct)} bei Erfolg` : esc(feeRange(p.low, p.high))}</span></li>`
    )
    .join('');
  const success = (q.success || []).length
    ? fa.settledAt
      ? `<div class="fee-success is-done">${icon('check', 'ico-sm')}<span>Erfolgshonorar abgerechnet: <b>${money(fa.successAmount)}</b> aus erstrittenen ${money(fa.successValue)}${fa.successInvoiceId ? ` · <a class="link-btn" href="/rechnung?id=${fa.successInvoiceId}" target="_blank" rel="noopener">Rechnung öffnen</a>` : ''}</span></div>`
      : `<div class="fee-success">${icon('star', 'ico-sm')}<span>Nur bei Erfolg: ${(q.success || []).map((s) => `<b>${feePct(s.pct)}</b> vom erstrittenen Betrag${s.minFee ? `, mind. ${money(s.minFee)}` : ''}${s.cap ? `, höchstens ${money(s.cap)}` : ''}`).join(' + ')} – geschätzt ${money(q.successTotal || 0)}.</span>${staff && c.canEdit ? `<button type="button" class="btn-outline btn-sm" data-action="fee-settle" data-id="${c.id}">${icon('receipt', 'ico-sm')}<span>Erfolgshonorar abrechnen</span></button>` : ''}</div>`
    : '';
  const totals = `<div class="fee-total"><span>Laut Angebot</span><b class="num">${esc(feeRange(q.totalLow || 0, q.totalHigh || 0))}</b></div>`;
  const discounts = [q.bundle ? `Mandatsbündel −${feePct(q.bundle.pct)}` : '', q.promo ? `${esc(q.promo.name)} −${feePct(q.promo.pct)}` : '', q.priority ? `${esc(q.priority.name)} +${feePct(q.priority.pct)}` : ''].filter(Boolean).join(' · ');
  return `<div class="section" id="secFee"><h3 class="section-title">Honorarvereinbarung</h3>
      <div class="fee-card">
        <div class="fee-head"><span class="fee-code font-mono">${esc(fa.offerCode)}</span><span class="text-xs text-dim">aus dem Tarifrechner · ${esc(fa.createdBy || 'Website')} · ${esc(fmtDate(fa.createdAt))}</span></div>
        <ul class="fee-list">${positions}</ul>
        ${discounts ? `<p class="text-xs text-dim mt-2">${discounts}</p>` : ''}
        ${totals}${success}
        <details class="fee-way"><summary>Rechenweg</summary><ol>${(q.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>
        ${staff && c.canEdit
          ? `<div class="fee-actions"><button type="button" class="btn-outline btn-sm" data-action="new-invoice" data-case-id="${c.id}">${icon('plus', 'ico-sm')}<span>Rechnung aus dem Angebot</span></button>${fa.settledAt ? '' : `<button type="button" class="btn-ghost btn-sm" data-action="fee-agreement-remove" data-id="${c.id}">${icon('x', 'ico-sm')}<span>Lösen</span></button>`}</div>`
          : ''}
      </div></div>`;
}

/** Feld „Erstrittener Betrag“ im Fenster „Verfahren abschließen“ (nur mit offenem Erfolgshonorar). */
function feeCloseField(fa) {
  if (!fa || !fa.hasSuccess || fa.settledAt) return '';
  const s = fa.quote.success;
  return `<div class="fee-close"><label class="label" for="ccWon">Erstrittener Betrag ($) <span class="text-dim font-normal normal-case tracking-normal">– Erfolgshonorar laut ${esc(fa.offerCode)}: ${s.map((x) => feePct(x.pct)).join(' + ')}</span></label>
      <input id="ccWon" name="wonAmount" type="number" data-money min="0" step="1" class="field" placeholder="z. B. 150000" data-fee-won>
      <p class="form-hint" data-fee-won-hint>Bei Erfolg wird daraus sofort die Rechnung über das Erfolgshonorar (mit Rechenweg). Leer lassen = später abrechnen.</p></div>`;
}
function feeWonHint(input) {
  const hint = input.closest('form').querySelector('[data-fee-won-hint]');
  const fa = st.feeClose;
  if (!hint || !fa || !HK()) return;
  const v = Math.round(Number(input.value) || 0);
  if (!v) return void (hint.textContent = 'Bei Erfolg wird daraus sofort die Rechnung über das Erfolgshonorar (mit Rechenweg). Leer lassen = später abrechnen.');
  const parts = HK().settle(fa.quote.success, v);
  hint.innerHTML = `${parts.map((p) => esc(p.steps.join(' → '))).join(' + ')} → Rechnung über <b>${money(parts.reduce((s, p) => s + p.amount, 0))}</b>`;
}
document.addEventListener('input', (e) => {
  if (e.target.matches && e.target.matches('[data-fee-won]')) feeWonHint(e.target);
});

/** Erfolgshonorar abrechnen (aus der Akte oder nach dem Abschließen). */
async function feeSettle(caseId, value) {
  const r = await api.post(`/api/cases/${caseId}/honorar/settle`, { value });
  toast(`Erfolgshonorar ${money(r.total)} abgerechnet – Rechnung ${r.invoice.number} erstellt.`, 'ok', { duration: 7000 });
  return r;
}
function feeSettleModal(caseId, fa) {
  st.feeClose = fa;
  openModal(
    `<h2 class="modal-title">Erfolgshonorar abrechnen</h2>
      <p class="modal-sub">Laut Honorarvereinbarung ${esc(fa.offerCode)} – die Rechnung wird mit Rechenweg erstellt.</p>
      <form data-form="fee-settle" data-id="${caseId}" class="form-grid">
        <div><label class="label" for="fsWon">Erstrittener Betrag ($)</label><input id="fsWon" name="wonAmount" type="number" data-money min="1" step="1" required class="field" data-fee-won autofocus>
        <p class="form-hint" data-fee-won-hint>${fa.quote.success.map((s) => `${feePct(s.pct)} vom erstrittenen Betrag${s.minFee ? `, mind. ${money(s.minFee)}` : ''}${s.cap ? `, höchstens ${money(s.cap)}` : ''}`).join(' + ')}</p></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('receipt', 'ico-sm')}<span>Rechnung erstellen</span></button></div>
      </form>`,
    { child: true }
  );
}

Object.assign(actions, {
  'fee-settle': async (el) => {
    const id = Number(el.dataset.id);
    const r = await api.get(`/api/cases/${id}/honorar`);
    if (r.agreement) feeSettleModal(id, r.agreement);
  },
  'fee-agreement-remove': async (el) => {
    const id = Number(el.dataset.id);
    if (!(await ask('Die Honorarvereinbarung wird von der Akte gelöst. Das Angebot bleibt gespeichert und lässt sich mit dem Code wieder übernehmen.', { title: 'Vereinbarung lösen?', confirmText: 'Lösen' }))) return;
    await api.del(`/api/cases/${id}/honorar`);
    toast('Honorarvereinbarung gelöst.');
    await reloadCase(id);
  },
});
Object.assign(forms, {
  'fee-offer-attach': async (f) => {
    const id = Number(f.dataset.id);
    const r = await api.post(`/api/cases/${id}/honorar`, { code: val(new FormData(f), 'code') });
    toast(`Angebot ${r.agreement.offerCode} übernommen – die Rechnung übernimmt die Positionen.`);
    await reloadCase(id);
  },
  'fee-settle': async (f) => {
    const id = Number(f.dataset.id);
    const v = Math.round(Number(f.elements.wonAmount.value) || 0);
    if (v < 1) throw new Error('Bitte den erstrittenen Betrag eintragen.');
    await feeSettle(id, v);
    await returnOrClose();
    await reloadCase(id).catch(() => {});
  },
});
