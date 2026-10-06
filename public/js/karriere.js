/* Karriereseite (karriere.html): Stellen, Bewerbung, Statusabfrage – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    'use strict';
    const { api, esc, fmtDate, copy, toast } = window.PS;
    const STATUS_COLOR = { eingegangen: 'amber', in_pruefung: 'sky', gespraech: 'gold', angenommen: 'emerald', abgelehnt: 'red' };
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

    // Offene Stellen
    api.get('/api/public/positions').then(({ positions }) => {
        const root = document.getElementById('positions');
        select.innerHTML = positions.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('') + '<option value="">Initiativbewerbung</option>';
        const wanted = Number(new URLSearchParams(location.search).get('stelle'));
        if (wanted && positions.some((p) => p.id === wanted)) select.value = String(wanted);
        if (!positions.length) {
            root.innerHTML = `<div class="md:col-span-2 glass-card p-8 text-center"><p class="text-muted mb-4">Aktuell sind keine Stellen ausgeschrieben – wir freuen uns trotzdem über Ihre Initiativbewerbung.</p><button class="btn-gold btn-md" data-apply="">Initiativ bewerben</button></div>`;
            return;
        }
        root.innerHTML = positions.map((p) => `
            <article class="glass-card pos-card p-6 flex flex-col">
                <div class="flex items-start justify-between gap-3 mb-3"><h3 class="font-serif text-2xl font-semibold leading-tight">${esc(p.title)}</h3><span class="badge badge-emerald shrink-0">Offen</span></div>
                ${p.description ? `<p class="text-sm text-muted leading-relaxed mb-4">${esc(p.description)}</p>` : ''}
                ${p.requirements ? `<div class="qa mb-5"><div class="q">Das bringen Sie mit</div><div class="a">${esc(p.requirements)}</div></div>` : ''}
                <button type="button" class="btn-gold btn-md mt-auto self-start" data-apply="${p.id}">Jetzt bewerben</button>
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
            form.classList.add('hidden');
            const box = document.getElementById('applySuccess');
            const text = `Bewerbungsnummer: ${res.number}\nZugangscode: ${res.code}`;
            box.innerHTML = `
                <div class="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center justify-center mx-auto mb-4">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
                <h3 class="font-serif text-3xl font-semibold mb-2">Vielen Dank für Ihre Bewerbung!</h3>
                <p class="text-sm text-muted mb-6">Ihre Bewerbung als <strong>${esc(res.positionTitle)}</strong> ist eingegangen. Das Board of Partners meldet sich über Discord bei Ihnen.</p>
                <div class="grid grid-cols-2 gap-3 mb-3 max-w-md mx-auto">
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Bewerbungsnummer</div><div class="font-mono text-lg text-[var(--gold-light)]">${esc(res.number)}</div></div>
                    <div class="rounded-xl border border-[var(--gold-hairline)] bg-[rgba(212,175,55,0.07)] p-3"><div class="text-[0.6rem] uppercase tracking-widest text-muted">Zugangscode</div><div class="font-mono text-lg tracking-[0.2em] text-[var(--gold-light)]">${esc(res.code)}</div></div>
                </div>
                <p class="text-xs text-amber-300/90 mb-6">Bitte notieren Sie beide Angaben – damit sehen Sie jederzeit den Stand Ihrer Bewerbung.</p>
                <div class="flex flex-col sm:flex-row justify-center gap-2">
                    <button type="button" id="copyApply" class="btn-outline btn-md">Daten kopieren</button>
                    <a href="#status" id="checkApply" class="btn-gold btn-md">Status ansehen</a>
                </div>`;
            box.classList.remove('hidden');
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('copyApply').addEventListener('click', async () => {
                toast((await copy(text)) ? 'Bewerbungsdaten kopiert.' : 'Bitte die Angaben notieren.');
            });
            document.getElementById('checkApply').addEventListener('click', () => {
                document.getElementById('stNumber').value = res.number;
                document.getElementById('stCode').value = res.code;
                checkStatus();
            });
        } catch (ex) {
            err.textContent = ex.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Bewerbung absenden';
        }
    });

    // Statusabfrage
    async function checkStatus() {
        const out = document.getElementById('statusResult');
        const number = document.getElementById('stNumber').value.trim().toUpperCase();
        const code = document.getElementById('stCode').value.trim();
        if (!number || !code) {
            out.innerHTML = '<p class="form-error">Bitte Bewerbungsnummer und Zugangscode eingeben.</p>';
            return;
        }
        try {
            const d = await api.post('/api/public/application-status', { number, code });
            out.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-[var(--glass-border)]">
                    <div><div class="text-xs uppercase tracking-widest text-dim">Bewerbung</div><div class="font-mono text-lg">${esc(d.number)}</div><div class="text-sm text-muted">${esc(d.positionTitle)}</div></div>
                    <span class="badge badge-${STATUS_COLOR[d.status] || 'slate'} text-sm px-4 py-1">${esc(d.statusLabel)}</span>
                </div>
                ${d.interviewAt ? `<div class="banner banner-gold"><div><strong>Gesprächstermin:</strong> ${esc(fmtDate(d.interviewAt))} Uhr</div></div>` : ''}
                <div class="qa"><div class="q">Nachricht der Kanzlei</div><div class="a">${esc(d.publicNote || 'Ihre Bewerbung ist eingegangen und wird geprüft. Wir melden uns bei Ihnen.')}</div></div>
                <p class="text-xs text-dim mt-3">Zuletzt aktualisiert: ${esc(fmtDate(d.updatedAt))}</p>`;
        } catch (ex) {
            out.innerHTML = `<p class="form-error">${esc(ex.status === 429 ? ex.message : 'Keine Bewerbung mit diesen Angaben gefunden.')}</p>`;
        }
    }
    document.getElementById('statusForm').addEventListener('submit', (e) => {
        e.preventDefault();
        checkStatus();
    });
})();
