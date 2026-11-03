/*
 * Startseite (index.html): Dialoge, Mobil-Menü, Honorarordnung (Filter, Suche, Sortierung), Tarifrechner, FAQ,
 * E-Mail kopieren, Uhr, Scrollspy und Einblendungen. Früher als Inline-Skript in der Seite – jetzt eigene Datei,
 * damit die Content-Security-Policy keine Inline-Skripte mehr erlauben muss. Klassisches Skript: die Funktionen
 * bleiben global (site.js ruft z. B. calculateTotal, setCategory und sortPrices auf).
 * Wird VOR api.js und site.js geladen. Wie früher das Inline-Skript ohne „use strict“.
 */

/* ---------- Bedienelemente: statt onclick-Attributen in der Seite steht data-act="…" ---------- */
// Vor allen anderen Listenern angemeldet – dieselbe Reihenfolge wie früher die Inline-Handler.
const PAGE_ACTIONS = {
    menu: () => toggleMobileMenu(),
    ticket: (el) => openTicketModal(el.dataset.source),
    'ticket-close': () => closeTicketModal(),
    'ticket-lawyer-clear': () => setWishLawyer(null),
    concern: (el) => window.openConcernModal(el.dataset.mode || undefined),
    'concern-close': () => window.closeConcernModal(),
    faq: (el) => toggleFaq(el),
    category: (el) => setCategory(el.dataset.cat),
    top: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
};
document.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => el.dataset.act.split(' ').forEach((name) => PAGE_ACTIONS[name](el, e)));
});
// Tarifrechner (auch die von site.js nachgeladenen Leistungen), Suche und Sortierung der Honorarordnung, Mandatsformular
document.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('calc-check')) calculateTotal();
});
document.getElementById('priceSearch').addEventListener('input', () => {
    priceManual.clear(); // neue Suche: aufklappen, was passt
    filterPrices();
});
document.getElementById('priceSort').addEventListener('change', () => sortPrices());
document.getElementById('ticketForm').addEventListener('submit', (e) => window.handleFormSubmit(e));

/* ---------- Modal Control ---------- */
// Das Absenden (handleFormSubmit) übernimmt /js/site.js.
function openTicketModal(source, lawyer = null) {
    const modal = document.getElementById('ticketModal');
    document.getElementById('ticketFormWrap').classList.remove('hidden');
    document.getElementById('ticketSuccess').classList.add('hidden');
    setWishLawyer(lawyer); // „Direkt anfragen“ auf einer Teamkarte – alle anderen Knöpfe senden an die ganze Kanzlei
    // Auswahl aus dem Tarifrechner in den Sachverhalt übernehmen
    if (source === 'calc') {
        const picked = Array.from(document.querySelectorAll('.calc-check:checked:not(#priorityAddon)')).map((cb) => cb.getAttribute('data-name'));
        const desc = document.getElementById('tkDesc');
        if (picked.length && desc && !desc.value.trim()) {
            const prio = document.getElementById('priorityAddon').checked ? ' (priorisierte Bearbeitung)' : '';
            desc.value = `Gewünschte Leistungen${prio}: ${picked.join(', ')}.\nGeschätztes Honorar laut Tarifrechner: ${document.getElementById('totalAmount').textContent}\n\nSachverhalt: `;
        }
    }
    modal.classList.remove('opacity-0', 'pointer-events-none');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { if (window.matchMedia('(min-width: 768px)').matches) document.getElementById('tkName').focus(); }, 50);
}
/** Wunschanwalt im Mandatsformular setzen ({ id, name } der Teamkarte) oder entfernen (null). */
function setWishLawyer(lawyer) {
    const box = document.getElementById('tkLawyer');
    if (!box) return;
    box.querySelector('[name="teamMemberId"]').value = lawyer ? String(lawyer.id) : '';
    document.getElementById('tkLawyerName').textContent = lawyer ? lawyer.name : '';
    box.classList.toggle('hidden', !lawyer);
    box.classList.toggle('flex', !!lawyer);
}
window.openTicketModal = openTicketModal;
window.setWishLawyer = setWishLawyer;
function closeTicketModal() {
    const modal = document.getElementById('ticketModal');
    modal.classList.add('opacity-0', 'pointer-events-none');
    document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTicketModal(); });
