// ============================================================
//  RENDER HELPERS - Reusable rendering functions
// ============================================================

const RenderHelpers = {};

RenderHelpers.createGroupPlayerBadge = function(player, index, groupKey, canEdit) {
    const displayRole = typeof getRoleDisplay === 'function' ? getRoleDisplay(player.role || 'Member') : (player.role || 'Member');
    const roleIcon = typeof getRoleIcon === 'function' ? getRoleIcon(player.role || 'Member') : '';
    const classIcon = typeof getClassIcon === 'function' ? getClassIcon(player.class) : '';
    const roleClass = typeof getRoleClass === 'function' ? getRoleClass(player.role || 'Member') : 'member';
    
    // ---- DUPLICATE DETECTION ----
    let isDuplicate = false;
    let duplicateCount = 0;
    const day = window.currentDay;
    
    if (day && App.state.groups && App.state.groups[day]) {
        const groupKeys = Object.keys(App.state.groups[day]);
        for (let i = 0; i < groupKeys.length; i++) {
            const key = groupKeys[i];
            if (App.state.groups[day][key] && App.state.groups[day][key].players) {
                for (let j = 0; j < App.state.groups[day][key].players.length; j++) {
                    const p = App.state.groups[day][key].players[j];
                    if (p.name === player.name && p.class === player.class) {
                        duplicateCount++;
                        if (duplicateCount > 1) {
                            isDuplicate = true;
                        }
                    }
                }
            }
        }
    }
    
    const badge = document.createElement('div');
    badge.className = 'player-badge ' + (canEdit ? 'admin-view' : 'public-view');
    if (isDuplicate) {
        badge.classList.add('duplicate-warning');
    }
    badge.draggable = canEdit;
    badge.dataset.editable = 'true';
    badge.dataset.type = 'group';
    badge.dataset.group = groupKey;
    badge.dataset.index = index;
    badge.dataset.playerId = player.id || '';
    badge.dataset.name = player.name;
    badge.dataset.class = player.class;
    badge.dataset.role = player.role || 'Member';
    
    if (canEdit) {
        badge.innerHTML = 
            '<span class="actions-left">' +
                '<button data-action="edit"><i class="fas fa-edit"></i></button>' +
            '</span>' +
            '<span class="player-tags">' +
                '<span class="class-tag display-mode">' + classIcon + ' ' + esc(player.class) + '</span>' +
                '<select class="class-select edit-mode" style="display:none;">' +
                    '<option ' + (player.class === 'Tank' ? 'selected' : '') + '>Tank</option>' +
                    '<option ' + (player.class === 'DPS' ? 'selected' : '') + '>DPS</option>' +
                    '<option ' + (player.class === 'Heal' ? 'selected' : '') + '>Heal</option>' +
                '</select>' +
            '</span>' +
            '<span class="player-info">' +
                '<span class="name display-mode">' + esc(player.name) + '</span>' +
                '<input class="name-edit edit-input edit-mode" value="' + esc(player.name) + '" maxlength="20" placeholder="name" style="display:none;">' +
            '</span>' +
            '<span class="player-tags">' +
                '<span class="role-tag display-mode ' + roleClass + '">' + roleIcon + ' ' + esc(displayRole) + '</span>' +
                '<select class="role-select edit-mode" style="display:none;">' +
                    '<option ' + ((player.role || 'Member') === 'Commander' ? 'selected' : '') + '>Commander</option>' +
                    '<option ' + ((player.role || 'Member') === 'Vice Commander' ? 'selected' : '') + '>Vice Commander</option>' +
                    '<option ' + ((player.role || 'Member') === 'Healer' ? 'selected' : '') + '>Healer</option>' +
                    '<option ' + ((player.role || 'Member') === 'Member' ? 'selected' : '') + '>Member</option>' +
                '</select>' +
            '</span>' +
            '<span class="actions-right action-buttons" style="display:none;">' +
                '<button data-action="save"><i class="fas fa-check"></i></button>' +
                '<button data-action="cancel"><i class="fas fa-times"></i></button>' +
            '</span>' +
            '<span class="actions-right">' +
                '<button data-action="return" title="Return to reserves"><i class="fas fa-arrow-down"></i></button>' +
            '</span>';
    } else {
        badge.innerHTML = 
            '<span class="player-info public-layout">' +
                '<span class="class-tag">' + classIcon + ' ' + esc(player.class) + '</span>' +
                '<span class="name">' + esc(player.name) + '</span>' +
                '<span class="role-name ' + roleClass + '">' + roleIcon + ' ' + esc(displayRole) + '</span>' +
            '</span>';
    }
    
    return badge;
};

