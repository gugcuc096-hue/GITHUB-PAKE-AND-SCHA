'use strict';
/*
 * FiveNet-Anbindung (https://github.com/fivenet-app/fivenet)
 *
 * Ergebnis der Schnittstellenprüfung (offizieller Quellcode, FiveNet v2026.9):
 * - FiveNet nutzt OAuth2 nur als CLIENT (Anmeldung bei FiveNet über Discord oder
 *   einen generischen Anbieter). Es gibt keinen OAuth2-/OIDC-Anbieter, bei dem sich
 *   eine fremde Anwendung registrieren und Zugriff anfragen könnte.
 * - Konto-, Charakter- und Dokument-Endpunkte (gRPC-Web unter /api/grpc) verlangen die
 *   Sitzungs-JWTs eines angemeldeten Benutzers: Konto-Cookie "fivenet_acc" plus
 *   Charakter-Token. Beide gibt es nur über AuthService.Login mit Benutzername und
 *   Passwort; sie gelten 4 Tage und sind nicht auf einzelne Rechte beschränkbar.
 * - Die Sync-API (SyncService) nutzt statische Server-Tokens für das Spielserver-Plugin.
 *   Sie arbeitet instanzweit ohne Charakter-Berechtigungen und ist für uns tabu.
 * - Ohne Anmeldung erreichbar sind nur /api/ping, /api/version und /api/config.
 *
 * Folge: keine Passwörter, keine Sitzungs-Tokens, kein Scraping. FiveNet-Dokumente werden
 * als geprüfte externe Referenz gespeichert. Bietet FiveNet später eine offizielle,
 * delegierte Freigabe an, wird sie hier ergänzt und CAPABILITIES umgestellt.
 */
const { getSetting } = require('./db');

const DEFAULT_URL = 'https://fivenet.modernv.net';
const INT64_MAX = 9223372036854775807n;

/** Was die Kanzlei-Plattform über offizielle FiveNet-Schnittstellen kann. */
const CAPABILITIES = Object.freeze({
  accountLink: false,
  characterSelect: false,
  documentFetch: false,
});

/** Ergebnis der Schnittstellenprüfung – wird im Profil und in den Einstellungen angezeigt. */
const INTERFACES = [
  {
    key: 'oauth2',
    label: 'OAuth2 / SSO',
    status: 'unavailable',
    note: 'FiveNet nutzt OAuth2 nur, damit man sich bei FiveNet mit Discord anmelden kann. Für andere Anwendungen stellt FiveNet keine Anmeldung bereit.',
  },
  {
    key: 'auth',
    label: 'API-Authentifizierung',
    status: 'blocked',
    note: 'Nur Sitzungs-Tokens nach Anmeldung mit Benutzername und Passwort (4 Tage gültig, ohne eingeschränkte Rechte). Passwörter werden hier bewusst nie verlangt.',
  },
  {
    key: 'account',
    label: 'Account-API',
    status: 'blocked',
    note: 'AuthService.GetAccountInfo – nur mit Sitzungs-Token des Benutzers.',
  },
  {
    key: 'characters',
    label: 'Charakter-API & Charakterauswahl',
    status: 'blocked',
    note: 'AuthService.GetCharacters / ChooseCharacter – nur mit Sitzungs-Token des Benutzers.',
  },
  {
    key: 'documents',
    label: 'Dokument-API',
    status: 'blocked',
    note: 'DocumentsService.GetDocument prüft die Rechte des aktiven Charakters – aber nur mit dessen Sitzungs-Token.',
  },
  {
    key: 'sync',
    label: 'Sync-API',
    status: 'unsuitable',
    note: 'Nur für das Spielserver-Plugin: ein Token für die ganze Instanz, ohne Charakter-Berechtigungen. Wird deshalb nicht genutzt.',
  },
  {
    key: 'permissions',
    label: 'Berechtigungen',
    status: 'respected',
    note: 'FiveNet gibt Dokumente pro Job/Rang und Person frei. Die Kanzlei greift nie selbst zu; der Anwalt bestätigt, das Dokument mit eigenem Charakter geöffnet zu haben.',
  },
  {
    key: 'public',
    label: 'Öffentliche Endpunkte',
    status: 'used',
    note: '/api/version – nur für die Erreichbarkeitsprüfung der Instanz, ohne Personen- oder Dokumentdaten.',
  },
];

// Häufige Dokumentarten im RP-Alltag (FiveNet-Kategorien sind je Server frei wählbar).
const DOC_TYPES = [
  'Polizeibericht',
  'Strafanzeige',
  'Haftbefehl',
  'Durchsuchungsbeschluss',
  'Festnahmeprotokoll',
  'Zeugenaussage',
  'Beschuldigtenvernehmung',
  'Anklageschrift',
  'Urteil',
  'Beschluss',
  'Bußgeldbescheid',
  'Gutachten',
  'Vertrag',
  'Lizenz / Genehmigung',
  'Sonstiges',
];

const isIpLiteral = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');

