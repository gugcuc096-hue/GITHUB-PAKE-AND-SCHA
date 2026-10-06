'use strict';
/*
 * Google Drive über das Kanzlei-Konto: einmalige Anmeldung per OAuth (Board of Partners), danach legt der Server
 * Google Docs an, schreibt sie neu, teilt sie per Link und verschiebt sie in den Papierkorb.
 *
 * Sicherheit:
 *  - Scope nur „drive.file“: Die Website sieht und ändert ausschließlich Dateien, die sie selbst angelegt hat –
 *    nicht den übrigen Inhalt des Google Drive.
 *  - Der Refresh-Token bleibt auf dem Server, verschlüsselt (AES-256-GCM, Schlüssel abgeleitet aus
 *    GOOGLE_CLIENT_SECRET). Ohne das Secret aus Render ist er wertlos; ins Frontend gelangt er nie.
 *
 * Render → Environment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional GOOGLE_REDIRECT_URI, sonst
 * PUBLIC_URL bzw. die aufgerufene Adresse + /api/google/callback).
 */
const crypto = require('crypto');
const { getSetting, setSetting } = require('./db');
const { envValue } = require('./discord');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = ['openid', 'email', DRIVE_SCOPE];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GDOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TIMEOUT = 45000;
const MULTIPART_MAX = 4.5 * 1024 * 1024; // Google: einfacher Upload bis 5 MB, größere Dateien „resumable“

const FOLDERS = {
  root: 'Pake & Scha – Dokumente',
  invoice: 'Rechnungen & Honorare',
  contract: 'Verträge & Schriftsätze',
  extract: 'Aktenauszüge',
};

/* ---------------------------------------------------------------- Einrichtung */
const configured = () => !!(envValue('GOOGLE_CLIENT_ID') && envValue('GOOGLE_CLIENT_SECRET'));

function redirectUri(req) {
  const explicit = envValue('GOOGLE_REDIRECT_URI');
  if (explicit) return explicit;
  const base = envValue('PUBLIC_URL').replace(/\/+$/, '');
  return `${/^https?:\/\//.test(base) ? base : `${req.protocol}://${req.get('host')}`}/api/google/callback`;
}

