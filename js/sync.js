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

// One sync pass: fetch server data and apply it if it is newer than ours.
async function performSync() {
    if (_isSyncing) return; // Prevent overlapping syncs
    _isSyncing = true;
    
    try {
        const serverData = await loadDataFromServer();
        if (!serverData) return;
        
        // Phase 8.3: never apply server data over an in-progress edit.
        // Defer instead; endUserEdit() re-runs the sync when editing stops.
        if (isUserEditing()) {
            _syncDeferred = true;
            return;
        }
        
        const serverTime = serverData.lastUpdateTime;
        const localTime = window._serverLastUpdatedTime;
        
        // If server has NEWER data than what we last synced, reload
        if (serverTime && (!localTime || 
            (typeof serverTime === 'string' && typeof localTime === 'string' && serverTime > localTime) ||
            (typeof serverTime === 'object' && typeof localTime === 'object' && new Date(serverTime) > new Date(localTime)))) {
            
            console.log('🔄 Server has newer data, syncing...');
            
            // Snapshot current state to detect actual changes
            const prevState = {
                groups: window.groups,
                reserves: window.reserves,
                guildMembers: window.guildMembers,
                announcement: window.announcementText,
                guildName: window.guildName
            };
            
            applyServerData(serverData);
            
            // Only re-render if data actually changed
            const dataChanged = JSON.stringify(prevState.groups) !== JSON.stringify(window.groups) ||
                                JSON.stringify(prevState.reserves) !== JSON.stringify(window.reserves) ||
                                JSON.stringify(prevState.guildMembers) !== JSON.stringify(window.guildMembers) ||
                                prevState.announcement !== window.announcementText ||
                                prevState.guildName !== window.guildName;
            
            if (dataChanged && typeof render === 'function') {
                render();
                showToast('🔄 Data synced from server', 'info', 1500);
            }
        } else {
            window._lastSyncedAt = Date.now();
        }
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
