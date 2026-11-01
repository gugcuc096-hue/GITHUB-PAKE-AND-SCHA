/*
 * Kanzlei-Dashboard – Einstellungen ohne Code (Entwurf → Veröffentlichen wie Banner & Co.):
 *  - Navigation: Menü je Personengruppe (Mandanten, Team, Board) umsortieren, ausblenden, umbenennen; eigene Links
 *  - Dashboard-Start: Kacheln und Kästen der Übersicht je Personengruppe (Reihenfolge per Ziehen, ausblenden)
 *  - Tarifrechner: Bündelrabatt und Prioritätszuschlag der Website
 *  - Dokumente: Logo-Position, Zeile unter dem Namen, Fußzeile, Unterschrift, Wasserzeichen – mit Vorschau als PDF
 *  - Discord-Meldungen: je Ereignis Farbe, Titel und ausgeblendete Felder, Fußzeile – mit Vorschau
 * Wird nach 07-konfiguration.js geladen.
 */
'use strict';

CFG_TABS.push(['statuses', 'Status', 'settings.edit'], ['nav', 'Navigation', 'site.edit'], ['start', 'Dashboard-Start', 'site.edit'], ['calculator', 'Tarifrechner', 'site.edit'], ['documents', 'Dokumente', 'settings.edit'], ['discordLook', 'Discord-Meldungen', 'discord.edit']);
const CFG_PROFILES = { team: 'Team', board: 'Board of Partners', mandant: 'Mandanten' };
const START_LABELS = {
  'kpi-requests': ['Kennzahl „Neue Anfragen“', 'team'],
  'kpi-work': ['Kennzahl „In Bearbeitung“', 'team'],
  'kpi-deadline': ['Kennzahl „Nächste Frist / Termin“', 'team'],
  'kpi-mail': ['Kennzahl „Kanzlei-Post“', 'all'],
  'kpi-cases': ['Kennzahl „Meine Akten“', 'mandant'],
  'kpi-next': ['Kennzahl „Nächster Termin“', 'mandant'],
  'kpi-invoices': ['Kennzahl „Offene Rechnungen“', 'mandant'],
  todo: ['Zu erledigen (Unterlagen, Verträge …)', 'mandant'],
  duty: ['Leiste „Wer ist im Dienst“', 'team'],
  absence: ['Leiste „Abwesenheiten“', 'team'],
  attention: ['Was ansteht', 'team'],
  requests: ['Neue Mandatsanfragen', 'team'],
  events: ['Fristen & Termine', 'all'],
  recent: ['Zuletzt bearbeitet / Meine Akten', 'all'],
  pinboard: ['Pinnwand', 'team'],
};
/** Standard-Reihenfolge, wie die Übersicht ohne Einstellung aussieht. */
const START_DEFAULT = {
  team: ['duty', 'absence', 'kpi-requests', 'kpi-work', 'kpi-deadline', 'kpi-mail', 'attention', 'requests', 'events', 'recent', 'pinboard'],
  mandant: ['todo', 'kpi-cases', 'kpi-next', 'kpi-mail', 'kpi-invoices', 'events', 'recent'],
};
const startBlocksFor = (prof) => START_DEFAULT[prof === 'mandant' ? 'mandant' : 'team'];
if (!st.cfgProfile) st.cfgProfile = 'team';

/** Arbeitskopie eines Bereichs mit Personengruppen (Wechsel der Gruppe behält, was man schon geändert hat). */
function cfgEdit(key) {
  st.cfgEdits = st.cfgEdits || {};
  if (!st.cfgEdits[key]) st.cfgEdits[key] = JSON.parse(JSON.stringify(cfgWork(key)));
  return st.cfgEdits[key];
}
const cfgEditDone = (key) => st.cfgEdits && delete st.cfgEdits[key];
const profileChips = (key) =>
  `<div class="chip-row mb-4" role="tablist" aria-label="Personengruppe">${Object.entries(CFG_PROFILES)
    .map(([k, l]) => `<button type="button" class="chip ${st.cfgProfile === k ? 'active' : ''}" role="tab" aria-selected="${st.cfgProfile === k}" data-action="cfg-profile" data-key="${key}" data-profile="${k}"><span>${esc(l)}</span></button>`)
    .join('')}</div>`;
const sortBtns = () =>
  `<span class="cfg-sort-btns"><span class="cfg-grip" aria-hidden="true">${icon('more', 'ico-sm')}</span><button type="button" class="icon-btn sm" data-action="cfg-move" data-dir="-1" aria-label="Nach oben">${icon('chevronUp', 'ico-sm')}</button><button type="button" class="icon-btn sm" data-action="cfg-move" data-dir="1" aria-label="Nach unten">${icon('chevronDown', 'ico-sm')}</button></span>`;

