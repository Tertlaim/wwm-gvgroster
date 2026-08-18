// ============================================================
// MAIN - Application initialization (FULL VERSION)
// ============================================================

// ---- CONFIG ----
const ADMIN_USER = 'Tertlaim';
const DEFAULT_MOD_PW = 'Sin1234';

// ---- Global state ----
window.currentUser = null;
window.currentDay = 'sat';
window.groups = {};
window.reserves = {};
window.guildMembers = {};
window.moderators = {};
window.lastUpdateTime = null;
window.announcementText = '';

// ---- Alert Modal (Now using Toast) ----
function showAlert(message, title = 'Alert', icon = '⚠️') {
    // Convert to toast notification
    const type = title.toLowerCase();
    let toastType = 'info';
    
    if (type.includes('error') || type.includes('fail')) {
        toastType = 'error';
    } else if (type.includes('warning') || type.includes('warn')) {
        toastType = 'warning';
    } else if (type.includes('success')) {
        toastType = 'success';
    }
    
    // Show toast instead of modal
    return showToast(`${icon} ${message}`, toastType, 4000);
}

// ---- Confirmation modal - still needed for confirmations ----
let pendingAction = null;

function showConfirmation(message, callback) {
    const modal = document.getElementById('confirmationModal');
    const messageEl = document.getElementById('confirmationMessage');
    const confirmBtn = document.getElementById('confirmActionBtn');
    const cancelBtn = document.getElementById('cancelActionBtn');
    
    if (!modal || !messageEl) {
        // Fallback to confirm()
        if (confirm(message)) {
            callback();
        }
        return;
    }
    
    messageEl.textContent = message;
    modal.classList.add('active');
    
    pendingAction = callback;
    
    confirmBtn.onclick = function() {
        modal.classList.remove('active');
        if (pendingAction) {
            pendingAction();
            pendingAction = null;
        }
    };
    
    cancelBtn.onclick = function() {
        modal.classList.remove('active');
        pendingAction = null;
    };
}

// ---- State management ----
function updateLastUpdate() {
    const now = new Date();
    // Format: "15 Aug 2026, 02:58 AM"
    const options = { 
        day: 'numeric',
        month: 'short', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
    };
    const formatted = now.toLocaleDateString('en-US', options);
    window.lastUpdateTime = formatted;
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = `Last update: ${formatUpdateTime(window.lastUpdateTime)}`;
    }
    saveState();
}

// ---- Save/Load with API ----
async function saveState() {
    // SERVER IS THE SINGLE SOURCE OF TRUTH (Phase 4.1)
    // Removed localStorage caching — all users share the same server data
    
    // POST /api/data requires a session; public visitors have no write access
    // (their registrations go through /api/register instead). Skip silently.
    if (typeof AuthModule === 'undefined' || !AuthModule.getToken()) {
        return;
    }
    
    const data = { 
        groups: window.groups, 
        reserves: window.reserves, 
        guildMembers: window.guildMembers, 
        lastUpdateTime: window.lastUpdateTime,
        announcement: window.announcementText || '',
        guildName: window.guildName || 'Mask Sinners',
        // Concurrency metadata (Phase 4.5): the base version this snapshot
        // is derived from, ids fully deleted, and ids removed from specific
        // lists since our last save. The server merges stale snapshots and
        // applies these removals on top.
        baseVersion: window._serverLastUpdatedTime || null,
        deletedIds: Array.from(window._pendingDeletedIds || []),
        removed: (window._pendingRemovals || { groups: {}, reserves: {}, guildMembers: {} })
    };
    
    const result = await saveDataToServer(data);
    if (result && result.lastUpdate) {
        window.lastUpdateTime = result.lastUpdate;
        // Update sync timestamp so the poller doesn't re-apply our own changes
        window._serverLastUpdatedTime = result.lastUpdate;
        // Removals/deletes were applied server-side - clear the pending records
        if (typeof clearPendingSyncState === 'function') clearPendingSyncState();
        // Converge to the merged server state (includes other editors' changes)
        if (result.data) {
            applyServerData(result.data);
        }
        const lastUpdateEl = document.getElementById('lastUpdate');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `Last update: ${formatUpdateTime(result.lastUpdate)}`;
        }
    } else if (result && result.error) {
        // Server rejected the save (e.g. expired session) - surface it instead of losing data silently
        showToast(result.error || 'Failed to save to server', 'error', 3000);
    } else if (!result) {
        showToast('Failed to save to server. Check connection or re-login.', 'error', 3000);
    }
}

// ---- Load staff list (admin+) so Reset PW / Demote / role display work ----
// Roles come from the server store (config/auth.json) - nothing is hardcoded here.
async function loadModerators() {
    try {
        const response = await fetch('/api/moderators/list', {
            headers: getAuthHeader()
        });
        if (!response.ok) return;
        const result = await response.json();
        window.moderators = {};
        if (result && Array.isArray(result.users)) {
            result.users.forEach(user => {
                if (user && user.username) window.moderators[user.username] = user.role || 'mod';
            });
        }
    } catch (error) {
        console.error('Error loading moderators:', error);
    }
}

async function loadState() {
    // SERVER IS THE SINGLE SOURCE OF TRUTH (Phase 4.2)
    // localStorage fallback REMOVED — all users see the same server data
    try {
        const serverData = await loadDataFromServer();
        if (serverData && Object.keys(serverData).length > 0) {
            applyServerData(serverData);
            return true;
        }
    } catch (error) {
        console.error('Error loading from server:', error);
    }
    
    // Fallback: initialize empty data if server is unreachable
    initializeEmptyData();
    window.lastUpdateTime = new Date().toLocaleString('en-US', { 
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true 
    });
    return false;
}

