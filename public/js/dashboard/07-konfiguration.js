/*
 * Kanzlei-Dashboard – Einstellungen: Texte & Banner (Banner, Startseite, Beschriftungen, Mitteilungen – jeweils Entwurf →
 * Veröffentlichen), Export/Import aller Einstellungen und „Als Rang ansehen“.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html).
 */
'use strict';

const CFG_TABS = [
  ['banner', 'Banner', 'site.edit'],
  ['home', 'Startseite', 'site.edit'],
  ['labels', 'Beschriftungen', 'site.edit'],
  ['messages', 'Mitteilungen', 'settings.edit'],
];
const CFG_TONES = { gold: 'Gold', sky: 'Blau', amber: 'Orange', red: 'Rot', green: 'Grün' };
const CFG_AUDIENCE = { public: 'Besucher der Website', mandant: 'Mandanten', staff: 'Kanzlei' };
const CFG_SAMPLE = {
  mandant: 'Tina Termin',
  aktenzeichen: 'PS-2026-0012',
  rechnung: 'Rechnung',
  nummer: 'RE-2026-0007',
  betrag: '1.500 $',
  faelligkeit: 'war am **14.10.2026** fällig und ist noch offen',
  zahlungshinweis: 'Zahlbar per Überweisung an Pake & Scha Legal Consulting (Maze Bank).',
  unterlage: 'Kontoauszug Oktober',
  notiz: 'Bitte als PDF oder Foto.',
  termin: 'Beratungsgespräch',
  ort: 'Kanzlei Würfelpark',
};

async function loadConfig() {
  st.cfg = await api.get('/api/config');
}
const cfgVisibleTabs = () => CFG_TABS.filter(([, , perm]) => can(perm));
const cfgFill = (text) => String(text).replace(/\{(\w+)\}/g, (all, k) => (k in CFG_SAMPLE ? CFG_SAMPLE[k] : ''));
const cfgMd = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

/** Kopf jedes Bereichs: Stand, Entwurf speichern / veröffentlichen / verwerfen. */
function cfgBar(key, extra = '') {
  const c = st.cfg.config[key];
  return `<div class="form-actions cfg-bar">
      ${c.draft ? badge('Entwurf – noch nicht veröffentlicht', 'gold') : badge('Veröffentlicht', 'emerald')}
      <span class="cfg-spacer"></span>
      ${extra}
      <button type="submit" class="btn-outline btn-md">${icon('check', 'ico-sm')}<span>Entwurf speichern</span></button>
      <button type="button" class="btn-gold btn-md" data-action="cfg-publish" data-key="${key}">${icon('globe', 'ico-sm')}<span>Veröffentlichen</span></button>
      ${c.draft ? `<button type="button" class="btn-ghost btn-md" data-action="cfg-discard" data-key="${key}">Entwurf verwerfen</button>` : ''}
    </div>`;
}
const cfgWork = (key) => st.cfg.config[key].draft || st.cfg.config[key].published;

function configPanels() {
  if (!st.cfg) return '<div class="panel panel-pad"><p class="text-sm text-muted">Wird geladen …</p></div>';
  const tabs = cfgVisibleTabs();
  if (!tabs.length) return `<div class="panel panel-pad">${empty('Dafür fehlt Ihnen das Recht.', 'shield')}</div>`;
  const tab = tabs.some(([k]) => k === st.cfgTab) ? st.cfgTab : tabs[0][0];
  const nav = `<div class="chip-row mb-4" role="tablist" aria-label="Bereiche">${tabs.map(([k, label]) => `<button type="button" class="chip ${tab === k ? 'active' : ''}" role="tab" aria-selected="${tab === k}" data-action="cfg-tab" data-tab="${k}"><span>${esc(label)}${st.cfg.config[k].draft ? ' •' : ''}</span></button>`).join('')}</div>`;
  const body = { banner: cfgBanner, home: cfgHome, labels: cfgLabels, messages: cfgMessages }[tab]();
  return `${nav}${body}`;
}

