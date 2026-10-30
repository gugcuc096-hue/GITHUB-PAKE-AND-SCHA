'use strict';
/*
 * Rabattaktionen für alle (Einstellungen → Konfiguration → Rabattaktionen): z. B. „Halloween −15 %“ vom 24. bis 31. Oktober.
 * Läuft eine Aktion, zieht jede neue Rechnung sie automatisch ab (routes/invoices.js), der Tarifrechner der Website
 * rechnet sie mit ein und ein Aktionsbanner mit Countdown kündigt sie an (siteConfig.js → publicPayload).
 * „Jährlich“ wiederholt den Zeitraum jedes Jahr (Ostern und Black Friday rechnen ihr Datum selbst aus).
 * Laufen mehrere Aktionen gleichzeitig, gilt die mit dem höchsten Satz – Aktionen werden nicht addiert.
 *
 * Dazu die Jahreszeiten-Deko (Saison): sie folgt einer laufenden Aktion, sonst dem Kalender (siehe season()).
 */
const { db } = require('./db');

/** Anlässe: Symbol, Standardzeitraum (MM-TT) und die Deko, die dazu läuft. */
const OCCASIONS = {
  halloween: { label: 'Halloween', icon: '🎃', from: '10-24', to: '10-31', season: 'halloween' },
  weihnachten: { label: 'Weihnachten', icon: '🎄', from: '12-18', to: '12-26', season: 'weihnachten' },
  silvester: { label: 'Silvester & Neujahr', icon: '🎆', from: '12-29', to: '01-02', season: 'silvester' },
  valentin: { label: 'Valentinstag', icon: '💘', from: '02-11', to: '02-14', season: 'valentin' },
  ostern: { label: 'Ostern', icon: '🐣', from: '', to: '', season: 'ostern', computed: true },
  sommer: { label: 'Sommer', icon: '☀️', from: '07-01', to: '08-31', season: 'sommer' },
  blackfriday: { label: 'Black Friday', icon: '🖤', from: '', to: '', season: 'blackfriday', computed: true },
  jubilaeum: { label: 'Kanzlei-Jubiläum', icon: '🥂', from: '', to: '', season: 'jubilaeum' },
  eigen: { label: 'Eigener Anlass', icon: '🏷️', from: '', to: '', season: '' },
};
/** Deko-Jahreszeiten (style.season in siteConfig.js wählt eine davon, „auto“ oder „aus“). */
const SEASONS = {
  halloween: 'Halloween',
  weihnachten: 'Weihnachten',
  silvester: 'Silvester',
  valentin: 'Valentinstag',
  ostern: 'Ostern & Frühling',
  sommer: 'Sommer',
  blackfriday: 'Black Friday',
  jubilaeum: 'Jubiläum',
};
/** Ohne Aktion schmückt sich die Seite trotzdem passend zum Kalender (MM-TT, beide Tage eingeschlossen). */
const CALENDAR = [
  ['halloween', '10-20', '11-01'],
  ['weihnachten', '12-01', '12-27'],
  ['silvester', '12-28', '01-02'],
  ['valentin', '02-10', '02-14'],
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (day, n) => iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5));
const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/** Ostersonntag (Gauß/Meeus) als JJJJ-MM-TT. */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}
/** Black Friday: Freitag nach dem vierten Donnerstag im November. */
function blackFriday(year) {
  const first = new Date(Date.UTC(year, 10, 1));
  const thursday = 1 + ((4 - first.getUTCDay() + 7) % 7) + 21;
  return iso(new Date(Date.UTC(year, 10, thursday + 1)));
}

