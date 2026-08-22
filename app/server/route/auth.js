// server/route/auth.js - Authentication API routes (Phase 11.1)
// Registered by server.js with a shared context of module functions.
//
// All mutating routes run their read-modify-write cycle inside
// auth.updateAuthConfig() so concurrent admin operations serialize on the
// latest committed config. Validation failures throw an error carrying a
// .status, which the route maps onto the HTTP response.

const crypto = require('crypto');

function httpErr(status, message) {
    return Object.assign(new Error(message), { status });
}

module.exports = function registerAuthRoutes(app, ctx) {
    const { auth, rate } = ctx;

    // POST /api/login - Authenticate user, returns session token
    app.post('/api/login', async (req, res) => {
        const rl = rate.checkRateLimit('login:' + rate.clientIp(req), rate.LOGIN_MAX, rate.RATE_WINDOW_MS);
        if (!rl.allowed) {
            return res.status(429).json({ success: false, error: 'Too many login attempts. Try again later.', retryAfter: rl.retryAfterSec });
        }

        const { username, password } = req.body;
        const authConfig = await auth.readAuthConfig();

        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        const user = auth.getAllAuthUsers(authConfig).find(u => u && u.username === username && auth.verifyPassword(password, u.password));
        if (user) {
            const role = auth.getUserRole(user);
            const token = auth.createSession(user.username, role);
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
            auth.destroySession(authToken);
        }
        res.json({ success: true, message: 'Logged out' });
    });

    // GET /api/session - Check current session validity
    app.get('/api/session', auth.requireAuth, (req, res) => {
        res.json({
            success: true,
            name: req.session.username,
            role: req.session.role,
            expiresAt: req.session.expiresAt
        });
    });

    // GET /api/moderators/list - Get all auth users + roles (admin+)
    app.get('/api/moderators/list', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const authConfig = await auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }

        res.json({
            users: auth.getAllAuthUsers(authConfig).map(u => ({ username: u.username, role: auth.getUserRole(u) }))
        });
    });

    // GET /api/register/status - Public check if registration is enabled
    app.get('/api/register/status', async (req, res) => {
        const authConfig = await auth.readAuthConfig();
        res.json({ enabled: authConfig && authConfig.settings && authConfig.settings.publicRegistration !== false });
    });

    // GET /api/staff - Public staff list (names + roles only, no credentials)
    app.get('/api/staff', async (req, res) => {
        const authConfig = await auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }

        res.json({
            users: auth.getAllAuthUsers(authConfig).map(u => ({ username: u.username, role: auth.getUserRole(u) }))
        });
    });

    // POST /api/moderators/add - Add staff (mod by default; admin requires SuperAdmin)
    app.post('/api/moderators/add', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const { username, password, role } = req.body;
        const targetRole = role === 'admin' ? 'admin' : 'mod';
        if (targetRole === 'admin' && req.session.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Only SuperAdmin can add admins.' });
        }
        if (typeof username !== 'string' || !username.trim()) {
            return res.status(400).json({ success: false, error: 'Username is required.' });
        }

        try {
            let newPassword = '';
            const saved = await auth.updateAuthConfig(cfg => {
                if (auth.getAllAuthUsers(cfg).some(u => u.username === username)) {
                    throw httpErr(400, 'User is already staff (mod or admin)');
                }
                newPassword = typeof password === 'string' && password ? password : (cfg.settings.defaultModPassword || 'Sin1234');
                cfg.moderators.push({
                    id: 'mod_' + crypto.randomUUID(),
                    username: username,
                    password: auth.hashPassword(newPassword),
                    role: targetRole,
                    createdAt: new Date().toISOString()
                });
            });
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save auth config' });
            }
            res.json({
                success: true,
                message: `${targetRole === 'admin' ? 'Admin' : 'Moderator'} ${username} added successfully`,
                role: targetRole,
                password: newPassword
            });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, error: e.message });
            throw e;
        }
    });

    // POST /api/moderators/remove - Remove staff
    app.post('/api/moderators/remove', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const { username } = req.body;

        try {
            const saved = await auth.updateAuthConfig(cfg => {
                const index = cfg.moderators.findIndex(mod => mod.username === username);
                if (index === -1) {
                    throw httpErr(404, 'Staff member not found');
                }
                if (auth.getUserRole(cfg.moderators[index]) === 'admin' && req.session.role !== 'superadmin') {
                    throw httpErr(403, 'Only SuperAdmin can demote admins.');
                }
                cfg.moderators.splice(index, 1);
            });
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save auth config' });
            }
            res.json({ success: true, message: `${username} removed from staff` });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, error: e.message });
            throw e;
        }
    });

    // POST /api/moderators/reset-password - Reset moderator password (admin only)
    // Admin targets are SuperAdmin-only (mirrors add/remove gating); the
    // SuperAdmin's own credential lives outside this list and is recovered
    // directly in storage (Supabase row / config/auth.json).
    app.post('/api/moderators/reset-password', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const { username } = req.body;

        try {
            let newPassword = '';
            const saved = await auth.updateAuthConfig(cfg => {
                const mod = cfg.moderators.find(m => m.username === username);
                if (!mod) {
                    throw httpErr(404, 'Moderator not found');
                }
                if (auth.getUserRole(mod) === 'admin' && req.session.role !== 'superadmin') {
                    throw httpErr(403, 'Only SuperAdmin can reset admin passwords.');
                }
                newPassword = cfg.settings.defaultModPassword || 'Sin1234';
                mod.password = auth.hashPassword(newPassword);
            });
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save auth config' });
            }
            res.json({
                success: true,
                message: `Password reset for ${username}`,
                newPassword: newPassword
            });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, error: e.message });
            throw e;
        }
    });

    // POST /api/moderators/change-password - Change own password.
    // Admins may also change another account's password; everyone else is
    // restricted to their own.
    app.post('/api/moderators/change-password', auth.requireAuth, async (req, res) => {
        const { username, oldPassword, newPassword } = req.body;
        const isSelf = req.session.username === username;
        const isAdmin = req.session.role === 'admin' || req.session.role === 'superadmin';
        if (!isSelf && !isAdmin) {
            return res.status(403).json({ success: false, error: 'You can only change your own password.' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 4) {
            return res.status(400).json({ success: false, error: 'New password must be at least 4 characters.' });
        }

        try {
            const saved = await auth.updateAuthConfig(cfg => {
                const target = cfg.moderators.find(m => m.username === username) ||
                    (cfg.admin && cfg.admin.username === username ? cfg.admin : null);
                if (!target) {
                    throw httpErr(404, 'Moderator not found');
                }

                if (!auth.verifyPassword(oldPassword, target.password)) {
                    throw httpErr(401, 'Current password is incorrect');
                }
                target.password = auth.hashPassword(newPassword);
            });
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save auth config' });
            }
            res.json({ success: true, message: 'Password updated successfully' });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, error: e.message });
            throw e;
        }
    });

    // GET /api/auth/settings - Get auth settings (admin only)
    app.get('/api/auth/settings', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const authConfig = await auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }

        res.json({
            allowModeratorRegistration: authConfig.settings.allowModeratorRegistration,
            publicRegistration: authConfig.settings.publicRegistration !== false,
            maxGroups: authConfig.settings.maxGroups,
            moderators: authConfig.moderators.map(mod => ({ username: mod.username, role: mod.role }))
        });
    });

    // POST /api/auth/settings - Update auth settings (admin only)
    app.post('/api/auth/settings', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        const { allowModeratorRegistration, publicRegistration, maxGroups, defaultModPassword } = req.body;

        try {
            const saved = await auth.updateAuthConfig(cfg => {
                if (allowModeratorRegistration !== undefined) {
                    cfg.settings.allowModeratorRegistration = allowModeratorRegistration;
                }
                if (publicRegistration !== undefined) {
                    cfg.settings.publicRegistration = publicRegistration;
                }
                if (maxGroups !== undefined) {
                    cfg.settings.maxGroups = maxGroups;
                }
                if (defaultModPassword !== undefined) {
                    cfg.settings.defaultModPassword = defaultModPassword;
                }
            });
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save auth config' });
            }
            res.json({ success: true, message: 'Settings updated' });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, error: e.message });
            throw e;
        }
    });
};
