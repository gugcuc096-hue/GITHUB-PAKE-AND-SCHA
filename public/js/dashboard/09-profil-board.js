/*
 * Kanzlei-Dashboard – Teil 9 von 12: Profil, VIP & Lifetime, Namensänderungen, Mandantenstimmen, Anliegen, Personal, Kooperationen, Aktenbearbeitung, Abmeldungen, Bewerbungen, Protokoll, Bild-Uploads.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Profil */
views.profile = {
  async load() {
    const [me, ds, coops, names, member, sessions] = await Promise.all([
      api.get('/api/auth/me'),
      api.get('/api/discord/status'),
      isStaff() ? null : api.get('/api/cooperations/mine').catch(() => null),
      api.get('/api/name-requests/mine').catch(() => ({ requests: [] })),
      isStaff() ? null : api.get('/api/memberships/mine').catch(() => null),
      api.get('/api/auth/sessions').catch(() => ({ others: 0 })),
      load.fivenet(),
    ]);
    st.otherSessions = sessions.others;
    st.myCoops = coops ? coops.matches : [];
    st.myNameRequests = names.requests;
    st.myMembership = member ? member.membership : null;
    st.user = me.user;
    st.discordOAuth = ds.oauth;
    renderUser();
  },
  render() {
    const u = st.user;
    const discord = u.discord
      ? `<div class="flex items-center gap-3 mb-4"><span class="avatar lg">${avatarInner(u)}</span><div><div class="font-semibold">${esc(u.discord.username || 'Discord-Konto')}</div><div class="text-xs text-dim">Verbunden · Anmeldung per Discord möglich</div></div></div>
           <button class="btn-outline btn-md" data-action="discord-unlink">Verbindung trennen</button>`
      : st.discordOAuth
        ? `<p class="text-sm text-muted mb-4">Verbinden Sie Ihr Discord-Konto, um sich künftig mit einem Klick anzumelden${isStaff() ? ' und bei Fristen oder neuen Akten im Kanzlei-Discord erwähnt zu werden' : ''}.</p>
             <a class="btn-discord btn-md" href="/api/discord/connect">${DISCORD_ICON}<span>Mit Discord verbinden</span></a>`
        : `<p class="text-sm text-muted">Das Board of Partners hat die Discord-Anmeldung noch nicht eingerichtet.${isAdmin() ? ' <a href="/dashboard.html?tab=general#settings" class="text-gold underline">Einstellungen → Discord-Login</a> zeigt, was fehlt.' : ''}</p>`;
    return `
        ${u.mustChangePassword ? `<div class="banner banner-amber">${icon('alert')}<div><strong>Bitte jetzt ein eigenes Passwort festlegen.</strong> Ihr aktuelles Passwort wurde automatisch erzeugt oder vom Board of Partners zurückgesetzt.</div></div>` : ''}
        <div class="page-head"><div><h1 class="page-title">Mein Profil</h1><p class="page-sub">Kontaktdaten, Passwort, Discord${isStaff() ? ' und FiveNet' : ''}.</p></div></div>
        <div class="grid-2">
          <section class="panel panel-pad">
            <div class="flex items-center gap-5 mb-5">
              <span class="avatar-edit">
                <span class="avatar xl">${avatarInner(u)}</span>
                <label class="cam file-btn" title="Profilbild ändern">${icon('camera', 'ico-sm')}<input type="file" accept="image/*" data-upload="avatar" aria-label="Profilbild hochladen"></label>
              </span>
              <div class="min-w-0"><div class="font-serif text-2xl font-semibold">${esc(u.displayName)}</div><div class="text-sm text-gold">${esc(u.rank || ROLES[u.role])}</div><div class="text-xs text-dim break-all">${esc(u.email)}</div>
                ${u.hasOwnAvatar
                ? '<button type="button" class="btn-ghost btn-sm mt-2 -ml-3" data-action="avatar-remove">Profilbild entfernen</button>'
                : '<p class="form-hint">Tippen Sie auf die Kamera, um ein Profilbild hochzuladen.</p>'}</div></div>
            <form data-form="profile" class="form-grid">
              <div><label class="label">Telefon (im Spiel)</label><input name="phone" class="field" maxlength="40" value="${esc(u.phone || '')}" placeholder="555-0123"></div>
              <div class="form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button></div>
            </form>
          </section>
          <form data-form="password" class="panel panel-pad form-grid" ${u.mustChangePassword ? 'style="border-color:rgba(245,158,11,.5)"' : ''}>
            <h2 class="panel-title">Passwort ändern</h2>
            <div><label class="label" for="pwOld">Aktuelles Passwort</label><input id="pwOld" name="currentPassword" type="password" autocomplete="current-password" required class="field"></div>
            <div><label class="label" for="pwNew">Neues Passwort (mind. 10 Zeichen)</label><input id="pwNew" name="newPassword" type="password" autocomplete="new-password" minlength="10" required class="field"></div>
            <div><label class="label" for="pwNew2">Neues Passwort wiederholen</label><input id="pwNew2" name="newPassword2" type="password" autocomplete="new-password" required class="field"></div>
            <div class="form-actions"><button class="btn-gold btn-md" type="submit">${icon('key', 'ico-sm')}<span>Passwort speichern</span></button></div>
          </form>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('shield')} Angemeldete Geräte</h2>${st.otherSessions ? badge(`${st.otherSessions} weitere`, 'amber') : badge('nur dieses Gerät', 'emerald')}</div>
            <p class="text-sm text-muted">${
            st.otherSessions
              ? `Sie sind zusätzlich auf ${st.otherSessions === 1 ? 'einem weiteren Gerät bzw. Browser' : `${st.otherSessions} weiteren Geräten bzw. Browsern`} angemeldet (z. B. Handy, App oder ein anderer PC).`
              : 'Sie sind nur auf diesem Gerät angemeldet.'
          } Fremdes Gerät benutzt oder Handy verloren? Hier melden Sie sich überall sonst ab – dieses Gerät bleibt angemeldet.</p>
            <div class="form-actions mt-3"><button type="button" class="btn-outline btn-md" data-action="logout-others" ${st.otherSessions ? '' : 'disabled'}>${icon('logout', 'ico-sm')}<span>Auf allen anderen Geräten abmelden</span></button></div>
          </section>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Discord</h2>${u.discord ? badge('Verbunden', 'emerald') : ''}</div>
            ${discord}
          </section>
          ${namePanel(u)}
          ${appPanel()}
          ${!isStaff() && st.myMembership ? membershipPanel(st.myMembership) : ''}
          ${!isStaff() && st.myCoops.length ? `<section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('tag')} Ihre Kooperationsvorteile</h2></div>
            <div class="space-y-2">${st.myCoops.map((m) => `<div class="flex flex-wrap items-center gap-2">${badge(`${fmtPct(m.discountPct)} % Rabatt`, 'gold')}<strong>${esc(m.name)}</strong><span class="text-xs text-dim">${m.via === 'discord' ? 'über Ihre Discord-Rolle' : 'Ihrem Konto zugeordnet'}</span></div>`).join('')}</div>
            <p class="text-sm text-muted mt-3">Als Mitglied eines Kooperationspartners erhalten Sie diesen Rabatt auf Rechnungen und Honorarvereinbarungen der Kanzlei – er wird automatisch berücksichtigt.</p>
          </section>` : ''}
          ${isStaff() ? fivenetProfilePanel() : ''}
        </div>`;
  },
};

/** Profil: Dashboard als App installieren (PC: eigenes Fenster + Taskleiste, Handy: Startbildschirm). */
function appPanel() {
  const standalone = !!(window.PSApp && window.PSApp.isStandalone());
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('download')} Als App installieren</h2>${standalone ? badge('Sie nutzen die App', 'emerald') : ''}</div>
      <p class="text-sm text-muted">Das Dashboard lässt sich wie ein Programm installieren – am PC mit eigenem Fenster und Symbol in Taskleiste bzw. Startmenü, am Handy auf dem Startbildschirm. Login, Inhalte und Funktionen bleiben gleich; Updates kommen automatisch.</p>
      <div class="form-actions mt-3 pwa-hide-standalone"><button type="button" class="btn-gold btn-md pwa-only" data-action="install-app">${icon('download', 'ico-sm')}<span>Jetzt installieren</span></button></div>
      <ul class="pwa-steps text-sm text-muted mt-3 pwa-hide-standalone">
        <li><strong>PC (Chrome, Edge)</strong><span>In der Adressleiste rechts auf das Symbol „App installieren“ (Bildschirm mit Pfeil) klicken – oder im Browser-Menü „App installieren“ bzw. „Diese Website als App installieren“ wählen.</span></li>
        <li><strong>Mac (Safari)</strong><span>Menü „Ablage“ → „Zum Dock hinzufügen“.</span></li>
        <li><strong>iPhone, iPad</strong><span>In Safari auf „Teilen“ tippen → „Zum Home-Bildschirm“.</span></li>
        <li><strong>Android</strong><span>In Chrome Menü ⋮ → „App installieren“.</span></li>
        <li><strong>Firefox</strong><span>Unterstützt keine App-Installation – dafür Chrome oder Edge verwenden.</span></li>
      </ul>
    </section>`;
}

/** Profil: Namensänderung beim Board of Partners beantragen (Status des letzten Antrags). Das Board ändert direkt. */
function namePanel(u) {
  const reqs = st.myNameRequests || [];
  const open = reqs.find((r) => r.status === 'offen');
  const last = reqs.find((r) => r.status !== 'zurueckgezogen');
  const lastInfo =
    last && last.status !== 'offen'
      ? last.direct
        ? `<p class="text-sm mb-3">${badge('Geändert', 'emerald')} „${esc(last.newName)}“ – ${last.decidedById && last.decidedById !== u.id ? `vom Board of Partners angepasst (${esc(last.decidedBy)})` : 'selbst direkt geändert'} · ${esc(fmtDate(last.decidedAt))}${last.reason ? `<span class="block text-xs text-dim mt-1">Grund: ${esc(last.reason)}</span>` : ''}</p>`
        : `<p class="text-sm mb-3">${last.status === 'genehmigt' ? badge('Genehmigt', 'emerald') : badge('Abgelehnt', 'red')} Letzter Antrag „${esc(last.newName)}“${last.decidedBy ? ` – entschieden von ${esc(last.decidedBy)}` : ''}${last.decisionNote ? `<span class="block text-xs text-dim mt-1">Hinweis: ${esc(last.decisionNote)}</span>` : ''}</p>`
      : '';
  // Board of Partners: eigener Name ohne Antrag
  if (isBoard()) {
    return `<section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('edit')} Name ändern</h2></div>
        <p class="text-sm text-muted mb-4">Ihr Name lautet <strong class="text-white">${esc(u.displayName)}</strong>. Als Mitglied des Board of Partners ändern Sie ihn direkt – ohne Antrag. Die Änderung gilt sofort überall (Konto, Akten, Team-Profil) und steht im Protokoll.</p>
        ${open ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div><strong>Älterer Antrag offen:</strong> ${esc(open.oldName)} → <strong>${esc(open.newName)}</strong></div><button class="btn-ghost btn-sm" data-action="name-withdraw" data-id="${open.id}">Zurückziehen</button></div>` : ''}
        ${lastInfo}
        <form data-form="name-direct" data-user-id="${u.id}" data-self="1" class="form-grid">
          <div><label class="label">Neuer Name</label><input name="newName" class="field" required minlength="2" maxlength="80" value="${esc(u.displayName)}" placeholder="Vor- und Nachname (im Spiel)"></div>
          <div><label class="label">Grund <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="reason" class="field" maxlength="500" placeholder="z. B. Tippfehler, neuer Charaktername"></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Name ändern</span></button></div>
        </form></section>`;
  }
  const state = open
    ? `<div class="banner banner-amber is-stack mb-0"><div class="flex flex-wrap items-center justify-between gap-2"><div><strong>Antrag offen:</strong> ${esc(open.oldName)} → <strong>${esc(open.newName)}</strong><div class="text-xs text-dim">gestellt ${esc(fmtDate(open.createdAt))} · das Board of Partners entscheidet</div></div>
          <button class="btn-ghost btn-sm" data-action="name-withdraw" data-id="${open.id}">Zurückziehen</button></div></div>`
    : `${lastInfo}
         <form data-form="name-request" class="form-grid">
           <div><label class="label">Neuer Name</label><input name="newName" class="field" required minlength="2" maxlength="80" placeholder="Vor- und Nachname (im Spiel)"></div>
           <div><label class="label">Begründung <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="reason" class="field" maxlength="500" placeholder="z. B. Heirat, Tippfehler, neuer Charaktername"></div>
           <div class="form-actions"><button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Antrag stellen</span></button></div>
         </form>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('edit')} Name ändern</h2></div>
      <p class="text-sm text-muted mb-4">Ihr Name lautet <strong class="text-white">${esc(u.displayName)}</strong>. Eine Änderung beantragen Sie hier – das Board of Partners prüft und bestätigt sie.</p>
      ${state}</section>`;
}

/** Board of Partners: Namen eines Mandanten (oder den eigenen) direkt ändern – ohne Antrag. */
function nameDirectModal({ userId, name, email, returnCase }) {
  openModal(`
      <h2 class="modal-title">Name korrigieren</h2>
      <p class="modal-sub">Mandanten-Konto <strong>${esc(name)}</strong>${email ? ` · ${esc(email)}` : ''}. Der neue Name gilt sofort überall (Konto und Akten); der Mandant bekommt eine Nachricht per Discord (falls verknüpft). Die Änderung steht im Protokoll.</p>
      <form data-form="name-direct" data-user-id="${Number(userId)}" ${returnCase ? `data-return-case="${Number(returnCase)}"` : ''} class="form-grid">
        <div><label class="label" for="ndName">Neuer Name</label><input id="ndName" name="newName" class="field" required minlength="2" maxlength="80" value="${esc(name)}" autofocus></div>
        <div><label class="label" for="ndReason">Grund <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input id="ndReason" name="reason" class="field" maxlength="500" placeholder="z. B. Groß-/Kleinschreibung"></div>
        <div class="form-actions">${returnCase ? `<button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button>` : '<button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button>'}<button type="submit" class="btn-gold btn-md">${icon('check', 'ico-sm')}<span>Speichern</span></button></div>
      </form>`);
}

/** Profil des Mandanten: eigene VIP-/Lifetime-Mitgliedschaft. */
function membershipPanel(m) {
  return `<section class="panel panel-pad" style="border-color:var(--gold-hairline)">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('crown')} ${m.kind === 'perma' ? 'Ihre Lifetime-Mitgliedschaft' : 'Ihre VIP-Mitgliedschaft'}</h2>${memberBadge(m)}</div>
      <div class="flex flex-wrap items-center gap-2 mb-2">${badge(`${fmtPct(m.discountPct)} % Rabatt`, 'gold')}<span class="text-sm text-muted">${m.expiresAt ? `gültig bis ${esc(fmtDateOnly(String(m.expiresAt).slice(0, 10)))}` : 'unbefristet'}</span></div>
      ${m.benefits ? `<p class="text-sm text-muted whitespace-pre-wrap">${esc(m.benefits)}</p>` : ''}
      <p class="form-hint mt-3">Der Rabatt wird bei jeder Rechnung der Kanzlei automatisch berücksichtigt.</p></section>`;
}

