'use strict';
/*
 * Start-Routinen, die bei JEDEM Serverstart laufen. Render (Free/Starter) bietet
 * keine Shell -- alles, was man sonst per Kommandozeile erledigen würde
 * (ersten Admin anlegen, vergessenes Passwort zurücksetzen), passiert hier
 * automatisch und wird über Umgebungsvariablen gesteuert.
 */
const { db, tx, getSetting, setSetting } = require('./db');
const { hashPassword, generateStrongPassword, destroyAllSessions } = require('./auth');
const { deriveInitials } = require('./helpers');
const contracts = require('./contracts');

const DEFAULT_ADMIN_EMAIL = 'alois.pake@pake-scha.ls';

// Feste Team-Besetzung der Kanzlei (Login-Konten + öffentliche Team-Profile).
const TEAM = [
  {
    key: 'PAKE',
    name: 'Dr. Alois Pake',
    email: DEFAULT_ADMIN_EMAIL,
    role: 'admin',
    rank: 'Founding Partner',
    roleTitle: 'Founding Partner',
    tier: 'leitung',
    description: 'Board of Partners. Verfassungsrecht, Grundsatzverfahren und strategische Gesamtverantwortung für alle Mandate.',
  },
  {
    key: 'SCHA',
    name: 'Michael Scha',
    email: 'michael.scha@pake-scha.ls',
    role: 'admin',
    rank: 'Founding Partner',
    roleTitle: 'Founding Partner',
    tier: 'leitung',
    description: 'Wirtschafts- und Strafrecht, Vertretung von Unternehmen und Organisationen.',
  },
  {
    key: 'LEX',
    name: 'Dr. jur. Damat Lex',
    email: 'damat.lex@pake-scha.ls',
    role: 'anwalt',
    rank: 'Senior Associate',
    roleTitle: 'Senior Associate',
    tier: 'anwalt',
    description: 'Mandatsbearbeitung erfahrener Fälle, Haftprüfungen und juristische Grundsatzberatung.',
  },
];

// Startinhalt der Honorarordnung (entspricht der bisherigen Startseite).
const DEFAULT_FEES = [
  ['rechtsberatung', 'Rechtliche Beratung per Ticket', 'Beantwortung rechtlicher Fragen über das Ticketsystem und grundlegende Einschätzung des Sachverhalts.', 15000, 1],
  ['rechtsberatung', 'Persönliche Rechtsberatung', 'Persönliches Beratungsgespräch inklusive rechtlicher Einschätzung und Handlungsempfehlungen.', 25000, 1],
  ['rechtsberatung', 'Erweiterte Fallanalyse', 'Detaillierte Prüfung eines komplexeren Sachverhalts einschließlich vorhandener Akten und Beweise.', 40000, 0],
  ['strafrecht', 'Strafrechtliche Vertretung', 'Umfassende anwaltliche Betreuung und Vertretung des Mandanten in einem strafrechtlichen Verfahren.', 60000, 1],
  ['strafrecht', 'U-Haft-Vertretung vor Ort', 'Unverzügliches Erscheinen bei Festnahme, Wahrnehmung der Beschuldigtenrechte und Vertretung im Verhör.', 50000, 1],
  ['strafrecht', 'Akteneinsicht & Strafantragsprüfung', 'Anforderung und Auswertung behördlicher Ermittlungsakten zur Vorbereitung der Verteidigung.', 30000, 0],
  ['notfall', '24/7 Eilnotdiensteinsatz (Nacht/Feiertag)', 'Sofortige Begleitung bei Durchsuchungen, Beschlagnahmen oder vorläufigen Festnahmen außerhalb der regulären Zeiten.', 75000, 1],
  ['gericht', 'Vertretung Hauptverhandlung (alle Gerichte)', 'Vollständige Vertretung inklusive Plädoyer, Beweisanträgen und Zeugenbefragung vor Gericht.', 100000, 1],
  ['gericht', 'Verfassungsbeschwerde / Grundsatzverfahren', 'Ausarbeitung und Prozessführung bei Grundrechtsverletzungen oder verfassungsrechtlichen Streitfragen.', 150000, 0],
  ['vertraege', 'Vertragsentwurf (Standard)', 'Erstellung rechtssicherer Standardverträge (Kaufvertrag, Arbeitsvertrag, Dienstleistung).', 35000, 1],
  ['vertraege', 'Vertragsprüfung & Überarbeitung', 'Rechtliche Analyse fremder Verträge auf Haftungsrisiken und unwirksame Klauseln.', 25000, 0],
];

