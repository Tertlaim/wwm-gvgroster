// ============================================================
//  API - Communication layer for server
// ============================================================

const API_BASE = '/api';

// ---- Auth token helper (Phase 4.4) ----
function getAuthHeader() {
    const token = AuthModule && AuthModule.getToken ? AuthModule.getToken() : null;
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

// Load data from server
async function loadDataFromServer() {
    try {
        console.log('Loading data from server...');
        const response = await fetch(`${API_BASE}/data`);
        if (!response.ok) throw new Error('Failed to load data');
        const data = await response.json();
        console.log('Data loaded successfully');
        return data;
    } catch (error) {
        console.error('Error loading data from server:', error);
        return null;
    }
}

// Save data to server
async function saveDataToServer(data) {
    try {
        const headers = { 'Content-Type': 'application/json', ...getAuthHeader() };
        const response = await fetch(`${API_BASE}/data`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to save data');
        return await response.json();
    } catch (error) {
        console.error('Error saving data to server:', error);
        return null;
    }
}

// Public self-registration (no auth needed)
// Returns the full updated data set so the client can re-sync immediately.
async function registerPlayer(name, playerClass, days) {
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, class: playerClass, days })
        });
        return await response.json();
    } catch (error) {
        console.error('Error registering player:', error);
        return { success: false, error: 'Network error' };
    }
}

// Login
async function loginUser(username, password) {
    console.log('loginUser called with:', username);
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        console.log('Login response status:', response.status);
        const result = await response.json();
        console.log('Login result:', result);
        return result;
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, error: 'Network error' };
    }
}

// Update moderator password
async function updateModPassword(username, oldPassword, newPassword) {
    try {
        const response = await fetch(`${API_BASE}/moderators/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, oldPassword, newPassword })
        });
        return await response.json();
    } catch (error) {
        console.error('Error updating password:', error);
        return { success: false };
    }
}

// Download backup (Phase 8.4)
// window.open cannot send the session token, so the endpoint 401'd for
// authed users. Fetch with the auth header, then save the blob locally.
async function downloadBackup() {
    try {
        const response = await fetch(`${API_BASE}/backup`, {
            headers: getAuthHeader()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Backup failed (HTTP ${response.status})`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `guild-war-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (typeof showToast === 'function') {
            showToast('Backup downloaded', 'success', 1500);
        }
    } catch (error) {
        console.error('Download backup error:', error);
        if (typeof showToast === 'function') {
            showToast(error.message || 'Backup download failed. Are you logged in?', 'error', 3000);
        }
    }
}

// Health check
async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        return await response.json();
    } catch {
        return { status: 'error' };
    }
}