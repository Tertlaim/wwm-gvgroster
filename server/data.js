// server/data.js - Database read/write/init, tombstone persistence, migration
const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./util');
const { DELETED_PLAYERS, pruneTombstones } = require('./merge');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

// Phase 11.7: cached last-update timestamp so /api/data/updated can answer
// without re-reading + parsing the whole database file on every poll.
let _cachedLastUpdate = null;

// Read database
function readDatabase() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        return null;
    }
}

// Write database
function writeDatabase(data) {
    try {
        atomicWriteFileSync(DB_PATH, JSON.stringify(data, null, 2));
        _cachedLastUpdate = (data && data.lastUpdateTime) ? data.lastUpdateTime : new Date().toISOString();
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
}

// Phase 11.7: cheap last-update lookup (no file read once a write has
// happened in this process; falls back to a one-time file read at boot).
function getLastUpdateTime() {
    if (_cachedLastUpdate) return _cachedLastUpdate;
    const db = readDatabase();
    if (db && db.lastUpdateTime) {
        _cachedLastUpdate = db.lastUpdateTime;
        return _cachedLastUpdate;
    }
    return null;
}

// Phase 8.2: Hydrate the in-memory tombstone map from disk so deletion
// protection survives a server restart (a stale editor copy cannot
// resurrect players deleted before the restart).
function loadTombstonesFromDisk() {
    try {
        const db = readDatabase();
        if (db && db.deletedPlayers && typeof db.deletedPlayers === 'object') {
            Object.keys(db.deletedPlayers).forEach(id => {
                const t = Number(db.deletedPlayers[id]);
                if (id && !isNaN(t)) DELETED_PLAYERS.set(id, t);
            });
        }
    } catch (error) {
        console.error('Error loading tombstones:', error);
    }
    // Prune expired/over-cap entries now that the map is hydrated; persist
    // the pruned table if anything changed so disk matches memory.
    const before = DELETED_PLAYERS.size;
    pruneTombstones();
    if (DELETED_PLAYERS.size !== before) persistTombstones();
}

// Persist the current tombstone table into database.json (called on every
// data save so the map and the file stay in sync).
function persistTombstones() {
    const db = readDatabase();
    if (!db) return;
    db.deletedPlayers = Object.fromEntries(DELETED_PLAYERS);
    writeDatabase(db);
}

// Initialize database
function initDatabase() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
        const defaultData = {
            guildName: "Mask Sinners",
            groups: {
                sat: {
                    offence1: { title: 'Offense 1', players: [] },
                    offence2: { title: 'Offense 2', players: [] },
                    defence1: { title: 'Defense', players: [] },
                    jungle: { title: 'Jungle', players: [] }
                },
                sun: {
                    offence1: { title: 'Offense 1', players: [] },
                    offence2: { title: 'Offense 2', players: [] },
                    defence1: { title: 'Defense', players: [] },
                    jungle: { title: 'Jungle', players: [] }
                }
            },
            reserves: {
                sat: [],
                sun: []
            },
            guildMembers: {
                sat: [],
                sun: []
            },
            lastUpdateTime: new Date().toISOString(),
            announcement: 'Welcome to Mask Sinners Guild War!'
        };
        atomicWriteFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
        console.log('Created new database file');
    }
}

// ============================================
// GUILD MEMBERS MIGRATION
// ============================================