const adminEmail = () => (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();

function envFor(seed) {
  if (seed.key === 'PAKE') {
    return { email: adminEmail(), password: process.env.ADMIN_PASSWORD || '' };
  }
  return {
    email: (process.env[`SEED_${seed.key}_EMAIL`] || seed.email).trim().toLowerCase(),
    password: process.env[`SEED_${seed.key}_PASSWORD`] || '',
  };
}

function logCredentials(title, entries, hint) {
  const line = '================================================================';
  console.log(line);
  console.log(` ${title}`);
  console.log('');
  for (const e of entries) {
    console.log(` ${e.name}`);
    console.log(`   E-Mail:   ${e.email}`);
    console.log(`   Passwort: ${e.password}${e.generated ? '   (automatisch erzeugt)' : '   (aus Umgebungsvariable)'}`);
    console.log('');
  }
  if (hint) hint.forEach((h) => console.log(` ${h}`));
  console.log(line);
}

/* ---------------------------------------------------------------- */
/** Einmalige Datenkorrektur älterer Installationen ("Dr. Alois Parker" -> "Dr. Alois Pake"). */
function migrateLegacyData() {
  if (getSetting('migration_v3_team')) return;

  tx(() => {
    const parker = db
      .prepare("SELECT * FROM users WHERE lower(email) = 'alois.parker@pake-scha.ls' OR display_name = 'Dr. Alois Parker'")
      .get();
    if (parker) {
      const target = adminEmail();
      const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(target, parker.id);
      const email = clash ? parker.email : target;
      db.prepare("UPDATE users SET display_name = 'Dr. Alois Pake', rank = 'Founding Partner', email = ? WHERE id = ?").run(email, parker.id);
      console.log(`Migration: Konto "Dr. Alois Parker" heißt jetzt "Dr. Alois Pake" (Login-E-Mail: ${email}, Passwort unverändert).`);
    }
    db.prepare("UPDATE users SET rank = 'Founding Partner' WHERE rank = 'founding_partner'").run();
    db.prepare("UPDATE users SET rank = 'Senior Associate' WHERE rank = 'senior_associate'").run();

    db.prepare(
      "UPDATE team_members SET name = 'Dr. Alois Pake', role_title = 'Founding Partner', initials = 'A.P.' WHERE name = 'Dr. Alois Parker'"
    ).run();
    // Früherer Platzhalter-Eintrag der Startseite (nicht Teil der festen Besetzung).
    db.prepare("DELETE FROM team_members WHERE name = 'Martinez' AND role_title = 'Rechtsanwalt / Mitarbeiter'").run();
    db.prepare("UPDATE team_members SET tier = 'anwalt' WHERE tier NOT IN ('leitung','anwalt')").run();

    // Profile ohne Verknüpfung per Namensgleichheit mit Login-Konten verbinden.
    db.prepare(
      `UPDATE team_members SET user_id = (SELECT u.id FROM users u WHERE u.display_name = team_members.name AND u.role IN ('anwalt','admin') LIMIT 1)
       WHERE user_id IS NULL`
    ).run();

    setSetting('migration_v3_team', new Date().toISOString());
  });
}

/** Erststart: Login-Konten der festen Team-Besetzung anlegen. */
function ensureTeamAccounts() {
  if (getSetting('seeded_team_accounts')) return;

  const created = [];
  tx(() => {
    const insert = db.prepare(
      'INSERT INTO users (email, password_hash, display_name, role, rank, must_change_password) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const seed of TEAM) {
      const env = envFor(seed);
      const exists = db.prepare('SELECT id FROM users WHERE email = ? OR display_name = ?').get(env.email, seed.name);
      if (exists) continue;
      const password = env.password || generateStrongPassword();
      insert.run(env.email, hashPassword(password), seed.name, seed.role, seed.rank, env.password ? 0 : 1);
      created.push({ name: seed.name, email: env.email, password, generated: !env.password });
    }
    setSetting('seeded_team_accounts', new Date().toISOString());
  });

  if (created.length) {
    logCredentials('Erststart: Team-Konten wurden angelegt', created, [
      'Bitte nach dem ersten Login unter "Profil" ein eigenes Passwort setzen.',
      'Feste Start-Passwörter: ADMIN_PASSWORD, SEED_SCHA_PASSWORD, SEED_LEX_PASSWORD',
      'als Umgebungsvariablen setzen (Render → Environment).',
    ]);
  }
}

/** Erststart: öffentliche Team-Profile der Startseite anlegen. */
function ensureTeamProfiles() {
  if (getSetting('seeded_team_profiles')) return;

  tx(() => {
    const insert = db.prepare(
      'INSERT INTO team_members (name, role_title, description, initials, tier, sort_order, user_id, visible) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
    );
    TEAM.forEach((seed, i) => {
      if (db.prepare('SELECT id FROM team_members WHERE name = ?').get(seed.name)) return;
      const user = db.prepare('SELECT id FROM users WHERE display_name = ?').get(seed.name);
      insert.run(seed.name, seed.roleTitle, seed.description, deriveInitials(seed.name), seed.tier, i + 1, user ? user.id : null);
    });
    setSetting('seeded_team_profiles', new Date().toISOString());
  });
}

/**
 * Notfall-Admin: Existiert kein aktiver Admin mehr (z. B. alle gesperrt oder
 * gelöscht), wird das Konto von Dr. Alois Pake automatisch wiederhergestellt.
 */
function ensureMainAdmin() {
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  if (admins > 0) return;

  const email = adminEmail();
  const envPassword = process.env.ADMIN_PASSWORD || '';
  const password = envPassword || generateStrongPassword();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (existing) {
    db.prepare(
      "UPDATE users SET role = 'admin', active = 1, password_hash = ?, must_change_password = ? WHERE id = ?"
    ).run(hashPassword(password), envPassword ? 0 : 1, existing.id);
    destroyAllSessions(existing.id);
  } else {
    db.prepare(
      "INSERT INTO users (email, password_hash, display_name, role, rank, must_change_password) VALUES (?, ?, 'Dr. Alois Pake', 'admin', 'Founding Partner', ?)"
    ).run(email, hashPassword(password), envPassword ? 0 : 1);
  }

  logCredentials('Kein aktiver Admin gefunden – Haupt-Admin wurde (wieder)hergestellt', [
    { name: 'Dr. Alois Pake (Board of Partners)', email, password, generated: !envPassword },
  ]);
}

/**
 * Passwort vergessen, ohne Shell: ADMIN_RESET_PASSWORD in Render setzen,
 * neu deployen, einloggen -- danach die Variable wieder entfernen.
 */
function applyEmergencyReset() {
  const newPassword = process.env.ADMIN_RESET_PASSWORD;
  if (!newPassword) return;
  if (newPassword.length < 10) {
    console.warn('ADMIN_RESET_PASSWORD ignoriert: mindestens 10 Zeichen erforderlich.');
    return;
  }

  const email = adminEmail();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare(
      "UPDATE users SET role = 'admin', active = 1, password_hash = ?, must_change_password = 0 WHERE id = ?"
    ).run(hashPassword(newPassword), existing.id);
    destroyAllSessions(existing.id);
  } else {
    db.prepare(
      "INSERT INTO users (email, password_hash, display_name, role, rank) VALUES (?, ?, 'Dr. Alois Pake', 'admin', 'Founding Partner')"
    ).run(email, hashPassword(newPassword));
  }

  console.warn('================================================================');
  console.warn(` NOTFALL-RESET: Passwort für ${email} wurde auf den Wert`);
  console.warn(' von ADMIN_RESET_PASSWORD gesetzt, Konto ist aktiv und Admin.');
  console.warn(' Bitte ADMIN_RESET_PASSWORD jetzt in Render wieder ENTFERNEN,');
  console.warn(' sonst wird das Passwort bei jedem Neustart erneut überschrieben.');
  console.warn('================================================================');
}