// ---- Apply server data to local state (Phase 4.1) ----
function applyServerData(serverData) {
    if (!serverData || Object.keys(serverData).length === 0) return;
    
    // Detect if server has newer data than what we have
    const serverTime = serverData.lastUpdateTime;
    const currentTime = window._serverLastUpdateTime;
    
    window.groups = serverData.groups || {};
    window.reserves = serverData.reserves || {};
    window.guildMembers = serverData.guildMembers || {};
    window.guildName = serverData.guildName || 'Mask Sinners';
    
    if (serverData.lastUpdateTime) {
        window.lastUpdateTime = serverData.lastUpdateTime;
        const lastUpdateEl = document.getElementById('lastUpdate');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `Last update: ${formatUpdateTime(window.lastUpdateTime)}`;
        }
    }
    
    // Update announcement
    if (typeof serverData.announcement === 'string') {
        window.announcementText = serverData.announcement;
        if (typeof renderAnnouncement === 'function') {
            renderAnnouncement();
        }
    }
    
    // Update guild name display
    const guildNameDisplay = document.getElementById('guildNameDisplay');
    if (guildNameDisplay && window.guildName) {
        guildNameDisplay.textContent = window.guildName;
    }
    
    // Track server time for change detection
    window._serverLastUpdatedTime = serverTime;
    window._lastSyncedAt = Date.now();
}

// ---- SYNC ENGINE: Poll server every 30 seconds (Phase 4.1) ----
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

function initializeEmptyData() {
    window.groups = {
        sat: {
            offence1: { title: 'Offense 1', players: [] },
            offence2: { title: 'Offense 2', players: [] },
            defence1: { title: 'Defense', players: [] },
            jungle: { title: 'Jungle', players: [] }
        },
        sun: {
            offence1: { title: 'Offense 1', players: [] },
            offence2: { title: 'Offense 2', players: [] },
            defence1: { title: 'Defense', players: [] },
            jungle: { title: 'Jungle', players: [] }
        }
    };
    window.reserves = { sat: [], sun: [] };
    window.guildMembers = { sat: [], sun: [] };
    window.guildName = 'Mask Sinners';
}

// ============================================================
// GUILD NAME MANAGEMENT
// ============================================================

// Inline guild name editing (Phase 6.3): click the header title to edit,
// Enter commits via /api/guild/name, Escape cancels. Mods+ only.
function setupGuildNameEditor() {
    const guildNameDisplay = document.getElementById('guildNameDisplay');
    if (!guildNameDisplay) return;
    
    let editing = false;
    
    guildNameDisplay.addEventListener('click', function() {
        if (editing) return;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        if (!isMod) {
            showToast('Only moderators can edit the guild name.', 'error', 2000);
            return;
        }
        
        const original = window.guildName || guildNameDisplay.textContent || '';
        editing = true;
        guildNameDisplay.style.display = 'none';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'guildNameInlineInput';
        input.value = original;
        input.maxLength = 50;
        input.style.fontSize = 'inherit';
        input.style.fontWeight = 'inherit';
        input.style.background = 'var(--bg-input)';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = 'var(--radius-sm)';
        input.style.color = 'var(--text-primary)';
        input.style.padding = '2px 8px';
        input.style.maxWidth = '60vw';
        
        guildNameDisplay.parentNode.insertBefore(input, guildNameDisplay);
        input.focus();
        input.setSelectionRange(original.length, original.length);
        
        function finish(save) {
            if (!editing) return;
            editing = false;
            const name = save ? input.value.trim() : '';
            if (input.parentNode) input.parentNode.removeChild(input);
            guildNameDisplay.style.display = '';
            if (!save) return;
            if (!name) {
                showAlert('Guild name cannot be empty.', 'Error', '❌');
                return;
            }
            saveGuildName(name);
        }
        
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', function() {
            finish(false);
        });
    });
}

async function saveGuildName(name) {
    try {
        const response = await fetch('/api/guild/name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name })
        });
        const result = await response.json();
        if (result.success) {
            window.guildName = name;
            const guildNameDisplay = document.getElementById('guildNameDisplay');
            if (guildNameDisplay) guildNameDisplay.textContent = name;
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add) {
                History.add('guild_name', {
                    details: name,
                    newValue: name,
                    oldValue: window._oldGuildName || 'Mask Sinners'
                });
                window._oldGuildName = name;
            }
            
            showAlert('Guild name updated successfully!', 'Success', '✅');
            if (typeof loadState === 'function') loadState();
        } else {
            showAlert(result.error || 'Failed to update guild name.', 'Error', '❌');
        }
    } catch (error) {
        console.error('Error updating guild name:', error);
        showAlert('Error updating guild name.', 'Error', '❌');
    }
}

// ============================================================
// GROUP MANAGEMENT
// ============================================================

function setupGroupManagement() {
    const addGroupBtn = document.getElementById('addGroupBtn');
    const newGroupTitle = document.getElementById('newGroupTitle');
    const groupCount = document.getElementById('groupCount');
    
    async function loadGroupStats() {
        try {
            const response = await fetch('/api/groups/config');
            const config = await response.json();
            if (groupCount) {
                const total = config.currentGroups.sat + config.currentGroups.sun;
                groupCount.textContent = `Groups: ${total}/${config.maxGroups} (Sat: ${config.currentGroups.sat}, Sun: ${config.currentGroups.sun})`;
            }
        } catch (error) {
            console.error('Error loading group stats:', error);
        }
    }
    
if (addGroupBtn) {
    addGroupBtn.addEventListener('click', async function() {
        const title = newGroupTitle.value.trim();
        if (!title) {
            showAlert('Please enter a group name.', 'Error', '❌');
            return;
        }
        
        // The group is added to the day currently being viewed (no dropdown).
        const day = window.currentDay || 'sat';
        const groupKey = 'group_' + Date.now();
        
        try {
            const response = await fetch('/api/groups/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({ day, groupKey, title })
            });
            const result = await response.json();
            if (result.success) {
                showAlert('Group added successfully!', 'Success', '✅');
                newGroupTitle.value = '';
                await loadGroupStats();
                await loadState();
                
                // ---- LOG TO HISTORY ----
                if (typeof History !== 'undefined' && History.add) {
                    var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
                    History.add('group_add', {
                        details: title,
                        day: day,
                        to: dayName,
                        newValue: title
                    });
                    console.log('📝 History logged: group add');
                }
                
                if (typeof render === 'function') render();
            } else {
                showAlert(result.error || 'Failed to add group.', 'Error', '❌');
            }
        } catch (error) {
            console.error('Error adding group:', error);
            showAlert('Error adding group.', 'Error', '❌');
        }
    });
}
    // Load stats on init
    loadGroupStats();
}