/* ---------------------------------------------------------------- VIP & Lifetime (Board of Partners) */
const MS_STATUS = { aktiv: ['aktiv', 'emerald'], abgelaufen: ['abgelaufen', 'amber'], beendet: ['beendet', 'slate'] };
const tierPeriod = (t) => (t.durationDays ? `${t.durationDays} Tage` : 'unbefristet');

function memberCardHtml(m) {
  const [sl, sc] = MS_STATUS[m.status] || [m.status, 'slate'];
  const over = m.usage.covered > m.pricePaid && m.kind === 'perma';
  return `<div class="list-row wrap">
      <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(m.name)} ${memberBadge({ kind: m.kind, name: m.tierName })}${badge(sl, sc)}</div>
        <div class="meta">${esc(m.email)} · ${fmtPct(m.discountPct)} % · ${m.expiresAt ? `bis ${esc(fmtDateOnly(String(m.expiresAt).slice(0, 10)))}` : 'unbefristet'} · seit ${esc(fmtDateOnly(String(m.startsAt).slice(0, 10)))}${m.discordLinked ? '' : ' · <span title="Ohne verknüpftes Discord keine Rolle und keine Erinnerung">kein Discord</span>'}</div>
        <div class="meta">Gezahlt ${money(m.pricePaid)} · ${m.usage.invoices} Rechnung(en) · Wert der Leistungen ${money(m.usage.workValue)} · abgedeckt ${money(m.usage.covered)}${over ? ` ${badge('Arbeit übersteigt Preis', 'amber')}` : ''}</div>
        ${m.status !== 'aktiv' && m.endReason ? `<div class="meta">Grund: ${esc(m.endReason)}${m.endedBy ? ` (${esc(m.endedBy)})` : ''}</div>` : ''}
        ${m.note ? `<div class="meta">Notiz: ${esc(m.note)}</div>` : ''}</div>
      <div class="flex flex-wrap gap-2 shrink-0">
        ${m.kind === 'vip' && m.status !== 'beendet' ? `<button class="btn-outline btn-sm" data-action="vip-renew" data-id="${m.id}">Verlängern</button>` : ''}
        ${m.status === 'aktiv' ? `<button class="btn-ghost btn-sm" data-action="vip-end" data-id="${m.id}">Beenden</button>` : ''}
      </div></div>`;
}

function tierCardHtml(t) {
  return `<div class="list-row wrap">
      <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(t.name)} ${t.kind === 'perma' ? badge('👑 Lifetime', 'gold') : badge('⭐ VIP', 'sky')}${t.active ? '' : badge('inaktiv', 'slate')}</div>
        <div class="meta"><strong class="text-white">${money(t.price)}</strong> · ${tierPeriod(t)} · <strong class="text-gold">${fmtPct(t.discountPct)} % Rabatt</strong> · ${t.activeMembers} aktiv${t.discordRoleId ? ' · Discord-Rolle' : ''}</div>
        ${t.benefits ? `<div class="meta whitespace-pre-wrap">${esc(t.benefits)}</div>` : ''}</div>
      <div class="flex flex-wrap gap-2 shrink-0"><button class="btn-outline btn-sm" data-action="tier-edit" data-id="${t.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button class="btn-ghost btn-sm" data-action="tier-delete" data-id="${t.id}" aria-label="Stufe löschen">${icon('trash', 'ico-sm')}</button></div></div>`;
}

const REQ_BADGE = { offen: ['offen', 'amber'], angenommen: ['wartet auf Zahlung', 'sky'], aktiv: ['freigeschaltet', 'emerald'], abgelehnt: ['abgelehnt', 'red'], zurueckgezogen: ['zurückgezogen', 'slate'] };
function vipRequestHtml(r) {
  const [bl, bc] = REQ_BADGE[r.status] || [r.status, 'slate'];
  return `<div class="list-row wrap">
      <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(r.name)} ${memberBadge({ kind: r.kind, name: r.tierName })}${badge(bl, bc)}</div>
        <div class="meta">${esc(r.email)} · ${money(r.price)} · ${fmtPct(r.discountPct)} % · ${r.durationDays ? `${r.durationDays} Tage` : 'unbefristet'} · angefragt ${esc(fmtDate(r.createdAt))}${r.discordLinked ? '' : ' · kein Discord'}</div>
        ${r.message ? `<div class="meta">Nachricht: ${esc(r.message)}</div>` : ''}
        ${r.invoice ? `<div class="meta">Rechnung <a class="text-gold underline" href="/invoice.html?id=${r.invoice.id}" target="_blank" rel="noopener">${esc(r.invoice.number)}</a> · ${esc(r.invoice.status)}</div>` : ''}
        ${r.decisionNote ? `<div class="meta">${r.status === 'abgelehnt' ? 'Grund' : 'Hinweis'}: ${esc(r.decisionNote)}</div>` : ''}</div>
      <div class="flex flex-wrap gap-2 shrink-0">
        ${r.status === 'offen' ? `<button class="btn-gold btn-sm" data-action="vipreq-accept" data-id="${r.id}">${icon('check', 'ico-sm')}<span>Annehmen</span></button><button class="btn-ghost btn-sm" data-action="vipreq-decline" data-id="${r.id}">Ablehnen</button>` : ''}
        ${r.status === 'angenommen' && r.invoice ? `<button class="btn-gold btn-sm" data-action="vipreq-paid" data-id="${r.id}">${icon('check', 'ico-sm')}<span>Bezahlt – freischalten</span></button>` : ''}
      </div></div>`;
}

views.vip = {
  async load() {
    const [m, t, q] = await Promise.all([
      api.get('/api/memberships' + (st.vipAll ? '?status=alle' : '')),
      api.get('/api/memberships/tiers'),
      api.get('/api/memberships/requests' + (st.vipReqAll ? '?status=alle' : '')),
    ]);
    st.vip = { memberships: m.memberships, tiers: t.tiers, requests: q.requests };
    st.vipReqOpen = q.open;
    renderNav();
  },
  render() {
    const { memberships, tiers } = st.vip;
    const active = memberships.filter((m) => m.status === 'aktiv');
    const sum = (list, f) => list.reduce((s, m) => s + f(m), 0);
    return `
        <div class="page-head">
          <div><h1 class="page-title">VIP &amp; Lifetime</h1><p class="page-sub">Mitgliedschaften für einzelne Mandanten – Rabatt in jeder Rechnung, Badge in Akten, auf Wunsch Discord-Rolle. Preise und Rabatte legt das Board fest.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="vip-grant">${icon('crown')}<span>Mitgliedschaft vergeben</span></button></div>
        </div>
        <div class="kpi-grid">
          <div class="panel kpi"><div class="kpi-label">${icon('crown', 'ico-sm')}Lifetime</div><div class="kpi-value">${active.filter((m) => m.kind === 'perma').length}</div><div class="kpi-sub">aktiv</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('star', 'ico-sm')}VIP</div><div class="kpi-value">${active.filter((m) => m.kind === 'vip').length}</div><div class="kpi-sub">aktiv</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('receipt', 'ico-sm')}Eingenommen</div><div class="kpi-value">${money(sum(active, (m) => m.pricePaid))}</div><div class="kpi-sub">aktive Mitgliedschaften</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('scale', 'ico-sm')}Abgedeckte Leistungen</div><div class="kpi-value">${money(sum(active, (m) => m.usage.covered))}</div><div class="kpi-sub">Rabatt auf Rechnungen</div></div>
        </div>
        <section class="panel panel-pad mb-4">
          <div class="panel-head"><h2 class="panel-title">Anfragen von der Website</h2>
            <div class="chip-row"><button class="chip ${st.vipReqAll ? '' : 'active'}" data-action="vipreq-filter" data-value="offen">Offen <span class="chip-count">${st.vipReqOpen || 0}</span></button><button class="chip ${st.vipReqAll ? 'active' : ''}" data-action="vipreq-filter" data-value="alle">Alle</button></div></div>
          <p class="text-sm text-muted mb-3">Mandanten fragen auf der Startseite oder im Portal an. <strong class="text-white">Annehmen</strong> erstellt die Rechnung über den Preis – sobald sie auf „bezahlt“ steht (hier oder unter Rechnungen), wird die Mitgliedschaft automatisch freigeschaltet.</p>
          ${st.vip.requests.length ? st.vip.requests.map(vipRequestHtml).join('') : empty(st.vipReqAll ? 'Noch keine Anfragen.' : 'Keine offenen Anfragen.', 'crown')}
        </section>
        <section class="panel panel-pad mb-4">
          <div class="panel-head"><h2 class="panel-title">Mitglieder</h2>
            <div class="chip-row"><button class="chip ${st.vipAll ? '' : 'active'}" data-action="vip-filter" data-value="aktiv">Aktiv</button><button class="chip ${st.vipAll ? 'active' : ''}" data-action="vip-filter" data-value="alle">Alle</button></div></div>
          ${memberships.length ? memberships.map(memberCardHtml).join('') : empty(st.vipAll ? 'Noch keine Mitgliedschaften.' : 'Keine aktiven Mitgliedschaften. „Mitgliedschaft vergeben“ legt die erste an.', 'crown')}
        </section>
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Stufen, Preise &amp; Rabatte</h2><button class="btn-outline btn-sm" data-action="tier-new">${icon('plus', 'ico-sm')}<span>Neue Stufe</span></button></div>
          <p class="text-sm text-muted mb-3">Preis, Laufzeit und Rabatt gelten für neu vergebene Mitgliedschaften und Verlängerungen – laufende behalten ihren Rabatt. Lifetime ist unbefristet.</p>
          ${tiers.length ? tiers.map(tierCardHtml).join('') : empty('Noch keine Stufen.', 'crown')}
        </section>`;
  },
};

function tierForm(t = null) {
  const kind = t ? t.kind : 'vip';
  return `
      <h2 id="modalTitle" class="modal-title">${t ? `${esc(t.name)} bearbeiten` : 'Neue Stufe'}</h2>
      <p class="modal-sub">VIP gilt für eine Laufzeit (z. B. 30 Tage) und wird verlängert; Lifetime ist unbefristet und gilt nur für diese eine Person.</p>
      <form data-form="tier" ${t ? `data-id="${t.id}"` : ''} class="form-grid cols-2">
        <div><label class="label">Name</label><input name="name" class="field" required minlength="2" maxlength="60" value="${esc(t ? t.name : '')}" placeholder="z. B. VIP Gold" autofocus></div>
        <div><label class="label">Art</label><select name="kind" class="field" id="tierKind">${opt('vip', 'VIP (auf Zeit)', kind === 'vip')}${opt('perma', 'Lifetime (unbefristet)', kind === 'perma')}</select></div>
        <div><label class="label">Preis ($)</label><input name="price" type="number" inputmode="numeric" min="0" step="1000" class="field" required value="${esc(t ? t.price : 250000)}"></div>
        <div><label class="label">Rabatt auf alle Leistungen (%)</label><input name="discountPct" type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field" required value="${esc(t ? t.discountPct : 15)}"></div>
        <div id="tierDuration" ${kind === 'perma' ? 'class="hidden"' : ''}><label class="label">Laufzeit (Tage)</label><input name="durationDays" type="number" inputmode="numeric" min="1" max="3650" class="field" value="${esc(t && t.durationDays ? t.durationDays : 30)}"></div>
        <div class="flex items-end"><label class="check"><input type="checkbox" name="active" ${!t || t.active ? 'checked' : ''}> Aktiv (kann vergeben werden)</label></div>
        <div class="span-2"><label class="label">Leistungen / Bedingungen <span class="text-dim font-normal normal-case tracking-normal">(sieht der Mandant im Profil)</span></label><textarea name="benefits" rows="4" maxlength="1000" class="field" placeholder="z. B. Fester Hausanwalt, Notfall-Priorität …">${esc(t ? t.benefits : '')}</textarea></div>
        <div class="span-2"><label class="label">Discord-Rolle <span class="text-dim font-normal normal-case tracking-normal">(optional – der Bot vergibt sie beim Start und entfernt sie beim Ende)</span></label>
          <div id="tierRoles" class="text-sm text-dim">Rollen werden geladen …</div>
          <input name="discordRoleId" class="field mt-2" inputmode="numeric" maxlength="25" value="${esc(t ? t.discordRoleId : '')}" placeholder="oder Rollen-ID eintragen"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${t ? 'Speichern' : 'Stufe anlegen'}</span></button></div>
      </form>`;
}
/** Rollen des Kanzlei-Servers als Auswahl (setzt das ID-Feld). */
async function loadTierRoles(selected) {
  const box = $('#tierRoles');
  if (!box) return;
  try {
    const { roles } = await api.get('/api/cooperations/roles');
    box.innerHTML = `<select class="field" data-tier-role><option value="">— keine Rolle —</option>${roles.map((r) => opt(r.id, '@' + r.name, r.id === selected)).join('')}</select>`;
  } catch (e) {
    box.innerHTML = `<span class="text-xs">${esc(e.message)}</span>`;
  }
}

function grantDialog() {
  const tiers = st.vip.tiers.filter((t) => t.active);
  return `
      <h2 id="modalTitle" class="modal-title">Mitgliedschaft vergeben</h2>
      <p class="modal-sub">Für ein Mandantenkonto. Der Mandant erhält den Rabatt ab sofort in jeder Rechnung und eine Direktnachricht im Discord (falls verknüpft).</p>
      <form data-form="vip-grant" class="form-grid">
        <div><label class="label">Mandant</label><input id="vipAccSearch" class="field" type="search" maxlength="80" placeholder="Name oder E-Mail suchen …" autocomplete="off" autofocus>
          <input type="hidden" name="userId"><div id="vipAccList" class="mt-2"></div></div>
        <div><label class="label">Stufe</label><select name="tierId" class="field" required>${tiers.map((t) => opt(t.id, `${t.name} – ${money(t.price)} · ${tierPeriod(t)} · ${fmtPct(t.discountPct)} %`)).join('')}</select></div>
        <label class="check"><input type="checkbox" name="invoice" checked> Rechnung über den Preis erstellen (erscheint im Portal des Mandanten)</label>
        <div><label class="label">Notiz <span class="text-dim font-normal normal-case tracking-normal">(intern, optional)</span></label><input name="note" class="field" maxlength="500" placeholder="z. B. bar bezahlt am …"></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('crown')}<span>Vergeben</span></button></div>
      </form>`;
}
async function searchVipAccounts(input) {
  const q = input.value.trim();
  const { accounts } = await api.get(`/api/cases/client-accounts?q=${encodeURIComponent(q)}`);
  if (!input.isConnected || input.value.trim() !== q) return;
  const chosen = Number($('form[data-form="vip-grant"] input[name="userId"]')?.value || 0);
  $('#vipAccList').innerHTML = accounts.length
    ? accounts
        .slice(0, 8)
        .map((a) => `<button type="button" class="list-row wrap w-full text-left ${a.id === chosen ? 'active' : ''}" data-action="vip-pick" data-id="${a.id}" data-name="${esc(a.name)}"><div class="main"><div class="title">${a.id === chosen ? '✓ ' : ''}${esc(a.name)}</div><div class="meta">${esc(a.email)}</div></div></button>`)
        .join('')
    : '<p class="text-sm text-dim">Kein Mandantenkonto gefunden.</p>';
}

