/*
 * Kanzlei-Dashboard – Teil 8 von 12: Einstellungen: Discord-Bot und Discord-Tickets.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/* ---------------------------------------------------------------- Einstellungen: Discord-Bot (wie Sapphire, im eigenen Bot) */
const BOT_MODULES = [
  ['overview', 'Übersicht', 'home'],
  ['webhook', 'Webhook (Meldungen)', 'send'],
  ['login', 'Discord-Login', 'key'],
  ['tickets', 'Tickets', 'folder'],
  ['ranks', 'Rang-Sync', 'users'],
  ['connections', 'Role Connections', 'link'],
  ['joinroles', 'Join- & Standardrollen', 'userAdd'],
  ['welcome', 'Willkommen & Abschied', 'mail'],
  ['messages', 'Nachrichten', 'chat'],
];
const BOT_STATE = {
  verbunden: ['Verbunden', 'emerald'],
  verbindet: ['Verbindet …', 'amber'],
  getrennt: ['Getrennt – verbindet neu', 'amber'],
  fehler: ['Fehler', 'red'],
  aus: ['Aus', 'slate'],
};

async function loadBotDiscord(refresh = false) {
  try {
    st.botDiscord = await api.get('/api/bot/discord' + (refresh ? '?refresh=1' : ''));
  } catch (e) {
    st.botDiscord = { error: e.message };
  }
}
const botRoleList = () => (st.botDiscord && st.botDiscord.roles) || null;

/** Rollen-Auswahl mit Farbpunkt (Rollen aus Discord) – ohne Verbindung ein Feld für die Rollen-ID. assign: Bot muss die Rolle vergeben können. */
function roleSelect(attrs, value, { empty = '— keine Rolle —', assign = false } = {}) {
  const roles = botRoleList();
  if (!roles) return `<input ${attrs} class="field font-mono text-xs" value="${esc(value || '')}" inputmode="numeric" placeholder="Rollen-ID" autocomplete="off">`;
  const list = roles.filter((r) => !assign || !r.managed || r.id === value);
  const sel = roles.find((r) => r.id === value);
  return `<span class="role-pick"><span class="role-dot" style="background:${sel && sel.color ? sel.color : 'transparent'}"></span><select ${attrs} class="field" data-role-select>
      <option value="">${esc(empty)}</option>
      ${value && !sel ? `<option value="${esc(value)}" selected>Unbekannte Rolle (${esc(value)})</option>` : ''}
      ${list.map((r) => `<option value="${r.id}" data-color="${r.color || ''}" ${r.id === value ? 'selected' : ''}>${esc(r.name)}${assign && !r.assignable ? ' ⚠ über der Bot-Rolle' : ''}</option>`).join('')}
    </select></span>`;
}

function channelSelect(attrs, value) {
  const chans = st.botDiscord && st.botDiscord.channels;
  if (!chans) return `<input ${attrs} class="field font-mono text-xs" value="${esc(value || '')}" inputmode="numeric" placeholder="Kanal-ID" autocomplete="off">`;
  const groups = new Map();
  chans.forEach((c) => groups.set(c.category, [...(groups.get(c.category) || []), c]));
  const known = !value || chans.some((c) => c.id === value);
  return `<select ${attrs} class="field"><option value="">— Kanal wählen —</option>
      ${known ? '' : `<option value="${esc(value)}" selected>Unbekannter Kanal (${esc(value)})</option>`}
      ${[...groups.entries()]
      .map(([cat, list]) => `<optgroup label="${esc(cat || 'Ohne Kategorie')}">${list.map((c) => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}># ${esc(c.name)}</option>`).join('')}</optgroup>`)
      .join('')}</select>`;
}

/** Formularwerte mit data-k="a.b.c" in ein verschachteltes Objekt. */
function collectForm(form) {
  const out = {};
  form.querySelectorAll('[data-k]').forEach((el) => {
    const path = el.dataset.k.split('.');
    let o = out;
    path.slice(0, -1).forEach((p) => (o = o[p] = o[p] || {}));
    o[path[path.length - 1]] = el.type === 'checkbox' ? el.checked : el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
  });
  return out;
}

function botNav() {
  const b = st.bot;
  const s = st.settings || {};
  const on = {
    webhook: !!s.discordWebhookActive,
    login: !!s.discordOAuthConfigured,
    tickets: st.ticketSettings && st.ticketSettings.active,
    ranks: !!(b && b.rankSync.enabled),
    connections: !!(b && b.connections.enabled),
    joinroles: !!(b && b.joinRoles && (b.joinRoles.enabled || b.joinRoles.alwaysEnabled)),
    welcome: !!(b && b.welcome.enabled),
    messages: !!(st.botMessages && st.botMessages.templates.some((t) => t.jobs.some((j) => j.enabled))),
  };
  const cur = st.botModule || 'overview';
  return `<nav class="bot-nav" aria-label="Bot-Module">${BOT_MODULES.map(
    ([k, label, ic]) => `<button type="button" class="bot-nav-item ${cur === k ? 'active' : ''}" data-action="bot-module" data-module="${k}" ${cur === k ? 'aria-current="page"' : ''}>
        ${icon(ic, 'ico-sm')}<span>${esc(label)}</span>${k === 'overview' ? '' : `<span class="bot-dot ${on[k] ? 'on' : ''}" title="${on[k] ? 'eingeschaltet' : 'aus'}"></span>`}</button>`
  ).join('')}</nav>`;
}

function botStatusBadge(s) {
  const [label, color] = BOT_STATE[s.state] || BOT_STATE.aus;
  return badge(s.wanted || s.state !== 'aus' ? label : 'Aus (kein Modul an)', color);
}

function botOverview() {
  const s = st.bot.status;
  const d = st.botDiscord || {};
  const ok = (b) => `<span class="inline-flex shrink-0 ${b ? 'text-emerald-300' : 'text-amber-300'}">${icon(b ? 'check' : 'alert', 'ico-sm')}</span>`;
  const intentProblem = s.error && /INTENT/i.test(s.error);
  const notAssignable = (d.roles || []).filter((r) => !r.managed && !r.assignable).length;
  const scanStats = s.lastScan;
  const linked = st.bot.linked || {};
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Kanzlei-Bot</h2>${botStatusBadge(s)}</div>
      <p class="text-sm text-muted">Derselbe Bot wie bei den Tickets – zusätzlich mit dauerhafter Verbindung zu Discord für <strong>Rang-Sync</strong>, <strong>Role Connections</strong> und <strong>Willkommensnachrichten</strong>. Er verbindet sich, sobald eines dieser Module eingeschaltet ist.</p>
      ${s.error ? `<div class="banner ${s.state === 'fehler' ? 'banner-red' : 'banner-amber'} mt-3 mb-0">${icon('alert')}<div>${esc(s.error)}</div></div>` : ''}
      <div class="bot-checks mt-4">
        <div>${ok(s.tokenSet)}<div><strong>Bot-Token</strong><span class="text-muted"> – ${s.tokenSet ? 'gesetzt (DISCORD_BOT_TOKEN)' : 'fehlt: in Render unter „Environment“ DISCORD_BOT_TOKEN setzen'}</span></div></div>
        <div>${ok(!!s.guildId)}<div><strong>Discord-Server</strong><span class="text-muted"> – ${s.guildId ? esc((d.guild && d.guild.name) || s.guildId) : 'Server-ID fehlt: unter „Tickets“ eintragen'}</span></div></div>
        <div>${ok(!intentProblem && s.state === 'verbunden')}<div><strong>Verbindung &amp; „Server Members Intent“</strong><span class="text-muted"> – ${s.state === 'verbunden' ? `verbunden seit ${esc(fmtDate(s.since))}` : intentProblem ? 'Intent fehlt (siehe oben)' : 'Developer Portal → Bot → „Privileged Gateway Intents“ → „SERVER MEMBERS INTENT“ einschalten'}</span></div></div>
        <div>${ok(!d.error && !notAssignable)}<div><strong>Rollen-Reihenfolge</strong><span class="text-muted"> – ${d.error ? esc(d.error) : notAssignable ? `${notAssignable} Rolle(n) stehen über der Bot-Rolle und können nicht vergeben werden. Servereinstellungen → Rollen → Bot-Rolle nach oben ziehen.` : 'der Bot kann alle normalen Rollen vergeben'}</span></div></div>
        <div>${ok((linked.staffLinked || 0) > 0)}<div><strong>Verknüpfte Konten</strong><span class="text-muted"> – ${linked.staffLinked || 0} von ${linked.staff || 0} Mitarbeitern und ${linked.clientsLinked || 0} Mandanten haben ihr Discord verknüpft (Profil → „Discord verbinden“). Nur sie bekommen Rang-Rollen.</span></div></div>
      </div>
      <div class="form-actions mt-4">
        <button type="button" class="btn-gold btn-md" data-action="bot-scan" ${s.wanted ? '' : 'disabled'}>${icon('users', 'ico-sm')}<span>${s.scanning ? 'Abgleich läuft …' : 'Alle Mitglieder abgleichen'}</span></button>
        <button type="button" class="btn-outline btn-md" data-action="bot-reconnect" ${s.tokenSet ? '' : 'disabled'}>Neu verbinden</button>
        <button type="button" class="btn-ghost btn-md" data-action="bot-refresh-discord">Rollen &amp; Kanäle neu laden</button>
      </div>
      ${scanStats
      ? `<div class="bot-scan mt-4"><div class="text-xs uppercase tracking-wider text-dim mb-1">Letzter Abgleich</div>
          <div class="text-sm">${esc(fmtDate(scanStats.finishedAt || scanStats.startedAt))} (${esc(scanStats.trigger)}) · ${scanStats.members} Mitglieder geprüft · <strong>${scanStats.added}</strong> Rollen vergeben · <strong>${scanStats.removed}</strong> entfernt${scanStats.welcomed ? ` · ${scanStats.welcomed} begrüßt` : ''}</div>
          ${scanStats.error ? `<p class="text-sm text-red-300 mt-1">${esc(scanStats.error)}</p>` : ''}
          ${(scanStats.errors || []).length ? `<ul class="bot-errors">${scanStats.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>`
      : ''}
      ${s.errors && s.errors.length ? `<details class="edit-box mt-4"><summary>Letzte Fehler (${s.errors.length})</summary><ul class="bot-errors">${s.errors.map((e) => `<li><span class="text-dim">${esc(fmtDate(e.at))}</span> ${esc(e.message)}</li>`).join('')}</ul></details>` : ''}
      <details class="edit-box mt-4"><summary>Einrichtung (einmalig)</summary>
        <ol class="text-sm text-muted list-decimal pl-5 space-y-1 mt-2">
          <li>Discord Developer Portal → deine Anwendung → <strong>Bot</strong> → „Privileged Gateway Intents“ → <strong>SERVER MEMBERS INTENT</strong> einschalten → speichern.</li>
          <li>Discord → Servereinstellungen → Rollen: die <strong>Bot-Rolle über alle Rollen ziehen</strong>, die der Bot vergeben soll (Rang-, Gruppen- und Beitrittsrollen).</li>
          <li>Hier die Module einschalten und speichern. Der Bot verbindet sich automatisch und gleicht alle Mitglieder ab.</li>
          <li>Render: Der Bot läuft, solange der Server läuft. Schläft der Dienst (kostenloser Tarif), verpasst er in der Zeit Beitritte; Rollen werden beim nächsten Abgleich (alle 10 Minuten) nachgezogen.</li>
        </ol></details>
    </section>`;
}

function botRanks() {
  const c = st.bot.rankSync;
  const row = (label, key, value, hint = '') => `<div class="rs-row"><div><div class="rs-label">${esc(label)}</div>${hint ? `<div class="text-xs text-dim">${esc(hint)}</div>` : ''}</div>${roleSelect(`data-k="${esc(key)}" aria-label="Discord-Rolle für ${esc(label)}"`, value, { assign: true })}</div>`;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('users')} Rang-Sync: Website → Discord</h2>${c.enabled ? badge('An', 'emerald') : badge('Aus', 'slate')}</div>
      <p class="text-sm text-muted">Wer auf der Website einen Rang hat, bekommt automatisch die passende Discord-Rolle – bei Beförderung, Rückstufung, Sperre und beim Verknüpfen/Trennen von Discord sofort, sonst beim Abgleich alle 10 Minuten. Alte Rang-Rollen werden entfernt. Gilt für alle mit verknüpftem Discord.</p>
      <form data-form="bot-ranks" class="form-grid mt-3">
        <label class="check"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}> Rang-Sync einschalten</label>
        <div class="form-sub">Ränge</div>
        <div class="rs-list">${st.bot.ranks.map((r) => row(r, `ranks.${r}`, c.ranks[r] || '')).join('')}</div>
        <div class="form-sub">Gruppen</div>
        <div class="rs-list">
          ${row('Alle Mitarbeiter', 'staff', c.staff, 'alle Anwälte inkl. Board of Partners')}
          ${row('Board of Partners', 'board', c.board, 'Founding Partner, Equity Partner, Partner')}
          ${row('Associate Attorneys', 'associates', c.associates, 'Senior Associate, Associate, Junior Associate')}
          ${row('Mandanten', 'client', c.client, 'alle Mandanten-Konten mit verknüpftem Discord')}
        </div>
        <label class="check"><input type="checkbox" data-k="strict" ${c.strict ? 'checked' : ''}> Streng: diese Rollen auch Mitgliedern <em>ohne</em> verknüpftes Website-Konto entfernen (die Website ist die einzige Quelle)</label>
        <p class="form-hint">VIP- und Lifetime-Rollen stellst du bei den Stufen unter „VIP &amp; Lifetime“ ein; Kooperationsrollen werden nur gelesen. Für Rollen wie „| Pake &amp; Scha“ oder Trenner-Rollen eignen sich zusätzlich die Role Connections.</p>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-outline btn-md" data-action="bot-scan" ${st.bot.status.wanted ? '' : 'disabled'}>Alle Mitglieder jetzt abgleichen</button></div>
      </form>
    </section>`;
}

