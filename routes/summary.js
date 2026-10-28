'use strict';
/*
 * „Willkommen zurück“ auf der Startseite: was für die angemeldete Person gerade ansteht, als kurze Liste mit
 * Direktlinks ins Dashboard. Kommt aus denselben Schnittstellen wie das Dashboard (mit den Rechten der Person) –
 * die Startseite zeigt also nur eine Kurzfassung, keine eigene Wahrheit.
 *  GET /api/summary?today=JJJJ-MM-TT
 *  → { name, role, items: [{ kind, text, href, tone }], cases: [{ id, caseNumber, title, href }] }
 */
const express = require('express');
const { requireAuth } = require('../auth');
const { wrap } = require('../helpers');
const { collect } = require('../collect');

const router = express.Router();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const first = (name) => String(name || '').replace(/\b(Dr|Prof|jur|med|rer|nat)\.\s*/gi, '').trim().split(/\s+/)[0] || '';

router.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const u = req.user;
    const staff = u.role === 'anwalt' || u.role === 'admin';
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.today || '')) ? req.query.today : new Date().toISOString().slice(0, 10);
    const jobs = { cases: '/api/cases', calendar: '/api/calendar', unread: '/api/messages/unread-count' };
    if (staff) Object.assign(jobs, { due: `/api/tasks/due-count?today=${today}`, payments: '/api/invoices/payment-reports' });
    else Object.assign(jobs, { requests: '/api/requests/mine', toSign: '/api/contracts/to-sign', invoices: '/api/invoices', chat: '/api/cases/chat-unread' });
    const r = await collect(req, jobs);

    const items = [];
    const add = (kind, text, href, tone = '') => items.push({ kind, text, href, tone });
    const events = (r.calendar && r.calendar.events) || [];
    const now = Date.now();
    if (staff) {
      if (r.due && r.due.due) add('tasks', `${plural(r.due.due, 'Aufgabe', 'Aufgaben')} fällig`, '/dashboard#tasks', 'amber');
      const todays = events.filter((e) => e.status === 'bestaetigt' && e.startsAt && e.startsAt.slice(0, 10) === today && new Date(e.startsAt).getTime() > now - 3600e3);
      if (todays.length) add('calendar', `${plural(todays.length, 'Termin/Frist', 'Termine und Fristen')} heute`, '/dashboard#calendar', 'sky');
      if (r.payments && r.payments.count) add('invoices', `${plural(r.payments.count, 'gemeldete Zahlung', 'gemeldete Zahlungen')} prüfen`, '/dashboard#invoices', 'gold');
    } else {
      const proposals = events.filter((e) => e.proposal && e.clientId === u.id);
      for (const e of proposals) add('proposal', `Terminvorschlag „${e.title}“ – Zeit wählen`, `/dashboard?event=${e.id}`, 'gold');
      const reqs = (r.requests && r.requests.requests) || [];
      if (reqs.length) add('requests', reqs.length === 1 ? `Unterlage nachreichen: ${reqs[0].title}` : `${reqs.length} Unterlagen nachreichen`, '/dashboard#overview', 'amber');
      const sign = (r.toSign && r.toSign.contracts) || [];
      if (sign.length) add('contract', sign.length === 1 ? `${sign[0].templateName} unterschreiben` : `${sign.length} Dokumente unterschreiben`, '/dashboard#overview', 'gold');
      const open = ((r.invoices && r.invoices.invoices) || []).filter((i) => i.status === 'offen' && !i.paymentReport);
      if (open.length) add('invoice', `${plural(open.length, 'Rechnung', 'Rechnungen')} offen`, '/dashboard#invoices', 'amber');
      const chat = r.chat && r.chat.total;
      if (chat) add('chat', `${plural(chat, 'neue Nachricht', 'neue Nachrichten')} Ihrer Kanzlei`, '/dashboard#cases', 'sky');
      const next = events.filter((e) => e.status === 'bestaetigt' && e.type !== 'frist' && new Date(e.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      if (next) add('next', `Nächster Termin: ${next.title}`, `/dashboard?event=${next.id}`, 'sky');
    }
    if (r.unread && r.unread.unread) add('mail', `${plural(r.unread.unread, 'ungelesene Nachricht', 'ungelesene Nachrichten')} in der Kanzlei-Post`, '/dashboard#mail', 'sky');

    const cases = ((r.cases && r.cases.cases) || [])
      .filter((c) => c.status !== 'geschlossen')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 3)
      .map((c) => ({ id: c.id, caseNumber: c.caseNumber, title: c.title, href: `/dashboard?case=${c.id}` }));

    res.json({ name: first(u.display_name), role: u.role, items, cases });
  })
);

module.exports = { router };
