/*
 * Kanzlei-Dashboard – Teil 10 von 14: Aktionen (Klicks auf data-action).
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ================================================================
   Allgemeine Aktionen (Klicks): Fenster, Menü, Einstellungen, System, Discord-Bot. Die Aktionen der Bereiche stehen
   in deren Dateien (Object.assign(actions, …)); die Liste selbst ist in 01-basis.js angelegt.
   ================================================================ */
Object.assign(actions, {
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
    if (window.PS.offline) await window.PS.offline.clear(); // ebenso der Offline-Zwischenspeicher
    setAppBadge(0); // Zahl auf dem App-Symbol gehört ebenfalls zu diesem Konto
    await api.post('/api/auth/logout');
    location.href = '/login';
  },
  copy: async (el) => {
    const text = el.dataset.text || '';
    const ok = await copy(text);
    toast(ok ? (text.length <= 40 && !/\s/.test(text) ? `„${text}“ kopiert.` : 'In die Zwischenablage kopiert.') : 'Kopieren nicht möglich – bitte manuell markieren.', ok ? 'ok' : 'error');
  },
  // Lange Listen: nächste Einträge (passiert beim Scrollen auch von selbst)
  'list-more': (el) => showMoreRows(el.dataset.id),
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
  'tpl-new': () => openModal(templateForm(null), { wide: true }),
  'tpl-edit': (el) => {
    const x = st.contractTemplates.templates.find((t) => t.id === Number(el.dataset.id));
    if (x) openModal(templateForm(x), { wide: true });
  },
  'settings-tab': async (el) => {
    st.settingsTab = SETTINGS_LEGACY[el.dataset.tab] || el.dataset.tab;
    history.replaceState(history.state, '', `${location.pathname}?tab=${st.settingsTab}#settings`);
    if (st.settingsTab === 'bot' && st.bot && !st.botDiscord) await loadBotDiscord();
    if (st.settingsTab === 'health') st.system = await api.get('/api/system');
    await settingsSwitch(() => renderView()); // Leiste bleibt stehen, der Inhalt daneben blendet über
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
});

/* Mein Profil → Animationen: Saison-Deko auf diesem Gerät an/aus (Kästchen: über „change“, nicht als Klick-Aktion) */
document.addEventListener('change', (e) => {
  if (!e.target.matches || !e.target.matches('[data-season-toggle]') || !window.PS.season) return;
  window.PS.season.off(!e.target.checked);
  toast(e.target.checked ? 'Saison-Deko ist auf diesem Gerät an.' : 'Saison-Deko ist auf diesem Gerät aus.');
});
