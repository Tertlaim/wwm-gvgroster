// server.js - Enhanced Express server with auth config
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// File paths
const DB_PATH = path.join(__dirname, 'data', 'database.json');
const AUTH_PATH = path.join(__dirname, 'config', 'auth.json');
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');

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

// Middleware: requires admin role
function requireAdmin(req, res, next) {
    if (!req.session || req.session.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required.' });
    }
    next();
}

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
        fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
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
                password: "Sin1234",
                role: "admin",
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
        fs.writeFileSync(AUTH_PATH, JSON.stringify(defaultAuth, null, 2));
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
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
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
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
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
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
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
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
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
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
            console.log('✅ Recreated history.json');
        }
    }
}

// ============================================
// AUTHENTICATION API
// ============================================

// POST /api/login - Authenticate user, returns session token
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    // Check admin
    if (auth.admin && auth.admin.username === username) {
        if (password === auth.admin.password) {
            const token = createSession(auth.admin.username, 'admin');
            return res.json({ 
                success: true, 
                name: auth.admin.username, 
                role: 'admin',
                token: token
            });
        }
    }

    // Check moderators
    if (auth.moderators) {
        for (let mod of auth.moderators) {
            if (mod.username === username && password === mod.password) {
                const token = createSession(mod.username, 'mod');
                return res.json({ 
                    success: true, 
                    name: mod.username, 
                    role: 'mod',
                    token: token
                });
            }
        }
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

// GET /api/moderators/list - Get list of moderators (admin only)
app.get('/api/moderators/list', requireAuth, requireAdmin, (req, res) => {
    const auth = readAuthConfig();
    if (!auth) {
        return res.status(500).json({ error: 'Auth config error' });
    }
    
    res.json({
        moderators: auth.moderators.map(mod => ({ username: mod.username, role: mod.role }))
    });
});

// POST /api/moderators/add - Add new moderator (admin only)
app.post('/api/moderators/add', requireAuth, requireAdmin, (req, res) => {
    const { username, password } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    if (auth.admin.username === username) {
        return res.status(400).json({ success: false, error: 'Cannot add admin as moderator' });
    }
    
    if (auth.moderators.some(mod => mod.username === username)) {
        return res.status(400).json({ success: false, error: 'User is already a moderator' });
    }

    const newPassword = password || auth.settings.defaultModPassword || 'Sin1234';
    auth.moderators.push({
        id: 'mod_' + Date.now(),
        username: username,
        password: newPassword,
        role: 'mod',
        createdAt: new Date().toISOString()
    });

    if (writeAuthConfig(auth)) {
        res.json({ 
            success: true, 
            message: `Moderator ${username} added successfully`,
            password: newPassword
        });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save auth config' });
    }
});

// POST /api/moderators/remove - Remove moderator (admin only)
app.post('/api/moderators/remove', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.body;
    const auth = readAuthConfig();
    
    if (!auth) {
        return res.status(500).json({ success: false, error: 'Auth config error' });
    }

    const index = auth.moderators.findIndex(mod => mod.username === username);
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Moderator not found' });
    }

    auth.moderators.splice(index, 1);
    
    if (writeAuthConfig(auth)) {
        res.json({ success: true, message: `Moderator ${username} removed` });
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
    mod.password = newPassword;
    
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

    if (mod.password !== oldPassword) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    mod.password = newPassword;
    
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
        res.json({
            ...data,
            lastUpdateTime: data.lastUpdateTime || new Date().toISOString()
        });
    } else {
        res.status(500).json({ error: 'Failed to load data' });
    }
});

// POST /api/data - Save all data
// AUTH REQUIRED (mod+) - Public writes go through the dedicated /api/register endpoint.
// Previously this endpoint was unauthenticated and let any visitor overwrite the
// entire database (wipe or tamper with all roster data).
app.post('/api/data', requireAuth, (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ success: false, error: 'Invalid data payload' });
    }
    // Require at least one real data key so an empty payload cannot wipe the roster
    if (!('groups' in data) && !('reserves' in data) && !('guildMembers' in data)) {
        return res.status(400).json({ success: false, error: 'Invalid data payload' });
    }
    data.lastUpdateTime = new Date().toISOString();
    
    if (writeDatabase(data)) {
        res.json({ 
            success: true, 
            lastUpdate: data.lastUpdateTime,
            message: 'Data saved successfully'
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