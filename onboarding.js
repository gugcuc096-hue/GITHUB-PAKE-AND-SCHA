'use strict';
/*
 * Einarbeitung neuer Anwälte: jede neue Person bekommt die Checkliste aus den Einstellungen,
 * dazu einen Mentor aus dem Board of Partners. Abhaken dürfen die Person selbst, ihr Mentor und das Board.
 */
const { db, getSetting, setSetting } = require('./db');

const DEFAULT_TEMPLATE = [
  'Discord-Rollen erhalten und Kanzlei-Server eingerichtet',
  'Dashboard kennengelernt (Akten, Kalender, Stempeluhr)',
  'Honorarordnung und Vertragsvorlagen gelesen',
  'Erste Akte gemeinsam mit dem Mentor bearbeitet',
  'Erste Verhandlung begleitet',
  'Erste Akte eigenständig abgeschlossen',
  'Abschlussgespräch mit dem Board',
].join('\n');

const template = () => String(getSetting('onboarding_template', DEFAULT_TEMPLATE) ?? DEFAULT_TEMPLATE);
const templateItems = () =>
  template()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30);
const setTemplate = (text) => setSetting('onboarding_template', String(text || '').trim());

/** Einarbeitung beginnen (einmal je Person). */
function start(userId, mentorId = null) {
  if (!userId || db.prepare('SELECT 1 FROM onboarding WHERE user_id = ?').get(userId)) return false;
  const ins = db.prepare('INSERT INTO onboarding_items (user_id, label, sort) VALUES (?, ?, ?)');
  db.prepare('INSERT INTO onboarding (user_id, mentor_id) VALUES (?, ?)').run(userId, mentorId);
  templateItems().forEach((label, i) => ins.run(userId, label, i));
  return true;
}

/** Fertig, sobald alles abgehakt ist (und wieder offen, wenn etwas fehlt). */
function refreshDone(userId) {
  const r = db.prepare('SELECT COUNT(*) AS total, SUM(done_at IS NOT NULL) AS done FROM onboarding_items WHERE user_id = ?').get(userId);
  const finished = r.total > 0 && r.done === r.total;
  db.prepare(`UPDATE onboarding SET done_at = ${finished ? "COALESCE(done_at, datetime('now'))" : 'NULL'} WHERE user_id = ?`).run(userId);
}

module.exports = { DEFAULT_TEMPLATE, template, setTemplate, start, refreshDone };
