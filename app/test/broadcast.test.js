// test/broadcast.test.js - GvG Broadcast: pure helpers + queue behavior
const test = require('node:test');
const assert = require('node:assert');
const broadcast = require('../server/integrations/broadcast');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DISCORD_URL = 'https://discord.com/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKEN';
const GAMEVOX_URL = 'https://api.gamevox.com/webhooks/13d34f8c-bf80-44f8-84a4-d16d2d0bd335/WH.fake_token_value_0123456789abcdef';

function fixtureDb() {
    return {
        guildName: 'Test Guild',
        groups: {
            sat: {
                g1: { title: 'Offence 1', players: [
                    { id: 'p1', name: 'Antony', class: 'Heal', role: 'Vice Commander' },
                    { id: 'p2', name: 'Kaste', class: 'Tank', role: 'Commander' }
                ] },
                g2: { title: 'Defence', players: [] }
            },
            sun: {
                g1: { title: 'Offence 1', players: [
                    { id: 'p4', name: 'Therana', class: 'DPS', role: 'Commander' }
                ] }
            }
        },
        reserves: {
            sat: [{ id: 'p3', name: 'Yume', class: 'DPS', role: 'Member' }],
            sun: []
        },
        lastUpdateTime: '2026-08-22T10:00:00.000Z'
    };
}

function okResponse(body) {
    const payload = JSON.stringify(body == null ? {} : body);
    return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(payload),
        headers: { get: () => null }
    };
}

// Discord target enabled by default; gamevox stays off unless opted in.
function makeBroadcaster(overrides = {}) {
    const config = broadcast.defaultIntegrationsConfig();
    Object.assign(config, overrides.config || {});
    config.targets.discord.webhookUrl = DISCORD_URL;
    config.targets.discord.enabled = true;
    if (overrides.enableGamevox) {
        config.targets.gamevox.webhookUrl = GAMEVOX_URL;
        config.targets.gamevox.enabled = true;
    }
    const calls = { history: [], requests: [], configs: [] };
    const b = broadcast.createBroadcaster({
        readConfig: async () => config,
        writeConfig: async (cfg) => { calls.configs.push(JSON.parse(JSON.stringify(cfg))); return true; },
        readData: async () => overrides.db ? overrides.db() : fixtureDb(),
        appendHistory: (entry) => calls.history.push(entry),
        fetchImpl: overrides.fetchImpl || (async () => okResponse({ id: 'm1' })),
        // Cap platform pacing waits so 2-request rounds finish fast; the
        // debounce/floor timers below use real setTimeout and stay honest.
        sleep: (ms) => new Promise(r => setTimeout(r, Math.min(ms, 5))),
        ...(overrides.deps || {})
    });
    return { b, config, calls };
}

// ---- pure helpers ----

test('computeGroupsHash ignores key order but detects content changes', () => {
    const a = broadcast.computeGroupsHash(
        { sat: { g1: { title: 'A', players: [] } } },
        { sat: [] }
    );
    const sameDifferentOrder = broadcast.computeGroupsHash(
        { sat: { g1: { players: [], title: 'A' } } },
        { sat: [] }
    );
    const different = broadcast.computeGroupsHash(
        { sat: { g1: { title: 'A', players: [{ id: 'x' }] } } },
        { sat: [] }
    );
    assert.strictEqual(a, sameDifferentOrder);
    assert.notStrictEqual(a, different);
});

test('maskWebhookUrl hides the token except its last 4 chars', () => {
    const masked = broadcast.maskWebhookUrl(DISCORD_URL);
    assert.strictEqual(masked, 'discord.com/api/webhooks/123456789012345678/…OKEN');
    assert.ok(!masked.includes('tokentokenTOKENTOKENTOKEN'));
    assert.strictEqual(broadcast.maskWebhookUrl(GAMEVOX_URL),
        'api.gamevox.com/webhooks/13d34f8c-bf80-44f8-84a4-d16d2d0bd335/…cdef');
    assert.strictEqual(broadcast.maskWebhookUrl(''), '');
    assert.strictEqual(broadcast.maskWebhookUrl('not a url'), 'invalid-url');
});

