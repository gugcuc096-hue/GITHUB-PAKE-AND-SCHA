'use strict';
/*
 * Ticket-Verlauf sichern: Bevor der Kanal einer Akte gelöscht wird (Dashboard, /delete), holt der Bot alle Nachrichten
 * (bis 1000) und legt sie als eigenständige HTML-Seite in der Akte ab – nur für die Kanzlei sichtbar
 * (Akte → Discord-Ticket → „Verlauf“). Alles wird maskiert; die Seite lädt keine Skripte (eigene CSP beim Abruf).
 */
const { db } = require('./db');

const MAX_PAGES = 10;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
};
const safeUrl = (u) => (/^https:\/\//.test(String(u || '')) ? esc(u) : '');

function messageHtml(m) {
  const name = m.author ? m.author.global_name || m.author.username || 'Unbekannt' : 'Unbekannt';
  const parts = [];
  if (m.content) parts.push(`<div class="text">${esc(m.content)}</div>`);
  for (const e of m.embeds || []) {
    const fields = (e.fields || []).map((f) => `<div class="f"><b>${esc(f.name)}</b> ${esc(f.value)}</div>`).join('');
    parts.push(`<div class="embed">${e.title ? `<div class="et">${esc(e.title)}</div>` : ''}${e.description ? `<div class="text">${esc(e.description)}</div>` : ''}${fields}</div>`);
  }
  for (const a of m.attachments || []) {
    const url = safeUrl(a.url);
    if (url) parts.push(`<div class="att">📎 <a href="${url}" rel="noreferrer">${esc(a.filename || 'Anhang')}</a></div>`);
  }
  return `<div class="msg${m.author && m.author.bot ? ' bot' : ''}"><div class="head"><span class="name">${esc(name)}</span><span class="time">${esc(when(m.timestamp))}</span></div>${parts.join('') || '<div class="text dim">(ohne Text)</div>'}</div>`;
}

function pageHtml(c, channelName, messages) {
  const brand = require('./brand').accent(); // Kanzleifarbe (Einstellungen → Stil & Saison)
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket-Verlauf ${esc(c.case_number)}</title><style>
body{margin:0;background:#050a18;color:#e5e7eb;font:15px/1.55 system-ui,sans-serif}main{max-width:820px;margin:0 auto;padding:28px 18px}
h1{font:600 22px/1.3 Georgia,serif;color:${brand.light};margin:0 0 4px}.sub{color:#94a3b8;font-size:13px;margin-bottom:22px}
.msg{padding:10px 0;border-top:1px solid rgba(255,255,255,.07)}.head{display:flex;gap:10px;align-items:baseline}.name{font-weight:600;color:#fff}
.bot .name{color:${brand.hex}}.time{color:#64748b;font-size:12px}.text{white-space:pre-wrap;word-break:break-word}.dim{color:#64748b}
.embed{margin-top:6px;padding:8px 12px;border-left:3px solid ${brand.hex};background:rgba(255,255,255,.04);border-radius:6px}.et{font-weight:600}
.f{font-size:13px;color:#cbd5e1}.att a{color:#93c5fd}</style></head><body><main>
<h1>Ticket-Verlauf · ${esc(c.case_number)}</h1><div class="sub">${esc(c.title)} · Kanal #${esc(channelName || '')} · ${messages.length} Nachrichten · gesichert ${esc(when(new Date().toISOString()))}</div>
${messages.map(messageHtml).join('\n')}
</main></body></html>`;
}

/** Nachrichten des Kanals holen (älteste zuerst) und als Verlauf der Akte speichern. Liefert die id oder null. */
async function saveCaseTranscript(caseId, channelId, rest) {
  const c = db.prepare('SELECT id, case_number, title FROM cases WHERE id = ?').get(caseId);
  if (!c) return null; // Akte schon im Papierkorb
  const channel = await rest('GET', `/channels/${channelId}`).catch(() => null);
  const all = [];
  let before = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await rest('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  if (!all.length) return null;
  all.reverse();
  const html = pageHtml(c, channel && channel.name, all);
  const info = db
    .prepare('INSERT INTO ticket_transcripts (case_id, channel_name, message_count, html) VALUES (?, ?, ?, ?)')
    .run(c.id, (channel && channel.name) || '', all.length, html);
  return Number(info.lastInsertRowid);
}

const listForCase = (caseId) =>
  db
    .prepare('SELECT id, channel_name, message_count, created_at FROM ticket_transcripts WHERE case_id = ? ORDER BY id DESC')
    .all(caseId)
    .map((t) => ({ id: t.id, channel: t.channel_name, count: t.message_count, createdAt: t.created_at }));

module.exports = { saveCaseTranscript, listForCase, _test: { pageHtml } };
