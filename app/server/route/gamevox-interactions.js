// GameVox Interactions endpoint (HTTP-mode, Discord-compatible).
//
// GameVox POSTs every slash-command invocation here with an Ed25519
// signature over "<timestamp><rawBody>" (headers: X-Signature-Ed25519 /
// X-Signature-Timestamp). The /gvg command replies with a deferred
// acknowledgment and then delivers the Saturday/Sunday roster as interaction
// followups - which the invoking client renders immediately, giving the
// publisher instant visual confirmation (the REST push path lacked this on
// GameVox clients; live-tested 2026-08-25).
//
// The Ed25519 PUBLIC key is a public identifier: SuperAdmins store it in the
// panel (per-application), with the built-in default as fallback. It also
// exposes setup-status probes and a remove-from-server action so a bot can
// be remade without touching the GameVox client.
//
// Delivery note: followups land in the channel where /gvg was invoked -
// there is no configured channel list by design (D1-a decision, 2026-08-26).

const crypto = require('crypto');

const DEFAULT_PUBLIC_KEY = '212030ed4e13c365be8daaa1f71f65ce4021ef477e27e756975e3e71ed181dc9';
const DEFAULT_APP_ID = '1541027880090140673';
const GVG_COOLDOWN_MS = 30 * 1000;
const MANAGE_MESSAGES = 0x2000n;
const ADMINISTRATOR = 1n << 3n;
const EPHEMERAL = 1 << 6;
const FOLLOWUP_MAX = 1900;

