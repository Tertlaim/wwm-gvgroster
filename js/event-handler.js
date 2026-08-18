// ============================================================
//  EVENT HANDLERS - Unified event management
// ============================================================

const EventHandlers = {};

EventHandlers.toggleEditMode = function(element, enable) {
    if (!element) return;
    
    // Phase 8.3: an open edit form blocks incoming syncs so the input is
    // never wiped mid-edit; the session ends on save/cancel.
    if (enable) {
        if (typeof beginUserEdit === 'function') beginUserEdit();
    } else {
        if (typeof endUserEdit === 'function') endUserEdit();
    }
    
    const displayMode = element.querySelectorAll('.display-mode');
    const editMode = element.querySelectorAll('.edit-mode');
    const actionButtons = element.querySelectorAll('.action-buttons');
    // The return-to-reserves arrow is a two-step action; pause it while editing
    // so it does not crowd the save/cancel buttons.
    const returnButtons = element.querySelectorAll('[data-action="return"]');
    
    for (let i = 0; i < displayMode.length; i++) {
        displayMode[i].style.display = enable ? 'none' : '';
    }
    for (let i = 0; i < editMode.length; i++) {
        editMode[i].style.display = enable ? '' : 'none';
    }
    for (let i = 0; i < actionButtons.length; i++) {
        actionButtons[i].style.display = enable ? '' : 'none';
    }
    for (let i = 0; i < returnButtons.length; i++) {
        returnButtons[i].style.display = enable ? 'none' : '';
    }
    
    if (enable) {
        const input = element.querySelector('.edit-input');
        if (input) {
            setTimeout(function() {
                input.focus();
                // Set cursor to end, but allow clicking anywhere
                const length = input.value.length;
                input.setSelectionRange(length, length);
            }, 10);
        }
    }
};

