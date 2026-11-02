'use strict';
/*
 * Speicherwächter: Das Google Drive darf nie voll werden.
 *  - Obergrenze für alles, was die Website im Drive ablegt (Dauerbetrieb + Tages-/Wochensicherungen), Standard 2 GB,
 *    einstellbar im Dashboard.
 *  - Reserve im ganzen Drive: mindestens 500 MB bzw. 5 % bleiben immer frei (auch für die eigenen Dateien der Kanzlei).
 *  - Wird es eng, räumt der Wächter in dieser Reihenfolge auf, bis es wieder passt: verworfene Stände anderer Linien →
 *    ältere Tages-/Wochensicherungen (die zwei neuesten bleiben) → gelöschte Bilder vor Ablauf der 30 Tage →
 *    der vorige Gesamtstand. Der aktuelle Stand und alle vorhandenen Bilder werden nie gelöscht.
 *  - Reicht das nicht, pausieren die Tages-/Wochensicherungen und die Web-Admins bekommen eine Meldung.
 *  - Alte Kopien werden endgültig gelöscht (kein Papierkorb), Dateien nie überschrieben (keine versteckten Versionen).
 */
const cfg = require('./config');
const drive = require('./gdrive');
const store = require('./store');
const { getSetting, setSetting } = require('../db/db');

const MB = 1024 * 1024;
const DEFAULT_BUDGET_MB = 2048;
let timer = null;
let last = null; // letzte Messung
let running = null;
let sinceCheck = 0; // seit der letzten Messung hochgeladen

const budgetMb = () => {
  const n = Number(getSetting('dauer_budget_mb', ''));
  return Number.isFinite(n) && n >= 200 ? Math.min(n, 1024 * 1024) : DEFAULT_BUDGET_MB;
};
const reserveOf = (limit) => (limit ? Math.max(500 * MB, Math.round(limit * 0.05)) : 0);

async function historyFiles() {
  try {
    const gd = require('../integrations/googleDrive');
    if (!gd.connected()) return [];
    return (await gd.listFiles('backup')).map((f) => ({ ...f, size: Number(f.size) || 0 }));
  } catch {
    return [];
  }
}

/** Messen: ganzes Drive (falls Google es verrät) und alles, was der Website gehört. */
async function measure() {
  const live = require('./live');
  const rootId = live.rootId();
  const parts = { live: 0, otherLines: 0, previous: 0, files: 0, deletedFiles: 0, history: 0 };
  let s = null;
  if (rootId) {
    s = await store.scan(rootId);
    const st = live.status();
    for (const f of [...s.bases, ...s.journals]) {
      if (f.lin !== st.lin) parts.otherLines += f.size;
      else if (f.gen < st.gen) parts.previous += f.size;
      else parts.live += f.size;
    }
  }
  try {
    const fst = require('./files').status();
    parts.files = fst.bytes;
    parts.deletedFiles = fst.deletedBytes;
  } catch {
    /* noch nicht aktiv */
  }
  const hist = await historyFiles();
  parts.history = hist.reduce((n, f) => n + f.size, 0);
  let quota = null;
  try {
    quota = await drive.about();
  } catch {
    quota = null; // manche Konten verraten die Belegung nicht – dann gilt nur die Obergrenze
  }
  const ours = Object.values(parts).reduce((a, b) => a + b, 0);
  return { at: new Date().toISOString(), parts, ours, budget: budgetMb() * MB, limit: quota && quota.limit, usage: quota && quota.usage, reserve: reserveOf(quota && quota.limit), scan: s, history: hist };
}

const pressureOf = (m, extra = 0) => {
  const over = m.ours + extra - m.budget;
  const free = m.limit ? m.limit - m.usage - extra : Infinity;
  return { overBudget: over > 0, lowDrive: m.limit ? free < m.reserve : false, need: Math.max(over, m.limit ? m.reserve - free : 0) };
};

/** Aufräumen, bis wieder Luft ist. Liefert gelöschte Bytes. */
async function relieve(m, extra = 0) {
  const live = require('./live');
  const st = live.status();
  let freed = 0;
  const enough = () => {
    const p = pressureOf({ ...m, ours: m.ours - freed, usage: m.usage != null ? m.usage - freed : m.usage }, extra);
    return !p.overBudget && !p.lowDrive;
  };
  const del = async (f) => {
    if (await drive.remove(f.id).catch(() => false)) freed += f.size || 0;
  };
  const steps = [];
  if (m.scan) {
    // 1. andere (nicht aktive) Linien – älteste zuerst; die gerade zur Auswahl stehende nur als letzte
    const conflict = st.conflict && st.conflict.lin;
    const other = [...m.scan.bases, ...m.scan.journals].filter((f) => f.lin !== st.lin).sort((a, b) => (a.lin === conflict) - (b.lin === conflict) || String(a.createdTime).localeCompare(String(b.createdTime)));
    steps.push(other);
  }
  // 2. Tages-/Wochensicherungen: die zwei neuesten bleiben
  const hist = [...m.history].sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  steps.push(hist.slice(2).reverse());
  // 3. gelöschte Bilder vor Ablauf der 30 Tage
  steps.push('deleted-files');
  // 4. vorige Gesamtstände dieser Linie
  if (m.scan) steps.push([...m.scan.bases, ...m.scan.journals].filter((f) => f.lin === st.lin && f.gen < st.gen));
  for (const step of steps) {
    if (enough()) break;
    if (step === 'deleted-files') {
      const before = require('./files').status().deletedBytes;
      await require('./files').purge(true).catch(() => 0);
      freed += before;
      continue;
    }
    for (const f of step) {
      if (enough()) break;
      await del(f);
    }
  }
  return freed;
}

