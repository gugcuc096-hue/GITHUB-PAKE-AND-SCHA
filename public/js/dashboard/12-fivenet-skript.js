/*
 * Kanzlei-Dashboard – FiveNet-Verbindung im Profil: Skript bzw. Lesezeichen kopieren, wenn die Installation per Klick nicht
 * klappt (Tampermonkey fehlt oder Benutzerskripte sind im Browser nicht zugelassen). Die Anzeige steht in 07-team-einstellungen.js.
 * Wird nach den vorherigen Teilen geladen (Reihenfolge siehe dashboard.html bzw. 01-basis.js).
 */
'use strict';

/** In die Zwischenablage kopieren – mit Ausweichweg für Browser ohne Zugriff (z. B. ohne gesicherte Verbindung). */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

Object.assign(actions, {
  'fn-script-copy': async () => {
    try {
      const res = await fetch('/fivenet-import.user.js', { cache: 'no-store' });
      if (!res.ok) throw new Error('Skript nicht erreichbar');
      const ok = await copyToClipboard(await res.text());
      toast(ok ? 'Skript kopiert – in Tampermonkey als neues Skript einfügen und mit Strg+S speichern.' : 'Kopieren hat nicht geklappt – bitte „Skript installieren“ öffnen und den Text von Hand kopieren.', ok ? undefined : 'error');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  // Der Lesezeichen-Knopf ist zum Ziehen gedacht; ein Klick darauf läuft ins Leere
  'fn-bm-hint': () => toast('Diesen Knopf nicht anklicken, sondern in die Lesezeichenleiste ziehen.'),
  'fn-bm-copy': async () => {
    const url = st.fivenet && st.fivenet.bookmarklet;
    if (!url) return toast('Das Lesezeichen ist gerade nicht verfügbar.', 'error');
    const ok = await copyToClipboard(url);
    toast(ok ? 'Adresse kopiert – als Lesezeichen anlegen und die Adresse dort als URL einfügen.' : 'Kopieren hat nicht geklappt.', ok ? undefined : 'error');
  },
});