EventHandlers.saveItem = function(event) {
    const button = event.target.closest('[data-action="save"]');
    if (!button) return;
    
    const element = button.closest('[data-editable]');
    if (!element) {
        console.warn('No editable element found');
        showToast('Failed to update player. Please try again.', 'error', 2000);
        return;
    }
    
    const input = element.querySelector('.edit-input');
    if (!input) {
        console.warn('No input found');
        showToast('Failed to update player. Please try again.', 'error', 2000);
        return;
    }
    
    const value = input.value.trim();
    if (!value) {
        showToast('Name cannot be empty.', 'error', 2000);
        return;
    }
    
    const type = element.dataset.type;
    const group = element.dataset.group;
    const playerId = element.dataset.playerId;
    const storedIndex = element.dataset.index !== undefined ? parseInt(element.dataset.index) : null;
    const reserveIndex = element.dataset.reserveIndex !== undefined ? parseInt(element.dataset.reserveIndex) : null;
    const guildIndex = element.dataset.guildIndex !== undefined ? parseInt(element.dataset.guildIndex) : null;
    
    const playerName = element.dataset.name;
    const playerClass = element.dataset.class;
    const oldRole = element.dataset.role || 'Member';
    
    console.log('=== SAVE ITEM ===');
    console.log('Type:', type);
    console.log('Player ID:', playerId);
    console.log('Player Name:', playerName);
    console.log('Player Class:', playerClass);
    
    // Get current data
    const g = typeof getGroups === 'function' ? getGroups() : {};
    const r = typeof getReserves === 'function' ? getReserves() : [];
    const gm = typeof getGuildMembers === 'function' ? getGuildMembers() : [];
    
    let updated = false;
    let playerData = null;
    const clsSelect = element.querySelector('.class-select');
    const roleSelect = element.querySelector('.role-select');
    const cls = clsSelect ? clsSelect.value : playerClass;
    const role = roleSelect ? roleSelect.value : 'Member';
    
    // ----- UPDATE BASED ON TYPE -----
    
    if (type === 'group' && group && g && g[group]) {
        const players = g[group].players;
        
        // Try to find by ID first
        if (playerId) {
            let foundIndex = -1;
            for (let i = 0; i < players.length; i++) {
                if (players[i].id === playerId) {
                    foundIndex = i;
                    break;
                }
            }
            if (foundIndex !== -1) {
                playerData = { id: playerId, name: value, class: cls, role: role };
                players[foundIndex] = playerData;
                updated = true;
                console.log('Updated group player by ID at index', foundIndex);
            }
        }
        
        // If not found by ID, try stored index
        if (!updated && storedIndex !== null && storedIndex >= 0 && storedIndex < players.length) {
            const existingPlayer = players[storedIndex];
            if (existingPlayer.name === playerName && existingPlayer.class === playerClass) {
                playerData = { id: existingPlayer.id || generatePlayerId(), name: value, class: cls, role: role };
                players[storedIndex] = playerData;
                updated = true;
                console.log('Updated group player at index', storedIndex);
            }
        }
        
        // If still not found, try to find by name+class as fallback
        if (!updated) {
            for (let i = 0; i < players.length; i++) {
                if (players[i].name === playerName && players[i].class === playerClass) {
                    playerData = { id: players[i].id || generatePlayerId(), name: value, class: cls, role: role };
                    players[i] = playerData;
                    updated = true;
                    console.log('Updated group player by name+class at index', i);
                    break;
                }
            }
        }
    } 
    else if (type === 'reserve' && reserveIndex !== null && reserveIndex !== undefined) {
        if (r && reserveIndex >= 0 && reserveIndex < r.length) {
            const existingPlayer = r[reserveIndex];
            if (existingPlayer.id === playerId || (existingPlayer.name === playerName && existingPlayer.class === playerClass)) {
                playerData = { id: existingPlayer.id || generatePlayerId(), name: value, class: cls, role: role };
                r[reserveIndex] = playerData;
                updated = true;
                console.log('Updated reserve at index', reserveIndex);
            }
        }
        
        // If not found by index, try name+class
        if (!updated && r) {
            for (let i = 0; i < r.length; i++) {
                if (r[i].name === playerName && r[i].class === playerClass) {
                    playerData = { id: r[i].id || generatePlayerId(), name: value, class: cls, role: role };
                    r[i] = playerData;
                    updated = true;
                    console.log('Updated reserve by name+class at index', i);
                    break;
                }
            }
        }
    } 
    else if (type === 'guild' && guildIndex !== null && guildIndex !== undefined) {
        const days = ['sat', 'sun'];
        let found = false;
        
        days.forEach(function(day) {
            if (App.state.guildMembers && App.state.guildMembers[day]) {
                for (let i = 0; i < App.state.guildMembers[day].length; i++) {
                    if (App.state.guildMembers[day][i].id === playerId) {
                        App.state.guildMembers[day][i].name = value;
                        App.state.guildMembers[day][i].class = cls;
                        App.state.guildMembers[day][i].role = role;
                        playerData = App.state.guildMembers[day][i];
                        found = true;
                        updated = true;
                    }
                }
            }
        });
        
        // If not found by ID, try name+class
        if (!found) {
            days.forEach(function(day) {
                if (App.state.guildMembers && App.state.guildMembers[day]) {
                    for (let i = 0; i < App.state.guildMembers[day].length; i++) {
                        if (App.state.guildMembers[day][i].name === playerName && App.state.guildMembers[day][i].class === playerClass) {
                            App.state.guildMembers[day][i].name = value;
                            App.state.guildMembers[day][i].class = cls;
                            App.state.guildMembers[day][i].role = role;
                            playerData = App.state.guildMembers[day][i];
                            found = true;
                            updated = true;
                        }
                    }
                }
            });
        }
        
        if (found && playerData) {
            // Also update in groups and reserves
            days.forEach(function(day) {
                const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                groupKeys.forEach(function(key) {
                    if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                        for (let i = 0; i < App.state.groups[day][key].players.length; i++) {
                            if (App.state.groups[day][key].players[i].id === playerId || 
                                (App.state.groups[day][key].players[i].name === playerName && App.state.groups[day][key].players[i].class === playerClass)) {
                                App.state.groups[day][key].players[i].name = value;
                                App.state.groups[day][key].players[i].class = cls;
                                App.state.groups[day][key].players[i].role = role;
                            }
                        }
                    }
                });
                if (App.state.reserves && App.state.reserves[day]) {
                    for (let i = 0; i < App.state.reserves[day].length; i++) {
                        if (App.state.reserves[day][i].id === playerId ||
                            (App.state.reserves[day][i].name === playerName && App.state.reserves[day][i].class === playerClass)) {
                            App.state.reserves[day][i].name = value;
                            App.state.reserves[day][i].class = cls;
                            App.state.reserves[day][i].role = role;
                        }
                    }
                }
            });
        }
    }
    
    if (updated && playerData) {
        EventHandlers.toggleEditMode(element, false);
        if (typeof updateLastUpdate === 'function') updateLastUpdate();
        if (typeof render === 'function') render();
        
        EventHandlers.showSaveFeedback(element);
        
        // ---- LOG TO HISTORY ----
        if (typeof History !== 'undefined' && History.add) {
            const day = window.currentDay || 'sat';
            const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            
            History.add('edit', {
                playerId: playerData.id || playerId,
                playerName: value,
                field: 'name/class/role',
                oldValue: playerName,
                newValue: value,
                day: day,
                details: `${playerName} → ${value} (${cls}/${role}) on ${dayName}`
            });
        }
        
        showToast('Player updated successfully', 'success', 1500);
        console.log('Save completed successfully');
    } else {
        console.warn('Update failed for:', { type, group, reserveIndex, guildIndex, playerId, playerName, playerClass });
        showToast('Failed to update player. Please try again.', 'error', 2000);
    }
};

