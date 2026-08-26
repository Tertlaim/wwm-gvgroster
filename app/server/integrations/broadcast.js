// server/integrations/broadcast.js - GvG Broadcast (Discord / GameVox webhooks)
//
// Pushes the Groups + Reserves panel content to one message per day per
// platform target, editing it in place (POST once, then PATCH the same
// message id). Zero new dependencies: native fetch only. GameVox app
// webhooks are Discord-v10 wire-compatible, so one module serves both
// platforms; only the base URL differs.
//
// Anti-blocking rules (plan: .kilo/plans/1787399880000-gvg-broadcast-plan.md):
//   1. Content-hash gate  - identical content never triggers a call
//   2. Debounce           - trailing-edge quiet window collapses bursts
//   3. Auto-push floor    - max 1 automatic push / target / N minutes
//   4. Manual throttle    - mod+ button bypasses the floor, own 30s cooldown
//   5. Edit-in-place      - repeat messages structurally impossible
//   6. 429 discipline     - honor Retry-After; circuit breaker on repeats

const crypto = require('crypto');

// Hard limits (admin-tunable windows live in the integrations config).
const MANUAL_COOLDOWN_MS = 30 * 1000;
const BREAKER_THRESHOLD = 5;
const BREAKER_PAUSE_MS = 30 * 60 * 1000;
const MIN_SPACING_MS = 1000; // <=~1 request/s per webhook
const MAX_429_WAIT_MS = 60 * 1000;
const MAX_WEBHOOKS = 5;      // channels a single target fans out to
const FETCH_TIMEOUT_MS = 15000; // hung platform must not hold the HTTP request

// Embed budget guards (platform limits: field value 1024 chars, 25 fields
// per embed, 6000 per message). Days go out as separate messages, so a
// full 30-player roster always fits without any "+N more" truncation.
const MAX_FIELD_CHARS = 1000;
const MAX_FIELD_LINES = 20;
const GROUP_CAP = 30;

const TARGET_KEYS = ['discord', 'gamevox'];
const DAY_KEYS = ['sat', 'sun'];
const DAY_LABELS = { sat: 'Saturday', sun: 'Sunday' };
const DAY_COLORS = { sat: 0xF1C40F, sun: 0x3498DB }; // gold=Sat, blue=Sun
const CLASS_EMOJI = { Tank: '🛡️', DPS: '⚔️', Heal: '🌿' };
// Full-width rule closing each day message - visually separates it from the
// next message in busy chat.
const FOOTER_RULE = '─'.repeat(28);

// Discord-compatible bot REST base (developers.gamevox.com/docs/migrating).
// Used by the /gvg interaction handler (followup delivery) and by the
// command-registration script.
const GAMEVOX_BOT_API = 'https://bot-api.gamevox.com/api/v10';

// Host-pinned URL shapes double as an SSRF guard. They are enforced at the
// trust boundary (the admin-only config route) where untrusted input enters;
// the push path itself accepts whatever is stored so tests can inject mock
// endpoints, and prod config can only ever contain pinned hosts.
// GameVox issues two families (D3 finding, 2026-08-23):
//   incoming: https://api.gamevox.com/webhooks/{uuid}/WH.{token with dots}
//   bot/v10:  https://bot-api.gamevox.com/api/v10/webhooks/{snowflake}/{token}
const WEBHOOK_RES = {
    discord: /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,}\/[\w-]{16,}$/,
    gamevox: /^https:\/\/(?:api|bot-api)\.gamevox\.com\/(?:api\/v10\/)?webhooks\/[\w-]+\/[\w.-]{16,}$/
};

// Per-target push mode. Discord webhooks support edit-in-place, so they
// default to full automation. GameVox incoming webhooks are CREATE-ONLY
// (D0 spike: PATCH/DELETE/GET all 405) - every push would post fresh
// messages - so GameVox defaults to manual pushes (the Push Now button)
// until the platform ships edits. Admins can flip either target.
const TARGET_MODES = ['auto', 'manual'];

