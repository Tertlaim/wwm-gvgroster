// test/merge.test.js - Phase 11.8: merge engine + tombstone ledger
// Runs with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const merge = require('../server/merge');

// The ledger is module-level state shared across tests; start each test clean.
test.beforeEach(() => {
    merge.DELETED_PLAYERS.clear();
});

function player(id, name, cls, role) {
    return { id, name: name || id, class: cls || 'DPS', role: role || 'Member' };
}

function dayState() {
    return {
        groups: {
            sat: { offence1: { title: 'Offence 1', players: [] }, defence1: { title: 'Defense', players: [] } },
            sun: { offence1: { title: 'Offence 1', players: [] } }
        },
        reserves: { sat: [], sun: [] },
        guildMembers: { sat: [], sun: [] }
    };
}

test('mergeDatabase always merges (fresh-vs-stale is decided by the route handler)', () => {
    // The fresh-replace path lives in server/route/data.js (isFresh). This
    // function's contract is the merge, so a snapshot never loses another
    // editor's players here.
    const current = dayState();
    current.groups.sat.offence1.players = [player('p1', 'Alice'), player('p2', 'Bob')];
    current.guildMembers.sat = [player('p1', 'Alice'), player('p2', 'Bob')];

    const incoming = dayState();
    incoming.groups.sat.offence1.players = [player('p1', 'Alice')];
    incoming.guildMembers.sat = [player('p1', 'Alice')];

    const merged = merge.mergeDatabase(current, incoming, new Set(), Date.now() + 10000);
    assert.deepStrictEqual(
        merged.groups.sat.offence1.players.map(p => p.id).sort(),
        ['p1', 'p2'],
        'mergeDatabase itself always merges; the route decides replacement'
    );
});

test('stale merge preserves players only the other editor created', () => {
    const current = dayState();
    current.groups.sat.offence1.players = [player('p1', 'Alice'), player('p2', 'Bob')];
    current.reserves.sat = [player('p3', 'Carol')];
    current.guildMembers.sat = [player('p1', 'Alice'), player('p2', 'Bob'), player('p3', 'Carol')];

    // Stale incoming predates Bob and Carol (they were added by another editor).
    const incoming = dayState();
    incoming.groups.sat.offence1.players = [player('p1', 'Alice')];
    incoming.guildMembers.sat = [player('p1', 'Alice')];

    const oldBase = Date.now() - 60000;
    const merged = merge.mergeDatabase(current, incoming, new Set(), oldBase);
    assert.deepStrictEqual(
        merged.groups.sat.offence1.players.map(p => p.id).sort(),
        ['p1', 'p2'],
        'stale merge must keep Bob (created by another editor)'
    );
    assert.deepStrictEqual(
        merged.reserves.sat.map(p => p.id),
        ['p3'],
        'stale merge must keep reserve Carol'
    );
    assert.deepStrictEqual(
        merged.guildMembers.sat.map(p => p.id).sort(),
        ['p1', 'p2', 'p3'],
        'master list keeps everyone'
    );
});

test('one player per group per day: incoming placement wins on conflict', () => {
    // Incoming (stale) still has Alice in Offence 1; the DB moved her to Defence.
    const current = dayState();
    current.groups.sat.defence1.players = [player('p1', 'Alice')];

    const incoming = dayState();
    incoming.groups.sat.offence1.players = [player('p1', 'Alice')];

    const merged = merge.mergeDatabase(current, incoming, new Set(), Date.now() - 60000);
    const all = [...merged.groups.sat.offence1.players, ...merged.groups.sat.defence1.players];
    assert.strictEqual(all.filter(p => p.id === 'p1').length, 1, 'Alice must appear in exactly one group');
    assert.strictEqual(merged.groups.sat.offence1.players.length, 1, 'Alice lives in Offence 1 (incoming wins)');
});

test('one-player-per-day holds regardless of group key order (regression)', () => {
    // Incoming moved Alice into Defence (Offence 1 empty in its snapshot) while
    // the DB still has her in Offence 1. The engine used to claim ids during
    // iteration, so Offence 1 (processed first) resurrected her from the stale
    // current copy before Defence claimed her - Alice ended up in both groups.
    const current = dayState();
    current.groups.sat.offence1.players = [player('p1', 'Alice')];

    const incoming = dayState();
    incoming.groups.sat.offence1.players = [];
    incoming.groups.sat.defence1.players = [player('p1', 'Alice')];

    const merged = merge.mergeDatabase(current, incoming, new Set(), Date.now() - 60000);
    const all = [...merged.groups.sat.offence1.players, ...merged.groups.sat.defence1.players];
    assert.strictEqual(all.filter(p => p.id === 'p1').length, 1,
        'Alice must appear in exactly one group, whichever group key sorts first');
    assert.strictEqual(merged.groups.sat.defence1.players.length, 1,
        'Alice stays in Defence (the incoming placement)');
    assert.strictEqual(merged.groups.sat.offence1.players.length, 0,
        'stale current copy in Offence 1 is dropped');
});

