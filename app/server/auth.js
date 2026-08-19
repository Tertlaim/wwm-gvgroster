// server/auth.js - Sessions, auth middleware, password hashing, auth config
// Phase 15: auth storage is pluggable via the storage backend
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Storage backend is injected at boot via initAuthStorage()
let _authStorage = null;

function setAuthStorage(storage) {
    _authStorage = storage;
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

function isHashed(pw) {
    return typeof pw === 'string' && /^\$2[aby]\$\d{2}\$/.test(pw);
}

function hashPassword(plain) {
    return bcrypt.hashSync(String(plain == null ? '' : plain), BCRYPT_ROUNDS);
}

function verifyPassword(attempt, stored) {
    if (typeof stored !== 'string') return false;
    if (isHashed(stored)) {
        try { return bcrypt.compareSync(String(attempt == null ? '' : attempt), stored); }
        catch (e) { return false; }
    }
    return stored === attempt;
}

// ============================================
// AUTH CONFIG READ/WRITE (delegates to storage backend)
// ============================================

function readAuthConfig() {
    if (_authStorage && _authStorage.readAuthConfig) {
        // For JSON storage this is sync; for Supabase we use the cached copy
        const result = _authStorage.readAuthConfig();
        // Handle async (Supabase) — return cached data
        if (result && typeof result.then === 'function') {
            return _cachedAuth;
        }
        return result;
    }
    // Fallback: no storage configured
    return _cachedAuth;
}

// Cached auth data (populated at boot, used for sync reads)
let _cachedAuth = null;

function writeAuthConfig(data) {
    // Update cache immediately
    _cachedAuth = data;
    if (_authStorage && _authStorage.writeAuthConfig) {
        const result = _authStorage.writeAuthConfig(data);
        if (result && typeof result.then === 'function') {
            // Async (Supabase) — fire and forget, already cached
            result.catch(err => console.error('Async auth write failed:', err));
            return true;
        }
        return result;
    }
    return false;
}

// Migrate any plaintext passwords in auth to bcrypt hashes (boot-time).
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

// Initialize auth config (async to support Supabase)
async function initAuthConfig() {
    if (_authStorage && _authStorage.initAuthConfig) {
        const result = _authStorage.initAuthConfig();
        if (result && typeof result.then === 'function') {
            await result; // Supabase async init
        }
    }
    // Load auth into cache
    if (_authStorage && _authStorage.readAuthConfig) {
        const result = _authStorage.readAuthConfig();
        if (result && typeof result.then === 'function') {
            _cachedAuth = await result;
        } else {
            _cachedAuth = result;
        }
    }
}

module.exports = {
    setAuthStorage,
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
