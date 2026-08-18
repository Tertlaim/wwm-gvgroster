// ============================================================
// EXPORT PANEL (Phase 10 + 10B) - Export/import the roster
// ============================================================
// Role matrix (button visibility via data-role-show + client guards):
//   Image (PNG) + PDF (Print):       everyone, including public viewers
//   Guild member CSV export/import:  admins+ (buttons near the Guild panel)
//   JSON backup:                     admins+ (Admin Tools button)
// Everything is generated locally in the browser - no external libraries.
// ============================================================

var ExportPanel = {};

// ---- small helpers ----

function _exportDate() {
    return new Date().toISOString().slice(0, 10);
}

function _downloadBlob(content, filename, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function _downloadDataUrl(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function _csvEscape(value) {
    var s = String(value == null ? '' : value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function _dayLabel(day) {
    return day === 'sun' ? 'Sunday' : 'Saturday';
}

function _playerName(p) {
    return p && p.name ? p.name : '';
}

// Deduped master list across both days (they are the same list).
function _guildMasterList() {
    var seen = {};
    var out = [];
    ['sat', 'sun'].forEach(function(day) {
        var gm = (window.guildMembers && window.guildMembers[day]) || [];
        gm.forEach(function(p) {
            if (!p || !p.name) return;
            var k = p.name + '|' + (p.class || '');
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
    var rows = [['Name', 'Class', 'Role']];
    _guildMasterList().forEach(function(p) {
        rows.push([p.name, p.class, p.role]);
    });
    var csv = rows.map(function(r) { return r.map(_csvEscape).join(','); }).join('\r\n');
    _downloadBlob('\ufeff' + csv, 'guild-members-' + _exportDate() + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('Guild member CSV downloaded', 'success', 1500);
}

// ============================================================
// IMAGE: roster PNG (everyone) - two-column days + one guild
// table, drawn with proper gridlines so it is shareable.
// ============================================================
function exportRosterImage() {
    try {
        var W = 1400;
        var PAD = 40;
        var GUTTER = 40;
        var COLW = (W - PAD * 2 - GUTTER) / 2; // 640
        var ctx = document.createElement('canvas').getContext('2d');
        
        var BORDER = '#334155';
        var HEADER_BG = '#1e293b';
        var ALT_BG = '#111c2f';
        var TEXT = '#cbd5e1';
        var TITLE_COL = '#f8fafc';
        var ACCENT = '#f5c542';
        var MUTED = '#94a3b8';
        
        // Wrap text into lines that fit a pixel width.
        var wrap = function(text, font, maxWidth) {
            ctx.font = font;
            var mw = ctx.measureText('m').width || 8;
            var maxChars = Math.max(1, Math.floor(maxWidth / mw));
            var words = String(text).split(' ');
            var lines = [];
            var cur = '';
            words.forEach(function(w) {
                var piece = cur ? cur + ' ' + w : w;
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
        var buildDayTable = function(day) {
            var rows = [];
            var groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                var g = groups[key] || {};
                var players = (g.players || []).map(_playerName).filter(Boolean);
                rows.push({ cells: [g.title || key, players.join(', ') || '—'], isReserve: false });
            });
            var reserves = (window.reserves && window.reserves[day]) || [];
            var reserveNames = reserves.map(_playerName).filter(Boolean);
            rows.push({ cells: ['Reserves', reserveNames.join(', ') || '—'], isReserve: true });
            return rows;
        };
        
        var CELL_FONT = '14px system-ui';
        var GROUP_FONT = 'bold 14px system-ui';
        var RESERVE_FONT = 'bold 14px system-ui';
        var HDR_FONT = 'bold 15px system-ui';
        var LINE_H = 22;
        var CELL_PAD = 9;
        var GROUP_COL = 210;
        
        var tableRows = { sat: buildDayTable('sat'), sun: buildDayTable('sun') };
        var dayHeaders = { sat: 'SATURDAY', sun: 'SUNDAY' };
        
        // Measure a day table: header height + row heights.
        var measureTable = function(rows) {
            var h = 0;
            h += LINE_H + CELL_PAD * 2; // header
            rows.forEach(function(r) {
                var maxLines = 1;
                r.cells.forEach(function(c, i) {
                    var font = (i === 0) ? (r.isReserve ? RESERVE_FONT : GROUP_FONT) : CELL_FONT;
                    var maxW = (i === 0 ? GROUP_COL : COLW - GROUP_COL) - CELL_PAD * 2;
                    var n = wrap(c, font, maxW).length;
                    if (n > maxLines) maxLines = n;
                });
                r._h = maxLines * LINE_H + CELL_PAD * 2;
                h += r._h;
            });
            return h;
        };
        
        var hSat = measureTable(tableRows.sat);
        var hSun = measureTable(tableRows.sun);
        var topH = Math.max(hSat, hSun);
        
        // Guild members: compact grid (6 columns of "Name (Class)").
        var guild = _guildMasterList();
        var GCOLS = 6;
        var GCELL_W = (W - PAD * 2) / GCOLS;
        var GCELL_H = 34;
        var guildRows = Math.ceil(guild.length / GCOLS);
        
        // Uniform rhythm: GAP between blocks, TITLE_GAP between a heading
        // and its content, so every panel in the image has the same air.
        var GAP = 34;
        var TITLE_GAP = 26;
        var H = PAD + 92 + GAP + topH + GAP + TITLE_GAP + guildRows * GCELL_H + PAD;
        
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
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
        var drawTable = function(x, yTop, headerText, rows) {
            var y = yTop;
            // Day header.
            ctx.font = 'bold 24px system-ui';
            ctx.fillStyle = ACCENT;
            ctx.fillText(headerText, x, y);
            y += TITLE_GAP;
            // Table header row.
            ctx.font = HDR_FONT;
            ctx.fillStyle = TEXT;
            var th = LINE_H + CELL_PAD * 2;
            ctx.fillStyle = HEADER_BG;
            ctx.fillRect(x, y, COLW, th);
            ctx.strokeStyle = BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, COLW, th);
            ctx.strokeRect(x + GROUP_COL, y, COLW - GROUP_COL, th);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText('Group', x + CELL_PAD, y + CELL_PAD + LINE_H - 5);
            ctx.fillText('Members', x + GROUP_COL + CELL_PAD, y + CELL_PAD + LINE_H - 5);
            y += th;
            // Body rows.
            rows.forEach(function(r, idx) {
                ctx.fillStyle = (idx % 2 === 1) ? ALT_BG : '#0f172a';
                if (r.isReserve) ctx.fillStyle = '#182741';
                ctx.fillRect(x, y, COLW, r._h);
                ctx.strokeStyle = BORDER;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, COLW, r._h);
                ctx.strokeRect(x + GROUP_COL, y, COLW - GROUP_COL, r._h);
                var lines0 = wrap(r.cells[0], r.isReserve ? RESERVE_FONT : GROUP_FONT, GROUP_COL - CELL_PAD * 2);
                var lines1 = wrap(r.cells[1], CELL_FONT, COLW - GROUP_COL - CELL_PAD * 2);
                var n = Math.max(lines0.length, lines1.length);
                ctx.font = r.isReserve ? RESERVE_FONT : GROUP_FONT;
                ctx.fillStyle = r.isReserve ? ACCENT : '#e2e8f0';
                for (var i = 0; i < lines0.length; i++) {
                    ctx.fillText(lines0[i], x + CELL_PAD, y + CELL_PAD + (i + 1) * LINE_H - 5);
                }
                ctx.font = CELL_FONT;
                ctx.fillStyle = TEXT;
                for (var j = 0; j < lines1.length; j++) {
                    ctx.fillText(lines1[j], x + GROUP_COL + CELL_PAD, y + CELL_PAD + (j + 1) * LINE_H - 5);
                }
                y += r._h;
            });
            return y;
        };
        
        var yTop = PAD + 92 + GAP;
        drawTable(PAD, yTop, 'SATURDAY', tableRows.sat);
        drawTable(PAD + COLW + GUTTER, yTop, 'SUNDAY', tableRows.sun);
        
        // Guild members grid (compact, row-major 6 columns).
        var gy = yTop + topH + GAP;
        // Divider line across the width above the guild section.
        ctx.strokeStyle = BORDER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PAD, gy - 16);
        ctx.lineTo(W - PAD, gy - 16);
        ctx.stroke();
        ctx.font = 'bold 24px system-ui';
        ctx.fillStyle = TITLE_COL;
        ctx.fillText('Guild Members (' + guild.length + ')', PAD, gy);
        gy += TITLE_GAP;
        var GCELL_FONT = '14px system-ui';
        ctx.font = GCELL_FONT;
        for (var gi = 0; gi < guild.length; gi++) {
            var gc = gi % GCOLS;
            var gr = Math.floor(gi / GCOLS);
            var x = PAD + gc * GCELL_W;
            var y = gy + gr * GCELL_H;
            if (gr % 2 === 1) {
                ctx.fillStyle = ALT_BG;
                ctx.fillRect(x, y, GCELL_W, GCELL_H);
            }
            ctx.strokeStyle = BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, GCELL_W, GCELL_H);
            ctx.fillStyle = TEXT;
            var label = guild[gi].name + (guild[gi].class ? ' (' + guild[gi].class + ')' : '');
            if (label.length > 24) label = label.slice(0, 23) + '…';
            ctx.fillText(label, x + 10, y + GCELL_H / 2 + 5);
        }
        
        _downloadDataUrl(canvas.toDataURL('image/png'), 'guild-war-roster-' + _exportDate() + '.png');
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
        var el = document.getElementById('printRoster');
        if (!el) { window.print(); return; }
        
        var esc = typeof window.esc === 'function' ? window.esc : function(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        var html = '';
        html += '<h1>' + esc(window.guildName || 'Mask Sinners') + ' — Guild War Roster</h1>';
        html += '<p class="print-sub">Generated ' + esc(new Date().toLocaleString()) + '</p>';
        
        var dayNames = { sat: 'Saturday', sun: 'Sunday' };
        var dayTables = '';
        ['sat', 'sun'].forEach(function(day) {
            dayTables += '<div class="print-day-col">';
            dayTables += '<h2>' + dayNames[day] + '</h2>';
            dayTables += '<table class="print-day-table">';
            dayTables += '<thead><tr><th style="width:26%;">Group</th><th>Members</th></tr></thead><tbody>';
            var groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                var g = groups[key] || {};
                var players = (g.players || []).map(_playerName).filter(Boolean);
                dayTables += '<tr><td class="group-name">' + esc(g.title || key) + '</td><td>' +
                    (players.length ? esc(players.join(', ')) : '<span class="print-empty">— empty —</span>') + '</td></tr>';
            });
            var reserves = (window.reserves && window.reserves[day]) || [];
            var reserveNames = reserves.map(_playerName).filter(Boolean);
            dayTables += '<tr class="print-reserve-row"><td class="group-name">Reserves</td><td>' +
                (reserveNames.length ? esc(reserveNames.join(', ')) : '<span class="print-empty">— empty —</span>') + '</td></tr>';
            dayTables += '</tbody></table>';
            dayTables += '</div>';
        });
        html += '<div class="print-days">' + dayTables + '</div>';
        
        var guild = _guildMasterList();
        html += '<h2 class="print-guild-heading">Guild Members (' + guild.length + ')</h2>';
        if (guild.length) {
            html += '<div class="print-guild-grid">';
            guild.forEach(function(p) {
                var label = p.name + (p.class ? ' (' + p.class + ')' : '');
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

var VALID_CLASSES = ['Tank', 'DPS', 'Heal'];
var VALID_ROLES = ['Member', 'Commander', 'Vice Commander', 'Healer'];

function _parseCsvRows(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else {
                cell += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(cell); cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
            row = [];
        } else {
            cell += c;
        }
    }
    row.push(cell);
    if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
}

function _readImportRows() {
    var text = document.getElementById('guildImportText').value.trim();
    var fileInput = document.getElementById('guildImportFile');
    if (fileInput && fileInput.files && fileInput.files[0] && !text) return null;
    var rows = _parseCsvRows(text);
    if (rows.length && /^name\s*$/i.test(rows[0][0])) rows.shift();
    return rows;
}

function _normalizeImportRow(cells) {
    var name = (cells[0] || '').trim();
    var cls = (cells[1] || '').trim() || 'DPS';
    var role = (cells[2] || '').trim() || 'Member';
    if (!name) return { error: 'Empty name' };
    if (name.length > 20) return { error: 'Name too long: ' + name };
    if (/[<>]/.test(name)) return { error: 'Invalid chars in name: ' + name };
    if (VALID_CLASSES.indexOf(cls) === -1) return { error: 'Bad class "' + cls + '" for ' + name };
    if (VALID_ROLES.indexOf(role) === -1) return { error: 'Bad role "' + role + '" for ' + name };
    return { name: name, class: cls, role: role };
}

function _showImportPreview() {
    var rows = _readImportRows();
    var preview = document.getElementById('guildImportPreview');
    if (rows === null) {
        var fileInput = document.getElementById('guildImportFile');
        var reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _showImportPreview();
        };
        reader.readAsText(fileInput.files[0]);
        return;
    }
    var parsed = rows.map(_normalizeImportRow);
    var ok = parsed.filter(function(r) { return !r.error; });
    var bad = parsed.filter(function(r) { return r.error; });
    var existing = 0;
    var seen = {};
    var days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    
    ok = ok.filter(function(p) {
        var k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        var dayHas = days.some(function(day) {
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
    var rows = _readImportRows();
    if (rows === null) {
        var fileInput = document.getElementById('guildImportFile');
        var reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _applyGuildImport();
        };
        reader.readAsText(fileInput.files[0]);
        return;
    }
    
    var days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    if (days.length === 0) {
        if (typeof showToast === 'function') showToast('Select at least one day.', 'error', 2500);
        return;
    }
    
    var parsed = rows.map(_normalizeImportRow).filter(function(r) { return !r.error; });
    var seen = {};
    parsed = parsed.filter(function(p) {
        var k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    
    if (parsed.length === 0) {
        if (typeof showToast === 'function') showToast('No valid players to import.', 'error', 2500);
        return;
    }
    
    var added = 0;
    var skippedExisting = 0;
    days.forEach(function(day) {
        if (!window.guildMembers) window.guildMembers = {};
        if (!Array.isArray(window.guildMembers[day])) window.guildMembers[day] = [];
        var list = window.guildMembers[day];
        parsed.forEach(function(p) {
            var exists = list.some(function(g) { return g && g.name === p.name && (g.class || '') === p.class; });
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
    var modal = document.getElementById('guildImportModal');
    if (!modal) return;
    document.getElementById('guildImportFile').value = '';
    document.getElementById('guildImportText').value = '';
    document.getElementById('guildImportPreview').textContent = '';
    document.getElementById('guildImportSat').checked = true;
    document.getElementById('guildImportSun').checked = true;
    modal.classList.add('active');
}

function _closeGuildImport() {
    var modal = document.getElementById('guildImportModal');
    if (modal) modal.classList.remove('active');
}

// ---- wiring ----
ExportPanel.init = function() {
    var pdfBtn = document.getElementById('exportPdfBtn');
    var imgBtn = document.getElementById('exportImageBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', exportRosterPDF);
    if (imgBtn) imgBtn.addEventListener('click', exportRosterImage);
    
    // Guild member CSV tools (admin+)
    var gExp = document.getElementById('guildCsvExportBtn');
    var gImp = document.getElementById('guildCsvImportBtn');
    if (gExp) gExp.addEventListener('click', exportGuildCsv);
    if (gImp) gImp.addEventListener('click', _openGuildImport);
    
    var applyBtn = document.getElementById('guildImportApplyBtn');
    var cancelBtn = document.getElementById('guildImportCancelBtn');
    if (applyBtn) applyBtn.addEventListener('click', _applyGuildImport);
    if (cancelBtn) cancelBtn.addEventListener('click', _closeGuildImport);
    
    var fileInput = document.getElementById('guildImportFile');
    var textArea = document.getElementById('guildImportText');
    var satChk = document.getElementById('guildImportSat');
    var sunChk = document.getElementById('guildImportSun');
    [fileInput, textArea, satChk, sunChk].forEach(function(el) {
        if (el) el.addEventListener('input', _showImportPreview);
    });
};
