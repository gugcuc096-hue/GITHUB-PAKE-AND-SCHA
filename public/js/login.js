/* Anmeldung (login.html) – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
(() => {
    const { api } = window.PS;
    const params = new URLSearchParams(location.search);
    const DISCORD = {
        notlinked: 'Dieses Discord-Konto ist noch mit keinem Website-Konto verbunden. Melden Sie sich einmal mit E-Mail und Passwort an und verbinden Sie Discord unter „Profil“.',
        locked: 'Dieser Zugang wurde gesperrt. Bitte wenden Sie sich an das Board of Partners.',
        denied: 'Die Anmeldung über Discord wurde abgebrochen.',
        error: 'Die Anmeldung über Discord ist fehlgeschlagen. Bitte erneut versuchen.',
        state: 'Sicherheitsprüfung fehlgeschlagen – bitte erneut versuchen.',
        disabled: 'Die Discord-Anmeldung ist noch nicht eingerichtet.',
        session: 'Bitte melden Sie sich zuerst an.',
    };

    // Nur interne Pfade zulassen (verhindert Open-Redirect über ?next=…)
    function nextUrl() {
        const n = params.get('next');
        return n && /^\/[^/\\]/.test(n) ? n : '/dashboard.html';
    }
    document.getElementById('registerLink').href = '/register.html' + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '');

    const notice = document.getElementById('notice');
    if (params.get('discord') && DISCORD[params.get('discord')]) {
        notice.textContent = DISCORD[params.get('discord')];
        notice.classList.remove('hidden');
    }

    // Bereits angemeldet? Direkt weiter.
    api.get('/api/auth/session').then((r) => { if (r && r.user) location.replace(nextUrl()); }).catch(() => {});
    api.get('/api/discord/status').then((s) => { if (s.oauth) document.getElementById('discordBlock').classList.remove('hidden'); }).catch(() => {});

    document.getElementById('forgotBtn').addEventListener('click', () => document.getElementById('forgotInfo').classList.toggle('hidden'));

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('formError');
        const btn = document.getElementById('submitBtn');
        err.textContent = '';
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        if (!email || !password) { err.textContent = 'Bitte E-Mail-Adresse und Passwort eingeben.'; return; }
        btn.disabled = true;
        btn.textContent = 'Anmeldung läuft …';
        try {
            await api.post('/api/auth/login', { email, password });
            location.replace(nextUrl());
        } catch (ex) {
            err.textContent = ex.message;
            btn.disabled = false;
            btn.textContent = 'Anmelden';
        }
    });
})();
