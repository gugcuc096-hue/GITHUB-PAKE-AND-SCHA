/*
 * Kanzlei-Dashboard (Single-Page): Navigation per #hash, Daten über /api/*.
 * Alle Nutzertexte laufen vor der Ausgabe per innerHTML durch esc().
 *
 * Teil 1 von 12 – Grundlagen: Konstanten, Zustand & Helfer, Daten laden.
 * Das Dashboard besteht aus den Dateien unter /js/dashboard/ (01 … 12). dashboard.html lädt sie in dieser
 * Reihenfolge; sie teilen sich Konstanten und Funktionen. Code, der beim Laden sofort läuft, darf nur auf
 * Früheres zugreifen – der eigentliche Start (12-start.js) kommt zuletzt.
 */
'use strict';

const { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage } = window.PS;
/** Bestätigung im Kanzlei-Design (statt window.confirm). */
const ask = (message, opts) => window.PS.confirm(message, opts);
const askDelete = (title, message, confirmText = 'Löschen') => ask(message, { title, confirmText, danger: true });

/* ================================================================
   Konstanten
   ================================================================ */
const ROLES = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Board of Partners' };
const STEPS = ['Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung'];
const AREAS = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
const URGENCY = { normal: ['Normal', 'slate'], eilig: ['Eilig', 'amber'], notfall: ['Notfall', 'red'] };
const CASE_STATUS = { offen: ['Offen', 'amber'], in_bearbeitung: ['In Bearbeitung', 'sky'], geschlossen: ['Geschlossen', 'slate'] };
// Priorität einer Akte (nur für die Kanzlei sichtbar)
// [Auswahl, Farbe, Anzeige]
const PRIORITY = {
  1: ['Niedrig', 'slate', 'Niedrige Priorität'],
  2: ['Normal', 'sky', 'Normale Priorität'],
  3: ['Hoch', 'amber', 'Hohe Priorität'],
  4: ['Kritisch', 'red', 'Kritische Priorität'],
};
// Start-Priorität einer neuen Akte aus der Dringlichkeit (Angabe des Mandanten) – wie auf dem Server
const PRIORITY_FROM_URGENCY = { normal: 2, eilig: 3, notfall: 4 };
const CASE_SORTS = { aktualisiert: 'Zuletzt geändert', prioritaet: 'Priorität', neueste: 'Neueste zuerst', aelteste: 'Älteste zuerst' };
const SOURCES = { portal: 'Mandantenportal', web: 'Website-Formular', kanzlei: 'Kanzlei' };
const EVENT_TYPES = { gericht: 'Gerichtstermin', frist: 'Frist', mandant: 'Mandantengespräch', intern: 'Intern' };
const EVENT_COLORS = { mandant: '#34d399', gericht: '#d4af37', frist: '#f87171', intern: '#7dd3fc' };
const EVENT_STATUS = { angefragt: ['Angefragt', 'amber'], bestaetigt: ['Bestätigt', 'emerald'], abgesagt: ['Abgesagt', 'slate'], erledigt: ['Erledigt', 'slate'] };
const INVOICE_STATUS = { offen: ['Offen', 'amber'], bezahlt: ['Bezahlt', 'emerald'], storniert: ['Storniert', 'slate'] };
const INVOICE_KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
const FEE_CATEGORIES = { rechtsberatung: 'Rechtsberatung', strafrecht: 'Strafrecht & Haftvertretung', notfall: 'Notfall & Sofortdienst', gericht: 'Gerichtsverfahren', vertraege: 'Verträge & Dokumente' };
// Ränge der Kanzlei – es gibt nur diese sechs (siehe helpers.js auf dem Server).
const RANK_GROUPS = { 'Board of Partners': ['Founding Partner', 'Equity Partner', 'Partner'], 'Associate Attorneys': ['Senior Associate', 'Associate', 'Junior Associate'] };
const RANKS = Object.values(RANK_GROUPS).flat();
const NOTE_COLORS = { gold: '#d4af37', blue: '#60a5fa', green: '#34d399', red: '#f87171', slate: '#94a3b8' };
const DISCORD_MSG = {
  linked: ['Discord-Konto erfolgreich verbunden.', 'ok'],
  taken: ['Dieses Discord-Konto ist bereits mit einem anderen Website-Konto verbunden.', 'error'],
  denied: ['Die Verbindung mit Discord wurde abgebrochen.', 'error'],
  error: ['Die Discord-Verbindung ist fehlgeschlagen. Bitte erneut versuchen.', 'error'],
  state: ['Sicherheitsprüfung fehlgeschlagen – bitte die Verbindung erneut starten.', 'error'],
  disabled: ['Die Discord-Anbindung ist noch nicht eingerichtet.', 'error'],
  session: ['Bitte zuerst anmelden.', 'error'],
  willkommen: ['Willkommen! Ihr Konto ist mit Discord verbunden – anmelden können Sie sich künftig mit „Mit Discord anmelden“.', 'ok'],
  fremdeakte: ['Angemeldet. Die Akte aus Ihrer Anfrage gehört bereits zu einem anderen Konto – bitte wenden Sie sich an die Kanzlei.', 'error'],
};

