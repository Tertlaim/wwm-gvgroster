// server/route/broadcast.js - GvG Broadcast config + manual push endpoints
//
// Secrets stay server-side: webhook URLs are written via the authed admin
// endpoint and every response masks them (host + path + last 4 of token).
// The full URL is never rendered into client state.

const broadcast = require('../integrations/broadcast');

module.exports = function registerBroadcastRoutes(app, ctx) {
    const { auth, data, broadcaster } = ctx;

    // Masked view shared by GET and POST responses.
    function publicConfig(cfg, status) {
        const base = broadcast.defaultIntegrationsConfig();
        const merged = { ...base, ...(cfg || {}) };
        merged.targets = { ...base.targets, ...((cfg && cfg.targets) || {}) };
        const targets = {};
        for (const key of broadcast.TARGET_KEYS) {
            const t = merged.targets[key] || base.targets[key];
            targets[key] = {
                enabled: !!t.enabled,
                mode: broadcast.TARGET_MODES.includes(t.mode) ? t.mode : 'auto',
                hasWebhook: !!t.webhookUrl,
                webhookMasked: broadcast.maskWebhookUrl(t.webhookUrl),
                satMessageId: t.satMessageId || null,
                sunMessageId: t.sunMessageId || null,
                status: status ? status[key] : null
            };
        }
        return {
            success: true,
            debounceSec: merged.debounceSec,
            autoIntervalMin: merged.autoIntervalMin,
            targets
        };
    }

    // GET /api/broadcast/config - masked config + live status (mod+)
    app.get('/api/broadcast/config', auth.requireAuth, async (req, res) => {
        try {
            const cfg = await data.readIntegrations();
            res.json(publicConfig(cfg, broadcaster ? broadcaster.getStatus() : null));
        } catch (e) {
            res.status(500).json({ success: false, error: 'Failed to load broadcast config' });
        }
    });

    // POST /api/broadcast/config - update targets/timings (admin only).
    // webhookUrl semantics: omitted -> unchanged; '' -> clear; otherwise a
    // host-pinned https URL. Changing or clearing the URL invalidates any
    // stored message ids (they belong to the old webhook's message).
    app.post('/api/broadcast/config', auth.requireAuth, auth.requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const current = (await data.readIntegrations()) || broadcast.defaultIntegrationsConfig();
            const next = broadcast.defaultIntegrationsConfig();

            const clampNum = (value, lo, hi, fallback) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return fallback;
                return Math.min(hi, Math.max(lo, n));
            };
            next.debounceSec = clampNum(body.debounceSec ?? current.debounceSec, 10, 600, 75);
            next.autoIntervalMin = clampNum(body.autoIntervalMin ?? current.autoIntervalMin, 1, 180, 15);

            for (const key of broadcast.TARGET_KEYS) {
                const incoming = body.targets && body.targets[key];
                const cur = current.targets[key] || next.targets[key];
                const t = next.targets[key];

                t.enabled = incoming && typeof incoming.enabled === 'boolean'
                    ? incoming.enabled
                    : !!cur.enabled;

                t.mode = incoming && broadcast.TARGET_MODES.includes(incoming.mode)
                    ? incoming.mode
                    : (broadcast.TARGET_MODES.includes(cur.mode)
                        ? cur.mode
                        : next.targets[key].mode); // platform default for legacy configs

                let url = cur.webhookUrl || '';
                if (incoming && typeof incoming.webhookUrl === 'string') {
                    const v = incoming.webhookUrl.trim();
                    if (v === '') {
                        url = '';
                    } else if (broadcast.isValidWebhookUrl(key, v)) {
                        url = v;
                    } else {
                        const shape = key === 'discord'
                            ? 'https://discord.com/api/webhooks/<id>/<token>'
                            : 'https://api.gamevox.com/webhooks/<id>/<token>';
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid ' + key + ' webhook URL (expected ' + shape + ')'
                        });
                    }
                }

                if (url !== (cur.webhookUrl || '')) {
                    t.satMessageId = null;
                    t.sunMessageId = null;
                } else {
                    t.satMessageId = cur.satMessageId || null;
                    t.sunMessageId = cur.sunMessageId || null;
                }
                t.webhookUrl = url;
            }

            const saved = await data.writeIntegrations(next);
            if (!saved) {
                return res.status(500).json({ success: false, error: 'Failed to save broadcast config' });
            }
            res.json(publicConfig(next, broadcaster ? broadcaster.getStatus() : null));
        } catch (e) {
            res.status(500).json({ success: false, error: 'Failed to save broadcast config' });
        }
    });

    // POST /api/broadcast/push - manual push now (mod+). Bypasses the auto
    // floor; per-target 30s cooldown and platform rate limits still apply.
    app.post('/api/broadcast/push', auth.requireAuth, async (req, res) => {
        if (!broadcaster) {
            return res.status(501).json({ success: false, error: 'Broadcast not available' });
        }
        const target = req.body && req.body.target;
        if (target && !broadcast.TARGET_KEYS.includes(target)) {
            return res.status(400).json({ success: false, error: 'Unknown target' });
        }
        try {
            const results = await broadcaster.pushNow(req.session.username, target || null);
            res.json({ success: true, results });
        } catch (e) {
            res.status(500).json({ success: false, error: 'Push failed' });
        }
    });
};
