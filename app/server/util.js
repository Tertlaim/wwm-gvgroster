// server/util.js - Shared low-level utilities (Phase 11.1)

// ============================================
// ATOMIC FILE WRITES (Phase 8.1)
// ============================================
// Write via a temp file + rename so a crash mid-write can never leave a
// truncated/partial JSON file on disk (the rename is atomic on POSIX and
// replace-on-rename on Windows).
const fs = require('fs');

function atomicWriteFileSync(filePath, data) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
}

// ============================================
// RETRY (boot-time resilience)
// ============================================
// Retry an async operation with linear backoff. Used by boot-time reads so a
// transient CDN/gateway blip (e.g. a Cloudflare 502 in front of Supabase)
// cannot silently skip initialization steps such as tombstone hydration.
// Runtime request paths stay single-shot: they should fail fast, and the
// client re-syncs.
async function withRetry(fn, { retries = 3, delayMs = 500, label = 'operation' } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (attempt > retries) break;
            console.warn(`⚠️ ${label} failed (attempt ${attempt}/${retries + 1}), retrying...`);
            await new Promise(r => setTimeout(r, delayMs * attempt));
        }
    }
    throw lastErr;
}

module.exports = { atomicWriteFileSync, withRetry };
