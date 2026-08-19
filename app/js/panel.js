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
        // First clear all collapsed states so HTML defaults don't override
        // user preferences stored in localStorage.
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
}

function setupCollapsiblePanels() {
    document.querySelectorAll('.collapsible').forEach(function(panel) {
        const h3 = panel.querySelector('h3');
        if (!h3) return;
        // The header ROW is the direct child of the panel that contains the h3
        // (h3 itself for most panels; the flex wrapper in the admin panel;
        // .reserve-header / .guild-header for those areas). The chevron lives
        // in the row so it always sits at the panel's top-right, uniformly.
        let row = h3;
        while (row.parentElement && row.parentElement !== panel) {
            row = row.parentElement;
        }
        row.classList.add('panel-header-row');
        if (!row.querySelector('.collapse-chevron')) {
            const chevron = document.createElement('span');
            chevron.className = 'collapse-chevron';
            chevron.innerHTML = '<i class="fas fa-chevron-up"></i>';
            row.appendChild(chevron);
        }
        row.addEventListener('click', function(e) {
            // Don't toggle when clicking an interactive child inside the header row
            if (e.target.closest('button, input, select, a')) return;
            panel.classList.toggle('collapsed');
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
