'use strict';
/*
 * Verträge zu Akten (z. B. Mandatsvertrag) und deren Vorlagen.
 *
 * /api/contract-templates          – Vorlagen lesen (Team), pflegen (Board of Partners)
 * /api/cases/:id/contracts         – Vertrag anlegen, Vorbelegung der Felder
 * /api/contracts/:cid              – ansehen, ändern (solange niemand unterschrieben hat), löschen, unterschreiben
 *
 * Unterschriften: jeder im Vertrag genannte Anwalt unterschreibt selbst (optional mehrere – der erste steht in
 * case_contracts.lawyer_id, weitere in case_contract_lawyers); der Mandant unterschreibt im Portal (Name eintippen)
 * – oder die Kanzlei erfasst, dass er im Spiel unterschrieben hat. Vollständig unterschrieben ist der Vertrag erst,
 * wenn alle Anwälte und der Mandant unterschrieben haben. Nach der ersten Unterschrift ist der Inhalt gesperrt.
 */
const express = require('express');
const { z } = require('zod');
const { db, tx, getSetting, setSetting } = require('../db');
const { requireAuth, requireStaff, requireAdmin, isStaff } = require('../auth');
const { wrap, parseBody, idParam, truncate } = require('../helpers');
const { getCase, caseAccess, caseLawyers, addSystemNote, logActivity } = require('../models');
const discord = require('../discord');
const tickets = require('../tickets');
const contracts = require('../contracts');

const header = () => getSetting('contract_header', contracts.DEFAULT_HEADER);
const AREA_LABEL = { strafrecht: 'Strafrecht', zivilrecht: 'Zivilrecht', verfassungsrecht: 'Verfassungsrecht', vertragsrecht: 'Vertragsrecht', sonstiges: 'Sonstiges' };
const text = (max) => z.string().trim().max(max);
const FIELD_MAX = { grundgebuehr: 200, zusatzgebuehr: 200, leistungen: 3000 };
const fieldSchema = z.object(Object.fromEntries(Object.keys(contracts.FIELDS).map((k) => [k, text(FIELD_MAX[k] || 120).optional()])));
// Aus der Honorarordnung gewählte Leistungen (Mehrfachauswahl mit Menge)
const servicesSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(160), price: z.number().int().min(0).max(1e10), qty: z.number().int().min(1).max(99) }))
  .max(30);
// Weitere unterzeichnende Anwälte (Name und Rang kommen aus dem Benutzerkonto, das Geburtsdatum aus dem Formular)
const coLawyersSchema = z.array(z.object({ id: z.number().int().positive(), birth: text(40).optional() })).max(contracts.MAX_CO_LAWYERS);

const usd = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;
/**
 * Leistungen übernehmen: Liste für {{leistungen}} (je Zeile eine) und – falls leer gelassen –
 * die Summe als Grundgebühr.
 */
function applyServices(data, services) {
  if (services === undefined) return data;
  const out = { ...data, services };
  out.leistungen = services
    .map((s) => (s.qty > 1 ? `• ${s.qty} × ${s.name} à ${usd(s.price)} = ${usd(s.qty * s.price)}` : `• ${s.name} – ${usd(s.price)}`))
    .join('\n');
  if (services.length && !String(out.grundgebuehr || '').trim()) out.grundgebuehr = usd(services.reduce((sum, s) => sum + s.qty * s.price, 0));
  return out;
}

