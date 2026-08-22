// server/mutex.js - In-process keyed mutex (Phase: concurrency hardening)
// Serializes read-modify-write cycles per resource key so two concurrent
// requests cannot interleave read -> mutate -> write on the same file/row.
// Single-process only; multi-instance deployments need a real store-level
// lock or optimistic concurrency instead.

function createMutex() {
    const tails = new Map(); // key -> Promise (settled tail of the lock queue)

    return function run(key, fn) {
        const prev = tails.get(key) || Promise.resolve();
        const result = prev.then(() => fn());
        // Keep a never-rejecting tail so one failure cannot poison the queue.
        const tail = result.catch(() => {});
        tails.set(key, tail);
        tail.then(() => {
            if (tails.get(key) === tail) tails.delete(key);
        });
        return result;
    };
}

module.exports = { createMutex };