// ---- Registration ----
function setupRegistration() {
    const registerForm = document.getElementById('registerForm');
    const previewModal = document.getElementById('previewModal');
    const previewName = document.getElementById('previewName');
    const previewClass = document.getElementById('previewClass');
    const previewRole = document.getElementById('previewRole');
    const previewDays = document.getElementById('previewDays');
    const confirmRegisterBtn = document.getElementById('confirmRegisterBtn');
    const cancelRegisterBtn = document.getElementById('cancelRegisterBtn');
    const editRegisterBtn = document.getElementById('editRegisterBtn');
    const daySat = document.getElementById('daySat');
    const daySun = document.getElementById('daySun');
    const playerName = document.getElementById('playerName');
    const playerClass = document.getElementById('playerClass');
    const playerRole = document.getElementById('playerRole');
    
    let pendingRegistration = null;

    if (registerForm) {
        registerForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const name = playerName.value.trim();
            if (!name) return;
            if (name.length > 20) { 
                showAlert('Max 20 characters.', 'Error', '❌');
                return; 
            }
            
            const days = [];
            if (daySat.checked) days.push('Saturday');
            if (daySun.checked) days.push('Sunday');
            if (days.length === 0) {
                showAlert('Please select at least one day.', 'Error', '❌');
                return;
            }
            
            let selectedRole = 'Member';
            if (AuthModule.isMod() && playerRole) {
                selectedRole = playerRole.value;
            }
            
            pendingRegistration = {
                name: name,
                class: playerClass.value,
                role: selectedRole,
                days: days,
                daySat: daySat.checked,
                daySun: daySun.checked
            };
            
            previewName.textContent = name;
            previewClass.textContent = playerClass.value;
            previewRole.textContent = selectedRole;
            previewDays.textContent = days.join(' & ');
            previewModal.classList.add('active');
        });
    }

	if (confirmRegisterBtn) {
    confirmRegisterBtn.addEventListener('click', async function() {
        if (!pendingRegistration) return;
        const { name, class: cls, role, daySat, daySun } = pendingRegistration;
        
        // Public registrations go through the dedicated server endpoint
        // (POST /api/data now requires a moderator/admin session).
        var days = [];
        if (daySat) days.push('sat');
        if (daySun) days.push('sun');
        
        confirmRegisterBtn.disabled = true;
        var result = await registerPlayer(name, cls, days);
        confirmRegisterBtn.disabled = false;
        
        if (!result || !result.success) {
            showToast((result && result.error) ? result.error : 'Registration failed. Please try again.', 'error', 3000);
            return;
        }
        
        if (result.added === 0) {
            pendingRegistration = null;
            previewModal.classList.remove('active');
            showToast('Already registered for the selected day(s).', 'warning', 3000);
            return;
        }
        
        pendingRegistration = null;
        previewModal.classList.remove('active');
        playerName.value = '';
        
        // Re-sync from server (source of truth) and re-render
        if (result.data) {
            applyServerData(result.data);
            window._serverLastUpdatedTime = result.lastUpdate || result.data.lastUpdateTime;
        }
        render();
        showToast(result.added > 1 ? `Registered for ${result.added} days` : 'Registered successfully!', 'success', 2000);
    });
}

    if (cancelRegisterBtn) {
        cancelRegisterBtn.addEventListener('click', function() {
            pendingRegistration = null;
            previewModal.classList.remove('active');
        });
    }

    if (editRegisterBtn) {
        editRegisterBtn.addEventListener('click', function() {
            pendingRegistration = null;
            previewModal.classList.remove('active');
            playerName.focus();
        });
    }
}

