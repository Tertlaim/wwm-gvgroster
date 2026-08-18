// ============================================================
// BULK ACTIONS - Selection and bulk operations
// ============================================================

const BulkActions = {
    selectedPlayers: new Set(),
    selectionMode: false,
    selectionIndicator: null,
    
    init: function() {
        this.createSelectionIndicator();
        this.setupEventListeners();
        console.log('BulkActions initialized');
    },
    
    createSelectionIndicator: function() {
        const indicator = document.createElement('div');
        indicator.id = 'selectionIndicator';
        indicator.className = 'selection-mode-indicator';
        indicator.innerHTML = `
            <div class="selection-info">
                <i class="fas fa-check-circle"></i>
                <span><strong id="selectedCount">0</strong> players selected</span>
            </div>
            <div class="selection-actions">
                <button class="btn btn-bulk-move" data-action="bulk-move-reserve">
                    <i class="fas fa-arrow-right"></i> Copy to Reserve
                </button>
                <button class="btn btn-bulk-delete" data-action="bulk-delete" data-role-show="admin">
                    <i class="fas fa-trash"></i> Delete
                </button>
                <button class="btn btn-clear-selection" data-action="clear-selection">
                    <i class="fas fa-times"></i> Clear
                </button>
            </div>
        `;
        
        const stickyTabs = document.querySelector('.sticky-tabs');
        if (stickyTabs) {
            stickyTabs.parentNode.insertBefore(indicator, stickyTabs.nextSibling);
        } else {
            document.querySelector('.grid').parentNode.insertBefore(indicator, document.querySelector('.grid'));
        }
        
        this.selectionIndicator = indicator;
        
        // Hide delete button for non-admins
        const deleteBtn = indicator.querySelector('[data-action="bulk-delete"]');
        if (deleteBtn) {
            const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
            deleteBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        }
    },
    
    setupEventListeners: function() {
        this.selectionIndicator.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            
            const action = target.dataset.action;
            
            switch(action) {
                case 'bulk-move-reserve':
                    this.bulkCopyToReserve();
                    break;
                case 'bulk-delete':
                    this.bulkDelete();
                    break;
                case 'clear-selection':
                    this.clearSelection();
                    break;
            }
        });
    },
    
    togglePlayer: function(playerId, type, group = null) {
        const key = `${type}|${playerId}|${group || ''}`;
        
        if (this.selectedPlayers.has(key)) {
            this.selectedPlayers.delete(key);
        } else {
            this.selectedPlayers.add(key);
        }
        
        this.updateSelection();
    },
    
    isSelected: function(playerId, type, group = null) {
        const key = `${type}|${playerId}|${group || ''}`;
        return this.selectedPlayers.has(key);
    },
    
    getSelectedPlayers: function() {
        const players = [];
        
        this.selectedPlayers.forEach(key => {
            const parts = key.split('|');
            const type = parts[0];
            const playerId = parts[1];
            const group = parts[2] || null;
            
            if (type === 'guild') {
                // Use the master list (guildMembers)
                const gm = getGuildMembers();
                const player = gm.find(p => p.id === playerId);
                if (player) {
                    players.push({ ...player, type: 'guild', key });
                }
            } else if (type === 'group' && group) {
                const g = getGroups();
                if (g[group] && g[group].players) {
                    const player = g[group].players.find(p => p.id === playerId);
                    if (player) {
                        players.push({ ...player, type: 'group', group, key });
                    }
                }
            } else if (type === 'reserve') {
                const r = getReserves();
                const player = r.find(p => p.id === playerId);
                if (player) {
                    players.push({ ...player, type: 'reserve', key });
                }
            }
        });
        
        return players;
    },
    
    updateSelection: function() {
        const count = this.selectedPlayers.size;
        const countEl = document.getElementById('selectedCount');
        const indicator = this.selectionIndicator;
        
        if (countEl) countEl.textContent = count;
        
        if (count > 0) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
        
        // Update all guild checkboxes
        document.querySelectorAll('.guild-checkbox').forEach(cb => {
            const playerId = cb.dataset.playerId;
            const type = cb.dataset.type || 'guild';
            const group = cb.dataset.group || null;
            
            if (playerId && type) {
                cb.checked = this.isSelected(playerId, type, group);
                
                const parent = cb.closest('.guild-card');
                if (parent) {
                    if (cb.checked) {
                        parent.classList.add('selected');
                    } else {
                        parent.classList.remove('selected');
                    }
                }
            }
        });
        
        this.updateSelectAllState();
    },
    
    updateSelectAllState: function() {
        const checkboxes = document.querySelectorAll('.guild-checkbox');
        const checked = document.querySelectorAll('.guild-checkbox:checked');
        const selectAll = document.getElementById('selectAllCheckbox');
        
        if (selectAll) {
            if (checkboxes.length > 0 && checked.length === checkboxes.length) {
                selectAll.checked = true;
                selectAll.indeterminate = false;
            } else if (checked.length > 0) {
                selectAll.checked = false;
                selectAll.indeterminate = true;
            } else {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            }
        }
    },
    
    selectAll: function() {
        const checkboxes = document.querySelectorAll('.guild-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            if (allChecked) {
                cb.checked = false;
                const playerId = cb.dataset.playerId;
                const type = cb.dataset.type || 'guild';
                const group = cb.dataset.group || null;
                if (playerId && type) {
                    const key = `${type}|${playerId}|${group || ''}`;
                    this.selectedPlayers.delete(key);
                }
            } else {
                cb.checked = true;
                const playerId = cb.dataset.playerId;
                const type = cb.dataset.type || 'guild';
                const group = cb.dataset.group || null;
                if (playerId && type) {
                    const key = `${type}|${playerId}|${group || ''}`;
                    this.selectedPlayers.add(key);
                }
            }
        });
        
        this.updateSelection();
    },
    
    clearSelection: function() {
        this.selectedPlayers.clear();
        this.updateSelection();
        showToast('Selection cleared', 'info', 2000);
    },
    
    // ---- COPY TO RESERVE (Keep in Guild, Add to Reserves) ----
    bulkCopyToReserve: function() {
        const selected = this.getSelectedPlayers();
        if (selected.length === 0) {
            showToast('No players selected', 'warning', 2000);
            return;
        }
        
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        if (!isMod) {
            showToast('Only moderators and admins can copy to reserves.', 'error', 3000);
            return;
        }
        
        showConfirmation(`Copy ${selected.length} selected player(s) from Guild to Reserves? (Players will remain in Guild)`, () => {
            const day = window.currentDay;
            const r = getReserves();
            let copied = 0;
            let skipped = 0;
            
            selected.forEach(player => {
                // Check if already in reserves
                const exists = r.some(p => p.id === player.id);
                if (exists) {
                    skipped++;
                    return;
                }
                
                // Copy to reserves (preserve ID)
                r.push({ ...player, id: player.id });
                copied++;
            });
            
            // Save back to global state
            window.reserves[day] = r;
            
            this.clearSelection();
            updateLastUpdate();
            render();
            
            let message = `Copied ${copied} players to Reserves.`;
            if (skipped > 0) {
                message += ` ${skipped} already in reserves (skipped).`;
            }
            showToast(message, 'success', 3000);
        });
    },
    
    // ---- DELETE (Remove from ALL Sources) ----
    bulkDelete: function() {
        const selected = this.getSelectedPlayers();
        if (selected.length === 0) {
            showToast('No players selected', 'warning', 2000);
            return;
        }
        
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        if (!isAdmin) {
            showToast('Only admin can delete players.', 'error', 3000);
            return;
        }
        
        showConfirmation(
            `⚠️ WARNING: This will PERMANENTLY DELETE ${selected.length} player(s) from ALL panels (Guild, Groups, Reserves). This cannot be undone! Are you sure?`,
            () => {
                let deleted = 0;
                const days = ['sat', 'sun'];
                const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                
                // Full delete - tombstone these ids so stale copies can't resurrect them
                if (typeof trackDeletedPlayerIds === 'function') {
                    trackDeletedPlayerIds(selected.map(p => p.id).filter(Boolean));
                }
                
                selected.forEach(player => {
                    let removed = false;
                    
                    // 1. Remove from guildMembers (master list) - both days
                    days.forEach(day => {
                        if (window.guildMembers && window.guildMembers[day]) {
                            const idx = window.guildMembers[day].findIndex(p => p.id === player.id);
                            if (idx !== -1) {
                                window.guildMembers[day].splice(idx, 1);
                                removed = true;
                            }
                        }
                    });
                    
                    // 2. Remove from groups - both days
                    days.forEach(day => {
                        groupKeys.forEach(key => {
                            if (window.groups && window.groups[day] && window.groups[day][key]) {
                                const idx = window.groups[day][key].players.findIndex(p => p.id === player.id);
                                if (idx !== -1) {
                                    window.groups[day][key].players.splice(idx, 1);
                                    removed = true;
                                }
                            }
                        });
                    });
                    
                    // 3. Remove from reserves - both days
                    days.forEach(day => {
                        if (window.reserves && window.reserves[day]) {
                            const idx = window.reserves[day].findIndex(p => p.id === player.id);
                            if (idx !== -1) {
                                window.reserves[day].splice(idx, 1);
                                removed = true;
                            }
                        }
                    });
                    
                    if (removed) deleted++;
                });
                
                this.clearSelection();
                updateLastUpdate();
                render();
                saveState();
                
                showToast(`Deleted ${deleted} players from all panels.`, 'success', 3000);
            }
        );
    }
};

window.BulkActions = BulkActions;
console.log('BulkActions loaded successfully');