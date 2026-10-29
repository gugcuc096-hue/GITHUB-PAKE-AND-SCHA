# Integrationen – Einrichtung und Details

Ausgelagert aus der [README](../README.md): Discord (Bot, Rang-Sync, Willkommen), FiveNet und Google (Docs, Sheets, Ausgabe von Rechnungen, Verträgen und Schriftsätzen).

## Discord einrichten (optional)

**Webhook (Kanzlei-Updates):** Discord-Kanal → Einstellungen → Integrationen → Webhooks → URL kopieren → Dashboard → *Einstellungen → Discord → Webhook (Meldungen)* → einfügen → „Testnachricht“. Dort lässt sich auch wählen, welche Ereignisse gemeldet werden – und je Ereignis ein eigener Kanal (eigener Webhook) und eine Rolle zum Pingen. Neu hinzugekommene Ereignisse (z. B. „Neues Anliegen an das Board of Partners“ oder „Beförderung / Einstellung“) sind bei bestehender Auswahl zunächst aus und müssen dort einmal angehakt werden – ausgenommen die **Systemwarnungen**, **„Mandant meldet eine Rechnung als bezahlt“** und **„Liegengebliebene Akte“** (nur wenn die DM an den Anwalt nicht möglich ist), die ab sofort an sind, bis jemand sie abwählt.

