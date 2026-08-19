// server/merge.js - Concurrency merge engine + tombstone ledger (Phase 4.5/8.2)
// POST /api/data is a whole-dataset save. To stop one editor silently
// clobbering another's disjoint changes, the server merges stale snapshots
// with the stored data instead of replacing them:
//   - Fresh saves (base version == current) replace wholesale.
//   - Stale saves are merged by player id: ids the incoming client knows win,
//     ids only other editors created survive, and a player may occupy at most
//     one group per day (incoming placement wins).
//   - Full deletes are tombstoned so a stale copy cannot resurrect a player
//     another editor already deleted.
//   - Explicit removals (moves / list removals) from the payload are applied
//     after the merge.

const DELETED_PLAYERS = new Map(); // player id -> deletion timestamp (ms)
const TOMBSTONE_MAX = 500;
const TOMBSTONE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week

function pruneTombstones() {
    const now = Date.now();
    for (const [id, t] of DELETED_PLAYERS) {
        if (now - t > TOMBSTONE_TTL) DELETED_PLAYERS.delete(id);
    }
    if (DELETED_PLAYERS.size > TOMBSTONE_MAX) {
        const sorted = [...DELETED_PLAYERS.entries()].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
            DELETED_PLAYERS.delete(sorted[i][0]);
        }
    }
}

function recordDeletedPlayers(ids) {
    const now = Date.now();
    ids.forEach(id => { if (id) DELETED_PLAYERS.set(id, now); });
    pruneTombstones();
}

// True if the id was deleted after the client's base version, i.e. the
// incoming copy predates the deletion and must not resurrect the player.
function isTombstoned(id, baseTimeMs) {
    if (baseTimeMs === null || baseTimeMs === undefined) return false;
    const t = DELETED_PLAYERS.get(id);
    return t !== undefined && baseTimeMs < t;
}

function isRemoved(id, deletedIds, baseTimeMs) {
    return (deletedIds && deletedIds.has(id)) || isTombstoned(id, baseTimeMs);
}

// Merge a players array: ids known to the incoming client win; ids only in
// the stored data survive (they were created/moved by other editors).
function mergePlayersById(currentPlayers, incomingPlayers, deletedIds, baseTimeMs) {
    const result = [];
    const incomingById = new Map();
    (incomingPlayers || []).forEach(p => { if (p && p.id) incomingById.set(p.id, p); });
    
    incomingById.forEach(p => {
        if (isRemoved(p.id, deletedIds, baseTimeMs)) return;
        result.push(p);
    });
    
    (currentPlayers || []).forEach(p => {
        if (!p || !p.id) { result.push(p); return; } // legacy id-less entries
        if (incomingById.has(p.id)) return;
        if (isRemoved(p.id, deletedIds, baseTimeMs)) return;
        result.push(p);
    });
    
    return result;
}

// Merge one day's groups. Incoming group keys win; groups only in the stored
// data survive. Each player id may occupy at most one group per day, with the
// incoming client's placement winning on conflicts (prevents stale duplicates
// when a player was moved between groups by another editor).
//
// Two passes: first collect EVERY id the incoming snapshot places anywhere, so
// a player the incoming client moved into one group is never also pulled back
// in from a stale current copy in another group - the one-group-per-day
// invariant must not depend on group key iteration order.
function mergeGroupsDay(curGroups, incGroups, deletedIds, baseTimeMs) {
    const out = {};
    const incomingById = new Map();
    
    Object.keys(incGroups || {}).forEach(key => {
        const inc = incGroups[key] || {};
        (Array.isArray(inc.players) ? inc.players : []).forEach(p => {
            if (p && p.id) incomingById.set(p.id, p);
        });
    });
    
    Object.keys(incGroups || {}).forEach(key => {
        const inc = incGroups[key] || {};
        const cur = (curGroups && curGroups[key]) || {};
        const incPlayers = Array.isArray(inc.players) ? inc.players : [];
        const curPlayers = Array.isArray(cur.players) ? cur.players : [];
        const players = [];
        
        incPlayers.forEach(p => {
            if (!p || !p.id) { players.push(p); return; }
            if (isRemoved(p.id, deletedIds, baseTimeMs)) return;
            players.push(p);
        });
        
        curPlayers.forEach(p => {
            if (!p || !p.id) return; // only incoming keeps id-less entries (legacy)
            if (incomingById.has(p.id)) return;
            if (isRemoved(p.id, deletedIds, baseTimeMs)) return;
            players.push(p);
        });
        
        out[key] = {
            id: inc.id || cur.id || undefined,
            title: inc.title || cur.title || key,
            players: players
        };
    });
    
    Object.keys(curGroups || {}).forEach(key => {
        if (incGroups && incGroups[key]) return;
        const cur = curGroups[key] || {};
        out[key] = {
            id: cur.id,
            title: cur.title || key,
            players: (Array.isArray(cur.players) ? cur.players : []).filter(p => {
                if (!p || !p.id) return true;
                if (incomingById.has(p.id)) return false;
                if (isRemoved(p.id, deletedIds, baseTimeMs)) return false;
                return true;
            })
        };
    });
    
    return out;
}

