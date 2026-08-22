// storage/auth-defaults.js - Shared default auth config (single source)
// Used by both the JSON and Supabase storage adapters so they cannot drift.

const bcrypt = require('bcrypt');

const DEFAULT_AUTH = {
    admin: {
        id: 'admin_001',
        username: 'SuperAdmin',
        password: bcrypt.hashSync('Admin123', 10),
        role: 'superadmin',
        createdAt: new Date().toISOString()
    },
    moderators: [],
    settings: {
        allowModeratorRegistration: true,
        publicRegistration: true,
        maxGroups: 6,
        defaultModPassword: 'Admin123',
        discordWebhook: '',
        historyLimit: 100
    }
};

module.exports = { DEFAULT_AUTH };