function parseData(raw) {
  try {
    const d = JSON.parse(raw || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

const CONTRACT_SELECT = `
  SELECT k.*, lu.display_name AS lawyer_name, lu.rank AS lawyer_rank,
         (SELECT COUNT(*) FROM case_contract_lawyers cl WHERE cl.contract_id = k.id) AS co_count,
         (SELECT COUNT(*) FROM case_contract_lawyers cl WHERE cl.contract_id = k.id AND cl.signed_at IS NOT NULL) AS co_signed
  FROM case_contracts k LEFT JOIN users lu ON lu.id = k.lawyer_id`;

const coLawyersOf = (contractId) => db.prepare('SELECT * FROM case_contract_lawyers WHERE contract_id = ? ORDER BY sort_order, id').all(contractId);
/** Alle Anwälte haben unterschrieben (der erste und alle weiteren). */
const lawyersDone = (k) => !!k.lawyer_signed_at && Number(k.co_signed || 0) >= Number(k.co_count || 0);
const anySigned = (k) => !!(k.lawyer_signed_at || k.client_signed_at || Number(k.co_signed || 0) > 0);
const fullySigned = (k) => lawyersDone(k) && !!k.client_signed_at;

function statusOf(k) {
  if (fullySigned(k)) return 'unterschrieben';
  if (anySigned(k)) return 'teilweise';
  return 'entwurf';
}

function contractRow(k, { withBody = false } = {}) {
  const co = Number(k.co_count || 0) ? coLawyersOf(k.id) : [];
  return {
    id: k.id,
    caseId: k.case_id,
    templateName: k.template_name,
    body: withBody ? k.body : undefined,
    data: parseData(k.data),
    lawyerId: k.lawyer_id,
    lawyerName: k.lawyer_name || null,
    lawyerSignature: k.lawyer_signature || null,
    lawyerSignedAt: k.lawyer_signed_at || null,
    coLawyers: co.map((l) => ({ userId: l.user_id, name: l.name, rank: l.rank, birth: l.birth, signature: l.signature || null, signedAt: l.signed_at || null })),
    lawyersSigned: lawyersDone(k),
    clientSignature: k.client_signature || null,
    clientSignedAt: k.client_signed_at || null,
    clientSignedVia: k.client_signed_via || null,
    clientRecordedByName: k.client_recorded_by_name || '',
    status: statusOf(k),
    locked: anySigned(k),
    createdByName: k.created_by_name,
    createdAt: k.created_at,
    updatedAt: k.updated_at,
  };
}

/** Für die Aktenansicht: alle Verträge der Akte (Mandanten sehen die Verträge ihrer eigenen Akte). */
function contractsForCase(caseId) {
  return db.prepare(`${CONTRACT_SELECT} WHERE k.case_id = ? ORDER BY k.created_at DESC, k.id DESC`).all(caseId).map((k) => contractRow(k));
}

/**
 * Als welcher Anwalt kann u (noch) unterschreiben? { slot: 'main' } für den ersten, { slot: 'co', row } für einen
 * weiteren – oder null. Wer schon unterschrieben hat, bekommt null. name = Unterschrift (Anzeigename des Kontos).
 */
function lawyerSlot(k, u) {
  if (!isStaff(u)) return null;
  if (k.lawyer_id === u.id && !k.lawyer_signed_at) return { slot: 'main', name: u.display_name };
  if (!Number(k.co_count || 0)) return null;
  const row = db.prepare('SELECT * FROM case_contract_lawyers WHERE contract_id = ? AND user_id = ? AND signed_at IS NULL').get(k.id, u.id);
  return row ? { slot: 'co', row, name: u.display_name } : null;
}

/** Wer darf was an diesem Vertrag? */
function permissions(k, c, u) {
  const access = caseAccess(c, u);
  const locked = anySigned(k);
  const slot = lawyerSlot(k, u);
  return {
    canView: access.canView,
    canEdit: access.canEdit && !locked,
    canDelete: u.role === 'admin' || (access.canEdit && !locked),
    canSignLawyer: !!slot,
    lawyerSignName: slot ? slot.name : null,
    canSignClient: u.role === 'mandant' && c.client_id === u.id && !k.client_signed_at,
    canRecordClient: access.canEdit && !k.client_signed_at,
    canReset: u.role === 'admin' && locked,
  };
}

/** Anwalt für den Vertrag: jemand aus dem Aktenteam – das Board of Partners darf jeden aktiven Anwalt wählen. */
function checkLawyer(lawyerId, c, u) {
  const lawyer = db.prepare("SELECT id, display_name, rank FROM users WHERE id = ? AND role IN ('anwalt','admin') AND active = 1").get(lawyerId);
  if (!lawyer) return { error: 'Der gewählte Anwalt existiert nicht oder ist deaktiviert.' };
  const onTeam = caseLawyers(c).some((l) => l.id === lawyer.id);
  if (!onTeam && u.role !== 'admin') return { error: `Unterzeichnen kann nur ein Anwalt, der der Akte zugewiesen ist (${lawyer.display_name} ist es nicht).` };
  return { lawyer };
}

/** Weitere Anwälte prüfen: keine Doppelten, nicht der erste Anwalt, jeder wie bei checkLawyer. */
function checkCoLawyers(list, mainId, c, u) {
  const out = [];
  for (const entry of list) {
    if (entry.id === mainId) return { error: 'Der erste unterzeichnende Anwalt steht bereits im Vertrag – bitte nicht zusätzlich als weiteren Anwalt wählen.' };
    if (out.some((x) => x.lawyer.id === entry.id)) return { error: 'Jeder Anwalt kann nur einmal im Vertrag stehen.' };
    const { lawyer, error } = checkLawyer(entry.id, c, u);
    if (error) return { error };
    out.push({ lawyer, birth: entry.birth || '' });
  }
  return { list: out };
}

/** Weitere Anwälte speichern (ersetzt die bisherigen – nur solange niemand unterschrieben hat). */
function saveCoLawyers(contractId, list) {
  db.prepare('DELETE FROM case_contract_lawyers WHERE contract_id = ?').run(contractId);
  const ins = db.prepare('INSERT INTO case_contract_lawyers (contract_id, user_id, name, rank, birth, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  list.forEach((x, i) => ins.run(contractId, x.lawyer.id, x.lawyer.display_name, x.lawyer.rank || '', x.birth, i + 1));
}

/** Alle Anwälte des Vertrags für Anzeigen: [{ name, signature, signedAt }] – der erste zuerst. */
function allLawyers(k) {
  return [
    { name: parseData(k.data).anwalt || k.lawyer_name || '—', signature: k.lawyer_signature, signedAt: k.lawyer_signed_at },
    ...(Number(k.co_count || 0) ? coLawyersOf(k.id) : []).map((l) => ({ name: l.name, signature: l.signature, signedAt: l.signed_at })),
  ];
}
const lawyerNames = (k) => allLawyers(k).map((l) => l.name).join(', ');

function notifySigned(c, k, who, user) {
  const full = fullySigned(k);
  const lawyers = allLawyers(k);
  discord.notify('contract.signed', {
    title: `${c.case_number}: ${k.template_name} ${full ? 'vollständig unterschrieben' : `vom ${who} unterschrieben`}`,
    description: truncate(c.title, 300),
    color: full ? 0x10b981 : discord.GOLD,
    fields: [
      { name: 'Mandant', value: parseData(k.data).mandant || c.client_account_name || c.client_name || '—' },
      { name: lawyers.length > 1 ? 'Anwälte' : 'Anwalt', value: lawyers.map((l) => `${l.signedAt ? '✅' : '⏳'} ${l.name}`).join('\n') },
      { name: 'Unterschrift', value: who === 'Mandanten' && k.client_signed_via === 'kanzlei' ? `im Spiel (erfasst von ${user.display_name})` : user.display_name },
    ],
    mentionIds: caseLawyers(c)
      .filter((l) => l.discordId && l.id !== user.id)
      .map((l) => l.discordId),
  });
}

/* ================================================================ /api/contract-templates */
const templatesRouter = express.Router();
templatesRouter.use(requireAuth, requireStaff);

const templateRow = (t) => ({
  id: t.id,
  key: t.key,
  name: t.name,
  body: t.body,
  active: !!t.active,
  isDefault: !!t.key,
  updatedByName: t.updated_by_name,
  updatedAt: t.updated_at,
});

templatesRouter.get('/', (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin';
  const rows = db.prepare(`SELECT * FROM contract_templates ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`).all();
  res.json({
    templates: rows.map(templateRow),
    header: header(),
    fields: contracts.FIELDS,
    autoFields: contracts.AUTO_FIELDS,
    defaultPlace: contracts.DEFAULT_PLACE,
  });
});

const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  body: z.string().max(contracts.MAX_BODY),
  active: z.boolean().optional(),
});

function checkBody(body, res) {
  if (!body.trim()) {
    res.status(400).json({ error: 'Die Vorlage ist leer.' });
    return false;
  }
  const unknown = contracts.unknownPlaceholders(body);
  if (unknown.length) {
    res.status(400).json({ error: `Unbekannte Platzhalter: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Erlaubt sind die Felder aus der Liste.` });
    return false;
  }
  return true;
}

templatesRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parseBody(templateSchema, req, res);
    if (!d || !checkBody(d.body, res)) return;
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM contract_templates').get().n;
    const info = db
      .prepare('INSERT INTO contract_templates (name, body, active, sort_order, updated_by_name) VALUES (?, ?, ?, ?, ?)')
      .run(d.name, d.body, d.active === false ? 0 : 1, order, req.user.display_name);
    logActivity(req.user, 'Vertragsvorlage angelegt', 'contract_template', Number(info.lastInsertRowid), d.name);
    res.status(201).json({ template: templateRow(db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(Number(info.lastInsertRowid))) });
  })
);

