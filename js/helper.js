// ============================================================
//  HELPERS - Utility functions
// ============================================================

// ---- Cookie Functions ----
function setCookie(name, value, days = 7) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

// ---- HTML escaping (prevents stored XSS via player names / notes / history) ----
function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
//  DISPLAY - last-update timestamp formatting
// ============================================================
// Convert a server ISO timestamp (e.g. 2026-08-18T03:57:28.427Z) into the
// app's readable local format: "18 Aug 2026, 11:57 AM". Values that are
// already human-readable pass through unchanged.
function formatUpdateTime(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
            return d.toLocaleString('en-US', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        }
    }
    return value;
}

// ============================================================
//  CONCURRENCY (Phase 4.5) - pending removal/delete tracking
// ============================================================
// The server merges stale snapshots instead of blind-overwriting, so it needs
// to know which removals this client actually made since its last save.
// Types: 'group' -> { day, groupKey, ids }, 'reserve' -> { day, ids }, 'guild' -> { day, ids }

function ensurePendingRemovals() {
    if (!window._pendingRemovals) {
        window._pendingRemovals = { groups: {}, reserves: {}, guildMembers: {} };
    }
    return window._pendingRemovals;
}

function trackPlayerRemovals(type, day, ids, groupKey) {
    const store = ensurePendingRemovals();
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (list.length === 0) return;
    if (type === 'group') {
        if (!store.groups[day]) store.groups[day] = {};
        if (!store.groups[day][groupKey]) store.groups[day][groupKey] = [];
        list.forEach(id => { if (!store.groups[day][groupKey].includes(id)) store.groups[day][groupKey].push(id); });
    } else if (type === 'reserve') {
        if (!store.reserves[day]) store.reserves[day] = [];
        list.forEach(id => { if (!store.reserves[day].includes(id)) store.reserves[day].push(id); });
    } else if (type === 'guild') {
        if (!store.guildMembers[day]) store.guildMembers[day] = [];
        list.forEach(id => { if (!store.guildMembers[day].includes(id)) store.guildMembers[day].push(id); });
    }
}

// Full deletes (removed from ALL panels) - the server tombstones these ids so
// a stale copy from another editor cannot resurrect them.
function trackDeletedPlayerIds(ids) {
    if (!window._pendingDeletedIds) window._pendingDeletedIds = new Set();
    (Array.isArray(ids) ? ids : [ids]).forEach(id => { if (id) window._pendingDeletedIds.add(id); });
}

function clearPendingSyncState() {
    if (window._pendingDeletedIds) window._pendingDeletedIds.clear();
    window._pendingRemovals = { groups: {}, reserves: {}, guildMembers: {} };
}

// ---- ID Generation ----
function generatePlayerId() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ---- Player/Class Functions ----
function getClassIcon(cls) {
    switch(cls) {
        case 'DPS': return '⚔️';
        case 'Tank': return '🛡️';
        case 'Heal': return '🌿';
        default: return '';
    }
}

function getRoleIcon(role) {
    switch(role) {
        case 'Commander': return '👑';
        case 'Vice Commander': return '⚔️';
        case 'Healer': return '💚';
        default: return '';
    }
}

function getRoleClass(role) {
    switch(role) {
        case 'Commander': return 'commander';
        case 'Vice Commander': return 'vice-commander';
        case 'Healer': return 'healer';
        default: return 'member';
    }
}

function getRoleDisplay(role) {
    switch(role) {
        case 'Commander': return 'Commander';
        case 'Vice Commander': return 'Vice Commander';
        case 'Healer': return 'Healer';
        default: return 'Member';
    }
}

function getRoleDisplayShort(role) {
    switch(role) {
        case 'Commander': return 'Commander';
        case 'Vice Commander': return 'Vice Com';
        case 'Healer': return 'Healer';
        default: return 'Member';
    }
}

function sortPlayers(players) {
    const roleOrder = {
        'Commander': 0,
        'Vice Commander': 1,
        'Healer': 2,
        'Member': 3
    };
    
    return [...players].sort((a, b) => {
        const roleA = a.role || 'Member';
        const roleB = b.role || 'Member';
        if (roleOrder[roleA] !== roleOrder[roleB]) {
            return roleOrder[roleA] - roleOrder[roleB];
        }
        return a.name.localeCompare(b.name);
    });
}

function getAllRegisteredPlayers() {
    const allPlayers = [];
    const seen = new Set();
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    days.forEach(day => {
        if (window.groups && window.groups[day]) {
            groupKeys.forEach(key => {
                if (window.groups[day][key] && window.groups[day][key].players) {
                    window.groups[day][key].players.forEach(p => {
                        const key = p.name + '_' + p.class + '_' + (p.role || 'Member');
                        if (!seen.has(key)) {
                            seen.add(key);
                            allPlayers.push({ ...p });
                        }
                    });
                }
            });
        }
    });
    
    days.forEach(day => {
        if (window.reserves && window.reserves[day]) {
            window.reserves[day].forEach(p => {
                const key = p.name + '_' + p.class + '_' + (p.role || 'Member');
                if (!seen.has(key)) {
                    seen.add(key);
                    allPlayers.push({ ...p });
                }
            });
        }
    });
    
    days.forEach(day => {
        if (window.guildMembers && window.guildMembers[day]) {
            window.guildMembers[day].forEach(p => {
                const key = p.name + '_' + p.class + '_' + (p.role || 'Member');
                if (!seen.has(key)) {
                    seen.add(key);
                    allPlayers.push({ ...p });
                }
            });
        }
    });
    
    return sortPlayers(allPlayers);
}