function defaultIntegrationsConfig() {
    return {
        version: 1,
        debounceSec: 75,
        autoIntervalMin: 15,
        targets: {
            discord: { platform: 'discord', enabled: false, mode: 'auto', webhookUrl: '', satMessageId: null, sunMessageId: null },
            gamevox: {
                platform: 'gamevox', enabled: false, mode: 'manual',
                botToken: '', publicKey: '',
                siteLabel: '', siteUrl: ''
            }
        }
    };
}

// ============================================
// PURE HELPERS
// ============================================

// Stable JSON serialization (sorted object keys) so hash comparisons are
// immune to key-order churn between saves.
function canonicalize(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value === undefined ? null : value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalize).join(',') + ']';
    }
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function computeGroupsHash(groups, reserves) {
    return crypto.createHash('sha256')
        .update(canonicalize({ groups: groups || {}, reserves: reserves || {} }))
        .digest('hex');
}

// Public config display: host + path up to the token segment + last 4 chars
// of the token. The full bearer credential never leaves the server.
function maskWebhookUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        const segments = u.pathname.split('/').filter(Boolean);
        const last = segments.length ? segments[segments.length - 1] : '';
        const head = last ? u.pathname.slice(0, u.pathname.length - last.length) : u.pathname;
        return u.host + head + '…' + (last ? last.slice(-4) : '');
    } catch (e) {
        return 'invalid-url';
    }
}

function isValidWebhookUrl(platform, url) {
    const re = WEBHOOK_RES[platform];
    if (!re || typeof url !== 'string') return false;
    return re.test(url);
}

// A target fans out to one or more channels. `webhooks` is the source of
// truth for the discord target; legacy configs only have webhookUrl, so
// derive the list from it. (GameVox ignores webhooks entirely - bot-only.)
function normalizeWebhooks(target) {
    if (!target) return [];
    if (Array.isArray(target.webhooks)) {
        return target.webhooks.filter(u => typeof u === 'string' && u);
    }
    return target.webhookUrl ? [target.webhookUrl] : [];
}

// ---- GameVox bot (live) path ----

// Tokens look like GVB.xxxx (56 chars, D0 portal sample). Kept loose on the
// tail so a provider-side format tweak never bricks config saves; length and
// prefix are the security-relevant parts at this trust boundary.
function isValidBotToken(token) {
    return typeof token === 'string' && /^GVB\.[\w.-]{16,}$/.test(token.trim());
}

// Public display: prefix + last 4. The full token never leaves the server.
function maskBotToken(token) {
    const t = String(token == null ? '' : token).trim();
    if (!t) return '';
    return t.slice(0, 4) + '…' + t.slice(-4);
}

// Split long plain-markdown text into chat-sized chunks (<=max chars),
// breaking at line boundaries so tables/headings stay intact per chunk.
function splitForChat(text, max) {
    const limit = Math.max(200, Number(max) || 1900);
    const input = String(text == null ? '' : text);
    if (input.length <= limit) return [input];
    const out = [];
    let current = '';
    for (const rawLine of input.split('\n')) {
        let line = rawLine;
        if (current && current.length + 1 + line.length <= limit) {
            current += '\n' + line;
            continue;
        }
        if (current) out.push(current);
        // Pathological single line longer than the limit: hard-cut it.
        while (line.length > limit) {
            out.push(line.slice(0, limit));
            line = line.slice(limit);
        }
        current = line;
    }
    if (current) out.push(current);
    return out;
}

// Config wins; .env is the deployment fallback so the secret can be managed
// outside the database when preferred.
function effectiveBotToken(target) {
    const fromConfig = target && typeof target.botToken === 'string' ? target.botToken.trim() : '';
    if (fromConfig) return fromConfig;
    return String(process.env.GAMEVOX_BOT_TOKEN || '').trim();
}

