// ============================================================
// ADMIN PANEL - Admin tools, staff controls, change password
// (Phase 11.2)
// ============================================================

function setupAdminTools() {
    const clearToGuildBtn = document.getElementById('clearToGuildBtn');
    const clearToReserveBtn = document.getElementById('clearToReserveBtn');
    const downloadBackupBtn = document.getElementById('downloadBackupBtn');
    const publicRegToggle = document.getElementById('publicRegToggle');
    
    // Public Registration toggle
    if (publicRegToggle) {
        // ON/OFF caption next to the slider stays in sync with the checkbox
        function syncPublicRegState() {
            const el = document.getElementById('publicRegState');
            if (!el) return;
            const on = !!publicRegToggle.checked;
            el.textContent = on ? 'ON' : 'OFF';
            el.className = 'toggle-state ' + (on ? 'on' : 'off');
        }
        fetch('/api/auth/settings', { headers: getAuthHeader() })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                publicRegToggle.checked = data.publicRegistration !== false;
                syncPublicRegState();
            })
            .catch(function() {});

        publicRegToggle.addEventListener('change', async function() {
            if (!AuthModule.isMod()) {
                publicRegToggle.checked = !publicRegToggle.checked;
                syncPublicRegState();
                showToast('Only moderators can change this setting.', 'error', 3000);
                return;
            }
            const enabled = publicRegToggle.checked;
            try {
                const response = await fetch('/api/auth/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                    body: JSON.stringify({ publicRegistration: enabled })
                });
                const result = await response.json();
                if (result.success) {
                    showToast(enabled ? 'Public registration enabled' : 'Public registration disabled', 'success', 3000);
                    syncPublicRegState();
                    // Update Register panel immediately
                    if (typeof checkPublicRegistration === 'function') checkPublicRegistration();
                } else {
                    publicRegToggle.checked = !publicRegToggle.checked;
                    syncPublicRegState();
                    showToast(result.error || 'Failed to update setting', 'error', 3000);
                }
            } catch (error) {
                publicRegToggle.checked = !publicRegToggle.checked;
                syncPublicRegState();
                showToast('Error updating setting', 'error', 3000);
            }
        });
    }

    // Accordion sections: closed by default, chevron + aria-expanded synced.
    [['groupManagementToggle', 'groupManagementContent', 'groupManagementIcon'],
     ['broadcastToggle', 'broadcastContent', 'broadcastIcon'],
     ['dataToolsToggle', 'dataToolsContent', 'dataToolsIcon']].forEach(function(ids) {
        const head = document.getElementById(ids[0]);
        const content = document.getElementById(ids[1]);
        const icon = document.getElementById(ids[2]);
        if (!head || !content) return;
        head.addEventListener('click', function(e) {
            if (e.target.closest('.tip')) return; // tooltip clicks don't toggle
            const show = content.style.display === 'none';
            content.style.display = show ? 'block' : 'none';
            head.setAttribute('aria-expanded', show ? 'true' : 'false');
            if (icon) icon.className = show ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
        });
    }
    );
    
    if (downloadBackupBtn) {
        downloadBackupBtn.addEventListener('click', function() {
            if (!AuthModule.isAdmin()) {
                showToast('Only admins can download a backup.', 'error', 3000);
                return;
            }
            downloadBackup();
        });
    }
    
    if (clearToGuildBtn) {
        clearToGuildBtn.addEventListener('click', function() {
            if (!AuthModule.isAdmin()) {
                showAlert('Only admin can use this action.', 'Error', '❌');
                return;
            }
            
            showConfirmation('Move all members from groups and reserves to Guild Members for both Saturday and Sunday?', function() {
                // Phase 13: guildMembers is a flat array
                if (!Array.isArray(App.state.guildMembers)) App.state.guildMembers = [];
                const gm = App.state.guildMembers;
                const days = ['sat', 'sun'];
                const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
                
                days.forEach(function(day) {
                    const allPlayers = [];
                    groupKeys.forEach(function(key) {
                        if (App.state.groups[day] && App.state.groups[day][key]) {
                            const clearedIds = App.state.groups[day][key].players.map(function(p) { return p && p.id; }).filter(Boolean);
                            App.state.groups[day][key].players.forEach(function(p) {
                                allPlayers.push(p);
                            });
                            App.state.groups[day][key].players = [];
                            if (clearedIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                                trackPlayerRemovals('group', day, clearedIds, key);
                            }
                        }
                    });
                    
                    if (App.state.reserves[day]) {
                        const clearedReserveIds = App.state.reserves[day].map(function(p) { return p && p.id; }).filter(Boolean);
                        App.state.reserves[day].forEach(function(p) {
                            allPlayers.push(p);
                        });
                        App.state.reserves[day] = [];
                        if (clearedReserveIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                            trackPlayerRemovals('reserve', day, clearedReserveIds);
                        }
                    }
                    
                    allPlayers.forEach(function(p) {
                        const exists = gm.some(function(g) { return g.name === p.name; });
                        if (!exists) {
                            gm.push(p);
                        }
                    });
                });
                
                updateLastUpdate();
                render();
                showAlert('All names moved to Guild Members for both days.', 'Success', '✅');
            });
        });
    }
    
