# Pake & Scha – Kanzlei-Website, Mandantenportal & Team-Dashboard

Premium-Webanwendung für die GTA-RP-Kanzlei **Pake & Scha Legal Consulting**: öffentliche Website, Mandantenportal und internes Kanzlei-Dashboard. Optimiert für Smartphone, Tablet und PC.

**Stack:** Node.js ≥ 22.13 · Express 4 · SQLite (eingebautes `node:sqlite`) · Session-Cookie (httpOnly) · bcrypt · zod · helmet · Tailwind (CDN)

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Website** | Login-/Dashboard-Button in Kopfzeile, Top-Leiste und Mobil-Menü · Team und Honorarordnung live aus der Datenbank · Mandat einreichen **ohne Konto** (liefert Aktenzeichen + Aktenpin) · Aktenstatus-Abfrage · Tarifrechner übergibt die Auswahl ans Mandatsformular |
| **Akten (Case Files)** | Aktenzeichen, Mandant (mit oder ohne Website-Konto), Gegenpartei, Gerichtsaktenzeichen, Status *Offen / In Bearbeitung / Geschlossen*, Verfahrensstand, öffentlicher Statushinweis, interne und öffentliche Notizen, automatischer Verlauf |
| **Kalender & Fristen** | Gerichtstermine, Fristen, Mandantengespräche, interne Termine · Monatsansicht · Live-Countdown · Terminanfragen von Mandanten bestätigen · Discord-Erinnerung 24 h vor Frist/Gerichtstermin |
| **Kanzlei-Post** | Posteingang/Gesendet, Antworten, Aktenbezug, „wichtig“-Markierung, Rundschreiben ans ganze Team, Ungelesen-Zähler |
| **Pinnwand** | Team-Notizen mit Farben, Anheften (erscheint in der Übersicht) |
| **Rechnungen & Honorare** | Generator: Leistungen aus der Honorarordnung **einfach anhaken** (mehrere auf einmal, Menge je Leistung, Suche) – sie stehen sofort als Positionen in der Rechnung; dazu freie Positionen, Rabatt/Zuschlag, Rechnung **oder** Honorarvereinbarung, Druck-/PDF-Ansicht, Status offen/bezahlt/storniert |
| **Team-Verwaltung** (Admin) | Mitglieder hinzufügen, umbenennen, Rang/Beschreibung ändern, sortieren, ausblenden, löschen – sofort live auf der Website · optional mit Login-Konto (Einmal-Passwort) |
| **Benutzer** (Admin) | Rollen, Ränge, Sperren, Löschen, **Passwort-Reset per Klick** |
| **Login-E-Mail @pake-scha.ls** | Alle Konten enden auf **@pake-scha.ls** – bei Registrierung, „Konto anlegen“, Team-Konto und Einstellung wird nur der Teil vor dem @ gewählt (Vorschlag aus dem Namen) · bestehende Konten wurden automatisch umgestellt (`john@mail.ls` → `john@pake-scha.ls`, bei Doppelungen `john2@…`), **Passwort unverändert** · Login mit neuer Adresse, nur dem Teil vor dem @ (`john`) **oder der alten Adresse** · einmaliger Hinweis im Dashboard mit der neuen Adresse · unter *Benutzer* steht „vorher: …“ (siehe [Login-E-Mail](#login-e-mail-pake-schals)) |
| **Kooperationen** (Board of Partners) | Kooperationspartner anlegen (z. B. „Burgershot“) mit **Rabatt in %**, optional „gültig bis“, aktiv/inaktiv und interner Notiz · **Discord-Rolle(n) der Mitglieder** direkt aus der Rollenliste des Servers anhaken · beim Erstellen einer Rechnung mit Aktenbezug liest der Bot die Discord-Rollen des Mandanten und **setzt den Kooperationsrabatt automatisch** (bei mehreren der höchste; änderbar) · ohne Discord: Mandantenkonten von Hand zuordnen oder die Kooperation in der Rechnung auswählen · „Mandant prüfen“ zeigt, welche Kooperation gilt · Rechnung zeigt „Kooperationsrabatt Burgershot (15 %)“, Verlauf/Protokoll vermerken, ob per Discord-Rolle erkannt oder von Hand gewählt · Mandanten sehen ihre Vorteile unter *Mein Profil* (siehe [Kooperationen](#kooperationen)) |
| **Honorarordnung** (Admin) | Preise/Leistungen pflegen → Website, Tarifrechner und Rechnungs-Generator |
| **Discord** | Webhook für Kanzlei-Updates (mit Erwähnung verknüpfter Anwälte) · Konto verknüpfen · „Mit Discord anmelden“ |
| **Profilbilder** | Jedes Konto kann ein Profilbild hochladen (im Browser zugeschnitten und verkleinert). Team-Profile können zusätzlich ein eigenes Foto für die Website bekommen. |
| **Bewerbungssystem** | Karriereseite `/karriere.html` mit Stellen, Online-Bewerbung und Statusabfrage (Bewerbungsnummer + Zugangscode) · im Dashboard: Bewertung, interne Notizen, Nachricht an Bewerber, Gesprächstermin (landet im Kalender), **Einstellen per Klick** (Login-Konto + Team-Profil) · Stellenausschreibungen verwalten |
| **Stempeluhr** | Dienststatus *Im Dienst / Im Gericht / Pause / Außer Dienst* in der Kopfzeile · Website zeigt live „Eilnotdienst: 2 Anwälte im Dienst“ und grüne Punkte bei den Teamkarten (abschaltbar) · Wochenstunden pro Teammitglied · Korrekturen durch die Leitung · automatisches Ausstempeln nach 12 h |
| **Beweismittel** | Bilder/Screenshots an Akten hängen, auf Wunsch nur intern · Vorschau, Download, Löschen · nur mit Berechtigung abrufbar |
| **FiveNet-Dokumente** | In der Akte „FiveNet-Dokument hinzufügen“ → Link einfügen → Dokument-ID wird live erkannt · Warnung bei Dubletten, Querverweis „auch verknüpft mit PS-…“ · Titel, Dokumentart (u. a. „Strafakte (LSPD)“), Erstellungsdatum, Verfasser, Kurzinhalt · **Text & Bilder übernehmen:** Inhalt in FiveNet kopieren und einfügen → Abschrift in der Akte (auch als Textdatei), Bilder automatisch als Anhang · intern oder für den Mandanten sichtbar · „In FiveNet öffnen“ und „Zitat kopieren“ · Aktensuche per FiveNet-Link oder Dokument-ID (siehe [FiveNet-Integration](#fivenet-integration)) |
| **Google-Docs-Dokumente** | In der Akte „Google-Docs-Dokument“ → Link einfügen → bei Freigabe „Jeder, der über den Link verfügt“ (oder „Im Web veröffentlicht“) lädt die Kanzlei **Text und Bilder automatisch** · „Aktualisieren“ holt den neuesten Stand ohne doppelte Bilder · nicht freigegebene Dokumente: klare Anleitung oder Inhalt kopieren/einfügen · gleiche Funktionen wie bei FiveNet (Abschrift, Textdatei, Zitat, Sichtbarkeit, Querverweise, Aktensuche per Link) (siehe [Google-Docs-Integration](#google-docs-integration)) |
| **Google-Sheets-Tabellen** | In der Akte „Google-Sheets-Tabelle“ → Link einfügen → freigegebene Tabellen werden **automatisch als Tabelle übernommen** (das Tabellenblatt aus dem Link, sonst das erste) · Anzeige als Tabelle in der Akte, „Tabelle kopieren“ fügt sich direkt in Excel/Sheets ein, Textdatei mit ausgerichteten Spalten · nicht freigegebene Tabellen: Zellen kopieren und einfügen (siehe [Google-Sheets-Integration](#google-sheets-integration)) |
| **Reihenfolge der Dokumente** | Externe Dokumente einer Akte lassen sich ordnen: Dokument **gedrückt halten und nach oben oder unten ziehen** (Maus und Touch; am Rand scrollt die Akte mit), über den Griff ⠿ mit der Maus sofort, per Tastatur mit Griff + ↑/↓ · Menü „Sortieren“: nach Datum (älteste/neueste zuerst), Titel oder Quelle · die Reihenfolge wird gespeichert und gilt für alle, auch für den Mandanten |
| **Aufgaben & Wiedervorlagen** | Aufgaben mit Fälligkeitsdatum, Zuständigkeit und Notiz – mit oder ohne Aktenbezug · Checklisten je Rechtsgebiet per Klick in die Akte übernehmen · Erledigt-Vermerk im Aktenverlauf · Zähler fälliger Aufgaben in der Navigation · Discord-Erwähnung bei Zuweisung |
| **Mehrere Anwälte pro Akte** | Ein federführender Anwalt plus beliebig viele weitere Anwälte (bis zu 10) · alle zuständigen Anwälte dürfen die Akte bearbeiten und sehen sie unter „Meine Akten“ · das Team stellen der federführende Anwalt und das Board of Partners zusammen, weitere Anwälte können ihre Mitarbeit selbst beenden · gibt der federführende Anwalt ab, übernimmt der nächste · Discord-Ereignis „Anwalt einer Akte zugewiesen“ pingt die neu zugewiesenen Anwälte · Mandant und öffentliche Statusabfrage zeigen alle zuständigen Anwälte |
| **Mandanten-Konto nachträglich verknüpfen** | Akte für einen Mandanten ohne Website-Konto (nur Name) angelegt und der Mandant registriert sich später? In der Akte **„Mandanten-Konto verknüpfen“** → Konto per Name oder E-Mail suchen → „Verknüpfen“ · passende Konten (gleicher Name wie in der Akte) werden automatisch als Vorschlag oben in der Akte angezeigt · danach sieht der Mandant die Akte unter „Meine Akten“ – mit Terminen, Verträgen, Rechnungen, Nachrichten und dem Discord-Ticket (verknüpftes Discord wird automatisch hinzugefügt) · unter „Akte bearbeiten“ ein anderes Konto wählen oder die Verknüpfung lösen (der Name bleibt in der Akte) · nur zuständige Anwälte und das Board of Partners · interner Vermerk im Aktenverlauf |
| **Mandatsverträge** | In der Akte „Mandatsvertrag erstellen“ → Vorlage der Kanzlei wird mit Anwalt (Name, Rang), Mandant, Honorar, Datum und Ort gefüllt (Vorbelegung aus Akte und früheren Verträgen, Honorar-Vorschläge aus der Honorarordnung) · Druckansicht im Layout der Kanzleivorlage (Kopfzeile auf jeder Seite, PDF über den Druckdialog) · **Unterschriften:** der genannte Anwalt unterschreibt digital, der Mandant im Portal (Name eintippen) – oder die Kanzlei erfasst die Unterschrift im Spiel · nach der ersten Unterschrift gesperrt · Verlauf und Discord-Ereignis „Mandatsvertrag unterschrieben“ · **mehrere Leistungen aus der Honorarordnung** (mit Menge) wählbar – die Summe wird automatisch zur Grundgebühr, die Leistungen stehen einzeln im Vertrag · Vorlagen unter Einstellungen → Vertragsvorlagen bearbeiten (siehe [Mandatsverträge](#mandatsverträge)) |
| **Abmeldungen** | Unter „Dienstzeiten“ (oder im Dienst-Menü oben) „Abmelden“: Zeitraum, Grund (Urlaub, Krankheit, Privat, OOC, Sonstiges), Notiz · das Team sieht aktuelle und geplante Abmeldungen, die Übersicht zeigt „Heute abgemeldet“ · „Zurückmelden“ beendet eine Abmeldung vorzeitig, „Zurückziehen“ entfernt sie · Board of Partners kann andere abmelden · Discord-Ereignis „Abmeldung / Rückmeldung“ (eigener Kanal und Rollen-Ping einstellbar) |
| **Aktenbearbeitung** (nur Board of Partners) | Automatische Erfassung, wer welche Akte bearbeitet (federführend oder weiterer Anwalt) und wie lange – bei Zuweisung, Abgabe, Mitarbeit beenden, Schließen und Wiedereröffnen · Ansicht „Aktenbearbeitung“: laufende und abgeschlossene Bearbeitungen je Mitarbeiter, Ø Dauer, Akten nach Bearbeitungsdauer, Zeitraum 7 Tage bis alles · in jeder Akte „Bearbeitungszeiten“ · ältere Akten werden aus dem Aktenverlauf geschätzt (≈) |
| **Discord-Tickets** | Je Akte ein privater Discord-Kanal (Kategorie z. B. „Mandatsanfragen“), je Bewerbung und Anliegen ein Board-Kanal (Kategorie „Board of Partners“, nur Board): Status, Zuständigkeit, Nachrichten, Termine, Verträge und Rechnungen erscheinen automatisch; Mandanten werden automatisch hinzugefügt (verknüpftes Discord oder „Discord-Ticket beitreten“ auf der Website); geschlossene Akten wandern ins Archiv – siehe *Discord einrichten* |
| **Anliegen ans Board** | **Jeder** kann ein Anliegen an das Board of Partners stellen: auf der **Startseite der Website** („Anliegen an das Board of Partners“ unter den Hero-Buttons und im Kontaktbereich, auch **ohne Konto**) sowie im Dashboard über „Anliegen ans Board“ im Menü oder den Button in der Übersicht · Kategorie (Mitarbeiter: Personal & Beförderung, Beschwerde, Vorschlag, Organisation, Gehalt · Mandanten/Besucher: Betreuung des Mandats, Beschwerde, Rechnung & Honorar, Anfrage/Zusammenarbeit, Vorschlag/Lob), Dringlichkeit, auf Wunsch **anonym** (das Board sieht dann nur „Anonym (Mitarbeiter / Mandant / über die Website)“, keinen Namen und keinen Kontakt) · jedes Anliegen erhält **Vorgangsnummer + Pin** (AN-JJJJ-NNNN) – damit lesen Einreichende die Antworten auf der Startseite („Status abfragen“) und können antworten; angemeldete sehen ihre Anliegen zusätzlich im Dashboard · **einsehen kann die Anliegen nur das Board of Partners**: Menübereich „Board of Partners“ → „Eingegangene Anliegen“ (Filter nach Status und Absender) – antworten, interne Notizen (für Einreichende unsichtbar), Status (Offen, In Bearbeitung, Erledigt, Abgelehnt) und Zuständigkeit · Zähler im Menü: Board = offene Anliegen, alle = neue Antworten · Zurückziehen, solange das Board noch nicht reagiert hat · Discord-Ereignisse „Neues Anliegen an das Board of Partners“ und „Rückmeldung / Statusänderung“ (eigener Kanal und Rollen-Ping einstellbar; bei anonymen Anliegen ohne Namen) |
| **Beförderungen & Einstellungen** | Personalprotokoll für **alle Mitarbeiter** sichtbar: wer neu im Team ist und wer befördert wurde (vorher → nachher, von wem, Begründung) · **Befördern nur durch das Board of Partners** („Befördern“ in dieser Ansicht; niemand ändert seinen eigenen Rang; Partner ohne Admin-Rolle befördern höchstens bis zum eigenen Rang und nur Kollegen unterhalb ihres Rangs) · Einstellungen werden automatisch eingetragen (Bewerber eingestellt, Mitarbeiterkonto angelegt, Team-Profil mit Konto, Mandantenkonto zum Mitarbeiter gemacht), ebenso Rangänderungen unter „Benutzer“ und „Team“ · Team-Profil der Website zieht mit · Zähler im Menü für neue Einträge · Discord-Ereignis „Beförderung / Einstellung“ – z. B. eigener Kanal *#beförderungen*; verknüpfte Discord-Konten werden erwähnt |
| **Aktenübersicht & Handlungsbedarf** | Kennzahlen im Aktenkopf (nächste Frist, offene/überfällige Aufgaben, FiveNet-Dokumente, Beweismittel, letzte Aktivität) · Übersicht zeigt überfällige und heute fällige Aufgaben sowie eigene Akten ohne Bewegung seit 7 Tagen |
| **Protokoll** (Admin) | Wer hat wann was geändert: Akten, Rechnungen, Konten, Team, Bewerbungen, Einstellungen, Anmeldungen des Teams |

## Feste Team-Besetzung

Beim ersten Start legt der Server automatisch an (Login-Konto + Profil auf der Website):

| Name | Rang | Rolle | Login |
|---|---|---|---|
| Dr. Alois Pake | Managing Partner / Kanzleileitung | Admin | `alois.pake@pake-scha.ls` |
| Michael Scha | Managing Partner | Admin | `michael.scha@pake-scha.ls` |
| Dr. jur. Damat Lex | Senior Associate | Anwalt | `damat.lex@pake-scha.ls` |

Die Passwörter kommen aus `ADMIN_PASSWORD`, `SEED_SCHA_PASSWORD` und `SEED_LEX_PASSWORD`. Sind sie leer, erzeugt der Server sichere Zufallspasswörter und schreibt sie **einmalig in die Render-Logs**. Ein festes Passwort steht bewusst nicht im Code, weil das Repository öffentlich sein könnte.

## Einrichtung auf Render

1. **Persistent Disk anlegen (wichtig!)**: Service → *Disks* → Mount Path `/var/data`, 1 GB.
   Ohne Disk ist das Dateisystem flüchtig: Nach jedem Deploy oder Neustart sind alle Akten, Konten und Nachrichten weg. Disks gibt es erst ab dem Starter-Plan, der Free-Plan hat keine.
2. **Environment** setzen (siehe `.env.example`):
   - `NODE_ENV=production`
   - `DB_PATH=/var/data/pake-scha.db`
   - `ADMIN_PASSWORD=…` (mind. 10 Zeichen, empfohlen)
   - optional `SEED_SCHA_PASSWORD`, `SEED_LEX_PASSWORD`, `PUBLIC_URL`
3. Build Command `npm install`, Start Command `npm start`, Health Check Path `/api/health`.
4. Nach dem Deploy mit `alois.pake@pake-scha.ls` anmelden. Wurde das Passwort erzeugt, steht es im Log unter „Erststart: Team-Konten wurden angelegt“.

### Notfall-Zugang ohne Shell

| Problem | Lösung |
|---|---|
| Ein Teammitglied hat sein Passwort vergessen | Dashboard → *Benutzer* → „Passwort“ → Einmal-Passwort weitergeben |
| Admin-Passwort vergessen | In Render `ADMIN_RESET_PASSWORD=NeuesPasswort123` setzen → deployen → einloggen → Variable **wieder löschen** |
| Alle Admins gesperrt/gelöscht | Passiert automatisch: Beim Start stellt der Server das Konto von Dr. Alois Pake wieder her (Passwort aus `ADMIN_PASSWORD` oder im Log) |

## Discord einrichten (optional)

**Webhook (Kanzlei-Updates):** Discord-Kanal → Einstellungen → Integrationen → Webhooks → URL kopieren → Dashboard → *Einstellungen* → einfügen → „Testnachricht“. Dort lässt sich auch wählen, welche Ereignisse gemeldet werden – und je Ereignis ein eigener Kanal (eigener Webhook) und eine Rolle zum Pingen. Neu hinzugekommene Ereignisse (z. B. „Neues Anliegen an das Board of Partners“ oder „Beförderung / Einstellung“) sind bei bestehender Auswahl zunächst aus und müssen dort einmal angehakt werden.

**Discord-Login / Konto verknüpfen:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application*
2. *OAuth2* → Redirect `https://<ihre-domain>/api/discord/callback` hinzufügen
3. In Render `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` und `PUBLIC_URL` setzen → deployen
4. Jeder Nutzer verknüpft sein Konto unter *Mein Profil* und kann sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Zuweisungen und Fristen im Kanal erwähnt.

**Discord-Tickets – zwei Kategorien:** Mandats-Tickets (je Akte, mit Mandant) landen in der Kategorie für Mandate (z. B. „Mandatsanfragen“); **Board-Tickets** (je Bewerbung und je Anliegen ans Board) in einer eigenen Kategorie (z. B. „Board of Partners“), sichtbar nur für die Board-Rolle(n) und die Board-Mitglieder (Rolle „Board of Partners“ oder Partner-Rang) mit verknüpftem Discord – normale Anwälte sehen sie nicht. Beide Arten haben ein eigenes (optionales) Archiv und lassen sich einzeln ein- und ausschalten (Einstellungen → Discord-Tickets).

**Board-Tickets:** Bewerbung eingegangen (Stelle, Alter, Discord, Telefon, Motivation, Erfahrung, Verfügbarkeit) · Status und Bewertung · Nachricht an den Bewerber · interne Notizen · Bewerbungsgespräch geplant · eingestellt (→ Archiv) · abgesagt (→ Archiv) · gelöscht. Anliegen eingegangen (Kategorie, Dringlichkeit, Absender – bei anonymen Anliegen nur „Anonym (Gruppe)“) · Rückmeldungen der einreichenden Person · Antworten des Boards · interne Notizen · Status/Zuständigkeit · erledigt/abgelehnt (→ Archiv). Bewerber und Einreichende sind nicht im Kanal. Wer befördert, zurückgestuft oder Admin wird bzw. sein Discord verknüpft, wird automatisch in die offenen Board-Tickets aufgenommen bzw. entfernt.

**Discord-Tickets (je Akte ein privater Kanal):** Für jede Akte legt ein Bot automatisch einen eigenen, privaten Kanal an (z. B. `#ps-2026-0012-max-mustermann`). Alles, was der Mandant auch im Portal sieht, erscheint dort automatisch:

| Ereignis | Im Ticket |
|---|---|
| Neue Akte (Website-Formular oder Dashboard) | Kanal wird angelegt, angeheftete Übersicht (Aktenzeichen, Titel, Sachverhalt, Rechtsgebiet, Dringlichkeit, Status, Zuständige), Team-Rolle und Anwälte werden erwähnt |
| Status, Verfahrensstand, Hinweis an den Mandanten, geänderte Angaben | „Stand der Akte aktualisiert“ (Mandant wird erwähnt) |
| Anwalt zugewiesen / weitere Anwälte / Abgabe | „Zuständigkeit geändert“ – neue Anwälte kommen in den Kanal, ausgetragene verlieren den Zugriff |
| Nachricht (nicht intern) in der Akte | Nachricht von Anwalt bzw. Mandant – die Gegenseite wird erwähnt |
| Anhang (nicht intern) | Hinweis auf den neuen Anhang |
| Termine/Fristen der Akte, die der Mandant sieht | Neu, Terminanfrage, bestätigt, abgesagt, verlegt, erledigt, Erinnerung 24 h vorher |
| Mandatsvertrag | erstellt, vom Anwalt / Mandanten / vollständig unterschrieben |
| Rechnung / Honorarvereinbarung zur Akte | Nummer, Betrag, Fälligkeit |
| Akte geschlossen / wieder geöffnet | Hinweis, Kanal wandert ins Archiv (Mandant nur noch lesend) bzw. zurück |
| Akte gelöscht | Hinweis, Kanal ins Archiv (Verlauf bleibt) |

**Buttons im Ticket (Panel):** Die angeheftete Begrüßung jedes Tickets enthält Buttons – Akten: „Akte übernehmen“ (solange unbesetzt), „Akte schließen“ (mit Rückfrage) bzw. „Wieder öffnen“, „Im Dashboard öffnen“; Anliegen: „Als erledigt markieren“ / „Wieder öffnen“; Bewerbungen: „Im Dashboard öffnen“. Ein Klick wirkt genau wie im Dashboard (Verlauf „über Discord“, Meldungen, Archiv) und die Buttons passen sich an. Klicken darf nur, wer sein Discord mit einem Website-Konto verknüpft hat und dieselben Rechte wie im Dashboard besitzt (Akte: zuständige Anwälte / Board of Partners, Übernehmen: jedes Teammitglied; Anliegen: Board of Partners) – Mandanten und Fremde bekommen nur einen Hinweis, den nur sie sehen. Einrichtung: Developer Portal → *General Information* → „Public Key“ in Render als `DISCORD_PUBLIC_KEY` → deployen → **danach** im Developer Portal „Interactions Endpoint URL“ = `https://<ihre-domain>/api/discord/interactions` → speichern (Discord prüft die Adresse dabei). Bestehende Tickets bekommen die Buttons über „Offene nachholen“. Ohne Public Key gibt es nur den Button „Im Dashboard öffnen“.

**Befehle des Kanzlei-Bots (Slash-Commands):** Alle Antworten und Nachrichten des Bots sind Embeds; Erwähnungen stehen nur dann zusätzlich im Text, wenn jemand wirklich gepingt werden soll (z. B. die per `/add` hinzugefügte Person).

| Befehl | Wo | Wer | Was passiert |
|---|---|---|---|
| `/add @Person` · `/remove @Person` | Ticket-Kanal | zuständige Anwälte, Board (Board-Tickets: nur Board) | holt jemanden ins Ticket (Zeuge, Gutachter, Kollege) bzw. nimmt ihn wieder heraus; bleibt beim Abgleichen erhalten; fest zugehörige Personen (Anwälte, Mandant, Board) nur über die Website |
| `/delete [grund]` | Ticket-Kanal | wie `/add` | Rückfrage „Ja, Ticket löschen“ → Hinweis im Kanal, nach 5 Sekunden wird der **Kanal gelöscht**. Akte/Bewerbung/Anliegen bleiben erhalten; das Ticket wird **nicht automatisch neu angelegt** – im Dashboard steht „per /delete gelöscht“ mit „Neu anlegen“. Vermerk im Aktenverlauf (intern) und im Protokoll |
| `/passwort` | überall auf dem Server | jeder mit verknüpftem Discord | neues Einmal-Passwort per **Direktnachricht** (Embed mit E-Mail, Passwort als Spoiler, Login-Link); die E-Mail bleibt gleich, beim Login wird ein eigenes Passwort festgelegt, alle alten Anmeldungen enden. Kann der Bot keine DM schicken (DMs gesperrt), bleibt das alte Passwort gültig. Höchstens alle 10 Minuten; steht im Protokoll |
| `/akte [aktenzeichen]` | überall (im Ticket ohne Angabe) | wer die Akte auch im Dashboard sieht | Status, Verfahrensstand, Zuständige, nächster Termin, offene Aufgaben (Kanzlei), Hinweis der Kanzlei, Link ins Dashboard – nur für die Person sichtbar. Aktenzeichen auch kurz („12“) |
| `/notiz text [aktenzeichen]` | überall (im Ticket ohne Angabe) | Kanzlei | interne Notiz zur Akte – für den Mandanten unsichtbar, erscheint nie im Ticket |
| `/dienst status [notiz]` | überall | Kanzlei | Stempeluhr: Im Dienst, Im Gericht, Pause, Außer Dienst – wie im Dashboard (inkl. Discord-Meldung Dienstbeginn/-ende) |
| `/imdienst` | überall | alle | wer von der Kanzlei gerade im Dienst ist |
| `/termine` | überall | alle mit verknüpftem Discord | die nächsten 10 Termine/Fristen (Kanzlei: eigene und die der eigenen Akten; Mandanten: für sie sichtbare) |
| `/hilfe` | überall | alle | Übersicht der Befehle (Kanzlei sieht zusätzlich ihre Befehle) |

Antworten auf Befehle sind nur für die ausführende Person sichtbar – außer `/add` und `/remove`, die im Ticket für alle erscheinen. Die Befehle meldet die Website selbst an (beim Start, beim Speichern der Ticket-Einstellungen und bei „Verbindung testen“), sobald Bot-Token, Server-ID und `DISCORD_PUBLIC_KEY` gesetzt sind. Wer klickt oder einen Befehl nutzt, wird über sein verknüpftes Discord dem Website-Konto zugeordnet; es gelten dieselben Rechte wie im Dashboard.

**Wer wird wann erwähnt (gepingt)?** Beim neuen Ticket: Team- bzw. Board-Rolle (abschaltbar) und die zuständigen Anwälte. Danach nie mehr die ganze Rolle – nur gezielt: der Mandant bei Status, Verfahrensstand, Hinweisen, Nachrichten/Anhängen der Kanzlei, Terminen, Verträgen und Rechnungen; die zuständigen Anwälte bei Nachrichten/Anhängen/Terminanfragen des Mandanten und seiner Vertragsunterschrift; neu zugewiesene Anwälte bei ihrer Zuweisung. Wer eine Änderung selbst vornimmt, wird nie erwähnt. Board-Tickets erwähnen nach der Eröffnung niemanden mehr.

**Nie im Ticket:** interne Notizen, interne Anhänge, Aufgaben, interne Termine, Telefonnummern – der Mandant liest mit. Nachrichten, die im Discord-Kanal geschrieben werden, landen nicht in der Akte (Einbahnstraße Website → Discord).

**Wer ist im Ticket?** Die eingestellten Team-Rollen (z. B. „Anwälte“), zusätzlich die zuständigen Anwälte mit verknüpftem Discord und der **Mandant – automatisch**, sobald
- sein Portal-Konto mit Discord verknüpft ist (*Mein Profil → Discord verbinden*; alle seine Akten), oder
- er auf der Website unter *Aktenstatus* bzw. direkt nach dem Einreichen eines Mandats mit Aktenzeichen + Aktenpin „**Discord-Ticket beitreten**“ klickt (ohne Konto, Discord-Anmeldung mit Bestätigung).

Ist er noch nicht auf dem Discord-Server, fügt der Bot ihn beim Verknüpfen automatisch hinzu (Discord fragt dafür einmal um Erlaubnis, „guilds.join“). In der Akte zeigt das Dashboard den Ticket-Status („Mandant im Ticket“, „In Discord öffnen“, „Abgleichen“).

**Einrichtung:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **dieselbe App wie beim Discord-Login** → *Bot* → „Reset Token“ → Token kopieren. (Nur mit derselben App kann der Bot Mandanten dem Server hinzufügen.)
2. In Render unter *Environment* `DISCORD_BOT_TOKEN` setzen → deployen. Der Token steht nur dort – nie in der Datenbank, im Code oder im Browser.
3. Dashboard → *Einstellungen* → *Discord-Tickets (Bot)* → „Einladungslink“ öffnen und den Bot auf den Server einladen (enthält die nötigen Rechte: Kanäle verwalten, Berechtigungen verwalten, Nachrichten senden/verwalten, Links einbetten, Dateien anhängen, Verlauf lesen, Rollen erwähnen, Einladung erstellen).
4. In Discord eine Kategorie für Tickets anlegen (z. B. „Mandate“), optional eine fürs Archiv. IDs kopieren (Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick → „ID kopieren“).
5. Server-ID, Kategorie(n) und Team-Rolle(n) eintragen, „Discord-Tickets einschalten“, speichern, **„Verbindung testen“** (prüft Token, Server, Rechte des Bots, Rollen und Kategorien).
6. Für Board-Tickets zusätzlich die Kategorie „Board of Partners“ (optional ein Board-Archiv) und die Board-Rolle eintragen.
7. „Offene nachholen“ legt Tickets für alle bestehenden offenen Akten, Bewerbungen und Anliegen an.

Wird ein Ticket-Kanal von Hand in Discord gelöscht, legt der Bot beim nächsten Ereignis automatisch einen neuen an (mit `/delete` gelöschte Tickets dagegen nicht). Fehler (z. B. fehlende Rechte) stehen in der Akte beim Ticket.

## Kooperationen

Unter **Board of Partners → Kooperationen** legt das Board Kooperationspartner an – z. B. „Burgershot“ mit 15 % Rabatt.

1. **Neue Kooperation** → Name, Rabatt in %, optional „gültig bis“ und eine interne Notiz.
2. **Discord-Rollen:** Die Rollen des Kanzlei-Servers (Server-ID aus *Einstellungen → Discord-Tickets*) werden als Liste geladen – die Rolle der Mitglieder anhaken (z. B. `@Burgershot`). Mehrere Rollen sind möglich. Liegt die Rolle auf einem **anderen Server** (z. B. dem Discord des Partners), dessen Server-ID eintragen – der Bot muss dort eingeladen sein.
3. **Rechnung erstellen:** Mit Aktenbezug prüft die Website im Hintergrund die Discord-Rollen des Mandanten (sein verknüpftes Discord bzw. das Discord aus „Discord-Ticket beitreten“). Passt eine Rolle, steht die Kooperation im Formular („🤝 Erkannt: Burgershot · 15 %“) und der Rabatt ist eingerechnet – bei mehreren Kooperationen die mit dem höchsten Rabatt. Die Auswahl lässt sich ändern oder auf „Keine Kooperation“ stellen; ohne Aktenbezug wird die Kooperation von Hand gewählt.
4. **Ohne Discord:** Mandantenkonten unter „+ Konto zuordnen“ fest einer Kooperation zuordnen.

Berechnung: Kooperationsrabatt und sonstiger Rabatt beziehen sich auf die Zwischensumme, danach kommt ein eventueller Zuschlag. Der Satz kommt immer aus der Kooperation (nicht aus dem Browser); Name und Satz werden in der Rechnung festgehalten – spätere Änderungen oder das Löschen der Kooperation ändern bestehende Rechnungen nicht. Inaktive oder abgelaufene Kooperationen gelten nicht mehr.

Voraussetzung für die Rollen-Erkennung ist nur der Bot der Discord-Tickets (`DISCORD_BOT_TOKEN`, Bot auf dem Server). Er liest ausschließlich die Rollen einzelner Mitglieder und die Rollenliste des Servers – dafür sind keine zusätzlichen Rechte oder „Privileged Intents“ nötig. Der Token bleibt auf dem Server.

## Lokal starten

```bash
npm install
cp .env.example .env    # Werte nach Bedarf ausfüllen
npm run dev             # http://localhost:3000
```

## Login-E-Mail @pake-scha.ls

Alle Konten haben eine Adresse mit der Endung **@pake-scha.ls**. Frei wählbar ist nur der Teil davor (Buchstaben a–z, Zahlen, Punkt, Bindestrich, Unterstrich) – bei der Registrierung, unter *Benutzer → Konto anlegen*, beim Team-Konto und beim Einstellen aus einer Bewerbung (dort mit Vorschlag aus dem Namen, z. B. `lisa.mueller`). Andere Endungen werden abgelehnt.

**Bestehende Konten** werden beim Start automatisch umgestellt: Der Teil vor dem @ bleibt (Umlaute werden umgeschrieben, `+…` fällt weg), z. B. `john.doe@mail.ls` → `john.doe@pake-scha.ls`; ist die Adresse schon vergeben, kommt eine Zahl dazu (`john.doe2@…`). Das **Passwort bleibt gleich**. Einloggen geht danach mit
- der neuen Adresse (`john.doe@pake-scha.ls`),
- nur dem Teil vor dem @ (`john.doe`) oder
- **der alten Adresse** (`john.doe@mail.ls`) – sie bleibt als Login-Alias gültig.

Nach dem ersten Login zeigt die Übersicht einmal „Ihre Login-E-Mail lautet jetzt …“. Unter *Benutzer* steht bei umgestellten Konten „vorher: …“; das Board kann die Adresse dort (Teil vor dem @) jederzeit ändern. Jede Umstellung steht im Protokoll. Die Kontakt-E-Mail in Bewerbungen und Anliegen ist davon nicht betroffen.

## Update einer bestehenden Installation

Beim ersten Start der neuen Version passiert automatisch:
- **Sicherungskopie** der Datenbank (`pake-scha.db.backup-<Datum>`) vor jedem Tabellen-Umbau
- Umbau der Tabellen `cases`, `appointments` und `notes` ohne Datenverlust (Akten, Notizen, Termine, Nachrichten bleiben erhalten)
- Einmalige Korrektur „Dr. Alois Parker“ → „Dr. Alois Pake“: Die Login-E-Mail wird zu `alois.pake@pake-scha.ls`, das Passwort bleibt gleich
- Alle Login-E-Mails werden auf `@pake-scha.ls` umgestellt (Passwort bleibt, alte Adresse funktioniert weiter – siehe *Login-E-Mail*)
- Der frühere Platzhalter „Martinez“ verschwindet von der Website. Sein Login-Konto bleibt bestehen und kann unter *Benutzer* gesperrt oder gelöscht werden.

## Hochgeladene Dateien

Profilbilder, Team-Fotos und Beweismittel liegen im Ordner `uploads/` **neben der Datenbank**, auf Render also automatisch auf der Disk (`/var/data/uploads`). Bilder werden vor dem Upload im Browser verkleinert und sind meist nur 50–300 KB groß, 1 GB Disk reicht damit für viele tausend Bilder. Beweismittel sind nie öffentlich, sondern nur über das Dashboard mit Berechtigungsprüfung abrufbar.

## FiveNet-Integration

Die Kanzlei nutzt FiveNet unter `https://fivenet.modernv.net`. Ein einzelnes Dokument hat die Adresse `https://fivenet.modernv.net/documents/<ID>`, wobei `<ID>` eine Zahl ist (FiveNet prüft das selbst; `…/documents/x` ist deshalb keine gültige Dokument-Adresse).

### Ergebnis der Schnittstellenprüfung

Geprüft wurde der offizielle Quellcode von FiveNet ([github.com/fivenet-app/fivenet](https://github.com/fivenet-app/fivenet), Version v2026.9.3). Die Instanz selbst war für die Prüfung nicht erreichbar; das Ergebnis gilt, solange modernV keine eigene Schnittstelle ergänzt hat.

| Schnittstelle | Befund | Nutzbar für die Kanzlei? |
|---|---|---|
| OAuth2 / SSO | FiveNet ist nur OAuth2-**Client** (Anmeldung bei FiveNet über Discord oder einen generischen Anbieter). Es gibt keinen OAuth2-/OIDC-Anbieter, bei dem sich eine fremde Anwendung registrieren kann. | Nein |
| API-Authentifizierung | gRPC-Web unter `/api/grpc`. Nötig sind zwei JWTs: Konto-Cookie `fivenet_acc` und Charakter-Token. Beide gibt es nur über `AuthService.Login` mit **Benutzername und Passwort**; sie gelten 4 Tage und haben keine eingeschränkten Rechte (Scopes). | Nein – Passwörter sind tabu |
| Account-API | `AuthService.GetAccountInfo` – nur mit Sitzungs-Token | Nein |
| Charakter-API / -Auswahl | `AuthService.GetCharacters`, `ChooseCharacter` – nur mit Sitzungs-Token | Nein |
| Dokument-API | `DocumentsService.GetDocument` prüft die Rechte des aktiven Charakters – nur mit dessen Sitzungs-Token | Nein |
| Sync-API | `SyncService` für das Spielserver-Plugin: statischer Token für die ganze Instanz, ohne Charakter-Berechtigungen | Nein – würde FiveNet-Rechte umgehen |
| Berechtigungen | Freigabe pro Dokument nach Job/Rang und Person; „öffentlich“ heißt nur „für alle angemeldeten FiveNet-Nutzer“ | Werden respektiert (siehe unten) |
| Dateispeicher / Bild-Proxy | Bilder in Dokumenten liegen unter `/api/filestore/…` bzw. `/api/image_proxy/…` mit zufälligen Adressen und sind ohne Anmeldung abrufbar | Ja – nur Adressen, die ein berechtigter Anwalt mit dem Dokumentinhalt eingefügt hat |
| Öffentliche Endpunkte | `/api/ping`, `/api/version`, `/api/config` – ohne Personen- oder Dokumentdaten | Nur `/api/version` für die Erreichbarkeitsprüfung |

### Umsetzung

Weil FiveNet keine delegierte Freigabe für Drittanwendungen anbietet, speichert die Kanzlei FiveNet-Dokumente als **geprüfte externe Referenz** – ausdrücklich ohne Passwort-Abfrage, ohne Sitzungs-Cookies, ohne Browser-Automatisierung und ohne Scraping. Ein vollautomatischer Import nur anhand des Links ist deshalb nicht möglich; Text und Bilder werden per Kopieren und Einfügen übernommen (Punkt 4).

1. **Link erkennen:** Nur Adressen der konfigurierten Instanz werden angenommen (auch ohne `https://`, mit `/edit`, `?…` oder `#…`, oder nur die Zahl). Andere Hosts, andere FiveNet-Seiten und nicht-numerische IDs werden mit einer klaren Meldung abgelehnt.
2. **Berechtigung:** Die Kanzlei greift nie selbst auf FiveNet zu und kann deshalb keine FiveNet-Rechte umgehen. Wer verknüpft, bestätigt, das Dokument mit dem eigenen Charakter geöffnet zu haben; optional wird festgehalten, mit welchem Charakter („eingesehen als“, eigene Angabe). So bleibt nachvollziehbar, welcher Charakter Einsicht hatte – auch wenn jemand mehrere Charaktere nutzt.
3. **Gespeichert werden:** Quelle FiveNet, originale Adresse, normalisierte Adresse, Dokument-ID, verknüpfende Person, Datum und Uhrzeit sowie die Angaben des Anwalts (Titel, Dokumentart, Erstellungsdatum, Verfasser, Kurzinhalt). Der Inhalt bleibt in FiveNet – nichts wird dupliziert. Dasselbe Dokument kann pro Akte nur einmal verknüpft werden.
4. **Text & Bilder übernehmen:** Im FiveNet-Dokument den Inhalt markieren → Strg+C → in der Akte im Feld „Inhalt aus FiveNet“ Strg+V. Der Text wird als Abschrift gespeichert (Absätze, Listen und Tabellen bleiben lesbar, `[Bild]` markiert Bildpositionen) und lässt sich anzeigen, kopieren und als Textdatei herunterladen. Bilder aus dem eingefügten Inhalt lädt der Server direkt aus dem FiveNet-Dateispeicher und legt sie als Anhang zum Dokument ab; Screenshots oder „Bild kopieren“ lassen sich ebenfalls mit Strg+V einfügen. Der Server lädt dabei nur Adressen der FiveNet-Instanz unter `/api/filestore/` bzw. `/api/image_proxy/`, nur per https, ohne Weiterleitungen, ohne Cookies oder Tokens, höchstens 10 Bilder je Vorgang und 5 MB je Bild, und nur echte JPG-/PNG-/WebP-Dateien. Bilder außerhalb von FiveNet (z. B. Imgur-Links) werden nicht geladen – dafür einen Screenshot einfügen. Abschrift und Bilder folgen der Sichtbarkeit des Dokuments (intern / für den Mandanten).
5. **Nachvollziehbar:** Verknüpfen, Abschrift, Bildübernahme, Sichtbarkeitswechsel und Entfernen landen im Aktenverlauf und im Protokoll.
6. **Verbindungsstatus:** Unter *Mein Profil* zeigt „FiveNet-Verbindung“ den tatsächlichen Stand (Account nicht verbindbar, Charakter nicht abrufbar, Referenz-Modus) statt einer vorgetäuschten Verbindung.

Adresse der Instanz: Dashboard → *Einstellungen* → *FiveNet* (oder Umgebungsvariable `FIVENET_URL`, Standard `https://fivenet.modernv.net`). Dort lässt sich auch die Erreichbarkeit prüfen. Bietet FiveNet später eine offizielle, delegierte Anmeldung an, wird sie in `fivenet.js` ergänzt (dort steht auch die vollständige Prüfung).

## Google-Docs-Integration

Google-Docs-Dokumente werden genauso wie FiveNet-Dokumente im Abschnitt **„Externe Dokumente“** einer Akte verknüpft – mit dem Unterschied, dass die Kanzlei den Inhalt selbst laden kann:

| Freigabe in Google Docs | Was passiert |
|---|---|
| „Jeder, der über den Link verfügt“ (Betrachter) | Link einfügen → Titel, Text und Bilder werden automatisch geladen. Später mit „Aktualisieren“ den neuen Stand holen. |
| „Datei → Freigeben → Im Web veröffentlichen“ | wie oben (Link `…/document/d/e/…/pub`) |
| Eingeschränkt (nur bestimmte Personen) | Die Kanzlei erkennt das und zeigt, wie man die Freigabe setzt. Alternativ in Google Docs Strg+A, Strg+C und im Feld „Inhalt aus Google Docs“ Strg+V – Text und Bilder werden übernommen. |

So funktioniert es technisch (`gdocs.js`): Für freigegebene Dokumente stellt Google ohne Anmeldung einen HTML-Export bereit (`docs.google.com/document/d/<ID>/export?format=html`). Die Kanzlei nutzt **kein Google-Konto, keine Passwörter, keine Cookies**; es wird keine Einrichtung in der Google Cloud benötigt. Sicherheitsgrenzen:

- Aufgerufen wird nur `docs.google.com` mit der Dokument-ID aus dem Link; Weiterleitungen nur zu Google-Inhaltsservern (`*.googleusercontent.com`). Eine Weiterleitung zur Google-Anmeldung wird als „nicht freigegeben“ erkannt und nicht verfolgt.
- Höchstens 3 MB pro Dokument und 5 MB pro Bild, höchstens 10 Bilder je Vorgang, nur echte JPG-/PNG-/WebP-Dateien. Bilder werden am Inhalt erkannt, damit „Aktualisieren“ keine Dubletten erzeugt.
- Das geladene HTML wird im Browser nur gelesen (Text und Bildadressen), nie als HTML angezeigt; Skripte und Stile werden schon auf dem Server entfernt.
- Nur Textdokumente (Tabellen: siehe unten) – keine Präsentationen oder Formulare. Höchstens 60 Abrufe pro 10 Minuten (gemeinsam mit Google Sheets).

## Google-Sheets-Integration

Tabellen aus Google Sheets (z. B. Asservatenlisten, Zeugenlisten, Kostenaufstellungen) werden wie Google-Docs-Dokumente im Abschnitt **„Externe Dokumente“** verknüpft – Button **„Google-Sheets-Tabelle“**:

| Freigabe in Google Sheets | Was passiert |
|---|---|
| „Jeder, der über den Link verfügt“ (Betrachter) | Link einfügen → Titel und Tabelle werden automatisch geladen. Später mit „Aktualisieren“ den neuen Stand holen. |
| „Datei → Freigeben → Im Web veröffentlichen“ | wie oben (Link `…/spreadsheets/d/e/…/pubhtml`) |
| Eingeschränkt (nur bestimmte Personen) | Die Kanzlei erkennt das und zeigt, wie man die Freigabe setzt. Alternativ in Google Sheets die Zellen markieren, Strg+C und im Feld „Inhalt aus Google Sheets“ Strg+V – die Spalten bleiben erhalten. |

- **Welches Tabellenblatt?** Das aus dem Link: Wer ein bestimmtes Blatt geöffnet hat und die Adresse aus der Adresszeile kopiert, bekommt dieses Blatt (`#gid=…`). Ein Link ohne Blattangabe (z. B. über „Link kopieren“ im Freigabedialog) liefert das erste Blatt. Mehrere Blätter derselben Tabelle lassen sich einzeln verknüpfen; die Aktensuche per Link findet alle.
- **In der Akte:** Anzeige als Tabelle (erste Zeile = Kopfzeile), „Tabelle kopieren“ fügt sich mit allen Spalten in Excel oder Google Sheets ein, „Als Textdatei“ liefert ausgerichtete Spalten.
- **Technik (`gsheets.js`):** CSV-Export freigegebener Tabellen (`docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<Blatt>`), gleiche Sicherheitsgrenzen wie bei Google Docs – kein Google-Konto, keine Passwörter, keine Cookies, nur `docs.google.com` und Weiterleitungen zu `*.googleusercontent.com`, höchstens 3 MB. Übernommen werden Werte (keine Formeln, Formatierungen oder Diagramme), höchstens 50 Spalten und 60.000 Zeichen – bei größeren Tabellen wird an einer Zeilengrenze gekürzt und das angezeigt.

## Mandatsverträge

Die Vorlage „Mandatsvertrag“ entspricht der Google-Docs-Vorlage der Kanzlei (Titelseite mit den Parteien, §§ 1–5, Rechtswirksamkeit, Unterschriftsseite). Ablauf:

1. **Erstellen:** In der Akte unter „Verträge“ → „Mandatsvertrag erstellen“. Unterzeichnender Anwalt (aus dem Aktenteam), Name/Rang/Geburtsdatum, Mandant, Grund- und Zusatzgebühr, Datum und Ort sind vorbelegt bzw. werden aus früheren Verträgen übernommen. Leere Felder erscheinen als Linie zum handschriftlichen Ausfüllen.
2. **Ansehen & drucken:** `vertrag.html?id=…` zeigt den Vertrag im Layout der Vorlage; „Drucken / PDF“ → „Als PDF speichern“. Die Kopfzeile wiederholt sich auf jeder Seite.
3. **Unterschreiben:** Der im Vertrag genannte Anwalt unterschreibt selbst. Der Mandant unterschreibt im Portal, indem er seinen Namen eintippt (muss zum Namen im Vertrag passen) – oder die Kanzlei erfasst „Mandant hat im Spiel unterschrieben“ (mit Namen des Erfassenden im Verlauf). Nach der ersten Unterschrift ist der Inhalt gesperrt; das Board of Partners kann Unterschriften zurücksetzen.
4. **Vorlagen pflegen:** Einstellungen → Vertragsvorlagen (Board of Partners): Text bearbeiten, weitere Vorlagen anlegen (z. B. Vollmacht), Vorschau mit Beispielwerten, „Original wiederherstellen“. Bestehende Verträge behalten den Text, mit dem sie erstellt wurden.

Formatierung der Vorlagen: `# Titel`, `## Abschnitt`, `### § Überschrift`, `1. nummerierter Absatz`, `| zentrierte Zeile`, vier Leerzeichen = eingerückt, `**fett**`, `*kursiv*`, `===` neue Seite, `[Unterschriften]` Unterschriftsfeld. Platzhalter: `{{anwalt}}`, `{{anwalt_rang}}`, `{{anwalt_geburtsdatum}}`, `{{mandant}}`, `{{mandant_geburtsdatum}}`, `{{leistungen}}` (gewählte Leistungen, je Zeile eine), `{{grundgebuehr}}`, `{{zusatzgebuehr}}`, `{{datum}}`, `{{ort}}`, `{{aktenzeichen}}`, `{{akte}}`, `{{rechtsgebiet}}`, `{{kanzlei}}`.

## Ränge

Es gibt genau sechs Ränge (Benutzer, Team-Profile und Einstellung von Bewerbern bieten nur diese zur Auswahl):

| Board of Partners | Associate Attorneys |
|---|---|
| Founding Partner | Senior Associate |
| Equity Partner | Associate |
| Partner | Junior Associate |

**Board of Partners** ist zugleich die Leitung der Kanzlei: Die Dashboard-Rolle „Board of Partners“ (Admin) sieht den gleichnamigen Menübereich (Aktenbearbeitung, Team, Bewerbungen, Benutzer, Honorarordnung, Protokoll, Einstellungen). Die Auswertung „Aktenbearbeitung“, die eingegangenen Anliegen und die **Bewerbungen** (inkl. Stellenausschreibungen) sehen außerdem Konten mit Partner-Rang. Einstellen dürfen sie Bewerber als Anwalt/Mitarbeiter bis zum eigenen Rang; Admin-Konten anlegen und Bewerbungen löschen bleibt der Rolle „Board of Partners“ vorbehalten. Der Rang selbst vergibt keine Admin-Rechte – dafür im Menü „Benutzer“ die Rolle „Board of Partners“ wählen. Ältere Ränge „Managing Partner“ und „Managing Partner / Kanzleileitung“ wurden beim Update einmalig zu „Founding Partner“.

## Rollen und Rechte

| | Mandant | Anwalt | Board of Partners (Admin) |
|---|---|---|---|
| Akten sehen | eigene | alle | alle |
| Akte bearbeiten | – | zugewiesene (federführend oder als weiterer Anwalt) | alle |
| Mandanten-Konto mit Akte verknüpfen / lösen | – | zugewiesene Akten (Partner-Rang: alle) | alle |
| Unbesetzte Akte übernehmen | – | ja | ja / zuweisen |
| Weitere Anwälte zuweisen | – | als federführender Anwalt; eigene Mitarbeit beenden | ja |
| Mandatsverträge | eigene ansehen und unterschreiben | erstellen/bearbeiten in zugewiesenen Akten, als genannter Anwalt unterschreiben, Mandanten-Unterschrift erfassen | alles, Vorlagen pflegen, Unterschriften zurücksetzen |
| Interne Notizen | – | ja | ja |
| Kalender | eigene Termine anfragen/absagen | alles | alles |
| Kanzlei-Post | an die Kanzlei | an alle + Rundschreiben | an alle + Rundschreiben |
| Rechnungen | eigene ansehen/drucken | erstellen, Status | erstellen, Status, löschen |
| Kooperationen (Rabatte) | eigene Vorteile im Profil | in Rechnungen anwenden | anlegen, Rollen, Konten zuordnen (Partner-Rang ebenso) |
| Beweismittel | eigene hochladen, öffentliche ansehen | alles (auch intern) | alles |
| Externe Dokumente (FiveNet, Google Docs, Google Sheets) | freigegebene ansehen, Abschrift herunterladen | verknüpfen, Bilder übernehmen; eigene bzw. in zugewiesenen Akten bearbeiten/entfernen | alles |
| Aufgaben & Wiedervorlagen | – | alle ansehen, anlegen, abhaken; eigene/zugewiesene löschen | alles |
| Stempeluhr | – | eigene Zeiten | alle Zeiten, Korrekturen |
| Anliegen ans Board (auch ohne Konto über die Startseite) | eigene einreichen (auch anonym), Antworten lesen | eigene einreichen (auch anonym), Antworten lesen | zusätzlich „Eingegangene Anliegen“: alle ansehen, antworten, interne Notizen, Status/Zuständigkeit (Partner-Rang ebenso) |
| Beförderungen & Einstellungen | – | ansehen | ansehen, befördern (Partner-Rang: bis zum eigenen Rang), Einträge entfernen |
| Bewerbungen & Stellenausschreibungen | – | nur mit Partner-Rang (einstellen bis zum eigenen Rang, ohne Admin-Rolle, nicht löschen) | ja |
| Team, Benutzer, Honorarordnung, Protokoll, Einstellungen | – | – | ja |

## Sicherheit

- Passwörter mit bcrypt, Mindestlänge 10 · Session-Cookie `httpOnly`, `SameSite=Lax`, in Produktion `Secure`
- CSRF: SameSite-Cookie + Origin-Prüfung bei schreibenden Anfragen
- Rate-Limits auf Login, Registrierung, Mandatsanfrage, Statusabfrage und Nachrichten · Honeypot gegen Spam-Formulare
- Fremde Akten liefern 404 statt 403 · Aktenstatus nur mit 6-stelligem Aktenpin
- Alle Nutzertexte werden im Frontend escaped (XSS) · Discord-Nachrichten pingen nie `@everyone`
- FiveNet: keine Passwörter, keine Sitzungs-Tokens, kein Scraping · „In FiveNet öffnen“ verlinkt immer auf die aus Instanz und Dokument-ID gebaute Adresse, nie auf die eingefügte
- Discord-Bot: jede Interaktion ist von Discord signiert (`DISCORD_PUBLIC_KEY`), Bot-Token nur in Render · `/passwort` schickt das Einmal-Passwort ausschließlich per Direktnachricht an das verknüpfte Discord (nie in einen Kanal), beendet alle Sitzungen und erzwingt ein eigenes Passwort beim Login
- Bitte nur **In-Character-Daten** speichern und keine echten Passwörter wiederverwenden

## Projektstruktur

```
server.js        App-Setup, Routen, Start
db.js            SQLite-Schema, Migrationen, Helfer
auth.js          Sessions, Passwörter, Rollen-Middleware
bootstrap.js     Team-Seed, Notfall-Admin, Passwort-Reset, Datenmigration
discord.js       Webhooks & OAuth2
tickets.js       Discord-Tickets: je Akte ein privater Kanal (Bot, REST-API)
botCommands.js   Befehle des Kanzlei-Bots (/passwort, /akte, /notiz, /dienst, /imdienst, /termine, /hilfe), Antworten als Embed
cooperations.js  Kooperationen: Rabatt-Erkennung über Discord-Rollen bzw. zugeordnete Konten
fivenet.js       FiveNet: Schnittstellenprüfung, Link-Erkennung, Instanz-Einstellung
gdocs.js         Google Docs: Link-Erkennung, Export freigegebener Dokumente, Bildadressen
gsheets.js       Google Sheets: Link-Erkennung, CSV-Export freigegebener Tabellenblätter
contracts.js     Vertragsvorlagen: Standard-Mandatsvertrag, Platzhalter
remote.js        Abrufe externer Quellen mit Zeit-, Größen- und Weiterleitungsgrenzen
uploads.js       Bild-Uploads (Formatprüfung anhand der Dateisignatur)
helpers.js       Konstanten, Validierung
models.js        Datenabfragen, Zeilen-Mapping, Zugriffsregeln, Protokoll
routes/          auth, cases, calendar, messages, board, invoices, fees, team, admin, discord, public, duty, applications, fivenet, external, tasks, concerns, personnel, tickets, interactions, cooperations
public/          index.html, karriere.html, login.html, register.html, dashboard.html, invoice.html, css/, js/
```