const GOOGLE_MSG = {
  verbunden: ['Google-Konto der Kanzlei verbunden – Google Docs sind jetzt in den Druckansichten verfügbar.', 'ok'],
  abgebrochen: ['Die Verbindung mit Google wurde abgebrochen.', 'error'],
  drive: ['Google hat keinen Zugriff auf Google Drive erteilt – bitte erneut verbinden und den Haken bei Google Drive setzen.', 'error'],
  dauerhaft: ['Google hat keinen dauerhaften Zugang geliefert. Bitte unter myaccount.google.com → Sicherheit den Zugriff der App entfernen und erneut verbinden.', 'error'],
  sitzung: ['Sicherheitsprüfung fehlgeschlagen – bitte die Verbindung erneut starten.', 'error'],
  config: ['Google Docs ist noch nicht eingerichtet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Render).', 'error'],
  rechte: ['Nur das Board of Partners verbindet das Google-Konto der Kanzlei.', 'error'],
  fehler: ['Die Verbindung mit Google ist fehlgeschlagen. Bitte erneut versuchen.', 'error'],
};

const DUTY = { dienst: 'Im Dienst', gericht: 'Im Gericht', pause: 'Pause', off: 'Außer Dienst' };
const APP_STATUS = {
  eingegangen: ['Eingegangen', 'amber'],
  in_pruefung: ['In Prüfung', 'sky'],
  gespraech: ['Einladung zum Gespräch', 'gold'],
  angenommen: ['Angenommen', 'emerald'],
  abgelehnt: ['Abgelehnt', 'red'],
};