/* Role Connections – Regeln wie bei Sapphire */
function rcCondHtml(c = {}, i = 0) {
  return `<div class="rc-cond"><span class="rc-num">${i + 1}</span><span class="rc-word">Mitglied</span>
      <select class="field rc-has" aria-label="hat / hat nicht"><option value="1" ${c.has !== false ? 'selected' : ''}>hat</option><option value="0" ${c.has === false ? 'selected' : ''}>hat nicht</option></select>
      ${roleSelect('data-rc="cond" aria-label="Rolle der Bedingung"', c.roleId || '', { empty: '— Rolle wählen —' })}
      <button type="button" class="icon-btn" data-action="rc-del-cond" aria-label="Bedingung entfernen" title="Bedingung entfernen">${icon('x', 'ico-sm')}</button></div>`;
}
function rcRuleHtml(r = {}) {
  const conds = r.conditions && r.conditions.length ? r.conditions : [{}];
  const max = st.bot.limits.conditions;
  return `<div class="rc-rule" data-id="${esc(r.id || '')}">
      <div class="rc-top"><span class="rc-cap">Hauptrolle</span><button type="button" class="icon-btn fn-danger" data-action="rc-del-rule" aria-label="Regel löschen" title="Regel löschen">${icon('trash', 'ico-sm')}</button></div>
      ${roleSelect('data-rc="role" aria-label="Hauptrolle"', r.roleId || '', { empty: '— Rolle wählen —', assign: true })}
      <p class="rc-text">wird automatisch vergeben (und entfernt), wenn die folgenden Bedingungen zutreffen (bzw. nicht mehr zutreffen):</p>
      <div class="rc-bar"><span class="rc-cap">Bedingungen <span class="rc-count">${conds.length}/${max}</span></span>
        <select class="field rc-mode" data-rc="mode" aria-label="Verknüpfung"><option value="or" ${r.mode !== 'and' ? 'selected' : ''}>ODER – eine reicht</option><option value="and" ${r.mode === 'and' ? 'selected' : ''}>UND – alle müssen zutreffen</option></select></div>
      <div class="rc-conds">${conds.map((c, i) => rcCondHtml(c, i)).join('')}</div>
      <button type="button" class="rc-add" data-action="rc-add-cond" ${conds.length >= max ? 'disabled' : ''}>${icon('plus', 'ico-sm')}<span>Bedingung hinzufügen</span></button>
    </div>`;
}
function rcRenumber(rule) {
  const conds = rule.querySelectorAll('.rc-cond');
  conds.forEach((el, i) => (el.querySelector('.rc-num').textContent = i + 1));
  rule.querySelector('.rc-count').textContent = `${conds.length}/${st.bot.limits.conditions}`;
  rule.querySelector('[data-action="rc-add-cond"]').disabled = conds.length >= st.bot.limits.conditions;
}
function rcCollect(form) {
  return [...form.querySelectorAll('.rc-rule')].map((rule) => ({
    id: rule.dataset.id || undefined,
    roleId: rule.querySelector('[data-rc="role"]').value.trim(),
    mode: rule.querySelector('[data-rc="mode"]').value,
    conditions: [...rule.querySelectorAll('.rc-cond')]
      .map((c) => ({ has: c.querySelector('.rc-has').value === '1', roleId: c.querySelector('[data-rc="cond"]').value.trim() }))
      .filter((c) => c.roleId),
  }));
}

function botConnections() {
  const c = st.bot.connections;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('link')} Role Connections</h2>${c.enabled ? badge('An', 'emerald') : badge('Aus', 'slate')}</div>
      <p class="text-sm text-muted">Eine <strong>Hauptrolle</strong> wird automatisch vergeben – und wieder entfernt –, je nachdem ob ein Mitglied bestimmte Rollen hat. Beispiel: „| Pake &amp; Scha“, wenn das Mitglied <em>Founding Partner</em> ODER <em>Senior Associate</em> ODER … hat. Regeln dürfen aufeinander aufbauen; von Hand vergebene Hauptrollen werden entfernt, wenn die Bedingungen nicht zutreffen.</p>
      <form data-form="bot-connections" class="form-grid mt-3">
        <label class="check"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}> Role Connections einschalten</label>
        <div class="rc-list" id="rcList">${c.rules.map((r) => rcRuleHtml(r)).join('')}</div>
        <button type="button" class="btn-outline btn-md self-start" data-action="rc-add-rule" ${c.rules.length >= st.bot.limits.rules ? 'disabled' : ''}>${icon('plus', 'ico-sm')}<span>Regel hinzufügen</span></button>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-outline btn-md" data-action="bot-scan" ${st.bot.status.wanted ? '' : 'disabled'}>Alle Mitglieder scannen und anwenden</button></div>
      </form>
    </section>`;
}

/* Willkommen & Abschied – Editor mit Live-Vorschau */
function embedEditor(prefix, e) {
  const th = [
    ['avatar', 'Profilbild des Mitglieds'],
    ['server', 'Server-Symbol'],
    ['none', 'keins'],
  ];
  return `<div class="emb-edit">
      <label class="check"><input type="checkbox" data-k="${prefix}.enabled" data-emb-toggle ${e.enabled ? 'checked' : ''}> Embed anhängen</label>
      <div class="emb-fields" ${e.enabled ? '' : 'hidden'}>
        <div class="emb-row"><div class="grow"><label class="label">Titel</label><input data-k="${prefix}.title" class="field" maxlength="256" value="${esc(e.title)}"></div>
          <div><label class="label">Farbe</label><input type="color" data-k="${prefix}.color" class="field color-field" value="${esc(e.color || '#d4af37')}" aria-label="Farbe des Embeds"></div></div>
        <div><label class="label">Beschreibung</label><textarea data-k="${prefix}.description" class="field" rows="4" maxlength="4000">${esc(e.description)}</textarea></div>
        <div class="emb-grid"><div><label class="label">Kleines Bild (rechts)</label><select data-k="${prefix}.thumbnail" class="field">${th.map(([v, l]) => opt(v, l, e.thumbnail === v)).join('')}</select></div>
          <div><label class="label">Großes Bild (Link)</label><input data-k="${prefix}.image" class="field" maxlength="500" value="${esc(e.image)}" placeholder="https://… (z. B. Banner)"></div></div>
        <div class="emb-grid"><div><label class="label">Fußzeile</label><input data-k="${prefix}.footer" class="field" maxlength="2048" value="${esc(e.footer)}"></div>
          <label class="check self-end"><input type="checkbox" data-k="${prefix}.timestamp" ${e.timestamp ? 'checked' : ''}> Zeitstempel</label></div>
      </div></div>`;
}

function sampleVars() {
  const g = st.botDiscord && st.botDiscord.guild;
  const u = st.user;
  return {
    '{user}': '\u0001',
    '{user.name}': u.displayName,
    '{user.username}': (u.discord && u.discord.username) || 'mitglied',
    '{user.id}': (u.discord && u.discord.id) || '123456789012345678',
    '{user.avatar}': (u.discord && u.discord.avatarUrl) || u.avatarUrl || '',
    '{server}': (g && g.name) || 'Pake & Scha | Legal Consulting',
    '{membercount}': g && g.memberCount ? String(g.memberCount + 1) : '128',
    '{date}': new Date().toLocaleDateString('de-DE'),
    '{website}': location.origin,
  };
}
const fillVars = (text, vars) => String(text || '').replace(/\{(?:user(?:\.(?:name|username|id|avatar))?|server|membercount|date|website)\}/g, (m) => vars[m] ?? m);
/** Discord-Markdown für die Vorschau (Text ist escaped). */
/** Erwähnung wie in Discord: Rolle in ihrer Farbe mit Namen, Kanal mit Namen, Mitglied/@everyone als Markierung. */
function dcMention(kind, id) {
  if (kind === 'role') {
    const r = (botRoleList() || []).find((x) => x.id === id);
    const style = r && r.color ? ` style="--role:${esc(r.color)}"` : '';
    return `<span class="dc-mention role${r ? '' : ' unknown'}"${style} title="Rolle · ID ${esc(id)}">@${esc(r ? r.name : 'unbekannte Rolle')}</span>`;
  }
  if (kind === 'channel') {
    const c = ((st.botDiscord && st.botDiscord.channels) || []).find((x) => x.id === id);
    return `<span class="dc-mention" title="Kanal · ID ${esc(id)}">#${esc(c ? c.name : 'unbekannter Kanal')}</span>`;
  }
  if (kind === 'user') return `<span class="dc-mention" title="Mitglied · ID ${esc(id)}">@Mitglied</span>`;
  return `<span class="dc-mention">@${esc(kind)}</span>`;
}

