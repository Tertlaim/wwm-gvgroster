// test/rate-limit.test.js - Phase 11.8: fixed-window rate limiter
const test = require('node:test');
const assert = require('node:assert');
const rate = require('../server/rate-limit');

test.beforeEach(() => {
    rate.RATE_LIMITS.clear();
});

test('allows exactly N attempts, then blocks the N+1th', () => {
    const key = 'login:' + Date.now();
    for (let i = 0; i < rate.LOGIN_MAX; i++) {
        assert.strictEqual(rate.checkRateLimit(key, rate.LOGIN_MAX, rate.RATE_WINDOW_MS).allowed, true,
            `attempt ${i + 1} must be allowed`);
    }
    const blocked = rate.checkRateLimit(key, rate.LOGIN_MAX, rate.RATE_WINDOW_MS);
    assert.strictEqual(blocked.allowed, false, 'attempt 21 must be blocked');
    assert.ok(blocked.retryAfterSec >= 1, 'blocked response carries retryAfter');
});

test('register limit is independent of login limit', () => {
    const key = 'register:' + Date.now();
    for (let i = 0; i < rate.REGISTER_MAX; i++) {
        assert.strictEqual(rate.checkRateLimit(key, rate.REGISTER_MAX, rate.RATE_WINDOW_MS).allowed, true);
    }
    assert.strictEqual(rate.checkRateLimit(key, rate.REGISTER_MAX, rate.RATE_WINDOW_MS).allowed, false);
});

test('different keys have independent counters', () => {
    assert.strictEqual(rate.checkRateLimit('a', 1, 60000).allowed, true);
    assert.strictEqual(rate.checkRateLimit('a', 1, 60000).allowed, false);
    assert.strictEqual(rate.checkRateLimit('b', 1, 60000).allowed, true, 'separate key is unaffected');
});

test('window expires and the counter resets', async () => {
    const key = 'window:' + Date.now();
    assert.strictEqual(rate.checkRateLimit(key, 2, 60).allowed, true);
    assert.strictEqual(rate.checkRateLimit(key, 2, 60).allowed, true);
    assert.strictEqual(rate.checkRateLimit(key, 2, 60).allowed, false);
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(rate.checkRateLimit(key, 2, 60).allowed, true, 'fresh window after expiry');
});