if (clearToReserveBtn) {
    clearToReserveBtn.addEventListener('click', function() {
        if (!AuthModule.isMod()) {
            showAlert('Only moderators and admins can use this action.', 'Error', '❌');
            return;
        }
        
        const day = window.currentDay;
        const dayName = day === 'sat' ? 'Saturday' : 'Sunday';
        
        showConfirmation('Move all members from groups to Reserves for ' + dayName + '?', function() {
            const g = getGroups();
            const r = getReserves();
            const groupKeys = Object.keys(g);
            const allPlayers = [];
            
            // Collect all players from groups
            groupKeys.forEach(function(key) {
                if (g[key] && g[key].players) {
                    const clearedIds = [];
                    g[key].players.forEach(function(p) {
                        if (!p.id) {
                            p.id = generatePlayerId();
                        }
                        clearedIds.push(p.id);
                        allPlayers.push(p);
                    });
                    g[key].players = [];
                    if (clearedIds.length > 0 && typeof trackPlayerRemovals === 'function') {
                        trackPlayerRemovals('group', day, clearedIds, key);
                    }
                }
            });
            
            // Add all players to reserves
            allPlayers.forEach(function(p) {
                r.push(p);
            });
            
            // ---- SAVE BACK TO GLOBAL STATE ----
            App.state.groups[day] = g;
            App.state.reserves[day] = r;
            
            // ---- LOG TO HISTORY ----
            if (typeof History !== 'undefined' && History.add) {
                History.add('bulk', {
                    details: 'Moved ' + allPlayers.length + ' players to Reserves for ' + dayName,
                    day: day,
                    to: 'reserve'
                });
            }
            
            updateLastUpdate();
            render();
            
            setTimeout(function() {
                if (typeof attachDragListeners === 'function') {
                    attachDragListeners();
                }
            }, 100);
            
            showAlert('All names moved to Reserves for ' + dayName + '.', 'Success', '✅');
        });
    });
}
}