RenderHelpers.createGroupCard = function(groupKey, groupData, canEdit, label) {
    const extraClass = { jungle: 'jungle', defence1: 'defence', offence1: '', offence2: '' };
    const sortedPlayers = groupData && groupData.players ? (typeof sortPlayers === 'function' ? sortPlayers(groupData.players) : groupData.players) : [];
    const title = groupData && groupData.title ? groupData.title : groupKey;
    const labelText = label || '';
    
    const card = document.createElement('div');
    card.className = 'group-card ' + (extraClass[groupKey] || '');
    card.dataset.group = groupKey;
    
    let titleHtml = '';
    if (canEdit) {
        // Edit/save/cancel sit at the FAR LEFT of the title row (visual change);
        // the remove (trash) button lives at the card's bottom-right instead.
        titleHtml = 
            '<span class="title-actions">' +
                '<button class="title-edit-btn" data-title-action="edit" data-group="' + groupKey + '" title="Edit group title" aria-label="Edit group title"><i class="fas fa-edit"></i></button>' +
                '<button class="title-save-btn" data-title-action="save" data-group="' + groupKey + '" title="Save group title" aria-label="Save group title" style="display:none;"><i class="fas fa-check"></i></button>' +
                '<button class="title-cancel-btn" data-title-action="cancel" data-group="' + groupKey + '" title="Cancel group title edit" aria-label="Cancel group title edit" style="display:none;"><i class="fas fa-times"></i></button>' +
            '</span>' +
            '<span class="title-display" data-group="' + groupKey + '">' + esc(title) + '</span>' +
            '<input class="title-edit" data-group="' + groupKey + '" value="' + esc(title) + '" maxlength="30" placeholder="Group name" style="display:none;">';
    } else {
        titleHtml = '<span>' + esc(title) + '</span>';
    }
    
    card.innerHTML = 
        '<div class="group-title" data-group="' + groupKey + '">' +
            '<span class="title-left">' +
                titleHtml +
            '</span>' +
            '<span><i class="fas fa-users"></i> ' + (sortedPlayers.length || 0) + '</span>' +
        '</div>' +
        '<div class="player-list" data-group="' + groupKey + '">' +
            (sortedPlayers.length > 0 ? 
                sortedPlayers.map(function(p, idx) {
                    return RenderHelpers.createGroupPlayerBadge(p, idx, groupKey, canEdit).outerHTML;
                }).join('') : 
                '<div style="color:#6f8aa8; font-size:0.8rem; padding:0.3rem 0.5rem; text-align:center;">No players in this group</div>'
            ) +
        '</div>' +
        (canEdit ? 
            '<div class="card-corner">' +
                '<button class="group-remove-btn" data-title-action="remove" data-group="' + groupKey + '" title="Remove group" aria-label="Remove group"><i class="fas fa-trash"></i></button>' +
                '<span class="panel-label">' + labelText + '</span>' +
            '</div>' : 
            '<span class="panel-label">' + labelText + '</span>');
    
    return card;
};

