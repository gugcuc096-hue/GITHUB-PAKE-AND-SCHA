'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { PUBLIC_MEDIA_DIR, EVIDENCE_DIR } = require('./db');

const MAX_BYTES = 3 * 1024 * 1024;

// Bilder kommen als rohe Binärdaten (Content-Type image/*). Der Browser verkleinert sie vorher.
const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_BYTES });

/** Erkennt das Bildformat anhand der Datei-Signatur -- nie anhand von Endung oder Content-Type. */
function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

const DIRS = {
  avatars: path.join(PUBLIC_MEDIA_DIR, 'avatars'),
  team: path.join(PUBLIC_MEDIA_DIR, 'team'),
  evidence: EVIDENCE_DIR,
};

/** Prüft und speichert Bilddaten; gibt { file, mime, size } zurück oder wirft einen 400-Fehler. */
function saveImageBuffer(buf, kind) {
  const info = detectImage(buf);
  if (!info) {
    const err = new Error('Bitte ein Bild im Format JPG, PNG oder WebP hochladen.');
    err.status = 400;
    throw err;
  }
  const file = `${crypto.randomBytes(12).toString('hex')}.${info.ext}`;
  fs.writeFileSync(path.join(DIRS[kind], file), buf);
  return { file, mime: info.mime, size: buf.length };
}

/** Prüft und speichert ein hochgeladenes Bild (Rohdaten im Request-Body). */
function saveImage(req, kind) {
  return saveImageBuffer(req.body, kind);
}

/** Löscht eine gespeicherte Datei; nur einfache Dateinamen (kein Pfad) werden akzeptiert. */
function removeFile(kind, file) {
  if (!file || file !== path.basename(file)) return;
  fs.rm(path.join(DIRS[kind], file), { force: true }, () => {});
}

function evidencePath(file) {
  return path.join(EVIDENCE_DIR, path.basename(file));
}

const avatarUrl = (file) => (file ? `/media/avatars/${file}` : null);
const teamPhotoUrl = (file) => (file ? `/media/team/${file}` : null);

module.exports = { imageBody, detectImage, saveImage, saveImageBuffer, removeFile, evidencePath, avatarUrl, teamPhotoUrl, MAX_BYTES };
