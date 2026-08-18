// ============================================================
// DRAGDROP - Drag and drop handlers
// ============================================================

var dragData = null;

function attachDragListeners() {
    document.removeEventListener('dragstart', handleDragStart);
    document.removeEventListener('dragend', handleDragEnd);
    document.removeEventListener('dragover', handleDragOver);
    document.removeEventListener('dragenter', handleDragEnter);
    document.removeEventListener('dragleave', handleDragLeave);
    document.removeEventListener('drop', handleDrop);
    
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    
    console.log('Drag listeners attached');
}

// ============================================================
// DRAG HANDLERS
// ============================================================

function handleDragStart(e) {
    if (!AuthModule.isMod()) { 
        e.preventDefault(); 
        return false; 
    }
    
    var el = e.target.closest('.guild-card, [draggable="true"]');
    if (!el) return;
    
    var name = el.dataset.name;
    var cls = el.dataset.class;
    var role = el.dataset.role || 'Member';
    var playerId = el.dataset.playerId || null;
    var group = el.dataset.group || null;
    var reserveIndex = el.dataset.reserveIndex !== undefined ? parseInt(el.dataset.reserveIndex) : null;
    var guildIndex = el.dataset.guildIndex !== undefined ? parseInt(el.dataset.guildIndex) : null;
    var type = el.dataset.type || null;
    
    var isFromGuild = type === 'guild' || el.classList.contains('guild-card') || el.classList.contains('guild-member-badge');
    var isFromReserve = type === 'reserve' || el.classList.contains('reserve-badge');
    var isFromGroup = type === 'group' || el.classList.contains('player-badge');
    
    dragData = { 
        name: name, 
        class: cls, 
        role: role,
        playerId: playerId,
        group: group, 
        reserveIndex: reserveIndex, 
        guildIndex: guildIndex,
        type: type,
        isFromGuild: isFromGuild,
        isFromReserve: isFromReserve,
        isFromGroup: isFromGroup,
        element: el 
    };
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
    el.classList.add('dragging');
}

function handleDragEnd(e) {
    var el = e.target.closest('[draggable="true"]');
    if (el) el.classList.remove('dragging');
    document.querySelectorAll('.group-card, .reserve-area, .guild-member-pool, .player-list, .reserve-pool, .guild-cards-grid')
        .forEach(function(c) { c.classList.remove('drag-over'); });
    // Don't clear dragData - keep it for potential use
}

function handleDragOver(e) { 
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move'; 
}

function handleDragEnter(e) { 
    e.preventDefault(); 
    var t = e.target.closest('.group-card, .reserve-area, .guild-member-pool, .player-list, .reserve-pool, .guild-cards-grid'); 
    if (t) t.classList.add('drag-over'); 
}

function handleDragLeave(e) { 
    var t = e.target.closest('.group-card, .reserve-area, .guild-member-pool, .player-list, .reserve-pool, .guild-cards-grid'); 
    if (t) t.classList.remove('drag-over'); 
}

// ============================================================
// DROP HANDLER
// ============================================================

