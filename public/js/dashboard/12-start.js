/*
 * Kanzlei-Dashboard – Teil 12 von 12: Ereignisse und Start.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Ereignisse
   ================================================================ */
// Wo der Klick begonnen hat: Wer im Fenster Text markiert und neben dem Fenster loslässt, hat nicht „daneben“ geklickt.
let modalPressOutside = false;
document.addEventListener('pointerdown', (e) => (modalPressOutside = e.target === $('#modal')), true);

document.addEventListener('click', (e) => {
  if (!e.target.closest('#dutyWrap')) closeDutyPop();
  // Menü „⋯ Mehr“: Klick daneben oder auf einen Eintrag schließt es
  $$('details.more-menu[open]').forEach((d) => {
    if (!d.contains(e.target) || e.target.closest('.more-item')) d.open = false;
  });
  if (e.target.closest('a[href^="/vertrag.html"]')) st.contractTabAt = Date.now();
  // Klick neben das Fenster: Akte, Formulare und Detailfenster bleiben offen (versehentlich daneben geklickt) –
  // nur Suche und Bildansicht gehen zu (zurück zum vorherigen Fenster, z. B. zur Akte)
  if (e.target === $('#modal')) {
    if (!modalPressOutside) return;
    if (st.modalCurrent && st.modalCurrent.light) guard(() => modalDismiss());
    else nudgeModal();
    return;
  }
  const link = e.target.closest('a[href^="#"]');
  if (link && !link.dataset.action) {
    // Seitenwechsel aus einem offenen Fenster/Menü oder mit ungespeicherten Eingaben: über leaveTo (Verlauf + Rückfrage)
    if (onOverlayEntry() || unsavedInputs()) {
      e.preventDefault();
      guard(() => leaveTo(decodeURIComponent(link.getAttribute('href').slice(1))));
      return;
    }
    if (link.getAttribute('href') === location.hash) {
      e.preventDefault();
      go(hashView());
      return;
    }
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  // Doppelklick: dieselbe Aktion läuft noch (z. B. Senden, Erinnern, Übernehmen) – nicht ein zweites Mal auslösen
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  guard(() => fn(el, e)).finally(() => delete el.dataset.busy);
});

document.addEventListener('keydown', (e) => {
  // Strg + K (Mac: ⌘ + K) öffnet die Suche – von überall im Dashboard
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    if (!st.user || document.body.classList.contains('ps-dialog-open')) return;
    e.preventDefault();
    if ($('#gsInput')) $('#gsInput').focus();
    else guard(() => openSearch());
    return;
  }
  // Pfeiltasten und Enter im Suchfenster
  if (e.target.id === 'gsInput' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    const items = $$('#gsResults .gs-item');
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[st.gsActive]) items[st.gsActive].click();
      return;
    }
    if (!items.length) return;
    e.preventDefault();
    st.gsActive = (st.gsActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    markSearchActive();
    return;
  }
  if (e.key === 'Escape') {
    // Erst das kleine Menü bzw. die Dienst-Auswahl schließen – nicht gleich die ganze Akte
    const menu = $('details.more-menu[open]');
    if (menu) {
      menu.open = false;
      menu.querySelector('summary').focus();
      return;
    }
    if ($('#dutyPop').classList.contains('open')) {
      closeDutyPop();
      return;
    }
    if ($('#modal').classList.contains('open')) guard(() => modalDismiss());
    else closeSidebar();
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
  }
  // Chat: Enter sendet, Umschalt + Enter macht eine neue Zeile (am Handy bleibt Enter ein Zeilenumbruch)
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.classList && e.target.classList.contains('chat-input') && window.matchMedia('(hover: hover)').matches) {
    e.preventDefault();
    if (e.target.value.trim()) e.target.form.requestSubmit();
    return;
  }
  // Enter in einem Eingabefeld des Generators soll nicht versehentlich die Rechnung erstellen.
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('#invoiceForm')) e.preventDefault();
});

// Willkommensnachricht: zuletzt gewähltes Textfeld (Platzhalter landen dort)
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.closest && t.closest('#welcomeForm, #msgForm') && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) st.wlField = t;
});

