// server/route/data.js - Guild data + realtime + migration + backup routes (Phase 11.1)

module.exports = function registerDataRoutes(app, ctx) {
    const { auth, data, merge, history, rate, sse } = ctx;

    // GET /api/data - Load all data
    app.get('/api/data', (req, res) => {
        const db = data.readDatabase();
        if (db) {
            // Tombstones are a server-side deletion ledger; clients don't need
            // them (they send their own deletedIds per save).
            const { deletedPlayers, ...publicData } = db;
            res.json({
                ...publicData,
                lastUpdateTime: db.lastUpdateTime || new Date().toISOString()
            });
        } else {
            res.status(500).json({ error: 'Failed to load data' });
        }
    });

    // GET /api/data/updated - Cheap last-update timestamp (Phase 11.7)
    // Lets the client poller skip the full-state download unless data changed.
    app.get('/api/data/updated', (req, res) => {
        res.json({ lastUpdateTime: data.getLastUpdateTime() });
    });

    // GET /api/events - Server-Sent Events stream; clients re-sync on 'update'
    app.get('/api/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write('retry: 5000\n\n');
        sse.SSE_CLIENTS.add(res);
        
        const heartbeat = setInterval(() => {
            try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); sse.SSE_CLIENTS.delete(res); }
        }, 25000);
        
        req.on('close', () => {
            clearInterval(heartbeat);
            sse.SSE_CLIENTS.delete(res);
        });
    });

    // POST /api/data - Save all data
    // AUTH REQUIRED (mod+) - Public writes go through the dedicated /api/register endpoint.
    // Previously this endpoint was unauthenticated and let any visitor overwrite the
    // entire database (wipe or tamper with all roster data).
    // Since Phase 4.5 the server merges stale snapshots instead of blind-overwriting.
    app.post('/api/data', auth.requireAuth, (req, res) => {
        const incoming = req.body;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ success: false, error: 'Invalid data payload' });
        }
        // Require at least one real data key so an empty payload cannot wipe the roster
        if (!('groups' in incoming) && !('reserves' in incoming) && !('guildMembers' in incoming)) {
            return res.status(400).json({ success: false, error: 'Invalid data payload' });
        }
        
        const current = data.readDatabase();
        if (!current) {
            return res.status(500).json({ success: false, error: 'Failed to read database' });
        }
        
        // Version the client's snapshot is based on (its last sync).
        const baseVersion = typeof incoming.baseVersion === 'string' ? incoming.baseVersion : null;
        let baseTimeMs = baseVersion ? Date.parse(baseVersion) : null;
        if (baseTimeMs === null || isNaN(baseTimeMs)) baseTimeMs = null;
        
        const currentVersion = current.lastUpdateTime || null;
        const isFresh = baseTimeMs !== null && currentVersion !== null && Date.parse(currentVersion) <= baseTimeMs;
        
        const deletedIds = new Set(
            Array.isArray(incoming.deletedIds)
                ? incoming.deletedIds.filter(id => typeof id === 'string' && id)
                : []
        );
        if (deletedIds.size > 0) merge.recordDeletedPlayers([...deletedIds]);
        
        let merged;
        if (isFresh) {
            // No one else saved since this client's base - the snapshot is authoritative.
            merged = {
                groups: incoming.groups || current.groups || {},
                reserves: incoming.reserves || current.reserves || {},
                guildMembers: Array.isArray(incoming.guildMembers) ? incoming.guildMembers : (Array.isArray(current.guildMembers) ? current.guildMembers : [])
            };
        } else {
            merged = merge.mergeDatabase(current, incoming, deletedIds, baseTimeMs);
        }
        
        merged.guildName = typeof incoming.guildName === 'string' ? incoming.guildName : (current.guildName || 'Guild Name');
        // Announcement: accept object {text, author, timestamp} or legacy string
        if (incoming.announcement && typeof incoming.announcement === 'object') {
            merged.announcement = incoming.announcement;
        } else if (typeof incoming.announcement === 'string') {
            // Legacy string format from old clients — migrate on save
            merged.announcement = { text: incoming.announcement, author: '', timestamp: '' };
        } else {
            // Fallback: keep current announcement or default
            merged.announcement = (current.announcement && typeof current.announcement === 'object')
                ? current.announcement
                : { text: (typeof current.announcement === 'string' ? current.announcement : ''), author: '', timestamp: '' };
        }
        
        // Apply tombstoned deletes (matters for fresh replaces) and explicit
        // removals (moves / list removals) on top of the merge.
        merge.removeDeletedFromDb(merged, deletedIds);
        merge.applyRemovals(merged, incoming.removed);
        
        // Master-list integrity: backfill guildMembers[day] from that day's
        // groups+reserves so a stale snapshot or an older client can't leave
        // gaps in the master list.
        data.ensureMasterList(merged);
        
        // Phase 8.2: persist the tombstone ledger with every save so deletion
        // protection survives a server restart.
        merged.deletedPlayers = Object.fromEntries(merge.DELETED_PLAYERS);
        
        merged.lastUpdateTime = new Date().toISOString();
        
        if (data.writeDatabase(merged)) {
            sse.broadcastUpdate(merged.lastUpdateTime);
            res.json({ 
                success: true, 
                lastUpdate: merged.lastUpdateTime,
                message: 'Data saved successfully',
                data: merged
            });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    });

    // POST /api/register - Public self-registration (no auth)
    // Adds the player to guildMembers + reserves for the selected days only.
    // This is the ONLY public write path; it cannot modify groups, titles,
    // announcements, or any other data.
    app.post('/api/register', (req, res) => {
        const rl = rate.checkRateLimit('register:' + rate.clientIp(req), rate.REGISTER_MAX, rate.RATE_WINDOW_MS);
        if (!rl.allowed) {
            return res.status(429).json({ success: false, error: 'Too many registration attempts. Try again later.', retryAfter: rl.retryAfterSec });
        }

        const body = req.body || {};
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const cls = body.class;
        const days = Array.isArray(body.days) ? body.days : [];
        const validDays = ['sat', 'sun'];
        const validClasses = ['Tank', 'DPS', 'Heal'];
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Please enter a name.' });
        }
        if (name.length > 20) {
            return res.status(400).json({ success: false, error: 'Name must be 20 characters or less.' });
        }
        if (/[<>]/.test(name)) {
            return res.status(400).json({ success: false, error: 'Name contains invalid characters.' });
        }
        if (!validClasses.includes(cls)) {
            return res.status(400).json({ success: false, error: 'Invalid class.' });
        }
        
        const requested = days.filter(d => validDays.includes(d));
        if (requested.length === 0) {
            return res.status(400).json({ success: false, error: 'Please select at least one day.' });
        }
        
        const db = data.readDatabase();
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!Array.isArray(db.guildMembers)) db.guildMembers = [];
        if (!db.reserves) db.reserves = {};
        
        const playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const player = { id: playerId, name: name, class: cls, role: 'Member' };
        let added = 0;
        const skipped = [];
        
        // Phase 13: guildMembers is a flat array - add player once (if not already present)
        const gmExists = db.guildMembers.some(p => p && p.name === name && p.class === cls);
        if (!gmExists) {
            db.guildMembers.push({ ...player });
        }
        
        requested.forEach(day => {
            if (!Array.isArray(db.reserves[day])) db.reserves[day] = [];
            
            if (gmExists) {
                skipped.push(day);
                return;
            }
            db.reserves[day].push({ ...player });
            added++;
        });
        
        db.lastUpdateTime = new Date().toISOString();
        
        if (!data.writeDatabase(db)) {
            return res.status(500).json({ success: false, error: 'Failed to save data' });
        }
        
        sse.broadcastUpdate(db.lastUpdateTime);
        
        if (added > 0) {
            history.appendHistory({
                action: 'add',
                playerId: playerId,
                playerName: name,
                to: 'guild + reserves',
                day: requested[0],
                details: name + ' (' + cls + '/Member) registered for ' + requested.map(d => d === 'sat' ? 'Saturday' : 'Sunday').join(' & ')
            });
        }
        
        res.json({
            success: true,
            added: added,
            skipped: skipped,
            player: added > 0 ? player : null,
            lastUpdate: db.lastUpdateTime,
            data: db
        });
    });

    // POST /api/guild/name - Update guild name (mod+)
    app.post('/api/guild/name', auth.requireAuth, (req, res) => {
        const { name } = req.body;
        const db = data.readDatabase();
        
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        db.guildName = name;
        db.lastUpdateTime = new Date().toISOString();
        
        if (data.writeDatabase(db)) {
            sse.broadcastUpdate(db.lastUpdateTime);
            res.json({ success: true, guildName: name });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save' });
        }
    });

    // POST /api/groups/add - Add a new group (moderator)
    app.post('/api/groups/add', auth.requireAuth, (req, res) => {
        const { day, groupKey, title } = req.body;
        const db = data.readDatabase();
        const authConfig = auth.readAuthConfig();
        
        if (!db || !authConfig) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!db.groups[day]) {
            return res.status(400).json({ success: false, error: 'Invalid day' });
        }

        const maxGroups = authConfig.settings.maxGroups || 6;
        const currentGroups = Object.keys(db.groups[day]).length;
        
        if (currentGroups >= maxGroups) {
            return res.status(400).json({ 
                success: false, 
                error: `Maximum ${maxGroups} groups allowed` 
            });
        }

        if (db.groups[day][groupKey]) {
            return res.status(400).json({ success: false, error: 'Group already exists' });
        }

        db.groups[day][groupKey] = { title: title || groupKey, players: [] };
        db.lastUpdateTime = new Date().toISOString();
        
        if (data.writeDatabase(db)) {
            sse.broadcastUpdate(db.lastUpdateTime);
            res.json({ 
                success: true, 
                message: `Group ${title || groupKey} added`,
                group: db.groups[day][groupKey]
            });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save' });
        }
    });

    // POST /api/groups/remove - Remove a group (moderator)
    app.post('/api/groups/remove', auth.requireAuth, (req, res) => {
        const { day, groupKey } = req.body;
        const db = data.readDatabase();
        
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!db.groups[day] || !db.groups[day][groupKey]) {
            return res.status(404).json({ success: false, error: 'Group not found' });
        }

        if (db.groups[day][groupKey].players.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot remove group with players. Move players first.' 
            });
        }

        delete db.groups[day][groupKey];
        db.lastUpdateTime = new Date().toISOString();
        
        if (data.writeDatabase(db)) {
            sse.broadcastUpdate(db.lastUpdateTime);
            res.json({ success: true, message: 'Group removed' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save' });
        }
    });

    // GET /api/groups/config - Get group configuration
    app.get('/api/groups/config', (req, res) => {
        const db = data.readDatabase();
        const authConfig = auth.readAuthConfig();
        
        if (!db || !authConfig) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({
            maxGroups: authConfig.settings.maxGroups || 6,
            currentGroups: {
                sat: Object.keys(db.groups.sat).length,
                sun: Object.keys(db.groups.sun).length
            },
            groups: {
                sat: Object.keys(db.groups.sat),
                sun: Object.keys(db.groups.sun)
            }
        });
    });

    // POST /api/migrate-guild-members - Manual migration (admin only)
    app.post('/api/migrate-guild-members', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const db = data.readDatabase();
        if (!db) {
            return res.status(500).json({ success: false, error: 'Failed to read database' });
        }
        
        const result = data.migrateGuildMembers(db);
        
        if (data.writeDatabase(db)) {
            sse.broadcastUpdate(db.lastUpdateTime || new Date().toISOString());
            res.json({ 
                success: true, 
                message: `Migrated ${result.migrated} players to guildMembers`,
                migrated: result.migrated,
                totalPlayers: result.totalPlayers
            });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save database' });
        }
    });

    // GET /api/guild-members-status - Check if migration is needed
    app.get('/api/guild-members-status', (req, res) => {
        const db = data.readDatabase();
        if (!db) {
            return res.status(500).json({ error: 'Failed to read database' });
        }
        
        const needsMigration = data.needsGuildMembersMigration(db);
        const guildCount = Array.isArray(db.guildMembers) ? db.guildMembers.length : 0;
        
        // Count players in groups and reserves
        let groupCount = 0;
        let reserveCount = 0;
        const days = ['sat', 'sun'];
        const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
        
        days.forEach(day => {
            if (db.groups && db.groups[day]) {
                groupKeys.forEach(key => {
                    if (db.groups[day][key] && db.groups[day][key].players) {
                        groupCount += db.groups[day][key].players.length;
                    }
                });
            }
            if (db.reserves && db.reserves[day]) {
                reserveCount += db.reserves[day].length;
            }
        });
        
        res.json({
            needsMigration: needsMigration,
            guildMembersCount: guildCount,
            groupsCount: groupCount,
            reservesCount: reserveCount,
            totalPlayers: groupCount + reserveCount
        });
    });

    // GET /api/backup - Download backup (mod+)
    app.get('/api/backup', auth.requireAuth, (req, res) => {
        const db = data.readDatabase();
        if (db) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=guild-war-backup-${Date.now()}.json`);
            res.json(db);
        } else {
            res.status(500).json({ error: 'Failed to create backup' });
        }
    });

    // GET /api/health - Health check
    app.get('/api/health', (req, res) => {
        const db = data.readDatabase();
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            hasData: !!db,
            dataSize: db ? Object.keys(db).length : 0
        });
    });
};