EventHandlers.cancelEdit = function(event) {
    const button = event.target.closest('[data-action="cancel"]');
    if (!button) return;
    
    const element = button.closest('[data-editable]');
    if (element) {
        EventHandlers.toggleEditMode(element, false);
    }
};

EventHandlers.handleEditClick = function(event) {
    const button = event.target.closest('[data-action="edit"]');
    if (!button) return;
    
    const element = button.closest('[data-editable]');
    if (element) {
        const type = element.dataset.type;
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
        if (type === 'guild' && !isAdmin) {
            showToast('Only admin can edit guild members.', 'error', 2000);
            return;
        }
        if (!isMod) {
            showToast('Only moderators can edit.', 'error', 2000);
            return;
        }
        EventHandlers.toggleEditMode(element, true);
    }
};

EventHandlers.handleEditKeydown = function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const element = event.target.closest('[data-editable]');
        if (element) {
            const saveBtn = element.querySelector('[data-action="save"]');
            if (saveBtn) {
                saveBtn.click();
            }
        }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        const element = event.target.closest('[data-editable]');
        if (element) {
            const cancelBtn = element.querySelector('[data-action="cancel"]');
            if (cancelBtn) {
                cancelBtn.click();
            }
        }
    }
};

EventHandlers.setupEditListeners = function() {
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        
        const action = target.dataset.action;
        
        switch(action) {
            case 'edit':
                EventHandlers.handleEditClick(e);
                break;
            case 'save':
                EventHandlers.saveItem(e);
                break;
            case 'cancel':
                EventHandlers.cancelEdit(e);
                break;
            case 'return':
                EventHandlers.handleReturnToReserve(e);
                break;
            case 'delete':
                EventHandlers.handleDeleteItem(e);
                break;
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.target.classList.contains('edit-input') || 
            e.target.classList.contains('name-edit') ||
            e.target.classList.contains('title-edit')) {
            EventHandlers.handleEditKeydown(e);
        }
    });
};

