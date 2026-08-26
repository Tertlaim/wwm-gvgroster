// GameVox interactions endpoint: signature verification, PING handshake,
// /gvg command (cooldown, role gate), cold-start late delivery, and the
// SuperAdmin setup probes (status / leave).
const test = require('node:test');
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const broadcast = require('../server/integrations/broadcast');
const registerGamevoxInteractions = require('../server/route/gamevox-interactions');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).slice(-32).toString('hex');

process.env.GAMEVOX_PUBLIC_KEY = PUBLIC_HEX;

function makeCtx() {
    const ROSTER = {
        groups: {
            sat: { g1: { title: 'Offence', players: [{ id: 'p1', name: 'Antony', class: 'Heal' }] } },
            sun: { g1: { title: 'Offence', players: [{ id: 'p2', name: 'Kaste', class: 'DPS' }] } }
        },
        reserves: { sat: [], sun: [] }
    };
    let integrations = null;
    const data = {
        async readDatabase() { return JSON.parse(JSON.stringify(ROSTER)); },
        async readIntegrations() {
            return integrations ? JSON.parse(JSON.stringify(integrations)) : null;
        },
        async writeIntegrations(cfg) { integrations = JSON.parse(JSON.stringify(cfg)); return true; },
        _seed(cfg) { integrations = JSON.parse(JSON.stringify(cfg)); }
    };
    const followups = [];
    const guildState = { deleted: [] };
    const botFetch = async (url, opts) => {
        const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
        if (url.endsWith('/users/@me')) return ok({ id: '1541027881444900865', username: 'wwm_gvg_roster' });
        if (url.endsWith('/users/@me/guilds') && (!opts.method || opts.method === 'GET')) {
            return ok([{ id: '1516070040533311488', name: 'The Beginning After The End' }]);
        }
        if (url.includes('/users/@me/guilds/') && opts.method === 'DELETE') {
            if (guildState.deleted.length === 0) {
                // First attempt mimics today's platform gap: self-leave 404s.
                return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
            }
            guildState.deleted.push(url);
            return { ok: true, status: 204, json: async () => ({}), headers: { get: () => null } };
        }
        followups.push({ url, body: JSON.parse(opts.body) });
        return ok({ id: 'f' + followups.length });
    };
    const auth = {
        requireAuth(req, res, next) { next(); },
        requireSuperAdmin(req, res, next) { next(); }
    };
    const app = express();
    app.use(express.json({
        verify: (req, res, buf) => { req.rawBody = buf; }
    }));
    registerGamevoxInteractions(app, { data, broadcast, botFetch, auth });
    return { app, data, followups, guildState, lookups: [] };
}

function signAndFetch(app, payload, opts = {}) {
    const server = app.listen(0);
    const timestamp = String(opts.staleSec
        ? Math.floor(Date.now() / 1000) - opts.staleSec
        : Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    const sig = crypto.sign(null, Buffer.from(timestamp + rawBody), privateKey).toString('hex');
    try {
        const port = server.address().port;
        const p = fetch('http://127.0.0.1:' + port + '/api/gamevox/interactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': sig,
                'X-Signature-Timestamp': timestamp
            },
            body: rawBody
        });
        return { promise: p, server };
    } finally { /* server closed by caller after await */ }
}

async function requestJson(app, payload, opts) {
    const { promise, server } = signAndFetch(app, payload, opts);
    try {
        const res = await promise;
        let json = null;
        try { json = await res.json(); } catch (e) { /* empty */ }
        return { status: res.status, json };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('interactions: unsigned and forged requests are rejected with 401', async () => {
    const ctx = makeCtx();
    const server = ctx.app.listen(0);
    try {
        const port = server.address().port;
        const noSig = await fetch(`http://127.0.0.1:${port}/api/gamevox/interactions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":1}'
        });
        assert.strictEqual(noSig.status, 401);
        const forged = await fetch(`http://127.0.0.1:${port}/api/gamevox/interactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': 'f'.repeat(128),
                'X-Signature-Timestamp': String(Math.floor(Date.now() / 1000))
            },
            body: '{"type":1}'
        });
        assert.strictEqual(forged.status, 401);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('interactions: portal PING handshake answers type 1', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, { type: 1 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { type: 1 });
});

test('interactions: stale timestamps are rejected (replay guard)', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, { type: 1 }, { staleSec: 3600 });
    assert.strictEqual(r.status, 401);
});

test('interactions: public key can come from panel config instead of constant', async () => {
    const ctx = makeCtx();
    // Store a DIFFERENT valid-looking key: signatures must now fail against it.
    ctx.data._seed({
        version: 1,
        targets: { gamevox: { publicKey: 'a'.repeat(64) } }
    });
    const r = await requestJson(ctx.app, { type: 1 });
    assert.strictEqual(r.status, 401, 'signature made for the real key fails vs stored key');
});

