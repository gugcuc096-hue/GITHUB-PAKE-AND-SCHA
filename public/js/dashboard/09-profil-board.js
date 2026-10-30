/*
 * Kanzlei-Dashboard – Teil 9 von 14 (erste Hälfte): Profil, VIP & Lifetime, Namensänderungen, Mandantenstimmen, Anliegen,
 * Dienstzeiten, Personal, Einarbeitung. Die zweite Hälfte steht in 09-verwaltung.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Profil */
/** Animationen je Gerät (api.js: PS.motion) – „Wie System“ folgt „Bewegung reduzieren“ (z. B. Windows). */
function motionPanel() {
  const pref = window.PS.motion.get();
  const opt = (v, label) => `<button type="button" class="chip ${pref === v ? 'active' : ''}" data-action="motion-set" data-value="${v}" aria-pressed="${pref === v}">${label}</button>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('eye')} Animationen</h2>${window.PS.motion.calm() ? badge('gedämpft', 'amber') : badge('an', 'emerald')}</div>
      <p class="text-sm text-muted">Übergänge, hochzählende Zahlen, aufklappende Akten und die Unterschrift, die sich schreibt – auf diesem Gerät für die ganze Website.${
        window.PS.motion.systemCalm() ? ' Ihr System ist auf <strong>„Bewegung reduzieren“</strong> gestellt (Windows: Einstellungen → Barrierefreiheit → Visuelle Effekte → Animationseffekte) – bei „Wie System“ sind die Animationen deshalb gedämpft.' : ''
      }</p>
      <div class="chip-row mt-3">${opt('auto', 'Wie System')}${opt('on', 'Immer an')}${opt('off', 'Aus')}</div>
      ${window.PS.season ? `<label class="check mt-4"><input type="checkbox" data-season-toggle ${window.PS.season.isOff() ? '' : 'checked'}> Saison-Deko auf diesem Gerät zeigen <span class="text-dim">(Schnee, Halloween, Feuerwerk …)</span></label>` : ''}
    </section>`;
}

/**
 * Zwei-Faktor-Anmeldung: Beim Login kommt zusätzlich ein Code per Discord-DM. Für das Board Pflicht, sonst wählbar;
 * ohne Bot oder ohne verknüpftes Discord nicht möglich (dann steht hier, was fehlt).
 */
function twoFactorPanel(tf) {
  if (!tf || (!tf.botReady && !tf.mandatory && !tf.switchedOff)) return ''; // ohne Kanzlei-Bot für Mandanten kein Thema
  const head = `<div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('shield')} Zwei-Faktor-Anmeldung</h2>${tf.on ? badge('Aktiv', 'emerald') : badge('Aus', 'slate')}</div>`;
  const devices = tf.trustedDevices
    ? `<div class="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm"><span class="text-muted">${tf.trustedDevices === 1 ? 'Ein vertrautes Gerät braucht' : `${tf.trustedDevices} vertraute Geräte brauchen`} bis zu 30 Tage keinen Code.</span><button type="button" class="btn-ghost btn-sm" data-action="tf-forget">Vertraute Geräte vergessen</button></div>`
    : '';
  let body;
  if (tf.switchedOff) body = '<p class="text-sm text-muted">Gerade per Notschalter ausgeschaltet (Render-Variable <code>TWO_FACTOR_OFF</code>). Bitte die Variable wieder entfernen, sobald Discord wieder läuft.</p>';
  else if (!tf.botReady) body = '<p class="text-sm text-muted">Der Kanzlei-Bot ist noch nicht eingerichtet – ohne ihn kann kein Code verschickt werden. Bis dahin gilt nur das Passwort.</p>';
  else if (!tf.hasDiscord)
    body = `<p class="text-sm text-muted">Beim Login kommt zusätzlich ein 6-stelliger Code als Discord-Direktnachricht – ein geklautes Passwort allein reicht dann nicht mehr. ${tf.mandatory ? '<strong class="text-amber-300">Für das Board of Partners Pflicht:</strong> ' : ''}Bitte zuerst unten Discord verbinden.</p>`;
  else if (tf.mandatory) body = '<p class="text-sm text-muted">Beim Login kommt nach dem Passwort ein 6-stelliger Code als Discord-Direktnachricht. Für das Board of Partners ist das Pflicht.</p>';
  else
    body = `<p class="text-sm text-muted">Beim Login kommt nach dem Passwort ein 6-stelliger Code als Discord-Direktnachricht – ein geklautes Passwort allein reicht dann nicht mehr.</p>
      <div class="form-actions mt-3">${tf.on ? '<button type="button" class="btn-outline btn-md" data-action="tf-off">Ausschalten</button>' : `<button type="button" class="btn-gold btn-md" data-action="tf-on">${icon('shield', 'ico-sm')}<span>Einschalten</span></button>`}</div>`;
  return `<section class="panel panel-pad" id="secTwoFactor">${head}${body}${devices}</section>`;
}

