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
        },
        requireSuperAdmin(req, res, next) {
            if (!req.session || req.session.role !== 'superadmin') {
                return res.status(403).json({ success: false, error: 'SuperAdmin access required.' });
            }
            next();
        }
    };

    let integrations = null;
    let writes = 0;
    // Shared roster fixture: feeds both the broadcaster and the preview route.
    const ROSTER = {
        groups: {
            sat: { g1: { title: 'Offence', players: [{ id: 'p1', name: 'Antony', class: 'Heal' }] } },
            sun: { g1: { title: 'Offence', players: [{ id: 'p2', name: 'Kaste', class: 'DPS' }] } }
        },
        reserves: { sat: [], sun: [] }
    };
    const data = {
        // Mirrors the real storage interface (readDatabase), which the
        // preview route consumes via ctx.data.
        async readDatabase() { return JSON.parse(JSON.stringify(ROSTER)); },
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
    const bodies = [];
    const history = [];
    const broadcaster = broadcast.createBroadcaster({
        readConfig: data.readIntegrations,
        writeConfig: data.writeIntegrations,
        readData: data.readDatabase,
        appendHistory: (entry) => history.push(entry),
        fetchImpl: async (url, opts) => {
            requests.push(opts.method + ' ' + url);
            try { bodies.push(JSON.parse(opts.body)); } catch (e) { bodies.push(null); }
            const payload = JSON.stringify({ id: 'm' + requests.length });
            return { ok: true, status: 200, json: async () => JSON.parse(payload), headers: { get: () => null } };
        },
        sleep: () => Promise.resolve()
    });

    const app = express();
    app.use(express.json());
    // Fake bot-API for channel translation: guild + channel list carrying
    // both snowflakes and gamevox UUIDs.
    const lookups = [];
    const botFetch = async (url, opts) => {
        lookups.push(url);
        const ok = (data) => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } });
        if (url.endsWith('/users/@me/guilds')) {
            return ok([{ id: '1516070040533311488', name: 'Test Guild' }]);
        }
        if (url.includes('/guilds/1516070040533311488/channels')) {
            return ok([
                { id: '1540402360065040384', gamevox_id: '7e62c677-2cd9-418d-8cd4-afa2cb5b36fe', name: 'GvG-Plan', type: 0 },
                { id: '1521079440763363328', gamevox_id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'GameVox Chat', type: 0 },
                { id: '1541027880090140673', gamevox_id: 'cccccccc-1111-2222-3333-444444444444', name: 'Second Channel', type: 0 }
            ]);
        }
        return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    };
    registerBroadcastRoutes(app, { auth, data, broadcaster, botFetch });
    return { app, sessions, data, history, requests, bodies, broadcaster, botLookups: lookups };
}

async function request(app, method, path, body, token, extraHeaders) {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch('http://127.0.0.1:' + port + path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'x-auth-token': token } : {}),
                ...(extraHeaders || {})
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

