/*
 * Kanzlei-Dashboard – Teil 14 von 14: Ereignisse und Start.
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
  if (e.target.closest('a[href^="/vertrag"]')) st.contractTabAt = Date.now();
  // Klick neben das Fenster: zurück zum vorherigen Fenster (z. B. zur Akte) bzw. schließen – bei ungespeicherten
  // Eingaben erst mit Rückfrage. Markieren im Fenster und daneben Loslassen zählt nicht.
  if (e.target === $('#modal')) {
    if (modalPressOutside) guard(() => modalDismiss());
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
    if ($('#docPeek')) {
      docPeekClose();
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
  // Entwurf: während des Absendens nicht wieder ins (neu gezeichnete) Formular schreiben; gelöscht wird er erst bei Erfolg
  const draftDone = window.PS.drafts.hold(f);
  let ok = false;
  // Ein Fenster, das nach dem Absenden aufgeht (z. B. Zugangsdaten), ersetzt das Formular – zurück geht es nie zum abgeschickten Formular
  window.PS.clearFieldErrors(f);
  guard(async () => {
    try {
      await modalInstead(() => forms[f.dataset.form](f));
    } catch (err) {
      // Lehnt der Server einzelne Angaben ab, steht der Hinweis direkt am Feld statt oben in der Ecke
      if (f.isConnected && window.PS.fieldErrors(f, err)) return;
      throw err;
    }
    ok = true;
    (f.isConnected ? f : document).dispatchEvent(new CustomEvent('ps:form-ok', { bubbles: true, detail: f.dataset.form })); // am Formular: der Speichern-Knopf zeigt kurz einen Haken
  }).finally(() => {
    draftDone(ok);
    buttons.forEach((b) => b.isConnected && (b.disabled = false));
  });
});

/* ---------------------------------------------------------------- Beschriftungen mit ihren Feldern verbinden */
// „<label>Kontakt</label><input …>“ ohne for: Screenreader lesen die Beschriftung sonst nicht vor, ein Klick auf sie
// setzt keinen Fokus. Gilt für alles, was neu gezeichnet wird (Seiten, Fenster, Reiter).
let labelSeq = 0;
function linkLabels(root) {
  for (const label of root.querySelectorAll('label:not([for])')) {
    if (label.querySelector('input, select, textarea')) continue; // umschließt sein Feld schon
    let field = label.nextElementSibling;
    if (field && !field.matches('input, select, textarea')) {
      const inner = field.querySelectorAll('input:not([type="hidden"]), select, textarea');
      field = inner.length === 1 ? inner[0] : null; // nur eindeutig: genau ein Feld im Block danach
    }
    if (!field || field.type === 'hidden') continue;
    if (!field.id) field.id = `fld${++labelSeq}`;
    label.htmlFor = field.id;
  }
}
let labelsQueued = false;
new MutationObserver(() => {
  if (labelsQueued) return;
  labelsQueued = true;
  requestAnimationFrame(() => {
    labelsQueued = false;
    linkLabels(document.body);
  });
}).observe(document.body, { childList: true, subtree: true });