templatesRouter.patch(
  '/:tid',
  requireAdmin,
  wrap(async (req, res) => {
    const tid = idParam(req, 'tid');
    const t = tid && db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(tid);
    if (!t) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
    const d = parseBody(templateSchema.partial(), req, res);
    if (!d) return;
    if (d.body !== undefined && !checkBody(d.body, res)) return;
    db.prepare(
      "UPDATE contract_templates SET name = ?, body = ?, active = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(d.name ?? t.name, d.body ?? t.body, d.active === undefined ? t.active : d.active ? 1 : 0, req.user.display_name, t.id);
    logActivity(req.user, 'Vertragsvorlage geändert', 'contract_template', t.id, d.name ?? t.name);
    res.json({ template: templateRow(db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(t.id)) });
  })
);

/** Mitgelieferte Vorlage auf den ursprünglichen Text zurücksetzen. */
templatesRouter.post(
  '/:tid/reset',
  requireAdmin,
  wrap(async (req, res) => {
    const tid = idParam(req, 'tid');
    const t = tid && db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(tid);
    const def = t && contracts.DEFAULT_TEMPLATES.find((x) => x.key === t.key);
    if (!def) return res.status(404).json({ error: 'Nur mitgelieferte Vorlagen lassen sich zurücksetzen.' });
    db.prepare("UPDATE contract_templates SET name = ?, body = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?").run(
      def.name,
      def.body,
      req.user.display_name,
      t.id
    );
    logActivity(req.user, 'Vertragsvorlage zurückgesetzt', 'contract_template', t.id, def.name);
    res.json({ template: templateRow(db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(t.id)) });
  })
);

templatesRouter.delete(
  '/:tid',
  requireAdmin,
  wrap(async (req, res) => {
    const tid = idParam(req, 'tid');
    const t = tid && db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(tid);
    if (!t) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
    // Bestehende Verträge behalten ihren Text – er ist beim Erstellen kopiert worden.
    db.prepare('DELETE FROM contract_templates WHERE id = ?').run(t.id);
    // Mitgelieferte Vorlage nicht beim nächsten Start wieder anlegen.
    if (t.key) setSetting(`seeded_contract_${t.key}`, new Date().toISOString());
    logActivity(req.user, 'Vertragsvorlage gelöscht', 'contract_template', t.id, t.name);
    res.json({ success: true });
  })
);

templatesRouter.put(
  '/header',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parseBody(z.object({ header: z.string().trim().max(300) }), req, res);
    if (!d) return;
    setSetting('contract_header', d.header);
    res.json({ header: header() });
  })
);

