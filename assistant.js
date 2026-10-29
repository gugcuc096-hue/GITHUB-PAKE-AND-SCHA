'use strict';
/*
 * Eingebauter, regelbasierter Assistent für das Discord-Ticket (ticketAssistant.js) – ohne KI-Dienst, ohne Fremdanbindung, ohne Kosten.
 * (Der Co-Pilot in der Akte ist entfernt; die Auswertung für die Kanzlei-Sicht ist hier noch vorhanden, wird aber nicht mehr aufgerufen.)
 * Er liest nur, was die Akte ohnehin enthält (dieselbe Antwort wie für die Aktenansicht, also mit denselben Rechten) und
 *  - fasst den Stand zusammen,
 *  - findet Lücken und Risiken (Fristen, überfällige Aufgaben, Zeugen ohne Aussage, Beweise ohne Lager, unbeantwortete
 *    Nachrichten, überfällige Rechnungen …) – jeweils mit Verweis auf die Stelle in der Akte,
 *  - beantwortet Fragen per Stichwort („Wann ist die nächste Frist?“, „Was sagt B7?“, „Welche Zeugen sind offen?“),
 *  - entwirft Texte aus den Aktendaten (Einleitung, Statusnachricht, Übergabe, Vorhalt, Beweisverzeichnis, Verhandlung).
 * Er erfindet nichts: Wo die Akte keine Angabe hat, sagt er das. Er schreibt nie von selbst in die Akte.
 * audience 'client' (Discord-Ticket-Assistent): nur freigegebene Angaben – Stand, freigegebene Termine, angeforderte
 * Unterlagen, Rechnungen, zuständiger Anwalt.
 */
const DAY = 864e5;