/* ---------------------------------------------------------------- Mandant: VIP & Lifetime anfragen */
function offerCardHtml(t, busy) {
  const life = t.kind === 'perma';
  return `<div class="panel panel-pad flex flex-col" style="border-top:2px solid ${life ? 'var(--gold-500)' : 'rgba(56,189,248,.6)'}">
      <div class="flex items-center justify-between mb-3">${memberBadge({ kind: t.kind, name: life ? 'Lifetime' : 'VIP' })}<span class="text-xs text-dim font-mono">${life ? 'unbefristet' : `${t.durationDays} Tage`}</span></div>
      <h3 class="font-serif text-2xl font-semibold">${esc(t.name)}</h3>
      <div class="font-mono text-2xl text-gold font-semibold mt-1">${money(t.price)}</div>
      <div class="text-xs text-dim mb-3">${life ? 'einmalig · gilt unbefristet' : `für ${t.durationDays} Tage · verlängerbar`}</div>
      <div class="text-sm font-semibold mb-2" style="color:var(--gold-light)">${fmtPct(t.discountPct)} % Rabatt auf alle Leistungen</div>
      ${t.benefits ? `<p class="text-sm text-muted whitespace-pre-line mb-4" style="flex:1">${esc(t.benefits)}</p>` : '<div style="flex:1"></div>'}
      <button class="${life ? 'btn-gold' : 'btn-outline'} btn-md w-full" data-action="vip-request" data-id="${t.id}" ${busy ? 'disabled' : ''}>${busy ? 'Anfrage läuft' : 'Jetzt anfragen'}</button></div>`;
}
function vipRequestModal(t) {
  const cur = st.offers && st.offers.membership;
  openModal(`
      <h2 class="modal-title">${esc(t.name)} anfragen</h2>
      <p class="modal-sub">${money(t.price)} · ${t.durationDays ? `${t.durationDays} Tage` : 'unbefristet'} · ${fmtPct(t.discountPct)} % Rabatt auf alle Leistungen. Das Board of Partners bestätigt Ihre Anfrage und stellt die Rechnung aus; nach der Zahlung im Spiel wird die Mitgliedschaft automatisch freigeschaltet.${cur ? ` Ihre aktuelle Mitgliedschaft (${esc(cur.name)}) wird dabei ${cur.name === t.name ? 'verlängert' : 'ersetzt'}.` : ''}</p>
      <form data-form="vip-request" data-id="${t.id}" class="form-grid">
        <div><label class="label">Nachricht an das Board <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><textarea name="message" rows="3" maxlength="500" class="field" placeholder="z. B. Wann und wo kann ich bezahlen?"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Anfrage senden</span></button></div>
      </form>`);
}
views['vip-angebot'] = {
  async load() {
    st.offers = await api.get('/api/memberships/offers');
    // Von der Startseite: ?vip=<Stufe> öffnet die Anfrage direkt
    const want = Number(new URLSearchParams(location.search).get('vip'));
    if (want) {
      st.vipAutoTier = want;
      history.replaceState(history.state, '', '/dashboard.html' + location.hash);
    }
  },
  render() {
    const d = st.offers;
    const running = d.requests.find((r) => r.status === 'offen' || r.status === 'angenommen');
    const last = d.requests.find((r) => r.status === 'abgelehnt' || r.status === 'aktiv');
    if (st.vipAutoTier) {
      const t = d.tiers.find((x) => x.id === st.vipAutoTier);
      st.vipAutoTier = null;
      if (t && !running) setTimeout(() => vipRequestModal(t), 0);
      else if (running) setTimeout(() => toast('Sie haben bereits eine laufende Anfrage – den Stand sehen Sie hier.'), 0);
    }
    const status = running
      ? running.status === 'offen'
        ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div><strong>Anfrage gesendet: ${esc(running.tierName)}</strong> (${money(running.price)}) · ${esc(fmtDate(running.createdAt))}<div class="text-xs text-dim">Das Board of Partners meldet sich – danach erhalten Sie die Rechnung.</div></div><button class="btn-ghost btn-sm" data-action="vip-request-withdraw" data-id="${running.id}">Zurückziehen</button></div>`
        : `<div class="banner banner-gold items-center justify-between flex-wrap"><div><strong>Angenommen: ${esc(running.tierName)}</strong> – bitte die Rechnung ${running.invoice ? `<strong>${esc(running.invoice.number)}</strong> ` : ''}über <strong>${money(running.price)}</strong> im Spiel bezahlen. Danach wird Ihre Mitgliedschaft automatisch freigeschaltet.${running.decisionNote ? `<div class="text-xs mt-1">${esc(running.decisionNote)}</div>` : ''}</div>${running.invoice ? `<a class="btn-outline btn-sm" href="/invoice.html?id=${running.invoice.id}" target="_blank" rel="noopener">${icon('receipt', 'ico-sm')}<span>Rechnung</span></a>` : ''}</div>`
      : last && last.status === 'abgelehnt'
        ? `<div class="banner banner-red">${icon('alert')}<div>Ihre letzte Anfrage (${esc(last.tierName)}) wurde abgelehnt.${last.decisionNote ? ` Grund: ${esc(last.decisionNote)}` : ''}</div></div>`
        : '';
    return `
        <div class="page-head"><div><h1 class="page-title">VIP &amp; Lifetime</h1><p class="page-sub">Dauerhafter Rabatt auf alle Leistungen der Kanzlei – als VIP auf Zeit oder einmalig als Lifetime.</p></div></div>
        ${status}
        ${d.membership ? `<div class="mb-4">${membershipPanel(d.membership)}</div>` : ''}
        ${d.tiers.length ? `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">${d.tiers.map((t) => offerCardHtml(t, !!running || (d.membership && d.membership.kind === 'perma'))).join('')}</div>` : `<div class="panel">${empty('Aktuell gibt es keine Angebote.', 'crown')}</div>`}
        <p class="form-hint mt-4">Ablauf: anfragen → das Board of Partners bestätigt und stellt die Rechnung aus → Zahlung im Spiel → automatische Freischaltung (mit Discord-Nachricht, falls Ihr Discord verknüpft ist).</p>`;
  },
};

/* ---------------------------------------------------------------- Namensänderungen (Board of Partners) */
views['name-requests'] = {
  async load() {
    st.names = await api.get('/api/name-requests' + (st.namesAll ? '?status=alle' : ''));
    st.nameOpen = st.names.open;
    renderNav();
  },
  render() {
    const d = st.names;
    const rows = d.requests;
    const item = (r) => `<div class="list-row wrap">
        <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(r.oldName)} → <strong class="text-gold">${esc(r.newName)}</strong> ${r.direct ? badge('direkt geändert', 'sky') : r.status === 'offen' ? badge('offen', 'amber') : r.status === 'genehmigt' ? badge('genehmigt', 'emerald') : badge('abgelehnt', 'red')}</div>
          <div class="meta">${esc(r.role || '')}${r.rank ? ` · ${esc(r.rank)}` : ''} · ${esc(r.email || '')} · ${r.direct ? 'ohne Antrag' : `beantragt ${esc(fmtDate(r.createdAt))}`}${r.status === 'offen' && r.currentName !== r.oldName ? ` · aktueller Name: ${esc(r.currentName)}` : ''}</div>
          ${r.reason ? `<div class="meta">${r.direct ? 'Grund' : 'Begründung'}: ${esc(r.reason)}</div>` : ''}
          ${r.status !== 'offen' ? `<div class="meta">${r.direct ? 'Geändert' : 'Entschieden'} von ${esc(r.decidedBy || '—')} · ${esc(fmtDate(r.decidedAt))}${r.decisionNote && !r.direct ? ` · ${esc(r.decisionNote)}` : ''}</div>` : ''}</div>
        ${r.status === 'offen'
        ? r.userId === d.me
          ? '<span class="text-xs text-dim shrink-0">Ihr eigener Antrag – entscheidet ein anderes Board-Mitglied</span>'
          : `<div class="flex flex-wrap gap-2 shrink-0"><button class="btn-gold btn-sm" data-action="name-approve" data-id="${r.id}">${icon('check', 'ico-sm')}<span>Genehmigen</span></button><button class="btn-ghost btn-sm" data-action="name-reject" data-id="${r.id}">Ablehnen</button></div>`
        : ''}</div>`;
    return `
        <div class="page-head"><div><h1 class="page-title">Namensänderungen</h1><p class="page-sub">Anträge von Mandanten und Mitarbeitern. Genehmigt → der neue Name gilt sofort überall (Konto, Akten, Team-Profil der Website).</p></div></div>
        <div class="chip-row mb-4"><button class="chip ${st.namesAll ? '' : 'active'}" data-action="names-filter" data-value="offen">Offen <span class="chip-count">${d.open}</span></button><button class="chip ${st.namesAll ? 'active' : ''}" data-action="names-filter" data-value="alle">Alle</button></div>
        <div class="panel p-2 md:p-3">${rows.length ? rows.map(item).join('') : empty(st.namesAll ? 'Noch keine Anträge.' : 'Keine offenen Anträge.', 'edit')}</div>
        <section class="panel panel-pad mt-4 lg:mt-5">
          <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('edit')} Name eines Mandanten korrigieren</h2></div>
          <p class="text-sm text-muted mb-3">Ohne Antrag – z. B. bei Groß-/Kleinschreibung oder Tippfehlern. Der Mandant wird per Discord benachrichtigt (falls verknüpft), die Änderung steht im Protokoll. Mitarbeiter ändern ihren Namen per Antrag im Profil; Ihren eigenen Namen ändern Sie direkt unter „Mein Profil“.</p>
          <input id="nameAccSearch" class="field" type="search" maxlength="80" placeholder="Mandant suchen (Name oder E-Mail) …" value="${esc(st.nameAccQ || '')}" autocomplete="off" aria-label="Mandanten-Konto suchen">
          <div id="nameAccList" class="mt-3">${nameAccList()}</div>
        </section>`;
  },
};

/* ---------------------------------------------------------------- Mandantenstimmen (Bewertungen) */
const REVIEW_STATUS = { neu: ['Wartet auf Freigabe', 'amber'], freigegeben: ['Veröffentlicht', 'emerald'], abgelehnt: ['Nicht veröffentlicht', 'slate'] };
const NAME_MODES = { initialen: 'Initialen (z. B. „J. D.“)', voll: 'Vollständiger Name', anonym: 'Anonym („Mandant“)' };
const reviewStars = (n) => `<span class="nowrap" aria-label="${n} von 5 Sternen"><span class="text-gold">${'★'.repeat(n)}</span><span class="text-dim" aria-hidden="true">${'★'.repeat(5 - n)}</span></span>`;

views.reviews = {
  async load() {
    st.reviews = await api.get('/api/reviews' + (st.reviewFilter && st.reviewFilter !== 'alle' ? `?status=${st.reviewFilter}` : ''));
    st.reviewOpen = st.reviews.open;
    renderNav();
  },
  render() {
    const f = st.reviewFilter || 'neu';
    const list = st.reviews.reviews;
    const item = (r) => `<div class="list-row wrap flex-col sm:flex-row">
        <div class="main">
          <div class="title flex flex-wrap items-center gap-2">${reviewStars(r.rating)} ${statusBadge(REVIEW_STATUS, r.status)}</div>
          <p class="text-sm mt-1 whitespace-pre-wrap">„${esc(r.body)}“</p>
          <div class="meta">Auf der Website: <strong>${esc(r.displayName)}</strong>${r.area ? `, ${esc(r.area)}` : ''} · von ${esc(r.authorName || '—')}${r.caseNumber ? ` · <button class="text-gold font-mono hover:underline" data-action="open-case" data-id="${r.caseId}">${esc(r.caseNumber)}</button>` : ''} · ${esc(fmtDate(r.updatedAt || r.createdAt))}${r.decidedBy ? ` · ${r.status === 'freigegeben' ? 'veröffentlicht' : 'abgelehnt'} von ${esc(r.decidedBy)}` : ''}</div>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0">
          ${r.status !== 'freigegeben' ? `<button class="btn-gold btn-sm" data-action="review-decide" data-id="${r.id}" data-status="freigegeben">${icon('check', 'ico-sm')}<span>Veröffentlichen</span></button>` : ''}
          ${r.status !== 'abgelehnt' ? `<button class="btn-ghost btn-sm" data-action="review-decide" data-id="${r.id}" data-status="abgelehnt">${r.status === 'freigegeben' ? 'Von der Website nehmen' : 'Ablehnen'}</button>` : ''}
          <button class="btn-ghost btn-sm fn-danger" data-action="review-delete" data-id="${r.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
        </div></div>`;
    return `
        <div class="page-head"><div><h1 class="page-title">Mandantenstimmen</h1><p class="page-sub">Bewertungen abgeschlossener Akten durch die Mandanten. Auf der Website (Bereich „Mandantenstimmen“) erscheinen nur veröffentlichte – solange es weniger als drei gibt, zeigt die Startseite weiter die bisherigen Texte.</p></div></div>
        <div class="chip-row mb-4">${[['neu', 'Neu'], ['freigegeben', 'Veröffentlicht'], ['abgelehnt', 'Abgelehnt'], ['alle', 'Alle']]
        .map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-action="reviews-filter" data-value="${k}">${l}${k === 'neu' ? ` <span class="chip-count">${st.reviews.open}</span>` : ''}</button>`)
        .join('')}</div>
        <div class="panel p-2 md:p-3">${list.length ? list.map(item).join('') : empty(f === 'neu' ? 'Keine neuen Bewertungen.' : 'Keine Bewertungen.', 'star')}</div>`;
  },
};