/** Offline-Modus (nur dieses Gerät): freiwillig, Daten bleiben im Browser dieses Geräts und werden beim Abmelden gelöscht. */
function offlinePanel() {
  const o = window.PS.offline;
  if (!o) return '';
  const on = o.enabled();
  const s = st.offlineStats || { entries: 0, queued: 0, oldest: null };
  return `<section class="panel panel-pad" id="offlinePanel">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('download')} Offline-Modus (dieses Gerät)</h2>${on ? badge('An', 'emerald') : badge('Aus', 'slate')}</div>
      <p class="text-sm text-muted">Bei schlechtem Empfang weiterarbeiten: Zuletzt gesehene Akten, Aufgaben, Termine und Rechnungen bleiben auf diesem Gerät lesbar. Eine interne Notiz in der Akte und das Abhaken einer Aufgabe werden gesendet, sobald die Verbindung wieder da ist. Die Daten liegen unverschlüsselt im Browser – nur auf eigenen Geräten einschalten. Beim Abmelden werden sie gelöscht.</p>
      ${on ? `<p class="text-xs text-dim mt-2">Im Zwischenspeicher: ${s.entries} ${s.entries === 1 ? 'Ansicht' : 'Ansichten'}${s.oldest ? ` (ältester Stand ${esc(fmtDate(new Date(s.oldest).toISOString()))})` : ''} · ${s.queued} ${s.queued === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf die Verbindung</p>` : ''}
      <div class="form-actions mt-3"><button type="button" class="${on ? 'btn-outline' : 'btn-gold'} btn-md" data-action="offline-toggle" data-on="${on ? '0' : '1'}">${icon(on ? 'x' : 'check', 'ico-sm')}<span>${on ? 'Offline-Modus ausschalten' : 'Offline-Modus einschalten'}</span></button>
        ${on ? `<button type="button" class="btn-ghost btn-md" data-action="offline-clear">${icon('trash', 'ico-sm')}<span>Zwischenspeicher leeren</span></button>` : ''}</div>
    </section>`;
}

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
    st.offlineStats = window.PS.offline ? await window.PS.offline.stats() : null;
    st.twoFactor = me.twoFactor;
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
        : `<p class="text-sm text-muted">Das Board of Partners hat die Discord-Anmeldung noch nicht eingerichtet.${isAdmin() ? ' <a href="/dashboard?tab=bot&amp;modul=login#settings" class="text-gold underline">Einstellungen → Discord → Discord-Login</a> zeigt, was fehlt.' : ''}</p>`;
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
            ${u.viaDiscord ? '<p class="form-hint">Ihr Konto wurde mit Discord angelegt – Sie melden sich mit „Mit Discord anmelden“ an und brauchen kein Passwort. Möchten Sie sich auch mit E-Mail und Passwort anmelden, schreiben Sie auf dem Kanzlei-Discord <strong>/passwort</strong>: Der Bot schickt Ihnen ein Passwort per Direktnachricht, das Sie hier ändern können.</p>' : ''}
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
          ${motionPanel()}
          ${offlinePanel()}
          ${twoFactorPanel(st.twoFactor)}
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

/** Board of Partners: Namen einer Person (Mandant oder Mitarbeiter) direkt ändern – ohne Antrag. */
function nameDirectModal({ userId, name, email, role = 'mandant', rank = '', returnCase }) {
  const staff = role !== 'mandant';
  const who = staff ? `${role === 'admin' ? 'Board of Partners' : 'Mitarbeiter'}${rank ? ` · ${rank}` : ''}` : 'Mandanten-Konto';
  openModal(`
      <h2 class="modal-title">Name ändern</h2>
      <p class="modal-sub">${esc(who)} <strong>${esc(name)}</strong>${email ? ` · ${esc(email)}` : ''}. Der neue Name gilt sofort überall (Konto, Akten${staff ? ', Team-Profil der Website' : ''}); die Person bekommt eine Nachricht per Discord (falls verknüpft). Die Änderung steht im Protokoll.</p>
      <form data-form="name-direct" data-user-id="${Number(userId)}" ${returnCase ? `data-return-case="${Number(returnCase)}"` : ''} class="form-grid">
        <div><label class="label" for="ndName">Neuer Name</label><input id="ndName" name="newName" class="field" required minlength="2" maxlength="80" value="${esc(name)}" autofocus></div>
        <div><label class="label" for="ndReason">Grund <span class="text-dim font-normal normal-case tracking-normal">(optional)</span></label><input id="ndReason" name="reason" class="field" maxlength="500" placeholder="${staff ? 'z. B. neuer Charaktername, Tippfehler' : 'z. B. Groß-/Kleinschreibung'}"></div>
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
        <div class="meta">Gezahlt ${money(m.pricePaid)} · ${nWord(m.usage.invoices, 'Rechnung', 'Rechnungen')} · Wert der Leistungen ${money(m.usage.workValue)} · abgedeckt ${money(m.usage.covered)}${over ? ` ${badge('Arbeit übersteigt Preis', 'amber')}` : ''}</div>
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
        ${r.invoice ? `<div class="meta">Rechnung <a class="text-gold underline" href="/rechnung?id=${r.invoice.id}" target="_blank" rel="noopener">${esc(r.invoice.number)}</a> · ${esc(r.invoice.status)}</div>` : ''}
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
      history.replaceState(history.state, '', '/dashboard' + location.hash);
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
        : `<div class="banner banner-gold items-center justify-between flex-wrap"><div><strong>Angenommen: ${esc(running.tierName)}</strong> – bitte die Rechnung ${running.invoice ? `<strong>${esc(running.invoice.number)}</strong> ` : ''}über <strong>${money(running.price)}</strong> im Spiel bezahlen. Danach wird Ihre Mitgliedschaft automatisch freigeschaltet.${running.decisionNote ? `<div class="text-xs mt-1">${esc(running.decisionNote)}</div>` : ''}</div>${running.invoice ? `<a class="btn-outline btn-sm" href="/rechnung?id=${running.invoice.id}" target="_blank" rel="noopener">${icon('receipt', 'ico-sm')}<span>Rechnung</span></a>` : ''}</div>`
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
          <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('edit')} Namen direkt ändern</h2></div>
          <p class="text-sm text-muted mb-3">Ohne Antrag – für Mandanten und Mitarbeiter, z. B. bei Groß-/Kleinschreibung, Tippfehlern oder einem neuen Charakternamen. Die Person wird per Discord benachrichtigt (falls verknüpft), die Änderung steht im Protokoll. Ihren eigenen Namen ändern Sie unter „Mein Profil“.</p>
          <input id="nameAccSearch" class="field" type="search" maxlength="80" placeholder="Person suchen (Name oder E-Mail) …" value="${esc(st.nameAccQ || '')}" autocomplete="off" aria-label="Konto suchen">
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

/** Suchergebnis „Namen direkt ändern“ (Mandanten und Mitarbeiter). */
function nameAccList() {
  const q = (st.nameAccQ || '').trim();
  if (q.length < 2) return '<p class="text-sm text-dim">Mindestens zwei Zeichen eingeben.</p>';
  const list = st.nameAccounts || [];
  if (!list.length) return '<p class="text-sm text-dim">Kein Konto gefunden.</p>';
  return list
    .map(
      (a) => `<div class="list-row wrap"><div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(a.name)}${a.role === 'mandant' ? '' : badge(a.rank || a.roleLabel, a.role === 'admin' ? 'gold' : 'sky')}${a.self ? badge('Sie', 'gold') : ''}</div><div class="meta">${esc(a.email)}${a.createdAt ? ` · registriert ${esc(fmtDateOnly(String(a.createdAt).slice(0, 10)))}` : ''}</div></div>
          ${
            a.self
              ? '<a href="#profile" class="btn-ghost btn-sm shrink-0">Unter „Mein Profil“</a>'
              : `<button type="button" class="btn-outline btn-sm shrink-0" ${nameDirectAttrs(a)}>${icon('edit', 'ico-sm')}<span>Name ändern</span></button>`
          }</div>`
    )
    .join('');
}
/** Daten-Attribute für den Knopf „Name ändern“ (Aktion name-direct). */
const nameDirectAttrs = (u) =>
  `data-action="name-direct" data-user-id="${Number(u.id)}" data-name="${esc(u.name)}" data-email="${esc(u.email || '')}" data-role="${esc(u.role || 'mandant')}" data-rank="${esc(u.rank || '')}"`;
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
    return empty(d.concerns.length ? 'Keine Anliegen für diese Auswahl.' : all ? 'Noch keine Anliegen eingegangen.' : 'Sie haben noch kein Anliegen eingereicht.', 'chat', d.concerns.length || all ? '' : nextStep('Anliegen einreichen', 'concern-new'));
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
  // Board: eingegangene und eigene Anliegen unter einem Menüpunkt – umschalten per Reiter
  const tabs = concernsMerged()
    ? `<div class="chip-row settings-tabs mb-4" role="tablist" aria-label="Anliegen">${[
        ['concerns-board', 'Eingang', st.concernOpen],
        ['concerns', 'Meine Anliegen', st.concernUnseen],
      ]
        .map(([k, l, n]) => `<a href="#${k}" class="chip ${st.view === k ? 'active' : ''}" role="tab" aria-selected="${st.view === k}">${icon(k === 'concerns' ? 'user' : 'chat', 'ico-sm')}<span>${l}</span>${n ? ` <span class="chip-count">${n}</span>` : ''}</a>`)
        .join('')}</div>`
    : '';
  return `
      <div class="page-head">
        <div><h1 class="page-title">${all ? 'Eingegangene Anliegen' : concernsMerged() ? 'Meine Anliegen' : 'Anliegen an das Board of Partners'}</h1><p class="page-sub">${esc(sub)}</p></div>
        <div class="page-actions"><button class="${all ? 'btn-outline' : 'btn-gold'} btn-md" data-action="concern-new">${icon('plus')}<span>Neues Anliegen</span></button></div>
      </div>
      ${tabs}
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
      <p class="modal-sub">${staff ? 'Für Führungsthemen: Personal, Konflikte, Vorschläge, Abläufe, Vergütung …' : 'Zur Betreuung Ihres Mandats, einer Rechnung, als Beschwerde oder Lob – direkt an die Kanzleileitung.'} Einsehen kann es nur das Board of Partners; die Antwort finden Sie unter ${concernsMerged() ? '„Anliegen“ → „Meine Anliegen“' : '„Anliegen ans Board“'}.</p>
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
      if (st.view === view) renderView(); // hinter dem offenen Fenster erst beim Schließen zeichnen
    }
  }
  if (d.concern.mine) load.concernCount().then(renderNav).catch(() => {});
}

