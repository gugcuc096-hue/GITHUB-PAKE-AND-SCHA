/*
 * Kanzlei-Dashboard – Teil 13 von 14: Kanzlei – Wiki (mit Strafgesetzbuch und Textbausteinen), Board-Beschlüsse,
 * Sieg-Moment, Anwalt des Monats (Einstellungen → Website & Ränge) und Textbausteine im Akten-Chat.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Kanzlei-Wiki: Artikel in einfacher Schreibweise + das Strafgesetzbuch zum Nachschlagen
   ================================================================ */

/** Schreibweise der Artikel → HTML (erst maskiert, dann formatiert): ## Überschrift, - Liste, 1. Schritt, > Hinweis, **fett**. */
function wikiHtml(text) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\{\{(\w+)\}\}/g, '<code>{{$1}}</code>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) close();
    else if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      close();
      out.push(`<h${m[1].length + 1} class="wiki-h">${inline(m[2])}</h${m[1].length + 1}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/)) || (m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      const kind = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      close();
      out.push(`<p class="wiki-note">${icon('info', 'ico-sm')}<span>${inline(m[1])}</span></p>`);
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('');
}

const foldText = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

views.wiki = {
  async load() {
    if (st.wikiTab === 'stgb') await loadPenal();
    if (st.wikiTab === 'bausteine') await loadSnippets(true);
    st.wiki = await api.get('/api/wiki');
  },
  render() {
    const tab = ['stgb', 'bausteine'].includes(st.wikiTab) ? st.wikiTab : 'artikel';
    const board = st.wiki.canEdit;
    const head = `
        <div class="page-head">
          <div><h1 class="page-title">Kanzlei-Wiki</h1><p class="page-sub">Abläufe, Vorlagen und Gerichtspraxis zum Nachschlagen – und das Strafgesetzbuch mit allen Strafrahmen.</p></div>
          ${
            tab === 'bausteine'
              ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="snip-new">${icon('plus')}<span>Neuer Baustein</span></button></div>`
              : board
                ? `<div class="page-actions">${tab === 'stgb' ? `<button class="btn-outline btn-md" data-action="offence-new">${icon('plus')}<span>Tatbestand</span></button>` : `<button class="btn-gold btn-md" data-action="wiki-new">${icon('plus')}<span>Neuer Artikel</span></button>`}</div>`
                : ''
          }
        </div>
        <div class="chip-row mb-4" role="tablist" aria-label="Bereiche des Wikis">
          <button type="button" class="chip ${tab === 'artikel' ? 'active' : ''}" role="tab" aria-selected="${tab === 'artikel'}" data-action="wiki-tab" data-tab="artikel">${icon('book', 'ico-sm')}<span>Artikel</span><span class="chip-count">${st.wiki.articles.length}</span></button>
          <button type="button" class="chip ${tab === 'stgb' ? 'active' : ''}" role="tab" aria-selected="${tab === 'stgb'}" data-action="wiki-tab" data-tab="stgb">${icon('scale', 'ico-sm')}<span>Strafgesetzbuch</span></button>
          <button type="button" class="chip ${tab === 'bausteine' ? 'active' : ''}" role="tab" aria-selected="${tab === 'bausteine'}" data-action="wiki-tab" data-tab="bausteine">${icon('chat', 'ico-sm')}<span>Textbausteine</span></button>
        </div>`;
    if (tab === 'bausteine')
      return `${head}<p class="text-sm text-muted mb-4">Im Akten-Chat und in internen Notizen <code class="snip-code">/</code> tippen und den Baustein wählen (Pfeiltasten, Enter) – Name des Mandanten, Ihr Name und Rang, Aktenzeichen &amp; Co. setzt das Dashboard automatisch ein. Anlegen kann jeder, ändern wer ihn angelegt hat oder das Board.</p>
        <div class="panel p-2 md:p-3 snip-list">${snippetRows(st.snippets.snippets)}</div>`;
    return head + (tab === 'stgb' ? stgbPanel() : wikiPanel());
  },
};

function wikiPanel() {
  const cats = st.wiki.categories;
  const cat = cats.includes(st.wikiCat) ? st.wikiCat : '';
  return `
      <div class="wiki-tools">
        <label class="search">${icon('search')}<input id="wikiSearch" class="field" type="search" placeholder="Im Wiki suchen …" value="${esc(st.wikiQ || '')}" autocomplete="off" aria-label="Im Wiki suchen"></label>
        ${cats.length > 1 ? `<div class="chip-row">${['', ...cats].map((c) => `<button type="button" class="chip ${cat === c ? 'active' : ''}" data-action="wiki-cat" data-value="${esc(c)}">${esc(c || 'Alle')}</button>`).join('')}</div>` : ''}
      </div>
      <div id="wikiList">${wikiCards()}</div>`;
}

function wikiCards() {
  const q = foldText(st.wikiQ || '').trim();
  const cat = st.wiki.categories.includes(st.wikiCat) ? st.wikiCat : '';
  const list = st.wiki.articles.filter((a) => (!cat || a.category === cat) && (!q || q.split(/\s+/).every((w) => foldText(`${a.title} ${a.category} ${a.text}`).includes(w))));
  if (!list.length) return `<div class="panel">${empty(q ? `Nichts gefunden für „${st.wikiQ}“.` : 'Noch keine Artikel.', 'book')}</div>`;
  return `<div class="wiki-grid">${list
    .map(
      (a) => `<button type="button" class="panel wiki-card" data-action="wiki-open" data-id="${a.id}">
        <span class="wiki-card-top"><span class="wiki-cat">${esc(a.category)}</span>${a.pinned ? `<span class="wiki-pin" title="Angeheftet">${icon('pin', 'ico-sm')}</span>` : ''}</span>
        <span class="wiki-card-title">${esc(a.title)}</span>
        <span class="wiki-card-text">${esc(a.excerpt)}</span>
        <span class="wiki-card-foot">Stand ${esc(parseDate(a.updatedAt)?.toLocaleDateString('de-DE') || '—')}${a.updatedByName ? ` · ${esc(a.updatedByName)}` : ''}</span>
      </button>`
    )
    .join('')}</div>`;
}