function authorizeUrl(req, state) {
  const params = new URLSearchParams({
    client_id: envValue('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // Refresh-Token, damit der Server auch später (z. B. bei einer Unterschrift) schreiben kann
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/* ---------------------------------------------------------------- Token (verschlüsselt gespeichert) */
const key = () => crypto.createHash('sha256').update(`pake-scha-google|${envValue('GOOGLE_CLIENT_SECRET')}`).digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function unseal(blob) {
  try {
    const raw = Buffer.from(blob, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null; // z. B. GOOGLE_CLIENT_SECRET geändert → neu verbinden
  }
}

const refreshToken = () => {
  const blob = getSetting('google_token', '');
  return blob ? unseal(blob) : null;
};
let access = { token: null, expires: 0 };

function fail(message, status = 502, code) {
  return Object.assign(new Error(message), { status, code });
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: envValue('GOOGLE_CLIENT_ID'), client_secret: envValue('GOOGLE_CLIENT_SECRET'), ...params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(json.error_description || json.error || `Google antwortet mit ${res.status}`, 502, json.error);
  return json;
}

/** Callback der Anmeldung: Code gegen Token tauschen und das Kanzlei-Konto merken. */
async function connect(req, code, user) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(req) });
  const scopes = String(t.scope || '').split(/\s+/);
  if (!scopes.includes(DRIVE_SCOPE)) throw fail('Google hat keinen Zugriff auf Google Drive erteilt. Bitte erneut verbinden und den Haken bei Google Drive setzen.', 400, 'scope');
  if (!t.refresh_token) throw fail('Google hat keinen dauerhaften Zugang geliefert. Bitte unter myaccount.google.com → Sicherheit → Drittanbieter-Apps den Zugriff entfernen und erneut verbinden.', 400, 'refresh');
  let email = '';
  try {
    email = JSON.parse(Buffer.from(String(t.id_token || '').split('.')[1] || '', 'base64url').toString('utf8')).email || '';
  } catch {
    /* ohne E-Mail-Angabe weiter */
  }
  setSetting('google_token', seal(t.refresh_token));
  setSetting('google_account', email);
  setSetting('google_connected_at', new Date().toISOString());
  setSetting('google_connected_by', user ? user.display_name : '');
  setSetting('google_error', '');
  setSetting('google_folders', '{}');
  access = { token: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
  return email;
}

/** Verbindung trennen: Zugriff bei Google widerrufen (so gut es geht) und alles Gespeicherte löschen. */
async function disconnect() {
  const rt = refreshToken();
  if (rt) {
    await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: rt })}`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
  for (const k of ['google_token', 'google_account', 'google_connected_at', 'google_connected_by', 'google_error']) setSetting(k, '');
  setSetting('google_folders', '{}');
  access = { token: null, expires: 0 };
}

const connected = () => configured() && !!refreshToken();

async function accessToken(force = false) {
  if (!force && access.token && Date.now() < access.expires - 60000) return access.token;
  const rt = refreshToken();
  if (!configured() || !rt) throw fail('Das Google-Konto der Kanzlei ist nicht verbunden (Einstellungen → Google Docs).', 409, 'not_connected');
  try {
    const t = await tokenRequest({ refresh_token: rt, grant_type: 'refresh_token' });
    access = { token: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
    if (getSetting('google_error', '')) setSetting('google_error', '');
    require('./systemAlerts').resolve('google', { title: 'Google Docs wieder verbunden', description: 'Die Google Docs der Kanzlei werden wieder aktualisiert.' });
    return access.token;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      // Zugriff widerrufen oder abgelaufen (z. B. App in Google noch im „Testmodus“: 7 Tage)
      setSetting('google_error', 'Die Verbindung zu Google ist abgelaufen oder wurde widerrufen – bitte unter Einstellungen → Google Docs neu verbinden.');
      require('./systemAlerts').raise('google', {
        title: 'Google Docs: Verbindung getrennt',
        description: 'Google hat den Zugang der Website abgelehnt. Bis zum erneuten Verbinden (Dashboard → Einstellungen → Google Docs) werden keine Google Docs aktualisiert.',
      });
      throw fail('Die Verbindung zu Google ist abgelaufen oder wurde widerrufen – bitte unter Einstellungen → Google Docs neu verbinden.', 409, 'expired');
    }
    throw err;
  }
}

/** Aufruf der Drive-API mit Zugriffstoken; bei abgelaufenem Token einmal neu anmelden und wiederholen. */
async function request(method, url, { json, body, headers = {} } = {}, retried = false) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(retried)}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 401 && !retried) return request(method, url, { json, body, headers }, true);
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error && (data.error.message || (data.error.errors && data.error.errors[0] && data.error.errors[0].message));
    throw fail(`Google Drive: ${reason || `Fehler ${res.status}`}`, res.status === 404 ? 404 : 502, res.status === 404 ? 'not_found' : 'drive');
  }
  return { res, data };
}

const call = async (method, url, opts) => (await request(method, url, opts)).data;

/**
 * Datei mit Metadaten hochladen (anlegen: POST …/files, ersetzen: PATCH …/files/<id>). Bis 4,5 MB in einem
 * Aufruf („multipart“), größer (z. B. Aktenauszug mit vielen Bildern) über eine Upload-Sitzung („resumable“).
 */
async function upload(method, url, metadata, docx) {
  if (docx.length <= MULTIPART_MAX) {
    const { body, headers } = multipart(metadata, docx);
    return call(method, `${url}?uploadType=multipart&fields=id,webViewLink`, { body, headers });
  }
  const { res } = await request(method, `${url}?uploadType=resumable&fields=id,webViewLink`, {
    json: metadata,
    headers: { 'X-Upload-Content-Type': DOCX_MIME, 'X-Upload-Content-Length': String(docx.length) },
  });
  const session = res.headers.get('location');
  if (!session || !/^https:\/\/www\.googleapis\.com\//.test(session)) throw fail('Google Drive: Upload-Sitzung konnte nicht gestartet werden.');
  return call('PUT', session, { body: docx, headers: { 'Content-Type': DOCX_MIME } });
}

function multipart(metadata, docx) {
  const boundary = `ps-${crypto.randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`),
    docx,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
}

/* ---------------------------------------------------------------- Ordner */
function folders() {
  try {
    return JSON.parse(getSetting('google_folders', '{}')) || {};
  } catch {
    return {};
  }
}

async function folderFor(kind) {
  const f = folders();
  if (!f.root) {
    f.root = (await call('POST', `${DRIVE}/files?fields=id`, { json: { name: FOLDERS.root, mimeType: FOLDER_MIME } })).id;
    setSetting('google_folders', JSON.stringify(f));
  }
  if (!f[kind]) {
    f[kind] = (await call('POST', `${DRIVE}/files?fields=id`, { json: { name: FOLDERS[kind], mimeType: FOLDER_MIME, parents: [f.root] } })).id;
    setSetting('google_folders', JSON.stringify(f));
  }
  return f[kind];
}

/* ---------------------------------------------------------------- Dokumente */
/** Neues Google Doc aus einer DOCX-Datei; danach „Jeder mit dem Link: Betrachter“. */
async function createDoc(kind, name, docx, retried = false) {
  let file;
  try {
    file = await upload('POST', `${UPLOAD}/files`, { name, mimeType: GDOC_MIME, parents: [await folderFor(kind)] }, docx);
  } catch (err) {
    // Ordner in Drive gelöscht → neu anlegen und noch einmal versuchen
    if (err.code === 'not_found' && !retried) {
      setSetting('google_folders', '{}');
      return createDoc(kind, name, docx, true);
    }
    throw err;
  }
  await share(file.id);
  return { id: file.id, url: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit?usp=sharing` };
}

async function share(fileId) {
  await call('POST', `${DRIVE}/files/${encodeURIComponent(fileId)}/permissions?fields=id`, { json: { type: 'anyone', role: 'reader', allowFileDiscovery: false } });
}

/** Inhalt eines bestehenden Google Docs ersetzen – Datei, Link und Freigabe bleiben gleich. */
async function updateDoc(fileId, name, docx) {
  const file = await upload('PATCH', `${UPLOAD}/files/${encodeURIComponent(fileId)}`, { name }, docx);
  return { id: file.id, url: file.webViewLink || null };
}

/** In den Papierkorb von Google Drive (dort noch 30 Tage wiederherstellbar; der Link funktioniert nicht mehr). */
async function trashDoc(fileId) {
  try {
    await call('PATCH', `${DRIVE}/files/${encodeURIComponent(fileId)}`, { json: { trashed: true } });
  } catch (err) {
    if (err.code !== 'not_found') throw err;
  }
}

function status(req) {
  return {
    configured: configured(),
    connected: connected(),
    account: getSetting('google_account', '') || null,
    connectedAt: getSetting('google_connected_at', '') || null,
    connectedBy: getSetting('google_connected_by', '') || null,
    error: getSetting('google_error', '') || null,
    redirectUri: req ? redirectUri(req) : null,
  };
}

module.exports = { configured, connected, authorizeUrl, connect, disconnect, createDoc, updateDoc, trashDoc, status, DRIVE_SCOPE };
