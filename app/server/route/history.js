// server/route/history.js - History API routes (Phase 11.1)

module.exports = function registerHistoryRoutes(app, ctx) {
    const { auth, history } = ctx;

    // GET /api/history - Get history entries
    app.get('/api/history', (req, res) => {
        const h = history.readHistory();
        res.json(h);
    });

    // POST /api/history - Add history entry (public - registrations also log here)
    app.post('/api/history', (req, res) => {
        const { action, playerId, playerName, from, to, day, field, oldValue, newValue, details, user } = req.body || {};
        
        if (history.appendHistory({ action, playerId, playerName, from, to, day, field, oldValue, newValue, details, user })) {
            const h = history.readHistory();
            res.json({ success: true, entry: h.entries[0] });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save history' });
        }
    });

    // POST /api/history/init - Initialize history file (mod+)
    app.post('/api/history/init', auth.requireAuth, (req, res) => {
        const defaultHistory = {
            entries: [],
            maxEntries: 100,
            lastCleared: null
        };
        
        try {
            history.writeHistory(defaultHistory);
            res.json({ success: true, message: 'History initialized' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // DELETE /api/history - Clear history (admin only)
    app.delete('/api/history', auth.requireAuth, auth.requireAdmin, (req, res) => {
        const h = history.readHistory();
        h.entries = [];
        h.lastCleared = new Date().toISOString();
        
        if (history.writeHistory(h)) {
            res.json({ success: true, message: 'History cleared' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to clear history' });
        }
    });
};
