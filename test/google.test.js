'use strict';
/*
 * Google Docs: Kanzlei-Konto verbinden, Docs automatisch anlegen (öffentlich lesbar), automatische Aktualisierung
 * bei Bezahlung und Unterschrift, „Freigabe beenden“ bleibt beendet, Rechte von Mandanten, gelöschte Datei in
 * Drive, Sicherung außer Haus (privater Ordner, Upload in Stücken, Aufräumen, Warnung), Trennen – gegen die
 * nachgebaute Google-Schnittstelle (test/googleStub.js). Es geht nichts an Google.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, client, TEAM, docxText } = require('./helpers');

let server;
let stateFile;
const as = {};
const data = {};
const stub = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const fileOf = (url) => stub().files[url.match(/\/d\/([^/]+)/)[1]];
const docx = (id, version) => fs.readFileSync(`${stateFile}.files/${id}-v${version}.docx`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctl = (o) => fs.writeFileSync(`${stateFile}.ctl`, JSON.stringify(o || {}));

/** Warten, bis eine Bedingung (async) einen Wert liefert. */
async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(150);
  }
}
/** Warten, bis der Server für ein Dokument automatisch ein Google Doc angelegt hat. */
const waitForDoc = (kind, id) => waitFor(async () => (await as.admin.get(`/api/google/docs/${kind}/${id}`)).json.doc);

/** Kanzlei-Konto (erneut) verbinden – wie der Klick auf „Verbinden“ samt Rückkehr von Google. */
async function connectGoogle() {
  const go = await as.admin.get('/api/google/connect');
  const cb = await as.admin.get(`/api/google/callback?code=abc&state=${new URL(go.location).searchParams.get('state')}`);
  assert.match(cb.location, /google=verbunden/);
}

/** PNG aus Zufallsrauschen (lässt sich nicht komprimieren): w×h Pixel, bei 900×900 ~2,4 MB. */
function png(w, h) {
  const zlib = require('node:zlib');
  const crypto = require('node:crypto');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) crypto.randomFillSync(raw, y * (w * 3 + 1) + 1, w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Warten, bis Google (Fake) eine neue Fassung hat – Aktualisierungen laufen gesammelt im Hintergrund. */
async function waitForVersion(id, version, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = stub().files[id];
    if (f && f.version >= version) return f;
    await new Promise((r) => setTimeout(r, 150));
  }
  return stub().files[id];
}

