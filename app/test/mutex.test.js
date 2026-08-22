// test/mutex.test.js - keyed in-process write lock
const test = require('node:test');
const assert = require('node:assert');
const { createMutex } = require('../server/mutex');

test('serializes concurrent operations on the same key', async () => {
    const run = createMutex();
    const order = [];

    await Promise.all([
        run('data', async () => {
            order.push('a:start');
            await new Promise(r => setTimeout(r, 30));
            order.push('a:end');
        }),
        run('data', async () => {
            order.push('b:start');
            order.push('b:end');
        })
    ]);

    assert.deepStrictEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'],
        'second operation must not start before the first finishes');
});

test('different keys do not block each other', async () => {
    const run = createMutex();
    const order = [];

    await Promise.all([
        run('k1', async () => {
            await new Promise(r => setTimeout(r, 30));
            order.push('slow');
        }),
        run('k2', async () => {
            order.push('fast');
        })
    ]);

    assert.deepStrictEqual(order, ['fast', 'slow']);
});

test('a failing operation does not poison the queue', async () => {
    const run = createMutex();

    await assert.rejects(
        () => run('data', async () => { throw new Error('boom'); }),
        /boom/
    );

    let ran = false;
    await run('data', async () => { ran = true; });
    assert.strictEqual(ran, true, 'next queued op must still run');
});

test('results and errors propagate to the caller', async () => {
    const run = createMutex();
    const value = await run('x', async () => 42);
    assert.strictEqual(value, 42);
});
