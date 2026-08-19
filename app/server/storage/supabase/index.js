// storage/supabase/index.js - Barrel export for Supabase storage
const data = require('./data');
const history = require('./history');
const auth = require('./auth');

module.exports = { data, history, auth };