/** Discord-Formatierung innerhalb einer Zeile (fett, kursiv, Code, Links, Spoiler, Erwähnungen …). Alles wird escaped. */
function dcInline(text, mentionName = '') {
  const keep = [];
  const stash = (html) => `\u0002${keep.push(html) - 1}\u0003`;
  return esc(text)
    .replace(/`([^`\n]+)`/g, (m, c) => stash(`<code>${c}</code>`))
    .replace(/&lt;@&amp;(\d{15,25})&gt;/g, (m, id) => stash(dcMention('role', id)))
    .replace(/&lt;@!?(\d{15,25})&gt;/g, (m, id) => stash(dcMention('user', id)))
    .replace(/&lt;#(\d{15,25})&gt;/g, (m, id) => stash(dcMention('channel', id)))
    .replace(/@(everyone|here)\b/g, (m, k) => stash(dcMention(k)))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash(`<span class="dc-link" title="${u}">${t}</span>`))
    .replace(/https?:\/\/[^\s<]+/g, (m) => stash(`<span class="dc-link">${m}</span>`))
    .replace(/\u0001/g, `<span class="dc-mention">@${esc(mentionName)}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="dc-spoiler">$1</span>')
    .replace(/\u0002(\d+)\u0003/g, (m, i) => keep[Number(i)]);
}

