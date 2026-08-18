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

// Download backup
function downloadBackup() {
    window.open(`${API_BASE}/backup`, '_blank');
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