/* ---------------------------------------------------------------- Beförderungen & Einstellungen */
const PERSONNEL_TYPE = { einstellung: ['Einstellung', 'sky'], befoerderung: ['Beförderung', 'gold'], rueckstufung: ['Degradierung', 'amber'], rangaenderung: ['Rangänderung', 'slate'], kuendigung: ['Kündigung', 'red'] };

function personnelItem(e) {
  const p = st.personnel;
  const text =
    e.type === 'einstellung'
      ? `ist neu im Team${e.newRank ? ` als <strong class="text-gold">${esc(e.newRank)}</strong>` : ''}`
      : e.type === 'befoerderung'
        ? `wurde befördert: ${esc(e.oldRank || 'ohne Rang')} → <strong class="text-gold">${esc(e.newRank)}</strong>`
        : e.type === 'rueckstufung'
          ? `wurde degradiert: ${esc(e.oldRank || 'ohne Rang')} → <strong>${esc(e.newRank || 'ohne Rang')}</strong>`
          : e.type === 'kuendigung'
            ? `wurde gekündigt${e.oldRank ? ` (zuletzt <strong>${esc(e.oldRank)}</strong>)` : ''}`
            : `Rang geändert: ${esc(e.oldRank || 'ohne Rang')} → <strong>${esc(e.newRank || 'ohne Rang')}</strong>`;
  return `<div class="list-row wrap pers-row">
      <span class="avatar">${avatarImg(e.avatarUrl, e.name)}</span>
      <div class="main"><div class="title"><span class="font-medium">${esc(e.name)}</span> <span class="text-muted">${text}</span></div>
        <div class="meta">${esc(fmtDate(e.createdAt))} · ${e.type === 'einstellung' ? 'eingestellt' : e.type === 'befoerderung' ? 'befördert' : e.type === 'rueckstufung' ? 'degradiert' : e.type === 'kuendigung' ? 'gekündigt' : 'geändert'} von ${esc(e.byName)}</div>
        ${e.note ? `<div class="pers-note">${esc(e.note)}</div>` : ''}</div>
      <div class="flex items-center gap-2 shrink-0">${statusBadge(PERSONNEL_TYPE, e.type)}${p.canDelete ? `<button class="icon-btn sm" data-action="personnel-delete" data-id="${e.id}" aria-label="Eintrag entfernen">${icon('trash', 'ico-sm')}</button>` : ''}</div></div>`;
}

