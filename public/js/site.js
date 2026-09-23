/*
 * Verbindet die öffentliche Startseite (index.html) mit dem Backend:
 * Login-/Dashboard-Button, Mandatsanfrage, Aktenstatus-Abfrage sowie Team und
 * Honorarordnung live aus der Datenbank (vom Dashboard aus pflegbar).
 * Wird NACH dem Inline-Skript der Startseite geladen.
 */
(() => {
  'use strict';
  const { api, esc, money, copy } = window.PS;
  let me = null;

  const FEE_CATEGORIES = [
    ['rechtsberatung', 'Rechtsberatung'],
    ['strafrecht', 'Strafrecht & Haftvertretung'],
    ['notfall', 'Notfall & Sofortdienst'],
    ['gericht', 'Gerichtsverfahren'],
    ['vertraege', 'Verträge & Dokumente'],
  ];

  /* ---------------------------------------------------------------- Login / Dashboard */
  function updateAuthNav() {
    const href = me ? '/dashboard.html' : '/login.html';
    document.querySelectorAll('[data-auth-link]').forEach((a) => (a.href = href));
    document.querySelectorAll('[data-auth-label]').forEach((el) => {
      el.textContent = me ? el.dataset.authIn || 'Dashboard' : el.dataset.authOut || 'Login';
    });
    document.querySelectorAll('[data-auth-link]').forEach((a) => a.setAttribute('aria-label', me ? 'Zum Dashboard' : 'Login / Mandantenportal'));

    const form = document.getElementById('ticketForm');
    if (form && me && me.role === 'mandant') {
      if (!form.elements.name.value) form.elements.name.value = me.displayName || '';
      if (!form.elements.phone.value && me.phone) form.elements.phone.value = me.phone;
    }
  }

  /* ---------------------------------------------------------------- Mandat einreichen */
  function showTicketSuccess(res) {
    const wrap = document.getElementById('ticketFormWrap');
    const box = document.getElementById('ticketSuccess');
    if (!wrap || !box) return;
    const text = `Aktenzeichen: ${res.caseNumber}\nAktenpin: ${res.pin}`;
    box.innerHTML = `
      <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
      <h3 class="font-serif text-2xl font-semibold text-white text-center mb-2">Mandat eingegangen</h3>
      <p class="text-sm text-[var(--text-muted)] text-center mb-5">Ein Anwalt der Kanzlei wurde benachrichtigt und meldet sich umgehend.${res.linkedToAccount ? ' Die Akte wurde Ihrem Konto hinzugefügt.' : ''}</p>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Aktenzeichen</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.caseNumber)}</div></div>
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Aktenpin</div><div class="font-mono text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.pin)}</div></div>
      </div>
      <p class="text-xs text-amber-300/90 text-center mb-5">Bitte notieren Sie beide Angaben – damit fragen Sie jederzeit den Stand Ihrer Akte ab.</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <button type="button" id="ticketCopy" class="btn-outline flex-1 py-3 text-xs uppercase tracking-wider">Daten kopieren</button>
        ${res.linkedToAccount && res.caseId
          ? `<a href="/dashboard.html?case=${Number(res.caseId)}" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Zur Akte</a>`
          : '<button type="button" id="ticketCheck" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Status ansehen</button>'}
      </div>`;
    wrap.classList.add('hidden');
    box.classList.remove('hidden');

    document.getElementById('ticketCopy').addEventListener('click', async () => {
      const ok = await copy(text);
      showToast(ok ? 'Kopiert' : 'Nicht möglich', ok ? 'Aktenzeichen und Pin sind in der Zwischenablage.' : 'Bitte die Angaben notieren.');
    });
    document.getElementById('ticketCheck')?.addEventListener('click', () => {
      closeTicketModal();
      document.getElementById('caseInput').value = res.caseNumber;
      document.getElementById('casePin').value = res.pin;
      document.getElementById('akte').scrollIntoView({ behavior: 'smooth' });
      window.lookupCase();
    });
  }

  window.handleFormSubmit = async function (e) {
    e.preventDefault();
    const form = e.target;
    if (me && me.role !== 'mandant') {
      showToast('Hinweis', 'Als Kanzleimitglied legen Sie Akten direkt im Dashboard an.');
      setTimeout(() => (location.href = '/dashboard.html#cases'), 1400);
      return;
    }
    const data = {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      area: form.elements.area.value,
      urgency: (form.querySelector('input[name="urgency"]:checked') || {}).value || 'normal',
      description: form.elements.description.value.trim(),
      website: form.elements.website.value,
    };
    if (data.name.length < 2) return showToast('Angaben fehlen', 'Bitte Ihren vollständigen Namen angeben.');
    if (data.description.length < 10) return showToast('Angaben fehlen', 'Bitte beschreiben Sie Ihr Anliegen kurz (mind. 10 Zeichen).');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.post('/api/public/cases', data);
      form.reset();
      updateAuthNav();
      showTicketSuccess(res);
    } catch (err) {
      showToast('Das hat nicht geklappt', err.message);
    } finally {
      btn.disabled = false;
    }
  };

  /* ---------------------------------------------------------------- Aktenstatus */
  window.lookupCase = async function () {
    const number = document.getElementById('caseInput').value.trim().toUpperCase();
    const pin = document.getElementById('casePin').value.trim();
    const result = document.getElementById('caseResult');
    const emptyEl = document.getElementById('caseEmpty');
    const notFound = document.getElementById('caseNotFound');

    if (!number || !pin) {
      showToast('Angaben fehlen', 'Bitte Aktenzeichen und Aktenpin eingeben.');
      return;
    }
    emptyEl.classList.add('hidden');

    try {
      const d = await api.post('/api/public/case-status', { caseNumber: number, pin });
      notFound.classList.add('hidden');
      result.classList.remove('hidden');

      document.getElementById('caseNumber').textContent = d.caseNumber;
      document.getElementById('caseLawyer').textContent = d.lawyer;
      document.getElementById('caseNote').textContent = d.note || 'Zu Ihrer Akte liegt aktuell kein zusätzlicher Hinweis vor.';

      const badgeClass = d.closed
        ? 'text-slate-300 border-slate-500/40 bg-slate-500/10'
        : [
            'text-amber-300 border-amber-500/40 bg-amber-500/10',
            'text-amber-300 border-amber-500/40 bg-amber-500/10',
            'text-[var(--gold-light)] border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.1)]',
            'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
          ][d.step] || '';
      const badge = document.getElementById('caseBadge');
      badge.textContent = d.status;
      badge.className = 'px-4 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap self-start sm:self-auto ' + badgeClass;

      for (let i = 0; i < 4; i++) {
        const node = document.getElementById('node-' + i);
        node.classList.remove('done', 'current');
        if (d.closed || i < d.step) node.classList.add('done');
        else if (i === d.step) node.classList.add('current');
      }
      document.getElementById('trackFill').style.width = (d.closed ? 75 : (d.step / 3) * 75) + '%';
    } catch (err) {
      result.classList.add('hidden');
      notFound.classList.remove('hidden');
      notFound.textContent =
        err.status === 429 ? err.message : 'Kein Mandat mit diesen Angaben gefunden. Bitte prüfen Sie Aktenzeichen und Aktenpin.';
    }
  };

  /* ---------------------------------------------------------------- Team (live aus dem Dashboard) */
  function renderTeam(team) {
    const grid = document.getElementById('teamGrid');
    if (!grid) return;
    if (!team.length) {
      grid.innerHTML = '<p class="w-full text-center text-sm text-[var(--text-muted)] py-8">Aktuell sind keine Teammitglieder hinterlegt.</p>';
      return;
    }
    grid.innerHTML = team
      .map((m) => {
        const lead = m.tier === 'leitung';
        return `
        <article class="glass-card team-card p-7 text-center">
          <div class="w-24 h-24 mx-auto rounded-full ${lead ? 'bg-gradient-to-br from-[#d4af37] to-[#8f7322] text-[#02050e] shadow-[0_0_40px_rgba(212,175,55,0.35)]' : 'bg-gradient-to-br from-slate-600 to-slate-800 text-white'} flex items-center justify-center font-serif text-3xl font-bold mb-5 ring-4 ring-[rgba(212,175,55,0.12)]">${esc(m.initials)}</div>
          <span class="inline-block text-[0.6rem] uppercase tracking-[0.22em] px-3 py-1 rounded-full mb-3 ${lead ? 'text-[var(--gold-light)] border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.08)]' : 'text-slate-300 border border-slate-600 bg-slate-800/40'}">${lead ? 'Board of Partners' : 'Associate Attorneys'}</span>
          <h3 class="font-serif text-2xl font-semibold text-white mb-1">${esc(m.name)}</h3>
          <div class="text-xs uppercase tracking-widest ${lead ? 'text-[var(--gold-500)]' : 'text-slate-300'} mb-4">${esc(m.roleTitle)}</div>
          <p class="text-sm text-[var(--text-muted)] leading-relaxed">${esc(m.description || '')}</p>
        </article>`;
      })
      .join('');
  }

  /* ---------------------------------------------------------------- Honorarordnung & Tarifrechner */
  function renderFees(fees) {
    if (!fees.length) return; // statischer Inhalt der Seite bleibt als Rückfall bestehen
    const container = document.getElementById('priceListContainer');
    if (container) {
      container.innerHTML = FEE_CATEGORIES.map(([key, label]) => {
        const list = fees.filter((f) => f.category === key);
        if (!list.length) return '';
        return `
          <div class="price-category" data-category="${key}">
            <div class="flex items-center gap-3 mb-4 pb-2 border-b border-[var(--gold-hairline)]">
              <span class="w-2 h-2 rounded-full bg-[var(--gold-500)]"></span>
              <h3 class="font-serif text-2xl text-[var(--gold-light)] font-semibold">${esc(label)}</h3>
            </div>
            <div class="grid gap-3">${list
              .map(
                (f) => `
              <div class="price-item ledger-item p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-name="${esc(`${f.name} ${f.description}`.toLowerCase())}" data-category="${key}" data-price="${Number(f.price)}">
                <div><div class="font-medium text-white text-base">${esc(f.name)}</div><div class="text-xs text-[var(--text-muted)]">${esc(f.description)}</div></div>
                <div class="font-mono text-[var(--gold-500)] font-semibold text-lg whitespace-nowrap">${money(f.price)}</div>
              </div>`
              )
              .join('')}</div>
          </div>`;
      }).join('');
      container.querySelectorAll('.price-item').forEach((item, i) => (item.dataset.originalIndex = i));
      const active = document.querySelector('.tab-btn.active');
      if (typeof window.setCategory === 'function') window.setCategory(active ? active.dataset.cat : 'all');
      if (typeof window.sortPrices === 'function') window.sortPrices();
    }

    const calc = document.getElementById('calcOptions');
    const calcFees = fees.filter((f) => f.inCalculator);
    if (calc && calcFees.length) {
      calc.innerHTML = calcFees
        .map(
          (f) => `
        <label class="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--glass-border)] bg-slate-900/40 hover:bg-slate-900/70 cursor-pointer transition-all">
          <span class="flex items-center gap-3 min-w-0">
            <input type="checkbox" class="calc-check accent-[var(--gold-500)] w-4 h-4 shrink-0" value="${Number(f.price)}" data-name="${esc(f.name)}" onchange="calculateTotal()">
            <span class="text-sm font-medium text-white">${esc(f.name)}</span>
          </span>
          <span class="font-mono text-xs text-[var(--gold-500)] whitespace-nowrap">${money(f.price)}</span>
        </label>`
        )
        .join('');
      if (typeof window.calculateTotal === 'function') window.calculateTotal();
    }
  }

  /* ---------------------------------------------------------------- Start */
  api.get('/api/auth/session')
    .then((r) => (me = r?.user ?? null))
    .catch(() => (me = null))
    .finally(updateAuthNav);

  api.get('/api/team')
    .then((r) => renderTeam(r.team || []))
    .catch(() => {
      const grid = document.getElementById('teamGrid');
      if (grid) grid.innerHTML = '<p class="w-full text-center text-sm text-[var(--text-muted)] py-8">Team konnte nicht geladen werden.</p>';
    });

  api.get('/api/fees')
    .then((r) => renderFees(r.fees || []))
    .catch(() => {});

  ['caseInput', 'casePin'].forEach((id) => {
    document.getElementById(id)?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') window.lookupCase();
    });
  });
})();