test('POST config validates the GameVox bot fields at the trust boundary', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const CH = '1541027880090140673';
    const TOKEN = 'GVB.abcdef1234567890abcdef1234567890abcd';

    // Invalid token shape -> 400, storage untouched.
    const r1 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botToken: 'not-a-token' } }
    }, admin);
    assert.strictEqual(r1.status, 400);
    assert.match(r1.json.error, /bot token/i);
    assert.strictEqual(ctx.data._writes(), 0);

    // Non-numeric channel id -> 400.
    const r2 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botChannels: [CH, 'abc123'] } }
    }, admin);
    assert.strictEqual(r2.status, 400);
    assert.match(r2.json.error, /channel id/i);
    // Valid save: token + channels + mode stored raw server-side.
    const r3 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botToken: TOKEN, botChannels: [CH, ' ' + CH + ' '], botPostMode: 'edit' } }
    }, admin);
    assert.strictEqual(r3.status, 200, 'r3 body: ' + JSON.stringify(r3.json));
    const stored = ctx.data._peek().targets.gamevox;
    assert.strictEqual(stored.botToken, TOKEN);
    assert.deepStrictEqual(stored.botChannels, [CH], 'duplicate ids dedupe');
    assert.strictEqual(stored.botPostMode, 'edit');
    assert.strictEqual(r3.json.targets.gamevox.hasBotToken, true);
    assert.strictEqual(r3.json.targets.gamevox.botTokenMasked, 'GVB.…abcd');
    // SuperAdmin view carries the raw values so inline forms render them.
    assert.strictEqual(r3.json.targets.gamevox.botToken, TOKEN);
    assert.deepStrictEqual(r3.json.targets.gamevox.botChannels, [CH]);

    // Non-superadmin viewers never see raw secrets.
    const viewer = login(ctx.sessions, 'mod1', 'mod');
    const maskedView = await request(ctx.app, 'GET', '/api/broadcast/config', undefined, viewer);
    assert.ok(!JSON.stringify(maskedView.json).includes(TOKEN), 'raw token hidden from non-superadmin');
    assert.strictEqual(maskedView.json.targets.gamevox.botToken, undefined);

    // Omitted token survives a later webhook-only save; [] clears channels.
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botChannels: [] } }
    }, admin);
    const after = ctx.data._peek().targets.gamevox;
    assert.strictEqual(after.botToken, TOKEN, 'omitted field = unchanged');
    assert.deepStrictEqual(after.botChannels, []);
    assert.strictEqual(after.botPostMode, 'edit');
});

test('POST config translates Channel-Settings UUIDs into bot snowflakes', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const TOKEN = 'GVB.abcdef1234567890abcdef1234567890abcd';
    const UUID = '7e62c677-2cd9-418d-8cd4-afa2cb5b36fe';

    // Paste the UUID exactly as GameVox shows it in Channel Settings.
    const r = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botToken: TOKEN, botChannels: [UUID.toUpperCase()] } }
    }, admin);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.targets.gamevox.botChannels, ['1540402360065040384'],
        'UUID translated to the numeric snowflake the bot API resolves');
    assert.deepStrictEqual(ctx.data._peek().targets.gamevox.botChannels, ['1540402360065040384']);

    // A UUID the bot cannot see -> actionable 400, storage untouched.
    const bad = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botChannels: ['deadbeef-0000-1111-2222-333344445555'] } }
    }, admin);
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /Unknown channel|install the bot/i);
    assert.deepStrictEqual(ctx.data._peek().targets.gamevox.botChannels, ['1540402360065040384'],
        'failed save leaves the previous channels untouched');
});

test('GET config returns the masked shape with live status and never leaks URLs', async () => {    const ctx = makeCtx();
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
    // Mod viewer: masked-only shape - no raw token/webhooks keys.
    assert.deepStrictEqual(Object.keys(t).sort(),
        ['botChannels', 'botPostMode', 'botTokenMasked', 'enabled', 'hasBotToken', 'hasWebhook',
         'mode', 'satMessageId', 'siteLabel', 'siteUrl', 'status', 'sunMessageId',
         'webhookMasked', 'webhooksMasked']);
    assert.strictEqual(t.mode, 'auto');
    assert.strictEqual(t.hasWebhook, true);
    assert.strictEqual(t.webhookMasked, 'discord.com/api/webhooks/123456789012345678/…OKEN');
    assert.deepStrictEqual(r.json.targets.discord.webhooksMasked,
        ['discord.com/api/webhooks/123456789012345678/…OKEN']);
    assert.ok(!JSON.stringify(r.json).includes('tokentoken'), 'raw token must never appear');

    const g = r.json.targets.gamevox;
    assert.strictEqual(g.hasWebhook, false);
    assert.strictEqual(g.enabled, false);
    assert.strictEqual(g.mode, 'manual', 'gamevox ships manual-push by default');
    assert.ok(g.status && typeof g.status.breakerActive === 'boolean', 'status comes from getStatus()');
});

