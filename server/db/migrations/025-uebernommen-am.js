'use strict';
/*
 * Wann eine eingegangene Akte übernommen wurde („Federführend“) – daraus rechnet die Website die Reaktionszeit der
 * Kanzlei (GET /api/public/figures). Für vorhandene Akten aus dem Verlauf nachgetragen.
 * Dazu: „Ablauf eines Mandats“ steht auf der Startseite jetzt standardmäßig (als heller Abschnitt) – eine früher
 * gespeicherte Einstellung, die ihn ausblendet, wird einmalig zurückgenommen (lässt sich wieder ausblenden).
 */
module.exports = function up({ db, addColumn }) {
  addColumn('cases', 'claimed_at', 'TEXT');
  db.exec(
    `UPDATE cases SET claimed_at = (SELECT MIN(n.created_at) FROM notes n WHERE n.case_id = cases.id AND n.system = 1 AND n.body LIKE 'Federführend:%')
     WHERE claimed_at IS NULL AND lawyer_id IS NOT NULL`
  );
  let row;
  try {
    row = db.prepare("SELECT published, draft FROM site_config WHERE key = 'home'").get();
  } catch {
    return; // Tabelle gibt es in dieser Datenbank (noch) nicht
  }
  if (!row) return;
  const fix = (json) => {
    try {
      const v = JSON.parse(json);
      if (!v || !v.start || !Array.isArray(v.start.hidden) || !v.start.hidden.includes('ablauf')) return json;
      v.start.hidden = v.start.hidden.filter((id) => id !== 'ablauf');
      return JSON.stringify(v);
    } catch {
      return json;
    }
  };
  db.prepare("UPDATE site_config SET published = ?, draft = ? WHERE key = 'home'").run(row.published ? fix(row.published) : row.published, row.draft ? fix(row.draft) : row.draft);
};