/* ---------------------------------------------------------------- Bilder einfügen (Strg+V) und hineinziehen */
// Screenshots landen dort, wo man sonst „Bilder hinzufügen“ wählt: in der Akte bei den Beweismitteln, beim Melden einer
// Zahlung als Nachweis, im Profil als Profilbild … Externe Dokumente haben ihr eigenes Einfügen (onExternalPaste).
const IMAGE_FILE = /^image\/(png|jpeg|webp|gif|bmp)$/;
const IMAGE_TARGETS = {
  evidence: 'als Beweismittel zur Akte',
  proof: 'als Nachweis zur Zahlung',
  'pay-proof': 'als Nachweis zur Zahlung',
  'fn-pending': 'zum Dokument',
  team: 'als Teamfoto',
  avatar: 'als Profilbild',
};
const imageKind = (input) => input.dataset.upload || input.name;
/** Wohin mit Bildern? Zuerst das Formular, in dem man gerade ist, sonst das eindeutige Bild-Feld im Fenster bzw. auf der Seite. */
function imageTarget(from) {
  const usable = (i) => !i.disabled && /image/.test(i.accept || '') && !!IMAGE_TARGETS[imageKind(i)];
  const form = from && from.closest ? from.closest('form') : null;
  const inForm = form ? [...form.querySelectorAll('input[type="file"]')].filter(usable) : [];
  if (inForm.length) return inForm[0];
  const root = $('#modal').classList.contains('open') ? $('#modalBody') : $('#content');
  // Auf eine bestimmte Zeile gezogen (z. B. eine von mehreren Rechnungen): deren Bild-Feld
  for (let el = from && root.contains(from) ? from : null; el && el !== root; el = el.parentElement) {
    const near = [...el.querySelectorAll('input[type="file"]')].filter(usable);
    if (near.length === 1) return near[0];
    if (near.length > 1) break;
  }
  const all = $$('input[type="file"]', root).filter(usable);
  for (const kind of Object.keys(IMAGE_TARGETS)) {
    const hits = all.filter((i) => imageKind(i) === kind);
    if (hits.length === 1 || (hits.length && kind === 'evidence')) return hits[0];
  }
  return null;
}
const imagesOf = (list) => [...(list || [])].filter((f) => f && IMAGE_FILE.test(f.type));
/** Bilder in das Feld legen – danach läuft alles wie bei „Bilder hinzufügen“ (Hochladen bzw. Anzeige im Formular). */
function sendImages(input, files) {
  const dt = new DataTransfer();
  (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (imageKind(input) === 'proof') toast('Screenshot übernommen – er wird mit der Meldung gesendet.');
}
document.addEventListener('paste', (e) => {
  const form = e.target && e.target.closest ? e.target.closest('form[data-form="ext-link"], form[data-form="ext-edit"]') : null;
  if (form) return onExternalPaste(e, form.dataset.provider);
  const cd = e.clipboardData;
  const files = imagesOf(cd && [...cd.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()));
  if (!files.length) return;
  // Text mit Bild (z. B. aus Word) in ein Textfeld: wie gewohnt als Text einfügen
  const editable = e.target.matches && e.target.matches('input, textarea, [contenteditable="true"]');
  if (editable && (cd.getData('text/plain') || '').trim()) return;
  const input = imageTarget(e.target);
  if (!input) return;
  e.preventDefault();
  sendImages(input, files);
});
// Hineinziehen: Hinweis, wohin die Bilder gehen – und nie die Seite verlassen, weil der Browser das Bild öffnet
let dragDepth = 0;
const dragsFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
function dropHint(show, input) {
  let el = $('#dropHint');
  if (!show) return el && el.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = 'dropHint';
    el.className = 'drop-hint';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  el.classList.toggle('is-off', !input);
  el.innerHTML = input
    ? `${icon('camera')}<span>Bilder loslassen – ${esc(IMAGE_TARGETS[imageKind(input)])}</span>`
    : `${icon('alert')}<span>Hier lassen sich keine Bilder ablegen – bitte in einer Akte.</span>`;
}
document.addEventListener('dragenter', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropHint(true, imageTarget(e.target));
});
document.addEventListener('dragover', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = imageTarget(e.target) ? 'copy' : 'none';
});
document.addEventListener('dragleave', (e) => {
  if (!dragsFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropHint(false);
});
document.addEventListener('drop', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint(false);
  const files = imagesOf(e.dataTransfer.files);
  const input = imageTarget(e.target);
  if (!files.length) return toast('Nur Bilder (PNG, JPG, WebP, GIF) lassen sich hier ablegen.', 'error');
  if (!input) return toast('Bilder bitte in einer Akte ablegen – sie landen dann bei den Beweismitteln.', 'error');
  sendImages(input, files);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  // Suche in langen Listen: erst neu zeichnen, wenn kurz nicht getippt wird (jede Taste einzeln wäre bei vielen Akten zäh)
  if (t.id === 'caseSearch') {
    st.caseQuery = t.value;
    clearTimeout(st.listSearchTimer);
    st.listSearchTimer = setTimeout(() => flipFill($('#caseList'), caseTable()), 120);
  } else if (t.id === 'storageSearch') {
    st.storageQuery = t.value;
    clearTimeout(st.listSearchTimer);
    st.listSearchTimer = setTimeout(() => flipFill($('#storageGrid'), storageGrid()), 120);
  } else if (t.id === 'clientSearch') {
    st.clientQuery = t.value;
    clearTimeout(st.listSearchTimer);
    st.listSearchTimer = setTimeout(() => flipFill($('#clientList'), clientTable()), 120);
  } else if (t.classList && t.classList.contains('chat-input')) {
    // Eingabefeld wächst mit (bis zu einigen Zeilen)
    // Eingabefeld wächst weich: von der bisherigen zur neuen Höhe (die Zeit steht in motion.css)
    const was = t.offsetHeight;
    t.style.height = 'auto';
    const next = Math.min(t.scrollHeight + 2, 180);
    t.style.height = `${was}px`;
    void t.offsetHeight;
    t.style.height = `${next}px`;
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

/*
 * Felder in der Akte direkt ändern (siehe ie() in 05-akte-kalender-post.js): Klick oder Enter öffnet die Eingabe, Enter
 * bzw. Verlassen speichert, Esc verwirft. Danach „Rückgängig“. Die Akte wird nicht neu geladen.
 */
const IE_OPTIONS = { area: () => Object.entries(AREAS) };
function ieShow(el, value) {
  el.dataset.value = value;
  const shown = el.dataset.ie === 'area' ? AREAS[value] || value : value;
  el.innerHTML = shown ? esc(shown) : `<span class="ie-empty">${esc(el.dataset.placeholder || '')}</span>`;
  el.classList.remove('is-editing');
}
function ieSync(id, key, value) {
  const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null;
  if (c) c[key] = value;
  const row = st.cases.find((x) => x.id === id);
  if (row) row[key] = value;
  casePrefetch.clear();
  if (key === 'title') {
    const head = $('#modalTitle');
    if (head) head.title = value;
  }
}
function ieOpen(el) {
  if (el.classList.contains('is-editing')) return;
  const type = el.dataset.type;
  const old = el.dataset.value || '';
  el.classList.add('is-editing');
  let input;
  if (type === 'select') {
    input = document.createElement('select');
    input.innerHTML = IE_OPTIONS[el.dataset.ie]().map(([k, l]) => opt(k, l, k === old)).join('');
  } else if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = Math.min(10, Math.max(3, old.split('\n').length + 1));
    input.value = old;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = old;
  }
  input.className = 'field ie-input';
  input.maxLength = { title: 120, clientName: 80, clientPhone: 40, opponent: 120, courtRef: 60, description: 4000, publicNote: 500 }[el.dataset.ie] || 200;
  input.setAttribute('aria-label', IE_LABEL[el.dataset.ie] || 'Feld');
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  if (input.select && type !== 'select') input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (!save || next === old) return ieShow(el, old);
    ieShow(el, old);
    el.classList.add('is-saving');
    const id = Number(el.dataset.id);
    const key = el.dataset.ie;
    try {
      await api.patch('/api/cases/' + id, { [key]: next });
    } catch (err) {
      el.classList.remove('is-saving');
      toast(err.message || 'Nicht gespeichert.', 'error');
      return;
    }
    el.classList.remove('is-saving');
    ieShow(el, next);
    ieSync(id, key, next);
    document.dispatchEvent(new Event('ps:changed'));
    toast(`${IE_LABEL[key]} gespeichert.`, 'ok', {
      duration: 6000,
      action: {
        label: 'Rückgängig',
        onClick: () =>
          guard(async () => {
            await api.patch('/api/cases/' + id, { [key]: old });
            ieSync(id, key, old);
            if (el.isConnected) ieShow(el, old);
            renderView();
          }),
      },
    });
    renderView(); // die Liste hinter der Akte zeigt den neuen Wert (Daten sind lokal schon aktuell)
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === 'Enter' && (type !== 'textarea' || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish(true);
    }
  });
  input.addEventListener('blur', () => finish(true));
  if (type === 'select') input.addEventListener('change', () => finish(true));
}
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.ie[data-ie]');
  if (el && !e.target.closest('.ie-input')) {
    e.preventDefault();
    ieOpen(el);
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ie[data-ie]') && !e.target.classList.contains('is-editing')) {
    e.preventDefault();
    ieOpen(e.target);
  }
});
// „Details“ in der Akte: zugeklappt bleibt zugeklappt (pro Gerät)
document.addEventListener(
  'toggle',
  (e) => {
    if (e.target.matches && e.target.matches('details.case-details')) {
      try {
        localStorage.setItem('ps.caseDetailsClosed', e.target.open ? '0' : '1');
      } catch {
        /* nur Komfort */
      }
    }
  },
  true
);