views.personnel = {
  async load() {
    [st.personnel, st.onboarding] = await Promise.all([api.get('/api/personnel'), api.get('/api/onboarding').catch(() => null)]);
    st.personnelNew = 0;
  },
  render() {
    const p = st.personnel;
    const since = Date.now() - 30 * 864e5;
    const recent = p.events.filter((e) => (parseDate(e.createdAt) || 0) >= since);
    const n = (t) => recent.filter((e) => e.type === t).length;
    return `
        <div class="page-head">
          <div><h1 class="page-title">Personalprotokoll</h1><p class="page-sub">Wer neu im Team ist, befördert, degradiert oder gekündigt wurde – für alle Mitarbeiter sichtbar. Das ändern kann nur das Board of Partners.</p></div>
          ${p.board ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="personnel-promote">${icon('star')}<span>Befördern</span></button><button class="btn-outline btn-md" data-action="personnel-demote"><span>Degradieren</span></button><button class="btn-danger btn-md" data-action="personnel-terminate"><span>Kündigen</span></button></div>` : ''}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div class="panel kpi"><div class="kpi-label">${icon('star', 'ico-sm')}Beförderungen</div><div class="kpi-value">${n('befoerderung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('userAdd', 'ico-sm')}Einstellungen</div><div class="kpi-value">${n('einstellung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
          <div class="panel kpi"><div class="kpi-label">Degradierungen</div><div class="kpi-value">${n('rueckstufung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
          <div class="panel kpi"><div class="kpi-label">Kündigungen</div><div class="kpi-value">${n('kuendigung')}</div><div class="kpi-sub">in den letzten 30 Tagen</div></div>
        </div>
        ${onboardingPanel()}
        <div class="panel p-2 md:p-3">${p.events.length ? p.events.map(personnelItem).join('') : empty('Noch keine Einträge. Einstellungen und Beförderungen erscheinen hier automatisch.', 'star')}</div>`;
  },
};

/* ---------------------------------------------------------------- Einarbeitung */
async function refreshOnboarding() {
  st.onboarding = await api.get('/api/onboarding');
  renderView();
}

/** Einarbeitung neuer Anwälte: Checkliste mit Fortschritt, Mentor aus dem Board. */
function onboardingPanel() {
  const o = st.onboarding;
  if (!o || (!o.list.length && !o.board)) return '';
  const person = (e) => {
    const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
    const mentor = o.board
      ? `<select class="field field-sm" data-change="onboarding-mentor" data-user="${e.userId}" aria-label="Mentor von ${esc(e.name)}"><option value="">Kein Mentor</option>${o.mentors
          .map((m) => `<option value="${m.id}" ${e.mentor && e.mentor.id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`)
          .join('')}</select>`
      : `<span class="text-sm text-muted">Mentor: ${esc(e.mentor ? e.mentor.name : '—')}</span>`;
    return `<div class="ev-item">
        <div class="ev-top"><span class="ev-name">${esc(e.name)}</span>${e.rank ? `<span class="text-xs text-dim">${esc(e.rank)}</span>` : ''}
          ${e.doneAt ? badge('Fertig', 'emerald') : `<span class="text-xs text-dim">${e.done} von ${e.total}</span>`}
          <span class="ml-auto flex items-center gap-2">${mentor}${o.board ? `<button type="button" class="icon-btn sm" data-action="onboarding-end" data-user="${e.userId}" data-name="${esc(e.name)}" aria-label="Einarbeitung beenden" title="Einarbeitung beenden">${icon('x', 'ico-sm')}</button>` : ''}</span></div>
        <div class="ob-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Fortschritt"><span style="width:${pct}%"></span></div>
        <div class="ob-items">${e.items
          .map(
            (i) => `<label class="check" ${i.doneAt ? `title="Erledigt – ${esc(i.doneBy)}"` : ''}><input type="checkbox" data-change="onboarding-tick" data-id="${i.id}" ${i.doneAt ? 'checked' : ''}> <span>${esc(i.label)}</span></label>`
          )
          .join('')}</div>
        ${o.board ? `<form data-form="onboarding-item" data-user="${e.userId}" class="flex gap-2 mt-2"><input name="label" class="field field-sm" maxlength="160" minlength="2" required placeholder="Weiteren Punkt hinzufügen" aria-label="Weiteren Punkt für ${esc(e.name)}"><button type="submit" class="btn-outline btn-sm">${icon('plus', 'ico-sm')}<span>Hinzufügen</span></button></form>` : ''}
      </div>`;
  };
  return `
        <section class="panel panel-pad mb-4">
          <div class="panel-head"><h2 class="panel-title">Einarbeitung</h2>${
            o.board && o.candidates.length
              ? `<div class="flex gap-2"><select id="obCandidate" class="field field-sm" aria-label="Mitarbeiter für die Einarbeitung">${o.candidates
                  .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
                  .join('')}</select><button type="button" class="btn-outline btn-sm" data-action="onboarding-start">${icon('plus', 'ico-sm')}<span>Beginnen</span></button></div>`
              : ''
          }</div>
          ${o.list.length ? `<div class="ev-list">${o.list.map(person).join('')}</div>` : '<p class="text-sm text-dim">Gerade wird niemand eingearbeitet. Neue Anwälte bekommen die Checkliste automatisch.</p>'}
        </section>`;
}

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
/** Degradieren: Teammitglied wählen, niedrigeren Rang wählen. */
function demoteModal() {
  const p = st.personnel;
  const people = (p.staff || []).filter((s) => s.editable && s.rank);
  if (!people.length) return toast('Es gibt niemanden, den Sie degradieren können.', 'error');
  openModal(`
      <h2 class="modal-title">Degradieren</h2>
      <p class="modal-sub">Neuer, niedrigerer Rang für ein Teammitglied. Das Team-Profil auf der Website folgt, die Degradierung steht im Personalprotokoll (für alle Mitarbeiter sichtbar) und – falls eingerichtet – im Discord.</p>
      <form data-form="personnel-demote" class="form-grid">
        <div><label class="label" for="prUser">Teammitglied</label><select id="prUser" name="userId" class="field" required><option value="" disabled selected>Bitte wählen …</option>${people.map((s) => opt(s.id, `${s.name} · ${s.rank}`)).join('')}</select></div>
        <div><label class="label" for="prRank">Neuer Rang</label>${promoteRankSelect(p.maxRank)}</div>
        <div id="prPreview" class="text-sm text-dim" aria-live="polite"></div>
        <div><label class="label" for="prNote">Begründung <span class="text-dim font-normal normal-case tracking-normal">(optional, für alle Mitarbeiter sichtbar)</span></label><textarea id="prNote" name="note" rows="3" maxlength="500" class="field"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md"><span id="prSubmit">Degradieren</span></button></div>
      </form>`);
}
/** Kündigen: Person wählen, Hinweis auf offene Akten, bewusst bestätigen. */
function terminateModal() {
  const p = st.personnel;
  const people = (p.staff || []).filter((s) => s.terminable);
  if (!people.length) return toast('Es gibt niemanden, dem Sie kündigen können.', 'error');
  openModal(`
      <h2 class="modal-title">Kündigen</h2>
      <p class="modal-sub">Das Konto wird gesperrt (Anmeldung und Sitzungen enden), das Team-Profil verschwindet von der Website, Discord-Rollen werden entzogen. Die Kündigung steht im Personalprotokoll. Akten bleiben bestehen und sind neu zu vergeben.</p>
      <form data-form="personnel-terminate" class="form-grid">
        <div><label class="label" for="tmUser">Teammitglied</label><select id="tmUser" name="userId" class="field" required><option value="" disabled selected>Bitte wählen …</option>${people.map((s) => opt(s.id, `${s.name} · ${s.rank || 'ohne Rang'}`)).join('')}</select></div>
        <div id="tmCases" class="text-sm" aria-live="polite"></div>
        <div><label class="label" for="tmNote">Begründung <span class="text-dim font-normal normal-case tracking-normal">(optional, für alle Mitarbeiter sichtbar)</span></label><textarea id="tmNote" name="note" rows="3" maxlength="500" class="field"></textarea></div>
        <label class="check"><input type="checkbox" name="sure" required> Ich bin sicher: Diese Person verliert sofort den Zugang.</label>
        <div class="form-actions"><button type="submit" class="btn-danger btn-md"><span>Kündigen</span></button></div>
      </form>`);
}
function updateTerminateInfo() {
  const u = st.personnel?.staff?.find((s) => s.id === Number($('#tmUser')?.value));
  const box = $('#tmCases');
  if (!box) return;
  box.innerHTML = u && u.openCases ? `<div class="banner banner-gold mb-0">${icon('alert')}<div><strong>${u.openCases}</strong> offene ${u.openCases === 1 ? 'Akte' : 'Akten'} ${u.openCases === 1 ? 'ist' : 'sind'} auf ${esc(u.name)} eingetragen – bitte danach neu vergeben.</div></div>` : '';
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
  const demoting = !!$('form[data-form="personnel-demote"]');
  const kind = u.rank === rank ? null : a >= 0 && b > a ? 'Degradierung' : a >= 0 || b >= 0 ? 'Beförderung' : 'Rangänderung';
  const wrong = demoting && kind !== 'Degradierung';
  box.innerHTML = !kind
    ? `${esc(u.name)} hat bereits diesen Rang.`
    : wrong
      ? `<span class="text-red-300">${esc(rank)} ist nicht niedriger als ${esc(u.rank || 'der bisherige Rang')} – zum Befördern bitte „Befördern“ nutzen.</span>`
      : `${esc(u.name)}: ${esc(u.rank || 'ohne Rang')} → <strong class="text-gold">${esc(rank)}</strong> ${statusBadge(PERSONNEL_TYPE, kind === 'Degradierung' ? 'rueckstufung' : 'befoerderung')}`;
  $('#prSubmit').textContent = demoting ? 'Degradieren' : kind === 'Degradierung' ? 'Rang ändern' : 'Befördern';
}

/* ---------------------------------------------------------------- Gemeinsam (auch für Mandanten geladen)
 * Stehen hier statt in 09-verwaltung.js: die Verwaltungsteile lädt das Dashboard nur für die Kanzlei nach. */
/** Übersicht: kurze Zeile, wer heute abgemeldet ist. */
/* Hilfen für Akte und Abwesenheiten – im Kern-Paket, weil die Akte schon vor dem Kanzlei-Paket gezeichnet werden kann */
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
const dayDe = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function absenceStrip() {
  const now = (st.absences?.absences || []).filter((a) => a.state === 'aktiv');
  if (!isStaff() || !now.length) return '';
  return `<a href="#duty" class="absence-strip mb-4 lg:mb-5">${icon('calendar', 'ico-sm')}<span><strong>Heute abgemeldet:</strong> ${now
    .map((a) => `${esc(a.name)} <span class="text-dim">(bis ${esc(dayDe(a.endDate))}, ${esc(a.reasonLabel)})</span>`)
    .join(', ')}</span></a>`;
}

/** Akte: Bearbeitungszeiten (nur Board of Partners). */
function caseWorkSection(c, work) {
  if (!work || !isBoard()) return '';
  const now = Date.now();
  const opened = parseDate(c.createdAt);
  const end = work.closedAt ? parseDate(work.closedAt) : null;
  const total = opened ? (end ? end.getTime() : now) - opened.getTime() : null;
  const since = `${end ? 'Bearbeitungsdauer bis zum Abschluss' : 'Offen seit'} ${fmtDur(total)}`;
  if (!work.rows.length) return emptySection('secWork', 'Bearbeitungszeiten', `noch keine Bearbeitung erfasst · ${since}`, '', 'Nur für das Board of Partners sichtbar.');
  const rows = work.rows
        .map(
          (w) => `<div class="list-row wrap"><div class="main"><div class="title flex flex-wrap items-center gap-2">${esc(w.name)}${statusBadge(ROLE_BADGE, w.role)}</div>
              <div class="meta">${esc(fmtDate(w.startedAt))} – ${w.running ? 'heute' : esc(fmtDate(w.endedAt))}${w.endReason ? ' · ' + esc(w.endReason) : ''}${w.estimated ? ' · ≈ geschätzt' : ''}</div></div>
              <span class="font-mono text-sm shrink-0 ${w.running ? 'text-emerald-300' : 'text-gold'}">${w.estimated ? '≈ ' : ''}${esc(fmtDur(w.durationMs))}</span></div>`
        )
        .join('');
  return `<div class="section" id="secWork"><h3 class="section-title">Bearbeitungszeiten <span class="text-xs text-dim font-normal">nur Board of Partners</span></h3>
      <p class="text-sm text-muted mb-2">${end ? `Bearbeitungsdauer bis zum Abschluss: <strong>${esc(fmtDur(total))}</strong>` : `Offen seit <strong>${esc(fmtDur(total))}</strong>`}</p>
      ${rows}</div>`;
}

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
    const blob = await resizeImage(files[0], { max: 256, square: true, webp: true });
    const res = await api.upload('/api/auth/avatar', blob);
    st.user = res.user;
    renderUser();
    if (st.view === 'profile') renderView();
    toast('Profilbild aktualisiert.');
  } else if (kind === 'team') {
    const id = Number(input.dataset.id);
    const blob = await resizeImage(files[0], { max: 480, square: true });
    const res = await api.upload(`/api/admin/team/${id}/photo`, blob);
    const m = res.member;
    const photo = $('#tmPhoto');
    if (photo) photo.innerHTML = avatarImg(m.photoUrl, m.name);
    const ctl = $('#tmPhotoCtl');
    if (ctl) ctl.innerHTML = teamPhotoControls(m);
    toast('Foto gespeichert – live auf der Website.');
    await refreshBehind();
  } else if (kind === 'storage-item') {
    // Bild eines Lager-Gegenstands (Einstellungen → Lager)
    await api.upload(`/api/storage/items/${input.dataset.id}/image`, await resizeImage(files[0], { max: 480, webp: true }));
    toast('Bild gespeichert.');
    await reloadStorageAdmin();
  } else if (kind === 'fn-pending') {
    addPendingImages({ blobs: files });
  } else if (kind === 'fivenet-img') {
    const caseId = Number(input.dataset.caseId);
    const d = st.caseDocs.find((x) => x.id === Number(input.dataset.docId));
    if (!d) return;
    st.fnPending = { urls: [], blobs: files.slice(0, FN_MAX_IMAGES) };
    reportImport(await importPendingImages(caseId, d));
    await reloadCase(caseId);
  } else if (kind === 'pay-proof') {
    // Screenshot zur gemeldeten Zahlung nachreichen
    toast('Screenshot wird hochgeladen …');
    await api.upload(`/api/invoices/${input.dataset.id}/payment-proof`, await resizeImage(files[0], { max: 1600 }));
    toast('Screenshot gespeichert – die Kanzlei sieht ihn bei der Zahlungsmeldung.');
    await afterInvoiceChange(input);
  } else if (kind === 'evidence') {
    const caseId = Number(input.dataset.caseId);
    const caption = ($('#attCaption')?.value || '').trim();
    // Ohne Kästchen (erster Upload aus der leeren Zeile): bei der Kanzlei wie voreingestellt „nur intern“
    const box = $('#attInternal');
    const internal = (box ? box.checked : isStaff()) ? '1' : '0';
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
