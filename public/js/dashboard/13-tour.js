/*
 * Kanzlei-Dashboard – Einführungstour beim ersten Login, je Rolle (Mandant, Anwalt, Board) etwa fünf Schritte:
 * ein weicher Lichtkegel legt sich um das Element, daneben eine Karte mit Weiter / Zurück / Überspringen.
 * Gesehen bzw. übersprungen wird je Konto gemerkt (GET/PUT /api/tour); erneut starten: Profil → „Einführung ansehen“.
 * Nicht bei automatisierten Browsern (navigator.webdriver) – dort nur auf ausdrücklichen Aufruf.
 */
'use strict';

const TOUR_VERSION = 1;
const tour = { i: 0, steps: [], root: null };

/** Vorname ohne Titel („Dr. jur. Damat Lex“ → „Damat“). */
const tourFirstName = (n) => String(n || '').split(/\s+/).find((w) => w && !/\.$/.test(w) && !/^(dr|prof|jur|med)$/i.test(w)) || n;
function tourSteps() {
  const staff = isStaff();
  const steps = [
    { title: `Willkommen, ${tourFirstName(st.user.displayName)}!`, text: staff ? 'In einer Minute zeigen wir dir die wichtigsten Stellen des Kanzlei-Dashboards. Du kannst jederzeit überspringen.' : 'In einer Minute zeigen wir Ihnen, wo Sie Ihre Akten, Termine und Nachrichten finden. Sie können jederzeit überspringen.' },
    { sel: '#nav', mobile: '#bottomNav', title: 'Das Menü', text: staff ? 'Akten, Aufgaben, Kalender, Post und alles Weitere. Gruppen lassen sich auf- und zuklappen.' : 'Ihre Akten, Termine, Rechnungen und Nachrichten – alles an einem Ort.' },
  ];
  if (staff) {
    steps.push(
      { sel: '#content .page-actions [data-action="new-case"]', title: 'Neue Akte', text: 'Hier legst du eine Akte an. In Listen hilft ein Rechtsklick auf eine Zeile: öffnen, anpinnen, übernehmen.' },
      { sel: '.topbar-search', title: 'Alles finden – Strg + K', text: 'Akten, Personen, Rechnungen, Wiki und Befehle. Mit Strg + K von überall.' },
      { sel: '#dutyBtn', title: 'Dienststatus', text: 'Zeig dem Team, ob du im Dienst bist – deine Arbeitszeit läuft mit.' }
    );
    if (isBoard()) steps.push({ sel: '#nav a[href="#settings"]', title: 'Einstellungen', text: 'Menü, Startseite, Banner, Status, Automatik-Regeln und mehr – alles ohne Code, mit Entwurf und Vorschau.' });
  } else {
    steps.push(
      { sel: '#content .page-actions [data-action="new-case"]', title: 'Mandat einreichen', text: 'Ein neues Anliegen? Hier beschreiben Sie es – ein Anwalt meldet sich umgehend.' },
      { sel: '#content .kpi-grid, #content .kpi-quiet-grid', title: 'Auf einen Blick', text: 'Laufende Akten, nächster Termin, ungelesene Post und offene Rechnungen.' }
    );
  }
  steps.push({ sel: '#topAvatar', title: 'Ihr Profil', text: staff ? 'Profil, Discord, Benachrichtigungen und Ruhezeiten. Dort startest du diese Einführung auch erneut.' : 'Kontaktdaten, Discord, Benachrichtigungen – und diese Einführung zum erneuten Ansehen.' });
  return steps;
}

function tourTarget(step) {
  const mobile = window.innerWidth < 1024 && step.mobile;
  for (const sel of [mobile ? step.mobile : null, step.sel].filter(Boolean)) {
    const el = document.querySelector(sel);
    if (el && el.getClientRects().length && el.getBoundingClientRect().width) return el;
  }
  return null;
}

