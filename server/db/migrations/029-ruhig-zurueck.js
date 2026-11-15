'use strict';
/*
 * „Ruhig“ (Dunkelblau und Gold) ist wieder das Standard-Design. Migration 028 hatte gespeichertes „Ruhig“ auf „Amtlich“
 * (weiß) gestellt – das wird hier einmalig zurückgenommen. „Amtlich“ bleibt unter Einstellungen → Konfiguration →
 * Stil & Saison wählbar, „Klassisch“ bleibt unberührt.
 */
module.exports = function up({ db }) {
  let row;
  try {
    row = db.prepare("SELECT published, draft FROM site_config WHERE key = 'style'").get();
  } catch {
    return; // Tabelle gibt es in dieser Datenbank (noch) nicht
  }
  if (!row) return;
  const fix = (json) => {
    try {
      const v = JSON.parse(json);
      if (!v || v.design !== 'amtlich') return json;
      v.design = 'ruhig';
      return JSON.stringify(v);
    } catch {
      return json;
    }
  };
  db.prepare("UPDATE site_config SET published = ?, draft = ? WHERE key = 'style'").run(row.published ? fix(row.published) : row.published, row.draft ? fix(row.draft) : row.draft);
};
