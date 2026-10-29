'use strict';
/*
 * Antwortregeln des Assistenten im Discord-Ticket (assistant.js, Sicht „Mandant“): nur freigegebene Angaben.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const assistant = require('../assistant');

describe('Assistent: Mandanten-Sicht', () => {
  const base = { case: { id: 1, caseNumber: 'PS-1', title: 'T', area: 'strafrecht', areaLabel: 'Strafrecht', step: 2, stepLabel: 'Verhandlung', statusLabel: 'In Bearbeitung', clientName: 'A', closed: false, lawyerId: 5, lawyerName: 'Dr. X', idleDays: 0, hasClientAccount: true, publicNote: 'ok' }, appointments: [], tasks: [], parties: [], attachments: [], invoices: [], requests: [], chat: { messages: [] }, charges: { charges: [], sentence: {}, estimate: {} } };
  const now = new Date('2026-06-10T10:00:00Z');

  it('Mandanten-Sicht kennt nur freigegebene Angaben (Termine, Unterlagen, Rechnungen, Anwalt)', () => {
    const d = { ...base, appointments: [{ id: 1, type: 'gericht', title: 'Verhandlung', typeLabel: 'Gerichtstermin', startsAt: '2026-06-12T10:00:00Z', status: 'bestaetigt', clientVisible: true }, { id: 2, type: 'intern', title: 'GEHEIMER Teamtermin', typeLabel: 'Intern', startsAt: '2026-06-11T10:00:00Z', status: 'bestaetigt', clientVisible: false }], tasks: [{ id: 1, title: 'GEHEIM Aufgabe', done: false }], requests: [{ id: 1, title: 'Führerschein-Foto', createdAt: '2026-06-01 10:00:00' }] };
    const termine = assistant.answer(d, 'Wann ist mein nächster Termin?', { now, audience: 'client' });
    const text = termine.lines.map((l) => l.text).join(' ');
    assert.match(text, /Verhandlung/);
    assert.ok(!/GEHEIM/.test(text));
    assert.match(assistant.answer(d, 'Was fehlt noch von mir?', { now, audience: 'client' }).lines.map((l) => l.text).join(' '), /Führerschein-Foto/);
    const zeug = assistant.answer(d, 'Welche Zeugen gibt es und welche Strafe droht?', { now, audience: 'client' });
    assert.equal(zeug.unknown, true, 'Strategie und Beweise bleiben beim Anwalt');
    assert.ok(!assistant.summary(d, now, 'client').map((s) => s.title).includes('Aufgaben'));
  });
});