/* Beteiligte der Akte */
forms['party-add'] = async (f) => {
  const id = Number(f.dataset.id);
  const fd = new FormData(f);
  const r = await api.post(`/api/cases/${id}/parties`, { role: val(fd, 'role'), name: val(fd, 'name'), contact: val(fd, 'contact') });
  toast('Beteiligten hinzugefügt.');
  await reloadCase(id);
  return r;
};
actions['party-del'] = async (el) => {
  const id = Number(el.dataset.caseId);
  await api.del(`/api/cases/${id}/parties/${el.dataset.id}`);
  toast('Beteiligten entfernt.');
  await reloadCase(id);
};

/* Zuständige Anwälte ändern (federführend und weitere) */
actions['case-team-edit'] = async (el) => {
  const id = Number(el.dataset.id);
  const c = st.caseInfo && st.caseInfo.id === id ? st.caseInfo : null;
  if (!c) return;
  await load.lawyers();
  openModal(`
      <h2 id="modalTitle" class="modal-title">Zuständige Anwälte</h2>
      <p class="modal-sub">Akte <span class="font-mono text-gold">${esc(c.caseNumber)}</span> – wer federführend ist und wer mitarbeitet.</p>
      <form data-form="case-team" data-id="${id}" class="form-grid cols-2">
        ${lawyerPicker({ leadId: c.lawyerId, coIds: (c.coLawyers || []).map((l) => l.id), withLead: isAdmin(), extra: caseTeam(c) })}
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button><button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button></div>
      </form>`);
};
forms['case-team'] = async (f) => {
  const fd = new FormData(f);
  const id = Number(f.dataset.id);
  const body = {};
  if (f.elements.lawyerId) body.lawyerId = fd.get('lawyerId') ? Number(fd.get('lawyerId')) : null;
  if (f.querySelector('[data-team]')) body.coLawyerIds = fd.getAll('coLawyerIds').map(Number);
  const handover = f.elements.handover && !$('#handoverBox').hidden ? val(fd, 'handover') : '';
  if (handover) body.handover = handover;
  await api.patch('/api/cases/' + id, body);
  toast('Zuständigkeit gespeichert.');
  st.returnCase = null;
  await openCase(id);
  refreshBehind();
};

/*
 * Zahlenfelder bekommen eigene Tasten − / + im Stil der Kanzlei (die Systempfeile sind ausgeblendet). Die Tasten lösen
 * dasselbe change-Ereignis aus wie Tippen, also laufen gespeicherte Aktionen unverändert weiter.
 */
function enhanceNumbers(scope) {
  if (!scope.querySelectorAll) return;
  const fields = [...scope.querySelectorAll('input[type="number"]:not([data-stepper])')];
  if (scope.matches?.('input[type="number"]:not([data-stepper])')) fields.push(scope);
  for (const input of fields) {
    input.dataset.stepper = '1';
    const wrap = document.createElement('span');
    wrap.className = `num-step${input.closest('.chg-est, .svc, .inv-fee-row') || input.classList.contains('svc-qty') ? ' is-compact' : ''}`;
    const btn = (label, dir) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'num-btn';
      b.tabIndex = -1;
      b.dataset.dir = String(dir);
      b.setAttribute('aria-label', dir < 0 ? 'Einmal weniger' : 'Einmal mehr');
      b.textContent = label;
      return b;
    };
    input.replaceWith(wrap);
    wrap.append(btn('−', -1), input, btn('+', 1));
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.num-btn');
  if (!b) return;
  e.preventDefault(); // innerhalb eines Auswahl-Kastens: nicht zusätzlich das Kästchen anhaken
  const input = b.parentElement.querySelector('input[type="number"]');
  if (!input || input.disabled) return;
  const step = Number(input.step) > 0 ? Number(input.step) : 1;
  const min = input.min !== '' ? Number(input.min) : -Infinity;
  const max = input.max !== '' ? Number(input.max) : Infinity;
  const base = input.value === '' ? 0 : Number(input.value);
  const next = Math.min(max, Math.max(min, base + Number(b.dataset.dir) * step));
  if (next === base && input.value !== '') return;
  input.value = String(next);
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
new MutationObserver((records) => {
  for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) enhanceNumbers(node);
}).observe(document.body, { childList: true, subtree: true });
enhanceNumbers(document);

document.addEventListener('change', (e) => {
  if (e.target.id === 'prUser' || e.target.id === 'prRank') updatePromotePreview();
  const t = e.target;
  // Häkchen und Auswahllisten mit data-change lösen direkt eine Aktion aus (z. B. Einarbeitung abhaken)
  if (t.dataset && t.dataset.change && actions[t.dataset.change]) {
    guard(() => actions[t.dataset.change](t));
    return;
  }
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
    flipFill($('#caseList'), caseTable()); // Zeilen gleiten an ihren neuen Platz
    return;
  }
  if (t.dataset.casePriority !== undefined) {
    guard(() => setCasePriority(t));
    return;
  }
  if (t.dataset.caseStatus !== undefined) {
    guard(() => setCaseStatus(t));
    return;
  }
  if (t.dataset.caseOutcome !== undefined) {
    guard(() => setCaseOutcome(t));
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
    if (st.hashSkip && location.hash === st.hashSkip) {
      st.hashSkip = null; // diese Seite lädt bereits (returnToView)
      return;
    }
    const view = hashView();
    if (view !== st.view && formDirty($('#content'))) {
      if (!(await askDiscard(true))) {
        history.pushState(null, '', '#' + st.view); // auf der Seite bleiben
        return;
      }
      discardDrafts($('#content'));
    }
    await go(view);
  })
);
window.addEventListener('popstate', onPopState);
// Akte: In der Reiterzeile ist der Abschnitt markiert, in dem man gerade liest. Nach einem Klick auf einen Reiter
// bleibt dieser markiert, bis man selbst scrollt (Abschnitte ganz unten erreichen den oberen Rand nie).
let caseJumpFrame = 0;
let caseJumpPinned = null;
const unpinCaseJump = () => (caseJumpPinned = null);
['wheel', 'touchmove', 'keydown'].forEach((t) => document.addEventListener(t, unpinCaseJump, { passive: true, capture: true }));
document.addEventListener(
  'scroll',
  (e) => {
    if (e.target.id !== 'modalBody' || caseJumpFrame) return;
    caseJumpFrame = requestAnimationFrame(() => {
      caseJumpFrame = 0;
      markCaseJump();
    });
  },
  true
);
function markCaseJump() {
  const body = $('#modalBody');
  const bar = $('#modalBody .case-jump');
  if (!bar) return;
  const items = $$('.jump', bar);
  const line = bar.getBoundingClientRect().bottom + 12;
  let active = null;
  if (caseJumpPinned) active = items.find((b) => b.dataset.target === caseJumpPinned) || null;
  else if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2 && body.scrollTop > 0) active = items[items.length - 1];
  else items.forEach((b) => {
    const sec = document.getElementById(b.dataset.target);
    if (sec && sec.getBoundingClientRect().top <= line) active = b;
  });
  if (active && active.classList.contains('active')) return;
  items.forEach((b) => b.classList.toggle('active', b === active));
  if (!active) return;
  // Am Handy ist die Zeile seitlich scrollbar: den markierten Reiter sichtbar halten (nur waagerecht)
  const list = active.parentElement;
  const lr = list.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  if (ar.left < lr.left) list.scrollLeft -= lr.left - ar.left + 8;
  else if (ar.right > lr.right) list.scrollLeft += ar.right - lr.right + 8;
}
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
  if (!formDirty($('#modalBody'))) reloadCase(id).catch(() => {});
});

