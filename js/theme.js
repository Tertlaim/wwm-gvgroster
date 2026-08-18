// ============================================================
// THEME MANAGEMENT - Dark/Light theme switching
// ============================================================

const ThemeManager = {
    currentTheme: 'dark',
    
    init: function() {
        // Get saved theme from cookie
        const savedTheme = this.getThemeFromCookie();
        
        // Check system preference if no saved theme
        if (!savedTheme) {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                this.currentTheme = 'light';
            } else {
                this.currentTheme = 'dark';
            }
        } else {
            this.currentTheme = savedTheme;
        }
        
        // Apply theme
        this.applyTheme(this.currentTheme);
        
        // Setup theme toggle
        this.setupThemeToggle();
        
        // Listen for system theme changes
        this.setupSystemThemeListener();
        
        console.log('Theme initialized:', this.currentTheme);
    },
    
    getThemeFromCookie: function() {
        const match = document.cookie.match(/gw_theme=([^;]+)/);
        return match ? match[1] : null;
    },
    
    setThemeInCookie: function(theme) {
        document.cookie = `gw_theme=${theme};path=/;max-age=31536000;SameSite=Lax`;
    },
    
    applyTheme: function(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.setThemeInCookie(theme);
        this.updateToggleIcon();
    },
    
    toggleTheme: function() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        
        // Animate transition
        document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
        setTimeout(() => {
            document.body.style.transition = '';
        }, 300);
    },
    
    setupThemeToggle: function() {
        const toggleBtn = document.getElementById('themeToggle');
        if (!toggleBtn) {
            console.warn('Theme toggle button not found');
            return;
        }
        
        // Update icon based on current theme
        this.updateToggleIcon();
        
        // Click handler
        toggleBtn.addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Keyboard shortcut: T for theme toggle
        document.addEventListener('keydown', (e) => {
            if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.toggleTheme();
            }
        });
    },
    
    updateToggleIcon: function() {
        const toggleBtn = document.getElementById('themeToggle');
        if (!toggleBtn) return;
        
        const icon = toggleBtn.querySelector('i');
        if (!icon) return;
        
        if (this.currentTheme === 'dark') {
            icon.className = 'fas fa-moon';
            toggleBtn.setAttribute('aria-label', 'Switch to light theme');
            toggleBtn.title = 'Switch to light theme';
        } else {
            icon.className = 'fas fa-sun';
            toggleBtn.setAttribute('aria-label', 'Switch to dark theme');
            toggleBtn.title = 'Switch to dark theme';
        }
    },
    
    setupSystemThemeListener: function() {
        // Listen for system theme changes
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
            mediaQuery.addEventListener('change', (e) => {
                // Only change if user hasn't manually set a theme
                if (!this.getThemeFromCookie()) {
                    const newTheme = e.matches ? 'light' : 'dark';
                    this.applyTheme(newTheme);
                }
            });
        }
    }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
    ThemeManager.init();
}

// Make ThemeManager globally available
window.ThemeManager = ThemeManager;
console.log('ThemeManager loaded successfully');