test('isValidWebhookUrl host-pins both platforms and rejects foreign hosts', () => {
    assert.strictEqual(broadcast.isValidWebhookUrl('discord', DISCORD_URL), true);
    assert.strictEqual(broadcast.isValidWebhookUrl('discord',
        'https://discordapp.com/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKEN'), true);
    // GameVox incoming-webhook family (uuid id, WH.-token containing dots).
    assert.strictEqual(broadcast.isValidWebhookUrl('gamevox', GAMEVOX_URL), true);
    // GameVox bot/v10 family (snowflake id) is also accepted.
    assert.strictEqual(broadcast.isValidWebhookUrl('gamevox',
        'https://bot-api.gamevox.com/api/v10/webhooks/1541032070230716416/tokenTOKENtoken1234'), true);
    assert.strictEqual(broadcast.isValidWebhookUrl('discord',
        'http://discord.com/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKEN'), false);
    assert.strictEqual(broadcast.isValidWebhookUrl('discord',
        'https://evil.example/api/webhooks/123456789012345678/tokentokenTOKENTOKENTOKEN'), false);
    assert.strictEqual(broadcast.isValidWebhookUrl('gamevox',
        'https://api.gamevox.com/webhooks/app-1/short'), false);
    assert.strictEqual(broadcast.isValidWebhookUrl('slack', 'https://hooks.slack.com/x'), false);
});

test('buildDayMessage renders groups + reserves with counts, colors and footer', () => {
    const msg = broadcast.buildDayMessage(fixtureDb(), 'sat', { updatedBy: 'moduser', timestamp: '2026-08-22T11:00:00.000Z' });
    assert.ok(msg);
    assert.strictEqual(msg.embeds.length, 2);

    const groups = msg.embeds[0];
    assert.strictEqual(groups.title, 'Saturday — Groups');
    assert.strictEqual(groups.color, 0xF1C40F);
    assert.strictEqual(groups.timestamp, '2026-08-22T11:00:00.000Z');
    assert.strictEqual(groups.footer.text, 'WWM GvG Roster · updated by moduser');
    assert.deepStrictEqual(groups.fields.map(f => f.name), ['⚔️ Offence 1 · 2/30', '🛡️ Defence · 0/30']);
    assert.strictEqual(groups.fields[0].value, '**Antony** · 🌿 Heal · Vice Commander\n**Kaste** · 🛡️ Tank · Commander');
    assert.strictEqual(groups.fields[1].value, '—');

    const reserves = msg.embeds[1];
    assert.strictEqual(reserves.title, 'Reserves · 1');
    assert.strictEqual(reserves.color, 0xF1C40F);
    assert.strictEqual(reserves.fields[0].value, '**Yume** · ⚔️ DPS · Member');
});

test('buildDayMessage uses blue for Sunday and returns null for empty days', () => {
    const sun = broadcast.buildDayMessage(fixtureDb(), 'sun', {});
    assert.ok(sun);
    assert.strictEqual(sun.embeds[0].color, 0x3498DB);
    assert.strictEqual(sun.embeds[0].fields[0].value, '**Therana** · ⚔️ DPS · Commander');

    assert.strictEqual(broadcast.buildDayMessage({ groups: {}, reserves: {} }, 'sat', {}), null);
    assert.strictEqual(broadcast.buildDayMessage(null, 'sat', {}), null);
});

test('large rosters split into (cont.) fields within embed budgets', () => {
    const players = [];
    for (let i = 0; i < 45; i++) {
        players.push({ id: 'p' + i, name: 'Player' + String(i).padStart(2, '0'), class: 'DPS', role: 'Member' });
    }
    const db = { groups: { sat: { g1: { title: 'Offence', players } }, sun: {} }, reserves: { sat: [], sun: [] } };
    const msg = broadcast.buildDayMessage(db, 'sat', {});
    const fields = msg.embeds[0].fields;
    assert.strictEqual(fields.length, 3);
    const baseName = '⚔️ Offence · 45/' + broadcast.GROUP_CAP;
    assert.strictEqual(fields[0].name, baseName);
    assert.strictEqual(fields[1].name, baseName + ' (cont.)');
    assert.strictEqual(fields[2].name, baseName + ' (cont.)');
    const lineCounts = fields.map(f => f.value.split('\n').length);
    assert.deepStrictEqual(lineCounts, [20, 20, 5]);
    fields.forEach(f => assert.ok(f.value.length <= 1024, 'field value under platform cap'));
    const allLines = fields.flatMap(f => f.value.split('\n'));
    assert.strictEqual(allLines.length, 45);
});

test('player lines strip markdown control characters from names/roles', () => {
    const db = { groups: { sat: { g1: { title: 'Offence', players: [
        { id: 'p1', name: '**Evil**_name~', class: 'DPS', role: '`Member`|' }
    ] } } }, reserves: { sat: [], sun: [] } };
    const msg = broadcast.buildDayMessage(db, 'sat', {});
    assert.strictEqual(msg.embeds[0].fields[0].value, '**Evilname** · ⚔️ DPS · Member');
});