/* ================================================================
   Live-Aktualisierung (Server-Sent Events, GET /api/events)
   Der Server meldet nur, DASS sich etwas geändert hat (Akte X, Bereich Y) – geladen wird über die normale API.
   Nie neu gezeichnet wird, solange jemand tippt oder ungespeicherte Eingaben hat; das wird danach nachgeholt.
   ================================================================ */
// Welche Seiten ein Bereich betrifft (sonst nur die Zähler im Menü)
const LIVE_VIEWS = {
  cases: ['cases', 'overview', 'clients'],
  tasks: ['tasks', 'overview'],
  calendar: ['calendar', 'overview'],
  invoices: ['invoices', 'overview'],
  messages: ['mail'],
  concerns: ['concerns', 'concerns-board'],
  board: ['concerns-board'],
  applications: ['applications'],
  'name-requests': ['name-requests'],
  memberships: ['vip'],
  reviews: ['reviews'],
  personnel: ['personnel'],
  duty: ['duty', 'overview'],
  absences: ['duty'],
  work: ['work', 'stats'],
  clients: ['clients'],
  cooperations: ['cooperations'],
  team: ['team'],
  wiki: ['wiki'],
  snippets: ['wiki'],
  penal: ['wiki'],
  resolutions: ['resolutions'],
  storage: ['lager'],
};
const live = { es: null, ok: false, down: false, timers: new Map(), pendingView: false, pendingCase: null };
function liveLater(key, fn, ms = 300) {
  clearTimeout(live.timers.get(key));
  live.timers.set(key, setTimeout(() => (live.timers.delete(key), fn()), ms));
}
// Tippt gerade jemand (Feld mit Fokus und Inhalt) oder gibt es Ungespeichertes? Dann später.
// Eine angefangene Chat-Nachricht zählt nicht – die übernimmt das Neuzeichnen der Akte (reloadCase).
const liveBusy = (root) =>
  !root ||
  formDirty(root, { skip: '.chat-input' }) ||
  (root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !!document.activeElement.value);
function liveView() {
  if (liveBusy($('#content'))) {
    live.pendingView = true;
    return;
  }
  live.pendingView = false;
  refreshBehind();
}
// Akte vorladen beim Drüberfahren (kurz verweilen) bzw. sofort beim Antippen
let prefetchTimer = 0;
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest && e.target.closest('[data-action="open-case"][data-id]');
  if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => prefetchCase(Number(el.dataset.id)), e.pointerType === 'mouse' ? 90 : 0);
});
document.addEventListener('pointerout', (e) => {
  const el = e.target.closest && e.target.closest('[data-action="open-case"][data-id]');
  if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) clearTimeout(prefetchTimer);
});
document.addEventListener('click', () => clearTimeout(prefetchTimer), true);
document.addEventListener('ps:changed', () => casePrefetch.clear());

// Anderen federführenden Anwalt gewählt: Feld für die Übergabe einblenden
document.addEventListener('change', (e) => {
  if (e.target.id !== 'teamLead' || !$('#handoverBox')) return;
  const changed = !!e.target.value && e.target.value !== e.target.dataset.was;
  $('#handoverBox').hidden = !changed;
  if (changed) $('#handover').focus();
});

/*
 * Hover-Karte: Fährt man am PC über eine Akte außerhalb der Aktenliste (Übersicht, Aufgaben, Kalender …), zeigt eine
 * kleine Karte Mandant, Stand, nächsten Termin und Zuständigen – ohne die Akte zu öffnen. Die Daten kommen vom Vorladen.
 */
