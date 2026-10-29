/*
 * Kanzlei-Dashboard – Rabatt-Freigabe (Rechnungen → Reiter „Freigaben“, siehe discountApprovals.js): Ab einem einstellbaren
 * Rabatt braucht eine Rechnung die Zustimmung des Board of Partners. Das Board entscheidet hier oder per Knopf in der
 * Discord-Direktnachricht; alle anderen sehen ihre eigenen Anfragen.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

const APPROVAL_TONE = { offen: 'amber', genehmigt: 'emerald', abgelehnt: 'red', verwendet: 'slate' };

async function loadApprovals() {
  st.approvals = await api.get('/api/discount-approvals');
}

function approvalCard(r) {
  const board = isBoard();
  const own = r.requestedBy === st.user.id;
  return `<article class="appr-card">
      <header class="appr-head"><div><strong>${esc(String(r.discountPct).replace('.', ','))} % Rabatt</strong> <span class="text-dim">auf ${esc(money(r.subtotal))} = ${esc(money(r.discountAmount))}</span></div>${badge(r.statusLabel, APPROVAL_TONE[r.status] || 'slate')}</header>
      <div class="appr-meta">${esc(r.requestedByName)} · ${esc(fmtDate(r.createdAt))}${r.clientName ? ` · Empfänger: ${esc(r.clientName)}` : ''}${r.caseNumber ? ` · <span class="font-mono text-gold">${esc(r.caseNumber)}</span>` : ''}</div>
      ${r.reason ? `<p class="appr-reason">${icon('chat', 'ico-sm')}<span>${esc(r.reason)}</span></p>` : ''}
      ${r.status !== 'offen' && r.decidedByName ? `<div class="text-xs text-dim">Entschieden von ${esc(r.decidedByName)} · ${esc(fmtDate(r.decidedAt))}${r.decidedVia === 'discord' ? ' · per Discord' : ''}${r.decisionNote ? ` · „${esc(r.decisionNote)}“` : ''}</div>` : ''}
      ${board && r.status === 'offen' && !own ? `<div class="appr-actions"><button type="button" class="btn-gold btn-sm" data-action="disc-decide" data-id="${r.id}" data-approve="1">${icon('check', 'ico-sm')}<span>Genehmigen</span></button><button type="button" class="btn-ghost btn-sm" data-action="disc-decide" data-id="${r.id}" data-approve="0">Ablehnen</button></div>` : ''}
      ${board && r.status === 'offen' && own ? '<div class="text-xs text-dim">Eigene Anfrage – entscheidet eine andere Person aus dem Board.</div>' : ''}
    </article>`;
}

function approvalsPanel() {
  const a = st.approvals || { requests: [], thresholdPct: 0 };
  const canConfigure = can('settings.edit');
  const open = a.requests.filter((r) => r.status === 'offen');
  return `<p class="text-sm text-muted mb-4">Ab einem einstellbaren Rabatt braucht eine Rechnung die <strong>Zustimmung des Boards</strong>. Das Board bekommt die Anfrage als Direktnachricht in Discord (mit Knöpfen) und sieht sie hier. Nach der Genehmigung erstellt die anfragende Person die Rechnung wie gewohnt – die Freigabe gilt einmal und höchstens für den genehmigten Rabatt.</p>
    <div class="panel panel-pad mb-4">
      <div class="panel-head"><h2 class="panel-title">Schwellwert</h2>${a.thresholdPct ? badge(`ab ${String(a.thresholdPct).replace('.', ',')} %`, 'gold') : badge('aus', 'slate')}</div>
      ${canConfigure
        ? `<form data-form="disc-settings" class="appr-settings"><label class="label" for="discPct">Rabatt ab … % braucht Freigabe <span class="text-dim font-normal normal-case tracking-normal">– 0 = keine Freigabe nötig; das Board selbst braucht nie eine</span></label>
          <div class="appr-set-row"><input id="discPct" name="pct" type="number" min="0" max="100" step="0.5" class="field" value="${esc(a.thresholdPct)}"><button type="submit" class="btn-outline btn-sm">${icon('check', 'ico-sm')}<span>Speichern</span></button></div></form>`
        : '<p class="text-sm text-muted">Den Schwellwert stellt das Board unter „Kanzlei-Einstellungen“ ein.</p>'}
    </div>
    ${open.length && isBoard() ? `<div class="banner banner-gold mb-4">${icon('alert')}<div><strong>${open.length} Anfrage${open.length === 1 ? '' : 'n'} warte${open.length === 1 ? 't' : 'n'} auf Entscheidung.</strong></div></div>` : ''}
    ${a.requests.length ? `<div class="appr-list">${a.requests.map(approvalCard).join('')}</div>` : `<div class="panel">${empty(isBoard() ? 'Noch keine Anfragen.' : 'Sie haben noch keine Freigabe angefragt.', 'check')}</div>`}`;
}

Object.assign(actions, {
  'disc-decide': async (el) => {
    if (el.dataset.approve !== '1') {
      // Ablehnen: kurzer Hinweis an die Person (optional)
      openModal(`<h2 class="modal-title">Rabatt ablehnen</h2><p class="modal-sub">Die Person erfährt es per Discord und im Dashboard.</p>
        <form data-form="disc-decline" data-id="${el.dataset.id}" class="form-grid">
          <div><label class="label" for="discNote">Hinweis (optional)</label><textarea id="discNote" name="note" rows="3" maxlength="300" class="field" placeholder="z. B. Bitte höchstens 15 % – Stammkunde ist er noch nicht." autofocus></textarea></div>
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">Ablehnen</button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div></form>`);
      return;
    }
    await api.post(`/api/discount-approvals/${el.dataset.id}/decide`, { approve: true });
    toast('Rabatt genehmigt.');
    await loadApprovals();
    renderView();
  },
  // Stand der eigenen Anfrage im Rechnungsformular prüfen
  'disc-refresh': async (el) => {
    await loadApprovals();
    const mine = st.approvals.requests.find((r) => r.id === Number(el.dataset.id));
    if (mine && st.draft) {
      st.draft.approval = mine;
      toast(`Freigabe: ${mine.statusLabel}${mine.status === 'abgelehnt' && mine.decisionNote ? ` – ${mine.decisionNote}` : ''}`, mine.status === 'abgelehnt' ? 'error' : 'ok');
      renderView();
    }
  },
});

Object.assign(forms, {
  'disc-decline': async (f) => {
    await api.post(`/api/discount-approvals/${f.dataset.id}/decide`, { approve: false, note: String(new FormData(f).get('note') || '').trim() });
    toast('Rabatt abgelehnt.');
    await modalBack();
    await loadApprovals();
    renderView();
  },
  'disc-settings': async (f) => {
    const res = await api.post('/api/discount-approvals/settings', { pct: Number(new FormData(f).get('pct') || 0) });
    toast(res.thresholdPct ? `Rabatte ab ${String(res.thresholdPct).replace('.', ',')} % brauchen jetzt die Freigabe des Boards.` : 'Keine Freigabe mehr nötig.');
    await loadApprovals();
    renderView();
  },
});
