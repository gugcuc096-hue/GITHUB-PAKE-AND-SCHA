'use strict';
/* Abfragen – Geld: Rechnungen, Mitgliedschaften (VIP), Kooperationen. Nutzung: Q.<tabelle>.<name>.get(…) / .all(…) / .run(…) */
const { db } = require('../db');

module.exports = {
  cooperations: {
    get getById() {
      return db.prepare('SELECT * FROM cooperations WHERE id = ?');
    },
  },
  invoices: {
    get clearPaymentReportById() {
      return db.prepare(`UPDATE invoices SET payment_reported_at = NULL, payment_note = '', payment_proof = '', payment_reported_by = NULL WHERE id = ?`);
    },
  },
  membershipRequests: {
    get getById() {
      return db.prepare('SELECT * FROM membership_requests WHERE id = ?');
    },
  },
  membershipTiers: {
    get benefitsById() {
      return db.prepare('SELECT benefits FROM membership_tiers WHERE id = ?');
    },
    get getActiveById() {
      return db.prepare('SELECT * FROM membership_tiers WHERE id = ? AND active = 1');
    },
    get getById() {
      return db.prepare('SELECT * FROM membership_tiers WHERE id = ?');
    },
  },
  memberships: {
    get endById() {
      return db.prepare(`UPDATE memberships SET status = 'beendet', ended_at = ?, ended_by_name = ?, end_reason = ? WHERE id = ?`);
    },
    get getById() {
      return db.prepare('SELECT * FROM memberships WHERE id = ?');
    },
  },
};
