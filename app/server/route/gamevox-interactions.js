// GameVox Interactions endpoint (HTTP-mode, Discord-compatible).
//
// GameVox POSTs every slash-command invocation here with an Ed25519
// signature over "<timestamp><rawBody>" (headers: X-Signature-Ed25519 /
// X-Signature-Timestamp). The /publish command replies with a deferred
// acknowledgment and then delivers the Saturday/Sunday roster as interaction
// followups - which the invoking client renders immediately, giving the
// publisher instant visual confirmation (the REST push path lacks this on
// GameVox clients; live-tested 2026-08-25).
//
// Public key + app id are public identifiers (they appear in install URLs);
// env overrides exist for multi-instance setups but are not secrets.

const crypto = require('crypto');

const DEFAULT_PUBLIC_KEY = '212030ed4e13c365be8daaa1f71f65ce4021ef477e27e756975e3e71ed181dc9';
const DEFAULT_APP_ID = '1541027880090140673';
const MANAGE_MESSAGES = 0x2000n;
const EPHEMERAL = 1 << 6;
const FOLLOWUP_MAX = 1900;

function publicKeyObject(hex) {
    const raw = Buffer.from(hex, 'hex');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

module.exports = function registerGamevoxInteractions(app, ctx) {
    const { data, broadcast, botFetch } = ctx;
    const doFetch = botFetch || ((url, opts) => globalThis.fetch(url, opts));
    const publicKeyHex = process.env.GAMEVOX_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    const appId = process.env.GAMEVOX_APP_ID || DEFAULT_APP_ID;

    let verifiedKey = null;
    try {
        verifiedKey = publicKeyObject(publicKeyHex);
    } catch (e) {
        console.error('[gamevox-interactions] bad GAMEVOX_PUBLIC_KEY:', e.message);
    }

    // Interaction followup: valid for 15 minutes after the command ran,
    // independent of the 3s callback window.
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

    function verifySignature(req) {
        if (!verifiedKey) return false;
        const sig = String(req.headers['x-signature-ed25519'] || '');
        const ts = String(req.headers['x-signature-timestamp'] || '');
        if (!/^[0-9a-f]{128}$/i.test(sig) || !/^\d+$/.test(ts)) return false;
        // Replay guard: refuse timestamps older than 10 minutes. (Cold starts
        // delay execution by <=~60s, far inside this window.)
        if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
        try {
            const msg = Buffer.concat([Buffer.from(ts), req.rawBody || Buffer.alloc(0)]);
            return crypto.verify(null, msg, verifiedKey, Buffer.from(sig, 'hex'));
        } catch (e) {
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

    app.post('/api/gamevox/interactions', async (req, res) => {
        if (!verifySignature(req)) {
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

            if (!(perms & MANAGE_MESSAGES) && !(perms & (1n << 3n))) { // ManageMessages | Administrator
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
};
