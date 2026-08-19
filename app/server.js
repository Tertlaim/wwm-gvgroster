// server.js - Express server boot file (Phase 11.1 split)
// All logic lives in ./server modules; this file builds the app, wires the
// routes with a shared context, runs boot-time initialization and listens.
const express = require('express');
const cors = require('cors');
const path = require('path');

const auth = require('./server/auth');
const data = require('./server/data');
const history = require('./server/history');
const merge = require('./server/merge');
const rate = require('./server/rate-limit');
const sse = require('./server/sse');

const registerAuthRoutes = require('./server/route/auth');
const registerDataRoutes = require('./server/route/data');
const registerHistoryRoutes = require('./server/route/history');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Shared context handed to every route module.
const ctx = { auth, data, history, merge, rate, sse };

registerAuthRoutes(app, ctx);
registerDataRoutes(app, ctx);
registerHistoryRoutes(app, ctx);

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// INITIALIZATION
// ============================================

auth.initAuthConfig();
data.initDatabase();
history.initHistory();

// Phase 9.1: hash any legacy plaintext passwords before serving requests.
auth.migratePlaintextPasswords();

// Phase 8.2: hydrate the tombstone ledger from disk before serving requests,
// so deletion protection is in place from the first request after a restart.
data.loadTombstonesFromDisk();

// Run guildMembers migration
data.runGuildMembersMigration();

// Master-list integrity: repair any day-split master gaps on boot
data.runMasterListBackfill();

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    const authConfig = auth.readAuthConfig();
    console.log(`=== Guild War Management System ===`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Database location: ${data.DB_PATH}`);
    console.log(`Auth config: ${auth.AUTH_PATH}`);
    console.log(`History file: ${history.HISTORY_PATH}`);
    console.log(`Max groups: ${authConfig.settings.maxGroups}`);
    console.log(`===================================`);
});

module.exports = app;
