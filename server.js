// server.js - Enhanced Express server with auth config
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// File paths
const DB_PATH = path.join(__dirname, 'data', 'database.json');
const AUTH_PATH = path.join(__dirname, 'config', 'auth.json');
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');

// ============================================
// ATOMIC FILE WRITES (Phase 8.1)
// ============================================
// Write via a temp file + rename so a crash mid-write can never leave a
// truncated/partial JSON file on disk (the rename is atomic on POSIX and
// replace-on-rename on Windows).
function atomicWriteFileSync(filePath, data) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
}

// ============================================
// SESSION MANAGEMENT (Phase 4.4)
// ============================================

// In-memory session store: token -> { username, role, expiresAt }
const SESSIONS = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function createSession(username, role) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL;
    SESSIONS.set(token, { username, role, expiresAt });
    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = SESSIONS.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
        SESSIONS.delete(token);
        return null;
    }
    return session;
}

function destroySession(token) {
    if (token) SESSIONS.delete(token);
}

// Auth middleware: requires valid session token
function requireAuth(req, res, next) {
    const token = req.headers['authorization'] || req.headers['x-auth-token'];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
    }
    
    // Support "Bearer <token>" format
    const authToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const session = getSession(authToken);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Session expired or invalid. Please login again.' });
    }
    
    req.session = session;
    req.sessionToken = authToken;
    next();
}

// Middleware: requires admin or superadmin role
function requireAdmin(req, res, next) {
    if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'superadmin')) {
        return res.status(403).json({ success: false, error: 'Admin access required.' });
    }
    next();
}

// Middleware: requires superadmin role (managing admins is SuperAdmin-only)
function requireSuperAdmin(req, res, next) {
    if (!req.session || req.session.role !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'SuperAdmin access required.' });
    }
    next();
}

// All auth users (owner + staff) as one role-aware list, so roles are data-driven
// (stored in config/auth.json) instead of hardcoded per username.
function getAllAuthUsers(auth) {
    const users = [];
    if (auth && auth.admin) users.push(auth.admin);
    if (auth && Array.isArray(auth.moderators)) {
        for (const mod of auth.moderators) users.push(mod);
    }
    return users;
}

// Effective role for a stored user record (defaults to 'mod' for legacy entries)
function getUserRole(user) {
    return (user && user.role) || 'mod';
}

// ============================================
// PASSWORD HASHING (Phase 9.1)
// ============================================
const BCRYPT_ROUNDS = 10;

// A bcrypt hash looks like $2a$/$2b$/$2y$ + cost + salt.
function isHashed(pw) {
    return typeof pw === 'string' && /^\$2[aby]\$\d{2}\$/.test(pw);
}

function hashPassword(plain) {
    return bcrypt.hashSync(String(plain == null ? '' : plain), BCRYPT_ROUNDS);
}

// Verify a login attempt against the stored value (hash or legacy plaintext).
function verifyPassword(attempt, stored) {
    if (typeof stored !== 'string') return false;
    if (isHashed(stored)) {
        try { return bcrypt.compareSync(String(attempt == null ? '' : attempt), stored); }
        catch (e) { return false; }
    }
    // Legacy plaintext (pre-migration); the boot migration hashes these, but
    // this keeps hand-edited files working until the next restart.
    return stored === attempt;
}

// Migrate any plaintext passwords in auth.json to bcrypt hashes (boot-time).
function migratePlaintextPasswords() {
    const auth = readAuthConfig();
    if (!auth) return;
    let changed = false;
    getAllAuthUsers(auth).forEach(u => {
        if (u && typeof u.password === 'string' && !isHashed(u.password)) {
            u.password = hashPassword(u.password);
            changed = true;
        }
    });
    if (changed && writeAuthConfig(auth)) {
        console.log('🔐 Migrated plaintext passwords to bcrypt hashes');
    }
}

