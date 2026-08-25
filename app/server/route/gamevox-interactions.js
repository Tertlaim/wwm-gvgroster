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

    function verifySignature(req) {
        if (!verifiedKey) return false;
        const sig = String(req.headers['x-signature-ed25519'] || '');
        const ts = String(req.headers['x-signature-timestamp'] || '');
        if (!/^[0-9a-f]{128}$/i.test(sig) || !/^\d+$/.test(ts)) return false;
        // Replay guard: refuse timestamps older than 10 minutes.
        if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
        try {
            const msg = Buffer.concat([Buffer.from(ts), req.rawBody || Buffer.alloc(0)]);
            return crypto.verify(null, msg, verifiedKey, Buffer.from(sig, 'hex'));
        } catch (e) {
            return false;
        }
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

        // Application command.
        if (body.type === 2 && body.data && body.data.name === 'publish') {
            const member = body.member || {};
            const user = (member.user || body.user || {});
            const actor = member.nick || user.username || user.global_name || 'gamevox';
            const perms = BigInt(member.permissions || '0');
            const daysOpt = (body.data.options || []).find(o => o.name === 'days');
            const days = daysOpt && ['sat', 'sun'].includes(daysOpt.value)
                ? [daysOpt.value]
                : broadcast.DAY_KEYS.slice();

            if (!(perms & MANAGE_MESSAGES) && !(perms & (1n << 3n))) { // ManageMessages | Administrator
                return res.json({
                    type: 4,
                    data: {
                        content: 'Only moderators and admins can publish the roster.',
                        flags: EPHEMERAL
                    }
                });
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
                return res.json({
                    type: 4,
                    data: { content: 'Nothing to publish - both rosters are empty.', flags: EPHEMERAL }
                });
            }

            // Defer now ("thinking..."), deliver content as followups right
            // after. Followup messages render as part of this interaction.
            res.json({ type: 5 });

            const itToken = body.token;
            for (const text of texts) {
                for (const chunk of broadcast.splitForChat(text, FOLLOWUP_MAX)) {
                    try {
                        const r = await doFetch(
                            `https://bot-api.gamevox.com/api/v10/webhooks/${appId}/${itToken}?wait=true`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: chunk }),
                                signal: AbortSignal.timeout(15000)
                            });
                        if (!r.ok) console.error('[gamevox-interactions] followup failed:', r.status);
                    } catch (e) {
                        console.error('[gamevox-interactions] followup error:', e.message);
                    }
                }
            }
            return undefined;
        }

        return res.status(400).json({ error: 'unknown interaction type' });
    });
};