async function openWikiArticle(id) {
  const { article: a, canEdit } = await api.get('/api/wiki/' + id);
  openModal(
    `
      <p class="wiki-cat">${esc(a.category)}</p>
      <h2 class="modal-title mt-2">${esc(a.title)}</h2>
      <p class="modal-sub">Stand ${esc(fmtDate(a.updatedAt))}${a.updatedByName ? ` · ${esc(a.updatedByName)}` : ''}</p>
      <article class="wiki-body">${wikiHtml(a.body)}</article>
      ${
        canEdit
          ? `<div class="form-actions mt-6"><button type="button" class="btn-outline btn-md" data-action="wiki-edit" data-id="${a.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button type="button" class="btn-ghost btn-md" data-action="wiki-delete" data-id="${a.id}" data-title="${esc(a.title)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button></div>`
          : ''
      }`,
    { wide: true, key: `wiki-${a.id}`, reopen: () => openWikiArticle(a.id) }
  );
}

function wikiEditor(a) {
  const v = a || { title: '', category: st.wikiCat || 'Allgemein', body: '', pinned: false };
  openModal(
    `
      <h2 class="modal-title">${a ? 'Artikel bearbeiten' : 'Neuer Artikel'}</h2>
      <p class="modal-sub">Für die ganze Kanzlei sichtbar. Formatierung: <code>## Überschrift</code> · <code>- Aufzählung</code> · <code>1. Schritt</code> · <code>**fett**</code> · <code>&gt; Hinweis</code></p>
      <form data-form="wiki" data-id="${a ? a.id : ''}" class="form-grid cols-2">
        <div class="span-2"><label class="label" for="wkTitle">Titel</label><input id="wkTitle" name="title" class="field" required minlength="2" maxlength="120" value="${esc(v.title)}" placeholder="z. B. Ablauf einer Haftprüfung" autofocus></div>
        <div><label class="label" for="wkCat">Kategorie</label><input id="wkCat" name="category" class="field" required minlength="2" maxlength="40" list="wkCats" value="${esc(v.category)}">
          <datalist id="wkCats">${(st.wiki?.categories || []).map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
        <div class="flex items-end"><label class="check"><input type="checkbox" name="pinned" ${v.pinned ? 'checked' : ''}> Oben anheften</label></div>
        <div class="span-2"><label class="label" for="wkBody">Text</label><textarea id="wkBody" name="body" rows="16" class="field wiki-editor" required maxlength="20000">${esc(v.body)}</textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`,
    { wide: true }
  );
}

/* ---------------------------------------------------------------- Strafgesetzbuch im Wiki */
function stgbPanel() {
  const p = st.penal;
  return `
      <div class="wiki-tools">
        <label class="search">${icon('search')}<input id="stgbSearch" class="field" type="search" placeholder="Paragraph oder Stichwort, z. B. 21 oder Raub" value="${esc(st.stgbQ || '')}" autocomplete="off" aria-label="Im Strafgesetzbuch suchen"></label>
        <p class="text-xs text-dim">Gesamtstrafe höchstens ${p.cap} HE, in besonders schweren Fällen ${p.capSevere} HE (§ 3 Abs. 2) · ohne festgelegte Geldstrafe ${usd(p.finePerHe)} je HE (§ 13 Abs. 2)</p>
      </div>
      <div id="stgbList" class="panel p-2 md:p-3">${stgbRows()}</div>`;
}

function stgbRows() {
  const p = st.penal;
  const q = foldText(st.stgbQ || '').trim();
  const byPara = new Map();
  for (const o of p.offences) byPara.set(o.para, [...(byPara.get(o.para) || []), o]);
  const list = p.laws.filter((l) => {
    if (!q) return true;
    const offs = byPara.get(l.para) || [];
    const hay = foldText(`${l.title} ${l.chapterTitle} ${offs.map((o) => `${o.title} ${o.note}`).join(' ')}`);
    return q.split(/\s+/).every((w) => hay.includes(w) || foldText(l.para) === w || `§${foldText(l.para)}` === w);
  });
  if (!list.length) return empty(`Nichts gefunden für „${st.stgbQ}“.`, 'scale');
  let chapter = null;
  return list
    .map((l) => {
      const head = l.chapter !== chapter && l.chapter ? `<div class="pk-chapter">${esc(l.chapter)} · ${esc(l.chapterTitle)}</div>` : '';
      chapter = l.chapter;
      const offs = byPara.get(l.para) || [];
      return `${head}<button type="button" class="stgb-row" data-action="law-open" data-para="${esc(l.para)}">
          <span class="pk-cite">§ ${esc(l.para)}</span>
          <span class="pk-main"><span class="pk-title">${esc(l.title)}</span>${offs.length ? `<span class="pk-range">${offs.map((o) => esc(penaltyText(o))).join(' · ')}</span>` : ''}</span>
          ${icon('chevronRight', 'ico-sm')}
        </button>`;
    })
    .join('');
}

/** Board: Tatbestand anlegen bzw. ändern (Strafrahmen in HE, Geldstrafe, Versuch, schwerer Fall). */
function offenceEditor(o, para = '') {
  const v = o || { para, paragraph: '', title: '', minHe: 0, maxHe: null, fine: 'none', fineMax: null, attempt: false, severe: false, note: '' };
  openModal(`
      <h2 class="modal-title">${o ? 'Tatbestand bearbeiten' : 'Neuer Tatbestand'}</h2>
      <p class="modal-sub">Gilt für neue Anklagepunkte – bestehende Akten behalten ihren Stand.</p>
      <form data-form="offence" data-id="${o ? o.id : ''}" class="form-grid cols-2">
        <div><label class="label" for="ofPara">Paragraph</label><input id="ofPara" name="para" class="field" required pattern="\\d{1,3}[a-z]?" maxlength="4" value="${esc(v.para)}" placeholder="z. B. 21"></div>
        <div><label class="label" for="ofAbs">Absatz / Nummer</label><input id="ofAbs" name="paragraph" class="field" maxlength="40" value="${esc(v.paragraph)}" placeholder="z. B. Abs. 2"></div>
        <div class="span-2"><label class="label" for="ofTitle">Bezeichnung</label><input id="ofTitle" name="title" class="field" required minlength="2" maxlength="160" value="${esc(v.title)}"></div>
        <div><label class="label" for="ofMin">Mindeststrafe (HE)</label><input id="ofMin" name="minHe" type="number" min="0" max="999" class="field" value="${esc(v.minHe)}"></div>
        <div><label class="label" for="ofMax">Höchststrafe (HE)</label><input id="ofMax" name="maxHe" type="number" min="0" max="999" class="field" value="${v.maxHe == null ? '' : esc(v.maxHe)}" placeholder="leer = nach oben offen"></div>
        <div><label class="label" for="ofFine">Geldstrafe</label><select id="ofFine" name="fine" class="field">${[
          ['none', 'keine – nur Freiheitsstrafe'],
          ['alt', 'Freiheitsstrafe oder Geldstrafe'],
          ['only', 'nur Geldstrafe'],
        ]
          .map(([k, l]) => opt(k, l, v.fine === k))
          .join('')}</select></div>
        <div><label class="label" for="ofFineMax">Geldstrafe höchstens ($)</label><input id="ofFineMax" name="fineMax" type="number" min="0" max="100000000" class="field" value="${v.fineMax == null ? '' : esc(v.fineMax)}" placeholder="leer = ${usd(st.penal?.finePerHe || 3000)} je HE"></div>
        <div class="span-2 flex flex-wrap gap-x-6 gap-y-2">
          <label class="check"><input type="checkbox" name="attempt" ${v.attempt ? 'checked' : ''}> Versuch strafbar</label>
          <label class="check"><input type="checkbox" name="severe" ${v.severe ? 'checked' : ''}> Schwerer Fall (Gesamtstrafe bis ${st.penal?.capSevere || 180} HE)</label>
        </div>
        <div class="span-2"><label class="label" for="ofNote">Hinweis</label><input id="ofNote" name="note" class="field" maxlength="300" value="${esc(v.note)}" placeholder="optional, z. B. Führerscheinentzug"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>${
          o ? `<button type="button" class="btn-ghost btn-md" data-action="offence-delete" data-id="${o.id}" data-title="${esc(o.title)}">${icon('trash', 'ico-sm')}<span>Entfernen</span></button>` : ''
        }</div>
      </form>`);
}

async function lawEditor(para) {
  const { law: l } = await api.get('/api/penal/laws/' + encodeURIComponent(para));
  openModal(
    `
      <h2 class="modal-title">§ ${esc(l.para)} bearbeiten</h2>
      <p class="modal-sub">Absätze als „(1) …“ je Zeile, Aufzählungen als „1. …“.</p>
      <form data-form="law" data-para="${esc(l.para)}" class="form-grid">
        <div><label class="label" for="lwTitle">Überschrift</label><input id="lwTitle" name="title" class="field" required minlength="2" maxlength="160" value="${esc(l.title)}"></div>
        <div><label class="label" for="lwText">Gesetzestext</label><textarea id="lwText" name="text" rows="14" class="field wiki-editor" maxlength="20000">${esc(l.text || '')}</textarea></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`,
    { wide: true }
  );
}

/* ================================================================
   Board-Beschlüsse
   ================================================================ */
const RES_TONE = { offen: 'amber', angenommen: 'emerald', abgelehnt: 'red', zurueckgezogen: 'slate' };
const VOTE_LABEL = { ja: 'Ja', nein: 'Nein', enthaltung: 'Enthaltung' };

views.resolutions = {
  async load() {
    st.resolutions = await api.get('/api/resolutions');
    st.resolutionOpen = st.resolutions.pending;
  },
  render() {
    const all = st.resolutions.resolutions;
    const open = all.filter((r) => r.status === 'offen');
    const done = all.filter((r) => r.status !== 'offen');
    const f = st.resFilter === 'entschieden' ? 'entschieden' : 'offen';
    return `
        <div class="page-head">
          <div><h1 class="page-title">Beschlüsse</h1><p class="page-sub">Anträge des Board of Partners: abstimmen, entscheiden und im Beschlussprotokoll nachlesen.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="res-new">${icon('plus')}<span>Neuer Antrag</span></button></div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${f === 'offen' ? 'active' : ''}" data-action="res-filter" data-value="offen">Zur Abstimmung <span class="chip-count">${open.length}</span></button>
          <button class="chip ${f === 'entschieden' ? 'active' : ''}" data-action="res-filter" data-value="entschieden">Beschlussprotokoll <span class="chip-count">${done.length}</span></button>
        </div>
        ${
          f === 'offen'
            ? open.length
              ? `<div class="res-list">${open.map(resolutionCard).join('')}</div>`
              : `<div class="panel">${empty('Gerade steht nichts zur Abstimmung.', 'ballot')}</div>`
            : done.length
              ? `<div class="panel p-2 md:p-3">${done.map(resolutionRow).join('')}</div>`
              : `<div class="panel">${empty('Noch keine Beschlüsse.', 'ballot')}</div>`
        }`;
  },
};

function deadlineText(r) {
  if (!r.deadline) return 'ohne Frist';
  const ms = parseDate(r.deadline) - Date.now();
  if (ms <= 0) return 'Frist abgelaufen';
  const h = Math.round(ms / 3600000);
  return h < 1 ? 'endet in unter 1 Std.' : h < 48 ? `endet in ${h} Std.` : `endet in ${Math.round(h / 24)} Tagen`;
}

function tallyBar(r) {
  const c = r.counts;
  const total = Math.max(1, r.eligible);
  const seg = (k) => (c[k] ? `<span class="res-seg res-${k}" style="width:${(c[k] / total) * 100}%"></span>` : '');
  return `<div class="res-bar" role="img" aria-label="${c.ja} Ja, ${c.nein} Nein, ${c.enthaltung} Enthaltung">${seg('ja')}${seg('nein')}${seg('enthaltung')}</div>
    <div class="res-counts"><span class="res-k res-k-ja">${c.ja} Ja</span><span class="res-k res-k-nein">${c.nein} Nein</span><span class="res-k res-k-enthaltung">${c.enthaltung} Enthaltung</span></div>`;
}

function resolutionCard(r) {
  const voted = r.votes.length;
  return `<article class="panel panel-pad res-card">
      <div class="res-head">
        <span class="font-mono text-gold text-sm">${esc(r.reference)}</span>
        <span class="text-xs text-dim">${esc(deadlineText(r))}</span>
      </div>
      <h2 class="res-title">${esc(r.title)}</h2>
      ${r.body ? `<p class="res-body">${esc(r.body)}</p>` : ''}
      <p class="text-xs text-dim mt-2">Beantragt von ${esc(r.createdByName)} · ${esc(fmtDate(r.createdAt))}</p>
      <div class="mt-4">${tallyBar(r)}</div>
      <p class="text-xs text-dim mt-2">${voted} von ${r.eligible} haben abgestimmt${r.missing.length ? ` · es fehlen: ${esc(r.missing.join(', '))}` : ''}</p>
      ${
        r.canVote
          ? `<div class="res-vote" role="group" aria-label="Ihre Stimme">${['ja', 'nein', 'enthaltung']
              .map(
                (v) =>
                  `<button type="button" class="res-btn res-btn-${v} ${r.myVote === v ? 'on' : ''}" aria-pressed="${r.myVote === v}" data-action="res-vote" data-id="${r.id}" data-vote="${v}">${icon(
                    v === 'ja' ? 'check' : v === 'nein' ? 'x' : 'minus',
                    'ico-sm'
                  )}<span>${VOTE_LABEL[v]}</span></button>`
              )
              .join('')}</div>`
          : ''
      }
      ${
        r.votes.length
          ? `<div class="res-voters">${r.votes.map((v) => `<span class="res-voter" ${v.comment ? `title="${esc(v.comment)}"` : ''}><i class="res-dot res-${v.vote}"></i>${esc(v.name)}</span>`).join('')}</div>`
          : ''
      }
      ${
        r.canManage
          ? `<div class="res-manage"><button type="button" class="btn-ghost btn-sm" data-action="res-close" data-id="${r.id}">Abstimmung jetzt beenden</button><button type="button" class="btn-ghost btn-sm" data-action="res-withdraw" data-id="${r.id}">Zurückziehen</button></div>`
          : ''
      }
    </article>`;
}

function resolutionRow(r) {
  const c = r.counts;
  return `<div class="list-row wrap">
      <div class="main">
        <div class="title flex flex-wrap items-center gap-2"><span class="font-mono text-gold text-sm">${esc(r.reference)}</span>${esc(r.title)} ${badge(r.statusLabel, RES_TONE[r.status])}</div>
        <div class="meta">${c.ja} Ja · ${c.nein} Nein · ${c.enthaltung} Enthaltung · ${r.status === 'zurueckgezogen' ? 'zurückgezogen' : 'entschieden'} ${esc(fmtDate(r.decidedAt))} · beantragt von ${esc(r.createdByName)}</div>
        ${r.body ? `<div class="meta res-row-body">${esc(r.body)}</div>` : ''}
        ${r.votes.length ? `<div class="res-voters mt-2">${r.votes.map((v) => `<span class="res-voter"><i class="res-dot res-${v.vote}"></i>${esc(v.name)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

function resolutionModal() {
  openModal(`
      <h2 class="modal-title">Neuer Antrag</h2>
      <p class="modal-sub">Alle Mitglieder des Board of Partners stimmen ab. Angenommen bei mehr Ja- als Nein-Stimmen – sobald alle abgestimmt haben oder die Frist endet.</p>
      <form data-form="resolution" class="form-grid">
        <div><label class="label" for="rsTitle">Antrag</label><input id="rsTitle" name="title" class="field" required minlength="4" maxlength="160" placeholder="z. B. Honorar für Notfalleinsätze auf 7.500 $ erhöhen" autofocus></div>
        <div><label class="label" for="rsBody">Begründung</label><textarea id="rsBody" name="body" rows="5" class="field" maxlength="4000" placeholder="optional"></textarea></div>
        <div><label class="label" for="rsDeadline">Abstimmung läuft</label><select id="rsDeadline" name="deadline" class="field">${[
          ['24', '24 Stunden'],
          ['72', '3 Tage'],
          ['168', '1 Woche'],
          ['', 'ohne Frist (bis alle abgestimmt haben)'],
        ]
          .map(([k, l]) => opt(k, l, k === '72'))
          .join('')}</select></div>
        <label class="check"><input type="checkbox" name="voteYes" checked> Ich stimme gleich mit „Ja“</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('ballot')}<span>Zur Abstimmung stellen</span></button></div>
      </form>`);
}

/* ================================================================
   Sieg-Moment: goldenes Siegel beim Abschluss mit Erfolg (Discord-Beitrag macht der Server)
   ================================================================ */
function victoryMoment(label) {
  $('#victory')?.remove();
  const calm = window.PS.motion.calm();
  const el = document.createElement('div');
  el.id = 'victory';
  el.className = `victory${calm ? ' calm' : ''}`;
  el.setAttribute('role', 'status');
  // Gezackter Siegelrand: 32 Zacken
  const pts = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    const r = i % 2 ? 88 : 98;
    return `${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const sparks = calm
    ? ''
    : Array.from({ length: 18 }, (_, i) => `<i style="--a:${(i / 18) * 360}deg;--d:${110 + (i % 3) * 38}px;--t:${0.55 + (i % 4) * 0.12}s"></i>`).join('');
  el.innerHTML = `
      <div class="victory-inner">
        <div class="victory-sparks" aria-hidden="true">${sparks}</div>
        <svg class="victory-seal" viewBox="0 0 200 200" aria-hidden="true">
          <defs><linearGradient id="vsGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e08f"/><stop offset=".45" stop-color="#d4af37"/><stop offset="1" stop-color="#8f7322"/></linearGradient></defs>
          <polygon points="${pts}" fill="url(#vsGold)"/>
          <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(26,20,5,.55)" stroke-width="2"/>
          <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(26,20,5,.35)" stroke-width="1" stroke-dasharray="3 4"/>
          <path d="M72 102l18 18 38-40" fill="none" stroke="#1a1405" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="victory-kicker">Erfolg für die Kanzlei</p>
        <p class="victory-title">${esc(label)}</p>
      </div>`;
  document.body.appendChild(el);
  try {
    navigator.vibrate?.([30, 60, 90]);
  } catch {
    /* kein Vibrieren auf diesem Gerät */
  }
  const done = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  };
  el.addEventListener('click', done);
  setTimeout(done, calm ? 1800 : 2600);
}

/* ================================================================
   Anwalt des Monats (Einstellungen → Website & Ränge)
   ================================================================ */
function lotmPanel(s) {
  const cur = s.lotmCurrent;
  const ranking = s.lotmRanking || [];
  return `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('star')} Anwalt des Monats</h2>${cur ? badge(cur.name, 'gold') : badge('Niemand', 'slate')}</div>
        <p class="text-sm text-muted mb-4">Goldenes Abzeichen an der Teamkarte auf der Startseite und auf der Profilseite, dazu ein Discord-Beitrag zum Monatswechsel. Automatisch zählt der Vormonat (${esc(s.lotmMonth)}): je abgeschlossenem Mandat 2 Punkte, je Erfolg 3 weitere, je 5-Sterne-Bewertung 1 Punkt.</p>
        <form data-form="settings-lotm" class="form-grid cols-2">
          <div><label class="label" for="lotmMode">Auswahl</label><select id="lotmMode" name="lotmMode" class="field">${[
            ['auto', 'Automatisch aus den Akten'],
            ['manual', 'Vom Board gewählt'],
            ['off', 'Aus'],
          ]
            .map(([k, l]) => opt(k, l, s.lotmMode === k))
            .join('')}</select></div>
          <div><label class="label" for="lotmMember">Gewählt (bei „Vom Board gewählt“)</label><select id="lotmMember" name="lotmMember" class="field"><option value="">– bitte wählen –</option>${(s.lotmCandidates || [])
            .map((m) => opt(m.id, m.name, m.id === s.lotmMember))
            .join('')}</select></div>
          ${
            ranking.length
              ? `<div class="span-2"><span class="label">Automatik für ${esc(s.lotmMonth)}</span><ol class="lotm-rank">${ranking
                  .map((r) => `<li><strong>${esc(r.name)}</strong><span>${r.points} Punkte · ${r.closed} abgeschlossen · ${r.wins} Erfolge${r.stars ? ` · ${r.stars} × ★★★★★` : ''}</span></li>`)
                  .join('')}</ol></div>`
              : `<p class="span-2 text-xs text-dim">Im ${esc(s.lotmMonth)} wurde noch keine Akte abgeschlossen – automatisch gibt es diesen Monat niemanden.</p>`
          }
          <div class="span-2 form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button></div>
        </form>
      </section>`;
}

/* ================================================================
   Aktionen & Formulare
   ================================================================ */
Object.assign(actions, {
  'wiki-tab': async (el) => {
    st.wikiTab = el.dataset.tab;
    if (st.wikiTab === 'stgb') await loadPenal();
    if (st.wikiTab === 'bausteine') await loadSnippets(true);
    renderView();
  },
  'wiki-cat': (el) => {
    st.wikiCat = el.dataset.value;
    renderView();
  },
  'wiki-open': (el) => openWikiArticle(Number(el.dataset.id)),
  'wiki-new': () => wikiEditor(null),
  'wiki-edit': async (el) => wikiEditor((await api.get('/api/wiki/' + el.dataset.id)).article),
  'wiki-delete': async (el) => {
    if (!(await askDelete('Artikel löschen?', `„${el.dataset.title}“ wird aus dem Wiki entfernt.`))) return;
    await api.del('/api/wiki/' + el.dataset.id);
    closeModal();
    toast('Artikel gelöscht.');
    await refreshBehind();
  },
  'offence-new': () => offenceEditor(null),
  'offence-edit': async (el) => {
    const p = await loadPenal(true);
    const o = p.offences.find((x) => x.id === Number(el.dataset.id));
    if (o) offenceEditor(o);
  },
  'offence-add-to': (el) => offenceEditor(null, el.dataset.para),
  'offence-delete': async (el) => {
    if (!(await askDelete('Tatbestand entfernen?', `„${el.dataset.title}“ verschwindet aus dem Strafkatalog. Anklagepunkte in bestehenden Akten bleiben erhalten.`, 'Entfernen'))) return;
    await api.del('/api/penal/offences/' + el.dataset.id);
    await loadPenal(true);
    toast('Tatbestand entfernt.');
    await modalBack();
    if (st.view === 'wiki') renderView();
  },
  'law-edit': (el) => lawEditor(el.dataset.para),
  'res-filter': (el) => {
    st.resFilter = el.dataset.value;
    renderView();
  },
  'res-new': () => resolutionModal(),
  'res-vote': async (el) => {
    // sofort sichtbar: gewählte Stimme markieren
    el.parentElement.querySelectorAll('.res-btn').forEach((b) => {
      b.classList.toggle('on', b === el);
      b.setAttribute('aria-pressed', String(b === el));
    });
    const r = await api.post(`/api/resolutions/${el.dataset.id}/vote`, { vote: el.dataset.vote });
    buzz();
    if (r.decided) toast(`Alle haben abgestimmt – Antrag ${r.decided === 'angenommen' ? 'angenommen' : 'abgelehnt'}.`);
    await refreshBehind();
    load.resolutionCount().then(renderNav).catch(() => {});
  },
  'res-close': async (el) => {
    if (!(await ask('Die Abstimmung endet jetzt mit den bisherigen Stimmen.', { title: 'Abstimmung beenden?', confirmText: 'Beenden' }))) return;
    const r = await api.post(`/api/resolutions/${el.dataset.id}/close`);
    toast(`Antrag ${r.decided}.`);
    await refreshBehind();
    load.resolutionCount().then(renderNav).catch(() => {});
  },
  'res-withdraw': async (el) => {
    if (!(await askDelete('Antrag zurückziehen?', 'Der Antrag wird nicht entschieden und steht als „zurückgezogen“ im Protokoll.', 'Zurückziehen'))) return;
    await api.post(`/api/resolutions/${el.dataset.id}/withdraw`);
    toast('Antrag zurückgezogen.');
    await refreshBehind();
    load.resolutionCount().then(renderNav).catch(() => {});
  },
});

Object.assign(forms, {
  wiki: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = { title: val(fd, 'title'), category: val(fd, 'category'), body: val(fd, 'body'), pinned: fd.get('pinned') === 'on' };
    const r = id ? await api.patch('/api/wiki/' + id, body) : await api.post('/api/wiki', body);
    toast('Artikel gespeichert.');
    st.wikiTab = 'artikel';
    if (id) await modalBack();
    else {
      closeModal();
      openWikiArticle(r.article.id);
    }
    if (st.view === 'wiki') refreshBehind();
  },
  offence: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const num = (k) => (val(fd, k) === '' ? null : Number(val(fd, k)));
    const body = {
      para: val(fd, 'para').toLowerCase(),
      paragraph: val(fd, 'paragraph'),
      title: val(fd, 'title'),
      minHe: num('minHe') ?? 0,
      maxHe: num('maxHe'),
      fine: val(fd, 'fine'),
      fineMax: num('fineMax'),
      attempt: fd.get('attempt') === 'on',
      severe: fd.get('severe') === 'on',
      note: val(fd, 'note'),
    };
    if (id) await api.patch('/api/penal/offences/' + id, body);
    else await api.post('/api/penal/offences', body);
    await loadPenal(true);
    toast('Strafkatalog gespeichert.');
    await modalBack();
    if (st.view === 'wiki') renderView();
  },
  law: async (f) => {
    const fd = new FormData(f);
    await api.put('/api/penal/laws/' + encodeURIComponent(f.dataset.para), { title: val(fd, 'title'), text: val(fd, 'text') });
    await loadPenal(true);
    toast('Gesetzestext gespeichert.');
    await modalBack();
    if (st.view === 'wiki') renderView();
  },
  resolution: async (f) => {
    const fd = new FormData(f);
    const hours = val(fd, 'deadline');
    await api.post('/api/resolutions', {
      title: val(fd, 'title'),
      body: val(fd, 'body'),
      deadlineHours: hours ? Number(hours) : null,
      ...(fd.get('voteYes') === 'on' ? { vote: 'ja' } : {}),
    });
    toast('Antrag zur Abstimmung gestellt.');
    closeModal();
    st.resFilter = 'offen';
    await refreshBehind();
    load.resolutionCount().then(renderNav).catch(() => {});
  },
  'settings-lotm': async (f) => {
    const mode = f.elements.lotmMode.value;
    const member = f.elements.lotmMember.value ? Number(f.elements.lotmMember.value) : null;
    if (mode === 'manual' && !member) throw new Error('Bitte auswählen, wer Anwalt des Monats ist.');
    const res = await api.patch('/api/admin/settings', { lotmMode: mode, lotmMember: member });
    st.settings = res.settings;
    toast('Anwalt des Monats gespeichert.');
    renderView();
  },
});

