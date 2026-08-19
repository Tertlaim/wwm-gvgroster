// ============================================================
// MAIN - Application initialization (FULL VERSION)
// ============================================================

// ---- CONFIG ----
const ADMIN_USER = 'SuperAdmin';
const DEFAULT_MOD_PW = 'Admin123';

// ---- Global state ----
window.currentUser = null;
window.currentDay = 'sat';
App.state.groups = {};
App.state.reserves = {};
App.state.guildMembers = [];
App.state.moderators = {};
App.state.lastUpdateTime = null;
App.state.announcement = { text: '', author: '', timestamp: '' };
window._pendingRemovals = { groups: {}, reserves: {}, guildMembers: [] };
window._pendingDeletedIds = new Set();

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
    App.state.lastUpdateTime = formatted;
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = `Last update: ${formatUpdateTime(App.state.lastUpdateTime)}`;
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
        groups: App.state.groups, 
        reserves: App.state.reserves, 
        guildMembers: App.state.guildMembers, 
        lastUpdateTime: App.state.lastUpdateTime,
        announcement: App.state.announcement,
        guildName: App.state.guildName || 'Mask Sinners',
        // Concurrency metadata (Phase 4.5): the base version this snapshot
        // is derived from, ids fully deleted, and ids removed from specific
        // lists since our last save. The server merges stale snapshots and
        // applies these removals on top.
        baseVersion: window._serverLastUpdatedTime || null,
        deletedIds: Array.from(window._pendingDeletedIds || []),
        removed: (window._pendingRemovals || { groups: {}, reserves: {}, guildMembers: [] })
    };
    
    const result = await saveDataToServer(data);
    if (result && result.lastUpdate) {
        App.state.lastUpdateTime = result.lastUpdate;
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

// ---- Load staff list (everyone) so the Admin panel shows who the
// admins/moderators are, and Reset PW / Demote / role display work. ----
// Roles come from the public /api/staff endpoint (names + roles only,
// never credentials) - nothing is hardcoded here.
async function loadModerators() {
    try {
        const headers = getAuthHeader();
        const response = await fetch('/api/staff', headers && Object.keys(headers).length ? { headers: headers } : undefined);
        if (!response.ok) return;
        const result = await response.json();
        App.state.moderators = {};
        if (result && Array.isArray(result.users)) {
            result.users.forEach(user => {
                if (user && user.username) App.state.moderators[user.username] = user.role || 'mod';
            });
        }
    } catch (error) {
        console.error('Error loading staff:', error);
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
    App.state.lastUpdateTime = new Date().toLocaleString('en-US', { 
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
    
    App.state.groups = serverData.groups || {};
    App.state.reserves = serverData.reserves || {};
    App.state.guildMembers = serverData.guildMembers || [];
    App.state.guildName = serverData.guildName || 'Mask Sinners';
    
    if (serverData.lastUpdateTime) {
        App.state.lastUpdateTime = serverData.lastUpdateTime;
        const lastUpdateEl = document.getElementById('lastUpdate');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `Last update: ${formatUpdateTime(App.state.lastUpdateTime)}`;
        }
    }
    
    // Update announcement (backward compat: accept string or object)
    if (serverData.announcement) {
        if (typeof serverData.announcement === 'string') {
            App.state.announcement = { text: serverData.announcement, author: '', timestamp: '' };
        } else if (typeof serverData.announcement === 'object') {
            App.state.announcement = serverData.announcement;
        }
        if (typeof renderAnnouncement === 'function') {
            renderAnnouncement();
        }
    }
    
    // Update guild name display
    const guildNameDisplay = document.getElementById('guildNameDisplay');
    if (guildNameDisplay && App.state.guildName) {
        guildNameDisplay.textContent = App.state.guildName;
    }
    
    // Track server time for change detection
    window._serverLastUpdatedTime = serverTime;
    window._lastSyncedAt = Date.now();
}

// ---- SYNC ENGINE: Poll server every 30 seconds (Phase 4.1) ----
function initializeEmptyData() {
    App.state.groups = {
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
    App.state.reserves = { sat: [], sun: [] };
    App.state.guildMembers = [];
    App.state.guildName = 'Mask Sinners';
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
        if (!isMod) return;
        
        const original = App.state.guildName || guildNameDisplay.textContent || '';
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
            App.state.guildName = name;
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
                    const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
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
        const days = [];
        if (daySat) days.push('sat');
        if (daySun) days.push('sun');
        
        confirmRegisterBtn.disabled = true;
        const result = await registerPlayer(name, cls, days);
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
    const deleteSelectedBtn = document.getElementById('deleteSelectedReservesBtn');
    const selectAllBtn = document.getElementById('selectAllReservesBtn');
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function() {
            const checkboxes = document.querySelectorAll('.reserve-checkbox');
            let allChecked = true;
            
            checkboxes.forEach(function(cb) {
                if (!cb.checked) allChecked = false;
            });
            
            checkboxes.forEach(function(cb) {
                cb.checked = !allChecked;
            });
            
            updateReserveButtons();
        });
    }
    
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', function() {
            const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
            const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
            
            if (!isAdmin && !isMod) {
                showAlert('Only moderators and admins can delete reserves.', 'Error', '❌');
                return;
            }
            
            const checkboxes = document.querySelectorAll('.reserve-checkbox:checked');
            if (checkboxes.length === 0) {
                showAlert('No reserves selected for deletion.', 'Info', 'ℹ️');
                return;
            }
            
            showConfirmation('Delete ' + checkboxes.length + ' selected reserve(s)?', function() {
                const r = getReserves();
                const indices = Array.from(checkboxes).map(function(cb) {
                    return parseInt(cb.dataset.reserve);
                }).sort(function(a, b) { return b - a; });
                
                indices.forEach(function(idx) {
                    if (r && idx >= 0 && idx < r.length) {
                        const removedId = r[idx] && r[idx].id;
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
                App.state.reserves[day] = r;
                
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
                    // Phase 13 fix: track guildMembers removals so the server applies them
                    if (selectedIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                        selectedIds.forEach(function(id) {
                            trackPlayerRemovals('guild', day, id);
                        });
                    }
                    
                    selectedIds.forEach(function(playerId) {
                        let removed = false;
                        
                        // 1. Remove from guildMembers (master list - flat array)
                        if (Array.isArray(App.state.guildMembers)) {
                            const gmIdx = App.state.guildMembers.findIndex(function(p) { return p.id === playerId; });
                            if (gmIdx !== -1) {
                                App.state.guildMembers.splice(gmIdx, 1);
                                removed = true;
                            }
                        }
                        
                        // 2. Remove from groups - both days
                        days.forEach(function(day) {
                            groupKeys.forEach(function(key) {
                                if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                                    const idx = App.state.groups[day][key].players.findIndex(function(p) { return p.id === playerId; });
                                    if (idx !== -1) {
                                        App.state.groups[day][key].players.splice(idx, 1);
                                        removed = true;
                                    }
                                }
                            });
                        });
                        
                        // 3. Remove from reserves - both days
                        days.forEach(function(day) {
                            if (App.state.reserves && App.state.reserves[day]) {
                                const idx = App.state.reserves[day].findIndex(function(p) { return p.id === playerId; });
                                if (idx !== -1) {
                                    App.state.reserves[day].splice(idx, 1);
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
// ---- Help & Shortcuts panel (below guild panel, role-aware) ----
// Public viewers only see what applies to them: registration, collapsing
// panels, and a hint to log in for the editing tools.
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
        
        // Load staff list for everyone (public info: who the admins/mods are)
        await loadModerators();
        
        // Load data
        const loaded = await loadState();
        console.log('Data loaded:', loaded);
        
        if (!loaded) {
            initializeEmptyData();
            App.state.lastUpdateTime = new Date().toLocaleString();
            const lastUpdateEl = document.getElementById('lastUpdate');
            if (lastUpdateEl) {
                lastUpdateEl.textContent = 'Last update: ' + formatUpdateTime(App.state.lastUpdateTime);
            }
        }

        if (!App.state.lastUpdateTime) {
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

		// Modal focus trap (accessibility)
		setupModalFocusTraps();

		// History clear button is set up by History.init()
		
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
        const errorMsg = 'Failed to initialize application: ' + error.message;
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