test('buildDayText renders plain markdown for embed-less platforms', () => {
    const text = broadcast.buildDayText(fixtureDb(), 'sat', { updatedBy: 'moduser' });
    assert.ok(text.includes('**Saturday Roster**'), 'day-only header');
    assert.ok(text.startsWith('**Saturday Roster**'), 'header is the first line');
    assert.ok(text.includes('⚔️ **Offence 1** · 2/30'), 'group title with count');
    assert.ok(text.includes('- **Antony** · 🌿 Heal · Vice Commander'), 'player bullets');
    assert.ok(text.includes('🕐 **Reserves** · 1'), 'reserves section');
    assert.ok(text.endsWith('_updated by moduser_'), 'signature footer last');
    assert.ok(!text.includes('embeds'), 'plain markdown only');

    assert.strictEqual(broadcast.buildDayText({ groups: {}, reserves: {} }, 'sun', {}), null);
    assert.strictEqual(broadcast.buildDayText(null, 'sat', {}), null);
});

test('buildDayText never includes the announcement segment', () => {
    const db = fixtureDb();
    db.announcement = { text: 'Signups close Friday.\nBe on time.', author: 'Kaste', timestamp: '' };
    const text = broadcast.buildDayText(db, 'sat', { updatedBy: 'moduser' });
    assert.ok(!text.includes('Announcement'), 'no announcement segment');
    assert.ok(!text.includes('Signups close Friday.'), 'announcement text stays on the web');
    assert.ok(text.startsWith('**Saturday Roster**'), 'message opens with the roster header');
});

// ---- broadcaster queue behavior ----

test('rapid notifies collapse into a single debounced push (trailing edge)', async () => {
    let postCount = 0;
    const fetchImpl = async () => { postCount++; return okResponse({ id: 'm' + postCount }); };
    const { b, calls } = makeBroadcaster({
        config: { debounceSec: 0.05 },
        deps: { fetchImpl }
    });

    b.notify();
    b.notify();
    b.notify();
    await sleep(400);

    // Two days -> POST create per day, exactly one push round.
    assert.strictEqual(postCount, 2, 'burst of notifies must produce one push round');
    assert.strictEqual(calls.history.filter(h => h.action === 'broadcast').length, 1);

    // Identical content after the push: hash gate blocks any further call.
    b.notify();
    await sleep(400);
    assert.strictEqual(postCount, 2, 'unchanged content never triggers a second call');

    b.destroy();
});

test('changed content pushes again as edit-in-place PATCHes', async () => {
    const methods = [];
    const dbState = fixtureDb();
    const fetchImpl = async (url, opts) => {
        methods.push(opts.method + ' ' + url);
        return okResponse({ id: methods.length <= 2 ? 'day-' + (methods.length) : 'kept' });
    };
    const { b, config } = makeBroadcaster({
        config: { debounceSec: 0.05, autoIntervalMin: 0.02 },
        deps: { fetchImpl },
        db: () => dbState
    });

    b.notify();
    await sleep(300);
    assert.strictEqual(methods.length, 2);
    assert.ok(methods[0].startsWith('POST'), 'first push creates');

    dbState.groups.sat.g1.players.push({ id: 'p5', name: 'New', class: 'DPS' });
    b.notify();
    await sleep(1700); // debounce + floor retry window (~1.25s)
    assert.strictEqual(methods.length, 4);
    assert.ok(methods[2].startsWith('PATCH'), 'later updates edit in place');
    assert.ok(methods[2].includes('/messages/day-1'));
    assert.strictEqual(config.targets.discord.satMessageId, 'day-1');
    assert.strictEqual(config.targets.discord.sunMessageId, 'day-2');

    b.destroy();
});

test('auto-push floor delays a burst right after a push until expiry', async () => {
    let requestCount = 0;
    const fetchImpl = async () => { requestCount++; return okResponse({ id: 'm' + requestCount }); };
    const dbState = fixtureDb();
    const { b } = makeBroadcaster({
        config: { debounceSec: 0.05, autoIntervalMin: 0.02 },
        deps: { fetchImpl },
        db: () => dbState
    });

    b.notify();
    await sleep(300);
    assert.strictEqual(requestCount, 2, 'first push goes out immediately');

    dbState.groups.sat.g1.players.push({ id: 'px', name: 'Late', class: 'DPS' });
    b.notify();
    await sleep(500);
    assert.strictEqual(requestCount, 2, 'inside the floor window nothing is sent');

    await sleep(1200); // floor retry fires (~1.2s window)
    assert.strictEqual(requestCount, 4, 'deferred content is pushed at floor expiry, not dropped');

    b.destroy();
});

