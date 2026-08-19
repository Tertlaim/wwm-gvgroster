// ============================================================
//  ANNOUNCEMENT - Announcement management
// ============================================================

function loadAnnouncement() {
    // SERVER IS THE SINGLE SOURCE OF TRUTH (Phase 4.3)
    // localStorage REMOVED — announcement is loaded from server data
    // via loadState()/applyServerData()
    var ann = App.state.announcement;
    if (ann && typeof ann === 'object') return ann.text || '';
    if (typeof ann === 'string') return ann;
    return '';
}

function saveAnnouncement(text, author, timestamp) {
    // Announcement is saved to server via saveState()
    App.state.announcement = {
        text: text,
        author: author || '',
        timestamp: timestamp || ''
    };
    return true;
}

function _renderAnnouncementMeta(author, timestamp) {
    if (!author && !timestamp) return '';
    var metaParts = [];
    if (author) metaParts.push('By ' + (typeof esc === 'function' ? esc(author) : author));
    if (timestamp) {
        try {
            var date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
                metaParts.push(date.toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                }));
            } else {
                metaParts.push(timestamp);
            }
        } catch (e) {
            metaParts.push(timestamp);
        }
    }
    return '<div class="announcement-meta">' + metaParts.join(' · ') + '</div>';
}

function renderAnnouncement() {
    var display = document.getElementById('announcementDisplay');
    var editor = document.getElementById('announcementEditor');
    var input = document.getElementById('announcementInput');
    var editBtn = document.getElementById('editAnnouncementBtn');
    var isModerator = isMod();

    // Load announcement (support both old string and new object format)
    var ann = App.state.announcement;
    var text = '', author = '', timestamp = '';
    if (ann && typeof ann === 'object') {
        text = ann.text || '';
        author = ann.author || '';
        timestamp = ann.timestamp || '';
    } else if (typeof ann === 'string') {
        text = ann;
    }

    if (text && text.trim()) {
        // Escape announcement text — it is rendered as HTML for all viewers
        var html = (typeof esc === 'function' ? esc(text) : text).replace(/\n/g, '<br>');
        html += _renderAnnouncementMeta(author, timestamp);
        display.innerHTML = html;
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
    var editBtn = document.getElementById('editAnnouncementBtn');
    var saveBtn = document.getElementById('saveAnnouncementBtn');
    var cancelBtn = document.getElementById('cancelAnnouncementBtn');
    var input = document.getElementById('announcementInput');
    var editor = document.getElementById('announcementEditor');

    // Edit button - show editor
    if (editBtn) {
        editBtn.addEventListener('click', function() {
            var ann = App.state.announcement;
            var currentText = (ann && typeof ann === 'object') ? (ann.text || '') : (typeof ann === 'string' ? ann : '');
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
            var text = input.value.trim();
            // Limit to 5 lines (approximately 500 characters)
            var lines = text.split('\n');
            if (lines.length > 5) {
                showToast('Maximum 5 lines allowed.', 'error', 2000);
                return;
            }
            if (text.length > 500) {
                showToast('Maximum 500 characters allowed.', 'error', 2000);
                return;
            }

            // Capture author and timestamp
            var author = (typeof window.currentUser === 'string' && window.currentUser) ? window.currentUser : '';
            var timestamp = new Date().toISOString();

            // Get old value for history
            var oldAnn = App.state.announcement;
            var oldText = (oldAnn && typeof oldAnn === 'object') ? (oldAnn.text || '') : (typeof oldAnn === 'string' ? oldAnn : '');

            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add) {
                History.add('announcement', {
                    details: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                    newValue: text,
                    oldValue: oldText
                });
                console.log('📝 History logged: announcement update');
            }

            saveAnnouncement(text, author, timestamp);
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
