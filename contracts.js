'use strict';
/*
 * Vertragsvorlagen (Mandatsvertrag u. a.) und Schriftsatz-Vorlagen (Vollmacht, Akteneinsichtsgesuch, Haftbeschwerde …).
 *
 * Vorlagen sind einfacher Text mit wenigen Formatierungszeichen (siehe MARKUP_HELP) und
 * Platzhaltern wie {{mandant}}. Gespeichert wird zu jedem Vertrag der Vorlagentext zum
 * Zeitpunkt der Erstellung – spätere Änderungen an der Vorlage verändern bestehende Verträge nicht.
 * Dargestellt wird im Browser (public/js/contract-render.js); dort wird jeder Wert escaped.
 */

/** Platzhalter, die beim Erstellen eines Vertrags ausgefüllt werden. */
const FIELDS = {
  anwalt: 'Name des (ersten) unterzeichnenden Anwalts',
  anwalt_rang: 'Rang des Anwalts',
  anwalt_geburtsdatum: 'Geburtsdatum des Anwalts',
  mandant: 'Name des Mandanten',
  mandant_geburtsdatum: 'Geburtsdatum des Mandanten',
  grundgebuehr: 'Grundgebühr',
  zusatzgebuehr: 'Zusatzgebühr',
  leistungen: 'Vereinbarte Leistungen (aus der Honorarordnung, je Zeile eine)',
  datum: 'Datum der Unterzeichnung',
  ort: 'Ort der Unterzeichnung',
  // vor allem für Schriftsätze
  empfaenger: 'Empfänger (Gericht, Staatsanwaltschaft, Behörde – mehrzeilig)',
  betreff: 'Betreff / Bezug',
  festnahme: 'Festnahme bzw. Haft (Datum, Ort, Behörde)',
  begruendung: 'Begründung bzw. eigener Text (mehrzeilig; leer = Absatz entfällt)',
};

/** Arten von Vorlagen: Verträge (Mandant und Anwalt unterschreiben) und Schriftsätze (meist nur der Anwalt). */
const KINDS = { vertrag: 'Vertrag', schriftsatz: 'Schriftsatz' };