/** Akte (Mandant): Bewertung abgeben bzw. eigene Bewertung ansehen. */
function reviewSection(c, info) {
  if (!info || (!info.canReview && !info.review)) return '';
  const r = info.review;
  const editing = !r || st.reviewEdit === r.id;
  if (!editing) {
    return `<div class="section" id="secReview"><h3 class="section-title">Ihre Bewertung</h3>
        <div class="panel panel-pad"><div class="flex flex-wrap items-center gap-2 text-lg">${reviewStars(r.rating)} ${statusBadge(REVIEW_STATUS, r.status)}</div>
          <p class="text-sm mt-2 whitespace-pre-wrap">„${esc(r.body)}“</p>
          <p class="form-hint mt-1">Anzeige: ${esc(r.displayName)}${r.area ? `, ${esc(r.area)}` : ''}${r.status === 'neu' ? ' · Das Board of Partners prüft Ihre Bewertung, bevor sie auf der Website erscheint.' : ''}</p>
          <div class="form-actions mt-3"><button type="button" class="btn-outline btn-sm" data-action="review-edit" data-id="${r.id}">${icon('edit', 'ico-sm')}<span>Ändern</span></button><button type="button" class="btn-ghost btn-sm fn-danger" data-action="review-delete" data-id="${r.id}" data-case-id="${c.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button></div></div></div>`;
  }
  const cur = r ? r.rating : 0;
  return `<div class="section" id="secReview"><h3 class="section-title">${r ? 'Bewertung ändern' : 'Wie zufrieden waren Sie?'}</h3>
      <form data-form="review" data-case-id="${c.id}" ${r ? `data-id="${r.id}"` : ''} class="panel panel-pad form-grid cols-2">
        <div class="span-2"><div class="label">Ihre Bewertung</div><div class="stars-input" role="radiogroup" aria-label="Sterne">${[5, 4, 3, 2, 1]
        .map((n) => `<input type="radio" id="rv${n}" name="rating" value="${n}" ${n === cur ? 'checked' : ''} required><label for="rv${n}" title="${n} ${n === 1 ? 'Stern' : 'Sterne'}">★</label>`)
        .join('')}</div></div>
        <div class="span-2"><label class="label" for="rvBody">Ihr Erfahrungsbericht</label><textarea id="rvBody" name="body" rows="4" minlength="10" maxlength="1000" class="field" required placeholder="Wie hat Ihnen die Vertretung durch Pake &amp; Scha gefallen?">${esc(r ? r.body : '')}</textarea></div>
        <div><label class="label" for="rvName">Name auf der Website</label><select id="rvName" name="nameMode" class="field">${Object.entries(NAME_MODES).map(([k, l]) => opt(k, l, (r ? r.nameMode : 'initialen') === k)).join('')}</select></div>
        <p class="form-hint self-end">Ihre Bewertung erscheint nach Prüfung durch das Board of Partners auf der Startseite unter „Mandantenstimmen“.</p>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('star', 'ico-sm')}<span>${r ? 'Speichern' : 'Bewertung abschicken'}</span></button>${r ? '<button type="button" class="btn-ghost btn-md" data-action="review-cancel">Abbrechen</button>' : ''}</div>
      </form></div>`;
}

/** Suchergebnis „Name eines Mandanten korrigieren“. */
function nameAccList() {
  const q = (st.nameAccQ || '').trim();
  if (q.length < 2) return '<p class="text-sm text-dim">Mindestens zwei Zeichen eingeben.</p>';
  const list = st.nameAccounts || [];
  if (!list.length) return '<p class="text-sm text-dim">Kein Mandanten-Konto gefunden.</p>';
  return list
    .map(
      (a) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.email)}${a.createdAt ? ` · registriert ${esc(fmtDateOnly(String(a.createdAt).slice(0, 10)))}` : ''}</div></div>
          <button type="button" class="btn-outline btn-sm shrink-0" data-action="name-direct" data-user-id="${a.id}" data-name="${esc(a.name)}" data-email="${esc(a.email)}">${icon('edit', 'ico-sm')}<span>Name korrigieren</span></button></div>`
    )
    .join('');
}
async function searchNameAccounts(input) {
  const q = input.value.trim();
  st.nameAccQ = input.value;
  st.nameAccounts = q.length >= 2 ? (await api.get('/api/name-requests/accounts?q=' + encodeURIComponent(q))).accounts : [];
  if (input.isConnected && input.value.trim() === q) $('#nameAccList').innerHTML = nameAccList();
}

/* ---------------------------------------------------------------- Dienstzeiten / Stempeluhr */
function weekRange() {
  const from = st.dutyWeek;
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return { from, to };
}

/* ---------------------------------------------------------------- Anliegen an das Board of Partners */
const CONCERN_STATUS = { offen: ['Offen', 'amber'], in_bearbeitung: ['In Bearbeitung', 'sky'], erledigt: ['Erledigt', 'emerald'], abgelehnt: ['Abgelehnt', 'slate'] };
const CONCERN_FILTERS = [
  ['aktiv', 'Aktiv'],
  ['erledigt', 'Abgeschlossen'],
  ['alle', 'Alle'],
];
const CONCERN_GROUPS = [
  ['alle', 'Alle Absender'],
  ['mitarbeiter', 'Mitarbeiter'],
  ['mandant', 'Mandanten'],
  ['extern', 'Über die Website'],
];
/** Absender aus Sicht des Boards: Name + Rang bzw. „Mandant“ (bei anonymen Anliegen nur die Gruppe). */
const concernFrom = (k) => (k.mine ? 'Ihnen' : `${k.author} (${k.authorRank || k.authorGroupLabel})`);
const concernMatches = (k, filter = st.concernFilter) => filter === 'alle' || (filter === 'aktiv' ? !k.closed : k.closed);

function concernList(d) {
  const all = d.scope === 'all';
  const rows = d.concerns.filter((k) => concernMatches(k) && (!all || st.concernGroup === 'alle' || k.authorGroup === st.concernGroup));
  if (!rows.length) {
    return empty(d.concerns.length ? 'Keine Anliegen für diese Auswahl.' : all ? 'Noch keine Anliegen eingegangen.' : 'Sie haben noch kein Anliegen eingereicht.', 'chat');
  }
  return rows
    .map((k) => {
      const meta = [
        k.categoryLabel,
        k.reference,
        all ? `von ${concernFrom(k)}` : k.anonymous ? 'anonym eingereicht' : null,
        fmtDate(k.createdAt),
        k.assignedName ? `zuständig: ${k.assignedName}` : null,
        k.replyCount ? `${k.replyCount} ${k.replyCount === 1 ? 'Nachricht' : 'Nachrichten'}` : null,
      ]
        .filter(Boolean)
        .map(esc)
        .join(' · ');
      return `<div class="list-row" data-action="concern-open" data-id="${k.id}" role="button" tabindex="0">
          <div class="main"><div class="title">${esc(k.subject)}</div><div class="meta">${meta}</div></div>
          <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end">${k.unseen ? badge('Neue Antwort', 'gold') : ''}${k.urgency === 'dringend' && !k.closed ? badge('Dringend', 'red') : ''}${statusBadge(CONCERN_STATUS, k.status)}</div></div>`;
    })
    .join('');
}

function concernsPage(d) {
  const all = d.scope === 'all';
  const count = (f) => d.concerns.filter((k) => concernMatches(k, f)).length;
  const sub = all
    ? 'Alle Anliegen von Mitarbeitern, Mandanten und Website-Besuchern – nur für das Board of Partners sichtbar. Ihre Antworten sehen die Einreichenden in ihrem Dashboard bzw. auf der Website (Vorgangsnummer + Pin); interne Notizen nur das Board.'
    : isStaff()
      ? 'Ein Anliegen an die Führungsebene – Personal, Konflikte, Vorschläge, Abläufe oder Vergütung. Auf Wunsch anonym. Einsehen kann es nur das Board of Partners; hier sehen Sie Ihre eigenen Anliegen und die Antworten.'
      : 'Sie möchten die Kanzleileitung direkt erreichen – etwa zur Betreuung Ihres Mandats, mit einer Beschwerde oder einem Lob? Das Board of Partners kümmert sich persönlich darum. Hier sehen Sie Ihre Anliegen und die Antworten.';
  return `
      <div class="page-head">
        <div><h1 class="page-title">${all ? 'Eingegangene Anliegen' : 'Anliegen an das Board of Partners'}</h1><p class="page-sub">${esc(sub)}</p></div>
        <div class="page-actions"><button class="${all ? 'btn-outline' : 'btn-gold'} btn-md" data-action="concern-new">${icon('plus')}<span>Neues Anliegen</span></button></div>
      </div>
      <div class="toolbar">
        <div class="chip-row">
          ${CONCERN_FILTERS.map(([k, l]) => `<button class="chip ${st.concernFilter === k ? 'active' : ''}" data-action="concern-filter" data-value="${k}">${l} <span class="chip-count">${count(k)}</span></button>`).join('')}
        </div>
        ${all ? `<div class="chip-row">${CONCERN_GROUPS.map(([k, l]) => `<button class="chip ${st.concernGroup === k ? 'active' : ''}" data-action="concern-group" data-value="${k}">${l}</button>`).join('')}</div>` : ''}
      </div>
      <div class="panel p-2 md:p-3">${concernList(d)}</div>`;
}
/** Für alle: eigene Anliegen und Einreichen. */
views.concerns = {
  async load() {
    st.concerns = await api.get('/api/concerns?scope=mine');
  },
  render: () => concernsPage(st.concerns),
};
/** Eingang aller Anliegen – nur Board of Partners. */
views['concerns-board'] = {
  async load() {
    st.concernsAll = await api.get('/api/concerns?scope=all');
  },
  render: () => concernsPage(st.concernsAll),
};

async function concernNewModal() {
  if (!st.concerns) st.concerns = await api.get('/api/concerns?scope=mine');
  const cats = st.concerns.myCategories || {};
  const staff = isStaff();
  openModal(`
      <h2 class="modal-title">Anliegen an das Board of Partners</h2>
      <p class="modal-sub">${staff ? 'Für Führungsthemen: Personal, Konflikte, Vorschläge, Abläufe, Vergütung …' : 'Zur Betreuung Ihres Mandats, einer Rechnung, als Beschwerde oder Lob – direkt an die Kanzleileitung.'} Einsehen kann es nur das Board of Partners; die Antwort finden Sie unter „Anliegen ans Board“.</p>
      <form data-form="concern-new" class="form-grid cols-2">
        <div><label class="label" for="cnCat">Kategorie</label><select id="cnCat" name="category" class="field" required>${Object.entries(cats).map(([k, l]) => opt(k, l)).join('')}</select></div>
        <div><label class="label" for="cnUrg">Dringlichkeit</label><select id="cnUrg" name="urgency" class="field">${opt('normal', 'Normal', true)}${opt('dringend', 'Dringend')}</select></div>
        <div class="span-2"><label class="label" for="cnSubj">Betreff</label><input id="cnSubj" name="subject" class="field" required minlength="3" maxlength="150" autofocus placeholder="${staff ? 'z. B. Vorschlag zur Dienstplanung' : 'z. B. Frage zur Betreuung meiner Akte'}"></div>
        <div class="span-2"><label class="label" for="cnBody">Ihr Anliegen</label><textarea id="cnBody" name="body" rows="7" class="field" required minlength="10" maxlength="5000" placeholder="Bitte schildern Sie Ihr Anliegen möglichst konkret."></textarea></div>
        <label class="check span-2"><input type="checkbox" name="anonymous"><span>Anonym einreichen<span class="block text-dim text-xs">Das Board sieht Ihren Namen nicht – nur, dass es ${staff ? 'von einem Mitarbeiter' : 'von einem Mandanten'} kommt. Antworten erhalten Sie trotzdem hier.</span></span></label>
        <div class="form-actions span-2"><button type="submit" class="btn-gold btn-md">${icon('send')}<span>An das Board senden</span></button></div>
      </form>`);
}