// ---- Duplicate Check Functions (Day-specific) ----
function isPlayerInReserves(day, name, cls) {
    const reserves = window.reserves && window.reserves[day] ? window.reserves[day] : [];
    return reserves.some(p => p.name === name && p.class === cls);
}

function isPlayerInGroup(day, groupKey, name, cls) {
    const groups = window.groups && window.groups[day] ? window.groups[day] : {};
    if (groups[groupKey] && groups[groupKey].players) {
        return groups[groupKey].players.some(p => p.name === name && p.class === cls);
    }
    return false;
}

function isPlayerInAnyGroup(day, name, cls) {
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    const groups = window.groups && window.groups[day] ? window.groups[day] : {};
    for (const key of groupKeys) {
        if (groups[key] && groups[key].players) {
            if (groups[key].players.some(p => p.name === name && p.class === cls)) {
                return true;
            }
        }
    }
    return false;
}

function isPlayerInGuildMembers(day, name, cls) {
    const guildMembers = window.guildMembers && window.guildMembers[day] ? window.guildMembers[day] : [];
    return guildMembers.some(p => p.name === name && p.class === cls);
}

function getAllPlayersInGroups(day) {
    const allPlayers = [];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    const groups = window.groups && window.groups[day] ? window.groups[day] : {};
    groupKeys.forEach(key => {
        if (groups[key] && groups[key].players) {
            groups[key].players.forEach(p => {
                allPlayers.push({ ...p, group: key });
            });
        }
    });
    return allPlayers;
}

// ---- Cross-check functions (day-specific) ----
function isPlayerInAnyGroupOrReserves(day, name, cls) {
    return isPlayerInAnyGroup(day, name, cls) || isPlayerInReserves(day, name, cls);
}

function isPlayerInGroupList(day, name, cls) {
    return isPlayerInAnyGroup(day, name, cls);
}

function isPlayerInReserveList(day, name, cls) {
    return isPlayerInReserves(day, name, cls);
}

// ---- Guild Member Limit ----
const GUILD_MEMBER_MAX = 100;

function canAddToGuildMembers(day) {
    const gm = window.guildMembers && window.guildMembers[day] ? window.guildMembers[day] : [];
    return gm.length < GUILD_MEMBER_MAX;
}

function getGuildMemberCount(day) {
    const gm = window.guildMembers && window.guildMembers[day] ? window.guildMembers[day] : [];
    return gm.length;
}

function getGuildMemberLimit() {
    return GUILD_MEMBER_MAX;
}

// ---- Auth wrappers (for backward compatibility) ----
function isAdmin() { 
    return AuthModule ? AuthModule.isAdmin() : false; 
}

function isMod() { 
    return AuthModule ? AuthModule.isMod() : false; 
}

// ============================================================
//  CRITICAL FIX: Get functions with proper initialization
// ============================================================

function getGroups() { 
    const day = window.currentDay || 'sat';
    
    // Initialize if not exists
    if (!window.groups) {
        window.groups = {};
    }
    if (!window.groups[day]) {
        window.groups[day] = {};
    }
    
    return window.groups[day]; 
}

function getReserves() {
    const day = window.currentDay || 'sat';
    
    // Initialize if not exists
    if (!window.reserves) {
        window.reserves = {};
    }
    if (!window.reserves[day]) {
        window.reserves[day] = [];
    }
    
    console.log('getReserves() called - day:', day, 'length:', window.reserves[day].length);
    return window.reserves[day];
}

function getGuildMembers() {
    const day = window.currentDay || 'sat';
    
    // Initialize if not exists
    if (!window.guildMembers) {
        window.guildMembers = {};
    }
    if (!window.guildMembers[day]) {
        window.guildMembers[day] = [];
    }
    
    return window.guildMembers[day];
}

function getAllRegisteredPlayers() {
    // This function now just returns the master list
    // Use getGuildMembers() as the primary source
    return getGuildMembers();
}

function totalPlayers() { 
    const g = getGroups(); 
    let sum = 0; 
    for (const key in g) sum += g[key].players.length; 
    return sum; 
}

function getAllPlayers() { 
    const g = getGroups(); 
    let all = []; 
    for (const key in g) all = all.concat(g[key].players); 
    return all.concat(getReserves()); 
}

function getAllGuildMembers() { 
    return getGuildMembers(); 
}

// Get total players in groups for a specific day
function getTotalGroupPlayers(day) {
    let total = 0;
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    const groups = window.groups && window.groups[day] ? window.groups[day] : {};
    for (let i = 0; i < groupKeys.length; i++) {
        const key = groupKeys[i];
        if (groups[key] && groups[key].players) {
            total += groups[key].players.length;
        }
    }
    return total;
}

// Check if a player exists in any group for a specific day
function isPlayerInAnyGroup(day, name, cls) {
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    const groups = window.groups && window.groups[day] ? window.groups[day] : {};
    for (let i = 0; i < groupKeys.length; i++) {
        const key = groupKeys[i];
        if (groups[key] && groups[key].players) {
            for (let j = 0; j < groups[key].players.length; j++) {
                if (groups[key].players[j].name === name && groups[key].players[j].class === cls) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Check if a player exists in guild members for a specific day
function isPlayerInGuildMembers(day, name, cls) {
    const guildMembers = window.guildMembers && window.guildMembers[day] ? window.guildMembers[day] : [];
    for (let i = 0; i < guildMembers.length; i++) {
        if (guildMembers[i].name === name && guildMembers[i].class === cls) {
            return true;
        }
    }
    return false;
}