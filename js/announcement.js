// ============================================================
//  ANNOUNCEMENT - Announcement management
// ============================================================

function loadAnnouncement() {
    // SERVER IS THE SINGLE SOURCE OF TRUTH (Phase 4.3)
    // localStorage REMOVED — announcement is loaded from server data
    // via loadState()/applyServerData()
    return window.announcementText || '';
}

function saveAnnouncement(text) {
    // Announcement is saved to server via saveState()
    // localStorage caching REMOVED (Phase 4.3)
    window.announcementText = text;
    return true;
}

function renderAnnouncement() {
    const display = document.getElementById('announcementDisplay');
    const editor = document.getElementById('announcementEditor');
    const input = document.getElementById('announcementInput');
    const editBtn = document.getElementById('editAnnouncementBtn');
    const isModerator = isMod();
    
    // Load announcement
    const text = window.announcementText || '';
    
    if (text && text.trim()) {
        // Escape announcement text - it is rendered as HTML for all viewers
        display.innerHTML = (typeof esc === 'function' ? esc(text) : text).replace(/\n/g, '<br>');
    } else {
        display.innerHTML = '<span style="color:#6f8aa8;">No announcements yet.</span>';
    }
    
    // Show/hide edit button for mods
    if (editBtn) {
        editBtn.style.display = isModerator ? 'inline-flex' : 'none';
    }
    
    // Hide editor by default
    if (editor) {
        editor.style.display = 'none';
    }
}

function setupAnnouncement() {
    const editBtn = document.getElementById('editAnnouncementBtn');
    const saveBtn = document.getElementById('saveAnnouncementBtn');
    const cancelBtn = document.getElementById('cancelAnnouncementBtn');
    const input = document.getElementById('announcementInput');
    const display = document.getElementById('announcementDisplay');
    const editor = document.getElementById('announcementEditor');
    
    // Edit button - show editor
    if (editBtn) {
        editBtn.addEventListener('click', function() {
            const currentText = window.announcementText || '';
            input.value = currentText;
            editor.style.display = 'block';
            editBtn.style.display = 'none';
            input.focus();
            // Phase 8.3: an open editor blocks sync re-renders mid-typing.
            if (typeof beginUserEdit === 'function') beginUserEdit();
        });
    }
    
    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            const text = input.value.trim();
            // Limit to 5 lines (approximately 500 characters)
            const lines = text.split('\n');
            if (lines.length > 5) {
                showToast('Maximum 5 lines allowed.', 'error', 2000);
                return;
            }
            if (text.length > 500) {
                showToast('Maximum 500 characters allowed.', 'error', 2000);
                return;
            }
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add) {
                History.add('announcement', {
                    details: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                    newValue: text,
                    oldValue: window.announcementText || ''
                });
                console.log('📝 History logged: announcement update');
            }
            
            window.announcementText = text;
            saveAnnouncement(text);
            editor.style.display = 'none';
            if (editBtn) editBtn.style.display = 'inline-flex';
            if (typeof endUserEdit === 'function') endUserEdit();
            renderAnnouncement();
            saveState(); // Save to server
            render(); // Refresh UI
            showToast('Announcement saved', 'success', 1500);
        });
    }
    
    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            editor.style.display = 'none';
            if (editBtn) editBtn.style.display = 'inline-flex';
            if (typeof endUserEdit === 'function') endUserEdit();
        });
    }
    
    // Load initial announcement
    loadAnnouncement();
    renderAnnouncement();
}