// ---- Reserve Actions ----
function setupReserveActions() {
    var moveToGuildBtn = document.getElementById('moveToGuildBtn');
    var deleteSelectedBtn = document.getElementById('deleteSelectedReservesBtn');
    var selectAllBtn = document.getElementById('selectAllReservesBtn');
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function() {
            var checkboxes = document.querySelectorAll('.reserve-checkbox');
            var allChecked = true;
            
            checkboxes.forEach(function(cb) {
                if (!cb.checked) allChecked = false;
            });
            
            checkboxes.forEach(function(cb) {
                cb.checked = !allChecked;
            });
            
            updateReserveButtons();
        });
    }
    
    if (moveToGuildBtn) {
        moveToGuildBtn.addEventListener('click', function() {
            var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
            var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
            
            if (!isAdmin && !isMod) {
                showAlert('Only moderators and admins can move to guild.', 'Error', '❌');
                return;
            }
            
            var checkboxes = document.querySelectorAll('.reserve-checkbox:checked');
            if (checkboxes.length === 0) {
                showAlert('No reserves selected to move.', 'Info', 'ℹ️');
                return;
            }
            
            var day = window.currentDay;
            var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            
            showConfirmation('Move ' + checkboxes.length + ' selected reserve(s) to Guild Members for ' + dayName + '? (Duplicates will be removed)', function() {
                var r = getReserves();
                var gm = getGuildMembers();
                var indices = Array.from(checkboxes).map(function(cb) {
                    return parseInt(cb.dataset.reserve);
                }).sort(function(a, b) { return b - a; });
                
                var playersToMove = [];
                var playersToDelete = [];
                
                indices.forEach(function(idx) {
                    if (r && idx >= 0 && idx < r.length) {
                        var player = r[idx];
                        
                        var exists = gm.some(function(g) {
                            return g.name === player.name && g.class === player.class;
                        });
                        
                        if (exists) {
                            playersToDelete.push(idx);
                        } else {
                            playersToMove.push({ idx: idx, player: player });
                        }
                    }
                });
                
                playersToDelete.sort(function(a, b) { return b - a; });
                playersToDelete.forEach(function(idx) {
                    if (r && idx >= 0 && idx < r.length) {
                        var removedId = r[idx] && r[idx].id;
                        r.splice(idx, 1);
                        if (removedId && typeof trackPlayerRemovals === 'function') {
                            trackPlayerRemovals('reserve', day, removedId);
                        }
                    }
                });
                
                var moveIndices = playersToMove.map(function(item) { return item.idx; }).sort(function(a, b) { return b - a; });
                moveIndices.forEach(function(idx) {
                    if (r && idx >= 0 && idx < r.length) {
                        var player = r[idx];
                        var movedId = player && player.id;
                        r.splice(idx, 1);
                        gm.push(player);
                        if (movedId && typeof trackPlayerRemovals === 'function') {
                            trackPlayerRemovals('reserve', day, movedId);
                        }
                    }
                });
                
                var movedCount = playersToMove.length;
                var deletedCount = playersToDelete.length;
                
                var message = 'Moved ' + movedCount + ' player(s) to Guild Members.';
                if (deletedCount > 0) {
                    message += ' Removed ' + deletedCount + ' duplicate(s) from Reserves.';
                }
                
                updateLastUpdate();
                render();
                showAlert(message, 'Success', '✅');
            });
        });
    }
    
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', function() {
            var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
            var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
            
            if (!isAdmin && !isMod) {
                showAlert('Only moderators and admins can delete reserves.', 'Error', '❌');
                return;
            }
            
            var checkboxes = document.querySelectorAll('.reserve-checkbox:checked');
            if (checkboxes.length === 0) {
                showAlert('No reserves selected for deletion.', 'Info', 'ℹ️');
                return;
            }
            
            showConfirmation('Delete ' + checkboxes.length + ' selected reserve(s)?', function() {
                var r = getReserves();
                var indices = Array.from(checkboxes).map(function(cb) {
                    return parseInt(cb.dataset.reserve);
                }).sort(function(a, b) { return b - a; });
                
                indices.forEach(function(idx) {
                    if (r && idx >= 0 && idx < r.length) {
                        var removedId = r[idx] && r[idx].id;
                        r.splice(idx, 1);
                        if (removedId && typeof trackPlayerRemovals === 'function') {
                            trackPlayerRemovals('reserve', window.currentDay, removedId);
                        }
                    }
                });
                
                updateLastUpdate();
                render();
                showAlert('Deleted ' + indices.length + ' reserve(s).', 'Success', '✅');
            });
        });
    }
}