RenderHelpers.renderGroups = function(groups, canEdit) {
    const groupGrid = document.getElementById('groupGrid');
    if (!groupGrid) return;
    
    groupGrid.innerHTML = '';
    
    if (!groups || typeof groups !== 'object') {
        groupGrid.innerHTML = '<div style="color:#6f8aa8; text-align:center; padding:1rem;">No groups available</div>';
        return;
    }
    
    const groupKeys = Object.keys(groups);
    // Sort: default keys first (offence1, offence2, defence1, jungle), then custom groups
    const defaultOrder = ['offence1', 'offence2', 'defence1', 'jungle'];
    groupKeys.sort(function(a, b) {
        const aIdx = defaultOrder.indexOf(a);
        const bIdx = defaultOrder.indexOf(b);
        // Both default: keep original order
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        // One default, one custom: default first
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        // Both custom: sort by timestamp (extract number after underscore)
        const aTime = parseInt(a.split('_')[1]) || 0;
        const bTime = parseInt(b.split('_')[1]) || 0;
        return aTime - bTime;
    });
    
    for (let i = 0; i < groupKeys.length; i++) {
        const key = groupKeys[i];
        const label = 'B' + (i + 1);
        const card = RenderHelpers.createGroupCard(key, groups[key], canEdit, label);
        groupGrid.appendChild(card);
    }
};

RenderHelpers.createReserveBadge = function(player, index, canEdit) {
    if (!player) {
        return document.createElement('span');
    }
    
    const displayRole = typeof getRoleDisplay === 'function' ? getRoleDisplay(player.role || 'Member') : (player.role || 'Member');
    const roleIcon = typeof getRoleIcon === 'function' ? getRoleIcon(player.role || 'Member') : '';
    const classIcon = typeof getClassIcon === 'function' ? getClassIcon(player.class) : '';
    const roleClass = typeof getRoleClass === 'function' ? getRoleClass(player.role || 'Member') : 'member';
    
    const badge = document.createElement('span');
    badge.className = 'reserve-badge ' + (canEdit ? 'admin-view' : 'public-view');
    badge.draggable = canEdit;
    badge.dataset.editable = 'true';
    badge.dataset.type = 'reserve';
    badge.dataset.reserveIndex = index;
    badge.dataset.playerId = player.id || '';
    badge.dataset.name = player.name || '';
    badge.dataset.class = player.class || '';
    badge.dataset.role = player.role || 'Member';
    badge.id = 'reserve-' + index;
    
    if (canEdit) {
        badge.innerHTML = 
            '<div class="reserve-actions-left">' +
                '<button data-action="edit" aria-label="Edit ' + esc(player.name || '') + '"><i class="fas fa-edit"></i></button>' +
            '</div>' +
            '<div class="reserve-info">' +
                '<span class="class-tag display-mode">' + classIcon + ' ' + esc(player.class || '') + '</span>' +
                '<select class="class-select edit-mode" style="display:none;">' +
                    '<option ' + (player.class === 'Tank' ? 'selected' : '') + '>Tank</option>' +
                    '<option ' + (player.class === 'DPS' ? 'selected' : '') + '>DPS</option>' +
                    '<option ' + (player.class === 'Heal' ? 'selected' : '') + '>Heal</option>' +
                '</select>' +
                '<span class="name display-mode">' + esc(player.name || '') + '</span>' +
                '<input class="name-edit edit-input edit-mode" value="' + esc(player.name || '') + '" maxlength="20" style="display:none;">' +
                '<span class="role-tag display-mode ' + roleClass + '">' + roleIcon + ' ' + esc(displayRole) + '</span>' +
                '<select class="role-select edit-mode" style="display:none;">' +
                    '<option ' + ((player.role || 'Member') === 'Commander' ? 'selected' : '') + '>Commander</option>' +
                    '<option ' + ((player.role || 'Member') === 'Vice Commander' ? 'selected' : '') + '>Vice Commander</option>' +
                    '<option ' + ((player.role || 'Member') === 'Healer' ? 'selected' : '') + '>Healer</option>' +
                    '<option ' + ((player.role || 'Member') === 'Member' ? 'selected' : '') + '>Member</option>' +
                '</select>' +
            '</div>' +
            '<div class="reserve-actions-right action-buttons" style="display:none;">' +
                '<button data-action="save" aria-label="Save changes for ' + esc(player.name || '') + '"><i class="fas fa-check"></i></button>' +
                '<button data-action="cancel" aria-label="Cancel editing ' + esc(player.name || '') + '"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<input type="checkbox" class="reserve-checkbox" data-reserve="' + index + '" aria-label="Select ' + esc(player.name || '') + '">';
    } else {
        badge.innerHTML = 
            '<span class="player-info public-layout">' +
                '<span class="class-tag">' + classIcon + ' ' + esc(player.class || '') + '</span>' +
                '<span class="name">' + esc(player.name || '') + '</span>' +
                '<span class="role-name ' + roleClass + '">' + roleIcon + ' ' + esc(displayRole) + '</span>' +
            '</span>';
    }
    
    return badge;
};

