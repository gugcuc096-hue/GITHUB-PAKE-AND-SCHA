/*
 * Verbindet die öffentliche Startseite (index.html) mit dem Backend:
 * Login-/Dashboard-Button, Mandatsanfrage, Anliegen an das Board of Partners sowie Team und
 * Honorarordnung live aus der Datenbank (vom Dashboard aus pflegbar).
 * Wird NACH dem Inline-Skript der Startseite geladen.
 */
(() => {
  'use strict';
  const { api, esc, money, copy } = window.PS;
  let me = null;

  // Dienststatus: [Beschriftung, Punktfarbe, Textfarbe]
  const DUTY = {
    dienst: ['Im Dienst', 'bg-emerald-400', 'text-emerald-300'],
    gericht: ['Im Gericht', 'bg-[#d4af37]', 'text-[var(--gold-light)]'],
    pause: ['Pause', 'bg-amber-400', 'text-amber-300'],
  };

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
    box.innerHTML = `
      <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
      <h3 class="font-serif text-2xl font-semibold text-white text-center mb-2">Mandat eingegangen</h3>
      <p class="text-sm text-[var(--text-muted)] text-center mb-5">Ein Anwalt der Kanzlei wurde benachrichtigt und meldet sich umgehend.${res.linkedToAccount ? ' Die Akte wurde Ihrem Konto hinzugefügt.' : ''}</p>
      <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center mb-3"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Ihr Aktenzeichen</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.caseNumber)}</div></div>
      <p class="text-xs text-[var(--text-muted)] text-center mb-5">Bitte geben Sie das Aktenzeichen bei Rückfragen an.${res.linkedToAccount ? '' : ' Mit einem Mandantenkonto sehen Sie den Stand Ihrer Akte jederzeit im Mandantenportal.'}</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <button type="button" id="ticketCopy" class="btn-outline flex-1 py-3 text-xs uppercase tracking-wider">Aktenzeichen kopieren</button>
        ${res.linkedToAccount && res.caseId ? `<a href="/dashboard.html?case=${Number(res.caseId)}" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Zur Akte</a>` : ''}
      </div>
      ${res.discordTicket
        ? `<button type="button" id="ticketDiscord" class="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-xs uppercase tracking-wider font-semibold py-3 transition-colors">Discord-Ticket beitreten</button>
           <p class="text-[0.7rem] text-center text-[var(--text-dim)] mt-2">Ihr privates Ticket auf dem Discord der Kanzlei – alle Neuigkeiten zu Ihrer Akte automatisch. Am besten gleich beitreten.</p>`
        : ''}`;
    wrap.classList.add('hidden');
    box.classList.remove('hidden');

    document.getElementById('ticketCopy').addEventListener('click', async () => {
      const ok = await copy(res.caseNumber);
      showToast(ok ? 'Kopiert' : 'Nicht möglich', ok ? 'Das Aktenzeichen ist in der Zwischenablage.' : 'Bitte das Aktenzeichen notieren.');
    });
    // Beitritt nur direkt nach dem Einreichen: Aktenzeichen + Pin bleiben im Hintergrund (der Pin wird nicht angezeigt)
    document.getElementById('ticketDiscord')?.addEventListener('click', () => joinTicket(res.caseNumber, res.pin));
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

  /* ---------------------------------------------------------------- Discord-Ticket der Akte */
  /** Schickt Aktenzeichen + Pin per POST an den Server, der zur Discord-Anmeldung weiterleitet. */
  function joinTicket(caseNumber, pin) {
    const f = document.getElementById('ticketJoinForm');
    f.elements.caseNumber.value = caseNumber;
    f.elements.pin.value = pin;
    f.submit();
  }
  // Rückmeldung nach dem Discord-Beitritt (…/?ticket=…)
  (() => {
    const code = new URLSearchParams(location.search).get('ticket');
    if (!code) return;
    const MSG = {
      pending: ['Discord verbunden', 'Sie werden dem Ticket hinzugefügt, sobald Sie auf dem Discord-Server der Kanzlei sind.'],
      notfound: ['Nicht gefunden', 'Die Akte wurde nicht gefunden. Bitte wenden Sie sich an die Kanzlei.'],
      limit: ['Zu viele Versuche', 'Bitte in ein paar Minuten erneut versuchen.'],
      disabled: ['Nicht verfügbar', 'Discord-Tickets sind derzeit nicht eingerichtet.'],
      denied: ['Abgebrochen', 'Die Discord-Anmeldung wurde abgebrochen.'],
      state: ['Bitte erneut versuchen', 'Die Sicherheitsprüfung ist abgelaufen.'],
      error: ['Das hat nicht geklappt', 'Die Verbindung mit Discord ist fehlgeschlagen. Bitte erneut versuchen.'],
    };
    const [title, text] = MSG[code] || MSG.error;
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => showToast(title, text), 300);
  })();

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
        const duty = m.duty ? DUTY[m.duty] : null;
        const portrait = m.photoUrl
          ? `<img src="${esc(m.photoUrl)}" alt="${esc(m.name)}" loading="lazy" class="w-24 h-24 rounded-full object-cover ring-4 ring-[rgba(212,175,55,0.18)] ${lead ? 'shadow-[0_0_40px_rgba(212,175,55,0.35)]' : ''}">`
          : `<div class="w-24 h-24 rounded-full ${lead ? 'bg-gradient-to-br from-[#d4af37] to-[#8f7322] text-[#02050e] shadow-[0_0_40px_rgba(212,175,55,0.35)]' : 'bg-gradient-to-br from-slate-600 to-slate-800 text-white'} flex items-center justify-center font-serif text-3xl font-bold ring-4 ring-[rgba(212,175,55,0.12)]">${esc(m.initials)}</div>`;
        return `
        <article class="glass-card team-card p-7 text-center">
          <div class="relative w-24 h-24 mx-auto mb-5">${portrait}
            ${duty ? `<span class="absolute bottom-1 right-1 w-5 h-5 rounded-full border-[3px] border-[#0a1228] ${duty[1]}" title="${esc(duty[0])}"></span>` : ''}</div>
          ${duty ? `<div class="flex items-center justify-center gap-1.5 text-[0.7rem] ${duty[2]} mb-2"><span class="w-1.5 h-1.5 rounded-full ${duty[1]} animate-pulse"></span>${esc(duty[0])}</div>` : ''}
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
            <input type="checkbox" class="calc-check accent-[var(--gold-500)] w-4 h-4 shrink-0" value="${Number(f.price)}" data-name="${esc(f.name)}">
            <span class="text-sm font-medium text-white">${esc(f.name)}</span>
          </span>
          <span class="font-mono text-xs text-[var(--gold-500)] whitespace-nowrap">${money(f.price)}</span>
        </label>`
        )
        .join('');
      if (typeof window.calculateTotal === 'function') window.calculateTotal();
    }
  }

  /* ---------------------------------------------------------------- VIP & Lifetime (Angebot aus dem Dashboard) */
  const pct = (n) => String(n).replace('.', ',');
  function renderVip(tiers) {
    const grid = document.getElementById('vipTiers');
    if (!grid) return;
    if (!tiers.length) {
      grid.innerHTML = '<p class="md:col-span-3 text-center text-sm text-[var(--text-muted)] py-8">Aktuell gibt es keine VIP- oder Lifetime-Angebote.</p>';
      return;
    }
    // Wenige Angebote mittig statt links im Raster
    if (tiers.length === 1) grid.className = 'grid grid-cols-1 gap-6 max-w-md mx-auto';
    else if (tiers.length === 2) grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto';
    grid.innerHTML = tiers
      .map((t) => {
        const life = t.kind === 'perma';
        return `
        <article class="glass-card p-8 border-t-2 ${life ? 'border-t-[var(--gold-500)] shadow-[0_0_40px_rgba(212,175,55,0.12)]' : 'border-t-sky-400/60'} flex flex-col">
          <div class="flex items-center justify-between mb-4">
            <span class="text-[0.65rem] font-mono px-3 py-1 rounded-full uppercase font-semibold ${life ? 'bg-[rgba(212,175,55,0.15)] text-[var(--gold-light)] border border-[var(--gold-hairline)]' : 'bg-sky-500/10 text-sky-300 border border-sky-500/20'}">${life ? '👑 Lifetime' : '⭐ VIP'}</span>
            <span class="text-xs text-[var(--text-muted)] font-mono">${life ? 'unbefristet' : `${Number(t.durationDays)} Tage`}</span>
          </div>
          <h3 class="font-serif text-3xl font-semibold text-white mb-2">${esc(t.name)}</h3>
          <div class="font-mono text-3xl text-[var(--gold-500)] font-semibold">${money(t.price)}</div>
          <div class="text-xs text-[var(--text-muted)] mb-5">${life ? 'einmalig · gilt unbefristet' : `für ${Number(t.durationDays)} Tage · verlängerbar`}</div>
          <div class="text-sm text-[var(--gold-light)] font-semibold mb-3">${pct(t.discountPct)} % Rabatt auf alle Leistungen</div>
          <p class="text-sm text-[var(--text-muted)] leading-relaxed mb-6 whitespace-pre-line flex-grow">${esc(t.benefits || '')}</p>
          <button type="button" data-vip-tier="${Number(t.id)}" class="${life ? 'btn-gold' : 'btn-outline'} py-3 text-sm uppercase tracking-wider w-full">Jetzt anfragen</button>
        </article>`;
      })
      .join('');
  }
  // Anfragen läuft im Mandantenportal (Konto nötig): ohne Anmeldung erst Login bzw. Registrierung, danach direkt weiter
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-vip-tier]');
    if (!btn) return;
    const target = `/dashboard.html?vip=${btn.dataset.vipTier}#vip-angebot`;
    if (me && me.role !== 'mandant') location.href = '/dashboard.html#vip'; // Team: Verwaltung im Dashboard
    else if (me) location.href = target;
    else location.href = '/login.html?next=' + encodeURIComponent(target);
  });

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

  api.get('/api/public/memberships')
    .then((r) => renderVip(r.tiers || []))
    .catch(() => {
      const grid = document.getElementById('vipTiers');
      if (grid) grid.innerHTML = '<p class="md:col-span-3 text-center text-sm text-[var(--text-muted)] py-8">Angebote konnten nicht geladen werden.</p>';
    });

  /* ---------------------------------------------------------------- Mandantenstimmen */
  // Karussell; ab drei vom Board freigegebenen Bewertungen ersetzen echte Stimmen die bisherigen Texte.
  const track = document.getElementById('testimonialTrack');
  const dotsRoot = document.getElementById('testimonialDots');
  let tIndex = 0;
  const tCount = () => (track ? track.children.length : 0);
  function renderDots() {
    if (!dotsRoot) return;
    dotsRoot.innerHTML = '';
    for (let i = 0; i < tCount(); i++) {
      const dot = document.createElement('span');
      dot.className = 'dot-btn' + (i === tIndex ? ' active' : '');
      dot.addEventListener('click', () => {
        tIndex = i;
        updateTestimonial();
      });
      dotsRoot.appendChild(dot);
    }
  }
  function updateTestimonial() {
    track.style.transform = `translateX(-${tIndex * 100}%)`;
    renderDots();
  }
  const reviewSlide = (r) => `<div class="w-full shrink-0 px-2">
      <div class="glass-card p-8 md:p-10 text-center max-w-3xl mx-auto">
        <div class="flex justify-center gap-1 mb-5 text-[var(--gold-500)]" aria-label="${r.rating} von 5 Sternen">${'★'.repeat(r.rating)}<span style="opacity:.25">${'★'.repeat(5 - r.rating)}</span></div>
        <p class="font-serif text-xl sm:text-2xl italic text-white leading-relaxed mb-6">„${esc(r.body)}“</p>
        <div class="text-sm text-[var(--gold-light)] font-medium">— ${esc(r.name)}${r.area ? `, ${esc(r.area)}` : ''}</div>
      </div>
    </div>`;
  if (track) {
    renderDots();
    setInterval(() => {
      if (!tCount()) return;
      tIndex = (tIndex + 1) % tCount();
      updateTestimonial();
    }, 6000);
    api.get('/api/public/reviews')
      .then(({ reviews }) => {
        if (!reviews || reviews.length < 3) return; // bis dahin bleiben die bisherigen Texte
        track.innerHTML = reviews.slice(0, 8).map(reviewSlide).join('');
        tIndex = 0;
        updateTestimonial();
      })
      .catch(() => {});
  }

  /* ---------------------------------------------------------------- Eilnotdienst live */
  function renderDuty(d) {
    const label = document.getElementById('dutyLabel');
    const dot = document.getElementById('dutyDot');
    const wrap = document.getElementById('dutyStripText');
    if (!label || !d || !d.visible) return; // Anzeige abgeschaltet: statischer Text bleibt
    if (d.count > 0) {
      label.textContent = `Eilnotdienst: ${d.count} ${d.count === 1 ? 'Anwalt' : 'Anwälte'} im Dienst`;
      label.title = d.members.map((m) => `${m.name} – ${m.statusLabel}`).join('\n');
      wrap.className = 'flex items-center gap-2 text-emerald-400 min-w-0';
      dot.className = 'status-dot status-active animate-pulse shrink-0';
    } else {
      label.textContent = 'Eilnotdienst: Anfrage per Mandat-Ticket';
      label.title = '';
      wrap.className = 'flex items-center gap-2 text-amber-300 min-w-0';
      dot.className = 'status-dot shrink-0 bg-amber-400';
    }
  }
  const loadDuty = () => api.get('/api/public/on-duty').then(renderDuty).catch(() => {});
  loadDuty();
  setInterval(() => {
    if (!document.hidden) loadDuty();
  }, 60000);

  /* ---------------------------------------------------------------- Karriere */
  api.get('/api/public/positions')
    .then(({ positions }) => {
      const el = document.getElementById('careerCount');
      if (!el || !positions.length) return;
      el.textContent = `● ${positions.length} ${positions.length === 1 ? 'offene Stelle' : 'offene Stellen'}: ${positions.map((p) => p.title).join(' · ')}`;
      el.classList.remove('hidden');
    })
    .catch(() => {});

  /* ---------------------------------------------------------------- Anliegen an das Board of Partners */
  // Jeder kann ein Anliegen einreichen (auch ohne Konto). Sehen kann es nur das Board of Partners;
  // die einreichende Person liest Antworten mit Vorgangsnummer + Pin (angemeldet auch im Dashboard).
  const CONCERN_BADGE = {
    offen: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
    in_bearbeitung: 'text-sky-200 border-sky-400/40 bg-sky-400/10',
    erledigt: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    abgelehnt: 'text-slate-300 border-slate-500/40 bg-slate-500/10',
  };
  const concernModal = document.getElementById('concernModal');
  let concernAccess = null; // { reference, pin } der zuletzt abgefragten Vorgangs

  function fmtWhen(v) {
    const d = window.PS.parseDate ? window.PS.parseDate(v) : new Date(v);
    return d ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }

  function concernTab(tab) {
    document.querySelectorAll('[data-concern-tab]').forEach((b) => {
      const on = b.dataset.concernTab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('concernNewPane').classList.toggle('hidden', tab !== 'new');
    document.getElementById('concernStatusPane').classList.toggle('hidden', tab !== 'status');
  }

  /** Formular an den Besucher anpassen: angemeldet = Name aus dem Konto, Kategorien je Rolle. */
  async function prepareConcernForm() {
    try {
      const o = await api.get('/api/public/concern-options');
      const sel = document.getElementById('cfCategory');
      const current = sel.value;
      sel.innerHTML = Object.entries(o.categories)
        .map(([k, l]) => `<option value="${esc(k)}" ${k === current ? 'selected' : ''}>${esc(l)}</option>`)
        .join('');
      const info = document.getElementById('cfAccount');
      info.classList.toggle('hidden', !o.account);
      if (o.account) {
        info.innerHTML = `Angemeldet als <strong class="text-white">${esc(o.account.name)}</strong> (${esc(o.account.group)}). Ihr Anliegen erscheint zusätzlich in Ihrem Dashboard unter „Anliegen ans Board“.`;
      }
      document.getElementById('concernForm').dataset.account = o.account ? '1' : '';
      syncConcernPersonal();
    } catch {
      /* Standard-Kategorien aus dem HTML bleiben stehen */
    }
  }
  function syncConcernPersonal() {
    const form = document.getElementById('concernForm');
    const hide = !!form.dataset.account || document.getElementById('cfAnon').checked;
    document.getElementById('cfPersonal').classList.toggle('hidden', hide);
  }

  window.openConcernModal = function (tab = 'new') {
    document.getElementById('concernForm').classList.remove('hidden');
    document.getElementById('concernSuccess').classList.add('hidden');
    concernTab(tab);
    prepareConcernForm();
    concernModal.classList.remove('opacity-0', 'pointer-events-none');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (!window.matchMedia('(min-width: 768px)').matches) return;
      document.getElementById(tab === 'status' ? 'clRef' : 'cfSubject')?.focus();
    }, 50);
  };
  window.closeConcernModal = function () {
    concernModal.classList.add('opacity-0', 'pointer-events-none');
    document.body.style.overflow = '';
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !concernModal.classList.contains('pointer-events-none')) window.closeConcernModal();
  });
  concernModal.addEventListener('click', (e) => {
    if (e.target === concernModal) window.closeConcernModal();
  });
  document.querySelectorAll('[data-concern-tab]').forEach((b) => b.addEventListener('click', () => concernTab(b.dataset.concernTab)));
  document.getElementById('cfAnon').addEventListener('change', syncConcernPersonal);

  function showConcernSuccess(res) {
    const box = document.getElementById('concernSuccess');
    const text = `Vorgangsnummer: ${res.reference}\nPin: ${res.pin}`;
    box.innerHTML = `
      <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
      <h3 class="font-serif text-2xl font-semibold text-white text-center mb-2">Anliegen übermittelt</h3>
      <p class="text-sm text-[var(--text-muted)] text-center mb-5">Das Board of Partners wurde benachrichtigt und meldet sich.${res.linkedToAccount ? ' Sie finden das Anliegen auch in Ihrem Dashboard.' : ''}</p>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Vorgangsnummer</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.reference)}</div></div>
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Pin</div><div class="font-mono text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.pin)}</div></div>
      </div>
      <p class="text-xs text-amber-300/90 text-center mb-5">Bitte notieren Sie beide Angaben – damit lesen Sie jederzeit die Antwort des Boards.</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <button type="button" id="concernCopy" class="btn-outline flex-1 py-3 text-xs uppercase tracking-wider">Daten kopieren</button>
        ${res.linkedToAccount
          ? '<a href="/dashboard.html#concerns" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider text-center">Im Dashboard ansehen</a>'
          : '<button type="button" id="concernCheck" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Status ansehen</button>'}
      </div>`;
    document.getElementById('concernForm').classList.add('hidden');
    box.classList.remove('hidden');
    document.getElementById('concernCopy').addEventListener('click', async () => {
      const ok = await copy(text);
      showToast(ok ? 'Kopiert' : 'Nicht möglich', ok ? 'Vorgangsnummer und Pin sind in der Zwischenablage.' : 'Bitte die Angaben notieren.');
    });
    document.getElementById('concernCheck')?.addEventListener('click', () => {
      document.getElementById('clRef').value = res.reference;
      document.getElementById('clPin').value = res.pin;
      concernTab('status');
      lookupConcern();
    });
  }

  document.getElementById('concernForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const anonymous = form.elements.anonymous.checked;
    const data = {
      category: form.elements.category.value,
      urgency: (form.querySelector('input[name="urgency"]:checked') || {}).value || 'normal',
      subject: form.elements.subject.value.trim(),
      body: form.elements.body.value.trim(),
      anonymous,
      website: form.elements.website.value,
    };
    if (!form.dataset.account && !anonymous) {
      data.name = form.elements.name.value.trim();
      data.contact = form.elements.contact.value.trim();
      if (data.name.length < 2) return showToast('Angaben fehlen', 'Bitte Ihren Namen angeben – oder anonym einreichen.');
    }
    if (data.subject.length < 3) return showToast('Angaben fehlen', 'Bitte einen Betreff angeben (mind. 3 Zeichen).');
    if (data.body.length < 10) return showToast('Angaben fehlen', 'Bitte beschreiben Sie Ihr Anliegen (mind. 10 Zeichen).');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.post('/api/public/concerns', data);
      form.reset();
      syncConcernPersonal();
      showConcernSuccess(res);
    } catch (err) {
      showToast('Das hat nicht geklappt', err.message);
    } finally {
      btn.disabled = false;
    }
  });

  function renderConcern(d) {
    const thread = d.messages.length
      ? d.messages
          .map((m) => {
            const cls = m.system
              ? 'border-dashed border-[var(--glass-border)] text-[var(--text-dim)]'
              : m.fromBoard
                ? 'border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.06)]'
                : 'border-[var(--glass-border)] bg-slate-900/40';
            return `<div class="rounded-xl border ${cls} px-4 py-3">
              <div class="flex flex-wrap items-center gap-2 text-[0.7rem] text-[var(--text-dim)] mb-1"><span class="${m.fromBoard && !m.system ? 'text-[var(--gold-light)] font-medium' : 'text-[var(--text-muted)] font-medium'}">${esc(m.author)}</span>${m.fromBoard && !m.system ? '<span class="uppercase tracking-wider">Board of Partners</span>' : ''}<span>${esc(fmtWhen(m.createdAt))}</span></div>
              <div class="text-sm whitespace-pre-wrap break-words">${esc(m.body)}</div></div>`;
          })
          .join('')
      : '<p class="text-sm text-[var(--text-dim)] italic">Noch keine Antwort – das Board of Partners meldet sich hier.</p>';
    const reply = d.closed
      ? '<p class="text-xs text-[var(--text-dim)] mt-4">Dieses Anliegen ist abgeschlossen. Für etwas Neues reichen Sie bitte ein neues Anliegen ein.</p>'
      : `<form id="concernReply" class="mt-4 space-y-3">
          <label for="crText" class="block text-xs uppercase tracking-wider text-[var(--text-muted)]">Nachricht an das Board</label>
          <textarea id="crText" rows="3" maxlength="5000" required class="w-full bg-slate-900/80 border border-[var(--glass-border)] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--gold-500)]"></textarea>
          <button type="submit" class="btn-outline w-full py-2.5 text-xs uppercase tracking-wider disabled:opacity-60">Nachricht senden</button>
        </form>`;
    document.getElementById('concernResult').innerHTML = `
      <div class="rounded-xl border border-[var(--glass-border)] bg-slate-900/40 p-4 mb-4">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="min-w-0"><div class="font-mono text-xs text-[var(--gold-light)]">${esc(d.reference)}</div><div class="font-serif text-xl text-white break-words">${esc(d.subject)}</div></div>
          <span class="px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${CONCERN_BADGE[d.status] || ''}">${esc(d.statusLabel)}</span>
        </div>
        <div class="text-[0.7rem] text-[var(--text-dim)] mb-3">${esc(d.categoryLabel)} · eingereicht ${esc(fmtWhen(d.createdAt))}${d.anonymous ? ' · anonym' : ''}</div>
        <div class="text-sm text-[var(--text-muted)] whitespace-pre-wrap break-words">${esc(d.body)}</div>
      </div>
      <div class="text-xs uppercase tracking-widest text-[var(--gold-500)] font-medium mb-2">Verlauf</div>
      <div class="space-y-2">${thread}</div>
      ${reply}`;
    document.getElementById('concernReply')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('crText').value.trim();
      if (!text) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api.post('/api/public/concern-reply', { ...concernAccess, body: text });
        showToast('Gesendet', 'Ihre Nachricht ist beim Board of Partners eingegangen.');
        await lookupConcern();
      } catch (err) {
        showToast('Das hat nicht geklappt', err.message);
        btn.disabled = false;
      }
    });
  }

  async function lookupConcern() {
    const reference = document.getElementById('clRef').value.trim().toUpperCase();
    const pin = document.getElementById('clPin').value.trim();
    const out = document.getElementById('concernResult');
    if (!reference || !pin) return showToast('Angaben fehlen', 'Bitte Vorgangsnummer und Pin eingeben.');
    try {
      const d = await api.post('/api/public/concern-status', { reference, pin });
      concernAccess = { reference, pin };
      renderConcern(d);
    } catch (err) {
      out.innerHTML = `<p class="text-center py-6 text-red-300 text-sm">${esc(err.status === 429 ? err.message : 'Kein Anliegen mit diesen Angaben gefunden. Bitte Vorgangsnummer und Pin prüfen.')}</p>`;
    }
  }
  document.getElementById('concernLookup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    await lookupConcern();
    btn.disabled = false;
  });

})();