// ============================================
// RATE LIMITING (Phase 9.2)
// ============================================
// Dependency-free fixed-window limiter keyed by client IP.
const RATE_LIMITS = new Map(); // key -> { count, resetAt }
const LOGIN_MAX = 20;          // attempts per window per IP
const REGISTER_MAX = 15;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key, max, windowMs) {
    const now = Date.now();
    let entry = RATE_LIMITS.get(key);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        RATE_LIMITS.set(key, entry);
    }
    entry.count++;
    return {
        allowed: entry.count <= max,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
}

function clientIp(req) {
    return req.ip || req.connection.remoteAddress || 'unknown';
}

// Sweep expired entries so the map cannot grow unbounded.
setInterval(() => {
    const now = Date.now();
    RATE_LIMITS.forEach((v, k) => { if (v.resetAt <= now) RATE_LIMITS.delete(k); });
}, 10 * 60 * 1000).unref();

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

// Read auth config
function readAuthConfig() {
    try {
        const data = fs.readFileSync(AUTH_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading auth config:', error);
        return null;
    }
}

// Write auth config
function writeAuthConfig(data) {
    try {
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing auth config:', error);
        return false;
    }
}

// Initialize auth config
function initAuthConfig() {
    const configDir = path.join(__dirname, 'config');
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(AUTH_PATH)) {
        const defaultAuth = {
            admin: {
                id: "admin_001",
                username: "Tertlaim",
                password: hashPassword('Sin1234'),
                role: "superadmin",
                createdAt: new Date().toISOString()
            },
            moderators: [],
            settings: {
                allowModeratorRegistration: true,
                maxGroups: 6,
                defaultModPassword: "Sin1234",
                discordWebhook: "",
                historyLimit: 100
            }
        };
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(defaultAuth, null, 2));
        console.log('Created new auth config file');
    }
}

// ============================================
// DATABASE FUNCTIONS
// ============================================

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
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
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
    const dataDir = path.join(__dirname, 'data');
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
// HISTORY FUNCTIONS
// ============================================

// Read history
function readHistory() {
    try {
        const data = fs.readFileSync(HISTORY_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading history:', error);
        return { entries: [], maxEntries: 100, lastCleared: null };
    }
}

// Write history
function writeHistory(data) {
    try {
        atomicWriteFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing history:', error);
        return false;
    }
}

// Initialize history
function initHistory() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(HISTORY_PATH)) {
        const defaultHistory = {
            entries: [],
            maxEntries: 100,
            lastCleared: null
        };
        atomicWriteFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
        console.log('Created new history file');
    } else {
        // Verify the file has valid JSON
        try {
            const content = fs.readFileSync(HISTORY_PATH, 'utf8');
            JSON.parse(content);
            console.log('✅ history.json is valid');
        } catch (e) {
            console.log('⚠️ history.json is invalid, recreating...');
            const defaultHistory = {
                entries: [],
                maxEntries: 100,
                lastCleared: null
            };
            atomicWriteFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
            console.log('✅ Recreated history.json');
        }
    }
}

// ============================================
// AUTHENTICATION API
// ============================================

// POST /api/login - Authenticate user, returns session token
app.post('/api/login', (req, res) => {
    const rl = checkRateLimit('login:' + clientIp(req), LOGIN_MAX, RATE_WINDOW_MS);
    if (!rl.allowed) {
        return res.status(429).json({ success: false, error: 'Too many login attempts. Try again later.', retryAfter: rl.retryAfterSec });
    }

    const { username, password } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    // Roles come from the stored user record (superadmin/admin/mod), never hardcoded.
    const user = getAllAuthUsers(auth).find(u => u && u.username === username && verifyPassword(password, u.password));
    if (user) {
        const role = getUserRole(user);
        const token = createSession(user.username, role);
        return res.json({ 
            success: true, 
            name: user.username, 
            role: role,
            token: token
        });
    }

    res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
    });
});

