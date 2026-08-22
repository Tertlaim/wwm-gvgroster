// server/storage/json/data.js - Database read/write/init, tombstone persistence
// Master-list migration logic lives in server/migration.js (shared with the
// Supabase adapter so the two cannot drift).
const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('../../util');
const {
    migrateGuildMembers,
    needsGuildMembersMigration,
    ensureMasterList,
    defaultDatabase
} = require('../../migration');
const { DELETED_PLAYERS, pruneTombstones, hydrateTombstonesFromDb } = require('../../merge');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'database.json');

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
        if (db) hydrateTombstonesFromDb(db.deletedPlayers);
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
    const dataDir = path.join(__dirname, '..', '..', '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
        atomicWriteFileSync(DB_PATH, JSON.stringify(defaultDatabase(), null, 2));
        console.log('Created new database file');
    }
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

    let dirty = false;

    if (needsGuildMembersMigration(data)) {
        console.log('guildMembers migration needed. Running...');
        const result = migrateGuildMembers(data);
        dirty = true;
        if (result.migrated > 0) {
            console.log(`✅ Migration complete: ${result.migrated} players added to guildMembers (total players: ${result.totalPlayers})`);
        }
    } else {
        console.log(`✅ guildMembers already populated (${data.guildMembers.length} players). No migration needed.`);
    }

    if (dirty) writeDatabase(data);
}

// Phase 15: Migrate legacy string announcement to {text, author, timestamp}
function runAnnouncementMigration() {
    const data = readDatabase();
    if (!data) return;
    if (typeof data.announcement === 'string') {
        data.announcement = { text: data.announcement, author: '', timestamp: '' };
        writeDatabase(data);
        console.log('✅ Migrated legacy announcement string to object format');
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
    runGuildMembersMigration,
    runAnnouncementMigration
};