// ---- Guild Actions ----
function setupGuildActions() {
    const deleteSelectedGuildBtn = document.getElementById('deleteSelectedGuildBtn');
    const moveToReserveBtn = document.getElementById('moveToReserveBtn');
    
    // ---- COPY TO RESERVE (Keep in Guild, Add to Reserves) ----
    if (moveToReserveBtn) {
        moveToReserveBtn.addEventListener('click', function() {
            const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
            if (!isMod) {
                showAlert('Only moderators and admins can copy to reserves.', 'Error', '❌');
                return;
            }
            
            const checkboxes = document.querySelectorAll('.guild-checkbox:checked');
            if (checkboxes.length === 0) {
                showAlert('No guild members selected to copy.', 'Info', 'ℹ️');
                return;
            }
            
            const day = window.currentDay;
            const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            
            showConfirmation(`Copy ${checkboxes.length} selected player(s) from Guild to Reserves for ${dayName}? (Players will remain in Guild)`, function() {
                const r = getReserves();
                const gm = getGuildMembers();
                let copied = 0;
                let skipped = 0;
                
                // Get selected player IDs
                const selectedIds = [];
                checkboxes.forEach(function(cb) {
                    const playerId = cb.dataset.playerId;
                    if (playerId) selectedIds.push(playerId);
                });
                
                selectedIds.forEach(function(playerId) {
                    // Find player in guildMembers
                    const player = gm.find(function(p) { return p.id === playerId; });
                    if (!player) return;
                    
                    // Check if already in reserves
                    const exists = r.some(function(p) { return p.id === playerId; });
                    if (exists) {
                        skipped++;
                        return;
                    }
                    
                    // Copy to reserves
                    r.push({ ...player, id: player.id });
                    copied++;
                });
                
                // Save back to global state
                window.reserves[day] = r;
                
                updateLastUpdate();
                render();
                
                let message = `Copied ${copied} players to Reserves.`;
                if (skipped > 0) {
                    message += ` ${skipped} already in reserves (skipped).`;
                }
                showAlert(message, 'Success', '✅');
            });
        });
    }
    
    // ---- DELETE (Remove from ALL Sources) ----
    if (deleteSelectedGuildBtn) {
        deleteSelectedGuildBtn.addEventListener('click', function() {
            const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
            if (!isAdmin) {
                showAlert('Only admin can delete players.', 'Error', '❌');
                return;
            }
            
            const checkboxes = document.querySelectorAll('.guild-checkbox:checked');
            if (checkboxes.length === 0) {
                showAlert('No guild members selected for deletion.', 'Info', 'ℹ️');
                return;
            }
            
            const day = window.currentDay;
            const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            
            showConfirmation(
                `⚠️ WARNING: This will PERMANENTLY DELETE ${checkboxes.length} selected player(s) from ALL panels (Guild, Groups, Reserves) for ${dayName}. This cannot be undone! Are you sure?`,
                function() {
                    const gm = getGuildMembers();
                    const days = ['sat', 'sun'];
                    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                    let deleted = 0;
                    
                    // Get selected player IDs
                    const selectedIds = [];
                    checkboxes.forEach(function(cb) {
                        const playerId = cb.dataset.playerId;
                        if (playerId) selectedIds.push(playerId);
                    });
                    // Full delete - tombstone these ids so stale copies can't resurrect them
                    if (selectedIds.length > 0 && typeof trackDeletedPlayerIds === 'function') {
                        trackDeletedPlayerIds(selectedIds);
                    }
                    
                    selectedIds.forEach(function(playerId) {
                        let removed = false;
                        
                        // 1. Remove from guildMembers (master list) - both days
                        days.forEach(function(day) {
                            if (window.guildMembers && window.guildMembers[day]) {
                                const idx = window.guildMembers[day].findIndex(function(p) { return p.id === playerId; });
                                if (idx !== -1) {
                                    window.guildMembers[day].splice(idx, 1);
                                    removed = true;
                                }
                            }
                        });
                        
                        // 2. Remove from groups - both days
                        days.forEach(function(day) {
                            groupKeys.forEach(function(key) {
                                if (window.groups && window.groups[day] && window.groups[day][key]) {
                                    const idx = window.groups[day][key].players.findIndex(function(p) { return p.id === playerId; });
                                    if (idx !== -1) {
                                        window.groups[day][key].players.splice(idx, 1);
                                        removed = true;
                                    }
                                }
                            });
                        });
                        
                        // 3. Remove from reserves - both days
                        days.forEach(function(day) {
                            if (window.reserves && window.reserves[day]) {
                                const idx = window.reserves[day].findIndex(function(p) { return p.id === playerId; });
                                if (idx !== -1) {
                                    window.reserves[day].splice(idx, 1);
                                    removed = true;
                                }
                            }
                        });
                        
                        if (removed) deleted++;
                    });
                    
                    updateLastUpdate();
                    render();
                    saveState();
                    showAlert(`Deleted ${deleted} players from all panels.`, 'Success', '✅');
                }
            );
        });
    }
}

// ---- Admin Tools ----
function setupAdminTools() {
    var clearToGuildBtn = document.getElementById('clearToGuildBtn');
    var clearToReserveBtn = document.getElementById('clearToReserveBtn');
    var downloadBackupBtn = document.getElementById('downloadBackupBtn');
    
    if (downloadBackupBtn) {
        downloadBackupBtn.addEventListener('click', function() {
            if (!AuthModule.getToken()) {
                showToast('Please login to download a backup.', 'error', 3000);
                return;
            }
            downloadBackup();
        });
    }
    
    if (clearToGuildBtn) {
        clearToGuildBtn.addEventListener('click', function() {
            if (!AuthModule.isAdmin()) {
                showAlert('Only admin can use this action.', 'Error', '❌');
                return;
            }
            
            showConfirmation('Move all members from groups and reserves to Guild Members for both Saturday and Sunday?', function() {
                var gmSat = window.guildMembers.sat;
                var gmSun = window.guildMembers.sun;
                var days = ['sat', 'sun'];
                var groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                
                days.forEach(function(day) {
                    var allPlayers = [];
                    groupKeys.forEach(function(key) {
                        if (window.groups[day] && window.groups[day][key]) {
                            var clearedIds = window.groups[day][key].players.map(function(p) { return p && p.id; }).filter(Boolean);
                            window.groups[day][key].players.forEach(function(p) {
                                allPlayers.push(p);
                            });
                            window.groups[day][key].players = [];
                            if (clearedIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                                trackPlayerRemovals('group', day, clearedIds, key);
                            }
                        }
                    });
                    
                    if (window.reserves[day]) {
                        var clearedReserveIds = window.reserves[day].map(function(p) { return p && p.id; }).filter(Boolean);
                        window.reserves[day].forEach(function(p) {
                            allPlayers.push(p);
                        });
                        window.reserves[day] = [];
                        if (clearedReserveIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                            trackPlayerRemovals('reserve', day, clearedReserveIds);
                        }
                    }
                    
                    var targetGm = day === 'sat' ? gmSat : gmSun;
                    allPlayers.forEach(function(p) {
                        var exists = targetGm.some(function(g) { return g.name === p.name; });
                        if (!exists) {
                            targetGm.push(p);
                        }
                    });
                });
                
                updateLastUpdate();
                render();
                showAlert('All names moved to Guild Members for both days.', 'Success', '✅');
            });
        });
    }
    
if (clearToReserveBtn) {
    clearToReserveBtn.addEventListener('click', function() {
        if (!AuthModule.isMod()) {
            showAlert('Only moderators and admins can use this action.', 'Error', '❌');
            return;
        }
        
        var day = window.currentDay;
        var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
        
        showConfirmation('Move all members from groups to Reserves for ' + dayName + '?', function() {
            var g = getGroups();
            var r = getReserves();
            var groupKeys = Object.keys(g);
            var allPlayers = [];
            
            // Collect all players from groups
            groupKeys.forEach(function(key) {
                if (g[key] && g[key].players) {
                    var clearedIds = [];
                    g[key].players.forEach(function(p) {
                        if (!p.id) {
                            p.id = generatePlayerId();
                        }
                        clearedIds.push(p.id);
                        allPlayers.push(p);
                    });
                    g[key].players = [];
                    if (clearedIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                        trackPlayerRemovals('group', day, clearedIds, key);
                    }
                }
            });
            
            // Add all players to reserves
            allPlayers.forEach(function(p) {
                r.push(p);
            });
            
            // ---- SAVE BACK TO GLOBAL STATE ----
            window.groups[day] = g;
            window.reserves[day] = r;
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add) {
                History.add('bulk', {
                    details: 'Moved ' + allPlayers.length + ' players to Reserves for ' + dayName,
                    day: day,
                    to: 'reserve'
                });
            }
            
            updateLastUpdate();
            render();
            
            setTimeout(function() {
                if (typeof attachDragListeners === 'function') {
                    attachDragListeners();
                }
            }, 100);
            
            showAlert('All names moved to Reserves for ' + dayName + '.', 'Success', '✅');
        });
    });
}
}

