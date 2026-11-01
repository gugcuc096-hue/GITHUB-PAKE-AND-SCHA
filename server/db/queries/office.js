'use strict';
/* Abfragen – Kanzlei: Bewerbungen, Anliegen, Vorlagen, Lager, Post, Discord-Bot, Protokoll, Website-Texte, Google Docs. Nutzung: Q.<tabelle>.<name>.get(…) / .all(…) / .run(…) */
const { db } = require('../db');

module.exports = {
  applications: {
    get getById() {
      return db.prepare('SELECT * FROM applications WHERE id = ?');
    },
    get getByNumberAndAccessCode() {
      return db.prepare('SELECT * FROM applications WHERE number = ? AND access_code = ?');
    },
  },
  botMessageJobs: {
    get getById() {
      return db.prepare('SELECT * FROM bot_message_jobs WHERE id = ?');
    },
  },
  botMessageSent: {
    get deleteById() {
      return db.prepare('DELETE FROM bot_message_sent WHERE id = ?');
    },
  },
  concernMessages: {
    get countFromBoardByConcernId() {
      return db.prepare('SELECT COUNT(*) AS n FROM concern_messages WHERE concern_id = ? AND from_board = 1');
    },
  },
  concerns: {
    get markAuthorSeenById() {
      return db.prepare(`UPDATE concerns SET author_seen_at = datetime('now') WHERE id = ?`);
    },
  },
  configLog: {
    get getById() {
      return db.prepare('SELECT * FROM config_log WHERE id = ?');
    },
  },
  contractTemplates: {
    get getById() {
      return db.prepare('SELECT * FROM contract_templates WHERE id = ?');
    },
  },
  googleDocs: {
    get deleteById() {
      return db.prepare('DELETE FROM google_docs WHERE id = ?');
    },
  },
  messages: {
    get getById() {
      return db.prepare('SELECT * FROM messages WHERE id = ?');
    },
    get insert() {
      return db.prepare('INSERT INTO messages (sender_id, recipient_id, case_id, subject, body) VALUES (?, ?, ?, ?, ?)');
    },
  },
  siteTexts: {
    get deleteByPageAndKey() {
      return db.prepare('DELETE FROM site_texts WHERE page = ? AND key = ?');
    },
    get originalAndTextByPageAndKey() {
      return db.prepare('SELECT original, text FROM site_texts WHERE page = ? AND key = ?');
    },
  },
  sqliteMaster: {
    get tableNames() {
      return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    },
  },
  storageEntries: {
    get itemStock() {
      return db.prepare(`SELECT item_id, SUM(amount) AS n FROM storage_entries WHERE kind = 'item' GROUP BY item_id`);
    },
  },
  storageItems: {
    get getActiveById() {
      return db.prepare('SELECT * FROM storage_items WHERE id = ? AND active = 1');
    },
    get getById() {
      return db.prepare('SELECT * FROM storage_items WHERE id = ?');
    },
  },
};