/* ---------------------------------------------------------------- Navigation */
/** Menüpunkte, wie sie das Menü kennt (Bündel als ein Punkt), mit Bereich und Standardname. */
function cfgNavItems() {
  const out = [];
  const seenHub = new Set();
  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.hidden || v.navHidden || key === 'settings' || key === 'profile') continue;
    const hub = Object.entries(NAV_HUBS).find(([, h]) => h.views.some(([k]) => k === key));
    if (hub) {
      if (seenHub.has(hub[0])) continue;
      seenHub.add(hub[0]);
      out.push({ key: `hub-${hub[0]}`, label: hub[1].label, section: v.section || '', icon: hub[1].icon });
      continue;
    }
    out.push({ key, label: viewLabel(key), section: v.section || '', icon: v.icon });
  }
  return out;
}
function cfgNav() {
  const n = cfgEdit('nav');
  const p = n.profiles[st.cfgProfile];
  const items = cfgNavItems();
  const rank = (k) => (p.order.includes(k) ? p.order.indexOf(k) : 1000);
  const sorted = items.map((x, i) => [x, i]).sort((a, b) => rank(a[0].key) - rank(b[0].key) || a[1] - b[1]).map(([x]) => x);
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Navigation</h2></div>
      <p class="text-sm text-muted mb-4">Das Menü links je Personengruppe: Reihenfolge (ziehen oder Pfeile), ausblenden, umbenennen. Punkte, die eine Gruppe ohnehin nicht sehen darf, bleiben bei ihr weg. Einstellungen und Profil stehen immer unten.</p>
      ${profileChips('nav')}
      <form data-form="cfg-nav" class="form-grid">
        <div class="cfg-sort" data-sort="nav">${sorted
          .map(
            (x) => `<div class="cfg-sort-row" draggable="true" data-key="${esc(x.key)}">${sortBtns()}
              <label class="check cfg-sort-show" title="Im Menü zeigen"><input type="checkbox" data-show ${p.hidden.includes(x.key) ? '' : 'checked'}><span class="sr-only">Zeigen</span></label>
              ${icon(x.icon || 'folder', 'ico-sm')}
              <input class="field field-sm" data-label maxlength="40" value="${esc(p.labels[x.key] || '')}" placeholder="${esc(x.label)}" aria-label="Name im Menü für ${esc(x.label)}">
              <span class="text-xs text-dim cfg-sort-sec">${esc(x.section || 'oben')}</span></div>`
          )
          .join('')}</div>
        <div><div class="label">Eigene Links (z. B. Discord-Server, Wiki) – erscheinen unten im Menü</div>
          <div id="cfgNavLinks">${n.links.map(cfgNavLinkRow).join('')}</div>
          <button type="button" class="btn-outline btn-sm mt-2" data-action="nav-link-add">${icon('plus', 'ico-sm')}<span>Link hinzufügen</span></button></div>
        ${cfgBar('nav')}
      </form>
    </section>`;
}
const cfgNavLinkRow = (l = { label: '', url: '', audience: ['team', 'board'] }) => `<div class="cfg-row nav-link-row">
    <input class="field" data-l="label" maxlength="40" value="${esc(l.label)}" placeholder="Beschriftung" aria-label="Beschriftung">
    <input class="field" data-l="url" maxlength="300" value="${esc(l.url)}" placeholder="https://…" aria-label="Adresse">
    <span class="flex flex-wrap gap-3">${Object.entries(CFG_PROFILES).map(([k, lab]) => `<label class="check"><input type="checkbox" data-aud="${k}" ${l.audience.includes(k) ? 'checked' : ''}> ${esc(lab)}</label>`).join('')}</span>
    <button type="button" class="icon-btn sm" data-action="home-row-del" aria-label="Entfernen">${icon('trash', 'ico-sm')}</button></div>`;
/** Formular → Arbeitskopie der gerade gezeigten Gruppe (und die Links). */
function cfgNavRead(f) {
  const n = cfgEdit('nav');
  const rows = [...f.querySelectorAll('.cfg-sort-row')];
  const labels = {};
  rows.forEach((r) => {
    const v = r.querySelector('[data-label]').value.trim();
    if (v) labels[r.dataset.key] = v;
  });
  n.profiles[st.cfgProfile] = { order: rows.map((r) => r.dataset.key), hidden: rows.filter((r) => !r.querySelector('[data-show]').checked).map((r) => r.dataset.key), labels };
  n.links = [...f.querySelectorAll('.nav-link-row')]
    .map((r) => ({ label: r.querySelector('[data-l="label"]').value.trim(), url: r.querySelector('[data-l="url"]').value.trim(), audience: [...r.querySelectorAll('[data-aud]')].filter((c) => c.checked).map((c) => c.dataset.aud) }))
    .filter((l) => l.label || l.url);
  return n;
}

/* ---------------------------------------------------------------- Dashboard-Start */
function cfgStart() {
  const s = cfgEdit('start');
  const p = s.profiles[st.cfgProfile];
  const blocks = startBlocksFor(st.cfgProfile);
  const rank = (k) => (p.order.includes(k) ? p.order.indexOf(k) : 1000);
  const sorted = blocks.map((k, i) => [k, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([k]) => k);
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Dashboard-Start</h2></div>
      <p class="text-sm text-muted mb-4">Was Partner, Team und Mandanten auf der Übersicht zuerst sehen: Bausteine per Ziehen sortieren oder ausblenden. Kennzahlen bleiben oben in einer Reihe, Kästen darunter – die Reihenfolge gilt innerhalb davon. Leere Kästen erscheinen weiter als schmale Zeile unten.</p>
      ${profileChips('start')}
      <form data-form="cfg-start" class="form-grid">
        <div class="cfg-sort" data-sort="start">${sorted
          .map(
            (k) => `<div class="cfg-sort-row" draggable="true" data-key="${k}">${sortBtns()}
              <label class="check"><input type="checkbox" data-show ${p.hidden.includes(k) ? '' : 'checked'}> ${esc(START_LABELS[k][0])}</label>
              <span class="text-xs text-dim cfg-sort-sec">${k.startsWith('kpi-') ? 'Kennzahl' : ['duty', 'absence', 'todo'].includes(k) ? 'Leiste oben' : 'Kasten'}</span></div>`
          )
          .join('')}</div>
        ${cfgBar('start')}
      </form>
    </section>`;
}
function cfgStartRead(f) {
  const s = cfgEdit('start');
  const rows = [...f.querySelectorAll('.cfg-sort-row')];
  s.profiles[st.cfgProfile] = { order: rows.map((r) => r.dataset.key), hidden: rows.filter((r) => !r.querySelector('[data-show]').checked).map((r) => r.dataset.key) };
  // Team und Board teilen die Bausteine – was beim Team eingestellt ist, gilt fürs Board erst, wenn es dort gespeichert wird
  return s;
}