// ---- Admin Controls (roles are data-driven; SuperAdmin manages admins) ----
function setupAdminControls() {
    const approveModBtn = document.getElementById('approveModBtn');
    const approveAdminBtn = document.getElementById('approveAdminBtn');
    const resetModBtn = document.getElementById('resetModBtn');
    const demoteModBtn = document.getElementById('demoteModBtn');
    const modPlayerSelect = document.getElementById('modPlayerSelect');
    const resetModSelect = document.getElementById('resetModSelect');
    const demoteModSelect = document.getElementById('demoteModSelect');

    // Selecting a player enables the New Mod / New Admin buttons (the select is
    // rebuilt on every render, so the listener is attached here once).
    if (modPlayerSelect) {
        modPlayerSelect.addEventListener('change', function() {
            if (typeof updateApproveButton === 'function') updateApproveButton();
        });
    }

    // Shared add-staff flow: role is 'mod' (New Mod) or 'admin' (New Admin, SuperAdmin only)
    function addStaff(name, role) {
        return fetch('/api/moderators/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ username: name, role: role })
        }).then(function(r) { return r.json(); });
    }

    if (approveModBtn) {
        approveModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can approve moderators.', 'Error', '❌');
                return; 
            }
            const name = modPlayerSelect.value;
            if (!name) { 
                showAlert('Select a player from the list.', 'Error', '❌');
                return; 
            }
            
            try {
                const result = await addStaff(name, 'mod');
                if (result.success) {
                    showAlert(`Moderator ${name} added. Password: ${result.password}`, 'Success', '✅');
                    await loadModerators();
                    updateLastUpdate();
                    render();
                    saveState();
                } else {
                    showAlert(result.error || 'Failed to add moderator.', 'Error', '❌');
                }
            } catch (error) {
                console.error('Error adding moderator:', error);
                showAlert('Error adding moderator.', 'Error', '❌');
            }
        });
    }

    if (approveAdminBtn) {
        approveAdminBtn.addEventListener('click', async function() {
            if (!AuthModule.isSuperAdmin()) { 
                showAlert('Only SuperAdmin can add admins.', 'Error', '❌');
                return; 
            }
            const name = modPlayerSelect.value;
            if (!name) { 
                showAlert('Select a player from the list.', 'Error', '❌');
                return; 
            }
            
            try {
                const result = await addStaff(name, 'admin');
                if (result.success) {
                    showAlert(`Admin ${name} added. Password: ${result.password}`, 'Success', '✅');
                    await loadModerators();
                    updateLastUpdate();
                    render();
                    saveState();
                } else {
                    showAlert(result.error || 'Failed to add admin.', 'Error', '❌');
                }
            } catch (error) {
                console.error('Error adding admin:', error);
                showAlert('Error adding admin.', 'Error', '❌');
            }
        });
    }

    if (resetModBtn) {
        resetModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can reset passwords.', 'Error', '❌');
                return; 
            }
            const name = resetModSelect.value;
            if (!name) { 
                showAlert('Select a staff member.', 'Error', '❌');
                return; 
            }
            
            showConfirmation(`Reset password for "${name}" to default?`, async function() {
                try {
                    const response = await fetch('/api/moderators/reset-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ username: name })
                    });
                    const result = await response.json();
                    if (result.success) {
                        await loadState();
                        await loadModerators();
                        updateLastUpdate();
                        render();
                        saveState();
                        showAlert(`Password for ${name} has been reset to ${result.newPassword}`, 'Success', '✅');
                    } else {
                        showAlert('Failed to reset password: ' + (result.error || 'Unknown error'), 'Error', '❌');
                    }
                } catch (error) {
                    console.error('Error resetting password:', error);
                    showAlert('Error resetting password.', 'Error', '❌');
                }
            });
        });
    }

    if (demoteModBtn) {
        demoteModBtn.addEventListener('click', async function() {
            if (!AuthModule.isAdmin()) { 
                showAlert('Only admin can demote staff.', 'Error', '❌');
                return; 
            }
            const name = demoteModSelect.value;
            if (!name) { 
                showAlert('Select a staff member to demote.', 'Error', '❌');
                return; 
            }
            const targetRole = App.state.moderators && App.state.moderators[name];
            // Demoting an admin is SuperAdmin-only; the server enforces this too.
            if (targetRole === 'admin' && !AuthModule.isSuperAdmin()) {
                showAlert('Only SuperAdmin can demote admins.', 'Error', '❌');
                return;
            }
            
            showConfirmation(`Demote "${name}" from staff to normal member?`, async function() {
                try {
                    const response = await fetch('/api/moderators/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ username: name })
                    });
                    const result = await response.json();
                    if (result.success) {
                        await loadState();
                        await loadModerators();
                        updateLastUpdate();
                        render();
                        saveState();
                        showAlert(`${name} has been demoted.`, 'Success', '✅');
                    } else {
                        showAlert('Failed to demote: ' + (result.error || 'Unknown error'), 'Error', '❌');
                    }
                } catch (error) {
                    console.error('Error demoting:', error);
                    showAlert('Error demoting staff.', 'Error', '❌');
                }
            });
        });
    }
}

