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
        return n && /^\/[^/\\]/.test(n) ? n : '/dashboard';
    }
    document.getElementById('registerLink').href = '/registrieren' + (params.get('next') ? '?next=' + encodeURIComponent(params.get('next')) : '');

    const notice = document.getElementById('notice');
    if (params.get('discord') && DISCORD[params.get('discord')]) {
        notice.textContent = DISCORD[params.get('discord')];
        notice.classList.remove('hidden');
    }

    // „Mit Discord anmelden“, aber noch kein Konto: nachfragen, ob ein neues Mandantenkonto angelegt werden soll
    if (params.get('discord') === 'neu') {
        api.get('/api/discord/pending').then((r) => {
            if (!r.pending) {
                notice.textContent = 'Die Discord-Anmeldung ist abgelaufen. Bitte erneut „Mit Discord anmelden“.';
                notice.classList.remove('hidden');
                return;
            }
            document.getElementById('discordSignupName').textContent = `„${r.pending.name}“`;
            document.getElementById('discordSignup').classList.remove('hidden');
        }).catch(() => {});
        document.getElementById('discordSignupBtn').addEventListener('click', async (e) => {
            e.target.disabled = true;
            try {
                const r = await api.post('/api/discord/signup');
                location.replace(r.redirect || '/dashboard');
            } catch (ex) {
                notice.textContent = ex.message;
                notice.classList.remove('hidden');
                e.target.disabled = false;
            }
        });
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
            const r = await api.post('/api/auth/login', { email, password });
            if (r.twoFactor) return showCodeStep(r.twoFactor);
            location.replace(nextUrl());
        } catch (ex) {
            err.textContent = ex.message;
        }
        btn.disabled = false;
        btn.textContent = 'Anmelden';
    });

    /* Zwei-Faktor: Code aus der Discord-Direktnachricht eingeben */
    const codeForm = document.getElementById('codeForm');
    const codeInput = document.getElementById('code');
    const codeError = document.getElementById('codeError');
    let challenge = null;
    let sending = false;
    let discordShown = false;
    function showCodeStep(tf) {
        challenge = tf.challenge;
        document.getElementById('codeTo').textContent = tf.to || 'Ihrem Discord';
        document.getElementById('loginForm').classList.add('hidden');
        const discord = document.getElementById('discordBlock');
        discordShown = !discord.classList.contains('hidden');
        discord.classList.add('hidden');
        codeForm.classList.remove('hidden');
        codeError.textContent = '';
        codeInput.value = '';
        codeInput.focus();
    }
    function backToLogin(message) {
        challenge = null;
        codeForm.classList.add('hidden');
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('discordBlock').classList.toggle('hidden', !discordShown);
        const btn = document.getElementById('submitBtn');
        btn.disabled = false;
        btn.textContent = 'Anmelden';
        document.getElementById('formError').textContent = message || '';
        document.getElementById('password').value = '';
        document.getElementById('password').focus();
    }
    async function sendCode() {
        const code = codeInput.value.replace(/\D/g, '');
        if (code.length !== 6) { codeError.textContent = 'Bitte den 6-stelligen Code aus der Discord-Nachricht eingeben.'; return; }
        if (sending) return; // Enter und automatisches Absenden gleichzeitig: nur einmal schicken
        sending = true;
        const btn = document.getElementById('codeBtn');
        btn.disabled = true;
        codeError.textContent = '';
        try {
            await api.post('/api/auth/login/code', { challenge, code, trust: document.getElementById('trustDevice').checked });
            location.replace(nextUrl()); // Seite wechselt – Knopf bleibt gesperrt
        } catch (ex) {
            sending = false;
            btn.disabled = false;
            if (ex.status === 410) return backToLogin(ex.message);
            codeError.textContent = ex.message;
            codeInput.select();
        }
    }
    codeForm.addEventListener('submit', (e) => { e.preventDefault(); sendCode(); });
    // Sechs Ziffern eingefügt oder getippt: gleich bestätigen
    codeInput.addEventListener('input', () => { if (codeInput.value.replace(/\D/g, '').length === 6) sendCode(); });
    document.getElementById('codeBack').addEventListener('click', () => backToLogin(''));
    document.getElementById('resendBtn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
            await api.post('/api/auth/login/resend', { challenge });
            codeError.textContent = '';
            window.PS.toast('Neuer Code ist unterwegs – der alte gilt nicht mehr.');
        } catch (ex) {
            if (ex.status === 410) return backToLogin(ex.message);
            codeError.textContent = ex.message;
        } finally {
            e.target.disabled = false;
        }
    });
})();