test('interactions: /gvg defers then delivers both days as followups', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'interaction-token-abc',
        data: { name: 'gvg', options: [] },
        member: { nick: 'Kaste', permissions: '8192', user: { username: 'Kaste' } }
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.type, 5, 'deferred reply');
    await new Promise(resolve => setTimeout(resolve, 30));

    const contents = ctx.followups.map(f => f.body.content);
    assert.ok(contents.some(c => c.includes('## Saturday Roster')), 'saturday delivered');
    assert.ok(contents.some(c => c.includes('## Sunday Roster')), 'sunday delivered');
    assert.ok(ctx.followups.every(f =>
        f.url.startsWith('https://bot-api.gamevox.com/api/v10/webhooks/1541027880090140673/interaction-token-abc')),
        'followups target the interaction webhook');
});

test('interactions: global cooldown blocks a second /gvg within 30s', async () => {
    const ctx = makeCtx();
    const member = { user: { username: 'Mod' }, permissions: '8192' };

    const first = await requestJson(ctx.app, {
        type: 2, token: 't1', data: { name: 'gvg', options: [] }, member
    });
    assert.strictEqual(first.json.type, 5);

    const second = await requestJson(ctx.app, {
        type: 2, token: 't2', data: { name: 'gvg', options: [] }, member
    });
    assert.strictEqual(second.json.type, 4, 'ephemeral busy reply');
    assert.match(second.json.data.content, /try again in \d+s/);
    assert.strictEqual(ctx.followups.filter(f => f.url.includes('/t2/')).length, 0,
        'cooled-down invocation posts nothing');
});

test('interactions: members without Manage Messages get an ephemeral denial', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'tok',
        data: { name: 'gvg', options: [] },
        member: { user: { username: 'RandomGuy' }, permissions: '0' }
    });
    assert.strictEqual(r.json.type, 4);
    assert.match(r.json.data.content, /Only moderators and admins/);
    assert.strictEqual(r.json.data.flags, 64);
    assert.strictEqual(ctx.followups.length, 0, 'denied publish never posts');
});

test('interactions: empty rosters answer ephemerally without posting', async () => {
    const ctx = makeCtx();
    ctx.data.readDatabase = async () => ({ groups: {}, reserves: {} });
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'tok',
        data: { name: 'gvg', options: [{ name: 'days', value: 'sat' }] },
        member: { user: { username: 'Mod' }, permissions: '8192' }
    });
    assert.strictEqual(r.json.type, 4);
    assert.match(r.json.data.content, /Nothing to publish/i);
    assert.strictEqual(ctx.followups.length, 0);
});

test('interactions: late (cold-start) publish delivers via followups with wake notice + site link', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'late-token',
        data: { name: 'gvg', options: [] },
        member: { user: { username: 'Kaste' }, permissions: '8192' }
    }, { staleSec: 40 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, {}, 'no callback payload - window long gone');
    await new Promise(resolve => setTimeout(resolve, 30));

    const contents = ctx.followups.map(f => f.body.content);
    assert.ok(contents[0].includes('Interaction failed, wait 60s to wake server'), 'cold-start notice leads');
    assert.ok(contents[0].includes('https://wwm-gvgroster.onrender.com'),
        'notice links to the Render website for the instant path');
    assert.ok(contents.some(c => c.includes('## Saturday Roster')), 'saturday still delivered');
    assert.ok(contents.some(c => c.includes('## Sunday Roster')), 'sunday still delivered');
});

test('setup status: validates token and lists servers (superadmin)', async () => {
    const ctx = makeCtx();
    const server = ctx.app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/gamevox/setup/status`);
        assert.strictEqual(res.status, 200);
        const out = await res.json();
        assert.strictEqual(out.tokenOk, false, 'no token configured yet');
        assert.match(out.errors[0], /No bot token saved/);

        ctx.data._seed({ version: 1, targets: { gamevox: { botToken: 'GVB.smoke_token_value_0123456789abcdef', publicKey: 'b'.repeat(64) } } });
        const res2 = await fetch(`http://127.0.0.1:${port}/api/gamevox/setup/status`);
        const out2 = await res2.json();
        assert.strictEqual(out2.tokenOk, true);
        assert.strictEqual(out2.botUser.username, 'wwm_gvg_roster');
        assert.deepStrictEqual(out2.guilds, [{ id: '1516070040533311488', name: 'The Beginning After The End' }]);
        assert.strictEqual(out2.publicKeySet, true);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

    test('setup leave: platform 404 surfaces manual uninstall instructions', async () => {
    const ctx = makeCtx();
    ctx.data._seed({ version: 1, targets: { gamevox: { botToken: 'GVB.smoke_token_value_0123456789abcdef' } } });
    const server = ctx.app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/gamevox/setup/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildId: '1516070040533311488' })
        });
        const out = await res.json();
        assert.strictEqual(out.success, true);
        assert.strictEqual(out.removed, false);
        assert.strictEqual(out.manual, true);
        assert.ok(Array.isArray(out.steps) && out.steps.length >= 2);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
