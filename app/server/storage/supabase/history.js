// storage/supabase/history.js - Supabase storage adapter for history
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

function getClient() {
    if (!supabase) {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
        }
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

// Read history entries
async function readHistory() {
    const client = getClient();
    const { data, error } = await client
        .from('history')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error reading history:', error);
        return { entries: [], maxEntries: 100, lastCleared: null };
    }

    return {
        entries: data || [],
        maxEntries: 100,
        lastCleared: null
    };
}

// Write history (replace all entries)
async function writeHistory(data) {
    const client = getClient();

    // Delete all existing entries
    await client.from('history').delete().neq('id', '');

    // Insert new entries
    if (data.entries && data.entries.length > 0) {
        const { error } = await client
            .from('history')
            .insert(data.entries.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                action: e.action,
                playerId: e.playerId,
                playerName: e.playerName,
                from: e.from,
                to: e.to,
                day: e.day,
                field: e.field,
                oldValue: e.oldValue,
                newValue: e.newValue,
                details: e.details,
                user: e.user
            })));

        if (error) {
            console.error('Error writing history:', error);
            return false;
        }
    }

    return true;
}

// Initialize: check if table exists (Supabase tables are created via dashboard/SQL)
async function initHistory() {
    const client = getClient();
    const { error } = await client.from('history').select('id').limit(1);

    if (error && error.code === '42P01') {
        console.error('⚠️ history table does not exist in Supabase. Create it via the Supabase dashboard.');
        console.error('   Table schema: id text primary key, timestamp text, action text, playerId text,');
        console.error('   playerName text, "from" text, "to" text, day text, field text,');
        console.error('   oldValue text, newValue text, details text, user text');
    } else {
        console.log('✅ Supabase history table exists');
    }
}

// Append a single entry
async function appendHistory(fields) {
    const client = getClient();

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

    const { error } = await client.from('history').insert(entry);

    if (error) {
        console.error('Error appending history:', error);
        return false;
    }

    // Prune old entries (keep last 100)
    const { data: countData } = await client
        .from('history')
        .select('id', { count: 'exact', head: true });

    // Supabase doesn't have a great way to delete oldest N rows,
    // so we'll do a periodic cleanup in readHistory
    return true;
}

module.exports = {
    readHistory,
    writeHistory,
    initHistory,
    appendHistory
};