// ---- Broadcast (GameVox bot setup + /gvg) ----
// Publishing happens exclusively through the /gvg slash command in GameVox
// chat (instant rendering). This panel is the bot's control room: connect
// token + public key, copy the interactions endpoint URL, run a live
// connectivity test.
function setupBroadcastTools() {
    const previewBtn = document.getElementById('broadcastPreviewBtn');
    const gvEnabled = document.getElementById('broadcastGamevoxEnabled');
    const gvState = document.getElementById('broadcastGamevoxState');
    const headStatus = document.getElementById('broadcastHeadStatus');
    const botToken = document.getElementById('broadcastBotToken');
    const publicKey = document.getElementById('broadcastPublicKey');
    const endpointUrl = document.getElementById('broadcastEndpointUrl');
    const endpointCopy = document.getElementById('broadcastEndpointCopy');
    const testConnBtn = document.getElementById('broadcastTestConnBtn');
    const setupStatus = document.getElementById('broadcastSetupStatus');
    const botStatus = document.getElementById('broadcastBotStatus');
    const setupGuideBtn = document.getElementById('broadcastSetupGuideBtn');
    if (!previewBtn || !gvEnabled || !botToken || !publicKey || !setupStatus) return;

    let saveChain = Promise.resolve();
    let breakerActive = false;

    function setBotStatus(text, savedFlash) {
        botStatus.textContent = '';
        const i = document.createElement('i');
        i.className = savedFlash ? 'fas fa-circle-check' : 'fas fa-info-circle';
        botStatus.appendChild(i);
        botStatus.appendChild(document.createTextNode(' ' + text));
        botStatus.classList.toggle('status-saved', !!savedFlash);
    }

    // Single source of truth for the ON/OFF caption and the collapsed chip.
    function setStateText() {
        const on = !!gvEnabled.checked;
        if (gvState) {
            gvState.textContent = on ? 'ON' : 'OFF';
            gvState.className = 'toggle-state ' + (on ? 'on' : 'off');
        }
        if (headStatus) {
            headStatus.textContent = 'GameVox ' + (on ? 'ON' : 'OFF') +
                (breakerActive ? ' · paused' : '');
        }
    }

    // One POST per config change. fragment fields omitted = unchanged
    // server-side; '' clears. Re-syncs forms + statuses after success.
    function postGamevoxConfig(fragment) {
        if (!AuthModule.isSuperAdmin()) {
            showToast('Only the SuperAdmin can change broadcast settings.', 'error', 3000);
            refreshBroadcastConfig();
            return Promise.resolve(false);
        }
        const body = { targets: { gamevox: Object.assign({ enabled: !!gvEnabled.checked }, fragment) } };
        saveChain = saveChain.then(async function() {
            try {
                const r = await fetch('/api/broadcast/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                    body: JSON.stringify(body)
                });
                const result = await r.json();
                if (!result.success) {
                    showToast(result.error || 'Failed to save broadcast settings', 'error', 4000);
                    refreshBroadcastConfig();
                    return false;
                }
                refreshBroadcastConfig();
                return true;
            } catch (e) {
                showToast('Error saving broadcast settings', 'error', 3000);
                refreshBroadcastConfig();
                return false;
            }
        });
        return saveChain;
    }

    // Toggle autosaves immediately; text fields use explicit Enter/blur
    // commits so half-typed secrets are never POSTed mid-edit. The field
    // always shows what is saved; Esc reverts an uncommitted edit.
    function makeCommitField(inputEl, toFragment) {
        let baseline = '';
        async function commit() {
            let parsed;
            try {
                parsed = toFragment(inputEl.value.trim());
            } catch (err) {
                showToast(err.message, 'error', 4000);
                return;
            }
            if (parsed.canonical === baseline) return;
            const ok = await postGamevoxConfig(parsed.payload);
            if (ok) {
                baseline = parsed.canonical;
                inputEl.value = baseline;
            }
        }
        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') e.preventDefault(), commit();
            else if (e.key === 'Escape') inputEl.value = baseline;
        });
        inputEl.addEventListener('blur', function() { commit(); });
        return { setBaseline: function(v) { baseline = v || ''; inputEl.value = v || ''; } };
    }

    const tokenField = makeCommitField(botToken, function(raw) {
        if (raw === '') return { payload: { botToken: '' }, canonical: '' };
        if (!/^GVB\.[\w.-]{16,}$/.test(raw)) {
            throw new Error('Bot token must look like GVB.… (from developers.gamevox.com)');
        }
        return { payload: { botToken: raw }, canonical: raw };
    });

    const keyField = makeCommitField(publicKey, function(raw) {
        if (raw === '') return { payload: { publicKey: '' }, canonical: '' };
        if (!/^[0-9a-f]{64}$/i.test(raw)) {
            throw new Error('Public key must be 64 hex characters (General Information tab)');
        }
        return { payload: { publicKey: raw }, canonical: raw.toLowerCase() };
    });

    // Endpoint URL mirrors wherever this page is served from - correct for
    // both localhost testing and the Render deployment.
    function currentEndpointUrl() {
        return window.location.origin + '/api/gamevox/interactions';
    }
    endpointUrl.value = currentEndpointUrl();
    endpointCopy.addEventListener('click', function() {
        const url = endpointUrl.value;
        const done = () => showToast('Endpoint URL copied', 'success', 2000);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
        } else {
            fallbackCopy(url, done);
        }
    });
    function fallbackCopy(text, done) {
        endpointUrl.removeAttribute('readonly');
        endpointUrl.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
        endpointUrl.setAttribute('readonly', '');
        window.getSelection().removeAllRanges();
    }

    // ---- Setup checklist rendering ----
    function checklistRow(ok, text) {
        const row = document.createElement('div');
        row.className = 'setup-check-row';
        const i = document.createElement('i');
        i.className = ok ? 'fas fa-circle-check' : 'fas fa-circle-xmark';
        row.appendChild(i);
        row.appendChild(document.createTextNode(' ' + text));
        return row;
    }

    function renderSetupStatus(out) {
        setupStatus.innerHTML = '';
        setupStatus.style.display = '';
        setupStatus.appendChild(checklistRow(out.tokenOk,
            out.tokenOk
                ? 'Token accepted by GameVox' + (out.botUser ? ' (' + out.botUser.username + ')' : '')
                : 'Token invalid or missing'));
        if (out.tokenOk) {
            setupStatus.appendChild(checklistRow(
                out.guilds.length > 0,
                out.guilds.length
                    ? 'Installed on: ' + out.guilds.map(g => g.name).join(', ')
                    : 'Not installed on any server yet (Setup guide, step 5)'));
        }
        setupStatus.appendChild(checklistRow(out.publicKeySet,
            out.publicKeySet ? 'Public key stored' : 'Public key missing (step 2)'));
        for (const err of out.errors || []) {
            const row = checklistRow(false, err);
            setupStatus.appendChild(row);
        }
    }

    async function runTestConnection() {
        if (!AuthModule.isSuperAdmin()) {
            showToast('Only the SuperAdmin can test the bot connection.', 'error', 3000);
            return;
        }
        testConnBtn.disabled = true;
        setupStatus.innerHTML = '';
        setupStatus.style.display = '';
        setupStatus.appendChild(checklistRow(true, 'Contacting GameVox…'));
        try {
            const r = await fetch('/api/gamevox/setup/status', { headers: getAuthHeader() });
            const result = await r.json();
            if (r.status === 403) {
                showToast('Only the SuperAdmin can test the bot connection.', 'error', 3000);
                setupStatus.style.display = 'none';
                return;
            }
            if (!result.success) {
                showToast(result.error || 'Test failed', 'error', 3000);
                setupStatus.style.display = 'none';
                return;
            }
            renderSetupStatus(result);
        } catch (e) {
            showToast('Test failed (network error)', 'error', 3000);
        } finally {
            testConnBtn.disabled = false;
        }
    }

    testConnBtn.addEventListener('click', runTestConnection);

    // ---- Preview modal (moderator+) ----
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function markupToHtml(text) {
        return escHtml(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    }
    const DAY_LABELS_LOCAL = { sat: 'Saturday', sun: 'Sunday' };
    function openBroadcastPreview(days) {
        const body = document.getElementById('broadcastPreviewBody');
        body.innerHTML = '';
        for (const day of ['sat', 'sun']) {
            const bubble = document.createElement('div');
            bubble.className = 'broadcast-preview-bubble';
            const label = document.createElement('div');
            label.className = 'broadcast-preview-day';
            label.textContent = days[day] === null || days[day] === undefined
                ? DAY_LABELS_LOCAL[day] + ' — nothing to publish'
                : DAY_LABELS_LOCAL[day];
            bubble.appendChild(label);
            if (days[day]) {
                const content = document.createElement('div');
                content.className = 'broadcast-preview-content';
                content.innerHTML = markupToHtml(days[day]);
                bubble.appendChild(content);
            }
            body.appendChild(bubble);
        }
        document.getElementById('broadcastPreviewModal').classList.add('active');
    }
    previewBtn.addEventListener('click', async function() {
        if (!AuthModule.isMod()) {
            showToast('Only moderators and admins can preview.', 'error', 3000);
            return;
        }
        try {
            previewBtn.disabled = true;
            const r = await fetch('/api/broadcast/preview', { headers: getAuthHeader() });
            const result = await r.json();
            if (result.success) openBroadcastPreview(result.days || {});
            else showToast(result.error || 'Preview failed', 'error', 3000);
        } catch (e) {
            showToast('Preview failed (network error)', 'error', 3000);
        } finally {
            previewBtn.disabled = false;
        }
    });
    const previewCloseBtn = document.getElementById('broadcastPreviewCloseBtn');
    if (previewCloseBtn) {
        previewCloseBtn.addEventListener('click', function() {
            document.getElementById('broadcastPreviewModal').classList.remove('active');
        });
    }

    // ---- Setup guide modal ----
    const setupModal = document.getElementById('broadcastSetupModal');
    if (setupGuideBtn && setupModal) {
        setupGuideBtn.addEventListener('click', function() {
            setupModal.classList.add('active');
        });
        const closeBtn = document.getElementById('broadcastSetupCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                setupModal.classList.remove('active');
            });
        }
    }

    async function refreshBroadcastConfig() {
        try {
            const r = await fetch('/api/broadcast/config', { headers: getAuthHeader() });
            if (!r.ok) return;
            const cfg = await r.json();
            if (!cfg || !cfg.targets || !cfg.targets.gamevox) return;
            const t = cfg.targets.gamevox;
            gvEnabled.checked = !!t.enabled;

            const botMask = t.botTokenMasked || '';
            let botText;
            if (!t.hasBotToken) {
                botText = 'Bot not configured — paste the token above to enable publishing';
            } else {
                botText = 'Bot connected (' + botMask + ') — /gvg is live in GameVox chat';
            }
            breakerActive = !!(t.status && t.status.breakerActive);
            setBotStatus(botText);
            setStateText();
            tokenField.setBaseline(typeof t.botToken === 'string' ? t.botToken : '');
            keyField.setBaseline(typeof t.publicKey === 'string' ? t.publicKey : '');
        } catch (e) { /* panel stays in default state */ }
    }

    gvEnabled.addEventListener('change', function() {
        setStateText();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => postGamevoxConfig({ enabled: !!gvEnabled.checked }), 600);
    });

    refreshBroadcastConfig();
}