/* ---------------------------------------------------------------- Banner */
function cfgBanner() {
  const b = cfgWork('banner');
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Banner oben</h2></div>
      <p class="text-sm text-muted mb-4">Ein Hinweisstreifen ganz oben – auf der Website und im Dashboard (z. B. „Am Sonntag nur Notdienst“). Mit Zeitraum und Zielgruppe; Besucher können ihn wegklicken.</p>
      <form data-form="cfg-banner" class="form-grid cols-2">
        <label class="check span-2"><input type="checkbox" name="enabled" ${b.enabled ? 'checked' : ''}> Banner anzeigen</label>
        <div class="span-2"><label class="label" for="cfgBText">Text</label><input id="cfgBText" name="text" class="field" maxlength="240" value="${esc(b.text)}" placeholder="z. B. Wegen Wartungsarbeiten sind wir am Sonntag nur im Notdienst erreichbar."></div>
        <div><label class="label" for="cfgBTone">Farbe</label><select id="cfgBTone" name="tone" class="field">${Object.entries(CFG_TONES).map(([k, l]) => opt(k, l, b.tone === k)).join('')}</select></div>
        <div><label class="label" for="cfgBLinkLabel">Beschriftung des Links (optional)</label><input id="cfgBLinkLabel" name="linkLabel" class="field" maxlength="40" value="${esc(b.linkLabel)}" placeholder="Mehr erfahren"></div>
        <div class="span-2"><label class="label" for="cfgBLink">Link (optional)</label><input id="cfgBLink" name="link" class="field" maxlength="300" value="${esc(b.link)}" placeholder="https://… oder /karriere"></div>
        <div><label class="label" for="cfgBFrom">Anzeigen ab</label><input id="cfgBFrom" type="date" name="from" class="field" value="${esc(b.from)}"></div>
        <div><label class="label" for="cfgBTo">Anzeigen bis (einschließlich)</label><input id="cfgBTo" type="date" name="to" class="field" value="${esc(b.to)}"></div>
        <div class="span-2"><div class="label">Wer sieht es?</div><div class="flex flex-wrap gap-4">${Object.entries(CFG_AUDIENCE).map(([k, l]) => `<label class="check"><input type="checkbox" name="audience" value="${k}" ${b.audience.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
        <label class="check span-2"><input type="checkbox" name="dismissible" ${b.dismissible ? 'checked' : ''}> Besucher dürfen den Banner wegklicken (kommt erst bei geändertem Text wieder)</label>
        <div class="span-2 cfg-live"><div class="label">So sieht es aus</div><div id="cfgBannerPreview">${cfgBannerPreview(b)}</div></div>
        <div class="span-2">${cfgBar('banner', `<a class="btn-ghost btn-md" href="/?vorschau=1" target="_blank" rel="noopener">${icon('globe', 'ico-sm')}<span>Vorschau mit Entwurf</span></a>`)}</div>
      </form>
    </section>`;
}
function cfgBannerPreview(b) {
  if (!b.text) return '<p class="form-hint">Noch kein Text.</p>';
  return `<div class="site-banner tone-${esc(b.tone)}" style="animation:none"><span class="site-banner-text">${esc(b.text)}</span>${b.link ? `<span class="site-banner-link">${esc(b.linkLabel || 'Mehr erfahren')} →</span>` : ''}</div>`;
}
function cfgCollectBanner(f) {
  const fd = new FormData(f);
  return { enabled: fd.has('enabled'), text: val(fd, 'text'), tone: val(fd, 'tone') || 'gold', link: val(fd, 'link'), linkLabel: val(fd, 'linkLabel'), from: val(fd, 'from'), to: val(fd, 'to'), audience: fd.getAll('audience'), dismissible: fd.has('dismissible') };
}

/* ---------------------------------------------------------------- Startseite */
function cfgHome() {
  const h = cfgWork('home');
  const order = [...h.order, ...Object.keys(st.cfg.sections).filter((k) => !h.order.includes(k))];
  const faq = h.faq || [];
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Startseite</h2></div>
      <p class="text-sm text-muted mb-4">Abschnitte ein- und ausblenden und umsortieren, Fragen &amp; Antworten selbst pflegen, Links zu Discord &amp; Co. und welche Kennzahlen öffentlich stehen. Einzelne Texte ändern Sie direkt auf der Seite (Reiter „Website &amp; Ränge“).</p>
      <form data-form="cfg-home" class="form-grid">
        <div><div class="label">Abschnitte (Reihenfolge von oben nach unten)</div>
          <div class="home-secs" id="cfgSections">${order
            .map(
              (id, i) => `<div class="home-sec" data-id="${id}"><label class="check"><input type="checkbox" name="show" ${h.hidden.includes(id) ? '' : 'checked'}> ${esc(st.cfg.sections[id])}</label>
                <span class="home-sec-btns"><button type="button" class="icon-btn sm" data-action="home-move" data-dir="-1" aria-label="Nach oben">${icon('chevronUp', 'ico-sm')}</button><button type="button" class="icon-btn sm" data-action="home-move" data-dir="1" aria-label="Nach unten">${icon('chevronDown', 'ico-sm')}</button></span></div>`
            )
            .join('')}</div></div>
        <div><label class="check"><input type="checkbox" name="customFaq" ${h.faq ? 'checked' : ''} data-action="home-faq-toggle"> Eigene Fragen &amp; Antworten verwenden (statt der Standardfragen)</label>
          <div id="cfgFaq" class="${h.faq ? '' : 'hidden'}">${faq.map(cfgFaqRow).join('')}<button type="button" class="btn-outline btn-sm mt-2" data-action="home-faq-add">${icon('plus', 'ico-sm')}<span>Frage hinzufügen</span></button></div></div>
        <div><div class="label">Links im Kontaktbereich (Discord, Instagram …)</div>
          <div id="cfgLinks">${h.links.map(cfgLinkRow).join('')}</div><button type="button" class="btn-outline btn-sm mt-2" data-action="home-link-add">${icon('plus', 'ico-sm')}<span>Link hinzufügen</span></button></div>
        <div><label class="label" for="cfgContactMail">E-Mail-Adresse im Kontaktbereich (Knopf „kopieren“)</label><input id="cfgContactMail" name="contactEmail" class="field" maxlength="120" value="${esc(h.contactEmail)}" placeholder="kontakt@pake-scha.ls"></div>
        <div><div class="label">Kennzahlen über den Mandantenstimmen</div>
          <label class="check"><input type="checkbox" name="kpi-closed" ${h.kpis.closed ? 'checked' : ''}> Abgeschlossene Verfahren</label>
          <label class="check"><input type="checkbox" name="kpi-success" ${h.kpis.success ? 'checked' : ''}> Erfolgsquote</label>
          <label class="check"><input type="checkbox" name="kpi-rating" ${h.kpis.rating ? 'checked' : ''}> Durchschnittsbewertung</label>
          <p class="form-hint">Ob die Kennzahlen überhaupt erscheinen, steht unter „Website &amp; Ränge“ („Erfolge öffentlich anzeigen“); kleine Zahlen erscheinen nie.</p></div>
        ${cfgBar('home', `<a class="btn-ghost btn-md" href="/?vorschau=1" target="_blank" rel="noopener">${icon('globe', 'ico-sm')}<span>Vorschau mit Entwurf</span></a>`)}
      </form>
    </section>`;
}
const cfgFaqRow = (f = { q: '', a: '' }) => `<div class="cfg-row faq-row"><input class="field" data-faq="q" maxlength="160" value="${esc(f.q)}" placeholder="Frage" aria-label="Frage"><textarea class="field" data-faq="a" rows="3" maxlength="800" placeholder="Antwort" aria-label="Antwort">${esc(f.a)}</textarea>
    <button type="button" class="icon-btn sm" data-action="home-row-del" aria-label="Entfernen">${icon('trash', 'ico-sm')}</button></div>`;
const cfgLinkRow = (l = { label: '', url: '' }) => `<div class="cfg-row link-row"><input class="field" data-link="label" maxlength="40" value="${esc(l.label)}" placeholder="Beschriftung (z. B. Discord)" aria-label="Beschriftung"><input class="field" data-link="url" maxlength="300" value="${esc(l.url)}" placeholder="https://…" aria-label="Adresse">
    <button type="button" class="icon-btn sm" data-action="home-row-del" aria-label="Entfernen">${icon('trash', 'ico-sm')}</button></div>`;
function cfgCollectHome(f) {
  const secs = [...f.querySelectorAll('.home-sec')];
  const faq = f.querySelector('[name="customFaq"]').checked
    ? [...f.querySelectorAll('.faq-row')].map((r) => ({ q: r.querySelector('[data-faq="q"]').value.trim(), a: r.querySelector('[data-faq="a"]').value.trim() })).filter((x) => x.q || x.a)
    : null;
  return {
    order: secs.map((s) => s.dataset.id),
    hidden: secs.filter((s) => !s.querySelector('[name="show"]').checked).map((s) => s.dataset.id),
    faq: faq && faq.length ? faq : null,
    links: [...f.querySelectorAll('.link-row')].map((r) => ({ label: r.querySelector('[data-link="label"]').value.trim(), url: r.querySelector('[data-link="url"]').value.trim() })).filter((x) => x.label || x.url),
    contactEmail: f.querySelector('[name="contactEmail"]').value.trim(),
    kpis: { closed: f.querySelector('[name="kpi-closed"]').checked, success: f.querySelector('[name="kpi-success"]').checked, rating: f.querySelector('[name="kpi-rating"]').checked },
  };
}

/* ---------------------------------------------------------------- Beschriftungen */
function cfgLabels() {
  const l = cfgWork('labels');
  const hints = Object.entries(l.hints);
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Beschriftungen &amp; Hilfetexte</h2></div>
      <p class="text-sm text-muted mb-4">Begriffe im ganzen Dashboard und auf der Website umbenennen („Mandant“ → „Klient“) und Hinweise unter Formularfeldern ändern. Zusammensetzungen wie „Mandantenkonto“ ziehen mit; Rechnungen, Verträge und Discord-Nachrichten bleiben unverändert.</p>
      <form data-form="cfg-labels" class="form-grid">
        <div><div class="label">Begriffe</div>
          <div class="cfg-terms">${Object.entries(st.cfg.terms)
            .map(([k, t]) => {
              const cur = l.terms[k] || {};
              return `<div class="cfg-row term-row" data-term="${k}"><span class="cfg-term-name">${esc(t.label)}</span><input class="field" data-t="sg" maxlength="30" value="${esc(cur.sg || '')}" placeholder="${esc(t.sg)} (Einzahl)" aria-label="${esc(t.sg)}: Einzahl"><input class="field" data-t="pl" maxlength="30" value="${esc(cur.pl || '')}" placeholder="${esc(t.pl)} (Mehrzahl)" aria-label="${esc(t.sg)}: Mehrzahl"></div>`;
            })
            .join('')}</div><p class="form-hint">Leer lassen = Standardwort. Einzahl und Mehrzahl immer beide ausfüllen.</p></div>
        <div><div class="label">Geänderte Hinweise</div>
          <div id="cfgHints">${hints.length ? hints.map(([k, text]) => cfgHintRow(k, text)).join('') : '<p class="form-hint">Noch keine. Klicken Sie unten auf „Hinweise bearbeiten“, wechseln Sie in eine Seite mit Formularen und klicken Sie dort einen grauen Hinweis unter einem Feld an.</p>'}</div>
          <button type="button" class="btn-outline btn-sm mt-2" data-action="hint-edit-mode">${icon('edit', 'ico-sm')}<span>Hinweise bearbeiten</span></button></div>
        ${cfgBar('labels')}
      </form>
    </section>`;
}
const cfgHintRow = (key, text) => `<div class="cfg-row hint-row" data-key="${esc(key)}"><code class="cfg-hint-key">${esc(key)}</code><textarea class="field" rows="2" maxlength="300" aria-label="Hinweistext für ${esc(key)}">${esc(text)}</textarea><button type="button" class="icon-btn sm" data-action="home-row-del" aria-label="Zurück zum Standard">${icon('trash', 'ico-sm')}</button></div>`;
function cfgCollectLabels(f) {
  const terms = {};
  for (const row of f.querySelectorAll('.term-row')) {
    const sg = row.querySelector('[data-t="sg"]').value.trim();
    const pl = row.querySelector('[data-t="pl"]').value.trim();
    if (sg && pl) terms[row.dataset.term] = { sg, pl };
    else if (sg || pl) throw new Error('Bitte bei jedem Begriff Einzahl und Mehrzahl ausfüllen.');
  }
  const hints = {};
  for (const row of f.querySelectorAll('.hint-row')) {
    const text = row.querySelector('textarea').value.trim();
    if (text) hints[row.dataset.key] = text;
  }
  return { terms, hints };
}

/* ---------------------------------------------------------------- Mitteilungen */
function cfgMessages() {
  const m = cfgWork('messages');
  const cat = st.cfg.messages;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Mitteilungstexte</h2></div>
      <p class="text-sm text-muted mb-4">Was Mandanten per Discord und im Ticket lesen. Mit Platzhaltern in geschweiften Klammern; leer = Standardtext im gewählten Ton. <code>**fett**</code> geht auch.</p>
      <form data-form="cfg-messages" class="form-grid cols-2">
        <div><label class="label" for="cfgMTone">Ansprache der Standardtexte</label><select id="cfgMTone" name="tone" class="field">${opt('sie', 'Sie (förmlich)', m.tone === 'sie')}${opt('du', 'Du (persönlich)', m.tone === 'du')}</select></div>
        <div><label class="label" for="cfgMDays">Erinnerung an fehlende Unterlagen nach … Tagen</label><input id="cfgMDays" type="number" name="docsAfterDays" min="1" max="30" class="field" value="${esc(m.docsAfterDays)}"><p class="form-hint">Die Zahlungserinnerung (Tage nach Fälligkeit) steht unter „Kanzlei &amp; Rechnungen“.</p></div>
        ${Object.entries(cat.messages)
          .map(
            ([k, d]) => `<div class="span-2 msg-box"><div class="flex items-center justify-between gap-2 flex-wrap"><label class="label mb-0" for="cfgM-${k}">${esc(d.label)}</label>
              <button type="button" class="btn-ghost btn-sm" data-action="msg-default" data-key="${k}">Standardtext einsetzen</button></div>
              <p class="form-hint mt-0">${esc(d.where)}</p>
              <textarea id="cfgM-${k}" name="msg-${k}" data-key="${k}" rows="5" maxlength="1200" class="field" placeholder="${esc(d[m.tone])}">${esc((m.texts && m.texts[k]) || '')}</textarea>
              <div class="tpl-chips">${d.placeholders.map((p) => `<button type="button" class="tpl-chip" data-action="msg-insert" data-key="${k}" data-text="{${p}}" title="${esc(cat.placeholders[p])}">{${esc(p)}}</button>`).join('')}</div>
              <div class="msg-preview" data-preview="${k}">${cfgMd(cfgFill((m.texts && m.texts[k]) || d[m.tone]))}</div></div>`
          )
          .join('')}
        <div class="span-2">${cfgBar('messages')}</div>
      </form>
    </section>`;
}
function cfgCollectMessages(f) {
  const fd = new FormData(f);
  const texts = {};
  for (const k of Object.keys(st.cfg.messages.messages)) {
    const v = String(fd.get(`msg-${k}`) || '').trim();
    if (v) texts[k] = v;
  }
  return { tone: val(fd, 'tone') === 'du' ? 'du' : 'sie', docsAfterDays: Number(val(fd, 'docsAfterDays') || 3), texts };
}

const CFG_COLLECT = { banner: cfgCollectBanner, home: cfgCollectHome, labels: cfgCollectLabels, messages: cfgCollectMessages };

async function cfgSave(key, form) {
  const draft = (await api.put(`/api/config/${key}/draft`, CFG_COLLECT[key](form))).draft;
  st.cfg.config[key].draft = draft;
  return draft;
}

/* ---------------------------------------------------------------- Sichern & Übertragen, Als Rang ansehen */
const VIEW_AS = { mandant: 'Mandant', mitarbeiter: 'Mitarbeiter / Anwalt', board: 'Board of Partners', webadmin: 'Web-Admin' };

function transferPanel() {
  const imp = st.cfgImport;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Sichern &amp; übertragen</h2></div>
      <p class="text-sm text-muted mb-4">Alle Einstellungen in einer Datei – als Sicherung, oder um sie auf eine andere Installation zu übertragen. Nur, wofür Sie das Recht haben; Passwörter, Webhooks und Schlüssel sind nie dabei.</p>
      <div class="form-actions">
        <a class="btn-outline btn-md" href="/api/config/export" download>${icon('download', 'ico-sm')}<span>Alle Einstellungen exportieren</span></a>
        <label class="btn-ghost btn-md cfg-file">${icon('plus', 'ico-sm')}<span>Datei einlesen …</span><input type="file" accept="application/json,.json" data-action="cfg-import-file" hidden></label>
      </div>
      ${
        imp
          ? `<div class="cfg-import mt-4"><div class="label">${imp.changes.length ? `${imp.changes.length} Änderungen würden übernommen` : 'Die Datei enthält nichts Neues.'}</div>
            ${imp.changes.length ? `<div class="ev-list">${imp.changes.map((c) => `<div class="ev-item"><div class="ev-top"><span class="ev-name">${esc(c.label)}</span></div><p class="text-xs text-dim mt-1">${esc(String(c.before ?? '—')).slice(0, 80)} → ${esc(String(c.after ?? '—')).slice(0, 80)}</p></div>`).join('')}</div>` : ''}
            ${imp.skipped.length ? `<p class="form-hint">Übersprungen: ${esc(imp.skipped.join('; '))}</p>` : ''}
            <div class="form-actions mt-3">${imp.changes.length ? `<button type="button" class="btn-gold btn-md" data-action="cfg-import-apply">${icon('check', 'ico-sm')}<span>Jetzt übernehmen</span></button>` : ''}<button type="button" class="btn-ghost btn-md" data-action="cfg-import-cancel">Abbrechen</button></div></div>`
          : ''
      }
    </section>`;
}

function viewAsPanel() {
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">Als Rang ansehen</h2>${st.viewAs ? badge(`Ansicht: ${VIEW_AS[st.viewAs]}`, 'gold') : ''}</div>
      <p class="text-sm text-muted mb-4">Menü und Seiten so sehen, wie sie ein Mandant, ein Mitarbeiter, das Board oder ein Web-Admin sieht – zum Prüfen der Rechte-Tabelle und der Beschriftungen. Die Daten bleiben Ihre eigenen; ändern können Sie weiter alles.</p>
      <div class="chip-row">${Object.entries(VIEW_AS).map(([k, l]) => `<button type="button" class="chip ${st.viewAs === k ? 'active' : ''}" data-action="view-as" data-as="${k}"><span>${esc(l)}</span></button>`).join('')}${st.viewAs ? `<button type="button" class="btn-ghost btn-sm" data-action="view-as" data-as="">Beenden</button>` : ''}</div>
    </section>`;
}

/** Band oben, solange „Als Rang ansehen“ läuft. */
function viewAsBand() {
  document.getElementById('viewAsBand')?.remove();
  if (!st.viewAs) return;
  const el = document.createElement('div');
  el.id = 'viewAsBand';
  el.className = 'view-as-band';
  el.innerHTML = `<span>${icon('eye', 'ico-sm')} Ansicht als <strong>${esc(VIEW_AS[st.viewAs])}</strong> – Menü und Seiten wie bei dieser Rolle</span><button type="button" class="btn-ghost btn-sm" data-action="view-as" data-as="">Beenden</button>`;
  $('#content').before(el);
}

/* ---------------------------------------------------------------- Aktionen */
Object.assign(actions, {
  'cfg-tab': (el) => {
    st.cfgTab = el.dataset.tab;
    renderView();
  },
  'cfg-publish': async (el) => {
    const key = el.dataset.key;
    const form = el.closest('form');
    await cfgSave(key, form);
    const r = await api.post(`/api/config/${key}/publish`, {});
    st.cfg.config[key].published = r.published;
    st.cfg.config[key].draft = null;
    await refreshSiteConfig();
    PS.confetti && PS.confetti(el.getBoundingClientRect().left + el.offsetWidth / 2, el.getBoundingClientRect().top, { count: 22 });
    toast('Veröffentlicht – gilt jetzt für alle.');
    renderView();
  },
  'cfg-discard': async (el) => {
    const key = el.dataset.key;
    if (!(await ask('Der Entwurf geht verloren; es gilt wieder der veröffentlichte Stand.', { title: 'Entwurf verwerfen?', confirmText: 'Verwerfen' }))) return;
    await api.del(`/api/config/${key}/draft`);
    st.cfg.config[key].draft = null;
    toast('Entwurf verworfen.');
    renderView();
  },
  'home-move': (el) => {
    const row = el.closest('.home-sec');
    const dir = Number(el.dataset.dir);
    const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    if (dir < 0) other.before(row);
    else other.after(row);
    row.classList.add('ps-row-in');
  },
  'home-faq-toggle': (el) => $('#cfgFaq').classList.toggle('hidden', !el.checked),
  'home-faq-add': (el) => el.insertAdjacentHTML('beforebegin', cfgFaqRow()),
  'home-link-add': (el) => $('#cfgLinks').insertAdjacentHTML('beforeend', cfgLinkRow()),
  'home-row-del': (el) => el.closest('.cfg-row').remove(),
  'msg-insert': (el) => {
    const ta = $(`#cfgM-${el.dataset.key}`);
    const s = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(el.dataset.text, s, ta.selectionEnd ?? s, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'msg-default': (el) => {
    const k = el.dataset.key;
    const ta = $(`#cfgM-${k}`);
    const tone = $('#cfgMTone').value;
    ta.value = st.cfg.messages.messages[k][tone];
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'hint-edit-mode': () => {
    PS.siteConfig.setHintMode(true);
    toast('Hinweise bearbeiten: Seite wechseln und einen grauen Hinweis anklicken. Esc beendet.', 'info', { duration: 7000 });
    go('settings');
  },
  'view-as': (el) => {
    st.viewAs = el.dataset.as || '';
    renderNav();
    viewAsBand();
    if (!allowed(st.view)) go('overview');
    else renderView();
  },
  'cfg-import-cancel': () => {
    st.cfgImport = null;
    renderView();
  },
  'cfg-import-apply': async () => {
    const r = await api.post('/api/config/import', { data: st.cfgImport.data, apply: true });
    st.cfgImport = null;
    await Promise.all([loadConfig(), loadAccess(), refreshSiteConfig()]);
    toast(`${r.changes.length} Änderungen übernommen.`);
    renderView();
  },
});

/** Datei einlesen → Vorschau der Änderungen. */
document.addEventListener('change', (e) => {
  const input = e.target.closest && e.target.closest('input[data-action="cfg-import-file"]');
  if (!input || !input.files[0]) return;
  const file = input.files[0];
  input.value = '';
  guard(async () => {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('Das ist keine gültige Einstellungs-Datei.');
    }
    const r = await api.post('/api/config/import', { data, apply: false });
    st.cfgImport = { ...r, data };
    renderView();
  });
});

/** Live-Vorschau: Banner und Mitteilungen während des Tippens. */
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('form[data-form="cfg-banner"], form[data-form="cfg-messages"]');
  if (!f) return;
  if (f.dataset.form === 'cfg-banner') {
    const box = $('#cfgBannerPreview');
    if (box) box.innerHTML = cfgBannerPreview(cfgCollectBanner(f));
  } else {
    const tone = f.elements.tone.value;
    for (const ta of f.querySelectorAll('textarea[data-key]')) {
      const box = f.querySelector(`[data-preview="${ta.dataset.key}"]`);
      if (box) box.innerHTML = cfgMd(cfgFill(ta.value.trim() || st.cfg.messages.messages[ta.dataset.key][tone]));
      ta.placeholder = st.cfg.messages.messages[ta.dataset.key][tone];
    }
  }
});

