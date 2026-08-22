// server/auth.js - Sessions, auth middleware, password hashing, auth config
// Phase 15: auth storage is pluggable via the storage backend.
// Concurrency hardening: the storage contract is uniformly async and every
// read-modify-write cycle goes through updateAuthConfig(), which serializes
// access so concurrent admin edits cannot interleave from a stale snapshot.

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

// Sweep expired sessions so the map cannot grow unbounded (mirrors rate-limit).
setInterval(() => {
    const now = Date.now();
    SESSIONS.forEach((v, k) => { if (v.expiresAt <= now) SESSIONS.delete(k); });
}, 10 * 60 * 1000).unref();

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
// Uniformly async: JSON adapter resolves immediately, Supabase awaits the DB.
// ============================================

// Cached auth data (refreshed after reads/writes; fallback when no storage)
let _cachedAuth = null;

async function readAuthConfig() {
    let config = _cachedAuth;
    if (_authStorage && _authStorage.readAuthConfig) {
        try {
            config = await _authStorage.readAuthConfig();
        } catch (err) {
            console.error('Error reading auth config:', err);
            config = null;
        }
    }
    if (config) _cachedAuth = config;
    return config;
}

async function writeAuthConfig(data) {
    if (!_authStorage || !_authStorage.writeAuthConfig) return false;
    let ok = false;
    try {
        ok = await _authStorage.writeAuthConfig(data);
    } catch (err) {
        console.error('Error writing auth config:', err);
        ok = false;
    }
    if (ok) _cachedAuth = data;
    return !!ok;
}

// Serialized read-modify-write for the auth config.
//
// mutator(config) mutates the freshly-read config in place and:
//   - returns/awaits normally  -> config is written, resolves to the config
//   - returns false           -> aborts WITHOUT writing, resolves to null
//   - throws                  -> aborts WITHOUT writing, rejects to the caller
//
// Concurrent calls are queued so each cycle reads the latest committed state.
let _authLockTail = Promise.resolve();

function updateAuthConfig(mutator) {
    let release;
    const ticket = _authLockTail;
    _authLockTail = new Promise(resolve => { release = resolve; });

    return ticket.then(async () => {
        try {
            const config = await readAuthConfig();
            if (!config) return null;
            const result = await mutator(config);
            if (result === false) return null;
            const ok = await writeAuthConfig(config);
            return ok ? config : null;
        } finally {
            release();
        }
    });
}

// Migrate any plaintext passwords in auth to bcrypt hashes (boot-time).
async function migratePlaintextPasswords() {
    const auth = await readAuthConfig();
    if (!auth) return;
    let changed = false;
    getAllAuthUsers(auth).forEach(u => {
        if (u && typeof u.password === 'string' && !isHashed(u.password)) {
            u.password = hashPassword(u.password);
            changed = true;
        }
    });
    if (changed && await writeAuthConfig(auth)) {
        console.log('🔐 Migrated plaintext passwords to bcrypt hashes');
    }
}

// Initialize auth config (loads storage into cache)
async function initAuthConfig() {
    if (_authStorage && _authStorage.initAuthConfig) {
        await _authStorage.initAuthConfig();
    }
    // Load auth into cache
    if (_authStorage && _authStorage.readAuthConfig) {
        _cachedAuth = await _authStorage.readAuthConfig();
    } else {
        _cachedAuth = null;
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
    updateAuthConfig,
    initAuthConfig
};