// ---- Change Password ----
function setupChangePassword() {
    const changePwCloseBtn = document.getElementById('changePwCloseBtn');
    const changePwModal = document.getElementById('changePwModal');
    const changePwForm = document.getElementById('changePwForm');
    const changePwError = document.getElementById('changePwError');
    const changePwSuccess = document.getElementById('changePwSuccess');
    const newPwInput = document.getElementById('newPwInput');
    const confirmPwInput = document.getElementById('confirmPwInput');
    
    if (changePwCloseBtn) {
        changePwCloseBtn.addEventListener('click', () => { changePwModal.classList.remove('active'); });
    }
    if (changePwModal) {
        changePwModal.addEventListener('click', (e) => { 
            if (e.target === changePwModal) changePwModal.classList.remove('active'); 
        });
    }

    if (changePwForm) {
        changePwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPwInput = document.getElementById('oldPwInput');
            const oldPw = oldPwInput ? oldPwInput.value : '';
            const newPw = newPwInput.value.trim();
            const confirm = confirmPwInput.value.trim();
            if (changePwError) changePwError.textContent = '';
            if (changePwSuccess) changePwSuccess.textContent = '';
            
            if (!oldPw) { 
                if (changePwError) changePwError.textContent = 'Please enter your current password.'; 
                return; 
            }
            if (newPw.length < 4) { 
                if (changePwError) changePwError.textContent = 'Password must be at least 4 characters.'; 
                return; 
            }
            if (newPw !== confirm) { 
                if (changePwError) changePwError.textContent = 'Passwords do not match.'; 
                return; 
            }
            
            // Use AuthModule.currentUser (window.currentUser is never set)
            const current = AuthModule.currentUser;
            if (current && AuthModule.isMod() && current.name) {
                try {
                    const response = await fetch('/api/moderators/change-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ 
                            username: current.name, 
                            oldPassword: oldPw,
                            newPassword: newPw 
                        })
                    });
                    const result = await response.json();
                    if (result.success) {
                        if (changePwSuccess) changePwSuccess.textContent = 'Password updated!';
                        if (oldPwInput) oldPwInput.value = '';
                        newPwInput.value = '';
                        confirmPwInput.value = '';
                        setTimeout(() => { changePwModal.classList.remove('active'); }, 800);
                    } else {
                        if (changePwError) changePwError.textContent = result.error || 'Failed to update password.';
                    }
                } catch (error) {
                    console.error('Error changing password:', error);
                    if (changePwError) changePwError.textContent = 'Error updating password.';
                }
            } else {
                if (changePwError) changePwError.textContent = 'Only moderators can change their password.';
            }
        });
    }
}
