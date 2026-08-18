// ============================================================
// EXPORT PANEL (Phase 10 + 10B) - Export/import the roster
// ============================================================
// Role matrix (button visibility via data-role-show + client guards):
//   Image (PNG) + PDF (Print):       everyone, including public viewers
//   Guild member CSV export/import:  admins+ (buttons near the Guild panel)
//   JSON backup:                     admins+ (Admin Tools button)
// Everything is generated locally in the browser - no external libraries.
// ============================================================

const ExportPanel = {};

// downloadBlob / downloadDataUrl / csvEscape / parseCSVRows / esc live in
// js/util.js (Phase 11.3) - shared across all modules.

function _exportDate() {
    return new Date().toISOString().slice(0, 10);
}

function _dayLabel(day) {
    return day === 'sun' ? 'Sunday' : 'Saturday';
}

function _playerName(p) {
    return p && p.name ? p.name : '';
}

// Deduped master list across both days (they are the same list).
function _guildMasterList() {
    const seen = {};
    const out = [];
    ['sat', 'sun'].forEach(function(day) {
        const gm = (window.guildMembers && window.guildMembers[day]) || [];
        gm.forEach(function(p) {
            if (!p || !p.name) return;
            const k = p.name + '|' + (p.class || '');
            if (seen[k]) return;
            seen[k] = true;
            out.push({ name: p.name, class: p.class || '', role: p.role || 'Member' });
        });
    });
    return out;
}

// ============================================================
// CSV: guild member list only (admin+) - near the Guild panel
// Name,Class,Role so it round-trips through Excel.
// ============================================================
function exportGuildCsv() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isAdmin()) {
        if (typeof showToast === 'function') showToast('Guild CSV export is for admins only.', 'error', 2500);
        return;
    }
    const rows = [['Name', 'Class', 'Role']];
    _guildMasterList().forEach(function(p) {
        rows.push([p.name, p.class, p.role]);
    });
    const csv = rows.map(function(r) { return r.map(csvEscape).join(','); }).join('\r\n');
    downloadBlob('\ufeff' + csv, 'guild-members-' + _exportDate() + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('Guild member CSV downloaded', 'success', 1500);
}