function concernDetailHtml(d) {
  const k = d.concern;
  const asBoard = d.board && !k.mine;
  const info = [
    ['Vorgang', `<span class="font-mono text-gold">${esc(k.reference || '—')}</span>`],
    ['Kategorie', esc(k.categoryLabel)],
    ['Eingereicht von', k.mine ? `Ihnen${k.anonymous ? ' <span class="text-dim">(anonym)</span>' : ''}` : esc(concernFrom(k))],
    ...(k.contact ? [['Kontakt', esc(k.contact)]] : []),
    ['Eingereicht am', esc(fmtDate(k.createdAt)) + (k.source === 'web' ? ' <span class="text-dim">· Website</span>' : '')],
    ['Dringlichkeit', k.urgency === 'dringend' ? badge('Dringend', 'red') : 'Normal'],
    ['Zuständig im Board', esc(k.assignedName || 'noch offen')],
    ['Status', statusBadge(CONCERN_STATUS, k.status)],
  ]
    .map(([l, v]) => `<div><div class="k">${l}</div><div class="v">${v}</div></div>`)
    .join('');
  const thread = d.messages.length
    ? `<div class="timeline">${d.messages
        .map(
          (m) => `<div class="tl-item ${m.internal ? 'tl-internal' : ''} ${m.system ? 'tl-system' : ''}">
              <div class="tl-meta"><span class="text-muted font-medium">${esc(m.author)}</span>${m.fromBoard && !m.system ? badge('Board of Partners', 'gold') : ''}${m.internal ? badge('intern', 'amber') : ''}<span>${esc(fmtDate(m.createdAt))}</span></div>
              <div class="tl-body">${esc(m.body)}</div></div>`
        )
        .join('')}</div>`
    : `<p class="text-sm text-dim">${k.mine ? 'Noch keine Antwort – das Board of Partners meldet sich hier bei Ihnen.' : 'Noch keine Antwort.'}</p>`;
  const canWrite = asBoard || !k.closed;
  const reply = canWrite
    ? `<form data-form="concern-reply" data-id="${k.id}" class="form-grid mt-3">
          <div><label class="label" for="crBody">${asBoard ? 'Antwort an die einreichende Person' : 'Nachricht an das Board'}</label><textarea id="crBody" name="body" rows="4" class="field" required maxlength="5000"></textarea></div>
          ${asBoard ? '<label class="check"><input type="checkbox" name="internal"><span>Interne Notiz <span class="text-dim">– nur für das Board sichtbar</span></span></label>' : ''}
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('send')}<span>Senden</span></button></div>
        </form>`
    : '<p class="text-sm text-dim mt-3">Dieses Anliegen ist abgeschlossen. Für etwas Neues bitte ein neues Anliegen einreichen.</p>';
  const manage = asBoard
    ? `<div class="section"><div class="section-title">Bearbeitung (Board)</div>
          <form data-form="concern-manage" data-id="${k.id}" class="form-grid cols-2">
            <div><label class="label" for="cmStatus">Status</label><select id="cmStatus" name="status" class="field">${Object.entries(CONCERN_STATUS).map(([s, [l]]) => opt(s, l, s === k.status)).join('')}</select></div>
            <div><label class="label" for="cmAssign">Zuständig im Board</label><select id="cmAssign" name="assignedTo" class="field"><option value="">— niemand —</option>${d.boardMembers
            .map((b) => opt(b.id, b.name + (b.rank ? ' · ' + b.rank : ''), b.id === k.assignedTo))
            .join('')}</select></div>
            <div class="form-actions span-2"><button type="submit" class="btn-outline btn-md">${icon('check')}<span>Übernehmen</span></button></div>
          </form></div>`
    : '';
  const tools = [
    d.canWithdraw ? `<button class="btn-ghost btn-sm" data-action="concern-withdraw" data-id="${k.id}">${icon('trash', 'ico-sm')}<span>Zurückziehen</span></button>` : '',
    d.canDelete && !d.canWithdraw ? `<button class="btn-ghost btn-sm" data-action="concern-delete" data-id="${k.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : '',
  ].join('');
  return `
      <h2 class="modal-title">${esc(k.subject)}</h2>
      <p class="modal-sub">Anliegen an das Board of Partners${k.mine && k.anonymous ? ' · anonym eingereicht – das Board sieht Ihren Namen nicht' : ''}</p>
      <div class="info-grid">${info}</div>
      ${boardTicketLine('concern', k.id, d.ticket)}
      <div class="section"><div class="section-title">Anliegen</div><div class="tl-item"><div class="tl-body">${esc(k.body)}</div></div></div>
      <div class="section"><div class="section-title">Verlauf</div>${thread}${reply}</div>
      ${manage}
      ${tools ? `<div class="flex justify-end gap-2 mt-4">${tools}</div>` : ''}`;
}

async function openConcern(id) {
  const d = await api.get('/api/concerns/' + id);
  const html = concernDetailHtml(d);
  if ($('#modal').classList.contains('open') && st.modalConcernId === d.concern.id) replaceModal(html);
  else openModal(html, { wide: true, key: `concern:${d.concern.id}`, reopen: () => openConcern(d.concern.id) });
  st.modalConcernId = d.concern.id;
  // Geöffnet = gelesen: Hinweis „Neue Antwort“ und Zähler in der Navigation aktualisieren.
  for (const [list, view] of [
    [st.concerns, 'concerns'],
    [st.concernsAll, 'concerns-board'],
  ]) {
    const row = list?.concerns.find((x) => x.id === d.concern.id);
    if (row && row.unseen) {
      row.unseen = false;
      if (st.view === view) $('#content').innerHTML = views[view].render();
    }
  }
  if (d.concern.mine) load.concernCount().then(renderNav).catch(() => {});
}

/* ---------------------------------------------------------------- Beförderungen & Einstellungen */
const PERSONNEL_TYPE = { einstellung: ['Einstellung', 'sky'], befoerderung: ['Beförderung', 'gold'], rueckstufung: ['Rückstufung', 'slate'], rangaenderung: ['Rangänderung', 'slate'] };

function personnelItem(e) {
  const p = st.personnel;
  const text =
    e.type === 'einstellung'
      ? `ist neu im Team${e.newRank ? ` als <strong class="text-gold">${esc(e.newRank)}</strong>` : ''}`
      : e.type === 'befoerderung'
        ? `wurde befördert: ${esc(e.oldRank || 'ohne Rang')} → <strong class="text-gold">${esc(e.newRank)}</strong>`
        : `Rang geändert: ${esc(e.oldRank || 'ohne Rang')} → <strong>${esc(e.newRank || 'ohne Rang')}</strong>`;
  return `<div class="list-row wrap pers-row">
      <span class="avatar">${avatarImg(e.avatarUrl, e.name)}</span>
      <div class="main"><div class="title"><span class="font-medium">${esc(e.name)}</span> <span class="text-muted">${text}</span></div>
        <div class="meta">${esc(fmtDate(e.createdAt))} · ${e.type === 'einstellung' ? 'eingestellt' : e.type === 'befoerderung' ? 'befördert' : 'geändert'} von ${esc(e.byName)}</div>
        ${e.note ? `<div class="pers-note">${esc(e.note)}</div>` : ''}</div>
      <div class="flex items-center gap-2 shrink-0">${statusBadge(PERSONNEL_TYPE, e.type)}${p.canDelete ? `<button class="icon-btn sm" data-action="personnel-delete" data-id="${e.id}" aria-label="Eintrag entfernen">${icon('trash', 'ico-sm')}</button>` : ''}</div></div>`;
}

views.personnel = {
  async load() {
    st.personnel = await api.get('/api/personnel');
    st.personnelNew = 0;
  },
  render() {
    const p = st.personnel;
    const since = Date.now() - 30 * 864e5;
    const recent = p.events.filter((e) => (parseDate(e.createdAt) || 0) >= since);
    const n = (t) => recent.filter((e) => e.type === t).length;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Beförderungen &amp; Einstellungen</h1><p class="page-sub">Wer neu im Team ist und wer befördert wurde – für alle Mitarbeiter sichtbar. Befördern kann nur das Board of Partners.</p></div>
          ${p.board ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="personnel-promote">${icon('star')}<span>Befördern</span></button></div>` : ''}
        </div>
        <div class="grid grid-cols-2 gap-3 md:gap-4 mb-4">
          <div class="panel kpi"><div class="kpi-label">${icon('star', 'ico-sm')}Beförderungen</div><div class="kpi-value">${n('befoerderung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('userAdd', 'ico-sm')}Einstellungen</div><div class="kpi-value">${n('einstellung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
        </div>
        <div class="panel p-2 md:p-3">${p.events.length ? p.events.map(personnelItem).join('') : empty('Noch keine Einträge. Einstellungen und Beförderungen erscheinen hier automatisch.', 'star')}</div>`;
  },
};

/** Rangauswahl für Beförderungen: Ränge über maxRank (eigener Rang eines Partners) sind gesperrt. */
function promoteRankSelect(maxRank) {
  const limit = maxRank ? RANKS.indexOf(maxRank) : 0;
  const groups = Object.entries(RANK_GROUPS)
    .map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((r) => `<option value="${esc(r)}" ${RANKS.indexOf(r) < limit ? 'disabled' : ''}>${esc(r)}</option>`).join('')}</optgroup>`)
    .join('');
  return `<select id="prRank" name="rank" class="field" required><option value="" disabled selected>Bitte wählen …</option>${groups}</select>`;
}
function promoteModal() {
  const p = st.personnel;
  const people = (p.staff || []).filter((s) => s.editable);
  if (!people.length) return toast('Es gibt niemanden, dessen Rang Sie ändern können.', 'error');
  openModal(`
      <h2 class="modal-title">Befördern</h2>
      <p class="modal-sub">Neuer Rang für ein Teammitglied. Die Beförderung erscheint für alle Mitarbeiter unter „Beförderungen &amp; Einstellungen“ und – falls eingerichtet – im Discord.${p.maxRank ? ` Sie können bis zu Ihrem eigenen Rang (${esc(p.maxRank)}) befördern.` : ''}</p>
      <form data-form="personnel-promote" class="form-grid">
        <div><label class="label" for="prUser">Teammitglied</label><select id="prUser" name="userId" class="field" required><option value="" disabled selected>Bitte wählen …</option>${people
        .map((s) => opt(s.id, `${s.name} · ${s.rank || 'ohne Rang'}`))
        .join('')}</select></div>
        <div><label class="label" for="prRank">Neuer Rang</label>${promoteRankSelect(p.maxRank)}</div>
        <div id="prPreview" class="text-sm text-dim" aria-live="polite"></div>
        <div><label class="label" for="prNote">Begründung / Glückwunsch <span class="text-dim font-normal normal-case tracking-normal">(optional, für alle sichtbar)</span></label><textarea id="prNote" name="note" rows="3" maxlength="500" class="field" placeholder="z. B. Für herausragende Arbeit im Fall …"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('star')}<span id="prSubmit">Befördern</span></button></div>
      </form>`);
}
/** Vorschau im Beförderungsdialog: „Associate → Senior Associate (Beförderung)“. */
function updatePromotePreview() {
  const u = st.personnel?.staff?.find((s) => s.id === Number($('#prUser')?.value));
  const rank = $('#prRank')?.value;
  const box = $('#prPreview');
  if (!box) return;
  if (!u || !rank) {
    box.textContent = '';
    return;
  }
  const a = RANKS.indexOf(u.rank || '');
  const b = RANKS.indexOf(rank);
  const kind = u.rank === rank ? null : a >= 0 && b > a ? 'Rückstufung' : a >= 0 || b >= 0 ? 'Beförderung' : 'Rangänderung';
  box.innerHTML = kind
    ? `${esc(u.name)}: ${esc(u.rank || 'ohne Rang')} → <strong class="text-gold">${esc(rank)}</strong> ${statusBadge(PERSONNEL_TYPE, kind === 'Rückstufung' ? 'rueckstufung' : 'befoerderung')}`
    : `${esc(u.name)} hat bereits diesen Rang.`;
  $('#prSubmit').textContent = kind === 'Rückstufung' ? 'Rang ändern' : 'Befördern';
}

/* ---------------------------------------------------------------- Kooperationen (Board of Partners) */
const fmtCoopPct = (n) => `${fmtPct(n)} %`;
const coopState = (k) => (!k.active ? ['inaktiv', 'slate'] : !k.valid ? ['abgelaufen', 'amber'] : ['aktiv', 'emerald']);

function coopCard(k) {
  const [stateLabel, stateColor] = coopState(k);
  const roles = k.roles.length
    ? k.roles.map((r) => `<span class="badge badge-sky">@${esc(r.name || r.id)}</span>`).join(' ')
    : '<span class="text-dim">keine – nur von Hand zugeordnete Konten</span>';
  const members = k.members.length
    ? k.members
        .map(
          (m) => `<span class="badge badge-slate inline-flex items-center gap-1">${esc(m.name)}<button type="button" class="hover:text-red-300" data-action="coop-member-remove" data-id="${k.id}" data-user="${m.userId}" data-name="${esc(m.name)}" aria-label="${esc(m.name)} entfernen">${icon('x', 'ico-sm')}</button></span>`
        )
        .join(' ')
    : '<span class="text-dim">keine</span>';
  return `<div class="panel panel-pad">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h3 class="font-serif text-xl font-semibold">${esc(k.name)}</h3>${badge(`${fmtCoopPct(k.discountPct)} Rabatt`, 'gold')}${badge(stateLabel, stateColor)}</div>
          ${k.validUntil ? `<div class="text-xs text-dim mt-1">gültig bis ${esc(fmtDateOnly(k.validUntil))}</div>` : ''}
          ${k.description ? `<p class="text-sm text-muted mt-2 whitespace-pre-wrap">${esc(k.description)}</p>` : ''}</div>
        <div class="flex flex-wrap gap-2"><button class="btn-outline btn-sm" data-action="coop-edit" data-id="${k.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button><button class="btn-ghost btn-sm" data-action="coop-delete" data-id="${k.id}">${icon('trash', 'ico-sm')}</button></div>
      </div>
      <div class="info-grid mt-4">
        <div><div class="k">Discord-Rollen</div><div class="v flex flex-wrap gap-1">${roles}</div>
          <div class="text-xs text-dim mt-1">${k.usesDefaultGuild ? 'Server der Kanzlei (Discord-Tickets)' : `Server ${esc(k.guildId)}`}</div>
          ${k.roleError ? `<div class="text-xs text-red-300 mt-1">${icon('alert', 'ico-sm')} ${esc(k.roleError)}</div>` : ''}</div>
        <div><div class="k">Von Hand zugeordnete Konten</div><div class="v flex flex-wrap gap-1">${members}</div>
          <button class="link-btn mt-1" style="font-size:.75rem" data-action="coop-accounts" data-mode="member" data-id="${k.id}">+ Konto zuordnen</button></div>
      </div></div>`;
}

views.cooperations = {
  async load() {
    st.coops = await api.get('/api/cooperations');
    st.coopList = st.coops.cooperations;
  },
  render() {
    const d = st.coops;
    const warn = !d.discord.bot
      ? `<div class="banner banner-amber">${icon('alert')}<div>Es ist kein Discord-Bot eingerichtet (<code>DISCORD_BOT_TOKEN</code>). Discord-Rollen werden dann nicht erkannt – es gelten nur von Hand zugeordnete Konten.</div></div>`
      : !d.discord.defaultGuild
        ? `<div class="banner banner-amber">${icon('alert')}<div>Kein Discord-Server hinterlegt: unter <a href="/dashboard.html?tab=bot&amp;modul=tickets#settings" class="text-gold underline">Einstellungen → Discord-Bot → Tickets</a> die Server-ID eintragen oder bei jeder Kooperation den Server angeben.</div></div>`
        : '';
    return `
        <div class="page-head">
          <div><h1 class="page-title">Kooperationen</h1><p class="page-sub">Rabatt für Mitglieder von Kooperationspartnern – automatisch erkannt über ihre Discord-Rolle.</p></div>
          <div class="page-actions"><button class="btn-outline btn-md" data-action="coop-accounts" data-mode="check">${icon('search', 'ico-sm')}<span>Mandant prüfen</span></button><button class="btn-gold btn-md" data-action="coop-new">${icon('plus')}<span>Neue Kooperation</span></button></div>
        </div>
        ${warn}
        <div class="panel panel-pad mb-4 text-sm text-muted">
          <strong class="text-white">So funktioniert's:</strong> Kooperation anlegen (z. B. „Burgershot“, 15 %) und die Discord-Rolle der Mitglieder auswählen.
          Erstellt jemand eine Rechnung zu einer Akte, liest der Bot die Discord-Rollen des Mandanten (verknüpftes Discord bzw. „Discord-Ticket beitreten“) und setzt den Kooperationsrabatt automatisch ein.
          Ohne Discord: Mandantenkonten von Hand zuordnen – oder die Kooperation in der Rechnung selbst auswählen.
        </div>
        ${d.cooperations.length ? `<div class="stack">${d.cooperations.map(coopCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Kooperationen. „Neue Kooperation“ legt die erste an.', 'tag')}</div>`}`;
  },
};

function coopForm(k = null) {
  return `
      <h2 id="modalTitle" class="modal-title">${k ? `${esc(k.name)} bearbeiten` : 'Neue Kooperation'}</h2>
      <p class="modal-sub">Mitglieder erhalten den Rabatt auf Rechnungen und Honorarvereinbarungen. Erkannt werden sie über ihre Discord-Rolle oder weil ihr Konto von Hand zugeordnet ist.</p>
      <form data-form="coop" ${k ? `data-id="${k.id}"` : ''} class="form-grid cols-2">
        <div><label class="label">Name des Partners</label><input name="name" class="field" required minlength="2" maxlength="80" value="${esc(k ? k.name : '')}" placeholder="z. B. Burgershot" autofocus></div>
        <div><label class="label">Rabatt in %</label><input name="discountPct" type="number" inputmode="decimal" min="0.5" max="100" step="0.5" class="field" required value="${esc(k ? k.discountPct : 10)}"></div>
        <div><label class="label">Gültig bis <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input name="validUntil" type="date" class="field" value="${esc(k && k.validUntil ? k.validUntil : '')}"></div>
        <div class="flex items-end"><label class="check"><input type="checkbox" name="active" ${!k || k.active ? 'checked' : ''}> Aktiv</label></div>
        <div class="span-2"><label class="label">Vereinbarung / interne Notiz <span class="text-dim font-normal normal-case tracking-normal">(nur für das Team)</span></label><textarea name="description" rows="2" maxlength="1000" class="field" placeholder="z. B. Ansprechpartner, Bedingungen, seit wann">${esc(k ? k.description : '')}</textarea></div>
        <fieldset class="span-2 form-grid">
          <legend class="label flex items-center gap-2">${DISCORD_ICON} Discord-Rollen der Mitglieder</legend>
          <div><label class="label">Discord-Server-ID <span class="text-dim font-normal normal-case tracking-normal">(leer = Server der Kanzlei aus „Discord-Tickets“; ein anderer Server geht, wenn der Bot dort ist)</span></label>
            <div class="flex gap-2"><input id="coopGuild" name="guildId" class="field" inputmode="numeric" maxlength="25" value="${esc(k ? k.guildId : '')}" placeholder="leer lassen = Kanzlei-Server"><button type="button" class="btn-outline btn-md shrink-0" data-action="coop-load-roles">Rollen laden</button></div></div>
          <div id="coopRoles" class="text-sm text-dim">Rollen werden geladen …</div>
          <div><label class="label">Weitere Rollen-IDs <span class="text-dim font-normal normal-case tracking-normal">(optional, kommagetrennt – falls die Liste nicht lädt)</span></label><input name="roleIdsExtra" class="field" maxlength="400" value="" placeholder="123456789012345678"></div>
        </fieldset>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${k ? 'Speichern' : 'Kooperation anlegen'}</span></button></div>
      </form>`;
}

/** Rollen des Servers als Häkchen-Liste; bereits gewählte (auch unbekannte) bleiben angehakt. */
async function loadCoopRoles(selected) {
  const box = $('#coopRoles');
  if (!box) return;
  const guildId = ($('#coopGuild')?.value || '').trim();
  const chosen = new Set(selected || $$('#coopRoles input[name="role"]:checked').map((i) => i.value));
  box.innerHTML = 'Rollen werden geladen …';
  try {
    const { roles } = await api.get(`/api/cooperations/roles?fresh=1${guildId ? `&guildId=${encodeURIComponent(guildId)}` : ''}`);
    const unknown = [...chosen].filter((id) => !roles.some((r) => r.id === id));
    box.innerHTML = roles.length || unknown.length
      ? `<div class="label">Rolle(n) auswählen – wer eine davon hat, bekommt den Rabatt</div><div class="chip-row" style="flex-wrap:wrap">${[
          ...roles.map((r) => `<label class="check chip"><input type="checkbox" name="role" value="${esc(r.id)}" ${chosen.has(r.id) ? 'checked' : ''}> @${esc(r.name)}</label>`),
          ...unknown.map((id) => `<label class="check chip"><input type="checkbox" name="role" value="${esc(id)}" checked> ${esc(id)} <span class="text-red-300">(nicht gefunden)</span></label>`),
        ].join('')}</div>`
      : 'Auf dem Server gibt es keine passenden Rollen.';
  } catch (e) {
    box.innerHTML = `<div class="text-red-300">${icon('alert', 'ico-sm')} ${esc(e.message)}</div>${[...chosen]
      .map((id) => `<label class="check chip mt-2"><input type="checkbox" name="role" value="${esc(id)}" checked> ${esc(id)}</label>`)
      .join('')}`;
  }
}

function coopAccountsDialog(mode, k) {
  return `
      <h2 id="modalTitle" class="modal-title">${mode === 'member' ? `Konto zu „${esc(k.name)}“ zuordnen` : 'Mandant prüfen'}</h2>
      <p class="modal-sub">${mode === 'member' ? 'Für Mitglieder ohne Discord (oder ohne die Rolle): Das Konto erhält den Rabatt dann immer.' : 'Welche Kooperation gilt für diesen Mandanten? Geprüft werden seine Discord-Rollen und von Hand zugeordnete Konten.'}</p>
      <input id="coopAccSearch" class="field" type="search" maxlength="80" placeholder="Name oder E-Mail suchen …" autocomplete="off" data-mode="${mode}" data-id="${k ? k.id : ''}" aria-label="Mandantenkonto suchen" autofocus>
      <div id="coopAccList" class="mt-4 text-sm text-dim">Tippen, um Mandantenkonten zu suchen.</div>
      <div id="coopCheckResult" class="mt-4"></div>`;
}
async function searchCoopAccounts(input) {
  const q = input.value.trim();
  const { accounts } = await api.get(`/api/cases/client-accounts?q=${encodeURIComponent(q)}`);
  if (!input.isConnected || input.value.trim() !== q) return;
  const mode = input.dataset.mode;
  $('#coopAccList').innerHTML = accounts.length
    ? accounts
        .map(
          (a) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.email)}</div></div>
              <button class="btn-${mode === 'member' ? 'gold' : 'outline'} btn-sm shrink-0" data-action="${mode === 'member' ? 'coop-member-add' : 'coop-check'}" data-id="${esc(input.dataset.id)}" data-user="${a.id}" data-name="${esc(a.name)}">${mode === 'member' ? 'Zuordnen' : 'Prüfen'}</button></div>`
        )
        .join('')
    : '<p class="text-sm text-dim">Kein Mandantenkonto gefunden.</p>';
}
function coopDetectHtml(r, name) {
  const hits = r.matches.length
    ? r.matches
        .map((m, i) => `<div class="flex flex-wrap items-center gap-2">${badge(`${fmtCoopPct(m.discountPct)}`, i === 0 ? 'gold' : 'slate')}<strong>${esc(m.name)}</strong><span class="text-xs text-dim">${esc(m.detail)}</span>${i === 0 && r.matches.length > 1 ? badge('wird angewandt (höchster Rabatt)', 'emerald') : ''}</div>`)
        .join('')
    : `<div class="text-muted">${r.checkedDiscord ? 'Keine Kooperation – der Mandant hat keine der eingestellten Discord-Rollen.' : 'Keine Kooperation erkannt.'}</div>`;
  return `<div class="banner ${r.matches.length ? 'banner-gold' : 'banner-slate'} is-stack">
      <div class="text-xs uppercase tracking-widest opacity-80 mb-2">Ergebnis für ${esc(name)}</div><div class="space-y-2">${hits}</div>
      ${r.notes.length ? `<div class="text-xs text-dim mt-2">${r.notes.map(esc).join('<br>')}</div>` : ''}</div>`;
}

/* ---------------------------------------------------------------- Aktenbearbeitung (nur Board of Partners) */
/** Dauer lesbar: 45 Min · 3 Std 20 Min · 4 T 6 Std */
function fmtDur(ms) {
  if (ms == null) return '—';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} Std${min % 60 ? ` ${min % 60} Min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'Tag' : 'Tage'}${h % 24 ? ` ${h % 24} Std` : ''}`;
}
const ROLE_BADGE = { lead: ['federführend', 'gold'], co: ['weiterer Anwalt', 'sky'] };
const WORK_DAYS = [
  [7, '7 Tage'],
  [30, '30 Tage'],
  [90, '90 Tage'],
  [365, '1 Jahr'],
  [0, 'Alles'],
];

function workCaseLine(w) {
  return `<div class="list-row wrap">
      <div class="main"><div class="title flex flex-wrap items-center gap-2"><button type="button" class="link-btn font-mono" data-action="open-case" data-id="${w.caseId}">${esc(w.caseNumber)}</button>${esc(w.caseTitle)}</div>
        <div class="meta">${statusBadge(ROLE_BADGE, w.role)} seit ${esc(fmtDate(w.since))}${w.running ? '' : ` · beendet ${esc(fmtDate(w.endedAt))}${w.endReason ? ' (' + esc(w.endReason) + ')' : ''}`}${w.estimated ? ' · <span title="Vor Einführung der Erfassung – Beginn aus dem Aktenverlauf geschätzt">≈ geschätzt</span>' : ''}</div></div>
      <div class="shrink-0 text-right"><div class="font-mono text-sm ${w.running ? 'text-emerald-300' : 'text-gold'}">${w.estimated ? '≈ ' : ''}${esc(fmtDur(w.durationMs))}</div><div class="text-xs text-dim">${w.running ? 'läuft' : 'abgeschlossen'}</div></div>
    </div>`;
}

views.work = {
  async load() {
    st.work = await api.get('/api/work?days=' + (st.workDays ?? 90));
  },
  render() {
    const w = st.work;
    const sm = w.summary;
    const chips = WORK_DAYS.map(([d, l]) => `<button class="chip ${w.days === d ? 'active' : ''}" data-action="work-days" data-days="${d}">${esc(l)}</button>`).join('');
    const members = w.members.length
      ? w.members
          .map(
            (m) => `<section class="panel panel-pad">
              <div class="panel-head"><div><h2 class="panel-title">${esc(m.name)}</h2><div class="text-xs text-dim">${esc(m.rank || 'ohne Rang')}${m.active ? '' : ' · deaktiviert'}</div></div>
                ${m.runningCount ? badge(`${m.runningCount} in Bearbeitung`, 'emerald') : badge('keine laufende Akte', 'slate')}</div>
              <div class="work-stats">
                <div><span class="k">Laufend</span><span class="v">${m.runningCount}</span><span class="s">${esc(fmtDur(m.runningMs))} insgesamt</span></div>
                <div><span class="k">Abgeschlossen</span><span class="v">${m.finishedCount}</span><span class="s">${esc(fmtDur(m.finishedMs))} insgesamt</span></div>
                <div><span class="k">Ø je Akte</span><span class="v">${esc(fmtDur(m.avgFinishedMs))}</span><span class="s">abgeschlossene</span></div>
              </div>
              ${m.cases.length ? `<details class="work-list" ${m.runningCount ? 'open' : ''}><summary>${m.cases.length} ${m.cases.length === 1 ? 'Akte' : 'Akten'} im Zeitraum</summary>${m.cases.map(workCaseLine).join('')}</details>` : '<p class="text-sm text-dim">Keine Akten im Zeitraum.</p>'}
            </section>`
          )
          .join('')
      : empty('Keine Mitarbeiter mit Akten im Zeitraum.', 'users');
    const caseRows = w.cases.length
      ? `<div class="tbl-wrap"><table class="tbl tbl-cards">
            <thead><tr><th>Akte</th><th>Zuständig</th><th>Status</th><th>Bearbeitungsdauer</th></tr></thead>
            <tbody>${w.cases
            .map(
              (c) => `<tr class="row" data-action="open-case" data-id="${c.id}">
                <td class="td-main"><div class="font-mono text-gold text-xs">${esc(c.caseNumber)}</div><div class="font-medium">${esc(c.title)}</div></td>
                <td data-label="Zuständig">${c.team.length ? c.team.map((t) => esc(t.name) + (t.role === 'lead' && c.team.length > 1 ? ' <span class="text-dim text-xs">(federführend)</span>' : '')).join(', ') : c.closed ? '<span class="text-dim">—</span>' : badge('Unbesetzt', 'amber')}</td>
                <td data-label="Status">${statusBadge(CASE_STATUS, c.status)}</td>
                <td data-label="Dauer" class="nowrap"><span class="font-mono ${c.closed ? 'text-gold' : 'text-emerald-300'}">${esc(fmtDur(c.durationMs))}</span><div class="text-xs text-dim">${c.closed ? `bis Abschluss ${esc(fmtDate(c.closedAt))}` : `offen seit ${esc(fmtDate(c.openedAt))}`}</div></td></tr>`
            )
            .join('')}</tbody></table></div>`
      : empty('Keine Akten im Zeitraum.', 'folder');
    return `
        <div class="page-head">
          <div><h1 class="page-title">Aktenbearbeitung</h1><p class="page-sub">Wer bearbeitet welche Akten – und wie lange. Nur für das Board of Partners sichtbar; erfasst wird automatisch bei Zuweisung, Abgabe und Abschluss.</p></div>
        </div>
        <div class="chip-row mb-4" role="group" aria-label="Zeitraum">${chips}</div>
        <div class="kpi-grid mb-4 lg:mb-5">
          ${kpi('Akten in Bearbeitung', String(sm.runningCases), `${sm.unassigned} davon ohne Anwalt`, 'briefcase', '#work')}
          ${kpi('Geschlossen', String(sm.closedCases), w.days ? `in den letzten ${w.days} Tagen` : 'insgesamt', 'check', '#work')}
          ${kpi('Ø Bearbeitungsdauer', fmtDur(sm.avgClosedMs), 'Eröffnung bis Abschluss', 'clock', '#work')}
          ${kpi('Mitarbeiter', String(w.members.filter((m) => m.runningCount).length), 'mit laufenden Akten', 'users', '#work')}
        </div>
        ${sm.estimatedEntries ? '<p class="form-hint mb-4">≈ = vor Einführung der Erfassung; Beginn aus dem Aktenverlauf geschätzt.</p>' : ''}
        <div class="grid-2 mb-4 lg:mb-5 items-start">${members}</div>
        <section class="panel panel-pad"><div class="panel-head"><h2 class="panel-title">Akten nach Bearbeitungsdauer</h2></div>${caseRows}</section>`;
  },
};

/** Akte: Bearbeitungszeiten (nur Board of Partners). */
function caseWorkSection(c, work) {
  if (!work || !isBoard()) return '';
  const now = Date.now();
  const opened = parseDate(c.createdAt);
  const end = work.closedAt ? parseDate(work.closedAt) : null;
  const total = opened ? (end ? end.getTime() : now) - opened.getTime() : null;
  const rows = work.rows.length
    ? work.rows
        .map(
          (w) => `<div class="list-row wrap"><div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(w.name)}${statusBadge(ROLE_BADGE, w.role)}</div>
              <div class="meta">${esc(fmtDate(w.startedAt))} – ${w.running ? 'heute' : esc(fmtDate(w.endedAt))}${w.endReason ? ' · ' + esc(w.endReason) : ''}${w.estimated ? ' · ≈ geschätzt' : ''}</div></div>
              <span class="font-mono text-sm shrink-0 ${w.running ? 'text-emerald-300' : 'text-gold'}">${w.estimated ? '≈ ' : ''}${esc(fmtDur(w.durationMs))}</span></div>`
        )
        .join('')
    : '<p class="text-sm text-dim">Noch keine Bearbeitung erfasst.</p>';
  return `<div class="section" id="secWork"><h3 class="section-title">Bearbeitungszeiten <span class="text-xs text-dim font-normal">nur Board of Partners</span></h3>
      <p class="text-sm text-muted mb-2">${end ? `Bearbeitungsdauer bis zum Abschluss: <strong>${esc(fmtDur(total))}</strong>` : `Offen seit <strong>${esc(fmtDur(total))}</strong>`}</p>
      ${rows}</div>`;
}

/* ---------------------------------------------------------------- Abmeldungen */
const ABSENCE_BADGE = { aktiv: ['abgemeldet', 'amber'], geplant: ['geplant', 'sky'], vorbei: ['beendet', 'slate'] };
const dayDe = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const absenceDays = (a) => Math.round((new Date(`${a.endDate}T12:00:00`) - new Date(`${a.startDate}T12:00:00`)) / 864e5) + 1;

/** Übersicht: kurze Zeile, wer heute abgemeldet ist. */
function absenceStrip() {
  const now = (st.absences?.absences || []).filter((a) => a.state === 'aktiv');
  if (!isStaff() || !now.length) return '';
  return `<a href="#duty" class="absence-strip mb-4 lg:mb-5">${icon('calendar', 'ico-sm')}<span><strong>Heute abgemeldet:</strong> ${now
    .map((a) => `${esc(a.name)} <span class="text-dim">(bis ${esc(dayDe(a.endDate))}, ${esc(a.reasonLabel)})</span>`)
    .join(', ')}</span></a>`;
}

function absencePanel() {
  const data = st.absences;
  if (!data) return '';
  const list = data.absences.filter((a) => a.state !== 'vorbei');
  const rows = list.length
    ? list
        .map((a) => {
          const left = a.state === 'aktiv' ? daysUntil(a.endDate) : null;
          return `<div class="list-row wrap">
              ${avatarWrap(a.avatarUrl, a.name, null, 'sm')}
              <div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(a.name)}${statusBadge(ABSENCE_BADGE, a.state)}${badge(a.reasonLabel, 'slate')}</div>
                <div class="meta">${esc(dayDe(a.startDate))} – ${esc(dayDe(a.endDate))} · ${absenceDays(a)} ${absenceDays(a) === 1 ? 'Tag' : 'Tage'}${left !== null ? ` · ${left === 0 ? 'letzter Tag heute' : `noch ${left + 1} Tage`}` : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
              ${a.canManage
              ? `<div class="flex gap-1 shrink-0">${a.state === 'aktiv' ? `<button class="btn-outline btn-sm" data-action="absence-return" data-id="${a.id}">Zurückmelden</button>` : ''}
                    <button class="btn-ghost btn-sm" data-action="absence-delete" data-id="${a.id}">${a.state === 'geplant' ? 'Zurückziehen' : 'Löschen'}</button></div>`
              : ''}
            </div>`;
        })
        .join('')
    : empty('Niemand ist abgemeldet.', 'calendar');
  const mine = list.find((a) => a.userId === st.user.id && a.state === 'aktiv');
  return `<section class="panel panel-pad mb-4 lg:mb-5" id="secAbsences">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('calendar')} Abmeldungen</h2>
        <button class="btn-outline btn-sm" data-action="absence-new">${icon('plus', 'ico-sm')}<span>Abmelden</span></button></div>
      ${mine ? `<div class="banner banner-amber mb-3">${icon('alert')}<div>Sie sind bis ${esc(dayDe(mine.endDate))} abgemeldet. Wieder da? <button class="link-btn" data-action="absence-return" data-id="${mine.id}">Jetzt zurückmelden</button></div></div>` : ''}
      ${rows}
      <p class="form-hint mt-3">Abmeldungen, Rückmeldungen und Zurückziehen erscheinen auf Wunsch in Discord (Einstellungen → Discord → „Abmeldung / Rückmeldung“).</p>
    </section>`;
}

async function absenceModal() {
  const data = st.absences || (st.absences = await api.get('/api/absences'));
  if (isAdmin()) await load.lawyers();
  const today = data.today;
  openModal(`
      <h2 class="modal-title">Abmelden</h2>
      <p class="modal-sub">Abwesenheit eintragen – das Team sieht sie unter „Dienstzeiten“, auf Wunsch geht sie auch in den Discord.</p>
      <form data-form="absence" class="form-grid cols-2">
        ${isAdmin() ? `<div class="span-2"><label class="label">Wer?</label><select name="userId" class="field">${st.lawyers.map((l) => opt(l.id, l.displayName + (l.id === st.user.id ? ' (Sie)' : ''), l.id === st.user.id)).join('')}</select></div>` : ''}
        <div><label class="label" for="abFrom">Von</label><input id="abFrom" name="startDate" type="date" class="field" required min="${esc(today)}" value="${esc(today)}"></div>
        <div><label class="label" for="abTo">Bis (einschließlich)</label><input id="abTo" name="endDate" type="date" class="field" required min="${esc(today)}" value="${esc(today)}"></div>
        <div class="span-2"><label class="label">Grund</label><div class="chip-row" role="radiogroup">${Object.entries(data.reasons)
        .map(([k, l], i) => `<label class="chip-radio"><input type="radio" name="reason" value="${k}" ${i === 0 ? 'checked' : ''}><span>${esc(l)}</span></label>`)
        .join('')}</div></div>
        <div class="span-2"><label class="label" for="abNote">Notiz (optional)</label><input id="abNote" name="note" class="field" maxlength="300" placeholder="z. B. im Urlaub, per Discord erreichbar"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Abmeldung eintragen</span></button></div>
      </form>`);
}

views.duty = {
  async load() {
    if (!st.dutyWeek) st.dutyWeek = mondayOf(new Date());
    const { from, to } = weekRange();
    const [state, data, absences] = await Promise.all([
      api.get('/api/duty'),
      api.get(`/api/duty/sessions?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api.get('/api/absences'),
    ]);
    st.duty = state;
    st.dutyData = data;
    st.absences = absences;
    if (!st.dutyUser || !data.totals.some((t) => t.userId === st.dutyUser)) st.dutyUser = st.user.id;
    renderUser();
  },
  render() {
    const admin = isAdmin();
    const me = st.duty.me;
    const onDuty = st.duty.onDuty;
    const { from, to } = weekRange();
    const lastDay = new Date(to.getTime() - 864e5);
    const weekLabel = `KW ${isoWeek(from)} · ${from.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}–${lastDay.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
    const totals = st.dutyData.totals;
    const sumMinutes = totals.reduce((s, t) => s + t.minutes, 0);
    const selected = totals.find((t) => t.userId === st.dutyUser) || totals[0];
    const sessions = st.dutyData.sessions.filter((s) => selected && s.userId === selected.userId);
    const isCurrentWeek = mondayOf(new Date()).getTime() === from.getTime();

    const myCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Mein Dienst</h2>${me.status !== 'off' ? badge('Eingestempelt', 'emerald') : badge('Ausgestempelt', 'slate')}</div>
          <div class="flex items-center gap-4 mb-4">
            ${avatarWrap(st.user.avatarUrl, st.user.displayName, me.status, 'lg')}
            <div>
              <div class="text-sm text-muted">${esc(DUTY[me.status])}${me.note ? ' · ' + esc(me.note) : ''}</div>
              ${me.status !== 'off' && me.since
              ? `<div class="timer" data-countup="${esc(me.since)}">${esc(fmtElapsed(Date.now() - parseDate(me.since).getTime()))}</div><div class="text-xs text-dim">seit ${esc(fmtTime(me.since))} Uhr</div>`
              : '<div class="timer" style="color:var(--text-dim)">0:00:00</div><div class="text-xs text-dim">Nicht im Dienst</div>'}
            </div>
          </div>
          <div class="duty-options mb-4">${Object.entries(DUTY)
          .map(([k, l]) => `<button type="button" class="duty-opt ${me.status === k ? 'active' : ''}" data-action="duty-set" data-status="${k}"><span class="duty-dot s-${k}"></span>${esc(k === 'off' && me.status !== 'off' ? 'Ausstempeln' : l)}</button>`)
          .join('')}</div>
          <form data-form="duty-note" class="flex flex-col sm:flex-row gap-2">
            <input name="note" class="field" maxlength="120" value="${esc(me.note)}" placeholder="Wo sind Sie? z. B. Mission Row PD, Zelle 3" aria-label="Notiz zum Dienststatus">
            <button type="submit" class="btn-outline btn-md" ${me.status === 'off' ? 'disabled' : ''}>Notiz speichern</button>
          </form>
          <p class="form-hint mt-2">Vergessenes Ausstempeln wird nach 12 Stunden automatisch beendet.</p>
        </section>`;

    const onDutyCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Jetzt im Dienst</h2>${badge(`${onDuty.length}`, onDuty.length ? 'emerald' : 'slate')}</div>
          ${onDuty.length
          ? onDuty
              .map(
                (m) => `<div class="list-row wrap">
                    ${avatarWrap(m.avatarUrl, m.name, m.status, 'sm')}
                    <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${esc(m.statusLabel)}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
                    <div class="flex items-center gap-2 shrink-0"><span class="font-mono text-xs text-gold" data-countup="${esc(m.since)}">${esc(fmtElapsed(Date.now() - (parseDate(m.since)?.getTime() || Date.now())))}</span>
                    ${admin && m.id !== st.user.id ? `<button class="btn-ghost btn-sm" data-action="duty-force-off" data-id="${m.id}" data-name="${esc(m.name)}">Ausstempeln</button>` : ''}</div>
                  </div>`
              )
              .join('')
          : empty('Gerade ist niemand im Dienst.', 'clock')}
        </section>`;

    const totalsTable = `
        <div class="tbl-wrap"><table class="tbl tbl-cards">
          <thead><tr><th>${admin ? 'Teammitglied' : 'Woche'}</th><th>Arbeitszeit</th><th>Schichten</th><th>Status</th></tr></thead>
          <tbody>${totals
          .map(
            (t) => `<tr class="row ${selected && t.userId === selected.userId ? 'is-selected' : ''}" data-action="duty-select" data-id="${t.userId}">
                <td class="td-main"><div class="flex items-center gap-3">${avatarWrap(t.avatarUrl, t.name, t.status !== 'off' ? t.status : null, 'sm')}<div><div class="font-medium">${esc(t.name)}</div><div class="text-xs text-dim">${esc(t.rank || '')}</div></div></div></td>
                <td data-label="Arbeitszeit" class="font-mono nowrap">${esc(fmtHM(t.minutes))}</td>
                <td data-label="Schichten">${t.sessions}</td>
                <td data-label="Status">${t.status !== 'off' ? badge(DUTY[t.status], 'emerald') : '<span class="text-dim text-xs">außer Dienst</span>'}</td></tr>`
          )
          .join('')}</tbody></table></div>`;

    const sessionList = sessions.length
      ? sessions
          .map((s) => {
            const start = parseDate(s.startedAt);
            const end = s.endedAt ? parseDate(s.endedAt) : null;
            const dur = ((end ? end.getTime() : Date.now()) - start.getTime()) / 60000;
            return `<div class="list-row wrap">
                <div class="main"><div class="title">${esc(start.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }))} · ${esc(fmtTime(s.startedAt))} – ${end ? esc(fmtTime(s.endedAt)) : '<span class="text-emerald-300">läuft</span>'} Uhr</div>
                  <div class="meta">${esc(fmtHM(dur))}${s.note ? ' · ' + esc(s.note) : ''}${s.autoClosed ? ' · automatisch beendet' : ''}</div></div>
                ${admin ? `<div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="duty-session-edit" data-id="${s.id}" aria-label="Schicht bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="duty-session-delete" data-id="${s.id}" aria-label="Schicht löschen">${icon('trash', 'ico-sm')}</button></div>` : ''}
              </div>`;
          })
          .join('')
      : empty('Keine Schichten in dieser Woche.', 'clock');

    return `
        <div class="page-head">
          <div><h1 class="page-title">Stempeluhr & Dienstzeiten</h1><p class="page-sub">Dienst beginnen und beenden, Abmeldungen eintragen, Wochenstunden des Teams im Blick – ideal für Gehaltsabrechnung und Eilnotdienst.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="absence-new">${icon('calendar', 'ico-sm')}<span>Abmelden</span></button>
          ${admin ? `<button class="btn-outline btn-md" data-action="duty-session-new">${icon('plus', 'ico-sm')}<span>Schicht nachtragen</span></button>` : ''}</div>
        </div>
        <div class="grid-2 mb-4 lg:mb-5">${myCard}${onDutyCard}</div>
        ${absencePanel()}
        <section class="panel panel-pad mb-4 lg:mb-5">
          <div class="panel-head">
            <div class="week-nav">
              <button class="icon-btn" data-action="duty-week" data-dir="-1" aria-label="Vorherige Woche">${icon('chevronLeft')}</button>
              <span class="lbl">${esc(weekLabel)}</span>
              <button class="icon-btn" data-action="duty-week" data-dir="1" aria-label="Nächste Woche" ${isCurrentWeek ? 'disabled' : ''}>${icon('chevronRight')}</button>
              ${isCurrentWeek ? '' : '<button class="btn-outline btn-sm" data-action="duty-week" data-dir="0">Diese Woche</button>'}
            </div>
            ${admin ? `<span class="text-sm text-muted">Team gesamt: <span class="font-mono text-gold">${esc(fmtHM(sumMinutes))}</span></span>` : ''}
          </div>
          ${totalsTable}
        </section>
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Schichten${selected ? ' – ' + esc(selected.name) : ''}</h2></div>
          ${sessionList}
        </section>`;
  },
};

function dutySessionModal(s) {
  const isNew = !s;
  const members = st.dutyData.totals;
  openModal(`
      <h2 class="modal-title">${isNew ? 'Schicht nachtragen' : 'Schicht bearbeiten'}</h2>
      <p class="modal-sub">${isNew ? 'Zum Beispiel wenn jemand vergessen hat einzustempeln.' : esc(s.userName)}</p>
      <form data-form="duty-session" data-id="${isNew ? '' : s.id}" class="form-grid cols-2">
        ${isNew ? `<div class="span-2"><label class="label">Teammitglied</label><select name="userId" class="field">${members.map((m) => opt(m.userId, m.name, m.userId === st.dutyUser)).join('')}</select></div>` : ''}
        <div><label class="label">Beginn</label><input name="startedAt" type="datetime-local" class="field" required value="${s ? toLocalInput(s.startedAt) : ''}"></div>
        <div><label class="label">Ende</label><input name="endedAt" type="datetime-local" class="field" ${isNew ? 'required' : ''} value="${s && s.endedAt ? toLocalInput(s.endedAt) : ''}"></div>
        <div class="span-2"><label class="label">Notiz</label><input name="note" class="field" maxlength="120" value="${esc(s ? s.note : '')}"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Bewerbungen */
