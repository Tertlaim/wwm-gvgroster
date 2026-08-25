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

// ---- Broadcast (GameVox bot) ----
// Config autosaves on change (enable toggle, publish mode) — no Save button.
// Text fields (token/channels) use explicit Enter/blur commits so half-typed
// secrets are never POSTed mid-edit.
function setupBroadcastTools() {
    const pushBtn = document.getElementById('broadcastPushBtn');
    const previewBtn = document.getElementById('broadcastPreviewBtn');
    const gvEnabled = document.getElementById('broadcastGamevoxEnabled');
    const gvState = document.getElementById('broadcastGamevoxState');
    const headStatus = document.getElementById('broadcastHeadStatus');
    const botToken = document.getElementById('broadcastBotToken');
    const botChannels = document.getElementById('broadcastBotChannels');
    const botMode = document.getElementById('broadcastBotMode');
    const botStatus = document.getElementById('broadcastBotStatus');
    const setupGuideBtn = document.getElementById('broadcastSetupGuideBtn');
    if (!pushBtn || !gvEnabled || !botToken || !botChannels || !botStatus) return;

    let saveChain = Promise.resolve();
    let saveTimer = null;
    let breakerActive = false;
    let botReady = false; // token + at least one channel configured

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
                (botReady ? ' · bot' : '') +
                (breakerActive ? ' · paused' : '');
        }
    }

    function setBotStatus(text, savedFlash) {
        botStatus.textContent = '';
        const i = document.createElement('i');
        i.className = savedFlash ? 'fas fa-circle-check' : 'fas fa-info-circle';
        botStatus.appendChild(i);
        botStatus.appendChild(document.createTextNode(' ' + text));
        botStatus.classList.toggle('status-saved', !!savedFlash);
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
            const chans = Array.isArray(t.botChannels) ? t.botChannels : [];
            botMode.value = t.botPostMode === 'edit' ? 'edit' : 'fresh';
            let botText;
            if (!t.hasBotToken && chans.length === 0) {
                botText = 'Bot not configured — paste the token above to enable publishing';
            } else if (!t.hasBotToken) {
                botText = chans.length + ' channel' + (chans.length > 1 ? 's' : '') + ' set — paste the bot token (GVB.…)';
            } else if (chans.length === 0) {
                botText = 'Bot token saved (' + botMask + ') — add channel IDs';
            } else {
                botText = 'Bot: ' + chans.length + ' channel' + (chans.length > 1 ? 's' : '') + ' · ' +
                    (t.botPostMode === 'edit' ? 'edits existing message' : 'new message each publish');
            }
            breakerActive = !!(t.status && t.status.breakerActive);
            if (breakerActive) botText += ' · auto-publish paused (repeated failures)';
            setBotStatus(botText);
            botReady = !!t.hasBotToken && chans.length > 0;
            setStateText();
            // Inline forms show what is saved; baselines match so an untouched
            // field never re-posts on blur.
            tokenField.setBaseline(typeof t.botToken === 'string' ? t.botToken : '');
            channelsField.setBaseline(chans.join(', '));
        } catch (e) { /* panel stays in default state */ }
    }

    // Serialized autosave. Non-SuperAdmins get their control reverted from
    // server state; failures revert too, so the UI never lies about what is
    // stored. Config is a SuperAdmin concern; admins/mods only Publish.
    // One POST per config change. fragment fields omitted = unchanged
    // server-side; '' / [] = clear. Re-syncs masks + statuses after success.
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

    // Autosave for the toggle + mode select only. Text fields use explicit
    // Enter/blur commits (makeCommitField below), so half-typed secrets and
    // partial URLs are never POSTed mid-edit.
    function doSave() {
        if (!AuthModule.isSuperAdmin()) {
            showToast('Only the SuperAdmin can change broadcast settings.', 'error', 3000);
            refreshBroadcastConfig();
            return;
        }
        const fragment = { enabled: !!gvEnabled.checked };
        if (botMode.value === 'edit' || botMode.value === 'fresh') {
            fragment.botPostMode = botMode.value;
        }
        postGamevoxConfig(fragment);
    }

    // ---- Inline-commit text fields ----
    // The field always shows what is saved. Edit + Enter (or blur a changed
    // field) saves the edit; delete-to-empty + Enter/blur clears it; Esc
    // reverts to the saved value. toFragment(raw) returns
    // { payload, canonical } - canonical is the exact display form persisted.
    function makeCommitField(inputEl, toFragment) {
        let baseline = ''; // canonical string currently stored ('' = none)

        async function commit() {
            let parsed;
            try {
                parsed = toFragment(inputEl.value.trim());
            } catch (err) {
                showToast(err.message, 'error', 4000);
                return; // keep the typed value so it can be fixed in place
            }
            if (parsed.canonical === baseline) return; // unchanged since last save
            const ok = await postGamevoxConfig(parsed.payload);
            if (ok) {
                baseline = parsed.canonical;
                inputEl.value = baseline; // show exactly what is saved
            }
        }

        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Plain Enter commits (textareas: Shift+Enter makes a line,
                // harmless - whitespace is stripped before saving).
                e.preventDefault();
                commit();
            } else if (e.key === 'Escape') {
                inputEl.value = baseline;
            }
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

    const channelsField = makeCommitField(botChannels, function(raw) {
        if (raw === '') return { payload: { botChannels: [] }, canonical: '' };
        const list = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
        if (list.length > 5) throw new Error('Max 5 GameVox bot channels per target');
        for (const c of list) {
            // Numeric snowflake OR the UUID from Channel Settings - the
            // server translates UUIDs to snowflakes on save.
            if (!/^(?:\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(c)) {
                throw new Error('Invalid channel ID "' + c.slice(0, 20) + '" (numeric ID or the UUID from Channel Settings)');
            }
        }
        return { payload: { botChannels: list }, canonical: list.join(', ') };
    });

    // Debounced autosave only for the toggle + mode select; text fields are
    // explicit-commit (above).
    function requestSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(doSave, 600);
    }
    gvEnabled.addEventListener('change', function() {
        setStateText();
        requestSave();
    });
    botMode.addEventListener('change', requestSave);

    // Setup guide modal (SuperAdmin): full bot/OAuth2 walkthrough with
    // screenshots, replacing inline instruction text in the panel.
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
            showToast('Only moderators and admins can publish.', 'error', 3000);
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
                showToast(result.error || 'Publish failed', 'error', 3000);
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
                if (res && res.ok) return k + ': published';
                // Surface the real reason GameVox rejected/failed, per day.
                const errs = ((res && res.days) || [])
                    .filter(function(d) { return d && d.ok === false && d.error; })
                    .map(function(d) { return (DAY_NAMES[d.day] || d.day) + ': ' + d.error; });
                return k + ': failed' + (errs.length ? ' (' + errs.join('; ') + ')' : '');
            });
            const allOk = lines.length > 0 && lines.every(function(l) { return l.indexOf(': published') !== -1; });
            showToast(lines.join(' · '), allOk ? 'success' : 'error', allOk ? 2500 : 8000);
        } catch (e) {
            startPushCooldown(5);
            showToast('Publish failed (network error)', 'error', 3000);
        }
    });

    // ---- Publish preview (moderator+): dry-run render of the exact markup
    // the bot would send, shown in a chat-like modal. No cooldown, no HTTP
    // delivery - it reads the same buildDayText() output from the server.
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // Chat-style approximation: **bold** -> <strong>, newlines kept. Table
    // pipes stay literal, exactly as plain-markdown chat renders them.
    function markupToHtml(text) {
        return escHtml(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    }
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
    const DAY_LABELS_LOCAL = { sat: 'Saturday', sun: 'Sunday' };
    if (previewBtn) {
        previewBtn.addEventListener('click', async function() {
            if (!AuthModule.isMod()) {
                showToast('Only moderators and admins can preview.', 'error', 3000);
                return;
            }
            try {
                previewBtn.disabled = true;
                const r = await fetch('/api/broadcast/preview', { headers: getAuthHeader() });
                const result = await r.json();
                if (result.success) {
                    openBroadcastPreview(result.days || {});
                } else {
                    showToast(result.error || 'Preview failed', 'error', 3000);
                }
            } catch (e) {
                showToast('Preview failed (network error)', 'error', 3000);
            } finally {
                previewBtn.disabled = false;
            }
        });
    }
    const previewCloseBtn = document.getElementById('broadcastPreviewCloseBtn');
    if (previewCloseBtn) {
        previewCloseBtn.addEventListener('click', function() {
            document.getElementById('broadcastPreviewModal').classList.remove('active');
        });
    }

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