test('tombstoned player cannot be resurrected by a stale snapshot', () => {
    merge.recordDeletedPlayers(['p_del']);
    const deletedAt = merge.DELETED_PLAYERS.get('p_del');

    const current = dayState();
    const incoming = dayState();
    // Stale snapshot still contains the deleted player and predates the deletion.
    incoming.groups.sat.offence1.players = [player('p_del', 'Ghost')];
    incoming.guildMembers.sat = [player('p_del', 'Ghost')];

    const oldBase = deletedAt - 60000;
    const merged = merge.mergeDatabase(current, incoming, new Set(), oldBase);
    assert.strictEqual(merged.groups.sat.offence1.players.length, 0, 'tombstoned id must not resurrect in groups');
    assert.strictEqual(merged.guildMembers.sat.length, 0, 'tombstoned id must not resurrect in guild');
});

test('isTombstoned only blocks snapshots older than the deletion', () => {
    merge.recordDeletedPlayers(['p_x']);
    const deletedAt = merge.DELETED_PLAYERS.get('p_x');
    assert.strictEqual(merge.isTombstoned('p_x', deletedAt - 1000), true, 'stale base sees the tombstone');
    assert.strictEqual(merge.isTombstoned('p_x', deletedAt + 1000), false, 'post-deletion base is fine');
    assert.strictEqual(merge.isTombstoned('p_x', null), false, 'no base version -> no tombstone check');
    assert.strictEqual(merge.isTombstoned('p_other', deletedAt - 1000), false, 'unrelated id is not tombstoned');
});

test('removeDeletedFromDb strips tombstoned ids from every collection', () => {
    const db = dayState();
    db.groups.sat.offence1.players = [player('p1'), player('p2')];
    db.reserves.sat = [player('p2'), player('p3')];
    db.guildMembers.sat = [player('p1'), player('p2'), player('p3')];

    const out = merge.removeDeletedFromDb(db, new Set(['p2']));
    assert.deepStrictEqual(out.groups.sat.offence1.players.map(p => p.id), ['p1']);
    assert.deepStrictEqual(out.reserves.sat.map(p => p.id), ['p3']);
    assert.deepStrictEqual(out.guildMembers.sat.map(p => p.id), ['p1', 'p3']);
});

test('applyRemovals removes explicit move/list removals', () => {
    const db = dayState();
    db.groups.sat.offence1.players = [player('p1'), player('p2')];
    db.reserves.sat = [player('p3')];
    db.guildMembers.sat = [player('p1'), player('p2'), player('p3')];

    merge.applyRemovals(db, {
        groups: { sat: { offence1: ['p1'] } },
        reserves: { sat: ['p3'] },
        guildMembers: { sat: ['p1', 'p3'] }
    });

    assert.deepStrictEqual(db.groups.sat.offence1.players.map(p => p.id), ['p2']);
    assert.deepStrictEqual(db.reserves.sat, []);
    assert.deepStrictEqual(db.guildMembers.sat.map(p => p.id), ['p2']);
});

test('pruneTombstones drops entries older than the 7-day TTL', () => {
    const old = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    merge.DELETED_PLAYERS.set('p_old', old);
    merge.DELETED_PLAYERS.set('p_new', Date.now());
    merge.pruneTombstones();
    assert.strictEqual(merge.DELETED_PLAYERS.has('p_old'), false, 'expired tombstone pruned');
    assert.strictEqual(merge.DELETED_PLAYERS.has('p_new'), true, 'fresh tombstone kept');
});

test('pruneTombstones enforces the 500-entry cap (halves over-cap table)', () => {
    const now = Date.now();
    for (let i = 0; i < 501; i++) merge.DELETED_PLAYERS.set('p_cap_' + i, now + i);
    merge.pruneTombstones();
    assert.ok(merge.DELETED_PLAYERS.size <= merge.TOMBSTONE_MAX,
        `size ${merge.DELETED_PLAYERS.size} must be <= ${merge.TOMBSTONE_MAX}`);
});
