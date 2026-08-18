// ============================================================
//  CONTEXT MENU - Right-click player actions + keyboard select (Phase 7)
// ============================================================
// Right-click any player (group badge, reserve badge, guild card) to get a
// quick-action menu: Copy to Reserve, Move to Group (submenu), Edit, Delete.
// The same actions power the Phase 7.2 keyboard shortcuts (C / M / E / Delete)
// via the click-to-select flow (ContextMenu.selectedEl).

const ContextMenu = {
    menu: null,
    targetEl: null,
    selectedEl: null,
    
    init: function() {
        this.createMenu();
        this.setupContextListener();
        this.setupSelection();
        this.setupCloseListeners();
        console.log('ContextMenu initialized');
    },
    
    createMenu: function() {
        const menu = document.createElement('div');
        menu.id = 'contextMenu';
        menu.className = 'context-menu';
        document.body.appendChild(menu);
        this.menu = menu;
        
        const self = this;
        menu.addEventListener('click', function(e) {
            // Submenu entry (Move to Group target) - handle first
            const moveItem = e.target.closest('[data-cm-move]');
            if (moveItem) {
                const el = self.targetEl;
                const targetGroup = moveItem.dataset.cmMove;
                self.close();
                if (el && targetGroup) {
                    self.moveToGroup(el, targetGroup);
                }
                return;
            }
            
            const item = e.target.closest('[data-cm-action]');
            if (!item) return;
            const action = item.dataset.cmAction;
            const target = self.targetEl;
            self.close();
            if (!target) return;
            
            switch(action) {
                case 'copy':
                    self.copyToReserve(target);
                    break;
                case 'edit':
                    self.editPlayer(target);
                    break;
                case 'delete':
                    self.deletePlayer(target);
                    break;
            }
        });
    },
    
    setupContextListener: function() {
        const self = this;
        document.addEventListener('contextmenu', function(e) {
            const el = e.target.closest('[data-editable], .guild-card');
            if (!el || !el.dataset || !el.dataset.type) {
                self.close();
                return;
            }
            const items = self.buildItems(el);
            if (items.length === 0) {
                // Public viewers have no actions - leave the native menu alone
                self.close();
                return;
            }
            e.preventDefault();
            self.open(e, el, items);
        });
    },
    
    // Which menu items apply to this element for the current user
    buildItems: function(el) {
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        const type = el.dataset.type;
        const items = [];
        
        if (isMod && type !== 'reserve') {
            items.push({ action: 'copy', icon: 'fa-arrow-right', label: 'Copy to Reserve' });
        }
        if (isMod) {
            items.push({ action: 'move', icon: 'fa-arrows-alt', label: 'Move to Group', submenu: true });
        }
        if (isMod && (type !== 'guild' || isAdmin)) {
            items.push({ action: 'edit', icon: 'fa-edit', label: 'Edit Player' });
        }
        if (isAdmin || (type === 'reserve' && isMod)) {
            items.push({ action: 'delete', icon: 'fa-trash', label: 'Delete', danger: true });
        }
        return items;
    },
    
    open: function(e, el, items) {
        const menu = this.menu;
        menu.innerHTML = '';
        
        const header = document.createElement('div');
        header.className = 'context-menu-header';
        header.textContent = (el.dataset.name || 'Player');
        menu.appendChild(header);
        
        const self = this;
        items.forEach(function(item) {
            const div = document.createElement('div');
            div.className = 'context-menu-item' + (item.danger ? ' danger' : '');
            div.dataset.cmAction = item.action;
            div.innerHTML = '<i class="fas ' + item.icon + '"></i><span>' + item.label + '</span>';
            if (item.submenu) {
                div.classList.add('has-submenu');
                div.innerHTML += '<i class="fas fa-chevron-right submenu-arrow"></i>';
                div.appendChild(self.buildGroupSubmenu());
            }
            menu.appendChild(div);
        });
        
        this.targetEl = el;
        this.select(el);
        menu.classList.add('visible');
        
        // Position near the cursor, flipping when near the right/bottom edge
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        let left = e.clientX + 4;
        let top = e.clientY + 4;
        if (left + menuWidth > window.innerWidth - 8) {
            left = e.clientX - menuWidth - 4;
        }
        if (top + menuHeight > window.innerHeight - 8) {
            top = window.innerHeight - menuHeight - 8;
        }
        menu.style.left = Math.max(4, left) + 'px';
        menu.style.top = Math.max(4, top) + 'px';
    },
    
    buildGroupSubmenu: function() {
        const sub = document.createElement('div');
        sub.className = 'context-menu-submenu';
        const g = (typeof getGroups === 'function') ? getGroups() : {};
        const keys = Object.keys(g);
        if (keys.length === 0) {
            sub.innerHTML = '<div class="context-menu-item" style="cursor:default; color:var(--text-muted);">No groups</div>';
            return sub;
        }
        const self = this;
        keys.sort().forEach(function(key) {
            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.dataset.cmMove = key;
            const title = (g[key] && g[key].title) ? g[key].title : key;
            div.innerHTML = '<i class="fas fa-layer-group"></i><span>' + esc(title) + '</span>';
            sub.appendChild(div);
        });
        return sub;
    },
    
    // ---- Click-to-select (Phase 7.2 keyboard flow) ----
    setupSelection: function() {
        const self = this;
        document.addEventListener('click', function(e) {
            // Clicking controls (buttons/inputs/selects/menu) never selects
            if (e.target.closest('button, input, select, a, textarea, [data-action], .context-menu')) {
                return;
            }
            const el = e.target.closest('[data-editable], .guild-card');
            if (el && el.dataset && el.dataset.type) {
                self.select(el);
            } else {
                self.clearSelection();
            }
        });
    },
    
    select: function(el) {
        if (this.selectedEl && this.selectedEl !== el) {
            this.selectedEl.classList.remove('context-selected');
        }
        this.selectedEl = el;
        if (el) el.classList.add('context-selected');
    },
    
    clearSelection: function() {
        if (this.selectedEl) {
            this.selectedEl.classList.remove('context-selected');
        }
        this.selectedEl = null;
    },
    
    setupCloseListeners: function() {
        const self = this;
        document.addEventListener('click', function() {
            self.close();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                self.close();
                self.clearSelection();
            }
        });
        window.addEventListener('scroll', function() {
            self.close();
        }, true);
        window.addEventListener('resize', function() {
            self.close();
        });
    },
    
    close: function() {
        if (this.menu) {
            this.menu.classList.remove('visible');
            this.menu.classList.remove('submenu-open');
        }
        this.targetEl = null;
    },
    
    // Keyboard path (M key): reveal the Move-to-Group menu for the selected
    // player, positioned next to the element, with the submenu already open.
    openMoveMenu: function(el) {
        if (!el) return;
        const menu = this.menu;
        if (!menu) return;
        
        const items = this.buildItems(el);
        const hasMove = items.some(function(i) { return i.submenu; });
        if (!hasMove) return;
        
        menu.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'context-menu-header';
        header.textContent = 'Move ' + (el.dataset.name || 'player');
        menu.appendChild(header);
        
        const div = document.createElement('div');
        div.className = 'context-menu-item has-submenu';
        div.dataset.cmAction = 'move';
        div.innerHTML = '<i class="fas fa-arrows-alt"></i><span>Move to Group</span>';
        div.appendChild(this.buildGroupSubmenu());
        menu.appendChild(div);
        
        this.targetEl = el;
        menu.classList.add('visible', 'submenu-open');
        
        const rect = el.getBoundingClientRect();
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + menuWidth > window.innerWidth - 8) {
            left = window.innerWidth - menuWidth - 8;
        }
        if (top + menuHeight > window.innerHeight - 8) {
            top = rect.top - menuHeight - 4;
        }
        menu.style.left = Math.max(4, left) + 'px';
        menu.style.top = Math.max(4, top) + 'px';
    },
    
    // ============================================================
    //  ACTIONS - shared by the right-click menu and the C/M/E/Delete keys
    // ============================================================
    
    // Resolve the live player object backing a rendered element
    findPlayer: function(el) {
        if (!el || !el.dataset) return null;
        const type = el.dataset.type;
        const playerId = el.dataset.playerId;
        if (!playerId) return null;
        
        if (type === 'group' && el.dataset.group) {
            const g = (typeof getGroups === 'function') ? getGroups() : {};
            const list = g[el.dataset.group] && g[el.dataset.group].players;
            if (list) return list.find(function(p) { return p.id === playerId; }) || null;
        } else if (type === 'reserve') {
            const r = (typeof getReserves === 'function') ? getReserves() : [];
            return r.find(function(p) { return p.id === playerId; }) || null;
        } else if (type === 'guild') {
            const gm = (typeof getGuildMembers === 'function') ? getGuildMembers() : [];
            return gm.find(function(p) { return p.id === playerId; }) || null;
        }
        return null;
    },
    
    copyToReserve: function(el) {
        if (!el) return;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        if (!isMod) {
            showToast('Only moderators and admins can copy to reserves.', 'error', 3000);
            return;
        }
        const player = this.findPlayer(el);
        if (!player) {
            showToast('Player not found.', 'error', 2000);
            return;
        }
        const day = window.currentDay || 'sat';
        const r = getReserves();
        if (r.some(function(p) { return p.id === player.id; })) {
            showToast('"' + player.name + '" is already in Reserves.', 'warning', 3000);
            return;
        }
        r.push(Object.assign({}, player));
        window.reserves[day] = r;
        if (typeof updateLastUpdate === 'function') updateLastUpdate();
        if (typeof render === 'function') render();
        showToast('Copied ' + player.name + ' to Reserves', 'success', 2000);
    },
    
    moveToGroup: function(el, targetGroup) {
        if (!el || !targetGroup) return;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        if (!isMod) {
            showToast('Only moderators can move players.', 'error', 3000);
            return;
        }
        const day = window.currentDay || 'sat';
        const g = getGroups();
        if (!g[targetGroup]) {
            showToast('Target group not found.', 'error', 2000);
            return;
        }
        const player = this.findPlayer(el);
        if (!player) {
            showToast('Player not found.', 'error', 2000);
            return;
        }
        const type = el.dataset.type;
        const sourceGroup = el.dataset.group || null;
        
        if (type === 'group' && sourceGroup === targetGroup) {
            showToast('"' + player.name + '" is already in that group.', 'warning', 3000);
            return;
        }
        
        // Mirror the drag & drop duplicate warning (still allowed, highlighted)
        let duplicateCount = 0;
        Object.keys(g).forEach(function(key) {
            if (g[key] && g[key].players) {
                g[key].players.forEach(function(p) {
                    if (p.name === player.name && p.class === player.class) duplicateCount++;
                });
            }
        });
        if (duplicateCount > 0) {
            const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            showToast('"' + player.name + '" already exists in a group for ' + dayName + '. Duplicates will be highlighted.', 'warning', 3000);
        }
        
        let movedFrom = null;
        
        // Remove from source (tracked so stale merges keep the move)
        if (type === 'guild') {
            ['sat', 'sun'].forEach(function(dk) {
                if (window.guildMembers && window.guildMembers[dk]) {
                    window.guildMembers[dk] = window.guildMembers[dk].filter(function(p) { return p.id !== player.id; });
                }
            });
            if (typeof trackPlayerRemovals === 'function') {
                ['sat', 'sun'].forEach(function(dk) { trackPlayerRemovals('guild', dk, player.id); });
            }
            movedFrom = 'guild';
        } else if (type === 'group' && sourceGroup && g[sourceGroup]) {
            g[sourceGroup].players = g[sourceGroup].players.filter(function(p) { return p.id !== player.id; });
            if (typeof trackPlayerRemovals === 'function') trackPlayerRemovals('group', day, player.id, sourceGroup);
            movedFrom = sourceGroup;
        } else if (type === 'reserve') {
            const r = getReserves();
            window.reserves[day] = r.filter(function(p) { return p.id !== player.id; });
            if (typeof trackPlayerRemovals === 'function') trackPlayerRemovals('reserve', day, player.id);
            movedFrom = 'reserve';
        }
        
        // Add to the target group, preserving the player's id
        g[targetGroup].players.push(Object.assign({}, player));
        window.groups[day] = g;
        
        if (typeof History !== 'undefined' && History.add) {
            const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
            const toTitle = (g[targetGroup] && g[targetGroup].title) ? g[targetGroup].title : targetGroup;
            History.add('move', {
                playerId: player.id || null,
                playerName: player.name,
                from: movedFrom || 'unknown',
                to: targetGroup,
                day: day,
                details: player.name + ' moved from ' + (movedFrom || 'unknown') + ' to ' + toTitle + ' (' + dayName + ')'
            });
        }
        
        if (typeof updateLastUpdate === 'function') updateLastUpdate();
        if (typeof render === 'function') render();
        const targetTitle = (g[targetGroup] && g[targetGroup].title) ? g[targetGroup].title : targetGroup;
        showToast('Moved ' + player.name + ' to ' + targetTitle, 'success', 2000);
    },
    
    editPlayer: function(el) {
        if (!el) return;
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        const type = el.dataset.type;
        
        if (type === 'guild' && !isAdmin) {
            showToast('Only admin can edit guild members.', 'error', 2000);
            return;
        }
        if (!isMod) {
            showToast('Only moderators can edit.', 'error', 2000);
            return;
        }
        
        if (el.classList.contains('guild-card')) {
            const player = this.findPlayer(el);
            if (player && typeof RenderHelpers !== 'undefined' && RenderHelpers.enterGuildCardEditMode) {
                RenderHelpers.enterGuildCardEditMode(el, player);
            }
        } else {
            // Trigger the badge's normal edit flow (permission checks + UI)
            const btn = el.querySelector('[data-action="edit"]');
            if (btn) btn.click();
        }
    },
    
    deletePlayer: function(el) {
        if (!el) return;
        const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        const type = el.dataset.type;
        const player = this.findPlayer(el);
        if (!player) {
            showToast('Player not found.', 'error', 2000);
            return;
        }
        const day = window.currentDay || 'sat';
        const self = this;
        
        if (type === 'guild') {
            if (!isAdmin) {
                showToast('Only admin can delete guild members.', 'error', 2000);
                return;
            }
            if (typeof showConfirmation === 'function') {
                showConfirmation('Remove "' + player.name + '" from guild members?', function() {
                    if (typeof RenderHelpers !== 'undefined' && RenderHelpers.deleteGuildCard) {
                        RenderHelpers.deleteGuildCard(player);
                    }
                    self.clearSelection();
                });
            }
        } else if (type === 'group') {
            if (!isAdmin) {
                showToast('Only admin can delete players.', 'error', 2000);
                return;
            }
            const group = el.dataset.group;
            if (typeof showConfirmation === 'function') {
                showConfirmation('Remove "' + player.name + '" from the group? (Guild/Reserves entries are kept)', function() {
                    const g = getGroups();
                    if (g[group]) {
                        g[group].players = g[group].players.filter(function(p) { return p.id !== player.id; });
                        window.groups[day] = g;
                        if (typeof trackPlayerRemovals === 'function') trackPlayerRemovals('group', day, player.id, group);
                        if (typeof History !== 'undefined' && History.add) {
                            History.add('delete', {
                                playerId: player.id,
                                playerName: player.name,
                                from: group,
                                details: player.name + ' removed from group ' + group
                            });
                        }
                        if (typeof updateLastUpdate === 'function') updateLastUpdate();
                        if (typeof render === 'function') render();
                        showToast('Removed ' + player.name + ' from group', 'success', 2000);
                    }
                    self.clearSelection();
                });
            }
        } else if (type === 'reserve') {
            if (!isMod) {
                showToast('Only moderators can delete reserves.', 'error', 2000);
                return;
            }
            if (typeof showConfirmation === 'function') {
                showConfirmation('Remove "' + player.name + '" from Reserves?', function() {
                    const r = getReserves();
                    window.reserves[day] = r.filter(function(p) { return p.id !== player.id; });
                    if (typeof trackPlayerRemovals === 'function') trackPlayerRemovals('reserve', day, player.id);
                    if (typeof History !== 'undefined' && History.add) {
                        History.add('delete', {
                            playerId: player.id,
                            playerName: player.name,
                            from: 'reserve',
                            details: player.name + ' removed from Reserves'
                        });
                    }
                    if (typeof updateLastUpdate === 'function') updateLastUpdate();
                    if (typeof render === 'function') render();
                    showToast('Removed ' + player.name + ' from Reserves', 'success', 2000);
                });
            }
        }
    }
};

window.ContextMenu = ContextMenu;
console.log('ContextMenu loaded successfully');