function ensureDefaultFees() {
  if (getSetting('seeded_fees')) return;
  tx(() => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM fees').get().n;
    if (count === 0) {
      const insert = db.prepare(
        'INSERT INTO fees (category, name, description, price, in_calculator, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      );
      DEFAULT_FEES.forEach(([category, name, description, price, calc], i) => insert.run(category, name, description, price, calc, i + 1));
    }
    setSetting('seeded_fees', new Date().toISOString());
  });
}

// Erste Stellenausschreibungen für die Karriereseite (im Dashboard änderbar).
const DEFAULT_POSITIONS = [
  [
    'Associate / Rechtsanwalt (m/w/d)',
    'Eigenständige Mandatsbearbeitung im Tagesgeschäft: Ticketbearbeitung, Beratungsgespräche, Vertretung bei Festnahmen und vor allen Gerichten.',
    'Juristische Ausbildung oder vergleichbare Erfahrung (IC), sicheres Auftreten, Zuverlässigkeit und regelmäßige Aktivität.',
  ],
  [
    'Junior Associate (m/w/d)',
    'Einstieg in die Anwaltschaft mit Mentoring durch die Partner: Recherche, Akteneinsicht, Vorbereitung von Beweisanträgen und Begleitung zu Gerichtsterminen.',
    'Interesse am Rechtssystem, Lernbereitschaft und Teamgeist. Vorerfahrung ist kein Muss.',
  ],
  [
    'Kanzleiassistenz / Sekretariat (m/w/d)',
    'Organisation der Kanzlei: Terminvergabe, Mandantenempfang, Pflege der Aktenverwaltung und Vorbereitung von Rechnungen.',
    'Organisationstalent, freundliches Auftreten und gute Erreichbarkeit.',
  ],
];