/**
 * Prüft eine FiveNet-Basisadresse (nur https, echter Domainname, keine Zugangsdaten).
 * Liefert { ok, url, host } oder { ok: false, error }.
 */
function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Bitte die Adresse der FiveNet-Instanz angeben.' };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'Das ist keine gültige Adresse.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Die FiveNet-Adresse muss mit https:// beginnen.' };
  if (url.username || url.password) return { ok: false, error: 'Die Adresse darf keine Zugangsdaten enthalten.' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || isIpLiteral(host)) return { ok: false, error: 'Bitte einen Domainnamen angeben (z. B. fivenet.example.net).' };
  return { ok: true, url: url.origin, host: url.host.toLowerCase() };
}

/** Aktuell konfigurierte Instanz: Einstellung im Dashboard > FIVENET_URL > Standard. */
function instance() {
  const fromSettings = getSetting('fivenet_url', '');
  const fromEnv = process.env.FIVENET_URL || '';
  const chosen = fromSettings || fromEnv || DEFAULT_URL;
  const parsed = normalizeBaseUrl(chosen);
  const source = fromSettings ? 'settings' : fromEnv ? 'env' : 'default';
  if (parsed.ok) return { url: parsed.url, host: parsed.host, source, valid: true };
  const fallback = normalizeBaseUrl(DEFAULT_URL);
  return { url: fallback.url, host: fallback.host, source: 'default', valid: false };
}

const stripWww = (host) => host.replace(/^www\./, '');

/**
 * Erkennt ein einzelnes FiveNet-Dokument. Akzeptiert:
 *   https://<instanz>/documents/1234  (auch mit /edit, Schrägstrich, ?query oder #anker)
 *   <instanz>/documents/1234          (ohne https://)
 *   1234                               (nur die Dokument-ID)
 * Nur Adressen der konfigurierten Instanz werden angenommen.
 */
function parseDocumentRef(input, inst = instance()) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, error: 'Bitte eine FiveNet-Dokument-Adresse einfügen.' };
  if (text.length > 500) return { ok: false, error: 'Die Adresse ist zu lang.' };
  const example = `${inst.url}/documents/1234`;

  let id;
  if (/^\d+$/.test(text)) {
    id = text;
  } else {
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return { ok: false, error: `Das ist keine gültige Adresse. Beispiel: ${example}` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Nur http(s)-Adressen sind möglich.' };
    if (url.username || url.password) return { ok: false, error: 'Die Adresse darf keine Zugangsdaten enthalten.' };
    const expected = new URL(inst.url);
    if (stripWww(url.hostname.toLowerCase()) !== stripWww(expected.hostname) || url.port !== expected.port) {
      return { ok: false, error: `Diese Adresse gehört nicht zur FiveNet-Instanz der Kanzlei (${inst.host}).` };
    }
    const m = url.pathname.match(/^\/documents\/([^/]+)(?:\/edit)?\/?$/i);
    if (!m) return { ok: false, error: `Das ist kein Link auf ein einzelnes FiveNet-Dokument. Erwartet wird z. B. ${example}` };
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = '';
    }
    if (!/^\d+$/.test(id)) {
      return { ok: false, error: `Die Adresse enthält keine gültige Dokument-ID – FiveNet-IDs bestehen nur aus Ziffern (z. B. …/documents/1234).` };
    }
  }

  if (id.length > 19) return { ok: false, error: 'Die Dokument-ID ist zu groß.' };
  const big = BigInt(id);
  if (big < 1n || big > INT64_MAX) return { ok: false, error: 'Die Dokument-ID ist ungültig.' };
  const documentId = big.toString();
  return { ok: true, documentId, canonicalUrl: `${inst.url}/documents/${documentId}`, host: inst.host, input: text };
}

/**
 * Erreichbarkeit der Instanz über den öffentlichen Endpunkt /api/version prüfen.
 * Keine Weiterleitungen, kurze Zeitgrenze, nur die Versionsnummer wird ausgewertet.
 */
async function checkInstance(inst = instance()) {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(`${inst.url}/api/version`, {
      headers: { Accept: 'application/json', 'User-Agent': 'PakeScha-Kanzlei/1.0 (+FiveNet-Statusprüfung)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { reachable: false, checkedAt, detail: `Antwort ${res.status}` };
    const text = (await res.text()).slice(0, 2000);
    let version = null;
    try {
      const v = JSON.parse(text).version;
      if (typeof v === 'string' && /^[\w.+-]{1,40}$/.test(v)) version = v;
    } catch {
      /* keine JSON-Antwort */
    }
    if (!version) return { reachable: false, checkedAt, detail: 'Die Antwort sieht nicht nach FiveNet aus.' };
    return { reachable: true, checkedAt, version };
  } catch (err) {
    return { reachable: false, checkedAt, detail: err?.name === 'TimeoutError' ? 'Zeitüberschreitung' : 'Nicht erreichbar' };
  }
}

module.exports = {
  DEFAULT_URL,
  CAPABILITIES,
  INTERFACES,
  DOC_TYPES,
  normalizeBaseUrl,
  instance,
  parseDocumentRef,
  checkInstance,
};
