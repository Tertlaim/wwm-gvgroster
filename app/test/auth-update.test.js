// test/auth-update.test.js - updateAuthConfig serialization + async contract
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../server/auth');

// Fake async storage (Supabase-like): every read/write takes a tick.
let store = null;
let writeCount = 0;

function fakeAsyncStorage() {
    return {
        async readAuthConfig() {
            await new Promise(r => setTimeout(r, 5));
            return JSON.parse(JSON.stringify(store));
        },
        async writeAuthConfig(data) {
            await new Promise(r => setTimeout(r, 5));
            store = JSON.parse(JSON.stringify(data));
            writeCount++;
            return true;
        },
        async initAuthConfig() {}
    };
}

test.beforeEach(() => {
    store = {
        admin: { username: 'SuperAdmin', password: 'x', role: 'superadmin' },
        moderators: [],
        settings: { maxGroups: 6 }
    };
    writeCount = 0;
    auth.setAuthStorage(fakeAsyncStorage());
});

test('concurrent mutations are serialized and both land', async () => {
    const [r1, r2] = await Promise.all([
        auth.updateAuthConfig(cfg => { cfg.moderators.push({ username: 'modA' }); }),
        auth.updateAuthConfig(cfg => { cfg.moderators.push({ username: 'modB' }); })
    ]);

    assert.ok(r1, 'first update saved');
    assert.ok(r2, 'second update saved');
    assert.strictEqual(store.moderators.length, 2, 'no lost update');
    assert.deepStrictEqual(store.moderators.map(m => m.username).sort(), ['modA', 'modB']);
});

test('mutator returning false aborts without writing', async () => {
    const result = await auth.updateAuthConfig(cfg => {
        cfg.moderators.push({ username: 'ghost' });
        return false; // validation failed after responding elsewhere
    });
    assert.strictEqual(result, null);
    assert.strictEqual(store.moderators.length, 0, 'nothing persisted');
    assert.strictEqual(writeCount, 0, 'no write attempted');
});

test('mutator throwing aborts without writing and rejects', async () => {
    await assert.rejects(
        () => auth.updateAuthConfig(() => {
            const e = new Error('nope');
            e.status = 400;
            throw e;
        }),
        /nope/
    );
    assert.strictEqual(writeCount, 0);
});

test('write failure resolves null and leaves storage untouched', async () => {
    auth.setAuthStorage({
        async readAuthConfig() { return JSON.parse(JSON.stringify(store)); },
        async writeAuthConfig() { return false; }
    });
    const result = await auth.updateAuthConfig(cfg => { cfg.settings.maxGroups = 9; });
    assert.strictEqual(result, null);
    assert.strictEqual(store.settings.maxGroups, 6);
});

test('missing config resolves null', async () => {
    store = null;
    const result = await auth.updateAuthConfig(() => {});
    assert.strictEqual(result, null);
});

test('readAuthConfig reflects committed writes (no stale cache)', async () => {
    await auth.updateAuthConfig(cfg => { cfg.settings.publicRegistration = false; });
    const fresh = await auth.readAuthConfig();
    assert.strictEqual(fresh.settings.publicRegistration, false);
});
