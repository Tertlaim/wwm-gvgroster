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
            'ctrl+enter': {
                keys: ['ctrl', 'enter'],
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
            'ctrl+t': {
                keys: ['ctrl', 't'],
                description: 'Toggle theme',
                action: () => {
                    if (typeof ThemeManager !== 'undefined') {
                        ThemeManager.toggleTheme();
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
    
    setupKeyListener: function() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts if typing in input
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                // Allow Ctrl+Enter to save in inputs
                if (e.key === 'Enter' && e.ctrlKey) {
                    const saveBtn = e.target.closest('[data-editable]')?.querySelector('[data-action="save"]');
                    if (saveBtn) {
                        e.preventDefault();
                        saveBtn.click();
                    }
                }
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