// server/history.js - History read/write/init + append
const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./util');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

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
        atomicWriteFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing history:', error);
        return false;
    }
}

// Initialize history
function initHistory() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(HISTORY_PATH)) {
        const defaultHistory = {
            entries: [],
            maxEntries: 100,
            lastCleared: null
        };
        atomicWriteFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
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
            atomicWriteFileSync(HISTORY_PATH, JSON.stringify(defaultHistory, null, 2));
            console.log('✅ Recreated history.json');
        }
    }
}

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

module.exports = {
    HISTORY_PATH,
    readHistory,
    writeHistory,
    initHistory,
    appendHistory
};
