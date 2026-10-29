'use strict';
/*
 * Assistent im Discord-Ticket (Feature-Schalter „Assistent im Discord-Ticket“, standardmäßig aus):
 * Stellt der Mandant im Ticket seiner Akte eine einfache Frage – „Wann ist mein nächster Termin?“, „Wie ist der Stand?“,
 * „Was fehlt noch von mir?“, „Wie sieht es mit der Rechnung aus?“, „Wer ist mein Anwalt?“ –, antwortet der Bot aus den
 * freigegebenen Angaben der Akte (assistant.js, Sicht „Mandant“: Stand, freigegebene Termine, angeforderte Unterlagen,
 * Rechnungen, zuständiger Anwalt, Statushinweis; nie interne Notizen, Aufgaben, Zeugen, Beweise oder Strategie).
 * Er ist regelbasiert (kein KI-Dienst) und gibt keine Rechtsberatung. Bei allem anderen schweigt er – es sei denn, er wird
 * direkt angesprochen („Assistent, …“ oder @Bot): dann gibt er die Frage an die zuständigen Anwälte weiter.
 * Schutz vor Lärm: nicht, wenn ein Anwalt gerade selbst schreibt (3 Minuten), höchstens eine Antwort alle 20 Sekunden und
 * 15 am Tag je Akte, nie dieselbe Antwort zweimal innerhalb von 5 Minuten. Jede Antwort steht als interner Vermerk in der Akte.
 */
const { db } = require('./db');
const features = require('./features');
const assistant = require('./assistant');

const MIN_GAP_MS = 20 * 1000;
const DAILY_MAX = 15;
const SAME_ANSWER_MS = 5 * 60 * 1000;
const LAWYER_ACTIVE_MS = 3 * 60 * 1000;
const COLOR_GOLD = 0xd4af37;
const state = new Map(); // caseId → { last, day, n, intents: Map }

/** Wie ein Anwalt zur Aktenansicht: nur die Rolle zählt (die Sicht „Mandant“ filtert danach selbst). */
const VIEWER = { id: 0, role: 'anwalt', display_name: 'Assistent', rank: '' };

const WH = /^\s*(wie|wann|was|wo|wer|welche[rsmn]?|wieviel|wie viel|gibt es|gibt’s|ist|sind|kann|können|habe|hat|haben|bis wann|muss|müssen)\b/i;
const ADDRESSED = /^\s*(@?assistent|@?bot|@?kanzlei-?bot)\b[\s,:!-]*/i;

/** Ist die Nachricht eine Frage an den Assistenten (oder offensichtlich eine einfache Sachfrage)? */
function classify(text, { mentionsBot = false } = {}) {
  const raw = String(text || '').trim();
  const addressed = mentionsBot || ADDRESSED.test(raw);
  const clean = raw.replace(ADDRESSED, '').trim();
  if (!clean || clean.length > 300 || /^[/!]/.test(clean)) return null;
  const intent = assistant.pickIntent(clean, 'client');
  const questionLike = clean.includes('?') || WH.test(clean);
  if (addressed) return { addressed: true, clean, intent };
  if (intent && questionLike) return { addressed: false, clean, intent };
  return null;
}

const dayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
function allowed(caseId, intentId) {
  const s = state.get(caseId) || { last: 0, day: dayKey(), n: 0, intents: new Map() };
  if (s.day !== dayKey()) Object.assign(s, { day: dayKey(), n: 0 });
  const now = Date.now();
  if (now - s.last < MIN_GAP_MS || s.n >= DAILY_MAX) return false;
  if (intentId && now - (s.intents.get(intentId) || 0) < SAME_ANSWER_MS) return false;
  s.last = now;
  s.n++;
  if (intentId) s.intents.set(intentId, now);
  state.set(caseId, s);
  return true;
}

/** Hat die Kanzlei in den letzten Minuten selbst im Chat dieser Akte geschrieben? */
function lawyerActive(caseId) {
  const row = db.prepare("SELECT created_at FROM notes WHERE case_id = ? AND author_role IN ('anwalt','admin') AND system = 0 AND internal = 0 ORDER BY id DESC LIMIT 1").get(caseId);
  if (!row) return false;
  return Date.now() - Date.parse(`${String(row.created_at).replace(' ', 'T')}Z`) < LAWYER_ACTIVE_MS;
}

const bullets = (lines) =>
  lines
    .map((l) => (l.heading ? `**${l.text}**` : l.text))
    .join('\n')
    .slice(0, 1800);

/**
 * Nachricht des Mandanten aus dem Ticket (von caseChat.importFromDiscord). Liefert, was gesendet wurde (für Tests):
 * { kind: 'answer' | 'handoff', intent, title, text } oder null.
 */
function onClientMessage(c, d) {
  if (!features.on('clientAssistant')) return null;
  const text = String((d && d.content) || '');
  const hit = classify(text, { mentionsBot: (d.mentions || []).some((m) => m && m.bot) });
  if (!hit) return null;
  if (!hit.addressed && lawyerActive(c.id)) return null;
  const detail = require('./routes/cases').caseDetail(require('./models').getCase(c.id), VIEWER, { lean: true });
  const a = assistant.answer(detail, hit.clean, { audience: 'client' });
  if (!allowed(c.id, a.intent)) return null;
  const tickets = require('./tickets');
  const { addSystemNote } = require('./models');
  const footer = 'Automatische Antwort aus Ihrer Akte – keine Rechtsberatung. Ihr Anwalt antwortet bei Fragen persönlich.';
  let out;
  if (a.unknown) {
    if (!hit.addressed) return null;
    out = { kind: 'handoff', intent: null, title: '🙋 Ihre Frage geht an Ihren Anwalt', text: `„${hit.clean.slice(0, 300)}“\nDas kann ich nicht beantworten – die zuständigen Anwälte wurden benachrichtigt und melden sich.` };
    tickets.post(c.id, { event: 'assistant', title: out.title, description: out.text, color: COLOR_GOLD, mention: 'lawyers', by: 'Assistent' }).catch(() => {});
    addSystemNote(c.id, null, `Assistent: Frage im Ticket an die Anwälte weitergegeben: „${hit.clean.slice(0, 200)}“`, true);
  } else {
    out = { kind: 'answer', intent: a.intent, title: `🤖 ${a.title}`, text: `${bullets(a.lines)}\n\n*${footer}*` };
    tickets.post(c.id, { event: 'assistant', title: out.title, description: out.text, color: COLOR_GOLD, by: 'Assistent' }).catch(() => {});
    addSystemNote(c.id, null, `Assistent hat im Ticket geantwortet (Thema: ${a.title})`, true);
  }
  require('./live').caseChanged(c.id);
  return out;
}

const reset = () => state.clear();

module.exports = { onClientMessage, classify, reset, VIEWER };
