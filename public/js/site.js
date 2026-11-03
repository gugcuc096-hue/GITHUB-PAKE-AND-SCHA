/*
 * Verbindet die öffentliche Startseite (index.html) mit dem Backend:
 * Login-/Dashboard-Button, Mandatsanfrage, Anliegen an das Board of Partners sowie Team und
 * Honorarordnung live aus der Datenbank (vom Dashboard aus pflegbar).
 * Wird NACH dem Inline-Skript der Startseite geladen.
 */
(() => {
  'use strict';
  const { api, esc, money, copy, fieldError, fieldErrors, clearFieldErrors } = window.PS;
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
    const href = me ? '/dashboard' : '/login';
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
      <p class="text-sm text-[var(--text-muted)] text-center mb-5">${res.lawyerName ? `${esc(res.lawyerName)} wurde benachrichtigt und meldet sich umgehend.` : 'Ein Anwalt der Kanzlei wurde benachrichtigt und meldet sich umgehend.'}${res.linkedToAccount ? ' Die Akte wurde Ihrem Konto hinzugefügt.' : ''}</p>
      <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center mb-3"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Ihr Aktenzeichen</div><div class="tabular-nums text-lg text-[var(--gold-light)]">${esc(res.caseNumber)}</div></div>
      <p class="text-xs text-[var(--text-muted)] text-center mb-5">Bitte geben Sie das Aktenzeichen bei Rückfragen an.${res.linkedToAccount ? '' : ' Mit einem Mandantenkonto sehen Sie den Stand Ihrer Akte jederzeit im Mandantenportal.'}</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <button type="button" id="ticketCopy" class="btn-outline flex-1 py-3 text-xs uppercase tracking-wider">Aktenzeichen kopieren</button>
        ${res.linkedToAccount && res.caseId ? `<a href="/dashboard?case=${Number(res.caseId)}#cases" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Zur Akte</a>` : ''}
      </div>
      ${!res.linkedToAccount && res.discordSignup
        ? `<button type="button" id="ticketAccount" class="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-xs uppercase tracking-wider font-semibold py-3 transition-colors">Konto mit Discord anlegen</button>
           <p class="text-[0.7rem] text-center text-[var(--text-dim)] mt-2">Ein Klick, kein Passwort: Ihre Akte erscheint sofort im Mandantenportal – mit Nachrichten an Ihren Anwalt, Verträgen und Rechnungen${res.discordTicket ? ', und Sie kommen automatisch in Ihr Discord-Ticket' : ''}.</p>`
        : ''}
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
    document.getElementById('ticketAccount')?.addEventListener('click', () => joinTicket(res.caseNumber, res.pin, '/api/discord/case-account'));
  }

  /* ---------------------------------------------------------------- Rechtsgebiete aus dem Dashboard (Auswahl und Zusatzfragen) */
  let areaList = [];
  const FIELD_CLS = 'w-full bg-slate-900/80 border border-[var(--glass-border)] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--gold-500)]';
  const LABEL_CLS = 'block text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1';
  function renderAreaFields() {
    const box = document.getElementById('tkAreaFields');
    const sel = document.getElementById('tkArea');
    if (!box || !sel) return;
    const a = areaList.find((x) => x.key === sel.value);
    const saved = {};
    box.querySelectorAll('[data-answer]').forEach((el) => (saved[el.dataset.answer] = el.type === 'checkbox' ? el.checked : el.value));
    box.innerHTML = ((a && a.fields) || [])
      .map((f) => {
        const id = `tkF-${esc(f.key)}`;
        const req = f.required && f.type !== 'checkbox' ? ' required' : '';
        const label = `${esc(f.label)}${f.required ? ' *' : ''}`;
        const hint = f.hint ? `<p class="text-[0.7rem] text-[var(--text-dim)] mt-1">${esc(f.hint)}</p>` : '';
        if (f.type === 'checkbox') return `<label class="flex items-center gap-2 text-sm text-[var(--text-muted)]"><input id="${id}" type="checkbox" data-answer="${esc(f.key)}" class="accent-[var(--gold-500)]" ${saved[f.key] ? 'checked' : ''}> ${esc(f.label)}</label>${hint}`;
        if (f.type === 'textarea') return `<div><label for="${id}" class="${LABEL_CLS}">${label}</label><textarea id="${id}" data-answer="${esc(f.key)}" rows="3" maxlength="2000" class="${FIELD_CLS}"${req}>${esc(saved[f.key] || '')}</textarea>${hint}</div>`;
        if (f.type === 'select') return `<div><label for="${id}" class="${LABEL_CLS}">${label}</label><select id="${id}" data-answer="${esc(f.key)}" class="${FIELD_CLS}"${req}><option value="">– bitte wählen –</option>${f.options.map((o) => `<option ${saved[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${hint}</div>`;
        const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'text" inputmode="decimal' : 'text';
        return `<div><label for="${id}" class="${LABEL_CLS}">${label}</label><input id="${id}" type="${type}" data-answer="${esc(f.key)}" maxlength="300" value="${esc(saved[f.key] || '')}" class="${FIELD_CLS}"${req}>${hint}</div>`;
      })
      .join('');
  }
  function applyAreas(list) {
    areaList = list || [];
    const sel = document.getElementById('tkArea');
    if (!sel || !areaList.length) return;
    const keep = sel.value;
    sel.innerHTML = areaList.map((a) => `<option value="${esc(a.key)}">${esc(a.intakeTitle || a.name)}</option>`).join('');
    if (areaList.some((a) => a.key === keep)) sel.value = keep;
    renderAreaFields();
  }
  document.getElementById('tkArea')?.addEventListener('change', renderAreaFields);
  window.PS.boot('areas', '/api/public/areas').then((r) => applyAreas(r && r.areas)).catch(() => {});

  window.handleFormSubmit = async function (e) {
    e.preventDefault();
    const form = e.target;
    if (me && me.role !== 'mandant') {
      showToast('Hinweis', 'Als Kanzleimitglied legen Sie Akten direkt im Dashboard an.');
      setTimeout(() => (location.href = '/dashboard#cases'), 1400);
      return;
    }
    const answers = {};
    form.querySelectorAll('#tkAreaFields [data-answer]').forEach((el) => (answers[el.dataset.answer] = el.type === 'checkbox' ? el.checked : el.value.trim()));
    const data = {
      answers,
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      area: form.elements.area.value,
      urgency: (form.querySelector('input[name="urgency"]:checked') || {}).value || 'normal',
      description: form.elements.description.value.trim(),
      website: form.elements.website.value,
    };
    const wish = Number(form.elements.teamMemberId && form.elements.teamMemberId.value);
    if (wish) data.teamMemberId = wish; // Wunschanwalt von der Teamkarte
    clearFieldErrors(form);
    if (data.name.length < 2) return fieldError(form.elements.name, 'Bitte Ihren vollständigen Namen angeben.');
    if (data.description.length < 10) return fieldError(form.elements.description, `Bitte beschreiben Sie Ihr Anliegen kurz (mind. 10 Zeichen, aktuell ${data.description.length}).`);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.post('/api/public/cases', data);
      window.PS.drafts.clear(form);
      form.reset();
      if (typeof window.setWishLawyer === 'function') window.setWishLawyer(null);
      updateAuthNav();
      showTicketSuccess(res);
    } catch (err) {
      if (!fieldErrors(form, err)) showToast('Das hat nicht geklappt', err.message);
    } finally {
      btn.disabled = false;
    }
  };

  /* ---------------------------------------------------------------- Discord-Ticket der Akte */
  /** Schickt Aktenzeichen + Pin per POST an den Server, der zur Discord-Anmeldung weiterleitet. */
  function joinTicket(caseNumber, pin, action = '/api/discord/case-join') {
    const f = document.getElementById('ticketJoinForm');
    f.action = action; // auch „Konto mit Discord anlegen“ (gleiche Angaben, anderes Ziel)
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

  /* ---------------------------------------------------------------- Anwälte (live aus dem Dashboard) */
  // Karte einer Person (wie im Dashboard): Foto oder Monogramm auf Gold, Rang, Name, Schwerpunkte, ein Knopf.
  // Die ganze Karte führt zum Profil; „Mandat anfragen“ schickt das Mandat direkt an diesen Anwalt.
  const monogram = (m) => esc(String(m.initials || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '–');
  const DUTY_BADGE = { dienst: 'badge-emerald', gericht: 'badge-gold', pause: 'badge-amber' };
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.48 3.5a.56.56 0 011.04 0l2.12 5.11a.56.56 0 00.48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 00-.18.56l1.28 5.38a.56.56 0 01-.84.61l-4.73-2.89a.56.56 0 00-.58 0l-4.73 2.89a.56.56 0 01-.84-.61l1.28-5.38a.56.56 0 00-.18-.56l-4.2-3.6a.56.56 0 01.32-.99l5.52-.44a.56.56 0 00.48-.35z"/></svg>';
  function personCard(m) {
    const duty = m.duty ? DUTY[m.duty] : null;
    const href = m.slug ? `/team/${esc(m.slug)}` : '/anwaelte';
    const portrait = m.photoUrl ? `<img src="${esc(m.photoUrl)}" alt="" loading="lazy" decoding="async" width="112" height="112">` : `<span class="kz-mono">${monogram(m)}</span>`;
    const focus = (m.focus || []).slice(0, 3);
    return `<article class="kz-person team-card${m.lawyerOfMonth ? ' is-lotm' : ''}">
        ${m.lawyerOfMonth ? `<div class="kz-lotm" title="Für herausragende Arbeit im ${esc(m.lawyerOfMonth)}">${STAR}Anwalt des Monats</div>` : ''}
        <span class="kz-portrait">${portrait}</span>
        <div class="kz-person-rank">${esc(m.roleTitle)}</div>
        <h3 class="kz-person-name"><a href="${href}" class="team-name">${esc(m.name)}</a></h3>
        <p class="kz-person-focus"${m.focusAuto ? ' title="Aus den Akten dieses Anwalts"' : ''}>${focus.length ? focus.map(esc).join(' · ') : 'Alle Rechtsgebiete'}</p>
        ${duty ? `<span class="badge ${DUTY_BADGE[m.duty] || 'badge-slate'} kz-person-duty">${esc(duty[0])}</span>` : ''}
        <div class="kz-person-actions">${m.bookable ? `<button type="button" class="btn-outline kz-btn" data-wish="${Number(m.id)}" data-name="${esc(m.name)}">Mandat anfragen</button>` : '<span class="btn-outline kz-btn" aria-hidden="true">Profil ansehen</span>'}</div>
      </article>`;
  }
  /** Startseite: welche Anwälte (Startseite anpassen → Anwälte; data-mode/-count/-ids kommen vom Server). */
  function leadList(team, el) {
    const mode = el.dataset.mode || 'leitung';
    const count = Math.max(1, Number(el.dataset.count) || 3);
    const ids = String(el.dataset.ids || '').split(',').map(Number).filter(Boolean);
    let list;
    if (mode === 'auswahl') list = ids.map((id) => team.find((m) => m.id === id)).filter(Boolean);
    else if (mode === 'alle') list = team.slice();
    else if (mode === 'dienst') list = [...team].sort((a, b) => (b.duty === 'dienst') - (a.duty === 'dienst') || !!b.duty - !!a.duty);
    else list = team.filter((m) => m.tier === 'leitung');
    if (!list.length && mode !== 'auswahl') list = team.slice();
    return list.slice(0, count);
  }
  let lastTeam = [];
  let lastNews = [];
  function renderTeam(team) {
    const grid = document.getElementById('teamGrid');
    if (grid) {
      if (!team.length) grid.innerHTML = '<p class="kz-empty">Aktuell sind keine Anwälte hinterlegt.</p>';
      else {
        const groups = [
          ['Board of Partners', 'Leitende Gesellschafter', team.filter((m) => m.tier === 'leitung')],
          ['Associate Attorneys', 'Angestellte Anwaltschaft', team.filter((m) => m.tier !== 'leitung')],
        ].filter((g) => g[2].length);
        grid.innerHTML = groups
          .map(([t, sub, list]) => `<div class="kz-group-title"><h2 class="kz-h3">${t}</h2><span class="kz-rubric is-plain">${sub}</span></div><div class="kz-people">${list.map(personCard).join('')}</div>`)
          .join('');
      }
    }
    // Startseite: Ansprechpartner nach Einstellung (Standard: die Kanzleileitung, höchstens drei)
    const lead = document.getElementById('leadGrid');
    if (lead) {
      const list = leadList(team, lead);
      lead.dataset.n = String(list.length);
      if (list.length) lead.innerHTML = list.map(personCard).join('');
      else {
        lead.innerHTML = '<p class="kz-empty">Keine Anwälte ausgewählt.</p>';
        lead.closest('section').classList.add('hidden');
      }
    }
    // Rechtsgebiet: Anwälte, deren Schwerpunkte dieses Rechtsgebiet nennen
    const areaBox = document.getElementById('areaTeam');
    const areaName = (document.querySelector('.kz-pagehead .kz-h1') || {}).textContent;
    if (areaBox && areaName) {
      const key = areaName.trim().toLowerCase();
      const list = team.filter((m) => (m.focus || []).some((f) => f.toLowerCase().includes(key)));
      if (list.length) {
        areaBox.innerHTML = list.slice(0, 6).map(personCard).join('');
        document.getElementById('gebietTeam')?.classList.remove('hidden');
      }
    }
  }
  // „Direkt anfragen“: Mandatsformular mit diesem Anwalt als Wunschanwalt (die Karten werden nachgeladen)
  const onTeamClick = (e) => {
    // Zur Profilseite: Foto und Name dieser Karte gleiten an ihren Platz auf der Profilseite (View Transitions,
    // Gegenstück in views/anwalt.html) – ohne Unterstützung im Browser ganz normal
    const link = e.target.closest('a[href^="/team/"]');
    if (link && window.PS && !window.PS.motion.calm()) {
      // nur dieser Seitenwechsel bekommt den Übergang – andere (Login, Discord-Anmeldung …) laufen ganz normal
      if (!document.getElementById('vtTeam')) document.head.insertAdjacentHTML('beforeend', '<style id="vtTeam">@view-transition { navigation: auto; }</style>');
      document.querySelectorAll('.kz-person [style*="view-transition-name"]').forEach((n) => (n.style.viewTransitionName = ''));
      const card = link.closest('.team-card');
      const photo = card && card.querySelector('.kz-portrait > img, .kz-portrait > .kz-mono');
      const name = card && card.querySelector('.team-name');
      if (photo) photo.style.viewTransitionName = 'pf-photo';
      if (name) name.style.viewTransitionName = 'pf-name';
    }
    const btn = e.target.closest('[data-wish]');
    if (btn && typeof window.openTicketModal === 'function') window.openTicketModal('team', { id: Number(btn.dataset.wish), name: btn.dataset.name });
  };
  // Die ganze Karte ist der Link zum Profil (nur nicht der Knopf „Mandat anfragen“)
  const onCardClick = (e) => {
    if (e.defaultPrevented || e.target.closest('a, button, [data-wish]') || (window.getSelection && String(window.getSelection()))) return;
    const link = e.target.closest('.kz-person')?.querySelector('a.team-name');
    if (link) link.click();
  };
  for (const id of ['teamGrid', 'leadGrid', 'areaTeam']) {
    document.getElementById(id)?.addEventListener('click', onTeamClick);
    document.getElementById(id)?.addEventListener('click', onCardClick);
  }

  /* ---------------------------------------------------------------- Honorarordnung & Tarifrechner */
  function renderFees(fees, categories) {
    if (!fees.length) return; // statischer Inhalt der Seite bleibt als Rückfall bestehen
    // Kategorien aus der Honorarordnung (Einstellungen → Listen): Überschriften und Reiter; ohne Angabe die eingebauten
    const cats = categories && categories.length ? categories.map((c) => [c.key, c.name]) : FEE_CATEGORIES;
    const container = document.getElementById('priceListContainer');
    const allTab = document.querySelector('.tab-btn[data-cat="all"]');
    if (allTab && categories && categories.length) {
      const wasActive = document.querySelector('.tab-btn.active');
      allTab.parentElement.querySelectorAll('.tab-btn:not([data-cat="all"])').forEach((b) => b.remove());
      for (const [key, label] of cats) {
        // home.js hängt die Klick-Handler nur beim Laden an – neue Reiter bekommen ihren hier
        const b = document.createElement('button');
        b.className = 'tab-btn';
        b.dataset.act = 'category';
        b.dataset.cat = key;
        b.textContent = label;
        b.addEventListener('click', () => typeof window.setCategory === 'function' && window.setCategory(key));
        allTab.parentElement.appendChild(b);
      }
      const keep = wasActive && cats.some(([k]) => k === wasActive.dataset.cat) ? wasActive.dataset.cat : 'all';
      allTab.parentElement.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === keep));
    }
    if (container) {
      container.innerHTML = cats.map(([key, label]) => {
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
                <div class="num text-[var(--gold-500)] font-semibold text-lg whitespace-nowrap">${money(f.price)}</div>
              </div>`
              )
              .join('')}</div>
          </div>`;
      }).join('');
      container.querySelectorAll('.price-item').forEach((item, i) => (item.dataset.originalIndex = i));
      const active = document.querySelector('.tab-btn.active');
      if (typeof window.setCategory === 'function') window.setCategory(active ? active.dataset.cat : 'all');
      if (typeof window.sortPrices === 'function') window.sortPrices();
      if (typeof window.enhancePriceCategories === 'function') window.enhancePriceCategories(); // Kategorien auf-/zuklappbar
    }

    const calc = document.getElementById('calcOptions');
    const calcFees = fees.filter((f) => f.inCalculator);
    if (calc && calcFees.length) {
      calc.innerHTML = calcFees
        .map(
          (f) => `
        <label class="calc-opt">
          <span class="calc-opt-main min-w-0">
            <input type="checkbox" class="calc-check" value="${Number(f.price)}" data-name="${esc(f.name)}">
            <span class="calc-opt-name">${esc(f.name)}</span>
          </span>
          <span class="calc-opt-price">${money(f.price)}</span>
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
            <span class="text-[0.65rem] tabular-nums px-3 py-1 rounded-full uppercase font-semibold ${life ? 'bg-[rgba(212,175,55,0.15)] text-[var(--gold-light)] border border-[var(--gold-hairline)]' : 'bg-sky-500/10 text-sky-300 border border-sky-500/20'}">${life ? '👑 Lifetime' : '⭐ VIP'}</span>
            <span class="text-xs text-[var(--text-muted)] tabular-nums">${life ? 'unbefristet' : `${Number(t.durationDays)} Tage`}</span>
          </div>
          <h3 class="font-serif text-3xl font-semibold text-white mb-2">${esc(t.name)}</h3>
          <div class="num text-3xl text-[var(--gold-500)] font-semibold">${money(t.price)}</div>
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
    const target = `/dashboard?vip=${btn.dataset.vipTier}#vip-angebot`;
    if (me && me.role !== 'mandant') location.href = '/dashboard#vip'; // Team: Verwaltung im Dashboard
    else if (me) location.href = target;
    else location.href = '/login?next=' + encodeURIComponent(target);
  });

  /* ---------------------------------------------------------------- Verbindung zum Dashboard */
  const initials = (n) =>
    String(n || '?')
      .replace(/\b(Dr|Prof|jur|med|rer|nat)\.\s*/gi, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase();
  const goTo = (url) => (window.PS.go ? window.PS.go(url) : (location.href = url));

  /**
   * Angemeldet: ein Weg ins Dashboard, in der Kopfzeile. Der Knopf zeigt das eigene Profilbild statt des Personen-Symbols;
   * für die Kanzlei wird der goldene Knopf zu „Dashboard“ (sie reicht selbst keine Mandate ein), Mandanten behalten „Mandat“.
   * Die schmale Leiste oben zeigt dann nur noch Eilnotdienst und Kanzleisitz.
   */
  function renderSwitch() {
    const root = document.documentElement;
    root.classList.toggle('ps-in', !!me);
    root.classList.toggle('ps-team', !!me && me.role !== 'mandant');
    const top = document.querySelector('.topstrip [data-auth-link]');
    if (top) top.classList.toggle('hidden', !!me);
    document.querySelectorAll('header [data-auth-link], [data-hdr-dash]').forEach((a) => {
      a.querySelectorAll('.hdr-av').forEach((n) => n.remove());
      const ico = a.querySelector('svg');
      if (ico) ico.classList.toggle('hidden', !!me);
      if (!me) return;
      const av = document.createElement('span');
      av.className = 'site-avatar hdr-av';
      av.setAttribute('aria-hidden', 'true');
      avatarInto(av, me);
      a.prepend(av);
    });
    if (me) prefetchDashboard();
  }

  /** Profilbild (eigenes Foto oder Discord-Bild) – ohne Bild die Initialen auf Gold. */
  function avatarInto(el, u) {
    el.textContent = '';
    if (u.avatarUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = u.avatarUrl;
      img.addEventListener('error', () => {
        img.remove();
        el.classList.remove('has-photo');
        el.textContent = initials(u.displayName);
      });
      el.classList.add('has-photo');
      el.appendChild(img);
    } else el.textContent = initials(u.displayName);
  }
  /** Das Dashboard schon im Hintergrund laden – der Wechsel dauert dann kaum noch (gleiche Versionsnummer wie diese Seite). */
  function prefetchDashboard() {
    const v = new URL(document.querySelector('script[src*="/js/site.js"]')?.src || location.href, location.href).searchParams.get('v');
    if (v && !document.getElementById('dashPrefetch')) {
      const l = document.createElement('link');
      l.id = 'dashPrefetch';
      l.rel = 'prefetch';
      l.as = 'script';
      l.href = `/js/dashboard.bundle.js?v=${encodeURIComponent(v)}`;
      document.head.appendChild(l);
    }
  }

  /** Kanzleisitz aus den Einstellungen (dieselbe Angabe wie in Rechnungen und Terminen). */
  api.get('/api/public/firm').then((f) => {
    document.querySelectorAll('[data-firm-seat]').forEach((el) => (el.textContent = f.seat));
    document.querySelectorAll('[data-firm-place]').forEach((el) => (el.textContent = f.place));
  }).catch(() => {});

  /* ---------------------------------------------------------------- Anmelden auf der Startseite */
  const dlg = document.getElementById('loginDialog');
  let challenge = null;
  let loginDone = false; // im Dialog angemeldet
  function openLogin() {
    if (!dlg) return goTo('/login');
    // aus dem Handy-Menü heraus: das Menü schließt sich, das Fenster liegt dann frei
    if (document.getElementById('mobileMenu')?.classList.contains('open') && typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu();
    dlg.classList.remove('opacity-0', 'pointer-events-none');
    document.body.style.overflow = 'hidden';
    api.get('/api/discord/status').then((s) => s.oauth && document.getElementById('ldDiscord').classList.remove('hidden')).catch(() => {});
    // Cursor ins erste Feld – aber nie, wenn jemand schon schneller war und ein Feld im Dialog gewählt hat
    setTimeout(() => !dlg.contains(document.activeElement) && document.getElementById('ldEmail').focus(), 60);
  }
  function closeLogin() {
    if (!dlg) return;
    dlg.classList.add('opacity-0', 'pointer-events-none');
    document.body.style.overflow = '';
  }
  async function afterLogin() {
    const r = await api.get('/api/auth/session');
    me = r?.user ?? null;
    if (!me) throw new Error('Anmeldung nicht möglich.');
    loginDone = true;
    // Kanzlei und Konten mit Pflicht-Änderung gehören ins Dashboard – Mandanten bleiben hier
    if (me.role !== 'mandant' || me.mustChangePassword) return goTo('/dashboard');
    closeLogin();
    updateAuthNav();
    renderSwitch();
    showToast('Angemeldet', `Willkommen zurück, ${(me.displayName || '').split(' ')[0]}.`);
  }
  if (dlg) {
    document.querySelectorAll('[data-auth-link]').forEach((a) =>
      a.addEventListener('click', (e) => {
        if (me || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // angemeldet: ganz normal ins Dashboard
        e.preventDefault();
        e.stopPropagation();
        openLogin();
      }, true)
    );
    dlg.querySelector('[data-login-close]').addEventListener('click', closeLogin);
    dlg.addEventListener('click', (e) => e.target === dlg && closeLogin());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && !dlg.classList.contains('pointer-events-none') && closeLogin());
    document.getElementById('loginDialogForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('ldError');
      const btn = document.getElementById('ldSubmit');
      const email = document.getElementById('ldEmail').value.trim();
      const password = document.getElementById('ldPassword').value;
      err.textContent = '';
      if (!email || !password) return void (err.textContent = 'Bitte E-Mail und Passwort eingeben.');
      btn.disabled = true;
      try {
        const r = await api.post('/api/auth/login', { email, password });
        if (r.twoFactor) {
          challenge = r.twoFactor.challenge;
          document.getElementById('ldCodeTo').textContent = r.twoFactor.to || 'Ihr Discord';
          document.getElementById('loginDialogForm').classList.add('hidden');
          document.getElementById('ldAlt').classList.add('hidden');
          document.getElementById('loginCodeForm').classList.remove('hidden');
          document.getElementById('ldCode').focus();
        } else await afterLogin();
      } catch (ex) {
        err.textContent = ex.message;
        document.getElementById('ldPassword').select();
      } finally {
        btn.disabled = false;
      }
    });
    const codeForm = document.getElementById('loginCodeForm');
    let sending = false;
    const sendCode = async () => {
      const code = document.getElementById('ldCode').value.replace(/\D/g, '');
      const err = document.getElementById('ldCodeError');
      if (code.length !== 6) return void (err.textContent = 'Bitte den 6-stelligen Code eingeben.');
      if (sending) return;
      sending = true;
      err.textContent = '';
      try {
        await api.post('/api/auth/login/code', { challenge, code, trust: document.getElementById('ldTrust').checked });
        await afterLogin();
      } catch (ex) {
        err.textContent = ex.message;
        if (ex.status === 410) document.getElementById('ldCodeBack').click();
      } finally {
        sending = false;
      }
    };
    codeForm.addEventListener('submit', (e) => (e.preventDefault(), sendCode()));
    document.getElementById('ldCode').addEventListener('input', (e) => e.target.value.replace(/\D/g, '').length === 6 && sendCode());
    document.getElementById('ldCodeBack').addEventListener('click', () => {
      challenge = null;
      codeForm.classList.add('hidden');
      document.getElementById('loginDialogForm').classList.remove('hidden');
      document.getElementById('ldAlt').classList.remove('hidden');
      document.getElementById('ldPassword').value = '';
    });
  }

  /* ---------------------------------------------------------------- „Mandat einreichen“ – eine Quelle für Angemeldete */
  // Angemeldete Mandanten legen Mandate im Dashboard an (dort hängen sie am Konto, mit Dringlichkeit und Verlauf);
  // das Formular der Startseite bleibt für Besucher ohne Konto – und für Tarifrechner bzw. Wunschanwalt.
  const baseOpenTicket = window.openTicketModal;
  if (typeof baseOpenTicket === 'function') {
    window.openTicketModal = (source, lawyer) => {
      if (me && me.role === 'mandant' && !lawyer && source !== 'calc') return goTo('/dashboard?new=case');
      return baseOpenTicket(source, lawyer);
    };
  }

  /* ---------------------------------------------------------------- Start */
  // Angefangene Texte (Mandat, Anliegen, Antwort) bleiben auf diesem Gerät erhalten
  window.PS.drafts.watch({ scope: 'website' });

  // Ausgeschaltete Funktionen (Dashboard → Einstellungen → Rechte & Schalter) verschwinden von der Startseite
  const FEATURE_HIDE = {
    vip: ['#vip', 'a[href="#vip"]'],
    reviews: ['#stimmen', 'a[href="#stimmen"]'],
    karriere: ['#karriere', 'a[href="#karriere"]', 'a[href="/karriere"]'],
  };
  function applyFeatures(f) {
    if (!f) return;
    for (const [key, selectors] of Object.entries(FEATURE_HIDE)) {
      if (f[key] !== false) continue;
      document.querySelectorAll(selectors.join(',')).forEach((el) => (el.style.display = 'none'));
    }
  }
  window.PS.boot('session', '/api/auth/session')
    .then((r) => {
      if (!loginDone) me = r?.user ?? null; // eine späte Antwort darf die Anmeldung im Dialog nicht überschreiben
      applyFeatures(r && r.features);
    })
    .catch(() => {
      if (!loginDone) me = null;
    })
    .finally(() => {
      updateAuthNav();
      renderSwitch();
    });

  // Von einer Profilseite (/team/<name>): „Mandat anfragen“ → /?anwalt=<id> (Wunschanwalt) bzw. /?mandat=1 (ohne Konto)
  const wish = new URLSearchParams(location.search);
  const wishId = Number(wish.get('anwalt')) || 0;
  if (wishId || wish.has('mandat')) history.replaceState(null, '', location.pathname + location.hash);
  if (!wishId && wish.has('mandat') && typeof window.openTicketModal === 'function') window.openTicketModal('profile');
  // Nur laden, was auf dieser Unterseite gebraucht wird
  const has = (...ids) => ids.some((id) => document.getElementById(id));
  if (has('teamGrid', 'leadGrid', 'areaTeam') || wishId) window.PS.boot('team', '/api/team')
    .then((r) => {
      lastTeam = r.team || [];
      renderTeam(lastTeam);
      const m = wishId && (r.team || []).find((x) => x.id === wishId && x.bookable);
      if (wishId && typeof window.openTicketModal === 'function') window.openTicketModal('profile', m ? { id: m.id, name: m.name } : null);
    })
    .catch(() => {
      const grid = document.getElementById('teamGrid');
      if (grid) grid.innerHTML = '<p class="kz-empty">Die Anwälte konnten nicht geladen werden.</p>';
      document.getElementById('leadGrid')?.closest('section').classList.add('hidden');
    });

  if (has('priceListContainer', 'calcOptions')) window.PS.boot('fees', '/api/fees')
    .then((r) => renderFees(r.fees || [], r.categories))
    .catch(() => {});

  if (has('vipTiers')) window.PS.boot('memberships', '/api/public/memberships')
    .then((r) => renderVip(r.tiers || []))
    .catch(() => {
      const grid = document.getElementById('vipTiers');
      if (grid) grid.innerHTML = '<p class="md:col-span-3 text-center text-sm text-[var(--text-muted)] py-8">Angebote konnten nicht geladen werden.</p>';
    });

  /* ---------------------------------------------------------------- Erfolge (über den Mandantenstimmen) */
  // Abgeschlossene Verfahren, Erfolgsquote und Durchschnittsbewertung der Mandantenstimmen – vom Server, jeweils erst
  // ab einer Mindestanzahl. Abschaltbar unter Einstellungen → Website.
  const firmStats = { visible: false, closed: null, successRate: null, rating: null, ratingCount: 0 };
  function renderStats() {
    const box = document.getElementById('firmStats');
    if (!box) return;
    const cards = [];
    const kpi = window.PS.kpis || {}; // welche Kennzahlen öffentlich stehen (Dashboard → Einstellungen → Website → Startseite)
    if (firmStats.visible && firmStats.closed && kpi.closed !== false) cards.push([firmStats.closed.toLocaleString('de-DE'), 'Verfahren abgeschlossen']);
    if (firmStats.visible && firmStats.successRate != null && kpi.success !== false) cards.push([`${firmStats.successRate} %`, 'Erfolgsquote']);
    if (firmStats.visible && firmStats.rating && kpi.rating !== false) cards.push([`${firmStats.rating.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★`, `Ø aus ${firmStats.ratingCount} Bewertungen`]);
    box.classList.toggle('hidden', !cards.length);
    if (!cards.length) return;
    box.innerHTML = `
      <div class="stats-row grid gap-3 sm:gap-4 mx-auto" style="grid-template-columns:repeat(${cards.length},minmax(0,1fr));max-width:${cards.length * 15}rem">
        ${cards.map(([v, l]) => `<div class="glass-card px-3 py-5 sm:p-6 text-center"><div class="font-serif text-3xl sm:text-4xl font-semibold text-[var(--gold-light)] lining-nums" data-count="stat:${esc(l)}">${esc(v)}</div><div class="text-[0.62rem] sm:text-[0.68rem] uppercase tracking-widest text-[var(--text-muted)] mt-2 leading-snug">${esc(l)}</div></div>`).join('')}
      </div>
      ${firmStats.visible && firmStats.successRate != null ? '<p class="text-[0.7rem] text-center text-[var(--text-dim)] mt-3">Erfolgsquote: Freispruch, Einstellung, Strafmilderung, Vergleich oder gewonnen – reine Beratungen zählen nicht mit.</p>' : ''}`;
    window.PS.countUp(box, { whenVisible: true }); // Zahlen zählen hoch, sobald sie ins Bild scrollen
  }
  window.addEventListener('ps:kpis', renderStats);
  if (has('firmStats')) window.PS.boot('stats', '/api/public/stats')
    .then((d) => {
      Object.assign(firmStats, {
        visible: !!d.visible,
        closed: d.closed || null,
        successRate: d.successRate ?? null,
        rating: d.rating ? d.rating.avg : null,
        ratingCount: d.rating ? d.rating.count : 0,
      });
      renderStats();
    })
    .catch(() => {});

  /* ---------------------------------------------------------------- Mandantenstimmen */
  // Nur echte, vom Board freigegebene Bewertungen – ab drei Stück erscheint der Abschnitt, vorher bleibt er weg.
  const track = document.getElementById('testimonialTrack');
  if (track) {
    window.PS.boot('reviews', '/api/public/reviews')
      .then(({ reviews }) => {
        if (!reviews || reviews.length < 3) return;
        track.innerHTML = reviews
          .slice(0, 6)
          .map(
            (r) => `<figure class="kz-quote"><div class="kz-stars" aria-label="${r.rating} von 5 Sternen">${'★'.repeat(r.rating)}<span style="opacity:.25">${'★'.repeat(5 - r.rating)}</span></div>
              <blockquote>„${esc(r.body)}“</blockquote><figcaption>${esc(r.name)}${r.area ? ` · ${esc(r.area)}` : ''}</figcaption></figure>`
          )
          .join('');
        document.getElementById('stimmen')?.classList.remove('hidden');
      })
      .catch(() => {});
  }

  // Für „Startseite anpassen“ (sitecustom.js): Anwälte und Meldungen mit neuer Einstellung sofort neu zeichnen
  window.PS.site = {
    team: () => lastTeam,
    renderTeam: () => renderTeam(lastTeam),
    renderNews: () => {
      const teaser = document.getElementById('newsTeaser');
      if (teaser && lastNews.length) teaser.innerHTML = lastNews.slice(0, Math.max(1, Number(teaser.dataset.count) || 3)).map(newsCard).join('');
    },
  };
  // Eckdaten der Startseite: Zahlen zählen hoch, sobald sie ins Bild kommen
  if (document.getElementById('fakten')) window.PS.countUp(document.getElementById('fakten'), { whenVisible: true });

  /* ---------------------------------------------------------------- Aktuelles */
  const NEWS_KIND = { meldung: 'Meldung', team: 'Neu im Team', befoerderung: 'Beförderung', stelle: 'Stellenangebot' };
  const newsDate = (v) => {
    const d = new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  };
  const newsItem = (n) => `<li${n.pinned ? ' class="is-pinned"' : ''}><div><time>${esc(newsDate(n.at))}</time><span class="kz-news-kind">${esc(NEWS_KIND[n.kind] || 'Meldung')}</span></div>
      <div><h3>${esc(n.title)}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ''}${n.link ? `<a class="kz-link mt-3" href="${esc(n.link)}">Mehr erfahren</a>` : ''}</div></li>`;
  // Startseite: die neuesten Meldungen als Karten (Art, Datum, Titel, ein Satz)
  const newsCard = (n) => {
    const title = n.link ? `<a href="${esc(n.link)}">${esc(n.title)}</a>` : esc(n.title);
    return `<li class="kz-news-card${n.pinned ? ' is-pinned' : ''}"><div class="kz-news-meta"><span class="badge badge-gold">${esc(NEWS_KIND[n.kind] || 'Meldung')}</span><time>${esc(newsDate(n.at))}</time></div>
      <h3>${title}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ''}</li>`;
  };
  if (has('newsList', 'newsTeaser'))
    window.PS.boot('news', '/api/public/news')
      .then(({ news }) => {
        const list = document.getElementById('newsList');
        if (list) list.innerHTML = news.length ? news.map(newsItem).join('') : '<li class="kz-empty">Derzeit keine Meldungen.</li>';
        lastNews = news;
        const teaser = document.getElementById('newsTeaser');
        if (teaser && news.length) {
          teaser.innerHTML = news.slice(0, Math.max(1, Number(teaser.dataset.count) || 3)).map(newsCard).join('');
          document.getElementById('neuigkeiten')?.classList.remove('hidden');
        }
      })
      .catch(() => {
        const list = document.getElementById('newsList');
        if (list) list.innerHTML = '<li class="kz-empty">Meldungen konnten nicht geladen werden.</li>';
      });

  /* ---------------------------------------------------------------- Verfahrensstand (Aktenzeichen + Pin) */
  const statusForm = document.getElementById('statusForm');
  if (statusForm) {
    const out = document.getElementById('stResult');
    const err = document.getElementById('stError');
    const fmt = (v) => (v ? newsDate(v) : '–');
    statusForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const number = document.getElementById('stNumber').value.trim().toUpperCase();
      const pin = document.getElementById('stPin').value.replace(/\D/g, '');
      err.classList.add('hidden');
      if (!number || pin.length < 4) {
        err.textContent = 'Bitte Aktenzeichen und Pin eingeben.';
        err.classList.remove('hidden');
        return;
      }
      const btn = statusForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const c = await api.post('/api/public/case-status', { number, pin });
        out.innerHTML = `<div class="kz-panel">
            <span class="kz-rubric is-plain">${esc(c.area)}</span>
            <h2 class="kz-h3 mt-2">Akte ${esc(c.caseNumber)}</h2>
            <ol class="kz-progress">${c.steps.map((st, i) => `<li class="${i < c.step ? 'is-done' : i === c.step ? 'is-now' : ''}">${esc(st)}</li>`).join('')}</ol>
            <dl class="kz-dl">
              <dt>Status</dt><dd>${esc(c.statusLabel)}</dd>
              <dt>Aktueller Schritt</dt><dd>${esc(c.steps[c.step] || '')}</dd>
              <dt>Zuständig</dt><dd>${esc(c.lawyer || 'wird gerade zugeteilt')}</dd>
              <dt>Eingegangen</dt><dd>${esc(fmt(c.openedAt))}</dd>
              <dt>Zuletzt geändert</dt><dd>${esc(fmt(c.updatedAt))}</dd>
            </dl>
            ${c.note ? `<p class="mt-5"><span class="kz-rubric is-plain">Hinweis der Kanzlei</span><br><span class="kz-ink">${esc(c.note)}</span></p>` : ''}
          </div>`;
      } catch (ex) {
        out.innerHTML = '';
        err.textContent = (ex && ex.message) || 'Abfrage fehlgeschlagen.';
        err.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------------------------------------------------------------- Eilnotdienst live */
  function renderDuty(d) {
    if (!d || !d.visible) return; // Anzeige abgeschaltet: die festen Texte bleiben
    const on = d.count > 0;
    const label = document.getElementById('dutyLabel');
    if (label) {
      label.textContent = on ? `Notdienst: ${d.count} ${d.count === 1 ? 'Anwalt' : 'Anwälte'} im Dienst` : 'Notdienst: Anfrage per Mandat';
      label.title = d.members.map((m) => `${m.name} – ${m.statusLabel}`).join('\n');
    }
    document.querySelectorAll('#dutyDot, [data-duty-dot]').forEach((dot) => dot.classList.toggle('is-off', !on));
    const fact = document.getElementById('factDuty');
    if (fact) fact.textContent = on ? `${d.count} ${d.count === 1 ? 'Anwalt' : 'Anwälte'} im Dienst` : 'Anfrage per Mandat';
    const foot = document.getElementById('footDuty');
    if (foot) foot.textContent = on ? `${d.count} ${d.count === 1 ? 'Anwalt' : 'Anwälte'} im Dienst` : 'Anfrage per Mandat';
    const factSub = document.getElementById('factDutySub');
    if (factSub) factSub.textContent = on ? 'jetzt erreichbar' : 'Anfrage geht an alle Anwälte';
    const now = document.getElementById('dutyNow');
    if (now) {
      now.textContent = on ? `${d.count} ${d.count === 1 ? 'Anwalt' : 'Anwälte'} im Dienst` : 'Gerade niemand im Dienst';
      document.getElementById('dutyNowText').textContent = on
        ? 'Ihre Notfall-Anfrage geht sofort an die Anwälte im Dienst.'
        : 'Ihre Anfrage geht trotzdem an alle Anwälte – wer zuerst im Dienst ist, übernimmt.';
      const list = document.getElementById('dutyList');
      list.innerHTML = d.members.map((m) => `<li><span class="kz-ink">${esc(m.name)}</span><span>${esc([m.rank, m.statusLabel].filter(Boolean).join(' · '))}</span></li>`).join('');
      list.classList.toggle('hidden', !on);
    }
  }
  const loadDuty = () => api.get('/api/public/on-duty').then(renderDuty).catch(() => {});
  window.PS.boot('duty', '/api/public/on-duty').then(renderDuty).catch(() => {});
  setInterval(() => {
    if (!document.hidden) loadDuty();
  }, 60000);

  /* ---------------------------------------------------------------- Karriere */
  window.PS.boot('positions', '/api/public/positions')
    .then(({ positions }) => {
      const el = document.getElementById('careerCount');
      if (!el || !positions.length) return;
      el.textContent = `● ${positions.length} ${positions.length === 1 ? 'offene Stelle' : 'offene Stellen'}: ${positions.map((p) => p.title).join(' · ')}`;
      el.classList.remove('hidden');
    })
    .catch(() => {});
  // Auf diesem Gerät beworben: „Meine Bewerbung“ führt direkt zur Bewerberseite, darüber Stand und neue Nachrichten
  if (window.PS.applications.list().length) {
    const mine = window.PS.applications.list();
    const btn = document.getElementById('careerStatus');
    if (btn) {
      btn.textContent = 'Meine Bewerbung';
      btn.href = mine.length === 1 ? `/bewerbung#${encodeURIComponent(mine[0].token)}` : '/karriere#meine';
    }
    window.PS.applications
      .summary()
      .then((list) => {
        const el = document.getElementById('careerMine');
        if (!el || !list.length) return;
        const a = list[0];
        const unread = a.unread ? ` · <span class="text-[var(--gold-light)]">${a.unread === 1 ? '1 neue Nachricht' : `${a.unread} neue Nachrichten`}</span>` : '';
        el.innerHTML = `Ihre Bewerbung <span class="text-[var(--gold-light)]">${esc(a.number)}</span>: ${esc(a.statusLabel)}${unread}${list.length > 1 ? ` <span class="text-[var(--text-dim)]">(+${list.length - 1} weitere)</span>` : ''}`;
        el.classList.remove('hidden');
      })
      .catch(() => {});
  }

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

  // Anliegen auf diesem Gerät merken: dann genügt ein Klick statt Vorgangsnummer und Pin einzutippen
  const CONCERN_STORE = 'ps.anliegen';
  function savedConcerns() {
    try {
      const list = JSON.parse(localStorage.getItem(CONCERN_STORE) || '[]');
      return Array.isArray(list) ? list.filter((x) => x && typeof x.reference === 'string' && typeof x.pin === 'string') : [];
    } catch {
      return [];
    }
  }
  function saveConcern(entry) {
    try {
      localStorage.setItem(CONCERN_STORE, JSON.stringify([entry, ...savedConcerns().filter((x) => x.reference !== entry.reference)].slice(0, 5)));
    } catch {
      /* ohne Speicher bleibt es bei Vorgangsnummer + Pin */
    }
  }
  function renderSavedConcerns() {
    const box = document.getElementById('concernSaved');
    const list = savedConcerns();
    box.classList.toggle('hidden', !list.length);
    box.innerHTML = list.length
      ? `<div class="text-[0.7rem] uppercase tracking-widest text-[var(--text-dim)] mb-2">Auf diesem Gerät</div><div class="flex flex-col gap-2">${list
          .map((x) => `<button type="button" class="btn-outline w-full py-2.5 px-4 text-left flex items-center justify-between gap-3" data-saved-concern="${esc(x.reference)}"><span class="tabular-nums text-sm">${esc(x.reference)}</span><span class="text-xs text-[var(--text-dim)] truncate">${esc(x.subject || '')}</span></button>`)
          .join('')}</div>`
      : '';
  }
  function openSavedConcern(reference) {
    const x = savedConcerns().find((c) => c.reference === reference);
    if (!x) return;
    document.getElementById('clRef').value = x.reference;
    document.getElementById('clPin').value = x.pin;
    lookupConcern();
  }
  document.getElementById('concernSaved').addEventListener('click', (e) => {
    const b = e.target.closest('[data-saved-concern]');
    if (b) openSavedConcern(b.dataset.savedConcern);
  });

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
    if (tab === 'status') {
      renderSavedConcerns();
      // Nur ein Anliegen auf diesem Gerät: gleich öffnen
      const list = savedConcerns();
      if (list.length === 1 && !concernAccess) openSavedConcern(list[0].reference);
    }
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
  // Klick daneben schließt (Eingaben bleiben erhalten) – nur nicht die Bestätigung mit Vorgangsnummer und Pin
  let concernPressOutside = false;
  concernModal.addEventListener('pointerdown', (e) => (concernPressOutside = e.target === concernModal));
  concernModal.addEventListener('click', (e) => {
    if (e.target !== concernModal || !concernPressOutside) return;
    if (document.getElementById('concernSuccess').getClientRects().length > 0) window.nudgeDialog?.(concernModal.firstElementChild);
    else window.closeConcernModal();
  });
  document.querySelectorAll('[data-concern-tab]').forEach((b) => b.addEventListener('click', () => concernTab(b.dataset.concernTab)));
  document.getElementById('cfAnon').addEventListener('change', syncConcernPersonal);

  function showConcernSuccess(res) {
    if (!res.linkedToAccount) saveConcern({ reference: res.reference, pin: res.pin, subject: document.getElementById('cfSubject')?.value.trim() || '' });
    const box = document.getElementById('concernSuccess');
    const text = `Vorgangsnummer: ${res.reference}\nPin: ${res.pin}`;
    box.innerHTML = `
      <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
      <h3 class="font-serif text-2xl font-semibold text-white text-center mb-2">Anliegen übermittelt</h3>
      <p class="text-sm text-[var(--text-muted)] text-center mb-5">Das Board of Partners wurde benachrichtigt und meldet sich.${res.linkedToAccount ? ' Sie finden das Anliegen auch in Ihrem Dashboard.' : ''}</p>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Vorgangsnummer</div><div class="tabular-nums text-lg text-[var(--gold-light)]">${esc(res.reference)}</div></div>
        <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3 text-center"><div class="text-[0.6rem] uppercase tracking-widest text-[var(--text-muted)]">Pin</div><div class="tabular-nums text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.pin)}</div></div>
      </div>
      <p class="text-xs text-amber-300/90 text-center mb-5">${res.linkedToAccount ? 'Bitte notieren Sie beide Angaben – damit lesen Sie jederzeit die Antwort des Boards.' : 'Auf diesem Gerät ist Ihr Anliegen gespeichert – unter „Meine Anliegen“ genügt ein Klick. Für andere Geräte bitte beide Angaben notieren.'}</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <button type="button" id="concernCopy" class="btn-outline flex-1 py-3 text-xs uppercase tracking-wider">Daten kopieren</button>
        ${res.linkedToAccount
          ? '<a href="/dashboard#concerns" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider text-center">Im Dashboard ansehen</a>'
          : '<button type="button" id="concernCheck" class="btn-gold flex-1 py-3 text-xs uppercase tracking-wider">Anliegen ansehen</button>'}
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
    clearFieldErrors(form);
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
      if (data.name.length < 2) return fieldError(form.elements.name, 'Bitte Ihren Namen angeben – oder anonym einreichen.');
    }
    if (data.subject.length < 3) return fieldError(form.elements.subject, 'Bitte einen Betreff angeben (mind. 3 Zeichen).');
    if (data.body.length < 10) return fieldError(form.elements.body, `Bitte beschreiben Sie Ihr Anliegen (mind. 10 Zeichen, aktuell ${data.body.length}).`);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.post('/api/public/concerns', data);
      window.PS.drafts.clear(form);
      form.reset();
      syncConcernPersonal();
      showConcernSuccess(res);
    } catch (err) {
      if (!fieldErrors(form, err)) showToast('Das hat nicht geklappt', err.message);
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
      : `<form id="concernReply" class="mt-4 space-y-3" data-ref="${esc(concernAccess ? concernAccess.reference : '')}">
          <label for="crText" class="block text-xs uppercase tracking-wider text-[var(--text-muted)]">Nachricht an das Board</label>
          <textarea id="crText" rows="3" maxlength="5000" required class="w-full bg-slate-900/80 border border-[var(--glass-border)] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--gold-500)]"></textarea>
          <button type="submit" class="btn-outline w-full py-2.5 text-xs uppercase tracking-wider disabled:opacity-60">Nachricht senden</button>
        </form>`;
    document.getElementById('concernResult').innerHTML = `
      <div class="rounded-xl border border-[var(--glass-border)] bg-slate-900/40 p-4 mb-4">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="min-w-0"><div class="tabular-nums text-xs text-[var(--gold-light)]">${esc(d.reference)}</div><div class="font-serif text-xl text-white break-words">${esc(d.subject)}</div></div>
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
        window.PS.drafts.clear(e.target);
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
      saveConcern({ reference, pin, subject: d.subject || '' });
      renderSavedConcerns();
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