/* ================================================================ /api/cases/:id/contracts */
const caseRouter = express.Router({ mergeParams: true });
caseRouter.use(requireAuth, requireStaff);

function loadCase(req, res) {
  const id = idParam(req);
  const c = id && getCase(id);
  if (!c || !caseAccess(c, req.user).canView) {
    res.status(404).json({ error: 'Akte nicht gefunden.' });
    return null;
  }
  return c;
}

/**
 * Vorbelegung: Anwalt (Name, Rang, Geburtsdatum aus seinem letzten Vertrag), Mandant (Name aus der Akte,
 * Geburtsdatum aus einem früheren Vertrag desselben Mandanten), heutiges Datum, Ort.
 */
caseRouter.get('/defaults', (req, res) => {
  const c = loadCase(req, res);
  if (!c) return;
  const team = caseLawyers(c);
  const wanted = Number(req.query.lawyerId) || (team.some((l) => l.id === req.user.id) ? req.user.id : team[0]?.id) || req.user.id;
  const lawyer = db.prepare("SELECT id, display_name, rank FROM users WHERE id = ? AND role IN ('anwalt','admin')").get(wanted);
  const lastOfLawyer = lawyer && db.prepare('SELECT data FROM case_contracts WHERE lawyer_id = ? ORDER BY id DESC LIMIT 1').get(lawyer.id);
  const clientName = c.client_account_name || c.client_name || '';
  const lastOfClient = c.client_id
    ? db.prepare('SELECT k.data FROM case_contracts k JOIN cases x ON x.id = k.case_id WHERE x.client_id = ? ORDER BY k.id DESC LIMIT 1').get(c.client_id)
    : null;
  const clientBirth = lastOfClient ? parseData(lastOfClient.data).mandant_geburtsdatum || '' : '';
  // Geburtsdaten (IC) der Anwälte aus ihren letzten Verträgen – für weitere unterzeichnende Anwälte
  const births = {};
  for (const r of db.prepare("SELECT user_id, birth FROM case_contract_lawyers WHERE user_id IS NOT NULL AND birth != '' ORDER BY id").all()) births[r.user_id] = r.birth;
  for (const r of db.prepare('SELECT lawyer_id, data FROM case_contracts WHERE lawyer_id IS NOT NULL ORDER BY id').all()) {
    const b = parseData(r.data).anwalt_geburtsdatum;
    if (b) births[r.lawyer_id] = b;
  }
  res.json({
    births,
    maxCoLawyers: contracts.MAX_CO_LAWYERS,
    lawyerId: lawyer ? lawyer.id : null,
    team: team.map((l) => ({ id: l.id, name: l.name, lead: l.lead })),
    data: {
      anwalt: lawyer ? lawyer.display_name : '',
      anwalt_rang: lawyer ? lawyer.rank || '' : '',
      anwalt_geburtsdatum: lastOfLawyer ? parseData(lastOfLawyer.data).anwalt_geburtsdatum || '' : '',
      mandant: clientName === '—' ? '' : clientName,
      mandant_geburtsdatum: clientBirth,
      grundgebuehr: '',
      zusatzgebuehr: '',
      datum: new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }),
      ort: contracts.DEFAULT_PLACE,
    },
  });
});