// Menü „⋯ Mehr“ am rechten Rand: nach links aufklappen, damit es nicht aus dem Bild ragt
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target;
    if (!d.matches || !d.matches('details.more-menu') || !d.open) return;
    const pop = d.querySelector('.more-pop');
    pop.classList.remove('align-right');
    if (pop.getBoundingClientRect().right > window.innerWidth - 8) pop.classList.add('align-right');
  },
  true
);

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  const buttons = $$('button[type="submit"]', f);
  buttons.forEach((b) => (b.disabled = true));
  // Ein Fenster, das nach dem Absenden aufgeht (z. B. Zugangsdaten), ersetzt das Formular – zurück geht es nie zum abgeschickten Formular
  guard(() => modalInstead(() => forms[f.dataset.form](f))).finally(() => buttons.forEach((b) => b.isConnected && (b.disabled = false)));
});

document.addEventListener('paste', (e) => {
  const form = e.target && e.target.closest ? e.target.closest('form[data-form="ext-link"], form[data-form="ext-edit"]') : null;
  if (form) onExternalPaste(e, form.dataset.provider);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'caseSearch') {
    st.caseQuery = t.value;
    $('#caseList').innerHTML = caseTable();
  } else if (t.classList && t.classList.contains('chat-input')) {
    // Eingabefeld wächst mit (bis zu einigen Zeilen)
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 2, 180) + 'px';
  } else if (t.id === 'gsInput') {
    st.gsQuery = t.value;
    clearTimeout(st.gsTimer);
    st.gsTimer = setTimeout(() => runSearch().catch(handleError), 200);
  } else if (t.id === 'fnInput') {
    clearTimeout(st.fnTimer);
    st.fnTimer = setTimeout(() => checkFivenetInput(t), 300);
  } else if (t.id === 'gdInput') {
    clearTimeout(st.fnTimer);
    st.fnTimer = setTimeout(() => loadGoogleDoc(t.value.trim()), 400);
  } else if (t.name === 'eventRole' && t.value.trim()) {
    const box = t.closest('.ev-item')?.querySelector('input[name="pingEvents"]');
    if (box) box.checked = true;
  } else if (t.classList && t.classList.contains('svc-qty')) {
    updateServiceSum(t.form); // Menge geändert: Summe sofort aktualisieren
  } else if (t.id === 'fnContent') {
    t.dataset.auto = '0'; // von Hand geändert – beim nächsten automatischen Laden nicht überschreiben
  } else if (t.id === 'vipAccSearch') {
    clearTimeout(st.vipAccTimer);
    st.vipAccTimer = setTimeout(() => guard(() => searchVipAccounts(t)), 250);
  } else if (t.id === 'coopAccSearch') {
    clearTimeout(st.coopAccTimer);
    st.coopAccTimer = setTimeout(() => guard(() => searchCoopAccounts(t)), 250);
  } else if (t.id === 'nameAccSearch') {
    clearTimeout(st.nameAccTimer);
    st.nameAccTimer = setTimeout(() => guard(() => searchNameAccounts(t)), 250);
  } else if (t.id === 'clientAccSearch') {
    clearTimeout(st.clientAccTimer);
    st.clientAccTimer = setTimeout(() => guard(() => searchClientAccounts(t)), 250);
  } else if (t.id === 'taskSearch') {
    st.taskQuery = t.value;
    $('#taskList').innerHTML = taskList();
  } else if (t.id === 'userSearch') {
    st.userQuery = t.value;
    $('#userList').innerHTML = userTable();
  } else if (t.id === 'auditSearch') {
    st.auditQuery = t.value.trim();
    clearTimeout(st.auditTimer);
    st.auditTimer = setTimeout(() => {
      guard(async () => {
        await loadAudit();
        if (st.view === 'audit') $('#auditList').innerHTML = auditTable();
      });
    }, 300);
  } else if (t.closest('#welcomeForm')) {
    clearTimeout(st.wlTimer);
    st.wlTimer = setTimeout(() => updateWelcomePreview(t.closest('#welcomeForm')), 120);
  } else if (t.closest('#msgForm')) {
    clearTimeout(st.wlTimer);
    st.wlTimer = setTimeout(() => updateMsgPreview(t.closest('#msgForm')), 120);
  } else if (t.closest('#invoiceForm') && t.type !== 'radio' && t.tagName !== 'SELECT') {
    onInvoiceInput(t);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'prUser' || e.target.id === 'prRank') updatePromotePreview();
  const t = e.target;
  if (t.id === 'bf_tpl') {
    syncBriefForm(t.form);
    return;
  }
  // Per DM an Rolle: andere Rolle gewählt → alte Empfänger-Vorschau ausblenden
  if (t.id === 'dmRole') {
    st.dmRole = t.value;
    st.dmPreview = null;
    const box = $('#dmPreview');
    if (box) box.innerHTML = '';
  }
  if (t.id === 'dmLogin') {
    st.dmLogin = t.checked;
    $('#dmPreview .dm-preview')?.classList.toggle('with-login', t.checked); // Namensfelder nur mit Website-Zugang
  }
  if (t.id === 'dmAll') $$('#dmPreview .dm-pick').forEach((x) => (x.checked = t.checked));
  if (t.id === 'dmAll' || (t.classList && t.classList.contains('dm-pick'))) dmSyncPicks();
  // Vorlage: Rolle erwähnen → <@&ID> an der Schreibmarke einfügen
  if (t.id === 'msgRoleInsert') {
    if (t.value) insertTemplateText(t.closest('form'), `<@&${t.value}>`);
    t.value = '';
    return;
  }
  if (t.id === 'bf_visible') t.dataset.touched = '1';
  // Zahlung melden: gewählten Screenshot anzeigen (hochgeladen wird erst beim Absenden)
  if (t.name === 'proof' && t.closest('form[data-form="inv-pay-report"]')) {
    const label = $('#payProofName');
    if (label) label.textContent = t.files[0] ? t.files[0].name : 'Bild auswählen';
    return;
  }
  if (t.dataset.upload) {
    guard(() => handleUpload(t));
    return;
  }
  if (t.closest('#invoiceForm')) {
    onInvoiceChange(t);
    return;
  }
  if (t.id === 'caseSort') {
    st.caseSort = t.value;
    try {
      localStorage.setItem('ps.caseSort', t.value);
    } catch {
      /* nur Komfort – ohne Speicher gilt die Auswahl bis zum Neuladen */
    }
    $('#caseList').innerHTML = caseTable();
    return;
  }
  if (t.dataset.casePriority !== undefined) {
    guard(() => setCasePriority(t));
    return;
  }
  // Akte bearbeiten: Dringlichkeit geändert → Priorität zieht mit, solange sie noch dem automatischen Wert entspricht
  if (t.name === 'urgency' && t.form && t.form.dataset.form === 'case-edit' && t.form.elements.priority) {
    const prio = t.form.elements.priority;
    const prev = t.dataset.prev || [...t.options].find((o) => o.defaultSelected)?.value || 'normal';
    if (Number(prio.value) === PRIORITY_FROM_URGENCY[prev]) prio.value = String(PRIORITY_FROM_URGENCY[t.value] || 2);
    t.dataset.prev = t.value;
    return;
  }
  if (t.id === 'tierKind') {
    $('#tierDuration')?.classList.toggle('hidden', t.value === 'perma');
    return;
  }
  if (t.dataset && t.dataset.tierRole !== undefined) {
    const input = t.form?.elements.discordRoleId;
    if (input) input.value = t.value;
    return;
  }
  if (t.name === 'accountMode') {
    $$('[data-account-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.accountPane !== t.value));
    return;
  }
  if (t.name === 'type' && t.form && t.form.dataset.form === 'event' && !t.form.dataset.id && t.form.elements.clientVisible) {
    t.form.elements.clientVisible.checked = ['mandant', 'gericht'].includes(t.value);
    return;
  }
  if (t.dataset.userField) guard(() => updateUserField(t));
  if (t.matches('[data-ext-sort]')) sortExternalDocs(t);
  // Vertrag: Leistung an-/abgewählt → Menge freischalten, Summe neu berechnen
  if (t.classList.contains('svc-check') || t.classList.contains('svc-qty')) {
    if (t.classList.contains('svc-check')) t.closest('.svc').querySelector('.svc-qty').disabled = !t.checked;
    updateServiceSum(t.form);
  }
  // Abmeldung: „Bis“ nie vor „Von“
  if (t.id === 'abFrom') {
    const to = $('#abTo');
    if (to) {
      to.min = t.value;
      if (to.value < t.value) to.value = t.value;
    }
  }
  // Team-Profil: Board-Ränge erscheinen auf der Website in der goldenen Ebene
  if (t.id === 'tmRank' && $('#tmTier')) $('#tmTier').value = RANK_GROUPS['Board of Partners'].includes(t.value) ? 'leitung' : 'anwalt';
  // Vertrag: anderer unterzeichnender Anwalt → Name, Rang und (bekanntes) Geburtsdatum übernehmen;
  // derselbe kann nicht zugleich weiterer Anwalt sein.
  if (t.id === 'kf_lawyer') {
    const l = st.lawyers.find((x) => x.id === Number(t.value));
    const coRow = t.form.querySelector(`.co-check[value="${Number(t.value)}"]`)?.closest('.co-row');
    const coBirth = coRow && coRow.querySelector('.co-check').checked ? coRow.querySelector('.co-birth').value.trim() : '';
    if (l) {
      t.form.elements.anwalt.value = l.displayName;
      t.form.elements.anwalt_rang.value = l.rank || '';
      t.form.elements.anwalt_geburtsdatum.value = coBirth || (st.contractBirths || {})[l.id] || '';
    }
    t.form.querySelectorAll('.co-row').forEach((row) => {
      const box = row.querySelector('.co-check');
      const isMain = box.value === t.value;
      box.disabled = isMain;
      if (isMain) box.checked = false;
      row.querySelector('.co-birth').disabled = !box.checked;
      row.querySelector('.co-main').hidden = !isMain;
    });
  }
  // Discord-Bot: Farbpunkt der gewählten Rolle, Embed-Felder ein-/ausblenden, Vorschau
  if (t.matches && t.matches('[data-role-select]')) {
    const dot = t.parentElement.querySelector('.role-dot');
    if (dot) dot.style.background = (t.selectedOptions[0] && t.selectedOptions[0].dataset.color) || 'transparent';
  }
  if (t.matches && t.matches('[data-emb-toggle]')) t.closest('.emb-edit').querySelector('.emb-fields').hidden = !t.checked;
  if (t.closest && t.closest('#welcomeForm')) updateWelcomePreview(t.closest('#welcomeForm'));
  if (t.matches && t.matches('[data-thumb-select]')) t.closest('.emb-grid').querySelector('[data-thumb-url]').hidden = t.value !== 'url';
  if (t.closest && t.closest('#msgForm')) updateMsgPreview(t.closest('#msgForm'));
  // Join Roles: höchstens N Rollen je Gruppe
  if (t.matches && t.matches('.jr-human, .jr-bot, .jr-always') && t.checked) {
    const list = t.closest('.jr-list');
    const max = Number(list.dataset.max) || 10;
    if (list.querySelectorAll('input:checked').length > max) {
      t.checked = false;
      toast(`Höchstens ${max} Rollen je Gruppe.`, 'error');
    }
  }
  // Vertrag: weiterer Anwalt an-/abgewählt → Geburtsdatum freischalten, Höchstzahl beachten
  if (t.classList.contains('co-check')) {
    const list = t.closest('#coList');
    const max = Number(list.dataset.max) || 4;
    if (t.checked && list.querySelectorAll('.co-check:checked').length > max) {
      t.checked = false;
      toast(`Höchstens ${max} weitere Anwälte pro Vertrag.`, 'error');
    }
    t.closest('.co-row').querySelector('.co-birth').disabled = !t.checked;
  }
  // Federführender Anwalt gewählt: derselbe kann nicht zugleich „weiterer Anwalt“ sein.
  if (t.id === 'teamLead') {
    t.form.querySelectorAll('input[name="coLawyerIds"]').forEach((box) => {
      const isLead = box.value === t.value;
      box.disabled = isLead;
      if (isLead) box.checked = false;
    });
  }
});

