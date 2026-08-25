// GameVox interactions endpoint: signature verification, PING handshake,
// /publish command with deferred reply + chunked followups.
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
    let integrations = null;
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
        async writeIntegrations(cfg) { integrations = JSON.parse(JSON.stringify(cfg)); return true; }
    };
    const followups = [];
    const botFetch = async (url, opts) => {
        followups.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({ id: 'f' + followups.length }), headers: { get: () => null } };
    };
    const app = express();
    app.use(express.json({
        verify: (req, res, buf) => { req.rawBody = buf; }
    }));
    registerGamevoxInteractions(app, { data, broadcast, botFetch });
    return { app, data, followups };
}

function signedRequest(app, payload, opts = {}) {
    const server = app.listen(0);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    let sig = '';
    if (!opts.skipSignature) {
        sig = crypto.sign(null, Buffer.from(timestamp + rawBody), privateKey).toString('hex');
    }
    const port = server.address().port;
    const p = fetch('http://127.0.0.1:' + port + '/api/gamevox/interactions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Signature-Ed25519': sig || '00'.repeat(64),
            'X-Signature-Timestamp': timestamp,
            ...(opts.extraHeaders || {})
        },
        body: rawBody,
        signal: AbortSignal.timeout(10000)
    });
    return { promise: p, server };
}

async function requestJson(app, payload, opts) {
    const { promise, server } = signedRequest(app, payload, opts);
    try {
        const res = await promise;
        let json = null;
        try { json = await res.json(); } catch (e) { /* empty */ }
        return { status: res.status, json };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

// Cold start simulation: sign with a timestamp 40s in the past (inside the
// 10-min replay guard, outside the 3s callback window).
async function lateRequest(app, payload) {
    const server = app.listen(0);
    const stale = Math.floor(Date.now() / 1000) - 40;
    const rawBody = JSON.stringify(payload);
    const sig = crypto.sign(null, Buffer.from(stale + rawBody), privateKey).toString('hex');
    try {
        const port = server.address().port;
        const res = await fetch('http://127.0.0.1:' + port + '/api/gamevox/interactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': sig,
                'X-Signature-Timestamp': String(stale)
            },
            body: rawBody
        });
        let json = null;
        try { json = await res.json(); } catch (e) { /* empty body */ }
        return { status: res.status, json };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('interactions: late (cold-start) publish delivers via followups with wake notice + site link', async () => {
    const ctx = makeCtx();
    const r = await lateRequest(ctx.app, {
        type: 2,
        token: 'late-token',
        data: { name: 'gvg', options: [] },
        member: { user: { username: 'Kaste' }, permissions: '8192' }
    });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, {}, 'no callback payload - window long gone');
    // Give the async followup chain a moment.
    await new Promise(resolve => setTimeout(resolve, 30));

    const contents = ctx.followups.map(f => f.body.content);
    assert.ok(contents[0].includes('Interaction failed, wait 60s to wake server'), 'cold-start notice leads');
    assert.ok(contents[0].includes('https://wwm-gvgroster.onrender.com'),
        'notice links to the Render website for the instant path');
    assert.ok(contents.some(c => c.includes('## Saturday Roster')), 'saturday still delivered');
    assert.ok(contents.some(c => c.includes('## Sunday Roster')), 'sunday still delivered');
    assert.ok(ctx.followups.every(f => f.url.includes('/webhooks/1541027880090140673/late-token')),
        'all delivered through the interaction webhook token');
});

test('interactions: late denial arrives as ephemeral followup instead of vanishing', async () => {
    const ctx = makeCtx();
    const r = await lateRequest(ctx.app, {
        type: 2,
        token: 'late-denied',
        data: { name: 'gvg', options: [] },
        member: { user: { username: 'RandomGuy' }, permissions: '0' }
    });
    assert.strictEqual(r.status, 200);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.strictEqual(ctx.followups.length, 1);
    assert.strictEqual(ctx.followups[0].body.flags, 64, 'denial stays ephemeral');
    assert.match(ctx.followups[0].body.content, /Only moderators and admins/);
});

test('interactions: unsigned and forged requests are rejected with 401', async () => {
    const ctx = makeCtx();

    const noSig = await requestJson(ctx.app, { type: 1 }, { skipSignature: true });
    assert.strictEqual(noSig.status, 401);

    // Well-formed 128-hex signature that does NOT match this payload.
    const server = ctx.app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch('http://127.0.0.1:' + port + '/api/gamevox/interactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': 'f'.repeat(128),
                'X-Signature-Timestamp': String(Math.floor(Date.now() / 1000))
            },
            body: JSON.stringify({ type: 1 })
        });
        assert.strictEqual(res.status, 401);
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
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const rawBody = JSON.stringify({ type: 1 });
    const sig = crypto.sign(null, Buffer.from(stale + rawBody), privateKey).toString('hex');
    const server = ctx.app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch('http://127.0.0.1:' + port + '/api/gamevox/interactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': sig,
                'X-Signature-Timestamp': String(stale)
            },
            body: rawBody
        });
        assert.strictEqual(res.status, 401);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('interactions: /gvg defers then delivers both days as followups', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'interaction-token-abc',
        data: { name: 'gvg', options: [] },
        member: {
            nick: 'Kaste',
            permissions: '8192', // Manage Messages (0x2000)
            user: { username: 'Kaste' }
        }
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.type, 5, 'deferred reply');
    await new Promise(resolve => setTimeout(resolve, 30)); // let followups flush

    const contents = ctx.followups.map(f => f.body.content);
    assert.ok(contents.some(c => c.includes('## Saturday Roster')), 'saturday delivered');
    assert.ok(contents.some(c => c.includes('## Sunday Roster')), 'sunday delivered');
    assert.ok(ctx.followups.every(f =>
        f.url.startsWith('https://bot-api.gamevox.com/api/v10/webhooks/1541027880090140673/interaction-token-abc')),
        'followups target the interaction webhook');
});

test('interactions: members without Manage Messages get an ephemeral denial', async () => {
    const ctx = makeCtx();
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'tok',
        data: { name: 'gvg', options: [] },
        member: { user: { username: 'RandomGuy' }, permissions: '0' }
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.type, 4);
    assert.match(r.json.data.content, /Only moderators and admins/);
    assert.strictEqual(r.json.data.flags, 64);
    assert.strictEqual(ctx.followups.length, 0, 'denied publish never posts');
});

test('interactions: empty rosters answer ephemerally without posting', async () => {
    const ctx = makeCtx();
    // Overwrite roster storage with an empty database.
    ctx.data.readDatabase = async () => ({ groups: {}, reserves: {} });
    const r = await requestJson(ctx.app, {
        type: 2,
        token: 'tok',
        data: { name: 'gvg', options: [{ name: 'days', value: 'sat' }] },
        member: { user: { username: 'Mod' }, permissions: '8192' } // Manage Messages
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.type, 4);
    assert.match(r.json.data.content, /Nothing to publish/i);
    assert.strictEqual(ctx.followups.length, 0);
});

test('splitForChat breaks long text at line boundaries under the limit', () => {
    const text = Array.from({ length: 120 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const chunks = broadcast.splitForChat(text, 1900);
    assert.ok(chunks.length > 1, 'long input splits');
    for (const c of chunks) {
        assert.ok(c.length <= 1900, 'every chunk respects the limit');
    }
    assert.strictEqual(chunks.join('\n'), text, 'chunks reassemble losslessly');
});
