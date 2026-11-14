"use strict";
/*
 * Neues Standard-Design „Amtlich“ (weiß, Marineblau und Messing). Wer bisher das Standard-Design „Ruhig“ gespeichert
 * hatte, bekommt einmalig „Amtlich“; „Klassisch“ bleibt. Zurück geht es jederzeit unter Einstellungen → Konfiguration →
 * Stil & Saison → Design „Ruhig (bisher)“.
 */
module.exports = function up({ db }) {
  let row;
  try {
    row = db
      .prepare("SELECT published, draft FROM site_config WHERE key = 'style'")
      .get();
  } catch {
    return; // Tabelle gibt es in dieser Datenbank (noch) nicht
  }
  if (!row) return;
  const fix = (json) => {
    try {
      const v = JSON.parse(json);
      if (!v || (v.design && v.design !== "ruhig")) return json;
      v.design = "amtlich";
      return JSON.stringify(v);
    } catch {
      return json;
    }
  };
  db.prepare(
    "UPDATE site_config SET published = ?, draft = ? WHERE key = 'style'",
  ).run(
    row.published ? fix(row.published) : row.published,
    row.draft ? fix(row.draft) : row.draft,
  );
};
