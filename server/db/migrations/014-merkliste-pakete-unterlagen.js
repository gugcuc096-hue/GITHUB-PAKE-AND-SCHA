'use strict';
/* Merkliste, Aufgaben-Pakete (mit Startpaketen), fehlende Unterlagen */

module.exports = function up({ db, getSetting, setSetting }) {
  // Merkliste: Akten, die sich eine Person mit Stern gemerkt hat (je Person, für andere unsichtbar)
  db.exec(`CREATE TABLE IF NOT EXISTS case_stars (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, case_id)
  )`);

  // Aufgaben-Pakete je Anlass (z. B. „Festnahme“): vom Board gepflegt, per Klick in eine Akte übernommen.
  // items: eine Aufgabe je Zeile, optional mit Frist in Tagen: „Haftprüfung beantragen | 2“.
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_packages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      area       TEXT NOT NULL DEFAULT '',
      items      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  if (!getSetting('seeded_task_packages')) {
    const ins = db.prepare('INSERT INTO task_packages (name, area, items) VALUES (?, ?, ?)');
    ins.run('Festnahme', 'strafrecht', 'Vollmacht einholen | 1\nAkteneinsicht beantragen | 2\nHaftprüfung beantragen | 2\nMandanten im Gewahrsam besuchen | 1\nBeweismittel sichern | 3');
    ins.run('Anklage erhalten', 'strafrecht', 'Anklageschrift prüfen | 2\nVerteidigungsstrategie festlegen | 5\nStrafmaß-Einschätzung erstellen | 5\nHauptverhandlung vorbereiten | 10');
    ins.run('Schadensersatz', 'zivilrecht', 'Unterlagen und Belege anfordern | 2\nAnspruch prüfen | 4\nSchreiben an die Gegenseite aufsetzen | 7\nAntwortfrist der Gegenseite eintragen | 7');
    ins.run('Vertragsabschluss', 'vertragsrecht', 'Anforderungen aufnehmen | 1\nVertragsentwurf erstellen | 5\nEntwurf mit dem Mandanten abstimmen | 7\nUnterzeichnung organisieren | 10');
    setSetting('seeded_task_packages', '1');
  }

  // Fehlende Unterlagen („Beleg fehlt“): die Kanzlei fordert an, der Mandant sieht ein To-do im Portal, nach 3 Tagen erinnert Discord
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_requests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      done_at      TEXT,
      done_by      TEXT NOT NULL DEFAULT '',
      reminded_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_case_requests_case ON case_requests(case_id);
  `);
};
