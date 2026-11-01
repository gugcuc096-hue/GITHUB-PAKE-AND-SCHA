'use strict';
/* Abfragen – Akten: Beweise, Anklagepunkte, Beteiligte, Orte, Notizen, Aufgaben, Präzedenzfälle, Bewertungen, Strafkatalog. Nutzung: Q.<tabelle>.<name>.get(…) / .all(…) / .run(…) */
const { db } = require('../db');

module.exports = {
  caseAttachments: {
    get countByCaseId() {
      return db.prepare('SELECT COUNT(*) AS n FROM case_attachments WHERE case_id = ?');
    },
    get getById() {
      return db.prepare('SELECT * FROM case_attachments WHERE id = ?');
    },
    get getByIdAndCaseId() {
      return db.prepare('SELECT * FROM case_attachments WHERE id = ? AND case_id = ?');
    },
  },
  caseCharges: {
    get countByCaseId() {
      return db.prepare('SELECT COUNT(*) AS n FROM case_charges WHERE case_id = ?');
    },
    get firstByCaseAndOffence() {
      return db.prepare('SELECT id, count FROM case_charges WHERE case_id = ? AND offence_id = ? ORDER BY id LIMIT 1');
    },
    get getByIdAndCaseId() {
      return db.prepare('SELECT * FROM case_charges WHERE id = ? AND case_id = ?');
    },
    get setCountById() {
      return db.prepare('UPDATE case_charges SET count = ? WHERE id = ?');
    },
  },
  caseExternalDocs: {
    get getById() {
      return db.prepare('SELECT * FROM case_external_docs WHERE id = ?');
    },
  },
  caseLawyers: {
    get deleteByCaseIdAndUserId() {
      return db.prepare('DELETE FROM case_lawyers WHERE case_id = ? AND user_id = ?');
    },
    get userIdsByCaseId() {
      return db.prepare('SELECT user_id FROM case_lawyers WHERE case_id = ?');
    },
  },
  caseParties: {
    get getByIdAndCaseId() {
      return db.prepare('SELECT * FROM case_parties WHERE id = ? AND case_id = ?');
    },
  },
  casePlaces: {
    get getByIdAndCaseId() {
      return db.prepare('SELECT * FROM case_places WHERE id = ? AND case_id = ?');
    },
  },
  caseTrash: {
    get deleteById() {
      return db.prepare('DELETE FROM case_trash WHERE id = ?');
    },
  },
  cases: {
    get getById() {
      return db.prepare('SELECT * FROM cases WHERE id = ?');
    },
    get idByCaseNumberAndAccessPin() {
      return db.prepare('SELECT id FROM cases WHERE case_number = ? AND access_pin = ?');
    },
    get touchById() {
      return db.prepare(`UPDATE cases SET updated_at = datetime('now') WHERE id = ?`);
    },
  },
  notes: {
    get getByIdAndCaseId() {
      return db.prepare('SELECT * FROM notes WHERE id = ? AND case_id = ?');
    },
  },
  penalOffences: {
    get getById() {
      return db.prepare('SELECT * FROM penal_offences WHERE id = ?');
    },
  },
  precedents: {
    get existsByCaseId() {
      return db.prepare('SELECT 1 FROM precedents WHERE case_id = ?');
    },
    get getById() {
      return db.prepare('SELECT * FROM precedents WHERE id = ?');
    },
    get idByCaseId() {
      return db.prepare('SELECT id FROM precedents WHERE case_id = ?');
    },
  },
  reviews: {
    get existsByCaseId() {
      return db.prepare('SELECT 1 FROM reviews WHERE case_id = ?');
    },
    get getById() {
      return db.prepare('SELECT * FROM reviews WHERE id = ?');
    },
  },
  taskPackages: {
    get getById() {
      return db.prepare('SELECT * FROM task_packages WHERE id = ?');
    },
  },
  tasks: {
    get titlesByCaseId() {
      return db.prepare('SELECT title FROM tasks WHERE case_id = ?');
    },
  },
};
