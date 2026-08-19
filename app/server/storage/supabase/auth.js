// storage/supabase/auth.js - Supabase-backed auth storage
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const client = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const DEFAULT_AUTH = {
    admin: {
        id: "admin_001",
        username: "SuperAdmin",
        password: bcrypt.hashSync('Admin123', 10),
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

async function readAuthConfig() {
    if (!client) return null;
    try {
        const { data, error } = await client
            .from('app_state')
            .select('value')
            .eq('id', 'auth')
            .single();
        if (error || !data) return null;
        return data.value;
    } catch (err) {
        console.error('Error reading auth from Supabase:', err);
        return null;
    }
}

async function writeAuthConfig(authData) {
    if (!client) return false;
    try {
        const { error } = await client
            .from('app_state')
            .upsert({ id: 'auth', value: authData }, { onConflict: 'id' });
        if (error) {
            console.error('Error writing auth to Supabase:', error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Error writing auth to Supabase:', err);
        return false;
    }
}

async function initAuthConfig() {
    const existing = await readAuthConfig();
    if (!existing) {
        await writeAuthConfig(DEFAULT_AUTH);
        console.log('Created default auth in Supabase');
    } else {
        console.log('✅ Supabase auth exists');
    }
}

module.exports = { readAuthConfig, writeAuthConfig, initAuthConfig };