before(async () => {
  stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pake-scha-google-')), 'stub.json');
  server = await startServer({
    preload: [path.join(__dirname, 'googleStub.js')],
    env: { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret-1234567890', GOOGLE_STUB_STATE: stateFile },
  });
  as.admin = client(server.base);
  as.anwalt = client(server.base);
  await as.admin.login(TEAM.admin);
  await as.anwalt.login(TEAM.anwalt);
  // Mandant mit eigener Akte, Rechnung und Mandatsvertrag
  as.mandant = client(server.base);
  await as.mandant.post('/api/auth/register', { displayName: 'Greta Google', email: 'greta.google', password: 'Mandanten-Passwort-7' });
  data.caseId = (await as.mandant.post('/api/cases', { title: 'Mietstreit Vinewood', area: 'zivilrecht', description: 'Der Vermieter behält die Kaution ohne Grund ein.' })).json.case.id;
  data.invoiceId = (await as.admin.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Beratung', quantity: 1, unitPrice: 15000 }] })).json.invoice.id;
  const tpl = (await as.admin.get('/api/contract-templates')).json.templates.find((t) => t.kind !== 'schriftsatz');
  const defaults = (await as.admin.get(`/api/cases/${data.caseId}/contracts/defaults`)).json;
  const k = await as.admin.post(`/api/cases/${data.caseId}/contracts`, { templateId: tpl.id, lawyerId: defaults.lawyerId, data: { ...defaults.data, mandant: 'Greta Google' } });
  assert.equal(k.status, 201, k.text);
  data.contractId = k.json.contract.id;
  // ein Beweisfoto – für die wöchentliche Bilder-Sicherung im Google Drive
  const foto = await as.admin.upload(`/api/cases/${data.caseId}/attachments?caption=Mietvertrag`, png(8, 8), 'image/png');
  assert.equal(foto.status, 201, foto.text);
});
after(async () => {
  if (server) await server.stop();
});

describe('Google Docs', () => {
  it('ist eingerichtet, aber noch nicht verbunden', async () => {
    const st = await as.admin.get('/api/google/status');
    assert.equal(st.status, 200);
    assert.equal(st.json.configured, true);
    assert.equal(st.json.connected, false);
    assert.match(st.json.redirectUri, /\/api\/google\/callback$/);
    const r = await as.admin.post(`/api/google/docs/invoice/${data.invoiceId}`);
    assert.equal(r.status, 409);
    const b = await as.admin.get('/api/admin/backups');
    assert.equal(b.json.drive.connected, false);
    assert.equal(b.json.drive.db, null);
  });

  it('nur das Board verbindet, Anwälte und Mandanten nicht', async () => {
    assert.equal((await as.anwalt.get('/api/google/status')).status, 403);
    assert.equal((await as.mandant.get('/api/google/status')).status, 403);
    assert.equal((await as.mandant.post('/api/google/disconnect')).status, 403);
  });

  it('verbindet das Kanzlei-Konto (nur drive.file, Token verschlüsselt, nie im Frontend)', async () => {
    const go = await as.admin.get('/api/google/connect');
    assert.equal(go.status, 302);
    const auth = new URL(go.location);
    assert.equal(auth.hostname, 'accounts.google.com');
    assert.deepEqual(auth.searchParams.get('scope').split(' ').sort(), ['email', 'https://www.googleapis.com/auth/drive.file', 'openid']);
    assert.equal(auth.searchParams.get('access_type'), 'offline');
    // falscher Sicherheitswert → abgelehnt
    assert.match((await as.admin.get('/api/google/callback?code=abc&state=falsch')).location, /google=sitzung/);
    const go2 = await as.admin.get('/api/google/connect');
    const cb = await as.admin.get(`/api/google/callback?code=abc&state=${new URL(go2.location).searchParams.get('state')}`);
    assert.match(cb.location, /google=verbunden/);
    const st = await as.admin.get('/api/google/status');
    assert.equal(st.json.connected, true);
    assert.equal(st.json.account, 'kanzlei.pake.scha@gmail.com');
    assert.ok(!st.text.includes('rt-kanzlei-geheim'), 'Refresh-Token darf nie ausgeliefert werden');
  });

  it('ohne Google-Zugriff auf Drive wird die Verbindung abgelehnt', async () => {
    const go = await as.admin.get('/api/google/connect');
    const cb = await as.admin.get(`/api/google/callback?code=ohne-drive&state=${new URL(go.location).searchParams.get('state')}`);
    assert.match(cb.location, /google=drive/);
    assert.equal((await as.admin.get('/api/google/status')).json.connected, true, 'bestehende Verbindung bleibt');
  });

  it('legt nach dem Verbinden automatisch Google Docs an – Rechnung und Mandatsvertrag, öffentlich lesbar', async () => {
    const doc = await waitForDoc('invoice', data.invoiceId);
    assert.ok(doc, 'Rechnung bekommt ohne Klick ein Google Doc');
    const f = fileOf(doc.url);
    assert.equal(f.mimeType, 'application/vnd.google-apps.document', 'als Google Doc umgewandelt');
    assert.match(f.sourceType, /wordprocessingml/);
    assert.deepEqual(f.permissions, [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }]);
    const folders = Object.values(stub().files).filter((x) => x.mimeType.endsWith('folder')).map((x) => x.name);
    assert.ok(folders.includes('Pake & Scha – Dokumente') && folders.includes('Rechnungen & Honorare'));
    const text = docxText(docx(f.id, 1));
    assert.match(text, /Greta Google/);
    assert.match(text, /15\.000 \$/);
    assert.doesNotMatch(text, /BEZAHLT/);
    data.invoiceFile = f.id;
    const k = await waitForDoc('contract', data.contractId);
    assert.ok(k, 'Mandatsvertrag bekommt ohne Klick ein Google Doc');
    data.contractFile = fileOf(k.url).id;
    assert.equal(stub().files[data.contractFile].version, 1);
    // Kanzlei: Links stehen gleich in der Akte und in der Rechnungsliste (für den Knopf „Google Doc“) …
    const det = (await as.admin.get(`/api/cases/${data.caseId}`)).json;
    assert.equal(det.invoices.find((i) => i.id === data.invoiceId).googleDoc, doc.url);
    assert.equal(det.contracts.find((x) => x.id === data.contractId).googleDoc, k.url);
    assert.equal((await as.admin.get('/api/invoices')).json.invoices.find((i) => i.id === data.invoiceId).googleDoc, doc.url);
    // … Mandanten bekommen sie dort nicht (sie öffnen ihre Dokumente wie bisher über die Website)
    const mine = (await as.mandant.get(`/api/cases/${data.caseId}`)).json;
    assert.equal(mine.invoices[0].googleDoc, undefined);
    assert.equal(mine.contracts[0].googleDoc, undefined);
  });

  it('bezahlt → Google Doc automatisch mit Stempel, gleicher Link', async () => {
    assert.equal((await as.admin.patch(`/api/invoices/${data.invoiceId}`, { status: 'bezahlt' })).status, 200);
    const f = await waitForVersion(data.invoiceFile, 2);
    assert.equal(f.version, 2);
    assert.match(docxText(docx(f.id, 2)), /BEZAHLT/);
    const again = await as.admin.get(`/api/google/docs/invoice/${data.invoiceId}`);
    assert.ok(again.json.doc.url.includes(data.invoiceFile), 'Link bleibt gleich');
  });

  it('Unterschrift im Mandatsvertrag erscheint automatisch im Google Doc', async () => {
    const id = data.contractFile;
    assert.doesNotMatch(docxText(docx(id, 1)), /digital unterschrieben am/);
    const sign = await as.admin.post(`/api/contracts/${data.contractId}/sign`, { as: 'anwalt' });
    assert.equal(sign.status, 200, sign.text);
    const f = await waitForVersion(id, 2);
    assert.equal(f.version, 2);
    assert.match(docxText(docx(id, 2)), /digital unterschrieben am \d\d\.\d\d\.\d{4}, \d\d:\d\d/);
    // Mandant unterschreibt im Portal
    const m = await as.mandant.post(`/api/contracts/${data.contractId}/sign`, { as: 'mandant', name: 'Greta Google' });
    assert.equal(m.status, 200, m.text);
    const f3 = await waitForVersion(id, 3);
    assert.equal(f3.version, 3);
    const text = docxText(docx(id, 3));
    assert.equal((text.match(/digital unterschrieben am/g) || []).length, 2, 'Anwalt und Mandant');
  });

  it('neue Rechnungen und Schriftsätze bekommen sofort ein Google Doc', async () => {
    const inv = await as.admin.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Schriftsatz Klage', quantity: 1, unitPrice: 8000 }] });
    assert.equal(inv.status, 201, inv.text);
    data.invoice2 = inv.json.invoice.id;
    assert.ok(await waitForDoc('invoice', data.invoice2));
    const tpl = (await as.admin.get('/api/contract-templates')).json.templates.find((t) => t.kind === 'schriftsatz');
    const defaults = (await as.admin.get(`/api/cases/${data.caseId}/contracts/defaults`)).json;
    const k = await as.admin.post(`/api/cases/${data.caseId}/contracts`, { templateId: tpl.id, lawyerId: defaults.lawyerId, data: { ...defaults.data, mandant: 'Greta Google' } });
    assert.equal(k.status, 201, k.text);
    const doc = await waitForDoc('contract', k.json.contract.id);
    assert.ok(doc, 'Schriftsatz bekommt ohne Klick ein Google Doc');
    const folder = stub().files[fileOf(doc.url).parents[0]];
    assert.equal(folder.name, 'Verträge & Schriftsätze');
  });

  it('„Freigabe beenden“ bleibt beendet – bis jemand das Doc selbst wieder anlegt', async () => {
    assert.equal((await as.admin.del(`/api/google/docs/invoice/${data.invoice2}`)).status, 200);
    // getrennt neue Rechnung anlegen, dann neu verbinden: der Server holt fehlende Docs der Reihe nach nach
    await as.admin.post('/api/google/disconnect');
    const inv3 = (await as.admin.post('/api/invoices', { caseId: data.caseId, items: [{ description: 'Akteneinsicht', quantity: 1, unitPrice: 2000 }] })).json.invoice.id;
    assert.equal((await as.admin.get(`/api/google/docs/invoice/${inv3}`)).json.doc, null, 'ohne Verbindung kein Doc');
    await connectGoogle();
    assert.ok(await waitForDoc('invoice', inv3), 'fehlendes Doc wird nachgeholt');
    assert.equal((await as.admin.get(`/api/google/docs/invoice/${data.invoice2}`)).json.doc, null, 'beendete Freigabe wird nicht neu angelegt');
    const again = await as.admin.post(`/api/google/docs/invoice/${data.invoice2}`);
    assert.equal(again.status, 201, again.text);
    assert.equal(fileOf(again.json.doc.url).permissions[0].type, 'anyone');
  });

  it('Mandant: sieht den Link seiner Dokumente, legt aber selbst keine an', async () => {
    const inv = await as.mandant.get(`/api/google/docs/invoice/${data.invoiceId}`);
    assert.equal(inv.status, 200);
    assert.ok(inv.json.doc && inv.json.doc.url);
    assert.equal(inv.json.canCreate, false);
    assert.equal((await as.mandant.post(`/api/google/docs/invoice/${data.invoiceId}`)).status, 403);
    assert.equal((await as.mandant.get(`/api/google/docs/extract/${data.caseId}`)).status, 404, 'Aktenauszug-Docs nur für die Kanzlei');
    const fremd = client(server.base);
    await fremd.post('/api/auth/register', { displayName: 'Fritz Fremd', email: 'fritz.fremd', password: 'Fremdes-Passwort-7' });
    assert.equal((await fremd.get(`/api/google/docs/invoice/${data.invoiceId}`)).status, 404);
  });

  it('Aktenauszug mit gewählten Abschnitten', async () => {
    const r = await as.admin.post(`/api/google/docs/extract/${data.caseId}`, { options: { invoices: false, internal: true, unbekannt: true } });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.doc.options.invoices, false);
    assert.equal(r.json.doc.options.internal, true);
    assert.equal(r.json.doc.options.unbekannt, undefined, 'nur bekannte Abschnitte');
    const text = docxText(docx(fileOf(r.json.doc.url).id, 1));
    assert.match(text, /Aktenauszug/);
    assert.match(text, /Vertraulich/);
    assert.doesNotMatch(text, /Rechnungen & Honorare/);
  });

  it('große Dokumente (Aktenauszug mit Bildern über 5 MB) gehen per Upload-Sitzung', async () => {
    // Bilder aus Zufallsrauschen (lassen sich nicht komprimieren): ~2,4 MB je PNG
    for (let i = 1; i <= 3; i++) {
      const r = await as.admin.upload(`/api/cases/${data.caseId}/attachments?caption=Beweisfoto%20${i}`, png(900, 900), 'image/png');
      assert.equal(r.status, 201, r.text);
    }
    const r = await as.admin.post(`/api/google/docs/extract/${data.caseId}`, { options: { attachments: true, images: true } });
    assert.equal(r.status, 200, r.text); // Doc gab es schon → neu geschrieben
    const f = fileOf(r.json.doc.url);
    assert.equal(f.upload, 'resumable');
    assert.ok(f.size > 5 * 1024 * 1024, `Größe ${f.size}`);
    const text = docxText(docx(f.id, f.version));
    for (let i = 1; i <= 3; i++) assert.match(text, new RegExp(`Nr\\. ${i + 1} – Beweisfoto ${i}`)); // Nr. 1 ist das Foto vom Anfang
  });

  it('in Drive gelöschtes Doc wird beim nächsten Mal neu angelegt', async () => {
    fs.writeFileSync(`${stateFile}.ctl`, JSON.stringify({ deleted: [data.invoiceFile] }));
    const r = await as.admin.post(`/api/google/docs/invoice/${data.invoiceId}`);
    fs.writeFileSync(`${stateFile}.ctl`, '{}');
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.json.doc.url.includes(data.invoiceFile), 'neuer Link');
    assert.equal(fileOf(r.json.doc.url).permissions[0].type, 'anyone');
  });

  it('Freigabe beenden → Doc in den Drive-Papierkorb', async () => {
    const url = (await as.admin.get(`/api/google/docs/extract/${data.caseId}`)).json.doc.url;
    assert.equal((await as.admin.del(`/api/google/docs/extract/${data.caseId}`)).status, 200);
    assert.equal(fileOf(url).trashed, true);
    assert.equal((await as.admin.get(`/api/google/docs/extract/${data.caseId}`)).json.doc, null);
  });

  it('Sicherung außer Haus: nach dem Verbinden liegt eine Kopie im privaten Ordner im Google Drive', async () => {
    const b = await waitFor(async () => {
      const r = (await as.admin.get('/api/admin/backups')).json;
      return r.drive.db && r.drive.media ? r : null;
    });
    assert.ok(b, 'Datenbank und Bilder im Drive');
    assert.equal(b.drive.connected, true);
    assert.equal(b.drive.error, null);
    assert.ok(!JSON.stringify(b).includes('rt-kanzlei-geheim'), 'kein Token im Frontend');
    data.backupFolder = new URL(b.drive.folderUrl).pathname.split('/').pop();
    const folder = stub().files[data.backupFolder];
    assert.equal(folder.name, 'Pake & Scha – Sicherungen');
    assert.deepEqual(folder.parents, [], 'eigener Ordner ganz oben – nicht unter den geteilten Dokumenten');
    const files = Object.values(stub().files).filter((f) => f.parents && f.parents.includes(data.backupFolder));
    for (const f of [folder, ...files]) assert.deepEqual(f.permissions, [], `${f.name} ist nicht freigegeben`);
    // Datenbank: echte SQLite-Datei, gleich groß wie die Sicherung auf der Disk, ohne Login-Sitzungen
    const dbFile = files.find((f) => f.name === b.drive.db.name);
    assert.equal(dbFile.mimeType, 'application/x-sqlite3');
    assert.equal(dbFile.size, b.backups.find((x) => x.name === b.drive.db.name).size);
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(`${stateFile}.files/${dbFile.id}-v1.db`, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
      assert.ok(copy.prepare("SELECT COUNT(*) AS n FROM cases WHERE title = 'Mietstreit Vinewood'").get().n === 1);
    } finally {
      copy.close();
    }
    // Bilder: .tar.gz mit dem Beweisfoto
    const archive = files.find((f) => f.name === b.drive.media.name);
    assert.match(archive.name, /^pake-scha-bilder-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
    const tar = require('node:zlib').gunzipSync(fs.readFileSync(`${stateFile}.files/${archive.id}-v1.tar.gz`));
    assert.match(tar.toString('latin1'), /uploads\/evidence/);
    assert.ok(b.drive.media.files >= 1);
  });

  it('„Jetzt sichern“ kopiert sofort ins Google Drive – in Stücken, auch wenn Google nur Teile annimmt', async () => {
    ctl({ partialUpload: true });
    await sleep(1100); // Sicherungen von Hand tragen die Uhrzeit (Sekunden) im Namen
    const r = await as.admin.post('/api/admin/backups', {});
    ctl({});
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.drive.db.name, r.json.backup.name);
    const f = Object.values(stub().files).find((x) => x.name === r.json.backup.name);
    assert.ok(f.chunks > 1, `${f.chunks} Stücke`);
    assert.ok(fs.readFileSync(`${stateFile}.files/${f.id}-v1.db`).equals(fs.readFileSync(path.join(server.dir, 'backups', r.json.backup.name))), 'Inhalt unverändert');
  });

  it('alte Kopien im Drive werden aufgeräumt (wie auf der Disk; Bilder: die letzten 4)', async () => {
    const ago = (n) => new Date(Date.now() - n * 864e5);
    const day = (n) => ago(n).toISOString().slice(0, 10);
    const parents = [data.backupFolder];
    ctl({
      add: [
        { id: 'alt-db-60', name: `pake-scha-${day(60)}.db`, parents, createdTime: ago(60).toISOString() },
        { id: 'alt-db-3', name: `pake-scha-${day(3)}.db`, parents, createdTime: ago(3).toISOString() },
        ...[7, 14, 21, 28, 35].map((n) => ({ id: `alt-bilder-${n}`, name: `pake-scha-bilder-${day(n)}.tar.gz`, parents, createdTime: ago(n).toISOString() })),
      ],
    });
    await sleep(1100);
    const r = await as.admin.post('/api/admin/backups', {});
    ctl({});
    assert.equal(r.status, 201, r.text);
    const has = (id) => !!stub().files[id];
    assert.equal(has('alt-db-60'), false, 'älter als 5 Wochen → gelöscht');
    assert.equal(has('alt-db-3'), true, 'aus den letzten 7 Tagen → bleibt');
    assert.deepEqual([7, 14, 21, 28, 35].map((n) => has(`alt-bilder-${n}`)), [true, true, true, false, false], 'Bilder: die 4 neuesten bleiben');
    assert.ok(stub().removed.includes('alt-db-60'), 'endgültig gelöscht, nicht nur im Papierkorb');
  });

  it('klappt das Hochladen dreimal nicht, wird das Board gewarnt – danach Entwarnung', async () => {
    ctl({ failUpload: true });
    for (let i = 0; i < 3; i++) {
      await sleep(1100);
      const r = await as.admin.post('/api/admin/backups', {});
      assert.equal(r.status, 201, 'die Sicherung auf der Disk klappt trotzdem');
      assert.match(r.json.drive.error, /Backend Error/);
    }
    let alerts = (await as.admin.get('/api/admin/alerts')).json.alerts;
    assert.ok(alerts.some((a) => a.key === 'drive-backup'), JSON.stringify(alerts));
    ctl({});
    await sleep(1100);
    const ok = await as.admin.post('/api/admin/backups', {});
    assert.equal(ok.json.drive.error, null);
    assert.equal(ok.json.drive.db.name, ok.json.backup.name);
    alerts = (await as.admin.get('/api/admin/alerts')).json.alerts;
    assert.ok(!alerts.some((a) => a.key === 'drive-backup'));
  });

  it('Trennen widerruft den Zugang bei Google', async () => {
    const r = await as.admin.post('/api/google/disconnect');
    assert.equal(r.status, 200);
    assert.equal(r.json.connected, false);
    assert.ok(stub().revoked.includes('rt-kanzlei-geheim'));
    assert.equal((await as.admin.post(`/api/google/docs/invoice/${data.invoiceId}`)).status, 409);
    const b = (await as.admin.get('/api/admin/backups')).json;
    assert.equal(b.drive.connected, false);
    assert.equal(b.drive.folderUrl, null);
  });
});
