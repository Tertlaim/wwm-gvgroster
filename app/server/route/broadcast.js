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
            const urls = Array.isArray(t.webhooks) && t.webhooks.length
                ? t.webhooks.filter(u => typeof u === 'string' && u)
                : (t.webhookUrl ? [t.webhookUrl] : []);
            const botToken = broadcast.effectiveBotToken(t);
            targets[key] = {
                enabled: !!t.enabled,
                mode: broadcast.TARGET_MODES.includes(t.mode) ? t.mode : 'auto',
                hasWebhook: urls.length > 0,
                webhookMasked: broadcast.maskWebhookUrl(urls[0]),
                webhooksMasked: urls.map(u => broadcast.maskWebhookUrl(u)),
                hasBotToken: Boolean(botToken),
                botTokenMasked: broadcast.maskBotToken(botToken),
                botChannels: broadcast.normalizeBotChannels(t),
                botPostMode: broadcast.BOT_POST_MODES.includes(t.botPostMode) ? t.botPostMode : 'fresh',
                siteLabel: typeof t.siteLabel === 'string' ? t.siteLabel : '',
                siteUrl: typeof t.siteUrl === 'string' ? t.siteUrl : '',
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

    // POST /api/broadcast/config - update targets/timings (SuperAdmin only;
    // admins/moderators get the Publish button, never the setup surface).
    // webhookUrl semantics: omitted -> unchanged; '' -> clear; otherwise a
    // host-pinned https URL. Changing or clearing the URL invalidates any
    // stored message ids (they belong to the old webhook's message).
    app.post('/api/broadcast/config', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
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

                // Channel list: incoming.webhooks (full replacement) wins;
                // legacy single webhookUrl still accepted. '' / [] clears.
                let nextUrls = null;
                if (incoming && Array.isArray(incoming.webhooks)) {
                    if (incoming.webhooks.length > broadcast.MAX_WEBHOOKS) {
                        return res.status(400).json({
                            success: false,
                            error: 'Too many ' + key + ' webhooks (max ' + broadcast.MAX_WEBHOOKS + ')'
                        });
                    }
                    nextUrls = [];
                    for (let i = 0; i < incoming.webhooks.length; i++) {
                        const v = String(incoming.webhooks[i] == null ? '' : incoming.webhooks[i]).trim();
                        if (!v) continue;
                        if (!broadcast.isValidWebhookUrl(key, v)) {
                            const shape = key === 'discord'
                                ? 'https://discord.com/api/webhooks/<id>/<token>'
                                : 'https://api.gamevox.com/webhooks/<id>/<token>';
                            return res.status(400).json({
                                success: false,
                                error: 'Invalid ' + key + ' webhook URL #' + (i + 1) + ' (expected ' + shape + ')'
                            });
                        }
                        if (!nextUrls.includes(v)) nextUrls.push(v);
                    }
                } else {
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
                    nextUrls = url ? [url] : [];
                }

                // Message ids belong to a specific channel URL: keep ids of
                // surviving URLs and mirror the first channel into the legacy
                // sat/sunMessageId fields so old configs keep round-tripping.
                const firstUnchanged = (nextUrls[0] || '') === (cur.webhookUrl || '');
                t.satMessageId = firstUnchanged ? (cur.satMessageId || null) : null;
                t.sunMessageId = firstUnchanged ? (cur.sunMessageId || null) : null;
                const curIds = cur.channelIds && typeof cur.channelIds === 'object' ? cur.channelIds : {};
                t.channelIds = {};
                for (const u of nextUrls) {
                    if (!t.channelIds[u]) {
                        t.channelIds[u] = u === cur.webhookUrl
                            ? { satMessageId: t.satMessageId, sunMessageId: t.sunMessageId }
                            : (curIds[u] || { satMessageId: null, sunMessageId: null });
                    }
                }
                t.webhooks = nextUrls;
                t.webhookUrl = nextUrls[0] || '';

                // ---- GameVox bot (live) path ----
                // botToken: omitted -> unchanged; '' -> clear; else GVB.… shape.
                if (key === 'gamevox') {
                    let botToken = cur.botToken || '';
                    if (incoming && typeof incoming.botToken === 'string') {
                        const v = incoming.botToken.trim();
                        if (v === '') {
                            botToken = '';
                        } else if (broadcast.isValidBotToken(v)) {
                            botToken = v;
                        } else {
                            return res.status(400).json({
                                success: false,
                                error: 'Invalid GameVox bot token (expected GVB.… from developers.gamevox.com)'
                            });
                        }
                    }
                    t.botToken = botToken;

                    // Channels: full replacement; '' / [] clears; snowflakes only.
                    let botChannels = broadcast.normalizeBotChannels(cur);
                    if (incoming && Array.isArray(incoming.botChannels)) {
                        if (incoming.botChannels.length > broadcast.MAX_WEBHOOKS) {
                            return res.status(400).json({
                                success: false,
                                error: 'Too many GameVox bot channels (max ' + broadcast.MAX_WEBHOOKS + ')'
                            });
                        }
                        botChannels = [];
                        for (const raw of incoming.botChannels) {
                            const v = String(raw == null ? '' : raw).trim();
                            if (!v) continue;
                            if (!/^\d{5,}$/.test(v)) {
                                return res.status(400).json({
                                    success: false,
                                    error: 'Invalid GameVox bot channel id "' + v.slice(0, 24) + '" (expected the numeric channel snowflake)'
                                });
                            }
                            if (!botChannels.includes(v)) botChannels.push(v);
                        }
                    }
                    t.botChannels = botChannels;

                    t.botPostMode = incoming && broadcast.BOT_POST_MODES.includes(incoming.botPostMode)
                        ? incoming.botPostMode
                        : (broadcast.BOT_POST_MODES.includes(cur.botPostMode) ? cur.botPostMode : 'fresh');

                    // Site branding behind the timestamp (-@Label link).
                    // Omitted -> unchanged; '' -> clear; url must be http(s).
                    t.siteLabel = incoming && typeof incoming.siteLabel === 'string'
                        ? incoming.siteLabel.trim().slice(0, 40)
                        : (typeof cur.siteLabel === 'string' ? cur.siteLabel : '');
                    if (incoming && typeof incoming.siteUrl === 'string') {
                        const v = incoming.siteUrl.trim();
                        if (v === '') {
                            t.siteUrl = '';
                        } else if (/^https?:\/\/\S+$/.test(v)) {
                            t.siteUrl = v;
                        } else {
                            return res.status(400).json({
                                success: false,
                                error: 'Invalid site URL (must start with http:// or https://)'
                            });
                        }
                    } else {
                        t.siteUrl = typeof cur.siteUrl === 'string' ? cur.siteUrl : '';
                    }

                    // Stored bot message ids belong to (token, channel): drop
                    // ids of removed channels, and everything on token rotate.
                    const tokenChanged = botToken !== (cur.botToken || '');
                    for (const k of Object.keys(t.channelIds)) {
                        if (!k.startsWith('bot:')) continue;
                        if (tokenChanged || !botChannels.includes(k.slice(4))) {
                            delete t.channelIds[k];
                        }
                    }
                }
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

    // GET /api/broadcast/preview - build-only dry run (mod+). Renders the
    // exact plain-markdown day texts the bot/webhook would send, without any
    // cooldown or HTTP delivery. Null day = empty roster = nothing to send.
    app.get('/api/broadcast/preview', auth.requireAuth, async (req, res) => {
        try {
            const db = await data.readDatabase();
            if (!db) {
                return res.status(500).json({ success: false, error: 'Roster data unavailable' });
            }
            const actor = (req.session && req.session.username) || 'staff';
            let site = {};
            try {
                const cfg = await data.readIntegrations();
                const gv = cfg && cfg.targets && cfg.targets.gamevox;
                if (gv) site = { siteLabel: gv.siteLabel, siteUrl: gv.siteUrl };
            } catch (e) { /* branding is optional for preview */ }
            const days = {};
            for (const day of broadcast.DAY_KEYS) {
                days[day] = broadcast.buildDayText(db, day, { updatedBy: actor, ...site });
            }
            res.json({ success: true, days });
        } catch (e) {
            res.status(500).json({ success: false, error: 'Preview failed' });
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