function handleDrop(e) {
    e.preventDefault();
    
    document.querySelectorAll('.group-card, .reserve-area, .guild-member-pool, .player-list, .reserve-pool, .guild-cards-grid')
        .forEach(function(c) { c.classList.remove('drag-over'); });
    
    if (!AuthModule.isMod() || !dragData) {
        dragData = null;
        return;
    }
    
    var target = e.target.closest('.group-card, .reserve-area, .guild-member-pool, .player-list, .reserve-pool, .guild-cards-grid');
    if (!target) {
        dragData = null;
        return;
    }
    
    var targetGroup = null;
    var targetIsReserve = false;
    var targetIsGuild = false;
    
    var groupCard = target.closest('.group-card');
    if (groupCard) {
        targetGroup = groupCard.dataset.group;
    }
    
    if (target.closest('.reserve-area') || target.closest('.reserve-pool')) {
        targetIsReserve = true;
    }
    
    if (target.closest('.guild-member-pool') || target.closest('.guild-cards-grid')) {
        targetIsGuild = true;
    }
    
    var playerList = target.closest('.player-list');
    if (playerList && !targetGroup) {
        var parentCard = playerList.closest('.group-card');
        if (parentCard) {
            targetGroup = parentCard.dataset.group;
        }
    }
    
    var day = window.currentDay;
    var g = getGroups();
    var r = getReserves();
    var gm = getGuildMembers();
    
    if (targetGroup && !g[targetGroup]) {
        dragData = null;
        return;
    }
    
    var name = dragData.name;
    var cls = dragData.class;
    var role = dragData.role;
    var group = dragData.group;
    var reserveIndex = dragData.reserveIndex;
    var guildIndex = dragData.guildIndex;
    var playerId = dragData.playerId;
    var isFromGroup = dragData.isFromGroup;
    var isFromReserve = dragData.isFromReserve;
    var isFromGuild = dragData.isFromGuild;
    
    // ---- RESERVE TO RESERVE: BLOCK (prevent useless duplicate) ----
    if (isFromReserve && targetIsReserve) {
        showToast('"' + name + '" is already in Reserves. Cannot duplicate.', 'warning', 3000);
        dragData = null;
        render();
        return;
    }
    
    // ---- DUPLICATE CHECKS FOR GROUPS ----
    if (targetGroup) {
        var duplicateCount = 0;
        var groupKeys = Object.keys(g);
        for (var i = 0; i < groupKeys.length; i++) {
            var key = groupKeys[i];
            if (g[key] && g[key].players) {
                for (var j = 0; j < g[key].players.length; j++) {
                    if (g[key].players[j].name === name && g[key].players[j].class === cls) {
                        duplicateCount++;
                    }
                }
            }
        }
        
        if (duplicateCount > 0) {
            var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            showToast('"' + name + '" already exists in a group for ' + dayName + '. Duplicates will be highlighted.', 'warning', 3000);
        }
        
        var totalPlayers = getTotalGroupPlayers(day);
        if (totalPlayers >= 30 && !isFromGroup) {
            showToast('Warning: Groups have ' + totalPlayers + '/30 players.', 'warning', 3000);
        }
    }
    
    // ---- GUILD CHECKS ----
    if (targetIsGuild) {
        if (isPlayerInGuildMembers(day, name, cls)) {
            if (isFromGuild) {
                dragData = null;
                render();
                return;
            }
            if (isFromGroup || isFromReserve) {
                var existsInGuild = false;
                var guildList = getGuildMembers();
                for (var i = 0; i < guildList.length; i++) {
                    if (guildList[i].name === name && guildList[i].class === cls) {
                        existsInGuild = true;
                        break;
                    }
                }
                if (existsInGuild) {
                    showToast('"' + name + '" already exists in Guild Members.', 'error', 3000);
                    dragData = null;
                    render();
                    return;
                }
            }
        }
        
        if (!canAddToGuildMembers(day)) {
            var currentCount = getGuildMemberCount(day);
            var limit = getGuildMemberLimit();
            showToast('Guild Members is full (' + currentCount + '/' + limit + ').', 'error', 3000);
            dragData = null;
            render();
            return;
        }
    }
    
    // ---- EXECUTE MOVE/COPY ----
    var shouldRemoveFromSource = false;
    var shouldAddToTarget = false;
    var playerToMove = null;
    var movedPlayer = null;
    var movedFrom = null;
    var movedTo = null;
    
    // Find player data from source
    if (isFromGuild) {
        if (playerId) {
            for (var i = 0; i < gm.length; i++) {
                if (gm[i].id === playerId) {
                    playerToMove = gm[i];
                    break;
                }
            }
        }
        if (!playerToMove) {
            for (var i = 0; i < gm.length; i++) {
                if (gm[i].name === name && gm[i].class === cls) {
                    playerToMove = gm[i];
                    break;
                }
            }
        }
    }
    
    // Determine action
    if (isFromGuild && targetIsReserve) {
        shouldAddToTarget = true;
        shouldRemoveFromSource = true;
        movedFrom = 'guild';
        movedTo = 'reserve';
    } else if (isFromGuild && targetGroup) {
        shouldAddToTarget = true;
        shouldRemoveFromSource = true;
        movedFrom = 'guild';
        movedTo = targetGroup;
    } else if (isFromReserve && targetIsGuild) {
        var existsInGuild = isPlayerInGuildMembers(day, name, cls);
        if (existsInGuild) {
            shouldRemoveFromSource = true;
            shouldAddToTarget = false;
            movedFrom = 'reserve';
        } else {
            shouldAddToTarget = true;
            shouldRemoveFromSource = true;
            movedFrom = 'reserve';
            movedTo = 'guild';
        }
    } else if (isFromGroup && targetIsGuild) {
        var existsInGuild = isPlayerInGuildMembers(day, name, cls);
        if (existsInGuild) {
            shouldRemoveFromSource = true;
            shouldAddToTarget = false;
            movedFrom = group;
        } else {
            shouldAddToTarget = true;
            shouldRemoveFromSource = true;
            movedFrom = group;
            movedTo = 'guild';
        }
    } else if (isFromReserve && targetGroup) {
        shouldAddToTarget = true;
        shouldRemoveFromSource = true;
        movedFrom = 'reserve';
        movedTo = targetGroup;
    } else if (isFromGroup && targetIsReserve) {
        shouldAddToTarget = true;
        shouldRemoveFromSource = true;
        movedFrom = group;
        movedTo = 'reserve';
    } else if (isFromGroup && targetGroup) {
        if (group === targetGroup) {
            dragData = null;
            render();
            return;
        }
        shouldAddToTarget = true;
        shouldRemoveFromSource = true;
        movedFrom = group;
        movedTo = targetGroup;
    } else if (isFromGuild && targetIsGuild) {
        dragData = null;
        render();
        return;
    } else {
        dragData = null;
        render();
        return;
    }
    
    // ---- EXECUTE ----
    if (shouldRemoveFromSource) {
        if (group && g && g[group]) {
            var arr = g[group].players;
            var idx = -1;
            if (playerId) {
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].id === playerId) {
                        idx = i;
                        break;
                    }
                }
            }
            if (idx === -1) {
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].name === name && arr[i].class === cls) {
                        idx = i;
                        break;
                    }
                }
            }
            if (idx !== -1) {
                movedPlayer = arr[idx];
                arr.splice(idx, 1);
            }
        } else if (isFromReserve && playerId && r) {
            var reserveIdx = -1;
            for (var i = 0; i < r.length; i++) {
                if (r[i].id === playerId) {
                    reserveIdx = i;
                    break;
                }
            }
            if (reserveIdx !== -1) {
                movedPlayer = r[reserveIdx];
                r.splice(reserveIdx, 1);
            }
        } else if (reserveIndex !== null && r && reserveIndex >= 0 && reserveIndex < r.length) {
            movedPlayer = r[reserveIndex];
            r.splice(reserveIndex, 1);
        } else if (isFromGuild && playerToMove) {
            movedPlayer = playerToMove;
            for (var d = 0; d < ['sat', 'sun'].length; d++) {
                var dayKey = ['sat', 'sun'][d];
                if (window.guildMembers && window.guildMembers[dayKey]) {
                    window.guildMembers[dayKey] = window.guildMembers[dayKey].filter(function(p) {
                        return p.id !== playerToMove.id;
                    });
                }
            }
        } else if (guildIndex !== null && gm && guildIndex >= 0 && guildIndex < gm.length) {
            movedPlayer = gm[guildIndex];
            gm.splice(guildIndex, 1);
        }
    }
    
    // ---- TRACK SOURCE REMOVAL (Phase 4.5) ----
    // Tell the server which collection(s) the player was removed from so the
    // merge can apply this move even when the snapshot is stale.
    if (movedPlayer && movedPlayer.id && typeof trackPlayerRemovals === 'function') {
        if (isFromGuild) {
            ['sat', 'sun'].forEach(function(dk) {
                trackPlayerRemovals('guild', dk, movedPlayer.id);
            });
        } else if (isFromReserve) {
            trackPlayerRemovals('reserve', day, movedPlayer.id);
        } else if (isFromGroup && group) {
            trackPlayerRemovals('group', day, movedPlayer.id, group);
        }
    }
    
    if (shouldAddToTarget) {
        if (targetIsReserve) {
            if (r) {
                var playerData = movedPlayer ? { ...movedPlayer } : { name: name, class: cls, role: role };
                if (!playerData.id) playerData.id = generatePlayerId();
                r.push(playerData);
                if (!movedPlayer) movedPlayer = playerData;
                movedTo = 'reserve';
                showToast('Added ' + playerData.name + ' to Reserves', 'success', 2000);
            }
        } else if (targetIsGuild) {
            if (!AuthModule.isAdmin() && !AuthModule.isMod()) {
                showToast('Only moderators and admins can add to guild members list.', 'error', 3000);
                dragData = null;
                render();
                return;
            }
            if (canAddToGuildMembers(day)) {
                if (gm && !isPlayerInGuildMembers(day, name, cls)) {
                    var playerData = movedPlayer ? { ...movedPlayer } : { name: name, class: cls, role: role };
                    if (!playerData.id) playerData.id = generatePlayerId();
                    gm.push(playerData);
                    if (!movedPlayer) movedPlayer = playerData;
                    movedTo = 'guild';
                    showToast('Added ' + playerData.name + ' to Guild Members', 'success', 2000);
                }
            }
        } else if (targetGroup && g && g[targetGroup]) {
            var playerData = movedPlayer ? { ...movedPlayer } : { name: name, class: cls, role: role };
            if (!playerData.id) playerData.id = generatePlayerId();
            g[targetGroup].players.push(playerData);
            if (!movedPlayer) movedPlayer = playerData;
            movedTo = targetGroup;
            showToast('Added ' + playerData.name + ' to ' + targetGroup, 'success', 2000);
        }
    }
    
    // ---- SAVE BACK TO GLOBAL STATE ----
    window.groups[day] = g;
    window.reserves[day] = r;
    window.guildMembers[day] = gm;
    
    // ---- LOG TO HISTORY ----
    if (movedPlayer && (shouldRemoveFromSource || shouldAddToTarget)) {
        if (typeof History !== 'undefined' && History.add) {
            var dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            var actionType = 'move';
            var fromDisplay = movedFrom || 'unknown';
            var toDisplay = movedTo || 'unknown';
            
            if (shouldRemoveFromSource && !shouldAddToTarget) {
                actionType = 'delete';
                toDisplay = 'deleted';
            } else if (!shouldRemoveFromSource && shouldAddToTarget) {
                actionType = 'add';
                fromDisplay = 'system';
            }
            
            History.add(actionType, {
                playerId: movedPlayer.id || null,
                playerName: movedPlayer.name || name,
                from: fromDisplay,
                to: toDisplay,
                day: day,
                details: (movedPlayer.name || name) + ' ' + (actionType === 'delete' ? 'deleted from' : actionType === 'add' ? 'added to' : 'moved from') + ' ' + fromDisplay + ' to ' + toDisplay + ' (' + dayName + ')'
            });
        }
    }
    
    dragData = null;
    updateLastUpdate();
    render();
}

window.attachDragListeners = attachDragListeners;
window.dragData = dragData;
console.log('DragDrop loaded successfully');