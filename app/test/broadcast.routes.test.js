// test/broadcast.routes.test.js - GvG Broadcast HTTP contract (route layer)
//
// Boots a minimal express app with the REAL broadcast routes and a REAL
// broadcaster, but fake auth/in-memory storage/counting fetch. Asserts the
// trust boundary: masked responses, admin-only writes, host-pinned URLs,
// message-id lifecycle on URL changes.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const broadcast = require('../server/integrations/broadcast');
const registerBroadcastRoutes = require('../server/route/broadcast');

const DISCORD_URL = 'https://discord.com/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKEN';
const GAMEVOX_INCOMING = 'https://api.gamevox.com/webhooks/13d34f8c-bf80-44f8-84a4-d16d2d0bd335/WH.fake_token_value_0123456789abcdef';
const GAMEVOX_BOTV10 = 'https://bot-api.gamevox.com/api/v10/webhooks/1541032070230716416/tokenTOKENtoken1234';

function makeCtx() {
    const sessions = new Map();
    const auth = {
        requireAuth(req, res, next) {
            const raw = req.headers['x-auth-token'];
            const session = raw && sessions.get(raw);
            if (!session) {
                return res.status(401).json({ success: false, error: 'Authentication required.' });
            }
            req.session = session;
            next();
        },
        requireAdmin(req, res, next) {
            if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'superadmin')) {
                return res.status(403).json({ success: false, error: 'Admin access required.' });
            }
            next();
        }
    };

    let integrations = null;
    let writes = 0;
    const data = {
        async readIntegrations() {
            return integrations ? JSON.parse(JSON.stringify(integrations)) : null;
        },
        async writeIntegrations(cfg) {
            integrations = JSON.parse(JSON.stringify(cfg));
            writes++;
            return true;
        }
    };
    data._peek = () => integrations && JSON.parse(JSON.stringify(integrations));
    data._writes = () => writes;

    const requests = [];
    const history = [];
    const broadcaster = broadcast.createBroadcaster({
        readConfig: data.readIntegrations,
        writeConfig: data.writeIntegrations,
        readData: async () => ({
            groups: {
                sat: { g1: { title: 'Offence', players: [{ id: 'p1', name: 'Antony', class: 'Heal' }] } },
                sun: { g1: { title: 'Offence', players: [{ id: 'p2', name: 'Kaste', class: 'DPS' }] } }
            },
            reserves: { sat: [], sun: [] }
        }),
        appendHistory: (entry) => history.push(entry),
        fetchImpl: async (url, opts) => {
            requests.push(opts.method + ' ' + url);
            const payload = JSON.stringify({ id: 'm' + requests.length });
            return { ok: true, status: 200, json: async () => JSON.parse(payload), headers: { get: () => null } };
        },
        sleep: () => Promise.resolve()
    });

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

test('GET config returns the masked shape with live status and never leaks URLs', async () => {
    const ctx = makeCtx();
    ctx.data._seed = null;
    // Seed a configured+enabled discord target directly through storage.
    const cfg = broadcast.defaultIntegrationsConfig();
    cfg.targets.discord.webhookUrl = DISCORD_URL;
    cfg.targets.discord.enabled = true;
    await ctx.data.writeIntegrations(cfg);

    const r = await request(ctx.app, 'GET', '/api/broadcast/config', undefined, login(ctx.sessions, 'mod1', 'mod'));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.debounceSec, 75);
    assert.strictEqual(r.json.autoIntervalMin, 15);

    const t = r.json.targets.discord;
    assert.deepStrictEqual(Object.keys(t).sort(),
        ['enabled', 'hasWebhook', 'satMessageId', 'status', 'sunMessageId', 'webhookMasked']);
    assert.strictEqual(t.hasWebhook, true);
    assert.strictEqual(t.webhookMasked, 'discord.com/api/webhooks/123456789012345678/…OKEN');
    assert.ok(!JSON.stringify(r.json).includes('tokentoken'), 'raw token must never appear');

    const g = r.json.targets.gamevox;
    assert.strictEqual(g.hasWebhook, false);
    assert.strictEqual(g.enabled, false);
    assert.ok(g.status && typeof g.status.breakerActive === 'boolean', 'status comes from getStatus()');
});

test('POST config is admin-only', async () => {
    const ctx = makeCtx();
    const mod = login(ctx.sessions, 'mod1', 'mod');
    const r = await request(ctx.app, 'POST', '/api/broadcast/config', {}, mod);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(ctx.data._writes(), 0);
});

