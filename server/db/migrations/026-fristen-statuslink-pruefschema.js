'use strict';
/*
 * Paket F:
 * - appointments.escalated: Frist kurz vor Ablauf und noch offen → einmalig an das Board of Partners gemeldet
 * - cases.status_token: Statuslink für Mandanten ohne Konto (/verfahrensstand?t=…), leer = kein Link
 * - case_charges.checklist: Prüfschema je Anklagepunkt (JSON: [{ k, label, state, note }])
 */
module.exports = function up({ addColumn }) {
  addColumn('appointments', 'escalated', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('cases', 'status_token', 'TEXT');
  addColumn('case_charges', 'checklist', 'TEXT');
};