// Seitenwechsel per Zurück/Vorwärts oder Adresszeile – mit Rückfrage, wenn auf der Seite noch etwas Ungespeichertes steht
window.addEventListener('hashchange', () =>
  guard(async () => {
    const view = hashView();
    if (view !== st.view && formDirty($('#content')) && !(await askDiscard(true))) {
      history.pushState(null, '', '#' + st.view); // auf der Seite bleiben
      return;
    }
    await go(view);
  })
);
window.addEventListener('popstate', onPopState);
// Neu laden / Tab schließen mit ungespeicherten Eingaben: Rückfrage des Browsers
window.addEventListener('beforeunload', (e) => {
  if (st.leaving || !st.user || !unsavedInputs({ invoice: true })) return;
  e.preventDefault();
  e.returnValue = '';
});

// Vertrag im anderen Tab unterschrieben: beim Zurückkehren die offene Akte auffrischen –
// aber nur, wenn dort nichts halb Eingetipptes verloren ginge.
window.addEventListener('focus', () => {
  const id = st.modalCaseId;
  // Nur nach dem Öffnen eines Vertrags (nicht bei jedem Fensterwechsel).
  if (!st.contractTabAt || Date.now() - st.contractTabAt > 30 * 60 * 1000) return;
  // Aus „Was ist zu tun?“ unterschrieben (ohne offenes Fenster): Übersicht auffrischen
  if (!id && st.view === 'overview' && !$('#modal').classList.contains('open')) {
    refreshBehind();
    return;
  }
  if (!id || !$('#secContracts') || document.body.classList.contains('ps-dialog-open')) return;
  const dirty = [...document.querySelectorAll('#modal input, #modal textarea, #modal select')].some((el) => {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') {
      const def = [...el.options].findIndex((o) => o.defaultSelected);
      return el.selectedIndex !== (def < 0 ? 0 : def);
    }
    return el.value !== el.defaultValue;
  });
  if (!dirty) reloadCase(id).catch(() => {});
});

