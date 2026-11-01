'use strict';
/* Abfragen – Konten, Sitzungen, Team, Ränge, Stellen, Dienst, Namensänderungen. Nutzung: Q.<tabelle>.<name>.get(…) / .all(…) / .run(…) */
const { db } = require('../db');

module.exports = {
  dutySessions: {
    get endOpenByUserId() {
      return db.prepare('UPDATE duty_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL');
    },
    get getById() {
      return db.prepare('SELECT * FROM duty_sessions WHERE id = ?');
    },
  },
  loginChallenges: {
    get deleteExpired() {
      return db.prepare('DELETE FROM login_challenges WHERE expires_at < ?');
    },
  },
  nameRequests: {
    get getById() {
      return db.prepare('SELECT * FROM name_requests WHERE id = ?');
    },
    get withdrawById() {
      return db.prepare(`UPDATE name_requests SET status = 'zurueckgezogen', decided_at = datetime('now') WHERE id = ?`);
    },
  },
  onboarding: {
    get existsByUserId() {
      return db.prepare('SELECT 1 FROM onboarding WHERE user_id = ?');
    },
  },
  onboardingItems: {
    get insert() {
      return db.prepare('INSERT INTO onboarding_items (user_id, label, sort) VALUES (?, ?, ?)');
    },
  },
  positions: {
    get getById() {
      return db.prepare('SELECT * FROM positions WHERE id = ?');
    },
    get setDescriptionByDescription() {
      return db.prepare('UPDATE positions SET description = ? WHERE description = ?');
    },
  },
  ranks: {
    get insert() {
      return db.prepare('INSERT INTO ranks (name, level, badge, description, footer, sort) VALUES (?, ?, ?, ?, ?, ?)');
    },
  },
  sessions: {
    get deleteByToken() {
      return db.prepare('DELETE FROM sessions WHERE token = ?');
    },
  },
  teamMembers: {
    get maxSortOrder() {
      return db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM team_members');
    },
    get setNameByUserId() {
      return db.prepare('UPDATE team_members SET name = ? WHERE user_id = ?');
    },
  },
  users: {
    get activeDiscordIdById() {
      return db.prepare('SELECT discord_id FROM users WHERE id = ? AND active = 1');
    },
    get activeStaffIdById() {
      return db.prepare(`SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1`);
    },
    get clearDutyById() {
      return db.prepare(`UPDATE users SET duty_status = 'off', duty_note = '', duty_since = NULL WHERE id = ?`);
    },
    get clearOwners() {
      return db.prepare('UPDATE users SET is_owner = 0');
    },
    get countActiveAdmins() {
      return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`);
    },
    get discordIdById() {
      return db.prepare('SELECT discord_id FROM users WHERE id = ?');
    },
    get displayNameById() {
      return db.prepare('SELECT display_name FROM users WHERE id = ?');
    },
    get getActiveByDiscordId() {
      return db.prepare('SELECT * FROM users WHERE discord_id = ? AND active = 1');
    },
    get getActiveClientById() {
      return db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'mandant' AND active = 1`);
    },
    get getActiveStaffByDiscordId() {
      return db.prepare(`SELECT * FROM users WHERE discord_id = ? AND active = 1 AND role IN ('anwalt','admin')`);
    },
    get getActiveStaffById() {
      return db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1 AND role IN ('anwalt', 'admin')`);
    },
    get getByDiscordId() {
      return db.prepare('SELECT * FROM users WHERE discord_id = ?');
    },
    get getById() {
      return db.prepare('SELECT * FROM users WHERE id = ?');
    },
    get idAndDiscordIdById() {
      return db.prepare('SELECT id, discord_id FROM users WHERE id = ?');
    },
    get idByEmail() {
      return db.prepare('SELECT id FROM users WHERE email = ?');
    },
    get idByEmailExceptId() {
      return db.prepare('SELECT id FROM users WHERE email = ? AND id != ?');
    },
    get idByEmailOrOldEmail() {
      return db.prepare('SELECT id FROM users WHERE email = ? OR old_email = ?');
    },
    get listActiveStaff() {
      return db.prepare(`SELECT * FROM users WHERE role IN ('anwalt','admin') AND active = 1 ORDER BY display_name`);
    },
    get rankById() {
      return db.prepare('SELECT rank FROM users WHERE id = ?');
    },
    get setDiscordUsernameAndDiscordAvatarById() {
      return db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?');
    },
    get setDisplayNameAndRankById() {
      return db.prepare('UPDATE users SET display_name = ?, rank = ? WHERE id = ?');
    },
    get setDisplayNameById() {
      return db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
    },
    get setRankById() {
      return db.prepare('UPDATE users SET rank = ? WHERE id = ?');
    },
    get setTempPasswordById() {
      return db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?');
    },
    get staffIdById() {
      return db.prepare(`SELECT id FROM users WHERE id = ? AND role IN ('anwalt','admin')`);
    },
  },
};
