/*
 * Bewerberseite (bewerbung.html#<persönlicher Link>): Stand der Bewerbung als Fortschritt, Gesprächstermin und
 * Nachrichten mit dem Board of Partners – ohne Konto und ohne Statusabfrage. Der Link wird auf dem Gerät gemerkt;
 * Bewerbungsnummer + Zugangscode führen ebenfalls hierher. Mit verbundenem Discord kommen Antworten zusätzlich
 * als Direktnachricht.
 */
(() => {
    'use strict';
    const { api, esc, fmtDate, parseDate, copy, toast } = window.PS;
    const root = document.getElementById('portal');
    const STORE = 'ps.bewerbungen';
    const STEPS = [['eingegangen', 'Eingegangen'], ['in_pruefung', 'In Prüfung'], ['gespraech', 'Gespräch'], ['angenommen', 'Entscheidung']];
    const STATUS_COLOR = { eingegangen: 'amber', in_pruefung: 'sky', gespraech: 'gold', angenommen: 'emerald', abgelehnt: 'red' };
    const SEND_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>';
    const DISCORD_ICON = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.1.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
    document.getElementById('year').textContent = new Date().getFullYear();

    let token = '';
    let data = null;
    let lastId = 0;
    let busy = false;

    /* ------------------------------------------------ Auf diesem Gerät gemerkte Bewerbungen */
    function remembered() {
        try {
            const list = JSON.parse(localStorage.getItem(STORE) || '[]');
            return Array.isArray(list) ? list.filter((x) => x && typeof x.token === 'string') : [];
        } catch {
            return [];
        }
    }
    function remember(entry) {
        try {
            const list = [entry, ...remembered().filter((x) => x.token !== entry.token)].slice(0, 5);
            localStorage.setItem(STORE, JSON.stringify(list));
        } catch {
            /* ohne Speicher: der Link funktioniert trotzdem */
        }
    }
    function forget(t) {
        try {
            localStorage.setItem(STORE, JSON.stringify(remembered().filter((x) => x.token !== t)));
        } catch {
            /* egal */
        }
    }

    /* ------------------------------------------------ Darstellung */
    function track(status) {
        const idx = { eingegangen: 0, in_pruefung: 1, gespraech: 2, angenommen: 3, abgelehnt: 3 }[status] ?? 0;
        const rejected = status === 'abgelehnt';
        const accepted = status === 'angenommen';
        return `<div class="track mb-2"><div class="track-line"><div class="track-fill" style="width:${(idx / 3) * 75}%"></div>
            <div class="grid grid-cols-4">${STEPS.map(([, label], i) => {
                const last = i === 3;
                const done = i < idx || (last && accepted);
                const cur = !rejected && !accepted && i === idx;
                const node = last && rejected ? '<div class="track-node rejected">✕</div>' : `<div class="track-node ${done ? 'done' : cur ? 'current' : ''}">${done ? '✓' : i + 1}</div>`;
                const text = last ? (accepted ? 'Angenommen' : rejected ? 'Abgelehnt' : label) : label;
                return `<div class="track-step" ${cur ? 'aria-current="step"' : ''}>${node}<span class="track-label text-[0.7rem] sm:text-xs text-muted text-center">${esc(text)}</span></div>`;
            }).join('')}</div></div></div>`;
    }
    function statusBanner(d) {
        if (d.status === 'gespraech' && d.interviewAt) {
            return `<div class="banner banner-gold mt-4 mb-0"><div><strong>Einladung zum Gespräch:</strong> ${esc(fmtDate(d.interviewAt))} Uhr<div class="text-xs text-muted mt-1">Passt der Termin? Schreiben Sie uns einfach unten eine kurze Nachricht.</div></div></div>`;
        }
        const text = {
            eingegangen: 'Ihre Bewerbung ist eingegangen. Das Board of Partners sieht sie sich an – Antworten und Rückfragen erscheinen hier.',
            in_pruefung: 'Ihre Bewerbung wird gerade geprüft. Wir melden uns hier bei Ihnen.',
            gespraech: 'Wir möchten Sie kennenlernen – den Termin stimmen wir hier mit Ihnen ab.',
            angenommen: 'Herzlichen Glückwunsch – willkommen im Team von Pake & Scha!',
            abgelehnt: 'Leider können wir Ihnen diesmal keine Stelle anbieten. Vielen Dank für Ihr Interesse an Pake & Scha.',
        }[d.status];
        return text ? `<p class="text-sm text-muted text-center mt-4">${esc(text)}</p>` : '';
    }
    function dayLabel(iso) {
        const d = parseDate(iso);
        if (!d) return '';
        const key = (x) => x.toLocaleDateString('de-DE');
        if (key(d) === key(new Date())) return 'Heute';
        if (key(d) === key(new Date(Date.now() - 864e5))) return 'Gestern';
        return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function bubbles(list, prevDay = null) {
        return list
            .map((m) => {
                const day = dayLabel(m.createdAt);
                const html = `${day !== prevDay ? `<div class="chat-day"><span>${esc(day)}</span></div>` : ''}
                    <div class="chat-msg ${m.fromBoard ? 'in' : 'out'}" data-id="${m.id}"><div class="chat-bubble">
                        ${m.fromBoard ? `<div class="chat-author">${esc(m.author)} <span>· Board of Partners</span></div>` : ''}
                        <div class="chat-text">${esc(m.body)}</div>
                        <div class="chat-foot"><span>${esc((parseDate(m.createdAt) || new Date()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))}</span><span class="chat-receipt"></span></div>
                    </div></div>`;
                prevDay = day;
                return html;
            })
            .join('');
    }
    function receipts() {
        const outs = [...document.querySelectorAll('#bwChat .chat-msg.out')];
        outs.forEach((el) => (el.querySelector('.chat-receipt').textContent = ''));
        const last = outs[outs.length - 1];
        if (last) last.querySelector('.chat-receipt').textContent = Number(last.dataset.id) <= (data.boardRead || 0) ? '· gelesen' : '· gesendet';
    }
    function append(messages) {
        const list = document.getElementById('bwChat');
        if (!list) return;
        const fresh = messages.filter((m) => !list.querySelector(`.chat-msg[data-id="${m.id}"]`));
        if (!fresh.length) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        list.querySelector('.chat-empty')?.remove();
        const days = list.querySelectorAll('.chat-day span');
        list.insertAdjacentHTML('beforeend', bubbles(fresh, days.length ? days[days.length - 1].textContent : null));
        lastId = Math.max(lastId, ...fresh.map((m) => m.id));
        if (atBottom || fresh.some((m) => !m.fromBoard)) list.scrollTop = list.scrollHeight;
        receipts();
    }

    function render(d) {
        const link = `${location.origin}/bewerbung.html#${token}`;
        const discord = !d.discord.available
            ? ''
            : d.discord.connected
              ? `<div class="glass-card bw-card"><div class="flex items-center gap-2 mb-2"><span class="badge badge-emerald">Discord verbunden</span></div><p class="text-sm text-muted">Antworten des Board of Partners und neue Stände Ihrer Bewerbung bekommen Sie zusätzlich als Discord-Direktnachricht.</p></div>`
              : `<div class="glass-card bw-card"><h2 class="font-serif text-2xl font-semibold mb-2">Benachrichtigung per Discord</h2><p class="text-sm text-muted mb-4">Verbinden Sie Ihr Discord – dann bekommen Sie Antworten und neue Stände direkt als Nachricht und müssen hier nicht nachsehen.</p><button type="button" class="btn-discord btn-sm" id="bwDiscord">${DISCORD_ICON}<span>Discord verbinden</span></button></div>`;
        root.innerHTML = `
            <div class="text-center mb-8">
                <p class="text-xs uppercase tracking-widest text-gold mb-2">Ihre Bewerbung</p>
                <h1 class="font-serif text-4xl md:text-5xl font-semibold break-words">${esc(d.name)}</h1>
                <p class="text-sm text-muted mt-2"><span class="font-mono text-gold">${esc(d.number)}</span> · ${esc(d.positionTitle)}</p>
            </div>
            <div class="glass-card bw-card mb-5">
                <div class="flex justify-center mb-5"><span class="badge badge-${STATUS_COLOR[d.status] || 'slate'} text-sm px-4 py-1" id="bwStatus">${esc(d.statusLabel)}</span></div>
                <div id="bwTrack">${track(d.status)}</div>
                <div id="bwBanner">${statusBanner(d)}</div>
            </div>
            <div class="glass-card bw-chat mb-5 overflow-hidden">
                <div class="bw-head"><h2 class="font-serif text-2xl font-semibold">Nachrichten</h2><span class="text-xs text-dim">mit dem Board of Partners</span></div>
                <div class="chat">
                    <div class="chat-list" id="bwChat" aria-live="polite">${d.messages.length ? bubbles(d.messages) : '<p class="chat-empty">Noch keine Nachrichten. Fragen zu Ihrer Bewerbung? Schreiben Sie uns hier.</p>'}</div>
                    <form id="bwForm" class="chat-form">
                        <textarea name="body" rows="1" maxlength="3000" required class="field chat-input" placeholder="Nachricht an das Board of Partners …" aria-label="Nachricht schreiben"></textarea>
                        <button type="submit" class="btn-gold chat-send" aria-label="Senden" title="Senden">${SEND_ICON}</button>
                    </form>
                    <p class="chat-hint"><span class="hidden md:inline">Enter sendet · Umschalt + Enter für eine neue Zeile.</span></p>
                </div>
            </div>
            <div class="grid gap-5 ${discord ? 'md:grid-cols-2' : ''}">
                ${discord}
                <div class="glass-card bw-card">
                    <h2 class="font-serif text-2xl font-semibold mb-2">Ihr persönlicher Link</h2>
                    <p class="text-sm text-muted mb-3">Über diesen Link kommen Sie jederzeit hierher – auf diesem Gerät ist er gespeichert. Bitte nicht weitergeben.</p>
                    <div class="bw-link mb-3">${esc(link)}</div>
                    <button type="button" class="btn-outline btn-sm" id="bwCopy">Link kopieren</button>
                </div>
            </div>`;
        lastId = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
        const list = document.getElementById('bwChat');
        list.scrollTop = list.scrollHeight;
        receipts();
        document.getElementById('bwCopy').addEventListener('click', async () => toast((await copy(link)) ? 'Link kopiert.' : 'Bitte den Link markieren und kopieren.'));
        const dc = document.getElementById('bwDiscord');
        if (dc)
            dc.addEventListener('click', () => {
                const f = document.getElementById('discordJoinForm');
                f.elements.token.value = token;
                f.submit();
            });
        const form = document.getElementById('bwForm');
        const input = form.elements.body;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            send();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) {
                e.preventDefault();
                send();
            }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight + 2, 180) + 'px';
        });
    }

    async function send() {
        const form = document.getElementById('bwForm');
        const input = form.elements.body;
        const body = input.value.trim();
        if (!body || busy) return;
        busy = true;
        form.querySelector('button').disabled = true;
        try {
            const r = await api.post('/api/public/application-portal/messages', { token, body });
            input.value = '';
            input.style.height = '';
            append([r.message]);
        } catch (ex) {
            toast(ex.message, 'error');
        } finally {
            busy = false;
            form.querySelector('button').disabled = false;
            input.focus();
        }
    }

    /** Regelmäßig nachsehen: neue Nachrichten, gelesen, neuer Stand. */
    async function poll() {
        if (!data || document.hidden) return;
        try {
            const d = await api.post('/api/public/application-portal', { token, after: lastId });
            append(d.messages);
            data.boardRead = d.boardRead;
            receipts();
            if (d.status !== data.status || d.interviewAt !== data.interviewAt) {
                Object.assign(data, { status: d.status, statusLabel: d.statusLabel, interviewAt: d.interviewAt });
                document.getElementById('bwTrack').innerHTML = track(d.status);
                document.getElementById('bwBanner').innerHTML = statusBanner(d);
                const badge = document.getElementById('bwStatus');
                badge.className = `badge badge-${STATUS_COLOR[d.status] || 'slate'} text-sm px-4 py-1`;
                badge.textContent = d.statusLabel;
            }
        } catch {
            /* nächster Versuch */
        }
    }

    /* ------------------------------------------------ Ohne (gültigen) Link: gemerkte Bewerbungen oder Nummer + Code */
    function showAccess(message) {
        const list = remembered();
        root.innerHTML = `
            <div class="text-center mb-8">
                <p class="text-xs uppercase tracking-widest text-gold mb-2">Karriere</p>
                <h1 class="font-serif text-4xl md:text-5xl font-semibold">Ihre Bewerbung</h1>
            </div>
            ${message ? `<div class="banner banner-amber mb-5"><div>${esc(message)}</div></div>` : ''}
            ${list.length ? `<div class="glass-card bw-card mb-5"><h2 class="font-serif text-2xl font-semibold mb-3">Auf diesem Gerät</h2><div class="flex flex-col gap-2">${list.map((x) => `<a class="btn-outline btn-md justify-between" href="#${esc(x.token)}"><span class="font-mono">${esc(x.number || 'Bewerbung')}</span><span class="text-xs text-dim">${esc(x.position || '')}</span></a>`).join('')}</div></div>` : ''}
            <div class="glass-card bw-card">
                <h2 class="font-serif text-2xl font-semibold mb-2">Mit Bewerbungsnummer öffnen</h2>
                <p class="text-sm text-muted mb-4">Bewerbungsnummer und Zugangscode haben Sie nach dem Absenden erhalten.</p>
                <form id="accessForm" class="flex flex-col sm:flex-row gap-3" novalidate>
                    <input id="acNumber" class="field font-mono" placeholder="Bewerbungsnummer, z. B. BW-2026-0001" autocapitalize="characters" aria-label="Bewerbungsnummer">
                    <input id="acCode" class="field font-mono sm:w-48" inputmode="numeric" maxlength="6" placeholder="Zugangscode" aria-label="Zugangscode">
                    <button type="submit" class="btn-gold btn-md">Öffnen</button>
                </form>
                <p id="accessError" class="form-error mt-3" role="alert"></p>
                <p class="text-xs text-dim mt-4">Noch nicht beworben? <a href="/karriere.html" class="text-gold hover:underline">Zu den offenen Stellen</a></p>
            </div>`;
        document.getElementById('accessForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = document.getElementById('accessError');
            err.textContent = '';
            const number = document.getElementById('acNumber').value.trim().toUpperCase();
            const code = document.getElementById('acCode').value.trim();
            if (!number || !code) return (err.textContent = 'Bitte Bewerbungsnummer und Zugangscode eingeben.');
            try {
                const r = await api.post('/api/public/application-access', { number, code });
                location.hash = r.token;
            } catch (ex) {
                err.textContent = ex.status === 429 ? ex.message : 'Keine Bewerbung mit diesen Angaben gefunden.';
            }
        });
    }

    async function load() {
        token = decodeURIComponent(location.hash.slice(1)).trim();
        data = null;
        if (!token) {
            const list = remembered();
            if (list.length === 1) {
                location.replace(`#${list[0].token}`);
                return;
            }
            return showAccess('');
        }
        try {
            data = await api.post('/api/public/application-portal', { token });
        } catch (ex) {
            if (ex.status === 404) forget(token);
            return showAccess(ex.status === 404 ? 'Dieser Link gehört zu keiner Bewerbung (mehr). Öffnen Sie Ihre Bewerbung mit Bewerbungsnummer und Zugangscode.' : ex.message);
        }
        remember({ token, number: data.number, position: data.positionTitle });
        document.title = `Bewerbung ${data.number} | Pake & Scha Legal Consulting`;
        render(data);
    }

    // Rückmeldung nach „Discord verbinden“ (…?discord=…)
    const dc = new URLSearchParams(location.search).get('discord');
    if (dc) {
        const msg = {
            verbunden: ['Discord verbunden – Antworten kommen ab jetzt auch als Direktnachricht.', 'ok'],
            denied: ['Die Verbindung mit Discord wurde abgebrochen.', 'error'],
            disabled: ['Die Discord-Anmeldung ist noch nicht eingerichtet.', 'error'],
            notfound: ['Diese Bewerbung wurde nicht gefunden.', 'error'],
        }[dc] || ['Die Verbindung mit Discord ist fehlgeschlagen. Bitte erneut versuchen.', 'error'];
        toast(...msg);
        history.replaceState(null, '', location.pathname + location.hash);
    }

    window.addEventListener('hashchange', load);
    setInterval(poll, 10000);
    document.addEventListener('visibilitychange', () => !document.hidden && poll());
    load();
})();