test('POST config is admin-only', async () => {
    const ctx = makeCtx();
    const mod = login(ctx.sessions, 'mod1', 'mod');
    const r = await request(ctx.app, 'POST', '/api/broadcast/config', {}, mod);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(ctx.data._writes(), 0);
});

test('POST config is SuperAdmin-only: a plain admin gets 403', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'admin1', 'admin');
    const r = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { botChannels: ['1541027880090140673'] } }
    }, admin);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(ctx.data._writes(), 0);
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

    // Mode flips are explicit and validated; bogus values keep the prior one.
    const rm = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { mode: 'auto' } }
    }, admin);
    assert.strictEqual(rm.status, 200);
    assert.strictEqual(rm.json.targets.gamevox.mode, 'auto');
    const rb = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { mode: 'whenever' } }
    }, admin);
    assert.strictEqual(rb.status, 200);
    assert.strictEqual(rb.json.targets.gamevox.mode, 'auto', 'invalid mode ignored');

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

test('POST config accepts webhooks arrays: multi-channel fan-out, dedupe, clear, per-index errors', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');

    const second = GAMEVOX_INCOMING.replace('13d34f8c', '22e44f9d');
    const r1 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { enabled: true, webhooks: [GAMEVOX_INCOMING, second, GAMEVOX_INCOMING] } }
    }, admin);
    assert.strictEqual(r1.status, 200);
    let stored = ctx.data._peek().targets.gamevox;
    assert.deepStrictEqual(stored.webhooks, [GAMEVOX_INCOMING, second], 'deduped');
    assert.strictEqual(stored.webhookUrl, GAMEVOX_INCOMING, 'first channel mirrored to legacy field');
    assert.deepStrictEqual(r1.json.targets.gamevox.webhooksMasked.length, 2);

    // Bad URL reports its position.
    const bad = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhooks: [GAMEVOX_INCOMING, 'https://evil.example/x/y'] } }
    }, admin);
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /#2/);
    assert.strictEqual(ctx.data._peek().targets.gamevox.webhooks.length, 2, 'storage untouched on error');

    // Removing a channel keeps the survivor's channelIds entry.
    const kept = ctx.data._peek().targets.gamevox.channelIds[GAMEVOX_INCOMING];
    const r2 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhooks: [GAMEVOX_INCOMING] } }
    }, admin);
    assert.strictEqual(r2.status, 200);
    stored = ctx.data._peek().targets.gamevox;
    assert.ok(stored.channelIds[GAMEVOX_INCOMING], 'survivor keeps its id slot');
    assert.strictEqual(stored.channelIds === kept, false, 'ids object is rebuilt');
    assert.strictEqual(stored.channelIds[second], undefined, 'removed channel ids dropped');

    // Empty array clears everything.
    const r3 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhooks: [] } }
    }, admin);
    assert.strictEqual(r3.status, 200);
    stored = ctx.data._peek().targets.gamevox;
    assert.deepStrictEqual(stored.webhooks, []);
    assert.strictEqual(stored.webhookUrl, '');
    assert.strictEqual(r3.json.targets.gamevox.hasWebhook, false);

    // Cap enforced.
    const many = [];
    for (let i = 0; i < 6; i++) {
        many.push(GAMEVOX_INCOMING.replace('13d34f8c', '33a' + i + '45f9d'));
    }
    const r4 = await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { webhooks: many } }
    }, admin);
    assert.strictEqual(r4.status, 400);
    assert.match(r4.json.error, /max 5/i);
});

