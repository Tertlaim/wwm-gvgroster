// server/rate-limit.js - Dependency-free fixed-window limiter keyed by client IP (Phase 9.2)

const RATE_LIMITS = new Map(); // key -> { count, resetAt }
const LOGIN_MAX = 20;          // attempts per window per IP
const REGISTER_MAX = 15;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key, max, windowMs) {
    const now = Date.now();
    let entry = RATE_LIMITS.get(key);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        RATE_LIMITS.set(key, entry);
    }
    entry.count++;
    return {
        allowed: entry.count <= max,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
}

function clientIp(req) {
    return req.ip || req.connection.remoteAddress || 'unknown';
}

// Sweep expired entries so the map cannot grow unbounded.
setInterval(() => {
    const now = Date.now();
    RATE_LIMITS.forEach((v, k) => { if (v.resetAt <= now) RATE_LIMITS.delete(k); });
}, 10 * 60 * 1000).unref();

module.exports = { RATE_LIMITS, LOGIN_MAX, REGISTER_MAX, RATE_WINDOW_MS, checkRateLimit, clientIp };
