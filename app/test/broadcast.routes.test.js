// Broadcast configuration routes: auth gating, Discord webhook config
// (dormant feature), GameVox bot setup fields (token/publicKey/site), and
// the Preview dry-run. Push delivery lives in gamevox-interactions.test.js.
const test = require('node:test');
const assert = require('assert');
const express = require('express');
const broadcast = require('../server/integrations/broadcast');
const registerBroadcastRoutes = require('../server/route/broadcast');

const DISCORD_URL = 'https://discord.com/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKENTOKEN';
const GV_TOKEN = 'GVB.abcdef1234567890abcdef1234567890abcd';
const GV_PUBKEY = 'b'.repeat(64);

function makeCtx() {
    const sessions = new Map();
    let integrations = null;
    let writes = 0;
    const ROSTER = {
        groups: {
            sat: { g1: { title: 'Offence', players: [{ id: 'p1', name: 'Antony', class: 'Heal' }] } },
            sun: { g1: { title: 'Offence', players: [{ id: 'p2', name: 'Kaste', class: 'DPS' }] } }
        },
        reserves: { sat: [], sun: [] }
    };
    const data = {
        async readDatabase() { return JSON.parse(JSON.stringify(ROSTER)); },
        async readIntegrations() {
            return integrations ? JSON.parse(JSON.stringify(integrations)) : null;
        },
        async writeIntegrations(cfg) {
            integrations = JSON.parse(JSON.stringify(cfg));
            writes++;
            return true;
        },
        _peek() { return JSON.parse(JSON.stringify(integrations || {})); },
        _writes() { return writes; },
        _seed(cfg) { integrations = JSON.parse(JSON.stringify(cfg)); }
    };
    const history = [];
    const requests = [];
    const broadcaster = broadcast.createBroadcaster({
        readConfig: data.readIntegrations,
        writeConfig: data.writeIntegrations,
        readData: data.readDatabase,
        appendHistory: (entry) => history.push(entry),
        fetchImpl: async (url, opts) => {
            requests.push(opts.method + ' ' + url);
            return { ok: true, status: 200, json: async () => ({ id: 'm' + requests.length }), headers: { get: () => null } };
        },
        sleep: () => Promise.resolve()
    });

    const auth = {
        requireAuth(req, res, next) {
            const token = req.headers['x-auth-token'];
            const session = token && sessions.get(token);
            if (!session) return res.status(401).json({ success: false, error: 'Unauthorized' });
            req.session = session;
            next();
        },
        requireSuperAdmin(req, res, next) {
            if (!req.session || req.session.role !== 'superadmin') {
                return res.status(403).json({ success: false, error: 'SuperAdmin access required.' });
            }
            next();
        }
    };

    const app = express();
    app.use(express.json());
    registerBroadcastRoutes(app, { auth, data, broadcaster });
    return { app, sessions, data, history, requests, broadcaster };
}

async function request(app, method, path, body, token) {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch('http://127.0.0.1:' + port + path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'x-auth-token': token } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let json = null;
        try { json = await res.json(); } catch (e) { /* empty body */ }
        return { status: res.status, json };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function login(sessions, username, role) {
    const token = 'tok-' + username + '-' + Math.random().toString(36).slice(2);
    sessions.set(token, { username, role });
    return token;
}

test('GET config requires auth', async () => {
    const ctx = makeCtx();
    const r = await request(ctx.app, 'GET', '/api/broadcast/config');
    assert.strictEqual(r.status, 401);
});

test('POST config is SuperAdmin-only: mods and plain admins get 403', async () => {
    const ctx = makeCtx();

    const mod = login(ctx.sessions, 'mod1', 'mod');
    const rMod = await request(ctx.app, 'POST', '/api/broadcast/config', {}, mod);
    assert.strictEqual(rMod.status, 403);

    const admin = login(ctx.sessions, 'admin1', 'admin');
    const rAdmin = await request(ctx.app, 'POST', '/api/broadcast/config', {}, admin);
    assert.strictEqual(rAdmin.status, 403);
    assert.strictEqual(ctx.data._writes(), 0);
});

test('GET config returns the masked shape for non-superadmins', async () => {
    const ctx = makeCtx();
    ctx.data._seed(null);
    const cfg = broadcast.defaultIntegrationsConfig();
    cfg.targets.discord.webhookUrl = DISCORD_URL;
    cfg.targets.discord.enabled = true;
    cfg.targets.gamevox.botToken = GV_TOKEN;
    cfg.targets.gamevox.enabled = true;
    await ctx.data.writeIntegrations(cfg);

    const mod = login(ctx.sessions, 'mod1', 'mod');
    const r = await request(ctx.app, 'GET', '/api/broadcast/config', undefined, mod);
    assert.strictEqual(r.status, 200);

    // Raw secrets never reach non-superadmin viewers.
    assert.ok(!JSON.stringify(r.json).includes(GV_TOKEN), 'raw bot token hidden');
    assert.ok(!JSON.stringify(r.json).includes(DISCORD_URL), 'raw webhook hidden');

    const g = r.json.targets.gamevox;
    assert.deepStrictEqual(Object.keys(g).sort(),
        ['botTokenMasked', 'enabled', 'hasBotToken', 'hasWebhook', 'mode',
         'satMessageId', 'siteLabel', 'siteUrl', 'status', 'sunMessageId',
         'webhookMasked', 'webhooksMasked']);
    assert.strictEqual(g.hasBotToken, true);
    assert.match(g.botTokenMasked, /^GVB\.…abcd$/);
    assert.strictEqual(g.publicKey, undefined);
});

test('POST config accepts the discord webhook and preserves its ids', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');

    const seeded = broadcast.defaultIntegrationsConfig();
    seeded.targets.discord.webhookUrl = DISCORD_URL;
    seeded.targets.discord.satMessageId = 'day-1';
    seeded.targets.discord.sunMessageId = 'day-2';
    await ctx.data.writeIntegrations(seeded);

    // Omitted URL keeps stored value AND message ids.
    const r3 = await request(ctx.app, 'POST', '/api/broadcast/config', {}, admin);
    assert.strictEqual(r3.status, 200);
    let stored = ctx.data._peek();
    assert.strictEqual(stored.targets.discord.satMessageId, 'day-1');

    // Changing the URL invalidates them.
    const r4 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { discord: { webhookUrl: DISCORD_URL.replace('123456789012345678', '987654321098765432') } }
    }, admin);
    assert.strictEqual(r4.status, 200);
    stored = ctx.data._peek();
    assert.strictEqual(stored.targets.discord.satMessageId, null, 'URL change invalidates ids');
});