const OPEN_APP = ['eingegangen', 'in_pruefung', 'gespraech'];
const stars = (n) => `<span class="stars readonly" aria-label="${n} von 5 Sternen">${'★'.repeat(n)}${'<span style="opacity:.25">★</span>'.repeat(5 - n)}</span>`;

function appTable() {
  const f = st.appFilter;
  const rows = st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f));
  if (!rows.length) return empty(st.applications.length ? 'Keine Bewerbungen für diese Auswahl.' : 'Noch keine Bewerbungen eingegangen.', 'userAdd');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Bewerbung</th><th>Stelle</th><th>Eingang</th><th>Bewertung</th><th>Status</th></tr></thead>
      <tbody>${rows
      .map(
        (a) => `<tr class="row" data-action="app-open" data-id="${a.id}">
          <td class="td-main"><div class="font-mono text-gold text-xs">${esc(a.number)}</div><div class="font-medium">${esc(a.name)}${a.age ? ` <span class="text-dim text-xs">(${esc(a.age)})</span>` : ''}</div><div class="text-xs text-dim">Discord: ${esc(a.discord || '—')}</div></td>
          <td data-label="Stelle">${esc(a.positionTitle)}</td>
          <td data-label="Eingang" class="text-xs text-dim nowrap">${esc(fmtDate(a.createdAt))}</td>
          <td data-label="Bewertung">${stars(a.rating)}</td>
          <td data-label="Status">${statusBadge(APP_STATUS, a.status)}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

function positionsPanel() {
  return `<div class="panel panel-pad">
      ${st.positions.length
      ? st.positions
          .map(
            (p) => `<div class="list-row wrap">
              <div class="main"><div class="title">${esc(p.title)} ${p.active ? badge('Ausgeschrieben', 'emerald') : badge('Pausiert', 'slate')}</div><div class="meta">${esc(p.description)}</div></div>
              <div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="position-edit" data-id="${p.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="position-delete" data-id="${p.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></div>`
          )
          .join('')
      : empty('Keine Stellen ausgeschrieben. Initiativbewerbungen sind trotzdem möglich.', 'briefcase')}
    </div>`;
}

views.applications = {
  async load() {
    const [a, p] = await Promise.all([api.get('/api/admin/applications'), api.get('/api/admin/positions')]);
    st.applications = a.applications;
    st.positions = p.positions;
    st.newApplications = st.applications.filter((x) => x.status === 'eingegangen').length;
  },
  render() {
    const count = (f) => st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f)).length;
    const filters = [['offen', 'Offen'], ...Object.entries(APP_STATUS).map(([k, [l]]) => [k, l]), ['alle', 'Alle']];
    const tabBewerbungen = st.appTab === 'bewerbungen';
    return `
        <div class="page-head">
          <div><h1 class="page-title">Bewerbungen</h1><p class="page-sub">Bewerbungen prüfen, bewerten, zum Gespräch einladen und mit einem Klick einstellen.</p></div>
          <div class="page-actions">
            <a href="/karriere.html" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Karriereseite</span></a>
            ${tabBewerbungen ? '' : `<button class="btn-gold btn-md" data-action="position-new">${icon('plus')}<span>Neue Stelle</span></button>`}
          </div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="bewerbungen">${icon('userAdd', 'ico-sm')}Bewerbungen <span class="chip-count">${st.applications.length}</span></button>
          <button class="chip ${!tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="stellen">${icon('briefcase', 'ico-sm')}Stellenausschreibungen <span class="chip-count">${st.positions.filter((p) => p.active).length}</span></button>
        </div>
        ${tabBewerbungen
        ? `<div class="chip-row mb-4">${filters.map(([k, l]) => `<button class="chip ${st.appFilter === k ? 'active' : ''}" data-action="app-filter" data-value="${k}">${esc(l)} <span class="chip-count">${count(k)}</span></button>`).join('')}</div>
             <div class="panel p-2 md:p-3">${appTable()}</div>`
        : positionsPanel()}`;
  },
};

async function openApplication(id) {
  const data = await api.get('/api/admin/applications/' + id);
  openModal(appDetail(data), { wide: true, key: `app:${id}`, reopen: () => openApplication(id) });
  st.modalAppId = id;
}
async function reloadApplication(data) {
  if (st.modalAppId === data.application.id) replaceModal(appDetail(data));
  refreshBehind();
}

function appDetail({ application: a, notes, hiredUser, ticket }) {
  const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;
  const qa = (q, text) => (text ? `<div class="qa"><div class="q">${esc(q)}</div><div class="a">${esc(text)}</div></div>` : '');
  return `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4 pr-12">
        <div class="min-w-0"><div class="font-mono text-gold text-sm">${esc(a.number)}</div>
          <h2 id="modalTitle" class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(a.name)}</h2>
          <div class="text-sm text-muted">${esc(a.positionTitle)}</div></div>
        ${statusBadge(APP_STATUS, a.status)}
      </div>
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <span class="text-xs uppercase tracking-widest text-dim">Bewertung</span>
        <span class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5]
        .map((n) => `<button type="button" class="${n <= a.rating ? 'on' : ''}" data-action="app-rate" data-id="${a.id}" data-value="${n === a.rating ? 0 : n}" aria-label="${n} Sterne">★</button>`)
        .join('')}</span>
      </div>
      <div class="chip-row mb-5" role="group" aria-label="Status">${Object.entries(APP_STATUS)
      .map(([k, [l]]) => `<button type="button" class="chip ${a.status === k ? 'active' : ''}" data-action="app-status" data-id="${a.id}" data-status="${k}">${esc(l)}</button>`)
      .join('')}</div>
      ${hiredUser ? `<div class="banner banner-gold">${icon('check')}<div>Eingestellt – Login-Konto <strong>${esc(hiredUser.email)}</strong> wurde angelegt.</div></div>` : ''}
      <div class="info-grid mb-5">${cell('Alter', a.age ? String(a.age) : '')}${cell('Telefon', a.phone)}${cell('Discord', a.discord)}${cell('E-Mail', a.email)}${cell('Eingegangen', fmtDate(a.createdAt))}${cell('Gespräch', a.interviewAt ? fmtDate(a.interviewAt) : '')}</div>
      ${boardTicketLine('application', a.id, ticket)}
      <div class="stack">${qa('Motivation', a.motivation)}${qa('Erfahrung', a.experience)}${qa('Verfügbarkeit', a.availability)}</div>

      <div class="grid-2 section">
        <form data-form="app-interview" data-id="${a.id}" class="qa form-grid">
          <div class="q">Zum Gespräch einladen</div>
          <div><label class="label">Termin</label><input name="startsAt" type="datetime-local" class="field" required value="${a.interviewAt ? toLocalInput(a.interviewAt) : ''}"></div>
          <div><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="Kanzlei Würfelpark"></div>
          <button type="submit" class="btn-outline btn-md">${icon('calendar', 'ico-sm')}<span>Gespräch planen</span></button>
          <p class="form-hint">Setzt den Status auf „Einladung zum Gespräch“ und trägt den Termin in den Team-Kalender ein.</p>
        </form>
        <form data-form="app-public-note" data-id="${a.id}" class="qa form-grid">
          <div class="q">Nachricht an den Bewerber</div>
          <textarea name="publicNote" rows="4" maxlength="1000" class="field" placeholder="z. B. Vielen Dank! Wir melden uns bis Freitag.">${esc(a.publicNote)}</textarea>
          <button type="submit" class="btn-outline btn-md">Speichern</button>
          <p class="form-hint">Sichtbar in der Statusabfrage auf der Karriereseite.</p>
        </form>
      </div>

      <div class="form-actions section">
        ${!hiredUser ? `<button class="btn-gold btn-md" data-action="app-hire" data-id="${a.id}">${icon('userAdd', 'ico-sm')}<span>Einstellen & Konto anlegen</span></button>` : ''}
        ${a.status !== 'abgelehnt' && !hiredUser ? `<button class="btn-outline btn-md" data-action="app-status" data-id="${a.id}" data-status="abgelehnt">Absagen</button>` : ''}
        ${isAdmin() ? `<button class="btn-danger btn-md" data-action="app-delete" data-id="${a.id}" data-number="${esc(a.number)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
      </div>

      <div class="section"><h3 class="section-title">Interne Notizen</h3>
        ${notes.length ? `<div class="timeline">${notes.map((n) => `<div class="tl-item"><div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span><span>${esc(fmtDate(n.createdAt))}</span></div><div class="tl-body">${esc(n.body)}</div></div>`).join('')}</div>` : '<p class="text-sm text-dim">Noch keine Notizen.</p>'}
        <form data-form="app-note" data-id="${a.id}" class="mt-3 space-y-3">
          <textarea name="body" rows="2" maxlength="3000" required class="field" placeholder="Eindruck aus dem Gespräch, Rückfragen …" aria-label="Interne Notiz"></textarea>
          <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Notiz speichern</span></button>
        </form>
      </div>`;
}