// Merge the whole incoming snapshot with the stored database.
function mergeDatabase(current, incoming, deletedIds, baseTimeMs) {
    const days = ['sat', 'sun'];
    const out = { groups: {}, reserves: {}, guildMembers: [] };
    
    days.forEach(day => {
        // Groups first, so we know which ids are claimed by a group.
        out.groups[day] = mergeGroupsDay(
            (current.groups && current.groups[day]) || {},
            (incoming.groups && incoming.groups[day]) || {},
            deletedIds, baseTimeMs
        );
        
        // Reserves: no one-group constraint, plain per-id merge.
        out.reserves[day] = mergePlayersById(
            (current.reserves && current.reserves[day]) || [],
            (incoming.reserves && incoming.reserves[day]) || [],
            deletedIds, baseTimeMs
        );
    });

    // Phase 13: guildMembers is now a single flat array (no day keys).
    // Merge the two flat arrays by player id.
    out.guildMembers = mergePlayersById(
        Array.isArray(current.guildMembers) ? current.guildMembers : [],
        Array.isArray(incoming.guildMembers) ? incoming.guildMembers : [],
        deletedIds, baseTimeMs
    );
    
    return out;
}

// Remove tombstoned (fully deleted) ids from every collection.
// Needed for fresh replaces, where the payload itself may still contain them.
function removeDeletedFromDb(db, deletedIds) {
    if (!deletedIds || deletedIds.size === 0) return db;
    const days = ['sat', 'sun'];
    days.forEach(day => {
        if (db.groups && db.groups[day]) {
            Object.keys(db.groups[day]).forEach(key => {
                db.groups[day][key].players = (db.groups[day][key].players || [])
                    .filter(p => !(p && p.id && deletedIds.has(p.id)));
            });
        }
        if (db.reserves && db.reserves[day]) {
            db.reserves[day] = (db.reserves[day] || []).filter(p => !(p && p.id && deletedIds.has(p.id)));
        }
    });
    // Phase 13: guildMembers is now a flat array
    if (Array.isArray(db.guildMembers)) {
        db.guildMembers = db.guildMembers.filter(p => !(p && p.id && deletedIds.has(p.id)));
    }
    return db;
}

// Apply explicit removals (moves / list removals) from the saving client.
// Shape: { groups: { sat: { groupKey: [ids] } }, reserves: { sat: [ids] }, guildMembers: [ids] }
function applyRemovals(db, removed) {
    if (!removed || typeof removed !== 'object') return db;
    const days = ['sat', 'sun'];
    days.forEach(day => {
        const rmGroups = (removed.groups && removed.groups[day]) || {};
        Object.keys(rmGroups).forEach(key => {
            const ids = new Set(rmGroups[key] || []);
            if (db.groups && db.groups[day] && db.groups[day][key]) {
                db.groups[day][key].players = (db.groups[day][key].players || [])
                    .filter(p => !(p && p.id && ids.has(p.id)));
            }
        });
        const rmRes = new Set((removed.reserves && removed.reserves[day]) || []);
        if (rmRes.size && db.reserves && db.reserves[day]) {
            db.reserves[day] = db.reserves[day].filter(p => !(p && p.id && rmRes.has(p.id)));
        }
    });
    // Phase 13: guildMembers removals are a flat array of ids.
    // Handle both new format (array) and legacy format ({ sat: [...], sun: [...] }).
    let gmIds = [];
    if (Array.isArray(removed.guildMembers)) {
        gmIds = removed.guildMembers;
    } else if (removed.guildMembers && typeof removed.guildMembers === 'object') {
        // Legacy: collect ids from both day keys
        days.forEach(function(d) {
            const arr = removed.guildMembers[d];
            if (Array.isArray(arr)) gmIds = gmIds.concat(arr);
        });
    }
    if (gmIds.length && Array.isArray(db.guildMembers)) {
        const rmGm = new Set(gmIds);
        db.guildMembers = db.guildMembers.filter(p => !(p && p.id && rmGm.has(p.id)));
    }
    return db;
}

module.exports = {
    DELETED_PLAYERS,
    TOMBSTONE_MAX,
    TOMBSTONE_TTL,
    pruneTombstones,
    recordDeletedPlayers,
    isTombstoned,
    isRemoved,
    mergePlayersById,
    mergeGroupsDay,
    mergeDatabase,
    removeDeletedFromDb,
    applyRemovals
};