RenderHelpers.createGuildBadge = function(player, index, canEdit) {
    const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    const classIcon = typeof getClassIcon === 'function' ? getClassIcon(player.class) : '';
    
    const badge = document.createElement('span');
    badge.className = 'guild-member-badge';
    badge.draggable = canEdit;
    badge.dataset.editable = 'true';
    badge.dataset.type = 'guild';
    badge.dataset.guildIndex = index;
    badge.dataset.playerId = player.id || '';
    badge.dataset.name = player.name;
    badge.dataset.class = player.class;
    badge.dataset.role = player.role || 'Member';
    
    if (isAdmin) {
        badge.innerHTML = 
            '<div class="guild-actions-left">' +
                '<button data-action="edit" aria-label="Edit ' + esc(player.name) + '"><i class="fas fa-edit"></i></button>' +
            '</div>' +
            '<div class="guild-content">' +
                '<span class="class-tag display-mode">' + classIcon + ' ' + esc(player.class) + '</span>' +
                '<select class="class-select edit-mode" style="display:none;">' +
                    '<option ' + (player.class === 'Tank' ? 'selected' : '') + '>Tank</option>' +
                    '<option ' + (player.class === 'DPS' ? 'selected' : '') + '>DPS</option>' +
                    '<option ' + (player.class === 'Heal' ? 'selected' : '') + '>Heal</option>' +
                '</select>' +
                '<span class="name display-mode">' + esc(player.name) + '</span>' +
                '<input class="name-edit edit-input edit-mode" value="' + esc(player.name) + '" maxlength="20" style="display:none;">' +
            '</div>' +
            '<div class="guild-actions-right action-buttons" style="display:none;">' +
                '<button data-action="save" aria-label="Save changes for ' + esc(player.name) + '"><i class="fas fa-check"></i></button>' +
                '<button data-action="cancel" aria-label="Cancel editing ' + esc(player.name) + '"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="guild-actions-right">' +
                '<button data-action="delete" title="Remove from guild" aria-label="Remove ' + esc(player.name) + ' from guild"><i class="fas fa-trash" style="color:#f87171;"></i></button>' +
            '</div>' +
            '<input type="checkbox" class="guild-checkbox" data-guild="' + index + '" aria-label="Select ' + esc(player.name) + '">';
    } else {
        badge.innerHTML = 
            '<div class="guild-content">' +
                '<span class="class-tag">' + classIcon + ' ' + esc(player.class) + '</span>' +
                '<span class="name">' + esc(player.name) + '</span>' +
            '</div>';
    }
    
    return badge;
};

RenderHelpers.renderReserves = function(reserves, canEdit) {
    const reservePool = document.getElementById('reservePool');
    const reserveCount = document.getElementById('reserveCount');
    const reserveActions = document.getElementById('reserveActions');
    const dragHint = document.getElementById('dragHint');
    
    if (!reservePool) {
        return;
    }
    
    reservePool.innerHTML = '';
    
    const reserveList = Array.isArray(reserves) ? reserves : [];
    
    if (reserveList.length === 0) {
        reservePool.innerHTML = '<div style="color:#6f8aa8; font-size:0.8rem; padding:0.3rem 0.5rem; text-align:center;">No reserves</div>';
        if (reserveCount) reserveCount.textContent = '0';
        if (reserveActions) reserveActions.style.display = canEdit ? 'flex' : 'none';
        if (dragHint) dragHint.style.display = canEdit ? 'block' : 'none';
        return;
    }
    
    for (let i = 0; i < reserveList.length; i++) {
        const p = reserveList[i];
        const badge = RenderHelpers.createReserveBadge(p, i, canEdit);
        reservePool.appendChild(badge);
    }
    
    if (reserveCount) reserveCount.textContent = reserveList.length;
    if (reserveActions) reserveActions.style.display = canEdit ? 'flex' : 'none';
    if (dragHint) dragHint.style.display = canEdit ? 'block' : 'none';
};

