// test/retry.test.js - withRetry backoff helper (boot-time resilience)
const test = require('node:test');
const assert = require('node:assert');
const { withRetry } = require('../server/util');

test('resolves immediately when the first attempt succeeds', async () => {
    let calls = 0;
    const value = await withRetry(async () => { calls++; return 'ok'; }, { retries: 3, delayMs: 1 });
    assert.strictEqual(value, 'ok');
    assert.strictEqual(calls, 1);
});

test('retries transient failures and then succeeds', async () => {
    let calls = 0;
    const value = await withRetry(async () => {
        calls++;
        if (calls < 3) throw new Error('502 blip');
        return 'recovered';
    }, { retries: 3, delayMs: 1 });
    assert.strictEqual(value, 'recovered');
    assert.strictEqual(calls, 3);
});

test('throws the last error after exhausting retries', async () => {
    let calls = 0;
    await assert.rejects(
        () => withRetry(async () => { calls++; throw new Error('down #' + calls); }, { retries: 2, delayMs: 1 }),
        /down #3/
    );
    assert.strictEqual(calls, 3, 'initial attempt + 2 retries');
});

test('logs a labeled warning between attempts', async () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
        await withRetry(async () => { throw new Error('x'); }, { retries: 1, delayMs: 1, label: 'Supabase boot read' });
    } catch (e) { /* expected */ }
    finally { console.warn = orig; }

    assert.ok(warnings.some(w => w.includes('Supabase boot read') && w.includes('1/2')),
        'warning should include label and attempt count');
});
