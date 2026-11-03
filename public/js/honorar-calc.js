/*
 * Honorar-Rechenkern: EINE Rechnung für Website (Tarifrechner), Dashboard (Live-Vorschau der Honorarordnung) und Server
 * (Angebote HON-…, Honorarvereinbarung in der Akte, Erfolgshonorar-Rechnung). Im Browser als window.PSHonorar, in Node per
 * require(). Keine Abhängigkeiten, kein DOM.
 *
 * Preismodelle je Leistung (fee.model, Einstellungen in fee.config):
 *   fest          Festpreis (price, optional bis priceMax = Spanne)
 *   einheit       je Einheit (price je unit, Menge wählt der Mandant; optional bis priceMax je Einheit)
 *   prozent       Prozent vom Streitwert (pct, minFee, cap)
 *   staffel       Staffel nach Streitwert (tiers: [{ upTo, price }], letzte Stufe upTo = 0 → „darüber“)
 *   erfolg        Erfolgshonorar: nur bei Erfolg pct vom erstrittenen Betrag (minFee, cap)
 *   grund_erfolg  Grundgebühr (base, optional bis baseMax) jetzt + Erfolgsanteil wie „erfolg“
 * Zuschläge je Leistung (fee.surcharges): [{ name, pct } | { name, amount }] – der Mandant hakt sie an.
 * Rang-Faktor (z. B. 1,2 für Founding Partner): gilt für alle Beträge außer dem Erfolgsanteil (Prozent ist Prozent).
 * Reihenfolge wie auf der Rechnung: Positionen → Bündelrabatt → Rabattaktion (beide auf die Zwischensumme) → Prioritätszuschlag.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PSHonorar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODELS = {
    fest: 'Festpreis',
    einheit: 'Je Einheit',
    prozent: 'Prozent vom Streitwert',
    staffel: 'Staffel nach Streitwert',
    erfolg: 'Erfolgshonorar',
    grund_erfolg: 'Grundgebühr + Erfolgsanteil',
  };
  const VALUE_MODELS = new Set(['prozent', 'staffel', 'erfolg', 'grund_erfolg']);
  const SUCCESS_MODELS = new Set(['erfolg', 'grund_erfolg']);

  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const round = (n) => Math.round(n);
  const money = (n) => `${round(n).toLocaleString('de-DE')} $`;
  const pctText = (n) => `${String(Math.round(num(n) * 100) / 100).replace('.', ',')} %`;
  const factorText = (f) => `× ${String(Math.round(f * 100) / 100).replace('.', ',')}`;
  const range = (lo, hi) => (round(hi) > round(lo) ? `${money(lo)} – ${money(hi)}` : money(lo));

  /** Einstellungen einer Leistung mit Vorgaben (alte Leistungen ohne Modell = Festpreis). */
  function configOf(fee) {
    const c = (fee && fee.config) || {};
    return {
      priceMax: num(c.priceMax),
      unit: String(c.unit || 'Stunde'),
      unitMax: Math.max(1, num(c.unitMax, 20)),
      pct: num(c.pct),
      minFee: num(c.minFee),
      cap: num(c.cap),
      base: num(c.base),
      baseMax: num(c.baseMax),
      tiers: Array.isArray(c.tiers) ? c.tiers.map((t) => ({ upTo: num(t.upTo), price: num(t.price) })).filter((t) => t.price >= 0) : [],
      valueLabel: String(c.valueLabel || (SUCCESS_MODELS.has(fee && fee.model) ? 'Erwarteter Schaden' : 'Streitwert')),
      valueMin: num(c.valueMin, 0),
      valueMax: num(c.valueMax, 1000000) || 1000000,
      valueStep: num(c.valueStep, 5000) || 5000,
      valueDefault: num(c.valueDefault, 50000),
    };
  }
  const modelOf = (fee) => (MODELS[fee && fee.model] ? fee.model : 'fest');
  const needsValue = (fee) => VALUE_MODELS.has(modelOf(fee));
  const isSuccess = (fee) => SUCCESS_MODELS.has(modelOf(fee));

  /** Erfolgsanteil: pct vom Betrag, mindestens minFee, höchstens cap – mit Rechenweg. */
  function successPart(c, value) {
    const raw = (value * c.pct) / 100;
    let amount = raw;
    const steps = [`${pctText(c.pct)} von ${money(value)} = ${money(raw)}`];
    if (c.minFee && amount < c.minFee) {
      amount = c.minFee;
      steps.push(`Mindesthonorar ${money(c.minFee)}`);
    }
    if (c.cap && amount > c.cap) {
      amount = c.cap;
      steps.push(`höchstens ${money(c.cap)} (Deckel)`);
    }
    return { pct: c.pct, value, amount: round(amount), minFee: c.minFee, cap: c.cap, steps };
  }

  /** Staffel: die erste Stufe, in die der Wert fällt (upTo 0 = „darüber“). */
  function tierFor(c, value) {
    const list = c.tiers.slice().sort((a, b) => (a.upTo || Infinity) - (b.upTo || Infinity));
    return list.find((t) => !t.upTo || value <= t.upTo) || list[list.length - 1] || null;
  }

  /**
   * Eine Position berechnen.
   * pick: { qty, value, surcharges: [Name] }; factor: Rang-Faktor (1 = Standard).
   * → { name, model, low, high, steps, success: {…}|null, successOnly, surcharges: [{name, low, high}] }
   */
  function position(fee, pick = {}, factor = 1) {
    const model = modelOf(fee);
    const c = configOf(fee);
    const price = num(fee.price);
    const steps = [];
    let low = 0;
    let high = 0;
    let success = null;
    const value = needsValue(fee) ? Math.max(0, num(pick.value, c.valueDefault)) : 0;
    if (model === 'fest') {
      low = price;
      high = Math.max(price, c.priceMax);
      steps.push(high > low ? `Festpreis ${range(low, high)} je nach Aufwand` : `Festpreis ${money(low)}`);
    } else if (model === 'einheit') {
      const qty = Math.max(1, Math.min(c.unitMax, Math.round(num(pick.qty, 1))));
      low = qty * price;
      high = qty * Math.max(price, c.priceMax);
      steps.push(`${qty} × ${range(price, Math.max(price, c.priceMax))} je ${c.unit} = ${range(low, high)}`);
    } else if (model === 'prozent') {
      const raw = (value * c.pct) / 100;
      low = raw;
      steps.push(`${pctText(c.pct)} von ${money(value)} (${c.valueLabel}) = ${money(raw)}`);
      if (c.minFee && low < c.minFee) {
        low = c.minFee;
        steps.push(`Mindesthonorar ${money(c.minFee)}`);
      }
      if (c.cap && low > c.cap) {
        low = c.cap;
        steps.push(`höchstens ${money(c.cap)} (Deckel)`);
      }
      high = low;
    } else if (model === 'staffel') {
      const t = tierFor(c, value);
      low = high = t ? t.price : 0;
      steps.push(t ? `${c.valueLabel} ${money(value)} → Stufe ${t.upTo ? `bis ${money(t.upTo)}` : 'darüber'}: ${money(low)}` : 'Keine Staffel hinterlegt');
    } else {
      // erfolg / grund_erfolg
      if (model === 'grund_erfolg') {
        low = c.base;
        high = Math.max(c.base, c.baseMax);
        steps.push(`Grundgebühr ${range(low, high)}`);
      }
      success = successPart(c, value);
      steps.push(`Nur bei Erfolg: ${success.steps.join(' → ')}`);
    }
    // Rang-Faktor (nicht auf den Erfolgsanteil)
    if (factor !== 1 && high > 0) {
      steps.push(`${factorText(factor)} (Satz des Anwalts) = ${range(low * factor, high * factor)}`);
      low *= factor;
      high *= factor;
    }
    // Zuschläge je Leistung (Prozent auf die Position oder fester Betrag)
    const chosen = new Set(Array.isArray(pick.surcharges) ? pick.surcharges : []);
    const surcharges = [];
    for (const s of Array.isArray(fee.surcharges) ? fee.surcharges : []) {
      if (!s || !chosen.has(s.name)) continue;
      const sl = s.pct ? (low * num(s.pct)) / 100 : num(s.amount);
      const sh = s.pct ? (high * num(s.pct)) / 100 : num(s.amount);
      surcharges.push({ name: s.name, low: round(sl), high: round(sh) });
      steps.push(`+ ${s.name}${s.pct ? ` ${pctText(s.pct)}` : ''} = ${range(sl, sh)}`);
      low += sl;
      high += sh;
    }
    return {
      feeId: fee.id,
      name: fee.name,
      model,
      qty: model === 'einheit' ? Math.max(1, Math.round(num(pick.qty, 1))) : 1,
      value: needsValue(fee) ? value : null,
      valueLabel: needsValue(fee) ? c.valueLabel : '',
      low: round(low),
      high: round(high),
      steps,
      success,
      successOnly: model === 'erfolg',
      surcharges,
    };
  }

  /**
   * Gesamtangebot.
   * input: { fees, packages, picks: [{ id, qty, value, surcharges }], packageId, factor, factorLabel,
   *          calc: { bundleMin, bundlePct, priorityPct, priorityLabel }, priority, promo: { name, pct } }
   * → { positions, subtotalLow/High, bundle, promo, priority, totalLow/High, success: [...], successTotal, steps }
   */
  function quote(input) {
    const fees = input.fees || [];
    const byId = new Map(fees.map((f) => [Number(f.id), f]));
    const factor = num(input.factor, 1) > 0 ? num(input.factor, 1) : 1;
    const calc = input.calc || {};
    const positions = [];
    const steps = [];
    let pkg = null;
    const inPackage = new Set();
    if (input.packageId) {
      pkg = (input.packages || []).find((p) => Number(p.id) === Number(input.packageId)) || null;
      if (pkg) {
        const included = (pkg.feeIds || []).map((id) => byId.get(Number(id))).filter(Boolean);
        included.forEach((f) => inPackage.add(Number(f.id)));
        const list = included.reduce((s, f) => s + position(f, {}, 1).low, 0);
        const lo = num(pkg.price) * factor;
        positions.push({
          packageId: pkg.id,
          name: `Paket: ${pkg.name}`,
          model: 'paket',
          low: round(lo),
          high: round(lo),
          steps: [`Paketpreis ${money(pkg.price)}${factor !== 1 ? ` ${factorText(factor)} = ${money(lo)}` : ''}`, `enthält: ${included.map((f) => f.name).join(', ')}`].concat(list > pkg.price ? [`Sie sparen ${money((list - pkg.price) * factor)} gegenüber den Einzelpreisen`] : []),
          included: included.map((f) => f.name),
          saving: round(Math.max(0, list - num(pkg.price)) * factor),
          success: null,
          successOnly: false,
          surcharges: [],
        });
      }
    }
    for (const p of input.picks || []) {
      const f = byId.get(Number(p.id));
      if (!f || inPackage.has(Number(f.id))) continue;
      positions.push(position(f, p, factor));
    }
    if (factor !== 1 && input.factorLabel) steps.push(`Satz ${input.factorLabel}: ${factorText(factor)} auf alle Beträge außer dem Erfolgsanteil`);

    const subtotalLow = positions.reduce((s, x) => s + x.low, 0);
    const subtotalHigh = positions.reduce((s, x) => s + x.high, 0);
    steps.push(`Zwischensumme ${range(subtotalLow, subtotalHigh)}`);

    // Bündelrabatt: ab bundleMin Leistungen (Pakete zählen nicht – sie sind schon günstiger)
    const bundleMin = num(calc.bundleMin, 3) || 3;
    const bundlePct = calc.bundlePct === undefined ? 10 : num(calc.bundlePct);
    const single = positions.filter((x) => x.model !== 'paket' && x.high > 0);
    const bundleOn = bundlePct > 0 && single.length >= bundleMin;
    const singleLow = single.reduce((s, x) => s + x.low, 0);
    const singleHigh = single.reduce((s, x) => s + x.high, 0);
    const bundle = bundleOn ? { pct: bundlePct, low: round((singleLow * bundlePct) / 100), high: round((singleHigh * bundlePct) / 100) } : null;
    if (bundle) steps.push(`− Mandatsbündel-Rabatt ${pctText(bundlePct)} (ab ${bundleMin} Leistungen) = − ${range(bundle.low, bundle.high)}`);

    // Rabattaktion (z. B. Halloween) auf die Zwischensumme, wie auf der Rechnung
    const promoPct = input.promo ? num(input.promo.pct) : 0;
    let promo = null;
    if (promoPct > 0 && subtotalHigh > 0) {
      const lo = Math.min(subtotalLow - (bundle ? bundle.low : 0), round((subtotalLow * promoPct) / 100));
      const hi = Math.min(subtotalHigh - (bundle ? bundle.high : 0), round((subtotalHigh * promoPct) / 100));
      promo = { name: input.promo.name || 'Rabattaktion', icon: input.promo.icon || '', occasion: input.promo.occasion || '', pct: promoPct, low: Math.max(0, lo), high: Math.max(0, hi) };
      steps.push(`− ${promo.name} ${pctText(promoPct)} = − ${range(promo.low, promo.high)}`);
    }
    let totalLow = subtotalLow - (bundle ? bundle.low : 0) - (promo ? promo.low : 0);
    let totalHigh = subtotalHigh - (bundle ? bundle.high : 0) - (promo ? promo.high : 0);

    // Prioritätszuschlag (für das ganze Mandat) auf den Betrag nach Rabatten
    let priority = null;
    const prioPct = calc.priorityPct === undefined ? 15 : num(calc.priorityPct);
    if (input.priority && prioPct > 0 && totalHigh > 0) {
      priority = { name: calc.priorityLabel || 'Priorisierte Bearbeitung', pct: prioPct, low: round((totalLow * prioPct) / 100), high: round((totalHigh * prioPct) / 100) };
      steps.push(`+ ${priority.name} ${pctText(prioPct)} = ${range(priority.low, priority.high)}`);
      totalLow += priority.low;
      totalHigh += priority.high;
    }
    steps.push(`Gesamt ${range(totalLow, totalHigh)}`);

    const success = positions.filter((x) => x.success).map((x) => ({ name: x.name, valueLabel: x.valueLabel, ...x.success }));
    const successTotal = success.reduce((s, x) => s + x.amount, 0);
    if (success.length) steps.push(`Nur bei Erfolg zusätzlich: ${success.map((s) => `${pctText(s.pct)} von ${money(s.value)} = ${money(s.amount)}`).join(' + ')}`);
    return { positions, subtotalLow, subtotalHigh, bundle, promo, priority, totalLow: round(totalLow), totalHigh: round(totalHigh), success, successTotal, factor, steps };
  }

  /** Erfolgshonorar nach Abschluss: dieselbe Formel mit dem tatsächlich erstrittenen Betrag. */
  function settle(successParts, value) {
    return successParts.map((s) => {
      const r = successPart({ pct: num(s.pct), minFee: num(s.minFee), cap: num(s.cap) }, Math.max(0, num(value)));
      return { name: s.name, ...r, line: `Erfolgshonorar ${pctText(s.pct)} von ${money(r.value)}${r.amount !== round((r.value * s.pct) / 100) ? ` (${r.steps.slice(1).join(', ')})` : ''}` };
    });
  }

  /** „Ab … $“ für Listen: kleinster Betrag einer Leistung ohne Auswahl. */
  function fromPrice(fee) {
    const p = position(fee, {}, 1);
    if (p.model === 'erfolg') return { text: `${pctText(configOf(fee).pct)} bei Erfolg`, low: 0, high: 0, successOnly: true };
    if (p.model === 'prozent') return { text: `${pctText(configOf(fee).pct)} vom ${configOf(fee).valueLabel}`, low: p.low, high: p.high };
    if (p.model === 'staffel') return { text: `ab ${money(Math.min(...configOf(fee).tiers.map((t) => t.price).concat([p.low])))}`, low: p.low, high: p.high };
    if (p.model === 'einheit') return { text: `${range(fee.price, Math.max(fee.price, configOf(fee).priceMax))} je ${configOf(fee).unit}`, low: p.low, high: p.high };
    if (p.model === 'grund_erfolg') return { text: `${range(p.low, p.high)} + ${pctText(configOf(fee).pct)} bei Erfolg`, low: p.low, high: p.high };
    return { text: range(p.low, p.high), low: p.low, high: p.high };
  }

  return { MODELS, VALUE_MODELS, SUCCESS_MODELS, configOf, modelOf, needsValue, isSuccess, position, quote, settle, fromPrice, money, range, pctText };
});
