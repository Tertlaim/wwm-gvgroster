// server/migration.js - Shared guild-members master-list migration (Phase 13)
// Single source of truth for both storage adapters (previously copy-pasted
// into storage/json/data.js and storage/supabase/data.js and at risk of
// drifting apart). Logic is unchanged from the Phase 13 implementation.

// Flatten legacy day-split guildMembers { sat:[], sun:[] } into a single
// flat array (the "true masterlist"), then backfill any player present in
// groups/reserves but missing from the master list.
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

    // Collect players from ALL groups across ALL days
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

    // Collect players from reserves across all days
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

// True when guildMembers is missing, still in the legacy day-split shape,
// or empty while groups/reserves still hold players.
function needsGuildMembersMigration(data) {
    if (!data.guildMembers) return true;

    // Legacy day-split shape always needs migration
    if (typeof data.guildMembers === 'object' && !Array.isArray(data.guildMembers)) return true;

    if (!Array.isArray(data.guildMembers)) return true;
    if (data.guildMembers.length > 0) return false;

    const hasData =
        (data.groups && typeof data.groups === 'object' &&
            Object.values(data.groups).some(day =>
                day && typeof day === 'object' &&
                Object.values(day).some(group => group && group.players && group.players.length > 0)
            )) ||
        (data.reserves && typeof data.reserves === 'object' &&
            Object.values(data.reserves).some(arr => arr && arr.length > 0));

    return hasData;
}

// Master-list integrity: every player in groups/reserves must appear in the
// flat guildMembers array. Backfills on every save and at boot.
function ensureMasterList(data) {
    return migrateGuildMembers(data).migrated;
}

// Shared default database seed used by initDatabase() in both adapters.
function defaultDatabase() {
    return {
        guildName: 'Guild Name',
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
        announcement: { text: 'Welcome to Guild War!', author: '', timestamp: '' }
    };
}

module.exports = {
    migrateGuildMembers,
    needsGuildMembersMigration,
    ensureMasterList,
    defaultDatabase
};
