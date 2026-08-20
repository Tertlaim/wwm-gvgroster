// ============================================================
// SHORTCUTS - Keyboard shortcuts system
// ============================================================

const Shortcuts = {
    shortcuts: {},
    legendVisible: false,
    
    init: function() {
        this.registerShortcuts();
        this.setupLegend();
        this.setupKeyListener();
        console.log('Shortcuts initialized');
    },
    
    registerShortcuts: function() {
        this.shortcuts = {
            'ctrl+s': {
                keys: ['ctrl', 's'],
                description: 'Save state',
                action: () => {
                    if (typeof saveState === 'function') {
                        saveState();
                        showToast('State saved', 'success', 1500);
                    }
                }
            },
            'enter': {
                keys: ['enter'],
                description: 'Save edit',
                action: () => {
                    // Trigger save on active edit field
                    const activeElement = document.activeElement;
                    if (activeElement && activeElement.closest('[data-editable]')) {
                        const saveBtn = activeElement.closest('[data-editable]').querySelector('[data-action="save"]');
                        if (saveBtn) saveBtn.click();
                    }
                }
            },
            'escape': {
                keys: ['escape'],
                description: 'Cancel / Close',
                action: () => {
                    // Cancel edit
                    const activeElement = document.activeElement;
                    if (activeElement && activeElement.closest('[data-editable]')) {
                        const cancelBtn = activeElement.closest('[data-editable]').querySelector('[data-action="cancel"]');
                        if (cancelBtn) cancelBtn.click();
                    }
                    // Close modals
                    document.querySelectorAll('.modal-overlay.active').forEach(modal => {
                        modal.classList.remove('active');
                    });
                    // Clear selection
                    if (typeof BulkActions !== 'undefined') {
                        BulkActions.clearSelection();
                    }
                }
            },
            'ctrl+shift+t': {
                keys: ['ctrl', 'shift', 't'],
                description: 'Toggle theme',
                action: () => {
                    if (typeof ThemeManager !== 'undefined') {
                        ThemeManager.toggleTheme();
                    }
                }
            },
            'c': {
                keys: ['c'],
                description: 'Copy selected player to Reserves',
                action: () => {
                    if (typeof ContextMenu !== 'undefined') {
                        if (!ContextMenu.selectedEl) {
                            this.hintSelect();
                            return;
                        }
                        ContextMenu.copyToReserve(ContextMenu.selectedEl);
                    }
                }
            },
            'm': {
                keys: ['m'],
                description: 'Move selected player to a group',
                action: () => {
                    if (typeof ContextMenu !== 'undefined') {
                        if (!ContextMenu.selectedEl) {
                            this.hintSelect();
                            return;
                        }
                        ContextMenu.openMoveMenu(ContextMenu.selectedEl);
                    }
                }
            },
            'e': {
                keys: ['e'],
                description: 'Edit selected player',
                action: () => {
                    if (typeof ContextMenu !== 'undefined') {
                        if (!ContextMenu.selectedEl) {
                            this.hintSelect();
                            return;
                        }
                        ContextMenu.editPlayer(ContextMenu.selectedEl);
                    }
                }
            },
            'delete': {
                keys: ['delete'],
                description: 'Delete selected player',
                action: () => {
                    if (typeof ContextMenu !== 'undefined') {
                        if (!ContextMenu.selectedEl) {
                            this.hintSelect();
                            return;
                        }
                        ContextMenu.deletePlayer(ContextMenu.selectedEl);
                    }
                }
            },
            'backspace': {
                keys: ['backspace'],
                description: 'Delete selected player',
                action: () => {
                    if (typeof ContextMenu !== 'undefined') {
                        if (!ContextMenu.selectedEl) {
                            this.hintSelect();
                            return;
                        }
                        ContextMenu.deletePlayer(ContextMenu.selectedEl);
                    }
                }
            },
            '?': {
                keys: ['?'],
                description: 'Show shortcuts',
                action: () => {
                    this.toggleLegend();
                }
            },
            'ctrl+/': {
                keys: ['ctrl', '/'],
                description: 'Show shortcuts',
                action: () => {
                    this.toggleLegend();
                }
            }
        };
    },
    
    // Gentle nudge when a player-action key is pressed with nothing selected
    hintSelect: function() {
        const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
        if (!isMod) return;
        if (typeof showToast === 'function') {
            showToast('Select a player first (click one, then press a key)', 'info', 2500);
        }
    },
    
    setupKeyListener: function() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts if typing in input (except Enter)
            const tag = e.target.tagName.toLowerCase();
            const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
            
            // Allow Enter to save in inputs
            if (isInput && e.key === 'Enter') {
                const saveBtn = e.target.closest('[data-editable]')?.querySelector('[data-action="save"]');
                if (saveBtn) {
                    e.preventDefault();
                    saveBtn.click();
                    return;
                }
            }
            
            // Don't trigger other shortcuts if typing in input
            if (isInput) {
                return;
            }
            
            // Build key combination string
            const keys = [];
            if (e.ctrlKey || e.metaKey) keys.push('ctrl');
            if (e.shiftKey) keys.push('shift');
            if (e.altKey) keys.push('alt');
            keys.push(e.key.toLowerCase());
            
            const combo = keys.join('+');
            
            // Check if shortcut exists
            if (this.shortcuts[combo]) {
                e.preventDefault();
                this.shortcuts[combo].action();
            }
        });
    },
    
    setupLegend: function() {
        // Create legend container if it doesn't exist
        let legend = document.getElementById('shortcutsLegend');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'shortcutsLegend';
            legend.className = 'shortcuts-legend';
            document.body.appendChild(legend);
        }
        
        // Build legend content
        const shortcutEntries = Object.entries(this.shortcuts);
        legend.innerHTML = `
            <div class="shortcuts-header">
                <span>⌨️ Keyboard Shortcuts</span>
                <button class="shortcuts-close" title="Close shortcuts">×</button>
            </div>
            <div class="shortcuts-grid">
                ${shortcutEntries.map(([combo, shortcut]) => `
                    <div class="shortcut-item">
                        <kbd>${combo.replace(/\+/g, ' + ').toUpperCase()}</kbd>
                        <span>${shortcut.description}</span>
                    </div>
                `).join('')}
            </div>
            <div class="shortcuts-footer">
                Press <kbd>?</kbd> or <kbd>Ctrl+/</kbd> to toggle
            </div>
        `;
        
        // Close button
        legend.querySelector('.shortcuts-close').addEventListener('click', () => {
            this.hideLegend();
        });
        
        // Click outside to close
        legend.addEventListener('click', (e) => {
            if (e.target === legend) {
                this.hideLegend();
            }
        });
        
        // Initially hidden
        legend.classList.remove('visible');
    },
    
    toggleLegend: function() {
        const legend = document.getElementById('shortcutsLegend');
        if (!legend) return;
        
        this.legendVisible = !this.legendVisible;
        legend.classList.toggle('visible', this.legendVisible);
    },
    
    showLegend: function() {
        const legend = document.getElementById('shortcutsLegend');
        if (!legend) return;
        
        this.legendVisible = true;
        legend.classList.add('visible');
    },
    
    hideLegend: function() {
        const legend = document.getElementById('shortcutsLegend');
        if (!legend) return;
        
        this.legendVisible = false;
        legend.classList.remove('visible');
    }
};

// Make Shortcuts globally available
window.Shortcuts = Shortcuts;
console.log('Shortcuts loaded successfully');