// ============================================================
// GUILD CARDS - Render guild members as cards
// ============================================================

RenderHelpers.renderGuildCards = function() {
    const container = document.getElementById('guildMemberPool');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Use guildMembers as the source (master list)
    const gm = getGuildMembers();
    const allPlayers = Array.isArray(gm) ? gm : [];
    
    // Sort players by name
    allPlayers.sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });
    
    const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    const canEdit = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    
    const countEl = document.getElementById('guildMemberCount');
    if (countEl) countEl.textContent = allPlayers.length;

    // The filter is only meaningful when there are members to filter.
    const filterInput = document.getElementById('guildFilterInput');
    if (filterInput) filterInput.style.display = allPlayers.length ? '' : 'none';

    if (allPlayers.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:var(--spacing-md);">No registered players</div>';
        RenderHelpers.applyGuildFilter();
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'guild-cards-grid';
    grid.id = 'guildCardsGrid';

    allPlayers.forEach(function(player, index) {
        const card = RenderHelpers.createGuildCard(player, index, canEdit);
        grid.appendChild(card);
    });

    container.appendChild(grid);

    // Re-apply the persisted query so a sync re-render does not resurrect
    // filtered-out cards or a stale shown/total count.
    RenderHelpers.applyGuildFilter();
};

// ---- Guild member name filter ----
// CSS-hide approach: cards stay mounted, so bulk checkboxes, open edit forms
// and drag state survive filtering. The query persists in the input across
// re-renders and is re-applied by renderGuildCards().
RenderHelpers.applyGuildFilter = function() {
    const input = document.getElementById('guildFilterInput');
    const pool = document.getElementById('guildMemberPool');
    if (!input || !pool) return;

    const q = input.value.trim().toLowerCase();
    const cards = pool.querySelectorAll('.guild-card');
    let shown = 0;
    cards.forEach(function(card) {
        const match = !q || String(card.dataset.name || '').toLowerCase().includes(q);
        card.classList.toggle('filter-hidden', !match);
        if (match) shown++;
    });

    // Header shows "shown/total" while filtering, plain total otherwise.
    const countEl = document.getElementById('guildMemberCount');
    if (countEl) countEl.textContent = q ? (shown + '/' + cards.length) : String(cards.length);

    const emptyHint = document.getElementById('guildFilterEmpty');
    if (emptyHint) emptyHint.style.display = (q && cards.length > 0 && shown === 0) ? '' : 'none';
};

RenderHelpers.setupGuildFilter = function() {
    const input = document.getElementById('guildFilterInput');
    if (!input) return;
    input.addEventListener('input', RenderHelpers.applyGuildFilter);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            input.value = '';
            RenderHelpers.applyGuildFilter();
        }
    });
};