// Populate guildMembers from groups and reserves (deduplicated)
function migrateGuildMembers(data) {
    const days = ['sat', 'sun'];
    let migrated = 0;
    let totalPlayers = 0;
    
    days.forEach(day => {
        // Initialize guildMembers for this day if not exists
        if (!data.guildMembers) {
            data.guildMembers = {};
        }
        if (!data.guildMembers[day]) {
            data.guildMembers[day] = [];
        }
        
        const seen = new Set();
        const existingIds = new Set();
        
        // Track existing guildMembers to avoid duplicates
        if (data.guildMembers[day]) {
            data.guildMembers[day].forEach(p => {
                if (p.id) existingIds.add(p.id);
            });
        }
        
        // Collect players from groups - ALL groups for the day (not just the
        // default four keys: admins add custom groups, and those players must
        // reach the master list too).
        if (data.groups && data.groups[day]) {
            Object.keys(data.groups[day]).forEach(key => {
                if (data.groups[day][key] && data.groups[day][key].players) {
                    data.groups[day][key].players.forEach(p => {
                        if (p.id && !seen.has(p.id)) {
                            seen.add(p.id);
                            totalPlayers++;
                            if (!existingIds.has(p.id)) {
                                data.guildMembers[day].push({ ...p });
                                migrated++;
                                existingIds.add(p.id);
                            }
                        }
                    });
                }
            });
        }
        
        // Collect players from reserves
        if (data.reserves && data.reserves[day]) {
            data.reserves[day].forEach(p => {
                if (p.id && !seen.has(p.id)) {
                    seen.add(p.id);
                    totalPlayers++;
                    if (!existingIds.has(p.id)) {
                        data.guildMembers[day].push({ ...p });
                        migrated++;
                        existingIds.add(p.id);
                    }
                }
            });
        }
    });
    
    return { migrated, totalPlayers };
}

// Check if guildMembers is empty but players exist
function needsGuildMembersMigration(data) {
    if (!data.guildMembers) return true;
    
    // Check if guildMembers has any players
    const hasPlayers = Object.values(data.guildMembers).some(arr => arr && arr.length > 0);
    if (hasPlayers) return false;
    
    // Check if groups or reserves have players
    const hasData = Object.values(data.groups).some(day => 
        Object.values(day).some(group => group.players && group.players.length > 0)
    ) || Object.values(data.reserves).some(arr => arr && arr.length > 0);
    
    return hasData;
}

// Master-list integrity: every player that exists in groups or reserves must
// also appear in guildMembers for the same day. The day-split master can
// drift - e.g. a Saturday-registered player dragged into a Sunday group was
// never added to guildMembers.sun - so this backfills on every save and at
// boot. migrateGuildMembers() does the per-day merge; this is the semantic
// wrapper (returns players added).
function ensureMasterList(data) {
    return migrateGuildMembers(data).migrated;
}

// Boot-time backfill: repair any existing master-list gaps and persist.
function runMasterListBackfill() {
    const db = readDatabase();
    if (!db) return;
    const { migrated } = migrateGuildMembers(db);
    if (migrated > 0 && writeDatabase(db)) {
        console.log(`✅ Master list backfilled: ${migrated} player(s) added to guildMembers`);
    }
}

// Run migration on server start
function runGuildMembersMigration() {
    console.log('Checking if guildMembers migration is needed...');
    const data = readDatabase();
    if (!data) {
        console.log('No data found, skipping migration.');
        return;
    }
    
    if (needsGuildMembersMigration(data)) {
        console.log('guildMembers is empty but players exist. Running migration...');
        const result = migrateGuildMembers(data);
        
        // Save the migrated data
        if (writeDatabase(data)) {
            console.log(`✅ Migration complete: ${result.migrated} players added to guildMembers (total players: ${result.totalPlayers})`);
        } else {
            console.log('❌ Failed to save migrated data.');
        }
    } else {
        const count = data.guildMembers ? 
            Object.values(data.guildMembers).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0) : 0;
        console.log(`✅ guildMembers already populated (${count} players). No migration needed.`);
    }
}

module.exports = {
    DB_PATH,
    readDatabase,
    writeDatabase,
    getLastUpdateTime,
    ensureMasterList,
    runMasterListBackfill,
    initDatabase,
    loadTombstonesFromDisk,
    persistTombstones,
    migrateGuildMembers,
    needsGuildMembersMigration,
    runGuildMembersMigration
};
