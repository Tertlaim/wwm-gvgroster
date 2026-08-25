// server/route/broadcast.js - GvG Broadcast config + manual push endpoints
//
// Secrets stay server-side: webhook URLs are written via the authed admin
// endpoint and every response masks them (host + path + last 4 of token).
// The full URL is never rendered into client state.

const broadcast = require('../integrations/broadcast');

// ---- Auto-generated site link ----
// The -@label behind the timestamp points at wherever the publish request
// came from. Behind proxies (Render) the forwarded headers carry the real
// public origin; direct local calls resolve to localhost and are ignored so
// dev pushes never stamp a useless link into chat.

function originFromReq(req) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
    const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() || (req.get ? req.get('host') : '');
    if (!host) return '';
    return proto + '://' + host;
}

function isPublicOrigin(origin) {
    let hostname;
    try {
        hostname = new URL(origin).hostname.toLowerCase();
    } catch (e) {
        return false;
    }
    if (hostname === 'localhost' || hostname.endsWith('.local')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false; // any IPv4 literal
    if (hostname.startsWith('[')) return false;                 // IPv6 literal
    return true;
}

// Readable link label from the host: wwm-gvgroster.onrender.com -> wwm-gvgroster
function labelFromOrigin(origin) {
    try {
        return new URL(origin).hostname.replace(/^www\./i, '').split('.')[0];
    } catch (e) {
        return '';
    }
}

// Plain-text tag for pushes with no public origin: manual local pushes and
// origin-less auto-pushes before the first public one is learned.
const LOCAL_SITE = { siteUrl: '', siteLabel: 'Local Test' };

module.exports = function registerBroadcastRoutes(app, ctx) {
    const { auth, data, broadcaster, botFetch } = ctx;

    // Masked view shared by GET and POST responses. The SuperAdmin also gets
    // the raw values back so the inline forms can show what is saved; other
    // roles keep masked-only output.
    function publicConfig(cfg, status, viewerRole) {
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
            const view = {
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
            if (viewerRole === 'superadmin') {
                // Inline-edit forms render these directly.
                view.botToken = botToken;
                view.webhooks = urls;
            }
            targets[key] = view;
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
            res.json(publicConfig(cfg, broadcaster ? broadcaster.getStatus() : null, req.session.role));
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

                if (key === 'discord') {
                    // Discord target: classic incoming-webhook configuration
                    // (dormant feature, kept for the future Discord rollout).
                    let url = cur.webhookUrl || '';
                    if (incoming && typeof incoming.webhookUrl === 'string') {
                        const v = incoming.webhookUrl.trim();
                        if (v === '') {
                            url = '';
                        } else if (broadcast.isValidWebhookUrl(key, v)) {
                            url = v;
                        } else {
                            return res.status(400).json({
                                success: false,
                                error: 'Invalid discord webhook URL (expected https://discord.com/api/webhooks/<id>/<token>)'
                            });
                        }
                    }

                    let nextUrls = null;
                    if (incoming && Array.isArray(incoming.webhooks)) {
                        if (incoming.webhooks.length > broadcast.MAX_WEBHOOKS) {
                            return res.status(400).json({
                                success: false,
                                error: 'Too many discord webhooks (max ' + broadcast.MAX_WEBHOOKS + ')'
                            });
                        }
                        nextUrls = [];
                        for (let i = 0; i < incoming.webhooks.length; i++) {
                            const v = String(incoming.webhooks[i] == null ? '' : incoming.webhooks[i]).trim();
                            if (!v) continue;
                            if (!broadcast.isValidWebhookUrl(key, v)) {
                                return res.status(400).json({
                                    success: false,
                                    error: 'Invalid discord webhook URL #' + (i + 1) + ' (expected https://discord.com/api/webhooks/<id>/<token>)'
                                });
                            }
                            if (!nextUrls.includes(v)) nextUrls.push(v);
                        }
                    } else {
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
                } else {
                    // GameVox webhooks were removed entirely - the bot path
                    // replaced them. Reject configuration attempts and scrub
                    // any legacy values still lingering in storage.
                    if (incoming && (incoming.webhookUrl !== undefined || incoming.webhooks !== undefined)) {
                        return res.status(400).json({
                            success: false,
                            error: 'GameVox webhooks were removed - configure bot channels instead'
                        });
                    }
                    t.webhooks = [];
                    t.webhookUrl = '';
                    t.satMessageId = null;
                    t.sunMessageId = null;
                    const curIdsAll = cur.channelIds && typeof cur.channelIds === 'object' ? cur.channelIds : {};
                    t.channelIds = {};
                    for (const [k, v] of Object.entries(curIdsAll)) {
                        if (k.startsWith('bot:')) t.channelIds[k] = v;
                    }
                }

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

                    // Channels: full replacement; '' / [] clears. Accepts the
                    // numeric snowflake OR the UUID from Channel Settings -
                    // UUIDs are translated to snowflakes via the bot API so
                    // stored config is always in the resolvable format.
                    let botChannels = broadcast.normalizeBotChannels(cur);
                    if (incoming && Array.isArray(incoming.botChannels)) {
                        if (incoming.botChannels.length > broadcast.MAX_WEBHOOKS) {
                            return res.status(400).json({
                                success: false,
                                error: 'Too many GameVox bot channels (max ' + broadcast.MAX_WEBHOOKS + ')'
                            });
                        }
                        botChannels = [];
                        const pending = [];
                        for (const raw of incoming.botChannels) {
                            const v = String(raw == null ? '' : raw).trim();
                            if (!v) continue;
                            if (!broadcast.isValidChannelId(v) && !broadcast.UUID_RE.test(v)) {
                                return res.status(400).json({
                                    success: false,
                                    error: 'Invalid GameVox bot channel id "' + v.slice(0, 24) + '" (numeric ID or the UUID from Channel Settings)'
                                });
                            }
                            if (!pending.includes(v)) pending.push(v);
                        }
                        if (pending.length) {
                            const lookupToken = (typeof botToken === 'string' && botToken) || process.env.GAMEVOX_BOT_TOKEN || '';
                            if (!lookupToken) {
                                botChannels = pending.filter(v => broadcast.isValidChannelId(v));
                            } else {
                                let resolved;
                                try {
                                    resolved = await broadcast.resolveChannelIds(lookupToken, pending, botFetch);
                                } catch (e) {
                                    return res.status(400).json({
                                        success: false,
                                        error: 'Could not look up channels: ' + e.message
                                    });
                                }
                                if (resolved.unknown.length) {
                                    return res.status(400).json({
                                        success: false,
                                        error: 'Unknown channel(s): ' + resolved.unknown.join(', ') +
                                            ' - install the bot on that server first (Setup guide, step 4)'
                                    });
                                }
                                botChannels = resolved.ids;
                            }
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
            res.json(publicConfig(next, broadcaster ? broadcaster.getStatus() : null, req.session.role));
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
            // Preview mirrors a manual publish: public request origin when
            // available, otherwise the Local Test tag. The stored origin is
            // only consumed by interval auto-pushes.
            const origin = originFromReq(req);
            const site = isPublicOrigin(origin)
                ? { siteUrl: origin, siteLabel: labelFromOrigin(origin) }
                : LOCAL_SITE;
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
        // Site link reflects where THIS push came from. A public origin rides
        // along with the push AND is persisted so the interval auto-push (no
        // request context) keeps using it later. Local pushes are tagged
        // "Local Test" and never touch storage.
        const origin = originFromReq(req);
        const site = isPublicOrigin(origin)
            ? { siteUrl: origin, siteLabel: labelFromOrigin(origin) }
            : LOCAL_SITE;
        if (isPublicOrigin(origin)) {
            try {
                const cfg = await data.readIntegrations();
                const gv = cfg && cfg.targets && cfg.targets.gamevox;
                if (gv && (gv.siteUrl !== site.siteUrl || gv.siteLabel !== site.siteLabel)) {
                    gv.siteUrl = site.siteUrl;
                    gv.siteLabel = site.siteLabel;
                    await data.writeIntegrations(cfg);
                }
            } catch (e) { /* persistence is best-effort */ }
        }
        try {
            const results = await broadcaster.pushNow(req.session.username, target || null, { site });
            res.json({ success: true, results });
        } catch (e) {
            res.status(500).json({ success: false, error: 'Push failed' });
        }
    });
};
