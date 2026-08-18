// ============================================================
//  RENDER - UI rendering using helpers
// ============================================================

function render() {
    console.log('Rendering...');
    
    try {
        if (typeof AuthModule === 'undefined') {
            console.error('AuthModule not available');
            return;
        }
        
        if (typeof RenderHelpers === 'undefined') {
            console.error('RenderHelpers not available');
            return;
        }
        
        var g = getGroups();
		var r = getReserves();
        var canEdit = AuthModule.isMod();
		
        console.log('render() - r from getReserves():', r);
        console.log('render() - r length:', r ? r.length : 0);
        console.log('render() - window.reserves:', window.reserves);
		
        // Render groups
        if (RenderHelpers.renderGroups) {
            RenderHelpers.renderGroups(g, canEdit);
        }
        
        // Render reserves
        if (RenderHelpers.renderReserves) {
            RenderHelpers.renderReserves(r, canEdit);
        }
        
        // Render guild members as cards
        if (RenderHelpers.renderGuildCards) {
            RenderHelpers.renderGuildCards();
        }
        
        renderAdminPanel();
        renderAnnouncement();
        updateModSelects();
        updateApproveButton();
        updateReserveButtons();
        updateGroupLimitWarning();
        updateGroupStats();
        
    // Refresh history panel
    refreshHistoryPanel();
           
        // Re-attach drag listeners
        setTimeout(function() {
            if (typeof attachDragListeners === 'function') {
                attachDragListeners();
                console.log('Drag listeners re-attached after render');
            }
        }, 50);
        
        // NOTE: render() no longer calls saveState(). Saving on every render
        // let public visitors overwrite server data with their (possibly stale)
        // local copy. Mutations save explicitly via updateLastUpdate()/saveState().
        
        console.log('Render complete');
        
    } catch (error) {
        console.error('Error during render:', error);
    }
}

// Refresh history panel
function refreshHistoryPanel() {
    if (typeof History !== 'undefined' && History.renderHistory) {
        History.renderHistory();
    }
}

// Render admin panel
function renderAdminPanel() {
    try {
        var userRoleDisplay = document.getElementById('userRoleDisplay');
        var adminList = document.getElementById('adminList');
        var adminPanel = document.getElementById('adminPanel');
        var modArea = document.getElementById('modArea');
        var announcementPanel = document.getElementById('announcementPanel');
        var editAnnouncementBtn = document.getElementById('editAnnouncementBtn');
        
        if (adminList) {
            // Staff list is data-driven (window.moderators = { name: role });
            // no usernames are hardcoded here.
            adminList.innerHTML = '';
            var staffNames = Object.keys(window.moderators || {});
            var roleRank = { superadmin: 0, admin: 1, mod: 2 };
            staffNames.sort(function(a, b) {
                var ra = roleRank[window.moderators[a]] !== undefined ? roleRank[window.moderators[a]] : 3;
                var rb = roleRank[window.moderators[b]] !== undefined ? roleRank[window.moderators[b]] : 3;
                return ra - rb;
            });
            staffNames.forEach(function(name) {
                var role = window.moderators[name] || 'mod';
                var icon = role === 'superadmin' ? 'fa-crown' : role === 'admin' ? 'fa-shield-halved' : 'fa-check-circle';
                var label = role === 'superadmin' ? 'Lead' : role === 'admin' ? 'Admin' : 'Mod';
                var tag = document.createElement('span');
                tag.className = 'admin-tag';
                tag.innerHTML = '<i class="fas ' + icon + '"></i> ' + label + ': ' + (typeof esc === 'function' ? esc(name) : name);
                adminList.appendChild(tag);
            });
        }
        
        if (adminPanel) adminPanel.style.display = 'block';
        if (announcementPanel) announcementPanel.style.display = 'block';
        
        if (modArea) modArea.style.display = AuthModule.isAdmin() ? 'block' : 'none';
        if (editAnnouncementBtn) {
            editAnnouncementBtn.style.display = AuthModule.isMod() ? 'inline-flex' : 'none';
        }
    } catch (error) {
        console.error('Error in renderAdminPanel:', error);
    }
}

function updateModSelects() {
    try {
        var modPlayerSelect = document.getElementById('modPlayerSelect');
        var resetModSelect = document.getElementById('resetModSelect');
        var demoteModSelect = document.getElementById('demoteModSelect');
        
        if (modPlayerSelect) {
            modPlayerSelect.innerHTML = '<option value="">-- select player --</option>';
            var all = getAllPlayers();
            var gm = getAllRegisteredPlayers();
            var allPlayers = all.concat(gm);
            var names = {};
            for (var i = 0; i < allPlayers.length; i++) {
                names[allPlayers[i].name] = true;
            }
            for (var name in names) {
                // Anyone already on staff (any role) can't be re-added
                if (name && !window.moderators[name]) {
                    var opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    modPlayerSelect.appendChild(opt);
                }
            }
        }

        var isSuperAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isSuperAdmin() : false;
        var selects = [resetModSelect, demoteModSelect];
        for (var s = 0; s < selects.length; s++) {
            var select = selects[s];
            if (select) {
                select.innerHTML = '<option value="">-- select mod --</option>';
                for (var name in window.moderators) {
                    var role = window.moderators[name];
                    // SuperAdmin itself can't be demoted/reset; admins only appear for SuperAdmin
                    if (role === 'superadmin') continue;
                    if (role === 'admin' && !isSuperAdmin) continue;
                    var opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                }
            }
        }
    } catch (error) {
        console.error('Error in updateModSelects:', error);
    }
}

