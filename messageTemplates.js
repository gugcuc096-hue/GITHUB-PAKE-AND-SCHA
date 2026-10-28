'use strict';
/*
 * Mitteilungstexte: die Nachrichten, die der Bot und die Website an Mandanten schicken (Zahlungserinnerung, fehlende
 * Unterlagen, Terminerinnerung, Bewertungsbitte, Eingangsbestätigung im Ticket). Die Kanzlei ändert sie unter
 * Einstellungen → Texte & Banner → Mitteilungen – mit Platzhaltern wie {mandant} oder {aktenzeichen}. Leer = Standardtext.
 * Ton „Sie“ oder „Du“ gilt für alle Standardtexte; eigene Texte gelten, wie sie geschrieben sind.
 */
const siteConfig = require('./siteConfig');

const PH = {
  mandant: 'Name bzw. Erwähnung des Mandanten',
  aktenzeichen: 'Aktenzeichen, z. B. PS-2026-0012',
  rechnung: '„Rechnung“ oder „Honorarvereinbarung“',
  nummer: 'Nummer der Rechnung',
  betrag: 'Rechnungsbetrag',
  faelligkeit: 'Satz zur Fälligkeit („war am … fällig und ist noch offen“)',
  zahlungshinweis: 'Zahlungshinweis aus den Kanzlei-Einstellungen',
  unterlage: 'Name der fehlenden Unterlage',
  notiz: 'Notiz der Kanzlei zur Unterlage',
  termin: 'Titel des Termins',
  ort: 'Ort des Termins',
};

const MESSAGES = {
  payment: {
    label: 'Zahlungserinnerung',
    where: 'Discord-DM und Ticket, wenn eine Rechnung überfällig ist (Tage: Einstellungen → Kanzlei & Rechnungen)',
    placeholders: ['mandant', 'aktenzeichen', 'rechnung', 'nummer', 'betrag', 'faelligkeit', 'zahlungshinweis'],
    sie: 'Die {rechnung} **{nummer}** über **{betrag}** {faelligkeit}.\n\nBitte begleichen Sie den Betrag. {zahlungshinweis}\n\nBereits bezahlt? Dann ist diese Nachricht hinfällig. Die Rechnung finden Sie im Mandantenportal unter „Rechnungen“.',
    du: 'Die {rechnung} **{nummer}** über **{betrag}** {faelligkeit}.\n\nBitte begleiche den Betrag. {zahlungshinweis}\n\nSchon bezahlt? Dann ist diese Nachricht hinfällig. Die Rechnung findest du im Portal unter „Rechnungen“.',
  },
  docs: {
    label: 'Fehlende Unterlage',
    where: 'Discord-DM und Ticket, wenn die Kanzlei eine Unterlage anfordert – und die Erinnerung danach',
    placeholders: ['mandant', 'aktenzeichen', 'unterlage', 'notiz'],
    sie: '**{unterlage}**\n\n{notiz}\n\nBitte reichen Sie die Unterlage über Ihre Akte im Mandantenportal oder per Nachricht an die Kanzlei nach.',
    du: '**{unterlage}**\n\n{notiz}\n\nBitte reiche die Unterlage über deine Akte im Portal oder per Nachricht an die Kanzlei nach.',
  },
  appointment: {
    label: 'Terminerinnerung',
    where: 'Discord-DM eine Stunde vor einem Mandantentermin',
    placeholders: ['mandant', 'aktenzeichen', 'termin', 'ort'],
    sie: 'Ihr Termin bei Pake & Scha beginnt bald. Bitte seien Sie pünktlich – falls etwas dazwischenkommt, sagen Sie den Termin im Mandantenportal ab.',
    du: 'Dein Termin bei Pake & Scha beginnt bald. Bitte sei pünktlich – falls etwas dazwischenkommt, sag den Termin im Portal ab.',
  },
  review: {
    label: 'Bewertungsbitte',
    where: 'Discord-DM nach dem Abschluss einer Akte (einmal je Akte)',
    placeholders: ['mandant', 'aktenzeichen'],
    sie: 'Ihre Akte **{aktenzeichen}** ist abgeschlossen. Über eine kurze Bewertung freuen wir uns sehr – das dauert nur eine Minute.\n\nSie entscheiden, ob Ihr Name, Ihre Initialen oder gar nichts angezeigt wird. Vor der Veröffentlichung auf der Website prüft das Board of Partners jede Bewertung.',
    du: 'Deine Akte **{aktenzeichen}** ist abgeschlossen. Über eine kurze Bewertung freuen wir uns sehr – das dauert nur eine Minute.\n\nDu entscheidest, ob dein Name, deine Initialen oder gar nichts angezeigt wird. Vor der Veröffentlichung auf der Website prüft das Board of Partners jede Bewertung.',
  },
  receipt: {
    label: 'Eingangsbestätigung im Ticket',
    where: 'Erste Nachricht im Discord-Ticket, sobald der Mandant beitritt',
    placeholders: ['mandant', 'aktenzeichen'],
    sie: '{mandant} ist dem Ticket beigetreten. Hier erscheinen alle Neuigkeiten zu Ihrer Akte **{aktenzeichen}** – Status, Termine, Verträge und Rechnungen.',
    du: '{mandant} ist dem Ticket beigetreten. Hier erscheinen alle Neuigkeiten zu deiner Akte **{aktenzeichen}** – Status, Termine, Verträge und Rechnungen.',
  },
};

/** Der gültige Text (eigener, sonst Standard im eingestellten Ton). */
function templateOf(key, cfg = siteConfig.get('messages')) {
  const own = cfg.texts && cfg.texts[key];
  return own && own.trim() ? own : MESSAGES[key][cfg.tone === 'du' ? 'du' : 'sie'];
}

/** Platzhalter einsetzen; unbekannte oder leere verschwinden, überzählige Leerzeilen werden zusammengezogen. */
function fill(text, vars) {
  return String(text)
    .replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(vars, name) ? String(vars[name] ?? '') : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const render = (key, vars = {}) => fill(templateOf(key), vars);

/** Für die Einstellungen: Standardtexte, Platzhalter, Orte. */
const catalog = () => ({ placeholders: PH, messages: Object.fromEntries(Object.entries(MESSAGES).map(([k, m]) => [k, { label: m.label, where: m.where, placeholders: m.placeholders, sie: m.sie, du: m.du }])) });

module.exports = { MESSAGES, PH, templateOf, render, fill, catalog };
