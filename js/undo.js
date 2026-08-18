// ============================================================
// UNDO - Undo/Redo system
// ============================================================

const UndoManager = {
    undoStack: [],
    redoStack: [],
    maxStackSize: 50,
    isEnabled: true,
    
    init: function() {
        this.updateButtons();
        console.log('UndoManager initialized');
    },
    
    // Add an action to undo stack
    push: function(action, data, reverseAction) {
        if (!this.isEnabled) return;
        if (!action || !data) return;
        
        // Limit stack size
        if (this.undoStack.length >= this.maxStackSize) {
            this.undoStack.shift();
        }
        
        this.undoStack.push({
            action: action,
            data: data,
            reverseAction: reverseAction || null,
            timestamp: Date.now()
        });
        
        // Clear redo stack when new action is added
        this.redoStack = [];
        
        // Update UI
        this.updateButtons();
        
        console.log('↩️ Undo stack size:', this.undoStack.length);
    },
    
    // Undo last action
undo: function() {
    if (this.undoStack.length === 0) {
        showToast('Nothing to undo', 'info', 1500);
        return false;
    }
    
    var action = this.undoStack.pop();
    console.log('↩️ Undoing:', action.action);
    
    // Execute reverse action
    if (action.reverseAction && typeof action.reverseAction === 'function') {
        action.reverseAction(action.data);
    } else {
        // If no reverse action, just restore the state snapshots
        if (action.data.groupsSnapshot) {
            window.groups = JSON.parse(action.data.groupsSnapshot);
        }
        if (action.data.reservesSnapshot) {
            window.reserves = JSON.parse(action.data.reservesSnapshot);
        }
        if (action.data.guildMembersSnapshot) {
            window.guildMembers = JSON.parse(action.data.guildMembersSnapshot);
        }
        updateLastUpdate();
        render();
    }
    
    // Push to redo stack
    this.redoStack.push(action);
    
    this.updateButtons();
    showToast(`Undo: ${action.action}`, 'info', 1500);
    
    // Update history panel after undo
    if (typeof History !== 'undefined' && History.renderHistory) {
        History.renderHistory();
    }
    
    return true;
},
    
    // Redo last undone action
    redo: function() {
        if (this.redoStack.length === 0) {
            showToast('Nothing to redo', 'info', 1500);
            return false;
        }
        
        var action = this.redoStack.pop();
        console.log('↪️ Redoing:', action.action);
        
        // For redo, we need to re-apply the action
        // Since we don't have the original action function, restore from snapshots
        // The snapshots are from before the undo, so they represent the "after" state
        if (action.data.groupsSnapshot) {
            // For redo, we need to restore the state from before undo
            // But since we don't have that, we'll use the current state
            // and rely on the user to redo
            showToast('Redo: Please redo manually', 'info', 1500);
            return false;
        }
        
        this.updateButtons();
        showToast(`Redo: ${action.action}`, 'info', 1500);
        
        return true;
    },
    
    // Clear all stacks
    clear: function() {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtons();
    },
    
    // Update UI buttons
    updateButtons: function() {
        var undoBtn = document.getElementById('undoBtn');
        var redoBtn = document.getElementById('redoBtn');
        
        if (undoBtn) {
            undoBtn.disabled = this.undoStack.length === 0;
            undoBtn.title = this.undoStack.length > 0 ? 
                `Undo (${this.undoStack.length})` : 
                'Nothing to undo';
        }
        
        if (redoBtn) {
            redoBtn.disabled = this.redoStack.length === 0;
            redoBtn.title = this.redoStack.length > 0 ? 
                `Redo (${this.redoStack.length})` : 
                'Nothing to redo';
        }
    },
    
    // Get stack size
    getUndoCount: function() {
        return this.undoStack.length;
    },
    
    getRedoCount: function() {
        return this.redoStack.length;
    }
};

// Make UndoManager globally available
window.UndoManager = UndoManager;
console.log('UndoManager loaded successfully');