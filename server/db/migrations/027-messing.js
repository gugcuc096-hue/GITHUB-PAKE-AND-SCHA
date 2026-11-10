'use strict';
/*
 * Kanzleifarbe: Das bisherige Gelbgold (#d4af37) ist jetzt gedämpftes Messing (#c9a45c). Wer die Standardfarbe
 * gespeichert hatte (Vorlage „Klassisch Gold“), bekommt einmalig das neue Messing; eigene Farben bleiben unberührt.
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
      if (!v || String(v.accent || '').toLowerCase() !== '#d4af37') return json;
      v.accent = '#c9a45c';
      return JSON.stringify(v);
    } catch {
      return json;
    }
  };
  db.prepare("UPDATE site_config SET published = ?, draft = ? WHERE key = 'style'").run(row.published ? fix(row.published) : row.published, row.draft ? fix(row.draft) : row.draft);
};
