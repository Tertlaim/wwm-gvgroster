// ============================================================
// HELP - Help & Shortcuts panel (role-aware) (Phase 11.2)
// ============================================================

function renderHelpPanel() {
    const container = document.getElementById('helpShortcuts');
    if (!container) return;
    
    const isMod = typeof AuthModule !== 'undefined' ? AuthModule.isMod() : false;
    
    if (!isMod) {
        container.innerHTML =
            '<div style="font-size:var(--font-size-sm); color:var(--text-secondary); line-height:1.7;">' +
                '<i class="fas fa-info-circle"></i> You are viewing the roster as a guest. ' +
                'Register above to join a group, or download the roster as an <em>Image</em> or <em>PDF</em> below.' +
            '</div>';
    } else if (typeof Shortcuts !== 'undefined' && Shortcuts.shortcuts) {
        const entries = Object.keys(Shortcuts.shortcuts).map(function(combo) {
            return { combo: combo, description: Shortcuts.shortcuts[combo].description };
        });
        container.innerHTML =
            '<h4 style="font-weight:600; color:var(--text-primary); margin-bottom:var(--spacing-xs); display:flex; align-items:center; gap:var(--spacing-sm);"><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h4>' +
            '<div class="help-shortcuts-grid">' +
            entries.map(function(entry) {
                return '<div class="help-shortcut-item"><kbd>' + entry.combo.replace(/\+/g, ' + ').toUpperCase() + '</kbd><span>' + entry.description + '</span></div>';
            }).join('') +
            '</div>';
    }
    
    // Toggle the mod-only guide bullets
    document.querySelectorAll('#helpPanel [data-help-role="mod"]').forEach(function(el) {
        el.style.display = isMod ? '' : 'none';
    });
}
