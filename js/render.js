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
        
        const g = getGroups();
		const r = getReserves();
        const canEdit = AuthModule.isMod();
		
        console.log('render() - r from getReserves():', r);
        console.log('render() - r length:', r ? r.length : 0);
        console.log('render() - App.state.reserves:', App.state.reserves);
		
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
        const userRoleDisplay = document.getElementById('userRoleDisplay');
        const adminList = document.getElementById('adminList');
        const adminPanel = document.getElementById('adminPanel');
        const modArea = document.getElementById('modArea');
        const announcementPanel = document.getElementById('announcementPanel');
        const editAnnouncementBtn = document.getElementById('editAnnouncementBtn');
        
        if (adminList) {
            // Staff list is data-driven (App.state.moderators = { name: role });
            // no usernames are hardcoded here.
            adminList.innerHTML = '';
            const staffNames = Object.keys(App.state.moderators || {});
            const roleRank = { superadmin: 0, admin: 1, mod: 2 };
            staffNames.sort(function(a, b) {
                const ra = roleRank[App.state.moderators[a]] !== undefined ? roleRank[App.state.moderators[a]] : 3;
                const rb = roleRank[App.state.moderators[b]] !== undefined ? roleRank[App.state.moderators[b]] : 3;
                return ra - rb;
            });
            staffNames.forEach(function(name) {
                const role = App.state.moderators[name] || 'mod';
                const icon = role === 'superadmin' ? 'fa-crown' : role === 'admin' ? 'fa-shield-alt' : 'fa-check-circle';
                const label = role === 'superadmin' ? 'Lead' : role === 'admin' ? 'Admin' : 'Mod';
                const tag = document.createElement('span');
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
        const modPlayerSelect = document.getElementById('modPlayerSelect');
        const resetModSelect = document.getElementById('resetModSelect');
        const demoteModSelect = document.getElementById('demoteModSelect');
        
        if (modPlayerSelect) {
            modPlayerSelect.innerHTML = '<option value="">-- select player --</option>';
            const all = getAllPlayers();
            const gm = getAllRegisteredPlayers();
            const allPlayers = all.concat(gm);
            const names = {};
            for (let i = 0; i < allPlayers.length; i++) {
                names[allPlayers[i].name] = true;
            }
            for (const name in names) {
                // Anyone already on staff (any role) can't be re-added
                if (name && !App.state.moderators[name]) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    modPlayerSelect.appendChild(opt);
                }
            }
        }

        const isSuperAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isSuperAdmin() : false;
        const selects = [resetModSelect, demoteModSelect];
        for (let s = 0; s < selects.length; s++) {
            const select = selects[s];
            if (select) {
                select.innerHTML = '<option value="">-- select mod --</option>';
                for (const name in App.state.moderators) {
                    const role = App.state.moderators[name];
                    // SuperAdmin itself can't be demoted/reset; admins only appear for SuperAdmin
                    if (role === 'superadmin') continue;
                    if (role === 'admin' && !isSuperAdmin) continue;
                    const opt = document.createElement('option');
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
        const approveModBtn = document.getElementById('approveModBtn');
        const approveAdminBtn = document.getElementById('approveAdminBtn');
        const modPlayerSelect = document.getElementById('modPlayerSelect');
        const hasSelection = !!modPlayerSelect && !!modPlayerSelect.value;
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
        const reserveCheckboxes = document.querySelectorAll('.reserve-checkbox:checked');
        const totalCheckboxes = document.querySelectorAll('.reserve-checkbox');
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
        const selectAllBtn = document.getElementById('selectAllReservesBtn');
        const moveToGuildBtn = document.getElementById('moveToGuildBtn');
        const deleteSelectedBtn = document.getElementById('deleteSelectedReservesBtn');
        
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
        const day = window.currentDay;
        const total = getTotalGroupPlayers(day);
        const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
        const groups = App.state.groups && App.state.groups[day] ? App.state.groups[day] : {};
        
        document.querySelectorAll('.group-limit-warning').forEach(function(el) {
            el.remove();
        });
        
        if (total > 30) {
            for (let i = 0; i < groupKeys.length; i++) {
                const key = groupKeys[i];
                if (groups[key]) {
                    const card = document.querySelector('.group-card[data-group="' + key + '"]');
                    if (card) {
                        const titleSpan = card.querySelector('.group-title .title-left');
                        if (titleSpan) {
                            const warning = document.createElement('span');
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
        const playerRoleSelect = document.getElementById('playerRole');
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
        const day = window.currentDay;
        const groups = App.state.groups && App.state.groups[day] ? App.state.groups[day] : {};
        const groupKeys = Object.keys(groups);
        let totalPlayers = 0;
        let duplicateCount = 0;
        const playerMap = {};
        
        // Count total players and duplicates
        groupKeys.forEach(function(key) {
            if (groups[key] && groups[key].players) {
                groups[key].players.forEach(function(p) {
                    totalPlayers++;
                    const playerKey = p.name + '|' + p.class;
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
        const groupCountEl = document.getElementById('groupCountDisplay');
        const totalPlayersEl = document.getElementById('totalPlayersDisplay');
        const duplicateCountEl = document.getElementById('duplicateCountDisplay');
        const duplicateStatsEl = document.getElementById('duplicateStats');
        
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