const peek = { timer: 0, el: null, card: null };
function hidePeek() {
  clearTimeout(peek.timer);
  peek.el = null;
  const card = peek.card;
  peek.card = null;
  if (!card) return;
  card.classList.remove('show');
  setTimeout(() => card.remove(), 180);
}
function peekHtml({ case: c, appointments = [] }) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const next = appointments.filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff)).sort(byStart)[0];
  const row = (k, v) => `<div class="peek-row"><span>${k}</span><strong>${v}</strong></div>`;
  return `<div class="peek-head"><span class="peek-no">${esc(c.caseNumber)}</span>${statusBadge(CASE_STATUS, c.status)}</div>
      <div class="peek-title">${esc(c.title)}</div>
      ${row('Mandant', esc(c.clientName || '–'))}
      ${row('Stand', esc(c.status === 'geschlossen' ? 'Abgeschlossen' : c.stepLabel || ''))}
      ${row('Nächster Termin', next ? `${esc(fmtDay(next.startsAt))}, ${esc(fmtTime(next.startsAt))} · ${esc(next.title)}` : '<span class="text-dim">keiner</span>')}
      ${row('Zuständig', c.lawyerName ? esc(c.lawyerName) : '<span class="text-dim">noch offen</span>')}`;
}
async function showPeek(el) {
  const id = Number(el.dataset.id);
  prefetchCase(id);
  const hit = casePrefetch.get(id);
  const data = hit && (await hit.promise.catch(() => null));
  if (!data || !data.case || peek.el !== el || !el.isConnected) return;
  const card = document.createElement('div');
  card.className = 'peek-card';
  card.setAttribute('role', 'tooltip');
  card.innerHTML = peekHtml(data);
  document.body.appendChild(card);
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - card.offsetWidth - 8);
  const top = r.bottom + 8 + card.offsetHeight > window.innerHeight ? r.top - card.offsetHeight - 8 : r.bottom + 8;
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(8, top)}px`;
  peek.card = card;
  requestAnimationFrame(() => card.classList.add('show'));
}
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !window.matchMedia('(hover: hover)').matches) return;
  const el = e.target.closest && e.target.closest('[data-action="open-case"][data-id]');
  if (!el || el === peek.el || el.closest('#caseList, #modal')) return; // Aktenliste zeigt alles selbst, im Fenster stört sie
  hidePeek();
  peek.el = el;
  peek.timer = setTimeout(() => showPeek(el), 450);
});
document.addEventListener('pointerout', (e) => {
  if (!peek.el || (e.relatedTarget && peek.el.contains(e.relatedTarget))) return;
  if (e.target.closest && e.target.closest('[data-action="open-case"][data-id]') === peek.el) hidePeek();
});
document.addEventListener('pointerdown', hidePeek, true);
window.addEventListener('scroll', hidePeek, { capture: true, passive: true });

function liveCase(ev) {
  casePrefetch.delete(ev.id);
  const open = $('#modal').classList.contains('open') && st.modalCaseId === ev.id;
  if (open) pollChat(); // neue Nachrichten anhängen – stört auch beim Tippen nicht
  if (open && !ev.chat) {
    if (document.body.classList.contains('ps-dialog-open') || liveBusy($('#modalBody'))) live.pendingCase = ev.id;
    else reloadCase(ev.id).catch(() => {}); // zeichnet auch die Seite dahinter neu
  }
  if (!open && LIVE_VIEWS.cases.includes(st.view)) liveView();
  liveLater('badges', refreshBadges, 800);
}
function liveArea(area) {
  if (area === 'snippets') st.snippets = null; // Textbausteine beim nächsten „/“ frisch laden
  if ((LIVE_VIEWS[area] || []).includes(st.view)) liveView();
  if (area === 'duty' && isStaff()) load.duty().then(renderUser).catch(() => {});
  if (area === 'applications' && typeof pollAppChat === 'function') pollAppChat();
  liveLater('badges', refreshBadges, 800);
}
// Was beim Tippen zurückgestellt wurde, nach dem Verlassen des Feldes bzw. Speichern nachholen
document.addEventListener('focusout', () =>
  liveLater(
    'pending',
    () => {
      if (live.pendingCase && st.modalCaseId === live.pendingCase) liveCase({ id: live.pendingCase });
      else live.pendingCase = null;
      if (live.pendingView) liveView();
    },
    1200
  )
);
/*
 * Weniger Live-Verbindungen: Die Kanzlei hält eine Verbindung offen, Mandanten nur, solange sie eine Akte (mit Chat)
 * offen haben – sonst fragt das Dashboard alle 30 Sekunden nach (Zähler und Liste dahinter). Ist der Tab lange
 * verdeckt, wird die Verbindung getrennt und beim Zurückkehren samt Nachholen neu aufgebaut.
 */
live.idleMs = 5 * 60 * 1000; // so lange darf ein verdeckter Tab die Verbindung halten
live.asleep = false;
const liveWanted = () => !!st.user && !live.asleep && (isStaff() || !!st.modalCaseId);
function liveDisconnect() {
  if (!live.es) return;
  live.es.close();
  live.es = null;
  live.ok = false;
  live.down = true; // beim nächsten Verbinden alles nachholen, was inzwischen passiert ist
  clearTimeout(live.downTimer);
  if (live.bar === 'down') sysBar(null);
}
function liveSync() {
  if (liveWanted()) liveConnect();
  else liveDisconnect();
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(live.idleTimer);
  if (document.hidden) {
    live.idleTimer = setTimeout(() => {
      live.asleep = true;
      liveSync();
    }, live.idleMs);
  } else if (live.asleep) {
    live.asleep = false;
    liveSync();
  }
});
setInterval(liveSync, 3000); // Mandant öffnet bzw. schließt eine Akte → Verbindung folgt

function liveConnect() {
  if (!window.EventSource || live.es || !st.user) return;
  const es = new EventSource('/api/events?tab=' + encodeURIComponent(window.PS.tab));
  live.es = es;
  es.onopen = () => {
    clearTimeout(live.downTimer);
    if (live.bar === 'down') sysBar(null);
    // Nach einem Verbindungsabbruch einmal alles nachholen, was in der Zwischenzeit passiert ist
    if (live.down) {
      refreshBadges();
      liveView();
    }
    live.ok = true;
    live.down = false;
    hereSent = undefined; // neue Verbindung: offene Akte neu melden
    hereSync();
  };
  es.onerror = () => {
    live.ok = false;
    live.down = true;
    // Länger als ein paar Sekunden weg (z. B. Update, Neustart): ruhiger Hinweis statt Fehlermeldungen – die
    // Verbindung kommt von selbst wieder, angefangene Eingaben bleiben
    clearTimeout(live.downTimer);
    live.downTimer = setTimeout(() => live.down && sysBar('down'), 4000);
  };
  es.onmessage = (m) => {
    let ev;
    try {
      ev = JSON.parse(m.data);
    } catch {
      return;
    }
    if (ev.k === 'hello') {
      if (ev.v && APP_VERSION && ev.v !== APP_VERSION) sysBar('update');
      return;
    }
    if (ev.k === 'case') liveLater(`case${ev.id}${ev.chat ? 'c' : ''}`, () => liveCase(ev));
    else if (ev.k === 'area') liveLater(`area:${ev.a}`, () => liveArea(ev.a));
    else if (ev.k === 'presence') hereShow(ev.id, ev.users);
    else if (ev.k === 'typing') typingShow(ev.id, ev.name);
  };
}

actions['app-reload'] = () => location.reload();

/** Interne Notiz oben in der Akte anpinnen bzw. lösen. */
actions['note-pin'] = async (el) => {
  const caseId = Number(el.dataset.caseId);
  const on = el.dataset.on === '1';
  await api.put(`/api/cases/${caseId}/notes/${el.dataset.id}/pin`, { on });
  toast(on ? 'Notiz oben in der Akte angepinnt.' : 'Notiz gelöst.');
  await reloadCase(caseId);
};

/** Merkliste: Stern sofort umschalten, gespeichert wird im Hintergrund (bei Fehler zurück). */
actions['case-star'] = async (el) => {
  const id = Number(el.dataset.id);
  const c = st.cases.find((x) => x.id === id);
  const on = el.getAttribute('aria-pressed') !== 'true';
  const apply = (v) => {
    if (c) c.starred = v;
    $$(`[data-action="case-star"][data-id="${id}"]`).forEach((b) => {
      b.classList.toggle('on', v);
      b.setAttribute('aria-pressed', String(v));
      b.title = v ? 'Aus der Merkliste nehmen' : 'Merken – steht dann oben';
    });
  };
  apply(on);
  try {
    await api.put(`/api/cases/${id}/star`, { on });
    toast(on ? 'Gemerkt – die Akte steht jetzt oben.' : 'Aus der Merkliste genommen.');
    if (['cases', 'overview'].includes(st.view) && !$('#modal.open')) renderView();
  } catch (err) {
    apply(!on);
    toast(err.message, 'error');
  }
};

/** Fassung, mit der dieses Dashboard geladen wurde (Versionsnummer am Skript). */
const APP_VERSION = (() => {
  try {
    return new URL(document.querySelector('script[data-staff]')?.src || '', location.href).searchParams.get('v') || '';
  } catch {
    return '';
  }
})();

/**
 * Hinweis oben: 'down' – Verbindung kurz weg (Update/Neustart, verbindet sich selbst neu); 'update' – neue Fassung
 * eingespielt, „Neu laden“ holt sie (angefangene Texte bleiben dank Entwurfsspeicher erhalten). null blendet aus.
 */
function sysBar(kind) {
  if (live.bar === 'update' && kind === 'down') return; // „Neu laden“ bleibt stehen
  live.bar = kind;
  $('#sysBar')?.remove();
  if (!kind) return;
  const bar = document.createElement('div');
  bar.id = 'sysBar';
  bar.className = 'sys-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML =
    kind === 'update'
      ? `${icon('refresh', 'ico-sm')}<span>Eine neue Version des Dashboards ist da.</span><button type="button" class="btn-gold btn-sm" data-action="app-reload">Neu laden</button>`
      : `<span class="sys-dot" aria-hidden="true"></span><span>Verbindung kurz unterbrochen – das Dashboard verbindet sich gleich neu. Ihre Eingaben bleiben erhalten.</span>`;
  document.body.appendChild(bar);
}

/*
 * „Wer ist gerade hier?“: welche Akte dieser Tab gerade offen hat, meldet er dem Server (nur bei Änderung; die Angabe
 * hängt an der Live-Verbindung). Im Akten-Chat meldet Tippen höchstens alle 2,5 Sekunden „schreibt gerade“.
 */
let hereSent;
let typedAt = 0;
const hereCaseId = () => (document.hidden ? null : Number($('#modal.open [data-case-head]')?.dataset.caseHead) || null);
function hereShow(caseId, users) {
  st.here = { caseId, users: (users || []).filter((u) => u.id !== st.user.id) };
  hereRender();
}
function herePost(caseId, typing) {
  // bewusst nicht über api.post: das wäre eine „Änderung“ (ps:changed) und keine
  return fetch('/api/events/presence', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-PS-Tab': window.PS.tab },
    body: JSON.stringify({ caseId, typing }),
  }).then((r) => (r.ok ? r.json() : null));
}
function hereSync() {
  if (!st.user || !live.ok) return;
  const id = hereCaseId();
  if (id === hereSent) return;
  hereSent = id;
  if (!id) st.here = { caseId: null, users: [] };
  herePost(id, false)
    .then((r) => {
      if (!r || !r.ok) hereSent = undefined; // nächster Takt versucht es noch einmal
      else if (id && hereCaseId() === id) hereShow(id, r.users);
    })
    .catch(() => (hereSent = undefined));
}
setInterval(hereSync, 1500);
document.addEventListener('visibilitychange', hereSync);
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('form[data-form="chat-send"]');
  if (!f || !live.ok || !e.target.value.trim() || Date.now() - typedAt < 2500) return;
  const id = Number(f.dataset.caseId);
  if (!id || id !== hereCaseId()) return;
  typedAt = Date.now();
  herePost(id, true).catch(() => {});
});
document.addEventListener('submit', (e) => e.target.matches && e.target.matches('form[data-form="chat-send"]') && (typedAt = 0), true);

// Offener Chat (Akte oder Bewerbung): neue Nachrichten nachladen – alle paar Sekunden, mit Live-Verbindung nur noch
// zur Sicherheit alle 30 Sekunden (neue Nachrichten kommen dann sofort, siehe Live-Aktualisierung unten)
let chatTick = 0;
setInterval(() => {
  chatTick++;
  if (!st.user || (live.ok && chatTick % 5)) return;
  pollChat();
  if (typeof pollAppChat === 'function') pollAppChat();
}, 6000);

// Ungelesene Post, neue Bewerbungen und Dienststatus (Badges in der Navigation, Zahl im Tab und auf dem App-Symbol)
function refreshBadges() {
  // ein Abruf für alle Zähler (wie beim Start, ohne das Konto)
  return load
    .start({ me: false })
    .then(() => (load.primed.clear(), renderNav()))
    .catch(() => {});
}
// Regelmäßig nachsehen – im Hintergrund seltener; mit Live-Verbindung nur noch alle zwei Minuten zur Sicherheit
let badgeTick = 0;
setInterval(() => {
  badgeTick++;
  if (!st.user || (document.hidden && badgeTick % 2) || (live.ok && badgeTick % 4)) return;
  refreshBadges();
  // Ohne Live-Verbindung (Mandant ohne offene Akte): auch die Seite dahinter aktuell halten
  if (!live.es && !document.hidden && !isStaff()) liveView();
}, 30000);
setInterval(() => {
  if (document.hidden || !st.user || !isStaff() || st.view === 'duty') return;
  load
    .duty()
    .then(() => renderUser())
    .catch(() => {});
}, 60000);

/* ================================================================
   Handy-Gesten: Fenster nach unten wegwischen, Seite herunterziehen zum Aktualisieren, kurzes Vibrieren bei Erfolg
   ================================================================ */
const touchUi = () => window.matchMedia('(pointer: coarse)').matches;
/** Kurzes Vibrieren als Bestätigung (nur Touch-Geräte, die es können). */
function buzz(pattern = 12) {
  try {
    if (touchUi()) navigator.vibrate?.(pattern);
  } catch {
    /* kein Vibrieren auf diesem Gerät */
  }
}
// Erfolgreich abgeschickte Formulare kurz bestätigen
document.addEventListener('ps:form-ok', () => buzz());

// Fenster (am Handy ein Blatt von unten) am Griff oder ganz oben nach unten ziehen → schließen wie mit dem X
(() => {
  const card = $('#modalCard');
  const body = $('#modalBody');
  if (!card) return;
  let drag = null; // { y, t, dy }
  const reset = () => {
    card.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    card.style.transform = '';
    setTimeout(() => (card.style.transition = ''), 260);
  };
  card.addEventListener(
    'touchstart',
    (e) => {
      if (window.innerWidth >= 640 || e.touches.length !== 1) return;
      const t = e.target;
      const onHandle = !!t.closest('.modal-head');
      if (!onHandle && (body.scrollTop > 0 || t.closest('input, textarea, select, .chip-row, .tbl-wrap, .pk-list, .law-text, [contenteditable]'))) return;
      drag = { y: e.touches[0].clientY, x: e.touches[0].clientX, t: Date.now(), dy: 0, on: false };
    },
    { passive: true }
  );
  card.addEventListener(
    'touchmove',
    (e) => {
      if (!drag) return;
      const dy = e.touches[0].clientY - drag.y;
      const dx = Math.abs(e.touches[0].clientX - drag.x);
      if (!drag.on && (dy < 8 || dx > dy)) {
        if (dy < -4 || dx > 12) drag = null; // nach oben scrollen oder seitlich wischen: keine Geste
        return;
      }
      drag.on = true;
      drag.dy = Math.max(0, dy);
      card.style.transition = 'none';
      card.style.transform = `translateY(${drag.dy}px)`;
    },
    { passive: true }
  );
  card.addEventListener('touchend', async () => {
    if (!drag) return;
    const { dy, t, on } = drag;
    drag = null;
    if (!on) return;
    const fast = dy > 50 && dy / Math.max(1, Date.now() - t) > 0.6;
    if (dy > Math.min(140, card.offsetHeight * 0.25) || fast) {
      buzz(8);
      await guard(() => modalDismiss());
    }
    reset(); // geschlossen (oder ungespeicherte Eingaben behalten): wieder an seinen Platz
  });
  card.addEventListener('touchcancel', () => {
    if (drag) reset();
    drag = null;
  });
})();

// Ganz oben auf der Seite nach unten ziehen → Seite und Zähler neu laden
(() => {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = icon('refresh');
  document.body.appendChild(ind);
  const LIMIT = 72;
  let pull = null;
  let busy = false;
  const blocked = () => busy || window.scrollY > 0 || $('#modal').classList.contains('open') || document.body.classList.contains('hearing-open') || document.body.classList.contains('ps-dialog-open');
  document.addEventListener(
    'touchstart',
    (e) => {
      if (!touchUi() || e.touches.length !== 1 || blocked() || !e.target.closest('#content')) return;
      pull = { y: e.touches[0].clientY, x: e.touches[0].clientX, d: 0 };
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!pull) return;
      const dy = e.touches[0].clientY - pull.y;
      if (window.scrollY > 0 || dy < 0 || Math.abs(e.touches[0].clientX - pull.x) > dy) {
        if (dy < 0 || window.scrollY > 0) {
          pull = null;
          ind.classList.remove('show');
        }
        return;
      }
      pull.d = Math.min(dy * 0.5, LIMIT + 24);
      ind.classList.add('show');
      ind.classList.toggle('ready', pull.d >= LIMIT);
      ind.style.transform = `translate(-50%, ${pull.d}px) rotate(${pull.d * 4}deg)`;
    },
    { passive: true }
  );
  document.addEventListener('touchend', async () => {
    if (!pull) return;
    const ready = pull.d >= LIMIT;
    pull = null;
    if (!ready) {
      ind.classList.remove('show', 'ready');
      ind.style.transform = '';
      return;
    }
    busy = true;
    buzz(10);
    ind.classList.add('spin');
    ind.style.transform = `translate(-50%, ${LIMIT}px)`;
    try {
      await Promise.all([refreshBehind(), refreshBadges()]);
    } finally {
      busy = false;
      ind.classList.remove('show', 'ready', 'spin');
      ind.style.transform = '';
    }
  });
})();

/* ================================================================
   Start
   ================================================================ */
(async function start() {
  try {
    const { me } = await load.start(); // Konto + Zähler + Dienststatus in einem Abruf
    st.user = me.user;
    st.twoFactor = me.twoFactor;
    setRanks(me.ranks);
  } catch {
    location.href = '/login?next=' + encodeURIComponent('/dashboard' + location.search + location.hash);
    return;
  }
  if (isStaff()) await loadStaffParts();
  renderUser();
  // Angefangene Texte je Konto im Browser behalten (Rechnungs-Entwurf eigens, siehe 06-rechnungen)
  window.PS.drafts.watch({ scope: `u${st.user.id}`, onRestore: () => toast('Angefangene Eingaben wiederhergestellt.') });

  const params = new URLSearchParams(location.search);
  const discordState = params.get('discord');
  const googleState = params.get('google');
  const caseParam = Number(params.get('case'));
  const eventParam = Number(params.get('event')); // Link von der Startseite: Termin(vorschlag) öffnen
  const newParam = params.get('new'); // Link von der Startseite: „Mandat einreichen“ als angemeldeter Mandant
  // Neu geladen, während eine Akte offen war: der Verlaufseintrag gehört schon zur Akte – nur wieder öffnen
  const restoring = params.has('case') && onOverlayEntry();
  // Akte per Link ohne Seite (Discord „Im Dashboard öffnen“, /akte, Startseite): dahinter liegt die Aktenliste –
  // X führt dorthin statt zur Übersicht
  const hash = location.hash || (params.has('case') && !restoring ? '#cases' : '');
  if (!restoring && (discordState || googleState || params.has('case') || params.has('event') || params.has('new'))) history.replaceState(null, '', location.pathname + hash);
  if (discordState && DISCORD_MSG[discordState]) toast(...DISCORD_MSG[discordState]);
  if (googleState && GOOGLE_MSG[googleState]) toast(...GOOGLE_MSG[googleState]);
  if (googleState) st.settingsTab = 'integrations'; // Google Docs stehen unter Einstellungen → Integrationen

  st.histPaused = true;
  try {
    await go(hashView());
    if (Number.isInteger(caseParam) && caseParam > 0) {
      await guard(() => openCase(caseParam));
      // „Jetzt bewerten“ aus der Discord-Nachricht: gleich zur Bewertung in der Akte
      if (params.get('bewerten')) $('#secReview')?.scrollIntoView({ block: 'start' });
    } else if (Number.isInteger(eventParam) && eventParam > 0) {
      await guard(async () => {
        await load.events();
        await openEvent(eventParam);
      });
    } else if (newParam === 'case') {
      await guard(() => newCaseModal());
    }
  } finally {
    st.histPaused = false;
    syncHistory();
  }
  if (st.user.needsName) askInitialName();
  liveSync();
  replayUndoDeletes(); // beim letzten Verlassen nicht mehr durchgekommene Löschungen nachholen
})();

/**
 * Verwaltungsteile (Team, Einstellungen, Discord, Statistik, Wiki, Lager …) gibt es nur für die Kanzlei – Mandanten
 * laden sie nie. Programmcode, keine Daten; nach dem ersten Mal liegt er ohnehin im Browser.
 */
function loadStaffParts() {
  const src = document.querySelector('script[data-staff]')?.dataset.staff;
  if (!src || views.settings) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => (toast('Ein Teil des Dashboards konnte nicht geladen werden – bitte neu laden.', 'error'), resolve());
    document.head.appendChild(s);
  });
}

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

/*
 * Status-Wechsel mit Übergang: Ändert sich der Status einer Zeile (Akte, Rechnung), blendet das neue Badge weich ein
 * und glänzt kurz – gemerkt wird je Zeile der letzte Text des Badges.
 */
const badgeMemory = new Map();
const rowKey = (row) =>
  row.dataset.inv
    ? `inv:${row.dataset.inv}`
    : row.dataset.key
      ? `key:${row.dataset.key}`
      : row.dataset.item
        ? `item:${row.dataset.item}`
        : row.dataset.id
          ? `${row.dataset.action === 'case-pick' ? 'open-case' : row.dataset.action || 'row'}:${row.dataset.id}`
          : '';
function markChangedBadges(root) {
  if (!root) return;
  root.querySelectorAll('[data-action="open-case"][data-id], tr[data-inv]').forEach((row) => {
    const key = rowKey(row);
    const b = row.querySelector('.badge');
    if (!key || !b) return;
    const text = b.textContent.trim();
    const was = badgeMemory.get(key);
    badgeMemory.set(key, text);
    if (was !== undefined && was !== text && !window.PS.motion.calm()) b.classList.add('badge-changed');
  });
}

/*
 * Aktenliste und Rechnungen sortieren sich weich um: Nach dem Neuzeichnen gleitet jede Zeile von ihrer alten an die
 * neue Stelle (FLIP), neue Zeilen blenden ein. Nur wenn höchstens 60 Zeilen sichtbar sind und ohne „Bewegung reduzieren“.
 */
// Aktenliste (auch im Auswahlmodus), Rechnungen, Mandanten, Lager-Gegenstände und Aufgaben
const FLIP_SEL = '#caseList tr[data-id], #content tr[data-inv], #clientList tr[data-key], #storageGrid .lager-item[data-item], #content .task-row[data-id]';
/** Liste neu zeichnen und dabei weich umsortieren (Suche beim Tippen). */
function flipFill(el, html) {
  if (!el) return;
  const before = flipSnapshot();
  el.innerHTML = html;
  flipPlay(before);
}
function flipSnapshot() {
  if (window.PS.motion.calm() || typeof Element.prototype.animate !== 'function') return null;
  const rows = $$(FLIP_SEL);
  if (!rows.length || rows.length > 60) return null;
  return new Map(rows.map((r) => [rowKey(r), r.getBoundingClientRect().top]));
}
function flipPlay(before) {
  if (!before) return;
  for (const row of $$(FLIP_SEL)) {
    const was = before.get(rowKey(row));
    if (was === undefined) {
      row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      continue;
    }
    const dy = was - row.getBoundingClientRect().top;
    if (Math.abs(dy) > 2) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}


/*
 * Tastenkürzel (PC): „?“ zeigt die Übersicht, „n“ neue Akte, „/“ Suche, „g“ und dann ein Buchstabe springt zu einer
 * Seite. Nie beim Tippen in einem Feld und nie mit Strg/Alt – so stören sie nichts.
 */
const GO_KEYS = { u: 'overview', a: 'cases', m: 'clients', t: 'tasks', k: 'calendar', r: 'invoices', p: 'mail', w: 'wiki', e: 'profile' };
let goPending = 0;
const typingIn = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
function shortcutsHelp() {
  const row = (keys, what) => `<div class="kbd-row"><span>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span><span>${esc(what)}</span></div>`;
  const go = Object.entries(GO_KEYS)
    .filter(([, v]) => allowed(v))
    .map(([k, v]) => row(['g', k], viewLabel(v)));
  openModal(`<h2 id="modalTitle" class="modal-title">Tastenkürzel</h2>
      <p class="modal-sub">Funktionieren überall im Dashboard, solange kein Eingabefeld aktiv ist.</p>
      <div class="kbd-list">${row(['?'], 'Diese Übersicht')}${row(['/'], 'Suchen')}${row(['Strg', 'K'], 'Suchen (auch beim Tippen)')}${isStaff() ? row(['n'], 'Neue Akte') : ''}${row(['Esc'], 'Fenster schließen')}${go.join('')}</div>
      <div class="form-actions mt-4"><button type="button" class="btn-ghost btn-md" data-action="close-modal">Schließen</button></div>`);
}
document.addEventListener('keydown', (e) => {
  if (!st.user || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typingIn(e.target) || document.body.classList.contains('ps-dialog-open') || document.body.classList.contains('hearing-open')) return;
  if (goPending && Date.now() - goPending < 1200 && GO_KEYS[e.key] && allowed(GO_KEYS[e.key])) {
    goPending = 0;
    e.preventDefault();
    closeModal();
    navigate(GO_KEYS[e.key]);
    return;
  }
  goPending = 0;
  if ($('#modal').classList.contains('open') && e.key !== '?') return; // im Fenster nur die Hilfe
  if (e.key === '?') {
    e.preventDefault();
    shortcutsHelp();
  } else if (e.key === '/') {
    e.preventDefault();
    guard(() => openSearch());
  } else if (e.key === 'n' && isStaff()) {
    e.preventDefault();
    guard(() => newCaseModal());
  } else if (e.key === 'g') goPending = Date.now();
});
