// storage/index.js - Storage adapter switcher
// Selects JSON file storage or Supabase based on STORAGE env var.

const storageType = process.env.STORAGE || 'json';

let storage;
if (storageType === 'supabase') {
    storage = require('./supabase');
    console.log('📦 Storage: Supabase');
} else {
    storage = require('./json');
    console.log('📦 Storage: JSON files');
}

// Both sub-modules (data, history) share the same interface:
// data: readDatabase, writeDatabase, getLastUpdateTime, initDatabase, etc.
// history: readHistory, writeHistory, initHistory, appendHistory

module.exports = storage;