// Suche im Wiki und im Strafgesetzbuch: nur die Liste neu zeichnen (das Eingabefeld behält den Fokus)
document.addEventListener('input', (e) => {
  if (e.target.id === 'wikiSearch') {
    st.wikiQ = e.target.value;
    $('#wikiList').innerHTML = wikiCards();
  } else if (e.target.id === 'stgbSearch') {
    st.stgbQ = e.target.value;
    $('#stgbList').innerHTML = stgbRows();
  }
});

/* ================================================================
   Textbausteine (Akten-Chat und interne Notizen): „/“ tippen → Auswahl, Enter oder Tab fügt ein. Platzhalter wie in den
   Schriftsätzen ({{mandant}}, {{anwalt}}, {{anwalt_rang}}, {{aktenzeichen}} …) kommen aus der offenen Akte und dem eigenen
   Konto; was fehlt, bleibt als [platzhalter] stehen und fällt so beim Lesen auf.
   ================================================================ */
async function loadSnippets(force = false) {
  if (!isStaff()) return null;
  if (!st.snippets || force) st.snippets = await api.get('/api/snippets');
  return st.snippets;
}

/** Werte der Platzhalter aus der offenen Akte (st.caseInfo) und dem eigenen Konto. */
function snippetValues() {
  const c = st.caseInfo || {};
  const now = new Date();
  const charges = (st.caseCharges && st.caseCharges.charges) || [];
  return {
    mandant: c.clientName && c.clientName !== '—' ? c.clientName : '',
    anwalt: st.user.displayName,
    anwalt_rang: st.user.rank || '',
    anwalt_telefon: st.user.phone || '',
    zustaendig: c.lawyerName || '',
    aktenzeichen: c.caseNumber || '',
    akte: c.title || '',
    rechtsgebiet: AREAS[c.area] || '',
    gerichtsaktenzeichen: c.courtRef || '',
    gegenpartei: c.opponent || '',
    anklagepunkte: charges.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.citation} – ${x.title}${x.attempted ? ' (Versuch)' : ''}${x.aiding ? ' (Beihilfe)' : ''}`).join('\n'),
    kanzlei: 'Pake & Scha Legal Consulting',
    datum: now.toLocaleDateString('de-DE'),
    uhrzeit: now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    ort: 'Los Santos, San Andreas',
  };
}
const fillSnippet = (body, values = snippetValues()) => String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (all, k) => values[k.toLowerCase()] || `[${k.toLowerCase()}]`);

/** „/befehl“ direkt vor dem Cursor (am Zeilenanfang oder nach einem Leerzeichen) – oder null. */
function snippetToken(t) {
  const before = t.value.slice(0, t.selectionStart);
  const m = before.match(/(^|\s)\/([^\s/]{0,32})$/);
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null;
}

const snip = { el: null, input: null, list: [], active: 0, token: null };
function snippetMatches(query) {
  const q = foldText(query);
  const all = (st.snippets && st.snippets.snippets) || [];
  // Befehle, die mit dem Getippten anfangen, zuerst – dann alphabetisch
  return all
    .filter((s) => !q || foldText(s.command).includes(q) || foldText(s.title).includes(q))
    .sort((a, b) => foldText(b.command).startsWith(q) - foldText(a.command).startsWith(q) || a.command.localeCompare(b.command, 'de'))
    .slice(0, 8);
}
function closeSnippetMenu() {
  snip.el?.remove();
  snip.el = null;
  snip.input = null;
}
function renderSnippetMenu() {
  const t = snip.input;
  if (!t || !t.isConnected) return closeSnippetMenu();
  if (!snip.el) {
    snip.el = document.createElement('div');
    snip.el.className = 'snip-menu';
    snip.el.setAttribute('role', 'listbox');
    snip.el.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus bleibt im Eingabefeld
    snip.el.addEventListener('click', (e) => {
      const item = e.target.closest('[data-snip]');
      if (item) insertSnippet(Number(item.dataset.snip));
      else if (e.target.closest('[data-snip-manage]')) {
        closeSnippetMenu();
        guard(() => snippetManager());
      }
    });
    document.body.appendChild(snip.el);
  }
  snip.el.innerHTML = `${
    snip.list.length
      ? snip.list
          .map(
            (s, i) => `<button type="button" class="snip-item ${i === snip.active ? 'active' : ''}" role="option" aria-selected="${i === snip.active}" data-snip="${s.id}">
              <span class="snip-cmd">/${esc(s.command)}</span><span class="snip-title">${esc(s.title)}</span></button>`
          )
          .join('')
      : `<p class="snip-empty">Kein Baustein „/${esc(snip.token.query)}“.</p>`
  }<button type="button" class="snip-manage" data-snip-manage>${icon('edit', 'ico-sm')}<span>Bausteine verwalten</span></button>`;
  // über dem Eingabefeld, so breit wie das Feld (höchstens 420 px)
  const r = t.getBoundingClientRect();
  const w = Math.min(420, Math.max(260, r.width));
  snip.el.style.width = `${w}px`;
  snip.el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  const h = snip.el.offsetHeight;
  snip.el.style.top = `${r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8}px`;
}
async function updateSnippetMenu(t) {
  const tok = snippetToken(t);
  if (!tok) return closeSnippetMenu();
  if (!st.snippets) {
    try {
      await loadSnippets();
    } catch {
      return;
    }
  }
  snip.input = t;
  snip.token = tok;
  snip.list = snippetMatches(tok.query);
  snip.active = Math.min(snip.active, Math.max(0, snip.list.length - 1));
  renderSnippetMenu();
}
function insertSnippet(id) {
  const t = snip.input;
  const s = (st.snippets.snippets || []).find((x) => x.id === id);
  if (!t || !s) return closeSnippetMenu();
  const tok = snippetToken(t) || snip.token;
  const text = fillSnippet(s.body);
  const after = t.value.slice(t.selectionStart);
  t.value = t.value.slice(0, tok.start) + text + after;
  const pos = tok.start + text.length;
  t.setSelectionRange(pos, pos);
  closeSnippetMenu();
  t.dispatchEvent(new Event('input', { bubbles: true })); // Höhe, Entwurf, „schreibt gerade“
  t.focus();
  // Erste fehlende Angabe markieren, damit man sie gleich überschreiben kann
  const gap = t.value.slice(tok.start, pos).search(/\[[a-z_]+\]/);
  if (gap >= 0) {
    const m = t.value.slice(tok.start + gap).match(/^\[[a-z_]+\]/);
    t.setSelectionRange(tok.start + gap, tok.start + gap + m[0].length);
  }
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches && t.matches('textarea[data-snippets]') && isStaff()) updateSnippetMenu(t);
});
// Pfeiltasten, Enter/Tab und Esc gehören der Auswahl, solange sie offen ist (vor „Enter sendet“ im Chat)
window.addEventListener(
  'keydown',
  (e) => {
    if (!snip.el || e.target !== snip.input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = snip.list.length;
      if (n) snip.active = (snip.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderSnippetMenu();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && snip.list.length) {
      e.preventDefault();
      e.stopPropagation();
      insertSnippet(snip.list[snip.active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSnippetMenu();
    }
  },
  true
);
document.addEventListener('focusout', (e) => e.target === snip.input && setTimeout(() => document.activeElement !== snip.input && closeSnippetMenu(), 120));
window.addEventListener('resize', () => snip.el && renderSnippetMenu());
document.addEventListener('scroll', () => snip.el && renderSnippetMenu(), true);

/* ---------------------------------------------------------------- Bausteine verwalten (Fenster und Wiki-Reiter) */
function snippetRows(list) {
  if (!list.length) return empty('Noch keine Textbausteine.', 'chat');
  return list
    .map(
      (s) => `<div class="snip-row">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span class="snip-cmd">/${esc(s.command)}</span><span class="font-medium">${esc(s.title)}</span></div>
          <p class="snip-preview">${esc(s.body.length > 160 ? `${s.body.slice(0, 157)}…` : s.body)}</p>
        </div>
        ${
          s.canEdit
            ? `<div class="flex gap-1 shrink-0"><button type="button" class="icon-btn sm" data-action="snip-edit" data-id="${s.id}" aria-label="Bearbeiten" title="Bearbeiten">${icon('edit', 'ico-sm')}</button><button type="button" class="icon-btn sm" data-action="snip-delete" data-id="${s.id}" data-command="${esc(s.command)}" aria-label="Löschen" title="Löschen">${icon('trash', 'ico-sm')}</button></div>`
            : ''
        }
      </div>`
    )
    .join('');
}
async function snippetManager() {
  const d = await loadSnippets(true);
  openModal(
    `
      <h2 class="modal-title">Textbausteine</h2>
      <p class="modal-sub">Im Akten-Chat und in Notizen <code>/</code> tippen, Baustein wählen – Name, Aktenzeichen &amp; Co. werden automatisch eingesetzt.</p>
      <div class="flex justify-end mb-3"><button type="button" class="btn-gold btn-md" data-action="snip-new">${icon('plus')}<span>Neuer Baustein</span></button></div>
      <div class="snip-list">${snippetRows(d.snippets)}</div>`,
    { wide: true, key: 'snippets', reopen: () => snippetManager() }
  );
}
function snippetEditor(s) {
  const p = st.snippets.placeholders;
  const v = s || { command: '', title: '', body: 'Sehr geehrte/r {{mandant}},\n\n\n\nMit freundlichen Grüßen\n{{anwalt}}' };
  openModal(
    `
      <h2 class="modal-title">${s ? 'Baustein bearbeiten' : 'Neuer Textbaustein'}</h2>
      <p class="modal-sub">Platzhalter antippen, um sie an der Cursorstelle einzufügen. Beim Einfügen im Chat werden sie aus der Akte gefüllt.</p>
      <form data-form="snippet" data-id="${s ? s.id : ''}" class="form-grid cols-2">
        <div><label class="label" for="snCmd">Befehl</label><div class="snip-cmd-field"><span aria-hidden="true">/</span><input id="snCmd" name="command" class="field" required minlength="2" maxlength="32" value="${esc(v.command)}" placeholder="mandatsübernahme" autocomplete="off" spellcheck="false"></div></div>
        <div><label class="label" for="snTitle">Name</label><input id="snTitle" name="title" class="field" required minlength="2" maxlength="80" value="${esc(v.title)}" placeholder="z. B. Mandat übernommen"></div>
        <div class="span-2"><label class="label" for="snBody">Text</label><textarea id="snBody" name="body" rows="9" class="field" required maxlength="3000">${esc(v.body)}</textarea>
          <div class="snip-chips" role="group" aria-label="Platzhalter einfügen">${Object.entries(p)
            .map(([k, label]) => `<button type="button" class="snip-chip" data-action="snip-ph" data-ph="${k}" title="${esc(label)}">{{${k}}}</button>`)
            .join('')}</div></div>
        <div class="span-2"><span class="label">Vorschau${st.caseInfo ? ` (Akte ${esc(st.caseInfo.caseNumber)})` : ''}</span><div id="snPreview" class="snip-preview-box">${esc(fillSnippet(v.body))}</div></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`,
    { wide: true }
  );
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'snBody' && $('#snPreview')) $('#snPreview').textContent = fillSnippet(e.target.value);
});

Object.assign(actions, {
  'snip-manage': () => snippetManager(),
  'snip-new': async () => {
    await loadSnippets();
    snippetEditor(null);
  },
  'snip-edit': async (el) => {
    const d = await loadSnippets();
    const s = d.snippets.find((x) => x.id === Number(el.dataset.id));
    if (s) snippetEditor(s);
  },
  'snip-delete': async (el) => {
    if (!(await askDelete('Textbaustein löschen?', `/${el.dataset.command} steht danach niemandem mehr zur Verfügung.`))) return;
    await api.del('/api/snippets/' + el.dataset.id);
    await loadSnippets(true);
    toast('Textbaustein gelöscht.');
    if (st.modalCurrent && st.modalCurrent.key === 'snippets') await snippetManager();
    else if (st.view === 'wiki') renderView();
  },
  'snip-ph': (el) => {
    const t = $('#snBody');
    const ins = `{{${el.dataset.ph}}}`;
    const a = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, a) + ins + t.value.slice(t.selectionEnd ?? a);
    t.focus();
    t.setSelectionRange(a + ins.length, a + ins.length);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  },
});
Object.assign(forms, {
  snippet: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = { command: val(fd, 'command'), title: val(fd, 'title'), body: val(fd, 'body') };
    if (id) await api.patch('/api/snippets/' + id, body);
    else await api.post('/api/snippets', body);
    await loadSnippets(true);
    toast(`Baustein /${body.command.replace(/^\/+/, '').toLowerCase()} gespeichert.`);
    await modalBack();
    if (st.view === 'wiki') renderView();
  },
});