// POST /api/logout - Invalidate session
app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'] || req.headers['x-auth-token'];
    if (token) {
        const authToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        destroySession(authToken);
    }
    res.json({ success: true, message: 'Logged out' });
});

// GET /api/session - Check current session validity
app.get('/api/session', requireAuth, (req, res) => {
    res.json({ 
        success: true, 
        name: req.session.username, 
        role: req.session.role,
        expiresAt: req.session.expiresAt
    });
});

// GET /api/moderators/list - Get all auth users + roles (admin+)
app.get('/api/moderators/list', requireAuth, requireAdmin, (req, res) => {
    const auth = readAuthConfig();
    if (!auth) {
        return res.status(500).json({ error: 'Auth config error' });
    }
    
    res.json({
        users: getAllAuthUsers(auth).map(u => ({ username: u.username, role: getUserRole(u) }))
    });
});

// POST /api/moderators/add - Add staff (mod by default; admin requires SuperAdmin)
app.post('/api/moderators/add', requireAuth, requireAdmin, (req, res) => {
    const { username, password, role } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    // Only 'mod' and 'admin' can be created here; superadmin is never assignable.
    const targetRole = role === 'admin' ? 'admin' : 'mod';
    if (targetRole === 'admin' && req.session.role !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only SuperAdmin can add admins.' });
    }

    if (getAllAuthUsers(auth).some(u => u.username === username)) {
        return res.status(400).json({ success: false, error: 'User is already staff (mod or admin)' });
    }

    const newPassword = password || auth.settings.defaultModPassword || 'Sin1234';
    auth.moderators.push({
        id: 'mod_' + Date.now(),
        username: username,
        password: hashPassword(newPassword),
        role: targetRole,
        createdAt: new Date().toISOString()
    });

    if (writeAuthConfig(auth)) {
        res.json({ 
            success: true, 
            message: `${targetRole === 'admin' ? 'Admin' : 'Moderator'} ${username} added successfully`,
            role: targetRole,
            password: newPassword
        });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// POST /api/moderators/remove - Remove staff (admins can remove mods; SuperAdmin can remove admins)
app.post('/api/moderators/remove', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    const index = auth.moderators.findIndex(mod => mod.username === username);
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Staff member not found' });
    }

    // Demoting an admin is SuperAdmin-only; the owner (auth.admin) is never listed here.
    if (getUserRole(auth.moderators[index]) === 'admin' && req.session.role !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only SuperAdmin can demote admins.' });
    }

    auth.moderators.splice(index, 1);
    
    if (writeAuthConfig(auth)) {
        res.json({ success: true, message: `${username} removed from staff` });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// POST /api/moderators/reset-password - Reset moderator password (admin only)
app.post('/api/moderators/reset-password', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    const mod = auth.moderators.find(m => m.username === username);
    if (!mod) {
        return res.status(404).json({ success: false, error: 'Moderator not found' });
    }

    const newPassword = auth.settings.defaultModPassword || 'Sin1234';
    mod.password = hashPassword(newPassword);
    
    if (writeAuthConfig(auth)) {
        res.json({ 
            success: true, 
            message: `Password reset for ${username}`,
            newPassword: newPassword
        });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// POST /api/moderators/change-password - Change own password (moderator)
app.post('/api/moderators/change-password', requireAuth, (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    const mod = auth.moderators.find(m => m.username === username);
    if (!mod) {
        return res.status(404).json({ success: false, error: 'Moderator not found' });
    }

    if (!verifyPassword(oldPassword, mod.password)) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    mod.password = hashPassword(newPassword);
    
    if (writeAuthConfig(auth)) {
        res.json({ success: true, message: 'Password updated successfully' });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// GET /api/auth/settings - Get auth settings (admin only)
app.get('/api/auth/settings', requireAuth, requireAdmin, (req, res) => {
    const auth = readAuthConfig();
    if (!auth) {
        return res.status(500).json({ error: 'Auth config error' });
    }
    
    res.json({
        allowModeratorRegistration: auth.settings.allowModeratorRegistration,
        maxGroups: auth.settings.maxGroups,
        moderators: auth.moderators.map(mod => ({ username: mod.username, role: mod.role }))
    });
});

// POST /api/auth/settings - Update auth settings (admin only)
app.post('/api/auth/settings', requireAuth, requireAdmin, (req, res) => {
    const { allowModeratorRegistration, maxGroups, defaultModPassword } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    if (allowModeratorRegistration !== undefined) {
        auth.settings.allowModeratorRegistration = allowModeratorRegistration;
    }
    if (maxGroups !== undefined) {
        auth.settings.maxGroups = maxGroups;
    }
    if (defaultModPassword !== undefined) {
        auth.settings.defaultModPassword = defaultModPassword;
    }

    if (writeAuthConfig(auth)) {
        res.json({ success: true, message: 'Settings updated' });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// ============================================
// GUILD DATA API
// ============================================

// GET /api/data - Load all data
app.get('/api/data', (req, res) => {
    const data = readDatabase();
    if (data) {
        // Tombstones are a server-side deletion ledger; clients don't need
        // them (they send their own deletedIds per save).
        const { deletedPlayers, ...publicData } = data;
        res.json({
            ...publicData,
            lastUpdateTime: data.lastUpdateTime || new Date().toISOString()
        });
    } else {
        res.status(500).json({ error: 'Failed to load data' });
    }
});

// ============================================
// CONCURRENCY (Phase 4.5): merge, tombstones, SSE
// ============================================
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
function mergeGroupsDay(curGroups, incGroups, deletedIds, baseTimeMs) {
    const out = {};
    const claimed = new Set();
    
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
            claimed.add(p.id);
        });
        
        curPlayers.forEach(p => {
            if (!p || !p.id) return; // only incoming keeps id-less entries (legacy)
            if (claimed.has(p.id)) return;
            if (isRemoved(p.id, deletedIds, baseTimeMs)) return;
            players.push(p);
            claimed.add(p.id);
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
                if (claimed.has(p.id)) return false;
                if (isRemoved(p.id, deletedIds, baseTimeMs)) return false;
                claimed.add(p.id);
                return true;
            })
        };
    });
    
    return out;
}

// Merge the whole incoming snapshot with the stored database.
function mergeDatabase(current, incoming, deletedIds, baseTimeMs) {
    const days = ['sat', 'sun'];
    const out = { groups: {}, reserves: {}, guildMembers: {} };
    
    days.forEach(day => {
        // Groups first, so we know which ids are claimed by a group.
        out.groups[day] = mergeGroupsDay(
            (current.groups && current.groups[day]) || {},
            (incoming.groups && incoming.groups[day]) || {},
            deletedIds, baseTimeMs
        );
        
        // Master list: plain per-id merge. Players legitimately coexist with
        // groups/reserves (master list of ALL players), so no cross-dedup here.
        out.guildMembers[day] = mergePlayersById(
            (current.guildMembers && current.guildMembers[day]) || [],
            (incoming.guildMembers && incoming.guildMembers[day]) || [],
            deletedIds, baseTimeMs
        );
        
        // Reserves: no one-group constraint, plain per-id merge.
        out.reserves[day] = mergePlayersById(
            (current.reserves && current.reserves[day]) || [],
            (incoming.reserves && incoming.reserves[day]) || [],
            deletedIds, baseTimeMs
        );
    });
    
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
        if (db.guildMembers && db.guildMembers[day]) {
            db.guildMembers[day] = (db.guildMembers[day] || []).filter(p => !(p && p.id && deletedIds.has(p.id)));
        }
    });
    return db;
}

// Apply explicit removals (moves / list removals) from the saving client.
// Shape: { groups: { sat: { groupKey: [ids] } }, reserves: { sat: [ids] }, guildMembers: { sat: [ids] } }
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
        const rmGm = new Set((removed.guildMembers && removed.guildMembers[day]) || []);
        if (rmGm.size && db.guildMembers && db.guildMembers[day]) {
            db.guildMembers[day] = db.guildMembers[day].filter(p => !(p && p.id && rmGm.has(p.id)));
        }
    });
    return db;
}

// ============================================
// REALTIME SYNC (Phase 4.5): SSE notifications
// ============================================

const SSE_CLIENTS = new Set();

function broadcastUpdate(version) {
    if (SSE_CLIENTS.size === 0) return;
    const payload = 'event: update\ndata: ' + JSON.stringify({ lastUpdate: version, ts: Date.now() }) + '\n\n';
    SSE_CLIENTS.forEach(res => {
        try { res.write(payload); } catch (e) { SSE_CLIENTS.delete(res); }
    });
}

// GET /api/events - Server-Sent Events stream; clients re-sync on 'update'
app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write('retry: 5000\n\n');
    SSE_CLIENTS.add(res);
    
    const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); SSE_CLIENTS.delete(res); }
    }, 25000);
    
    req.on('close', () => {
        clearInterval(heartbeat);
        SSE_CLIENTS.delete(res);
    });
});

