'use strict';
/*
 * Vertragsvorlagen (Mandatsvertrag u. a.).
 *
 * Vorlagen sind einfacher Text mit wenigen Formatierungszeichen (siehe MARKUP_HELP) und
 * Platzhaltern wie {{mandant}}. Gespeichert wird zu jedem Vertrag der Vorlagentext zum
 * Zeitpunkt der Erstellung – spätere Änderungen an der Vorlage verändern bestehende Verträge nicht.
 * Dargestellt wird im Browser (public/js/contract-render.js); dort wird jeder Wert escaped.
 */

/** Platzhalter, die beim Erstellen eines Vertrags ausgefüllt werden. */
const FIELDS = {
  anwalt: 'Name des unterzeichnenden Anwalts',
  anwalt_rang: 'Rang des Anwalts',
  anwalt_geburtsdatum: 'Geburtsdatum des Anwalts',
  mandant: 'Name des Mandanten',
  mandant_geburtsdatum: 'Geburtsdatum des Mandanten',
  grundgebuehr: 'Grundgebühr',
  zusatzgebuehr: 'Zusatzgebühr',
  datum: 'Datum der Unterzeichnung',
  ort: 'Ort der Unterzeichnung',
};

/** Platzhalter, die automatisch aus der Akte kommen. */
const AUTO_FIELDS = {
  aktenzeichen: 'Aktenzeichen der Akte',
  akte: 'Titel der Akte',
  rechtsgebiet: 'Rechtsgebiet der Akte',
  kanzlei: 'Pake & Scha Legal Consulting',
};

const DEFAULT_HEADER = 'Atlee Street (8051)\nTel: 6026158184';
const DEFAULT_PLACE = 'Los Santos, San Andreas';

// Nach der Vorlage „Pake & Scha Mandatsvertrag“ (Google Docs, 5 Seiten).
const MANDATSVERTRAG = `# Mandatsvertrag
| -zwischen-
|
| **{{anwalt}}**
| **{{anwalt_rang}}, Pake & Scha**
| geb. am {{anwalt_geburtsdatum}}
| (im Folgenden als „Anwalt“ bezeichnet)
|
| - und -
|
| **{{mandant}}**
| geb. am {{mandant_geburtsdatum}}
| (im Folgenden als „Mandant“ bezeichnet)
===
## II. Vertragsbedingungen

### § 1 Mandatserteilung und Tätigkeitsbereich
Das Mandatsverhältnis beginnt mit Unterzeichnung dieses Vertrages und wird auf unbestimmte Zeit geschlossen. Es endet erst, wenn eine der Parteien ausdrücklich die Auflösung des Mandatsverhältnisses wünscht.

### § 2 Honorar und Aufwendungsersatz
Die Vergütung für die anwaltliche Tätigkeit bemisst sich nach der offiziellen und internen Gebührenordnung der Kanzlei Pake & Scha.
1. Für das vorliegende Verfahren wird folgende Zahlungsvereinbarung getroffen:
    *Grundgebühr: {{grundgebuehr}}*
    *Zusatzgebühr: {{zusatzgebuehr}}*
2. Der Mandant verpflichtet sich, die erstellte Rechnung unverzüglich nach Erhalt und innerhalb der festgesetzten Zahlungsfrist per Barzahlung oder Überweisung zu begleichen.

### § 3 Anwaltliche Pflichten, Verschwiegenheit und Loyalität
1. Der Rechtsanwalt führt das Mandat als unabhängiges Organ der Rechtspflege gewissenhaft, loyal und mit professioneller Sorgfalt im besten Interesse des Mandanten.
2. **Verschwiegenheitspflicht (§ 12 Abs. 1 RAO analog):** Der Rechtsanwalt ist zur absoluten Geheimhaltung über alle Angelegenheiten und Fakten verpflichtet, die ihm im Zuge der Berufsausübung durch den Mandanten anvertraut oder bekannt wurden. Diese Schweigepflicht gilt zeitlich unbegrenzt und ausdrücklich auch gegenüber Strafverfolgungsbehörden (wie dem LSPD/DoJ) oder Dritten.
3. Der Rechtsanwalt garantiert, dass zum Zeitpunkt des Vertragsschlusses kein Interessenkonflikt durch die Vertretung von Gegenparteien in derselben Sache vorliegt (§ 12 Abs. 2 RAO).

### § 4 Mitwirkungspflichten des Mandanten
1. Der Mandant unterstützt den Rechtsanwalt bei der Mandatsdurchführung, indem er alle relevanten Informationen, Beweise, Dokumente und Zeugenkontakte rechtzeitig, wahrheitsgemäß und lückenlos zur Verfügung stellt.
2. Der Mandant unterlässt eigenmächtige Verhandlungen oder Absprachen mit Behörden, Ermittlungsbeamten oder der Gegenseite, sofern diese nicht explizit mit dem zuständigen Rechtsanwalt koordiniert wurden.

### § 5 Vertragsdauer und Vorlegungspflicht
1. Das Mandat tritt mit der beidseitigen Unterzeichnung in Kraft. Es endet automatisch mit dem rechtskräftigen Abschluss des Verfahrens, der Beendigung der Abhandlung oder durch einvernehmliche Aufhebung.
2. Jede Partei kann das Vertragsverhältnis jederzeit vorzeitig kündigen. In diesem Fall sind die bis zur Kündigung erbrachten Leistungen der Kanzlei voll auf Basis der Gebührenordnung zu entgelten.
**Vorlegungspflicht (§ 13 Abs. 3 RAO analog):**
3. Dieser Vertrag ist den zuständigen Justizbehörden oder dem Gericht spätestens nach Erhebung der öffentlichen Anklage durch die Staatsanwaltschaft vorzulegen, sofern dies zur Legitimation der Verteidigung im Verfahren erforderlich ist.

## III. Rechtswirksamkeit
Durch ihre eigenhändige Unterschrift erklären die Vertragsparteien ihr ausdrückliches Einverständnis mit allen in diesem Dokument aufgeführten Bedingungen und setzen diesen Vertrag mit sofortiger Wirkung in Kraft. Jede Partei erhält eine Ausfertigung dieses Mandatsvertrages.
===
[Unterschriften]
`;

const DEFAULT_TEMPLATES = [{ key: 'mandatsvertrag', name: 'Mandatsvertrag', body: MANDATSVERTRAG }];

const MAX_BODY = 30000;

/** Platzhalter im Text, die es nicht gibt (Tippfehler in der Vorlage). */
function unknownPlaceholders(body) {
  const known = new Set([...Object.keys(FIELDS), ...Object.keys(AUTO_FIELDS)]);
  const found = [...String(body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase());
  return [...new Set(found.filter((f) => !known.has(f)))];
}

module.exports = { FIELDS, AUTO_FIELDS, DEFAULT_HEADER, DEFAULT_PLACE, DEFAULT_TEMPLATES, MAX_BODY, unknownPlaceholders };
