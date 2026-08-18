// ============================================================
//  AUTH MODULE - Consolidated authentication management
// ============================================================

const AuthModule = {
    currentUser: null,
    
    init: function() {
        try {
            const saved = localStorage.getItem('gw_user');
            if (saved) {
                this.currentUser = JSON.parse(saved);
            }
            // Validate session on server if token exists
            if (this.currentUser && this.currentUser.token) {
                this.validateSession(this.currentUser.token);
            }
        } catch (e) {
            this.currentUser = null;
        }
        return this.currentUser;
    },
    
    getToken: function() {
        return this.currentUser && this.currentUser.token ? this.currentUser.token : null;
    },
    
    // Phase 4.4: Validate session against server
    validateSession: async function(token) {
        try {
            const response = await fetch('/api/session', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (response.ok) {
                const session = await response.json();
                if (this.currentUser) {
                    this.currentUser.name = session.name;
                    this.currentUser.role = session.role;
                    this.saveAuth();
                }
            } else {
                this.logout();
            }
        } catch (e) {
            // Server unreachable — keep local session for now
        }
    },
    
    saveAuth: function() {
        try {
            localStorage.setItem('gw_user', JSON.stringify(this.currentUser));
        } catch (e) {}
    },
    
    // SuperAdmin sits above Admin; admins and superadmins are both "admin" for
    // role checks, and roles come from the server store (never hardcoded).
    isSuperAdmin: function() {
        return this.currentUser && this.currentUser.role === 'superadmin';
    },
    
    isAdmin: function() {
        return this.currentUser && (this.currentUser.role === 'admin' || this.currentUser.role === 'superadmin');
    },
    
    isMod: function() {
        return this.currentUser && (this.currentUser.role === 'admin' || this.currentUser.role === 'superadmin' || this.currentUser.role === 'mod');
    },
    
    // Friendly display label for a stored role
    getRoleLabel: function(role) {
        if (role === 'superadmin') return 'SuperAdmin';
        if (role === 'admin') return 'Admin';
        if (role === 'mod') return 'Moderator';
        return role || '';
    },
    
    isLoggedIn: function() {
        return !!this.currentUser;
    },
    
    getUserName: function() {
        return this.currentUser ? this.currentUser.name : null;
    },
    
    getUserRole: function() {
        return this.currentUser ? this.currentUser.role : null;
    },
    
    login: function(userData) {
        this.currentUser = userData;
        this.saveAuth();
        this.updateUI();
        return this.currentUser;
    },
    
    logout: function() {
        // Invalidate server session
        if (this.currentUser && this.currentUser.token) {
            fetch('/api/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + this.currentUser.token }
            }).catch(() => {});
        }
        this.currentUser = null;
        try {
            localStorage.removeItem('gw_user');
        } catch (e) {}
        this.updateUI();
        return true;
    },
    
    updateUI: function() {
        const isLoggedIn = this.isLoggedIn();
        const isSuperAdmin = this.isSuperAdmin();
        const isAdmin = this.isAdmin();
        const isMod = this.isMod();
        
        const authWidget = document.getElementById('authWidget');
        const userRoleDisplay = document.getElementById('userRoleDisplay');
        
        if (authWidget) {
            if (isLoggedIn) {
                const roleIcon = isSuperAdmin ? 'crown' : isAdmin ? 'shield-alt' : 'user-shield';
                const safeName = typeof esc === 'function' ? esc(this.getUserName() || '') : (this.getUserName() || '');
                const safeRole = typeof esc === 'function' ? esc(this.getRoleLabel(this.getUserRole()) || '') : (this.getRoleLabel(this.getUserRole()) || '');
                authWidget.innerHTML = 
                    '<div class="user-badge-small">' +
                        '<i class="fas fa-' + roleIcon + '"></i> ' +
                        safeName + ' (' + safeRole + ')' +
                        '<button class="logout-btn-small" id="changePwBtn" title="Change password"><i class="fas fa-key"></i></button>' +
                        '<button class="logout-btn-small" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> logout</button>' +
                    '</div>';
                var logoutBtn = document.getElementById('logoutBtn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', function() {
                        AuthModule.logout();
                        if (typeof render === 'function') render();
                        if (typeof saveState === 'function') saveState();
                    });
                }
                var changePwBtn = document.getElementById('changePwBtn');
                if (changePwBtn) {
                    changePwBtn.addEventListener('click', function() {
                        var changePwModal = document.getElementById('changePwModal');
                        if (changePwModal) changePwModal.classList.add('active');
                        var oldPwInput = document.getElementById('oldPwInput');
                        if (oldPwInput) oldPwInput.focus();
                    });
                }
            } else {
                authWidget.innerHTML = 
                    '<button class="login-btn-small" id="loginOpenBtn">' +
                        '<i class="fas fa-sign-in-alt"></i> Mod Login' +
                    '</button>';
                var loginBtn = document.getElementById('loginOpenBtn');
                if (loginBtn) {
                    loginBtn.addEventListener('click', function() {
                        var loginModal = document.getElementById('loginModal');
                        if (loginModal) loginModal.classList.add('active');
                    });
                }
            }
        }
        
        if (userRoleDisplay) {
            if (isLoggedIn) {
                if (isSuperAdmin) {
                    userRoleDisplay.textContent = '👑 You are a SuperAdmin';
                    userRoleDisplay.style.color = '#f5c542';
                } else if (isAdmin) {
                    userRoleDisplay.textContent = '🛡️ You are an Admin';
                    userRoleDisplay.style.color = '#f5c542';
                } else if (isMod) {
                    userRoleDisplay.textContent = '⚔️ You are a Moderator';
                    userRoleDisplay.style.color = '#60a5fa';
                }
            } else {
                userRoleDisplay.textContent = '';
            }
        }
        
        // Update visibility using data attributes
        this.updateVisibility();
        
        // Re-render the Help & Shortcuts panel to match the current role
        if (typeof renderHelpPanel === 'function') {
            renderHelpPanel();
        }
        
        // Update player role dropdown
        var playerRoleSelect = document.getElementById('playerRole');
        if (playerRoleSelect) {
            playerRoleSelect.disabled = !isMod;
            if (!isMod) {
                playerRoleSelect.value = 'Member';
            }
        }
    },
    
    updateVisibility: function() {
        var self = this;
        
        document.querySelectorAll('[data-auth-show]').forEach(function(el) {
            var roles = el.dataset.authShow.split(',');
            var show = roles.some(function(role) {
                if (role === 'all') return self.isLoggedIn();
                if (role === 'admin') return self.isAdmin();
                if (role === 'mod') return self.isMod();
                if (role === 'public') return !self.isLoggedIn();
                return false;
            });
            el.style.display = show ? '' : 'none';
        });
        
        document.querySelectorAll('[data-auth-hide]').forEach(function(el) {
            var roles = el.dataset.authHide.split(',');
            var hide = roles.some(function(role) {
                if (role === 'all') return self.isLoggedIn();
                if (role === 'admin') return self.isAdmin();
                if (role === 'mod') return self.isMod();
                if (role === 'public') return !self.isLoggedIn();
                return false;
            });
            el.style.display = hide ? 'none' : '';
        });
        
        document.querySelectorAll('[data-role-show]').forEach(function(el) {
            var roles = el.dataset.roleShow.split(',');
            var hasAccess = roles.some(function(role) {
                if (role === 'superadmin') return self.isSuperAdmin();
                if (role === 'admin') return self.isAdmin();
                if (role === 'mod') return self.isMod();
                if (role === 'public') return !self.isLoggedIn();
                return false;
            });
            el.style.display = hasAccess ? '' : 'none';
        });
    },
    
    setupLoginListeners: function() {
        var loginForm = document.getElementById('loginForm');
        var loginModal = document.getElementById('loginModal');
        var loginCloseBtn = document.getElementById('loginCloseBtn');
        var loginError = document.getElementById('loginError');
        
        if (loginCloseBtn) {
            loginCloseBtn.addEventListener('click', function() {
                loginModal.classList.remove('active');
                if (loginError) loginError.textContent = '';
            });
        }
        
        if (loginModal) {
            loginModal.addEventListener('click', function(e) {
                if (e.target === loginModal) {
                    loginModal.classList.remove('active');
                    if (loginError) loginError.textContent = '';
                }
            });
        }
        
        if (loginForm) {
            loginForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                var user = document.getElementById('loginUser').value.trim();
                var pass = document.getElementById('loginPass').value.trim();
                if (loginError) loginError.textContent = '';
                
                if (!user || !pass) {
                    if (loginError) loginError.textContent = 'Please enter both username and password.';
                    return;
                }
                
                var result = await loginUser(user, pass);
                if (result && result.success) {
                    // Store session token for server-side auth (Phase 4.4)
                    AuthModule.login({ name: result.name, role: result.role, token: result.token });
                    loginModal.classList.remove('active');
                    if (loginError) loginError.textContent = '';
                    // Load staff list so the admin panel shows roles immediately
                    if (AuthModule.isAdmin() && typeof loadModerators === 'function') {
                        await loadModerators();
                    }
                    if (typeof render === 'function') render();
                    if (typeof saveState === 'function') saveState();
                    // Moderators are prompted to change their default password
                    if (result.role === 'mod') {
                        var changePwModal = document.getElementById('changePwModal');
                        if (changePwModal) changePwModal.classList.add('active');
                        var oldPwInput = document.getElementById('oldPwInput');
                        if (oldPwInput) oldPwInput.focus();
                    }
                } else {
                    if (loginError) loginError.textContent = 'Invalid credentials. Please try again.';
                    document.getElementById('loginPass').value = '';
                    document.getElementById('loginPass').focus();
                }
            });
        }
    }
};

window.AuthModule = AuthModule;
console.log('AuthModule loaded successfully');