EventHandlers.handleReturnToReserve = function(event) {
    const button = event.target.closest('[data-action="return"]');
    if (!button) return;
    
    const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    if (!isMod) {
        showToast('Only moderators can return players to reserves.', 'error', 2000);
        return;
    }
    
    const element = button.closest('[data-editable]');
    if (!element) return;
    
    const playerId = element.dataset.playerId;
    const group = element.dataset.group;
    const playerName = element.dataset.name;
    const playerClass = element.dataset.class;
    const playerRole = element.dataset.role || 'Member';
    const day = window.currentDay;
    
    const g = getGroups(); // This gets groups for current day
    const r = getReserves(); // This gets reserves for current day
    let movedPlayer = null;
    let foundIndex = -1;
    
    // Find the player by ID in the group
    if (group && g && g[group] && g[group].players) {
        for (let i = 0; i < g[group].players.length; i++) {
            if (g[group].players[i].id === playerId) {
                foundIndex = i;
                movedPlayer = g[group].players[i];
                break;
            }
        }
        
        // If not found by ID, try name+class as fallback
        if (!movedPlayer) {
            for (let i = 0; i < g[group].players.length; i++) {
                if (g[group].players[i].name === playerName && g[group].players[i].class === playerClass) {
                    foundIndex = i;
                    movedPlayer = g[group].players[i];
                    break;
                }
            }
        }
        
        if (movedPlayer && foundIndex !== -1) {
            // Remove from group
            g[group].players.splice(foundIndex, 1);
            if (movedPlayer.id && typeof trackPlayerRemovals === 'function') {
                trackPlayerRemovals('group', day, movedPlayer.id, group);
            }
            
            // Add to reserves (ensure ID is preserved)
            if (r) {
                // Make sure player has an ID
                if (!movedPlayer.id) {
                    movedPlayer.id = generatePlayerId();
                }
                r.push(movedPlayer);
            }
            
            // ---- SAVE BACK TO GLOBAL STATE ----
            App.state.groups[day] = g;
            App.state.reserves[day] = r;
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add && movedPlayer) {
                const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
                History.add('move', {
                    playerId: movedPlayer.id || null,
                    playerName: movedPlayer.name,
                    from: group,
                    to: 'reserve',
                    day: day,
                    details: `${movedPlayer.name} returned to Reserves from ${group} (${dayName})`
                });
            }
            
            if (typeof updateLastUpdate === 'function') updateLastUpdate();
            if (typeof render === 'function') render();
            showToast(`${movedPlayer.name} returned to Reserves`, 'success', 2000);
        } else {
            showToast('Player not found in group.', 'error', 2000);
        }
    } else {
        showToast('Group not found.', 'error', 2000);
    }
};

EventHandlers.handleDeleteItem = function(event) {
    const button = event.target.closest('[data-action="delete"]');
    if (!button) return;
    
    const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    if (!isAdmin) {
        showToast('Only admin can delete guild members.', 'error', 2000);
        return;
    }
    
    const element = button.closest('[data-editable]');
    if (!element) return;
    
    const type = element.dataset.type;
    if (type !== 'guild') return;
    
    const name = element.dataset.name;
    const cls = element.dataset.class;
    const playerId = element.dataset.playerId;
    
    if (typeof showConfirmation === 'function') {
        showConfirmation('Remove "' + name + '" from guild members?', function() {
            const days = ['sat', 'sun'];
            const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
            let removedPlayer = null;
            
            // Full delete - tombstone so stale copies can't resurrect the player
            if (playerId && typeof trackDeletedPlayerIds === 'function') {
                trackDeletedPlayerIds(playerId);
            }
            
            for (let d = 0; d < days.length; d++) {
                const day = days[d];
                
                // Remove from guild members
                if (App.state.guildMembers && App.state.guildMembers[day]) {
                    for (let i = 0; i < App.state.guildMembers[day].length; i++) {
                        if (App.state.guildMembers[day][i].id === playerId || 
                            (App.state.guildMembers[day][i].name === name && App.state.guildMembers[day][i].class === cls)) {
                            removedPlayer = App.state.guildMembers[day][i];
                            App.state.guildMembers[day].splice(i, 1);
                            break;
                        }
                    }
                }
                
                // Remove from groups
                for (let k = 0; k < groupKeys.length; k++) {
                    const key = groupKeys[k];
                    if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                        const newPlayers = [];
                        for (let p = 0; p < App.state.groups[day][key].players.length; p++) {
                            if (App.state.groups[day][key].players[p].id !== playerId &&
                                !(App.state.groups[day][key].players[p].name === name && App.state.groups[day][key].players[p].class === cls)) {
                                newPlayers.push(App.state.groups[day][key].players[p]);
                            }
                        }
                        App.state.groups[day][key].players = newPlayers;
                    }
                }
                
                // Remove from reserves
                if (App.state.reserves && App.state.reserves[day]) {
                    const newReserves = [];
                    for (let p = 0; p < App.state.reserves[day].length; p++) {
                        if (App.state.reserves[day][p].id !== playerId &&
                            !(App.state.reserves[day][p].name === name && App.state.reserves[day][p].class === cls)) {
                            newReserves.push(App.state.reserves[day][p]);
                        }
                    }
                    App.state.reserves[day] = newReserves;
                }
            }
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add && removedPlayer) {
                History.add('delete', {
                    playerId: removedPlayer.id || playerId,
                    playerName: removedPlayer.name || name,
                    from: 'guild',
                    details: `${removedPlayer.name || name} deleted from guild members`
                });
            }
            
            if (typeof updateLastUpdate === 'function') updateLastUpdate();
            if (typeof render === 'function') render();
            if (typeof saveState === 'function') saveState();
            showToast(`Removed ${removedPlayer ? removedPlayer.name : name} from guild`, 'success', 2000);
        });
    }
};

