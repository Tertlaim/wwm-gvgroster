// storage/supabase/data.js - Supabase storage adapter for database
// Master-list migration logic lives in merge.js-adjacent server/migration.js
// (shared with JSON storage). Tombstone logic lives in merge.js; tombstones
// are hydrated at boot from the app_state blob so deletion protection
// survives a restart exactly as it does in JSON mode.
const { createClient } = require('@supabase/supabase-js');
const {
    migrateGuildMembers,
    needsGuildMembersMigration,
    ensureMasterList,
    defaultDatabase
} = require('../../migration');
const { pruneTombstones, hydrateTombstonesFromDb } = require('../../merge');
const { withRetry } = require('../../util');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
let _cachedLastUpdate = null;

function getClient() {
    if (!supabase) {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
        }
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

// Raw read of the 'main' row (single source for both read paths)
async function readRaw() {
    const client = getClient();
    return client
        .from('app_state')
        .select('value')
        .eq('id', 'main')
        .single();
}

// Read the full database state (single row in 'app_state' table).
// Runtime path: single-shot, fails fast (clients re-sync on their own).
async function readDatabase() {
    const { data, error } = await readRaw();

    if (error || !data) {
        console.error('Error reading database:', error);
        return null;
    }
    return data.value;
}

// Boot-time read: retries transient gateway faults (e.g. a Cloudflare 502 in
// front of Supabase) so initialization steps like tombstone hydration cannot
// be silently skipped by a momentary blip. A missing row (PGRST116) is a
// definitive answer, not a fault, and resolves to null immediately.
async function readValueForBoot() {
    const { data, error } = await readRaw();
    if (!error && data) return data.value;
    if (error && error.code === 'PGRST116') return null;
    const err = new Error(error ? (error.message || 'Supabase read failed') : 'Empty response from Supabase');
    err.cause = error;
    throw err;
}

async function readDatabaseBoot() {
    try {
        return await withRetry(readValueForBoot, { retries: 3, delayMs: 600, label: 'Supabase boot read' });
    } catch (err) {
        console.error('Error reading database:', err.cause || err);
        return null;
    }
}

// Write the full database state (upsert single row)
async function writeDatabase(data) {
    const client = getClient();
    _cachedLastUpdate = (data && data.lastUpdateTime) ? data.lastUpdateTime : new Date().toISOString();

    const { error } = await client
        .from('app_state')
        .upsert({ id: 'main', value: data }, { onConflict: 'id' });

    if (error) {
        console.error('Error writing database:', error);
        return false;
    }
    return true;
}

// Cached last-update timestamp (cheap check for /api/data/updated)
async function getLastUpdateTime() {
    if (_cachedLastUpdate) return _cachedLastUpdate;

    const client = getClient();
    const { data, error } = await client
        .from('app_state')
        .select('value')
        .eq('id', 'main')
        .single();

    if (!error && data && data.value && data.value.lastUpdateTime) {
        _cachedLastUpdate = data.value.lastUpdateTime;
        return _cachedLastUpdate;
    }
    return null;
}

// Initialize: seed default data when the 'main' row does not exist yet.
// (The app_state table itself is created via SUPABASE_SETUP.md migrations.)
async function initDatabase() {
    let existing;
    try {
        existing = await withRetry(readValueForBoot, { retries: 3, delayMs: 600, label: 'Supabase init read' });
    } catch (err) {
        console.error('Error checking Supabase:', err.cause || err);
        return;
    }

    if (existing === null) {
        // No rows found - insert default
        const client = getClient();
        await client.from('app_state').insert({ id: 'main', value: defaultDatabase() });
        console.log('Created default app_state in Supabase');
    } else {
        console.log('✅ Supabase app_state exists');
    }
}

// Phase 8.2 (Supabase path): hydrate the shared tombstone ledger from the
// stored db.deletedPlayers table. Previously a no-op, which let stale editor
// snapshots resurrect players deleted before a server restart. Uses the
// retrying boot read so a transient gateway blip cannot skip hydration.
async function loadTombstonesFromDisk() {
    try {
        const db = await readDatabaseBoot();
        if (db) {
            hydrateTombstonesFromDb(db.deletedPlayers);
            pruneTombstones();
        }
    } catch (error) {
        console.error('Error loading tombstones:', error);
    }
}

function persistTombstones() {
    // Tombstones are saved as part of writeDatabase (included in the JSON blob)
}

async function runMasterListBackfill() {
    const db = await readDatabaseBoot();
    if (!db) return;
    const { migrated } = migrateGuildMembers(db);
    if (migrated > 0 && await writeDatabase(db)) {
        console.log(`✅ Master list backfilled: ${migrated} player(s) added to guildMembers`);
    }
}

async function runGuildMembersMigration() {
    console.log('Checking if guildMembers migration is needed...');
    const data = await readDatabaseBoot();
    if (!data) {
        console.log('No data found, skipping migration.');
        return;
    }
    if (needsGuildMembersMigration(data)) {
        console.log('guildMembers migration needed. Running...');
        const result = migrateGuildMembers(data);
        if (await writeDatabase(data)) {
            console.log(`✅ Migration complete: ${result.migrated} players added (total: ${result.totalPlayers})`);
        }
    } else {
        console.log(`✅ guildMembers already populated (${data.guildMembers.length} players). No migration needed.`);
    }
}

// Phase 15: Migrate legacy string announcement to {text, author, timestamp}
async function runAnnouncementMigration() {
    const data = await readDatabaseBoot();
    if (!data) return;
    if (typeof data.announcement === 'string') {
        data.announcement = { text: data.announcement, author: '', timestamp: '' };
        await writeDatabase(data);
        console.log('✅ Migrated legacy announcement string to object format');
    }
}

module.exports = {
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