// ============================================================
// IMAGE: roster PNG (everyone) - two-column days + one guild
// table, drawn with proper gridlines so it is shareable.
// ============================================================
function exportRosterImage() {
    try {
        const W = 1400;
        const PAD = 40;
        const GUTTER = 40;
        const COLW = (W - PAD * 2 - GUTTER) / 2; // 640
        let ctx = document.createElement('canvas').getContext('2d');
        
        // Fixed light, high-contrast palette - deliberately NOT theme-driven.
        // The roster is a shareable/printable artifact: dark text on white is
        // readable on paper and on screen no matter what theme the app UI is
        // currently in (theme-driven colors made words invisible in light mode
        // because the zebra rows were hardcoded dark, and in dark-mode prints
        // because the page background could stay dark).
        const BG = '#ffffff';
        const BORDER = '#cbd5e1';
        const HEADER_BG = '#f1f5f9';
        const ALT_BG = '#f8fafc';
        const TEXT = '#334155';
        const TITLE_COL = '#0f172a';
        const ACCENT = '#b45309'; // amber-700: gold that reads on white
        const MUTED = '#64748b';
        
        // Wrap text into lines that fit a pixel width.
        const wrap = function(text, font, maxWidth) {
            ctx.font = font;
            const mw = ctx.measureText('m').width || 8;
            const maxChars = Math.max(1, Math.floor(maxWidth / mw));
            const words = String(text).split(' ');
            const lines = [];
            let cur = '';
            words.forEach(function(w) {
                const piece = cur ? cur + ' ' + w : w;
                if (cur && piece.length > maxChars) {
                    lines.push(cur);
                    cur = w;
                } else {
                    cur = piece;
                }
            });
            if (cur) lines.push(cur);
            return lines.length ? lines : [''];
        };
        
        // Build a day table: rows of { cells: [group, membersText], isReserve }.
        const buildDayTable = function(day) {
            const rows = [];
            const groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                const g = groups[key] || {};
                const players = (g.players || []).map(_playerName).filter(Boolean);
                rows.push({ cells: [g.title || key, players.join(', ') || '—'], isReserve: false });
            });
            const reserves = (window.reserves && window.reserves[day]) || [];
            const reserveNames = reserves.map(_playerName).filter(Boolean);
            rows.push({ cells: ['Reserves', reserveNames.join(', ') || '—'], isReserve: true });
            return rows;
        };
        
        const CELL_FONT = '14px system-ui';
        const GROUP_FONT = 'bold 14px system-ui';
        const RESERVE_FONT = 'bold 14px system-ui';
        const HDR_FONT = 'bold 15px system-ui';
        const LINE_H = 22;
        const CELL_PAD = 9;
        const GROUP_COL = 210;
        
        const tableRows = { sat: buildDayTable('sat'), sun: buildDayTable('sun') };
        const dayHeaders = { sat: 'SATURDAY', sun: 'SUNDAY' };
        
        // Measure a day table: header height + row heights.
        const measureTable = function(rows) {
            let h = 0;
            h += LINE_H + CELL_PAD * 2; // header
            rows.forEach(function(r) {
                let maxLines = 1;
                r.cells.forEach(function(c, i) {
                    const font = (i === 0) ? (r.isReserve ? RESERVE_FONT : GROUP_FONT) : CELL_FONT;
                    const maxW = (i === 0 ? GROUP_COL : COLW - GROUP_COL) - CELL_PAD * 2;
                    const n = wrap(c, font, maxW).length;
                    if (n > maxLines) maxLines = n;
                });
                r._h = maxLines * LINE_H + CELL_PAD * 2;
                h += r._h;
            });
            return h;
        };
        
        const hSat = measureTable(tableRows.sat);
        const hSun = measureTable(tableRows.sun);
        const topH = Math.max(hSat, hSun);
        
        // Guild members: compact grid (6 columns of "Name (Class)").
        const guild = _guildMasterList();
        const GCOLS = 6;
        const GCELL_W = (W - PAD * 2) / GCOLS;
        const GCELL_H = 34;
        const guildRows = Math.ceil(guild.length / GCOLS);
        
        // Uniform rhythm: GAP between blocks, TITLE_GAP between a heading
        // and its content, so every panel in the image has the same air.
        const GAP = 34;
        const TITLE_GAP = 26;
        const H = PAD + 92 + GAP + topH + GAP + TITLE_GAP + guildRows * GCELL_H + PAD;
        
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d');
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);
        
        // Outer frame.
        ctx.strokeStyle = BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(14, 14, W - 28, H - 28);
        
        // Title + date.
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 34px system-ui';
        ctx.fillStyle = TITLE_COL;
        ctx.fillText((window.guildName || 'Mask Sinners') + ' — Guild War Roster', PAD, 62);
        ctx.font = '18px system-ui';
        ctx.fillStyle = MUTED;
        ctx.fillText('Generated ' + new Date().toLocaleString(), PAD, 92);
        
        // Draw one day table at (x, yTop); returns the bottom y.
        const drawTable = function(x, yTop, headerText, rows) {
            let y = yTop;
            // Day header.
            ctx.font = 'bold 24px system-ui';
            ctx.fillStyle = ACCENT;
            ctx.fillText(headerText, x, y);
            y += TITLE_GAP;
            // Table header row.
            ctx.font = HDR_FONT;
            ctx.fillStyle = TEXT;
            const th = LINE_H + CELL_PAD * 2;
            ctx.fillStyle = HEADER_BG;
            ctx.fillRect(x, y, COLW, th);
            ctx.strokeStyle = BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, COLW, th);
            ctx.strokeRect(x + GROUP_COL, y, COLW - GROUP_COL, th);
            ctx.fillStyle = TITLE_COL;
            ctx.fillText('Group', x + CELL_PAD, y + CELL_PAD + LINE_H - 5);
            ctx.fillText('Members', x + GROUP_COL + CELL_PAD, y + CELL_PAD + LINE_H - 5);
            y += th;
            // Body rows.
            rows.forEach(function(r, idx) {
                ctx.fillStyle = (idx % 2 === 1) ? ALT_BG : BG;
                if (r.isReserve) ctx.fillStyle = HEADER_BG;
                ctx.fillRect(x, y, COLW, r._h);
                ctx.strokeStyle = BORDER;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, COLW, r._h);
                ctx.strokeRect(x + GROUP_COL, y, COLW - GROUP_COL, r._h);
                const lines0 = wrap(r.cells[0], r.isReserve ? RESERVE_FONT : GROUP_FONT, GROUP_COL - CELL_PAD * 2);
                const lines1 = wrap(r.cells[1], CELL_FONT, COLW - GROUP_COL - CELL_PAD * 2);
                const n = Math.max(lines0.length, lines1.length);
                ctx.font = r.isReserve ? RESERVE_FONT : GROUP_FONT;
                ctx.fillStyle = r.isReserve ? ACCENT : TITLE_COL;
                for (let i = 0; i < lines0.length; i++) {
                    ctx.fillText(lines0[i], x + CELL_PAD, y + CELL_PAD + (i + 1) * LINE_H - 5);
                }
                ctx.font = CELL_FONT;
                ctx.fillStyle = TEXT;
                for (let j = 0; j < lines1.length; j++) {
                    ctx.fillText(lines1[j], x + GROUP_COL + CELL_PAD, y + CELL_PAD + (j + 1) * LINE_H - 5);
                }
                y += r._h;
            });
            return y;
        };
        
        const yTop = PAD + 92 + GAP;
        drawTable(PAD, yTop, 'SATURDAY', tableRows.sat);
        drawTable(PAD + COLW + GUTTER, yTop, 'SUNDAY', tableRows.sun);
        
        // Guild members grid (compact, row-major 6 columns).
        let gy = yTop + topH + GAP;
        ctx.font = 'bold 24px system-ui';
        ctx.fillStyle = TITLE_COL;
        ctx.fillText('Guild Members (' + guild.length + ')', PAD, gy);
        gy += TITLE_GAP;
        const GCELL_FONT = '14px system-ui';
        ctx.font = GCELL_FONT;
        for (let gi = 0; gi < guild.length; gi++) {
            const gc = gi % GCOLS;
            const gr = Math.floor(gi / GCOLS);
            const x = PAD + gc * GCELL_W;
            const y = gy + gr * GCELL_H;
            if (gr % 2 === 1) {
                ctx.fillStyle = ALT_BG;
                ctx.fillRect(x, y, GCELL_W, GCELL_H);
            }
            ctx.strokeStyle = BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, GCELL_W, GCELL_H);
            ctx.fillStyle = TEXT;
            let label = guild[gi].name + (guild[gi].class ? ' (' + guild[gi].class + ')' : '');
            if (label.length > 24) label = label.slice(0, 23) + '…';
            ctx.fillText(label, x + 10, y + GCELL_H / 2 + 5);
        }
        
        downloadDataUrl(canvas.toDataURL('image/png'), 'guild-war-roster-' + _exportDate() + '.png');
        if (typeof showToast === 'function') showToast('Roster image downloaded', 'success', 1500);
    } catch (error) {
        console.error('Image export error:', error);
        if (typeof showToast === 'function') showToast('Failed to generate image.', 'error', 2500);
    }
}

