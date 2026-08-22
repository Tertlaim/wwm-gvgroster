// ============================================================
// HISTORY - Change history tracking
// ============================================================

const History = {
    entries: [],
    maxEntries: 100,
    isEnabled: true,
    
    init: function() {
        this.loadHistory();
        this.setupClearButton();
        console.log('History initialized');
    },
    
    loadHistory: async function() {
        try {
            const response = await fetch('/api/history');
            if (!response.ok) {
                throw new Error('Failed to load history: ' + response.status);
            }
            const data = await response.json();
            if (data && data.entries) {
                this.entries = data.entries;
                this.maxEntries = data.maxEntries || 100;
                console.log('✅ History loaded:', this.entries.length, 'entries');
            } else {
                this.entries = [];
                this.maxEntries = 100;
            }
            this.renderHistory();
        } catch (error) {
            console.error('Error loading history:', error);
            this.entries = [];
            this.maxEntries = 100;
            this.renderHistory();
            // Try to create the file via the server
            try {
                const initHeaders = typeof getAuthHeader === 'function' ? getAuthHeader() : {};
                await fetch('/api/history/init', { method: 'POST', headers: initHeaders });
                console.log('✅ Attempted to initialize history file');
            } catch (e) {
                console.error('Could not initialize history:', e);
            }
        }
    },
    
    setupClearButton: function() {
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clear();
            });
        }
    },
    
    add: async function(action, data = {}) {
        if (!this.isEnabled) return;
        
        try {
            const headers = { 'Content-Type': 'application/json' };
            // POST /api/history requires a mod+ session; without the header
            // the server now rejects the entry (audit-log hardening).
            if (typeof getAuthHeader === 'function') {
                Object.assign(headers, getAuthHeader());
            }
            const response = await fetch('/api/history', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    action: action,
                    ...data
                })
            });
            const result = await response.json();
            if (result.success && result.entry) {
                this.entries.unshift(result.entry);
                // Keep only max entries
                if (this.entries.length > this.maxEntries) {
                    this.entries = this.entries.slice(0, this.maxEntries);
                }
                // Update UI immediately
                this.renderHistory();
                console.log('📝 History updated:', this.entries.length, 'entries');
            }
        } catch (error) {
            console.error('Error adding history:', error);
        }
    },
    
    clear: async function() {
        if (!confirm('Clear all history entries?')) return;
        
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (typeof getAuthHeader === 'function') {
                Object.assign(headers, getAuthHeader());
            }
            const response = await fetch('/api/history', {
                method: 'DELETE',
                headers: headers
            });
            const result = await response.json();
            if (result.success) {
                this.entries = [];
                this.renderHistory();
                if (typeof showToast === 'function') {
                    showToast('History cleared', 'success', 2000);
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast(result.error || 'Failed to clear history', 'error', 3000);
                }
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            if (typeof showToast === 'function') {
                showToast('Error clearing history', 'error', 3000);
            }
        }
    },
    
    renderHistory: function() {
        const container = document.getElementById('historyList');
        if (!container) return;
        
        if (!this.entries || this.entries.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:var(--spacing-sm); font-size:var(--font-size-sm);">No history yet</div>';
            return;
        }
        
        // Show last 20 entries
        const displayEntries = this.entries.slice(0, 20);
        
        container.innerHTML = displayEntries.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const date = new Date(entry.timestamp).toLocaleDateString();
            const icon = this.getActionIcon(entry.action);
            const text = this.getActionText(entry);
            // History entries are user-supplied (public POST /api/history) - escape everything
            const safe = typeof esc === 'function' ? esc : (s) => s;
            
            return `
                <div class="history-item" title="${safe(entry.timestamp)}">
                    <span class="history-icon">${icon}</span>
                    <span class="history-text">${safe(text)}</span>
                    <span class="history-time">${date} ${time}</span>
                </div>
            `;
        }).join('');
    },
    
    getActionIcon: function(action) {
        const icons = {
            'move': '🔄',
            'edit': '✏️',
            'add': '➕',
            'delete': '🗑️',
            'bulk': '📦',
            'group_add': '📁',
            'group_remove': '📂',
            'guild_name': '🏷️',
            'announcement': '📢',
            'clear': '🧹'
        };
        return icons[action] || '📝';
    },
    
    getActionText: function(entry) {
        const { action, playerName, from, to, day, field, oldValue, newValue, details } = entry;
        const dayName = day === 'sat' ? 'Saturday' : day === 'sun' ? 'Sunday' : '';
        
        switch(action) {
            case 'move':
                return `${playerName || 'Player'} moved from ${from || 'unknown'} to ${to || 'unknown'} (${dayName})`;
            case 'edit':
                return `${playerName || 'Player'} ${field || 'field'} changed: ${oldValue || 'empty'} → ${newValue || 'empty'}`;
            case 'add':
                return `${playerName || 'Player'} added to ${to || 'reserves'} (${dayName})`;
            case 'delete':
                return `${playerName || 'Player'} deleted from ${from || 'unknown'} (${dayName})`;
            case 'bulk':
                return `Bulk action: ${details || 'multiple players'}`;
            case 'group_add':
                return `Group "${details || 'unknown'}" added to ${dayName}`;
            case 'group_remove':
                return `Group "${details || 'unknown'}" removed from ${dayName}`;
            case 'guild_name':
                return `Guild name changed to "${details || newValue}"`;
            case 'announcement':
                return `Announcement updated`;
            case 'clear':
                return `History cleared`;
            default:
                return `${action}: ${playerName || 'unknown'}`;
        }
    },
    
    getEntries: function() {
        return this.entries || [];
    },
    
    getLastEntry: function() {
        return this.entries && this.entries.length > 0 ? this.entries[0] : null;
    }
};

// Make History globally available
window.History = History;
console.log('History loaded successfully');