/** Fenster bleibt offen und „wippt“ kurz – der Klick daneben ist angekommen, schließen geht mit X oder Esc. */
function nudgeDialog(panel) {
    if (!panel || typeof panel.animate !== 'function' || window.PS.motion.calm()) return;
    panel.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.012)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
}
window.nudgeDialog = nudgeDialog;
// Klick neben das Fenster schließt es (Eingaben bleiben erhalten) – nur nicht nach dem Absenden: Aktenzeichen und
// „Discord-Ticket beitreten“ gibt es nur dort. Wer im Fenster Text markiert und daneben loslässt, hat nicht daneben geklickt.
let ticketPressOutside = false;
document.getElementById('ticketModal').addEventListener('pointerdown', (e) => { ticketPressOutside = e.target.id === 'ticketModal'; });
document.getElementById('ticketModal').addEventListener('click', (e) => {
    if (e.target.id !== 'ticketModal' || !ticketPressOutside) return;
    if (!document.getElementById('ticketSuccess').classList.contains('hidden')) nudgeDialog(e.target.firstElementChild);
    else closeTicketModal();
});

/* ---------- Toast System ---------- */
function showToast(title, message) {
    const root = document.getElementById('toastRoot');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    const t = document.createElement('div');
    t.className = 'font-medium text-white text-sm mb-0.5';
    t.textContent = title;
    const m = document.createElement('div');
    m.className = 'text-xs text-[var(--text-muted)]';
    m.textContent = message;
    toast.append(t, m);
    root.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 300);
    }, 4200);
}

/* ---------- Mobile Menu ---------- */
function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const open = menu.classList.toggle('open');
    document.getElementById('menuIconOpen').classList.toggle('hidden', open);
    document.getElementById('menuIconClose').classList.toggle('hidden', !open);
    document.getElementById('menuToggle').setAttribute('aria-expanded', open);
    syncMobileCta();
}

// Mobil-Menü: erst zuklappen lassen, dann zum Abschnitt springen. Sonst wird der Sprung berechnet,
// solange das Menü noch offen ist, und die Seite landet nach dem Zuklappen deutlich zu tief.
document.querySelectorAll('#mobileMenu a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
        const hash = link.getAttribute('href');
        const target = hash.length > 1 && document.querySelector(hash);
        if (!target) return;
        e.preventDefault();
        const menu = document.getElementById('mobileMenu');
        let done = false;
        const jump = () => {
            if (done) return;
            done = true;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.pushState(null, '', hash);
            // Lädt oberhalb noch etwas nach (Team, Stimmen …), verschiebt sich das Ziel – nach dem Scrollen nachjustieren
            const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 96;
            const settle = () => {
                if (Math.abs(target.getBoundingClientRect().top - pad) > 12) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
            if ('onscrollend' in window) window.addEventListener('scrollend', settle, { once: true });
            setTimeout(settle, 1400);
        };
        menu.addEventListener('transitionend', jump, { once: true });
        setTimeout(jump, 450); // falls kein Übergang läuft (z. B. reduzierte Bewegung)
    });
});

/* ---------- Honorarordnung: Kategorien auf- und zuklappen ---------- */
// Unter „Alle Leistungen“ ist die erste Kategorie offen, die übrigen zeigen nur ihre Überschrift mit der Anzahl.
// Ein Reiter öffnet seine Kategorie, eine Suche alle Kategorien mit Treffern; von Hand geöffnete bleiben offen.
const priceManual = new Map(); // Kategorie → offen (von Hand umgeschaltet)
function priceOpen(cat, index) {
    const key = cat.getAttribute('data-category');
    if (priceManual.has(key)) return priceManual.get(key);
    const query = document.getElementById('priceSearch').value.trim();
    const activeCat = document.querySelector('.tab-btn.active').getAttribute('data-cat');
    if (query) return [...cat.querySelectorAll('.price-item')].some((item) => item.style.display !== 'none');
    return activeCat !== 'all' || index === 0;
}
function applyPriceCollapse() {
    document.querySelectorAll('.price-category').forEach((cat, i) => {
        const open = priceOpen(cat, i);
        cat.classList.toggle('collapsed', !open);
        const head = cat.querySelector('.price-head');
        if (head) head.setAttribute('aria-expanded', String(open));
    });
}
function enhancePriceCategories() {
    document.querySelectorAll('.price-category').forEach((cat) => {
        const head = cat.firstElementChild;
        if (!head || head.classList.contains('price-head')) return;
        head.classList.add('price-head');
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        const n = cat.querySelectorAll('.price-item').length;
        head.insertAdjacentHTML('beforeend', `<span class="price-count">${n} ${n === 1 ? 'Leistung' : 'Leistungen'}</span><svg class="price-chev" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>`);
        const toggle = () => {
            priceManual.set(cat.getAttribute('data-category'), cat.classList.contains('collapsed'));
            applyPriceCollapse();
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    });
    applyPriceCollapse();
}

/* ---------- Category Filter ---------- */
function setCategory(cat) {
    priceManual.clear();
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
    });
    document.querySelectorAll('.price-category').forEach(category => {
        category.style.display = (cat === 'all' || category.getAttribute('data-category') === cat) ? 'block' : 'none';
    });
    filterPrices();
}

