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
| **FiveNet-Dokumente** | In der Akte „FiveNet-Dokument hinzufügen“ → Link einfügen → Dokument-ID wird live erkannt · Warnung bei Dubletten, Querverweis „auch verknüpft mit PS-…“ · Titel, Dokumentart, Erstellungsdatum, Verfasser, Kurzinhalt · intern oder für den Mandanten sichtbar · „In FiveNet öffnen“ und „Zitat kopieren“ · Aktensuche per FiveNet-Link oder Dokument-ID (siehe [FiveNet-Integration](#fivenet-integration)) |
| **Aufgaben & Wiedervorlagen** | Aufgaben mit Fälligkeitsdatum, Zuständigkeit und Notiz – mit oder ohne Aktenbezug · Checklisten je Rechtsgebiet per Klick in die Akte übernehmen · Erledigt-Vermerk im Aktenverlauf · Zähler fälliger Aufgaben in der Navigation · Discord-Erwähnung bei Zuweisung |
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
| Öffentliche Endpunkte | `/api/ping`, `/api/version`, `/api/config` – ohne Personen- oder Dokumentdaten | Nur `/api/version` für die Erreichbarkeitsprüfung |

### Umsetzung

Weil FiveNet keine delegierte Freigabe für Drittanwendungen anbietet, speichert die Kanzlei FiveNet-Dokumente als **geprüfte externe Referenz** – ausdrücklich ohne Passwort-Abfrage, ohne Sitzungs-Cookies, ohne Browser-Automatisierung und ohne Scraping.

1. **Link erkennen:** Nur Adressen der konfigurierten Instanz werden angenommen (auch ohne `https://`, mit `/edit`, `?…` oder `#…`, oder nur die Zahl). Andere Hosts, andere FiveNet-Seiten und nicht-numerische IDs werden mit einer klaren Meldung abgelehnt.
2. **Berechtigung:** Die Kanzlei greift nie selbst auf FiveNet zu und kann deshalb keine FiveNet-Rechte umgehen. Wer verknüpft, bestätigt, das Dokument mit dem eigenen Charakter geöffnet zu haben; optional wird festgehalten, mit welchem Charakter („eingesehen als“, eigene Angabe). So bleibt nachvollziehbar, welcher Charakter Einsicht hatte – auch wenn jemand mehrere Charaktere nutzt.
3. **Gespeichert werden:** Quelle FiveNet, originale Adresse, normalisierte Adresse, Dokument-ID, verknüpfende Person, Datum und Uhrzeit sowie die Angaben des Anwalts (Titel, Dokumentart, Erstellungsdatum, Verfasser, Kurzinhalt). Der Inhalt bleibt in FiveNet – nichts wird dupliziert. Dasselbe Dokument kann pro Akte nur einmal verknüpft werden.
4. **Nachvollziehbar:** Verknüpfen, Sichtbarkeitswechsel und Entfernen landen im Aktenverlauf und im Protokoll.
5. **Verbindungsstatus:** Unter *Mein Profil* zeigt „FiveNet-Verbindung“ den tatsächlichen Stand (Account nicht verbindbar, Charakter nicht abrufbar, Referenz-Modus) statt einer vorgetäuschten Verbindung.

Adresse der Instanz: Dashboard → *Einstellungen* → *FiveNet* (oder Umgebungsvariable `FIVENET_URL`, Standard `https://fivenet.modernv.net`). Dort lässt sich auch die Erreichbarkeit prüfen. Bietet FiveNet später eine offizielle, delegierte Anmeldung an, wird sie in `fivenet.js` ergänzt (dort steht auch die vollständige Prüfung).

## Rollen und Rechte

| | Mandant | Anwalt | Kanzleileitung (Admin) |
|---|---|---|---|
| Akten sehen | eigene | alle | alle |
| Akte bearbeiten | – | zugewiesene | alle |
| Unbesetzte Akte übernehmen | – | ja | ja / zuweisen |
| Interne Notizen | – | ja | ja |
| Kalender | eigene Termine anfragen/absagen | alles | alles |
| Kanzlei-Post | an die Kanzlei | an alle + Rundschreiben | an alle + Rundschreiben |
| Rechnungen | eigene ansehen/drucken | erstellen, Status | erstellen, Status, löschen |
| Beweismittel | eigene hochladen, öffentliche ansehen | alles (auch intern) | alles |
| FiveNet-Dokumente | freigegebene ansehen | verknüpfen; eigene bzw. in zugewiesenen Akten bearbeiten/entfernen | alles |
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
uploads.js       Bild-Uploads (Formatprüfung anhand der Dateisignatur)
helpers.js       Konstanten, Validierung
models.js        Datenabfragen, Zeilen-Mapping, Zugriffsregeln, Protokoll
routes/          auth, cases, calendar, messages, board, invoices, fees, team, admin, discord, public, duty, applications, fivenet, tasks
public/          index.html, karriere.html, login.html, register.html, dashboard.html, invoice.html, css/, js/
```
