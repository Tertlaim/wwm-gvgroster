// test/tombstone-hydrate.test.js - boot-time ledger hydration from a stored db
const test = require('node:test');
const assert = require('node:assert');
const merge = require('../server/merge');

// Isolate the module-level DELETED_PLAYERS singleton per test.
test.beforeEach(() => {
    merge.DELETED_PLAYERS.clear();
});
test.afterEach(() => {
    merge.DELETED_PLAYERS.clear();
});

test('hydrates entries from a db.deletedPlayers table', () => {
    const n = merge.hydrateTombstonesFromDb({ 'p_1': 1000, 'p_2': 2000 });
    assert.strictEqual(n, 2);
    assert.strictEqual(merge.DELETED_PLAYERS.get('p_1'), 1000);
    assert.strictEqual(merge.DELETED_PLAYERS.get('p_2'), 2000);
});

test('tolerates missing or malformed tables', () => {
    assert.strictEqual(merge.hydrateTombstonesFromDb(undefined), 0);
    assert.strictEqual(merge.hydrateTombstonesFromDb(null), 0);
    assert.strictEqual(merge.hydrateTombstonesFromDb({}), 0);
    // Non-numeric timestamps are skipped
    assert.strictEqual(merge.hydrateTombstonesFromDb({ bad: 'nope' }), 0);
});

test('a hydrated id is tombstoned for stale saves (restart scenario)', () => {
    const deletionTime = Date.now();
    merge.hydrateTombstonesFromDb({ 'p_gone': deletionTime });

    // A client whose snapshot predates the deletion must not resurrect it.
    assert.strictEqual(merge.isRemoved('p_gone', new Set(), deletionTime - 5000), true);
    // A client whose base already postdates the deletion is treated as fresh
    // (Phase 4.5 semantics: its payload governs; it would not carry the
    // deleted player in the first place).
    assert.strictEqual(merge.isRemoved('p_gone', new Set(), deletionTime + 5000), false);
    // Unrelated ids are untouched.
    assert.strictEqual(merge.isRemoved('p_other', new Set(), 0), false);
});