test('POST config rejects GameVox webhook fields entirely (removed path)', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');

    const r1 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhookUrl: 'https://evil.example/webhooks/x/y' } }
    }, admin);
    assert.strictEqual(r1.status, 400);
    assert.match(r1.json.error, /webhooks were removed/);

    const r2 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhooks: [] } }
    }, admin);
    assert.strictEqual(r2.status, 400);
    assert.strictEqual(ctx.data._writes(), 0);
});

test('POST config stores the GameVox bot token and public key (superadmin)', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');

    // Bad public key shape -> 400.
    const bad = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { publicKey: 'nothex' } }
    }, admin);
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /public key/i);

    // Valid save: token + key stored raw server-side, raw values round-trip
    // to the superadmin viewer for the inline forms.
    const good = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botToken: GV_TOKEN, publicKey: GV_PUBKEY } }
    }, admin);
    assert.strictEqual(good.status, 200);
    const stored = ctx.data._peek().targets.gamevox;
    assert.strictEqual(stored.botToken, GV_TOKEN);
    assert.strictEqual(stored.publicKey, GV_PUBKEY);
    assert.strictEqual(good.json.targets.gamevox.hasBotToken, true);
    assert.strictEqual(good.json.targets.gamevox.publicKey, GV_PUBKEY);
    assert.strictEqual(good.json.targets.gamevox.botTokenMasked, 'GVB.…abcd');

    // Clearing via '' wipes both independently.
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { publicKey: '' } }
    }, admin);
    const after = ctx.data._peek().targets.gamevox;
    assert.strictEqual(after.publicKey, '', 'empty string clears');
    assert.strictEqual(after.botToken, GV_TOKEN, 'omitted field stays unchanged');
});

test('timings are clamped to sane floors and ceilings', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const r = await request(ctx.app, 'POST', '/api/broadcast/config',
        { debounceSec: 1, autoIntervalMin: 9999 }, admin);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.debounceSec, 10, 'debounce floors at 10s');
    assert.strictEqual(r.json.autoIntervalMin, 180, 'interval caps at 180min');
});

test('GET preview renders the exact day markup for mod+ without sending', async () => {
    const ctx = makeCtx();
    const mod = login(ctx.sessions, 'mod1', 'mod');
    const r = await request(ctx.app, 'GET', '/api/broadcast/preview', undefined, mod);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.success, true);
    assert.ok(r.json.days.sat.includes('## Saturday Roster'), 'sat header present');
    assert.ok(r.json.days.sat.includes('**Antony**'), 'players rendered');
    assert.match(r.json.days.sat, /Updated by mod1, /, 'signature carries the actor');
    assert.ok(r.json.days.sun && r.json.days.sun.includes('## Sunday Roster'));
    assert.strictEqual(ctx.requests.length, 0, 'preview never touches delivery HTTP');
});

test('GET preview requires auth', async () => {
    const ctx = makeCtx();
    const r = await request(ctx.app, 'GET', '/api/broadcast/preview');
    assert.strictEqual(r.status, 401);
});
