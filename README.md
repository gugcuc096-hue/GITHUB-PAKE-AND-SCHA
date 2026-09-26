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
| **Rechnungen & Honorare** | Generator mit Positionen aus der Honorarordnung, Rabatt/Zuschlag, Rechnung **oder** Honorarvereinbarung, Druck-/PDF-Ansicht, Status offen/bezahlt/storniert |
| **Team-Verwaltung** (Admin) | Mitglieder hinzufügen, umbenennen, Rang/Beschreibung ändern, sortieren, ausblenden, löschen – sofort live auf der Website · optional mit Login-Konto (Einmal-Passwort) |
| **Benutzer** (Admin) | Rollen, Ränge, Sperren, Löschen, **Passwort-Reset per Klick** |
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
| **Mehrere Anwälte pro Akte** | Ein federführender Anwalt plus beliebig viele weitere Anwälte (bis zu 10) · alle zuständigen Anwälte dürfen die Akte bearbeiten und sehen sie unter „Meine Akten“ · das Team stellen der federführende Anwalt und die Kanzleileitung zusammen, weitere Anwälte können ihre Mitarbeit selbst beenden · gibt der federführende Anwalt ab, übernimmt der nächste · Discord-Ereignis „Anwalt einer Akte zugewiesen“ pingt die neu zugewiesenen Anwälte · Mandant und öffentliche Statusabfrage zeigen alle zuständigen Anwälte |
| **Mandatsverträge** | In der Akte „Mandatsvertrag erstellen“ → Vorlage der Kanzlei wird mit Anwalt (Name, Rang), Mandant, Honorar, Datum und Ort gefüllt (Vorbelegung aus Akte und früheren Verträgen, Honorar-Vorschläge aus der Honorarordnung) · Druckansicht im Layout der Kanzleivorlage (Kopfzeile auf jeder Seite, PDF über den Druckdialog) · **Unterschriften:** der genannte Anwalt unterschreibt digital, der Mandant im Portal (Name eintippen) – oder die Kanzlei erfasst die Unterschrift im Spiel · nach der ersten Unterschrift gesperrt · Verlauf und Discord-Ereignis „Mandatsvertrag unterschrieben“ · **mehrere Leistungen aus der Honorarordnung** (mit Menge) wählbar – die Summe wird automatisch zur Grundgebühr, die Leistungen stehen einzeln im Vertrag · Vorlagen unter Einstellungen → Vertragsvorlagen bearbeiten (siehe [Mandatsverträge](#mandatsverträge)) |
| **Abmeldungen** | Unter „Dienstzeiten“ (oder im Dienst-Menü oben) „Abmelden“: Zeitraum, Grund (Urlaub, Krankheit, Privat, OOC, Sonstiges), Notiz · das Team sieht aktuelle und geplante Abmeldungen, die Übersicht zeigt „Heute abgemeldet“ · „Zurückmelden“ beendet eine Abmeldung vorzeitig, „Zurückziehen“ entfernt sie · Kanzleileitung kann andere abmelden · Discord-Ereignis „Abmeldung / Rückmeldung“ (eigener Kanal und Rollen-Ping einstellbar) |
| **Aktenbearbeitung** (nur Board of Partners) | Automatische Erfassung, wer welche Akte bearbeitet (federführend oder weiterer Anwalt) und wie lange – bei Zuweisung, Abgabe, Mitarbeit beenden, Schließen und Wiedereröffnen · Ansicht „Aktenbearbeitung“: laufende und abgeschlossene Bearbeitungen je Mitarbeiter, Ø Dauer, Akten nach Bearbeitungsdauer, Zeitraum 7 Tage bis alles · in jeder Akte „Bearbeitungszeiten“ · ältere Akten werden aus dem Aktenverlauf geschätzt (≈) |
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

**Webhook (Kanzlei-Updates):** Discord-Kanal → Einstellungen → Integrationen → Webhooks → URL kopieren → Dashboard → *Einstellungen* → einfügen → „Testnachricht“. Dort lässt sich auch wählen, welche Ereignisse gemeldet werden.

**Discord-Login / Konto verknüpfen:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application*
2. *OAuth2* → Redirect `https://<ihre-domain>/api/discord/callback` hinzufügen
3. In Render `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` und `PUBLIC_URL` setzen → deployen
4. Jeder Nutzer verknüpft sein Konto unter *Mein Profil* und kann sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Zuweisungen und Fristen im Kanal erwähnt.

## Lokal starten

```bash
npm install
cp .env.example .env    # Werte nach Bedarf ausfüllen
npm run dev             # http://localhost:3000
```

## Update einer bestehenden Installation

Beim ersten Start der neuen Version passiert automatisch:
- **Sicherungskopie** der Datenbank (`pake-scha.db.backup-<Datum>`) vor jedem Tabellen-Umbau
- Umbau der Tabellen `cases`, `appointments` und `notes` ohne Datenverlust (Akten, Notizen, Termine, Nachrichten bleiben erhalten)
- Einmalige Korrektur „Dr. Alois Parker“ → „Dr. Alois Pake“: Die Login-E-Mail wird zu `alois.pake@pake-scha.ls`, das Passwort bleibt gleich
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
3. **Unterschreiben:** Der im Vertrag genannte Anwalt unterschreibt selbst. Der Mandant unterschreibt im Portal, indem er seinen Namen eintippt (muss zum Namen im Vertrag passen) – oder die Kanzlei erfasst „Mandant hat im Spiel unterschrieben“ (mit Namen des Erfassenden im Verlauf). Nach der ersten Unterschrift ist der Inhalt gesperrt; die Kanzleileitung kann Unterschriften zurücksetzen.
4. **Vorlagen pflegen:** Einstellungen → Vertragsvorlagen (Kanzleileitung): Text bearbeiten, weitere Vorlagen anlegen (z. B. Vollmacht), Vorschau mit Beispielwerten, „Original wiederherstellen“. Bestehende Verträge behalten den Text, mit dem sie erstellt wurden.

Formatierung der Vorlagen: `# Titel`, `## Abschnitt`, `### § Überschrift`, `1. nummerierter Absatz`, `| zentrierte Zeile`, vier Leerzeichen = eingerückt, `**fett**`, `*kursiv*`, `===` neue Seite, `[Unterschriften]` Unterschriftsfeld. Platzhalter: `{{anwalt}}`, `{{anwalt_rang}}`, `{{anwalt_geburtsdatum}}`, `{{mandant}}`, `{{mandant_geburtsdatum}}`, `{{leistungen}}` (gewählte Leistungen, je Zeile eine), `{{grundgebuehr}}`, `{{zusatzgebuehr}}`, `{{datum}}`, `{{ort}}`, `{{aktenzeichen}}`, `{{akte}}`, `{{rechtsgebiet}}`, `{{kanzlei}}`.

## Ränge

Es gibt genau sechs Ränge (Benutzer, Team-Profile und Einstellung von Bewerbern bieten nur diese zur Auswahl):

| Board of Partners | Associate Attorneys |
|---|---|
| Founding Partner | Senior Associate |
| Equity Partner | Associate |
| Partner | Junior Associate |

Das **Board of Partners** sieht zusätzlich die Auswertung „Aktenbearbeitung“. Der Rang ist unabhängig von der Dashboard-Rolle (Mandant / Anwalt / Kanzleileitung), die die Rechte im Dashboard steuert. Ältere Ränge „Managing Partner“ und „Managing Partner / Kanzleileitung“ wurden beim Update einmalig zu „Founding Partner“.

## Rollen und Rechte

| | Mandant | Anwalt | Kanzleileitung (Admin) |
|---|---|---|---|
| Akten sehen | eigene | alle | alle |
| Akte bearbeiten | – | zugewiesene (federführend oder als weiterer Anwalt) | alle |
| Unbesetzte Akte übernehmen | – | ja | ja / zuweisen |
| Weitere Anwälte zuweisen | – | als federführender Anwalt; eigene Mitarbeit beenden | ja |
| Mandatsverträge | eigene ansehen und unterschreiben | erstellen/bearbeiten in zugewiesenen Akten, als genannter Anwalt unterschreiben, Mandanten-Unterschrift erfassen | alles, Vorlagen pflegen, Unterschriften zurücksetzen |
| Interne Notizen | – | ja | ja |
| Kalender | eigene Termine anfragen/absagen | alles | alles |
| Kanzlei-Post | an die Kanzlei | an alle + Rundschreiben | an alle + Rundschreiben |
| Rechnungen | eigene ansehen/drucken | erstellen, Status | erstellen, Status, löschen |
| Beweismittel | eigene hochladen, öffentliche ansehen | alles (auch intern) | alles |
| Externe Dokumente (FiveNet, Google Docs, Google Sheets) | freigegebene ansehen, Abschrift herunterladen | verknüpfen, Bilder übernehmen; eigene bzw. in zugewiesenen Akten bearbeiten/entfernen | alles |
| Aufgaben & Wiedervorlagen | – | alle ansehen, anlegen, abhaken; eigene/zugewiesene löschen | alles |
| Stempeluhr | – | eigene Zeiten | alle Zeiten, Korrekturen |
| Team, Bewerbungen, Benutzer, Honorarordnung, Protokoll, Einstellungen | – | – | ja |

## Sicherheit

- Passwörter mit bcrypt, Mindestlänge 10 · Session-Cookie `httpOnly`, `SameSite=Lax`, in Produktion `Secure`
- CSRF: SameSite-Cookie + Origin-Prüfung bei schreibenden Anfragen
- Rate-Limits auf Login, Registrierung, Mandatsanfrage, Statusabfrage und Nachrichten · Honeypot gegen Spam-Formulare
- Fremde Akten liefern 404 statt 403 · Aktenstatus nur mit 6-stelligem Aktenpin
- Alle Nutzertexte werden im Frontend escaped (XSS) · Discord-Nachrichten pingen nie `@everyone`
- FiveNet: keine Passwörter, keine Sitzungs-Tokens, kein Scraping · „In FiveNet öffnen“ verlinkt immer auf die aus Instanz und Dokument-ID gebaute Adresse, nie auf die eingefügte
- Bitte nur **In-Character-Daten** speichern und keine echten Passwörter wiederverwenden

## Projektstruktur

```
server.js        App-Setup, Routen, Start
db.js            SQLite-Schema, Migrationen, Helfer
auth.js          Sessions, Passwörter, Rollen-Middleware
bootstrap.js     Team-Seed, Notfall-Admin, Passwort-Reset, Datenmigration
discord.js       Webhooks & OAuth2
fivenet.js       FiveNet: Schnittstellenprüfung, Link-Erkennung, Instanz-Einstellung
gdocs.js         Google Docs: Link-Erkennung, Export freigegebener Dokumente, Bildadressen
gsheets.js       Google Sheets: Link-Erkennung, CSV-Export freigegebener Tabellenblätter
contracts.js     Vertragsvorlagen: Standard-Mandatsvertrag, Platzhalter
remote.js        Abrufe externer Quellen mit Zeit-, Größen- und Weiterleitungsgrenzen
uploads.js       Bild-Uploads (Formatprüfung anhand der Dateisignatur)
helpers.js       Konstanten, Validierung
models.js        Datenabfragen, Zeilen-Mapping, Zugriffsregeln, Protokoll
routes/          auth, cases, calendar, messages, board, invoices, fees, team, admin, discord, public, duty, applications, fivenet, external, tasks
public/          index.html, karriere.html, login.html, register.html, dashboard.html, invoice.html, css/, js/
```