/** Zeitraum einer Aktion in einem bestimmten Jahr: [Start, Ende] als JJJJ-MM-TT (Ende eingeschlossen). */
function windowIn(p, year) {
  if (!p.yearly) return [p.starts_on, p.ends_on];
  if (p.occasion === 'ostern') {
    const e = easter(year);
    return [addDays(e, -2), addDays(e, 1)]; // Karfreitag bis Ostermontag
  }
  if (p.occasion === 'blackfriday') {
    const f = blackFriday(year);
    return [f, addDays(f, 3)]; // bis Cyber Monday
  }
  const from = p.starts_on.slice(5);
  const to = p.ends_on.slice(5);
  return [`${year}-${from}`, `${to < from ? year + 1 : year}-${to}`];
}
/** Läuft die Aktion an diesem Tag? Liefert dann ihren Zeitraum, sonst null. */
function runningOn(p, day) {
  const year = Number(day.slice(0, 4));
  for (const y of p.yearly ? [year - 1, year] : [year]) {
    const [from, to] = windowIn(p, y);
    if (day >= from && day <= to) return [from, to];
  }
  return null;
}
/** Nächster Start ab heute (für die Liste: „startet am …“). */
function nextStart(p, day) {
  const year = Number(day.slice(0, 4));
  for (const y of p.yearly ? [year, year + 1] : [year]) {
    const [from] = windowIn(p, y);
    if (from > day) return from;
  }
  return null;
}

/** Tagesende in Berlin als Zeitpunkt (für den Countdown im Banner). */
function berlinEndOfDay(day) {
  const guess = new Date(`${day}T23:59:59Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local - utc)).toISOString();
}

function row(p, day = berlinToday()) {
  const occ = OCCASIONS[p.occasion] || OCCASIONS.eigen;
  const running = !!p.active && runningOn(p, day);
  const win = running || windowIn(p, Number(day.slice(0, 4)));
  return {
    id: p.id,
    name: p.name,
    pct: p.pct,
    occasion: p.occasion || 'eigen',
    occasionLabel: occ.label,
    icon: occ.icon,
    startsOn: p.starts_on,
    endsOn: p.ends_on,
    yearly: !!p.yearly,
    announce: !!p.announce,
    message: p.message,
    active: !!p.active,
    running: !!running,
    from: win[0],
    to: win[1],
    next: running ? null : p.active ? nextStart(p, day) : null,
  };
}

const all = () => db.prepare('SELECT * FROM promotions ORDER BY active DESC, id DESC').all();
const list = () => {
  const day = berlinToday();
  return all().map((p) => row(p, day));
};
const get = (id) => db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) || null;

/** Die Aktion, die heute für alle gilt (höchster Satz) – oder null. */
function current(day = berlinToday()) {
  let best = null;
  for (const p of db.prepare('SELECT * FROM promotions WHERE active = 1').all()) {
    if (!runningOn(p, day)) continue;
    if (!best || p.pct > best.pct || (p.pct === best.pct && p.id > best.id)) best = p;
  }
  return best ? row(best, day) : null;
}
/** Was Website und Dashboard brauchen (Tarifrechner, Banner, Rechnungsformular). */
function publicCurrent() {
  const c = current();
  if (!c) return null;
  return { id: c.id, name: c.name, pct: c.pct, occasion: c.occasion, icon: c.icon, label: c.occasionLabel, to: c.to, endsAt: berlinEndOfDay(c.to), announce: c.announce, message: c.message };
}

/** Deko, die heute läuft: eingestellte Saison, sonst (auto) die der laufenden Aktion, sonst nach Kalender. */
function season(setting = 'auto', day = berlinToday()) {
  if (setting === 'aus') return '';
  if (SEASONS[setting]) return setting;
  const c = current(day);
  if (c && OCCASIONS[c.occasion] && OCCASIONS[c.occasion].season) return OCCASIONS[c.occasion].season;
  const md = day.slice(5);
  for (const [s, from, to] of CALENDAR) if (from <= to ? md >= from && md <= to : md >= from || md <= to) return s;
  const e = easter(Number(day.slice(0, 4)));
  if (day >= addDays(e, -7) && day <= addDays(e, 1)) return 'ostern';
  return '';
}

module.exports = { OCCASIONS, SEASONS, list, get, current, publicCurrent, season, row, runningOn, windowIn, easter, blackFriday, berlinToday, berlinEndOfDay };