/* ---------------------------------------------------------------- Tarifrechner */
function cfgCalculator() {
  const c = cfgWork('calculator');
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Tarifrechner</h2></div>
      <p class="text-sm text-muted mb-4">Der Rechner auf der Website. Welche Leistungen darin stehen und was sie kosten, steht in der <a href="#fees" class="text-gold underline">Honorarordnung</a> (Häkchen „im Tarifrechner“) – hier Rabatt und Zuschlag.</p>
      <form data-form="cfg-calculator" class="form-grid cols-2">
        <div><label class="label" for="calcBMin">Bündelrabatt ab … Leistungen</label><input id="calcBMin" name="bundleMin" type="number" min="2" max="10" step="1" class="field" value="${esc(c.bundleMin)}"></div>
        <div><label class="label" for="calcBPct">Bündelrabatt in %</label><input id="calcBPct" name="bundlePct" type="number" min="0" max="50" step="0.5" class="field" value="${esc(c.bundlePct)}"></div>
        <div><label class="label" for="calcPPct">Prioritätszuschlag in %</label><input id="calcPPct" name="priorityPct" type="number" min="0" max="100" step="0.5" class="field" value="${esc(c.priorityPct)}"></div>
        <div><label class="label" for="calcPLab">Name des Zuschlags</label><input id="calcPLab" name="priorityLabel" class="field" maxlength="60" value="${esc(c.priorityLabel)}"></div>
        <div class="span-2"><label class="label" for="calcPSub">Erklärung darunter</label><input id="calcPSub" name="prioritySub" class="field" maxlength="120" value="${esc(c.prioritySub)}"></div>
        <div class="span-2 cfg-live"><div class="label">Beispiel</div><div id="calcExample" class="calc-example">${calcExample(c)}</div></div>
        <div class="span-2">${cfgBar('calculator', `<a class="btn-ghost btn-md" href="/?vorschau=1#rechner" target="_blank" rel="noopener">${icon('globe', 'ico-sm')}<span>Vorschau mit Entwurf</span></a>`)}</div>
      </form>
    </section>`;
}
function calcExample(c) {
  const n = Math.max(c.bundleMin || 3, 1);
  const sub = n * 50000;
  const disc = Math.round((sub * (Number(c.bundlePct) || 0)) / 100);
  const pri = Math.round(((sub - disc) * (Number(c.priorityPct) || 0)) / 100);
  return `<div class="calc-ex-row"><span>${n} Leistungen à 50.000 $</span><span class="num">${money(sub)}</span></div>
    ${disc ? `<div class="calc-ex-row text-emerald-300"><span>Bündelrabatt (${esc(String(c.bundlePct).replace('.', ','))} %)</span><span class="num">− ${money(disc)}</span></div>` : ''}
    ${pri ? `<div class="calc-ex-row"><span>${esc(c.priorityLabel || 'Zuschlag')} (+${esc(String(c.priorityPct).replace('.', ','))} %)</span><span class="num">+ ${money(pri)}</span></div>` : ''}
    <div class="calc-ex-row calc-ex-total"><span>Gesamt mit Zuschlag</span><span class="num">${money(sub - disc + pri)}</span></div>`;
}
function cfgCollectCalculator(f) {
  const fd = new FormData(f);
  const num = (k, d) => (val(fd, k) === '' ? d : Number(val(fd, k)));
  return { bundleMin: num('bundleMin', 3), bundlePct: num('bundlePct', 10), priorityPct: num('priorityPct', 15), priorityLabel: val(fd, 'priorityLabel') || 'Priorisierte Bearbeitung', prioritySub: val(fd, 'prioritySub') };
}

/* ---------------------------------------------------------------- Dokumente */
function cfgDocuments() {
  const d = cfgWork('documents');
  const seg = (name, map, cur) =>
    `<div class="seg" role="radiogroup">${Object.entries(map)
      .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${k}" ${cur === k ? 'checked' : ''}><span>${esc(l)}</span></label>`)
      .join('')}</div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Dokumente</h2></div>
      <p class="text-sm text-muted mb-4">Aussehen von Rechnungen, Aktenauszügen und Verträgen. Anschrift, Kontakt und Zahlungshinweis stehen unter „Kanzleidaten &amp; Rechnungen“. Die Vorschau zeigt den gespeicherten Entwurf.</p>
      <form data-form="cfg-documents" class="form-grid cols-2">
        <div><div class="label">Logo</div>${seg('logoPos', { links: 'Links', mitte: 'Mittig', rechts: 'Rechts' }, d.logoPos)}</div>
        <div><label class="label" for="docTag">Zeile unter dem Namen</label><input id="docTag" name="tagline" class="field" maxlength="80" value="${esc(d.tagline)}" placeholder="leer = keine"></div>
        <div class="span-2"><label class="label" for="docFoot">Fußzeile (z. B. Bankverbindung, Hinweise)</label><textarea id="docFoot" name="footer" class="field" rows="2" maxlength="200" placeholder="z. B. Maze Bank · Konto 1234 · Gerichtsstand Los Santos">${esc(d.footer)}</textarea></div>
        <div><label class="check"><input type="checkbox" name="signature" ${d.signature ? 'checked' : ''}> Unterschrift unter Rechnungen</label>
          <div class="mt-2">${seg('signatureStyle', { schrift: 'Schreibschrift', klar: 'Klar' }, d.signatureStyle)}</div></div>
        <div><label class="label" for="docWm">Wasserzeichen</label><input id="docWm" name="watermark" class="field" maxlength="30" value="${esc(d.watermark)}" placeholder="z. B. VERTRAULICH">
          <div class="flex flex-wrap gap-3 mt-2">${[['invoice', 'Rechnungen'], ['extract', 'Aktenauszüge'], ['contract', 'Verträge']].map(([k, l]) => `<label class="check"><input type="checkbox" name="watermarkOn" value="${k}" ${d.watermarkOn.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="span-2 cfg-live"><div class="label flex items-center justify-between gap-2"><span>Vorschau (Beispielrechnung)</span><a class="btn-ghost btn-sm" href="/rechnung?beispiel=1&vorschau=1&print=1" target="_blank" rel="noopener">${icon('download', 'ico-sm')}<span>Als PDF ansehen</span></a></div>
          <iframe class="doc-preview" src="/rechnung?beispiel=1&vorschau=1&t=${Date.now()}" title="Vorschau der Beispielrechnung" loading="lazy"></iframe></div>
        <div class="span-2">${cfgBar('documents')}</div>
      </form>
    </section>`;
}
function cfgCollectDocuments(f) {
  const fd = new FormData(f);
  return { logoPos: val(fd, 'logoPos') || 'links', tagline: val(fd, 'tagline'), footer: val(fd, 'footer'), signature: fd.has('signature'), signatureStyle: val(fd, 'signatureStyle') || 'schrift', watermark: val(fd, 'watermark'), watermarkOn: fd.getAll('watermarkOn') };
}

/* ---------------------------------------------------------------- Discord-Meldungen */
function cfgDiscordLook() {
  if (!st.discordFields) {
    api.get('/api/config/discord-fields').then((r) => {
      st.discordFields = r;
      if (st.cfgTab === 'discordLook') renderView();
    }, () => (st.discordFields = { events: {}, fields: {} }));
    return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  }
  const look = cfgEdit('discordLook');
  const events = st.discordFields.events;
  const ev = st.cfgDiscordEvent && events[st.cfgDiscordEvent] ? st.cfgDiscordEvent : Object.keys(events)[0];
  st.cfgDiscordEvent = ev;
  const e = look.events[ev] || { color: '', title: '', hide: [] };
  const seen = [...new Set([...(st.discordFields.fields[ev] || []), ...e.hide])];
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Discord-Meldungen</h2></div>
      <p class="text-sm text-muted mb-4">Wie die Meldungen in den Kanzlei-Kanälen aussehen – je Ereignis Farbe, Titel und welche Felder fehlen sollen. Welche Ereignisse überhaupt gemeldet werden und wohin, steht unter „Discord“.</p>
      <form data-form="cfg-discordLook" class="form-grid cols-2">
        <div class="span-2"><label class="label" for="dlEvent">Ereignis</label><select id="dlEvent" class="field" data-action-change="dl-event">${Object.entries(events)
          .map(([k, l]) => `<option value="${esc(k)}" ${k === ev ? 'selected' : ''}>${esc(l)}${look.events[k] && (look.events[k].color || look.events[k].title || look.events[k].hide.length) ? ' •' : ''}</option>`)
          .join('')}</select></div>
        <div><label class="label" for="dlColor">Farbe (leer = Standard)</label><div class="color-row"><input type="color" value="${esc(e.color || '#d4af37')}" data-sync="dlColor" aria-label="Farbe wählen"><input id="dlColor" name="color" class="field" maxlength="7" value="${esc(e.color)}" placeholder="#RRGGBB"></div></div>
        <div><label class="label" for="dlTitle">Titel – {titel} = der normale Titel</label><input id="dlTitle" name="title" class="field" maxlength="120" value="${esc(e.title)}" placeholder="z. B. ⚖️ {titel}"></div>
        <div class="span-2"><div class="label">Felder ausblenden</div>
          ${seen.length ? `<div class="flex flex-wrap gap-3">${seen.map((nm) => `<label class="check"><input type="checkbox" name="hide" value="${esc(nm)}" ${e.hide.includes(nm) ? 'checked' : ''}> ${esc(nm)}</label>`).join('')}</div>` : '<p class="form-hint">Dieses Ereignis kam noch nicht vor – Felder erscheinen hier, sobald es einmal gemeldet wurde. Namen lassen sich auch eintippen:</p>'}
          <input name="hideExtra" class="field mt-2" maxlength="200" placeholder="weitere Feldnamen, mit Komma getrennt" aria-label="Weitere Feldnamen zum Ausblenden"></div>
        <div class="span-2"><label class="label" for="dlFoot">Fußzeile aller Meldungen (leer = „Pake & Scha Legal Consulting“)</label><input id="dlFoot" name="footer" class="field" maxlength="120" value="${esc(look.footer)}"></div>
        <div class="span-2 cfg-live"><div class="label">Vorschau</div><div id="dlPreview">${discordPreview(ev, e, look.footer, seen)}</div></div>
        <div class="span-2">${cfgBar('discordLook')}</div>
      </form>
    </section>`;
}
function discordPreview(ev, e, footer, seen) {
  const label = st.discordFields.events[ev] || ev;
  const fields = (seen.length ? seen : ['Akte', 'Mandant', 'Zuständig']).filter((n) => !e.hide.includes(n)).slice(0, 9);
  // Dieselbe Vorschau wie bei den Bot-Nachrichten (08-discord.js)
  return msgPreviewHtml({
    content: '',
    embed: { enabled: true, title: e.title ? e.title.replace(/\{titel\}/gi, label) : label, color: e.color || '#d4af37', fields: fields.map((n) => ({ name: n, value: '…', inline: true })), footer: footer || 'Pake & Scha Legal Consulting', timestamp: true },
  });
}
function cfgDiscordRead(f) {
  const look = cfgEdit('discordLook');
  const fd = new FormData(f);
  const extra = val(fd, 'hideExtra')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const color = val(fd, 'color');
  const e = { color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '', title: val(fd, 'title'), hide: [...new Set([...fd.getAll('hide'), ...extra])].slice(0, 25) };
  if (e.color || e.title || e.hide.length) look.events[st.cfgDiscordEvent] = e;
  else delete look.events[st.cfgDiscordEvent];
  look.footer = val(fd, 'footer');
  return look;
}

/* ---------------------------------------------------------------- Status */
const STATUS_COLORS = { amber: 'Bernstein', sky: 'Blau', emerald: 'Grün', gold: 'Gold', red: 'Rot', slate: 'Grau' };
function cfgStatuses() {
  const s = cfgWork('statuses');
  const row = (k, hint) => `<div class="status-row"><span class="status-prev" data-prev="${k}">${badge(s[k].label, s[k].color)}</span>
      <input class="field" name="${k}-label" maxlength="30" value="${esc(s[k].label)}" aria-label="Name für ${esc(hint)}">
      <select class="field" name="${k}-color" aria-label="Farbe für ${esc(hint)}">${Object.entries(STATUS_COLORS).map(([c, l]) => opt(c, l, s[k].color === c)).join('')}</select>
      <span class="text-xs text-dim">${esc(hint)}</span></div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Status</h2></div>
      <p class="text-sm text-muted mb-4">Namen und Farben der drei Status einer Akte – im Dashboard, im Verlauf und in Discord. Die <strong>Verfahrensschritte</strong> (z. B. Eingang → Akteneinsicht → Verhandlung, zwei bis acht) legen Sie je Rechtsgebiet unter <button type="button" class="link-btn" data-action="settings-tab" data-tab="listen">Listen → Rechtsgebiete</button> fest. Farben: grün = erledigt, bernstein = wartet, rot = dringend, blau = in Arbeit.</p>
      <form data-form="cfg-statuses" class="form-grid">
        ${row('offen', 'neu, noch ohne Anwalt')}${row('in_bearbeitung', 'mit Anwalt (zeigt sonst den Verfahrensschritt)')}${row('geschlossen', 'abgeschlossen')}
        ${cfgBar('statuses')}
      </form>
    </section>`;
}
function cfgCollectStatuses(f) {
  const fd = new FormData(f);
  return Object.fromEntries(['offen', 'in_bearbeitung', 'geschlossen'].map((k) => [k, { label: val(fd, `${k}-label`) || CASE_STATUS[k][0], color: val(fd, `${k}-color`) || CASE_STATUS[k][1] }]));
}
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('form[data-form="cfg-statuses"]');
  if (!f) return;
  const v = cfgCollectStatuses(f);
  for (const k of Object.keys(v)) {
    const box = f.querySelector(`[data-prev="${k}"]`);
    if (box) box.innerHTML = badge(v[k].label, v[k].color);
  }
});

/* ---------------------------------------------------------------- Automatik („Wenn … dann …“) */
function automationPanel() {
  if (!st.automations) {
    api.get('/api/automations').then((r) => {
      st.automations = r;
      if (st.settingsTab === 'automation') renderView();
    }, () => (st.automations = { rules: [], triggers: {}, actions: {}, canEdit: false }));
    return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  }
  const a = st.automations;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Automatik</h2>${a.canEdit ? `<button type="button" class="btn-gold btn-sm" data-action="auto-edit">${icon('plus', 'ico-sm')}<span>Neue Regel</span></button>` : ''}</div>
      <p class="text-sm text-muted mb-4">„Wenn … dann …“ – wiederkehrende Handgriffe macht das Dashboard selbst, z. B. „Neue Strafsache → Priorität hoch“ oder „Akte liegt 7 Tage → Aufgabe an den Federführenden“. Jede Regel läuft je Akte und Anlass einmal; was sie getan hat, steht als interner Eintrag „Automatik: …“ im Verlauf der Akte.</p>
      ${
        a.rules.length
          ? `<div class="auto-list">${a.rules
              .map(
                (r) => `<div class="auto-rule ${r.active ? '' : 'is-off'}">
            <span class="auto-when">${icon('bell', 'ico-sm')}<span>Wenn <strong>${esc(a.triggers[r.trigger] || r.trigger)}</strong>${r.conditions.days ? ` (${r.conditions.days} Tage)` : ''}${r.conditions.status ? ` → ${esc(CASE_STATUS[r.conditions.status][0])}` : ''}${r.conditions.area ? ` · nur ${esc(AREAS[r.conditions.area] || r.conditions.area)}` : ''}</span></span>
            <span class="auto-then">${icon('chevronRight', 'ico-sm')}<span>${esc(r.summary)}</span></span>
            <span class="auto-meta text-xs text-dim">${esc(r.name)} · ${r.runs ? `${r.runs}× ausgeführt` : 'noch nicht ausgeführt'}${r.active ? '' : ' · aus'}</span>
            ${a.canEdit ? `<span class="auto-btns"><button type="button" class="btn-ghost btn-sm" data-action="auto-edit" data-id="${r.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button type="button" class="icon-btn sm" data-action="auto-del" data-id="${r.id}" aria-label="Regel löschen">${icon('trash', 'ico-sm')}</button></span>` : ''}
          </div>`
              )
              .join('')}</div>`
          : `<div class="auto-empty">${emptyLine('Noch keine Regel. Vorschläge:', 'star')}<div class="chip-row chip-wrap mt-2">${AUTO_EXAMPLES.map((x, i) => `<button type="button" class="chip" data-action="auto-edit" data-example="${i}"><span>${esc(x.name)}</span></button>`).join('')}</div></div>`
      }
    </section>`;
}
const AUTO_EXAMPLES = [
  { name: 'Liegt 7 Tage → Aufgabe', trigger: 'case.idle', conditions: { days: 7 }, action: 'task', params: { title: 'Akte prüfen – seit 7 Tagen keine Aktivität', dueDays: 1, to: 'lead' } },
  { name: 'Neue Strafsache → Priorität hoch', trigger: 'case.created', conditions: { area: 'strafrecht' }, action: 'priority', params: { priority: 3 } },
  { name: 'Rechnung bezahlt → Akte schließen', trigger: 'invoice.paid', conditions: {}, action: 'status', params: { status: 'geschlossen' } },
  { name: 'Neue Akte → Erstgespräch', trigger: 'case.created', conditions: {}, action: 'task', params: { title: 'Erstgespräch mit dem Mandanten führen', dueDays: 2, to: 'lead' } },
];
function autoForm(r) {
  const a = st.automations;
  const c = r.conditions || {};
  const p = r.params || {};
  return `<h2 class="modal-title">${r.id ? 'Regel bearbeiten' : 'Neue Regel'}</h2>
    <p class="modal-sub">Wenn das Ereignis eintritt (und die Bedingung passt), führt das Dashboard die Aktion aus.</p>
    <form data-form="auto-save" ${r.id ? `data-id="${r.id}"` : ''} class="form-grid cols-2">
      <div class="span-2"><label class="label" for="auName">Name</label><input id="auName" name="name" class="field" required minlength="2" maxlength="80" value="${esc(r.name || '')}" placeholder="z. B. Liegt 7 Tage → Aufgabe"></div>
      <div class="span-2 auto-step-head">${icon('bell', 'ico-sm')}<span>Wenn …</span></div>
      <div><label class="label" for="auTrig">Ereignis</label><select id="auTrig" name="trigger" class="field" data-auto-sync>${Object.entries(a.triggers).map(([k, l]) => opt(k, l, r.trigger === k)).join('')}</select></div>
      <div><label class="label" for="auArea">Rechtsgebiet</label><select id="auArea" name="area" class="field"><option value="">alle</option>${areaOptions().map(([k, l]) => opt(k, l, c.area === k)).join('')}</select></div>
      <div data-auto-if="case.idle"><label class="label" for="auDays">Tage ohne Aktivität</label><input id="auDays" name="days" type="number" min="1" max="90" class="field" value="${esc(c.days || 7)}"></div>
      <div data-auto-if="case.status"><label class="label" for="auStat">neuer Status</label><select id="auStat" name="condStatus" class="field">${Object.entries(CASE_STATUS).map(([k, [l]]) => opt(k, l, c.status === k)).join('')}</select></div>
      <div class="span-2 auto-step-head">${icon('chevronRight', 'ico-sm')}<span>… dann</span></div>
      <div><label class="label" for="auAct">Aktion</label><select id="auAct" name="action" class="field" data-auto-sync>${Object.entries(a.actions).map(([k, l]) => opt(k, l, r.action === k)).join('')}</select></div>
      <div data-auto-do="task"><label class="label" for="auTo">an</label><select id="auTo" name="to" class="field">${opt('lead', 'Federführenden Anwalt', p.to !== 'creator')}${opt('creator', 'Wer die Akte angelegt hat', p.to === 'creator')}</select></div>
      <div class="span-2" data-auto-do="task"><label class="label" for="auTitle">Titel der Aufgabe</label><input id="auTitle" name="title" class="field" maxlength="160" value="${esc(p.title || '')}"></div>
      <div data-auto-do="task"><label class="label" for="auDue">fällig in … Tagen</label><input id="auDue" name="dueDays" type="number" min="0" max="60" class="field" value="${esc(p.dueDays ?? 1)}"></div>
      <div data-auto-do="priority"><label class="label" for="auPrio">Priorität</label><select id="auPrio" name="priority" class="field">${Object.entries(PRIORITY).map(([k, [l]]) => opt(k, l, String(p.priority || 3) === k)).join('')}</select></div>
      <div data-auto-do="status"><label class="label" for="auSet">Status</label><select id="auSet" name="setStatus" class="field">${Object.entries(CASE_STATUS).map(([k, [l]]) => opt(k, l, p.status === k)).join('')}</select></div>
      <div class="span-2" data-auto-do="note"><label class="label" for="auText">Text der Notiz</label><textarea id="auText" name="text" class="field" rows="3" maxlength="1000">${esc(p.text || '')}</textarea></div>
      <label class="check span-2"><input type="checkbox" name="active" ${r.active === false ? '' : 'checked'}> Regel ist eingeschaltet</label>
      <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
    </form>`;
}
function autoSync(f) {
  const t = f.elements.trigger.value;
  const a = f.elements.action.value;
  f.querySelectorAll('[data-auto-if]').forEach((el) => (el.hidden = el.dataset.autoIf !== t));
  f.querySelectorAll('[data-auto-do]').forEach((el) => (el.hidden = el.dataset.autoDo !== a));
}
document.addEventListener('change', (e) => e.target.matches && e.target.matches('[data-auto-sync]') && autoSync(e.target.form));
Object.assign(actions, {
  'auto-edit': (el) => {
    const r = el.dataset.id ? st.automations.rules.find((x) => x.id === Number(el.dataset.id)) : el.dataset.example !== undefined ? AUTO_EXAMPLES[Number(el.dataset.example)] : { trigger: 'case.created', action: 'task', conditions: {}, params: {} };
    openModal(autoForm(r || {}));
    autoSync($('form[data-form="auto-save"]'));
  },
  'auto-del': async (el) => {
    if (!(await ask('Die Regel wird gelöscht; was sie schon getan hat, bleibt.', { title: 'Regel löschen?', confirmText: 'Löschen', danger: true }))) return;
    await api.del('/api/automations/' + el.dataset.id);
    st.automations = null;
    toast('Regel gelöscht.');
    renderView();
  },
});
forms['auto-save'] = async (f) => {
  const fd = new FormData(f);
  const trigger = val(fd, 'trigger');
  const action = val(fd, 'action');
  const conditions = { area: val(fd, 'area') };
  if (trigger === 'case.idle') conditions.days = Number(val(fd, 'days')) || 7;
  if (trigger === 'case.status') conditions.status = val(fd, 'condStatus');
  const params = {};
  if (action === 'task') Object.assign(params, { title: val(fd, 'title'), dueDays: val(fd, 'dueDays') === '' ? undefined : Number(val(fd, 'dueDays')), to: val(fd, 'to') });
  if (action === 'priority') params.priority = Number(val(fd, 'priority'));
  if (action === 'status') params.status = val(fd, 'setStatus');
  if (action === 'note') params.text = val(fd, 'text');
  const body = { name: val(fd, 'name'), active: fd.has('active'), trigger, conditions, action, params };
  if (f.dataset.id) await api.put('/api/automations/' + f.dataset.id, body);
  else await api.post('/api/automations', body);
  st.automations = null;
  closeModal();
  toast('Regel gespeichert.');
  renderView();
};

/* ---------------------------------------------------------------- Einhängen */
Object.assign(CFG_PANELS, { statuses: cfgStatuses, nav: cfgNav, start: cfgStart, calculator: cfgCalculator, documents: cfgDocuments, discordLook: cfgDiscordLook });
Object.assign(CFG_COLLECT, { statuses: cfgCollectStatuses, nav: cfgNavRead, start: cfgStartRead, calculator: cfgCollectCalculator, documents: cfgCollectDocuments, discordLook: cfgDiscordRead });
const cfgPanelsMore = configPanels;
// eslint-disable-next-line no-global-assign
configPanels = function () {
  if (st.cfg && CFG_PANELS[st.cfgTab]) return CFG_PANELS[st.cfgTab]();
  return cfgPanelsMore();
};
for (const key of ['statuses', 'nav', 'start', 'calculator', 'documents', 'discordLook']) {
  forms[`cfg-${key}`] = async (f) => {
    await cfgSave(key, f);
    cfgEditDone(key);
    toast('Entwurf gespeichert.');
    renderView();
  };
}
// Veröffentlichen/Verwerfen: Arbeitskopie verwerfen, damit der neue Stand gezeigt wird
document.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest && e.target.closest('[data-action="cfg-discard"], [data-action="cfg-publish"]');
    if (b && st.cfgEdits) setTimeout(() => cfgEditDone(b.dataset.key), 0);
  },
  true
);

Object.assign(actions, {
  'cfg-profile': (el) => {
    const f = el.closest('section').querySelector('form');
    if (f && CFG_COLLECT[el.dataset.key]) CFG_COLLECT[el.dataset.key](f); // Änderungen der bisherigen Gruppe behalten
    st.cfgProfile = el.dataset.profile;
    renderView();
  },
  'cfg-move': (el) => {
    const row = el.closest('.cfg-sort-row');
    const dir = Number(el.dataset.dir);
    const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    if (dir < 0) other.before(row);
    else other.after(row);
    el.focus();
  },
  'nav-link-add': () => $('#cfgNavLinks').insertAdjacentHTML('beforeend', cfgNavLinkRow()),
});

/* Ziehen in sortierbaren Listen (Navigation, Dashboard-Start) */
let cfgDragRow = null;
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest && e.target.closest('.cfg-sort-row');
  if (!row || e.target.closest('input')) return;
  cfgDragRow = row;
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', row.dataset.key);
  } catch {
    /* egal */
  }
});
document.addEventListener('dragover', (e) => {
  if (!cfgDragRow) return;
  const over = e.target.closest && e.target.closest('.cfg-sort-row');
  if (!over || over === cfgDragRow || over.parentElement !== cfgDragRow.parentElement) return;
  e.preventDefault();
  const r = over.getBoundingClientRect();
  if (e.clientY < r.top + r.height / 2) over.before(cfgDragRow);
  else over.after(cfgDragRow);
});
document.addEventListener('dragend', () => {
  if (cfgDragRow) cfgDragRow.classList.remove('is-dragging');
  cfgDragRow = null;
});
document.addEventListener('drop', (e) => cfgDragRow && e.preventDefault());

/* Live: Beispiel im Tarifrechner, Vorschau der Discord-Meldung, Ereignis wechseln, Farbe */
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('form[data-form="cfg-calculator"], form[data-form="cfg-discordLook"]');
  if (!f) return;
  if (e.target.dataset.sync === 'dlColor') f.elements.color.value = e.target.value;
  if (f.dataset.form === 'cfg-calculator') $('#calcExample').innerHTML = calcExample(cfgCollectCalculator(f));
  else {
    const look = cfgDiscordRead(f);
    const ev = look.events[st.cfgDiscordEvent] || { color: '', title: '', hide: [] };
    $('#dlPreview').innerHTML = discordPreview(st.cfgDiscordEvent, ev, look.footer, [...new Set([...(st.discordFields.fields[st.cfgDiscordEvent] || []), ...ev.hide])]);
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'dlEvent') return;
  const f = e.target.closest('form');
  cfgDiscordRead(f); // Änderungen am bisherigen Ereignis behalten
  st.cfgDiscordEvent = e.target.value;
  renderView();
});