function ensureDefaultPositions() {
  if (getSetting('seeded_positions')) return;
  tx(() => {
    if (db.prepare('SELECT COUNT(*) AS n FROM positions').get().n === 0) {
      const insert = db.prepare('INSERT INTO positions (title, description, requirements, sort_order) VALUES (?, ?, ?, ?)');
      DEFAULT_POSITIONS.forEach(([title, description, requirements], i) => insert.run(title, description, requirements, i + 1));
    }
    setSetting('seeded_positions', new Date().toISOString());
  });
}

/**
 * Einmalige Textkorrektur: Die Kanzlei vertritt vor allen Gerichten, nicht nur vor dem District Court.
 * Geändert werden nur Einträge, die noch genau dem früheren Standardtext entsprechen –
 * im Dashboard selbst angepasste Texte bleiben unberührt.
 */
function fixCourtWording() {
  if (getSetting('fixed_court_wording')) return;
  tx(() => {
    db.prepare('UPDATE fees SET name = ? WHERE name = ?').run(
      'Vertretung Hauptverhandlung (alle Gerichte)',
      'Vertretung Hauptverhandlung (US District Court)'
    );
    db.prepare('UPDATE positions SET description = ? WHERE description = ?').run(
      'Eigenständige Mandatsbearbeitung im Tagesgeschäft: Ticketbearbeitung, Beratungsgespräche, Vertretung bei Festnahmen und vor allen Gerichten.',
      'Eigenständige Mandatsbearbeitung im Tagesgeschäft: Ticketbearbeitung, Beratungsgespräche, Vertretung bei Festnahmen und vor dem District Court.'
    );
    setSetting('fixed_court_wording', new Date().toISOString());
  });
}

/** Mitgelieferte Vertragsvorlagen einmalig anlegen (danach im Dashboard änderbar). */
function ensureContractTemplates() {
  // Unverändert übernommene ältere Fassungen auf den aktuellen Stand bringen (eigene Änderungen bleiben).
  for (const t of contracts.DEFAULT_TEMPLATES) {
    for (const old of contracts.PREVIOUS_VERSIONS[t.key] || []) {
      const r = db.prepare("UPDATE contract_templates SET body = ?, updated_at = datetime('now') WHERE key = ? AND body = ?").run(t.body, t.key, old);
      if (r.changes) console.log(`Vertragsvorlage „${t.name}“ auf die aktuelle Fassung aktualisiert.`);
    }
  }
  const insert = db.prepare('INSERT OR IGNORE INTO contract_templates (key, name, body, sort_order) VALUES (?, ?, ?, ?)');
  contracts.DEFAULT_TEMPLATES.forEach((t, i) => {
    const flag = `seeded_contract_${t.key}`;
    if (getSetting(flag)) return;
    tx(() => {
      insert.run(t.key, t.name, t.body, i + 1);
      setSetting(flag, new Date().toISOString());
    });
  });
}