**Systemwarnungen ans Board:** Das Ereignis „Systemwarnung“ meldet Störungen – am besten in einen eigenen Kanal (z. B. *#system*, nur Board) mit Rollen-Ping für das Board:

| Störung | Wann | Entwarnung |
|---|---|---|
| Kanzlei-Bot offline | eingeschaltet, aber seit 15 Minuten nicht verbunden (inkl. Grund, z. B. ungültiger Token oder fehlender Intent) | wieder verbunden (wird der Bot ausgeschaltet, endet die Warnung ohne Meldung) |
| Datensicherung fehlgeschlagen | die tägliche Sicherung klappt nicht (z. B. Disk voll) – der Server versucht es stündlich weiter | Sicherung wieder angelegt |
| Sicherung im Google Drive fehlgeschlagen | die Kopie ins Google Drive klappt dreimal hintereinander nicht (stündliche Versuche); eine abgelaufene Google-Verbindung meldet schon „Google Docs: Verbindung getrennt“ | Kopie wieder hochgeladen |
| Speicher fast voll | weniger als 300 MB frei auf der Disk | wieder über 400 MB frei |
| Server abgestürzt | beim Neustart nach einem Absturz (mit Fehlermeldung, falls bekannt); Deploys und Neustarts über Render lösen nichts aus | – |

Jede Störung wird **einmal** gemeldet (auch über Neustarts hinweg), nicht wiederholt. Solange eine Störung besteht, zeigt die Übersicht des Dashboards dem Board zusätzlich einen roten Hinweis. Fehlertexte werden ohne Links und lange Zeichenketten gesendet, damit nie ein Zugangsschlüssel in Discord landet.

**Discord-Login / Konto verknüpfen:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application*
2. *OAuth2* → Redirect `https://<ihre-domain>/api/discord/callback` hinzufügen
3. In Render `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` und `PUBLIC_URL` setzen → deployen
4. Jeder Nutzer verknüpft sein Konto unter *Mein Profil* und kann sich danach per Discord anmelden. Verknüpfte Anwälte werden bei Zuweisungen und Fristen im Kanal erwähnt.
5. Damit ist auch **„Mit Discord registrieren“** aktiv (Registrierungsseite und „Konto mit Discord anlegen“ nach einer Mandatsanfrage) – dieselbe Redirect-URL, nichts weiter einzurichten. Konten, die so entstehen, haben kein bekanntes Passwort (Anmeldung per Discord, bei Bedarf Einmal-Passwort per `/passwort`). Wer sich mit Discord anmelden will, aber noch kein Konto hat, wird auf der Login-Seite gefragt, bevor ein Konto angelegt wird.

**Discord-Tickets – zwei Kategorien:** Mandats-Tickets (je Akte, mit Mandant) landen in der Kategorie für Mandate (z. B. „Mandatsanfragen“); **Board-Tickets** (je Bewerbung und je Anliegen ans Board) in einer eigenen Kategorie (z. B. „Board of Partners“), sichtbar nur für die Board-Rolle(n) und die Board-Mitglieder (Rolle „Board of Partners“ oder Partner-Rang) mit verknüpftem Discord – normale Anwälte sehen sie nicht. Beide Arten haben ein eigenes (optionales) Archiv und lassen sich einzeln ein- und ausschalten (Einstellungen → Discord → Tickets).

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
| Mandatsvertrag | erstellt (mit Knopf **„Lesen & unterschreiben“** für den Mandanten), vom Anwalt / Mandanten / vollständig unterschrieben |
| Rechnung / Honorarvereinbarung zur Akte | Nummer, Betrag, Fälligkeit |
| Zahlungserinnerung | Rechnung, Betrag, seit wann überfällig, Zahlungshinweis – der Mandant wird erwähnt |
| Zahlung gemeldet (Mandant) | „Zahlung gemeldet“ mit Betrag und Hinweis des Mandanten – die Anwälte werden erwähnt; danach „Zahlung eingegangen“ bzw. „Zahlung noch nicht eingegangen“ (Mandant wird erwähnt) |
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
- **Ping-Pause** (Einstellungen → Discord → Tickets → „Pings in Mandats-Tickets“): Dieselbe Person wird im selben Ticket höchstens einmal pro Stunde erwähnt (Standard). Wählbar: 30 Minuten, 3 Stunden, einmal am Tag, bei jeder Nachricht oder gar nicht (nur beim Eröffnen). Die Nachrichten selbst erscheinen immer; nach einem Neustart des Servers kann höchstens ein Ping zusätzlich kommen.

**Nie im Ticket:** interne Notizen, interne Anhänge, Aufgaben, interne Termine, Telefonnummern – der Mandant liest mit. Nachrichten, die im Discord-Kanal geschrieben werden, landen nur in der Akte, wenn „Antworten aus dem Ticket“ eingeschaltet ist (siehe unten) – sonst ist es eine Einbahnstraße Website → Discord.

**Antworten aus dem Ticket im Chat der Akte (optional):** Was der Mandant oder ein Anwalt bzw. Board-Mitglied im Akten-Ticket schreibt, erscheint auch unter „Nachrichten“ in der Akte (mit „über Discord“; Erwähnungen lesbar, Anhänge als Link) und zählt dort als neu. Nicht übernommen werden Bots, Webhooks, per `/add` hinzugefügte Personen, Board-Tickets und Systemnachrichten; was auf der Website geschrieben wird, kommt nie doppelt. Einrichtung:
1. [discord.com/developers/applications](https://discord.com/developers/applications) → eure App → *Bot* → „Privileged Gateway Intents“ → **MESSAGE CONTENT INTENT** einschalten → *Save Changes*.
2. Dashboard → *Einstellungen* → *Discord* → *Tickets* → „Antworten aus dem Ticket“ anhaken → speichern. Der Bot verbindet sich dann mit dem Nachrichten-Intent neu.

Ist der Intent im Developer Portal nicht eingeschaltet, lehnt Discord die Verbindung ab: Die Website schaltet dann nur diese Übernahme wieder aus, zeigt den Grund in den Einstellungen und verbindet sich ohne sie neu – Rang-Sync, Willkommen und alle anderen Module laufen weiter.

**Vertrag in Discord unterschreiben:** Funktioniert, sobald die Ticket-Buttons funktionieren (`DISCORD_PUBLIC_KEY` in Render und „Interactions Endpoint URL“ im Developer Portal, siehe *Buttons im Ticket*). Der Knopf „Lesen & unterschreiben“ erscheint unter jedem neuen Mandatsvertrag (und Schriftsatz mit Unterschrift des Mandanten) im Ticket der Akte.

**Wer ist im Ticket?** Die eingestellten Team-Rollen (z. B. „Anwälte“), zusätzlich die zuständigen Anwälte mit verknüpftem Discord und der **Mandant – automatisch**, sobald
- sein Portal-Konto mit Discord verknüpft ist (*Mein Profil → Discord verbinden*; alle seine Akten), oder
- er direkt nach dem Einreichen eines Mandats auf der Website „**Discord-Ticket beitreten**“ klickt (ohne Konto, Discord-Anmeldung mit Bestätigung), oder
- die Kanzlei ihn im Ticket mit `/add` hinzufügt.

Eine öffentliche Aktenstatus-Abfrage (Aktenzeichen + Pin) gibt es nicht mehr; den Stand sehen Mandanten im Portal und im Discord-Ticket.

Ist er noch nicht auf dem Discord-Server, fügt der Bot ihn beim Verknüpfen automatisch hinzu (Discord fragt dafür einmal um Erlaubnis, „guilds.join“). In der Akte zeigt das Dashboard den Ticket-Status („Mandant im Ticket“, „In Discord öffnen“, „Abgleichen“).

**Einrichtung:**
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **dieselbe App wie beim Discord-Login** → *Bot* → „Reset Token“ → Token kopieren. (Nur mit derselben App kann der Bot Mandanten dem Server hinzufügen.)
2. In Render unter *Environment* `DISCORD_BOT_TOKEN` setzen → deployen. Der Token steht nur dort – nie in der Datenbank, im Code oder im Browser.
3. Dashboard → *Einstellungen* → Reiter *Discord* → *Tickets* → „Einladungslink“ öffnen und den Bot auf den Server einladen (enthält die nötigen Rechte: Kanäle verwalten, Berechtigungen verwalten, Nachrichten senden/verwalten, Links einbetten, Dateien anhängen, Verlauf lesen, Rollen erwähnen, Einladung erstellen).
4. In Discord eine Kategorie für Tickets anlegen (z. B. „Mandate“), optional eine fürs Archiv. IDs kopieren (Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick → „ID kopieren“).
5. Server-ID, Kategorie(n) und Team-Rolle(n) eintragen, „Discord-Tickets einschalten“, speichern, **„Verbindung testen“** (prüft Token, Server, Rechte des Bots, Rollen und Kategorien).
6. Für Board-Tickets zusätzlich die Kategorie „Board of Partners“ (optional ein Board-Archiv) und die Board-Rolle eintragen.
7. „Offene nachholen“ legt Tickets für alle bestehenden offenen Akten, Bewerbungen und Anliegen an.

Wird ein Ticket-Kanal von Hand in Discord gelöscht, legt der Bot beim nächsten Ereignis automatisch einen neuen an (mit `/delete` gelöschte Tickets dagegen nicht). Fehler (z. B. fehlende Rechte) stehen in der Akte beim Ticket.

## Discord-Bot: Rang-Sync, Role Connections & Willkommen

Unter **Einstellungen → Reiter „Discord“** (nur Board of Partners) stehen alle Discord-Einstellungen – Webhook, Discord-Login, Tickets und die Module des Kanzlei-Bots – links das Modul-Menü (grüner Punkt = eingeschaltet), rechts die Einstellungen. Rollen und Kanäle werden direkt aus Discord geladen und als Auswahl angezeigt (mit Farbe; Rollen über der Bot-Rolle sind mit ⚠ markiert).

- **Übersicht:** Verbindungsstatus, Prüfliste (Token, Server, „Server Members Intent“, Rollen-Reihenfolge, verknüpfte Konten), „Alle Mitglieder abgleichen“, „Neu verbinden“, letzter Abgleich und letzte Fehler.
- **Tickets:** die bisherigen Einstellungen der Discord-Tickets (Server-ID, Kategorien, Rollen, Ping-Pause).
- **Bot-Status:** Unter dem Bot steht live **„3 im Dienst · 14 offene Akten“** (nur Zahlen, keine Namen; jede Minute geprüft, an Discord nur bei Änderung gesendet). Erscheint, sobald der Bot verbunden ist (mindestens ein Bot-Modul aktiv).
- **Einheitlicher Look:** Alle Bot-Nachrichten (Tickets, Befehle, Direktnachrichten, Webhook-Meldungen) haben das **Kanzlei-Logo klein in der Fußzeile** und einen Zeitstempel, den Discord in der **Ortszeit des Lesers** zeigt („Heute um 14:03“); Termine und Systemwarnungen nennen Uhrzeiten als Discord-Zeit mit „vor 5 Minuten“ / „in 2 Stunden“. Das Logo braucht `PUBLIC_URL`. Eigene Nachrichten-Vorlagen und Willkommensnachrichten bleiben so, wie sie gestaltet wurden.
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
4. **Text & Bilder übernehmen:** Im FiveNet-Dokument den Inhalt markieren → Strg+C → in der Akte im Feld „Inhalt aus FiveNet“ Strg+V. Der Text wird als Abschrift gespeichert (Absätze, Listen und Tabellen bleiben lesbar, jedes Bild steht als Marker an seiner Textstelle: beim Einfügen `[Bild 2]`, nach dem Speichern `[Bild → B7]` mit der Beweismittel-Nummer des übernommenen Bildes – anklickbar, öffnet die Großansicht; Bilder, die nicht übernommen werden können, bleiben als `[Bild]`. Bildunterschriften aus dem Dokument – `<figcaption>`, sonst Alt- oder Titeltext, keine Dateinamen – werden die Beschriftung des Anhangs) und lässt sich anzeigen, kopieren und als Textdatei herunterladen. Bilder aus dem eingefügten Inhalt lädt der Server direkt aus dem FiveNet-Dateispeicher und legt sie als Anhang zum Dokument ab; Screenshots oder „Bild kopieren“ lassen sich ebenfalls mit Strg+V einfügen. Der Server lädt dabei nur Adressen der FiveNet-Instanz unter `/api/filestore/` bzw. `/api/image_proxy/`, nur per https, ohne Weiterleitungen, ohne Cookies oder Tokens, höchstens 10 Bilder je Vorgang und 5 MB je Bild, und nur echte JPG-/PNG-/WebP-Dateien. Bilder außerhalb von FiveNet (z. B. Imgur-Links) werden nicht geladen – dafür einen Screenshot einfügen. Abschrift und Bilder folgen der Sichtbarkeit des Dokuments (intern / für den Mandanten).
5. **Ein-Klick-Übernahme per Benutzerskript:** Unter *Mein Profil → FiveNet-Verbindung* liegt das Skript `/fivenet-import.user.js` (für Tampermonkey oder Violentmonkey; es kennt nur die Adresse der Kanzlei und der FiveNet-Instanz). Es läuft ausschließlich im Browser der Person, die dort ohnehin angemeldet ist, und setzt in FiveNet-Dokumenten den Knopf „→ An Pake & Scha senden“. Der Klick liest nur, was auf dem Bildschirm steht (markierter Text hat Vorrang vor dem ganzen Dokument), öffnet das Kanzlei-Dashboard und übergibt Titel, Text (HTML) und Dokument-ID per `postMessage` – wiederholt, bis das Dashboard bestätigt (z. B. nach der Anmeldung). Das Dashboard nimmt die Nachricht **nur von der konfigurierten FiveNet-Adresse und nur von Kanzlei-Mitarbeitenden** an, liest das HTML mit `DOMParser` (keine Skripte, kein Bildabruf), übernimmt nur Bilder aus dem FiveNet-Dateispeicher und speichert nichts, bevor eine Akte gewählt und das vorbelegte Formular samt Bestätigung abgeschickt wurde. Es entsteht keine neue Berechtigung: gesehen und übernommen wird, was die Person in FiveNet selbst sehen darf. Sprechen Sie die Nutzung vorher mit den Betreibern der FiveNet-Instanz ab.
6. **Angaben aus dem Text erkennen:** Beim Einfügen (und bei der Übergabe) rät die Kanzlei Titel, Dokumentart, Verfasser und Datum aus Zeilen wie „Erstellt von: …“, „Kategorie: …“, „Datum: …“, aus bekannten Dokumentarten in den ersten Zeilen und aus dem ersten Datum (2026-10-05, 5.10.2026, 5. Oktober 2026); die erste kurze Zeile ohne Satzzeichen gilt als Titel, ein Hinweis wie „DOC - 74412“ liefert die Dokument-ID. Es sind Vorschläge für **leere** Felder; vorhandene Eingaben bleiben.
7. **Nachvollziehbar:** Verknüpfen, Abschrift, Bildübernahme, Sichtbarkeitswechsel und Entfernen landen im Aktenverlauf und im Protokoll.
8. **Verbindungsstatus:** Unter *Mein Profil* zeigt „FiveNet-Verbindung“ den tatsächlichen Stand (Account nicht verbindbar, Charakter nicht abrufbar, Referenz-Modus) statt einer vorgetäuschten Verbindung.

Adresse der Instanz: Dashboard → *Einstellungen* → *Integrationen* → *FiveNet* (oder Umgebungsvariable `FIVENET_URL`, Standard `https://fivenet.modernv.net`). Dort lässt sich auch die Erreichbarkeit prüfen. Bietet FiveNet später eine offizielle, delegierte Anmeldung an, wird sie in `fivenet.js` ergänzt (dort steht auch die vollständige Prüfung).

## Google Docs ausgeben (Rechnungen, Verträge, Schriftsätze, Aktenauszüge)

Ist das Google-Konto der Kanzlei verbunden, bekommt **jede Rechnung/Honorarvereinbarung, jeder Vertrag und jeder Schriftsatz automatisch ein Google Doc** – gleich beim Anlegen, und beim (erneuten) Verbinden für alle vorhandenen Dokumente, die noch keins haben (nacheinander im Hintergrund, danach alle 10 Minuten geprüft). Aktenauszüge entstehen weiter nur auf Wunsch, weil man dort die Abschnitte wählt. In den Ansichten gibt es dazu den Knopf **„Als Google Doc“** bzw. „Google Doc öffnen“ (Drucken/PDF gibt es nicht mehr).

- **Im Dashboard direkt ins Google Doc:** Bei fertigen Dokumenten – Vertrag/Schriftsatz **vollständig unterschrieben**, Rechnungen immer – wird der bisherige Knopf zu **„Google Doc“** und öffnet das Doc in einem neuen Tab. Es kommt **kein zusätzlicher Knopf** dazu: Die Ansicht der Website öffnet ein Klick auf den **Namen** des Vertrags bzw. die **Nummer** der Rechnung. Solange noch jemand unterschreiben muss, bleibt es bei „Ansehen & unterschreiben“ bzw. „Ansehen“. Das Druckersymbol ist aus dem Dashboard verschwunden (Auge = ansehen, Blatt = Dokument/Google Doc). Mandanten sehen im Dashboard alles wie bisher.

- **Aussehen wie die Druckansicht:** gleicher Aufbau, gleiche Schriften (auch die Schreibschrift der Unterschriften), Farben, Logo und Tabellen. Was Google Docs nicht kann, ist so nah wie möglich nachgebaut: Goldbalken einfarbig statt Farbverlauf, Stempel „BEZAHLT“/„STORNIERT“ gerade statt schräg, kein Zeichenabstand (Sperrung); Seitenumbrüche können minimal abweichen.
- **Öffentlich per Link:** Jedes Doc steht automatisch auf „Jeder mit dem Link – Betrachter“ (lesen, nicht bearbeiten, nicht auffindbar). Es genügt, den Link zu teilen („Link kopieren“).
- **Automatisch aktuell, gleicher Link:** Unterschreibt jemand (Anwalt, Mandant im Portal oder „im Spiel unterschrieben – erfasst“), werden Unterschriften zurückgesetzt, ändert sich der Vertrag, wird eine Rechnung bezahlt/storniert/wieder offen oder ändern sich Angaben der Akte (Aktenzeichen, Titel, Gericht …), die Kopfzeile der Verträge oder die Anschrift der Kanzlei, schreibt der Server das Google Doc kurz danach neu – **niemand muss etwas drücken**, einen Knopf „Aktualisieren“ gibt es nicht. Schlägt das Schreiben fehl (z. B. Google kurz nicht erreichbar), holt der Server es alle 10 Minuten nach.
- **Aktenauszug:** enthält die in „Inhalt wählen“ gesetzten Abschnitte und folgt ebenfalls automatisch jeder Änderung an der Akte (Notizen, Anhänge, Status, Termine, Aufgaben, Verträge, Rechnungen …; nicht der Chat). Wer die Auswahl der Abschnitte ändert, ändert damit auch das vorhandene Doc. Da jeder mit dem Link lesen kann, „Interne Angaben“ nur bewusst einbeziehen.
- **Löschen:** „Löschen“ in der Ansicht, das Löschen der Rechnung/des Vertrags oder das endgültige Löschen der Akte legt das Doc in den Papierkorb des Kanzlei-Drive – der Link funktioniert dann nicht mehr. Wurde die Freigabe in der Ansicht bewusst beendet, legt der Server für dieses Dokument **nicht automatisch** wieder ein Doc an – erst, wenn jemand dort erneut „Als Google Doc“ wählt.
- **Wer:** Anlegen und Löschen die Kanzlei (Anwälte, Board). Mandanten sehen in ihrer Ansicht „Google Doc öffnen“ / „Link kopieren“, sobald es ein Doc gibt (Aktenauszüge nur für die Kanzlei).
- **Wo:** im Google Drive des Kanzlei-Kontos, Ordner „Pake & Scha – Dokumente“ (Unterordner „Rechnungen & Honorare“, „Verträge & Schriftsätze“, „Aktenauszüge“).
- **Störung:** Ist Google nicht erreichbar oder die Verbindung abgelaufen, merkt sich der Server die Änderungen und holt sie nach (alle 10 Minuten bzw. sofort nach erneutem Verbinden); das Board erhält eine Systemwarnung in Discord.

### Einrichtung (einmalig, ca. 10 Minuten)

1. [console.cloud.google.com](https://console.cloud.google.com) → oben „Projekt auswählen“ → **„Neues Projekt“** (z. B. „Pake & Scha“).
2. **APIs & Dienste → Bibliothek → „Google Drive API“ → „Aktivieren“.**
3. **Google Auth Platform** (früher „OAuth-Zustimmungsbildschirm“) → „Erste Schritte“: App-Name „Pake & Scha“, Support-E-Mail, Zielgruppe **„Extern“**, Kontakt-E-Mail.
4. **Datenzugriff → „Bereiche hinzufügen“** → `…/auth/drive.file` („Nur die Google-Drive-Dateien, die mit dieser App verwendet werden“) → Speichern.
5. **Zielgruppe → „App veröffentlichen“** (Status „In Produktion“). Wichtig: Im Status „Test“ läuft die Verbindung nach 7 Tagen ab. Da nur `drive.file` genutzt wird, braucht es keine Prüfung durch Google. Zeigt Google beim Verbinden „Google hat diese App nicht überprüft“: „Erweitert“ → „Weiter zu Pake & Scha“.
6. **Clients → „Client erstellen“** → Typ **„Webanwendung“** → „Autorisierte Weiterleitungs-URIs“: `https://<deine-seite>.onrender.com/api/google/callback` (die genaue Adresse steht im Dashboard unter Einstellungen → Integrationen → Google Docs) → „Erstellen“ → **Client-ID** und **Clientschlüssel** kopieren.
7. **Render → Service → Environment:** `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` eintragen und speichern (Render deployt neu). Optional `GOOGLE_REDIRECT_URI`, falls die Adresse von `PUBLIC_URL` abweicht.
8. **Dashboard → Einstellungen → Integrationen → „Google Docs“ → „Kanzlei-Google-Konto verbinden“** und mit dem **gemeinsamen Google-Konto der Kanzlei** anmelden (nicht dem privaten Konto eines Mitarbeiters) – den Haken für Google Drive setzen.

Danach legt der Server für alle Rechnungen, Verträge und Schriftsätze die Google Docs an, in allen Druckansichten erscheint „Als Google Doc“ bzw. „Google Doc öffnen“, und die Datensicherung kommt zusätzlich in einen privaten Ordner im Google Drive (siehe [Datensicherung](../README.md#datensicherung)). Ohne diese Einrichtung bleibt alles wie bisher.

**Sicherheit:** Die Website erhält nur den Bereich `drive.file` – sie sieht und ändert ausschließlich Dateien, die sie selbst angelegt hat, nicht den übrigen Inhalt des Google Drive. Der Zugangsschlüssel (Refresh-Token) liegt nur auf dem Server, verschlüsselt mit einem aus `GOOGLE_CLIENT_SECRET` abgeleiteten Schlüssel, und gelangt nie in den Browser. „Trennen“ widerruft den Zugang bei Google; vorhandene Docs bleiben dann unter ihrem Link erreichbar, werden aber nicht mehr aktualisiert. Wird `GOOGLE_CLIENT_SECRET` geändert, einfach neu verbinden.

Technik: `docxRender.js` baut aus denselben Daten wie die Druckansicht eine Word-Datei, Google wandelt sie beim Hochladen in ein Google Doc um (`googleDrive.js`); `googleDocs.js` merkt sich je Dokument das Doc, legt fehlende automatisch an (Tabelle `google_docs_optout` merkt sich bewusst beendete Freigaben) und schreibt es bei Änderungen neu. Die unten beschriebene Google-Docs-*Integration* (Dokumente in eine Akte übernehmen) ist davon unabhängig und braucht weiterhin keine Einrichtung.

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
