'use strict';
/*
 * Nachgebaute Discord-Schnittstelle für die Tests – wird mit `node --require test/discordStub.js` vor dem Server
 * geladen (oder im Testprozess selbst) und fängt nur Aufrufe an discord.com ab. Es geht nichts nach außen.
 *
 * Server „Testserver“ (GUILD) mit den Rollen Burgershot (nicht erwähnbar) und Mitarbeiter (erwähnbar), dem Bot und
 * vier Mitgliedern: Jaywa und MO mit Burgershot-Rolle, „Closed Dms“ (Burgershot, nimmt keine Direktnachrichten an),
 * dazu ein Bot mit Burgershot-Rolle, der nie angeschrieben werden darf.
 *
 * DISCORD_STUB_STATE=<Datei>: Nach jedem Aufruf steht dort der Stand als JSON (gesendete Nachrichten und DMs).
 */
const fs = require('fs');

const realFetch = globalThis.fetch;
const STATE = process.env.DISCORD_STUB_STATE || '';

const GUILD = '900000000000000001';
const BOT = '900000000000000002';
const ROLES = {
  burgershot: '900000000000000010',
  mitarbeiter: '900000000000000011',
  bot: '900000000000000012',
};
const MEMBERS = {
  jaywa: '900000000000000101',
  mo: '900000000000000102',
  closed: '900000000000000103',
  otherBot: '900000000000000104',
};
const joined = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('Z', '000+00:00');
const members = [
  { user: { id: MEMBERS.jaywa, username: 'jaywa', global_name: 'Jaywa' }, nick: 'John Jaywa', roles: [ROLES.burgershot], joined_at: joined },
  { user: { id: MEMBERS.mo, username: 'mo', global_name: 'MO' }, nick: null, roles: [ROLES.burgershot, ROLES.mitarbeiter], joined_at: joined },
  { user: { id: MEMBERS.closed, username: 'closed', global_name: 'Closed Dms' }, nick: null, roles: [ROLES.burgershot], joined_at: joined },
  { user: { id: MEMBERS.otherBot, username: 'helper', bot: true }, nick: null, roles: [ROLES.burgershot], joined_at: joined },
  { user: { id: BOT, username: 'kanzlei-bot', bot: true }, nick: null, roles: [ROLES.bot], joined_at: joined },
];
const roles = [
  { id: GUILD, name: '@everyone', position: 0, permissions: '0', color: 0 },
  { id: ROLES.burgershot, name: 'Burgershot', position: 3, permissions: '0', color: 0xe67e22, mentionable: false },
  { id: ROLES.mitarbeiter, name: 'Mitarbeiter', position: 2, permissions: '0', color: 0xd4af37, mentionable: true },
  { id: ROLES.bot, name: 'Kanzlei-Bot', position: 4, permissions: '0', color: 0, managed: true },
];

const state = { calls: [], channelMessages: [], dms: [], seq: 0 };
const save = () => STATE && fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'discord.com') return realFetch(input, init);
  const method = String(init.method || 'GET').toUpperCase();
  const path = url.pathname.replace(/^\/api\/v10/, '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  state.calls.push(`${method} ${path}`);
  try {
    if (!/^Bot \S+$/.test((init.headers && init.headers.Authorization) || '')) return json(401, { message: '401: Unauthorized', code: 0 });
    if (method === 'GET' && path === '/users/@me') return json(200, { id: BOT, username: 'kanzlei-bot', global_name: 'Pake & Scha | Legal Consulting', avatar: null });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json(200, { id: GUILD, name: 'Testserver', icon: null, approximate_member_count: members.length });
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json(200, roles);
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(200, [{ id: '900000000000000500', name: 'willkommen', type: 0, position: 1 }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members`) {
      const after = url.searchParams.get('after') || '0';
      return json(200, members.filter((m) => BigInt(m.user.id) > BigInt(after)));
    }
    let m = path.match(new RegExp(`^/guilds/${GUILD}/members/(\\d+)$`));
    if (method === 'GET' && m) {
      const mem = members.find((x) => x.user.id === m[1]);
      return mem ? json(200, mem) : json(404, { message: 'Unknown Member', code: 10007 });
    }
    if (method === 'POST' && path === '/users/@me/channels') return json(200, { id: `dm-${body.recipient_id}`, type: 1 });
    m = path.match(/^\/channels\/([^/]+)\/messages$/);
    if (method === 'POST' && m) {
      if (m[1].startsWith('dm-')) {
        const to = m[1].slice(3);
        if (to === MEMBERS.closed) return json(403, { message: 'Cannot send messages to this user', code: 50007 });
        state.dms.push({ to, ...body });
      } else state.channelMessages.push({ channel: m[1], ...body });
      return json(200, { id: `msg-${++state.seq}`, channel_id: m[1] });
    }
    if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') return json(204, null);
    return json(200, {});
  } finally {
    save();
  }
};

module.exports = { state, GUILD, BOT, ROLES, MEMBERS };
