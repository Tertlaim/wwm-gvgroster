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

// ---- Broadcast (Discord / GameVox webhooks) ----
// Config autosaves on change (URL input, enable toggle) — no Save button.
// GameVox is manual-push by nature (create-only webhooks), so no mode toggle:
// Push now is the only delivery path until Discord arrives with edit-in-place.
function setupBroadcastTools() {
    const pushBtn = document.getElementById('broadcastPushBtn');
    const gvEnabled = document.getElementById('broadcastGamevoxEnabled');
    const gvUrl = document.getElementById('broadcastGamevoxUrl');
    const gvClear = document.getElementById('broadcastGamevoxClear');
    const gvState = document.getElementById('broadcastGamevoxState');
    const gvStatus = document.getElementById('broadcastGamevoxStatus');
    const headStatus = document.getElementById('broadcastHeadStatus');
    if (!pushBtn || !gvEnabled || !gvUrl || !gvStatus) return;

    let saveChain = Promise.resolve();
    let saveTimer = null;
    let breakerActive = false;

    // One field accepts several channel URLs separated by spaces/commas.
    function parseWebhookInput() {
        return gvUrl.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    }

    // Single source of truth for both the ON/OFF caption and the collapsed
    // header chip, so they can never drift apart.
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

    function setGvStatus(text, savedFlash) {
        gvStatus.textContent = '';
        const i = document.createElement('i');
        i.className = savedFlash ? 'fas fa-circle-check' : 'fas fa-info-circle';
        gvStatus.appendChild(i);
        gvStatus.appendChild(document.createTextNode(' ' + text));
        gvStatus.classList.toggle('status-saved', !!savedFlash);
    }

    async function refreshBroadcastConfig() {
        try {
            const r = await fetch('/api/broadcast/config', { headers: getAuthHeader() });
            if (!r.ok) return;
            const cfg = await r.json();
            if (!cfg || !cfg.targets || !cfg.targets.gamevox) return;
            const t = cfg.targets.gamevox;
            gvEnabled.checked = !!t.enabled;
            setStateText();
            gvUrl.value = '';
            const masks = t.webhooksMasked && t.webhooksMasked.length ? t.webhooksMasked : (t.hasWebhook ? [t.webhookMasked] : []);
            gvUrl.placeholder = masks.length
                ? 'Saved: ' + masks.join('  ·  ') + ' — paste to replace'
                : 'Paste webhook URL (several URLs = several channels)';
            let statusText = masks.length
                ? masks.length + ' channel' + (masks.length > 1 ? 's' : '') + ' attached'
                : 'Not configured';
            if (masks.length && t.mode === 'manual') statusText += ' · manual pushes only';
            if (masks.length && t.mode === 'auto' && (t.satMessageId || t.sunMessageId)) statusText += ' · daily message active';
            breakerActive = !!(t.status && t.status.breakerActive);
            if (breakerActive) statusText += ' · auto-push paused (repeated failures)';
            setGvStatus(statusText);
            setStateText();
        } catch (e) { /* panel stays in default state */ }
    }

    // Serialized autosave. Non-admins get their control reverted from server
    // state; failures revert too, so the UI never lies about what is stored.
    function doSave() {
        if (!AuthModule.isAdmin()) {
            showToast('Only admins can change broadcast settings.', 'error', 3000);
            refreshBroadcastConfig();
            return;
        }
        const enabled = !!gvEnabled.checked;
        const urls = parseWebhookInput();
        if (urls.length > 5) {
            showToast('Max 5 GameVox webhooks per target', 'error', 3000);
            return;
        }
        const body = { targets: { gamevox: { enabled } } };
        if (urls.length) {
            for (const u of urls) {
                if (!/^https:\/\//.test(u)) {
                    showToast('GameVox webhook URLs must start with https://', 'error', 3000);
                    return;
                }
            }
            body.targets.gamevox.webhooks = urls;
        }
        saveChain = saveChain.then(async function() {
            try {
                const r = await fetch('/api/broadcast/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                    body: JSON.stringify(body)
                });
                const result = await r.json();
                if (result.success) {
                    // Sticky summary of what the server now holds (masked
                    // URLs — the full secrets never return to the browser).
                    const t = result.targets && result.targets.gamevox;
                    const masks = t && t.webhooksMasked ? t.webhooksMasked : [];
                    if (masks.length) {
                        setGvStatus('Attached ' + masks.length + ' channel' + (masks.length > 1 ? 's' : '') +
                            ': ' + masks.join('  ·  ') +
                            ' · ' + (t.enabled ? 'ON' : 'OFF') + ' · manual pushes', true);
                        gvUrl.value = '';
                        gvUrl.placeholder = 'Saved: ' + masks.join('  ·  ') + ' — paste to replace';
                    } else {
                        setGvStatus('Saved automatically', true);
                    }
                } else {
                    showToast(result.error || 'Failed to save broadcast settings', 'error', 4000);
                    refreshBroadcastConfig();
                }
            } catch (e) {
                showToast('Error saving broadcast settings', 'error', 3000);
                refreshBroadcastConfig();
            }
        });
    }

    // Debounced on typing; immediate on blur/paste-commit and toggle changes.
    function requestSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(doSave, 600);
    }
    // Enter = "attach now": skip the debounce so the summary appears at once.
    gvUrl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(saveTimer);
            doSave();
            gvUrl.blur();
        }
    });
    gvEnabled.addEventListener('change', function() {
        setStateText();
        requestSave();
    });
    gvUrl.addEventListener('input', requestSave);
    gvUrl.addEventListener('change', requestSave);

    // ✕ = detach every stored GameVox webhook for this target.
    if (gvClear) {
        gvClear.addEventListener('click', function() {
            if (!AuthModule.isAdmin()) {
                showToast('Only admins can change broadcast settings.', 'error', 3000);
                return;
            }
            clearTimeout(saveTimer);
            saveChain = saveChain.then(async function() {
                try {
                    const r = await fetch('/api/broadcast/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                        body: JSON.stringify({ targets: { gamevox: { enabled: !!gvEnabled.checked, webhooks: [] } } })
                    });
                    const result = await r.json();
                    if (result.success) {
                        gvUrl.value = '';
                        gvUrl.placeholder = 'Paste webhook URL (several URLs = several channels)';
                        setGvStatus('Webhook removed · Not configured');
                        setStateText();
                        showToast('GameVox webhook removed', 'success', 2500);
                    } else {
                        showToast(result.error || 'Failed to remove webhooks', 'error', 4000);
                    }
                } catch (e) {
                    showToast('Error removing webhooks', 'error', 3000);
                }
            });
        });
    }

    let pushCooldownUntil = 0;
    let pushTimer = null;
    function startPushCooldown(seconds) {
        pushCooldownUntil = Date.now() + seconds * 1000;
        pushBtn.disabled = true;
        clearInterval(pushTimer);
        const label = pushBtn.innerHTML;
        pushTimer = setInterval(function() {
            const remaining = Math.ceil((pushCooldownUntil - Date.now()) / 1000);
            if (remaining <= 0) {
                clearInterval(pushTimer);
                pushBtn.innerHTML = label;
                pushBtn.disabled = !AuthModule.isMod();
                return;
            }
            pushBtn.textContent = 'Wait ' + remaining + 's';
        }, 500);
    }

    pushBtn.addEventListener('click', async function() {
        if (!AuthModule.isMod()) {
            showToast('Only moderators and admins can push.', 'error', 3000);
            return;
        }
        if (Date.now() < pushCooldownUntil) return;
        try {
            pushBtn.disabled = true;
            const r = await fetch('/api/broadcast/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: '{}'
            });
            const result = await r.json();
            startPushCooldown(30);
            if (!result.success) {
                showToast(result.error || 'Push failed', 'error', 3000);
                return;
            }
            const results = result.results || {};
            const DAY_NAMES = { sat: 'Saturday', sun: 'Sunday' };
            const lines = Object.keys(results).filter(function(k) {
                return k === 'gamevox'; // only rendered target
            }).map(function(k) {
                const res = results[k];
                if (res && res.cooldown) return k + ': cooldown (' + res.retryAfterSec + 's left)';
                if (res && res.skipped) return k + ': not configured';
                if (res && res.ok) return k + ': pushed';
                // Surface the real reason GameVox rejected/failed, per day.
                const errs = ((res && res.days) || [])
                    .filter(function(d) { return d && d.ok === false && d.error; })
                    .map(function(d) { return (DAY_NAMES[d.day] || d.day) + ': ' + d.error; });
                return k + ': failed' + (errs.length ? ' (' + errs.join('; ') + ')' : '');
            });
            const allOk = lines.length > 0 && lines.every(function(l) { return l.indexOf(': pushed') !== -1; });
            showToast(lines.join(' · '), allOk ? 'success' : 'error', allOk ? 2500 : 8000);
        } catch (e) {
            startPushCooldown(5);
            showToast('Push failed (network error)', 'error', 3000);
        }
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