RenderHelpers.createGuildCard = function(player, index, canEdit) {
    const isAdmin = typeof AuthModule !== 'undefined' ? AuthModule.isAdmin() : false;
    const classIcon = typeof getClassIcon === 'function' ? getClassIcon(player.class) : '';
    const roleClass = typeof getRoleClass === 'function' ? getRoleClass(player.role || 'Member') : 'member';
    const roleDisplay = typeof getRoleDisplay === 'function' ? getRoleDisplay(player.role || 'Member') : (player.role || 'Member');
    
    const card = document.createElement('div');
    card.className = 'guild-card';
    card.dataset.playerId = player.id;
    card.dataset.type = 'guild';
    card.dataset.index = index;
    card.dataset.name = player.name;
    card.dataset.class = player.class;
    card.dataset.role = player.role || 'Member';
    
    if (canEdit) {
        card.draggable = true;
        card.dataset.type = 'guild';
    }
    
    const isSelected = window.BulkActions && BulkActions.isSelected(player.id, 'guild');
    if (isSelected) card.classList.add('selected');
    
    card.innerHTML = 
        '<div class="card-header">' +
            (isAdmin ? 
                '<button class="edit-card-btn" data-action="edit-guild-card" title="Edit player" aria-label="Edit ' + esc(player.name) + '">' +
                    '<i class="fas fa-edit"></i>' +
                '</button>' : '') +
            '<div class="card-name">' +
                '<span class="class-icon">' + classIcon + '</span>' +
                '<span class="name">' + esc(player.name) + '</span>' +
            '</div>' +
            (isAdmin ? 
                '<div class="card-checkbox">' +
                    '<input type="checkbox" class="guild-checkbox" data-player-id="' + esc(player.id) + '" data-type="guild" aria-label="Select ' + esc(player.name) + '" ' + (isSelected ? 'checked' : '') + '>' +
                '</div>' : '') +
        '<div class="card-body">' +
            '<div class="card-class">' +
                '<span>Class:</span>' +
                '<span class="class-tag">' + esc(player.class) + '</span>' +
            '</div>' +
            '<div class="card-role">' +
                '<span>Role:</span>' +
                '<span class="role-tag ' + roleClass + '">' + esc(roleDisplay) + '</span>' +
            '</div>' +
            (player.note ? 
                '<div class="card-notes">' +
                    '<span class="note-icon" title="View note">' +
                        '<i class="fas fa-sticky-note"></i>' +
                    '</span>' +
                    '<div class="note-tooltip">' +
                        '<div class="tooltip-content">' + esc(player.note) + '</div>' +
                        '<div class="tooltip-arrow"></div>' +
                    '</div>' +
                '</div>' : '') +
        '</div>' +
        (isAdmin ? 
            '<div class="card-footer">' +
                '<button class="add-note-btn" data-action="add-note" title="' + (player.note ? 'Edit note' : 'Add note') + '">' +
                    '<i class="fas fa-' + (player.note ? 'sticky-note' : 'plus-circle') + '"></i>' +
                '</button>' +
                '<button class="delete-card-btn" data-action="delete-guild-card" title="Delete player">' +
                    '<i class="fas fa-trash"></i>' +
                '</button>' +
            '</div>' : '');
    
    const checkbox = card.querySelector('.guild-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', function(e) {
            e.stopPropagation();
            if (window.BulkActions) {
                BulkActions.togglePlayer(player.id, 'guild');
            }
        });
    }
    
    const noteIcon = card.querySelector('.note-icon');
    const noteTooltip = card.querySelector('.note-tooltip');
    if (noteIcon && noteTooltip) {
        noteIcon.addEventListener('mouseenter', function() {
            noteTooltip.classList.add('active');
        });
        noteIcon.addEventListener('mouseleave', function() {
            noteTooltip.classList.remove('active');
        });
        noteIcon.addEventListener('click', function() {
            noteTooltip.classList.toggle('active');
        });
    }
    
    const editBtn = card.querySelector('[data-action="edit-guild-card"]');
    if (editBtn) {
        editBtn.addEventListener('click', function() {
            this.enterGuildCardEditMode(card, player);
        }.bind(this));
    }
    
    const noteBtn = card.querySelector('[data-action="add-note"]');
    if (noteBtn) {
        noteBtn.addEventListener('click', function() {
            this.enterGuildCardNoteMode(card, player);
        }.bind(this));
    }
    
    const deleteBtn = card.querySelector('[data-action="delete-guild-card"]');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            if (typeof showConfirmation === 'function') {
                showConfirmation('Remove "' + player.name + '" from guild members?', function() {
                    this.deleteGuildCard(player);
                }.bind(this));
            }
        }.bind(this));
    }
    
    return card;
};

