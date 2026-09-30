/*
 * Darstellung von Vertragsvorlagen (Mandatsvertrag u. a.) – genutzt von vertrag.html und der Vorschau.
 *
 * Formatierung der Vorlage, je Zeile:
 *   # Titel            großer Dokumenttitel          ## Abschnitt   goldene Abschnittsüberschrift
 *   ### § 1 …          fette Paragraphenüberschrift  1. Text       nummerierter Absatz
 *   | Text             zentrierte Zeile (Parteien)   (4 Leerzeichen) eingerückte Zeile
 *   ===                neue Seite                    [Unterschriften] Unterschriftsfeld
 *   [Weitere Anwälte]  weitere unterzeichnende Anwälte (Parteien; leer, wenn es keine gibt)
 *   **fett**, *kursiv*, {{platzhalter}}
 * Alles wird escaped; Werte der Platzhalter ebenfalls.
 */
(() => {
  'use strict';
  const { esc } = window.PS;

  function inline(raw, values) {
    let s = esc(raw)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    // Platzhalter zuletzt ersetzen, damit Sternchen in Werten keine Formatierung auslösen.
    s = s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
      const k = key.toLowerCase();
      if (!(k in values)) return `<span class="k-unknown">${esc(m)}</span>`;
      const v = String(values[k] ?? '').trim();
      // Mehrzeilige Werte (z. B. mehrere Leistungen) zeilenweise darstellen
      return v ? `<span class="k-val">${esc(v).replace(/\n/g, '<br>')}</span>` : '<span class="k-blank"></span>';
    });
    return s;
  }

  const coLawyers = (sig) => (sig && Array.isArray(sig.coLawyers) ? sig.coLawyers : []);
  const CO_DIRECTIVE = /^\[weitere anw(?:ä|ae)lte\]$/i;

  /** Weitere Anwälte im Parteienblock – im selben Stil wie der erste (Name, Rang, Geburtsdatum). */
  function coParties(sig) {
    return coLawyers(sig)
      .map(
        (l) => `<div class="k-cogap"></div>
        <p class="k-center"><strong>${esc(l.name)}</strong></p>
        <p class="k-center"><strong>${l.rank ? esc(l.rank) + ', ' : ''}Pake &amp; Scha</strong></p>
        <p class="k-center">geb. am ${l.birth ? `<span class="k-val">${esc(l.birth)}</span>` : '<span class="k-blank"></span>'}</p>`
      )
      .join('');
  }

  function signatures(values, sig) {
    const clientSigned = sig && sig.clientSignature;
    const when = (v) => {
      const d = window.PS.parseDate(v);
      return d ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    };
    const clientNote = clientSigned
      ? sig.clientSignedVia === 'kanzlei'
        ? `im Spiel unterschrieben · erfasst am ${esc(when(sig.clientSignedAt))}${sig.clientRecordedByName ? ' von ' + esc(sig.clientRecordedByName) : ''}`
        : `digital unterschrieben am ${esc(when(sig.clientSignedAt))}`
      : '';
    const v = (k) => String(values[k] ?? '').trim();
    // Alle Anwälte links untereinander (der erste oben), der Mandant rechts
    const lawyers = [
      { name: v('anwalt'), rank: v('anwalt_rang'), signature: sig && sig.lawyerSignature, signedAt: sig && sig.lawyerSignedAt },
      ...coLawyers(sig),
    ];
    const lawyerBlock = (l) => `<div class="k-sign">
          <div class="k-script lawyer">${l.signature ? esc(l.signature) : ''}</div>
          <div class="k-line"></div>
          <div class="k-sname">${l.name ? esc(l.name) : 'Anwalt'}</div>
          <div class="k-srole">${l.rank ? esc(l.rank) + ', ' : ''}Pake &amp; Scha Legal Consulting</div>
          <div class="k-snote">${l.signature ? `digital unterschrieben am ${esc(when(l.signedAt))}` : 'Unterschrift Anwalt'}</div>
        </div>`;
    return `<div class="k-signs-wrap">
      <p class="k-signplace">Unterzeichnet in ${v('ort') ? esc(v('ort')) : '<span class="k-blank"></span>'} am <strong>${v('datum') ? esc(v('datum')) : '<span class="k-blank"></span>'}</strong></p>
      <div class="k-signs">
        <div class="k-col">${lawyers.map(lawyerBlock).join('')}</div>
        <div class="k-col"><div class="k-sign">
          <div class="k-script client">${clientSigned ? esc(sig.clientSignature) : ''}</div>
          <div class="k-line"></div>
          <div class="k-sname">${v('mandant') ? esc(v('mandant')) : 'Mandant'}</div>
          <div class="k-srole">Mandant</div>
          <div class="k-snote">${clientNote || 'Unterschrift Mandant'}</div>
        </div></div>
      </div></div>`;
  }

  /** Liefert die Seiten als HTML-Strings. */
  function render(body, values, sig) {
    const pages = [[]];
    let signed = false;
    const push = (html) => pages[pages.length - 1].push(html);
    const lines = String(body || '').replace(/\r/g, '').split('\n');
    // Ältere Verträge ohne [Weitere Anwälte]: weitere Anwälte hinter dem Geburtsdatum des ersten einfügen
    let coAfter = -1;
    if (coLawyers(sig).length && !lines.some((l) => CO_DIRECTIVE.test(l.trim()))) {
      coAfter = lines.findIndex((l) => /^\|/.test(l.trim()) && /\{\{\s*anwalt_geburtsdatum\s*\}\}/i.test(l));
    }
    lines.forEach((raw, i) => {
      const line = raw.replace(/\s+$/, '');
      const t = line.trim();
      let m;
      if (t === '===') pages.push([]);
      else if (/^\[unterschriften\]$/i.test(t)) {
        push(signatures(values, sig));
        signed = true;
      } else if (CO_DIRECTIVE.test(t)) push(coParties(sig));
      else if (!t) push('<div class="k-space"></div>');
      else if ((m = line.match(/^#\s+(.*)$/))) push(`<h1 class="k-title">${inline(m[1], values)}</h1>`);
      else if ((m = line.match(/^##\s+(.*)$/))) push(`<h2 class="k-section">${inline(m[1], values)}</h2>`);
      else if ((m = line.match(/^###\s+(.*)$/))) push(`<h3 class="k-para">${inline(m[1], values)}</h3>`);
      else if ((m = line.match(/^\|\s?(.*)$/))) {
        const c = m[1].trim();
        // „-zwischen-“ / „- und -“ wie im Original größer und grau
        push(!c ? '<div class="k-gap"></div>' : `<p class="k-center${/^-\s*[a-zäöü]+\s*-$/i.test(c) ? ' k-between' : ''}">${inline(c, values)}</p>`);
      }
      else if ((m = line.match(/^(\d{1,3})\.\s+(.*)$/))) push(`<div class="k-item"><span class="k-num">${m[1]}.</span><div>${inline(m[2], values)}</div></div>`);
      else if ((m = line.match(/^(?: {2,}|\t)\s*(.*)$/))) push(`<div class="k-indent">${inline(m[1], values)}</div>`);
      else push(`<p class="k-p">${inline(line, values)}</p>`);
      if (i === coAfter) push(coParties(sig));
    });
    if (!signed) push(signatures(values, sig));
    return pages.filter((p) => p.some((h) => !h.startsWith('<div class="k-space"'))).map((p) => p.join(''));
  }

  /** Kopfzeile jeder Seite (wie im Original: Kanzlei links, Anschrift rechts). */
  function header(lines) {
    return `<div class="k-head"><div class="k-firm">PAKE &amp; SCHA<br>LEGAL CONSULTING</div><div class="k-addr">${esc(lines || '').replace(/\n/g, '<br>')}</div></div>`;
  }

  window.PS.contract = { render, header };
})();
