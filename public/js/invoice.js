/* Rechnung / Honorarvereinbarung – Druckansicht (invoice.html) – früher Inline-Skript in der Seite, jetzt eigene Datei (strenge Content-Security-Policy). */
// „Drucken / PDF“ (früher onclick in der Seite)
document.getElementById('printBtn').addEventListener('click', () => window.print());

(() => {
    'use strict';
    const { api, esc, money, parseDate } = window.PS;
    const backLink = document.getElementById('backLink');
    window.PS.closeToDashboard(backLink);
    const KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
    const dateDe = (v) => { const d = parseDate(v); return d ? d.toLocaleDateString('de-DE') : '—'; };
    const dayDe = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('de-DE') : '—');
    const pct = (n) => String(n).replace('.', ',');
    const root = document.getElementById('doc');
    const id = Number(new URLSearchParams(location.search).get('id'));

    function render(inv, firm) {
        const hv = inv.kind === 'honorarvereinbarung';
        document.title = `${KIND[inv.kind]} ${inv.number} | Pake & Scha`;
        root.className = 'paper';
        root.innerHTML = `
            ${inv.status === 'bezahlt' ? '<div class="stamp paid">BEZAHLT</div>' : ''}
            ${inv.status === 'storniert' ? '<div class="stamp void">STORNIERT</div>' : ''}
            <div class="head">
                <div class="brand"><img class="mark" src="/img/logo.svg" width="32" height="60" alt="Pake &amp; Scha" decoding="async"><div><div class="firm">Pake &amp; Scha</div><div class="tag">Legal Consulting &amp; Advocacy</div></div></div>
                <div class="addr">${esc(firm.address)}${firm.contact ? '\n' + esc(firm.contact) : ''}</div>
            </div>
            <div class="title">
                <h1>${esc(KIND[inv.kind])}</h1>
                <div class="meta">
                    <span>Nummer</span><span>${esc(inv.number)}</span>
                    <span>Datum</span><span>${esc(dateDe(inv.createdAt))}</span>
                    ${inv.caseNumber ? `<span>Aktenzeichen</span><span>${esc(inv.caseNumber)}</span>` : ''}
                    ${inv.dueDate && !hv ? `<span>Zahlbar bis</span><span>${esc(dayDe(inv.dueDate))}</span>` : ''}
                    ${inv.dueDate && hv ? `<span>Vorschuss fällig</span><span>${esc(dayDe(inv.dueDate))}</span>` : ''}
                </div>
            </div>
            <div class="parties">
                <div><div class="label">${hv ? 'Mandant' : 'Rechnungsempfänger'}</div><div class="party"><strong>${esc(inv.clientName)}</strong>${inv.clientContact ? '<br>' + esc(inv.clientContact) : ''}</div></div>
                <div><div class="label">${hv ? 'Beauftragte Kanzlei' : 'Bearbeitet von'}</div><div class="party"><strong>${esc(inv.issuerName || 'Pake & Scha')}</strong>${inv.issuerRank ? '<br>' + esc(inv.issuerRank) : ''}<br>Pake &amp; Scha Legal Consulting</div></div>
            </div>
            ${inv.subject ? `<div class="subject"><strong>${hv ? 'Gegenstand der Vereinbarung' : 'Betreff'}:</strong> ${esc(inv.subject)}</div>` : ''}
            ${hv ? '<p style="font-size:.86rem;line-height:1.55;margin:0 0 1rem">Zwischen dem oben genannten Mandanten und der Kanzlei Pake &amp; Scha Legal Consulting wird für die anwaltliche Tätigkeit folgende Vergütung vereinbart:</p>' : ''}
            <table>
                <thead><tr><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Betrag</th></tr></thead>
                <tbody>${inv.items.map((it) => `<tr><td>${esc(it.description)}</td><td class="num">${esc(it.quantity)}</td><td class="num">${money(it.unitPrice)}</td><td class="num">${money(it.quantity * it.unitPrice)}</td></tr>`).join('')}</tbody>
            </table>
            <div class="totals">
                <div><span>Zwischensumme</span><span class="num">${money(inv.subtotal)}</span></div>
                ${inv.memberAmount ? `<div><span>${esc(inv.membershipName)} (${pct(inv.memberPct)} %)</span><span class="num">− ${money(inv.memberAmount)}</span></div>` : ''}
                ${inv.coopAmount ? `<div><span>Kooperationsrabatt ${esc(inv.cooperationName)} (${pct(inv.coopPct)} %)</span><span class="num">− ${money(inv.coopAmount)}</span></div>` : ''}
                ${inv.discountAmount ? `<div><span>Rabatt (${pct(inv.discountPct)} %)</span><span class="num">− ${money(inv.discountAmount)}</span></div>` : ''}
                ${inv.surchargeAmount ? `<div><span>Zuschlag (${pct(inv.surchargePct)} %)</span><span class="num">+ ${money(inv.surchargeAmount)}</span></div>` : ''}
                <div class="grand"><span>${hv ? 'Vereinbartes Honorar' : 'Gesamtbetrag'}</span><span>${money(inv.total)}</span></div>
                ${inv.memberAmount && !inv.total ? `<div style="font-size:.8rem;font-style:italic;justify-content:flex-end">Vollständig abgedeckt durch ${esc(inv.membershipName)}</div>` : ''}
            </div>
            ${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ''}
            ${!hv && firm.paymentInfo ? `<div class="pay">${esc(firm.paymentInfo)}</div>` : ''}
            ${hv
                ? `<div class="sign"><div>Ort, Datum · Unterschrift Mandant</div><div>Ort, Datum · Pake &amp; Scha Legal Consulting</div></div>`
                : `<div class="issuer">Mit freundlichen Grüßen<div class="name">${esc(inv.issuerName || 'Pake & Scha')}</div>${inv.issuerRank ? esc(inv.issuerRank) + ' · ' : ''}Pake &amp; Scha Legal Consulting</div>`}
            <div class="foot"><span>Pake &amp; Scha Legal Consulting · Würfelpark, Los Santos</span><span>${esc(inv.number)}</span></div>`;
        if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 400);
    }

    if (!Number.isInteger(id) || id <= 0) {
        root.innerHTML = 'Kein Dokument angegeben. <a href="/dashboard.html#invoices">Zum Dashboard</a>';
        return;
    }
    api.get('/api/invoices/' + id)
        .then(({ invoice, firm }) => {
            // Rechnung zu einer Akte: zurück in die Akte, sonst zu den Rechnungen
            if (invoice.caseId) {
                backLink.href = `/dashboard.html?case=${Number(invoice.caseId)}#cases`;
                backLink.textContent = '← Zur Akte';
            }
            render(invoice, firm);
            window.PS.googleDoc.mount({ kind: 'invoice', id });
        })
        .catch((err) => {
            if (err.status === 401) {
                location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
                return;
            }
            root.innerHTML = `${esc(err.message)}<br><br><a href="/dashboard.html#invoices">Zum Dashboard</a>`;
        });
})();
