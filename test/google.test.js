'use strict';
/*
 * Google Docs: Kanzlei-Konto verbinden, Docs anlegen (öffentlich lesbar), automatische Aktualisierung bei
 * Bezahlung und Unterschrift, Rechte von Mandanten, gelöschte Datei in Drive, Trennen – gegen die nachgebaute
 * Google-Schnittstelle (test/googleStub.js). Es geht nichts an Google.
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

  it('legt die Rechnung als öffentlich lesbares Google Doc an', async () => {
    const r = await as.admin.post(`/api/google/docs/invoice/${data.invoiceId}`);
    assert.equal(r.status, 201, r.text);
    const f = fileOf(r.json.doc.url);
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
    const r = await as.admin.post(`/api/google/docs/contract/${data.contractId}`);
    assert.equal(r.status, 201, r.text);
    const id = fileOf(r.json.doc.url).id;
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
    // Bild aus Zufallsrauschen (lässt sich nicht komprimieren): ~2,4 MB je PNG
    const zlib = require('node:zlib');
    const crypto = require('node:crypto');
    const png = (w, h) => {
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
    };
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
    for (let i = 1; i <= 3; i++) assert.match(text, new RegExp(`Nr\\. ${i} – Beweisfoto ${i}`));
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

  it('Trennen widerruft den Zugang bei Google', async () => {
    const r = await as.admin.post('/api/google/disconnect');
    assert.equal(r.status, 200);
    assert.equal(r.json.connected, false);
    assert.ok(stub().revoked.includes('rt-kanzlei-geheim'));
    assert.equal((await as.admin.post(`/api/google/docs/invoice/${data.invoiceId}`)).status, 409);
  });
});