RenderHelpers.enterGuildCardEditMode = function(card, player) {
    if (card.classList.contains('editing')) return;
    card.classList.add('editing');
    card.draggable = false;
    
    const nameEl = card.querySelector('.card-name .name');
    const classEl = card.querySelector('.card-class .class-tag');
    const roleEl = card.querySelector('.card-role .role-tag');
    const footer = card.querySelector('.card-footer');
    
    const originalName = player.name;
    const originalClass = player.class;
    const originalRole = player.role || 'Member';
    
    nameEl.innerHTML = '<input class="name-edit-input" value="' + esc(originalName) + '" maxlength="20">';
    classEl.innerHTML = 
        '<select class="class-edit-select">' +
            '<option ' + (originalClass === 'Tank' ? 'selected' : '') + '>Tank</option>' +
            '<option ' + (originalClass === 'DPS' ? 'selected' : '') + '>DPS</option>' +
            '<option ' + (originalClass === 'Heal' ? 'selected' : '') + '>Heal</option>' +
        '</select>';
    roleEl.innerHTML = 
        '<select class="role-edit-select">' +
            '<option ' + (originalRole === 'Commander' ? 'selected' : '') + '>Commander</option>' +
            '<option ' + (originalRole === 'Vice Commander' ? 'selected' : '') + '>Vice Commander</option>' +
            '<option ' + (originalRole === 'Healer' ? 'selected' : '') + '>Healer</option>' +
            '<option ' + (originalRole === 'Member' ? 'selected' : '') + '>Member</option>' +
        '</select>';
    
    footer.innerHTML = 
        '<button class="save-card-btn" data-action="save-guild-card">' +
            '<i class="fas fa-check"></i> Save' +
        '</button>' +
        '<button class="cancel-card-btn" data-action="cancel-guild-card">' +
            '<i class="fas fa-times"></i> Cancel' +
        '</button>';
    
    footer.querySelector('[data-action="save-guild-card"]').addEventListener('click', function() {
        const newName = card.querySelector('.name-edit-input').value.trim();
        if (!newName) {
            showToast('Name cannot be empty', 'error', 2000);
            return;
        }
        
        const newClass = card.querySelector('.class-edit-select').value;
        const newRole = card.querySelector('.role-edit-select').value;
        
        this.updateGuildPlayer(player.id, newName, newClass, newRole);
        
        card.classList.remove('editing');
        render(true); // force: the card's display mode changed even if data didn't
        showToast('Player updated successfully', 'success', 2000);
    }.bind(this));
    
    footer.querySelector('[data-action="cancel-guild-card"]').addEventListener('click', function() {
        card.classList.remove('editing');
        render(true); // force: cancel must close the form even when data is unchanged
    });
    
    const input = card.querySelector('.name-edit-input');
    if (input) {
        // Single-line + Enter to commit, Escape to cancel (Phase 6.4)
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const saveBtn = card.querySelector('[data-action="save-guild-card"]');
                if (saveBtn) saveBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const cancelBtn = card.querySelector('[data-action="cancel-guild-card"]');
                if (cancelBtn) cancelBtn.click();
            }
        });
        input.focus();
    }
};

RenderHelpers.enterGuildCardNoteMode = function(card, player) {
    // Disable drag while editing note so textarea clicks work normally
    card.draggable = false;
    // Hide delete button to prevent accidental clicks during note edit
    const deleteBtn = card.querySelector('[data-action="delete-guild-card"]');
    if (deleteBtn) deleteBtn.style.display = 'none';
    
    let notesEl = card.querySelector('.card-notes');
    if (!notesEl) {
        const body = card.querySelector('.card-body');
        const newNotes = document.createElement('div');
        newNotes.className = 'card-notes';
        body.appendChild(newNotes);
        notesEl = newNotes;
    }
    
    const currentNote = player.note || '';
    notesEl.innerHTML = 
        '<div class="note-content">' +
            '<textarea class="note-edit" maxlength="140" placeholder="Add a note (max 140 characters)">' + esc(currentNote) + '</textarea>' +
            '<div class="note-char-count">' + currentNote.length + '/140</div>' +
            '<div class="note-actions">' +
                '<button class="save-note-btn" data-action="save-note">' +
                    '<i class="fas fa-check"></i> Save' +
                '</button>' +
                '<button class="cancel-note-btn" data-action="cancel-note">' +
                    '<i class="fas fa-times"></i> Cancel' +
                '</button>' +
            '</div>' +
        '</div>';
    
    const textarea = notesEl.querySelector('.note-edit');
    const charCount = notesEl.querySelector('.note-char-count');
    
    textarea.addEventListener('input', function() {
        const len = textarea.value.length;
        charCount.textContent = len + '/140';
        if (len >= 140) {
            charCount.classList.add('limit-reached');
        } else {
            charCount.classList.remove('limit-reached');
        }
    });
    
    notesEl.querySelector('[data-action="save-note"]').addEventListener('click', function() {
        const note = textarea.value.trim().substring(0, 140);
        player.note = note;
        this.updateGuildPlayerNote(player.id, note);
        render(true); // force: close the note form even if the note was cleared
        showToast('Note saved', 'success', 2000);
    }.bind(this));
    
    notesEl.querySelector('[data-action="cancel-note"]').addEventListener('click', function() {
        render(true); // force: cancel must close the note form
    });
    
    textarea.focus();
};