test('manual push bypasses the floor but honors its own cooldown', async () => {
    let requestCount = 0;
    const fetchImpl = async () => { requestCount++; return okResponse({ id: 'm' + requestCount }); };
    const { b } = makeBroadcaster({ deps: { fetchImpl } });

    const first = await b.pushNow('moduser');
    assert.strictEqual(first.discord.ok, true);
    const second = await b.pushNow('moduser');
    assert.strictEqual(second.discord.cooldown, true);
    assert.strictEqual(second.discord.retryAfterSec > 0 && second.discord.retryAfterSec <= 30, true);
    assert.strictEqual(requestCount, 2, 'cooldown blocks an immediate repeat');

    b.destroy();
});

test('repeated failures trip the circuit breaker; manual success clears it', async () => {
    let failing = true;
    let clock = Date.now();
    const fetchImpl = async () => {
        if (failing) {
            return {
                ok: false,
                status: 500,
                json: async () => ({ message: 'boom' }),
                headers: { get: () => null }
            };
        }
        return okResponse({ id: 'ok1' });
    };
    const { b, calls } = makeBroadcaster({ deps: { fetchImpl, now: () => clock } });

    for (let i = 0; i < broadcast.BREAKER_THRESHOLD; i++) {
        const r = await b.pushNow('moduser');
        assert.strictEqual(r.discord.ok, false);
        clock += 31 * 1000; // outlive the manual cooldown for the next attempt
    }
    const status = b.getStatus();
    assert.strictEqual(status.discord.breakerActive, true);
    assert.strictEqual(status.discord.consecutiveFailures, broadcast.BREAKER_THRESHOLD);

    const before = calls.history.length;
    b.notify(); // auto-push while broken: must be a no-op
    await sleep(250);
    assert.strictEqual(calls.history.length, before, 'breaker silences auto-push entirely');

    failing = false;
    const manual = await b.pushNow('moduser'); // escape hatch stays open
    assert.strictEqual(manual.discord.ok, true);
    assert.strictEqual(b.getStatus().discord.breakerActive, false);

    b.destroy();
});

test('unconfigured targets are inert: notify never reaches HTTP', async () => {
    let called = 0;
    const fetchImpl = async () => { called++; return okResponse({ id: 'm' + called }); };
    const { b, config } = makeBroadcaster({ config: { debounceSec: 0.05 }, deps: { fetchImpl } });
    config.targets.discord.enabled = false;
    config.targets.discord.webhookUrl = '';

    b.notify();
    await sleep(300);
    assert.strictEqual(called, 0, 'disabled target with no webhook does nothing');

    b.destroy();
});

test('gamevox defaults to manual-only: auto-push skips it, Push Now creates fresh posts', async () => {
    assert.strictEqual(broadcast.defaultIntegrationsConfig().targets.discord.mode, 'auto');
    assert.strictEqual(broadcast.defaultIntegrationsConfig().targets.gamevox.mode, 'manual');

    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ method: opts.method, url, body: JSON.parse(opts.body) });
        return okResponse({ id: 'gv' + calls.length });
    };
    const { b } = makeBroadcaster({
        config: { debounceSec: 0.05 },
        enableGamevox: true,
        deps: { fetchImpl }
    });

    b.notify(); // debounced auto-push round
    await sleep(300);
    assert.strictEqual(calls.filter(c => c.url.includes('gamevox')).length, 0,
        'auto-push never touches manual-mode targets');
    assert.strictEqual(calls.length, 2, 'discord still auto-pushes sat+sun');

    await b.pushNow('moduser', 'gamevox'); // the Push Now button path
    const gv = calls.filter(c => c.url.includes('gamevox'));
    assert.strictEqual(gv.length, 2, 'manual push covers both days');
    gv.forEach(c => {
        assert.strictEqual(c.method, 'POST', 'create-only platform never PATCHes');
        assert.ok(!c.url.includes('/messages/'), 'no edit endpoints used');
        assert.ok(typeof c.body.content === 'string' && c.body.content.length > 0,
            'gamevox payloads carry the required plain-text content');
        assert.strictEqual(c.body.embeds, undefined,
            'embeds are not wired in gamevox webhooks v1 - markdown text only');
    });
    assert.ok(gv[0].body.content.includes('**Saturday Roster**'), 'content is the markdown roster');
    assert.ok(gv[0].body.content.includes('**Antony**'), 'players render as markdown bullets');

    calls.filter(c => c.url.includes('discord')).forEach(c =>
        assert.strictEqual(c.body.content, undefined, 'discord stays embeds-only'));

    b.destroy();
});
