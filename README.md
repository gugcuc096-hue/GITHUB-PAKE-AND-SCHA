# Pake & Scha – Kanzlei-Website, Mandantenportal & Team-Dashboard

Premium-Webanwendung für die GTA-RP-Kanzlei **Pake & Scha Legal Consulting**: öffentliche Website, Mandantenportal und internes Kanzlei-Dashboard. Optimiert für Smartphone, Tablet und PC.

**Stack:** Node.js ≥ 22.13 · Express 4 · SQLite (eingebautes `node:sqlite`) · Session-Cookie (httpOnly) · bcrypt · zod · helmet · Tailwind (CDN)

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Website** | Login-/Dashboard-Button in Kopfzeile, Top-Leiste und Mobil-Menü · Team und Honorarordnung live aus der Datenbank · Mandat einreichen **ohne Konto** (liefert ein Aktenzeichen, danach direkt „Discord-Ticket beitreten“) · Tarifrechner übergibt die Auswahl ans Mandatsformular · **VIP & Lifetime** mit Preisen und „Jetzt anfragen“ (live aus den Board-Einstellungen) · Reihenfolge (aus Sicht der Mandanten): Ablauf → Tarifrechner → Honorarordnung → VIP & Lifetime → Team → Mandantenstimmen → FAQ → Kanzleiränge → Karriere → Kontakt · die Fußzeile verlinkt dieselben Bereiche (inkl. Tarifrechner und Team) |
| **Akten (Case Files)** | Aktenzeichen, Mandant (mit oder ohne Website-Konto), Gegenpartei, Gerichtsaktenzeichen, Status *Offen / In Bearbeitung / Geschlossen*, Verfahrensstand, öffentlicher Statushinweis, interne und öffentliche Notizen, automatischer Verlauf · **Bearbeitungsstand per Klick:** zuständige Anwälte klicken in der Leiste (Eingang → Akteneinsicht → Strategie → Verhandlung) direkt auf den gewünschten Schritt · **Papierkorb:** gelöschte Akten bleiben 30 Tage wiederherstellbar (siehe [Papierkorb für Akten](#papierkorb-für-akten)) · **Aktenauszug (PDF):** Knopf in der Akte öffnet eine Druckansicht mit Briefkopf – Stammdaten, Sachverhalt, Termine, externe Dokumente (auf Wunsch mit Abschrift), Verträge mit Unterschriftsstand, Rechnungen, Verlauf und Anhänge (auf Wunsch mit Bildern) frei wählbar, Seitenzahlen, „Als PDF speichern“ im Druckdialog; ohne „Interne Angaben“ steht nur drin, was auch der Mandant sieht (interne Notizen, Aufgaben, Priorität und interne Dokumente nur auf Wunsch der Kanzlei, dann mit Vertraulich-Hinweis); Mandanten können den Auszug ihrer eigenen Akte ebenfalls erstellen |
| **Priorität & Dringlichkeit** | **Dringlichkeit** (*Normal / Eilig / Notfall*) ist die Angabe des Mandanten beim Einreichen – er sieht sie im Portal und im Discord-Ticket. **Priorität** (*Niedrig / Normal / Hoch / Kritisch*) ist die Einschätzung der Kanzlei, nur intern; für das Team zählt nur sie · neue Akten starten automatisch mit der passenden Priorität (Normal → Normal, Eilig → Hoch, Notfall → Kritisch), die Kanzlei kann sie beim Anlegen auch direkt wählen · bestehende offene Akten mit „Eilig“/„Notfall“ wurden beim Update einmalig auf Hoch/Kritisch gesetzt (von Hand geänderte Prioritäten bleiben) · ändern: direkt neben dem Status oder unter „Akte bearbeiten“ (zuständige Anwälte und Board of Partners); wird dort die Dringlichkeit geändert, zieht die Priorität mit, solange sie noch auf dem automatischen Wert steht · im Dashboard zeigt die Kanzlei nur die Priorität als Badge, die Dringlichkeit steht in der Akte als „Dringlichkeit (Angabe Mandant)“ · Discord: die Team-Meldung „Neue Akte“ und `/akte` (für die Kanzlei) zeigen die Priorität; das Mandats-Ticket zeigt nur „Dringlichkeit (Angabe Mandant)“, weil der Mandant mitliest · Badge „Niedrige“, „Normale“, „Hohe“ oder „Kritische Priorität“ mit kleiner Stufen-Anzeige – oben in der Akte und in der Aktenliste als eigene Spalte „Priorität“ (am Handy eigene Zeile vor „Status“) · Aktenliste **sortierbar** (Zuletzt geändert, Priorität, Neueste, Älteste – die Auswahl merkt sich der Browser); „Priorität“ zeigt offene Akten zuerst, dann nach Priorität, Dringlichkeit und VIP/Lifetime · Mandanten sehen die Priorität nie, Änderungen stehen nur als interner Vermerk im Verlauf |
| **Prozessticket** (nur Kanzlei) | Prozesstickets liegen beim DOJ auf einem anderen Discord-Server: In der Akte **„Prozessticket (DOJ)“** → Link zum Kanal einfügen (in Discord Rechtsklick auf den Kanal bzw. am Handy lange drücken → „Link kopieren“) und optional eine Bezeichnung (z. B. „DOJ – Hauptverhandlung“) · danach steht in der Akte eine Karte wie beim Discord-Ticket mit **„Prozessticket öffnen“**, „Ändern“ und „Entfernen“ · nur echte Discord-Kanal-Links (`https://discord.com/channels/<Server>/<Kanal>`) werden angenommen · nur für die Kanzlei sichtbar, nicht für den Mandanten und nicht im Mandats-Ticket · der Bot tritt dem DOJ-Server dafür nicht bei – es wird nur der Link gespeichert |
| **Kalender & Fristen** | Gerichtstermine, Fristen, Mandantengespräche, interne Termine · Monatsansicht · Live-Countdown · Terminanfragen von Mandanten bestätigen · Discord-Erinnerung 24 h vor Frist/Gerichtstermin |
| **Kanzlei-Post** | Posteingang/Gesendet, Antworten, Aktenbezug, „wichtig“-Markierung, Rundschreiben ans ganze Team, Ungelesen-Zähler |
| **Pinnwand** | Team-Notizen mit Farben, Anheften (erscheint in der Übersicht) |
| **Rechnungen & Honorare** | Generator: Leistungen aus der Honorarordnung **einfach anhaken** (mehrere auf einmal, Menge je Leistung, Suche) – sie stehen sofort als Positionen in der Rechnung; dazu freie Positionen, Rabatt/Zuschlag, Rechnung **oder** Honorarvereinbarung, Druck-/PDF-Ansicht, Status offen/bezahlt/storniert · **Zahlungserinnerungen:** überfällige Rechnungen sind rot markiert („Überfällig“, Filter und Summe oben), der Mandant wird X Tage nach Fälligkeit einmal automatisch per Discord-DM und im Ticket erinnert, „Erinnern“ geht jederzeit von Hand (siehe [Zahlungserinnerungen](#zahlungserinnerungen)) |
| **Team-Verwaltung** (Admin) | Mitglieder hinzufügen, umbenennen, Rang/Beschreibung ändern, sortieren, ausblenden, löschen – sofort live auf der Website · optional mit Login-Konto (Einmal-Passwort) |
| **Benutzer** (Admin) | Rollen, Ränge, Sperren, Löschen, **Passwort-Reset per Klick** |
| **Login-E-Mail @pake-scha.ls** | Alle Konten enden auf **@pake-scha.ls** – bei Registrierung, „Konto anlegen“, Team-Konto und Einstellung wird nur der Teil vor dem @ gewählt (Vorschlag aus dem Namen) · bestehende Konten wurden automatisch umgestellt (`john@mail.ls` → `john@pake-scha.ls`, bei Doppelungen `john2@…`), **Passwort unverändert** · Login mit neuer Adresse, nur dem Teil vor dem @ (`john`) **oder der alten Adresse** · einmaliger Hinweis im Dashboard mit der neuen Adresse · unter *Benutzer* steht „vorher: …“ (siehe [Login-E-Mail](#login-e-mail-pake-schals)) |
| **Kooperationen** (Board of Partners) | Kooperationspartner anlegen (z. B. „Burgershot“) mit **Rabatt in %**, optional „gültig bis“, aktiv/inaktiv und interner Notiz · **Discord-Rolle(n) der Mitglieder** direkt aus der Rollenliste des Servers anhaken · beim Erstellen einer Rechnung mit Aktenbezug liest der Bot die Discord-Rollen des Mandanten und **setzt den Kooperationsrabatt automatisch** (bei mehreren der höchste; änderbar) · ohne Discord: Mandantenkonten von Hand zuordnen oder die Kooperation in der Rechnung auswählen · „Mandant prüfen“ zeigt, welche Kooperation gilt · Rechnung zeigt „Kooperationsrabatt Burgershot (15 %)“, Verlauf/Protokoll vermerken, ob per Discord-Rolle erkannt oder von Hand gewählt · Mandanten sehen ihre Vorteile unter *Mein Profil* (siehe [Kooperationen](#kooperationen)) |
| **VIP & Lifetime** (Board of Partners) | Mitgliedschaften für **einzelne Mandanten**: VIP auf Zeit (z. B. 30 Tage, verlängerbar) oder **Lifetime** (unbefristet, z. B. 100 %) · **Stufen, Preise & Rabatte** stellt das Board selbst ein (Name, Art, Preis, Laufzeit, Rabatt, Leistungen/Bedingungen, optional Discord-Rolle) · Vergeben an ein Mandantenkonto, auf Wunsch mit Rechnung über den Preis · Rabatt automatisch in jeder Rechnung (Lifetime 100 % → 0 $, gilt sofort als bezahlt, die Positionen dokumentieren den Wert der Arbeit) · Badge „👑 Lifetime“ / „⭐ VIP“ in Akten, diese Akten stehen oben · Bot vergibt/entfernt die Discord-Rolle, erinnert 3 Tage vor Ablauf per DM · Übersicht: gezahlt vs. Wert der abgedeckten Leistungen · **Anfrage auf der Startseite** (Bereich „VIP & Lifetime“) und im Mandantenportal → Board nimmt an (Rechnung) → bezahlt → automatisch freigeschaltet (siehe [VIP & Lifetime](#vip--lifetime)) |
| **Namensänderung** | Jeder Benutzer beantragt im Profil einen neuen Namen (mit Begründung) – das **Board of Partners** genehmigt oder lehnt ab (Menü „Namensänderungen“ mit Zähler) · genehmigt → neuer Name sofort im Konto, in Akten und im Team-Profil der Website · niemand entscheidet über den eigenen Antrag · Benachrichtigung per Discord-DM und Ereignis „Namensänderung“ · **ohne Antrag:** das Board ändert den eigenen Namen direkt im Profil und korrigiert Namen von Mandanten (z. B. Groß-/Kleinschreibung) unter „Namensänderungen“ oder in der Akte |
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
| **Mandatsverträge** | In der Akte „Mandatsvertrag erstellen“ → Vorlage der Kanzlei wird mit Anwalt (Name, Rang), Mandant, Honorar, Datum und Ort gefüllt (Vorbelegung aus Akte und früheren Verträgen, Honorar-Vorschläge aus der Honorarordnung) · Druckansicht im Layout der Kanzleivorlage (Kopfzeile auf jeder Seite, PDF über den Druckdialog) · **Unterschriften:** der genannte Anwalt unterschreibt digital – auf Wunsch **mehrere Anwälte** (bis zu 4 weitere, jeder unterschreibt selbst; vollständig erst, wenn alle Anwälte und der Mandant unterschrieben haben) –, der Mandant im Portal (Name eintippen) – oder die Kanzlei erfasst die Unterschrift im Spiel · nach der ersten Unterschrift gesperrt · Verlauf und Discord-Ereignis „Mandatsvertrag unterschrieben“ · **mehrere Leistungen aus der Honorarordnung** (mit Menge) wählbar – die Summe wird automatisch zur Grundgebühr, die Leistungen stehen einzeln im Vertrag · Vorlagen unter Einstellungen → Vertragsvorlagen bearbeiten (siehe [Mandatsverträge](#mandatsverträge)) |
| **Schriftsätze** | In der Akte **„Schriftsatz erstellen“**: Vorlage wählen (mitgeliefert: **Vollmacht**, **Antrag auf Akteneinsicht**, **Haftbeschwerde**; weitere unter Einstellungen → Vertragsvorlagen mit Art „Schriftsatz“) → das Formular zeigt nur die Felder der Vorlage (Empfänger, Betreff, Aktenzeichen aus FiveNet, Festnahme, Begründung, Mandant, Anwalt, Datum, Ort) → Druckansicht im Briefkopf der Kanzlei, PDF über den Druckdialog · **Aktenzeichen aus FiveNet:** In Anträgen (Akteneinsicht, Haftbeschwerde) steht als Aktenzeichen „DOC - 74412“ – vorbelegt aus dem FiveNet-Dokument der Akte (weitere per Klick wählbar), sonst manuell; „DOC - Nummer“ ist in Druckansicht, PDF und Google Doc ein Link, über den Sachbearbeiter die Akte direkt in FiveNet öffnen (siehe [Aktenzeichen aus FiveNet in Anträgen](#aktenzeichen-aus-fivenet-in-anträgen)) · **Unterschrift:** bei Schriftsätzen nur der Anwalt, bei der Vollmacht nur der Mandant (im Portal oder im Spiel erfasst) · **Sichtbarkeit:** Schriftsätze sind zunächst nur für die Kanzlei sichtbar („nur intern“) und lassen sich jederzeit für den Mandanten freigeben (Hinweis im Ticket) bzw. wieder auf intern stellen; Dokumente, die der Mandant unterschreiben muss, sind immer sichtbar · interne Schriftsätze erscheinen weder im Mandantenportal noch im Ticket, Verlaufseinträge dazu sind intern · nach der ersten Unterschrift gesperrt (wie Verträge) |
| **Google Docs** | In den Druckansichten von Rechnungen, Verträgen, Schriftsätzen und dem Aktenauszug **„Als Google Doc“** (die Druckansicht bleibt) → Doc im Layout der Druckansicht im Google Drive der Kanzlei, **automatisch „Jeder mit dem Link – Betrachter“** (nur noch den Link teilen) · **automatisch aktuell:** Unterschriften (z. B. Mandant unterschreibt den Mandatsvertrag), bezahlt/storniert, Änderungen am Vertrag oder an der Akte erscheinen im Doc, der Link bleibt gleich · Mandanten sehen „Google Doc öffnen“ bei ihren Dokumenten · Einrichtung einmalig durch das Board (siehe [Google Docs ausgeben](#google-docs-ausgeben-rechnungen-verträge-schriftsätze-aktenauszüge)) |
| **Abmeldungen** | Unter „Dienstzeiten“ (oder im Dienst-Menü oben) „Abmelden“: Zeitraum, Grund (Urlaub, Krankheit, Privat, OOC, Sonstiges), Notiz · das Team sieht aktuelle und geplante Abmeldungen, die Übersicht zeigt „Heute abgemeldet“ · „Zurückmelden“ beendet eine Abmeldung vorzeitig, „Zurückziehen“ entfernt sie · Board of Partners kann andere abmelden · Discord-Ereignis „Abmeldung / Rückmeldung“ (eigener Kanal und Rollen-Ping einstellbar) |
| **Aktenbearbeitung** (nur Board of Partners) | Automatische Erfassung, wer welche Akte bearbeitet (federführend oder weiterer Anwalt) und wie lange – bei Zuweisung, Abgabe, Mitarbeit beenden, Schließen und Wiedereröffnen · Ansicht „Aktenbearbeitung“: laufende und abgeschlossene Bearbeitungen je Mitarbeiter, Ø Dauer, Akten nach Bearbeitungsdauer, Zeitraum 7 Tage bis alles · in jeder Akte „Bearbeitungszeiten“ · ältere Akten werden aus dem Aktenverlauf geschätzt (≈) |
| **Discord-Tickets** | Je Akte ein privater Discord-Kanal (Kategorie z. B. „Mandatsanfragen“), je Bewerbung und Anliegen ein Board-Kanal (Kategorie „Board of Partners“, nur Board): Status, Zuständigkeit, Nachrichten, Termine, Verträge und Rechnungen erscheinen automatisch; Mandanten werden automatisch hinzugefügt (verknüpftes Discord oder „Discord-Ticket beitreten“ auf der Website); geschlossene Akten wandern ins Archiv – siehe *Discord einrichten* |
| **Discord-Bot: Rang-Sync, Role Connections, Join- & Standardrollen, Willkommen, Nachrichten** | Unter *Einstellungen → Discord-Bot* (Module wie bei Sapphire, Rollen und Kanäle direkt aus Discord als Auswahl): **Rang-Sync** – Rang auf der Website → Discord-Rolle (sofort bei Beförderung, Sperre, Discord verknüpfen/trennen) · **Role Connections** – Rolle automatisch vergeben/entfernen, wenn ein Mitglied bestimmte Rollen hat (ODER/UND, „hat“/„hat nicht“) · **Standardrollen** (hat jeder, dauerhaft) und **Join Roles** (beim Beitritt, auch für Bots, verzögert oder nach Regel-Bestätigung) · **Willkommen & Abschied** – eigener Text + Embed mit Live-Vorschau, Direktnachricht, Testnachricht · **Nachrichten** – eigene Embeds mit Feldern und Link-Buttons von Hand senden und später aktualisieren, per Zeitplan oder alle X Nachrichten automatisch posten oder **per Direktnachricht an alle Mitglieder einer Rolle** schicken (optional mit Website-Zugang); gepingte Rollen stehen mit Namen direkt in der Vorlage – siehe [Discord-Bot](#discord-bot-rang-sync-role-connections--willkommen) |
| **Anliegen ans Board** | **Jeder** kann ein Anliegen an das Board of Partners stellen: auf der **Startseite der Website** („Anliegen an das Board of Partners“ unter den Hero-Buttons und im Kontaktbereich, auch **ohne Konto**) sowie im Dashboard über „Anliegen ans Board“ im Menü oder den Button in der Übersicht · Kategorie (Mitarbeiter: Personal & Beförderung, Beschwerde, Vorschlag, Organisation, Gehalt · Mandanten/Besucher: Betreuung des Mandats, Beschwerde, Rechnung & Honorar, Anfrage/Zusammenarbeit, Vorschlag/Lob), Dringlichkeit, auf Wunsch **anonym** (das Board sieht dann nur „Anonym (Mitarbeiter / Mandant / über die Website)“, keinen Namen und keinen Kontakt) · jedes Anliegen erhält **Vorgangsnummer + Pin** (AN-JJJJ-NNNN) – damit lesen Einreichende die Antworten auf der Startseite („Status abfragen“) und können antworten; angemeldete sehen ihre Anliegen zusätzlich im Dashboard · **einsehen kann die Anliegen nur das Board of Partners**: Menübereich „Board of Partners“ → „Eingegangene Anliegen“ (Filter nach Status und Absender) – antworten, interne Notizen (für Einreichende unsichtbar), Status (Offen, In Bearbeitung, Erledigt, Abgelehnt) und Zuständigkeit · Zähler im Menü: Board = offene Anliegen, alle = neue Antworten · Zurückziehen, solange das Board noch nicht reagiert hat · Discord-Ereignisse „Neues Anliegen an das Board of Partners“ und „Rückmeldung / Statusänderung“ (eigener Kanal und Rollen-Ping einstellbar; bei anonymen Anliegen ohne Namen) |
| **Beförderungen & Einstellungen** | Personalprotokoll für **alle Mitarbeiter** sichtbar: wer neu im Team ist und wer befördert wurde (vorher → nachher, von wem, Begründung) · **Befördern nur durch das Board of Partners** („Befördern“ in dieser Ansicht; niemand ändert seinen eigenen Rang; Partner ohne Admin-Rolle befördern höchstens bis zum eigenen Rang und nur Kollegen unterhalb ihres Rangs) · Einstellungen werden automatisch eingetragen (Bewerber eingestellt, Mitarbeiterkonto angelegt, Team-Profil mit Konto, Mandantenkonto zum Mitarbeiter gemacht), ebenso Rangänderungen unter „Benutzer“ und „Team“ · Team-Profil der Website zieht mit · Zähler im Menü für neue Einträge · Discord-Ereignis „Beförderung / Einstellung“ – z. B. eigener Kanal *#beförderungen*; verknüpfte Discord-Konten werden erwähnt |
| **Mandantenstimmen** | Mandanten bewerten ihre **abgeschlossenen Akten** im Portal (1–5 Sterne, Erfahrungsbericht, Name auf der Website: Initialen, voller Name oder anonym) – die Übersicht erinnert einmal daran · eine Bewertung je Akte, jederzeit änderbar oder löschbar (nach Änderung erneute Freigabe) · das **Board of Partners** gibt sie unter *Mandantenstimmen* frei (Zähler im Menü, Discord-Ereignis „Neue Mandantenstimme“) oder lehnt ab · auf der Startseite zeigt der Bereich „Mandantenstimmen“ die freigegebenen Bewertungen (neueste zuerst, bis zu 8) – **solange es weniger als drei gibt, bleiben die bisherigen Texte** |
| **Fenster: immer zurück, wo man herkam** | Wird aus einem Fenster heraus ein weiteres geöffnet – z. B. Mandatsvertrag, Schriftsatz, Termin, Aufgabe, FiveNet-/Google-Dokument, Bild, Mandanten-Konto oder Nachricht aus der Akte, „Einstellen“ aus der Bewerbung oder ein Suchergebnis –, führen **X, Esc, Klick neben das Fenster, „Abbrechen“ und Speichern zurück in das vorherige Fenster**, an dieselbe Stelle und frisch geladen (Neues ist sofort zu sehen); erst im ersten Fenster schließt X ganz · **Rechnung aus der Akte**: oben „← Akte PS-…“, Abbrechen und Erstellen führen zurück in die Akte (die Bestätigung liegt darüber) · ein abgeschicktes Formular wird nie wieder angezeigt; Menü-/Seitenwechsel schließen alle Fenster |
| **Globale Suche** | Oben im Dashboard „Suchen …“ oder **Strg + K** (Mac: ⌘ + K): sucht beim Tippen in Akten (Aktenzeichen, Titel, Mandant, Gegenpartei, Gerichtsaktenzeichen, für die Kanzlei auch per FiveNet-/Google-Link), Mandantenkonten, Rechnungen, Aufgaben, Terminen und der eigenen Kanzlei-Post · Treffer hervorgehoben, mit ↑/↓ und Enter bedienbar · Klick öffnet die Akte, den Termin, die Aufgabe oder Nachricht; ein Mandant zeigt seine Akten in der Aktenverwaltung · gesucht wird nur in dem, was man sehen darf (Mandanten: eigene Akten, Rechnungen, freigegebene Termine, eigene Post; keine internen Angaben) |
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

**Webhook (Kanzlei-Updates):** Discord-Kanal → Einstellungen → Integrationen → Webhooks → URL kopieren → Dashboard → *Einstellungen* → einfügen → „Testnachricht“. Dort lässt sich auch wählen, welche Ereignisse gemeldet werden – und je Ereignis ein eigener Kanal (eigener Webhook) und eine Rolle zum Pingen. Neu hinzugekommene Ereignisse (z. B. „Neues Anliegen an das Board of Partners“ oder „Beförderung / Einstellung“) sind bei bestehender Auswahl zunächst aus und müssen dort einmal angehakt werden – ausgenommen die **Systemwarnungen**, die ab sofort an sind, bis jemand sie abwählt.

**Systemwarnungen ans Board:** Das Ereignis „Systemwarnung“ meldet Störungen – am besten in einen eigenen Kanal (z. B. *#system*, nur Board) mit Rollen-Ping für das Board:

| Störung | Wann | Entwarnung |
|---|---|---|
| Kanzlei-Bot offline | eingeschaltet, aber seit 15 Minuten nicht verbunden (inkl. Grund, z. B. ungültiger Token oder fehlender Intent) | wieder verbunden (wird der Bot ausgeschaltet, endet die Warnung ohne Meldung) |
| Datensicherung fehlgeschlagen | die tägliche Sicherung klappt nicht (z. B. Disk voll) – der Server versucht es stündlich weiter | Sicherung wieder angelegt |
| Speicher fast voll | weniger als 300 MB frei auf der Disk | wieder über 400 MB frei |
| Server abgestürzt | beim Neustart nach einem Absturz (mit Fehlermeldung, falls bekannt); Deploys und Neustarts über Render lösen nichts aus | – |

Jede Störung wird **einmal** gemeldet (auch über Neustarts hinweg), nicht wiederholt. Solange eine Störung besteht, zeigt die Übersicht des Dashboards dem Board zusätzlich einen roten Hinweis. Fehlertexte werden ohne Links und lange Zeichenketten gesendet, damit nie ein Zugangsschlüssel in Discord landet.

**Discord-Login / Konto verknüpfen:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application*
2. *OAuth2* → Redirect `https://<ihre-domain>/api/discord/callback` hinzufügen
3. In Render `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` und `PUBLIC_URL` setzen → deployen
4. Jeder Nutzer verknüpft sein Konto unter *Mein Profil* und kann sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Zuweisungen und Fristen im Kanal erwähnt.

**Discord-Tickets – zwei Kategorien:** Mandats-Tickets (je Akte, mit Mandant) landen in der Kategorie für Mandate (z. B. „Mandatsanfragen“); **Board-Tickets** (je Bewerbung und je Anliegen ans Board) in einer eigenen Kategorie (z. B. „Board of Partners“), sichtbar nur für die Board-Rolle(n) und die Board-Mitglieder (Rolle „Board of Partners“ oder Partner-Rang) mit verknüpftem Discord – normale Anwälte sehen sie nicht. Beide Arten haben ein eigenes (optionales) Archiv und lassen sich einzeln ein- und ausschalten (Einstellungen → Discord-Bot → Tickets).

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
| Zahlungserinnerung | Rechnung, Betrag, seit wann überfällig, Zahlungshinweis – der Mandant wird erwähnt |
| Akte geschlossen / wieder geöffnet | Hinweis, Kanal wandert ins Archiv (Mandant nur noch lesend) bzw. zurück |
| Akte gelöscht | Hinweis, Kanal ins Archiv (Verlauf bleibt) |
| Akte aus dem Papierkorb wiederhergestellt | Hinweis, Kanal zurück aus dem Archiv, Mandant darf wieder schreiben |

**Buttons im Ticket (Panel):** Die angeheftete Begrüßung jedes Tickets enthält Buttons – Akten: „Akte übernehmen“ (solange unbesetzt), „Akte schließen“ (mit Rückfrage) bzw. „Wieder öffnen“, „Im Dashboard öffnen“; Anliegen: „Als erledigt markieren“ / „Wieder öffnen“; Bewerbungen: „Im Dashboard öffnen“. Ein Klick wirkt genau wie im Dashboard (Verlauf „über Discord“, Meldungen, Archiv) und die Buttons passen sich an. Klicken darf nur, wer sein Discord mit einem Website-Konto verknüpft hat und dieselben Rechte wie im Dashboard besitzt (Akte: zuständige Anwälte / Board of Partners, Übernehmen: jedes Teammitglied; Anliegen: Board of Partners) – Mandanten und Fremde bekommen nur einen Hinweis, den nur sie sehen. Einrichtung: Developer Portal → *General Information* → „Public Key“ in Render als `DISCORD_PUBLIC_KEY` → deployen → **danach** im Developer Portal „Interactions Endpoint URL“ = `https://<ihre-domain>/api/discord/interactions` → speichern (Discord prüft die Adresse dabei). Bestehende Tickets bekommen die Buttons über „Offene nachholen“. Ohne Public Key gibt es nur den Button „Im Dashboard öffnen“.

**Befehle des Kanzlei-Bots (Slash-Commands):** Alle Antworten und Nachrichten des Bots sind Embeds; Erwähnungen stehen nur dann zusätzlich im Text, wenn jemand wirklich gepingt werden soll (z. B. die per `/add` hinzugefügte Person).

| Befehl | Wo | Wer | Was passiert |
|---|---|---|---|
| `/add @Person` · `/remove @Person` | Ticket-Kanal | zuständige Anwälte, Board (Board-Tickets: nur Board) | holt jemanden ins Ticket (Zeuge, Gutachter, Kollege) bzw. nimmt ihn wieder heraus; bleibt beim Abgleichen erhalten; fest zugehörige Personen (Anwälte, Mandant, Board) nur über die Website |
| `/delete [grund]` | Ticket-Kanal | wie `/add` | Rückfrage „Ja, Ticket löschen“ → Hinweis im Kanal, nach 5 Sekunden wird der **Kanal gelöscht**. Akte/Bewerbung/Anliegen bleiben erhalten; das Ticket wird **nicht automatisch neu angelegt** – im Dashboard steht „per /delete gelöscht“ mit „Neu anlegen“. Vermerk im Aktenverlauf (intern) und im Protokoll |
| `/passwort` | überall auf dem Server | jeder mit verknüpftem Discord | neues Einmal-Passwort per **Direktnachricht** (Embed mit E-Mail, Passwort als Spoiler, Login-Link); die E-Mail bleibt gleich, beim Login wird ein eigenes Passwort festgelegt, alle alten Anmeldungen enden. Kann der Bot keine DM schicken (DMs gesperrt), bleibt das alte Passwort gültig. Höchstens alle 10 Minuten; steht im Protokoll |
| `/akte [aktenzeichen]` | überall (im Ticket ohne Angabe) | wer die Akte auch im Dashboard sieht | Status, Verfahrensstand, Priorität (Kanzlei) bzw. Dringlichkeit (Mandant), Zuständige, nächster Termin, offene Aufgaben (Kanzlei), Hinweis der Kanzlei, Link ins Dashboard – nur für die Person sichtbar. Aktenzeichen auch kurz („12“) |
| `/notiz text [aktenzeichen]` | überall (im Ticket ohne Angabe) | Kanzlei | interne Notiz zur Akte – für den Mandanten unsichtbar, erscheint nie im Ticket |
| `/dienst status [notiz]` | überall | Kanzlei | Stempeluhr: Im Dienst, Im Gericht, Pause, Außer Dienst – wie im Dashboard (inkl. Discord-Meldung Dienstbeginn/-ende) |
| `/imdienst` | überall | alle | wer von der Kanzlei gerade im Dienst ist |
| `/termine` | überall | alle mit verknüpftem Discord | die nächsten 10 Termine/Fristen (Kanzlei: eigene und die der eigenen Akten; Mandanten: für sie sichtbare) |
| `/hilfe` | überall | alle | Übersicht der Befehle (Kanzlei sieht zusätzlich ihre Befehle) |

Antworten auf Befehle sind nur für die ausführende Person sichtbar – außer `/add` und `/remove`, die im Ticket für alle erscheinen. Die Befehle meldet die Website selbst an (beim Start, beim Speichern der Ticket-Einstellungen und bei „Verbindung testen“), sobald Bot-Token, Server-ID und `DISCORD_PUBLIC_KEY` gesetzt sind. Wer klickt oder einen Befehl nutzt, wird über sein verknüpftes Discord dem Website-Konto zugeordnet; es gelten dieselben Rechte wie im Dashboard.

**Wer wird wann erwähnt (gepingt)?** Beim neuen Ticket: Team- bzw. Board-Rolle (abschaltbar) und die zuständigen Anwälte. Danach nie mehr die ganze Rolle – nur gezielt, wer gerade etwas tun soll: der Mandant bei Status, Verfahrensstand, Hinweisen, Nachrichten/Anhängen der Kanzlei, Terminen und Rechnungen; die zuständigen Anwälte bei Nachrichten/Anhängen/Terminanfragen des Mandanten; neu zugewiesene Anwälte bei ihrer Zuweisung. Wer eine Änderung selbst vornimmt, wird nie erwähnt. Board-Tickets erwähnen nach der Eröffnung niemanden mehr.

- **Mandatsverträge:** Beim Erstellen einmal der Mandant („bitte unterschreiben“) und die übrigen unterzeichnenden Anwälte. Unterschreibt ein Anwalt, wird niemand erwähnt. Unterschreibt der Mandant, nur die Anwälte, deren Unterschrift noch fehlt. Das Discord-Ereignis „Mandatsvertrag unterschrieben“ pingt nur, wenn die Akte kein Ticket hat (sonst übernimmt das Ticket).
- **Ping-Pause** (Einstellungen → Discord-Bot → Tickets → „Pings in Mandats-Tickets“): Dieselbe Person wird im selben Ticket höchstens einmal pro Stunde erwähnt (Standard). Wählbar: 30 Minuten, 3 Stunden, einmal am Tag, bei jeder Nachricht oder gar nicht (nur beim Eröffnen). Die Nachrichten selbst erscheinen immer; nach einem Neustart des Servers kann höchstens ein Ping zusätzlich kommen.

**Nie im Ticket:** interne Notizen, interne Anhänge, Aufgaben, interne Termine, Telefonnummern – der Mandant liest mit. Nachrichten, die im Discord-Kanal geschrieben werden, landen nicht in der Akte (Einbahnstraße Website → Discord).

**Wer ist im Ticket?** Die eingestellten Team-Rollen (z. B. „Anwälte“), zusätzlich die zuständigen Anwälte mit verknüpftem Discord und der **Mandant – automatisch**, sobald
- sein Portal-Konto mit Discord verknüpft ist (*Mein Profil → Discord verbinden*; alle seine Akten), oder
- er direkt nach dem Einreichen eines Mandats auf der Website „**Discord-Ticket beitreten**“ klickt (ohne Konto, Discord-Anmeldung mit Bestätigung), oder
- die Kanzlei ihn im Ticket mit `/add` hinzufügt.

Eine öffentliche Aktenstatus-Abfrage (Aktenzeichen + Pin) gibt es nicht mehr; den Stand sehen Mandanten im Portal und im Discord-Ticket.

Ist er noch nicht auf dem Discord-Server, fügt der Bot ihn beim Verknüpfen automatisch hinzu (Discord fragt dafür einmal um Erlaubnis, „guilds.join“). In der Akte zeigt das Dashboard den Ticket-Status („Mandant im Ticket“, „In Discord öffnen“, „Abgleichen“).

**Einrichtung:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **dieselbe App wie beim Discord-Login** → *Bot* → „Reset Token“ → Token kopieren. (Nur mit derselben App kann der Bot Mandanten dem Server hinzufügen.)
2. In Render unter *Environment* `DISCORD_BOT_TOKEN` setzen → deployen. Der Token steht nur dort – nie in der Datenbank, im Code oder im Browser.
3. Dashboard → *Einstellungen* → Reiter *Discord-Bot* → *Tickets* → „Einladungslink“ öffnen und den Bot auf den Server einladen (enthält die nötigen Rechte: Kanäle verwalten, Berechtigungen verwalten, Nachrichten senden/verwalten, Links einbetten, Dateien anhängen, Verlauf lesen, Rollen erwähnen, Einladung erstellen).
4. In Discord eine Kategorie für Tickets anlegen (z. B. „Mandate“), optional eine fürs Archiv. IDs kopieren (Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick → „ID kopieren“).
5. Server-ID, Kategorie(n) und Team-Rolle(n) eintragen, „Discord-Tickets einschalten“, speichern, **„Verbindung testen“** (prüft Token, Server, Rechte des Bots, Rollen und Kategorien).
6. Für Board-Tickets zusätzlich die Kategorie „Board of Partners“ (optional ein Board-Archiv) und die Board-Rolle eintragen.
7. „Offene nachholen“ legt Tickets für alle bestehenden offenen Akten, Bewerbungen und Anliegen an.

Wird ein Ticket-Kanal von Hand in Discord gelöscht, legt der Bot beim nächsten Ereignis automatisch einen neuen an (mit `/delete` gelöschte Tickets dagegen nicht). Fehler (z. B. fehlende Rechte) stehen in der Akte beim Ticket.

## Discord-Bot: Rang-Sync, Role Connections & Willkommen

Unter **Einstellungen → Reiter „Discord-Bot“** (nur Board of Partners) stehen alle Module des Kanzlei-Bots – links das Modul-Menü (grüner Punkt = eingeschaltet), rechts die Einstellungen. Rollen und Kanäle werden direkt aus Discord geladen und als Auswahl angezeigt (mit Farbe; Rollen über der Bot-Rolle sind mit ⚠ markiert).

- **Übersicht:** Verbindungsstatus, Prüfliste (Token, Server, „Server Members Intent“, Rollen-Reihenfolge, verknüpfte Konten), „Alle Mitglieder abgleichen“, „Neu verbinden“, letzter Abgleich und letzte Fehler.
- **Tickets:** die bisherigen Einstellungen der Discord-Tickets (Server-ID, Kategorien, Rollen, Ping-Pause).
- **Rang-Sync (Website → Discord):** Je Rang (Founding Partner … Junior Associate) und je Gruppe (alle Mitarbeiter, Board of Partners, Associate Attorneys, Mandanten) eine Discord-Rolle. Wer auf der Website einen Rang hat und sein Discord verknüpft hat (Profil → „Discord verbinden“), bekommt die Rolle; die alte Rang-Rolle wird entfernt. Sofort bei Beförderung/Rückstufung (Personalprotokoll, Benutzer, Team), Sperren/Löschen und Discord verknüpfen/trennen, sonst beim Abgleich alle 10 Minuten. Optional **streng**: dieselben Rollen auch Mitgliedern ohne verknüpftes Website-Konto entfernen. VIP-/Lifetime-Rollen bleiben bei den Stufen unter „VIP & Lifetime“.
- **Role Connections (wie Sapphire):** Je Regel eine **Hauptrolle**, die automatisch vergeben – und wieder entfernt – wird, wenn die Bedingungen zutreffen: bis zu 10 Bedingungen „Mitglied *hat* / *hat nicht* Rolle X“, verknüpft mit **ODER** (eine reicht) oder **UND** (alle). Bis zu 25 Regeln, sie dürfen aufeinander aufbauen (z. B. „| Pake & Scha“ für alle Ränge, „Board of Partners“-Trenner für Founding/Equity Partner/Partner). Wirkt sofort, wenn sich in Discord Rollen ändern (auch von Hand), nach dem Rang-Sync und beim Abgleich. Eine Hauptrolle hat genau eine Regel und kann nicht ihre eigene Bedingung sein.
- **Join- & Standardrollen:**
  - **Standardrollen – hat jeder:** Rollen, die jedes Mitglied dauerhaft hat (z. B. „Bürger“). Bisherige Mitglieder bekommen sie beim Speichern, neue beim Beitritt, und wem sie jemand wegnimmt, bekommt sie sofort zurück. Sie gelten auch gegenüber Role Connections; optional auch für Bots. Abwählen heißt nur: wird nicht mehr erzwungen.
  - **Join Roles – nur beim Beitritt:** je eine Auswahl für neue Mitglieder und für neue Bots (bis zu 10), sofort oder verzögert (1 Minute bis 24 Stunden) und auf Wunsch **erst nach Bestätigung der Serverregeln** (Discord-Regelabfrage). Die Warteschlange übersteht Neustarts; verpasste Beitritte der letzten 24 Stunden werden nachgeholt. „An alle bisherigen Mitglieder“ ergänzt fehlende Join Roles nachträglich (nimmt nie etwas weg).
- **Willkommen & Abschied:** Kanal, Text und Embed (Titel, Beschreibung, Farbe, kleines Bild = Profilbild oder Server-Symbol, großes Bild, Fußzeile, Zeitstempel) mit **Live-Vorschau im Discord-Look**; optional zusätzlich als **Direktnachricht**; **Abschiedsnachricht** in einem eigenen Kanal. Platzhalter: `{user}` (Erwähnung), `{user.name}`, `{user.username}`, `{user.id}`, `{user.avatar}`, `{server}`, `{membercount}`, `{date}`, `{website}`. Erwähnt wird nur das neue Mitglied – `@everyone` oder Rollen im Text pingen nie. „Test“ speichert und schickt die Nachricht mit Ihnen selbst als neuem Mitglied. Jeder Beitritt wird genau einmal begrüßt; war der Bot offline, holt der Abgleich Beitritte der letzten 24 Stunden nach. (Discord liefert die Beitrittszeit live und beim Abgleich unterschiedlich genau – verglichen wird deshalb die Zeit, nicht der Text; vorher kam die Begrüßung beim 10-Minuten-Abgleich teils ein zweites Mal.)

- **Nachrichten (wie Sapphire „Messages → Templates“):** Bis zu 50 Vorlagen mit Text und Embed (Autor, Titel mit Link, Beschreibung, Farbe, kleines und großes Bild, bis zu 10 Felder – auch nebeneinander –, Fußzeile, Zeitstempel) und bis zu 5 Link-Buttons, mit Live-Vorschau. Platzhalter: `{server}`, `{membercount}`, `{date}`, `{time}`, `{website}`. Erwähnungen (@everyone, @Rolle) pingen nur mit dem Haken „Erwähnungen pingen“ und nur im Feld „Nachricht“ (im Embed zeigt Discord sie an, benachrichtigt aber niemanden).
  - **Wer wird gepingt?** „@ Rolle erwähnen …“ fügt eine Rolle als `<@&ID>` ein. Vorschau und Liste zeigen den **Rollennamen in Rollenfarbe** statt der ID; unter dem Haken steht „Pingt beim Senden: @Rolle“ – oder warum nicht: Haken aus, Erwähnung nur im Embed, Rolle in Discord nicht „erwähnbar“ (und der Bot ohne Recht „@everyone, @here und alle Rollen erwähnen“) oder Rollen-ID unbekannt.

  Unter **Verwenden**:
  - **Senden:** von Hand in einen Kanal. Unter **Gesendet** lässt sich jede gesendete Nachricht später auf den Stand der Vorlage bringen oder in Discord löschen.
  - **Zeitplan:** alle N Minuten/Stunden/Tage ab einem ersten Versand (mindestens alle 5 Minuten), z. B. täglich um 18 Uhr; optional die vorige Nachricht löschen. War der Server zum Termin aus, wird einmal nachgeholt – nie mehrfach.
  - **Alle X Nachrichten:** nach X Nachrichten von Mitgliedern im Kanal erneut posten (Bots zählen nicht, höchstens alle 15 Sekunden); mit „vorige Kopie löschen“ bleibt die Nachricht immer unten („Sticky“). Dafür meldet sich der Bot mit dem – nicht privilegierten – Intent für Server-Nachrichten an, aber nur solange eine solche Automatik aktiv ist; den Inhalt fremder Nachrichten liest er nicht.
  - Automatiken lassen sich pausieren, fortsetzen und löschen; Fehler (z. B. fehlende Rechte im Kanal) stehen direkt an der Automatik.
  - **Per DM an Rolle:** die Vorlage als Direktnachricht an alle Mitglieder mit einer Rolle (z. B. Anleitung für die Mitarbeiter eines Kooperationspartners). „Empfänger anzeigen“ listet sie (ohne Bots, mit Spitznamen auf dem Server und Discord-Benutzernamen) und zeigt, wer schon ein Website-Konto hat; einzelne Mitglieder lassen sich abwählen. Gesendet wird langsam nacheinander (etwa 40 pro Minute, höchstens 250 auf einmal – Discord wertet schnelle Massen-DMs als Spam); Fortschritt, Abbrechen und wer nicht erreichbar war (Direktnachrichten geschlossen) stehen unter „Versände“. Erwähnungen pingen in Direktnachrichten nie.
  - **Website-Zugang mitschicken** (Haken): Wer schon ein Konto mit diesem Discord hat, bekommt seine E-Mail-Adresse und den Hinweis auf „Mit Discord anmelden“ bzw. `/passwort` – **sein Passwort bleibt unverändert**. Für alle anderen legt der Bot ein **Mandantenkonto** an (Name: in der Empfängerliste je Person ein Feld, vorbelegt mit dem Spitznamen auf dem Server – vor dem Senden den IC-Namen prüfen bzw. korrigieren; daraus wird die E-Mail gebildet, z. B. `john.doe@pake-scha.ls`; **Discord gleich verknüpft** – Kooperationen über Discord-Rollen greifen damit sofort) und schickt ein **Einmal-Passwort** im Spoiler (wie `/passwort`: gespeichert wird nur der Hash, beim ersten Login mit Passwort wird ein eigenes festgelegt). Kommt die Nachricht nicht an, wird das neue Konto sofort wieder entfernt. Gesperrte Konten bekommen nur die Vorlage. Jedes angelegte Konto steht im Protokoll. Hatte jemand schon ein eigenes Konto ohne Discord, verknüpft er Discord dort einfach („Mein Profil → Mit Discord verbinden“): Das vom Bot angelegte, nie benutzte Konto gibt das Discord frei und wird gesperrt.

**Einrichtung (einmalig):**
1. Discord Developer Portal → die App des Bots → *Bot* → „Privileged Gateway Intents“ → **SERVER MEMBERS INTENT** einschalten → speichern. Ohne ihn verweigert Discord die Verbindung – die Übersicht zeigt das an.
2. Discord → Servereinstellungen → Rollen: die **Bot-Rolle über alle Rollen ziehen**, die der Bot vergeben soll.
3. Module einschalten und speichern – der Bot verbindet sich automatisch und gleicht alle Mitglieder ab.

**Technik:** Sobald ein Modul an ist, hält der Server eine dauerhafte Gateway-Verbindung zu Discord (Beitritte, Austritte, Rollenänderungen) – mit Herzschlag, automatischem Wiederverbinden und Fortsetzen der Sitzung. Alle Rollenänderungen laufen nacheinander und stehen mit dem Grund „Pake & Scha Bot: Rollen-Automatik“ im Discord-Audit-Log. Der Token bleibt in `DISCORD_BOT_TOKEN`. Der Bot läuft, solange der Render-Dienst läuft; schläft der Dienst (kostenloser Tarif), verpasst er in dieser Zeit Beitritte – Rollen werden beim nächsten Abgleich nachgezogen.

## Kooperationen

Unter **Board of Partners → Kooperationen** legt das Board Kooperationspartner an – z. B. „Burgershot“ mit 15 % Rabatt.

1. **Neue Kooperation** → Name, Rabatt in %, optional „gültig bis“ und eine interne Notiz.
2. **Discord-Rollen:** Die Rollen des Kanzlei-Servers (Server-ID aus *Einstellungen → Discord-Bot → Tickets*) werden als Liste geladen – die Rolle der Mitglieder anhaken (z. B. `@Burgershot`). Mehrere Rollen sind möglich. Liegt die Rolle auf einem **anderen Server** (z. B. dem Discord des Partners), dessen Server-ID eintragen – der Bot muss dort eingeladen sein.
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

**Design (Tailwind):** Tailwind CSS v3 ist fest eingebaut (`public/css/tailwind.css`, vorher das Play-CDN `cdn.tailwindcss.com`, das nicht für den Produktivbetrieb gedacht ist). Nach neuen Tailwind-Klassen in HTML oder JavaScript `npm run build:css` ausführen und die Datei mit committen. Sind die Build-Werkzeuge installiert (devDependencies, auf Render bei `npm install` normalerweise der Fall), frischt der Server die Datei beim Start zusätzlich selbst auf. Die Datei wird wie zuvor das CDN als letztes Stylesheet im `<head>` geladen – das Aussehen ist identisch (geprüft: berechnete Styles aller Elemente auf allen Seiten, PC und Handy).

## Automatische Tests

```bash
npm test                                   # API-Tests + Datei-Prüfungen (ca. 10 Sekunden)
npm install --no-save playwright && npx playwright install chromium
npm test                                   # zusätzlich Browser-Tests (PC + Handy)
```

Jeder Testlauf startet den Server mit einer **frischen Test-Datenbank** in einem Temp-Ordner (feste Test-Passwörter für die drei Team-Konten, keine Discord-/FiveNet-Zugangsdaten – es geht nichts nach außen). Die echte Datenbank wird nie berührt.

| Datei | prüft |
| --- | --- |
| `test/api.test.js` | Anmeldung, CSRF-Schutz, Sicherheits-Header, Mandatsanfrage über die Website (inkl. Spam-Schutz), Rechte (Mandant sieht nur Eigenes, interne Notizen bleiben intern), Rechnungen, Papierkorb, Mandantenstimmen mit Freigabe, Datensicherung nur fürs Board |
| `test/static.test.js` | strenge Content-Security-Policy (keine Inline-Skripte, keine `onclick`-Attribute), alle eingebundenen Dateien vorhanden, die 12 Dashboard-Teile (Reihenfolge, keine doppelten Namen), **keine Tokens/Schlüssel/Webhook-Adressen im Code** |
| `test/google.test.js` | Google Docs gegen eine nachgebaute Google-Schnittstelle (`test/googleStub.js`): Verbinden (nur `drive.file`, Token nie im Frontend), Doc öffentlich lesbar anlegen, automatisch neu bei Bezahlung und Unterschrift, Rechte der Mandanten, gelöschtes Doc in Drive, Trennen |
| `test/docx.test.js` | Word-Dateien für die Google Docs: Jede Vertrags-/Schriftsatzvorlage ergibt Wort für Wort denselben Text wie die Druckansicht (`contract-render.js`); „DOC - Nummer“ ist in beiden ein Link auf FiveNet (manuelle Aktenzeichen und unsichere Adressen nicht); mehrzeilige Werte im Blocksatz werden nicht gestreckt; Rechnung mit allen Angaben |
| `test/discord.test.js` | Kanzlei-Bot gegen eine nachgebaute Discord-Schnittstelle (`test/discordStub.js`): Willkommensnachricht genau einmal (auch bei unterschiedlich genauer Beitrittszeit), Rollen „erwähnbar“, Vorlage per DM an eine Rolle (nur Board, ohne Bots), Website-Zugang: neues Konto mit verknüpftem Discord und Einmal-Passwort, Login damit, kein Konto bei geschlossenen DMs, vorhandene Konten behalten ihr Passwort |
| `test/schriftsatz.test.js` | Aktenzeichen aus FiveNet in Anträgen: Vorbelegung aus dem FiveNet-Dokument der Akte (sonst Gerichtsaktenzeichen bzw. leer), Eingaben als „DOC - Nummer“ vereinheitlicht, unveränderte alte Antragsvorlagen werden aktualisiert, eigene bleiben |
| `test/browser.test.js` | Startseite (Tarifrechner, Mandatsdialog, FAQ, Handy-Menü), Registrierung, alle Dashboard-Ansichten am PC und am Handy (ohne seitliches Überlaufen), Fenster-Verlauf (aus der Akte geöffnete Fenster: X, Esc, Klick daneben, Abbrechen und Speichern führen zurück in die Akte an dieselbe Stelle; Rechnung aus der Akte), Antrag mit FiveNet-Aktenzeichen (Formular am PC und Handy, Link in der Druckansicht), Discord-Vorlage (gepingte Rolle sichtbar, Versand per DM an eine Rolle, am PC und Handy), Druckansichten – jeweils ohne JavaScript-Fehler und ohne CSP-Verstöße |

**GitHub-Prüfung:** `.github/workflows/test.yml` führt alle Tests (inkl. Browser-Tests in Chromium) bei jedem Pull Request und jedem Push auf `main` aus – das Ergebnis steht als grüner Haken bzw. rotes Kreuz am Pull Request. Optional in Render: *Settings → Build & Deploy → Auto-Deploy* auf „After CI Checks Pass“ stellen, dann geht eine Änderung nur live, wenn die Tests bestanden sind.

## App für PC und Handy (PWA)

Website und Dashboard lassen sich als **App installieren** – ohne App-Store, direkt aus dem Browser:

- **PC (Chrome, Edge):** Symbol „App installieren“ rechts in der Adressleiste, im Dashboard zusätzlich der Knopf **„App installieren“** oben rechts (erscheint, sobald der Browser die Installation anbietet). Danach öffnet sich Pake & Scha in einem eigenen Fenster mit Symbol in Taskleiste und Startmenü; Rechtsklick auf das Symbol bietet Abkürzungen zu Akten, Kalender und Kanzlei-Post.
- **Mac (Safari):** Ablage → „Zum Dock hinzufügen“ · **iPhone/iPad:** Safari → Teilen → „Zum Home-Bildschirm“ · **Android:** Chrome-Menü → „App installieren“. Firefox unterstützt keine Installation.
- Eine Anleitung steht für alle unter *Mein Profil → Als App installieren*.
- Technik: `public/manifest.webmanifest` (Start: Dashboard), `public/sw.js` (Service Worker) und `public/js/pwa.js`. Der Service Worker speichert bewusst nichts außer einer Offline-Seite (`offline.html`) – Inhalte kommen immer frisch vom Server, Updates sind sofort da. Installation setzt HTTPS voraus (auf Render gegeben).

## Datensicherung

- **Automatisch jeden Tag** (kurz nach dem Start, danach stündliche Prüfung) eine Kopie der Datenbank in `backups/` neben der Datenbank – auf Render also auf der Disk (`/var/data/backups`). Aufbewahrt: alle Sicherungen der letzten 7 Tage, danach die neueste je Woche bis 5 Wochen zurück; ältere werden gelöscht. Ist zu wenig Speicher frei, wird keine Sicherung angelegt (Warnung im Log).
- Enthalten ist die komplette Datenbank (Akten, Konten, Verträge, Rechnungen, Nachrichten, Einstellungen, Papierkorb) – **ohne Login-Sitzungen** (die Tokens werden restlos entfernt). Hochgeladene Bilder (`uploads/`: Profilbilder, Team-Fotos, Beweismittel) liegen nicht in der Datenbank – dafür gibt es ein eigenes Archiv (siehe unten).
- **Board of Partners (Admin):** *Einstellungen → Allgemein → Datensicherung* – Liste aller Sicherungen, **„Jetzt sichern“** und **„Herunterladen“** (am besten regelmäßig, damit es eine Kopie außerhalb von Render gibt). Erstellen, Herunterladen und Einspielen stehen im Protokoll.
- **Bilder & Anhänge:** **„Bilder herunterladen (.tar.gz)“** lädt alle Bilder mit ihren Ordnern als ein Archiv (`uploads/public/avatars`, `uploads/public/team`, `uploads/evidence`) – am besten zusammen mit einer Datenbank-Sicherung herunterladen.
- **Wiederherstellen im Dashboard:** bei einer Sicherung in der Liste **„Einspielen“** (vormerken) oder unter *Sicherung einspielen* eine heruntergeladene Datei hochladen:
  - **Datenbank (`.db`)** wird geprüft (lesbar, unbeschädigt, Datenbank dieser Anwendung) und als `restore.db` vorgemerkt – ein Hinweis zeigt das an, „Vormerkung aufheben“ macht es rückgängig. Eingespielt wird beim nächsten Neustart: auf Render Dienst öffnen → *Manual Deploy* → *Restart service*.
  - **Bilder-Archiv (`.tar.gz`)** wird sofort ergänzt: nur Bilder (geprüft anhand der Dateisignatur) in die drei bekannten Ordner, vorhandene Dateien bleiben unverändert; Links, fremde Pfade und andere Dateien werden übersprungen. Auch mit `tar -czf bilder.tar.gz uploads` (im Ordner der Datenbank) gebaute Archive funktionieren.
- **Wiederherstellen per Shell:** Sicherung als `restore.db` neben die Datenbank legen und den Dienst neu starten – z. B. in der Render-Shell `cp /var/data/backups/pake-scha-2026-10-05.db /var/data/restore.db`, danach *Manual Deploy → Restart service*. Bilder: `tar -xzf pake-scha-bilder-….tar.gz -C /var/data`.
- Beim Start wird `restore.db` eingespielt; die bisherige Datenbank bleibt als `pake-scha.db.before-restore-<Zeit>` liegen. Eine Datei, die keine SQLite-Datenbank ist, wird nicht eingespielt (`restore.db.ungueltig`). Nach dem Einspielen müssen sich alle neu anmelden.

## Zahlungserinnerungen

- Offene Rechnungen und Honorarvereinbarungen mit Fälligkeitsdatum gelten ab dem Tag danach als **überfällig**: roter Status „Überfällig“ (Anzahl der Tage beim Darüberfahren), rotes Fälligkeitsdatum, eigener Filter „Überfällig“ und die Summe „Überfällig“ oben in *Rechnungen*. In der Akte steht „X Tage überfällig“, Mandanten sehen die Markierung ebenfalls.
- **Automatisch:** X Tage nach der Fälligkeit (Einstellungen → Allgemein → Rechnungsdaten der Kanzlei → *Zahlungserinnerung*, Standard 3 Tage, 0 = aus) bekommt der Mandant **einmal** eine Erinnerung – per Discord-DM (verknüpftes Discord) und im Ticket der Akte (mit Erwähnung), inklusive Betrag, Fälligkeit und Zahlungshinweis. Rechnungen, die beim Einschalten schon länger überfällig waren, werden nicht automatisch nachträglich erinnert.
- **Von Hand:** in der Spalte *Datum* auf **„Erinnern“** (danach „erinnert TT.MM.“, erneut klickbar; höchstens alle 10 Minuten je Rechnung). Ist der Mandant über Discord nicht erreichbar (kein verknüpftes Discord, Rechnung ohne Akte/Ticket), sagt das Dashboard Bescheid – dann bitte direkt ansprechen.
- Jede Erinnerung steht im Protokoll und als interner Vermerk im Aktenverlauf.

## Papierkorb für Akten

- **Akte löschen** (nur Board of Partners, Admin-Rolle) legt die Akte zuerst **30 Tage in den Papierkorb** – mit allem, was an ihr hängt: Notizen und Verlauf, Aufgaben, Anhänge (die Bilddateien bleiben so lange auf der Disk), externe Dokumente, zuständige Anwälte, Mandatsverträge samt Unterschriften und Bearbeitungszeiten. Danach verschwindet sie wie bisher aus allen Listen; Termine, Rechnungen und Nachrichten bleiben bestehen und verlieren nur den Aktenbezug.
- **Aktenverwaltung → „Papierkorb“** (Knopf oben rechts, nur Admin): Liste mit Aktenzeichen, Mandant, wer wann gelöscht hat und wann die Akte endgültig verschwindet · **„Wiederherstellen“** schreibt alles mit den ursprünglichen Nummern zurück, verknüpft Termine, Rechnungen und Nachrichten wieder mit der Akte (sofern sie inzwischen keiner anderen Akte zugeordnet wurden), holt das Discord-Ticket aus dem Archiv und öffnet die Akte · **„Endgültig löschen“** entfernt sie sofort samt Bilddateien.
- Nach 30 Tagen wird automatisch endgültig gelöscht (Prüfung alle 6 Stunden). Aktenzeichen im Papierkorb werden nicht neu vergeben. Wurde in der Zwischenzeit ein Konto gelöscht (Mandant oder Anwalt), wird die Akte trotzdem wiederhergestellt – wie beim Löschen eines Kontos bleibt der Mandantenname stehen und die Zuständigkeit des gelöschten Anwalts entfällt.
- Löschen, Wiederherstellen und endgültiges Löschen stehen im Protokoll, das Wiederherstellen zusätzlich als interner Vermerk im Aktenverlauf.

## VIP & Lifetime

Unter **Board of Partners → VIP & Lifetime** (Admin-Rolle oder Partner-Rang):

1. **Stufen, Preise & Rabatte:** Beim ersten Start gibt es drei Beispiele – *VIP Silber* (250.000 $, 30 Tage, 15 %), *VIP Gold* (750.000 $, 30 Tage, 25 %) und *Lifetime* (2.000.000 $, unbefristet, 100 %). Name, Art (VIP auf Zeit / Lifetime unbefristet), Preis, Laufzeit, Rabatt, Leistungen/Bedingungen und eine optionale Discord-Rolle sind frei änderbar; „Aktiv“ abwählen, um eine Stufe nicht mehr zu vergeben. Änderungen gelten für neue Mitgliedschaften und Verlängerungen – laufende behalten ihren Rabatt.
2. **Anfragen von der Website:** Auf der Startseite (Bereich *VIP & Lifetime*, Preise live aus den Stufen) und im Mandantenportal (*VIP & Lifetime*) klickt der Mandant „Jetzt anfragen“ – ohne Anmeldung geht es erst zum Login bzw. zur Registrierung und danach direkt weiter. Das Board sieht die Anfrage oben in *VIP & Lifetime* (Zähler im Menü, Discord-Ereignis „VIP / Lifetime“). **Annehmen** erstellt die Rechnung über den Preis (im Portal sichtbar, DM an den Mandanten); sobald sie auf **„bezahlt“** steht – per Button „Bezahlt – freischalten“ oder unter *Rechnungen* –, wird die Mitgliedschaft automatisch freigeschaltet (gleiche VIP-Stufe → verlängert, sonst ersetzt). „Zahlung bereits erhalten“ schaltet sofort frei. Storno der Rechnung → Anfrage abgelehnt; **Ablehnen** mit Grund. Bezahlt wird immer im Spiel.
3. **Mitgliedschaft direkt vergeben:** Mandantenkonto suchen, Stufe wählen, auf Wunsch „Rechnung über den Preis erstellen“ (erscheint im Portal des Mandanten). Hat der Mandant schon eine, fragt das Dashboard, ob sie ersetzt werden soll. Der Mandant bekommt eine Discord-DM und sieht die Mitgliedschaft unter *Mein Profil*.
4. **Rechnungen:** Mit Aktenbezug wird die Mitgliedschaft des Mandanten automatisch gewählt (ohne Akte von Hand). Der Satz kommt immer vom Server. VIP/Lifetime und Kooperation werden **nicht addiert** – es gilt der höhere Rabatt. Bei Lifetime (100 %) ist die Rechnung 0 $ und gilt sofort als bezahlt; die Positionen zeigen den eigentlichen Wert der Arbeit (z. B. zur Bezahlung der Anwälte aus dem Lifetime-Preis).
5. **Übersicht:** je Mitglied gezahlter Preis, Anzahl Rechnungen, Wert der Leistungen und abgedeckter Betrag – „Arbeit übersteigt Preis“ zeigt, wann sich Lifetime nicht mehr lohnt. **Verlängern** (VIP, ab Ablaufdatum bzw. heute, optional mit Rechnung) und **Beenden** (mit Grund, z. B. Missbrauch oder CK).
6. **Automatisch:** Badge in Akten (Lifetime/VIP stehen in der Aktenliste oben), Discord-Rolle beim Start vergeben und beim Ende/Ablauf entfernt (die Bot-Rolle muss dafür in den Server-Einstellungen **über** der VIP-Rolle stehen), Erinnerung per DM 3 Tage vor Ablauf, Ablauf → Status „abgelaufen“. Ereignis „VIP / Lifetime“ unter Einstellungen → Discord-Ereignisse einschalten, um das Team zu informieren.

## Namensänderung

Unter *Mein Profil → Name ändern* stellt jeder Benutzer (Mandant oder Mitarbeiter) einen Antrag mit optionaler Begründung und sieht dort den Status (offen, genehmigt, abgelehnt mit Grund) – offene Anträge lassen sich zurückziehen. Das **Board of Partners** entscheidet unter *Namensänderungen* (Zähler im Menü); eine Ablehnung braucht einen Grund, über den eigenen Antrag entscheidet ein anderes Board-Mitglied. Genehmigt → der neue Name gilt sofort im Konto, in allen Akten und im Team-Profil der Website. Die Person erhält eine Discord-DM; das Ereignis „Namensänderung“ meldet Anträge und Entscheidungen im Discord. Das Board kann Namen weiterhin direkt unter *Benutzer* ändern.

**Ohne Antrag (Board of Partners, auch Partner-Rang):**
- **Eigener Name:** Unter *Mein Profil → Name ändern* ändert das Board seinen Namen direkt – ohne Antrag (ein älterer eigener Antrag wird dabei zurückgezogen).
- **Mandanten:** Unter *Namensänderungen → Name eines Mandanten korrigieren* (Suche nach Name oder E-Mail) oder in der Akte unter *Akte bearbeiten → Mandanten-Konto → Name korrigieren*, z. B. bei Groß-/Kleinschreibung oder Tippfehlern. Der Mandant bekommt eine Discord-DM („Ihr Name wurde angepasst“); hatte er genau diesen Namen beantragt, gilt der Antrag als genehmigt.
- Namen anderer **Mitarbeiter** ändern sich weiterhin nur per Antrag.
- Jede direkte Änderung steht in der Historie (Profil der Person und *Namensänderungen → Alle* als „direkt geändert“), im Protokoll und wird im Discord-Ereignis „Namensänderung“ gemeldet.

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

## Google Docs ausgeben (Rechnungen, Verträge, Schriftsätze, Aktenauszüge)

In den Druckansichten von Rechnungen/Honorarvereinbarungen, Verträgen/Schriftsätzen und dem Aktenauszug gibt es neben „Drucken / PDF“ den Knopf **„Als Google Doc“**. Die Druckansicht bleibt wie bisher.

- **Aussehen wie die Druckansicht:** gleicher Aufbau, gleiche Schriften (auch die Schreibschrift der Unterschriften), Farben, Logo und Tabellen. Was Google Docs nicht kann, ist so nah wie möglich nachgebaut: Goldbalken einfarbig statt Farbverlauf, Stempel „BEZAHLT“/„STORNIERT“ gerade statt schräg, kein Zeichenabstand (Sperrung); Seitenumbrüche können minimal abweichen.
- **Öffentlich per Link:** Jedes Doc steht automatisch auf „Jeder mit dem Link – Betrachter“ (lesen, nicht bearbeiten, nicht auffindbar). Es genügt, den Link zu teilen („Link kopieren“).
- **Automatisch aktuell, gleicher Link:** Unterschreibt jemand (Anwalt, Mandant im Portal oder „im Spiel unterschrieben – erfasst“), werden Unterschriften zurückgesetzt, ändert sich der Vertrag, wird eine Rechnung bezahlt/storniert/wieder offen oder ändern sich Angaben der Akte (Aktenzeichen, Titel, Gericht …), die Kopfzeile der Verträge oder die Anschrift der Kanzlei, schreibt der Server das Google Doc kurz danach neu.
- **Aktenauszug:** Momentaufnahme mit den in „Inhalt wählen“ gesetzten Abschnitten; „Aktualisieren“ schreibt ihn mit der aktuellen Auswahl neu. Da jeder mit dem Link lesen kann, „Interne Angaben“ nur bewusst einbeziehen.
- **Löschen:** „Löschen“ in der Druckansicht, das Löschen der Rechnung/des Vertrags oder das endgültige Löschen der Akte legt das Doc in den Papierkorb des Kanzlei-Drive – der Link funktioniert dann nicht mehr.
- **Wer:** Anlegen, Aktualisieren und Löschen die Kanzlei (Anwälte, Board). Mandanten sehen in ihrer Druckansicht „Google Doc öffnen“ / „Link kopieren“, sobald es ein Doc gibt (Aktenauszüge nur für die Kanzlei).
- **Wo:** im Google Drive des Kanzlei-Kontos, Ordner „Pake & Scha – Dokumente“ (Unterordner „Rechnungen & Honorare“, „Verträge & Schriftsätze“, „Aktenauszüge“).
- **Störung:** Ist Google nicht erreichbar oder die Verbindung abgelaufen, merkt sich der Server die Änderungen und holt sie nach (alle 10 Minuten bzw. sofort nach erneutem Verbinden); das Board erhält eine Systemwarnung in Discord.

### Einrichtung (einmalig, ca. 10 Minuten)

1. [console.cloud.google.com](https://console.cloud.google.com) → oben „Projekt auswählen“ → **„Neues Projekt“** (z. B. „Pake & Scha“).
2. **APIs & Dienste → Bibliothek → „Google Drive API“ → „Aktivieren“.**
3. **Google Auth Platform** (früher „OAuth-Zustimmungsbildschirm“) → „Erste Schritte“: App-Name „Pake & Scha“, Support-E-Mail, Zielgruppe **„Extern“**, Kontakt-E-Mail.
4. **Datenzugriff → „Bereiche hinzufügen“** → `…/auth/drive.file` („Nur die Google-Drive-Dateien, die mit dieser App verwendet werden“) → Speichern.
5. **Zielgruppe → „App veröffentlichen“** (Status „In Produktion“). Wichtig: Im Status „Test“ läuft die Verbindung nach 7 Tagen ab. Da nur `drive.file` genutzt wird, braucht es keine Prüfung durch Google. Zeigt Google beim Verbinden „Google hat diese App nicht überprüft“: „Erweitert“ → „Weiter zu Pake & Scha“.
6. **Clients → „Client erstellen“** → Typ **„Webanwendung“** → „Autorisierte Weiterleitungs-URIs“: `https://<deine-seite>.onrender.com/api/google/callback` (die genaue Adresse steht im Dashboard unter Einstellungen → Google Docs) → „Erstellen“ → **Client-ID** und **Clientschlüssel** kopieren.
7. **Render → Service → Environment:** `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` eintragen und speichern (Render deployt neu). Optional `GOOGLE_REDIRECT_URI`, falls die Adresse von `PUBLIC_URL` abweicht.
8. **Dashboard → Einstellungen → „Google Docs“ → „Kanzlei-Google-Konto verbinden“** und mit dem **gemeinsamen Google-Konto der Kanzlei** anmelden (nicht dem privaten Konto eines Mitarbeiters) – den Haken für Google Drive setzen.

Danach erscheint in allen Druckansichten der Knopf „Als Google Doc“. Ohne diese Einrichtung bleibt alles wie bisher.

**Sicherheit:** Die Website erhält nur den Bereich `drive.file` – sie sieht und ändert ausschließlich Dateien, die sie selbst angelegt hat, nicht den übrigen Inhalt des Google Drive. Der Zugangsschlüssel (Refresh-Token) liegt nur auf dem Server, verschlüsselt mit einem aus `GOOGLE_CLIENT_SECRET` abgeleiteten Schlüssel, und gelangt nie in den Browser. „Trennen“ widerruft den Zugang bei Google; vorhandene Docs bleiben dann unter ihrem Link erreichbar, werden aber nicht mehr aktualisiert. Wird `GOOGLE_CLIENT_SECRET` geändert, einfach neu verbinden.

Technik: `docxRender.js` baut aus denselben Daten wie die Druckansicht eine Word-Datei, Google wandelt sie beim Hochladen in ein Google Doc um (`googleDrive.js`); `googleDocs.js` merkt sich je Dokument das Doc und schreibt es bei Änderungen neu. Die unten beschriebene Google-Docs-*Integration* (Dokumente in eine Akte übernehmen) ist davon unabhängig und braucht weiterhin keine Einrichtung.

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

1. **Erstellen:** In der Akte unter „Verträge“ → „Mandatsvertrag erstellen“. Unterzeichnender Anwalt (aus dem Aktenteam), Name/Rang/Geburtsdatum, Mandant, Grund- und Zusatzgebühr, Datum und Ort sind vorbelegt bzw. werden aus früheren Verträgen übernommen. Leere Felder erscheinen als Linie zum handschriftlichen Ausfüllen. **Weitere unterzeichnende Anwälte (optional):** bis zu 4 zusätzliche Anwälte aus dem Aktenteam ankreuzen (das Board of Partners kann jeden aktiven Anwalt wählen), je mit Geburtsdatum (IC, aus früheren Verträgen vorbelegt). Name und Rang kommen aus dem Profil; die Anwälte erscheinen bei den Parteien und bekommen je ein eigenes Unterschriftsfeld.
2. **Ansehen & drucken:** `vertrag.html?id=…` zeigt den Vertrag im Layout der Vorlage; „Drucken / PDF“ → „Als PDF speichern“. Die Kopfzeile wiederholt sich auf jeder Seite.
3. **Unterschreiben:** Jeder im Vertrag genannte Anwalt unterschreibt selbst (Reihenfolge egal). Vollständig unterschrieben – und im Ticket/Discord als wirksam gemeldet – ist der Vertrag erst, wenn alle Anwälte und der Mandant unterschrieben haben; bis dahin zeigen Akte, Druckansicht und Ticket, wessen Unterschrift noch fehlt. Der Mandant unterschreibt im Portal, indem er seinen Namen eintippt (muss zum Namen im Vertrag passen) – oder die Kanzlei erfasst „Mandant hat im Spiel unterschrieben“ (mit Namen des Erfassenden im Verlauf). Nach der ersten Unterschrift ist der Inhalt gesperrt; das Board of Partners kann Unterschriften zurücksetzen.
4. **Vorlagen pflegen:** Einstellungen → Vertragsvorlagen (Board of Partners): Text bearbeiten, weitere Vorlagen anlegen (z. B. Vollmacht), Vorschau mit Beispielwerten, „Original wiederherstellen“. Bestehende Verträge behalten den Text, mit dem sie erstellt wurden.

Formatierung der Vorlagen: `# Titel`, `## Abschnitt`, `### § Überschrift`, `1. nummerierter Absatz`, `| zentrierte Zeile`, vier Leerzeichen = eingerückt, `**fett**`, `*kursiv*`, `===` neue Seite, `[Unterschriften]` Unterschriftsfeld, `[Weitere Anwälte]` weitere unterzeichnende Anwälte bei den Parteien (entfällt, wenn es keine gibt; fehlt die Zeile in einer älteren Vorlage, erscheinen sie nach dem Geburtsdatum des ersten Anwalts). Lange Namen werden in der Unterschrift automatisch verkleinert. Platzhalter: `{{anwalt}}`, `{{anwalt_rang}}`, `{{anwalt_geburtsdatum}}`, `{{mandant}}`, `{{mandant_geburtsdatum}}`, `{{leistungen}}` (gewählte Leistungen, je Zeile eine), `{{grundgebuehr}}`, `{{zusatzgebuehr}}`, `{{datum}}`, `{{ort}}`, `{{aktenzeichen}}`, `{{akte}}`, `{{rechtsgebiet}}`, `{{kanzlei}}` – für Schriftsätze außerdem `{{empfaenger}}` (mehrzeilig), `{{betreff}}`, `{{festnahme}}`, `{{begruendung}}` (steht er allein in einer Zeile und ist leer, entfällt der Absatz), `{{fivenet_az}}` (Aktenzeichen aus FiveNet, „DOC - Nummer“ wird zum Link), `{{gerichtsaktenzeichen}}` und `{{gegenpartei}}` (beide aus der Akte).

**Schriftsätze** nutzen dieselben Vorlagen mit der Art „Schriftsatz“ (Einstellungen → Vertragsvorlagen → Art). Mitgeliefert: Vollmacht, Antrag auf Akteneinsicht, Haftbeschwerde. Wer unterschreibt, legt die Vorlage fest: `[Unterschrift Anwalt]` (nur Anwalt – Standard bei Schriftsätzen), `[Unterschrift Mandant]` (nur Mandant, z. B. Vollmacht) oder `[Unterschriften]` (beide). Schriftsätze sind zunächst intern; „Für Mandant freigeben“ macht sie im Portal sichtbar (Hinweis im Ticket), „Nur intern“ nimmt das zurück – Dokumente, die der Mandant unterschreiben muss, sind immer sichtbar.

### Aktenzeichen aus FiveNet in Anträgen

In Anträgen (mitgeliefert: Antrag auf Akteneinsicht, Haftbeschwerde) ist das **Aktenzeichen** das des FiveNet-Dokuments, z. B. `DOC - 74412` für `https://fivenet.modernv.net/documents/74412`. Darunter steht weiter „Unser Zeichen“ (Aktenzeichen der Kanzlei, z. B. PS-2026-0001).

- **Vorbelegung:** Ist in der Akte ein FiveNet-Dokument hinterlegt, steht im Formular „Schriftsatz erstellen“ automatisch `DOC - <Nummer>` des obersten FiveNet-Dokuments der Akte (Reihenfolge wie in der Akte). Sind mehrere hinterlegt, lässt sich jedes per Klick übernehmen. Ist keins hinterlegt, wird das Gerichtsaktenzeichen der Akte vorgeschlagen bzw. das Feld bleibt leer – dann manuell eintragen.
- **Eingabe:** `74412`, `DOC-74412`, `DOC 74412` oder der FiveNet-Link werden einheitlich als `DOC - 74412` gespeichert. Alles andere (z. B. ein Aktenzeichen ohne FiveNet-Dokument) bleibt wie eingegeben und wird nicht verlinkt.
- **Link:** `DOC - <Nummer>` ist in der Druckansicht, im PDF („Als PDF speichern“) und im Google Doc ein Link – Sachbearbeiter klicken darauf und öffnen die Akte direkt in FiveNet. Die Adresse wird immer aus der FiveNet-Instanz der Kanzlei (Einstellungen) und der Nummer gebaut, nie aus dem eingegebenen Text. Ob jemand das Dokument sehen darf, entscheidet wie immer FiveNet selbst (Anmeldung mit dem eigenen Charakter) – die Kanzlei greift dabei nicht auf FiveNet zu.
- **Bestehende Dokumente** bleiben unverändert. Die mitgelieferten Antragsvorlagen werden beim Start automatisch umgestellt, sofern sie nicht selbst geändert wurden; eigene Vorlagen können den Platzhalter `{{fivenet_az}}` verwenden.

## Ränge

Es gibt genau sechs Ränge (Benutzer, Team-Profile und Einstellung von Bewerbern bieten nur diese zur Auswahl):

| Board of Partners | Associate Attorneys |
|---|---|
| Founding Partner | Senior Associate |
| Equity Partner | Associate |
| Partner | Junior Associate |

**Vor Gericht gibt es keine Unterschiede:** Jeder Anwalt darf – unabhängig vom Rang – vor jedem Gericht verteidigen und vertreten. Die Ränge regeln Verantwortung, Führung und Erfahrung (so steht es auch auf der Website unter „Kanzleiränge“).

**Board of Partners** ist zugleich die Leitung der Kanzlei: Die Dashboard-Rolle „Board of Partners“ (Admin) sieht den gleichnamigen Menübereich (Bewerbungen, Team, Benutzer, Aktenbearbeitung, Honorarordnung, Protokoll, Einstellungen). Die Auswertung „Aktenbearbeitung“, die eingegangenen Anliegen und die **Bewerbungen** (inkl. Stellenausschreibungen) sehen außerdem Konten mit Partner-Rang. Einstellen dürfen sie Bewerber als Anwalt/Mitarbeiter bis zum eigenen Rang; Admin-Konten anlegen und Bewerbungen löschen bleibt der Rolle „Board of Partners“ vorbehalten. Der Rang selbst vergibt keine Admin-Rechte – dafür im Menü „Benutzer“ die Rolle „Board of Partners“ wählen. Ältere Ränge „Managing Partner“ und „Managing Partner / Kanzleileitung“ wurden beim Update einmalig zu „Founding Partner“.

## Rollen und Rechte

| | Mandant | Anwalt | Board of Partners (Admin) |
|---|---|---|---|
| Akten sehen | eigene | alle | alle |
| Akte bearbeiten | – | zugewiesene (federführend oder als weiterer Anwalt) | alle |
| Mandanten-Konto mit Akte verknüpfen / lösen | – | zugewiesene Akten (Partner-Rang: alle) | alle |
| Unbesetzte Akte übernehmen | – | ja | ja / zuweisen |
| Weitere Anwälte zuweisen | – | als federführender Anwalt; eigene Mitarbeit beenden | ja |
| Mandatsverträge | eigene ansehen und unterschreiben | erstellen/bearbeiten in zugewiesenen Akten, als genannter Anwalt unterschreiben, Mandanten-Unterschrift erfassen | alles, Vorlagen pflegen, Unterschriften zurücksetzen |
| Schriftsätze (Vollmacht, Akteneinsicht, Haftbeschwerde …) | freigegebene ansehen, Vollmacht unterschreiben | erstellen/bearbeiten in zugewiesenen Akten, unterschreiben, freigeben bzw. auf intern stellen | alles, Vorlagen pflegen |
| Interne Notizen | – | ja | ja |
| Kalender | eigene Termine anfragen/absagen | alles | alles |
| Kanzlei-Post | an die Kanzlei | an alle + Rundschreiben | an alle + Rundschreiben |
| Rechnungen | eigene ansehen/drucken, „überfällig“ sehen | erstellen, Status, Zahlungserinnerung senden | erstellen, Status, Zahlungserinnerung, Erinnerungs-Tage einstellen, löschen |
| Kooperationen (Rabatte) | eigene Vorteile im Profil | in Rechnungen anwenden | anlegen, Rollen, Konten zuordnen (Partner-Rang ebenso) |
| VIP & Lifetime | anfragen (Startseite/Portal), eigene Mitgliedschaft im Profil | in Rechnungen anwenden, Badge sehen | Stufen/Preise/Rabatte, vergeben, verlängern, beenden (Partner-Rang ebenso) |
| Namensänderung | beantragen | beantragen | eigenen Namen direkt ändern, Namen von Mandanten direkt korrigieren; Anträge anderer genehmigen/ablehnen (Partner-Rang ebenso) |
| Beweismittel | eigene hochladen, öffentliche ansehen | alles (auch intern) | alles |
| Externe Dokumente (FiveNet, Google Docs, Google Sheets) | freigegebene ansehen, Abschrift herunterladen | verknüpfen, Bilder übernehmen; eigene bzw. in zugewiesenen Akten bearbeiten/entfernen | alles |
| Aufgaben & Wiedervorlagen | – | alle ansehen, anlegen, abhaken; eigene/zugewiesene löschen | alles |
| Stempeluhr | – | eigene Zeiten | alle Zeiten, Korrekturen |
| Anliegen ans Board (auch ohne Konto über die Startseite) | eigene einreichen (auch anonym), Antworten lesen | eigene einreichen (auch anonym), Antworten lesen | zusätzlich „Eingegangene Anliegen“: alle ansehen, antworten, interne Notizen, Status/Zuständigkeit (Partner-Rang ebenso) |
| Beförderungen & Einstellungen | – | ansehen | ansehen, befördern (Partner-Rang: bis zum eigenen Rang), Einträge entfernen |
| Bewerbungen & Stellenausschreibungen | – | nur mit Partner-Rang (einstellen bis zum eigenen Rang, ohne Admin-Rolle, nicht löschen) | ja |
| Akten löschen, Papierkorb (wiederherstellen, endgültig löschen) | – | – | ja |
| Mandantenstimmen | abgeschlossene eigene Akten bewerten, eigene Bewertung ändern/löschen | – | freigeben, ablehnen, löschen (Partner-Rang ebenso) |
| Team, Benutzer, Honorarordnung, Protokoll, Einstellungen | – | – | ja |

## Sicherheit

- Passwörter mit bcrypt, Mindestlänge 10 · Session-Cookie `httpOnly`, `SameSite=Lax`, in Produktion `Secure`
- **Angemeldete Geräte:** *Mein Profil* zeigt, auf wie vielen weiteren Geräten/Browsern man angemeldet ist; „Auf allen anderen Geräten abmelden“ beendet diese Anmeldungen (das aktuelle Gerät bleibt angemeldet, Eintrag im Protokoll). Eine Passwortänderung meldet ebenfalls alle anderen Geräte ab.
- CSRF: SameSite-Cookie + Origin-Prüfung bei schreibenden Anfragen
- Rate-Limits auf Login, Registrierung, Mandatsanfrage, Discord-Beitritt und Nachrichten · Honeypot gegen Spam-Formulare
- Fremde Akten liefern 404 statt 403 · Discord-Beitritt ohne Konto nur mit Aktenzeichen + 6-stelligem Pin aus der Antwort auf das eingereichte Mandat
- Alle Nutzertexte werden im Frontend escaped (XSS) · Discord-Nachrichten pingen nie `@everyone`
- FiveNet: keine Passwörter, keine Sitzungs-Tokens, kein Scraping · „In FiveNet öffnen“ und „DOC - Nummer“ in Anträgen verlinken immer auf die aus Instanz und Dokument-ID gebaute Adresse, nie auf die eingefügte
- Discord-Bot: jede Interaktion ist von Discord signiert (`DISCORD_PUBLIC_KEY`), Bot-Token nur in Render · `/passwort` schickt das Einmal-Passwort ausschließlich per Direktnachricht an das verknüpfte Discord (nie in einen Kanal), beendet alle Sitzungen und erzwingt ein eigenes Passwort beim Login
- **Content-Security-Policy (streng):** Skripte nur als Dateien von der eigenen Domain (kein CDN, keine Inline-Skripte, keine `onclick`-Attribute – eingeschleuster Skriptcode würde vom Browser nicht ausgeführt), keine Plugins, keine fremden Frames, Formulare nur an die eigene Seite bzw. die Discord-Anmeldung; Google Fonts und Bilder (z. B. Discord-Avatare) weiterhin erlaubt · Antworten werden komprimiert (gzip) ausgeliefert
- Google Docs (optional): nur Zugriff auf selbst angelegte Dateien (`drive.file`), Refresh-Token verschlüsselt nur auf dem Server, Docs nur „Jeder mit dem Link – Betrachter“
- Datensicherungen enthalten keine Login-Sitzungen; Herunterladen nur für die Rolle „Board of Partners“ (Admin)
- Bitte nur **In-Character-Daten** speichern und keine echten Passwörter wiederverwenden

## Projektstruktur

```
server.js        App-Setup, Routen, Start
db.js            SQLite-Schema, Migrationen, Helfer, Wiederherstellen aus restore.db
backup.js        Tägliche Datensicherung (backups/), Aufbewahrung, Download für das Board
mediaBackup.js   Bilder als .tar.gz sichern, Sicherungen hochladen und einspielen (restore.db, Bilder-Archiv)
systemAlerts.js  Systemwarnungen ans Board (Bot offline, Sicherung, Speicher, Absturz), einmal je Störung mit Entwarnung
paymentReminders.js  Zahlungserinnerungen: überfällige Rechnungen einmal automatisch, „Erinnern“ von Hand (Discord-DM + Ticket)
trash.js         Papierkorb für Akten: Momentaufnahme beim Löschen, Wiederherstellen, endgültig löschen nach 30 Tagen
docxRender.js    Word-Dateien im Layout der Druckansichten (Rechnung, Vertrag/Schriftsatz, Aktenauszug) – Grundlage der Google Docs
googleDrive.js   Google Drive über das Kanzlei-Konto: Anmeldung (nur drive.file), verschlüsselter Token, Docs anlegen/teilen/neu schreiben
googleDocs.js    Google Docs je Dokument: anlegen, bei Änderungen automatisch neu schreiben, Papierkorb, Nachholen nach Störungen
scripts/         build-css.js (Tailwind fest bauen: npm run build:css), seed-admin.js
test/            npm test: api, static, browser, google (mit googleStub.js), discord (mit discordStub.js), docx, schriftsatz – helpers.js startet den Server mit frischer Test-Datenbank
.github/workflows/test.yml  GitHub-Prüfung: alle Tests bei jedem Pull Request
auth.js          Sessions, Passwörter, Rollen-Middleware
bootstrap.js     Team-Seed, Notfall-Admin, Passwort-Reset, Datenmigration
discord.js       Webhooks & OAuth2
tickets.js       Discord-Tickets: je Akte ein privater Kanal (Bot, REST-API)
discordBot.js    Kanzlei-Bot: Gateway-Verbindung, Rang-Sync, Role Connections, Join- & Standardrollen, Willkommen & Abschied
botMessages.js   Kanzlei-Bot: Nachrichten-Vorlagen (Embed, Buttons), Senden/Aktualisieren, Zeitplan, alle X Nachrichten
botDm.js         Kanzlei-Bot: Vorlage per Direktnachricht an alle Mitglieder einer Rolle, optional mit Website-Zugang
botCommands.js   Befehle des Kanzlei-Bots (/passwort, /akte, /notiz, /dienst, /imdienst, /termine, /hilfe), Antworten als Embed
cooperations.js  Kooperationen: Rabatt-Erkennung über Discord-Rollen bzw. zugeordnete Konten
memberships.js   VIP & Lifetime: aktive Mitgliedschaft, Discord-Rolle, Ablauf und Erinnerung
fivenet.js       FiveNet: Schnittstellenprüfung, Link-Erkennung, Instanz-Einstellung
gdocs.js         Google Docs: Link-Erkennung, Export freigegebener Dokumente, Bildadressen
gsheets.js       Google Sheets: Link-Erkennung, CSV-Export freigegebener Tabellenblätter
contracts.js     Vertragsvorlagen: Standard-Mandatsvertrag, Platzhalter
remote.js        Abrufe externer Quellen mit Zeit-, Größen- und Weiterleitungsgrenzen
uploads.js       Bild-Uploads (Formatprüfung anhand der Dateisignatur)
helpers.js       Konstanten, Validierung
models.js        Datenabfragen, Zeilen-Mapping, Zugriffsregeln, Protokoll
routes/          auth, cases, search, reviews, google, calendar, messages, board, invoices, fees, team, admin, discord, public, duty, applications, fivenet, external, tasks, concerns, personnel, tickets, interactions, cooperations, memberships, nameRequests
public/          index.html, karriere.html, login.html, register.html, dashboard.html, invoice.html, vertrag.html, aktenauszug.html, css/ (app.css, tailwind.css), js/
public/js/       je Seite ein Skript (home.js, login.js, register.js, karriere.js, invoice.js, vertrag.js, aktenauszug.js, gdoc.js …) – Bedienelemente per data-act/addEventListener statt onclick
public/js/dashboard/  das Dashboard in 12 Teilen (01-basis … 12-start), von dashboard.html in dieser Reihenfolge geladen
```
