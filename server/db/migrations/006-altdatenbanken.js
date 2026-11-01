'use strict';
/* Neuaufbau alter Tabellen (mit Sicherungskopie) und Indizes */
const { CASES_SQL, APPOINTMENTS_SQL, NOTES_SQL } = require('./_kerntabellen');

module.exports = function up({ db, DB_PATH, columns }) {
  // NOT NULL entfernen oder ON-DELETE-Regeln ändern geht in SQLite nur über
  // einen Neuaufbau der Tabelle (offizielles 12-Schritte-Verfahren). Vorher
  // wird automatisch eine vollständige Sicherungskopie der Datenbank angelegt.
  function foreignKeyAction(table, column) {
    const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((f) => f.from === column);
    return fk ? String(fk.on_delete).toUpperCase() : null;
  }

  function migrateLegacyTables() {
    const plan = [];

    if (!columns('cases').includes('status')) {
      const cols = columns('cases');
      const has = (c) => cols.includes(c);
      plan.push({
        table: 'cases',
        sql: CASES_SQL,
        copy: `INSERT INTO cases_new (id, case_number, access_pin, title, area, urgency, description, client_id,
                                      lawyer_id, status, step, public_note, source, created_at, updated_at)
               SELECT id, case_number, access_pin, title, area, urgency, description, client_id, lawyer_id,
                      CASE WHEN ${has('closed') ? 'closed = 1' : '0'} THEN 'geschlossen'
                           WHEN lawyer_id IS NOT NULL THEN 'in_bearbeitung'
                           ELSE 'offen' END,
                      step, ${has('public_note') ? 'public_note' : "''"}, 'portal', created_at, updated_at
               FROM cases`,
      });
    }

    if (!columns('appointments').includes('type')) {
      plan.push({
        table: 'appointments',
        sql: APPOINTMENTS_SQL,
        copy: `INSERT INTO appointments_new (id, case_id, client_id, type, title, starts_at, location, note, status,
                                             client_visible, created_at)
               SELECT id, case_id, client_id, 'mandant', title, starts_at, COALESCE(location, ''), COALESCE(note, ''),
                      status, 1, created_at
               FROM appointments`,
      });
    }

    if (foreignKeyAction('notes', 'author_id') !== 'SET NULL') {
      plan.push({
        table: 'notes',
        sql: NOTES_SQL,
        copy: `INSERT INTO notes_new (id, case_id, author_id, author_name, author_role, body, internal, system, created_at)
               SELECT id, case_id, author_id, author_name, author_role, body, internal, system, created_at FROM notes`,
      });
    }

    if (!plan.length) return;

    const backupPath = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    console.log(`Migration: Sicherungskopie angelegt unter ${backupPath}`);

    db.exec('PRAGMA foreign_keys = OFF');
    // Ohne abgeschaltete Fremdschlüssel würde DROP TABLE abhängige Zeilen
    // (z. B. Notizen) per CASCADE löschen -- daher hart abbrechen.
    if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 0) {
      throw new Error('Migration abgebrochen: Fremdschlüssel konnten nicht deaktiviert werden.');
    }
    try {
      db.exec('BEGIN');
      for (const step of plan) {
        db.exec(`DROP TABLE IF EXISTS ${step.table}_new`);
        db.exec(step.sql(`${step.table}_new`));
        db.exec(step.copy);
        db.exec(`DROP TABLE ${step.table}`);
        db.exec(`ALTER TABLE ${step.table}_new RENAME TO ${step.table}`);
      }
      const problems = db.prepare('PRAGMA foreign_key_check').all();
      if (problems.length) console.warn(`Migration: ${problems.length} verwaiste Fremdschlüssel-Verweise gefunden (Daten bleiben erhalten).`);
      db.exec('COMMIT');
      console.log(`Migration: Tabellen aktualisiert (${plan.map((p) => p.table).join(', ')}).`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  migrateLegacyTables();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cases_client ON cases(client_id);
    CREATE INDEX IF NOT EXISTS idx_cases_lawyer ON cases(lawyer_id);
    CREATE INDEX IF NOT EXISTS idx_case_lawyers_user ON case_lawyers(user_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_case ON case_contracts(case_id);
    CREATE INDEX IF NOT EXISTS idx_contract_lawyers ON case_contract_lawyers(contract_id);
    CREATE INDEX IF NOT EXISTS idx_contract_lawyers_user ON case_contract_lawyers(user_id);
    CREATE INDEX IF NOT EXISTS idx_absences_dates ON absences(end_date, start_date);
    CREATE INDEX IF NOT EXISTS idx_concerns_status ON concerns(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_concerns_reference ON concerns(reference);
    CREATE INDEX IF NOT EXISTS idx_concerns_author ON concerns(author_id);
    CREATE INDEX IF NOT EXISTS idx_concern_messages ON concern_messages(concern_id);
    CREATE INDEX IF NOT EXISTS idx_personnel_created ON personnel_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_case_work_case ON case_work(case_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_case_work_user ON case_work(user_id);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_notes_case ON notes(case_id);
    CREATE INDEX IF NOT EXISTS idx_appt_case ON appointments(case_id);
    CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
    CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(starts_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord ON users(discord_id);
    CREATE INDEX IF NOT EXISTS idx_duty_user ON duty_sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_duty_open ON duty_sessions(ended_at);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_app_notes ON application_notes(application_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_case ON case_attachments(case_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_extdocs_case ON case_external_docs(case_id);
    CREATE INDEX IF NOT EXISTS idx_extdocs_ref ON case_external_docs(provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_extdoc ON case_attachments(external_doc_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, done, due_date);
  `);
};
