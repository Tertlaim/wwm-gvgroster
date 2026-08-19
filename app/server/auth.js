// server/auth.js - Sessions, auth middleware, password hashing, auth config
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { atomicWriteFileSync } = require('./util');

const AUTH_PATH = path.join(__dirname, '..', 'config', 'auth.json');

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
    const configDir = path.join(__dirname, '..', 'config');
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(AUTH_PATH)) {
        const defaultAuth = {
            admin: {
                id: "admin_001",
                username: "SuperAdmin",
                password: hashPassword('Admin123'),
                role: "superadmin",
                createdAt: new Date().toISOString()
            },
            moderators: [],
            settings: {
                allowModeratorRegistration: true,
                maxGroups: 6,
                defaultModPassword: "Admin123",
                discordWebhook: "",
                historyLimit: 100
            }
        };
        atomicWriteFileSync(AUTH_PATH, JSON.stringify(defaultAuth, null, 2));
        console.log('Created new auth config file');
    }
}

module.exports = {
    AUTH_PATH,
    createSession,
    getSession,
    destroySession,
    requireAuth,
    requireAdmin,
    requireSuperAdmin,
    getAllAuthUsers,
    getUserRole,
    isHashed,
    hashPassword,
    verifyPassword,
    migratePlaintextPasswords,
    readAuthConfig,
    writeAuthConfig,
    initAuthConfig
};
