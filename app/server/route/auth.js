// server/route/auth.js - Authentication API routes (Phase 11.1)
// Registered by server.js with a shared context of module functions.

module.exports = function registerAuthRoutes(app, ctx) {
    const { auth, rate } = ctx;

    // POST /api/login - Authenticate user, returns session token
    app.post('/api/login', (req, res) => {
        const rl = rate.checkRateLimit('login:' + rate.clientIp(req), rate.LOGIN_MAX, rate.RATE_WINDOW_MS);
        if (!rl.allowed) {
            return res.status(429).json({ success: false, error: 'Too many login attempts. Try again later.', retryAfter: rl.retryAfterSec });
        }

        const { username, password } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        // Roles come from the stored user record (superadmin/admin/mod), never hardcoded.
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
    app.get('/api/moderators/list', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const authConfig = auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }
        
        res.json({
            users: auth.getAllAuthUsers(authConfig).map(u => ({ username: u.username, role: auth.getUserRole(u) }))
        });
    });

    // GET /api/staff - Public staff list (names + roles only, no credentials).
    // Lets everyone see who the admins/moderators are; never exposes passwords.
    app.get('/api/staff', (req, res) => {
        const authConfig = auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }
        
        res.json({
            users: auth.getAllAuthUsers(authConfig).map(u => ({ username: u.username, role: auth.getUserRole(u) }))
        });
    });

    // POST /api/moderators/add - Add staff (mod by default; admin requires SuperAdmin)
    app.post('/api/moderators/add', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const { username, password, role } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        // Only 'mod' and 'admin' can be created here; superadmin is never assignable.
        const targetRole = role === 'admin' ? 'admin' : 'mod';
        if (targetRole === 'admin' && req.session.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Only SuperAdmin can add admins.' });
        }

        if (auth.getAllAuthUsers(authConfig).some(u => u.username === username)) {
            return res.status(400).json({ success: false, error: 'User is already staff (mod or admin)' });
        }

        const newPassword = password || authConfig.settings.defaultModPassword || 'Sin1234';
        authConfig.moderators.push({
            id: 'mod_' + Date.now(),
            username: username,
            password: auth.hashPassword(newPassword),
            role: targetRole,
            createdAt: new Date().toISOString()
        });

        if (auth.writeAuthConfig(authConfig)) {
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
    app.post('/api/moderators/remove', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const { username } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        const index = authConfig.moderators.findIndex(mod => mod.username === username);
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Staff member not found' });
        }

        // Demoting an admin is SuperAdmin-only; the owner (auth.admin) is never listed here.
        if (auth.getUserRole(authConfig.moderators[index]) === 'admin' && req.session.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Only SuperAdmin can demote admins.' });
        }

        authConfig.moderators.splice(index, 1);
        
        if (auth.writeAuthConfig(authConfig)) {
            res.json({ success: true, message: `${username} removed from staff` });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save auth config' });
        }
    });

    // POST /api/moderators/reset-password - Reset moderator password (admin only)
    app.post('/api/moderators/reset-password', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const { username } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        const mod = authConfig.moderators.find(m => m.username === username);
        if (!mod) {
            return res.status(404).json({ success: false, error: 'Moderator not found' });
        }

        const newPassword = authConfig.settings.defaultModPassword || 'Sin1234';
        mod.password = auth.hashPassword(newPassword);
        
        if (auth.writeAuthConfig(authConfig)) {
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
    app.post('/api/moderators/change-password', auth.requireAuth, (req, res) => {
        const { username, oldPassword, newPassword } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        // Staff (mods/admins) live in auth.moderators; the owner (SuperAdmin)
        // lives in auth.admin. Either may change their own password.
        const mod = authConfig.moderators.find(m => m.username === username) ||
            (authConfig.admin && authConfig.admin.username === username ? authConfig.admin : null);
        if (!mod) {
            return res.status(404).json({ success: false, error: 'Moderator not found' });
        }

        if (!auth.verifyPassword(oldPassword, mod.password)) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }

        mod.password = auth.hashPassword(newPassword);
        
        if (auth.writeAuthConfig(authConfig)) {
            res.json({ success: true, message: 'Password updated successfully' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save auth config' });
        }
    });

    // GET /api/auth/settings - Get auth settings (admin only)
    app.get('/api/auth/settings', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const authConfig = auth.readAuthConfig();
        if (!authConfig) {
            return res.status(500).json({ error: 'Auth config error' });
        }
        
        res.json({
            allowModeratorRegistration: authConfig.settings.allowModeratorRegistration,
            maxGroups: authConfig.settings.maxGroups,
            moderators: authConfig.moderators.map(mod => ({ username: mod.username, role: mod.role }))
        });
    });

    // POST /api/auth/settings - Update auth settings (admin only)
    app.post('/api/auth/settings', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const { allowModeratorRegistration, maxGroups, defaultModPassword } = req.body;
        const authConfig = auth.readAuthConfig();
        
        if (!authConfig) {
            return res.status(500).json({ success: false, error: 'Auth config error' });
        }

        if (allowModeratorRegistration !== undefined) {
            authConfig.settings.allowModeratorRegistration = allowModeratorRegistration;
        }
        if (maxGroups !== undefined) {
            authConfig.settings.maxGroups = maxGroups;
        }
        if (defaultModPassword !== undefined) {
            authConfig.settings.defaultModPassword = defaultModPassword;
        }

        if (auth.writeAuthConfig(authConfig)) {
            res.json({ success: true, message: 'Settings updated' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save auth config' });
        }
    });
};