/* ---------------------------------------------------------------- Hilfen */
const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
const TZ = 'Europe/Berlin';
const fmtDay = (iso) => new Date(iso).toLocaleDateString('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso) => `${fmtDay(iso)}, ${fmtTime(iso)} Uhr`;
const money = (n) => `${Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Tage bis zu einem Zeitpunkt (ganze Kalendertage in Berlin; 0 = heute, negativ = vorbei). */
function daysUntil(iso, now) {
  const day = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
  return Math.round((Date.parse(`${day(iso)}T00:00:00Z`) - Date.parse(`${day(now)}T00:00:00Z`)) / DAY);
}
const when = (n) => (n === 0 ? 'heute' : n === 1 ? 'morgen' : n === -1 ? 'gestern' : n > 0 ? `in ${n} Tagen` : `seit ${-n} Tagen`);
const SIDE = { belastend: 'belastend', entlastend: 'entlastend', neutral: 'neutral' };

/* ---------------------------------------------------------------- Fakten */
/** Alles Nötige aus der Aktenantwort (caseDetail) in handliche Listen. */
function facts(d, now = new Date(), audience = 'staff') {
  const c = d.case || {};
  const client = audience === 'client';
  const nowIso = new Date(now).toISOString();
  const active = (d.appointments || []).filter((a) => !['abgesagt', 'erledigt'].includes(a.status) && (!client || a.clientVisible));
  const upcoming = active.filter((a) => Date.parse(a.endsAt || a.startsAt) >= Date.parse(nowIso) - 2 * 3600e3).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = active.filter((a) => !upcoming.includes(a)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const tasks = client ? [] : (d.tasks || []).filter((t) => !t.done);
  const parties = client ? [] : d.parties || [];
  const witnesses = parties.filter((p) => p.role === 'zeuge');
  const evidence = client ? [] : d.attachments || [];
  const invoices = (d.invoices || []).filter((i) => i.status !== 'storniert');
  const openInvoices = invoices.filter((i) => i.status === 'offen');
  const messages = (d.chat && d.chat.messages) || [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  const charges = !client && d.charges ? d.charges : null;
  return {
    c,
    now: new Date(now),
    upcoming,
    deadlines: upcoming.filter((a) => a.type === 'frist'),
    hearings: upcoming.filter((a) => a.type === 'gericht'),
    past,
    tasks,
    parties,
    witnesses,
    evidence,
    invoices,
    openInvoices,
    openRequests: (d.requests || []).filter((r) => !r.doneAt),
    messages,
    lastMessage,
    charges,
    similar: client ? [] : d.similar || [],
    contracts: d.contracts || [],
    lawyers: [c.lawyerName, ...(c.coLawyers || []).map((l) => l.name)].filter(Boolean),
    overlaps: client ? null : d.overlaps || null,
  };
}

const eventLine = (a, now) => {
  const n = daysUntil(a.startsAt, now);
  const name = fold(a.title).includes(fold(a.typeLabel)) ? a.title : `${a.typeLabel}: ${a.title}`;
  return `${name} – ${fmtDateTime(a.startsAt)} (${when(n)})${a.location ? `, ${a.location}` : ''}`;
};

/* ---------------------------------------------------------------- Lücken und Risiken */
const LEVEL = { rot: 0, gelb: 1, info: 2 };

function gaps(d, now = new Date()) {
  const f = facts(d, now, 'staff');
  const c = f.c;
  const out = [];
  const add = (level, text, ref) => out.push({ level, text, ref: ref || null });

  if (!c.closed) {
    if (!c.lawyerId) add('rot', 'Der Akte ist noch kein zuständiger Anwalt zugeordnet.', { type: 'case', id: c.id });
    // Fristen und Termine
    for (const a of f.upcoming) {
      const n = daysUntil(a.startsAt, now);
      if (a.type === 'frist' && n <= 3) add(n <= 1 ? 'rot' : 'gelb', `Frist „${a.title}“ ${when(n)} (${fmtDay(a.startsAt)}).`, { type: 'event', id: a.id });
      else if (a.type === 'gericht' && n <= 3) add(n <= 1 ? 'rot' : 'gelb', `Gerichtstermin „${a.title}“ ${when(n)} (${fmtDateTime(a.startsAt)}).`, { type: 'event', id: a.id });
    }
    const overdueEvents = f.past.filter((a) => a.type === 'frist' && a.status !== 'erledigt' && daysUntil(a.startsAt, now) < 0 && daysUntil(a.startsAt, now) > -30);
    for (const a of overdueEvents) add('rot', `Frist „${a.title}“ ist seit ${-daysUntil(a.startsAt, now)} Tagen verstrichen und nicht als erledigt markiert.`, { type: 'event', id: a.id });
    // Aufgaben
    for (const t of f.tasks) {
      if (!t.dueDate) continue;
      const n = daysUntil(`${t.dueDate}T12:00:00Z`, now);
      if (n < 0) add('rot', `Aufgabe „${t.title}“ ist überfällig (${when(n)}).`, { type: 'task', id: t.id });
      else if (n <= 2) add('gelb', `Aufgabe „${t.title}“ ist ${when(n)} fällig.`, { type: 'task', id: t.id });
    }
    // Zeugen
    for (const w of f.witnesses) {
      const done = ['ausgesagt', 'nicht_erreichbar'].includes(w.status);
      if (w.summonAt) {
        const n = daysUntil(w.summonAt, now);
        if (n >= 0 && n <= 7 && !['geladen', 'ausgesagt'].includes(w.status)) add('gelb', `Zeuge ${w.name}: Ladung ${when(n)}, Stand aber „${w.statusLabel}“.`, { type: 'witness', id: w.id });
        if (n < 0 && !done && !w.statement) add('rot', `Zeuge ${w.name}: Ladung war ${when(n).replace('seit', 'vor')}, aber keine Aussage erfasst.`, { type: 'witness', id: w.id });
      } else if (w.status === 'geladen') add('gelb', `Zeuge ${w.name} gilt als geladen, aber es ist kein Ladungstermin eingetragen.`, { type: 'witness', id: w.id });
      if (!w.side && !done) add('info', `Zeuge ${w.name}: Lager (belastend / entlastend) noch offen.`, { type: 'witness', id: w.id });
      if ((w.overlaps || []).length) add('rot', `Möglicher Interessenkonflikt: ${w.name} ist in ${w.overlaps.map((o) => o.caseNumber).join(', ')} Mandant.`, { type: 'witness', id: w.id });
    }
    // Beweise
    const disputed = f.evidence.filter((e) => e.status === 'bestritten');
    for (const e of disputed) add('gelb', `Beweismittel B${e.no} („${e.caption || 'ohne Bezeichnung'}“) ist bestritten.`, { type: 'evidence', id: e.id, no: e.no });
    const unnamed = f.evidence.filter((e) => !String(e.caption || '').trim());
    if (unnamed.length) add('info', `${plural(unnamed.length, 'Beweismittel hat', 'Beweismittel haben')} keine Bezeichnung (${unnamed.slice(0, 5).map((e) => `B${e.no}`).join(', ')}).`, { type: 'evidence', id: unnamed[0].id, no: unnamed[0].no });
    const unsided = f.evidence.filter((e) => !e.side);
    if (unsided.length) add('info', `${plural(unsided.length, 'Beweismittel hat', 'Beweismittel haben')} noch kein Lager (belastend / entlastend).`, { type: 'evidence', id: unsided[0].id, no: unsided[0].no });
    // Anklage
    const nCharges = f.charges ? (f.charges.charges || []).length : 0;
    if (c.area === 'strafrecht' && !nCharges && c.step >= 1) add('gelb', 'Keine Anklagepunkte erfasst, obwohl die Akte schon über den Eingang hinaus ist.', { type: 'case', id: c.id });
    if (nCharges && !f.evidence.length) add('gelb', 'Es gibt Anklagepunkte, aber noch keine Beweismittel in der Akte.', { type: 'case', id: c.id });
    if (nCharges && f.charges.estimate && f.charges.estimate.he == null) add('info', 'Zu den Anklagepunkten fehlt die Einschätzung des Strafmaßes.', { type: 'case', id: c.id });
    // Mandant und Post
    if (f.lastMessage && !f.lastMessage.fromFirm) {
      const hours = (Date.parse(new Date(now).toISOString()) - Date.parse(String(f.lastMessage.createdAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(f.lastMessage.createdAt) ? '' : 'Z'))) / 36e5;
      if (hours >= 72) add('rot', `Die letzte Nachricht des Mandanten ist seit ${Math.floor(hours / 24)} Tagen unbeantwortet.`, { type: 'chat', id: f.lastMessage.id });
      else if (hours >= 24) add('gelb', 'Die letzte Nachricht des Mandanten ist seit über einem Tag unbeantwortet.', { type: 'chat', id: f.lastMessage.id });
    }
    for (const r of f.openRequests) {
      const days = Math.floor((Date.parse(new Date(now).toISOString()) - Date.parse(String(r.createdAt).replace(' ', 'T') + 'Z')) / DAY);
      if (days >= 3) add('gelb', `Angeforderte Unterlage „${r.title}“ ist seit ${days} Tagen offen.`, { type: 'case', id: c.id });
    }
    if (c.idleDays >= 7) add(c.idleDays >= 14 ? 'rot' : 'gelb', `Die Akte liegt seit ${c.idleDays} Tagen ohne Aktivität.`, { type: 'case', id: c.id });
    if (c.hasClientAccount && !String(c.publicNote || '').trim()) add('info', 'Es gibt noch keinen Statushinweis für den Mandanten.', { type: 'case', id: c.id });
  }
  // Rechnungen
  for (const i of f.openInvoices) if (i.overdueDays > 0) add(i.overdueDays >= 14 ? 'rot' : 'gelb', `Rechnung ${i.number} (${money(i.total)}) ist seit ${i.overdueDays} Tagen überfällig.`, { type: 'invoice', id: i.id });
  if (c.closed && !f.invoices.length) add('info', 'Die Akte ist abgeschlossen, aber es gibt keine Rechnung dazu.', { type: 'case', id: c.id });
  if (f.similar.length) add('info', `${plural(f.similar.length, 'ähnlicher Präzedenzfall', 'ähnliche Präzedenzfälle')} in der Kanzlei – Argumente und Ergebnis nachlesen.`, { type: 'precedent', id: f.similar[0].id });
  return out.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

/* ---------------------------------------------------------------- Zusammenfassung */
function summary(d, now = new Date(), audience = 'staff') {
  const f = facts(d, now, audience);
  const c = f.c;
  const client = audience === 'client';
  const sections = [];
  const head = [`${c.caseNumber} · ${c.title} (${c.areaLabel}).`];
  if (!client) head.push(`Mandant: ${c.clientName}${c.opponent ? `, Gegenpartei: ${c.opponent}` : ''}.`);
  head.push(`Stand: ${c.stepLabel} (${c.statusLabel}).`);
  head.push(f.lawyers.length ? `Zuständig: ${f.lawyers.join(', ')}.` : 'Noch kein zuständiger Anwalt.');
  if (!client && c.idleDays > 0) head.push(`Seit ${c.idleDays} Tagen ohne Aktivität.`);
  sections.push({ title: 'Stand', lines: [{ text: head.join(' ') }] });
  if (client && c.publicNote) sections.push({ title: 'Hinweis Ihrer Kanzlei', lines: [{ text: c.publicNote }] });

  sections.push({
    title: 'Nächste Termine und Fristen',
    lines: f.upcoming.length ? f.upcoming.slice(0, 4).map((a) => ({ text: eventLine(a, now), ref: { type: 'event', id: a.id } })) : [{ text: 'Es sind keine kommenden Termine oder Fristen eingetragen.' }],
  });
  if (!client) {
    sections.push({
      title: 'Aufgaben',
      lines: f.tasks.length
        ? [{ text: `${plural(f.tasks.length, 'offene Aufgabe', 'offene Aufgaben')}.` }, ...f.tasks.filter((t) => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3).map((t) => ({ text: `${t.title} – fällig ${fmtDay(`${t.dueDate}T12:00:00Z`)}`, ref: { type: 'task', id: t.id } }))]
        : [{ text: 'Keine offenen Aufgaben.' }],
    });
    if (f.charges && (f.charges.charges || []).length) {
      const s = f.charges.sentence || {};
      const e = f.charges.estimate || {};
      sections.push({
        title: 'Anklage und Strafmaß',
        lines: [
          { text: f.charges.charges.map((x) => `${x.citation || x.para || ''} ${x.title}${x.count > 1 ? ` (${x.count}×)` : ''}`.trim()).join('; ') },
          { text: `Rahmen laut Strafmaß-Rechner: ${s.minHe ?? 0}–${s.maxHe ?? '?'} HE${s.fineMax ? `, Geldstrafe bis ${money(s.fineMax)}` : ''}${e.he != null ? `. Eingeschätzt: ${e.he} HE${e.fine ? ` / ${money(e.fine)}` : ''}` : ''}.` },
        ],
      });
    }
    if (f.witnesses.length) {
      const by = (k) => f.witnesses.filter((w) => w.side === k).length;
      const next = f.witnesses.filter((w) => w.summonAt && daysUntil(w.summonAt, now) >= 0).sort((a, b) => Date.parse(a.summonAt) - Date.parse(b.summonAt))[0];
      sections.push({
        title: 'Zeugen',
        lines: [
          { text: `${plural(f.witnesses.length, 'Zeuge', 'Zeugen')} (${by('belastend')} belastend, ${by('entlastend')} entlastend, ${f.witnesses.length - by('belastend') - by('entlastend')} offen/neutral); ausgesagt: ${f.witnesses.filter((w) => w.status === 'ausgesagt').length}.` },
          ...(next ? [{ text: `Nächste Ladung: ${next.name} – ${fmtDateTime(next.summonAt)}`, ref: { type: 'witness', id: next.id } }] : []),
        ],
      });
    }
    if (f.evidence.length) {
      const by = (k) => f.evidence.filter((e) => e.side === k).length;
      sections.push({ title: 'Beweismittel', lines: [{ text: `${plural(f.evidence.length, 'Beweismittel', 'Beweismittel')} (B${Math.min(...f.evidence.map((e) => e.no))}–B${Math.max(...f.evidence.map((e) => e.no))}): ${by('belastend')} belastend, ${by('entlastend')} entlastend; bestritten: ${f.evidence.filter((e) => e.status === 'bestritten').length}.` }] });
    }
  } else if (f.openRequests.length) {
    sections.push({ title: 'Was von Ihnen noch fehlt', lines: f.openRequests.map((r) => ({ text: r.title })) });
  }
  if (f.invoices.length) {
    const open = f.openInvoices.reduce((s, i) => s + (i.total || 0), 0);
    sections.push({ title: 'Rechnungen', lines: [{ text: f.openInvoices.length ? `${plural(f.openInvoices.length, 'offene Rechnung', 'offene Rechnungen')} über zusammen ${money(open)}.` : 'Alle Rechnungen sind bezahlt.' }] });
  }
  if (!client && f.lastMessage) {
    sections.push({ title: 'Kommunikation', lines: [{ text: `Letzte Nachricht ${f.lastMessage.fromFirm ? 'der Kanzlei' : 'des Mandanten'} am ${fmtDateTime(String(f.lastMessage.createdAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(f.lastMessage.createdAt) ? '' : 'Z'))}.` }] });
  }
  return sections;
}

/* ---------------------------------------------------------------- Fragen */
const INTENTS = [
  { id: 'stand', label: 'Wie ist der Stand?', words: ['stand', 'status', 'zusammenfass', 'ueberblick', 'uebersicht', 'wie laeuft'], weak: ['worum', 'kurz'] },
  { id: 'termine', label: 'Wann ist der nächste Termin?', words: ['termin', 'frist', 'verhandlung', 'ladung'], weak: ['wann', 'gericht', 'kalender', 'datum'] },
  { id: 'aufgaben', label: 'Was ist noch offen?', words: ['aufgabe', 'todo', 'erledigen', 'ausstehend', 'fehlt noch', 'unterlage'], weak: ['offen', 'zu tun'] },
  { id: 'zeugen', label: 'Wie stehen die Zeugen?', words: ['zeug', 'aussage', 'befragung', 'ladung', 'geladen'] },
  { id: 'beweise', label: 'Welche Beweismittel gibt es?', words: ['beweis', 'bild', 'foto', 'screenshot', 'bodycam', 'anlage'] },
  { id: 'anklage', label: 'Was wird vorgeworfen, welches Strafmaß droht?', words: ['anklage', 'strafma', 'vorwurf', 'paragraph', 'haft', 'geldstrafe', 'deal', 'angebot', 'strafe'] },
  { id: 'geld', label: 'Wie sieht es mit Rechnungen aus?', words: ['rechnung', 'kosten', 'honorar', 'bezahl', 'zahlung', 'betrag'], weak: ['geld', 'preis'] },
  { id: 'mandant', label: 'Was gibt es Neues vom Mandanten?', words: ['mandant', 'nachricht', 'chat', 'geschrieben'], weak: ['antwort', 'kontakt', 'erreich'] },
  { id: 'risiken', label: 'Wo gibt es Lücken oder Risiken?', words: ['risik', 'luecke', 'problem', 'warn', 'achtung', 'widerspruch', 'vorhalt', 'unstimmig', 'fehler', 'uebersehen', 'dringend'] },
  { id: 'naechste', label: 'Was sollte ich als Nächstes tun?', words: ['naechst', 'empfehl', 'schritt', 'prioritaet', 'anfangen'], weak: ['soll'] },
  { id: 'aehnlich', label: 'Gibt es ähnliche Fälle?', words: ['aehnlich', 'praezedenz', 'urteil', 'vergleichbar', 'frueher'] },
  { id: 'zustaendig', label: 'Wer ist zuständig?', words: ['zustaendig', 'anwalt', 'verantwortlich', 'ansprech', 'bearbeitet'] },
];
const CLIENT_INTENTS = ['stand', 'termine', 'aufgaben', 'geld', 'zustaendig', 'naechste'];

function pickIntent(question, audience = 'staff') {
  const q = ` ${fold(question)} `;
  let best = null;
  for (const it of INTENTS) {
    if (audience === 'client' && !CLIENT_INTENTS.includes(it.id)) continue;
    const score = it.words.filter((w) => q.includes(w)).length * 2 + (it.weak || []).filter((w) => q.includes(w)).length;
    if (score && (!best || score > best.score)) best = { it, score };
  }
  // Mandanten bekommen nur bei einem klaren Stichwort eine Antwort („Chancen vor Gericht“ ist keine Terminfrage)
  return best && (audience !== 'client' || best.score >= 2) ? best.it : null;
}

const lines = (...xs) => xs.flat().filter(Boolean).map((x) => (typeof x === 'string' ? { text: x } : x));

/** Antwort auf eine Frage – oder, wenn die Akte dazu nichts hergibt, ein ehrliches „weiß ich nicht“. */
function answer(d, question, { now = new Date(), audience = 'staff' } = {}) {
  const f = facts(d, now, audience);
  const c = f.c;
  const client = audience === 'client';
  const q = String(question || '').trim();
  // „Was zeigt B7?“ – Beweismittel direkt ansprechen
  const m = !client && /\bB\s?(\d{1,3})\b/i.exec(q);
  if (m) {
    const e = f.evidence.find((x) => x.no === Number(m[1]));
    if (!e) return { intent: 'beweise', title: `B${m[1]}`, lines: lines(`Ein Beweismittel B${m[1]} gibt es in dieser Akte nicht.`, f.evidence.length ? `Vorhanden: ${f.evidence.map((x) => `B${x.no}`).join(', ')}.` : 'Es sind noch keine Beweismittel erfasst.'), followups: ['beweise'] };
    return {
      intent: 'beweise',
      title: `B${e.no} – ${e.caption || 'ohne Bezeichnung'}`,
      lines: lines(
        { text: [e.kindLabel, e.obtainedAt ? `erhoben ${fmtDateTime(e.obtainedAt)}` : '', e.source ? `Herkunft: ${e.source}` : ''].filter(Boolean).join(' · ') || 'Keine weiteren Angaben.', ref: { type: 'evidence', id: e.id, no: e.no } },
        { text: `Lager: ${e.side ? SIDE[e.side] : 'noch offen'} · Stand: ${e.statusLabel || 'Gesichert'}` },
        e.description ? { text: e.description } : 'Es gibt noch keine Beschreibung dazu.'
      ),
      followups: ['beweise', 'risiken'],
    };
  }
  const it = pickIntent(q, audience);
  if (!it) {
    return {
      intent: null,
      title: 'Dazu habe ich nichts in der Akte',
      lines: lines(client ? 'Das kann ich nicht beantworten – ich gebe Ihre Frage an Ihren Anwalt weiter.' : 'Dazu finde ich in der Akte keine Angaben. Ich beantworte Fragen zu Stand, Terminen, Aufgaben, Zeugen, Beweisen, Anklage, Rechnungen, Mandant und Risiken.'),
      followups: client ? ['stand', 'termine'] : ['stand', 'termine', 'risiken'],
      unknown: true,
    };
  }
  const out = { intent: it.id, title: it.label, followups: [] };
  switch (it.id) {
    case 'stand':
      out.lines = summary(d, now, audience).flatMap((s) => [{ text: `${s.title}`, heading: true }, ...s.lines]);
      out.followups = client ? ['termine', 'geld'] : ['risiken', 'naechste'];
      break;
    case 'termine':
      out.lines = f.upcoming.length ? lines(f.upcoming.slice(0, 6).map((a) => ({ text: eventLine(a, now), ref: { type: 'event', id: a.id } }))) : lines('Es sind keine kommenden Termine oder Fristen eingetragen.');
      if (!client && f.past[0] && !f.upcoming.length) out.lines.push({ text: `Zuletzt war: ${f.past[0].typeLabel} „${f.past[0].title}“ am ${fmtDay(f.past[0].startsAt)}.` });
      out.followups = ['aufgaben'];
      break;
    case 'aufgaben':
      if (client) {
        out.lines = f.openRequests.length ? lines('Von Ihnen werden noch folgende Unterlagen erwartet:', f.openRequests.map((r) => `• ${r.title}`)) : lines('Aktuell fehlt von Ihrer Seite nichts.');
      } else {
        const sorted = [...f.tasks].sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
        out.lines = sorted.length ? lines(sorted.slice(0, 8).map((t) => ({ text: `${t.title}${t.dueDate ? ` – fällig ${fmtDay(`${t.dueDate}T12:00:00Z`)} (${when(daysUntil(`${t.dueDate}T12:00:00Z`, now))})` : ' – ohne Datum'}${t.assignedName ? ` · ${t.assignedName}` : ''}`, ref: { type: 'task', id: t.id } }))) : lines('Es gibt keine offenen Aufgaben.');
        if (f.openRequests.length) out.lines.push({ text: `Außerdem fehlen vom Mandanten noch ${plural(f.openRequests.length, 'Unterlage', 'Unterlagen')}: ${f.openRequests.map((r) => r.title).join(', ')}.` });
      }
      out.followups = ['termine', 'risiken'];
      break;
    case 'zeugen': {
      if (!f.witnesses.length) {
        out.lines = lines('Es sind noch keine Zeugen erfasst.');
        break;
      }
      out.lines = lines(f.witnesses.map((w) => ({
        text: `${w.name} – ${w.statusLabel}${w.side ? `, ${SIDE[w.side]}` : ''}${w.summonAt ? `, Ladung ${fmtDateTime(w.summonAt)}` : ''}${(w.contradictions || []).length ? `, ${plural(w.contradictions.length, 'Vorhalt', 'Vorhalte')}` : ''}${w.statement ? ' · Aussage liegt vor' : w.expected ? ' · Aussage erwartet' : ''}`,
        ref: { type: 'witness', id: w.id },
      })));
      out.followups = ['risiken', 'beweise'];
      break;
    }
    case 'beweise':
      out.lines = f.evidence.length
        ? lines(f.evidence.slice(0, 12).map((e) => ({ text: `B${e.no} – ${e.caption || 'ohne Bezeichnung'}${e.kindLabel ? ` (${e.kindLabel})` : ''}${e.side ? ` · ${SIDE[e.side]}` : ''}${e.status && e.status !== 'gesichert' ? ` · ${e.statusLabel}` : ''}`, ref: { type: 'evidence', id: e.id, no: e.no } })))
        : lines('Es sind noch keine Beweismittel in der Akte.');
      out.followups = ['zeugen', 'risiken'];
      break;
    case 'anklage': {
      const ch = f.charges && f.charges.charges ? f.charges.charges : [];
      if (!ch.length) {
        out.lines = lines('Es sind noch keine Anklagepunkte erfasst.');
        break;
      }
      const s = f.charges.sentence || {};
      const e = f.charges.estimate || {};
      out.lines = lines(
        ch.map((x) => `${x.citation || x.para || ''} ${x.title}${x.count > 1 ? ` (${x.count}×)` : ''}`.trim()),
        `Rahmen laut Strafmaß-Rechner: ${s.minHe ?? 0}–${s.maxHe ?? '?'} HE${s.capped ? ' (Gesamtstrafe gedeckelt)' : ''}${s.fineMax ? `, Geldstrafe bis ${money(s.fineMax)}` : ''}.`,
        e.he != null ? `Eure Einschätzung: ${e.he} HE${e.fine ? ` / ${money(e.fine)}` : ''}.` : 'Eine Einschätzung des Strafmaßes ist noch nicht eingetragen.',
        (d.deals || []).length ? `Angebote der Staatsanwaltschaft: ${d.deals.length}.` : ''
      );
      out.followups = ['aehnlich', 'beweise'];
      break;
    }
    case 'geld':
      if (!f.invoices.length) out.lines = lines(client ? 'Zu Ihrer Akte gibt es noch keine Rechnung.' : 'Zu dieser Akte gibt es noch keine Rechnung.');
      else
        out.lines = lines(
          f.invoices.slice(0, 6).map((i) => ({ text: `${i.number} – ${money(i.total)} – ${i.status === 'offen' ? (i.overdueDays > 0 ? `offen, seit ${i.overdueDays} Tagen überfällig` : 'offen') : 'bezahlt'}`, ref: client ? undefined : { type: 'invoice', id: i.id } })),
          f.openInvoices.length ? `Offen insgesamt: ${money(f.openInvoices.reduce((s, i) => s + (i.total || 0), 0))}.` : 'Alles bezahlt.'
        );
      out.followups = client ? ['stand'] : ['risiken'];
      break;
    case 'mandant':
      out.lines = f.lastMessage
        ? lines(
            `Letzte Nachricht ${f.lastMessage.fromFirm ? 'der Kanzlei' : 'des Mandanten'} am ${fmtDateTime(String(f.lastMessage.createdAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(f.lastMessage.createdAt) ? '' : 'Z'))}:`,
            { text: `„${String(f.lastMessage.body || '').replace(/\s+/g, ' ').slice(0, 220)}“`, ref: { type: 'chat', id: f.lastMessage.id } },
            f.lastMessage.fromFirm ? '' : 'Darauf steht noch eine Antwort aus.'
          )
        : lines('Es gibt noch keine Nachrichten in dieser Akte.');
      out.lines.push({ text: c.hasClientAccount ? 'Der Mandant hat ein Portal-Konto.' : 'Der Mandant hat noch kein Portal-Konto.' });
      out.followups = ['aufgaben'];
      break;
    case 'risiken': {
      const g = gaps(d, now);
      out.lines = g.length ? g.map((x) => ({ text: x.text, ref: x.ref, level: x.level })) : lines('Ich finde keine Lücken oder Risiken – alles Erfasste wirkt stimmig.');
      out.followups = ['naechste'];
      break;
    }
    case 'naechste': {
      const steps = [];
      if (client) {
        if (f.openRequests.length) steps.push(`Bitte reichen Sie nach: ${f.openRequests.map((r) => r.title).join(', ')}.`);
        if (f.upcoming[0]) steps.push(`Merken Sie sich den nächsten Termin: ${eventLine(f.upcoming[0], now)}.`);
        if (f.openInvoices.length) steps.push(`Offene Rechnung${f.openInvoices.length > 1 ? 'en' : ''}: ${f.openInvoices.map((i) => `${i.number} (${money(i.total)})`).join(', ')}.`);
        if (!steps.length) steps.push('Von Ihrer Seite ist aktuell nichts nötig. Ihr Anwalt meldet sich, wenn es Neues gibt.');
      } else {
        const g = gaps(d, now).filter((x) => x.level !== 'info').slice(0, 3);
        for (const x of g) steps.push({ text: x.text, ref: x.ref });
        if (f.upcoming[0]) steps.push({ text: `Danach: ${eventLine(f.upcoming[0], now)}.`, ref: { type: 'event', id: f.upcoming[0].id } });
        if (!steps.length) steps.push('Es gibt nichts Dringendes. Ein Blick auf den Stand und die kommenden Termine genügt.');
      }
      out.lines = lines(steps);
      out.followups = ['risiken'];
      break;
    }
    case 'aehnlich':
      out.lines = f.similar.length ? lines(f.similar.slice(0, 5).map((p) => ({ text: `${p.title}${p.outcomeLabel ? ` – ${p.outcomeLabel}` : ''}${p.matched ? ` (${plural(p.matched, 'gleicher Paragraph', 'gleiche Paragraphen')})` : ''}`, ref: { type: 'precedent', id: p.id } }))) : lines('Die Kanzlei hat dazu noch keine ähnlichen Präzedenzfälle erfasst.');
      out.followups = ['anklage'];
      break;
    case 'zustaendig':
      out.lines = lines(f.lawyers.length ? `Zuständig: ${f.lawyers.join(', ')}.` : 'Es ist noch kein Anwalt zugeordnet.');
      out.followups = client ? ['termine'] : ['stand'];
      break;
    default:
      out.lines = [];
  }
  return out;
}

/* ---------------------------------------------------------------- Entwürfe */
const DRAFTS = [
  { id: 'einleitung', label: 'Schriftsatz: Einleitung' },
  { id: 'statusnachricht', label: 'Statusnachricht an den Mandanten' },
  { id: 'uebergabe', label: 'Übergabenotiz' },
  { id: 'verhandlung', label: 'Verhandlungsnotiz' },
  { id: 'vorhalt', label: 'Vorhalte an Zeugen' },
  { id: 'beweisverzeichnis', label: 'Beweisverzeichnis' },
];
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function draft(d, kind, now = new Date()) {
  const f = facts(d, now, 'staff');
  const c = f.c;
  const ch = f.charges && f.charges.charges ? f.charges.charges : [];
  const chargeText = ch.map((x) => `${x.citation || x.para || ''} ${x.title}`.trim()).join(', ');
  const lawyer = f.lawyers[0] || '[Anwalt]';
  switch (kind) {
    case 'einleitung': {
      const gegen = c.opponent || (c.area === 'strafrecht' ? 'die Staatsanwaltschaft' : '[Gegenpartei]');
      return {
        title: 'Schriftsatz: Einleitung',
        text: [
          `${c.courtRef ? `Az. ${c.courtRef} – ` : ''}Aktenzeichen ${c.caseNumber}`,
          `In dem Verfahren ${c.clientName} ./. ${gegen}${chargeText ? ` wegen ${chargeText}` : ''}`,
          '',
          `zeige ich an, dass ich ${c.clientName} anwaltlich vertrete. Eine Vollmacht liegt bei bzw. wird nachgereicht.`,
          c.area === 'strafrecht' ? 'Ich beantrage Akteneinsicht und bitte, bis zu deren Gewährung von Einlassungen abzusehen. Mein Mandant macht von seinem Schweigerecht Gebrauch.' : 'Ich bitte um Bestätigung des Eingangs und um Mitteilung des weiteren Verfahrensgangs.',
          f.upcoming[0] ? `Der nächste Termin ist ${eventLine(f.upcoming[0], now)}.` : '',
          '',
          'Mit freundlichen Grüßen',
          lawyer,
        ].join('\n'),
      };
    }
    case 'statusnachricht': {
      const next = f.upcoming.filter((a) => a.clientVisible)[0];
      return {
        title: 'Statusnachricht an den Mandanten',
        text: [
          `Hallo ${firstName(c.clientName)},`,
          '',
          `kurzer Stand zu Ihrer Akte ${c.caseNumber}: Aktuell befinden wir uns im Schritt „${c.stepLabel}“.`,
          c.publicNote ? c.publicNote : '',
          next ? `Der nächste Termin ist ${eventLine(next, now)}.` : 'Ein neuer Termin steht derzeit nicht an – ich melde mich, sobald es Neues gibt.',
          f.openRequests.length ? `Von Ihnen benötige ich noch: ${f.openRequests.map((r) => r.title).join(', ')}.` : '',
          f.openInvoices.length ? `Zur Erinnerung: ${plural(f.openInvoices.length, 'Rechnung ist', 'Rechnungen sind')} noch offen.` : '',
          '',
          'Bei Fragen schreiben Sie mir gern hier.',
          lawyer,
        ]
          .filter((x, i, a) => x !== '' || a[i - 1] !== '')
          .join('\n'),
      };
    }
    case 'uebergabe': {
      const g = gaps(d, now).filter((x) => x.level !== 'info');
      return {
        title: 'Übergabenotiz',
        text: [
          `Übergabe Akte ${c.caseNumber} – ${c.title}`,
          `Mandant: ${c.clientName}${c.opponent ? ` · Gegenpartei: ${c.opponent}` : ''} · Stand: ${c.stepLabel} (${c.statusLabel})`,
          '',
          'Kommende Termine und Fristen:',
          ...(f.upcoming.length ? f.upcoming.slice(0, 5).map((a) => `• ${eventLine(a, now)}`) : ['• keine']),
          '',
          'Offene Aufgaben:',
          ...(f.tasks.length ? f.tasks.slice(0, 8).map((t) => `• ${t.title}${t.dueDate ? ` (fällig ${fmtDay(`${t.dueDate}T12:00:00Z`)})` : ''}`) : ['• keine']),
          '',
          'Zeugen:',
          ...(f.witnesses.length ? f.witnesses.map((w) => `• ${w.name} – ${w.statusLabel}${w.side ? `, ${SIDE[w.side]}` : ''}${w.summonAt ? `, Ladung ${fmtDateTime(w.summonAt)}` : ''}`) : ['• keine']),
          '',
          'Zu beachten:',
          ...(g.length ? g.slice(0, 8).map((x) => `• ${x.text}`) : ['• nichts Auffälliges']),
        ].join('\n'),
      };
    }
    case 'verhandlung': {
      const s = f.charges && f.charges.sentence ? f.charges.sentence : {};
      return {
        title: 'Verhandlungsnotiz',
        text: [
          `Verhandlung ${c.caseNumber} – ${c.title}`,
          f.hearings[0] ? `Termin: ${eventLine(f.hearings[0], now)}` : f.upcoming[0] ? `Nächster Termin: ${eventLine(f.upcoming[0], now)}` : 'Termin: noch nicht eingetragen',
          `Mandant: ${c.clientName}${c.opponent ? ` · Gegenpartei: ${c.opponent}` : ''}`,
          ch.length ? `Vorwurf: ${chargeText}${s.maxHe != null ? ` · Rahmen ${s.minHe ?? 0}–${s.maxHe} HE` : ''}` : 'Vorwurf: keine Anklagepunkte erfasst',
          '',
          'Zeugen:',
          ...(f.witnesses.length ? f.witnesses.map((w) => `• ${w.name} (${w.side ? SIDE[w.side] : 'Lager offen'}, ${w.statusLabel})${w.expected ? ` – erwartet: ${w.expected}` : ''}`) : ['• keine']),
          '',
          'Beweise:',
          ...(f.evidence.length ? f.evidence.map((e) => `• B${e.no} ${e.caption || ''} (${e.side ? SIDE[e.side] : 'Lager offen'}, ${e.statusLabel || 'Gesichert'})`) : ['• keine']),
          '',
          'Offene Punkte:',
          ...(gaps(d, now).filter((x) => x.level !== 'info').slice(0, 6).map((x) => `• ${x.text}`) || []),
        ].join('\n'),
      };
    }
    case 'vorhalt': {
      const withContra = f.witnesses.filter((w) => (w.contradictions || []).length);
      return {
        title: 'Vorhalte an Zeugen',
        text: withContra.length
          ? withContra.map((w) => [`${w.name}${w.statement ? ` – Aussage: ${String(w.statement).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`, ...w.contradictions.map((x) => `  • Vorhalt${x.ref ? ` (${x.ref})` : ''}: ${x.text}`)].join('\n')).join('\n\n')
          : 'Es sind noch keine Vorhalte erfasst. Vorhalte legst du am Zeugen an („Vorhalt“-Knopf), z. B. „sagt 22 Uhr, Bodycam zeigt 22:14“ mit Bezug zu B3.',
      };
    }
    case 'beweisverzeichnis':
      return {
        title: 'Beweisverzeichnis',
        text: f.evidence.length
          ? f.evidence.map((e) => `B${e.no} – ${e.caption || 'ohne Bezeichnung'} (${[e.kindLabel, e.obtainedAt ? `erhoben ${fmtDateTime(e.obtainedAt)}` : '', e.source ? `Herkunft: ${e.source}` : ''].filter(Boolean).join(', ')})`).join('\n')
          : 'Es sind noch keine Beweismittel in der Akte.',
      };
    default:
      return null;
  }
}

module.exports = { facts, gaps, summary, answer, draft, pickIntent, INTENTS, DRAFTS, CLIENT_INTENTS, fold, daysUntil };
