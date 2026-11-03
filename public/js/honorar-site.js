/*
 * Honorarrechner auf /honorare (Website). Rechnet mit public/js/honorar-calc.js (window.PSHonorar) – derselbe Kern wie die
 * Vorschau im Dashboard und der Server (Angebote HON-…).
 *
 *  - „Worum geht es?“: Rechtsgebiet wählen (Vorauswahl über /honorare?gebiet=zivilrecht, z. B. von der Seite des Gebiets)
 *  - Assistent (3–4 Fragen → Empfehlung mit Preis) oder „Alle Leistungen“ (Liste mit Paketen)
 *  - je Leistung: Menge, Streitwert/Schaden-Regler, Zuschläge, „Was ist enthalten?“, Spanne, „Nur bei Erfolg“
 *  - Anwalt wählen (Satz je Rang), Rechenweg sichtbar, Angebot als Link/Code (HON-4821) speichern
 * Die Auswahl steht im DOM (.calc-check, Regler, Zuschläge) – calculateTotal() liest sie jedes Mal neu.
 */
(() => {
  'use strict';
  const root = document.getElementById('rechner');
  const H = window.PSHonorar;
  if (!root || !H) return;
  const PS = window.PS || {};
  const esc = PS.esc || ((s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  const { money, range, pctText } = H;
  const $ = (sel, el = document) => el.querySelector(sel);

  const st = {
    fees: null, // Leistungen im Tarifrechner (inCalculator)
    packages: [],
    rankFactors: {},
    areas: [], // [{ key, name }]
    team: [],
    area: new URLSearchParams(location.search).get('gebiet') || '',
    tab: 'liste',
    packageId: null,
    quote: null,
    offer: null, // { code, url, sig } – gespeichertes Angebot zur aktuellen Auswahl
    wizard: { step: 0, area: '', feeId: null, value: null, qty: 1, urgency: '' },
  };

  /* ---------------------------------------------------------------- Daten */
  const feesOfArea = (area) => (st.fees || []).filter((f) => !area || !f.areas || !f.areas.length || f.areas.includes(area));
  const packagesOfArea = (area) => st.packages.filter((p) => !area || !p.area || p.area === area).filter((p) => p.feeIds.every((id) => (st.fees || []).some((f) => f.id === id)));
  const areaName = (key) => (st.areas.find((a) => a.key === key) || {}).name || key;
  /** Rechtsgebiete, zu denen es eigene Leistungen gibt (allgemeine Leistungen gelten überall). */
  const usedAreas = () => st.areas.filter((a) => (st.fees || []).some((f) => f.areas && f.areas.includes(a.key)) || st.packages.some((p) => p.area === a.key));

  /** Fallback ohne Daten: die statischen Optionen als Festpreise. */
  function staticFees() {
    return [...document.querySelectorAll('#calcOptions .calc-check')].map((cb, i) => {
      if (!cb.dataset.fee) cb.dataset.fee = String(100000 + i);
      return { id: Number(cb.dataset.fee), name: cb.dataset.name || `Leistung ${i + 1}`, price: Number(cb.value) || 0, model: 'fest' };
    });
  }

  /* ---------------------------------------------------------------- Rechtsgebiete */
  function renderAreas() {
    const box = $('#hrAreas');
    if (!box) return;
    const list = usedAreas();
    if (st.area && st.areas.length && st.fees && !list.some((a) => a.key === st.area)) st.area = ''; // erst prüfen, wenn alles geladen ist
    box.innerHTML = [['', 'Alle Rechtsgebiete'], ...list.map((a) => [a.key, a.name])]
      .map(([k, n]) => `<button type="button" class="hr-area${st.area === k ? ' is-on' : ''}" role="radio" aria-checked="${st.area === k}" data-hr-area="${esc(k)}">${esc(n)}</button>`)
      .join('');
    box.closest('.hr-ask').hidden = list.length === 0;
  }

  /* ---------------------------------------------------------------- Liste */
  function optionHtml(f, keep) {
    const c = H.configOf(f);
    const from = H.fromPrice(f);
    const k = keep.get(f.id) || {};
    const val = k.value ?? c.valueDefault;
    const ctl = [];
    if (H.needsValue(f)) {
      ctl.push(`<label class="hr-range-row"><span class="hr-range-k">${esc(c.valueLabel)}</span><output class="hr-range-v" data-hr-out>${money(val)}</output>
        <input type="range" class="hr-range" data-hr-value min="${c.valueMin}" max="${c.valueMax}" step="${c.valueStep}" value="${val}" aria-label="${esc(c.valueLabel)}"></label>`);
    }
    if (f.model === 'einheit') {
      const q = k.qty || 1;
      ctl.push(`<div class="hr-qty-row"><span class="hr-range-k">Anzahl ${esc(c.unit)}${c.unit.endsWith('e') ? 'n' : ''}</span><span class="hr-qty"><button type="button" class="hr-qty-b" data-hr-qty="-1" aria-label="Weniger">−</button><output data-hr-qtyv>${q}</output><button type="button" class="hr-qty-b" data-hr-qty="1" aria-label="Mehr">+</button></span></div>`);
    }
    if (Array.isArray(f.surcharges) && f.surcharges.length) {
      ctl.push(`<div class="hr-surs">${f.surcharges
        .map((s) => `<label class="hr-chip"><input type="checkbox" data-hr-sur="${esc(s.name)}"${k.surcharges && k.surcharges.includes(s.name) ? ' checked' : ''}><span>${esc(s.name)} ${s.pct ? `+${pctText(s.pct)}` : `+${money(s.amount)}`}</span></label>`)
        .join('')}</div>`);
    }
    ctl.push('<p class="hr-line" data-hr-line></p>');
    const badge = f.model === 'erfolg' ? '<span class="hr-badge">Nur bei Erfolg</span>' : f.model === 'grund_erfolg' ? '<span class="hr-badge is-soft">+ Erfolgsanteil</span>' : '';
    const inc = f.includes && f.includes.length ? `<details class="hr-inc"><summary>Was ist enthalten?</summary><ul>${f.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '';
    return `<div class="calc-opt hr-opt" data-fee="${f.id}" data-model="${esc(f.model || 'fest')}">
        <label class="calc-opt-main min-w-0">
          <input type="checkbox" class="calc-check" value="${from.low}" data-fee="${f.id}" data-name="${esc(f.name)}"${k.on ? ' checked' : ''}>
          <span class="min-w-0"><span class="calc-opt-name">${esc(f.name)}</span>${badge}${f.description ? `<span class="hr-desc">${esc(f.description)}</span>` : ''}</span>
        </label>
        <span class="calc-opt-price">${esc(from.text)}</span>
        <div class="hr-ctl">${ctl.join('')}</div>
        ${inc}
      </div>`;
  }

  /** Auswahl merken (beim Neuzeichnen nach Gebietswechsel bleibt, was gewählt war). */
  function currentKeep() {
    const keep = new Map();
    document.querySelectorAll('#calcOptions .hr-opt').forEach((o) => {
      const id = Number(o.dataset.fee);
      const cb = $('.calc-check', o);
      keep.set(id, {
        on: cb && cb.checked,
        value: $('[data-hr-value]', o) ? Number($('[data-hr-value]', o).value) : undefined,
        qty: $('[data-hr-qtyv]', o) ? Number($('[data-hr-qtyv]', o).textContent) : undefined,
        surcharges: [...o.querySelectorAll('[data-hr-sur]:checked')].map((x) => x.dataset.hrSur),
      });
    });
    return keep;
  }

  function renderList(keep = currentKeep()) {
    const box = $('#calcOptions');
    if (!box || !st.fees) return;
    // Gewählte Leistungen anderer Gebiete bleiben sichtbar (sonst verschwänden sie still aus der Summe)
    const list = (st.fees || []).filter((f) => feesOfArea(st.area).includes(f) || (keep.get(f.id) || {}).on);
    box.innerHTML = list.length ? list.map((f) => optionHtml(f, keep)).join('') : '<p class="text-sm text-[var(--text-muted)] py-4">Für dieses Rechtsgebiet sind noch keine Leistungen hinterlegt.</p>';
    renderPackages();
  }

  function packageSaving(p) {
    const list = p.feeIds.map((id) => st.fees.find((f) => f.id === id)).filter(Boolean);
    const sum = list.reduce((s, f) => s + H.position(f, {}, 1).low, 0);
    return { list, sum, saving: Math.max(0, sum - p.price) };
  }
  function renderPackages() {
    const box = $('#hrPackages');
    if (!box) return;
    const list = packagesOfArea(st.area);
    if (st.packageId && !list.some((p) => p.id === st.packageId)) st.packageId = null;
    box.hidden = !list.length;
    box.innerHTML = list.length
      ? `<h3 class="hr-h">Pakete${st.area ? ` für ${esc(areaName(st.area))}` : ''}</h3><div class="hr-pack-grid">${list
          .map((p) => {
            const s = packageSaving(p);
            const on = st.packageId === p.id;
            return `<button type="button" class="hr-pack${on ? ' is-on' : ''}" data-hr-pack="${p.id}" aria-pressed="${on}">
              <span class="hr-pack-top"><span class="hr-pack-name">${esc(p.name)}</span>${s.saving ? `<span class="hr-save">Sie sparen ${money(s.saving)}</span>` : ''}</span>
              ${p.description ? `<span class="hr-pack-desc">${esc(p.description)}</span>` : ''}
              <span class="hr-pack-list">${s.list.map((f) => esc(f.name)).join(' · ')}</span>
              <span class="hr-pack-price">${s.saving ? `<s>${money(s.sum)}</s>` : ''}<b>${money(p.price)}</b><span class="hr-pack-act">${on ? 'Gewählt ✓' : 'Paket wählen'}</span></span>
            </button>`;
          })
          .join('')}</div>`
      : '';
  }

  /* ---------------------------------------------------------------- Anwalt (Satz je Rang) */
  function renderLawyers() {
    const sel = $('#hrLawyer');
    if (!sel) return;
    const keep = sel.value;
    const people = (st.team || []).filter((m) => m.roleTitle);
    sel.innerHTML = `<option value="">Kanzlei (Standardsatz)</option>${people
      .map((m) => {
        const f = st.rankFactors[m.roleTitle];
        return `<option value="${m.id}">${esc(m.name)} – ${esc(m.roleTitle)}${f && f !== 1 ? ` (${String(f).replace('.', ',')}×)` : ''}</option>`;
      })
      .join('')}`;
    sel.value = keep;
    sel.closest('.hr-lawyer').hidden = !people.length || !Object.keys(st.rankFactors).length;
  }
  function lawyer() {
    const id = Number($('#hrLawyer') && $('#hrLawyer').value);
    const m = id && st.team.find((x) => x.id === id);
    if (!m) return { id: null, factor: 1, label: '' };
    return { id: m.id, factor: st.rankFactors[m.roleTitle] || 1, label: `${m.name} (${m.roleTitle})`, name: m.name };
  }

  /* ---------------------------------------------------------------- Rechnen */
  function picks() {
    return [...document.querySelectorAll('#calcOptions .calc-check:checked')].map((cb) => {
      const o = cb.closest('.hr-opt');
      const p = { id: Number(cb.dataset.fee) };
      if (o) {
        const v = $('[data-hr-value]', o);
        const q = $('[data-hr-qtyv]', o);
        if (v) p.value = Number(v.value);
        if (q) p.qty = Number(q.textContent) || 1;
        const sur = [...o.querySelectorAll('[data-hr-sur]:checked')].map((x) => x.dataset.hrSur);
        if (sur.length) p.surcharges = sur;
      }
      return p;
    });
  }
  const selection = () => ({ area: st.area || undefined, picks: picks(), packageId: st.packageId || null, teamMemberId: lawyer().id || null, priority: !!($('#priorityAddon') && $('#priorityAddon').checked) });

  /** Beschriftung des Prioritätszuschlags und des Bündelrabatts nach den Einstellungen. */
  function syncLabels(calc) {
    const opt = document.getElementById('priorityAddon')?.closest('.calc-opt');
    const pct = calc.priorityPct ?? 15;
    if (opt) {
      const name = opt.querySelector('.calc-opt-name');
      const sub = opt.querySelector('.calc-opt-sub');
      if (name) name.textContent = `${calc.priorityLabel || 'Priorisierte Bearbeitung'} (+${pctText(pct).replace(' %', '')} %)`;
      if (sub && calc.prioritySub !== undefined) {
        sub.textContent = calc.prioritySub;
        sub.hidden = !calc.prioritySub;
      }
      opt.hidden = !pct;
    }
  }

  function calculateTotal() {
    if (!document.getElementById('totalAmount')) return;
    const calc = PS.calc || {};
    syncLabels(calc);
    const fees = st.fees || staticFees();
    const lw = lawyer();
    const q = H.quote({ fees, packages: st.packages, picks: picks(), packageId: st.packageId, factor: lw.factor, factorLabel: lw.label, calc, priority: !!$('#priorityAddon')?.checked, promo: PS.promo || null });
    st.quote = q;
    if (st.offer && st.offer.sig !== JSON.stringify(selection())) hideCode();

    // Zeile je Leistung („Sie zahlen nur bei Erfolg …“)
    document.querySelectorAll('#calcOptions .hr-opt').forEach((o) => {
      const line = $('[data-hr-line]', o);
      const out = $('[data-hr-out]', o);
      const v = $('[data-hr-value]', o);
      if (out && v) out.textContent = money(Number(v.value));
      if (!line) return;
      const p = q.positions.find((x) => x.feeId === Number(o.dataset.fee));
      line.innerHTML = p ? lineText(p) : '';
    });

    const list = $('#selectedList');
    list.innerHTML = q.positions.length
      ? q.positions
          .map((p) => `<li class="hr-sel-item"><span>${esc(p.name)}${p.successOnly ? ' <em class="hr-badge">Nur bei Erfolg</em>' : ''}</span><span class="num">${p.successOnly ? `${money(p.success.amount)}*` : esc(range(p.low, p.high))}</span></li>`)
          .join('')
      : '<li class="italic text-gray-500">Keine Leistungen ausgewählt</li>';

    const dRow = $('#discountRow');
    dRow.classList.toggle('hidden', !q.bundle);
    $('#discountLabel').textContent = `Mandatsbündel-Rabatt (${pctText(q.bundle ? q.bundle.pct : calc.bundlePct ?? 10)})`;
    $('#discountAmount').textContent = `− ${q.bundle ? range(q.bundle.low, q.bundle.high) : '0 $'}`;
    const pRow = $('#promoRow');
    if (pRow) {
      pRow.classList.toggle('hidden', !q.promo || !q.promo.high);
      pRow.className = pRow.className.replace(/\s*occ-\w+/g, '') + (q.promo && q.promo.occasion ? ` occ-${q.promo.occasion}` : '');
      if (q.promo) $('#promoLabel').textContent = `${q.promo.icon ? `${q.promo.icon} ` : ''}${q.promo.name} (${pctText(q.promo.pct)})`;
      $('#promoAmount').textContent = `− ${q.promo ? range(q.promo.low, q.promo.high) : '0 $'}`;
    }
    $('#totalAmount').textContent = range(q.totalLow, q.totalHigh);
    const note = $('#totalNote');
    note.textContent = q.priority
      ? `inkl. Zuschlag ${q.priority.name.toLowerCase()} (+${range(q.priority.low, q.priority.high)})`
      : q.promo && q.promo.high
        ? `${q.promo.name} automatisch angewendet`
        : q.bundle
          ? 'Mandatsbündel-Rabatt automatisch angewendet'
          : q.totalHigh > q.totalLow
            ? 'Spanne je nach Aufwand – den genauen Betrag nennt Ihr Anwalt vorab'
            : !q.totalHigh && q.success.length
              ? 'Vorab nichts – Sie zahlen nur bei Erfolg'
              : '';
    // Erfolgshonorar: eigener Kasten
    const succ = $('#hrSuccess');
    succ.hidden = !q.success.length;
    succ.innerHTML = q.success.length
      ? `<div class="hr-success-k"><span class="hr-badge">Nur bei Erfolg</span>zusätzlich</div>${q.success
          .map((s) => `<p>Sie zahlen nur bei Erfolg: <b>${pctText(s.pct)} von ${money(s.value)} = ${money(s.amount)}</b>${s.amount !== Math.round((s.value * s.pct) / 100) ? ` <span class="hr-dim">(${esc(s.steps.slice(1).join(', '))})</span>` : ''}</p>`)
          .join('')}${q.positions.some((p) => p.successOnly) ? '<p class="hr-dim">* Gewinnen wir nicht, zahlen Sie dafür nichts.</p>' : ''}`
      : '';
    // Rechenweg
    const way = $('#hrWay');
    way.hidden = !q.positions.length;
    $('#hrSteps').innerHTML = q.positions.length
      ? [...q.positions.map((p) => `<li><b>${esc(p.name)}</b>${p.steps.map((s) => `<span>${esc(s)}</span>`).join('')}</li>`), ...q.steps.map((s) => `<li class="is-sum">${esc(s)}</li>`)].join('')
      : '';
    if (PS.countUp) {
      PS.countUp($('#totalAmount').parentElement, { ms: 700 });
      PS.countUp(dRow, { ms: 500 });
      if (pRow) PS.countUp(pRow, { ms: 500 });
    }
    return q;
  }
  function lineText(p) {
    if (p.successOnly) return `Sie zahlen nur bei Erfolg: <b>${pctText(p.success.pct)} von ${money(p.success.value)} = ${money(p.success.amount)}</b>`;
    if (p.success) return `Jetzt ${esc(range(p.low, p.high))}, bei Erfolg zusätzlich <b>${pctText(p.success.pct)} von ${money(p.success.value)} = ${money(p.success.amount)}</b>`;
    return `<b>${esc(range(p.low, p.high))}</b>${p.surcharges.length ? ` inkl. ${p.surcharges.map((s) => esc(s.name)).join(', ')}` : ''}`;
  }

  /* ---------------------------------------------------------------- Angebot speichern (Code + Link) */
  function hideCode() {
    st.offer = null;
  }
  async function ensureOffer() {
    const sel = selection();
    const sig = JSON.stringify(sel);
    if (st.offer && st.offer.sig === sig) return st.offer;
    if (!sel.picks.length && !sel.packageId) return null;
    const r = await PS.api.post('/api/public/offers', sel);
    st.offer = { code: r.code, url: r.url, sig };
    return st.offer;
  }
  /** Text für das Mandatsformular (home.js → openTicketModal('calc')). */
  function ticketText() {
    const q = st.quote || calculateTotal();
    if (!q || !q.positions.length) return '';
    const lw = lawyer();
    const lines = q.positions.map((p) => `• ${p.name}: ${p.successOnly ? `nur bei Erfolg ${pctText(p.success.pct)} von ${money(p.success.value)}` : range(p.low, p.high)}${p.success && !p.successOnly ? ` + ${pctText(p.success.pct)} bei Erfolg` : ''}`);
    return `Gewünschte Leistungen${q.priority ? ' (priorisierte Bearbeitung)' : ''}${lw.id ? ` bei ${lw.name}` : ''}:\n${lines.join('\n')}\nGeschätztes Honorar laut Tarifrechner: ${range(q.totalLow, q.totalHigh)}${q.success.length ? ` (+ Erfolgshonorar ${money(q.successTotal)} nur bei Erfolg)` : ''}\n\nSachverhalt: `;
  }

  /* ---------------------------------------------------------------- Assistent */
  function wizardHtml() {
    const w = st.wizard;
    const area = w.area || st.area;
    // Leistungen des Gebiets zuerst, allgemeine danach
    const pool = [...feesOfArea(area).filter((f) => f.areas && f.areas.length), ...feesOfArea(area).filter((f) => !f.areas || !f.areas.length)];
    const fee = pool.find((f) => f.id === w.feeId) || null;
    const steps = [];
    // 1 Rechtsgebiet
    steps.push(`<div class="hr-wq${area ? ' is-done' : ''}"><div class="hr-wq-k"><span class="hr-wq-n">1</span>Worum geht es?</div>
      <div class="hr-wq-a">${usedAreas()
        .map((a) => `<button type="button" class="hr-area${area === a.key ? ' is-on' : ''}" data-hr-w="area" data-v="${esc(a.key)}">${esc(a.name)}</button>`)
        .join('')}</div></div>`);
    if (area) {
      steps.push(`<div class="hr-wq${fee ? ' is-done' : ''}"><div class="hr-wq-k"><span class="hr-wq-n">2</span>Was brauchen Sie?</div>
        <div class="hr-wq-a hr-wq-list">${pool
          .map((f) => `<button type="button" class="hr-wopt${w.feeId === f.id ? ' is-on' : ''}" data-hr-w="fee" data-v="${f.id}"><span>${esc(f.name)}</span><small>${esc(H.fromPrice(f).text)}</small></button>`)
          .join('')}</div></div>`);
    }
    let n = 3;
    if (fee && H.needsValue(fee)) {
      const c = H.configOf(fee);
      const v = w.value ?? c.valueDefault;
      steps.push(`<div class="hr-wq is-done"><div class="hr-wq-k"><span class="hr-wq-n">${n++}</span>Um welchen Betrag geht es? <span class="hr-dim">(${esc(c.valueLabel)})</span></div>
        <label class="hr-range-row"><output class="hr-range-v" data-hr-wout>${money(v)}</output><input type="range" class="hr-range" data-hr-w="value" min="${c.valueMin}" max="${c.valueMax}" step="${c.valueStep}" value="${v}" aria-label="${esc(c.valueLabel)}"></label></div>`);
    } else if (fee && fee.model === 'einheit') {
      const c = H.configOf(fee);
      steps.push(`<div class="hr-wq is-done"><div class="hr-wq-k"><span class="hr-wq-n">${n++}</span>Wie viele ${esc(c.unit)}${c.unit.endsWith('e') ? 'n' : 'n'} schätzen Sie?</div>
        <div class="hr-wq-a">${[1, 2, 4, 8].map((q) => `<button type="button" class="hr-area${(w.qty || 1) === q ? ' is-on' : ''}" data-hr-w="qty" data-v="${q}">${q}</button>`).join('')}</div></div>`);
    }
    if (fee) {
      const calc = PS.calc || {};
      const prio = (calc.priorityPct ?? 15) > 0 ? [['__prio', `${calc.priorityLabel || 'Priorisierte Bearbeitung'} (+${pctText(calc.priorityPct ?? 15)})`]] : [];
      const urg = [['', 'Normal'], ...(fee.surcharges || []).map((s) => [s.name, `${s.name} (${s.pct ? `+${pctText(s.pct)}` : `+${money(s.amount)}`})`]), ...prio];
      steps.push(`<div class="hr-wq${w.urgency !== null ? ' is-done' : ''}"><div class="hr-wq-k"><span class="hr-wq-n">${n++}</span>Wie eilig ist es?</div>
        <div class="hr-wq-a">${urg.map(([k, l]) => `<button type="button" class="hr-area${(w.urgency || '') === k ? ' is-on' : ''}" data-hr-w="urgency" data-v="${esc(k)}">${esc(l)}</button>`).join('')}</div></div>`);
      steps.push(recommendationHtml(fee, area));
    }
    return `<div class="hr-wizard">${steps.join('')}</div>`;
  }
  /** Empfehlung: lohnt sich ein Paket mit dieser Leistung, steht es vorn – sonst die Leistung allein. */
  function recommendation(fee, area) {
    const w = st.wizard;
    const prio = w.urgency === '__prio';
    const pick = { id: fee.id, value: w.value ?? undefined, qty: w.qty || 1, surcharges: w.urgency && !prio ? [w.urgency] : [] };
    const lw = lawyer();
    const base = { fees: st.fees, packages: st.packages, factor: lw.factor, factorLabel: lw.label, calc: PS.calc || {}, promo: PS.promo || null, priority: prio };
    const single = H.quote({ ...base, picks: [pick] });
    const pack = packagesOfArea(area).find((p) => p.feeIds.includes(fee.id) && packageSaving(p).saving > 0);
    return { pick, prio, single, pack, packQuote: pack ? H.quote({ ...base, packageId: pack.id, picks: [] }) : null };
  }
  function recommendationHtml(fee, area) {
    const r = recommendation(fee, area);
    const p = r.single.positions[0];
    const price = p.successOnly
      ? `Nur bei Erfolg: ${pctText(p.success.pct)} von ${money(p.success.value)} = ${money(p.success.amount)}${r.single.totalHigh ? ` (+ ${range(r.single.totalLow, r.single.totalHigh)} Zuschlag)` : ''}`
      : `${range(r.single.totalLow, r.single.totalHigh)}${p.success ? ` + ${pctText(p.success.pct)} bei Erfolg` : ''}`;
    return `<div class="hr-rec">
        <div class="hr-rec-k">Unsere Empfehlung</div>
        <div class="hr-rec-name">${esc(fee.name)}</div>
        <div class="hr-rec-price">${esc(price)}</div>
        ${fee.includes && fee.includes.length ? `<ul class="hr-rec-inc">${fee.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.pack ? `<div class="hr-rec-pack"><b>Tipp:</b> Im Paket „${esc(r.pack.name)}“ ist das schon enthalten – ${money(r.packQuote.totalLow)} für alles, Sie sparen ${money(packageSaving(r.pack).saving)}.</div>` : ''}
        <div class="hr-rec-act"><button type="button" class="btn-gold kz-btn" data-hr-w="take">Übernehmen</button>${r.pack ? `<button type="button" class="btn-outline kz-btn" data-hr-w="takepack" data-v="${r.pack.id}">Paket nehmen</button>` : ''}</div>
      </div>`;
  }
  function renderWizard() {
    const box = $('#hrAssistant');
    if (box && st.tab === 'assistent') box.innerHTML = st.fees ? wizardHtml() : '<p class="text-sm text-[var(--text-muted)]">Wird geladen …</p>';
  }

  /* ---------------------------------------------------------------- Ansicht */
  function setTab(tab) {
    st.tab = tab;
    root.querySelectorAll('[data-hr-tab]').forEach((b) => {
      const on = b.dataset.hrTab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('#hrAssistant').hidden = tab !== 'assistent';
    $('#hrList').hidden = tab === 'assistent';
    if (tab === 'assistent') {
      st.wizard = { step: 0, area: st.area, feeId: null, value: null, qty: 1, urgency: null };
      renderWizard();
    }
  }
  function setArea(key) {
    st.area = key;
    const url = new URL(location.href);
    if (key) url.searchParams.set('gebiet', key);
    else url.searchParams.delete('gebiet');
    history.replaceState(history.state, '', url);
    renderAreas();
    renderList();
    if (st.tab === 'assistent') {
      st.wizard = { step: 0, area: key, feeId: null, value: null, qty: 1, urgency: null };
      renderWizard();
    }
    calculateTotal();
  }

  /** Auswahl aus einem gespeicherten Angebot wiederherstellen. */
  function applySelection(sel) {
    const keep = new Map();
    for (const p of sel.picks || []) keep.set(Number(p.id), { on: true, value: p.value, qty: p.qty, surcharges: p.surcharges || [] });
    if (sel.area) st.area = sel.area;
    st.packageId = sel.packageId || null;
    renderAreas();
    renderList(keep);
    if ($('#hrLawyer') && sel.teamMemberId) $('#hrLawyer').value = String(sel.teamMemberId);
    if ($('#priorityAddon')) $('#priorityAddon').checked = !!sel.priority;
  }

  /* ---------------------------------------------------------------- Ereignisse */
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-hr-area], [data-hr-tab], [data-hr-pack], [data-hr-qty], [data-hr-w]');
    if (!t) return;
    if (t.dataset.hrArea !== undefined) return setArea(t.dataset.hrArea);
    if (t.dataset.hrTab) return setTab(t.dataset.hrTab);
    if (t.dataset.hrPack) {
      const id = Number(t.dataset.hrPack);
      st.packageId = st.packageId === id ? null : id;
      renderPackages();
      return calculateTotal();
    }
    if (t.dataset.hrQty) {
      const o = t.closest('.hr-opt');
      const out = $('[data-hr-qtyv]', o);
      const f = st.fees && st.fees.find((x) => x.id === Number(o.dataset.fee));
      const max = f ? H.configOf(f).unitMax : 99;
      out.textContent = String(Math.max(1, Math.min(max, (Number(out.textContent) || 1) + Number(t.dataset.hrQty))));
      const cb = $('.calc-check', o);
      if (!cb.checked) cb.checked = true;
      return calculateTotal();
    }
    const w = st.wizard;
    const k = t.dataset.hrW;
    if (k === 'area') Object.assign(w, { area: t.dataset.v, feeId: null, value: null, qty: 1, urgency: null });
    else if (k === 'fee') Object.assign(w, { feeId: Number(t.dataset.v), value: null, qty: 1, urgency: null });
    else if (k === 'qty') w.qty = Number(t.dataset.v);
    else if (k === 'urgency') w.urgency = t.dataset.v;
    else if (k === 'take' || k === 'takepack') {
      const fee = st.fees.find((f) => f.id === w.feeId);
      const r = recommendation(fee, w.area || st.area);
      if (k === 'takepack') applySelection({ area: w.area || st.area, picks: [], packageId: Number(t.dataset.v), priority: r.prio });
      else applySelection({ area: w.area || st.area, picks: [r.pick], packageId: null, priority: r.prio });
      setTab('liste');
      calculateTotal();
      $('#hrList').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    renderWizard();
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-hr-value]')) {
      const cb = $('.calc-check', t.closest('.hr-opt'));
      if (cb && !cb.checked) cb.checked = true;
      calculateTotal();
    } else if (t.matches('[data-hr-w="value"]')) {
      st.wizard.value = Number(t.value);
      const out = root.querySelector('[data-hr-wout]');
      if (out) out.textContent = money(st.wizard.value);
      const rec = root.querySelector('.hr-rec');
      const fee = st.fees.find((f) => f.id === st.wizard.feeId);
      if (rec && fee) rec.outerHTML = recommendationHtml(fee, st.wizard.area || st.area);
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-hr-sur]')) {
      const cb = $('.calc-check', t.closest('.hr-opt'));
      if (cb && !cb.checked) cb.checked = true;
      calculateTotal();
    } else if (t.id === 'hrLawyer') {
      calculateTotal();
      if (st.tab === 'assistent') renderWizard();
    } else if (t.classList.contains('calc-check')) calculateTotal();
  });
  // Rabattaktion (siteconfig.js): Plakette am Rechner, Summe neu rechnen
  function promoBadge() {
    const promo = PS.promo;
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
  }
  window.addEventListener('ps:promo', () => {
    promoBadge();
    calculateTotal();
  });

  /* ---------------------------------------------------------------- Start */
  /** site.js übergibt die Honorarordnung (Leistungen, Pakete, Rang-Faktoren). */
  function setData(r) {
    const keep = currentKeep();
    st.fees = (r.fees || []).filter((f) => f.inCalculator);
    st.packages = r.packages || [];
    st.rankFactors = r.rankFactors || {};
    renderAreas();
    renderList(keep);
    renderLawyers();
    renderWizard();
    calculateTotal();
  }
  function setTeam(team) {
    st.team = team || [];
    renderLawyers();
  }
  function setAreas(list) {
    st.areas = (list || []).filter((a) => a.key && a.key !== 'sonstiges').map((a) => ({ key: a.key, name: a.name }));
    renderAreas();
    renderList(); // Gebiet aus der Adresse greift erst jetzt
    if (st.tab === 'assistent') renderWizard();
  }

  window.calculateTotal = calculateTotal;
  window.PSHonorarSite = { setData, setTeam, setAreas, calculateTotal, ticketText, ensureOffer, area: () => st.area };

  // Honorarordnung und Rechtsgebiete lädt site.js (kamen sie schon an, liegen sie in PS); das Team für den Satz je Rang hier
  if (PS.areaList) setAreas(PS.areaList);
  if (PS.feesData) setData(PS.feesData);
  if (PS.boot) PS.boot('team', '/api/team').then((r) => setTeam(r.team || [])).catch(() => {});
  // Gespeichertes Angebot: /honorare?angebot=HON-4821
  const code = new URLSearchParams(location.search).get('angebot');
  if (code && PS.api) {
    const wait = () => (st.fees ? Promise.resolve() : new Promise((res) => setTimeout(() => res(wait()), 120)));
    PS.api
      .get(`/api/public/offers/${encodeURIComponent(code)}`)
      .then(async (o) => {
        await wait();
        applySelection(o.selection || {});
        calculateTotal();
        root.scrollIntoView({ block: 'start' });
      })
      .catch(() => PS.toast && PS.toast('Dieses Angebot gibt es nicht (mehr).', 'error'));
  }
  promoBadge(); // die Aktion kann schon vor diesem Skript angekommen sein
  calculateTotal();
})();