// Offener Chat (Akte oder Bewerbung): neue Nachrichten alle paar Sekunden nachladen
setInterval(() => {
  if (!st.user) return;
  pollChat();
  if (typeof pollAppChat === 'function') pollAppChat();
}, 6000);

// Ungelesene Post, neue Bewerbungen und Dienststatus regelmäßig aktualisieren (Badges in der Navigation)
setInterval(() => {
  if (document.hidden || !st.user) return;
  Promise.all([load.chatUnread().catch(() => {}), load.unread(), load.appCount(), load.dueTasks(), load.concernCount().catch(() => {}), load.personnelCount().catch(() => {}), load.nameCount().catch(() => {}), load.vipCount().catch(() => {}), load.reviewCount().catch(() => {}), load.paymentReports().catch(() => {})])
    .then(renderNav)
    .catch(() => {});
}, 30000);
setInterval(() => {
  if (document.hidden || !st.user || !isStaff() || st.view === 'duty') return;
  load
    .duty()
    .then(() => renderUser())
    .catch(() => {});
}, 60000);

/* ================================================================
   Start
   ================================================================ */
(async function start() {
  try {
    st.user = (await api.get('/api/auth/me')).user;
  } catch {
    location.href = '/login.html?next=' + encodeURIComponent('/dashboard.html' + location.search + location.hash);
    return;
  }
  renderUser();

  const params = new URLSearchParams(location.search);
  const discordState = params.get('discord');
  const googleState = params.get('google');
  const caseParam = Number(params.get('case'));
  // Neu geladen, während eine Akte offen war: der Verlaufseintrag gehört schon zur Akte – nur wieder öffnen
  const restoring = params.has('case') && onOverlayEntry();
  if (!restoring && (discordState || googleState || params.has('case'))) history.replaceState(null, '', location.pathname + location.hash);
  if (discordState && DISCORD_MSG[discordState]) toast(...DISCORD_MSG[discordState]);
  if (googleState && GOOGLE_MSG[googleState]) toast(...GOOGLE_MSG[googleState]);
  if (googleState) st.settingsTab = 'integrations'; // Google Docs stehen unter Einstellungen → Integrationen

  try {
    await Promise.all([load.chatUnread().catch(() => {}), load.unread(), load.appCount(), load.duty(), load.dueTasks(), load.concernCount().catch(() => {}), load.personnelCount().catch(() => {}), load.nameCount().catch(() => {}), load.vipCount().catch(() => {}), load.reviewCount().catch(() => {}), load.paymentReports().catch(() => {})]);
    renderUser();
  } catch {
    /* Badges und Dienststatus sind nicht kritisch */
  }
  st.histPaused = true;
  try {
    await go(hashView());
    if (Number.isInteger(caseParam) && caseParam > 0) await guard(() => openCase(caseParam));
  } finally {
    st.histPaused = false;
    syncHistory();
  }
  if (st.user.needsName) askInitialName();
})();

/** Konto per Discord angelegt: einmal nach dem Namen im Spiel fragen (erscheint in Akten, Verträgen, Nachrichten). */
function askInitialName() {
  openModal(`
      <h2 id="modalTitle" class="modal-title">Willkommen bei Pake &amp; Scha!</h2>
      <p class="modal-sub">Ihr Konto ist mit Discord verbunden. Wie heißt Ihr Charakter im Spiel? So erscheinen Sie in Ihren Akten, Verträgen und Nachrichten.</p>
      <form data-form="initial-name" class="form-grid">
        <div><label class="label" for="inName">Vor- und Nachname (im Spiel)</label><input id="inName" name="displayName" class="field" required minlength="3" maxlength="80" autocomplete="name" placeholder="z. B. John Doe" autofocus></div>
        <p class="form-hint">Später ändern Sie den Namen nur noch per Antrag ans Board of Partners – bitte genau so, wie er im Spiel lautet.</p>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Speichern</span></button></div>
      </form>`);
}