caseRouter.post(
  '/',
  wrap(async (req, res) => {
    const c = loadCase(req, res);
    if (!c) return;
    if (!caseAccess(c, req.user).canEdit) return res.status(403).json({ error: 'Verträge erstellen dürfen die zuständigen Anwälte und das Board of Partners.' });
    const d = parseBody(
      z.object({ templateId: z.number().int().positive(), lawyerId: z.number().int().positive(), coLawyers: coLawyersSchema.optional(), data: fieldSchema, services: servicesSchema.optional() }),
      req,
      res
    );
    if (!d) return;
    const t = db.prepare('SELECT * FROM contract_templates WHERE id = ? AND active = 1').get(d.templateId);
    if (!t) return res.status(404).json({ error: 'Vorlage nicht gefunden.' });
    const { lawyer, error } = checkLawyer(d.lawyerId, c, req.user);
    if (error) return res.status(400).json({ error });
    const co = checkCoLawyers(d.coLawyers || [], lawyer.id, c, req.user);
    if (co.error) return res.status(400).json({ error: co.error });
    const names = [lawyer.display_name, ...co.list.map((x) => x.lawyer.display_name)];
    const count = db.prepare('SELECT COUNT(*) AS n FROM case_contracts WHERE case_id = ?').get(c.id).n;
    if (count >= 20) return res.status(400).json({ error: 'Pro Akte sind höchstens 20 Verträge möglich.' });
    const id = tx(() => {
      const info = db
        .prepare('INSERT INTO case_contracts (case_id, template_name, body, data, lawyer_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.id, t.name, t.body, JSON.stringify(applyServices(d.data, d.services)), lawyer.id, req.user.id, req.user.display_name);
      saveCoLawyers(Number(info.lastInsertRowid), co.list);
      addSystemNote(c.id, req.user, `${t.name} erstellt (${names.length > 1 ? `unterzeichnende Anwälte: ${names.join(', ')}` : `unterzeichnender Anwalt: ${lawyer.display_name}`}).`);
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      return Number(info.lastInsertRowid);
    });
    logActivity(req.user, 'Vertrag erstellt', 'case', c.id, `${c.case_number}: ${t.name}`);
    tickets.post(c.id, {
      title: `📝 ${t.name} erstellt`,
      description: `Der Vertrag liegt im Mandantenportal unter der Akte ${c.case_number} bereit – bitte prüfen und unterschreiben.`,
      fields: [{ name: names.length > 1 ? 'Unterzeichnende Anwälte' : 'Unterzeichnender Anwalt', value: names.join('\n') }],
      mention: 'client',
      by: req.user.display_name,
      byDiscordId: req.user.discord_id,
    });
    res.status(201).json({ contract: contractRow(db.prepare(`${CONTRACT_SELECT} WHERE k.id = ?`).get(id)) });
  })
);

/* ================================================================ /api/contracts/:cid */
const router = express.Router();
router.use(requireAuth);

function loadContract(req, res) {
  const cid = idParam(req, 'cid');
  const k = cid && db.prepare(`${CONTRACT_SELECT} WHERE k.id = ?`).get(cid);
  const c = k && getCase(k.case_id);
  if (!k || !c || !caseAccess(c, req.user).canView) {
    res.status(404).json({ error: 'Vertrag nicht gefunden.' });
    return {};
  }
  return { k, c, can: permissions(k, c, req.user) };
}

router.get('/:cid', (req, res) => {
  const { k, c, can } = loadContract(req, res);
  if (!k) return;
  res.json({
    contract: contractRow(k, { withBody: true }),
    case: { id: c.id, caseNumber: c.case_number, title: c.title, area: AREA_LABEL[c.area] || c.area },
    header: header(),
    can,
  });
});

router.patch(
  '/:cid',
  requireStaff,
  wrap(async (req, res) => {
    const { k, c, can } = loadContract(req, res);
    if (!k) return;
    if (!can.canEdit) {
      return res.status(403).json({ error: anySigned(k) ? 'Der Vertrag ist bereits unterschrieben und kann nicht mehr geändert werden.' : 'Keine Berechtigung.' });
    }
    const d = parseBody(
      z.object({ lawyerId: z.number().int().positive().optional(), coLawyers: coLawyersSchema.optional(), data: fieldSchema.optional(), services: servicesSchema.optional() }),
      req,
      res
    );
    if (!d) return;
    let lawyerId = k.lawyer_id;
    const data = applyServices(d.data ? { ...parseData(k.data), ...d.data } : parseData(k.data), d.services);
    if (d.lawyerId !== undefined && d.lawyerId !== k.lawyer_id) {
      const { lawyer, error } = checkLawyer(d.lawyerId, c, req.user);
      if (error) return res.status(400).json({ error });
      lawyerId = lawyer.id;
      // Name und Rang im Vertragstext folgen dem neuen Anwalt, sofern nicht ausdrücklich mitgeschickt.
      if (!d.data || d.data.anwalt === undefined) data.anwalt = lawyer.display_name;
      if (!d.data || d.data.anwalt_rang === undefined) data.anwalt_rang = lawyer.rank || '';
    }
    // Weitere Anwälte: neu gesetzt, oder die bisherigen behalten (der erste darf dann nicht darunter sein)
    let co = null;
    if (d.coLawyers !== undefined) {
      co = checkCoLawyers(d.coLawyers, lawyerId, c, req.user);
    } else if (lawyerId !== k.lawyer_id && coLawyersOf(k.id).some((l) => l.user_id === lawyerId)) {
      co = { error: 'Der gewählte Anwalt steht bereits als weiterer Anwalt im Vertrag.' };
    }
    if (co && co.error) return res.status(400).json({ error: co.error });
    tx(() => {
      db.prepare("UPDATE case_contracts SET data = ?, lawyer_id = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), lawyerId, k.id);
      if (co) saveCoLawyers(k.id, co.list);
    });
    res.json({ contract: contractRow(db.prepare(`${CONTRACT_SELECT} WHERE k.id = ?`).get(k.id)) });
  })
);

router.delete(
  '/:cid',
  requireStaff,
  wrap(async (req, res) => {
    const { k, c, can } = loadContract(req, res);
    if (!k) return;
    if (!can.canDelete) return res.status(403).json({ error: 'Unterschriebene Verträge kann nur das Board of Partners löschen.' });
    tx(() => {
      db.prepare('DELETE FROM case_contracts WHERE id = ?').run(k.id);
      addSystemNote(c.id, req.user, `${k.template_name} gelöscht${statusOf(k) !== 'entwurf' ? ' (war bereits unterschrieben)' : ''}.`);
    });
    logActivity(req.user, 'Vertrag gelöscht', 'case', c.id, `${c.case_number}: ${k.template_name}`);
    res.json({ success: true });
  })
);

const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * as = 'anwalt'   → ein im Vertrag genannter Anwalt unterschreibt (der erste oder ein weiterer)
 * as = 'mandant'  → der Mandant unterschreibt im Portal (Name eintippen)
 * as = 'erfassen' → die Kanzlei hält fest, dass der Mandant im Spiel unterschrieben hat
 */
router.post(
  '/:cid/sign',
  wrap(async (req, res) => {
    const { k, c, can } = loadContract(req, res);
    if (!k) return;
    const d = parseBody(z.object({ as: z.enum(['anwalt', 'mandant', 'erfassen']), name: z.string().trim().max(120).optional() }), req, res);
    if (!d) return;
    const u = req.user;
    const data = parseData(k.data);
    let note;
    if (d.as === 'anwalt') {
      const slot = lawyerSlot(k, u);
      if (!slot) {
        const already = (k.lawyer_id === u.id && k.lawyer_signed_at) || db.prepare('SELECT 1 FROM case_contract_lawyers WHERE contract_id = ? AND user_id = ? AND signed_at IS NOT NULL').get(k.id, u.id);
        return res.status(403).json({ error: already ? 'Sie haben bereits unterschrieben.' : `Unterschreiben können nur die im Vertrag genannten Anwälte (${lawyerNames(k)}).` });
      }
      if (slot.slot === 'main') {
        db.prepare("UPDATE case_contracts SET lawyer_signature = ?, lawyer_signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(u.display_name, k.id);
      } else {
        tx(() => {
          db.prepare("UPDATE case_contract_lawyers SET signature = ?, signed_at = datetime('now') WHERE id = ?").run(u.display_name, slot.row.id);
          db.prepare("UPDATE case_contracts SET updated_at = datetime('now') WHERE id = ?").run(k.id);
        });
      }
      note = `${k.template_name} vom Anwalt unterschrieben (${u.display_name}).`;
    } else if (d.as === 'mandant') {
      if (!can.canSignClient) return res.status(403).json({ error: k.client_signed_at ? 'Sie haben bereits unterschrieben.' : 'Keine Berechtigung.' });
      const typed = (d.name || '').replace(/\s+/g, ' ').trim();
      if (typed.length < 3) return res.status(400).json({ error: 'Bitte zum Unterschreiben Ihren vollständigen Namen eintippen.' });
      if (data.mandant && normName(typed) !== normName(data.mandant)) {
        return res.status(400).json({ error: `Der eingetippte Name stimmt nicht mit dem Namen im Vertrag überein („${data.mandant}“).` });
      }
      // Unterschrift in der Schreibweise des Vertrags (Groß-/Kleinschreibung beim Eintippen egal)
      const signature = data.mandant || typed;
      db.prepare(
        "UPDATE case_contracts SET client_signature = ?, client_signed_at = datetime('now'), client_signed_via = 'portal', updated_at = datetime('now') WHERE id = ?"
      ).run(signature, k.id);
      note = `${k.template_name} vom Mandanten im Portal unterschrieben (${signature}).`;
    } else {
      if (!can.canRecordClient) return res.status(403).json({ error: k.client_signed_at ? 'Der Mandant hat bereits unterschrieben.' : 'Keine Berechtigung.' });
      const name = data.mandant || c.client_account_name || c.client_name || 'Mandant';
      db.prepare(
        "UPDATE case_contracts SET client_signature = ?, client_signed_at = datetime('now'), client_signed_via = 'kanzlei', client_recorded_by_name = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(name, u.display_name, k.id);
      note = `${k.template_name}: Unterschrift des Mandanten (im Spiel) erfasst von ${u.display_name}.`;
    }
    const updated = db.prepare(`${CONTRACT_SELECT} WHERE k.id = ?`).get(k.id);
    const full = fullySigned(updated);
    tx(() => {
      addSystemNote(c.id, u, note + (full ? ' Der Vertrag ist vollständig unterschrieben.' : ''));
      db.prepare("UPDATE cases SET updated_at = datetime('now') WHERE id = ?").run(c.id);
    });
    notifySigned(c, updated, d.as === 'anwalt' ? 'Anwalt' : 'Mandanten', u);
    const lawyers = allLawyers(updated);
    const openLawyers = lawyers.filter((l) => !l.signedAt).map((l) => l.name);
    tickets.post(c.id, {
      title: full ? `✅ ${k.template_name} vollständig unterschrieben` : `✍️ ${k.template_name} vom ${d.as === 'anwalt' ? 'Anwalt' : 'Mandanten'} unterschrieben`,
      description: full
        ? `${lawyers.length > 1 ? 'Alle' : 'Beide'} Unterschriften liegen vor – der Vertrag ist wirksam.`
        : `Jetzt fehlt noch die Unterschrift ${[
            ...(openLawyers.length ? [`${openLawyers.length > 1 ? 'der Anwälte' : 'von'} ${openLawyers.join(', ')}`] : []),
            ...(updated.client_signed_at ? [] : ['des Mandanten (im Mandantenportal)']),
          ].join(' und ')}.`,
      color: full ? tickets.COLORS.green : tickets.COLORS.gold,
      fields: [
        { name: lawyers.length > 1 ? 'Anwälte' : 'Anwalt', value: lawyers.map((l) => (l.signedAt ? `✅ ${l.signature}` : `⏳ ${l.name} – offen`)).join('\n') },
        { name: 'Mandant', value: updated.client_signed_at ? `✅ ${updated.client_signature}${updated.client_signed_via === 'kanzlei' ? ' (im Spiel)' : ''}` : '⏳ offen' },
      ],
      // Mandant erwähnen, solange seine Unterschrift fehlt und gerade ein Anwalt unterschrieben hat – sonst die Anwälte
      mention: d.as === 'anwalt' && !updated.client_signed_at ? 'client' : 'lawyers',
      by: u.display_name,
      byDiscordId: u.discord_id,
    });
    res.json({ contract: contractRow(updated, { withBody: true }), can: permissions(updated, c, u) });
  })
);

/** Board of Partners: Unterschriften zurücksetzen (z. B. versehentlich unterschrieben). */
router.post(
  '/:cid/reset',
  requireAdmin,
  wrap(async (req, res) => {
    const { k, c } = loadContract(req, res);
    if (!k) return;
    tx(() => {
      db.prepare(
        `UPDATE case_contracts SET lawyer_signature = NULL, lawyer_signed_at = NULL, client_signature = NULL, client_signed_at = NULL,
                client_signed_via = NULL, client_recorded_by_name = '', updated_at = datetime('now') WHERE id = ?`
      ).run(k.id);
      db.prepare('UPDATE case_contract_lawyers SET signature = NULL, signed_at = NULL WHERE contract_id = ?').run(k.id);
    });
    addSystemNote(c.id, req.user, `${k.template_name}: Unterschriften zurückgesetzt.`);
    const updated = db.prepare(`${CONTRACT_SELECT} WHERE k.id = ?`).get(k.id);
    res.json({ contract: contractRow(updated, { withBody: true }), can: permissions(updated, c, req.user) });
  })
);

module.exports = { router, caseRouter, templatesRouter, contractsForCase };
