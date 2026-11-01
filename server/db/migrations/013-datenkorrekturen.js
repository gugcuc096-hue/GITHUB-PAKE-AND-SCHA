'use strict';
/* Einmalige Datenkorrekturen: Priorität aus Dringlichkeit, kurze Titel, Bewerbungs-Nachricht, Vorgangsnummern */

module.exports = function up({ db, getSetting, setSetting, randomPin, nextConcernNumber }) {
  // Einmalig: offene Akten mit „Eilig“/„Notfall“ bekommen die passende Start-Priorität (Hoch/Kritisch) –
  // nur wo noch „Normal“ steht und niemand die Priorität bisher von Hand geändert hat.
  if (!getSetting('migrated_priority_from_urgency')) {
    const n = db
      .prepare(
        `UPDATE cases SET priority = CASE urgency WHEN 'notfall' THEN 4 ELSE 3 END
         WHERE status != 'geschlossen' AND priority = 2 AND urgency IN ('eilig', 'notfall')
           AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.case_id = cases.id AND n.system = 1 AND n.body LIKE 'Priorität:%')`
      )
      .run().changes;
    setSetting('migrated_priority_from_urgency', new Date().toISOString());
    if (n) console.log(`Priorität aus der Dringlichkeit übernommen: ${n} Akte(n).`);
  }

  // Akten aus dem Website-Formular hießen „Strafrecht / Festnahme: <ganzer Text des Mandanten>“ – der Text steht im
  // Sachverhalt, der Titel wird kurz („Strafrecht / Festnahme – Name“). Einmalig; selbst vergebene Titel bleiben unberührt.
  if (!getSetting('migrated_short_titles')) {
    const { AREA_TITLES, intakeTitle } = require('../../domain/caseTitles');
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.area, COALESCE(NULLIF(c.client_name, ''), u.display_name, '') AS who
           FROM cases c LEFT JOIN users u ON u.id = c.client_id WHERE c.source = 'web'`
      )
      .all();
    const upd = db.prepare('UPDATE cases SET title = ? WHERE id = ?');
    let n = 0;
    for (const r of rows) {
      const prefix = `${AREA_TITLES[r.area] || ''}: `;
      if (r.who && AREA_TITLES[r.area] && r.title.startsWith(prefix)) {
        upd.run(intakeTitle(r.area, r.who), r.id);
        n++;
      }
    }
    setSetting('migrated_short_titles', new Date().toISOString());
    if (n) console.log(`Kurze Titel für Website-Anfragen: ${n} Akte(n).`);
  }

  // „Nachricht an den Bewerber“ (früher ein einzelnes Feld) wird zur ersten Nachricht im Bewerbungs-Chat.
  if (!getSetting('migrated_application_public_note')) {
    for (const a of db.prepare("SELECT id, public_note, updated_at FROM applications WHERE public_note != ''").all()) {
      db.prepare("INSERT INTO application_messages (application_id, from_board, author_name, body, created_at) VALUES (?, 1, 'Board of Partners', ?, ?)").run(a.id, a.public_note, a.updated_at);
    }
    db.prepare('UPDATE applications SET applicant_read_id = (SELECT COALESCE(MAX(m.id), 0) FROM application_messages m WHERE m.application_id = applications.id)').run();
    setSetting('migrated_application_public_note', new Date().toISOString());
  }

  // Ältere Anliegen (vor Einführung der Vorgangsnummer) nachträglich nummerieren.
  for (const row of db.prepare('SELECT id FROM concerns WHERE reference IS NULL ORDER BY id').all()) {
    db.prepare('UPDATE concerns SET reference = ?, access_pin = ? WHERE id = ?').run(nextConcernNumber(), randomPin(), row.id);
  }
};