// POST /api/data - Save all data
// AUTH REQUIRED (mod+) - Public writes go through the dedicated /api/register endpoint.
// Previously this endpoint was unauthenticated and let any visitor overwrite the
// entire database (wipe or tamper with all roster data).
// Since Phase 4.5 the server merges stale snapshots instead of blind-overwriting.
app.post('/api/data', requireAuth, (req, res) => {
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({ success: false, error: 'Invalid data payload' });
    }
    // Require at least one real data key so an empty payload cannot wipe the roster
    if (!('groups' in incoming) && !('reserves' in incoming) && !('guildMembers' in incoming)) {
        return res.status(400).json({ success: false, error: 'Invalid data payload' });
    }
    
    const current = readDatabase();
    if (!current) {
        return res.status(500).json({ success: false, error: 'Failed to read database' });
    }
    
    // Version the client's snapshot is based on (its last sync).
    const baseVersion = typeof incoming.baseVersion === 'string' ? incoming.baseVersion : null;
    let baseTimeMs = baseVersion ? Date.parse(baseVersion) : null;
    if (baseTimeMs === null || isNaN(baseTimeMs)) baseTimeMs = null;
    
    const currentVersion = current.lastUpdateTime || null;
    const isFresh = baseTimeMs !== null && currentVersion !== null && Date.parse(currentVersion) <= baseTimeMs;
    
    const deletedIds = new Set(
        Array.isArray(incoming.deletedIds)
            ? incoming.deletedIds.filter(id => typeof id === 'string' && id)
            : []
    );
    if (deletedIds.size > 0) recordDeletedPlayers([...deletedIds]);
    
    let merged;
    if (isFresh) {
        // No one else saved since this client's base - the snapshot is authoritative.
        merged = {
            groups: incoming.groups || current.groups || {},
            reserves: incoming.reserves || current.reserves || {},
            guildMembers: incoming.guildMembers || current.guildMembers || {}
        };
    } else {
        merged = mergeDatabase(current, incoming, deletedIds, baseTimeMs);
    }
    
    merged.guildName = typeof incoming.guildName === 'string' ? incoming.guildName : (current.guildName || 'Mask Sinners');
    merged.announcement = typeof incoming.announcement === 'string' ? incoming.announcement : (current.announcement || '');
    
    // Apply tombstoned deletes (matters for fresh replaces) and explicit
    // removals (moves / list removals) on top of the merge.
    removeDeletedFromDb(merged, deletedIds);
    applyRemovals(merged, incoming.removed);
    
    // Phase 8.2: persist the tombstone ledger with every save so deletion
    // protection survives a server restart.
    merged.deletedPlayers = Object.fromEntries(DELETED_PLAYERS);
    
    merged.lastUpdateTime = new Date().toISOString();
    
    if (writeDatabase(merged)) {
        broadcastUpdate(merged.lastUpdateTime);
        res.json({ 
            success: true, 
            lastUpdate: merged.lastUpdateTime,
            message: 'Data saved successfully',
            data: merged
        });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// POST /api/register - Public self-registration (no auth)
// Adds the player to guildMembers + reserves for the selected days only.
// This is the ONLY public write path; it cannot modify groups, titles,
// announcements, or any other data.
app.post('/api/register', (req, res) => {
    const rl = checkRateLimit('register:' + clientIp(req), REGISTER_MAX, RATE_WINDOW_MS);
    if (!rl.allowed) {
        return res.status(429).json({ success: false, error: 'Too many registration attempts. Try again later.', retryAfter: rl.retryAfterSec });
    }

    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const cls = body.class;
    const days = Array.isArray(body.days) ? body.days : [];
    const validDays = ['sat', 'sun'];
    const validClasses = ['Tank', 'DPS', 'Heal'];
    
    if (!name) {
        return res.status(400).json({ success: false, error: 'Please enter a name.' });
    }
    if (name.length > 20) {
        return res.status(400).json({ success: false, error: 'Name must be 20 characters or less.' });
    }
    if (/[<>]/.test(name)) {
        return res.status(400).json({ success: false, error: 'Name contains invalid characters.' });
    }
    if (!validClasses.includes(cls)) {
        return res.status(400).json({ success: false, error: 'Invalid class.' });
    }
    
    const requested = days.filter(d => validDays.includes(d));
    if (requested.length === 0) {
        return res.status(400).json({ success: false, error: 'Please select at least one day.' });
    }
    
    const data = readDatabase();
    if (!data) {
        return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (!data.guildMembers) data.guildMembers = {};
    if (!data.reserves) data.reserves = {};
    
    const playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const player = { id: playerId, name: name, class: cls, role: 'Member' };
    let added = 0;
    const skipped = [];
    
    requested.forEach(day => {
        if (!Array.isArray(data.guildMembers[day])) data.guildMembers[day] = [];
        if (!Array.isArray(data.reserves[day])) data.reserves[day] = [];
        
        const exists = data.guildMembers[day].some(p => p && p.name === name && p.class === cls);
        if (exists) {
            skipped.push(day);
            return;
        }
        data.guildMembers[day].push({ ...player });
        data.reserves[day].push({ ...player });
        added++;
    });
    
    data.lastUpdateTime = new Date().toISOString();
    
    if (!writeDatabase(data)) {
        return res.status(500).json({ success: false, error: 'Failed to save data' });
    }
    
    broadcastUpdate(data.lastUpdateTime);
    
    if (added > 0) {
        appendHistory({
            action: 'add',
            playerId: playerId,
            playerName: name,
            to: 'guild + reserves',
            day: requested[0],
            details: name + ' (' + cls + '/Member) registered for ' + requested.map(d => d === 'sat' ? 'Saturday' : 'Sunday').join(' & ')
        });
    }
    
    res.json({
        success: true,
        added: added,
        skipped: skipped,
        player: added > 0 ? player : null,
        lastUpdate: data.lastUpdateTime,
        data: data
    });
});

// POST /api/guild/name - Update guild name (mod+)
app.post('/api/guild/name', requireAuth, (req, res) => {
    const { name } = req.body;
    const data = readDatabase();
    
    if (!data) {
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    data.guildName = name;
    data.lastUpdateTime = new Date().toISOString();
    
    if (writeDatabase(data)) {
        broadcastUpdate(data.lastUpdateTime);
        res.json({ success: true, guildName: name });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save' });
    }
});

// POST /api/groups/add - Add a new group (moderator)
app.post('/api/groups/add', requireAuth, (req, res) => {
    const { day, groupKey, title } = req.body;
    const data = readDatabase();
    const auth = readAuthConfig();
    
    if (!data || !auth) {
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (!data.groups[day]) {
        return res.status(400).json({ success: false, error: 'Invalid day' });
    }

    const maxGroups = auth.settings.maxGroups || 6;
    const currentGroups = Object.keys(data.groups[day]).length;
    
    if (currentGroups >= maxGroups) {
        return res.status(400).json({ 
            success: false, 
            error: `Maximum ${maxGroups} groups allowed` 
        });
    }

    if (data.groups[day][groupKey]) {
        return res.status(400).json({ success: false, error: 'Group already exists' });
    }

    data.groups[day][groupKey] = { title: title || groupKey, players: [] };
    data.lastUpdateTime = new Date().toISOString();
    
    if (writeDatabase(data)) {
        broadcastUpdate(data.lastUpdateTime);
        res.json({ 
            success: true, 
            message: `Group ${title || groupKey} added`,
            group: data.groups[day][groupKey]
        });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save' });
    }
});

// POST /api/groups/remove - Remove a group (moderator)
app.post('/api/groups/remove', requireAuth, (req, res) => {
    const { day, groupKey } = req.body;
    const data = readDatabase();
    
    if (!data) {
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    if (!data.groups[day] || !data.groups[day][groupKey]) {
        return res.status(404).json({ success: false, error: 'Group not found' });
    }

    if (data.groups[day][groupKey].players.length > 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Cannot remove group with players. Move players first.' 
        });
    }

    delete data.groups[day][groupKey];
    data.lastUpdateTime = new Date().toISOString();
    
    if (writeDatabase(data)) {
        broadcastUpdate(data.lastUpdateTime);
        res.json({ success: true, message: 'Group removed' });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save' });
    }
});

// GET /api/groups/config - Get group configuration
app.get('/api/groups/config', (req, res) => {
    const data = readDatabase();
    const auth = readAuthConfig();
    
    if (!data || !auth) {
        return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
        maxGroups: auth.settings.maxGroups || 6,
        currentGroups: {
            sat: Object.keys(data.groups.sat).length,
            sun: Object.keys(data.groups.sun).length
        },
        groups: {
            sat: Object.keys(data.groups.sat),
            sun: Object.keys(data.groups.sun)
        }
    });
});

// ============================================
// HISTORY API
// ============================================

// GET /api/history - Get history entries
app.get('/api/history', (req, res) => {
    const history = readHistory();
    res.json(history);
});

// Append an entry to the history log (shared by /api/history and /api/register)
function appendHistory(fields) {
    const history = readHistory();
    if (!history || !history.entries) return false;
    
    const entry = {
        id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: new Date().toISOString(),
        action: fields.action || null,
        playerId: fields.playerId || null,
        playerName: fields.playerName || null,
        from: fields.from || null,
        to: fields.to || null,
        day: fields.day || null,
        field: fields.field || null,
        oldValue: fields.oldValue || null,
        newValue: fields.newValue || null,
        details: fields.details || null,
        user: fields.user || 'system'
    };
    
    history.entries.unshift(entry);
    
    if (history.entries.length > (history.maxEntries || 100)) {
        history.entries = history.entries.slice(0, history.maxEntries || 100);
    }
    
    return writeHistory(history);
}

// POST /api/history - Add history entry (public - registrations also log here)
app.post('/api/history', (req, res) => {
    const { action, playerId, playerName, from, to, day, field, oldValue, newValue, details, user } = req.body || {};
    
    if (appendHistory({ action, playerId, playerName, from, to, day, field, oldValue, newValue, details, user })) {
        const history = readHistory();
        res.json({ success: true, entry: history.entries[0] });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save history' });
    }
});

// POST /api/history/init - Initialize history file (mod+)
app.post('/api/history/init', requireAuth, (req, res) => {
    const defaultHistory = {
        entries: [],
        maxEntries: 100,
        lastCleared: null
    };
    
    try {
        writeHistory(defaultHistory);
        res.json({ success: true, message: 'History initialized' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/history - Clear history (admin only)
app.delete('/api/history', requireAuth, requireAdmin, (req, res) => {
    const history = readHistory();
    history.entries = [];
    history.lastCleared = new Date().toISOString();
    
    if (writeHistory(history)) {
        res.json({ success: true, message: 'History cleared' });
    } else {
        res.status(500).json({ success: false, error: 'Failed to clear history' });
    }
});

// ============================================
// GUILD MEMBERS MIGRATION
// ============================================

// Populate guildMembers from groups and reserves (deduplicated)
function migrateGuildMembers(data) {
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
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
        
        // Collect players from groups
        if (data.groups && data.groups[day]) {
            groupKeys.forEach(key => {
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

// ============================================
// MIGRATION API ENDPOINT
// ============================================

// POST /api/migrate-guild-members - Manual migration (admin only)
app.post('/api/migrate-guild-members', requireAuth, requireAdmin, (req, res) => {
    const data = readDatabase();
    if (!data) {
        return res.status(500).json({ success: false, error: 'Failed to read database' });
    }
    
    const result = migrateGuildMembers(data);
    
    if (writeDatabase(data)) {
        broadcastUpdate(data.lastUpdateTime || new Date().toISOString());
        res.json({ 
            success: true, 
            message: `Migrated ${result.migrated} players to guildMembers`,
            migrated: result.migrated,
            totalPlayers: result.totalPlayers
        });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save database' });
    }
});

// GET /api/guild-members-status - Check if migration is needed
app.get('/api/guild-members-status', (req, res) => {
    const data = readDatabase();
    if (!data) {
        return res.status(500).json({ error: 'Failed to read database' });
    }
    
    const needsMigration = needsGuildMembersMigration(data);
    const guildCount = data.guildMembers ? 
        Object.values(data.guildMembers).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0) : 0;
    
    // Count players in groups and reserves
    let groupCount = 0;
    let reserveCount = 0;
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    days.forEach(day => {
        if (data.groups && data.groups[day]) {
            groupKeys.forEach(key => {
                if (data.groups[day][key] && data.groups[day][key].players) {
                    groupCount += data.groups[day][key].players.length;
                }
            });
        }
        if (data.reserves && data.reserves[day]) {
            reserveCount += data.reserves[day].length;
        }
    });
    
    res.json({
        needsMigration: needsMigration,
        guildMembersCount: guildCount,
        groupsCount: groupCount,
        reservesCount: reserveCount,
        totalPlayers: groupCount + reserveCount
    });
});

// ============================================
// BACKUP & HEALTH
// ============================================

// GET /api/backup - Download backup (mod+)
app.get('/api/backup', requireAuth, (req, res) => {
    const data = readDatabase();
    if (data) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=guild-war-backup-${Date.now()}.json`);
        res.json(data);
    } else {
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
    const data = readDatabase();
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        hasData: !!data,
        dataSize: data ? Object.keys(data).length : 0
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// INITIALIZATION
// ============================================

initAuthConfig();
initDatabase();
initHistory();

// Phase 9.1: hash any legacy plaintext passwords before serving requests.
migratePlaintextPasswords();

// Phase 8.2: hydrate the tombstone ledger from disk before serving requests,
// so deletion protection is in place from the first request after a restart.
loadTombstonesFromDisk();

// Run guildMembers migration
runGuildMembersMigration();

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    const auth = readAuthConfig();
    console.log(`=== Guild War Management System ===`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database location: ${DB_PATH}`);
    console.log(`Auth config: ${AUTH_PATH}`);
    console.log(`History file: ${HISTORY_PATH}`);
    console.log(`Max groups: ${auth.settings.maxGroups}`);
    console.log(`===================================`);
});

module.exports = app;