// server/sse.js - Realtime sync (Phase 4.5): SSE client set + broadcast

const SSE_CLIENTS = new Set();

function broadcastUpdate(version) {
    if (SSE_CLIENTS.size === 0) return;
    const payload = 'event: update\ndata: ' + JSON.stringify({ lastUpdate: version, ts: Date.now() }) + '\n\n';
    SSE_CLIENTS.forEach(res => {
        try { res.write(payload); } catch (e) { SSE_CLIENTS.delete(res); }
    });
}

module.exports = { SSE_CLIENTS, broadcastUpdate };