// ============================================================
// PDF: dedicated printable roster (everyone) - same layout as the
// image export, in landscape: SATURDAY | SUNDAY side by side, then
// a compact Guild Members grid. The app UI (incl. the Register
// panel) is hidden in print.
// ============================================================
function exportRosterPDF() {
    try {
        const el = document.getElementById('printRoster');
        if (!el) { window.print(); return; }
        
        let html = '';
        html += '<h1>' + esc(window.guildName || 'Mask Sinners') + ' — Guild War Roster</h1>';
        html += '<p class="print-sub">Generated ' + esc(new Date().toLocaleString()) + '</p>';
        
        const dayNames = { sat: 'Saturday', sun: 'Sunday' };
        let dayTables = '';
        ['sat', 'sun'].forEach(function(day) {
            dayTables += '<div class="print-day-col">';
            dayTables += '<h2>' + dayNames[day] + '</h2>';
            dayTables += '<table class="print-day-table">';
            dayTables += '<thead><tr><th style="width:26%;">Group</th><th>Members</th></tr></thead><tbody>';
            const groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                const g = groups[key] || {};
                const players = (g.players || []).map(_playerName).filter(Boolean);
                dayTables += '<tr><td class="group-name">' + esc(g.title || key) + '</td><td>' +
                    (players.length ? esc(players.join(', ')) : '<span class="print-empty">— empty —</span>') + '</td></tr>';
            });
            const reserves = (window.reserves && window.reserves[day]) || [];
            const reserveNames = reserves.map(_playerName).filter(Boolean);
            dayTables += '<tr class="print-reserve-row"><td class="group-name">Reserves</td><td>' +
                (reserveNames.length ? esc(reserveNames.join(', ')) : '<span class="print-empty">— empty —</span>') + '</td></tr>';
            dayTables += '</tbody></table>';
            dayTables += '</div>';
        });
        html += '<div class="print-days">' + dayTables + '</div>';
        
        const guild = _guildMasterList();
        html += '<h2 class="print-guild-heading">Guild Members (' + guild.length + ')</h2>';
        if (guild.length) {
            html += '<div class="print-guild-grid">';
            guild.forEach(function(p) {
                const label = p.name + (p.class ? ' (' + p.class + ')' : '');
                html += '<span class="print-guild-item">' + esc(label) + '</span>';
            });
            html += '</div>';
        } else {
            html += '<div class="print-empty">— empty —</div>';
        }
        
        el.innerHTML = html;
        window.print();
    } catch (error) {
        console.error('PDF export error:', error);
        if (typeof showToast === 'function') showToast('Failed to prepare print view.', 'error', 2500);
    }
}