/* ---------- Live Price Search ---------- */
function filterPrices() {
    const query = document.getElementById('priceSearch').value.toLowerCase();
    const activeCat = document.querySelector('.tab-btn.active').getAttribute('data-cat');
    let visibleCount = 0;
    document.querySelectorAll('.price-item').forEach(item => {
        const name = item.getAttribute('data-name').toLowerCase();
        const cat = item.getAttribute('data-category');
        const matchesCat = activeCat === 'all' || cat === activeCat;
        const matchesQuery = name.includes(query);
        const show = matchesCat && matchesQuery;
        item.style.display = show ? 'flex' : 'none';
        if (show) visibleCount++;
    });
    document.getElementById('noResults').classList.toggle('hidden', visibleCount !== 0);
    applyPriceCollapse();
}

/* ---------- Price Sort ---------- */
function sortPrices() {
    const mode = document.getElementById('priceSort').value;
    document.querySelectorAll('.price-category').forEach(category => {
        const grid = category.querySelector('.grid');
        const items = Array.from(grid.querySelectorAll('.price-item'));
        if (mode === 'default') {
            items.sort((a, b) => a.dataset.originalIndex - b.dataset.originalIndex);
        } else {
            items.sort((a, b) => {
                const pa = parseInt(a.dataset.price), pb = parseInt(b.dataset.price);
                return mode === 'asc' ? pa - pb : pb - pa;
            });
        }
        items.forEach(item => grid.appendChild(item));
    });
}
document.querySelectorAll('.price-item').forEach((item, i) => item.dataset.originalIndex = i);
enhancePriceCategories();

/* ---------- Interactive Calculator ---------- */
const pctDe = (n) => String(n).replace('.', ',');
/** Beschriftung des Prioritätszuschlags und des Bündelrabatts nach den Einstellungen. */
function syncPriorityLabel(calc, priorityPct) {
    const opt = document.getElementById('priorityAddon')?.closest('.calc-opt');
    if (opt) {
        const name = opt.querySelector('.calc-opt-name');
        const sub = opt.querySelector('.calc-opt-sub');
        if (name) name.textContent = `${calc.priorityLabel || 'Priorisierte Bearbeitung'} (+${pctDe(priorityPct)} %)`;
        if (sub && calc.prioritySub !== undefined) { sub.textContent = calc.prioritySub; sub.hidden = !calc.prioritySub; }
        opt.hidden = !priorityPct;
    }
    const label = document.getElementById('discountLabel');
    if (label && calc.bundlePct !== undefined) label.textContent = `Mandatsbündel-Rabatt (${pctDe(calc.bundlePct)} %)`;
}
function calculateTotal() {
    const checkboxes = document.querySelectorAll('.calc-check:checked:not(#priorityAddon)');
    const priorityChecked = document.getElementById('priorityAddon').checked;
    let subtotal = 0;
    const listElement = document.getElementById('selectedList');
    listElement.innerHTML = '';

    if (checkboxes.length === 0) {
        listElement.innerHTML = '<li class="italic text-gray-500">Keine Leistungen ausgewählt</li>';
    } else {
        checkboxes.forEach(cb => {
            const price = parseInt(cb.value);
            const name = cb.getAttribute('data-name');
            subtotal += price;
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center text-white border-b border-slate-800 pb-1';
            li.innerHTML = `<span>${name}</span><span class="num text-[var(--gold-500)]">${price.toLocaleString('de-DE')} $</span>`;
            listElement.appendChild(li);
        });
    }

    // Bündelrabatt und Prioritätszuschlag aus den Einstellungen (Tarifrechner), sonst wie bisher 3 Leistungen / 10 % / 15 %
    const calc = (window.PS && window.PS.calc) || {};
    const bundleMin = calc.bundleMin || 3;
    const bundlePct = calc.bundlePct ?? 10;
    const priorityPct = calc.priorityPct ?? 15;
    syncPriorityLabel(calc, priorityPct);
    const bundleEligible = bundlePct > 0 && checkboxes.length >= bundleMin;
    const discount = bundleEligible ? Math.round((subtotal * bundlePct) / 100) : 0;
    document.getElementById('discountRow').classList.toggle('hidden', !bundleEligible);
    document.getElementById('discountAmount').textContent = '− ' + discount.toLocaleString('de-DE') + ' $';

    // Rabattaktion für alle (z. B. Halloween): kommt mit der Konfiguration (siteconfig.js → PS.promo), wie auf der Rechnung
    const promo = window.PS && window.PS.promo;
    const promoAmount = promo && subtotal ? Math.min(subtotal - discount, Math.round((subtotal * promo.pct) / 100)) : 0;
    const promoRow = document.getElementById('promoRow');
    if (promoRow) {
        promoRow.classList.toggle('hidden', !promoAmount);
        promoRow.className = promoRow.className.replace(/\s*occ-\w+/g, '') + (promo ? ` occ-${promo.occasion}` : '');
        if (promo) document.getElementById('promoLabel').textContent = `${promo.icon} ${promo.name} (${String(promo.pct).replace('.', ',')} %)`;
        document.getElementById('promoAmount').textContent = '− ' + promoAmount.toLocaleString('de-DE') + ' $';
    }

    let total = subtotal - discount - promoAmount;
    const noteEl = document.getElementById('totalNote');
    if (priorityChecked && total > 0) {
        const surcharge = Math.round((total * priorityPct) / 100);
        total += surcharge;
        noteEl.textContent = 'inkl. Zuschlag priorisierte Bearbeitung (+' + surcharge.toLocaleString('de-DE') + ' $)';
    } else if (promoAmount) {
        noteEl.textContent = `${promo.name} automatisch angewendet`;
    } else if (bundleEligible) {
        noteEl.textContent = 'Mandatsbündel-Rabatt automatisch angewendet';
    } else {
        noteEl.textContent = '';
    }

    document.getElementById('totalAmount').textContent = total.toLocaleString('de-DE') + ' $';
    // Rabatt und Summe laufen weich zum neuen Betrag (statt zu springen)
    if (window.PS && window.PS.countUp) {
        window.PS.countUp(document.getElementById('totalAmount').parentElement, { ms: 700 });
        window.PS.countUp(document.getElementById('discountAmount').parentElement, { ms: 500 });
        if (promoRow) window.PS.countUp(promoRow, { ms: 500 });
    }
}

