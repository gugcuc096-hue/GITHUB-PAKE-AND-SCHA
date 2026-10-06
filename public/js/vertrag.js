/* Verträge und Schriftsätze – Druckansicht, Unterschreiben, Vorlagen-Vorschau (vertrag.html) – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
// „Drucken / PDF“ (früher onclick in der Seite)
document.getElementById('printBtn').addEventListener('click', () => window.print());

(() => {
    'use strict';
    const { api, esc, parseDate } = window.PS;
    const { render, header } = window.PS.contract;
    const params = new URLSearchParams(location.search);
    const id = Number(params.get('id'));
    const templateId = Number(params.get('vorlage'));
    const root = document.getElementById('doc');
    const panel = document.getElementById('panel');
    let state = null;

    const sheets = (pages, head) =>
        pages.map((html) => `<article class="sheet"><table class="frame"><thead><tr><td>${head}</td></tr></thead><tbody><tr><td>${html}</td></tr></tbody></table></article>`).join('');
    // Lange Namen in der Schreibschrift verkleinern, bis sie ins Unterschriftsfeld passen
    const fitSignatures = () =>
        document.querySelectorAll('.k-script').forEach((el) => {
            el.style.fontSize = '';
            let size = parseFloat(getComputedStyle(el).fontSize);
            while (el.scrollWidth > el.clientWidth + 1 && size > 12) {
                size -= 1;
                el.style.fontSize = `${size}px`;
            }
        });
    const refit = () => { fitSignatures(); if (document.fonts) document.fonts.ready.then(fitSignatures); };
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitSignatures, 150); });
    const dateTime = (v) => { const d = parseDate(v); return d ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };

    function values(k, c) {
        return { ...k.data, aktenzeichen: c.caseNumber, akte: c.title, rechtsgebiet: c.area, gerichtsaktenzeichen: c.courtRef || '', gegenpartei: c.opponent || '', kanzlei: 'Pake & Scha Legal Consulting' };
    }

    function renderPanel() {
        const { contract: k, can } = state;
        const brief = k.kind === 'schriftsatz';
        const lawyers = k.needsLawyer === false ? [] : [{ name: k.lawyerName || k.data.anwalt || '—', signature: k.lawyerSignature, signedAt: k.lawyerSignedAt }, ...(k.coLawyers || [])];
        const chips = [
            ...(k.internal ? ['<span class="chip wait">Nur intern – für den Mandanten nicht sichtbar</span>'] : []),
            ...lawyers.map((l) => (l.signedAt ? `<span class="chip ok">✓ Anwalt: ${esc(l.signature)} · ${esc(dateTime(l.signedAt))}</span>` : `<span class="chip wait">Anwalt: noch nicht unterschrieben (${esc(l.name)})</span>`)),
            ...(k.needsClient === false
                ? []
                : [k.clientSignedAt
                    ? `<span class="chip ok">✓ Mandant: ${esc(k.clientSignature)} · ${k.clientSignedVia === 'kanzlei' ? 'im Spiel, erfasst' : 'digital'} · ${esc(dateTime(k.clientSignedAt))}</span>`
                    : '<span class="chip wait">Mandant: noch nicht unterschrieben</span>']),
        ].join('');
        const parts = [];
        if (can.canSignClient) {
            parts.push(`<h2>${brief ? `${esc(k.templateName)} unterschreiben` : 'Vertrag unterschreiben'}</h2>
                <div>Bitte lesen Sie ${brief ? 'das Dokument' : 'den Vertrag'} vollständig. Zum Unterschreiben tippen Sie Ihren vollständigen Namen${k.data.mandant ? ` (<strong>${esc(k.data.mandant)}</strong>)` : ''} ein.</div>
                <label class="agree"><input type="checkbox" id="agree"> ${brief ? `Ich habe „${esc(k.templateName)}“ gelesen und bin einverstanden.` : 'Ich habe den Mandatsvertrag gelesen und bin mit allen Bedingungen einverstanden.'}</label>
                <div class="row"><input type="text" id="signName" maxlength="120" autocomplete="name" placeholder="Vollständiger Name"><button class="btn gold" id="signClient" type="button">Unterschreiben</button></div>`);
        }
        if (can.canSignLawyer) parts.push(`<div class="row"><button class="btn gold" id="signLawyer" type="button">Als Anwalt unterschreiben</button><span>Ihre Unterschrift erscheint als ${esc(can.lawyerSignName || '')} im Unterschriftsfeld.${lawyers.length > 1 && !brief ? ' Vollständig ist der Vertrag, wenn alle Anwälte und der Mandant unterschrieben haben.' : ''}</span></div>`);
        if (can.canRecordClient) parts.push('<div class="row"><button class="btn" id="recordClient" type="button">Mandant hat im Spiel unterschrieben – erfassen</button></div>');
        if (can.canReset) parts.push('<div class="row"><button class="btn danger" id="resetSigs" type="button">Unterschriften zurücksetzen</button><span class="hint">Nur Board of Partners</span></div>');
        panel.innerHTML = `<div class="panel"><div class="chips">${chips}</div>${parts.join('')}<div class="err" id="panelErr" hidden></div></div>`;
        const err = (e) => { const el = document.getElementById('panelErr'); el.hidden = false; el.textContent = e.message || String(e); };
        const sign = async (body, btn) => {
            btn.disabled = true;
            try {
                const r = await api.post(`/api/contracts/${k.id}/sign`, body);
                state.contract = r.contract;
                state.can = r.can;
                draw();
            } catch (e) { btn.disabled = false; err(e); }
        };
        document.getElementById('signClient')?.addEventListener('click', (ev) => {
            if (!document.getElementById('agree').checked) return err(new Error(`Bitte bestätigen Sie, dass Sie ${brief ? 'das Dokument' : 'den Vertrag'} gelesen haben.`));
            sign({ as: 'mandant', name: document.getElementById('signName').value }, ev.currentTarget);
        });
        document.getElementById('signLawyer')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            if (await window.PS.confirm(`Danach lässt sich der Inhalt ${brief ? 'des Dokuments' : 'des Vertrags'} nicht mehr ändern.`, { title: 'Als Anwalt unterschreiben?', confirmText: 'Unterschreiben' })) sign({ as: 'anwalt' }, btn);
        });
        document.getElementById('recordClient')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            if (await window.PS.confirm(`Bitte nur bestätigen, wenn ${k.data.mandant || 'der Mandant'} ${brief ? 'das Dokument' : 'den Vertrag'} im Spiel tatsächlich unterschrieben hat. Die Erfassung wird mit Ihrem Namen im Aktenverlauf vermerkt.`, { title: 'Unterschrift des Mandanten erfassen?', confirmText: 'Erfassen' })) sign({ as: 'erfassen' }, btn);
        });
        document.getElementById('resetSigs')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            if (!(await window.PS.confirm(`Alle Unterschriften werden entfernt; ${brief ? 'das Dokument' : 'der Vertrag'} kann danach wieder bearbeitet werden.`, { title: 'Unterschriften zurücksetzen?', confirmText: 'Zurücksetzen', danger: true }))) return;
            btn.disabled = true;
            try {
                const r = await api.post(`/api/contracts/${k.id}/reset`, {});
                state.contract = r.contract;
                state.can = r.can;
                draw();
            } catch (e) { btn.disabled = false; err(e); }
        });
    }

    function draw() {
        const { contract: k, case: c } = state;
        document.title = `${k.templateName} ${c.caseNumber} | Pake & Scha`;
        document.getElementById('backLink').href = `/dashboard.html?case=${c.id}#cases`;
        root.className = '';
        root.innerHTML = sheets(render(k.body, values(k, c), k), header(state.header));
        refit();
        renderPanel();
        if (params.get('print') === '1') setTimeout(() => window.print(), 500);
    }

    function fail(err, back = '/dashboard.html#cases') {
        if (err.status === 401) {
            location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
            return;
        }
        root.className = 'message';
        root.innerHTML = `${esc(err.message)}<br><br><a href="${back}">Zum Dashboard</a>`;
    }

    if (Number.isInteger(templateId) && templateId > 0) {
        // Vorschau einer Vorlage (Einstellungen): Felder bleiben leer bzw. zeigen Beispielwerte.
        api.get('/api/contract-templates?all=1')
            .then(({ templates, header: head }) => {
                const t = templates.find((x) => x.id === templateId);
                if (!t) throw Object.assign(new Error('Vorlage nicht gefunden.'), { status: 404 });
                const sample = params.get('beispiel') === '1'
                    ? { anwalt: 'Dr. Alois Pake', anwalt_rang: 'Founding Partner', anwalt_geburtsdatum: '12.03.1988', mandant: 'John Doe', mandant_geburtsdatum: '04.07.1995', leistungen: '• Vertretung Hauptverhandlung (alle Gerichte) – 100.000 $\n• U-Haft-Vertretung vor Ort – 50.000 $', grundgebuehr: '150.000 $', zusatzgebuehr: '25.000 $ je weiterem Verhandlungstag', datum: new Date().toLocaleDateString('de-DE'), ort: 'Los Santos, San Andreas', aktenzeichen: 'PS-2026-0001', akte: 'Beispielakte', rechtsgebiet: 'Strafrecht', gerichtsaktenzeichen: 'DC-2026-0142', gegenpartei: 'State of San Andreas', empfaenger: 'District Court San Andreas\nStaatsanwaltschaft Los Santos\nMission Row, Los Santos', betreff: 'Ermittlungsverfahren gegen John Doe', festnahme: 'Festnahme am 01.10.2026, Mission Row Police Department', begruendung: 'Der Beschuldigte ist nicht vorbestraft und hat sich zu jeder Zeit kooperativ gezeigt.', kanzlei: 'Pake & Scha Legal Consulting' }
                    : { aktenzeichen: '', akte: '', rechtsgebiet: '', gerichtsaktenzeichen: '', gegenpartei: '', kanzlei: 'Pake & Scha Legal Consulting', anwalt: '', anwalt_rang: '', anwalt_geburtsdatum: '', mandant: '', mandant_geburtsdatum: '', leistungen: '', grundgebuehr: '', zusatzgebuehr: '', datum: '', ort: '', empfaenger: '', betreff: '', festnahme: '', begruendung: '' };
                document.title = `Vorschau: ${t.name} | Pake & Scha`;
                document.getElementById('backLink').href = '/dashboard.html?tab=contracts#settings';
                document.getElementById('backLink').textContent = '← Einstellungen';
                panel.innerHTML = `<p class="preview-note">Vorschau der Vorlage „${esc(t.name)}“ – ${params.get('beispiel') === '1' ? 'mit Beispielwerten' : 'leere Felder erscheinen als Linie zum Ausfüllen'}.</p>`;
                root.className = '';
                // Beispiel: ein weiterer unterzeichnender Anwalt – zeigt, wo [Weitere Anwälte] erscheint
                const exampleSig = { kind: t.kind, ...(params.get('beispiel') === '1' && t.kind !== 'schriftsatz' ? { coLawyers: [{ name: 'Maxine Scha', rank: 'Equity Partner', birth: '21.09.1990' }] } : {}) };
                root.innerHTML = sheets(render(t.body, sample, exampleSig), header(head));
                refit();
            })
            .catch((e) => fail(e, '/dashboard.html?tab=contracts#settings'));
    } else if (!Number.isInteger(id) || id <= 0) {
        root.innerHTML = 'Kein Dokument angegeben. <a href="/dashboard.html#cases">Zum Dashboard</a>';
    } else {
        api.get('/api/contracts/' + id)
            .then((r) => {
                state = r;
                draw();
                window.PS.googleDoc.mount({ kind: 'contract', id });
            })
            .catch((e) => fail(e));
    }
})();
