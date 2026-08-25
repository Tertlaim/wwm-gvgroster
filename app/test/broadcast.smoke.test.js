// test/broadcast.smoke.test.js - GvG Broadcast boot smoke (real server)
//
// Boots the REAL app/server.js as a child process with DATA_DIR/AUTH_PATH
// pointed at an isolated temp dir (never touches real data files), then
// exercises login -> config -> push over actual HTTP.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ADMIN_USER = 'SmokeAdmin';
const ADMIN_PASS = 'SmokePass123!';
const SMOKE_BOT_TOKEN = 'GVB.smoke_token_value_0123456789abcdef';

function makeTempEnv() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-smoke-'));
    const dataDir = path.join(base, 'data');
    const configFile = path.join(base, 'config', 'auth.json');
    fs.mkdirSync(dataDir);
    fs.mkdirSync(path.dirname(configFile));
    // Plaintext password on purpose: boot-time migratePlaintextPasswords()
    // hashes it, which also proves the migration ran in the child.
    fs.writeFileSync(configFile, JSON.stringify({
        admin: {
            id: 'admin_001',
            username: ADMIN_USER,
            password: ADMIN_PASS,
            role: 'superadmin',
            createdAt: new Date().toISOString()
        },
        moderators: [],
        settings: { maxGroups: 6, historyLimit: 100 }
    }, null, 2));
    // Pre-seed bot configuration so the smoke run never performs a live
    // channel lookup (zero outbound traffic to the real platform).
    fs.writeFileSync(path.join(dataDir, 'integrations.json'), JSON.stringify({
        version: 1,
        debounceSec: 75,
        autoIntervalMin: 15,
        targets: {
            discord: { platform: 'discord', enabled: false, mode: 'auto', webhookUrl: '', satMessageId: null, sunMessageId: null },
            gamevox: {
                platform: 'gamevox', enabled: true, mode: 'manual',
                botToken: SMOKE_BOT_TOKEN,
                botChannels: ['1540402360065040384'],
                botPostMode: 'fresh',
                siteLabel: '', siteUrl: '',
                channelIds: {}
            }
        }
    }, null, 2));
    return { base, dataDir, configFile };
}

async function startServer(env) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(ROOT, 'app', 'server.js')], {
        cwd: ROOT,
        env: { ...process.env, ...env, PORT: String(port), STORAGE: 'json' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += String(d); });

    const base = 'http://127.0.0.1:' + port;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(base + '/api/staff');
            if (res.ok) return { child, base };
        } catch (e) { /* not up yet */ }
        await new Promise(r => setTimeout(r, 150));
    }
    child.kill();
    throw new Error('server did not become ready. stderr:\n' + stderr.slice(-2000));
}

test('boot smoke: real server serves authed broadcast endpoints end to end', async () => {
    const tmp = makeTempEnv();
    let proc = null;
    try {
        proc = await startServer({ DATA_DIR: tmp.dataDir, AUTH_PATH: tmp.configFile });
        const { base } = proc;

        // Broadcast config is auth-gated.
        const anon = await fetch(base + '/api/broadcast/config');
        assert.strictEqual(anon.status, 401);

        // Login with the seeded superadmin (plaintext got migrated at boot).
        const loginRes = await fetch(base + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
        });
        assert.strictEqual(loginRes.status, 200, 'seeded admin must be able to log in');
        const loginBody = await loginRes.json();
        assert.strictEqual(loginBody.success, true);
        assert.ok(loginBody.token, 'login issues a session token');

        const authHeaders = {
            'Content-Type': 'application/json',
            authorization: 'Bearer ' + loginBody.token
        };

        // Default masked config view (bot is pre-seeded as enabled).
        const cfg1 = await fetch(base + '/api/broadcast/config', { headers: authHeaders });
        assert.strictEqual(cfg1.status, 200);
        const cfg1Body = await cfg1.json();
        assert.strictEqual(cfg1Body.success, true);
        assert.strictEqual(cfg1Body.targets.discord.hasWebhook, false);
        assert.strictEqual(cfg1Body.targets.gamevox.enabled, true);
        assert.strictEqual(cfg1Body.targets.gamevox.hasBotToken, true);

        // SuperAdmin write round-trips raw bot values (inline-form support);
        // masking for other roles is covered by broadcast.routes.test.js.
        const post = await fetch(base + '/api/broadcast/config', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                targets: { gamevox: { enabled: true, botPostMode: 'edit' } }
            })
        });
        assert.strictEqual(post.status, 200);
        const postBody = await post.json();
        assert.strictEqual(postBody.targets.gamevox.hasBotToken, true);
        assert.match(postBody.targets.gamevox.botTokenMasked, /…cdef$/);
        assert.deepStrictEqual(postBody.targets.gamevox.botChannels, ['1540402360065040384']);

        // Persisted to the isolated integrations file (write path works).
        const stored = JSON.parse(fs.readFileSync(path.join(tmp.dataDir, 'integrations.json'), 'utf8'));
        assert.strictEqual(stored.targets.gamevox.botToken, SMOKE_BOT_TOKEN);
        assert.strictEqual(stored.targets.gamevox.enabled, true);
        assert.strictEqual(stored.targets.gamevox.botPostMode, 'edit');

        // Manual push endpoint answers through the real broadcaster. The
        // fresh default database has no roster content, so both days render
        // as empty and the push is a clean no-op (zero outbound HTTP - no
        // test traffic ever reaches the real platform).
        const push = await fetch(base + '/api/broadcast/push', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ target: 'gamevox' })
        });
        assert.strictEqual(push.status, 200);
        const pushBody = await push.json();
        assert.strictEqual(pushBody.success, true);
        assert.strictEqual(pushBody.results.gamevox.ok, true);
        assert.strictEqual(pushBody.results.gamevox.days.filter(d => d.skipped).length, 2);

        // Server still healthy after the failed push.
        const health = await fetch(base + '/api/staff');
        assert.strictEqual(health.status, 200);
    } finally {
        if (proc) proc.child.kill();
        await new Promise(r => setTimeout(r, 300));
        fs.rmSync(tmp.base, { recursive: true, force: true });
    }
});
