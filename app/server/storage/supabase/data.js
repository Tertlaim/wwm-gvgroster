// storage/supabase/data.js - Supabase storage adapter for database
// Tombstone logic lives in merge.js (shared with JSON storage)
const { createClient } = require('@supabase/supabase-js');

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

// Read the full database state (single row in 'app_state' table)
async function readDatabase() {
    const client = getClient();
    const { data, error } = await client
        .from('app_state')
        .select('value')
        .eq('id', 'main')
        .single();

    if (error || !data) {
        console.error('Error reading database:', error);
        return null;
    }
    return data.value;
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

// Initialize: create table if needed, seed default data
async function initDatabase() {
    const client = getClient();

    // Check if table exists by trying to read
    const { error } = await client
        .from('app_state')
        .select('id')
        .eq('id', 'main')
        .single();

    if (error && error.code === 'PGRST116') {
        // No rows found - insert default
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
            reserves: { sat: [], sun: [] },
            guildMembers: [],
            lastUpdateTime: new Date().toISOString(),
            announcement: { text: 'Welcome to Mask Sinners Guild War!', author: '', timestamp: '' }
        };

        await client.from('app_state').insert({ id: 'main', value: defaultData });
        console.log('Created default app_state in Supabase');
    } else if (error) {
        console.error('Error checking Supabase:', error);
    } else {
        console.log('✅ Supabase app_state exists');
    }
}

// Migration helpers - same logic as JSON version, operates on data in-memory
// These are called after reading from Supabase, before writing back

function migrateGuildMembers(data) {
    if (data.guildMembers && typeof data.guildMembers === 'object' && !Array.isArray(data.guildMembers)) {
        const merged = new Map();
        Object.values(data.guildMembers).forEach(arr => {
            if (Array.isArray(arr)) {
                arr.forEach(p => { if (p && p.id) merged.set(p.id, { ...p }); });
            }
        });
        data.guildMembers = [...merged.values()];
    }

    if (!Array.isArray(data.guildMembers)) {
        data.guildMembers = [];
    }

    const existingIds = new Set(data.guildMembers.map(p => p && p.id).filter(Boolean));
    const days = ['sat', 'sun'];
    let migrated = 0;
    let totalPlayers = 0;

    days.forEach(day => {
        if (data.groups && data.groups[day]) {
            Object.keys(data.groups[day]).forEach(key => {
                if (data.groups[day][key] && data.groups[day][key].players) {
                    data.groups[day][key].players.forEach(p => {
                        if (p && p.id) {
                            totalPlayers++;
                            if (!existingIds.has(p.id)) {
                                data.guildMembers.push({ ...p });
                                existingIds.add(p.id);
                                migrated++;
                            }
                        }
                    });
                }
            });
        }
    });

    days.forEach(day => {
        if (data.reserves && data.reserves[day]) {
            data.reserves[day].forEach(p => {
                if (p && p.id) {
                    totalPlayers++;
                    if (!existingIds.has(p.id)) {
                        data.guildMembers.push({ ...p });
                        existingIds.add(p.id);
                        migrated++;
                    }
                }
            });
        }
    });

    return { migrated, totalPlayers };
}

function needsGuildMembersMigration(data) {
    if (!data.guildMembers) return true;
    if (typeof data.guildMembers === 'object' && !Array.isArray(data.guildMembers)) return true;
    if (data.guildMembers.length > 0) return false;
    const hasData = Object.values(data.groups).some(day =>
        Object.values(day).some(group => group.players && group.players.length > 0)
    ) || Object.values(data.reserves).some(arr => arr && arr.length > 0);
    return hasData;
}

function ensureMasterList(data) {
    return migrateGuildMembers(data).migrated;
}

async function runMasterListBackfill() {
    const db = await readDatabase();
    if (!db) return;
    const { migrated } = migrateGuildMembers(db);
    if (migrated > 0 && await writeDatabase(db)) {
        console.log(`✅ Master list backfilled: ${migrated} player(s) added to guildMembers`);
    }
}

async function runGuildMembersMigration() {
    console.log('Checking if guildMembers migration is needed...');
    const data = await readDatabase();
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

// Tombstones: stored in the app_state JSON blob alongside other data
const DELETED_PLAYERS = new Map();

function loadTombstonesFromDisk() {
    // Tombstones are part of the app_state JSON, loaded with readDatabase
    // No separate file needed
}

function persistTombstones() {
    // Tombstones are saved as part of writeDatabase (included in the JSON blob)
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
    runGuildMembersMigration
};
