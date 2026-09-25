/*
 * Kanzlei-Dashboard (Single-Page): Navigation per #hash, Daten über /api/*.
 * Alle Nutzertexte laufen vor der Ausgabe per innerHTML durch esc().
 */
(() => {
  'use strict';
  const { api, esc, fmtDate, parseDate, money, copy, toast, resizeImage } = window.PS;
  /** Bestätigung im Kanzlei-Design (statt window.confirm). */
  const ask = (message, opts) => window.PS.confirm(message, opts);
  const askDelete = (title, message, confirmText = 'Löschen') => ask(message, { title, confirmText, danger: true });

  /* ================================================================
     Konstanten
     ================================================================ */
  const ROLES = { mandant: 'Mandant', anwalt: 'Anwalt', admin: 'Kanzleileitung' };
  const STEPS = ['Eingang', 'Akteneinsicht', 'Strategie', 'Verhandlung'];
  const AREAS = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
  const URGENCY = { normal: ['Normal', 'slate'], eilig: ['Eilig', 'amber'], notfall: ['Notfall', 'red'] };
  const CASE_STATUS = { offen: ['Offen', 'amber'], in_bearbeitung: ['In Bearbeitung', 'sky'], geschlossen: ['Geschlossen', 'slate'] };
  const SOURCES = { portal: 'Mandantenportal', web: 'Website-Formular', kanzlei: 'Kanzlei' };
  const EVENT_TYPES = { gericht: 'Gerichtstermin', frist: 'Frist', mandant: 'Mandantengespräch', intern: 'Intern' };
  const EVENT_COLORS = { mandant: '#34d399', gericht: '#d4af37', frist: '#f87171', intern: '#7dd3fc' };
  const EVENT_STATUS = { angefragt: ['Angefragt', 'amber'], bestaetigt: ['Bestätigt', 'emerald'], abgesagt: ['Abgesagt', 'slate'], erledigt: ['Erledigt', 'slate'] };
  const INVOICE_STATUS = { offen: ['Offen', 'amber'], bezahlt: ['Bezahlt', 'emerald'], storniert: ['Storniert', 'slate'] };
  const INVOICE_KIND = { rechnung: 'Rechnung', honorarvereinbarung: 'Honorarvereinbarung' };
  const FEE_CATEGORIES = { rechtsberatung: 'Rechtsberatung', strafrecht: 'Strafrecht & Haftvertretung', notfall: 'Notfall & Sofortdienst', gericht: 'Gerichtsverfahren', vertraege: 'Verträge & Dokumente' };
  const RANKS = ['Managing Partner', 'Managing Partner / Kanzleileitung', 'Founding Partner', 'Equity Partner', 'Partner', 'Senior Associate', 'Associate', 'Junior Associate'];
  const NOTE_COLORS = { gold: '#d4af37', blue: '#60a5fa', green: '#34d399', red: '#f87171', slate: '#94a3b8' };
  const DISCORD_MSG = {
    linked: ['Discord-Konto erfolgreich verbunden.', 'ok'],
    taken: ['Dieses Discord-Konto ist bereits mit einem anderen Website-Konto verbunden.', 'error'],
    denied: ['Die Verbindung mit Discord wurde abgebrochen.', 'error'],
    error: ['Die Discord-Verbindung ist fehlgeschlagen. Bitte erneut versuchen.', 'error'],
    state: ['Sicherheitsprüfung fehlgeschlagen – bitte die Verbindung erneut starten.', 'error'],
    disabled: ['Die Discord-Anbindung ist noch nicht eingerichtet.', 'error'],
    session: ['Bitte zuerst anmelden.', 'error'],
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
    trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    reply: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
    check: 'M5 13l4 4L19 7',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    copy: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
    briefcase: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    globe: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9',
    send: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
    external: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
    shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    tasks: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
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
    mail: { label: 'Kanzlei-Post', short: 'Post', icon: 'mail' },
    board: { label: 'Pinnwand', icon: 'pin', staff: true },
    invoices: { label: 'Rechnungen', icon: 'receipt' },
    duty: { label: 'Dienstzeiten', icon: 'clock', staff: true },
    team: { label: 'Team', icon: 'users', admin: true, section: 'Kanzleileitung' },
    applications: { label: 'Bewerbungen', icon: 'userAdd', admin: true, section: 'Kanzleileitung' },
    users: { label: 'Benutzer', icon: 'key', admin: true, section: 'Kanzleileitung' },
    fees: { label: 'Honorarordnung', icon: 'scale', admin: true, section: 'Kanzleileitung' },
    audit: { label: 'Protokoll', icon: 'list', admin: true, section: 'Kanzleileitung' },
    settings: { label: 'Einstellungen', icon: 'cog', admin: true, section: 'Kanzleileitung' },
    profile: { label: 'Mein Profil', short: 'Profil', icon: 'user', section: 'Konto' },
    'invoice-new': { label: 'Neues Dokument', icon: 'receipt', staff: true, hidden: true },
  };

  /* ================================================================
     Zustand & Helfer
     ================================================================ */
  const st = {
    user: null,
    view: 'overview',
    navToken: 0,
    cases: [],
    events: [],
    eventCache: new Map(),
    invoices: [],
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
    userFilter: 'alle',
    userQuery: '',
    invFilter: 'alle',
    cal: { month: null, selected: null, types: { gericht: true, frist: true, mandant: true, intern: true } },
    draft: null,
    modalCaseId: null,
    returnCase: null,
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
  const badge = (text, color = 'gold') => `<span class="badge badge-${color}">${esc(text)}</span>`;
  const statusBadge = (map, key) => badge(...(map[key] || [key, 'slate']));
  const opt = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  const empty = (text, ico = 'folder') => `<div class="empty">${icon(ico, 'ico-lg')}<p>${esc(text)}</p></div>`;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const byStart = (a, b) => parseDate(a.startsAt) - parseDate(b.startsAt);
  const fmtPct = (n) => String(n).replace('.', ',');
  const val = (fd, key) => String(fd.get(key) ?? '').trim();

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
    if (v.staff && !isStaff()) return false;
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
   * Google-Docs-Link (…/document/d/<ID>, …/document/d/e/<ID>) – für die Aktensuche.
   */
  function externalIdFrom(q) {
    const s = String(q).trim();
    const g = s.match(/\/document\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{20,200})/i);
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
    async appCount() {
      if (!isAdmin()) return;
      const list = (await api.get('/api/admin/applications')).applications;
      st.newApplications = list.filter((a) => a.status === 'eingegangen').length;
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
    async fivenet(force = false) {
      if (isStaff() && (force || !st.fivenet)) st.fivenet = await api.get('/api/fivenet/status');
    },
  };

  /* ================================================================
     Grundgerüst: Navigation, Dialog, Routing
     ================================================================ */
  function renderNav() {
    let html = '';
    let section = null;
    for (const [key, v] of Object.entries(VIEWS)) {
      if (v.hidden || !allowed(key)) continue;
      if (v.section && v.section !== section) {
        section = v.section;
        html += `<div class="nav-section">${esc(section)}</div>`;
      }
      const count = key === 'mail' ? st.unread : key === 'applications' ? st.newApplications : key === 'tasks' ? st.dueTasks : 0;
      const active = st.view === key || (key === 'invoices' && st.view === 'invoice-new');
      html += `<a href="#${key}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${esc(viewLabel(key))}</span>${count ? `<span class="nav-count">${count > 99 ? '99+' : count}</span>` : ''}</a>`;
    }
    $('#nav').innerHTML = html;

    const bottom = ['overview', 'cases', 'calendar', 'mail'];
    $('#bottomNav').innerHTML =
      bottom
        .map(
          (k) =>
            `<a href="#${k}" class="bn-item ${st.view === k ? 'active' : ''}">${icon(VIEWS[k].icon)}<span>${esc(viewLabel(k, true))}</span>${k === 'mail' && st.unread ? `<span class="dot-badge">${st.unread > 99 ? '99+' : st.unread}</span>` : ''}</a>`
        )
        .join('') + `<button type="button" class="bn-item" data-action="open-sidebar">${icon('more')}<span>Mehr</span></button>`;

    const mailBadge = $('#topMailBadge');
    mailBadge.textContent = st.unread > 99 ? '99+' : String(st.unread);
    mailBadge.classList.toggle('hidden', !st.unread);
    $('#pageTitle').textContent = viewLabel(st.view);
    document.title = `${viewLabel(st.view)} | Pake & Scha`;
  }

  function myDutyStatus() {
    return st.duty?.me?.status || 'off';
  }

  function renderUser() {
    const u = st.user;
    $('#userCard').innerHTML = `${avatarWrap(u.avatarUrl, u.displayName, isStaff() ? myDutyStatus() : null)}
      <div class="meta"><div class="name">${esc(u.displayName)}</div><div class="role">${esc(u.rank || ROLES[u.role] || '')}</div></div>
      <button class="icon-btn sm" data-action="logout" title="Abmelden" aria-label="Abmelden">${icon('logout', 'ico-sm')}</button>`;
    $('#topAvatar').innerHTML = avatarInner(u);
    renderDutyBtn();
  }

  /* ---------------------------------------------------------------- Dienststatus (Kopfzeile) */
  function renderDutyBtn() {
    const wrap = $('#dutyWrap');
    if (!isStaff()) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const s = myDutyStatus();
    const btn = $('#dutyBtn');
    btn.classList.toggle('on', s !== 'off');
    btn.innerHTML = `<span class="duty-dot s-${s}"></span><span class="lbl">${esc(DUTY[s])}</span>`;
  }
  function openDutyPop() {
    const s = myDutyStatus();
    $('#dutyPop').innerHTML =
      Object.entries(DUTY)
        .map(([k, l]) => `<button type="button" class="pop-item ${s === k ? 'active' : ''}" role="menuitem" data-action="duty-set" data-status="${k}"><span class="duty-dot s-${k}"></span>${esc(l)}${s === k ? '<span class="ml-auto text-xs">✓</span>' : ''}</button>`)
        .join('') + '<div class="pop-note"><a href="#duty" class="text-xs text-gold hover:underline">Stempeluhr & Dienstzeiten →</a></div>';
    $('#dutyPop').classList.add('open');
    $('#dutyBtn').setAttribute('aria-expanded', 'true');
  }
  function closeDutyPop() {
    $('#dutyPop').classList.remove('open');
    $('#dutyBtn').setAttribute('aria-expanded', 'false');
  }
  async function setDutyStatus(status, note) {
    const before = myDutyStatus();
    const body = { status };
    if (note !== undefined) body.note = note;
    st.duty = await api.post('/api/duty', body);
    closeDutyPop();
    renderUser();
    if (status === 'off') toast(before === 'off' ? 'Sie sind außer Dienst.' : 'Dienst beendet – gute Erholung!');
    else if (before === 'off') toast(`Dienst begonnen – Status: ${DUTY[status]}.`);
    else toast(`Status: ${DUTY[status]}`);
    if (st.view === 'duty') await refreshBehind();
    else if (st.view === 'overview') renderView();
  }

  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebarBackdrop').classList.add('show');
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');
  }

  function openModal(html, { wide = false } = {}) {
    $('#modalBody').innerHTML = html;
    $('#modalCard').classList.toggle('wide', wide);
    const modal = $('#modal');
    modal.classList.add('open');
    modal.scrollTop = 0;
    $('#modalBody').scrollTop = 0;
    document.body.classList.add('modal-open');
    tickCountdowns();
    const focusTarget = $('#modalBody [autofocus]');
    if (focusTarget && window.matchMedia('(min-width: 768px)').matches) focusTarget.focus();
  }
  function replaceModal(html) {
    const body = $('#modalBody');
    const modal = $('#modal');
    const y1 = body.scrollTop;
    const y2 = modal.scrollTop;
    body.innerHTML = html;
    body.scrollTop = y1;
    modal.scrollTop = y2;
    tickCountdowns();
  }
  function closeModal() {
    const modal = $('#modal');
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    $('#modalBody').innerHTML = '';
    document.body.classList.remove('modal-open');
    st.modalCaseId = null;
    st.modalAppId = null;
  }

  const loadingHtml = () =>
    `<div class="stack">${'<div class="panel panel-pad"><div class="skeleton" style="width:40%"></div><div class="skeleton mt-4"></div><div class="skeleton mt-3" style="width:70%"></div></div>'.repeat(2)}</div>`;
  const errorHtml = (msg) =>
    `<div class="panel">${empty(msg || 'Daten konnten nicht geladen werden.', 'alert')}<div class="text-center pb-6"><button class="btn-outline btn-md" data-action="reload-view">Erneut versuchen</button></div></div>`;

  function handleError(e) {
    if (e && e.status === 401) {
      location.href = '/login.html?next=' + encodeURIComponent('/dashboard.html' + location.hash);
      return;
    }
    toast(e?.message || 'Unbekannter Fehler.', 'error');
  }
  async function guard(fn) {
    try {
      await fn();
    } catch (e) {
      handleError(e);
    }
  }

  const hashView = () => decodeURIComponent(location.hash.slice(1)) || 'overview';

  async function go(view) {
    if (!allowed(view)) view = 'overview';
    st.view = view;
    closeModal();
    closeSidebar();
    closeDutyPop();
    renderNav();
    const content = $('#content');
    content.innerHTML = loadingHtml();
    window.scrollTo(0, 0);
    const token = ++st.navToken;
    try {
      if (views[view].load) await views[view].load();
    } catch (e) {
      if (token !== st.navToken) return;
      handleError(e);
      content.innerHTML = errorHtml(e.message);
      return;
    }
    if (token !== st.navToken) return;
    renderView();
  }
  function renderView() {
    $('#content').innerHTML = views[st.view].render();
    renderNav();
    tickCountdowns();
  }
  function navigate(view) {
    if (location.hash !== '#' + view) history.pushState(null, '', '#' + view);
    return go(view);
  }
  /** Lädt die Daten der aktuellen Ansicht neu, ohne einen offenen Dialog zu schließen. */
  async function refreshBehind() {
    try {
      if (views[st.view].load) await views[st.view].load();
      renderView();
    } catch (e) {
      handleError(e);
    }
  }
  /** Nach Unterdialogen aus einer Akte heraus zurück zur Akte springen. */
  async function returnOrClose() {
    const caseId = st.returnCase;
    st.returnCase = null;
    if (caseId) await openCase(caseId);
    else closeModal();
    refreshBehind();
  }

  function showCredentials(cred, name) {
    const text = `Login: ${location.origin}/login.html\nE-Mail: ${cred.email}\nEinmal-Passwort: ${cred.password}`;
    openModal(`
      <h2 class="modal-title">Zugangsdaten${name ? ' für ' + esc(name) : ''}</h2>
      <p class="modal-sub">Das Einmal-Passwort wird <strong>nur jetzt</strong> angezeigt. Bitte sicher weitergeben (z. B. per Discord-Direktnachricht). Beim ersten Login wird zum Ändern aufgefordert.</p>
      <div class="form-grid">
        <div><div class="label">E-Mail / Login</div><div class="secret-box">${esc(cred.email)}</div></div>
        <div><div class="label">Einmal-Passwort</div><div class="secret-box">${esc(cred.password)}</div></div>
        <div class="form-actions">
          <button class="btn-gold btn-md" data-action="copy" data-text="${esc(text)}">${icon('copy')}<span>Zugangsdaten kopieren</span></button>
          <button class="btn-ghost btn-md" data-action="close-modal">Fertig</button>
        </div>
      </div>`);
  }

  /* ================================================================
     Ansichten
     ================================================================ */
  const views = {};

  /* ---------------------------------------------------------------- Übersicht */
  function upcomingEvents(limit = 6) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return st.events
      .filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff))
      .sort(byStart)
      .slice(0, limit);
  }

  function eventRow(e, { date = true } = {}) {
    const closed = e.status === 'erledigt' || e.status === 'abgesagt';
    const side = closed ? statusBadge(EVENT_STATUS, e.status) : `${e.status === 'angefragt' ? badge('Anfrage', 'amber') : ''}${countdownHtml(e)}`;
    const meta = [EVENT_TYPES[e.type], `${date ? fmtDay(e.startsAt) + ', ' : ''}${fmtTime(e.startsAt)} Uhr`, e.caseNumber, isStaff() ? e.assignedName : null]
      .filter(Boolean)
      .map(esc)
      .join(' · ');
    return `<button type="button" class="ev-row ${closed ? 'ev-done' : ''}" data-action="open-event" data-id="${e.id}">
      <span class="ev-bar ev-bg-${esc(e.type)}"></span>
      <span class="ev-main"><span class="ev-title">${esc(e.title)}</span><span class="ev-meta">${meta}</span></span>
      <span class="ev-side">${side}</span></button>`;
  }

  function caseListRow(c, extra = '') {
    return `<div class="list-row" data-action="open-case" data-id="${c.id}" role="button" tabindex="0">
      <div class="main"><div class="title">${esc(c.title)}</div>
        <div class="meta"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.clientName)}${c.urgency !== 'normal' ? ' · ' + esc(URGENCY[c.urgency][0]) : ''}</div></div>
      <div class="flex items-center gap-2 shrink-0">${extra || statusBadge(CASE_STATUS, c.status)}</div></div>`;
  }

  function kpi(label, value, sub, ico, href) {
    return `<a href="${href}" class="panel kpi block">
      <div class="kpi-label">${icon(ico, 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></a>`;
  }
  function kpiEvent(label, e) {
    if (!e) {
      return `<a href="#calendar" class="panel kpi block"><div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
        <div class="kpi-value" style="color:var(--text-dim)">—</div><div class="kpi-sub">Nichts geplant</div></a>`;
    }
    return `<button type="button" class="panel kpi block w-full text-left" data-action="open-event" data-id="${e.id}">
      <div class="kpi-label">${icon('clock', 'ico-sm')}${esc(label)}</div>
      <div class="kpi-value" style="font-size:clamp(1.15rem,3.4vw,1.55rem)">${esc(e.title)}</div>
      <div class="kpi-sub">${esc(fmtDay(e.startsAt))}, ${esc(fmtTime(e.startsAt))} Uhr</div>${countdownHtml(e)}</button>`;
  }

  function dutyStrip() {
    const list = st.duty?.onDuty || [];
    if (!isStaff()) {
      return list.length
        ? `<div class="banner banner-gold items-center"><span class="duty-dot s-dienst"></span><div>Die Kanzlei ist gerade erreichbar: <strong>${list.length} ${list.length === 1 ? 'Anwalt' : 'Anwälte'} im Dienst</strong>.</div></div>`
        : '';
    }
    return `<section class="panel duty-strip">
      <span class="text-[0.7rem] uppercase tracking-widest text-dim">Jetzt im Dienst</span>
      ${list.length
        ? list.map((m) => `<span class="duty-chip">${avatarWrap(m.avatarUrl, m.name, m.status, 'xs')}<span>${esc(m.name)}</span><span class="st">${esc(m.statusLabel)}</span></span>`).join('')
        : '<span class="text-sm text-dim">Niemand – der Eilnotdienst ist gerade nicht besetzt.</span>'}
      <span class="ml-auto flex gap-2">${myDutyStatus() === 'off'
        ? `<button class="btn-gold btn-sm" data-action="duty-set" data-status="dienst"><span class="duty-dot s-dienst"></span><span>Dienst beginnen</span></button>`
        : `<button class="btn-outline btn-sm" data-action="duty-set" data-status="off">Dienst beenden</button>`}</span>
    </section>`;
  }

  /** Überfällige/heute fällige eigene Aufgaben und eigene Akten ohne Bewegung – nur wenn es etwas zu tun gibt. */
  const STALE_DAYS = 7;
  function attentionPanel() {
    const me = st.user.id;
    const overdue = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0);
    const today = st.myTasks.filter((t) => t.dueDate && daysUntil(t.dueDate) === 0);
    const stale = st.cases.filter((c) => {
      const d = parseDate(c.updatedAt);
      return c.status === 'in_bearbeitung' && c.lawyerId === me && d && -daysUntil(dayKey(d)) >= STALE_DAYS;
    });
    if (!overdue.length && !today.length && !stale.length) return '';
    const due = [...overdue, ...today];
    return `<section class="panel panel-pad attention mb-4 lg:mb-5">
      <div class="panel-head"><h2 class="panel-title">Handlungsbedarf</h2>
        <div class="flex flex-wrap gap-2">${overdue.length ? badge(`${overdue.length} überfällig`, 'red') : ''}${today.length ? badge(`${today.length} heute fällig`, 'amber') : ''}${stale.length ? badge(`${stale.length} ruhende Akte${stale.length === 1 ? '' : 'n'}`, 'slate') : ''}</div></div>
      ${due.length ? `<div class="task-list">${due.slice(0, 5).map((t) => taskItem(t)).join('')}</div>` : ''}
      ${due.length > 5 ? `<a href="#tasks" class="btn-ghost btn-sm mt-2">Alle ${due.length} fälligen Aufgaben anzeigen</a>` : ''}
      ${stale.length ? `<div class="${due.length ? 'mt-4' : ''}"><div class="text-xs uppercase tracking-widest text-dim mb-1">Ihre Akten seit ${STALE_DAYS}+ Tagen ohne Bewegung</div>
        ${stale.slice(0, 4).map((c) => caseListRow(c, badge(relDays(c.updatedAt), 'slate'))).join('')}</div>` : ''}
    </section>`;
  }

  views.overview = {
    async load() {
      await Promise.all([load.cases(), load.events(), load.invoices(), load.board(), load.unread(), load.duty(), load.myTasks()]);
    },
    render() {
      const u = st.user;
      const staff = isStaff();
      const hour = new Date().getHours();
      const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
      const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const active = st.cases.filter((c) => c.status !== 'geschlossen');
      const upcoming = upcomingEvents(6);
      const nextDeadline = upcomingEvents(50).find((e) => e.status === 'bestaetigt' && (e.type === 'frist' || e.type === 'gericht'));
      const openInvoices = st.invoices.filter((i) => i.status === 'offen');
      const openSum = openInvoices.reduce((s, i) => s + i.total, 0);

      const banner = u.mustChangePassword
        ? `<div class="banner banner-amber">${icon('alert')}<div><strong>Bitte eigenes Passwort festlegen.</strong> Sie nutzen ein automatisch erzeugtes oder zurückgesetztes Passwort. <a href="#profile" class="underline">Jetzt ändern</a></div></div>`
        : '';

      const kpis = staff
        ? [
            kpi('Neue Anfragen', active.filter((c) => c.status === 'offen').length, `${active.filter((c) => !c.lawyerId).length} ohne Anwalt`, 'folder', '#cases'),
            kpi('In Bearbeitung', active.filter((c) => c.status === 'in_bearbeitung').length, `${active.filter((c) => c.lawyerId === u.id).length} davon bei Ihnen`, 'briefcase', '#cases'),
            kpiEvent('Nächste Frist / Termin', nextDeadline),
            kpi('Kanzlei-Post', st.unread, st.unread === 1 ? 'ungelesene Nachricht' : 'ungelesene Nachrichten', 'mail', '#mail'),
          ]
        : [
            kpi('Meine Akten', active.length, 'laufende Mandate', 'folder', '#cases'),
            kpiEvent('Nächster Termin', upcoming[0]),
            kpi('Kanzlei-Post', st.unread, 'ungelesen', 'mail', '#mail'),
            kpi('Offene Rechnungen', money(openSum), `${openInvoices.length} Dokument(e)`, 'receipt', '#invoices'),
          ];

      const eventsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Fristen & Termine' : 'Ihre Termine'}</h2><a href="#calendar" class="btn-ghost btn-sm">Alle anzeigen</a></div>
          ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : empty('Keine anstehenden Termine.', 'calendar')}
        </section>`;

      const recent = st.cases.slice(0, 5);
      const recentPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">${staff ? 'Zuletzt bearbeitet' : 'Meine Akten'}</h2><a href="#cases" class="btn-ghost btn-sm">Alle Akten</a></div>
          ${recent.length ? recent.map((c) => caseListRow(c)).join('') : empty(staff ? 'Noch keine Akten.' : 'Sie haben noch kein Mandat eingereicht.', 'folder')}
          ${!staff ? `<div class="form-actions mt-4"><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Mandat einreichen</span></button><button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button><button class="btn-outline btn-md" data-action="compose">${icon('mail', 'ico-sm')}<span>Nachricht an die Kanzlei</span></button></div>` : ''}
        </section>`;

      const head = `
        ${banner}
        <div class="page-head">
          <div><p class="text-xs uppercase tracking-[0.2em] text-gold mb-1">${esc(today)}</p>
            <h1 class="page-title">${esc(greet)}, ${esc(u.displayName)}</h1>
            <p class="page-sub">${esc(u.rank || ROLES[u.role])} · Pake &amp; Scha Legal Consulting</p></div>
          ${staff ? `<div class="page-actions"><button class="btn-outline btn-md" data-action="new-event">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>Neue Akte</span></button></div>` : ''}
        </div>
        ${dutyStrip()}
        <div class="kpi-grid">${kpis.join('')}</div>`;

      if (!staff) return `${head}<div class="grid-2">${eventsPanel}${recentPanel}</div>`;

      const unassigned = active.filter((c) => !c.lawyerId).slice(0, 5);
      const pinned = st.board.filter((n) => n.pinned).slice(0, 3);
      const requestsPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Neue Mandatsanfragen</h2>${unassigned.length ? badge(`${unassigned.length} offen`, 'amber') : ''}</div>
          ${unassigned.length ? unassigned.map((c) => caseListRow(c, `<button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Übernehmen</button>`)).join('') : empty('Alle Anfragen sind vergeben.', 'check')}
        </section>`;
      const boardPanel = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Pinnwand</h2><a href="#board" class="btn-ghost btn-sm">Zur Pinnwand</a></div>
          ${pinned.length ? pinned.map((n) => `<div class="tl-item mb-2" style="border-left:3px solid ${NOTE_COLORS[n.color] || NOTE_COLORS.gold}"><div class="tl-meta"><strong class="text-muted">${esc(n.title || 'Notiz')}</strong> · ${esc(n.authorName)}</div><div class="tl-body">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div></div>`).join('') : empty('Keine angehefteten Notizen.', 'pin')}
        </section>`;

      return `${head}
        ${attentionPanel()}
        <div class="grid-2">${eventsPanel}${requestsPanel}</div>
        <div class="grid-2 mt-4 lg:mt-5">${recentPanel}${boardPanel}</div>`;
    },
  };

  /* ---------------------------------------------------------------- Akten */
  function filteredCases() {
    const q = st.caseQuery.trim().toLowerCase();
    // Ein eingefügter FiveNet-/Google-Docs-Link oder eine Dokument-ID findet die Akten, mit denen das Dokument verknüpft ist.
    const extId = q ? externalIdFrom(st.caseQuery) : null;
    return st.cases.filter((c) => {
      const f = st.caseFilter;
      const stateOk = f === 'alle' || (f === 'aktiv' ? c.status !== 'geschlossen' : c.status === f);
      const mineOk = !st.caseMine || c.lawyerId === st.user.id;
      const textOk =
        !q ||
        [c.caseNumber, c.title, c.clientName, c.lawyerName, c.courtRef, c.opponent].join(' ').toLowerCase().includes(q) ||
        (!!extId && (c.externalDocIds || []).includes(extId));
      return stateOk && mineOk && textOk;
    });
  }
  function caseCount(f) {
    return st.cases.filter((c) => f === 'alle' || (f === 'aktiv' ? c.status !== 'geschlossen' : c.status === f)).length;
  }
  function caseTable() {
    const rows = filteredCases();
    const staff = isStaff();
    if (!rows.length) {
      return empty(st.cases.length ? 'Keine Akten für diese Auswahl.' : staff ? 'Noch keine Akten angelegt.' : 'Sie haben noch kein Mandat eingereicht.', 'folder');
    }
    return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Akte</th>${staff ? '<th>Mandant</th>' : ''}<th>Zuständig</th><th>Status</th><th>Aktualisiert</th></tr></thead>
      <tbody>${rows
        .map(
          (c) => `<tr class="row" data-action="open-case" data-id="${c.id}">
          <td class="td-main"><div class="font-mono text-gold text-xs">${esc(c.caseNumber)}</div><div class="font-medium">${esc(c.title)}</div>
            <div class="text-xs text-dim mt-1 flex flex-wrap items-center gap-2">${esc(AREAS[c.area] || c.area)}${c.urgency !== 'normal' ? badge(...URGENCY[c.urgency]) : ''}</div></td>
          ${staff ? `<td data-label="Mandant">${esc(c.clientName)}</td>` : ''}
          <td data-label="Zuständig">${c.lawyerName ? esc(c.lawyerName) : badge('Unbesetzt', 'amber')}</td>
          <td data-label="Status">${statusBadge(CASE_STATUS, c.status)}</td>
          <td data-label="Aktualisiert" class="text-dim text-xs nowrap">${esc(fmtDate(c.updatedAt))}</td></tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  views.cases = {
    async load() {
      await Promise.all([load.cases(), load.lawyers()]);
    },
    render() {
      const staff = isStaff();
      const filters = [['aktiv', 'Aktiv'], ['offen', 'Offen'], ['in_bearbeitung', 'In Bearbeitung'], ['geschlossen', 'Geschlossen'], ['alle', 'Alle']];
      return `
        <div class="page-head">
          <div><h1 class="page-title">${staff ? 'Aktenverwaltung' : 'Meine Akten'}</h1>
            <p class="page-sub">${staff ? 'Alle Mandate der Kanzlei – Aktenzeichen, Mandanten, Status, Notizen und Verlauf.' : 'Ihre Mandate bei Pake & Scha. Tippen Sie auf eine Akte für Details.'}</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="new-case">${icon('plus')}<span>${staff ? 'Neue Akte' : 'Mandat einreichen'}</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="caseSearch" class="field" type="search" placeholder="${staff ? 'Aktenzeichen, Mandant, FiveNet-/Docs-Link …' : 'Aktenzeichen, Titel …'}" value="${esc(st.caseQuery)}" aria-label="Akten durchsuchen"></label>
          <div class="chip-row">
            ${filters.map(([k, l]) => `<button class="chip ${st.caseFilter === k ? 'active' : ''}" data-action="case-filter" data-value="${k}">${l} <span class="chip-count">${caseCount(k)}</span></button>`).join('')}
            ${staff ? `<button class="chip ${st.caseMine ? 'active' : ''}" data-action="case-mine">${icon('user', 'ico-sm')}Nur meine</button>` : ''}
          </div>
        </div>
        <div id="caseList" class="panel p-2 md:p-3">${caseTable()}</div>`;
    },
  };

  /* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen (Übersicht) */
  function filteredTasks() {
    const q = st.taskQuery.trim().toLowerCase();
    return st.tasks.filter((t) => !q || [t.title, t.note, t.caseNumber, t.caseTitle, t.assignedName].join(' ').toLowerCase().includes(q));
  }
  function taskList() {
    const list = filteredTasks();
    if (!list.length) {
      const msg = st.tasks.length
        ? 'Keine Aufgaben für diese Suche.'
        : st.taskState === 'done'
          ? 'Noch keine erledigten Aufgaben.'
          : st.taskScope === 'mine'
            ? 'Keine offenen Aufgaben – alles erledigt.'
            : 'Keine offenen Aufgaben im Team.';
      return empty(msg, 'tasks');
    }
    if (st.taskState === 'done') return `<div class="task-list">${list.map((t) => taskItem(t)).join('')}</div>`;
    const bucket = (t) => {
      if (!t.dueDate) return 'none';
      const d = daysUntil(t.dueDate);
      return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
    };
    const groups = [['overdue', 'Überfällig'], ['today', 'Heute'], ['week', 'Nächste 7 Tage'], ['later', 'Später'], ['none', 'Ohne Datum']];
    return groups
      .map(([key, label]) => {
        const items = list.filter((t) => bucket(t) === key);
        if (!items.length) return '';
        return `<h3 class="task-group ${key === 'overdue' ? 'is-overdue' : ''}">${esc(label)} <span>${items.length}</span></h3><div class="task-list">${items.map((t) => taskItem(t)).join('')}</div>`;
      })
      .join('');
  }

  views.tasks = {
    async load() {
      await Promise.all([load.tasks(), load.lawyers(), load.cases(), load.dueTasks()]);
    },
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Aufgaben & Wiedervorlagen</h1>
            <p class="page-sub">Was ist zu tun, bis wann und von wem – mit oder ohne Aktenbezug. Fällige Aufgaben erscheinen in der Übersicht unter „Handlungsbedarf“.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="task-new">${icon('plus')}<span>Neue Aufgabe</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="taskSearch" class="field" type="search" placeholder="Aufgabe, Aktenzeichen, Person …" value="${esc(st.taskQuery)}" aria-label="Aufgaben durchsuchen"></label>
          <div class="chip-row">
            <button class="chip ${st.taskScope === 'mine' ? 'active' : ''}" data-action="task-scope" data-value="mine">${icon('user', 'ico-sm')}Meine</button>
            <button class="chip ${st.taskScope === 'all' ? 'active' : ''}" data-action="task-scope" data-value="all">${icon('users', 'ico-sm')}Ganzes Team</button>
            <button class="chip ${st.taskState === 'open' ? 'active' : ''}" data-action="task-state" data-value="open">Offen</button>
            <button class="chip ${st.taskState === 'done' ? 'active' : ''}" data-action="task-state" data-value="done">Erledigt</button>
          </div>
        </div>
        <div id="taskList" class="panel panel-pad">${taskList()}</div>`;
    },
  };

  function rememberCase(data) {
    (data.appointments || []).forEach((e) => st.eventCache.set(e.id, e));
    st.caseAttachments = data.attachments || [];
    st.caseDocs = data.externalDocs || [];
    st.caseTasks = data.tasks || [];
    st.caseInfo = data.case;
  }
  async function openCase(id) {
    await load.lawyers();
    const data = await api.get('/api/cases/' + id);
    rememberCase(data);
    st.modalCaseId = id;
    openModal(caseDetail(data), { wide: true });
  }
  async function reloadCase(id) {
    const data = await api.get('/api/cases/' + id);
    rememberCase(data);
    if (st.modalCaseId === id) replaceModal(caseDetail(data));
    refreshBehind();
  }

  function attachmentsSection(c, attachments) {
    const staff = isStaff();
    const canUpload = staff || !c.closed;
    return `<div class="section" id="secEvidence">
      <h3 class="section-title">Beweismittel & Anhänge <span class="text-xs text-dim font-normal" style="font-family:Inter,sans-serif">${attachments.length} / 40</span></h3>
      ${canUpload ? `<div class="flex flex-wrap items-center gap-3 mb-3">
          <input id="attCaption" class="field" style="max-width:340px" maxlength="200" placeholder="Beschreibung für neue Bilder (optional)" aria-label="Beschreibung für neue Bilder">
          ${staff ? '<label class="check"><input type="checkbox" id="attInternal" checked> Nur intern (für den Mandanten unsichtbar)</label>' : ''}
        </div>` : ''}
      <div class="att-grid">
        ${attachments
          .map(
            (a, i) => `<button type="button" class="att" data-action="att-open" data-index="${i}" aria-label="${esc(a.caption || 'Anhang ansehen')}">
              <img src="${esc(a.url)}" alt="${esc(a.caption)}" loading="lazy">
              <span class="tag">${a.internal ? badge('intern', 'amber') : ''}${a.externalDocId ? badge(st.caseDocs.find((d) => d.id === a.externalDocId)?.provider === 'gdocs' ? 'Google Docs' : 'FiveNet', 'sky') : ''}</span>${a.caption ? `<span class="cap">${esc(a.caption)}</span>` : ''}</button>`
          )
          .join('')}
        ${canUpload && attachments.length < 40
          ? `<label class="att-add file-btn">${icon('camera')}<span>Bilder hinzufügen</span><input type="file" accept="image/*" multiple data-upload="evidence" data-case-id="${c.id}" aria-label="Bilder hinzufügen"></label>`
          : ''}
      </div>
      ${!attachments.length && !canUpload ? '<p class="text-sm text-dim">Keine Anhänge.</p>' : ''}
    </div>`;
  }

  /* ---------------------------------------------------------------- Aktenübersicht (Kennzahlen im Aktenkopf) */
  function caseStats(c, { appointments, attachments, externalDocs, tasks }) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const next = appointments
      .filter((e) => (e.status === 'bestaetigt' || e.status === 'angefragt') && (e.type === 'frist' || parseDate(e.startsAt) >= cutoff))
      .sort(byStart)[0];
    const open = tasks.filter((t) => !t.done);
    const overdue = open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0).length;
    const pill = (label, value, target, extra = '') =>
      `<button type="button" class="stat-pill" data-action="scroll-to" data-target="${target}"><span class="k">${esc(label)}</span><span class="v">${value}</span>${extra}</button>`;
    return `<div class="case-stats mb-5">
      ${pill('Nächste Frist / Termin', next ? esc(next.title) : '<span class="text-dim">keine</span>', 'secEvents', next ? countdownHtml(next) : '')}
      ${pill('Aufgaben', open.length ? `${open.length} offen` : '<span class="text-dim">keine offen</span>', 'secTasks', overdue ? `<span class="countdown cd-over">${overdue} überfällig</span>` : '')}
      ${pill('Externe Dokumente', String(externalDocs.length), 'secExternal')}
      ${pill('Beweismittel', String(attachments.length), 'secEvidence')}
      ${pill('Letzte Aktivität', esc(relDays(c.updatedAt)), 'secNotes')}
    </div>`;
  }

  /* ---------------------------------------------------------------- Externe Dokumente (FiveNet & Google Docs) */
  const EXT = {
    fivenet: { name: 'FiveNet', noun: 'FiveNet-Dokument', badgeCls: 'fn-badge', inputId: 'fnInput' },
    gdocs: { name: 'Google Docs', noun: 'Google-Docs-Dokument', badgeCls: 'fn-badge gd', inputId: 'gdInput' },
  };
  const extOf = (d) => EXT[d.provider] || EXT.fivenet;
  const extUrl = (caseId, linkId = null, suffix = '') => `/api/cases/${caseId}/external${linkId ? '/' + linkId : ''}${suffix}`;

  function externalDocCard(d, c) {
    const staff = isStaff();
    const p = extOf(d);
    const gd = d.provider === 'gdocs';
    const canManage = staff && (d.linkedById === st.user.id || c.canEdit);
    const meta = [
      d.docType,
      gd ? (d.documentId.startsWith('e/') ? 'im Web veröffentlicht' : null) : `Dokument-ID ${d.documentId}`,
      d.docDate ? `erstellt ${fmtDateOnly(d.docDate)}` : null,
      d.docAuthor || null,
    ]
      .filter(Boolean)
      .map(esc)
      .join(' · ');
    const images = st.caseAttachments.map((a, i) => ({ a, i })).filter(({ a }) => a.externalDocId === d.id);
    const content = d.contentText
      ? `<details class="fn-text"><summary>${icon('doc', 'ico-sm')}<span>Abschrift anzeigen</span><span class="text-dim text-xs">${d.contentText.length.toLocaleString('de-DE')} Zeichen · Stand ${esc(fmtDate(d.contentAt))}${d.contentByName ? ' · ' + esc(d.contentByName) : ''}</span></summary>
          <div class="fn-pre">${esc(d.contentText)}</div>
          <div class="fn-actions"><button type="button" class="btn-ghost btn-sm" data-action="fn-copy-text" data-id="${d.id}">${icon('copy', 'ico-sm')}<span>Text kopieren</span></button>
            <a class="btn-ghost btn-sm" href="${extUrl(c.id, d.id, '/text')}" download>${icon('download', 'ico-sm')}<span>Als Textdatei</span></a></div>
          <p class="form-hint">Abschrift – maßgeblich ist das Original in ${esc(p.name)}; spätere Änderungen dort sind hier erst nach „Aktualisieren“ enthalten.</p></details>`
      : '';
    const gallery = images.length
      ? `<div class="att-grid fn-gallery">${images
          .map(({ a, i }) => `<button type="button" class="att" data-action="att-open" data-index="${i}" aria-label="${esc(a.caption || 'Bild ansehen')}"><img src="${esc(a.url)}" alt="${esc(a.caption)}" loading="lazy"></button>`)
          .join('')}</div>`
      : '';
    const also = staff && d.alsoIn && d.alsoIn.length
      ? `<div class="fn-foot">Auch verknüpft mit: ${d.alsoIn
          .map((o) => `<button type="button" class="link-btn font-mono" data-action="open-case" data-id="${o.id}" title="${esc(o.title)}">${esc(o.caseNumber)}</button>`)
          .join(', ')}</div>`
      : '';
    const linkedOn = esc(parseDate(d.linkedAt)?.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) || '—');
    return `<div class="fn-doc ${gd ? 'is-gdocs' : ''}">
      <div class="fn-head">
        <span class="${p.badgeCls}">${esc(p.name)}</span>
        <div class="fn-main"><div class="fn-title">${esc(d.title || `${p.noun}${gd ? '' : ' ' + d.documentId}`)}</div><div class="fn-meta">${meta}</div></div>
        ${staff && d.internal ? badge('intern', 'amber') : ''}
      </div>
      ${d.summary ? `<p class="fn-summary">${esc(d.summary)}</p>` : ''}
      ${content}
      ${gallery}
      <div class="fn-foot">Quelle: ${esc(p.name)} (${esc(d.host)}) · Verknüpft von ${esc(d.linkedByName)} am ${linkedOn}${staff && d.viewedAs ? ` · eingesehen als „${esc(d.viewedAs)}“` : ''}</div>
      ${also}
      <div class="fn-actions">
        <a class="btn-outline btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${icon('external', 'ico-sm')}<span>In ${esc(p.name)} öffnen</span></a>
        ${staff ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-cite" data-id="${d.id}">${icon('copy', 'ico-sm')}<span>Zitat kopieren</span></button>` : ''}
        ${staff && gd ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}" data-reload="1">${icon('download', 'ico-sm')}<span>${d.contentText ? 'Aktualisieren' : 'Inhalt laden'}</span></button>` : ''}
        ${staff && !gd && !d.contentText ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}" data-focus="fnContent">${icon('doc', 'ico-sm')}<span>Text & Bilder übernehmen</span></button>` : ''}
        ${staff && st.caseAttachments.length < 40 ? `<label class="btn-ghost btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Bild anhängen</span><input type="file" accept="image/*" multiple data-upload="fivenet-img" data-case-id="${c.id}" data-doc-id="${d.id}" aria-label="Bilder zum Dokument hinzufügen"></label>` : ''}
        ${canManage ? `<button type="button" class="btn-ghost btn-sm" data-action="fn-edit" data-id="${d.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
          <button type="button" class="btn-ghost btn-sm fn-danger" data-action="fn-delete" data-id="${d.id}" data-case-id="${c.id}">${icon('trash', 'ico-sm')}<span>Entfernen</span></button>` : ''}
      </div>
    </div>`;
  }

  function externalSection(c, docs) {
    const staff = isStaff();
    if (!staff && !docs.length) return '';
    return `<div class="section" id="secExternal">
      <h3 class="section-title">Externe Dokumente ${staff ? `<span class="ext-add">
        <button type="button" class="btn-outline btn-sm" data-action="fn-add">${icon('link', 'ico-sm')}<span>FiveNet-Dokument</span></button>
        <button type="button" class="btn-outline btn-sm" data-action="gd-add">${icon('doc', 'ico-sm')}<span>Google-Docs-Dokument</span></button></span>` : ''}</h3>
      ${docs.length
        ? `<div class="stack">${docs.map((d) => externalDocCard(d, c)).join('')}</div>`
        : '<p class="text-sm text-dim">Noch keine externen Dokumente. Polizeiberichte und Strafakten aus FiveNet oder Verträge und Schriftsätze aus Google Docs lassen sich per Link mit der Akte verknüpfen – mit Abschrift und Bildern.</p>'}
      ${!staff ? '<p class="form-hint">Öffnen im Original ist nur mit einer Berechtigung in FiveNet bzw. Google Docs möglich.</p>' : ''}
    </div>`;
  }

  function externalCitation(d) {
    const parts = [d.docType, d.docDate ? fmtDateOnly(d.docDate) : null].filter(Boolean).join(', ');
    const head = d.provider === 'gdocs' ? 'Google-Docs-Dokument' : `FiveNet-Dokument Nr. ${d.documentId}`;
    return `${head}${d.title ? ` „${d.title}“` : ''}${parts ? ` (${parts})` : ''}, ${d.url}`;
  }

  /** Dialog: Dokument verknüpfen (d = null) oder Angaben bearbeiten – für FiveNet und Google Docs. */
  function externalForm(provider, d, c) {
    const fn = st.fivenet || { instance: { url: 'https://fivenet.modernv.net', host: 'fivenet.modernv.net' }, docTypes: [], lastViewedAs: '' };
    const p = EXT[provider];
    const gd = provider === 'gdocs';
    const editing = !!d;
    const v = d || { title: '', docType: '', docDate: '', docAuthor: '', summary: '', viewedAs: gd ? '' : fn.lastViewedAs || '', internal: true };
    const inputBox = gd
      ? `<div class="span-2"><label class="label" for="gdInput">Link zum Google-Docs-Dokument</label>
          <input id="gdInput" name="input" class="field font-mono text-sm" required maxlength="600" autocomplete="off" spellcheck="false" autofocus placeholder="https://docs.google.com/document/d/…/edit">
          <div id="gdCheck" class="fn-check" aria-live="polite"><span class="text-dim">Link einfügen – bei „Jeder, der über den Link verfügt“ werden Text und Bilder automatisch geladen.</span></div></div>`
      : `<div class="span-2"><label class="label" for="fnInput">Link zum FiveNet-Dokument</label>
          <input id="fnInput" name="input" class="field font-mono text-sm" required maxlength="500" autocomplete="off" spellcheck="false" autofocus placeholder="${esc(fn.instance.url)}/documents/1234">
          <div id="fnCheck" class="fn-check" aria-live="polite"><span class="text-dim">Adresse aus FiveNet einfügen – die Dokument-ID wird automatisch erkannt.</span></div></div>`;
    const known = editing
      ? `<div class="span-2"><div class="label">${esc(p.noun)}</div><div class="fn-check ok"><div class="fn-line">${icon('check', 'ico-sm')}<span>${gd ? esc(d.host) : `Dokument-ID <strong>${esc(d.documentId)}</strong> · ${esc(d.host)}`}</span><a class="link-btn push" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">In ${esc(p.name)} öffnen ↗</a></div></div>
          ${gd ? '<div id="gdCheck" class="fn-check hidden" aria-live="polite"></div>' : ''}</div>`
      : inputBox;
    const contentHint = gd
      ? 'Wird bei freigegebenen Dokumenten automatisch gefüllt. Sonst: in Google Docs Strg+A, Strg+C – hier Strg+V.'
      : 'Im FiveNet-Dokument den Inhalt mit der Maus markieren → Strg+C, dann hier Strg+V. Text wird als Abschrift gespeichert, enthaltene Bilder werden automatisch übernommen.';
    return `
      <h2 id="modalTitle" class="modal-title">${editing ? `${esc(p.noun)} bearbeiten` : `${esc(p.noun)} hinzufügen`}</h2>
      <p class="modal-sub"><span class="font-mono text-gold">${esc(c.caseNumber)}</span> · ${esc(c.title)}</p>
      <form data-form="${editing ? 'ext-edit' : 'ext-link'}" data-provider="${provider}" data-case-id="${c.id}" ${editing ? `data-id="${d.id}"` : ''} class="form-grid cols-2">
        ${known}
        <div class="span-2"><label class="label" for="fnTitle">Titel</label><input id="fnTitle" name="title" class="field" maxlength="300" value="${esc(v.title)}" placeholder="${gd ? 'z. B. Kaufvertrag Autohaus' : 'z. B. Polizeibericht – Verkehrskontrolle'}"></div>
        <div><label class="label">Dokumentart</label><input name="docType" class="field" maxlength="60" list="fnTypes" value="${esc(v.docType)}" placeholder="${gd ? 'z. B. Vertrag' : 'z. B. Polizeibericht'}"><datalist id="fnTypes">${(fn.docTypes || []).map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></div>
        <div><label class="label">Erstellt am</label><input name="docDate" type="date" class="field" value="${esc(v.docDate || '')}"></div>
        <div class="${gd ? 'span-2' : ''}"><label class="label">Verfasser / Behörde</label><input name="docAuthor" class="field" maxlength="120" value="${esc(v.docAuthor)}" placeholder="${gd ? 'z. B. Autohaus Premium Deluxe' : 'z. B. LSPD, Officer J. Miller'}"></div>
        ${gd ? '' : `<div><label class="label">Eingesehen als (FiveNet-Charakter)</label><input name="viewedAs" class="field" maxlength="80" value="${esc(v.viewedAs || '')}" placeholder="eigene Angabe, optional"></div>`}
        <div class="span-2"><label class="label">Kurzinhalt / Relevanz für die Akte</label><textarea name="summary" rows="3" maxlength="2000" class="field" placeholder="Was steht drin, warum ist es wichtig?">${esc(v.summary)}</textarea></div>
        <div class="span-2 fn-content-box">
          <div class="fn-line"><label class="label" for="fnContent">Inhalt aus ${esc(p.name)} – Text & Bilder (optional)</label>
            ${gd && editing ? `<button type="button" class="btn-ghost btn-sm push" data-action="gd-reload" data-url="${esc(d.url)}">${icon('download', 'ico-sm')}<span>Neu aus Google Docs laden</span></button>` : ''}</div>
          <textarea id="fnContent" name="contentText" rows="7" maxlength="60000" class="field fn-content" placeholder="${esc(contentHint)}">${esc(v.contentText || '')}</textarea>
          <div id="fnPending" class="fn-pending"></div>
          <div class="fn-line mt-2">
            <label class="btn-ghost btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Bilder / Screenshots wählen</span><input type="file" accept="image/*" multiple data-upload="fn-pending" aria-label="Bilder auswählen"></label>
            <span class="form-hint">Screenshots (Win+Umschalt+S) oder „Bild kopieren“ lassen sich auch direkt mit Strg+V einfügen.</span>
          </div>
        </div>
        <label class="check span-2"><input type="checkbox" name="clientVisible" ${v.internal ? '' : 'checked'}> Für den Mandanten sichtbar (sonst nur intern) – gilt auch für Abschrift und Bilder</label>
        ${editing || gd ? '' : `<label class="check span-2 fn-attest"><input type="checkbox" name="attest" required> Ich habe dieses Dokument in FiveNet mit meinem eigenen Charakter geöffnet und darf es einsehen und für die Akte übernehmen.</label>
          <div class="span-2 banner banner-gold mb-0">${icon('shield')}<div>FiveNet bietet externen Anwendungen keine Schnittstelle (kein OAuth2). Die Kanzlei ruft das Dokument deshalb nicht selbst ab und fragt nie nach Ihrem FiveNet-Passwort. Übernommen wird nur, was Sie hier einfügen – Bilder daraus lädt der Server direkt aus dem FiveNet-Dateispeicher.</div></div>`}
        ${gd && !editing ? `<div class="span-2 banner banner-gold mb-0">${icon('shield')}<div>Die Kanzlei nutzt kein Google-Konto und fragt nie nach Passwörtern. Geladen werden nur Dokumente, die per Link freigegeben oder im Web veröffentlicht sind – genau so, wie sie jeder mit dem Link sehen kann.</div></div>` : ''}
        <div class="span-2 form-actions">
          <button type="submit" class="btn-gold btn-md">${icon(editing ? 'check' : 'link', 'ico-sm')}<span>${editing ? 'Speichern' : 'Mit Akte verknüpfen'}</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button>
        </div>
      </form>`;
  }

  /** Live-Prüfung des eingefügten FiveNet-Links (Dokument-ID, Dubletten, Querverweise). */
  async function checkFivenetInput(input) {
    const box = $('#fnCheck');
    if (!box) return;
    const token = ++st.fnCheckToken;
    const value = input.value.trim();
    const submit = $('form[data-form="ext-link"] button[type="submit"]');
    if (submit) submit.disabled = false;
    if (!value) {
      box.className = 'fn-check';
      box.innerHTML = '<span class="text-dim">Adresse aus FiveNet einfügen – die Dokument-ID wird automatisch erkannt.</span>';
      return;
    }
    box.className = 'fn-check';
    box.innerHTML = '<span class="text-dim">Wird geprüft …</span>';
    let r;
    try {
      r = await api.post('/api/fivenet/resolve', { input: value, caseId: st.modalCaseId || undefined });
    } catch (e) {
      if (token !== st.fnCheckToken || !box.isConnected) return;
      box.className = 'fn-check bad';
      box.innerHTML = `${icon('x', 'ico-sm')}<span>${esc(e.message)}</span>`;
      return;
    }
    if (token !== st.fnCheckToken || !box.isConnected) return;
    const lines = [
      `<div class="fn-line">${icon('check', 'ico-sm')}<span>Dokument-ID <strong>${esc(r.documentId)}</strong> erkannt · ${esc(r.host)}</span><a class="link-btn push" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">In FiveNet öffnen ↗</a></div>`,
    ];
    if (r.linkedHere) lines.push(`<div class="fn-warn">Bereits mit dieser Akte verknüpft (von ${esc(r.linkedHere.linkedByName)}).</div>`);
    if (r.otherCases.length) lines.push(`<div class="text-xs text-muted">Auch verknüpft mit: ${r.otherCases.map((o) => `<span class="font-mono">${esc(o.caseNumber)}</span>`).join(', ')}</div>`);
    const title = $('#fnTitle');
    if (title && !title.value && r.suggestedTitle) {
      title.value = r.suggestedTitle;
      lines.push('<div class="text-xs text-dim">Titel aus einer anderen Akte übernommen – bitte prüfen.</div>');
    }
    box.className = `fn-check ${r.linkedHere ? 'warn' : 'ok'}`;
    box.innerHTML = lines.join('');
    if (submit) submit.disabled = !!r.linkedHere;
  }

  /**
   * Google Docs: Link erkennen und – falls freigegeben – Text und Bilder automatisch übernehmen.
   * replace = true: vorhandene Abschrift ersetzen (Aktualisieren im Bearbeiten-Dialog).
   */
  async function loadGoogleDoc(value, { replace = false } = {}) {
    const box = $('#gdCheck');
    if (!box) return;
    const token = ++st.fnCheckToken;
    const submit = $('form[data-form="ext-link"] button[type="submit"]');
    if (submit) submit.disabled = false;
    box.classList.remove('hidden');
    if (!value) {
      box.className = 'fn-check';
      box.innerHTML = '<span class="text-dim">Link einfügen – bei „Jeder, der über den Link verfügt“ werden Text und Bilder automatisch geladen.</span>';
      return;
    }
    box.className = 'fn-check';
    box.innerHTML = '<span class="text-dim">Google Docs wird geladen …</span>';
    let r;
    try {
      r = await api.post('/api/gdocs/fetch', { input: value, caseId: st.modalCaseId || undefined });
    } catch (e) {
      if (token !== st.fnCheckToken || !box.isConnected) return;
      box.className = 'fn-check bad';
      box.innerHTML = `${icon('x', 'ico-sm')}<span>${esc(e.message)}</span>`;
      return;
    }
    if (token !== st.fnCheckToken || !box.isConnected) return;
    const lines = [];
    const openLink = `<a class="link-btn push" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">In Google Docs öffnen ↗</a>`;
    if (r.html) {
      const { text, images } = parsePastedHtml(r.html);
      const urls = images.map((src) => externalImageUrl('gdocs', src)).filter(Boolean);
      const area = $('#fnContent');
      if (area && (replace || !area.value.trim() || area.dataset.auto === '1')) {
        area.value = text.length > 60000 ? text.slice(0, 60000) : text;
        area.dataset.auto = '1';
        if (text.length > 60000) toast('Das Dokument ist sehr lang – die Abschrift wurde auf 60.000 Zeichen gekürzt.', 'error');
      }
      st.fnPending.urls = [];
      addPendingImages({ urls });
      const title = $('#fnTitle');
      if (title && !title.value && (r.title || r.suggestedTitle)) title.value = r.title || r.suggestedTitle;
      lines.push(
        `<div class="fn-line">${icon('check', 'ico-sm')}<span>${r.title ? `„${esc(r.title)}“ ` : 'Dokument '}geladen · ${text.length.toLocaleString('de-DE')} Zeichen · ${urls.length} Bild${urls.length === 1 ? '' : 'er'}${r.published ? ' · im Web veröffentlicht' : ''}</span>${openLink}</div>`
      );
    } else {
      lines.push(`<div class="fn-line">${icon('check', 'ico-sm')}<span>Google-Docs-Link erkannt</span>${openLink}</div>`);
      lines.push(`<div class="fn-warn">${esc(r.contentError || 'Der Inhalt konnte nicht geladen werden.')}</div>`);
    }
    if (r.linkedHere && !replace) lines.push(`<div class="fn-warn">Bereits mit dieser Akte verknüpft (von ${esc(r.linkedHere.linkedByName)}).</div>`);
    if (r.otherCases.length) lines.push(`<div class="text-xs text-muted">Auch verknüpft mit: ${r.otherCases.map((o) => `<span class="font-mono">${esc(o.caseNumber)}</span>`).join(', ')}</div>`);
    box.className = `fn-check ${r.html && !(r.linkedHere && !replace) ? 'ok' : 'warn'}`;
    box.innerHTML = lines.join('');
    if (submit) submit.disabled = !!r.linkedHere;
    if (replace && r.html) toast('Neuer Stand geladen – mit „Speichern“ übernehmen.');
  }

  function fivenetBody(f) {
    const fd = new FormData(f);
    return {
      title: val(fd, 'title'),
      docType: val(fd, 'docType'),
      docDate: val(fd, 'docDate') || null,
      docAuthor: val(fd, 'docAuthor'),
      summary: val(fd, 'summary'),
      viewedAs: val(fd, 'viewedAs'),
      internal: fd.get('clientVisible') !== 'on',
      contentText: String(fd.get('contentText') ?? '').replace(/\s+$/, '').replace(/^\s*\n/, ''),
    };
  }

  /* ---------------------------------------------------------------- FiveNet: Inhalt übernehmen (Einfügen) */
  const FN_BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD']);
  const FN_IMAGE_PATHS = ['/api/filestore/', '/api/image_proxy/'];
  const FN_MAX_IMAGES = 10;

  /**
   * Wandelt kopiertes HTML aus FiveNet in lesbaren Text und sammelt die Bildadressen.
   * DOMParser lädt keine Bilder und führt keine Skripte aus; übernommen werden nur Textknoten.
   */
  function parsePastedHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template, svg, button, input, select, textarea').forEach((n) => n.remove());
    const images = [];
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src) images.push(src);
      const marker = doc.createElement('p');
      marker.textContent = '[Bild]';
      img.replaceWith(marker);
    });
    const out = [];
    // inCell: innerhalb einer Tabellenzelle bleiben Absätze in einer Zeile (Google Docs setzt <p> in jede Zelle).
    const walk = (node, inCell = false) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          out.push(n.nodeValue.replace(/\s+/g, ' '));
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'BR') {
          out.push('\n');
          continue;
        }
        if (tag === 'HR') {
          out.push('\n————————\n');
          continue;
        }
        const cell = tag === 'TD' || tag === 'TH';
        const block = FN_BLOCK.has(tag) && !inCell;
        // Listenpunkte und Tabellenzeilen ohne Leerzeile untereinander, Absätze mit Leerzeile.
        const tight = tag === 'LI' || tag === 'TR' || tag === 'DT' || tag === 'DD';
        if (block) out.push('\n');
        else if (inCell && FN_BLOCK.has(tag)) out.push(' ');
        if (tag === 'LI') out.push('• ');
        if (cell && n.previousElementSibling) out.push(' | ');
        walk(n, inCell || cell);
        if (block && !tight) out.push('\n');
        if (/^H[1-6]$/.test(tag)) out.push('\n');
      }
    };
    // Im Web veröffentlichte Google-Docs-Seiten tragen den Inhalt in #contents.
    walk(doc.querySelector('#contents') || doc.body);
    const text = out
      .join('')
      .split('\n')
      .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, images };
  }

  /**
   * Übernommen werden nur Bilder der jeweiligen Quelle: FiveNet-Dateispeicher / Bild-Proxy
   * bzw. Google-Inhaltsserver (*.googleusercontent.com). Der Server prüft dasselbe noch einmal.
   */
  function externalImageUrl(provider, src) {
    if (provider === 'gdocs') {
      try {
        const u = new URL(src);
        if (u.protocol !== 'https:' || u.port || !u.hostname.endsWith('.googleusercontent.com')) return null;
        u.hash = '';
        return u.toString();
      } catch {
        return null;
      }
    }
    const base = st.fivenet?.instance?.url || 'https://fivenet.modernv.net';
    try {
      const u = new URL(src, base);
      const b = new URL(base);
      if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '') || u.port !== b.port) return null;
      if (!FN_IMAGE_PATHS.some((p) => u.pathname.startsWith(p))) return null;
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }

  function dataUrlToBlob(src) {
    const m = String(src).match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
    if (!m) return null;
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1].toLowerCase() });
  }

  function pendingCount() {
    return st.fnPending.urls.length + st.fnPending.blobs.length;
  }

  function addPendingImages({ urls = [], blobs = [] }) {
    let dropped = 0;
    for (const u of urls) {
      if (st.fnPending.urls.includes(u)) continue;
      if (pendingCount() >= FN_MAX_IMAGES) dropped += 1;
      else st.fnPending.urls.push(u);
    }
    for (const b of blobs) {
      if (pendingCount() >= FN_MAX_IMAGES) dropped += 1;
      else st.fnPending.blobs.push(b);
    }
    if (dropped) toast(`Pro Vorgang werden höchstens ${FN_MAX_IMAGES} Bilder übernommen – ${dropped} weggelassen.`, 'error');
    renderPending();
  }

  function renderPending() {
    const box = $('#fnPending');
    if (!box) return;
    (st.fnPending.previews || []).forEach((u) => URL.revokeObjectURL(u));
    st.fnPending.previews = st.fnPending.blobs.map((b) => URL.createObjectURL(b));
    const source = EXT[box.closest('form')?.dataset.provider]?.name || 'Quelle';
    const items = [
      ...st.fnPending.urls.map((u, i) => ({ src: u, kind: 'url', i, label: `aus ${source}` })),
      ...st.fnPending.blobs.map((b, i) => ({ src: st.fnPending.previews[i], kind: 'blob', i, label: 'eingefügt' })),
    ];
    box.innerHTML = items.length
      ? `<div class="text-xs text-muted mb-1">${items.length} Bild${items.length === 1 ? '' : 'er'} ${items.length === 1 ? 'wird' : 'werden'} beim Speichern als Anhang übernommen:</div>
         <div class="fn-thumbs">${items
           .map((it) => `<div class="fn-thumb"><img src="${esc(it.src)}" alt="" referrerpolicy="no-referrer" loading="lazy"><span class="lbl">${esc(it.label)}</span>
             <button type="button" class="rm" data-action="fn-img-remove" data-kind="${it.kind}" data-index="${it.i}" aria-label="Bild entfernen">${icon('x', 'ico-sm')}</button></div>`)
           .join('')}</div>`
      : '';
  }

  function resetPending() {
    (st.fnPending.previews || []).forEach((u) => URL.revokeObjectURL(u));
    st.fnPending = { urls: [], blobs: [] };
  }

  function insertAtCursor(el, text) {
    const max = Number(el.getAttribute('maxlength')) || Infinity;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const room = max - (el.value.length - (end - start));
    const piece = text.length > room ? text.slice(0, Math.max(0, room)) : text;
    if (piece.length < text.length) toast('Der Text ist sehr lang und wurde gekürzt (höchstens 60.000 Zeichen).', 'error');
    el.setRangeText(piece, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Einfügen im Dokument-Dialog: HTML → Text + Bildadressen, Bilddateien aus der Zwischenablage → Anhänge. */
  function onExternalPaste(e, provider) {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...(cd.files || [])].filter((f) => /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type));
    const html = cd.getData('text/html');
    const plain = cd.getData('text/plain');
    const inContent = e.target && e.target.id === 'fnContent';
    if (files.length) addPendingImages({ blobs: files });
    if (html && inContent) {
      const { text, images } = parsePastedHtml(html);
      const urls = [];
      const blobs = [];
      let external = 0;
      for (const src of images) {
        const blob = src.startsWith('data:') ? dataUrlToBlob(src) : null;
        if (blob) blobs.push(blob);
        else {
          const u = externalImageUrl(provider, src);
          if (u) urls.push(u);
          else external += 1;
        }
      }
      if (urls.length || blobs.length) addPendingImages({ urls, blobs });
      if (external) toast(`${external} Bild${external === 1 ? '' : 'er'} liegt nicht bei ${EXT[provider].name} – bitte als Screenshot einfügen.`, 'error');
      if (text) {
        e.preventDefault();
        insertAtCursor(e.target, text);
      }
      return;
    }
    if (files.length && !plain) {
      e.preventDefault();
      toast(files.length === 1 ? 'Bild hinzugefügt – wird beim Speichern übernommen.' : `${files.length} Bilder hinzugefügt.`);
    }
  }

  /** Nach dem Speichern: vorgemerkte Bilder als Anhänge zum FiveNet-Dokument übernehmen. */
  async function importPendingImages(caseId, doc) {
    const pending = st.fnPending;
    const result = { ok: 0, failed: 0, skipped: 0, errors: [] };
    if (!pending.urls.length && !pending.blobs.length) return result;
    toast('Bilder werden übernommen …');
    if (pending.urls.length) {
      try {
        const r = await api.post(extUrl(caseId, doc.id, '/images'), { urls: pending.urls });
        result.ok += r.imported;
        result.skipped += r.skipped;
        result.failed += r.failed.length;
        result.errors.push(...r.failed.map((f) => f.error));
      } catch (e) {
        result.failed += pending.urls.length;
        result.errors.push(e.message);
      }
    }
    const caption = (doc.provider === 'gdocs' ? `Google Docs${doc.title ? ' – ' + doc.title : ''}` : `FiveNet ${doc.documentId}${doc.title ? ' – ' + doc.title : ''}`).slice(0, 180);
    for (const b of pending.blobs) {
      try {
        const blob = await resizeImage(b, { max: 1600 });
        await api.upload(`/api/cases/${caseId}/attachments?caption=${encodeURIComponent(caption)}&internal=${doc.internal ? 1 : 0}&fivenetDoc=${doc.id}`, blob);
        result.ok += 1;
      } catch (e) {
        result.failed += 1;
        result.errors.push(e.message);
      }
    }
    resetPending();
    return result;
  }

  function reportImport(r) {
    if (r.ok) toast(`${r.ok} Bild${r.ok === 1 ? '' : 'er'} als Anhang übernommen.`);
    if (r.skipped && !r.ok && !r.failed) toast('Die Bilder sind bereits in der Akte – nichts Neues.');
    if (r.failed) toast(`${r.failed} Bild${r.failed === 1 ? '' : 'er'} nicht übernommen (${[...new Set(r.errors)].slice(0, 2).join('; ')}). Tipp: als Screenshot mit Strg+V einfügen.`, 'error');
  }

  /* ---------------------------------------------------------------- Aufgaben & Wiedervorlagen */
  function taskItem(t, { showCase = true } = {}) {
    const due = dueInfo(t.dueDate, t.done);
    const meta = [
      showCase && t.caseNumber ? `<button type="button" class="link-btn font-mono" data-action="open-case" data-id="${t.caseId}" title="${esc(t.caseTitle || '')}">${esc(t.caseNumber)}</button>` : null,
      t.assignedName ? esc(t.assignedName) : '<span class="text-amber-300">niemand zuständig</span>',
      t.done && t.doneByName ? `erledigt von ${esc(t.doneByName)}` : null,
    ].filter(Boolean);
    return `<div class="task-row ${t.done ? 'is-done' : ''}">
      <button type="button" class="task-check" data-action="task-toggle" data-id="${t.id}" data-done="${t.done ? 1 : 0}" aria-label="${t.done ? 'Wieder öffnen' : 'Als erledigt markieren'}" title="${t.done ? 'Wieder öffnen' : 'Erledigt'}">${t.done ? icon('check', 'ico-sm') : ''}</button>
      <div class="main"><div class="title">${esc(t.title)}</div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}<div class="meta">${meta.join(' · ')}</div></div>
      <div class="side">${due ? `<span class="countdown ${due.cls}">${esc(due.text)}</span>` : ''}
        <span class="task-actions"><button type="button" class="icon-btn sm" data-action="task-edit" data-id="${t.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button>
        <button type="button" class="icon-btn sm" data-action="task-delete" data-id="${t.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></span></div>
    </div>`;
  }

  function caseTasksSection(c, tasks) {
    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    return `<div class="section" id="secTasks">
      <h3 class="section-title">Aufgaben & Wiedervorlagen <span class="text-xs text-dim font-normal" style="font-family:Inter,sans-serif">${open.length} offen · ${done.length} erledigt</span></h3>
      ${tasks.length ? `<div class="task-list">${open.map((t) => taskItem(t, { showCase: false })).join('')}${done.map((t) => taskItem(t, { showCase: false })).join('')}</div>` : '<p class="text-sm text-dim mb-2">Noch keine Aufgaben. Wiedervorlage mit Datum anlegen oder die Checkliste für dieses Rechtsgebiet übernehmen.</p>'}
      <form data-form="task-quick" data-case-id="${c.id}" class="task-quick mt-3">
        <input name="title" class="field" required minlength="2" maxlength="160" placeholder="Neue Aufgabe oder Wiedervorlage …" aria-label="Neue Aufgabe">
        <input name="dueDate" type="date" class="field" aria-label="Fällig am" title="Fällig am (Wiedervorlage)">
        <button type="submit" class="btn-outline btn-md">${icon('plus', 'ico-sm')}<span>Hinzufügen</span></button>
      </form>
      <div class="task-extra">
        <button type="button" class="btn-ghost btn-sm" data-action="task-checklist" data-case-id="${c.id}">${icon('tasks', 'ico-sm')}<span>Checkliste ${esc(AREAS[c.area] || '')} übernehmen</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="task-new" data-case-id="${c.id}">${icon('calendar', 'ico-sm')}<span>Mit Zuständigkeit & Notiz …</span></button>
      </div>
    </div>`;
  }

  function findTask(id) {
    return [...st.caseTasks, ...st.tasks, ...st.myTasks].find((t) => t.id === id) || null;
  }

  function taskModal(t, preset = {}) {
    const caseId = t ? t.caseId : preset.caseId || null;
    const assignee = t ? t.assignedTo : preset.assignedTo ?? st.user.id;
    const activeCases = st.cases.filter((c) => c.status !== 'geschlossen' || c.id === caseId);
    openModal(`
      <h2 id="modalTitle" class="modal-title">${t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
      <p class="modal-sub">Mit Datum wird die Aufgabe zur Wiedervorlage und erscheint rechtzeitig unter „Handlungsbedarf“.</p>
      <form data-form="task" ${t ? `data-id="${t.id}"` : ''} class="form-grid cols-2">
        <div class="span-2"><label class="label">Aufgabe</label><input name="title" class="field" required minlength="2" maxlength="160" value="${esc(t ? t.title : '')}" autofocus></div>
        <div><label class="label">Fällig am (Wiedervorlage)</label><input name="dueDate" type="date" class="field" value="${esc(t ? t.dueDate || '' : '')}"></div>
        <div><label class="label">Zuständig</label><select name="assignedTo" class="field"><option value="">Niemand</option>${st.lawyers.map((l) => opt(l.id, l.displayName, l.id === assignee)).join('')}</select></div>
        <div class="span-2"><label class="label">Akte (optional)</label><select name="caseId" class="field" ${t ? 'disabled title="Der Aktenbezug lässt sich nachträglich nicht ändern."' : ''}><option value="">Ohne Aktenbezug</option>${activeCases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId)).join('')}</select></div>
        <div class="span-2"><label class="label">Notiz</label><textarea name="note" rows="3" maxlength="1000" class="field">${esc(t ? t.note : '')}</textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
          <button type="button" class="btn-ghost btn-md" data-action="back-to-case">Abbrechen</button></div>
      </form>`);
  }

  async function afterTaskChange() {
    load.dueTasks().then(renderNav).catch(() => {});
    if (st.modalCaseId && $('#secTasks')) await reloadCase(st.modalCaseId);
    else await refreshBehind();
  }

  function caseDetail({ case: c, notes, appointments, invoices, attachments = [], externalDocs = [], tasks = [] }) {
    const staff = isStaff();
    const admin = isAdmin();
    const me = st.user.id;
    const ratio = c.closed ? 1 : c.step / 3;

    const track = `
      <div class="track-line mb-6"><div class="track-fill" style="width:${ratio * 75}%"></div>
        <div class="grid grid-cols-4">${STEPS.map((s, i) => {
          const done = c.closed || i < c.step;
          const cur = !c.closed && i === c.step;
          return `<div class="flex flex-col items-center gap-2"><div class="track-node ${done ? 'done' : cur ? 'current' : ''}">${done ? '✓' : i + 1}</div><span class="text-[0.7rem] sm:text-xs text-muted text-center">${s}</span></div>`;
        }).join('')}</div></div>`;

    const info = [
      ['Mandant', c.clientName + (staff && !c.hasClientAccount ? ' (ohne Konto)' : '')],
      staff ? ['Kontakt', [c.clientPhone, c.clientEmail].filter(Boolean).join(' · ') || '—'] : null,
      ['Zuständig', c.lawyerName || 'Noch nicht zugewiesen'],
      ['Rechtsgebiet', AREAS[c.area] || c.area],
      ['Dringlichkeit', (URGENCY[c.urgency] || [c.urgency])[0]],
      c.opponent ? ['Gegenpartei', c.opponent] : null,
      c.courtRef ? ['Gerichtsaktenzeichen', c.courtRef] : null,
      ['Eröffnet', fmtDate(c.createdAt)],
      staff ? ['Eingang über', SOURCES[c.source] || c.source] : null,
    ]
      .filter(Boolean)
      .map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`)
      .join('');

    const pin = c.accessPin
      ? `<div class="banner banner-gold items-center justify-between flex-wrap">
          <div><div class="text-xs uppercase tracking-widest opacity-80">Aktenpin für die Statusabfrage</div><div class="text-sm text-muted">Aktenzeichen + Pin auf der Startseite unter „Aktenstatus“ eingeben.</div></div>
          <div class="flex items-center gap-2"><span class="font-mono text-2xl tracking-[0.25em] text-gold">${esc(c.accessPin)}</span>
          <button class="icon-btn sm" data-action="copy" data-text="${esc(`Aktenzeichen: ${c.caseNumber}\nAktenpin: ${c.accessPin}`)}" aria-label="Kopieren">${icon('copy', 'ico-sm')}</button></div></div>`
      : '';

    const statusSeg = c.canEdit
      ? `<div class="chip-row mb-5" role="group" aria-label="Status ändern">${Object.entries(CASE_STATUS)
          .map(([k, [l]]) => `<button type="button" class="chip ${c.status === k ? 'active' : ''}" data-action="case-status" data-id="${c.id}" data-status="${k}">${esc(l)}</button>`)
          .join('')}</div>`
      : '';

    const claim = c.canClaim
      ? `<div class="banner banner-amber items-center justify-between flex-wrap"><div>${icon('alert')} Diese Akte hat noch keinen zuständigen Anwalt.</div><button class="btn-gold btn-sm" data-action="claim-case" data-id="${c.id}">Akte übernehmen</button></div>`
      : '';

    const quick = [];
    if (staff) {
      quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Frist / Termin</span></button>`);
      quick.push(`<button class="btn-outline btn-sm" data-action="new-invoice" data-case-id="${c.id}">${icon('receipt', 'ico-sm')}<span>Rechnung</span></button>`);
      if (c.clientId) quick.push(`<button class="btn-outline btn-sm" data-action="compose" data-recipient="${c.clientId}" data-case-id="${c.id}" data-return-case="${c.id}">${icon('mail', 'ico-sm')}<span>Mandant anschreiben</span></button>`);
      if (c.lawyerId === me) quick.push(`<button class="btn-ghost btn-sm" data-action="release-case" data-id="${c.id}">Akte abgeben</button>`);
      if (admin) quick.push(`<button class="btn-danger btn-sm" data-action="delete-case" data-id="${c.id}" data-number="${esc(c.caseNumber)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>`);
    } else {
      if (!c.closed) quick.push(`<button class="btn-outline btn-sm" data-action="new-event" data-case-id="${c.id}" data-return-case="${c.id}">${icon('calendar', 'ico-sm')}<span>Termin anfragen</span></button>`);
      quick.push(`<button class="btn-outline btn-sm" data-action="compose" ${c.lawyerId ? `data-recipient="${c.lawyerId}"` : ''} data-case-id="${c.id}" data-return-case="${c.id}">${icon('mail', 'ico-sm')}<span>Nachricht zur Akte</span></button>`);
    }

    const editForm = c.canEdit
      ? `<details class="edit-box section">
          <summary>Akte bearbeiten</summary>
          <form data-form="case-edit" data-id="${c.id}" class="form-grid cols-2">
            <div class="span-2"><label class="label">Titel</label><input name="title" class="field" required minlength="3" maxlength="120" value="${esc(c.title)}"></div>
            <div><label class="label">Rechtsgebiet</label><select name="area" class="field">${Object.entries(AREAS).map(([k, l]) => opt(k, l, c.area === k)).join('')}</select></div>
            <div><label class="label">Dringlichkeit</label><select name="urgency" class="field">${Object.entries(URGENCY).map(([k, [l]]) => opt(k, l, c.urgency === k)).join('')}</select></div>
            <div><label class="label">Verfahrensstand</label><select name="step" class="field">${STEPS.map((s, i) => opt(i, s, c.step === i)).join('')}</select></div>
            ${admin ? `<div><label class="label">Zuständiger Anwalt</label><select name="lawyerId" class="field"><option value="">Nicht zugewiesen</option>${st.lawyers.map((l) => opt(l.id, l.displayName, c.lawyerId === l.id)).join('')}</select></div>` : '<div></div>'}
            ${!c.hasClientAccount ? `<div><label class="label">Mandant</label><input name="clientName" class="field" maxlength="80" value="${esc(c.clientName === '—' ? '' : c.clientName)}"></div>` : ''}
            <div><label class="label">Telefon Mandant</label><input name="clientPhone" class="field" maxlength="40" value="${esc(c.clientPhone || '')}"></div>
            <div><label class="label">Gegenpartei</label><input name="opponent" class="field" maxlength="120" value="${esc(c.opponent)}"></div>
            <div><label class="label">Gerichtsaktenzeichen</label><input name="courtRef" class="field" maxlength="60" value="${esc(c.courtRef)}"></div>
            <div class="span-2"><label class="label">Sachverhalt</label><textarea name="description" rows="5" maxlength="4000" class="field">${esc(c.description)}</textarea></div>
            <div class="span-2"><label class="label">Statushinweis (sichtbar für den Mandanten und in der öffentlichen Abfrage)</label><textarea name="publicNote" rows="2" maxlength="500" class="field">${esc(c.publicNote)}</textarea></div>
            <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Änderungen speichern</span></button></div>
          </form></details>`
      : '';

    const apptList = appointments.length
      ? appointments.map((e) => eventRow(e)).join('')
      : '<p class="text-sm text-dim">Keine Termine oder Fristen zu dieser Akte.</p>';

    const invoiceList = invoices.length
      ? invoices
          .map(
            (i) => `<div class="list-row wrap"><div class="main"><div class="title"><span class="font-mono text-gold">${esc(i.number)}</span> · ${esc(INVOICE_KIND[i.kind])}</div><div class="meta">${esc(fmtDate(i.createdAt))} · ${esc(i.issuerName)}</div></div>
            <div class="flex items-center gap-2 shrink-0"><span class="font-mono nowrap">${money(i.total)}</span>${statusBadge(INVOICE_STATUS, i.status)}<a class="icon-btn sm" href="/invoice.html?id=${i.id}" target="_blank" rel="noopener" aria-label="Drucken / PDF">${icon('printer', 'ico-sm')}</a></div></div>`
          )
          .join('')
      : '';

    const noteList = notes.length
      ? `<div class="timeline">${notes
          .map((n) => {
            const canDelete = !n.system && (n.authorId === me || admin);
            return `<div class="tl-item ${n.internal ? 'tl-internal' : ''} ${n.system ? 'tl-system' : ''}">
              <div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span>${n.authorRole && ROLES[n.authorRole] ? `<span>${esc(ROLES[n.authorRole])}</span>` : ''}<span>${esc(fmtDate(n.createdAt))}</span>${n.internal ? badge('intern', 'amber') : ''}
              ${canDelete ? `<button class="ml-auto text-dim hover:text-red-300" data-action="delete-note" data-case-id="${c.id}" data-id="${n.id}" aria-label="Notiz löschen">${icon('trash', 'ico-sm')}</button>` : ''}</div>
              <div class="tl-body">${esc(n.body)}</div></div>`;
          })
          .join('')}</div>`
      : '<p class="text-sm text-dim">Noch keine Einträge.</p>';

    return `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5 pr-12">
        <div class="min-w-0"><div class="font-mono text-gold text-sm">${esc(c.caseNumber)}</div>
          <h2 id="modalTitle" class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(c.title)}</h2></div>
        <div class="flex flex-wrap gap-2">${statusBadge(CASE_STATUS, c.status)}${c.urgency !== 'normal' ? badge(...URGENCY[c.urgency]) : ''}</div>
      </div>
      ${statusSeg}
      ${track}
      ${claim}
      ${staff ? caseStats(c, { appointments, attachments, externalDocs, tasks }) : ''}
      <div class="info-grid mb-5">${info}</div>
      ${pin}
      ${quick.length ? `<div class="form-actions mb-2">${quick.join('')}</div>` : ''}
      ${editForm}
      <div class="section"><h3 class="section-title">Sachverhalt</h3><p class="text-sm whitespace-pre-wrap text-muted">${esc(c.description || '—')}</p></div>
      ${c.publicNote ? `<div class="section"><h3 class="section-title">Statushinweis</h3><div class="banner banner-gold mb-0"><p class="text-sm whitespace-pre-wrap">${esc(c.publicNote)}</p></div></div>` : ''}
      ${externalSection(c, externalDocs)}
      ${attachmentsSection(c, attachments)}
      <div class="section" id="secEvents"><h3 class="section-title">Termine & Fristen</h3>${apptList}</div>
      ${staff ? caseTasksSection(c, tasks) : ''}
      ${invoiceList ? `<div class="section"><h3 class="section-title">Rechnungen & Honorare</h3>${invoiceList}</div>` : ''}
      <div class="section" id="secNotes"><h3 class="section-title">Verlauf & Notizen</h3>
        ${noteList}
        <form data-form="add-note" data-id="${c.id}" class="mt-4 space-y-3">
          <textarea name="body" rows="3" maxlength="4000" required class="field" placeholder="${staff ? 'Notiz, Telefonat, Beweismittel, nächster Schritt …' : 'Nachricht oder Ergänzung zu Ihrer Akte …'}" aria-label="Neue Notiz"></textarea>
          <div class="flex flex-wrap items-center justify-between gap-3">
            ${staff ? '<label class="check"><input type="checkbox" name="internal" checked> Nur intern (für den Mandanten unsichtbar)</label>' : '<span></span>'}
            <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Speichern</span></button>
          </div>
        </form>
      </div>`;
  }

  async function newCaseModal() {
    const staff = isStaff();
    if (staff) await load.lawyers();
    openModal(`
      <h2 class="modal-title">${staff ? 'Neue Akte anlegen' : 'Mandat einreichen'}</h2>
      <p class="modal-sub">${staff ? 'Mandanten ohne Website-Konto einfach per Name erfassen. Die Akte wird Ihnen direkt zugewiesen.' : 'Schildern Sie Ihr Anliegen – ein Anwalt der Kanzlei meldet sich umgehend.'}</p>
      <form data-form="new-case" class="form-grid cols-2">
        ${staff ? `
          <div><label class="label" for="ncName">Mandant (Name)</label><input id="ncName" name="clientName" class="field" maxlength="80" placeholder="z. B. John Doe" autofocus></div>
          <div><label class="label" for="ncPhone">Telefon (im Spiel)</label><input id="ncPhone" name="clientPhone" class="field" maxlength="40" placeholder="555-0123"></div>
          <div class="span-2"><label class="label" for="ncEmail">…oder E-Mail eines registrierten Mandanten (optional)</label><input id="ncEmail" name="clientEmail" type="email" class="field" placeholder="verknüpft die Akte mit dem Mandantenkonto"></div>` : ''}
        <div class="span-2"><label class="label" for="ncTitle">Titel</label><input id="ncTitle" name="title" class="field" required minlength="3" maxlength="120" placeholder="z. B. Festnahme am Legion Square" ${staff ? '' : 'autofocus'}></div>
        <div><label class="label">Rechtsgebiet</label><select name="area" class="field">${Object.entries(AREAS).map(([k, l]) => opt(k, l)).join('')}</select></div>
        <div><label class="label">Dringlichkeit</label><select name="urgency" class="field">${Object.entries(URGENCY).map(([k, [l]]) => opt(k, l)).join('')}</select></div>
        ${staff ? `<div><label class="label">Gegenpartei</label><input name="opponent" class="field" maxlength="120" placeholder="optional"></div>
          <div><label class="label">Gerichtsaktenzeichen</label><input name="courtRef" class="field" maxlength="60" placeholder="optional"></div>` : ''}
        ${isAdmin() ? `<div class="span-2"><label class="label">Zuständiger Anwalt</label><select name="lawyerId" class="field"><option value="">Noch niemand (offene Anfrage)</option>${st.lawyers.map((l) => opt(l.id, l.displayName + (l.rank ? ' · ' + l.rank : ''), l.id === st.user.id)).join('')}</select></div>` : ''}
        <div class="span-2"><label class="label">Sachverhalt</label><textarea name="description" rows="5" class="field" ${staff ? '' : 'required minlength="10"'} maxlength="4000" placeholder="Was ist passiert? Wer ist beteiligt? Gibt es bereits Fristen oder Termine?"></textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${staff ? 'Akte anlegen' : 'Mandat einreichen'}</span></button></div>
      </form>`);
  }

  /* ---------------------------------------------------------------- Kalender */
  function monthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function calendarStaff() {
    const m = st.cal.month;
    const y = m.getFullYear();
    const mo = m.getMonth();
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // Montag zuerst
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const byDay = new Map();
    st.events
      .filter((e) => st.cal.types[e.type] && e.status !== 'abgesagt')
      .forEach((e) => {
        const d = parseDate(e.startsAt);
        if (!d) return;
        const k = dayKey(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(e);
      });
    byDay.forEach((list) => list.sort(byStart));

    const todayKey = dayKey(new Date());
    let grid = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < cells; i++) {
      const d = new Date(y, mo, 1 - offset + i);
      const k = dayKey(d);
      const evs = byDay.get(k) || [];
      const label = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (evs.length ? `, ${evs.length} Einträge` : '');
      grid += `<button type="button" class="cal-day ${d.getMonth() !== mo ? 'muted' : ''} ${k === todayKey ? 'today' : ''} ${k === st.cal.selected ? 'selected' : ''}" data-action="cal-select" data-day="${k}" aria-label="${esc(label)}">
        <span class="cal-num">${d.getDate()}</span>
        ${evs.slice(0, 3).map((e) => `<span class="cal-ev t-${esc(e.type)} ${e.status === 'erledigt' ? 'line-through opacity-60' : ''}">${esc(fmtTime(e.startsAt))} ${esc(e.title)}</span>`).join('')}
        ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} weitere</span>` : ''}
        ${evs.length ? `<span class="cal-dots">${evs.slice(0, 4).map((e) => `<i class="cal-dot" style="background:${EVENT_COLORS[e.type]}"></i>`).join('')}</span>` : ''}
      </button>`;
    }

    const selected = byDay.get(st.cal.selected) || [];
    const selDate = new Date(`${st.cal.selected}T12:00:00`);
    const deadlines = st.events.filter((e) => e.type === 'frist' && e.status === 'bestaetigt').sort(byStart).slice(0, 8);
    const requests = st.events.filter((e) => e.status === 'angefragt').sort(byStart);

    return `
      <div class="page-head">
        <div><h1 class="page-title">Kalender & Fristen</h1><p class="page-sub">Gerichtstermine, Mandantengespräche und Fristen des ganzen Teams – mit Live-Countdown.</p></div>
        <div class="page-actions"><button class="btn-gold btn-md" data-action="new-event" data-day="${st.cal.selected}">${icon('plus')}<span>Neuer Eintrag</span></button></div>
      </div>
      ${requests.length ? `<section class="panel panel-pad mb-4"><div class="panel-head"><h2 class="panel-title">Terminanfragen von Mandanten</h2>${badge(`${requests.length} offen`, 'amber')}</div>${requests.map((e) => eventRow(e)).join('')}</section>` : ''}
      <div class="cal-layout">
        <section class="panel panel-pad">
          <div class="cal-toolbar">
            <button class="icon-btn" data-action="cal-nav" data-dir="-1" aria-label="Vorheriger Monat">${icon('chevronLeft')}</button>
            <div class="cal-month">${esc(m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }))}</div>
            <button class="icon-btn" data-action="cal-nav" data-dir="1" aria-label="Nächster Monat">${icon('chevronRight')}</button>
            <button class="btn-outline btn-sm" data-action="cal-today">Heute</button>
          </div>
          <div class="cal-grid">${grid}</div>
          <div class="chip-row mt-3">${Object.entries(EVENT_TYPES)
            .map(([k, l]) => `<button class="chip ${st.cal.types[k] ? 'active' : ''}" data-action="cal-type" data-type="${k}" aria-pressed="${st.cal.types[k]}"><i class="cal-dot" style="background:${EVENT_COLORS[k]}"></i>${esc(l)}</button>`)
            .join('')}</div>
        </section>
        <aside class="stack">
          <section id="dayAgenda" class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">${esc(selDate.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
              <button class="btn-outline btn-sm" data-action="new-event" data-day="${st.cal.selected}">${icon('plus', 'ico-sm')}<span>Eintrag</span></button></div>
            ${selected.length ? selected.map((e) => eventRow(e, { date: false })).join('') : empty('Keine Einträge an diesem Tag.', 'calendar')}
          </section>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">Offene Fristen</h2></div>
            ${deadlines.length ? deadlines.map((e) => eventRow(e)).join('') : empty('Keine offenen Fristen.', 'clock')}
          </section>
        </aside>
      </div>`;
  }

  function calendarClient() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const upcoming = st.events.filter((e) => parseDate(e.startsAt) >= cutoff && e.status !== 'abgesagt').sort(byStart);
    const past = st.events.filter((e) => !upcoming.includes(e)).sort((a, b) => byStart(b, a)).slice(0, 15);
    return `
      <div class="page-head">
        <div><h1 class="page-title">Termine</h1><p class="page-sub">Ihre Termine mit der Kanzlei und bei Gericht.</p></div>
        <div class="page-actions"><button class="btn-gold btn-md" data-action="new-event">${icon('plus')}<span>Termin anfragen</span></button></div>
      </div>
      <section class="panel panel-pad mb-4"><div class="panel-head"><h2 class="panel-title">Anstehend</h2></div>
        ${upcoming.length ? upcoming.map((e) => eventRow(e)).join('') : empty('Keine anstehenden Termine.', 'calendar')}</section>
      ${past.length ? `<details class="edit-box"><summary>Vergangene & abgesagte Termine (${past.length})</summary>${past.map((e) => eventRow(e)).join('')}</details>` : ''}`;
  }

  views.calendar = {
    async load() {
      await Promise.all([load.events(), isStaff() ? load.cases() : null, load.lawyers()]);
      if (!st.cal.month) st.cal.month = monthStart(new Date());
      if (!st.cal.selected) st.cal.selected = dayKey(new Date());
    },
    render() {
      return isStaff() ? calendarStaff() : calendarClient();
    },
  };

  function eventForm(e, preset = {}) {
    const isNew = !e;
    const v = e || {};
    const type = v.type || preset.type || 'gericht';
    const start = v.startsAt ? toLocalInput(v.startsAt) : preset.day ? `${preset.day}T10:00` : '';
    const caseId = v.caseId ?? preset.caseId ?? null;
    const assigned = isNew ? st.user.id : v.assignedTo;
    const visible = isNew ? ['mandant', 'gericht'].includes(type) : v.clientVisible;
    const caseOpts = st.cases
      .filter((c) => c.status !== 'geschlossen' || c.id === caseId)
      .map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId))
      .join('');

    const statusBtns = isNew
      ? ''
      : [
          v.status === 'angefragt' ? `<button type="button" class="btn-gold btn-md" data-action="event-status" data-id="${v.id}" data-status="bestaetigt">${icon('check')}<span>Anfrage bestätigen</span></button>` : '',
          v.type === 'frist' && v.status === 'bestaetigt' ? `<button type="button" class="btn-gold btn-md" data-action="event-status" data-id="${v.id}" data-status="erledigt">${icon('check')}<span>Frist erledigt</span></button>` : '',
          ['abgesagt', 'erledigt'].includes(v.status)
            ? `<button type="button" class="btn-outline btn-md" data-action="event-status" data-id="${v.id}" data-status="bestaetigt">Wieder aktivieren</button>`
            : `<button type="button" class="btn-outline btn-md" data-action="event-status" data-id="${v.id}" data-status="abgesagt">Absagen</button>`,
          `<button type="button" class="btn-danger btn-md" data-action="event-delete" data-id="${v.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>`,
        ].join('');

    return `
      <h2 id="modalTitle" class="modal-title">${isNew ? 'Neuer Kalendereintrag' : esc(v.title)}</h2>
      <p class="modal-sub">${isNew ? 'Gerichtstermine, Fristen, Mandantengespräche und interne Termine – mit Countdown im Dashboard und Discord-Erinnerung 24 h vorher.' : `${esc(EVENT_TYPES[v.type] || v.type)} · ${statusBadge(EVENT_STATUS, v.status)}${v.creatorName ? ' · angelegt von ' + esc(v.creatorName) : ''}${v.clientName ? ' · Mandant: ' + esc(v.clientName) : ''}`}</p>
      ${!isNew && !['abgesagt', 'erledigt'].includes(v.status) ? `<div class="mb-4">${countdownHtml(v)}</div>` : ''}
      <form data-form="event" data-id="${isNew ? '' : v.id}" class="form-grid cols-2">
        <div class="span-2"><span class="label">Art</span><div class="seg">${Object.entries(EVENT_TYPES)
          .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="type" value="${k}" ${type === k ? 'checked' : ''}><span><i class="cal-dot" style="background:${EVENT_COLORS[k]}"></i>${esc(l)}</span></label>`)
          .join('')}</div></div>
        <div class="span-2"><label class="label" for="evTitle">Titel</label><input id="evTitle" name="title" class="field" required minlength="2" maxlength="120" value="${esc(v.title || '')}" placeholder="z. B. Hauptverhandlung Strafsache Doe" autofocus></div>
        <div><label class="label" for="evStart">Beginn / Fälligkeit</label><input id="evStart" name="startsAt" type="datetime-local" class="field" required value="${start}"></div>
        <div><label class="label" for="evEnd">Ende (optional)</label><input id="evEnd" name="endsAt" type="datetime-local" class="field" value="${v.endsAt ? toLocalInput(v.endsAt) : ''}"></div>
        <div><label class="label">Akte (optional)</label><select name="caseId" class="field"><option value="">Keine Akte</option>${caseOpts}</select></div>
        <div><label class="label">Zuständig</label><select name="assignedTo" class="field"><option value="">Niemand</option>${st.lawyers.map((l) => opt(l.id, l.displayName, l.id === assigned)).join('')}</select></div>
        <div class="span-2"><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="${esc(v.location ?? (type === 'frist' ? '' : 'Kanzlei Würfelpark'))}" placeholder="z. B. District Court, Saal 2"></div>
        <div class="span-2"><label class="label">Notiz</label><textarea name="note" rows="3" class="field" maxlength="1000" placeholder="Vorbereitung, Unterlagen, Hinweise …">${esc(v.note || '')}</textarea></div>
        <label class="check span-2"><input type="checkbox" name="clientVisible" ${visible ? 'checked' : ''}> Für den Mandanten im Portal sichtbar</label>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${isNew ? 'Eintrag anlegen' : 'Speichern'}</span></button></div>
      </form>
      ${statusBtns ? `<div class="form-actions mt-5 pt-5" style="border-top:1px solid var(--line)">${statusBtns}</div>` : ''}`;
  }

  function eventRequestForm(caseId) {
    const own = st.cases.filter((c) => c.status !== 'geschlossen');
    const min = toLocalInput(new Date(Date.now() + 15 * 60 * 1000).toISOString());
    return `
      <h2 class="modal-title">Termin anfragen</h2>
      <p class="modal-sub">Nennen Sie Ihren Wunschtermin – die Kanzlei bestätigt ihn oder schlägt eine Alternative vor.</p>
      <form data-form="event-request" class="form-grid cols-2">
        <div class="span-2"><label class="label">Anliegen</label><input name="title" class="field" required minlength="2" maxlength="120" placeholder="z. B. Beratungsgespräch" autofocus></div>
        <div><label class="label">Wunschtermin</label><input name="startsAt" type="datetime-local" class="field" required min="${min}"></div>
        <div><label class="label">Akte</label><select name="caseId" class="field"><option value="">Allgemeine Beratung</option>${own.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === caseId)).join('')}</select></div>
        <div class="span-2"><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="Kanzlei Würfelpark"></div>
        <div class="span-2"><label class="label">Notiz (optional)</label><textarea name="note" rows="3" class="field" maxlength="1000"></textarea></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Anfrage senden</span></button></div>
      </form>`;
  }

  function eventDetailClient(e) {
    const canCancel = e.clientId === st.user.id && !['abgesagt', 'erledigt'].includes(e.status) && parseDate(e.startsAt) > Date.now();
    const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
    return `
      <h2 id="modalTitle" class="modal-title">${esc(e.title)}</h2>
      <p class="modal-sub">${esc(EVENT_TYPES[e.type] || e.type)} · ${statusBadge(EVENT_STATUS, e.status)}</p>
      <div class="info-grid mb-4">${cell('Datum', fmtDay(e.startsAt))}${cell('Uhrzeit', fmtTime(e.startsAt) + ' Uhr')}${cell('Ort', e.location || '—')}${e.caseNumber ? cell('Akte', e.caseNumber) : ''}${e.assignedName ? cell('Ansprechpartner', e.assignedName) : ''}</div>
      ${!['abgesagt', 'erledigt'].includes(e.status) ? `<div class="mb-4">${countdownHtml(e)}</div>` : ''}
      ${e.note ? `<div class="tl-item mb-4"><div class="tl-body">${esc(e.note)}</div></div>` : ''}
      ${canCancel ? `<button class="btn-danger btn-md" data-action="event-status" data-id="${e.id}" data-status="abgesagt">Termin absagen</button>` : ''}`;
  }

  async function openEvent(id, returnCase = null) {
    let e = st.eventCache.get(id);
    if (!e) {
      await load.events();
      e = st.eventCache.get(id);
    }
    if (!e) throw new Error('Termin nicht gefunden.');
    st.returnCase = returnCase;
    if (isStaff()) {
      await Promise.all([load.cases(), load.lawyers()]);
      openModal(eventForm(e));
    } else {
      openModal(eventDetailClient(e));
    }
  }

  /* ---------------------------------------------------------------- Kanzlei-Post */
  function mailItem(m) {
    const inbox = st.mailBox === 'inbox';
    const who = inbox ? m.senderName : `An: ${m.recipientName}`;
    const unread = inbox && !m.isRead;
    return `<button type="button" class="mail-item ${unread ? 'unread' : ''} ${m.id === st.mailSel ? 'active' : ''}" data-action="mail-open" data-id="${m.id}">
      <div class="flex items-center gap-3">
        ${inbox ? `<span class="avatar sm">${avatarImg(m.senderAvatar, m.senderName)}</span>` : ''}
        <div class="min-w-0 flex-1">
          <div class="from"><span>${m.priority ? '❗ ' : ''}${esc(who)}</span><span class="text-xs text-dim nowrap">${esc(shortDate(m.createdAt))}</span></div>
          <div class="subj">${esc(m.subject || '(kein Betreff)')}${m.caseNumber ? ' · ' + esc(m.caseNumber) : ''}</div>
        </div>
      </div></button>`;
  }
  function mailReader(m) {
    const inbox = st.mailBox === 'inbox';
    return `
      <button class="btn-ghost btn-sm mb-3 lg:hidden" data-action="mail-back">${icon('chevronLeft', 'ico-sm')}<span>Zurück</span></button>
      <div class="flex flex-wrap items-center gap-2 mb-2">${m.priority ? badge('Wichtig', 'red') : ''}${m.caseNumber ? `<button class="badge badge-gold" data-action="open-case" data-id="${m.caseId}">Akte ${esc(m.caseNumber)}</button>` : ''}</div>
      <h2 class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(m.subject || '(kein Betreff)')}</h2>
      <div class="flex items-center gap-3 mt-3">
        <span class="avatar">${avatarImg(m.senderAvatar, m.senderName)}</span>
        <div class="text-sm text-dim min-w-0">Von <span class="text-muted">${esc(m.senderName)}</span>${m.senderRank ? ' (' + esc(m.senderRank) + ')' : ''} an <span class="text-muted">${esc(m.recipientName)}</span><br>${esc(fmtDate(m.createdAt))}</div>
      </div>
      <div class="mail-body">${esc(m.body)}</div>
      <div class="form-actions">
        ${inbox && m.senderId ? `<button class="btn-gold btn-md" data-action="mail-reply" data-id="${m.id}">${icon('reply', 'ico-sm')}<span>Antworten</span></button>` : ''}
        ${inbox ? `<button class="btn-outline btn-md" data-action="mail-unread" data-id="${m.id}">Als ungelesen</button>` : ''}
        <button class="btn-danger btn-md" data-action="mail-delete" data-id="${m.id}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
      </div>`;
  }

  views.mail = {
    async load() {
      await Promise.all([load.messages(), load.unread()]);
    },
    render() {
      const inbox = st.mailBox === 'inbox';
      const sel = st.messages.find((m) => m.id === st.mailSel) || null;
      return `
        <div class="page-head">
          <div><h1 class="page-title">Kanzlei-Post</h1><p class="page-sub">${isStaff() ? 'Interne Nachrichten, Notizen und Rundschreiben im Team – und Post von Mandanten.' : 'Ihre direkte und vertrauliche Verbindung zur Kanzlei.'}</p></div>
          <div class="page-actions">
            ${inbox && st.unread ? `<button class="btn-outline btn-md" data-action="mail-read-all">${icon('check', 'ico-sm')}<span>Alle gelesen</span></button>` : ''}
            <button class="btn-gold btn-md" data-action="compose">${icon('edit', 'ico-sm')}<span>Neue Nachricht</span></button>
          </div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${inbox ? 'active' : ''}" data-action="mail-box" data-value="inbox">Posteingang${st.unread ? ` <span class="chip-count">${st.unread}</span>` : ''}</button>
          <button class="chip ${!inbox ? 'active' : ''}" data-action="mail-box" data-value="sent">Gesendet</button>
        </div>
        <div class="mail-layout ${sel ? 'has-sel' : ''}">
          <div class="panel mail-list">${st.messages.length ? st.messages.map(mailItem).join('') : empty(inbox ? 'Ihr Posteingang ist leer.' : 'Noch keine gesendeten Nachrichten.', 'mail')}</div>
          <div class="panel mail-read">${sel ? mailReader(sel) : `<div class="empty">${icon('mail', 'ico-lg')}<p>Wählen Sie eine Nachricht aus.</p></div>`}</div>
        </div>`;
    },
  };

  async function composeModal(preset = {}) {
    await Promise.all([load.contacts(), load.cases()]);
    const staff = isStaff();
    const team = st.contacts.filter((c) => c.role !== 'mandant');
    const clients = st.contacts.filter((c) => c.role === 'mandant');
    const label = (c) => c.displayName + (c.rank ? ' · ' + c.rank : c.role === 'admin' ? ' · Kanzleileitung' : '');
    const cases = st.cases.filter((c) => c.status !== 'geschlossen' || c.id === preset.caseId);
    openModal(`
      <h2 class="modal-title">${preset.reply ? 'Antworten' : 'Neue Nachricht'}</h2>
      <p class="modal-sub">${staff ? 'Nachrichten sind nur für Absender und Empfänger sichtbar. Rundschreiben gehen an alle aktiven Teammitglieder.' : 'Ihre Nachricht geht direkt an das ausgewählte Kanzleimitglied.'}</p>
      <form data-form="compose" class="form-grid">
        <div><label class="label" for="cmpTo">Empfänger</label>
          <select id="cmpTo" name="recipient" class="field" required>
            <option value="">Bitte auswählen …</option>
            ${staff ? '<option value="broadcast">📢 Rundschreiben an das ganze Team</option>' : ''}
            ${team.length ? `<optgroup label="Kanzlei">${team.map((c) => opt(c.id, label(c), c.id === preset.recipientId)).join('')}</optgroup>` : ''}
            ${clients.length ? `<optgroup label="Mandanten">${clients.map((c) => opt(c.id, c.displayName, c.id === preset.recipientId)).join('')}</optgroup>` : ''}
          </select></div>
        <div><label class="label" for="cmpSubject">Betreff</label><input id="cmpSubject" name="subject" class="field" maxlength="150" value="${esc(preset.subject || '')}"></div>
        <div><label class="label">Bezug zur Akte (optional)</label><select name="caseId" class="field"><option value="">Kein Aktenbezug</option>${cases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === preset.caseId)).join('')}</select></div>
        <div><label class="label" for="cmpBody">Nachricht</label><textarea id="cmpBody" name="body" rows="7" class="field" required maxlength="5000" autofocus></textarea></div>
        <label class="check"><input type="checkbox" name="priority"> Als wichtig markieren</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('send', 'ico-sm')}<span>Senden</span></button></div>
      </form>`);
  }

  /* ---------------------------------------------------------------- Pinnwand */
  function noteCard(n) {
    const own = n.authorId === st.user.id || isAdmin();
    return `<article class="panel board-note" style="--note:${NOTE_COLORS[n.color] || NOTE_COLORS.gold}">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-semibold leading-snug">${n.pinned ? '📌 ' : ''}${esc(n.title || 'Notiz')}</h3>
        <div class="flex gap-1 shrink-0">
          <button class="icon-btn sm" data-action="board-pin" data-id="${n.id}" title="${n.pinned ? 'Lösen' : 'Anheften'}" aria-label="${n.pinned ? 'Lösen' : 'Anheften'}" ${n.pinned ? 'style="color:var(--gold-500)"' : ''}>${icon('pin', 'ico-sm')}</button>
          ${own ? `<button class="icon-btn sm" data-action="board-edit" data-id="${n.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="board-delete" data-id="${n.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>` : ''}
        </div></div>
      <div class="body">${esc(n.body)}</div>
      <div class="foot"><span>${esc(n.authorName)}</span><span>${esc(fmtDate(n.updatedAt))}</span></div></article>`;
  }
  function noteModal(n) {
    const v = n || { color: 'gold', pinned: false };
    openModal(`
      <h2 class="modal-title">${n ? 'Notiz bearbeiten' : 'Neue Notiz'}</h2>
      <p class="modal-sub">Für das ganze Team sichtbar – ideal für Hinweise, Übergaben und To-dos.</p>
      <form data-form="board" data-id="${n ? n.id : ''}" class="form-grid">
        <div><label class="label">Überschrift</label><input name="title" class="field" maxlength="120" value="${esc(v.title || '')}" placeholder="z. B. Übergabe Wochenende" autofocus></div>
        <div><label class="label">Text</label><textarea name="body" rows="6" class="field" required maxlength="4000">${esc(v.body || '')}</textarea></div>
        <div><span class="label">Farbe</span><div class="flex gap-3">${Object.entries(NOTE_COLORS)
          .map(([k, c]) => `<label class="color-opt" title="${k}"><input type="radio" name="color" value="${k}" ${v.color === k ? 'checked' : ''}><span class="color-dot" style="background:${c}"></span></label>`)
          .join('')}</div></div>
        <label class="check"><input type="checkbox" name="pinned" ${v.pinned ? 'checked' : ''}> Oben anheften (erscheint auch in der Übersicht)</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
  }
  views.board = {
    async load() {
      await load.board();
    },
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Team-Pinnwand</h1><p class="page-sub">Interne Notizen, Übergaben und Hinweise für die ganze Kanzlei.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="board-new">${icon('plus')}<span>Neue Notiz</span></button></div>
        </div>
        ${st.board.length ? `<div class="board-grid">${st.board.map(noteCard).join('')}</div>` : `<div class="panel">${empty('Noch keine Notizen. Heften Sie die erste an!', 'pin')}</div>`}`;
    },
  };

  /* ---------------------------------------------------------------- Rechnungen */
  function invoiceTable(rows) {
    const staff = isStaff();
    if (!rows.length) return empty(st.invoices.length ? 'Keine Dokumente für diese Auswahl.' : staff ? 'Noch keine Rechnungen erstellt.' : 'Es liegen keine Rechnungen vor.', 'receipt');
    return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Dokument</th><th>Empfänger</th><th>Akte</th><th style="text-align:right">Betrag</th><th>Status</th><th>Datum</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (i) => `<tr>
          <td class="td-main"><div class="font-mono text-gold text-sm">${esc(i.number)}</div><div class="text-xs text-dim">${esc(INVOICE_KIND[i.kind])}${i.subject ? ' · ' + esc(i.subject) : ''}</div></td>
          <td data-label="Empfänger">${esc(i.clientName)}</td>
          <td data-label="Akte">${i.caseNumber ? `<button class="text-gold font-mono text-xs hover:underline" data-action="open-case" data-id="${i.caseId}">${esc(i.caseNumber)}</button>` : '—'}</td>
          <td data-label="Betrag" class="font-mono nowrap" style="text-align:right">${money(i.total)}</td>
          <td data-label="Status">${statusBadge(INVOICE_STATUS, i.status)}</td>
          <td data-label="Datum" class="text-xs text-dim nowrap">${esc(fmtDate(i.createdAt))}${i.dueDate && i.status === 'offen' ? `<div>fällig ${esc(fmtDateOnly(i.dueDate))}</div>` : ''}</td>
          <td class="td-actions">
            <a class="btn-outline btn-sm" href="/invoice.html?id=${i.id}" target="_blank" rel="noopener">${icon('printer', 'ico-sm')}<span>PDF / Druck</span></a>
            ${staff && i.status === 'offen' ? `<button class="btn-gold btn-sm" data-action="inv-status" data-id="${i.id}" data-status="bezahlt">Bezahlt</button><button class="btn-ghost btn-sm" data-action="inv-status" data-id="${i.id}" data-status="storniert">Storno</button>` : ''}
            ${staff && i.status !== 'offen' ? `<button class="btn-ghost btn-sm" data-action="inv-status" data-id="${i.id}" data-status="offen">Wieder offen</button>` : ''}
            ${isAdmin() ? `<button class="icon-btn sm" data-action="inv-delete" data-id="${i.id}" data-number="${esc(i.number)}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>` : ''}
          </td></tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  views.invoices = {
    async load() {
      await load.invoices();
    },
    render() {
      const staff = isStaff();
      const f = st.invFilter;
      const rows = st.invoices.filter((i) => f === 'alle' || i.status === f);
      const sum = (s) => st.invoices.filter((i) => i.status === s).reduce((a, i) => a + i.total, 0);
      const count = (s) => st.invoices.filter((i) => s === 'alle' || i.status === s).length;
      return `
        <div class="page-head">
          <div><h1 class="page-title">${staff ? 'Rechnungen & Honorare' : 'Meine Rechnungen'}</h1>
            <p class="page-sub">${staff ? 'Offizielle Rechnungen und Honorarvereinbarungen – als PDF speichern oder drucken.' : 'Rechnungen und Honorarvereinbarungen zu Ihren Mandaten.'}</p></div>
          ${staff ? `<div class="page-actions"><button class="btn-gold btn-md" data-action="new-invoice">${icon('plus')}<span>Neues Dokument</span></button></div>` : ''}
        </div>
        ${staff ? `<div class="kpi-grid">
          <div class="panel kpi"><div class="kpi-label">${icon('clock', 'ico-sm')}Offene Forderungen</div><div class="kpi-value">${money(sum('offen'))}</div><div class="kpi-sub">${count('offen')} offen</div></div>
          <div class="panel kpi"><div class="kpi-label">${icon('check', 'ico-sm')}Bezahlt</div><div class="kpi-value">${money(sum('bezahlt'))}</div><div class="kpi-sub">${count('bezahlt')} Dokument(e)</div></div>
        </div>` : ''}
        <div class="chip-row mb-4">${[['alle', 'Alle'], ['offen', 'Offen'], ['bezahlt', 'Bezahlt'], ['storniert', 'Storniert']]
          .map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-action="inv-filter" data-value="${k}">${l} <span class="chip-count">${count(k)}</span></button>`)
          .join('')}</div>
        <div class="panel p-2 md:p-3">${invoiceTable(rows)}</div>`;
    },
  };

  /* ---------------------------------------------------------------- Rechnungs-/Honorar-Generator */
  function newDraft(caseId = null) {
    const d = {
      kind: 'rechnung',
      caseId,
      clientName: '',
      clientContact: '',
      subject: '',
      items: [],
      discountPct: 0,
      surchargePct: 0,
      dueDate: dayKey(new Date(Date.now() + 7 * 864e5)),
      notes: '',
    };
    applyCaseToDraft(d, caseId, true);
    return d;
  }
  function applyCaseToDraft(d, caseId, force = false) {
    const c = caseId ? st.cases.find((x) => x.id === caseId) : null;
    if (!c) return;
    if (force || !d.clientName) d.clientName = c.clientName === '—' ? '' : c.clientName;
    if (force || !d.clientContact) d.clientContact = c.clientPhone || c.clientEmail || '';
    if (force || !d.subject) d.subject = `Mandat ${c.caseNumber} – ${c.title}`.slice(0, 200);
  }
  function clampPct(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
  }
  function draftTotals(d) {
    const subtotal = d.items.reduce((s, it) => s + (Math.max(1, Math.round(Number(it.quantity) || 1))) * Math.max(0, Math.round(Number(it.unitPrice) || 0)), 0);
    const dp = clampPct(d.discountPct);
    const sp = clampPct(d.surchargePct);
    const discount = Math.round((subtotal * dp) / 100);
    const surcharge = Math.round(((subtotal - discount) * sp) / 100);
    return { subtotal, discount, surcharge, total: subtotal - discount + surcharge, dp, sp };
  }
  function itemRowHtml(it, i) {
    return `<div class="item-row">
      <input class="field item-desc" data-item="description" data-index="${i}" value="${esc(it.description)}" placeholder="Leistung / Beschreibung" maxlength="200" aria-label="Leistung">
      <input class="field item-qty" data-item="quantity" data-index="${i}" type="number" inputmode="numeric" min="1" max="999" step="1" value="${esc(it.quantity)}" aria-label="Menge">
      <input class="field item-price" data-item="unitPrice" data-index="${i}" type="number" inputmode="numeric" min="0" step="1" value="${esc(it.unitPrice)}" aria-label="Einzelpreis in Dollar">
      <div class="item-total" data-item-total="${i}">${money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</div>
      <button type="button" class="icon-btn sm item-remove" data-action="inv-remove-item" data-index="${i}" aria-label="Position entfernen">${icon('x', 'ico-sm')}</button></div>`;
  }
  function summaryHtml() {
    const d = st.draft;
    const t = draftTotals(d);
    return `
      <h2 class="panel-title mb-3">${esc(INVOICE_KIND[d.kind])}</h2>
      <div class="sum-row"><span class="text-muted">Positionen</span><span class="v">${d.items.length}</span></div>
      <div class="sum-row"><span class="text-muted">Zwischensumme</span><span class="v">${money(t.subtotal)}</span></div>
      ${t.dp ? `<div class="sum-row" style="color:#6ee7b7"><span>Rabatt (${fmtPct(t.dp)} %)</span><span class="v">− ${money(t.discount)}</span></div>` : ''}
      ${t.sp ? `<div class="sum-row" style="color:#fcd34d"><span>Zuschlag (${fmtPct(t.sp)} %)</span><span class="v">+ ${money(t.surcharge)}</span></div>` : ''}
      <div class="sum-row sum-total"><span class="font-semibold">Gesamtbetrag</span><span class="v">${money(t.total)}</span></div>
      <p class="form-hint mb-4">Nach dem Erstellen öffnet sich die Druckansicht – dort „Als PDF speichern“ wählen.</p>
      <button type="submit" class="btn-gold btn-lg btn-block">${icon('check')}<span>Dokument erstellen</span></button>
      <a href="#invoices" class="btn-ghost btn-md btn-block mt-2">Abbrechen</a>`;
  }
  function updateInvoiceSummary() {
    const box = $('#invSummary');
    if (box) box.innerHTML = summaryHtml();
    st.draft.items.forEach((it, i) => {
      const el = $(`[data-item-total="${i}"]`);
      if (el) el.textContent = money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0));
    });
  }

  views['invoice-new'] = {
    async load() {
      await Promise.all([load.fees(), load.cases()]);
      if (!st.draft) st.draft = newDraft();
    },
    render() {
      const d = st.draft;
      const feeOpts = Object.entries(FEE_CATEGORIES)
        .map(([cat, label]) => {
          const list = st.fees.filter((f) => f.category === cat);
          return list.length ? `<optgroup label="${esc(label)}">${list.map((f) => opt(f.id, `${f.name} – ${money(f.price)}`)).join('')}</optgroup>` : '';
        })
        .join('');
      const hv = d.kind === 'honorarvereinbarung';
      return `
        <div class="page-head">
          <div><a href="#invoices" class="text-sm text-dim hover:text-white inline-flex items-center gap-1">${icon('chevronLeft', 'ico-sm')}Rechnungen</a>
            <h1 class="page-title mt-1">Rechnung / Honorar erstellen</h1>
            <p class="page-sub">Positionen aus der Honorarordnung übernehmen oder frei erfassen – Summen werden live berechnet.</p></div>
        </div>
        <form id="invoiceForm" data-form="invoice" class="inv-layout" novalidate>
          <div class="stack">
            <section class="panel panel-pad">
              <div class="seg mb-4">
                <label class="seg-opt"><input type="radio" name="kind" value="rechnung" ${!hv ? 'checked' : ''}><span>${icon('receipt', 'ico-sm')}Rechnung</span></label>
                <label class="seg-opt"><input type="radio" name="kind" value="honorarvereinbarung" ${hv ? 'checked' : ''}><span>${icon('scale', 'ico-sm')}Honorarvereinbarung</span></label>
              </div>
              <div class="form-grid cols-2">
                <div class="span-2"><label class="label">Akte (optional)</label><select name="caseId" class="field"><option value="">Ohne Aktenbezug</option>${st.cases.map((c) => opt(c.id, `${c.caseNumber} – ${c.title}`, c.id === d.caseId)).join('')}</select></div>
                <div><label class="label">Empfänger / Mandant</label><input name="clientName" class="field" required maxlength="120" value="${esc(d.clientName)}" placeholder="Name des Mandanten"></div>
                <div><label class="label">Kontakt (Telefon / E-Mail)</label><input name="clientContact" class="field" maxlength="120" value="${esc(d.clientContact)}" placeholder="optional"></div>
                <div class="span-2"><label class="label">Betreff / Leistungsgegenstand</label><input name="subject" class="field" maxlength="200" value="${esc(d.subject)}" placeholder="z. B. Strafverteidigung – Verfahren wegen …"></div>
              </div>
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Positionen</h2></div>
              <div class="flex flex-col sm:flex-row gap-2 mb-4">
                <select id="feePicker" class="field" aria-label="Leistung aus der Honorarordnung">${feeOpts || '<option value="">Honorarordnung ist leer</option>'}</select>
                <button type="button" class="btn-outline btn-md" data-action="inv-add-fee">${icon('plus', 'ico-sm')}<span>Übernehmen</span></button>
                <button type="button" class="btn-ghost btn-md" data-action="inv-add-item">${icon('edit', 'ico-sm')}<span>Freie Position</span></button>
              </div>
              <div class="item-head"><span>Leistung</span><span>Menge</span><span>Einzelpreis ($)</span><span style="text-align:right">Summe</span><span></span></div>
              <div id="invItems">${d.items.length ? d.items.map(itemRowHtml).join('') : '<p class="text-sm text-dim py-4">Noch keine Positionen – übernehmen Sie eine Leistung aus der Honorarordnung.</p>'}</div>
            </section>
            <section class="panel panel-pad">
              <div class="form-grid cols-2">
                <div><label class="label">Rabatt in %</label><input name="discountPct" type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field" value="${esc(d.discountPct)}">
                  <div class="chip-row mt-2"><button type="button" class="chip" data-action="inv-preset" data-field="discountPct" data-value="10">Mandatsbündel 10 %</button><button type="button" class="chip" data-action="inv-preset" data-field="discountPct" data-value="0">Kein Rabatt</button></div></div>
                <div><label class="label">Zuschlag in %</label><input name="surchargePct" type="number" inputmode="decimal" min="0" max="100" step="0.5" class="field" value="${esc(d.surchargePct)}">
                  <div class="chip-row mt-2"><button type="button" class="chip" data-action="inv-preset" data-field="surchargePct" data-value="15">Priorisiert +15 %</button><button type="button" class="chip" data-action="inv-preset" data-field="surchargePct" data-value="0">Kein Zuschlag</button></div></div>
                <div><label class="label">Zahlbar bis</label><input name="dueDate" type="date" class="field" value="${esc(d.dueDate || '')}"></div>
                <div class="span-2"><label class="label">${hv ? 'Vereinbarungstext / Bedingungen' : 'Anmerkungen'}</label>
                  <textarea name="notes" rows="4" class="field" maxlength="3000" placeholder="${hv ? 'z. B. Die Vergütung ist als Vorschuss vor Aufnahme der Tätigkeit fällig. Zusätzliche Termine werden gesondert berechnet.' : 'z. B. Vielen Dank für Ihr Vertrauen.'}">${esc(d.notes)}</textarea></div>
              </div>
            </section>
          </div>
          <aside id="invSummary" class="panel panel-pad inv-summary">${summaryHtml()}</aside>
        </form>`;
    },
  };

  function onInvoiceInput(t) {
    const d = st.draft;
    if (!d) return;
    if (t.dataset.item) {
      const it = d.items[Number(t.dataset.index)];
      if (!it) return;
      it[t.dataset.item] = t.dataset.item === 'description' ? t.value : t.value === '' ? '' : Number(t.value);
    } else if (['clientName', 'clientContact', 'subject', 'notes', 'dueDate'].includes(t.name)) {
      d[t.name] = t.value;
    } else if (t.name === 'discountPct' || t.name === 'surchargePct') {
      d[t.name] = t.value === '' ? 0 : Number(t.value);
    }
    updateInvoiceSummary();
  }
  function onInvoiceChange(t) {
    const d = st.draft;
    if (!d) return;
    if (t.name === 'kind') {
      d.kind = t.value;
      renderView();
    } else if (t.name === 'caseId') {
      d.caseId = t.value ? Number(t.value) : null;
      applyCaseToDraft(d, d.caseId);
      renderView();
    } else {
      onInvoiceInput(t);
    }
  }

  /* ---------------------------------------------------------------- Team-Verwaltung */
  function memberCard(m, i, total) {
    const account = m.userId
      ? `${badge(m.userActive ? 'Login aktiv' : 'Login gesperrt', m.userActive ? 'emerald' : 'red')}<span class="text-xs text-dim">${esc(m.userEmail || '')} · ${esc(ROLES[m.userRole] || '')}</span>`
      : badge('Kein Login-Konto', 'slate');
    return `<div class="panel member-card">
      <span class="avatar-wrap"><span class="avatar lg ${m.tier === 'leitung' ? '' : 'slate'}">${m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials)}</span>${m.duty ? `<span class="presence s-${esc(m.duty)}"></span>` : ''}</span>
      <div class="body">
        <div class="flex flex-wrap items-center gap-2"><h3 class="font-serif text-xl font-semibold">${esc(m.name)}</h3>${m.visible ? '' : badge('Auf Website ausgeblendet', 'amber')}</div>
        <div class="text-xs uppercase tracking-widest text-gold mt-0.5">${esc(m.roleTitle)} · ${m.tier === 'leitung' ? 'Board of Partners' : 'Associate Attorneys'}</div>
        ${m.description ? `<p class="text-sm text-muted mt-2">${esc(m.description)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-3">${account}</div>
      </div>
      <div class="actions">
        <button class="icon-btn sm" data-action="team-move" data-id="${m.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${icon('chevronUp', 'ico-sm')}</button>
        <button class="icon-btn sm" data-action="team-move" data-id="${m.id}" data-dir="1" ${i === total - 1 ? 'disabled' : ''} aria-label="Nach unten">${icon('chevronDown', 'ico-sm')}</button>
        <button class="btn-outline btn-sm" data-action="team-edit" data-id="${m.id}">${icon('edit', 'ico-sm')}<span>Bearbeiten</span></button>
        <button class="icon-btn sm" data-action="team-delete" data-id="${m.id}" aria-label="Entfernen">${icon('trash', 'ico-sm')}</button>
      </div></div>`;
  }

  function teamPhotoControls(m) {
    return `<div class="flex flex-wrap gap-2">
        <label class="btn-outline btn-sm file-btn">${icon('camera', 'ico-sm')}<span>Foto hochladen</span><input type="file" accept="image/*" data-upload="team" data-id="${m.id}" aria-label="Foto hochladen"></label>
        ${m.hasOwnPhoto ? `<button type="button" class="btn-ghost btn-sm" data-action="team-photo-remove" data-id="${m.id}">Foto entfernen</button>` : ''}
      </div>
      <p class="form-hint">${m.hasOwnPhoto ? 'Eigenes Foto für die Website.' : 'Ohne eigenes Foto wird das Profilbild des verknüpften Kontos verwendet.'}</p>`;
  }

  function memberModal(m) {
    const isNew = !m;
    const v = m || { tier: 'anwalt', visible: true };
    const linkable = st.users.filter((u) => u.role !== 'mandant' && !st.team.some((t) => t.userId === u.id));
    const accountBlock =
      m && m.userId
        ? `<p class="text-sm mb-3">Verknüpft mit <strong>${esc(m.userEmail)}</strong> (${esc(ROLES[m.userRole] || '')}). Name und Rang werden automatisch ins Konto übernommen.</p>
           <label class="check"><input type="checkbox" name="unlink"> Verknüpfung lösen (das Login-Konto selbst bleibt bestehen)</label>`
        : `<div class="seg mb-3">
             <label class="seg-opt"><input type="radio" name="accountMode" value="none" checked><span>Kein Konto</span></label>
             ${linkable.length ? '<label class="seg-opt"><input type="radio" name="accountMode" value="link"><span>Bestehendes verknüpfen</span></label>' : ''}
             <label class="seg-opt"><input type="radio" name="accountMode" value="create"><span>Neues Login-Konto</span></label>
           </div>
           <div data-account-pane="link" class="hidden"><select name="userId" class="field"><option value="">Konto wählen …</option>${linkable.map((u) => opt(u.id, `${u.displayName} (${u.email})`)).join('')}</select></div>
           <div data-account-pane="create" class="hidden">
             <div class="form-grid cols-2">
               <div><label class="label">E-Mail (Login)</label><input name="accountEmail" type="email" class="field" placeholder="vorname.nachname@pake-scha.ls"></div>
               <div><label class="label">Rolle</label><select name="accountRole" class="field">${opt('anwalt', 'Anwalt')}${opt('admin', 'Kanzleileitung (Admin)')}</select></div>
             </div>
             <p class="form-hint">Es wird ein Einmal-Passwort erzeugt und nach dem Speichern angezeigt.</p>
           </div>`;
    openModal(`
      <h2 class="modal-title">${isNew ? 'Teammitglied hinzufügen' : 'Teammitglied bearbeiten'}</h2>
      <p class="modal-sub">Änderungen erscheinen sofort im Bereich „Unser Team“ auf der Website.</p>
      <form data-form="team" data-id="${m ? m.id : ''}" class="form-grid cols-2">
        ${m
          ? `<div class="span-2 flex flex-wrap items-center gap-4">
              <span id="tmPhoto" class="avatar xl ${m.tier === 'leitung' ? '' : 'slate'}">${m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials)}</span>
              <div id="tmPhotoCtl">${teamPhotoControls(m)}</div>
            </div>`
          : '<p class="span-2 form-hint">Ein Foto für die Website können Sie direkt nach dem Anlegen hinzufügen.</p>'}
        <div class="span-2"><label class="label" for="tmName">Name</label><input id="tmName" name="name" class="field" required minlength="2" maxlength="80" value="${esc(v.name || '')}" placeholder="z. B. Dr. jur. Damat Lex" autofocus></div>
        <div><label class="label" for="tmRank">Rang / Titel</label><input id="tmRank" name="roleTitle" class="field" list="rankList" required minlength="2" maxlength="80" value="${esc(v.roleTitle || '')}" placeholder="z. B. Senior Associate">
          <datalist id="rankList">${RANKS.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist></div>
        <div><label class="label" for="tmTier">Ebene auf der Website</label><select id="tmTier" name="tier" class="field">${opt('leitung', 'Board of Partners (gold)', v.tier === 'leitung')}${opt('anwalt', 'Associate Attorneys', v.tier !== 'leitung')}</select></div>
        <div class="span-2"><label class="label" for="tmDesc">Kurzbeschreibung</label><textarea id="tmDesc" name="description" class="field" rows="3" maxlength="400" placeholder="Schwerpunkte, Zuständigkeiten …">${esc(v.description || '')}</textarea></div>
        <div><label class="label" for="tmInit">Initialen</label><input id="tmInit" name="initials" class="field" maxlength="5" value="${esc(v.initials || '')}" placeholder="automatisch"></div>
        <div class="flex items-end pb-2"><label class="check"><input type="checkbox" name="visible" ${v.visible ? 'checked' : ''}> Auf der Website anzeigen</label></div>
        <fieldset class="span-2 rounded-2xl p-4" style="border:1px solid var(--glass-border);background:rgba(15,23,42,.35)">
          <legend class="label px-1 mb-0">Login-Konto fürs Dashboard</legend>${accountBlock}
        </fieldset>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>${isNew ? 'Hinzufügen' : 'Speichern'}</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
      </form>`);
  }

  views.team = {
    async load() {
      const [t, u] = await Promise.all([api.get('/api/admin/team'), api.get('/api/admin/users')]);
      st.team = t.team;
      st.users = u.users;
    },
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Team-Verwaltung</h1><p class="page-sub">Teammitglieder hinzufügen, umbenennen, Ränge ändern oder entfernen – live auf der Website.</p></div>
          <div class="page-actions"><a href="/#team" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Website ansehen</span></a><button class="btn-gold btn-md" data-action="team-new">${icon('plus')}<span>Mitglied hinzufügen</span></button></div>
        </div>
        ${st.team.length ? `<div class="stack">${st.team.map((m, i) => memberCard(m, i, st.team.length)).join('')}</div>` : `<div class="panel">${empty('Noch keine Teammitglieder.', 'users')}</div>`}`;
    },
  };

  /* ---------------------------------------------------------------- Benutzer */
  function userTable() {
    const q = st.userQuery.trim().toLowerCase();
    const f = st.userFilter;
    const rows = st.users.filter(
      (u) =>
        (f === 'alle' || (f === 'team' ? u.role !== 'mandant' : f === 'mandanten' ? u.role === 'mandant' : !u.active)) &&
        (!q || `${u.displayName} ${u.email} ${u.rank || ''}`.toLowerCase().includes(q))
    );
    if (!rows.length) return empty('Keine Benutzer gefunden.', 'users');
    return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Name</th><th>Rolle</th><th>Rang</th><th>Discord</th><th>Letzter Login</th><th></th></tr></thead>
      <tbody>${rows
        .map((u) => {
          const self = u.id === st.user.id;
          return `<tr>
            <td class="td-main"><div class="flex items-center gap-3">${avatarWrap(u.avatarUrl, u.displayName, u.duty, 'sm')}<div class="min-w-0">
              <div class="font-medium flex flex-wrap items-center gap-2">${esc(u.displayName)}${self ? badge('Sie', 'gold') : ''}${!u.active ? badge('Gesperrt', 'red') : ''}${u.mustChangePassword ? badge('Einmal-Passwort', 'amber') : ''}${u.dutyLabel ? badge(u.dutyLabel, 'emerald') : ''}</div>
              <div class="text-xs text-dim break-all">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div></div></div></td>
            <td data-label="Rolle"><select class="field" style="min-width:150px" data-user-field="role" data-id="${u.id}" ${self ? 'disabled' : ''} aria-label="Rolle">${Object.entries(ROLES).map(([k, l]) => opt(k, l, u.role === k)).join('')}</select></td>
            <td data-label="Rang"><input class="field" style="min-width:150px" data-user-field="rank" data-id="${u.id}" maxlength="60" list="rankListUsers" value="${esc(u.rank || '')}" placeholder="—" aria-label="Rang"></td>
            <td data-label="Discord" class="text-sm">${u.discordUsername ? esc(u.discordUsername) : '<span class="text-dim">—</span>'}</td>
            <td data-label="Letzter Login" class="text-xs text-dim nowrap">${esc(fmtDate(u.lastLoginAt))}</td>
            <td class="td-actions">${
              self
                ? ''
                : `<button class="btn-outline btn-sm" data-action="user-reset" data-id="${u.id}" title="Einmal-Passwort erzeugen">${icon('key', 'ico-sm')}<span>Passwort</span></button>
                   <button class="btn-ghost btn-sm" data-action="user-toggle" data-id="${u.id}">${u.active ? 'Sperren' : 'Entsperren'}</button>
                   <button class="icon-btn sm" data-action="user-delete" data-id="${u.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button>`
            }</td></tr>`;
        })
        .join('')}</tbody></table></div>
      <datalist id="rankListUsers">${RANKS.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>`;
  }

  views.users = {
    async load() {
      st.users = (await api.get('/api/admin/users')).users;
    },
    render() {
      const count = (f) => st.users.filter((u) => f === 'alle' || (f === 'team' ? u.role !== 'mandant' : f === 'mandanten' ? u.role === 'mandant' : !u.active)).length;
      return `
        <div class="page-head">
          <div><h1 class="page-title">Benutzer & Zugänge</h1><p class="page-sub">Rollen vergeben, Konten sperren und vergessene Passwörter per Klick zurücksetzen – ganz ohne Shell.</p></div>
          <div class="page-actions"><button class="btn-gold btn-md" data-action="user-new">${icon('plus')}<span>Konto anlegen</span></button></div>
        </div>
        <div class="toolbar">
          <label class="search">${icon('search')}<input id="userSearch" class="field" type="search" placeholder="Name oder E-Mail …" value="${esc(st.userQuery)}" aria-label="Benutzer suchen"></label>
          <div class="chip-row">${[['alle', 'Alle'], ['team', 'Team'], ['mandanten', 'Mandanten'], ['gesperrt', 'Gesperrt']]
            .map(([k, l]) => `<button class="chip ${st.userFilter === k ? 'active' : ''}" data-action="user-filter" data-value="${k}">${l} <span class="chip-count">${count(k)}</span></button>`)
            .join('')}</div>
        </div>
        <div id="userList" class="panel p-2 md:p-3">${userTable()}</div>`;
    },
  };

  async function updateUserField(t) {
    const id = Number(t.dataset.id);
    const field = t.dataset.userField;
    const value = field === 'rank' ? t.value.trim() || null : t.value;
    if (field === 'role' && !(await ask(`Die Rolle wird auf „${ROLES[value]}“ geändert. Das Konto wird dabei abgemeldet.`, { title: 'Rolle ändern?', confirmText: 'Rolle ändern' }))) {
      $('#userList').innerHTML = userTable();
      return;
    }
    try {
      await api.patch('/api/admin/users/' + id, { [field]: value });
      toast('Gespeichert.');
    } finally {
      await views.users.load();
      if (st.view === 'users') $('#userList').innerHTML = userTable();
    }
  }

  /* ---------------------------------------------------------------- Honorarordnung */
  function feeModal(f, category) {
    const v = f || { category: category || 'rechtsberatung', inCalculator: true, active: true, price: 0 };
    openModal(`
      <h2 class="modal-title">${f ? 'Leistung bearbeiten' : 'Neue Leistung'}</h2>
      <p class="modal-sub">Erscheint sofort in der Honorarordnung, im Tarifrechner der Website und im Rechnungs-Generator.</p>
      <form data-form="fee" data-id="${f ? f.id : ''}" class="form-grid cols-2">
        <div class="span-2"><label class="label">Bezeichnung</label><input name="name" class="field" required minlength="2" maxlength="120" value="${esc(v.name || '')}" autofocus></div>
        <div><label class="label">Kategorie</label><select name="category" class="field">${Object.entries(FEE_CATEGORIES).map(([k, l]) => opt(k, l, v.category === k)).join('')}</select></div>
        <div><label class="label">Preis ($)</label><input name="price" type="number" inputmode="numeric" min="0" step="1" required class="field" value="${esc(v.price)}"></div>
        <div class="span-2"><label class="label">Beschreibung</label><textarea name="description" rows="3" maxlength="400" class="field">${esc(v.description || '')}</textarea></div>
        <div><label class="label">Reihenfolge</label><input name="sortOrder" type="number" min="0" step="1" class="field" value="${esc(v.sortOrder ?? '')}" placeholder="automatisch"></div>
        <div class="flex flex-col justify-end gap-2 pb-1">
          <label class="check"><input type="checkbox" name="inCalculator" ${v.inCalculator ? 'checked' : ''}> Im Tarifrechner anbieten</label>
          <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Auf der Website anzeigen</label>
        </div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
  }
  views.fees = {
    async load() {
      st.adminFees = (await api.get('/api/admin/fees')).fees;
    },
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Honorarordnung</h1><p class="page-sub">Preise und Leistungen pflegen – die Website und der Tarifrechner übernehmen Änderungen sofort.</p></div>
          <div class="page-actions"><a href="/#honorar" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Website ansehen</span></a><button class="btn-gold btn-md" data-action="fee-new">${icon('plus')}<span>Leistung hinzufügen</span></button></div>
        </div>
        ${Object.entries(FEE_CATEGORIES)
          .map(([cat, label]) => {
            const rows = st.adminFees.filter((f) => f.category === cat);
            return `<section class="panel panel-pad mb-4">
              <div class="panel-head"><h2 class="panel-title">${esc(label)}</h2><button class="btn-ghost btn-sm" data-action="fee-new" data-category="${cat}">${icon('plus', 'ico-sm')}<span>Leistung</span></button></div>
              ${rows.length
                ? rows
                    .map(
                      (f) => `<div class="list-row wrap"><div class="main"><div class="title">${esc(f.name)} ${!f.active ? badge('Ausgeblendet', 'slate') : ''} ${f.inCalculator ? badge('Tarifrechner', 'sky') : ''}</div><div class="meta">${esc(f.description)}</div></div>
                      <div class="flex items-center gap-2 shrink-0"><span class="font-mono text-gold nowrap">${money(f.price)}</span>
                      <button class="icon-btn sm" data-action="fee-edit" data-id="${f.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button>
                      <button class="icon-btn sm" data-action="fee-delete" data-id="${f.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></div>`
                    )
                    .join('')
                : '<p class="text-sm text-dim py-2">Keine Leistungen in dieser Kategorie.</p>'}
            </section>`;
          })
          .join('')}`;
    },
  };

  /* ---------------------------------------------------------------- Einstellungen */
  /* ---------------------------------------------------------------- FiveNet: Verbindungsstatus & Schnittstellenprüfung */
  const INTERFACE_STATUS = {
    unavailable: ['Nicht vorhanden', 'slate'],
    blocked: ['Nur mit Passwort-Sitzung', 'red'],
    unsuitable: ['Ungeeignet', 'amber'],
    respected: ['Berücksichtigt', 'emerald'],
    used: ['Genutzt', 'emerald'],
  };
  function fivenetInterfaces() {
    const list = st.fivenet?.interfaces || [];
    return `<div class="if-list">${list
      .map((i) => `<div class="if-row"><div class="flex items-center justify-between gap-2 flex-wrap"><strong class="text-sm">${esc(i.label)}</strong>${statusBadge(INTERFACE_STATUS, i.status)}</div><p class="text-xs text-dim mt-1">${esc(i.note)}</p></div>`)
      .join('')}</div>`;
  }
  function fivenetProfilePanel() {
    const fn = st.fivenet;
    if (!fn) return '';
    const cap = fn.capabilities;
    const row = (k, v, ok) => `<div class="fn-status-row"><span class="k">${esc(k)}</span><span class="v ${ok ? 'text-emerald-300' : 'text-dim'}">${v}</span></div>`;
    return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('link')} FiveNet-Verbindung</h2>${badge('Referenz-Modus', 'gold')}</div>
      <div class="fn-status">
        ${row('Instanz', `<a class="link-btn" href="${esc(fn.instance.url)}" target="_blank" rel="noopener noreferrer">${esc(fn.instance.host)} ↗</a>`, true)}
        ${row('Account', cap.accountLink ? 'Verbunden ✓' : 'Nicht verbindbar – FiveNet bietet keine Freigabe für externe Anwendungen', cap.accountLink)}
        ${row('Aktiver Charakter', cap.characterSelect ? 'Abrufbar' : 'Nicht abrufbar – FiveNet gibt ihn nur in der eigenen Oberfläche preis', cap.characterSelect)}
        ${row('Dokumentabruf', cap.documentFetch ? 'Automatisch' : 'Nicht automatisch – Text & Bilder per Kopieren/Einfügen übernehmen', cap.documentFetch)}
        ${fn.lastViewedAs ? row('Zuletzt angegeben', `„${esc(fn.lastViewedAs)}“ <span class="text-xs">(eigene Angabe)</span>`, false) : ''}
      </div>
      <div class="banner banner-amber mt-4 mb-0">${icon('shield')}<div><strong>Niemals das FiveNet-Passwort eingeben.</strong> Die Kanzlei-Plattform fragt nie danach. Eine Verbindung über Passwort oder Sitzungs-Cookies wäre unsicher und ist bewusst nicht vorgesehen.</div></div>
      <ol class="text-sm text-muted list-decimal pl-5 mt-4 space-y-1">
        <li>In FiveNet den Charakter wählen, der das Dokument sehen darf.</li>
        <li>Dokument öffnen und die Adresse aus der Adresszeile kopieren.</li>
        <li>In der Akte „FiveNet-Dokument hinzufügen“ – die Dokument-ID wird automatisch erkannt.</li>
        <li>Optional: den Dokumentinhalt in FiveNet markieren, Strg+C, im Feld „Inhalt aus FiveNet“ Strg+V – Text wird zur Abschrift, Bilder werden als Anhang übernommen.</li>
      </ol>
      <details class="edit-box mt-4"><summary>Ergebnis der Schnittstellenprüfung</summary>${fivenetInterfaces()}</details>
    </section>`;
  }
  function fivenetSettingsPanel(s) {
    const fn = st.fivenet;
    const inst = s.fivenetInstance;
    return `<section class="panel panel-pad mt-4 lg:mt-5">
      <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${icon('link')} FiveNet</h2>${badge(inst.host, 'gold')}</div>
      <p class="text-sm text-muted mb-4">Akten können FiveNet-Dokumente als geprüfte Referenz enthalten (Link, Dokument-ID, Angaben des Anwalts). ${fn ? `Derzeit <strong>${fn.stats.links}</strong> Verknüpfung${fn.stats.links === 1 ? '' : 'en'} mit <strong>${fn.stats.documents}</strong> Dokument${fn.stats.documents === 1 ? '' : 'en'}.` : ''}</p>
      <div class="grid-2">
        <form data-form="settings-fivenet" class="form-grid top">
          <div><label class="label">Adresse der FiveNet-Instanz</label><input name="fivenetUrl" class="field font-mono text-sm" maxlength="200" value="${esc(s.fivenetUrl)}" placeholder="${esc(s.fivenetEnvUrl || s.fivenetDefaultUrl)}" autocomplete="off">
            <p class="form-hint">Leer lassen = ${s.fivenetEnvUrl ? 'Umgebungsvariable FIVENET_URL' : 'Standard'} (${esc(s.fivenetEnvUrl || s.fivenetDefaultUrl)}). Nur Links dieser Instanz werden in Akten angenommen; bestehende Verknüpfungen behalten ihre Adresse.</p></div>
          <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
            <button type="button" class="btn-outline btn-md" data-action="fn-check">${icon('globe', 'ico-sm')}<span>Erreichbarkeit prüfen</span></button></div>
          <div id="fnCheckResult" class="text-sm" aria-live="polite"></div>
        </form>
        <div><div class="label">Ergebnis der Schnittstellenprüfung (FiveNet v2026.9)</div>${fivenetInterfaces()}</div>
      </div>
    </section>`;
  }

  views.settings = {
    async load() {
      const [r] = await Promise.all([api.get('/api/admin/settings'), load.fivenet(true)]);
      st.settings = r.settings;
    },
    render() {
      const s = st.settings;
      return `
        <div class="page-head"><div><h1 class="page-title">Einstellungen</h1><p class="page-sub">Discord-Anbindung, Rechnungsdaten und Notfall-Zugang.</p></div></div>
        <div class="grid-2">
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Discord-Webhook</h2>${s.discordWebhookActive ? badge('Aktiv', 'emerald') : badge('Nicht verbunden', 'slate')}</div>
            <p class="text-sm text-muted mb-4">Wichtige Kanzlei-Updates (neue Mandate, Fristen, Terminanfragen …) automatisch in einen Discord-Kanal senden. In Discord: Kanal → Einstellungen → Integrationen → Webhooks → „Neuer Webhook“ → URL kopieren.</p>
            <form data-form="settings-discord" class="form-grid">
              <div><label class="label">Webhook-URL</label><input name="webhook" class="field font-mono text-xs" value="${esc(s.discordWebhookUrl)}" placeholder="https://discord.com/api/webhooks/…" autocomplete="off">
                ${s.discordWebhookFromEnv ? '<p class="form-hint">Aktuell wird die URL aus der Umgebungsvariable DISCORD_WEBHOOK_URL verwendet.</p>' : ''}</div>
              <div><label class="label" for="pingRole">Rolle pingen (Rollen-ID)</label><input id="pingRole" name="pingRole" class="field font-mono text-xs" value="${esc(s.discordPingRole)}" placeholder="z. B. 1546979799820537986" inputmode="numeric" autocomplete="off">
                <p class="form-hint">Diese Rolle wird bei den unten markierten Ereignissen im Kanal erwähnt – z. B. die Anwälte bei jeder neuen Mandatsanfrage. Rollen-ID in Discord: Einstellungen → Erweitert → Entwicklermodus an, dann Servereinstellungen → Rollen → Rechtsklick auf die Rolle → „Rollen-ID kopieren“. @everyone/@here werden nie gepingt.</p></div>
              <div><div class="ev-grid"><span class="label">Ereignis</span><span class="label">Nachricht</span><span class="label">Rolle pingen</span>
                ${Object.entries(s.availableEvents)
                  .map(([k, l]) => `<span class="text-sm">${esc(l)}</span>
                    <input type="checkbox" name="events" value="${esc(k)}" ${s.discordEvents.includes(k) ? 'checked' : ''} aria-label="Nachricht bei: ${esc(l)}">
                    <input type="checkbox" name="pingEvents" value="${esc(k)}" ${s.discordPingEvents.includes(k) ? 'checked' : ''} aria-label="Rolle pingen bei: ${esc(l)}">`)
                  .join('')}</div></div>
              <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button>
                <button type="button" class="btn-outline btn-md" data-action="discord-test" ${s.discordWebhookActive ? '' : 'disabled'}>${icon('send', 'ico-sm')}<span>Testnachricht</span></button></div>
            </form>
          </section>
          <div class="stack">
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Website</h2></div>
              <form data-form="settings-website" class="form-grid">
                <label class="check"><input type="checkbox" name="showDutyPublic" ${s.showDutyPublic ? 'checked' : ''}> Dienststatus öffentlich anzeigen – „Eilnotdienst: 2 Anwälte im Dienst“ in der Kopfzeile und grüne Punkte bei den Teamkarten</label>
                <div class="form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button><a href="/karriere.html" target="_blank" rel="noopener" class="btn-ghost btn-md">${icon('globe', 'ico-sm')}<span>Karriereseite</span></a></div>
              </form>
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Discord-Login</h2>${s.discordOAuthConfigured ? badge('Eingerichtet', 'emerald') : badge('Nicht eingerichtet', 'slate')}</div>
              <p class="text-sm text-muted">Teammitglieder und Mandanten können ihr Discord-Konto im Profil verknüpfen und sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Fristen und Zuweisungen im Kanal erwähnt.</p>
              ${s.discordOAuthConfigured ? '' : `<ol class="text-sm text-muted list-decimal pl-5 mt-3 space-y-1">
                <li>discord.com/developers/applications → „New Application“</li>
                <li>OAuth2 → Redirect hinzufügen: <code class="font-mono text-gold text-xs break-all">${esc(location.origin)}/api/discord/callback</code></li>
                <li>In Render unter „Environment“ setzen: <code class="font-mono text-xs">DISCORD_CLIENT_ID</code>, <code class="font-mono text-xs">DISCORD_CLIENT_SECRET</code> – danach neu deployen.</li></ol>`}
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Notfall-Zugang</h2></div>
              <p class="text-sm text-muted">Passwort vergessen und kein Admin mehr erreichbar? In Render unter „Environment“ die Variable <code class="font-mono text-gold text-xs">ADMIN_RESET_PASSWORD</code> (mind. 10 Zeichen) setzen und neu deployen. Das Konto der Kanzleileitung erhält dieses Passwort. Danach die Variable wieder entfernen.</p>
              <p class="text-sm text-muted mt-2">Gibt es gar keinen aktiven Admin mehr, stellt der Server das Konto von Dr. Alois Pake beim Start automatisch wieder her (Passwort im Render-Log bzw. aus <code class="font-mono text-xs">ADMIN_PASSWORD</code>).</p>
            </section>
          </div>
        </div>
        ${fivenetSettingsPanel(s)}
        <section class="panel panel-pad mt-4 lg:mt-5">
          <div class="panel-head"><h2 class="panel-title">Rechnungsdaten der Kanzlei</h2></div>
          <form data-form="settings-firm" class="form-grid cols-2">
            <div><label class="label">Anschrift (Briefkopf)</label><textarea name="firmAddress" rows="3" maxlength="300" class="field">${esc(s.firmAddress)}</textarea></div>
            <div><label class="label">Zahlungshinweis</label><textarea name="firmPaymentInfo" rows="3" maxlength="300" class="field">${esc(s.firmPaymentInfo)}</textarea></div>
            <div><label class="label">Kontakt</label><input name="firmContact" maxlength="120" class="field" value="${esc(s.firmContact)}"></div>
            <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
          </form>
        </section>`;
    },
  };

  /* ---------------------------------------------------------------- Profil */
  views.profile = {
    async load() {
      const [me, ds] = await Promise.all([api.get('/api/auth/me'), api.get('/api/discord/status'), load.fivenet()]);
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
          : '<p class="text-sm text-muted">Die Kanzleileitung hat die Discord-Anmeldung noch nicht eingerichtet.</p>';
      return `
        ${u.mustChangePassword ? `<div class="banner banner-amber">${icon('alert')}<div><strong>Bitte jetzt ein eigenes Passwort festlegen.</strong> Ihr aktuelles Passwort wurde automatisch erzeugt oder von der Kanzleileitung zurückgesetzt.</div></div>` : ''}
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
              ${u.role === 'mandant' ? `<div><label class="label">Name</label><input name="displayName" class="field" required minlength="2" maxlength="80" value="${esc(u.displayName)}"></div>` : ''}
              <div><label class="label">Telefon (im Spiel)</label><input name="phone" class="field" maxlength="40" value="${esc(u.phone || '')}" placeholder="555-0123"></div>
              <div class="form-actions"><button type="submit" class="btn-outline btn-md">Speichern</button></div>
            </form>
          </section>
          <form data-form="password" class="panel panel-pad form-grid" ${u.mustChangePassword ? 'style="border-color:rgba(245,158,11,.5)"' : ''}>
            <h2 class="panel-title">Passwort ändern</h2>
            <div><label class="label" for="pwOld">Aktuelles Passwort</label><input id="pwOld" name="currentPassword" type="password" autocomplete="current-password" required class="field"></div>
            <div><label class="label" for="pwNew">Neues Passwort (mind. 10 Zeichen)</label><input id="pwNew" name="newPassword" type="password" autocomplete="new-password" minlength="10" required class="field"></div>
            <div><label class="label" for="pwNew2">Neues Passwort wiederholen</label><input id="pwNew2" name="newPassword2" type="password" autocomplete="new-password" required class="field"></div>
            <div class="form-actions"><button class="btn-gold btn-md" type="submit">${icon('key', 'ico-sm')}<span>Passwort speichern</span></button></div>
          </form>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title flex items-center gap-2">${DISCORD_ICON} Discord</h2>${u.discord ? badge('Verbunden', 'emerald') : ''}</div>
            ${discord}
          </section>
          ${isStaff() ? fivenetProfilePanel() : ''}
        </div>`;
    },
  };

  /* ---------------------------------------------------------------- Dienstzeiten / Stempeluhr */
  function weekRange() {
    const from = st.dutyWeek;
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    return { from, to };
  }

  views.duty = {
    async load() {
      if (!st.dutyWeek) st.dutyWeek = mondayOf(new Date());
      const { from, to } = weekRange();
      const [state, data] = await Promise.all([
        api.get('/api/duty'),
        api.get(`/api/duty/sessions?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      ]);
      st.duty = state;
      st.dutyData = data;
      if (!st.dutyUser || !data.totals.some((t) => t.userId === st.dutyUser)) st.dutyUser = st.user.id;
      renderUser();
    },
    render() {
      const admin = isAdmin();
      const me = st.duty.me;
      const onDuty = st.duty.onDuty;
      const { from, to } = weekRange();
      const lastDay = new Date(to.getTime() - 864e5);
      const weekLabel = `KW ${isoWeek(from)} · ${from.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}–${lastDay.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
      const totals = st.dutyData.totals;
      const sumMinutes = totals.reduce((s, t) => s + t.minutes, 0);
      const selected = totals.find((t) => t.userId === st.dutyUser) || totals[0];
      const sessions = st.dutyData.sessions.filter((s) => selected && s.userId === selected.userId);
      const isCurrentWeek = mondayOf(new Date()).getTime() === from.getTime();

      const myCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Mein Dienst</h2>${me.status !== 'off' ? badge('Eingestempelt', 'emerald') : badge('Ausgestempelt', 'slate')}</div>
          <div class="flex items-center gap-4 mb-4">
            ${avatarWrap(st.user.avatarUrl, st.user.displayName, me.status, 'lg')}
            <div>
              <div class="text-sm text-muted">${esc(DUTY[me.status])}${me.note ? ' · ' + esc(me.note) : ''}</div>
              ${me.status !== 'off' && me.since
                ? `<div class="timer" data-countup="${esc(me.since)}">${esc(fmtElapsed(Date.now() - parseDate(me.since).getTime()))}</div><div class="text-xs text-dim">seit ${esc(fmtTime(me.since))} Uhr</div>`
                : '<div class="timer" style="color:var(--text-dim)">0:00:00</div><div class="text-xs text-dim">Nicht im Dienst</div>'}
            </div>
          </div>
          <div class="duty-options mb-4">${Object.entries(DUTY)
            .map(([k, l]) => `<button type="button" class="duty-opt ${me.status === k ? 'active' : ''}" data-action="duty-set" data-status="${k}"><span class="duty-dot s-${k}"></span>${esc(k === 'off' && me.status !== 'off' ? 'Ausstempeln' : l)}</button>`)
            .join('')}</div>
          <form data-form="duty-note" class="flex flex-col sm:flex-row gap-2">
            <input name="note" class="field" maxlength="120" value="${esc(me.note)}" placeholder="Wo sind Sie? z. B. Mission Row PD, Zelle 3" aria-label="Notiz zum Dienststatus">
            <button type="submit" class="btn-outline btn-md" ${me.status === 'off' ? 'disabled' : ''}>Notiz speichern</button>
          </form>
          <p class="form-hint mt-2">Vergessenes Ausstempeln wird nach 12 Stunden automatisch beendet.</p>
        </section>`;

      const onDutyCard = `
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Jetzt im Dienst</h2>${badge(`${onDuty.length}`, onDuty.length ? 'emerald' : 'slate')}</div>
          ${onDuty.length
            ? onDuty
                .map(
                  (m) => `<div class="list-row wrap">
                    ${avatarWrap(m.avatarUrl, m.name, m.status, 'sm')}
                    <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${esc(m.statusLabel)}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
                    <div class="flex items-center gap-2 shrink-0"><span class="font-mono text-xs text-gold" data-countup="${esc(m.since)}">${esc(fmtElapsed(Date.now() - (parseDate(m.since)?.getTime() || Date.now())))}</span>
                    ${admin && m.id !== st.user.id ? `<button class="btn-ghost btn-sm" data-action="duty-force-off" data-id="${m.id}" data-name="${esc(m.name)}">Ausstempeln</button>` : ''}</div>
                  </div>`
                )
                .join('')
            : empty('Gerade ist niemand im Dienst.', 'clock')}
        </section>`;

      const totalsTable = `
        <div class="tbl-wrap"><table class="tbl tbl-cards">
          <thead><tr><th>${admin ? 'Teammitglied' : 'Woche'}</th><th>Arbeitszeit</th><th>Schichten</th><th>Status</th></tr></thead>
          <tbody>${totals
            .map(
              (t) => `<tr class="row ${selected && t.userId === selected.userId ? 'is-selected' : ''}" data-action="duty-select" data-id="${t.userId}">
                <td class="td-main"><div class="flex items-center gap-3">${avatarWrap(t.avatarUrl, t.name, t.status !== 'off' ? t.status : null, 'sm')}<div><div class="font-medium">${esc(t.name)}</div><div class="text-xs text-dim">${esc(t.rank || '')}</div></div></div></td>
                <td data-label="Arbeitszeit" class="font-mono nowrap">${esc(fmtHM(t.minutes))}</td>
                <td data-label="Schichten">${t.sessions}</td>
                <td data-label="Status">${t.status !== 'off' ? badge(DUTY[t.status], 'emerald') : '<span class="text-dim text-xs">außer Dienst</span>'}</td></tr>`
            )
            .join('')}</tbody></table></div>`;

      const sessionList = sessions.length
        ? sessions
            .map((s) => {
              const start = parseDate(s.startedAt);
              const end = s.endedAt ? parseDate(s.endedAt) : null;
              const dur = ((end ? end.getTime() : Date.now()) - start.getTime()) / 60000;
              return `<div class="list-row wrap">
                <div class="main"><div class="title">${esc(start.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }))} · ${esc(fmtTime(s.startedAt))} – ${end ? esc(fmtTime(s.endedAt)) : '<span class="text-emerald-300">läuft</span>'} Uhr</div>
                  <div class="meta">${esc(fmtHM(dur))}${s.note ? ' · ' + esc(s.note) : ''}${s.autoClosed ? ' · automatisch beendet' : ''}</div></div>
                ${admin ? `<div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="duty-session-edit" data-id="${s.id}" aria-label="Schicht bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="duty-session-delete" data-id="${s.id}" aria-label="Schicht löschen">${icon('trash', 'ico-sm')}</button></div>` : ''}
              </div>`;
            })
            .join('')
        : empty('Keine Schichten in dieser Woche.', 'clock');

      return `
        <div class="page-head">
          <div><h1 class="page-title">Stempeluhr & Dienstzeiten</h1><p class="page-sub">Dienst beginnen und beenden, Wochenstunden des Teams im Blick – ideal für Gehaltsabrechnung und Eilnotdienst.</p></div>
          ${admin ? `<div class="page-actions"><button class="btn-outline btn-md" data-action="duty-session-new">${icon('plus', 'ico-sm')}<span>Schicht nachtragen</span></button></div>` : ''}
        </div>
        <div class="grid-2 mb-4 lg:mb-5">${myCard}${onDutyCard}</div>
        <section class="panel panel-pad mb-4 lg:mb-5">
          <div class="panel-head">
            <div class="week-nav">
              <button class="icon-btn" data-action="duty-week" data-dir="-1" aria-label="Vorherige Woche">${icon('chevronLeft')}</button>
              <span class="lbl">${esc(weekLabel)}</span>
              <button class="icon-btn" data-action="duty-week" data-dir="1" aria-label="Nächste Woche" ${isCurrentWeek ? 'disabled' : ''}>${icon('chevronRight')}</button>
              ${isCurrentWeek ? '' : '<button class="btn-outline btn-sm" data-action="duty-week" data-dir="0">Diese Woche</button>'}
            </div>
            ${admin ? `<span class="text-sm text-muted">Team gesamt: <span class="font-mono text-gold">${esc(fmtHM(sumMinutes))}</span></span>` : ''}
          </div>
          ${totalsTable}
        </section>
        <section class="panel panel-pad">
          <div class="panel-head"><h2 class="panel-title">Schichten${selected ? ' – ' + esc(selected.name) : ''}</h2></div>
          ${sessionList}
        </section>`;
    },
  };

  function dutySessionModal(s) {
    const isNew = !s;
    const members = st.dutyData.totals;
    openModal(`
      <h2 class="modal-title">${isNew ? 'Schicht nachtragen' : 'Schicht bearbeiten'}</h2>
      <p class="modal-sub">${isNew ? 'Zum Beispiel wenn jemand vergessen hat einzustempeln.' : esc(s.userName)}</p>
      <form data-form="duty-session" data-id="${isNew ? '' : s.id}" class="form-grid cols-2">
        ${isNew ? `<div class="span-2"><label class="label">Teammitglied</label><select name="userId" class="field">${members.map((m) => opt(m.userId, m.name, m.userId === st.dutyUser)).join('')}</select></div>` : ''}
        <div><label class="label">Beginn</label><input name="startedAt" type="datetime-local" class="field" required value="${s ? toLocalInput(s.startedAt) : ''}"></div>
        <div><label class="label">Ende</label><input name="endedAt" type="datetime-local" class="field" ${isNew ? 'required' : ''} value="${s && s.endedAt ? toLocalInput(s.endedAt) : ''}"></div>
        <div class="span-2"><label class="label">Notiz</label><input name="note" class="field" maxlength="120" value="${esc(s ? s.note : '')}"></div>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
  }

  /* ---------------------------------------------------------------- Bewerbungen */
  const OPEN_APP = ['eingegangen', 'in_pruefung', 'gespraech'];
  const stars = (n) => `<span class="stars readonly" aria-label="${n} von 5 Sternen">${'★'.repeat(n)}${'<span style="opacity:.25">★</span>'.repeat(5 - n)}</span>`;

  function appTable() {
    const f = st.appFilter;
    const rows = st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f));
    if (!rows.length) return empty(st.applications.length ? 'Keine Bewerbungen für diese Auswahl.' : 'Noch keine Bewerbungen eingegangen.', 'userAdd');
    return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Bewerbung</th><th>Stelle</th><th>Eingang</th><th>Bewertung</th><th>Status</th></tr></thead>
      <tbody>${rows
        .map(
          (a) => `<tr class="row" data-action="app-open" data-id="${a.id}">
          <td class="td-main"><div class="font-mono text-gold text-xs">${esc(a.number)}</div><div class="font-medium">${esc(a.name)}${a.age ? ` <span class="text-dim text-xs">(${esc(a.age)})</span>` : ''}</div><div class="text-xs text-dim">Discord: ${esc(a.discord || '—')}</div></td>
          <td data-label="Stelle">${esc(a.positionTitle)}</td>
          <td data-label="Eingang" class="text-xs text-dim nowrap">${esc(fmtDate(a.createdAt))}</td>
          <td data-label="Bewertung">${stars(a.rating)}</td>
          <td data-label="Status">${statusBadge(APP_STATUS, a.status)}</td></tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  function positionsPanel() {
    return `<div class="panel panel-pad">
      ${st.positions.length
        ? st.positions
            .map(
              (p) => `<div class="list-row wrap">
              <div class="main"><div class="title">${esc(p.title)} ${p.active ? badge('Ausgeschrieben', 'emerald') : badge('Pausiert', 'slate')}</div><div class="meta">${esc(p.description)}</div></div>
              <div class="flex gap-1 shrink-0"><button class="icon-btn sm" data-action="position-edit" data-id="${p.id}" aria-label="Bearbeiten">${icon('edit', 'ico-sm')}</button><button class="icon-btn sm" data-action="position-delete" data-id="${p.id}" aria-label="Löschen">${icon('trash', 'ico-sm')}</button></div></div>`
            )
            .join('')
        : empty('Keine Stellen ausgeschrieben. Initiativbewerbungen sind trotzdem möglich.', 'briefcase')}
    </div>`;
  }

  views.applications = {
    async load() {
      const [a, p] = await Promise.all([api.get('/api/admin/applications'), api.get('/api/admin/positions')]);
      st.applications = a.applications;
      st.positions = p.positions;
      st.newApplications = st.applications.filter((x) => x.status === 'eingegangen').length;
    },
    render() {
      const count = (f) => st.applications.filter((a) => f === 'alle' || (f === 'offen' ? OPEN_APP.includes(a.status) : a.status === f)).length;
      const filters = [['offen', 'Offen'], ...Object.entries(APP_STATUS).map(([k, [l]]) => [k, l]), ['alle', 'Alle']];
      const tabBewerbungen = st.appTab === 'bewerbungen';
      return `
        <div class="page-head">
          <div><h1 class="page-title">Bewerbungen</h1><p class="page-sub">Bewerbungen prüfen, bewerten, zum Gespräch einladen und mit einem Klick einstellen.</p></div>
          <div class="page-actions">
            <a href="/karriere.html" target="_blank" rel="noopener" class="btn-outline btn-md">${icon('globe', 'ico-sm')}<span>Karriereseite</span></a>
            ${tabBewerbungen ? '' : `<button class="btn-gold btn-md" data-action="position-new">${icon('plus')}<span>Neue Stelle</span></button>`}
          </div>
        </div>
        <div class="chip-row mb-4">
          <button class="chip ${tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="bewerbungen">${icon('userAdd', 'ico-sm')}Bewerbungen <span class="chip-count">${st.applications.length}</span></button>
          <button class="chip ${!tabBewerbungen ? 'active' : ''}" data-action="app-tab" data-value="stellen">${icon('briefcase', 'ico-sm')}Stellenausschreibungen <span class="chip-count">${st.positions.filter((p) => p.active).length}</span></button>
        </div>
        ${tabBewerbungen
          ? `<div class="chip-row mb-4">${filters.map(([k, l]) => `<button class="chip ${st.appFilter === k ? 'active' : ''}" data-action="app-filter" data-value="${k}">${esc(l)} <span class="chip-count">${count(k)}</span></button>`).join('')}</div>
             <div class="panel p-2 md:p-3">${appTable()}</div>`
          : positionsPanel()}`;
    },
  };

  async function openApplication(id) {
    const data = await api.get('/api/admin/applications/' + id);
    st.modalAppId = id;
    openModal(appDetail(data), { wide: true });
  }
  async function reloadApplication(data) {
    if (st.modalAppId === data.application.id) replaceModal(appDetail(data));
    refreshBehind();
  }

  function appDetail({ application: a, notes, hiredUser }) {
    const cell = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;
    const qa = (q, text) => (text ? `<div class="qa"><div class="q">${esc(q)}</div><div class="a">${esc(text)}</div></div>` : '');
    return `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4 pr-12">
        <div class="min-w-0"><div class="font-mono text-gold text-sm">${esc(a.number)}</div>
          <h2 id="modalTitle" class="font-serif text-2xl md:text-3xl font-semibold leading-tight">${esc(a.name)}</h2>
          <div class="text-sm text-muted">${esc(a.positionTitle)}</div></div>
        ${statusBadge(APP_STATUS, a.status)}
      </div>
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <span class="text-xs uppercase tracking-widest text-dim">Bewertung</span>
        <span class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" class="${n <= a.rating ? 'on' : ''}" data-action="app-rate" data-id="${a.id}" data-value="${n === a.rating ? 0 : n}" aria-label="${n} Sterne">★</button>`)
          .join('')}</span>
      </div>
      <div class="chip-row mb-5" role="group" aria-label="Status">${Object.entries(APP_STATUS)
        .map(([k, [l]]) => `<button type="button" class="chip ${a.status === k ? 'active' : ''}" data-action="app-status" data-id="${a.id}" data-status="${k}">${esc(l)}</button>`)
        .join('')}</div>
      ${hiredUser ? `<div class="banner banner-gold">${icon('check')}<div>Eingestellt – Login-Konto <strong>${esc(hiredUser.email)}</strong> wurde angelegt.</div></div>` : ''}
      <div class="info-grid mb-5">${cell('Alter', a.age ? String(a.age) : '')}${cell('Telefon', a.phone)}${cell('Discord', a.discord)}${cell('E-Mail', a.email)}${cell('Eingegangen', fmtDate(a.createdAt))}${cell('Gespräch', a.interviewAt ? fmtDate(a.interviewAt) : '')}</div>
      <div class="stack">${qa('Motivation', a.motivation)}${qa('Erfahrung', a.experience)}${qa('Verfügbarkeit', a.availability)}</div>

      <div class="grid-2 section">
        <form data-form="app-interview" data-id="${a.id}" class="qa form-grid">
          <div class="q">Zum Gespräch einladen</div>
          <div><label class="label">Termin</label><input name="startsAt" type="datetime-local" class="field" required value="${a.interviewAt ? toLocalInput(a.interviewAt) : ''}"></div>
          <div><label class="label">Ort</label><input name="location" class="field" maxlength="120" value="Kanzlei Würfelpark"></div>
          <button type="submit" class="btn-outline btn-md">${icon('calendar', 'ico-sm')}<span>Gespräch planen</span></button>
          <p class="form-hint">Setzt den Status auf „Einladung zum Gespräch“ und trägt den Termin in den Team-Kalender ein.</p>
        </form>
        <form data-form="app-public-note" data-id="${a.id}" class="qa form-grid">
          <div class="q">Nachricht an den Bewerber</div>
          <textarea name="publicNote" rows="4" maxlength="1000" class="field" placeholder="z. B. Vielen Dank! Wir melden uns bis Freitag.">${esc(a.publicNote)}</textarea>
          <button type="submit" class="btn-outline btn-md">Speichern</button>
          <p class="form-hint">Sichtbar in der Statusabfrage auf der Karriereseite.</p>
        </form>
      </div>

      <div class="form-actions section">
        ${!hiredUser ? `<button class="btn-gold btn-md" data-action="app-hire" data-id="${a.id}">${icon('userAdd', 'ico-sm')}<span>Einstellen & Konto anlegen</span></button>` : ''}
        ${a.status !== 'abgelehnt' && !hiredUser ? `<button class="btn-outline btn-md" data-action="app-status" data-id="${a.id}" data-status="abgelehnt">Absagen</button>` : ''}
        <button class="btn-danger btn-md" data-action="app-delete" data-id="${a.id}" data-number="${esc(a.number)}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>
      </div>

      <div class="section"><h3 class="section-title">Interne Notizen</h3>
        ${notes.length ? `<div class="timeline">${notes.map((n) => `<div class="tl-item"><div class="tl-meta"><span class="text-muted font-medium">${esc(n.author)}</span><span>${esc(fmtDate(n.createdAt))}</span></div><div class="tl-body">${esc(n.body)}</div></div>`).join('')}</div>` : '<p class="text-sm text-dim">Noch keine Notizen.</p>'}
        <form data-form="app-note" data-id="${a.id}" class="mt-3 space-y-3">
          <textarea name="body" rows="2" maxlength="3000" required class="field" placeholder="Eindruck aus dem Gespräch, Rückfragen …" aria-label="Interne Notiz"></textarea>
          <button type="submit" class="btn-outline btn-md">${icon('send', 'ico-sm')}<span>Notiz speichern</span></button>
        </form>
      </div>`;
  }

  function hireModal(a) {
    const rank = a.positionTitle.replace(/\s*\(m\/w\/d\)\s*/i, '').replace('Initiativbewerbung', 'Junior Associate').split('/')[0].trim();
    openModal(`
      <h2 class="modal-title">${esc(a.name)} einstellen</h2>
      <p class="modal-sub">Legt ein Login-Konto mit Einmal-Passwort an und auf Wunsch ein Profil im Bereich „Unser Team“ auf der Website.</p>
      <form data-form="app-hire" data-id="${a.id}" class="form-grid cols-2">
        <div class="span-2"><label class="label">E-Mail (Login)</label><input name="email" type="email" class="field" required maxlength="120" value="${esc(a.email)}" placeholder="vorname.nachname@pake-scha.ls" autofocus></div>
        <div><label class="label">Rang</label><input name="rank" class="field" required minlength="2" maxlength="60" list="rankListHire" value="${esc(rank)}"><datalist id="rankListHire">${RANKS.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist></div>
        <div><label class="label">Rolle im Dashboard</label><select name="role" class="field">${opt('anwalt', 'Anwalt / Mitarbeiter', true)}${opt('admin', 'Kanzleileitung (Admin)')}</select></div>
        <div class="span-2"><label class="label">Kurzbeschreibung für die Website (optional)</label><textarea name="description" rows="2" maxlength="400" class="field"></textarea></div>
        <label class="check span-2"><input type="checkbox" name="createProfile" checked> Team-Profil anlegen</label>
        <label class="check span-2"><input type="checkbox" name="visible" checked> Sofort auf der Website anzeigen</label>
        <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Einstellen</span></button><button type="button" class="btn-ghost btn-md" data-action="app-back" data-id="${a.id}">Zurück</button></div>
      </form>`);
  }

  function positionModal(p) {
    const v = p || { active: true };
    openModal(`
      <h2 class="modal-title">${p ? 'Stelle bearbeiten' : 'Neue Stelle ausschreiben'}</h2>
      <p class="modal-sub">Erscheint sofort auf der Karriereseite.</p>
      <form data-form="position" data-id="${p ? p.id : ''}" class="form-grid">
        <div><label class="label">Titel</label><input name="title" class="field" required minlength="2" maxlength="100" value="${esc(v.title || '')}" placeholder="z. B. Associate / Rechtsanwalt (m/w/d)" autofocus></div>
        <div><label class="label">Aufgaben</label><textarea name="description" rows="4" maxlength="1500" class="field">${esc(v.description || '')}</textarea></div>
        <div><label class="label">Anforderungen</label><textarea name="requirements" rows="3" maxlength="1500" class="field">${esc(v.requirements || '')}</textarea></div>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Ausgeschrieben (auf der Karriereseite sichtbar)</label>
        <div class="form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Speichern</span></button></div>
      </form>`);
  }

  /* ---------------------------------------------------------------- Aktivitätsprotokoll */
  function auditTable() {
    if (!st.audit.length) return empty(st.auditQuery ? 'Keine Einträge gefunden.' : 'Noch keine Einträge.', 'list');
    return `<div class="tbl-wrap"><table class="tbl tbl-cards">
      <thead><tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Details</th></tr></thead>
      <tbody>${st.audit
        .map(
          (e) => `<tr>
          <td class="td-main text-xs text-dim nowrap">${esc(fmtDate(e.createdAt))}</td>
          <td data-label="Wer" class="font-medium">${esc(e.userName)}</td>
          <td data-label="Aktion">${esc(e.action)}</td>
          <td data-label="Details" class="text-sm text-muted" style="word-break:break-word">${esc(e.details || '—')}</td></tr>`
        )
        .join('')}</tbody></table></div>
      ${st.auditHasMore ? '<div class="text-center pt-4"><button class="btn-outline btn-md" data-action="audit-more">Ältere Einträge laden</button></div>' : ''}`;
  }
  async function loadAudit(append = false) {
    const params = new URLSearchParams();
    if (st.auditQuery) params.set('q', st.auditQuery);
    if (append && st.audit.length) params.set('before', st.audit[st.audit.length - 1].id);
    const r = await api.get('/api/admin/audit?' + params);
    st.audit = append ? st.audit.concat(r.entries) : r.entries;
    st.auditHasMore = r.hasMore;
  }
  views.audit = {
    async load() {
      await loadAudit();
    },
    render() {
      return `
        <div class="page-head"><div><h1 class="page-title">Aktivitätsprotokoll</h1><p class="page-sub">Wer hat wann was geändert – Akten, Rechnungen, Konten, Team, Bewerbungen und Anmeldungen.</p></div></div>
        <div class="toolbar"><label class="search">${icon('search')}<input id="auditSearch" class="field" type="search" placeholder="Name, Aktion oder Details …" value="${esc(st.auditQuery)}" aria-label="Protokoll durchsuchen"></label></div>
        <div id="auditList" class="panel p-2 md:p-3">${auditTable()}</div>`;
    },
  };

  /* ---------------------------------------------------------------- Bild-Uploads */
  async function handleUpload(input) {
    const files = [...(input.files || [])];
    const kind = input.dataset.upload;
    input.value = '';
    if (!files.length) return;

    if (kind === 'avatar') {
      const blob = await resizeImage(files[0], { max: 512, square: true });
      const res = await api.upload('/api/auth/avatar', blob);
      st.user = res.user;
      renderUser();
      if (st.view === 'profile') renderView();
      toast('Profilbild aktualisiert.');
    } else if (kind === 'team') {
      const id = Number(input.dataset.id);
      const blob = await resizeImage(files[0], { max: 640, square: true });
      const res = await api.upload(`/api/admin/team/${id}/photo`, blob);
      const m = res.member;
      const photo = $('#tmPhoto');
      if (photo) photo.innerHTML = avatarImg(m.photoUrl, m.name);
      const ctl = $('#tmPhotoCtl');
      if (ctl) ctl.innerHTML = teamPhotoControls(m);
      toast('Foto gespeichert – live auf der Website.');
      await refreshBehind();
    } else if (kind === 'fn-pending') {
      addPendingImages({ blobs: files });
    } else if (kind === 'fivenet-img') {
      const caseId = Number(input.dataset.caseId);
      const d = st.caseDocs.find((x) => x.id === Number(input.dataset.docId));
      if (!d) return;
      st.fnPending = { urls: [], blobs: files.slice(0, FN_MAX_IMAGES) };
      reportImport(await importPendingImages(caseId, d));
      await reloadCase(caseId);
    } else if (kind === 'evidence') {
      const caseId = Number(input.dataset.caseId);
      const caption = ($('#attCaption')?.value || '').trim();
      const internal = $('#attInternal')?.checked ? '1' : '0';
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

  /* ================================================================
     Aktionen (Klicks)
     ================================================================ */
  const actions = {
    'open-sidebar': openSidebar,
    'close-sidebar': closeSidebar,
    'close-modal': closeModal,
    'reload-view': () => go(st.view),
    logout: async () => {
      await api.post('/api/auth/logout');
      location.href = '/login.html';
    },
    copy: async (el) => {
      const ok = await copy(el.dataset.text || '');
      toast(ok ? 'In die Zwischenablage kopiert.' : 'Kopieren nicht möglich – bitte manuell markieren.', ok ? 'ok' : 'error');
    },

    // Akten
    'case-filter': (el) => {
      st.caseFilter = el.dataset.value;
      renderView();
    },
    'case-mine': () => {
      st.caseMine = !st.caseMine;
      renderView();
    },
    'new-case': newCaseModal,
    'open-case': (el) => openCase(Number(el.dataset.id)),
    'case-status': async (el) => {
      const id = Number(el.dataset.id);
      await api.patch('/api/cases/' + id, { status: el.dataset.status });
      toast(`Status: ${CASE_STATUS[el.dataset.status][0]}`);
      await reloadCase(id);
    },
    'claim-case': async (el) => {
      const id = Number(el.dataset.id);
      await api.patch('/api/cases/' + id, { lawyerId: st.user.id });
      toast('Akte übernommen – sie liegt jetzt bei Ihnen.');
      if (st.modalCaseId === id) await reloadCase(id);
      else await refreshBehind();
    },
    'release-case': async (el) => {
      if (!(await ask('Die Akte erscheint danach wieder als offene Anfrage für das Team.', { title: 'Akte abgeben?', confirmText: 'Akte abgeben' }))) return;
      const id = Number(el.dataset.id);
      await api.patch('/api/cases/' + id, { lawyerId: null });
      toast('Akte abgegeben.');
      await reloadCase(id);
    },
    'delete-case': async (el) => {
      if (!(await askDelete(`Akte ${el.dataset.number} löschen?`, 'Notizen, Aufgaben und verknüpfte externe Dokumente werden mitgelöscht, Termine und Rechnungen verlieren den Aktenbezug. Das lässt sich nicht rückgängig machen.', 'Endgültig löschen'))) return;
      await api.del('/api/cases/' + el.dataset.id);
      toast('Akte gelöscht.');
      closeModal();
      await refreshBehind();
    },
    'delete-note': async (el) => {
      if (!(await askDelete('Notiz löschen?', 'Die Notiz wird aus dem Verlauf der Akte entfernt.'))) return;
      const caseId = Number(el.dataset.caseId);
      await api.del(`/api/cases/${caseId}/notes/${el.dataset.id}`);
      await reloadCase(caseId);
    },

    // Kalender
    'new-event': async (el) => {
      st.returnCase = el.dataset.returnCase ? Number(el.dataset.returnCase) : null;
      const caseId = el.dataset.caseId ? Number(el.dataset.caseId) : null;
      await load.cases();
      if (isStaff()) {
        await load.lawyers();
        openModal(eventForm(null, { caseId, day: el.dataset.day || null }));
      } else {
        openModal(eventRequestForm(caseId));
      }
    },
    'open-event': (el) => openEvent(Number(el.dataset.id), st.modalCaseId),
    'event-status': async (el) => {
      await api.patch('/api/calendar/' + el.dataset.id, { status: el.dataset.status });
      toast({ bestaetigt: 'Termin bestätigt.', abgesagt: 'Termin abgesagt.', erledigt: 'Frist als erledigt markiert.' }[el.dataset.status] || 'Gespeichert.');
      await returnOrClose();
    },
    'event-delete': async (el) => {
      if (!(await askDelete('Eintrag löschen?', 'Der Termin bzw. die Frist wird endgültig aus dem Kalender gelöscht.'))) return;
      await api.del('/api/calendar/' + el.dataset.id);
      st.eventCache.delete(Number(el.dataset.id));
      toast('Eintrag gelöscht.');
      await returnOrClose();
    },
    'cal-nav': (el) => {
      const m = st.cal.month;
      st.cal.month = new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.dir), 1);
      renderView();
    },
    'cal-today': () => {
      st.cal.month = monthStart(new Date());
      st.cal.selected = dayKey(new Date());
      renderView();
    },
    'cal-select': (el) => {
      st.cal.selected = el.dataset.day;
      const d = new Date(`${el.dataset.day}T12:00:00`);
      if (d.getMonth() !== st.cal.month.getMonth()) st.cal.month = monthStart(d);
      renderView();
      if (window.matchMedia('(max-width: 1279px)').matches) $('#dayAgenda')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'cal-type': (el) => {
      st.cal.types[el.dataset.type] = !st.cal.types[el.dataset.type];
      renderView();
    },

    // Kanzlei-Post
    compose: async (el) => {
      st.returnCase = el.dataset.returnCase ? Number(el.dataset.returnCase) : null;
      await composeModal({
        recipientId: el.dataset.recipient ? Number(el.dataset.recipient) : null,
        caseId: el.dataset.caseId ? Number(el.dataset.caseId) : null,
      });
    },
    'mail-box': async (el) => {
      st.mailBox = el.dataset.value;
      st.mailSel = null;
      await load.messages();
      renderView();
    },
    'mail-open': async (el) => {
      const m = st.messages.find((x) => x.id === Number(el.dataset.id));
      if (!m) return;
      st.mailSel = m.id;
      if (st.mailBox === 'inbox' && !m.isRead) {
        m.isRead = true;
        st.unread = Math.max(0, st.unread - 1);
        api.patch('/api/messages/' + m.id, { isRead: true }).catch(() => {});
      }
      renderView();
      if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    'mail-back': () => {
      st.mailSel = null;
      renderView();
    },
    'mail-reply': async (el) => {
      const m = st.messages.find((x) => x.id === Number(el.dataset.id));
      if (!m) return;
      st.returnCase = null;
      await composeModal({ recipientId: m.senderId, caseId: m.caseId, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`.trim(), reply: true });
    },
    'mail-unread': async (el) => {
      const m = st.messages.find((x) => x.id === Number(el.dataset.id));
      await api.patch('/api/messages/' + el.dataset.id, { isRead: false });
      if (m) m.isRead = false;
      st.unread += 1;
      st.mailSel = null;
      renderView();
    },
    'mail-delete': async (el) => {
      if (!(await askDelete('Nachricht löschen?', 'Die Nachricht verschwindet aus Ihrem Postfach.'))) return;
      await api.del('/api/messages/' + el.dataset.id);
      st.mailSel = null;
      toast('Nachricht gelöscht.');
      await refreshBehind();
    },
    'mail-read-all': async () => {
      await api.post('/api/messages/read-all');
      await refreshBehind();
    },

    // Pinnwand
    'board-new': () => noteModal(null),
    'board-edit': (el) => noteModal(st.board.find((n) => n.id === Number(el.dataset.id))),
    'board-pin': async (el) => {
      const n = st.board.find((x) => x.id === Number(el.dataset.id));
      if (!n) return;
      await api.patch('/api/board/' + n.id, { pinned: !n.pinned });
      await refreshBehind();
    },
    'board-delete': async (el) => {
      if (!(await askDelete('Notiz entfernen?', 'Die Notiz wird von der Pinnwand entfernt.', 'Entfernen'))) return;
      await api.del('/api/board/' + el.dataset.id);
      toast('Notiz entfernt.');
      await refreshBehind();
    },

    // Rechnungen
    'inv-filter': (el) => {
      st.invFilter = el.dataset.value;
      renderView();
    },
    'new-invoice': async (el) => {
      await load.cases();
      st.draft = newDraft(el.dataset.caseId ? Number(el.dataset.caseId) : null);
      await navigate('invoice-new');
    },
    'inv-add-fee': () => {
      const id = Number($('#feePicker')?.value);
      const fee = st.fees.find((f) => f.id === id);
      if (!fee) return;
      st.draft.items.push({ description: fee.name, quantity: 1, unitPrice: fee.price });
      renderView();
    },
    'inv-add-item': () => {
      st.draft.items.push({ description: '', quantity: 1, unitPrice: 0 });
      renderView();
      const inputs = $$('.item-desc');
      inputs[inputs.length - 1]?.focus();
    },
    'inv-remove-item': (el) => {
      st.draft.items.splice(Number(el.dataset.index), 1);
      renderView();
    },
    'inv-preset': (el) => {
      st.draft[el.dataset.field] = Number(el.dataset.value);
      const input = $(`#invoiceForm [name="${el.dataset.field}"]`);
      if (input) input.value = el.dataset.value;
      updateInvoiceSummary();
    },
    'inv-status': async (el) => {
      await api.patch('/api/invoices/' + el.dataset.id, { status: el.dataset.status });
      toast({ bezahlt: 'Als bezahlt markiert.', storniert: 'Dokument storniert.', offen: 'Wieder als offen markiert.' }[el.dataset.status]);
      await refreshBehind();
    },
    'inv-delete': async (el) => {
      if (!(await askDelete(`Dokument ${el.dataset.number} löschen?`, 'Stornieren ist meist die bessere Wahl – dann bleibt das Dokument nachvollziehbar.', 'Endgültig löschen'))) return;
      await api.del('/api/invoices/' + el.dataset.id);
      toast('Dokument gelöscht.');
      await refreshBehind();
    },

    // Team
    'team-new': () => memberModal(null),
    'team-edit': (el) => memberModal(st.team.find((m) => m.id === Number(el.dataset.id))),
    'team-move': async (el) => {
      const ids = st.team.map((t) => t.id);
      const i = ids.indexOf(Number(el.dataset.id));
      const j = i + Number(el.dataset.dir);
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api.post('/api/admin/team/reorder', { ids });
      await refreshBehind();
    },
    'team-delete': (el) => {
      const m = st.team.find((x) => x.id === Number(el.dataset.id));
      if (!m) return;
      const canLock = m.userId && m.userId !== st.user.id && m.userActive;
      openModal(`
        <h2 class="modal-title">Profil entfernen?</h2>
        <p class="modal-sub"><strong>${esc(m.name)}</strong> wird sofort aus dem Bereich „Unser Team“ der Website entfernt.</p>
        <form data-form="team-delete" data-id="${m.id}" class="form-grid">
          ${canLock ? `<label class="check"><input type="checkbox" name="lock"> Zugehöriges Login-Konto (${esc(m.userEmail)}) ebenfalls sperren</label>` : ''}
          <div class="form-actions"><button type="submit" class="btn-danger btn-md">${icon('trash', 'ico-sm')}<span>Endgültig entfernen</span></button><button type="button" class="btn-ghost btn-md" data-action="close-modal">Abbrechen</button></div>
        </form>`);
    },

    // Benutzer
    'user-filter': (el) => {
      st.userFilter = el.dataset.value;
      renderView();
    },
    'user-new': () => {
      openModal(`
        <h2 class="modal-title">Konto anlegen</h2>
        <p class="modal-sub">Es wird ein Einmal-Passwort erzeugt. Für Teammitglieder mit Website-Profil besser unter „Team“ anlegen.</p>
        <form data-form="user-new" class="form-grid cols-2">
          <div class="span-2"><label class="label">Name</label><input name="displayName" class="field" required minlength="2" maxlength="80" autofocus></div>
          <div class="span-2"><label class="label">E-Mail (Login)</label><input name="email" type="email" class="field" required maxlength="120"></div>
          <div><label class="label">Rolle</label><select name="role" class="field">${Object.entries(ROLES).map(([k, l]) => opt(k, l, k === 'anwalt')).join('')}</select></div>
          <div><label class="label">Rang (optional)</label><input name="rank" class="field" maxlength="60" list="rankListNew"><datalist id="rankListNew">${RANKS.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist></div>
          <div class="span-2"><label class="label">Telefon (optional)</label><input name="phone" class="field" maxlength="40"></div>
          <div class="span-2 form-actions"><button type="submit" class="btn-gold btn-md">${icon('check')}<span>Konto anlegen</span></button></div>
        </form>`);
    },
    'user-reset': async (el) => {
      const u = st.users.find((x) => x.id === Number(el.dataset.id));
      if (!u || !(await ask(`Für ${u.displayName} wird ein neues Einmal-Passwort erzeugt. Das bisherige Passwort wird sofort ungültig.`, { title: 'Passwort zurücksetzen?', confirmText: 'Neues Passwort erzeugen' }))) return;
      const res = await api.post(`/api/admin/users/${u.id}/reset-password`);
      showCredentials(res.credentials, u.displayName);
      refreshBehind();
    },
    'user-toggle': async (el) => {
      const u = st.users.find((x) => x.id === Number(el.dataset.id));
      if (!u) return;
      if (u.active && !(await askDelete('Konto sperren?', `${u.displayName} wird sofort abgemeldet und kann sich nicht mehr anmelden.`, 'Sperren'))) return;
      await api.patch('/api/admin/users/' + u.id, { active: !u.active });
      toast(u.active ? 'Konto gesperrt.' : 'Konto entsperrt.');
      await refreshBehind();
    },
    'user-delete': async (el) => {
      const u = st.users.find((x) => x.id === Number(el.dataset.id));
      if (!u || !(await askDelete('Konto löschen?', `Das Konto von ${u.displayName} wird endgültig gelöscht. Akten bleiben erhalten.`, 'Endgültig löschen'))) return;
      await api.del('/api/admin/users/' + u.id);
      toast('Konto gelöscht.');
      await refreshBehind();
    },

    // Honorarordnung
    'fee-new': (el) => feeModal(null, el.dataset.category),
    'fee-edit': (el) => feeModal(st.adminFees.find((f) => f.id === Number(el.dataset.id))),
    'fee-delete': async (el) => {
      const f = st.adminFees.find((x) => x.id === Number(el.dataset.id));
      if (!f || !(await askDelete('Leistung löschen?', `„${f.name}“ wird aus der Honorarordnung gelöscht – auch auf der Website.`))) return;
      await api.del('/api/admin/fees/' + f.id);
      toast('Leistung gelöscht.');
      await refreshBehind();
    },

    // Dienststatus & Stempeluhr
    'duty-menu': () => {
      if ($('#dutyPop').classList.contains('open')) closeDutyPop();
      else openDutyPop();
    },
    'duty-set': (el) => setDutyStatus(el.dataset.status),
    'duty-force-off': async (el) => {
      if (!(await ask(`${el.dataset.name} wird jetzt ausgestempelt.`, { title: 'Ausstempeln?', confirmText: 'Ausstempeln' }))) return;
      st.duty = await api.post('/api/duty/force-off/' + el.dataset.id);
      toast(`${el.dataset.name} wurde ausgestempelt.`);
      await refreshBehind();
    },
    'duty-week': async (el) => {
      const dir = Number(el.dataset.dir);
      const w = st.dutyWeek;
      st.dutyWeek = dir === 0 ? mondayOf(new Date()) : new Date(w.getFullYear(), w.getMonth(), w.getDate() + dir * 7);
      await refreshBehind();
    },
    'duty-select': (el) => {
      st.dutyUser = Number(el.dataset.id);
      renderView();
    },
    'duty-session-new': () => dutySessionModal(null),
    'duty-session-edit': (el) => dutySessionModal(st.dutyData.sessions.find((s) => s.id === Number(el.dataset.id))),
    'duty-session-delete': async (el) => {
      if (!(await askDelete('Schicht löschen?', 'Die Dienstzeit wird endgültig gelöscht.'))) return;
      await api.del('/api/duty/sessions/' + el.dataset.id);
      toast('Schicht gelöscht.');
      await refreshBehind();
    },

    // Bilder
    'avatar-remove': async () => {
      const res = await api.del('/api/auth/avatar');
      st.user = res.user;
      renderUser();
      renderView();
      toast('Profilbild entfernt.');
    },
    'team-photo-remove': async (el) => {
      const res = await api.del(`/api/admin/team/${el.dataset.id}/photo`);
      const m = res.member;
      const photo = $('#tmPhoto');
      if (photo) photo.innerHTML = m.photoUrl ? avatarImg(m.photoUrl, m.name) : esc(m.initials);
      const ctl = $('#tmPhotoCtl');
      if (ctl) ctl.innerHTML = teamPhotoControls(m);
      toast('Foto entfernt.');
      await refreshBehind();
    },
    'att-open': (el) => {
      const a = st.caseAttachments[Number(el.dataset.index)];
      if (!a) return;
      const caseId = st.modalCaseId;
      st.returnCase = caseId;
      const canDelete = a.uploaderId === st.user.id || isAdmin();
      openModal(
        `<h2 class="modal-title">${esc(a.caption || 'Anhang')}</h2>
        <p class="modal-sub">${esc(a.uploaderName)} · ${esc(fmtDate(a.createdAt))} ${a.internal ? badge('nur intern', 'amber') : ''}</p>
        <img class="lightbox-img mb-4" src="${esc(a.url)}" alt="${esc(a.caption)}">
        <div class="form-actions">
          <button class="btn-outline btn-md" data-action="back-to-case">${icon('chevronLeft', 'ico-sm')}<span>Zurück zur Akte</span></button>
          <a class="btn-ghost btn-md" href="${esc(a.url)}" download>${icon('download', 'ico-sm')}<span>Herunterladen</span></a>
          ${canDelete ? `<button class="btn-danger btn-md" data-action="att-delete" data-id="${a.id}" data-case-id="${caseId}">${icon('trash', 'ico-sm')}<span>Löschen</span></button>` : ''}
        </div>`,
        { wide: true }
      );
    },
    'att-delete': async (el) => {
      if (!(await askDelete('Anhang löschen?', 'Das Bild wird endgültig aus der Akte gelöscht.'))) return;
      await api.del(`/api/cases/${el.dataset.caseId}/attachments/${el.dataset.id}`);
      toast('Anhang gelöscht.');
      await returnOrClose();
    },
    'back-to-case': () => returnOrClose(),
    'scroll-to': (el) => {
      $('#' + el.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    // FiveNet-Dokumente
    'fn-add': async () => {
      if (!st.caseInfo) return;
      st.returnCase = st.caseInfo.id;
      await load.fivenet();
      resetPending();
      openModal(externalForm('fivenet', null, st.caseInfo));
    },
    'gd-add': async () => {
      if (!st.caseInfo) return;
      st.returnCase = st.caseInfo.id;
      await load.fivenet(); // Vorschläge für Dokumentarten
      resetPending();
      openModal(externalForm('gdocs', null, st.caseInfo));
    },
    'fn-edit': async (el) => {
      const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
      if (!d || !st.caseInfo) return;
      st.returnCase = st.caseInfo.id;
      await load.fivenet();
      resetPending();
      openModal(externalForm(d.provider === 'gdocs' ? 'gdocs' : 'fivenet', d, st.caseInfo));
      if (el.dataset.focus) {
        const target = $('#' + el.dataset.focus);
        target?.scrollIntoView({ block: 'center' });
        target?.focus();
      }
      if (el.dataset.reload && d.provider === 'gdocs') await loadGoogleDoc(d.url, { replace: true });
    },
    'gd-reload': (el) => loadGoogleDoc(el.dataset.url, { replace: true }),
    'fn-img-remove': (el) => {
      const i = Number(el.dataset.index);
      if (el.dataset.kind === 'url') st.fnPending.urls.splice(i, 1);
      else st.fnPending.blobs.splice(i, 1);
      renderPending();
    },
    'fn-copy-text': async (el) => {
      const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
      if (!d) return;
      const ok = await copy(d.contentText);
      toast(ok ? 'Abschrift kopiert.' : 'Kopieren nicht möglich.', ok ? 'ok' : 'error');
    },
    'fn-delete': async (el) => {
      const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
      if (!d || !(await askDelete('Verknüpfung entfernen?', `${extOf(d).noun}${d.title ? ` „${d.title}“` : ''} wird aus der Akte entfernt. Das Original bleibt unverändert, übernommene Bilder bleiben als Beweismittel in der Akte.`, 'Entfernen'))) return;
      const caseId = Number(el.dataset.caseId);
      await api.del(extUrl(caseId, d.id));
      toast('Verknüpfung entfernt.');
      await reloadCase(caseId);
    },
    'fn-cite': async (el) => {
      const d = st.caseDocs.find((x) => x.id === Number(el.dataset.id));
      if (!d) return;
      const ok = await copy(externalCitation(d));
      toast(ok ? 'Zitat kopiert – z. B. für Schriftsätze oder Nachrichten.' : 'Kopieren nicht möglich.', ok ? 'ok' : 'error');
    },
    'fn-check': async () => {
      const box = $('#fnCheckResult');
      if (box) box.innerHTML = '<span class="text-dim">Prüfe …</span>';
      const r = await api.post('/api/fivenet/check');
      if (!box || !box.isConnected) return;
      box.innerHTML = r.result.reachable
        ? `<span class="text-emerald-300">✓ ${esc(r.instance.host)} ist erreichbar – FiveNet ${esc(r.result.version)}</span>`
        : `<span class="text-amber-300">${esc(r.instance.host)} antwortet nicht wie erwartet (${esc(r.result.detail || 'unbekannt')}). Verknüpfen funktioniert trotzdem – die Kanzlei ruft FiveNet dafür nicht auf.</span>`;
    },

    // Aufgaben & Wiedervorlagen
    'task-scope': async (el) => {
      st.taskScope = el.dataset.value;
      await load.tasks();
      renderView();
    },
    'task-state': async (el) => {
      st.taskState = el.dataset.value;
      await load.tasks();
      renderView();
    },
    'task-toggle': async (el) => {
      const done = el.dataset.done !== '1';
      el.disabled = true;
      try {
        await api.patch('/api/tasks/' + el.dataset.id, { done });
      } finally {
        if (el.isConnected) el.disabled = false;
      }
      toast(done ? 'Erledigt.' : 'Aufgabe wieder geöffnet.');
      await afterTaskChange();
    },
    'task-new': async (el) => {
      const caseId = el.dataset.caseId ? Number(el.dataset.caseId) : null;
      st.returnCase = caseId && st.modalCaseId === caseId ? caseId : null;
      await Promise.all([load.lawyers(), load.cases()]);
      const lawyer = caseId && st.caseInfo && st.caseInfo.id === caseId ? st.caseInfo.lawyerId : null;
      taskModal(null, { caseId, assignedTo: lawyer || st.user.id });
    },
    'task-edit': async (el) => {
      const t = findTask(Number(el.dataset.id));
      if (!t) return;
      st.returnCase = st.modalCaseId && t.caseId === st.modalCaseId ? st.modalCaseId : null;
      await Promise.all([load.lawyers(), load.cases()]);
      taskModal(t);
    },
    'task-delete': async (el) => {
      const t = findTask(Number(el.dataset.id));
      if (!(await askDelete('Aufgabe löschen?', t ? `„${t.title}“ wird gelöscht.` : 'Die Aufgabe wird gelöscht.'))) return;
      await api.del('/api/tasks/' + el.dataset.id);
      toast('Aufgabe gelöscht.');
      await afterTaskChange();
    },
    'task-checklist': async (el) => {
      const caseId = Number(el.dataset.caseId);
      const r = await api.post('/api/tasks/checklist', { caseId });
      toast(r.added ? `${r.added} Aufgaben aus der Checkliste übernommen.` : 'Alle Punkte der Checkliste sind bereits in der Akte.');
      await afterTaskChange();
    },

    // Bewerbungen
    'app-tab': (el) => {
      st.appTab = el.dataset.value;
      renderView();
    },
    'app-filter': (el) => {
      st.appFilter = el.dataset.value;
      renderView();
    },
    'app-open': (el) => openApplication(Number(el.dataset.id)),
    'app-back': (el) => openApplication(Number(el.dataset.id)),
    'app-rate': async (el) => {
      const data = await api.patch('/api/admin/applications/' + el.dataset.id, { rating: Number(el.dataset.value) });
      await reloadApplication(data);
    },
    'app-status': async (el) => {
      const data = await api.patch('/api/admin/applications/' + el.dataset.id, { status: el.dataset.status });
      toast(`Status: ${APP_STATUS[el.dataset.status][0]}`);
      await reloadApplication(data);
    },
    'app-hire': async (el) => {
      const data = await api.get('/api/admin/applications/' + el.dataset.id);
      hireModal(data.application);
    },
    'app-delete': async (el) => {
      if (!(await askDelete(`Bewerbung ${el.dataset.number} löschen?`, 'Die Bewerbung und alle Notizen dazu werden endgültig gelöscht.', 'Endgültig löschen'))) return;
      await api.del('/api/admin/applications/' + el.dataset.id);
      toast('Bewerbung gelöscht.');
      closeModal();
      await refreshBehind();
    },
    'position-new': () => positionModal(null),
    'position-edit': (el) => positionModal(st.positions.find((p) => p.id === Number(el.dataset.id))),
    'position-delete': async (el) => {
      const p = st.positions.find((x) => x.id === Number(el.dataset.id));
      if (!p || !(await askDelete('Stelle löschen?', `„${p.title}“ wird von der Karriereseite entfernt. Bestehende Bewerbungen bleiben erhalten.`))) return;
      await api.del('/api/admin/positions/' + p.id);
      toast('Stelle gelöscht.');
      await refreshBehind();
    },

    // Protokoll
    'audit-more': async () => {
      await loadAudit(true);
      $('#auditList').innerHTML = auditTable();
    },

    // Einstellungen & Profil
    'discord-test': async () => {
      await api.post('/api/admin/discord/test');
      toast('Testnachricht an Discord gesendet.');
    },
    'discord-unlink': async () => {
      if (!(await ask('Die Anmeldung per Discord ist danach nicht mehr möglich, bis Sie das Konto erneut verbinden.', { title: 'Discord-Verbindung trennen?', confirmText: 'Trennen' }))) return;
      const res = await api.post('/api/discord/unlink');
      st.user = res.user;
      renderUser();
      renderView();
      toast('Discord-Verbindung getrennt.');
    },
  };

  /* ================================================================
     Formulare
     ================================================================ */
  const forms = {
    'new-case': async (f) => {
      const fd = new FormData(f);
      const body = { title: val(fd, 'title'), area: val(fd, 'area'), urgency: val(fd, 'urgency'), description: val(fd, 'description') };
      if (isStaff()) {
        if (val(fd, 'clientEmail')) body.clientEmail = val(fd, 'clientEmail');
        else if (!val(fd, 'clientName')) throw new Error('Bitte den Namen des Mandanten oder die E-Mail eines Mandantenkontos angeben.');
        ['clientName', 'clientPhone', 'opponent', 'courtRef'].forEach((k) => {
          if (val(fd, k)) body[k] = val(fd, k);
        });
        if (f.elements.lawyerId) body.lawyerId = val(fd, 'lawyerId') ? Number(val(fd, 'lawyerId')) : null;
      }
      const res = await api.post('/api/cases', body);
      toast(`Akte ${res.case.caseNumber} angelegt.`);
      st.caseFilter = 'aktiv';
      await navigate('cases');
      await openCase(res.case.id);
    },
    'case-edit': async (f) => {
      const fd = new FormData(f);
      const id = Number(f.dataset.id);
      const body = {};
      ['title', 'area', 'urgency', 'clientName', 'clientPhone', 'opponent', 'courtRef', 'description', 'publicNote'].forEach((k) => {
        if (f.elements[k]) body[k] = val(fd, k);
      });
      if (f.elements.step) body.step = Number(fd.get('step'));
      if (f.elements.lawyerId) body.lawyerId = fd.get('lawyerId') ? Number(fd.get('lawyerId')) : null;
      await api.patch('/api/cases/' + id, body);
      toast('Akte gespeichert.');
      await reloadCase(id);
    },
    'add-note': async (f) => {
      const fd = new FormData(f);
      const id = Number(f.dataset.id);
      await api.post(`/api/cases/${id}/notes`, { body: val(fd, 'body'), internal: fd.get('internal') === 'on' });
      toast('Eintrag gespeichert.');
      await reloadCase(id);
    },
    event: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      if (!fd.get('startsAt')) throw new Error('Bitte Datum und Uhrzeit angeben.');
      const body = {
        type: val(fd, 'type'),
        title: val(fd, 'title'),
        startsAt: new Date(fd.get('startsAt')).toISOString(),
        endsAt: fd.get('endsAt') ? new Date(fd.get('endsAt')).toISOString() : null,
        location: val(fd, 'location'),
        note: val(fd, 'note'),
        caseId: fd.get('caseId') ? Number(fd.get('caseId')) : null,
        assignedTo: fd.get('assignedTo') ? Number(fd.get('assignedTo')) : null,
        clientVisible: fd.get('clientVisible') === 'on',
      };
      if (id) await api.patch('/api/calendar/' + id, body);
      else await api.post('/api/calendar', body);
      toast(id ? 'Eintrag gespeichert.' : 'Eintrag angelegt.');
      await returnOrClose();
    },
    'event-request': async (f) => {
      const fd = new FormData(f);
      if (!fd.get('startsAt')) throw new Error('Bitte einen Wunschtermin angeben.');
      const body = { title: val(fd, 'title'), startsAt: new Date(fd.get('startsAt')).toISOString(), location: val(fd, 'location'), note: val(fd, 'note') };
      if (fd.get('caseId')) body.caseId = Number(fd.get('caseId'));
      await api.post('/api/calendar', body);
      toast('Terminanfrage gesendet – die Kanzlei bestätigt Ihren Termin.');
      await returnOrClose();
    },
    compose: async (f) => {
      const fd = new FormData(f);
      const recipient = val(fd, 'recipient');
      if (!recipient) throw new Error('Bitte einen Empfänger auswählen.');
      const body = { subject: val(fd, 'subject'), body: val(fd, 'body'), priority: fd.get('priority') === 'on' };
      if (recipient === 'broadcast') body.broadcast = true;
      else body.recipientId = Number(recipient);
      if (fd.get('caseId')) body.caseId = Number(fd.get('caseId'));
      const res = await api.post('/api/messages', body);
      toast(res.sent > 1 ? `Rundschreiben an ${res.sent} Teammitglieder versendet.` : 'Nachricht gesendet.');
      if (st.view === 'mail' && !st.returnCase) {
        st.mailBox = 'sent';
        st.mailSel = null;
      }
      await returnOrClose();
    },
    board: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const body = { title: val(fd, 'title'), body: val(fd, 'body'), color: val(fd, 'color') || 'gold', pinned: fd.get('pinned') === 'on' };
      if (id) await api.patch('/api/board/' + id, body);
      else await api.post('/api/board', body);
      toast('Notiz gespeichert.');
      closeModal();
      await refreshBehind();
    },
    invoice: async () => {
      const d = st.draft;
      const items = d.items
        .map((it) => ({ description: String(it.description || '').trim(), quantity: Math.max(1, Math.round(Number(it.quantity) || 1)), unitPrice: Math.max(0, Math.round(Number(it.unitPrice) || 0)) }))
        .filter((it) => it.description);
      if (!items.length) throw new Error('Bitte mindestens eine Position mit Bezeichnung erfassen.');
      if (!d.clientName.trim()) throw new Error('Bitte den Empfänger angeben.');
      const res = await api.post('/api/invoices', {
        kind: d.kind,
        caseId: d.caseId || null,
        clientName: d.clientName.trim(),
        clientContact: d.clientContact.trim(),
        subject: d.subject.trim(),
        items,
        discountPct: clampPct(d.discountPct),
        surchargePct: clampPct(d.surchargePct),
        dueDate: d.dueDate || null,
        notes: d.notes.trim(),
      });
      st.draft = null;
      const inv = res.invoice;
      await navigate('invoices');
      openModal(`
        <h2 class="modal-title">${esc(INVOICE_KIND[inv.kind])} erstellt</h2>
        <p class="modal-sub">Nummer <span class="font-mono text-gold">${esc(inv.number)}</span> über <strong>${money(inv.total)}</strong> an ${esc(inv.clientName)}.</p>
        <div class="form-actions">
          <a class="btn-gold btn-md" href="/invoice.html?id=${inv.id}" target="_blank" rel="noopener">${icon('printer', 'ico-sm')}<span>Drucken / Als PDF speichern</span></a>
          <button class="btn-ghost btn-md" data-action="close-modal">Schließen</button>
        </div>`);
    },
    team: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const body = {
        name: val(fd, 'name'),
        roleTitle: val(fd, 'roleTitle'),
        tier: val(fd, 'tier'),
        description: val(fd, 'description'),
        initials: val(fd, 'initials'),
        visible: fd.get('visible') === 'on',
      };
      const mode = fd.get('accountMode');
      if (mode === 'link') {
        const userId = Number(fd.get('userId'));
        if (!userId) throw new Error('Bitte ein Konto zum Verknüpfen auswählen.');
        body.userId = userId;
      } else if (mode === 'create') {
        const email = val(fd, 'accountEmail');
        if (!email) throw new Error('Bitte eine E-Mail-Adresse für das Login-Konto angeben.');
        body.createAccount = { email, role: val(fd, 'accountRole') };
      }
      if (fd.get('unlink') === 'on') body.userId = null;
      const res = id ? await api.patch('/api/admin/team/' + id, body) : await api.post('/api/admin/team', body);
      toast(id ? 'Gespeichert – live auf der Website.' : 'Hinzugefügt – live auf der Website.');
      st.lawyers = [];
      st.contacts = null;
      if (res.credentials) showCredentials(res.credentials, body.name);
      else closeModal();
      await refreshBehind();
    },
    'team-delete': async (f) => {
      const fd = new FormData(f);
      const res = await api.del(`/api/admin/team/${f.dataset.id}${fd.get('lock') === 'on' ? '?lockAccount=1' : ''}`);
      toast(res.accountLocked ? 'Profil entfernt und Login-Konto gesperrt.' : 'Profil entfernt.');
      closeModal();
      await refreshBehind();
    },
    'user-new': async (f) => {
      const fd = new FormData(f);
      const body = { displayName: val(fd, 'displayName'), email: val(fd, 'email'), role: val(fd, 'role') };
      if (val(fd, 'rank')) body.rank = val(fd, 'rank');
      if (val(fd, 'phone')) body.phone = val(fd, 'phone');
      const res = await api.post('/api/admin/users', body);
      st.lawyers = [];
      st.contacts = null;
      showCredentials(res.credentials, body.displayName);
      await refreshBehind();
    },
    fee: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const body = {
        name: val(fd, 'name'),
        category: val(fd, 'category'),
        price: Math.max(0, Math.round(Number(fd.get('price')) || 0)),
        description: val(fd, 'description'),
        inCalculator: fd.get('inCalculator') === 'on',
        active: fd.get('active') === 'on',
      };
      if (val(fd, 'sortOrder') !== '') body.sortOrder = Math.max(0, Math.round(Number(fd.get('sortOrder')) || 0));
      if (id) await api.patch('/api/admin/fees/' + id, body);
      else await api.post('/api/admin/fees', body);
      toast('Honorarordnung aktualisiert – live auf der Website.');
      closeModal();
      await refreshBehind();
    },
    'settings-discord': async (f) => {
      const fd = new FormData(f);
      const events = $$('input[name="events"]:checked', f).map((i) => i.value);
      const pingEvents = $$('input[name="pingEvents"]:checked', f).map((i) => i.value);
      const res = await api.patch('/api/admin/settings', { discordWebhookUrl: val(fd, 'webhook'), discordEvents: events, discordPingRole: val(fd, 'pingRole'), discordPingEvents: pingEvents });
      st.settings = res.settings;
      toast('Discord-Einstellungen gespeichert.');
      renderView();
    },
    'settings-website': async (f) => {
      const res = await api.patch('/api/admin/settings', { showDutyPublic: !!f.elements.showDutyPublic.checked });
      st.settings = res.settings;
      toast('Website-Einstellungen gespeichert.');
    },
    'duty-note': async (f) => {
      await setDutyStatus(myDutyStatus(), val(new FormData(f), 'note'));
    },
    'duty-session': async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const iso = (k) => (fd.get(k) ? new Date(fd.get(k)).toISOString() : undefined);
      if (id) {
        const body = { startedAt: iso('startedAt'), note: val(fd, 'note') };
        if (iso('endedAt')) body.endedAt = iso('endedAt');
        await api.patch('/api/duty/sessions/' + id, body);
      } else {
        await api.post('/api/duty/sessions', { userId: Number(fd.get('userId')), startedAt: iso('startedAt'), endedAt: iso('endedAt'), note: val(fd, 'note') });
      }
      toast('Dienstzeit gespeichert.');
      closeModal();
      await refreshBehind();
    },
    'app-interview': async (f) => {
      const fd = new FormData(f);
      if (!fd.get('startsAt')) throw new Error('Bitte einen Termin wählen.');
      const data = await api.post(`/api/admin/applications/${f.dataset.id}/interview`, {
        startsAt: new Date(fd.get('startsAt')).toISOString(),
        location: val(fd, 'location'),
      });
      toast('Gespräch geplant – der Termin steht im Kalender.');
      await reloadApplication(data);
    },
    'app-public-note': async (f) => {
      const data = await api.patch('/api/admin/applications/' + f.dataset.id, { publicNote: val(new FormData(f), 'publicNote') });
      toast('Nachricht an den Bewerber gespeichert.');
      await reloadApplication(data);
    },
    'app-note': async (f) => {
      const data = await api.post(`/api/admin/applications/${f.dataset.id}/notes`, { body: val(new FormData(f), 'body') });
      toast('Notiz gespeichert.');
      await reloadApplication(data);
    },
    'app-hire': async (f) => {
      const fd = new FormData(f);
      const res = await api.post(`/api/admin/applications/${f.dataset.id}/hire`, {
        email: val(fd, 'email'),
        rank: val(fd, 'rank'),
        role: val(fd, 'role'),
        description: val(fd, 'description'),
        createProfile: fd.get('createProfile') === 'on',
        visible: fd.get('visible') === 'on',
      });
      st.lawyers = [];
      st.contacts = null;
      toast(`${res.application.name} wurde eingestellt.`);
      showCredentials(res.credentials, res.application.name);
      refreshBehind();
    },
    position: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const body = { title: val(fd, 'title'), description: val(fd, 'description'), requirements: val(fd, 'requirements'), active: fd.get('active') === 'on' };
      if (id) await api.patch('/api/admin/positions/' + id, body);
      else await api.post('/api/admin/positions', body);
      toast('Stelle gespeichert – live auf der Karriereseite.');
      closeModal();
      await refreshBehind();
    },
    'ext-link': async (f) => {
      const fd = new FormData(f);
      const provider = f.dataset.provider;
      if (provider === 'fivenet' && fd.get('attest') !== 'on') throw new Error('Bitte bestätigen Sie, dass Sie das Dokument in FiveNet selbst einsehen dürfen.');
      const res = await api.post(extUrl(f.dataset.caseId), { provider, input: val(fd, 'input'), attest: provider === 'fivenet', ...fivenetBody(f) });
      st.fivenet = null; // Vorschläge (Dokumentarten, Charakter) neu laden
      toast(`${EXT[provider].noun} mit der Akte verknüpft.`);
      reportImport(await importPendingImages(Number(f.dataset.caseId), res.document));
      await returnOrClose();
    },
    'ext-edit': async (f) => {
      const res = await api.patch(extUrl(f.dataset.caseId, f.dataset.id), fivenetBody(f));
      st.fivenet = null;
      toast('Angaben gespeichert.');
      reportImport(await importPendingImages(Number(f.dataset.caseId), res.document));
      await returnOrClose();
    },
    'settings-fivenet': async (f) => {
      const res = await api.patch('/api/admin/settings', { fivenetUrl: val(new FormData(f), 'fivenetUrl') });
      st.settings = res.settings;
      await load.fivenet(true);
      toast('FiveNet-Einstellungen gespeichert.');
      renderView();
    },
    'task-quick': async (f) => {
      const fd = new FormData(f);
      const body = { title: val(fd, 'title'), caseId: Number(f.dataset.caseId) };
      if (val(fd, 'dueDate')) body.dueDate = val(fd, 'dueDate');
      await api.post('/api/tasks', body);
      toast(body.dueDate ? 'Wiedervorlage angelegt.' : 'Aufgabe angelegt.');
      await afterTaskChange();
    },
    task: async (f) => {
      const fd = new FormData(f);
      const id = f.dataset.id ? Number(f.dataset.id) : null;
      const body = {
        title: val(fd, 'title'),
        note: val(fd, 'note'),
        dueDate: val(fd, 'dueDate') || null,
        assignedTo: val(fd, 'assignedTo') ? Number(val(fd, 'assignedTo')) : null,
      };
      if (id) {
        await api.patch('/api/tasks/' + id, body);
      } else {
        if (val(fd, 'caseId')) body.caseId = Number(val(fd, 'caseId'));
        await api.post('/api/tasks', body);
      }
      toast(id ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
      load.dueTasks().then(renderNav).catch(() => {});
      await returnOrClose();
    },
    'settings-firm': async (f) => {
      const fd = new FormData(f);
      const res = await api.patch('/api/admin/settings', { firmAddress: val(fd, 'firmAddress'), firmPaymentInfo: val(fd, 'firmPaymentInfo'), firmContact: val(fd, 'firmContact') });
      st.settings = res.settings;
      toast('Rechnungsdaten gespeichert.');
    },
    profile: async (f) => {
      const fd = new FormData(f);
      const body = { phone: val(fd, 'phone') };
      if (f.elements.displayName) body.displayName = val(fd, 'displayName');
      const res = await api.patch('/api/auth/profile', body);
      st.user = res.user;
      renderUser();
      toast('Profil gespeichert.');
    },
    password: async (f) => {
      const fd = new FormData(f);
      if (fd.get('newPassword') !== fd.get('newPassword2')) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
      await api.post('/api/auth/change-password', { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') });
      st.user.mustChangePassword = false;
      toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
      renderView();
    },
  };

  /* ================================================================
     Ereignisse
     ================================================================ */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#dutyWrap')) closeDutyPop();
    if (e.target === $('#modal')) {
      closeModal();
      return;
    }
    const link = e.target.closest('a[href^="#"]');
    if (link && !link.dataset.action && link.getAttribute('href') === location.hash) {
      e.preventDefault();
      go(hashView());
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    guard(() => fn(el, e));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#modal').classList.contains('open')) closeModal();
      else closeSidebar();
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
    // Enter in einem Eingabefeld des Generators soll nicht versehentlich die Rechnung erstellen.
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('#invoiceForm')) e.preventDefault();
  });

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f || !forms[f.dataset.form]) return;
    e.preventDefault();
    const buttons = $$('button[type="submit"]', f);
    buttons.forEach((b) => (b.disabled = true));
    guard(() => forms[f.dataset.form](f)).finally(() => buttons.forEach((b) => b.isConnected && (b.disabled = false)));
  });

  document.addEventListener('paste', (e) => {
    const form = e.target && e.target.closest ? e.target.closest('form[data-form="ext-link"], form[data-form="ext-edit"]') : null;
    if (form) onExternalPaste(e, form.dataset.provider);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'caseSearch') {
      st.caseQuery = t.value;
      $('#caseList').innerHTML = caseTable();
    } else if (t.id === 'fnInput') {
      clearTimeout(st.fnTimer);
      st.fnTimer = setTimeout(() => checkFivenetInput(t), 300);
    } else if (t.id === 'gdInput') {
      clearTimeout(st.fnTimer);
      st.fnTimer = setTimeout(() => loadGoogleDoc(t.value.trim()), 400);
    } else if (t.id === 'fnContent') {
      t.dataset.auto = '0'; // von Hand geändert – beim nächsten automatischen Laden nicht überschreiben
    } else if (t.id === 'taskSearch') {
      st.taskQuery = t.value;
      $('#taskList').innerHTML = taskList();
    } else if (t.id === 'userSearch') {
      st.userQuery = t.value;
      $('#userList').innerHTML = userTable();
    } else if (t.id === 'auditSearch') {
      st.auditQuery = t.value.trim();
      clearTimeout(st.auditTimer);
      st.auditTimer = setTimeout(() => {
        guard(async () => {
          await loadAudit();
          if (st.view === 'audit') $('#auditList').innerHTML = auditTable();
        });
      }, 300);
    } else if (t.closest('#invoiceForm') && t.type !== 'radio' && t.tagName !== 'SELECT') {
      onInvoiceInput(t);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.upload) {
      guard(() => handleUpload(t));
      return;
    }
    if (t.closest('#invoiceForm')) {
      onInvoiceChange(t);
      return;
    }
    if (t.name === 'accountMode') {
      $$('[data-account-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.accountPane !== t.value));
      return;
    }
    if (t.name === 'type' && t.form && t.form.dataset.form === 'event' && !t.form.dataset.id && t.form.elements.clientVisible) {
      t.form.elements.clientVisible.checked = ['mandant', 'gericht'].includes(t.value);
      return;
    }
    if (t.dataset.userField) guard(() => updateUserField(t));
  });

  window.addEventListener('hashchange', () => go(hashView()));

  // Ungelesene Post, neue Bewerbungen und Dienststatus regelmäßig aktualisieren (Badges in der Navigation)
  setInterval(() => {
    if (document.hidden || !st.user) return;
    Promise.all([load.unread(), load.appCount(), load.dueTasks()])
      .then(renderNav)
      .catch(() => {});
  }, 30000);
  setInterval(() => {
    if (document.hidden || !st.user || !isStaff() || st.view === 'duty') return;
    load
      .duty()
      .then(() => renderUser())
      .catch(() => {});
  }, 60000);

  /* ================================================================
     Start
     ================================================================ */
  (async function start() {
    try {
      st.user = (await api.get('/api/auth/me')).user;
    } catch {
      location.href = '/login.html?next=' + encodeURIComponent('/dashboard.html' + location.hash);
      return;
    }
    renderUser();

    const params = new URLSearchParams(location.search);
    const discordState = params.get('discord');
    const caseParam = Number(params.get('case'));
    if (discordState || params.has('case')) history.replaceState(null, '', location.pathname + location.hash);
    if (discordState && DISCORD_MSG[discordState]) toast(...DISCORD_MSG[discordState]);

    try {
      await Promise.all([load.unread(), load.appCount(), load.duty(), load.dueTasks()]);
      renderUser();
    } catch {
      /* Badges und Dienststatus sind nicht kritisch */
    }
    await go(hashView());
    if (Number.isInteger(caseParam) && caseParam > 0) guard(() => openCase(caseParam));
  })();
})();
