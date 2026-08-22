// ============================================================
// PANEL - Scroll shadow, collapsible panels (persisted),
// modal focus traps (Phase 11.2)
// ============================================================

function setupScrollShadow() {
    const header = document.querySelector('.header-wrapper');
    const tabs = document.querySelector('.sticky-tabs');
    
    if (header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 10) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }
    
    if (tabs) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 80) {
                tabs.classList.add('scrolled');
            } else {
                tabs.classList.remove('scrolled');
            }
        });
    }
}

// ---- Collapsible panels (click a header to expand/collapse, persisted) ----
// aria-expanded mirrors the collapsed state for assistive tech; the chevron
// is decorative (aria-hidden) because the whole header row is the control.
function syncCollapseAria(panel) {
    panel.setAttribute('aria-expanded', panel.classList.contains('collapsed') ? 'false' : 'true');
}

function saveCollapseState() {
    try {
        const collapsed = [];
        document.querySelectorAll('.collapsible.collapsed').forEach(function(p) {
            if (p.id) collapsed.push(p.id);
        });
        localStorage.setItem('gw_collapsed_panels', JSON.stringify(collapsed));
    } catch (e) {}
}

function restoreCollapseState() {
    try {
        document.querySelectorAll('.collapsible.collapsed').forEach(function(p) {
            p.classList.remove('collapsed');
        });
        const raw = localStorage.getItem('gw_collapsed_panels');
        if (!raw) return;
        const collapsed = JSON.parse(raw);
        if (!Array.isArray(collapsed)) return;
        collapsed.forEach(function(id) {
            const panel = document.getElementById(id);
            if (panel) panel.classList.add('collapsed');
        });
    } catch (e) {}
    document.querySelectorAll('.collapsible').forEach(syncCollapseAria);
}

function setupCollapsiblePanels() {
    document.querySelectorAll('.collapsible').forEach(function(panel) {
        const h3 = panel.querySelector('h3');
        if (!h3) return;
        let row = h3;
        while (row.parentElement && row.parentElement !== panel) {
            row = row.parentElement;
        }
        row.classList.add('panel-header-row');
        if (!row.querySelector('.collapse-chevron')) {
            const chevron = document.createElement('span');
            chevron.className = 'collapse-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.innerHTML = '<i class="fas fa-chevron-up"></i>';
            row.appendChild(chevron);
        }
        syncCollapseAria(panel);
        row.addEventListener('click', function(e) {
            if (e.target.closest('button, input, select, a')) return;
            panel.classList.toggle('collapsed');
            syncCollapseAria(panel);
            saveCollapseState();
        });
    });
    restoreCollapseState();
}

// ---- Modal focus trap: Tab stays inside the open modal (Phase 11 prep) ----
function setupModalFocusTraps() {
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Tab') return;
        const modal = document.querySelector('.modal-overlay.active');
        if (!modal) return;
        const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}

// ---- Side panel toggle (mobile: collapsible side panel) ----
function setupSidePanelToggle() {
    const toggleBtn = document.getElementById('sidePanelToggle');
    const sidePanel = document.getElementById('sidePanel');
    if (!toggleBtn || !sidePanel) return;
    
    // Create overlay
    let overlay = document.querySelector('.side-panel-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'side-panel-overlay';
        document.body.appendChild(overlay);
    }
    
    function openPanel() {
        sidePanel.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Hide the menu button when panel is open
        toggleBtn.style.display = 'none';
    }
    
    function closePanel() {
        sidePanel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        // Show the menu button again
        toggleBtn.style.display = '';
        toggleBtn.style.left = '';
        toggleBtn.style.right = '0';
    }
    
    toggleBtn.addEventListener('click', function() {
        openPanel();
    });
    
    overlay.addEventListener('click', function() {
        closePanel();
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sidePanel.classList.contains('open')) {
            closePanel();
        }
    });
    
    window.addEventListener('resize', function() {
        if (window.innerWidth > 1024 && sidePanel.classList.contains('open')) {
            closePanel();
        }
    });
}
