'use strict';
/*
 * Verschlüsselung für den Dauerbetrieb – alles, was ins Google Drive geht, ist mit AES-256-GCM verschlüsselt (auch
 * Google kann es nicht lesen) und bei Datenbank-Ständen zusätzlich gepackt.
 *
 * Dateiformat: "PSE1" | Merkmale (1 Byte: 1 = gzip) | IV (12) | verschlüsselte Daten | Prüfsumme (16)
 *
 * Wiederherstellungs-Schlüssel (für Render → DAUERBETRIEB_SCHLUESSEL): "PSD1." + base64url( IV | Prüfsumme | Daten )
 * mit { v, rt (Refresh-Token), k (Datenschlüssel) }, verschlüsselt mit einem Schlüssel aus GOOGLE_CLIENT_SECRET.
 * Ohne das Secret aus Render ist er wertlos.
 */
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const MAGIC = Buffer.from('PSE1');
const HEAD = 4 + 1 + 12;
const TAG = 16;

const recoveryCipherKey = (secret) => crypto.createHash('sha256').update(`pake-scha-dauerbetrieb|${secret}`).digest();

function sealRecovery(data, secret) {
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET fehlt.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', recoveryCipherKey(secret), iv);
  const enc = Buffer.concat([c.update(JSON.stringify({ v: 1, ...data }), 'utf8'), c.final()]);
  return `PSD1.${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url')}`;
}

/** Liefert { rt, k: Buffer } oder wirft mit verständlicher Meldung. */
function unsealRecovery(text, secret) {
  const s = String(text || '').trim();
  if (!s.startsWith('PSD1.')) throw new Error('Der Wiederherstellungs-Schlüssel ist ungültig (er beginnt mit „PSD1.“).');
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET fehlt in Render – ohne ihn lässt sich der Schlüssel nicht lesen.');
  try {
    const raw = Buffer.from(s.slice(5), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', recoveryCipherKey(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    const k = Buffer.from(String(o.k || ''), 'base64');
    if (!o.rt || k.length !== 32) throw new Error('unvollständig');
    return { rt: String(o.rt), k };
  } catch {
    throw new Error('Der Wiederherstellungs-Schlüssel passt nicht zu GOOGLE_CLIENT_SECRET (falsch kopiert oder das Secret wurde geändert).');
  }
}

/** Kennung eines Datenschlüssels (zum Vergleichen, ohne ihn zu verraten). */
const keyId = (k) => crypto.createHash('sha256').update(Buffer.concat([Buffer.from('ps-key-id|'), k])).digest('hex').slice(0, 12);

/* ---------------------------------------------------------------- im Speicher (Journal, Bilder) */
function encrypt(buf, key, { gzip = false } = {}) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = gzip ? zlib.gzipSync(buf, { level: 6 }) : buf;
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, Buffer.from([gzip ? 1 : 0]), iv, enc, c.getAuthTag()]);
}

function decrypt(buf, key) {
  if (!Buffer.isBuffer(buf) || buf.length < HEAD + TAG || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Keine verschlüsselte Sicherung dieser Anwendung.');
  const flags = buf[4];
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(5, HEAD));
  d.setAuthTag(buf.subarray(buf.length - TAG));
  let out;
  try {
    out = Buffer.concat([d.update(buf.subarray(HEAD, buf.length - TAG)), d.final()]);
  } catch {
    throw new Error('Die Sicherung lässt sich nicht entschlüsseln (falscher Schlüssel oder beschädigte Datei).');
  }
  return flags & 1 ? zlib.gunzipSync(out) : out;
}

/* ---------------------------------------------------------------- Dateien (Gesamtstand der Datenbank) */
/** Datei packen und verschlüsseln; liefert { bytes, plainBytes, sha256 } (sha256 über den Klartext). */
async function encryptFile(src, dst, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const hash = crypto.createHash('sha256');
  let plainBytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      plainBytes += chunk.length;
      cb(null, chunk);
    },
  });
  const out = fs.createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, Buffer.from([1]), iv]));
  await pipeline(fs.createReadStream(src), tap, zlib.createGzip({ level: 6 }), c, out, { end: false }).catch(async (err) => {
    out.destroy();
    throw err;
  });
  await new Promise((resolve, reject) => out.end(c.getAuthTag(), (err) => (err ? reject(err) : resolve())));
  return { bytes: fs.statSync(dst).size, plainBytes, sha256: hash.digest('hex') };
}

/** Gegenstück: entschlüsseln und entpacken; liefert { sha256, bytes } des Klartexts. */
async function decryptFile(src, dst, key) {
  const size = fs.statSync(src).size;
  if (size < HEAD + TAG) throw new Error('Die Sicherung ist unvollständig.');
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(HEAD);
  const tag = Buffer.alloc(TAG);
  try {
    fs.readSync(fd, head, 0, HEAD, 0);
    fs.readSync(fd, tag, 0, TAG, size - TAG);
  } finally {
    fs.closeSync(fd);
  }
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('Keine verschlüsselte Sicherung dieser Anwendung.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(5, HEAD));
  d.setAuthTag(tag);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  const steps = [fs.createReadStream(src, { start: HEAD, end: size - TAG - 1 }), d];
  if (head[4] & 1) steps.push(zlib.createGunzip());
  try {
    await pipeline(...steps, tap, fs.createWriteStream(dst));
  } catch (err) {
    fs.rmSync(dst, { force: true });
    if (/auth|unable to authenticate/i.test(err.message)) throw new Error('Die Sicherung lässt sich nicht entschlüsseln (falscher Schlüssel oder beschädigte Datei).');
    throw err;
  }
  return { sha256: hash.digest('hex'), bytes };
}

module.exports = { sealRecovery, unsealRecovery, keyId, encrypt, decrypt, encryptFile, decryptFile };