function updateApproveButton() {
    try {
        var approveModBtn = document.getElementById('approveModBtn');
        var approveAdminBtn = document.getElementById('approveAdminBtn');
        var modPlayerSelect = document.getElementById('modPlayerSelect');
        var hasSelection = !!modPlayerSelect && !!modPlayerSelect.value;
        if (approveModBtn) {
            approveModBtn.disabled = !hasSelection;
        }
        if (approveAdminBtn) {
            approveAdminBtn.disabled = !hasSelection;
        }
    } catch (error) {
        console.error('Error in updateApproveButton:', error);
    }
}

// Update reserve action buttons visibility
function updateReserveButtons() {
    try {
        var reserveCheckboxes = document.querySelectorAll('.reserve-checkbox:checked');
        var totalCheckboxes = document.querySelectorAll('.reserve-checkbox');
        var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
        var selectAllBtn = document.getElementById('selectAllReservesBtn');
        var moveToGuildBtn = document.getElementById('moveToGuildBtn');
        var deleteSelectedBtn = document.getElementById('deleteSelectedReservesBtn');
        
        if (totalCheckboxes.length > 0 && (isAdmin || isMod)) {
            if (selectAllBtn) selectAllBtn.style.display = 'inline-flex';
            
            if (reserveCheckboxes.length > 0) {
                if (moveToGuildBtn) moveToGuildBtn.style.display = 'inline-flex';
                if (deleteSelectedBtn) deleteSelectedBtn.style.display = 'inline-flex';
            } else {
                if (moveToGuildBtn) moveToGuildBtn.style.display = 'none';
                if (deleteSelectedBtn) deleteSelectedBtn.style.display = 'none';
            }
        } else {
            if (selectAllBtn) selectAllBtn.style.display = 'none';
            if (moveToGuildBtn) moveToGuildBtn.style.display = 'none';
            if (deleteSelectedBtn) deleteSelectedBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Error in updateReserveButtons:', error);
    }
}

// new function to show warnings
function updateGroupLimitWarning() {
    try {
        var day = window.currentDay;
        var total = getTotalGroupPlayers(day);
        var groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
        var groups = window.groups && window.groups[day] ? window.groups[day] : {};
        
        document.querySelectorAll('.group-limit-warning').forEach(function(el) {
            el.remove();
        });
        
        if (total > 30) {
            for (var i = 0; i < groupKeys.length; i++) {
                var key = groupKeys[i];
                if (groups[key]) {
                    var card = document.querySelector('.group-card[data-group="' + key + '"]');
                    if (card) {
                        var titleSpan = card.querySelector('.group-title .title-left');
                        if (titleSpan) {
                            var warning = document.createElement('span');
                            warning.className = 'group-limit-warning';
                            warning.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + total + '/30';
                            titleSpan.appendChild(warning);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in updateGroupLimitWarning:', error);
    }
}

// Update role dropdown
function updateRoleDropdown() {
    try {
        var playerRoleSelect = document.getElementById('playerRole');
        if (playerRoleSelect) {
            playerRoleSelect.disabled = !AuthModule.isMod();
            if (!AuthModule.isMod()) {
                playerRoleSelect.value = 'Member';
            }
        }
    } catch (error) {
        console.error('Error in updateRoleDropdown:', error);
    }
}

// Update group stats (total players, duplicates, etc.)
function updateGroupStats() {
    try {
        var day = window.currentDay;
        var groups = window.groups && window.groups[day] ? window.groups[day] : {};
        var groupKeys = Object.keys(groups);
        var totalPlayers = 0;
        var duplicateCount = 0;
        var playerMap = {};
        
        // Count total players and duplicates
        groupKeys.forEach(function(key) {
            if (groups[key] && groups[key].players) {
                groups[key].players.forEach(function(p) {
                    totalPlayers++;
                    var playerKey = p.name + '|' + p.class;
                    if (playerMap[playerKey]) {
                        playerMap[playerKey]++;
                        if (playerMap[playerKey] === 2) duplicateCount++;
                    } else {
                        playerMap[playerKey] = 1;
                    }
                });
            }
        });
        
        // Update the stats display
        var groupCountEl = document.getElementById('groupCountDisplay');
        var totalPlayersEl = document.getElementById('totalPlayersDisplay');
        var duplicateCountEl = document.getElementById('duplicateCountDisplay');
        var duplicateStatsEl = document.getElementById('duplicateStats');
        
        if (groupCountEl) groupCountEl.textContent = groupKeys.length;
        if (totalPlayersEl) totalPlayersEl.textContent = totalPlayers;
        if (duplicateCountEl) duplicateCountEl.textContent = duplicateCount;
        
        if (duplicateStatsEl) {
            if (duplicateCount > 0) {
                duplicateStatsEl.className = 'stat-item has-duplicates';
            } else {
                duplicateStatsEl.className = 'stat-item no-duplicates';
            }
        }
    } catch (error) {
        console.error('Error in updateGroupStats:', error);
    }
}