const ICONS = {
  camera: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  userAdd: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
  list: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  folder: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  pin: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
  receipt: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  scale: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
  cog: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  x: 'M6 18L18 6M6 6l12 12',
  plus: 'M12 4v16m8-8H4',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  chevronLeft: 'M15 19l-7-7 7-7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronUp: 'M5 15l7-7 7 7',
  chevronDown: 'M19 9l-7 7-7-7',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  more: 'M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z',
  printer: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
  restore: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3',
  eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  reply: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  copy: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
  briefcase: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  globe: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9',
  send: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z',
  tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  chat: 'M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  star: 'M11.48 3.5a.56.56 0 011.04 0l2.12 5.11a.56.56 0 00.48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 00-.18.56l1.28 5.39a.56.56 0 01-.84.61l-4.73-2.89a.56.56 0 00-.58 0l-4.73 2.89a.56.56 0 01-.84-.61l1.28-5.39a.56.56 0 00-.18-.56l-4.2-3.6a.56.56 0 01.32-.99l5.52-.44a.56.56 0 00.48-.35l2.12-5.11z',
  link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  external: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  tasks: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  table: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  doc: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
};
const icon = (name, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
const DISCORD_ICON =
  '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.1.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

const VIEWS = {
  overview: { label: 'Übersicht', icon: 'home' },
  cases: { label: 'Akten', clientLabel: 'Meine Akten', icon: 'folder' },
  tasks: { label: 'Aufgaben', icon: 'tasks', staff: true },
  calendar: { label: 'Kalender & Fristen', short: 'Kalender', clientLabel: 'Termine', icon: 'calendar' },
  invoices: { label: 'Rechnungen', icon: 'receipt' },
  'vip-angebot': { label: 'VIP & Lifetime', short: 'VIP', icon: 'crown', client: true },
  mail: { label: 'Kanzlei-Post', short: 'Post', icon: 'mail' },
  board: { label: 'Pinnwand', icon: 'pin', staff: true },
  concerns: { label: 'Anliegen ans Board', short: 'Anliegen', icon: 'chat' },
  duty: { label: 'Dienstzeiten', icon: 'clock', staff: true },
  personnel: { label: 'Beförderungen & Einstellungen', short: 'Personal', icon: 'star', staff: true },
  'concerns-board': { label: 'Eingegangene Anliegen', short: 'Anliegen', icon: 'chat', board: true, section: 'Board of Partners' },
  applications: { label: 'Bewerbungen', icon: 'userAdd', board: true, section: 'Board of Partners' },
  'name-requests': { label: 'Namensänderungen', short: 'Namen', icon: 'edit', board: true, section: 'Board of Partners' },
  reviews: { label: 'Mandantenstimmen', short: 'Stimmen', icon: 'star', board: true, section: 'Board of Partners' },
  team: { label: 'Team', icon: 'users', admin: true, section: 'Board of Partners' },
  users: { label: 'Benutzer', icon: 'key', admin: true, section: 'Board of Partners' },
  work: { label: 'Aktenbearbeitung', icon: 'briefcase', board: true, section: 'Board of Partners' },
  vip: { label: 'VIP & Lifetime', short: 'VIP', icon: 'crown', board: true, section: 'Board of Partners' },
  cooperations: { label: 'Kooperationen', icon: 'tag', board: true, section: 'Board of Partners' },
  fees: { label: 'Honorarordnung', icon: 'scale', admin: true, section: 'Board of Partners' },
  audit: { label: 'Protokoll', icon: 'list', admin: true, section: 'Board of Partners' },
  settings: { label: 'Einstellungen', icon: 'cog', admin: true, section: 'Board of Partners' },
  profile: { label: 'Mein Profil', short: 'Profil', icon: 'user', section: 'Konto' },
  'invoice-new': { label: 'Neues Dokument', icon: 'receipt', staff: true, hidden: true },
};

/* ================================================================
   Zustand & Helfer
   ================================================================ */
const st = {
  user: null,
  view: 'overview',
  alerts: [], // Systemwarnungen (nur Board of Partners)
  gsQuery: '', // globale Suche
  gsResults: null,
  gsActive: 0,
  gsToken: 0,
  gsLoading: false,
  navToken: 0,
  cases: [],
  events: [],
  eventCache: new Map(),
  invoices: [],
  paymentReports: 0, // Kanzlei: offene Rechnungen, die der Mandant als bezahlt gemeldet hat (Badge „Rechnungen“)
  toSign: [], // Mandant: Verträge/Schriftsätze, die auf seine Unterschrift warten („Was ist zu tun?“)
  board: [],
  fees: [],
  adminFees: [],
  team: [],
  users: [],
  lawyers: [],
  contacts: null,
  settings: null,
  discordOAuth: false,
  unread: 0,
  messages: [],
  mailBox: 'inbox',
  mailSel: null,
  caseFilter: 'aktiv',
  caseQuery: '',
  caseMine: false,
  caseSort: (() => {
    try {
      return localStorage.getItem('ps.caseSort') || 'aktualisiert';
    } catch {
      return 'aktualisiert';
    }
  })(),
  userFilter: 'alle',
  userQuery: '',
  invFilter: 'alle',
  cal: { month: null, selected: null, types: { gericht: true, frist: true, mandant: true, intern: true } },
  draft: null,
  modalCaseId: null,
  returnCase: null,
  // Dialog-Verlauf (siehe openModal/modalBack in 02-geruest.js)
  modalStack: [],
  modalCurrent: null,
  modalRestoring: false,
  modalReplace: 0,
  modalAsking: false, // Rückfrage „Eingaben verwerfen?“ ist offen
  // Zurück-Taste (siehe syncHistory in 02-geruest.js)
  histTimer: null,
  histSkip: 0, // Zeitpunkt des eigenen history.back() – das folgende popstate ist kein Klick auf „Zurück“
  histPaused: false, // beim Start: Akte aus der Adresse wird gerade geöffnet
  leaving: false, // Abmelden: Seite wird bewusst verlassen (keine Rückfrage des Browsers)
  invoiceFrom: null, // Rechnung aus einer Akte heraus: { view, caseId, caseNumber } – Abbrechen/Erstellen führen dorthin zurück
  caseAttachments: [],
  duty: null,
  dutyWeek: null,
  dutyData: null,
  dutyUser: null,
  applications: [],
  positions: [],
  appTab: 'bewerbungen',
  appFilter: 'offen',
  newApplications: 0,
  modalAppId: null,
  audit: [],
  auditQuery: '',
  auditHasMore: false,
  // Aufgaben & Wiedervorlagen
  tasks: [],
  myTasks: [],
  caseTasks: [],
  taskScope: 'mine',
  taskState: 'open',
  taskQuery: '',
  dueTasks: 0,
  chatUnread: 0, // neue Nachrichten in Akten (Chat)
  chatPolling: false,
  chatCaseId: null, // Akte, deren Chat gerade angezeigt wird
  appChatPolling: false,
  // Anliegen ans Board, Personalprotokoll
  concerns: null, // eigene Anliegen
  concernsAll: null, // alle Anliegen (Board of Partners)
  concernFilter: 'aktiv',
  concernGroup: 'alle',
  concernUnseen: 0,
  concernOpen: 0,
  modalConcernId: null,
  personnel: null,
  personnelNew: 0,
  // FiveNet
  fivenet: null,
  caseDocs: [],
  caseInfo: null,
  fnCheckToken: 0,
  fnPending: { urls: [], blobs: [] },
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const isStaff = () => !!st.user && (st.user.role === 'anwalt' || st.user.role === 'admin');
const isAdmin = () => !!st.user && st.user.role === 'admin';
/** Board of Partners (Founding/Equity Partner, Partner) – z. B. Auswertung der Aktenbearbeitung. */
const isBoard = () => !!st.user && !!st.user.board;
const badge = (text, color = 'gold') => `<span class="badge badge-${color}">${esc(text)}</span>`;
const statusBadge = (map, key) => badge(...(map[key] || [key, 'slate']));
// Offene Rechnung nach dem Fälligkeitsdatum
const overdueText = (i) => `${i.overdueDays} ${i.overdueDays === 1 ? 'Tag' : 'Tage'} überfällig`;
// kurz: Tabelle („Überfällig“, Tage als Tooltip und rotes Fälligkeitsdatum), sonst mit Anzahl der Tage
// Vom Mandanten als bezahlt gemeldet – die Kanzlei prüft den Eingang (Rechnung bleibt bis dahin offen)
const paymentReported = (i) => i.status === 'offen' && !!i.paymentReport;
const paymentReportTip = (i) =>
  `Gemeldet am ${fmtDate(i.paymentReport.at)}${i.paymentReport.note ? ` – „${i.paymentReport.note}“` : ''}${i.paymentReport.proof ? ' · mit Screenshot' : ''}${i.overdueDays > 0 ? ` · ${overdueText(i)}` : ''}`;
const invoiceBadge = (i, short = false) =>
  paymentReported(i)
    ? `<span class="badge badge-sky" title="${esc(paymentReportTip(i))}">${isStaff() ? 'Zahlung gemeldet' : 'Gemeldet – wird geprüft'}</span>`
    : i.overdueDays > 0
      ? short
        ? `<span class="badge badge-red" title="${esc(overdueText(i))}">Überfällig</span>`
        : badge(overdueText(i), 'red')
      : statusBadge(INVOICE_STATUS, i.status);
const opt = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

/** Auswahlliste der Ränge; ein veralteter Rang bleibt sichtbar, bis ein neuer gewählt wird. */
function rankSelect(name, current, { id = '', required = false, emptyLabel = '— kein Rang —', attrs = '' } = {}) {
  const legacy = current && !RANKS.includes(current) ? `<option value="${esc(current)}" selected disabled>${esc(current)} (nicht mehr vorhanden – bitte wählen)</option>` : '';
  const groups = Object.entries(RANK_GROUPS)
    .map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((r) => opt(r, r, r === current)).join('')}</optgroup>`)
    .join('');
  return `<select ${id ? `id="${id}"` : ''} name="${name}" class="field" ${required ? 'required' : ''} ${attrs}><option value="" ${!current ? 'selected' : ''} ${required ? 'disabled' : ''}>${esc(emptyLabel)}</option>${legacy}${groups}</select>`;
}

/* ---------------------------------------------------------------- Zuständige Anwälte (mehrere pro Akte) */
/** Federführender Anwalt zuerst, dann die weiteren. */
const caseTeam = (c) => [...(c.lawyerId ? [{ id: c.lawyerId, name: c.lawyerName || '—', lead: true }] : []), ...(c.coLawyers || []).map((l) => ({ ...l, lead: false }))];
/** Arbeitet der Benutzer an der Akte mit (federführend oder als weiterer Anwalt)? */
const onCase = (c, uid = st.user.id) => c.lawyerId === uid || (c.coLawyers || []).some((l) => l.id === uid);
function teamText(c) {
  const team = caseTeam(c);
  if (!team.length) return 'Noch nicht zugewiesen';
  return team.map((l) => (l.lead && team.length > 1 ? `${l.name} (federführend)` : l.name)).join(', ');
}

/**
 * Auswahl der zuständigen Anwälte. withLead: Auswahl des federführenden Anwalts (Board of Partners);
 * sonst ist leadId fest (z. B. man selbst) und nur weitere Anwälte werden gewählt.
 */
function lawyerPicker({ leadId = null, coIds = [], withLead = false, extra = [], leadLabel = 'Federführender Anwalt', emptyLead = 'Nicht zugewiesen' }) {
  const people = [...st.lawyers.map((l) => ({ id: l.id, name: l.displayName, rank: l.rank })), ...extra.filter((x) => !st.lawyers.some((l) => l.id === x.id))];
  const lead = withLead
    ? `<div class="span-2"><label class="label" for="teamLead">${esc(leadLabel)}</label><select id="teamLead" name="lawyerId" class="field">
          <option value="">${esc(emptyLead)}</option>${people.map((l) => opt(l.id, l.name + (l.rank ? ' · ' + l.rank : ''), l.id === leadId)).join('')}</select></div>`
    : '';
  const options = people
    .filter((l) => withLead || l.id !== leadId)
    .map(
      (l) => `<label class="check lawyer-opt"><input type="checkbox" name="coLawyerIds" value="${l.id}" ${coIds.includes(l.id) ? 'checked' : ''} ${withLead && l.id === leadId ? 'disabled' : ''}>
          <span>${esc(l.name)}${l.rank ? `<span class="block text-dim text-xs">${esc(l.rank)}</span>` : ''}</span></label>`
    )
    .join('');
  return `${lead}<div class="span-2" data-team><div class="label">Weitere Anwälte <span class="text-dim font-normal normal-case tracking-normal">– arbeiten mit und dürfen die Akte bearbeiten</span></div>
      ${options ? `<div class="lawyer-grid">${options}</div>` : '<p class="text-sm text-dim">Keine weiteren Anwälte im Team.</p>'}</div>`;
}
const empty = (text, ico = 'folder') => `<div class="empty">${icon(ico, 'ico-lg')}<p>${esc(text)}</p></div>`;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const byStart = (a, b) => parseDate(a.startsAt) - parseDate(b.startsAt);
const fmtPct = (n) => String(n).replace('.', ',');
const val = (fd, key) => String(fd.get(key) ?? '').trim();

/* Login-E-Mail: immer …@pake-scha.ls – im Formular wird nur der Teil vor dem @ eingegeben */
const EMAIL_DOMAIN = 'pake-scha.ls';
/** Vorschlag aus dem Namen: „Dr. Max Müller“ → „max.mueller“ */
const emailLocalFromName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\b(dr|prof|jur|med)\.?\s*/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
function emailField(name, { value = '', required = false, autofocus = false } = {}) {
  return `<div class="email-group"><input name="${name}" class="field" ${required ? 'required' : ''} maxlength="60" value="${esc(value)}" placeholder="vorname.nachname" autocapitalize="none" autocomplete="off" spellcheck="false" ${autofocus ? 'autofocus' : ''} aria-label="E-Mail vor dem @"><span class="email-suffix">@${EMAIL_DOMAIN}</span></div>`;
}

function toLocalInput(iso) {
  const d = parseDate(iso);
  return d ? `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
function fmtTime(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
}
function fmtDay(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function fmtDateOnly(s) {
  return s ? new Date(`${s}T12:00:00`).toLocaleDateString('de-DE') : '—';
}
function shortDate(v) {
  const d = parseDate(v);
  if (!d) return '';
  return dayKey(d) === dayKey(new Date()) ? fmtTime(v) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
function initials(name) {
  const words = String(name || '').replace(/\b(Dr|Prof|jur|med|rer|nat)\.\s*/gi, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
}
function avatarImg(url, name) {
  return url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(name));
}
function avatarInner(u) {
  return avatarImg(u?.avatarUrl, u?.displayName);
}
/** Profilbild mit optionalem Anwesenheitspunkt (Dienststatus). */
function avatarWrap(url, name, status, size = '') {
  return `<span class="avatar-wrap"><span class="avatar ${size}">${avatarImg(url, name)}</span>${status ? `<span class="presence s-${esc(status)}"></span>` : ''}</span>`;
}
const fmtHM = (min) => `${Math.floor(min / 60)} Std ${pad(Math.round(min % 60))} Min`;
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
function allowed(view) {
  const v = VIEWS[view];
  if (!v) return false;
  if (v.admin && !isAdmin()) return false;
  if (v.board && !isBoard()) return false;
  if (v.staff && !isStaff()) return false;
  if (v.client && isStaff()) return false; // nur für Mandanten (z. B. VIP & Lifetime anfragen)
  return true;
}
function viewLabel(view, short = false) {
  const v = VIEWS[view];
  if (!v) return '';
  if (!isStaff() && v.clientLabel) return v.clientLabel;
  return (short && v.short) || v.label;
}
/** Tage zwischen heute und einem Datum "YYYY-MM-DD" (negativ = Vergangenheit). */
function daysUntil(dateStr) {
  return Math.round((new Date(`${dateStr}T12:00:00`) - new Date(`${dayKey(new Date())}T12:00:00`)) / 864e5);
}
/** Fälligkeit einer Aufgabe / Wiedervorlage als farbiger Hinweis. */
function dueInfo(dateStr, done = false) {
  if (!dateStr) return null;
  if (done) return { text: fmtDateOnly(dateStr), cls: 'cd-dim' };
  const diff = daysUntil(dateStr);
  if (diff < 0) return { text: diff === -1 ? 'seit gestern fällig' : `seit ${-diff} Tagen fällig`, cls: 'cd-over' };
  if (diff === 0) return { text: 'heute fällig', cls: 'cd-amber' };
  if (diff === 1) return { text: 'morgen', cls: 'cd-green' };
  if (diff < 7) return { text: `in ${diff} Tagen`, cls: 'cd-green' };
  return { text: fmtDateOnly(dateStr), cls: 'cd-dim' };
}
/** "heute", "gestern", "vor 5 Tagen" */
function relDays(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const diff = -daysUntil(dayKey(d));
  if (diff <= 0) return 'heute';
  if (diff === 1) return 'gestern';
  return `vor ${diff} Tagen`;
}
/**
 * Dokument-ID aus einem FiveNet-Link (…/documents/1234), einer reinen Zahl oder einem
 * Google-Docs-/Sheets-Link (…/document/d/<ID>, …/spreadsheets/d/e/<ID>) – für die Aktensuche.
 */
function externalIdFrom(q) {
  const s = String(q).trim();
  const g = s.match(/\/(?:document|spreadsheets)\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{20,200})/i);
  if (g) return (g[1] ? 'e/' : '') + g[2];
  const m = s.match(/\/documents\/(\d{1,19})(?:[/?#]|$)/) || s.match(/^#?(\d{1,19})$/);
  return m ? m[1].replace(/^0+(?=\d)/, '') : null;
}

/* ---------------------------------------------------------------- Countdown */
function countdown(iso, overLabel) {
  const t = parseDate(iso);
  if (!t) return { text: '—', cls: 'cd-dim' };
  const diff = t.getTime() - Date.now();
  const abs = Math.abs(diff);
  const totalMin = Math.floor(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const d = Math.floor(h / 24);
  let text;
  if (d >= 2) text = `${d} Tage`;
  else if (d === 1) text = `1 Tag ${h - 24} Std`;
  else if (h >= 1) text = `${h} Std ${pad(totalMin % 60)} Min`;
  else text = `${pad(totalMin)}:${pad(Math.floor(abs / 1000) % 60)} Min`;
  if (diff < 0) return { text: `${overLabel} · ${text}`, cls: overLabel === 'überfällig' ? 'cd-over' : 'cd-dim' };
  return { text: `in ${text}`, cls: diff < 864e5 ? 'cd-red' : diff < 3 * 864e5 ? 'cd-amber' : 'cd-green' };
}
function countdownHtml(e) {
  const over = e.type === 'frist' ? 'überfällig' : 'vorbei';
  const c = countdown(e.startsAt, over);
  return `<span class="countdown ${c.cls}" data-countdown="${esc(e.startsAt)}" data-over="${over}">${esc(c.text)}</span>`;
}
function tickCountdowns() {
  $$('[data-countdown]').forEach((el) => {
    const c = countdown(el.dataset.countdown, el.dataset.over);
    if (el.textContent !== c.text) el.textContent = c.text;
    el.className = `countdown ${c.cls}`;
  });
  // Laufende Dienstzeit (Stempeluhr)
  $$('[data-countup]').forEach((el) => {
    const since = parseDate(el.dataset.countup);
    if (since) el.textContent = fmtElapsed(Date.now() - since.getTime());
  });
}
setInterval(tickCountdowns, 1000);

/* ================================================================
   Daten laden
   ================================================================ */
const load = {
  async cases() {
    st.cases = (await api.get('/api/cases')).cases;
  },
  async events() {
    st.events = (await api.get('/api/calendar')).events;
    st.events.forEach((e) => st.eventCache.set(e.id, e));
  },
  async invoices() {
    st.invoices = (await api.get('/api/invoices')).invoices;
  },
  async board() {
    if (isStaff()) st.board = (await api.get('/api/board')).notes;
  },
  async lawyers() {
    if (isStaff() && !st.lawyers.length) st.lawyers = (await api.get('/api/directory')).lawyers;
  },
  async contacts() {
    if (!st.contacts) st.contacts = (await api.get('/api/messages/contacts')).contacts;
  },
  async fees() {
    st.fees = (await api.get('/api/fees')).fees;
  },
  async unread() {
    st.unread = (await api.get('/api/messages/unread-count')).unread;
  },
  async messages() {
    st.messages = (await api.get('/api/messages?box=' + st.mailBox)).messages;
  },
  async duty() {
    if (isStaff()) {
      st.duty = await api.get('/api/duty');
    } else {
      const r = await api.get('/api/public/on-duty');
      st.duty = { me: null, onDuty: r.members || [] };
    }
  },
  /** Neue Nachrichten in Akten (Badge „Akten“ in der Navigation). */
  async chatUnread() {
    st.chatUnread = (await api.get('/api/cases/chat-unread')).total;
  },
  async appCount() {
    if (!isBoard()) return;
    const list = (await api.get('/api/admin/applications')).applications;
    // Badge „Bewerbungen“: neue Bewerbungen und ungelesene Nachrichten von Bewerbern
    st.newApplications = list.filter((a) => a.status === 'eingegangen').length + list.reduce((n, a) => n + (a.unreadMessages || 0), 0);
  },
  async tasks() {
    st.tasks = (await api.get(`/api/tasks?scope=${st.taskScope}&state=${st.taskState}`)).tasks;
  },
  async myTasks() {
    if (isStaff()) st.myTasks = (await api.get('/api/tasks?scope=mine')).tasks;
  },
  async dueTasks() {
    if (isStaff()) st.dueTasks = (await api.get('/api/tasks/due-count?today=' + dayKey(new Date()))).due;
  },
  /** Eigene Anliegen mit neuer Antwort; Board: offene Anliegen im Eingang. */
  async concernCount() {
    const c = await api.get('/api/concerns/counts');
    st.concernUnseen = c.unseen;
    st.concernOpen = c.open;
  },
  /** Board: offene Anträge auf Namensänderung */
  async nameCount() {
    if (isBoard()) st.nameOpen = (await api.get('/api/name-requests')).open;
  },
  /** Board: neue Mandantenstimmen (warten auf Freigabe) */
  async reviewCount() {
    if (isBoard()) st.reviewOpen = (await api.get('/api/reviews?status=neu')).open;
  },
  /** Kanzlei: vom Mandanten als bezahlt gemeldete Rechnungen */
  async paymentReports() {
    if (isStaff()) st.paymentReports = (await api.get('/api/invoices/payment-reports')).count;
  },
  /** Board: offene VIP-/Lifetime-Anfragen */
  async vipCount() {
    if (isBoard()) st.vipReqOpen = (await api.get('/api/memberships/requests')).open;
  },
  async personnelCount() {
    if (isStaff()) st.personnelNew = st.view === 'personnel' ? 0 : (await api.get('/api/personnel/counts')).unseen;
  },
  async fivenet(force = false) {
    if (isStaff() && (force || !st.fivenet)) st.fivenet = await api.get('/api/fivenet/status');
  },
};