/**
 * Einmalige Umstellung der Ränge: Es gibt nur noch Founding Partner, Equity Partner, Partner
 * (Board of Partners) sowie Senior Associate, Associate und Junior Associate.
 * „Managing Partner“ und „Managing Partner / Kanzleileitung“ werden zu „Founding Partner“.
 */
function migrateRanks() {
  if (getSetting('migration_ranks_v1')) return;
  const OLD = ['Managing Partner', 'Managing Partner / Kanzleileitung'];
  tx(() => {
    const users = db.prepare(`UPDATE users SET rank = 'Founding Partner' WHERE rank IN (${OLD.map(() => '?').join(',')})`).run(...OLD);
    const team = db.prepare(`UPDATE team_members SET role_title = 'Founding Partner' WHERE role_title IN (${OLD.map(() => '?').join(',')})`).run(...OLD);
    if (users.changes || team.changes) console.log(`Ränge: ${users.changes} Konto/Konten und ${team.changes} Team-Profil(e) von „Managing Partner“ auf „Founding Partner“ umgestellt.`);
    setSetting('migration_ranks_v1', new Date().toISOString());
  });
}

/**
 * Einmalig: Bearbeitungszeiten für Akten nachtragen, die es vor Einführung der Erfassung gab.
 * Beginn = letzter Verlaufseintrag, der den Anwalt nennt (sonst Anlage der Akte), Ende bei
 * geschlossenen Akten = letzte Änderung. Diese Einträge sind als „geschätzt“ markiert.
 */
function backfillCaseWork() {
  if (getSetting('backfilled_case_work')) return;
  const iso = (v) => (v ? `${String(v).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'}` : new Date().toISOString());
  tx(() => {
    const cases = db.prepare('SELECT * FROM cases WHERE id NOT IN (SELECT DISTINCT case_id FROM case_work)').all();
    const add = db.prepare('INSERT INTO case_work (case_id, user_id, role, started_at, ended_at, end_reason, estimated) VALUES (?, ?, ?, ?, ?, ?, 1)');
    for (const c of cases) {
      const team = [];
      if (c.lawyer_id) team.push({ id: c.lawyer_id, role: 'lead' });
      for (const r of db.prepare('SELECT user_id FROM case_lawyers WHERE case_id = ?').all(c.id)) if (r.user_id !== c.lawyer_id) team.push({ id: r.user_id, role: 'co' });
      const closed = c.status === 'geschlossen';
      for (const m of team) {
        const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.id);
        if (!u) continue;
        // Nur Verlaufseinträge, die eine Zuweisung beschreiben (nicht z. B. eine Vertragsunterschrift).
        const n = u.display_name;
        const note = db
          .prepare(
            `SELECT created_at FROM notes WHERE case_id = ? AND system = 1
               AND (instr(body, ?) > 0 OR instr(body, ?) > 0 OR instr(body, ?) > 0 OR instr(body, ?) > 0)
             ORDER BY created_at DESC, id DESC LIMIT 1`
          )
          .get(c.id, `Zuständigkeit: ${n}`, `Federführend: ${n}`, `federführend jetzt: ${n}`, `+ ${n}`);
        add.run(c.id, m.id, m.role, iso(note ? note.created_at : c.created_at), closed ? iso(c.updated_at) : null, closed ? 'Akte geschlossen' : '');
      }
      if (closed && !c.closed_at) db.prepare('UPDATE cases SET closed_at = ? WHERE id = ?').run(iso(c.updated_at), c.id);
    }
    setSetting('backfilled_case_work', new Date().toISOString());
  });
}

function runBootstrap() {
  migrateLegacyData();
  migrateRanks();
  ensureTeamAccounts();
  ensureTeamProfiles();
  ensureMainAdmin();
  applyEmergencyReset();
  ensureDefaultFees();
  ensureDefaultPositions();
  fixCourtWording();
  ensureContractTemplates();
  backfillCaseWork();
}

module.exports = { runBootstrap };