function hireModal(a) {
  // Vorschlag aus der Stellenbezeichnung (z. B. „Associate / Rechtsanwalt (m/w/d)“ → Associate)
  const rank = a.positionTitle.replace(/\s*\(m\/w\/d\)\s*/i, '').replace('Initiativbewerbung', 'Junior Associate').split('/')[0].trim();
  openModal(`
      <h2 class="modal-title">${esc(a.name)} einstellen</h2>
      <p class="modal-sub">Legt ein Login-Konto mit Einmal-Passwort an und auf Wunsch ein Profil im Bereich „Unser Team“ auf der Website.</p>
      <form data-form="app-hire" data-id="${a.id}" class="form-grid cols-2">
        <div class="span-2"><label class="label">E-Mail (Login)</label>${emailField('email', { value: emailLocalFromName(a.name), required: true, autofocus: true })}
          <p class="form-hint">Vorschlag aus dem Namen – frei änderbar. Kontakt-E-Mail aus der Bewerbung: ${esc(a.email || '—')}</p></div>
        <div><label class="label">Rang</label>${rankSelect('rank', RANKS.includes(rank) && (isAdmin() || RANKS.indexOf(rank) >= RANKS.indexOf(st.user.rank)) ? rank : '', { emptyLabel: '— ohne Rang (z. B. Assistenz) —' })}
          ${isAdmin() ? '' : `<p class="form-hint">Sie können bis zu Ihrem eigenen Rang (${esc(st.user.rank || '—')}) einstellen.</p>`}</div>
        <div><label class="label">Rolle im Dashboard</label><select name="role" class="field">${opt('anwalt', 'Anwalt / Mitarbeiter', true)}${isAdmin() ? opt('admin', 'Board of Partners (Admin)') : ''}</select></div>
        <div class="span-2"><label class="label">Kurzbeschreibung für die Website (optional)</label><textarea name="description" rows="2" maxlength="400" class="field"></textarea></div>
        <label class="check span-2"><input type="checkbox" name="createProfile" checked> Team-Profil anlegen</label>
        <label class="check span-2"><input type="checkbox" name="visible" checked> Sofort auf der Website anzeigen</label>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Einstellen</span></button><button type="button" class="btn-ghost btn-md" data-action="app-back" data-id="${a.id}">Zurück</button></div>
      </form>`);
}