async function check(extra = 0) {
  if (require('./state').frozen) return last; // abgelöste Instanz: nie etwas im Drive löschen
  if (running) return running;
  running = (async () => {
    const notify = require('./notify');
    let m = await measure();
    let p = pressureOf(m, extra);
    if (p.overBudget || p.lowDrive) {
      const freed = await relieve(m, extra);
      if (freed) console.log(`Dauerbetrieb: Speicherwächter hat ${Math.round(freed / MB)} MB im Drive freigeräumt.`);
      m = await measure();
      p = pressureOf(m, extra);
    }
    sinceCheck = 0;
    const tight = p.overBudget || p.lowDrive;
    if (getSetting('dauer_history_paused', '') !== (tight ? '1' : '')) setSetting('dauer_history_paused', tight ? '1' : '');
    if (tight) {
      notify.raise('dauer-speicher', {
        title: 'Google Drive: Platz wird knapp',
        description: p.lowDrive
          ? `Im Google Drive der Kanzlei sind nur noch ${Math.round((m.limit - m.usage) / MB)} MB frei (Reserve ${Math.round(m.reserve / MB)} MB). Ältere Sicherungen sind schon gelöscht; die Tages- und Wochensicherungen pausieren. Die Live-Sicherung läuft weiter. Bitte im Google Drive Platz schaffen.`
          : `Die Sicherungen brauchen ${Math.round(m.ours / MB)} MB – mehr als die eingestellte Obergrenze von ${Math.round(m.budget / MB)} MB, obwohl alles Entbehrliche gelöscht ist (vor allem Bilder). Die Tages- und Wochensicherungen pausieren, die Live-Sicherung läuft weiter. Obergrenze erhöhen: Dashboard → Einstellungen → Dauerbetrieb.`,
      });
    } else {
      notify.resolve('dauer-speicher', { title: 'Google Drive: wieder genug Platz', description: `Die Sicherungen belegen ${Math.round(m.ours / MB)} MB von höchstens ${Math.round(m.budget / MB)} MB.` });
    }
    last = { ...m, scan: undefined, history: undefined, historyCount: m.history.length, tight, lowDrive: p.lowDrive, overBudget: p.overBudget };
    return last;
  })().finally(() => (running = null));
  return running;
}

/** Vor jedem größeren Upload: passt es noch? Sonst erst aufräumen (und notfalls trotzdem hochladen – die Live-Sicherung hat Vorrang). */
async function beforeUpload(bytes) {
  sinceCheck += bytes;
  if (!last) return;
  const m = { ...last, ours: last.ours + sinceCheck, usage: last.usage != null ? last.usage + sinceCheck : null };
  const p = pressureOf(m, bytes);
  if (p.overBudget || p.lowDrive || sinceCheck > 50 * MB) await check(bytes).catch(() => {});
}

/** Google meldet „voll“: sofort aufräumen. */
async function emergency() {
  return check(10 * MB);
}

/** Dürfen Tages-/Wochensicherungen ins Drive? */
const historyAllowed = () => !cfg.enabled() || getSetting('dauer_history_paused', '') !== '1';

function start() {
  if (timer) return;
  setTimeout(() => check().catch((err) => console.warn('Dauerbetrieb: Speicherwächter:', err.message)), 5000).unref();
  timer = setInterval(() => check().catch((err) => console.warn('Dauerbetrieb: Speicherwächter:', err.message)), cfg.GUARD_MS);
  timer.unref();
}

function setBudget(mb) {
  const n = Math.round(Number(mb));
  if (!Number.isFinite(n) || n < 200) throw Object.assign(new Error('Die Obergrenze muss mindestens 200 MB betragen.'), { status: 400 });
  setSetting('dauer_budget_mb', String(n));
  return check();
}

const status = () => (last ? { ...last } : { budget: budgetMb() * MB });

module.exports = { start, check, beforeUpload, emergency, historyAllowed, setBudget, status, budgetMb };