RenderHelpers.updateGuildPlayer = function(playerId, name, cls, role) {
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    // Phase 13: guildMembers is a flat array
    if (Array.isArray(App.state.guildMembers)) {
        const player = App.state.guildMembers.find(function(p) { return p.id === playerId; });
        if (player) {
            player.name = name;
            player.class = cls;
            player.role = role;
        }
    }
    
    days.forEach(function(day) {
        groupKeys.forEach(function(key) {
            if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                const player = App.state.groups[day][key].players.find(function(p) { return p.id === playerId; });
                if (player) {
                    player.name = name;
                    player.class = cls;
                    player.role = role;
                }
            }
        });
    });
    
    days.forEach(function(day) {
        if (App.state.reserves && App.state.reserves[day]) {
            const player = App.state.reserves[day].find(function(p) { return p.id === playerId; });
            if (player) {
                player.name = name;
                player.class = cls;
                player.role = role;
            }
        }
    });
    
    updateLastUpdate();
    saveState();
};

RenderHelpers.updateGuildPlayerNote = function(playerId, note) {
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    // Phase 13: guildMembers is a flat array
    if (Array.isArray(App.state.guildMembers)) {
        const player = App.state.guildMembers.find(function(p) { return p.id === playerId; });
        if (player) {
            player.note = note;
        }
    }
    
    days.forEach(function(day) {
        groupKeys.forEach(function(key) {
            if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                const player = App.state.groups[day][key].players.find(function(p) { return p.id === playerId; });
                if (player) {
                    player.note = note;
                }
            }
        });
    });
    
    days.forEach(function(day) {
        if (App.state.reserves && App.state.reserves[day]) {
            const player = App.state.reserves[day].find(function(p) { return p.id === playerId; });
            if (player) {
                player.note = note;
            }
        }
    });
    
    updateLastUpdate();
    saveState();
};

RenderHelpers.deleteGuildCard = function(player) {
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    // Full delete - tombstone so stale copies can't resurrect the player
    if (player && player.id && typeof trackDeletedPlayerIds === 'function') {
        trackDeletedPlayerIds(player.id);
    }

    // Phase 13 fix: track guildMembers removal so the server applies it
    if (player && player.id && typeof trackPlayerRemovals === 'function') {
        trackPlayerRemovals('guild', window.currentDay || 'sat', player.id);
    }
    
    // Phase 13: guildMembers is a flat array
    if (Array.isArray(App.state.guildMembers)) {
        App.state.guildMembers = App.state.guildMembers.filter(function(p) { return p.id !== player.id; });
    }
    
    days.forEach(function(day) {
        groupKeys.forEach(function(key) {
            if (App.state.groups && App.state.groups[day] && App.state.groups[day][key]) {
                App.state.groups[day][key].players = App.state.groups[day][key].players.filter(function(p) { return p.id !== player.id; });
            }
        });
    });
    
    days.forEach(function(day) {
        if (App.state.reserves && App.state.reserves[day]) {
            App.state.reserves[day] = App.state.reserves[day].filter(function(p) { return p.id !== player.id; });
        }
    });
    
    updateLastUpdate();
    render();
    saveState();
    showToast('Removed ' + player.name + ' from guild members', 'info', 2000);
};

window.RenderHelpers = RenderHelpers;
console.log('RenderHelpers loaded successfully');