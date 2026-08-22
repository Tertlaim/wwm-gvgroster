// storage/supabase/auth.js - Supabase-backed auth storage
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
const { DEFAULT_AUTH } = require('../auth-defaults');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const client = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

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
        // No auth row exists — create default with hashed password
        await writeAuthConfig(DEFAULT_AUTH);
        console.log('Created default auth in Supabase');
    } else {
        // Auth row exists — check if admin password is empty, missing, or invalid
        const adminPassword = existing.admin && existing.admin.password;
        let needsFix = false;
        
        if (!adminPassword || adminPassword === '') {
            // Password is empty
            needsFix = true;
            console.log('⚠️ Admin password is empty, resetting to default');
        } else {
            // Password exists — verify the hash is valid by trying to compare
            try {
                if (!bcrypt.compareSync('Admin123', adminPassword)) {
                    // Hash doesn't match default password — could be corrupted or user changed it
                    // Only fix if it looks like a corrupted hash (not a valid bcrypt hash)
                    if (!adminPassword.startsWith('$2')) {
                        needsFix = true;
                        console.log('⚠️ Admin password hash is corrupted, resetting to default');
                    }
                }
            } catch (e) {
                // Hash is invalid/corrupted
                needsFix = true;
                console.log('⚠️ Admin password hash is invalid, resetting to default');
            }
        }
        
        if (needsFix) {
            existing.admin.password = DEFAULT_AUTH.admin.password;
            existing.admin.createdAt = existing.admin.createdAt || new Date().toISOString();
            await writeAuthConfig(existing);
            console.log('✅ Fixed admin password in Supabase');
        } else {
            console.log('✅ Supabase auth exists');
        }
    }
}

module.exports = { readAuthConfig, writeAuthConfig, initAuthConfig };