// ---- Admin Controls (roles are data-driven; SuperAdmin manages admins) ----
function setupAdminControls() {
    const approveModBtn = document.getElementById('approveModBtn');
    const approveAdminBtn = document.getElementById('approveAdminBtn');
    const resetModBtn = document.getElementById('resetModBtn');
    const demoteModBtn = document.getElementById('demoteModBtn');
    const modPlayerSelect = document.getElementById('modPlayerSelect');
    const resetModSelect = document.getElementById('resetModSelect');
    const demoteModSelect = document.getElementById('demoteModSelect');

    // Selecting a player enables the New Mod / New Admin buttons (the select is
    // rebuilt on every render, so the listener is attached here once).
    if (modPlayerSelect) {
        modPlayerSelect.addEventListener('change', function() {
            if (typeof updateApproveButton === 'function') updateApproveButton();
        });
    }

    // Shared add-staff flow: role is 'mod' (New Mod) or 'admin' (New Admin, SuperAdmin only)
    function addStaff(name, role) {
        return fetch('/api/moderators/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ username: name, role: role })
        }).then(function(r) { return r.json(); });
    }

    if (approveModBtn) {
        approveModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can approve moderators.', 'Error', '❌');
                return; 
            }
            const name = modPlayerSelect.value;
            if (!name) { 
                showAlert('Select a player from the list.', 'Error', '❌');
                return; 
            }
            
            try {
                const result = await addStaff(name, 'mod');
                if (result.success) {
                    showAlert(`Moderator ${name} added. Password: ${result.password}`, 'Success', '✅');
                    await loadModerators();
                    updateLastUpdate();
                    render();
                    saveState();
                } else {
                    showAlert(result.error || 'Failed to add moderator.', 'Error', '❌');
                }
            } catch (error) {
                console.error('Error adding moderator:', error);
                showAlert('Error adding moderator.', 'Error', '❌');
            }
        });
    }

    if (approveAdminBtn) {
        approveAdminBtn.addEventListener('click', async function() {
            if (!AuthModule.isSuperAdmin()) { 
                showAlert('Only SuperAdmin can add admins.', 'Error', '❌');
                return; 
            }
            const name = modPlayerSelect.value;
            if (!name) { 
                showAlert('Select a player from the list.', 'Error', '❌');
                return; 
            }
            
            try {
                const result = await addStaff(name, 'admin');
                if (result.success) {
                    showAlert(`Admin ${name} added. Password: ${result.password}`, 'Success', '✅');
                    await loadModerators();
                    updateLastUpdate();
                    render();
                    saveState();
                } else {
                    showAlert(result.error || 'Failed to add admin.', 'Error', '❌');
                }
            } catch (error) {
                console.error('Error adding admin:', error);
                showAlert('Error adding admin.', 'Error', '❌');
            }
        });
    }

    if (resetModBtn) {
        resetModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can reset passwords.', 'Error', '❌');
                return; 
            }
            const name = resetModSelect.value;
            if (!name) { 
                showAlert('Select a staff member.', 'Error', '❌');
                return; 
            }
            
            showConfirmation(`Reset password for "${name}" to default?`, async function() {
                try {
                    const response = await fetch('/api/moderators/reset-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ username: name })
                    });
                    const result = await response.json();
                    if (result.success) {
                        await loadState();
                        await loadModerators();
                        updateLastUpdate();
                        render();
                        saveState();
                        showAlert(`Password for ${name} has been reset to ${result.newPassword}`, 'Success', '✅');
                    } else {
                        showAlert('Failed to reset password: ' + (result.error || 'Unknown error'), 'Error', '❌');
                    }
                } catch (error) {
                    console.error('Error resetting password:', error);
                    showAlert('Error resetting password.', 'Error', '❌');
                }
            });
        });
    }

    if (demoteModBtn) {
        demoteModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can demote staff.', 'Error', '❌');
                return; 
            }
            const name = demoteModSelect.value;
            if (!name) { 
                showAlert('Select a staff member to demote.', 'Error', '❌');
                return; 
            }
            const targetRole = window.moderators && window.moderators[name];
            // Demoting an admin is SuperAdmin-only; the server enforces this too.
            if (targetRole === 'admin' && !AuthModule.isSuperAdmin()) {
                showAlert('Only SuperAdmin can demote admins.', 'Error', '❌');
                return;
            }
            
            showConfirmation(`Demote "${name}" from staff to normal member?`, async function() {
                try {
                    const response = await fetch('/api/moderators/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ username: name })
                    });
                    const result = await response.json();
                    if (result.success) {
                        await loadState();
                        await loadModerators();
                        updateLastUpdate();
                        render();
                        saveState();
                        showAlert(`${name} has been demoted.`, 'Success', '✅');
                    } else {
                        showAlert('Failed to demote: ' + (result.error || 'Unknown error'), 'Error', '❌');
                    }
                } catch (error) {
                    console.error('Error demoting:', error);
                    showAlert('Error demoting staff.', 'Error', '❌');
                }
            });
        });
    }
}

