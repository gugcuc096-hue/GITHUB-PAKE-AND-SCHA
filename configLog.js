'use strict';
/*
 * Änderungsprotokoll der Konfiguration: wer hat welche Einstellung wann geändert – mit altem und neuem Wert und,
 * wo es geht, „Zurücksetzen auf den vorherigen Wert“. Einstellungen aus der Tabelle `settings` werden automatisch
 * erfasst (db.settingHooks), andere Bereiche tragen sich mit add() ein.
 */
const { db, getSetting, setSetting, settingHooks } = require('./db');

/** Einstellungen, die der Mensch ändert – Schlüssel → Bezeichnung und nötiges Recht. Alles andere (Zeitstempel, Merker) bleibt draußen. */
const SETTINGS = [
  { re: /^(firm_address|firm_payment_info|firm_contact|firm_seat)$/, perm: 'settings.edit', label: { firm_address: 'Anschrift', firm_payment_info: 'Zahlungshinweis', firm_contact: 'Kontakt', firm_seat: 'Kanzleisitz' } },
  { re: /^(invoice_reminder_days|case_idle_days|cleanup_days|weekly_report|onboarding_template|show_duty_public|show_success_public|lotm_mode|lotm_member)$/, perm: 'settings.edit', label: {
    invoice_reminder_days: 'Zahlungserinnerung (Tage)', case_idle_days: 'Liegengebliebene Akten (Tage)', cleanup_days: 'Automatisch aufräumen (Tage)', weekly_report: 'Wochenbericht',
    onboarding_template: 'Einarbeitungs-Checkliste', show_duty_public: 'Dienst öffentlich zeigen', show_success_public: 'Erfolge öffentlich zeigen', lotm_mode: 'Anwalt des Monats: Modus', lotm_member: 'Anwalt des Monats: Person' } },
  { re: /^feature_[a-z_]+$/, perm: 'settings.edit', label: null },
  { re: /^(discord_events|discord_ping_events|discord_ping_role|discord_event_roles|discord_ticket_events)$/, perm: 'discord.edit', label: null },
  { re: /^(bot_rank_sync|bot_duty_channel|bot_welcome|bot_join_roles|bot_connections|discord_webadmin_role)$/, perm: 'discord.edit', label: null },
  { re: /^(contract_header|fivenet_url)$/, perm: 'system.edit', label: { contract_header: 'Briefkopf der Verträge', fivenet_url: 'FiveNet-Adresse' } },
];
/** Werte, die nie im Protokoll stehen (Adressen mit Zugangsschlüssel). */
const SECRET = /webhook|token|secret|password/i;

const FEATURE_LABEL = { reviews: 'Bewertungen', vip: 'VIP & Lifetime', karriere: 'Karriere-Seite', clientLink: 'Mandanten-Link', slots: 'Terminvorschläge' };

function labelFor(key, def) {
  if (def.label && def.label[key]) return def.label[key];
  if (key.startsWith('feature_')) return `Schalter „${FEATURE_LABEL[key.slice(8)] || key.slice(8)}“`;
  return key.replace(/^(bot_|discord_)/, 'Discord: ').replace(/_/g, ' ');
}

function add(user, { area, key = '', label, perm = '', before = null, after = null, revertible = false }) {
  try {
    db.prepare(
      'INSERT INTO config_log (user_id, user_name, area, key, label, perm, old_value, new_value, revertible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user ? user.id : null, user ? user.display_name || user.displayName : 'System', area, key, label, perm, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), revertible ? 1 : 0);
    if (Math.random() < 0.02) db.prepare('DELETE FROM config_log WHERE id <= (SELECT MAX(id) FROM config_log) - 3000').run();
  } catch (err) {
    console.warn('Änderungsprotokoll fehlgeschlagen:', err.message);
  }
}

// Einstellungen automatisch erfassen – nur bei Änderungen im Namen eines angemeldeten Nutzers
settingHooks.push((key, prev, next, ctx) => {
  const def = SETTINGS.find((d) => d.re.test(key));
  if (!def || !ctx || !ctx.user) return;
  const hidden = SECRET.test(key);
  add(ctx.user, {
    area: 'settings',
    key,
    label: labelFor(key, def),
    perm: def.perm,
    before: hidden ? null : prev,
    after: hidden ? '(geändert)' : next,
    revertible: !hidden,
  });
});

const trim = (v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v);
const row = (r) => ({
  id: r.id,
  at: r.at,
  user: r.user_name,
  area: r.area,
  key: r.key,
  label: r.label,
  perm: r.perm,
  before: r.old_value === null ? null : trim(JSON.parse(r.old_value)),
  after: r.new_value === null ? null : trim(JSON.parse(r.new_value)),
  revertible: !!r.revertible && !r.reverted_at,
  revertedAt: r.reverted_at,
});

function list(limit = 150) {
  return db.prepare('SELECT * FROM config_log ORDER BY id DESC LIMIT ?').all(limit).map(row);
}

/** Zurücksetzen auf den Wert vor der Änderung. Wirft einen Fehler mit status, wenn es nicht geht. */
function revert(id, user) {
  const r = db.prepare('SELECT * FROM config_log WHERE id = ?').get(id);
  if (!r) throw Object.assign(new Error('Eintrag nicht gefunden.'), { status: 404 });
  if (!r.revertible || r.reverted_at) throw Object.assign(new Error('Diese Änderung lässt sich nicht zurücksetzen.'), { status: 400 });
  const before = r.old_value === null ? null : JSON.parse(r.old_value);
  const after = r.new_value === null ? null : JSON.parse(r.new_value);
  if (r.area === 'settings') {
    const current = getSetting(r.key, null);
    // Zwischenzeitlich schon weiter geändert? Dann nur nach Rückfrage – die Oberfläche zeigt den aktuellen Wert
    if (current !== after && current !== null) throw Object.assign(new Error('Der Wert wurde danach noch einmal geändert – bitte die neuere Änderung zurücksetzen.'), { status: 409 });
    if (before === null) db.prepare('DELETE FROM settings WHERE key = ?').run(r.key);
    else setSetting(r.key, before);
  } else if (r.area === 'site_text') {
    const [page, key] = r.key.split(':');
    if (before === null) db.prepare('DELETE FROM site_texts WHERE page = ? AND key = ?').run(page, key);
    else {
      const o = db.prepare('SELECT original FROM site_texts WHERE page = ? AND key = ?').get(page, key);
      db.prepare(
        `INSERT INTO site_texts (page, key, original, text, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(page, key) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(page, key, (o && o.original) || before.original || before.text, before.text, user.id);
    }
  } else if (r.area === 'permissions') {
    require('./permissions').saveMatrix(before || require('./permissions').DEFAULTS);
  } else {
    throw Object.assign(new Error('Diese Änderung lässt sich nicht zurücksetzen.'), { status: 400 });
  }
  db.prepare("UPDATE config_log SET reverted_at = datetime('now') WHERE id = ?").run(id);
  // Einstellungen trägt der Hook selbst ein (setSetting) – nur das Löschen ohne Vorgänger nicht
  if (r.area !== 'settings' || before === null) add(user, { area: r.area, key: r.key, label: `${r.label} zurückgesetzt`, perm: r.perm, before: after, after: before });
  return row(db.prepare('SELECT * FROM config_log WHERE id = ?').get(id));
}

module.exports = { add, list, revert, FEATURE_LABEL };