test('POST config accepts pinned URLs, rejects foreign hosts, preserves message ids', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');

    // Valid discord URL -> saved.
    const r1 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { discord: { enabled: true, webhookUrl: DISCORD_URL } }
    }, admin);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.json.targets.discord.hasWebhook, true);
    assert.strictEqual(ctx.data._peek().targets.discord.webhookUrl, DISCORD_URL);

    // Foreign host rejected, storage untouched.
    const before = ctx.data._writes();
    const r2 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhookUrl: 'https://evil.example/webhooks/x/y' } }
    }, admin);
    assert.strictEqual(r2.status, 400);
    assert.match(r2.json.error, /Invalid gamevox webhook URL/);
    assert.strictEqual(ctx.data._writes(), before);

    // Both GameVox families accepted.
    for (const [label, url] of [['incoming', GAMEVOX_INCOMING], ['bot-v10', GAMEVOX_BOTV10]]) {
        const r = await request(ctx.app, 'POST', '/api/broadcast/config', {
            targets: { gamevox: { enabled: true, webhookUrl: url } }
        }, admin);
        assert.strictEqual(r.status, 200, label + ' family must be accepted');
        assert.strictEqual(ctx.data._peek().targets.gamevox.webhookUrl, url);
    }

    // Omitted URL keeps stored value AND message ids; changed URL clears them.
    const seeded = broadcast.defaultIntegrationsConfig();
    seeded.targets.discord.webhookUrl = DISCORD_URL;
    seeded.targets.discord.satMessageId = 'day-1';
    seeded.targets.discord.sunMessageId = 'day-2';
    await ctx.data.writeIntegrations(seeded);

    const r3 = await request(ctx.app, 'POST', '/api/broadcast/config', {}, admin);
    assert.strictEqual(r3.status, 200);
    let stored = ctx.data._peek();
    assert.strictEqual(stored.targets.discord.webhookUrl, DISCORD_URL);
    assert.strictEqual(stored.targets.discord.satMessageId, 'day-1', 'unchanged URL keeps ids');
    assert.strictEqual(stored.targets.discord.sunMessageId, 'day-2');

    const r4 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { discord: { webhookUrl: DISCORD_URL.replace('123456789012345678', '987654321098765432') } }
    }, admin);
    assert.strictEqual(r4.status, 200);
    stored = ctx.data._peek();
    assert.strictEqual(stored.targets.discord.satMessageId, null, 'URL change invalidates ids');
    assert.strictEqual(stored.targets.discord.sunMessageId, null);

    // Clearing with '' also wipes ids.
    const r5 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { discord: { webhookUrl: '' } }
    }, admin);
    assert.strictEqual(r5.status, 200);
    stored = ctx.data._peek();
    assert.strictEqual(stored.targets.discord.webhookUrl, '');
    assert.strictEqual(stored.targets.discord.hasWebhook !== undefined, false); // raw storage keeps plain shape
    assert.strictEqual(r5.json.targets.discord.hasWebhook, false);
});

test('POST config clamps timing windows into sane bounds', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const r = await request(ctx.app, 'POST', '/api/broadcast/config',
        { debounceSec: 1, autoIntervalMin: 9999 }, admin);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.debounceSec, 10, 'debounce floors at 10s');
    assert.strictEqual(r.json.autoIntervalMin, 180, 'interval caps at 180min');
});

test('POST push validates target names and pushes through the real broadcaster', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const mod = login(ctx.sessions, 'mod1', 'mod');

    // Unknown target name.
    const bad = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'slack' }, admin);
    assert.strictEqual(bad.status, 400);

    // Nothing configured yet -> per-target result reports skipped/not ok.
    // (Probe gamevox so discord's 30s manual cooldown stays unconsumed.)
    const none = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'gamevox' }, mod);
    assert.strictEqual(none.status, 200);
    assert.strictEqual(none.json.success, true);
    assert.strictEqual(none.json.results.gamevox.skipped, true);

    // Configure + push: two day messages created, history logged.
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { discord: { enabled: true, webhookUrl: DISCORD_URL } }
    }, admin);
    const r = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'discord' }, mod);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.results.discord.ok, true);
    assert.strictEqual(ctx.requests.length, 2, 'sat + sun created');
    assert.ok(ctx.requests[0].startsWith('POST ' + DISCORD_URL));
    const entry = ctx.history.find(h => h.action === 'broadcast');
    assert.ok(entry, 'push is audit-logged');
    assert.strictEqual(entry.user, 'mod1');
});