function publicKeyObject(hex) {
    const raw = Buffer.from(hex, 'hex');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

module.exports = function registerGamevoxInteractions(app, ctx) {
    const { data, broadcast, botFetch, auth } = ctx;
    const doFetch = botFetch || ((url, opts) => globalThis.fetch(url, opts));
    const fallbackKey = process.env.GAMEVOX_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    const appId = process.env.GAMEVOX_APP_ID || DEFAULT_APP_ID;

    // Public key resolution: panel-stored value wins over the built-in
    // default so remade applications never need a code change.
    async function currentPublicKey() {
        try {
            const cfg = await data.readIntegrations();
            const k = cfg && cfg.targets && cfg.targets.gamevox &&
                typeof cfg.targets.gamevox.publicKey === 'string'
                ? cfg.targets.gamevox.publicKey.trim()
                : '';
            if (/^[0-9a-f]{64}$/i.test(k)) return k;
        } catch (e) { /* fall through to default */ }
        return fallbackKey;
    }

    function verifySignature(req, keyHex) {
        let key;
        try {
            key = publicKeyObject(keyHex);
        } catch (e) {
            return false;
        }
        const sig = String(req.headers['x-signature-ed25519'] || '');
        const ts = String(req.headers['x-signature-timestamp'] || '');
        if (!/^[0-9a-f]{128}$/i.test(sig) || !/^\d+$/.test(ts)) return false;
        // Replay guard: refuse timestamps older than 10 minutes. (Cold starts
        // delay execution by <=~60s, far inside this window.)
        if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
        try {
            const msg = Buffer.concat([Buffer.from(ts), req.rawBody || Buffer.alloc(0)]);
            return crypto.verify(null, msg, key, Buffer.from(sig, 'hex'));
        } catch (e) {
            return false;
        }
    }

    async function postFollowup(interactionToken, content, flags) {
        try {
            const r = await doFetch(
                `https://bot-api.gamevox.com/api/v10/webhooks/${appId}/${interactionToken}?wait=true`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(flags ? { content, flags } : { content }),
                    signal: AbortSignal.timeout(15000)
                });
            if (!r.ok) console.error('[gamevox-interactions] followup failed:', r.status);
            return r.ok;
        } catch (e) {
            console.error('[gamevox-interactions] followup error:', e.message);
            return false;
        }
    }

    // True when this interaction sat queued while the instance woke from
    // sleep: the 3s callback window is long gone, so immediate replies would
    // vanish. Everything must go out as followups instead (tokens live 15min).
    function isLate(req) {
        const ts = Number(req.headers['x-signature-timestamp'] || 0);
        return ts > 0 && (Date.now() / 1000 - ts) > 10;
    }

    let lastGvgAt = 0; // global cooldown - rosters are rare, bursts are noise

    app.post('/api/gamevox/interactions', async (req, res) => {
        const keyHex = await currentPublicKey();
        if (!verifySignature(req, keyHex)) {
            return res.status(401).json({ error: 'invalid signature' });
        }
        const body = req.body || {};

        // Portal verification handshake.
        if (body.type === 1) {
            return res.json({ type: 1 });
        }

        // Application command (/gvg).
        if (body.type === 2 && body.data && body.data.name === 'gvg') {
            const member = body.member || {};
            const user = (member.user || body.user || {});
            const actor = member.nick || user.username || user.global_name || 'gamevox';
            const perms = BigInt(member.permissions || '0');
            const daysOpt = (body.data.options || []).find(o => o.name === 'days');
            const days = daysOpt && ['sat', 'sun'].includes(daysOpt.value)
                ? [daysOpt.value]
                : broadcast.DAY_KEYS.slice();
            const late = isLate(req);

            if (!(perms & MANAGE_MESSAGES) && !(perms & ADMINISTRATOR)) {
                const denial = {
                    type: 4,
                    data: {
                        content: 'Only moderators and admins can publish the roster.',
                        flags: EPHEMERAL
                    }
                };
                if (!late) return res.json(denial);
                res.status(200).json({});
                await postFollowup(body.token, denial.data.content, denial.data.flags);
                return undefined;
            }

            // Global cooldown: one publisher at a time keeps channel noise
            // down while the no-whitelist model settles in (D1-a, 2026-08-26).
            const waitMs = GVG_COOLDOWN_MS - (Date.now() - lastGvgAt);
            if (waitMs > 0) {
                const busy = {
                    type: 4,
                    data: {
                        content: `A roster was just published - try again in ${Math.ceil(waitMs / 1000)}s.`,
                        flags: EPHEMERAL
                    }
                };
                if (!late) return res.json(busy);
                res.status(200).json({});
                await postFollowup(body.token, busy.data.content, busy.data.flags);
                return undefined;
            }

            // Build before deferring so an empty roster answers instantly.
            let db;
            try {
                db = await data.readDatabase();
            } catch (e) {
                db = null;
            }
            let site = {};
            try {
                const cfg = await data.readIntegrations();
                const gv = cfg && cfg.targets && cfg.targets.gamevox;
                if (gv) site = { siteLabel: gv.siteLabel, siteUrl: gv.siteUrl };
            } catch (e) { /* branding optional */ }
            const texts = [];
            for (const day of days) {
                const t = db ? broadcast.buildDayText(db, day, { updatedBy: actor, ...site }) : null;
                if (t) texts.push(t);
            }

            if (texts.length === 0) {
                const empty = {
                    type: 4,
                    data: { content: 'Nothing to publish - both rosters are empty.', flags: EPHEMERAL }
                };
                if (!late) return res.json(empty);
                res.status(200).json({});
                await postFollowup(body.token, empty.data.content, empty.data.flags);
                return undefined;
            }

            lastGvgAt = Date.now();

            if (!late) {
                // Warm path: acknowledge within the callback window ("thinking..."),
                // deliver content as followups right after.
                res.json({ type: 5 });
            } else {
                // Cold start: GameVox already showed the failure and
                // abandoned the callback. Deliver everything as followups,
                // leading with the wake-up explanation + website link.
                res.status(200).json({});
                const siteUrl = (site.siteUrl || '').trim() || 'https://wwm-gvgroster.onrender.com';
                await postFollowup(body.token,
                    `Interaction failed, wait 60s to wake server.\n` +
                    `Roster follows below. Instant alternative: ${siteUrl}`);
            }

            for (const text of texts) {
                for (const chunk of broadcast.splitForChat(text, FOLLOWUP_MAX)) {
                    await postFollowup(body.token, chunk);
                }
            }
            return undefined;
        }

        return res.status(400).json({ error: 'unknown interaction type' });
    });

    // ---- Setup helpers (SuperAdmin only) ----

    function botTokenFrom(cfg) {
        const t = cfg && cfg.targets && cfg.targets.gamevox;
        const fromConfig = t && typeof t.botToken === 'string' ? t.botToken.trim() : '';
        return fromConfig || String(process.env.GAMEVOX_BOT_TOKEN || '').trim();
    }

    // Live connectivity check: validates the stored token and lists which
    // servers the bot is installed on. Drives both the "Test connection"
    // button and the remove-bot server dropdown.
    app.get('/api/gamevox/setup/status', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        const out = { tokenOk: false, botUser: null, guilds: [], errors: [], publicKeySet: false };
        try {
            const cfg = await data.readIntegrations();
            const k = cfg && cfg.targets && cfg.targets.gamevox &&
                typeof cfg.targets.gamevox.publicKey === 'string'
                ? cfg.targets.gamevox.publicKey.trim()
                : '';
            out.publicKeySet = /^[0-9a-f]{64}$/i.test(k);
        } catch (e) { /* ignore */ }

        let token = '';
        try {
            const cfg = await data.readIntegrations();
            token = botTokenFrom(cfg);
        } catch (e) { /* ignore */ }
        if (!token) {
            out.errors.push('No bot token saved - paste it above first.');
            return res.json({ success: true, ...out });
        }

        try {
            const meRes = await doFetch('https://bot-api.gamevox.com/api/v10/users/@me', {
                headers: { Authorization: 'Bot ' + token },
                signal: AbortSignal.timeout(15000)
            });
            if (!meRes.ok) {
                out.errors.push('Token rejected by GameVox (' + meRes.status + ') - regenerate it in the portal.');
                return res.json({ success: true, ...out });
            }
            out.tokenOk = true;
            out.botUser = await meRes.json();

            const gRes = await doFetch('https://bot-api.gamevox.com/api/v10/users/@me/guilds', {
                headers: { Authorization: 'Bot ' + token },
                signal: AbortSignal.timeout(15000)
            });
            if (gRes.ok) {
                out.guilds = (await gRes.json()).map(g => ({ id: g.id, name: g.name }));
            } else {
                out.errors.push('Could not list servers (' + gRes.status + ').');
            }
        } catch (e) {
            out.errors.push('Network error contacting GameVox: ' + e.message);
        }
        res.json({ success: true, ...out });
    });

    // Remove the bot from ONE server. Tries the self-leave API first; when
    // the platform refuses (404 today), returns manual client instructions.
    app.post('/api/gamevox/setup/leave', auth.requireAuth, auth.requireSuperAdmin, async (req, res) => {
        const guildId = String((req.body && req.body.guildId) || '').trim();
        if (!/^\d{5,}$/.test(guildId)) {
            return res.status(400).json({ success: false, error: 'Invalid guild id' });
        }
        let token = '';
        try {
            token = botTokenFrom(await data.readIntegrations());
        } catch (e) { /* ignore */ }
        if (!token) {
            return res.status(400).json({ success: false, error: 'No bot token saved' });
        }
        try {
            const r = await doFetch(
                `https://bot-api.gamevox.com/api/v10/users/@me/guilds/${guildId}`,
                {
                    method: 'DELETE',
                    headers: { Authorization: 'Bot ' + token },
                    signal: AbortSignal.timeout(15000)
                });
            if (r.ok || r.status === 204) {
                return res.json({ success: true, removed: true });
            }
            return res.json({
                success: true,
                removed: false,
                manual: true,
                status: r.status,
                steps: [
                    'Open your GameVox server → Server Settings → Integrations.',
                    `Under Bots and Apps, find ${'wwm_gvg_roster'} and choose Uninstall Application.`,
                    'Reinstall any time via the OAuth2 install link (Setup guide, step 4).'
                ]
            });
        } catch (e) {
            res.status(500).json({ success: false, error: 'Network error: ' + e.message });
        }
    });
};
