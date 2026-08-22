// ============================================================
// SYNC - Data sync engine (Phase 11.2)
// Polling + SSE + focus re-sync, with the Phase 8.3 dirty-check
// (deferred syncs while a moderator is mid-edit).
// ============================================================

const SYNC_INTERVAL = 30000; // 30 seconds
let _syncTimer = null;
let _isSyncing = false;

// ---- Sync dirty-check (Phase 8.3) ----
// While a moderator has an in-progress edit (edit form open or drag in
// flight), a poll/SSE push must not apply server data: applyServerData
// re-renders and would wipe the unsaved input. Instead the sync is
// deferred and re-run the moment the edit completes.
let _editSessionCount = 0;
let _syncDeferred = false;

function beginUserEdit() {
    _editSessionCount++;
}

function endUserEdit() {
    if (_editSessionCount > 0) _editSessionCount--;
    if (_editSessionCount === 0 && _syncDeferred) {
        _syncDeferred = false;
        performSync(); // Pick up the server data that arrived mid-edit.
    }
}

function isUserEditing() {
    return _editSessionCount > 0;
}

function startDataSync() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
    }
    
    // 30s polling remains as a fallback; SSE + focus re-sync run on top.
    _syncTimer = setInterval(performSync, SYNC_INTERVAL);
    setupRealtimeSync();
}

// True if serverTime is newer than localTime (or local is unset). Values are
// normally ISO strings; Date objects are accepted and normalized so mixed
// types still compare correctly instead of silently returning false.
function isNewerThan(serverTime, localTime) {
    if (!localTime) return true;
    const s = new Date(serverTime);
    const l = new Date(localTime);
    if (isNaN(s.getTime()) || isNaN(l.getTime())) return false;
    return s.getTime() > l.getTime();
}

// Apply an already-fetched server snapshot if it is newer than ours.
// The whole-state stringify compare runs ONLY here (i.e. after an update
// actually arrived), never on an unchanged poll.
function applyIfNewer(serverData) {
    if (!serverData) return;
    
    const serverTime = serverData.lastUpdateTime;
    const localTime = window._serverLastUpdatedTime;
    
    if (!serverTime || !isNewerThan(serverTime, localTime)) {
        window._lastSyncedAt = Date.now();
        return;
    }
    
    console.log('🔄 Server has newer data, syncing...');
    
    // Snapshot current state to detect actual changes
    const prevState = {
        groups: App.state.groups,
        reserves: App.state.reserves,
        guildMembers: App.state.guildMembers,
        announcement: App.state.announcement,
        guildName: App.state.guildName
    };
    
    applyServerData(serverData);
    
    // Only re-render if data actually changed
    const dataChanged = JSON.stringify(prevState.groups) !== JSON.stringify(App.state.groups) ||
                        JSON.stringify(prevState.reserves) !== JSON.stringify(App.state.reserves) ||
                        JSON.stringify(prevState.guildMembers) !== JSON.stringify(App.state.guildMembers) ||
                        JSON.stringify(prevState.announcement) !== JSON.stringify(App.state.announcement) ||
                        prevState.guildName !== App.state.guildName;
    
    if (dataChanged && typeof render === 'function') {
        render();
        showToast('🔄 Data synced from server', 'info', 1500);
    }
}

// One sync pass (Phase 11.7): ask the server for its last-update timestamp
// first via the lightweight endpoint and only download the full state when
// it is actually newer. Falls back to the full fetch if the endpoint is
// unavailable, so sync still works against older servers.
async function performSync() {
    if (_isSyncing) return; // Prevent overlapping syncs
    _isSyncing = true;
    
    try {
        // Phase 8.3: never apply server data over an in-progress edit.
        // Defer instead; endUserEdit() re-runs the sync when editing stops.
        if (isUserEditing()) {
            _syncDeferred = true;
            return;
        }
        
        let serverTime = null;
        try {
            serverTime = await getServerUpdateTime();
        } catch (error) {
            serverTime = null;
        }
        
        if (serverTime === null) {
            // Lightweight endpoint unavailable - legacy full-fetch path.
            const serverData = await loadDataFromServer();
            applyIfNewer(serverData);
            return;
        }
        
        const localTime = window._serverLastUpdatedTime;
        if (!isNewerThan(serverTime, localTime)) {
            // Nothing changed since our last sync - skip the full download.
            window._lastSyncedAt = Date.now();
            return;
        }
        
        const serverData = await loadDataFromServer();
        applyIfNewer(serverData);
    } catch (error) {
        console.error('Sync error:', error);
    } finally {
        _isSyncing = false;
    }
}

// Real-time sync (Phase 4.5): SSE push from the server + re-sync on tab focus.
// The 30s poller stays as a fallback when SSE is unavailable.
function setupRealtimeSync() {
    if (window._eventSource) {
        try { window._eventSource.close(); } catch (e) {}
        window._eventSource = null;
    }
    try {
        const es = new EventSource('/api/events');
        window._eventSource = es;
        es.addEventListener('update', function() {
            performSync();
        });
        // EventSource reconnects automatically on error; no action needed.
        es.onerror = function() {};
        console.log('Realtime sync connected (SSE)');
    } catch (e) {
        console.warn('Realtime sync unavailable, polling fallback only:', e);
    }
    
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) performSync();
    });
}

function stopDataSync() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
    }
    if (window._eventSource) {
        try { window._eventSource.close(); } catch (e) {}
        window._eventSource = null;
    }
}