/** Zeilen: Überschriften (#, ##, ###), Kleintext (-#), Zitate (> und >>>), Aufzählungen (- , 1.). */
function dcLines(text, mentionName) {
  const lines = text.split('\n');
  const out = [];
  let list = null;
  let quote = null;
  const inl = (t) => dcInline(t, mentionName);
  const flushList = () => {
    if (list) out.push(`<${list.type} class="dc-list"${list.start ? ` start="${list.start}"` : ''}>${list.items.map((x) => `<li>${x}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote) out.push(`<div class="dc-quote">${quote.join('<br>')}</div>`);
    quote = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^>>> ?(.*)$/))) {
      flushList();
      quote = [...(quote || []), ...[m[1], ...lines.slice(i + 1)].map(inl)];
      break;
    }
    if ((m = line.match(/^> ?(.*)$/))) {
      flushList();
      (quote = quote || []).push(inl(m[1]));
      continue;
    }
    flushQuote();
    if ((m = line.match(/^(#{1,3}) +(.+)$/))) {
      flushList();
      out.push(`<div class="dc-h${m[1].length}">${inl(m[2])}</div>`);
    } else if ((m = line.match(/^-# +(.+)$/))) {
      flushList();
      out.push(`<div class="dc-sub">${inl(m[1])}</div>`);
    } else if ((m = line.match(/^\s*[-*] +(.+)$/))) {
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(inl(m[1]));
    } else if ((m = line.match(/^\s*(\d{1,3})\. +(.+)$/))) {
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [], start: m[1] === '1' ? null : m[1] };
      }
      list.items.push(inl(m[2]));
    } else {
      flushList();
      out.push(`<div class="dc-line">${line ? inl(line) : '<br>'}</div>`);
    }
  }
  flushQuote();
  flushList();
  return out.join('');
}

/** Discord-Markdown für die Vorschau (Nachrichtentext, Beschreibung, Feld-Werte) – so, wie Discord es anzeigt. */
function dcMarkdown(text, mentionName = '') {
  const parts = String(text || '').replace(/\r/g, '').split('```');
  // Unvollständiger Codeblock (``` ohne Ende) bleibt Text – wie in Discord
  if (parts.length % 2 === 0) parts[parts.length - 2] += '```' + parts.pop();
  return parts
    .map((part, i) => (i % 2 ? `<pre class="dc-codeblock">${esc(part.replace(/^[a-z0-9+#-]*\n/i, '').replace(/\n$/, ''))}</pre>` : dcLines(part.replace(/^\n|\n$/g, ''), mentionName)))
    .join('');
}

/** Kurzhilfe: Discord-Formatierung (für Nachricht, Beschreibung und Felder). */
const DC_FORMAT_HELP = [
  ['# Überschrift', 'sehr groß (am Zeilenanfang)'],
  ['## Überschrift', 'groß'],
  ['### Überschrift', 'etwas größer'],
  ['-# Text', 'klein und grau'],
  ['**fett**', 'fett'],
  ['*kursiv*', 'kursiv'],
  ['__unterstrichen__', 'unterstrichen'],
  ['~~durchgestrichen~~', 'durchgestrichen'],
  ['> Zitat', 'Zitat (>>> für alles darunter)'],
  ['- Punkt', 'Aufzählung (1. für Nummern)'],
  ['`Code`', 'Code im Text'],
  ['```Block```', 'Codeblock'],
  ['||Spoiler||', 'verdeckt bis zum Anklicken'],
  ['[Text](https://…)', 'Link mit eigenem Text'],
];
const dcFormatHelp = () => `<details class="edit-box dc-help"><summary>Formatierung (Überschriften, fett, Listen …)</summary>
    <div class="tpl-help">${DC_FORMAT_HELP.map(([code, what]) => `<code>${esc(code)}</code><span>${esc(what)}</span>`).join('')}</div>
    <p class="form-hint">Gilt für Nachricht, Beschreibung und Feld-Werte. Der Titel hat in Discord immer dieselbe Größe.</p></details>`;

function previewHtml(part, { mention = true } = {}) {
  const vars = sampleVars();
  if (!mention) vars['{user}'] = `@${st.user.displayName}`;
  const name = st.user.displayName;
  const bot = (st.botDiscord && st.botDiscord.bot) || { name: 'Pake & Scha | Legal Consulting', avatar: '/apple-touch-icon.png' };
  const content = fillVars(part.content, vars).trim();
  const e = part.embed || {};
  let embed = '';
  if (e.enabled) {
    const title = fillVars(e.title, vars).trim();
    const desc = fillVars(e.description, vars).trim();
    const image = fillVars(e.image, vars).trim();
    const footer = fillVars(e.footer, vars).trim();
    const g = st.botDiscord && st.botDiscord.guild;
    const thumb = e.thumbnail === 'avatar' ? vars['{user.avatar}'] : e.thumbnail === 'server' && g ? g.icon : '';
    if (title || desc || image || thumb) {
      embed = `<div class="dc-embed" style="border-left-color:${esc(e.color || '#d4af37')}">
          <div class="dc-embed-main">
            ${title ? `<div class="dc-title">${dcInline(title, name)}</div>` : ''}
            ${desc ? `<div class="dc-desc">${dcMarkdown(desc, name)}</div>` : ''}
            ${/^https:\/\//i.test(image) ? `<img class="dc-image" src="${esc(image)}" alt="">` : ''}
            ${footer || e.timestamp ? `<div class="dc-footer">${esc(footer)}${footer && e.timestamp ? ' • ' : ''}${e.timestamp ? 'Heute um ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}</div>` : ''}
          </div>
          ${thumb ? `<img class="dc-thumb" src="${esc(thumb)}" alt="">` : ''}</div>`;
    }
  }
  if (!content && !embed) return '<div class="dc-empty">Leer – diese Nachricht wird nicht gesendet.</div>';
  return `<div class="dc-msg"><img class="dc-avatar" src="${esc(bot.avatar)}" alt="">
      <div class="dc-body"><div class="dc-head"><span class="dc-name">${esc(bot.name)}</span><span class="dc-app">APP</span><span class="dc-time">Heute um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div>
      ${content ? `<div class="dc-content">${dcMarkdown(content, name)}</div>` : ''}${embed}</div></div>`;
}

/** Vorschau neu zeichnen (beim Tippen). */
function updateWelcomePreview(form) {
  const w = collectForm(form);
  const set = (key, part, opts) => {
    const el = form.querySelector(`[data-preview="${key}"]`);
    if (el) el.innerHTML = previewHtml(part, opts);
  };
  set('join', w);
  set('dm', w.dm, { mention: false });
  set('leave', w.leave, { mention: false });
}

function botWelcome() {
  const w = st.bot.welcome;
  const chips = Object.entries(st.bot.placeholders)
    .map(([k, l]) => `<button type="button" class="tpl-chip" data-action="wl-insert" data-text="${esc(k)}" title="${esc(l)}">${esc(k)}</button>`)
    .join('');
  const part = (key, p, { title, toggle, channel, mention = true, hint = '' }) => {
    const pre = key === 'join' ? '' : `${key}.`;
    return `<div class="wl-part">
        <div class="wl-head"><h3 class="wl-title">${esc(title)}</h3>${toggle ? `<label class="check"><input type="checkbox" data-k="${pre}enabled" ${p.enabled ? 'checked' : ''}> ${esc(toggle)}</label>` : ''}</div>
        ${hint ? `<p class="form-hint -mt-1 mb-2">${hint}</p>` : ''}
        <div class="wl-grid">
          <div class="wl-editor">
            ${channel ? `<div><label class="label">Kanal</label>${channelSelect(`data-k="${pre}channelId" aria-label="Kanal für: ${esc(title)}"`, p.channelId)}</div>` : ''}
            <div><label class="label">Nachricht</label><textarea data-k="${pre}content" class="field" rows="3" maxlength="2000" placeholder="Text über dem Embed (optional)">${esc(p.content)}</textarea></div>
            ${embedEditor(`${pre}embed`, p.embed)}
          </div>
          <div><div class="label">Vorschau</div><div class="wl-preview" data-preview="${key}">${previewHtml(p, { mention })}</div></div>
        </div>
      </div>`;
  };
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('mail')} Willkommen &amp; Abschied</h2>${w.enabled ? badge('An', 'emerald') : badge('Aus', 'slate')}</div>
      <p class="text-sm text-muted">Begrüßt neue Mitglieder automatisch – mit eigenem Text und Embed, auf Wunsch zusätzlich per Direktnachricht – und vergibt Rollen beim Beitritt. Platzhalter anklicken, um sie ins zuletzt gewählte Feld einzufügen.</p>
      <form data-form="bot-welcome" class="form-grid mt-3" id="welcomeForm">
        <label class="check"><input type="checkbox" data-k="enabled" ${w.enabled ? 'checked' : ''}> Willkommensnachrichten einschalten</label>
        <div class="tpl-chips">${chips}</div>
        ${dcFormatHelp()}
        ${part('join', w, { title: 'Willkommensnachricht', channel: true })}
        ${part('dm', w.dm, { title: 'Direktnachricht an das neue Mitglied', toggle: 'senden', mention: false, hint: 'Kommt nur an, wenn das Mitglied Direktnachrichten von Servermitgliedern erlaubt.' })}
        <div class="wl-part"><div class="wl-head"><h3 class="wl-title">Rollen beim Beitritt</h3></div>
          <p class="text-sm text-muted">Stellst du im eigenen Modul <button type="button" class="text-gold underline" data-action="bot-module" data-module="joinroles">Join Roles</button> ein – mit Rollen für Bots, Verzögerung und „erst nach Bestätigung der Serverregeln“.</p></div>
        ${part('leave', w.leave, { title: 'Abschiedsnachricht', toggle: 'senden', channel: true, mention: false, hint: 'Wenn jemand den Server verlässt. {user} erscheint hier ohne Ping.' })}
        <div class="form-actions wl-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-outline btn-md" data-action="bot-welcome-test" data-kind="join">${icon('send', 'ico-sm')}<span>Test: Willkommen</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="bot-welcome-test" data-kind="dm">Test: DM</button>
          <button type="button" class="btn-ghost btn-md" data-action="bot-welcome-test" data-kind="leave">Test: Abschied</button></div>
        <p class="form-hint">Der Test speichert zuerst und nutzt dann <strong>Sie selbst</strong> (verknüpftes Discord) als neues Mitglied.</p>
      </form>
    </section>`;
}

function botWelcomeBody(form) {
  return collectForm(form);
}

/* Join Roles – Rollen für neue Mitglieder bzw. Bots */
function roleChecklist(cls, selected) {
  const roles = botRoleList();
  if (!roles) return `<input class="field font-mono text-xs" data-ids="${cls}" value="${esc(selected.join(', '))}" placeholder="Rollen-IDs, mit Komma getrennt">`;
  return `<div class="svc-list jr-list" data-max="${st.bot.limits.joinRoles || 10}">${roles
    .filter((r) => !r.managed)
    .map(
      (r) => `<label class="svc jr-row"><input type="checkbox" class="${cls}" value="${r.id}" ${selected.includes(r.id) ? 'checked' : ''}>
          <span class="flex items-center gap-2"><span class="role-dot" style="background:${r.color || 'transparent'}"></span>${esc(r.name)}${r.assignable ? '' : ' <span class="text-amber-300 text-xs">⚠ über der Bot-Rolle</span>'}</span></label>`
    )
    .join('')}</div>`;
}
const pickedRoles = (form, cls) => {
  const ids = form.querySelector(`[data-ids="${cls}"]`);
  return ids ? ids.value.split(/[\s,;]+/).filter(Boolean) : [...form.querySelectorAll(`.${cls}:checked`)].map((b) => b.value);
};
const JOIN_DELAYS = [
  [0, 'Sofort beim Beitritt'],
  [1, 'nach 1 Minute'],
  [5, 'nach 5 Minuten'],
  [10, 'nach 10 Minuten'],
  [30, 'nach 30 Minuten'],
  [60, 'nach 1 Stunde'],
  [360, 'nach 6 Stunden'],
  [1440, 'nach 24 Stunden'],
];
function botJoinRoles() {
  const j = st.bot.joinRoles;
  const delays = JOIN_DELAYS.some(([v]) => v === j.delayMinutes) ? JOIN_DELAYS : [...JOIN_DELAYS, [j.delayMinutes, `nach ${j.delayMinutes} Minuten`]];
  const waiting = st.bot.status.joinQueue || 0;
  const max = st.bot.limits.joinRoles || 10;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('userAdd')} Join- &amp; Standardrollen</h2>${j.enabled || j.alwaysEnabled ? badge('An', 'emerald') : badge('Aus', 'slate')}</div>
      <p class="text-sm text-muted"><strong>Standardrollen</strong> hat jedes Mitglied dauerhaft – auch alle, die schon auf dem Server sind. <strong>Join Roles</strong> gibt es nur einmal beim Beitritt (z. B. eine Neuling-Rolle, die später wieder weg darf). Rang-Rollen kommen zusätzlich über den Rang-Sync; Role Connections dürfen auf beides aufbauen.</p>
      <form data-form="bot-joinroles" class="form-grid mt-3" id="joinRolesForm">
        <div class="wl-part">
          <div class="wl-head"><h3 class="wl-title">Standardrollen – hat jeder</h3><label class="check"><input type="checkbox" data-k="alwaysEnabled" ${j.alwaysEnabled ? 'checked' : ''}> einschalten</label></div>
          <p class="form-hint -mt-1 mb-2">Bisherige Mitglieder bekommen sie beim Speichern, neue beim Beitritt – und wem sie jemand wegnimmt, bekommt sie automatisch zurück. Bis zu ${max} Rollen. Abwählen heißt: wird nicht mehr erzwungen (niemandem weggenommen).</p>
          ${roleChecklist('jr-always', j.always)}
          <label class="check mt-2"><input type="checkbox" data-k="alwaysBots" ${j.alwaysBots ? 'checked' : ''}> auch für Bots</label>
        </div>
        <div class="wl-part">
          <div class="wl-head"><h3 class="wl-title">Join Roles – nur beim Beitritt</h3><label class="check"><input type="checkbox" data-k="enabled" ${j.enabled ? 'checked' : ''}> einschalten</label></div>
          <div class="form-sub">Neue Mitglieder <span class="text-dim normal-case tracking-normal">– bis zu ${max} Rollen</span></div>
          ${roleChecklist('jr-human', j.humans)}
          <div class="form-sub mt-3">Neue Bots <span class="text-dim normal-case tracking-normal">– optional</span></div>
          ${roleChecklist('jr-bot', j.bots)}
          <div class="emb-grid mt-3"><div><label class="label" for="jrDelay">Rollen vergeben</label><select id="jrDelay" data-k="delayMinutes" class="field">${delays.map(([v, l]) => opt(v, l, v === j.delayMinutes)).join('')}</select></div>
            <label class="check self-end"><input type="checkbox" data-k="waitScreening" ${j.waitScreening ? 'checked' : ''}> Erst nach Bestätigung der Serverregeln</label></div>
          <p class="form-hint mt-2">„Erst nach Bestätigung der Serverregeln“ wirkt, wenn in Discord die Regel-Abfrage für neue Mitglieder aktiv ist: Die Rollen kommen, sobald das Mitglied die Regeln akzeptiert hat. Verzögerung und Wartezeit überstehen einen Neustart; war der Bot offline, holt er Beitritte der letzten 24 Stunden nach.</p>
          ${waiting ? `<p class="text-sm text-muted mt-2">${icon('clock', 'ico-sm')} ${waiting} Beitritt(e) warten gerade auf ihre Rollen.</p>` : ''}
          <div class="form-actions mt-3"><button type="button" class="btn-outline btn-md" data-action="bot-join-apply" data-target="humans">Join Roles an alle bisherigen Mitglieder</button>
            <button type="button" class="btn-ghost btn-md" data-action="bot-join-apply" data-target="bots">… an alle Bots</button></div>
        </div>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>
    </section>`;
}
function botJoinRolesBody(form) {
  const d = collectForm(form);
  return {
    enabled: !!d.enabled,
    humans: pickedRoles(form, 'jr-human'),
    bots: pickedRoles(form, 'jr-bot'),
    delayMinutes: Number(d.delayMinutes) || 0,
    waitScreening: !!d.waitScreening,
    alwaysEnabled: !!d.alwaysEnabled,
    always: pickedRoles(form, 'jr-always'),
    alwaysBots: !!d.alwaysBots,
  };
}

/* Nachrichten – eigene Vorlagen (Text + Embed + Link-Buttons), senden, Zeitplan, alle X Nachrichten */
const MSG_DEFAULT = () => ({
  content: '',
  allowMentions: false,
  embed: { enabled: true, author: '', title: '', url: '', description: '', color: '#d4af37', thumbnail: 'server', thumbnailUrl: '', image: '', footer: 'Pake & Scha Legal Consulting', timestamp: true, fields: [] },
  buttons: [],
});
const channelName = (id) => {
  const c = st.botDiscord && st.botDiscord.channels && st.botDiscord.channels.find((x) => x.id === id);
  return c ? `#${c.name}` : `Kanal ${id}`;
};
function fmtInterval(min) {
  if (min % 1440 === 0) return min === 1440 ? 'täglich' : `alle ${min / 1440} Tage`;
  if (min % 60 === 0) return min === 60 ? 'stündlich' : `alle ${min / 60} Std.`;
  return `alle ${min} Min.`;
}
const jobLabel = (j) => (j.kind === 'zeitplan' ? `⏱ ${fmtInterval(j.intervalMinutes)}` : `📌 alle ${j.everyMessages} Nachricht${j.everyMessages === 1 ? '' : 'en'}`);

async function loadBotMessages() {
  const r = await api.get('/api/bot/messages');
  st.botMessages = r;
}

function botMessagesModule() {
  const m = st.botMessages;
  if (!m) return '<div class="panel panel-pad text-sm text-muted">Vorlagen werden geladen …</div>';
  const list = m.templates;
  return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('chat')} Nachrichten</h2>${badge(`${list.length}/${m.limits.templates}`, 'slate')}</div>
      <p class="text-sm text-muted">Eigene Nachrichten mit Embed, Bildern, Feldern und Link-Buttons gestalten, von Hand in einen Kanal schicken und später dort aktualisieren – oder automatisch posten lassen: nach <strong>Zeitplan</strong> (z. B. täglich um 18 Uhr) oder <strong>alle X Nachrichten</strong> im Kanal (optional bleibt sie immer unten).</p>
      <div class="form-actions mt-3"><button type="button" class="btn-gold btn-md" data-action="msg-new" ${list.length >= m.limits.templates ? 'disabled' : ''}>${icon('plus', 'ico-sm')}<span>Neue Vorlage</span></button></div>
      <div class="msg-list mt-4">${
      list.length
        ? list
            .map((t) => {
              const e = t.data.embed || {};
              const pings = t.data.allowMentions ? mentionsIn(t.data.content) : [];
              const pingText = pings.length ? `pingt ${pings.map((x) => (x.kind === 'role' ? `@${((botRoleList() || []).find((r) => r.id === x.id) || {}).name || 'Rolle'}` : x.kind === 'user' ? '@Mitglied' : `@${x.kind}`)).join(', ')}` : '';
              const summary = [t.data.content ? 'Text' : '', e.enabled ? `Embed${e.title ? ` „${e.title}“` : ''}` : '', (t.data.buttons || []).length ? `${t.data.buttons.length} Button(s)` : '', pingText].filter(Boolean).join(' · ');
              return `<div class="msg-card">
                  <div class="msg-main"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(t.name)}</span>${t.jobs
                  .map((j) => badge(`${jobLabel(j)} → ${channelName(j.channelId)}${j.enabled ? '' : ' (pausiert)'}`, j.enabled ? (j.lastError ? 'red' : 'emerald') : 'slate'))
                  .join('')}</div>
                    <div class="text-xs text-dim mt-1">${esc(summary || 'leer')} · geändert ${esc(fmtDate(t.updatedAt))}${t.updatedByName ? ` von ${esc(t.updatedByName)}` : ''}${t.sent.length ? ` · ${t.sent.length}× gesendet` : ''}</div></div>
                  <div class="msg-actions">
                    <button type="button" class="btn-outline btn-sm" data-action="msg-open" data-id="${t.id}" data-tab="use">${icon('send', 'ico-sm')}<span>Verwenden</span></button>
                    <button type="button" class="btn-ghost btn-sm" data-action="msg-open" data-id="${t.id}" data-tab="edit">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
                    <button type="button" class="btn-ghost btn-sm fn-danger" data-action="msg-delete" data-id="${t.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
                  </div></div>`;
            })
            .join('')
        : '<p class="text-sm text-dim">Noch keine Vorlage – „Neue Vorlage“ anlegen, z. B. eine Ankündigung, Regeln oder ein Hinweis auf die Website.</p>'
    }</div>
    </section>`;
}

/* Wer wird gepingt? Erwähnungen in Nachricht und Embed – mit Hinweis, wenn ein Ping nicht ankommt */
const MENTION_RE = /<@(&|!?)(\d{15,25})>|@(everyone|here)\b/g;
function mentionsIn(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const x = m[3] ? { kind: m[3], key: m[3] } : { kind: m[1] === '&' ? 'role' : 'user', id: m[2], key: `${m[1] === '&' ? 'r' : 'u'}${m[2]}` };
    seen.set(x.key, x);
  }
  return [...seen.values()];
}
function msgPingsHtml(d) {
  const e = d.embed || {};
  const inText = mentionsIn(d.content);
  const inEmbed = e.enabled ? mentionsIn([e.author, e.title, e.description, e.footer, ...(e.fields || []).flatMap((f) => [f.name, f.value])].join('\n')) : [];
  const onlyEmbed = inEmbed.filter((x) => !inText.some((y) => y.key === x.key));
  if (!inText.length && !onlyEmbed.length) return '';
  const roles = botRoleList();
  const role = (x) => (roles || []).find((r) => r.id === x.id);
  const chip = (x) => dcMention(x.kind, x.id);
  const lines = [];
  if (inText.length) {
    lines.push(
      d.allowMentions
        ? `<div class="msg-ping on">${icon('bell', 'ico-sm')}<span><strong>Pingt beim Senden:</strong> ${inText.map(chip).join(' ')}</span></div>`
        : `<div class="msg-ping off">${icon('bell', 'ico-sm')}<span><strong>Pingt niemanden:</strong> ${inText.map(chip).join(' ')} steht im Text, aber „Erwähnungen pingen“ ist aus.</span></div>`
    );
    if (d.allowMentions && roles) {
      const canAll = !!(st.botDiscord && st.botDiscord.botMentionAll);
      inText
        .filter((x) => x.kind === 'role' && !role(x))
        .forEach((x) => lines.push(`<div class="msg-ping warn">${icon('alert', 'ico-sm')}<span>Die Rolle mit der ID <span class="font-mono">${esc(x.id)}</span> gibt es auf dem Server nicht – bitte die Rollen-ID prüfen.</span></div>`));
      inText
        .filter((x) => x.kind === 'role' && role(x) && !role(x).mentionable && !canAll)
        .forEach((x) =>
          lines.push(`<div class="msg-ping warn">${icon('alert', 'ico-sm')}<span>${chip(x)} erscheint, wird aber <strong>nicht benachrichtigt</strong>: In Discord bei der Rolle „Allen erlauben, @Erwähnungen für diese Rolle zu verwenden“ einschalten – oder dem Bot das Recht „@everyone, @here und alle Rollen erwähnen“ geben.</span></div>`)
        );
      if (inText.some((x) => x.kind === 'everyone' || x.kind === 'here') && !canAll) {
        lines.push(`<div class="msg-ping warn">${icon('alert', 'ico-sm')}<span>Für @everyone/@here braucht der Bot das Recht „@everyone, @here und alle Rollen erwähnen“.</span></div>`);
      }
    }
  }
  if (onlyEmbed.length) {
    lines.push(`<div class="msg-ping info">${icon('eye', 'ico-sm')}<span>${onlyEmbed.map(chip).join(' ')} im Embed ${onlyEmbed.length === 1 ? 'wird' : 'werden'} nur angezeigt, nicht gepingt – für einen Ping in „Nachricht“ schreiben.</span></div>`);
  }
  return lines.join('');
}
/** Text (Platzhalter, Erwähnung) an der Schreibmarke einfügen – im zuletzt benutzten Feld, sonst in „Nachricht“. */
function insertTemplateText(inForm, text) {
  if (!inForm) return;
  const remembered = st.wlField && st.wlField.isConnected && st.wlField.closest('form') === inForm ? st.wlField : null;
  const field = remembered || inForm.querySelector('textarea[data-k="content"], textarea[data-k="data.content"]');
  if (!field) return;
  field.focus();
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
  if (inForm.id === 'msgForm') updateMsgPreview(inForm);
  else updateWelcomePreview(inForm);
}
/** Auswahl „Rolle erwähnen“: fügt <@&ID> an der Schreibmarke ein (zuletzt benutztes Feld, sonst „Nachricht“). */
function msgRoleInsert() {
  const roles = (botRoleList() || []).filter((r) => !r.managed);
  if (!roles.length) return '';
  return `<select id="msgRoleInsert" class="field msg-role-insert" aria-label="Rolle erwähnen">
      <option value="">@ Rolle erwähnen …</option>
      ${roles.map((r) => `<option value="${r.id}">@${esc(r.name)}</option>`).join('')}</select>`;
}

/* Editor */
const msgFieldRow = (f = {}) => `<div class="mf-row">
    <input class="field mf-name" maxlength="256" placeholder="Name" value="${esc(f.name || '')}" aria-label="Name des Feldes">
    <textarea class="field mf-value" rows="2" maxlength="1024" placeholder="Wert" aria-label="Wert des Feldes">${esc(f.value || '')}</textarea>
    <label class="check mf-inline"><input type="checkbox" class="mf-inl" ${f.inline ? 'checked' : ''}> nebeneinander</label>
    <button type="button" class="icon-btn sm" data-action="msg-del-row" aria-label="Feld entfernen" title="Feld entfernen">${icon('x', 'ico-sm')}</button></div>`;
const msgButtonRow = (b = {}) => `<div class="mb-row">
    <input class="field mb-label" maxlength="80" placeholder="Beschriftung, z. B. Zur Website" value="${esc(b.label || '')}" aria-label="Beschriftung des Buttons">
    <input class="field mb-url" maxlength="500" placeholder="https://…" value="${esc(b.url || '')}" aria-label="Link des Buttons">
    <button type="button" class="icon-btn sm" data-action="msg-del-row" aria-label="Button entfernen" title="Button entfernen">${icon('x', 'ico-sm')}</button></div>`;

function msgEditor(t) {
  const d = t ? t.data : MSG_DEFAULT();
  const e = { ...MSG_DEFAULT().embed, ...(d.embed || {}) };
  const chips = Object.entries(st.botMessages.placeholders)
    .map(([k, l]) => `<button type="button" class="tpl-chip" data-action="wl-insert" data-text="${esc(k)}" title="${esc(l)}">${esc(k)}</button>`)
    .join('');
  const th = [
    ['server', 'Server-Symbol'],
    ['url', 'eigenes Bild (Link)'],
    ['none', 'keins'],
  ];
  return `<form data-form="msg-save" id="msgForm" class="msg-edit" ${t ? `data-id="${t.id}"` : ''}>
      <div class="wl-grid">
        <div class="wl-editor">
          <div><label class="label" for="msgName">Name der Vorlage</label><input id="msgName" data-k="name" class="field" required minlength="2" maxlength="80" value="${esc(t ? t.name : '')}" placeholder="z. B. Ankündigung Öffnungszeiten"></div>
          <div class="tpl-chips">${chips}${msgRoleInsert()}</div>
          <div><label class="label">Nachricht</label><textarea data-k="data.content" class="field" rows="3" maxlength="2000" placeholder="Text über dem Embed (optional) – **fett**, *kursiv*, Links …">${esc(d.content || '')}</textarea></div>
          <label class="check"><input type="checkbox" data-k="data.allowMentions" ${d.allowMentions ? 'checked' : ''}> Erwähnungen pingen (@everyone, @Rolle, @Person im Text)</label>
          <div id="msgPings" class="msg-pings" aria-live="polite">${msgPingsHtml(d)}</div>
          <div class="emb-edit">
            <label class="check"><input type="checkbox" data-k="data.embed.enabled" data-emb-toggle ${e.enabled ? 'checked' : ''}> Embed anhängen</label>
            <div class="emb-fields" ${e.enabled ? '' : 'hidden'}>
              <div><label class="label">Autor (Zeile über dem Titel)</label><input data-k="data.embed.author" class="field" maxlength="256" value="${esc(e.author)}" placeholder="z. B. Pake & Scha Legal Consulting"></div>
              <div class="emb-row"><div class="grow"><label class="label">Titel</label><input data-k="data.embed.title" class="field" maxlength="256" value="${esc(e.title)}"></div>
                <div><label class="label">Farbe</label><input type="color" data-k="data.embed.color" class="field color-field" value="${esc(e.color || '#d4af37')}" aria-label="Farbe des Embeds"></div></div>
              <div><label class="label">Titel-Link (optional)</label><input data-k="data.embed.url" class="field" maxlength="500" value="${esc(e.url)}" placeholder="https://…"></div>
              <div><label class="label">Beschreibung</label><textarea data-k="data.embed.description" class="field" rows="5" maxlength="4000">${esc(e.description)}</textarea>${dcFormatHelp()}</div>
              <div class="emb-grid"><div><label class="label">Kleines Bild (rechts)</label><select data-k="data.embed.thumbnail" class="field" data-thumb-select>${th.map(([v, l]) => opt(v, l, e.thumbnail === v)).join('')}</select></div>
                <div ${e.thumbnail === 'url' ? '' : 'hidden'} data-thumb-url><label class="label">Link zum kleinen Bild</label><input data-k="data.embed.thumbnailUrl" class="field" maxlength="500" value="${esc(e.thumbnailUrl)}" placeholder="https://…"></div></div>
              <div><label class="label">Großes Bild (Link)</label><input data-k="data.embed.image" class="field" maxlength="500" value="${esc(e.image)}" placeholder="https://… (z. B. Banner)"></div>
              <div><div class="label">Felder <span class="text-dim normal-case tracking-normal">– bis zu 10</span></div><div class="mf-list" id="msgFields">${(e.fields || []).map(msgFieldRow).join('')}</div>
                <button type="button" class="rc-add mt-2" data-action="msg-add-field">${icon('plus', 'ico-sm')}<span>Feld hinzufügen</span></button></div>
              <div class="emb-grid"><div><label class="label">Fußzeile</label><input data-k="data.embed.footer" class="field" maxlength="2048" value="${esc(e.footer)}"></div>
                <label class="check self-end"><input type="checkbox" data-k="data.embed.timestamp" ${e.timestamp ? 'checked' : ''}> Zeitstempel</label></div>
            </div>
          </div>
          <div><div class="label">Link-Buttons <span class="text-dim normal-case tracking-normal">– bis zu 5, unter der Nachricht</span></div><div class="mb-list" id="msgButtons">${(d.buttons || []).map(msgButtonRow).join('')}</div>
            <button type="button" class="rc-add mt-2" data-action="msg-add-button">${icon('plus', 'ico-sm')}<span>Button hinzufügen</span></button></div>
        </div>
        <div class="msg-preview-col"><div class="label">Vorschau</div><div class="wl-preview" id="msgPreview">${msgPreviewHtml(d)}</div></div>
      </div>
      <div class="form-actions mt-4"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${t ? 'Speichern' : 'Vorlage anlegen'}</span></button>
        <button type="button" class="btn-ghost btn-md" data-action="close-modal">Schließen</button></div>
    </form>`;
}

function msgBody(form) {
  const d = collectForm(form);
  d.data.embed.fields = [...form.querySelectorAll('.mf-row')]
    .map((r) => ({ name: r.querySelector('.mf-name').value.trim(), value: r.querySelector('.mf-value').value.trim(), inline: r.querySelector('.mf-inl').checked }))
    .filter((f) => f.name || f.value);
  d.data.buttons = [...form.querySelectorAll('.mb-row')].map((r) => ({ label: r.querySelector('.mb-label').value.trim(), url: r.querySelector('.mb-url').value.trim() })).filter((b) => b.label || b.url);
  return d;
}

/** Vorschau einer Vorlage im Discord-Look (Platzhalter mit Beispielwerten). */
function msgPreviewHtml(d) {
  const g = st.botDiscord && st.botDiscord.guild;
  const vars = {
    '{server}': (g && g.name) || 'Pake & Scha | Legal Consulting',
    '{membercount}': g && g.memberCount ? String(g.memberCount) : '128',
    '{date}': new Date().toLocaleDateString('de-DE'),
    '{time}': new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    '{website}': location.origin,
  };
  const f = (s) => String(s || '').replace(/\{(?:server|membercount|date|time|website)\}/g, (m) => vars[m] ?? m).trim();
  const md = (s) => dcMarkdown(f(s), '');
  const bot = (st.botDiscord && st.botDiscord.bot) || { name: 'Pake & Scha | Legal Consulting', avatar: '/apple-touch-icon.png' };
  const e = d.embed || {};
  let embed = '';
  if (e.enabled) {
    const fields = (e.fields || []).filter((x) => f(x.name) && f(x.value));
    const thumb = e.thumbnail === 'server' && g ? g.icon : e.thumbnail === 'url' && /^https:\/\//i.test(e.thumbnailUrl || '') ? e.thumbnailUrl : '';
    const parts = [
      f(e.author) ? `<div class="dc-author">${esc(f(e.author))}</div>` : '',
      f(e.title) ? `<div class="dc-title${/^https:\/\//i.test(e.url || '') ? ' dc-link' : ''}">${dcInline(f(e.title))}</div>` : '',
      f(e.description) ? `<div class="dc-desc">${md(e.description)}</div>` : '',
      fields.length ? `<div class="dc-fields">${fields.map((x) => `<div class="dc-field ${x.inline ? 'inline' : ''}"><div class="dc-fname">${dcInline(f(x.name))}</div><div class="dc-fvalue">${md(x.value)}</div></div>`).join('')}</div>` : '',
      /^https:\/\//i.test(e.image || '') ? `<img class="dc-image" src="${esc(e.image)}" alt="">` : '',
      f(e.footer) || e.timestamp ? `<div class="dc-footer">${esc(f(e.footer))}${f(e.footer) && e.timestamp ? ' • ' : ''}${e.timestamp ? 'Heute um ' + vars['{time}'] : ''}</div>` : '',
    ].join('');
    if (parts.replace(/<div class="dc-footer">.*<\/div>/, '') || thumb) embed = `<div class="dc-embed" style="border-left-color:${esc(e.color || '#d4af37')}"><div class="dc-embed-main">${parts}</div>${thumb ? `<img class="dc-thumb" src="${esc(thumb)}" alt="">` : ''}</div>`;
  }
  const buttons = (d.buttons || []).filter((b) => b.label);
  const content = f(d.content);
  if (!content && !embed) return '<div class="dc-empty">Leer – bitte Text oder Embed ausfüllen.</div>';
  return `<div class="dc-msg"><img class="dc-avatar" src="${esc(bot.avatar)}" alt="">
      <div class="dc-body"><div class="dc-head"><span class="dc-name">${esc(bot.name)}</span><span class="dc-app">APP</span><span class="dc-time">Heute um ${vars['{time}']}</span></div>
      ${content ? `<div class="dc-content">${md(d.content)}</div>` : ''}${embed}
      ${buttons.length ? `<div class="dc-buttons">${buttons.map((b) => `<span class="dc-button">${esc(b.label)} ${icon('external', 'ico-sm')}</span>`).join('')}</div>` : ''}</div></div>`;
}

/* Verwenden: Senden · Gesendet · Zeitplan · Alle X Nachrichten */
function nextFullHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
function msgUse(t) {
  const tab = st.msgUseTab || 'send';
  const jobs = (kind) => t.jobs.filter((j) => j.kind === kind);
  const tabs = [
    ['send', 'Senden'],
    ['sent', `Gesendet (${t.sent.length})`],
    ['zeitplan', `Zeitplan (${jobs('zeitplan').length})`],
    ['nachrichten', `Alle X Nachrichten (${jobs('nachrichten').length})`],
    ['dm', 'Per DM an Rolle'],
  ];
  const jobList = (kind) =>
    jobs(kind).length
      ? `<div class="msg-jobs">${jobs(kind)
          .map(
            (j) => `<div class="msg-job ${j.enabled ? '' : 'off'}"><div class="min-w-0">
                <div class="font-medium">${esc(jobLabel(j))} → ${esc(channelName(j.channelId))}</div>
                <div class="text-xs text-dim">${j.kind === 'zeitplan' ? `nächster Versand ${esc(fmtDate(j.nextRunAt))}` : `${j.counter}/${j.everyMessages} Nachrichten gezählt`}${j.replacePrevious ? ' · vorige Kopie wird gelöscht' : ''}${j.lastSentAt ? ` · zuletzt ${esc(fmtDate(j.lastSentAt))}` : ''}</div>
                ${j.lastError ? `<div class="text-xs text-red-300">${esc(j.lastError)}</div>` : ''}</div>
                <div class="msg-actions"><button type="button" class="btn-ghost btn-sm" data-action="msg-job-toggle" data-id="${j.id}" data-on="${j.enabled ? 0 : 1}">${j.enabled ? 'Pausieren' : 'Fortsetzen'}</button>
                  <button type="button" class="icon-btn sm fn-danger" data-action="msg-job-delete" data-id="${j.id}" aria-label="Automatik löschen" title="Automatik löschen">${icon('trash', 'ico-sm')}</button></div></div>`
          )
          .join('')}</div>`
      : '<p class="text-sm text-dim">Noch keine.</p>';
  let pane = '';
  if (tab === 'send') {
    pane = `<p class="text-sm text-muted">Die gespeicherte Fassung der Vorlage in einen Kanal schicken. Später lässt sie sich unter „Gesendet“ auf den neuesten Stand bringen.</p>
        <div class="msg-inline mt-3"><div class="grow"><label class="label">Kanal</label>${channelSelect('id="msgSendChannel" aria-label="Kanal"', st.msgLastChannel || '')}</div>
          <button type="button" class="btn-gold btn-md self-end" data-action="msg-send" data-id="${t.id}">${icon('send', 'ico-sm')}<span>Jetzt senden</span></button></div>`;
  } else if (tab === 'sent') {
    pane = t.sent.length
      ? `<div class="msg-jobs">${t.sent
          .map(
            (s) => `<div class="msg-job"><div class="min-w-0"><div class="font-medium">${esc(channelName(s.channelId))}</div>
                <div class="text-xs text-dim">gesendet ${esc(fmtDate(s.sentAt))}${s.sentByName ? ` von ${esc(s.sentByName)}` : ''}${s.updatedAt ? ` · aktualisiert ${esc(fmtDate(s.updatedAt))}` : ''}</div></div>
                <div class="msg-actions"><button type="button" class="btn-outline btn-sm" data-action="msg-sent-update" data-id="${t.id}" data-sid="${s.id}">Auf aktuellen Stand bringen</button>
                  <button type="button" class="btn-ghost btn-sm fn-danger" data-action="msg-sent-delete" data-id="${t.id}" data-sid="${s.id}">In Discord löschen</button></div></div>`
          )
          .join('')}</div><p class="form-hint mt-2">„Auf aktuellen Stand bringen“ ersetzt Text, Embed und Buttons der Nachricht in Discord durch die gespeicherte Vorlage.</p>`
      : '<p class="text-sm text-dim">Diese Vorlage wurde noch nicht von Hand gesendet.</p>';
  } else if (tab === 'zeitplan') {
    pane = `${jobList('zeitplan')}
        <div class="msg-add mt-4"><div class="form-sub">Neuer Zeitplan</div>
          <div class="msg-grid">
            <div><label class="label">Kanal</label>${channelSelect('id="jobChannelZ" aria-label="Kanal"', st.msgLastChannel || '')}</div>
            <div><label class="label">Erster Versand</label><input type="datetime-local" id="jobStart" class="field" value="${nextFullHour()}"></div>
            <div><label class="label">Wiederholen alle</label><div class="flex gap-2"><input type="number" id="jobEvery" class="field" min="1" max="999" value="1" aria-label="Anzahl">
              <select id="jobUnit" class="field" aria-label="Einheit">${[[1, 'Minuten'], [60, 'Stunden'], [1440, 'Tage']].map(([v, l]) => opt(v, l, v === 1440)).join('')}</select></div></div>
            <label class="check self-end"><input type="checkbox" id="jobReplaceZ" checked> vorige Nachricht löschen</label>
          </div>
          <div class="form-actions mt-3"><button type="button" class="btn-gold btn-md" data-action="msg-job-add" data-kind="zeitplan" data-id="${t.id}">${icon('plus', 'ico-sm')}<span>Zeitplan anlegen</span></button></div>
          <p class="form-hint">Mindestens alle ${st.botMessages.limits.minInterval} Minuten. Beispiel: täglich um 18:00 → erster Versand heute 18:00, alle 1 Tage. War der Server zum Termin aus, wird einmal nachgeholt.</p></div>`;
  } else if (tab === 'dm') {
    pane = dmPane(t);
  } else {
    // „verbindet“/„getrennt“ = meldet sich gerade (neu) an – nur bei Fehler oder aus warnen
    const connected = !st.bot || !['fehler', 'aus'].includes(st.bot.status.state);
    pane = `${jobList('nachrichten')}
        <div class="msg-add mt-4"><div class="form-sub">Neue Automatik</div>
          <div class="msg-grid">
            <div><label class="label">Kanal</label>${channelSelect('id="jobChannelN" aria-label="Kanal"', st.msgLastChannel || '')}</div>
            <div><label class="label">Erneut posten nach</label><div class="flex items-center gap-2"><input type="number" id="jobMessages" class="field" min="1" max="1000" value="20" aria-label="Anzahl Nachrichten"><span class="text-sm text-muted whitespace-nowrap">Nachrichten</span></div></div>
            <label class="check self-end span-2"><input type="checkbox" id="jobReplaceN" checked> vorige Kopie löschen – die Nachricht bleibt so immer unten im Kanal („Sticky“)</label>
          </div>
          <div class="form-actions mt-3"><button type="button" class="btn-gold btn-md" data-action="msg-job-add" data-kind="nachrichten" data-id="${t.id}">${icon('plus', 'ico-sm')}<span>Automatik anlegen</span></button></div>
          <p class="form-hint">Gezählt werden Nachrichten von Mitgliedern (keine Bots). Höchstens alle 15 Sekunden ein neuer Post. Der Bot muss dafür verbunden sein${connected ? '' : ' – <strong>gerade ist er es nicht</strong> (siehe Übersicht)'}; den Inhalt fremder Nachrichten liest er nicht.</p></div>`;
  }
  return `<div class="chip-row msg-subtabs" role="tablist">${tabs
    .map(([k, l]) => `<button type="button" class="chip ${tab === k ? 'active' : ''}" role="tab" aria-selected="${tab === k}" data-action="msg-use-tab" data-tab="${k}" data-id="${t.id}">${esc(l)}</button>`)
    .join('')}</div><div class="mt-3">${pane}</div>`;
}

/* Per Direktnachricht an alle Mitglieder einer Rolle (z. B. Anleitung für die Mitarbeiter eines Kooperationspartners) */
const DM_STATUS = { läuft: ['läuft', 'amber'], fertig: ['fertig', 'emerald'], abgebrochen: ['abgebrochen', 'slate'], fehler: ['Fehler', 'red'] };
function dmPreviewHtml(p, t) {
  if (!p) return '';
  const tag = { vorhanden: ['Konto', 'emerald'], keins: ['kein Konto', 'slate'], gesperrt: ['gesperrt', 'red'] };
  const tooMany = p.count > p.max;
  const rows = p.members
    .map(
      (m) => `<div class="dm-row">
        <label class="dm-who"><input type="checkbox" class="dm-pick" value="${m.id}" ${tooMany ? 'disabled' : 'checked'}>
          <span class="min-w-0"><span class="dm-nick">${esc(m.name)}</span> <span class="dm-user">@${esc(m.username)}</span></span></label>
        ${badge(tag[m.account][0], tag[m.account][1])}
        ${
          m.account === 'keins'
            ? `<input class="field dm-newname" data-id="${m.id}" maxlength="80" value="${esc(m.name)}" placeholder="Vor- und Nachname (IC)" aria-label="Name für das Website-Konto von ${esc(m.name)}">`
            : `<span class="dm-acc">${m.accountName ? `Konto: ${esc(m.accountName)}` : ''}</span>`
        }</div>`
    )
    .join('');
  return `<div class="dm-preview mt-3${st.dmLogin ? ' with-login' : ''}">
      <div class="text-sm"><strong>${p.count}</strong> Mitglied${p.count === 1 ? '' : 'er'} mit ${dcMention('role', p.role.id)} · ${p.accounts.existing} mit Website-Konto · ${p.accounts.missing} ohne${p.accounts.locked ? ` · ${p.accounts.locked} gesperrt` : ''}</div>
      ${
        p.count
          ? `<div class="dm-head mt-2"><label class="dm-who"><input type="checkbox" id="dmAll" ${tooMany ? 'disabled' : 'checked'}> <span>alle</span></label><span class="dm-login-only">Name für das neue Website-Konto – vorbelegt mit dem Spitznamen auf dem Server; bitte den IC-Namen prüfen</span></div>
             <div class="dm-list">${rows}</div>`
          : ''
      }
      ${p.count > p.members.length ? `<p class="text-xs text-dim mt-1">… und ${p.count - p.members.length} weitere</p>` : ''}
      ${tooMany ? `<p class="form-hint text-red-300">Zu viele für Direktnachrichten (höchstens ${p.max}) – bitte eine kleinere Rolle wählen oder in einen Kanal senden.</p>` : ''}
      ${p.count && !tooMany ? `<div class="form-actions mt-3"><button type="button" class="btn-gold btn-md" data-action="dm-send" data-id="${t.id}">${icon('send', 'ico-sm')}<span data-dm-count>${dmSendLabel(p.count)}</span></button></div>` : ''}
    </div>`;
}
const dmSendLabel = (n) => `An ${n} ausgewählte${n === 1 ? 's Mitglied' : ' Mitglieder'} senden`;
/** Auswahl geändert: Zähler auf dem Knopf und „alle“ nachziehen. */
function dmSyncPicks() {
  const picks = $$('#dmPreview .dm-pick');
  const n = picks.filter((x) => x.checked).length;
  const label = $('#dmPreview [data-dm-count]');
  if (label) label.textContent = dmSendLabel(n);
  const all = $('#dmAll');
  if (all) {
    all.checked = n === picks.length;
    all.indeterminate = n > 0 && n < picks.length;
  }
  $$('#dmPreview .dm-row').forEach((row) => row.classList.toggle('off', !row.querySelector('.dm-pick').checked));
}
function dmRunsHtml(runs) {
  if (!runs) return '<p class="text-sm text-dim">Frühere Versände werden geladen …</p>';
  if (!runs.length) return '';
  return `<div class="form-sub mt-4">Versände</div><div class="msg-jobs">${runs
    .map((r) => {
      const [label, color] = DM_STATUS[r.status] || [r.status, 'slate'];
      const done = r.sent + r.failed;
      return `<div class="msg-job"><div class="min-w-0 grow">
          <div class="flex flex-wrap items-center gap-2"><span class="font-medium">@${esc(r.roleName)}</span>${badge(label, color)}${r.withLogin ? badge('mit Website-Zugang', 'sky') : ''}</div>
          <div class="text-xs text-dim mt-1">${done}/${r.total} · ${r.sent} zugestellt${r.failed ? ` · ${r.failed} nicht zugestellt` : ''}${r.withLogin ? ` · ${r.accountsCreated} Konto/Konten angelegt · ${r.accountsExisting} vorhanden` : ''} · ${esc(fmtDate(r.startedAt))}${r.startedByName ? ` von ${esc(r.startedByName)}` : ''}</div>
          ${r.status === 'läuft' ? `<div class="dm-bar mt-2"><span style="width:${r.total ? Math.round((done / r.total) * 100) : 0}%"></span></div>` : ''}
          ${r.error ? `<div class="text-xs text-red-300 mt-1">${esc(r.error)}</div>` : ''}
          ${r.problems.length ? `<details class="mt-1"><summary class="text-xs text-muted">${r.problems.length} Hinweis${r.problems.length === 1 ? '' : 'e'}</summary><ul class="dm-problems">${r.problems.map((x) => `<li><strong>${esc(x.name)}</strong>: ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}
        </div>${r.status === 'läuft' ? `<div class="msg-actions"><button type="button" class="btn-ghost btn-sm fn-danger" data-action="dm-cancel" data-rid="${r.id}">Abbrechen</button></div>` : ''}</div>`;
    })
    .join('')}</div>`;
}
function dmPane(t) {
  const runs = st.dmRunsFor === t.id ? st.dmRuns : null;
  if (!runs) setTimeout(() => guard(() => refreshDmRuns(t.id)), 0);
  const roleMentions = mentionsIn(t.data.content).filter((x) => x.kind !== 'user');
  return `<p class="text-sm text-muted">Die gespeicherte Vorlage als <strong>Direktnachricht</strong> an alle Mitglieder mit einer Rolle schicken – z. B. eine Anleitung an die Mitarbeiter eines Kooperationspartners. Der Bot schickt die Nachrichten langsam nacheinander (etwa 40 pro Minute, höchstens 250 auf einmal); wer keine Direktnachrichten annimmt, steht danach unter „Hinweise“.</p>
      ${roleMentions.length ? `<div class="msg-ping warn mt-3">${icon('alert', 'ico-sm')}<span>Die Vorlage erwähnt ${roleMentions.map((x) => dcMention(x.kind, x.id)).join(' ')} – in Direktnachrichten pingt das niemanden und erscheint dort als „@unbekannte Rolle“. Für DMs besser eine eigene Vorlage ohne Erwähnung nutzen.</span></div>` : ''}
      <div class="msg-inline mt-3"><div class="grow"><label class="label" for="dmRole">Rolle</label>${roleSelect('id="dmRole" aria-label="Rolle"', st.dmRole || '', { empty: '— Rolle wählen —' })}</div>
        <button type="button" class="btn-outline btn-md self-end" data-action="dm-preview" data-id="${t.id}">${icon('users', 'ico-sm')}<span>Empfänger anzeigen</span></button></div>
      <label class="check mt-3"><input type="checkbox" id="dmLogin" ${st.dmLogin ? 'checked' : ''}> Website-Zugang mitschicken</label>
      <p class="form-hint">Wer schon ein Website-Konto mit diesem Discord hat, bekommt seine E-Mail-Adresse und den Hinweis auf „Mit Discord anmelden“ – sein Passwort bleibt unverändert. Für alle anderen legt der Bot ein Mandantenkonto an (Discord gleich verknüpft, damit z. B. der Kooperationsrabatt über die Discord-Rolle greift) und schickt ein Einmal-Passwort, das beim ersten Login geändert wird. Kommt die Nachricht nicht an, wird das neue Konto wieder entfernt.</p>
      <div id="dmPreview">${st.dmPreview && st.dmPreview.role.id === st.dmRole ? dmPreviewHtml(st.dmPreview, t) : ''}</div>
      <div id="dmRuns">${dmRunsHtml(runs)}</div>`;
}
/** Versände dieser Vorlage laden; solange einer läuft, alle 2 Sekunden nachsehen. */
async function refreshDmRuns(tid) {
  clearTimeout(st.dmTimer);
  const r = await api.get(`/api/bot/dm-runs?templateId=${tid}`);
  st.dmRuns = r.runs;
  st.dmRunsFor = tid;
  const box = $('#dmRuns');
  if (!box || st.msgId !== tid) return;
  box.innerHTML = dmRunsHtml(r.runs);
  if (r.runs.some((x) => x.status === 'läuft')) st.dmTimer = setTimeout(() => guard(() => refreshDmRuns(tid)), 2000);
}

/** Modal: Bearbeiten | Verwenden (wie Sapphire). */
function msgModal(t) {
  const tab = t ? st.msgTab || 'edit' : 'edit';
  return `<h2 id="modalTitle" class="modal-title">${t ? esc(t.name) : 'Neue Nachrichten-Vorlage'}</h2>
      <div class="chip-row msg-tabs" role="tablist">
        <button type="button" class="chip ${tab === 'edit' ? 'active' : ''}" role="tab" data-action="msg-tab" data-tab="edit">${icon('edit', 'ico-sm')}<span>Bearbeiten &amp; Vorschau</span></button>
        <button type="button" class="chip ${tab === 'use' ? 'active' : ''}" role="tab" data-action="msg-tab" data-tab="use" ${t ? '' : 'disabled title="Erst speichern"'}>${icon('send', 'ico-sm')}<span>Verwenden</span></button>
      </div>
      <div data-msg-pane="edit" ${tab === 'edit' ? '' : 'hidden'}>${msgEditor(t)}</div>
      <div data-msg-pane="use" id="msgUse" ${tab === 'use' ? '' : 'hidden'}>${t ? msgUse(t) : ''}</div>`;
}
function updateMsgPreview(form) {
  const el = $('#msgPreview');
  if (!el || !form) return;
  const data = msgBody(form).data;
  el.innerHTML = msgPreviewHtml(data);
  const pings = $('#msgPings');
  if (pings) pings.innerHTML = msgPingsHtml(data);
}
function msgCurrent() {
  return st.botMessages && st.botMessages.templates.find((x) => x.id === st.msgId);
}
/** Nach Änderungen: Liste im Hintergrund und den „Verwenden“-Bereich neu zeichnen (Editor bleibt, wie er ist). */
function msgRefresh(r) {
  st.botMessages = { templates: r.templates, placeholders: r.placeholders, limits: r.limits };
  if (r.status && st.bot) st.bot.status = r.status;
  const use = $('#msgUse');
  const t = msgCurrent();
  if (use && t) use.innerHTML = msgUse(t);
  if (st.view === 'settings' && st.botModule === 'messages') {
    const main = $('.bot-main');
    if (main) main.innerHTML = botMessagesModule();
  }
}

function botSettings() {
  const cur = st.botModule || 'overview';
  // Webhook und Discord-Login brauchen den Bot nicht
  if (cur === 'webhook') return `<div class="bot-layout">${botNav()}<div class="bot-main">${discordWebhookPanel(st.settings)}</div></div>`;
  if (cur === 'login') return `<div class="bot-layout">${botNav()}<div class="bot-main">${discordLoginPanel(st.settings)}</div></div>`;
  if (!st.bot) return '<div class="panel panel-pad text-sm text-muted">Bot-Einstellungen werden geladen …</div>';
  const discordErr = st.botDiscord && st.botDiscord.error && cur !== 'overview' && cur !== 'tickets'
    ? `<div class="banner banner-amber">${icon('alert')}<div>Rollen und Kanäle konnten nicht aus Discord geladen werden: ${esc(st.botDiscord.error)} – Auswahl daher als ID-Feld.</div></div>`
    : '';
  const body =
    cur === 'tickets'
      ? ticketSettingsPanel(st.ticketSettings)
      : cur === 'ranks'
        ? botRanks()
        : cur === 'connections'
          ? botConnections()
          : cur === 'joinroles'
            ? botJoinRoles()
            : cur === 'welcome'
              ? botWelcome()
              : cur === 'messages'
                ? botMessagesModule()
                : botOverview();
  return `<div class="bot-layout">${botNav()}<div class="bot-main">${discordErr}${body}</div></div>`;
}

/* ---------------------------------------------------------------- Discord-Tickets (Einstellungen) */
function ticketSettingsPanel(t) {
  if (!t) return '';
  const anyOn = t.active || (t.board && (t.board.activeApplications || t.board.activeConcerns));
  const state = anyOn ? badge('Aktiv', 'emerald') : t.enabled ? badge('Eingeschaltet – Einrichtung unvollständig', 'amber') : badge('Aus', 'slate');
  const ok = (b) => `<span class="inline-flex align-middle shrink-0 ${b ? 'text-emerald-300' : 'text-amber-300'}">${icon(b ? 'check' : 'alert', 'ico-sm')}</span>`;
  const test = st.ticketTest;
  const testHtml = test
    ? test.running
      ? '<p class="text-sm text-dim mt-3">Verbindung wird geprüft …</p>'
      : `<div class="ticket-checks mt-3">${test.checks
          .map((c) => `<div class="flex items-start gap-2 text-sm">${ok(c.ok)}<div><strong>${esc(c.label)}</strong>${c.detail ? `<span class="text-muted"> – ${esc(c.detail)}</span>` : ''}</div></div>`)
          .join('')}</div>`
    : '';
  const counts = t.counts || { total: 0, withTicket: 0 };
  const b = t.board || {};
  const bc = t.boardCounts || { applications: {}, concerns: {} };
  const open = (counts.total || 0) + (bc.applications.total || 0) + (bc.concerns.total || 0);
  const done = (counts.withTicket || 0) + (bc.applications.withTicket || 0) + (bc.concerns.withTicket || 0);
  const anyActive = t.active || b.activeApplications || b.activeConcerns;
  return `<section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Discord-Tickets (Bot)</h2>${state}</div>
      <p class="text-sm text-muted mb-4">Der Bot legt <strong>private Discord-Kanäle</strong> an – für jede Akte in der Kategorie der Mandate (z. B. „Mandatsanfragen“) und auf Wunsch für jede Bewerbung und jedes Anliegen in einer eigenen Board-Kategorie (z. B. „Board of Partners“, nur für das Board sichtbar). Bei Akten gilt: Darin erscheinen automatisch Status, Verfahrensstand, Zuständigkeit, Nachrichten, Anhänge, Termine/Fristen, Verträge und Rechnungen der Akte – interne Notizen nie. Der <strong>Mandant wird automatisch hinzugefügt</strong>, sobald sein Discord mit dem Portal verknüpft ist (oder er auf der Website mit Aktenzeichen + Pin „Discord-Ticket beitreten“ klickt). Geschlossene Akten wandern ins Archiv; der Mandant kann dann nur noch lesen.</p>
      <div class="grid-2">
        <div>
          <div class="label">Einrichtung</div>
          <ol class="text-sm text-muted list-decimal pl-5 space-y-2">
            <li>${ok(t.tokenSet)} <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" class="text-gold hover:underline">Discord Developer Portal</a> → eure App (dieselbe wie beim Discord-Login) → <em>Bot</em> → „Reset Token“ → Token in Render unter „Environment“ als <code class="font-mono text-xs text-gold">DISCORD_BOT_TOKEN</code> eintragen → Deploy.${t.botName ? ` <span class="text-emerald-300">Bot: ${esc(t.botName)}</span>` : ''}</li>
            <li>Bot auf den Server einladen${t.inviteUrl ? `: <a href="${esc(t.inviteUrl)}" target="_blank" rel="noopener" class="text-gold hover:underline">Einladungslink mit allen nötigen Rechten</a>` : ' (Link erscheint, sobald DISCORD_CLIENT_ID gesetzt oder die Verbindung getestet ist)'}.</li>
            <li>In Discord die Kategorien anlegen: z. B. „Mandatsanfragen“ (Akten) und „Board of Partners“ (Bewerbungen, Anliegen), optional je eine fürs Archiv. IDs kopieren: Einstellungen → Erweitert → Entwicklermodus an, dann Rechtsklick → „ID kopieren“.</li>
            <li>Rechts Server-ID, Kategorien und Rollen eintragen, speichern und „Verbindung testen“.</li>
            <li>Einschalten – neue Akten, Bewerbungen und Anliegen bekommen ab dann automatisch ein Ticket. Bestehende offene: „Offene nachholen“.</li>
            <li>${ok(t.panel && t.panel.interactive)} <strong>Buttons im Ticket</strong> („Akte übernehmen“, „Akte schließen“, „Wieder öffnen“, „Anliegen erledigt“): Developer Portal → eure App → <em>General Information</em> → „Public Key“ kopieren → in Render als <code class="font-mono text-xs text-gold">DISCORD_PUBLIC_KEY</code> eintragen → Deploy. <strong>Danach</strong> im Developer Portal bei „Interactions Endpoint URL“ eintragen und speichern: <code class="font-mono text-xs text-gold break-all">${esc((t.panel && t.panel.publicUrl ? t.panel.interactionsUrl : location.origin + '/api/discord/interactions'))}</code>. Zum Schluss „Offene nachholen“ – dann bekommen auch bestehende Tickets die Buttons. Klicken dürfen nur Teammitglieder mit verknüpftem Discord und denselben Rechten wie im Dashboard. Damit stehen auch die Befehle bereit: im Ticket <code class="font-mono text-xs text-gold">/add</code>, <code class="font-mono text-xs text-gold">/remove</code>, <code class="font-mono text-xs text-gold">/delete</code>; überall <code class="font-mono text-xs text-gold">/passwort</code> (neues Passwort per Direktnachricht), <code class="font-mono text-xs text-gold">/akte</code>, <code class="font-mono text-xs text-gold">/termine</code>, <code class="font-mono text-xs text-gold">/imdienst</code>, <code class="font-mono text-xs text-gold">/hilfe</code> und für die Kanzlei <code class="font-mono text-xs text-gold">/dienst</code> und <code class="font-mono text-xs text-gold">/notiz</code>.</li>
          </ol>
          ${t.oauthConfigured ? '' : '<div class="banner banner-amber mt-3 mb-0">' + icon('alert') + '<div>Der <strong>Discord-Login</strong> ist noch nicht eingerichtet. Ohne ihn können Mandanten ihr Discord nicht verknüpfen und werden nicht automatisch ins Ticket aufgenommen.</div></div>'}
        </div>
        <form data-form="settings-tickets" class="form-grid">
          <label class="check"><input type="checkbox" name="enabled" ${t.enabled ? 'checked' : ''}> Discord-Tickets einschalten</label>
          <div><label class="label" for="tkGuild">Server-ID</label><input id="tkGuild" name="guildId" class="field font-mono text-xs" value="${esc(t.guildId)}" inputmode="numeric" autocomplete="off" placeholder="z. B. 1234567890123456789"></div>
          <fieldset class="ticket-group"><legend>Mandats-Tickets (je Akte, mit Mandant) ${t.active ? badge('aktiv', 'emerald') : ''}</legend>
            <div><label class="label" for="tkCat">Kategorie (ID) – z. B. „Mandatsanfragen“</label><input id="tkCat" name="categoryId" class="field font-mono text-xs" value="${esc(t.categoryId)}" inputmode="numeric" autocomplete="off"><p class="form-hint">Leer = keine Mandats-Tickets.</p></div>
            <div><label class="label" for="tkArch">Archiv-Kategorie (ID, optional)</label><input id="tkArch" name="archiveId" class="field font-mono text-xs" value="${esc(t.archiveId)}" inputmode="numeric" autocomplete="off"><p class="form-hint">Geschlossene Akten wandern hierhin. Leer = sie bleiben in ihrer Kategorie (Mandant nur lesend).</p></div>
            <div><label class="label" for="tkRoles">Team-Rolle(n) mit Zugriff auf alle Mandats-Tickets (IDs)</label><input id="tkRoles" name="roleIds" class="field font-mono text-xs" value="${esc((t.roleIds || []).join(', '))}" autocomplete="off" placeholder="z. B. Rolle „Anwälte“ – mehrere mit Komma"><p class="form-hint">Die zuständigen Anwälte mit verknüpftem Discord kommen zusätzlich einzeln ins Ticket.</p></div>
          </fieldset>
          <fieldset class="ticket-group"><legend>Board-Tickets (nur Board of Partners) ${b.activeApplications || b.activeConcerns ? badge('aktiv', 'emerald') : ''}</legend>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              <label class="check"><input type="checkbox" name="boardApplications" ${b.applications !== false ? 'checked' : ''}> Ticket je Bewerbung</label>
              <label class="check"><input type="checkbox" name="boardConcerns" ${b.concerns !== false ? 'checked' : ''}> Ticket je Anliegen ans Board</label>
            </div>
            <div><label class="label" for="tkBCat">Kategorie (ID) – z. B. „Board of Partners“</label><input id="tkBCat" name="boardCategoryId" class="field font-mono text-xs" value="${esc(b.categoryId || '')}" inputmode="numeric" autocomplete="off"><p class="form-hint">Leer = keine Board-Tickets. Bewerber und Einreichende sind nicht im Kanal – deshalb erscheinen hier auch interne Notizen; anonyme Anliegen bleiben anonym.</p></div>
            <div><label class="label" for="tkBArch">Board-Archiv (ID, optional)</label><input id="tkBArch" name="boardArchiveId" class="field font-mono text-xs" value="${esc(b.archiveId || '')}" inputmode="numeric" autocomplete="off"><p class="form-hint">Abgeschlossene Bewerbungen/Anliegen. Leer = allgemeine Archiv-Kategorie (Kanäle bleiben privat).</p></div>
            <div><label class="label" for="tkBRoles">Board-Rolle(n) (IDs)</label><input id="tkBRoles" name="boardRoleIds" class="field font-mono text-xs" value="${esc((b.roleIds || []).join(', '))}" autocomplete="off" placeholder="z. B. Rolle „Board of Partners“"><p class="form-hint">Zusätzlich kommen alle Board-Mitglieder (Rolle „Board of Partners“ oder Partner-Rang) mit verknüpftem Discord einzeln hinein – normale Anwälte nicht.</p></div>
          </fieldset>
          <label class="check"><input type="checkbox" name="pingRoles" ${t.pingRoles ? 'checked' : ''}> Rolle bei neuem Ticket erwähnen (Team- bzw. Board-Rolle)</label>
          <fieldset class="ticket-group"><legend>Antworten aus dem Ticket ${t.chatImport && t.active ? badge('aktiv', 'emerald') : ''}</legend>
            <label class="check"><input type="checkbox" name="chatImport" ${t.chatImport ? 'checked' : ''}> Nachrichten aus dem Akten-Ticket in die „Nachrichten“ der Akte übernehmen</label>
            <p class="form-hint">Was der Mandant oder ein Anwalt im Discord-Ticket schreibt, erscheint dann auch im Chat der Akte auf der Website (mit „über Discord“). Übernommen wird nur, was Mandant und Kanzlei schreiben – keine Bots, keine per /add hinzugefügten Personen. <strong>Vorher</strong> im <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" class="text-gold hover:underline">Discord Developer Portal</a> → eure App → <em>Bot</em> → „Privileged Gateway Intents“ den <strong>MESSAGE CONTENT INTENT</strong> einschalten und speichern – sonst schaltet sich die Übernahme von selbst wieder aus (alles andere läuft weiter).</p>
            ${t.chatImportError ? `<div class="banner banner-amber mb-0">${icon('alert')}<div>${esc(t.chatImportError)}</div></div>` : ''}
          </fieldset>
          <div><label class="label" for="tkPing">Pings in Mandats-Tickets</label><select id="tkPing" name="pingCooldownMin" class="field">${PING_COOLDOWNS.map(([v, label]) => opt(v, label, v === (t.pingCooldownMin ?? 60))).join('')}</select>
            <p class="form-hint">Dieselbe Person (Mandant oder Anwalt) wird im selben Ticket höchstens so oft erwähnt – die Nachrichten selbst erscheinen immer. Gepingt wird ohnehin nur, wer gerade etwas tun soll (z. B. der Mandant einmal, wenn er den Vertrag unterschreiben soll).</p></div>
          <div class="form-actions">
            <button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
            <button type="button" class="btn-outline btn-md" data-action="tickets-test" ${t.tokenSet ? '' : 'disabled'}>Verbindung testen</button>
            <button type="button" class="btn-ghost btn-md" data-action="tickets-backfill" ${anyActive ? '' : 'disabled'}>Offene nachholen (${done}/${open})</button>
          </div>
          ${testHtml}
        </form>
      </div>
    </section>`;
}
