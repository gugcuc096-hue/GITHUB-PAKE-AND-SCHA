'use strict';
/*
 * Banner, Startseite, Beschriftungen, Mitteilungstexte (Entwurf → Veröffentlichen) sowie Export/Import aller Einstellungen.
 *  GET    /api/config                    Stand aller Bereiche, die die Person bearbeiten darf
 *  PUT    /api/config/:key/draft         Entwurf speichern
 *  POST   /api/config/:key/publish       Entwurf veröffentlichen (Änderungsprotokoll)
 *  DELETE /api/config/:key/draft         Entwurf verwerfen
 *  GET    /api/config/export             alles als eine Datei
 *  POST   /api/config/import             Datei einlesen: { data, apply } – ohne apply nur die Vorschau der Änderungen
 *  GET    /api/public/site-config        Banner, Startseite, Beschriftungen für Website und Dashboard (?draft=1 = Vorschau)
 */
const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting, tx } = require('../db');
const { requireAuth, requireStaff } = require('../auth');
const { wrap, parseBody } = require('../helpers');
const perms = require('../permissions');
const siteConfig = require('../siteConfig');
const configLog = require('../configLog');
const features = require('../features');
const messages = require('../messageTemplates');
const sitePages = require('../sitePages');

const router = express.Router();
router.use(requireAuth, requireStaff);

const mayEdit = (user, key) => perms.can(user, siteConfig.SPECS[key].perm);
const keyParam = (req, res) => {
  const key = req.params.key;
  if (!siteConfig.SPECS[key]) return void res.status(404).json({ error: 'Diesen Bereich gibt es nicht.' });
  if (!mayEdit(req.user, key)) return void res.status(403).json({ error: 'Dafür fehlt Ihnen das Recht – das vergibt der Inhaber unter Einstellungen → Rechte & Schalter.' });
  return key;
};
const problems = (err) => (err.issues ? err.issues.map((i) => i.message).join(' ') : err.message);

router.get('/', (req, res) => {
  const out = {};
  for (const key of siteConfig.KEYS) {
    if (!mayEdit(req.user, key)) continue;
    out[key] = { label: siteConfig.SPECS[key].label, published: siteConfig.get(key), draft: siteConfig.getDraft(key), defaults: siteConfig.SPECS[key].defaults };
  }
  res.json({ config: out, sections: siteConfig.SECTIONS, terms: siteConfig.TERMS, messages: messages.catalog() });
});

/** Aktenzeichen-Muster ausprobieren: nächstes Zeichen ohne es zu vergeben (?pattern=…&digits=4). */
router.get('/numbering/preview', (req, res) => {
  if (!mayEdit(req.user, 'numbering')) return res.status(403).json({ error: 'Dafür fehlt Ihnen das Recht.' });
  const r = siteConfig.SPECS.numbering.schema.safeParse({ pattern: String(req.query.pattern || ''), digits: Number(req.query.digits || 4) });
  if (!r.success) return res.status(400).json({ error: problems(r.error) });
  res.json({ next: require('../numbering').preview(r.data) });
});

router.put(
  '/:key/draft',
  wrap(async (req, res) => {
    const key = keyParam(req, res);
    if (!key) return;
    try {
      res.json({ draft: siteConfig.saveDraft(key, req.body, req.user) });
    } catch (err) {
      res.status(400).json({ error: problems(err) });
    }
  })
);

router.post(
  '/:key/publish',
  wrap(async (req, res) => {
    const key = keyParam(req, res);
    if (!key) return;
    const v = siteConfig.publish(key, req.user);
    if (!v) return res.status(400).json({ error: 'Es gibt keinen Entwurf zum Veröffentlichen.' });
    res.json({ published: v });
  })
);

router.delete(
  '/:key/draft',
  wrap(async (req, res) => {
    const key = keyParam(req, res);
    if (!key) return;
    siteConfig.discardDraft(key);
    res.json({ published: siteConfig.get(key) });
  })
);

/* ---------------------------------------------------------------- Export / Import */
const EXPORT_VERSION = 1;