/* ---------- Rabattaktion: Plakette im Rechner, Summe neu rechnen ---------- */
window.addEventListener('ps:promo', () => {
    const promo = window.PS && window.PS.promo;
    const head = document.getElementById('promoRow')?.closest('.glass-card')?.querySelector('h3');
    document.getElementById('calcPromoBadge')?.remove();
    if (promo && head) {
        const b = document.createElement('span');
        b.id = 'calcPromoBadge';
        b.className = `calc-promo-badge occ-${promo.occasion}`;
        b.textContent = `${promo.icon} −${String(promo.pct).replace('.', ',')} %`;
        b.title = `${promo.name} – automatisch abgezogen`;
        head.appendChild(b);
    }
    calculateTotal();
});

/* ---------- FAQ Accordion ---------- */
function toggleFaq(item) {
    const wasOpen = item.classList.contains('open');
    item.closest('.glass-card').querySelectorAll('.faq-item').forEach(f => {
        f.classList.remove('open');
        f.querySelector('button').setAttribute('aria-expanded', 'false');
    });
    if (!wasOpen) {
        item.classList.add('open');
        item.querySelector('button').setAttribute('aria-expanded', 'true');
    }
}

/* ---------- Mandantenstimmen: Karussell und echte Bewertungen siehe js/site.js ---------- */

/* ---------- Team & Honorarordnung lädt /js/site.js live aus der Datenbank ---------- */
document.getElementById('footerYear').textContent = new Date().getFullYear();

/* ---------- Live Clock ---------- */
function updateClock() {
    if (document.hidden) return; // im Hintergrund-Tab nichts zeichnen
    const now = new Date();
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockEl = document.getElementById('liveClock');
    const clockFooterEl = document.getElementById('liveClockFooter');
    if (clockEl) clockEl.textContent = time;
    if (clockFooterEl) clockFooterEl.textContent = time;
}
updateClock();
setInterval(updateClock, 1000);

/* ---------- Scrollspy Navigation: goldener Strich unter dem Menüpunkt siehe js/motion.js (nav[data-ink]) ---------- */

/* ---------- Reveal on Scroll ---------- */
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            revealObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ---------- Back to top + Scrollspy on scroll ---------- */
// Passiv und höchstens einmal pro Bild (der Browser muss beim Scrollen nicht auf das Skript warten)
let scrollQueued = false;
window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
        scrollQueued = false;
        document.getElementById('backToTop').classList.toggle('show', window.scrollY > 600);
        syncMobileCta();
    });
}, { passive: true });
// Fester Knopf „Mandat anfragen“ am Handy: nach dem Startbereich, nicht bei offenem Menü
function syncMobileCta() {
    const menuOpen = document.getElementById('mobileMenu').classList.contains('open');
    document.getElementById('mobileCta').classList.toggle('show', window.scrollY > 600 && !menuOpen);
}
