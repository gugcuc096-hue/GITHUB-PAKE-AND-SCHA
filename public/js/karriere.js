/* Karriereseite (karriere.html): Stellen, Bewerbung, Zugang zur persönlichen Bewerberseite – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    'use strict';
    const { api, esc, copy, toast } = window.PS;
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
                return `<a class="glass-card my-app" href="/bewerbung.html#${encodeURIComponent(a.token)}">
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
        document.querySelectorAll('[data-my-link]').forEach((a) => (a.href = list.length === 1 ? `/bewerbung.html#${encodeURIComponent(list[0].token)}` : '#meine'));
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
    api.get('/api/auth/session').then((r) => {
        if (!r || !r.user) return;
        document.querySelectorAll('[data-auth-link]').forEach((a) => (a.href = '/dashboard.html'));
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
    api.get('/api/public/positions').then(({ positions }) => {
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
        if (body.name.length < 2) return (err.textContent = 'Bitte Ihren Namen angeben.');
        if (age && (!Number.isInteger(body.age) || body.age < 16 || body.age > 99)) return (err.textContent = 'Bitte ein Alter zwischen 16 und 99 angeben.');
        if (body.discord.length < 2) return (err.textContent = 'Bitte Ihren Discord-Namen angeben – so erreichen wir Sie.');
        if (body.motivation.length < 50) return (err.textContent = 'Bitte schreiben Sie mindestens 50 Zeichen zu Ihrer Motivation.');
        if (!body.accept) return (err.textContent = 'Bitte bestätigen Sie die Angaben.');

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
            box.innerHTML = `
                <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
                <h3 class="font-serif text-3xl font-semibold mb-2">Vielen Dank für Ihre Bewerbung!</h3>
                <p class="text-sm text-muted mb-6">Ihre Bewerbung als <strong>${esc(res.positionTitle)}</strong> ist eingegangen. Auf Ihrer persönlichen Bewerberseite sehen Sie den Stand und schreiben direkt mit dem Board of Partners.</p>
                <div class="grid grid-cols-2 gap-3 mb-3 max-w-md mx-auto">
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Bewerbungsnummer</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.number)}</div></div>
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Zugangscode</div><div class="font-mono text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.code)}</div></div>
                </div>
                <p class="text-xs text-amber-300/90 mb-6">Die Bewerberseite ist auf diesem Gerät gespeichert. Bitte notieren Sie trotzdem beide Angaben – damit öffnen Sie sie auch auf jedem anderen Gerät.</p>
                <div class="flex flex-col sm:flex-row justify-center gap-2">
                    <button type="button" id="copyApply" class="btn-outline btn-md">Daten kopieren</button>
                    <a href="${esc(res.portal)}" id="checkApply" class="btn-gold btn-md">Zur Bewerberseite</a>
                </div>`;
            box.classList.remove('hidden');
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('copyApply').addEventListener('click', async () => {
                toast((await copy(text)) ? 'Bewerbungsdaten kopiert.' : 'Bitte die Angaben notieren.');
            });
        } catch (ex) {
            err.textContent = ex.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Bewerbung absenden';
        }
    });

    // Bewerbungsnummer + Zugangscode → persönliche Bewerberseite
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