// ============================================================
// CSV import of guild members (admin+) - file upload or paste
// ============================================================

const VALID_CLASSES = ['Tank', 'DPS', 'Heal'];
const VALID_ROLES = ['Member', 'Commander', 'Vice Commander', 'Healer'];

function _readImportRows() {
    const text = document.getElementById('guildImportText').value.trim();
    const fileInput = document.getElementById('guildImportFile');
    if (fileInput && fileInput.files && fileInput.files[0] && !text) return null;
    const rows = parseCSVRows(text);
    if (rows.length && /^name\s*$/i.test(rows[0][0])) rows.shift();
    return rows;
}

function _normalizeImportRow(cells) {
    const name = (cells[0] || '').trim();
    const cls = (cells[1] || '').trim() || 'DPS';
    const role = (cells[2] || '').trim() || 'Member';
    if (!name) return { error: 'Empty name' };
    if (name.length > 20) return { error: 'Name too long: ' + name };
    if (/[<>]/.test(name)) return { error: 'Invalid chars in name: ' + name };
    if (VALID_CLASSES.indexOf(cls) === -1) return { error: 'Bad class "' + cls + '" for ' + name };
    if (VALID_ROLES.indexOf(role) === -1) return { error: 'Bad role "' + role + '" for ' + name };
    return { name: name, class: cls, role: role };
}

function _showImportPreview() {
    const rows = _readImportRows();
    const preview = document.getElementById('guildImportPreview');
    if (rows === null) {
        const fileInput = document.getElementById('guildImportFile');
        const reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _showImportPreview();
        };
        reader.readAsText(fileInput.files[0]);
        return;
    }
    const parsed = rows.map(_normalizeImportRow);
    let ok = parsed.filter(function(r) { return !r.error; });
    const bad = parsed.filter(function(r) { return r.error; });
    let existing = 0;
    const seen = {};
    const days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    
    ok = ok.filter(function(p) {
        const k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        const dayHas = days.some(function(day) {
            return ((window.guildMembers && window.guildMembers[day]) || []).some(function(g) {
                return g && g.name === p.name && (g.class || '') === p.class;
            });
        });
        if (dayHas) { existing++; return false; }
        return true;
    });
    
    preview.textContent = 'Preview: ' + ok.length + ' new players will be added'
        + (days.length === 2 ? ' to BOTH days' : days.length === 1 ? ' to ' + _dayLabel(days[0]) : '')
        + (existing ? '. ' + existing + ' already exist (skipped).' : '')
        + (bad.length ? '\nSkipped ' + bad.length + ' bad row(s):\n' + bad.slice(0, 5).map(function(b) { return '• ' + b.error; }).join('\n') : '');
}