/** Platzhalter, die automatisch aus der Akte kommen. */
const AUTO_FIELDS = {
  aktenzeichen: 'Aktenzeichen der Akte',
  akte: 'Titel der Akte',
  rechtsgebiet: 'Rechtsgebiet der Akte',
  gerichtsaktenzeichen: 'Gerichtsaktenzeichen der Akte',
  gegenpartei: 'Gegenpartei der Akte',
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
[Weitere Anwälte]
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
    *Vereinbarte Leistungen:*
    {{leistungen}}
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

// Schriftsätze – Briefe und Erklärungen der Kanzlei; Unterschrift über [Unterschrift Anwalt] bzw. [Unterschrift Mandant]
const VOLLMACHT = `# Vollmacht
|
| Hiermit bevollmächtige ich
|
| **{{mandant}}**
| geb. am {{mandant_geburtsdatum}}
| (im Folgenden „Vollmachtgeber“)
|
| die Kanzlei Pake & Scha Legal Consulting, vertreten durch
|
| **{{anwalt}}**
| **{{anwalt_rang}}, Pake & Scha**
| (im Folgenden „Bevollmächtigte“)
|
| in der Sache **{{akte}}** (Aktenzeichen {{aktenzeichen}}).

## Umfang der Vollmacht
Die Vollmacht berechtigt zur Vertretung in allen Angelegenheiten, die mit der oben genannten Sache zusammenhängen, insbesondere:
1. zur Verteidigung und Vertretung in Straf-, Bußgeld- und Zivilverfahren vor allen Gerichten des Staates San Andreas einschließlich der Rechtsmittelinstanzen;
2. zur Einsicht in die Ermittlungs- und Gerichtsakten sowie in Unterlagen des LSPD, des DOJ und weiterer Behörden;
3. zur Stellung, Begründung und Rücknahme von Anträgen, Beschwerden und Rechtsmitteln, insbesondere Haftbeschwerden und Anträgen auf Haftprüfung;
4. zum Abschluss von Vergleichen und Absprachen sowie zur Entgegennahme von Zustellungen;
5. zur Erteilung von Untervollmacht an andere Anwälte der Kanzlei.

Die Vollmacht gilt bis zu ihrem Widerruf. Der Widerruf ist gegenüber der Kanzlei zu erklären.
[Unterschrift Mandant]
`;

const AKTENEINSICHT = `{{empfaenger}}

# Antrag auf Akteneinsicht

**Betreff:** {{betreff}}
**Aktenzeichen:** {{gerichtsaktenzeichen}}
**Unser Zeichen:** {{aktenzeichen}}

Sehr geehrte Damen und Herren,

in der oben genannten Sache zeigen wir an, dass wir **{{mandant}}** (geb. am {{mandant_geburtsdatum}}) anwaltlich vertreten. Eine auf uns lautende Vollmacht liegt vor und wird auf Verlangen vorgelegt.

Namens und in Vollmacht unseres Mandanten beantragen wir
    **vollständige Einsicht in die Ermittlungs- bzw. Gerichtsakte einschließlich aller Beiakten, Beweismittel, Berichte sowie Bild- und Videoaufnahmen.**

Wir bitten, uns die Akte bzw. Kopien der Aktenbestandteile zeitnah zur Verfügung zu stellen. Sollte die Einsicht ganz oder teilweise versagt werden, bitten wir um eine kurze Begründung.

{{begruendung}}

Mit freundlichen Grüßen
[Unterschrift Anwalt]
`;

const HAFTBESCHWERDE = `{{empfaenger}}

# Haftbeschwerde

**Aktenzeichen:** {{gerichtsaktenzeichen}}
**Unser Zeichen:** {{aktenzeichen}}

In der Sache gegen **{{mandant}}** (geb. am {{mandant_geburtsdatum}}) legen wir namens und in Vollmacht des Beschuldigten
    **Haftbeschwerde**
gegen die Inhaftierung ({{festnahme}}) ein und beantragen,
1. die Haft unverzüglich aufzuheben und den Beschuldigten auf freien Fuß zu setzen,
2. hilfsweise den Vollzug der Haft gegen geeignete Auflagen auszusetzen,
3. hilfsweise unverzüglich eine mündliche Haftprüfung anzuberaumen.

## Begründung
{{begruendung}}

Die Voraussetzungen für die Fortdauer der Haft liegen nicht vor: Es fehlt an einem dringenden Tatverdacht und an einem Haftgrund; jedenfalls ist die Haft unverhältnismäßig. Der Beschuldigte ist in Los Santos wohnhaft und jederzeit erreichbar.

Wir beantragen zugleich Akteneinsicht und behalten uns ergänzenden Vortrag vor.

Mit freundlichen Grüßen
[Unterschrift Anwalt]
`;

const DEFAULT_TEMPLATES = [
  { key: 'mandatsvertrag', name: 'Mandatsvertrag', body: MANDATSVERTRAG, kind: 'vertrag' },
  { key: 'vollmacht', name: 'Vollmacht', body: VOLLMACHT, kind: 'schriftsatz' },
  { key: 'akteneinsicht', name: 'Antrag auf Akteneinsicht', body: AKTENEINSICHT, kind: 'schriftsatz' },
  { key: 'haftbeschwerde', name: 'Haftbeschwerde', body: HAFTBESCHWERDE, kind: 'schriftsatz' },
];

/**
 * Wer muss unterschreiben? [Unterschriften] = Anwälte und Mandant, [Unterschrift Anwalt] / [Unterschrift Mandant] = nur
 * diese Seite. Ohne Angabe: Verträge beide, Schriftsätze nur der Anwalt (Unterschriftsfeld steht dann am Ende).
 */
function signatureNeeds(body, kind = 'vertrag') {
  const lines = String(body || '').split('\n').map((l) => l.trim().toLowerCase());
  const both = lines.includes('[unterschriften]');
  const lawyer = both || lines.includes('[unterschrift anwalt]');
  const client = both || lines.includes('[unterschrift mandant]');
  if (!lawyer && !client) return kind === 'schriftsatz' ? { lawyer: true, client: false } : { lawyer: true, client: true };
  return { lawyer, client };
}

/** Frühere Fassungen der mitgelieferten Vorlagen – unverändert übernommene werden automatisch aktualisiert. */
const WITHOUT_CO_LAWYERS = MANDATSVERTRAG.replace('[Weitere Anwälte]\n', '');
const PREVIOUS_VERSIONS = {
  mandatsvertrag: [WITHOUT_CO_LAWYERS, WITHOUT_CO_LAWYERS.replace('    *Vereinbarte Leistungen:*\n    {{leistungen}}\n', '')],
};

/** Höchstzahl weiterer unterzeichnender Anwälte (zusätzlich zum ersten). */
const MAX_CO_LAWYERS = 4;

const MAX_BODY = 30000;

/** Platzhalter im Text, die es nicht gibt (Tippfehler in der Vorlage). */
function unknownPlaceholders(body) {
  const known = new Set([...Object.keys(FIELDS), ...Object.keys(AUTO_FIELDS)]);
  const found = [...String(body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase());
  return [...new Set(found.filter((f) => !known.has(f)))];
}

module.exports = { FIELDS, AUTO_FIELDS, KINDS, DEFAULT_HEADER, DEFAULT_PLACE, DEFAULT_TEMPLATES, PREVIOUS_VERSIONS, MAX_BODY, MAX_CO_LAWYERS, unknownPlaceholders, signatureNeeds };
