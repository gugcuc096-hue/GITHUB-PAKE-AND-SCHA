'use strict';
/*
 * Vorab geladen von „npm run test:schnell“: tut so, als wäre Playwright nicht installiert. Alle Browser-Prüfungen
 * überspringen sich dann selbst (sie sind ohnehin optional) – übrig bleiben API- und Datei-Prüfungen.
 */
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'playwright') {
    const err = new Error("Cannot find module 'playwright' (test:schnell)");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  }
  return resolve.call(this, request, ...rest);
};
