/* Karriereseite (karriere.html): Stellen, Bewerbung, Zugang zur persönlichen Bewerberseite – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    'use strict';
    const { api, esc, copy, toast, fieldError, fieldErrors, clearFieldErrors } = window.PS;
    const DISCORD_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.1.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
    const STORE = 'ps.bewerbungen'; // persönliche Links der Bewerbungen auf diesem Gerät (siehe bewerbung.js, PS.applications)
    function remember(entry) {
        try {
            localStorage.setItem(STORE, JSON.stringify([entry, ...window.PS.applications.list().filter((x) => x.token !== entry.token)].slice(0, 5)));
        } catch {
            /* ohne Speicher funktioniert der Link trotzdem */
        }
    }

    /* Handy-Menü: erst zuklappen, dann zum Abschnitt springen (sonst landet man um die Menühöhe zu tief) */
    const menu = document.getElementById('karMenu');
    const menuBtn = document.getElementById('karMenuBtn');
    function setMenu(open) {
        menu.classList.toggle('open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        document.getElementById('karMenuOpen').classList.toggle('hidden', open);
        document.getElementById('karMenuClose').classList.toggle('hidden', !open);
    }
    menuBtn.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
    menu.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#"]');
        if (!link) return setMenu(false);
        const target = document.querySelector(link.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        setMenu(false);
        let done = false;
        const jump = () => {
            if (done) return;
            done = true;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.pushState(null, '', link.getAttribute('href'));
        };
        menu.addEventListener('transitionend', jump, { once: true });
        setTimeout(jump, 450); // ohne Übergang (z. B. reduzierte Bewegung)
    });

    /* Bereits beworben (auf diesem Gerät): oben direkt zur Bewerberseite – mit Stand und neuen Nachrichten */
    const STATUS_COLOR = { eingegangen: 'amber', in_pruefung: 'sky', gespraech: 'gold', angenommen: 'emerald', abgelehnt: 'red' };
    const ARROW = '<svg class="go w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
    function myApplicationsHtml(list) {
        return `<p class="text-xs uppercase tracking-widest text-dim mb-3">${list.length === 1 ? 'Ihre Bewerbung' : 'Ihre Bewerbungen'} auf diesem Gerät</p>${list
            .map((a) => {
                const status = a.statusLabel ? `<span class="badge badge-${STATUS_COLOR[a.status] || 'slate'}">${esc(a.statusLabel)}</span>` : '';
                const unread = a.unread ? `<span class="badge badge-gold">${a.unread === 1 ? '1 neue Nachricht' : `${a.unread} neue Nachrichten`}</span>` : '';
                return `<a class="glass-card my-app" href="/bewerbung#${encodeURIComponent(a.token)}">
                    <span class="min-w-0"><span class="block font-mono text-[var(--gold-light)]">${esc(a.number || 'Bewerbung')}</span><span class="block text-sm text-muted truncate">${esc(a.positionTitle || a.position || '')}</span></span>
                    <span class="right flex items-center gap-2 shrink-0">${status}${unread}${status || unread ? '' : '<span class="text-sm text-muted">Stand ansehen</span>'}${ARROW}</span>
                </a>`;
            })
            .join('')}`;
    }
    function showMine(list) {
        const box = document.getElementById('meine');
        if (!list.length) {
            box.classList.add('hidden');
            return;
        }
        box.innerHTML = myApplicationsHtml(list);
        box.classList.remove('hidden');
        // „Meine Bewerbung“ oben im Menü: eine Bewerbung → direkt zur Bewerberseite, mehrere → zur Liste oben
        document.querySelectorAll('[data-my-link]').forEach((a) => (a.href = list.length === 1 ? `/bewerbung#${encodeURIComponent(list[0].token)}` : '#meine'));
    }
    const mine = window.PS.applications.list();
    if (mine.length) {
        showMine(mine);
        window.PS.applications.summary().then(showMine).catch(() => {});
    }
    const form = document.getElementById('applyForm');
    const select = document.getElementById('apPosition');
    document.getElementById('year').textContent = new Date().getFullYear();

    // Login / Dashboard
    window.PS.boot('session', '/api/auth/session').then((r) => {
        if (!r || !r.user) return;
        document.querySelectorAll('[data-auth-link]').forEach((a) => (a.href = '/dashboard'));
        document.querySelectorAll('[data-auth-label]').forEach((el) => (el.textContent = 'Dashboard'));
    }).catch(() => {});

    function choosePosition(id) {
        select.value = id ? String(id) : '';
        document.getElementById('bewerben').scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => document.getElementById('apName').focus({ preventScroll: true }), 500);
    }
    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-apply]');
        if (!el) return;
        e.preventDefault();
        choosePosition(el.dataset.apply);
    });

    // Offene Stellen – drei nebeneinander, wenn es aufgeht (sonst zwei bzw. eine mittig), damit keine Lücke bleibt
    window.PS.boot('positions', '/api/public/positions').then(({ positions }) => {
        const root = document.getElementById('positions');
        select.innerHTML = positions.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('') + '<option value="">Initiativbewerbung</option>';
        const wanted = Number(new URLSearchParams(location.search).get('stelle'));
        if (wanted && positions.some((p) => p.id === wanted)) select.value = String(wanted);
        if (positions.length) {
            const fact = document.getElementById('factPositions');
            fact.querySelector('span').textContent = positions.length === 1 ? '1 offene Stelle' : `${positions.length} offene Stellen`;
            fact.classList.remove('hidden');
        }
        const n = positions.length;
        root.className = `grid grid-cols-1 gap-4 md:gap-6 ${n === 1 ? 'max-w-xl mx-auto' : n % 3 === 0 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2'}`;
        if (!n) {
            root.className = 'grid grid-cols-1 max-w-2xl mx-auto';
            root.innerHTML = `<div class="glass-card p-8 text-center"><p class="text-muted mb-4">Aktuell sind keine Stellen ausgeschrieben – wir freuen uns trotzdem über Ihre Initiativbewerbung.</p><button class="btn-gold btn-md" data-apply="">Initiativ bewerben</button></div>`;
            return;
        }
        root.innerHTML = positions.map((p) => `
            <article class="glass-card pos-card p-6 flex flex-col">
                <div class="flex items-start justify-between gap-3 mb-3"><h3 class="font-serif text-2xl font-semibold leading-tight">${esc(p.title)}</h3><span class="badge badge-emerald shrink-0">Offen</span></div>
                ${p.description ? `<p class="text-sm text-muted leading-relaxed mb-4">${esc(p.description)}</p>` : ''}
                ${p.requirements ? `<div class="qa mb-5"><div class="q">Das bringen Sie mit</div><div class="a">${esc(p.requirements)}</div></div>` : ''}
                <button type="button" class="btn-gold btn-md mt-auto w-full" data-apply="${p.id}">Jetzt bewerben</button>
            </article>`).join('');
    }).catch(() => {
        document.getElementById('positions').innerHTML = '<p class="md:col-span-2 text-center text-sm text-muted py-8">Stellen konnten nicht geladen werden.</p>';
    });

    // Zeichenzähler Motivation
    const mot = document.getElementById('apMotivation');
    const counter = document.getElementById('motCounter');
    mot.addEventListener('input', () => {
        const n = mot.value.trim().length;
        counter.textContent = n >= 50 ? `${n} Zeichen ✓` : `${n} / mind. 50 Zeichen`;
        counter.classList.toggle('ok', n >= 50);
    });

    // Bewerbung absenden
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('applyError');
        const btn = document.getElementById('applyBtn');
        err.textContent = '';
        const f = form.elements;
        const age = f.age.value.trim();
        const body = {
            positionId: f.positionId.value ? Number(f.positionId.value) : null,
            name: f.name.value.trim(),
            age: age ? Number(age) : null,
            discord: f.discord.value.trim(),
            phone: f.phone.value.trim(),
            email: f.email.value.trim(),
            motivation: f.motivation.value.trim(),
            experience: f.experience.value.trim(),
            availability: f.availability.value.trim(),
            accept: f.accept.checked,
            website: f.website.value,
        };
        clearFieldErrors(form);
        if (body.name.length < 2) return fieldError(f.name, 'Bitte Ihren Namen angeben.');
        if (age && (!Number.isInteger(body.age) || body.age < 16 || body.age > 99)) return fieldError(f.age, 'Bitte ein Alter zwischen 16 und 99 angeben.');
        if (body.discord.length < 2) return fieldError(f.discord, 'Bitte Ihren Discord-Namen angeben – so erreichen wir Sie.');
        if (body.motivation.length < 50) return fieldError(f.motivation, `Bitte mindestens 50 Zeichen zu Ihrer Motivation (aktuell ${body.motivation.length}).`);
        if (!body.accept) return fieldError(f.accept, 'Bitte bestätigen Sie die Angaben.');

        btn.disabled = true;
        btn.textContent = 'Wird gesendet …';
        try {
            const res = await api.post('/api/public/applications', body);
            window.PS.drafts.clear(form);
            form.classList.add('hidden');
            const box = document.getElementById('applySuccess');
            const portal = `${location.origin}${res.portal}`;
            remember({ token: res.token, number: res.number, position: res.positionTitle });
            showMine(window.PS.applications.list());
            const text = `Bewerbungsnummer: ${res.number}\nZugangscode: ${res.code}\nBewerberseite: ${portal}`;
            // Mit Discord: Der Bot schickt den Link zur Bewerberseite per DM – kein Zugangscode nötig
            const access = res.discord
                ? `<p class="text-xs text-dim mb-4">Bewerbungsnummer <span class="font-mono text-[var(--gold-light)]">${esc(res.number)}</span></p>
                <div class="rounded-xl border border-[rgba(88,101,242,0.45)] bg-[rgba(88,101,242,0.1)] p-4 mb-6 max-w-md mx-auto text-left">
                    <div class="font-semibold mb-1">Jetzt Discord verbinden</div>
                    <p class="text-sm text-muted">Der Kanzlei-Bot schickt Ihnen den Link zu Ihrer Bewerberseite per Direktnachricht – damit öffnen Sie sie auf jedem Gerät. Antworten und neue Stände kommen ebenfalls dorthin. Auf diesem Gerät ist die Bewerbung schon gespeichert.</p>
                </div>
                <div class="flex flex-col sm:flex-row justify-center gap-2">
                    <button type="button" id="joinApply" class="btn-discord btn-md">${DISCORD_SVG}<span>Discord verbinden</span></button>
                    <a href="${esc(res.portal)}" id="checkApply" class="btn-outline btn-md">Zur Bewerberseite</a>
                </div>`
                : `<div class="grid grid-cols-2 gap-3 mb-3 max-w-md mx-auto">
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Bewerbungsnummer</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.number)}</div></div>
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Zugangscode</div><div class="font-mono text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.code)}</div></div>
                </div>
                <p class="text-xs text-amber-300/90 mb-6">Die Bewerberseite ist auf diesem Gerät gespeichert. Bitte notieren Sie trotzdem beide Angaben – damit öffnen Sie sie auch auf jedem anderen Gerät.</p>
                <div class="flex flex-col sm:flex-row justify-center gap-2">
                    <button type="button" id="copyApply" class="btn-outline btn-md">Daten kopieren</button>
                    <a href="${esc(res.portal)}" id="checkApply" class="btn-gold btn-md">Zur Bewerberseite</a>
                </div>`;
            box.innerHTML = `
                <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
                <h3 class="font-serif text-3xl font-semibold mb-2">Vielen Dank für Ihre Bewerbung!</h3>
                <p class="text-sm text-muted ${res.discord ? 'mb-2' : 'mb-6'}">Ihre Bewerbung als <strong>${esc(res.positionTitle)}</strong> ist eingegangen. Auf Ihrer persönlichen Bewerberseite sehen Sie den Stand und schreiben direkt mit dem Board of Partners.</p>
                ${access}`;
            box.classList.remove('hidden');
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('copyApply')?.addEventListener('click', async () => {
                toast((await copy(text)) ? 'Bewerbungsdaten kopiert.' : 'Bitte die Angaben notieren.');
            });
            document.getElementById('joinApply')?.addEventListener('click', () => {
                const f = document.getElementById('discordJoinForm');
                f.elements.token.value = res.token;
                f.submit();
            });
        } catch (ex) {
            if (!fieldErrors(form, ex)) err.textContent = ex.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Bewerbung absenden';
        }
    });

    // Andere Geräte: „Mit Discord öffnen“ – Nummer + Zugangscode nur, solange die Discord-Anmeldung fehlt
    api.get('/api/discord/status')
        .then((st) => {
            if (st.oauth) return;
            document.getElementById('statusDiscord').classList.add('hidden');
            document.getElementById('statusForm').classList.replace('hidden', 'flex');
        })
        .catch(() => {});

    // Bewerbungsnummer + Zugangscode → persönliche Bewerberseite (Notlösung ohne Discord)
    async function checkStatus() {
        const out = document.getElementById('statusResult');
        const number = document.getElementById('stNumber').value.trim().toUpperCase();
        const code = document.getElementById('stCode').value.trim();
        if (!number || !code) {
            out.innerHTML = '<p class="form-error">Bitte Bewerbungsnummer und Zugangscode eingeben.</p>';
            return;
        }
        try {
            const r = await api.post('/api/public/application-access', { number, code });
            out.innerHTML = '<p class="text-sm text-muted">Ihre Bewerberseite wird geöffnet …</p>';
            location.href = r.portal;
        } catch (ex) {
            out.innerHTML = `<p class="form-error">${esc(ex.status === 429 ? ex.message : 'Keine Bewerbung mit diesen Angaben gefunden.')}</p>`;
        }
    }
    document.getElementById('statusForm').addEventListener('submit', (e) => {
        e.preventDefault();
        checkStatus();
    });
    // Angefangene Bewerbung bleibt auf diesem Gerät erhalten
    window.PS.drafts.watch({ scope: 'website' });
})();
