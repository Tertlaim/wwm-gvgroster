/**
 * GameVox Gateway Listener for !gvg text-trigger.
 *
 * This module runs a persistent WebSocket connection to GameVox's gateway,
 * identifies as the bot, and listens for MESSAGE_CREATE events. When a
 * user types "!gvg" (or "/gvg") in a channel, it publishes the current
 * Saturday/Sunday roster using the same HTTP-mode interactions pipeline
 * as the /gvg slash command — bypassing the client picker visibility gap.
 *
 * Cooldown: 30s per guild (shared with /gvg).
 * Role gate: Manage Messages or Administrator required.
 */

const WebSocket = require('ws');

const GATEWAY = 'wss://gateway.gamevox.com/?v=10&encoding=json';

// Module-level state
let ws = null;
let heartbeatTimer = null;
let lastSeq = null;
let sessionId = null;
let heartbeatInterval = 41250;
let backoffMs = 2000;
let ctx = null;
let cachedToken = '';

// In-memory cooldown map: guildId -> last publish timestamp (ms)
const cooldowns = new Map();
const COOLDOWN_MS = 30 * 1000;

async function loadToken() {
    try {
        if (ctx?.data?.readIntegrations) {
            const cfg = await ctx.data.readIntegrations();
            const t = (cfg?.targets?.gamevox?.botToken || process.env.GAMEVOX_BOT_TOKEN || '').trim();
            if (t) return t;
        }
    } catch (e) {
        console.error('[gw] readIntegrations error:', e.message);
    }
    return (process.env.GAMEVOX_BOT_TOKEN || '').trim();
}

async function connect() {
    if (!ctx) {
        console.error('[gw] connect() called but ctx is not set!');
        return;
    }

    cachedToken = await loadToken();
    if (!cachedToken) {
        console.error('[gw] missing bot token - cannot connect to gateway');
        setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60000);
        return;
    }

    console.log('[gw] connect() called, creating WebSocket to ' + GATEWAY);
    ws = new WebSocket(GATEWAY);

    ws.on('open', () => {
        backoffMs = 2000;
        clearInterval(heartbeatTimer);
        console.log('[gw] OPEN');

        if (!cachedToken) {
            console.error('[gw] token disappeared before IDENTIFY');
            return;
        }
        console.log('[gw] IDENTIFY, intents=' + (1 << 0 | 1 << 9 | 1 << 14));

        ws.send(JSON.stringify({
            op: 2,
            d: {
                token: cachedToken,
                intents: (1 << 0) | (1 << 9) | (1 << 14), // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
                properties: {
                    os: 'windows',
                    browser: 'wwm-roster-gateway',
                    device: 'wwm-roster-gateway'
                }
            }
        }));
    });

    ws.on('message', (ev) => {
        let p;
        try {
            p = JSON.parse(String(ev.data));
        } catch (e) { return; }

        if (p.s !== undefined) lastSeq = p.s;

        if (p.op === 10) { // HELLO from server
            const interval = (p.d?.heartbeat_interval) || 41250;
            heartbeatInterval = interval;
            if (sessionId) {
                ws.send(JSON.stringify({ op: 6, d: { token: cachedToken, session_id: sessionId, seq: lastSeq } }));
            }
            return;
        }

        if (p.op === 1) { // Server heartbeat
            try { ws.send(JSON.stringify({ op: 1, d: lastSeq })); } catch (e) {}
            return;
        }

        if (p.op === 11) return; // Heartbeat ACK

        if (p.op === 9) { // INVALIDOP / error report
            console.error('[gw] SERVER REJECT op=9 code=' + p.d?.code + ' msg=' + (p.d?.message || '') + ' d=' + JSON.stringify(p.d).slice(0, 300));
            return;
        }
        if (p.op === 7) { // Reconnect
            console.log('[gw] server requested reconnect');
            return;
        }

        if (p.t === 'READY') {
            sessionId = p.d.session_id;
            console.log('[gw] READY - session ' + sessionId);
        } else if (p.t === 'RESUMED') {
            sessionId = p.d.session_id;
            console.log('[gw] RESUMED - session ' + sessionId);
        } else if (p.t) {
            console.log('[gw]', p.t);
        }

        // MESSAGE_CREATE trigger
        if (p.t === 'MESSAGE_CREATE') {
            handleMessageCreate(ctx, p.d);
        }
    });

    ws.on('close', function(code, reason) {
        clearInterval(heartbeatTimer);
        console.log('[gw] closed code=' + code + ' reason=' + String(reason || '').slice(0, 100) + ' - reconnecting in ' + backoffMs + 'ms');
        backoffMs = Math.min(backoffMs * 2, 60000);
        setTimeout(() => connect(), backoffMs);
    });

    ws.on('error', function(err) {
        console.error('[gw] WebSocket error:', err && err.message ? err.message : err);
    });
}

function handleMessageCreate(ctx, msg) {
    if (!ctx) {
        console.error('[gw] handleMessageCreate() called but ctx is not set!');
        return;
    }

    const content = (msg.content || '').toLowerCase().trim();
    if (!content.startsWith('!gvg') && !content.startsWith('/gvg')) return;

    const channelId = msg.channel_id;
    const author = msg.author;
    const guildId = msg.guild_id;
    const member = msg.member || {};

    // Role gate
    const MANAGE_MESSAGES = 0x2000n;
    const ADMINISTRATOR = 1n << 3n;
    const perms = BigInt(member.permissions || '0');
    if (!(perms & MANAGE_MESSAGES) && !(perms & ADMINISTRATOR)) {
        console.log('[gw] !gvg denied (no Manage Messages/Administrator)');
        return;
    }

    // Cooldown: 30s per guild
    const now = Date.now();
    const last = cooldowns.get(guildId) || 0;
    if (now - last < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
        console.log('[gw] !gvg cooldown for guild ' + guildId + ': ' + wait + 's');
        return;
    }
    cooldowns.set(guildId, now);

    // Build roster from Supabase
    const db = ctx.data.readDatabase();
    const texts = [];

    const DAY_KEYS = ['sat', 'sun'];
    for (const day of DAY_KEYS) {
        const groups = db && db.groups && db.groups[day];
        if (!groups || typeof groups !== 'object') continue;

        const rows = [];
        for (const [gId, g] of Object.entries(groups)) {
            if (!g || !g.players || !Array.isArray(g.players) || !g.players.length) continue;
            const members = g.players.map(p => p.name || '').filter(Boolean).join(', ');
            rows.push({ title: (g.title || '').trim(), members });
        }

        if (rows.length) {
            const dayText = '### ' + day.toUpperCase() + ' Roster\n' +
                rows.map(r => '- **' + r.title + '**: ' + r.members).join('\n');
            texts.push(dayText);
        }
    }

    if (!texts.length) {
        console.log('[gw] !gvg empty rosters for guild ' + guildId);
        return;
    }

    console.log('[gw] !gvg publishing ' + texts.length + ' days for guild ' + guildId);

    // Publish via HTTP-mode interactions
    const contentToPost = texts.join('\n\n');
    const out = ctx.broadcaster.publish(contentToPost, {
        author: author.username || 'wwm_gvg_roster',
        channelId,
        guildId
    });

    out.then(function() {
        console.log('[gw] !gvg published successfully');
    }).catch(function(e) {
        console.error('[gw] !gvg publish error:', e.message);
    });
}

// Initialize when module is loaded
module.exports = function initGateway(context) {
    console.log('[gw] initGateway called, setting ctx');
    ctx = context;
    console.log('[gw] ctx.set:', !!ctx);
    connect();
};
