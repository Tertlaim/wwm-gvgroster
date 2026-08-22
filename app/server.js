// server.js - Express server boot file (Phase 11.1 split)
// All logic lives in ./server modules; this file builds the app, wires the
// routes with a shared context, runs boot-time initialization and listens.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const auth = require('./server/auth');
const storage = require('./server/storage');
const data = storage.data;
const history = storage.history;
const merge = require('./server/merge');
const rate = require('./server/rate-limit');
const sse = require('./server/sse');

const registerAuthRoutes = require('./server/route/auth');
const registerDataRoutes = require('./server/route/data');
const registerHistoryRoutes = require('./server/route/history');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust one proxy hop (Render/nginx) so req.ip - and therefore rate
// limiting - keys on the real client address instead of the proxy IP.
app.set('trust proxy', 1);

// Security headers. Inline style attributes are used extensively by the
// client renderers (style="..."), so style-src allows 'unsafe-inline';
// scripts are strictly self-hosted (index.html has no inline <script>).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"]
        }
    }
}));

// Cross-origin API access is opt-in via ALLOWED_ORIGIN (comma-separated).
// The bundled frontend is same-origin and needs no CORS at all, so without
// this variable browsers elsewhere get no permissive CORS headers.
const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
    : null;
if (allowedOrigins) {
    app.use(cors({ origin: allowedOrigins }));
}

// Middleware
app.use(express.json({ limit: '1mb' }));

// Serve ONLY client assets - never the server source tree.
['css', 'js', 'vendor'].forEach(dir => {
    app.use('/' + dir, express.static(path.join(__dirname, dir)));
});

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

async function init() {
    // Phase 15: Wire storage backend into auth module
    auth.setAuthStorage(storage.auth);

    // Init auth config (async for Supabase, sync for JSON)
    await auth.initAuthConfig();

    // Phase 9.1: hash any legacy plaintext passwords before serving requests.
    await auth.migratePlaintextPasswords();

    await data.initDatabase();
    history.initHistory();

    // Phase 8.2: hydrate the tombstone ledger before serving requests,
    // so deletion protection is in place from the first request after a
    // restart. Works for both backends (JSON reads disk, Supabase reads
    // the app_state blob).
    await data.loadTombstonesFromDisk();

    // Run guildMembers migration
    await data.runGuildMembersMigration();

    // Master-list integrity: repair any day-split master gaps on boot
    await data.runMasterListBackfill();

    // Phase 15: Migrate legacy string announcement to object format
    await data.runAnnouncementMigration();
}

init().then(() => {
    app.listen(PORT, () => {
        (async () => {
            const authConfig = await auth.readAuthConfig();
            const storageType = process.env.STORAGE || 'json';
            console.log(`=== Guild War Management System ===`);
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Storage: ${storageType === 'supabase' ? 'Supabase' : 'JSON files'}`);
            if (storageType !== 'supabase') {
                console.log(`Database: ${data.DB_PATH}`);
                console.log(`History: ${history.HISTORY_PATH}`);
            }
            console.log(`Max groups: ${authConfig && authConfig.settings ? authConfig.settings.maxGroups : '?'}`);
            console.log(`===================================`);
        })().catch(err => console.error('Boot log error:', err));
    });
}).catch(err => {
    console.error('Failed to initialize server:', err);
    process.exit(1);
});

module.exports = app;