function tourShow(i) {
  tour.i = Math.max(0, Math.min(i, tour.steps.length - 1));
  const step = tour.steps[tour.i];
  const el = step.sel ? tourTarget(step) : null;
  if (step.sel && !el && tour.i < tour.steps.length - 1) return tourShow(tour.i + (tour.dir || 1)); // Element fehlt: überspringen
  const root = tour.root;
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  const last = tour.i === tour.steps.length - 1;
  card.innerHTML = `<div class="tour-count">${tour.i + 1} / ${tour.steps.length}</div>
      <h2 class="tour-title" id="tourTitle">${esc(step.title)}</h2><p class="tour-text">${esc(step.text)}</p>
      <div class="tour-dots" aria-hidden="true">${tour.steps.map((_, k) => `<i class="${k === tour.i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tour-btns"><button type="button" class="btn-ghost btn-sm" data-tour="skip">${last ? 'Schließen' : 'Überspringen'}</button><span class="flex-1"></span>
        ${tour.i ? '<button type="button" class="btn-outline btn-sm" data-tour="prev">Zurück</button>' : ''}<button type="button" class="btn-gold btn-sm" data-tour="next">${last ? 'Los geht’s' : 'Weiter'}</button></div>`;
  if (el) {
    el.scrollIntoView({ block: 'nearest', behavior: window.PS.motion.calm() ? 'auto' : 'smooth' });
    const r = el.getBoundingClientRect();
    const pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, opacity: '1' });
    // Karte daneben: rechts, sonst darunter, sonst darüber – immer im Bild
    const cw = Math.min(360, window.innerWidth - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight || 220;
    let left = r.right + 16;
    let top = r.top;
    if (left + cw > window.innerWidth - 12) {
      left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
      top = r.bottom + 16 + ch < window.innerHeight ? r.bottom + 16 : r.top - ch - 16;
    }
    card.style.left = `${left}px`;
    card.style.top = `${Math.max(12, Math.min(top, window.innerHeight - ch - 12))}px`;
    card.classList.remove('is-center');
  } else {
    Object.assign(spot.style, { left: '50%', top: '50%', width: '0px', height: '0px', opacity: '0' });
    card.style.width = `${Math.min(420, window.innerWidth - 24)}px`;
    card.style.left = '';
    card.style.top = '';
    card.classList.add('is-center');
  }
  card.classList.remove('is-in');
  void card.offsetWidth;
  card.classList.add('is-in');
  card.querySelector('[data-tour="next"]').focus({ preventScroll: true });
}

function tourEnd(save = true) {
  if (!tour.root) return;
  const root = tour.root;
  tour.root = null;
  root.classList.remove('is-open');
  setTimeout(() => root.remove(), 260);
  document.removeEventListener('keydown', tourKeys, true);
  window.removeEventListener('resize', tourRelayout);
  if (save) api.put('/api/tour', { done: TOUR_VERSION }).catch(() => {});
}
function tourKeys(e) {
  if (!tour.root) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    tourEnd();
  } else if (e.key === 'ArrowRight') tourStep(1);
  else if (e.key === 'ArrowLeft') tourStep(-1);
}
const tourRelayout = () => tour.root && tourShow(tour.i);
function tourStep(dir) {
  tour.dir = dir;
  if (dir > 0 && tour.i === tour.steps.length - 1) return tourEnd();
  tourShow(tour.i + dir);
}

/** Tour starten (Profil → „Einführung ansehen“ oder automatisch beim ersten Login). */
function startTour() {
  if (tour.root || !st.user) return;
  if ($('#modal.open')) closeModal();
  tour.steps = tourSteps();
  tour.dir = 1;
  const root = document.createElement('div');
  root.className = 'tour-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tourTitle');
  root.innerHTML = '<div class="tour-spot" aria-hidden="true"></div><div class="tour-card"></div>';
  document.body.appendChild(root);
  tour.root = root;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    if (b.dataset.tour === 'skip') tourEnd();
    else tourStep(b.dataset.tour === 'next' ? 1 : -1);
  });
  document.addEventListener('keydown', tourKeys, true);
  window.addEventListener('resize', tourRelayout);
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    tourShow(0);
  });
}
actions['tour-start'] = () => {
  if (st.view !== 'overview') {
    location.hash = '#overview';
    setTimeout(startTour, 700);
  } else startTour();
};

/** Nach dem Start des Dashboards: noch nicht gesehen → Tour (nicht in automatisierten Browsern). */
function tourMaybe() {
  if (navigator.webdriver || !st.user || st.viewAs) return;
  api
    .get('/api/tour')
    .then((r) => {
      if ((r.done || 0) < TOUR_VERSION && st.view === 'overview') setTimeout(startTour, 900);
    })
    .catch(() => {});
}
