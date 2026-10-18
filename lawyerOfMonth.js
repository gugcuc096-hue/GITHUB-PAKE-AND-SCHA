'use strict';
/*
 * Anwalt des Monats: zeichnet zum Monatswechsel das Teammitglied aus, das im Vormonat am meisten erreicht hat –
 * auf der Startseite (goldenes Abzeichen an der Teamkarte), auf der Profilseite und per Discord.
 *
 * Einstellung „lotm_mode“ (Einstellungen → Website & Ränge):
 *   auto    – automatisch: je abgeschlossenem Mandat 2 Punkte, je Erfolg (Freispruch, Einstellung, Vergleich …) 3 weitere,
 *             je freigegebener 5-Sterne-Bewertung 1 Punkt; mindestens ein abgeschlossenes Mandat
 *   manual  – das Board wählt selbst (lotm_member = Team-Eintrag)
 *   off     – keine Auszeichnung
 * Die Auswahl gilt für den ganzen Monat (lotm_current), damit sie nicht täglich wechselt.
 */
const { db, getSetting, setSetting } = require('./db');
const { OUTCOMES } = require('./helpers');

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MODES = ['auto', 'manual', 'off'];

/** 'YYYY-MM' des Vormonats (bzw. des Monats vor d). */
function previousMonth(d = new Date()) {
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
}
const thisMonth = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Punkte je sichtbarem Teammitglied (mit Konto) für einen Monat 'YYYY-MM'. */
function ranking(ym) {
  const members = db.prepare('SELECT id, name, user_id FROM team_members WHERE visible = 1 AND user_id IS NOT NULL').all();
  const success = Object.entries(OUTCOMES)
    .filter(([, o]) => o.success)
    .map(([k]) => k);
  const ids = 'SELECT id FROM cases WHERE lawyer_id = ? UNION SELECT case_id FROM case_lawyers WHERE user_id = ?';
  const out = [];
  for (const m of members) {
    const closed = db
      .prepare(`SELECT outcome FROM cases WHERE status = 'geschlossen' AND strftime('%Y-%m', closed_at) = ? AND id IN (${ids})`)
      .all(ym, m.user_id, m.user_id);
    if (!closed.length) continue;
    const wins = closed.filter((c) => success.includes(c.outcome)).length;
    const stars = db
      .prepare(`SELECT COUNT(*) AS n FROM reviews WHERE status = 'freigegeben' AND rating = 5 AND strftime('%Y-%m', created_at) = ? AND case_id IN (${ids})`)
      .get(ym, m.user_id, m.user_id).n;
    out.push({ memberId: m.id, name: m.name, closed: closed.length, wins, stars, points: closed.length * 2 + wins * 3 + stars });
  }
  return out.sort((a, b) => b.points - a.points || b.wins - a.wins || b.closed - a.closed || a.name.localeCompare(b.name, 'de'));
}

function stored() {
  try {
    return JSON.parse(getSetting('lotm_current', '') || 'null');
  } catch {
    return null;
  }
}

/**
 * Aktuelle Auszeichnung: { memberId, month: 'YYYY-MM' (Leistungsmonat), label, stats } oder null.
 * Automatisch: einmal je Monat berechnet und gemerkt.
 */
function current({ now = new Date() } = {}) {
  const mode = getSetting('lotm_mode', 'auto');
  if (mode === 'off') return null;
  const ym = previousMonth(now);
  if (mode === 'manual') {
    const id = Number(getSetting('lotm_member', '')) || null;
    const m = id && db.prepare('SELECT id FROM team_members WHERE id = ? AND visible = 1').get(id);
    return m ? { memberId: m.id, month: ym, label: monthLabel(ym), stats: null, manual: true } : null;
  }
  let s = stored();
  if (!s || s.month !== ym) {
    const top = ranking(ym)[0] || null;
    s = { month: ym, memberId: top ? top.memberId : null, stats: top ? { closed: top.closed, wins: top.wins, stars: top.stars } : null };
    setSetting('lotm_current', JSON.stringify(s));
  }
  if (!s.memberId || !db.prepare('SELECT 1 FROM team_members WHERE id = ? AND visible = 1').get(s.memberId)) return null;
  return { memberId: s.memberId, month: ym, label: monthLabel(ym), stats: s.stats, manual: false };
}

/** Hintergrund: zum Monatswechsel einmal in Discord verkünden. */
function sweep({ now = new Date() } = {}) {
  const key = thisMonth(now);
  const last = getSetting('lotm_announced', '');
  if (last === key) return null;
  setSetting('lotm_announced', key);
  if (!last) return null; // erster Start: erst beim nächsten Monatswechsel verkünden
  const c = current({ now });
  if (!c) return null;
  const m = db.prepare('SELECT name, role_title FROM team_members WHERE id = ?').get(c.memberId);
  const facts = c.stats
    ? [
        { name: 'Abgeschlossene Mandate', value: String(c.stats.closed) },
        { name: 'Davon erfolgreich', value: String(c.stats.wins) },
      ]
    : [];
  require('./discord').notify('lawyer.month', {
    title: `🏆 Anwalt des Monats: ${m.name}`,
    description: `${m.role_title ? `${m.role_title} · ` : ''}für herausragende Arbeit im ${c.label}. Herzlichen Glückwunsch!`,
    fields: facts,
  });
  return c;
}

module.exports = { current, ranking, sweep, previousMonth, monthLabel, MODES };
