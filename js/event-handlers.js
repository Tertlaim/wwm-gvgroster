// ============================================================
//  EVENT HANDLERS - Unified event management
// ============================================================

var EventHandlers = {};

EventHandlers.toggleEditMode = function(element, enable) {
    if (!element) return;
    
    var displayMode = element.querySelectorAll('.display-mode');
    var editMode = element.querySelectorAll('.edit-mode');
    var actionButtons = element.querySelectorAll('.action-buttons');
    
    for (var i = 0; i < displayMode.length; i++) {
        displayMode[i].style.display = enable ? 'none' : '';
    }
    for (var i = 0; i < editMode.length; i++) {
        editMode[i].style.display = enable ? '' : 'none';
    }
    for (var i = 0; i < actionButtons.length; i++) {
        actionButtons[i].style.display = enable ? '' : 'none';
    }
    
    if (enable) {
        var input = element.querySelector('.edit-input');
        if (input) {
            setTimeout(function() {
                input.focus();
                // Set cursor to end, but allow clicking anywhere
                var length = input.value.length;
                input.setSelectionRange(length, length);
            }, 10);
        }
    }
};

EventHandlers.saveItem = function(event) {
    var button = event.target.closest('[data-action="save"]');
    if (!button) return;
    
    var element = button.closest('[data-editable]');
    if (!element) {
        console.warn('No editable element found');
        showToast('Failed to update player. Please try again.', 'error', 2000);
        return;
    }
    
    var input = element.querySelector('.edit-input');
    if (!input) {
        console.warn('No input found');
        showToast('Failed to update player. Please try again.', 'error', 2000);
        return;
    }
    
    var value = input.value.trim();
    if (!value) {
        showToast('Name cannot be empty.', 'error', 2000);
        return;
    }
    
    var type = element.dataset.type;
    var group = element.dataset.group;
    var playerId = element.dataset.playerId;
    var storedIndex = element.dataset.index !== undefined ? parseInt(element.dataset.index) : null;
    var reserveIndex = element.dataset.reserveIndex !== undefined ? parseInt(element.dataset.reserveIndex) : null;
    var guildIndex = element.dataset.guildIndex !== undefined ? parseInt(element.dataset.guildIndex) : null;
    
    var playerName = element.dataset.name;
    var playerClass = element.dataset.class;
    var oldRole = element.dataset.role || 'Member';
    
    console.log('=== SAVE ITEM ===');
    console.log('Type:', type);
    console.log('Player ID:', playerId);
    console.log('Player Name:', playerName);
    console.log('Player Class:', playerClass);
    
    // Get current data
    var g = typeof getGroups === 'function' ? getGroups() : {};
    var r = typeof getReserves === 'function' ? getReserves() : [];
    var gm = typeof getGuildMembers === 'function' ? getGuildMembers() : [];
    
    var updated = false;
    var playerData = null;
    var clsSelect = element.querySelector('.class-select');
    var roleSelect = element.querySelector('.role-select');
    var cls = clsSelect ? clsSelect.value : playerClass;
    var role = roleSelect ? roleSelect.value : 'Member';
    
    // ----- UPDATE BASED ON TYPE -----
    
    if (type === 'group' && group && g && g[group]) {
        var players = g[group].players;
        
        // Try to find by ID first
        if (playerId) {
            var foundIndex = -1;
            for (var i = 0; i < players.length; i++) {
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
            var existingPlayer = players[storedIndex];
            if (existingPlayer.name === playerName && existingPlayer.class === playerClass) {
                playerData = { id: existingPlayer.id || generatePlayerId(), name: value, class: cls, role: role };
                players[storedIndex] = playerData;
                updated = true;
                console.log('Updated group player at index', storedIndex);
            }
        }
        
        // If still not found, try to find by name+class as fallback
        if (!updated) {
            for (var i = 0; i < players.length; i++) {
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
            var existingPlayer = r[reserveIndex];
            if (existingPlayer.id === playerId || (existingPlayer.name === playerName && existingPlayer.class === playerClass)) {
                playerData = { id: existingPlayer.id || generatePlayerId(), name: value, class: cls, role: role };
                r[reserveIndex] = playerData;
                updated = true;
                console.log('Updated reserve at index', reserveIndex);
            }
        }
        
        // If not found by index, try name+class
        if (!updated && r) {
            for (var i = 0; i < r.length; i++) {
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
        var days = ['sat', 'sun'];
        var found = false;
        
        days.forEach(function(day) {
            if (window.guildMembers && window.guildMembers[day]) {
                for (var i = 0; i < window.guildMembers[day].length; i++) {
                    if (window.guildMembers[day][i].id === playerId) {
                        window.guildMembers[day][i].name = value;
                        window.guildMembers[day][i].class = cls;
                        window.guildMembers[day][i].role = role;
                        playerData = window.guildMembers[day][i];
                        found = true;
                        updated = true;
                    }
                }
            }
        });
        
        // If not found by ID, try name+class
        if (!found) {
            days.forEach(function(day) {
                if (window.guildMembers && window.guildMembers[day]) {
                    for (var i = 0; i < window.guildMembers[day].length; i++) {
                        if (window.guildMembers[day][i].name === playerName && window.guildMembers[day][i].class === playerClass) {
                            window.guildMembers[day][i].name = value;
                            window.guildMembers[day][i].class = cls;
                            window.guildMembers[day][i].role = role;
                            playerData = window.guildMembers[day][i];
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
                var groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                groupKeys.forEach(function(key) {
                    if (window.groups && window.groups[day] && window.groups[day][key]) {
                        for (var i = 0; i < window.groups[day][key].players.length; i++) {
                            if (window.groups[day][key].players[i].id === playerId || 
                                (window.groups[day][key].players[i].name === playerName && window.groups[day][key].players[i].class === playerClass)) {
                                window.groups[day][key].players[i].name = value;
                                window.groups[day][key].players[i].class = cls;
                                window.groups[day][key].players[i].role = role;
                            }
                        }
                    }
                });
                if (window.reserves && window.reserves[day]) {
                    for (var i = 0; i < window.reserves[day].length; i++) {
                        if (window.reserves[day][i].id === playerId ||
                            (window.reserves[day][i].name === playerName && window.reserves[day][i].class === playerClass)) {
                            window.reserves[day][i].name = value;
                            window.reserves[day][i].class = cls;
                            window.reserves[day][i].role = role;
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
            var day = window.currentDay || 'sat';
            var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            
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
    var button = event.target.closest('[data-action="cancel"]');
    if (!button) return;
    
    var element = button.closest('[data-editable]');
    if (element) {
        EventHandlers.toggleEditMode(element, false);
    }
};

EventHandlers.handleEditClick = function(event) {
    var button = event.target.closest('[data-action="edit"]');
    if (!button) return;
    
    var element = button.closest('[data-editable]');
    if (element) {
        var type = element.dataset.type;
        var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
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
        var element = event.target.closest('[data-editable]');
        if (element) {
            var saveBtn = element.querySelector('[data-action="save"]');
            if (saveBtn) {
                saveBtn.click();
            }
        }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        var element = event.target.closest('[data-editable]');
        if (element) {
            var cancelBtn = element.querySelector('[data-action="cancel"]');
            if (cancelBtn) {
                cancelBtn.click();
            }
        }
    }
};

EventHandlers.setupEditListeners = function() {
    document.addEventListener('click', function(e) {
        var target = e.target.closest('[data-action]');
        if (!target) return;
        
        var action = target.dataset.action;
        
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
    var button = event.target.closest('[data-action="return"]');
    if (!button) return;
    
    var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    if (!isMod) {
        showToast('Only moderators can return players to reserves.', 'error', 2000);
        return;
    }
    
    var element = button.closest('[data-editable]');
    if (!element) return;
    
    var playerId = element.dataset.playerId;
    var group = element.dataset.group;
    var playerName = element.dataset.name;
    var playerClass = element.dataset.class;
    var playerRole = element.dataset.role || 'Member';
    var day = window.currentDay;
    
    var g = getGroups(); // This gets groups for current day
    var r = getReserves(); // This gets reserves for current day
    var movedPlayer = null;
    var foundIndex = -1;
    
    // Find the player by ID in the group
    if (group && g && g[group] && g[group].players) {
        for (var i = 0; i < g[group].players.length; i++) {
            if (g[group].players[i].id === playerId) {
                foundIndex = i;
                movedPlayer = g[group].players[i];
                break;
            }
        }
        
        // If not found by ID, try name+class as fallback
        if (!movedPlayer) {
            for (var i = 0; i < g[group].players.length; i++) {
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
            window.groups[day] = g;
            window.reserves[day] = r;
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add && movedPlayer) {
                var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
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
    var button = event.target.closest('[data-action="delete"]');
    if (!button) return;
    
    var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    if (!isAdmin) {
        showToast('Only admin can delete guild members.', 'error', 2000);
        return;
    }
    
    var element = button.closest('[data-editable]');
    if (!element) return;
    
    var type = element.dataset.type;
    if (type !== 'guild') return;
    
    var name = element.dataset.name;
    var cls = element.dataset.class;
    var playerId = element.dataset.playerId;
    
    if (typeof showConfirmation === 'function') {
        showConfirmation('Remove "' + name + '" from guild members?', function() {
            var days = ['sat', 'sun'];
            var groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
            var removedPlayer = null;
            
            // Full delete - tombstone so stale copies can't resurrect the player
            if (playerId && typeof trackDeletedPlayerIds === 'function') {
                trackDeletedPlayerIds(playerId);
            }
            
            for (var d = 0; d < days.length; d++) {
                var day = days[d];
                
                // Remove from guild members
                if (window.guildMembers && window.guildMembers[day]) {
                    for (var i = 0; i < window.guildMembers[day].length; i++) {
                        if (window.guildMembers[day][i].id === playerId || 
                            (window.guildMembers[day][i].name === name && window.guildMembers[day][i].class === cls)) {
                            removedPlayer = window.guildMembers[day][i];
                            window.guildMembers[day].splice(i, 1);
                            break;
                        }
                    }
                }
                
                // Remove from groups
                for (var k = 0; k < groupKeys.length; k++) {
                    var key = groupKeys[k];
                    if (window.groups && window.groups[day] && window.groups[day][key]) {
                        var newPlayers = [];
                        for (var p = 0; p < window.groups[day][key].players.length; p++) {
                            if (window.groups[day][key].players[p].id !== playerId &&
                                !(window.groups[day][key].players[p].name === name && window.groups[day][key].players[p].class === cls)) {
                                newPlayers.push(window.groups[day][key].players[p]);
                            }
                        }
                        window.groups[day][key].players = newPlayers;
                    }
                }
                
                // Remove from reserves
                if (window.reserves && window.reserves[day]) {
                    var newReserves = [];
                    for (var p = 0; p < window.reserves[day].length; p++) {
                        if (window.reserves[day][p].id !== playerId &&
                            !(window.reserves[day][p].name === name && window.reserves[day][p].class === cls)) {
                            newReserves.push(window.reserves[day][p]);
                        }
                    }
                    window.reserves[day] = newReserves;
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
        var target = e.target.closest('[data-title-action]');
        if (!target) return;
        
        var action = target.dataset.titleAction;
        var container = target.closest('.group-title');
        if (!container) return;
        
        var display = container.querySelector('.title-display');
        var editInput = container.querySelector('.title-edit');
        var editBtn = container.querySelector('.title-edit-btn');
        var saveBtn = container.querySelector('.title-save-btn');
        var cancelBtn = container.querySelector('.title-cancel-btn');
        var groupKey = target.dataset.group || container.dataset.group;
        
        if (!groupKey) {
            console.warn('No group key found for title action');
            return;
        }
        
        var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        
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
                    var length = editInput.value.length;
                    editInput.setSelectionRange(length, length);
                }, 10);
                break;
                
            case 'save':
                if (!isMod) return;
                var newTitle = editInput.value.trim();
                if (!newTitle) {
                    showToast('Title cannot be empty.', 'error', 2000);
                    return;
                }
                
                var day = window.currentDay;
                var groups = window.groups && window.groups[day] ? window.groups[day] : {};
                var oldTitle = display.textContent;
                
                if (groups && groups[groupKey]) {
                    groups[groupKey].title = newTitle;
                    display.textContent = newTitle;
                    
                    if (typeof History !== 'undefined' && History.add) {
                        var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
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
        }
    });
};

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
    var reserveCheckboxes = document.querySelectorAll('.reserve-checkbox:checked');
    var guildCheckboxes = document.querySelectorAll('.guild-checkbox:checked');
    
    var moveToGuildBtn = document.getElementById('moveToGuildBtn');
    var deleteSelectedGuildBtn = document.getElementById('deleteSelectedGuildBtn');
    var moveToReserveBtn = document.getElementById('moveToReserveBtn');
    var deleteSelectedReservesBtn = document.getElementById('deleteSelectedReservesBtn');
    var selectAllBtn = document.getElementById('selectAllReservesBtn');
    
    var isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    var isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    
    if (moveToGuildBtn) {
        moveToGuildBtn.style.display = (reserveCheckboxes.length > 0 && (isAdmin || isMod)) ? 'inline-flex' : 'none';
    }
    if (deleteSelectedReservesBtn) {
        deleteSelectedReservesBtn.style.display = (reserveCheckboxes.length > 0 && (isAdmin || isMod)) ? 'inline-flex' : 'none';
    }
    if (selectAllBtn) {
        var totalCheckboxes = document.querySelectorAll('.reserve-checkbox');
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
    var indicator = document.createElement('span');
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