// Discord target: delivers through configured incoming webhooks. The GameVox
// target is interaction-driven (/gvg) and never uses this push machinery.
function hasDeliveryChannel(target) {
    if (!target) return false;
    return normalizeWebhooks(target).length > 0;
}

// Markdown-safe text: names/classes/roles come from validated input, but
// stripping markdown control chars keeps a crafted name from breaking the
// embed layout on the platform side.
function sanitizeText(value, max) {
    return String(value == null ? '' : value)
        .replace(/[*_~`|<>[\]\\]/g, '')
        .trim()
        .slice(0, max);
}

function playerLine(player) {
    if (!player || typeof player !== 'object') return null;
    const name = sanitizeText(player.name, 40);
    if (!name) return null;
    let line = '**' + name + '**';
    const cls = sanitizeText(player.class, 10);
    if (cls) line += ' · ' + (CLASS_EMOJI[cls] || '•') + ' ' + cls;
    const role = sanitizeText(player.role, 24);
    if (role) line += ' · ' + role;
    return line;
}

function groupIcon(title) {
    const t = String(title || '').toLowerCase();
    if (/offen|attack|atk/.test(t)) return '⚔️';
    if (/defen|\bdef\b|shield/.test(t)) return '🛡️';
    if (/jungle|scout|roam|flank/.test(t)) return '🍃';
    return '📋';
}

// Pack player lines into embed fields under the char/line budgets; overflow
// continues into a "(cont.)" field instead of truncating.
function splitLinesIntoFields(baseName, lines) {
    const fields = [];
    let current = [];
    let length = 0;
    const flush = () => {
        if (current.length === 0) return;
        const name = fields.length > 0 ? baseName + ' (cont.)' : baseName;
        fields.push({ name: name.slice(0, 256), value: current.join('\n'), inline: false });
        current = [];
        length = 0;
    };
    for (const line of lines) {
        if (current.length >= MAX_FIELD_LINES || length + line.length + 1 > MAX_FIELD_CHARS) flush();
        current.push(line);
        length += line.length + 1;
    }
    flush();
    return fields;
}

// Build the wire payload for one day: [Groups embed] + [Reserves embed].
// Returns null when the day has neither assigned players nor reserves, so
// empty days never create orphan messages.
function buildDayMessage(db, day, options) {
    const opts = options || {};
    const groups = (db && db.groups && db.groups[day] && typeof db.groups[day] === 'object')
        ? db.groups[day]
        : {};
    const groupKeys = Object.keys(groups);
    const reserves = (db && db.reserves && Array.isArray(db.reserves[day])) ? db.reserves[day] : [];

    const assignedCount = groupKeys.reduce((n, k) => {
        const g = groups[k];
        return n + ((g && Array.isArray(g.players)) ? g.players.length : 0);
    }, 0);
    if (assignedCount === 0 && reserves.length === 0) return null;

    const timestamp = opts.timestamp || new Date().toISOString();
    const footer = { text: 'WWM GvG Roster · updated by ' + sanitizeText(opts.updatedBy || 'system', 30) };
    const color = DAY_COLORS[day];
    const embeds = [];

    if (assignedCount > 0) {
        const fields = [];
        for (const key of groupKeys) {
            const group = groups[key] || {};
            const players = Array.isArray(group.players) ? group.players : [];
            const rawTitle = group.title || key;
            const title = sanitizeText(rawTitle, 40) || key;
            const base = groupIcon(rawTitle) + ' ' + title + ' · ' + players.length + '/' + GROUP_CAP;
            const lines = players.map(playerLine).filter(Boolean);
            if (lines.length === 0) {
                fields.push({ name: base.slice(0, 256), value: '—', inline: false });
                continue;
            }
            fields.push(...splitLinesIntoFields(base, lines));
        }
        embeds.push({ title: DAY_LABELS[day] + ' — Groups', color, fields, footer, timestamp });
    }

    if (reserves.length > 0) {
        const lines = reserves.map(playerLine).filter(Boolean);
        const fields = splitLinesIntoFields('🕐 Reserves', lines);
        embeds.push({ title: 'Reserves · ' + reserves.length, color, fields, footer, timestamp });
    }

    return embeds.length > 0 ? { embeds } : null;
}

// Plain-markdown variant for create-only / embed-less surfaces (GameVox
// incoming webhooks: docs say plain-text content only in v1, and live tests
// confirm embeds do not render).
// Message anatomy (user-approved layout, 2026-08-23):
//   1. "<Day> Roster" header            - no guild prefix, one line per day
//   2. One section per group: icon+title+count, player bullets
//   3. Reserves section                 - when non-empty
//   4. "_updated by <actor>_" signature - when known
// The web UI's single announcement is intentionally NOT repeated here.
// Returns null for empty days like buildDayMessage does.
function buildDayText(db, day, options) {
    const opts = options || {};
    const groups = (db && db.groups && db.groups[day] && typeof db.groups[day] === 'object')
        ? db.groups[day]
        : {};
    const groupKeys = Object.keys(groups);
    const reserves = (db && db.reserves && Array.isArray(db.reserves[day])) ? db.reserves[day] : [];

    const assignedCount = groupKeys.reduce((n, k) => {
        const g = groups[k];
        return n + ((g && Array.isArray(g.players)) ? g.players.length : 0);
    }, 0);
    if (assignedCount === 0 && reserves.length === 0) return null;

    const lines = [];

    lines.push('## ' + DAY_LABELS[day] + ' Roster');

    if (groupKeys.length > 0) {
        const groupSections = groupKeys.map(k => {
            const g = groups[k] || {};
            const players = Array.isArray(g.players) ? g.players : [];
            const title = sanitizeText(g.title, 40) || k;
            const part = [];
            part.push(groupIcon(title) + ' **' + title + '** · ' + players.length + '/' + GROUP_CAP);
            if (players.length === 0) {
                part.push('- —');
            } else {
                for (const p of players) {
                    const l = playerLine(p);
                    if (l) part.push('- ' + l);
                }
            }
            return part;
        });

        if (groupSections.length === 1) {
            lines.push('');
            lines.push(...groupSections[0]);
        } else {
            // One mini-table per PAIR of groups: the group titles act as the
            // header row, so there is no stray empty "| | |" header, and each
            // table carries its own "---" separator under the titles. An
            // unpaired trailing group (e.g. a 3rd group with no 4th) renders
            // as a single-column table of its own, same structure.
            for (let i = 0; i < groupSections.length; i += 2) {
                const left = groupSections[i];
                const right = groupSections[i + 1];
                lines.push('');
                lines.push(right
                    ? '| ' + left[0] + ' | ' + right[0] + ' |'
                    : '| ' + left[0] + ' |');
                lines.push(right ? '|---|---|' : '|---|');
                const maxHeight = right ? Math.max(left.length, right.length) : left.length;
                for (let j = 1; j < maxHeight; j++) {
                    const l = left[j] || '';
                    const r = right ? (right[j] || '') : '';
                    lines.push(right
                        ? '| ' + l + ' | ' + r + ' |'
                        : '| ' + l + ' |');
                }
            }
        }
    }

    if (reserves.length > 0) {
        lines.push('');
        lines.push('🕐 **Reserves** · ' + reserves.length);
        for (const p of reserves) {
            const l = playerLine(p);
            if (l) lines.push('- ' + l);
        }
    }

    const by = sanitizeText(opts.updatedBy || '', 30);
    if (by) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const timeStr = now.toTimeString().slice(0, 5);  // HH:MM
        lines.push('');
        let footerLine = `Updated by ${by}, ${dateStr}-${timeStr}`;
        // Origin marker behind the timestamp: a public origin renders as a
        // real hyperlink; anything else (local/dev push, no stored origin)
        // falls back to a plain "-@Local Test" tag so readers can tell where
        // the message was published from.
        const url = String(opts.siteUrl || '').trim();
        const label = sanitizeText(opts.siteLabel, 40);
        if (/^https?:\/\//.test(url)) {
            footerLine += ` [-@${label || url}](${url})`;
        } else {
            footerLine += ' -@' + (label || 'Local Test');
        }
        lines.push(footerLine);
        lines.push(FOOTER_RULE);
    }

    return lines.join('\n');
}

// ============================================
// BROADCASTER (queue + rate discipline + HTTP)
// ============================================
//
// All pushes serialize through one promise chain, so a debounce fire can
// never interleave with a manual push mid-roster.

function createBroadcaster(deps) {
    const d = {
        fetchImpl: (...args) => globalThis.fetch(...args),
        now: () => Date.now(),
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        logger: console,
        ...deps
    };
    for (const fn of ['readConfig', 'writeConfig', 'readData', 'appendHistory']) {
        if (typeof d[fn] !== 'function') throw new Error('createBroadcaster requires ' + fn + '()');
    }

    const states = new Map(); // targetKey -> runtime pacing/breaker state
    let debounceSecCache = 75;
    let debounceTimer = null;
    let queue = Promise.resolve();
    let destroyed = false;

    function stateFor(key) {
        let st = states.get(key);
        if (!st) {
            st = {
                lastAutoPushAt: 0,
                lastManualPushAt: 0,
                failures: 0,
                breakerUntil: 0,
                lastRequestAt: 0,
                lastPushedHash: null,
                floorTimer: null
            };
            states.set(key, st);
        }
        return st;
    }

    function log(details, user) {
        try {
            d.appendHistory({ action: 'broadcast', details, user: user || 'system' });
        } catch (e) {
            d.logger.error('broadcast: history logging failed:', e.message);
        }
    }

    function enqueue(fn) {
        const run = queue.then(fn);
        queue = run.then(() => undefined, () => undefined);
        return run;
    }

    // Space requests per target: >=1s apart, plus any outstanding 429 hold.
    async function pace(st) {
        const waitMs = Math.max(st.lastRequestAt + MIN_SPACING_MS - d.now(), 0);
        if (waitMs > 0) await d.sleep(waitMs);
        st.lastRequestAt = d.now();
    }

    function httpError(res, parsed) {
        const detail = parsed && (parsed.message || parsed.error)
            ? ': ' + (parsed.message || parsed.error)
            : '';
        return 'HTTP ' + res.status + detail;
    }

    // One logical request with 429 discipline: honor Retry-After (header in
    // seconds or body retry_after in ms), wait, retry exactly once. Anything
    // beyond that is a failure for this round; the breaker handles repeats.
    // extraHeaders lets the bot path attach its Authorization header without
    // webhook calls ever carrying one.
    async function send(st, url, method, body, extraHeaders) {
        const headers = { 'Content-Type': 'application/json' };
        if (extraHeaders && typeof extraHeaders === 'object') {
            for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
        }
        const doFetch = async () => {
            await pace(st);
            return d.fetchImpl(url, {
                method,
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
            });
        };

        let res;
        try {
            res = await doFetch();
        } catch (err) {
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                return { ok: false, error: 'timeout after ' + (FETCH_TIMEOUT_MS / 1000) + 's' };
            }
            return { ok: false, error: 'network error: ' + err.message };
        }

        if (res.status === 429) {
            let waitMs = 0;
            if (res.headers && typeof res.headers.get === 'function') {
                const header = parseFloat(res.headers.get('retry-after'));
                if (Number.isFinite(header)) waitMs = header * 1000;
            }
            let parsed = null;
            try { parsed = await res.json(); } catch (e) { /* body optional */ }
            if (parsed && Number.isFinite(parsed.retry_after)) {
                waitMs = Math.max(waitMs, Number(parsed.retry_after));
            }
            waitMs = Math.min(Math.max(waitMs, 1000), MAX_429_WAIT_MS);
            await d.sleep(waitMs);
            try {
                res = await doFetch();
            } catch (err) {
                if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                    return { ok: false, error: 'timeout after ' + (FETCH_TIMEOUT_MS / 1000) + 's' };
                }
                return { ok: false, error: 'network error after 429: ' + err.message };
            }
            parsed = null;
            try { parsed = await res.json(); } catch (e) { /* empty body ok */ }
            if (res.ok) return { ok: true, status: res.status, body: parsed };
            return { ok: false, status: res.status, error: httpError(res, parsed) };
        }

        let parsed = null;
        try { parsed = await res.json(); } catch (e) { /* empty body ok */ }
        if (res.ok) return { ok: true, status: res.status, body: parsed };
        return { ok: false, status: res.status, error: httpError(res, parsed) };
    }

    // Edit-in-place for one day on ONE channel (Discord-style platforms
    // PATCH the stored per-channel message id, falling back to create on
    // 404). The GameVox target is interaction-driven (/gvg) and never
    // routes through this REST machinery.
    async function ensureDayMessage(st, target, url, db, day, actor) {
        const message = buildDayMessage(db, day, { updatedBy: actor });
        if (!message) return { ok: true, skipped: true };

        if (!target.channelIds || typeof target.channelIds !== 'object') target.channelIds = {};
        if (!target.channelIds[url] || typeof target.channelIds[url] !== 'object') {
            target.channelIds[url] = {};
        }
        const ids = target.channelIds[url];

        const idKey = day + 'MessageId';
        if (ids[idKey]) {
            const edited = await send(st, url + '/messages/' + ids[idKey], 'PATCH', message);
            if (edited.ok) return { ok: true, updated: true };
            if (edited.status !== 404) return { ok: false, error: edited.error };
            ids[idKey] = null;
        }

        const created = await send(st, url + '?wait=true', 'POST', message);
        if (!created.ok) return { ok: false, error: created.error };
        if (!created.body || !created.body.id) return { ok: false, error: 'no message id in response' };
        ids[idKey] = created.body.id;
        return { ok: true, created: true };
    }

    async function pushTarget(key, options) {
        // The GameVox target is interaction-driven (/gvg in chat) and no
        // longer participates in the REST push engine at all.
        if (key === 'gamevox') {
            return { ok: false, skipped: true, error: 'not configured' };
        }
        const opts = options || {};
        const cfg = opts.config || await d.readConfig();
        if (cfg && Number.isFinite(Number(cfg.debounceSec))) {
            debounceSecCache = Number(cfg.debounceSec);
        }
        const target = cfg && cfg.targets && cfg.targets[key];
        const urls = normalizeWebhooks(target);
        if (!target || !target.enabled || urls.length === 0) {
            return { ok: false, skipped: true, error: 'not configured' };
        }

        // Migrate legacy single-channel ids into the per-channel map so an
        // old config keeps editing its existing Discord messages. Discord
        // only - GameVox is bot-exclusive and stores ids under 'bot:*' keys.
        let configDirty = false;
        if (key === 'discord') {
            configDirty = !Array.isArray(target.webhooks);
            if (!target.channelIds || typeof target.channelIds !== 'object') target.channelIds = {};
            for (const u of urls) {
                if (!target.channelIds[u]) {
                    const legacy = u === target.webhookUrl
                        ? { satMessageId: target.satMessageId || null, sunMessageId: target.sunMessageId || null }
                        : { satMessageId: null, sunMessageId: null };
                    target.channelIds[u] = legacy.satMessageId || legacy.sunMessageId ? legacy : {};
                    if (target.channelIds[u].satMessageId || target.channelIds[u].sunMessageId) configDirty = true;
                }
            }
            if (!Array.isArray(target.webhooks)) target.webhooks = urls;
        } else if (!target.channelIds || typeof target.channelIds !== 'object') {
            target.channelIds = {};
        }

        const st = stateFor(key);
        const db = opts.db || await d.readData();
        if (!db) return { ok: false, error: 'no data' };

        // Fan out: every enabled webhook channel receives every non-empty
        // day.
        const days = [];
        for (const day of DAY_KEYS) {
            const perChannel = [];
            for (let i = 0; i < urls.length; i++) {
                const r = await ensureDayMessage(st, target, urls[i], db, day, opts.actor || 'system');
                if (r.created) configDirty = true;
                perChannel.push({ n: i + 1, ...r });
            }
            const failed = perChannel.filter(x => x.ok === false);
            days.push({
                day,
                ok: failed.length === 0,
                ...(failed.length ? { error: failed.map(f => '#' + f.n + ': ' + f.error).join('; ') } : {}),
                ...(perChannel.every(x => x.skipped) ? { skipped: true } : {})
            });
        }

        // Mirror the first channel's ids into the legacy fields so configs
        // saved by older versions keep round-tripping.
        const firstIds = urls.length ? target.channelIds[urls[0]] : null;
        if (firstIds) {
            if (target.satMessageId !== (firstIds.satMessageId || null)) configDirty = true;
            if (target.sunMessageId !== (firstIds.sunMessageId || null)) configDirty = true;
            target.satMessageId = firstIds.satMessageId || null;
            target.sunMessageId = firstIds.sunMessageId || null;
        }

        if (configDirty) {
            const saved = await d.writeConfig(cfg);
            if (!saved) d.logger.warn('broadcast: could not persist message ids');
        }

        const failures = days.filter(r => r.ok === false);
        if (failures.length === 0) {
            const touched = days.filter(r => !r.skipped);
            if (touched.length > 0) {
                st.failures = 0;
                st.breakerUntil = 0;
                st.lastPushedHash = computeGroupsHash(db.groups, db.reserves);
                st.lastAutoPushAt = d.now(); // floor counts from ANY successful push
                const parts = touched.map(r =>
                    DAY_LABELS[r.day] + (r.created ? ' posted' : ' updated')).join(', ');
                log('Broadcast pushed to ' + key + ' (' + parts + ') by ' + (opts.actor || 'system'), opts.actor);
            }
            return { ok: true, days };
        }

        st.failures += 1;
        let tripped = false;
        if (st.failures >= BREAKER_THRESHOLD && d.now() >= st.breakerUntil) {
            st.breakerUntil = d.now() + BREAKER_PAUSE_MS;
            tripped = true;
        }
        const reason = failures.map(f => (DAY_LABELS[f.day] || f.day) + ': ' + f.error).join('; ');
        log('Broadcast to ' + key + ' failed (' + reason + ')', opts.actor);
        if (tripped) {
            log('Auto-push paused for ' + key + ' for 30 minutes after repeated failures.', opts.actor);
        }
        return { ok: false, days };
    }

    // Debounce fire: push every enabled target whose content changed, gated
    // by the auto-push floor. Skipped targets schedule their own retry at
    // floor expiry so a burst right after a push is never lost.
    async function autoPushRun() {
        let cfg = null;
        let db = null;
        try { cfg = await d.readConfig(); } catch (e) { /* inert until readable */ }
        try { db = await d.readData(); } catch (e) { /* inert until readable */ }
        if (!cfg || !db) return;
        if (Number.isFinite(Number(cfg.debounceSec))) debounceSecCache = Number(cfg.debounceSec);

        const hash = computeGroupsHash(db.groups, db.reserves);
        for (const key of TARGET_KEYS) {
            const target = cfg.targets && cfg.targets[key];
            if (!target || !target.enabled || !hasDeliveryChannel(target)) continue;
            if (target.mode === 'manual') continue; // Push Now button only
            const st = stateFor(key);
            if (d.now() < st.breakerUntil) continue;
            if (st.lastPushedHash === hash) continue; // content-hash gate
            const intervalMin = Number(cfg.autoIntervalMin) > 0 ? Number(cfg.autoIntervalMin) : 15;
            const since = d.now() - st.lastAutoPushAt;
            if (since < intervalMin * 60 * 1000) {
                scheduleFloorRetry(st, intervalMin * 60 * 1000 - since);
                continue;
            }
            await pushTarget(key, { config: cfg, db, actor: 'auto' });
        }
    }

    function scheduleFloorRetry(st, delayMs) {
        if (st.floorTimer) return;
        st.floorTimer = setTimeout(() => {
            st.floorTimer = null;
            enqueue(autoPushRun);
        }, delayMs + 50);
        if (typeof st.floorTimer.unref === 'function') st.floorTimer.unref();
    }

    // Save-pipeline hook: mark dirty and (re)arm the trailing-edge debounce.
    // The window comes from config; reads are async, so arm after the read
    // resolves - rapid notifies each re-arm, and the last one wins. Never
    // throws into the caller; the actual push reads fresh data later.
    function notify() {
        Promise.resolve()
            .then(() => d.readConfig())
            .then(cfg => {
                if (cfg && Number.isFinite(Number(cfg.debounceSec))) {
                    debounceSecCache = Number(cfg.debounceSec);
                }
            })
            .catch(() => { /* fall back to cached/default window */ })
            .then(() => {
                if (destroyed) return;
                if (debounceTimer) clearTimeout(debounceTimer);
                const sec = Math.min(Math.max(Number(debounceSecCache) || 75, 0.05), 600);
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    enqueue(autoPushRun);
                }, sec * 1000);
                if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
            });
    }

    // Manual push (Mod+ button): bypasses the auto floor, honors its own
    // 30s cooldown per target, still subject to platform 429s.
    async function pushNow(actor, onlyKey, options) {
        const opts = options || {};
        const keys = (onlyKey && TARGET_KEYS.includes(onlyKey)) ? [onlyKey] : TARGET_KEYS;
        const results = {};
        for (const key of keys) {
            results[key] = await enqueue(async () => {
                const st = stateFor(key);
                const remaining = MANUAL_COOLDOWN_MS - (d.now() - st.lastManualPushAt);
                if (remaining > 0) {
                    return { ok: false, cooldown: true, retryAfterSec: Math.ceil(remaining / 1000) };
                }
                st.lastManualPushAt = d.now();
                return pushTarget(key, { actor: actor || 'mod', manual: true, site: opts.site });
            });
        }
        return results;
    }

    function getStatus() {
        const out = {};
        for (const key of TARGET_KEYS) {
            const st = stateFor(key);
            out[key] = {
                breakerActive: d.now() < st.breakerUntil,
                breakerUntil: st.breakerUntil || null,
                consecutiveFailures: st.failures,
                cooldownRemainingSec: Math.max(0, Math.ceil((MANUAL_COOLDOWN_MS - (d.now() - st.lastManualPushAt)) / 1000)),
                lastAutoPushAt: st.lastAutoPushAt || null,
                lastManualPushAt: st.lastManualPushAt || null
            };
        }
        return out;
    }

    function destroy() {
        destroyed = true;
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        states.forEach(st => {
            if (st.floorTimer) {
                clearTimeout(st.floorTimer);
                st.floorTimer = null;
            }
        });
    }

    return { notify, pushNow, getStatus, destroy };
}

module.exports = {
    TARGET_KEYS,
    TARGET_MODES,
    DAY_KEYS,
    DAY_LABELS,
    DAY_COLORS,
    CLASS_EMOJI,
    GROUP_CAP,
    MANUAL_COOLDOWN_MS,
    FOOTER_RULE,
    BREAKER_THRESHOLD,
    BREAKER_PAUSE_MS,
    MIN_SPACING_MS,
    MAX_429_WAIT_MS,
    MAX_WEBHOOKS,
    MAX_FIELD_CHARS,
    MAX_FIELD_LINES,
    GAMEVOX_BOT_API,
    defaultIntegrationsConfig,
    canonicalize,
    computeGroupsHash,
    maskWebhookUrl,
    isValidWebhookUrl,
    isValidBotToken,
    maskBotToken,
    splitForChat,
    effectiveBotToken,
    hasDeliveryChannel,
    buildDayMessage,
    buildDayText,
    createBroadcaster
};
