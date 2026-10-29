/*
 * Kanzlei-Dashboard – Teil 10 von 14: Aktionen (Klicks auf data-action).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Aktionen (Klicks)
   ================================================================ */
const actions = {
  'open-sidebar': openSidebar,
  'nav-group': (el) => toggleNavGroup(el.dataset.group),
  'close-sidebar': closeSidebar,
  // X, „Abbrechen“, „Schließen“, „Fertig“: zurück zum vorherigen Fenster (z. B. zur Akte) – sonst schließen
  'close-modal': () => modalDismiss(),
  'reload-view': () => go(st.view),
  logout: async () => {
    if (unsavedInputs({ invoice: true }) && !(await askDiscard(true))) return;
    st.leaving = true; // keine zweite Rückfrage des Browsers
    window.PS.drafts.clearAll(); // Entwürfe gehören zu diesem Konto – nicht für den Nächsten am selben Gerät
    forgetRecent(); // ebenso die Liste „Zuletzt geöffnet“
    setAppBadge(0); // Zahl auf dem App-Symbol gehört ebenfalls zu diesem Konto
    await api.post('/api/auth/logout');
    location.href = '/login';
  },
  copy: async (el) => {
    const text = el.dataset.text || '';
    const ok = await copy(text);
    toast(ok ? (text.length <= 40 && !/\s/.test(text) ? `„${text}“ kopiert.` : 'In die Zwischenablage kopiert.') : 'Kopieren nicht möglich – bitte manuell markieren.', ok ? 'ok' : 'error');
  },

  // Mandantenkartei
  'open-client': (el) => openClient(el.dataset.key),
  'client-filter': (el) => {
    st.clientFilter = el.dataset.value;
    renderView();
  },
  'client-note-delete': (el) => {
    const key = st.clientCard.key;
    undoDelete({
      url: `/api/clients/notes/${el.dataset.id}`,
      hide: `.client-note:has([data-action="client-note-delete"][data-id="${el.dataset.id}"])`,
      label: 'Notiz',
      after: async () => st.clientCard && st.clientCard.key === key && showClient(await api.get('/api/clients/' + encodeURIComponent(key))),
    });
  },

  // Akten
  'case-filter': (el) => {
    st.caseFilter = el.dataset.value;
    renderView();
  },
  'case-mine': () => {
    st.caseMine = !st.caseMine;
    renderView();
  },
  'cases-filter-reset': () => {
    Object.assign(st, { caseFilter: 'aktiv', caseQuery: '', caseMine: false });
    renderView();
  },
  // Mehrfachauswahl in der Aktenliste
  'case-select': () => {
    st.caseSel = caseSelecting() ? null : new Set();
    renderView();
  },
  'case-pick': (el) => {
    const id = Number(el.dataset.id);
    if (st.caseSel.has(id)) st.caseSel.delete(id);
    else st.caseSel.add(id);
    const on = st.caseSel.has(id);
    el.classList.toggle('is-picked', on);
    el.setAttribute('aria-selected', String(on));
    $('#bulkBarSlot').innerHTML = bulkBar();
  },
  'case-select-all': () => {
    const rows = filteredCases();
    const all = rows.length && rows.every((c) => st.caseSel.has(c.id));
    st.caseSel = new Set(all ? [] : rows.map((c) => c.id));
    $('#caseList').innerHTML = caseTable();
    $('#bulkBarSlot').innerHTML = bulkBar();
  },
  'bulk-priority': (sel) => sel.value && bulkPatch(() => ({ priority: Number(sel.value) }), `Priorität „${PRIORITY[sel.value][0]}“`),
  'bulk-lawyer': (sel) => {
    const l = sel.value && st.lawyers.find((x) => x.id === Number(sel.value));
    if (l) bulkPatch(() => ({ lawyerId: l.id }), `Federführung: ${l.displayName}`);
  },
  'bulk-stage': (sel) => {
    const v = sel.value;
    if (!v) return;
    if (v !== 'geschlossen') return bulkPatch(() => (v.startsWith('step:') ? { status: 'in_bearbeitung', step: Number(v.slice(5)) } : { status: v }), `Stand „${v.startsWith('step:') ? STEPS[Number(v.slice(5))] : 'Offen'}“`);
    sel.value = '';
    openModal(`<h2 class="modal-title">${st.caseSel.size} ${st.caseSel.size === 1 ? 'Akte' : 'Akten'} abschließen</h2>
        <p class="modal-sub">Alle gewählten Akten bekommen dasselbe Ergebnis. Offene Rechnungen, Unterschriften oder Termine werden dabei nicht geprüft – im Zweifel lieber einzeln abschließen.</p>
        <form data-form="bulk-close" class="form-grid">
          <div><label class="label" for="bcOutcome">Ergebnis</label><select id="bcOutcome" name="outcome" class="field" required>${outcomeOptions()}</select></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Abschließen</span></button></div>
        </form>`);
  },
  'new-case': newCaseModal,
  'nc-pick': (el) => ncPick({ name: el.dataset.name, email: el.dataset.email }),
  'nc-unpick': () => ncPick(null),
  // Lange Listen: nächste Einträge (passiert beim Scrollen auch von selbst)
  'list-more': (el) => showMoreRows(el.dataset.id),
  'open-case': (el) => openCaseFrom(el),
  // Mein Profil → Animationen (je Gerät)
  'motion-set': (el) => {
    window.PS.motion.set(el.dataset.value);
    renderView();
    toast({ on: 'Animationen sind auf diesem Gerät jetzt immer an.', off: 'Animationen sind auf diesem Gerät aus.' }[el.dataset.value] || 'Animationen folgen jetzt der Einstellung des Systems.');
  },
  // „Was ist zu tun?“: Akte öffnen und direkt zu den Nachrichten springen
  'open-case-chat': async (el) => {
    await openCase(Number(el.dataset.id));
    $('#secChat')?.scrollIntoView({ block: 'start' });
  },
  'case-step': async (el) => {
    const id = Number(el.dataset.id);
    const step = Number(el.dataset.step);
    const steps = $$('button.track-step');
    steps.forEach((b) => (b.disabled = true)); // kein Doppelklick während des Speicherns
    const undo = previewStage(`step:${step}`); // Kreise springen sofort um
    const was = st.caseInfo && st.caseInfo.id === id ? st.caseInfo.step : null;
    try {
      await casePatch(id, { step });
    } catch (err) {
      undo();
      throw notSaved(err);
    } finally {
      steps.forEach((b) => b.isConnected && (b.disabled = false));
    }
    toast(`Bearbeitungsstand: ${stepsOf(st.caseInfo && st.caseInfo.id === id ? st.caseInfo.area : '')[step]}`, 'ok', { duration: 6000, ...(was !== null && was !== step ? { action: undoPatch(id, { step: was }) } : {}) });
    await reloadCase(id);
  },
  // Fünfter Kreis „Abgeschlossen“ im Bearbeitungsstand
  'case-close': (el) => closeCase(Number(el.dataset.id)),
  // Abgeschlossene Akte: Klick auf einen Schritt öffnet sie dort wieder
  'case-reopen': async (el) => {
    const id = Number(el.dataset.id);
    const step = Number(el.dataset.step);
    if (!(await ask(`Die Akte wird wieder geöffnet und steht dann auf „${stepsOf(st.caseInfo && st.caseInfo.id === id ? st.caseInfo.area : '')[step]}“.`, { title: 'Akte wieder öffnen?', confirmText: 'Wieder öffnen' }))) return;
    await api.patch('/api/cases/' + id, { status: 'in_bearbeitung', step });
    toast(`Akte wieder geöffnet – ${stepsOf(st.caseInfo && st.caseInfo.id === id ? st.caseInfo.area : '')[step]}`);
    await reloadCase(id);
  },
  'pt-toggle': () => {
    const box = $('#ptBox');
    if (!box) return;
    box.hidden = !box.hidden;
    if (box.hidden) return;
    const input = box.querySelector('[name="url"]');
    input.focus();
    input.select();
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  'pt-remove': async (el) => {
    const id = Number(el.dataset.id);
    if (!(await askDelete('Prozessticket entfernen?', 'Der Link wird aus der Akte entfernt. Der Kanal im Discord des DOJ bleibt davon unberührt.', 'Entfernen'))) return;
    await api.del(`/api/cases/${id}/process-ticket`);
    toast('Prozessticket entfernt.');
    await reloadCase(id);
  },
  'claim-case': async (el) => {
    const id = Number(el.dataset.id);
    await api.patch('/api/cases/' + id, { lawyerId: st.user.id });
    toast('Akte übernommen – sie liegt jetzt bei Ihnen.');
    if (st.modalCaseId === id) await reloadCase(id);
    else await refreshBehind();
  },
  'release-case': async (el) => {
    const next = st.caseInfo && st.caseInfo.id === Number(el.dataset.id) ? (st.caseInfo.coLawyers || [])[0] : null;
    const text = next
      ? `Die Federführung geht an ${next.name} über. Sie arbeiten danach nicht mehr an der Akte mit.`
      : 'Die Akte erscheint danach wieder als offene Anfrage für das Team.';
    if (!(await ask(text, { title: 'Akte abgeben?', confirmText: 'Akte abgeben' }))) return;
    const id = Number(el.dataset.id);
    await api.patch('/api/cases/' + id, { lawyerId: null });
    toast(next ? `Akte abgegeben – federführend ist jetzt ${next.name}.` : 'Akte abgegeben.');
    await reloadCase(id);
  },
  'leave-case': async (el) => {
    const id = Number(el.dataset.id);
    const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null;
    if (!c) return;
    if (!(await ask('Sie werden als weiterer Anwalt aus der Akte ausgetragen und können sie danach nicht mehr bearbeiten.', { title: 'Mitarbeit beenden?', confirmText: 'Mitarbeit beenden' }))) return;
    await api.patch('/api/cases/' + id, { coLawyerIds: (c.coLawyers || []).map((l) => l.id).filter((uid) => uid !== st.user.id) });
    toast('Sie arbeiten nicht mehr an dieser Akte mit.');
    await reloadCase(id);
  },
  'delete-case': async (el) => {
    if (!(await askDelete(`Akte ${el.dataset.number} löschen?`, 'Die Akte kommt mit Notizen, Aufgaben, Anhängen und Verträgen 30 Tage in den Papierkorb (Aktenverwaltung → Papierkorb) und lässt sich bis dahin wiederherstellen. Danach wird sie endgültig gelöscht.', 'Löschen'))) return;
    await api.del('/api/cases/' + el.dataset.id);
    toast('Akte gelöscht – 30 Tage im Papierkorb.');
    await modalBack();
    await refreshBehind();
  },
  'case-trash': () => openTrash(),
  'global-search': () => openSearch(),
  // Zwei-Faktor-Anmeldung (Profil)
  'tf-on': async () => {
    st.twoFactor = await api.patch('/api/auth/two-factor', { enabled: true });
    toast('Zwei-Faktor-Anmeldung ist aktiv – beim nächsten Login kommt der Code per Discord.');
    renderView();
  },
  'tf-off': () =>
    openModal(`
      <h2 class="modal-title">Zwei-Faktor-Anmeldung ausschalten?</h2>
      <p class="modal-sub">Dann reicht beim Login wieder das Passwort. Zur Sicherheit bitte Ihr Passwort eingeben.</p>
      <form data-form="tf-off" class="form-grid">
        <div><label class="label" for="tfPw">Passwort</label><input id="tfPw" name="password" type="password" autocomplete="current-password" required class="field" autofocus></div>
        <div class="form-actions"><button type="submit" class="btn-danger btn-md">Ausschalten</button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`),
  'tf-forget': async () => {
    if (!(await ask('Alle Geräte – auch dieses – brauchen beim nächsten Login wieder den Code.', { title: 'Vertraute Geräte vergessen?', confirmText: 'Vergessen' }))) return;
    st.twoFactor = await api.del('/api/auth/two-factor/devices');
    toast('Vertraute Geräte vergessen.');
    renderView();
  },
  'logout-others': async () => {
    if (!(await ask('Alle anderen Anmeldungen (andere Browser, Handy, App) werden beendet. Dieses Gerät bleibt angemeldet.', { title: 'Auf allen anderen Geräten abmelden?', confirmText: 'Abmelden' }))) return;
    const r = await api.post('/api/auth/logout-others', {});
    st.otherSessions = r.others;
    toast(r.ended ? `Auf ${r.ended === 1 ? 'einem weiteren Gerät' : `${r.ended} weiteren Geräten`} abgemeldet.` : 'Es gab keine weiteren Anmeldungen.');
    renderView();
  },
  'reviews-filter': async (el) => {
    st.reviewFilter = el.dataset.value;
    await refreshBehind();
  },
  'review-decide': async (el) => {
    await api.post(`/api/reviews/${el.dataset.id}/decide`, { status: el.dataset.status });
    toast(el.dataset.status === 'freigegeben' ? 'Veröffentlicht – erscheint auf der Startseite.' : 'Nicht (mehr) auf der Website.');
    await refreshBehind();
  },
  'review-delete': async (el) => {
    if (!(await askDelete('Bewertung löschen?', 'Die Bewertung wird endgültig entfernt.'))) return;
    await api.del('/api/reviews/' + el.dataset.id);
    toast('Bewertung gelöscht.');
    if (el.dataset.caseId) await reloadCase(Number(el.dataset.caseId));
    else await refreshBehind();
  },
  'review-edit': async (el) => {
    st.reviewEdit = Number(el.dataset.id);
    if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
  'review-cancel': async () => {
    st.reviewEdit = null;
    if (st.modalCaseId) await reloadCase(st.modalCaseId);
  },
  'gs-open': (el) => openSearchResult(el.dataset.type, Number(el.dataset.id)),
  'trash-restore': async (el) => {
    const r = await api.post(`/api/cases/trash/${el.dataset.id}/restore`);
    toast(`Akte ${el.dataset.number} wiederhergestellt.`);
    await refreshBehind();
    await openCase(r.case.id);
  },
  'trash-purge': async (el) => {
    if (!(await askDelete(`Akte ${el.dataset.number} endgültig löschen?`, 'Die Akte und ihre Anhänge werden sofort und unwiderruflich gelöscht.', 'Endgültig löschen'))) return;
    await api.del('/api/cases/trash/' + el.dataset.id);
    toast('Endgültig gelöscht.');
    await openTrash(true);
  },
  'chat-focus': () => {
    const sec = $('#secChat');
    if (!sec) return;
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('#secChat .chat-input')?.focus({ preventScroll: true });
  },
  // „Notiz“ in der Hinweisleiste einer liegengebliebenen Akte: zum Verlauf und gleich ins Notizfeld
  'note-focus': () => {
    const sec = $('#secNotes');
    if (!sec) return;
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('#secNotes textarea[name="body"]')?.focus({ preventScroll: true });
  },
  'delete-note': (el) => {
    const caseId = Number(el.dataset.caseId);
    const sel = `[data-action="delete-note"][data-id="${el.dataset.id}"]`;
    undoDelete({
      url: `/api/cases/${caseId}/notes/${el.dataset.id}`,
      hide: `.tl-item:has(${sel}), .chat-msg:has(${sel})`,
      label: el.closest('.chat-msg') ? 'Nachricht' : 'Notiz',
      after: () => (st.modalCaseId === caseId ? reloadCase(caseId) : refreshBehind()),
    });
  },

  // Kalender
  'new-event': async (el) => {
    st.returnCase = el.dataset.returnCase ? Number(el.dataset.returnCase) : null;
    const caseId = el.dataset.caseId ? Number(el.dataset.caseId) : null;
    await load.cases();
    if (isStaff()) {
      await load.lawyers();
      openModal(eventForm(null, { caseId, day: el.dataset.day || null }));
    } else {
      openModal(eventRequestForm(caseId));
    }
  },
  'open-event': (el) => openEvent(Number(el.dataset.id), st.modalCaseId),
  'event-status': async (el) => {
    await api.patch('/api/calendar/' + el.dataset.id, { status: el.dataset.status });
    toast({ bestaetigt: 'Termin bestätigt.', abgesagt: 'Termin abgesagt.', erledigt: 'Frist als erledigt markiert.' }[el.dataset.status] || 'Gespeichert.');
    await returnOrClose();
  },
  // Terminvorschlag: Mandant tippt eine Zeit an
  'event-choose': async (el) => {
    await api.post(`/api/calendar/${el.dataset.id}/choose`, { startsAt: el.dataset.at });
    toast('Termin bestätigt – danke!');
    await returnOrClose();
  },
  'event-delete': async (el) => {
    const id = Number(el.dataset.id);
    const ev = st.eventCache.get(id);
    undoDelete({
      url: '/api/calendar/' + id,
      hide: `[data-action="open-event"][data-id="${id}"]:not(.kpi)`,
      label: ev && ev.type === 'frist' ? 'Frist' : 'Termin',
      after: async () => {
        st.eventCache.delete(id);
        if (st.modalCaseId) await reloadCase(st.modalCaseId);
        else await refreshBehind();
      },
    });
    await returnOrClose();
  },
  'cal-nav': (el) => {
    const m = st.cal.month;
    st.cal.month = new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.dir), 1);
    renderView();
    calSlide(Number(el.dataset.dir));
  },
  'cal-today': () => {
    st.cal.month = monthStart(new Date());
    st.cal.selected = dayKey(new Date());
    renderView();
  },
  'cal-select': (el) => {
    st.cal.selected = el.dataset.day;
    const d = new Date(`${el.dataset.day}T12:00:00`);
    if (d.getMonth() !== st.cal.month.getMonth()) st.cal.month = monthStart(d);
    renderView();
    if (window.matchMedia('(max-width: 1279px)').matches) $('#dayAgenda')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'cal-type': (el) => {
    st.cal.types[el.dataset.type] = !st.cal.types[el.dataset.type];
    renderView();
  },

  // Kanzlei-Post
  compose: async (el) => {
    st.returnCase = el.dataset.returnCase ? Number(el.dataset.returnCase) : null;
    await composeModal({
      recipientId: el.dataset.recipient ? Number(el.dataset.recipient) : null,
      caseId: el.dataset.caseId ? Number(el.dataset.caseId) : null,
    });
  },
  'mail-box': async (el) => {
    st.mailBox = el.dataset.value;
    st.mailSel = null;
    await load.messages();
    renderView();
  },
  'mail-open': async (el) => {
    const m = st.messages.find((x) => x.id === Number(el.dataset.id));
    if (!m) return;
    st.mailSel = m.id;
    if (st.mailBox === 'inbox' && !m.isRead) {
      m.isRead = true;
      st.unread = Math.max(0, st.unread - 1);
      api.patch('/api/messages/' + m.id, { isRead: true }).catch(() => {});
    }
    renderView();
    if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  'mail-back': () => {
    st.mailSel = null;
    renderView();
  },
  'mail-reply': async (el) => {
    const m = st.messages.find((x) => x.id === Number(el.dataset.id));
    if (!m) return;
    st.returnCase = null;
    await composeModal({ recipientId: m.senderId, caseId: m.caseId, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`.trim(), reply: true });
  },
  'mail-unread': async (el) => {
    const m = st.messages.find((x) => x.id === Number(el.dataset.id));
    await api.patch('/api/messages/' + el.dataset.id, { isRead: false });
    if (m) m.isRead = false;
    st.unread += 1;
    st.mailSel = null;
    renderView();
  },
  'mail-delete': async (el) => {
    if (!(await askDelete('Nachricht löschen?', 'Die Nachricht verschwindet aus Ihrem Postfach.'))) return;
    await api.del('/api/messages/' + el.dataset.id);
    st.mailSel = null;
    toast('Nachricht gelöscht.');
    await refreshBehind();
  },
  'mail-read-all': async () => {
    await api.post('/api/messages/read-all');
    await refreshBehind();
  },

  // Pinnwand
  'board-new': () => noteModal(null),
  'board-edit': (el) => noteModal(st.board.find((n) => n.id === Number(el.dataset.id))),
  'board-pin': async (el) => {
    const n = st.board.find((x) => x.id === Number(el.dataset.id));
    if (!n) return;
    await api.patch('/api/board/' + n.id, { pinned: !n.pinned });
    await refreshBehind();
  },
  'board-delete': async (el) => {
    if (!(await askDelete('Notiz entfernen?', 'Die Notiz wird von der Pinnwand entfernt.', 'Entfernen'))) return;
    await api.del('/api/board/' + el.dataset.id);
    toast('Notiz entfernt.');
    await refreshBehind();
  },

  // Rechnungen
  'inv-filter': (el) => {
    st.invFilter = el.dataset.value;
    renderView();
  },
  'new-invoice': async (el) => {
    await load.cases();
    // Aus der Akte heraus: Abbrechen und Erstellen führen zurück in diese Akte
    const from = el.dataset.caseId && st.modalCaseId === Number(el.dataset.caseId) ? { view: st.view, caseId: st.modalCaseId, caseNumber: st.caseInfo ? st.caseInfo.caseNumber : '' } : null;
    const caseId = el.dataset.caseId ? Number(el.dataset.caseId) : null;
    // Für diese Akte schon angefangen (auch vor dem Neuladen): dort weitermachen
    const saved = savedInvoiceDraft(caseId);
    st.draft = saved || newDraft(caseId);
    st.invoiceFrom = from;
    await navigate('invoice-new');
    if (saved) toast('Angefangene Rechnung wiederhergestellt.');
  },
  'inv-back': async (el) => {
    const from = st.invoiceFrom;
    if (el.dataset.cancel && st.draft) {
      // „Abbrechen“: Entwurf verwerfen
      forgetInvoiceDraft(st.draft.caseId);
      st.draft = null;
    }
    if (!from) return navigate('invoices');
    await returnToView(from.view);
    await openCase(from.caseId);
  },
  'inv-from-contract': async () => {
    const d = st.draft;
    if (d.items.length && !(await ask('Die bisherigen Positionen werden durch die Leistungen aus dem Vertrag ersetzt.', { title: 'Positionen ersetzen?', confirmText: 'Ersetzen' }))) return;
    applyContractItems(d);
    renderView();
    toast('Leistungen aus dem Vertrag übernommen.');
  },
  'inv-add-item': () => {
    st.draft.items.push({ description: '', quantity: 1, unitPrice: 0 });
    renderView();
    const inputs = $$('.item-desc');
    inputs[inputs.length - 1]?.focus();
  },
  'inv-remove-item': (el) => {
    st.draft.items.splice(Number(el.dataset.index), 1);
    renderView();
  },
  'inv-preset': (el) => {
    st.draft[el.dataset.field] = Number(el.dataset.value);
    const input = $(`#invoiceForm [name="${el.dataset.field}"]`);
    if (input) input.value = el.dataset.value;
    updateInvoiceSummary();
  },
  'inv-status': async (el) => {
    const row = el.closest('tr, .inv-card, .row') || el;
    await api.patch('/api/invoices/' + el.dataset.id, { status: el.dataset.status });
    toast(
      el.dataset.reported && el.dataset.status === 'bezahlt'
        ? 'Zahlungseingang bestätigt – der Mandant wird informiert.'
        : { bezahlt: 'Als bezahlt markiert.', storniert: 'Dokument storniert.', offen: 'Wieder als offen markiert.' }[el.dataset.status]
    );
    await afterInvoiceChange(el);
  },
  // Mandant: „Ich habe bezahlt“ melden · Kanzlei: Meldung zurückweisen (Zahlung nicht eingegangen)
  'inv-pay-report': (el) => paymentReportModal(Number(el.dataset.id)),
  'inv-pay-reject': (el) => paymentRejectModal(Number(el.dataset.id), el.dataset.number),
  'inv-remind': async (el) => {
    const r = await api.post(`/api/invoices/${el.dataset.id}/remind`);
    if (r.sent.length) toast(`Zahlungserinnerung zu ${el.dataset.number} gesendet (${r.sent.join(' und ')}).`);
    else toast('Erinnerung vermerkt – der Mandant ist über Discord nicht erreichbar (kein verknüpftes Discord, kein Ticket). Bitte direkt ansprechen.', 'error');
    await refreshBehind();
  },
  'inv-delete': async (el) => {
    if (!(await askDelete(`Dokument ${el.dataset.number} löschen?`, 'Stornieren ist meist die bessere Wahl – dann bleibt das Dokument nachvollziehbar.', 'Endgültig löschen'))) return;
    await api.del('/api/invoices/' + el.dataset.id);
    toast('Dokument gelöscht.');
    await refreshBehind();
  },

  // Team
  'team-new': () => memberModal(null),
  'team-edit': (el) => memberModal(st.team.find((m) => m.id === Number(el.dataset.id))),
  'team-move': async (el) => {
    const ids = st.team.map((t) => t.id);
    const i = ids.indexOf(Number(el.dataset.id));
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.post('/api/admin/team/reorder', { ids });
    await refreshBehind();
  },
  'team-delete': (el) => {
    const m = st.team.find((x) => x.id === Number(el.dataset.id));
    if (!m) return;
    const canLock = m.userId && m.userId !== st.user.id && m.userActive;
    openModal(`
        <h2 class="modal-title">Profil entfernen?</h2>
        <p class="modal-sub"><strong>${esc(m.name)}</strong> wird sofort aus dem Bereich „Unser Team“ der Website entfernt.</p>
        <form data-form="team-delete" data-id="${m.id}" class="form-grid">
          ${canLock ? `<label class="check"><input type="checkbox" name="lock"> Zugehöriges Login-Konto (${esc(m.userEmail)}) ebenfalls sperren</label>` : ''}
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">${icon('trash', 'ico-sm')}<span>Endgültig entfernen</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
        </form>`);
  },

  // Benutzer
  'user-filter': (el) => {
    st.userFilter = el.dataset.value;
    renderView();
  },
  'user-new': () => {
    openModal(`
        <h2 class="modal-title">Konto anlegen</h2>
        <p class="modal-sub">Es wird ein Einmal-Passwort erzeugt. Für Teammitglieder mit Website-Profil besser unter „Team“ anlegen.</p>
        <form data-form="user-new" class="form-grid cols-2">
          <div class="span-2"><label class="label">Name</label><input name="displayName" class="field" required minlength="2" maxlength="80" autofocus></div>
          <div class="span-2"><label class="label">E-Mail (Login)</label>${emailField('email', { required: true })}</div>
          <div><label class="label">Rolle</label><select name="role" class="field">${Object.entries(ROLES).map(([k, l]) => opt(k, l, k === 'anwalt')).join('')}</select></div>
          <div><label class="label">Rang (optional)</label>${rankSelect('rank', '')}</div>
          <div class="span-2"><label class="label">Telefon (optional)</label><input name="phone" class="field" maxlength="40"></div>
          <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Konto anlegen</span></button></div>
        </form>`);
  },
  'user-reset': async (el) => {
    const u = st.users.find((x) => x.id === Number(el.dataset.id));
    if (!u || !(await ask(`Für ${u.displayName} wird ein neues Einmal-Passwort erzeugt. Das bisherige Passwort wird sofort ungültig.`, { title: 'Passwort zurücksetzen?', confirmText: 'Neues Passwort erzeugen' }))) return;
    const res = await api.post(`/api/admin/users/${u.id}/reset-password`);
    showCredentials(res.credentials, u.displayName);
    refreshBehind();
  },
  'user-toggle': async (el) => {
    const u = st.users.find((x) => x.id === Number(el.dataset.id));
    if (!u) return;
    if (u.active && !(await askDelete('Konto sperren?', `${u.displayName} wird sofort abgemeldet und kann sich nicht mehr anmelden.`, 'Sperren'))) return;
    await api.patch('/api/admin/users/' + u.id, { active: !u.active });
    toast(u.active ? 'Konto gesperrt.' : 'Konto entsperrt.');
    await refreshBehind();
  },
  'user-delete': async (el) => {
    const u = st.users.find((x) => x.id === Number(el.dataset.id));
    if (!u || !(await askDelete('Konto löschen?', `Das Konto von ${u.displayName} wird endgültig gelöscht. Akten bleiben erhalten.`, 'Endgültig löschen'))) return;
    await api.del('/api/admin/users/' + u.id);
    toast('Konto gelöscht.');
    await refreshBehind();
  },

  // Honorarordnung
  'fee-new': (el) => feeModal(null, el.dataset.category),
  'fee-edit': (el) => feeModal(st.adminFees.find((f) => f.id === Number(el.dataset.id))),
  'fee-delete': async (el) => {
    const f = st.adminFees.find((x) => x.id === Number(el.dataset.id));
    if (!f || !(await askDelete('Leistung löschen?', `„${f.name}“ wird aus der Honorarordnung gelöscht – auch auf der Website.`))) return;
    await api.del('/api/admin/fees/' + f.id);
    toast('Leistung gelöscht.');
    await refreshBehind();
  },

  // Dienststatus & Stempeluhr
  'duty-menu': () => {
    if ($('#dutyPop').classList.contains('open')) closeDutyPop();
    else openDutyPop();
  },
  'duty-set': (el) => setDutyStatus(el.dataset.status),
  'duty-force-off': async (el) => {
    if (!(await ask(`${el.dataset.name} wird jetzt ausgestempelt.`, { title: 'Ausstempeln?', confirmText: 'Ausstempeln' }))) return;
    st.duty = await api.post('/api/duty/force-off/' + el.dataset.id);
    toast(`${el.dataset.name} wurde ausgestempelt.`);
    await refreshBehind();
  },
  'duty-week': async (el) => {
    const dir = Number(el.dataset.dir);
    const w = st.dutyWeek;
    st.dutyWeek = dir === 0 ? mondayOf(new Date()) : new Date(w.getFullYear(), w.getMonth(), w.getDate() + dir * 7);
    await refreshBehind();
  },
  'duty-select': (el) => {
    st.dutyUser = Number(el.dataset.id);
    renderView();
  },
  'duty-session-new': () => dutySessionModal(null),
  'duty-session-edit': (el) => dutySessionModal(st.dutyData.sessions.find((s) => s.id === Number(el.dataset.id))),
  'duty-session-delete': async (el) => {
    if (!(await askDelete('Schicht löschen?', 'Die Dienstzeit wird endgültig gelöscht.'))) return;
    await api.del('/api/duty/sessions/' + el.dataset.id);
    toast('Schicht gelöscht.');
    await refreshBehind();
  },

  // Bilder
  'avatar-remove': async () => {
    const res = await api.del('/api/auth/avatar');
    st.user = res.user;
    renderUser();
    renderView();
    toast('Profilbild entfernt.');
  },
  'team-photo-remove': async (el) => {
    const res = await api.del(`/api/admin/team/${el.dataset.id}/photo`);
    const m = res.member;
    const photo = $('#tmPhoto');
    if (photo) photo.innerHTML = m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials);
    const ctl = $('#tmPhotoCtl');
    if (ctl) ctl.innerHTML = teamPhotoControls(m);
    toast('Foto entfernt.');
    await refreshBehind();
  },
  'peek-close': () => docPeekClose(),
  'peek-step': (el) => {
    const box = $('#docPeek');
    const dir = Number(el.dataset.dir || 0);
    if (box && dir) docPeekOpen(Number(box.dataset.index) + dir, box.dataset.linked === '1');
  },
  'att-open': (el) => {
    // Eigene Beweise (data-index) oder Beweise einer verknüpften Akte (data-linked, nur ansehen)
    const linked = el.dataset.linked != null;
    const index = Number(linked ? el.dataset.linked : el.dataset.index);
    if (peekOk() && el.classList.contains('att')) return docPeekOpen(index, linked);
    const a = linked ? st.linkedAttachments[index] : st.caseAttachments[index];
    if (!a) return;
    const caseId = st.modalCaseId;
    st.returnCase = caseId;
    const no = a.no;
    const canDelete = !linked && (a.uploaderId === st.user.id || isAdmin());
    // Großansicht wächst aus dem Vorschaubild hervor und kehrt beim Schließen dorthin zurück (13-bewegung.js)
    const from = flyOk() && el.classList.contains('att') ? el.getBoundingClientRect() : null;
    st.lightboxBack = { attr: linked ? 'data-linked' : 'data-index', value: linked ? el.dataset.linked : el.dataset.index };
    openModal(
      `<p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Beweismittel B${no}${linked ? ` · Akte ${esc(a.caseNumber)}` : ''}</p>
        <h2 class="modal-title">${esc(a.caption || 'Anhang')}</h2>
        <p class="modal-sub flex flex-wrap items-center gap-2">${esc(a.uploaderName)} <span class="stamp-mini is-in" title="Eingang">Eingang ${esc(fmtDate(a.createdAt))}</span>${a.internal ? '<span class="stamp-mini">Vertraulich</span>' : ''}</p>
        ${evMetaLine(a) ? `<p class="modal-sub">${evMetaLine(a)}</p>` : ''}${evDetails(a)}
        <div class="lb-zoom${from ? ' is-flying' : ''}"><img class="lightbox-img" src="${esc(a.url)}" alt="${esc(a.caption)}"><div class="lb-lens" aria-hidden="true"></div></div>
        <p class="lb-hint">Zum Vergrößern mit der Maus über das Bild fahren – am Handy mit zwei Fingern oder doppelt tippen.</p>
        <div class="form-actions">
          <button class="btn-outline btn-md" data-action="back-to-case">${icon('chevronLeft', 'ico-sm')}<span>Zurück zur Akte</span></button>
          ${linked ? `<button class="btn-ghost btn-md" data-action="open-case" data-id="${a.caseId}">${icon('folder', 'ico-sm')}<span>Akte ${esc(a.caseNumber)} öffnen</span></button>` : ''}
          <a class="btn-ghost btn-md" href="${esc(a.url)}" download>${icon('download', 'ico-sm')}<span>Herunterladen</span></a>
          ${!linked && isStaff() && st.caseInfo && st.caseInfo.canEdit ? `<button class="btn-ghost btn-md" data-action="ev-edit-box" data-id="${a.id}">${icon('edit', 'ico-sm')}<span>Beschreiben</span></button>` : ''}
          ${!linked && isStaff() ? `<button class="btn-ghost btn-md" data-action="redact-open" data-index="${index}">${icon('edit', 'ico-sm')}<span>Schwärzen</span></button>` : ''}
          ${canDelete ? `<button class="btn-danger btn-md" data-action="att-delete" data-id="${a.id}" data-case-id="${caseId}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
        </div>`,
      { wide: true }
    );
    lightboxEnter(from);
  },
  'redact-open': (el) => redactOpen(Number(el.dataset.index)),
  'redact-undo': () => {
    redact.boxes.pop();
    redactDraw();
  },
  'redact-save': async () => {
    const r = redact;
    if (!r.boxes.length) throw new Error('Bitte zuerst mindestens eine Stelle schwärzen (mit der Maus bzw. dem Finger ein Rechteck ziehen).');
    const blob = await new Promise((res) => r.canvas.toBlob(res, 'image/jpeg', 0.9));
    const caption = `${r.att.caption || `B${r.att.no}`} (geschwärzt)`.slice(0, 200);
    const internal = $('#redactInternal') && $('#redactInternal').checked ? '1' : '0';
    await api.upload(`/api/cases/${r.caseId}/attachments?caption=${encodeURIComponent(caption)}&internal=${internal}`, blob);
    toast('Geschwärzte Kopie gespeichert – das Original bleibt unverändert.');
    st.returnCase = r.caseId;
    await returnOrClose();
  },
  // Akten verknüpfen
  'case-link': (el) => {
    const id = Number(el.dataset.id);
    const c = st.cases.find((x) => x.id === id);
    const others = st.cases.filter((x) => x.id !== id).sort((a, b) => caseTime(b, 'createdAt') - caseTime(a, 'createdAt'));
    st.returnCase = id;
    openModal(`<p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">Akte ${esc(c ? c.caseNumber : '')}</p>
        <h2 class="modal-title">Akte verknüpfen</h2>
        <p class="modal-sub">Für zusammenhängende Fälle, z. B. ein Vorfall mit mehreren Festgenommenen. Verknüpfte Akten stehen sich gegenseitig im Aktenkopf, ihre Beweismittel erscheinen als gemeinsame Beweismappe – nur für die Kanzlei, nie für Mandanten.</p>
        <form data-form="case-link" data-id="${id}" class="form-grid">
          <div><label class="label" for="clOther">Andere Akte</label><select id="clOther" name="otherId" class="field" required><option value="">Bitte wählen …</option>${others
            .map((x) => opt(x.id, `${x.caseNumber} · ${x.clientName} · ${x.title}`))
            .join('')}</select></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('link', 'ico-sm')}<span>Verknüpfen</span></button></div>
        </form>`);
  },
  'case-unlink': async (el) => {
    if (!(await ask(`Die Verknüpfung mit ${el.dataset.number} wird gelöst – beide Akten bleiben unverändert.`, { title: 'Verknüpfung lösen?', confirmText: 'Lösen' }))) return;
    await api.del(`/api/cases/${el.dataset.id}/links/${el.dataset.other}`);
    toast('Verknüpfung gelöst.');
    await reloadCase(Number(el.dataset.id));
  },
  'att-delete': async (el) => {
    if (!(await askDelete('Anhang löschen?', 'Das Bild wird endgültig aus der Akte gelöscht.'))) return;
    await api.del(`/api/cases/${el.dataset.caseId}/attachments/${el.dataset.id}`);
    toast('Anhang gelöscht.');
    await returnOrClose();
  },
  'back-to-case': () => modalDismiss(returnOrClose),

  // VIP & Lifetime – Anfragen
  'vipreq-filter': async (el) => {
    st.vipReqAll = el.dataset.value === 'alle';
    await refreshBehind();
  },
  'vipreq-accept': (el) => {
    const r = st.vip.requests.find((x) => x.id === Number(el.dataset.id));
    if (!r) return;
    openModal(`
        <h2 class="modal-title">Anfrage annehmen</h2>
        <p class="modal-sub">${esc(r.name)} · ${esc(r.tierName)} · ${money(r.price)}. Es wird eine Rechnung über den Preis erstellt (im Portal des Mandanten sichtbar). Sobald sie bezahlt ist, wird die Mitgliedschaft automatisch freigeschaltet.</p>
        <form data-form="vipreq-accept" data-id="${r.id}" class="form-grid">
          <label class="check"><input type="checkbox" name="paid"> Zahlung bereits erhalten – sofort freischalten</label>
          <div><label class="label">Hinweis an den Mandanten <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="note" class="field" maxlength="500" placeholder="z. B. Zahlung bitte bei Dr. Alois Pake in der Kanzlei"></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Annehmen</span></button></div>
        </form>`);
  },
  'vipreq-decline': (el) => {
    const r = st.vip.requests.find((x) => x.id === Number(el.dataset.id));
    if (!r) return;
    openModal(`
        <h2 class="modal-title">Anfrage ablehnen</h2>
        <p class="modal-sub">${esc(r.name)} · ${esc(r.tierName)}. Der Grund wird dem Mandanten angezeigt.</p>
        <form data-form="vipreq-decline" data-id="${r.id}" class="form-grid">
          <div><label class="label">Grund</label><input name="reason" class="field" required minlength="2" maxlength="500" autofocus></div>
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">Ablehnen</button></div>
        </form>`);
  },
  'vipreq-paid': async (el) => {
    const r = st.vip.requests.find((x) => x.id === Number(el.dataset.id));
    if (!r || !r.invoice) return;
    if (!(await ask(`Rechnung ${r.invoice.number} über ${money(r.price)} als bezahlt markieren? ${r.name} erhält ${r.tierName} sofort.`, { title: 'Bezahlt – freischalten?', confirmText: 'Freischalten' }))) return;
    const res = await api.patch(`/api/invoices/${r.invoice.id}`, { status: 'bezahlt' });
    toast(`${r.tierName} für ${r.name} freigeschaltet.`);
    (res.warnings || []).forEach((w) => toast(w, 'error'));
    await refreshBehind();
  },
  'vip-request': (el) => {
    const t = st.offers.tiers.find((x) => x.id === Number(el.dataset.id));
    if (t) vipRequestModal(t);
  },
  'vip-request-withdraw': async (el) => {
    if (!(await ask('Die Anfrage wird zurückgezogen.', { title: 'Anfrage zurückziehen?', confirmText: 'Zurückziehen' }))) return;
    await api.del(`/api/memberships/requests/${el.dataset.id}`);
    toast('Anfrage zurückgezogen.');
    await refreshBehind();
  },

  // VIP & Lifetime
  'vip-filter': async (el) => {
    st.vipAll = el.dataset.value === 'alle';
    await refreshBehind();
  },
  'vip-grant': async () => {
    if (!st.vip.tiers.some((t) => t.active)) throw new Error('Es gibt keine aktive Stufe. Bitte zuerst unter „Stufen, Preise & Rabatte“ eine anlegen.');
    openModal(grantDialog());
    await searchVipAccounts($('#vipAccSearch'));
  },
  'vip-pick': async (el) => {
    $('form[data-form="vip-grant"] input[name="userId"]').value = el.dataset.id;
    $('#vipAccSearch').value = el.dataset.name;
    await searchVipAccounts($('#vipAccSearch'));
  },
  'vip-renew': (el) => {
    const m = st.vip.memberships.find((x) => x.id === Number(el.dataset.id));
    const t = m && st.vip.tiers.find((x) => x.id === m.tierId);
    if (!m) return;
    if (!t) throw new Error('Die Stufe dieser Mitgliedschaft gibt es nicht mehr – bitte neu vergeben.');
    openModal(`
        <h2 class="modal-title">${esc(m.tierName)} verlängern</h2>
        <p class="modal-sub">${esc(m.name)} · um ${tierPeriod(t)}${m.status === 'aktiv' && m.expiresAt ? ` ab dem ${esc(fmtDateOnly(String(m.expiresAt).slice(0, 10)))}` : ' ab heute'} · ${money(t.price)}</p>
        <form data-form="vip-renew" data-id="${m.id}" class="form-grid">
          <label class="check"><input type="checkbox" name="invoice" checked> Rechnung über ${money(t.price)} erstellen</label>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Verlängern</span></button></div>
        </form>`);
  },
  'vip-end': (el) => {
    const m = st.vip.memberships.find((x) => x.id === Number(el.dataset.id));
    if (!m) return;
    openModal(`
        <h2 class="modal-title">${esc(m.tierName)} beenden?</h2>
        <p class="modal-sub">${esc(m.name)} erhält den Rabatt danach nicht mehr; die Discord-Rolle wird entfernt. Bereits erstellte Rechnungen bleiben unverändert.</p>
        <form data-form="vip-end" data-id="${m.id}" class="form-grid">
          <div><label class="label">Grund <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="reason" class="field" maxlength="300" placeholder="z. B. Missbrauch, Charakter verstorben (CK), auf Wunsch"></div>
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">Beenden</button></div>
        </form>`);
  },
  'tier-new': async () => {
    openModal(tierForm());
    await loadTierRoles('');
  },
  'tier-edit': async (el) => {
    const t = st.vip.tiers.find((x) => x.id === Number(el.dataset.id));
    if (!t) return;
    openModal(tierForm(t));
    await loadTierRoles(t.discordRoleId);
  },
  'tier-delete': async (el) => {
    const t = st.vip.tiers.find((x) => x.id === Number(el.dataset.id));
    if (!t || !(await askDelete(`Stufe „${t.name}“ löschen?`, t.activeMembers ? `${t.activeMembers === 1 ? '1 aktive Mitgliedschaft behält' : `${t.activeMembers} aktive Mitgliedschaften behalten`} Name und Rabatt, lassen sich aber nicht mehr verlängern. Tipp: stattdessen „Aktiv“ abwählen.` : 'Die Stufe kann danach nicht mehr vergeben werden.'))) return;
    await api.del(`/api/memberships/tiers/${t.id}`);
    toast('Stufe gelöscht.');
    await refreshBehind();
  },

  // Namensänderung
  'name-withdraw': async (el) => {
    if (!(await ask('Der Antrag wird zurückgezogen.', { title: 'Antrag zurückziehen?', confirmText: 'Zurückziehen' }))) return;
    await api.del(`/api/name-requests/${el.dataset.id}`);
    toast('Antrag zurückgezogen.');
    await refreshBehind();
  },
  'install-app': async () => {
    if (!window.PSApp || !window.PSApp.canInstall()) {
      toast('Die Installation bietet Ihr Browser gerade nicht an – Anleitung unter „Mein Profil“.');
      return;
    }
    if (await window.PSApp.install()) toast('App installiert – Sie finden „Pake & Scha“ jetzt bei Ihren Programmen.');
  },
  'backup-restore': async (el) => {
    if (
      !(await ask(
        `Beim nächsten Neustart des Dienstes ersetzt die Sicherung „${el.dataset.name}“ die aktuelle Datenbank. Alles, was seitdem geändert wurde, ist danach nicht mehr da (die aktuelle Datenbank bleibt als Kopie erhalten); alle müssen sich neu anmelden.`,
        { title: 'Sicherung einspielen?', confirmText: 'Vormerken', danger: true }
      ))
    )
      return;
    st.backups = await api.post(`/api/admin/backups/${encodeURIComponent(el.dataset.name)}/restore`);
    toast('Vorgemerkt – jetzt den Dienst neu starten.');
    renderView();
  },
  'backup-cancel-restore': async () => {
    st.backups = await api.del('/api/admin/backups/pending');
    toast('Vormerkung aufgehoben – die aktuelle Datenbank bleibt.');
    renderView();
  },
  'google-resync': async (el) => {
    el.disabled = true;
    try {
      const r = await api.post('/api/google/resync', {});
      toast(`${r.queued} Google Docs werden neu geschrieben – das dauert einen Moment.`);
      st.google = await api.get('/api/google/status').catch(() => st.google);
      renderView();
    } finally {
      el.disabled = false;
    }
  },
  'google-disconnect': async () => {
    if (!(await ask('Vorhandene Google Docs bleiben im Drive und unter ihrem Link erreichbar, werden aber nicht mehr aktualisiert. Neue Docs lassen sich erst nach erneutem Verbinden anlegen.', { title: 'Google-Konto trennen?', confirmText: 'Trennen', danger: true }))) return;
    st.google = await api.post('/api/google/disconnect', {});
    toast('Google-Konto getrennt.');
    renderView();
  },
  'backup-now': async (el) => {
    el.disabled = true;
    try {
      const res = await api.post('/api/admin/backups', {});
      st.backups = res;
      toast(`Sicherung angelegt: ${res.backup.name}.`);
      renderView();
    } finally {
      el.disabled = false;
    }
  },
  'name-direct': (el) => {
    st.returnCase = el.dataset.returnCase ? Number(el.dataset.returnCase) : null;
    nameDirectModal({ userId: el.dataset.userId, name: el.dataset.name, email: el.dataset.email, role: el.dataset.role || 'mandant', rank: el.dataset.rank || '', returnCase: st.returnCase });
  },
  'names-filter': async (el) => {
    st.namesAll = el.dataset.value === 'alle';
    await refreshBehind();
  },
  'name-approve': async (el) => {
    const r = st.names.requests.find((x) => x.id === Number(el.dataset.id));
    if (!r || !(await ask(`${r.oldName} heißt danach überall „${r.newName}“ – im Konto, in Akten und (falls vorhanden) im Team-Profil der Website.`, { title: 'Namensänderung genehmigen?', confirmText: 'Genehmigen' }))) return;
    await api.post(`/api/name-requests/${r.id}/decide`, { approve: true });
    toast(`Genehmigt – ${r.newName}.`);
    st.lawyers = [];
    st.contacts = null;
    await refreshBehind();
  },
  'name-reject': (el) => {
    const r = st.names.requests.find((x) => x.id === Number(el.dataset.id));
    if (!r) return;
    openModal(`
        <h2 class="modal-title">Namensänderung ablehnen</h2>
        <p class="modal-sub">${esc(r.oldName)} → ${esc(r.newName)}. Der Grund wird der Person angezeigt.</p>
        <form data-form="name-reject" data-id="${r.id}" class="form-grid">
          <div><label class="label">Grund</label><input name="note" class="field" required maxlength="500" autofocus placeholder="z. B. Name bereits vergeben, bitte Vor- und Nachname"></div>
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">Ablehnen</button></div>
        </form>`);
  },
  'email-notice-ok': async () => {
    await api.post('/api/auth/email-notice');
    st.user.emailNotice = null;
    renderView();
  },

  // Kooperationen
  'coop-new': async () => {
    openModal(coopForm());
    await loadCoopRoles([]);
  },
  'rank-edit': (el) => openModal(rankForm(el.dataset.id ? (st.siteRanks || []).find((r) => r.id === Number(el.dataset.id)) : null)),
  'rank-move': async (el) => {
    st.siteRanks = (await api.post(`/api/site/ranks/${el.dataset.id}/move`, { dir: Number(el.dataset.dir) })).ranks;
    await refreshRanks();
    renderView();
  },
  'rank-delete': async (el) => {
    const r = (st.siteRanks || []).find((x) => x.id === Number(el.dataset.id));
    if (!r || !(await askDelete(`Rang „${r.name}“ löschen?`, 'Er verschwindet von der Startseite und aus allen Auswahllisten. Löschen geht nur, wenn niemand mehr diesen Rang hat.'))) return;
    st.siteRanks = (await api.del(`/api/site/ranks/${r.id}`)).ranks;
    await refreshRanks();
    toast('Rang gelöscht.');
    renderView();
  },
  'weekly-report-test': async () => {
    await api.post('/api/admin/weekly-report/test');
    toast('Wochenbericht an dein Discord gesendet.');
  },
  'site-text-reset': async (el) => {
    await api.del(`/api/site/texts/${encodeURIComponent(el.dataset.page)}/${encodeURIComponent(el.dataset.key)}`);
    st.siteTexts = (await api.get('/api/site/texts')).texts;
    toast('Originaltext wiederhergestellt.');
    renderView();
  },
  'onboarding-tick': async (el) => {
    await api.patch(`/api/onboarding/items/${el.dataset.id}`, { done: el.checked });
    await refreshOnboarding();
  },
  'onboarding-start': async () => {
    const sel = $('#obCandidate');
    if (!sel || !sel.value) return;
    await api.post('/api/onboarding', { userId: Number(sel.value) });
    toast('Einarbeitung begonnen.');
    await refreshOnboarding();
  },
  'onboarding-mentor': async (el) => {
    await api.patch(`/api/onboarding/${el.dataset.user}`, { mentorId: el.value ? Number(el.value) : null });
    toast('Mentor gespeichert.');
    await refreshOnboarding();
  },
  'onboarding-end': async (el) => {
    if (!(await askDelete(`Einarbeitung von ${el.dataset.name} beenden?`, 'Die Checkliste wird entfernt.'))) return;
    await api.del(`/api/onboarding/${el.dataset.user}`);
    await refreshOnboarding();
  },
  'coop-edit': async (el) => {
    const k = st.coops.cooperations.find((x) => x.id === Number(el.dataset.id));
    if (!k) return;
    openModal(coopForm(k));
    await loadCoopRoles(k.roles.map((r) => r.id));
  },
  'coop-load-roles': () => loadCoopRoles(),
  'coop-delete': async (el) => {
    const k = st.coops.cooperations.find((x) => x.id === Number(el.dataset.id));
    if (!k || !(await askDelete(`Kooperation „${k.name}“ löschen?`, 'Neue Rechnungen erhalten den Rabatt dann nicht mehr. Bereits erstellte Rechnungen behalten ihn. Tipp: Zum Pausieren stattdessen „Aktiv“ abwählen.'))) return;
    await api.del(`/api/cooperations/${k.id}`);
    toast('Kooperation gelöscht.');
    await refreshBehind();
  },
  'coop-accounts': async (el) => {
    const k = el.dataset.id ? st.coops.cooperations.find((x) => x.id === Number(el.dataset.id)) : null;
    openModal(coopAccountsDialog(el.dataset.mode, k));
    await searchCoopAccounts($('#coopAccSearch'));
  },
  'coop-member-add': async (el) => {
    await api.post(`/api/cooperations/${el.dataset.id}/members`, { userId: Number(el.dataset.user) });
    toast(`${el.dataset.name} zugeordnet.`);
    await modalBack();
    await refreshBehind();
  },
  'coop-member-remove': async (el) => {
    if (!(await ask(`${el.dataset.name} erhält den Rabatt dann nur noch, wenn die Discord-Rolle passt.`, { title: 'Zuordnung entfernen?', confirmText: 'Entfernen' }))) return;
    await api.del(`/api/cooperations/${el.dataset.id}/members/${el.dataset.user}`);
    toast('Zuordnung entfernt.');
    await refreshBehind();
  },
  'coop-check': async (el) => {
    const box = $('#coopCheckResult');
    box.innerHTML = '<p class="text-sm text-dim">Wird geprüft …</p>';
    const r = await api.get(`/api/cooperations/detect?userId=${el.dataset.user}`);
    box.innerHTML = coopDetectHtml(r, el.dataset.name);
  },
  'case-client-search': async (el) => {
    const id = Number(el.dataset.id);
    const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : (await api.get('/api/cases/' + id)).case;
    const { accounts } = await api.get(`/api/cases/client-accounts?caseId=${id}`);
    st.returnCase = id;
    openModal(clientSearchDialog(c, accounts));
  },
  'case-link-client': async (el) => {
    const id = Number(el.dataset.id);
    const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null;
    const msg = `${el.dataset.name} sieht die Akte${c ? ` ${c.caseNumber}` : ''} danach unter „Meine Akten“ – mit Terminen, Verträgen, Rechnungen, Nachrichten und (falls eingerichtet) dem Discord-Ticket. Interne Notizen bleiben intern.${c && c.hasClientAccount ? ` Das bisherige Konto (${c.clientName}) verliert den Zugriff.` : ''}`;
    if (!(await ask(msg, { title: 'Mandanten-Konto verknüpfen?', confirmText: 'Verknüpfen' }))) return;
    const fromDialog = !!$('#clientAccSearch');
    await api.put(`/api/cases/${id}/client`, { clientId: Number(el.dataset.client) });
    toast(`Konto von ${el.dataset.name} mit der Akte verknüpft.`);
    if (fromDialog) {
      st.returnCase = null;
      await openCase(id);
      refreshBehind();
    } else await reloadCase(id);
  },
  'case-unlink-client': async (el) => {
    const id = Number(el.dataset.id);
    const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null;
    if (!(await askDelete('Verknüpfung lösen?', `${c ? c.clientName : 'Der Mandant'} sieht die Akte danach nicht mehr im Portal. Der Name bleibt in der Akte eingetragen.`, 'Verknüpfung lösen'))) return;
    await api.put(`/api/cases/${id}/client`, { clientId: null });
    toast('Verknüpfung gelöst.');
    await reloadCase(id);
  },
  'scroll-to': (el) => {
    $('#' + el.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (el.closest('.case-jump')) {
      caseJumpPinned = el.dataset.target; // Reiter bleibt markiert, bis man selbst scrollt
      markCaseJump();
    }
  },

  // FiveNet-Dokumente
  'fn-add': async () => {
    if (!st.caseInfo) return;
    st.returnCase = st.caseInfo.id;
    await load.fivenet();
    resetPending();
    openModal(externalForm('fivenet', null, st.caseInfo));
    // Übergabe aus dem FiveNet-Skript: Bilder vormerken, Dokument-ID prüfen lassen
    if (st.fnPrefill) {
      if (st.fnPrefill.imageUrls.length) addPendingImages({ urls: st.fnPrefill.imageUrls });
      const input = $('#fnInput');
      if (input && input.value) checkFivenetInput(input);
      st.fnPrefill = null;
    }
  },
  // Übergabe aus dem FiveNet-Skript: gewählte Akte öffnen, dann das vorbelegte Formular
  'fn-import-case': async (el) => {
    const pre = st.fnImport;
    if (!pre) return;
    st.fnImport = null;
    await openCase(Number(el.dataset.id));
    st.fnPrefill = pre;
    await actions['fn-add']();
  },
  'tpl-new': () => openModal(templateForm(null), { wide: true }),
  'tpl-edit': (el) => {
    const x = st.contractTemplates.templates.find((t) => t.id === Number(el.dataset.id));
    if (x) openModal(templateForm(x), { wide: true });
  },
  'settings-tab': async (el) => {
    st.settingsTab = el.dataset.tab;
    history.replaceState(history.state, '', `${location.pathname}?tab=${st.settingsTab}#settings`);
    if (st.settingsTab === 'bot' && st.bot && !st.botDiscord) await loadBotDiscord();
    renderView();
    // Inhalt unter den Reitern weich wechseln
    for (let n = $('.settings-tabs') && $('.settings-tabs').nextElementSibling; n; n = n.nextElementSibling) playIn(n, 'swap-in');
  },
  'bot-module': async (el) => {
    st.botModule = el.dataset.module;
    if (st.botModule === 'messages' && !st.botMessages) await loadBotMessages();
    renderView();
    const main = $('.bot-main');
    if (main && main.getBoundingClientRect().top < 0) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'bot-refresh-discord': async () => {
    await loadBotDiscord(true);
    st.bot = await api.get('/api/bot');
    renderView();
    if (st.botDiscord.error) toast(st.botDiscord.error, 'error');
    else toast(`${st.botDiscord.roles.length} Rollen und ${st.botDiscord.channels.length} Kanäle geladen.`);
  },
  'bot-reconnect': async () => {
    st.bot = await api.post('/api/bot/reconnect', {});
    renderView();
    toast('Verbindung wird neu aufgebaut …');
    setTimeout(() => guard(async () => {
      st.bot = await api.get('/api/bot');
      if (st.view === 'settings') renderView();
    }), 3500);
  },
  'bot-scan': async (el) => {
    el.disabled = true;
    toast('Abgleich läuft – das kann bei vielen Mitgliedern kurz dauern …');
    const r = await api.post('/api/bot/scan', {});
    st.bot = r;
    const s = r.stats || {};
    renderView();
    if (s.error) toast(s.error, 'error');
    else toast(`Abgleich fertig: ${s.members} Mitglieder geprüft, ${s.added} Rollen vergeben, ${s.removed} entfernt${(s.errors || []).length ? ` – ${s.errors.length} Fehler (siehe Übersicht)` : ''}.`, (s.errors || []).length ? 'error' : 'ok');
  },
  'rc-add-rule': (el) => {
    const list = $('#rcList');
    list.insertAdjacentHTML('beforeend', rcRuleHtml({}));
    el.disabled = list.querySelectorAll('.rc-rule').length >= st.bot.limits.rules;
    list.lastElementChild.querySelector('select').focus();
  },
  'rc-del-rule': (el) => {
    el.closest('.rc-rule').remove();
    const add = $('[data-action="rc-add-rule"]');
    if (add) add.disabled = false;
  },
  'rc-add-cond': (el) => {
    const rule = el.closest('.rc-rule');
    const conds = rule.querySelector('.rc-conds');
    conds.insertAdjacentHTML('beforeend', rcCondHtml({}, conds.children.length));
    rcRenumber(rule);
  },
  'rc-del-cond': (el) => {
    const rule = el.closest('.rc-rule');
    if (rule.querySelectorAll('.rc-cond').length <= 1) return toast('Eine Regel braucht mindestens eine Bedingung – sonst die ganze Regel löschen.', 'error');
    el.closest('.rc-cond').remove();
    rcRenumber(rule);
  },
  'wl-insert': (el) => insertTemplateText(el.closest('form'), el.dataset.text),
  'bot-join-apply': async (el) => {
    const bots = el.dataset.target === 'bots';
    const form = el.closest('form');
    if (!(await ask(`Alle ${bots ? 'Bots' : 'Mitglieder'}, die schon auf dem Server sind, bekommen die ausgewählten Join Roles. Fehlende Rollen werden ergänzt, nichts wird entfernt. Die Einstellungen werden vorher gespeichert.`, { title: 'Join Roles an alle vergeben?', confirmText: 'Speichern & vergeben' }))) return;
    st.bot = await api.put('/api/bot/join-roles', botJoinRolesBody(form));
    const r = await api.post('/api/bot/join-roles/apply', { target: el.dataset.target });
    st.bot = r;
    renderView();
    const x = r.stats;
    toast(`${nWord(x.added, 'Rolle', 'Rollen')} an ${bots ? nWord(x.changed, 'Bot', 'Bots') : nWord(x.changed, 'Mitglied', 'Mitglieder')} vergeben${x.skipped ? ` · ${x.skipped} warten noch auf die Regel-Bestätigung` : ''}${x.errors.length ? ` · ${x.errors.length} Fehler (siehe Übersicht)` : ''}.`, x.errors.length ? 'error' : 'ok');
  },
  'msg-new': () => {
    st.msgId = null;
    st.msgTab = 'edit';
    openModal(msgModal(null), { wide: true });
  },
  'msg-open': async (el) => {
    if (!st.botMessages) await loadBotMessages();
    st.msgId = Number(el.dataset.id);
    st.msgTab = el.dataset.tab || 'edit';
    const t = msgCurrent();
    if (t) openModal(msgModal(t), { wide: true });
  },
  'msg-tab': (el) => {
    st.msgTab = el.dataset.tab;
    $$('.msg-tabs .chip').forEach((c) => c.classList.toggle('active', c.dataset.tab === st.msgTab));
    $$('[data-msg-pane]').forEach((pane) => (pane.hidden = pane.dataset.msgPane !== st.msgTab));
    const t = msgCurrent();
    if (st.msgTab === 'use' && t) $('#msgUse').innerHTML = msgUse(t);
  },
  'msg-use-tab': (el) => {
    st.msgUseTab = el.dataset.tab;
    const t = msgCurrent();
    if (t) $('#msgUse').innerHTML = msgUse(t);
  },
  // Per Direktnachricht an alle Mitglieder einer Rolle
  'dm-preview': async (el) => {
    const role = $('#dmRole').value.trim();
    if (!role) throw new Error('Bitte eine Rolle wählen.');
    st.dmRole = role;
    el.disabled = true;
    try {
      st.dmPreview = await api.get(`/api/bot/messages/${el.dataset.id}/dm?roleId=${encodeURIComponent(role)}`);
      const t = msgCurrent();
      if (t) $('#dmPreview').innerHTML = dmPreviewHtml(st.dmPreview, t);
    } finally {
      el.disabled = false;
    }
  },
  'dm-send': async (el) => {
    const p = st.dmPreview;
    const t = msgCurrent();
    if (!p || !t) return;
    const withLogin = $('#dmLogin').checked;
    st.dmLogin = withLogin;
    const byId = new Map(p.members.map((m) => [m.id, m]));
    const picked = $$('#dmPreview .dm-pick').filter((x) => x.checked).map((x) => byId.get(x.value)).filter(Boolean);
    if (!picked.length) throw new Error('Bitte mindestens ein Mitglied auswählen.');
    // Neue Website-Konten: geprüfter Name aus dem Feld
    const recipients = picked.map((m) => {
      const input = withLogin && m.account === 'keins' ? $(`#dmPreview .dm-newname[data-id="${m.id}"]`) : null;
      const name = input ? input.value.trim() : '';
      if (input && name.length < 2) {
        input.focus();
        throw new Error(`Bitte für ${m.name} einen Namen für das Website-Konto eintragen (mindestens 2 Zeichen).`);
      }
      return name ? { id: m.id, name } : { id: m.id };
    });
    const created = withLogin ? picked.filter((m) => m.account === 'keins').length : 0;
    const existing = withLogin ? picked.filter((m) => m.account === 'vorhanden').length : 0;
    const extra = withLogin ? ` Dazu bekommt jeder seinen Website-Zugang: ${existing} vorhandene Konten (Passwort bleibt), ${created} neue Mandantenkonten mit Einmal-Passwort.` : '';
    if (!(await ask(`„${t.name}“ geht als Direktnachricht an ${picked.length} Mitglied${picked.length === 1 ? '' : 'er'} mit der Rolle @${p.role.name} – nacheinander, etwa ${nWord(Math.max(1, Math.ceil((picked.length * 1.5) / 60)), 'Minute', 'Minuten')}.${extra}`, { title: 'Direktnachrichten senden?', confirmText: 'Senden' }))) return;
    el.disabled = true;
    try {
      const r = await api.post(`/api/bot/messages/${t.id}/dm`, { roleId: p.role.id, withLogin, recipients });
      st.dmPreview = null;
      st.dmRuns = r.runs;
      st.dmRunsFor = t.id;
      $('#dmPreview').innerHTML = '';
      $('#dmRuns').innerHTML = dmRunsHtml(r.runs);
      toast(`Versand an ${r.run.total} Mitglied${r.run.total === 1 ? '' : 'er'} gestartet.`);
      st.dmTimer = setTimeout(() => guard(() => refreshDmRuns(t.id)), 2000);
    } finally {
      el.disabled = false;
    }
  },
  'dm-cancel': async (el) => {
    if (!(await ask('Wer schon eine Nachricht bekommen hat, behält sie. Der Rest bekommt keine mehr.', { title: 'Versand abbrechen?', confirmText: 'Abbrechen', danger: true }))) return;
    const r = await api.post(`/api/bot/dm-runs/${el.dataset.rid}/cancel`, {});
    toast(r.cancelled ? 'Versand wird abgebrochen.' : 'Der Versand war schon beendet.');
    const t = msgCurrent();
    if (t) await refreshDmRuns(t.id);
  },
  'msg-delete': async (el) => {
    const t = st.botMessages.templates.find((x) => x.id === Number(el.dataset.id));
    if (!t) return;
    if (!(await askDelete(`„${t.name}“ löschen?`, `${t.jobs.length ? `${t.jobs.length === 1 ? 'Auch die Automatik dieser Vorlage endet. ' : `Auch die ${t.jobs.length} Automatiken dieser Vorlage enden. `}` : ''}Bereits gesendete Nachrichten bleiben in Discord.`, 'Löschen'))) return;
    msgRefresh(await api.del(`/api/bot/messages/${t.id}`));
    renderView();
    toast('Vorlage gelöscht.');
  },
  'msg-add-field': () => {
    const list = $('#msgFields');
    if (list.children.length >= 10) return toast('Höchstens 10 Felder.', 'error');
    list.insertAdjacentHTML('beforeend', msgFieldRow({}));
    list.lastElementChild.querySelector('input').focus();
  },
  'msg-add-button': () => {
    const list = $('#msgButtons');
    if (list.children.length >= 5) return toast('Höchstens 5 Buttons.', 'error');
    list.insertAdjacentHTML('beforeend', msgButtonRow({}));
    list.lastElementChild.querySelector('input').focus();
  },
  'msg-del-row': (el) => {
    const form = el.closest('form');
    el.closest('.mf-row, .mb-row').remove();
    updateMsgPreview(form);
  },
  'msg-send': async (el) => {
    const ch = $('#msgSendChannel').value.trim();
    if (!ch) throw new Error('Bitte einen Kanal wählen.');
    st.msgLastChannel = ch;
    el.disabled = true;
    try {
      msgRefresh(await api.post(`/api/bot/messages/${el.dataset.id}/send`, { channelId: ch }));
      toast(`Gesendet in ${channelName(ch)}.`);
    } finally {
      el.disabled = false;
    }
  },
  'msg-sent-update': async (el) => {
    try {
      msgRefresh(await api.post(`/api/bot/messages/${el.dataset.id}/sent/${el.dataset.sid}/update`, {}));
      toast('Nachricht in Discord aktualisiert.');
    } catch (e) {
      await loadBotMessages();
      msgRefresh({ ...st.botMessages });
      throw e;
    }
  },
  'msg-sent-delete': async (el) => {
    if (!(await askDelete('Nachricht in Discord löschen?', 'Sie wird im Kanal entfernt. Die Vorlage bleibt erhalten.', 'Löschen'))) return;
    msgRefresh(await api.del(`/api/bot/messages/${el.dataset.id}/sent/${el.dataset.sid}`));
    toast('In Discord gelöscht.');
  },
  'msg-job-add': async (el) => {
    const kind = el.dataset.kind;
    let body;
    if (kind === 'zeitplan') {
      const ch = $('#jobChannelZ').value.trim();
      const start = $('#jobStart').value;
      if (!ch) throw new Error('Bitte einen Kanal wählen.');
      if (!start) throw new Error('Bitte Datum und Uhrzeit für den ersten Versand angeben.');
      const minutes = (Number($('#jobEvery').value) || 0) * Number($('#jobUnit').value);
      if (minutes < st.botMessages.limits.minInterval) throw new Error(`Bitte mindestens alle ${st.botMessages.limits.minInterval} Minuten.`);
      body = { kind, channelId: ch, startAt: new Date(start).toISOString(), intervalMinutes: minutes, replacePrevious: $('#jobReplaceZ').checked };
    } else {
      const ch = $('#jobChannelN').value.trim();
      if (!ch) throw new Error('Bitte einen Kanal wählen.');
      body = { kind, channelId: ch, everyMessages: Number($('#jobMessages').value) || 0, replacePrevious: $('#jobReplaceN').checked };
    }
    st.msgLastChannel = body.channelId;
    msgRefresh(await api.post(`/api/bot/messages/${el.dataset.id}/jobs`, body));
    toast(kind === 'zeitplan' ? 'Zeitplan angelegt.' : 'Automatik angelegt – der Bot zählt ab jetzt mit.');
  },
  'msg-job-toggle': async (el) => {
    msgRefresh(await api.patch(`/api/bot/messages/jobs/${el.dataset.id}`, { enabled: el.dataset.on === '1' }));
  },
  'msg-job-delete': async (el) => {
    if (!(await askDelete('Automatik löschen?', 'Es wird nichts mehr automatisch gepostet. Bereits gesendete Nachrichten bleiben.', 'Löschen'))) return;
    msgRefresh(await api.del(`/api/bot/messages/jobs/${el.dataset.id}`));
    toast('Automatik gelöscht.');
  },
  'bot-welcome-test': async (el) => {
    const form = $('#welcomeForm');
    st.bot = await api.put('/api/bot/welcome', botWelcomeBody(form));
    const r = await api.post('/api/bot/welcome/test', { kind: el.dataset.kind });
    toast(`Gespeichert und Testnachricht gesendet – ${r.where}.`);
  },
  'tpl-insert': (el) => {
    const area = $('#tplBody');
    if (!area) return;
    area.focus();
    area.setRangeText(el.dataset.text, area.selectionStart, area.selectionEnd, 'end');
  },
  'tpl-reset': async (el) => {
    if (!(await ask('Der Text wird auf die mitgelieferte Fassung (nach eurer Google-Docs-Vorlage) zurückgesetzt. Bereits erstellte Verträge bleiben unverändert.', { title: 'Original wiederherstellen?', confirmText: 'Zurücksetzen' }))) return;
    await api.post(`/api/contract-templates/${el.dataset.id}/reset`, {});
    toast('Vorlage zurückgesetzt.');
    await refreshSettingsTemplates();
  },
  'tpl-delete': async (el) => {
    const x = st.contractTemplates.templates.find((t) => t.id === Number(el.dataset.id));
    if (!x || !(await askDelete(`Vorlage „${x.name}“ löschen?`, 'Bereits erstellte Verträge behalten ihren Text. Tipp: Statt zu löschen kann man die Vorlage auch auf „inaktiv“ setzen.', 'Löschen'))) return;
    await api.del(`/api/contract-templates/${x.id}`);
    toast('Vorlage gelöscht.');
    await refreshSettingsTemplates();
  },
  'work-days': async (el) => {
    st.workDays = Number(el.dataset.days);
    await views.work.load();
    renderView();
  },
  // Board-Ticket einer Bewerbung / eines Anliegens
  'board-ticket-sync': async (el) => {
    el.disabled = true;
    const { kind, id } = el.dataset;
    try {
      await api.post(`/api/tickets/board/${kind}/${id}/sync`, {});
      toast('Board-Ticket abgeglichen.');
    } finally {
      if (kind === 'application') await openApplication(Number(id));
      else await openConcern(Number(id));
    }
  },
  // Discord-Ticket einer Akte
  // Beitrittslink für den Mandanten: in die Zwischenablage (Handy im Spiel) und – mit Konto – als Nachricht in die Akte
  'client-join-link': async (el) => {
    const id = Number(el.dataset.id);
    const { url, text } = await api.get(`/api/cases/${id}/join-link`);
    const ok = await copy(text);
    const hasAccount = st.caseInfo && st.caseInfo.id === id && st.caseInfo.hasClientAccount;
    toast(ok ? 'Beitrittslink kopiert.' : `Link: ${url}`, 'ok', {
      duration: 9000,
      ...(hasAccount
        ? {
            action: {
              label: 'Als Nachricht senden',
              onClick: () =>
                guard(async () => {
                  await api.post(`/api/cases/${id}/notes`, { body: text, internal: false });
                  toast('Nachricht an den Mandanten gesendet.');
                  await reloadCase(id);
                }),
            },
          }
        : {}),
    });
  },
  'ticket-sync': async (el) => {
    el.disabled = true;
    try {
      const r = await api.post(`/api/tickets/cases/${el.dataset.id}/sync`, {});
      toast(r.ticket && r.ticket.exists ? (isStaff() ? 'Discord-Ticket abgeglichen.' : r.ticket.clientInTicket ? 'Sie sind im Discord-Ticket.' : 'Noch nicht auf dem Discord-Server der Kanzlei.') : 'Discord-Ticket wird angelegt …');
    } finally {
      await reloadCase(Number(el.dataset.id));
    }
  },
  'tickets-test': async () => {
    st.ticketTest = { running: true };
    renderView();
    try {
      const r = await api.post('/api/tickets/test', {});
      st.ticketTest = r;
      st.ticketSettings = r.status;
    } catch (e) {
      st.ticketTest = null;
      throw e;
    } finally {
      renderView();
    }
  },
  'tickets-backfill': async () => {
    if (!(await ask('Für alle offenen Akten, Bewerbungen und Anliegen ohne Discord-Ticket wird jetzt ein Kanal angelegt.', { title: 'Tickets nachholen?', confirmText: 'Anlegen' }))) return;
    const r = await api.post('/api/tickets/backfill', {});
    st.ticketSettings = r.status;
    toast(`${r.created} von ${r.total} Tickets angelegt (Akten, Bewerbungen, Anliegen)${r.panels ? ` · ${r.panels} bestehende Tickets abgeglichen` : ''}.`);
    renderView();
  },

  // Anliegen an das Board of Partners
  'concern-new': () => concernNewModal(),
  'concern-open': (el) => openConcern(Number(el.dataset.id)),
  'concern-filter': (el) => {
    st.concernFilter = el.dataset.value;
    renderView();
  },
  'concern-group': (el) => {
    st.concernGroup = el.dataset.value;
    renderView();
  },
  'concern-withdraw': async (el) => {
    if (!(await ask('Das Anliegen wird gelöscht – das Board hat noch nicht darauf reagiert.', { title: 'Anliegen zurückziehen?', confirmText: 'Zurückziehen', danger: true }))) return;
    await api.del('/api/concerns/' + el.dataset.id);
    toast('Anliegen zurückgezogen.');
    await modalBack();
    await Promise.all([refreshBehind(), load.concernCount().then(renderNav)]);
  },
  'concern-delete': async (el) => {
    if (!(await ask('Das Anliegen samt Verlauf wird endgültig gelöscht.', { title: 'Anliegen löschen?', confirmText: 'Löschen', danger: true }))) return;
    await api.del('/api/concerns/' + el.dataset.id);
    toast('Anliegen gelöscht.');
    await modalBack();
    await Promise.all([refreshBehind(), load.concernCount().then(renderNav)]);
  },
  // Beförderungen & Einstellungen
  'personnel-promote': () => promoteModal(),
  'personnel-delete': async (el) => {
    if (!(await ask('Der Eintrag verschwindet aus dem Protokoll. Der aktuelle Rang bleibt unverändert.', { title: 'Eintrag entfernen?', confirmText: 'Entfernen', danger: true }))) return;
    await api.del('/api/personnel/' + el.dataset.id);
    toast('Eintrag entfernt.');
    await refreshBehind();
  },

  'absence-new': async () => {
    closeDutyPop();
    await absenceModal();
  },
  'absence-return': async (el) => {
    if (!(await ask('Die Abmeldung endet heute.', { title: 'Zurückmelden?', confirmText: 'Zurückmelden' }))) return;
    await api.post(`/api/absences/${el.dataset.id}/return`, {});
    toast('Willkommen zurück – Rückmeldung eingetragen.');
    await afterAbsenceChange();
  },
  'absence-delete': async (el) => {
    if (!(await ask('Die Abmeldung wird entfernt.', { title: 'Abmeldung zurückziehen?', confirmText: 'Zurückziehen' }))) return;
    await api.del(`/api/absences/${el.dataset.id}`);
    toast('Abmeldung zurückgezogen.');
    await afterAbsenceChange();
  },
  'contract-new': async (el) => {
    if (!st.caseInfo) return;
    const c = st.caseInfo;
    st.returnCase = c.id;
    const [{ templates: all }, defaults] = await Promise.all([api.get('/api/contract-templates'), api.get(`/api/cases/${c.id}/contracts/defaults`), load.lawyers(), load.fees()]);
    const templates = all.filter((t) => t.kind !== 'schriftsatz');
    if (!templates.length) throw new Error('Es gibt keine aktive Vertragsvorlage. Das Board of Partners kann sie im Kanzlei-Wiki unter „Verträge & Schriftsätze“ anlegen.');
    openModal(contractForm(c, { templates, defaults }));
  },
  'brief-new': async () => {
    if (!st.caseInfo) return;
    const c = st.caseInfo;
    st.returnCase = c.id;
    const [{ templates: all }, defaults] = await Promise.all([api.get('/api/contract-templates'), api.get(`/api/cases/${c.id}/contracts/defaults`), load.lawyers()]);
    st.briefTemplates = all.filter((t) => t.kind === 'schriftsatz');
    if (!st.briefTemplates.length) throw new Error('Es gibt keine aktive Schriftsatz-Vorlage. Das Board of Partners kann sie im Kanzlei-Wiki unter „Verträge & Schriftsätze“ anlegen (Art „Schriftsatz“).');
    openModal(briefForm(c, { templates: st.briefTemplates, defaults }));
    syncBriefForm($('form[data-form="brief-new"]'));
  },
  // FiveNet-Dokument der Akte als Aktenzeichen übernehmen („DOC - 74412“)
  'brief-fivenet': (el) => {
    const input = $('#bf_fivenet_az');
    if (!input) return;
    input.value = el.dataset.ref;
    input.focus();
  },
  'brief-edit': async (el) => {
    const k = (st.caseContracts || []).find((x) => x.id === Number(el.dataset.id));
    if (!k || !st.caseInfo) return;
    st.returnCase = st.caseInfo.id;
    const [full, defaults] = await Promise.all([api.get(`/api/contracts/${k.id}`), api.get(`/api/cases/${st.caseInfo.id}/contracts/defaults`), load.lawyers()]);
    k.body = full.contract.body;
    openModal(briefForm(st.caseInfo, { templates: [], defaults, k }));
    syncBriefForm($('form[data-form="brief-edit"]'));
  },
  'brief-visibility': async (el) => {
    const k = (st.caseContracts || []).find((x) => x.id === Number(el.dataset.id));
    if (!k) return;
    if (k.internal && !(await ask(`„${k.templateName}“ wird im Mandantenportal sichtbar, und im Ticket erscheint ein Hinweis.`, { title: 'Für den Mandanten freigeben?', confirmText: 'Freigeben' }))) return;
    await api.patch(`/api/contracts/${k.id}`, { internal: !k.internal });
    toast(k.internal ? 'Für den Mandanten freigegeben.' : 'Nur noch für die Kanzlei sichtbar.');
    await reloadCase(Number(el.dataset.caseId));
  },
  'contract-edit': async (el) => {
    const k = (st.caseContracts || []).find((x) => x.id === Number(el.dataset.id));
    if (!k || !st.caseInfo) return;
    st.returnCase = st.caseInfo.id;
    const [defaults] = await Promise.all([api.get(`/api/cases/${st.caseInfo.id}/contracts/defaults`), load.lawyers(), load.fees()]);
    openModal(contractForm(st.caseInfo, { templates: [], defaults, k }));
  },
  // Deal-Rechner
  'deal-new': (el) => {
    st.returnCase = Number(el.dataset.id);
    openModal(dealForm(Number(el.dataset.id)));
  },
  'deal-answer': async (el) => {
    const accept = el.dataset.accept === '1';
    const staff = isStaff();
    if (!(await ask(staff ? `Hat der Mandant das Angebot im Spiel ${accept ? 'angenommen' : 'abgelehnt'}? Das wird mit Ihrem Namen in der Akte vermerkt.` : `Möchten Sie das Angebot wirklich ${accept ? 'annehmen' : 'ablehnen'}? Ihre Antwort wird in der Akte festgehalten.`, { title: accept ? 'Angebot annehmen' : 'Angebot ablehnen', confirmText: accept ? 'Annehmen' : 'Ablehnen' }))) return;
    await api.post(`/api/cases/${el.dataset.caseId}/deals/${el.dataset.id}/answer`, { accept });
    toast(accept ? 'Angebot angenommen – die Kanzlei ist informiert.' : 'Angebot abgelehnt – die Kanzlei ist informiert.');
    await reloadCase(Number(el.dataset.caseId));
  },
  'deal-withdraw': async (el) => {
    await api.del(`/api/cases/${el.dataset.caseId}/deals/${el.dataset.id}`);
    toast('Angebot zurückgezogen.');
    await reloadCase(Number(el.dataset.caseId));
  },
  // Fertigen Schriftsatz ins Prozessticket (DOJ-Kanal): Bot postet – oder Text kopieren und Kanal öffnen
  'brief-to-process': async (el) => {
    const r = await api.post(`/api/contracts/${el.dataset.id}/process-ticket`);
    if (r.posted) return toast('Im Prozessticket eingereicht – mit Dokument-Link.');
    await window.PS.copy(r.text);
    window.open(r.channelUrl, '_blank', 'noopener');
    toast('Der Bot ist nicht auf diesem Discord – Text mit Dokument-Link kopiert. Im Prozessticket einfach einfügen (Strg+V).');
  },
  'contract-record': async (el) => {
    const k = (st.caseContracts || []).find((x) => x.id === Number(el.dataset.id));
    if (!k) return;
    if (!(await ask(`Bitte nur bestätigen, wenn ${k.data.mandant || 'der Mandant'} ${k.kind === 'schriftsatz' ? 'das Dokument' : 'den Vertrag'} im Spiel tatsächlich unterschrieben hat. Die Erfassung wird mit Ihrem Namen im Aktenverlauf vermerkt.`, { title: 'Unterschrift des Mandanten erfassen?', confirmText: 'Erfassen' }))) return;
    const r = await api.post(`/api/contracts/${k.id}/sign`, { as: 'erfassen' });
    toast('Unterschrift des Mandanten erfasst.');
    await reloadCase(Number(el.dataset.caseId));
  },
  'contract-delete': async (el) => {
    const k = (st.caseContracts || []).find((x) => x.id === Number(el.dataset.id));
    if (!k) return;
    const signedMsg =
      k.kind === 'schriftsatz'
        ? 'Das Dokument ist bereits unterschrieben. Es wird endgültig entfernt; im Aktenverlauf bleibt ein Vermerk.'
        : 'Der Vertrag ist bereits unterschrieben. Er wird endgültig entfernt; im Aktenverlauf bleibt ein Vermerk.';
    if (!(await askDelete(`${k.templateName} löschen?`, k.locked ? signedMsg : 'Der Entwurf wird entfernt.', 'Löschen'))) return;
    await api.del(`/api/contracts/${k.id}`);
    toast(k.kind === 'schriftsatz' ? 'Schriftsatz gelöscht.' : 'Vertrag gelöscht.');
    await reloadCase(Number(el.dataset.caseId));
  },
  'gd-add': async (el) => {
    if (!st.caseInfo) return;
    st.returnCase = st.caseInfo.id;
    await load.fivenet(); // Vorschläge für Dokumentarten
    resetPending();
    openModal(externalForm(el.dataset.provider === 'gsheets' ? 'gsheets' : 'gdocs', null, st.caseInfo));
  },
  'fn-edit': async (el) => {
    const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
    if (!d || !st.caseInfo) return;
    st.returnCase = st.caseInfo.id;
    await load.fivenet();
    resetPending();
    openModal(externalForm(EXT[d.provider] ? d.provider : 'fivenet', d, st.caseInfo));
    if (el.dataset.focus) {
      const target = $('#' + el.dataset.focus);
      target?.scrollIntoView({ block: 'center' });
      target?.focus();
    }
    if (el.dataset.reload && extOf(d).google) await loadGoogleDoc(d.url, { replace: true });
  },
  'gd-reload': (el) => loadGoogleDoc(el.dataset.url, { replace: true }),
  'fn-img-remove': (el) => {
    const i = Number(el.dataset.index);
    if (el.dataset.kind === 'url') st.fnPending.urls.splice(i, 1);
    else st.fnPending.blobs.splice(i, 1);
    renderPending();
  },
  'fn-copy-text': async (el) => {
    const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
    if (!d) return;
    const ok = await copy(PS.transcriptPlain(d.contentText));
    toast(ok ? 'Abschrift kopiert.' : 'Kopieren nicht möglich.', ok ? 'ok' : 'error');
  },
  'fn-delete': async (el) => {
    const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
    if (!d || !(await askDelete('Verknüpfung entfernen?', `${extOf(d).noun}${d.title ? ` „${d.title}“` : ''} wird aus der Akte entfernt. Das Original bleibt unverändert, übernommene Bilder bleiben als Beweismittel in der Akte.`, 'Entfernen'))) return;
    const caseId = Number(el.dataset.caseId);
    await api.del(extUrl(caseId, d.id));
    toast('Verknüpfung entfernt.');
    await reloadCase(caseId);
  },
  'fn-cite': async (el) => {
    const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
    if (!d) return;
    const ok = await copy(externalCitation(d));
    toast(ok ? 'Zitat kopiert – z. B. für Schriftsätze oder Nachrichten.' : 'Kopieren nicht möglich.', ok ? 'ok' : 'error');
  },
  'fn-check': async () => {
    const box = $('#fnCheckResult');
    if (box) box.innerHTML = '<span class="text-dim">Prüfe …</span>';
    const r = await api.post('/api/fivenet/check');
    if (!box || !box.isConnected) return;
    box.innerHTML = r.result.reachable
      ? `<span class="text-emerald-300">✓ ${esc(r.instance.host)} ist erreichbar – FiveNet ${esc(r.result.version)}</span>`
      : `<span class="text-amber-300">${esc(r.instance.host)} antwortet nicht wie erwartet (${esc(r.result.detail || 'unbekannt')}). Verknüpfen funktioniert trotzdem – die Kanzlei ruft FiveNet dafür nicht auf.</span>`;
  },

  // Aufgaben & Wiedervorlagen
  'task-scope': async (el) => {
    st.taskScope = el.dataset.value;
    await load.tasks();
    renderView();
  },
  'task-state': async (el) => {
    st.taskState = el.dataset.value;
    await load.tasks();
    renderView();
  },
  'task-toggle': async (el) => {
    const done = el.dataset.done !== '1';
    // Haken sofort setzen bzw. entfernen – scheitert das Speichern, springt er zurück
    const show = (on) => {
      el.closest('.task-row')?.classList.toggle('is-done', on);
      el.innerHTML = on ? icon('check', 'ico-sm') : '';
      el.dataset.done = on ? '1' : '0';
    };
    show(done);
    if (done && !window.PS.motion.calm()) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop'); // Haken federt kurz auf
    }
    el.disabled = true;
    try {
      await guardedPatch('/api/tasks/' + el.dataset.id, { done }, { done: !done }, { reload: afterTaskChange });
    } catch (err) {
      if (el.isConnected) show(!done);
      throw notSaved(err);
    } finally {
      if (el.isConnected) el.disabled = false;
    }
    toast(done ? 'Erledigt.' : 'Aufgabe wieder geöffnet.');
    await afterTaskChange();
  },
  'task-new': async (el) => {
    const caseId = el.dataset.caseId ? Number(el.dataset.caseId) : null;
    st.returnCase = caseId && st.modalCaseId === caseId ? caseId : null;
    await Promise.all([load.lawyers(), load.cases()]);
    const lawyer = caseId && st.caseInfo && st.caseInfo.id === caseId ? st.caseInfo.lawyerId : null;
    taskModal(null, { caseId, assignedTo: lawyer || st.user.id });
  },
  'task-edit': async (el) => {
    const t = findTask(Number(el.dataset.id));
    if (!t) return;
    st.returnCase = st.modalCaseId && t.caseId === st.modalCaseId ? st.modalCaseId : null;
    await Promise.all([load.lawyers(), load.cases()]);
    taskModal(t);
  },
  'task-delete': (el) =>
    undoDelete({
      url: '/api/tasks/' + el.dataset.id,
      hide: `.task-row:has([data-action="task-delete"][data-id="${el.dataset.id}"])`,
      label: 'Aufgabe',
      after: afterTaskChange,
    }),
  // Ältere Nachrichten einer Akte nachladen (die Akte zeigt zuerst nur die jüngsten)
  'chat-older': async (el) => {
    const list = $('#chatList');
    const first = list && list.querySelector('.chat-msg[data-id]');
    if (!list || !first) return;
    const caseId = Number(el.dataset.caseId);
    el.disabled = true;
    const r = await api.get(`/api/cases/${caseId}/chat?before=${first.dataset.id}&limit=40`);
    caseFull.add(caseId);
    const old = r.messages;
    if (old.length) {
      const lastDay = chatDayLabel(old[old.length - 1].createdAt);
      const firstSep = list.querySelector('.chat-day');
      if (firstSep && firstSep.textContent.trim() === lastDay) firstSep.remove(); // Tag steht schon bei den älteren
      // Leseposition bleibt: die bisher oberste Nachricht soll auf dem Bildschirm stehen bleiben (Liste oder Fenster scrollt)
      const top = first.getBoundingClientRect().top;
      el.closest('.chat-more').insertAdjacentHTML('afterend', chatBubbles(old, caseBubble));
      let scroller = list;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + first.getBoundingClientRect().top - top, behavior: 'instant' });
    }
    if (r.more) el.disabled = false;
    else el.closest('.chat-more').remove();
  },
  // Älteren Verlauf: die Akte wird ganz neu geladen (Phasen gruppieren sich dabei richtig)
  'log-older': async (el) => {
    const caseId = Number(el.dataset.caseId);
    caseFull.add(caseId);
    await reloadCase(caseId);
  },
  // Fehlende Unterlagen
  'req-new': (el) => {
    const caseId = Number(el.dataset.caseId);
    st.returnCase = st.modalCaseId === caseId ? caseId : null;
    openModal(`<h2 id="modalTitle" class="modal-title">Unterlage anfordern</h2>
      <p class="modal-sub">Der Mandant sieht es im Portal unter „Was ist zu tun?“ und im Discord-Ticket. Nach 3 Tagen erinnert ihn der Bot einmal.</p>
      <form data-form="req-add" data-case-id="${caseId}" class="form-grid">
        <div><label class="label" for="rqTitle">Was fehlt?</label><input id="rqTitle" name="title" class="field" required minlength="2" maxlength="120" placeholder="z. B. Beleg der Zahlung, Foto des Unfallorts" autofocus></div>
        <div><label class="label" for="rqNote">Hinweis (optional)</label><textarea id="rqNote" name="note" class="field" rows="3" maxlength="500"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Anfordern</span></button><button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button></div>
      </form>`);
  },
  'req-toggle': async (el) => {
    const caseId = Number(el.dataset.caseId);
    await api.patch(`/api/cases/${caseId}/requests/${el.dataset.id}`, { done: !!el.dataset.done });
    if (!isStaff()) load.requests().catch(() => {});
    await reloadCase(caseId);
  },
  'req-del': async (el) => {
    const caseId = Number(el.dataset.caseId);
    if (!(await askDelete('Anforderung löschen?', 'Sie verschwindet auch beim Mandanten.'))) return;
    await api.del(`/api/cases/${caseId}/requests/${el.dataset.id}`);
    await reloadCase(caseId);
  },
  'task-package': async (el) => {
    const caseId = Number(el.dataset.caseId);
    st.returnCase = st.modalCaseId === caseId ? caseId : null;
    const { packages } = await api.get('/api/task-packages');
    const html = taskPackagesHtml(caseId, packages, st.caseInfo && st.caseInfo.id === caseId ? st.caseInfo.area : '');
    if ($('#modalBody .pack-list, #modalBody .pack-form')) replaceModal(html);
    else openModal(html);
  },
  'task-package-edit': async (el) => {
    const caseId = Number(el.dataset.caseId);
    const { packages } = await api.get('/api/task-packages');
    replaceModal(taskPackagesEditHtml(caseId, packages));
  },
  'task-package-apply': async (el) => {
    const caseId = Number(el.dataset.caseId);
    const r = await api.post(`/api/task-packages/${el.dataset.id}/apply`, { caseId });
    toast(r.added ? `${r.added} ${r.added === 1 ? 'Aufgabe' : 'Aufgaben'} angelegt${r.skipped ? ` (${r.skipped} schon vorhanden)` : ''}.` : 'Alle Aufgaben des Pakets sind schon in der Akte.');
    await returnOrClose();
    await afterTaskChange();
  },
  'task-package-del': async (el) => {
    if (!(await askDelete('Paket löschen?', 'Bereits angelegte Aufgaben bleiben in den Akten.'))) return;
    await api.del(`/api/task-packages/${el.dataset.id}`);
    toast('Paket gelöscht.');
    await actions['task-package-edit'](el);
  },
  'task-checklist': async (el) => {
    const caseId = Number(el.dataset.caseId);
    const r = await api.post('/api/tasks/checklist', { caseId });
    toast(r.added ? `${r.added} Aufgaben aus der Checkliste übernommen.` : 'Alle Punkte der Checkliste sind bereits in der Akte.');
    await afterTaskChange();
  },

  // Bewerbungen
  'app-tab': (el) => {
    st.appTab = el.dataset.value;
    renderView();
  },
  'app-filter': (el) => {
    st.appFilter = el.dataset.value;
    renderView();
  },
  'app-open': (el) => openApplication(Number(el.dataset.id)),
  'app-back': (el) => modalDismiss(() => (st.modalStack.length ? modalBack() : openApplication(Number(el.dataset.id)))),
  'app-rate': async (el) => {
    const data = await api.patch('/api/admin/applications/' + el.dataset.id, { rating: Number(el.dataset.value) });
    await reloadApplication(data);
  },
  'app-status': async (el) => {
    const data = await api.patch('/api/admin/applications/' + el.dataset.id, { status: el.dataset.status });
    toast(`Status: ${APP_STATUS[el.dataset.status][0]}`);
    await reloadApplication(data);
  },
  'app-hire': async (el) => {
    const data = await api.get('/api/admin/applications/' + el.dataset.id);
    hireModal(data.application);
  },
  'app-delete': async (el) => {
    if (!(await askDelete(`Bewerbung ${el.dataset.number} löschen?`, 'Die Bewerbung und alle Notizen dazu werden endgültig gelöscht.', 'Endgültig löschen'))) return;
    await api.del('/api/admin/applications/' + el.dataset.id);
    toast('Bewerbung gelöscht.');
    await modalBack();
    await refreshBehind();
  },
  'position-new': () => positionModal(null),
  'position-edit': (el) => positionModal(st.positions.find((p) => p.id === Number(el.dataset.id))),
  'position-delete': async (el) => {
    const p = st.positions.find((x) => x.id === Number(el.dataset.id));
    if (!p || !(await askDelete('Stelle löschen?', `„${p.title}“ wird von der Karriereseite entfernt. Bestehende Bewerbungen bleiben erhalten.`))) return;
    await api.del('/api/admin/positions/' + p.id);
    toast('Stelle gelöscht.');
    await refreshBehind();
  },

  // Protokoll
  'audit-more': async () => {
    await loadAudit(true);
    $('#auditList').innerHTML = auditTable();
  },

  // Einstellungen & Profil
  'discord-test': async () => {
    const r = await api.post('/api/admin/discord/test');
    toast(r.sent > 1 ? `Testnachricht an ${r.sent} Kanäle gesendet – jede nennt die Ereignisse und Rollen für ihren Kanal.` : 'Testnachricht an Discord gesendet.');
    if (!(r.pinged || []).length) toast('Es ist keine Rolle zum Pingen eingestellt – bei „Rolle pingen“ einen Haken setzen und eine Rollen-ID eintragen.', 'error');
  },
  'discord-unlink': async () => {
    if (!(await ask('Die Anmeldung per Discord ist danach nicht mehr möglich, bis Sie das Konto erneut verbinden.', { title: 'Discord-Verbindung trennen?', confirmText: 'Trennen' }))) return;
    const res = await api.post('/api/discord/unlink');
    st.user = res.user;
    renderUser();
    renderView();
    toast('Discord-Verbindung getrennt.');
  },
};