function positionModal(p) {
  const v = p || { active: true };
  openModal(`
      <h2 class="modal-title">${p ? 'Stelle bearbeiten' : 'Neue Stelle ausschreiben'}</h2>
      <p class="modal-sub">Erscheint sofort auf der Karriereseite.</p>
      <form data-form="position" data-id="${p ? p.id : ''}" class="form-grid">
        <div><label class="label">Titel</label><input name="title" class="field" required minlength="2" maxlength="100" value="${esc(v.title || '')}" placeholder="z. B. Associate / Rechtsanwalt (m/w/d)" autofocus></div>
        <div><label class="label">Aufgaben</label><textarea name="description" rows="4" maxlength="1500" class="field">${esc(v.description || '')}</textarea></div>
        <div><label class="label">Anforderungen</label><textarea name="requirements" rows="3" maxlength="1500" class="field">${esc(v.requirements || '')}</textarea></div>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Ausgeschrieben (auf der Karriereseite sichtbar)</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
}

/* ---------------------------------------------------------------- Aktivitätsprotokoll */
function auditTable() {
  if (!st.audit.length) return empty(st.auditQuery ? 'Keine Einträge gefunden.' : 'Noch keine Einträge.', 'list');
  return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Details</th></tr></thead>
      <tbody>${st.audit
      .map(
        (e) => `<tr>
          <td class="td-main text-xs text-dim nowrap">${esc(fmtDate(e.createdAt))}</td>
          <td data-label="Wer" class="font-medium">${esc(e.userName)}</td>
          <td data-label="Aktion">${esc(e.action)}</td>
          <td data-label="Details" class="text-sm text-muted" style="word-break:break-word">${esc(e.details || '—')}</td></tr>`
      )
      .join('')}</tbody></table></div>
      ${st.auditHasMore ? '<div class="text-center pt-4"><button class="btn-outline btn-md" data-action="audit-more">Ältere Einträge laden</button></div>' : ''}`;
}
async function loadAudit(append = false) {
  const params = new URLSearchParams();
  if (st.auditQuery) params.set('q', st.auditQuery);
  if (append && st.audit.length) params.set('before', st.audit[st.audit.length - 1].id);
  const r = await api.get('/api/admin/audit?' + params);
  st.audit = append ? st.audit.concat(r.entries) : r.entries;
  st.auditHasMore = r.hasMore;
}
views.audit = {
  async load() {
    await loadAudit();
  },
  render() {
    return `
        <div class="page-head"><div><h1 class="page-title">Aktivitätsprotokoll</h1><p class="page-sub">Wer hat wann was geändert – Akten, Rechnungen, Konten, Team, Bewerbungen und Anmeldungen.</p></div></div>
        <div class="toolbar"><label class="search">${icon('search')}<input id="auditSearch" class="field" type="search" placeholder="Name, Aktion oder Details …" value="${esc(st.auditQuery)}" aria-label="Protokoll durchsuchen"></label></div>
        <div id="auditList" class="panel p-2 md:p-3">${auditTable()}</div>`;
  },
};

/* ---------------------------------------------------------------- Bild-Uploads */
async function handleUpload(input) {
  const files = [...(input.files || [])];
  const kind = input.dataset.upload;
  input.value = '';
  if (!files.length) return;

  if (kind === 'backup') {
    // Sicherung (Datenbank oder Bilder-Archiv) unverändert als Binärdaten hochladen
    toast('Sicherung wird hochgeladen …');
    const res = await api.upload('/api/admin/backups/upload', new Blob([files[0]], { type: 'application/octet-stream' }));
    const r = res.result;
    st.backups = res;
    toast(
      r.kind === 'datenbank'
        ? 'Datenbank-Sicherung vorgemerkt – sie wird beim nächsten Neustart eingespielt.'
        : `Bilder eingespielt: ${r.added} neu, ${r.existing} schon vorhanden${r.skipped ? `, ${r.skipped} übersprungen` : ''}.`
    );
    renderView();
    return;
  }

  if (kind === 'avatar') {
    const blob = await resizeImage(files[0], { max: 512, square: true });
    const res = await api.upload('/api/auth/avatar', blob);
    st.user = res.user;
    renderUser();
    if (st.view === 'profile') renderView();
    toast('Profilbild aktualisiert.');
  } else if (kind === 'team') {
    const id = Number(input.dataset.id);
    const blob = await resizeImage(files[0], { max: 640, square: true });
    const res = await api.upload(`/api/admin/team/${id}/photo`, blob);
    const m = res.member;
    const photo = $('#tmPhoto');
    if (photo) photo.innerHTML = avatarImg(m.photoUrl, m.name);
    const ctl = $('#tmPhotoCtl');
    if (ctl) ctl.innerHTML = teamPhotoControls(m);
    toast('Foto gespeichert – live auf der Website.');
    await refreshBehind();
  } else if (kind === 'fn-pending') {
    addPendingImages({ blobs: files });
  } else if (kind === 'fivenet-img') {
    const caseId = Number(input.dataset.caseId);
    const d = st.caseDocs.find((x) => x.id === Number(input.dataset.docId));
    if (!d) return;
    st.fnPending = { urls: [], blobs: files.slice(0, FN_MAX_IMAGES) };
    reportImport(await importPendingImages(caseId, d));
    await reloadCase(caseId);
  } else if (kind === 'evidence') {
    const caseId = Number(input.dataset.caseId);
    const caption = ($('#attCaption')?.value || '').trim();
    const internal = $('#attInternal')?.checked ? '1' : '0';
    const batch = files.slice(0, 10);
    if (files.length > 10) toast('Es werden maximal 10 Bilder auf einmal hochgeladen.', 'error');
    toast(batch.length === 1 ? 'Bild wird hochgeladen …' : `${batch.length} Bilder werden hochgeladen …`);
    for (const f of batch) {
      const blob = await resizeImage(f, { max: 1600 });
      await api.upload(`/api/cases/${caseId}/attachments?caption=${encodeURIComponent(caption)}&internal=${internal}`, blob);
    }
    toast(batch.length === 1 ? 'Anhang gespeichert.' : `${batch.length} Anhänge gespeichert.`);
    await reloadCase(caseId);
  }
}