EventHandlers.setupTitleListeners = function() {
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-title-action]');
        if (!target) return;
        
        const action = target.dataset.titleAction;
        // The remove button sits at the card's bottom-right, OUTSIDE .group-title;
        // only edit/save/cancel require the title container.
        const container = target.closest('.group-title');
        if (action !== 'remove' && !container) return;
        
        const display = container ? container.querySelector('.title-display') : null;
        const editInput = container ? container.querySelector('.title-edit') : null;
        const editBtn = container ? container.querySelector('.title-edit-btn') : null;
        const saveBtn = container ? container.querySelector('.title-save-btn') : null;
        const cancelBtn = container ? container.querySelector('.title-cancel-btn') : null;
        const groupKey = target.dataset.group || (container ? container.dataset.group : null);
        
        if (!groupKey) {
            console.warn('No group key found for title action');
            return;
        }
        
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
        switch(action) {
            case 'edit':
                if (!isMod) {
                    showToast('Only moderators can edit group titles.', 'error', 2000);
                    return;
                }
                display.style.display = 'none';
                editBtn.style.display = 'none';
                editInput.style.display = 'inline-block';
                saveBtn.style.display = 'inline-flex';
                cancelBtn.style.display = 'inline-flex';
                editInput.value = display.textContent;
                setTimeout(function() { 
                    editInput.focus(); 
                    const length = editInput.value.length;
                    editInput.setSelectionRange(length, length);
                }, 10);
                break;
                
            case 'save':
                if (!isMod) return;
                const newTitle = editInput.value.trim();
                if (!newTitle) {
                    showToast('Title cannot be empty.', 'error', 2000);
                    return;
                }
                
                const day = window.currentDay;
                const groups = App.state.groups && App.state.groups[day] ? App.state.groups[day] : {};
                const oldTitle = display.textContent;
                
                if (groups && groups[groupKey]) {
                    groups[groupKey].title = newTitle;
                    display.textContent = newTitle;
                    
                    if (typeof History !== 'undefined' && History.add) {
                        const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
                        History.add('group_edit', {
                            details: `${oldTitle} → ${newTitle}`,
                            oldValue: oldTitle,
                            newValue: newTitle,
                            day: day,
                            to: dayName
                        });
                    }
                } else {
                    console.warn('Group not found:', groupKey);
                    return;
                }
                
                display.style.display = 'inline-block';
                editInput.style.display = 'none';
                editBtn.style.display = 'inline-flex';
                saveBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
                
                if (typeof updateLastUpdate === 'function') updateLastUpdate();
                if (typeof render === 'function') render();
                showToast('Group title updated', 'success', 1500);
                break;
                
            case 'cancel':
                display.style.display = 'inline-block';
                editInput.style.display = 'none';
                editBtn.style.display = 'inline-flex';
                saveBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
                break;
                
            case 'remove':
                // Phase 6.2 - Remove group (mods+, empty groups only per server rule)
                if (!isMod) {
                    showToast('Only moderators can remove groups.', 'error', 2000);
                    return;
                }
                const removeDay = window.currentDay || 'sat';
                // Prefer the human-readable title from the card (the button lives at
                // the card's bottom-right, outside the title row).
                const groupCard = target.closest('.group-card');
                const titleEl = groupCard ? groupCard.querySelector('.title-display') : null;
                const groupTitle = (titleEl && titleEl.textContent) ? titleEl.textContent : (display ? display.textContent : groupKey);
                if (typeof showConfirmation === 'function') {
                    showConfirmation('Remove group "' + groupTitle + '"?', function() {
                        removeGroup(removeDay, groupKey);
                    });
                } else {
                    removeGroup(removeDay, groupKey);
                }
                break;
        }
    });
};