// ---- Change Password ----
function setupChangePassword() {
    const changePwCloseBtn = document.getElementById('changePwCloseBtn');
    const changePwModal = document.getElementById('changePwModal');
    const changePwForm = document.getElementById('changePwForm');
    const changePwError = document.getElementById('changePwError');
    const changePwSuccess = document.getElementById('changePwSuccess');
    const newPwInput = document.getElementById('newPwInput');
    const confirmPwInput = document.getElementById('confirmPwInput');
    
    if (changePwCloseBtn) {
        changePwCloseBtn.addEventListener('click', () => { changePwModal.classList.remove('active'); });
    }
    if (changePwModal) {
        changePwModal.addEventListener('click', (e) => { 
            if (e.target === changePwModal) changePwModal.classList.remove('active'); 
        });
    }

    if (changePwForm) {
        changePwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPwInput = document.getElementById('oldPwInput');
            const oldPw = oldPwInput ? oldPwInput.value : '';
            const newPw = newPwInput.value.trim();
            const confirm = confirmPwInput.value.trim();
            if (changePwError) changePwError.textContent = '';
            if (changePwSuccess) changePwSuccess.textContent = '';
            
            if (!oldPw) { 
                if (changePwError) changePwError.textContent = 'Please enter your current password.'; 
                return; 
            }
            if (newPw.length < 4) { 
                if (changePwError) changePwError.textContent = 'Password must be at least 4 characters.'; 
                return; 
            }
            if (newPw !== confirm) { 
                if (changePwError) changePwError.textContent = 'Passwords do not match.'; 
                return; 
            }
            
            // Use AuthModule.currentUser (window.currentUser is never set)
            const current = AuthModule.currentUser;
            if (current && current.role === 'mod' && current.name) {
                try {
                    const response = await fetch('/api/moderators/change-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ 
                            username: current.name, 
                            oldPassword: oldPw,
                            newPassword: newPw 
                        })
                    });
                    const result = await response.json();
                    if (result.success) {
                        if (changePwSuccess) changePwSuccess.textContent = 'Password updated!';
                        if (oldPwInput) oldPwInput.value = '';
                        newPwInput.value = '';
                        confirmPwInput.value = '';
                        setTimeout(() => { changePwModal.classList.remove('active'); }, 800);
                    } else {
                        if (changePwError) changePwError.textContent = result.error || 'Failed to update password.';
                    }
                } catch (error) {
                    console.error('Error changing password:', error);
                    if (changePwError) changePwError.textContent = 'Error updating password.';
                }
            } else {
                if (changePwError) changePwError.textContent = 'Only moderators can change their password.';
            }
        });
    }
}

// ---- Day tabs ----
function setupDayTabs() {
    const dayTabs = document.querySelectorAll('.day-tab');
    
    const savedDay = getCookie('guild_current_day');
    if (savedDay && (savedDay === 'sat' || savedDay === 'sun')) {
        window.currentDay = savedDay;
        dayTabs.forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.day === savedDay) {
                tab.classList.add('active');
            }
        });
    }
    
    dayTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            dayTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            window.currentDay = this.dataset.day;
            setCookie('guild_current_day', window.currentDay, 7);
            render();
        });
    });
}

// ---- Scroll shadow for header ----
function setupScrollShadow() {
    const header = document.querySelector('.header-wrapper');
    const tabs = document.querySelector('.sticky-tabs');
    
    if (header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 10) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }
    
    if (tabs) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 80) {
                tabs.classList.add('scrolled');
            } else {
                tabs.classList.remove('scrolled');
            }
        });
    }
}

// ---- Collapsible panels (click a header to expand/collapse, persisted) ----
function saveCollapseState() {
    try {
        var collapsed = [];
        document.querySelectorAll('.collapsible.collapsed').forEach(function(p) {
            if (p.id) collapsed.push(p.id);
        });
        localStorage.setItem('gw_collapsed_panels', JSON.stringify(collapsed));
    } catch (e) {}
}

function restoreCollapseState() {
    try {
        var raw = localStorage.getItem('gw_collapsed_panels');
        if (!raw) return;
        var collapsed = JSON.parse(raw);
        if (!Array.isArray(collapsed)) return;
        collapsed.forEach(function(id) {
            var panel = document.getElementById(id);
            if (panel) panel.classList.add('collapsed');
        });
    } catch (e) {}
}

function setupCollapsiblePanels() {
    document.querySelectorAll('.collapsible').forEach(function(panel) {
        var h3 = panel.querySelector('h3');
        if (!h3) return;
        // The header ROW is the direct child of the panel that contains the h3
        // (h3 itself for most panels; the flex wrapper in the admin panel;
        // .reserve-header / .guild-header for those areas). The chevron lives
        // in the row so it always sits at the panel's top-right, uniformly.
        var row = h3;
        while (row.parentElement && row.parentElement !== panel) {
            row = row.parentElement;
        }
        row.classList.add('panel-header-row');
        if (!row.querySelector('.collapse-chevron')) {
            var chevron = document.createElement('span');
            chevron.className = 'collapse-chevron';
            chevron.innerHTML = '<i class="fas fa-chevron-up"></i>';
            row.appendChild(chevron);
        }
        row.addEventListener('click', function(e) {
            // Don't toggle when clicking an interactive child inside the header row
            if (e.target.closest('button, input, select, a')) return;
            panel.classList.toggle('collapsed');
            saveCollapseState();
        });
    });
    restoreCollapseState();
}