function settingsOf(user) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings ORDER BY key').all()) {
    const def = configLog.settingDef(r.key);
    if (def && perms.can(user, def.perm)) out[r.key] = r.value;
  }
  return out;
}
function exportAll(user) {
  const data = { kind: 'pake-scha-einstellungen', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), settings: settingsOf(user), config: {} };
  for (const key of siteConfig.KEYS) if (mayEdit(user, key)) data.config[key] = siteConfig.get(key);
  if (perms.can(user, 'site.edit')) {
    data.siteTexts = db.prepare('SELECT page, key, original, text FROM site_texts ORDER BY page, key').all();
  }
  if (perms.can(user, 'settings.edit')) data.features = features.all();
  if (perms.can(user, perms.OWNER_ONLY)) data.permissions = perms.matrix();
  return data;
}
router.get('/export', (req, res) => {
  const data = exportAll(req.user);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="pake-scha-einstellungen-${new Date().toISOString().slice(0, 10)}.json"` });
  res.send(JSON.stringify(data, null, 2));
});

const importBody = z.object({ data: z.object({ kind: z.literal('pake-scha-einstellungen'), version: z.number().int().max(EXPORT_VERSION) }).passthrough(), apply: z.boolean().optional() });

/** Was die Datei ändern würde (und darf) – oder, mit apply, wirklich ändert. */
function plan(user, data) {
  const changes = [];
  const skipped = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [key, value] of Object.entries(data.settings || {})) {
    const def = configLog.settingDef(key);
    if (!def || typeof value !== 'string' || value.length > 4000) { skipped.push(`Einstellung „${key}“ (unbekannt)`); continue; }
    if (!perms.can(user, def.perm)) { skipped.push(`Einstellung „${key}“ (kein Recht)`); continue; }
    const now = getSetting(key, null);
    if (now !== value) changes.push({ kind: 'setting', key, label: configLog.labelFor(key, def), before: now, after: value });
  }
  for (const [key, value] of Object.entries(data.config || {})) {
    const spec = siteConfig.SPECS[key];
    if (!spec) { skipped.push(`Bereich „${key}“ (unbekannt)`); continue; }
    if (!mayEdit(user, key)) { skipped.push(`${spec.label} (kein Recht)`); continue; }
    const r = spec.schema.safeParse(value);
    if (!r.success) { skipped.push(`${spec.label} (ungültig: ${problems(r.error)})`); continue; }
    const next = { ...spec.defaults, ...r.data };
    if (!same(next, siteConfig.get(key))) changes.push({ kind: 'config', key, label: spec.label, before: siteConfig.get(key), after: next });
  }
  if (Array.isArray(data.siteTexts)) {
    if (!perms.can(user, 'site.edit')) skipped.push('Website-Texte (kein Recht)');
    else {
      for (const t of data.siteTexts.slice(0, 500)) {
        if (!t || !Object.hasOwn(sitePages.PAGES, t.page) || !/^[0-9a-f]{12}$/.test(String(t.key)) || typeof t.text !== 'string' || t.text.length > 2000) continue;
        const original = sitePages.texts(t.page).get(t.key);
        if (original === undefined) { skipped.push('Website-Text (steht nicht mehr auf der Seite)'); continue; }
        const now = db.prepare('SELECT text FROM site_texts WHERE page = ? AND key = ?').get(t.page, t.key);
        if ((now ? now.text : original) !== t.text) changes.push({ kind: 'siteText', page: t.page, key: t.key, label: `Website-Text (${t.page})`, before: now ? now.text : original, after: t.text, original });
      }
    }
  }
  if (data.features && typeof data.features === 'object') {
    if (!perms.can(user, 'settings.edit')) skipped.push('Feature-Schalter (kein Recht)');
    else {
      const now = features.all();
      for (const k of features.KEYS) if (typeof data.features[k] === 'boolean' && data.features[k] !== now[k]) changes.push({ kind: 'feature', key: k, label: `Schalter „${features.FEATURES.find((f) => f.key === k).label}“`, before: now[k], after: data.features[k] });
    }
  }
  if (data.permissions) {
    if (!perms.can(user, perms.OWNER_ONLY)) skipped.push('Rechte-Tabelle (nur der Inhaber)');
    else if (!same(data.permissions, perms.matrix())) changes.push({ kind: 'permissions', key: 'perm_matrix', label: 'Rechte-Tabelle', before: perms.matrix(), after: data.permissions });
  }
  return { changes, skipped };
}

function applyChange(user, c) {
  if (c.kind === 'setting') setSetting(c.key, c.after);
  else if (c.kind === 'config') siteConfig.publish(c.key, user, c.after);
  else if (c.kind === 'siteText') {
    db.prepare(
      `INSERT INTO site_texts (page, key, original, text, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(page, key) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).run(c.page, c.key, c.original, c.after, user.id);
    configLog.add(user, { area: 'site_text', key: `${c.page}:${c.key}`, label: c.label, perm: 'site.edit', before: { original: c.original, text: c.before }, after: { original: c.original, text: c.after }, revertible: true });
  } else if (c.kind === 'feature') setSetting(`feature_${c.key}`, c.after ? '1' : '0');
  else if (c.kind === 'permissions') {
    const before = perms.matrix();
    const after = perms.saveMatrix(c.after);
    configLog.add(user, { area: 'permissions', key: 'perm_matrix', label: 'Rechte-Tabelle geändert (Import)', perm: perms.OWNER_ONLY, before, after, revertible: true });
  }
}

router.post(
  '/import',
  wrap(async (req, res) => {
    const d = parseBody(importBody, req, res);
    if (!d) return;
    const { changes, skipped } = plan(req.user, d.data);
    const view = changes.map((c) => ({ kind: c.kind, key: c.key, label: c.label, before: typeof c.before === 'object' ? '(Bereich)' : c.before, after: typeof c.after === 'object' ? '(Bereich)' : c.after }));
    if (!d.apply) return res.json({ changes: view, skipped, applied: false });
    tx(() => changes.forEach((c) => applyChange(req.user, c)));
    require('../models').logActivity(req.user, 'Einstellungen importiert', 'settings', null, `${changes.length} Änderungen`);
    res.json({ changes: view, skipped, applied: true });
  })
);

/* ---------------------------------------------------------------- Öffentlich */
const publicRouter = express.Router();
publicRouter.get('/site-config', (req, res) => {
  const draft = req.query.draft === '1' && !!req.user && perms.can(req.user, 'site.edit');
  res.json(siteConfig.publicPayload(req.user, { draft }));
});

module.exports = { router, publicRouter };