// Remove a group via /api/groups/remove, then re-sync from the server.
function removeGroup(day, groupKey) {
    fetch('/api/groups/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof getAuthHeader === 'function' ? getAuthHeader() : {}) },
        body: JSON.stringify({ day: day, groupKey: groupKey })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.success) {
            showToast('Group removed', 'success', 2000);
            if (typeof History !== 'undefined' && History.add) {
                History.add('group_remove', {
                    details: groupKey,
                    day: day,
                    to: day === 'sat' ? 'Saturday' : 'Sunday'
                });
            }
            if (typeof loadState === 'function') loadState();
        } else {
            showToast(result.error || 'Failed to remove group', 'error', 3000);
        }
    })
    .catch(function() {
        showToast('Error removing group', 'error', 3000);
    });
}

EventHandlers.setupCheckboxListeners = function() {
    document.addEventListener('change', function(e) {
        if (e.target.classList.contains('reserve-checkbox') || 
            e.target.classList.contains('guild-checkbox') ||
            e.target.classList.contains('guild-member-checkbox')) {
            EventHandlers.updateActionButtons();
            if (typeof updateReserveButtons === 'function') {
                updateReserveButtons();
            }
        }
    });
};

EventHandlers.updateActionButtons = function() {
    const reserveCheckboxes = document.querySelectorAll('.reserve-checkbox:checked');
    const guildCheckboxes = document.querySelectorAll('.guild-checkbox:checked');
    
    const moveToGuildBtn = document.getElementById('moveToGuildBtn');
    const deleteSelectedGuildBtn = document.getElementById('deleteSelectedGuildBtn');
    const moveToReserveBtn = document.getElementById('moveToReserveBtn');
    const deleteSelectedReservesBtn = document.getElementById('deleteSelectedReservesBtn');
    const selectAllBtn = document.getElementById('selectAllReservesBtn');
    
    const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    
    if (moveToGuildBtn) {
        moveToGuildBtn.style.display = (reserveCheckboxes.length > 0 && (isAdmin || isMod)) ? 'inline-flex' : 'none';
    }
    if (deleteSelectedReservesBtn) {
        deleteSelectedReservesBtn.style.display = (reserveCheckboxes.length > 0 && (isAdmin || isMod)) ? 'inline-flex' : 'none';
    }
    if (selectAllBtn) {
        const totalCheckboxes = document.querySelectorAll('.reserve-checkbox');
        selectAllBtn.style.display = (totalCheckboxes.length > 0 && (isAdmin || isMod)) ? 'inline-flex' : 'none';
    }
    
    if (deleteSelectedGuildBtn) {
        deleteSelectedGuildBtn.style.display = (guildCheckboxes.length > 0 && isAdmin) ? 'inline-flex' : 'none';
    }
    if (moveToReserveBtn) {
        moveToReserveBtn.style.display = (guildCheckboxes.length > 0 && isAdmin) ? 'inline-flex' : 'none';
    }
};

EventHandlers.showSaveFeedback = function(element) {
    const indicator = document.createElement('span');
    indicator.className = 'save-indicator';
    indicator.innerHTML = '✓ Saved!';
    indicator.style.cssText = 
        'position: absolute; right: -60px; top: 50%; transform: translateY(-50%); ' +
        'color: #4ade80; font-size: 0.7rem; font-weight: 600; ' +
        'opacity: 0; transition: opacity 0.3s ease;';
    element.style.position = 'relative';
    element.appendChild(indicator);
    
    setTimeout(function() {
        indicator.style.opacity = '1';
    }, 10);
    
    setTimeout(function() {
        indicator.style.opacity = '0';
        setTimeout(function() {
            indicator.remove();
        }, 300);
    }, 1500);
};

window.EventHandlers = EventHandlers;
console.log('EventHandlers loaded successfully');