Object.assign(forms, {
  'cfg-banner': async (f) => {
    await cfgSave('banner', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
  'cfg-home': async (f) => {
    await cfgSave('home', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
  'cfg-labels': async (f) => {
    await cfgSave('labels', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
  'cfg-messages': async (f) => {
    await cfgSave('messages', f);
    toast('Entwurf gespeichert.');
    renderView();
  },
});

/** Nach dem Veröffentlichen: Banner und Beschriftungen im Dashboard sofort neu anwenden. */
async function refreshSiteConfig() {
  const me = await api.get('/api/auth/me');
  st.siteConfig = me.siteConfig;
  if (window.PS.siteConfig && st.siteConfig) {
    PS.siteConfig.setLabels(st.siteConfig.labels);
    PS.siteConfig.banner(st.siteConfig.banner, $('#content'), { className: 'dash-banner' });
  }
}

/* Hinweise anklicken und ändern (Modus „Hinweise bearbeiten“) */
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('hint-edit')) return;
  const hint = e.target.closest && e.target.closest('.form-hint[data-hint-key]');
  if (!hint || hint.querySelector('textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  const key = hint.dataset.hintKey;
  const old = hint.textContent;
  hint.innerHTML = `<textarea class="field" rows="2" maxlength="300">${esc(old)}</textarea><span class="hint-edit-btns"><button type="button" class="btn-gold btn-sm" data-hint-save>Speichern</button><button type="button" class="btn-ghost btn-sm" data-hint-cancel>Abbrechen</button></span>`;
  const ta = hint.querySelector('textarea');
  ta.focus();
  hint.querySelector('[data-hint-cancel]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    hint.textContent = old;
  });
  hint.querySelector('[data-hint-save]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const text = ta.value.trim();
    guard(async () => {
      const labels = { ...(st.cfg && st.cfg.config.labels ? cfgWork('labels') : (await api.get('/api/config')).config.labels.published) };
      const next = { terms: labels.terms || {}, hints: { ...(labels.hints || {}) } };
      if (text) next.hints[key] = text;
      else delete next.hints[key];
      await api.put('/api/config/labels/draft', next);
      hint.textContent = text || old;
      hint.dataset.hintDone = text;
      toast('Hinweis im Entwurf gespeichert – unter Einstellungen → Texte & Banner → Beschriftungen veröffentlichen.', 'info', { duration: 6000 });
      if (st.cfg) await loadConfig();
    });
  });
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('hint-edit') && !document.querySelector('.form-hint textarea')) {
    PS.siteConfig.setHintMode(false);
    toast('Hinweise bearbeiten beendet.', 'info');
  }
});
