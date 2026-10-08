/*
 * Kanzlei-Dashboard – Teil 11 von 12: Formulare (data-form).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Formulare
   ================================================================ */
const forms = {
  'bot-ranks': async (f) => {
    const d = collectForm(f);
    const ranks = {};
    st.bot.ranks.forEach((r) => (ranks[r] = (d.ranks && d.ranks[r]) || ''));
    st.bot = await api.put('/api/bot/rank-sync', { enabled: !!d.enabled, ranks, staff: d.staff || '', board: d.board || '', associates: d.associates || '', client: d.client || '', strict: !!d.strict });
    toast(d.enabled ? 'Rang-Sync gespeichert – alle Mitglieder werden jetzt abgeglichen.' : 'Rang-Sync gespeichert (aus).');
    renderView();
  },
  'bot-connections': async (f) => {
    const d = collectForm(f);
    const rules = rcCollect(f);
    const bad = rules.findIndex((r) => !r.roleId || !r.conditions.length);
    if (bad >= 0) throw new Error(`Regel ${bad + 1}: bitte eine Hauptrolle und mindestens eine Bedingung wählen.`);
    st.bot = await api.put('/api/bot/connections', { enabled: !!d.enabled, rules });
    toast(d.enabled ? `${rules.length} Regel(n) gespeichert – alle Mitglieder werden jetzt abgeglichen.` : 'Role Connections gespeichert (aus).');
    renderView();
  },
  'bot-joinroles': async (f) => {
    const body = botJoinRolesBody(f);
    st.bot = await api.put('/api/bot/join-roles', body);
    toast(body.alwaysEnabled ? 'Gespeichert – die Standardrollen werden jetzt an alle vergeben.' : 'Join- und Standardrollen gespeichert.');
    renderView();
  },
  'msg-save': async (f) => {
    const isNew = !f.dataset.id;
    const body = msgBody(f);
    const r = isNew ? await api.post('/api/bot/messages', body) : await api.put(`/api/bot/messages/${f.dataset.id}`, body);
    st.msgId = r.template.id;
    msgRefresh(r);
    if (isNew) {
      st.msgTab = 'use';
      st.msgUseTab = 'send';
      replaceModal(msgModal(r.template));
      toast('Vorlage angelegt – jetzt senden oder automatisch posten lassen.');
    } else {
      $('#modalTitle').textContent = r.template.name;
      toast('Vorlage gespeichert.');
    }
  },
  'bot-welcome': async (f) => {
    st.bot = await api.put('/api/bot/welcome', botWelcomeBody(f));
    toast('Willkommensnachrichten gespeichert.');
    renderView();
  },
  'settings-tickets': async (f) => {
    const fd = new FormData(f);
    st.ticketSettings = await api.patch('/api/tickets/settings', {
      enabled: fd.has('enabled'),
      guildId: val(fd, 'guildId'),
      categoryId: val(fd, 'categoryId'),
      archiveId: val(fd, 'archiveId'),
      roleIds: val(fd, 'roleIds'),
      pingRoles: fd.has('pingRoles'),
      pingCooldownMin: Number(fd.get('pingCooldownMin')),
      chatImport: fd.has('chatImport'),
      boardCategoryId: val(fd, 'boardCategoryId'),
      boardArchiveId: val(fd, 'boardArchiveId'),
      boardRoleIds: val(fd, 'boardRoleIds'),
      boardApplications: fd.has('boardApplications'),
      boardConcerns: fd.has('boardConcerns'),
    });
    toast('Discord-Tickets gespeichert.');
    renderView();
  },
  'concern-new': async (f) => {
    const fd = new FormData(f);
    const res = await api.post('/api/concerns', {
      category: val(fd, 'category'),
      urgency: val(fd, 'urgency') || 'normal',
      subject: val(fd, 'subject'),
      body: val(fd, 'body'),
      anonymous: fd.has('anonymous'),
    });
    toast('Ihr Anliegen wurde an das Board of Partners übermittelt.');
    st.concernFilter = 'aktiv';
    if (st.view === 'concerns') await refreshBehind();
    else await navigate('concerns');
    load.concernCount().then(renderNav).catch(() => {});
    await openConcern(res.concern.id);
  },
  'concern-reply': async (f) => {
    const fd = new FormData(f);
    await api.post(`/api/concerns/${f.dataset.id}/messages`, { body: val(fd, 'body'), internal: fd.has('internal') });
    toast(fd.has('internal') ? 'Interne Notiz gespeichert.' : 'Nachricht gesendet.');
    await openConcern(Number(f.dataset.id));
    refreshBehind();
    load.concernCount().then(renderNav).catch(() => {});
  },
  'concern-manage': async (f) => {
    const fd = new FormData(f);
    await api.patch('/api/concerns/' + f.dataset.id, { status: val(fd, 'status'), assignedTo: val(fd, 'assignedTo') ? Number(val(fd, 'assignedTo')) : null });
    toast('Anliegen aktualisiert.');
    await openConcern(Number(f.dataset.id));
    refreshBehind();
    load.concernCount().then(renderNav).catch(() => {});
  },
  'personnel-promote': async (f) => {
    const fd = new FormData(f);
    const userId = Number(val(fd, 'userId'));
    const rank = val(fd, 'rank');
    if (!userId || !rank) throw new Error('Bitte Teammitglied und neuen Rang wählen.');
    const person = st.personnel.staff.find((s) => s.id === userId);
    const r = await api.post('/api/personnel/promote', { userId, rank, note: val(fd, 'note') || undefined });
    toast(r.type === 'befoerderung' ? `Beförderung eingetragen – ${person ? person.name : 'das Teammitglied'} ist jetzt ${rank}.` : `${r.typeLabel} eingetragen.`);
    // Ränge stecken auch in Auswahllisten (Anwälte, Empfänger) – beim nächsten Öffnen neu laden.
    st.lawyers = [];
    st.contacts = null;
    await modalBack();
    await refreshBehind();
  },
  'new-case': async (f) => {
    const fd = new FormData(f);
    const body = { title: val(fd, 'title'), area: val(fd, 'area'), urgency: val(fd, 'urgency'), description: val(fd, 'description') };
    if (isStaff()) {
      if (val(fd, 'clientEmail')) body.clientEmail = val(fd, 'clientEmail');
      else if (!val(fd, 'clientName')) throw new Error('Bitte den Namen des Mandanten oder die E-Mail eines Mandantenkontos angeben.');
      ['clientName', 'clientPhone', 'opponent', 'courtRef'].forEach((k) => {
        if (val(fd, k)) body[k] = val(fd, k);
      });
      if (f.elements.lawyerId) body.lawyerId = val(fd, 'lawyerId') ? Number(val(fd, 'lawyerId')) : null;
      if (f.querySelector('[data-team]')) body.coLawyerIds = fd.getAll('coLawyerIds').map(Number);
      if (val(fd, 'priority')) body.priority = Number(val(fd, 'priority'));
    }
    const res = await api.post('/api/cases', body);
    toast(`Akte ${res.case.caseNumber} angelegt.`);
    st.caseFilter = 'aktiv';
    await navigate('cases');
    await openCase(res.case.id);
  },
  'case-edit': async (f) => {
    const fd = new FormData(f);
    const id = Number(f.dataset.id);
    const body = {};
    ['title', 'area', 'urgency', 'clientName', 'clientPhone', 'opponent', 'courtRef', 'description', 'publicNote'].forEach((k) => {
      if (f.elements[k]) body[k] = val(fd, k);
    });
    if (f.elements.step) body.step = Number(fd.get('step'));
    if (f.elements.priority) body.priority = Number(fd.get('priority'));
    if (f.elements.lawyerId) body.lawyerId = fd.get('lawyerId') ? Number(fd.get('lawyerId')) : null;
    if (f.querySelector('[data-team]')) body.coLawyerIds = fd.getAll('coLawyerIds').map(Number);
    await api.patch('/api/cases/' + id, body);
    toast('Akte gespeichert.');
    await reloadCase(id);
  },
  'process-ticket': async (f) => {
    const fd = new FormData(f);
    const id = Number(f.dataset.id);
    await api.put(`/api/cases/${id}/process-ticket`, { url: val(fd, 'url'), label: val(fd, 'label') });
    toast('Prozessticket gespeichert.');
    await reloadCase(id);
  },
  'inv-pay-report': async (f) => {
    const id = Number(f.dataset.id);
    const file = f.elements.proof.files[0];
    await api.post(`/api/invoices/${id}/payment-report`, { note: val(new FormData(f), 'note') });
    let proofFailed = false;
    if (file) {
      try {
        await api.upload(`/api/invoices/${id}/payment-proof`, await resizeImage(file, { max: 1600 }));
      } catch {
        proofFailed = true; // Meldung ist trotzdem angekommen – Screenshot lässt sich nachreichen
      }
    }
    await returnOrClose();
    if (proofFailed) toast('Zahlung gemeldet – der Screenshot konnte nicht hochgeladen werden. Bitte über „Screenshot nachreichen“ erneut versuchen.', 'error');
    else toast('Danke! Die Zahlung ist gemeldet – die Kanzlei prüft den Eingang und bestätigt ihn.');
  },
  'inv-pay-reject': async (f) => {
    await api.post(`/api/invoices/${f.dataset.id}/payment-reject`, { reason: val(new FormData(f), 'reason') });
    await returnOrClose();
    load.paymentReports().then(renderNav).catch(() => {});
    toast('Meldung zurückgewiesen – der Mandant wird informiert.');
  },
  'initial-name': async (f) => {
    const r = await api.post('/api/auth/initial-name', { displayName: val(new FormData(f), 'displayName') });
    st.user = r.user;
    renderUser();
    closeModal();
    toast(`Danke, ${r.user.displayName}! Ihr Konto ist eingerichtet.`);
    if (st.view === 'overview' || st.view === 'cases') refreshBehind();
  },
  'chat-send': async (f) => {
    const input = f.elements.body;
    const body = input.value.trim();
    if (!body) return;
    const caseId = Number(f.dataset.caseId);
    const r = await api.post(`/api/cases/${caseId}/notes`, { body, internal: false });
    input.value = '';
    input.style.height = '';
    if (r.message) chatAppend($('#chatList'), [r.message], caseBubble);
    input.focus();
  },
  'app-message': async (f) => {
    const input = f.elements.body;
    const body = input.value.trim();
    if (!body) return;
    const r = await api.post(`/api/admin/applications/${f.dataset.id}/messages`, { body });
    input.value = '';
    input.style.height = '';
    chatAppend($('#appChatList'), [r.message], appBubble);
    if (!r.discordSent) toast('Gesendet – der Bewerber sieht die Nachricht auf seiner Bewerberseite.');
    input.focus();
  },
  'add-note': async (f) => {
    const fd = new FormData(f);
    const id = Number(f.dataset.id);
    await api.post(`/api/cases/${id}/notes`, { body: val(fd, 'body'), internal: fd.get('internal') === 'on' });
    toast('Eintrag gespeichert.');
    await reloadCase(id);
  },
  event: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    if (!fd.get('startsAt')) throw new Error('Bitte Datum und Uhrzeit angeben.');
    const body = {
      type: val(fd, 'type'),
      title: val(fd, 'title'),
      startsAt: new Date(fd.get('startsAt')).toISOString(),
      endsAt: fd.get('endsAt') ? new Date(fd.get('endsAt')).toISOString() : null,
      location: val(fd, 'location'),
      note: val(fd, 'note'),
      caseId: fd.get('caseId') ? Number(fd.get('caseId')) : null,
      assignedTo: fd.get('assignedTo') ? Number(fd.get('assignedTo')) : null,
      clientVisible: fd.get('clientVisible') === 'on',
    };
    if (id) await api.patch('/api/calendar/' + id, body);
    else await api.post('/api/calendar', body);
    toast(id ? 'Eintrag gespeichert.' : 'Eintrag angelegt.');
    await returnOrClose();
  },
  'event-request': async (f) => {
    const fd = new FormData(f);
    if (!fd.get('startsAt')) throw new Error('Bitte einen Wunschtermin angeben.');
    const body = { title: val(fd, 'title'), startsAt: new Date(fd.get('startsAt')).toISOString(), location: val(fd, 'location'), note: val(fd, 'note') };
    if (fd.get('caseId')) body.caseId = Number(fd.get('caseId'));
    await api.post('/api/calendar', body);
    toast('Terminanfrage gesendet – die Kanzlei bestätigt Ihren Termin.');
    await returnOrClose();
  },
  compose: async (f) => {
    const fd = new FormData(f);
    const recipient = val(fd, 'recipient');
    if (!recipient) throw new Error('Bitte einen Empfänger auswählen.');
    const body = { subject: val(fd, 'subject'), body: val(fd, 'body'), priority: fd.get('priority') === 'on' };
    if (recipient === 'broadcast') body.broadcast = true;
    else body.recipientId = Number(recipient);
    if (fd.get('caseId')) body.caseId = Number(fd.get('caseId'));
    const res = await api.post('/api/messages', body);
    toast(res.sent > 1 ? `Rundschreiben an ${res.sent} Teammitglieder versendet.` : 'Nachricht gesendet.');
    if (st.view === 'mail' && !st.returnCase) {
      st.mailBox = 'sent';
      st.mailSel = null;
    }
    await returnOrClose();
  },
  board: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = { title: val(fd, 'title'), body: val(fd, 'body'), color: val(fd, 'color') || 'gold', pinned: fd.get('pinned') === 'on' };
    if (id) await api.patch('/api/board/' + id, body);
    else await api.post('/api/board', body);
    toast('Notiz gespeichert.');
    await modalBack();
    await refreshBehind();
  },
  invoice: async () => {
    const d = st.draft;
    const items = d.items
      .map((it) => ({ description: String(it.description || '').trim(), quantity: Math.max(1, Math.round(Number(it.quantity) || 1)), unitPrice: Math.max(0, Math.round(Number(it.unitPrice) || 0)) }))
      .filter((it) => it.description);
    if (!items.length) throw new Error('Bitte mindestens eine Position mit Bezeichnung erfassen.');
    if (!d.clientName.trim()) throw new Error('Bitte den Empfänger angeben.');
    const res = await api.post('/api/invoices', {
      kind: d.kind,
      caseId: d.caseId || null,
      clientName: d.clientName.trim(),
      clientContact: d.clientContact.trim(),
      subject: d.subject.trim(),
      items,
      discountPct: clampPct(d.discountPct),
      surchargePct: clampPct(d.surchargePct),
      cooperationId: draftCoop(d) ? d.coopId : null,
      membershipId: draftMember(d) ? d.memberId : null,
      dueDate: d.dueDate || null,
      notes: d.notes.trim(),
    });
    st.draft = null;
    const inv = res.invoice;
    // Aus einer Akte heraus erstellt: zurück in die Akte, die Bestätigung liegt darüber (Schließen → Akte)
    const from = st.invoiceFrom;
    if (from) {
      await navigate(from.view);
      await openCase(from.caseId);
    } else await navigate('invoices');
    openModal(`
        <h2 class="modal-title">${esc(INVOICE_KIND[inv.kind])} erstellt</h2>
        <p class="modal-sub">Nummer <span class="font-mono text-gold">${esc(inv.number)}</span> über <strong>${money(inv.total)}</strong> an ${esc(inv.clientName)}.</p>
        <div class="form-actions">
          <a class="btn-gold btn-md" href="/invoice.html?id=${inv.id}" target="_blank" rel="noopener">${icon('printer', 'ico-sm')}<span>Drucken / Als PDF speichern</span></a>
          <button class="btn-ghost btn-md" data-action="close-modal">Schließen</button>
        </div>`, { child: !!from });
  },
  coop: async (f) => {
    const fd = new FormData(f);
    const roles = [...fd.getAll('role'), ...String(fd.get('roleIdsExtra') || '').split(/[\s,;]+/)].map((x) => String(x).trim()).filter(Boolean);
    const body = {
      name: val(fd, 'name'),
      discountPct: Number(fd.get('discountPct')),
      validUntil: fd.get('validUntil') || null,
      active: fd.get('active') === 'on',
      description: val(fd, 'description'),
      guildId: val(fd, 'guildId'),
      roleIds: [...new Set(roles)].join(','),
    };
    if (f.dataset.id) await api.patch(`/api/cooperations/${f.dataset.id}`, body);
    else await api.post('/api/cooperations', body);
    toast(f.dataset.id ? 'Kooperation gespeichert.' : `Kooperation „${body.name}“ angelegt.`);
    await modalBack();
    await refreshBehind();
  },
  'name-direct': async (f) => {
    const fd = new FormData(f);
    const res = await api.post('/api/name-requests/direct', { userId: Number(f.dataset.userId), newName: val(fd, 'newName'), reason: val(fd, 'reason') || undefined });
    toast(`Name geändert – ${res.user.displayName}.`);
    st.lawyers = [];
    st.contacts = null;
    if (f.dataset.self) {
      st.user = (await api.get('/api/auth/me')).user;
      renderUser();
      await refreshBehind();
      return;
    }
    // Suchergebnis in „Namensänderungen“ gleich mit dem neuen Namen zeigen
    const acc = (st.nameAccounts || []).find((a) => a.id === res.user.id);
    if (acc) acc.name = res.user.displayName;
    await returnOrClose();
  },
  'name-request': async (f) => {
    const fd = new FormData(f);
    await api.post('/api/name-requests', { newName: val(fd, 'newName'), reason: val(fd, 'reason') || undefined });
    toast('Antrag gestellt – das Board of Partners entscheidet.');
    await refreshBehind();
  },
  'name-reject': async (f) => {
    const fd = new FormData(f);
    await api.post(`/api/name-requests/${f.dataset.id}/decide`, { approve: false, note: val(fd, 'note') });
    toast('Abgelehnt.');
    await modalBack();
    await refreshBehind();
  },
  'vipreq-accept': async (f) => {
    const fd = new FormData(f);
    const res = await api.post(`/api/memberships/requests/${f.dataset.id}/accept`, { paid: fd.get('paid') === 'on', note: val(fd, 'note') || undefined });
    toast(res.request.status === 'aktiv' ? `Angenommen und freigeschaltet · Rechnung ${res.invoice.number}.` : `Angenommen · Rechnung ${res.invoice.number} – freigeschaltet wird nach Zahlung.`);
    (res.warnings || []).forEach((w) => toast(w, 'error'));
    await modalBack();
    await refreshBehind();
  },
  'vipreq-decline': async (f) => {
    const fd = new FormData(f);
    await api.post(`/api/memberships/requests/${f.dataset.id}/decline`, { reason: val(fd, 'reason') });
    toast('Anfrage abgelehnt.');
    await modalBack();
    await refreshBehind();
  },
  'vip-request': async (f) => {
    const fd = new FormData(f);
    await api.post('/api/memberships/requests', { tierId: Number(f.dataset.id), message: val(fd, 'message') || undefined });
    toast('Anfrage gesendet – das Board of Partners meldet sich.');
    await modalBack();
    await refreshBehind();
  },
  tier: async (f) => {
    const fd = new FormData(f);
    const kind = val(fd, 'kind');
    const body = {
      name: val(fd, 'name'),
      kind,
      price: Math.round(Number(fd.get('price')) || 0),
      discountPct: Number(fd.get('discountPct')) || 0,
      durationDays: kind === 'perma' ? null : Math.round(Number(fd.get('durationDays')) || 0) || null,
      benefits: val(fd, 'benefits'),
      discordRoleId: val(fd, 'discordRoleId'),
      active: fd.get('active') === 'on',
    };
    if (f.dataset.id) await api.patch(`/api/memberships/tiers/${f.dataset.id}`, body);
    else await api.post('/api/memberships/tiers', body);
    toast(f.dataset.id ? 'Stufe gespeichert.' : `Stufe „${body.name}“ angelegt.`);
    await modalBack();
    await refreshBehind();
  },
  'vip-grant': async (f) => {
    const fd = new FormData(f);
    const body = { userId: Number(fd.get('userId')), tierId: Number(fd.get('tierId')), invoice: fd.get('invoice') === 'on', note: val(fd, 'note') || undefined };
    if (!body.userId) throw new Error('Bitte einen Mandanten aus der Liste auswählen.');
    let res;
    try {
      res = await api.post('/api/memberships', body);
    } catch (e) {
      if (e.status !== 409) throw e;
      if (!(await ask(`${e.message} Die bisherige Mitgliedschaft wird beendet und durch die neue ersetzt.`, { title: 'Mitgliedschaft ersetzen?', confirmText: 'Ersetzen' }))) return;
      res = await api.post('/api/memberships', { ...body, replace: true });
    }
    toast(`${res.membership.tierName} für ${res.membership.name} vergeben${res.invoice ? ` · Rechnung ${res.invoice.number}` : ''}.`);
    (res.warnings || []).forEach((w) => toast(w, 'error'));
    await modalBack();
    await refreshBehind();
  },
  'vip-renew': async (f) => {
    const fd = new FormData(f);
    const res = await api.post(`/api/memberships/${f.dataset.id}/renew`, { invoice: fd.get('invoice') === 'on' });
    toast(`Verlängert bis ${fmtDateOnly(String(res.membership.expiresAt).slice(0, 10))}${res.invoice ? ` · Rechnung ${res.invoice.number}` : ''}.`);
    (res.warnings || []).forEach((w) => toast(w, 'error'));
    await modalBack();
    await refreshBehind();
  },
  'vip-end': async (f) => {
    const fd = new FormData(f);
    const res = await api.post(`/api/memberships/${f.dataset.id}/end`, { reason: val(fd, 'reason') || undefined });
    toast('Mitgliedschaft beendet.');
    (res.warnings || []).forEach((w) => toast(w, 'error'));
    await modalBack();
    await refreshBehind();
  },
  team: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = {
      name: val(fd, 'name'),
      roleTitle: val(fd, 'roleTitle'),
      tier: val(fd, 'tier'),
      description: val(fd, 'description'),
      initials: val(fd, 'initials'),
      visible: fd.get('visible') === 'on',
    };
    const mode = fd.get('accountMode');
    if (mode === 'link') {
      const userId = Number(fd.get('userId'));
      if (!userId) throw new Error('Bitte ein Konto zum Verknüpfen auswählen.');
      body.userId = userId;
    } else if (mode === 'create') {
      const email = val(fd, 'accountEmail');
      if (!email) throw new Error('Bitte eine E-Mail-Adresse für das Login-Konto angeben.');
      body.createAccount = { email, role: val(fd, 'accountRole') };
    }
    if (fd.get('unlink') === 'on') body.userId = null;
    const res = id ? await api.patch('/api/admin/team/' + id, body) : await api.post('/api/admin/team', body);
    toast(id ? 'Gespeichert – live auf der Website.' : 'Hinzugefügt – live auf der Website.');
    st.lawyers = [];
    st.contacts = null;
    if (res.credentials) showCredentials(res.credentials, body.name);
    else await modalBack();
    await refreshBehind();
  },
  'team-delete': async (f) => {
    const fd = new FormData(f);
    const res = await api.del(`/api/admin/team/${f.dataset.id}${fd.get('lock') === 'on' ? '?lockAccount=1' : ''}`);
    toast(res.accountLocked ? 'Profil entfernt und Login-Konto gesperrt.' : 'Profil entfernt.');
    await modalBack();
    await refreshBehind();
  },
  'user-new': async (f) => {
    const fd = new FormData(f);
    const body = { displayName: val(fd, 'displayName'), email: val(fd, 'email'), role: val(fd, 'role') };
    if (val(fd, 'rank')) body.rank = val(fd, 'rank');
    if (val(fd, 'phone')) body.phone = val(fd, 'phone');
    const res = await api.post('/api/admin/users', body);
    st.lawyers = [];
    st.contacts = null;
    showCredentials(res.credentials, body.displayName);
    await refreshBehind();
  },
  fee: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = {
      name: val(fd, 'name'),
      category: val(fd, 'category'),
      price: Math.max(0, Math.round(Number(fd.get('price')) || 0)),
      description: val(fd, 'description'),
      inCalculator: fd.get('inCalculator') === 'on',
      active: fd.get('active') === 'on',
    };
    if (val(fd, 'sortOrder') !== '') body.sortOrder = Math.max(0, Math.round(Number(fd.get('sortOrder')) || 0));
    if (id) await api.patch('/api/admin/fees/' + id, body);
    else await api.post('/api/admin/fees', body);
    toast('Honorarordnung aktualisiert – live auf der Website.');
    await modalBack();
    await refreshBehind();
  },
  'settings-discord': async (f) => {
    const fd = new FormData(f);
    const events = $$('input[name="events"]:checked', f).map((i) => i.value);
    const pingEvents = $$('input[name="pingEvents"]:checked', f).map((i) => i.value);
    const eventWebhooks = {};
    $$('input[name="eventWebhook"]', f).forEach((i) => {
      if (i.value.trim()) eventWebhooks[i.dataset.event] = i.value.trim();
    });
    const eventRoles = {};
    $$('input[name="eventRole"]', f).forEach((i) => {
      if (i.value.trim()) eventRoles[i.dataset.event] = i.value.trim();
    });
    const res = await api.patch('/api/admin/settings', {
      discordWebhookUrl: val(fd, 'webhook'),
      discordEvents: events,
      discordPingRole: val(fd, 'pingRole'),
      discordPingEvents: pingEvents,
      discordEventWebhooks: eventWebhooks,
      discordEventRoles: eventRoles,
    });
    st.settings = res.settings;
    toast('Discord-Einstellungen gespeichert.');
    renderView();
  },
  'settings-website': async (f) => {
    const res = await api.patch('/api/admin/settings', { showDutyPublic: !!f.elements.showDutyPublic.checked });
    st.settings = res.settings;
    toast('Website-Einstellungen gespeichert.');
  },
  'duty-note': async (f) => {
    await setDutyStatus(myDutyStatus(), val(new FormData(f), 'note'));
  },
  'duty-session': async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const iso = (k) => (fd.get(k) ? new Date(fd.get(k)).toISOString() : undefined);
    if (id) {
      const body = { startedAt: iso('startedAt'), note: val(fd, 'note') };
      if (iso('endedAt')) body.endedAt = iso('endedAt');
      await api.patch('/api/duty/sessions/' + id, body);
    } else {
      await api.post('/api/duty/sessions', { userId: Number(fd.get('userId')), startedAt: iso('startedAt'), endedAt: iso('endedAt'), note: val(fd, 'note') });
    }
    toast('Dienstzeit gespeichert.');
    await modalBack();
    await refreshBehind();
  },
  'app-interview': async (f) => {
    const fd = new FormData(f);
    if (!fd.get('startsAt')) throw new Error('Bitte einen Termin wählen.');
    const data = await api.post(`/api/admin/applications/${f.dataset.id}/interview`, {
      startsAt: new Date(fd.get('startsAt')).toISOString(),
      location: val(fd, 'location'),
    });
    toast('Gespräch geplant – der Termin steht im Kalender.');
    await reloadApplication(data);
  },
  'app-note': async (f) => {
    const data = await api.post(`/api/admin/applications/${f.dataset.id}/notes`, { body: val(new FormData(f), 'body') });
    toast('Notiz gespeichert.');
    await reloadApplication(data);
  },
  'app-hire': async (f) => {
    const fd = new FormData(f);
    const res = await api.post(`/api/admin/applications/${f.dataset.id}/hire`, {
      email: val(fd, 'email'),
      rank: val(fd, 'rank'),
      role: val(fd, 'role'),
      description: val(fd, 'description'),
      createProfile: fd.get('createProfile') === 'on',
      visible: fd.get('visible') === 'on',
    });
    st.lawyers = [];
    st.contacts = null;
    toast(`${res.application.name} wurde eingestellt.`);
    showCredentials(res.credentials, res.application.name);
    refreshBehind();
  },
  position: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = { title: val(fd, 'title'), description: val(fd, 'description'), requirements: val(fd, 'requirements'), active: fd.get('active') === 'on' };
    if (id) await api.patch('/api/admin/positions/' + id, body);
    else await api.post('/api/admin/positions', body);
    toast('Stelle gespeichert – live auf der Karriereseite.');
    await modalBack();
    await refreshBehind();
  },
  'ext-link': async (f) => {
    const fd = new FormData(f);
    const provider = f.dataset.provider;
    if (provider === 'fivenet' && fd.get('attest') !== 'on') throw new Error('Bitte bestätigen Sie, dass Sie das Dokument in FiveNet selbst einsehen dürfen.');
    const res = await api.post(extUrl(f.dataset.caseId), { provider, input: val(fd, 'input'), attest: provider === 'fivenet', ...fivenetBody(f) });
    st.fivenet = null; // Vorschläge (Dokumentarten, Charakter) neu laden
    toast(`${EXT[provider].noun} mit der Akte verknüpft.`);
    reportImport(await importPendingImages(Number(f.dataset.caseId), res.document));
    await returnOrClose();
  },
  absence: async (f) => {
    const fd = new FormData(f);
    const body = { startDate: val(fd, 'startDate'), endDate: val(fd, 'endDate'), reason: val(fd, 'reason') || 'sonstiges', note: val(fd, 'note') };
    if (f.elements.userId) body.userId = Number(fd.get('userId'));
    await api.post('/api/absences', body);
    toast('Abmeldung eingetragen.');
    await modalBack();
    await afterAbsenceChange();
  },
  'tpl-save': async (f) => {
    const fd = new FormData(f);
    const body = { name: val(fd, 'name'), body: String(fd.get('body') || ''), active: fd.get('active') === 'on', kind: val(fd, 'kind') || 'vertrag' };
    if (f.dataset.id) await api.patch(`/api/contract-templates/${f.dataset.id}`, body);
    else await api.post('/api/contract-templates', body);
    toast('Vorlage gespeichert.');
    await modalBack();
    await refreshSettingsTemplates();
  },
  'contract-header': async (f) => {
    await api.put('/api/contract-templates/header', { header: String(new FormData(f).get('header') || '').trim() });
    toast('Kopfzeile gespeichert.');
    await refreshSettingsTemplates();
  },
  'contract-new': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const res = await api.post(`/api/cases/${caseId}/contracts`, { templateId: Number(new FormData(f).get('templateId')), ...contractBody(f) });
    toast('Vertrag erstellt – jetzt ansehen und unterschreiben.');
    st.contractTabAt = Date.now();
    window.open(`/vertrag.html?id=${res.contract.id}`, '_blank', 'noopener');
    await returnOrClose();
  },
  'contract-edit': async (f) => {
    await api.patch(`/api/contracts/${f.dataset.id}`, contractBody(f));
    toast('Vertrag gespeichert.');
    await returnOrClose();
  },
  review: async (f) => {
    const fd = new FormData(f);
    const body = { rating: Number(fd.get('rating')), body: val(fd, 'body'), nameMode: val(fd, 'nameMode') };
    if (!body.rating) throw new Error('Bitte wählen Sie 1 bis 5 Sterne.');
    if (f.dataset.id) await api.patch('/api/reviews/' + f.dataset.id, body);
    else await api.post('/api/reviews', { ...body, caseId: Number(f.dataset.caseId) });
    st.reviewEdit = null;
    toast('Vielen Dank für Ihre Bewertung! Sie erscheint nach Prüfung auf der Website.');
    await reloadCase(Number(f.dataset.caseId));
  },
  'brief-new': async (f) => {
    const caseId = Number(f.dataset.caseId);
    const vis = $('#bf_visible', f);
    const res = await api.post(`/api/cases/${caseId}/contracts`, { templateId: Number(new FormData(f).get('templateId')), ...briefBody(f), internal: vis ? !vis.checked : true });
    toast(res.contract.needsClient ? 'Erstellt – der Mandant kann jetzt im Portal unterschreiben.' : 'Schriftsatz erstellt – jetzt ansehen, unterschreiben und drucken.');
    st.contractTabAt = Date.now();
    window.open(`/vertrag.html?id=${res.contract.id}`, '_blank', 'noopener');
    await returnOrClose();
  },
  'brief-edit': async (f) => {
    await api.patch(`/api/contracts/${f.dataset.id}`, briefBody(f));
    toast('Schriftsatz gespeichert.');
    await returnOrClose();
  },
  'ext-edit': async (f) => {
    const res = await api.patch(extUrl(f.dataset.caseId, f.dataset.id), fivenetBody(f));
    st.fivenet = null;
    toast('Angaben gespeichert.');
    reportImport(await importPendingImages(Number(f.dataset.caseId), res.document));
    await returnOrClose();
  },
  'settings-fivenet': async (f) => {
    const res = await api.patch('/api/admin/settings', { fivenetUrl: val(new FormData(f), 'fivenetUrl') });
    st.settings = res.settings;
    await load.fivenet(true);
    toast('FiveNet-Einstellungen gespeichert.');
    renderView();
  },
  'task-quick': async (f) => {
    const fd = new FormData(f);
    const body = { title: val(fd, 'title'), caseId: Number(f.dataset.caseId) };
    if (val(fd, 'dueDate')) body.dueDate = val(fd, 'dueDate');
    await api.post('/api/tasks', body);
    toast(body.dueDate ? 'Wiedervorlage angelegt.' : 'Aufgabe angelegt.');
    await afterTaskChange();
  },
  task: async (f) => {
    const fd = new FormData(f);
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const body = {
      title: val(fd, 'title'),
      note: val(fd, 'note'),
      dueDate: val(fd, 'dueDate') || null,
      assignedTo: val(fd, 'assignedTo') ? Number(val(fd, 'assignedTo')) : null,
    };
    if (id) {
      await api.patch('/api/tasks/' + id, body);
    } else {
      if (val(fd, 'caseId')) body.caseId = Number(val(fd, 'caseId'));
      await api.post('/api/tasks', body);
    }
    toast(id ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
    load.dueTasks().then(renderNav).catch(() => {});
    await returnOrClose();
  },
  'settings-firm': async (f) => {
    const fd = new FormData(f);
    const res = await api.patch('/api/admin/settings', {
      firmAddress: val(fd, 'firmAddress'),
      firmPaymentInfo: val(fd, 'firmPaymentInfo'),
      firmContact: val(fd, 'firmContact'),
      invoiceReminderDays: Number(val(fd, 'invoiceReminderDays') || 0),
    });
    st.settings = res.settings;
    toast('Rechnungsdaten gespeichert.');
  },
  profile: async (f) => {
    const fd = new FormData(f);
    const body = { phone: val(fd, 'phone') };
    if (f.elements.displayName) body.displayName = val(fd, 'displayName');
    const res = await api.patch('/api/auth/profile', body);
    st.user = res.user;
    renderUser();
    toast('Profil gespeichert.');
  },
  password: async (f) => {
    const fd = new FormData(f);
    if (fd.get('newPassword') !== fd.get('newPassword2')) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
    await api.post('/api/auth/change-password', { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') });
    st.user.mustChangePassword = false;
    toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
    renderView();
  },
};
