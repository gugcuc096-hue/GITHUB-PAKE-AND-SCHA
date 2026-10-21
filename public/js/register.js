/* Registrierung (register.html) – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    const { api, fieldError, fieldErrors, clearFieldErrors } = window.PS;
    const form = document.getElementById('registerForm');
    const params = new URLSearchParams(location.search);

    function nextUrl() {
        const n = params.get('next');
        return n && /^\/[^/\\]/.test(n) ? n : '/dashboard';
    }
    document.getElementById('loginLink').href = '/login' + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '');

    // Mit Discord registrieren (nur wenn die Discord-Anmeldung eingerichtet ist)
    api.get('/api/discord/status').then((s) => { if (s.oauth) document.getElementById('discordBlock').classList.remove('hidden'); }).catch(() => {});
    const DISCORD = {
        denied: 'Die Registrierung über Discord wurde abgebrochen.',
        error: 'Die Registrierung über Discord ist fehlgeschlagen. Bitte erneut versuchen.',
        state: 'Sicherheitsprüfung fehlgeschlagen – bitte erneut versuchen.',
        disabled: 'Die Discord-Anmeldung ist noch nicht eingerichtet.',
        locked: 'Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.',
    };
    if (DISCORD[params.get('discord')]) document.getElementById('formError').textContent = DISCORD[params.get('discord')];

    // E-Mail-Vorschlag aus dem Namen („Max Müller“ → „max.mueller“), bis selbst etwas eingetragen wird
    const emailInput = form.elements.email;
    emailInput.addEventListener('input', () => { emailInput.dataset.own = '1'; });
    form.elements.displayName.addEventListener('input', () => {
        if (emailInput.dataset.own) return;
        emailInput.value = form.elements.displayName.value.toLowerCase()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('formError');
        const btn = document.getElementById('submitBtn');
        err.textContent = '';

        const displayName = form.elements.displayName.value.trim();
        // Nur der Teil vor dem @ – eine eingefügte komplette Adresse mit @pake-scha.ls wird gekürzt
        const email = form.elements.email.value.trim().toLowerCase().replace(/@pake-scha\.ls$/, '');
        const password = form.elements.password.value;
        const f = form.elements;
        clearFieldErrors(form);
        if (displayName.length < 2) return fieldError(f.displayName, 'Bitte Ihren Namen angeben.');
        if (!email) return fieldError(f.email, 'Bitte den Teil vor dem @ angeben, z. B. max.mustermann.');
        if (email.includes('@')) return fieldError(f.email, 'Die Endung ist immer @pake-scha.ls – bitte nur den Teil davor eingeben.');
        if (!/^[a-z0-9](?:[a-z0-9._-]{0,46}[a-z0-9])?$/.test(email) || /[._-]{2}/.test(email)) return fieldError(f.email, 'Vor dem @ bitte nur Buchstaben (a–z), Zahlen, Punkt, Bindestrich oder Unterstrich – z. B. max.mustermann.');
        if (password.length < 10) return fieldError(f.password, `Mindestens 10 Zeichen (aktuell ${password.length}).`);
        if (password !== f.password2.value) return fieldError(f.password2, 'Die beiden Passwörter stimmen nicht überein.');

        const body = { displayName, email, password };
        if (form.elements.phone.value.trim()) body.phone = form.elements.phone.value.trim();

        btn.disabled = true;
        try {
            await api.post('/api/auth/register', body);
            location.replace(nextUrl());
        } catch (ex) {
            if (!fieldErrors(form, ex)) err.textContent = ex.message;
            btn.disabled = false;
        }
    });
})();