// ---- Help & Shortcuts panel (below guild panel, role-aware) ----
// Public viewers only see what applies to them: registration, collapsing
// panels, and a hint to log in for the editing tools.
function renderHelpPanel() {
    var container = document.getElementById('helpShortcuts');
    if (!container) return;
    
    var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    
    if (!isMod) {
        container.innerHTML =
            '<div style="font-size:var(--font-size-sm); color:var(--text-secondary); line-height:1.7;">' +
                '<i class="fas fa-info-circle"></i> Editing tools (drag &amp; drop, right-click menu, keyboard shortcuts, bulk actions) are for moderators and admins. ' +
                'Log in with a moderator account to use them. You can still download the roster as an <em>Image</em> or <em>PDF</em> below.' +
            '</div>';
    } else if (typeof Shortcuts !== 'undefined' && Shortcuts.shortcuts) {
        var entries = Object.keys(Shortcuts.shortcuts).map(function(combo) {
            return { combo: combo, description: Shortcuts.shortcuts[combo].description };
        });
        container.innerHTML =
            '<h4 style="font-weight:600; color:var(--text-primary); margin-bottom:var(--spacing-xs); display:flex; align-items:center; gap:var(--spacing-sm);"><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h4>' +
            '<div class="help-shortcuts-grid">' +
            entries.map(function(entry) {
                return '<div class="help-shortcut-item"><kbd>' + entry.combo.replace(/\+/g, ' + ').toUpperCase() + '</kbd><span>' + entry.description + '</span></div>';
            }).join('') +
            '</div>';
    }
    
    // Toggle the mod-only guide bullets
    document.querySelectorAll('#helpPanel [data-help-role="mod"]').forEach(function(el) {
        el.style.display = isMod ? '' : 'none';
    });
}

// ---- Init ----
async function init() {
    console.log('Initializing application...');
    
    try {
        // Check required modules
        if (typeof AuthModule === 'undefined') {
            throw new Error('AuthModule not loaded.');
        }
        if (typeof EventHandlers === 'undefined') {
            throw new Error('EventHandlers not loaded.');
        }
        if (typeof RenderHelpers === 'undefined') {
            throw new Error('RenderHelpers not loaded.');
        }
        
        console.log('All modules loaded successfully');
        
        // Initialize AuthModule
        AuthModule.init();
        console.log('AuthModule initialized');
        
        // Load moderator list so Reset PW / Demote controls have options
        if (AuthModule.isAdmin()) {
            loadModerators();
        }
        
        // Load data
        var loaded = await loadState();
        console.log('Data loaded:', loaded);
        
        if (!loaded) {
            initializeEmptyData();
            window.lastUpdateTime = new Date().toLocaleString();
            var lastUpdateEl = document.getElementById('lastUpdate');
            if (lastUpdateEl) {
                lastUpdateEl.textContent = 'Last update: ' + formatUpdateTime(window.lastUpdateTime);
            }
        }

        if (!window.lastUpdateTime) {
            updateLastUpdate();
        }
		
		// START DATA SYNC ENGINE (Phase 4.1)
		// Poll server every 30s so all users see the same data
		startDataSync();
		console.log('Data sync engine started (polling every ' + (SYNC_INTERVAL/1000) + 's)');
		
        // Initialize BulkActions
        if (typeof BulkActions !== 'undefined') {
            BulkActions.init();
            console.log('BulkActions initialized');
        }
		
		// Initialize History
		if (typeof History !== 'undefined') {
			History.init();
			console.log('History initialized');
		}

		// Initialize Shortcuts
		if (typeof Shortcuts !== 'undefined') {
			Shortcuts.init();
			console.log('Shortcuts initialized');
		}

		// Help & Shortcuts panel (Phase: help/guide)
		renderHelpPanel();

		// Collapsible panels (persisted per user)
		setupCollapsiblePanels();

		// Initialize Context Menu + keyboard select (Phase 7)
		if (typeof ContextMenu !== 'undefined') {
			ContextMenu.init();
			console.log('ContextMenu initialized');
		}

		// Export Roster buttons (Phase 10)
		if (typeof ExportPanel !== 'undefined') {
			ExportPanel.init();
			console.log('ExportPanel initialized');
		}

		// Setup history clear button
		const clearHistoryBtn = document.getElementById('clearHistoryBtn');
		if (clearHistoryBtn) {
			clearHistoryBtn.addEventListener('click', () => {
				if (typeof History !== 'undefined') {
				History.clear();
				}
			});
		}
		
        console.log('Setting up event listeners...');
        AuthModule.setupLoginListeners();
        EventHandlers.setupEditListeners();
        EventHandlers.setupTitleListeners();
        EventHandlers.setupCheckboxListeners();
        
        // Setup features
        setupChangePassword();
        setupRegistration();
        setupReserveActions();
        setupGuildActions();
        setupAdminTools();
        setupAdminControls();
        setupDayTabs();
        setupAnnouncement();
        setupGroupManagement();
        setupGuildNameEditor();
		// Setup scroll shadow
        setupScrollShadow();
        
        // Note: ThemeManager is initialized in theme.js
        console.log('Initializing drag and drop...');
        if (typeof attachDragListeners === 'function') {
            attachDragListeners();
        } else {
            console.warn('attachDragListeners not available');
        }
        
        console.log('Rendering UI...');
        AuthModule.updateUI();
        
        if (typeof render === 'function') {
            render();
        } else {
            throw new Error('Render function not defined');
        }
        
        console.log('Application initialized successfully!');
        
    } catch (error) {
        console.error('Error during initialization:', error);
        var errorMsg = 'Failed to initialize application: ' + error.message;
        if (typeof showAlert === 'function') {
            showAlert(errorMsg, 'Error', '❌');
        } else {
            alert(errorMsg);
        }
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}