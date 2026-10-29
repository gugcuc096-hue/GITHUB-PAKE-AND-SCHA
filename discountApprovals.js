'use strict';
/*
 * Rabatt-Freigabe: Ab einem einstellbaren Rabatt (Einstellung „Rabatt ab … % braucht Freigabe“, 0 = aus) darf eine Rechnung nur
 * mit Zustimmung des Board of Partners erstellt werden. Die Anfrage kommt als Direktnachricht mit „Genehmigen / Ablehnen“ an
 * jedes Board-Mitglied mit verknüpftem Discord (oder wird im Dashboard unter Rechnungen → Freigaben entschieden). Nach der
 * Genehmigung erstellt die anfragende Person die Rechnung wie gewohnt – mit der Freigabe als Berechtigung (einmal nutzbar,
 * höchstens bis zum genehmigten Rabatt). Das Board selbst braucht keine Freigabe.
 * Knöpfe in der Direktnachricht: disc:yes:<id> / disc:no:<id> (siehe routes/interactions.js).
 */
const { db, getSetting, setSetting } = require('./db');
const { isBoard } = require('./helpers');
const { getCase, addSystemNote, logActivity } = require('./models');
const tickets = require('./tickets');

db.exec(`
  CREATE TABLE IF NOT EXISTS discount_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    status            TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','genehmigt','abgelehnt','verwendet')),
    requested_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    requested_by_name TEXT NOT NULL DEFAULT '',
    discount_pct      REAL NOT NULL,
    subtotal          INTEGER NOT NULL DEFAULT 0,
    case_id           INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    client_name       TEXT NOT NULL DEFAULT '',
    reason            TEXT NOT NULL DEFAULT '',
    decided_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_by_name   TEXT NOT NULL DEFAULT '',
    decided_at        TEXT,
    decided_via       TEXT NOT NULL DEFAULT '',
    decision_note     TEXT NOT NULL DEFAULT '',
    invoice_id        INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const usd = (n) => `${Math.round(n).toLocaleString('de-DE')} $`;
const pct = (n) => `${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

/** Schwellwert in Prozent (0 = Freigabe aus). */
function threshold() {
  const n = Number(getSetting('discount_approval_pct', '0'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0;
}
function setThreshold(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 100) throw fail('Bitte einen Wert von 0 bis 100 angeben (0 = keine Freigabe nötig).');
  setSetting('discount_approval_pct', String(v));
  return threshold();
}
/** Braucht dieser Rabatt von dieser Person eine Freigabe? */
const needsApproval = (user, discountPct) => threshold() > 0 && Number(discountPct) > threshold() && !isBoard(user);

const STATUS = { offen: 'Wartet auf Freigabe', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt', verwendet: 'Verwendet' };
const row = (r) => ({
  id: r.id,
  status: r.status,
  statusLabel: STATUS[r.status],
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  discountPct: r.discount_pct,
  subtotal: r.subtotal,
  discountAmount: Math.round((r.subtotal * r.discount_pct) / 100),
  caseId: r.case_id,
  caseNumber: r.case_id ? (getCase(r.case_id) || {}).case_number || null : null,
  clientName: r.client_name,
  reason: r.reason,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at,
  decidedVia: r.decided_via,
  decisionNote: r.decision_note,
  invoiceId: r.invoice_id,
  createdAt: r.created_at,
});
const load = (id) => db.prepare('SELECT * FROM discount_requests WHERE id = ?').get(id) || null;
/** Board: alle; sonst nur die eigenen. */
const listFor = (user) =>
  (isBoard(user) ? db.prepare('SELECT * FROM discount_requests ORDER BY id DESC LIMIT 200').all() : db.prepare('SELECT * FROM discount_requests WHERE requested_by = ? ORDER BY id DESC LIMIT 50').all(user.id)).map(row);
const pendingCount = () => db.prepare("SELECT COUNT(*) AS n FROM discount_requests WHERE status = 'offen'").get().n;

/** Anfrage stellen: gleiche offene Anfrage derselben Person (gleicher Rabatt, gleiche Akte/Empfänger) wird wiederverwendet. */
function request(user, { discountPct, subtotal, caseId, clientName, reason }) {
  const same = db.prepare("SELECT * FROM discount_requests WHERE status = 'offen' AND requested_by = ? AND discount_pct = ? AND IFNULL(case_id, 0) = ? AND client_name = ?").get(user.id, discountPct, caseId || 0, clientName || '');
  if (same) return { request: row(same), created: false };
  const info = db
    .prepare('INSERT INTO discount_requests (requested_by, requested_by_name, discount_pct, subtotal, case_id, client_name, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.display_name, discountPct, Math.max(0, Math.round(subtotal || 0)), caseId || null, String(clientName || '').slice(0, 120), String(reason || '').slice(0, 500));
  const id = Number(info.lastInsertRowid);
  logActivity(user, 'Rabatt-Freigabe angefragt', 'discount', id, `${pct(discountPct)} · ${clientName || '—'}`);
  askBoard(id).catch(() => {});
  return { request: row(load(id)), created: true };
}

/** Direktnachricht mit Knöpfen an alle Board-Mitglieder mit verknüpftem Discord. */
async function askBoard(id) {
  const r = load(id);
  if (!r || !tickets.hasToken()) return 0;
  const c = r.case_id ? getCase(r.case_id) : null;
  const members = db.prepare("SELECT id, discord_id, role, rank FROM users WHERE active = 1 AND role IN ('admin','anwalt')").all().filter((u) => isBoard(u) && tickets.isId(u.discord_id) && u.id !== r.requested_by);
  let sent = 0;
  for (const m of members) {
    try {
      const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: m.discord_id });
      await tickets.rest('POST', `/channels/${ch.id}/messages`, {
        embeds: [
          tickets.embed({
            title: `🏷️ Rabatt-Freigabe: ${pct(r.discount_pct)}`,
            description: `**${r.requested_by_name}** möchte ${pct(r.discount_pct)} Rabatt (${usd((r.subtotal * r.discount_pct) / 100)} auf ${usd(r.subtotal)}) geben${r.client_name ? ` – Empfänger: ${r.client_name}` : ''}${c ? `, Akte ${c.case_number}` : ''}.${r.reason ? `\n\n**Begründung:** ${r.reason}` : ''}`,
          }),
        ],
        components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Genehmigen', custom_id: `disc:yes:${r.id}` }, { type: 2, style: 4, label: 'Ablehnen', custom_id: `disc:no:${r.id}` }] }],
        allowed_mentions: { parse: [] },
      });
      sent++;
    } catch {
      /* Direktnachrichten gesperrt – das Dashboard bleibt */
    }
  }
  return sent;
}

/** Entscheiden (nur Board). via: dashboard | discord. Liefert { request } oder wirft einen Fehler. */
function decide(id, user, approve, { via = 'dashboard', note = '' } = {}) {
  if (!isBoard(user)) throw fail('Freigeben kann nur das Board of Partners.', 403);
  const r = load(id);
  if (!r) throw fail('Diese Anfrage gibt es nicht.', 404);
  if (r.status !== 'offen') throw fail(`Die Anfrage ist schon entschieden (${STATUS[r.status].toLowerCase()}).`, 409);
  if (r.requested_by === user.id) throw fail('Eigene Anfragen entscheidet eine andere Person aus dem Board.', 403);
  db.prepare("UPDATE discount_requests SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = datetime('now'), decided_via = ?, decision_note = ? WHERE id = ?").run(approve ? 'genehmigt' : 'abgelehnt', user.id, user.display_name, via, String(note || '').slice(0, 300), id);
  logActivity(user, approve ? 'Rabatt genehmigt' : 'Rabatt abgelehnt', 'discount', id, `${pct(r.discount_pct)} · ${r.requested_by_name}`);
  if (r.case_id) addSystemNote(r.case_id, user, `Rabatt ${pct(r.discount_pct)} ${approve ? 'genehmigt' : 'abgelehnt'} (angefragt von ${r.requested_by_name}).`, true);
  tellRequester(load(id)).catch(() => {});
  return { request: row(load(id)) };
}

async function tellRequester(r) {
  const u = r.requested_by && db.prepare('SELECT discord_id FROM users WHERE id = ?').get(r.requested_by);
  if (!u || !tickets.isId(u.discord_id) || !tickets.hasToken()) return;
  const ok = r.status === 'genehmigt';
  const ch = await tickets.rest('POST', '/users/@me/channels', { recipient_id: u.discord_id });
  await tickets.rest('POST', `/channels/${ch.id}/messages`, {
    embeds: [tickets.embed({ title: ok ? '✅ Rabatt genehmigt' : '❌ Rabatt abgelehnt', description: `${pct(r.discount_pct)} Rabatt${r.client_name ? ` für ${r.client_name}` : ''}: ${ok ? 'Sie können die Rechnung jetzt erstellen.' : 'Bitte einen niedrigeren Rabatt wählen.'}${r.decision_note ? `\n\n${r.decision_note}` : ''}\n\nEntschieden von ${r.decided_by_name}.` })],
    allowed_mentions: { parse: [] },
  });
}

/**
 * Prüfung beim Erstellen der Rechnung: Gibt es eine passende, genehmigte und noch unbenutzte Freigabe der Person?
 * Liefert { ok: true, request } oder { ok: false, error, status }.
 */
function check(user, approvalId, discountPct) {
  const r = approvalId ? load(Number(approvalId)) : null;
  if (!r || r.requested_by !== user.id) return { ok: false, status: 403, error: `Rabatte ab ${pct(threshold())} brauchen die Freigabe des Boards.` };
  if (r.status === 'offen') return { ok: false, status: 409, error: 'Die Freigabe ist noch nicht entschieden – das Board hat die Anfrage erhalten.' };
  if (r.status === 'abgelehnt') return { ok: false, status: 409, error: `Das Board hat den Rabatt abgelehnt${r.decision_note ? `: ${r.decision_note}` : '.'}` };
  if (r.status === 'verwendet') return { ok: false, status: 409, error: 'Diese Freigabe wurde schon für eine Rechnung verwendet.' };
  if (Number(discountPct) > r.discount_pct) return { ok: false, status: 409, error: `Genehmigt sind ${pct(r.discount_pct)} – der Rabatt in der Rechnung ist höher.` };
  return { ok: true, request: r };
}
const markUsed = (id, invoiceId) => db.prepare("UPDATE discount_requests SET status = 'verwendet', invoice_id = ? WHERE id = ?").run(invoiceId, id);

module.exports = { threshold, setThreshold, needsApproval, request, decide, check, markUsed, listFor, pendingCount, row, load };
