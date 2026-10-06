/* Registrierung (register.html) – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    const { api } = window.PS;
    const form = document.getElementById('registerForm');
    const params = new URLSearchParams(location.search);

    function nextUrl() {
        const n = params.get('next');
        return n && /^\/[^/\\]/.test(n) ? n : '/dashboard.html';
    }
    document.getElementById('loginLink').href = '/login.html' + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '');

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
        if (displayName.length < 2) { err.textContent = 'Bitte Ihren Namen angeben.'; return; }
        if (!email) { err.textContent = 'Bitte den Teil vor dem @ angeben, z. B. max.mustermann.'; return; }
        if (email.includes('@')) { err.textContent = 'Die Endung ist immer @pake-scha.ls – bitte nur den Teil davor eingeben.'; return; }
        if (!/^[a-z0-9](?:[a-z0-9._-]{0,46}[a-z0-9])?$/.test(email) || /[._-]{2}/.test(email)) { err.textContent = 'Vor dem @ bitte nur Buchstaben (a–z), Zahlen, Punkt, Bindestrich oder Unterstrich – z. B. max.mustermann.'; return; }
        if (password.length < 10) { err.textContent = 'Das Passwort muss mindestens 10 Zeichen lang sein.'; return; }
        if (password !== form.elements.password2.value) { err.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }

        const body = { displayName, email, password };
        if (form.elements.phone.value.trim()) body.phone = form.elements.phone.value.trim();

        btn.disabled = true;
        try {
            await api.post('/api/auth/register', body);
            location.replace(nextUrl());
        } catch (ex) {
            err.textContent = ex.message;
            btn.disabled = false;
        }
    });
})();