test('POST push fans out to every configured channel and reports per-channel failures', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const mod = login(ctx.sessions, 'mod1', 'mod');

    const second = GAMEVOX_INCOMING.replace('13d34f8c', '44b55e8c');
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { enabled: true, webhooks: [GAMEVOX_INCOMING, second] } }
    }, admin);

    // Both channels receive every day: 2 channels x 2 days = 4 POSTs.
    ctx.requests.length = 0;
    const r = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'gamevox' }, mod);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.results.gamevox.ok, true);
    assert.strictEqual(ctx.requests.length, 4, '2 channels x 2 days');
    assert.ok(ctx.requests.some(u => u.includes('13d34f8c')));
    assert.ok(ctx.requests.some(u => u.includes('44b55e8c')));
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

test('POST push auto-generates the -@ site link from the request origin', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const mod = login(ctx.sessions, 'mod1', 'mod');
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { enabled: true, webhooks: [GAMEVOX_INCOMING] } }
    }, admin);

    // Public origin (behind Render proxy headers) rides along with the push.
    const r = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'gamevox' }, mod,
        { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'wwm-gvgroster.onrender.com' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.results.gamevox.ok, true);

    const contents = ctx.bodies.filter(b => b && typeof b.content === 'string').map(b => b.content);
    assert.ok(contents.length >= 2, 'sat + sun sent');
    for (const text of contents) {
        assert.ok(text.includes('[-@wwm-gvgroster](https://wwm-gvgroster.onrender.com)'),
            'footer carries the auto-generated origin link');
    }

    // The public origin is persisted so interval auto-pushes (no request
    // context) keep linking to it afterwards.
    const stored = ctx.data._peek().targets.gamevox;
    assert.strictEqual(stored.siteUrl, 'https://wwm-gvgroster.onrender.com');
    assert.strictEqual(stored.siteLabel, 'wwm-gvgroster');
});

test('localhost pushes are tagged Local Test even when a public origin is stored', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const mod = login(ctx.sessions, 'mod1', 'mod');
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { enabled: true, webhooks: [GAMEVOX_INCOMING], siteUrl: 'https://wwm-gvgroster.onrender.com/', siteLabel: 'wwm-gvgroster' } }
    }, admin);

    // Manual push from a private origin: always the plain local tag - the
    // stored URL belongs to interval auto-pushes, not to this request.
    const r = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'gamevox' }, mod);
    assert.strictEqual(r.status, 200);
    const contents = ctx.bodies.filter(b => b && typeof b.content === 'string').map(b => b.content);
    assert.ok(contents.length >= 2);
    for (const text of contents) {
        assert.ok(text.includes('-@Local Test'), 'local pushes tag themselves as Local Test');
        assert.ok(!text.includes('wwm-gvgroster.onrender.com'), 'stored origin not claimed by a local push');
        assert.ok(!text.includes('127.0.0.1') && !text.includes('localhost'), 'no dev host in chat');
    }
    // The stored auto-push origin survives untouched.
    assert.strictEqual(ctx.data._peek().targets.gamevox.siteUrl, 'https://wwm-gvgroster.onrender.com/',
        'private origins never overwrite the stored auto-push origin');
});

test('pushes with no known origin are tagged -@Local Test as plain text', async () => {
    const ctx = makeCtx();
    const admin = login(ctx.sessions, 'root', 'superadmin');
    const mod = login(ctx.sessions, 'mod1', 'mod');
    await request(ctx.app, 'POST', '/api/broadcast/config', {
        targets: { gamevox: { enabled: true, webhooks: [GAMEVOX_INCOMING] } }
    }, admin);

    // Local push, nothing stored: plain-text tag instead of a hyperlink.
    const r = await request(ctx.app, 'POST', '/api/broadcast/push', { target: 'gamevox' }, mod);
    assert.strictEqual(r.status, 200);
    const contents = ctx.bodies.filter(b => b && typeof b.content === 'string').map(b => b.content);
    assert.ok(contents.length >= 2);
    for (const text of contents) {
        assert.ok(text.includes('-@Local Test'), 'source tag present');
        assert.ok(!text.includes(']('), 'no hyperlink for local pushes');
        assert.ok(!text.includes('127.0.0.1') && !text.includes('localhost'), 'no dev host in chat');
    }
});