function _applyGuildImport() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isAdmin()) {
        if (typeof showToast === 'function') showToast('Only admins can import guild members.', 'error', 2500);
        return;
    }
    const rows = _readImportRows();
    if (rows === null) {
        const fileInput = document.getElementById('guildImportFile');
        const reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _applyGuildImport();
        };
        reader.readAsText(fileInput.files[0]);
        return;
    }
    
    const days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    if (days.length === 0) {
        if (typeof showToast === 'function') showToast('Select at least one day.', 'error', 2500);
        return;
    }
    
    let parsed = rows.map(_normalizeImportRow).filter(function(r) { return !r.error; });
    const seen = {};
    parsed = parsed.filter(function(p) {
        const k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    
    if (parsed.length === 0) {
        if (typeof showToast === 'function') showToast('No valid players to import.', 'error', 2500);
        return;
    }
    
    let added = 0;
    let skippedExisting = 0;
    days.forEach(function(day) {
        if (!window.guildMembers) window.guildMembers = {};
        if (!Array.isArray(window.guildMembers[day])) window.guildMembers[day] = [];
        const list = window.guildMembers[day];
        parsed.forEach(function(p) {
            const exists = list.some(function(g) { return g && g.name === p.name && (g.class || '') === p.class; });
            if (exists) { skippedExisting++; return; }
            if (list.length >= 30) return;
            list.push({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                name: p.name,
                class: p.class,
                role: p.role
            });
            added++;
        });
    });
    
    if (added === 0 && skippedExisting === 0) {
        if (typeof showToast === 'function') showToast('Nothing to import (list full or all duplicates).', 'error', 2500);
        return;
    }
    
    if (typeof History !== 'undefined' && History.add) {
        History.add('import', {
            details: 'CSV import: ' + added + ' guild member(s) added' + (skippedExisting ? ', ' + skippedExisting + ' already existed' : '')
        });
    }
    if (typeof updateLastUpdate === 'function') updateLastUpdate();
    if (typeof render === 'function') render();
    if (typeof saveState === 'function') saveState();
    
    if (typeof showToast === 'function') showToast('Imported ' + added + ' guild member(s).', 'success', 2500);
    _closeGuildImport();
}

function _openGuildImport() {
    const modal = document.getElementById('guildImportModal');
    if (!modal) return;
    document.getElementById('guildImportFile').value = '';
    document.getElementById('guildImportText').value = '';
    document.getElementById('guildImportPreview').textContent = '';
    document.getElementById('guildImportSat').checked = true;
    document.getElementById('guildImportSun').checked = true;
    modal.classList.add('active');
}

function _closeGuildImport() {
    const modal = document.getElementById('guildImportModal');
    if (modal) modal.classList.remove('active');
}

// ---- wiring ----
ExportPanel.init = function() {
    const pdfBtn = document.getElementById('exportPdfBtn');
    const imgBtn = document.getElementById('exportImageBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', exportRosterPDF);
    if (imgBtn) imgBtn.addEventListener('click', exportRosterImage);
    
    // Guild member CSV tools (admin+)
    const gExp = document.getElementById('guildCsvExportBtn');
    const gImp = document.getElementById('guildCsvImportBtn');
    if (gExp) gExp.addEventListener('click', exportGuildCsv);
    if (gImp) gImp.addEventListener('click', _openGuildImport);
    
    const applyBtn = document.getElementById('guildImportApplyBtn');
    const cancelBtn = document.getElementById('guildImportCancelBtn');
    if (applyBtn) applyBtn.addEventListener('click', _applyGuildImport);
    if (cancelBtn) cancelBtn.addEventListener('click', _closeGuildImport);
    
    const fileInput = document.getElementById('guildImportFile');
    const textArea = document.getElementById('guildImportText');
    const satChk = document.getElementById('guildImportSat');
    const sunChk = document.getElementById('guildImportSun');
    [fileInput, textArea, satChk, sunChk].forEach(function(el) {
        if (el) el.addEventListener('input', _showImportPreview);
    });
};
