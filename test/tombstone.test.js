// test/tombstone.test.js - Phase 11.8: deletion ledger survives a restart
// The ledger is written into database.json on every save (Phase 8.2) and
// re-hydrated at boot. data.js binds to the repo's live database.json, so
// this test simulates the exact same serialize -> disk -> hydrate cycle on a
// temp file without touching live data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteFileSync } = require('../server/util');
const merge = require('../server/merge');

test('tombstone ledger round-trips through disk and blocks resurrection after "restart"', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gwar-tomb-'));
    const ledgerFile = path.join(tmp, 'ledger.json');
    try {
        // --- "before restart" ---
        merge.DELETED_PLAYERS.clear();
        merge.recordDeletedPlayers(['p_killed', 'p_gone']);
        const deletedAt = merge.DELETED_PLAYERS.get('p_killed');

        // Simulate Phase 8.2 save: ledger serialized into the database file.
        const db = { deletedPlayers: Object.fromEntries(merge.DELETED_PLAYERS) };
        atomicWriteFileSync(ledgerFile, JSON.stringify(db, null, 2));

        // --- "server restarts" ---
        // Fresh map, hydrated the way loadTombstonesFromDisk does it.
        const fresh = new Map();
        const parsed = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
        Object.keys(parsed.deletedPlayers).forEach(id => {
            const t = Number(parsed.deletedPlayers[id]);
            if (id && !isNaN(t)) fresh.set(id, t);
        });

        assert.strictEqual(fresh.size, 2, 'both tombstones survive the restart');
        assert.strictEqual(fresh.get('p_killed'), deletedAt, 'timestamp round-trips exactly');

        // Wire the hydrated map into the merge module's lookup (as boot does)
        // and verify the post-restart protection.
        merge.DELETED_PLAYERS.clear();
        fresh.forEach((t, id) => merge.DELETED_PLAYERS.set(id, t));
        const staleBase = deletedAt - 60000;
        assert.strictEqual(merge.isTombstoned('p_killed', staleBase), true,
            'stale snapshot cannot resurrect after restart');
        assert.strictEqual(merge.isTombstoned('p_killed', deletedAt + 1000), false,
            'post-restart snapshot is fine');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        merge.DELETED_PLAYERS.clear();
    }
});

test('empty ledger round-trips as an empty object', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gwar-tomb2-'));
    try {
        merge.DELETED_PLAYERS.clear();
        const db = { deletedPlayers: Object.fromEntries(merge.DELETED_PLAYERS) };
        assert.deepStrictEqual(db.deletedPlayers, {});
        const serialized = JSON.stringify(db);
        const reparsed = JSON.parse(serialized);
        assert.deepStrictEqual(reparsed.deletedPlayers, {});
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
